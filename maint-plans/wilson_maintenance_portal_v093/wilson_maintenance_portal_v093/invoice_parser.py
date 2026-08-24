from __future__ import annotations

from dataclasses import dataclass, asdict
from io import BytesIO
from pathlib import Path
import re
import sys
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

from pypdf import PdfReader  # type: ignore

INVOICE_RE = re.compile(r"\bS\d{8}(?:-\d+)?\b", re.I)
AREA_RE = re.compile(r"\*{3,}\s*(?P<name>[^*]+?)\s*\*{3,}")
SERIAL_RE = re.compile(r"Serial\s*#\s*:\s*([A-Za-z0-9-]+)", re.I)
MONEY = r"-?(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}|-"
ROW_RE = re.compile(
    rf"^\s*(?P<qty>-?\d+|Payment)\s+(?P<body>.*?)\s{{2,}}(?P<price>{MONEY})\s{{2,}}(?P<ext>{MONEY})\s*$",
    re.I,
)
CITY_STATE_ZIP_RE = re.compile(r"^(?P<city>.*?),\s*(?P<state>[A-Z]{2})\s+(?P<zip>\d{5}(?:-\d{4})?)$")

BRAND_MAP = {
    "SUBZERO": "Sub-Zero",
    "SUB-ZERO": "Sub-Zero",
    "WOLF": "Wolf",
    "COVE": "Cove",
    "LG HOME APPLIANCES": "LG",
    "TRUE MANUFACTURING": "True",
    "TRUE COMMERCIAL": "True Commercial",
    "KITCHENAID": "KitchenAid",
    "JENNAIR": "JennAir",
    "THERMADOR": "Thermador",
    "BOSCH": "Bosch",
    "MIELE": "Miele",
    "MONOGRAM": "Monogram",
    "GE PROFILE": "GE Profile",
    "GE APPLIANCES": "GE",
    "FISHER & PAYKEL": "Fisher & Paykel",
    "SCOTSMAN": "Scotsman",
}

EXCLUDE_PHRASES = (
    "south central remodel program",
    "payment transfer",
    "payment check",
    "dishwasher h2o connect kit",
    "washer hoses",
    "dryer cord",
    "dryer - ss steam kit",
    "dryer vent kit",
    "gas flex line",
    "stainless steel gas flex line",
    "install",
    "installation",
    "in-home delivery",
    "in home delivery",
    "anti-condensation pad",
    "anti condensation pad",
    "mounting kit",
    "door panel",
    "knob kit",
    "bezel kit",
    "bezel",
    "accessories",
    "ventilator blower",
    "blower assembly",
    "toe kick",
)


@dataclass
class RawLineItem:
    quantity: int
    model: str
    description: str
    classification: str
    brand_raw: str
    serial: str
    area: str
    invoice_number: str
    source_file: str
    price: str = ""
    extended_price: str = ""


def _clean_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _friendly_area(value: str) -> str:
    cleaned = _clean_space(value).strip("* ")
    if not cleaned:
        return "Unassigned — Review"
    return cleaned.title().replace("Main House", "Main House")


def _friendly_brand(value: str) -> str:
    cleaned = _clean_space(value).strip(" ,")
    if not cleaned:
        return ""
    return BRAND_MAP.get(cleaned.upper(), cleaned.title())


def _parse_ship_to(layout_lines: list[str]) -> dict[str, str]:
    contact: dict[str, str] = {}
    for index, line in enumerate(layout_lines):
        if "Ship To:" not in line:
            continue
        ship_col = line.index("Ship To:")
        after = line[ship_col + len("Ship To:"):].strip()
        if after:
            contact["phone"] = re.sub(r"\D", "", after)
        if index + 1 < len(layout_lines):
            contact["householdLabel"] = layout_lines[index + 1][ship_col:].strip()
        if index + 2 < len(layout_lines):
            contact["address1"] = layout_lines[index + 2][ship_col:].strip()
        if index + 3 < len(layout_lines):
            city_line = _clean_space(layout_lines[index + 3][ship_col:])
            match = CITY_STATE_ZIP_RE.match(city_line)
            if match:
                contact.update(match.groupdict())
            else:
                contact["cityLine"] = city_line
        break
    return contact


def _invoice_number(text: str, fallback: str = "") -> str:
    matches = INVOICE_RE.findall(text)
    if not matches:
        return fallback
    # The page may mention the related split invoice before/after the actual invoice.
    # The invoice number is normally printed in the top-right header. Prefer the first
    # match found in the first 1,000 characters of layout text.
    header_matches = INVOICE_RE.findall(text[:1200])
    return (header_matches[-1] if header_matches else matches[0]).upper()


def _parse_row(line: str) -> dict[str, str] | None:
    match = ROW_RE.match(line)
    if not match:
        return None
    qty = match.group("qty")
    body = _clean_space(match.group("body"))
    model = ""
    description = body
    # Model and description are separated by a wide blank column in the layout text.
    raw_body = match.group("body")
    parts = re.split(r"\s{2,}", raw_body.strip(), maxsplit=1)
    if len(parts) == 2 and re.search(r"\d", parts[0]):
        model = parts[0].strip()
        description = _clean_space(parts[1])
    return {
        "qty": qty,
        "model": model,
        "description": description,
        "price": match.group("price"),
        "ext": match.group("ext"),
    }


def _extract_raw_items(pdf_bytes: bytes, source_file: str) -> tuple[list[RawLineItem], dict[str, Any]]:
    reader = PdfReader(BytesIO(pdf_bytes))
    all_layout: list[str] = []
    page_layouts: list[list[str]] = []
    for page in reader.pages:
        text = page.extract_text(extraction_mode="layout") or ""
        lines = text.splitlines()
        page_layouts.append(lines)
        all_layout.extend(lines)

    joined = "\n".join(all_layout)
    invoice_number = _invoice_number(joined, Path(source_file).stem.upper())
    contact = _parse_ship_to(page_layouts[0] if page_layouts else [])
    date_match = re.search(r"\b\d{1,2}/\d{1,2}/\d{4}\b", joined[:1200])
    metadata: dict[str, Any] = {
        "invoiceNumber": invoice_number,
        "invoiceDate": date_match.group(0) if date_match else "",
        "contact": contact,
        "sourceFile": source_file,
        "splitReferences": sorted({m.upper() for m in INVOICE_RE.findall(joined) if m.upper() != invoice_number}),
    }

    items: list[RawLineItem] = []
    current_area = "Unassigned — Review"
    current: dict[str, Any] | None = None

    def finalize() -> None:
        nonlocal current
        if not current:
            return
        try:
            qty = int(current.get("quantity", 0))
        except Exception:
            qty = 0
        items.append(RawLineItem(
            quantity=qty,
            model=_clean_space(current.get("model", "")),
            description=_clean_space(current.get("description", "")),
            classification=_clean_space(current.get("classification", "")),
            brand_raw=_clean_space(current.get("brand_raw", "")),
            serial=_clean_space(current.get("serial", "")),
            area=current.get("area") or "Unassigned — Review",
            invoice_number=invoice_number,
            source_file=source_file,
            price=current.get("price", ""),
            extended_price=current.get("extended_price", ""),
        ))
        current = None

    for lines in page_layouts:
        in_lines = False
        for raw in lines:
            line = raw.rstrip()
            if "QTY" in line and "MODEL #" in line and "DESCRIPTION" in line:
                in_lines = True
                continue
            if not in_lines:
                continue
            stripped = line.strip()
            if not stripped:
                continue
            if "SUB TOTAL" in stripped or stripped.startswith("*Above order"):
                finalize()
                in_lines = False
                continue

            area_match = AREA_RE.search(stripped)
            if area_match:
                finalize()
                area_name = _friendly_area(area_match.group("name"))
                current_area = area_name
                continue

            if stripped.lower().startswith("this invoice has been split"):
                continue

            serial_match = SERIAL_RE.search(stripped)
            if serial_match and current:
                current["serial"] = serial_match.group(1)
                continue

            row = _parse_row(line)
            if row:
                finalize()
                qty_text = row["qty"]
                if qty_text.lower() == "payment":
                    qty = 0
                    description = "Payment " + row["description"]
                else:
                    qty = int(qty_text)
                    description = row["description"]
                current = {
                    "quantity": qty,
                    "model": row["model"],
                    "description": description,
                    "classification": "",
                    "brand_raw": "",
                    "serial": "",
                    "area": current_area,
                    "price": row["price"],
                    "extended_price": row["ext"],
                }
                continue

            if not current:
                continue

            # Manufacturer/category lines are uppercase and comma-delimited.
            if "," in stripped and re.match(r"^[A-Z0-9 &./'~-]+,", stripped):
                parts = [part.strip() for part in stripped.split(",")]
                current["brand_raw"] = parts[0]
                current["classification"] = ", ".join(parts[1:])
                continue

            # Ignore repeated page labels and footers.
            if any(token in stripped for token in ("EXT PRICE", "INVOICE TOTAL", "CUSTOMER SIGNATURE", "TACLB")):
                continue
            current["description"] = _clean_space(current.get("description", "") + " " + stripped)

    finalize()
    return items, metadata


def _classification_blob(item: RawLineItem) -> str:
    return _clean_space(" ".join((item.description, item.classification, item.model))).lower()


def _is_excluded(item: RawLineItem) -> tuple[bool, str]:
    blob = _classification_blob(item)
    if item.quantity <= 0:
        return True, "Non-product, payment, or credit line"
    if item.area.lower().startswith("installation"):
        return True, "Installation section"
    if not item.model and not item.classification:
        return True, "No product model or product classification"
    for phrase in EXCLUDE_PHRASES:
        if phrase in blob:
            return True, f"Excluded support line: {phrase}"
    classification_lower = item.classification.lower()
    if "accessor" in classification_lower:
        return True, "Accessory line"
    if classification_lower.startswith("panel") or classification_lower == "panel":
        return True, "Decorative panel"
    return False, ""


def _friendly_exact_label(value: str) -> str:
    value = _clean_space(value)
    if not value:
        return "Appliance"
    return value.title().replace("U/C", "Undercounter").replace("B/I", "Built-In").replace("X Side", "x Side")


def _classify(item: RawLineItem) -> dict[str, Any] | None:
    excluded, reason = _is_excluded(item)
    if excluded:
        return {"ignored": True, "reason": reason}

    blob = _classification_blob(item)
    classification = item.classification.upper()
    exact_type = "other"
    exact_label = _friendly_exact_label(item.classification or item.description[:70])
    category = ""
    confidence = "medium"
    expand_to: list[str] = []
    needs_review = False
    notes: list[str] = []

    if any(term in blob for term in ("washtower", "washer/dryer combo", "washer dryer combo", "laundry center")):
        exact_type = "laundry_center"
        exact_label = "Laundry Center / WashTower"
        category = "washer_dryer"
        expand_to = ["washer", "dryer"]
        confidence = "high"
        needs_review = True
        notes.append("Prototype splits this product into one washer and one dryer maintenance record; verify the billing rule.")
    elif "dishwasher" in blob:
        exact_type = "dishwasher"
        exact_label = "Dishwasher"
        category = "dishwasher"
        confidence = "high"
    elif any(term in blob for term in ("hood insert", "hood liner", "vent hood", "range hood", "downdraft")):
        exact_type = "hood_insert" if any(term in blob for term in ("insert", "liner")) else "hood"
        exact_label = "Hood Insert / Liner" if exact_type == "hood_insert" else "Vent Hood"
        category = "ventilation"
        confidence = "high"
    elif any(term in blob for term in ("warming drawer", "warming oven", "proofing drawer")):
        exact_type = "warming_drawer"
        exact_label = "Warming Drawer"
        category = "warming_drawer"
        confidence = "high"
    elif any(term in blob for term in ("coffee maker", "coffee system", "coffee machine")):
        exact_type = "coffee_maker"
        exact_label = "Built-In Coffee Maker"
        category = "coffee"
        confidence = "high"
    elif any(term in blob for term in ("rangetop", "range top", "cooktop")):
        exact_type = "cooktop"
        exact_label = "Cooktop / Rangetop"
        category = "cooktop"
        confidence = "high"
    elif "range" in blob and not any(term in blob for term in ("range hood", "range install")):
        exact_type = "range"
        exact_label = "Professional Range" if "pro" in blob or "dual fuel" in blob else "Range"
        category = "range"
        confidence = "high"
    elif any(term in blob for term in ("speedcook", "speed oven", "microwave oven", "microwave drawer", "microwave")):
        exact_type = "speed_oven" if any(term in blob for term in ("speedcook", "speed oven")) else "microwave"
        exact_label = "Speed Oven" if exact_type == "speed_oven" else "Microwave"
        category = "microwave"
        confidence = "high"
    elif any(term in blob for term in ("wall oven", "steam oven", "convection oven", "double oven", "single oven")):
        exact_type = "wall_oven"
        exact_label = "Wall Oven"
        category = "ovens"
        confidence = "high"
    elif "front-load washer" in blob or "top load washer" in blob or re.search(r"\bwasher\b", blob):
        exact_type = "washer"
        exact_label = "Washer"
        category = "washer"
        confidence = "high"
    elif re.search(r"\bdryer\b", blob):
        exact_type = "dryer"
        exact_label = "Dryer"
        category = "dryer"
        confidence = "high"
    elif any(term in blob for term in ("ice maker", "icemaker", "clear ice", "nugget ice")) and not any(term in blob for term in ("refrigerator", "freezer")):
        exact_type = "ice_maker"
        exact_label = "Icemaker (IMUC)"
        category = "ice_maker"
        confidence = "high"
    elif any(term in blob for term in ("refrigerator", "freezer", "refrigeration", "wine cabinet", "wine storage", "beverage center", "floral merchandiser")):
        category = "refrigeration"
        confidence = "high"
        if "commercial" in blob or "floral merchandiser" in blob:
            exact_type = "commercial_refrigeration"
            exact_label = "Commercial / Specialty Refrigeration"
        elif "freezer" in blob and "refrigerator/freezer" not in blob:
            exact_type = "freezer"
            exact_label = "Freezer"
        elif any(term in blob for term in ("wine", "beverage")) and "refrigerator" not in classification.lower():
            exact_type = "wine_beverage"
            exact_label = "Wine / Beverage Center"
        else:
            exact_type = "refrigerator"
            exact_label = "Refrigeration"
    else:
        category = "review"
        exact_type = "other"
        exact_label = _friendly_exact_label(item.classification or "Unclassified Appliance")
        confidence = "low"
        needs_review = True
        notes.append("No confident customer-facing category was found. Select a category before creating the draft.")

    return {
        "ignored": False,
        "quantity": item.quantity,
        "model": item.model,
        "description": item.description,
        "classification": item.classification,
        "brandRaw": item.brand_raw,
        "brand": _friendly_brand(item.brand_raw),
        "serial": item.serial,
        "area": item.area,
        "invoiceNumber": item.invoice_number,
        "sourceFile": item.source_file,
        "price": item.price,
        "extendedPrice": item.extended_price,
        "exactType": exact_type,
        "exactTypeLabel": exact_label,
        "customerCategory": category,
        "expandTo": expand_to,
        "confidence": confidence,
        "needsReview": needs_review,
        "notes": notes,
    }


def parse_invoice_files(files: Iterable[tuple[str, bytes]]) -> dict[str, Any]:
    included: list[dict[str, Any]] = []
    ignored: list[dict[str, Any]] = []
    metadata_records: list[dict[str, Any]] = []
    warnings: list[str] = []

    for filename, payload in files:
        raw_items, metadata = _extract_raw_items(payload, filename)
        metadata_records.append(metadata)
        for raw_item in raw_items:
            result = _classify(raw_item)
            if not result:
                continue
            if result.get("ignored"):
                ignored.append({
                    "quantity": raw_item.quantity,
                    "model": raw_item.model,
                    "description": raw_item.description,
                    "classification": raw_item.classification,
                    "area": raw_item.area,
                    "invoiceNumber": raw_item.invoice_number,
                    "reason": result.get("reason", "Excluded"),
                })
            else:
                result["id"] = f"line_{len(included)+1}"
                included.append(result)
                warnings.extend(result.get("notes", []))

    invoice_numbers = []
    split_references = []
    contact: dict[str, str] = {}
    for metadata in metadata_records:
        number = metadata.get("invoiceNumber")
        if number and number not in invoice_numbers:
            invoice_numbers.append(number)
        for reference in metadata.get("splitReferences", []):
            if reference not in split_references:
                split_references.append(reference)
        if not contact and metadata.get("contact"):
            contact = metadata["contact"]

    if len(invoice_numbers) > 1:
        warnings.append("Multiple invoice files were combined into one maintenance inventory.")
    if any(item.get("area", "").lower().startswith("unassigned") for item in included):
        warnings.append("Some split-invoice products do not have a printed area heading and are placed in Unassigned — Review.")
    unresolved = sum(1 for item in included if item.get("customerCategory") == "review")
    if unresolved:
        warnings.append(f"{unresolved} item(s) require a customer-facing category before creating the enrollment draft.")

    areas: list[str] = []
    for item in included:
        area = item.get("area") or "Unassigned — Review"
        if area not in areas:
            areas.append(area)

    # Preserve order while removing duplicate warnings.
    unique_warnings = list(dict.fromkeys(warnings))
    total_expanded = 0
    for item in included:
        multiplier = len(item.get("expandTo") or []) or 1
        total_expanded += int(item.get("quantity", 0)) * multiplier

    return {
        "ok": True,
        "invoiceNumbers": invoice_numbers,
        "splitReferences": split_references,
        "contact": contact,
        "items": included,
        "ignored": ignored,
        "areas": areas,
        "warnings": unique_warnings,
        "sourceFiles": [name for name, _ in files],
        "lineItemCount": len(included),
        "expandedAssetCount": total_expanded,
    }


if __name__ == "__main__":
    import json
    paths = [Path(arg) for arg in sys.argv[1:]]
    if not paths:
        raise SystemExit("Usage: python invoice_parser.py invoice1.pdf [invoice2.pdf]")
    result = parse_invoice_files([(path.name, path.read_bytes()) for path in paths])
    print(json.dumps(result, indent=2))

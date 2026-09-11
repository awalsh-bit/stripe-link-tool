"""Helpers shared by the DispatchTrack and ExportInvoice importers.

Everything here is deliberately conservative: an import may *fill* a blank dashboard
field but never overwrites one that already has a value (spec §3.4).
"""
from __future__ import annotations

import datetime as _dt
import json
import re
from typing import Optional

from ..db import DB, now_iso

# ---- ePASS category codes (first token of Order Detail) -> (category, install_type)
CATEGORY = {
    "REFRE": ("refrigerator", "freestanding"), "REBIS": ("refrigerator built-in", "built_in"), "REBIF": ("refrigerator built-in", "built_in"),
    "REBIC": ("refrigerator column", "built_in"), "REUND": ("undercounter refrigerator", "built_in"), "WINE": ("wine cooler", "built_in"),
    "FREEZ": ("freezer", "freestanding"), "ICEMK": ("ice maker", "built_in"), "IMUC": ("ice maker undercounter", "built_in"),
    "WASHT": ("washer top-load", "freestanding"), "WASHF": ("washer front-load", "freestanding"), "WASH": ("washer", "freestanding"),
    "DRYEE": ("dryer electric", "freestanding"), "DRYEG": ("dryer gas", "freestanding"), "DRYER": ("dryer", "freestanding"), "LAUND": ("laundry center", "freestanding"),
    "DISHW": ("dishwasher", "built_in"), "DISH": ("dishwasher", "built_in"), "DISPO": ("disposal", "built_in"),
    "RANGE": ("range", "freestanding"), "RANGG": ("range gas", "freestanding"), "RANGE ": ("range", "freestanding"), "RANGD": ("range dual fuel", "freestanding"),
    "COOKT": ("cooktop", "built_in"), "CKTPG": ("cooktop gas", "built_in"), "CKTPE": ("cooktop electric", "built_in"), "RANGT": ("rangetop", "built_in"),
    "WALLO": ("wall oven", "built_in"), "WALLD": ("double wall oven", "built_in"), "OVEN": ("wall oven", "built_in"),
    "MICRO": ("microwave", "freestanding"), "MICOT": ("over-the-range microwave", "built_in"), "MICDR": ("microwave drawer", "built_in"),
    "VHBLO": ("vent hood blower", "built_in"), "VENTH": ("vent hood", "built_in"), "HOOD": ("vent hood", "built_in"), "DOWND": ("downdraft", "built_in"),
    "COFFE": ("coffee system", "built_in"), "WARMD": ("warming drawer", "built_in"), "STEAM": ("steam oven", "built_in"), "TRASH": ("trash compactor", "built_in"),
    "ACCON": ("hvac condenser", "hvac"), "ACAIR": ("hvac air handler", "hvac"), "FURNA": ("furnace", "hvac"), "HVAC": ("hvac", "hvac"), "MINIS": ("mini split", "hvac"), "PKGUN": ("hvac package unit", "hvac"), "THERM": ("thermostat", "hvac"),
    "WTRHT": ("water heater", "hvac"), "GRILL": ("outdoor grill", "freestanding"),
}
HVAC_CATS = {k for k, v in CATEGORY.items() if v[1] == "hvac"}

_DETAIL_RE = re.compile(r"^(?P<cat>[A-Z]{3,6})\s+(?P<rest>.*?)\s+(?P<kind>SV|WTY)(?:\s+(?P<problem>.*))?$", re.S)


def parse_order_detail(text: str) -> dict:
    """'REFRE LG LRFXC2606S 405KRQWKP980 SV There is a chip ... 9/4/2024' -> fields. Best effort; raw always kept."""
    out = {"category": None, "install_type": None, "brand": None, "model": None, "serial": None, "problem_text": None, "raw_detail": text or None}
    if not text:
        return out
    m = _DETAIL_RE.match(text.strip())
    if not m:
        out["problem_text"] = text.strip()[:2000]
        return out
    cat = m.group("cat")
    tokens = m.group("rest").split()
    out["category"], out["install_type"] = CATEGORY.get(cat, (cat.lower(), None))
    if tokens:
        out["brand"] = tokens[0]
    if len(tokens) >= 3:
        out["model"] = " ".join(tokens[1:-1])[:60]
        out["serial"] = tokens[-1][:60]
    elif len(tokens) == 2:
        out["model"] = tokens[1][:60]
    out["problem_text"] = (m.group("problem") or "").strip()[:2000] or None
    out["kind"] = m.group("kind")
    return out


def parse_date(v) -> Optional[str]:
    """m/d/yyyy, yyyy-mm-dd, datetime/date -> 'yyyy-mm-dd' or None."""
    if v in (None, ""):
        return None
    if isinstance(v, _dt.datetime):
        return v.date().isoformat()
    if isinstance(v, _dt.date):
        return v.isoformat()
    s = str(v).strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y-%m-%d %H:%M:%S"):
        try:
            return _dt.datetime.strptime(s[:19], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_money(v) -> Optional[float]:
    if v in (None, ""):
        return None
    try:
        return round(float(str(v).replace("$", "").replace(",", "")), 2)
    except ValueError:
        return None


def parse_float(v) -> Optional[float]:
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def digits(phone) -> str:
    return re.sub(r"\D", "", str(phone or ""))


def clean_phone(v) -> Optional[str]:
    """'(512) 970-8938 HIS' -> '(512) 970-8938'. Keeps only the first 10-digit number."""
    d = digits(v)
    if len(d) >= 10:
        d = d[-10:] if len(d) == 11 and d[0] == "1" else d[:10]
        return f"({d[:3]}) {d[3:6]}-{d[6:]}"
    return None


def split_name(name: str) -> tuple[Optional[str], Optional[str], str]:
    """ePASS ship names: 'KELLI & KEVIN LASSITER', 'HUCKABY NEAL & ELAINE' (invoice export is LAST FIRST).
    Returns (first, last, display). Display is title-cased."""
    n = re.sub(r"\s+", " ", (name or "").strip())
    if not n:
        return None, None, ""
    disp = _title(n)
    parts = n.split(" ")
    if len(parts) == 1:
        return None, disp, disp
    return _title(" ".join(parts[:-1])), _title(parts[-1]), disp


def _title(s: str) -> str:
    return " ".join(w if w in ("&", "LLC", "HOA", "II", "III") else w.capitalize() for w in s.split(" "))


def tech_row_for(db: DB, code: Optional[str]) -> Optional[dict]:
    """Resolve an SP/Truck code to a tech row by sp_code or alias (KJB2 -> KJB, VJ -> VWJ)."""
    code = (code or "").strip().upper()
    if not code:
        return None
    r = db.fetchone("SELECT tech_id, sp_code, aliases FROM tech WHERE sp_code=?", (code,))
    if r:
        return r
    for t in db.fetchall("SELECT tech_id, sp_code, aliases FROM tech WHERE aliases IS NOT NULL"):
        if code in [a.strip().upper() for a in (t["aliases"] or "").split(",")]:
            return t
    return None


def tech_id_for(db: DB, code: Optional[str]) -> Optional[int]:
    r = tech_row_for(db, code)
    return r["tech_id"] if r else None


def canonical_code(db: DB, code: Optional[str]) -> Optional[str]:
    """Canonical sp_code when the code is known, else the raw code (kept so unknown trucks stay visible)."""
    code = (code or "").strip() or None
    if not code:
        return None
    r = tech_row_for(db, code)
    return r["sp_code"] if r else code


def ensure_zone(db: DB, code: Optional[str]) -> Optional[str]:
    """Unknown Map Zone codes are added as office_only with needs_review=1 (spec §3.3)."""
    code = (code or "").strip()
    if not code:
        return None
    if not db.fetchone("SELECT 1 FROM zone WHERE zone_code=?", (code,)):
        db.insert("zone", {"zone_code": code, "zone_group": "Unassigned", "booking_mode": "office_only", "primary_tech": None,
                           "secondary_techs": None, "centroid_lat": None, "centroid_lng": None, "km_from_shop": None,
                           "trip_tech": None, "notes": "auto-added by import; assign a group", "needs_review": 1})
    return code


def zone_for_zip(db: DB, zip_code: Optional[str]) -> Optional[str]:
    z = (zip_code or "").strip()[:5]
    if not z:
        return None
    r = db.fetchone("SELECT zone_code FROM zip_zone WHERE zip=?", (z,))
    return r["zone_code"] if r else None


def find_or_create_customer(db: DB, *, name: str, phone: Optional[str], alt_phone: Optional[str], email: Optional[str], epass_code: Optional[str], now: str) -> int:
    """Match by ePASS customer code, then by primary phone digits. Otherwise create."""
    phone = clean_phone(phone)
    alt_phone = clean_phone(alt_phone)
    email = (email or "").strip()[:120] or None
    row = None
    if epass_code:
        row = db.fetchone("SELECT * FROM customer WHERE epass_customer_code=?", (str(epass_code).strip(),))
    if row is None and phone:
        row = db.fetchone("SELECT * FROM customer WHERE phone_primary=? OR phone_alt=?", (phone, phone))
    if row:
        fill = {}
        if not row.get("email") and email:
            fill["email"] = email
        if not row.get("phone_alt") and alt_phone and alt_phone != row.get("phone_primary"):
            fill["phone_alt"] = alt_phone
        if not row.get("epass_customer_code") and epass_code:
            fill["epass_customer_code"] = str(epass_code).strip()
        if fill:
            fill["updated_at"] = now
            db.update("customer", {"customer_id": row["customer_id"]}, fill)
        return row["customer_id"]
    first, last, disp = split_name(name)
    return db.insert("customer", {
        "first_name": first, "last_name": last, "display_name": disp, "phone_primary": phone, "phone_alt": alt_phone, "email": email,
        "contact_pref": None, "stripe_customer_id": None, "is_landlord": 0, "is_property_manager": 0,
        "epass_customer_code": str(epass_code).strip() if epass_code else None, "notes": None, "created_at": now, "updated_at": now,
    })


def find_or_create_address(db: DB, customer_id: int, *, line1, line2, city, state, zip_code, lat, lng, directions, zone_code) -> Optional[int]:
    line1 = (line1 or "").strip()[:120]
    if not line1:
        return None
    zip5 = (str(zip_code or "").strip())[:10]
    row = db.fetchone("SELECT * FROM address WHERE customer_id=? AND UPPER(line1)=? AND zip=?", (customer_id, line1.upper(), zip5))
    if row:
        fill = {}
        if row.get("lat") is None and lat is not None:
            fill.update({"lat": lat, "lng": lng, "geocode_source": "epass"})
        if not row.get("access_notes") and directions:
            fill["access_notes"] = directions[:2000]
        if not row.get("zone_code") and zone_code:
            fill["zone_code"] = zone_code
        if fill:
            db.update("address", {"address_id": row["address_id"]}, fill)
        return row["address_id"]
    return db.insert("address", {
        "customer_id": customer_id, "line1": _title(line1), "line2": _title((line2 or "").strip()[:60]) or None, "city": _title((city or "").strip()[:60]) or None,
        "state": (state or "").strip()[:2] or None, "zip": zip5 or None, "lat": lat, "lng": lng, "geocode_source": "epass" if lat is not None else None,
        "gate_code": None, "access_notes": (directions or "").strip()[:2000] or None, "zone_code": zone_code,
    })


def upsert_unit(db: DB, job_id: int, parsed: dict, *, model=None, serial=None, brand=None) -> None:
    """One unit per job in Phase 0. Fill blanks only."""
    row = db.fetchone("SELECT * FROM unit WHERE job_id=? ORDER BY unit_id", (job_id,))
    vals = {
        "category": parsed.get("category"), "install_type": parsed.get("install_type"), "brand": brand or parsed.get("brand"),
        "model": model or parsed.get("model"), "serial": serial or parsed.get("serial"), "problem_text": parsed.get("problem_text"), "raw_detail": parsed.get("raw_detail"),
    }
    if row is None:
        if any(v for v in vals.values()):
            db.insert("unit", dict(job_id=job_id, **vals))
        return
    fill = {k: v for k, v in vals.items() if v and not row.get(k)}
    if fill:
        db.update("unit", {"unit_id": row["unit_id"]}, fill)


KNOWN_FLAGS = ("WTY", "RCALL", "1ST", "VIP", "HOT", "RUSH", "COD", "AR")


def warranty_flags(priorities) -> tuple[Optional[str], int]:
    """DispatchTrack writes 'WTY,RCALL'; the invoice export concatenates the same flags as 'WTYRCALL'.
    Normalise both to a sorted comma list so the two imports never fight over the field."""
    flags: set[str] = set()
    for tok in re.split(r"[,\s;/]+", str(priorities or "").upper()):
        tok = tok.strip()
        while tok:
            hit = next((k for k in sorted(KNOWN_FLAGS, key=len, reverse=True) if tok.startswith(k)), None)
            if hit:
                flags.add(hit)
                tok = tok[len(hit):]
            else:
                flags.add(tok)
                break
    return (",".join(sorted(flags)) or None), (1 if "WTY" in flags else 0)


def compact_json(d: dict) -> str:
    return json.dumps({k: v for k, v in d.items() if v not in (None, "")}, ensure_ascii=False, default=str)

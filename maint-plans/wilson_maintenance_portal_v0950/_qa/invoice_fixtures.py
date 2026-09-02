#!/usr/bin/env python3
"""
Generates synthetic Wilson sales-invoice PDFs for testing invoice_parser.py.

Why synthetic rather than the real invoices
-------------------------------------------
Real Wilson invoices carry customer names, service addresses and phone numbers.
Those must not live in the repository. These fixtures reproduce the layout of
the real S00063887 / S00063887-1 / S00064425 invoices exactly -- same column
positions, same classification-line format, same area headings, same split
notice -- with invented households and products.

The layout matters more than the wording: invoice_parser.py reads
`extract_text(extraction_mode="layout")` and matches on column structure, so the
fixtures are laid out in Courier at the same character columns the real invoices
land on:

    col 1   quantity, right-aligned
    col 8   model number
    col 41  description (continuation lines align here too)
    col 44  BRAND, CLASSIFICATION, detail
    col 112 unit price, right-aligned
    col 128 extended price, right-aligned

Requires reportlab (`pip install reportlab`). Import `build_invoice` from a test,
or run this file directly to write the standard fixture set to a directory:

    python3 _qa/invoice_fixtures.py /tmp/fixtures
"""

from __future__ import annotations

import sys
from io import BytesIO

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
except ImportError:  # pragma: no cover - handled by the caller
    canvas = None

# Character-grid geometry. Courier at 7pt gives a 4.2pt advance, which puts the
# columns close enough to the real invoices for layout extraction to agree.
FONT = "Courier"
SIZE = 7.0
CHAR_W = SIZE * 0.6
LEFT = 24.0
TOP = 756.0
LINE_H = 9.0

COL_QTY_END = 4     # quantity is right-aligned to this column
COL_MODEL = 8
COL_DESC = 41
COL_CLASS = 44
COL_PRICE_END = 112
COL_EXT_END = 128


def _place(col):
    """Absolute x for a character column."""
    return LEFT + col * CHAR_W


class _Page:
    """Accumulates (column, text) pairs per line, then draws them."""

    def __init__(self):
        self.lines = []

    def line(self, *cells):
        self.lines.append(list(cells))

    def blank(self, n=1):
        for _ in range(n):
            self.lines.append([])


MAX_DESC = COL_PRICE_END - len("1,000.00") - COL_DESC - 2


def _row_cells(qty, model, description, price, ext):
    """One product row: qty / model / description / price / ext price.

    Descriptions longer than the description column collide with the price
    column, which merges them in layout extraction and makes the row invisible
    to ROW_RE. Real invoices wrap instead; pass the remainder as
    extra_description rather than letting it run into the price."""
    if len(description) > MAX_DESC:
        raise ValueError(
            f"description is {len(description)} chars, max {MAX_DESC} before it "
            f"collides with the price column -- wrap it with extra_description: "
            f"{description!r}")
    qty_text = str(qty)
    cells = [(COL_QTY_END - len(qty_text), qty_text)]
    if model:
        cells.append((COL_MODEL, model))
    cells.append((COL_DESC, description))
    price_text = str(price)
    ext_text = str(ext)
    cells.append((COL_PRICE_END - len(price_text), price_text))
    cells.append((COL_EXT_END - len(ext_text), ext_text))
    return cells


def build_invoice(
    invoice_number,
    line_groups,
    ship_to=("EXAMPLE HOUSEHOLD", "100 TEST RANCH RD", "AUSTIN, TX     78733"),
    split_reference=None,
    invoice_date="03/14/2026",
    salesperson="Test Salesperson",
    include_header=True,
    include_totals=True,
    include_terms=True,
):
    """
    Build one invoice PDF and return its bytes.

    line_groups is a list of (area_name_or_None, rows); each row is a dict:
        qty, model, description, classification, price, ext
        optional: extra_description (list of continuation lines), serial
    """
    if canvas is None:
        raise RuntimeError("reportlab is required to build invoice fixtures")

    page = _Page()
    page.blank(2)
    page.line((0, "4205 East Hwy 290"))
    page.line((0, "Dripping Springs, TX  78620"))
    page.line((0, "Phone: (512) 894 - 0907"))
    page.line((0, "Fax: (512) 829 - 4763"))
    page.line((0, "Bill To:"), (COL_DESC + 49, "Ship To:"), (COL_DESC + 62, "5125550000"))
    for index, ship_line in enumerate(ship_to):
        left = [(14, "Test Builder LLC")] if index == 0 else []
        page.line(*left, (COL_DESC + 62, ship_line))
    page.blank(2)
    page.line((9, "Customer #"), (30, "Payment Type"), (58, "Invoice Type"),
              (85, "Salesperson"), (COL_EXT_END - len(invoice_number), invoice_number))
    page.line((10, "5125550100"), (34, "COD"), (61, "SALES"), (85, salesperson),
              (COL_EXT_END - len(invoice_date), invoice_date))
    page.blank()
    page.line((1, "COMMENTS:"))
    page.blank(2)

    if include_header:
        page.line((1, "QTY"), (COL_MODEL + 8, "MODEL #"), (COL_DESC + 16, "DESCRIPTION"),
                  (COL_PRICE_END - 5, "PRICE"), (COL_EXT_END - 9, "EXT PRICE"))
        page.blank()

    if split_reference:
        page.line((COL_DESC, f"This Invoice has been split, further details on '  {split_reference}' !"))

    for area, rows in line_groups:
        if area:
            page.line((COL_DESC, f"***** {area.upper()} *****"))
        for row in rows:
            page.line(*_row_cells(row["qty"], row.get("model", ""), row["description"],
                                  row.get("price", "1,000.00"), row.get("ext", "1,000.00")))
            for extra in row.get("extra_description", []):
                page.line((COL_DESC, extra))
            if row.get("classification"):
                page.line((COL_CLASS, row["classification"]))
            if row.get("serial"):
                page.line((COL_CLASS, f"Serial # : {row['serial']}"))
            page.blank()

    # ---- the terms and totals block ---------------------------------------
    #
    # ON BY DEFAULT, because every real Wilson invoice has it and these fixtures
    # did not. That omission is why a real bug survived a 51-check suite: the
    # terms block was being appended to the last product's description, and one
    # of its lines reads "owners manual/installation guides" -- so the exclusion
    # phrase "install" matched and a real dryer was dropped as a support line.
    # No fixture could reproduce it, because no fixture had a footer.
    #
    # The asterisk-then-alignment-spaces shape matters as much as the wording:
    # the guard that was supposed to catch this tested
    # `startswith("*Above order")`, and layout extraction emits
    # "*      Above order". Writing these lines with the asterisk snug against
    # the text would make the fixture pass where a real invoice fails.
    if include_terms:
        page.line((COL_DESC + 4, "EXTENDED WARRANTY"), (COL_DESC + 45, "YES"),
                  (COL_DESC + 61, "NO"), (COL_DESC + 74, "REMOVAL OF OLD UNITS"),
                  (COL_EXT_END - 20, "YES"), (COL_EXT_END - 8, "NO"))
        for text in (
            "Above order confirmed with  no changes.",
            "All products remain the property of  Wilson's until paid in full.",
            "Please refer to owners manual/installation guides for important details.",
            "All authorized returned products will be subject to a 25% restocking charge.",
            "Special/Custom orders require minimum 50% deposit and can not be returned.",
            "Finance charges of 1.5% per month will be charged on overdue accounts.",
            "TACLB - 008513E",
        ):
            page.line((0, "*"), (7, text))

    if include_totals:
        page.line((COL_DESC + 30, "SUB TOTAL"), (COL_EXT_END - 8, "9,999.00"))
        page.line((COL_DESC + 30, "INVOICE TOTAL"), (COL_EXT_END - 8, "9,999.00"))
        page.line((0, "CUSTOMER SIGNATURE ________________________________"),
                  (COL_DESC + 30, "DEPOSITS"), (COL_EXT_END - 4, "0.00"))
        page.line((0, "(Customer has acknowledged above information)"),
                  (COL_DESC + 30, "BALANCE"), (COL_EXT_END - 8, "9,999.00"))

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    pdf.setFont(FONT, SIZE)
    y = TOP
    for cells in page.lines:
        for col, text in cells:
            pdf.drawString(_place(col), y, str(text))
        y -= LINE_H
        if y < 40:
            pdf.showPage()
            pdf.setFont(FONT, SIZE)
            y = TOP
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def product(qty, model, description, classification, **kwargs):
    row = {"qty": qty, "model": model, "description": description,
           "classification": classification}
    row.update(kwargs)
    return row


def customer_pickup():
    """A customer-pickup invoice: product lines only, no installation section.

    The shape Cayden hit. Every previous fixture either had an install line or
    no footer, so the terms block always landed somewhere harmless. Here the
    dryer is the LAST product, which is what puts the footer into its
    description -- and the dryer is the product whose description the "install"
    phrase then matched.

    Three products, all of which must survive.
    """
    return [(None, [
        product(1, "DW-PICKUP-1",
                "24in. Dishwasher, Pocket Handle, 39 dBA Sound Rating",
                "TESTBRAND, DISHWASHER, SS Pocket Handle",
                extra_description=["Water Softener, 18 Place Settings, Auto Dosing"],
                serial="TP-0001"),
        product(1, "WA-PICKUP-1",
                "24in. Front Load Smart Washer, 7 Series, 2.8 Cu. Ft.",
                "TESTBRAND, FRONT-LOAD WASHER, White",
                extra_description=["29 Wash Programs, 1,400 RPM, Steam Disinfection",
                                   "Aqua Safe System, Steel Seal, ADA Compliant"],
                serial="TP-0002"),
        product(1, "DR-PICKUP-1",
                "24in. Electric Smart Dryer, 7 Series, Vented, 5.2 Cu. Ft.",
                "TESTBRAND, ELECTRIC DRYER, White",
                extra_description=["20 Drying Programs, Bundle Guard, Butterfly Drying",
                                   "Multi-filter System, ADA Compliant, Energy Star"],
                serial="TP-0003"),
    ])]


# --- the standard fixture set -------------------------------------------------

def mapping_coverage():
    """One product per row of the INVOICE_IMPORT.md product-mapping table."""
    return [(None, [
        product(1, "BI36UFDID", "36in. Built-In French Door Refrigerator, Panel Ready",
                "SUBZERO, BUILT-IN REFRIGERATOR, Panel Ready", serial="SZ-1001"),
        product(1, "IC24FI", "24in. Column Freezer, Panel Ready",
                "SUBZERO, COLUMN FREEZER, Panel Ready"),
        product(1, "IW24W", "24in. Undercounter Wine Storage, Two Zone",
                "SUBZERO, WINE STORAGE, Stainless"),
        product(1, "UC15IPO", "15in. Undercounter Clear Ice Maker, Pump Included",
                "SUBZERO, ICE MAKER, Panel Ready"),
        product(1, "CT36GS", "36in. Gas Cooktop, Five Sealed Burners",
                "WOLF, COOKTOP, Stainless Steel"),
        product(1, "DF48650DG", "48in. Dual Fuel Range, Six Burners and Infrared Griddle",
                "WOLF, DUAL FUEL RANGE, Stainless Steel"),
        product(1, "DW2451", "24in. Panel Ready Dishwasher, Interior LED Lighting",
                "COVE, DISHWASHER, Panel Ready"),
        product(1, "PL462412", "46in. Pro Hood Liner Insert, Internal Blower Ready",
                "WOLF, HOOD LINER, Stainless Steel"),
        product(1, "SPO30TESTH", "30in. Convection Steam Oven with Speed Oven Mode",
                "WOLF, SPEED OVEN, Stainless Steel"),
        product(1, "SO30TESTH", "30in. Built-In Single Wall Oven, Convection",
                "WOLF, WALL OVEN, Stainless Steel"),
        product(1, "WWD30", "30in. Warming Drawer, Stainless Steel",
                "WOLF, WARMING DRAWER, Stainless Steel"),
        product(1, "EA24TEST", "24in. Built-In Coffee System, Plumbed",
                "MIELE, BUILT-IN COFFEE SYSTEM, Stainless"),
        product(1, "WM6500TEST", "27in. Front Load Washer, 5.0 Cu. Ft.",
                "LG, WASHER, White"),
        product(1, "DLEX6500T", "27in. Electric Dryer, 7.4 Cu. Ft.",
                "LG, DRYER, White"),
        product(1, "WKEX300TEST", "27in. Smart Electric WashTower, Single Unit",
                "LG, WASHTOWER, Black Steel"),
        product(1, "GMBR36TEST", "36in. Outdoor Grill, Two Burners, Rotisserie",
                "HESTAN, OUTDOOR GRILL, Stainless Steel"),
    ])]


def exclusion_coverage():
    """Support lines the parser must filter out, taken from the documented list."""
    return [(None, [
        product(1, "9029029", "24in. Designer Series UC Stainless Steel Solid Door Panel",
                "SUBZERO, PANEL, Stainless Tubular"),
        product(1, "", "Dishwasher w/Panel Install", ""),
        product(1, "", "Pro Package In-Home Delivery", ""),
        product(-1, "", "South Central Remodel Program", ""),
        product("Payment", "", "Payment Transfer", ""),
        product(1, "", "SS Dishwasher H2O Connect Kit", ""),
        product(1, "", "Washer Hoses (2) 5ft. SS", ""),
        product(1, "", "Dryer Cord", ""),
        product(1, "", "Dryer - SS Steam Kit", ""),
        product(1, "", "Dryer Vent Kit", ""),
        product(1, "", "Stainless Steel Gas Flex Line", ""),
        product(1, "", "Undercounter Anti-condensation Pad", ""),
        product(1, "", "Custom Front Panel Mounting Kit", ""),
        product(1, "", "48in. and 60in. Brushed Brass Knob Kit", ""),
        product(1, "", "4in. Toe Kick", ""),
        product(1, "", "1200 CFM Internal Blower Assembly for Pro Hoods", ""),
        product(1, "AGCKTEST", "Aspire Kit - LP Portable to LP Hard Piped Systems",
                "HESTAN, GAS CONVERSION KIT"),
        product(1, "QT48960T", "9' RUN - ARTESAN COLOR, BAHAUS CABINET",
                "URBAN BONFIRE, CABINETRY, Anthracite"),
    ])]


def area_coverage():
    """Area headings, including products before the first heading."""
    return [
        (None, [product(1, "BI36UFDIDX", "36in. Built-In Refrigerator, Panel Ready",
                        "SUBZERO, BUILT-IN REFRIGERATOR, Panel Ready")]),
        ("MAIN HOUSE", [product(1, "DW2451A", "24in. Panel Ready Dishwasher",
                                "COVE, DISHWASHER, Panel Ready")]),
        ("CASITA", [product(1, "DW2451B", "24in. Panel Ready Dishwasher",
                            "COVE, DISHWASHER, Panel Ready")]),
        ("POOL HOUSE", [product(1, "UC15IPOX", "15in. Undercounter Clear Ice Maker",
                                "SUBZERO, ICE MAKER, Panel Ready")]),
    ]


FIXTURES = {
    "S00099001.pdf": ("S00099001", mapping_coverage(), None),
    "S00099002.pdf": ("S00099002", exclusion_coverage(), None),
    "S00099003.pdf": ("S00099003", area_coverage(), "S00099003-1"),
    "S00099003-1.pdf": ("S00099003-1", [(None, [
        product(1, "MSER0990T", "1.0 Cu. Ft. Countertop Microwave, Stainless",
                "LG, MICROWAVE, Stainless Steel")])], "S00099003"),
    # Customer pickup: product lines only, no installation section, dryer last.
    "S00099004.pdf": ("S00099004", customer_pickup(), None),
}


def build_all():
    """Return {filename: pdf_bytes} for the standard fixture set."""
    out = {}
    for name, (number, groups, split) in FIXTURES.items():
        out[name] = build_invoice(number, groups, split_reference=split)
    return out


if __name__ == "__main__":
    from pathlib import Path
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/wilson_invoice_fixtures")
    target.mkdir(parents=True, exist_ok=True)
    for name, data in build_all().items():
        (target / name).write_bytes(data)
        print(f"wrote {target / name} ({len(data)} bytes)")

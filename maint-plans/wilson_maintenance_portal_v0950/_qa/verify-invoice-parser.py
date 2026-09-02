#!/usr/bin/env python3
"""
Regression tests for invoice_parser.py.

The parser is the only server-side component on a real production path -- it is
how an existing Wilson customer's appliance inventory gets built without manual
entry -- and it had no tests. This suite was written after running it against
the real S00063887 / S00063887-1 / S00064425 invoices for the first time.

Fixtures are synthetic (see _qa/invoice_fixtures.py): real invoices carry
customer names, addresses and phone numbers that must not live in the repo. The
fixtures reproduce the real column layout so the parser sees the same structure.

To additionally check against real invoices held outside the repo:

    WILSON_REAL_INVOICES=/path/to/folder python3 _qa/verify-invoice-parser.py

That run asserts only structural invariants -- no customer data is printed.

Skips cleanly (exit 0) if reportlab is unavailable:  pip install reportlab
"""

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "_qa"))

from invoice_parser import parse_invoice_files  # noqa: E402

failures = []
checks = 0


def check(label, got, want):
    global checks
    checks += 1
    ok = got == want
    if not ok:
        failures.append(f"{label}\n        got:  {got!r}\n        want: {want!r}")
    print(f"{'ok  ' if ok else 'FAIL'}  {label}")
    return ok


def note(label, value):
    print(f"      {label}: {value}")


def parse_one(name, data):
    return parse_invoice_files([(name, data)])


def config_category_ids():
    """Customer category ids straight from plan-config.js.

    Restating them here is how this assertion goes stale the moment a category
    is added -- which is exactly what happened when outdoor grills landed."""
    import json
    import subprocess
    script = (
        "const fs=require('fs'),vm=require('vm');const s={window:{}};"
        "vm.createContext(s);"
        f"vm.runInContext(fs.readFileSync({str(ROOT / 'assets' / 'plan-config.js')!r},'utf8'),s);"
        "process.stdout.write(JSON.stringify("
        "s.window.WILSON_CONFIG.customerApplianceCategories.map(c=>c.id)));"
    )
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def main():
    try:
        import invoice_fixtures as fx
        if fx.canvas is None:
            raise ImportError
    except ImportError:
        print("SKIP: reportlab is not installed (pip install reportlab)")
        return 0

    built = fx.build_all()

    # ---- the documented product-mapping table ------------------------------
    print("\n=== INVOICE_IMPORT.md product mapping ===")
    result = parse_one("S00099001.pdf", built["S00099001.pdf"])

    # ---- the invoice date, which is the only documented evidence of age ----
    # Age carries 25% of every health score. The parser extracted a date and
    # dropped it, so the technician typed an age from memory instead; now it
    # reaches the asset. High confidence means the date was found anchored to
    # the invoice number in the header, not merely somewhere near the top -- a
    # loose match could be a ship date, and a wrong install year moves a score
    # silently where a missing one is reported as unknown.
    dates = {i["invoiceDate"] for i in result["items"]}
    check("every line item carries the invoice date", dates, {"03/14/2026"})
    check("the date is anchored to the invoice number, not merely nearby",
          {i["invoiceDateConfidence"] for i in result["items"]}, {"high"})
    check("the install year is derived from it", {i["installYear"] for i in result["items"]}, {2026})

    got = [(i["exactType"], i["customerCategory"]) for i in result["items"]]
    want = [
        ("refrigerator", "refrigeration"),
        ("freezer", "refrigeration"),
        ("wine_beverage", "refrigeration"),
        ("ice_maker", "ice_maker"),
        ("cooktop", "cooktop"),
        ("range", "range"),
        ("dishwasher", "dishwasher"),
        ("hood_insert", "ventilation"),
        ("speed_oven", "microwave"),
        ("wall_oven", "ovens"),
        ("warming_drawer", "warming_drawer"),
        ("coffee_maker", "coffee"),
        ("washer", "washer"),
        ("dryer", "dryer"),
        ("laundry_center", "washer_dryer"),
        ("outdoor_grill", "outdoor_grill"),
    ]
    check("every documented product maps to its exact type and category", got, want)
    check("nothing in the mapping fixture is wrongly excluded", len(result["ignored"]), 0)

    brands = sorted({i["brand"] for i in result["items"]})
    check("brand names are normalised through BRAND_MAP",
          brands, ["Cove", "Hestan", "Lg", "Miele", "Sub-Zero", "Wolf"])

    # Grills used to reach the review queue with no valid category to assign.
    grill = next(i for i in result["items"] if i["exactType"] == "outdoor_grill")
    check("an outdoor grill classifies instead of needing review",
          grill["customerCategory"], "outdoor_grill")
    check("the grill carries the no-cleaning scope note",
          any("cleaning is never included" in n.lower() for n in grill.get("notes", [])), True)
    check("no product on the mapping fixture needs manual classification",
          [i["model"] for i in result["items"] if i["customerCategory"] == "review"], [])

    serials = [i["serial"] for i in result["items"] if i["serial"]]
    check("a printed Serial # is captured", serials, ["SZ-1001"])

    # A WashTower is two maintained assets: priced, labelled, scheduled and
    # (since v0.9.4) protocol-resolved as a washer plus a dryer.
    tower = next(i for i in result["items"] if i["exactType"] == "laundry_center")
    check("a WashTower expands to a washer and a dryer", tower["expandTo"], ["washer", "dryer"])
    check("expandedAssetCount counts the split halves",
          result["expandedAssetCount"], len(result["items"]) + 1)

    # ---- exclusions --------------------------------------------------------
    print("\n=== documented exclusions ===")
    result = parse_one("S00099002.pdf", built["S00099002.pdf"])
    check("every support line is excluded", len(result["items"]), 0)
    check("all excluded lines are reported", len(result["ignored"]), 18)
    reasons = {i["description"]: i["reason"] for i in result["ignored"]}
    for description in ("Dryer Cord", "Washer Hoses (2) 5ft. SS", "4in. Toe Kick",
                        "Custom Front Panel Mounting Kit",
                        "1200 CFM Internal Blower Assembly for Pro Hoods"):
        check(f"excluded: {description}", description in reasons, True)
    check("a negative-quantity credit line is excluded",
          any("payment, or credit" in r for r in reasons.values()), True)
    check("gas conversion kits are excluded (seen on S00063887)",
          any("conversion kit" in r for r in reasons.values()), True)
    check("cabinetry is excluded (seen on S00064425)",
          any("cabinetry" in r for r in reasons.values()), True)

    # ---- areas and split invoices ------------------------------------------
    print("\n=== areas and split invoices ===")
    result = parse_invoice_files([
        ("S00099003.pdf", built["S00099003.pdf"]),
        ("S00099003-1.pdf", built["S00099003-1.pdf"]),
    ])
    check("both invoice numbers are recorded",
          result["invoiceNumbers"], ["S00099003", "S00099003-1"])
    check("the split reference is captured",
          sorted(result["splitReferences"]), ["S00099003", "S00099003-1"])
    check("printed area headings become areas",
          result["areas"],
          ["Unassigned — Review", "Main House", "Casita", "Pool House"])
    by_model = {i["model"]: i["area"] for i in result["items"]}
    check("a product under a heading takes that area", by_model["DW2451B"], "Casita")
    check("a product printed before any heading is never guessed at",
          by_model["BI36UFDIDX"], "Unassigned — Review")
    check("an unsectioned split file is never guessed at",
          by_model["MSER0990T"], "Unassigned — Review")
    check("combining files is disclosed",
          any("combined into one" in w for w in result["warnings"]), True)
    check("unassigned products are disclosed",
          any("Unassigned" in w for w in result["warnings"]), True)

    # ---- unreadable input ---------------------------------------------------
    # ---- a missing date is reported, never invented ----
    import invoice_parser as _p
    check("an unparseable date yields no install year", _p._install_year(""), None)
    check("and neither does a malformed one", _p._install_year("13/2026"), None)
    check("an out-of-range year is rejected", _p._install_year("01/01/1849"), None)
    check("a plausible year is accepted", _p._install_year("03/14/2026"), 2026)
    no_anchor = _p._invoice_date(["Wilson AC & Appliance", "no dates here"], "S00099001", "no dates at all")
    check("no date anywhere is reported as none", no_anchor, ("", "none"))
    loose = _p._invoice_date(["some header 04/02/2020", "S00099001"], "", "some header 04/02/2020")
    check("a date found without the invoice-number anchor is low confidence",
          loose[1], "low")

    # ---- a customer pickup: product lines only -----------------------------
    #
    # Cayden, testing a real invoice: "it did not recognize the dryer and
    # determined it was an install/ support line... this example is a customer
    # pickup where only product existed on the invoice."
    #
    # The cause was one layer below his guess. The invoice's TERMS BLOCK was
    # being appended to the last product's description, and one of its lines
    # reads "owners manual/installation guides" -- so the exclusion phrase
    # "install" matched and the dryer was dropped.
    #
    # There had been a guard: `startswith("*Above order")`. Layout extraction
    # emits "*      Above order" -- asterisk, six spaces -- so it never fired.
    # On invoices WITH an install section the swallowed footer landed on a line
    # already being excluded, which is why it stayed invisible.
    #
    # And no fixture could have caught it, because no fixture had a footer at
    # all. That is fixed too: the terms block is now on by default, so every
    # case in this suite runs against an invoice shaped like a real one.
    print("\n=== a customer pickup, product lines only ===")
    pickup = parse_invoice_files([("S00099004.pdf", fx.build_invoice("S00099004", fx.customer_pickup()))])
    kept = [item["exactTypeLabel"] for item in pickup["items"]]
    note("kept", ", ".join(kept))
    check("all three products survive an invoice with no install section",
          len(pickup["items"]), 3)
    check("and the dryer in particular is not read as an install line",
          any("dryer" in label.lower() for label in kept), True)
    check("nothing at all is excluded", pickup["ignored"], [])
    # The footer must not be IN the description either -- a dryer whose printed
    # description carries Wilson's payment terms is a record nobody can read.
    dryer = next(i for i in pickup["items"] if "dryer" in i["exactTypeLabel"].lower())
    for phrase in ("installation guides", "restocking", "EXTENDED WARRANTY",
                   "REMOVAL OF OLD UNITS", "property of"):
        check(f"  the terms line {phrase!r} is not in the product description",
              phrase.lower() in dryer["description"].lower(), False)

    print("\n=== the footer guard is whitespace-tolerant ===")
    #
    # The fixture is only worth anything if it reproduces the SHAPE that broke
    # the guard: an asterisk, then alignment spaces, then the text. Written snug
    # ("*Above order") the fixture would pass where a real invoice fails, so the
    # extracted text is checked rather than assumed.
    #
    # This replaces a tautology -- `b"Above order" in snug or True` -- which
    # asserted nothing at all. An assertion that cannot fail is worse than none,
    # because it reads like coverage.
    from io import BytesIO
    from pypdf import PdfReader
    pickup_pdf = fx.build_invoice("S00099005", fx.customer_pickup())
    pages = PdfReader(BytesIO(pickup_pdf)).pages
    layout = "\n".join((p.extract_text(extraction_mode="layout") or "") for p in pages)
    terms_lines = [l for l in layout.splitlines() if "Above order" in l]
    check("the fixture's terms block survives layout extraction", len(terms_lines), 1)
    check("and carries the asterisk-then-spaces shape the old guard missed",
          bool(re.match(r"^\*\s{2,}Above order", terms_lines[0].strip()))
          if terms_lines else False, True)
    check("so a snug-asterisk guard would NOT have matched it",
          terms_lines[0].strip().startswith("*Above order") if terms_lines else True, False)
    # And the parser's own detector must handle both spellings.
    from invoice_parser import _is_footer_line
    for line in ("*      Above order confirmed with  no changes.",
                 "*Above order confirmed with no changes.",
                 "EXTENDED WARRANTY      YES      NO      REMOVAL OF OLD UNITS",
                 "*      Please refer to owners manual/installation guides"):
        check(f"  footer detected: {line.strip()[:44]!r}", _is_footer_line(line), True)
    check("  a real product line is not mistaken for footer",
          _is_footer_line("24in. Electric Smart Dryer, 7 Series, Vented"), False)

    # ---- what the word-boundary change does and does not buy -----------------
    #
    # Boundaries are strictly safer than a bare substring and cost nothing, so
    # they stay. But it is worth being straight about their reach: with the
    # footer no longer reaching the description blob, "install" has nothing left
    # to collide with in practice, and reverting to `phrase in blob` does not
    # break any test here. The observable fix for Cayden's dryer is the footer
    # repair above; this is defence in depth.
    #
    # It is asserted directly rather than through the parser because the only way
    # to exercise it end-to-end would be to invent a product line -- and my first
    # attempt at that ("Installation-Ready Panel", "Pre-Installed Water Line")
    # proved the hazard runs the other way: I had added "installs" and
    # "installed" to the phrase list guessing at coverage, and "installed" threw
    # out a legitimate refrigerator. Both invented phrases are gone. The list now
    # holds only forms a real Wilson invoice has been seen to use.
    check("'install' no longer matches inside 'installation guides'",
          bool(re.search(r"\binstall\b", "owners manual/installation guides")), False)
    check("but it still matches a real install line",
          bool(re.search(r"\binstall\b", "install dishwasher")), True)
    check("and 'installation' still matches its own line",
          bool(re.search(r"\binstallation\b", "installation labor")), True)

    # A corrupt file used to raise out of parse_invoice_files, which the server
    # turned into one failed request -- discarding every good file uploaded with
    # it. Split invoices mean multi-file uploads are the norm.
    print("\n=== unreadable and malformed input ===")
    good = built["S00099001.pdf"]
    for label, payload in (("empty file", b""),
                           ("not a PDF", b"this is plainly not a pdf"),
                           ("truncated PDF", good[:400])):
        result = parse_one("broken.pdf", payload)
        check(f"{label}: reports failure instead of raising", result["ok"], False)
        check(f"{label}: names the file that could not be read",
              result["unreadableFiles"], ["broken.pdf"])

    result = parse_invoice_files([("broken.pdf", b"garbage"),
                                  ("S00099001.pdf", good)])
    check("one bad file does not discard the good ones",
          len(result["items"]), len(want))
    check("the bad file is still named", result["unreadableFiles"], ["broken.pdf"])
    check("the skip is surfaced as a warning",
          any("could not be read" in w for w in result["warnings"]), True)

    result = parse_invoice_files(iter([("S00099001.pdf", good)]))
    check("a generator of files is accepted", result["sourceFiles"], ["S00099001.pdf"])

    result = parse_invoice_files([])
    check("no files at all is not an error", result["ok"], True)
    check("no files yields no items", result["items"], [])

    result = parse_one("empty.pdf", fx.build_invoice("S00099020", [(None, [])]))
    check("a well-formed invoice with no products yields no items",
          (result["ok"], len(result["items"])), (True, 0))

    result = parse_one("noheader.pdf", fx.build_invoice(
        "S00099021",
        [(None, [fx.product(1, "BI36", "36in. Built-In Refrigerator",
                            "SUBZERO, BUILT-IN REFRIGERATOR, Panel")])],
        include_header=False))
    check("a PDF with no QTY/MODEL/DESCRIPTION header yields no items",
          len(result["items"]), 0)

    result = parse_one("S00099022.pdf", fx.build_invoice(
        "S00099022",
        [(None, [fx.product(1, "BI36", "36in. Built-In Refrigerator",
                            "SUBZERO, BUILT-IN REFRIGERATOR, Panel",
                            price="-500.00", ext="-500.00")])]))
    check("a negative price does not break the row", len(result["items"]), 1)

    # ---- optional: real invoices held outside the repo ----------------------
    real_dir = os.environ.get("WILSON_REAL_INVOICES")
    if real_dir and Path(real_dir).is_dir():
        print(f"\n=== real invoices from {real_dir} (structure only) ===")
        pdfs = sorted(Path(real_dir).glob("*.pdf"))
        note("files", len(pdfs))
        result = parse_invoice_files([(p.name, p.read_bytes()) for p in pdfs])
        check("real invoices parse", result["ok"], True)
        check("real invoices yield products", len(result["items"]) > 0, True)
        check("no real product is left unreadable", result["unreadableFiles"], [])
        emitted = {i["customerCategory"] for i in result["items"]}
        sentinels = {"review", "washer_dryer"}
        unknown = emitted - sentinels - set(config_category_ids())
        check("no unknown customer category is emitted", unknown, set())
        note("categories seen", len(emitted))
        note("products", len(result["items"]))
        note("support lines excluded", len(result["ignored"]))
    elif real_dir:
        note("WILSON_REAL_INVOICES set but not a directory", real_dir)

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S) of {checks} checks:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"ALL {checks} INVOICE PARSER CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())

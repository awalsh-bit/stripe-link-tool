"""Load the seven-file ODBC export from ePASS — the complete back catalogue.

    python -m wilson_service load-full --dir /path/to/EPASS_FULL_EXPORT_20260917_0729

| file | rows | what it adds |
|---|---|---|
| `01_Customers.csv` | 47,006 | richer customer record: DoNotService, CreditHold, AccountType, PreferredContact |
| `02_Invoice_Master.csv` | 194,583 | every invoice — SV 92,936, S 68,966, WTY 25,335 |
| `03_Sales_Appliance_Lines.csv` | 121,210 | what was sold, per model line |
| `04_Sales_Serials.csv` | 124,922 | serials issued — **101,290 distinct** |
| `05_Service_History.csv` | 117,662 | the service record **with complaint and repair detail** |
| `06_Service_Parts.csv` | 110,655 | every part line, 99% `Installed=True` |
| `07_Service_Labor.csv` | 116,829 | technician code **and full name**, service date, trip number |

This runs *after* `history.py`, which owns customer identity (§1.4): households, payers, assets and the
address/surname resolution all stay exactly as that importer decided them. This one adds detail and
links it on, so re-running it never re-decides who a ticket belongs to.

Four things worth knowing before reading the code:

**The complaint taxonomy was abandoned.** `SvcComplaintCode` is filled on 1,394 of 117,662 rows (1.2%);
the real content is `SvcComplaintDesc`, free text, 98.2% filled and 92,786 distinct. `SvcProductCode`
is the usable axis instead: 96% filled, 117 clean values. Anything that groups symptoms groups on
product code plus normalised text, never on the complaint code.

**`FailureCode` is empty across all 110,655 part lines**, so a part links to a symptom only through
`item_desc` and the ticket's complaint text.

**`TimeCharged` is not a duration.** 21% filled, the unit column says "Minutes" on every row, median
0.52, maximum 740. It is a billing field with mixed units. It is loaded verbatim with its unit flag
and must not be used as on-site time — that still comes from the field tool (§4.1a).

**Serials tie service back to sales.** 47,991 of the 95,410 service tickets carrying a serial (50.3%)
are on a unit we sold, which is where `asset.purchased_from_us`, `purchase_date` and `purchase_price`
come from.
"""
from __future__ import annotations

import csv
import datetime as _dt
import os
import re
from typing import Iterable, Optional

from ..db import DB, now_iso

csv.field_size_limit(10 ** 7)

FILES = {
    "customers": "01_Customers.csv",
    "invoices": "02_Invoice_Master.csv",
    "sale_lines": "03_Sales_Appliance_Lines.csv",
    "sale_serials": "04_Sales_Serials.csv",
    "service": "05_Service_History.csv",
    "parts": "06_Service_Parts.csv",
    "labor": "07_Service_Labor.csv",
}
SALE_TYPES = {"S", "R", "AC", "CAB"}          # the rest of InvTypeCode is SV / WTY


def d(v) -> Optional[str]:
    """ePASS writes 'MM/DD/YYYY 00:00:00'. 12/30/1899 is its null date."""
    s = (v or "").strip()
    if not s:
        return None
    try:
        day = _dt.datetime.strptime(s[:10], "%m/%d/%Y").date()
    except ValueError:
        try:
            day = _dt.date.fromisoformat(s[:10])
        except ValueError:
            return None
    return None if day.year < 1901 else day.isoformat()


def m(v) -> Optional[float]:
    try:
        return round(float(str(v or "").replace(",", "").replace("$", "")), 4)
    except ValueError:
        return None


def i(v) -> Optional[int]:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def b(v) -> int:
    return 1 if str(v or "").strip().lower() in ("true", "1", "yes", "y") else 0


def t(v, n=None) -> Optional[str]:
    s = (v or "").strip()
    if not s:
        return None
    return s[:n] if n else s


_MANGLED = re.compile(r"(?<=[A-Za-z])\?(?=[A-Za-z])")


def tidy(s: Optional[str]) -> Optional[str]:
    """ePASS lost its apostrophes somewhere upstream: the export literally contains "Won?t stop
    running" and "I?d like". The files are valid UTF-8, so this is not a decoding fault on our side and
    the stored text is left exactly as exported — it is only repaired for display, and only where a
    question mark sits between two letters, which a real one never does."""
    return _MANGLED.sub("'", s) if s else s


def norm_serial(s) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


# ---------------------------------------------------------------- model families ⟨Cayden 9/17⟩
# "SHV78 and SHP78 are the same dishwasher with different handle styles." An exact-model lookup sees 22
# calls on SHP78CM5N; the family sees ~120 across SHP78 / SHV78 / SHX78 and every production index
# (/22, /25, /28...). So Model Insight works in three tiers — exact model, family, brand+product type —
# and the family key comes from a small rule table, first match wins:
#
#   (brand regex, product-code regex, model regex, family template)
#
# The default is the widest rule that is still honest for most brands: the leading letters plus the first
# digit run (WRF555SDFZ -> WRF555, GNE27JYMFS -> GNE27, PRD48WDSGU -> PRD48, DWHD870WPR -> DWHD870); a model
# that starts with digits keeps the digits and the letters right after them (648PRO, 700TC, BI-36U -> BI36U).
# Anything after "/" is a production index and is dropped first. Brand-specific rules go above the default —
# Bosch's third letter is the handle (P pocket, V panel-ready, X bar, E recessed, S scoop) and the two or
# three digits after it are the series, so SH?78 is the family. Agility should hold this list in a table the
# office can edit (spec §1.7); the seed is here so Phase 0 and the prototypes agree on the key.
MODEL_FAMILY_RULES = [
    # Bosch / Thermador / Gaggenau dishwashers: SH + handle letter + (M) + series digits
    (r"^(BOSCH|BOS|THERM|GAGG)", r"^DW", r"^SH[A-Z](M?)(\d{2,3})", "SH?{1}{2}"),
    # Bosch's newer dishwashers: SH?7PT.., SH?9PC.. — one digit then a two-letter tier code
    (r"^(BOSCH|BOS)", r"^DW", r"^SH[A-Z](\d)([A-Z]{2})", "SH?{1}{2}"),
]


def _norm_model(model: str) -> str:
    m = (model or "").upper().split("/")[0]          # /25 etc. is a production index, not a model
    return re.sub(r"[^A-Z0-9]", "", m)


def model_family(brand: str, product_code: str, model: str) -> dict:
    """-> {'key': 'BOSCH|DW|SH?78', 'stem': 'SH?78', 'rule': 'bosch-dw' | 'default' | 'none'}.
    The key carries brand and product code so a WP 'WRF555' never meets a KA 'WRF555'."""
    b, pc, m = (brand or "").strip().upper(), (product_code or "").strip().upper(), _norm_model(model)
    if not m:
        return {"key": "", "stem": "", "rule": "none"}
    for i, (rb, rp, rm, tpl) in enumerate(MODEL_FAMILY_RULES):
        if re.search(rb, b) and re.search(rp, pc):
            mm = re.match(rm, m)
            if mm:
                stem = tpl
                for g in range(1, (mm.lastindex or 0) + 1):
                    stem = stem.replace("{%d}" % g, mm.group(g) or "")
                return {"key": f"{b}|{pc}|{stem}", "stem": stem, "rule": f"rule-{i + 1}"}
    mm = re.match(r"^([A-Z]+)(\d+)", m)
    if mm:
        stem = mm.group(1) + mm.group(2)
    else:
        mm = re.match(r"^(\d+)([A-Z]{0,3})", m)
        stem = (mm.group(1) + mm.group(2)) if mm else m
    return {"key": f"{b}|{pc}|{stem}", "stem": stem, "rule": "default"}


def rows(path: str) -> Iterable[dict]:
    with open(path, encoding="utf-8-sig", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            yield r


class FullResult:
    def __init__(self):
        self.counts: dict = {}

    def __repr__(self):
        return "<FullResult " + " ".join(f"{k}={v:,}" for k, v in self.counts.items()) + ">"


# ---------------------------------------------------------------------------- techs


def load_techs(db: DB, path: str, now: str) -> int:
    """`07_Service_Labor` is the only place the technician *names* live — 51 codes, every one named.
    Existing tech rows keep their routing configuration; this only fills the name and the lifecycle
    dates, so a retired tech still resolves on twenty-year-old tickets (team item 40)."""
    seen: dict = {}
    for r in rows(path):
        c = t(r.get("TechnicianCode"), 8)
        if not c:
            continue
        e = seen.setdefault(c, {"name": None, "first": None, "last": None, "n": 0})
        e["n"] += 1
        if not e["name"]:
            e["name"] = t(r.get("TechnicianDesc"), 80)
        sd = d(r.get("ServiceDate"))
        if sd:
            if not e["first"] or sd < e["first"]:
                e["first"] = sd
            if not e["last"] or sd > e["last"]:
                e["last"] = sd
    today = now[:10]
    for c, e in seen.items():
        stale = True
        if e["last"]:
            try:
                stale = (_dt.date.fromisoformat(today) - _dt.date.fromisoformat(e["last"])).days > 180
            except ValueError:
                pass
        life = "historical" if stale else "active"
        ex = db.fetchone("SELECT tech_id, name FROM tech WHERE sp_code=?", (c,))
        if ex:
            db.execute("UPDATE tech SET name=COALESCE(name,?), first_service=?, last_service=?,"
                       " lifecycle=?, ended_on=? WHERE tech_id=?",
                       (e["name"], e["first"], e["last"], life,
                        e["last"] if life == "historical" else None, ex["tech_id"]))
        else:
            db.insert("tech", {"sp_code": c, "name": e["name"], "active": 0,
                               "first_service": e["first"], "last_service": e["last"],
                               "lifecycle": life, "ended_on": e["last"] if life == "historical" else None})
    return len(seen)


# ---------------------------------------------------------------------------- service detail


def load_service_detail(db: DB, path: str) -> int:
    cols = ["sv_number", "complaint_desc", "complaint_code", "performed_desc", "performed_code",
            "repair_code", "repair_category", "repair_severity", "product_code", "product", "brand_code",
            "model", "serial", "date_purchased", "in_warranty", "warranty_kind", "contract", "agreement_no",
            "call_sequence", "void", "request_id", "item_total", "labor_total", "misc_total",
            "trip_charge", "wty_total"]
    have = {r["sv_number"] for r in db.fetchall("SELECT sv_number FROM service_detail")}

    def gen():
        for r in rows(path):
            sv = t(r.get("ServiceInvoice"), 20)
            if not sv or sv in have:
                continue
            have.add(sv)
            yield (sv, t(r.get("SvcComplaintDesc")), t(r.get("SvcComplaintCode"), 20),
                   t(r.get("SvcPerformedDesc")), t(r.get("SvcPerformedCode"), 20),
                   t(r.get("SvcRepairCode"), 20), t(r.get("SvcRepairCategory"), 30),
                   t(r.get("SvcRepairCatMinorMajor"), 10), t(r.get("SvcProductCode"), 12),
                   t(r.get("SvcProduct"), 40), t(r.get("SvcBrandCode"), 20),
                   t(r.get("SvcModel"), 60), t(r.get("SvcSerial"), 60), d(r.get("SvcDatePurchased")),
                   t(r.get("SvcInWarranty"), 24), t(r.get("Warranty"), 40), t(r.get("SvcContract"), 40),
                   t(r.get("SvcAgreementNumber"), 40), i(r.get("CallSequence")), b(r.get("Void")),
                   t(r.get("ServiceRequestID"), 40), m(r.get("ItemTotal")), m(r.get("LaborTotal")),
                   m(r.get("MiscTotal")), m(r.get("TripChargeAmount")), m(r.get("WtyTotal")))
    return db.insert_many("service_detail", cols, gen())


def load_parts(db: DB, path: str) -> int:
    cols = ["sv_number", "epass_line_id", "trip_no", "item_code", "item_desc", "qty_ordered", "qty_shipped",
            "selling_price", "line_total", "unit_cost", "warranty", "installed", "part_status",
            "supplier_code", "bin_location", "created_date"]

    def gen():
        for r in rows(path):
            sv = t(r.get("ServiceInvoice"), 20)
            if not sv:
                continue
            yield (sv, t(r.get("PartLineID"), 20), i(r.get("TripNo")), t(r.get("ItemCode"), 40),
                   t(r.get("ItemDesc"), 120), m(r.get("QtyOrdered")), m(r.get("QtyShipped")),
                   m(r.get("SellingPrice")), m(r.get("Total")), m(r.get("UnitCost")),
                   t(r.get("Warranty"), 8), b(r.get("Installed")), t(r.get("PartStatus"), 20),
                   t(r.get("SupplierCode"), 20), t(r.get("LocationCode"), 20), d(r.get("DateCreated")))
    return db.insert_many("service_part", cols, gen())


def load_labor(db: DB, path: str) -> int:
    cols = ["sv_number", "epass_line_id", "trip_no", "service_date", "tech_code", "tech_name",
            "labor_rate_code", "labor_desc", "time_charged", "time_unit", "rate", "line_total",
            "cost", "warranty", "trip_charge", "trip_charge_amt"]

    def gen():
        for r in rows(path):
            sv = t(r.get("ServiceInvoice"), 20)
            if not sv:
                continue
            yield (sv, t(r.get("LaborLineID"), 20), i(r.get("TripNo")), d(r.get("ServiceDate")),
                   t(r.get("TechnicianCode"), 8), t(r.get("TechnicianDesc"), 80),
                   t(r.get("LaborRateCode"), 20), t(r.get("LaborDescription"), 120),
                   m(r.get("TimeCharged")), t(r.get("HdthsMin"), 12), m(r.get("Rate")),
                   m(r.get("Total")), m(r.get("Cost")), t(r.get("Warranty"), 8),
                   b(r.get("TripCharge")), m(r.get("TripChargeAmt")))
    return db.insert_many("service_labor", cols, gen())


# ---------------------------------------------------------------------------- sales


def load_sales(db: DB, inv_path: str, line_path: str, serial_path: str) -> dict:
    by_code = {c["epass_customer_code"]: c["customer_id"]
               for c in db.fetchall("SELECT customer_id, epass_customer_code FROM customer"
                                    " WHERE epass_customer_code IS NOT NULL")}
    sale_cols = ["invoice_code", "inv_type", "status", "job_status", "customer_id", "bill_to_code",
                 "sold_to_code", "salesperson", "created_date", "finish_date", "item_total",
                 "labor_total", "serial_total", "wty_total"]

    def sales():
        for r in rows(inv_path):
            it = t(r.get("InvTypeCode"), 6)
            if it not in SALE_TYPES:
                continue
            code = t(r.get("InvoiceCode"), 20)
            if not code:
                continue
            sold = t(r.get("SoldToCode"), 40)
            yield (code, it, t(r.get("Status"), 20), t(r.get("JobStatusCode"), 16),
                   by_code.get(sold), t(r.get("BillToCode"), 40), sold,
                   t(r.get("Salesperson1Code"), 12), d(r.get("DateCreated")), d(r.get("DateFinished")),
                   m(r.get("ItemTotal")), m(r.get("LaborTotal")), m(r.get("SerialTotal")), m(r.get("WtyTotal")))
    n_sale = db.insert_many("sale", sale_cols, sales())

    line_cols = ["invoice_code", "epass_line_id", "model_code", "model_desc", "brand_code", "product_code",
                 "sku", "mfr_warranty", "colour", "new_used", "qty", "selling_price", "line_total",
                 "line_status", "po_code"]

    def lines():
        for r in rows(line_path):
            code = t(r.get("InvoiceCode"), 20)
            if not code:
                continue
            yield (code, t(r.get("ModelLineID"), 20), t(r.get("ModelCode"), 60), t(r.get("ModelDesc"), 200),
                   t(r.get("BrandCode"), 20), t(r.get("ProductCode"), 20), t(r.get("SKU"), 40),
                   t(r.get("ManufacturersWarranty"), 40), t(r.get("Color"), 30), t(r.get("NewUsed"), 10),
                   m(r.get("QtyShipped")) or m(r.get("QtyOrdered")), m(r.get("SellingPrice")),
                   m(r.get("Total")), t(r.get("ModelLineStatus"), 20), t(r.get("POCode"), 30))
    n_line = db.insert_many("sale_line", line_cols, lines())

    ser_cols = ["invoice_code", "epass_line_id", "model_code", "serial", "serial_status", "returned",
                "taken", "taken_date", "unit_cost", "created_date"]

    def serials():
        for r in rows(serial_path):
            s = t(r.get("SerialCode"), 60)
            if not s:
                continue
            yield (t(r.get("InvoiceCode"), 20), t(r.get("SerialLineID"), 20), t(r.get("ModelCode"), 60),
                   s, t(r.get("SerialStatus"), 20), b(r.get("Returned")), b(r.get("Taken")),
                   d(r.get("TakenDate")), m(r.get("UnitCost")), d(r.get("DateCreated")))
    n_ser = db.insert_many("sale_serial", ser_cols, serials())
    return {"sale": n_sale, "sale_line": n_line, "sale_serial": n_ser}


# ---------------------------------------------------------------------------- stitching


def link_assets_to_sales(db: DB) -> int:
    """Did we sell the unit we are servicing? Matched on the serial with punctuation and case removed,
    because ePASS is inconsistent about both between the sales and service sides."""
    sold = {}
    for r in db.fetchall("SELECT s.serial, s.invoice_code, s.unit_cost, s.taken_date, s.created_date,"
                         " l.selling_price FROM sale_serial s"
                         " LEFT JOIN sale_line l ON l.invoice_code=s.invoice_code AND l.model_code=s.model_code"):
        k = norm_serial(r["serial"])
        if k and k not in sold:
            sold[k] = r
    n = 0
    for a in db.fetchall("SELECT asset_id, serial FROM asset WHERE serial IS NOT NULL"):
        s = sold.get(norm_serial(a["serial"]))
        if not s:
            continue
        db.execute("UPDATE asset SET purchased_from_us=1, purchase_date=COALESCE(purchase_date,?),"
                   " purchase_price=?, purchase_invoice=? WHERE asset_id=?",
                   (s["taken_date"] or s["created_date"], s["selling_price"], s["invoice_code"], a["asset_id"]))
        n += 1
    db.execute("UPDATE asset SET purchased_from_us=0 WHERE purchased_from_us IS NULL")
    return n


def backfill_asset_facts(db: DB) -> int:
    """`service_detail` carries the category and the purchase date the invoice export never had."""
    return db.execute(
        "UPDATE asset SET category=COALESCE(category,("
        "  SELECT sd.product_code FROM service_detail sd JOIN service_history h ON h.sv_number=sd.sv_number"
        "  WHERE h.asset_id=asset.asset_id AND sd.product_code IS NOT NULL LIMIT 1))"
    ).rowcount


def load_dir(db: DB, folder: str, now: Optional[str] = None) -> FullResult:
    now = now or now_iso()
    res = FullResult()
    p = {k: os.path.join(folder, v) for k, v in FILES.items()}
    missing = [v for k, v in FILES.items() if not os.path.exists(p[k])]
    if missing:
        raise FileNotFoundError("missing from the export folder: " + ", ".join(missing))
    res.counts["techs"] = load_techs(db, p["labor"], now)
    res.counts["service_detail"] = load_service_detail(db, p["service"])
    res.counts["service_part"] = load_parts(db, p["parts"])
    res.counts["service_labor"] = load_labor(db, p["labor"])
    res.counts.update(load_sales(db, p["invoices"], p["sale_lines"], p["sale_serials"]))
    res.counts["assets_linked_to_a_sale"] = link_assets_to_sales(db)
    backfill_asset_facts(db)
    return res


# ---------------------------------------------------------------------------- reads


def call_detail(db: DB, sv_number: str) -> dict:
    """Everything about one past call — the office clicks a row in the customer history and gets this."""
    sv = (sv_number or "").strip()
    head = db.fetchone(
        "SELECT h.*, d.*, p.name payer_name, p.kind payer_kind FROM service_history h"
        " LEFT JOIN service_detail d ON d.sv_number=h.sv_number"
        " LEFT JOIN payer p ON p.payer_id=h.payer_id WHERE h.sv_number=?", (sv,))
    if not head:
        head = db.fetchone("SELECT * FROM service_detail WHERE sv_number=?", (sv,))
    head = dict(head) if head else {}
    for k in ("complaint_desc", "performed_desc"):
        if head.get(k):
            head[k] = tidy(head[k])
    return {
        "call": head,
        "parts": db.fetchall("SELECT item_code, item_desc, qty_shipped, selling_price, unit_cost,"
                             " installed, warranty, trip_no FROM service_part WHERE sv_number=?"
                             " ORDER BY trip_no, part_line_id", (sv,)),
        "labor": db.fetchall("SELECT service_date, tech_code, tech_name, labor_desc, time_charged,"
                             " time_unit, rate, line_total, trip_no FROM service_labor WHERE sv_number=?"
                             " ORDER BY trip_no, labor_line_id", (sv,)),
    }


def family_members(db: DB, brand: str, product_code: str, model: str) -> list:
    """Every distinct model in the catalogue that shares this model's family key, with call counts."""
    fam = model_family(brand, product_code, model)
    if not fam["key"]:
        return []
    b = (brand or "").strip().upper()
    out = []
    for r in db.fetchall("SELECT model, COUNT(*) n FROM service_detail WHERE UPPER(COALESCE(brand_code,''))=?"
                         " AND model IS NOT NULL AND model<>'' GROUP BY model", (b,)):
        if model_family(b, product_code, r["model"])["key"] == fam["key"]:
            out.append({"model": r["model"], "n": r["n"]})
    out.sort(key=lambda x: -x["n"])
    return out


def model_insight(db: DB, brand: str, model: str, limit: int = 25, product_code: str = None) -> dict:
    """Team ask ⟨9/17⟩: what else have we seen on this model? Three tiers — the exact model, its family
    (same dishwasher, different handle), and the brand's whole product type — so the tech sees 22 calls,
    then 120, then 2,500, and picks the breadth that fits the question. Newest first; the caller puts any
    tech warning flags on top. Complaint text is shown as typed — it is free text and any clustering of it
    belongs in a later pass, not hidden inside a lookup."""
    b_, m_ = (brand or "").strip().upper(), (model or "").strip().upper()
    if product_code is None:
        row = db.fetchone("SELECT product_code FROM service_detail WHERE UPPER(COALESCE(brand_code,''))=?"
                          " AND UPPER(COALESCE(model,''))=? AND product_code IS NOT NULL LIMIT 1", (b_, m_))
        product_code = row["product_code"] if row else ""
    fam = model_family(b_, product_code, m_)
    members = family_members(db, b_, product_code, m_)
    fam_models = [x["model"] for x in members]
    fam_calls = sum(x["n"] for x in members)
    type_calls = db.scalar("SELECT COUNT(*) FROM service_detail WHERE UPPER(COALESCE(brand_code,''))=?"
                           " AND UPPER(COALESCE(product_code,''))=?", (b_, (product_code or "").upper())) or 0
    fam_parts = []
    if fam_models:
        qs = ",".join("?" * len(fam_models))
        fam_parts = db.fetchall(
            "SELECT sp.item_code, sp.item_desc, COUNT(*) n FROM service_part sp"
            " JOIN service_detail d ON d.sv_number=sp.sv_number"
            f" WHERE UPPER(COALESCE(d.brand_code,''))=? AND d.model IN ({qs})"
            "   AND sp.installed=1 AND sp.item_desc IS NOT NULL"
            " GROUP BY sp.item_code, sp.item_desc ORDER BY n DESC LIMIT 12", (b_, *fam_models))
    calls = db.fetchall(
        "SELECT d.sv_number, d.complaint_desc, d.performed_desc, d.product_code, d.serial,"
        " h.created_date, h.sp_code, h.total, h.customer_id"
        " FROM service_detail d LEFT JOIN service_history h ON h.sv_number=d.sv_number"
        " WHERE UPPER(COALESCE(d.brand_code,''))=? AND UPPER(COALESCE(d.model,''))=?"
        " ORDER BY COALESCE(h.created_date,'') DESC LIMIT ?", (b_, m_, limit))
    parts = db.fetchall(
        "SELECT sp.item_code, sp.item_desc, COUNT(*) n FROM service_part sp"
        " JOIN service_detail d ON d.sv_number=sp.sv_number"
        " WHERE UPPER(COALESCE(d.brand_code,''))=? AND UPPER(COALESCE(d.model,''))=?"
        "   AND sp.installed=1 AND sp.item_desc IS NOT NULL"
        " GROUP BY sp.item_code, sp.item_desc ORDER BY n DESC LIMIT 12", (b_, m_))
    total = db.scalar("SELECT COUNT(*) FROM service_detail WHERE UPPER(COALESCE(brand_code,''))=?"
                      " AND UPPER(COALESCE(model,''))=?", (b_, m_))
    calls = [dict(c) for c in calls]
    for c in calls:
        c["complaint_desc"] = tidy(c.get("complaint_desc"))
        c["performed_desc"] = tidy(c.get("performed_desc"))
    return {"brand": brand, "model": model, "product_code": product_code or "", "total_calls": total or 0,
            "calls": calls, "parts": parts,
            "family": {"stem": fam["stem"], "key": fam["key"], "rule": fam["rule"], "models": members,
                       "total_calls": fam_calls, "parts": fam_parts},
            "product_type_calls": type_calls}

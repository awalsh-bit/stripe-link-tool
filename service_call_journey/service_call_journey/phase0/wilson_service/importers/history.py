"""One-off load of the ePASS back catalogue: 20 years of service tickets and the customer list.

    python -m wilson_service load-history --history SV_HISTORY.csv --customers CUSTOMERS.csv

Two files, both exported from ePASS:

* **SV_HISTORY** — the Invoice Maintenance export with no status filter. 117,594 rows, 2006-2026.
* **CUSTOMERS**  — "Cleaned Up MAIN Customer Contact Info", 45,239 rows, the list being moved to NetSuite.

Three things make this more than a table copy.

**1. `Bill To Customer` is the payer, not the customer.** 25,148 of the 117,594 tickets (21%) are billed
to WHIRLPOOL, SUBZERO, GE WARRANTY, BOSCH, TRANE and friends — every warranty visit. Keying customer
history on that column collapses a fifth of the work into a dozen fake households and hides a
homeowner's warranty history from their own account, which is exactly the question the office is trying
to answer on the phone. So `payer` and `customer` are separate, and warranty tickets are resolved back
to a household by address+zip, then by surname + **house number** + zip. The surname fallback used to
be surname+zip alone, and that was wrong more often than right: of 4,264 tickets it attached, 2,222 sat
at a different house number from the household they were attached to (Melina Flores on Seawall Dr is
not Greg Flores on Granite Ln). Cayden 9/17, after a Do-Not-Service flag from Sammie Baird landed on Leah
Baird across town: check the address as well as the last name. So a surname match now also needs the
same house number — which is what an address-spelling variant looks like — and anything weaker keeps a
household created from the ticket itself, where `household_key` can cluster it later.

**2. Identity has to survive NetSuite.** Nothing here assumes ePASS is authoritative forever. Every
customer, asset and payer gets our own surrogate id; the ePASS code is recorded in `external_ref`
alongside any future NetSuite id, and `service_history.identity_source` records *how* each ticket was
attached so a later pass can re-decide any row it disagrees with without re-importing.

**3. Duplicates are preserved, not merged.** 3,461 addresses carry more than one
ePASS code (the same house entered again after a phone change). Cayden 9/15: mirror ePASS until the
NetSuite customer model is known. So each code stays its own `customer` row and they are linked by
`household_key`, which lets the office see the other accounts at an address without asserting a merge.
"""
from __future__ import annotations

import csv
import re
from typing import Iterable, Optional

from ..db import DB, now_iso
from .common import clean_phone, digits, parse_date, parse_money, split_name

# Payer codes that are not a household. Matched case-insensitively on the whole code.
_MANUFACTURER = re.compile(
    r"WHIRLPOOL|SUBZERO|SUB-ZERO|GE\b|BOSCH|TRANE|SPEEDQUEEN|SPEED QUEEN|MIELE|SCOTSMAN|ASKO|"
    r"FISHER|PAYKEL|ZEPHYR|THERMADOR|WOLF|COVE|VIKING|MONOGRAM|KITCHENAID|MAYTAG|LG\b|SAMSUNG|"
    r"ELECTROLUX|FRIGIDAIRE|JENN|DACOR|BLUESTAR|LYNX|MARVEL|PERLICK|VENTAHOOD|VENT-A-HOOD|WTY_",
    re.I)
_CASH = re.compile(r"^(cash|c\.?o\.?d\.?)$", re.I)

# Placeholder serials ePASS is full of. They are not identities: one "VERIFY" per household would
# merge every unlabelled appliance in the house into a single asset with 19 visits against it.
_JUNK_SERIAL = re.compile(r"^(VERIFY|VER|NEED|NEEDED|NA|N/?A|NONE|NO SERIAL|UNKNOWN|UNK|TBD|X+|0+|-+|\.+)$", re.I)

_SUFFIX = [(" DRIVE", " DR"), (" ROAD", " RD"), (" STREET", " ST"), (" LANE", " LN"), (" COURT", " CT"),
           (" CIRCLE", " CIR"), (" TRAIL", " TRL"), (" AVENUE", " AVE"), (" BOULEVARD", " BLVD"),
           (" PARKWAY", " PKWY"), (" HIGHWAY", " HWY"), (" PLACE", " PL"), (" TERRACE", " TER")]


_UNIT_INLINE = re.compile(r"(?:^|\s)(?:UNIT|APT|APARTMENT|STE|SUITE|#)\s*#?\s*([A-Z0-9-]{1,6})\s*$")
_UNIT_LINE2 = re.compile(r"(?:UNIT|APT|APARTMENT|STE|SUITE|#)\s*#?\s*([A-Z0-9-]{1,6})")
_SUFFIX_WORDS = {b.strip() for _, b in _SUFFIX} | {"WAY", "CV", "COVE", "LOOP", "PASS", "RUN", "PATH", "BEND", "PT", "POINT"}
_TRAILING_UNIT = re.compile(r"^(.*\b(?:%s))\s+([0-9]{1,4}[A-Z]?)$" % "|".join(sorted(_SUFFIX_WORDS)))


def unit_of(line1: str, line2: str = "") -> tuple:
    """Split the unit out of a street line. '210 LAVACA ST UNIT 1908' -> ('210 LAVACA ST', '1908');
    '210 LAVACA ST #2409' -> ('210 LAVACA ST', '2409'); '1700 PALOMINO RIDGE DR 6' -> (..., '6'); the
    customer file keeps it in Address 2 ('UNIT 3703', 'APT 2502'). High-rises are why this matters: 210
    Lavaca has 200 ePASS accounts and without the unit they all became one household ⟨9/17⟩."""
    s = re.sub(r"\s+", " ", (line1 or "").upper().replace(".", "")).strip()
    unit = ""
    m = _UNIT_INLINE.search(s)
    if m:
        unit, s = m.group(1), s[:m.start()].strip()
    else:
        m = _TRAILING_UNIT.match(s)
        if m:
            s, unit = m.group(1).strip(), m.group(2)
    if not unit and line2:
        m2 = _UNIT_LINE2.search((line2 or "").upper())
        if m2:
            unit = m2.group(1)
    return s, unit.lstrip("0") or unit


def address_key(line1: str, zip_code: str, line2: str = "") -> str:
    """'1377 Stock Pond Dr.' + '78631-1234' -> '1377 STOCK POND DR|78631'. Stable across the two files.
    A unit, from the street line or Address 2, becomes '#1908' so two condos in one tower are two households."""
    street, unit = unit_of(line1, line2)
    s = re.sub(r"[^A-Z0-9 ]", " ", street)
    s = re.sub(r"\s+", " ", s).strip()
    for a, b in _SUFFIX:
        s = s.replace(a, b)
    if unit:
        s = f"{s} #{unit}"
    z = digits(zip_code)[:5]
    # 'CLAIM SUBMISSION', 'NOT PROVIDED', 'DRIPPING SPRINGS', 'NEW HOUSE': a street line with no number and
    # under three words is a placeholder, not a place — 17 accounts were one 'household' at CLAIM SUBMISSION
    if not re.search(r"\d", s) and len(s.split()) < 3:
        return ""
    return f"{s}|{z}" if s and z else ""


def surname_key(name: str, zip_code: str) -> str:
    """ePASS writes 'KLEPAC-UECKER RHONDA' (last first) in the invoice export."""
    words = re.sub(r"[^A-Z& ]", " ", (name or "").upper()).split()
    z = digits(zip_code)[:5]
    return f"{words[0]}|{z}" if words and z else ""


def house_number(line1: str) -> str:
    """'4946 Farm To Market 165' -> '4946'; '' when the line does not start with a number ('NEW HOUSE')."""
    m = re.match(r"\s*(\d+)", line1 or "")
    return m.group(1) if m else ""


def same_house(line1: str, household_key: str) -> bool:
    """A surname match is only believed when the two addresses share a house number — and, when either
    side has a unit, the same unit. This is the 'address AND last name' rule: it accepts spelling variants
    of one address and rejects a namesake across town or two floors up. Either side without a number is a no."""
    street = (household_key or "").split("|")[0]
    a, b = house_number(line1), house_number(street)
    if not a or a != b:
        return False
    ua = unit_of(line1)[1]
    ub = street.split(" #")[1] if " #" in street else ""
    return (ua == ub) if (ua or ub) else True


def ticket_kind(status: str) -> str:
    """Not every ePASS ticket is a visit. `CPU*` is a counter pickup — a part sold over the front desk,
    written up as a service order. 8,667 of the 117,590 (7.4%), 84-86% of them with no scheduled date,
    median $45, and written by office staff codes (JKO, EHM, KKD) as often as by techs. Treating one as
    a routed job corrupts every per-tech average and any backtest of the placement engine. `SO9` is a
    cancellation and has no visit either."""
    s = (status or "").strip().upper()
    if s.startswith("CPU"):
        return "counter"
    if s == "SO9":
        return "cancelled"
    return "field"


def payer_kind(code: str, name: str) -> str:
    c = (code or "").strip()
    if not c:
        return "other"
    if c.isdigit():
        return "household"
    if _CASH.match(c):
        return "cash"
    if _MANUFACTURER.search(c) or _MANUFACTURER.search(name or ""):
        return "manufacturer"
    return "dealer"


class HistoryResult:
    def __init__(self) -> None:
        self.customers = 0
        self.customers_created = 0
        self.payers = 0
        self.assets = 0
        self.tickets = 0
        self.by_identity: dict[str, int] = {}
        self.skipped = 0
        self.duplicate_households = 0

    def __repr__(self) -> str:
        return (f"<HistoryResult customers={self.customers} payers={self.payers} assets={self.assets} "
                f"tickets={self.tickets} identity={self.by_identity} skipped={self.skipped}>")


# ---------------------------------------------------------------------------- customers


def load_customers(db: DB, rows: Iterable[dict], now: Optional[str] = None) -> int:
    """The MAIN Customer Contact Info export. `Code` is the ePASS customer code, which for anything
    keyed in the last decade is the phone number. Idempotent on that code."""
    now = now or now_iso()
    n = 0
    for r in rows:
        code = (r.get("Code") or "").strip()
        if not code:
            continue
        first = (r.get("First Name") or "").strip()
        last = (r.get("Last Name") or "").strip()
        if not (first or last):
            continue
        line1 = (r.get("Address 1") or "").strip()
        zip_code = (r.get("Zip ode") or r.get("Zip Code") or "").strip()      # sic: the export's header
        akey = address_key(line1, zip_code, r.get("Address 2") or "")
        emails = [(r.get(f"email {i}") or "").strip() for i in range(1, 7)]
        emails = [e for e in emails if "@" in e]
        phone1 = clean_phone(r.get("Phone1")) or clean_phone(code)
        phone2 = clean_phone(r.get("Phone2"))
        dns = str(r.get("Do Not Service") or "").strip()
        display = " ".join(x for x in (first.title(), last.title()) if x)

        existing = db.fetchone("SELECT customer_id FROM customer WHERE epass_customer_code=?", (code,))
        if existing:
            cid = existing["customer_id"]
            db.execute(
                "UPDATE customer SET first_name=COALESCE(first_name,?), last_name=COALESCE(last_name,?),"
                " display_name=COALESCE(display_name,?), phone_primary=COALESCE(phone_primary,?),"
                " phone_alt=COALESCE(phone_alt,?), email=COALESCE(email,?), household_key=COALESCE(household_key,?),"
                " do_not_service=?, do_not_service_note=?, updated_at=? WHERE customer_id=?",
                (first or None, last or None, display or None, phone1, phone2, emails[0] if emails else None,
                 akey or None, 1 if dns else 0, dns[:200] or None, now, cid))
        else:
            cid = db.insert("customer", {
                "first_name": first or None, "last_name": last or None, "display_name": display or None,
                "phone_primary": phone1, "phone_alt": phone2, "email": emails[0] if emails else None,
                "epass_customer_code": code, "household_key": akey or None,
                "do_not_service": 1 if dns else 0, "do_not_service_note": dns[:200] or None,
                "created_at": now, "updated_at": now})
            n += 1
        link_external(db, "customer", cid, "epass", code, now=now, primary=True)
        if line1 and not db.fetchone("SELECT address_id FROM address WHERE customer_id=? AND address_key=?", (cid, akey)):
            db.insert("address", {
                "customer_id": cid, "line1": line1, "line2": (r.get("Address 2") or "").strip() or None,
                "city": (r.get("city") or r.get("City") or "").strip() or None,
                "state": (r.get("State") or "").strip()[:2] or None,
                "zip": digits(zip_code)[:5] or None, "address_key": akey or None})
    return n


def link_external(db: DB, entity: str, entity_id, system: str, external_id: str,
                  now: Optional[str] = None, primary: bool = False, payload: Optional[str] = None) -> None:
    """Record an id from another system. This is the whole NetSuite story: when NetSuite ids arrive they
    are inserted here with system='netsuite', and whichever row is `is_primary` is the one we key on."""
    if not external_id:
        return
    if db.fetchone("SELECT external_ref_id FROM external_ref WHERE entity=? AND entity_id=? AND system=? AND external_id=?",
                   (entity, str(entity_id), system, str(external_id))):
        return
    db.insert("external_ref", {"entity": entity, "entity_id": str(entity_id), "system": system,
                              "external_id": str(external_id), "is_primary": 1 if primary else 0,
                              "payload": payload, "linked_at": now or now_iso()})


# ---------------------------------------------------------------------------- history


def _payer_for(db: DB, code: str, name: str, cache: dict, now: str, customer_id=None) -> Optional[int]:
    """A COD household is its own payer, so the row carries customer_id back; a manufacturer's does not."""
    code = (code or "").strip()
    if not code:
        return None
    if code in cache:
        return cache[code]
    row = db.fetchone("SELECT payer_id FROM payer WHERE code=?", (code,))
    if row:
        cache[code] = row["payer_id"]
    else:
        kind = payer_kind(code, name)
        cache[code] = db.insert("payer", {"code": code, "name": (name or code)[:120], "kind": kind,
                                          "customer_id": customer_id if kind == "household" else None,
                                          "created_at": now})
    return cache[code]


def _asset_for(db: DB, customer_id: Optional[int], brand, model, serial, created, cache: dict) -> Optional[int]:
    """An appliance is identified by serial within a household. No serial -> no asset row: a made-up
    asset per ticket would inflate every 'how many units does this customer own' answer."""
    serial = (serial or "").strip()[:60]
    if not serial or customer_id is None or _JUNK_SERIAL.match(serial):
        return None
    key = (customer_id, serial.upper())
    if key in cache:
        aid = cache[key]
        _touch(db, aid, created)
        return aid
    row = db.fetchone("SELECT asset_id FROM asset WHERE customer_id=? AND UPPER(serial)=?", (customer_id, serial.upper()))
    if row:
        aid = row["asset_id"]
    else:
        aid = db.insert("asset", {"customer_id": customer_id, "serial": serial,
                                  "brand": (brand or "").strip()[:40] or None,
                                  "model": (model or "").strip()[:60] or None,
                                  "first_seen": created, "last_seen": created, "service_count": 0})
    cache[key] = aid
    _touch(db, aid, created)
    return aid


def _touch(db: DB, asset_id: int, created) -> None:
    """History arrives in file order, not date order, so first_seen has to be able to move *back*."""
    db.execute(
        "UPDATE asset SET"
        " first_seen=CASE WHEN ? IS NOT NULL AND (first_seen IS NULL OR first_seen>?) THEN ? ELSE first_seen END,"
        " last_seen=CASE WHEN ? IS NOT NULL AND (last_seen IS NULL OR last_seen<?) THEN ? ELSE last_seen END,"
        " service_count=COALESCE(service_count,0)+1 WHERE asset_id=?",
        (created, created, created, created, created, created, asset_id))


def load_history(db: DB, rows: Iterable[dict], now: Optional[str] = None) -> HistoryResult:
    """Load the ticket history. Idempotent on `sv_number` — re-running replaces nothing and adds only
    tickets not already present, so a wider re-export is safe to run over the top."""
    now = now or now_iso()
    res = HistoryResult()

    # indexes for identity resolution, built once
    by_code, by_addr, by_surname = {}, {}, {}
    for c in db.fetchall("SELECT customer_id, epass_customer_code, household_key, last_name FROM customer"):
        if c["epass_customer_code"]:
            by_code[c["epass_customer_code"].strip()] = c["customer_id"]
        if c["household_key"]:
            by_addr.setdefault(c["household_key"], c["customer_id"])
    for a in db.fetchall("SELECT customer_id, address_key FROM address WHERE address_key IS NOT NULL"):
        by_addr.setdefault(a["address_key"], a["customer_id"])
    for c in db.fetchall("SELECT customer_id, last_name, household_key FROM customer WHERE last_name IS NOT NULL"):
        if c["household_key"] and "|" in c["household_key"]:
            by_surname.setdefault(f"{c['last_name'].upper().split()[0]}|{c['household_key'].split('|')[1]}", []).append(
                (c["customer_id"], c["household_key"]))

    payer_cache: dict = {}
    asset_cache: dict = {}
    seen = {r["sv_number"] for r in db.fetchall("SELECT sv_number FROM service_history")}

    for r in rows:
        sv = (r.get("Invoice #") or "").strip()
        if not sv:
            res.skipped += 1
            continue
        if sv in seen:
            continue
        name = (r.get("Name") or "").strip()
        addr = (r.get("Address") or "").strip()
        zip_code = (r.get("Zip Code") or "").strip()
        bill_code = (r.get("Bill To Customer") or "").strip()
        bill_name = (r.get("Bill To Customer Name") or "").strip()
        created = parse_date(r.get("Date Created"))
        akey = address_key(addr, zip_code)
        skey = surname_key(name, zip_code)

        # ---- identity: the ePASS code only counts when it is a household code, not a manufacturer
        cid, source = None, "unmatched"
        if bill_code.isdigit() and bill_code in by_code:
            cid, source = by_code[bill_code], "epass_code"
        elif akey and akey in by_addr:
            cid, source = by_addr[akey], "address_zip"
        elif skey and any(same_house(addr, hk) for _, hk in by_surname.get(skey, ())):
            cid = next(c for c, hk in by_surname[skey] if same_house(addr, hk))
            source = "surname_zip"          # surname + house number + zip; see the module docstring
        else:
            first, last, display = split_name(name)
            cid = db.insert("customer", {
                "first_name": first, "last_name": last, "display_name": display or name[:140] or None,
                "phone_primary": clean_phone(bill_code) if bill_code.isdigit() else None,
                "epass_customer_code": bill_code if bill_code.isdigit() else None,
                "household_key": akey or None, "do_not_service": 0,
                "created_at": now, "updated_at": now})
            res.customers_created += 1
            source = "unmatched"
            if akey:
                by_addr.setdefault(akey, cid)
            if skey and akey:
                by_surname.setdefault(skey, []).append((cid, akey))
            if akey and addr:
                db.insert("address", {"customer_id": cid, "line1": addr, "zip": digits(zip_code)[:5] or None,
                                      "address_key": akey})

        payer_id = _payer_for(db, bill_code, bill_name, payer_cache, now, customer_id=cid)
        asset_id = _asset_for(db, cid, r.get("Service Brand"), r.get("Service Model"), r.get("Service Serial"), created, asset_cache)

        db.insert("service_history", {
            "sv_number": sv, "customer_id": cid, "payer_id": payer_id, "asset_id": asset_id,
            "epass_status": (r.get("Job Status") or "").strip().upper() or None,
            "epass_state": (r.get("Status") or "").strip() or None,
            "created_date": created, "sched_date": parse_date(r.get("* Sched Date") or r.get("Sched Date")),
            "finish_date": parse_date(r.get("Finish Date") or r.get("* Finish Date")),
            "sp_code": (r.get("SP") or "").strip()[:8] or None,
            "route_code": (r.get("Route") or "").strip()[:8] or None,
            "map_zone": (r.get("Map Zone") or "").strip()[:8] or None,
            "zip": digits(zip_code)[:5] or None,
            "total": parse_money(r.get("Total")), "balance": parse_money(r.get("Balance")),
            "payment_type": (r.get("Payment Type Code") or "").strip()[:8] or None,
            "units": int(r.get("Units") or 0) or None,
            "qualification": (r.get("Qualification") or "").strip()[:20] or None,
            "priorities": (r.get("Priorities") or "").strip()[:60] or None,
            "reference": (r.get("Reference") or "").strip()[:60] or None,
            "spec_auth": (r.get("Spec Auth #") or "").strip()[:40] or None,
            "po_number": (r.get("PO #") or "").strip()[:40] or None,
            "name_raw": name[:140] or None, "address_raw": addr[:120] or None,
            "identity_source": source, "ticket_kind": ticket_kind(r.get("Job Status")),
            "imported_at": now})
        link_external(db, "job", sv, "epass", sv, now=now, primary=True)
        seen.add(sv)
        res.tickets += 1
        res.by_identity[source] = res.by_identity.get(source, 0) + 1

    _rollup(db)
    res.customers = db.fetchone("SELECT COUNT(*) n FROM customer")["n"]
    res.payers = db.fetchone("SELECT COUNT(*) n FROM payer")["n"]
    res.assets = db.fetchone("SELECT COUNT(*) n FROM asset")["n"]
    res.duplicate_households = db.fetchone(
        "SELECT COUNT(*) n FROM (SELECT household_key FROM customer WHERE household_key IS NOT NULL"
        " GROUP BY household_key HAVING COUNT(*)>1) t")["n"]
    return res


def _rollup(db: DB) -> None:
    """Denormalise the three numbers the office page reads on every lookup."""
    db.execute(
        "UPDATE customer SET service_count=(SELECT COUNT(*) FROM service_history h WHERE h.customer_id=customer.customer_id),"
        " first_service=(SELECT MIN(created_date) FROM service_history h WHERE h.customer_id=customer.customer_id),"
        " last_service=(SELECT MAX(created_date) FROM service_history h WHERE h.customer_id=customer.customer_id),"
        " lifetime_value=(SELECT COALESCE(SUM(total),0) FROM service_history h WHERE h.customer_id=customer.customer_id)")


# ---------------------------------------------------------------------------- lookup for the office page


def serial_core(serial: str) -> str:
    """'P1562739' and '1562739' are one Sub-Zero with two spellings in ePASS. The digit run is the
    stable part. Used to *flag* likely-same units, never to merge them: merging assets would be the
    same mistake as merging duplicate customer accounts, and the same answer applies — show it, let a
    person decide (Cayden 9/15)."""
    d = re.sub(r"\D", "", serial or "")
    return d.lstrip("0") if len(d) >= 5 else ""


def household(db: DB, customer_id: int) -> dict:
    """Everything the office needs when the phone rings: who they are, what they own, every visit,
    and the other ePASS accounts at the same address (shown, never merged — Cayden 9/15)."""
    c = db.fetchone("SELECT * FROM customer WHERE customer_id=?", (customer_id,))
    if not c:
        return {}
    hist = db.fetchall(
        "SELECT h.*, p.name payer_name, p.kind payer_kind FROM service_history h"
        " LEFT JOIN payer p ON p.payer_id=h.payer_id WHERE h.customer_id=?"
        " ORDER BY COALESCE(h.created_date,'') DESC", (customer_id,))
    assets = db.fetchall("SELECT * FROM asset WHERE customer_id=? ORDER BY COALESCE(last_seen,'') DESC", (customer_id,))
    groups: dict = {}
    for a in assets:                       # mark assets whose serials are probably the same appliance
        k = serial_core(a["serial"])
        if k:
            groups.setdefault(k, []).append(a["asset_id"])
    for a in assets:
        k = serial_core(a["serial"])
        a["same_as"] = [x for x in groups.get(k, []) if x != a["asset_id"]]
    also = []
    if c.get("household_key"):
        also = db.fetchall(
            "SELECT customer_id, display_name, epass_customer_code, service_count, last_service FROM customer"
            " WHERE household_key=? AND customer_id<>?", (c["household_key"], customer_id))
    return {"customer": c, "history": hist, "assets": assets, "also_at_address": also,
            "refs": db.fetchall("SELECT system, external_id, is_primary FROM external_ref WHERE entity='customer' AND entity_id=?",
                                (str(customer_id),))}


def search(db: DB, term: str, limit: int = 20) -> list:
    """Phone, name, address or serial — the four things a caller gives you."""
    term = (term or "").strip()
    if not term:
        return []
    d = digits(term)
    like = f"%{term.upper()}%"
    sql = ("SELECT DISTINCT c.customer_id, c.display_name, c.phone_primary, c.epass_customer_code,"
           " c.service_count, c.last_service, c.do_not_service, c.household_key"
           " FROM customer c LEFT JOIN asset a ON a.customer_id=c.customer_id"
           " WHERE (? <> '' AND (REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c.phone_primary,''),'(',''),')',''),'-',''),' ','') LIKE ?"
           "        OR COALESCE(c.epass_customer_code,'') LIKE ?))"
           "    OR UPPER(COALESCE(c.display_name,'')) LIKE ?"
           "    OR UPPER(COALESCE(c.household_key,'')) LIKE ?"
           "    OR UPPER(COALESCE(a.serial,'')) LIKE ?"
           " ORDER BY COALESCE(c.last_service,'') DESC")
    rows = db.fetchall(sql, (d, f"%{d}%" if d else "%", f"%{d}%" if d else "%", like, like, like))
    return rows[:limit]


# ---------------------------------------------------------------------------- file readers


def read_csv(path: str) -> list:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def load_files(db: DB, history_path: str, customers_path: Optional[str] = None,
               now: Optional[str] = None) -> HistoryResult:
    now = now or now_iso()
    if customers_path:
        load_customers(db, read_csv(customers_path), now=now)
    return load_history(db, read_csv(history_path), now=now)

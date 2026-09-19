"""Labor pricing (9/18; spec §5): the zone fee, the diagnostic fee, and per-task labor.

    zone_band(miles, bands=(7, 26, 47))        -> 1..4
    zone_fee_lines(miles, units=1, fees=None)  -> [ZNn line] + one ZNADD per extra appliance
    diag_fee_line(miles)                       -> {code: 'DZn', ...}
    miles_from_shop(latlng)                    -> statute miles, straight line from the shop
    quote_labor_lines(db, job, task_hours)     -> zone fee line(s) for the job's location + one line per task at hours × rate
    warranty_kind(db, job)                     -> 'cod' | 'flat' | None — which warranty rules a job falls under
    warranty_rate(db, job, tasks)              -> the manufacturer's flat rate for this claim, with its ePASS code
    shipping_line(db, job, override)           -> the FREIGHT line, or None on a warranty ticket

Provenance: fitted to 3,807 zoned tickets 2024–26 in the ePASS labor table (service_labor.labor_rate_code ZN1–ZN4/ZNADD,
DZ1–DZ4). Straight-line bands of 7 / 26 / 47 statute miles from the shop reproduce the zone ePASS charged on 81% of them;
the rest are the office rounding up (downtown 78701 is priced ZN3 at 18.8 mi — hence zone.fee_band). Prices are the 2026
modal rates: ZN1 $120 ×366, ZN2 $130 ×414, ZN3 $140 ×109, ZN4 $150 ×20, ZNADD $85 ×228, DZ1 $157 ×799. The $169.95 the
customer sees on the diagnostic is DZ1 $157 + 8.25% tax. So every quote carries two labor lines — the zone fee and the
component replacement — which is what the office asked for.

The band/fee functions are pure and take plain numbers; the seeded defaults are here so a test can run without a DB, and
quote_labor_lines reads the live values from settings (labor.zone_bands_miles, labor.zone_fees, labor.diag_fees, labor.hourly_rate).
"""
from __future__ import annotations

import json
import re
from typing import Optional

from .db import DB
from .placement import SHOP, _km

ZONE_BANDS = (7, 26, 47)
ZONE_FEES = {"ZN1": 120.0, "ZN2": 130.0, "ZN3": 140.0, "ZN4": 150.0, "ZNADD": 85.0}
DIAG_FEES = {"DZ1": 157.0, "DZ2": 157.0, "DZ3": 179.0, "DZ4": 209.0}
MILES_PER_KM = 0.621371

# Cayden 9/19, confirmed: "True / Scotsman / Zephyr / Bluestar all pay cod", everything else pays a flat rate back on
# the claim. A warranty call carries no zone fee and no tax either way (§5.1b) — the manufacturer is not a customer in
# our zone, and the claim is not a taxable sale. The flat rates themselves are NOT in the 2025.6.21 rate book: all
# 13,646 rows are Warranty=N, so on a flat-rate brand this returns a priced-at-zero line rather than a guess, and the
# warranty admin puts the real number on the claim. Open item 47 is the rate card that fixes that.
WTY_COD_BRANDS = ("true", "scotsman", "zephyr", "bluestar", "blue star")

# ⟨9/19 pm⟩ Cayden's rate card, checked against the ePASS codes twenty years of history already uses, so the SO3
# packet carries a code the warranty admin recognises (`reference/warranty_rates.csv` is the source; it also records
# what each code actually billed in 2025-26). A warranty flat rate is **per claim, not per hour** — one line for the
# visit however many tasks were done, which is why it cannot ride the hours × rate path.
# Two brands where the card and the history disagree loudly enough to ask about: La Cornue (card $150, history $702
# over 18 tickets) and AGA (card $150, history $314 over 5). Open item 52.
WTY_RATES = json.loads(r"""{"speedqueen":{"brand":"Speed Queen","std":150.0,"sealed":null,"code":"WTY1-SPEED","code_sealed":"WTY2-SPEED"},"asko":{"brand":"Asko","std":135.0,"sealed":null,"code":"WTYASKO-ASKO","code_sealed":null},"bosch":{"brand":"Bosch","std":160.0,"sealed":null,"code":"WTYBSH-BOSCH","code_sealed":null},"thermador":{"brand":"Thermador","std":160.0,"sealed":null,"code":"WTYBSH-THERM","code_sealed":null},"gaggenau":{"brand":"Gaggenau","std":160.0,"sealed":null,"code":"WTYBSH-GAGGE","code_sealed":null},"cove":{"brand":"Cove","std":163.0,"sealed":null,"code":"WTYCOVE-COVE","code_sealed":null},"dcs":{"brand":"DCS","std":165.0,"sealed":null,"code":"WTYDCS-DCS","code_sealed":null},"fisherpaykel":{"brand":"Fisher Paykel","std":165.0,"sealed":375.0,"code":"WTYFP-FP","code_sealed":null},"cafe":{"brand":"Cafe","std":125.0,"sealed":225.0,"code":"WTYGE-CAFE","code_sealed":"WTYSEALEDSYS-CAFE"},"ge":{"brand":"GE","std":125.0,"sealed":225.0,"code":"WTYGE-GE","code_sealed":"WTYSEALEDSYS-GE"},"haier":{"brand":"Haier","std":125.0,"sealed":225.0,"code":"WTYGE-HAIER","code_sealed":null},"hotpoint":{"brand":"Hotpoint","std":125.0,"sealed":null,"code":"WTYGE-GE","code_sealed":null},"profile":{"brand":"Profile","std":125.0,"sealed":225.0,"code":"WTYGE-PROF","code_sealed":"WTYSEALEDSYS-PROF"},"monogram":{"brand":"Monogram","std":151.25,"sealed":350.0,"code":"WTYMGRAM-MGRAM","code_sealed":"WTYSEALEDSYS-MGRAM"},"whirlpool":{"brand":"Whirlpool","std":113.68,"sealed":237.74,"code":"WTYWP-WP","code_sealed":"WTYSEALEDSYS-WP"},"maytag":{"brand":"Maytag","std":113.68,"sealed":237.74,"code":"WTYWP-MTAG","code_sealed":"WTYSEALEDSYS-MTAG"},"jennair":{"brand":"JennAir","std":113.68,"sealed":237.74,"code":"WTYJA-JA","code_sealed":"WTYSEALEDSYS-JA"},"kitchenaid":{"brand":"KitchenAid","std":113.68,"sealed":237.74,"code":"WTYWP-KA","code_sealed":"WTYSEALEDSYS-KA"},"amana":{"brand":"Amana","std":113.68,"sealed":null,"code":"WTYWP-AMANA","code_sealed":null},"lacornue":{"brand":"La Cornue","std":150.0,"sealed":null,"code":"WTYLACORNUE","code_sealed":null},"lg":{"brand":"LG","std":110.0,"sealed":null,"code":"WTYLG-LG","code_sealed":null},"liebherr":{"brand":"Liebherr","std":135.0,"sealed":null,"code":"WTYLIEB-LIEBHERR","code_sealed":null},"aga":{"brand":"AGA","std":150.0,"sealed":null,"code":"WTYMIDDLEBY-AGA","code_sealed":null},"lynx":{"brand":"Lynx","std":150.0,"sealed":null,"code":"WTYMIDDLEBY-LYNX","code_sealed":null},"marvel":{"brand":"Marvel","std":150.0,"sealed":300.0,"code":"WTYMIDDLEBY-MARVEL","code_sealed":null},"uline":{"brand":"U-Line","std":150.0,"sealed":300.0,"code":"WTYMIDDLEBY-ULINE","code_sealed":"WTYSEALEDSYS-ULINE"},"viking":{"brand":"Viking","std":150.0,"sealed":300.0,"code":"WTYMIDDLEBY-VIKING","code_sealed":null},"miele":{"brand":"Miele","std":165.0,"sealed":null,"code":"WTYMIELE-MIELE","code_sealed":null},"subzero":{"brand":"Sub-Zero","std":174.0,"sealed":420.0,"code":"WTYSZ-SZ","code_sealed":"WTYSZ-SEALEDSYS"},"wolf":{"brand":"Wolf","std":174.0,"sealed":null,"code":"WTYWOLF-WOLF","code_sealed":null}}""")
WTY_ALIAS = {"sub0": "subzero", "sz": "subzero", "fisherandpaykel": "fisherpaykel", "fp": "fisherpaykel",
             "speed": "speedqueen", "caf": "cafe", "geprofile": "profile", "geappliances": "ge",
             "mgram": "monogram", "wp": "whirlpool", "ka": "kitchenaid", "ja": "jennair", "mtag": "maytag",
             "therm": "thermador", "gagge": "gaggenau", "bsh": "bosch", "lieb": "liebherr", "prof": "profile"}
# ⟨9/19 late⟩ 'condenser' on its own matched "Condenser fan motor" and "Clean condenser coils" — neither is sealed-system work
SEALED_RE = re.compile(r"sealed[- ]?system|compressor|refrigerant|filter[- ]?drier|evaporator coil (replacement|repair|leak)", re.I)


def miles_from_shop(latlng) -> float:
    if latlng is None:
        return 0.0
    return _km(SHOP, latlng) * MILES_PER_KM


def zone_band(miles: float, bands=ZONE_BANDS) -> int:
    """1 up to and including bands[0] miles, 2 up to bands[1], 3 up to bands[2], 4 beyond."""
    for i, edge in enumerate(bands):
        if miles <= edge:
            return i + 1
    return len(bands) + 1


def zone_fee_lines(miles: float, units: int = 1, fees: Optional[dict] = None, bands=ZONE_BANDS, band: Optional[int] = None) -> list[dict]:
    """The service-zone line for the distance (or the given `band` override) plus one 'Additional Appliance' per extra unit."""
    fees = fees or ZONE_FEES
    b = int(band) if band else zone_band(miles, bands)
    code = f"ZN{b}"
    out = [{"code": code, "desc": f"Service Zone {b}", "amount": float(fees[code]), "auto": True}]
    for _ in range(max(int(units or 1) - 1, 0)):
        out.append({"code": "ZNADD", "desc": "Additional Appliance", "amount": float(fees["ZNADD"]), "auto": True})
    return out


def diag_fee_line(miles: float, fees: Optional[dict] = None, bands=ZONE_BANDS, band: Optional[int] = None) -> dict:
    fees = fees or DIAG_FEES
    b = int(band) if band else zone_band(miles, bands)
    code = f"DZ{b}"
    return {"code": code, "desc": f"Diagnostic Zone {b}", "amount": float(fees[code]), "auto": True}


def _job_miles_and_band(db: DB, job: dict) -> tuple[float, Optional[int]]:
    """Distance for the job (placement.location; else the zone's km_from_shop) and the zone's fee_band override if any."""
    from . import placement
    here = placement.location(db, job)
    zc = job.get("zone_code")
    if not zc and job.get("address_id"):
        zc = (db.fetchone("SELECT zone_code FROM address WHERE address_id=?", (job["address_id"],)) or {}).get("zone_code")
    z = db.fetchone("SELECT fee_band, km_from_shop FROM zone WHERE zone_code=?", (zc,)) if zc else None
    if here is not None:
        miles = miles_from_shop(here)
    elif z and z.get("km_from_shop") is not None:
        miles = float(z["km_from_shop"]) * MILES_PER_KM
    else:
        miles = 0.0
    return miles, (int(z["fee_band"]) if z and z.get("fee_band") else None)


def warranty_kind(db: DB, job: dict) -> Optional[str]:
    """None for a COD job; 'cod' for a warranty brand that pays our COD rate; 'flat' for one that pays a flat rate back.

    The brand comes off the unit, not the payer: a Sub-Zero billed to "GE WARRANTY" through a home warranty company is
    still a Sub-Zero, and it is the manufacturer's rate card that decides. Falls back to the payer string when the ticket
    has no unit row yet, because an intake-stage warranty ticket often does not."""
    if not job.get("is_warranty"):
        return None
    brands = [str(b).lower() for b in db.setting("warranty.cod_brands", list(WTY_COD_BRANDS))]
    hay = ""
    if job.get("job_id"):
        # every unit on the ticket, not just the first: a multi-unit job can carry the warranty brand second
        for u in db.fetchall("SELECT brand, model FROM unit WHERE job_id=? ORDER BY unit_id", (job["job_id"],)) or []:
            hay += f" {u.get('brand') or ''} {u.get('model') or ''}"
    hay = f"{hay} {job.get('brand') or ''} {job.get('warranty_payer') or ''}".lower()
    return "cod" if any(b in hay for b in brands) else "flat"


def _brand_key(text: str) -> str:
    k = re.sub(r"[^a-z0-9]", "", (text or "").lower())
    return WTY_ALIAS.get(k, k)


def warranty_rate(db: DB, job: dict, tasks: Optional[list] = None) -> Optional[dict]:
    """The flat rate a manufacturer pays back on this claim, or None when we have no rate for the brand.

    It is **one rate for the visit**, not a rate per task: that is what a warranty flat rate is, and it is why this
    does not go through hours × rate. A sealed-system repair takes the brand's sealed rate where the card has one."""
    rates = db.setting("warranty.rates", WTY_RATES)
    hay = ""
    if job.get("job_id"):
        for u in db.fetchall("SELECT brand, model FROM unit WHERE job_id=?", (job["job_id"],)) or []:
            hay += f" {u.get('brand') or ''}"
    hay = f"{hay} {job.get('brand') or ''}"
    row = None
    for word in [w for w in re.split(r"[\s,/]+", hay) if w] + [re.sub(r"[^a-z0-9]", "", hay.lower())]:
        row = rates.get(_brand_key(word))
        if row:
            break
    if not row:
        return None
    # ⟨9/19 late⟩ sealed is what the tech recorded — a sealed-system labor line or the flag — never the job's category
    sealed = bool((job.get("flags") or "").find("sealed") >= 0
                  or any(SEALED_RE.search(str(t[0] if isinstance(t, (list, tuple)) else t)) for t in (tasks or [])))
    amount = row.get("sealed") if (sealed and row.get("sealed")) else row.get("std")
    code = row.get("code_sealed") if (sealed and row.get("sealed") and row.get("code_sealed")) else row.get("code")
    return {"brand": row["brand"], "amount": float(amount), "code": code or "WTY", "sealed": bool(sealed and row.get("sealed")),
            "sealed_asked": sealed, "no_sealed_rate": bool(sealed and not row.get("sealed"))}


def shipping_line(db: DB, job: dict, override: Optional[float] = None) -> Optional[dict]:
    """S&H. ⟨9/19 pm, Cayden⟩ *"we use the code freight in epass for s&h … shipping should just default to $20 unless
    kezia changes it in the parts verify process. dont have the tech mess with it. no freight on warranty stuff."*"""
    if warranty_kind(db, job):
        return None
    amt = float(db.setting("parts.shipping_default", 20) if override is None else override)
    return {"code": "FREIGHT", "desc": "Shipping & handling", "amount": round(amt, 2), "taxable": True,
            "auto": override is None}


def quote_labor_lines(db: DB, job: dict, task_hours: list[tuple[str, float]]) -> list[dict]:
    """Two kinds of labor line on a COD quote: the zone fee (by distance from the shop, or the zone's fee_band override,
    plus ZNADD per extra unit) and one line per task at hours × labor.hourly_rate.

    On a warranty ticket (§5.1b, Cayden 9/19) there is no zone fee at all, and the task lines price only when the brand
    pays our COD rate; otherwise they come back at 0.00 marked `needs_rate_card`, which is the honest answer until
    someone gives us one."""
    bands = tuple(db.setting("labor.zone_bands_miles", list(ZONE_BANDS)))
    fees = db.setting("labor.zone_fees", ZONE_FEES)
    rate = float(db.setting("labor.hourly_rate", 130))
    wty = warranty_kind(db, job)
    if wty:
        lines = []
    else:
        miles, band = _job_miles_and_band(db, job)
        lines = zone_fee_lines(miles, units=job.get("units") or 1, fees=fees, bands=bands, band=band)
    if wty == "flat":
        # one flat rate for the claim, whatever was done; the tasks describe it rather than price it
        wr = warranty_rate(db, job, task_hours)
        what = ", ".join(str(n) for n, _ in task_hours) or "warranty repair"
        if wr:
            lines.append({"code": wr["code"], "desc": f"{wr['brand']} warranty flat rate — {what}", "amount": wr["amount"],
                          "hours": None, "rate": None, "auto": True, "sealed": wr["sealed"],
                          **({"no_sealed_rate": True} if wr["no_sealed_rate"] else {})})
        else:
            lines.append({"code": "WTY", "desc": f"Warranty flat rate — {what}", "amount": 0.0, "hours": None,
                          "rate": None, "auto": False, "needs_rate_card": True})
        return lines
    for name, hours in task_hours:
        h = float(hours)
        lines.append({"code": "LAB", "desc": f"{name} {h:g}h", "amount": round(h * rate, 2), "hours": h, "rate": rate, "auto": False})
    return lines


def taxable(db: DB, job: dict, kind: str) -> bool:
    """Whether a line of `kind` ('parts' | 'labor' | 'shipping') is taxed on this job.

    Parts and shipping are taxed; labor is taxed unless the work is on the home itself (built-in / HVAC — §5.6 rule 5).
    A warranty ticket is exempt throughout: the manufacturer is not buying anything from us."""
    if warranty_kind(db, job):
        return False
    if kind == "labor":
        return not bool(job.get("labor_tax_exempt"))
    return True

"""Seed reference data: statuses, settings, techs, zones, zips.

Techs/zones/zips come from the CSVs in reference/ (tech_roster.csv, zone_table.csv, zip_zone_tech.csv).
Statuses and settings are defined here from the spec (§2, §4, §11).
"""
from __future__ import annotations

import csv
import json
import os

from .db import DB, now_iso

# status, name, track, customer stage, sort, stuck_after_hours (None = no aging rule)
STATUSES = [
    ("REQ", "Request received, no time picked", "service", "Request received", 0, 24),
    ("SO1", "Service scheduled (diagnostic)", "service", "Diagnostic scheduled", 10, None),
    ("SO1.AUTH", "New call awaiting authorization", "service", "Waiting on authorization", 11, 48),
    ("SO2", "Unverified quote", "service", "Diagnosed", 20, 24),
    ("SO2.1", "Verified quote", "service", "Diagnosed", 21, 4),
    ("SO2.2", "Sent quote, awaiting approval", "service", "Estimate ready", 22, 120),
    ("SO3", "Repair approved, order parts", "service", "Approved", 30, 48),
    ("SO3PRE", "Preschedule parts", "service", "Approved", 31, 48),
    ("SO4", "Awaiting ordered parts", "service", "Parts ordered", 40, None),
    ("SO4B", "Awaiting backordered parts", "service", "Parts ordered", 41, None),
    ("SO4H", "Parts shipped to customer", "service", "Parts ordered", 42, None),
    ("SO4PRE", "Install held, part not here", "service", "Install scheduled", 43, None),
    ("SO5", "Parts in, schedule install", "service", "Part arrived", 50, 48),
    ("SO6", "Part install scheduled", "service", "Install scheduled", 60, None),
    ("SO7", "Customer declined repair", "service", "Estimate declined", 70, None),
    ("SO8", "Service completed", "service", "Repair complete", 80, None),
    ("SO8I", "Service completed, WACA install", "service", "Repair complete", 81, None),
    ("SO9", "Service cancelled", "service", "Cancelled", 90, None),
]
for i, code in enumerate(["SI1", "SI2", "SI3", "SI4", "SI5", "SI6", "SI7", "SI8", "SI9", "SI-TEST"]):
    STATUSES.append((code, f"In shop {code}", "in_shop", "At our shop", 100 + i, None))
for i, code in enumerate(["WAR1", "WAR3", "WAR4", "WAR4.1", "WARADMIN", "WARPART", "WARPARTORDERED", "WARPROBLEM", "WARTRANE", "CPU", "CPU2", "QUOTE"]):
    STATUSES.append((code, f"Warranty/admin {code}", "warranty", "In progress", 200 + i, None))

SETTINGS = [
    ("window.am", "08:00-12:00", "str", "Morning arrival window"),
    ("window.pm", "12:00-17:00", "str", "Afternoon arrival window"),
    ("capacity.buffer_min", "25", "int", "Reserved minutes per half day"),
    ("booking.horizon_business_days", "10", "int", "How far out customers may book"),
    ("booking.max_offers", "7", "int", "Max half-day windows offered"),
    ("booking.reschedule_cutoff_hours", "48", "int", "Self-service reschedule cutoff"),
    ("duration.defaults", json.dumps({"diag_appliance": 60, "diag_hvac": 90, "diag_builtin_refrig": 75, "install_default": 60, "multi_unit_add": 30, "sealed_factor": 1.25}), "json", "Seed durations (minutes)"),
    ("duration.learn_after_days", "28", "int", "Keep seed durations this long before learned medians"),
    ("duration.min_samples_to_learn", "20", "int", ""),
    ("owed.approval_rate_default", "0.67", "float", "Quote approval probability for owed installs"),
    ("trip.min_minutes", "240", "int", "Bucket on-site minutes that propose a trip"),
    ("trip.max_age_business_days", "5", "int", "Oldest bucket item age that proposes a trip"),
    ("trip.so5_max_age_days", "3", "int", ""),
    ("trip.max_auto_per_week", "2", "int", "Automatic trip proposals per group per week"),
    ("shop_touch.minutes", "10", "int", ""),
    ("route.drive_per_stop_guard_min", "35", "int", "Inter-stop drive per stop guard"),
    ("route.single_stop_marginal_drive_min", "60", "int", ""),
    ("parts.backorder_days", "10", "int", "ETA beyond this -> SO4B"),
    ("parts.eta_delay_notify_days", "2", "int", ""),
    ("parts.verified_fresh_days", "7", "int", ""),
    ("parts.stale_price_days", "30", "int", ""),
    ("requote.pct", "0.10", "float", "Field-quote re-approval threshold"),
    ("requote.min_dollars", "10", "float", ""),
    ("fee.diagnostic", "169.95", "float", ""),
    ("tax.rate", "0.0825", "float", ""),
    ("rate.appliance", "130", "float", ""),
    ("rate.hvac", "150", "float", ""),
    ("import.dt_folder", r"\\WILSON-EPASS01\Updates\ePASSScheduler\DispDataExport", "str", "DispatchTrack export folder"),
    ("import.dt_pattern", "DispatchTrackDetail_*.csv", "str", ""),
    ("import.dt_encoding", "cp1252", "str", ""),
    ("import.dt_statuses_only", "1", "bool", "DT export currently limited to SO1/SO4PRE/SO5/SO6"),
    ("sync.mismatch_cycles_before_discrepancy", "2", "int", ""),
    ("stale.grace_hours", "18", "int", "Hours after route_date end before an uncompleted stop is stale"),
    ("sync.follow_epass_for_import_jobs", "1", "bool", "Jobs created by import mirror ePASS status changes automatically (Phase 0/1)"),
    ("import.ei_sched_horizon_days", "120", "int", "ExportInvoice Sched Date beyond this many days is treated as unscheduled"),
    ("import.parking_day_rule", "1", "bool", "9/15: a route date on a day no tech works means unscheduled — ePASS parks undated work on the coming Saturday (9/10 file: Sat 9/12 x121; 9/15 file: Sat 9/19 x155)"),
    ("import.dt_watch_all", "0", "bool", "Watcher imports every unimported DT file (1) or only the newest (0)"),
    ("tech.work_days_default", "Mon,Tue,Wed,Thu,Fri", "str", "Default working days when the roster has none"),
    ("recall.window_days", "30", "int", "New call on the same unit within this many days of a completed repair = recall candidate"),
    ("recall.unreviewed_counts_after_days", "7", "int", "Unreviewed candidates count in the KPI after this many days"),
    ("hold.check_business_days_before", "2", "int", "SO4PRE: parts/receiving ETA-check task this many business days before the held date"),
    ("hold.release_business_days_before", "1", "int", "SO4PRE: release the hold if parts are still not in (14:00 the day before)"),
    ("pay.parts_margin_default", "0.45", "float", "Estimated parts margin when no PO or catalog cost exists"),
    ("pay.day_review_threshold", "2000", "float", "A tech day over this delivered-dollar figure gets a review flag"),
    # 9/14 — placement against the real route, the SO4 auto-pencil, route-first offers, the queue-copy intake and the shadow test
    ("placement.shift_min", "540", "int", "Minutes in a tech day before adjustments/blocks (8–5)"),
    ("placement.drive_base_min", "4", "int", "Drive-time model: base minutes per leg"),
    ("placement.drive_min_per_km", "1.55", "float", "Drive-time model: minutes per straight-line km"),
    ("placement.defer_min_per_day", "8", "int", "Cost (in drive-minute equivalents) of making the customer wait one more business day"),
    ("placement.defer_soft_days", "2", "int", "Business days of waiting charged at the low rate"),
    ("placement.defer_min_per_day_late", "20", "int", "Per business day beyond the soft days — keeps consolidation from pushing customers a week out"),
    ("placement.same_zone_bonus_min", "6", "int", "Credit per stop already in the job's zone that day (max 3 stops)"),
    ("placement.zone_secondary_penalty_min", "10", "int", "Tech is a secondary for the zone"),
    ("placement.zone_other_penalty_min", "40", "int", "Tech is neither primary nor secondary for the zone"),
    ("placement.horizon_business_days", "10", "int", "How far ahead suggest/pencil looks"),
    ("placement.min_slack_min", "25", "int", "Minutes that must remain in the day after the job is placed"),
    ("pencil.enabled", "1", "bool", "Auto-pencil SO4/SO4B/SO4H onto the best-fit day once the part ETA is known"),
    ("pencil.business_days_after_eta", "2", "int", "Pencil lands this many business days after the part is expected"),
    ("pencil.move_threshold_min", "15", "int", "A pencil only moves when another day is at least this much cheaper"),
    ("offer.route_first", "1", "bool", "Customer picker: the calendar starts on our best day within the hold; 0 = start at first open capacity"),
    ("offer.hold_max_business_days", "3", "int", "How many business days past first open capacity the customer's first offered date may be (Cayden 9/17 pm; replaces offer.max_defer_days)"),
    ("intake.match_window_days", "14", "int", "An unknown ePASS SV attaches to a dashboard request created within this many days (phone or last name + zip)"),
    ("serve.port", "8765", "int", "python -m wilson_service serve — port for the queue-copy / suggest endpoints"),
    ("serve.token", "", "str", "If set, requests must carry X-Token"),
    ("serve.cors_origin", "*", "str", "Access-Control-Allow-Origin for the live dashboard"),
    # ---- 9/18: the zone fee labor rule (labor.py). Fitted to 3,807 zoned tickets 2024–26 in the ePASS labor table: straight-line
    # bands 7/26/47 mi from the shop match 81%; prices are the 2026 modal rates. The $169.95 the customer sees is DZ1 $157 + 8.25% tax.
    ("labor.zone_bands_miles", json.dumps([7, 26, 47]), "json", "Upper edge (statute miles from the shop) of zones 1–3; beyond the last is zone 4"),
    ("labor.zone_fees", json.dumps({"ZN1": 120, "ZN2": 130, "ZN3": 140, "ZN4": 150, "ZNADD": 85}), "json",
     "Service zone fee per band (2026 modal: ZN1 $120 ×366, ZN2 $130 ×414, ZN3 $140 ×109, ZN4 $150 ×20) and the additional-appliance line (ZNADD $85 ×228)"),
    ("labor.diag_fees", json.dumps({"DZ1": 157, "DZ2": 157, "DZ3": 179, "DZ4": 209}), "json", "Diagnostic fee per band (DZ1 $157 ×799); + tax = the $169.95 quoted"),
    # ⟨9/18 pm⟩ the diagnostic when a part turns out to be discontinued. Cayden: standard is that it still stands, but the
    # office frequently waives it while moving the customer to the showroom. Default charge; the waive is one click, logged.
    ("billing.diag_on_nla", "charge", "str", "Diagnostic on a parts-unavailable notice: charge | waive | credit (2024-26: billed 56%, waived 19%)"),
    ("pricing.diag_fee", "169.95", "money", "The diagnostic fee the customer sees (DZ1 $157 + 8.25% tax)"),
    ("labor.hourly_rate", "130", "int", "Per-task labor: hours × this rate makes the second labor line on every quote"),
    # ⟨9/18 late⟩ the customer's tracker link (§6b). Expiry is housekeeping, not security — the receipt stays
    # reachable for a quarter after the job closes. The email limit is per job per hour.
    ("tracker.link_expiry_days", "90", "int", "A tracker link keeps working this many days after the job closes"),
    # ⟨9/19⟩ the three tracker buttons, and the two office rules behind them
    ("clientcare.sms_number", "512-894-0907", "str", "The number the tracker's Message Client Care button opens"),
    ("parts.shipping_default", "20", "money",
     "S&H on a COD quote with parts — ePASS code FREIGHT, taxable. Kezia overrides it per quote in Parts Verify for "
     "freight or a special order; the tech never sees it. No freight line at all on a warranty ticket (Cayden 9/19 pm)"),
    ("parts.shipping_taxable", "1", "bit", "Freight is taxed — it is delivery on taxable goods (Cayden 9/19 pm)"),
    ("parts.eta_buckets", "[[\"in_state\",\"In state\",2],[\"out_of_state\",\"Out of state\",3],[\"cross_country\",\"Cross country\",7],[\"backorder\",\"Backorder\",14]]", "json",
     "Kezia's expected-date buckets and their business days (Cayden 9/19 pm): in state ships standard ground in 1-2 days, "
     "out of state 2-3, cross country 5-7. The estimate shows a range; the SO4 pencil counts business days from the date"),
    ("parts.backorder_days", "10", "int", "An ETA beyond this many days flips SO4 to SO4B and sends the delay notice (Cayden 9/19 pm)"),
    ("quote.review_all", "1", "bit",
     "Every quote is reviewed before it goes out — Cayden 9/19 pm, in answer to the dollar-threshold question. There is "
     "no amount below which one sends itself"),
    ("quote.silence_days", "3", "int",
     "Days of silence on a sent quote before it becomes a call task and then SO7 (Cayden 9/19 pm — was 14)"),
    ("quote.keep_closed_days", "90", "int",
     "A closed quote keeps its lines this long so it can be reopened when the customer rings back, rather than rebuilt"),
    ("quote.diag_credit_on_reopen", "1", "bit",
     "Reopening a closed quote offers to credit the diagnostic the customer already paid into the repair (Cayden 9/19 pm)"),
    ("quote.diag_credit_on_replacement", "1", "bit",
     "On a discontinued part the diagnostic is charged as standard, and the customer is told we credit it in full "
     "against a replacement bought from us (Cayden 9/19 pm — replaces the three-way charge/waive/credit choice)"),
    ("warranty.rates", "{\"speedqueen\":{\"brand\":\"Speed Queen\",\"std\":150.0,\"sealed\":null,\"code\":\"WTY1-SPEED\",\"code_sealed\":\"WTY2-SPEED\"},\"asko\":{\"brand\":\"Asko\",\"std\":135.0,\"sealed\":null,\"code\":\"WTYASKO-ASKO\",\"code_sealed\":null},\"bosch\":{\"brand\":\"Bosch\",\"std\":160.0,\"sealed\":null,\"code\":\"WTYBSH-BOSCH\",\"code_sealed\":null},\"thermador\":{\"brand\":\"Thermador\",\"std\":160.0,\"sealed\":null,\"code\":\"WTYBSH-THERM\",\"code_sealed\":null},\"gaggenau\":{\"brand\":\"Gaggenau\",\"std\":160.0,\"sealed\":null,\"code\":\"WTYBSH-GAGGE\",\"code_sealed\":null},\"cove\":{\"brand\":\"Cove\",\"std\":163.0,\"sealed\":null,\"code\":\"WTYCOVE-COVE\",\"code_sealed\":null},\"dcs\":{\"brand\":\"DCS\",\"std\":165.0,\"sealed\":null,\"code\":\"WTYDCS-DCS\",\"code_sealed\":null},\"fisherpaykel\":{\"brand\":\"Fisher Paykel\",\"std\":165.0,\"sealed\":375.0,\"code\":\"WTYFP-FP\",\"code_sealed\":null},\"cafe\":{\"brand\":\"Cafe\",\"std\":125.0,\"sealed\":225.0,\"code\":\"WTYGE-CAFE\",\"code_sealed\":\"WTYSEALEDSYS-CAFE\"},\"ge\":{\"brand\":\"GE\",\"std\":125.0,\"sealed\":225.0,\"code\":\"WTYGE-GE\",\"code_sealed\":\"WTYSEALEDSYS-GE\"},\"haier\":{\"brand\":\"Haier\",\"std\":125.0,\"sealed\":225.0,\"code\":\"WTYGE-HAIER\",\"code_sealed\":null},\"hotpoint\":{\"brand\":\"Hotpoint\",\"std\":125.0,\"sealed\":null,\"code\":\"WTYGE-GE\",\"code_sealed\":null},\"profile\":{\"brand\":\"Profile\",\"std\":125.0,\"sealed\":225.0,\"code\":\"WTYGE-PROF\",\"code_sealed\":\"WTYSEALEDSYS-PROF\"},\"monogram\":{\"brand\":\"Monogram\",\"std\":151.25,\"sealed\":350.0,\"code\":\"WTYMGRAM-MGRAM\",\"code_sealed\":\"WTYSEALEDSYS-MGRAM\"},\"whirlpool\":{\"brand\":\"Whirlpool\",\"std\":113.68,\"sealed\":237.74,\"code\":\"WTYWP-WP\",\"code_sealed\":\"WTYSEALEDSYS-WP\"},\"maytag\":{\"brand\":\"Maytag\",\"std\":113.68,\"sealed\":237.74,\"code\":\"WTYWP-MTAG\",\"code_sealed\":\"WTYSEALEDSYS-MTAG\"},\"jennair\":{\"brand\":\"JennAir\",\"std\":113.68,\"sealed\":237.74,\"code\":\"WTYJA-JA\",\"code_sealed\":\"WTYSEALEDSYS-JA\"},\"kitchenaid\":{\"brand\":\"KitchenAid\",\"std\":113.68,\"sealed\":237.74,\"code\":\"WTYWP-KA\",\"code_sealed\":\"WTYSEALEDSYS-KA\"},\"amana\":{\"brand\":\"Amana\",\"std\":113.68,\"sealed\":null,\"code\":\"WTYWP-AMANA\",\"code_sealed\":null},\"lacornue\":{\"brand\":\"La Cornue\",\"std\":150.0,\"sealed\":null,\"code\":\"WTYLACORNUE\",\"code_sealed\":null},\"lg\":{\"brand\":\"LG\",\"std\":110.0,\"sealed\":null,\"code\":\"WTYLG-LG\",\"code_sealed\":null},\"liebherr\":{\"brand\":\"Liebherr\",\"std\":135.0,\"sealed\":null,\"code\":\"WTYLIEB-LIEBHERR\",\"code_sealed\":null},\"aga\":{\"brand\":\"AGA\",\"std\":150.0,\"sealed\":null,\"code\":\"WTYMIDDLEBY-AGA\",\"code_sealed\":null},\"lynx\":{\"brand\":\"Lynx\",\"std\":150.0,\"sealed\":null,\"code\":\"WTYMIDDLEBY-LYNX\",\"code_sealed\":null},\"marvel\":{\"brand\":\"Marvel\",\"std\":150.0,\"sealed\":300.0,\"code\":\"WTYMIDDLEBY-MARVEL\",\"code_sealed\":null},\"uline\":{\"brand\":\"U-Line\",\"std\":150.0,\"sealed\":300.0,\"code\":\"WTYMIDDLEBY-ULINE\",\"code_sealed\":\"WTYSEALEDSYS-ULINE\"},\"viking\":{\"brand\":\"Viking\",\"std\":150.0,\"sealed\":300.0,\"code\":\"WTYMIDDLEBY-VIKING\",\"code_sealed\":null},\"miele\":{\"brand\":\"Miele\",\"std\":165.0,\"sealed\":null,\"code\":\"WTYMIELE-MIELE\",\"code_sealed\":null},\"subzero\":{\"brand\":\"Sub-Zero\",\"std\":174.0,\"sealed\":420.0,\"code\":\"WTYSZ-SZ\",\"code_sealed\":\"WTYSZ-SEALEDSYS\"},\"wolf\":{\"brand\":\"Wolf\",\"std\":174.0,\"sealed\":null,\"code\":\"WTYWOLF-WOLF\",\"code_sealed\":null}}", "json",
     "Cayden's 9/19 warranty rate card: the manufacturer's flat rate per claim, with the ePASS labor code the warranty "
     "admin keys, and a higher sealed-system rate where the brand has one. Source reference/warranty_rates.csv"),
    ("warranty.cod_brands", "[\"true\", \"scotsman\", \"zephyr\", \"bluestar\"]", "json",
     "Warranty brands that pay our COD labor rate (Cayden 9/19). Every other brand pays a flat rate back on the claim, "
     "and until someone gives us a rate card per manufacturer the tool shows no labor figure at all rather than a guess (open item 47)"),
    ("warranty.zone_fee", "0", "bit", "A warranty call carries no zone fee — the manufacturer is not a customer in our zone"),
    ("warranty.tax_exempt", "1", "bit", "Warranty tickets are tax exempt throughout — the claim is not a taxable sale"),
    ("tracker.email_link_limit_per_hour", "3", "int", "Customer-initiated 'email me the link' sends per job per hour"),
]


def seed_all(db: DB, reference_dir: str) -> dict:
    counts = {}
    counts["status_def"] = _seed_statuses(db)
    counts["settings"] = _seed_settings(db)
    counts["tech"] = _seed_techs(db, os.path.join(reference_dir, "tech_roster.csv"))
    counts["zone"] = _seed_zones(db, os.path.join(reference_dir, "zone_table.csv"))
    counts["zip_zone"] = _seed_zips(db, os.path.join(reference_dir, "zip_zone_tech.csv"))
    counts["app_permission"] = _seed_permissions(db)
    db.commit()
    return counts


def _seed_statuses(db: DB) -> int:
    n = 0
    for st, name, track, stage, order, stuck in STATUSES:
        if not db.fetchone("SELECT 1 FROM status_def WHERE status=?", (st,)):
            db.insert("status_def", {"status": st, "name": name, "track": track, "customer_stage": stage, "sort_order": order, "stuck_after_hours": stuck})
            n += 1
    return n


def _seed_settings(db: DB) -> int:
    n = 0
    for key, value, typ, desc in SETTINGS:
        if not db.fetchone("SELECT 1 FROM settings WHERE setting_key=?", (key,)):
            db.insert("settings", {"setting_key": key, "value": value, "type": typ, "description": desc, "updated_by": "seed", "updated_at": now_iso()})
            n += 1
    return n


def _seed_techs(db: DB, path: str) -> int:
    """tech_roster.csv: sp_code may read 'VWJ / VJ' -> canonical VWJ, alias VJ. KJB is also keyed as KJB2 in invoice exports."""
    n = 0
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            codes = [c.strip() for c in r["sp_code"].split("/") if c.strip()]
            if not codes:
                continue
            code, aliases = codes[0], codes[1:]
            if code == "KJB" and "KJB2" not in aliases:
                aliases.append("KJB2")
            if db.fetchone("SELECT 1 FROM tech WHERE sp_code=?", (code,)):
                continue
            db.insert("tech", {
                "sp_code": code, "aliases": ",".join(aliases) or None, "name": r["name"], "role": r["role"], "home_base": r["home_base"],
                "work_days": (r.get("work_days") or "Mon,Tue,Wed,Thu,Fri").strip(),
                "start_default": r["start_default"] if r["start_default"] in ("shop", "home") else None,
                "end_default": r["end_default"] if r["end_default"] in ("shop", "home") else None,
                # 9/18: the roster has no home coordinates yet -> NULL, and a 'home' start is measured from the shop until it does
                "home_lat": float(r["home_lat"]) if (r.get("home_lat") or "").strip() else None,
                "home_lng": float(r["home_lng"]) if (r.get("home_lng") or "").strip() else None,
                "shift_start": "08:00", "shift_end": "17:00",
                "skills": json.dumps([s.strip() for s in r["skills"].split(",") if s.strip()]),
                "auto_route": 1 if r["auto_route"].startswith("yes") else 0,
                "auto_schedule": 1 if r["auto_schedule"].startswith("yes") else 0,
                "max_stops": 8, "speed_factor": 1.0,
                "active": 0 if "departed" in r["role"].lower() else 1,
            })
            n += 1
    return n


def _seed_zones(db: DB, path: str) -> int:
    n = 0
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if db.fetchone("SELECT 1 FROM zone WHERE zone_code=?", (r["epass_map_zone"],)):
                continue
            db.insert("zone", {
                "zone_code": r["epass_map_zone"], "zone_group": r["zone_group"], "booking_mode": r["booking_mode"],
                "primary_tech": r["primary_tech"] or None, "secondary_techs": r["secondary_techs"] or None,
                "centroid_lat": float(r["centroid_lat"]) if r["centroid_lat"] else None,
                "centroid_lng": float(r["centroid_lng"]) if r["centroid_lng"] else None,
                "km_from_shop": float(r["km_from_shop"]) if r["km_from_shop"] else None,
                "trip_tech": {"West": "JHM", "Northwest Lakes": "TDP", "Far South": "CEM"}.get(r["zone_group"]),
                "notes": r["notes"], "needs_review": 0,
            })
            n += 1
    return n


def _seed_zips(db: DB, path: str) -> int:
    n = 0
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            zones = dict(x.split(":") for x in r["epass_zones_seen"].split("; "))
            top = max(zones, key=lambda k: int(zones[k]))
            if not db.fetchone("SELECT 1 FROM zip_zone WHERE zip=?", (r["zip"],)):
                db.insert("zip_zone", {"zip": r["zip"], "zone_code": top})
                n += 1
    return n


# ---- 9/18: role -> permission rows (auth.ROLE_PERMISSIONS is the one list; this only materialises it)
def _seed_permissions(db: DB) -> int:
    from .auth import ROLE_PERMISSIONS
    n = 0
    for role, perms in ROLE_PERMISSIONS.items():
        for p in perms:
            if not db.fetchone("SELECT 1 FROM app_permission WHERE role=? AND permission=?", (role, p)):
                db.insert("app_permission", {"role": role, "permission": p})
                n += 1
    return n


def ensure_status(db: DB, code: str) -> bool:
    """Add a status code seen in an ePASS export but missing from status_def. Returns True if added."""
    code = (code or "").strip()
    if not code or db.fetchone("SELECT 1 FROM status_def WHERE status=?", (code,)):
        return False
    track = "in_shop" if code.startswith("SI") else "warranty" if code.startswith(("WAR", "CPU")) else "unknown"
    db.insert("status_def", {"status": code, "name": f"Unknown status {code} (seen in import)", "track": track,
                             "customer_stage": "In progress", "sort_order": 900, "stuck_after_hours": None})
    return True

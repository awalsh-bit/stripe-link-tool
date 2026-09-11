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
    ("import.dt_watch_all", "0", "bool", "Watcher imports every unimported DT file (1) or only the newest (0)"),
    ("tech.work_days_default", "Mon,Tue,Wed,Thu,Fri", "str", "Default working days when the roster has none"),
    ("recall.window_days", "30", "int", "New call on the same unit within this many days of a completed repair = recall candidate"),
    ("recall.unreviewed_counts_after_days", "7", "int", "Unreviewed candidates count in the KPI after this many days"),
    ("hold.check_business_days_before", "2", "int", "SO4PRE: parts/receiving ETA-check task this many business days before the held date"),
    ("hold.release_business_days_before", "1", "int", "SO4PRE: release the hold if parts are still not in (14:00 the day before)"),
    ("pay.parts_margin_default", "0.45", "float", "Estimated parts margin when no PO or catalog cost exists"),
    ("pay.day_review_threshold", "2000", "float", "A tech day over this delivered-dollar figure gets a review flag"),
]


def seed_all(db: DB, reference_dir: str) -> dict:
    counts = {}
    counts["status_def"] = _seed_statuses(db)
    counts["settings"] = _seed_settings(db)
    counts["tech"] = _seed_techs(db, os.path.join(reference_dir, "tech_roster.csv"))
    counts["zone"] = _seed_zones(db, os.path.join(reference_dir, "zone_table.csv"))
    counts["zip_zone"] = _seed_zips(db, os.path.join(reference_dir, "zip_zone_tech.csv"))
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


def ensure_status(db: DB, code: str) -> bool:
    """Add a status code seen in an ePASS export but missing from status_def. Returns True if added."""
    code = (code or "").strip()
    if not code or db.fetchone("SELECT 1 FROM status_def WHERE status=?", (code,)):
        return False
    track = "in_shop" if code.startswith("SI") else "warranty" if code.startswith(("WAR", "CPU")) else "unknown"
    db.insert("status_def", {"status": code, "name": f"Unknown status {code} (seen in import)", "track": track,
                             "customer_stage": "In progress", "sort_order": 900, "stuck_after_hours": None})
    return True

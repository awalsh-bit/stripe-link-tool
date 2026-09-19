"""DispatchTrack export importer (spec §3.1–§3.4).

File: DispatchTrackDetail_*.csv, cp1252, full snapshot every 15 minutes, one row per line item.
Only 'SV%' orders are service; the rest are sales/delivery and are ignored here.

What the import owns on an existing job: epass_status, epass_route_date, epass_tech_code,
epass_seen_at, in_feed, balance, bin_location, warranty_flags/is_warranty, qualification,
lat/lng (fill only), access_notes (fill only). It never writes status, route_date,
assigned_tech_id, route_sequence, promised_window_*, owner_tech_id, trip_id.
"""
from __future__ import annotations

import csv
import dataclasses
import datetime as _dt
import os
from collections import OrderedDict
from typing import Optional

from ..db import DB, now_iso
from .. import seed, sync, stuck, kpi, placement
from .common import (any_work_days, is_parking_day, canonical_code, compact_json, ensure_zone, find_or_create_address, find_or_create_customer, parse_date, parse_float,
                     parse_money, parse_order_detail, tech_id_for, upsert_unit, warranty_flags, zone_for_zip)

DT_STATUSES = ("SO1", "SO4PRE", "SO5", "SO6")  # what the routing feed exports today
INSTALL_STATUSES = ("SO4PRE", "SO5", "SO6")


class AlreadyImported(Exception):
    pass


@dataclasses.dataclass
class ImportResult:
    import_batch_id: int
    file_name: str
    rows: int = 0
    sv_rows: int = 0
    sv_orders: int = 0
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    attached: int = 0          # unknown SV attached to a dashboard job via a pending create_ticket item
    dropped_from_feed: int = 0
    new_zones: int = 0
    parked: int = 0
    sync: dict = dataclasses.field(default_factory=dict)
    stale: int = 0

    def summary(self) -> str:
        return (f"{self.file_name}: {self.rows} rows, {self.sv_orders} SV orders -> created {self.created}, updated {self.updated}, "
                f"unchanged {self.unchanged}, attached {self.attached}, parked {self.parked}, dropped {self.dropped_from_feed}, new zones {self.new_zones}, "
                f"sync {self.sync}, stale {self.stale}")


def read_rows(path: str, encoding: str = "cp1252") -> list[dict]:
    with open(path, newline="", encoding=encoding, errors="replace") as f:
        rdr = csv.DictReader(f)
        rows = []
        for r in rdr:
            r.pop("", None)  # trailing empty column
            r.pop(None, None)
            rows.append({(k or "").strip(): (v or "").strip() for k, v in r.items()})
        return rows


def import_file(db: DB, path: str, *, now: Optional[_dt.datetime] = None, encoding: Optional[str] = None, file_name: Optional[str] = None) -> ImportResult:
    """Import one snapshot. Raises AlreadyImported if the file name was imported before.
    Commits on success; rolls back and records a failed batch on error."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    file_name = file_name or os.path.basename(path)
    if db.fetchone("SELECT 1 FROM import_batch WHERE file_name=?", (file_name,)):
        raise AlreadyImported(file_name)
    encoding = encoding or db.setting("import.dt_encoding", "cp1252")
    try:
        mtime = _dt.datetime.fromtimestamp(os.path.getmtime(path)).replace(microsecond=0).isoformat(sep=" ")
    except OSError:
        mtime = None
    batch_id = db.insert("import_batch", {"source": "DT", "file_name": file_name, "file_path": path, "file_modified_at": mtime, "imported_at": ts,
                                          "row_count": 0, "sv_count": 0, "created_count": 0, "updated_count": 0, "status": "running", "message": None})
    db.commit()
    res = ImportResult(import_batch_id=batch_id, file_name=file_name)
    try:
        rows = read_rows(path, encoding)
        res.rows = len(rows)
        groups: "OrderedDict[str, list[dict]]" = OrderedDict()
        for r in rows:
            on = r.get("Order Number", "")
            if on.upper().startswith("SV"):
                groups.setdefault(on, []).append(r)
        res.sv_rows = sum(len(v) for v in groups.values())
        res.sv_orders = len(groups)
        zones_before = db.scalar("SELECT COUNT(*) FROM zone")
        workdays = any_work_days(db)
        seen: dict[str, int] = {}
        for sv, grp in groups.items():
            for i, r in enumerate(grp, 1):
                db.insert("import_row_raw", {
                    "import_batch_id": batch_id, "order_number": sv, "line_no": i, "job_status": r.get("Job Status") or None,
                    "delivery_date": parse_date(r.get("Delivery Date")), "truck": r.get("Truck") or None, "map_zone": r.get("Map Zone") or None,
                    "model": (r.get("Model") or None), "description": (r.get("Description") or None), "quantity": parse_float(r.get("Quantity")),
                    "amount": parse_money(r.get("Amount")), "row_json": compact_json(r),
                })
            job_id, outcome, parked = _upsert_order(db, sv, grp, ts, workdays)
            seen[sv] = job_id
            res.parked += parked
            setattr(res, outcome, getattr(res, outcome) + 1)
        res.new_zones = db.scalar("SELECT COUNT(*) FROM zone") - zones_before
        # full snapshot: anything we saw before but not now has left the routing feed
        in_feed = db.fetchall("SELECT job_id, sv_number FROM job WHERE in_feed=1")
        for j in in_feed:
            if j["sv_number"] not in seen:
                db.update("job", {"job_id": j["job_id"]}, {"in_feed": 0, "updated_at": ts})
                res.dropped_from_feed += 1
        res.sync = sync.reconcile_after_import(db, batch_id, seen, source="DT", now=now)
        res.stale = stuck.mark_stale(db, now)
        db.update("import_batch", {"import_batch_id": batch_id}, {"row_count": res.rows, "sv_count": res.sv_orders, "created_count": res.created,
                                                                  "updated_count": res.updated, "status": "ok", "message": res.summary()})
        db.commit()
        return res
    except Exception as e:  # never partially apply
        db.rollback()
        db.update("import_batch", {"import_batch_id": batch_id}, {"status": "failed", "message": f"{type(e).__name__}: {e}"[:2000]})
        db.commit()
        raise


def _upsert_order(db: DB, sv: str, grp: list[dict], ts: str, workdays: set) -> tuple[int, str, int]:
    h = grp[0]
    epass_status = (h.get("Job Status") or "").strip().upper() or None   # ePASS case is inconsistent (SO8 / so8)
    seed.ensure_status(db, epass_status)
    route_date = parse_date(h.get("Delivery Date"))
    parked = 1 if is_parking_day(db, route_date, workdays) else 0
    if parked:
        route_date = None        # DispatchTrack parks undated work on a Saturday too
    truck = canonical_code(db, h.get("Truck"))
    tech_id = tech_id_for(db, truck)
    zone_code = ensure_zone(db, h.get("Map Zone")) or zone_for_zip(db, h.get("Ship Zip"))
    lat, lng = parse_float(h.get("Latitude")), parse_float(h.get("Longitude"))
    if lat == 0 or lng == 0:
        lat = lng = None
    flags, is_wty = warranty_flags(h.get("Priorites"))
    bin_loc = next((r.get("Location") for r in grp if r.get("Location")), None)
    qual = (h.get("Qualifications") or "").strip()[:6] or None
    balance = parse_money(h.get("Balance"))
    directions = h.get("Directions") or None
    detail = parse_order_detail(h.get("Order Detail", ""))

    job = db.fetchone("SELECT * FROM job WHERE sv_number=?", (sv,))
    if job is None:
        # a dashboard job waiting for its ePASS ticket number?
        job = sync.match_create_ticket(db, sv, phone=h.get("Phone2") or h.get("Phone1"), last_name=h.get("Ship Name"), zip_code=h.get("Ship Zip"), now=ts)
        attached = job is not None
    else:
        attached = False

    mirror = {"epass_status": epass_status, "epass_route_date": route_date, "epass_tech_code": truck, "epass_source": "DT", "in_feed": 1,
              "balance": balance, "bin_location": bin_loc, "warranty_flags": flags, "is_warranty": is_wty, "qualification": qual}

    if job is None:
        cust_id = find_or_create_customer(db, name=h.get("Ship Name") or h.get("Bill Name"), phone=h.get("Phone2") or h.get("Phone1"), alt_phone=h.get("Phone3") or h.get("Phone1"),
                                          email=h.get("Email"), epass_code=h.get("Customer Code"), now=ts)
        addr_id = find_or_create_address(db, cust_id, line1=h.get("Ship Address1"), line2=h.get("Ship Address2"), city=h.get("Ship City"), state=h.get("Ship State"),
                                         zip_code=h.get("Ship Zip"), lat=lat, lng=lng, directions=directions, zone_code=zone_code)
        job_type = "hvac" if qual == "HVAC" or detail.get("install_type") == "hvac" else "appliance"
        vals = dict(mirror)
        vals.update({
            "sv_number": sv, "customer_id": cust_id, "address_id": addr_id, "status": epass_status, "status_changed_at": ts, "flags": None,
            "job_type": job_type, "payment_type": "WTY" if is_wty else "COD", "source": "import",
            "owner_tech_id": tech_id if epass_status in INSTALL_STATUSES else None, "assigned_tech_id": tech_id,
            "promised_window_start": None, "promised_window_end": None, "planned_slot_start": None, "planned_slot_end": None,
            "route_date": route_date, "route_sequence": None, "route_locked": 0, "trip_id": None,
            "booking_mode": (db.fetchone("SELECT booking_mode FROM zone WHERE zone_code=?", (zone_code,)) or {}).get("booking_mode") if zone_code else None,
            "zone_code": zone_code, "problem_text": detail.get("problem_text"), "total": None, "units": 1,
            "epass_seen_at": ts, "epass_invoice_status": None, "epass_finish_date": None, "epass_created_at": None,
            "stale": 0, "needs_intake_review": 1, "closed_at": None, "cancel_reason": None, "created_at": ts, "updated_at": ts,
        })
        job_id = db.insert("job", vals)
        db.insert("status_history", {"job_id": job_id, "from_status": None, "to_status": epass_status, "changed_at": ts, "actor_type": "import",
                                     "actor_id": "DT", "trigger_event": "import.create", "reason_code": None, "note": f"created from DispatchTrack snapshot; truck {truck or '-'}"})
        upsert_unit(db, job_id, detail)
        kpi.detect_recall(db, job_id, _dt.datetime.fromisoformat(ts))
        if parked:
            db.update("job", {"job_id": job_id}, {"flags": "parked"})
        return job_id, "created", parked

    # existing job: update only import-owned fields, and only when they differ
    changes = {k: v for k, v in mirror.items() if job.get(k) != v and not (k == "in_feed" and job.get(k) == 1)}
    if job.get("zone_code") is None and zone_code:
        changes["zone_code"] = zone_code
    if job.get("problem_text") in (None, "") and detail.get("problem_text"):
        changes["problem_text"] = detail["problem_text"]
    substantive = {k for k in changes if k != "in_feed"}
    changes.update({"epass_seen_at": ts})
    if substantive:
        changes["updated_at"] = ts
    db.update("job", {"job_id": job["job_id"]}, changes)
    if job.get("address_id"):
        addr = db.fetchone("SELECT * FROM address WHERE address_id=?", (job["address_id"],))
        if addr:
            fill = {}
            if addr.get("lat") is None and lat is not None:
                fill.update({"lat": lat, "lng": lng, "geocode_source": "epass"})
            if not addr.get("access_notes") and directions:
                fill["access_notes"] = directions[:2000]
            if not addr.get("zone_code") and zone_code:
                fill["zone_code"] = zone_code
            if fill:
                db.update("address", {"address_id": addr["address_id"]}, fill)
    upsert_unit(db, job["job_id"], detail)
    if attached and job.get("status") in ("REQ", "SO1.AUTH") and epass_status and route_date:
        # 9/14 shadow test: the office booked this request in ePASS — the dashboard adopts that booking and scores its own suggestion against it
        db.update("job", {"job_id": job["job_id"]}, {"status": epass_status, "status_changed_at": ts, "route_date": route_date, "assigned_tech_id": tech_id,
                                                      "needs_intake_review": 0, "updated_at": ts})
        db.insert("status_history", {"job_id": job["job_id"], "from_status": job["status"], "to_status": epass_status, "changed_at": ts, "actor_type": "import",
                                     "actor_id": "DT", "trigger_event": "epass_attach_booked", "reason_code": None, "note": f"booked in ePASS: {truck or '-'} {route_date}"})
    if attached or "epass_route_date" in changes or "epass_tech_code" in changes:
        placement.record_actual(db, job["job_id"], tech_id, route_date, "epass", now=_dt.datetime.fromisoformat(ts))
    flags = set(f for f in (job.get("flags") or "").split(",") if f)
    flags = (flags | {"parked"}) if parked else (flags - {"parked"})
    if ",".join(sorted(flags)) != (job.get("flags") or ""):
        db.update("job", {"job_id": job["job_id"]}, {"flags": ",".join(sorted(flags)) or None})
    if attached:
        return job["job_id"], "attached", parked
    return job["job_id"], ("updated" if substantive else "unchanged"), parked

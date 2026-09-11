"""Stale tickets and Stuck Jobs (spec §2 aging thresholds, §3.6, replay finding on stale SO1s).

Stale: a visit status (SO1 diagnostic, SO6 install) whose date has passed by more than
`stale.grace_hours` and which the next import still shows unclosed. Stale jobs are excluded
from the capacity ledger and shown as a queue for the office to close out in ePASS.

Stuck: any job that has sat in its current status longer than status_def.stuck_after_hours.
"""
from __future__ import annotations

import datetime as _dt

from .db import DB, now_iso

VISIT_STATUSES = ("SO1", "SO6")


def mark_stale(db: DB, now: _dt.datetime) -> int:
    """Recompute job.stale for every open job. Returns the number currently stale."""
    grace = db.setting("stale.grace_hours", 18)
    cutoff = (now - _dt.timedelta(hours=grace)).date().isoformat()  # route day whose evening + grace has passed
    ts = now_iso(now)
    rows = db.fetchall("SELECT job_id, status, epass_status, route_date, epass_route_date, stale FROM job WHERE closed_at IS NULL")
    n = 0
    for j in rows:
        st = j["epass_status"] or j["status"]
        d = j["epass_route_date"] or j["route_date"]
        is_stale = 1 if (st in VISIT_STATUSES and d and d < cutoff) else 0
        if is_stale:
            n += 1
        if (j["stale"] or 0) != is_stale:
            db.update("job", {"job_id": j["job_id"]}, {"stale": is_stale, "updated_at": ts})
    return n


def stuck_jobs(db: DB, now: _dt.datetime) -> list[dict]:
    """Jobs past their status's aging threshold, oldest first. Each row carries hours_in_status and threshold."""
    out = []
    rows = db.fetchall("SELECT j.job_id, j.sv_number, j.status, j.status_changed_at, j.stale, j.assigned_tech_id, j.owner_tech_id, j.route_date, "
                       "j.flags, d.stuck_after_hours, d.name AS status_name, c.display_name "
                       "FROM job j LEFT JOIN status_def d ON d.status=j.status LEFT JOIN customer c ON c.customer_id=j.customer_id "
                       "WHERE j.closed_at IS NULL AND j.status NOT IN ('SO8','SO8I','SO9','SO7')")
    for j in rows:
        thr = j["stuck_after_hours"]
        if j["status"] == "SO1" and "research" in (j["flags"] or ""):
            thr = 72
        if not thr or not j["status_changed_at"]:
            continue
        changed = _dt.datetime.fromisoformat(str(j["status_changed_at"]).replace("T", " ")[:19])
        hours = (now - changed).total_seconds() / 3600
        if hours > thr:
            j = dict(j)
            j["hours_in_status"] = round(hours, 1)
            j["threshold_hours"] = thr
            out.append(j)
    out.sort(key=lambda r: -r["hours_in_status"])
    return out


def stale_jobs(db: DB) -> list[dict]:
    return db.fetchall("SELECT j.job_id, j.sv_number, j.status, j.epass_status, j.route_date, j.epass_route_date, j.epass_tech_code, c.display_name "
                       "FROM job j LEFT JOIN customer c ON c.customer_id=j.customer_id WHERE j.stale=1 ORDER BY j.epass_route_date, j.route_date")

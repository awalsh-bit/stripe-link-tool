"""Dispatcher capacity controls (spec §4.1, 9/11 feedback): working days, open/close a day, PTO ranges,
±minutes, non-call blocks. Everything here is one write plus an audit row; the ledger (Phase 4) reads it.

    is_open(db, tech_id, date)             -> bool   (work_days + tech_day override)
    set_day(db, tech_id, date, available, reason, by, adjust=None, note=None)
    close_range(db, tech_id, from_date, to_date, reason, by)
    adjust_day(db, tech_id, date, delta_min, by)
    add_block(db, tech_id, date, start, end, label, by) / remove_block(db, block_id, by)
    day_summary(db, tech_id, date)         -> dict for the board popover
"""
from __future__ import annotations

import datetime as _dt
import json
from typing import Optional

from .db import DB, now_iso

DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
REASONS = ("pto", "sick", "training", "open_day", "forced", "other")


def _dow(date: str) -> str:
    return DOW[_dt.date.fromisoformat(date).weekday()]


def work_days(db: DB, tech_id: int) -> list[str]:
    t = db.fetchone("SELECT work_days FROM tech WHERE tech_id=?", (tech_id,))
    raw = (t or {}).get("work_days") or db.setting("tech.work_days_default", "Mon,Tue,Wed,Thu,Fri")
    return [d.strip() for d in raw.split(",") if d.strip()]


def tech_day(db: DB, tech_id: int, date: str) -> Optional[dict]:
    return db.fetchone("SELECT * FROM tech_day WHERE tech_id=? AND work_date=?", (tech_id, date))


def is_open(db: DB, tech_id: int, date: str) -> bool:
    """Closed unless it is a working day or the dispatcher opened it; a close override wins over both."""
    o = tech_day(db, tech_id, date)
    if o is not None and o.get("available") is not None:
        return bool(o["available"])
    return _dow(date) in work_days(db, tech_id)


def closed_reason(db: DB, tech_id: int, date: str) -> Optional[str]:
    if is_open(db, tech_id, date):
        return None
    o = tech_day(db, tech_id, date)
    if o and o.get("available") == 0:
        return o.get("reason") or "closed"
    return "not a working day (" + ",".join(work_days(db, tech_id)) + ")"


def _audit(db: DB, user: str, action: str, entity_id: str, before, after, ts: str) -> None:
    db.insert("audit_log", {"logged_at": ts, "user_id": user, "action": action, "entity": "tech_day", "entity_id": entity_id,
                            "before_json": json.dumps(before, default=str) if before is not None else None, "after_json": json.dumps(after, default=str)})


def set_day(db: DB, tech_id: int, date: str, available: Optional[bool], reason: Optional[str], by: str, *, adjust: Optional[int] = None,
            note: Optional[str] = None, now: Optional[_dt.datetime] = None) -> dict:
    """available=False closes (PTO/sick/training/other), True opens a non-working day, None leaves it as the roster says."""
    if reason and reason not in REASONS:
        raise ValueError(f"reason must be one of {REASONS}")
    ts = now_iso(now)
    row = tech_day(db, tech_id, date)
    vals = {"available": (1 if available else 0) if available is not None else None, "reason": reason if available is not None else (row or {}).get("reason"),
            "note": note if note is not None else (row or {}).get("note"), "set_by": by, "set_at": ts}
    if adjust is not None:
        vals["capacity_adjust_min"] = adjust
    if row:
        db.update("tech_day", {"tech_day_id": row["tech_day_id"]}, vals)
    else:
        vals.update({"tech_id": tech_id, "work_date": date, "start_override": None, "end_override": None,
                     "parts_loaded_prev_evening": None, "capacity_adjust_min": adjust or 0})
        db.insert("tech_day", vals)
    after = tech_day(db, tech_id, date)
    _audit(db, by, "capacity.day_" + ("closed" if available is False else "opened" if available else "changed"), f"{tech_id}:{date}", row, after, ts)
    return after


def close_range(db: DB, tech_id: int, from_date: str, to_date: str, reason: str, by: str, now: Optional[_dt.datetime] = None) -> int:
    """PTO through a date: closes every working day in the range (weekends skipped). Returns days closed."""
    d, end = _dt.date.fromisoformat(from_date), _dt.date.fromisoformat(to_date)
    n = 0
    while d <= end:
        k = d.isoformat()
        if _dow(k) in work_days(db, tech_id) or is_open(db, tech_id, k):
            set_day(db, tech_id, k, False, reason, by, now=now)
            n += 1
        d += _dt.timedelta(days=1)
    return n


def adjust_day(db: DB, tech_id: int, date: str, delta_min: int, by: str, now: Optional[_dt.datetime] = None) -> int:
    """+60 = one more stop can be booked; -60 = one fewer. Returns the new adjustment."""
    row = tech_day(db, tech_id, date)
    cur = (row or {}).get("capacity_adjust_min") or 0
    set_day(db, tech_id, date, None, None, by, adjust=cur + delta_min, now=now)
    return cur + delta_min


def add_block(db: DB, tech_id: int, date: str, start_time: str, end_time: str, label: str, by: str, *, address_id: Optional[int] = None,
              now: Optional[_dt.datetime] = None) -> int:
    """Time on a route that is not a call. HH:MM strings. Never synced to ePASS."""
    if not (len(start_time) == 5 and len(end_time) == 5 and start_time < end_time):
        raise ValueError("start_time/end_time must be HH:MM with start before end")
    ts = now_iso(now)
    bid = db.insert("route_block", {"tech_id": tech_id, "work_date": date, "start_time": start_time, "end_time": end_time, "label": label[:60],
                                    "address_id": address_id, "sequence": None, "created_by": by, "created_at": ts})
    _audit(db, by, "capacity.block_added", f"{tech_id}:{date}", None, {"block_id": bid, "label": label, "start": start_time, "end": end_time}, ts)
    return bid


def remove_block(db: DB, block_id: int, by: str, now: Optional[_dt.datetime] = None) -> None:
    row = db.fetchone("SELECT * FROM route_block WHERE block_id=?", (block_id,))
    if not row:
        raise ValueError(f"block {block_id} not found")
    db.execute("DELETE FROM route_block WHERE block_id=?", (block_id,))
    _audit(db, by, "capacity.block_removed", f"{row['tech_id']}:{row['work_date']}", row, {}, now_iso(now))


def blocks_for(db: DB, tech_id: int, date: str) -> list[dict]:
    return db.fetchall("SELECT * FROM route_block WHERE tech_id=? AND work_date=? ORDER BY start_time", (tech_id, date))


def blocked_minutes(db: DB, tech_id: int, date: str) -> int:
    total = 0
    for b in blocks_for(db, tech_id, date):
        h1, m1 = map(int, b["start_time"].split(":"))
        h2, m2 = map(int, b["end_time"].split(":"))
        total += (h2 * 60 + m2) - (h1 * 60 + m1)
    return total


def day_summary(db: DB, tech_id: int, date: str) -> dict:
    """What the fill-strip popover shows."""
    o = tech_day(db, tech_id, date) or {}
    shift_min = 9 * 60
    return {
        "tech_id": tech_id, "date": date, "dow": _dow(date), "open": is_open(db, tech_id, date), "closed_reason": closed_reason(db, tech_id, date),
        "work_days": work_days(db, tech_id), "capacity_adjust_min": o.get("capacity_adjust_min") or 0,
        "capacity_min": (shift_min + (o.get("capacity_adjust_min") or 0)) if is_open(db, tech_id, date) else 0,
        "blocked_min": blocked_minutes(db, tech_id, date), "blocks": blocks_for(db, tech_id, date),
        "stops": db.scalar("SELECT COUNT(*) FROM job WHERE assigned_tech_id=? AND route_date=? AND closed_at IS NULL AND stale=0", (tech_id, date)),
        "forced": db.scalar("SELECT COUNT(*) FROM job WHERE assigned_tech_id=? AND route_date=? AND flags LIKE '%forced%'", (tech_id, date)),
        "set_by": o.get("set_by"), "set_at": o.get("set_at"), "note": o.get("note"),
    }


def force_onto_day(db: DB, job_id: int, tech_id: int, date: str, by: str, now: Optional[_dt.datetime] = None) -> None:
    """'Force it': place a job on a full (or closed) day with one click, no reason code, logged."""
    ts = now_iso(now)
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job:
        raise ValueError(f"job {job_id} not found")
    flags = set(f for f in (job.get("flags") or "").split(",") if f)
    flags.add("forced")
    db.update("job", {"job_id": job_id}, {"assigned_tech_id": tech_id, "route_date": date, "flags": ",".join(sorted(flags)), "updated_at": ts})
    db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "capacity.forced", "entity": "job", "entity_id": str(job_id),
                            "before_json": json.dumps({"tech": job.get("assigned_tech_id"), "date": job.get("route_date")}),
                            "after_json": json.dumps({"tech": tech_id, "date": date, "open": is_open(db, tech_id, date)})})

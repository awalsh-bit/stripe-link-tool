"""Recall detection and the first KPIs (spec §2 recall detection, §3.7) — computed from the mirrored data.

    detect_recall(db, job_id, now)   run after every job creation (import or dashboard)
    review_recall(db, recall_id, state, user, note)
    kpis(db, from_date, to_date)     per-tech rows: visits, calls/working day, turnaround, diag-only, recalls
"""
from __future__ import annotations

import datetime as _dt
import statistics
from typing import Optional

from .db import DB, now_iso
from .capacity import work_days, is_open

COMPLETED = ("SO8", "SO8I")


def _job_unit(db: DB, job_id: int) -> Optional[dict]:
    return db.fetchone("SELECT * FROM unit WHERE job_id=? ORDER BY unit_id", (job_id,))


def detect_recall(db: DB, job_id: int, now: Optional[_dt.datetime] = None) -> Optional[int]:
    """A new job on the same serial (or same model at the same address) with a completed repair in the last
    `recall.window_days` → recall(candidate). An RCALL warranty flag from ePASS → recall(confirmed, epass_rcall).
    Returns the recall_id or None. Idempotent per job."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job or db.fetchone("SELECT 1 FROM recall WHERE job_id=?", (job_id,)):
        return None
    window = db.setting("recall.window_days", 30)
    created = str(job.get("epass_created_at") or job.get("created_at") or ts)[:10]
    since = (_dt.date.fromisoformat(created) - _dt.timedelta(days=window)).isoformat()
    unit = _job_unit(db, job_id) or {}
    original, basis = None, None

    def _finish(j):
        return str(j.get("epass_finish_date") or j.get("closed_at") or j.get("status_changed_at") or "")[:10]

    def _pick(rows):
        cands = [j for j in rows if since <= _finish(j) <= created]
        cands.sort(key=_finish, reverse=True)
        return cands[0] if cands else None

    if unit.get("serial") and unit["serial"] not in ("—", "-", "0", "00000"):
        original = _pick(db.fetchall("SELECT j.* FROM job j JOIN unit u ON u.job_id=j.job_id WHERE u.serial=? AND j.job_id<>? AND j.status IN ('SO8','SO8I')",
                                     (unit["serial"], job_id)))
        basis = "serial"
    if original is None and unit.get("model") and job.get("address_id"):
        original = _pick(db.fetchall("SELECT j.* FROM job j JOIN unit u ON u.job_id=j.job_id WHERE u.model=? AND j.address_id=? AND j.job_id<>? AND j.status IN ('SO8','SO8I')",
                                     (unit["model"], job["address_id"], job_id)))
        basis = "model_address"
    epass_rcall = "RCALL" in (job.get("warranty_flags") or "")
    if original is None and not epass_rcall:
        return None
    if original is not None:
        fin = _finish(original)
        days = (_dt.date.fromisoformat(created) - _dt.date.fromisoformat(fin)).days
        tech = original.get("owner_tech_id") or original.get("assigned_tech_id")
        state = "confirmed" if epass_rcall else "candidate"
        orig_id = original["job_id"]
    else:
        days, tech, state, orig_id, basis = None, job.get("owner_tech_id") or job.get("assigned_tech_id"), "confirmed", None, "epass_rcall"
    rid = db.insert("recall", {"job_id": job_id, "original_job_id": orig_id, "tech_id": tech, "days_between": days, "basis": basis, "state": state,
                               "reviewed_by": None, "reviewed_at": None, "note": None, "created_at": ts})
    flags = set(f for f in (job.get("flags") or "").split(",") if f)
    flags.add("recall_candidate" if state == "candidate" else "recall")
    db.update("job", {"job_id": job_id}, {"flags": ",".join(sorted(flags))})
    return rid


def review_recall(db: DB, recall_id: int, state: str, user: str, note: Optional[str] = None, now: Optional[_dt.datetime] = None) -> None:
    if state not in ("confirmed", "dismissed"):
        raise ValueError("state must be confirmed or dismissed")
    r = db.fetchone("SELECT * FROM recall WHERE recall_id=?", (recall_id,))
    if not r:
        raise ValueError(f"recall {recall_id} not found")
    db.update("recall", {"recall_id": recall_id}, {"state": state, "reviewed_by": user, "reviewed_at": now_iso(now), "note": note})
    job = db.fetchone("SELECT flags FROM job WHERE job_id=?", (r["job_id"],))
    flags = set(f for f in ((job or {}).get("flags") or "").split(",") if f) - {"recall_candidate", "recall"}
    if state == "confirmed":
        flags.add("recall")
    db.update("job", {"job_id": r["job_id"]}, {"flags": ",".join(sorted(flags)) or None})


def recalls(db: DB, state: Optional[str] = None) -> list[dict]:
    sql = ("SELECT r.*, j.sv_number, o.sv_number AS original_sv, t.sp_code, c.display_name FROM recall r JOIN job j ON j.job_id=r.job_id "
           "LEFT JOIN job o ON o.job_id=r.original_job_id LEFT JOIN tech t ON t.tech_id=r.tech_id LEFT JOIN customer c ON c.customer_id=j.customer_id")
    if state:
        return db.fetchall(sql + " WHERE r.state=? ORDER BY r.created_at DESC", (state,))
    return db.fetchall(sql + " ORDER BY r.created_at DESC")


def _business_days(db: DB, tech_id: int, start: _dt.date, end: _dt.date) -> int:
    n, d = 0, start
    while d <= end:
        if is_open(db, tech_id, d.isoformat()):
            n += 1
        d += _dt.timedelta(days=1)
    return n


def kpis(db: DB, from_date: str, to_date: str, now: Optional[_dt.datetime] = None) -> list[dict]:
    """Per tech for the window: visits completed (SO8/SO8I/SO7 finish dates), calls per working day, median turnaround
    (created → finish, business days ignored — calendar days), diag-only share, recalls attributed. Data today = ePASS mirror."""
    now = now or _dt.datetime.now()
    unrev_after = db.setting("recall.unreviewed_counts_after_days", 7)
    start, end = _dt.date.fromisoformat(from_date), _dt.date.fromisoformat(to_date)
    out = []
    for t in db.fetchall("SELECT * FROM tech WHERE active=1 ORDER BY sp_code"):
        rows = db.fetchall("SELECT j.* FROM job j WHERE (j.owner_tech_id=? OR j.assigned_tech_id=?) AND j.status IN ('SO7','SO8','SO8I')", (t["tech_id"], t["tech_id"]))
        done = []
        for j in rows:
            j["fin"] = str(j.get("epass_finish_date") or j.get("closed_at") or "")[:10]
            if from_date <= j["fin"] <= to_date:
                done.append(j)
        turn = []
        diag_only = 0
        for j in done:
            c = j.get("epass_created_at") or (j.get("created_at") or "")[:10]
            if c and j["fin"]:
                turn.append((_dt.date.fromisoformat(j["fin"]) - _dt.date.fromisoformat(str(c)[:10])).days)
            if j["status"] == "SO7" or (j.get("total") is not None and abs(float(j["total"]) - 169.95) < 0.01):
                diag_only += 1
        rec = [r for r in db.fetchall("SELECT * FROM recall WHERE tech_id=?", (t["tech_id"],)) if from_date <= str(r["created_at"])[:10] <= to_date]
        counted = [r for r in rec if r["state"] == "confirmed" or (r["state"] == "candidate" and (now - _dt.datetime.fromisoformat(str(r["created_at"]).replace("T", " ")[:19])).days >= unrev_after)]
        wd = _business_days(db, t["tech_id"], start, end)
        out.append({"tech_id": t["tech_id"], "sp_code": t["sp_code"], "name": t["name"], "visits_completed": len(done), "working_days": wd,
                    "calls_per_day": round(len(done) / wd, 2) if wd else None, "turnaround_median_days": statistics.median(turn) if turn else None,
                    "turnaround_p90_days": sorted(turn)[int(len(turn) * 0.9) - 1] if len(turn) >= 10 else None,
                    "diag_only_rate": round(diag_only / len(done), 2) if done else None,
                    "recalls": len(counted), "recall_candidates_open": sum(1 for r in rec if r["state"] == "candidate"),
                    "recall_rate": round(len(counted) / len(done), 3) if done else None})
    return out

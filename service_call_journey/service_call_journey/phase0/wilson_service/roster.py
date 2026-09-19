"""Roster admin (9/18; team item 40): retire a tech — never delete one.

    retire_tech(db, sp_code, on_date, by_email) -> open jobs still on that tech from on_date

Retiring sets tech.active=0 and tech.retire_on; the tech leaves the board, placement and the scorecard from that date and
every historical row keeps resolving (twenty years of SAW/DTE/MWH tickets read fine). `ended_on`/`lifecycle` are not touched —
the labor-history load owns those. The count of open work still assigned on/after the date is returned so the caller can
put it in front of the dispatcher; nothing is moved automatically.
"""
from __future__ import annotations

import datetime as _dt
import json
from typing import Optional

from .db import DB, now_iso
from .auth import can

OPEN_TERMINAL = ("SO7", "SO8", "SO8I", "SO9")


def retire_tech(db: DB, sp_code: str, on_date: str, by_email: str, now: Optional[_dt.datetime] = None) -> int:
    if not can(db, by_email, "roster.retire"):
        raise PermissionError(f"{by_email} may not retire a tech (needs roster.retire)")
    code = (sp_code or "").strip().upper()
    t = db.fetchone("SELECT * FROM tech WHERE sp_code=?", (code,))
    if not t:
        raise ValueError(f"tech {code!r} not found")
    on_date = str(on_date)[:10]
    _dt.date.fromisoformat(on_date)                     # yyyy-mm-dd or nothing
    ts = now_iso(now)
    not_in = ",".join(f"'{s}'" for s in OPEN_TERMINAL)
    open_jobs = db.scalar(f"SELECT COUNT(*) FROM job WHERE closed_at IS NULL AND status NOT IN ({not_in}) AND "
                          "((assigned_tech_id=? AND route_date>=?) OR (penciled_tech_id=? AND penciled_date>=?))",
                          (t["tech_id"], on_date, t["tech_id"], on_date)) or 0
    db.update("tech", {"tech_id": t["tech_id"]}, {"active": 0, "retire_on": on_date})
    db.insert("audit_log", {"logged_at": ts, "user_id": by_email, "action": "roster.retired", "entity": "tech", "entity_id": code,
                            "before_json": json.dumps({"active": t.get("active"), "retire_on": t.get("retire_on")}, default=str),
                            "after_json": json.dumps({"active": 0, "retire_on": on_date, "open_jobs_from_date": open_jobs})})
    return int(open_jobs)

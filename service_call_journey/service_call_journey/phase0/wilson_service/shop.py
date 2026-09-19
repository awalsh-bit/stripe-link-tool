"""In-shop (SI) tickets — spec §5.11, blueprint §5.11 ⟨9/19 pm⟩.

Cayden: *"SI jobs live in their own section of unassigned and can be used to fill in days that are lighter. lets make
that manual to start. these should ignore customer notification rules. customer can still view tracker, but we dont
want to send them a text on part arrival. si jobs historically get moved a lot if the tech falls behind and doesnt make
it back to work on the unit, so they can float for days at a time before being addressed. build a notification that
taddles on the tech for not getting in shops done and puts it in marks notification if it has been scheduled more than
twice and not diagnosed, or repaired. note - sometimes our techs bring appliances from a house while they are on the so1
call for further eval in shop. these tickets will move ti si status and the tool needs to remember the appliance needs to
be delivered on the so6 trip."*

Everything unusual about an in-shop ticket follows from one fact: **the unit is here and the customer is not waiting at
home for anybody.** So it has no arrival window, no drive time, and no urgency any customer can feel — which is exactly
why it floats for days, and why the only thing that will ever stop it floating is a person being told. Hence:

- its own lane rather than a filter, so it is never "the small stuff at the bottom of Unscheduled";
- bench days counted, not just the current one, because the number that matters is how many times it has been promised
  a day and not been touched;
- the manager told on the third, by name, because nobody else is going to notice;
- the notification rules muted: a part arriving is not news to someone whose machine is already with us.

    take_in(db, job_id, tech_id, note, deliver) -> None      the tech loads it on his van at the SO1
    bench(db, job_id, tech_id, work_date)       -> dict      give it a day; counts, and escalates on the third
    repaired(db, job_id, by)                    -> dict      SI5 — the customer picks the return, or comes and gets it
    open_units(db)                              -> list      the lane, oldest first
    floating(db)                                -> list      the ones Mark is being told about
"""
from __future__ import annotations

import datetime as _dt
import json
from typing import Optional

from .db import DB, now_iso

NAG_AFTER = 2          # bench days given without the unit being touched
MUTED_EFFECTS = ("notify:part_arrived_pick_time", "notify:parts_ordered", "notify:parts_delay")


def _si(job: dict) -> dict:
    try:
        return json.loads(job.get("shop_json") or "{}")
    except (TypeError, ValueError):
        return {}


def _save(db: DB, job_id: int, si: dict, ts: str) -> None:
    db.update("job", {"job_id": job_id}, {"shop_json": json.dumps(si), "updated_at": ts})


def take_in(db: DB, job_id: int, *, tech_id: int, note: str = "", deliver: bool = True,
            now: Optional[_dt.datetime] = None) -> None:
    """The tech's *Taking it to the shop with me* on an SO1.

    `deliver=True` is the important half: the unit came off the customer's floor, so we owe them a delivery back, and
    the return trip has to remember to load it. A unit the customer dropped at the counter is `deliver=False` and ends
    with them collecting it — a different ending, and the tracker says so."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job:
        raise ValueError(f"no job {job_id}")
    si = {"in": ts[:10], "by": tech_id, "deliver": bool(deliver), "sched": [], "note": (note or "")[:200],
          "from_status": job["status"]}
    db.update("job", {"job_id": job_id}, {"status": "SI1", "status_changed_at": ts, "owner_tech_id": tech_id,
                                          "assigned_tech_id": None, "route_date": None, "route_sequence": None,
                                          "promised_window_start": None, "promised_window_end": None,
                                          "shop_json": json.dumps(si), "updated_at": ts})
    db.insert("status_history", {"job_id": job_id, "from_status": job["status"], "to_status": "SI1", "changed_at": ts,
                                 "actor_type": "tech", "actor_id": str(tech_id), "trigger_event": "tech.taking_to_shop",
                                 "reason_code": None, "note": (note or "")[:200] or None})
    if deliver:
        db.insert("outbox", {"job_id": job_id, "effect": "flag:delivery_owed",
                             "payload": json.dumps({"by": tech_id, "unit_left_with_us": True}),
                             "created_at": ts, "handled_at": None})


def bench(db: DB, job_id: int, *, tech_id: int, work_date: str, by: str = "dispatcher",
          now: Optional[_dt.datetime] = None) -> dict:
    """Give an in-shop unit a day on someone's bench. Manual, as Cayden asked — the engine does not place these,
    because 'a light day' is a judgement nobody has written down yet.

    Every time it is scheduled is kept, not just the current one. Two is bad luck; three is a pattern, and on the third
    the service manager is told, because an in-shop unit has no customer at a door to chase it."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job or not str(job["status"]).startswith("SI"):
        raise ValueError("not an in-shop ticket")
    si = _si(job)
    si.setdefault("sched", []).append(work_date)
    db.update("job", {"job_id": job_id}, {"assigned_tech_id": tech_id, "route_date": work_date,
                                          "promised_window_start": None, "promised_window_end": None,
                                          "shop_json": json.dumps(si), "updated_at": ts})
    out = {"job_id": job_id, "times": len(si["sched"]), "escalated": False}
    if len(si["sched"]) > NAG_AFTER and job["status"] == "SI1":
        mgr = db.fetchone("SELECT tech_id FROM tech WHERE sp_code=?", ("MAP",)) or {}
        db.insert("outbox", {"job_id": job_id, "effect": "task:manager_shop_stalled",
                             "payload": json.dumps({"times": len(si["sched"]), "tech_id": tech_id,
                                                    "days_in": (now.date() - _dt.date.fromisoformat(si["in"])).days,
                                                    "to": mgr.get("tech_id")}),
                             "created_at": ts, "handled_at": None})
        out["escalated"] = True
    return out


def repaired(db: DB, job_id: int, *, by: str, now: Optional[_dt.datetime] = None) -> dict:
    """Done on the bench. It leaves the bench day, and what happens next depends on how it arrived: a unit we took away
    we bring back and reinstall (the customer picks a window, like a part install); one they dropped off they collect."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    si = _si(job)
    db.update("job", {"job_id": job_id}, {"status": "SI5", "status_changed_at": ts, "assigned_tech_id": None,
                                          "route_date": None, "route_sequence": None, "updated_at": ts})
    db.insert("status_history", {"job_id": job_id, "from_status": job["status"], "to_status": "SI5", "changed_at": ts,
                                 "actor_type": "staff", "actor_id": by, "trigger_event": "shop.repaired",
                                 "reason_code": None, "note": None})
    effect = "notify:si_ready_pick_return" if si.get("deliver") else "notify:si_ready_collect"
    db.insert("outbox", {"job_id": job_id, "effect": effect,
                         "payload": json.dumps({"deliver": bool(si.get("deliver")), "owner": job.get("owner_tech_id")}),
                         "created_at": ts, "handled_at": None})
    return {"job_id": job_id, "status": "SI5", "deliver": bool(si.get("deliver")), "effect": effect}


def muted(job: dict, effect: str) -> bool:
    """*"these should ignore customer notification rules. customer can still view tracker, but we dont want to send them
    a text on part arrival."* The tracker is a page they choose to open; a text is us interrupting them. Telling someone
    whose machine is already on our bench that "your part is in" is noise, so those effects are dropped for SI."""
    return str(job.get("status") or "").startswith("SI") and effect in MUTED_EFFECTS


def open_units(db: DB) -> list[dict]:
    rows = db.fetchall("SELECT * FROM job WHERE status IN ('SI1','SI5','SI6') ORDER BY job_id") or []
    for r in rows:
        si = _si(r)
        r["shop"] = si
        r["times_scheduled"] = len(si.get("sched") or [])
        r["delivery_owed"] = bool(si.get("deliver"))
        r["floating"] = r["status"] == "SI1" and r["times_scheduled"] > NAG_AFTER
    rows.sort(key=lambda x: (not x["floating"], x.get("shop", {}).get("in") or ""))
    return rows


def floating(db: DB) -> list[dict]:
    return [r for r in open_units(db) if r["floating"]]

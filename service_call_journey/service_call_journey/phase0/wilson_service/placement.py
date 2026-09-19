"""Placement (spec §4.3 / v1.3 §13.18–19): where a call should land, judged against the route ePASS actually shows.

    suggest(db, job_id, earliest=None, now=None)   -> ranked [(tech, date, cost, why)] for the dispatcher's Unscheduled panel
    pencil(db, job_id, by, now=None)               -> SO4/SO4B/SO4H: soft-hold the best-fit day ETA + N business days out
    unpencil(db, job_id, by, reason, now=None)
    offer(db, job_id, now=None)                    -> customer-facing dates, best-fit first (labelled), earliest kept in view
    log_suggestion(...) / record_actual(...)       -> placement_log: what we suggested vs what really happened
    repencil_all(db, by, now=None)                 -> nightly / after import: re-score every penciled job

Everything is scored in "minutes": marginal drive to insert the stop into the day's route (nearest insertion over the
stops DispatchTrack shows for that tech/day, plus any pencils), minus a credit for stops already in the same zone,
plus a small cost per business day the customer waits and a penalty when the tech is not the zone's primary.
Locations: address lat/lng from DispatchTrack when we have it, else the zone centroid, else unknown (geo-neutral).
9/18: the route's ends are the tech's for that weekday (route_endpoints) — shop or home — not always the shop.
"""
from __future__ import annotations

import datetime as _dt
import json
import math
from typing import Optional

from .db import DB, now_iso
from .capacity import DOW, is_open, blocked_minutes, tech_day

SHOP = (30.1852, -98.0031)  # 4205 E Hwy 290, Dripping Springs (zone SHOP centroid)
ON_ROUTE = ("SO1", "SO4PRE", "SO6", "WAR")            # statuses that put a truck at an address
PENCILABLE = ("SO4", "SO4B", "SO4H")
INSTALL = ("SO4", "SO4B", "SO4H", "SO4PRE", "SO5", "SO6")


# ------------------------------------------------------------------ dates
def business_days_after(date: str, n: int) -> str:
    d = _dt.date.fromisoformat(date)
    while n > 0:
        d += _dt.timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d.isoformat()


def business_days_between(a: str, b: str) -> int:
    """Business days from a (exclusive) to b (inclusive); 0 when b <= a."""
    da, dbb = _dt.date.fromisoformat(a), _dt.date.fromisoformat(b)
    n = 0
    while da < dbb:
        da += _dt.timedelta(days=1)
        if da.weekday() < 5:
            n += 1
    return n


def _next_weekday(date: str) -> str:
    d = _dt.date.fromisoformat(date)
    while d.weekday() >= 5:
        d += _dt.timedelta(days=1)
    return d.isoformat()


# ------------------------------------------------------------------ geography
def _km(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _drive(db: DB, a, b) -> int:
    if a is None or b is None:
        return 0
    return int(round(db.setting("placement.drive_base_min", 4) + _km(a, b) * db.setting("placement.drive_min_per_km", 1.55)))


def location(db: DB, job: dict):
    """(lat, lng) from the address; else the average of DispatchTrack-geocoded addresses in the same ZIP; else the zone
    centroid; else the average of geocoded addresses in the zone; else None (geo-neutral). New web requests have no
    geocode yet, so the ZIP average is what usually places them — it gets better with every import."""
    addr = db.fetchone("SELECT lat, lng, zip, zone_code FROM address WHERE address_id=?", (job.get("address_id"),)) if job.get("address_id") else None
    if addr and addr.get("lat") is not None and addr.get("lng") is not None:
        return (float(addr["lat"]), float(addr["lng"]))
    z5 = str((addr or {}).get("zip") or "")[:5]
    if z5:
        r = db.fetchone("SELECT AVG(lat) AS la, AVG(lng) AS ln, COUNT(lat) AS n FROM address WHERE zip LIKE ? AND lat IS NOT NULL", (z5 + "%",))
        if r and (r.get("n") or 0) >= 1:
            return (float(r["la"]), float(r["ln"]))
    zc = job.get("zone_code") or (addr or {}).get("zone_code")
    if zc:
        z = db.fetchone("SELECT centroid_lat, centroid_lng FROM zone WHERE zone_code=?", (zc,))
        if z and z.get("centroid_lat") is not None:
            return (float(z["centroid_lat"]), float(z["centroid_lng"]))
        r = db.fetchone("SELECT AVG(lat) AS la, AVG(lng) AS ln, COUNT(lat) AS n FROM address WHERE zone_code=? AND lat IS NOT NULL", (zc,))
        if r and (r.get("n") or 0) >= 1:
            return (float(r["la"]), float(r["ln"]))
    return None


# ---- 9/18: per-day start/end points. Josh starts and ends at the shop Mon/Wed (picks up parts) and runs home->home
# Tue/Thu; his default is home/home. A tech with no pattern and shop/shop defaults gets exactly the old shop->...->shop.
def _endpoint(kind: Optional[str], t: dict):
    if (kind or "shop") == "home" and t.get("home_lat") is not None and t.get("home_lng") is not None:
        return (float(t["home_lat"]), float(t["home_lng"]))
    return SHOP           # 'shop', or 'home' with no coordinates on file yet


def route_endpoints(db: DB, tech, date: str) -> tuple:
    """(start_ll, end_ll) for one tech/day: weekday -> tech_pattern.start_at/end_at, falling back to tech.start_default/
    end_default; 'shop' -> SHOP, 'home' -> (home_lat, home_lng) or SHOP when unknown. `tech` is a tech_id or a tech row."""
    t = tech if isinstance(tech, dict) else db.fetchone("SELECT * FROM tech WHERE tech_id=?", (tech,))
    if not t:
        return SHOP, SHOP
    start, end = t.get("start_default") or "shop", t.get("end_default") or "shop"
    p = db.fetchone("SELECT start_at, end_at FROM tech_pattern WHERE tech_id=? AND weekday=?", (t["tech_id"], DOW[_dt.date.fromisoformat(date).weekday()]))
    if p:
        start, end = p.get("start_at") or start, p.get("end_at") or end
    return _endpoint(start, t), _endpoint(end, t)


# ------------------------------------------------------------------ the day as ePASS shows it
def est_minutes(db: DB, job: dict) -> int:
    if job.get("est_minutes"):
        return int(job["est_minutes"])
    d = db.setting("duration.defaults", {}) or {}
    if job.get("status") in INSTALL:
        m = d.get("install_default", 60)
    elif (job.get("job_type") or "appliance") == "hvac":
        m = d.get("diag_hvac", 90)
    else:
        m = d.get("diag_appliance", 60)
    if (job.get("units") or 1) > 1:
        m += d.get("multi_unit_add", 30) * ((job.get("units") or 1) - 1)
    return int(m)


def stops_for(db: DB, tech_id: int, date: str, exclude_job_id: Optional[int] = None) -> list[dict]:
    """Real stops (route_date from DispatchTrack or a dashboard booking) plus soft pencils, in route order."""
    real = db.fetchall("SELECT j.*, 0 AS penciled FROM job j WHERE j.assigned_tech_id=? AND j.route_date=? AND j.closed_at IS NULL AND j.stale=0 "
                       "AND j.status NOT IN ('SO9','SO7','SO8','SO8I') ORDER BY j.route_sequence, j.job_id", (tech_id, date))
    soft = db.fetchall("SELECT j.*, 1 AS penciled FROM job j WHERE j.penciled_tech_id=? AND j.penciled_date=? AND j.closed_at IS NULL "
                       "AND j.status IN ('SO4','SO4B','SO4H','SO5') ORDER BY j.job_id", (tech_id, date))
    return [s for s in real + soft if s["job_id"] != exclude_job_id]


def day_load(db: DB, tech_id: int, date: str, exclude_job_id: Optional[int] = None) -> dict:
    stops = stops_for(db, tech_id, date, exclude_job_id)
    pts = [location(db, s) for s in stops]
    work = sum(est_minutes(db, s) for s in stops)
    start, end = route_endpoints(db, tech_id, date)      # 9/18: the first leg is from wherever this tech starts that weekday
    drive, cur = 0, start
    for p in pts:
        if p is not None:
            drive += _drive(db, cur, p)
            cur = p
    drive += _drive(db, cur, end) if stops else 0
    o = tech_day(db, tech_id, date) or {}
    cap = db.setting("placement.shift_min", 540) + (o.get("capacity_adjust_min") or 0) - blocked_minutes(db, tech_id, date)
    return {"stops": stops, "points": pts, "work": work, "drive": drive, "capacity": cap, "remaining": cap - work - drive, "start": start, "end": end}


def marginal_drive(db: DB, pts: list, here, ends: tuple = (SHOP, SHOP)) -> tuple[int, int]:
    """Cheapest insertion of `here` into start→p1→…→pn→end (both ends the shop unless route_endpoints says otherwise).
    Returns (added minutes, insert index)."""
    if here is None:
        return 0, len(pts)
    start, end = ends
    route = [start] + [p for p in pts if p is not None] + [end]
    if len(route) == 2:
        return _drive(db, start, here) + _drive(db, here, end), 0
    best, at = None, 0
    for i in range(len(route) - 1):
        a, b = route[i], route[i + 1]
        added = _drive(db, a, here) + _drive(db, here, b) - _drive(db, a, b)
        if best is None or added < best:
            best, at = added, i
    return max(best, 0), at


# ------------------------------------------------------------------ eligibility
def _skills(t: dict) -> list[str]:
    try:
        return [s.lower() for s in json.loads(t.get("skills") or "[]")]
    except Exception:
        return [s.strip().lower() for s in (t.get("skills") or "").split(",")]


def eligible_techs(db: DB, job: dict) -> list[dict]:
    """The owning tech when there is one; otherwise active, auto-scheduled techs with the skill."""
    if job.get("owner_tech_id"):
        t = db.fetchone("SELECT * FROM tech WHERE tech_id=?", (job["owner_tech_id"],))
        return [t] if t else []
    need = "hvac" if (job.get("job_type") == "hvac" or job.get("qualification") == "HVAC") else "appliance"
    out = []
    for t in db.fetchall("SELECT * FROM tech WHERE active=1 ORDER BY sp_code"):
        if not t.get("auto_schedule"):
            continue
        sk = _skills(t)
        if need == "hvac" and not any(s.startswith("hvac") for s in sk):
            continue
        if need == "appliance" and "appliance" not in sk:
            continue
        out.append(t)
    return out


def _zone_rank(db: DB, zone_code: Optional[str], sp_code: str) -> int:
    """0 primary, 1 secondary, 2 other/unknown zone."""
    if not zone_code:
        return 1
    z = db.fetchone("SELECT primary_tech, secondary_techs FROM zone WHERE zone_code=?", (zone_code,))
    if not z:
        return 2
    if (z.get("primary_tech") or "") == sp_code:
        return 0
    if sp_code in (z.get("secondary_techs") or "").replace(",", " ").split():
        return 1
    return 2


# ------------------------------------------------------------------ scoring
def suggest(db: DB, job_id: int, *, earliest: Optional[str] = None, horizon_bd: Optional[int] = None, now: Optional[_dt.datetime] = None,
            limit: int = 5) -> list[dict]:
    """Ranked candidates for one job. Lower cost is better. `why` is the sentence the board shows."""
    now = now or _dt.datetime.now()
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job:
        raise ValueError(f"job {job_id} not found")
    today = now.date().isoformat()
    earliest = _next_weekday(max(earliest or business_days_after(today, 1), business_days_after(today, 1)))
    horizon_bd = horizon_bd or db.setting("placement.horizon_business_days", 10)
    here = location(db, job)
    need = est_minutes(db, job)
    zone = job.get("zone_code")
    defer = db.setting("placement.defer_min_per_day", 8)
    soft_days = db.setting("placement.defer_soft_days", 2)
    defer_late = db.setting("placement.defer_min_per_day_late", 20)
    bonus = db.setting("placement.same_zone_bonus_min", 6)
    pen_sec = db.setting("placement.zone_secondary_penalty_min", 10)
    pen_oth = db.setting("placement.zone_other_penalty_min", 40)
    slack = db.setting("placement.min_slack_min", 25)
    techs = eligible_techs(db, job)
    out = []
    d = earliest
    for _ in range(horizon_bd):
        for t in techs:
            if not is_open(db, t["tech_id"], d):
                continue
            load = day_load(db, t["tech_id"], d, exclude_job_id=job_id)
            added, at = marginal_drive(db, load["points"], here, ends=(load["start"], load["end"]))
            if load["remaining"] - need - added < slack:
                continue
            same = sum(1 for s in load["stops"] if zone and s.get("zone_code") == zone)
            rank = _zone_rank(db, zone, t["sp_code"])
            wait = business_days_between(earliest, d)
            # a day or two of waiting is cheap if it saves real driving; beyond that the customer's wait dominates
            wait_cost = defer * min(wait, soft_days) + defer_late * max(wait - soft_days, 0)
            cost = added - bonus * min(same, 3) + wait_cost + (0, pen_sec, pen_oth)[rank]
            n = len(load["stops"])
            why = (f"{t['sp_code']} has {same} stop{'s' if same != 1 else ''} in {zone} that day" if same else
                   f"{t['sp_code']} has {n} stop{'s' if n != 1 else ''} that day" if n else f"{t['sp_code']}'s day is empty")
            why += f" · +{added} min drive · {_hm(load['remaining'] - need - added)} left" + (" · primary tech" if rank == 0 else " · secondary" if rank == 1 else " · not this zone's tech")
            window = "AM" if at <= max(len(load["points"]), 1) // 2 else "PM"
            out.append({"tech_id": t["tech_id"], "sp_code": t["sp_code"], "date": d, "window": window, "cost": int(round(cost)), "added_drive": added, "same_zone": same,
                        "stops": n, "remaining_after": load["remaining"] - need - added, "zone_rank": rank, "wait_days": wait, "why": why})
        d = business_days_after(d, 1)
    out.sort(key=lambda c: (c["cost"], c["date"], c["sp_code"]))
    for i, c in enumerate(out):
        c["rank"] = i + 1
    return out[:limit]


def _hm(m: int) -> str:
    m = max(int(m), 0)
    return f"{m // 60}h {m % 60:02d}m" if m >= 60 else f"{m}m"


# ------------------------------------------------------------------ the SO4 pencil
def pencil(db: DB, job_id: int, by: str, now: Optional[_dt.datetime] = None) -> Optional[dict]:
    """Once Kezia's ETA is on the job: soft-hold the best-fit tech/day `pencil.business_days_after_eta` after the part lands.
    Dashboard-only (nothing goes to ePASS); counts against that day's capacity; re-run whenever the ETA moves."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job or not db.setting("pencil.enabled", True):
        return None
    if job["status"] not in PENCILABLE or not job.get("parts_eta"):
        return None
    earliest = business_days_after(str(job["parts_eta"])[:10], db.setting("pencil.business_days_after_eta", 2))
    cands = suggest(db, job_id, earliest=earliest, now=now, limit=200)
    before = {"tech": job.get("penciled_tech_id"), "date": str(job.get("penciled_date") or "")[:10] or None}
    if cands and before["tech"]:
        # hysteresis: keep the current pencil unless a clearly better day appeared (routes shift every import)
        cur = next((c for c in cands if c["tech_id"] == before["tech"] and c["date"] == before["date"]), None)
        if cur and cands[0]["cost"] >= cur["cost"] - db.setting("pencil.move_threshold_min", 15):
            return cur
    cands = cands[:3]
    if not cands:
        _flag(db, job, add={"pencil_failed"}, remove={"penciled"})
        db.insert("outbox", {"job_id": job_id, "effect": "task:dispatcher_place", "payload": json.dumps({"reason": "no open day fits", "earliest": earliest}), "created_at": ts, "handled_at": None})
        db.update("job", {"job_id": job_id}, {"penciled_tech_id": None, "penciled_date": None, "pencil_reason": f"no fit from {earliest}", "pencil_set_at": ts})
        return None
    best = cands[0]
    if before["tech"] == best["tech_id"] and str(before["date"] or "")[:10] == best["date"]:
        return best  # unchanged
    db.update("job", {"job_id": job_id}, {"penciled_tech_id": best["tech_id"], "penciled_date": best["date"], "pencil_reason": best["why"][:200], "pencil_set_at": ts, "updated_at": ts})
    _flag(db, job, add={"penciled"}, remove={"pencil_failed"})
    db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "placement.penciled", "entity": "job", "entity_id": str(job_id),
                            "before_json": json.dumps(before, default=str), "after_json": json.dumps({"tech": best["tech_id"], "date": best["date"], "why": best["why"], "eta": str(job["parts_eta"])[:10]})})
    log_suggestion(db, job_id, "pencil", cands, now=now)
    return best


def unpencil(db: DB, job_id: int, by: str, reason: str, now: Optional[_dt.datetime] = None) -> None:
    ts = now_iso(now)
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job or not job.get("penciled_date"):
        return
    db.update("job", {"job_id": job_id}, {"penciled_tech_id": None, "penciled_date": None, "pencil_reason": None, "pencil_set_at": ts})
    _flag(db, job, add=set(), remove={"penciled", "pencil_failed"})
    db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "placement.unpenciled", "entity": "job", "entity_id": str(job_id),
                            "before_json": json.dumps({"tech": job.get("penciled_tech_id"), "date": str(job.get("penciled_date"))}), "after_json": json.dumps({"reason": reason})})


def repencil_all(db: DB, by: str = "engine", now: Optional[_dt.datetime] = None) -> int:
    n = 0
    for j in db.fetchall("SELECT job_id FROM job WHERE status IN ('SO4','SO4B','SO4H') AND parts_eta IS NOT NULL AND closed_at IS NULL"):
        if pencil(db, j["job_id"], by, now=now):
            n += 1
    return n


def _flag(db: DB, job: dict, *, add: set, remove: set) -> None:
    flags = set(f for f in (job.get("flags") or "").split(",") if f)
    flags = (flags - remove) | add
    db.update("job", {"job_id": job["job_id"]}, {"flags": ",".join(sorted(flags)) or None})
    job["flags"] = ",".join(sorted(flags)) or None


# ------------------------------------------------------------------ what the customer sees
def offer(db: DB, job_id: int, now: Optional[_dt.datetime] = None) -> list[dict]:
    """Dates for the picker — the offer window (spec §4.3, Cayden 9/17 pm).

    E = first open capacity. B = the cheapest candidate no more than `offer.hold_max_business_days` (3)
    business days after E. **The customer's calendar starts on B's day**: dates before it are not offered,
    B comes first, and it is labelled "Earliest available" — never "best fit" — because from where the
    customer stands it is. A penciled day (SO5 after a pencil) is B by definition. The 9/14 version led
    with a labelled best fit and kept the earlier day visible; the test bench showed a customer takes the
    earlier day every time, so that is gone. `offer.route_first=0` turns the hold off (B = E)."""
    now = now or _dt.datetime.now()
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job:
        raise ValueError(f"job {job_id} not found")
    earliest = None
    if job.get("parts_eta") and job["status"] in PENCILABLE:
        earliest = business_days_after(str(job["parts_eta"])[:10], 1)
    cands = suggest(db, job_id, earliest=earliest, now=now, limit=500)
    by_date: dict[str, dict] = {}
    for c in cands:                       # best tech per date
        if c["date"] not in by_date or c["cost"] < by_date[c["date"]]["cost"]:
            by_date[c["date"]] = c
    dates = sorted(by_date.values(), key=lambda c: c["date"])
    if not dates:
        return []
    first_open = dates[0]["date"]
    hold_bd = db.setting("offer.hold_max_business_days", 3)
    pick = None
    if job.get("penciled_date") and str(job["penciled_date"])[:10] in by_date:
        pick = by_date[str(job["penciled_date"])[:10]]
        pick["label"] = "Earliest available — your installer is already nearby"
    elif db.setting("offer.route_first", True):
        within = [c for c in dates if business_days_between(first_open, c["date"]) <= hold_bd]
        pick = min(within, key=lambda c: c["cost"]) if within else dates[0]
        pick["label"] = ("Earliest available — and our route is already in your area" if pick["same_zone"]
                         else "Earliest available")
    else:
        pick = dates[0]
        pick["label"] = "Earliest available"
    start = pick["date"]
    ordered = [pick] + [c for c in dates if c["date"] > start]          # the calendar starts on our day
    n = db.setting("booking.max_offers", 7)
    out = ordered[:n]
    for i, c in enumerate(out):
        c["recommended"] = (i == 0)
        c["held_business_days"] = business_days_between(first_open, start) if i == 0 else 0
        c.setdefault("label", "")
    return out


# ------------------------------------------------------------------ the scorecard
def log_suggestion(db: DB, job_id: int, kind: str, cands: list[dict], now: Optional[_dt.datetime] = None) -> Optional[int]:
    if not cands:
        return None
    best = cands[0]
    return db.insert("placement_log", {"job_id": job_id, "kind": kind, "suggested_at": now_iso(now), "suggested_tech_id": best["tech_id"], "suggested_date": best["date"],
                                       "suggested_window": best.get("window"), "cost_min": best["cost"], "why": best["why"][:240],
                                       "candidates_json": json.dumps([{k: c[k] for k in ("sp_code", "date", "cost", "why")} for c in cands[:5]]),
                                       "actual_tech_id": None, "actual_date": None, "actual_at": None, "actual_source": None, "agree_day": None, "agree_tech": None, "note": None})


def record_actual(db: DB, job_id: int, tech_id: Optional[int], date: Optional[str], source: str, now: Optional[_dt.datetime] = None, note: Optional[str] = None) -> int:
    """Fill the open suggestion rows for this job with what really happened (ePASS booking seen by the import, or a dashboard booking)."""
    ts = now_iso(now)
    rows = db.fetchall("SELECT * FROM placement_log WHERE job_id=? AND actual_at IS NULL", (job_id,))
    for r in rows:
        db.update("placement_log", {"placement_id": r["placement_id"]}, {
            "actual_tech_id": tech_id, "actual_date": date, "actual_at": ts, "actual_source": source,
            "agree_day": 1 if (date and str(r.get("suggested_date") or "")[:10] == str(date)[:10]) else 0,
            "agree_tech": 1 if (tech_id and r.get("suggested_tech_id") == tech_id) else 0, "note": (note or "")[:200] or None})
    return len(rows)


def scorecard(db: DB, since: Optional[str] = None) -> dict:
    rows = db.fetchall("SELECT p.*, j.sv_number, t1.sp_code AS suggested_sp, t2.sp_code AS actual_sp FROM placement_log p JOIN job j ON j.job_id=p.job_id "
                       "LEFT JOIN tech t1 ON t1.tech_id=p.suggested_tech_id LEFT JOIN tech t2 ON t2.tech_id=p.actual_tech_id ORDER BY p.suggested_at")
    if since:
        rows = [r for r in rows if str(r["suggested_at"])[:10] >= since]
    decided = [r for r in rows if r.get("actual_at")]
    out = {"suggested": len(rows), "decided": len(decided), "open": len(rows) - len(decided),
           "agree_day": sum(1 for r in decided if r.get("agree_day")), "agree_tech": sum(1 for r in decided if r.get("agree_tech")),
           "agree_both": sum(1 for r in decided if r.get("agree_day") and r.get("agree_tech")), "misses": []}
    for r in decided:
        if not (r.get("agree_day") and r.get("agree_tech")):
            out["misses"].append({"sv": r.get("sv_number"), "kind": r["kind"], "suggested": f"{r.get('suggested_sp')} {str(r.get('suggested_date'))[:10]}",
                                  "actual": f"{r.get('actual_sp') or '—'} {str(r.get('actual_date') or '—')[:10]}", "why": r.get("why")})
    return out

"""ePASS sync queue (spec §3.5): paste-ready packets, confirmation by import, discrepancies.

Lifecycle:  pending -> keyed (staff tapped Keyed) -> confirmed (an import shows every payload
field matching).  Two consecutive imports after keyed_at that still mismatch -> discrepancy,
with the ePASS values attached.  Resolution: 'reissue' (back to pending) or 'accept_epass'
(write the ePASS values into the dashboard fields).

Reverse discrepancy: an import shows ePASS status/date/tech different from the dashboard and
no open sync item explains it -> a set_status item is created directly in 'discrepancy'.
Jobs the dashboard has never touched (source='import') simply follow ePASS instead.
"""
from __future__ import annotations

import datetime as _dt
import json
from typing import Optional

from .db import DB, now_iso
from .importers.common import digits, tech_id_for

OPEN_STATES = ("pending", "keyed")
# ---- 9/18: 'lines' = approved estimate lines + SO3 for the office to key (handoff.record_response); 'new_ticket' = a
# self-booked request that needs an ePASS ticket, keyed when the office links the SV (handoff.link_ticket)
KINDS = ("create_ticket", "set_status", "set_schedule", "add_lines", "post_payment", "close", "note", "lines", "new_ticket")
_TICKET_KINDS = ("create_ticket", "new_ticket")
_LENIENT = {frozenset({"SO4PRE", "SO6"})}  # ePASS often shows SO6 where the dashboard holds SO4PRE (and back) for one cycle


# ------------------------------------------------------------------ packet rendering
def _fmt_date(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    d = _dt.date.fromisoformat(str(iso)[:10])
    return f"{d.month}/{d.day}/{d.year}"


def _fmt_window(w: Optional[str]) -> Optional[str]:
    return {"AM": "8–12", "PM": "12–5", "am": "8–12", "pm": "12–5"}.get(w or "", w)


def render_packet(sv_number: Optional[str], customer_name: str, kind: str, p: dict) -> str:
    """Fixed shape from spec §3.5. Only the lines that carry information are emitted."""
    head = f"{sv_number or 'NEW TICKET'}  {customer_name}".rstrip()
    lines = [head]
    if kind in _TICKET_KINDS:
        c = p.get("customer", {})
        a = p.get("address", {})
        u = p.get("unit", {})
        addr = ", ".join(x for x in [a.get("line1"), a.get("line2"), a.get("city"), a.get("zip")] if x)
        lines.append(f"CUSTOMER: {c.get('phone') or '—'}   {c.get('email') or ''}".rstrip())
        lines.append(f"ADDRESS: {addr}")
        unit_bits = " ".join(str(u.get(k)) for k in ("category", "brand", "model", "serial") if u.get(k))
        if unit_bits:
            lines.append(f"UNIT: {unit_bits}")
        if p.get("problem"):
            lines.append(f"PROBLEM: {str(p['problem'])[:200]}")
    status_bits = []
    if p.get("status"):
        status_bits.append(f"STATUS: {p['status']}")
    if p.get("route_date"):
        status_bits.append(f"DATE: {_fmt_date(p['route_date'])}")
    if p.get("window"):
        status_bits.append(f"WINDOW: {_fmt_window(p['window'])}")
    if p.get("tech"):
        status_bits.append(f"TECH: {p['tech']}")
    if status_bits:
        lines.append("   ".join(status_bits))
    if p.get("lines"):
        lines.append("LINES:")
        for ln in p["lines"]:
            code = str(ln.get("code") or "LAB")
            price = ln.get("price") if ln.get("price") is not None else ln.get("amount")   # 9/18: labor.py lines carry `amount`
            lines.append(f"  {code:<12} {ln.get('desc', '')}  x{ln.get('qty', 1)}  ${float(price or 0):,.2f}")
        if p.get("total") is not None:
            lines.append(f"TOTAL: ${float(p['total']):,.2f}")
    if p.get("payment"):
        pay = p["payment"]
        lines.append(f"PAYMENT: ${float(pay.get('amount') or 0):,.2f} {pay.get('method', 'card')} {pay.get('ref', '')}".rstrip())
    if p.get("note"):
        lines.append(f"NOTE: {p['note']}")
    return "\n".join(lines)


def build_note(*, sv_number: str, field_approved_total: Optional[float] = None, signed_at: Optional[str] = None, summary: str = "",
               labor_exempt: bool = False, photo_count: int = 0) -> str:
    """`[FIELD-APPROVED $total signed <ts>. ]<summary>. [Labor tax-exempt (built-in). ]Full findings + N photos: dashboard <sv>.`"""
    parts = []
    if field_approved_total is not None:
        parts.append(f"FIELD-APPROVED ${field_approved_total:,.2f} signed {signed_at or ''}.".replace(" .", "."))
    s = (summary or "").strip().rstrip(".")
    if s:
        parts.append(s[:200] + ".")
    if labor_exempt:
        parts.append("Labor tax-exempt (built-in).")
    parts.append(f"Full findings + {photo_count} photos: dashboard {sv_number}.")
    return " ".join(parts)


# ------------------------------------------------------------------ creation and staff actions
def create_item(db: DB, job: dict, kind: str, payload: dict, *, note: Optional[str] = None, now: Optional[str] = None) -> int:
    assert kind in KINDS, kind
    now = now or now_iso()
    cust = db.fetchone("SELECT display_name FROM customer WHERE customer_id=?", (job.get("customer_id"),)) or {}
    if note and not payload.get("note"):
        payload = dict(payload, note=note)
    packet = render_packet(job.get("sv_number"), cust.get("display_name") or "", kind, payload)
    return db.insert("sync_item", {
        "job_id": job["job_id"], "sv_number": job.get("sv_number"), "kind": kind, "payload": json.dumps(payload, default=str), "packet_text": packet,
        "state": "pending", "created_at": now, "keyed_at": None, "keyed_by": None, "confirmed_at": None, "confirmed_by_import_id": None,
        "epass_values": None, "mismatch_count": 0, "resolved_at": None, "resolved_by": None, "resolution": None, "note": note,
    })


def mark_keyed(db: DB, sync_id: int, user: str, now: Optional[str] = None) -> None:
    item = db.fetchone("SELECT * FROM sync_item WHERE sync_id=?", (sync_id,))
    if not item or item["state"] != "pending":
        raise ValueError(f"sync item {sync_id} is not pending")
    db.update("sync_item", {"sync_id": sync_id}, {"state": "keyed", "keyed_at": now or now_iso(), "keyed_by": user, "mismatch_count": 0})


def resolve(db: DB, sync_id: int, resolution: str, user: str, now: Optional[str] = None) -> None:
    """resolution: 'reissue' -> back to pending; 'accept_epass' -> dashboard takes the ePASS values."""
    now = now or now_iso()
    item = db.fetchone("SELECT * FROM sync_item WHERE sync_id=?", (sync_id,))
    if not item or item["state"] != "discrepancy":
        raise ValueError(f"sync item {sync_id} is not in discrepancy")
    if resolution == "reissue":
        db.update("sync_item", {"sync_id": sync_id}, {"state": "pending", "keyed_at": None, "keyed_by": None, "mismatch_count": 0, "epass_values": None,
                                                      "resolution": "reissued", "note": f"re-issued by {user} {now}"})
        return
    if resolution != "accept_epass":
        raise ValueError("resolution must be 'reissue' or 'accept_epass'")
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (item["job_id"],))
    ev = json.loads(item["epass_values"] or "{}")
    changes = {}
    if ev.get("status") and ev["status"] != job["status"]:
        changes.update({"status": ev["status"], "status_changed_at": now})
        db.insert("status_history", {"job_id": job["job_id"], "from_status": job["status"], "to_status": ev["status"], "changed_at": now, "actor_type": "staff",
                                     "actor_id": user, "trigger_event": "epass_accept", "reason_code": "accept_epass", "note": f"sync item {sync_id}"})
    if "route_date" in ev and ev["route_date"] != job.get("route_date"):
        changes["route_date"] = ev["route_date"]
    if "tech" in ev:
        tid = tech_id_for(db, ev["tech"])
        if tid != job.get("assigned_tech_id"):
            changes["assigned_tech_id"] = tid
    if changes:
        changes["updated_at"] = now
        db.update("job", {"job_id": job["job_id"]}, changes)
    db.update("sync_item", {"sync_id": sync_id}, {"state": "resolved", "resolved_at": now, "resolved_by": user, "resolution": "accept_epass"})


def open_items(db: DB, state: Optional[str] = None) -> list[dict]:
    if state:
        return db.fetchall("SELECT * FROM sync_item WHERE state=? ORDER BY created_at", (state,))
    return db.fetchall("SELECT * FROM sync_item WHERE state IN ('pending','keyed','discrepancy') ORDER BY CASE state WHEN 'discrepancy' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, created_at")


# ------------------------------------------------------------------ reconciliation after an import
def _epass_view(db: DB, job: dict) -> dict:
    return {"status": job.get("epass_status"), "route_date": job.get("epass_route_date"), "tech": job.get("epass_tech_code") or None}


def _status_eq(a, b) -> bool:
    return a == b or (a and b and frozenset({a, b}) in _LENIENT)


def _payload_matches(payload: dict, ev: dict, source: str) -> Optional[bool]:
    """True/False, or None when this import cannot tell (e.g. DT feed does not carry the status keyed)."""
    checks = []
    if payload.get("status"):
        if source == "DT" and payload["status"] not in ("SO1", "SO4PRE", "SO5", "SO6") and ev.get("status") in (None, ""):
            return None
        checks.append(_status_eq(payload["status"], ev.get("status")))
    if payload.get("route_date"):
        checks.append(str(payload["route_date"])[:10] == (ev.get("route_date") or ""))
    if payload.get("tech"):
        checks.append(_same_tech(payload["tech"], ev.get("tech")))
    if not checks:
        return None
    return all(checks)


def _same_tech(a, b) -> bool:
    a, b = (a or "").strip().upper(), (b or "").strip().upper()
    return a == b or {a, b} in ({"KJB", "KJB2"}, {"VWJ", "VJ"})


def reconcile_after_import(db: DB, batch_id: int, seen: dict, *, source: str, now: _dt.datetime) -> dict:
    """seen: {sv_number: job_id} for every job present in this import. Returns counts."""
    ts = now_iso(now)
    n_before = db.setting("sync.mismatch_cycles_before_discrepancy", 2)
    follow = db.setting("sync.follow_epass_for_import_jobs", True)
    counts = {"confirmed": 0, "mismatched": 0, "discrepancies": 0, "reverse": 0, "followed": 0}
    for sv, job_id in seen.items():
        job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
        if not job:
            continue
        ev = _epass_view(db, job)
        items = db.fetchall("SELECT * FROM sync_item WHERE job_id=? AND state IN ('pending','keyed') ORDER BY created_at", (job_id,))
        for it in items:
            payload = json.loads(it["payload"] or "{}")
            m = _payload_matches(payload, ev, source)
            if m is True:
                db.update("sync_item", {"sync_id": it["sync_id"]}, {"state": "confirmed", "confirmed_at": ts, "confirmed_by_import_id": batch_id,
                                                                    "epass_values": json.dumps(ev)})
                counts["confirmed"] += 1
            elif m is False and it["state"] == "keyed":
                mc = (it["mismatch_count"] or 0) + 1
                upd = {"mismatch_count": mc, "epass_values": json.dumps(ev)}
                if mc >= n_before:
                    upd["state"] = "discrepancy"
                    counts["discrepancies"] += 1
                else:
                    counts["mismatched"] += 1
                db.update("sync_item", {"sync_id": it["sync_id"]}, upd)
        if items:
            continue  # an open item explains any difference
        # no open item: does ePASS disagree with the dashboard?
        dash = {"status": job.get("status"), "route_date": job.get("route_date"), "tech": _sp_code(db, job.get("assigned_tech_id"))}
        diff = {}
        if ev["status"] and not _status_eq(ev["status"], dash["status"]):
            diff["status"] = ev["status"]
        if ev["route_date"] != dash["route_date"] and (job.get("in_feed") or source == "EI"):
            diff["route_date"] = ev["route_date"]
        if tech_id_for(db, ev["tech"]) != job.get("assigned_tech_id") and job.get("in_feed"):
            diff["tech"] = ev["tech"]
        if not diff:
            continue
        # ---- 9/18: the ePASS watch. After an estimate hand-off the office orders and receives in ePASS, so SO4* / SO5
        # showing up there is the plan working, not a discrepancy: read it back (pencil on SO4, customer text on SO5).
        if "status" in diff:
            from . import handoff
            if handoff.watch_epass_status(db, job, diff["status"], source=source, batch_id=batch_id, now=ts):
                counts["followed"] += 1
                diff.pop("status")
                if not diff:
                    continue
                job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
                dash["status"] = job["status"]
        if job.get("source") == "import" and follow:
            changes = {"updated_at": ts}
            if "status" in diff:
                changes.update({"status": diff["status"], "status_changed_at": ts})
                db.insert("status_history", {"job_id": job_id, "from_status": dash["status"], "to_status": diff["status"], "changed_at": ts, "actor_type": "import",
                                             "actor_id": source, "trigger_event": "epass_follow", "reason_code": None, "note": f"batch {batch_id}"})
            if "route_date" in diff:
                changes["route_date"] = diff["route_date"]
            if "tech" in diff:
                changes["assigned_tech_id"] = tech_id_for(db, diff["tech"])
            db.update("job", {"job_id": job_id}, changes)
            counts["followed"] += 1
            continue
        already = db.fetchone("SELECT sync_id, epass_values FROM sync_item WHERE job_id=? AND state='discrepancy' ORDER BY created_at DESC", (job_id,))
        if already and json.loads(already["epass_values"] or "{}") == ev:
            continue
        cust = db.fetchone("SELECT display_name FROM customer WHERE customer_id=?", (job.get("customer_id"),)) or {}
        payload = {"status": dash["status"], "route_date": dash["route_date"], "tech": dash["tech"],
                   "note": "ePASS differs from dashboard with no sync item explaining it. Accept ePASS or re-issue."}
        db.insert("sync_item", {
            "job_id": job_id, "sv_number": sv, "kind": "set_status", "payload": json.dumps(payload), "packet_text": render_packet(sv, cust.get("display_name") or "", "set_status", payload),
            "state": "discrepancy", "created_at": ts, "keyed_at": None, "keyed_by": None, "confirmed_at": None, "confirmed_by_import_id": batch_id,
            "epass_values": json.dumps(ev), "mismatch_count": 0, "resolved_at": None, "resolved_by": None, "resolution": None,
            "note": f"reverse discrepancy from {source} batch {batch_id}: ePASS {ev} vs dashboard {dash}",
        })
        counts["reverse"] += 1
    return counts


def _sp_code(db: DB, tech_id) -> Optional[str]:
    if not tech_id:
        return None
    r = db.fetchone("SELECT sp_code FROM tech WHERE tech_id=?", (tech_id,))
    return r["sp_code"] if r else None


def match_create_ticket(db: DB, sv: str, *, phone, last_name, zip_code, now: str) -> Optional[dict]:
    """An SV appeared in ePASS that the dashboard does not know. It is attached to a dashboard job (sv_number set) when
    the customer phone, or a name token + zip, matches either (a) a job with an open create_ticket item, or (b) — 9/14,
    the shadow test — a dashboard-created request (REQ/SO1.AUTH/SO1, no SV yet) newer than intake.match_window_days.
    Open create_ticket items are confirmed; otherwise a status_history row 'epass_attach' records the match."""
    window = db.setting("intake.match_window_days", 14)
    since = (_dt.datetime.fromisoformat(now.replace("T", " ")[:19]) - _dt.timedelta(days=window)).strftime("%Y-%m-%d %H:%M:%S")
    rows = db.fetchall("SELECT j.job_id, j.status, j.created_at, c.phone_primary, c.phone_alt, c.last_name, c.display_name, a.zip, "
                       "(SELECT MIN(s.sync_id) FROM sync_item s WHERE s.job_id=j.job_id AND s.kind='create_ticket' AND s.state IN ('pending','keyed')) AS sync_id "
                       "FROM job j LEFT JOIN customer c ON c.customer_id=j.customer_id LEFT JOIN address a ON a.address_id=j.address_id "
                       "WHERE j.sv_number IS NULL AND j.source<>'import' AND j.closed_at IS NULL AND j.status NOT IN ('SO9') ORDER BY j.created_at DESC")
    cands = [r for r in rows if r.get("sync_id") or (r["status"] in ("REQ", "SO1.AUTH", "SO1") and str(r.get("created_at") or "") >= since)]
    if not cands:
        return None
    pd = digits(phone)[-10:] if phone else ""
    tokens = {t.upper() for t in str(last_name or "").replace("&", " ").replace(",", " ").split() if len(t) > 1}
    z = str(zip_code or "").strip()[:5]
    for it in cands:
        phones = {digits(it.get("phone_primary"))[-10:], digits(it.get("phone_alt"))[-10:]} - {""}
        name_ok = bool(tokens and it.get("last_name") and it["last_name"].upper() in tokens and z and it.get("zip") == z)
        if (pd and pd in phones) or name_ok:
            db.update("job", {"job_id": it["job_id"]}, {"sv_number": sv, "updated_at": now})
            if it.get("sync_id"):
                db.update("sync_item", {"sync_id": it["sync_id"]}, {"state": "confirmed", "confirmed_at": now, "sv_number": sv, "note": f"matched ePASS ticket {sv}"})
            else:
                db.insert("status_history", {"job_id": it["job_id"], "from_status": it["status"], "to_status": it["status"], "changed_at": now, "actor_type": "import",
                                             "actor_id": "epass", "trigger_event": "epass_attach", "reason_code": None,
                                             "note": f"{sv} keyed in ePASS matched this request by {'phone' if pd and pd in phones else 'name + zip'}"})
            return db.fetchone("SELECT * FROM job WHERE job_id=?", (it["job_id"],))
    return None

"""Status engine (spec §2). Statuses are earned, not typed.

    transition(db, job_id, event, actor_type, actor_id, reason_code=None, **ctx)

An event fires, the engine finds the rule for (current status, event, ctx), checks the guard,
applies the transition, writes status_history, then runs side effects in order. Side effects
that leave the dashboard (ePASS packets, texts, payments) are queued: sync items go to
`sync_item`, everything else to `outbox` for the Phase 1+ workers (Podium, Stripe).
Anything not in the table is a manual change and requires `reason_code`.
"""
from __future__ import annotations

import datetime as _dt
import json
from typing import Callable, Optional

from .db import DB, now_iso
from . import sync
from .importers.common import tech_id_for

OPEN_TERMINAL = ("SO7", "SO8", "SO8I", "SO9")
DIAG_FEE_KEY = "fee.diagnostic"


class TransitionError(Exception):
    """No rule matches (or manual change without reason_code)."""


class GuardFailed(Exception):
    """A rule matched but its guard rejected the event."""


# ------------------------------------------------------------------ guards (job, ctx) -> error message or None
def g_slot(job, ctx):
    if not ctx.get("route_date") or ctx.get("window") not in ("AM", "PM"):
        return "route_date (yyyy-mm-dd) and window (AM|PM) are required"
    return None


def g_signature(job, ctx):
    if not (ctx.get("signature") and ctx.get("agree")):
        return "field approval needs a stored signature and agree=true"
    return None


def g_note(job, ctx):
    return None if (ctx.get("note") or "").strip() else "a note is required for this outcome"


def g_owner_only(job, ctx):
    tid = ctx.get("tech_id")
    if job.get("owner_tech_id") and tid and tid != job["owner_tech_id"] and not ctx.get("reason_code"):
        return "installs go to the diagnosing tech; give reason_code to override"
    return None


def g_parts_installed(job, ctx):
    return None if ctx.get("all_parts_installed", True) else "mark every part line installed (or report an issue) first"


def g_lines(job, ctx):
    return None if ctx.get("lines") else "at least one part or labor line is required"


def g_parts_not_in(job, ctx):
    return None if not ctx.get("all_parts_received", False) else "every part is already received — confirm the hold instead (rule 24)"


def g_amount_matches(job, ctx):
    if job.get("total") is not None and ctx.get("amount") is not None and round(float(ctx["amount"]), 2) != round(float(job["total"]), 2):
        return "payment amount differs from approved total"
    return None


# ------------------------------------------------------------------ target-status helpers
def _po_target(job, ctx):
    if ctx.get("ship_to") == "customer":
        return "SO4H"
    return "SO4B" if (ctx.get("eta_days") or 0) > ctx.get("_backorder_days", 10) else "SO4"


def _verified_target(job, ctx):
    if ctx.get("quote_kind") == "field":
        return "SO3" if ctx.get("requote_ok", True) else "SO2.2"
    return "SO2.1"


def _eta_changed_target(job, ctx):
    if job["status"] == "SO4PRE" and ctx.get("eta_after_held"):
        return "SO4"
    return job["status"]


def _cancel_target(job, ctx):
    return "SO9"


# ------------------------------------------------------------------ the table
# from: set of statuses | "open" (any non-terminal) | "any"; when: extra ctx match; to: str or fn(job, ctx)
RULES: list[dict] = [
    dict(id=2, frm={"REQ"}, event={"customer.picked_window", "staff.booked"}, guard=g_slot, to="SO1", effects=["book_diag", "sync_create_ticket", "notify:so1_booked"]),
    dict(id=3, frm={"SO1.AUTH"}, event={"auth.received"}, to="REQ", effects=[]),
    dict(id=4, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="field_quote", decision="approve"), only_if=lambda c: (c.get("parts_count") or 0) > 0,
         guard=g_signature, to="SO3", effects=["set_owner", "record_visit", "quote_field_approved", "sync_set_status_lines", "notify:approved_ordering"]),
    dict(id=5, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="field_quote", decision="approve"), only_if=lambda c: (c.get("parts_count") or 0) == 0,
         guard=g_signature, to="SO1", effects=["set_owner", "record_visit", "quote_field_approved", "flag:repair_in_progress"]),
    dict(id=6, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="field_quote", decision="later"), to="SO2", effects=["set_owner", "record_visit", "quote_field_draft", "task:parts_verify"]),
    dict(id=7, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="field_quote", decision="decline"), to="SO7", effects=["set_owner", "record_visit", "payment:diag_fee", "notify:declined_receipt", "task:sales_lead"]),
    dict(id=8, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="office_quote"), guard=g_lines, to="SO2", effects=["set_owner", "record_visit", "quote_office_draft", "task:parts_verify"]),
    dict(id=9, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="quick_fix"), to="SO8", effects=["set_owner", "record_visit", "payment:diag_fee", "notify:receipt", "sync_set_status"]),
    dict(id=10, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="research"), guard=g_note, to="SO1", effects=["set_owner", "record_visit", "flag:research", "task:manager"]),
    dict(id=11, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="replace"), guard=g_note, to="SO7", effects=["set_owner", "record_visit", "payment:diag_fee", "task:sales_lead", "sync_set_status"]),
    dict(id=12, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="declined"), guard=g_note, to="SO7", effects=["set_owner", "record_visit", "payment:diag_fee", "sync_set_status"]),
    dict(id=13, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="no_access"), guard=g_note, to="SO1", effects=["record_visit", "unbook", "notify:reschedule_needed"]),
    dict(id=14, frm={"SO1"}, event={"tech.findings_submitted"}, when=dict(outcome="warranty_parts"), to="SO3", effects=["set_owner", "record_visit", "task:warranty_admin", "sync_set_status_lines"]),
    dict(id=15, frm={"SO2"}, event={"parts.verified"}, to=_verified_target, effects=["on_verified"]),
    dict(id=16, frm={"SO2.1"}, event={"system.quote_built"}, to="SO2.2", effects=["notify:quote_sent", "task:reminders"]),
    dict(id=17, frm={"SO2.2"}, event={"customer.approved"}, to="SO3", effects=["quote_approved", "sync_set_status_lines", "notify:approved_ordering"]),
    dict(id=18, frm={"SO2.2"}, event={"customer.declined", "customer.shopping"}, to="SO7", effects=["payment:diag_fee", "task:sales_lead", "sync_set_status"]),
    dict(id=19, frm={"SO2.2"}, event={"timer.no_response"}, to="SO7", effects=["payment:diag_fee", "sync_set_status", "notify:declined_receipt"]),
    dict(id=20, frm={"SO3", "SO3PRE"}, event={"po.placed"}, to=_po_target, effects=["set_eta", "notify:parts_ordered", "sync_set_status"]),
    dict(id=21, frm={"SO4", "SO4B", "SO4H"}, event={"customer.held_date"}, guard=g_slot, to="SO4PRE", effects=["book_install_tentative", "sync_set_schedule"]),
    dict(id=22, frm={"SO4", "SO4B", "SO4H", "SO4PRE"}, event={"po.eta_changed"}, to=_eta_changed_target, effects=["set_eta", "notify:parts_delay", "maybe_unhold"]),
    dict(id=22.1, frm={"SO4PRE"}, event={"timer.hold_check"}, guard=g_parts_not_in, to="SO4PRE", effects=["flag:hold_at_risk", "task:hold_eta_check"]),
    dict(id=22.2, frm={"SO4PRE"}, event={"timer.hold_release", "staff.hold_time_out"}, guard=g_parts_not_in, to="SO4", effects=["release_hold", "notify:hold_released_apology", "sync_set_status"]),
    dict(id=23, frm={"SO4", "SO4B", "SO4H"}, event={"receiving.all_parts_in"}, to="SO5", effects=["set_bin", "notify:part_arrived_pick_time", "sync_set_status"]),
    dict(id=24.1, frm={"SO4H"}, event={"customer.part_received", "carrier.delivered"}, to="SO5", effects=["set_bin_customer", "notify:part_arrived_pick_time", "sync_set_status"]),
    dict(id=24, frm={"SO4PRE"}, event={"receiving.all_parts_in"}, to="SO6", effects=["set_bin", "notify:held_confirmed", "sync_set_status"]),
    dict(id=25, frm={"SO5"}, event={"customer.picked_window", "staff.booked"}, guard=lambda j, c: g_slot(j, c) or g_owner_only(j, c), to="SO6", effects=["book_install", "sync_set_schedule", "notify:install_confirmed"]),
    dict(id=26, frm={"SO5"}, event={"timer.unpicked"}, to="SO5", effects=["task:client_care_callback"]),
    dict(id=27, frm={"SO6"}, event={"tech.repair_complete"}, guard=g_parts_installed, to="SO8", effects=["record_visit", "payment:repair", "notify:receipt", "sync_set_status"]),
    dict(id=27.1, frm={"SO1"}, event={"tech.repair_complete"}, to="SO8", effects=["record_visit", "payment:repair", "notify:receipt", "sync_set_status"]),
    dict(id=28, frm={"SO6"}, event={"tech.more_parts"}, guard=g_lines, to="SO2", effects=["record_visit", "quote_new_version", "task:parts_verify"]),
    dict(id=29, frm={"SO6"}, event={"tech.part_issue"}, to="SO3", effects=["record_visit", "flag_part_issue", "notify:parts_delay", "sync_set_status"]),
    dict(id=30, frm={"SO6"}, event={"tech.not_fixed"}, guard=g_note, to="SO1", effects=["record_visit", "flag:research", "task:manager"]),
    dict(id=31, frm={"SO8", "SO8I"}, event={"payment.succeeded"}, guard=g_amount_matches, to=None, effects=["close", "sync_post_payment_close"]),
    dict(id=32, frm={"SO8", "SO8I"}, event={"payment.failed"}, to=None, effects=["task:payment_retry", "notify:payment_link"]),
    dict(id=33, frm={"SO8", "SO8I"}, event={"payment.amount_mismatch"}, to=None, effects=["task:payment_review"]),
    dict(id=34, frm="open", event={"customer.cancelled", "staff.cancelled"}, to=_cancel_target, effects=["cancel", "sync_set_status"]),
]

_TABLE_EVENTS = {e for r in RULES for e in r["event"]}


def _rule_for(job: dict, event: str, ctx: dict) -> Optional[dict]:
    st = job["status"]
    for r in RULES:
        if event not in r["event"]:
            continue
        frm = r["frm"]
        if frm == "open":
            if st in OPEN_TERMINAL or job.get("closed_at"):
                continue
        elif frm != "any" and st not in frm:
            continue
        when = r.get("when") or {}
        if any(ctx.get(k) != v for k, v in when.items()):
            continue
        if r.get("only_if") and not r["only_if"](ctx):
            continue
        return r
    return None


def transition(db: DB, job_id: int, event: str, actor_type: str, actor_id: str, reason_code: Optional[str] = None, now: Optional[_dt.datetime] = None, **ctx) -> dict:
    """Apply one event. Returns {'rule', 'from', 'to', 'effects'}. Does not commit."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    ctx = dict(ctx)
    ctx["reason_code"] = reason_code
    ctx["_backorder_days"] = db.setting("parts.backorder_days", 10)
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job:
        raise TransitionError(f"job {job_id} not found")

    if event == "staff.manual_status":
        if not reason_code:
            raise TransitionError("manual status change requires reason_code")
        to = ctx.get("to")
        if not to or not db.fetchone("SELECT 1 FROM status_def WHERE status=?", (to,)):
            raise TransitionError(f"unknown target status {to!r}")
        rule, effects = {"id": 35}, ["sync_set_status"]
    else:
        rule = _rule_for(job, event, ctx)
        if rule is None:
            hint = "" if event in _TABLE_EVENTS else f" (unknown event {event!r})"
            raise TransitionError(f"no rule for {job['status']} + {event} {_when(ctx)}{hint}; use staff.manual_status with reason_code")
        guard = rule.get("guard")
        if guard:
            msg = guard(job, ctx)
            if msg:
                raise GuardFailed(f"rule {rule['id']}: {msg}")
        to = rule["to"](job, ctx) if callable(rule["to"]) else rule["to"]
        effects = list(rule["effects"])

    frm = job["status"]
    changes = {"updated_at": ts}
    if to and to != frm:
        changes.update({"status": to, "status_changed_at": ts})
    if actor_type in ("customer", "tech", "staff", "system") and job.get("source") == "import":
        changes["source"] = "dashboard"  # the dashboard now drives this job; stop mirroring ePASS
    db.update("job", {"job_id": job_id}, changes)
    db.insert("status_history", {"job_id": job_id, "from_status": frm, "to_status": to or frm, "changed_at": ts, "actor_type": actor_type, "actor_id": actor_id,
                                 "trigger_event": event + (f":{ctx['outcome']}" if ctx.get("outcome") else "") + (f"/{ctx['decision']}" if ctx.get("decision") else ""),
                                 "reason_code": reason_code, "note": (ctx.get("note") or "")[:500] or None})
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    done = []
    for eff in effects:
        _run_effect(db, eff, job, ctx, ts, frm, to or frm)
        done.append(eff)
    return {"rule": rule["id"], "from": frm, "to": to or frm, "effects": done}


def _when(ctx):
    bits = [f"{k}={ctx[k]}" for k in ("outcome", "decision") if ctx.get(k)]
    return "(" + ", ".join(bits) + ")" if bits else ""


# ------------------------------------------------------------------ side effects
def _outbox(db, job, effect, payload, ts):
    db.insert("outbox", {"job_id": job["job_id"], "effect": effect, "payload": json.dumps(payload, default=str), "created_at": ts, "handled_at": None})


def _sp(db, tech_id):
    if not tech_id:
        return None
    r = db.fetchone("SELECT sp_code FROM tech WHERE tech_id=?", (tech_id,))
    return r["sp_code"] if r else None


def _run_effect(db: DB, eff: str, job: dict, ctx: dict, ts: str, frm: str, to: str) -> None:
    jid = job["job_id"]
    if eff.startswith("notify:") or eff.startswith("task:") or eff.startswith("payment:"):
        kind, _, name = eff.partition(":")
        payload = {"name": name, "status": to}
        if kind == "payment":
            if name == "diag_fee":
                payload["amount"] = db.setting(DIAG_FEE_KEY, 169.95)
            else:
                payload["amount"] = ctx.get("total", job.get("total"))
        _outbox(db, job, eff, payload, ts)
        return
    if eff.startswith("flag:"):
        flag = eff[5:]
        flags = set(f for f in (job.get("flags") or "").split(",") if f)
        flags.add(flag)
        db.update("job", {"job_id": jid}, {"flags": ",".join(sorted(flags))})
        return
    if eff == "set_owner":
        if not job.get("owner_tech_id"):
            tid = ctx.get("tech_id") or job.get("assigned_tech_id")
            if tid:
                db.update("job", {"job_id": jid}, {"owner_tech_id": tid})
                job["owner_tech_id"] = tid
        return
    if eff == "record_visit":
        _outbox(db, job, "visit.recorded", {"tech_id": ctx.get("tech_id"), "on_site_minutes": ctx.get("on_site_minutes"), "outcome": ctx.get("outcome"),
                                            "photos": ctx.get("photo_count", 0)}, ts)
        return
    if eff in ("book_diag", "book_install", "book_install_tentative"):
        tid = ctx.get("tech_id") or (job.get("owner_tech_id") if eff != "book_diag" else None) or job.get("assigned_tech_id")
        win = ctx["window"]
        start, end = (f"{ctx['route_date']} 08:00:00", f"{ctx['route_date']} 12:00:00") if win == "AM" else (f"{ctx['route_date']} 12:00:00", f"{ctx['route_date']} 17:00:00")
        db.update("job", {"job_id": jid}, {"route_date": ctx["route_date"], "assigned_tech_id": tid, "promised_window_start": start, "promised_window_end": end,
                                           "route_sequence": None, "job_type": job.get("job_type")})
        job.update(route_date=ctx["route_date"], assigned_tech_id=tid, promised_window_start=start, promised_window_end=end)
        ctx["_tech_code"] = _sp(db, tid)
        return
    if eff == "unbook":
        db.update("job", {"job_id": jid}, {"route_date": None, "route_sequence": None, "promised_window_start": None, "promised_window_end": None})
        _outbox(db, job, "appointment.cancelled", {"reason": "no_access", "note": ctx.get("note")}, ts)
        return
    if eff == "sync_create_ticket":
        cust = db.fetchone("SELECT * FROM customer WHERE customer_id=?", (job.get("customer_id"),)) or {}
        addr = db.fetchone("SELECT * FROM address WHERE address_id=?", (job.get("address_id"),)) or {}
        unit = db.fetchone("SELECT * FROM unit WHERE job_id=? ORDER BY unit_id", (jid,)) or {}
        payload = {"status": "SO1", "route_date": job.get("route_date"), "window": ctx.get("window"), "tech": _sp(db, job.get("assigned_tech_id")),
                   "customer": {"name": cust.get("display_name"), "phone": cust.get("phone_primary"), "email": cust.get("email")},
                   "address": {k: addr.get(k) for k in ("line1", "line2", "city", "zip")},
                   "unit": {k: unit.get(k) for k in ("category", "brand", "model", "serial")}, "problem": job.get("problem_text")}
        if job.get("sv_number"):
            payload["status"] = "SO1"
            sync.create_item(db, job, "set_schedule", payload, now=ts)
        else:
            sync.create_item(db, job, "create_ticket", payload, now=ts)
        return
    if eff in ("sync_set_status", "sync_set_status_lines"):
        payload = {"status": to}
        if eff.endswith("lines") and ctx.get("lines"):
            payload["lines"] = ctx["lines"]
        note = ctx.get("packet_note")
        if not note and ctx.get("outcome"):
            note = sync.build_note(sv_number=job.get("sv_number") or "", field_approved_total=ctx.get("total") if ctx.get("decision") == "approve" else None,
                                   signed_at=ctx.get("signed_at"), summary=ctx.get("summary") or "", labor_exempt=bool(ctx.get("labor_exempt")), photo_count=ctx.get("photo_count", 0))
        sync.create_item(db, job, "set_status", payload, note=note, now=ts)
        return
    if eff == "sync_set_schedule":
        payload = {"status": to, "route_date": job.get("route_date"), "window": ctx.get("window"), "tech": _sp(db, job.get("assigned_tech_id"))}
        sync.create_item(db, job, "set_schedule", payload, now=ts)
        return
    if eff == "sync_post_payment_close":
        payload = {"payment": {"amount": ctx.get("amount", job.get("total")), "method": ctx.get("method", "card"), "ref": ctx.get("ref", "")}, "status": "SO8",
                   "note": "Post payment and close ticket."}
        sync.create_item(db, job, "post_payment", payload, now=ts)
        return
    if eff in ("quote_field_approved", "quote_field_draft", "quote_office_draft", "quote_approved", "quote_new_version"):
        total = ctx.get("total")
        if total is not None:
            db.update("job", {"job_id": jid}, {"total": total})
        _outbox(db, job, eff, {"lines": ctx.get("lines"), "total": total, "signed_at": ctx.get("signed_at"), "labor_exempt": ctx.get("labor_exempt")}, ts)
        return
    if eff == "on_verified":
        if to == "SO2.1":
            # spec rule 16: quote is built immediately and sent
            transition(db, jid, "system.quote_built", "system", "engine", now=_dt.datetime.fromisoformat(ts))
        elif to == "SO2.2":
            _outbox(db, job, "notify:quote_revised", {"reason": "requote rule", "total": ctx.get("total")}, ts)
        else:  # SO3 straight through
            sync.create_item(db, job, "set_status", {"status": "SO3", "lines": ctx.get("lines")}, note=ctx.get("packet_note"), now=ts)
            _outbox(db, job, "notify:approved_ordering", {"status": "SO3"}, ts)
        return
    if eff == "set_eta":
        _outbox(db, job, "po.eta", {"eta_days": ctx.get("eta_days"), "eta": ctx.get("eta")}, ts)
        return
    if eff == "maybe_unhold":
        if frm == "SO4PRE" and to == "SO4":
            db.update("job", {"job_id": jid}, {"route_date": None, "promised_window_start": None, "promised_window_end": None})
            _outbox(db, job, "notify:reschedule_needed", {"reason": "part ETA moved past held date"}, ts)
        return
    if eff == "set_bin":
        if ctx.get("bin_location"):
            db.update("job", {"job_id": jid}, {"bin_location": ctx["bin_location"]})
        return
    if eff == "set_bin_customer":
        db.update("job", {"job_id": jid}, {"bin_location": "CUST"})
        return
    if eff == "release_hold":
        # the ePASS "time out": the held date comes off the route, the flag clears, the customer re-picks once the part is in
        flags = set(f for f in (job.get("flags") or "").split(",") if f) - {"hold_at_risk"}
        db.update("job", {"job_id": jid}, {"route_date": None, "route_sequence": None, "promised_window_start": None, "promised_window_end": None,
                                           "flags": ",".join(sorted(flags)) or None})
        _outbox(db, job, "appointment.cancelled", {"reason": "part_not_in", "held_date": job.get("route_date"), "new_eta": ctx.get("eta")}, ts)
        return
    if eff == "flag_part_issue":
        _outbox(db, job, "parts.reorder", {"issue": ctx.get("issue"), "lines": ctx.get("lines")}, ts)
        return
    if eff == "close":
        db.update("job", {"job_id": jid}, {"closed_at": ts})
        return
    if eff == "cancel":
        db.update("job", {"job_id": jid}, {"cancel_reason": (ctx.get("reason") or ctx.get("note") or "cancelled")[:60], "route_date": None,
                                           "promised_window_start": None, "promised_window_end": None})
        if ctx.get("diag_was_run"):
            _outbox(db, job, "payment:diag_fee", {"amount": db.setting(DIAG_FEE_KEY, 169.95)}, ts)
        return
    raise TransitionError(f"unknown side effect {eff!r}")


# ------------------------------------------------------------------ rule 1: the request form
def create_request(db: DB, *, customer: dict, address: dict, unit: Optional[dict] = None, problem_text: str = "", card_saved: bool = False,
                   landlord_or_pm: bool = False, actor_id: str = "web", now: Optional[_dt.datetime] = None) -> int:
    """form.submitted: create customer/address/job/unit, zone lookup, REQ (or SO1.AUTH when no card and not a landlord/PM)."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    from .importers.common import clean_phone, find_or_create_customer, find_or_create_address, zone_for_zip
    cust_id = find_or_create_customer(db, name=customer.get("name", ""), phone=customer.get("phone"), alt_phone=customer.get("phone_alt"), email=customer.get("email"),
                                      epass_code=None, now=ts)
    if customer.get("contact_pref"):
        db.update("customer", {"customer_id": cust_id}, {"contact_pref": customer["contact_pref"], "is_landlord": 1 if landlord_or_pm else 0})
    zone_code = zone_for_zip(db, address.get("zip"))
    addr_id = find_or_create_address(db, cust_id, line1=address.get("line1"), line2=address.get("line2"), city=address.get("city"), state=address.get("state", "TX"),
                                     zip_code=address.get("zip"), lat=None, lng=None, directions=address.get("access_notes"), zone_code=zone_code)
    if address.get("gate_code") and addr_id:
        db.update("address", {"address_id": addr_id}, {"gate_code": address["gate_code"]})
    zone = db.fetchone("SELECT * FROM zone WHERE zone_code=?", (zone_code,)) if zone_code else None
    status = "REQ" if (card_saved or landlord_or_pm) else "SO1.AUTH"
    install_type = (unit or {}).get("install_type")
    job_type = "hvac" if install_type == "hvac" else "appliance"
    job_id = db.insert("job", {
        "sv_number": None, "customer_id": cust_id, "address_id": addr_id, "status": status, "status_changed_at": ts, "flags": None, "job_type": job_type,
        "qualification": "HVAC" if job_type == "hvac" else "APPL", "is_warranty": 0, "warranty_flags": None, "payment_type": "COD", "source": "dashboard",
        "owner_tech_id": None, "assigned_tech_id": None, "promised_window_start": None, "promised_window_end": None, "planned_slot_start": None, "planned_slot_end": None,
        "route_date": None, "route_sequence": None, "route_locked": 0, "trip_id": None, "booking_mode": (zone or {}).get("booking_mode"), "zone_code": zone_code,
        "problem_text": (problem_text or "")[:2000] or None, "balance": None, "total": None, "bin_location": None, "units": 1,
        "epass_status": None, "epass_route_date": None, "epass_tech_code": None, "epass_seen_at": None, "epass_source": None, "epass_invoice_status": None,
        "epass_finish_date": None, "epass_created_at": None, "in_feed": 0, "stale": 0, "needs_intake_review": 0, "closed_at": None, "cancel_reason": None,
        "created_at": ts, "updated_at": ts,
    })
    if unit:
        db.insert("unit", {"job_id": job_id, "category": unit.get("category"), "install_type": install_type, "brand": unit.get("brand"), "model": unit.get("model"),
                           "serial": unit.get("serial"), "problem_text": (problem_text or "")[:2000] or None, "raw_detail": None})
    db.insert("status_history", {"job_id": job_id, "from_status": None, "to_status": status, "changed_at": ts, "actor_type": "customer", "actor_id": actor_id,
                                 "trigger_event": "form.submitted", "reason_code": None, "note": None})
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    from . import kpi
    kpi.detect_recall(db, job_id, now)
    _outbox(db, job, "notify:request_received", {"status": status}, ts)
    if (zone or {}).get("booking_mode") == "office_only":
        _outbox(db, job, "task:client_care_book", {"zone": zone_code}, ts)
    elif (zone or {}).get("booking_mode") == "designated_days":
        _outbox(db, job, "trip_bucket.add", {"zone_group": zone.get("zone_group")}, ts)
    return job_id

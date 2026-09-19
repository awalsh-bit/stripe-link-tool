"""Estimate hand-off and the ePASS watch (9/18) — the interim operating model until quotes live here.

After the parts manager verifies price + ETA the quote is handed to Agility's existing `service_estimates` module
(public approval page by token); when the customer approves, the office keys the lines into ePASS and sets SO3;
ordering and receiving happen in ePASS; this tool reads SO4 (-> pencil) and SO5 (-> customer text ready) back from
the import. Nothing here writes to ePASS — it is packets and read-back, like everything else in the sync queue.

    hand_off(db, job_id, lines, total, parts_eta, by, external_ref=None, now=None) -> handoff_id
    record_response(db, handoff_id, status, now=None, by=..., external_ref=None) -> dict
        approved                          -> job SO3 + a 'lines' sync_item (approved lines + SO3 for the office to key)
        declined | shopping | no_response | diagnostic | parts_unavailable -> job SO7 + a set_status packet
        sent | viewed | comped            -> recorded on the hand-off only
    A hand-off whose lines carry a part with availability 'nla' (discontinued, 9/18 pm) is a *notice*, not a quote:
    kind='notice', total 0 — the customer is told the repair cannot proceed and offered the showroom (shopping) or
    the call closes (parts_unavailable). Either way ePASS hears SO7 through the same packet.

    The diagnostic on a notice (9/18 pm, Cayden): standard process still charges it — we made the visit and the
    diagnosis — but the office frequently waives it while handing the customer to the showroom, because the customer
    is upset and we have no say in what the manufacturer does with its parts. So record_response() takes
    `diag` in ('charge', 'waive', 'credit'); it defaults to settings['billing.diag_on_nla'] ('charge'), rides on the
    SO7 packet as a billing instruction, and is written to the audit log with the actor. Measured on 248 COD
    discontinued-part calls since Jan 2024: 56% billed the diagnostic, 19% billed zero. 'credit' (bill it, credit it
    against a replacement) is modelled but not yet policy.
    request_ticket(db, job_id, by, now=None) -> sync_id     a 'new_ticket' packet for a self-booked request with no SV yet
    link_ticket(db, sync_item_id, sv_number, by, now=None) -> dict   the office keyed it: job.sv_number set, item keyed
    watch_epass_status(db, job, status, source, batch_id, now) -> bool   called from sync.reconcile_after_import

A self-booked request is a job with source<>'import' and no sv_number (job.source already exists; no new column).
"""
from __future__ import annotations

import datetime as _dt
import json
from typing import Optional

from .db import DB, now_iso
from . import sync

STATUSES = ("ready", "sent", "viewed", "approved", "declined", "shopping", "comped", "diagnostic", "no_response", "parts_unavailable")
_TO_JOB = {"approved": "SO3", "declined": "SO7", "shopping": "SO7", "no_response": "SO7", "diagnostic": "SO7", "parts_unavailable": "SO7"}
NLA = "nla"                                   # line availability: discontinued / no longer available from any supplier
DIAG_CHOICES = ("charge", "waive", "credit")  # what happens to the diagnostic fee on a parts-unavailable notice


def nla_lines(lines: list[dict]) -> list[dict]:
    return [l for l in (lines or []) if str(l.get("availability") or "").lower() == NLA]
_WATCHED = ("SO4", "SO4B", "SO4H", "SO5")
_WATCH_FROM = ("SO3", "SO3PRE", "SO4", "SO4B", "SO4H")


def _setting(db: DB, key: str, default):
    r = db.fetchone("SELECT value FROM settings WHERE setting_key=?", (key,))
    if not r or r["value"] in (None, ""):
        return default
    v = r["value"]
    return type(default)(v) if isinstance(default, float) else v


def _job(db: DB, job_id: int) -> dict:
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job:
        raise ValueError(f"job {job_id} not found")
    return job


def _sp(db: DB, tech_id) -> Optional[str]:
    r = db.fetchone("SELECT sp_code FROM tech WHERE tech_id=?", (tech_id,)) if tech_id else None
    return r["sp_code"] if r else None


def _outbox(db: DB, job_id: int, effect: str, payload: dict, ts: str) -> None:
    db.insert("outbox", {"job_id": job_id, "effect": effect, "payload": json.dumps(payload, default=str), "created_at": ts, "handled_at": None})


def _set_status(db: DB, job: dict, to: str, ts: str, *, actor_type: str, actor_id: str, trigger: str, note: str) -> None:
    changes = {"status": to, "status_changed_at": ts, "updated_at": ts}
    if job.get("source") == "import":
        changes["source"] = "dashboard"          # the dashboard drives this job from here on (same rule as statuses.transition)
    db.update("job", {"job_id": job["job_id"]}, changes)
    db.insert("status_history", {"job_id": job["job_id"], "from_status": job["status"], "to_status": to, "changed_at": ts, "actor_type": actor_type,
                                 "actor_id": actor_id, "trigger_event": trigger, "reason_code": "service_estimates", "note": note[:500]})
    job.update(status=to, status_changed_at=ts)


# ------------------------------------------------------------------ the hand-off
def hand_off(db: DB, job_id: int, lines: list[dict], total: float, parts_eta: Optional[str], by: str, *, external_ref: Optional[str] = None,
             now: Optional[_dt.datetime] = None) -> int:
    """Parts has verified price + ETA: record the quote as handed to service_estimates. `lines` are the quote lines
    (parts + the two labor lines from labor.quote_labor_lines); `external_ref` is the estimate token once Agility has one."""
    ts = now_iso(now)
    job = _job(db, job_id)
    nla = nla_lines(lines)
    kind = "notice" if nla else "quote"
    if nla:                                   # nothing to quote: no ETA, no total, the notice names the part
        total, eta = 0.0, None
    else:
        eta = str(parts_eta)[:10] if parts_eta else None
    hid = db.insert("estimate_handoff", {"job_id": job_id, "sv_number": job.get("sv_number"), "external_ref": external_ref, "status": "sent" if external_ref else "ready",
                                         "kind": kind, "lines": json.dumps(lines or [], default=str), "total": total, "parts_eta": eta, "handed_by": by, "handed_at": ts, "responded_at": None})
    upd = {"total": total, "updated_at": ts} if not nla else {"updated_at": ts}
    if eta and not job.get("parts_eta"):
        upd["parts_eta"] = eta                   # the verified ETA; the pencil runs off it once ePASS shows SO4
    db.update("job", {"job_id": job_id}, upd)
    _outbox(db, job_id, "estimate.handoff", {"handoff_id": hid, "kind": kind, "total": total, "parts_eta": eta, "line_count": len(lines or []), "external_ref": external_ref,
                                             "nla": [l.get("desc") for l in nla]}, ts)
    db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "estimate.handed_off", "entity": "job", "entity_id": str(job_id),
                            "before_json": json.dumps({"status": job.get("status"), "total": job.get("total")}, default=str),
                            "after_json": json.dumps({"handoff_id": hid, "total": total, "parts_eta": eta, "lines": len(lines or [])})})
    return hid


def record_response(db: DB, handoff_id: int, status: str, now: Optional[_dt.datetime] = None, *, by: str = "service_estimates",
                    external_ref: Optional[str] = None, diag: Optional[str] = None) -> dict:
    """What came back from the estimate page. approved -> SO3 + 'lines' packet; declined/shopping/no_response/diagnostic -> SO7."""
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    if diag is not None and diag not in DIAG_CHOICES:
        raise ValueError(f"diag must be one of {DIAG_CHOICES}")
    if status == "approved":
        h0 = db.fetchone("SELECT kind FROM estimate_handoff WHERE handoff_id=?", (handoff_id,))
        if h0 and h0.get("kind") == "notice":
            raise ValueError("a parts-unavailable notice cannot be approved — there is nothing to order")
    ts = now_iso(now)
    h = db.fetchone("SELECT * FROM estimate_handoff WHERE handoff_id=?", (handoff_id,))
    if not h:
        raise ValueError(f"handoff {handoff_id} not found")
    job = _job(db, h["job_id"])
    upd = {"status": status}
    if external_ref:
        upd["external_ref"] = external_ref
    if status in _TO_JOB or status == "comped":
        upd["responded_at"] = ts
    db.update("estimate_handoff", {"handoff_id": handoff_id}, upd)
    out = {"handoff_id": handoff_id, "status": status, "job_id": job["job_id"], "job_status": job["status"], "sync_id": None}
    to = _TO_JOB.get(status)
    if not to or job.get("closed_at"):
        return out
    lines = json.loads(h.get("lines") or "[]")
    ref = external_ref or h.get("external_ref") or ""
    if to == "SO3":
        if job["status"] != "SO3":
            _set_status(db, job, "SO3", ts, actor_type="customer", actor_id=by, trigger="estimate.approved", note=f"approved on the estimate page {ref}".rstrip())
        db.update("job", {"job_id": job["job_id"]}, {"total": h.get("total")})
        payload = {"status": "SO3", "lines": lines, "total": float(h["total"]) if h.get("total") is not None else None,
                   "note": f"Customer approved estimate {ref} {ts[:16]}. Key the lines, set SO3, order parts in ePASS.".replace("  ", " ")}
        out["sync_id"] = sync.create_item(db, job, "lines", payload, now=ts)
        _outbox(db, job["job_id"], "notify:approved_ordering", {"name": "approved_ordering", "status": "SO3", "via": "service_estimates"}, ts)
    else:
        nla = [l.get("desc") for l in nla_lines(lines)]
        why = (f"Part discontinued ({', '.join(str(x) for x in nla)}) — customer informed" if nla else f"Customer {status.replace('_', ' ')}")
        if nla and status == "shopping":
            why += ", wants a replacement (showroom lead)"
        elif nla and status == "parts_unavailable":
            why += ", call closed"
        fee = None
        if nla or h.get("kind") == "notice":            # the diagnostic decision only exists on a notice
            fee = diag or _setting(db, "billing.diag_on_nla", "charge")
            amount = float(_setting(db, "pricing.diag_fee", 169.95))
            why += {"waive": f". Diagnostic WAIVED ({amount:.2f}) by {by} — do not bill",
                    "credit": f". Diagnostic {amount:.2f} billed, to be CREDITED against a replacement if they buy from us ({by})",
                    "charge": f". Diagnostic {amount:.2f} billed as standard"}[fee]
        if job["status"] != "SO7":
            _set_status(db, job, "SO7", ts, actor_type="customer" if status != "parts_unavailable" else "user", actor_id=by, trigger=f"estimate.{status}",
                        note=f"{why} — estimate page {ref}".rstrip(" —"))
        payload = {"status": "SO7", "reason": status, "nla": nla or None, "note": f"{why}. Estimate {ref}.".replace("  ", " ").replace(" .", ".")}
        if fee:
            payload["diag"] = fee
            payload["billing"] = {"waive": "waive diagnostic", "credit": "bill diagnostic, credit on a replacement", "charge": "bill diagnostic"}[fee]
            db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": f"diag.{fee}", "entity": "job", "entity_id": str(job["job_id"]),
                                    "before_json": json.dumps({"handoff_id": handoff_id, "nla": nla}),
                                    "after_json": json.dumps({"diag": fee, "amount": amount, "reason": status})})
            out["diag"] = fee
        out["sync_id"] = sync.create_item(db, job, "set_status", payload, now=ts)
        if status in ("declined", "shopping"):
            _outbox(db, job["job_id"], "task:sales_lead", {"name": "sales_lead", "status": "SO7", "reason": status, "nla": nla or None, "diag": fee}, ts)
    out["job_status"] = to
    return out


# ------------------------------------------------------------------ the ePASS ticket for a self-booked request
def request_ticket(db: DB, job_id: int, by: str, now: Optional[_dt.datetime] = None) -> int:
    """A request booked here (customer picked a window, or the office booked it) with no ePASS ticket yet: one
    'new_ticket' packet carrying name/address/phone/unit/problem/date/window/tech. Keyed when the office links the SV."""
    ts = now_iso(now)
    job = _job(db, job_id)
    if job.get("sv_number"):
        raise ValueError(f"job {job_id} already has ticket {job['sv_number']}")
    open_kinds = ",".join(f"'{k}'" for k in sync._TICKET_KINDS)
    have = db.fetchone(f"SELECT sync_id FROM sync_item WHERE job_id=? AND kind IN ({open_kinds}) AND state IN ('pending','keyed') ORDER BY sync_id", (job_id,))
    if have:
        return have["sync_id"]                 # rule 2 already asked for the ticket; one packet per job
    cust = db.fetchone("SELECT * FROM customer WHERE customer_id=?", (job.get("customer_id"),)) or {}
    addr = db.fetchone("SELECT * FROM address WHERE address_id=?", (job.get("address_id"),)) or {}
    unit = db.fetchone("SELECT * FROM unit WHERE job_id=? ORDER BY unit_id", (job_id,)) or {}
    ws = str(job.get("promised_window_start") or "")
    window = ("AM" if int(ws[11:13]) < 12 else "PM") if len(ws) >= 13 else None
    payload = {"status": job.get("status"), "route_date": job.get("route_date"), "window": window, "tech": _sp(db, job.get("assigned_tech_id")),
               "customer": {"name": cust.get("display_name"), "phone": cust.get("phone_primary"), "email": cust.get("email")},
               "address": {k: addr.get(k) for k in ("line1", "line2", "city", "zip")},
               "unit": {k: unit.get(k) for k in ("category", "brand", "model", "serial")}, "problem": job.get("problem_text"), "self_booked": True}
    return sync.create_item(db, job, "new_ticket", payload, note=f"self-booked request; needs an ePASS ticket (by {by})", now=ts)


def link_ticket(db: DB, sync_item_id: int, sv_number: str, by: str, now: Optional[_dt.datetime] = None) -> dict:
    """The office keyed the ticket: set job.sv_number (merging an import-created duplicate if one exists — intake.attach_sv)
    and mark the packet keyed. The next import confirms it like any other keyed item."""
    from . import intake
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    item = db.fetchone("SELECT * FROM sync_item WHERE sync_id=?", (sync_item_id,))
    if not item or item["kind"] not in sync._TICKET_KINDS:
        raise ValueError(f"sync item {sync_item_id} is not a ticket packet")
    if item["state"] != "pending":
        raise ValueError(f"sync item {sync_item_id} is {item['state']}, not pending")
    res = intake.attach_sv(db, item["job_id"], sv_number, by, now=now)   # also confirms create_ticket items; this one is re-marked keyed below
    sv = res["sv_number"]
    db.update("sync_item", {"sync_id": sync_item_id}, {"sv_number": sv, "state": "keyed", "keyed_at": ts, "keyed_by": by, "mismatch_count": 0,
                                                       "confirmed_at": None, "confirmed_by_import_id": None,
                                                       "note": f"{sv} linked by {by}" + (" (merged the import-created job)" if res.get("merged") else "")})
    db.update("estimate_handoff", {"job_id": item["job_id"]}, {"sv_number": sv})
    return {"sync_id": sync_item_id, "job_id": item["job_id"], "sv_number": sv, "merged": res.get("merged", False)}


# ------------------------------------------------------------------ the ePASS watch
def watch_epass_status(db: DB, job: dict, status: str, *, source: str, batch_id: int, now: str) -> bool:
    """ePASS shows SO4/SO4B/SO4H/SO5 on a job whose estimate was approved here: ordering/receiving happened in ePASS as
    planned. Adopt the status (history 'epass_watch'), pencil on SO4*, queue the part-arrived text on SO5. Returns True
    when handled so reconcile_after_import does not raise a discrepancy for it."""
    if status not in _WATCHED or job.get("status") not in _WATCH_FROM or status == job.get("status") or job.get("closed_at"):
        return False
    h = db.fetchone("SELECT * FROM estimate_handoff WHERE job_id=? AND status='approved' ORDER BY handoff_id DESC", (job["job_id"],))
    if not h:
        return False
    ts = now
    changes = {"status": status, "status_changed_at": ts, "updated_at": ts}
    if not job.get("parts_eta") and h.get("parts_eta"):
        changes["parts_eta"] = h["parts_eta"]
    db.update("job", {"job_id": job["job_id"]}, changes)
    db.insert("status_history", {"job_id": job["job_id"], "from_status": job["status"], "to_status": status, "changed_at": ts, "actor_type": "import", "actor_id": source,
                                 "trigger_event": "epass_watch", "reason_code": None, "note": f"batch {batch_id}: ePASS {status} after estimate hand-off {h['handoff_id']}"})
    if status in ("SO4", "SO4B", "SO4H"):
        from . import placement
        placement.pencil(db, job["job_id"], "engine", now=_dt.datetime.fromisoformat(ts))
    else:
        _outbox(db, job["job_id"], "notify:part_arrived_pick_time", {"name": "part_arrived_pick_time", "status": "SO5", "via": "epass_watch"}, ts)
    return True

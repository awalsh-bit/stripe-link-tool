"""The customer's private tracker link — spec v1.13 §6b.

Cayden, 9/18 late: *a landing or success page after a customer selects a date and completes the registration
that makes clear the functionality of saving the customer portal link to monitor their service.*

The link is the whole of getting back in: no order number, no phone, no password. So the token has to be
worth that trust, and the office has to be able to kill one. Everything here is deliberately small.

    issue(db, job_id, by=...)                  -> token          idempotent; the same job keeps its token
    resolve(db, token, now=None)               -> dict | None    None for unknown, revoked or expired
    reissue(db, job_id, by=..., reason=...)    -> token          the old one dies the moment this returns
    revoke(db, job_id, by=..., reason=...)     -> None
    email_link(db, token, to, now=None)        -> dict           one outbox row, customer-initiated, rate limited
    link_for(db, job_id)                       -> url            what the confirmation page and the texts print
    set_access(db, token, gate_code, note)     -> dict           the customer's own gate code / access note (§6b, 9/19)
    cancel(db, token, reason, note)            -> dict           the customer cancelling their own request (§6b, 9/19)
    client_care_sms(db, token)                 -> dict           the pre-addressed, pre-identified text to Client Care

Why 14 characters from a 55-character alphabet: ~81 bits, which is past guessing, and the alphabet drops
0/O/1/l/I because a customer reads this over the phone to Client Care when they've lost it.

Expiry is not a security control here — it is housekeeping. A link keeps working for
`tracker.link_expiry_days` (90) after the job closes, so the receipt stays reachable, then stops.
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import secrets
from typing import Optional

from .db import DB, now_iso

# ⟨9/19⟩ Cayden: "the buttons other than reschedule dont currently work." Three of them now do, and all three are
# customer-initiated writes through a token, so each one is deliberately narrow: what may be written, by whom, and
# from which statuses. A token is a bearer credential — anyone holding the link is the customer as far as we can
# tell — so nothing here may move money, change an address, or reach another job.
CUSTOMER_CANCEL_REASONS = ("fixed", "cost", "elsewhere", "timing", "replace", "other")
# Once a part has been bought against the ticket, cancelling is a conversation with a person, not a button.
NO_SELF_CANCEL = ("SO3", "SO3PRE", "SO4", "SO4B", "SO4H", "SO4PRE", "SO5", "SO6", "SO8", "SO8I", "SO9")
ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
TOKEN_LEN = 14
BASE = "https://wilsonappliance.com/t/"
_TOKEN_RE = re.compile(r"^[a-zA-Z2-9]{%d}$" % TOKEN_LEN)

# what a token-scoped caller may ever see (§6b); everything else is filtered out before the payload is built
CUSTOMER_FIELDS = ("job_id", "sv_number", "status", "route_date", "promised_window_start", "promised_window_end",
                   "parts_eta", "problem_text", "total", "balance", "closed_at")


def new_token() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(TOKEN_LEN))


def _setting(db: DB, key: str, default):
    r = db.fetchone("SELECT value FROM settings WHERE setting_key=?", (key,))
    if not r or r["value"] in (None, ""):
        return default
    return type(default)(r["value"]) if isinstance(default, (int, float)) and not isinstance(default, bool) else r["value"]


def link_for(db: DB, job_id: int) -> str:
    return BASE + issue(db, job_id)


def issue(db: DB, job_id: int, *, by: str = "system", now: Optional[_dt.datetime] = None) -> str:
    """The token a job carries. Called at intake, and by anything that needs to print the link."""
    job = db.fetchone("SELECT job_id, tracker_token FROM job WHERE job_id=?", (job_id,))
    if not job:
        raise ValueError(f"no job {job_id}")
    if job.get("tracker_token"):
        return job["tracker_token"]
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    for _ in range(5):  # collision is ~impossible; the retry is cheaper than reasoning about it
        tok = new_token()
        if not db.fetchone("SELECT job_id FROM job WHERE tracker_token=?", (tok,)):
            db.update("job", {"job_id": job_id}, {"tracker_token": tok, "tracker_token_at": ts, "tracker_token_by": by, "updated_at": ts})
            db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "tracker.issue", "entity": "job", "entity_id": str(job_id),
                                    "before_json": None, "after_json": json.dumps({"issued": True})})
            return tok
    raise RuntimeError("could not allocate a tracker token")


def resolve(db: DB, token: str, now: Optional[_dt.datetime] = None) -> Optional[dict]:
    """GET /t/{token}. Returns None — never a reason — for unknown, revoked and expired alike, so the endpoint
    cannot be used to find out whether a token was ever real."""
    token = (token or "").strip()
    if not _TOKEN_RE.match(token):
        return None
    job = db.fetchone("SELECT * FROM job WHERE tracker_token=?", (token,))
    if not job:
        return None
    now = now or _dt.datetime.now()
    if job.get("closed_at"):
        days = int(_setting(db, "tracker.link_expiry_days", 90))
        closed = str(job["closed_at"])[:10]
        try:
            if (now.date() - _dt.date.fromisoformat(closed)).days > days:
                return None
        except ValueError:
            pass
    cust = db.fetchone("SELECT display_name, contact_pref FROM customer WHERE customer_id=?", (job.get("customer_id"),)) or {}
    first = (cust.get("display_name") or "").split(",")[-1].strip().split(" ")[0] or "there"
    unit = db.fetchone("SELECT category, brand, model FROM unit WHERE job_id=? ORDER BY unit_id", (job["job_id"],)) or {}
    tech = db.fetchone("SELECT name FROM tech WHERE tech_id=?", (job.get("assigned_tech_id") or job.get("owner_tech_id"),)) or {}
    out = {k: job.get(k) for k in CUSTOMER_FIELDS}
    out.update({"first_name": first, "unit": unit.get("category"), "brand": unit.get("brand"),
                "tech_first": (tech.get("name") or "").split(" ")[0] or None, "token": token})
    return out


def revoke(db: DB, job_id: int, *, by: str, reason: str = "", now: Optional[_dt.datetime] = None) -> None:
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    old = (db.fetchone("SELECT tracker_token FROM job WHERE job_id=?", (job_id,)) or {}).get("tracker_token")
    db.update("job", {"job_id": job_id}, {"tracker_token": None, "tracker_token_at": None, "updated_at": ts})
    db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "tracker.revoke", "entity": "job", "entity_id": str(job_id),
                            "before_json": json.dumps({"had_token": bool(old)}), "after_json": json.dumps({"reason": reason[:200]})})


def reissue(db: DB, job_id: int, *, by: str, reason: str = "", now: Optional[_dt.datetime] = None) -> str:
    """"I lost the link" / the phone changed hands. The old token stops working immediately — that is the point."""
    now = now or _dt.datetime.now()
    revoke(db, job_id, by=by, reason=reason or "reissued", now=now)
    tok = issue(db, job_id, by=by, now=now)
    db.insert("audit_log", {"logged_at": now_iso(now), "user_id": by, "action": "tracker.reissue", "entity": "job", "entity_id": str(job_id),
                            "before_json": None, "after_json": json.dumps({"reason": reason[:200]})})
    return tok


def email_link(db: DB, token: str, to: str, *, now: Optional[_dt.datetime] = None) -> dict:
    """The *Email me the link* button on the confirmation page. This is the customer asking, on their own screen,
    for their own link — which is why it needs no template toggle. It sends the link and nothing else, only ever
    to the address typed on the page, and it does not become the customer's email on file."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    row = resolve(db, token, now=now)
    if not row:
        return {"sent": False, "reason": "unknown link"}
    to = (to or "").strip()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", to):
        return {"sent": False, "reason": "not an email address"}
    limit = int(_setting(db, "tracker.email_link_limit_per_hour", 3))
    since = now_iso(now - _dt.timedelta(hours=1))
    n = db.scalar("SELECT COUNT(*) FROM outbox WHERE job_id=? AND effect='tracker.email' AND created_at>=?", (row["job_id"], since)) or 0
    if n >= limit:
        return {"sent": False, "reason": "too many sends in the last hour"}
    db.insert("outbox", {"job_id": row["job_id"], "effect": "tracker.email",
                         "payload": json.dumps({"to": to, "url": BASE + token, "sv": row.get("sv_number"), "by": "customer"}),
                         "created_at": ts, "handled_at": None})
    db.insert("audit_log", {"logged_at": ts, "user_id": "customer", "action": "tracker.email_link", "entity": "job", "entity_id": str(row["job_id"]),
                            "before_json": None, "after_json": json.dumps({"to_domain": to.split("@")[-1]})})
    return {"sent": True, "to": to, "url": BASE + token}


def opened(db: DB, token: str, *, now: Optional[_dt.datetime] = None) -> None:
    """One row per open, so we can answer the only question that says whether the confirmation page worked:
    what share of customers come back to the link at all, and on how many separate days (§6b, §12 item 45)."""
    now = now or _dt.datetime.now()
    row = db.fetchone("SELECT job_id FROM job WHERE tracker_token=?", ((token or "").strip(),))
    if not row:
        return
    db.insert("outbox", {"job_id": row["job_id"], "effect": "tracker.open",
                         "payload": json.dumps({"day": now_iso(now)[:10]}), "created_at": now_iso(now), "handled_at": None})


def set_access(db: DB, token: str, *, gate_code: str = "", note: str = "", now: Optional[_dt.datetime] = None) -> dict:
    """*Add gate code or note* on the tracker. It writes two fields on the job's address and nothing else — the customer
    can tell us how to get in, not who they are or where they live; an address change is a phone call, on purpose.

    Both fields are trimmed and capped, and clearing them is allowed (a code that has changed is worse than no code)."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    row = resolve(db, token, now=now)
    if not row:
        return {"saved": False, "reason": "unknown link"}
    job = db.fetchone("SELECT job_id, address_id FROM job WHERE job_id=?", (row["job_id"],))
    if not job or not job.get("address_id"):
        return {"saved": False, "reason": "no address on this job"}
    gate = (gate_code or "").strip()[:24]
    acc = (note or "").strip()[:240]
    before = db.fetchone("SELECT gate_code, access_notes FROM address WHERE address_id=?", (job["address_id"],)) or {}
    db.update("address", {"address_id": job["address_id"]}, {"gate_code": gate or None, "access_notes": acc or None})
    db.insert("audit_log", {"logged_at": ts, "user_id": "customer", "action": "tracker.set_access", "entity": "address",
                            "entity_id": str(job["address_id"]),
                            "before_json": json.dumps({"had_gate": bool(before.get("gate_code")), "had_note": bool(before.get("access_notes"))}),
                            "after_json": json.dumps({"gate": bool(gate), "note_len": len(acc), "job_id": job["job_id"]})})
    return {"saved": True, "gate_code": gate, "note": acc, "job_id": job["job_id"]}


def cancel(db: DB, token: str, *, reason: str = "other", note: str = "", now: Optional[_dt.datetime] = None) -> dict:
    """*Cancel request* on the tracker. The customer may cancel their own visit right up until we have spent money on
    their behalf; from SO3 onwards the link says to message Client Care instead, because a part has been ordered and
    somebody has to decide what happens to it.

    Everything else — the SO9, the freed half-day, the ePASS packet — is rule 34 in the status engine, the same path a
    dispatcher's cancel takes. This function is only the door."""
    from . import statuses
    now = now or _dt.datetime.now()
    row = resolve(db, token, now=now)
    if not row:
        return {"cancelled": False, "reason": "unknown link"}
    job = db.fetchone("SELECT job_id, status FROM job WHERE job_id=?", (row["job_id"],))
    if job["status"] in NO_SELF_CANCEL:
        return {"cancelled": False, "reason": "parts ordered — client care", "status": job["status"]}
    why = reason if reason in CUSTOMER_CANCEL_REASONS else "other"
    res = statuses.transition(db, job["job_id"], "customer.cancelled", "customer", "customer",
                              now=now, reason=why, note=(note or "").strip()[:200])
    return {"cancelled": True, "status": res.get("to") or "SO9", "why": why, "job_id": job["job_id"]}


def client_care_sms(db: DB, token: str, now: Optional[_dt.datetime] = None) -> dict:
    """*Message Client Care*: the number to open, and the words already in the box.

    Cayden asked for "something generic". Generic does not mean empty: what wastes Client Care's time is not the
    customer's question, it is working out whose repair they are asking about. So the body names them and their SV and
    then gets out of the way. Nothing is sent from here — the customer's own phone sends it, when they press send."""
    row = resolve(db, token, now=now)
    if not row:
        return {"ok": False, "reason": "unknown link"}
    number = str(db.setting("clientcare.sms_number", "512-894-0907"))
    digits = re.sub(r"\D", "", number)
    unit = row.get("unit") or "appliance"
    body = f"Hi Wilson AC & Appliance — this is {row.get('first_name') or 'a customer'}, about my repair {row.get('sv_number') or ''} ({unit}). "
    return {"ok": True, "number": number, "href": f"sms:+1{digits}?&body={body}", "body": body}

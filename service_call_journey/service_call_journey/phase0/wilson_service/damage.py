"""The installer's cosmetic damage report, and the path it takes — spec §5.1c, blueprint §5.9 ⟨9/19⟩.

Cayden, with the form's screenshots: *see screenshots of field/install damage report that funnels directly into our
existing service request queue … we will need to grab the info from the service request queue, move it into unassigned
and have it send to Mark Perks for review/part number add … holds time at so4, when part arrives at so5, customer is
prompted to schedule.*

This is the only workflow in the system that starts somewhere other than the request form and still has to end in the
same place. Two things make it different from every other ticket, and both are the point:

1. **There is no diagnostic.** An installer stood in front of the unit and photographed the damage. Sending a
   technician in a van to look at a dent that is already photographed is the waste we are removing, so the job is born
   at SO2 — findings already in hand — and skips SO1 entirely.
2. **The only missing piece is a part number**, and exactly one person can supply it. So the job is unassigned and
   owned by the service manager until he supplies it; his `order_part` is what moves it to SO4.

From SO4 onward it is an ordinary ticket: the existing pencil holds a fitting slot two business days after the ETA,
receiving moves it to SO5, and the customer picks the install window on the same tracker as everybody else.

    report(db, ...)                  -> report_id   what the installer submits, invoice and all
    to_job(db, report_id, by=...)    -> job_id      the service order, unassigned, owned by the manager
    order_part(db, report_id, ...)   -> dict        the manager's part number — holds the ticket at SO4
    open_reports(db)                 -> list        the service-request-queue view

The report is kept as its own row rather than folded straight into a job because it exists before the job does: the
installer submits it from a delivery truck, and whether it becomes a service order at all is the office's call.
"""
from __future__ import annotations

import datetime as _dt
import json
from typing import Optional

from .db import DB, now_iso

# The form's own vocabulary — step 3 of the wizard. Kept here so the API and the screen cannot drift apart.
ISSUES = ("Dent or ding", "Scratch or scuff", "Chipped or cracked glass", "Chipped or cracked panel",
          "Finish blemish — paint or coating", "Handle damaged, loose or missing", "Trim, badge or bezel damaged",
          "Door misaligned or won't close", "Missing part or accessory", "Damaged in transit — packaging torn",
          "Won't power on", "Other")
SIDES = ("Top", "Left", "Front", "Right", "Back", "Bottom", "Control panel", "Interior")
SPOTS = ("Top Left", "Top Centre", "Top Right", "Middle Left", "Centre", "Middle Right",
         "Bottom Left", "Bottom Centre", "Bottom Right")


def _summary(r: dict) -> str:
    """The line the service request queue prints, and has printed for years: `Issue: Other — Right side — Bottom Right`."""
    return f"Issue: {r.get('issue') or 'Other'} — {r.get('side') or '—'} — {r.get('spot') or '—'}"


def report(db: DB, *, by: str, truck: str = "", invoice_code: str = "", customer_name: str = "", address: str = "",
           zip_code: str = "", brand: str = "", model: str = "", serial: str = "", issue: str = "Other",
           side: str = "", spot: str = "", note: str = "", photos: int = 0, tag_photo: bool = False,
           now: Optional[_dt.datetime] = None) -> int:
    """What the installer submits. Deliberately permissive about the invoice — the form's third option is *Don't have
    the invoice # — enter it myself*, and holding a delivery truck up over a missing number helps nobody. It is strict
    about the two photos, because those are what the manager quotes from and what the manufacturer claim needs."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    if not tag_photo:
        raise ValueError("the model/serial tag photo is required — it is what identifies the unit")
    if photos < 1:
        raise ValueError("at least one photo of the damage is required")
    rid = db.insert("damage_report", {
        "reported_by": by[:60], "reported_at": ts, "truck": (truck or "")[:8], "invoice_code": (invoice_code or "")[:20],
        "customer_name": (customer_name or "")[:140], "address": (address or "")[:200], "zip": (zip_code or "")[:10],
        "brand": (brand or "")[:40], "model": (model or "")[:60], "serial": (serial or "")[:60],
        "issue": (issue or "Other")[:60], "side": (side or "")[:20], "spot": (spot or "")[:20],
        "note": (note or "")[:500], "photo_count": int(photos) + 1, "state": "new", "job_id": None,
        "part_number": None, "part_desc": None, "reviewed_by": None, "reviewed_at": None,
        "created_at": ts, "updated_at": ts})
    db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "damage.report", "entity": "damage_report",
                            "entity_id": str(rid), "before_json": None,
                            "after_json": json.dumps({"invoice": invoice_code, "serial": serial, "issue": issue})})
    return rid


def open_reports(db: DB) -> list[dict]:
    """The service request queue's damage rows: everything not yet through to a part on order."""
    rows = db.fetchall("SELECT * FROM damage_report WHERE state<>'done' ORDER BY reported_at DESC") or []
    for r in rows:
        r["summary"] = _summary(r)
    return rows


def to_job(db: DB, report_id: int, *, by: str, manager_tech_id: Optional[int] = None, warranty: bool = True,
           now: Optional[_dt.datetime] = None) -> int:
    """*Grab the info from the service request queue, move it into unassigned, send it to Mark Perks.*

    Creates the service order at **SO2** — findings already submitted, in the form of the installer's photos — with no
    technician and no date. The manager owns it until he has chosen the part."""
    from .importers.common import find_or_create_customer, find_or_create_address, zone_for_zip
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    r = db.fetchone("SELECT * FROM damage_report WHERE report_id=?", (report_id,))
    if not r:
        raise ValueError(f"no damage report {report_id}")
    if r.get("job_id"):
        return r["job_id"]
    if manager_tech_id is None:
        mgr = db.fetchone("SELECT tech_id FROM tech WHERE sp_code=?", ("MAP",)) or {}
        manager_tech_id = mgr.get("tech_id")
    cust_id = find_or_create_customer(db, name=r.get("customer_name") or "", phone=None, alt_phone=None, email=None,
                                      epass_code=None, now=ts)
    zone_code = zone_for_zip(db, r.get("zip"))
    line1 = (r.get("address") or "").rsplit(",", 1)[0].strip() or None
    addr_id = find_or_create_address(db, cust_id, line1=line1, line2=None, city=None, state="TX",
                                     zip_code=r.get("zip"), lat=None, lng=None, directions=None, zone_code=zone_code)
    zone = db.fetchone("SELECT * FROM zone WHERE zone_code=?", (zone_code,)) if zone_code else None
    problem = f"{_summary(r)} — found on delivery by {r.get('reported_by')}" + (f". {r['note']}" if r.get("note") else "")
    job_id = db.insert("job", {
        "sv_number": None, "customer_id": cust_id, "address_id": addr_id, "status": "SO2", "status_changed_at": ts,
        # ⟨9/19 pm Cayden⟩ "almost always concealed shipping damage that we repair under warranty. so warranty by
        # default." Which settles the pricing too: no zone fee, no freight, tax exempt, and the manufacturer's flat
        # rate on the labor (§5.1b). `warranty_flags` records why, and the office can clear it on the odd one that
        # turns out to be ours to eat.
        "flags": "damage", "job_type": "appliance", "qualification": "APPL", "is_warranty": 1 if warranty else 0,
        "warranty_flags": "concealed shipping damage" if warranty else None,
        "payment_type": "COD", "source": "damage_report", "owner_tech_id": manager_tech_id, "assigned_tech_id": None,
        "promised_window_start": None, "promised_window_end": None, "planned_slot_start": None, "planned_slot_end": None,
        "route_date": None, "route_sequence": None, "route_locked": 0, "trip_id": None,
        "booking_mode": (zone or {}).get("booking_mode"), "zone_code": zone_code,
        "problem_text": problem[:2000], "balance": None, "total": None, "bin_location": None, "units": 1,
        "source_ref": f"damage:{report_id}",
        "in_feed": 0, "stale": 0, "needs_intake_review": 0, "closed_at": None, "cancel_reason": None,
        "created_at": ts, "updated_at": ts})
    db.insert("unit", {"job_id": job_id, "category": None, "install_type": None, "brand": r.get("brand"),
                       "model": r.get("model"), "serial": r.get("serial"), "problem_text": problem[:2000], "raw_detail": None})
    db.insert("status_history", {"job_id": job_id, "from_status": None, "to_status": "SO2", "changed_at": ts,
                                 "actor_type": "staff", "actor_id": by, "trigger_event": "damage.to_job",
                                 "reason_code": None, "note": "no diagnostic — the installer's photos are the findings"})
    db.update("damage_report", {"report_id": report_id}, {"state": "manager", "job_id": job_id, "updated_at": ts})
    from . import tracker
    tracker.issue(db, job_id, by=by, now=now)
    db.insert("outbox", {"job_id": job_id, "effect": "task:manager_part_number",
                         "payload": json.dumps({"report_id": report_id, "summary": _summary(r), "serial": r.get("serial")}),
                         "created_at": ts, "handled_at": None})
    db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "damage.to_job", "entity": "job",
                            "entity_id": str(job_id), "before_json": None,
                            "after_json": json.dumps({"report_id": report_id, "owner": manager_tech_id})})
    return job_id


def order_part(db: DB, report_id: int, *, part_number: str, part_desc: str, eta: str, by: str,
               fitting_tech_id: Optional[int] = None, now: Optional[_dt.datetime] = None) -> dict:
    """The manager's review: the part number, what it is, when it lands, and who fits it.

    That is the whole of his job here, and it is why the ticket waited for him — so the tool refuses to move without
    both the number and the description. It then rides the ordinary SO4 machinery: `po.placed` sets the ETA, notifies
    the customer and pencils the fitting two business days out."""
    from . import statuses
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    pn = (part_number or "").strip().upper()
    desc = (part_desc or "").strip()
    if not pn or not desc:
        raise ValueError("a damage report needs both the part number and what the part is — that is the review")
    r = db.fetchone("SELECT * FROM damage_report WHERE report_id=?", (report_id,))
    if not r or not r.get("job_id"):
        raise ValueError("that report has no service order yet")
    if fitting_tech_id:
        db.update("job", {"job_id": r["job_id"]}, {"owner_tech_id": fitting_tech_id, "updated_at": ts})
    lines = [{"part_number": pn, "description": desc, "qty": 1}]
    job = db.fetchone("SELECT status FROM job WHERE job_id=?", (r["job_id"],))
    if job["status"] == "SO2":
        # the manager's approval stands in for the customer's: Wilson damaged the unit, so there is no estimate to send
        statuses.transition(db, r["job_id"], "parts.verified", "staff", by, now=now,
                            quote_kind="damage", lines=lines)
    res = statuses.transition(db, r["job_id"], "po.placed", "staff", by, now=now, eta=eta,
                              po_number=f"DMG-{report_id}", parts=lines)
    db.update("damage_report", {"report_id": report_id}, {"state": "ordered", "part_number": pn, "part_desc": desc[:120],
                                                          "reviewed_by": by, "reviewed_at": ts, "updated_at": ts})
    db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "damage.order_part", "entity": "damage_report",
                            "entity_id": str(report_id), "before_json": None,
                            "after_json": json.dumps({"pn": pn, "eta": eta, "job_id": r["job_id"]})})
    return {"job_id": r["job_id"], "status": res.get("to"), "part_number": pn, "eta": eta}

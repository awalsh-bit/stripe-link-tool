"""Queue-copy intake (spec v1.3 §14): the "Copy to service dashboard test module" button on the live Service Request
Queue posts one request here. It becomes a REQ through rule 1 (statuses.create_request), gets its first placement
suggestion logged, and — when the dispatcher later keys the SV in ePASS or types it into the queue's ERP field — is
attached to that SV so the mirror never carries a duplicate.

    from_queue(db, payload, now=None) -> dict      idempotent on payload['request_id'] (job.source_ref)
    attach_sv(db, job_id, sv_number, by, now=None) -> dict   merges an already-imported SV job into the request if one exists

Payload (JSON from the live dashboard; every key optional except customer name + phone and address zip):
{
  "request_id": "sr_4821", "submitted_at": "2026-09-14T16:32:00",
  "customer": {"name": "Thomas Meyer", "email": "tm101352@gmail.com", "phone": "5125579882"},
  "address": {"line1": "1714 Cielo Ranch rd.", "city": "San Marcos", "state": "TX", "zip": "78666", "gate_code": ""},
  "contact_method": "Text",
  "purchase_date": "2011", "purchased_within_12_months": false, "purchased_from_us": true,
  "units": [{"type": "Sub-Zero Refrigerator (Built-in)", "brand": "Sub-Zero", "model": "BI42SD/O", "serial": "F4139786",
             "purchased_from_us": true, "problem": "small puddle of water at base of refrigerator door"}],
  "photos": ["https://.../1.jpg"],
  "card": {"saved": true, "brand": "VISA", "last4": "8241", "setup_intent": "seti_1UFhRX8Mxpn8XucSe8t2KIe3"},
  "erp_order_number": "", "notes": ""
}
"""
from __future__ import annotations

import datetime as _dt
import json
import re
from typing import Optional

from .db import DB, now_iso
from . import placement, statuses
from .importers.common import clean_phone

_CATS = [
    (r"\b(fridge|refrigerat|freezer|column)", "refrigerator"), (r"\bwine", "wine cooler"), (r"\bice ?m", "ice maker"),
    (r"\bdishwasher", "dishwasher"), (r"\bwasher|laundry", "washer"), (r"\bdryer", "dryer"),
    (r"\bcooktop|rangetop", "cooktop"), (r"\bwall oven|double oven|\boven\b", "wall oven"), (r"\brange|stove", "range"),
    (r"\bmicrowave", "microwave"), (r"\bhood|vent", "vent hood"), (r"\bdisposal", "disposal"), (r"\bcoffee", "coffee system"),
    (r"\b(a/?c\b|air ?condition|hvac|furnace|heat pump|mini.?split|condenser|thermostat)", "hvac"),
]


def categorize(unit_type: str) -> tuple[str, Optional[str]]:
    """'Sub-Zero Refrigerator (Built-in)' -> ('refrigerator', 'built_in'); 'Central AC' -> ('hvac', 'hvac')."""
    t = (unit_type or "").lower()
    cat = next((c for rx, c in _CATS if re.search(rx, t)), t.strip()[:40] or "appliance")
    if cat == "hvac":
        return cat, "hvac"
    if "built" in t or cat in ("wall oven", "cooktop", "dishwasher", "vent hood", "ice maker", "coffee system", "wine cooler"):
        return cat, "built_in"
    return cat, "freestanding"


def _brand_from_type(unit_type: str) -> Optional[str]:
    for b in ("Sub-Zero", "SubZero", "Wolf", "Cove", "Miele", "Bosch", "Thermador", "Gaggenau", "KitchenAid", "Whirlpool", "Maytag", "Jenn-Air", "JennAir", "GE", "Monogram",
              "Café", "Cafe", "LG", "Samsung", "Frigidaire", "Electrolux", "Speed Queen", "Fisher & Paykel", "Viking", "Dacor", "Zephyr", "Scotsman", "U-Line", "Lennox",
              "Trane", "Carrier", "Goodman", "Rheem", "Daikin", "Mitsubishi"):
        if re.search(r"\b" + re.escape(b.lower()) + r"\b", (unit_type or "").lower()):
            return b
    return None


def from_queue(db: DB, payload: dict, now: Optional[_dt.datetime] = None, actor_id: str = "queue_copy") -> dict:
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    ref = str(payload.get("request_id") or "").strip() or None
    if ref:
        existing = db.fetchone("SELECT * FROM job WHERE source_ref=?", (f"queue:{ref}",))
        if existing:
            out = _result(db, existing["job_id"], created=False, now=now)
            sv = (payload.get("erp_order_number") or "").strip()
            if sv and not existing.get("sv_number"):
                out.update(attach_sv(db, existing["job_id"], sv, actor_id, now=now))
            return out
    cust = payload.get("customer") or {}
    name = cust.get("name") or " ".join(x for x in (cust.get("first_name"), cust.get("last_name")) if x) or "Customer"
    phone = clean_phone(cust.get("phone"))
    if not phone:
        raise ValueError("customer.phone is required")
    addr = payload.get("address") or {}
    if not (addr.get("zip") or "").strip():
        raise ValueError("address.zip is required")
    units = payload.get("units") or []
    u0 = units[0] if units else {}
    cat, install_type = categorize(u0.get("type") or u0.get("category") or "")
    if (u0.get("category") or "").lower() == "hvac":
        cat, install_type = "hvac", "hvac"
    brand = u0.get("brand") or _brand_from_type(u0.get("type") or "")
    problem = " · ".join(x for x in [(u.get("problem") or "").strip() for u in units] + [(payload.get("notes") or "").strip()] if x)
    photos = payload.get("photos") or []
    card = payload.get("card") or {}
    card_saved = bool(card.get("saved") or card.get("setup_intent"))
    pref = {"text": "text", "sms": "text", "call": "call", "phone": "call", "email": "email"}.get(str(payload.get("contact_method") or "").lower(), None)
    # dashboard-first: the request is dashboard-owned; source_ref says where it came from
    job_id = statuses.create_request(
        db, customer={"name": name, "phone": phone, "email": cust.get("email"), "contact_pref": pref},
        address={"line1": addr.get("line1") or addr.get("street"), "line2": addr.get("line2"), "city": addr.get("city"), "state": addr.get("state") or "TX",
                 "zip": str(addr.get("zip")).strip()[:10], "gate_code": (addr.get("gate_code") or "").strip()[:20] or None, "access_notes": addr.get("access_notes")},
        unit={"category": cat, "install_type": install_type, "brand": brand, "model": (u0.get("model") or "").strip() or None, "serial": (u0.get("serial") or "").strip() or None} if units else None,
        problem_text=problem, card_saved=card_saved, landlord_or_pm=bool(payload.get("landlord_or_pm")), actor_id=actor_id, now=now)
    for u in units[1:]:
        c2, it2 = categorize(u.get("type") or "")
        db.insert("unit", {"job_id": job_id, "category": c2, "install_type": it2, "brand": u.get("brand") or _brand_from_type(u.get("type") or ""), "model": u.get("model"),
                           "serial": u.get("serial"), "problem_text": (u.get("problem") or "")[:2000] or None, "raw_detail": None})
    extra = {"source_ref": f"queue:{ref}" if ref else None, "units": max(len(units), 1), "updated_at": ts,
             "card_ref": (f"{card.get('brand') or 'card'} {card.get('last4') or ''} {card.get('setup_intent') or ''}".strip()[:60] if card_saved else None),
             "est_minutes": placement.est_minutes(db, {"status": "REQ", "job_type": "hvac" if install_type == "hvac" else "appliance", "units": max(len(units), 1)})}
    if photos:
        db.insert("outbox", {"job_id": job_id, "effect": "photos.attach", "payload": json.dumps({"urls": photos[:10]}), "created_at": ts, "handled_at": None})
    db.update("job", {"job_id": job_id}, extra)
    db.insert("audit_log", {"logged_at": ts, "user_id": actor_id, "action": "intake.queue_copy", "entity": "job", "entity_id": str(job_id),
                            "before_json": None, "after_json": json.dumps({"request_id": ref, "submitted_at": payload.get("submitted_at"), "units": len(units), "photos": len(photos)})})
    # first suggestion — this is what the shadow test scores
    cands = placement.suggest(db, job_id, now=now, limit=3)
    placement.log_suggestion(db, job_id, "intake", cands, now=now)
    out = _result(db, job_id, created=True, now=now, cands=cands)
    sv = (payload.get("erp_order_number") or "").strip()
    if sv:
        out.update(attach_sv(db, job_id, sv, actor_id, now=now))
    return out


def _result(db: DB, job_id: int, *, created: bool, now: _dt.datetime, cands: Optional[list] = None) -> dict:
    job = db.fetchone("SELECT j.*, c.display_name, a.zip AS addr_zip FROM job j LEFT JOIN customer c ON c.customer_id=j.customer_id "
                      "LEFT JOIN address a ON a.address_id=j.address_id WHERE j.job_id=?", (job_id,))
    if cands is None:
        cands = placement.suggest(db, job_id, now=now, limit=3) if job["status"] in ("REQ", "SO1.AUTH") else []
    return {"job_id": job_id, "created": created, "status": job["status"], "sv_number": job.get("sv_number"), "customer": job.get("display_name"),
            "zone": job.get("zone_code"), "booking_mode": job.get("booking_mode"), "zip": job.get("addr_zip"),
            "suggestions": [{k: c[k] for k in ("rank", "sp_code", "date", "window", "cost", "why")} for c in cands]}


def attach_sv(db: DB, job_id: int, sv_number: str, by: str, now: Optional[_dt.datetime] = None) -> dict:
    """The dispatcher keyed the SV (ERP order number) on the live queue row. If the import already created a job for that
    SV, fold it into the request (mirror fields, booking, units, history) and delete the duplicate."""
    now = now or _dt.datetime.now()
    ts = now_iso(now)
    sv = sv_number.strip().upper()
    if not re.match(r"^SV\d{6,10}(-\d+)?$", sv):
        sv = "SV" + re.sub(r"\D", "", sv).zfill(8) if re.sub(r"\D", "", sv) else sv
    job = db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
    if not job:
        raise ValueError(f"job {job_id} not found")
    if job.get("sv_number") == sv:
        return {"sv_number": sv, "merged": False}
    dup = db.fetchone("SELECT * FROM job WHERE sv_number=? AND job_id<>?", (sv, job_id))
    merged = False
    if dup:
        mirror = {k: dup.get(k) for k in ("epass_status", "epass_route_date", "epass_tech_code", "epass_seen_at", "epass_source", "epass_invoice_status", "epass_finish_date",
                                          "epass_created_at", "in_feed", "balance", "bin_location", "warranty_flags", "is_warranty", "qualification", "total", "payment_type")}
        booked = {}
        if job["status"] in ("REQ", "SO1.AUTH") and dup.get("epass_status"):
            booked = {"status": dup["epass_status"], "status_changed_at": ts, "route_date": dup.get("route_date") or dup.get("epass_route_date"),
                      "assigned_tech_id": dup.get("assigned_tech_id"), "owner_tech_id": job.get("owner_tech_id") or dup.get("owner_tech_id")}
        db.execute("DELETE FROM job WHERE job_id=?", (dup["job_id"],))          # first, so the UNIQUE sv_number frees up
        for tbl in ("status_history", "sync_item", "outbox", "recall", "placement_log"):
            db.execute(f"UPDATE {tbl} SET job_id=? WHERE job_id=?", (job_id, dup["job_id"]))
        have_serials = {u.get("serial") for u in db.fetchall("SELECT serial FROM unit WHERE job_id=?", (job_id,))}
        for u in db.fetchall("SELECT * FROM unit WHERE job_id=?", (dup["job_id"],)):
            if u.get("serial") and u["serial"] in have_serials:
                db.execute("DELETE FROM unit WHERE unit_id=?", (u["unit_id"],))
            else:
                db.update("unit", {"unit_id": u["unit_id"]}, {"job_id": job_id})
        db.update("job", {"job_id": job_id}, {**mirror, **booked, "sv_number": sv, "needs_intake_review": 0, "updated_at": ts})
        if booked:
            db.insert("status_history", {"job_id": job_id, "from_status": job["status"], "to_status": booked["status"], "changed_at": ts, "actor_type": "staff", "actor_id": by,
                                         "trigger_event": "epass_attach_booked", "reason_code": None, "note": f"{sv} keyed on the queue row; ePASS booking adopted"})
            placement.record_actual(db, job_id, booked.get("assigned_tech_id"), booked.get("route_date"), "epass", now=now)
        merged = True
    else:
        db.update("job", {"job_id": job_id}, {"sv_number": sv, "updated_at": ts})
        for it in db.fetchall("SELECT sync_id FROM sync_item WHERE job_id=? AND kind='create_ticket' AND state IN ('pending','keyed')", (job_id,)):
            db.update("sync_item", {"sync_id": it["sync_id"]}, {"state": "confirmed", "confirmed_at": ts, "sv_number": sv, "note": f"{sv} keyed on the queue row"})
    db.insert("audit_log", {"logged_at": ts, "user_id": by, "action": "intake.attach_sv", "entity": "job", "entity_id": str(job_id),
                            "before_json": json.dumps({"sv": job.get("sv_number")}), "after_json": json.dumps({"sv": sv, "merged_import_job": dup["job_id"] if dup else None})})
    return {"sv_number": sv, "merged": merged}

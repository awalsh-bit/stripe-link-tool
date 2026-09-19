"""The tech's findings, as history.  ⟨9/19 late⟩

Cayden: "where are tech notes stored for current jobs? where do their findings recorded in field tool end up? we do
need this to record their notes into history."

Three honest answers, in order:

* **ePASS today** — the office re-types what the tech told them into the ticket's *Work Performed* box. That text
  is `service_detail.performed_desc`, and it is the only reason twenty years of history reads as well as it does.
* **The prototype until this round** — the findings lived in the phone's memory and a toast. Not history.
* **Agility from here** — every `tech.findings_submitted` (and every install-trip event) writes one `findings` row
  through the `record_visit` effect, and `history()` below reads those rows *together with* the ePASS catalogue, so
  a customer's record is one list whether the call was closed in 2019 or submitted ten minutes ago. The row carries
  the structured taps (symptoms, cause, parts, labor, outcome) and `performed_text`, a sentence built from them in
  the same shape the catalogue already uses — so the office and the next tech read one kind of thing.

The ePASS sync NOTE keeps carrying the first 200 characters (sync.build_note); nothing is re-typed.
"""
from __future__ import annotations

import datetime as _dt
import json
from typing import Optional

from .db import DB


def performed_text(ctx: dict, to_status: Optional[str] = None) -> str:
    """One sentence in the catalogue's register: Found …. Cause …. Parts …. Labor …. Note …. Outcome ….

    Built from the taps, so it exists even for a tech who typed nothing; his own words (custom_note, note) are kept
    verbatim inside it, not summarised."""
    bits = []
    found = [s for s in (ctx.get("symptoms") or []) if s and s.lower() != "error code"]
    if ctx.get("error_code"):
        found.append(f"error code {str(ctx['error_code']).strip()}")
    if (ctx.get("custom_note") or "").strip():
        found.append(ctx["custom_note"].strip())
    if found:
        bits.append("Found: " + "; ".join(found))
    if (ctx.get("cause") or "").strip():
        bits.append("Cause: " + ctx["cause"].strip())
    parts = [l for l in (ctx.get("lines") or []) if (l.get("kind") or "part") == "part"]
    labor = [l for l in (ctx.get("lines") or []) if l.get("kind") == "labor"]
    if parts:
        bits.append("Parts needed: " + ", ".join(
            f"{(l.get('desc') or 'component').strip()}{' ' + l['code'] if l.get('code') else ' (no number yet)'}"
            f"{' ×' + str(l['qty']) if (l.get('qty') or 1) > 1 else ''}" for l in parts))
    if labor:
        bits.append("Labor: " + ", ".join(f"{l.get('desc') or l.get('code')}{' ' + str(l['hours']) + ' h' if l.get('hours') is not None else ''}" for l in labor))
    if ctx.get("flags"):
        bits.append(", ".join(ctx["flags"]))
    if (ctx.get("note") or "").strip():
        bits.append("Note for the office: " + ctx["note"].strip())
    if ctx.get("outcome") or to_status:
        bits.append("Outcome: " + " · ".join(x for x in (ctx.get("outcome"), to_status) if x))
    bits = [b.rstrip(". ") for b in bits]
    return ". ".join(bits) + ("." if bits else "")


def record(db: DB, job: dict, ctx: dict, ts: str) -> int:
    """Called by the `record_visit` effect. `job` is the row as it stood before the transition; `ctx["_to"]` (set by
    the engine when it applies effects) or the rule's target is the status the visit produced."""
    unit = db.fetchone("SELECT unit_id FROM unit WHERE job_id=? ORDER BY unit_id", (job["job_id"],)) or {}
    lines = ctx.get("lines") or []
    to_status = ctx.get("_to") or None
    row = {
        "job_id": job["job_id"], "unit_id": ctx.get("unit_id") or unit.get("unit_id"),
        "tech_id": ctx.get("tech_id") or job.get("assigned_tech_id") or job.get("owner_tech_id"),
        "visit_date": ts[:10], "outcome": ctx.get("outcome"), "to_status": to_status,
        "symptoms": json.dumps(ctx.get("symptoms") or []), "error_code": ctx.get("error_code"), "cause": ctx.get("cause"),
        "custom_note": ctx.get("custom_note"), "note": ctx.get("note"),
        "parts_json": json.dumps([l for l in lines if (l.get("kind") or "part") == "part"]),
        "labor_json": json.dumps([l for l in lines if l.get("kind") == "labor"]),
        "flags": ",".join(ctx.get("flags") or []) or None,
        "performed_text": performed_text(ctx, to_status),
        "on_site_minutes": ctx.get("on_site_minutes"), "photo_count": ctx.get("photo_count", 0), "submitted_at": ts,
    }
    return db.insert("findings", row)


def for_job(db: DB, job_id: int) -> list[dict]:
    """Every visit on a dashboard job, newest first — what the office's ticket drawer shows under *Tech findings*."""
    rows = db.fetchall("SELECT f.*, t.sp_code, t.name tech_name FROM findings f LEFT JOIN tech t ON t.tech_id=f.tech_id"
                       " WHERE f.job_id=? ORDER BY f.submitted_at DESC, f.findings_id DESC", (job_id,))
    for r in rows:
        r["symptoms"] = json.loads(r.get("symptoms") or "[]")
        r["parts"] = json.loads(r.pop("parts_json", None) or "[]")
        r["labor"] = json.loads(r.pop("labor_json", None) or "[]")
    return rows


def history(db: DB, *, customer_id: Optional[int] = None, serial: Optional[str] = None, limit: int = 50) -> list[dict]:
    """One list: the ePASS back catalogue (closed calls, `service_detail.performed_desc`) and the dashboard's own
    visits (`findings.performed_text`), newest first, in one shape — {sv, date, status, tech, unit, said, did, source}.

    By customer or by serial, because a customer can move and an appliance can change hands (spec §7)."""
    out = []
    if customer_id is not None:
        for h in db.fetchall("SELECT h.sv_number, h.created_date, h.finish_date, h.epass_status, h.sp_code, d.complaint_desc, d.performed_desc,"
                             " d.brand_code, d.model, d.serial FROM service_history h LEFT JOIN service_detail d ON d.sv_number=h.sv_number"
                             " WHERE h.customer_id=? ORDER BY COALESCE(h.finish_date, h.created_date) DESC LIMIT ?", (customer_id, limit)):
            out.append({"sv": (h["sv_number"] or "").strip(), "date": h["finish_date"] or h["created_date"], "status": h["epass_status"],
                        "tech": h["sp_code"], "unit": " ".join(x for x in (h["brand_code"], h["model"]) if x), "serial": h["serial"],
                        "said": h["complaint_desc"], "did": h["performed_desc"], "source": "epass"})
        jobs = db.fetchall("SELECT job_id FROM job WHERE customer_id=?", (customer_id,))
    elif serial:
        s = serial.strip().upper()
        for h in db.fetchall("SELECT d.sv_number, h.created_date, h.finish_date, h.epass_status, h.sp_code, d.complaint_desc, d.performed_desc,"
                             " d.brand_code, d.model, d.serial FROM service_detail d LEFT JOIN service_history h ON h.sv_number=d.sv_number"
                             " WHERE UPPER(COALESCE(d.serial,''))=? ORDER BY COALESCE(h.finish_date, h.created_date) DESC LIMIT ?", (s, limit)):
            out.append({"sv": (h["sv_number"] or "").strip(), "date": h["finish_date"] or h["created_date"], "status": h["epass_status"],
                        "tech": h["sp_code"], "unit": " ".join(x for x in (h["brand_code"], h["model"]) if x), "serial": h["serial"],
                        "said": h["complaint_desc"], "did": h["performed_desc"], "source": "epass"})
        jobs = db.fetchall("SELECT DISTINCT j.job_id FROM job j JOIN unit u ON u.job_id=j.job_id WHERE UPPER(COALESCE(u.serial,''))=?", (s,))
    else:
        return []
    for j in jobs:
        job = db.fetchone("SELECT sv_number, status, problem_text FROM job WHERE job_id=?", (j["job_id"],)) or {}
        unit = db.fetchone("SELECT brand, model, serial FROM unit WHERE job_id=? ORDER BY unit_id", (j["job_id"],)) or {}
        for f in for_job(db, j["job_id"]):
            out.append({"sv": job.get("sv_number") or f"job {j['job_id']}", "date": f["visit_date"], "status": f["to_status"] or job.get("status"),
                        "tech": f.get("sp_code"), "unit": " ".join(x for x in (unit.get("brand"), unit.get("model")) if x), "serial": unit.get("serial"),
                        "said": job.get("problem_text"), "did": f["performed_text"], "source": "dashboard", "findings_id": f["findings_id"]})
    out.sort(key=lambda r: (r["date"] or ""), reverse=True)
    return out[:limit]

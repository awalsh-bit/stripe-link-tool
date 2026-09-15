"""A very small HTTP shim so the live dashboard's "Copy to service dashboard test module" button has something to call
today, before the real API (spec §7) exists. Standard library only. One DB connection behind a lock.

    python -m wilson_service serve                 # port from setting serve.port (8765)

    GET  /health                                   -> {"ok":true,"last_import":...,"open_jobs":N}
    POST /api/requests            body = queue payload (see intake.py)   -> {"job_id","status","suggestions":[...]}
    POST /api/requests/<job_id>/sv   {"sv_number":"SV00123456"}          -> attach / merge
    GET  /api/jobs/<job_id>/suggest                                      -> dispatcher suggestions (Unscheduled panel)
    GET  /api/jobs/<job_id>/offer                                        -> customer picker dates, best fit first
    POST /api/jobs/<job_id>/pencil                                       -> (re)run the SO4 pencil
    GET  /api/board?date=YYYY-MM-DD                                      -> stops + pencils per tech for one day
    GET  /api/shadow?since=YYYY-MM-DD                                    -> suggested vs actual scorecard

Auth: if setting serve.token is non-empty, every request needs header X-Token. CORS: serve.cors_origin.
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional
from urllib.parse import urlparse, parse_qs

from .db import DB
from . import intake, placement

_LOCK = threading.Lock()


def _json_default(o):
    if isinstance(o, (_dt.date, _dt.datetime)):
        return o.isoformat()
    return str(o)


def board(db: DB, date: str) -> dict:
    techs = db.fetchall("SELECT tech_id, sp_code, name FROM tech WHERE active=1 AND auto_schedule=1 ORDER BY sp_code")
    out = {"date": date, "techs": []}
    for t in techs:
        load = placement.day_load(db, t["tech_id"], date)
        stops = []
        for s in load["stops"]:
            c = db.fetchone("SELECT display_name FROM customer WHERE customer_id=?", (s.get("customer_id"),)) or {}
            a = db.fetchone("SELECT line1, city, zip, lat, lng FROM address WHERE address_id=?", (s.get("address_id"),)) or {}
            stops.append({"job_id": s["job_id"], "sv": s.get("sv_number"), "status": s.get("status"), "customer": c.get("display_name"), "address": a.get("line1"),
                          "city": a.get("city"), "zip": a.get("zip"), "lat": a.get("lat"), "lng": a.get("lng"), "zone": s.get("zone_code"), "sequence": s.get("route_sequence"),
                          "penciled": bool(s.get("penciled")), "pencil_reason": s.get("pencil_reason") if s.get("penciled") else None, "est_minutes": placement.est_minutes(db, s),
                          "flags": s.get("flags"), "epass_status": s.get("epass_status")})
        out["techs"].append({"tech_id": t["tech_id"], "sp_code": t["sp_code"], "name": t["name"], "open": placement.is_open(db, t["tech_id"], date),
                             "capacity_min": load["capacity"], "work_min": load["work"], "drive_min": load["drive"], "remaining_min": load["remaining"], "stops": stops})
    return out


def make_handler(db: DB, token: str, cors: str):
    class H(BaseHTTPRequestHandler):
        server_version = "wilson_service/0.1"

        def _send(self, code: int, body: dict):
            data = json.dumps(body, default=_json_default).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", cors)
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()
            self.wfile.write(data)

        def _auth(self) -> bool:
            if token and self.headers.get("X-Token") != token:
                self._send(401, {"error": "bad or missing X-Token"})
                return False
            return True

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b""
            return json.loads(raw.decode("utf-8")) if raw else {}

        def do_OPTIONS(self):
            self._send(204, {})

        def do_GET(self):
            if not self._auth():
                return
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            try:
                with _LOCK:
                    if u.path == "/health":
                        last = db.fetchone("SELECT imported_at, file_name FROM import_batch WHERE status='ok' ORDER BY imported_at DESC")
                        n = db.scalar("SELECT COUNT(*) FROM job WHERE closed_at IS NULL")
                        return self._send(200, {"ok": True, "last_import": last, "open_jobs": n})
                    m = re.match(r"^/api/jobs/(\d+)/(suggest|offer)$", u.path)
                    if m:
                        jid = int(m.group(1))
                        res = placement.suggest(db, jid) if m.group(2) == "suggest" else placement.offer(db, jid)
                        return self._send(200, {"job_id": jid, m.group(2): res})
                    if u.path == "/api/board":
                        date = q.get("date") or _dt.date.today().isoformat()
                        return self._send(200, board(db, date))
                    if u.path == "/api/shadow":
                        return self._send(200, placement.scorecard(db, q.get("since")))
                    m = re.match(r"^/api/requests/by-ref/([^/]+)$", u.path)
                    if m:
                        j = db.fetchone("SELECT job_id FROM job WHERE source_ref=?", (f"queue:{m.group(1)}",))
                        return self._send(200 if j else 404, intake._result(db, j["job_id"], created=False, now=_dt.datetime.now()) if j else {"error": "not found"})
                return self._send(404, {"error": "no such route"})
            except Exception as e:  # noqa: BLE001 — surface the message to the caller
                db.rollback()
                return self._send(400, {"error": str(e)})

        def do_POST(self):
            if not self._auth():
                return
            u = urlparse(self.path)
            try:
                body = self._body()
                with _LOCK:
                    if u.path == "/api/requests":
                        res = intake.from_queue(db, body)
                        db.commit()
                        return self._send(201 if res.get("created") else 200, res)
                    m = re.match(r"^/api/requests/(\d+)/sv$", u.path)
                    if m:
                        res = intake.attach_sv(db, int(m.group(1)), body.get("sv_number") or "", body.get("user") or "queue")
                        db.commit()
                        return self._send(200, res)
                    m = re.match(r"^/api/jobs/(\d+)/pencil$", u.path)
                    if m:
                        res = placement.pencil(db, int(m.group(1)), body.get("user") or "office")
                        db.commit()
                        return self._send(200, {"pencil": res})
                return self._send(404, {"error": "no such route"})
            except Exception as e:  # noqa: BLE001
                db.rollback()
                return self._send(400, {"error": str(e)})

        def log_message(self, fmt, *args):  # quieter default log
            print("%s - %s" % (self.address_string(), fmt % args))

    return H


def run(db: DB, port: Optional[int] = None, host: str = "127.0.0.1") -> None:
    port = port or db.setting("serve.port", 8765)
    token = db.setting("serve.token", "") or ""
    cors = db.setting("serve.cors_origin", "*") or "*"
    httpd = ThreadingHTTPServer((host, int(port)), make_handler(db, token, cors))
    print(f"wilson_service serve on http://{host}:{port}  (token {'set' if token else 'not set'}, CORS {cors}) — Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

from __future__ import annotations

"""
WILSON MAINTENANCE PORTAL -- LOCAL SERVER

WHAT CHANGED IN v0.9.15, AND WHY IT HAD TO
------------------------------------------
Up to v0.9.14 this served every file in the folder to anyone who could reach
the port, bound to 0.0.0.0, with an unauthenticated 30 MB upload endpoint
attached. That was defensible while the only data in it was invented: the
Reynolds estate is not a real customer.

The moment a real maintenance stop is run, the same folder holds a real
customer's name, address, phone number and photographs of the inside of
their house. On a store's Wi-Fi, or a phone hotspot at a job site, "anyone
who can reach the port" is not a small set of people.

So there are now two rules, and they are enforced rather than documented:

  1. LOOPBACK IS THE DEFAULT. Without --lan the socket binds 127.0.0.1 and
     nothing off the machine can reach it at all.
  2. THE NETWORK NEEDS A PASSCODE. --lan refuses to start unless a passcode
     is set. There is no flag combination that serves customer data to a
     network unauthenticated, because the flag that would do it does not
     exist.

The passcode is never stored: `--set-passcode` writes a salted SHA-256 to
.wilson-passcode, which the packager and .gitignore both exclude. It can
also come from the WILSON_PASSCODE environment variable, which is what a
scheduled or scripted start should use.

This is a shared-passcode gate on a prototype, not an identity system:
everyone who has it is "the shop". Per-user accounts and roles belong to the
main dashboard, and that is where they should stay.
"""

import argparse
import base64
import contextlib
import hashlib
import hmac
import html
import http.server
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
import traceback
import urllib.parse
import webbrowser
from email import policy
from email.parser import BytesParser
from pathlib import Path

from invoice_parser import parse_invoice_files

BROWSER_HOST = "127.0.0.1"
START_PORT = 8080
END_PORT = 8090
ROOT = Path(__file__).resolve().parent
MAX_UPLOAD_BYTES = 30 * 1024 * 1024

# One photograph, after the browser has downscaled it, lands around 150-400KB.
# 8 MB is generous enough for a phone that refuses to re-encode and small
# enough that a bad request cannot exhaust the machine.
MAX_PHOTO_BYTES = 8 * 1024 * 1024
PHOTO_ROOT = ROOT / "photo-store"
PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

PASSCODE_FILE = ROOT / ".wilson-passcode"
SESSION_HOURS = 12
SESSION_COOKIE = "wilson_session"

# Failed attempts per client address. A shared passcode on a shop network is
# worth guessing at, so guessing is made slow rather than merely logged.
MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 60

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


# ---------------------------------------------------------------------------
# Passcode storage
# ---------------------------------------------------------------------------
def hash_passcode(passcode: str, salt: str) -> str:
    """PBKDF2 rather than a bare hash: the whole file is one guessable secret."""
    dk = hashlib.pbkdf2_hmac("sha256", passcode.encode("utf-8"),
                             salt.encode("utf-8"), 120_000)
    return base64.b16encode(dk).decode("ascii").lower()


def write_passcode(passcode: str) -> None:
    salt = secrets.token_hex(16)
    PASSCODE_FILE.write_text(
        json.dumps({"salt": salt, "hash": hash_passcode(passcode, salt),
                    "iterations": 120_000}),
        encoding="utf-8",
    )
    with contextlib.suppress(OSError):
        os.chmod(PASSCODE_FILE, 0o600)


def stored_passcode() -> dict | None:
    env = os.environ.get("WILSON_PASSCODE", "").strip()
    if env:
        salt = "env"
        return {"salt": salt, "hash": hash_passcode(env, salt), "source": "environment"}
    if PASSCODE_FILE.exists():
        try:
            data = json.loads(PASSCODE_FILE.read_text(encoding="utf-8"))
            if data.get("salt") and data.get("hash"):
                data["source"] = PASSCODE_FILE.name
                return data
        except (OSError, ValueError):
            return None
    return None


def passcode_matches(passcode: str) -> bool:
    record = stored_passcode()
    if not record or not passcode:
        return False
    candidate = hash_passcode(passcode, record["salt"])
    # Constant time: a length or early-byte difference must not be measurable.
    return hmac.compare_digest(candidate, record["hash"])


# ---------------------------------------------------------------------------
# Sessions, in memory. Restarting the server logs everyone out, which for a
# prototype is a feature.
# ---------------------------------------------------------------------------
SESSIONS: dict[str, float] = {}
SESSION_LOCK = threading.Lock()
ATTEMPTS: dict[str, list] = {}


def new_session() -> str:
    token = secrets.token_urlsafe(32)
    with SESSION_LOCK:
        now = time.time()
        for key, expiry in list(SESSIONS.items()):
            if expiry < now:
                del SESSIONS[key]
        SESSIONS[token] = now + SESSION_HOURS * 3600
    return token


def session_valid(token: str | None) -> bool:
    if not token:
        return False
    with SESSION_LOCK:
        expiry = SESSIONS.get(token)
        if not expiry:
            return False
        if expiry < time.time():
            del SESSIONS[token]
            return False
        return True


def drop_session(token: str | None) -> None:
    if not token:
        return
    with SESSION_LOCK:
        SESSIONS.pop(token, None)


def locked_out(addr: str) -> int:
    """Seconds still to wait, or 0."""
    tries = ATTEMPTS.get(addr) or []
    tries = [t for t in tries if t > time.time() - LOCKOUT_SECONDS]
    ATTEMPTS[addr] = tries
    if len(tries) >= MAX_ATTEMPTS:
        return int(LOCKOUT_SECONDS - (time.time() - tries[0])) + 1
    return 0


def record_failure(addr: str) -> None:
    ATTEMPTS.setdefault(addr, []).append(time.time())


LOGIN_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wilson Maintenance &mdash; sign in</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:#12331f; color:#f4f8f5;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }}
  .card {{ width:100%; max-width:22rem; }}
  h1 {{ font-size:1.25rem; margin:0 0 .3rem; }}
  p {{ color:#c8d8cd; line-height:1.5; margin:0 0 1.2rem; font-size:.92rem; }}
  label {{ display:block; font-size:.72rem; letter-spacing:.12em; text-transform:uppercase;
          color:#9fb8a8; margin-bottom:.4rem; font-weight:600; }}
  input {{ width:100%; font-size:1rem; padding:.75rem .8rem; border-radius:9px;
          border:1px solid #2c4a37; background:#0d2417; color:#f4f8f5; }}
  button {{ width:100%; margin-top:.9rem; font-size:1rem; font-weight:700; padding:.8rem;
           border-radius:9px; border:0; background:#f4f8f5; color:#12331f; }}
  .err {{ background:#4a1f16; border:1px solid #7a3423; border-radius:9px;
         padding:.7rem .8rem; font-size:.88rem; margin-bottom:1rem; }}
</style></head><body><div class="card">
<h1>Wilson Maintenance</h1>
<p>This prototype holds customer names, addresses and job photographs. It needs the shop passcode.</p>
{error}
<form method="post" action="/login">
  <input type="hidden" name="next" value="{next}">
  <label for="p">Shop passcode</label>
  <input id="p" name="passcode" type="password" autocomplete="current-password" autofocus>
  <button type="submit">Sign in</button>
</form>
</div></body></html>"""


class WilsonPortalHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".md": "text/markdown",
        ".sql": "text/plain",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
    }

    require_auth = True

    # -- plumbing ----------------------------------------------------------
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:
        sys.stdout.write("%s - %s\n" % (self.log_date_time_string(), format % args))

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, status: int, body: str, headers: list[tuple[str, str]] | None = None) -> None:
        raw = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        for key, value in headers or []:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)

    def _cookie(self, name: str) -> str | None:
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            if "=" in part:
                key, _, value = part.strip().partition("=")
                if key == name:
                    return value
        return None

    def _client(self) -> str:
        return self.client_address[0] if self.client_address else "?"

    def _authed(self) -> bool:
        if not self.require_auth:
            return True
        return session_valid(self._cookie(SESSION_COOKIE))

    def _login_page(self, status: int = 200, error: str = "", next_url: str = "/index.html") -> None:
        block = ('<div class="err">%s</div>' % html.escape(error)) if error else ""
        page = LOGIN_PAGE.format(error=block, next=html.escape(next_url, quote=True))
        self._send_html(status, page)

    # -- the gate ----------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path == "/login":
            if not self.require_auth:
                self.send_response(302)
                self.send_header("Location", "/index.html")
                self.end_headers()
                return
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            self._login_page(next_url=(query.get("next") or ["/index.html"])[0])
            return
        if path == "/logout":
            drop_session(self._cookie(SESSION_COOKIE))
            self.send_response(302)
            self.send_header("Location", "/login")
            self.send_header("Set-Cookie", "%s=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" % SESSION_COOKIE)
            self.end_headers()
            return

        if not self._authed():
            if path.startswith("/api/"):
                self._send_json(401, {"ok": False, "error": "Sign in first.", "auth": "required"})
                return
            nxt = urllib.parse.quote(self.path, safe="/?=&")
            self.send_response(302)
            self.send_header("Location", "/login?next=" + nxt)
            self.end_headers()
            return

        if path == "/api/photos":
            self._list_photos()
            return
        if path == "/api/session":
            self._send_json(200, {"ok": True, "authenticated": True})
            return

        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if not self._authed():
            self.send_response(302)
            self.send_header("Location", "/login")
            self.end_headers()
            return
        super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path

        if path == "/login":
            self._do_login()
            return

        if not self._authed():
            self._send_json(401, {"ok": False, "error": "Sign in first.", "auth": "required"})
            return

        if path == "/api/invoice/import":
            self._do_invoice_import()
            return
        if path == "/api/photos":
            self._do_photo_upload()
            return

        self._send_json(404, {"ok": False, "error": "Unknown API endpoint."})

    # -- login -------------------------------------------------------------
    def _do_login(self) -> None:
        wait = locked_out(self._client())
        if wait:
            self._login_page(429, "Too many tries. Wait %d seconds and try again." % wait)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > 4096:
            self._login_page(400, "That form did not arrive properly. Try again.")
            return
        form = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8", "replace"))
        passcode = (form.get("passcode") or [""])[0]
        next_url = (form.get("next") or ["/index.html"])[0]
        if not next_url.startswith("/") or next_url.startswith("//"):
            next_url = "/index.html"      # never bounce off-site on our say-so

        if not passcode_matches(passcode):
            record_failure(self._client())
            self.log_message("failed sign-in from %s", self._client())
            self._login_page(401, "That is not the passcode.", next_url=next_url)
            return

        token = new_session()
        self.send_response(302)
        self.send_header("Location", next_url)
        self.send_header(
            "Set-Cookie",
            "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax"
            % (SESSION_COOKIE, token, SESSION_HOURS * 3600),
        )
        self.end_headers()

    # -- invoices ----------------------------------------------------------
    def _do_invoice_import(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0") or 0)
            if content_length <= 0:
                self._send_json(400, {"ok": False, "error": "No invoice files were received."})
                return
            if content_length > MAX_UPLOAD_BYTES:
                self._send_json(413, {"ok": False, "error": "The combined upload is larger than 30 MB."})
                return

            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data"):
                self._send_json(415, {"ok": False, "error": "Upload PDF invoices using multipart form data."})
                return

            raw_body = self.rfile.read(content_length)
            mime = (
                f"Content-Type: {content_type}\r\n"
                "MIME-Version: 1.0\r\n\r\n"
            ).encode("utf-8") + raw_body
            message = BytesParser(policy=policy.default).parsebytes(mime)

            files: list[tuple[str, bytes]] = []
            for part in message.iter_parts():
                filename = part.get_filename()
                if not filename:
                    continue
                payload = part.get_payload(decode=True) or b""
                if not payload:
                    continue
                if not filename.lower().endswith(".pdf"):
                    continue
                files.append((Path(filename).name, payload))

            if not files:
                self._send_json(400, {"ok": False, "error": "No PDF invoice files were found in the upload."})
                return

            result = parse_invoice_files(files)
            self._send_json(200, result)
        except Exception as exc:  # pragma: no cover - surfaced to prototype UI
            traceback.print_exc()
            self._send_json(500, {"ok": False, "error": f"Invoice parsing failed: {exc}"})

    # -- photographs -------------------------------------------------------
    def _do_photo_upload(self) -> None:
        """
        One photograph, raw, with its identity in the headers.

        Raw body rather than multipart because the client has a Blob in hand
        from IndexedDB: base64 would add a third to every job-site upload and
        multipart would add a parser for no gain.
        """
        try:
            photo_id = (self.headers.get("X-Photo-Id") or "").strip()
            visit_id = (self.headers.get("X-Visit-Id") or "").strip()
            asset_id = (self.headers.get("X-Asset-Id") or "").strip()
            content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            length = int(self.headers.get("Content-Length", "0") or 0)

            if not SAFE_ID.match(photo_id):
                self._send_json(400, {"ok": False, "error": "A photo needs a plain id."})
                return
            if visit_id and not SAFE_ID.match(visit_id):
                self._send_json(400, {"ok": False, "error": "That visit id is not one of ours."})
                return
            if asset_id and not SAFE_ID.match(asset_id):
                self._send_json(400, {"ok": False, "error": "That appliance id is not one of ours."})
                return
            if content_type not in PHOTO_TYPES:
                self._send_json(415, {"ok": False, "error": "Photographs go up as JPEG, PNG or WebP."})
                return
            if length <= 0:
                self._send_json(400, {"ok": False, "error": "That upload was empty."})
                return
            if length > MAX_PHOTO_BYTES:
                self._send_json(413, {"ok": False,
                                      "error": "That photo is over %d MB." % (MAX_PHOTO_BYTES // (1024 * 1024))})
                return

            body = self.rfile.read(length)
            if len(body) != length:
                self._send_json(400, {"ok": False, "error": "That upload was cut short. It was not saved."})
                return

            folder = PHOTO_ROOT / (visit_id or "unassigned")
            folder.mkdir(parents=True, exist_ok=True)
            target = folder / (photo_id + PHOTO_TYPES[content_type])

            # Written beside and renamed: a connection dropped mid-write must
            # not leave a half a photograph looking like a stored one.
            temp = folder / (photo_id + ".part")
            temp.write_bytes(body)
            temp.replace(target)

            sidecar = folder / (photo_id + ".json")
            sidecar.write_text(json.dumps({
                "id": photo_id,
                "visitId": visit_id,
                "assetId": asset_id,
                "checkId": (self.headers.get("X-Check-Id") or "").strip()[:64],
                "kind": (self.headers.get("X-Photo-Kind") or "").strip()[:32],
                "capturedAt": (self.headers.get("X-Captured-At") or "").strip()[:40],
                "technician": (self.headers.get("X-Technician") or "").strip()[:80],
                "contentType": content_type,
                "bytes": len(body),
                "storedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "file": target.name,
            }, ensure_ascii=False, indent=1), encoding="utf-8")

            self._send_json(200, {"ok": True, "id": photo_id, "bytes": len(body),
                                  "storedAt": time.strftime("%Y-%m-%dT%H:%M:%S")})
        except Exception as exc:  # pragma: no cover
            traceback.print_exc()
            self._send_json(500, {"ok": False, "error": f"That photo could not be saved: {exc}"})

    def _list_photos(self) -> None:
        """Which photographs this machine already holds, so the phone can stop
        offering them and stop showing them as waiting."""
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        visit = (query.get("visit") or [""])[0].strip()
        if visit and not SAFE_ID.match(visit):
            self._send_json(400, {"ok": False, "error": "That visit id is not one of ours."})
            return
        folders = [PHOTO_ROOT / visit] if visit else (
            [p for p in PHOTO_ROOT.iterdir() if p.is_dir()] if PHOTO_ROOT.exists() else []
        )
        ids: list[str] = []
        for folder in folders:
            if not folder.exists():
                continue
            for sidecar in folder.glob("*.json"):
                ids.append(sidecar.stem)
        self._send_json(200, {"ok": True, "visit": visit, "ids": sorted(ids), "count": len(ids)})


def port_is_available(host: str, port: int) -> bool:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
        return True


def choose_port(host: str) -> int:
    for port in range(START_PORT, END_PORT + 1):
        if port_is_available(host, port):
            return port
    raise RuntimeError(f"No open port was found between {START_PORT} and {END_PORT}.")


def local_network_ip() -> str:
    """Best-effort LAN IPv4 for opening the prototype from a phone on the same network."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "YOUR-PC-IP"
    finally:
        sock.close()


def local_network_ips() -> list[str]:
    """
    EVERY IPv4 this machine has, best guess first.

    `local_network_ip` returns the address on the DEFAULT ROUTE, which is the
    right answer on a plain laptop and the wrong one on a developer's: a VPN, a
    Docker bridge or a Hyper-V switch owns the default route, and the address
    printed is then one no phone on the Wi-Fi can reach. The symptom is a page
    that never loads and no error to read.

    So every address is offered, with the private-network ones first, and the
    tester tries them in order.
    """
    found = []
    primary = local_network_ip()
    if primary and primary != "YOUR-PC-IP":
        found.append(primary)
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = info[4][0]
            if address not in found:
                found.append(address)
    except OSError:
        pass

    def rank(address: str) -> tuple:
        # 192.168.x and 10.x are what home and shop Wi-Fi hand out. 172.16-31 is
        # also private but is what Docker and Hyper-V use, so it sorts last.
        if address.startswith("192.168."):
            return (0, address)
        if address.startswith("10."):
            return (1, address)
        if address.startswith("172."):
            return (3, address)
        if address.startswith("127."):
            return (4, address)
        return (2, address)

    return sorted(found, key=rank) or ["YOUR-PC-IP"]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve the Wilson maintenance prototype locally.")
    parser.add_argument("--lan", action="store_true",
                        help="also serve phones on this network (requires a passcode)")
    parser.add_argument("--port", type=int, default=0, help="use one specific port")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser")
    parser.add_argument("--set-passcode", action="store_true",
                        help="set or change the shop passcode, then exit")
    parser.add_argument("--open-local", action="store_true",
                        help="loopback only, no passcode -- demo data only")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    os.chdir(ROOT)
    args = parse_args(argv if argv is not None else sys.argv[1:])

    if args.set_passcode:
        print("\nSet the shop passcode for this prototype.")
        print("Everyone who opens the tool on a phone will type this.\n")
        try:
            import getpass
            first = getpass.getpass("Passcode: ")
            second = getpass.getpass("Again: ")
        except (EOFError, KeyboardInterrupt):
            print("\nNothing changed.")
            return 1
        if len(first) < 6:
            print("\nThat is too short. Use at least six characters.")
            return 1
        if first != second:
            print("\nThose did not match. Nothing changed.")
            return 1
        write_passcode(first)
        print("\nSaved to %s. It is stored as a hash, not as the passcode itself." % PASSCODE_FILE.name)
        print("This file is excluded from the package and from git.")
        return 0

    have_passcode = stored_passcode() is not None

    # The one rule worth enforcing in code: nothing reaches the network
    # without a passcode in front of it.
    if args.lan and not have_passcode:
        print("\nThis would put customer names, addresses and job photographs on")
        print("the network with nothing in front of them, so it will not start.\n")
        print("  Set a passcode first:   python serve_portal.py --set-passcode")
        print("  Or stay on this machine: python serve_portal.py\n")
        return 2

    host = "0.0.0.0" if args.lan else "127.0.0.1"
    require_auth = have_passcode and not args.open_local

    if args.open_local and args.lan:
        print("\n--open-local turns the passcode off, so it cannot be combined with --lan.\n")
        return 2

    try:
        port = args.port or choose_port(host)
    except RuntimeError as exc:
        print(f"\nERROR: {exc}")
        return 1

    WilsonPortalHandler.require_auth = require_auth
    server = http.server.ThreadingHTTPServer((host, port), WilsonPortalHandler)
    url = f"http://{BROWSER_HOST}:{port}/index.html"

    print("\nWilson Maintenance Portal prototype v0.9.20")
    print("-------------------------------------------")
    print(f"Computer: {url}")
    if args.lan:
        addresses = local_network_ips()
        print(f"Phone (same Wi-Fi/LAN): http://{addresses[0]}:{port}/index.html")
        for extra in addresses[1:3]:
            print(f"  ...if that one does not load, try: http://{extra}:{port}/index.html")
        print("If Windows Firewall prompts for Python, allow Private networks only.")
        print("The phone must be on the SAME Wi-Fi -- not guest Wi-Fi, and not cellular.")
    else:
        # Spelled out because this is the failure people actually hit: the only
        # address on screen is 127.0.0.1, which on a phone means the phone.
        print("THIS MACHINE ONLY. The address above will NOT work from a phone --")
        print("127.0.0.1 means 'this device', so on a phone it points at the phone.")
        print("To test on a phone:  1) SET_PASSCODE.bat   2) OPEN_FOR_PHONES.bat")
    if require_auth:
        print(f"Passcode required (from {stored_passcode()['source']}). Sessions last {SESSION_HOURS} hours.")
    else:
        print("NO PASSCODE SET -- loopback only, and fine for demo data.")
        print("Before a real customer's details go in here: python serve_portal.py --set-passcode")
    print("Photographs uploaded from phones are saved in ./photo-store")
    print("Keep this window open while using the prototype.")
    print("Press Ctrl+C here when you are finished.\n")

    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url, new=1)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Wilson Maintenance Portal...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

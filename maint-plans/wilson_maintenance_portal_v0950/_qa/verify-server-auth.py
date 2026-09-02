#!/usr/bin/env python3
"""
VERIFY THE SERVER'S TWO RULES

The prototype is about to hold real customers' names, addresses and
photographs of the inside of their houses. Two rules are supposed to make
that safe enough for a pilot, and both are the kind of thing that is easy to
believe and wrong:

  1. Nothing reaches the network without a passcode in front of it.
  2. A wrong passcode gets you nothing, and guessing gets slow.

So this starts the real server as a subprocess, in each configuration, and
tries to get files out of it. Reading the source would prove nothing: the
interesting failures here are the ones where the code looks right and the
socket says otherwise.
"""

import http.client
import json
import os
import pathlib
import re
import socket
import subprocess
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SERVER = ROOT / "serve_portal.py"

CHECKS = []
def ok(name, cond, detail=""):
    CHECKS.append((bool(cond), name, detail))


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Server:
    """The real serve_portal.py, in a subprocess, on its own port."""

    def __init__(self, args, env=None, cwd=None, script=None):
        self.port = free_port()
        # `script` matters: the server resolves its passcode file and document
        # root from the location of its own file, not from the working
        # directory, so a sandbox test has to run the sandbox's copy.
        self.args = [sys.executable, str(script or SERVER), "--no-browser",
                     "--port", str(self.port)] + args
        self.env = dict(os.environ)
        self.env.pop("WILSON_PASSCODE", None)
        if env:
            self.env.update(env)
        self.cwd = str(cwd or ROOT)
        self.proc = None

    def __enter__(self):
        self.proc = subprocess.Popen(self.args, stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, text=True,
                                     env=self.env, cwd=self.cwd)
        for _ in range(80):
            if self.proc.poll() is not None:
                break
            try:
                with socket.create_connection(("127.0.0.1", self.port), 0.2):
                    return self
            except OSError:
                time.sleep(0.05)
        return self

    def __exit__(self, *exc):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def exited(self):
        try:
            self.proc.wait(timeout=6)
        except subprocess.TimeoutExpired:
            return None
        return self.proc.returncode

    def output(self):
        try:
            return self.proc.communicate(timeout=5)[0] or ""
        except subprocess.TimeoutExpired:
            return ""

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=6)
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        out = (resp.status, dict(resp.getheaders()), data)
        conn.close()
        return out


# ---------------------------------------------------------------------------
# 1. --lan with no passcode must refuse to start at all
# ---------------------------------------------------------------------------
with Server(["--lan"]) as srv:
    code = srv.exited()
    text = srv.output()
ok("--lan refuses to start without a passcode", code == 2, "exit %s" % code)
ok("and says how to set one", "--set-passcode" in text, text[:160])
ok("and says why", "network" in text.lower(), text[:160])

# ---------------------------------------------------------------------------
# 2. no passcode, loopback: serves, and says plainly that it is unprotected
# ---------------------------------------------------------------------------
with Server([]) as srv:
    status, _, body = srv.request("GET", "/index.html")
    ok("loopback with no passcode still serves the demo", status == 200, str(status))
    ok("the page is the real one", b"Wilson" in body)

# ---------------------------------------------------------------------------
# 3. with a passcode: nothing comes out until you sign in
# ---------------------------------------------------------------------------
PASS = "reynolds-estate-2026"
with Server([], env={"WILSON_PASSCODE": PASS}) as srv:
    status, headers, body = srv.request("GET", "/index.html")
    ok("a page redirects to the login", status == 302, str(status))
    ok("and back to where you were going",
       "next=" in headers.get("Location", ""), headers.get("Location"))

    status, _, body = srv.request("GET", "/admin.html")
    ok("the command centre is behind it too", status == 302, str(status))

    status, _, body = srv.request("GET", "/assets/store.js")
    ok("so is the data layer", status == 302, str(status))

    status, _, body = srv.request("GET", "/api/photos?visit=v1")
    ok("an API says 401 rather than redirecting", status == 401, str(status))
    ok("and says so in JSON", json.loads(body).get("auth") == "required")

    status, _, body = srv.request("POST", "/api/invoice/import", body=b"x",
                                  headers={"Content-Type": "multipart/form-data; boundary=x"})
    ok("the invoice endpoint is closed", status == 401, str(status))

    status, _, body = srv.request("POST", "/api/photos", body=b"\xff\xd8\xff",
                                  headers={"Content-Type": "image/jpeg", "X-Photo-Id": "p1"})
    ok("the photo endpoint is closed", status == 401, str(status))

    status, _, body = srv.request("GET", "/login")
    ok("the login page itself is reachable", status == 200, str(status))
    ok("and explains what is behind it",
       b"customer names" in body and b"passcode" in body.lower())

    # wrong passcode
    status, headers, body = srv.request(
        "POST", "/login", body="passcode=wrong&next=%2Findex.html",
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    ok("a wrong passcode is refused", status == 401, str(status))
    ok("and sets no cookie", "Set-Cookie" not in headers)

    # right passcode
    status, headers, body = srv.request(
        "POST", "/login", body="passcode=" + PASS + "&next=%2Fadmin.html",
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    ok("the right passcode signs in", status == 302, str(status))
    cookie = headers.get("Set-Cookie", "")
    ok("the session cookie is set", "wilson_session=" in cookie, cookie)
    ok("the cookie is HttpOnly", "HttpOnly" in cookie, cookie)
    ok("the cookie is SameSite", "SameSite" in cookie, cookie)
    ok("it goes where you were headed", headers.get("Location") == "/admin.html",
       headers.get("Location"))

    token = re.search(r"wilson_session=([^;]+)", cookie).group(1)
    auth = {"Cookie": "wilson_session=" + token}

    status, _, body = srv.request("GET", "/index.html", headers=auth)
    ok("signed in, the app loads", status == 200 and b"Wilson" in body, str(status))

    status, _, body = srv.request("GET", "/api/session", headers=auth)
    ok("the session endpoint confirms it", json.loads(body).get("authenticated") is True)

    # a made-up token is not a session
    status, _, _ = srv.request("GET", "/index.html",
                               headers={"Cookie": "wilson_session=" + "a" * 43})
    ok("an invented token is not a session", status == 302, str(status))

    # ---------------------------------------------------------------
    # 4. photographs: stored, listed, and bounded
    # ---------------------------------------------------------------
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 2048 + b"\xff\xd9"
    status, _, body = srv.request("POST", "/api/photos", body=jpeg, headers=dict(
        auth, **{"Content-Type": "image/jpeg", "X-Photo-Id": "ph_test_1",
                 "X-Visit-Id": "visit_qa_1", "X-Asset-Id": "asset_qa_1",
                 "X-Captured-At": "2026-08-25T10:00:00Z"}))
    ok("a photo uploads", status == 200 and json.loads(body).get("ok") is True, str(status) + body.decode()[:80])
    ok("and the server reports the byte count it wrote",
       json.loads(body).get("bytes") == len(jpeg))

    stored = ROOT / "photo-store" / "visit_qa_1" / "ph_test_1.jpg"
    ok("the file is on disk", stored.exists(), str(stored))
    ok("with the bytes that were sent", stored.exists() and stored.read_bytes() == jpeg)
    side = ROOT / "photo-store" / "visit_qa_1" / "ph_test_1.json"
    ok("with a sidecar saying what it is evidence of", side.exists())
    if side.exists():
        meta = json.loads(side.read_text())
        ok("the sidecar keeps the appliance", meta.get("assetId") == "asset_qa_1")
        ok("the sidecar keeps when it was taken", meta.get("capturedAt") == "2026-08-25T10:00:00Z")

    status, _, body = srv.request("GET", "/api/photos?visit=visit_qa_1", headers=auth)
    ok("the list says what the machine holds", "ph_test_1" in json.loads(body).get("ids", []))

    # no half-written files left behind
    parts = list((ROOT / "photo-store" / "visit_qa_1").glob("*.part"))
    ok("no partial file is left behind", not parts, str(parts))

    # bounds
    status, _, body = srv.request("POST", "/api/photos", body=jpeg, headers=dict(
        auth, **{"Content-Type": "image/jpeg", "X-Photo-Id": "../../etc/passwd",
                 "X-Visit-Id": "visit_qa_1"}))
    ok("a path in the id is refused", status == 400, str(status))

    status, _, body = srv.request("POST", "/api/photos", body=jpeg, headers=dict(
        auth, **{"Content-Type": "image/jpeg", "X-Photo-Id": "ph2",
                 "X-Visit-Id": "../../evil"}))
    ok("a path in the visit is refused", status == 400, str(status))

    status, _, body = srv.request("POST", "/api/photos", body=b"MZ\x90",  headers=dict(
        auth, **{"Content-Type": "application/octet-stream", "X-Photo-Id": "ph3"}))
    ok("a non-image is refused", status == 415, str(status))

    status, _, body = srv.request("POST", "/api/photos", body=b"x" * 10,  headers=dict(
        auth, **{"Content-Type": "image/jpeg", "X-Photo-Id": "ph4",
                 "Content-Length": str(9 * 1024 * 1024)}))
    ok("an oversized photo is refused", status in (413, 400), str(status))

    status, _, body = srv.request("GET", "/api/photos?visit=..%2F..%2Fetc", headers=auth)
    ok("a path in a list query is refused", status == 400, str(status))

    # logout really ends it
    status, headers, _ = srv.request("GET", "/logout", headers=auth)
    ok("logout redirects to the login", status == 302, str(status))
    status, _, _ = srv.request("GET", "/index.html", headers=auth)
    ok("and the old cookie stops working", status == 302, str(status))

# ---------------------------------------------------------------------------
# 5. guessing gets slow
# ---------------------------------------------------------------------------
with Server([], env={"WILSON_PASSCODE": PASS}) as srv:
    codes = []
    for i in range(7):
        status, _, _ = srv.request(
            "POST", "/login", body="passcode=nope%d" % i,
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        codes.append(status)
    ok("repeated wrong guesses start being locked out", 429 in codes, str(codes))
    ok("and the right passcode is refused while locked out",
       srv.request("POST", "/login", body="passcode=" + PASS,
                   headers={"Content-Type": "application/x-www-form-urlencoded"})[0] == 429)

# ---------------------------------------------------------------------------
# 6. --set-passcode writes a hash, never the passcode
# ---------------------------------------------------------------------------
sandbox = pathlib.Path(tempfile.mkdtemp())
for name in ["serve_portal.py", "invoice_parser.py", "index.html"]:
    (sandbox / name).write_bytes((ROOT / name).read_bytes())
proc = subprocess.run([sys.executable, str(sandbox / "serve_portal.py"), "--set-passcode"],
                      input="sixchars\nsixchars\n", capture_output=True, text=True, cwd=str(sandbox))
pcfile = sandbox / ".wilson-passcode"
ok("--set-passcode writes a file", pcfile.exists(), proc.stdout[-160:])
if pcfile.exists():
    raw = pcfile.read_text()
    ok("the passcode itself is not in it", "sixchars" not in raw)
    ok("a salt and a hash are", '"salt"' in raw and '"hash"' in raw)
    ok("and it is not world-readable",
       (pcfile.stat().st_mode & 0o077) == 0, oct(pcfile.stat().st_mode))

proc = subprocess.run([sys.executable, str(sandbox / "serve_portal.py"), "--set-passcode"],
                      input="short\nshort\n", capture_output=True, text=True, cwd=str(sandbox))
ok("a too-short passcode is refused", proc.returncode == 1 and "six" in proc.stdout.lower(),
   proc.stdout[-120:])
proc = subprocess.run([sys.executable, str(sandbox / "serve_portal.py"), "--set-passcode"],
                      input="onething\notherthing\n", capture_output=True, text=True, cwd=str(sandbox))
ok("a mistyped confirmation is refused", proc.returncode == 1 and "match" in proc.stdout.lower(),
   proc.stdout[-120:])

# a passcode file in the folder means --lan is allowed
with Server(["--lan"], cwd=sandbox, script=sandbox / "serve_portal.py") as srv:
    status, _, _ = srv.request("GET", "/index.html")
    ok("--lan starts once a passcode file exists", status == 302, str(status))

# ---------------------------------------------------------------------------
# 7. the packager and git must not carry the passcode or the photographs
# ---------------------------------------------------------------------------
ignore = (ROOT / ".gitignore").read_text(encoding="utf-8") if (ROOT / ".gitignore").exists() else ""
ok("the passcode file is gitignored", ".wilson-passcode" in ignore, ignore[:120])
ok("the photo store is gitignored", "photo-store" in ignore, ignore[:200])

# clean up what this test wrote
import shutil
shutil.rmtree(ROOT / "photo-store" / "visit_qa_1", ignore_errors=True)

failed = [c for c in CHECKS if not c[0]]
for good, name, detail in CHECKS:
    print(("  ok   " if good else "  FAIL ") + name + (("  -- " + detail) if detail and not good else ""))
print("\n%d checks, %d failed" % (len(CHECKS), len(failed)))
sys.exit(1 if failed else 0)

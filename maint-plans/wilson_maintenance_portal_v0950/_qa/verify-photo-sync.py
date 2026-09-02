#!/usr/bin/env python3
"""
VERIFY THAT PHOTOGRAPHS ACTUALLY LEAVE THE PHONE

The claim being tested is narrow and load-bearing: a technician can look at
"3 photographs waiting" and trust it. That means

  * a photograph is marked as uploaded ONLY after the server says it wrote it,
  * a failed upload leaves it pending, visibly, with the reason kept,
  * a dead network or an expired session stops the run instead of burning the
    queue, and
  * one bad file cannot block the queue behind it or retry forever.

Every one of those is a lie that would look fine in the UI, so this runs the
real server, the real IndexedDB store and the real sync layer in a real
browser, and checks the server's disk rather than the page's opinion.
"""

import http.client
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
PASS = "qa-passcode-2026"
VISIT = "visit_sync_qa"

CHECKS = []
def ok(name, cond, detail=""):
    CHECKS.append((bool(cond), name, detail))


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    return port


PORT = free_port()
env = dict(os.environ)
env["WILSON_PASSCODE"] = PASS
server = subprocess.Popen(
    [sys.executable, str(ROOT / "serve_portal.py"), "--no-browser", "--port", str(PORT)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, cwd=str(ROOT))
for _ in range(80):
    try:
        with socket.create_connection(("127.0.0.1", PORT), 0.2):
            break
    except OSError:
        time.sleep(0.05)

BASE = "http://127.0.0.1:%d" % PORT


def server_ids(cookie):
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=6)
    conn.request("GET", "/api/photos?visit=" + VISIT, headers={"Cookie": cookie})
    resp = conn.getresponse()
    body = json.loads(resp.read() or b"{}")
    conn.close()
    return set(body.get("ids") or [])


# One real JPEG, made in the page, so the whole path is the real path: canvas
# to Blob to IndexedDB to fetch to disk.
MAKE_PHOTO = """
async (label) => {
  const c = document.createElement('canvas');
  c.width = 400; c.height = 300;
  const g = c.getContext('2d');
  g.fillStyle = '#12331f'; g.fillRect(0, 0, 400, 300);
  g.fillStyle = '#fff'; g.font = '28px sans-serif'; g.fillText(label, 20, 160);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return new File([blob], label + '.jpg', { type: 'image/jpeg' });
}
"""

STORE_PHOTO = """
async ([label, visit]) => {
  const c = document.createElement('canvas');
  c.width = 400; c.height = 300;
  const g = c.getContext('2d');
  g.fillStyle = '#12331f'; g.fillRect(0, 0, 400, 300);
  g.fillStyle = '#fff'; g.font = '28px sans-serif'; g.fillText(label, 20, 160);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  const file = new File([blob], label + '.jpg', { type: 'image/jpeg' });
  const stored = await window.WILSON_PHOTOS.put(file, {
    visitId: visit, assetId: 'asset_qa', checkId: 'chk_1',
    kind: 'serial', technician: 'QA'
  });
  return stored.id;
}
"""

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 400, "height": 860})
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))

        # sign in the way a technician does
        pg.goto(BASE + "/tech-maintenance.html")
        ok("an unauthenticated phone lands on the login", "/login" in pg.url, pg.url)
        pg.fill("#p", PASS)
        pg.click("button[type=submit]")
        pg.wait_for_load_state()
        ok("signing in returns to the app", "/login" not in pg.url, pg.url)

        pg.goto(BASE + "/tech-maintenance.html")
        pg.wait_for_function("window.WILSON_PHOTOS && window.WILSON_PHOTO_SYNC")
        ok("the field tool loads the sync layer", True)
        cookie = "; ".join("%s=%s" % (c["name"], c["value"]) for c in ctx.cookies())

        # ---------------------------------------------------------------
        # 1. The happy path, checked against the server's disk
        # ---------------------------------------------------------------
        photo_id = pg.evaluate(STORE_PHOTO, ["serial-plate", VISIT])
        pending = pg.evaluate("() => window.WILSON_PHOTO_SYNC.pending()")
        ok("a new photograph starts out pending", pending >= 1, str(pending))
        ok("and is not on the server yet", photo_id not in server_ids(cookie))

        result = pg.evaluate("() => window.WILSON_PHOTO_SYNC.drain({force: true})")
        ok("the drain reports what it uploaded", result.get("uploaded") == 1, json.dumps(result))
        ok("the drain reports nothing left", result.get("remaining") == 0, json.dumps(result))
        ok("the photograph is on the server", photo_id in server_ids(cookie))

        stored_file = list((ROOT / "photo-store" / VISIT).glob(photo_id + ".*"))
        ok("a real image file was written",
           any(f.suffix == ".jpg" and f.stat().st_size > 1000 for f in stored_file),
           str([(f.name, f.stat().st_size) for f in stored_file]))

        record = pg.evaluate("(id) => window.WILSON_PHOTOS.get(id).then(r => ({uploaded: r.uploaded, at: r.uploadedAt, err: r.uploadError}))", photo_id)
        ok("the local record is marked uploaded", record.get("uploaded") == "yes", json.dumps(record))
        ok("with a timestamp", bool(record.get("at")))
        ok("the local copy is kept, not moved",
           pg.evaluate("(id) => window.WILSON_PHOTOS.get(id).then(r => !!(r && r.blob && r.blob.size))", photo_id))
        ok("pending is now zero", pg.evaluate("() => window.WILSON_PHOTO_SYNC.pending()") == 0)

        # ---------------------------------------------------------------
        # 2. A dead network: nothing is claimed, nothing is lost
        # ---------------------------------------------------------------
        pg.route("**/api/photos", lambda route: route.abort())
        dead_id = pg.evaluate(STORE_PHOTO, ["offline-shot", VISIT])
        result = pg.evaluate("() => window.WILSON_PHOTO_SYNC.drain({force: true})")
        ok("a dead network stops the run", result.get("stoppedBecause") == "offline", json.dumps(result))
        ok("nothing is reported as uploaded", result.get("uploaded") == 0, json.dumps(result))
        ok("it is still pending", result.get("remaining") == 1, json.dumps(result))
        rec = pg.evaluate("(id) => window.WILSON_PHOTOS.get(id).then(r => ({u: r.uploaded, a: r.uploadAttempts}))", dead_id)
        ok("and its record still says it has not left", rec.get("u") == "no", json.dumps(rec))
        ok("a dead network does not count as a failed attempt", rec.get("a") in (0, None), json.dumps(rec))
        ok("the server does not have it", dead_id not in server_ids(cookie))
        pg.unroute("**/api/photos")

        # ---------------------------------------------------------------
        # 3. An expired session stops the run rather than eating the queue
        # ---------------------------------------------------------------
        pg.route("**/api/photos", lambda route: route.fulfill(
            status=401, content_type="application/json",
            body='{"ok":false,"error":"Sign in first.","auth":"required"}'))
        result = pg.evaluate("() => window.WILSON_PHOTO_SYNC.drain({force: true})")
        ok("a signed-out session stops the run", result.get("stoppedBecause") == "signed-out", json.dumps(result))
        rec = pg.evaluate("(id) => window.WILSON_PHOTOS.get(id).then(r => ({u: r.uploaded, a: r.uploadAttempts}))", dead_id)
        ok("and does not burn an attempt on the photo", rec.get("a") in (0, None), json.dumps(rec))
        pg.unroute("**/api/photos")

        # ---------------------------------------------------------------
        # 4. A file the server refuses: recorded, bounded, and out of the way
        # ---------------------------------------------------------------
        pg.route("**/api/photos", lambda route: route.fulfill(
            status=413, content_type="application/json",
            body='{"ok":false,"error":"That photo is over 8 MB."}'))
        result = pg.evaluate("() => window.WILSON_PHOTO_SYNC.drain({force: true})")
        ok("a refused file counts as failed, not uploaded",
           result.get("failed") == 1 and result.get("uploaded") == 0, json.dumps(result))
        rec = pg.evaluate("(id) => window.WILSON_PHOTOS.get(id).then(r => ({u: r.uploaded, a: r.uploadAttempts, e: r.uploadError}))", dead_id)
        ok("the reason is kept on the record", "8 MB" in (rec.get("e") or ""), json.dumps(rec))
        ok("it is still counted as not uploaded", rec.get("u") == "no", json.dumps(rec))

        for _ in range(3):
            pg.evaluate("() => window.WILSON_PHOTO_SYNC.drain({force: true})")
        rec = pg.evaluate("(id) => window.WILSON_PHOTOS.get(id).then(r => r.uploadAttempts)", dead_id)
        ok("retries stop at the limit rather than spinning",
           rec == 3, "%s attempts" % rec)
        result = pg.evaluate("() => window.WILSON_PHOTO_SYNC.drain({force: true})")
        ok("a stuck photo is skipped, not retried", result.get("skipped") == 1, json.dumps(result))
        pg.unroute("**/api/photos")

        # a good photo behind a stuck one still goes up
        good_id = pg.evaluate(STORE_PHOTO, ["behind-the-stuck-one", VISIT])
        result = pg.evaluate("() => window.WILSON_PHOTO_SYNC.drain({force: true})")
        ok("a stuck photo does not block the queue behind it",
           result.get("uploaded") == 1, json.dumps(result))
        ok("and the good one reached the server", good_id in server_ids(cookie))
        ok("while the stuck one is still counted as waiting",
           pg.evaluate("() => window.WILSON_PHOTO_SYNC.pending()") == 1)

        # ---------------------------------------------------------------
        # 4b. The line the technician actually reads
        # ---------------------------------------------------------------
        pg.evaluate("() => window.WILSON_PHOTO_SYNC.refresh()")
        pg.wait_for_selector("#wilson-photo-sync", timeout=4000)
        chip = pg.inner_text("#wilson-photo-sync")
        ok("the status line says how many are still on the phone",
           "1 photograph is on this phone" in chip, chip[:110])
        ok("it does not claim they are anywhere else", "uploaded yet" in chip, chip[:110])
        ok("it offers to try again", pg.locator("#wilson-photo-sync button").count() == 1)
        pos = pg.evaluate("getComputedStyle(document.getElementById('wilson-photo-sync')).position")
        ok("the status line is in the page, not fixed over the Complete button",
           pos != "fixed", pos)
        covered = pg.evaluate("""() => {
          const c = document.getElementById('wilson-photo-sync').getBoundingClientRect();
          const bar = document.querySelector('.tech-bottom-actions');
          if (!bar) return false;
          const b = bar.getBoundingClientRect();
          return !(c.bottom < b.top || c.top > b.bottom);
        }""")
        ok("and does not overlap it", covered is False, str(covered))

        # ---------------------------------------------------------------
        # 5. What the technician is told
        # ---------------------------------------------------------------
        stats = pg.evaluate("() => window.WILSON_PHOTOS.stats()")
        ok("stats separate uploaded from waiting",
           stats.get("uploaded") == 2 and stats.get("pending") == 1, json.dumps(stats))
        ok("and count the stuck one as stuck", stats.get("stuck") == 1, json.dumps(stats))
        ok("no page errors through any of it", not errors, "; ".join(errors[:3]))

        # the sync layer must never claim a sync it did not do
        src = (ROOT / "assets" / "photo-sync.js").read_text(encoding="utf-8")
        code = re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", src)
        ok("nothing in the code says 'synced'", "synced" not in code.lower(), "")
        # Precise on purpose: an earlier version of this check grepped for
        # "remove(" and failed on a DOM node being removed from the status
        # line, which is a test that fails for the wrong reason.
        ok("the local copy is never deleted on upload",
           "WILSON_PHOTOS.remove" not in code and "WILSON_PHOTOS.delete" not in code)

        ctx.close(); browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
    shutil.rmtree(ROOT / "photo-store" / VISIT, ignore_errors=True)

failed = [c for c in CHECKS if not c[0]]
for good, name, detail in CHECKS:
    print(("  ok   " if good else "  FAIL ") + name + (("  -- " + detail) if detail and not good else ""))
print("\n%d checks, %d failed" % (len(CHECKS), len(failed)))
sys.exit(1 if failed else 0)

#!/usr/bin/env python3
"""
End-to-end browser smoke test for the Wilson Maintenance Portal prototype.

docs/QA_SUMMARY_V09.md records that headless browser QA could not be run, so
until now nothing had ever driven this prototype end to end. Unit tests in
_qa/ cover config and pricing arithmetic; they cannot catch a broken template
literal, an unbound event listener, or a global that is undefined at load.

Covers:
  - every page loads with no console errors and the expected globals
  - filter service raises the plan total by the configured price, in the real UI
  - Estate Concierge renders filters as included and charges nothing
  - icemakers are offered water filter service only
  - a washer resolves to the five-check `washer` protocol, not three-check generic
    (the v0.9.1 fix, verified against real seeded data through the field tool)
  - field readiness gating blocks completion until age, serial photo, every
    checkpoint and every required reading are captured
  - completing an inspection generates a health report from field data
  - no horizontal overflow at 390px, and rating buttons clear 44px tap targets

Usage:
    python3 _qa/smoke_browser.py            # starts its own server
    python3 _qa/smoke_browser.py --base http://127.0.0.1:8080   # reuse a server

Skips cleanly (exit 0) when Playwright or a browser binary is unavailable, so
_qa/run_all.sh stays useful on machines without them. Install with:
    pip install playwright && playwright install chromium
"""

import argparse
import asyncio
import os
import re
import socket
import subprocess
import sys
import time
import base64
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHONE = {"width": 390, "height": 844}

# 1x1 PNG, stands in for the required serial-tag photo.
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
)

PAGES = [
    ("/index.html", {"ui"}),
    ("/appliance-signup.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/hvac-signup.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/household.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/admin.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/quote-builder.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/quote-view.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/report-view.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/tech-maintenance.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/confirmation.html", {"cfg", "proto", "filters", "ui", "store"}),
]

failures = []
checks_run = 0


def check(label, got, want):
    global checks_run
    checks_run += 1
    ok = got == want
    if not ok:
        failures.append(f"{label}: got {got!r}, want {want!r}")
    print(f"{'ok  ' if ok else 'FAIL'}  {label:58} {got!r}")
    return ok


def note(label, value):
    print(f"      {label:56} {value}")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    """Serves the package root. serve_portal.py opens a browser and picks its own
    port, so the smoke test uses a plain static server on a known free port."""

    def __init__(self):
        self.port = free_port()
        self.proc = None

    def __enter__(self):
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(self.port), "--bind", "127.0.0.1"],
            cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", self.port), 0.3):
                    return f"http://127.0.0.1:{self.port}"
            except OSError:
                time.sleep(0.15)
        raise RuntimeError("static server did not come up")

    def __exit__(self, *exc):
        if self.proc:
            self.proc.terminate()
            self.proc.wait(timeout=10)


async def money(page, selector):
    text = await page.inner_text(selector)
    return float(re.sub(r"[^0-9.]", "", text.split("/")[0]) or 0)


async def no_overflow(page, label):
    m = await page.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
    over = m[0] - m[1]
    check(f"{label}: no horizontal overflow at {PHONE['width']}px", over <= 1, True)
    if over > 1:
        note("overflow amount", f"{over}px")


async def run(pw, base):
    browser = await pw.chromium.launch()

    # ---- every page loads clean, with the globals its scripts need ----------
    print("\n=== page load and globals ===")
    page = await browser.new_page()
    for path, expected in PAGES:
        errors = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)
        response = await page.goto(base + path, wait_until="networkidle")
        await page.wait_for_timeout(250)
        present = await page.evaluate("""() => {
            const t = {cfg: window.WILSON_CONFIG, proto: window.WILSON_PROTOCOL,
                       filters: window.WILSON_FILTERS, ui: window.WilsonUI,
                       store: window.WilsonStore};
            return Object.keys(t).filter(k => t[k] !== undefined);
        }""")
        ok = check(f"{path} loads {response.status} with globals", set(present) >= expected, True)
        if not ok:
            note("missing globals", expected - set(present))
        if errors:
            failures.append(f"{path} console/page errors: {errors[:3]}")
            note("errors", errors[:3])
        page.remove_listener("pageerror", lambda e: None) if False else None
    await page.close()

    # ---- filter service pricing, in the real enrollment UI -----------------
    print("\n=== filter service pricing (enrollment UI) ===")
    page = await browser.new_page(viewport={"width": 1440, "height": 1200})
    ui_errors = []
    page.on("pageerror", lambda e: ui_errors.append(str(e)))
    page.on("console", lambda m: ui_errors.append(m.text) if m.type == "error" else None)
    await page.goto(base + "/appliance-signup.html", wait_until="networkidle")

    prices = await page.evaluate("""() => {
        const k = window.WILSON_CONFIG.refrigerationFilterService.pricing.kinds;
        return {water: k.water.unitPrice, air: k.air.unitPrice};
    }""")
    note("configured unit prices", prices)

    await page.click('[data-add-category="refrigeration"]')
    await page.wait_for_timeout(200)
    base_total = await money(page, "#summary-total")
    kinds = await page.eval_on_selector_all('[data-filter-service]', "e=>e.map(x=>x.dataset.filterKind)")
    check("refrigeration offers water then air", kinds, ["water", "air"])

    await page.click('[data-filter-kind="water"]')
    await page.wait_for_timeout(200)
    after_water = await money(page, "#summary-total")
    check("water filter service adds its unit price",
          round(after_water - base_total, 2), float(prices["water"]))

    await page.click('[data-filter-kind="air"]')
    await page.wait_for_timeout(200)
    after_air = await money(page, "#summary-total")
    check("air filter service adds its unit price",
          round(after_air - after_water, 2), float(prices["air"]))

    summary = await page.inner_text("#summary-lines")
    check("summary shows a priced amount, never a bare 'Added'",
          "Added" not in summary and "$" in summary, True)
    check("summary flags the pricing as a placeholder",
          "Placeholder" in summary, True)

    await page.click('[data-add-category="ice_maker"]')
    await page.wait_for_timeout(200)
    kinds = await page.eval_on_selector_all('[data-filter-service]', "e=>e.map(x=>x.dataset.filterKind)")
    check("icemaker adds a water toggle only", kinds, ["water", "air", "water"])

    # ---- Estate Concierge includes filters ---------------------------------
    print("\n=== Estate Concierge filter inclusion ===")
    for _ in range(3):
        await page.click('[data-add-category="refrigeration"]')
    for cat in ("range", "dishwasher", "ovens", "washer", "dryer", "ventilation", "microwave"):
        for _ in range(2):
            await page.click(f'[data-add-category="{cat}"]')
    await page.wait_for_timeout(400)
    check("estate tiers offered once eligible",
          await page.locator('[data-estate-plan]').count() > 0, True)
    before_switch = await money(page, "#summary-total")
    await page.click('[data-estate-plan="estate_concierge"]')
    await page.wait_for_timeout(400)

    toggles = await page.eval_on_selector_all(
        '[data-filter-service]', "e=>e.map(x=>({k:x.dataset.filterKind,c:x.checked,d:x.disabled}))")
    check("concierge locks every filter toggle checked",
          all(t["c"] and t["d"] for t in toggles), True)
    summary = await page.inner_text("#summary-lines")
    check("concierge summary marks filters Included", "Included" in summary, True)
    check("concierge charges nothing for filters", await page.evaluate(
        "() => window.WILSON_FILTERS.total("
        "  [{type:'refrigeration',customerCategory:'refrigeration',group:'standard',"
        "    filterServiceOptIn:true,airFilterServiceOptIn:true}], 'estate_concierge')"), 0)
    note("total moving to concierge", f"{before_switch} -> {await money(page, '#summary-total')}")
    if ui_errors:
        failures.append(f"enrollment console errors: {ui_errors[:3]}")
        note("errors", ui_errors[:3])
    await page.close()

    # ---- field tool at phone size ------------------------------------------
    print("\n=== field tool, phone viewport ===")
    ctx = await browser.new_context(viewport=PHONE, is_mobile=True, has_touch=True)
    page = await ctx.new_page()
    field_errors = []
    page.on("pageerror", lambda e: field_errors.append(str(e)))
    page.on("console", lambda m: field_errors.append(m.text) if m.type == "error" else None)

    await page.goto(base + "/tech-maintenance.html", wait_until="networkidle")
    await page.wait_for_timeout(300)
    body = await page.inner_text("body")
    check("field tool refuses to open without a visit id",
          "no maintenance visit" in body.lower() or "not selected" in body.lower(), True)

    await page.goto(base + "/tech-maintenance.html?visit=visit_davenport&household=hh_davenport",
                    wait_until="networkidle")
    await page.wait_for_timeout(400)
    await no_overflow(page, "field asset list")

    assets = await page.evaluate(
        "() => WilsonStore.load().assets.filter(a => a.householdId === 'hh_davenport')")
    washer = next((a for a in assets if a["type"] == "washer"), None)
    check("seeded washer stores the washer protocol, not laundry",
          washer and washer["checkpointSet"], "washer")

    await page.click(f'[data-open-asset="{washer["id"]}"]')
    await page.wait_for_timeout(500)
    headings = await page.eval_on_selector_all(".tech-check-title strong", "e=>e.map(x=>x.innerText)")
    check("washer renders its five purpose-built checkpoints", len(headings), 5)
    note("checkpoints", " / ".join(headings))
    check("washer is not on the three-check generic protocol",
          "Overall condition & operation" not in headings, True)

    sizes = await page.eval_on_selector_all(
        "[data-quick-rate]", "e=>e.map(x=>{const r=x.getBoundingClientRect();return [r.width,r.height]})")
    check("rating buttons present (five per checkpoint)", len(sizes), 5 * len(headings))
    small = [s for s in sizes if s[1] < 44]
    check("every rating button clears the 44px tap target", small, [])
    await no_overflow(page, "field appliance detail")

    # typing must not move the viewport (the v0.8 mobile fix)
    inputs = page.locator(".tech-reading-grid input")
    if await inputs.count():
        el = inputs.first
        await el.click()
        await page.wait_for_timeout(400)
        anchor = await page.evaluate("() => window.scrollY")
        await page.keyboard.type("37", delay=110)
        await page.wait_for_timeout(400)
        moved = abs(await page.evaluate("() => window.scrollY") - anchor)
        check("typing a reading does not move the viewport", moved <= 40, True)
        check("typed reading is retained", await el.input_value(), "37")

    # ---- readiness gating and report generation ----------------------------
    print("\n=== readiness gating and report generation ===")
    fridge = next(a for a in assets if a["type"] == "refrigerator")
    await page.goto(base + "/tech-maintenance.html?visit=visit_davenport&household=hh_davenport",
                    wait_until="networkidle")
    await page.wait_for_timeout(300)
    await page.click(f'[data-open-asset="{fridge["id"]}"]')
    await page.wait_for_timeout(400)

    complete = page.locator('button:has-text("Complete")').first
    check("complete is blocked before any field work", await complete.is_disabled(), True)

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as fh:
        fh.write(TINY_PNG)
        serial_path = fh.name
    try:
        age = page.locator("#tech-age, [data-age]").first
        if await age.count():
            await age.fill("6")
        await page.set_input_files("#serial-photo", serial_path)
        await page.wait_for_timeout(300)
        check("still blocked with serial photo but no checks",
              await complete.is_disabled(), True)

        count = await page.locator("[data-performed]").count()
        for i in range(count):
            box = page.locator(f'[data-performed="{i}"]')
            if not await box.is_checked():
                await box.check()
            await page.wait_for_timeout(80)
            await page.click(f'[data-quick-rate="{i}:4"]')
            await page.wait_for_timeout(80)
        readings = page.locator(".tech-reading-grid input")
        for i in range(await readings.count()):
            el = readings.nth(i)
            if await el.get_attribute("type") == "file" or await el.input_value():
                continue
            await el.fill("37" if await el.get_attribute("type") == "number" else "OK")
        await page.wait_for_timeout(700)

        readiness = await page.inner_text("#tech-readiness")
        check("readiness reports ready once everything is captured",
              "ready to complete" in readiness.lower(), True)
        check("complete is enabled once ready", await complete.is_disabled(), False)

        await complete.click()
        await page.wait_for_timeout(1000)
        stored = await page.evaluate(f"""() => {{
            const s = WilsonStore.load();
            const insp = (s.techInspections || []).filter(i => i.assetId === '{fridge["id"]}');
            const reps = (s.reports || []).filter(r => r.assetId === '{fridge["id"]}');
            return {{
              complete: insp.length ? insp[0].complete : null,
              score: insp.length ? (insp[0].finalScore ?? insp[0].score ?? null) : null,
              reportId: reps.length ? reps[0].id : null,
              reportSource: reps.length ? reps[0].source : null,
            }};
        }}""")
        check("inspection stored as complete", stored["complete"], True)
        check("inspection carries a health score in range",
              isinstance(stored["score"], (int, float)) and 0 <= stored["score"] <= 100, True)
        note("score", stored["score"])
        check("a health report was generated", bool(stored["reportId"]), True)
        check("the report is sourced from field data", stored["reportSource"], "Field technician")

        if stored["reportId"]:
            rp = await ctx.new_page()
            r = await rp.goto(f"{base}/report-view.html?report={stored['reportId']}",
                              wait_until="networkidle")
            await rp.wait_for_timeout(500)
            text = await rp.inner_text("body")
            check("report renders", r.status == 200 and len(text) > 1500, True)
            check("report carries the locked Wilson Estate Care styling",
                  "WILSON ESTATE CARE" in text.upper(), True)
            await no_overflow(rp, "customer report")
            await rp.close()
    finally:
        os.unlink(serial_path)

    if field_errors:
        failures.append(f"field tool console errors: {field_errors[:3]}")
        note("errors", field_errors[:3])

    await ctx.close()
    await browser.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", help="reuse a server already running here")
    args = parser.parse_args()

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("SKIP: playwright is not installed "
              "(pip install playwright && playwright install chromium)")
        return 0

    async def go(base):
        async with async_playwright() as pw:
            try:
                await run(pw, base)
            except Exception as exc:  # noqa: BLE001
                if "Executable doesn't exist" in str(exc):
                    print("SKIP: no Chromium binary (playwright install chromium)")
                    return "skip"
                raise
        return None

    if args.base:
        outcome = asyncio.run(go(args.base.rstrip("/")))
    else:
        with Server() as base:
            outcome = asyncio.run(go(base))

    if outcome == "skip":
        return 0

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S) of {checks_run} checks:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"ALL {checks_run} BROWSER CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())

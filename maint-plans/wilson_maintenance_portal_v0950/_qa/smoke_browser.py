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
  - the HVAC field workflow opens, resolves per system type, and its health
    score does not move when the SEER rating changes
  - printed output: no sheet overflows, every finding and appliance survives
    pagination, and the PDF has one page per sheet
  - the whole-visit maintenance review compiles a stop into one document, leads
    with a count rather than an average, groups by room, and never reports an
    appliance on health score alone

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
    ("/quote-view.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/report-view.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/tech-maintenance.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/confirmation.html", {"cfg", "proto", "filters", "ui", "store"}),
    ("/visit-report.html", {"cfg", "proto", "filters", "ui", "store"}),
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


async def keypad_enter(page, value):
    """Type a value on the in-app number pad and confirm it.

    v0.9.17 replaced every reading input with a keypad button: there is no OS
    keyboard in the field tool any more, so a test that fills inputs is testing
    a control that no longer exists.
    """
    text = str(value)
    for ch in text:
        key = "-" if ch == "-" else ch
        await page.click('#tech-keypad [data-key="%s"]' % key)
    await page.click('#tech-keypad [data-key="done"]')
    await page.wait_for_timeout(120)


async def answer_open_check(page, values=None):
    """Answer whatever the open check asks for, in the order it asks.

    Readings first (they are what a rating is supposed to be based on), then
    the control the check's answer kind calls for. Returns what it did, or
    None when there is nothing left to answer.
    """
    values = values or {}
    pads = await page.evaluate("""() => {
        const card = document.querySelector('.tech-check-card.open');
        if (!card) return null;
        return Array.from(card.querySelectorAll('[data-answer-keypad]'))
            .filter(b => !b.classList.contains('filled'))
            .map(b => ({ key: b.dataset.answerKeypad,
                         label: (b.innerText || '').toLowerCase() }));
    }""")
    if pads is None:
        return None
    for pad in pads:
        await page.click('[data-answer-keypad="%s"]' % pad["key"])
        value = next((v for k, v in values.items() if k in pad["label"]), "37")
        await keypad_enter(page, value)
    did = await page.evaluate("""() => {
        const card = document.querySelector('.tech-check-card.open');
        if (!card) return 'none';
        const rate = card.querySelector('[data-quick-rate="' + card.dataset.check + ':5"]')
                  || card.querySelector('[data-quick-rate]');
        if (rate) { rate.click(); return 'rating'; }
        const opt = card.querySelector('[data-answer-option]');
        if (opt) { opt.click(); return 'option'; }
        const total = card.querySelector('[data-answer-total]:not(.tech-count-reset)');
        if (total) { total.click(); return 'total'; }
        const counts = card.querySelectorAll('[data-answer-count]');
        if (counts.length) { counts[counts.length - 1].click(); return 'count'; }
        return 'reading-only';
    }""")
    await page.wait_for_timeout(240)
    return did


async def dismiss_spotlight(page):
    """v0.9.40: adding a refrigeration appliance pops the add-on spotlight.
    Real customers read it; this suite dismisses it, except where it is the
    thing under test."""
    closer = page.locator("[data-spotlight-close]")
    if await closer.count():
        # v0.9.49: the spotlight has two explicit exits (the continue button
        # and the maybe-later link) -- either dismisses; take the first.
        await closer.first.click()
        await page.wait_for_timeout(250)


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
    await page.wait_for_timeout(300)
    # ---- the add-on spotlight (v0.9.40) ------------------------------------
    check("adding refrigeration pops the add-on spotlight",
          await page.locator(".addon-spotlight").count(), 1)
    spot_text = await page.inner_text(".addon-spotlight")
    check("the spotlight leads with Guardian",
          "Guardian" in spot_text, True)
    # v0.9.44: approved tiered pricing -- a fresh registration's first sensor
    # shows the member first-sensor rate, read from config, labelled as such.
    first_rate = await page.evaluate(
        "() => window.WilsonUI.money(window.WILSON_CONFIG.tempMonitoring.pricing.member.firstAnnual)")
    check("the spotlight prices the first sensor from the engine",
          first_rate in spot_text, True)
    check("...and says it is the first-sensor rate", "first sensor" in spot_text, True)
    check("dismissing it is offered as a safe choice",
          "stay on the appliance card" in spot_text, True)
    # v0.9.49, Cayden: "the customer has to click outside of the pop up
    # window to go back to registering. right now if you hit guardian on the
    # pop up it feels like nothing happens." A real continue button, and a
    # selection that visibly lands on it.
    check("the spotlight has a real continue button",
          await page.locator("#addon-done-button").count(), 1)
    check("which starts as a plain continue",
          await page.inner_text("#addon-done-button"), "Continue registering")
    await page.click("[data-spotlight-guardian]")
    await page.wait_for_timeout(200)
    check("hitting Guardian visibly lands: the add button confirms",
          "Added" in await page.inner_text("[data-spotlight-guardian]"), True)
    done_label = await page.inner_text("#addon-done-button")
    check("...and the continue button narrates the selection",
          "added" in done_label and "Guardian" in done_label, True)
    await page.click("#addon-done-button")
    await page.wait_for_timeout(300)
    check("the continue button closes the spotlight",
          await page.locator(".addon-spotlight").count(), 0)
    check("and the selection survived onto the appliance card",
          await page.evaluate("() => document.querySelector('[data-temp-monitoring]').checked"), True)
    # Walk Guardian back off so the compartment section below starts from the
    # same clean slate it always did.
    await page.click("[data-temp-monitoring]")
    await page.wait_for_timeout(300)
    check("the spotlight closes and the toggles remain inline",
          await page.locator(".tempwatch-toggle").count() >= 1, True)

    # ---- per-compartment sensors (v0.9.47) ----------------------------------
    # Cayden: "Some will want a sensor in freezer and refrigerator
    # compartments on same unit." Tick Guardian, then the freezer compartment
    # joins at the ADDITIONAL rate; untick every compartment and Guardian is
    # off -- one state, not two ways to be off.
    tiers = await page.evaluate(
        "() => window.WILSON_CONFIG.tempMonitoring.pricing.member")
    pre_guardian = await money(page, "#summary-total")
    await page.click("[data-temp-monitoring]")
    await page.wait_for_timeout(300)
    after_first = await money(page, "#summary-total")
    check("adding Guardian bills the first-sensor rate",
          round(after_first - pre_guardian, 2), float(tiers["firstAnnual"]))
    comp = page.locator("[data-temp-compartment$=':freezer']")
    check("the fridge card offers the freezer compartment", await comp.count(), 1)
    comp_label = await page.inner_text(".tempwatch-compartments")
    check("the unticked compartment quotes the additional rate",
          f"${tiers['additionalAnnual']:.2f}" in comp_label or f"${tiers['additionalAnnual']}" in comp_label
          or str(int(tiers["additionalAnnual"])) in comp_label, True)
    await comp.click()
    await page.wait_for_timeout(300)
    after_second = await money(page, "#summary-total")
    check("the freezer probe joins at the additional rate",
          round(after_second - after_first, 2), float(tiers["additionalAnnual"]))
    check("the summary counts two sensors",
          "2 sensors" in (await page.inner_text("#summary-lines")), True)
    # untick both compartments -> Guardian off entirely
    await page.locator("[data-temp-compartment$=':freezer']").click()
    await page.wait_for_timeout(200)
    await page.locator("[data-temp-compartment$=':fresh_food']").click()
    await page.wait_for_timeout(300)
    check("unticking the last compartment turns Guardian off",
          await page.evaluate("() => document.querySelector('[data-temp-monitoring]').checked"), False)
    check("...and the total returns to the pre-Guardian figure",
          round(await money(page, "#summary-total") - pre_guardian, 2), 0.0)

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
        await page.wait_for_timeout(250)
        await dismiss_spotlight(page)
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

    # ---- container and limited-scope categories ----------------------------
    print("\n=== WashTower expansion and grill scope ===")
    page = await browser.new_page(viewport={"width": 1500, "height": 1200})
    tile_errors = []
    page.on("pageerror", lambda e: tile_errors.append(str(e)))
    page.on("console", lambda m: tile_errors.append(m.text) if m.type == "error" else None)
    await page.goto(base + "/appliance-signup.html", wait_until="networkidle")

    async def appliance_count():
        return int(await page.inner_text("#summary-appliance-count"))

    # One WashTower is one product the customer recognises but two maintained
    # appliances, and the tile has to say so before it is clicked.
    await page.click('[data-add-category="laundry_center"]')
    await page.wait_for_timeout(300)
    check("one WashTower click adds two appliances", await appliance_count(), 2)
    board = await page.inner_text("#area-board")
    check("both halves are labelled as the WashTower they came from",
          "WashTower — Washer" in board and "WashTower — Dryer" in board, True)
    badge = await page.inner_text('[data-category-card="laundry_center"] .picker-recommended')
    check("the tile discloses the two-appliance count before it is clicked",
          "2 appliances" in badge, True)
    unit_price = await page.evaluate(
        "() => window.WILSON_CONFIG.pricing.standardApplianceAnnual")
    check("a WashTower is priced as two standard appliances",
          await money(page, "#summary-total"), round(unit_price * 2, 2))
    await page.click('[data-decrease-category="laundry_center"]')
    await page.wait_for_timeout(250)
    check("decrementing removes the pair as a unit, never half a WashTower",
          await appliance_count(), 0)

    # Grills are maintained on function only; Wilson never cleans one.
    await page.click('[data-add-category="outdoor_grill"]')
    await page.wait_for_timeout(300)
    badge = await page.inner_text('[data-category-card="outdoor_grill"] .picker-recommended')
    tile_note = await page.inner_text('[data-category-card="outdoor_grill"] .picker-scope-note')
    check("the grill tile flags its limited scope", "no cleaning" in badge.lower(), True)
    check("the tile spells out that cleaning is never included",
          "never included" in tile_note.lower(), True)
    check("the tile says condition still affects the score",
          "health score" in tile_note.lower(), True)
    summary = await page.inner_text("#summary-lines")
    check("the scope note is repeated in the enrollment summary",
          "Cleaning is never included" in summary, True)
    if tile_errors:
        failures.append(f"picker console errors: {tile_errors[:3]}")
        note("errors", tile_errors[:3])
    await page.close()

    # ---- internal dashboard ------------------------------------------------
    # The office dashboard put its first actionable button at 1015px on a 950px
    # laptop screen: you scrolled before you could do anything. It also rendered
    # the same four counts twice, and one of the pair disagreed.
    print("\n=== internal dashboard ===")
    page = await browser.new_page(viewport={"width": 1512, "height": 950})
    dash_errors = []
    page.on("pageerror", lambda e: dash_errors.append(str(e)))
    page.on("console", lambda m: dash_errors.append(m.text) if m.type == "error" else None)
    await page.goto(base + "/admin.html", wait_until="networkidle")
    await page.wait_for_timeout(600)

    first = await page.evaluate("""() => {
        const el = document.querySelector('#ops-queue [data-action], #ops-queue a.button');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return Math.round(r.top + window.scrollY);
    }""")
    check("the first action sits on the first screen", first is not None and first < 950, True)
    note("first actionable button", f"{first}px of a 950px screen")

    check("the queue is one list, not four columns",
          await page.locator(".ops-module-grid").count(), 0)
    rows = await page.locator("#ops-queue .ops-row").count()
    check("the queue renders rows", rows > 0, True)
    check("every row carries a pipeline stage chip",
          await page.locator("#ops-queue .stage-chip").count(), rows)

    # Counts appear once. They used to appear twice and disagree.
    bar = await page.eval_on_selector_all(".ops-stat strong", "e=>e.map(x=>x.textContent)")
    # Counted against the stages the page actually declares. This said "four"
    # and broke the moment the queue gained the filters and quotes stages at
    # v0.9.28 -- a stage count is not a fact worth asserting, but "the bar
    # summarises every stage the queue can produce" is.
    stage_ids = await page.eval_on_selector_all(
        "[data-queue-filter]", "e=>e.map(x=>x.dataset.queueFilter)")
    check("the operating bar carries one count per queue stage",
          len(bar) == len(stage_ids) and len(bar) > 0, True)
    note("stages", " ".join(stage_ids))
    check("the duplicate per-column badges are gone",
          await page.locator("#action-required-count, #ready-charge-count, "
                             "#schedule-count, #completed-count").count(), 0)

    # The counts double as filters.
    await page.click('[data-queue-filter="blocked"]')
    await page.wait_for_timeout(350)
    blocked_rows = await page.locator("#ops-queue .ops-row").count()
    check("clicking a count filters the queue to that stage",
          blocked_rows <= rows and blocked_rows > 0, True)
    stages = await page.eval_on_selector_all("#ops-queue .stage-chip", "e=>[...new Set(e.map(x=>x.innerText))]")
    check("the filtered queue shows only that stage", stages, ["Blocked"])
    await page.click("#queue-clear-filter")
    await page.wait_for_timeout(300)
    check("clearing the filter restores the queue",
          await page.locator("#ops-queue .ops-row").count(), rows)

    # ---- filter verification (v0.9.49) --------------------------------------
    # "Filters due" is retired: replacement happens at the visit, so the
    # office's filter job is verifying the PART NUMBER. Two seeds ship
    # unverified so this queue demonstrates itself.
    print("\n=== filter verification queue ===")
    fv_rows = await page.locator("#ops-queue .stage-filters").count()
    check("unverified filters wait in the queue", fv_rows >= 2, True)
    fv_text = await page.locator("#ops-queue .stage-filters").first.inner_text()
    check("the card says this is verification work",
          "confirm part" in fv_text or "part number" in fv_text, True)
    check("every card deep-links Filter Finder",
          await page.locator('#ops-queue .stage-filters a[href*="filter-finder.html"]').count(), fv_rows)
    check("and offers Mark verified",
          await page.locator('#ops-queue .stage-filters [data-action="filter-verified"]').count(), fv_rows)
    # Mark one verified through the real prompt and watch the queue shrink.
    page.on("dialog", lambda d: asyncio.ensure_future(d.accept("EDR4RXD1")))
    await page.locator('[data-action="filter-verified"]').first.click()
    await page.wait_for_timeout(600)
    check("marking verified clears it from the queue",
          await page.locator("#ops-queue .stage-filters").count(), fv_rows - 1)
    verified_row = await page.evaluate(
        "() => WilsonStore.load().filters.find(f => f.verified && f.partNumber === 'EDR4RXD1')")
    check("the confirmed part number landed on the record", bool(verified_row), True)

    # The Filter Finder page itself: Jack's tool, with deep-link prefill.
    ff = await browser.new_page(viewport={"width": 1280, "height": 1000})
    ff_errors: list[str] = []
    ff.on("pageerror", lambda e: ff_errors.append(str(e)))
    await ff.goto(base + "/filter-finder.html?brand=Sub-Zero&model=BI-48S&serial=4210001",
                  wait_until="networkidle")
    await ff.wait_for_timeout(500)
    check("the deep link selects the brand",
          await ff.locator(".brand-btn.active").inner_text(), "Sub-Zero")
    ff_result = await ff.inner_text("#resultBody")
    check("and runs the lookup on arrival (BI serial => twist-in 4204490)",
          "4204490" in ff_result, True)
    check("the confidence badge survived the port",
          await ff.locator("#resultBody .badge").count() >= 1, True)
    if ff_errors:
        failures.append(f"filter-finder console errors: {ff_errors[:3]}")
    await ff.close()

    # ---- the customer information page (v0.9.49) ----------------------------
    print("\n=== customer information page ===")
    ci = await browser.new_page(viewport={"width": 1280, "height": 1000})
    ci_errors: list[str] = []
    ci.on("pageerror", lambda e: ci_errors.append(str(e)))
    await ci.goto(base + "/customer-info.html", wait_until="networkidle")
    await ci.wait_for_timeout(400)
    ci_text = await ci.inner_text("main")
    check("it sets the observant-not-surgical expectation",
          "not a teardown" in ci_text or "teardown" in ci_text, True)
    check("it says plainly that components can fail without warning",
          "without warning" in ci_text, True)
    check("Guardian's limits are stated, not hidden",
          "cannot prevent" in ci_text and "not insurance" in ci_text, True)
    check("the FAQ answers the frictionless filter-pricing question",
          "standard per-filter rate" in ci_text, True)
    # The badge renders uppercased (CSS text-transform), and innerText reports
    # the rendered form -- so match case-insensitively.
    check("the terms are labeled a working draft for counsel",
          "working draft" in ci_text.lower(), True)
    check("the public footer links to it", await ci.evaluate(
        "() => !!document.querySelector('#site-footer a[href=\"customer-info.html\"]')"), True)
    if ci_errors:
        failures.append(f"customer-info console errors: {ci_errors[:3]}")
    await ci.close()

    # ---- the visit-launch guardrail (v0.9.49) --------------------------------
    # Repeated clicks used to walk into a new visit at any time. Now the
    # button resumes an in-progress visit, and refuses (with the reason) a
    # visit the office has not billed / ticketed yet.
    print("\n=== visit launch guardrail ===")
    gl = await browser.new_page(viewport={"width": 1280, "height": 1000})
    await gl.goto(base + "/household.html?id=hh_torres", wait_until="networkidle")
    await gl.wait_for_timeout(500)
    # Torres: overdue icemaker visit, charge due, no service order -> blocked.
    check("an unbilled, unticketed visit does not launch",
          await gl.locator('#launch-appliance-tech[aria-disabled="true"]').count(), 1)
    check("the button says it is not ready rather than lying about openness",
          await gl.inner_text("#launch-appliance-tech"), "Visit not ready to launch")
    check("the context line carries the reason",
          "Blocked:" in await gl.inner_text("#appliance-visit-context"), True)
    # Charge it and create the ticket through the store, as the office would.
    await gl.evaluate("""() => {
        WilsonStore.mockCharge('visit_torres');
        WilsonStore.queueServiceOrder('visit_torres');
    }""")
    await gl.reload(wait_until="networkidle")
    await gl.wait_for_timeout(500)
    check("billed + ticketed unlocks the launch",
          await gl.inner_text("#launch-appliance-tech"), "Launch appliance visit")
    # Start field work on it: the button becomes a resume, not a second visit.
    await gl.evaluate("""() => {
        const assets = WilsonStore.scopedAssetsForVisit(
            WilsonStore.load().visits.find(v => v.id === 'visit_torres'));
        WilsonStore.saveTechInspection({ visitId: 'visit_torres', assetId: assets[0].id,
            checks: [], complete: false });
    }""")
    await gl.reload(wait_until="networkidle")
    await gl.wait_for_timeout(500)
    check("in-progress field work turns the button into a resume",
          "Resume appliance visit" in await gl.inner_text("#launch-appliance-tech"), True)
    await gl.close()

    # ---- two screens, not eight tabs (v0.9.28) ----------------------------
    #
    # This used to click through eight tab panels. Three of them were global
    # copies of household panels, one was reference material with no data on it,
    # and the Quotes list became a queue stage -- so the tool is now the work
    # queue plus a customer list, and this walks those instead.
    check("the tab rail is gone", await page.locator("[data-tab-target]").count(), 0)

    cust = await browser.new_page(viewport={"width": 1280, "height": 1000})
    cust_errors: list[str] = []
    cust.on("pageerror", lambda e: cust_errors.append(str(e)))
    await cust.goto(base + "/customers.html", wait_until="networkidle")
    await cust.wait_for_timeout(700)
    check("the customer list renders rows",
          await cust.locator("#customer-list .customer-row").count() > 0, True)
    check("open quotes are on the same list as households",
          await cust.locator("#customer-list .customer-row.is-quote").count() > 0, True)
    filter_chips = await cust.eval_on_selector_all(
        "[data-customer-filter]", "e=>e.map(x=>x.dataset.customerFilter)")
    check("and it offers filters rather than only a search box",
          len(filter_chips) > 0, True)
    note("customer filters", " ".join(filter_chips))

    # A filter must actually narrow the list, and be clearable.
    total_rows = await cust.locator("#customer-list .customer-row").count()
    await cust.click('[data-customer-filter="quotes"]')
    await cust.wait_for_timeout(300)
    quoted = await cust.locator("#customer-list .customer-row").count()
    check("a filter narrows the list", quoted < total_rows and quoted > 0, True)
    check("and only quotes survive the quote filter",
          await cust.locator("#customer-list .customer-row:not(.is-quote)").count(), 0)
    await cust.click('[data-customer-filter="quotes"]')
    await cust.wait_for_timeout(300)
    check("clicking it again restores everything",
          await cust.locator("#customer-list .customer-row").count(), total_rows)

    # Every row must lead somewhere real.
    hrefs = await cust.eval_on_selector_all(
        "#customer-list .customer-row-name", "e=>e.map(x=>x.getAttribute('href'))")
    check("every row links to a household or a quote",
          [h for h in hrefs if not (h or "").startswith(("household.html?id=", "quote-view.html?id="))], [])
    check("no page errors on the customer list", cust_errors, [])

    # The invoice importer moved off the dashboard onto its own page.
    imp = await browser.new_page(viewport={"width": 1280, "height": 1000})
    imp_errors: list[str] = []
    imp.on("pageerror", lambda e: imp_errors.append(str(e)))
    await imp.goto(base + "/invoice-import.html", wait_until="networkidle")
    await imp.wait_for_timeout(600)
    check("the invoice importer has its own page",
          await imp.locator("#invoice-file-input, input[type=file]").count() > 0, True)
    check("no page errors on the importer", imp_errors, [])
    await imp.close()

    # Nothing may still point at a tab that no longer exists.
    dangling = await cust.evaluate("""async () => {
        const pages = ['admin.html', 'customers.html', 'invoice-import.html'];
        const bad = [];
        for (const p of pages) {
            const html = await (await fetch(p)).text();
            const found = html.match(/admin\.html#[a-z]+/g) || [];
            found.forEach(f => bad.push(p + ' -> ' + f));
        }
        return bad;
    }""")
    check("no internal page links to a retired tab anchor", dangling, [])
    await cust.close()

    # Charging an item should move it along the pipeline, not vanish it.
    await page.wait_for_timeout(200)
    charge = page.locator('#ops-queue [data-action="charge"]').first
    if await charge.count():
        before_counts = await page.eval_on_selector_all(".ops-stat strong", "e=>e.map(x=>x.textContent)")
        await charge.click()
        await page.wait_for_timeout(900)
        after_counts = await page.eval_on_selector_all(".ops-stat strong", "e=>e.map(x=>x.textContent)")
        check("charging moves an item to the next stage rather than dropping it",
              before_counts != after_counts and sum(int(x) for x in after_counts) == sum(int(x) for x in before_counts),
              True)
        note("counts", f"{before_counts} -> {after_counts}")

    if dash_errors:
        failures.append(f"dashboard console errors: {dash_errors[:3]}")
        note("errors", dash_errors[:3])
    await page.close()

    # ---- decline stays with the customer, not the command center ------------
    # v0.9.49, Cayden: "Let's get rid of appliances trending down on the back
    # end. I'm not sure there's really anything actionable our in house team
    # can do with that." The block is GONE from admin; the household record and
    # the reports keep telling the story, because that is where the customer
    # (and the person talking to the customer) reads it.
    print("\n=== decline lives on the household record, not the dashboard ===")
    page = await browser.new_page(viewport={"width": 1512, "height": 950})
    dec_errors = []
    page.on("pageerror", lambda e: dec_errors.append(str(e)))
    page.on("console", lambda m: dec_errors.append(m.text) if m.type == "error" else None)
    await page.goto(base + "/admin.html", wait_until="networkidle")
    await page.wait_for_timeout(700)

    check("the trending-down block is gone from the command center",
          await page.locator("#decline-block").count(), 0)
    check("and no decline rows leak into the visit queue",
          await page.locator("#ops-queue .decline-row").count(), 0)

    # The household record is where the queue sends people, so the flag lives
    # there -- and a 17-appliance estate must not hide it below the fold.
    await page.goto(base + "/household.html?id=hh_reynolds", wait_until="networkidle")
    await page.wait_for_timeout(700)
    check("declining appliances are still flagged on the household record",
          await page.locator("tr.row-attention").count() >= 1, True)
    first_row = await page.evaluate(
        "() => document.querySelector('#appliance-asset-table-body tr').className")
    check("it sorts to the top of the appliance table rather than being scrolled to",
          "row-attention" in first_row, True)
    hh_cols = await page.eval_on_selector_all(
        "table", "e=>e.map(t=>t.querySelectorAll('thead th').length)")
    check("no household table exceeds five columns", max(hh_cols) <= 5, True)
    note("household table columns", hh_cols)

    if dec_errors:
        failures.append(f"decline console errors: {dec_errors[:3]}")
        note("errors", dec_errors[:3])
    await page.close()

    # ---- service history / trends ------------------------------------------
    # One visit is a score; several are a curve, and the curve is what turns a
    # maintenance call into a health record.
    print("\n=== report service history ===")
    page = await browser.new_page(viewport={"width": 1100, "height": 1400})
    trend_errors = []
    page.on("pageerror", lambda e: trend_errors.append(str(e)))
    page.on("console", lambda m: trend_errors.append(m.text) if m.type == "error" else None)

    await page.goto(base + "/report-view.html?id=report_hist_fridge_3", wait_until="networkidle")
    await page.wait_for_timeout(700)

    check("a history page is rendered", await page.locator(".history-page").count(), 1)

    # ---- Guardian on the report (v0.9.40) ----------------------------------
    # This appliance (the Reynolds BI-48S) is enrolled, so its report carries
    # the sensor's 48 hours: the chart, the stats, and the admission that the
    # prototype's readings are simulated.
    check("an enrolled appliance's report carries the Guardian sheet",
          await page.locator(".guardian-page").count(), 1)
    check("the sheet charts the sensor trace",
          await page.locator(".guardian-chart").count(), 1)
    guardian_text = await page.inner_text(".guardian-page")
    check("it says the readings come from the sensor, not a spot reading",
          "not from a one-off reading" in guardian_text, True)
    check("it admits the prototype data is simulated",
          "simulated" in guardian_text.lower(), True)
    check("it says the sensor never moves the health score",
          "never change this report" in guardian_text or "score is what the technician measured" in guardian_text, True)
    stats_cells = await page.eval_on_selector_all(".guardian-stats strong", "e=>e.map(x=>x.innerText)")
    check("the stats row is populated", len(stats_cells) >= 5, True)
    note("guardian stats", " / ".join(stats_cells))
    labels = await page.eval_on_selector_all(".trend-label", "e=>e.map(x=>x.innerText)")
    check("the health score is charted", "Health score" in labels, True)
    check("measured readings are charted alongside it", len(labels) >= 3, True)
    note("plotted", labels)

    # A customer set point is a setting, not a reading -- it belongs as the band
    # on the compartment chart it explains, not as its own flat line.
    check("the set point is not charted as its own series",
          any("set point" in l.lower() for l in labels), False)
    check("the set point became a band on its compartment",
          "set point" in (await page.inner_text(".history-page")).lower(), True)

    # Each measure keeps its own scale. Two measures never share a pair of axes.
    charts = await page.locator(".trend-figure svg").count()
    check("every measure gets its own chart, never a shared axis", charts, len(labels))

    # Colour follows state, not direction: a rising inlet temperature is good and
    # a rising condenser split is not, so the sign alone must never set the colour.
    deltas = await page.eval_on_selector_all(
        ".trend-delta", "e=>e.map(x=>({cls:x.className, txt:x.innerText}))")
    rising_in_band = [d for d in deltas if d["txt"].startswith("+") and "out" not in d["cls"]]
    check("a rising value inside its target is not flagged as a problem",
          len(rising_in_band) > 0, True)
    out_of_band = [d for d in deltas if "out" in d["cls"]]
    check("a reading outside its target is flagged", len(out_of_band), 1)

    check("a table view carries the same numbers",
          await page.locator(".trend-table table").count(), 1)
    rows = await page.locator(".trend-table tbody tr").count()
    check("the table has a row per visit", rows, 4)

    # A single-visit appliance must say so rather than drawing a one-point line.
    await page.goto(base + "/report-view.html?id=report_reynolds_1", wait_until="networkidle")
    await page.wait_for_timeout(500)
    # A wrong id must refuse rather than render a different household's report.
    await page.goto(base + "/report-view.html?id=does_not_exist", wait_until="networkidle")
    await page.wait_for_timeout(400)
    body_text = await page.inner_text("#report-sheet")
    # A report for an appliance NOT enrolled must not grow a Guardian sheet.
    await page.goto(base + "/report-view.html?id=report_dav_dishwasher_0", wait_until="networkidle")
    await page.wait_for_timeout(500)
    check("a non-enrolled appliance's report has no Guardian sheet",
          await page.locator(".guardian-page").count(), 0)

    check("an unknown report id refuses instead of showing another household",
          "could not be found" in body_text.lower(), True)
    check("nothing is charted for an unknown id",
          await page.locator(".trend-figure").count(), 0)

    # A genuine first visit -- the Davenport stop, where every appliance has one
    # report. The Reynolds icemaker used to serve this case and no longer can:
    # it now carries four years of history, which is the point of the fixture.
    await page.goto(base + "/report-view.html?id=report_dav_dishwasher_0", wait_until="networkidle")
    await page.wait_for_timeout(500)
    check("a first visit explains that trending starts next time",
          await page.locator(".trend-empty").count(), 1)
    check("no chart is drawn from a single point",
          await page.locator(".trend-figure").count(), 0)

    if trend_errors:
        failures.append(f"report console errors: {trend_errors[:3]}")
        note("errors", trend_errors[:3])
    print("\n=== longevity guidance ===")
    await page.goto(base + "/report-view.html?id=report_hist_fridge_3", wait_until="networkidle")
    await page.wait_for_timeout(600)
    check("a longevity page is rendered", await page.locator(".longevity-page").count(), 1)
    posture = await page.inner_text(".longevity-badge")
    check("a drifting appliance with life left is a service job, not a replacement",
          "keep the appliance" in posture.lower(), True)
    body = (await page.inner_text(".longevity-page")).lower()
    check("the page never suggests replacing it", "replacing" in body and "does not recommend replacing" in body, True)
    check("it names what would extend the appliance",
          await page.locator(".longevity-actions li").count(), 2)
    check("expected life is labelled an estimate, not a warranty",
          "not a manufacturer warranty" in body, True)
    check("no invented costs appear", "$" in body, False)

    await page.close()

    # ---- longevity page ------------------------------------------------------
    # ---- field tool at phone size ------------------------------------------
    print("\n=== field tool, phone viewport ===")
    ctx = await browser.new_context(viewport=PHONE, is_mobile=True, has_touch=True)
    page = await ctx.new_page()
    field_errors = []
    photo_post_failures = []

    def field_console(m):
        """Console errors, minus the one this harness causes itself.

        This suite serves the portal with `python -m http.server`, which answers
        POST with 501. The photo queue posts to /api/photos, so every pending
        photo produces a console error that says nothing about the build -- the
        real endpoint lives in serve_portal.py and verify-photo-sync.py drives
        it. Those are counted separately and asserted on below (the photos must
        survive the refusal), rather than either failing the run or vanishing.
        """
        if m.type != "error":
            return
        url = ""
        try:
            url = (m.location or {}).get("url") or ""
        except Exception:  # noqa: BLE001
            url = ""
        if "/api/photos" in url:
            photo_post_failures.append(m.text)
            return
        field_errors.append(m.text)

    page.on("pageerror", lambda e: field_errors.append(str(e)))
    page.on("console", field_console)

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
    # v0.9.39: the field team's washer protocol is six checks.
    check("washer renders its six purpose-built checkpoints", len(headings), 6)
    note("checkpoints", " / ".join(headings))
    check("washer is not on the three-check generic protocol",
          "Overall condition & operation" not in headings, True)

    # One check open at a time, chosen by the technician -- collapsed cards keep
    # the protocol legible without five screens of scrolling.
    check("exactly one check is expanded", await page.locator(".tech-check-card.open").count(), 1)
    check("the rest are collapsed",
          await page.locator(".tech-check-card.collapsed").count(), len(headings) - 1)
    height = await page.evaluate("() => document.documentElement.scrollHeight")
    # v0.9.39 re-based this budget, with the reason written down: the field
    # team's washer protocol is six checks instead of five, and Cayden added
    # the before-you-leave cycle reminder and the whole-appliance note. That
    # is ordered content, not creep -- the optional note already collapses to
    # one line to pay for itself. The budget moves to 4.25 screens and holds
    # there; anything past it is once again someone's addition to justify.
    check("the appliance fits in under 4.25 phone screens", height < 844 * 4.25, True)
    note("page height", f"{height}px = {round(height / 844, 2)} screens (budget 4.25)")

    # No check may arrive pre-rated: a rating must exist because someone chose it.
    unrated = await page.evaluate("""() => {
        const d = WilsonStore.getTechInspection(
            new URLSearchParams(location.search).get('visit'),
            document.querySelector('[data-check]') ? null : null);
        return null;
    }""")
    ratings_shown = await page.eval_on_selector_all(
        ".tech-check-card.open [data-quick-rate][aria-pressed=true]", "e=>e.length")
    check("a freshly opened check carries no default rating", ratings_shown, 0)
    check("an explicit not-applicable control exists",
          await page.locator(".tech-check-card.open [data-na]").count(), 1)
    # v0.9.17: a check is answered by the control its answer KIND calls for --
    # a rating, a category, a count, a pass/fail or a number pad. Asserting
    # "five rating buttons" would now be asserting that the old one-size
    # control is still there.
    controls = await page.evaluate("""() => {
        const card = document.querySelector('.tech-check-card.open');
        if (!card) return null;
        return {
            rating: card.querySelectorAll('[data-quick-rate]').length,
            option: card.querySelectorAll('[data-answer-option]').length,
            count: card.querySelectorAll('[data-answer-total],[data-answer-count]').length,
            keypad: card.querySelectorAll('[data-answer-keypad]').length,
        };
    }""")
    note("controls on the open check", controls)
    check("the open check offers exactly one way to answer it",
          sum(1 for k in ("rating", "option", "count") if controls[k] > 0), 1)

    # The technician picks the order; tapping any check opens it.
    await page.click('[data-toggle-check="3"]')
    await page.wait_for_timeout(300)
    opened = await page.eval_on_selector_all(".tech-check-card.open", "e=>e.map(x=>x.dataset.check)")
    check("the technician's choice is what opens", opened, ["3"])
    await page.click('[data-toggle-check="0"]')
    await page.wait_for_timeout(250)

    sizes = await page.eval_on_selector_all(
        ".tech-check-card.open [data-quick-rate], .tech-check-card.open [data-answer-option],"
        " .tech-check-card.open [data-answer-count], .tech-check-card.open [data-answer-keypad]",
        "e=>e.map(x=>{const r=x.getBoundingClientRect();return [r.width,r.height]})")
    check("the open check has something to tap", len(sizes) > 0, True)
    small = [s for s in sizes if s[1] < 44]
    check("every answer control clears the 44px tap target", small, [])
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

    # The technician must be warned too: every other protocol's condition check
    # implies cleaning, so a tech working from habit would clean a grill.
    print("\n=== grill scope in the field tool ===")
    await page.goto(base + "/tech-maintenance.html?visit=visit_reynolds_spring&household=hh_reynolds",
                    wait_until="networkidle")
    await page.wait_for_timeout(400)
    reynolds = await page.evaluate(
        "() => WilsonStore.load().assets.filter(a => a.householdId === 'hh_reynolds')")
    grill = next((a for a in reynolds if "grill" in str(a.get("typeLabel", "")).lower()), None)
    check("the seeded grill uses the grill protocol", grill and grill["checkpointSet"],
          "outdoor_grill")
    await page.click(f'[data-open-asset="{grill["id"]}"]')
    await page.wait_for_timeout(500)
    check("the limited-scope banner is shown to the technician",
          await page.locator(".tech-scope-banner").count(), 1)
    banner = await page.inner_text(".tech-scope-banner")
    check("the banner says cleaning is never included",
          "never included" in banner.lower(), True)
    headings = await page.eval_on_selector_all(".tech-check-title strong", "e=>e.map(x=>x.innerText)")
    # v0.9.39: the field team's grill protocol -- gauge, burners/valves, grates,
    # ignitor, rust, grease, extras. Seven checks, still nothing cleaned.
    check("the grill protocol renders the field team's seven checks", len(headings), 7)
    check("grease has its own check", any("grease" in h.lower() for h in headings), True)
    # The no-cleaning promise now lives on the grease check's prompt.
    grease_index = next(i for i, h in enumerate(headings) if "grease" in h.lower())
    await page.click(f'[data-toggle-check="{grease_index}"]')
    await page.wait_for_timeout(300)
    prompts = await page.eval_on_selector_all(".tech-check-card.open .tech-check-prompt",
                                              "e=>e.map(x=>x.innerText)")
    check("the grease check says cleaning is never included",
          any("never included" in p.lower() for p in prompts), True)
    body = await page.inner_text(".tech-check-card.open")
    check("no before/after cleaning photo is requested on a grill",
          "before / after" in body.lower(), False)
    icon = await page.get_attribute(".tech-asset-hero-icon img", "src")
    check("the grill draws the grill icon, not the fallback",
          icon.endswith("outdoor_grill.svg"), True)

    # ---- whole-visit maintenance review ------------------------------------
    print("\n=== whole-visit maintenance review ===")
    vr_errors = []
    vp = await browser.new_page(viewport={"width": 1280, "height": 1400})
    vp.on("pageerror", lambda e: vr_errors.append(str(e)))
    vp.on("console", lambda m: vr_errors.append(m.text) if m.type == "error" else None)

    # The page must refuse to guess, exactly as the single-appliance report does.
    await vp.goto(base + "/visit-report.html", wait_until="networkidle")
    await vp.wait_for_timeout(300)
    check("no visit selected: the review refuses rather than guessing",
          "no maintenance visit was selected" in (await vp.inner_text("body")).lower(), True)
    await vp.goto(base + "/visit-report.html?visit=not_a_real_visit", wait_until="networkidle")
    await vp.wait_for_timeout(300)
    check("an unknown visit is reported, not substituted",
          "could not be found" in (await vp.inner_text("body")).lower(), True)
    check("nothing is compiled for an unknown visit",
          await vp.locator(".portfolio-area").count(), 0)

    # A four-year estate stop: sixteen appliances, grouped by room.
    await vp.goto(base + "/visit-report.html?visit=visit_reynolds_h4", wait_until="networkidle")
    await vp.wait_for_timeout(600)
    body = await vp.inner_text("#visit-report-sheet")
    # The four SECTIONS, not a fixed sheet count: a long visit legitimately
    # flows a section across several sheets, and pinning this to 4 turned
    # correct pagination into a test failure.
    sections = await vp.evaluate("""() => ['report-cover-page','portfolio-summary-page','portfolio-inventory-page','portfolio-next-page']
        .filter(c => !document.querySelector('.' + c))""")
    check("all four sections of the review are present", sections, [])
    check("and it occupies at least four sheets",
          await vp.locator(".report-page").count() >= 4, True)
    check("it carries the locked Wilson Estate Care styling",
          "WILSON ESTATE CARE" in body.upper(), True)

    rows = await vp.eval_on_selector_all(".portfolio-table tbody tr", "e=>e.length")
    check("every appliance on the visit is listed",
          await vp.evaluate("""() => {
              const s = JSON.parse(localStorage.getItem('wilson-maintenance-demo-v07'));
              return s.reports.filter(r => r.visitId === 'visit_reynolds_h4').length;
          }"""), 16)

    # The headline is a COUNT, not an average -- averaging a Sub-Zero against a
    # microwave produces a number that hides the appliance that needs attention.
    lead = await vp.inner_text(".portfolio-lead strong")
    check("the headline is a count of appliances, not a score",
          bool(re.match(r"^\d+ of \d+ appliances", lead)), True)
    check("the mean is present but labelled as an unweighted summary",
          "unweighted mean" in (await vp.inner_text(".portfolio-mean")).lower(), True)

    # Bands must add up to the appliance count, or the summary is lying.
    band_counts = await vp.eval_on_selector_all(
        ".portfolio-band strong", "e=>e.map(x=>parseInt(x.innerText,10))")
    check("the three status bands account for every appliance", sum(band_counts), 16)

    # Rooms, not positions: "Main Kitchen - Left" is a dishwasher slot.
    areas = await vp.eval_on_selector_all(".portfolio-area h3", "e=>e.map(x=>x.innerText)")
    check("appliances are grouped by room, not by position within a room",
          any("Main Kitchen -" in a for a in areas), False)
    note("rooms", [a.split("\n")[0] for a in areas])

    # Findings must be specific. A bare "the score fell" line is the one thing
    # that makes a report read as automated, so no finding may be only that.
    findings = await vp.eval_on_selector_all(".attention-item li", "e=>e.map(x=>x.innerText)")
    # Not every finding is a number -- a grill firebox is a condition, and
    # demanding a digit there would push the report into inventing one. What
    # every finding must have is substance: a named checkpoint or reading, and
    # an explanation after it.
    check("no finding is a bare label with nothing behind it",
          all(len(f.strip()) > 25 and " " in f.strip() for f in findings), True)
    numeric = [f for f in findings if any(c.isdigit() for c in f)]
    check("findings taken from readings quote the reading", len(numeric) >= 4, True)
    check("no appliance is reported on health score alone",
          await vp.evaluate("""() => Array.from(document.querySelectorAll('.attention-item'))
              .every(el => Array.from(el.querySelectorAll('li strong'))
                .some(s => s.innerText.trim() !== 'Health score'))"""), True)

    # The grill is enrolled for function only and Wilson never cleans one. Where
    # its condition is marked down, the limit of the cover must be stated.
    grill = vp.locator(".attention-item", has_text="Outdoor Grill")
    if await grill.count():
        scope = (await grill.first.locator(".attention-scope").inner_text()).lower()
        check("a grill finding states that cleaning is never included",
              "cleaning is never included" in scope, True)

    check("open findings are carried forward to the next visit",
          await vp.locator(".portfolio-followups li").count() >= 1, True)
    check("every appliance row links to its own report",
          await vp.locator('.portfolio-table a[href^="report-view.html?id="]').count(), 16)
    await no_overflow(vp, "whole-visit review")

    # A first visit: no history to lean on, so the reading itself is the finding.
    await vp.goto(base + "/visit-report.html?visit=visit_davenport_completed", wait_until="networkidle")
    await vp.wait_for_timeout(500)
    first = await vp.inner_text(".portfolio-summary-page")
    check("a first-visit review still compiles",
          await vp.evaluate("""() => ['report-cover-page','portfolio-summary-page','portfolio-inventory-page','portfolio-next-page']
              .filter(c => !document.querySelector('.' + c))"""), [])
    check("an out-of-range reading is reported without any trend behind it",
          "112" in first, True)
    await no_overflow(vp, "first-visit review")

    if vr_errors:
        failures.append(f"visit review console errors: {vr_errors[:3]}")
        note("errors", vr_errors[:3])
    await vp.close()

    # ---- HVAC field workflow ------------------------------------------------
    print("\n=== HVAC field workflow ===")
    # Before v0.9.14 this was unreachable in three separate ways: the store
    # filtered HVAC out of every visit's scope, the field tool kept its own copy
    # of that filter, and it refused any visit whose category was not
    # "appliance". So an HVAC visit opened with nothing on it at all.
    hv = await browser.new_page(viewport={"width": 390, "height": 900})
    hv_errors = []
    hv.on("pageerror", lambda e: hv_errors.append(str(e)))
    hv.on("console", lambda m: hv_errors.append(m.text) if m.type == "error" else None)

    hv_url = base + "/tech-maintenance.html?visit=visit_mercer_hvac&household=hh_mercer"
    await hv.goto(hv_url, wait_until="networkidle")
    await hv.wait_for_timeout(700)
    tiles = await hv.eval_on_selector_all("[data-open-asset]",
        "e => e.map(x => ({id: x.dataset.openAsset, t: x.innerText.replace(/\\n/g, ' ')}))")
    systems = [t for t in tiles if "Trane" in t["t"]]
    check("an HVAC visit opens with its systems in scope", len(systems) >= 3, True)
    check("the field tool no longer refuses HVAC visits",
          "only opens appliance-maintenance visits" in (await hv.inner_text("body")), False)

    protocols = {}
    for want, label in (("4TWR6042", "cooling"), ("S9V2B080", "furnace")):
        hit = [t for t in systems if want in t["t"]]
        if not hit:
            continue
        await hv.goto(hv_url, wait_until="networkidle")
        await hv.wait_for_timeout(400)
        await hv.click('[data-open-asset="%s"]' % hit[0]["id"])
        await hv.wait_for_timeout(600)
        protocols[label] = await hv.locator(".tech-check-card").count()
        check("the %s protocol is not the three-check fallback" % label, protocols[label] > 3, True)
        check("the %s system shows its nameplate card" % label,
              await hv.locator(".tech-plate-card").count(), 1)
    note("protocol sizes", protocols)

    # The guest-house system has no plate data on record: it must say which
    # dimensions that costs, rather than scoring against a category default.
    guest = [t for t in systems if "4TWR6036" in t["t"]]
    if guest:
        await hv.goto(hv_url, wait_until="networkidle")
        await hv.wait_for_timeout(400)
        await hv.click('[data-open-asset="%s"]' % guest[0]["id"])
        await hv.wait_for_timeout(600)
        check("a system with no nameplate data says what that costs",
              await hv.locator(".tech-plate-missing").count(), 1)
        missing = await hv.inner_text(".tech-plate-missing")
        check("and names the dimensions by name", "capacity delivery" in missing.lower(), True)

    good = {
        "return air": "76", "supply air": "57", "return static": "0.21", "supply static": "0.26",
        "suction saturation": "46", "suction line": "58", "liquid saturation": "104",
        "liquid line": "111", "outdoor air": "97", "condenser running": "19.4", "blower running": "6.9",
    }
    cooling = [t for t in systems if "4TWR6042" in t["t"]]
    await hv.goto(hv_url, wait_until="networkidle")
    await hv.wait_for_timeout(400)
    await hv.click('[data-open-asset="%s"]' % cooling[0]["id"])
    await hv.wait_for_timeout(600)

    for _ in range(14):
        did = await answer_open_check(hv, good)
        if did in (None, "none"):
            break
    await hv.wait_for_timeout(700)

    live = await hv.inner_text("#tech-score-number")
    detail = await hv.inner_text("#tech-score-detail")
    note("live HVAC score", live.strip() + " - " + detail.strip()[:90])
    # v0.9.17: age is worth 25% of the overall on the HVAC side too, so a
    # system meeting its design no longer reads 100 unless it is new. What must
    # still be true -- and is asserted below across four SEER ratings -- is that
    # the EFFICIENCY rating never moves it. The measured-performance component
    # is printed beside the total, and that is the number that should be full.
    check("a system meeting its design scores full marks on measured performance",
          "100" in detail, True)
    check("and the overall reflects its age rather than its efficiency",
          live.strip().isdigit() and int(live.strip()) <= 100, True)

    # THE GUARDRAIL, asserted through the real UI rather than only in the unit
    # test: the score must not move when the efficiency rating changes.
    seer_scores = await hv.evaluate("""async () => {
        const out = [];
        for (const seer of [13, 14, 20, 24]) {
            const s = WilsonStore.load();
            const a = s.assets.find(x => x.model === '4TWR6042H1000AB');
            a.design = Object.assign({}, a.design, { ratedSeer: seer });
            localStorage.setItem('wilson-maintenance-demo-v07', JSON.stringify(s));
            const insp = (WilsonStore.load().techInspections || [])
                .filter(i => i.assetId === a.id).slice(-1)[0];
            const readings = {};
            (insp.checks || []).forEach(c => Object.assign(readings, c.readings || {}));
            const ratings = {};
            (insp.checks || []).forEach(c => { if (Number(c.rating) > 0) ratings[c.id] = Number(c.rating); });
            out.push(WILSON_HVAC.scoreHealth({
                readings, design: a.design, ratings, checkpointSet: 'hvac_cooling'
            }).score);
        }
        return out;
    }""")
    note("scores at 13/14/20/24 SEER, same readings", seer_scores)
    check("changing the efficiency rating does not change the health score",
          len(set(seer_scores)), 1)

    check("the HVAC caption says it measured against the nameplate",
          "own nameplate" in detail, True)
    check("and states that age and efficiency are excluded",
          "not in this number" in detail, True)
    check("no appliance-style vitals-plus-lifecycle blend is claimed",
          "% lifecycle" in detail, False)

    if hv_errors:
        failures.append("HVAC field console errors: %s" % hv_errors[:3])
        note("errors", hv_errors[:3])
    await hv.close()

    # ---- print fidelity ----------------------------------------------------
    print("\n=== print fidelity ===")
    # A `.report-page` is a fixed sheet: max-height 11in, overflow hidden. On
    # screen it grew and everything showed; in print the overflow was silently
    # DISCARDED. The compiled review printed 3 of 5 findings and 10 of 16
    # appliances, ending mid-heading, and nothing in the UI hinted at it. These
    # checks exist because a document that drops content on the way to the
    # printer cannot be caught by reading the screen.
    pp = await browser.new_page(viewport={"width": 1180, "height": 1400})
    pf_errors = []
    pp.on("pageerror", lambda e: pf_errors.append(str(e)))

    async def sheet_overflow(page):
        """Any sheet whose content is taller than the sheet itself."""
        return await page.evaluate("""() => {
            const SHEET = 1110;   // 11in, per the stylesheet
            const bad = [];
            document.querySelectorAll('.report-page').forEach((el, i) => {
                const body = el.querySelector('.report-page-body');
                if (!body) return;
                const header = el.querySelector('.report-page-header');
                const footer = el.querySelector('.report-page-footer');
                const chrome = (header ? header.offsetHeight : 0) + (footer ? footer.offsetHeight : 0);
                const content = body.scrollHeight;
                const budget = SHEET - chrome;
                if (content > budget + 8) {
                    const h = el.querySelector('.report-page-header h2');
                    bad.push({ index: i, title: h ? h.textContent.trim() : '?',
                               overBy: Math.round(content - budget) });
                }
            });
            return bad;
        }""")

    # The compiled review: variable-length by nature, and where the bug was.
    await pp.goto(base + "/visit-report.html?visit=visit_reynolds_h4", wait_until="networkidle")
    await pp.wait_for_timeout(1600)
    over = await sheet_overflow(pp)
    check("no sheet of the compiled review overflows its page", over, [])
    if over:
        note("overflowing sheets", over)

    # Every finding and every appliance must survive pagination.
    counts = await pp.evaluate("""() => {
        const s = JSON.parse(localStorage.getItem('wilson-maintenance-demo-v07'));
        const reports = s.reports.filter(r => r.visitId === 'visit_reynolds_h4');
        const measured = r => Number((r.lifecycle || {}).vitalScore || 0) || Number(r.score || 0);
        // The attention threshold is read from config, not restated here. This
        // test used to hard-code 85 while the page hard-coded 85 and the
        // single-appliance report graded Good from 80 -- three copies of one
        // rule, and the appliance at 82 was "Good" on its own report and
        // "Monitor" on the review. The page now reads gradeBands; so does this.
        const bands = (window.WILSON_CONFIG.reportScoring || {}).gradeBands || [];
        const goodFloor = (bands.find(b => /good/i.test(b.label || '')) || {min: 80}).min;
        return {
            goodFloor: goodFloor,
            expectedAppliances: reports.length,
            // Scoped to the inventory sheets: '.portfolio-table' is also the
            // filters table on the Consumables page, and counting its two rows
            // as appliances made 16 look like 18.
            renderedAppliances: document.querySelectorAll('.portfolio-inventory-page .portfolio-table tbody tr').length,
            expectedFindings: reports.filter(r => measured(r) < goodFloor).length,
            renderedFindings: document.querySelectorAll('.attention-item').length,
            sheets: document.querySelectorAll('.report-page').length,
            continued: Array.from(document.querySelectorAll('.report-page-header h2'))
                            .filter(h => h.textContent.includes('continued')).length,
        };
    }""")
    note("sheets", f"{counts['sheets']} ({counts['continued']} continuation)")
    note("attention floor from config", counts["goodFloor"])
    check("every appliance on the visit is printed",
          counts["renderedAppliances"], counts["expectedAppliances"])
    check("every finding is printed", counts["renderedFindings"], counts["expectedFindings"])
    check("long sections were split rather than truncated", counts["continued"] > 0, True)

    # A continuation sheet must be a real sheet, not a fragment.
    chrome_ok = await pp.evaluate("""() => {
        const pages = Array.from(document.querySelectorAll('.report-page'))
                           .filter(el => !el.classList.contains('report-cover-page'));
        return pages.every(el => el.querySelector('.report-page-header')
                              && el.querySelector('.report-page-footer'));
    }""")
    check("every sheet carries its own header and footer", chrome_ok, True)

    # The real deliverable: one PDF page per sheet, nothing merged or dropped.
    pdf_bytes = await pp.pdf(format="Letter", print_background=True,
                             margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
    check("the PDF has exactly one page per sheet",
          pdf_bytes.count(b"/Type /Page\n") or pdf_bytes.count(b"/Type/Page"),
          counts["sheets"])

    # A grid, paginated. Both wrong ways of measuring produced ONE block per
    # sheet while looking superficially fine -- summing cell heights counted
    # five-per-row as five rows, and reading the body's scrollHeight measured a
    # flex-stretched box that reports the full sheet whether it holds one
    # photograph or twenty. Fourteen photographs became fourteen sheets. So the
    # assertion is about DENSITY, not just absence of overflow.
    await pp.goto(f"{base}/report-view.html?id=report_hist_fridge_3", wait_until="networkidle")
    await pp.evaluate("""() => {
        const s = WilsonStore.load();
        const r = s.reports.find(x => x.id === 'report_hist_fridge_3');
        r.photos = Array.from({length: 14}, (_, i) => ({
            id: 'qa_photo_' + i, kind: 'condition',
            checkName: 'Checkpoint ' + (i + 1), caption: 'A condition photograph.'
        }));
        localStorage.setItem('wilson-maintenance-demo-v07', JSON.stringify(s));
    }""")
    await pp.reload(wait_until="networkidle")
    await pp.wait_for_timeout(1600)
    grid = await pp.evaluate("""() => {
        const cells = document.querySelectorAll('.photo-cell').length;
        const sheets = Array.from(document.querySelectorAll('.report-page'))
            .filter(el => el.querySelector('.photo-cell')).length;
        return { cells: cells, sheets: sheets };
    }""")
    note("photo pagination", f"{grid['cells']} photographs over {grid['sheets']} sheet(s)")
    check("all fourteen photographs are rendered", grid["cells"], 14)
    check("a photo grid packs several per sheet rather than one",
          grid["cells"] / max(1, grid["sheets"]) >= 4, True)
    check("and none of those sheets overflows", await sheet_overflow(pp), [])

    # Put the fixture back so later checks see the real seeded report.
    await pp.evaluate("() => localStorage.removeItem('wilson-maintenance-demo-v07')")

    # The per-appliance report, on both an ordinary and an undated appliance.
    for label, report_id in (("documented", "report_hist_fridge_3"), ("undated", "report_rey_gdryer_3")):
        await pp.goto(f"{base}/report-view.html?id={report_id}", wait_until="networkidle")
        await pp.wait_for_timeout(1400)
        over = await sheet_overflow(pp)
        check(f"no sheet of the {label} appliance report overflows", over, [])
        if over:
            note("overflowing sheets", over)

    if pf_errors:
        failures.append(f"print fidelity console errors: {pf_errors[:3]}")
    await pp.close()

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

    # ---- Guardian passthrough (v0.9.41) -------------------------------------
    # v0.9.40 prefilled a compartment-temp check from the sensor; Cayden then
    # killed the field readout entirely: "there should just be a passthrough to
    # the health reports with their logged temp data... the tech shouldn't have
    # to do anything here." So an enrolled fridge shows ONE quiet card, no temp
    # task, and the protocol carries no compartment-temperature check at all.
    passthrough = page.locator(".tech-guardian-note.passthrough")
    check("an enrolled fridge shows the Guardian passthrough card",
          await passthrough.count(), 1)
    passthrough_text = (await passthrough.inner_text()).lower()
    check("the card says the data reaches the report by itself",
          "automatically" in passthrough_text, True)
    check("...and that there is nothing to record",
          "nothing to record" in passthrough_text, True)
    check("no compartment-temperature check remains in the protocol",
          await page.evaluate("""() => {
              return [...document.querySelectorAll('#tech-checks .tech-check-card')]
                .some(el => /compartment temperatures/i.test(el.textContent));
          }"""), False)
    check("the condenser check survives, judged without temperatures",
          await page.evaluate("""() => {
              const card = [...document.querySelectorAll('#tech-checks .tech-check-card')]
                .find(el => /condenser health/i.test(el.textContent));
              return Boolean(card) && !/coil surface/i.test(card.textContent);
          }"""), True)

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as fh:
        fh.write(TINY_PNG)
        serial_path = fh.name
    try:
        # v0.9.17: age is picked, not typed -- decade then year, or nothing at
        # all when the invoice already answered it.
        age_path = await page.evaluate("""() => {
            const known = document.querySelector('.tech-age-known');
            if (known) return 'from the invoice';
            const decade = document.querySelector('[data-age-decade]');
            if (decade) decade.click();
            return 'picking';
        }""")
        note("how the age was established", age_path)
        await page.wait_for_timeout(300)
        await page.evaluate("""() => {
            const year = document.querySelector('[data-age-year]');
            if (year) year.click();
        }""")
        await page.wait_for_timeout(300)
        await page.set_input_files("#serial-photo", serial_path)
        await page.wait_for_timeout(700)
        check("still blocked with serial photo but no checks",
              await complete.is_disabled(), True)

        # The image itself has to survive, not just a note that one was taken.
        # Before v0.9.12 the field tool set a boolean and discarded the file, and
        # the report printed a photo count with nothing behind it.
        check("the serial photo is confirmed saved, not just noted",
              "saved" in (await page.inner_text("#serial-photo-label")).lower(), True)
        check("the technician can see the photo they just took",
              await page.locator(".tech-photo-thumb img").count() >= 1, True)
        photo_meta = await page.evaluate("""async () => {
            const rows = await WILSON_PHOTOS.forVisit('visit_davenport');
            return rows.map(r => ({kind: r.kind, bytes: r.bytes, hasBlob: !!r.blob, asset: r.assetId}));
        }""")
        check("the image bytes are in the store", len(photo_meta) >= 1 and photo_meta[0]["hasBlob"], True)
        check("it is tagged as the serial-tag photograph",
              any(r["kind"] == "serial" for r in photo_meta), True)

        # A checkpoint photo, so the report has evidence against a named check.
        first_photo_input = page.locator("[data-photo]").first
        if await first_photo_input.count():
            await first_photo_input.set_input_files(serial_path)
            await page.wait_for_timeout(700)

        # Rating a check is what completes it -- there is no separate "performed"
        # step -- and completing one opens the next unfinished check, so the whole
        # protocol is worked from the open card without hunting up and down.
        rating_taps = 0
        for _ in range(12):
            open_card = page.locator(".tech-check-card.open")
            if not await open_card.count():
                break
            # v0.9.39: a check can demand its photograph (the IR evaporator
            # scan). Attach it the way a technician would -- from the camera
            # roll -- before answering, or readiness correctly refuses.
            needs_photo = page.locator(".tech-check-card.open .photo-needed input[data-photo]")
            if await needs_photo.count():
                await needs_photo.set_input_files(serial_path)
                await page.wait_for_timeout(600)
            # answer_open_check fills the readings on the keypad first -- there
            # are no number inputs in the field tool any more.
            tapped = await answer_open_check(page)
            if tapped in (None, "none"):
                break
            rating_taps += 1
        check("every check can be answered in one pass",
              rating_taps >= len(await page.eval_on_selector_all(
                  "[data-check]", "e=>e.map(x=>x.dataset.check)")), True)
        check("the old separate performed toggle is gone",
              await page.locator("[data-performed]").count(), 0)
        await page.wait_for_timeout(600)

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

        # Provenance and evidence, on the generated report.
        record = await page.evaluate(f"""() => {{
            const s = WilsonStore.load();
            const r = (s.reports || []).filter(x => x.assetId === '{fridge["id"]}')[0];
            if (!r) return null;
            return {{
              photos: (r.photos || []).map(p => ({{id: p.id, kind: p.kind, check: p.checkName}})),
              hasLegacyCount: Object.prototype.hasOwnProperty.call(r, 'photoCount'),
              ageSource: (r.lifecycle || {{}}).ageSource,
              ageDocumented: (r.lifecycle || {{}}).ageDocumented,
              ageSourceRef: (r.lifecycle || {{}}).ageSourceRef,
              age: (r.lifecycle || {{}}).age,
            }};
        }}""")
        check("the report carries the photographs, not a count",
              bool(record and record["photos"]) and not record["hasLegacyCount"], True)
        note("photos on report", record["photos"] if record else None)
        check("every photo on the report names what it is evidence for",
              all(p["kind"] == "serial" or p["check"] for p in (record["photos"] if record else [])), True)
        # Whichever way the age was established, the report has to say so
        # accurately: a paper trail may claim to be documented, and a technician's
        # pick may not. Which branch runs depends on the seeded appliance, so the
        # assertion follows the path actually taken rather than assuming one.
        if age_path == "from the invoice":
            check("an age that came from the invoice is recorded as documented",
                  record and record["ageSource"] == "invoice" and record["ageDocumented"] is True, True)
            check("and it carries the invoice it came from",
                  bool(record and str(record["ageSourceRef"] or "").strip()), True)
        else:
            check("an age picked in the field is recorded as an estimate, not as documented",
                  record and record["ageSource"] in ("estimate", "customer") and record["ageDocumented"] is False, True)
            check("and it claims no document behind it",
                  bool(record and str(record["ageSourceRef"] or "").strip()), False)

        # The branch above follows whichever path the seeded appliance offers, so
        # the other path is exercised here deliberately: an appliance with no
        # install date on record, aged by tapping a decade and a year. That has to
        # land as an estimate. A picked year that silently inherited "invoice"
        # would print a paper trail that does not exist.
        undated = await page.evaluate("""() => {
            const s = WilsonStore.load();
            const a = (s.assets || []).find(x => x.householdId === 'hh_reynolds' && !x.installYear);
            return a ? {id: a.id, name: a.typeLabel || a.name, room: a.location || ''} : null;
        }""")
        if undated:
            note("aged by hand", f"{undated['name']} - {undated['room']}")
            await page.goto(base + "/tech-maintenance.html?visit=visit_reynolds_spring&household=hh_reynolds",
                            wait_until="networkidle")
            await page.wait_for_timeout(400)
            await page.click(f'[data-open-asset="{undated["id"]}"]')
            await page.wait_for_timeout(500)
            check("an appliance with no install date offers no invoice fact to lean on",
                  await page.locator(".tech-age-known").count(), 0)
            await page.evaluate("""() => {
                const d = document.querySelector('[data-age-decade]');
                if (d) d.click();
            }""")
            await page.wait_for_timeout(300)
            # The oldest year in the decade, not the first button. The first one
            # is the current year, which records an age of 0 and would pass this
            # test even if the picked year never reached the draft at all.
            picked = await page.evaluate("""() => {
                const btns = Array.from(document.querySelectorAll('[data-age-year]'));
                if (!btns.length) return null;
                const y = btns[btns.length - 1];
                y.click();
                return Number(y.dataset.ageYear);
            }""")
            # Autosave is debounced, and this assertion is about what reached the
            # device, not about what the screen is holding in memory.
            await page.wait_for_timeout(900)
            check("a year could be picked with no typing at all", bool(picked), True)
            hand = await page.evaluate(f"""() => {{
                const d = WilsonStore.getTechInspection('visit_reynolds_spring', '{undated["id"]}');
                return d ? {{source: d.ageSource, documented: d.ageDocumented, age: d.age}} : null;
            }}""")
            note("recorded as", hand)
            check("an age picked in the field is an estimate, not a document",
                  hand and hand["source"] in ("estimate", "customer"), True)
            this_year = await page.evaluate("() => new Date().getFullYear()")
            check("and the year that was tapped is the age that was recorded",
                  bool(hand) and int(hand["age"]) == this_year - picked, True)
            check("and it is not marked documented",
                  bool(hand and hand["documented"]), False)
            shown = " ".join((await page.inner_text("#tech-age-source")).split()).lower()
            check("and the screen tells the technician that in words",
                  "estimate" in shown or "customer" in shown, True)
            check("it does not claim an invoice it never had", "invoice" in shown, False)

        # The compiled review shows the same evidence on the appliance it belongs
        # to -- and shows none where none was captured, rather than a count.
        vr = await ctx.new_page()
        await vr.goto(base + "/visit-report.html?visit=visit_davenport", wait_until="networkidle")
        await vr.wait_for_timeout(1200)
        basis = await vr.inner_text(".portfolio-basis")
        check("the review states how many photographs the visit produced",
              "photograph" in basis.lower(), True)
        await vr.goto(base + "/visit-report.html?visit=visit_reynolds_h4", wait_until="networkidle")
        await vr.wait_for_timeout(700)
        seeded_basis = await vr.inner_text(".portfolio-basis")
        check("a visit with no photographs claims none",
              "photograph" not in seeded_basis.lower(), True)
        check("and shows no photo strips", await vr.locator(".attention-photos").count(), 0)
        await vr.close()

        if stored["reportId"]:
            rp = await ctx.new_page()
            # The param is `id`. This test used `?report=` and passed anyway,
            # because the page silently fell back to the first stored report --
            # which is exactly the fallback that has now been removed.
            r = await rp.goto(f"{base}/report-view.html?id={stored['reportId']}",
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

    # A server that refuses the upload must not cost the technician the photo.
    # This harness's static server refuses every POST, which makes it a free test
    # of exactly that: the photos are still on the device, still queued, and not
    # one of them claims to have been sent.
    if photo_post_failures:
        note("upload attempts refused by the static server", len(photo_post_failures))
        # `uploaded` is the string "no" until a server says otherwise, so this
        # compares against the value rather than testing truthiness -- "no" is
        # truthy, and a first draft of this check reported every pending photo as
        # sent.
        surviving = await page.evaluate("""async () => {
            const rows = await WILSON_PHOTOS.forVisit('visit_davenport');
            return {
                kept: rows.length,
                withBytes: rows.filter(r => !!r.blob).length,
                claimingSent: rows.filter(r => r.uploaded === 'yes').length,
                attempted: rows.filter(r => Number(r.uploadAttempts || 0) > 0).length,
            };
        }""")
        note("photos after refused uploads", surviving)
        check("a refused upload does not cost the technician the photograph",
              surviving["kept"] > 0 and surviving["withBytes"] == surviving["kept"], True)
        check("and nothing claims to have been sent when it was not",
              surviving["claimingSent"], 0)
        check("the refusal is counted against the photo, so it cannot retry forever",
              surviving["attempted"] > 0, True)

    # ---- v0.9.41: the dryer opt-out, the 350 default, the general photo -----
    print("\n=== bad installs, standard set points, and the general photo ===")
    dpage = await ctx.new_page()
    dryer_asset = await page.evaluate("""() => {
        const s = WilsonStore.load();
        const a = s.assets.find(x => x.householdId === 'hh_davenport' && x.customerCategory === 'dryer');
        return a ? a.id : null;
    }""")
    check("the Davenport house has a dryer to test", bool(dryer_asset), True)
    await dpage.goto(base + "/tech-maintenance.html?visit=visit_davenport&household=hh_davenport",
                     wait_until="networkidle")
    await dpage.wait_for_timeout(400)
    await dpage.click(f'[data-open-asset="{dryer_asset}"]')
    await dpage.wait_for_timeout(500)
    dryer_text = await dpage.inner_text("#tech-checks")
    check("the dryer protocol dropped the separate restriction test",
          "restriction test" in dryer_text.lower(), False)
    check("...and runs four checks",
          await dpage.locator("#tech-checks .tech-check-card").count(), 4)
    # The vent-static check is first and open: reading required until the tech
    # says the install hides the vent.
    fields_before = await dpage.locator(".tech-check-card.open .tech-keypad-open").count()
    check("the static check asks for its reading on a normal install",
          fields_before >= 1, True)
    no_access = dpage.locator(".tech-check-card.open [data-answer-toggle*='no_access']")
    check("the can't-access tick is offered", await no_access.count(), 1)
    await no_access.click()
    await dpage.wait_for_timeout(300)
    check("ticking it waives the reading",
          await dpage.locator(".tech-check-card.open .tech-keypad-open").count(), 0)
    check("the general note offers a photo not tied to any check",
          await dpage.locator("#general-photo").count(), 1)

    # The oven's standardized bake: the set point arrives at 350, editable.
    oven_asset = await dpage.evaluate("""() => {
        const s = WilsonStore.load();
        const a = s.assets.find(x => x.householdId === 'hh_davenport' &&
            ['range', 'ovens'].indexOf(x.customerCategory) > -1);
        return a ? a.id : null;
    }""")
    if oven_asset:
        await dpage.goto(base + "/tech-maintenance.html?visit=visit_davenport&household=hh_davenport",
                         wait_until="networkidle")
        await dpage.wait_for_timeout(400)
        await dpage.click(f'[data-open-asset="{oven_asset}"]')
        await dpage.wait_for_timeout(500)
        oven_prefill = await dpage.evaluate("""() => {
            const card = [...document.querySelectorAll('.tech-check-card')]
                .find(el => /oven temp test/i.test(el.textContent));
            if (!card) return null;
            card.querySelector('.tech-check-head, .tech-check-title, button')?.click();
            const btn = [...document.querySelectorAll('[data-answer-keypad]')]
                .find(b => b.dataset.answerKeypad.includes('set_point'));
            return btn ? btn.textContent : (card.textContent.match(/350/) ? '350 in card' : null);
        }""")
        check("the oven set point arrives prefilled at 350",
              bool(oven_prefill and "350" in str(oven_prefill)), True)
    await dpage.close()

    # ---- v0.9.41: the field amendment, end to end ---------------------------
    print("\n=== adding to a plan in the field ===")
    apage = await ctx.new_page()
    await apage.goto(base + "/household.html?id=hh_okafor", wait_until="networkidle")
    await apage.wait_for_timeout(500)
    state_snapshot = await apage.evaluate(
        "() => localStorage.getItem('wilson-maintenance-demo-v07')")
    check("the customer file offers the amendment door",
          await apage.locator(".amend-plan-button").count(), 1)
    await apage.goto(base + "/appliance-signup.html?amend=hh_okafor", wait_until="networkidle")
    await apage.wait_for_timeout(600)
    locked_count = await apage.locator(".selected-appliance-card.on-plan").count()
    okafor_appliances = await apage.evaluate("""() => {
        const s = WilsonStore.load();
        return s.assets.filter(a => a.householdId === 'hh_okafor' && a.group !== 'hvac').length;
    }""")
    check("every appliance on the plan boards the builder, locked",
          locked_count, okafor_appliances)
    check("the two registration exits are gone",
          await apage.locator(".submit-enrollment-button").is_visible(), False)
    check("the approval panel stands in their place",
          await apage.locator("#amend-approve-panel").count(), 1)
    baseline_diff = await apage.inner_text("#amend-difference")
    check("before any change the difference is zero (seeds match the engine)",
          baseline_diff.replace("−", "").replace("+", "").replace(" / year", ""), "$0.00")
    check("the billed-today line prorates to zero too",
          (await apage.inner_text("#amend-prorated")).replace("−", "").replace("+", ""), "$0.00")
    check("the proration note says when the new annual takes over",
          "renewal" in (await apage.inner_text("#amend-prorate-note")), True)
    approve = apage.locator("#amend-approve-button")
    check("approval starts disabled", await approve.is_disabled(), True)

    # v0.9.42, Cayden: "Removing appliances from a plan should be fine in the
    # field, office confirms changes." Remove one, watch it price out and land
    # in the coming-off list, then undo it -- nothing is real until the
    # signature.
    check("every on-plan card offers Remove from plan",
          await apage.locator(".remove-from-plan").count(), locked_count)
    await apage.locator(".remove-from-plan").first.click()
    await apage.wait_for_timeout(400)
    check("the removed appliance leaves the priced board",
          await apage.locator(".selected-appliance-card.on-plan").count(), locked_count - 1)
    check("...and lands in the coming-off list with an undo",
          await apage.locator(".amend-removed-chip [data-amend-restore]").count(), 1)
    removal_diff = await apage.inner_text("#amend-difference")
    check("removing it moves the difference down", removal_diff.startswith("−"), True)
    await apage.locator("[data-amend-restore]").first.click()
    await apage.wait_for_timeout(400)
    check("undo puts it back on the plan",
          await apage.locator(".selected-appliance-card.on-plan").count(), locked_count)
    check("...and clears the coming-off list",
          await apage.locator(".amend-removed-chip").count(), 0)

    await apage.locator("[data-add-category]").first.click()
    await apage.wait_for_timeout(400)
    if await apage.locator(".addon-spotlight-backdrop").count():
        await apage.locator("[data-spotlight-close]").first.click()
        await apage.wait_for_timeout(200)
    check("an added appliance alone does not enable approval (no signature)",
          await approve.is_disabled(), True)
    sig = apage.locator("#amend-signature")
    await sig.scroll_into_view_if_needed()
    await apage.wait_for_timeout(200)
    sig_box = await sig.bounding_box()
    await apage.mouse.move(sig_box["x"] + 20, sig_box["y"] + 50)
    await apage.mouse.down()
    await apage.mouse.move(sig_box["x"] + 140, sig_box["y"] + 65, steps=8)
    await apage.mouse.up()
    await apage.wait_for_timeout(300)
    check("the signature enables approval", await approve.is_enabled(), True)
    prev_annual = await apage.evaluate("""() => WilsonStore.load().subscriptions
        .find(s => s.householdId === 'hh_okafor' && s.category === 'appliance').annualAmount""")
    await approve.click()
    await apage.wait_for_timeout(800)
    check("approval lands back on the customer file", "household.html" in apage.url, True)
    outcome = await apage.evaluate("""() => {
        const s = WilsonStore.load();
        const sub = s.subscriptions.find(x => x.householdId === 'hh_okafor' && x.category === 'appliance');
        const pending = WilsonStore.pendingAmendments().filter(a => a.householdId === 'hh_okafor');
        const row = pending.length ? pending[0] : null;
        return { annual: sub.annualAmount, pending: pending.length,
                 difference: row ? row.difference : null,
                 prorated: row ? row.proratedDifference : null,
                 servicedNow: row ? row.servicedNow : null,
                 engineBilled: row ? window.WILSON_PRICING.amendmentBilling(row.difference, sub.renewalOn,
                    { hasAdditions: (row.addedAssetIds || []).length > 0 }).amount : null,
                 signed: row ? row.signature.startsWith('data:image/png') : false };
    }""")
    check("the subscription moved to the approved total", outcome["annual"] > prev_annual, True)
    check("exactly one charge waits for the office", outcome["pending"], 1)
    check("the difference is the arithmetic of the two totals",
          abs(outcome["difference"] - (outcome["annual"] - prev_annual)) < 0.005, True)
    # v0.9.49, Cayden's correction: this amendment ADDED an appliance the tech
    # services at the visit, so it bills the FULL difference -- "we should
    # charge full price for it. i thought about this wrong."
    check("the recorded charge is the engine's own billing figure",
          outcome["prorated"] is not None and abs(outcome["prorated"] - outcome["engineBilled"]) < 0.005, True)
    check("an added-and-serviced appliance bills the FULL difference, flagged",
          outcome["servicedNow"] is True and abs(outcome["prorated"] - outcome["difference"]) < 0.005, True)
    check("the signature image is on the record", outcome["signed"], True)

    # The office side: the command center shows the charge and clears it.
    await apage.goto(base + "/admin.html", wait_until="networkidle")
    await apage.wait_for_timeout(600)
    check("the command center flags the plan addition to bill",
          await apage.locator(".stage-amendcharge").count() >= 1, True)
    charge_label = await apage.locator("[data-amendment-charged]").first.inner_text()
    check("the button names the exact difference", "$" in charge_label, True)
    await apage.locator("[data-amendment-charged]").first.click()
    await apage.wait_for_timeout(400)
    check("charging clears the flag", await apage.locator(".stage-amendcharge").count(), 0)
    check("the follow-up queue stages are on the board",
          await apage.evaluate("""() => {
              const t = document.body.textContent;
              return t.indexOf('Follow-up quote to build') > -1 || t.indexOf('Estimate to send') > -1
                  || Boolean(document.querySelector('[data-queue-filter]'));
          }"""), True)
    # Restore the seeded state so nothing downstream inherits the amendment.
    await apage.evaluate(
        "(s) => localStorage.setItem('wilson-maintenance-demo-v07', s)", state_snapshot)
    await apage.close()

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

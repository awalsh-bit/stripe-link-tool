#!/usr/bin/env python3
"""
The field tool with the server actually gone.

This is the only test in the suite that kills its own server mid-run, and it has
to: a technician in a mechanical room does not have a slow connection, they have
no connection, and the difference matters. Playwright's `set_offline` emulation
does NOT apply to fetches made from inside a service worker, so testing with it
alone would have reported success on a build where the offline path was broken.
So the server is started, the worker is installed, the server is terminated, and
then the real work is done against nothing.

What this proves, in order:
  - the shell installs, and what it installed
  - the field tool loads and renders with no server at all
  - a technician can do actual work in that state, and it persists
  - the banner appears even though navigator.onLine still reports true
  - a page never opened before explains itself instead of showing a browser error
  - reconnecting clears the banner

Run: python3 _qa/verify-offline-browser.py
"""
from __future__ import annotations

import asyncio
import glob
import os
import socket
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

failures: list[str] = []
checks = 0


def check(label, got, want):
    global checks
    checks += 1
    ok = got == want
    if not ok:
        failures.append(f"{label}: got {got!r}, want {want!r}")
    print(f"{'ok  ' if ok else 'FAIL'}  {label:<60} {got!r}")
    return ok


def note(label, value):
    print(f"      {label:<60} {value}")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(port: int):
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), 0.3):
                return proc
        except OSError:
            time.sleep(0.15)
    proc.terminate()
    raise RuntimeError("static server did not come up")


def server_is_down(port: int) -> bool:
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=2)
        return False
    except Exception:
        return True


async def run(pw, base: str, port: int, proc):
    browser = await pw.chromium.launch()
    # A phone-sized viewport, because this is a phone workflow.
    ctx = await browser.new_context(viewport={"width": 390, "height": 844})

    # ---- online: install the worker ----------------------------------------
    page = await ctx.new_page()
    await page.goto(f"{base}/tech-maintenance.html?visit=visit_reynolds_spring&household=hh_reynolds",
                    wait_until="networkidle")
    await page.wait_for_timeout(1800)

    reg = await page.evaluate("""async () => {
        const r = await navigator.serviceWorker.getRegistration();
        return { registered: !!r, active: !!(r && r.active) };
    }""")
    check("the service worker registers and activates", reg, {"registered": True, "active": True})

    shell = await page.evaluate("""async () => {
        const names = await caches.keys();
        if (!names.length) return { names: [], entries: 0, pages: 0, urls: [] };
        const cache = await caches.open(names[0]);
        const keys = await cache.keys();
        return {
            names: names,
            entries: keys.length,
            pages: keys.filter(k => k.url.endsWith('.html')).length,
            urls: keys.map(k => k.url),
        };
    }""")
    note("cache", f"{shell['names']} · {shell['entries']} entries")
    check("exactly one cache exists, so nothing stale is left behind", len(shell["names"]), 1)
    # Counted, not hardcoded. This said 11 and broke the moment quote-builder.html
    # was retired at v0.9.23 -- a page count is not a fact worth asserting, but
    # "every page that exists is offline-available" very much is, and that is
    # what a literal here was standing in for badly.
    # `field-preview.html` is a build artifact, not a page of the app -- the
    # whole field tool inlined into one file for phone testing with no server.
    # It is deliberately not in the offline shell (it is 800KB and duplicates
    # every asset already cached), so it is not a page that "ships" either.
    # See the same exclusion in _qa/verify-offline-shell.py.
    GENERATED = {"field-preview.html"}
    shipped_pages = sorted(
        os.path.basename(p) for p in glob.glob(os.path.join(ROOT, "*.html"))
        if not os.path.basename(p).startswith("_") and os.path.basename(p) not in GENERATED
    )
    check("every page that ships is in the cache", shell["pages"], len(shipped_pages))
    cached_names = sorted(
        u.rsplit("/", 1)[-1] for u in shell["urls"] if u.endswith(".html")
    )
    check("and they are the same pages, not merely the same number",
          [p for p in shipped_pages if p not in cached_names], [])
    check("the cache is versioned by release", shell["names"][0].startswith("wilson-v"), True)

    # ---- the server is now gone --------------------------------------------
    proc.terminate()
    proc.wait(timeout=10)
    time.sleep(1.5)
    check("the server really is down", server_is_down(port), True)

    field = await ctx.new_page()
    page_errors: list[str] = []
    field.on("pageerror", lambda e: page_errors.append(str(e)))

    response = await field.goto(f"{base}/tech-maintenance.html?visit=visit_reynolds_spring&household=hh_reynolds",
                                wait_until="domcontentloaded")
    await field.wait_for_timeout(2200)

    check("the field tool loads with no server", response.status if response else None, 200)
    check("its appliances render", await field.locator("[data-open-asset]").count() > 0, True)
    check("every global its scripts provide is present",
          await field.evaluate("() => ['WILSON_CONFIG','WILSON_PROTOCOL','WILSON_AGE','WILSON_PHOTOS','WilsonStore','WilsonUI'].filter(k => !window[k])"),
          [])

    # navigator.onLine is TRUE here -- the machine has a network, there is just
    # nothing answering on it. That is the case the banner exists for and the
    # case a naive implementation misses.
    check("navigator.onLine still claims to be online",
          await field.evaluate("() => navigator.onLine"), True)
    check("the banner appears anyway", await field.locator("#wilson-offline-banner").count(), 1)
    banner = await field.inner_text("#wilson-offline-banner")
    note("banner", " ".join(banner.split()))
    check("it says the work is on this device", "saved on this phone" in banner, True)
    check("it does not promise a sync that does not exist",
          any(p in banner.lower() for p in ("will sync", "will upload", "syncing")), False)

    # ---- real work, with nothing to talk to --------------------------------
    tiles = await field.eval_on_selector_all("[data-open-asset]", "e => e.map(x => x.dataset.openAsset)")
    await field.click(f'[data-open-asset="{tiles[0]}"]')
    await field.wait_for_timeout(700)

    # v0.9.17: the invoice answer is shown as a fact rather than pre-filled
    # into an input -- there is no age text field left to fill.
    check("the invoice's install year is shown as a fact, offline",
          await field.locator(".tech-age-known strong").count() > 0, True)
    source = await field.inner_text("#tech-age-source")
    check("and it still says where that age came from", "invoice" in source.lower(), True)

    # v0.9.41: the refrigeration protocol no longer takes ANY reading (the
    # condenser temps went, and Guardian streams the compartment temps), so if
    # this appliance's protocol carries no number, walk to one that does --
    # the pad offline is what this test is FOR.
    padded_asset = await field.evaluate("""() => {
        const s = WilsonStore.load();
        const sets = window.WILSON_CONFIG.checkpointSets;
        const tiles = [...document.querySelectorAll('[data-open-asset]')].map(e => e.dataset.openAsset);
        for (const id of tiles.length ? tiles : (s.assets || []).map(a => a.id)) {
            const a = (s.assets || []).find(x => x.id === id);
            if (!a) continue;
            const key = window.WILSON_PROTOCOL.resolveCheckpointSet(a);
            const carries = (sets[key] || []).some(function (c) {
                const ans = window.WILSON_ANSWERS.for(key, c.id);
                return ans && (ans.readingFields || []).length > 0;
            });
            if (carries) return id;
        }
        return null;
    }""")
    if padded_asset:
        back = field.locator("#back-assets")
        if await back.count():
            await back.click()
            await field.wait_for_timeout(500)
        await field.click(f'[data-open-asset="{padded_asset}"]')
        await field.wait_for_timeout(700)

    # Answer the open check with whatever control it carries -- readings go in
    # on the in-app keypad, which is the whole point offline: no OS keyboard,
    # nothing fetched, and it still works with the server switched off.
    answered = await field.evaluate("""async () => {
        let card = document.querySelector('.tech-check-card.open');
        if (!card) return 'no card';
        /* v0.9.39: the first check of the new refrigerator protocol is the
           seal verdict, which takes no reading -- so walk to a card that has
           the number pad, because the pad offline is what this test is FOR. */
        let pads = card.querySelectorAll('[data-answer-keypad]');
        if (!pads.length) {
            const heads = Array.from(document.querySelectorAll('[data-toggle-check]'));
            for (const head of heads) {
                head.click();
                await new Promise(r => setTimeout(r, 200));
                card = document.querySelector('.tech-check-card.open');
                pads = card ? card.querySelectorAll('[data-answer-keypad]') : [];
                if (pads.length) break;
            }
        }
        if (pads.length) {
            pads[0].click();
            await new Promise(r => setTimeout(r, 150));
            document.querySelector('#tech-keypad [data-key="3"]').click();
            document.querySelector('#tech-keypad [data-key="7"]').click();
            document.querySelector('#tech-keypad [data-key="done"]').click();
            await new Promise(r => setTimeout(r, 200));
        }
        const card2 = document.querySelector('.tech-check-card.open') || card;
        const rate = card2 && card2.querySelector('[data-quick-rate]');
        if (rate) { rate.click(); return 'rating'; }
        const opt = card2 && card2.querySelector('[data-answer-option]');
        if (opt) { opt.click(); return 'option'; }
        return 'reading only';
    }""")
    await field.wait_for_timeout(800)
    note("answered offline by", answered)

    rated = await field.evaluate("""() => {
        const s = WilsonStore.load();
        const i = (s.techInspections || []);
        if (!i.length) return 0;
        return (i[i.length - 1].checks || []).filter(
            c => Number(c.rating) > 0 || c.selection || String(c.reading || '').trim()
        ).length;
    }""")
    check("a checkpoint answered offline persists to the device", rated > 0, True)
    check("the number pad needs nothing from the network",
          await field.locator("#tech-keypad").count() > 0, True)

    # ---- a page that was never opened before -------------------------------
    never = await field.goto(f"{base}/not-a-real-page.html", wait_until="domcontentloaded")
    text = " ".join((await field.inner_text("body")).split())
    check("an uncached page returns the offline explanation, not a browser error",
          never.status if never else None, 503)
    check("and it tells the technician their work is not lost",
          "is not lost" in text, True)

    # ---- back online -------------------------------------------------------
    restarted = start_server(port)
    try:
        back = await ctx.new_page()
        await back.goto(f"{base}/tech-maintenance.html?visit=visit_reynolds_spring&household=hh_reynolds",
                        wait_until="networkidle")
        await back.wait_for_timeout(1800)
        check("the banner is gone once the server answers again",
              await back.locator("#wilson-offline-banner").count(), 0)
        await back.close()
    finally:
        restarted.terminate()
        restarted.wait(timeout=10)

    check("no page errors in any of the above", page_errors, [])
    await ctx.close()
    await browser.close()


def main() -> int:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("SKIP: playwright is not installed")
        return 0

    port = free_port()
    proc = start_server(port)
    base = f"http://127.0.0.1:{port}"

    async def go():
        async with async_playwright() as pw:
            try:
                await run(pw, base, port, proc)
            except Exception as exc:  # noqa: BLE001
                if "Executable doesn't exist" in str(exc):
                    print("SKIP: no Chromium binary")
                    return "skip"
                raise
        return None

    try:
        outcome = asyncio.run(go())
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=10)

    if outcome == "skip":
        return 0

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S) of {checks} checks:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"ALL {checks} OFFLINE BROWSER CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
THE TOOL IN A HAND, MEASURED

Every check here corresponds to something that was measurably wrong for a
technician holding a phone one-handed in front of an appliance, and every one
of them looked fine in the code:

  * the nameplate card promised "it carries to the next visit" and the plate
    was written to the inspection, not the appliance -- eleven fields, re-read
    on every visit, for data stamped on the side of the equipment;
  * a photo thumbnail was rebuilt empty by the next re-render while the button
    still read "Photo saved", which is the only check on a blurred serial plate;
  * the Complete button was disabled with its reason two screens down, and the
    toast meant to explain it could never fire from a disabled control;
  * the rating sat above the readings, so a judgement was formed before the
    measurement and the auto-advance never fired;
  * controls measuring 20-40px on a 44px minimum, four pixels apart, where a
    mis-tap rates a checkpoint wrongly or completes a visit.

Measured in a real browser at 390x844, against computed styles and rendered
boxes rather than intent.
"""

import asyncio
import pathlib
import socket
import subprocess
import sys
import time

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PHONE = {"width": 390, "height": 844}
FAILED = []
COUNT = 0


def check(name, got, want=True):
    global COUNT
    COUNT += 1
    good = got == want
    if not good:
        FAILED.append((name, got, want))
    print(("  ok    " if good else "  FAIL  ") + name.ljust(60) +
          ("" if good else " got=%r want=%r" % (got, want)))


def note(label, value):
    print("        %-58s %s" % (label, value))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    def __init__(self):
        self.port = free_port()
        self.proc = None

    def __enter__(self):
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(self.port), "--bind", "127.0.0.1"],
            cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", self.port), 0.3):
                    return "http://127.0.0.1:%d" % self.port
            except OSError:
                time.sleep(0.15)
        raise RuntimeError("static server did not come up")

    def __exit__(self, *exc):
        if self.proc:
            self.proc.terminate()
            self.proc.wait(timeout=10)


# WCAG 2.1 relative luminance and contrast, computed in the page against the
# colour actually painted behind the text.
CONTRAST_JS = """
(selectors) => {
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = c => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const behind = el => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const p = parse(bg);
      if (p.length === 3 && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) return p;
      n = n.parentElement;
    }
    return [255, 255, 255];
  };
  const out = [];
  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el || !el.textContent.trim()) return;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color), bg = behind(el);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    out.push({ sel: sel, ratio: Math.round(ratio * 100) / 100,
               px: parseFloat(cs.fontSize), weight: cs.fontWeight });
  });
  return out;
}
"""

SMALL_TARGETS_JS = """
() => {
  const bad = [];
  document.querySelectorAll(
    'a[href], button, input:not([type=hidden]), select, textarea, summary, label.tech-optional-toggle'
  ).forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;                 // not displayed
    if (getComputedStyle(el).visibility === 'hidden') return;
    if (el.type === 'file') return;                              // wrapped by its label
    if (r.height < 44 || r.width < 24) {
      bad.push({ tag: el.tagName.toLowerCase(),
                 cls: (el.className || '').toString().slice(0, 40),
                 text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30),
                 w: Math.round(r.width), h: Math.round(r.height) });
    }
  });
  return bad;
}
"""


async def main():
    with Server() as base:
        async with async_playwright() as p:
            browser = await p.chromium.launch()

            # =============================================================
            # 1. The nameplate is kept on the appliance
            # =============================================================
            hv = await browser.new_page(viewport=PHONE)
            errors = []
            hv.on("pageerror", lambda e: errors.append(str(e)))
            hv_url = base + "/tech-maintenance.html?visit=visit_mercer_hvac&household=hh_mercer"
            await hv.goto(hv_url, wait_until="networkidle")
            await hv.wait_for_timeout(700)

            tiles = await hv.eval_on_selector_all(
                "[data-open-asset]",
                "e => e.map(x => ({id: x.dataset.openAsset, t: x.innerText.replace(/\\n/g,' ')}))")
            guest = [t for t in tiles if "4TWR6036" in t["t"]]   # the one with no plate on record
            check("the system with no nameplate on record is in scope", bool(guest), True)

            if guest:
                await hv.click('[data-open-asset="%s"]' % guest[0]["id"])
                await hv.wait_for_timeout(700)
                blanks = await hv.evaluate("""() => {
                    const out = [];
                    document.querySelectorAll('.tech-plate-card input').forEach(i => {
                        if (!String(i.value || '').trim()) out.push(i.id || i.dataset.plateKey || '');
                    });
                    return out;
                }""")
                note("blank nameplate fields before entry", len(blanks))
                check("the plate card starts with fields to fill", len(blanks) > 0, True)

                typed = await hv.evaluate("""() => {
                    const inputs = Array.from(document.querySelectorAll('.tech-plate-card input'))
                        .filter(i => !String(i.value || '').trim());
                    const filled = [];
                    inputs.slice(0, 3).forEach((i, n) => {
                        i.value = String(3 + n);
                        i.dispatchEvent(new Event('input', {bubbles: true}));
                        i.dispatchEvent(new Event('change', {bubbles: true}));
                        filled.push([i.id || i.dataset.plateKey || '', i.value]);
                    });
                    return filled;
                }""")
                check("nameplate values could be entered", len(typed), 3)

                await hv.click("#save-progress")
                await hv.wait_for_timeout(600)

                stored = await hv.evaluate("""() => {
                    const s = window.WilsonStore.load();
                    const a = s.assets.find(x => (x.model || '').includes('4TWR6036'));
                    return a && a.design ? Object.keys(a.design).length : 0;
                }""")
                check("the nameplate is written onto the appliance, not just the visit",
                      stored > 0, True)
                note("nameplate fields now on the asset record", stored)

                # ...and is there on the next visit
                await hv.goto(hv_url, wait_until="networkidle")
                await hv.wait_for_timeout(500)
                await hv.click('[data-open-asset="%s"]' % guest[0]["id"])
                await hv.wait_for_timeout(700)
                prefilled = await hv.evaluate("""() => {
                    let n = 0;
                    document.querySelectorAll('.tech-plate-card input').forEach(i => {
                        if (String(i.value || '').trim()) n += 1;
                    });
                    return n;
                }""")
                check("and it is pre-filled when the tool is reopened", prefilled > 0, True)
                note("pre-filled nameplate fields on reopen", prefilled)

                # a blank field must never wipe what the last technician read
                kept = await hv.evaluate("""() => {
                    const before = window.WilsonStore.load()
                        .assets.find(x => (x.model || '').includes('4TWR6036')).design;
                    const keys = Object.keys(before);
                    window.WilsonStore.saveAssetDesign(
                        window.WilsonStore.load().assets.find(x => (x.model || '').includes('4TWR6036')).id,
                        Object.fromEntries(keys.map(k => [k, ''])));
                    const after = window.WilsonStore.load()
                        .assets.find(x => (x.model || '').includes('4TWR6036')).design;
                    return keys.every(k => String(after[k]) === String(before[k]));
                }""")
                check("a blank field does not erase a stored nameplate value", kept, True)

            # =============================================================
            # 2. Readings before rating, and the auto-advance that depends on it
            # =============================================================
            order = await hv.evaluate("""() => {
                const card = document.querySelector('.tech-check-card.open .tech-check-body');
                if (!card) return null;
                const kids = Array.from(card.children);
                const rating = kids.findIndex(k => k.classList.contains('tech-rating'));
                const reading = kids.findIndex(k => k.classList.contains('tech-reading-fields')
                                                 || k.querySelector('[data-reading]'));
                return { rating, reading };
            }""")
            if order and order["rating"] >= 0 and order["reading"] >= 0:
                check("the readings come before the rating in the card",
                      order["reading"] < order["rating"], True)
            else:
                note("open card layout", order)

            # v0.9.17 removed the OS keyboard from the protocol entirely: a
            # reading is a button that opens an in-app number pad. The old
            # assertion here was that the fields sat in a <form> so iOS would
            # offer Next/Previous between them -- which was the right fix for
            # a screen that no longer exists.
            pads = await hv.locator(".tech-check-card.open [data-answer-keypad]").count()
            typed = await hv.locator(".tech-check-card.open input[type=number]").count()
            check("readings are entered on the in-app number pad", pads > 0, True)
            check("and there is no OS keyboard left in the protocol", typed, 0)
            await hv.click(".tech-check-card.open [data-answer-keypad]")
            await hv.wait_for_timeout(300)
            check("the number pad opens", await hv.locator("#tech-keypad:not([hidden])").count(), 1)
            # Only the keys actually on screen. The pad has two key blocks now --
            # digits and letters -- and the hidden one measures 0x0, which is the
            # correct answer for a key that is not there: there is no tap target
            # to be too small. Measuring it failed the 44px rule on a build whose
            # 44px rule was fine.
            keys = await hv.evaluate("""() => {
                const out = [];
                document.querySelectorAll('#tech-keypad .tech-key').forEach(k => {
                    if (k.offsetParent === null) return;
                    const r = k.getBoundingClientRect();
                    if (r.width === 0 && r.height === 0) return;
                    if (r.height < 44) out.push([k.dataset.key, Math.round(r.height)]);
                });
                return out;
            }""")
            check("every key on screen clears 44px", keys, [])

            # THE REGRESSION CAYDEN FOUND: "when i click on refrigeration bin temp
            # to enter a value it opens a keyboard with numbers and letters now."
            #
            # The JavaScript was right -- it set `codes.hidden = true` -- and the
            # stylesheet overruled it, because `.tech-keypad-keys { display: grid }`
            # beats the UA rule behind the `hidden` attribute. So this counts what
            # a technician can SEE rather than trusting the attribute, which is the
            # only version of the check that would have caught it.
            pad_state = await hv.evaluate("""() => {
                const visible = sel => Array.from(document.querySelectorAll(sel))
                    .filter(k => k.offsetParent !== null &&
                                 k.getBoundingClientRect().height > 0).length;
                return {
                    letters: visible('#tech-keypad [data-key]:not([data-key="back"]):not([data-key="done"]):not([data-key="na"])'
                                     .replace('/x/', '')) &&
                             Array.from(document.querySelectorAll('#tech-keypad [data-key]'))
                                  .filter(k => /^[A-Z]$/.test(k.dataset.key) &&
                                               k.offsetParent !== null).length,
                    digits: Array.from(document.querySelectorAll('#tech-keypad [data-key]'))
                                 .filter(k => /^[0-9]$/.test(k.dataset.key) &&
                                              k.offsetParent !== null).length,
                };
            }""")
            note("keys visible on a number field", pad_state)
            check("a number field shows no letter keys at all", pad_state["letters"], 0)
            check("and it does show the ten digits", pad_state["digits"], 10)
            check("an unmeasured reading can be said out loud",
                  await hv.locator('#tech-keypad [data-key="na"]').count(), 1)
            await hv.click('#tech-keypad [data-key="4"]')
            await hv.click('#tech-keypad [data-key="."]')
            await hv.click('#tech-keypad [data-key="2"]')
            shown = await hv.inner_text("#tech-keypad-value")
            check("the pad shows what was tapped", shown.strip(), "4.2")
            await hv.click('#tech-keypad [data-key="done"]')
            await hv.wait_for_timeout(400)
            check("and the value lands on the check",
                  await hv.locator(".tech-check-card.open .tech-keypad-open.filled").count() > 0, True)

            # A trailing decimal point is easy to tap and reads badly on a
            # customer's report -- "38." is not a temperature. It is stripped on
            # the way out of the pad, and a pad holding nothing but punctuation
            # is not an answer at all.
            tidied = await hv.evaluate("""() => {
                const t = window.WILSON_INPUT && window.WILSON_INPUT.tidyReading;
                if (!t) return 'missing';
                return [t('38.'), t('-'), t('.'), t(''), t('-4.2'), t('38')].join('|');
            }""")
            check("a trailing decimal point never reaches the report",
                  tidied, "38||||-4.2|38")

            unlabelled = await hv.evaluate("""() => {
                const bad = [];
                document.querySelectorAll('.tech-check-card.open input, #tech-age, #tech-tier')
                    .forEach(i => {
                        const lab = i.id ? document.querySelector('label[for="' + i.id + '"]') : null;
                        if (!lab && !i.getAttribute('aria-label')) {
                            bad.push(i.id || i.placeholder || i.name || '?');
                        }
                    });
                return bad;
            }""")
            check("every field a technician types into has a real label", unlabelled, [])

            # =============================================================
            # 3. The Complete button says what it is waiting for
            # =============================================================
            btn = await hv.evaluate("""() => {
                const b = document.getElementById('complete-asset');
                return b ? { disabled: b.disabled, text: b.innerText.replace(/\\n/g, ' ') } : null;
            }""")
            check("the Complete button exists", bool(btn), True)
            if btn and btn["disabled"]:
                check("a blocked Complete button still says Complete",
                      "Complete" in btn["text"], True)
                check("and says what is still needed",
                      "Still needed" in btn["text"], True)
                note("button label while blocked", btn["text"])

            # =============================================================
            # 4. A photograph's thumbnail survives the next re-render
            # =============================================================
            # The real path: the file input, its change handler, the store, and
            # the re-render that used to blank the result. Hand-appending a
            # thumbnail node would have tested nothing -- renderChecks rebuilds
            # the card from the draft, which is exactly how the image vanished.
            photo_input = hv.locator("input[data-photo]").first
            await photo_input.set_input_files("/tmp/qa-serial-plate.jpg")
            await hv.wait_for_timeout(1200)
            saved = await hv.evaluate("""() => {
                const label = document.querySelector('[id^=photo-label-]');
                return label ? label.textContent : '';
            }""")
            check("the field tool reports the photograph as saved", "saved" in saved.lower(), True)
            filled = await hv.evaluate("""() => {
                const n = document.querySelector('[data-photo-thumb]');
                return n ? { present: true, hasImg: !!n.querySelector('img') } : { present: false };
            }""")
            check("a thumbnail is rendered for it", filled.get("present"), True)
            check("and it holds the image", filled.get("hasImg"), True)

            # force the re-render that used to blank it
            await hv.evaluate("""() => {
                const b = document.querySelector('.tech-check-card.open [data-quick-rate]');
                if (b) b.click();
            }""")
            await hv.wait_for_timeout(900)
            after = await hv.evaluate("""() => {
                const n = document.querySelector('[data-photo-thumb]');
                return n ? { present: true, hasImg: !!n.querySelector('img') } : { present: false };
            }""")
            check("the thumbnail survives the next re-render", after.get("hasImg"), True)

            # =============================================================
            # 4b. The age picker gets the width of its card
            # =============================================================
            # This measures geometry rather than markup, because the defect it
            # exists for was invisible in the markup: the picker sits in a
            # lifecycle card whose column count is set by three different media
            # queries, and the widest of them wins on a phone. The buttons were
            # all present, all 48px tall, and all correct -- laid out two per row
            # in a 150px column, with the "cannot establish it" escape pushed off
            # the bottom of the screen. Only the rectangles show that.
            ap = await browser.new_page(viewport=PHONE)
            await ap.goto(base + "/tech-maintenance.html?visit=visit_reynolds_spring&household=hh_reynolds",
                          wait_until="networkidle")
            await ap.wait_for_timeout(800)
            undated_id = await ap.evaluate("""() => {
                const s = WilsonStore.load();
                const a = (s.assets || []).find(x => x.householdId === 'hh_reynolds' && !x.installYear);
                return a ? a.id : null;
            }""")
            check("an appliance with no install date is in scope", bool(undated_id), True)
            if undated_id:
                await ap.click('[data-open-asset="%s"]' % undated_id)
                await ap.wait_for_timeout(700)
                geom = await ap.evaluate("""() => {
                    const pick = document.querySelector('#tech-age-picker');
                    const card = document.querySelector('.tech-lifecycle-card');
                    if (!pick || !card) return null;
                    const p = pick.getBoundingClientRect(), c = card.getBoundingClientRect();
                    return { pickWidth: Math.round(p.width), cardWidth: Math.round(c.width) };
                }""")
                note("age picker vs its card", geom)
                check("the picker spans its card rather than one column of it",
                      geom and geom["pickWidth"] >= geom["cardWidth"] - 30, True)
                await ap.evaluate("() => { const d = document.querySelector('[data-age-decade]'); if (d) d.click(); }")
                await ap.wait_for_timeout(400)
                rows = await ap.evaluate("""() => {
                    const btns = Array.from(document.querySelectorAll('[data-age-year]'));
                    const tops = {};
                    btns.forEach(b => {
                        const t = Math.round(b.getBoundingClientRect().top);
                        tops[t] = (tops[t] || 0) + 1;
                    });
                    const counts = Object.values(tops);
                    return { years: btns.length, rows: counts.length,
                             perRow: counts.length ? Math.max.apply(null, counts) : 0 };
                }""")
                note("year buttons", rows)
                check("years fit at least three to a row on a phone",
                      rows["perRow"] >= 3, True)
                check("and the whole decade takes no more than three rows",
                      rows["rows"] <= 3, True)
                # The escape hatch is the point: a technician who cannot
                # establish the age must be able to SAY so, and cannot say it
                # from below the fold of a page they do not know to scroll.
                escape_geom = await ap.evaluate("""() => {
                    const b = document.querySelector('[data-age-unknown]');
                    if (!b) return null;
                    const r = b.getBoundingClientRect();
                    return { top: Math.round(r.top), height: Math.round(r.height),
                             viewport: window.innerHeight,
                             insideCard: Math.round(
                                 r.bottom - document.querySelector('.tech-lifecycle-card').getBoundingClientRect().top) };
                }""")
                note("cannot-establish-it button", escape_geom)
                check("saying the age cannot be established is a real 44px target",
                      escape_geom and escape_geom["height"] >= 44, True)
                check("and it sits within the picker's own card, not far below it",
                      escape_geom and escape_geom["insideCard"] < 420, True)
            await ap.close()

            # =============================================================
            # 5. Touch targets, on the pages a technician actually uses
            # =============================================================
            for label, url in [("field tool", hv_url),
                               ("customer report", base + "/report-view.html?id=report_hist_fridge_3"),
                               ("whole-visit review", base + "/visit-report.html?visit=visit_davenport_completed")]:
                pg = await browser.new_page(viewport=PHONE)
                await pg.goto(url, wait_until="networkidle")
                await pg.wait_for_timeout(900)
                bad = await pg.evaluate(SMALL_TARGETS_JS)
                check("%s: no tap target under 44px tall" % label, bad, [])
                if bad:
                    for b in bad[:6]:
                        note("small target", b)
                gaps = await pg.evaluate("""() => {
                    const tight = [];
                    document.querySelectorAll('.tech-quick-rating.five, .tech-bottom-actions, .footer-nav')
                        .forEach(row => {
                            const kids = Array.from(row.children).filter(k => k.getBoundingClientRect().width);
                            for (let i = 1; i < kids.length; i += 1) {
                                const a = kids[i - 1].getBoundingClientRect();
                                const b = kids[i].getBoundingClientRect();
                                const gap = Math.round(b.left - a.right);
                                if (gap >= 0 && gap < 8) tight.push({row: row.className, gap: gap});
                            }
                        });
                    return tight;
                }""")
                check("%s: adjacent controls are at least 8px apart" % label, gaps, [])
                await pg.close()

            # =============================================================
            # 6. Contrast on the surfaces that were failing
            # =============================================================
            pg = await browser.new_page(viewport={"width": 1280, "height": 1000})
            await pg.goto(base + "/report-view.html?id=report_hist_fridge_3", wait_until="networkidle")
            await pg.wait_for_timeout(900)
            rows = await pg.evaluate(CONTRAST_JS, [".vital-target span", ".report-page-footer span"])
            for r in rows:
                check("report contrast %s >= 4.5:1" % r["sel"], r["ratio"] >= 4.5, True)
                note(r["sel"], "%.2f:1 at %.0fpx" % (r["ratio"], r["px"]))
            await pg.close()

            pg = await browser.new_page(viewport=PHONE)
            await pg.goto(hv_url, wait_until="networkidle")
            await pg.wait_for_timeout(900)
            rows = await pg.evaluate(CONTRAST_JS,
                                     [".field .hint", ".tech-readiness small", ".tech-area-heading p",
                                      ".tech-check-status", ".tech-autosave"])
            for r in rows:
                check("field tool contrast %s >= 4.5:1" % r["sel"], r["ratio"] >= 4.5, True)
                note(r["sel"], "%.2f:1 at %.0fpx" % (r["ratio"], r["px"]))
            small = await pg.evaluate("""() => {
                const out = [];
                document.querySelectorAll('.tech-check-status, .tech-quick-rating.five button span')
                    .forEach(el => { const px = parseFloat(getComputedStyle(el).fontSize);
                                     if (px < 10) out.push({cls: el.className || el.tagName, px: px}); });
                return out;
            }""")
            check("no text in the field tool is under 10px", small, [])

            # the toast is the only channel for a blocked action
            toast = await pg.evaluate("""() => {
                window.WilsonUI ? window.WilsonUI.toast('QA', 'x') : null;
                const r = document.querySelector('.toast-region');
                return r ? { role: r.getAttribute('role'), live: r.getAttribute('aria-live') } : null;
            }""")
            check("the toast region is announced", toast and toast.get("live"), "polite")
            check("and carries a status role", toast and toast.get("role"), "status")
            await pg.close()

            # =============================================================
            # 7. The printed report keeps the numbers behind its charts
            # =============================================================
            pg = await browser.new_page(viewport={"width": 1180, "height": 1400})
            await pg.goto(base + "/report-view.html?id=report_hist_fridge_3", wait_until="networkidle")
            await pg.wait_for_timeout(1200)
            await pg.emulate_media(media="print")
            await pg.wait_for_timeout(300)
            printed = await pg.evaluate("""() => {
                const t = document.querySelector('.trend-table');
                if (!t) return 'none';
                const cs = getComputedStyle(t);
                return cs.display;
            }""")
            check("the trend numbers are not hidden from the printer",
                  printed not in ("none",), True)
            note("trend table display in print", printed)
            await pg.close()

            check("no page errors in the field tool throughout", errors, [])
            await browser.close()

    print()
    if FAILED:
        print("%d FAILURE(S) of %d checks" % (len(FAILED), COUNT))
        for name, got, want in FAILED:
            print("  - %s (got %r, wanted %r)" % (name, got, want))
        return 1
    print("ALL %d FIELD ERGONOMICS CHECKS PASSED" % COUNT)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

#!/usr/bin/env python3
"""
WHAT A CUSTOMER IS ALLOWED TO BE TOLD

Every check here exists because the product said something it could not back
up, or steered toward a replacement, and shipped that way. They are asserted
against the RENDERED page rather than the source, because each of these read
perfectly well in the code.

The rules, in the owner's words: nothing predatory toward replacement sales;
no claim the data cannot support; no invented costs; drafts labelled as
drafts. What follows is those four, made executable.
"""

import asyncio
import json
import pathlib
import socket
import subprocess
import sys
import time

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
KEY = "wilson-maintenance-demo-v07"
FAILED = []
COUNT = 0


def check(name, got, want=True):
    global COUNT
    COUNT += 1
    good = got == want
    if not good:
        FAILED.append((name, got, want))
    print(("  ok    " if good else "  FAIL  ") + name.ljust(62) +
          ("" if good else " got=%r want=%r" % (got, want)))


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


# Phrases that must never reach a customer's report again. Each one shipped.
BANNED = [
    "Replacement Planning",
    "replacement is worth planning for",
    "is costed below",
    "Worth budgeting for",
    "number in mind",
    "rather than in August",
    "in line with its age",
    "has a known cause",
    "&amp;",
]


async def main():
    with Server() as base:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            ctx = await browser.new_context(viewport={"width": 1280, "height": 1000})
            page = await ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # ---------------------------------------------------------------
            # Seed, then read one real report and the compiled review.
            # ---------------------------------------------------------------
            # admin.html loads the store, which is what seeds the demo state;
            # index.html is the marketing page and touches none of it.
            await page.goto(base + "/admin.html", wait_until="networkidle")
            await page.wait_for_timeout(600)
            state = await page.evaluate("() => JSON.parse(localStorage.getItem('%s') || 'null')" % KEY)
            if not state:
                state = await page.evaluate("() => window.WilsonStore.load()")
            reports = state["reports"]
            check("the demo seeds reports to read", len(reports) > 0, True)

            visit_report = next(r for r in reports if r.get("visitId") == "visit_reynolds_h4")
            await page.goto(base + "/report-view.html?id=" + visit_report["id"], wait_until="networkidle")
            await page.wait_for_timeout(900)
            body = await page.inner_text("body")

            for phrase in BANNED:
                check('the report never says "%s"' % phrase, phrase in body, False)

            check("an expected-life figure is labelled a draft",
                  "draft expected life" in body.lower(), True)
            check("the report says whose number the age is",
                  ("invoice" in body.lower()) or ("estimate" in body.lower()), True)
            check('no "Final" status is claimed', "Report status" in body, False)
            check("the report says when it was issued", "Report issued" in body, True)
            check("an ampersand renders as an ampersand",
                  "&amp;" in (await page.content()).replace("&amp;amp;", ""), True)

            # ---------------------------------------------------------------
            # An out-of-range reading must not be styled like a normal one.
            # ---------------------------------------------------------------
            styling = await page.evaluate("""() => {
                const out = [];
                document.querySelectorAll('.vital-card').forEach(card => {
                    const badge = card.querySelector('.badge');
                    if (!badge) return;
                    out.push({ result: badge.textContent.trim(),
                               cls: Array.from(card.classList).find(c =>
                                    ['danger','warning','success','info'].includes(c)) || null });
                });
                return out;
            }""")
            for row in styling:
                r = row["result"].lower()
                if "above range" in r or "below range" in r:
                    check('"%s" is flagged, not neutral' % row["result"], row["cls"], "danger")
                elif "high side" in r:
                    check('"%s" is a warning' % row["result"], row["cls"], "warning")
                elif r == "in range":
                    check('"In range" reads as good', row["cls"], "success")
            check("at least one banded reading was on the report",
                  any("range" in s["result"].lower() for s in styling), True)

            # ---------------------------------------------------------------
            # A "not applicable" check must not become a customer finding.
            # ---------------------------------------------------------------
            # The demo seeds finished reports, not in-progress field
            # inspections, so the inspection this case needs is built the way
            # the field tool builds one and saved through the store.
            made = await page.evaluate("""() => {
                const s = window.WilsonStore.load();
                const report = s.reports.find(r => r.visitId === 'visit_reynolds_h4');
                const naName = 'Vent & utility connection';
                const insp = {
                    visitId: report.visitId, assetId: report.assetId,
                    householdId: report.householdId, technician: 'QA',
                    inspectionDate: report.inspectionDate,
                    serialPhoto: 'ph_qa', complete: true,
                    score: 88, grade: 'B', condition: 'Good',
                    vitalScore: 88, ageScore: 80, expectedYears: 20,
                    ageResolved: 5, tier: 'luxury', lifeStage: 'Early life',
                    checks: [
                        { id: 'c1', name: 'Compartment temperature performance',
                          rating: 5, performed: true, note: '' },
                        { id: 'c2', name: naName, rating: 0, performed: true,
                          notApplicable: true, note: 'No vent on this machine' }
                    ]
                };
                window.WilsonStore.saveTechInspection(insp);
                const res = window.WilsonStore.generateReportFromTechInspection(insp.visitId, insp.assetId);
                return res.ok ? { id: res.report.id, name: naName } : { error: res.message };
            }""")
            check("a report regenerates from a field inspection", bool(made and made.get("id")), True)
            if made and made.get("id"):
                after = await page.evaluate("""(id) => {
                    const s = window.WilsonStore.load();
                    const r = s.reports.find(x => x.id === id);
                    return { rec: r.recommendations, corr: r.correctiveMeasures,
                             summary: r.summary,
                             na: r.checkpoints.filter(c => c.notApplicable).map(c => c.status) };
                }""", made["id"])
                check("an N/A check is not a recommendation",
                      made["name"] in (after["rec"] or ""), False)
                check("an N/A check is not a corrective measure",
                      made["name"] in json.dumps(after["corr"] or []), False)
                check("an N/A check does not claim follow-up is needed",
                      "need follow-up" in (after["summary"] or ""), False)
                check("an N/A check prints as not applicable",
                      after["na"], ["Not applicable"])

            # ---------------------------------------------------------------
            # An HVAC system that could not be measured is not a 0%.
            # ---------------------------------------------------------------
            unscored = await page.evaluate("""() => {
                const KEY = 'wilson-maintenance-demo-v07';
                const s = JSON.parse(localStorage.getItem(KEY));
                const r = s.reports[0];
                const copy = JSON.parse(JSON.stringify(r));
                copy.id = 'report_unscored_qa';
                copy.score = null;
                copy.scoreUnavailableReason =
                  'Only 40% of this system could be evaluated against its design, which is not enough for a health score.';
                copy.lifecycle.ageScore = null;      // how an HVAC score is marked
                copy.lifecycle.vitalScore = null;
                s.reports.unshift(copy);
                localStorage.setItem(KEY, JSON.stringify(s));
                return copy.id;
            }""")
            await page.goto(base + "/report-view.html?id=" + unscored, wait_until="networkidle")
            await page.wait_for_timeout(800)
            u = await page.inner_text("body")
            cover_score = await page.inner_text(".report-cover-score strong")
            check("an unmeasurable system does not print a score of 0",
                  cover_score.strip(), "Not scored")
            check("it says it was not scored", "Not scored" in u, True)
            check("it says why", "40%" in u, True)
            check("and it does not claim age was scored into it",
                  "lifecycle age (25%)" in u, False)
            check("the explanation says there is no score rather than explaining a 0",
                  "There is no score on this report" in u, True)

            # the same record on the compiled review
            await page.evaluate("""(id) => {
                const KEY = 'wilson-maintenance-demo-v07';
                const s = JSON.parse(localStorage.getItem(KEY));
                const r = s.reports.find(x => x.id === id);
                r.visitId = 'visit_reynolds_h4';
                localStorage.setItem(KEY, JSON.stringify(s));
            }""", unscored)
            await page.goto(base + "/visit-report.html?visit=visit_reynolds_h4", wait_until="networkidle")
            await page.wait_for_timeout(1400)
            review = await page.inner_text("body")
            check("the review calls an unscored unit unscored, not failing",
                  "Not scored" in review, True)
            check("the review does not band it as needing attention on a null score",
                  await page.evaluate("""() => {
                      const rows = Array.from(document.querySelectorAll('.attention-item'));
                      return rows.some(r => /Not scored/i.test(r.textContent));
                  }"""), False)
            for phrase in BANNED:
                check('the review never says "%s"' % phrase, phrase in review, False)

            # ---------------------------------------------------------------
            # A filter with no due date must not be reported as "not due".
            # ---------------------------------------------------------------
            await page.evaluate("""() => {
                const KEY = 'wilson-maintenance-demo-v07';
                const s = JSON.parse(localStorage.getItem(KEY));
                const f = (s.filters || []).find(x => x.householdId === 'hh_reynolds');
                if (f) { f.nextDueOn = ''; }
                localStorage.setItem(KEY, JSON.stringify(s));
            }""")
            await page.goto(base + "/visit-report.html?visit=visit_reynolds_h4", wait_until="networkidle")
            await page.wait_for_timeout(1200)
            filters_text = await page.inner_text("body")
            check("a filter with no due date is reported as having none",
                  "no due date on record" in filters_text, True)

            # ---------------------------------------------------------------
            # The live score in the field, before anything has been measured.
            # ---------------------------------------------------------------
            # This is the customer-facing number's first draft, and it shipped
            # wrong: an average over zero answered checks fell back to 0, the
            # age term carried the whole weight, and opening a twelve-year-old
            # appliance showed "16 · F" before the technician had touched it.
            # A grade is a claim; it waits for evidence.
            fld = await ctx.new_page()
            fld_errors = []
            fld.on("pageerror", lambda e: fld_errors.append(str(e)))
            await fld.goto(base + "/tech-maintenance.html?visit=visit_davenport&household=hh_davenport",
                           wait_until="networkidle")
            await fld.wait_for_timeout(700)
            tile = await fld.evaluate("() => { const t = document.querySelector('[data-open-asset]'); return t ? t.dataset.openAsset : null; }")
            check("an appliance can be opened in the field tool", bool(tile), True)
            if tile:
                await fld.click('[data-open-asset="%s"]' % tile)
                await fld.wait_for_timeout(800)
                fresh = await fld.evaluate("""() => ({
                    number: (document.getElementById('tech-score-number') || {}).textContent,
                    grade: (document.getElementById('tech-score-grade') || {}).textContent,
                    detail: (document.getElementById('tech-score-detail') || {}).textContent,
                })""")
                print("      live score before any measurement:", json.dumps(fresh))
                check("no number is shown before anything is measured",
                      (fresh["number"] or "").strip() in ("–", "—", "-", ""), True)
                check("and no letter grade is claimed either",
                      any(g in (fresh["grade"] or "") for g in (" A", " B", " C", " D", " F")), False)
                check("the caption says nothing has been measured",
                      "nothing has been measured" in (fresh["detail"] or "").lower(), True)
                check("it does not describe a calculation it did not do",
                      "current vitals (0)" in (fresh["detail"] or ""), False)

                # And once one check is answered, the number appears and says
                # how much of the protocol it rests on -- a score from 1 of 5
                # checks must not read like a finished one.
                answered = await fld.evaluate("""async () => {
                    const card = document.querySelector('.tech-check-card.open');
                    if (!card) return 'no card';
                    const pads = card.querySelectorAll('[data-answer-keypad]');
                    for (const pad of pads) {
                        pad.click();
                        await new Promise(r => setTimeout(r, 150));
                        document.querySelector('#tech-keypad [data-key="3"]').click();
                        document.querySelector('#tech-keypad [data-key="8"]').click();
                        document.querySelector('#tech-keypad [data-key="done"]').click();
                        await new Promise(r => setTimeout(r, 200));
                    }
                    const c2 = document.querySelector('.tech-check-card.open');
                    const rate = c2 && c2.querySelector('[data-quick-rate]');
                    if (rate) { rate.click(); return 'rated'; }
                    const opt = c2 && c2.querySelector('[data-answer-option]');
                    if (opt) { opt.click(); return 'option'; }
                    return 'reading only';
                }""")
                await fld.wait_for_timeout(700)
                partial = await fld.evaluate("""() => ({
                    number: (document.getElementById('tech-score-number') || {}).textContent,
                    detail: (document.getElementById('tech-score-detail') || {}).textContent,
                })""")
                print("      after one answer (%s):" % answered, json.dumps(partial))
                check("a partial score says how much of the protocol it rests on",
                      "scoring checks so far" in (partial["detail"] or ""), True)
            check("no page errors in the field tool either", fld_errors, [])
            await fld.close()

            check("no page errors through any of it", errors, [])
            await ctx.close()
            await browser.close()

    print()
    if FAILED:
        print("%d FAILURE(S) of %d checks" % (len(FAILED), COUNT))
        for name, got, want in FAILED:
            print("  - %s (got %r, wanted %r)" % (name, got, want))
        return 1
    print("ALL %d REPORT HONESTY CHECKS PASSED" % COUNT)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

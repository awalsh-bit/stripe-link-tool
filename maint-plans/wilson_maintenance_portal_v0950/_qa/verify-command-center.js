/*
 * TWO SCREENS, NOT EIGHT TABS
 *
 * Cayden: "im still not in love with the command center and the menu above it."
 *
 * The measurements said why. The dashboard carried eight tabs, and the seed data
 * showed what three of them held: the Filters tab was a five-column table of
 * FOUR ROWS, Activity was FOUR ENTRIES, and Plan Setup had no data on it at all
 * -- it restated plan-config.js as prose. All three were global copies of panels
 * household.html already has, where they are about somebody rather than about
 * everybody.
 *
 * So the tool is two screens: admin.html is what needs doing, customers.html is
 * who Wilson serves. These checks defend the split:
 *
 *   1. NO TAB RAIL, and nothing linking into one.
 *   2. THE QUEUE SUMMARISES ITSELF. The stat bar is generated from the stage
 *      list, so it cannot fall behind the queue it describes.
 *   3. NOTHING THE READER CANNOT ACT ON. A queue item nobody at that screen can
 *      resolve is how a queue teaches people to stop reading it.
 *   4. EVERY THRESHOLD IS CONFIG. The 14s and 30s were literals in a screen file.
 *
 * Run: node _qa/verify-command-center.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
let backing = {};
global.window = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null; },
  setItem: function (k, v) { backing[k] = String(v); },
  removeItem: function (k) { delete backing[k]; }
};
eval(fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8"));
eval(fs.readFileSync(path.join(ROOT, "assets", "store.js"), "utf8"));

const config = window.WILSON_CONFIG;
let checks = 0;
const failures = [];

function check(label, got, want) {
  checks += 1;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures.push(label + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
  console.log((ok ? "ok   " : "FAIL ") + label.padEnd(70) + (ok ? "" : " " + JSON.stringify(got)));
}
function note(label, value) {
  console.log("     " + label.padEnd(70) + " " +
              (typeof value === "string" ? value : JSON.stringify(value)));
}

const adminHtml = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(ROOT, "assets", "admin.js"), "utf8");
const customersHtml = fs.readFileSync(path.join(ROOT, "customers.html"), "utf8");
const customersJs = fs.readFileSync(path.join(ROOT, "assets", "customers.js"), "utf8");
const storeJs = fs.readFileSync(path.join(ROOT, "assets", "store.js"), "utf8");
const uiJs = fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8");
const INTERNAL_PAGES = ["admin.html", "customers.html", "invoice-import.html",
                        "household.html", "quote-view.html", "report-view.html"];

/* ========================================================================== */
console.log("=== the tabs are gone, and nothing points at one ===");
check("admin.html has no tab rail", /data-tab-target/.test(adminHtml), false);
check("and no tab panels", /class="tab-panel/.test(adminHtml), false);
/* A link to admin.html#quotes silently lands on the queue and looks broken. */
const dangling = INTERNAL_PAGES.concat(["assets/ui.js", "assets/tech-maintenance.js"])
  .filter(function (f) { return fs.existsSync(path.join(ROOT, f)); })
  .map(function (f) {
    const hits = (fs.readFileSync(path.join(ROOT, f), "utf8").match(/admin\.html#[a-z]+/g) || []);
    return hits.length ? f + " -> " + hits.join(",") : null;
  }).filter(Boolean);
check("nothing links to a retired tab anchor", dangling, []);
check("the retired quote builder is still gone",
      fs.existsSync(path.join(ROOT, "quote-builder.html")), false);
/* The importer moved off the dashboard; a page whose job is "what needs doing"
   should not also contain an 86-line upload-and-review flow. */
check("the invoice importer has its own page",
      fs.existsSync(path.join(ROOT, "invoice-import.html")), true);
check("and is not embedded in the dashboard", /invoice-dropzone/.test(adminHtml), false);

/* ========================================================================== */
console.log("\n=== the second screen exists and is reachable ===");
check("customers.html ships", fs.existsSync(path.join(ROOT, "customers.html")), true);
check("the header offers both screens",
      /internalLink\("admin\.html"/.test(uiJs) && /internalLink\("customers\.html"/.test(uiJs), true);
check("and marks the one you are on",
      /aria-current="page"/.test(uiJs), true);
/* The chrome Cayden did not like: a decorative pencil, and two spans naming
   other Wilson tools that looked like navigation and went nowhere. */
check("the decorative pencil glyph is gone", /header-edit/.test(uiJs), false);
check("the dead tool rail is gone", /tool-rail|tool-card/.test(uiJs), false);
/* Both new pages must be offline-available like every other page. */
const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
["customers.html", "invoice-import.html", "assets/customers.js"].forEach(function (asset) {
  check("the service worker caches " + asset, sw.indexOf('"' + asset + '"') >= 0, true);
});

/* ========================================================================== */
console.log("\n=== the queue summarises itself ===");
/*
 * The stat bar used to be four buttons hardcoded in admin.html whose ids had
 * drifted from their contents -- `hero-filter-count` displayed the charge count,
 * and one of them changed meaning at zero. Generating it from the stage list is
 * what makes that unrepresentable.
 */
check("the stat bar is rendered, not hardcoded",
      /id="ops-bar-stats"[^>]*><\/div>/.test(adminHtml), true);
check("from a declared stage order", /const STAGE_ORDER = \[/.test(adminJs), true);
check("and its counts come from the assembled queue",
      /function paintStatBar\(queue\)/.test(adminJs), true);
/* Matched as MARKUP and LOOKUPS, not as text anywhere in the file. The first
   version of this check searched the raw source and flagged the comments that
   explain why these ids were removed -- a test that cannot tell an identifier
   from a sentence about an identifier. */
const heroIdPattern = /(?:id="|getElementById\(")hero-(?:filter|payment|due|report)-count/;
check("the drifted hero ids are gone from markup and lookups",
      heroIdPattern.test(adminHtml) || heroIdPattern.test(adminJs), false);
/* Every stage in the order must exist in the table, or the bar renders a button
   with no label. */
const orderMatch = adminJs.match(/const STAGE_ORDER = \[([^\]]+)\]/);
const order = orderMatch ? orderMatch[1].split(",").map(function (s) { return s.trim().replace(/["']/g, ""); }) : [];
const declared = (adminJs.match(/^\s{4}(\w+):\s*\{ label:/gm) || [])
  .map(function (l) { return l.trim().split(":")[0]; });
note("stage order", order.join(" → "));
check("every ordered stage is a declared stage",
      order.filter(function (s) { return declared.indexOf(s) < 0; }), []);
check("and every declared stage is ordered",
      declared.filter(function (s) { return order.indexOf(s) < 0; }), []);
/* The Filters tab retired, so its one piece of real work had to land here. */
check("filters due became a queue stage", order.indexOf("filters") >= 0, true);
check("quotes gone quiet became one too", order.indexOf("quotes") >= 0, true);
/*
 * AND WHAT DELIBERATELY DID NOT. A household with no water test is a real gap,
 * but nobody sitting at a desk can test the water -- the technician's visit
 * screen already asks. An item the reader cannot action belongs on the customer
 * list as a filter, which is where it went.
 */
check("'no water test' is not a queue stage nobody can clear",
      order.indexOf("no_water") >= 0 || /stage: "water/.test(adminJs), false);
check("it is a customer-list filter instead",
      /id: "no_water"/.test(customersJs), true);

/* ========================================================================== */
console.log("\n=== thresholds are policy, not literals in a screen ===");
const ops = config.operations;
check("the operations block exists", typeof ops, "object");
["chargeWindowDays", "quoteStaleAfterDays", "upcomingPreviewCount"]
  .forEach(function (key) {
    check("  " + key + " is configured", typeof ops[key], "number");
  });
/* The charge window was `days >= -14 && days <= 14` in the screen file. */
check("the charge window reads from config",
      /-OPS\.chargeWindowDays/.test(adminJs), true);
check("no bare 14-day charge window survives in the screen",
      /days >= -14 && days <= 14/.test(adminJs), false);

/* ========================================================================== */
console.log("\n=== filters mean verification, not due dates ===");
/*
 * Cayden (v0.9.49): "i dont feel like filters due is usable for the office.
 * filters would always be replaced during maintenance... instead [it should
 * be] verifying what type of filter goes with what icemaker or filter."
 * The queue stage keys on the record's `verified` boolean, both screens say
 * "verify", and the due-date window is gone from config so it cannot creep
 * back into a screen.
 */
check("filterDueSoonDays is retired from config", typeof ops.filterDueSoonDays, "undefined");
check("no screen still reads it",
      /filterDueSoonDays/.test(adminJs) || /filterDueSoonDays/.test(customersJs), false);
check("the queue stage keys on the verified flag", /f\.verified/.test(adminJs), true);
check("the stage is labeled as verification work", /Filter verification/.test(adminJs), true);
check("the card deep-links Filter Finder with the unit's identity",
      /filter-finder\.html/.test(adminJs) && /brand=/.test(adminJs) && /serial=/.test(adminJs), true);
check("marking verified goes through the store, one implementation",
      /markFilterVerified/.test(adminJs) && /function markFilterVerified/.test(storeJs), true);
check("a verification cannot be recorded without a part number",
      /A verification needs the confirmed part number/.test(adminJs), true);
check("new registrations land unverified by construction",
      /verified: false/.test(storeJs), true);
check("the customer list flags filters to verify, not filters due",
      /filters_verify/.test(customersJs) && /filters_due/.test(customersJs) === false, true);
check("the Filter Finder page ships in the portal",
      fs.existsSync(path.join(ROOT, "filter-finder.html")), true);

/* ========================================================================== */
console.log("\n=== trending down is the customer's page, not the office's ===");
/*
 * Cayden: "Let's get rid of appliances trending down on the back end. I'm
 * not sure there's really anything actionable our in house team can do with
 * that." The block is gone from the command center; decline detection
 * itself must survive, because reports and household files are where the
 * customer sees the story.
 */
check("the decline block is gone from the command center",
      /decline-block/.test(adminHtml) || /Appliances trending down/.test(adminHtml.replace(/<!--[\s\S]*?-->/g, "")), false);
check("admin.js no longer renders declines", /renderDeclines\(\)/.test(adminJs), false);
check("decline detection itself survives for reports",
      fs.existsSync(path.join(ROOT, "assets", "trend-analysis.js")), true);
check("the household page still surfaces it",
      /WILSON_TRENDS/.test(fs.readFileSync(path.join(ROOT, "assets", "household.js"), "utf8")), true);

/* ========================================================================== */
console.log("\n=== the customer list ===");
/* A prospect is a customer Wilson does not have yet, and keeping them on a
   separate screen is how a sent quote gets forgotten. */
check("open quotes appear alongside households", /kind: "quote"/.test(customersJs), true);
/* An ACCEPTED quote is that household, and listing both double-counts them. */
check("but a converted quote is not listed twice",
      /filter\(\(q\) => !q\.householdId\)/.test(customersJs), true);
check("the list offers filters, not only a search box",
      /data-customer-filter/.test(customersHtml + customersJs), true);
/* A draft nobody sent is waiting on Wilson, so calling it "quiet" would blame
   the customer for Wilson's inbox. */
/* Both files must gate "quiet" on the status being Sent, but they express it
   differently -- customers.js compares `=== "Sent"`, admin.js early-returns on
   `!== "Sent"`. Requiring one exact form was the test insisting on a spelling
   rather than a rule. */
const sentGuard = /status[^;]{0,40}[!=]==\s*"Sent"/;
check("only a SENT quote can be counted as quiet, on both screens",
      [sentGuard.test(customersJs), sentGuard.test(adminJs)], [true, true]);

/* ========================================================================== */
console.log("\n=== the household page still holds what the tabs did ===");
/*
 * This is the check that makes retiring three tabs safe rather than lossy: the
 * per-household versions have to exist, or capability left with the tab.
 */
const householdHtml = fs.readFileSync(path.join(ROOT, "household.html"), "utf8");
[["household-filter-list", "filters"],
 ["report-history-body", "report history"],
 ["household-activity-list", "activity"]].forEach(function (pair) {
  check("the household page still has its " + pair[1],
        householdHtml.indexOf('id="' + pair[0] + '"') >= 0, true);
});

console.log("");
if (failures.length) {
  console.log(failures.length + " FAILURE(S) of " + checks + " checks:");
  failures.forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
}
console.log("ALL " + checks + " COMMAND CENTER CHECKS PASSED");

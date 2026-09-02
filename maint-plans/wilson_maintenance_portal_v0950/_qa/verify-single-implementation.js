/*
 * ONE IMPLEMENTATION PER RULE.
 *
 * This project's worst bugs have all been the same bug: two pieces of code
 * answering one question, drifting apart, and nobody noticing until a customer
 * saw the difference. Two pricing engines quoted $350 apart. Two water
 * resolvers disagreed about the same house. Two badge rules mislabelled a paid
 * charge. A second expected-life table scored 23 of 25 seeded appliances
 * against numbers the product does not use.
 *
 * A dead second implementation is not safe -- it is a live one that nobody has
 * called yet. Every check here fails if a second answer comes back.
 *
 * Run: node _qa/verify-single-implementation.js
 */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
/* Comments describe code; they are not code. Three checks in this project have
   passed or failed on a comment before, so every source check strips them. */
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log((ok ? "ok  " : "FAIL") + "  " + label.padEnd(70) + (detail === undefined ? "" : detail));
}

const store = code("assets/store.js");
const config = code("assets/plan-config.js");

console.log("--- completing a visit ---");
check("there is no second way to complete a visit",
  !/function markVisitCompleted/.test(store), "");
check("...and nothing is exported under that name",
  !/markVisitCompleted/.test(store), "");
/* The one real path still has to exist, or this check passes by deleting both. */
check("the real completion path is still there",
  /function refreshVisitReportStatusInState/.test(store) &&
  /status\s*=\s*"Completed"/.test(store), "");

console.log("\n--- expected life ---");
check("the seed does not carry its own expected-life table",
  !/expectedYears:\s*\d+/.test(store), (store.match(/expectedYears:\s*\d+/g) || []).join(","));
check("the seed does not carry its own tier column",
  !/\btier:\s*"(luxury|premium|mass)"/.test(store),
  (store.match(/\btier:\s*"(luxury|premium|mass)"/g) || []).join(","));
check("both the report and the field card resolve life through WILSON_WATER",
  /WILSON_WATER\.expectedLife/.test(store) &&
  /expectedLife/.test(code("assets/tech-maintenance.js")), "");

console.log("\n--- the stale protocol tables ---");
check("measurementSets is gone", !/measurementSets:/.test(config), "");
check("maintenanceTasks is gone", !/maintenanceTasks:/.test(config), "");
/* And what replaced them is present, so this cannot pass by deleting the lot. */
check("readings are declared per checkpoint instead", /readingFields:/.test(config), "");
check("maintenance work is a kind of answer instead", /id:\s*"maintenance",\s*label:\s*"Maintenance performed",\s*scores:\s*false/.test(config), "");

console.log("\n--- nothing reads what was removed ---");
const SURFACES = fs.readdirSync(path.join(ROOT, "assets")).filter((f) => f.endsWith(".js"));
["measurementSets", "maintenanceTasks", "markVisitCompleted"].forEach(function (name) {
  const users = SURFACES.filter(function (f) { return new RegExp("\\b" + name + "\\b").test(code("assets/" + f)); });
  check("no surface references " + name, users.length === 0, users.join(",") || "none");
});

console.log("\n--- dead element lookups ---");
const householdJs = code("assets/household.js");
const householdHtml = read("household.html");
const ids = (householdJs.match(/getElementById\("([a-z0-9-]+)"\)/g) || [])
  .map(function (m) { return m.match(/"([a-z0-9-]+)"/)[1]; });
/* An id can come from the static page OR from markup this script writes into
   it. Both count; only an id that exists in neither is a lookup that always
   returns null -- which is what the two removed billing lookups were. */
const orphans = ids.filter(function (i) {
  return householdHtml.indexOf('id="' + i + '"') === -1 && householdJs.indexOf('id="' + i + '"') === -1;
});
check("every getElementById on the household page resolves to a real element",
  orphans.length === 0, orphans.join(",") || ids.length + " checked, all present");
/* The check has to be able to see one. */
check("...and it would catch a lookup for an element that does not exist",
  ["household-billing-type", "save-household-billing"].every(function (i) {
    return householdHtml.indexOf('id="' + i + '"') === -1 && householdJs.indexOf('id="' + i + '"') === -1;
  }), "the removed billing controls are absent from both");

console.log("");
if (fail) { console.log("FAILURES: " + fail); process.exit(1); }
console.log("ALL SINGLE-IMPLEMENTATION CHECKS PASSED");

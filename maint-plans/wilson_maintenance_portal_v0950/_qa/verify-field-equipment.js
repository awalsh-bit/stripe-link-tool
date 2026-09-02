/*
 * A CORRECTION AND A REPLACEMENT ARE NOT THE SAME THING
 *
 * Cayden: "the tech needs to be able to easily edit the pre filled info just in
 * case its wrong. it wouldn't be surprising to me if i got sent to do
 * maintenance on appliances the customer bought 6 years ago from us, but maybe
 * they replaced the dishwasher in between with someone else. if the tech walks
 * up to the dw in this instance and its different than what the tech tool is
 * showing, they should be able to switch the details easily in the field."
 *
 * WHAT THIS SUITE IS FENCING
 * -------------------------
 *   1. TWO ACTIONS, TWO OUTCOMES. A correction keeps the appliance's history; a
 *      replacement closes it. One combined "edit brand" button is the natural
 *      thing to build and the wrong thing to have.
 *   2. A CLOSED HISTORY IS NOT A DELETED ONE. The reports stay in the store and
 *      on the household page. What changes is what may be called a TREND --
 *      because the decline block turns a reading into a call to a customer, and
 *      a signal computed across two machines is a call about a problem that does
 *      not exist.
 *   3. THE MACHINE THAT LEFT IS KEPT. Wilson sold the original; that somebody
 *      else replaced it is a fact about the customer worth having.
 *   4. A REPLACEMENT RESETS EVERYTHING ABOUT THE MACHINE. Age, expected life,
 *      provenance, and whether Wilson sold it. A field left blank reads as
 *      unknown, not as the old machine's value.
 *   5. PROVENANCE STAYS HONEST. A technician's correction outranks an invoice
 *      because they were looking at the machine; a replacement's first capture
 *      is not a correction and does not claim to be.
 *   6. THE GUARDRAIL REACHES THE FIELD. Same string as the report and the queue
 *      card -- one rule, three surfaces.
 *
 * Run: node _qa/verify-field-equipment.js
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
eval(fs.readFileSync(path.join(ROOT, "assets", "trend-analysis.js"), "utf8"));

const config = window.WILSON_CONFIG;
const Store = window.WilsonStore;
const T = window.WILSON_TRENDS;

let checks = 0;
const failures = [];
function check(label, got, want) {
  checks += 1;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures.push(label + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
  console.log((ok ? "ok   " : "FAIL ") + label.padEnd(72) + (ok ? "" : " " + JSON.stringify(got)));
}
function note(label, value) {
  console.log("     " + label.padEnd(72) + " " +
              (typeof value === "string" ? value : JSON.stringify(value)));
}
function fresh() { backing = {}; return Store.load(); }

/* The appliance with the most report history -- the only one where a closed
   trend is observable. */
function mostHistory() {
  const state = Store.load();
  const counts = {};
  state.reports.forEach(function (r) { if (r.assetId) counts[r.assetId] = (counts[r.assetId] || 0) + 1; });
  const top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
  return { assetId: top, reports: counts[top] };
}

/* ========================================================================== */
console.log("=== the pre-filled record, and where each field came from ===");
fresh();

/*
 * The seeded provenance was wrong in a way worth recording: it read `source`
 * only, so a Sub-Zero transcribed from invoice SV0009120 was labelled "as the
 * customer stated". A technician reads that line to decide how hard to look, so
 * understating it is a worse lie than saying nothing.
 */
const invoiced = Store.load().assets.find(function (a) {
  return a.ageSource === "invoice" && a.brand;
});
check("an appliance whose age came off an invoice says its brand did too",
      (invoiced.detailProvenance.brand || {}).source, "invoice");
check("and carries the invoice number",
      (invoiced.detailProvenance.brand || {}).ref, invoiced.ageSourceRef);

const anonymous = Store.load().assets.find(function (a) {
  return a.householdId === "hh_okafor" && !a.brand;
});
check("an appliance nobody has described has no provenance to claim",
      Object.keys(anonymous.detailProvenance || {}), []);

/* ========================================================================== */
console.log("\n=== a correction: same machine, better record ===");
fresh();
const target = mostHistory();
note("appliance under test", target.reports + " reports on file");
const trendBefore = T.forAsset(Store.load(), target.assetId);
check("it has a trend before anything happens", trendBefore.visits, target.reports);

const corrected = Store.correctAssetDetails({
  assetId: target.assetId, technician: "R. Vasquez",
  details: { model: "BI-48SD/O", serial: "SN-FIELD-77" }
});
check("the correction reports what it wrote", [corrected.ok, corrected.written], [true, 2]);

const afterCorrect = Store.load().assets.find(function (a) { return a.id === target.assetId; });
check("the fields changed", [afterCorrect.model, afterCorrect.serial], ["BI-48SD/O", "SN-FIELD-77"]);
check("and now credit the technician, not the invoice",
      [afterCorrect.detailProvenance.model.source, afterCorrect.detailProvenance.model.ref],
      ["tech", "R. Vasquez"]);
/*
 * THE POINT OF THE SPLIT. A correction is a claim about the record, not about
 * the machine, so nothing about the history moves.
 */
check("no lineage break is recorded", afterCorrect.lineageStartedAt, "");
check("nothing is filed as a retired machine", (afterCorrect.replacedMachines || []).length, 0);
check("and the trend is exactly as it was",
      T.forAsset(Store.load(), target.assetId).visits, trendBefore.visits);
check("a blank field in a correction leaves the value alone",
      (function () {
        Store.correctAssetDetails({ assetId: target.assetId, technician: "R. Vasquez",
                                    details: { model: "", serial: "   " } });
        const a = Store.load().assets.find(function (x) { return x.id === target.assetId; });
        return [a.model, a.serial];
      })(), ["BI-48SD/O", "SN-FIELD-77"]);
check("an unknown appliance is refused", Store.correctAssetDetails({ assetId: "nope" }).ok, false);

/* ========================================================================== */
console.log("\n=== a replacement: a different machine in the same place ===");
fresh();
const t2 = mostHistory();
const before = Store.load().assets.find(function (a) { return a.id === t2.assetId; });
const trendWas = T.forAsset(Store.load(), t2.assetId);
note("before", before.brand + " " + before.model + ", " + trendWas.visits + " visits, " +
     trendWas.signals.length + " signals");

const replaced = Store.replaceAssetMachine({
  assetId: t2.assetId, technician: "R. Vasquez",
  details: { brand: "Miele", model: "KWT6322UG", installYear: 2024 }
});
check("the replacement is accepted", replaced.ok, true);

const now = Store.load().assets.find(function (a) { return a.id === t2.assetId; });
check("the machine is different", [now.brand, now.model], ["Miele", "KWT6322UG"]);
check("its age starts again", [now.installYear, now.ageSource], [2024, "tech"]);
/*
 * A field the technician left blank must read as UNKNOWN, not as the old
 * machine's value. Carrying the Sub-Zero's serial onto a Miele would be the
 * quietest wrong answer in the whole tool.
 */
check("a blank field reads as unknown, not as the machine that left", now.serial, "");
check("and no stale provenance survives for it", Boolean((now.detailProvenance || {}).serial), false);
check("what was captured is marked as a new record, not a correction",
      now.detailProvenance.brand.source, "tech_new");
check("it is no longer something Wilson sold", [now.sourceInvoice, now.source], ["", "tech"]);

/* THE CHECK THIS WHOLE FEATURE EXISTS FOR. */
check("the trend history is closed", T.forAsset(Store.load(), t2.assetId), null);
check("but every report is still stored",
      Store.load().reports.filter(function (r) { return r.assetId === t2.assetId; }).length, t2.reports);
check("and the appliance is gone from the decline list it was on",
      T.decliningAppliances(Store.load()).filter(function (d) { return d.assetId === t2.assetId; }).length, 0);
check("the lineage date is what does it",
      Boolean(now.lineageStartedAt) && now.lineageStartedAt.length === 10, true);

check("the machine that left is kept, not overwritten",
      [now.replacedMachines.length, now.replacedMachines[0].brand, now.replacedMachines[0].model],
      [1, before.brand, before.model]);
check("along with whether Wilson had sold it",
      typeof now.replacedMachines[0].soldByWilson, "boolean");
check("and who retired it, and when",
      [now.replacedMachines[0].retiredBy, now.replacedMachines[0].retiredAt.length],
      ["R. Vasquez", 10]);

check("a replacement with no brand and no model is refused",
      Store.replaceAssetMachine({ assetId: t2.assetId, details: { serial: "S1" } }).ok, false);

/* A second replacement stacks rather than replacing the first record of one. */
Store.replaceAssetMachine({ assetId: t2.assetId, technician: "R. Vasquez",
                            details: { brand: "Bosch", model: "B36CT80SNS" } });
check("replacing twice keeps both machines that left",
      Store.load().assets.find(function (a) { return a.id === t2.assetId; })
        .replacedMachines.map(function (m) { return m.brand; }), [before.brand, "Miele"]);

/* ========================================================================== */
console.log("\n=== the expected life follows the machine ===");
/*
 * A different brand is a different expected life, and expected life is 25% of
 * the appliance score. If the figure did not move, the new machine would be
 * scored against the old one's lifespan.
 */
fresh();
const t3 = mostHistory();
const asset3 = Store.load().assets.find(function (a) { return a.id === t3.assetId; });
const B = window.WILSON_BRANDS, W = window.WILSON_WATER;
const lifeBefore = W.expectedLife(asset3.checkpointSet, B.tierFor(asset3.brand), null,
  { brand: asset3.brand, line: B.lineForAsset(asset3) }).base;
Store.replaceAssetMachine({ assetId: t3.assetId, technician: "R. Vasquez",
                            details: { brand: "Whirlpool", model: "WRX735SDHZ", installYear: 2024 } });
const asset3b = Store.load().assets.find(function (a) { return a.id === t3.assetId; });
const lifeAfter = W.expectedLife(asset3b.checkpointSet, B.tierFor(asset3b.brand), null,
  { brand: asset3b.brand, line: B.lineForAsset(asset3b) }).base;
note("expected life", asset3.brand + " " + lifeBefore + " yr -> " + asset3b.brand + " " + lifeAfter + " yr");
check("it moved with the brand", lifeBefore !== lifeAfter, true);
check("and it is the new brand's own figure",
      lifeAfter, B.lifespanFor({ brand: "Whirlpool", line: B.lineForAsset(asset3b) }, null).years);

/* ========================================================================== */
console.log("\n=== the guardrail reaches the field ===");
fresh();
const t4 = mostHistory();
Store.replaceAssetMachine({ assetId: t4.assetId, technician: "R. Vasquez",
                            details: { brand: "Samsung", model: "RF28R7351SG", installYear: 2023 } });
const flagged = Store.load().assets.find(function (a) { return a.id === t4.assetId; });
const s = B.serviceability(flagged);
check("a brand Wilson does not service is caught on the machine just recorded",
      s.state, "not_serviced");
check("the technician gets their own sentence, not the office's",
      [s.tech.length > 0, s.tech !== s.office], [true, true]);
/*
 * It never stops the visit. Cayden's rule: an appliance comes off a plan, a
 * technician still works, and the office still gets told.
 */
check("and the appliance is still active -- the flag does not remove it",
      flagged.status, "Active");
check("the household gap picks it up so the office hears about it",
      Store.equipmentGaps(flagged.householdId).blockedCount > 0, true);

/* ========================================================================== */
console.log("\n=== the field tool is wired to both, and only to both ===");
const techJs = fs.readFileSync(path.join(ROOT, "assets", "tech-maintenance.js"), "utf8");
const trendJs = fs.readFileSync(path.join(ROOT, "assets", "trend-analysis.js"), "utf8");

check("the card offers exactly two actions",
      (techJs.match(/data-equip-mode="(correct|replace)"/g) || []).sort(),
      ['data-equip-mode="correct"', 'data-equip-mode="replace"']);
check("each calls its own store function, not one shared writer",
      [/replaceAssetMachine\(/.test(techJs), /correctAssetDetails\(/.test(techJs)], [true, true]);
check("the replacement wording tells the technician the history closes",
      /reading history closes|history closes/i.test(techJs), true);
check("and the correction wording tells them it does not",
      /already measured on it stays/i.test(techJs), true);
/*
 * The filter belongs in the trend module, not at each call site: a second caller
 * that forgot it would be a decline block computing across two machines again.
 */
check("trend analysis filters on the lineage date itself",
      /lineageStartedAt/.test(trendJs), true);
check("and both of its entry points go through that filter",
      (trendJs.match(/sinceReplacement\(/g) || []).length >= 3, true);

/* ========================================================================== */
console.log("\n=== mutation tests: every guard above is load-bearing ===");
/*
 * These edit the source, reload the broken copy in a fresh context, and require
 * the property to STOP holding. A guard that can be deleted with every check
 * still passing was decoration.
 */
const vm = require("vm");
const STORE_SRC = fs.readFileSync(path.join(ROOT, "assets", "store.js"), "utf8");
const TREND_SRC = fs.readFileSync(path.join(ROOT, "assets", "trend-analysis.js"), "utf8");
const CONFIG_SRC = fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8");

function loadMutated(which, replace, withText) {
  const src = which === "store" ? STORE_SRC : TREND_SRC;
  if (src.indexOf(replace) === -1) throw new Error("target not found: " + replace.slice(0, 50));
  let store = {}, backingLocal = {};
  const sandbox = {
    window: {}, Date: Date, Number: Number, String: String, Boolean: Boolean,
    Math: Math, JSON: JSON, Object: Object, Array: Array, console: console, isFinite: isFinite,
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(backingLocal, k) ? backingLocal[k] : null; },
      setItem: function (k, v) { backingLocal[k] = String(v); },
      removeItem: function (k) { delete backingLocal[k]; }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(CONFIG_SRC, sandbox);
  vm.runInContext(which === "store" ? src.split(replace).join(withText) : STORE_SRC, sandbox);
  vm.runInContext(which === "trend" ? src.split(replace).join(withText) : TREND_SRC, sandbox);
  return { Store: sandbox.window.WilsonStore, T: sandbox.window.WILSON_TRENDS };
}

let mutations = 0;
const missed = [];
function mutation(label, which, replace, withText, stillHolds) {
  mutations += 1;
  let broken;
  try { broken = loadMutated(which, replace, withText); }
  catch (e) { missed.push(label + " (could not apply: " + e.message + ")");
              console.log("FAIL " + ("caught: " + label).padEnd(72)); return; }
  fresh();
  const realOk = stillHolds({ Store: Store, T: T });
  let brokenOk;
  try { brokenOk = stillHolds(broken); } catch (e) { brokenOk = false; }
  const caught = realOk === true && brokenOk !== true;
  if (!caught) missed.push(label + (realOk ? " (broken copy still passed)" : " (fails on the REAL module)"));
  console.log((caught ? "ok   " : "FAIL ") + ("caught: " + label).padEnd(72));
}

function replaceAndReadTrend(mod) {
  const state = mod.Store.load();
  const counts = {};
  state.reports.forEach(function (r) { if (r.assetId) counts[r.assetId] = (counts[r.assetId] || 0) + 1; });
  const id = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
  mod.Store.replaceAssetMachine({ assetId: id, technician: "T", details: { brand: "Miele", model: "X" } });
  return { id: id, trend: mod.T.forAsset(mod.Store.load(), id) };
}

mutation("the lineage filter removed from trend analysis", "trend",
  "return analyseAppliance(sinceReplacement(state, assetId, reports));",
  "return analyseAppliance(reports);",
  function (mod) { return replaceAndReadTrend(mod).trend === null; });

mutation("the lineage date never set, so nothing closes", "store",
  "asset.lineageStartedAt = today;", "",
  function (mod) { return replaceAndReadTrend(mod).trend === null; });

mutation("the decline list not filtered, so a replaced machine still declines", "trend",
  "byAsset[assetId] = sinceReplacement(state, assetId, byAsset[assetId]);", "",
  function (mod) {
    const r = replaceAndReadTrend(mod);
    return mod.T.decliningAppliances(mod.Store.load())
      .filter(function (d) { return d.assetId === r.id; }).length === 0;
  });

mutation("a replacement carrying the old machine's serial over", "store",
  'asset.serial = String(details.serial || "").trim();',
  'asset.serial = String(details.serial || asset.serial || "").trim();',
  function (mod) {
    /* Nothing is seeded with a serial -- a technician photographs the tag, they
       do not arrive on an invoice -- so one is established first. */
    const a = mod.Store.load().assets.find(function (x) { return x.brand; });
    mod.Store.correctAssetDetails({ assetId: a.id, technician: "T", details: { serial: "SN-OLD-1" } });
    mod.Store.replaceAssetMachine({ assetId: a.id, technician: "T", details: { brand: "Miele", model: "X" } });
    return mod.Store.load().assets.find(function (x) { return x.id === a.id; }).serial === "";
  });

mutation("a correction quietly closing the history too", "store",
  "if (!written && !ageChanged) return { ok: true, written: 0, message: \"Nothing changed.\" };",
  "asset.lineageStartedAt = isoDate(0);\n    if (!written && !ageChanged) return { ok: true, written: 0, message: \"Nothing changed.\" };",
  function (mod) {
    const state = mod.Store.load();
    const counts = {};
    state.reports.forEach(function (r) { if (r.assetId) counts[r.assetId] = (counts[r.assetId] || 0) + 1; });
    const id = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    const was = mod.T.forAsset(mod.Store.load(), id).visits;
    mod.Store.correctAssetDetails({ assetId: id, technician: "T", details: { model: "CORRECTED-1" } });
    const now = mod.T.forAsset(mod.Store.load(), id);
    return Boolean(now) && now.visits === was;
  });

mutation("the machine that left being overwritten instead of kept", "store",
  "if (!Array.isArray(asset.replacedMachines)) asset.replacedMachines = [];",
  "asset.replacedMachines = [];",
  function (mod) {
    const state = mod.Store.load();
    const a = state.assets.find(function (x) { return x.brand; });
    mod.Store.replaceAssetMachine({ assetId: a.id, technician: "T", details: { brand: "Miele", model: "M1" } });
    mod.Store.replaceAssetMachine({ assetId: a.id, technician: "T", details: { brand: "Bosch", model: "M2" } });
    return mod.Store.load().assets.find(function (x) { return x.id === a.id; }).replacedMachines.length === 2;
  });

console.log("");
if (failures.length || missed.length) {
  if (failures.length) {
    console.log(failures.length + " FAILURE(S) of " + checks + " checks:");
    failures.forEach(function (f) { console.log("  - " + f); });
  }
  if (missed.length) {
    console.log(missed.length + " MUTATION(S) NOT CAUGHT of " + mutations + ":");
    missed.forEach(function (f) { console.log("  - " + f); });
  }
  process.exit(1);
}
console.log("ALL " + checks + " FIELD EQUIPMENT CHECKS PASSED (+ " + mutations + " mutations caught)");

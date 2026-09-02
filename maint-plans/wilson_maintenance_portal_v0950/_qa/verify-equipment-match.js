/*
 * AUTO-MATCH WITH CONFIRMATION, AND PARK THE EXTRAS
 *
 * Cayden, asked how invoice lines should meet enrolled appliances:
 * "Auto match with confirmation, park the extras."
 *
 * WHAT THIS SUITE IS FENCING
 * -------------------------
 *   1. NOTHING CROSSES A CATEGORY. A dishwasher line never lands on a
 *      refrigerator slot, whatever the areas say. Category is the one thing
 *      registration actually established.
 *   2. THE PROPOSAL IS STABLE. The same slots and lines produce the same
 *      pairings whatever order they arrive in. An office confirming a screen
 *      that reshuffles between loads is not confirming anything.
 *   3. EXTRAS ARE PARKED, NEVER DROPPED. Wilson sold them. An appliance the
 *      customer did not enroll is the most natural upsell there is, and losing
 *      it silently is the one outcome nobody asked for.
 *   4. A SLOT WITH NO MATCH KEEPS ASKING. Unmatched is a queue item, not a
 *      failure and not a blank filled in with a guess.
 *   5. NOTHING IS OVERWRITTEN QUIETLY. A blank on an invoice never erases a
 *      serial a technician photographed, and a match onto a slot that already
 *      has details is flagged rather than applied.
 *   6. EVERY PROPOSAL SAYS WHY. A confirmation screen that cannot explain its
 *      guess is asking for a rubber stamp.
 *   7. THE GUARDRAIL FIRES HERE. Import is the first moment brand is known, so
 *      it is the first moment an unserviced brand can be caught.
 *
 * Run: node _qa/verify-equipment-match.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
global.window = {};
eval(fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8"));
eval(fs.readFileSync(path.join(ROOT, "assets", "equipment-match.js"), "utf8"));

const M = window.WILSON_MATCH;

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

let seq = 0;
function slot(category, opts) {
  seq += 1;
  return Object.assign({
    id: "asset_" + seq, customerCategory: category, type: category, exactType: category,
    typeLabel: category, location: "", areaId: "", brand: "", model: "", serial: "",
    installYear: "", group: "standard", checkpointSet: category, status: "Active", sortOrder: seq
  }, opts || {});
}
function line(category, opts) {
  return Object.assign({
    customerCategory: category, exactType: category, exactTypeLabel: category,
    brand: "", model: "", serial: "", area: "", quantity: 1,
    invoiceNumber: "SV0000001", installYear: null, description: ""
  }, opts || {});
}
const ids = function (list) { return list.map(function (x) { return x.slotId || x.id || x.unitId; }); };

/* ========================================================================== */
console.log("=== category is the one thing registration established ===");

check("a dishwasher line never lands on a refrigerator slot, however good the area",
      M.propose([slot("refrigeration", { location: "Kitchen" })],
                [line("dishwasher", { area: "Kitchen", brand: "Miele" })]).counts,
      { slots: 1, units: 1, matched: 0, unmatched: 1, extras: 1,
        lowConfidence: 0, wouldOverwrite: 0, excluded: 0 });

check("and the unmatched slot says it is still waiting rather than being filled",
      M.propose([slot("refrigeration")], [line("dishwasher", { brand: "Miele" })])
        .unmatched.length, 1);

/*
 * The bug the category normaliser was added for. A seeded or enrolled slot may
 * carry an appliance TYPE where the parser produces a customer CATEGORY: a slot
 * says `hood`, the invoice says `ventilation`, and the same Wolf hood on both
 * sides never matched. Silent, not an error, and it survived a demo.
 */
check("a slot carrying an appliance type still matches its category on the invoice",
      M.propose([slot("hood", { customerCategory: "hood", type: "hood", exactType: "hood", location: "Kitchen" })],
                [line("ventilation", { exactType: "hood_insert", area: "Kitchen", brand: "Wolf" })]).counts.matched, 1);
check("and a refrigerator slot meets a refrigeration line",
      M.propose([slot("refrigerator", { customerCategory: "refrigerator", type: "refrigerator", exactType: "refrigerator" })],
                [line("refrigeration", { exactType: "refrigerator", brand: "Sub-Zero" })]).counts.matched, 1);
check("but normalising never merges two genuinely different categories",
      M.propose([slot("washer", { customerCategory: "washer" })],
                [line("dryer", { exactType: "dryer" })]).counts.matched, 0);

/* ========================================================================== */
console.log("\n=== the best pairing wins, and says why ===");

const kitchen = slot("refrigeration", { location: "Main Kitchen", exactType: "refrigerator" });
const bar = slot("refrigeration", { location: "Wet Bar", exactType: "wine_beverage" });
const result = M.propose([kitchen, bar], [
  line("refrigeration", { exactType: "wine_beverage", area: "Wet Bar", brand: "Sub-Zero", model: "UW-24" }),
  line("refrigeration", { exactType: "refrigerator", area: "Main Kitchen", brand: "Sub-Zero", model: "BI-48S" })
]);
check("exact type plus area pairs both, each to its own",
      result.matches.map(function (m) { return m.slot.location + " <- " + m.line.model; }),
      ["Main Kitchen <- BI-48S", "Wet Bar <- UW-24"]);
check("and both are high confidence",
      result.matches.map(function (m) { return m.confidence; }), ["high", "high"]);
check("every match carries a reason a person can read",
      result.matches.filter(function (m) { return String(m.why || "").length < 20; }), []);

/*
 * "Main House" on an invoice is not an area. Treating it as one would let a
 * line about the whole property look like a confirmed room match.
 */
check("a generic Main House does not count as an area agreement",
      M.areasAgree("Main Kitchen", "Main House"), false);
check("but Kitchen and Main Kitchen do agree", M.areasAgree("Main Kitchen", "Kitchen"), true);

const noArea = M.propose([slot("dishwasher", { location: "Kitchen" })],
                         [line("dishwasher", { area: "Main House", brand: "Cove" })]);
check("so that match drops to medium, not high",
      [noArea.matches[0].confidence, /no area|different/i.test(noArea.matches[0].why)], ["medium", true]);

const catOnly = M.propose([slot("cooktop", { customerCategory: "cooking", exactType: "cooktop" })],
                          [line("cooking", { exactType: "range", area: "", brand: "Wolf" })]);
check("a category-only pairing is offered but marked low",
      [catOnly.matches.length, catOnly.matches[0].confidence], [1, "low"]);
check("and the low ones are counted, so a screen can warn before somebody clicks",
      catOnly.counts.lowConfidence, 1);

/* ========================================================================== */
console.log("\n=== the same inputs always produce the same pairing ===");
/*
 * The office confirms a screen. If the pairing depended on the order files were
 * dropped, two people looking at the same household would confirm different
 * things, and neither would be wrong.
 */
const slotsA = [slot("refrigeration", { location: "Kitchen", exactType: "refrigerator" }),
                slot("refrigeration", { location: "Pantry", exactType: "refrigerator" })];
const linesA = [line("refrigeration", { exactType: "refrigerator", area: "Pantry", model: "B" }),
                line("refrigeration", { exactType: "refrigerator", area: "Kitchen", model: "A" })];
const forward = M.propose(slotsA, linesA);
const reversed = M.propose(slotsA, linesA.slice().reverse());
check("reversing the invoice order changes nothing",
      forward.matches.map(function (m) { return m.slot.location + "=" + m.line.model; }),
      reversed.matches.map(function (m) { return m.slot.location + "=" + m.line.model; }));
check("and it paired each to its own area",
      forward.matches.map(function (m) { return m.slot.location + "=" + m.line.model; }),
      ["Kitchen=A", "Pantry=B"]);

/* No slot and no line may be used twice -- the failure that would put one
   serial number on two appliances. */
const dup = M.propose([slot("dishwasher"), slot("dishwasher")],
                      [line("dishwasher", { model: "DW2450", quantity: 1 })]);
check("one line cannot fill two slots",
      [dup.counts.matched, dup.counts.unmatched, dup.counts.extras], [1, 1, 0]);

/* ========================================================================== */
console.log("\n=== quantity, and the WashTower that is two appliances ===");

const qty = M.propose([slot("ice_maker"), slot("ice_maker")],
                      [line("ice_maker", { quantity: 2, brand: "Scotsman", model: "CU50" })]);
check("a line for two icemakers fills two slots",
      [qty.counts.matched, qty.counts.extras], [2, 0]);

const qtyOver = M.propose([slot("ice_maker")],
                          [line("ice_maker", { quantity: 3, brand: "Scotsman" })]);
check("three on the invoice against one enrolled is one match and two parked",
      [qtyOver.counts.matched, qtyOver.counts.extras], [1, 2]);

const tower = M.propose([slot("washer"), slot("dryer")],
                        [line("washer_dryer", { brand: "LG", model: "WKEX200HWA" })]);
check("a WashTower line matches the washer AND the dryer",
      tower.matches.map(function (m) { return m.slot.customerCategory; }).sort(), ["dryer", "washer"]);
check("and both carry the same model, because it is one physical product",
      tower.matches.map(function (m) { return m.line.model; }), ["WKEX200HWA", "WKEX200HWA"]);

/* ========================================================================== */
console.log("\n=== extras are parked, never dropped ===");

const estate = M.propose(
  [slot("refrigeration", { location: "Kitchen" }), slot("dishwasher", { location: "Kitchen" })],
  [line("refrigeration", { area: "Kitchen", brand: "Sub-Zero", model: "BI-48S" }),
   line("dishwasher", { area: "Kitchen", brand: "Cove", model: "DW2450" }),
   line("cooking", { area: "Kitchen", brand: "Wolf", model: "GR486G" }),
   line("ventilation", { area: "Kitchen", brand: "Wolf", model: "PI543418" })]);
check("what they bought but did not enroll survives the match",
      estate.extras.map(function (e) { return e.line.model; }), ["GR486G", "PI543418"]);
check("nothing is silently lost -- every unit is matched or parked",
      estate.counts.matched + estate.counts.extras, estate.counts.units);
check("and an extra says which kind of extra it is",
      estate.extras.map(function (e) { return e.reason; }),
      ["Nothing of this type is on the plan", "Nothing of this type is on the plan"]);

const surplus = M.propose([slot("refrigeration")],
                          [line("refrigeration", { model: "A" }), line("refrigeration", { model: "B" })]);
check("a surplus within an enrolled category reads differently from an unenrolled one",
      surplus.extras[0].reason, "More on the invoice than the customer enrolled");

/* ========================================================================== */
console.log("\n=== nothing already known is overwritten quietly ===");

const known = slot("dishwasher", { brand: "Miele", model: "G7566", serial: "SN-FIELD-1" });
const reimport = M.propose([known], [line("dishwasher", { brand: "Miele", model: "G7566", serial: "SN-INVOICE-9" })]);
check("a match onto a slot that already has details is flagged, not applied",
      [reimport.matches[0].wouldOverwrite, reimport.counts.wouldOverwrite], [true, 1]);

/*
 * `detailsFrom` is what a confirmation would write. A blank on the invoice is
 * the absence of information, not the information that there is none.
 */
const blanks = M.detailsFrom(line("dishwasher", { brand: "Miele", model: "", serial: "" }), known, "SV1");
check("a blank field on the invoice writes nothing",
      Object.keys(blanks).sort(), []);
check("and an unchanged value writes nothing either",
      Object.keys(M.detailsFrom(line("dishwasher", { brand: "Miele" }), known, "SV1")), []);

const fresh = M.detailsFrom(
  line("dishwasher", { brand: "Cove", model: "DW2450", serial: "SN-1", installYear: 2019 }),
  slot("dishwasher"), "SV0010884");
check("a real value writes with its provenance attached",
      Object.keys(fresh).sort(), ["brand", "installYear", "model", "serial"]);
check("and every written field records the invoice it came from",
      Object.keys(fresh).filter(function (k) {
        return fresh[k].source !== "invoice" || fresh[k].ref !== "SV0010884" || !fresh[k].at;
      }), []);

/* ========================================================================== */
console.log("\n=== the guardrail fires at the moment brand becomes known ===");
/*
 * Cayden: "we already had a tech ask if we could register 2 appliances for
 * maintenance that we dont work on." Registration cannot catch that, because it
 * deliberately does not ask for a brand. This is the first moment it can be
 * caught, and the last before somebody drives out.
 */
const blocked = M.propose([slot("refrigeration"), slot("outdoor_grill")],
                          [line("refrigeration", { brand: "Samsung", model: "RF28" }),
                           line("outdoor_grill", { brand: "Big Green Egg", model: "XL" })]);
check("an unserviced brand is caught on the appliance it was matched to",
      blocked.matches.map(function (m) { return m.serviceability.state; }),
      ["not_serviced", "not_maintainable"]);
check("and the two carry different sentences for the office",
      blocked.matches[0].serviceability.office !== blocked.matches[1].serviceability.office, true);
check("the count is surfaced so a screen does not have to re-derive it",
      blocked.counts.excluded, 2);

check("a brand Wilson does sell passes clean",
      M.propose([slot("refrigeration")], [line("refrigeration", { brand: "Sub-Zero" })])
        .matches[0].serviceability.state, "ok");
check("an invoice line with no brand is 'unstated', not a problem",
      M.propose([slot("refrigeration")], [line("refrigeration", { brand: "" })])
        .matches[0].serviceability.state, "unstated");
check("and an unstated brand is not counted as an exclusion",
      M.propose([slot("refrigeration")], [line("refrigeration", { brand: "" })]).counts.excluded, 0);

/* A parked extra is checked too -- an unserviced brand Wilson sold is worth
   knowing even when nobody enrolled it. */
check("extras are checked as well as matches",
      M.propose([], [line("refrigeration", { brand: "Samsung" })]).extras[0].serviceability.state,
      "not_serviced");

/* ========================================================================== */
console.log("\n=== the empty and the absurd ===");

check("no slots and no lines is not an error",
      M.propose([], []).counts,
      { slots: 0, units: 0, matched: 0, unmatched: 0, extras: 0,
        lowConfidence: 0, wouldOverwrite: 0, excluded: 0 });
check("null arguments do not throw",
      M.propose(null, null).counts.matched, 0);
check("a removed appliance is not offered a match",
      M.propose([slot("dishwasher", { status: "Removed" })], [line("dishwasher", { brand: "Cove" })]).counts,
      { slots: 0, units: 1, matched: 0, unmatched: 0, extras: 1,
        lowConfidence: 0, wouldOverwrite: 0, excluded: 0 });
check("a line with a nonsense quantity is treated as one unit",
      M.unitsFromLines([line("dishwasher", { quantity: 0 })]).length, 1);
check("and a large one is not silently truncated",
      M.unitsFromLines([line("ice_maker", { quantity: 12 })]).length, 12);

/* ========================================================================== */
console.log("\n=== mutation tests: every guard above is load-bearing ===");
/*
 * WRITTEN WRONG THE FIRST TIME, AND WORTH RECORDING.
 *
 * The first version of this block called a function that asserted the CORRECT
 * behaviour and treated a true result as "the mutation was caught". Nothing was
 * ever mutated, so all eight passed by construction -- the same mistake made in
 * verify-brand-lifespans.js, where a mutation asserted that the HVAC exemption
 * holds, which is the exemption working.
 *
 * A mutation has to BREAK something. These edit the module's source, reload the
 * broken copy into a fresh sandbox, and require the property to stop holding.
 * If a guard is deleted and every check still passes, the guard was decoration.
 */
const vm = require("vm");
const SOURCE = fs.readFileSync(path.join(ROOT, "assets", "equipment-match.js"), "utf8");

function loadMutated(replace, withText) {
  if (SOURCE.indexOf(replace) === -1) {
    throw new Error("mutation target not found in source: " + replace.slice(0, 60));
  }
  const sandbox = { window: {}, Date: Date, Number: Number, String: String,
                    Boolean: Boolean, Math: Math, JSON: JSON, console: console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8"), sandbox);
  vm.runInContext(SOURCE.split(replace).join(withText), sandbox);
  return sandbox.window.WILSON_MATCH;
}

let mutations = 0;
const missed = [];
function mutation(label, replace, withText, stillHolds) {
  mutations += 1;
  let broken;
  try {
    broken = loadMutated(replace, withText);
  } catch (e) {
    missed.push(label + " (could not apply: " + e.message + ")");
    console.log("FAIL " + ("caught: " + label).padEnd(72));
    return;
  }
  /* The property must hold on the real module and STOP holding on the broken
     one. Both halves are checked -- a property that fails on the real module
     too is measuring nothing. */
  const realOk = stillHolds(M);
  let brokenOk;
  try { brokenOk = stillHolds(broken); } catch (e) { brokenOk = false; }
  const caught = realOk === true && brokenOk !== true;
  if (!caught) missed.push(label + (realOk ? " (broken copy still passed)" : " (property fails on the REAL module)"));
  console.log((caught ? "ok   " : "FAIL ") + ("caught: " + label).padEnd(72));
}

mutation("the category guard removed",
  "if (categoryOf(slot) !== unit.category) return;          /* rule 1 */", "",
  function (mod) {
    return mod.propose([slot("refrigeration", { location: "Kitchen" })],
                       [line("dishwasher", { area: "Kitchen" })]).counts.matched === 0;
  });

mutation("extras dropped instead of parked",
  "const extras = units.filter(function (u) { return !takenUnits[u.unitId]; })",
  "const extras = [].filter(function (u) { return !takenUnits[u.unitId]; })",
  function (mod) {
    const r = mod.propose([slot("dishwasher")], [line("dishwasher"), line("cooking"), line("ventilation")]);
    return r.counts.matched + r.counts.extras === r.counts.units;
  });

mutation("the one-line-one-appliance guard removed",
  "if (takenSlots[pair.slot.id] || takenUnits[pair.unit.unitId]) return;",
  "if (takenSlots[pair.slot.id]) return;",
  function (mod) {
    return mod.propose([slot("dishwasher"), slot("dishwasher")],
                       [line("dishwasher", { quantity: 1 })]).counts.matched === 1;
  });

mutation("a blank invoice field allowed to erase a known value",
  "if (!value) return;", "",
  function (mod) {
    return Object.keys(mod.detailsFrom(line("dishwasher", { serial: "" }),
                                       slot("dishwasher", { serial: "SN-FIELD" }), "SV1")).length === 0;
  });

mutation("the pairing sort removed, making the result order-dependent",
  "pairs.sort(function (a, b) {", "[].sort.call(pairs, function (a, b) { return 0; }); (function (a, b) {",
  function (mod) {
    const a = mod.propose(slotsA, linesA).matches
      .map(function (m) { return m.slot.location + "=" + m.line.model; }).join("|");
    const b = mod.propose(slotsA, linesA.slice().reverse()).matches
      .map(function (m) { return m.slot.location + "=" + m.line.model; }).join("|");
    return a === b;
  });

mutation("the guardrail stopped firing",
  "if (!window.WILSON_BRANDS) return null;", "return null;",
  function (mod) {
    const s = mod.propose([slot("refrigeration")], [line("refrigeration", { brand: "Samsung" })])
      .matches[0].serviceability;
    return Boolean(s) && s.state === "not_serviced";
  });

mutation("matches arriving with no explanation",
  "why: pair.why,", "why: \"\",",
  function (mod) {
    return mod.propose([slot("dishwasher")], [line("dishwasher")]).matches
      .every(function (m) { return String(m.why || "").length > 20; });
  });

mutation("the overwrite flag hard-coded false",
  "wouldOverwrite: Boolean(pair.slot.brand || pair.slot.model || pair.slot.serial),",
  "wouldOverwrite: false,",
  function (mod) {
    return mod.propose([slot("dishwasher", { brand: "Miele" })],
                       [line("dishwasher", { brand: "Cove" })]).matches[0].wouldOverwrite === true;
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
console.log("ALL " + checks + " EQUIPMENT MATCH CHECKS PASSED (+ " + mutations + " mutations caught)");

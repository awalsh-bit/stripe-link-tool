/*
 * EVERY ENROLLABLE APPLIANCE GETS A PROTOCOL THAT FITS IT.
 *
 * Two gaps the v0.9.36 audit found, and the invariants that keep them shut.
 *
 * 1. BUILT-IN COFFEE COULD BE ENROLLED AND HAD NO PROTOCOL. It was the only one
 *    of the fourteen enrollable categories falling through to `generic`, so a
 *    customer could put a plumbed Miele on a plan, pay for it, and the
 *    technician was asked three questions: overall condition, connections,
 *    serviceable condition. A brew group, a grinder, a milk circuit, a water
 *    path and a descale cycle were asked about nowhere.
 *
 * 2. ONE PROTOCOL SERVED FOUR DIFFERENT APPLIANCES. Cooktop, range, wall oven
 *    and warming drawer all ran the same four checks. A warming drawer has no
 *    burners; an induction cooktop has no flame and no oven door. Two of the
 *    four were inapplicable on at least one member of the group, which trains a
 *    technician to mark things N/A -- and N/A is how a protocol stops being
 *    read.
 *
 * Run: node _qa/verify-protocol-coverage.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");

function boot(mutate) {
  const sb = { console: { log: () => {}, warn: () => {}, error: () => {} } };
  sb.window = sb;
  vm.createContext(sb);
  let src = fs.readFileSync(path.join(ROOT, "assets/plan-config.js"), "utf8");
  if (mutate) src = mutate(src);
  vm.runInContext(src, sb);
  return sb.window;
}
const W = boot(null);
const CFG = W.WILSON_CONFIG, R = W.WILSON_PROTOCOL.resolveCheckpointSet, A = W.WILSON_ANSWERS;

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log((ok ? "ok  " : "FAIL") + "  " + label.padEnd(70) + (detail === undefined ? "" : detail));
}
const setFor = (cat) => R({ type: cat.id, typeLabel: cat.label, customerCategory: cat.id,
                            group: cat.group, checkpointSet: cat.checkpointSet });
const names = (setKey) => (CFG.checkpointSets[setKey] || []).map((c) => c.name);

/* ------------------------------------------------------------------ */
console.log("--- no enrollable appliance falls through to the generic protocol ---");

const enrollable = CFG.customerApplianceCategories.filter(function (c) {
  /* `outdoor` and `other` are deliberately generic and deliberately visible as
     gaps -- an unclassified appliance should prompt someone to classify it. A
     category a customer can pick off the signup form is different. */
  return c.id !== "other" && c.id !== "outdoor";
});
const onGeneric = enrollable.filter(function (c) { return setFor(c) === "generic"; });
check("every enrollable category has a protocol of its own",
  onGeneric.length === 0, onGeneric.map((c) => c.id).join(",") || enrollable.length + " categories");

/* ------------------------------------------------------------------ */
console.log("\n--- built-in coffee ---");

const coffeeCat = CFG.customerApplianceCategories.find((c) => c.id === "coffee");
check("a customer can still enroll it", Boolean(coffeeCat), "");
check("it resolves to the coffee protocol", setFor(coffeeCat) === "coffee", setFor(coffeeCat));

/*
 * The failure modes the coffee protocol must cover. v0.9.39: the FIELD TEAM'S
 * list -- grounds, flow, milk pipe, interior, grinder, brew unit. Scale
 * dropped out as a check because Wilson RUNS the descale as maintenance (it is
 * a chip and an end-of-protocol reminder), and the water path is exercised by
 * the flow test rather than inspected as plumbing.
 */
const coffee = names("coffee").join(" | ").toLowerCase();
[["the brew unit", /brew unit/], ["a grinder", /grinder/], ["the milk pipe", /milk/],
 ["the grounds", /grounds/], ["flow", /flow/], ["interior cleanliness", /interior|cleanliness/]].forEach(function (pair) {
  check("it asks about " + pair[0], pair[1].test(coffee), "");
});
check("the descale survives as work Wilson performs",
  (A.maintenance("coffee") || []).some(function (a) { return /descale/i.test(a.label); }), "");
check("...and as the before-you-leave reminder",
  Boolean((CFG.cycleReminders || {}).coffee), "");
check("...and it is more than the three generic questions",
  names("coffee").length > names("generic").length, names("coffee").length + " checks");

/* The milk circuit is a food-contact path. Visible growth must be the harshest
   answer in the set and must raise a finding, not merely lower a score. */
const milkOpts = (CFG.observationSets || {}).milk_circuit_condition || [];
const growthOpt = milkOpts.find(function (o) { return o.code === "growth"; });
check("growth in a milk line raises a finding, not just a deduction",
  Boolean(growthOpt) && growthOpt.attention === true, growthOpt ? "score " + growthOpt.score : "missing");
check("...and nothing in the set scores lower than it",
  Boolean(growthOpt) && milkOpts.every(function (o) { return o.score === null || o.score >= growthOpt.score; }), "");
/* And an espresso machine with no milk system is not marked down for it. */
const noMilk = milkOpts.find(function (o) { return o.code === "none"; });
check("a machine with no milk system is not scored on one",
  Boolean(noMilk) && noMilk.score === null, "");

check("there are maintenance chips for the work Wilson does",
  (A.maintenance("coffee") || []).length > 0, (A.maintenance("coffee") || []).length + " chips");

/* ------------------------------------------------------------------ */
console.log("\n--- cooking, split by what the appliance physically has ---");

const routing = { cooktop: "cooktop", range: "cooking", ovens: "oven", warming_drawer: "warming_drawer" };
Object.keys(routing).forEach(function (catId) {
  const cat = CFG.customerApplianceCategories.find((c) => c.id === catId);
  check(catId + " runs the " + routing[catId] + " protocol", cat && setFor(cat) === routing[catId],
    cat ? setFor(cat) : "category missing");
});

/* THE POINT OF THE SPLIT. Each of these is a question that was being asked of
   an appliance that cannot answer it. */
const has = (setKey, re) => re.test(names(setKey).join(" | ").toLowerCase());
/* A warming drawer HAS an element -- the field team's list tests it. What it
   does not have is a surface burner or an oven cavity. */
check("a warming drawer is no longer asked about burners", !has("warming_drawer", /burner/), "");
check("a warming drawer is no longer asked about an oven cavity", !has("warming_drawer", /oven/), "");
check("...and IS asked about its slides, element, fan and seal",
  has("warming_drawer", /slide/) && has("warming_drawer", /element/) &&
  has("warming_drawer", /fan/) && has("warming_drawer", /seal/), "");
check("a cooktop is no longer asked about oven temperature accuracy",
  !has("cooktop", /oven/), "");
/* "Burner" alone is not the test: a GAS wall oven has a bake burner and the
   check names it. What an oven must not be asked about is the cooktop -- the
   surface, its grates and its igniters. */
check("a wall oven is no longer asked about the cooking surface",
  !has("oven", /grate|igniter|cooking surface|surface burner/), "");
check("a range keeps both halves, because it has both",
  has("cooking", /burner/) && has("cooking", /oven/), names("cooking").length + " checks");

/* Every split set must be complete on its own terms, not a stub. */
["cooktop", "oven", "warming_drawer", "coffee"].forEach(function (setKey) {
  const list = CFG.checkpointSets[setKey] || [];
  check(setKey + ": every check has a subsystem, a prompt and an answer",
    list.length > 0 && list.every(function (c) {
      const answer = A.for(setKey, c.id);
      return c.subsystem && (CFG.subsystems || {})[c.subsystem] && c.prompt && answer && answer.kind;
    }), list.length + " checks");
  check(setKey + ": work performed is a chip, never a checkpoint",
    list.every(function (c) { return A.for(setKey, c.id).kind !== "maintenance"; }) &&
    (A.maintenance(setKey) || []).length > 0, (A.maintenance(setKey) || []).length + " chips");
});

/* ------------------------------------------------------------------ */
console.log("\n--- a split protocol must not silently change an expected life ---");

/*
 * `lifecycleMatrix` is keyed by lifecycle CATEGORY, and the split created three
 * protocol sets with no row of their own. Without the line lookup they would
 * have fallen through to `generic` -- ten years, the figure meant for an
 * appliance nobody has classified -- and no test would have noticed.
 */
["cooking", "cooktop", "oven", "warming_drawer"].forEach(function (setKey) {
  const got = W.WILSON_WATER.expectedLife(setKey, "luxury", null, null);
  const want = W.WILSON_WATER.expectedLife("cooking", "luxury", null, null);
  check(setKey + " uses the cooking category's expected life", got.base === want.base,
    got.base + " yr (basis " + got.basis.set + ")");
});
check("coffee has an expected-life category of its own",
  W.WILSON_WATER.expectedLife("coffee", "luxury", null, null).basis.set === "coffee", "");

/* ------------------------------------------------------------------ */
console.log("\n--- mutation tests: every assertion above can fail ---");

function mutation(label, mutate, probe) {
  let caught = false, why = "";
  /* A mutation whose search string no longer matches changes nothing, so the
     property holds and the test reads green while asserting nothing. That is a
     stale test, and it is reported as a failure rather than a pass -- see the
     note in _qa/verify-life-provenance.js for the case that found it. */
  let touched = false;
  const witness = function (src) {
    const out = mutate(src);
    if (out !== src) touched = true;
    return out;
  };
  try {
    const m = boot(witness);
    if (!touched) {
      fail++;
      console.log("FAIL  STALE:  " + label.padEnd(60) + "the mutation matched nothing -- fix its search string");
      return;
    }
    caught = probe(m) === false;
    if (!caught) why = "property still held";
  } catch (err) {
    if (!touched) {
      fail++;
      console.log("FAIL  STALE:  " + label.padEnd(60) + "the mutation matched nothing -- fix its search string");
      return;
    }
    caught = true; why = "threw";
  }
  if (!caught) fail++;
  console.log((caught ? "ok  " : "FAIL") + "  caught: " + label.padEnd(60) + why);
}

mutation("coffee routed back to the generic protocol", function (s) {
  return s.replace('{ id: "coffee", label: "Built-In Coffee", shortLabel: "Built-In Coffee", icon: "coffee.svg", group: "standard", checkpointSet: "coffee"',
                   '{ id: "coffee", label: "Built-In Coffee", shortLabel: "Built-In Coffee", icon: "coffee.svg", group: "standard", checkpointSet: "generic"');
}, function (m) {
  const cat = m.WILSON_CONFIG.customerApplianceCategories.find((c) => c.id === "coffee");
  return m.WILSON_PROTOCOL.resolveCheckpointSet({ type: "coffee", customerCategory: "coffee",
    group: cat.group, checkpointSet: cat.checkpointSet }) === "coffee";
});

mutation("the milk circuit losing its growth finding", function (s) {
  return s.replace('{ code: "growth",    label: "Visible growth inside the line or frother", result: "Needs attention",     score: 1, attention: true },',
                   '{ code: "growth",    label: "Visible growth inside the line or frother", result: "Noted",     score: 4, attention: false },');
}, function (m) {
  const o = (m.WILSON_CONFIG.observationSets.milk_circuit_condition || []).find((x) => x.code === "growth");
  return Boolean(o) && o.attention === true;
});

mutation("a warming drawer sent back to the burner protocol", function (s) {
  return s.replace('{ id: "warming_drawer", customerCategory: "warming_drawer", label: "Warming Drawer", group: "standard", checkpointSet: "warming_drawer"',
                   '{ id: "warming_drawer", customerCategory: "warming_drawer", label: "Warming Drawer", group: "standard", checkpointSet: "cooking"');
}, function (m) {
  return m.WILSON_PROTOCOL.resolveCheckpointSet({ exactType: "warming_drawer", type: "warming_drawer",
    group: "standard", checkpointSet: "cooking" }) === "warming_drawer";
});

/* The one that would have shipped silently. */
mutation("a split protocol falling through to the generic expected life", function (s) {
  return s.replace("  function matrixSetFor(setKey) {\n    if (config.lifecycleMatrix[setKey]) return setKey;",
                   "  function matrixSetFor(setKey) {\n    if (true) return setKey;");
}, function (m) {
  const oven = m.WILSON_WATER.expectedLife("oven", "luxury", null, null);
  const cooking = m.WILSON_WATER.expectedLife("cooking", "luxury", null, null);
  return oven.base === cooking.base;
});

mutation("the coffee protocol stripped back to a stub", function (s) {
  return s.replace('{ id: "grinder", subsystem: "mechanical", name: "Grinder test", prompt: "Run a grind: burrs cutting cleanly, no metal-on-metal, chute clear, dose consistent.", photoPrompt: "Chute or hopper if fouled" },', "");
}, function (m) {
  return /grinder/.test((m.WILSON_CONFIG.checkpointSets.coffee || []).map((c) => c.name).join(" ").toLowerCase());
});

console.log("");
if (fail) { console.log("FAILURES: " + fail); process.exit(1); }
console.log("ALL PROTOCOL COVERAGE CHECKS PASSED");

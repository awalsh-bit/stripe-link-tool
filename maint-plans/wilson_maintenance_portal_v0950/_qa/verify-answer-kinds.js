/*
 * THE VERDICT STANDARD.
 *
 * v0.9.39 replaced the per-check answer vocabularies with the field team's one
 * scale: every appliance health check is pass / cause for concern / fail,
 * worth 5 / 3 / 1, and anything but pass demands the reason. This suite is
 * that ruling, held in place:
 *
 *   - every appliance checkpoint answers with the SAME three options
 *   - the scores are 5, 3, 1 -- published on the option, never derived
 *   - concern and fail carry noteRequired and raise a finding (attention)
 *   - switching a verdict back to Pass clears the reason AND the return-visit
 *     flag, so neither can ride along on a verdict that no longer stands
 *   - readings ride on the check and required ones still gate completion
 *   - a field behind a fuel toggle exists only while the toggle is on
 *   - the IR evaporator scan requires its photograph
 *   - HVAC is untouched: its checks are judged against the nameplate
 *
 * The old vocabularies survive as `reasons` -- and the suite checks they do,
 * because "two technicians file the same words" was the point of them.
 *
 * Run: node _qa/verify-answer-kinds.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");

function boot(mutate) {
  const sb = { console: { log: () => {}, warn: () => {}, error: () => {} } };
  sb.window = sb;
  vm.createContext(sb);
  ["assets/plan-config.js", "assets/tech-answers.js"].forEach(function (f) {
    let src = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (mutate) src = mutate(f, src);
    vm.runInContext(src, sb);
  });
  return sb.window;
}
const W = boot(null);
const CFG = W.WILSON_CONFIG, A = W.WILSON_ANSWERS, INPUT = W.WILSON_INPUT;

let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "ok  " : "FAIL") + "  " + label.padEnd(66) +
    (ok ? "" : ' got=' + JSON.stringify(got) + " want=" + JSON.stringify(want)));
}

const APPLIANCE_SETS = Object.keys(CFG.checkpointSets).filter(function (k) {
  return k.indexOf("hvac_") !== 0;
});

/* ------------------------------------------------------------------ */
console.log("--- one scale, everywhere ---");

let total = 0;
const notVerdict = [];
APPLIANCE_SETS.forEach(function (setKey) {
  CFG.checkpointSets[setKey].forEach(function (c) {
    total++;
    const a = A.for(setKey, c.id);
    if (a.control !== "verdict") notVerdict.push(setKey + "." + c.id + " -> " + a.control);
  });
});
check("every appliance checkpoint answers with the verdict control (" + total + " checks)", notVerdict, []);

const verdict = (CFG.observationSets || {}).verdict || [];
check("the verdict has exactly three answers", verdict.map(function (o) { return o.code; }),
  ["pass", "concern", "fail"]);
check("and the field team's scores, published", verdict.map(function (o) { return o.score; }), [5, 3, 1]);
check("concern and fail demand the reason",
  verdict.filter(function (o) { return o.noteRequired; }).map(function (o) { return o.code; }),
  ["concern", "fail"]);
check("concern and fail raise a finding",
  verdict.filter(function (o) { return o.attention; }).map(function (o) { return o.code; }),
  ["concern", "fail"]);
check("pass demands nothing and flags nothing",
  Boolean(verdict[0].noteRequired || verdict[0].attention), false);

/* Every verdict check resolves to the ONE shared set -- a second vocabulary
   would be a second scoring system. */
const strayVocab = [];
APPLIANCE_SETS.forEach(function (setKey) {
  CFG.checkpointSets[setKey].forEach(function (c) {
    const a = A.for(setKey, c.id);
    if (a.control !== "verdict") return;
    const codes = (a.options || []).map(function (o) { return o.code; }).join(",");
    if (codes !== "pass,concern,fail") strayVocab.push(setKey + "." + c.id);
  });
});
check("every verdict answers from the one shared set", strayVocab, []);

/* ------------------------------------------------------------------ */
console.log("\n--- what choosing a verdict does ---");

function freshCheck(setKey, id) {
  const t = CFG.checkpointSets[setKey].find(function (c) { return c.id === id; });
  return { id: t.id, name: t.name, rating: 0, performed: false, notApplicable: false,
           readings: {}, note: "", noteText: "", noteReasons: [] };
}
const sealAnswer = A.for("refrigerator", "seal");

let c1 = freshCheck("refrigerator", "seal");
INPUT.applyOption(c1, sealAnswer, "pass");
check("pass scores 5", c1.rating, 5);
check("pass is complete on its own", Boolean(c1.noteRequired), false);
check("pass raises no finding", c1.observedAttention, false);

let c2 = freshCheck("refrigerator", "seal");
INPUT.applyOption(c2, sealAnswer, "concern");
check("concern scores 3", c2.rating, 3);
check("concern demands the reason", c2.noteRequired, true);
check("concern raises a finding", c2.observedAttention, true);
check("concern records the words the customer will read", c2.selectionResult, "Cause for concern");

let c3 = freshCheck("refrigerator", "seal");
INPUT.applyOption(c3, sealAnswer, "fail");
check("fail scores 1", c3.rating, 1);
check("fail demands the reason", c3.noteRequired, true);

/* THE CLEARING RULE. A reason and a return-visit flag belong to the verdict
   that raised them. */
c3.note = "Seal torn"; c3.noteText = "Seal torn"; c3.noteReasons = ["Seal torn"]; c3.followUp = true;
INPUT.applyOption(c3, sealAnswer, "pass");
check("switching to pass clears the reason", c3.note, "");
check("...and the picked reasons", c3.noteReasons, []);
check("...and the return-visit flag", c3.followUp, false);

/* ------------------------------------------------------------------ */
console.log("\n--- the reasons: the old vocabularies, surviving as words ---");

const noReasons = [];
APPLIANCE_SETS.forEach(function (setKey) {
  CFG.checkpointSets[setKey].forEach(function (c) {
    const a = A.for(setKey, c.id);
    if (setKey === "generic" || setKey === "laundry") return;   /* fallback + legacy */
    if (!(a.reasons || []).length) noReasons.push(setKey + "." + c.id);
  });
});
check("nearly every check offers picked reasons (missing list stays small)",
  noReasons.length <= 4, true);
if (noReasons.length) console.log("      without reasons: " + noReasons.join(", "));

check("two technicians flagging the same milk line file the same words",
  (A.for("coffee", "milk").reasons || []).indexOf("Visible growth in line or frother") >= 0, true);

/* ------------------------------------------------------------------ */
console.log("\n--- readings ride on the verdict ---");

const oven = A.for("cooking", "oven_temp");
check("the oven test takes both numbers", oven.readingFields.map(function (f) { return f.key; }),
  ["set_point", "avg_30min"]);
check("...and derives the error", oven.derived && oven.derived.op, "subtract");
/* v0.9.41, Cayden: "it should default to 350. we expect the tech to set to
   350." Both oven protocols, so a wall oven and a range agree. */
check("the oven set point defaults to 350",
  oven.readingFields[0].defaultValue, 350);
check("...on the wall oven too",
  A.for("oven", "oven_temp").readingFields[0].defaultValue, 350);
check("the boil test records its minutes",
  A.for("cooking", "boil").readingFields.map(function (f) { return f.key; }), ["minutes_to_boil"]);
check("the microwave delta-T takes before and after",
  A.for("microwave", "delta_t").readingFields.map(function (f) { return f.key; }), ["start_temp", "end_temp"]);
/* v0.9.41: "lets remove the amp draw thing from dishwasher check" -- the
   controls check carries NO readings now, and no other dishwasher check
   sneaks an amp field back in. */
check("the dishwasher controls check takes no readings",
  (A.for("dishwasher", "controls_amp").readingFields || []).length, 0);
/* v0.9.41: "still asking for condenser temps. eliminate those." The check
   survives as a verdict; the readings and the TD derivation are gone, and
   the compartment-temperature spot check left the protocol entirely --
   Guardian streams those temps for enrolled units. */
check("the condenser check survives as a verdict",
  Boolean(CFG.checkpointSets.refrigerator.find(function (c) { return c.id === "condenser_temp"; })), true);
check("...but takes no temperatures",
  (A.for("refrigerator", "condenser_temp").readingFields || []).length, 0);
check("no refrigeration check asks for a compartment temp readout",
  Boolean(CFG.checkpointSets.refrigerator.find(function (c) { return c.id === "temp"; })), false);
check("the dryer restriction test is gone (lint and static carry it)",
  Boolean(CFG.checkpointSets.dryer.find(function (c) { return c.id === "restriction"; })), false);

/* v0.9.49, Cayden: "this probably need to be a gallon of water to test the
   drain instead of 500ml" -- half a litre clears even a half-blocked line. */
const icemakerDrain = CFG.checkpointSets.icemaker.find(function (c) { return c.id === "drain_test"; });
check("the icemaker drain test pours a gallon",
  /1 gallon/.test(icemakerDrain.prompt), true);
check("...and no 500 ml pour survives in it",
  /500\s?ml/i.test(icemakerDrain.prompt), false);

/* ------------------------------------------------------------------ */
console.log("\n--- the can't-access opt-out (bad installs) ---");

/* v0.9.41, Cayden: "there are many instances of bad installs where we cant
   get to the vent during maint. give an option for i cant access. same thing
   with cycling temp." The reading stays required on a normal install and is
   waived -- on the record -- when the tick goes on. */
const dstat = A.for("dryer", "static");
check("the dryer manometer reading is required on a normal install",
  dstat.readingFields[0].required, true);
check("the check offers the can't-access tick", dstat.toggle && dstat.toggle.key, "no_access");
let dc = freshCheck("dryer", "static");
check("untouched, the reading field is live",
  INPUT.fieldsFor(dc, dstat).map(function (f) { return f.key; }), ["vent_static"]);
dc.toggles = { no_access: true };
check("ticking can't-access waives it",
  INPUT.fieldsFor(dc, dstat).length, 0);
dc.toggles.no_access = false;
check("unticking brings the requirement back",
  INPUT.fieldsFor(dc, dstat).map(function (f) { return f.key + ":" + f.required; }), ["vent_static:true"]);
const dtemp = A.for("dryer", "exhaust_temp");
check("the cycling-temp check carries the same opt-out", dtemp.toggle && dtemp.toggle.key, "no_access");
let dt = freshCheck("dryer", "exhaust_temp");
dt.toggles = { no_access: true };
check("...and it waives both readings at once",
  INPUT.fieldsFor(dt, dtemp).length, 0);

/* ------------------------------------------------------------------ */
console.log("\n--- the gas toggle ---");

const burners = A.for("cooking", "burners");
check("the burner test carries the gas toggle", burners.toggle && burners.toggle.key, "gas");
let cb = freshCheck("cooking", "burners");
check("with the box unticked, no gas field exists",
  INPUT.fieldsFor(cb, burners).map(function (f) { return f.key; }), []);
cb.toggles = { gas: true };
check("ticking it reveals the manometer reading, required",
  INPUT.fieldsFor(cb, burners).map(function (f) { return f.key + ":" + f.required; }), ["gas_pressure:true"]);
cb.toggles.gas = false;
check("unticking removes the field again",
  INPUT.fieldsFor(cb, burners).length, 0);
check("the cooktop shares the same toggle", A.for("cooktop", "burners").toggle.key, "gas");

/* ------------------------------------------------------------------ */
console.log("\n--- the required photograph ---");

check("the IR evaporator scan demands its image", A.for("refrigerator", "evap_ir").photoRequired, true);
const requiredPhotos = [];
APPLIANCE_SETS.forEach(function (setKey) {
  CFG.checkpointSets[setKey].forEach(function (c) {
    if (A.for(setKey, c.id).photoRequired) requiredPhotos.push(setKey + "." + c.id);
  });
});
check("and it is the only check that does (the kit workflow is new)",
  requiredPhotos, ["refrigerator.evap_ir"]);

/* ------------------------------------------------------------------ */
console.log("\n--- HVAC is untouched ---");

const hvacVerdicts = [];
Object.keys(CFG.checkpointSets).filter(function (k) { return k.indexOf("hvac_") === 0; })
  .forEach(function (setKey) {
    CFG.checkpointSets[setKey].forEach(function (c) {
      if (A.for(setKey, c.id).control === "verdict") hvacVerdicts.push(setKey + "." + c.id);
    });
  });
check("no HVAC check was converted to a verdict", hvacVerdicts, []);

/* ------------------------------------------------------------------ */
console.log("\n--- mutation tests: every assertion above can fail ---");

function mutation(label, mutate, probe) {
  let caught = false, why = "";
  let touched = false;
  const witness = function (f, src) {
    const out = mutate(f, src);
    if (out !== src) touched = true;
    return out;
  };
  try {
    const m = boot(witness);
    if (!touched) { fail++; console.log("FAIL  STALE:  " + label.padEnd(60) + "mutation matched nothing"); return; }
    caught = probe(m) === false;
    if (!caught) why = "property still held";
  } catch (err) {
    if (!touched) { fail++; console.log("FAIL  STALE:  " + label.padEnd(60) + "mutation matched nothing"); return; }
    caught = true; why = "threw";
  }
  if (!caught) fail++;
  console.log((caught ? "ok  " : "FAIL") + "  caught: " + label.padEnd(60) + why);
}

mutation("a concern silently worth 4 instead of 3", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace('{ code: "concern", label: "Cause for concern", result: "Cause for concern", score: 3, attention: true, noteRequired: true },',
                   '{ code: "concern", label: "Cause for concern", result: "Cause for concern", score: 4, attention: true, noteRequired: true },');
}, function (m) {
  const c = { id: "seal", rating: 0, readings: {} };
  m.WILSON_INPUT.applyOption(c, m.WILSON_ANSWERS.for("refrigerator", "seal"), "concern");
  return c.rating === 3;
});

mutation("fail losing its reason requirement", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace('{ code: "fail",    label: "Fail",              result: "Fail",              score: 1, attention: true, noteRequired: true }',
                   '{ code: "fail",    label: "Fail",              result: "Fail",              score: 1, attention: true }');
}, function (m) {
  const c = { id: "seal", rating: 0, readings: {} };
  m.WILSON_INPUT.applyOption(c, m.WILSON_ANSWERS.for("refrigerator", "seal"), "fail");
  return c.noteRequired === true;
});

mutation("a stale reason riding along on a new Pass", function (f, s) {
  if (f !== "assets/tech-answers.js") return s;
  return s.replace("    if (!check.noteRequired) {\n      check.note = \"\";", "    if (false) {\n      check.note = \"\";");
}, function (m) {
  const c = { id: "seal", rating: 0, readings: {}, note: "old reason", followUp: true };
  m.WILSON_INPUT.applyOption(c, m.WILSON_ANSWERS.for("refrigerator", "seal"), "pass");
  return c.note === "" && c.followUp === false;
});

mutation("the gas field required even with the box unticked", function (f, s) {
  if (f !== "assets/tech-answers.js") return s;
  return s.replace("      if (!f.toggle) return true;\n      return Boolean((check.toggles || {})[f.toggle]);",
                   "      return true;");
}, function (m) {
  const c = { id: "burners", rating: 0, readings: {} };
  return m.WILSON_INPUT.fieldsFor(c, m.WILSON_ANSWERS.for("cooking", "burners")).length === 0;
});

/* v0.9.41: the can't-access tick stops waiving the reading -- a technician
   on a bad install would be blocked on a number they cannot take. */
mutation("the can't-access tick waiving nothing", function (f, s) {
  if (f !== "assets/tech-answers.js") return s;
  return s.replace("      if (f.toggleOff) return !((check.toggles || {})[f.toggleOff]);",
                   "      if (f.toggleOff) return true;");
}, function (m) {
  const c = { id: "static", rating: 0, readings: {}, toggles: { no_access: true } };
  return m.WILSON_INPUT.fieldsFor(c, m.WILSON_ANSWERS.for("dryer", "static")).length === 0;
});

/* The requirement is declared in two places -- the checkpoint and its answer
   -- so removing one is survivable and the mutation strips BOTH, which is the
   only edit that should be able to kill it. */
mutation("the IR scan losing its photo requirement", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s
    .replace('kind: "scored", control: "verdict", options: "verdict", photo: true, photoRequired: true,',
             'kind: "scored", control: "verdict", options: "verdict", photo: true,')
    .replace('photoPrompt: "The IR image — required",\n          photoRequired: true',
             'photoPrompt: "The IR image — required"')
    .replace(/photoRequired: true\s*\n/, "\n");
}, function (m) { return m.WILSON_ANSWERS.for("refrigerator", "evap_ir").photoRequired === true; });

mutation("an HVAC check quietly converted to a verdict", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace('const isHvac = String(setKey || "").indexOf("hvac_") === 0;',
                   'const isHvac = false;');
}, function (m) {
  return m.WILSON_ANSWERS.for("hvac_cooling", "hvac_airside").control !== "verdict";
});

console.log("");
if (fail) { console.log("FAILURES: " + fail); process.exit(1); }
console.log("ALL VERDICT-STANDARD CHECKS PASSED");

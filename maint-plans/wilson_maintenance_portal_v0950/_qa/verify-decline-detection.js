/*
 * Decline detection.
 *
 * The thresholds matter more than the plumbing: a flag the office stops
 * trusting is worse than no flag, so most of what follows is about what must
 * NOT be flagged. Synthetic histories here, plus the seeded demo data at the
 * end, so both the rules and the real fixtures are covered.
 *
 * Run: node _qa/verify-decline-detection.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");

const sandbox = { window: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, console };
vm.createContext(sandbox);
/* The seed builds its protocols and grade bands from the real config, so this
   loads plan-config rather than stubbing it -- a stub would let the fixtures
   drift away from the configuration the app actually ships. */
vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "store.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "trend-analysis.js"), "utf8"), sandbox);
const T = sandbox.window.WILSON_TRENDS;

let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(64)} ${JSON.stringify(got)}`);
}

/* Build a history: one report per year, newest last. */
function history(entries) {
  return entries.map(function (e, i) {
    return {
      id: "r" + i,
      assetId: "asset_test",
      householdId: "hh_test",
      applianceLabel: "Test appliance",
      inspectionDate: (2022 + i) + "-04-10",
      score: e.score,
      measurements: e.measurements || [],
    };
  });
}
const reading = (label, observed, unit, target) => ({ label, observed: String(observed), unit, target });
const kinds = (r) => (r ? r.signals.map((s) => s.kind) : []);

console.log("--- nothing to say ---");
check("a single visit produces no signal",
  T.analyseAppliance(history([{ score: 90 }])), null);
check("two steady visits produce no signal",
  T.analyseAppliance(history([{ score: 92 }, { score: 91 }])), null);
check("an empty history produces no signal", T.analyseAppliance([]), null);
check("a rising score is not decline",
  T.analyseAppliance(history([{ score: 80 }, { score: 88 }])), null);

console.log("\n--- score rules ---");
check("a 10-point total drop is flagged",
  kinds(T.analyseAppliance(history([{ score: 95 }, { score: 85 }]))), ["score"]);
check("a 9-point drop is not (threshold is deliberately conservative)",
  T.analyseAppliance(history([{ score: 95 }, { score: 86 }])), null);
check("a sustained 4-a-year slide over three visits is flagged",
  kinds(T.analyseAppliance(history([{ score: 95 }, { score: 90 }, { score: 86 }]))), ["score"]);
check("the same slide over only two visits is not",
  T.analyseAppliance(history([{ score: 95 }, { score: 91 }])), null);

console.log("\n--- out of range now ---");
const outNow = T.analyseAppliance(history([
  { score: 95, measurements: [reading("Condenser split", 20, "°F", "15-30°F")] },
  { score: 92, measurements: [reading("Condenser split", 33, "°F", "15-30°F")] },
]));
check("a reading past its target is flagged", kinds(outNow), ["out"]);
check("the signal states how far out it is",
  /3\b/.test(outNow.signals[0].detail), true);
check("a reading inside its target is not flagged",
  T.analyseAppliance(history([
    { score: 95, measurements: [reading("Condenser split", 20, "°F", "15-30°F")] },
    { score: 94, measurements: [reading("Condenser split", 24, "°F", "15-30°F")] },
  ])), null);

console.log("\n--- heading out of range ---");
const heading = T.analyseAppliance(history([
  { score: 95, measurements: [reading("Condenser split", 18, "°F", "15-30°F")] },
  { score: 93, measurements: [reading("Condenser split", 22, "°F", "15-30°F")] },
  { score: 91, measurements: [reading("Condenser split", 26, "°F", "15-30°F")] },
]));
check("a reading projected out of range is flagged", kinds(heading).includes("projected"), true);
check("it says so before the reading actually leaves range",
  heading.signals.find((s) => s.kind === "projected").detail.includes("26"), true);
check("two visits are not enough to project a trend",
  kinds(T.analyseAppliance(history([
    { score: 95, measurements: [reading("Condenser split", 18, "°F", "15-30°F")] },
    { score: 94, measurements: [reading("Condenser split", 26, "°F", "15-30°F")] },
  ]))).includes("projected"), false);
check("movement smaller than the rounding is ignored",
  T.analyseAppliance(history([
    { score: 95, measurements: [reading("Inlet temperature", 128, "°F", "120-150°F")] },
    { score: 94, measurements: [reading("Inlet temperature", 128.4, "°F", "120-150°F")] },
    { score: 94, measurements: [reading("Inlet temperature", 128.6, "°F", "120-150°F")] },
  ])), null);
check("a reading moving toward the MIDDLE of its range is not flagged",
  T.analyseAppliance(history([
    { score: 95, measurements: [reading("Condenser split", 29, "°F", "15-30°F")] },
    { score: 95, measurements: [reading("Condenser split", 25, "°F", "15-30°F")] },
    { score: 95, measurements: [reading("Condenser split", 22, "°F", "15-30°F")] },
  ])), null);

console.log("\n--- set points are settings, not performance ---");
const withSetpoint = T.analyseAppliance(history([
  { score: 95, measurements: [reading("Fresh-food compartment", 37, "°F", "Set point"), reading("Fresh-food set point", 37, "°F", "Customer setting")] },
  { score: 88, measurements: [reading("Fresh-food compartment", 41, "°F", "Set point"), reading("Fresh-food set point", 37, "°F", "Customer setting")] },
]));
check("a compartment above its set point is flagged", kinds(withSetpoint).includes("out"), true);
check("the set point itself is never a signal",
  withSetpoint.signals.some((s) => /set ?point/i.test(s.label)), false);
check("a customer who raised their set point is not flagged as declining",
  T.analyseAppliance(history([
    { score: 95, measurements: [reading("Fresh-food compartment", 37, "°F", "Set point"), reading("Fresh-food set point", 37, "°F", "Customer setting")] },
    { score: 95, measurements: [reading("Fresh-food compartment", 40, "°F", "Set point"), reading("Fresh-food set point", 40, "°F", "Customer setting")] },
  ])), null);

console.log("\n--- severity ordering ---");
const multi = T.analyseAppliance(history([
  { score: 96, measurements: [reading("Split", 18, "°F", "15-30°F"), reading("Temp", 37, "°F", "35-38°F")] },
  { score: 90, measurements: [reading("Split", 22, "°F", "15-30°F"), reading("Temp", 37, "°F", "35-38°F")] },
  { score: 81, measurements: [reading("Split", 26, "°F", "15-30°F"), reading("Temp", 41, "°F", "35-38°F")] },
]));
check("an out-of-range reading outranks a projection and a score drop",
  multi.signals[0].kind, "out");
check("severity is the worst signal present", multi.severity, 3);

console.log("\n--- against the seeded demo data ---");
const state = sandbox.window.WilsonStore.load();
const flagged = T.decliningAppliances(state);
const named = (re) => flagged.find((a) => re.test(a.appliance)) || null;

/* The seed is four annual stops across a sixteen-appliance estate. Most of it
   holds steady on purpose: if everything drifted, a flag would mean nothing. */
check("the flagged set is a minority of the portfolio",
  flagged.length < state.assets.filter((a) => a.householdId === "hh_reynolds").length / 2, true);
check("the drifting main refrigerator is flagged", Boolean(named(/BI-48S/)), true);
check("the outdoor refrigerator losing its set point is flagged", Boolean(named(/TUR-24/)), true);
check("the dryer with a restricting vent is flagged", Boolean(named(/DF7004/)), true);
check("the flat dishwasher is NOT flagged",
  flagged.some((a) => /Main Kitchen - Left|DW2450/.test(a.appliance) && !/Right/.test(a.appliance)), false);
check("the steady guest washer is NOT flagged", Boolean(named(/FF7009/)), false);
check("the wine storage holding its set point is NOT flagged", Boolean(named(/UW-24/)), false);
check("the Davenport household, on a single visit, produces no signals",
  flagged.some((a) => a.householdId === "hh_davenport"), false);
check("the main refrigerator carries all three signal kinds",
  kinds(named(/BI-48S/)).sort(), ["out", "projected", "score"]);
check("every signal carries the numbers behind it",
  flagged.every((a) => a.signals.every((s) => /\d/.test(s.detail))), true);
check("severity is ordered worst-first",
  flagged.every((a, i) => i === 0 || flagged[i - 1].severity >= a.severity), true);

console.log(fail ? `\n${fail} FAILURE(S)` : "\nALL DECLINE DETECTION CHECKS PASSED");
process.exit(fail ? 1 : 0);

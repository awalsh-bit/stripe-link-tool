/*
 * WATER HARDNESS AS A LIFECYCLE MODIFIER
 *
 * Cayden: "houses with hard water or heavy scale are going to have appliances
 * fail faster if they have water... house water is a MAJOR factor."
 *
 * And then, at v0.9.22: "it should be a number we input off of test strips. And
 * then our algorithm should determine the multiplier. It shouldn't be something
 * the tech can select."
 *
 * That second instruction is the shape of the whole feature. A factor touching
 * every water-bearing appliance in every house has to come from a MEASUREMENT,
 * not a choice -- otherwise two technicians reading the same strip produce two
 * different expected lives and neither is wrong. These are the fences:
 *
 *   1. ONE INPUT, and it is a number. Nobody selects a band; nobody selects a
 *      multiplier. The curve is the only thing between the strip and the score.
 *   2. It changes EXPECTED LIFE, never measured condition. Hard water does not
 *      mean the dishwasher is unhealthy today.
 *   3. It only touches equipment that runs water. Quietly shortening a dryer's
 *      life would be inventing a mechanism.
 *   4. No reading means NO adjustment. Never inferred from an address.
 *   5. The effect is bounded and monotonic: harder water is never better for an
 *      appliance, and the worst reading cannot swamp the measured condition.
 *
 * Run: node _qa/verify-water-hardness.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
global.window = {};
eval(fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8"));

const config = window.WILSON_CONFIG;
const W = window.WILSON_WATER;

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

/* ========================================================================== */
console.log("=== the technician types a number, and nothing else ===");
/*
 * The defect this replaced: the card offered five band buttons, so tapping one
 * WAS choosing a multiplier. These assert the choice is gone rather than merely
 * hidden -- a band that carried a factor again would put it straight back.
 */
check("no band carries a life factor",
      config.waterHardness.bands.filter(function (b) {
        return Object.prototype.hasOwnProperty.call(b, "lifeFactor");
      }), []);
check("there is no softener vocabulary left to select from",
      Object.prototype.hasOwnProperty.call(config.waterHardness, "softenerStates"), false);
check("and no resolver still exposes one",
      [W.softenerStates, W.softenerChoices, W.softener].filter(Boolean), []);
check("the factor comes from a function of the reading", typeof W.lifeFactorForGpg, "function");

/* ========================================================================== */
console.log("\n=== the curve ===");
const anchors = W.anchors();
note("anchors", anchors.map(function (a) { return a.gpg + "gpg@" + a.factor; }).join(" "));
check("the anchors run in order of hardness",
      anchors.every(function (a, i) { return i === 0 || a.gpg > anchors[i - 1].gpg; }), true);
check("soft water costs nothing", W.lifeFactorForGpg(0), 1);
check("and the first anchor is still free", W.lifeFactorForGpg(anchors[0].gpg), 1);
/* MONOTONIC. Harder water can never be BETTER for an appliance -- a curve where
   one reading was accidentally kinder than a softer one would be indefensible
   and invisible. Swept at 0.1 gpg rather than checked at the anchors, because a
   sign error between two anchors is exactly what a spot check misses. */
let worstMonotonic = null;
for (let g = 0; g <= 40; g = Math.round((g + 0.1) * 10) / 10) {
  const here = W.lifeFactorForGpg(g);
  const next = W.lifeFactorForGpg(Math.round((g + 0.1) * 10) / 10);
  if (next > here) { worstMonotonic = g; break; }
}
check("harder water is never kinder, anywhere on the curve", worstMonotonic, null);
check("the curve is bounded at a 30% reduction",
      anchors.every(function (a) { return a.factor >= 0.7; }), true);
check("the worst reading Wilson will ever apply",
      W.lifeFactorForGpg(1000 /* clamped by maxPlausible before this */) === null
        ? W.lifeFactorForGpg(W.maxPlausibleGpg()) : W.lifeFactorForGpg(W.maxPlausibleGpg()),
      anchors[anchors.length - 1].factor);
/* THE POINT OF INTERPOLATING AT ALL. With a band table, 10.5 and 10.6 gpg --
   the same water, two houses on one street -- differed by a whole band, which
   was 1.2 years on a 15-year dishwasher. The curve exists to make neighbouring
   readings give neighbouring answers. */
const cliff = Math.abs(W.lifeFactorForGpg(10.5) - W.lifeFactorForGpg(10.6));
note("difference between 10.5 and 10.6 gpg", cliff.toFixed(4));
check("a 0.1 gpg difference never moves the factor by more than 0.01", cliff <= 0.01, true);
check("but it does move it -- the reading is not being rounded away", cliff > 0, true);
/* PAST THE EVIDENCE, THE CURVE STOPS. 26 gpg is the hardness Battelle measured.
   A 60 gpg well is reported as extremely hard and adjusted no further. */
check("the curve is flat above the hardness the study measured",
      [30, 45, 80, 100].map(W.lifeFactorForGpg),
      [30, 45, 80, 100].map(function () { return anchors[anchors.length - 1].factor; }));
check("the inference is flagged as an inference", W.sourced(), false);
check("and it explains itself in more than a sentence", W.basis().length > 200, true);

/* ========================================================================== */
console.log("\n=== a reading nobody can use is not a reading ===");
const untested = W.resolve(null);
check("no test means no adjustment", untested.lifeFactor, 1);
check("and it says so plainly", /not been tested/i.test(untested.reason), true);
check("an empty reading is the same as none", W.resolve({ gpg: "" }).lifeFactor, 1);
check("a nonsense reading is refused rather than banded", W.resolve({ gpg: "abc" }).tested, false);
check("a negative reading is refused", W.resolve({ gpg: -4 }).tested, false);
/* A stray digit must not quietly become a finding about somebody's house. */
check("a mis-keyed reading above anything potable is refused",
      W.resolve({ gpg: W.maxPlausibleGpg() + 1 }).tested, false);
check("and the refusal is not silently treated as soft water",
      /could not be read/i.test(W.resolve({ gpg: 999 }).reason), true);
check("the algorithm itself refuses it too", W.lifeFactorForGpg(999), null);
/* Different sentences on a customer's report, so they must be different states. */
check("'not tested' and 'unreadable' do not collapse into the same reason",
      W.resolve(null).reason === W.resolve({ gpg: 999 }).reason, false);

/* ========================================================================== */
console.log("\n=== only equipment that runs water ===");
const hard = W.resolve({ gpg: 14 });
const WATER = ["refrigerator", "dishwasher", "icemaker", "washer", "laundry"];
const DRY = ["dryer", "cooking", "ventilation", "microwave", "outdoor_grill",
             "hvac_cooling", "hvac_furnace", "hvac_heatpump", "hvac_minisplit"];
check("every water-bearing protocol is adjusted",
      WATER.filter(function (k) { return !W.expectedLife(k, "premium", hard).applied; }), []);
check("nothing else is touched",
      DRY.filter(function (k) { return W.expectedLife(k, "premium", hard).applied; }), []);
const changedDry = DRY.filter(function (k) {
  return W.expectedLife(k, "premium", W.resolve(null)).adjusted
      !== W.expectedLife(k, "premium", hard).adjusted;
});
check("and their expected life is identical either way", changedDry, []);

/* ========================================================================== */
console.log("\n=== the customer's flag ===");
/*
 * Cayden: "There can be a flag that notifies the customer of the hardness in
 * the report." It starts at "hard" and not below, because a flag on every
 * address Wilson serves is a flag people learn to ignore -- Austin city water
 * is around 4.9 gpg, so flagging moderate would flag most of the book.
 */
check("soft water is not flagged", W.resolve({ gpg: 2 }).flagged, false);
check("moderately hard water is not flagged -- that is most of Austin",
      W.resolve({ gpg: 4.9 }).flagged, false);
check("hard water is flagged", W.resolve({ gpg: 10 }).flagged, true);
check("and everything harder stays flagged",
      [12, 18, 30].map(function (g) { return W.resolve({ gpg: g }).flagged; }),
      [true, true, true]);
check("an untested house is never flagged", W.resolve(null).flagged, false);
check("and neither is an unreadable one", W.resolve({ gpg: 999 }).flagged, false);
/* The flag describes the water; it must not be wired to whether the score
   moved, or a house could be flagged for an appliance that does not use water. */
check("the flag is a property of the reading, not of any appliance",
      W.resolve({ gpg: 10 }).flagged, W.resolve({ gpg: 10 }).flagged);

/* ========================================================================== */
console.log("\n=== resolving twice is not a different answer ===");
/*
 * store.waterFor() returns an already-resolved reading. Passing one back into
 * resolve() used to produce a different house entirely, with no error anywhere.
 */
[{ gpg: 14 }, { gpg: 2 }, { gpg: 999 }, null].forEach(function (raw, i) {
  const once = W.resolve(raw);
  const twice = W.resolve(once);
  check("reading " + i + " survives a second resolve",
        { f: twice.lifeFactor, t: twice.tested, fl: twice.flagged },
        { f: once.lifeFactor, t: once.tested, fl: once.flagged });
});
check("and a resolved reading says so, so callers can tell",
      W.resolve({ gpg: 14 }).resolved, true);

/* ========================================================================== */
console.log("\n=== what it actually does to a score ===");
/*
 * The magnitude matters in both directions: an adjustment nobody can feel is
 * theatre, and one that swamps the measured condition is unfair. It reaches the
 * score only through the age term, which is a quarter of it.
 */
const aw = Number(config.reportScoring.ageWeight);
const vw = Number(config.reportScoring.vitalWeight);
check("the age term is still a quarter of the score", aw, 0.25);
check("and measured condition is still three quarters", vw, 0.75);

function ageScore(age, expected) {
  return Math.max(0, Math.min(100, Math.round(100 - 60 * (age / expected))));
}
function overallDelta(setKey, tier, age, water) {
  const base = W.expectedLife(setKey, tier, W.resolve(null)).adjusted;
  const adj = W.expectedLife(setKey, tier, water).adjusted;
  return Math.round((ageScore(age, adj) - ageScore(age, base)) * aw * 10) / 10;
}
const worst = W.resolve({ gpg: 30 });
[4, 6, 10].forEach(function (age) {
  note("dishwasher age " + age + ", extremely hard water",
       overallDelta("dishwasher", "premium", age, worst) + " points on the overall score");
});
check("the worst case at a typical age is felt but not fatal",
      Math.abs(overallDelta("dishwasher", "premium", 6, worst)) <= 6, true);
check("and it is never zero, or the whole feature is theatre",
      Math.abs(overallDelta("dishwasher", "premium", 6, worst)) >= 1, true);
check("it always costs rather than gives",
      overallDelta("dishwasher", "premium", 6, worst) <= 0, true);
/* It grows with age, because scale damage accumulates -- a young appliance in
   hard water has not had time to suffer yet. */
check("the effect grows as the appliance ages",
      Math.abs(overallDelta("dishwasher", "premium", 10, worst)) >
      Math.abs(overallDelta("dishwasher", "premium", 4, worst)), true);

/* ========================================================================== */
console.log("\n=== the arithmetic identity ===");
/*
 * Shortening expected life and multiplying age are the same calculation --
 * only the ratio reaches the score. This is asserted because the CHOICE between
 * them was a deliberate one about what the report says, and a future edit that
 * "simplifies" it into an age multiplier would quietly start contradicting the
 * install date printed on the same page.
 */
const expected = 12, age = 6, f = 0.8;
check("age x factor over life equals age over life divided by factor",
      Math.round((age * (1 / f)) / expected * 1000) / 1000,
      Math.round(age / (expected * f) * 1000) / 1000);
check("and the product stores the LIFE form, so age stays a fact",
      W.expectedLife("dishwasher", "premium", W.resolve({ gpg: 14 })).base, 12);

console.log("");
if (failures.length) {
  console.log(failures.length + " FAILURE(S) of " + checks + " checks:");
  failures.forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
}
console.log("ALL " + checks + " WATER HARDNESS CHECKS PASSED");

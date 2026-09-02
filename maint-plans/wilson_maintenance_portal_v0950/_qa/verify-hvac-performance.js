/*
 * HVAC performance, scoring and the planning horizon.
 *
 * Most of what follows is not testing that the arithmetic works. It is testing
 * that the GUARDRAILS hold, because the guardrails are the product:
 *
 *   - a low-efficiency system in good condition must score exactly the same as
 *     a high-efficiency system with identical readings
 *   - age must never, by any route, reduce a health score
 *   - a serviceable fault with life remaining must never reach a replacement
 *     posture
 *   - a number must not be published when there is not enough behind it
 *   - no derived value may rest on refrigerant or psychrometric data this
 *     build cannot verify
 *
 * A regression in any of those turns a maintenance tool into a replacement
 * funnel, quietly, and it would pass any test that only checked the maths.
 *
 * Run: node _qa/verify-hvac-performance.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");

const sb = { window: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, console };
vm.createContext(sb);
["assets/plan-config.js", "assets/hvac-performance.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb));

const H = sb.window.WILSON_HVAC;
const C = sb.window.WILSON_CONFIG;
const R = sb.window.WILSON_PROTOCOL.resolveCheckpointSet;

let fail = 0, checks = 0;
function check(label, got, want) {
  checks += 1;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(70)} ${JSON.stringify(got)}`);
}
function note(label, value) { console.log(`      ${label.padEnd(70)} ${value}`); }

/* A three-ton system in genuinely good measured condition. */
const PLATE = { ratedTons: 3, maxEsp: 0.5, condenserRla: 18.2, blowerFla: 7.5, refrigerant: "R-410A", meteringDevice: "TXV" };
const GOOD = {
  returnDb: 75, supplyDb: 56,
  returnStatic: 0.20, supplyStatic: 0.25,
  suctionSat: 45, suctionLine: 57,
  liquidSat: 105, liquidLine: 108,
  outdoorAir: 95, condenserAmps: 16.5, measuredCfm: 1200
};
const RATED_WELL = { hvac_refrigerant: 5, hvac_airside: 5 };
const score = (readings, design, ratings, set) => H.scoreHealth({
  readings: readings, design: design, ratings: ratings || RATED_WELL, checkpointSet: set || "hvac_cooling"
});

console.log("--- the guardrail: efficiency rating cannot move the health score ---");
/* The specific thing Wilson asked for. A 13-SEER system meeting its design is
   a healthy system, and must not be docked for not being a 20-SEER system. */
const seerScores = [13, 14, 16, 18, 20, 24].map((seer) =>
  score(GOOD, Object.assign({}, PLATE, { ratedSeer: seer })).score);
note("scores at 13/14/16/18/20/24 SEER", seerScores.join(", "));
check("every SEER rating scores identically on identical readings",
  new Set(seerScores).size, 1);
check("and that score is full marks for a system meeting its design",
  seerScores[0], 100);
check("AFUE cannot move a furnace score either",
  [70, 80, 90, 98].map((afue) => score(
    { returnDb: 70, supplyDb: 115, returnStatic: 0.20, supplyStatic: 0.22, blowerAmps: 6.8 },
    Object.assign({}, PLATE, { riseRangeLow: 30, riseRangeHigh: 60, ratedAfue: afue }),
    { hvac_airside: 5 }, "hvac_furnace"
  ).score).filter((v, i, a) => a.indexOf(v) === i).length, 1);

console.log("\n--- the guardrail: age cannot move the health score ---");
/* scoreHealth is not given age at all -- this asserts that passing it anyway
   changes nothing, so a future caller cannot smuggle it in. */
const withAge = H.scoreHealth({
  readings: GOOD, design: PLATE, ratings: RATED_WELL,
  checkpointSet: "hvac_cooling", ageYears: 19, age: 19, lifeUsed: 1.3
});
check("passing an age to the scorer does not change the score", withAge.score, score(GOOD, PLATE).score);
check("no scored dimension is named for age or efficiency",
  (withAge.scored || []).filter((d) => /age|efficien|seer|afue/i.test(d.id + d.label)).length, 0);
check("the config records both as reported-not-scored",
  Object.keys(C.hvacScoring.reportedNotScored).sort(), ["age", "efficiency"]);
check("and no scoring dimension exists for either",
  Object.keys(C.hvacScoring.dimensions).filter((k) => /age|effic/i.test(k)), []);
check("the dimension weights total 1",
  Object.values(C.hvacScoring.dimensions).reduce((a, d) => a + d.weight, 0), 1);

console.log("\n--- faults are still caught ---");
/* A guardrail that suppressed real faults would be worse than the nudge. */
const restricted = score(Object.assign({}, GOOD, { returnStatic: 0.45, supplyStatic: 0.50 }), PLATE);
check("a duct at nearly twice the rated static is docked", restricted.score < 90, true);
check("and the dimension named is static pressure",
  restricted.scored.filter((d) => d.pct < 100).map((d) => d.id), ["static"]);
const overAmp = score(Object.assign({}, GOOD, { condenserAmps: 22 }), PLATE);
check("a condenser drawing over nameplate RLA is docked", overAmp.score < 100, true);
const lowAir = score(Object.assign({}, GOOD, { measuredCfm: 850 }), PLATE);
check("airflow well under the design range is docked", lowAir.score < 100, true);

console.log("\n--- one reading may not be docked twice ---");
/* The first version proxied capacity from CFM per ton, which is the reading the
   airflow dimension already scores -- so one measurement drove half the score
   under two names. */
check("low airflow docks exactly one dimension",
  lowAir.scored.filter((d) => d.pct < 100).map((d) => d.id), ["airflow"]);
check("cooling capacity is reported as needing a measurement this build lacks",
  (score(GOOD, PLATE).notScored || []).find((d) => d.id === "capacity").reason,
  "needs-delivered-heat-measurement");

console.log("\n--- a number is not published without enough behind it ---");
const noPlate = score(GOOD, { ratedSeer: 14 });
check("a system with no nameplate data gets NO health score", noPlate.available, false);
check("its coverage is reported rather than hidden", noPlate.coverage < 60, true);
check("the readings it did take are still returned", noPlate.scored.length > 0, true);
check("and the reason names what is missing",
  /not enough for a health score/i.test(noPlate.reason), true);
check("the missing plate fields can be listed by name",
  H.missingPlateData({ ratedSeer: 14 }).map((f) => f.key).includes("ratedTons"), true);
check("nothing measurable at all is not a score of zero",
  score({}, {}, {}).score, null);

console.log("\n--- derived readings are arithmetic on entered values ---");
const d = {};
H.derivedFor(GOOD, PLATE, "hvac_cooling").forEach((row) => { d[row.id] = row.value; });
check("superheat = suction line - suction saturation", d.superheat, 12);
check("subcooling = liquid saturation - liquid line", d.subcooling, -3);
check("approach = liquid line - outdoor air", d.approach, 13);
check("temperature split = return - supply", d.deltaT, 19);
check("total static = supply + return", d.totalStatic, 0.45);
check("amps as a percentage of nameplate RLA", d.ampsOfRla, 91);
check("furnace rise = supply - return",
  H.derived.temperatureRise.compute({ returnDb: 70, supplyDb: 115 }), 45);

console.log("\n--- missing inputs stay missing ---");
check("no saturation temperature, no superheat", H.derived.superheat.compute({ suctionLine: 57 }), null);
check("no ambient, no approach", H.derived.approach.compute({ liquidLine: 108 }), null);
check("no plate RLA, no amp percentage", H.derived.ampsOfRla.compute({ condenserAmps: 16 }, {}), null);
check("a derived value of zero is a real value, not a missing one",
  H.derived.deltaT.compute({ returnDb: 75, supplyDb: 75 }), 0);
check("only readings that exist are returned",
  H.derivedFor({ returnDb: 75, supplyDb: 56 }, PLATE, "hvac_cooling").map((r) => r.id), ["deltaT"]);

console.log("\n--- nothing rests on refrigerant or psychrometric data we cannot verify ---");
const source = fs.readFileSync(path.join(ROOT, "assets", "hvac-performance.js"), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
/* If any of these ever appears in the CODE, someone has written a property
   table or a psychrometric formula from memory, and every value downstream of
   it becomes unverifiable. */
["R410A_TABLE", "SATURATION_TABLE", "enthalpyOf", "wetBulbFrom", "PT_CHART"].forEach((token) => {
  check(`no ${token} in the code`, code.includes(token), false);
});
check("saturation temperature is an entered field, not computed",
  C.checkpointSets.hvac_cooling
    .find((c) => c.id === "hvac_refrigerant").readingFields
    .filter((f) => /suctionSat|liquidSat/.test(f.key)).length, 2);
check("delivered efficiency is explicitly null rather than estimated",
  H.efficiencyNote({ ratedSeer: 14 }).delivered, null);
check("and the efficiency note says it is not in the score",
  H.efficiencyNote({ ratedSeer: 14 }).scoredIntoHealth, false);
check("no efficiency note at all without a rating on record",
  H.efficiencyNote({}), null);

console.log("\n--- protocols resolve by system type ---");
[["Split System", "hvac_cooling"], ["Heat Pump", "hvac_heatpump"], ["Gas Furnace", "hvac_furnace"],
 ["Mini-Split", "hvac_minisplit"], ["Packaged Unit", "hvac_cooling"]].forEach(([type, want]) => {
  check(`${type} resolves to ${want}`, R({ type: type, group: "hvac", checkpointSet: "generic" }), want);
});
check("an unclassified system is left visible as a gap, not given a protocol",
  R({ type: "Other", group: "hvac", checkpointSet: "generic" }), "generic");
check("no HVAC protocol is the old three-check stub",
  ["hvac_cooling", "hvac_heatpump", "hvac_furnace", "hvac_minisplit"]
    .filter((k) => C.checkpointSets[k].length <= 3), []);
check("every HVAC system type has an expected-life row",
  ["hvac_cooling", "hvac_heatpump", "hvac_furnace", "hvac_minisplit"]
    .filter((k) => !C.lifecycleMatrix[k]), []);
check("the nine readings are all present on the cooling protocol",
  C.checkpointSets.hvac_cooling
    .reduce((keys, c) => keys.concat((c.readingFields || []).map((f) => f.key)), [])
    .filter((k) => ["returnDb", "supplyDb", "returnStatic", "supplyStatic", "suctionSat",
                    "suctionLine", "liquidSat", "liquidLine", "outdoorAir"].includes(k)).length, 9);

console.log("\n--- the planning horizon builds a pipeline, it does not expedite one ---");
const healthyDims = { available: true, score: 98, scored: [{ id: "static", label: "Static pressure", pct: 100 }] };
const faultedDims = { available: true, score: 78, scored: [{ id: "static", label: "Static pressure", pct: 40, basis: "nameplate maximum" }] };
const horizon = (age, expected, health, decline) => H.planningHorizon({
  ageYears: age, expectedYears: expected, ageDocumented: true, health: health, decline: decline
});

/* THE central case. A system past its rated life that measures perfectly must
   not be told to plan a replacement. */
const oldButWell = horizon(18, 15, healthyDims);
check("18 years old and measuring perfectly is not a replacement case",
  oldButWell.horizon.code, "watch");
check("its guidance says nothing needs doing",
  /nothing needs doing/i.test(oldButWell.guidance), true);
check("a healthy system mid-life has nothing to plan for",
  horizon(5, 15, healthyDims).horizon.code, "settled");
check("late in life and healthy is 'worth knowing', never 'plan ahead'",
  horizon(14, 15, healthyDims).horizon.code, "watch");

/* The guard, from both directions. */
check("a serviceable fault with life left is a repair",
  horizon(8, 15, faultedDims).horizon.code, "service");
check("even a heavily faulted system with life left is a repair",
  horizon(3, 15, { available: true, score: 55, scored: [{ id: "static", label: "Static", pct: 20 }] }).horizon.code,
  "service");
check("only past expected life AND faulted reaches budgeting",
  horizon(17, 15, faultedDims).horizon.code, "budget");
/*
 * The first version of this check matched the substring "replace it now" and
 * flagged the "budget" horizon -- whose sentence is "nothing here says replace
 * it now". It read a disclaimer as a recommendation, which is the same mistake
 * the offline checker made reading its own comments.
 *
 * So negated clauses are removed before matching. What is left is any sentence
 * that actually tells a customer to replace something.
 */
const withoutNegations = (text) => String(text)
  .replace(/\bnothing (here )?says[^.\u2014]*/gi, "")
  .replace(/\bnot a replacement[^.\u2014]*/gi, "")
  .replace(/\bnever[^.\u2014]*/gi, "")
  .replace(/\brather than replac[^.\u2014]*/gi, "");
check("no horizon actually tells the customer to replace anything",
  Object.values(H.horizons)
    .filter((h) => /\b(replace|replacement) (it|now|this|today|soon)\b/i.test(withoutNegations(h.lead)))
    .map((h) => h.code), []);
check("and the same holds for every guidance sentence",
  [[5, 15, healthyDims], [14, 15, healthyDims], [18, 15, healthyDims],
   [8, 15, faultedDims], [17, 15, faultedDims]]
    .map(([a, e, h]) => horizon(a, e, h).guidance)
    .filter((g) => /\b(replace|replacement) (it|now|this|today|soon)\b/i.test(withoutNegations(g))), []);
check("no horizon invents a cost",
  Object.values(H.horizons).filter((h) => /\$|\bdollar|\bcost you\b/i.test(h.lead)).length, 0);

console.log("\n--- an unknown age is never filled in ---");
const noAge = H.planningHorizon({ ageYears: null, expectedYears: 15, ageDocumented: false, health: healthyDims });
check("no install date yields no horizon rather than a guess", noAge.horizon.code, "unknown");
check("and it says so", /no honest way/i.test(noAge.horizon.lead), true);
check("an age of zero is a real age, not a missing one",
  H.planningHorizon({ ageYears: 0, expectedYears: 15, ageDocumented: true, health: healthyDims }).ageKnown, true);
check("a fault is still reported when the age is unknown",
  H.planningHorizon({ ageYears: null, expectedYears: 15, health: faultedDims }).horizon.code, "service");

console.log("\n--- the horizon says what it rests on ---");
check("a documented age is described as documented",
  /documented install date/i.test(horizon(8, 15, healthyDims).basis), true);
check("an unverified age is described as unverified",
  /not verified against a document/i.test(
    H.planningHorizon({ ageYears: 8, expectedYears: 15, ageDocumented: false, health: healthyDims }).basis), true);
check("and the draft expected life is called a draft",
  /draft expected service life/i.test(horizon(8, 15, healthyDims).basis), true);

console.log(fail ? `\n${fail} FAILURE(S) of ${checks} checks` : `\nALL ${checks} HVAC CHECKS PASSED`);
process.exit(fail ? 1 : 0);

/*
 * Longevity guidance.
 *
 * Wilson sold most of these appliances to these customers, so the rule that
 * matters most is the one that stops the tool recommending replacement of
 * something it should be keeping alive. Most of these checks exist to hold that
 * guard in place.
 *
 * Run: node _qa/verify-lifecycle-advice.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");
const sb = { window: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, console };
vm.createContext(sb);
/* Real config, not a stub: the seed derives protocols and grade bands from it. */
["assets/plan-config.js", "assets/store.js", "assets/trend-analysis.js", "assets/lifecycle-advice.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb));
const L = sb.window.WILSON_LIFECYCLE, T = sb.window.WILSON_TRENDS;

let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(66)} ${JSON.stringify(got)}`);
}

const report = (age, expected, vital) => {
  const ageScore = Math.round(100 - 60 * (age / expected));
  return { lifecycle: { age, expectedYears: expected, tier: "luxury", ageScore, vitalScore: vital,
                        stage: "", lifeRatio: age / expected },
           score: Math.round(vital * 0.75 + ageScore * 0.25) };
};
const declineWith = (kinds) => ({ signals: kinds.map((k) => ({ kind: k, label: "Test reading", headline: "h", detail: "d" })) });

console.log("--- the guard: never push replacement on a serviceable appliance with life left ---");
check("mid-life with a serviceable cause is a service job",
  L.assess(report(12, 20, 80), declineWith(["out", "score"])).posture.code, "service");
check("even a steep score drop does not reach replacement while life remains",
  L.assess(report(10, 20, 60), declineWith(["out", "projected", "score"])).posture.code, "service");
check("late life with a serviceable cause is still a service job",
  L.assess(report(19, 20, 70), declineWith(["projected"])).posture.code, "service");
check("only past expected life does planning appear",
  L.assess(report(22, 20, 70), declineWith(["out"])).posture.code, "plan");

console.log("\n--- the ordinary cases ---");
check("healthy and mid-life: keep maintaining",
  L.assess(report(8, 20, 96), null).posture.code, "maintain");
check("healthy but late in life: worth planning around, not replacing",
  L.assess(report(18, 20, 94), null).posture.code, "watch");
check("past expected life but nothing wrong is not a replacement case",
  L.assess(report(22, 20, 96), null).posture.code, "watch");
check("young but in poor condition is a service job, not a lemon to replace",
  L.assess(report(2, 20, 62), null).posture.code, "service");

console.log("\n--- arithmetic ---");
const a = L.assess(report(12, 20, 80), declineWith(["out"]));
check("life used is reported as a share of expected", a.lifeUsedPct, 60);
check("remaining years are reported", a.remainingYears, 8);
/* An unusable lifecycle block now returns WHY rather than a bare null, so a page
   can say "age not established" instead of silently dropping the section. The
   distinction that matters is that it is never mistaken for guidance. */
const noAge = L.assess({ score: 80 }, null);
check("no lifecycle data yields no guidance", noAge.unavailable, true);
check("and it says which fact is missing", noAge.reason, "no-age");
check("a missing report yields no assessment", L.assess(null, null), null);

console.log("\n--- an unestablished age is never treated as age zero ---");
/* The bug this whole change exists to prevent, asserted from both directions. */
const zeroish = { score: 72, lifecycle: { age: null, expectedYears: 15, tier: "premium", vitalScore: 72, ageScore: null } };
check("a null age is unavailable, not brand new", L.assess(zeroish, null).unavailable, true);
check('an empty-string age is too', L.assess({ score: 72, lifecycle: { age: "", expectedYears: 15 } }, null).unavailable, true);
check("an explicit age of zero is still a real age",
  L.assess({ score: 96, lifecycle: { age: 0, expectedYears: 15, tier: "luxury", vitalScore: 96, ageScore: 100 } }, null).unavailable, false);

console.log("\n--- economics: only ever from supplied costs ---");
check("no costs, no economics", L.economics(a, null), null);
check("a missing replacement cost yields nothing", L.economics(a, { repairCost: 800 }), null);
const e = L.economics(a, { repairCost: 850, replacementCost: 9500 });
check("repair is costed against the years it actually buys", e.repairBuysYears, 8);
check("replacement is costed against a full expected life", e.replacementBuysYears, 20);
check("cost per year is what gets compared", [e.repairPerYear, e.replacementPerYear], [106, 475]);
check("the arithmetic favours keeping the appliance here", e.favours, "repair");
const even = L.economics(L.assess(report(19, 20, 70), null), { repairCost: 500, replacementCost: 9500 });
check("an even comparison favours what the customer already owns",
  L.economics(L.assess(report(10, 20, 90), null), { repairCost: 4750, replacementCost: 9500 }).favours, "repair");

console.log("\n--- against the seeded history ---");
const state = sb.window.WilsonStore.load();
/* The specific appliance, by model. Matching on /Refrigerator/ picked whichever
   refrigerator happened to be newest, which changed the moment a second
   household was seeded -- and the test then asserted the drift guard against a
   perfectly healthy machine. */
const fridge = state.reports.filter((r) => /BI-48S/.test(r.applianceLabel))
  .sort((x, y) => String(y.inspectionDate).localeCompare(String(x.inspectionDate)))[0];
const seeded = L.assess(fridge, T.forAsset(state, fridge.assetId));
check("the drifting refrigerator is a service job, not a replacement",
  seeded.posture.code, "service");
check("it still has real life left", seeded.remainingYears >= 5, true);
check("the actions name the specific readings that are drifting",
  seeded.actions.length, 2);
check("the seeded score is reproducible from its own vitals",
  Math.round(fridge.lifecycle.vitalScore * 0.75 + fridge.lifecycle.ageScore * 0.25), fridge.score);
check("no seeded vital score exceeds what an inspection can produce",
  state.reports.every((r) => !r.lifecycle || r.lifecycle.vitalScore <= 100), true);

console.log(fail ? `\n${fail} FAILURE(S)` : "\nALL LONGEVITY CHECKS PASSED");
process.exit(fail ? 1 : 0);

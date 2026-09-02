/*
 * WILSON TEMP WATCH.
 *
 * Three promises this suite holds in place:
 *
 * 1. ONE PRICING ENGINE. Monitoring is priced by WILSON_TEMPWATCH and flows
 *    into applianceAnnualCost, the breakdown, and the charge schedule -- the
 *    registration card, the summary, the quote and the enrollment all read
 *    the same figure. No surface multiplies 150 by anything on its own.
 *
 * 2. A FLAG IS SUSTAINED, NEVER A BLIP. A door held open must not page a
 *    technician; a compressor losing the fight must. The rule is "every
 *    reading in the hold window over the limit", and it is tested with both
 *    shapes of data.
 *
 * 3. A DISPATCH CANNOT DOUBLE-FILE. One appliance, one day, one dispatch,
 *    however many times the button is pressed.
 *
 * Run: node _qa/verify-temp-watch.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");

function boot(mutate) {
  const store = {};
  const sb = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
                    removeItem: (k) => { delete store[k]; } },
    console: { log: () => {}, warn: () => {}, error: () => {} }
  };
  sb.window = sb;
  vm.createContext(sb);
  ["assets/plan-config.js", "assets/store.js", "assets/temp-monitoring.js"].forEach(function (f) {
    let src = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (mutate) src = mutate(f, src);
    vm.runInContext(src, sb);
  });
  return sb.window;
}
const W = boot(null);
const TW = W.WILSON_TEMPWATCH, SIM = W.WILSON_TEMPWATCH_SIM, CFG = W.WILSON_CONFIG;

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log((ok ? "ok  " : "FAIL") + "  " + label.padEnd(68) + (detail === undefined ? "" : detail));
}

/* ------------------------------------------------------------------ */
console.log("--- one pricing engine ---");

const fridge = { type: "refrigerator", customerCategory: "refrigeration", tempMonitoringOptIn: true };
const dryer = { type: "dryer", customerCategory: "dryer", tempMonitoringOptIn: true };
const declined = { type: "refrigerator", customerCategory: "refrigeration", tempMonitoringOptIn: false };

/* v0.9.44, approved: member tier $199 first sensor / $99 each additional;
   standalone $299/$149 + $99 install. The household prices, not the asset --
   forAsset answers selection only, total() is the sole money authority. */
const TIERS = CFG.tempMonitoring.pricing;
check("a home's first sensor prices at the member first-sensor rate",
  TW.total([fridge]) === Number(TIERS.member.firstAnnual), TW.total([fridge]));
check("declining it costs nothing", TW.total([declined]) === 0, "");
check("a dryer cannot buy it even with the flag set", TW.total([dryer]) === 0, "");
check("eligibility is refrigeration-category only",
  TW.eligible(fridge) === true && TW.eligible(dryer) === false, "");

const secondFridge = { type: "freezer", customerCategory: "refrigeration", tempMonitoringOptIn: true };
check("the second sensor in the home gets the break",
  TW.total([fridge, secondFridge]) === Number(TIERS.member.firstAnnual) + Number(TIERS.member.additionalAnnual),
  TW.total([fridge, secondFridge]));
check("four sensors read as first + three additional",
  TW.total([fridge, secondFridge, Object.assign({}, fridge), Object.assign({}, fridge)]) ===
    Number(TIERS.member.firstAnnual) + 3 * Number(TIERS.member.additionalAnnual), "");
check("the standalone tier charges more, both slots",
  TW.total([fridge], "standalone") === Number(TIERS.standalone.firstAnnual) &&
  Number(TIERS.standalone.firstAnnual) > Number(TIERS.member.firstAnnual) &&
  Number(TIERS.standalone.additionalAnnual) > Number(TIERS.member.additionalAnnual), "");
check("the standalone install fee exists and carries its plan-credit note",
  Number(TIERS.standalone.installFee) > 0 && /credited/i.test(TIERS.standalone.installCreditNote || ""), "");

/* The annual total and the charge schedule both carry it -- and the schedule
   still sums to the total, which is the assertion that catches a surface
   adding monitoring in one place and not the other. */
const P = W.WILSON_PRICING;
const assets = [fridge, declined];
const withTotal = P.annual(assets, "estate_annual");
const withoutTotal = P.annual([declined, declined], "estate_annual");
check("the annual total moves by exactly the first-sensor price",
  Math.round((withTotal - withoutTotal) * 100) / 100 === Number(TIERS.member.firstAnnual),
  withTotal - withoutTotal);
check("...and a second sensor moves it by the additional rate",
  Math.round((P.annual([fridge, secondFridge], "estate_annual") - withTotal) * 100) / 100 ===
    Number(TIERS.member.additionalAnnual), "");
const schedule = P.chargeSchedule(assets, "estate_annual");
const scheduleSum = Math.round(schedule.reduce(function (t, leg) { return t + leg.amount; }, 0) * 100) / 100;
check("the charge schedule still sums to the annual total",
  scheduleSum === Math.round(withTotal * 100) / 100, scheduleSum + " vs " + withTotal);
const breakdown = P.breakdown(assets, "estate_annual");
check("the breakdown names the sensors and the amount",
  breakdown.tempMonitoringSensors === 1 &&
  breakdown.tempMonitoringAmount === Number(TIERS.member.firstAnnual), "");
check("the pricing status no longer claims to be a draft",
  /approved/i.test(CFG.tempMonitoring.pricingStatus), CFG.tempMonitoring.pricingStatus);

/* ------------------------------------------------------------------ */
console.log("\n--- a flag is sustained, never a blip ---");

const rules = CFG.tempMonitoring.flagRules;
const fridgeAsset = { id: "t1", type: "refrigerator", typeLabel: "Refrigerator" };
function series(fn, count) {
  const points = [];
  for (let i = 0; i < (count || 192); i += 1) {
    const minutesAgo = ((count || 192) - 1 - i) * 15;
    points.push({ minutesAgo: minutesAgo, value: fn(minutesAgo) });
  }
  return points;
}

/* A door blip: 20 minutes warm inside a 45-minute hold window. */
const blip = series(function (m) { return m <= 20 ? 48 : 37; });
check("a 20-minute door-open spike does NOT flag",
  SIM.evaluateFlags(fridgeAsset, blip).flagged === false, "");

/* A dead compressor: over the limit for the whole hold window. */
const dead = series(function (m) { return m <= rules.fresh_food.holdMinutes + 30 ? 47 : 37; });
check("temperature held over the limit for the whole window DOES flag",
  SIM.evaluateFlags(fridgeAsset, dead).flagged === true, "");
check("...and the flag counts how long it has been over",
  SIM.evaluateFlags(fridgeAsset, dead).overForMinutes >= rules.fresh_food.holdMinutes, "");

/* ------------------------------------------------------------------ */
console.log("\n--- the three tiers (v0.9.42, researched) ---");

/* Cayden's own example, verbatim: 48° in a 37° fridge, persisting over an
   hour. Past the dispatch line (45°) for over its hold (60 min) -> truck. */
const caydens = series(function (m) { return m <= 70 ? 48 : 37; });
const caydensFlag = SIM.evaluateFlags(fridgeAsset, caydens);
check("Cayden's example -- 48° persisting over an hour -- dispatches",
  caydensFlag.flagged === true && caydensFlag.tier === "dispatch", caydensFlag.tier);

/* Past the food-safety line but short of the dispatch line: a WARNING, not a
   truck. 43° is over maxF 41 but under dispatchF 45. */
const warmish = series(function (m) { return m <= rules.fresh_food.holdMinutes + 30 ? 43 : 37; });
const warmFlag = SIM.evaluateFlags(fridgeAsset, warmish);
check("sustained past the warning line alone is tier warn, not a dispatch",
  warmFlag.tier === "warn" && warmFlag.flagged === false, warmFlag.tier);

/* THE RECOVERY RULE: a slow sealed-system decline sits at 43° -- never near
   the dispatch line -- but has not re-crossed the warning line for over
   recoverWithinMinutes. That IS Cayden's "failing to recover" and it rolls
   the truck. */
const creeping = series(function (m) { return m <= rules.fresh_food.recoverWithinMinutes + 30 ? 43 : 37; });
const creepFlag = SIM.evaluateFlags(fridgeAsset, creeping);
check("failing to recover within the window dispatches WITHOUT reaching the dispatch line",
  creepFlag.flagged === true && creepFlag.tier === "dispatch", creepFlag.tier);
check("...and the reason says so", /recover/i.test(creepFlag.reason || ""), creepFlag.reason);

/* The thresholds carry their provenance: warning at the FDA line, dispatch at
   Sub-Zero's own service heuristic. */
check("fresh-food warning sits on the FDA cold-holding line", rules.fresh_food.maxF === 41, "");
check("fresh-food dispatch sits on the Sub-Zero unsafe-for-food line", rules.fresh_food.dispatchF === 45, "");
check("every band declares all three rules", ["fresh_food", "freezer", "wine"].every(function (k) {
  const r = rules[k];
  return r.maxF !== undefined && r.holdMinutes !== undefined && r.dispatchF !== undefined &&
         r.dispatchHoldMinutes !== undefined && r.recoverWithinMinutes !== undefined && r.setpointF !== undefined;
}), "");
check("the offline rule decides before the 4-hour food-safety window closes",
  rules.offline.holdMinutes <= 180, String(rules.offline.holdMinutes));
check("wine gets hours, not minutes -- its damage clock is slow",
  rules.wine.holdMinutes >= 180 && rules.wine.dispatchHoldMinutes >= 240, "");

/* The right band per appliance. */
const wine = { id: "t2", type: "wine_beverage", typeLabel: "Wine Storage" };
check("wine storage is judged against the wine rule, not the fridge rule",
  SIM.bandFor(wine).key === "wine", SIM.bandFor(wine).key);
const wineWarm = series(function (m) { return 45; });   /* fine for wine, fatal for a fridge */
check("55°F wine storage does not flag as a warm refrigerator",
  SIM.evaluateFlags(wine, wineWarm).flagged === false, "");

/* The demo fleet: exactly one seeded unit fails, and it is the declining
   Sub-Zero whose story the maintenance history already tells. */
const state = W.WilsonStore.load();
const fleet = SIM.fleet(state);
check("the seed enrolls sensors", fleet.length >= 3, fleet.length);

/* ------------------------------------------------------------------ */
console.log("\n--- a sensor is a compartment (v0.9.47) ---");

/* Cayden: "Some will want a sensor in freezer and refrigerator compartments
   on same unit." One appliance, two probes, two rules, two fleet rows --
   and two sensors on the household's price ladder. */
const twoProbe = { id: "col1", type: "refrigerator", typeLabel: "Refrigerator",
  customerCategory: "refrigeration", tempMonitoringOptIn: true,
  tempMonitoringCompartments: ["fresh_food", "freezer"] };
check("a two-compartment appliance counts two sensors",
  TW.forAsset(twoProbe).sensors === 2, TW.forAsset(twoProbe).sensors);
check("...and prices as first + additional on the ladder",
  TW.total([twoProbe]) === Number(TIERS.member.firstAnnual) + Number(TIERS.member.additionalAnnual),
  TW.total([twoProbe]));
const colRows = SIM.fleet({ assets: [Object.assign({ householdId: "x" }, twoProbe)], households: [] });
check("the hub shows one row per probe", colRows.length === 2, colRows.length);
check("each probe is judged by its OWN rule",
  colRows.some(function (r) { return r.flag.band.key === "fresh_food"; }) &&
  colRows.some(function (r) { return r.flag.band.key === "freezer"; }), "");
check("the two probes tell different stories (distinct deterministic series)",
  JSON.stringify(colRows[0].points.slice(0, 5)) !== JSON.stringify(colRows[1].points.slice(0, 5)), "");
check("a wine unit only offers a wine probe",
  JSON.stringify(TW.compartmentsFor({ customerCategory: "refrigeration", type: "wine_beverage", typeLabel: "Wine Column" }).allowed),
  JSON.stringify(["wine"]));
check("a refrigerator offers fresh food and freezer, defaults to one sensor",
  (function () {
    const s = TW.compartmentsFor({ customerCategory: "refrigeration", type: "refrigerator" });
    return s.allowed.length === 2 && s.defaults.length === 1 && s.defaults[0] === "fresh_food";
  })(), "");
check("a legacy record with no compartments still counts one sensor",
  TW.forAsset({ customerCategory: "refrigeration", type: "refrigerator", tempMonitoringOptIn: true }).sensors === 1, "");
check("the seeded two-probe Thermador puts both compartments on the fleet",
  fleet.filter(function (r) { return r.asset.model === "T36BT925NS"; }).length === 2, "");
const flagged = fleet.filter(function (r) { return r.flag.flagged; });
check("exactly one seeded unit is failing", flagged.length === 1,
  flagged.map(function (r) { return r.asset.model; }).join(","));
check("...and it is the Reynolds Sub-Zero, the appliance already declining",
  flagged.length === 1 && flagged[0].asset.model === "BI-48S", "");
check("every fleet row admits its readings are simulated",
  fleet.every(function (r) { return r.simulated === true; }), "");

/* ------------------------------------------------------------------ */
console.log("\n--- the cube's numbers: summarize() ---");

/* A hand-built series with two known excursions: one 30-minute door event and
   one 60-minute real excursion. The stats must count TRIPS, not readings. */
const handmade = [];
for (let i = 0; i < 192; i += 1) {
  const minutesAgo = (191 - i) * 15;
  let v = 37;
  if (minutesAgo <= 1500 && minutesAgo >= 1470) v = 45;         /* door event */
  if (minutesAgo <= 600 && minutesAgo >= 540) v = 46;           /* real excursion */
  handmade.push({ minutesAgo: minutesAgo, value: v });
}
const stats = SIM.summarize(handmade, rules.fresh_food);
check("two separate trips over the limit count as two excursions",
  stats.excursions === 2, stats.excursions);
check("the longest excursion is measured in minutes, not readings",
  stats.longestExcursionMinutes >= 45 && stats.longestExcursionMinutes <= 75, stats.longestExcursionMinutes);
check("time in band reflects the readings, not an assertion",
  stats.inBandPct > 90 && stats.inBandPct < 100, stats.inBandPct + "%");
check("the average is arithmetic, not vibes",
  Math.abs(stats.avg - 37.4) < 0.5, stats.avg);

/* One resolver for the hub AND the report: same asset, same data, twice. */
const sameA = SIM.forAsset({ id: "det1", type: "refrigerator", model: "X" }, null);
const sameB = SIM.forAsset({ id: "det1", type: "refrigerator", model: "X" }, null);
check("the same appliance charts the same series every time",
  JSON.stringify(sameA.points) === JSON.stringify(sameB.points), "");
check("...so the hub and the report cannot disagree",
  JSON.stringify(sameA.stats) === JSON.stringify(sameB.stats), "");

/* The drifty demo unit: warm, never flagged. */
const drifty = fleet.find(function (r) { return r.asset.model === "CL3650R"; });
check("the drifty demo unit exists", Boolean(drifty), "");
check("...runs warm", Boolean(drifty && drifty.stats.avg > drifty.flag.band.setpoint + 1.5),
  drifty ? drifty.stats.avg + " vs setpoint " + drifty.flag.band.setpoint : "");
check("...and does NOT flag -- warm is an eye, not a truck",
  Boolean(drifty) && drifty.flag.flagged === false, "");

/* ------------------------------------------------------------------ */
console.log("\n--- the name lives in config, nowhere else ---");

const NAME_SURFACES = ["assets/monitoring.js", "assets/quote-view.js", "assets/appliance-builder.js",
                       "assets/report-view.js", "assets/ui.js", "assets/tech-maintenance.js"];
const hardcodedName = NAME_SURFACES.filter(function (f) {
  let src = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /* A `|| "Refrigeration Guardian"` fallback AFTER reading config is the
     correct defensive shape, not a hardcode -- strip those before testing.
     What remains is a name used without consulting config first. */
  src = src.replace(/\|\|\s*["'](?:Wilson )?(?:Refrigeration )?Guardian["']/g, "");
  return /Temp Watch|Refrigeration Guardian/.test(src);
});
check("no surface hardcodes the service name (Cayden renames it in one line)",
  hardcodedName.length === 0, hardcodedName.join(",") || "all read config");
const surfacesReadConfig = NAME_SURFACES.filter(function (f) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return /serviceName|serviceShortName/.test(src);
});
check("every naming surface actually reads serviceName/serviceShortName from config",
  surfacesReadConfig.length === NAME_SURFACES.length,
  surfacesReadConfig.length + "/" + NAME_SURFACES.length);
check("the config carries both the name and the short name",
  Boolean(CFG.tempMonitoring.serviceName && CFG.tempMonitoring.serviceShortName),
  CFG.tempMonitoring.serviceName + " / " + CFG.tempMonitoring.serviceShortName);

/* ------------------------------------------------------------------ */
console.log("\n--- a dispatch cannot double-file ---");

const target = flagged[0].asset;
const first = W.WilsonStore.recordTempDispatch({ assetId: target.id, flagLabel: "test flag", reading: 50 });
const second = W.WilsonStore.recordTempDispatch({ assetId: target.id, flagLabel: "test flag", reading: 51 });
check("the first dispatch files", first.ok && !first.existing, "");
check("the second same-day press is absorbed", second.ok && second.existing === true, "");
check("one record exists", (W.WilsonStore.load().tempDispatches || []).length === 1, "");
check("the household activity carries it",
  (W.WilsonStore.load().activity || []).some(function (a) { return a.type === "Guardian"; }), "");

/* ------------------------------------------------------------------ */
console.log("\n--- the registration card is wired, not decorative ---");

const builderSrc = fs.readFileSync(path.join(ROOT, "assets/appliance-builder.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
check("the builder offers the add-on through the engine's eligibility",
  /tempwatch\.eligible\(asset\)/.test(builderSrc), "");
check("the builder never carries a price literal of its own",
  !/\b(199|299|149)\b/.test(builderSrc.replace(/data-[a-z-]+/g, "")) &&
  /guardianMarginalPrice/.test(builderSrc) &&
  /tempwatch\.total\(/.test(builderSrc), "");
check("the hub states both tiers from config, no literals",
  (function () {
    const src = fs.readFileSync(path.join(ROOT, "assets/monitoring.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return !/\b(199|299|149)\b/.test(src) && /firstAnnual/.test(src) && /installCreditNote/.test(src);
  })(), "");
check("the quote prints the monitoring line from the breakdown",
  /tempMonitoringAmount/.test(fs.readFileSync(path.join(ROOT, "assets/quote-view.js"), "utf8")), "");

/* ------------------------------------------------------------------ */
console.log("\n--- mutation tests: every assertion above can fail ---");

function mutation(label, mutate, probe) {
  let caught = false, why = "", touched = false;
  const witness = function (f, src) {
    const out = mutate(f, src);
    if (out !== src) touched = true;
    return out;
  };
  try {
    const m = boot(witness);
    if (!touched) { fail++; console.log("FAIL  STALE:  " + label.padEnd(62) + "mutation matched nothing"); return; }
    caught = probe(m) === false;
    if (!caught) why = "property still held";
  } catch (err) {
    if (!touched) { fail++; console.log("FAIL  STALE:  " + label.padEnd(62) + "mutation matched nothing"); return; }
    caught = true; why = "threw";
  }
  if (!caught) fail++;
  console.log((caught ? "ok  " : "FAIL") + "  caught: " + label.padEnd(62) + why);
}

mutation("monitoring priced into the breakdown but not the total", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace("    if (planId === \"per_appliance\") return cents(perApplianceCost(assets) + filterCost + monitoringCost);",
                   "    if (planId === \"per_appliance\") return cents(perApplianceCost(assets) + filterCost);")
          .replace("      + filterCost\n      + monitoringCost);", "      + filterCost);");
}, function (m) {
  const a = [{ type: "refrigerator", customerCategory: "refrigeration", tempMonitoringOptIn: true }];
  const on = m.WILSON_PRICING.annual(a, "estate_annual");
  const off = m.WILSON_PRICING.annual([{ type: "refrigerator", customerCategory: "refrigeration" }], "estate_annual");
  return on - off === Number(m.WILSON_CONFIG.tempMonitoring.pricing.member.firstAnnual);
});

mutation("a second compartment priced as free", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace("    const watched = tempMonitoringWatched(asset);\n    if (!watched.length) return { selected: false, sensors: 0, compartments: [] };\n    return { selected: true, sensors: watched.length, compartments: watched };",
                   "    const watched = tempMonitoringWatched(asset);\n    if (!watched.length) return { selected: false, sensors: 0, compartments: [] };\n    return { selected: true, sensors: 1, compartments: watched };");
}, function (m) {
  const p = m.WILSON_CONFIG.tempMonitoring.pricing.member;
  return m.WILSON_TEMPWATCH.total([{ customerCategory: "refrigeration", type: "refrigerator",
    tempMonitoringOptIn: true, tempMonitoringCompartments: ["fresh_food", "freezer"] }]) ===
    Number(p.firstAnnual) + Number(p.additionalAnnual);
});

mutation("the additional-sensor break quietly lost", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace("    return Number(pricing.firstAnnual || 0) + (sensors - 1) * Number(pricing.additionalAnnual || 0);",
                   "    return sensors * Number(pricing.firstAnnual || 0);");
}, function (m) {
  const one = { type: "refrigerator", customerCategory: "refrigeration", tempMonitoringOptIn: true };
  const p = m.WILSON_CONFIG.tempMonitoring.pricing.member;
  return m.WILSON_TEMPWATCH.total([one, Object.assign({}, one)]) ===
    Number(p.firstAnnual) + Number(p.additionalAnnual);
});

mutation("a blip flagging like a failure", function (f, s) {
  if (f !== "assets/temp-monitoring.js") return s;
  return s.replace("      return windowPoints.length > 0 && windowPoints.every(function (p) { return p.value > limit; });",
                   "      return windowPoints.length > 0 && windowPoints.some(function (p) { return p.value > limit; });");
}, function (m) {
  const blip2 = [];
  for (let i = 0; i < 192; i += 1) {
    const minutesAgo = (191 - i) * 15;
    blip2.push({ minutesAgo: minutesAgo, value: minutesAgo <= 20 ? 48 : 37 });
  }
  return m.WILSON_TEMPWATCH_SIM.evaluateFlags({ id: "x", type: "refrigerator" }, blip2).flagged === false;
});

mutation("the recovery rule quietly dropped", function (f, s) {
  if (f !== "assets/temp-monitoring.js") return s;
  return s.replace("    const failedRecovery = rule.recoverWithinMinutes !== undefined\n      && overForMinutes >= rule.recoverWithinMinutes;",
                   "    const failedRecovery = false;");
}, function (m) {
  const r = m.WILSON_CONFIG.tempMonitoring.flagRules.fresh_food;
  const pts = [];
  for (let i = 0; i < 192; i += 1) {
    const minutesAgo = (191 - i) * 15;
    pts.push({ minutesAgo: minutesAgo, value: minutesAgo <= r.recoverWithinMinutes + 30 ? 43 : 37 });
  }
  return m.WILSON_TEMPWATCH_SIM.evaluateFlags({ id: "x", type: "refrigerator" }, pts).flagged === true;
});

mutation("the double-file guard removed", function (f, s) {
  if (f !== "assets/store.js") return s;
  return s.replace("    const held = state.tempDispatches.find(function (d) { return d.key === key; });\n    if (held) return { ok: true, dispatch: held, existing: true };", "");
}, function (m) {
  const st = m.WilsonStore.load();
  const asset = st.assets.find(function (a) { return a.tempMonitoringOptIn; });
  m.WilsonStore.recordTempDispatch({ assetId: asset.id, flagLabel: "x" });
  m.WilsonStore.recordTempDispatch({ assetId: asset.id, flagLabel: "x" });
  return (m.WilsonStore.load().tempDispatches || []).length === 1;
});

mutation("excursions counted per reading instead of per trip", function (f, s) {
  if (f !== "assets/temp-monitoring.js") return s;
  return s.replace("if (out && !over) { excursions += 1; runStart = p.minutesAgo; }",
                   "if (out) { excursions += 1; runStart = p.minutesAgo; }");
}, function (m) {
  const pts = [];
  for (let i = 0; i < 192; i += 1) {
    const minutesAgo = (191 - i) * 15;
    let v = 37;
    if (minutesAgo <= 1500 && minutesAgo >= 1470) v = 45;
    if (minutesAgo <= 600 && minutesAgo >= 540) v = 46;
    pts.push({ minutesAgo: minutesAgo, value: v });
  }
  return m.WILSON_TEMPWATCH_SIM.summarize(pts, m.WILSON_CONFIG.tempMonitoring.flagRules.fresh_food).excursions === 2;
});

mutation("a dryer becoming eligible for a fridge product", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace('      eligibleCategories: ["refrigeration"],', '      eligibleCategories: ["refrigeration", "dryer"],');
}, function (m) {
  return m.WILSON_TEMPWATCH.eligible({ type: "dryer", customerCategory: "dryer" }) === false;
});

console.log("");
if (fail) { console.log("FAILURES: " + fail); process.exit(1); }
console.log("ALL TEMP WATCH CHECKS PASSED");

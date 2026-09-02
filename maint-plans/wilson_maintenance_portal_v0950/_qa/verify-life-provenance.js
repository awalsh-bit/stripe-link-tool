/*
 * WHERE A DRAFT EXPECTED LIFE CAME FROM, AND WHETHER THE PRODUCT SAYS SO.
 *
 * Two problems this locks shut.
 *
 * 1. THE SECOND TABLE. The seeded demo history carried its own `tier` and
 *    `expectedYears` on every profile. When Cayden's brand-and-line figures
 *    landed in v0.9.30 that table did not move, so 23 of the 25 seeded
 *    appliances were scored against numbers the product does not use -- the
 *    Thermador speed oven was 8 years in the demo and 14 in the field tool, the
 *    True outdoor refrigerator 12 and 20. One rule, one implementation.
 *
 * 2. THE UNIFORM AUTHORITY. `expectedLife` has returned a `basis` since v0.9.30
 *    and only the technician's card ever printed it, in its own words. On a
 *    customer's report an icemaker's 11 years -- Wilson's field figure averaged
 *    against a published one -- and a Lynx outdoor refrigerator's 8 years,
 *    which rests on Wilson's experience alone with nothing published to check
 *    it against, printed with identical authority. The report said instead that
 *    "this Luxury tier uses a draft expected service life of 23 years", which
 *    the tier had not decided since v0.9.30.
 *
 * Run: node _qa/verify-life-provenance.js
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
  ["assets/plan-config.js", "assets/store.js"].forEach(function (f) {
    let src = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (mutate) src = mutate(f, src);
    vm.runInContext(src, sb);
  });
  return sb;
}

const sb = boot(null);
const B = sb.window.WILSON_BRANDS;
const W = sb.window.WILSON_WATER;
const state = sb.window.WilsonStore.load ? sb.window.WilsonStore.load() : sb.window.WilsonStore.getState();

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log((ok ? "ok  " : "FAIL") + "  " + label.padEnd(72) + (detail === undefined ? "" : detail));
}
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/* ------------------------------------------------------------------ */
console.log("--- one expected-life table, not two ---");

const reports = state.reports || [];
check("the seed produced reports to check", reports.length > 0, reports.length);

const missingBasis = reports.filter(function (r) { return !((r.lifecycle || {}).lifeBasis); });
check("every stored report carries the basis for its expected life",
  missingBasis.length === 0, missingBasis.length + " without");

/*
 * The real parity test: recompute the expected life from the config, the way
 * the field tool does, and require the stored figure to match. This is the
 * check that would have caught the eight-year gap.
 */
const assetById = {};
(state.assets || []).forEach(function (a) { assetById[a.id] = a; });
let drifted = [];
reports.forEach(function (r) {
  const asset = assetById[r.assetId];
  const life = r.lifecycle || {};
  if (!asset || !Number(life.expectedYears)) return;
  const setKey = sb.window.WILSON_PROTOCOL.resolveCheckpointSet(asset);
  const line = B.lineForAsset(asset) || B.lineForSet(setKey);
  const tier = B.tierFor(asset.brand || "", line);
  const want = W.expectedLife(setKey, tier, null, {
    brand: asset.brand || "", model: asset.model || "",
    description: asset.typeLabel || "", line: line, group: asset.group || "", checkpointSet: setKey
  });
  if (Number(life.expectedYears) !== Number(want.adjusted) || life.tier !== tier) {
    drifted.push(r.applianceLabel + ": stored " + life.expectedYears + "/" + life.tier +
                 ", config " + want.adjusted + "/" + tier);
  }
});
check("every stored expected life is the one the config computes",
  drifted.length === 0, drifted.length ? "\n      " + drifted.slice(0, 4).join("\n      ") : "0 drifted");

/* And the profiles must not carry the fields at all, so nobody restores them
   by copying the row above. */
const storeSrc = src("assets/store.js");
const profileBlock = storeSrc.slice(storeSrc.indexOf("const REYNOLDS_PROFILES"),
                                    storeSrc.indexOf("function portfolioHistory"));
check("no seed profile declares its own expectedYears",
  !/expectedYears:/.test(profileBlock), (profileBlock.match(/expectedYears:/g) || []).length + " found");
check("no seed profile declares its own tier",
  !/\btier: "/.test(profileBlock), (profileBlock.match(/\btier: "/g) || []).length + " found");

/* ------------------------------------------------------------------ */
console.log("\n--- the sentence: one builder, three audiences ---");

function sentenceFor(brand, setKey, audience, label) {
  const line = B.lineForSet(setKey);
  const tier = B.tierFor(brand, line);
  const life = W.expectedLife(setKey, tier, null, {
    brand: brand, model: "X", description: label || "", line: line,
    group: setKey, checkpointSet: setKey
  });
  return { text: B.basisSentence(life.basis, life.adjusted, audience), life: life };
}

const subzero = sentenceFor("Sub-Zero", "refrigerator", "customer");
check("a corroborated brand figure names the brand", /Sub-Zero/.test(subzero.text), "");
check("...and shows BOTH numbers behind the average",
  /25 years/.test(subzero.text) && /20 years/.test(subzero.text), "");
check("...and says the published figure exists", /published/.test(subzero.text), "");

const lynx = sentenceFor("Lynx", "refrigerator", "customer");
check("an uncorroborated field figure says nothing published covers it",
  /No published service-life figure/.test(lynx.text), "");
check("...and does not claim a published number it does not have",
  !/published for this class/.test(lynx.text), "");
check("...and says it rests on Wilson's experience",
  /experience alone/.test(lynx.text), "");

/* THE POINT OF THE WHOLE EXERCISE: the two cannot read the same. */
check("the corroborated and the uncorroborated figures do NOT print identically",
  subzero.text !== lynx.text, "");

const nobrand = sentenceFor("Notabrand", "dishwasher", "customer");
check("a category figure admits there is no Wilson figure for the brand",
  /do not yet have a Wilson-specific figure/.test(nobrand.text), "");
check("...and does not claim to be Wilson's own",
  !/Wilson's own figure/.test(nobrand.text), "");

/* Same builder, so the technician and the customer cannot be told different
   stories -- but the technician's version is terse, not the customer's. */
const techSub = sentenceFor("Sub-Zero", "refrigerator", "tech").text;
check("the technician's version carries the same two numbers",
  /25 yr/.test(techSub) && /20 yr/.test(techSub), "");
check("the technician's version is shorter than the customer's",
  techSub.length < subzero.text.length, techSub.length + " vs " + subzero.text.length);

/* The prose noun, not the table heading. "Bosch dish" was the bug. */
const bosch = sentenceFor("Bosch", "dishwasher", "customer").text;
check("a line reads as prose, not as a table heading", /dishwashers/.test(bosch) && !/ dish\b/.test(bosch), "");
const lines = B.lines();
const noProse = Object.keys(lines).filter(function (k) { return !lines[k].prose; });
check("every appliance line has a prose noun for a sentence", noProse.length === 0, noProse.join(",") || "all present");

/* A brand key is not a brand name. */
check("the brand is spelled the way a customer spells it",
  B.label("sub-zero") === "Sub-Zero" && B.label("lg") === "LG" && B.label("vent-a-hood") === "Vent-A-Hood",
  [B.label("sub-zero"), B.label("lg"), B.label("vent-a-hood")].join(" / "));

check("no basis means no invented sentence", B.basisSentence(null, 12, "customer") === "", "");

/* ------------------------------------------------------------------ */
console.log("\n--- the claim the report used to make ---");

const reportSrc = src("assets/report-view.js");
check("the report no longer says the TIER chose the expected life",
  !/tier uses a draft expected service life/.test(reportSrc), "");
/*
 * Look at what the page EMITS, not at the file. My first cut of this check was
 * `!/-tier estimate/.test(reportSrc)` and it failed on the comment I had just
 * written explaining that the wording was removed -- the fourth time in this
 * project a check has matched prose instead of code. Strip the comments first.
 */
const reportCode = reportSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("the lifecycle panel no longer credits the tier for the estimate",
  !/-tier estimate/.test(reportCode) && !/tier uses a draft/.test(reportCode), "");
check("...and the check is looking at code, not at a comment about the code",
  /-tier estimate/.test(reportSrc) !== /-tier estimate/.test(reportCode) ||
  !/-tier estimate/.test(reportSrc), "");
check("the footnote no longer sources the figure to category and tier",
  !/draft estimate from the appliance category and product tier/.test(reportSrc), "");
check("the report builds its sentence from the shared builder",
  /WILSON_BRANDS\.basisSentence/.test(reportSrc), "");
check("the field card builds its sentence from the shared builder",
  /WILSON_BRANDS\.basisSentence/.test(src("assets/tech-maintenance.js")), "");
check("the field card no longer keeps a second copy of the wording",
  !/midpoint of Wilson's/.test(src("assets/tech-maintenance.js")), "");

/*
 * The age ledger line quoted a percentage from `lifeUsedPct`, which lives on
 * the lifecycle ADVICE object and never on the stored record -- so the branch
 * never fired once and every report printed the vague fallback instead.
 */
check("the age deduction quotes the ratio the record actually carries",
  /num\(life\.lifeRatio\)/.test(reportSrc) && !/life\.lifeUsedPct !== null/.test(reportSrc), "");

/* ------------------------------------------------------------------ */
console.log("\n--- mutation tests: every assertion above can fail ---");

/*
 * A MUTATION THAT CHANGES NOTHING IS NOT A PASSING TEST.
 *
 * Every mutation here works by string replacement against real source. When the
 * source is edited and the search string stops matching, `replace` returns the
 * input unchanged, the "mutated" build is identical to the real one, the
 * property holds, and the mutation quietly stops testing anything.
 *
 * That happened in v0.9.37: adding the outdoor caveat to a sentence broke the
 * search string of the mutation guarding that sentence. It surfaced only
 * because the property it asserts is the one that also holds -- had the
 * polarity gone the other way it would have read green forever.
 *
 * So the harness now checks the mutation BIT. If no file changed, the mutation
 * is stale and that is a failure of the test, reported as one.
 */
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
    if (!touched) {
      fail++;
      console.log("FAIL  STALE:  " + label.padEnd(66) + "the mutation matched nothing -- fix its search string");
      return;
    }
    const got = probe(m);
    caught = got === false;
    why = got === true ? "property still held" : "";
  } catch (err) {
    if (!touched) {
      fail++;
      console.log("FAIL  STALE:  " + label.padEnd(66) + "the mutation matched nothing -- fix its search string");
      return;
    }
    caught = true; why = "threw";
  }
  if (!caught) fail++;
  console.log((caught ? "ok  " : "FAIL") + "  caught: " + label.padEnd(66) + why);
}

mutation("a seeded report scored against a hand-entered expected life", function (f, s) {
  if (f !== "assets/store.js") return s;
  return s.replace("const expectedYears = life.adjusted;", "const expectedYears = 9;");
}, function (m) {
  const st = m.window.WilsonStore.load();
  const bad = (st.reports || []).some(function (r) { return Number((r.lifecycle || {}).expectedYears) === 9; });
  return !bad;   /* false == the mutation was detected */
});

mutation("the basis dropped off the stored report", function (f, s) {
  if (f !== "assets/store.js") return s;
  return s.replace("lifeBasis: life.basis,", "");
}, function (m) {
  const st = m.window.WilsonStore.load();
  return (st.reports || []).every(function (r) { return (r.lifecycle || {}).lifeBasis; });
});

mutation("an uncorroborated figure claiming a published one", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace("No published service-life figure covers this kind of appliance, so it stands on our experience alone.",
                   "and the published industry figure agrees.");
}, function (m) {
  const line = m.window.WILSON_BRANDS.lineForSet("refrigerator");
  const life = m.window.WILSON_WATER.expectedLife("refrigerator", "luxury", null,
    { brand: "Lynx", model: "X", description: "", line: line, group: "refrigerator", checkpointSet: "refrigerator" });
  return /No published service-life figure/.test(m.window.WILSON_BRANDS.basisSentence(life.basis, life.adjusted, "customer"));
});

mutation("a category figure passed off as Wilson's own", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace('return lead + "the general figure we use for appliances of this type and quality. " +\n        "We do not yet have a Wilson-specific figure for this brand." + outdoorCaveat(basis, who);',
                   'return lead + "Wilson\'s own figure for this appliance.";');
}, function (m) {
  const life = m.window.WILSON_WATER.expectedLife("dishwasher", "premium", null,
    { brand: "Notabrand", model: "X", description: "", line: "dishwashing", group: "dishwasher", checkpointSet: "dishwasher" });
  return /do not yet have a Wilson-specific figure/.test(m.window.WILSON_BRANDS.basisSentence(life.basis, life.adjusted, "customer"));
});

mutation("the table heading printed where prose belongs", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace("(lineEntry.prose || lineEntry.label || basis.line || \"\")",
                   "(lineEntry.label || basis.line || \"\")");
}, function (m) {
  const life = m.window.WILSON_WATER.expectedLife("dishwasher", "premium", null,
    { brand: "Bosch", model: "X", description: "", line: "dishwashing", group: "dishwasher", checkpointSet: "dishwasher" });
  return /dishwashers/.test(m.window.WILSON_BRANDS.basisSentence(life.basis, life.adjusted, "customer"));
});

/* "sub-zero" would title-case to "Sub-Zero" on its own, so it cannot detect
   this; "lg" title-cases to "Lg", which is the case the table exists for. */
mutation("the brand key printed instead of the brand name", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace('"lg": "LG",', '');
}, function (m) { return m.window.WILSON_BRANDS.label("lg") === "LG"; });

console.log("");
if (fail) { console.log("FAILURES: " + fail); process.exit(1); }
console.log("ALL LIFE-PROVENANCE CHECKS PASSED");

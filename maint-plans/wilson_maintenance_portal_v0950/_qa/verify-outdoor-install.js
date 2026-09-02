/*
 * WHERE THE APPLIANCE LIVES.
 *
 * Cayden, v0.9.37: "i dont think i want outdoor v indoor as a flag on the
 * customer side, but our tech or office should be able to flag it as outdoor.
 * it should default to outdoor if the customer sets up an outdoor area and adds
 * it there during registration."
 *
 * Three things this has to keep true, and each has bitten something already:
 *
 *   1. THE CUSTOMER IS NEVER ASKED. The signup form has no indoor/outdoor
 *      control, and adding one later must break a test rather than ship.
 *
 *   2. THE AREA-NAME MATCH IS WHOLE-WORD AND SHORT. Substring matching is what
 *      once scored a Gaggenau as mass-market because "gaggenau" contains "ge".
 *      The trap here is "Pool House" -- a building, whose contents are indoors.
 *
 *   3. AN OUTDOOR INSTALL WITH AN INDOOR FIGURE IS FLAGGED, NOT SILENTLY
 *      SWAPPED. Wilson's outdoor figures exist for six outdoor-only brands.
 *      True, Sub-Zero, Perlick, Hestan and Marvel sell both. Quietly handing an
 *      outdoor Sub-Zero the eight-year figure Cayden gave for Blaze would be
 *      inventing a number inside a resolver.
 *
 * This file also PRINTS THE GAP LIST -- the brand-and-line pairs Wilson has an
 * indoor figure for and no outdoor one -- so it is a working document, not only
 * an assertion.
 *
 * Run: node _qa/verify-outdoor-install.js
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
const E = W.WILSON_ENVIRONMENT, B = W.WILSON_BRANDS;

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log((ok ? "ok  " : "FAIL") + "  " + label.padEnd(66) + (detail === undefined ? "" : detail));
}

/* ------------------------------------------------------------------ */
console.log("--- the customer is never asked ---");

const signup = fs.readFileSync(path.join(ROOT, "appliance-signup.html"), "utf8");
const builder = fs.readFileSync(path.join(ROOT, "assets/appliance-builder.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("the signup form has no indoor/outdoor control",
  !/installEnvironment/.test(signup) && !/\boutdoor\b[^<]{0,40}<\/label>/i.test(signup), "");
check("the appliance builder never sets the flag",
  !/installEnvironment/.test(builder), "");
/* But it must still record the area name, because that is what the default
   reads. A builder that stopped storing `location` would silently make every
   appliance indoor. */
check("the builder still records the area name on every appliance",
  /asset\.location\s*=/.test(builder), "");

/* ------------------------------------------------------------------ */
console.log("\n--- the default, from the area the customer named ---");

const at = (location, extra) => E.for(Object.assign({ type: "refrigerator", location: location }, extra || {}));

[["Outdoor Kitchen", "outdoor"], ["Patio", "outdoor"], ["Covered Terrace", "outdoor"],
 ["Cabana Bar", "outdoor"], ["Poolside Bar", "outdoor"], ["Grill Station", "outdoor"],
 ["Main Kitchen", "indoor"], ["Butler's Pantry", "indoor"], ["Wine Room", "indoor"]
].forEach(function (pair) {
  const got = at(pair[0]);
  check('"' + pair[0] + '" is ' + pair[1], got.id === pair[1], got.id + " (" + got.source + ")");
});

/*
 * THE POOL HOUSE. A building, not a poolside. This is the case the word list is
 * short for, and the reason "pool" is not on it.
 */
[["Pool House", "the contents of a building are indoors"],
 ["Guest House", "same"],
 ["Casita", "same"],
 ["Garden Room", "a room"],
 ["Sunroom", "a room"],
 ["Back Porch", "screened as often as not in Texas -- left to the technician"]
].forEach(function (pair) {
  const got = at(pair[0]);
  check('"' + pair[0] + '" is NOT outdoor — ' + pair[1], got.id === "indoor", got.id);
});

check("matching is whole-word, not substring",
  at("Deckchair Storage").id === "indoor" && at("Deck").id === "outdoor",
  "Deckchair=" + at("Deckchair Storage").id + ", Deck=" + at("Deck").id);

/* ------------------------------------------------------------------ */
console.log("\n--- who can overrule the default ---");

const flaggedOut = at("Main Kitchen", { installEnvironment: "outdoor", installEnvironmentSource: "tech" });
check("a technician's flag beats an indoor area name",
  flaggedOut.id === "outdoor" && flaggedOut.source === "flagged", flaggedOut.id);
const flaggedIn = at("Outdoor Kitchen", { installEnvironment: "indoor", installEnvironmentSource: "office" });
check("...and beats an outdoor one, in the other direction",
  flaggedIn.id === "indoor" && flaggedIn.source === "flagged", flaggedIn.id);
check("the flag says who set it",
  /technician/.test(flaggedOut.why) && /office/.test(flaggedIn.why), "");
check("clearing the flag returns the appliance to the area default",
  at("Outdoor Kitchen").id === "outdoor" && at("Outdoor Kitchen").source === "area", "");

/*
 * A LABEL IS NOT A DEFINITION. The first cut of this resolver treated a
 * typeLabel containing "outdoor" as definitional, which locked the technician
 * out of the override on the demo estate's True undercounter -- the single
 * appliance in the product most likely to be mislabelled.
 */
const labelled = E.for({ type: "refrigerator", typeLabel: "Outdoor Refrigerator", location: "Main Kitchen" });
check('a typeLabel of "Outdoor Refrigerator" gives outdoor', labelled.id === "outdoor", labelled.id);
check("...but as a LABEL, so it stays overridable", labelled.source === "label", labelled.source);
const grill = E.for({ type: "outdoor_grill", customerCategory: "outdoor_grill", location: "Main Kitchen" });
check("a built-in grill is outdoor by type and needs no override",
  grill.id === "outdoor" && grill.source === "type", grill.source);

/* ------------------------------------------------------------------ */
console.log("\n--- an outdoor install with an indoor figure is flagged, never swapped ---");

function life(brand, setKey, environment) {
  const line = B.lineForSet(setKey);
  return W.WILSON_WATER.expectedLife(setKey, B.tierFor(brand, line), null,
    { brand: brand, model: "X", description: "", line: line, group: setKey, checkpointSet: setKey,
      environment: environment });
}

const lynx = life("Lynx", "refrigerator", "outdoor");
check("an outdoor-brand row is recognised as an outdoor figure",
  lynx.basis.installedOutdoors === true && lynx.basis.environmentGap === false, lynx.adjusted + " yr");

const trueOut = life("True", "refrigerator", "outdoor");
const trueIn = life("True", "refrigerator", "indoor");
check("an outdoor True keeps its indoor figure rather than being reassigned",
  trueOut.adjusted === trueIn.adjusted, trueOut.adjusted + " yr both ways");
check("...and the gap is flagged on the basis",
  trueOut.basis.environmentGap === true, "");
check("...and the customer is told, in words",
  /installed outdoors/.test(B.basisSentence(trueOut.basis, trueOut.adjusted, "customer")) &&
  /do not yet have a separate outdoor figure/.test(B.basisSentence(trueOut.basis, trueOut.adjusted, "customer")), "");
check("...and the technician is told, in short",
  /OUTDOOR INSTALL/.test(B.basisSentence(trueOut.basis, trueOut.adjusted, "tech")), "");
check("an indoor appliance says nothing about outdoors",
  !/outdoor/i.test(B.basisSentence(trueIn.basis, trueIn.adjusted, "customer")), "");

/* ------------------------------------------------------------------ */
console.log("\n--- the control appears only where it can change something ---");

/*
 * Adding this row to every appliance pushed the field tool's appliance screen
 * past its four-screen ergonomics budget -- the screen was already at 99% of
 * it. The fix was to stop rendering a control that cannot affect an outcome,
 * not to relax the budget, and this pins that reasoning down so it survives.
 */
check("indoor/outdoor moves the expected life on refrigeration",
  E.lifeSensitive("refrigeration") === true, "");
check("...and on ice", E.lifeSensitive("ice") === true, "");
[["laundry_washer", "a washer"], ["cooking", "a range"], ["dishwashing", "a dishwasher"],
 ["ventilation", "a hood"], ["coffee", "a coffee machine"]].forEach(function (pair) {
  check("...and on nothing else — " + pair[1] + " is unaffected",
    E.lifeSensitive(pair[0]) === false, "");
});

const techSrc = fs.readFileSync(path.join(ROOT, "assets/tech-maintenance.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
check("the field card gates the row on that same rule, not its own copy",
  /WILSON_ENVIRONMENT\.lifeSensitive\(line\)/.test(techSrc), "");
check("...and always shows a flag somebody actually set",
  /installEnvironment===\"indoor\"\|\|a\.installEnvironment===\"outdoor\"/.test(techSrc.replace(/\s/g, "").replace(/a\.installEnvironment/g, "a.installEnvironment")) ||
  /const flagged=a\.installEnvironment/.test(techSrc), "");

/* ------------------------------------------------------------------ */
console.log("\n--- THE GAP LIST: brand and line pairs that need an outdoor figure ---");

const OUTDOOR_LINES = ["refrigeration", "ice"];
const rows = B.rows();
/*
 * Keyed by brand and line, preferring the PLAIN row. My first version let the
 * last row win, and True's Commercial series row overwrote its plain one -- so
 * the list handed Cayden 23 years for a True undercounter that the resolver
 * actually gives 20. A working document with wrong numbers in it is worse than
 * no document.
 */
const byBrand = {};
rows.forEach(function (r) {
  if (OUTDOOR_LINES.indexOf(r.line) === -1) return;
  byBrand[r.brand] = byBrand[r.brand] || {};
  const held = byBrand[r.brand][r.line];
  if (!held || (held.series && !r.series)) byBrand[r.brand][r.line] = r;
});
const gaps = [];
Object.keys(byBrand).sort().forEach(function (brand) {
  OUTDOOR_LINES.forEach(function (line) {
    const row = byBrand[brand][line];
    if (!row) return;
    if (row.environment === "outdoor") return;
    gaps.push({ brand: brand, line: line, indoor: row.years });
  });
});
console.log("  " + "brand".padEnd(16) + "line".padEnd(16) + "indoor figure");
gaps.forEach(function (g) {
  console.log("  " + B.label(g.brand).padEnd(16) + g.line.padEnd(16) + g.indoor + " yr");
});
console.log("  " + gaps.length + " brand/line pairs have an indoor figure and no outdoor one.");
/* Not a failure -- it is a question for Cayden. But it must not silently grow
   to include a brand that HAS an outdoor figure, which would mean the tagging
   broke. */
const outdoorRows = rows.filter(function (r) { return r.environment === "outdoor"; });
check("the outdoor-brand rows are still tagged", outdoorRows.length >= 11, outdoorRows.length + " rows");
check("every tagged outdoor row is refrigeration or ice",
  outdoorRows.every(function (r) { return OUTDOOR_LINES.indexOf(r.line) > -1; }), "");

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

mutation("substring matching instead of whole-word", function (s) {
  return s.replace("const hit = OUTDOOR_AREA_WORDS.find(function (word) { return words.indexOf(word) !== -1; });",
                   "const hit = OUTDOOR_AREA_WORDS.find(function (word) { return area.indexOf(word) !== -1; });");
}, function (m) { return m.WILSON_ENVIRONMENT.for({ type: "refrigerator", location: "Deckchair Storage" }).id === "indoor"; });

/*
 * Probed through "Pool Bath" rather than "Pool House". The phrase guard catches
 * "pool house" explicitly, so the word list can go wrong there without the
 * result changing -- which is the defence working, and also a mutation that
 * proves nothing. "Pool Bath" is a room the phrase list does not cover and the
 * word list alone has to get right.
 */
mutation('"pool" added to the outdoor word list', function (s) {
  return s.replace('"courtyard", "veranda", "poolside", "grill", "bbq", "barbecue",',
                   '"courtyard", "veranda", "poolside", "pool", "grill", "bbq", "barbecue",');
}, function (m) { return m.WILSON_ENVIRONMENT.for({ type: "refrigerator", location: "Pool Bath" }).id === "indoor"; });

mutation("a technician's flag stopped winning", function (s) {
  return s.replace('    const flagged = norm(a.installEnvironment);\n    if (flagged === "outdoor" || flagged === "indoor") {',
                   '    const flagged = norm(a.installEnvironment);\n    if (false) {');
}, function (m) {
  return m.WILSON_ENVIRONMENT.for({ type: "refrigerator", location: "Outdoor Kitchen",
    installEnvironment: "indoor", installEnvironmentSource: "office" }).id === "indoor";
});

/* The one that would have shipped quietly: an outdoor install silently handed
   the class figure instead of the flag. */
mutation("the outdoor gap stopped being flagged", function (s) {
  return s.replace("      basis.environmentGap = basis.environment !== \"outdoor\";",
                   "      basis.environmentGap = false;");
}, function (m) {
  const line = m.WILSON_BRANDS.lineForSet("refrigerator");
  const l = m.WILSON_WATER.expectedLife("refrigerator", "luxury", null,
    { brand: "True", model: "X", description: "", line: line, group: "refrigerator",
      checkpointSet: "refrigerator", environment: "outdoor" });
  return /installed outdoors/.test(m.WILSON_BRANDS.basisSentence(l.basis, l.adjusted, "customer"));
});

mutation("the outdoor tag falling off the brand rows", function (s) {
  return s.replace(/environment: "outdoor", /g, "");
}, function (m) {
  return m.WILSON_BRANDS.rows().filter(function (r) { return r.environment === "outdoor"; }).length >= 11;
});

console.log("");
if (fail) { console.log("FAILURES: " + fail); process.exit(1); }
console.log("ALL OUTDOOR-INSTALL CHECKS PASSED");

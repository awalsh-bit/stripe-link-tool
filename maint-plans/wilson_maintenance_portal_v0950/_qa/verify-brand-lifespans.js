/*
 * BRAND, PRODUCT LINE, AND WHETHER WILSON CAN TOUCH IT AT ALL
 *
 * Cayden, on the numbers: "my life ratings are based on experience because we
 * do service. i know what product fails prematurely, but we dont need to rate
 * based on that. shoot the gap with everything. do the average of what i said
 * and what the code says now."
 *
 * And on the guardrail: "we already had a tech ask if we could register 2
 * appliances for maintenance that we dont work on. which is good that customers
 * are excited but we need a guardrail that all parties can understand."
 *
 * WHAT THIS SUITE IS FENCING
 * -------------------------
 *   1. THE NUMBERS ARE DERIVED, NOT TYPED. Every precomputed `years` must equal
 *      the rounded midpoint of its own `field` and `anchored` values, and every
 *      `anchored` must equal what lifecycleMatrix holds for that line and tier.
 *      Transcribed numbers are transcription errors waiting to happen, so none
 *      of them are trusted here -- they are recomputed.
 *   1b. A BRAND-WIDE ROW HAS NO PRECOMPUTED ANSWER. "thermador 15y across all
 *      product" resolves against each line's own column, so the same 15 lands on
 *      17 for a hood and 18 for a range. Those are recomputed too, for every
 *      line the brand could appear on.
 *   2. HALVES ROUND UP. A short expected life inflates "life used", which lowers
 *      the age score. The rounding error belongs on the side that does not cost
 *      somebody points for arithmetic.
 *   3. BRANDS MATCH AS WHOLE WORDS. The substring matcher this replaced scored
 *      Gaggenau and Fulgor as mass-market, because "gaggenau" contains "ge" and
 *      "fulgor" contains "lg". Both are asserted directly, by name.
 *   4. THE GUARDRAIL NEVER BLOCKS A VISIT. Not-serviced and nothing-to-maintain
 *      take an appliance off a plan; an unrecognised brand is a question for the
 *      office, not a wall in front of a technician.
 *   5. TWO REASONS, TWO SENTENCES. "We don't service this brand" and "there is
 *      no maintenance to do on a charcoal grill" are different facts and must
 *      never share wording.
 *   6. HVAC IS EXEMPT. Wilson services any system, so no brand check ever fires
 *      on one.
 *   7. NOTHING IMPLIES COVERAGE THAT DOES NOT EXIST. A brand Wilson neither
 *      sells nor services must not appear in any table that prices, tiers or
 *      dates an appliance.
 *
 * Every check that asserts an improvement is mutation-tested at the bottom: the
 * input is deliberately broken and the check has to fail. A check that cannot
 * fail is not protecting anything.
 *
 * Run: node _qa/verify-brand-lifespans.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
global.window = {};
eval(fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8"));

const config = window.WILSON_CONFIG;
const B = window.WILSON_BRANDS;
const W = window.WILSON_WATER;

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

const ROWS = config.brandLifespans;
const LINES = config.applianceLines;

/* The lifecycleMatrix row a line's anchored figure comes from. Read off the
   config rather than restated, so a renamed key breaks here rather than
   silently. `matrixSet` and `sets` differ for coffee -- see applianceLines. */
function setForLine(lineId) {
  return (LINES[lineId] || {}).matrixSet || ((LINES[lineId] || {}).sets || [])[0] || null;
}
const REAL_LINES = Object.keys(LINES);
const lineRows = ROWS.filter(function (r) { return r.line !== "*"; });
const wideRows = ROWS.filter(function (r) { return r.line === "*"; });

/* ========================================================================== */
console.log("=== the table is derived, not transcribed ===");

note("rows", ROWS.length + " (" + lineRows.length + " on a named line, " + wideRows.length + " brand-wide)");
note("brands", new Set(ROWS.map(function (r) { return r.brand; })).size);
note("series overrides", ROWS.filter(function (r) { return r.series; }).length);

/*
 * THE central check. `years` is the shipped number; recompute it from the two
 * parents on the same row and demand they agree. This is what makes the table
 * arguable: anybody can see the two inputs and check the arithmetic.
 */
check("every precomputed years is the rounded midpoint of its own two parents",
      lineRows.filter(function (r) {
        const want = r.anchored == null ? r.field : Math.round((r.field + r.anchored) / 2);
        return r.years !== want;
      }).map(function (r) { return r.brand + "/" + r.line; }), []);

/*
 * A brand-wide row must NOT carry a precomputed answer. If it did, the number
 * would be a midpoint against one line's column silently applied to all of them
 * -- which is the bug the wildcard exists to remove.
 */
check("no brand-wide row carries a precomputed years or anchored value",
      wideRows.filter(function (r) { return r.years != null || r.anchored != null; })
              .map(function (r) { return r.brand; }), []);

check("every brand-wide row does carry a field figure and a tier",
      wideRows.filter(function (r) { return !(r.field > 0) || !r.tier; })
              .map(function (r) { return r.brand; }), []);

/*
 * And resolved on every line, a brand-wide row has to produce that line's own
 * midpoint. This is where "across all product" is actually enforced.
 */
const wideMismatches = [];
const wideLeaks = [];
wideRows.forEach(function (r) {
  REAL_LINES.forEach(function (line) {
    const model = (r.series || {}).id ? (r.series.match || [""])[0] : "";
    const got = B.lifespanFor({ brand: r.brand, model: model, line: line }, null);
    const covered = (r.covers || []).indexOf(line) > -1;
    if (!covered) {
      /* Outside its coverage a brand-wide row must not answer at all. Asko has
         no outdoor grill and Bertazzoni no coffee system, and a table of claims
         about what Wilson sells should not contain one nobody would stand
         behind. A named-line row for the same brand may still answer. */
      if (got && got.brandWide) wideLeaks.push(r.brand + "/" + line);
      return;
    }
    if (!got) { wideMismatches.push(r.brand + "/" + line + " resolved to nothing"); return; }
    if (got.line !== line) return;              /* a named-line row won, which is correct */
    const column = Number((config.lifecycleMatrix[setForLine(line)] || {})[got.tier]);
    const want = isFinite(column) && column > 0 ? Math.round((got.field + column) / 2) : got.field;
    if (got.years !== want) {
      wideMismatches.push(r.brand + "/" + line + " got " + got.years + " want " + want);
    }
  });
});
check("every brand-wide row resolves to its own line's midpoint, on every line it covers",
      wideMismatches, []);
check("and answers on no line it does not cover",
      wideLeaks, []);

check("every brand-wide row declares which lines it covers",
      wideRows.filter(function (r) { return !(r.covers || []).length; })
              .map(function (r) { return r.brand; }), []);
check("and every line named in a coverage list exists",
      wideRows.reduce(function (acc, r) {
        (r.covers || []).forEach(function (l) { if (!LINES[l]) acc.push(r.brand + "/" + l); });
        return acc;
      }, []), []);

/* The two Cayden named, by name, so they cannot come back. */
check("Asko has no outdoor grill and Bertazzoni no coffee system",
      [B.lifespanFor({ brand: "Asko", line: "grill" }, null),
       B.lifespanFor({ brand: "Bertazzoni", line: "coffee" }, null)], [null, null]);
check("but both still answer on the lines they do sell",
      [B.lifespanFor({ brand: "Asko", line: "dishwashing" }, null).years,
       B.lifespanFor({ brand: "Bertazzoni", line: "cooking" }, null).years], [15, 14]);

/* Coverage I drafted is marked as mine. It is data, and it should be correctable
   as data rather than defended as though Cayden had supplied it. */
note("coverage lists still drafted by me, not confirmed",
     wideRows.filter(function (r) { return r.coversDrafted; }).length + " of " + wideRows.length);

/* The point of the wildcard, stated as a number: one field figure, two answers. */
check("Thermador's single 15 lands differently on a hood than on a range",
      [B.lifespanFor({ brand: "Thermador", line: "ventilation" }, null).years,
       B.lifespanFor({ brand: "Thermador", line: "cooking" }, null).years], [17, 18]);
check("and a Thermador hood no longer falls through to the category median",
      B.lifespanFor({ brand: "Thermador", line: "ventilation" }, null).brandWide, true);

/*
 * And `anchored` itself has to be what the matrix holds -- otherwise the
 * midpoint is a midpoint of a number nobody can trace. `coffee` is the sole
 * exception and carries null on purpose: averaging against the `generic`
 * fallback would be averaging against "unclassified".
 */
check("every anchored value equals lifecycleMatrix[line's matrix set][the row's tier]",
      lineRows.filter(function (r) {
        if (r.anchored == null) return false;
        return Number((config.lifecycleMatrix[setForLine(r.line)] || {})[r.tier]) !== Number(r.anchored);
      }).map(function (r) { return r.brand + "/" + r.line; }), []);

/*
 * And a row's tier must agree with what the brand resolves to -- UNLESS it is a
 * series row, which is exactly how a premium series of a mass brand is
 * expressed. GE Profile is the case: plain GE anchors on mass, Profile on
 * premium. Without this split the suite reported GE and Amana as broken data
 * when the schema was what was missing.
 */
check("a plain row's tier matches its brand, series rows excepted",
      ROWS.filter(function (r) { return !r.series && r.tier !== B.tierFor(r.brand, r.line); })
          .map(function (r) { return r.brand + "/" + r.line + " row=" + r.tier + " brand=" + B.tierFor(r.brand, r.line); }), []);

check("the series rows that do differ from their brand say which",
      ROWS.filter(function (r) { return r.series && r.tier !== B.tierFor(r.brand, r.line); })
          .map(function (r) { return r.brand + " " + r.series.label + ": " + B.tierFor(r.brand, r.line) + " -> " + r.tier; }),
      ["ge Profile: mass -> premium"]);

/*
 * A row may stand on Cayden's figure alone -- but only where no published figure
 * covers the equipment, and only if it SAYS SO. This used to name Miele coffee
 * literally, which would have broken the moment outdoor refrigeration arrived
 * with the same problem, so it asserts the rule.
 *
 * The rule matters in one direction especially: averaging an outdoor undercounter
 * fridge against NAHB's INDOOR refrigerator row turns Cayden's 8 years into 14,
 * which is a number nobody who services them would defend, printed on a
 * customer's report.
 */
const noAnchor = lineRows.filter(function (r) { return r.anchored == null; });
note("rows standing on the field figure alone", noAnchor.length);
check("every unanchored row records why it has no anchor",
      noAnchor.filter(function (r) { return String(r.noAnchorReason || "").length < 40; })
              .map(function (r) { return r.brand + "/" + r.line; }), []);
check("and every unanchored row's years IS the field figure, untouched",
      noAnchor.filter(function (r) { return r.years !== r.field; })
              .map(function (r) { return r.brand + "/" + r.line; }), []);
check("no ANCHORED row claims a reason for not having one",
      lineRows.filter(function (r) { return r.anchored != null && r.noAnchorReason; })
              .map(function (r) { return r.brand + "/" + r.line; }), []);
/*
 * And the reason has to be true: a row may only go unanchored on a line whose
 * category genuinely has no figure for this equipment. Anything else is a way to
 * opt out of the averaging rule row by row.
 */
const UNANCHORABLE = { coffee: true, refrigeration: "outdoor", ice: "outdoor" };
check("no row goes unanchored on a line that does have a published figure",
      noAnchor.filter(function (r) { return !UNANCHORABLE[r.line]; })
              .map(function (r) { return r.brand + "/" + r.line; }), []);
check("and an indoor brand cannot borrow the outdoor exemption",
      [B.lifespanFor({ brand: "Sub-Zero", line: "refrigeration" }, null).anchored,
       B.lifespanFor({ brand: "Sub-Zero", line: "ice" }, null).anchored,
       B.lifespanFor({ brand: "Scotsman", line: "ice" }, null).anchored],
      [20, 12, 12]);
check("the outdoor kitchen brands keep the figure Cayden gave, to the year",
      ["alfresco", "blaze", "coyote", "lynx", "dcs"].map(function (b) {
        return B.lifespanFor({ brand: b, line: "refrigeration" }, null).years;
      }), [8, 8, 8, 8, 8]);
check("and Kalamazoo keeps its own",
      B.lifespanFor({ brand: "Kalamazoo", line: "refrigeration" }, null).years, 12);

/* Rounding direction, asserted on the rows that actually land on a half. */
const halves = lineRows.filter(function (r) {
  return r.anchored != null && ((r.field + r.anchored) / 2) % 1 !== 0;
});
note("rows whose midpoint lands on a half year", halves.length);
check("every half-year midpoint rounded UP, never down",
      halves.filter(function (r) { return r.years !== Math.ceil((r.field + r.anchored) / 2); })
            .map(function (r) { return r.brand + "/" + r.line; }), []);

/* A typo guard. Nothing Wilson sells lasts 3 years or 60. */
/* A typo guard, applied to every figure the tool can actually produce -- the
   precomputed ones and every line a brand-wide row can resolve onto. */
const allResolved = lineRows.map(function (r) { return r.brand + "/" + r.line + "=" + r.years; })
  .concat(wideRows.reduce(function (acc, r) {
    REAL_LINES.forEach(function (line) {
      const got = B.lifespanFor({ brand: r.brand, line: line }, null);
      if (got) acc.push(r.brand + "/" + line + "=" + got.years);
    });
    return acc;
  }, []));
check("no expected life anywhere outside a plausible 5-30 year window",
      allResolved.filter(function (t) {
        const y = Number(t.split("=")[1]);
        return y < 5 || y > 30;
      }), []);

check("every row names a line that exists, or the brand-wide wildcard",
      ROWS.filter(function (r) { return r.line !== "*" && !LINES[r.line]; })
          .map(function (r) { return r.brand + "/" + r.line; }), []);

check("every line declares the matrix column its anchored figures come from",
      REAL_LINES.filter(function (l) { return !config.lifecycleMatrix[setForLine(l)]; }), []);

/*
 * A brand with lifespan rows but no tier row would fall back to the invented
 * "premium" default the moment it hit a line it has no row for -- which is the
 * exact failure this version exists to remove.
 */
check("every brand with lifespan rows also has a tier",
      Array.from(new Set(ROWS.map(function (r) { return r.brand; })))
           .filter(function (b) { return !config.brandTierDefaults[b]; }), []);

/* ========================================================================== */
console.log("\n=== brands match as whole words, and the two live bugs are named ===");
/*
 * These two are regression tests with a date on them. Before v0.9.30 the field
 * tool matched brands with `b.includes(name)`, so both of these resolved to a
 * mass-market tier and inherited a mass-market expected life -- feeding 25% of
 * the appliance score. Neither would ever have appeared as an error.
 */
check("Gaggenau does not resolve to ge", B.normalize("Gaggenau"), "gaggenau");
check("Gaggenau is luxury, not mass", B.tierFor("Gaggenau"), "luxury");
check("Fulgor does not resolve to lg", B.normalize("Fulgor"), "fulgor");
check("Fulgor is premium, not mass", B.tierFor("Fulgor"), "premium");

check("a longer key is never shadowed by a shorter one it contains",
      B.normalize("Bosch Thermotechnology"), "bosch thermotechnology");
check("and the plain brand still resolves", B.normalize("Bosch"), "bosch");

/*
 * The alias spellings were ALSO sitting in brandTierDefaults as their own rows --
 * two copies of one fact, which is how the copies drift. They live only in
 * brandAliases now, and the tier still resolves through them.
 */
check("no alias spelling carries its own tier row",
      ["subzero", "caf\u00e9", "jenn-air", "sub zero"]
        .filter(function (k) { return Object.prototype.hasOwnProperty.call(config.brandTierDefaults, k); }), []);
check("but the tier still resolves through the alias",
      ["subzero", "caf\u00e9", "jenn-air"].map(function (k) { return B.tierFor(k); }),
      ["luxury", "premium", "premium"]);

check("aliases resolve", [B.normalize("subzero"), B.normalize("SUB ZERO"),
                          B.normalize("uline"), B.normalize("Jenn-Air"),
                          B.normalize("Signature Kitchen Suite")],
      ["sub-zero", "sub-zero", "u-line", "jennair", "sks"]);

/* "Zline" used to stand in for an unrecognised brand here. It is now a brand
   Cayden has ruled OUT by name, so it resolves -- and the check needed a brand
   that genuinely is not in any table. */
check("a brand nobody has heard of resolves to nothing rather than something",
      /* "Bertazzoni Heritage Nonesuch" was the second example and resolved --
         correctly, on the whole word "bertazzoni". A string that happens to
         contain a known brand is not an unknown brand. */
      [B.normalize("Forno"), B.normalize("Ravenna Kitchens"), B.normalize("")],
      ["", "", ""]);

/*
 * The reason the alias pass runs before the whole-word pass: "GE Cafe" contains
 * "ge" as a whole word, and Café is a different tier and a different lifespan.
 */
check("GE Cafe resolves to cafe, not ge", B.normalize("GE Cafe CVE28DP2NS1"), "cafe");

/* ========================================================================== */
console.log("\n=== brand and line, because one tier cannot say four things ===");
/*
 * Cayden's table is brand AND product line specific in a third of its rows.
 * This is the case that proved the old brand->tier->years chain could not hold.
 */
check("Miele is four different numbers across the four lines he gave",
      ["dishwashing", "refrigeration", "cooking", "coffee"].map(function (line) {
        return line + "=" + B.lifespanFor({ brand: "Miele", line: line }, null).years;
      }), ["dishwashing=15", "refrigeration=16", "cooking=18", "coffee=10"]);

/*
 * A line the field table is silent about falls back rather than being invented.
 * Miele laundry used to be the example and now has Cayden's own figures, so this
 * uses Cove, which makes dishwashers and nothing else.
 */
check("a line the field table is silent about falls back instead of guessing",
      [B.lifespanFor({ brand: "Cove", line: "refrigeration" }, null),
       W.expectedLife("refrigerator", "luxury", null, { brand: "Cove", line: "refrigeration" }).basis.kind],
      [null, "category"]);
check("and Miele laundry is no longer that example -- it has his figures now",
      [B.lifespanFor({ brand: "Miele", line: "laundry_washer" }, null).field,
       B.lifespanFor({ brand: "Miele", line: "laundry_dryer" }, null).field], [15, 15]);

check("Zephyr differs across refrigeration, vent and ice",
      ["refrigeration", "ventilation", "ice"].map(function (l) {
        return B.lifespanFor({ brand: "Zephyr", line: l }, null).years;
      }), [13, 16, 10]);

/*
 * Amana is the row a single brand table could not get right: premium on the
 * HVAC side, mass on the appliance side.
 */
check("Amana refrigeration is priced off the mass column, not the HVAC premium one",
      B.lifespanFor({ brand: "Amana", line: "refrigeration" }, null).anchored,
      config.lifecycleMatrix.refrigerator.mass);

check("the line can be inferred from the checkpoint set when not supplied",
      B.lifespanFor({ brand: "Wolf" }, "cooking").years,
      B.lifespanFor({ brand: "Wolf", line: "cooking" }, null).years);

/*
 * `generic` is a fallback protocol, not a product line. Resolving it to one
 * would put a real figure and an "unclassified" figure into the same average.
 */
/*
 * `generic` and `laundry` resolve to no line, deliberately. `generic` means
 * "unclassified"; `laundry` is the combined-unit fallback, and a laundry centre
 * is already priced and inspected as a separate washer and dryer.
 */
check("generic and the laundry-centre fallback resolve to no line at all",
      [B.lineForSet("generic"), B.lineForSet("laundry")], ["", ""]);

/*
 * The microwave line began as MY inference -- a way for "across all product" to
 * reach a speed oven, since Cayden's original table never mentioned microwaves.
 * It is his now: he gave figures for Sharp, Viking, Monogram and LG, which is
 * what turns an inference into data. This check used to forbid a
 * microwave-specific row on exactly those grounds and had to be inverted.
 */
check("the microwave line now carries figures Cayden gave",
      ROWS.filter(function (r) { return r.line === "microwave"; })
          .map(function (r) { return r.brand; }).sort(),
      ["lg", "monogram", "sharp", "viking"]);
check("a brand-wide figure still reaches a speed oven where there is no row",
      [B.lifespanFor({ brand: "Thermador", line: "microwave" }, null).years,
       B.lifespanFor({ brand: "Thermador", line: "microwave" }, null).brandWide], [14, true]);
check("and a brand with neither falls to the published median",
      [B.lifespanFor({ brand: "Miele", line: "microwave" }, null),
       W.expectedLife("microwave", "luxury", null, { brand: "Miele", line: "microwave" }).base],
      [null, config.lifecycleMatrix.microwave.luxury]);

check("a built-in coffee asset finds its line despite running generic checks",
      B.lineForAsset({ customerCategory: "coffee", checkpointSet: "generic" }), "coffee");

check("and so a Miele coffee system gets 10 years, not the generic 15",
      W.expectedLife("generic", "luxury", null,
        { brand: "Miele", line: B.lineForAsset({ customerCategory: "coffee" }) }).base, 10);

/* ========================================================================== */
console.log("\n=== a brand Wilson has no field experience with ===");
/*
 * Cayden on Smeg: "WE ARE PICKING UP SMEG SOON BUT I DONT KNOW MUCH ABOUT IT YET.
 * GO WITH STANDARD FOR SMEG."
 *
 * So Smeg gets a tier and nothing else. The temptation is to invent a field
 * figure from the tier and put it in the table, which would make a number nobody
 * has measured indistinguishable from sixty that were. It resolves to the
 * published median instead, and the basis says "category" so a report can too.
 */
check("Smeg is tiered", B.tierFor("Smeg"), "premium");
check("but carries no lifespan row on any line",
      ROWS.filter(function (r) { return r.brand === "smeg"; }), []);
check("so it resolves to the published median and says so",
      (function () {
        const life = W.expectedLife("cooking", B.tierFor("Smeg"), null,
                                    { brand: "Smeg", line: "cooking" });
        return [life.base, life.basis.kind];
      })(), [config.lifecycleMatrix.cooking.premium, "category"]);
check("and it is serviced, not excluded",
      B.serviceability({ brand: "Smeg" }).state, "ok");

/* ========================================================================== */
console.log("\n=== whose judgement each number rests on ===");
/*
 * Tier moves the anchored half of every average, so a tier I chose moves a
 * number Cayden will be asked to defend. Marked in the data rather than in a
 * comment, and counted here so it stays visible as it shrinks.
 */
const drafted = ROWS.filter(function (r) { return r.tierDrafted; });
note("rows whose TIER is mine, not Cayden's", drafted.length + " of " + ROWS.length);
note("rows whose COVERAGE is mine", wideRows.filter(function (r) { return r.coversDrafted; }).length +
     " of " + wideRows.length);
/* The three he ruled on directly must NOT be marked as mine. */
check("U-Line, Marvel and Asko are recorded as his calls, not mine",
      ROWS.filter(function (r) {
        return ["u-line", "marvel", "asko"].indexOf(r.brand) > -1 && r.tierDrafted;
      }).map(function (r) { return r.brand; }), []);
/* Written wrong the first time: this expected Marvel to be luxury. Cayden said
   "uline and marvel are terrible and we have stopped selling them for this
   reason. make them mass" -- both mass, and the data was right. */
check("and their tiers are what he said",
      [B.tierFor("U-Line"), B.tierFor("Marvel"), B.tierFor("Asko")],
      ["mass", "mass", "luxury"]);

/* ========================================================================== */
console.log("\n=== model series beat their brand's plain row ===");

check("La Cornue splits on the model text",
      [B.lifespanFor({ brand: "La Cornue", model: "Chateau 150" }, "cooking").years,
       B.lifespanFor({ brand: "La Cornue", model: "CornuFe 110 Albertine" }, "cooking").years],
      [23, 18]);

check("True commercial is a different appliance from True residential",
      [B.lifespanFor({ brand: "True", model: "TUC-24-HC" }, "refrigerator").years,
       B.lifespanFor({ brand: "True", model: "TR-24RID" }, "refrigerator").years],
      [23, 20]);

check("the Maytag commercial washer is not the Maytag washer",
      [B.lifespanFor({ brand: "Maytag", model: "MTW8305DW" }, "washer").years,
       B.lifespanFor({ brand: "Maytag", model: "MVW6200KW" }, "washer").years],
      [11, 9]);

check("GE Profile is not GE",
      [B.lifespanFor({ brand: "GE", model: "Profile PVD28BYNFS" }, "refrigerator").years,
       B.lifespanFor({ brand: "GE", model: "GNE27JYMFS" }, "refrigerator").years],
      [13, 11]);

/* Both GE rows are brand-wide, so the series override has to travel across
   lines too rather than only working on refrigeration. */
check("and Profile stays premium on cooking as well",
      [B.lifespanFor({ brand: "GE", model: "Profile PGB935" }, "cooking").years,
       B.lifespanFor({ brand: "GE", model: "JGB735" }, "cooking").years],
      [14, 11]);

check("a named-line row always beats a brand-wide one",
      [B.lifespanFor({ brand: "KitchenAid", model: "KBSN708MPS" }, "refrigerator").series,
       B.lifespanFor({ brand: "KitchenAid" }, "refrigerator").brandWide],
      ["Built-in refrigeration", true]);

/*
 * A series row must not win by existing. With no model text there is nothing to
 * match, and the plain row is the honest answer.
 */
/*
 * La Cornue has only series rows. With no model text there is nothing to match
 * and no plain row to fall to, so it drops through to the category column --
 * 20 years for luxury cooking, which sits between the Château's 23 and the
 * Cornufé's 18. Assigning one of the two would be guessing which range is in
 * somebody's kitchen.
 */
check("a series-only brand with no model text falls through to the category",
      [B.lifespanFor({ brand: "La Cornue" }, "cooking"),
       W.expectedLife("cooking", B.tierFor("La Cornue", "cooking"), null, { brand: "La Cornue", line: "cooking" }).base],
      [null, config.lifecycleMatrix.cooking.luxury]);

check("and La Cornue is the only brand in the table with no plain row",
      Array.from(new Set(ROWS.map(function (r) { return r.brand; })))
        .filter(function (b) {
          const mine = ROWS.filter(function (r) { return r.brand === b; });
          return mine.every(function (r) { return Boolean(r.series); });
        }), ["la cornue"]);

check("a brand that does have a plain row uses it when the model is unknown",
      [B.lifespanFor({ brand: "True" }, "refrigerator").series,
       B.lifespanFor({ brand: "Maytag" }, "washer").series], [null, null]);

check("a series row reports which series it was, so a report can say so",
      B.lifespanFor({ brand: "True", model: "TUC-24" }, "refrigerator").series, "Commercial");

/* ========================================================================== */
console.log("\n=== the guardrail: two reasons, two sentences, no walls ===");

const copy = config.serviceabilityCopy;

note("brands on the not-serviced list", config.notServicedBrands.length);
check("the four majors are still on it",
      ["samsung", "dacor", "frigidaire", "electrolux"]
        .filter(function (b) { return !config.notServicedBrands.some(function (r) { return r.brand === b; }); }), []);
/*
 * Kamado and pellet grills are NOT in the Big Green Egg bucket. BGE is
 * nothing-to-maintain: Wilson sells it and would service it. These Wilson does
 * not sell or service at all, which is a different fact and gets the other
 * sentence. Conflating them would tell a Traeger owner the wrong thing.
 */
check("kamado and pellet brands are not-serviced, not nothing-to-maintain",
      ["kamado joe", "primo", "traeger", "memphis", "green mountain"]
        .map(function (b) { return B.serviceability({ brand: b }).state; }),
      ["not_serviced", "not_serviced", "not_serviced", "not_serviced", "not_serviced"]);
check("and Big Green Egg is still the other one",
      B.serviceability({ brand: "Big Green Egg" }).state, "not_maintainable");
check("no brand is on both exclusion lists",
      config.notServicedBrands.filter(function (r) {
        return config.notMaintainable.some(function (m) { return m.brand === r.brand; });
      }).map(function (r) { return r.brand; }), []);
check("Smeg is excluded from neither",
      [config.notServicedBrands.some(function (r) { return r.brand === "smeg"; }),
       config.notMaintainable.some(function (r) { return r.brand === "smeg"; })], [false, false]);
check("aliases reach the excluded brands too",
      ["AOG", "ZLine", "Thor Kitchen", "Green Mountain Grills", "Fire-Magic"]
        .map(function (b) { return B.serviceability({ brand: b }).state; }),
      ["ok", "not_serviced", "not_serviced", "not_serviced", "ok"]);

/*
 * A tier row is a statement that an appliance is inside the plan. Leaving
 * Samsung and Frigidaire in it implied coverage that does not exist.
 */
check("and none of them appear in brandTierDefaults",
      config.notServicedBrands.filter(function (r) { return config.brandTierDefaults[r.brand]; }), []);
check("nor in brandLifespans",
      config.notServicedBrands.filter(function (r) {
        return ROWS.some(function (x) { return x.brand === r.brand; });
      }), []);

check("Big Green Egg is not maintainable, and is not in the lifespan table",
      [config.notMaintainable.map(function (r) { return r.brand; }),
       ROWS.filter(function (r) { return r.brand === "big green egg"; }).length],
      [["big green egg"], 0]);

check("a not-serviced brand and an unmaintainable one never share wording",
      copy.not_serviced.customer === copy.not_maintainable.customer, false);
check("both customer sentences say something",
      [copy.not_serviced.customer.length > 0, copy.not_maintainable.customer.length > 0],
      [true, true]);
/*
 * An unrecognised brand has nothing to tell a customer yet -- it is a question
 * for the office. A sentence here would leak an internal uncertainty onto a
 * customer's report.
 */
check("an unrecognised brand has no customer-facing sentence",
      copy.unknown_brand.customer, "");
check("but it does have an office instruction with a next action",
      copy.unknown_brand.office.length > 0, true);

const states = [
  ["Samsung", {}, "not_serviced"],
  ["Big Green Egg", {}, "not_maintainable"],
  ["Wolf", {}, "ok"],
  ["", {}, "unstated"],
  ["Forno", {}, "unknown"],
  ["Samsung", { group: "hvac" }, "ok"],
  ["Samsung", { checkpointSet: "hvac_furnace" }, "ok"]
];
check("every state resolves as intended",
      states.map(function (s) {
        return B.serviceability(Object.assign({ brand: s[0] }, s[1])).state;
      }), states.map(function (s) { return s[2]; }));

/*
 * Registration deliberately does not ask for a brand -- Cayden: "i don't want to
 * force a customer to enter brand or model number during registration as that
 * will reduce our take rate". So a missing brand is a normal enrollment, not a
 * problem, and must never read as one.
 */
check("no brand yet is 'unstated' and fully serviceable",
      (function () {
        const s = B.serviceability({ brand: "" });
        return [s.state, s.serviceable, s.maintainable, s.office];
      })(), ["unstated", true, true, ""]);

/*
 * The guardrail takes appliances off plans. It does not stop a technician from
 * working, and it does not stop a household from enrolling.
 */
check("an unknown brand is still serviceable -- it is a question, not a wall",
      (function () {
        const s = B.serviceability({ brand: "Forno" });
        return [s.serviceable, s.maintainable];
      })(), [true, true]);

check("nothing-to-maintain still counts as serviced, because Wilson sells it",
      (function () {
        const s = B.serviceability({ brand: "Big Green Egg" });
        return [s.serviceable, s.maintainable];
      })(), [true, false]);

check("HVAC is exempt for every not-serviced brand, not just one",
      config.notServicedBrands.filter(function (r) {
        return B.serviceability({ brand: r.brand, group: "hvac" }).state !== "ok";
      }), []);

/* ========================================================================== */
console.log("\n=== the figure knows where it came from ===");

check("a brand row reports itself as a brand basis, with both parents",
      (function () {
        const life = W.expectedLife("refrigerator", "luxury", null, { brand: "Sub-Zero", line: "refrigeration" });
        return [life.basis.kind, life.base, life.basis.field, life.basis.anchored];
      })(), ["brand", 23, 25, 20]);

check("an unrecognised brand falls back and says so",
      (function () {
        const life = W.expectedLife("refrigerator", "premium", null, { brand: "Forno", line: "refrigeration" });
        return [life.basis.kind, life.base];
      })(), ["category", config.lifecycleMatrix.refrigerator.premium]);

/*
 * Backwards compatibility, asserted rather than assumed: every call site was
 * converted one at a time, and an unconverted one has to keep working exactly
 * as it did rather than silently changing a number.
 */
check("omitting the identity gives the pre-v0.9.30 answer exactly",
      W.expectedLife("dishwasher", "luxury", null).base,
      config.lifecycleMatrix.dishwasher.luxury);

/*
 * Hard water multiplies whatever the base is. A brand row must not escape it --
 * that would be two expected-life rules again, which is the mistake this whole
 * file exists to avoid.
 */
const hard = W.resolve({ gpg: 20 });
const subzeroHard = W.expectedLife("refrigerator", "luxury", hard, { brand: "Sub-Zero", line: "refrigeration" });
check("the water factor applies on top of a brand figure",
      [subzeroHard.applied, subzeroHard.base, subzeroHard.adjusted < subzeroHard.base],
      [true, 23, true]);
check("and it is the same factor a category figure would get",
      subzeroHard.factor, W.expectedLife("refrigerator", "luxury", hard).factor);

/*
 * A dryer runs no water. Shortening its life for hard water would be inventing
 * a mechanism -- asserted here too, because the brand path is a new way in.
 */
check("a brand figure on a waterless appliance is still not adjusted",
      W.expectedLife("dryer", "mass", hard, { brand: "Whirlpool", line: "laundry_dryer" }).applied, false);

/* ========================================================================== */
console.log("\n=== the control on the field card matches what it controls ===");
/*
 * The tier dropdown used to be the only thing that chose expected life, and its
 * hint read "Defaults from brand". Since brand-and-line rows arrived it chooses
 * NOTHING for anything Wilson sells -- a Sub-Zero refrigerator is 23 years
 * whatever the dropdown says. A control that appears to drive a number and does
 * not is worse than no control, so the card states the source instead.
 */
const techSrc = fs.readFileSync(path.join(ROOT, "assets", "tech-maintenance.js"), "utf8");
/*
 * Scoped to the MARKUP, not the file. The first version searched the whole
 * source for "Defaults from brand" and matched the comment that explains why the
 * hint was removed -- so the check failed on the very change it was written to
 * confirm. A test that reads the commentary is not reading the code.
 */
const hintMarkup = (techSrc.match(/<span class="hint">[^<]*<\/span>/g) || []).join(" | ");
check("no hint in the markup claims the tier sets the expected life",
      /Defaults from brand/.test(hintMarkup), false);
check("and it says what tier is actually for",
      /Sets how deep the protocol goes/.test(techSrc), true);
check("the expected-life field carries a source caption",
      /id="tech-life-source"/.test(techSrc), true);
check("and the caption is refreshed when the card re-renders, not only on load",
      (techSrc.match(/expectedLifeSource\(/g) || []).length >= 3, true);

/*
 * The behaviour behind that caption: a brand row wins over the tier, so moving
 * the dropdown cannot change the years. Asserted here rather than only in the
 * browser, because this is the reason the label had to change.
 */
check("moving the tier cannot change a figure a brand row supplied",
      ["luxury", "premium", "mass"].map(function (t) {
        return W.expectedLife("refrigerator", t, null, { brand: "Sub-Zero", line: "refrigeration" }).base;
      }), [23, 23, 23]);
check("but it still moves a figure the category median supplied",
      new Set(["luxury", "premium", "mass"].map(function (t) {
        return W.expectedLife("refrigerator", t, null, { brand: "Forno", line: "refrigeration" }).base;
      })).size, 3);

/* ========================================================================== */
console.log("\n=== brand still must not be a score penalty in disguise ===");
/*
 * `reportedNotScored.brand` promises brand "never adjusts a score up or down".
 * That is not literally true -- brand picks expected life, which is 25% of the
 * appliance score through the age term. Averaging the field table against the
 * anchored one was Cayden's answer, and it halved the spread rather than
 * removing it. The number is asserted so a future edit that widens it again is
 * a visible decision rather than a side effect.
 */
function overallAt(age, expected) {
  const ratio = Math.max(0, age) / expected;
  const ageScore = Math.max(0, Math.min(100, Math.round(100 - 60 * ratio)));
  const vw = config.reportScoring.vitalWeight, aw = config.reportScoring.ageWeight;
  return Math.round(100 * vw + ageScore * aw);
}
/*
 * Every brand that can produce a refrigeration figure, brand-wide rows included.
 *
 * SPLIT INDOOR FROM OUTDOOR, and the reason is not cosmetic. An outdoor
 * undercounter fridge at 8 years is 88% through its life; a Sub-Zero at 23 is
 * 30% through its. Putting them in one range measures the difference between two
 * kinds of equipment and reports it as a brand penalty. The indoor figure is the
 * one that answers "does the badge move the score"; the combined figure is
 * reported beside it so nothing is hidden.
 */
function spread(rowsIn, pick) {
  const y = rowsIn.map(pick);
  return overallAt(7, Math.max.apply(null, y)) - overallAt(7, Math.min.apply(null, y));
}
const fridgeAll = Array.from(new Set(ROWS.map(function (r) { return r.brand; })))
  .map(function (b) { return B.lifespanFor({ brand: b, line: "refrigeration" }, null); })
  .filter(Boolean);
const fridge = fridgeAll.filter(function (r) { return r.anchored != null; });   /* indoor */
const outdoor = fridgeAll.filter(function (r) { return r.anchored == null; });
note("brands resolving a refrigeration figure", fridgeAll.length +
     " (" + fridge.length + " indoor, " + outdoor.length + " outdoor)");
note("indoor refrigeration spread at 7 yr, combined-with-outdoor in brackets",
     spread(fridge, function (r) { return r.years; }) + " pts [" +
     spread(fridgeAll, function (r) { return r.years; }) + " pts]");
const spanNow = spread(fridge, function (r) { return r.years; });
const spanField = spread(fridge, function (r) { return r.field; });
note("refrigeration score spread at 7 yr, resolved table", spanNow + " pts");
note("the same spread on the raw field table", spanField + " pts");
check("averaging narrowed the indoor badge-only spread rather than widening it",
      spanNow < spanField, true);
check("and the spread is still recorded, not claimed to be zero", spanNow, 5);
/*
 * Outdoor equipment widens the overall figure back out, and that is a real
 * difference in remaining life rather than a brand penalty -- an outdoor fridge
 * genuinely does not last as long as an indoor one. Asserted so it stays a
 * stated fact rather than a surprise on somebody's report.
 */
check("outdoor equipment widens the combined figure, for a reason that is real",
      spread(fridgeAll, function (r) { return r.years; }) > spanNow, true);
check("and every outdoor row says why it is not averaged",
      outdoor.filter(function (r) { return !r.years || r.years !== r.field; }).length, 0);

/* ========================================================================== */
console.log("\n=== mutation tests: every assertion above can fail ===");
/*
 * Each of these breaks one input and re-runs the check that should catch it. A
 * check that passes on broken data is decoration.
 */
let mutations = 0;
const mutationFailures = [];
function mutation(label, mutate, detector) {
  mutations += 1;
  const snapshot = JSON.stringify({
    rows: config.brandLifespans,
    tiers: config.brandTierDefaults,
    notServiced: config.notServicedBrands,
    notMaintainable: config.notMaintainable,
    copy: config.serviceabilityCopy,
    lines: config.applianceLines,
    byLine: config.brandTierByLine
  });
  let caught = false;
  try {
    mutate();
    caught = detector() === false;
  } finally {
    const s = JSON.parse(snapshot);
    config.brandLifespans.length = 0;
    s.rows.forEach(function (r) { config.brandLifespans.push(r); });
    Object.keys(config.brandTierDefaults).forEach(function (k) { delete config.brandTierDefaults[k]; });
    Object.assign(config.brandTierDefaults, s.tiers);
    config.notServicedBrands.length = 0;
    s.notServiced.forEach(function (r) { config.notServicedBrands.push(r); });
    config.notMaintainable.length = 0;
    s.notMaintainable.forEach(function (r) { config.notMaintainable.push(r); });
    Object.keys(config.serviceabilityCopy).forEach(function (k) { delete config.serviceabilityCopy[k]; });
    Object.assign(config.serviceabilityCopy, s.copy);
    Object.keys(config.applianceLines).forEach(function (k) { delete config.applianceLines[k]; });
    Object.assign(config.applianceLines, s.lines);
    Object.keys(config.brandTierByLine).forEach(function (k) { delete config.brandTierByLine[k]; });
    Object.assign(config.brandTierByLine, s.byLine);
  }
  if (!caught) mutationFailures.push(label);
  console.log((caught ? "ok   " : "FAIL ") + ("caught: " + label).padEnd(72));
}

function midpointsAgree() {
  return config.brandLifespans.filter(function (r) { return r.line !== "*"; })
    .every(function (r) {
      const want = r.anchored == null ? r.field : Math.round((r.field + r.anchored) / 2);
      return r.years === want;
    });
}
function brandWideStaysUnresolved() {
  return config.brandLifespans.filter(function (r) { return r.line === "*"; })
    .every(function (r) { return r.years == null && r.anchored == null; });
}
function anchorsAgree() {
  return config.brandLifespans.every(function (r) {
    if (r.anchored == null || r.line === "*") return true;
    return Number((config.lifecycleMatrix[setForLine(r.line)] || {})[r.tier]) === Number(r.anchored);
  });
}
function everyBrandTiered() {
  return config.brandLifespans.every(function (r) { return Boolean(config.brandTierDefaults[r.brand]); });
}
function noServicedBrandTiered() {
  return config.notServicedBrands.every(function (r) { return !config.brandTierDefaults[r.brand]; });
}
function sentencesDiffer() {
  return config.serviceabilityCopy.not_serviced.customer !== config.serviceabilityCopy.not_maintainable.customer;
}
function halvesRoundUp() {
  return config.brandLifespans.every(function (r) {
    if (r.anchored == null || r.line === "*") return true;
    if (((r.field + r.anchored) / 2) % 1 === 0) return true;
    return r.years === Math.ceil((r.field + r.anchored) / 2);
  });
}

mutation("a years value edited away from its own midpoint",
  function () { config.brandLifespans[0] = Object.assign({}, config.brandLifespans[0], { years: 99 }); },
  midpointsAgree);

mutation("a half-year midpoint rounded DOWN instead of up",
  function () {
    const i = config.brandLifespans.findIndex(function (r) {
      return r.line !== "*" && r.anchored != null && ((r.field + r.anchored) / 2) % 1 !== 0;
    });
    const r = config.brandLifespans[i];
    config.brandLifespans[i] = Object.assign({}, r, { years: Math.floor((r.field + r.anchored) / 2) });
  },
  halvesRoundUp);

mutation("a brand-wide coverage list emptied, so the row answers everywhere again",
  function () {
    const i = config.brandLifespans.findIndex(function (r) { return r.brand === "asko" && r.line === "*"; });
    config.brandLifespans[i] = Object.assign({}, config.brandLifespans[i], { covers: [] });
  },
  function () {
    return config.brandLifespans.filter(function (r) { return r.line === "*"; })
      .every(function (r) { return (r.covers || []).length > 0; });
  });

mutation("a line added to a coverage list that the brand does not sell",
  function () {
    const i = config.brandLifespans.findIndex(function (r) { return r.brand === "asko" && r.line === "*"; });
    config.brandLifespans[i] = Object.assign({}, config.brandLifespans[i],
      { covers: config.brandLifespans[i].covers.concat(["grill"]) });
  },
  function () { return B.lifespanFor({ brand: "Asko", line: "grill" }, null) === null; });

mutation("a brand-wide row given a precomputed answer, freezing one line's column",
  function () {
    const i = config.brandLifespans.findIndex(function (r) { return r.line === "*"; });
    config.brandLifespans[i] = Object.assign({}, config.brandLifespans[i], { years: 15, anchored: 15 });
  },
  brandWideStaysUnresolved);

mutation("a line's matrixSet removed, so a brand-wide row has nothing to average",
  function () { delete config.applianceLines.ventilation.matrixSet; },
  function () { return B.lifespanFor({ brand: "Thermador", line: "ventilation" }, null).years === 17; });

mutation("an anchored value that no longer matches lifecycleMatrix",
  function () {
    const i = config.brandLifespans.findIndex(function (r) { return r.anchored != null && r.line !== "*"; });
    config.brandLifespans[i] = Object.assign({}, config.brandLifespans[i], { anchored: 42 });
  },
  anchorsAgree);

mutation("a brand's tier row deleted, sending it back to the premium default",
  function () { delete config.brandTierDefaults.gaggenau; },
  everyBrandTiered);

mutation("Samsung put back into the tier table, implying coverage",
  function () { config.brandTierDefaults.samsung = "mass"; },
  noServicedBrandTiered);

mutation("the two exclusion sentences collapsed into one",
  function () { config.serviceabilityCopy.not_maintainable.customer = config.serviceabilityCopy.not_serviced.customer; },
  sentencesDiffer);

mutation("a not-serviced brand made to look serviceable",
  function () { config.notServicedBrands.length = 0; },
  function () { return B.serviceability({ brand: "Samsung" }).state === "not_serviced"; });

/*
 * This one was written wrong the first time: it added Trane to the blocklist and
 * then asserted an HVAC Trane still came back "ok". That is the exemption
 * WORKING, so the mutation could never be caught -- it was a positive check
 * wearing a mutation's clothes. The exemption lives in code, not config, so the
 * honest mutation here is of the blocklist: adding a brand must take effect on
 * the appliance side, and the HVAC side must be the only thing that ignores it.
 */
let hvacStayedExempt = null;
mutation("a brand added to the not-serviced list failing to take effect",
  function () { config.notServicedBrands.push({ brand: "trane", label: "Trane" }); },
  function () {
    hvacStayedExempt = B.serviceability({ brand: "Trane", group: "hvac" }).state === "ok";
    return B.serviceability({ brand: "Trane" }).state === "ok";
  });
check("and the HVAC side ignored that addition, as it must",
      hvacStayedExempt, true);

mutation("the Amana appliance-side tier override removed, restoring the HVAC tier",
  function () { delete config.brandTierByLine.amana; },
  function () { return B.tierFor("Amana", "refrigeration") === "mass"; });

mutation("generic wired up as a product line, so a fallback becomes a figure",
  function () { config.applianceLines.generic = { label: "Generic", sets: ["generic"] }; },
  function () { return B.lineForSet("generic") === ""; });

console.log("");
if (failures.length || mutationFailures.length) {
  if (failures.length) {
    console.log(failures.length + " FAILURE(S) of " + checks + " checks:");
    failures.forEach(function (f) { console.log("  - " + f); });
  }
  if (mutationFailures.length) {
    console.log(mutationFailures.length + " MUTATION(S) NOT CAUGHT of " + mutations + ":");
    mutationFailures.forEach(function (f) { console.log("  - " + f); });
  }
  process.exit(1);
}
console.log("ALL " + checks + " BRAND LIFESPAN CHECKS PASSED (+ " + mutations + " mutations caught)");

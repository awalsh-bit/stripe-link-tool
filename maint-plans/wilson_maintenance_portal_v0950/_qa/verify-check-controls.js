/*
 * DOES THE CONTROL MATCH WHAT IS BEING MEASURED?
 *
 * Cayden's words, after using the tool: "it seems like all of the health checks
 * need a pass to verify that the options make sense for the type of check /
 * measurement being documented." He was right, and he found four symptoms of
 * it in about ten minutes:
 *
 *   - a wall oven asked for ONE number for "actual temp / set point", so the
 *     two numbers whose difference IS the measurement could not both be
 *     recorded
 *   - door seals scored 0 whatever condition was chosen
 *   - "Seal condition" opened the number pad, and so did nearly every other
 *     result label -- a rubber gasket asked to be entered as a number
 *   - "Filter & sump condition" offered only completed / partly / not done,
 *     because a condition had been classified as work performed
 *
 * The first three came from ONE line in tech-answers.js: a keypad button was
 * emitted whenever a checkpoint carried a `readingLabel`, and every checkpoint
 * carried one left over from the typed UI. The fourth was a category error in
 * the config, repeated nine times.
 *
 * These are the invariants that make that class of defect unrepresentable. They
 * run against the real config and the real rendering functions -- no restating
 * of the rules, no fixtures.
 *
 * Run: node _qa/verify-check-controls.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
global.window = {};
/* tech-answers.js only touches the DOM inside handlers, so a stub is enough to
   load it and call the pure rendering functions. */
global.document = {
  getElementById: () => null,
  createElement: () => ({ innerHTML: "", firstChild: null }),
  body: { classList: { add() {}, remove() {} }, appendChild() {} },
  querySelectorAll: () => [],
  querySelector: () => null,
};
eval(fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8"));
eval(fs.readFileSync(path.join(ROOT, "assets", "tech-answers.js"), "utf8"));

const config = window.WILSON_CONFIG;
const ANSWERS = window.WILSON_ANSWERS;
const INPUT = window.WILSON_INPUT;

let checks = 0;
const failures = [];

function check(label, got, want) {
  checks += 1;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures.push(label + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
  console.log((ok ? "ok   " : "FAIL ") + label.padEnd(72) +
              (ok ? "" : " " + JSON.stringify(got)));
}

function note(label, value) {
  console.log("     " + label.padEnd(72) + " " + (typeof value === "string" ? value : JSON.stringify(value)));
}

/* Every checkpoint in the product, with its resolved answer. */
const ALL = [];
Object.keys(config.checkpointSets).forEach(function (setKey) {
  (config.checkpointSets[setKey] || []).forEach(function (cp) {
    ALL.push({ setKey: setKey, cp: cp, answer: ANSWERS.for(setKey, cp.id),
               ref: setKey + "." + cp.id });
  });
});
note("checkpoints under audit", ALL.length + " across " + Object.keys(config.checkpointSets).length + " protocols");

/* ==========================================================================
   1. A NUMBER PAD APPEARS ONLY WHERE A NUMBER IS THE ANSWER

   Asserted against the real renderer rather than the config, because the defect
   lived in the renderer: the config's `readingLabel` was innocent, and the
   button it produced was not.
   ========================================================================== */
console.log("\n=== the number pad only where a number is the answer ===");
const spurious = [];
const missingPad = [];
ALL.forEach(function (entry) {
  const draftCheck = {
    id: entry.cp.id, name: entry.cp.name,
    readingLabel: entry.cp.readingLabel, readingFields: entry.cp.readingFields,
    readings: {}, reading: "",
  };
  const html = INPUT.readingButtons(draftCheck, 0, entry.answer);
  const hasPad = html.indexOf("data-answer-keypad") >= 0;
  const fields = INPUT.fieldsFor(draftCheck, entry.answer);
  const takesNumber = entry.answer.control === "keypad" || fields.length > 0;
  if (hasPad && !takesNumber) spurious.push(entry.ref + " (" + entry.answer.control + ")");
  if (!hasPad && takesNumber) missingPad.push(entry.ref);
});
check("no check opens the number pad for an answer that is not a number", spurious, []);
check("every check that takes a reading offers the pad", missingPad, []);

/* ==========================================================================
   2. TWO QUANTITIES ARE TWO FIELDS

   "Actual temp / set point" in one box is not a measurement, it is a note. Any
   numeric check declares its fields explicitly, with a label per field, so the
   set point and the reading are separate values the report can subtract.
   ========================================================================== */
console.log("\n=== a measurement of two things has two fields ===");
const lumped = [];
const unlabelled = [];
ALL.forEach(function (entry) {
  const fields = entry.answer.readingFields || entry.cp.readingFields || [];
  if (entry.answer.control === "keypad" && !fields.length) {
    lumped.push(entry.ref + " readingLabel=" + JSON.stringify(entry.cp.readingLabel || null));
  }
  fields.forEach(function (f) {
    if (!f.key || !f.label) unlabelled.push(entry.ref + ":" + JSON.stringify(f));
    /* A field label naming two quantities is the same defect one level down. */
    if (/\b(\/|versus|vs\.?)\b/i.test(String(f.label)) || String(f.label).indexOf("/") >= 0) {
      lumped.push(entry.ref + " field " + JSON.stringify(f.label) + " names two quantities");
    }
  });
});
check("no numeric check collects its readings in a single unlabelled box", lumped, []);
check("every reading field has a key and a label", unlabelled, []);

const paired = ALL.filter(function (e) {
  return ((e.answer.readingFields || e.cp.readingFields) || []).length >= 2;
});
note("checks collecting two or more readings", paired.length);

/* ==========================================================================
   3. WORK PERFORMED IS NOT A CHECKPOINT

   The maintenance chips already collect what was done, per protocol. A
   maintenance-kind CHECKPOINT asks the same question a second time, in a
   different control, in the middle of the health protocol -- which is what made
   "Filter & sump condition" offer completed / not completed instead of a
   condition.
   ========================================================================== */
console.log("\n=== work performed lives in the chips, not in the protocol ===");
const maintenanceCheckpoints = ALL.filter(function (e) { return e.answer.kind === "maintenance"; });
check("no protocol carries a maintenance checkpoint",
      maintenanceCheckpoints.map(function (e) { return e.ref; }), []);
/* And the work those checkpoints used to collect must still be collectable. */
const noChips = Object.keys(config.checkpointSets).filter(function (setKey) {
  return !setKey.startsWith("hvac_") && !(ANSWERS.maintenance(setKey) || []).length;
});
check("every appliance protocol has maintenance chips to record work on", noChips, []);

/* ==========================================================================
   4. EVERY SCORE IS PUBLISHED, ANCHORED, AND VISIBLE

   v0.9.19 turned conditions into scoring checks, on Cayden's push from the
   field: "if i note that the ice pattern is cloudy or incomplete, that usually
   means theres an issue. it should probably effect the health score" -- with the
   condition that makes it safe: "predefined scores for observables, where its
   clear to the tech what to click so we get mostly consistent results."

   These invariants keep that promise. They REPLACE an earlier set that asserted
   the opposite -- "no observation stores a rating of any kind" -- which was
   correct for the design it was written against and worth deleting outright
   rather than watering down once the design changed.
   ========================================================================== */
console.log("\n=== every score is published, anchored, and visible ===");
const noScoreKey = [];
const outOfRange = [];
const duplicateCodes = [];
const incomplete = [];
ALL.forEach(function (entry) {
  const a = entry.answer;
  if (a.control !== "passfail" && a.control !== "category") return;
  const options = a.options || [];
  if (!options.length) { incomplete.push(entry.ref + " has no options at all"); return; }
  const seen = {};
  options.forEach(function (o) {
    if (!o.code || !o.label || !o.result) {
      incomplete.push(entry.ref + " option " + JSON.stringify(o) + " is incomplete");
    }
    if (seen[o.code]) duplicateCodes.push(entry.ref + " repeats code " + o.code);
    seen[o.code] = true;
    /*
     * The KEY has to be present, even where the value is null.
     *
     * `score: null` is a deliberate "this answer scores nothing". A MISSING key
     * is an option nobody assigned a value to, and it falls through to the
     * legacy wording regex, where what an answer costs depends on how its label
     * happens to be phrased. Presence is the only thing that tells those apart.
     */
    if (a.scores && !Object.prototype.hasOwnProperty.call(o, "score")) {
      noScoreKey.push(entry.ref + " -> " + o.label);
    }
    if (Object.prototype.hasOwnProperty.call(o, "score") && o.score !== null) {
      const n = Number(o.score);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        outOfRange.push(entry.ref + " -> " + o.label + " = " + JSON.stringify(o.score));
      }
    }
  });
});
check("every option is complete", incomplete, []);
check("no option set repeats a code", duplicateCodes, []);
check("every option on a scoring check publishes its score", noScoreKey, []);
check("every published score is an integer 1-5, or null", outOfRange, []);

/* And what gets STORED is the published number, not a regex over the wording. */
const scoreDrift = [];
ALL.filter(function (e) { return e.answer.scores && (e.answer.options || []).length; })
   .forEach(function (entry) {
  (entry.answer.options || []).forEach(function (o) {
    const c = { id: entry.cp.id, name: entry.cp.name };
    INPUT.applyOption(c, entry.answer, o.code);
    const want = INPUT.scoreForOption(o);
    if (want === null) {
      if (!c.notApplicable) scoreDrift.push(entry.ref + " -> " + o.label + " should be unscored");
    } else if (Number(c.rating) !== want) {
      scoreDrift.push(entry.ref + " -> " + o.label + " stored " + c.rating + ", publishes " + want);
    }
  });
});
check("choosing an option stores exactly the score it publishes", scoreDrift, []);

/*
 * DIRT IS NOT A DEFECT.
 *
 * Cayden's standing rule: nothing lowers the score for cosmetic wear, or for
 * the state an appliance was in before the technician arrived. Now that
 * conditions score, that rule is one careless option away from being broken --
 * so it is asserted rather than trusted. Any answer describing dirt, build-up
 * or cosmetic marks scores full marks, the same as pristine.
 */
const DIRT = /(cleaned at this visit|cosmetic|residue only|debris only|build-up only|grease-laden|accumulation removed)/i;
const dirtPenalised = [];
ALL.forEach(function (entry) {
  if (!entry.answer.scores) return;
  (entry.answer.options || []).forEach(function (o) {
    if (!DIRT.test(o.label)) return;
    const score = INPUT.scoreForOption(o);
    if (score !== 5) dirtPenalised.push(entry.ref + " -> " + o.label + " = " + score);
  });
});
check("no answer about dirt or cosmetic wear costs the customer anything", dirtPenalised, []);

/*
 * A SCALE NEEDS A TOP, A DEDUCTION, AND A WAY OUT.
 *
 * A scoring set where nothing reaches full marks punishes a healthy appliance
 * for existing; one where nothing deducts is not a check at all; one with no
 * "could not get to it" forces a guess.
 */
const noFullMarks = [];
const noDeduction = [];
const noEscape = [];
ALL.forEach(function (entry) {
  const a = entry.answer;
  if (a.control !== "passfail" && a.control !== "category") return;
  const scores = (a.options || []).map(function (o) { return INPUT.scoreForOption(o); });
  if (a.scores) {
    if (!scores.some(function (n) { return n === 5; })) noFullMarks.push(entry.ref);
    if (!scores.some(function (n) { return n !== null && n <= 3; })) noDeduction.push(entry.ref);
  }
  if (!scores.some(function (n) { return n === null; })) noEscape.push(entry.ref);
});
check("every scoring set has a full-marks answer", noFullMarks, []);
check("every scoring set has an answer that deducts", noDeduction, []);
check("every option list has an answer that scores nothing", noEscape, []);

/*
 * THE SCORE IS ON THE BUTTON.
 *
 * The whole reason scoring a condition is defensible is that the technician can
 * see what an answer is worth before tapping it. Asserted against the rendered
 * markup, because a promise in a config comment is not a promise to the person
 * holding the phone in front of the appliance.
 */
const hiddenScores = [];
ALL.forEach(function (entry) {
  const a = entry.answer;
  if (!a.scores || !(a.options || []).length) return;
  const html = INPUT.optionButtons({ id: entry.cp.id, name: entry.cp.name }, 0, a);
  a.options.forEach(function (o) {
    const score = INPUT.scoreForOption(o);
    const want = score === null ? "no score" : score + " of 5";
    if (html.indexOf(want) < 0) hiddenScores.push(entry.ref + " -> " + o.label + " (" + want + ")");
  });
});
check("every scoring option shows what it is worth", hiddenScores, []);

/*
 * NO UNANCHORED CONDITION SET SURVIVES.
 *
 * The old generic three-way -- Good / Wear noted / Needs attention -- was on
 * eight checks. It is the same unanchored judgement the 1-5 scale was, in fewer
 * taps: two technicians looking at the same door boot could reasonably differ,
 * because nothing in the wording says what "wear noted" IS. Every option now
 * names observable evidence instead, which is what makes the score repeatable.
 */
const vague = [];
const VAGUE_LABELS = /^(good|fair|poor|ok|okay|wear noted|wear noted, working|needs attention|acceptable|normal)$/i;
ALL.forEach(function (entry) {
  (entry.answer.options || []).forEach(function (o) {
    if (VAGUE_LABELS.test(String(o.label).trim())) vague.push(entry.ref + " -> " + o.label);
  });
});
check("no option is a bare quality word with nothing observable in it", vague, []);

/* ==========================================================================
   6. A FAULT CODE IS RECORDED, NOT JUST ANNOUNCED

   "Codes present" with nowhere to put the code tells a customer a fault exists
   and throws away the only part of it anybody can act on.
   ========================================================================== */
console.log("\n=== a stored fault code gets recorded ===");
const codeOptions = [];
ALL.forEach(function (entry) {
  (entry.answer.options || []).forEach(function (o) {
    if (/code/i.test(o.result) && !/^no /i.test(o.label)) {
      codeOptions.push({ ref: entry.ref, label: o.label, needs: o.requiresDetail || null });
    }
  });
});
note("options that announce a stored code", codeOptions.length);
check("every 'codes present' option demands the code itself",
      codeOptions.filter(function (o) { return o.needs !== "code"; }).map(function (o) { return o.ref; }), []);
/* And the demand has to be enforced, not merely declared. */
const codeEnforcement = [];
ALL.forEach(function (entry) {
  (entry.answer.options || []).forEach(function (o) {
    if (o.requiresDetail !== "code") return;
    const c = { id: entry.cp.id, name: entry.cp.name };
    INPUT.applyOption(c, entry.answer, o.code);
    if (!c.detailRequired) codeEnforcement.push(entry.ref + " -> " + o.label + " does not ask for it");
  });
});
check("choosing it marks the check as still needing that detail", codeEnforcement, []);

/* ==========================================================================
   7. THE KIND STILL DECIDES WHAT SCORES
   ========================================================================== */
console.log("\n=== the kinds still line up ===");
const kindTally = {};
ALL.forEach(function (e) { kindTally[e.answer.kind] = (kindTally[e.answer.kind] || 0) + 1; });
note("kinds", kindTally);
/*
 * Which KINDS may score, as of v0.9.19: a measurement, and a condition chosen
 * from an anchored list. Not a trend -- a reading with no agreed band has
 * nothing to be scored against, which is the whole reason the kind exists.
 */
check("a measurement scores",
      ALL.filter(function (e) { return e.answer.kind === "scored" && !e.answer.scores; })
         .map(function (e) { return e.ref; }), []);
check("a condition scores",
      ALL.filter(function (e) { return e.answer.kind === "observed" && !e.answer.scores; })
         .map(function (e) { return e.ref; }), []);
check("a trend reading never scores",
      ALL.filter(function (e) { return e.answer.kind === "trend" && e.answer.scores; })
         .map(function (e) { return e.ref; }), []);
/* A condition may only score through an option list. A condition on a free
   1-5 rating would be the unanchored judgement all of this replaced. */
check("no condition is scored on a bare 1-5 rating",
      ALL.filter(function (e) { return e.answer.kind === "observed" && e.answer.control === "rating"; })
         .map(function (e) { return e.ref; }), []);
/* A count is a measurement of how many things work; it must never be an
   observation, and an observation must never be a count. */
check("no observation is collected as a count",
      ALL.filter(function (e) { return e.answer.kind === "observed" && e.answer.control === "count"; })
         .map(function (e) { return e.ref; }), []);
check("every count check says what it is counting",
      ALL.filter(function (e) { return e.answer.control === "count" && !e.answer.countLabel; })
         .map(function (e) { return e.ref; }), []);
/* A rating is a judgement, so it belongs only where the judgement IS the
   answer -- never on a trend, whose number is the answer. */
check("no trend check also asks for a rating",
      ALL.filter(function (e) { return e.answer.kind === "trend" && e.answer.control === "rating"; })
         .map(function (e) { return e.ref; }), []);

console.log("");
if (failures.length) {
  console.log(failures.length + " FAILURE(S) of " + checks + " checks:");
  failures.forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
}
console.log("ALL " + checks + " CHECK-CONTROL AUDITS PASSED");

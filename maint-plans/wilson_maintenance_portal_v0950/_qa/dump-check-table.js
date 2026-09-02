/*
 * The whole protocol as one table: every check, what kind of answer it takes,
 * how it is answered, and whether it can move the customer's score.
 *
 * This is the pass Cayden asked for -- "all of the health checks need a pass to
 * verify that the options make sense for the type of check / measurement being
 * documented" -- in reviewable form. Generated from plan-config.js, so it cannot
 * describe a version of the protocol that is not the one shipping.
 *
 * Usage: node dump-check-table.js > check-table.json
 */
const fs = require("fs");
const path = require("path");
const ROOT = "/home/claude/work/extracted/wilson_maintenance_portal_v0916";
global.window = {};
global.document = { getElementById: () => null, createElement: () => ({}),
                    body: { classList: { add() {}, remove() {} }, appendChild() {} },
                    querySelectorAll: () => [], querySelector: () => null };
eval(fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8"));
eval(fs.readFileSync(path.join(ROOT, "assets", "tech-answers.js"), "utf8"));
const C = window.WILSON_CONFIG, A = window.WILSON_ANSWERS;

const CONTROL_WORDS = {
  rating: "1-5 condition rating",
  passfail: "pick one result",
  category: "pick one condition",
  count: "how many of how many",
  keypad: "numbers on the pad",
};

const out = { protocols: [], totals: {} };
Object.keys(C.checkpointSets).forEach(function (setKey) {
  const checks = (C.checkpointSets[setKey] || []).map(function (cp) {
    const a = A.for(setKey, cp.id);
    const fields = a.readingFields || [];
    return {
      id: cp.id,
      name: cp.name,
      kind: a.kind,
      scores: a.scores,
      control: a.control,
      controlWords: CONTROL_WORDS[a.control] || a.control,
      optionSet: a.optionSet || null,
      options: (a.options || []).map(function (o) {
        /* The PUBLISHED score, not the legacy wording match -- see
           scoreForOption. This dump is what the review page prints, and it has
           to print the number the field tool actually stores. */
        return { label: o.label, result: o.result,
                 rating: a.scores ? window.WILSON_INPUT.scoreForOption(o) : null,
                 anchored: Object.prototype.hasOwnProperty.call(o, "score"),
                 attention: Boolean(o.attention),
                 needs: o.requiresDetail || null };
      }),
      countLabel: a.countLabel || null,
      readings: fields.map(function (f) {
        return { label: f.label, unit: f.unit || "", required: Boolean(f.required) };
      }),
      derived: a.derived ? { label: a.derived.label, unit: a.derived.unit } : null,
      photo: Boolean(a.photo),
      optionSetKey: a.optionSet || null,
      why: a.why || "",
      prompt: cp.prompt || "",
    };
  });
  out.protocols.push({
    key: setKey,
    isHvac: setKey.indexOf("hvac_") === 0,
    checks: checks,
    chips: (A.maintenance(setKey) || []).map(function (m) { return m.label; }),
    scoring: checks.filter(function (c) { return c.scores; }).length,
  });
});
const all = out.protocols.reduce(function (acc, p) { return acc.concat(p.checks); }, []);
out.totals = {
  protocols: out.protocols.length,
  checks: all.length,
  scored: all.filter(function (c) { return c.kind === "scored"; }).length,
  observed: all.filter(function (c) { return c.kind === "observed"; }).length,
  trend: all.filter(function (c) { return c.kind === "trend"; }).length,
  withReadings: all.filter(function (c) { return c.readings.length > 0; }).length,
  withPhoto: all.filter(function (c) { return c.photo; }).length,
  chips: out.protocols.reduce(function (n, p) { return n + p.chips.length; }, 0),
};
process.stdout.write(JSON.stringify(out, null, 1));

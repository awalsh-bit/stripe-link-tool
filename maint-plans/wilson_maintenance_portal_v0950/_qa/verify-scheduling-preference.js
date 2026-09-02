/*
 * WHEN A VISIT CAN HAPPEN, AND WHAT IT TAKES TO GET IN
 *
 * Cayden, on why the tool should not own the schedule:
 *
 *   "ePass is [not an] open API, so I don't see a way for this to communicate
 *    back to ePass if we do the scheduling inside the tool... As it is now they
 *    can leave a note for preferred maintenance timelines and I feel like
 *    that's functional enough."
 *
 * He is right that a calendar would be wrong, and for a sharper reason than
 * friction: a date chosen here is a date Wilson cannot honour without
 * re-entering it by hand, while the customer believes it is booked. A promise
 * the software cannot keep is worse than no promise.
 *
 * So this captures PREFERENCES AND CONSTRAINTS, structured, and nothing that
 * reserves a slot. The fences:
 *
 *   1. NOTHING BOOKS A DATE. No slot, no confirmation, no reservation.
 *   2. NO ENTRY CODES. A gate or alarm code typed into a web form is a code
 *      sitting in a database. The customer records that one EXISTS; Wilson
 *      collects it by phone.
 *   3. IDS, NOT PROSE. The old free-text box meant the office read and
 *      interpreted a sentence. A preference is stored as ids so every screen
 *      renders the same constraint the same way.
 *   4. ABSENCE IS ABSENCE. An empty preference says "no timing preference",
 *      never an invented default like "weekdays".
 *
 * Run: node _qa/verify-scheduling-preference.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
global.window = {};
eval(fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8"));

const config = window.WILSON_CONFIG;
const S = window.WILSON_SCHEDULING;

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
console.log("=== it is not a calendar, and it must not become one ===");
const vocab = S.options();
check("there is no date-slot vocabulary to book against",
      ["slots", "appointments", "availability", "bookings"]
        .filter(function (k) { return Object.prototype.hasOwnProperty.call(vocab, k); }), []);
/* The customer-facing form and the copy around it must not imply a reservation.
   Checked against the shipped markup, because this is a promise, not a detail. */
const signup = fs.readFileSync(path.join(ROOT, "appliance-signup.html"), "utf8");
const schedSection = (signup.match(/<section class="form-section" id="scheduling-section">[\s\S]*?<\/section>/) || [""])[0];
check("the scheduling section exists on the signup form", schedSection.length > 0, true);
check("and it says outright that nothing is booked",
      /none of it books a date|Nothing here books a date/i.test(schedSection), true);
check("it does not promise a slot, appointment time, or confirmation",
      /\b(book your|reserve|reserved|your appointment is|confirmed for)\b/i.test(schedSection), false);
/* THE ONE THAT MATTERS MOST for a customer-facing form. */
check("no field on the whole signup form asks for a gate, alarm or entry code",
      (signup.match(/<(?:input|textarea)[^>]*(?:name|id|placeholder)="[^"]*(?:gate ?code|alarm|entry ?code|pin)[^"]*"[^>]*>/gi) || []), []);
check("and the form says so in as many words",
      /never asks for gate or alarm codes/i.test(schedSection), true);

/* ========================================================================== */
console.log("\n=== the access vocabulary records facts, never secrets ===");
const access = vocab.accessConstraints;
check("every access constraint carries office wording as well as a label",
      access.filter(function (a) { return !a.office || !a.label; }), []);
/*
 * A constraint whose LABEL asks for a code would put the field back on the form
 * by the back door.
 *
 * Matched on REQUEST phrasing, not on the word "code". The first version of this
 * check just looked for /code/ and flagged "Wilson holds a key or code
 * already" -- which is the opposite of a request: it tells Wilson it already
 * has entry. Rewording a correct label to satisfy a blunt regex would be the
 * test dictating the product, so the regex got sharper instead.
 *
 * The real guard is the input-field check above; this one stops a label from
 * becoming a prompt.
 */
check("no constraint is phrased as a request for a code",
      access.filter(function (a) {
        return /\b(enter|provide|supply|give us|what is)\b/i.test(a.label)
            || /\byour (code|pin|password)\b/i.test(a.label);
      }).map(function (a) { return a.label; }), []);
/* But the office wording is allowed to SAY a code is needed -- that is an
   instruction to Wilson, which is the whole point. */
check("the office wording does tell Wilson to go and get the gate code",
      access.some(function (a) { return /collect the code by phone/i.test(a.office); }), true);
note("access constraints", access.map(function (a) { return a.id; }).join(" "));

/* ========================================================================== */
console.log("\n=== absence is absence ===");
check("nothing recorded reads as no preference", S.summary(null), "No timing preference");
check("an empty object is the same", S.summary({}), "No timing preference");
check("and produces no lines for the office to act on", S.lines(null), []);
check("isEmpty agrees", [S.isEmpty(null), S.isEmpty({}), S.isEmpty({ months: [] })],
      [true, true, true]);
/* "Any time" is the absence of a time preference, not a preference for any
   time -- a house whose only answer is "any time" has told Wilson nothing. */
check("'any time' alone is still no preference",
      S.isEmpty({ timeOfDay: "any" }), true);
check("but one real answer is not empty",
      S.isEmpty({ months: ["mar"] }), false);
/* Every weekday selected is the same as no day constraint, and printing
   "Mon, Tue, Wed, Thu, Fri" where "Weekdays" will do wastes the row. */
check("all weekdays collapses to one word",
      S.dayPhrase(["mon", "tue", "wed", "thu", "fri"]), "Weekdays");
check("every day selected is no constraint at all",
      S.dayPhrase(["mon", "tue", "wed", "thu", "fri", "sat"]), "");

/* ========================================================================== */
console.log("\n=== months read the way a person would say them ===");
check("a run collapses into a range", S.monthPhrase(["mar", "apr", "may"]), "Mar–May");
check("separate months stay separate", S.monthPhrase(["mar", "sep"]), "Mar, Sep");
check("two runs both collapse", S.monthPhrase(["mar", "apr", "sep", "oct"]), "Mar–Apr, Sep–Oct");
check("order is calendar order, not tap order",
      S.monthPhrase(["oct", "mar", "sep", "apr"]), "Mar–Apr, Sep–Oct");
check("a single month is not rendered as a range", S.monthPhrase(["jul"]), "Jul");
check("nothing selected is an empty phrase, not 'Jan–Dec'", S.monthPhrase([]), "");
/* An unknown id must not appear as a blank or an "undefined" in a range. */
check("an unrecognised month id is dropped rather than printed",
      S.monthPhrase(["mar", "smarch"]), "Mar");

/* ========================================================================== */
console.log("\n=== what the office is handed ===");
const full = {
  months: ["mar", "apr", "sep", "oct"],
  days: ["mon", "tue", "wed", "thu", "fri"],
  timeOfDay: "morning",
  access: ["gate", "dog"],
  blackouts: [{ from: "2027-01-24", to: "2027-02-14", note: "Family away" }],
  note: "Reach the house manager first."
};
const lines = S.lines(full);
note("summary", S.summary(full));
check("access lines are flagged for attention -- these turn a tech away",
      lines.filter(function (l) { return l.kind === "access"; }).every(function (l) { return l.attention; }), true);
check("and they carry the office instruction, not the customer's label",
      lines.filter(function (l) { return l.kind === "access"; })
           .some(function (l) { return /by phone/i.test(l.value); }), true);
/* Dates are handed over RAW. The resolver has no business deciding how Wilson
   writes a date, and the office panel was rendering "2027-01-24 to 2027-02-14"
   when this returned a pre-joined ISO string as its display value. */
const blackout = lines.find(function (l) { return l.kind === "blackout"; });
check("a blackout hands the view raw dates to format",
      [blackout.from, blackout.to], ["2027-01-24", "2027-02-14"]);
check("and keeps the customer's reason with it", blackout.detail, "Family away");
check("a single-day blackout has no end date to render",
      S.lines({ blackouts: [{ from: "2027-03-01" }] })[0].to, "");
check("the customer's own note survives to the office",
      lines.some(function (l) { return l.kind === "note" && /house manager/i.test(l.value); }), true);

/* ========================================================================== */
console.log("\n=== the free-text field it replaced is gone ===");
/*
 * The old box was `name="preferredMonths"`. Leaving it on the form alongside the
 * structured control would give a household two places to say the same thing,
 * and they would disagree -- the failure this codebase keeps paying for.
 */
check("the appliance signup no longer carries a free-text timing input",
      /name="preferredMonths"/.test(signup), false);
/* HVAC too. It had the same box, pre-filled with "Spring / Fall" -- and HVAC is
   the flow where seasonal months matter most, so leaving it behind would have
   left the better control on the form that needed it least. */
const hvac = fs.readFileSync(path.join(ROOT, "hvac-signup.html"), "utf8");
check("nor does the HVAC signup", /name="preferredMonths"/.test(hvac), false);
check("and the HVAC form mounts the same control, not a copy of it",
      /id="sched-months"/.test(hvac) && /assets\/scheduling-preference\.js/.test(hvac), true);
check("both forms carry the no-codes promise",
      [/never asks for gate or alarm codes/i.test(signup),
       /never asks for gate or alarm codes/i.test(hvac)], [true, true]);
check("and the structured control is mounted from its own module",
      fs.existsSync(path.join(ROOT, "assets", "scheduling-preference.js")), true);
check("which the service worker caches, or the form breaks offline",
      /assets\/scheduling-preference\.js/.test(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8")), true);

console.log("");
if (failures.length) {
  console.log(failures.length + " FAILURE(S) of " + checks + " checks:");
  failures.forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
}
console.log("ALL " + checks + " SCHEDULING-PREFERENCE CHECKS PASSED");

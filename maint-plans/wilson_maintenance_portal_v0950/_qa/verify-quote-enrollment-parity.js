/*
 * A QUOTE AND THE ENROLLMENT IT BECOMES ARE ONE PRICE
 *
 * Cayden asked for the quote flow to be consolidated into registration. The
 * reason it needed consolidating is worth keeping in front of whoever reads
 * this next:
 *
 *   quote-builder.js had its own appliance picker and its own pricing, and its
 *   pricing had no concept of filter service. An 18-appliance house with three
 *   filtered refrigerators and two filtered icemakers was QUOTED $1,874.90 on
 *   Estate Annual and would have ENROLLED at $2,224.90. Wilson could send a
 *   customer one number and bill them another, with nothing in the system able
 *   to say which was right.
 *
 * That is now structurally impossible rather than merely fixed: there is one
 * pricing engine (WILSON_PRICING), one payload builder, and a quote STORES the
 * enrollment payload rather than describing it. These checks defend that.
 *
 * Run: node _qa/verify-quote-enrollment-parity.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
let backing = {};
global.window = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null; },
  setItem: function (k, v) { backing[k] = String(v); },
  removeItem: function (k) { delete backing[k]; }
};
eval(fs.readFileSync(path.join(ROOT, "assets", "plan-config.js"), "utf8"));
eval(fs.readFileSync(path.join(ROOT, "assets", "store.js"), "utf8"));

const config = window.WILSON_CONFIG;
const P = window.WILSON_PRICING;
const S = window.WilsonStore;

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
function reset() { backing = {}; }

const PLANS = ["per_appliance", "estate_annual", "estate_preferred", "estate_concierge"];

function house(spec) {
  const out = [];
  spec.forEach(function (row) {
    for (let i = 0; i < row[2]; i += 1) {
      out.push(Object.assign({
        id: "a" + out.length,
        customerCategory: row[0], type: row[1], typeLabel: row[1],
        areaId: "area_main", location: "Main House",
        group: row[1] === "ice_maker" ? "imuc" : "standard",
        imucVisitsPerYear: row[1] === "ice_maker" ? 2 : 1
      }, row[3] || {}));
    }
  });
  return out;
}

const HOUSES = {
  "empty": [],
  "one appliance": house([["refrigeration", "refrigerator", 1]]),
  "one icemaker": house([["ice_maker", "ice_maker", 1]]),
  "small, no filters": house([["refrigeration", "refrigerator", 1], ["dishwasher", "dishwasher", 1],
                              ["range", "range", 1], ["washer", "washer", 1]]),
  "at the included boundary": house([["refrigeration", "refrigerator", 15]]),
  "one over the boundary": house([["refrigeration", "refrigerator", 16]]),
  "18 with filter service": house([
    ["refrigeration", "refrigerator", 3, { filterServiceOptIn: true, waterFilterQuantity: 1 }],
    ["ice_maker", "ice_maker", 2, { filterServiceOptIn: true, waterFilterQuantity: 1 }],
    ["dishwasher", "dishwasher", 3], ["range", "range", 2], ["ovens", "wall_oven", 3],
    ["washer", "washer", 2], ["dryer", "dryer", 2], ["microwave", "microwave", 1]]),
  "large enough for review": house([["refrigeration", "refrigerator", 40]]),
  /* THREE icemakers specifically. 3 x $249.95 evaluates to 749.8499999999999 in
     floating point; two of them do not misbehave, so a fixture with two
     icemakers let the stray-cents bug through a passing suite. Kept for that
     reason rather than for the portfolio size. */
  "three icemakers, the float case": house([
    ["refrigeration", "refrigerator", 5], ["ice_maker", "ice_maker", 3],
    ["dishwasher", "dishwasher", 3], ["range", "range", 2],
    ["washer", "washer", 2], ["dryer", "dryer", 2]])
};

/* ========================================================================== */
console.log("=== there is one pricing engine, and screens do not own it ===");
check("WILSON_PRICING exists", typeof P.annual, "function");
/* The expectation rounds because the ENGINE now rounds to cents (v0.9.48) --
   3 × 149.95 is 449.85000000000002 in floating point, and the stored record
   carrying 449.85 instead is the audit fix, not a drift. */
check("and it prices from a per-unit asset list, not types-with-quantities",
      P.annual(house([["refrigeration", "refrigerator", 3]]), "per_appliance"),
      Math.round(3 * config.pricing.standardApplianceAnnual * 100) / 100);
/* The retired screen is gone from disk. A dormant second picker is a second
   picker somebody will wire back up. */
check("the old quote builder is deleted",
      fs.existsSync(path.join(ROOT, "assets", "quote-builder.js"))
      || fs.existsSync(path.join(ROOT, "quote-builder.html")), false);
/* And nothing still links to it. */
const linkers = ["admin.html", "quote-view.html", "index.html", "assets/ui.js", "sw.js"]
  .filter(function (f) {
    const p = path.join(ROOT, f);
    return fs.existsSync(p) && /quote-builder\.html|assets\/quote-builder\.js/.test(fs.readFileSync(p, "utf8"));
  });
check("and nothing links to it any more", linkers, []);

/* ========================================================================== */
console.log("\n=== the line items add up to the price ===");
/*
 * This is the check that caught a REAL, PRE-EXISTING defect: on the
 * per-appliance plan, basePlanAmount already included the recommended second
 * icemaker visits AND imucSecondVisitAmount listed them again. The total was
 * computed separately and was right, so nothing surfaced it -- until the quote
 * document started printing the line items to a customer, where the lines
 * would have summed to more than the total they sat above.
 */
let summed = 0;
Object.keys(HOUSES).forEach(function (name) {
  PLANS.forEach(function (plan) {
    const assets = HOUSES[name];
    const b = P.breakdown(assets, plan);
    const lines = Math.round((b.basePlanAmount + b.largeEstateAdjustment
                            + b.imucSecondVisitAmount + b.filterServiceAmount) * 100) / 100;
    const total = Math.round(P.annual(assets, plan) * 100) / 100;
    summed += 1;
    if (lines !== total) {
      failures.push("lines do not sum to the total for " + name + " on " + plan +
                    ": lines " + lines + ", total " + total);
    }
  });
});
checks += 1;
console.log((failures.length ? "FAIL " : "ok   ") +
            ("every line item set sums to its own total (" + summed + " combinations)").padEnd(70));

/* ========================================================================== */
console.log("\n=== what the card sees, and when ===");
/*
 * Cayden: "should we have the total pricing that is adding up as they choose
 * appliances break things down into an amount due today / amount charged at
 * second visit in the year?"
 *
 * The numbers said yes, and more urgently than it looks. A 12-appliance house
 * with two icemakers on Estate Annual is shown "$1,694.90 / year" and is
 * actually charged $1,195.00 at the first visit and $499.90 five months later.
 * On Preferred and Concierge the ENTIRE annual amount lands on the first visit
 * and the second is $0. "Per year" reads as spread out; it is not.
 *
 * The split used to be worked out inside createEnrollment, where no screen
 * could reach it -- so previewing it meant writing the rule twice, which is
 * exactly how the retired quote screen came to under-quote by $350. It is now
 * WILSON_PRICING.chargeSchedule, and store.js builds its visits FROM it.
 *
 * These checks defend the two things that make the preview trustworthy: it sums
 * to the annual figure, and it equals what actually gets charged.
 */
let scheduleChecks = 0;
const scheduleFailures = [];
Object.keys(HOUSES).forEach(function (name) {
  if (!HOUSES[name].length) return;      /* an empty house has no plan to bill */
  PLANS.forEach(function (plan) {
    const assets = HOUSES[name];
    const annual = Math.round(P.annual(assets, plan) * 100) / 100;
    const schedule = P.chargeSchedule(assets, plan);
    scheduleChecks += 1;

    const summed = Math.round(schedule.reduce(function (t, l) { return t + l.amount; }, 0) * 100) / 100;
    if (summed !== annual) {
      scheduleFailures.push(name + " / " + plan + ": schedule sums to " + summed + ", annual is " + annual);
    }
    /* No leg may be negative. The one-visit branch subtracts the icemaker legs
       from the annual, and a plan cheaper than its own icemaker add-on would
       otherwise hand a customer a credit nobody intended. */
    if (schedule.some(function (l) { return l.amount < 0; })) {
      scheduleFailures.push(name + " / " + plan + ": a charge leg is negative");
    }
    /* The first leg is always the one that carries the plan. */
    if (schedule[0].key !== "initial") {
      scheduleFailures.push(name + " / " + plan + ": the first leg is not the initial visit");
    }

    /* AND IT MATCHES REALITY. Build the enrollment and compare against the
       visits that actually get created. */
    reset();
    const bundle = window.WilsonStore.createEnrollment({
      category: "appliance", planId: plan, planName: P.plan(plan).name,
      annualAmount: P.annual(assets, plan), assets: assets,
      areas: [{ id: "area_main", name: "Main House" }],
      paymentReady: true, autoRenew: true, acceptedTermsAt: new Date().toISOString(),
      pricingBreakdown: P.breakdown(assets, plan),
      firstName: "T", lastName: "H", phone: "1", email: "a@b.c",
      address1: "1 St", city: "Austin", state: "TX", zip: "78738"
    });
    const actual = window.WilsonStore.load().visits
      .filter(function (v) { return v.householdId === bundle.household.id; })
      .sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); })
      .map(function (v) { return Number(v.amountToCharge || 0); });
    const predicted = schedule.map(function (l) { return l.amount; });
    if (JSON.stringify(actual) !== JSON.stringify(predicted)) {
      scheduleFailures.push(name + " / " + plan + ": preview " + JSON.stringify(predicted) +
                            " but the visits charge " + JSON.stringify(actual));
    }
  });
});
checks += 1;
if (scheduleFailures.length) {
  scheduleFailures.forEach(function (f) { failures.push(f); });
  console.log("FAIL " + ("the preview equals what gets charged (" + scheduleChecks + " combinations)").padEnd(70));
} else {
  console.log("ok   " + ("the preview equals what gets charged (" + scheduleChecks + " combinations)").padEnd(70));
}
note("12 appliances / 2 icemakers on Estate Annual",
     P.chargeSchedule(HOUSES["18 with filter service"], "estate_annual")
      .map(function (l) { return l.label + " $" + l.amount; }).join(" · "));
note("the same house on Estate Concierge",
     P.chargeSchedule(HOUSES["18 with filter service"], "estate_concierge")
      .map(function (l) { return l.label + " $" + l.amount; }).join(" · "));
/* A single-charge plan must not invent a second leg, or the signup panel would
   promise a customer a bill that never arrives. */
check("a plan with one charge has one leg",
      P.chargeSchedule(HOUSES["small, no filters"], "estate_annual").length, 1);
check("and a two-visit plan bills at both",
      P.chargeSchedule(HOUSES["small, no filters"], "estate_concierge").length, 2);

/*
 * THE YEAR IS DIVIDED, NOT DISCOUNTED.  (v0.9.26)
 *
 * Two-visit plans used to bill the whole year at the first visit and $0 at the
 * second, so "per year" described something taken in one go. Cayden's call was
 * to split it. The weights are config, so the risk is a future edit that makes
 * them sum to something other than 1 -- which would quietly change what a plan
 * costs rather than when it is paid.
 */
const weights = config.visitChargeSplit.twoVisit;
check("the split weights sum to exactly one",
      Math.round(weights.reduce(function (t, w) { return t + w; }, 0) * 1e6) / 1e6, 1);
check("and there is one weight per visit on a two-visit plan", weights.length, 2);
const conciergeSplit = P.chargeSchedule(HOUSES["small, no filters"], "estate_concierge");
check("no visit is billed nothing on a plan that visits twice",
      conciergeSplit.every(function (l) { return l.amount > 0; }), true);
check("neither leg carries the whole year on its own",
      conciergeSplit.every(function (l) {
        return l.amount < P.annual(HOUSES["small, no filters"], "estate_concierge");
      }), true);

/*
 * CENTS. These amounts are charged, not just printed. 3 x $249.95 evaluates to
 * 749.8499999999999 in floating point, and that was reaching a customer's
 * charge schedule as a stored amount.
 */
/*
 * Checked on the STRING, not on numeric distance, and that distinction is the
 * whole test. 749.8499999999999 sits 1.4e-11 away from a whole cent -- inside
 * any sane epsilon -- so a tolerance-based check passed it happily. What
 * actually leaks is the representation: anything that stringifies the amount
 * without going through ui.money prints "$749.8499999999999" at a customer.
 */
let strayDecimals = [];
Object.keys(HOUSES).forEach(function (name) {
  if (!HOUSES[name].length) return;
  PLANS.forEach(function (plan) {
    P.chargeSchedule(HOUSES[name], plan).forEach(function (leg) {
      const decimals = (String(leg.amount).split(".")[1] || "").length;
      if (decimals > 2) {
        strayDecimals.push(name + " / " + plan + " / " + leg.key + " = " + leg.amount);
      }
    });
  });
});
check("no charge leg carries more decimal places than money has", strayDecimals, []);
/* The customer's own receipt should not carry Wilson's internal abbreviation. */
reset();
const jargonBundle = window.WilsonStore.createEnrollment({
  category: "appliance", planId: "estate_annual", planName: "Estate Annual",
  annualAmount: P.annual(HOUSES["18 with filter service"], "estate_annual"),
  assets: HOUSES["18 with filter service"],
  areas: [{ id: "area_main", name: "Main House" }],
  paymentReady: true, autoRenew: true, acceptedTermsAt: new Date().toISOString(),
  pricingBreakdown: P.breakdown(HOUSES["18 with filter service"], "estate_annual"),
  firstName: "T", lastName: "H", phone: "1", email: "a@b.c",
  address1: "1 St", city: "Austin", state: "TX", zip: "78738"
});
const customerText = window.WilsonStore.load().visits
  .filter(function (v) { return v.householdId === jargonBundle.household.id; })
  .map(function (v) { return v.season + " " + (v.assetScope || ""); }).join(" | ");
check("no internal abbreviation reaches the customer's charge schedule",
      /\bIMUC\b/.test(customerText), false);

/* ========================================================================== */
console.log("\n=== a quote is the enrollment, not a description of one ===");
reset();
const assets18 = HOUSES["18 with filter service"];
const plan = "estate_annual";
const enrollmentPayload = {
  category: "appliance",
  planId: plan,
  planName: P.plan(plan).name,
  annualAmount: P.annual(assets18, plan),
  assets: assets18,
  areas: [{ id: "area_main", name: "Main House", locked: true }],
  paymentReady: false,
  autoRenew: true,
  filterManagement: true,
  standardFiltersIncluded: plan === "estate_concierge",
  acceptedTermsAt: null,
  pricingBreakdown: P.breakdown(assets18, plan),
  firstName: "Test", lastName: "Household",
  phone: "512-555-0000", email: "t@example.com",
  address1: "1 Test Way", city: "Austin", state: "TX", zip: "78738"
};
const quoted = S.saveQuote({
  status: "Draft", propertyName: "Test Estate", contactName: "Test Household",
  contactEmail: "t@example.com", address: "1 Test Way, Austin, TX 78738",
  enrollment: enrollmentPayload
});
note("quoted annual", "$" + quoted.annualAmount);
check("the quote carries the enrollment payload", Boolean(quoted.enrollment), true);
check("its headline price is the payload's price, not a second copy",
      quoted.annualAmount, enrollmentPayload.annualAmount);
check("its appliance count is the payload's list length",
      quoted.applianceCount, assets18.length);
check("a fresh quote is not attached to a household", quoted.householdId, null);
/* THE ONE THAT MATTERS. A quote that has not been accepted must not look like
   a customer who agreed to anything. */
check("and nothing has been accepted on its behalf", quoted.enrollment.acceptedTermsAt, null);

/* ========================================================================== */
console.log("\n=== accepting it charges what it quoted ===");
const accepted = S.acceptQuote(quoted.id);
check("acceptance succeeds", accepted.ok, true);
const state = window.WilsonStore.load();
const sub = state.subscriptions.find(function (s) { return s.householdId === accepted.householdId; });
const enrolledAssets = state.assets.filter(function (a) { return a.householdId === accepted.householdId; });
note("enrolled annual", "$" + sub.annualAmount);
check("THE QUOTED PRICE IS THE ENROLLED PRICE", sub.annualAmount, quoted.annualAmount);
check("and every appliance on the quote is on the household",
      enrolledAssets.length, assets18.length);
check("filter service is part of that price, which is what the old builder missed",
      sub.pricingBreakdown.filterServiceAmount > 0, true);
/* The customer has been shown a price. They have not paid or signed. */
check("payment is outstanding, and the result says so", accepted.needsPayment, true);
check("so is the renewal authorization", accepted.needsTerms, true);
const pay = state.paymentProfiles.find(function (p) { return p.householdId === accepted.householdId; });
check("the payment profile says pending setup rather than ready", pay.status, "Pending setup");
check("and the subscription carries no acceptance timestamp", sub.acceptedTermsAt, null);
check("the quote is now marked accepted", S.getQuote(quoted.id).status, "Accepted");
check("and points at the household it created", S.getQuote(quoted.id).householdId, accepted.householdId);

/* ========================================================================== */
console.log("\n=== no money moves before the customer's card does ===");
/*
 * Cayden, on why an accepted quote should become an enrollment straight away:
 *
 *   "the stripe workflow we use for payments is we'd send a customer a link and
 *    they'd add a payment intent. Once we had that we can charge card"
 *
 * So the household has to exist BEFORE the card does -- there has to be
 * something for the SetupIntent to attach to. That is the right shape, and it
 * puts weight on a guarantee that used to carry none: for the whole window
 * between accepting a quote and the customer completing that link, there is a
 * real household with a real balance owing and no way to take payment.
 *
 * These assert that window is safe, and that the screen tells the truth during
 * it. The label is asserted alongside the refusal because they were out of step:
 * every chargeable visit was created saying "Ready to charge" whether or not a
 * card existed, so the office would have read that against $3,745 on a
 * just-converted quote, pressed charge, and been refused.
 */
const chargeable = window.WilsonStore.load().visits.filter(function (v) {
  return v.householdId === accepted.householdId && Number(v.amountToCharge || 0) > 0;
});
check("the converted household has an initial charge waiting", chargeable.length > 0, true);
const firstVisit = chargeable[0];
check("it does NOT claim to be ready to charge", firstVisit.paymentStatus, "Awaiting payment method");
check("and attempting the charge is refused",
      window.WilsonStore.mockCharge(firstVisit.id).ok, false);
check("with a reason that names the missing card",
      /no ready payment method/i.test(window.WilsonStore.mockCharge(firstVisit.id).message), true);
check("nothing was charged in the attempt",
      window.WilsonStore.load().visits.find(function (v) { return v.id === firstVisit.id; }).chargedAt,
      undefined);

/* Now the customer completes the payment link Wilson sent them. */
window.WilsonStore.connectPayment(accepted.householdId);
const afterCard = window.WilsonStore.load().visits.find(function (v) { return v.id === firstVisit.id; });
check("once the payment method lands, the visit says so", afterCard.paymentStatus, "Ready to charge");
/* MANUAL, and Cayden confirmed it stays manual. A card arriving must not be a
   trigger for taking money -- a person presses charge. */
check("but the arriving card did not charge anything by itself",
      afterCard.chargedAt, undefined);
check("and only then does a charge go through",
      window.WilsonStore.mockCharge(firstVisit.id).ok, true);

/* The form path is unaffected: it cannot submit without a connected card, so
   its visits were always genuinely ready and must still say so. */
const formBundle = window.WilsonStore.createEnrollment({
  category: "appliance", planId: "estate_annual", annualAmount: 1195,
  assets: [{ customerCategory: "refrigeration", type: "refrigerator",
             typeLabel: "Refrigerator", group: "standard", imucVisitsPerYear: 1 }],
  areas: [{ id: "area_main", name: "Main House" }],
  paymentReady: true, autoRenew: true, acceptedTermsAt: new Date().toISOString(),
  firstName: "Form", lastName: "Path", phone: "1", email: "a@b.c",
  address1: "1 St", city: "Austin", state: "TX", zip: "78738"
});
const formVisit = window.WilsonStore.load().visits.find(function (v) {
  return v.householdId === formBundle.household.id && Number(v.amountToCharge || 0) > 0;
});
check("an enrollment submitted with a card is ready to charge immediately",
      formVisit.paymentStatus, "Ready to charge");

/*
 * And the office has to be able to TELL these apart at a glance.
 *
 * The status badges classify by substring, and the generic rules were beating
 * the specific ones: "Charged - $3,145.00" contains "charge", so a payment that
 * had gone through wore the same amber badge as one still owing. So did
 * "Included - no additional charge", and so did the new "Awaiting payment
 * method" -- the whole payment column rendered one colour and carried no
 * information.
 *
 * This is a SOURCE-ORDER check, and worth being plain about what that means: it
 * proves the settled-outcome branch is still evaluated before the loose word
 * "charge", not that any particular badge renders any particular colour. The
 * colours themselves were verified by rendering every status value the seed
 * data produces through both helpers. A crude guard on the exact thing that
 * broke beats no guard on it.
 */
["assets/household.js", "assets/admin.js"].forEach(function (rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const settled = src.indexOf('lower.startsWith("charged")');
  const generic = src.indexOf('lower.includes("charge")');
  check(rel + ": settled outcomes are classified before the loose word 'charge'",
        settled !== -1 && generic !== -1 && settled < generic, true);
});

/* ========================================================================== */
console.log("\n=== accepting twice does not enroll the house twice ===");
const before = window.WilsonStore.load().households.length;
const again = S.acceptQuote(quoted.id);
check("the second acceptance is refused", again.ok, false);
check("and says why rather than failing silently", again.alreadyAccepted, true);
check("no second household was created", window.WilsonStore.load().households.length, before);

/* ========================================================================== */
console.log("\n=== quotes written before the consolidation ===");
/*
 * A pre-v0.9.23 quote holds a hand-built summary and no enrollment payload.
 * Re-deriving one would mean guessing an appliance list from types and
 * quantities and re-pricing it -- which is rebuilding the second pricing engine
 * this change exists to delete. So it refuses, and says what to do instead.
 */
const legacy = S.saveQuote({
  status: "Draft", propertyName: "Old Estate", contactName: "Someone",
  address: "2 Old Road", planId: "estate_concierge", planName: "Estate Concierge",
  annualAmount: 3745, applianceCount: 20
});
const legacyResult = S.acceptQuote(legacy.id);
check("a legacy quote cannot be converted", legacyResult.ok, false);
check("and the refusal explains what to do",
      /rebuild it from the registration screen/i.test(legacyResult.message), true);
check("it did not create a household from a price it could not justify",
      window.WilsonStore.load().households.length, before);

/* ========================================================================== */
console.log("\n=== the seeded demo quote is priced, not typed ===");
reset();
const seeded = window.WilsonStore.load().quotes.find(function (q) { return q.id === "quote_demo_1"; });
check("the demo quote carries an enrollment payload", Boolean(seeded && seeded.enrollment), true);
if (seeded && seeded.enrollment) {
  const en = seeded.enrollment;
  check("its price is what the engine says that list costs",
        en.annualAmount, P.annual(en.assets, en.planId));
  const b = en.pricingBreakdown;
  check("and its lines sum to it",
        Math.round((b.basePlanAmount + b.largeEstateAdjustment
                  + b.imucSecondVisitAmount + b.filterServiceAmount) * 100) / 100,
        Math.round(en.annualAmount * 100) / 100);
  check("its appliances are individual units, not types with quantities",
        en.assets.every(function (a) { return !("quantity" in a); }), true);
  note("demo quote", en.assets.length + " appliances, " + P.plan(en.planId).name +
       ", $" + en.annualAmount);
}

console.log("");
if (failures.length) {
  console.log(failures.length + " FAILURE(S) of " + checks + " checks:");
  failures.forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
}
console.log("ALL " + checks + " QUOTE/ENROLLMENT PARITY CHECKS PASSED");

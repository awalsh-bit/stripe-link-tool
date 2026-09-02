/*
 * THE FIELD AMENDMENT, AND THE QUOTE PIPELINE.                    (v0.9.41)
 *
 * Two workflows Cayden specified in the same breath, both of which move money
 * or the promise of it, so both get held in place here:
 *
 * 1. THE PLAN AMENDMENT. "get approval in field and trigger office to bill
 *    the new approved total / difference." The invariants: the difference is
 *    ARITHMETIC (new minus previous, nothing invented), the subscription
 *    moves to the new total the moment it is approved, the office sees
 *    exactly one pending charge per approval, and a charge can only be
 *    recorded once.
 *
 * 2. THE FOLLOW-UP QUOTE PIPELINE. open -> quoted -> handed, one direction,
 *    no skipped steps -- because a skipped step here is a customer who never
 *    got their estimate or got it twice.
 *
 * Run: node _qa/verify-amendment.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");
const STORAGE_KEY = "wilson-maintenance-demo-v07";

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
  return sb;
}

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log((ok ? "ok  " : "FAIL") + "  " + label.padEnd(68) + (detail === undefined ? "" : detail));
}

/* A household enrolled through the same door every real one uses. */
function enroll(W) {
  return W.WilsonStore.createEnrollment({
    category: "appliance", planId: "per_appliance",
    annualAmount: 500, paymentReady: true, autoRenew: true,
    acceptedTermsAt: new Date().toISOString(),
    firstName: "Amend", lastName: "Fixture", householdLabel: "Amendment Fixture House",
    phone: "512-555-0000", email: "amend@example.com",
    address1: "1 Test Way", city: "Austin", state: "TX", zip: "78701",
    areas: [{ id: "area_main", name: "Main House", locked: true }],
    assets: [
      { type: "refrigerator", typeLabel: "Refrigerator", customerCategory: "refrigeration",
        areaId: "area_main", location: "Main House" },
      { type: "dishwasher", typeLabel: "Dishwasher", customerCategory: "dishwasher",
        areaId: "area_main", location: "Main House" }
    ]
  });
}

/* ------------------------------------------------------------------ */
console.log("--- seeded plans agree with the pricing engine ---");

/*
 * The amendment's difference is new-total minus on-file, so on-file has to BE
 * the engine's number. Two seeded annuals had drifted (Guardian sensors
 * enrolled in v0.9.40 without the seeded price hearing about it), and the
 * amendment screen opened showing a phantom difference before anything was
 * added. The seeds now compute their annuals from WILSON_PRICING; this holds
 * them there.
 */
const sb = boot(null);
const W = sb.window;
const S = W.WilsonStore;
(function () {
  const st = S.load();
  st.subscriptions.filter(function (s) { return s.category === "appliance"; }).forEach(function (subRow) {
    const appl = st.assets.filter(function (a) { return a.householdId === subRow.householdId && a.group !== "hvac"; });
    const engine = W.WILSON_PRICING.annual(appl, subRow.planId);
    check("seeded " + subRow.id + " matches the engine",
      Math.abs(Number(subRow.annualAmount) - engine) < 0.005,
      subRow.annualAmount + " vs " + engine);
  });
})();
/* The categoryFor fix behind the parity: a stored asset carries the exact
   type ("freezer"), the builder carries the category ("refrigeration"), and
   the engine must price both the same. */
check("a seeded Guardian enrollment is PRICED, not just charted",
  W.WILSON_PRICING.breakdown(
    S.load().assets.filter(function (a) { return a.householdId === "hh_reynolds" && a.group !== "hvac"; }),
    "estate_concierge").tempMonitoringSensors > 0, "");
check("the exact type and the customer category price identically",
  W.WILSON_TEMPWATCH.total([{ customerCategory: "freezer", tempMonitoringOptIn: true }]) ===
  W.WILSON_TEMPWATCH.total([{ customerCategory: "refrigeration", tempMonitoringOptIn: true }]) &&
  W.WILSON_TEMPWATCH.total([{ customerCategory: "freezer", tempMonitoringOptIn: true }]) > 0, "");

/* ------------------------------------------------------------------ */
console.log("\n--- the amendment: arithmetic, not invention ---");
const bundle = enroll(W);
const hh = bundle.household.id;
const before = S.load();
const sub = before.subscriptions.find(function (s) { return s.householdId === hh; });
const fridgeId = before.assets.find(function (a) { return a.householdId === hh && a.customerCategory === "refrigeration"; }).id;
const assetCountBefore = before.assets.filter(function (a) { return a.householdId === hh; }).length;
const filterCountBefore = before.filters.filter(function (f) { return f.householdId === hh; }).length;

const res = S.amendEnrollment({
  householdId: hh,
  subscriptionId: sub.id,
  addedAssets: [{ type: "refrigerator", typeLabel: "Wine Refrigerator", customerCategory: "refrigeration",
                  areaId: "area_main", location: "Main House", filterServiceOptIn: true }],
  optInSync: [{ assetId: fridgeId, tempMonitoringOptIn: true, filterServiceOptIn: false,
                airFilterServiceOptIn: false, imucVisitsPerYear: 1 }],
  planId: "per_appliance",
  newAnnual: 815.5,
  signatureDataUrl: "data:image/png;base64,TEST",
  approvedBy: "Customer, on the technician's device"
});
check("the amendment files", res.ok === true, res.message || "");
check("the difference is new minus previous, to the cent",
  res.amendment.difference === 315.5, String(res.amendment.difference));
check("it starts pending charge", res.amendment.chargeStatus === "Pending charge", "");
check("the signature travels on the record", res.amendment.signature === "data:image/png;base64,TEST", "");

const after = S.load();
const subAfter = after.subscriptions.find(function (s) { return s.id === sub.id; });
check("the subscription moved to the approved total", subAfter.annualAmount === 815.5, String(subAfter.annualAmount));
check("the appliance joined the household",
  after.assets.filter(function (a) { return a.householdId === hh; }).length === assetCountBefore + 1, "");
check("the Guardian opt-in landed on the EXISTING fridge",
  after.assets.find(function (a) { return a.id === fridgeId; }).tempMonitoringOptIn === true, "");
check("the new appliance got its filter tracking",
  after.filters.filter(function (f) { return f.householdId === hh; }).length > filterCountBefore, "");
check("the household activity tells the office what to bill",
  (function () {
    const expected = "$" + res.amendment.proratedDifference.toFixed(2);
    return (after.activity || []).some(function (a) {
      return a.householdId === hh && a.type === "Amendment" && a.text.indexOf(expected) > -1;
    });
  })(), "");
/* v0.9.49, Cayden's correction: this amendment ADDS an appliance, and the
   tech services it at this visit -- so the increase bills at FULL price,
   never prorated. "so we should charge full price for it. i thought about
   this wrong." */
check("an addition serviced at the visit bills the FULL difference",
  res.amendment.proratedDifference === 315.5 && res.amendment.servicedNow === true,
  String(res.amendment.proratedDifference));
check("...and the activity says why in plain words",
  (after.activity || []).some(function (a) {
    return a.householdId === hh && a.type === "Amendment" && a.text.indexOf("full-year price") > -1;
  }), "");

/* ------------------------------------------------------------------ */
console.log("\n--- one approval, one charge, once ---");

check("the office sees exactly one pending charge",
  S.pendingAmendments().filter(function (a) { return a.householdId === hh; }).length === 1, "");
const charged = S.markAmendmentCharged(res.amendment.id);
check("charging it works once", charged.ok === true && charged.amendment.chargeStatus === "Charged", "");
const again = S.markAmendmentCharged(res.amendment.id);
check("...and refuses a second press", again.ok === false, "");
check("the queue is empty after the charge",
  S.pendingAmendments().filter(function (a) { return a.householdId === hh; }).length === 0, "");

/* An amendment that only flips add-ons downward can owe nothing. */
const res2 = S.amendEnrollment({
  householdId: hh, subscriptionId: sub.id, addedAssets: [],
  optInSync: [{ assetId: fridgeId, tempMonitoringOptIn: false, filterServiceOptIn: false,
                airFilterServiceOptIn: false, imucVisitsPerYear: 1 }],
  planId: "per_appliance", newAnnual: 815.5
});
check("a zero-difference amendment owes nothing",
  res2.ok === true && res2.amendment.chargeStatus === "No charge due", "");
check("...and never reaches the billing queue",
  S.pendingAmendments().filter(function (a) { return a.householdId === hh; }).length === 0, "");

check("an unknown household is refused", S.amendEnrollment({ householdId: "hh_nope", newAnnual: 1 }).ok === false, "");

/* ------------------------------------------------------------------ */
console.log("\n--- proration: today's charge covers today's remaining year ---");

/* Cayden: "it should prorate and fall into the normal billing schedule on
   the following interval." The helper is arithmetic; hold it to arithmetic. */
const PR = W.WILSON_PRICING.prorateDifference;
check("half a year left bills half the difference",
  PR(200, "2026-12-01", "2026-06-01T00:00:00").amount === Math.round(200 * (183 / 365) * 100) / 100,
  String(PR(200, "2026-12-01", "2026-06-01T00:00:00").amount));
check("a full year left bills the full difference",
  PR(200, "2027-06-01", "2026-06-01T00:00:00").amount === 200, "");
/* v0.9.48, from the audit: a passed renewal used to zero the charge with no
   renewal machinery to ever collect it -- the customer signed for a real
   increase and Wilson billed nothing forever. A passed renewal now means the
   next plan year has begun: full difference, flagged as such. */
check("renewal already passed bills the FULL difference, flagged",
  (function () {
    const r = PR(200, "2026-01-01", "2026-06-01T00:00:00");
    return r.amount === 200 && r.renewalPassed === true && r.factor === 1;
  })(), JSON.stringify(PR(200, "2026-01-01", "2026-06-01T00:00:00")));
check("no renewal date on file falls back to the full difference (never silently under-charges)",
  PR(200, null).amount === 200 && PR(200, null).factor === 1, "");
check("a credit prorates by the same clock",
  PR(-200, "2026-12-01", "2026-06-01T00:00:00").amount === -Math.round(200 * (183 / 365) * 100) / 100, "");

/* The billing split (v0.9.49): WHAT prorates and what does not is a rule of
   its own -- amendmentBilling. Additions serviced at the visit bill full;
   everything else keeps the v0.9.43 proration. */
const AB = W.WILSON_PRICING.amendmentBilling;
check("an increase WITH additions bills full price, flagged serviced-now",
  (function () {
    const r = AB(200, "2026-12-01", { hasAdditions: true, asOf: "2026-06-01T00:00:00" });
    return r.amount === 200 && r.factor === 1 && r.servicedNow === true;
  })(), JSON.stringify(AB(200, "2026-12-01", { hasAdditions: true, asOf: "2026-06-01T00:00:00" })));
check("an increase WITHOUT additions still prorates",
  AB(200, "2026-12-01", { hasAdditions: false, asOf: "2026-06-01T00:00:00" }).amount ===
    PR(200, "2026-12-01", "2026-06-01T00:00:00").amount, "");
check("a net credit prorates even when appliances were added",
  AB(-200, "2026-12-01", { hasAdditions: true, asOf: "2026-06-01T00:00:00" }).amount ===
    PR(-200, "2026-12-01", "2026-06-01T00:00:00").amount, "");

/* Through the store, both arms: shrink the remaining term to ~half a year.
   An ADDITION still bills the full difference (serviced at the visit); an
   add-on-only change prorates to the days left. */
(function () {
  const st = S.load();
  const subRow = st.subscriptions.find(function (s) { return s.id === sub.id; });
  const halfway = new Date(Date.now() + 182 * 86400000).toISOString().slice(0, 10);
  subRow.renewalOn = halfway;
  sb.localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  const currentAnnual = subRow.annualAmount;
  const r = S.amendEnrollment({
    householdId: hh, subscriptionId: sub.id,
    addedAssets: [{ type: "dryer", typeLabel: "Dryer", customerCategory: "dryer", areaId: "area_main", location: "Main House" }],
    optInSync: [], planId: "per_appliance", newAnnual: currentAnnual + 100
  });
  check("an addition mid-cycle still bills the FULL difference (serviced at the visit)",
    r.amendment.difference === 100 && r.amendment.proratedDifference === 100 && r.amendment.servicedNow === true,
    String(r.amendment.proratedDifference));
  S.markAmendmentCharged(r.amendment.id);

  const st2 = S.load();
  const fridge2 = st2.assets.find(function (a) { return a.householdId === hh && a.customerCategory === "refrigeration"; });
  const annual2 = st2.subscriptions.find(function (s) { return s.id === sub.id; }).annualAmount;
  const r2 = S.amendEnrollment({
    householdId: hh, subscriptionId: sub.id, addedAssets: [],
    optInSync: [{ assetId: fridge2.id, tempMonitoringOptIn: true, filterServiceOptIn: false,
                  airFilterServiceOptIn: false, imucVisitsPerYear: 1 }],
    planId: "per_appliance", newAnnual: annual2 + 100
  });
  const expected = W.WILSON_PRICING.prorateDifference(100, halfway).amount;
  check("an add-on-only change mid-cycle records the prorated figure",
    r2.amendment.difference === 100 && r2.amendment.proratedDifference === expected,
    r2.amendment.proratedDifference + " vs " + expected);
  check("...which is about half, not the whole difference",
    r2.amendment.proratedDifference > 45 && r2.amendment.proratedDifference < 55,
    String(r2.amendment.proratedDifference));
  check("the activity tells the office it is prorated and when the new annual starts",
    (S.load().activity || []).some(function (a) {
      return a.type === "Amendment" && a.text.indexOf("prorated") > -1 && a.text.indexOf(halfway) > -1;
    }), "");
  S.markAmendmentCharged(r2.amendment.id);
})();

/* ------------------------------------------------------------------ */
console.log("\n--- the visit rows hear about the change (v0.9.48) ---");

/* The audit's worst money finding: the annual moved and the scheduled visit
   kept quoting the old figure with no explanation. The billing model keeps
   this cycle's rows at the pre-change annual (the amendment row settles the
   difference), so the rows must SAY so, refresh their scope, and any newly
   added second icemaker visit must actually exist. */
(function () {
  const st = S.load();
  const visitRow = st.visits.find(function (v) { return v.householdId === hh && v.status !== "Completed"; });
  check("uncharged future visits carry the amendment note",
    Boolean(visitRow && /signed amendment settles the difference/.test(visitRow.amendedNote || "")),
    visitRow ? visitRow.amendedNote : "no visit");
  check("...and their scope counts the CURRENT plan",
    Boolean(visitRow && /enrolled appliance/.test(visitRow.assetScope || "")), visitRow ? visitRow.assetScope : "");

  /* An icemaker flipped to two visits per year mid-cycle gets its second
     visit CREATED -- at $0, because the money is inside the signed
     difference. A customer must never pay for a visit not on the schedule. */
  const before = st.visits.filter(function (v) { return v.householdId === hh; }).length;
  const r = S.amendEnrollment({
    householdId: hh, subscriptionId: sub.id,
    addedAssets: [{ type: "ice_maker", typeLabel: "Icemaker", customerCategory: "ice_maker",
                    group: "imuc", imucVisitsPerYear: 2, areaId: "area_main", location: "Main House" }],
    optInSync: [], planId: "per_appliance",
    newAnnual: S.load().subscriptions.find(function (s) { return s.id === sub.id; }).annualAmount + 499.9
  });
  check("the icemaker amendment files", r.ok === true, r.message || "");
  const afterState = S.load();
  const imucVisit = afterState.visits.find(function (v) {
    return v.householdId === hh && /icemaker/i.test(String(v.assetScope || "")) && v.status !== "Completed";
  });
  check("a second icemaker visit now exists on the schedule", Boolean(imucVisit), "");
  check("...at no NEW charge — its money is inside the signed difference",
    Boolean(imucVisit) && Number(imucVisit.amountToCharge) === 0, imucVisit ? String(imucVisit.amountToCharge) : "");
  check("the visit count actually grew",
    afterState.visits.filter(function (v) { return v.householdId === hh; }).length === before + 1, "");
  S.markAmendmentCharged(r.amendment.id);
})();

/* ------------------------------------------------------------------ */
console.log("\n--- a plan change resyncs filter coverage (v0.9.48) ---");

(function () {
  const currentAnnual = S.load().subscriptions.find(function (s) { return s.id === sub.id; }).annualAmount;
  const r = S.amendEnrollment({
    householdId: hh, subscriptionId: sub.id, addedAssets: [], optInSync: [],
    planId: "estate_concierge", newAnnual: currentAnnual + 500
  });
  const st = S.load();
  const subRow = st.subscriptions.find(function (s) { return s.id === sub.id; });
  check("moving onto Concierge includes the filters", subRow.standardFiltersIncluded === true, "");
  check("...and the filter rows say Included",
    st.filters.filter(function (f) { return f.subscriptionId === sub.id; })
      .every(function (f) { return f.planCoverage === "Included"; }), "");
  check("the plan change is on the amendment record",
    r.amendment.planChange && r.amendment.planChange.to === "estate_concierge", "");
  S.markAmendmentCharged(r.amendment.id);
  const back = S.amendEnrollment({
    householdId: hh, subscriptionId: sub.id, addedAssets: [], optInSync: [],
    planId: "per_appliance", newAnnual: currentAnnual
  });
  const st2 = S.load();
  check("moving OFF Concierge stops giving filters away",
    st2.subscriptions.find(function (s) { return s.id === sub.id; }).standardFiltersIncluded === false &&
    st2.filters.filter(function (f) { return f.subscriptionId === sub.id; })
      .every(function (f) { return f.planCoverage !== "Included"; }), "");
  S.markAmendmentCharged(back.amendment.id);
})();

check("the builder never downgrades the plan inside an amendment",
  /if \(amendment\) return changed;/.test(fs.readFileSync(path.join(ROOT, "assets/appliance-builder.js"), "utf8")), "");
check("...and a plan change is a named line on the approval panel",
  /amend-plan-change/.test(fs.readFileSync(path.join(ROOT, "assets/appliance-builder.js"), "utf8")), "");

/* ------------------------------------------------------------------ */
console.log("\n--- removals: fine in the field, office confirms ---");

/* Cayden: "Removing appliances from a plan should be fine in the field,
   office confirms changes." The record survives; every active surface lets
   go of it; the office row appears even at even money. */
const st2 = S.load();
const dishId = st2.assets.find(function (a) { return a.householdId === hh && a.customerCategory === "dishwasher"; }).id;
const fridgeBefore = st2.assets.find(function (a) { return a.id === fridgeId; });
/* Re-enroll the fridge in Guardian so the removal test can watch it leave the fleet. */
S.amendEnrollment({ householdId: hh, subscriptionId: sub.id, addedAssets: [],
  optInSync: [{ assetId: fridgeId, tempMonitoringOptIn: true, filterServiceOptIn: false,
                airFilterServiceOptIn: false, imucVisitsPerYear: 1 }],
  planId: "per_appliance", newAnnual: S.load().subscriptions.find(function (s) { return s.id === sub.id; }).annualAmount });
check("the enrolled fridge is on the Guardian fleet before removal",
  W.WILSON_TEMPWATCH_SIM.fleet(S.load()).some(function (r) { return r.asset.id === fridgeId; }), "");

const remRes = S.amendEnrollment({
  householdId: hh, subscriptionId: sub.id,
  addedAssets: [], optInSync: [],
  removedAssetIds: [fridgeId, dishId],
  planId: "per_appliance",
  newAnnual: 500.5,   /* below the current annual -> a credit decision */
  signatureDataUrl: "data:image/png;base64,REMOVE"
});
check("the removal amendment files", remRes.ok === true, remRes.message || "");
check("it names what came off", remRes.amendment.removedLabels.length === 2,
  remRes.amendment.removedLabels.join(", "));
check("a reduced annual is a credit decision, not a charge",
  remRes.amendment.chargeStatus === "Pending credit", remRes.amendment.chargeStatus);
const stAfter = S.load();
check("the record survives with the vocabulary equipment.js speaks",
  stAfter.assets.find(function (a) { return a.id === fridgeId; }).status === "Removed", "");
check("its filter tracking rows are gone",
  stAfter.filters.filter(function (f) { return f.assetId === fridgeId || f.assetId === dishId; }).length === 0, "");
check("it left the Guardian fleet",
  W.WILSON_TEMPWATCH_SIM.fleet(stAfter).some(function (r) { return r.asset.id === fridgeId; }) === false, "");
check("it left the visit's field list",
  (function () {
    const visitRow = stAfter.visits.find(function (v) { return v.householdId === hh; });
    if (!visitRow) return true;
    return S.scopedAssetsForVisit(visitRow).some(function (a) { return a.id === fridgeId; }) === false;
  })(), "");
check("the office sees the pending row", S.pendingAmendments().some(function (a) { return a.id === remRes.amendment.id; }), "");
const settled = S.markAmendmentCharged(remRes.amendment.id);
check("settling a credit records it as a credit, not a charge",
  settled.ok === true && settled.amendment.chargeStatus === "Credited", settled.amendment && settled.amendment.chargeStatus);

/* An even-money removal still gets office confirmation. */
const washerId = (function () {
  const r = S.amendEnrollment({ householdId: hh, subscriptionId: sub.id,
    addedAssets: [{ type: "washer", typeLabel: "Washer", customerCategory: "washer", areaId: "area_main", location: "Main House" }],
    optInSync: [], planId: "per_appliance",
    newAnnual: S.load().subscriptions.find(function (s) { return s.id === sub.id; }).annualAmount });
  S.markAmendmentCharged(r.amendment.id);
  return r.addedAssets[0].id;
})();
const evenRes = S.amendEnrollment({ householdId: hh, subscriptionId: sub.id,
  addedAssets: [], optInSync: [], removedAssetIds: [washerId],
  planId: "per_appliance",
  newAnnual: S.load().subscriptions.find(function (s) { return s.id === sub.id; }).annualAmount });
check("an even-money removal still waits for office confirmation",
  evenRes.ok === true && evenRes.amendment.chargeStatus === "Pending confirmation", evenRes.amendment.chargeStatus);
check("...and confirming records exactly that",
  S.markAmendmentCharged(evenRes.amendment.id).amendment.chargeStatus === "Confirmed", "");

/* ------------------------------------------------------------------ */
console.log("\n--- the quote pipeline walks one direction ---");

/* A follow-up planted directly in storage: the transitions are what is under
   test here; the CREATION path (syncFollowUpsFromInspection) is exercised by
   the browser suite completing a real inspection. */
const state = S.load();
state.followUps = state.followUps || [];
state.followUps.push({
  id: "fu_qa", key: "v|a|c", visitId: "v", assetId: "a", checkId: "c",
  householdId: hh, reportId: "r", applianceLabel: "Test Dryer", checkName: "Vent static",
  verdict: "Cause for concern", note: "Static doubled", technician: "QA Tech",
  createdAt: new Date().toISOString(), status: "open"
});
sb.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

check("an open flag is in the tech's queue",
  S.openFollowUps(hh).some(function (f) { return f.id === "fu_qa"; }), "");
check("the office cannot hand off a quote nobody built",
  S.handFollowUpToApprovals("fu_qa").ok === false, "");
const q = S.markFollowUpQuoted("fu_qa", { ref: "SV00999999" });
check("Quote complete moves it to the office", q.ok === true && q.followUp.status === "quoted", "");
check("...and keeps the SV number for the ePass hunt", q.followUp.serviceOrderRef === "SV00999999", "");
check("it left the tech queue", S.openFollowUps(hh).some(function (f) { return f.id === "fu_qa"; }) === false, "");
check("it is now the office's row", S.quotedFollowUps(hh).some(function (f) { return f.id === "fu_qa"; }), "");
check("Quote complete cannot fire twice", S.markFollowUpQuoted("fu_qa", {}).ok === false, "");
const handed = S.handFollowUpToApprovals("fu_qa");
check("the import handoff closes it out", handed.ok === true && handed.followUp.status === "handed", "");
check("both queues are clear of it",
  !S.openFollowUps(hh).concat(S.quotedFollowUps(hh)).some(function (f) { return f.id === "fu_qa"; }), "");
check("the activity trail names Service Estimate Approvals",
  (S.load().activity || []).some(function (a) { return a.text.indexOf("Service Estimate Approvals") > -1; }), "");

/* ------------------------------------------------------------------ */
console.log("\n--- the admin queue is wired to all of it ---");

const adminSrc = fs.readFileSync(path.join(ROOT, "assets/admin.js"), "utf8");
check("the billing stage exists and outranks the quoting stages",
  (function () {
    const m = adminSrc.match(/const STAGE_ORDER = \[([^\]]+)\]/);
    if (!m) return false;
    const order = m[1].split(",").map(function (s) { return s.replace(/["'\s]/g, ""); });
    return order.indexOf("amendcharge") > -1 && order.indexOf("sendquote") > -1 &&
           order.indexOf("amendcharge") < order.indexOf("followup") &&
           order.indexOf("followup") < order.indexOf("sendquote");
  })(), "");
check("the queue reads pendingAmendments, quote complete, and the handoff",
  /pendingAmendments/.test(adminSrc) && /data-followup-quoted/.test(adminSrc) &&
  /data-followup-handed/.test(adminSrc) && /data-amendment-charged/.test(adminSrc), "");
check("the household page offers the amendment door",
  /appliance-signup\.html\?amend=/.test(fs.readFileSync(path.join(ROOT, "assets/household.js"), "utf8")), "");
check("the builder has the amendment mode behind it",
  /enterAmendmentMode/.test(fs.readFileSync(path.join(ROOT, "assets/appliance-builder.js"), "utf8")), "");

/* ------------------------------------------------------------------ */
console.log("\n--- mutation tests: every assertion above can fail ---");

function mutation(label, mutate, broke) {
  let stale = true;
  const M = boot(function (f, s) {
    const out = mutate(f, s);
    if (out !== s) stale = false;
    return out;
  });
  if (stale) { fail++; console.log("FAIL  STALE:  " + label.padEnd(64) + " mutation matched nothing"); return; }
  let caught = false;
  try { caught = broke(M.window, M); } catch (e) { caught = true; }
  if (caught) console.log("ok    caught: " + label);
  else { fail++; console.log("FAIL  missed: " + label); }
}

mutation("the difference inverted (office would credit instead of bill)", function (f, s) {
  if (f !== "assets/store.js") return s;
  return s.replace("const difference = Math.round((newAnnual - previousAnnual) * 100) / 100;",
                   "const difference = Math.round((previousAnnual - newAnnual) * 100) / 100;");
}, function (w) {
  const b = enroll(w);
  const st = w.WilsonStore.load();
  const su = st.subscriptions.find(function (s) { return s.householdId === b.household.id; });
  const r = w.WilsonStore.amendEnrollment({ householdId: b.household.id, subscriptionId: su.id,
    addedAssets: [], optInSync: [], planId: "per_appliance", newAnnual: 700 });
  return r.amendment.difference !== 200;
});

mutation("the double-charge guard removed", function (f, s) {
  if (f !== "assets/store.js") return s;
  return s.replace('    if (String(item.chargeStatus || "").indexOf("Pending") !== 0) return { ok: false, message: "Nothing left to charge." };', "");
}, function (w) {
  const b = enroll(w);
  const st = w.WilsonStore.load();
  const su = st.subscriptions.find(function (s) { return s.householdId === b.household.id; });
  const r = w.WilsonStore.amendEnrollment({ householdId: b.household.id, subscriptionId: su.id,
    addedAssets: [{ type: "washer", typeLabel: "Washer", customerCategory: "washer", areaId: "area_main", location: "Main House" }],
    optInSync: [], planId: "per_appliance", newAnnual: 700 });
  w.WilsonStore.markAmendmentCharged(r.amendment.id);
  return w.WilsonStore.markAmendmentCharged(r.amendment.id).ok === true;
});

mutation("Quote complete skipping the open check", function (f, s) {
  if (f !== "assets/store.js") return s;
  return s.replace('    if (item.status !== "open") return { ok: false, message: "Already handled." };\n    item.status = "quoted";',
                   '    item.status = "quoted";');
}, function (w, M) {
  const st = w.WilsonStore.load();
  st.followUps = [{ id: "fu_m", householdId: "x", applianceLabel: "A", checkName: "C", status: "handed" }];
  M.localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  return w.WilsonStore.markFollowUpQuoted("fu_m", {}).ok === true;
});

mutation("the handoff accepting an unquoted flag", function (f, s) {
  if (f !== "assets/store.js") return s;
  return s.replace('if (item.status !== "quoted") return { ok: false, message: "Not waiting on the office." };', "");
}, function (w, M) {
  const st = w.WilsonStore.load();
  st.followUps = [{ id: "fu_m2", householdId: "x", applianceLabel: "A", checkName: "C", status: "open" }];
  M.localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  return w.WilsonStore.handFollowUpToApprovals("fu_m2").ok === true;
});

mutation("proration quietly dropped (office charges the full year mid-cycle)", function (f, s) {
  if (f !== "assets/store.js") return s;
  return s.replace(/    const proration = window\.WILSON_PRICING\.amendmentBilling\(difference, subscription\.renewalOn, \{\n      hasAdditions: \(payload\.addedAssets \|\| \[\]\)\.length > 0\n    \}\);/,
                   "    const proration = { amount: difference, factor: 1, daysRemaining: null };");
}, function (w, M) {
  const b = enroll(w);
  const st = w.WilsonStore.load();
  const su = st.subscriptions.find(function (s) { return s.householdId === b.household.id; });
  su.renewalOn = new Date(Date.now() + 100 * 86400000).toISOString().slice(0, 10);
  M.localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  const r = w.WilsonStore.amendEnrollment({ householdId: b.household.id, subscriptionId: su.id,
    addedAssets: [], optInSync: [{ assetId: st.assets.find(function (a) { return a.householdId === b.household.id; }).id,
      tempMonitoringOptIn: true, filterServiceOptIn: false, airFilterServiceOptIn: false, imucVisitsPerYear: 1 }],
    planId: "per_appliance", newAnnual: su.annualAmount + 100 });
  /* Caught when the office would be charged the FULL year with 100 days left. */
  return r.amendment.proratedDifference >= 100;
});

mutation("the serviced-now rule dropped (added appliances prorated again)", function (f, s) {
  if (f !== "assets/plan-config.js") return s;
  return s.replace("    if (opts.hasAdditions && diff > 0) {",
                   "    if (false) {");
}, function (w, M) {
  const b = enroll(w);
  const st = w.WilsonStore.load();
  const su = st.subscriptions.find(function (s) { return s.householdId === b.household.id; });
  su.renewalOn = new Date(Date.now() + 100 * 86400000).toISOString().slice(0, 10);
  M.localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  const r = w.WilsonStore.amendEnrollment({ householdId: b.household.id, subscriptionId: su.id,
    addedAssets: [{ type: "washer", typeLabel: "Washer", customerCategory: "washer", areaId: "area_main", location: "Main House" }],
    optInSync: [], planId: "per_appliance", newAnnual: su.annualAmount + 100 });
  /* Caught when the appliance the tech services TODAY bills less than its
     full-year price. */
  return r.amendment.proratedDifference < 100;
});

mutation("a removal that never actually removes", function (f, s) {
  if (f !== "assets/store.js") return s;
  return s.replace('      asset.status = "Removed";\n      asset.removedFromPlanAt = isoTime(0);',
                   '      asset.removedFromPlanAt = isoTime(0);');
}, function (w) {
  const b = enroll(w);
  const st = w.WilsonStore.load();
  const su = st.subscriptions.find(function (s) { return s.householdId === b.household.id; });
  const victim = st.assets.find(function (a) { return a.householdId === b.household.id; });
  w.WilsonStore.amendEnrollment({ householdId: b.household.id, subscriptionId: su.id,
    addedAssets: [], optInSync: [], removedAssetIds: [victim.id],
    planId: "per_appliance", newAnnual: su.annualAmount });
  return w.WilsonStore.load().assets.find(function (a) { return a.id === victim.id; }).status !== "Removed";
});

mutation("a zero-difference amendment billed anyway", function (f, s) {
  if (f !== "assets/store.js") return s;
  return s.replace('        : "No charge due",',
                   '        : "Pending charge",');
}, function (w) {
  const b = enroll(w);
  const st = w.WilsonStore.load();
  const su = st.subscriptions.find(function (s) { return s.householdId === b.household.id; });
  w.WilsonStore.amendEnrollment({ householdId: b.household.id, subscriptionId: su.id,
    addedAssets: [], optInSync: [], planId: "per_appliance", newAnnual: su.annualAmount });
  return w.WilsonStore.pendingAmendments().some(function (a) { return a.householdId === b.household.id; });
});

console.log("");
if (fail) { console.log("FAILURES: " + fail); process.exit(1); }
console.log("ALL AMENDMENT + QUOTE-PIPELINE CHECKS PASSED");

/*
 * FROM ANONYMOUS SLOTS TO NAMED APPLIANCES
 *
 * Cayden's workflow: "customer registers or accepts a quote on maint - it moves
 * into the command center. our internal team is then prompted to upload a sales
 * invoice if we have it to extract appliance info. or they can manually key it.
 * this should then live in the customer file."
 *
 * And on whether the gap holds anything up: "Nothing is blocked; it's a queue
 * item with a due date."
 *
 * WHAT THIS SUITE IS FENCING
 * -------------------------
 *   1. NOTHING IS BLOCKED. A household with no equipment details still charges,
 *      still schedules, still dispatches. The gap is a queue item.
 *   2. THE GAP IS REAL AND MEASURED. Registration collects no brand, so a fresh
 *      household is genuinely 100% unknown, and the queue must say so rather
 *      than reading zero because the demo data was pre-filled.
 *   3. A BLANK NEVER ERASES. Not from an invoice, not from the keyed form. The
 *      absence of information is not the information that there is none.
 *   4. EVERY WRITTEN FIELD KNOWS WHERE IT CAME FROM. A pre-filled field on a
 *      technician's card that cannot say its source tells them nothing about how
 *      hard to look.
 *   5. PARKING IS IDEMPOTENT. Re-importing the same invoice must not park the
 *      same range four times.
 *   6. THE GUARDRAIL KEEPS ASKING. The import screen warns while somebody is
 *      looking at it; the queue is what remembers after they clicked save.
 *   7. AGE KEEPS ITS OWN PROVENANCE. It predates this feature, it moves 25% of
 *      the score, and a second set of fields that could disagree with the first
 *      is the bug this whole codebase keeps having.
 *
 * Run: node _qa/verify-equipment-enrichment.js
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
eval(fs.readFileSync(path.join(ROOT, "assets", "equipment-match.js"), "utf8"));

const config = window.WILSON_CONFIG;
const Store = window.WilsonStore;
const B = window.WILSON_BRANDS;
const M = window.WILSON_MATCH;

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
function fresh() { backing = {}; return Store.load(); }

/* ========================================================================== */
console.log("=== the household every new customer actually is ===");
fresh();

const gaps = Store.equipmentGaps("hh_okafor");
note("Okafor appliances", gaps.total + " on the plan, " + gaps.missing + " with no brand or model");
check("a household seeded the way registration leaves one has NOTHING on file",
      [gaps.total > 0, gaps.missing === gaps.total, gaps.undated === gaps.total], [true, true, true]);
check("and it is not marked complete",
      gaps.complete, false);
/*
 * This record exists because without it every seeded household already had
 * brands on everything, the queue stage read a permanent zero, and the whole
 * enrichment loop was invisible in the demo. A prototype whose data only shows
 * the finished state cannot be evaluated in the unfinished one.
 */
check("at least one seeded household is in the unfilled state",
      Store.load().households.filter(function (h) {
        const g = Store.equipmentGaps(h.id);
        return g.total > 0 && g.missing === g.total;
      }).length > 0, true);

/* ========================================================================== */
console.log("\n=== nothing is blocked ===");
/*
 * Cayden's own call. The gap must not touch money or dispatch -- it is a queue
 * item with a due date and nothing more.
 */
const before = Store.load();
const okaforVisits = before.visits.filter(function (v) { return v.householdId === "hh_okafor"; });
check("a household with no equipment details still has a visit on the books",
      okaforVisits.length > 0, true);
check("and that visit is chargeable and schedulable like any other",
      [Boolean(okaforVisits[0].amountToCharge >= 0), okaforVisits[0].status !== "Blocked"], [true, true]);
check("the gap carries the visit date, because that is when it starts mattering",
      [Boolean(gaps.dueDate), Boolean(gaps.visitId)], [true, true]);
check("and the lead time is config, not a literal in a screen",
      typeof config.operations.equipmentLeadDays, "number");

/* HVAC systems are read off their own nameplate on site and are not part of the
   invoice loop. Counting them would put a permanent gap on every HVAC household
   that nobody can close from a desk. */
const mercer = Store.equipmentGaps("hh_mercer");
const mercerHvac = Store.load().assets.filter(function (a) {
  return a.householdId === "hh_mercer" && a.group === "hvac";
});
check("HVAC systems are outside the enrichment count",
      [mercerHvac.length > 0, mercer.total + mercerHvac.length ===
        Store.load().assets.filter(function (a) { return a.householdId === "hh_mercer"; }).length],
      [true, true]);

/* ========================================================================== */
console.log("\n=== writing details in, and where they came from ===");
fresh();
const slot = Store.load().assets.find(function (a) { return a.householdId === "hh_okafor"; });

const wrote = Store.applyEquipmentDetails({
  householdId: "hh_okafor",
  confirm: [{ slotId: slot.id, details: {
    brand: { value: "Sub-Zero", source: "invoice", ref: "SV0013777", at: "2026-08-27T00:00:00Z" },
    model: { value: "BI-48S", source: "invoice", ref: "SV0013777", at: "2026-08-27T00:00:00Z" },
    installYear: { value: 2018, source: "invoice", ref: "SV0013777", at: "2026-08-27T00:00:00Z" }
  } }]
});
check("the write reports what it did", [wrote.ok, wrote.written], [true, 3]);

const after = Store.load().assets.find(function (a) { return a.id === slot.id; });
check("the appliance now has a name", [after.brand, after.model], ["Sub-Zero", "BI-48S"]);
check("and every field knows where it came from",
      [after.detailProvenance.brand.source, after.detailProvenance.brand.ref,
       after.detailProvenance.model.source], ["invoice", "SV0013777", "invoice"]);
/*
 * Age already had provenance before this feature -- `ageSource` and
 * `ageSourceRef` -- and the report and the score read them. A second set that
 * could disagree with the first is exactly the failure this codebase keeps
 * finding, so the install year is written through the existing fields.
 */
check("the install year went through the age fields that already existed",
      [after.installYear, after.ageSource, after.ageSourceRef], [2018, "invoice", "SV0013777"]);
check("and did NOT grow a second provenance record of its own",
      Boolean(after.detailProvenance.installYear), false);
check("the gap count went down by one",
      Store.equipmentGaps("hh_okafor").missing, gaps.missing - 1);

/* A blank is the absence of information, not information. */
Store.applyEquipmentDetails({
  householdId: "hh_okafor",
  confirm: [{ slotId: slot.id, details: {
    brand: { value: "", source: "invoice", ref: "SV9", at: "" },
    serial: { value: "   ", source: "invoice", ref: "SV9", at: "" }
  } }]
});
const stillThere = Store.load().assets.find(function (a) { return a.id === slot.id; });
check("a blank value never erases what is already known",
      [stillThere.brand, stillThere.detailProvenance.brand.ref], ["Sub-Zero", "SV0013777"]);

check("an unknown household is refused rather than half-written",
      Store.applyEquipmentDetails({ householdId: "nope", confirm: [] }).ok, false);

/* ========================================================================== */
console.log("\n=== extras are parked, and parking is idempotent ===");
fresh();
const parkLine = { brand: "Thermador", model: "MC30WP", description: "30in. Speed Oven",
                   customerCategory: "microwave", exactTypeLabel: "Speed Oven",
                   invoiceNumber: "SV0013777", installYear: 2021, area: "Kitchen" };
const first = Store.applyEquipmentDetails({
  householdId: "hh_okafor", park: [{ line: parkLine, reason: "Nothing of this type is on the plan" }] });
const second = Store.applyEquipmentDetails({
  householdId: "hh_okafor", park: [{ line: parkLine, reason: "Nothing of this type is on the plan" }] });
check("the first import parks it", first.parked, 1);
check("re-importing the same invoice does not park it twice", second.parked, 0);
check("and the household file carries it",
      Store.getHouseholdBundle("hh_okafor").parked.map(function (p) { return p.model; }), ["MC30WP"]);
check("with the reason it was not covered",
      Store.getHouseholdBundle("hh_okafor").parked[0].reason, "Nothing of this type is on the plan");

/*
 * A parked appliance on a brand Wilson does not service is not an upsell, and
 * the record says so -- otherwise the "sold, not covered" list reads as a list
 * of things to go and sell.
 */
Store.applyEquipmentDetails({
  householdId: "hh_okafor",
  park: [{ line: { brand: "Samsung", model: "RF28", customerCategory: "refrigeration",
                   invoiceNumber: "SV0013777" },
           reason: "Nothing of this type is on the plan", serviceable: false }] });
check("an unserviceable parked appliance is marked as one",
      Store.getHouseholdBundle("hh_okafor").parked
        .filter(function (p) { return p.brand === "Samsung"; })[0].serviceable, false);

/* ========================================================================== */
console.log("\n=== the guardrail keeps asking after the screen is closed ===");
fresh();
const wineSlot = Store.load().assets.find(function (a) {
  return a.householdId === "hh_okafor" && /wine/i.test(a.typeLabel);
});
check("a wine slot exists to test with", Boolean(wineSlot), true);
check("with nothing on it, there is no coverage problem -- only a details gap",
      Store.equipmentGaps("hh_okafor").blockedCount, 0);

Store.applyEquipmentDetails({
  householdId: "hh_okafor",
  confirm: [{ slotId: wineSlot.id, details: {
    brand: { value: "Samsung", source: "invoice", ref: "SV0013777", at: "" } } }] });
const blockedGaps = Store.equipmentGaps("hh_okafor");
check("once the brand is known, the appliance is flagged as uncoverable",
      [blockedGaps.blockedCount, blockedGaps.blocked[0].serviceability.state], [1, "not_serviced"]);
check("and it names the brand, so the queue card can too",
      blockedGaps.blocked[0].serviceability.brand, "Samsung");
check("a household with a flagged appliance is never 'complete'",
      blockedGaps.complete, false);
/*
 * Cayden chose "Flag it, no money math." So the tool names the appliance and the
 * reason and stops there -- it does not compute a refund, and it does not take
 * the appliance off the plan by itself.
 */
check("the appliance is still on the plan -- the tool flags, it does not remove",
      Store.load().assets.find(function (a) { return a.id === wineSlot.id; }).status, "Active");
check("and no credit or amount is invented anywhere on the gap record",
      Object.keys(blockedGaps).filter(function (k) { return /amount|credit|refund/i.test(k); }), []);

/* Big Green Egg is the other reason, and must not read as the first one. */
const grillHost = Store.load().assets.find(function (a) { return a.householdId === "hh_reynolds" && a.checkpointSet === "outdoor_grill"; });
if (grillHost) {
  Store.applyEquipmentDetails({ householdId: "hh_reynolds",
    confirm: [{ slotId: grillHost.id, details: { brand: { value: "Big Green Egg", source: "office", ref: "", at: "" } } }] });
  const g = Store.equipmentGaps("hh_reynolds");
  check("nothing-to-maintain is flagged too, under its own state",
        g.blocked.map(function (x) { return x.serviceability.state; }), ["not_maintainable"]);
  check("and it does not borrow the not-serviced sentence",
        g.blocked[0].serviceability.customer !== config.serviceabilityCopy.not_serviced.customer, true);
}

/* ========================================================================== */
console.log("\n=== the whole loop, on a real proposal ===");
fresh();
const slots = Store.load().assets.filter(function (a) { return a.householdId === "hh_okafor"; });
const invoice = [
  { customerCategory: "refrigeration", exactType: "refrigerator", brand: "Sub-Zero", model: "SZ-1",
    serial: "S1", area: "Kitchen", quantity: 1, invoiceNumber: "SV1", installYear: 2021 },
  { customerCategory: "dishwasher", exactType: "dishwasher", brand: "Cove", model: "CV-1",
    serial: "S2", area: "Kitchen", quantity: 1, invoiceNumber: "SV1", installYear: 2021 },
  { customerCategory: "microwave", exactType: "speed_oven", brand: "Thermador", model: "TH-1",
    serial: "S3", area: "Kitchen", quantity: 1, invoiceNumber: "SV1", installYear: 2021 }
];
const proposal = M.propose(slots, invoice);
note("proposal", proposal.counts.matched + " matched, " + proposal.counts.unmatched +
     " unmatched, " + proposal.counts.extras + " parked");
check("the two enrolled types match and the speed oven is an extra",
      [proposal.counts.matched, proposal.counts.extras], [2, 1]);

const applied = Store.applyEquipmentDetails({
  householdId: "hh_okafor",
  invoiceRefs: ["SV1"],
  confirm: proposal.matches.map(function (m) {
    return { slotId: m.slotId, sourceInvoice: m.line.invoiceNumber,
             details: M.detailsFrom(m.line, m.slot, m.line.invoiceNumber) };
  }),
  park: proposal.extras.map(function (e) { return { line: e.line, reason: e.reason }; })
});
check("confirming the proposal writes and parks in one call",
      [applied.ok, applied.parked, applied.written > 0], [true, 1, true]);
check("the gap shrank by exactly the number matched",
      Store.equipmentGaps("hh_okafor").missing, slots.length - proposal.counts.matched);
check("and the invoice is recorded against the household",
      Store.getHouseholdBundle("hh_okafor").household.invoiceRefs, ["SV1"]);
check("the activity log says what happened",
      /equipment/i.test((Store.getHouseholdBundle("hh_okafor").activity[0] || {}).summary || ""), true);

/* ========================================================================== */
console.log("\n=== the screen and the queue are wired to it ===");
const adminJs = fs.readFileSync(path.join(ROOT, "assets", "admin.js"), "utf8");
const equipHtml = fs.readFileSync(path.join(ROOT, "equipment.html"), "utf8");
const swJs = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");

/* Order is priority. The gap sits below everything that stops money or a truck
   and above the quote nudge -- that placement IS Cayden's "nothing is blocked",
   expressed where the queue can see it. */
const order = (adminJs.match(/const STAGE_ORDER = \[(.*?)\];/) || [])[1] || "";
check("the equipment stage sits after report and before quotes",
      order.replace(/[\s"]/g, "").split(",").indexOf("equipment"),
      order.replace(/[\s"]/g, "").split(",").indexOf("quotes") - 1);
check("the stage is declared with a hint, like every other",
      /equipment:\s*\{\s*label:.*hint:/.test(adminJs), true);
check("the queue card links to the screen that fixes it",
      /equipment\.html\?id=/.test(adminJs), true);
check("the screen offers both routes Cayden described",
      [/equip-dropzone/.test(equipHtml), /equip-manual/.test(equipHtml)], [true, true]);
check("and it is cached for offline, like every other page",
      [/"equipment\.html"/.test(swJs), /assets\/equipment\.js/.test(swJs),
       /assets\/equipment-match\.js/.test(swJs)], [true, true, true]);

console.log("");
if (failures.length) {
  console.log(failures.length + " FAILURE(S) of " + checks + " checks:");
  failures.forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
}
console.log("ALL " + checks + " EQUIPMENT ENRICHMENT CHECKS PASSED");

/*
 * Filter service pricing. Selecting filter service on an individual
 * refrigeration or icemaker asset raises the annual plan price by Wilson's
 * sales price for that asset's filters; Estate Concierge includes them outright.
 *
 * Prices here are PLACEHOLDERS ($70/filter) until Wilson's filter sales-price
 * list is loaded. This test asserts the arithmetic and the plan interaction, and
 * reads the unit price from config -- so loading real prices does not break it.
 *
 * Run: node _qa/verify-filter-pricing.js
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'assets', 'plan-config.js'), 'utf8'),
  sandbox
);
const config = sandbox.window.WILSON_CONFIG;
const F = sandbox.window.WILSON_FILTERS;

const WATER = config.refrigerationFilterService.pricing.kinds.water.unitPrice;
const AIR = config.refrigerationFilterService.pricing.kinds.air.unitPrice;
const CONCIERGE = 'estate_concierge';

let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(62)} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

const fridge = (extra) => Object.assign(
  { type: 'refrigeration', customerCategory: 'refrigeration', group: 'standard' }, extra
);
const icemaker = (extra) => Object.assign(
  { type: 'ice_maker', customerCategory: 'ice_maker', group: 'imuc' }, extra
);
const oven = (extra) => Object.assign(
  { type: 'ovens', customerCategory: 'ovens', group: 'standard' }, extra
);

console.log(`unit prices from config: water $${WATER}, air $${AIR}\n`);

console.log('--- eligibility ---');
check('refrigeration offers water + air', F.kindsFor(fridge()), ['water', 'air']);
check('icemaker offers water only', F.kindsFor(icemaker()), ['water']);
check('oven offers nothing', F.kindsFor(oven()), []);
check('unknown asset offers nothing', F.kindsFor({ type: 'flux' }), []);

console.log('\n--- pricing, per_appliance plan ---');
check('refrigeration, nothing selected',
  F.forAsset(fridge(), 'per_appliance').total, 0);
check('refrigeration + water',
  F.forAsset(fridge({ filterServiceOptIn: true }), 'per_appliance').total, WATER);
check('refrigeration + air only',
  F.forAsset(fridge({ airFilterServiceOptIn: true }), 'per_appliance').total, AIR);
check('refrigeration + water + air',
  F.forAsset(fridge({ filterServiceOptIn: true, airFilterServiceOptIn: true }), 'per_appliance').total,
  WATER + AIR);
check('icemaker + water',
  F.forAsset(icemaker({ filterServiceOptIn: true }), 'per_appliance').total, WATER);
check('icemaker + air is not offered, so not charged',
  F.forAsset(icemaker({ airFilterServiceOptIn: true }), 'per_appliance').total, 0);
check('oven + water is not offered, so not charged',
  F.forAsset(oven({ filterServiceOptIn: true }), 'per_appliance').total, 0);

console.log('\n--- per-filter quantity (Sub-Zero style, two water filters) ---');
check('two water filters',
  F.forAsset(fridge({ filterServiceOptIn: true, waterFilterQuantity: 2 }), 'per_appliance').total,
  WATER * 2);
check('two water + one air',
  F.forAsset(fridge({ filterServiceOptIn: true, waterFilterQuantity: 2, airFilterServiceOptIn: true }), 'per_appliance').total,
  WATER * 2 + AIR);
check('quantity ignored when the kind is not selected',
  F.forAsset(fridge({ waterFilterQuantity: 3 }), 'per_appliance').total, 0);
check('zero quantity falls back to the config default',
  F.forAsset(fridge({ filterServiceOptIn: true, waterFilterQuantity: 0 }), 'per_appliance').total, WATER);
check('junk quantity falls back to the config default',
  F.forAsset(fridge({ filterServiceOptIn: true, waterFilterQuantity: 'lots' }), 'per_appliance').total, WATER);

console.log('\n--- Estate Concierge includes filters ---');
check('concierge includes filters', F.planIncludesFilters(CONCIERGE), true);
check('estate_preferred does not', F.planIncludesFilters('estate_preferred'), false);
check('concierge + water + air costs nothing',
  F.forAsset(fridge({ filterServiceOptIn: true, airFilterServiceOptIn: true }), CONCIERGE).total, 0);
check('concierge still reports what is covered',
  F.forAsset(fridge({ filterServiceOptIn: true, airFilterServiceOptIn: true }), CONCIERGE).lines.length, 2);
check('concierge marks the selection as included',
  F.forAsset(fridge({ filterServiceOptIn: true }), CONCIERGE).included, true);
/* Concierge covers both kinds outright, so coverage must not depend on the
   customer having ticked anything -- the enrollment UI renders both boxes
   checked and locked, and the summary has to agree. */
check('concierge reports both kinds covered with no opt-in at all',
  F.forAsset(fridge(), CONCIERGE).lines.map((l) => l.kindId), ['water', 'air']);
check('concierge coverage for an untouched icemaker',
  F.forAsset(icemaker(), CONCIERGE).lines.map((l) => l.kindId), ['water']);
check('concierge coverage still costs nothing',
  F.forAsset(fridge(), CONCIERGE).total, 0);
check('non-concierge plans charge nothing without an opt-in',
  F.forAsset(fridge(), 'estate_preferred').total, 0);
check('concierge rollup counts every covered asset, not just ticked ones',
  F.summary([fridge(), fridge(), icemaker()], CONCIERGE).kinds.water.assetCount, 3);

console.log('\n--- household rollup ---');
const household = [
  fridge({ filterServiceOptIn: true }),                                  // 1 water
  fridge({ filterServiceOptIn: true, airFilterServiceOptIn: true }),     // 1 water + 1 air
  fridge({ filterServiceOptIn: true, waterFilterQuantity: 2 }),          // 2 water
  icemaker({ filterServiceOptIn: true }),                                // 1 water
  icemaker({}),                                                          // nothing
  oven({ filterServiceOptIn: true }),                                    // not eligible
];
check('household total on estate_preferred',
  F.total(household, 'estate_preferred'), WATER * 5 + AIR * 1);
check('household total on concierge', F.total(household, CONCIERGE), 0);

const summary = F.summary(household, 'estate_preferred');
check('rollup water quantity', summary.kinds.water.quantity, 5);
check('rollup water asset count', summary.kinds.water.assetCount, 4);
check('rollup air quantity', summary.kinds.air.quantity, 1);
check('rollup total matches', summary.total, F.total(household, 'estate_preferred'));

console.log('\n--- estate comparison is not distorted ---');
/* Filter service adds the same amount to per_appliance, estate_annual and
   estate_preferred, so it must never change which plan is cheapest. */
const plans = ['per_appliance', 'estate_annual', 'estate_preferred'];
const totals = plans.map((p) => F.total(household, p));
check('identical filter cost across non-concierge plans',
  totals.every((t) => t === totals[0]), true);

console.log('\n--- placeholder pricing is flagged ---');
check('pricingStatus present and mentions placeholder',
  /placeholder/i.test(config.refrigerationFilterService.pricing.pricingStatus), true);

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(fail ? 1 : 0);

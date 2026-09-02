const fs=require('fs'),vm=require('vm');
const sandbox={window:{}};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','assets','plan-config.js'),'utf8'),sandbox);
const cfg=sandbox.window.WILSON_CONFIG, R=sandbox.window.WILSON_PROTOCOL.resolveCheckpointSet;
const sets=Object.keys(cfg.checkpointSets);
console.log('checkpoint sets defined ('+sets.length+'):',sets.join(', '));

const expectCat={refrigeration:'refrigerator',ice_maker:'icemaker',cooktop:'cooktop',range:'cooking',
 dishwasher:'dishwasher',ventilation:'ventilation',microwave:'microwave',ovens:'oven',
 warming_drawer:'warming_drawer',coffee:'coffee',washer:'washer',dryer:'dryer',
 // Always expands to washer + dryer, so no asset ever carries it; shares its id
 // with the applianceTypes entry, which is what resolution actually matches.
 laundry_center:'laundry',
 outdoor_grill:'outdoor_grill'};

let fail=0;
console.log('\n--- customer categories (as enrollment creates them) ---');
for(const cat of cfg.customerApplianceCategories){
  const asset={type:cat.id,typeLabel:cat.label,customerCategory:cat.id,group:cat.group,checkpointSet:cat.checkpointSet};
  const got=R(asset), want=expectCat[cat.id], ok=got===want;
  if(!ok)fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${cat.id.padEnd(16)} stored=${String(cat.checkpointSet).padEnd(12)} resolved=${got.padEnd(12)} want=${want}`);
}

const expectType={refrigerator:'refrigerator',freezer:'refrigerator',wine_beverage:'refrigerator',
 ice_maker:'icemaker',dishwasher:'dishwasher',range:'cooking',cooktop:'cooktop',wall_oven:'oven',
 speed_oven:'microwave',washer:'washer',dryer:'dryer',hood:'ventilation',hood_insert:'ventilation',
 warming_drawer:'warming_drawer',coffee_maker:'coffee',laundry_center:'laundry',
 commercial_refrigeration:'refrigerator',outdoor_grill:'outdoor_grill',
 outdoor:'generic',other:'generic'};

console.log('\n--- exact appliance types (as invoice import creates them) ---');
for(const t of cfg.applianceTypes){
  const asset={exactType:t.id,exactTypeLabel:t.label,type:t.id,typeLabel:t.label,group:t.group,checkpointSet:t.checkpointSet};
  const got=R(asset), want=expectType[t.id], ok=got===want;
  if(!ok)fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${t.id.padEnd(26)} stored=${String(t.checkpointSet).padEnd(12)} resolved=${got.padEnd(12)} want=${want}`);
}

console.log('\n--- legacy data with wrong stored value (no migration) ---');
for(const [label,asset,want] of [
  ['washer stored as laundry',{type:'washer',customerCategory:'washer',group:'standard',checkpointSet:'laundry'},'washer'],
  ['dryer stored as laundry',{type:'dryer',customerCategory:'dryer',group:'standard',checkpointSet:'laundry'},'dryer'],
  ['hood stored as generic',{type:'ventilation',customerCategory:'ventilation',group:'standard',checkpointSet:'generic'},'ventilation'],
  ['microwave stored as cooking',{type:'microwave',customerCategory:'microwave',group:'standard',checkpointSet:'cooking'},'microwave'],
  /* Was 'generic' until v0.9.14, when HVAC stopped falling through to the
     three-check fallback and started resolving by system type. The stored
     checkpointSet on a seeded row is still 'generic', so this also confirms
     resolution ignores the stale stored value the way it does for appliances. */
  ['seeded HVAC row',{type:'Split System',typeLabel:'HVAC System',group:'hvac',checkpointSet:'generic'},'hvac_cooling'],
  ['heat pump',{type:'Heat Pump',group:'hvac',checkpointSet:'generic'},'hvac_heatpump'],
  ['gas furnace',{type:'Gas Furnace',group:'hvac',checkpointSet:'generic'},'hvac_furnace'],
  ['mini-split',{type:'Mini-Split',group:'hvac',checkpointSet:'generic'},'hvac_minisplit'],
  ['packaged unit',{type:'Packaged Unit',group:'hvac',checkpointSet:'generic'},'hvac_cooling'],
  /* An unclassified HVAC system stays visible as a gap rather than being handed
     a protocol that does not fit it. */
  ['unclassified HVAC',{type:'Other',group:'hvac',checkpointSet:'generic'},'generic'],
  ['unknown junk',{type:'flux_capacitor',group:'standard'},'generic'],
  ['null asset',null,'generic'],
]){
  const got=R(asset), ok=got===want; if(!ok)fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${label.padEnd(28)} resolved=${got.padEnd(12)} want=${want}`);
}

/*
 * Reachability, from every route that can actually produce a protocol.
 *
 * This only walked the appliance category and type indexes, so when HVAC
 * started resolving by system type it reported all four HVAC protocols as
 * orphaned -- three lines after proving each of them reachable. A warning that
 * contradicts the test above it is a warning nobody reads.
 */
const reachable=new Set([
  ...[...cfg.customerApplianceCategories,...cfg.applianceTypes].map(e=>R({exactType:e.id,type:e.id,customerCategory:e.id,group:e.group,checkpointSet:e.checkpointSet})),
  ...cfg.hvacSystemTypes.map(t=>R({type:t,group:'hvac',checkpointSet:'generic'})),
  R({group:'imuc'}),
  'generic'
]);
const orphan=sets.filter(s=>!reachable.has(s));
console.log('\norphaned checkpoint sets (defined but unreachable):',orphan.length?orphan.join(', '):'none');
if(orphan.length){
  /* An unreachable protocol is dead configuration: it looks like coverage in
     this file and can never run in the field. */
  fail++;
  console.log('FAIL  every defined checkpoint set must be reachable');
}
console.log('lifecycleMatrix missing an entry for:',sets.filter(s=>!cfg.lifecycleMatrix[s]).join(', ')||'none');
console.log(fail?`\n${fail} FAILURE(S)`:'\nALL CHECKS PASSED');
process.exit(fail?1:0);

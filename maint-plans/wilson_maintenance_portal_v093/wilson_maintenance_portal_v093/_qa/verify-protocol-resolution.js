const fs=require('fs'),vm=require('vm');
const sandbox={window:{}};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','assets','plan-config.js'),'utf8'),sandbox);
const cfg=sandbox.window.WILSON_CONFIG, R=sandbox.window.WILSON_PROTOCOL.resolveCheckpointSet;
const sets=Object.keys(cfg.checkpointSets);
console.log('checkpoint sets defined ('+sets.length+'):',sets.join(', '));

const expectCat={refrigeration:'refrigerator',ice_maker:'icemaker',cooktop:'cooking',range:'cooking',
 dishwasher:'dishwasher',ventilation:'ventilation',microwave:'microwave',ovens:'cooking',
 warming_drawer:'cooking',coffee:'generic',washer:'washer',dryer:'dryer'};

let fail=0;
console.log('\n--- customer categories (as enrollment creates them) ---');
for(const cat of cfg.customerApplianceCategories){
  const asset={type:cat.id,typeLabel:cat.label,customerCategory:cat.id,group:cat.group,checkpointSet:cat.checkpointSet};
  const got=R(asset), want=expectCat[cat.id], ok=got===want;
  if(!ok)fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${cat.id.padEnd(16)} stored=${String(cat.checkpointSet).padEnd(12)} resolved=${got.padEnd(12)} want=${want}`);
}

const expectType={refrigerator:'refrigerator',freezer:'refrigerator',wine_beverage:'refrigerator',
 ice_maker:'icemaker',dishwasher:'dishwasher',range:'cooking',cooktop:'cooking',wall_oven:'cooking',
 speed_oven:'microwave',washer:'washer',dryer:'dryer',hood:'ventilation',hood_insert:'ventilation',
 warming_drawer:'cooking',coffee_maker:'generic',laundry_center:'laundry',
 commercial_refrigeration:'refrigerator',outdoor:'generic',other:'generic'};

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
  ['seeded HVAC row',{type:'Split System',typeLabel:'HVAC System',group:'hvac',checkpointSet:'generic'},'generic'],
  ['unknown junk',{type:'flux_capacitor',group:'standard'},'generic'],
  ['null asset',null,'generic'],
]){
  const got=R(asset), ok=got===want; if(!ok)fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${label.padEnd(28)} resolved=${got.padEnd(12)} want=${want}`);
}

const reachable=new Set([...cfg.customerApplianceCategories,...cfg.applianceTypes].map(e=>R({exactType:e.id,type:e.id,customerCategory:e.id,group:e.group,checkpointSet:e.checkpointSet})));
const orphan=sets.filter(s=>!reachable.has(s));
console.log('\norphaned checkpoint sets (defined but unreachable):',orphan.length?orphan.join(', '):'none');
console.log('lifecycleMatrix missing an entry for:',sets.filter(s=>!cfg.lifecycleMatrix[s]).join(', ')||'none');
console.log(fail?`\n${fail} FAILURE(S)`:'\nALL CHECKS PASSED');
process.exit(fail?1:0);

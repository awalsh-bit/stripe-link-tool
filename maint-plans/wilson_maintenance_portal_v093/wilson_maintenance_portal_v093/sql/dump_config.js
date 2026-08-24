/* Dumps WILSON_CONFIG to JSON so the migration generator can read it.
   Keeps SQL protocol/lifecycle seeds derived from plan-config.js rather than
   hand-transcribed. Usage: node sql/dump_config.js > /tmp/wilson_config.json */
const fs=require('fs'),vm=require('vm'),path=require('path');
const sandbox={window:{}};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','assets','plan-config.js'),'utf8'),sandbox);
const c=sandbox.window.WILSON_CONFIG;
process.stdout.write(JSON.stringify({
  configVersion:c.version,
  refrigerationFilterService:c.refrigerationFilterService,
  checkpointSets:c.checkpointSets,
  customerApplianceCategories:c.customerApplianceCategories,
  applianceTypes:c.applianceTypes,
  brandTierDefaults:c.brandTierDefaults,
  lifecycleTiers:c.lifecycleTiers,
  lifecycleMatrix:c.lifecycleMatrix,
  lifecycleStages:c.lifecycleStages,
  reportScoring:c.reportScoring
},null,1));

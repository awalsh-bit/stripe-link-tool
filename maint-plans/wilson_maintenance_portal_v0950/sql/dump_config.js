/* Dumps WILSON_CONFIG to JSON so the migration generator can read it.
   Keeps SQL protocol/lifecycle seeds derived from plan-config.js rather than
   hand-transcribed. Usage: node sql/dump_config.js > /tmp/wilson_config.json */
const fs=require('fs'),vm=require('vm'),path=require('path');
const sandbox={window:{}};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','assets','plan-config.js'),'utf8'),sandbox);
const c=sandbox.window.WILSON_CONFIG;
const A=sandbox.window.WILSON_ANSWERS;
/* v0.9.17: the answer kind travels with the checkpoint into SQL. Resolved
   through WILSON_ANSWERS here rather than read off checkpointAnswers directly,
   so the database seed and the field tool get their kinds from the SAME
   resolver -- including the defaults for checkpoints that carry no explicit
   entry. Reading the raw table would have silently defaulted those to nothing
   at all. */
const answerKinds={};
Object.keys(c.checkpointSets).forEach(function(setKey){
  answerKinds[setKey]={};
  (c.checkpointSets[setKey]||[]).forEach(function(cp){
    const a=A.for(setKey,cp.id)||{};
    answerKinds[setKey][cp.id]={
      kind:a.kind||"scored",
      control:a.control||null,
      /* `optionSet` is the SET NAME ("frost", "sump_condition"). */
      options:a.optionSet||null,
      scores:Boolean(a.scores),
      /* v0.9.19: THE ANSWERS THEMSELVES, and what each is worth.
         This comment used to say the members were "seeded elsewhere" and that
         carrying them here would be a second copy. They were not seeded
         anywhere -- so the published scores existed only in the browser, and a
         dashboard computing a health score in SQL had nothing to compute it
         from. `score: null` is a real answer ("could not get to it"), not a
         missing value. */
      optionList:(a.options||[]).map(function(o){
        return {
          code:o.code, label:o.label, result:o.result,
          score:(Object.prototype.hasOwnProperty.call(o,"score")
            ? (o.score===null||o.score===undefined?null:Number(o.score))
            : null),
          attention:Boolean(o.attention),
          requiresDetail:o.requiresDetail||null
        };
      })
    };
  });
});
process.stdout.write(JSON.stringify({
  configVersion:c.version,
  answerKinds:answerKinds,
  answerKindDefinitions:c.answerKinds||null,
  maintenanceActions:c.maintenanceActions||null,
  refrigerationFilterService:c.refrigerationFilterService,
  checkpointSets:c.checkpointSets,
  customerApplianceCategories:c.customerApplianceCategories,
  applianceTypes:c.applianceTypes,
  brandTierDefaults:c.brandTierDefaults,
  /* v0.9.30: brand is now two lookups, not one, and the dashboard has to reach
     the same answer as the field tool for the same appliance. Carried whole --
     including `field` and `anchored` on every row, so the SQL side can show
     where a number came from rather than only what it is. */
  brandTierByLine:c.brandTierByLine||null,
  brandAliases:c.brandAliases||null,
  applianceLines:c.applianceLines||null,
  brandLifespans:c.brandLifespans||null,
  notServicedBrands:c.notServicedBrands||null,
  notMaintainable:c.notMaintainable||null,
  serviceabilityCopy:c.serviceabilityCopy||null,
  lifecycleTiers:c.lifecycleTiers,
  lifecycleMatrix:c.lifecycleMatrix,
  lifecycleStages:c.lifecycleStages,
  reportScoring:c.reportScoring,
  ageSources:c.ageSources,
  /* v0.9.21: the water hardness modifier. Carried whole -- bands, softener
     states, which protocols run water, and the basis text -- because the
     dashboard has to reach the same expected life as the field tool, and the
     honesty flag (`sourced: false`) has to travel with the numbers rather than
     living only in a comment the SQL side never sees. */
  waterHardness:c.waterHardness
},null,1));

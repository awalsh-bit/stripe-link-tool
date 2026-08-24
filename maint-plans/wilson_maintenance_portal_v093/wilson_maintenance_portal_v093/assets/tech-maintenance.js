(function(){
  const ui=window.WilsonUI, config=window.WILSON_CONFIG;
  let state=WilsonStore.load();
  const params=new URLSearchParams(location.search);
  const requestedVisitId=params.get("visit"), requestedHouseholdId=params.get("household");
  let visitId=requestedVisitId, householdId=requestedHouseholdId, activeAssetId=null;
  let draft=null, autosaveTimer=null, routeError="";

  /*
   * A field visit must be opened from an exact visit link. Never fall back to the
   * first sample household: that can put a technician into the wrong residence.
   * The visit record is authoritative; the household query parameter is only a
   * safety cross-check.
   */
  if(!visitId){
    routeError="No maintenance visit was selected.";
  } else {
    const selectedVisit=state.visits.find(v=>v.id===visitId);
    if(!selectedVisit){
      routeError="That maintenance visit could not be found.";
    } else if(householdId && selectedVisit.householdId!==householdId){
      routeError="The selected visit does not belong to this household.";
    } else {
      householdId=selectedVisit.householdId;
    }
  }

  const visit=()=>state.visits.find(v=>v.id===visitId);
  const household=()=>state.households.find(h=>h.id===householdId);
  const subscription=()=>state.subscriptions.find(s=>s.id===visit()?.subscriptionId);
  const technician=()=>params.get("technician")||params.get("tech")||visit()?.technician||"Wilson technician";

  const assets=()=>{
    const v=visit();
    if(!v || v.category!=="appliance") return [];
    let rows=state.assets.filter(a=>a.householdId===household()?.id && a.group!=="hvac" && a.status!=="Inactive");
    const scope=String(v.assetScope||"").toLowerCase();
    if(scope.includes("imuc only")||scope.includes("icemaker only")) rows=rows.filter(a=>a.group==="imuc"||String(a.type||"").toLowerCase().includes("ice"));
    return rows;
  };

  function inspectionFor(assetId){ return WilsonStore.getTechInspection(visitId,assetId); }
  const completedFor=(assetId)=>Boolean(inspectionFor(assetId)?.complete);

  /*
   * Protocol selection lives in plan-config.js (WILSON_PROTOCOL). It used to be
   * duplicated here as a hardcoded if-chain, which masked four wrong
   * checkpointSet values in config -- see the note above resolveCheckpointSet.
   * Do not reintroduce type-string matching here; add or correct the mapping in
   * the taxonomy instead, so the field tool, enrollment, invoice import and the
   * eventual SQL protocol table all agree.
   */
  function templateKey(asset){
    const key=window.WILSON_PROTOCOL.resolveCheckpointSet(asset);
    return config.checkpointSets[key]?key:"generic";
  }

  function tierForBrand(brand){
    const b=(brand||"").toLowerCase();
    for(const [name,tier] of Object.entries(config.brandTierDefaults||{})){ if(b.includes(name)) return tier; }
    return "premium";
  }

  function expectedYears(asset,tier){
    const key=templateKey(asset), matrix=config.lifecycleMatrix[key]||config.lifecycleMatrix.generic;
    return Number(matrix[tier]||config.lifecycleTiers[tier]?.defaultYears||10);
  }

  function lifecycleStage(age,expected){
    const ratio=expected>0?Math.max(0,Number(age||0))/expected:0;
    const band=(config.lifecycleStages||[]).find(item=>ratio<Number(item.maxRatio));
    return {label:band?band.label:"Replacement Planning",ratio};
  }

  function iconFor(asset){
    const map={refrigerator:"refrigeration",icemaker:"ice_maker",dishwasher:"dishwasher",washer:"washer",dryer:"dryer",ventilation:"ventilation",microwave:"microwave",cooking:"range",generic:"refrigeration"};
    return `assets/appliance-icons/${map[templateKey(asset)]||"refrigeration"}.svg`;
  }

  /* Tells the technician exactly which filters the customer is paying for.
     Water and air are separate paid selections, so "filter service" alone is
     no longer enough for the tech to know what to bring. */
  function refrigerationFilterStatus(asset){
    const sub=subscription();
    if(window.WILSON_FILTERS.planIncludesFilters(sub?.planId)) return {active:true,label:"Filter service included",detail:"Estate Concierge · applicable water and air filters covered"};
    const priced=window.WILSON_FILTERS.forAsset(asset,sub?.planId);
    if(priced.lines.length){
      const parts=priced.lines.map(line=>`${line.shortLabel} × ${line.quantity}`);
      return {active:true,label:"Filter service selected",detail:`${parts.join(" · ")} · priced into the plan, bring on this visit`};
    }
    return {active:false,label:"Filter inspection only",detail:"Replacement is not enrolled; document condition and recommend as needed"};
  }

  function scoreDraft(){
    const checks=draft.checks.filter(c=>c.performed), avg=checks.length?checks.reduce((sum,c)=>sum+Number(c.rating||0),0)/checks.length:0;
    const vital=Math.round(avg*20), exp=expectedYears(draft.asset,draft.tier), ratio=Math.max(0,Number(draft.age||0))/exp;
    const ageScore=Math.max(0,Math.min(100,Math.round(100-(60*ratio))));
    const vitalWeight=Number(config.reportScoring.vitalWeight??0.75), ageWeight=Number(config.reportScoring.ageWeight??0.25);
    const overall=Math.round(vital*vitalWeight+ageScore*ageWeight);
    const band=config.reportScoring.gradeBands.find(b=>overall>=b.min)||config.reportScoring.gradeBands.at(-1);
    const life=lifecycleStage(draft.age,exp);
    return {vital,ageScore,overall,grade:band.grade,condition:band.label,expected:exp,lifeStage:life.label,lifeRatio:life.ratio};
  }

  function statusFor(asset){
    const inspection=inspectionFor(asset.id);
    if(!inspection) return {key:"not-started",label:"Not started",action:"Start",attention:false,started:false,complete:false};
    const checks=inspection.checks||[];
    const performed=checks.filter(c=>c.performed).length;
    const actionChecks=checks.filter(c=>c.performed && Number(c.rating)<=2);
    const watchChecks=checks.filter(c=>c.performed && Number(c.rating)===3);
    const attention=actionChecks.length>0||watchChecks.length>0;
    if(inspection.complete){
      if(actionChecks.length) return {key:"action",label:"Needs follow-up",action:"Review",attention:true,started:true,complete:true,detail:actionChecks.map(c=>c.name).join(", ")};
      if(watchChecks.length) return {key:"watch",label:"Monitor",action:"Review",attention:true,started:true,complete:true,detail:watchChecks.map(c=>c.name).join(", ")};
      return {key:"complete",label:"Complete",action:"Review",attention:false,started:true,complete:true};
    }
    const started=performed>0||String(inspection.age??"").trim()!==""||inspection.serialPhoto;
    if(attention) return {key:"in-progress-attention",label:"In progress · attention",action:"Continue",attention:true,started:true,complete:false,detail:[...actionChecks,...watchChecks].map(c=>c.name).join(", ")};
    return {key:"in-progress",label:started?"In progress":"Not started",action:started?"Continue":"Start",attention:false,started,complete:false};
  }

  function progress(){
    const list=assets();
    const statuses=list.map(statusFor);
    const done=statuses.filter(s=>s.complete).length;
    const attention=statuses.filter(s=>s.attention).length;
    return {done,total:list.length,remaining:Math.max(0,list.length-done),attention,pct:list.length?Math.round(done/list.length*100):0};
  }

  function nextAsset(){
    const list=assets();
    return list.find(a=>{const s=statusFor(a); return !s.complete && s.started;}) || list.find(a=>!statusFor(a).complete) || null;
  }

  function renderHead(){
    const h=household(),v=visit(),p=progress();
    const address=h?[h.address1,[h.city,h.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "):"";
    const host=document.getElementById("tech-visit-head");
    const isAppliance=v?.category==="appliance";
    host.innerHTML=`
      <div class="tech-head-topline">
        <span class="tech-head-kicker">Field maintenance</span>
        <span class="tech-user-chip">Signed in as ${ui.escapeHtml(technician())}</span>
      </div>
      <h1>${ui.escapeHtml(h?.name||"Select household")}</h1>
      <p class="tech-head-meta">${v?ui.shortDate(v.dueDate)+" · "+ui.escapeHtml(v.season):"No appliance visit selected"}${address?" · "+ui.escapeHtml(address):""}</p>
      ${isAppliance?`<div class="tech-progress-stats">
        <span><strong>${p.done}</strong> complete</span>
        <span><strong>${p.remaining}</strong> remaining</span>
        <span class="${p.attention?"has-attention":""}"><strong>${p.attention}</strong> attention</span>
      </div>
      <div class="tech-progress" aria-label="${p.pct}% complete"><span style="width:${p.pct}%"></span></div>`:`<div class="tech-progress-stats"><span><strong>HVAC</strong> existing maintenance workflow</span></div>`}`;
  }

  function attentionPanel(){
    const items=assets().map(a=>({asset:a,status:statusFor(a)})).filter(x=>x.status.attention);
    if(!items.length) return "";
    return `<section class="tech-attention-panel"><div><span class="tech-attention-icon">!</span><div><strong>${items.length} appliance${items.length===1?"":"s"} to keep an eye on</strong><p>These items have a Monitor or Needs Follow-up rating. They stay visible while you finish the visit.</p></div></div><div class="tech-attention-list">${items.slice(0,4).map(x=>`<button type="button" data-open-asset="${x.asset.id}"><span>${ui.escapeHtml(x.asset.typeLabel)} · ${ui.escapeHtml(x.asset.location||"Main House")}</span><b>${ui.escapeHtml(x.status.label)}</b></button>`).join("")}</div></section>`;
  }

  function finalVisitCard(){
    const p=progress(), reports=state.reports.filter(r=>r.visitId===visitId);
    return `<section class="tech-finish-card"><div class="tech-finish-check">✓</div><div><span class="eyebrow dark">Field work complete</span><h2>Everything on this visit is finished.</h2><p>${reports.length} appliance health report${reports.length===1?" has":"s have"} been generated from the field data${p.attention?`, with ${p.attention} item${p.attention===1?"":"s"} marked for monitoring or follow-up`:""}. The office can review and email the report package.</p><div class="inline-actions"><a class="button" href="household.html?id=${encodeURIComponent(household().id)}#reports">Review reports</a><a class="button ghost" href="admin.html">Back to Command Center</a></div></div></section>`;
  }

  function nextStepCard(){
    const a=nextAsset();
    if(!a) return finalVisitCard();
    const s=statusFor(a), index=assets().findIndex(item=>item.id===a.id)+1;
    return `<section class="tech-next-card"><div class="tech-next-icon"><img src="${iconFor(a)}" alt=""></div><div class="tech-next-copy"><span class="eyebrow dark">Suggested next step · appliance ${index} of ${assets().length}</span><h2>${s.action} ${ui.escapeHtml(a.typeLabel)}</h2><p>${ui.escapeHtml(a.location||"Main House")} · ${ui.escapeHtml([a.brand,a.model].filter(Boolean).join(" · ")||"Details to verify")}</p>${s.detail?`<div class="tech-next-note">${ui.escapeHtml(s.detail)}</div>`:""}</div><button class="button tech-next-action" type="button" data-open-asset="${a.id}">${s.action} →</button></section>`;
  }

  function areaSection(area,list){
    const areaDone=list.filter(a=>statusFor(a).complete).length;
    const areaAttention=list.filter(a=>statusFor(a).attention).length;
    return `<section class="tech-area"><div class="tech-area-heading"><div><h2>${ui.escapeHtml(area)}</h2><p>${areaDone} of ${list.length} complete${areaAttention?` · ${areaAttention} attention`:""}</p></div><span class="tech-area-progress">${Math.round((areaDone/list.length)*100)||0}%</span></div><div class="tech-asset-list">${list.map(a=>{
      const s=statusFor(a);
      return `<button class="tech-asset-card ${s.complete?"complete":""} ${s.attention?"attention":""}" data-open-asset="${a.id}" type="button"><span class="tech-asset-icon"><img src="${iconFor(a)}" alt=""></span><span class="tech-asset-copy"><strong>${ui.escapeHtml(a.typeLabel)}</strong><small>${ui.escapeHtml([a.brand,a.model].filter(Boolean).join(" · ")||"Details to verify")}</small></span><span class="tech-card-status"><b class="tech-status-pill ${s.key}">${ui.escapeHtml(s.label)}</b><small>${ui.escapeHtml(s.action)} →</small></span></button>`;
    }).join("")}</div></section>`;
  }

  function renderHome(){
    activeAssetId=null;
    document.getElementById("tech-asset-view").classList.add("hidden");
    const host=document.getElementById("tech-home-view");
    host.classList.remove("hidden");
    state=WilsonStore.load();

    if(visit()?.category!=="appliance"){
      host.innerHTML=`<div class="card card-pad" style="margin-top:14px"><div class="empty-state"><strong>This is an HVAC maintenance visit.</strong><br>The appliance field tool only opens appliance-maintenance visits. Continue this visit in the existing Wilson HVAC maintenance workflow.<div class="inline-actions" style="justify-content:center;margin-top:14px"><a class="button" href="admin.html">Back to Command Center</a></div></div></div>`;
      renderHead();
      return;
    }

    const groups={};
    assets().forEach(a=>{const area=a.location||"Main House";(groups[area]||(groups[area]=[])).push(a);});
    const h=household();
    const propertyNote=h?.notes?`<details class="tech-property-note"><summary>Property / access notes</summary><p>${ui.escapeHtml(h.notes)}</p></details>`:"";
    host.innerHTML=`
      <section class="tech-home-intro"><div><h2>Work the visit one appliance at a time.</h2><p>The tool keeps your place, autosaves as you work, and generates each customer report when the appliance is complete.</p></div><a class="button small ghost" href="admin.html">Back to office</a></section>
      ${propertyNote}
      ${nextStepCard()}
      ${attentionPanel()}
      ${Object.entries(groups).map(([area,list])=>areaSection(area,list)).join("")}`;
    host.querySelectorAll("[data-open-asset]").forEach(b=>b.addEventListener("click",()=>openAsset(b.dataset.openAsset)));
    renderHead();
  }

  function freshCheck(template,old){
    const merged=Object.assign({},template,old||{});
    merged.performed=Boolean(old?.performed);
    merged.rating=Number(old?.rating||4);
    merged.reading=old?.reading||"";
    merged.readings=Object.assign({},old?.readings||{});
    merged.note=old?.note||"";
    merged.photo=Boolean(old?.photo);
    merged.photoName=old?.photoName||"";
    return merged;
  }

  function buildChecks(asset,saved,key){
    const templates=config.checkpointSets[key]||config.checkpointSets.generic;
    const oldById={};
    (saved?.checks||[]).forEach(c=>{oldById[c.id]=c;});
    return templates.map(t=>freshCheck(t,oldById[t.id]));
  }

  function openAsset(id){
    activeAssetId=id;
    const asset=assets().find(a=>a.id===id), saved=WilsonStore.getTechInspection(visitId,id), key=templateKey(asset);
    draft=saved?JSON.parse(JSON.stringify(saved)):{asset,visitId,assetId:id,householdId:household().id,technician:technician(),age:asset.installYear?new Date().getFullYear()-Number(asset.installYear):"",tier:tierForBrand(asset.brand),serialPhoto:false,serialPhotoName:"",checks:[],complete:false};
    draft.asset=asset;
    draft.technician=technician();
    draft.checks=buildChecks(asset,saved,key);
    if(!draft.tier) draft.tier=tierForBrand(asset.brand);
    if(draft.age===undefined||draft.age===null) draft.age="";
    renderAsset();
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function condenserDerived(check){
    if(check.id!=="condenser_temp") return "";
    const ambient=parseFloat(check.readings?.ambient), coil=parseFloat(check.readings?.coilSurface);
    if(!Number.isFinite(ambient)||!Number.isFinite(coil)) return `<div class="tech-derived neutral"><strong>Temperature differential</strong><span>Enter ambient + condenser surface temperature to calculate TD.</span></div>`;
    const td=coil-ambient, tdOkay=td>=15&&td<=30, surfaceOkay=coil<120;
    const cls=tdOkay&&surfaceOkay?"good":(td>30||coil>=120?"warning":"neutral");
    const label=tdOkay&&surfaceOkay?"Reference range":(td>30||coil>=120?"Review / document":"Verify operating state");
    return `<div class="tech-derived ${cls}"><strong>Condenser TD: ${td.toFixed(1)}°F · ${label}</strong><span>Reference target: about 15–30°F above ambient; typical surface heat generally under roughly 110–120°F.</span></div>`;
  }

  function readingControls(check,index){
    if(Array.isArray(check.readingFields)&&check.readingFields.length){
      return `<div class="tech-reading-fields">${check.readingFields.map(field=>`<div class="field"><label>${ui.escapeHtml(field.label)}${field.required?' <span class="hint">Required</span>':''}</label><div class="input-unit-wrap"><input type="number" inputmode="decimal" step="0.1" data-reading-key="${index}:${ui.escapeHtml(field.key)}" value="${ui.escapeHtml(check.readings?.[field.key]??"")}" placeholder="${ui.escapeHtml(field.placeholder||"Reading")}">${field.unit?`<span>${ui.escapeHtml(field.unit)}</span>`:""}</div></div>`).join("")}</div><div id="derived-${index}">${condenserDerived(check)}</div>`;
    }
    return `<div class="field"><label>${ui.escapeHtml(check.readingLabel||"Reading / result")}</label><input data-reading="${index}" value="${ui.escapeHtml(check.reading||"")}" placeholder="${ui.escapeHtml(check.unit?"Enter reading in "+check.unit:"Quick result")}"></div>`;
  }

  function filterBanner(){
    if(templateKey(draft.asset)!=="refrigerator") return "";
    const f=refrigerationFilterStatus(draft.asset);
    return `<div class="tech-filter-status ${f.active?"active":""}"><span>F</span><div><strong>${ui.escapeHtml(f.label)}</strong><small>${ui.escapeHtml(f.detail)}</small></div></div>`;
  }

  function checkStateClass(check){
    if(!check.performed) return "";
    if(Number(check.rating)<=2) return "attention-action";
    if(Number(check.rating)===3) return "attention-watch";
    return "done";
  }

  function checkStateLabel(check){
    if(!check.performed) return "Not performed";
    if(Number(check.rating)<=2) return "Needs follow-up";
    if(Number(check.rating)===3) return "Monitor";
    return "Completed";
  }

  function ratingQuickButtons(check,index){
    const labels={1:"Poor",2:"Concern",3:"Monitor",4:"Good",5:"Excellent"};
    const classes={1:"poor",2:"concern",3:"monitor",4:"good",5:"excellent"};
    return `<div class="tech-quick-rating five" role="group" aria-label="Rate ${ui.escapeHtml(check.name)} from 1 to 5">${[1,2,3,4,5].map(r=>`<button type="button" data-quick-rate="${index}:${r}" class="${classes[r]} ${Number(check.rating)===r?"selected":""}" aria-pressed="${Number(check.rating)===r?"true":"false"}"><b>${r}</b><span>${labels[r]}</span></button>`).join("")}</div>`;
  }

  function completionReadiness(){
    const missingChecks=draft.checks.filter(c=>!c.performed).map(c=>c.name);
    const ageReady=String(draft.age??"").trim()!=="" && Number(draft.age)>=0;
    const missingReadings=[];
    draft.checks.forEach(c=>{
      (c.readingFields||[]).filter(f=>f.required).forEach(f=>{if(String(c.readings?.[f.key]??"").trim()==="") missingReadings.push(`${c.name}: ${f.label}`);});
    });
    return {ready:ageReady&&draft.serialPhoto&&!missingChecks.length&&!missingReadings.length,ageReady,serialReady:Boolean(draft.serialPhoto),missingChecks,missingReadings};
  }

  function readinessText(){
    const r=completionReadiness();
    if(r.ready) return {title:"Ready to complete",detail:"All required field steps are captured. Completing this appliance will generate its customer health report.",cls:"ready"};
    const bits=[];
    if(!r.ageReady) bits.push("enter age");
    if(!r.serialReady) bits.push("capture serial tag");
    if(r.missingChecks.length) bits.push(`${r.missingChecks.length} check${r.missingChecks.length===1?"":"s"} remaining`);
    if(r.missingReadings.length) bits.push(`${r.missingReadings.length} required reading${r.missingReadings.length===1?"":"s"}`);
    return {title:"Keep going",detail:bits.join(" · "),cls:"pending"};
  }

  function refreshLiveMetrics(){
    if(!draft) return;
    const score=scoreDraft(), tierLabel=config.lifecycleTiers[draft.tier]?.label||draft.tier;
    const expected=document.getElementById("tech-expected-life"); if(expected) expected.value=score.expected+" years";
    const life=document.getElementById("tech-life-stage-label"); if(life) life.textContent=score.lifeStage;
    const lifeDetail=document.getElementById("tech-life-stage-detail"); if(lifeDetail) lifeDetail.textContent=Math.round(score.lifeRatio*100)+"% of draft expected life · "+tierLabel;
    const scoreNumber=document.getElementById("tech-score-number"); if(scoreNumber) scoreNumber.textContent=score.overall;
    const scoreGrade=document.getElementById("tech-score-grade"); if(scoreGrade) scoreGrade.textContent="Live health score · "+score.grade;
    const scoreDetail=document.getElementById("tech-score-detail"); if(scoreDetail) scoreDetail.textContent=Math.round(Number(config.reportScoring.vitalWeight??.75)*100)+"% current vitals ("+score.vital+") + "+Math.round(Number(config.reportScoring.ageWeight??.25)*100)+"% lifecycle ("+score.ageScore+"). "+score.lifeStage+" · draft expected life "+score.expected+" years.";
    updateReadiness();
  }

  function refreshCondenserDerived(index){
    const host=document.getElementById(`derived-${index}`);
    if(host) host.innerHTML=condenserDerived(draft.checks[index]);
  }

  function updateCheckVisual(index){
    const check=draft.checks[index], card=document.querySelector(`[data-check="${index}"]`);
    if(!card) return;
    card.classList.remove("done","attention-action","attention-watch");
    const cls=checkStateClass(check); if(cls) card.classList.add(cls);
    const label=card.querySelector("[data-check-status]"); if(label){label.className=`tech-check-status ${cls||""}`; label.textContent=checkStateLabel(check);}
    card.querySelectorAll("[data-quick-rate]").forEach(btn=>{const rating=Number(btn.dataset.quickRate.split(":")[1]), selected=rating===Number(check.rating);btn.classList.toggle("selected",selected);btn.setAttribute("aria-pressed",selected?"true":"false");});
  }

  function updateReadiness(){
    if(!draft) return;
    const r=readinessText(), host=document.getElementById("tech-readiness");
    if(host){host.className=`tech-readiness ${r.cls}`;host.innerHTML=`<span>${r.cls==="ready"?"✓":"→"}</span><div><strong>${r.title}</strong><small>${ui.escapeHtml(r.detail)}</small></div>`;}
    const complete=document.getElementById("complete-asset"); if(complete) complete.disabled=!completionReadiness().ready;
  }

  function draftSnapshot(){
    const score=scoreDraft();
    draft.score=score.overall;
    draft.grade=score.grade;
    draft.condition=score.condition;
    draft.expectedYears=score.expected;
    draft.lifeStage=score.lifeStage;
    draft.ageScore=score.ageScore;
    draft.vitalScore=score.vital;
    draft.lifeRatio=score.lifeRatio;
    draft.inspectionDate=draft.inspectionDate||new Date().toISOString().slice(0,10);
    draft.technician=technician();
    return draft;
  }

  function silentSave(){
    if(!draft) return;
    WilsonStore.saveTechInspection(draftSnapshot());
    const label=document.getElementById("tech-autosave");
    if(label){label.textContent="Saved";label.classList.add("saved");setTimeout(()=>label.classList.remove("saved"),900);}
  }

  function scheduleAutosave(){
    const label=document.getElementById("tech-autosave"); if(label) label.textContent="Saving…";
    clearTimeout(autosaveTimer);
    autosaveTimer=setTimeout(silentSave,450);
  }

  function assetHeaderMeta(){
    const list=assets(), index=list.findIndex(a=>a.id===draft.assetId)+1;
    return `Appliance ${index} of ${list.length}`;
  }

  function renderAsset(){
    const host=document.getElementById("tech-asset-view"), home=document.getElementById("tech-home-view");
    home.classList.add("hidden"); host.classList.remove("hidden");
    const score=scoreDraft(), tierLabel=config.lifecycleTiers[draft.tier]?.label||draft.tier, readiness=readinessText();
    host.innerHTML=`
      <section class="tech-asset-hero"><button class="tech-back-link" id="back-assets" type="button">← Appliance list</button><div class="tech-asset-hero-row"><div class="tech-asset-hero-icon"><img src="${iconFor(draft.asset)}" alt=""></div><div><span class="eyebrow dark">${ui.escapeHtml(draft.asset.location||"Main House")} · ${ui.escapeHtml(assetHeaderMeta())}</span><h2>${ui.escapeHtml(draft.asset.typeLabel)}</h2><p>${ui.escapeHtml([draft.asset.brand,draft.asset.model,draft.asset.serial?"S/N "+draft.asset.serial:""].filter(Boolean).join(" · ")||"Exact equipment detail to verify")}</p></div><span id="tech-autosave" class="tech-autosave">Autosave on</span></div>
      <div class="tech-lifecycle-card"><div class="field"><label>Approx. age <span class="hint">Required</span></label><input id="tech-age" type="number" min="0" max="60" inputmode="numeric" value="${ui.escapeHtml(draft.age)}" placeholder="Years"></div><div class="field"><label>Product tier <span class="hint">Defaults from brand</span></label><select id="tech-tier">${Object.values(config.lifecycleTiers).map(t=>`<option value="${t.id}" ${draft.tier===t.id?"selected":""}>${ui.escapeHtml(t.label)}</option>`).join("")}</select></div><div class="field"><label>Expected life</label><input id="tech-expected-life" value="${score.expected} years" disabled></div><div class="tech-life-stage"><span>Lifecycle</span><strong id="tech-life-stage-label">${ui.escapeHtml(score.lifeStage)}</strong><small id="tech-life-stage-detail">${Math.round(score.lifeRatio*100)}% of draft expected life · ${ui.escapeHtml(tierLabel)}</small></div></div>
      ${filterBanner()}
      <label class="tech-photo-button required-photo"><span id="serial-photo-label">${draft.serialPhoto?"✓ Serial tag captured: "+ui.escapeHtml(draft.serialPhotoName):"▣ Take / upload serial-tag photo (required)"}</span><input id="serial-photo" type="file" accept="image/*" capture="environment"></label>
      </section>
      <div class="tech-protocol-heading"><div><span class="eyebrow dark">Short health protocol</span><h2>${draft.checks.length} checks</h2></div><p>Mark each check performed, rate 1–5, capture the required reading, and add a photo only when it helps document the condition.</p></div>
      <div id="tech-checks">${draft.checks.map((c,i)=>`<section class="tech-check-card ${checkStateClass(c)}" data-check="${i}"><div class="tech-check-head"><div class="tech-check-number">${i+1}</div><div class="tech-check-title"><div><strong>${ui.escapeHtml(c.name)}</strong><p>${ui.escapeHtml(c.prompt||"")}</p>${c.guidance?`<div class="tech-guidance">${ui.escapeHtml(c.guidance)}</div>`:""}</div></div><span class="tech-check-status ${checkStateClass(c)}" data-check-status>${ui.escapeHtml(checkStateLabel(c))}</span></div><label class="tech-performed-toggle"><input type="checkbox" data-performed="${i}" ${c.performed?"checked":""}><span>${c.performed?"✓ Performed":"Mark performed"}</span></label><div class="tech-rating"><div class="tech-rating-prompt">Rate condition</div>${ratingQuickButtons(c,i)}</div><div class="tech-reading-grid">${readingControls(c,i)}<div class="field"><label>Quick note <span class="hint">If needed</span></label><input data-note="${i}" value="${ui.escapeHtml(c.note||"")}" placeholder="What did you find?"></div></div><label class="tech-photo-button optional-photo"><span id="photo-label-${i}">${c.photo?"✓ Photo added: "+ui.escapeHtml(c.photoName):"＋ "+ui.escapeHtml(c.photoPrompt||"Add photo if useful")}</span><input type="file" accept="image/*" capture="environment" data-photo="${i}"></label></section>`).join("")}</div>
      <div class="tech-score-preview"><div class="tech-score-number" id="tech-score-number">${score.overall}</div><div><strong id="tech-score-grade">Live health score · ${score.grade}</strong><br><small id="tech-score-detail">${Math.round(Number(config.reportScoring.vitalWeight??.75)*100)}% current vitals (${score.vital}) + ${Math.round(Number(config.reportScoring.ageWeight??.25)*100)}% lifecycle (${score.ageScore}). ${ui.escapeHtml(score.lifeStage)} · draft expected life ${score.expected} years.</small></div></div>
      <div id="tech-readiness" class="tech-readiness ${readiness.cls}"><span>${readiness.cls==="ready"?"✓":"→"}</span><div><strong>${readiness.title}</strong><small>${ui.escapeHtml(readiness.detail)}</small></div></div>
      <div class="tech-bottom-actions"><button class="button secondary" id="save-progress" type="button">Save now</button><button class="button" id="complete-asset" type="button" ${completionReadiness().ready?"":"disabled"}>Complete & generate report</button></div>`;
    bindAsset();
    renderHead();
  }

  function saveCurrent(complete){
    const readiness=completionReadiness();
    if(complete && !readiness.ready){ui.toast("Required steps missing",readinessText().detail);return false;}
    clearTimeout(autosaveTimer);
    draftSnapshot();
    draft.complete=Boolean(complete||draft.complete);
    WilsonStore.saveTechInspection(draft);
    if(complete){
      const generated=WilsonStore.generateReportFromTechInspection(visitId,draft.assetId);
      if(!generated.ok){ui.toast("Report not generated",generated.message||"The field record was saved, but report generation needs attention.");return false;}
      draft.reportId=generated.report.id;
      WilsonStore.saveTechInspection(draft);
      state=WilsonStore.load();
      const updatedVisit=state.visits.find(v=>v.id===visitId);
      ui.toast("Appliance complete",updatedVisit?.reportDeliveryStatus==="Ready to email"?"All scheduled appliances are complete. The report package is ready for office review and email.":"Health report generated automatically from the field data.");
      setTimeout(renderHome,250);
    } else {
      const label=document.getElementById("tech-autosave"); if(label){label.textContent="Saved";label.classList.add("saved");}
      ui.toast("Progress saved","You can return to this appliance later.");
    }
    return true;
  }

  function bindAsset(){
    document.getElementById("back-assets").onclick=()=>{silentSave();renderHome();window.scrollTo({top:0,behavior:"smooth"});};
    document.getElementById("tech-age").oninput=e=>{draft.age=e.target.value;refreshLiveMetrics();scheduleAutosave();};
    document.getElementById("tech-tier").onchange=e=>{draft.tier=e.target.value;refreshLiveMetrics();scheduleAutosave();};
    document.getElementById("serial-photo").onchange=e=>{const f=e.target.files[0];if(f){draft.serialPhoto=true;draft.serialPhotoName=f.name;const label=document.getElementById("serial-photo-label");if(label)label.textContent="✓ Serial tag captured: "+f.name;updateReadiness();scheduleAutosave();}};

    document.querySelectorAll("[data-performed]").forEach(el=>el.onchange=e=>{
      const i=+e.target.dataset.performed; draft.checks[i].performed=e.target.checked;
      const wrapper=e.target.closest(".tech-performed-toggle"); if(wrapper) wrapper.querySelector("span").textContent=e.target.checked?"✓ Performed":"Mark performed";
      updateCheckVisual(i); refreshLiveMetrics(); scheduleAutosave();
    });


    document.querySelectorAll("[data-quick-rate]").forEach(el=>el.onclick=e=>{
      const [idxRaw,ratingRaw]=e.currentTarget.dataset.quickRate.split(":"), i=+idxRaw, rating=+ratingRaw;
      draft.checks[i].rating=rating;
      updateCheckVisual(i); refreshLiveMetrics(); scheduleAutosave();
    });

    document.querySelectorAll("[data-reading]").forEach(el=>el.oninput=e=>{draft.checks[+e.target.dataset.reading].reading=e.target.value;updateReadiness();scheduleAutosave();});
    document.querySelectorAll("[data-reading-key]").forEach(el=>el.oninput=e=>{
      const [idx,key]=e.target.dataset.readingKey.split(":");
      draft.checks[+idx].readings=draft.checks[+idx].readings||{};
      draft.checks[+idx].readings[key]=e.target.value;
      if(draft.checks[+idx].id==="condenser_temp") refreshCondenserDerived(+idx);
      updateReadiness(); scheduleAutosave();
    });
    document.querySelectorAll("[data-note]").forEach(el=>el.oninput=e=>{draft.checks[+e.target.dataset.note].note=e.target.value;scheduleAutosave();});
    document.querySelectorAll("[data-photo]").forEach(el=>el.onchange=e=>{const i=+e.target.dataset.photo,f=e.target.files[0];if(f){draft.checks[i].photo=true;draft.checks[i].photoName=f.name;const label=document.getElementById(`photo-label-${i}`);if(label)label.textContent="✓ Photo added: "+f.name;scheduleAutosave();}});
    document.getElementById("save-progress").onclick=()=>saveCurrent(false);
    document.getElementById("complete-asset").onclick=()=>saveCurrent(true);
  }

  if(routeError||!household()||!visit()){
    const message=routeError||"The selected household or visit could not be found.";
    document.getElementById("tech-home-view").innerHTML=`<div class="card card-pad" style="margin-top:14px"><div class="empty-state"><strong>Field visit not opened.</strong><br>${ui.escapeHtml(message)}<br><br>Open the specific residence and use the launch button in its Appliance Maintenance section. The field tool will not guess a household or visit.<div class="inline-actions" style="justify-content:center;margin-top:14px"><a class="button" href="admin.html#households">Choose a household</a></div></div></div>`;
    renderHead();
    return;
  }
  renderHome();
})();

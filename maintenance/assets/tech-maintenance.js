(function(){
  const ui=window.WilsonUI, config=window.WILSON_CONFIG;
  let state=WilsonStore.load();
  const params=new URLSearchParams(location.search);
  const requestedVisitId=params.get("visit"), requestedHouseholdId=params.get("household");
  let visitId=requestedVisitId, householdId=requestedHouseholdId, activeAssetId=null;
  let draft=null, autosaveTimer=null, routeError="";
  /* Index of the check currently expanded. The technician sets it; completing a
     check advances it to the next unfinished one, which they can override by
     tapping any other check. */
  let openCheck=0;

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
  /* AGILITY: the technician is the signed-in user (ui.js caches the session);
     the prototype's ?technician= URL parameter is intentionally gone. */
  const technician=()=>(window.WILSON_SESSION_USER&&window.WILSON_SESSION_USER.name)||visit()?.technician||"Wilson technician";
  document.addEventListener("wilson:session",function(){
    document.querySelectorAll(".tech-user-chip").forEach(function(chip){ chip.textContent="Signed in as "+technician(); });
  });

  /*
   * What this visit covers. Delegated to the store, which is the only place
   * that should know.
   *
   * The previous version was a second copy of the store's filter and it
   * disagreed with it: this one returned an empty list for any visit whose
   * category was not "appliance", so an HVAC visit opened with no systems in
   * scope and no way to work it. Two copies of a scoping rule is two answers
   * to the same question.
   */
  const assets=()=>WilsonStore.scopedAssetsForVisit(visit());

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

  /*
   * Tier now comes from WILSON_BRANDS, which is the only implementation.
   *
   * WHAT THIS REPLACED, AND WHY IT MATTERED  (v0.9.30)
   * -------------------------------------------------
   * The version here matched with `b.includes(name)` -- plain substring. Two
   * live consequences, neither of which could ever surface as an error:
   *
   *   "gaggenau".includes("ge")  -> true, so a EUR 25k range scored as mass
   *   "fulgor".includes("lg")    -> true, so Fulgor did too
   *
   * Both then inherited a mass-market expected life, which feeds 25% of the
   * appliance score. The replacement matches whole words only.
   */
  function tierForBrand(brand){
    return window.WILSON_BRANDS ? window.WILSON_BRANDS.tierFor(brand) : "premium";
  }

  /*
   * What the lifespan table needs to know about this appliance: the brand, the
   * text a model-series row can match against, and the product line. Built in
   * one place so the report and the field tool cannot ask with different
   * arguments and get different years.
   */
  function identFor(asset){
    if(!asset) return null;
    return {
      brand: asset.brand || "",
      model: asset.model || "",
      description: asset.description || "",
      line: window.WILSON_BRANDS ? window.WILSON_BRANDS.lineForAsset(asset) : "",
      group: asset.group || "",
      checkpointSet: templateKey(asset),
      /* v0.9.37: outdoor or indoor, resolved the one way. Without it this card
         and the customer's report could disagree about the same machine on the
         same day -- the bug class this whole file keeps guarding against. */
      environment: window.WILSON_ENVIRONMENT ? window.WILSON_ENVIRONMENT.for(asset).id : "indoor"
    };
  }

  /*
   * The house's water, resolved once per visit.
   *
   * A property of the residence, so it is read from the household rather than
   * asked per appliance. Cached on the draft so a re-render does not re-resolve
   * it forty times while a technician taps through a protocol.
   */
  function waterHere(){
    if(!window.WILSON_WATER) return {tested:false,lifeFactor:1};
    const hh=household();
    return window.WILSON_WATER.resolve(hh?hh.waterTest:null);
  }

  /*
   * Expected service life, through the ONE resolver in plan-config.js.
   *
   * This used to read `config.lifecycleMatrix` directly. It now goes through
   * WILSON_WATER.expectedLife so the hard-water adjustment cannot be applied
   * here and forgotten on the report -- and so a dryer never gets adjusted for
   * water it does not use.
   */
  function expectedLifeHere(asset,tier){
    const key=templateKey(asset);
    return window.WILSON_WATER
      ? window.WILSON_WATER.expectedLife(key,tier,waterHere(),identFor(asset))
      : {base:10,adjusted:10,factor:1,applied:false,waterBearing:false,
         basis:{kind:"category",set:key,tier:tier}};
  }

  function expectedYears(asset,tier){
    return expectedLifeHere(asset,tier).adjusted;
  }

  /*
   * WHERE THE EXPECTED LIFE ON THIS CARD CAME FROM.   (v0.9.30)
   *
   * The tier dropdown used to be the only thing that chose it, and its hint said
   * "Defaults from brand". Since brand-and-line rows arrived, the dropdown does
   * NOT choose it for anything Wilson sells -- a Sub-Zero refrigerator is 23
   * years whatever the dropdown says, because there is a row for exactly that
   * brand and that product line.
   *
   * A control that appears to drive a number and does not is worse than no
   * control, so the card now states the source under the figure and the tier
   * label says what tier is actually for: how deep the protocol goes.
   */
  /*
   * v0.9.37: this had its own copy of the provenance wording, and the customer
   * report had none at all. Both now come out of `WILSON_BRANDS.basisSentence`
   * -- one builder, three audiences -- so the technician and the customer
   * cannot be told two different stories about the same figure.
   */
  function expectedLifeSource(asset,tier){
    const life=expectedLifeHere(asset,tier);
    if(!window.WILSON_BRANDS||!window.WILSON_BRANDS.basisSentence) return "";
    return window.WILSON_BRANDS.basisSentence(life.basis,life.adjusted,"tech");
  }

  /* =====================================================================
     THE EQUIPMENT CARD                                        (v0.9.35)
     =====================================================================

     Cayden: "when a tech launches maintenance it should already have the brand
     model serial and age info pre filled. serial tag photo still required. the
     tech needs to be able to easily edit the pre filled info just in case its
     wrong."

     Two buttons, and the difference between them is the whole point. "These
     details are wrong" corrects a record about a machine that has been there all
     along. "This is a different machine" says the machine itself changed, which
     resets the age and CLOSES the trend history -- because readings from the
     Bosch that left are not readings from the Miele that arrived.

     One combined edit button is the natural thing to build and the wrong thing
     to have: it produces a confident decline that never happened, on the screen
     that turns a reading into a call to a customer.
     ================================================================== */

  function detailSourceLine(asset,field){
    const p=(asset.detailProvenance||{})[field];
    if(!p||!p.source) return "";
    if(p.source==="invoice") return "from the Wilson invoice"+(p.ref?" "+p.ref:"");
    if(p.source==="tech") return "corrected in the field"+(p.ref?" by "+p.ref:"");
    if(p.source==="tech_new") return "recorded in the field"+(p.ref?" by "+p.ref:"")+" when the machine was replaced";
    if(p.source==="office") return "keyed by the office";
    if(p.source==="customer") return "as the customer stated";
    return String(p.source);
  }

  /*
   * The guardrail's third surface, in the technician's own wording. It never
   * stops the visit: an appliance Wilson cannot cover still gets looked at and
   * the office still gets told. Cayden's rule was a guardrail all parties can
   * understand, which means the same string here as on the report and the queue
   * card -- from serviceabilityCopy, not written again.
   */
  function serviceabilityFor(asset){
    if(!window.WILSON_BRANDS) return null;
    return window.WILSON_BRANDS.serviceability(asset);
  }

  function equipmentCard(){
    const a=draft.asset||{};
    const known=[a.brand,a.model].filter(Boolean).join(" ");
    const s=serviceabilityFor(a);
    const flag=(s&&s.tech&&s.state!=="ok"&&s.state!=="unstated")
      ? `<p class="tech-equip-flag ${s.state==="not_serviced"?"danger":"warn"}">${ui.escapeHtml(s.tech)}</p>` : "";
    const rows=[["brand","Brand"],["model","Model"],["serial","Serial"]].map(function(pair){
      const value=a[pair[0]]||"";
      const src=detailSourceLine(a,pair[0]);
      return `<div class="tech-equip-row"><span>${pair[1]}</span><strong>${ui.escapeHtml(value||"\u2014")}</strong>${src?`<em>${ui.escapeHtml(src)}</em>`:""}</div>`;
    }).join("");
    const retired=(a.replacedMachines||[]).length
      ? `<p class="tech-equip-retired">Replaced ${(a.replacedMachines||[]).length} time${(a.replacedMachines||[]).length===1?"":"s"} \u00b7 last was ${ui.escapeHtml([a.replacedMachines[a.replacedMachines.length-1].brand,a.replacedMachines[a.replacedMachines.length-1].model].filter(Boolean).join(" ")||"unrecorded")}</p>`
      : "";
    return `<div class="tech-equip-card" id="tech-equip-card">
      <div class="tech-equip-head"><span>On the record</span>${known?"":'<span class="tech-equip-empty">Nothing on file \u2014 capture it here</span>'}</div>
      ${rows}
      ${retired}
      ${flag}
      ${environmentRow(a)}
      <div class="tech-equip-actions">
        <button type="button" class="button ghost small" data-equip-mode="correct">These details are wrong</button>
        <button type="button" class="button ghost small" data-equip-mode="replace">This is a different machine</button>
      </div>
      <div class="tech-equip-form" id="tech-equip-form" hidden></div>
    </div>`;
  }

  /*
   * INDOOR OR OUTDOOR, ON THE CARD.                             (v0.9.37)
   *
   * Cayden: "our tech or office should be able to flag it as outdoor."
   *
   * The technician is the one person who can see the answer, so it is one tap
   * here rather than a form. The line above the buttons says where the current
   * answer came from -- a flag somebody set, the appliance type, or a guess off
   * the area name the customer typed -- because "the customer called this room
   * the Outdoor Kitchen" and "I am standing in front of it in the sun" are
   * different grades of fact and this appliance's expected life turns on which.
   *
   * A grill is not offered the choice: it has nowhere else to be.
   */
  function environmentRow(a){
    if(!window.WILSON_ENVIRONMENT) return "";
    const env=window.WILSON_ENVIRONMENT.for(a);
    /*
     * ONLY WHERE IT CAN CHANGE SOMETHING.
     *
     * Indoor or outdoor moves the expected life on refrigeration and ice, and
     * on nothing else in the product today -- a washer's install location
     * changes no number anywhere. A control that cannot affect an outcome is
     * noise on a phone screen a technician has to scroll through five times.
     *
     * This is not only tidiness. The appliance screen was already at 99% of the
     * four-screen ergonomics budget, so adding this row to every appliance
     * broke it, and the honest fix was to stop showing it where it is
     * meaningless rather than to relax the budget to fit my own addition.
     *
     * An appliance somebody has actually flagged always shows, whatever it is,
     * because a recorded fact should not be invisible.
     */
    const flagged=a.installEnvironment==="indoor"||a.installEnvironment==="outdoor";
    const line=window.WILSON_BRANDS?window.WILSON_BRANDS.lineForAsset(a):"";
    if(!flagged&&!window.WILSON_ENVIRONMENT.lifeSensitive(line)) return "";
    /* A built-in grill has nowhere else to be and nothing to correct. */
    if(env.source==="type") return "";
    const other=env.id==="outdoor"?"indoor":"outdoor";
    /*
     * THE BORING CASE GETS ONE LINE.
     *
     * Indoor-by-default is almost every appliance in almost every house, and
     * the full block cost 121px of a phone screen to say nothing -- enough to
     * push the appliance screen past the four-screen budget the ergonomics test
     * holds it to. It now collapses to a single line with the override beside
     * it, and only an appliance that IS outdoors, or that somebody has flagged,
     * gets the explanation and the buttons.
     */
    if(env.id==="indoor"&&env.source==="default"){
      /* Rendered as one more fact row alongside Brand, Model and Serial --
         because that is what it is -- rather than as a panel of its own. */
      return `<div class="tech-equip-row tech-equip-envrow">
        <span>Installed</span>
        <strong>Indoor</strong>
        <button type="button" class="tech-equip-env-link" data-equip-env="outdoor">It is outdoors</button>
      </div>`;
    }
    return `<div class="tech-equip-env ${env.id}">
      <span>Installed</span>
      <strong>${ui.escapeHtml(env.label)}</strong>
      <em>${ui.escapeHtml(env.why)}</em>
      <div class="tech-equip-env-actions">
        <button type="button" class="button ghost small" data-equip-env="${other}">No — it is ${other}</button>
        ${env.source==="flagged"?'<button type="button" class="button ghost small" data-equip-env="clear">Clear this flag</button>':""}
      </div>
    </div>`;
  }

  function equipmentForm(mode){
    const a=draft.asset||{};
    const replacing=mode==="replace";
    const value=function(field){ return replacing?"":ui.escapeHtml(a[field]||""); };
    return `<div class="tech-equip-editor">
      <p class="tech-equip-lead">${replacing
        ? "A different machine in the same place. Its age starts again and its reading history closes here \u2014 last visit\u2019s numbers belong to the machine that left."
        : "Same machine, wrong record. Everything already measured on it stays."}</p>
      <label>Brand<input type="text" data-equip-field="brand" value="${value("brand")}" placeholder="${replacing?"":"leave blank to keep"}" autocomplete="off"></label>
      <label>Model<input type="text" data-equip-field="model" value="${value("model")}" placeholder="${replacing?"":"leave blank to keep"}" autocomplete="off"></label>
      <label>Serial<input type="text" data-equip-field="serial" value="${value("serial")}" placeholder="${replacing?"":"leave blank to keep"}" autocomplete="off"></label>
      <label>Installed<input type="number" data-equip-field="installYear" min="1970" max="${currentYear()}" value="${replacing?"":ui.escapeHtml(a.installYear||"")}" placeholder="year, if known"></label>
      <div class="tech-equip-flag-live" id="tech-equip-flag-live"></div>
      <div class="tech-equip-actions">
        <button type="button" class="button small" data-equip-save="${mode}">${replacing?"Save as a different machine":"Save correction"}</button>
        <button type="button" class="button ghost small" data-equip-cancel="1">Cancel</button>
      </div>
    </div>`;
  }

  function bindEquipmentCard(){
    const card=document.getElementById("tech-equip-card");
    if(!card) return;
    const form=document.getElementById("tech-equip-form");
    card.querySelectorAll("[data-equip-mode]").forEach(function(button){
      button.onclick=function(){
        form.hidden=false;
        form.innerHTML=equipmentForm(button.dataset.equipMode);
        bindEquipmentForm(button.dataset.equipMode);
        const first=form.querySelector("input");
        if(first) first.focus();
      };
    });
    /* One tap, applied straight away. There is no form to fill in: the
       technician is looking at the answer. */
    card.querySelectorAll("[data-equip-env]").forEach(function(button){
      button.onclick=function(){
        const wanted=button.dataset.equipEnv;
        const res=WilsonStore.setAssetEnvironment({
          assetId: draft.asset.id,
          environment: wanted==="clear" ? null : wanted,
          source: "tech",
          by: technician()
        });
        if(!res||!res.ok){ ui.toast("Not recorded",(res&&res.message)||"Could not record that."); return; }
        /* The draft carries its own copy of the appliance, and the score it is
           showing was computed from it. Refresh both or the card says outdoor
           while the expected life beside it is still the indoor one. */
        const fresh=(WilsonStore.load().assets||[]).find(function(x){return x.id===draft.asset.id;});
        if(fresh) draft.asset=fresh;
        refreshEquipmentCard();
        refreshLiveMetrics();
        scheduleAutosave();
        ui.toast("Install location recorded","This appliance is now on the record as installed "+res.environment.id+".");
      };
    });
  }

  /* Re-render the card in place after a one-tap change, and re-bind it. */
  function refreshEquipmentCard(){
    const card=document.getElementById("tech-equip-card");
    if(!card) return;
    card.outerHTML=equipmentCard();
    bindEquipmentCard();
  }

  function bindEquipmentForm(mode){
    const form=document.getElementById("tech-equip-form");
    const live=document.getElementById("tech-equip-flag-live");
    const brand=form.querySelector('[data-equip-field="brand"]');
    /* The guardrail runs as the technician types, so a brand Wilson does not
       service is known before the visit is written up rather than after. */
    function paintFlag(){
      const s=window.WILSON_BRANDS?window.WILSON_BRANDS.serviceability({brand:brand.value,group:draft.asset.group,checkpointSet:draft.asset.checkpointSet}):null;
      live.innerHTML=(s&&s.tech&&s.state!=="ok"&&s.state!=="unstated")
        ? `<p class="tech-equip-flag ${s.state==="not_serviced"?"danger":"warn"}">${ui.escapeHtml(s.tech)}</p>` : "";
    }
    brand.oninput=paintFlag;
    paintFlag();
    form.querySelector("[data-equip-cancel]").onclick=function(){ form.hidden=true; form.innerHTML=""; };
    form.querySelector("[data-equip-save]").onclick=function(){
      const details={};
      form.querySelectorAll("[data-equip-field]").forEach(function(input){
        details[input.dataset.equipField]=input.value;
      });
      const out=mode==="replace"
        ? WilsonStore.replaceAssetMachine({assetId:draft.assetId,details:details,technician:technician()})
        : WilsonStore.correctAssetDetails({assetId:draft.assetId,details:details,technician:technician()});
      if(!out.ok){ ui.toast("Not saved",out.message||"Something went wrong."); return; }
      /*
       * The draft carries its own copy of the asset, so it has to be refreshed
       * or the card would keep showing the machine that left. Tier and expected
       * life are re-derived too -- a different brand is a different expected
       * life, and the score depends on it.
       */
      draft.asset=out.asset;
      draft.tier=tierForBrand(out.asset.brand);
      if(mode==="replace"){
        /*
         * `draft.age` is AGE IN YEARS, not an install year -- the store's
         * applyFieldAge derives the year back out of it as
         * `currentYear - age`. Assigning the install year here set a
         * refrigerator's age to 2024 years, and the next autosave wrote its
         * install year back as the year 2. The replacement itself was correct;
         * the autosave that followed undid it.
         */
        const installed=Number(out.asset.installYear);
        draft.age=installed?Math.max(0,currentYear()-installed):"";
        draft.installYearPicked=installed||null;
        draft.ageSource=out.asset.ageSource||"unknown";
        draft.ageDecade=null;
        draft.ageUnknownAck=false;
      }
      scheduleAutosave();
      ui.toast(mode==="replace"?"Different machine recorded":"Details corrected",
        mode==="replace"
          ? "Reading history closed. This visit is the first on the new machine."
          : "The record now matches what you are looking at.");
      renderAsset();
    };
  }

  function lifecycleStage(age,expected){
    /* An unestablished age has no ratio. `Number(age||0)` made it 0% used --
       a brand-new appliance -- which is the opposite of not knowing. */
    if(age===null||age===undefined||age==="") return {label:"",ratio:0};
    const ratio=expected>0?Math.max(0,Number(age))/expected:0;
    const band=(config.lifecycleStages||[]).find(item=>ratio<Number(item.maxRatio));
    return {label:band?band.label:"Replacement Planning",ratio};
  }

  /*
   * Icon comes from the appliance's own category in config. It used to come from
   * a hardcoded protocol->icon map, which silently fell back to the refrigerator
   * icon for anything the map had not been updated for -- an outdoor grill drew
   * a refrigerator. The protocol map remains only as a second fallback for
   * assets with no recognisable category, such as seeded HVAC rows.
   */
  function iconFor(asset){
    const categoryId=asset?.customerCategory||asset?.containerCategory||asset?.type;
    const category=(config.customerApplianceCategories||[]).find(c=>c.id===categoryId);
    if(category?.icon) return `assets/appliance-icons/${category.icon}`;
    const map={refrigerator:"refrigeration.svg",icemaker:"ice_maker.svg",dishwasher:"dishwasher.svg",washer:"washer.svg",laundry:"laundry_center.svg",dryer:"dryer.svg",ventilation:"ventilation.svg",microwave:"microwave.svg",cooking:"range.svg",outdoor_grill:"outdoor_grill.svg",generic:"refrigeration.svg"};
    return `assets/appliance-icons/${map[templateKey(asset)]||"refrigeration.svg"}`;
  }

  /*
   * Any category carrying a scopeNote gets it in front of the technician too.
   * Grills are the case that matters: every other protocol's condition check
   * implies cleaning, so a tech working from habit would clean a grill Wilson
   * has told the customer it will never clean.
   */
  function scopeBanner(){
    const category=(config.customerApplianceCategories||[]).find(c=>c.id===draft.asset?.customerCategory
      || c.id===draft.asset?.containerCategory);
    if(!category||!category.scopeNote) return "";
    return `<div class="tech-scope-banner"><span>!</span><div><strong>Limited scope — ${ui.escapeHtml(category.label)}</strong><small>${ui.escapeHtml(category.scopeNote)}</small></div></div>`;
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

  /* Where this appliance's age came from, resolved through the one shared
     rule in plan-config so the field tool, the report and the compiled review
     cannot disagree about it. */
  function ageInfo(){
    return window.WILSON_AGE.resolve(draft.asset, draft.age, draft.ageSource);
  }

  /* True when this asset is scored by the HVAC engine rather than by the
     appliance vitals mean. Kept as one predicate so the two paths cannot drift. */
  function isHvac(){ return String((draft.asset||{}).group||"").toLowerCase()==="hvac"; }

  /*
   * The nameplate readings entered on this visit, merged over whatever is
   * already on the asset record. A plate read once should not have to be read
   * again every visit, but a technician correcting it must win.
   */
  function designProfile(){
    return Object.assign({}, (draft.asset||{}).design||{}, draft.design||{});
  }

  /*
   * HVAC scoring, which is a different model from the appliance one and
   * deliberately so.
   *
   * The appliance score is a mean of condition ratings blended with age. The
   * HVAC score is delivered performance against the equipment's own nameplate,
   * with NO age term and NO efficiency term -- see the guardrail comment in
   * hvac-performance.js. A 14-SEER system meeting its design scores 100.
   */
  function scoreHvacDraft(){
    const readings={};
    (draft.checks||[]).forEach(c=>{
      Object.keys(c.readings||{}).forEach(k=>{ if(String(c.readings[k]).trim()!=="") readings[k]=c.readings[k]; });
    });
    const ratings={};
    (draft.checks||[]).forEach(c=>{ if(Number(c.rating)>0) ratings[c.id]=Number(c.rating); });

    const design=designProfile();
    const setKey=window.WILSON_PROTOCOL.resolveCheckpointSet(draft.asset);
    const health=window.WILSON_HVAC.scoreHealth({
      readings:readings, design:design, ratings:ratings, checkpointSet:setKey
    });
    const info=ageInfo();
    const horizon=window.WILSON_HVAC.planningHorizon({
      ageYears:info.age, expectedYears:expectedYears(draft.asset,draft.tier),
      ageDocumented:info.documented, health:health
    });

    /*
     * AGE COUNTS ON THE HVAC SIDE TOO  (v0.9.17, owner's call)
     *
     * The reasoning is the customer's, not the salesman's: a fifteen-year-old
     * system scoring 100% understates what the owner is actually in for. Past
     * expected life these systems start having repeat failures, and nickel-and-
     * diming somebody through three summers of $400 calls is a worse outcome
     * than telling them plainly where the system sits.
     *
     * Same weight as the appliance side (25%) and the same formula, so one
     * explanation covers both. Two things are deliberately unchanged:
     *
     *   1. `scoreHealth` STILL knows nothing about age. The blend happens here,
     *      above it, so the measured-performance number stays a pure
     *      measurement -- and the report prints it beside the total.
     *   2. EFFICIENCY IS STILL 0%. That is the line that matters and it does
     *      not move: age is a physical predictor of failure, a SEER rating is a
     *      market comparison. A 14 SEER system meeting its own design still
     *      scores exactly what a 24 SEER system meeting its design scores.
     */
    const hvacExpected=expectedYears(draft.asset,draft.tier);
    const hvacRatio=info.age!==null?Math.max(0,info.age)/Math.max(1,hvacExpected):null;
    const hvacAgeScore=hvacRatio===null?null:Math.max(0,Math.min(100,Math.round(100-(60*hvacRatio))));
    const hvacVitalWeight=Number(config.reportScoring.vitalWeight??0.75);
    const hvacAgeWeight=Number(config.reportScoring.ageWeight??0.25);
    const hvacOverall=!health.available
      ? null
      : (hvacAgeScore===null||hvacAgeWeight<=0
          ? health.score
          : Math.round(health.score*hvacVitalWeight+hvacAgeScore*hvacAgeWeight));

    return {
      hvac:true,
      health:health,
      horizon:horizon,
      derived:window.WILSON_HVAC.derivedFor(readings,design,setKey),
      efficiency:window.WILSON_HVAC.efficiencyNote(design),
      missingPlate:window.WILSON_HVAC.missingPlateData(design),
      /* Presented like the appliance score so the shared UI can render either,
         but `overall` is null when coverage is too thin to publish a number. */
      overall:hvacOverall,
      /* The reason travels with the refusal, so the report can print WHY there
         is no number instead of printing a zero. */
      scoreReason:health.available?"":(health.reason||""),
      vital:health.available?health.score:null,
      grade:hvacOverall===null?"\u2013":(config.reportScoring.gradeBands.find(b=>hvacOverall>=b.min)||config.reportScoring.gradeBands.at(-1)).grade,
      condition:hvacOverall===null?"Not scored":(config.reportScoring.gradeBands.find(b=>hvacOverall>=b.min)||config.reportScoring.gradeBands.at(-1)).label,
      expected:expectedYears(draft.asset,draft.tier),
      dated:info.age!==null,
      age:info.age,
      ageSource:info.source.id,
      ageSourceLabel:info.source.label,
      ageDocumented:info.documented,
      ageScore:hvacAgeScore,
      lifeStage:horizon.horizon.label,
      lifeRatio:info.age!==null?Math.min(1,info.age/Math.max(1,expectedYears(draft.asset,draft.tier))):0
    };
  }

  function scoreDraft(){
    if(isHvac()) return scoreHvacDraft();
    /*
     * Only checks whose answers are ALLOWED to score do.
     *
     * Before v0.9.17 every check averaged into the health score, which meant
     * "Maintenance clean cycle" -- work Wilson performed -- lifted the
     * customer's number, and an evaporator frost pattern (one tech's 4 is
     * another's 3) carried the same weight as a compartment temperature. The
     * rule now lives in WILSON_ANSWERS.scorable, in one place, so the field
     * preview, the stored score, the report and the database cannot disagree
     * about which checks are health and which are work.
     */
    const setKey=window.WILSON_PROTOCOL.resolveCheckpointSet(draft.asset);
    const scorable=window.WILSON_ANSWERS.scorable(setKey,draft.checks);
    const checks=scorable.filter(c=>isDone(c));
    /*
     * NOTHING MEASURED IS NOT A SCORE OF ZERO.
     *
     * `avg` used to fall back to 0 on an empty list, which made vitals 0, and
     * the age term then carried the whole number: opening a fifteen-year-old
     * refrigerator before touching a single check showed "16 · F". The
     * technician had measured nothing, and the tool had already graded the
     * appliance an F -- exactly the invented number this project exists not to
     * print. The same rule the age term already follows applies here: no
     * measurement, no score, and the caption says which it is.
     */
    const measured=checks.length;
    const vital=measured?Math.round((checks.reduce((sum,c)=>sum+Number(c.rating||0),0)/measured)*20):null;
    const exp=expectedYears(draft.asset,draft.tier);
    const info=ageInfo();

    /*
     * No age, no age score.
     *
     * This used to read `Number(draft.age||0)`, so a blank age became age zero
     * -- a ratio of 0, an age score of 100, and a live preview that showed a
     * thirty-year-old appliance as brand new until the technician typed
     * something. The age term now drops out entirely and the overall IS the
     * measured condition, which is the honest answer to "how is it doing" when
     * nobody knows how old it is.
     */
    const dated=info.age!==null;
    const ratio=dated?Math.max(0,info.age)/exp:null;
    const ageScore=dated?Math.max(0,Math.min(100,Math.round(100-(60*ratio)))):null;
    /* Age counts at its configured weight, and `ageWeight: 0` is still handled
       -- it drops the term rather than multiplying by zero and calling the
       result a blend. */
    const vitalWeight=Number(config.reportScoring.vitalWeight??0.75), ageWeight=Number(config.reportScoring.ageWeight??0.25);
    const overall=vital===null?null
      :((dated&&ageWeight>0)?Math.round(vital*vitalWeight+ageScore*ageWeight):vital);
    const band=overall===null?null:(config.reportScoring.gradeBands.find(b=>overall>=b.min)||config.reportScoring.gradeBands.at(-1));
    const life=dated?lifecycleStage(info.age,exp):{label:"",ratio:0};
    return {vital,ageScore,overall,
            grade:band?band.grade:"–",
            condition:band?band.label:"Not scored yet",
            measured,scorableTotal:scorable.length,
            expected:exp,
            lifeStage:life.label,lifeRatio:life.ratio,age:info.age,dated,
            ageSource:info.source.id,ageSourceLabel:info.source.label,ageDocumented:info.documented};
  }

  function statusFor(asset){
    const inspection=inspectionFor(asset.id);
    if(!inspection) return {key:"not-started",label:"Not started",action:"Start",attention:false,started:false,complete:false};
    const checks=inspection.checks||[];
    const performed=checks.filter(c=>isDone(c)).length;
    /*
     * Read through checkOutcome, which is the one place that knows a missing
     * rating is not a rating of zero. This filter was `Number(c.rating) <= 2`,
     * so every answered observation -- a door seal called Good -- put its whole
     * appliance on the follow-up list. An observation CAN still raise a finding
     * (a torn door boot is not cosmetic); it does so by saying "needs
     * attention", not by having no score.
     */
    const outcomes=checks.map(c=>({check:c, out:checkOutcome(c)}));
    const actionChecks=outcomes.filter(o=>o.out.state==="attention").map(o=>o.check);
    const watchChecks=outcomes.filter(o=>o.out.state==="watch").map(o=>o.check);
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

  /*
   * THE HOUSE'S WATER -- asked once, on the visit screen.
   *
   * Not a checkpoint. Cayden: "house water is a MAJOR factor" -- and it is a
   * factor of the HOUSE, so asking it per appliance would be asking the same
   * question five times in one kitchen and inviting five answers.
   *
   * ONE NUMBER, TYPED. Cayden, v0.9.22: "it should be a number we input off of
   * test strips. And then our algorithm should determine the multiplier. It
   * shouldn't be something the tech can select."
   *
   * The version before this had the technician tap a band -- which is tapping a
   * multiplier, the exact judgement call the rest of this tool exists to take
   * off them. A strip gives a number, so the card takes a number, on the same
   * keypad every other measurement in the tool uses.
   *
   * The softener question went with the band picker. The strip is read at a tap,
   * downstream of any softener, so a working unit already shows up as a soft
   * reading -- asking on top of that was asking the same question twice.
   */
  function waterCard(){
    if(!window.WILSON_WATER) return "";
    const hh=household();
    const water=waterHere();

    const head=water.tested
      ? `<div class="tech-water-known">
          <span>House water</span>
          <strong>${water.gpg} gpg</strong>
          <em>${ui.escapeHtml(water.band.label)} &middot; tested ${ui.escapeHtml(hh.waterTest.testedOn||"")}</em>
        </div>`
      : `<p class="tech-water-ask">Dip a hardness strip at an <strong>inside tap</strong> and type what it reads in grains per gallon. One test for the whole residence, once per visit.</p>`;

    /* Why an inside tap, on the card rather than in a training doc: an outside
       hose bib is often plumbed upstream of the softener, so a reading taken
       there describes the street rather than the house. It is the one way this
       measurement can be quietly wrong, and it costs a line to prevent. */
    const where=water.tested
      ? `<p class="tech-water-effect">Read at an inside tap. A hose bib is often upstream of the softener and reads the street, not the house.</p>`
      : "";

    const effect=water.tested&&Number(water.lifeFactor)<1
      ? `<p class="tech-water-effect"><strong>${ui.escapeHtml(water.band.plain)}.</strong>
         Applied to water-using appliances only, and only to their expected service life &mdash;
         never to what you measured today. A dishwasher rated 12 years here is treated as
         ${(12*water.lifeFactor).toFixed(1)} years.</p>`
      : water.tested
        ? `<p class="tech-water-effect"><strong>No scale adjustment.</strong> At this hardness nothing is deducted from any appliance's expected life.</p>`
        : "";

    return `<section class="tech-water-card" id="tech-water">
      <div class="tech-water-head"><strong>Water at this residence</strong>
        <small>One test for the whole house. It changes how long water-using appliances are expected to last, never their condition score.</small></div>
      ${head}
      <button type="button" class="tech-water-enter" data-water-exact="1">
        ${water.tested?"Change the reading":"Enter the strip reading"}
      </button>
      ${where}
      ${effect}
    </section>`;
  }

  function bindWaterCard(){
    const hh=household();
    if(!hh) return;
    const current=hh.waterTest||{};
    const enter=document.querySelector("[data-water-exact]");
    if(enter) enter.onclick=()=>{
      window.WILSON_INPUT.openKeypad({
        title:"Water hardness at this residence",
        unit:"gpg",
        hint:"Grains per gallon, off the strip. Read at an inside tap.",
        value:current.gpg===null||current.gpg===undefined?"":current.gpg,
        onDone:function(value){
          if(String(value).trim()==="") return;
          const res=WilsonStore.saveWaterTest(hh.id,{
            gpg:Number(value), testedBy:technician(), visitId:visitId
          });
          if(!res.ok){ ui.toast("Not recorded",res.message); return; }
          state=WilsonStore.load();
          renderHome();
        }
      });
    };
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

    /*
     * HVAC visits open here now.
     *
     * This used to return an empty state reading "the appliance field tool only
     * opens appliance-maintenance visits -- continue in the existing Wilson HVAC
     * workflow", which was the honest thing to say when there was no HVAC
     * protocol to open. There is one as of v0.9.14, so refusing the visit would
     * now be the tool declining to do work it can do.
     *
     * Anything that is neither still gets an honest refusal rather than a
     * generic three-check protocol.
     */
    const category=String(visit()?.category||"").toLowerCase();
    if(category!=="appliance" && category!=="hvac"){
      host.innerHTML=`<div class="card card-pad" style="margin-top:14px"><div class="empty-state"><strong>This visit type has no field protocol yet.</strong><br>The field tool covers appliance and HVAC maintenance visits.<div class="inline-actions" style="justify-content:center;margin-top:14px"><a class="button" href="admin.html">Back to Maintenance Operations</a></div></div></div>`;
      renderHead();
      return;
    }

    if(!assets().length){
      host.innerHTML=`<div class="card card-pad" style="margin-top:14px"><div class="empty-state"><strong>No equipment is in scope for this visit.</strong><br>Nothing is enrolled under this household for a ${ui.escapeHtml(category)} visit.<div class="inline-actions" style="justify-content:center;margin-top:14px"><a class="button" href="admin.html">Back to Maintenance Operations</a></div></div></div>`;
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
      ${waterCard()}
      ${Object.entries(groups).map(([area,list])=>areaSection(area,list)).join("")}`;
    host.querySelectorAll("[data-open-asset]").forEach(b=>b.addEventListener("click",()=>openAsset(b.dataset.openAsset)));
    bindWaterCard();
    renderHead();
  }

  function freshCheck(template,old,setKey){
    const merged=Object.assign({},template,old||{});
    /* The set the check belongs to, ON the check. isDone and the photo
       requirement resolve the answer through it, and they run from the HOME
       list too -- where there is no draft. Reading `draft.checkpointSet` from
       there was a null dereference that blanked the whole visit page the
       first time a saved inspection existed (v0.9.39's own bug, caught by the
       ergonomics suite before it shipped). */
    merged.setKey=setKey||merged.setKey||"";
    merged.notApplicable=Boolean(old?.notApplicable);
    /*
     * Unrated, not 4. This used to default every check to 4, so a technician who
     * marked a check performed without touching the rating silently filed a
     * "good" score they never gave -- the report flattered the appliance and the
     * 75% condition half of the health score was partly fiction. Starting at 0
     * means a rating only ever appears because someone chose it.
     */
    /*
     * A null rating stays null.
     *
     * `Number(old?.rating||0)` turned an observation's deliberate "no rating"
     * back into 0 on every reload, which is how a door seal called Good showed
     * a bold 0 and flagged its appliance for follow-up. Zero means NOT ANSWERED
     * in this product; an observation has no rating at all, and the difference
     * has to survive being saved and re-opened.
     */
    merged.rating = (old && old.rating === null) ? null : Number(old?.rating||0);
    // Must follow the rating assignment -- it reads it.
    merged.performed=Boolean(old?.performed)||Number(merged.rating)>0||merged.notApplicable||Boolean(old?.selection);
    merged.reading=old?.reading||"";
    merged.readings=Object.assign({},old?.readings||{});
    /* A follow-up an answer demanded -- so far only a stored fault code. */
    merged.detail=old?.detail||"";
    merged.detailRequired=old?.detailRequired||"";
    merged.detailLabel=old?.detailLabel||"";
    merged.observedAttention=Boolean(old?.observedAttention);
    /* The reading fields come from the ANSWER, which is the one place that
       knows them -- the checkpoint template no longer has to carry them. */
    const resolvedAnswer = window.WILSON_ANSWERS.for(setKey, template.id);
    if (resolvedAnswer && resolvedAnswer.readingFields && resolvedAnswer.readingFields.length) {
      merged.readingFields = resolvedAnswer.readingFields;
    }
    /*
     * The answer's KIND, stored on the check.
     *
     * isDone() and statusFor() run for appliances other than the one open on
     * screen -- the whole appliance list goes through them -- so they must not
     * resolve the protocol from `draft`, which is a different appliance or null.
     * Carrying the kind on the record keeps both pure.
     */
    merged.answerKind = (resolvedAnswer && resolvedAnswer.kind) || "scored";
    merged.answerControl = (resolvedAnswer && resolvedAnswer.control) || "rating";
    merged.note=old?.note||"";
    /* `photo` used to be a boolean and the image was discarded. It is now the
       id of a stored photograph, so the evidence survives the visit. */
    merged.photo=old?.photo||"";
    merged.photoName=old?.photoName||"";
    merged.photoPending=false;
    return merged;
  }

  function buildChecks(asset,saved,key){
    const templates=config.checkpointSets[key]||config.checkpointSets.generic;
    const oldById={};
    (saved?.checks||[]).forEach(c=>{oldById[c.id]=c;});
    return templates.map(t=>freshCheck(t,oldById[t.id],key));
  }

  /*
   * THE PHONE'S BACK GESTURE.                                   (v0.9.39)
   *
   * Cayden: "if tech clicks back while working on a specific appliance, make
   * sure it goes back to the landing page for that visit in the field tool and
   * not all the way back to the customer profile."
   *
   * The tool is one page with in-memory view state, so the browser's back
   * button knew nothing about the appliance screen and left the page entirely
   * -- on a phone, the single most natural gesture threw the technician out of
   * the visit. Opening an appliance now pushes a history entry, and popping it
   * saves the draft and returns to the visit landing page.
   *
   * Back on the landing page itself still leaves the tool, which is what back
   * should do when there is nothing further in to come back from.
   */
  let assetHistoryArmed=false;
  function armAssetHistory(){
    if(!assetHistoryArmed){
      window.addEventListener("popstate",function(event){
        if(activeAssetId&&event.state&&event.state.wilsonView!=="asset"){
          silentSave();
          activeAssetId=null;
          renderHome();
          window.scrollTo({top:0,behavior:"auto"});
        }
      });
      /* Name the state the tool starts in, so the first pop has something to
         land on rather than leaving the page. */
      if(!(window.history.state&&window.history.state.wilsonView)){
        window.history.replaceState({wilsonView:"home"},"");
      }
      assetHistoryArmed=true;
    }
    if(!(window.history.state&&window.history.state.wilsonView==="asset")){
      window.history.pushState({wilsonView:"asset"},"");
    }
  }
  /* The on-page back button and the browser's must do the same thing, through
     the same history entry -- two exits that disagree about where "back" goes
     is this bug wearing a different hat. */
  function closeAssetView(){
    if(window.history.state&&window.history.state.wilsonView==="asset"){
      window.history.back();
      return;
    }
    silentSave();activeAssetId=null;renderHome();window.scrollTo({top:0,behavior:"smooth"});
  }

  /*
   * READING DEFAULTS.                                            (v0.9.41)
   *
   * A reading field can declare `defaultValue` in config -- the oven set
   * point is the case ("it should default to 350. we expect the tech to set
   * to 350" -- Cayden). Fills only an EMPTY field on a fresh draft; a number
   * the technician typed is never touched, and the field stays editable for
   * the odd cavity that cannot hold the standard.
   *
   * This replaced v0.9.40's Guardian prefill: Cayden killed the field temp
   * readout entirely ("the tech shouldn't have to do anything here"), so
   * enrolled units now get the passthrough card below instead of a prefilled
   * check, and the compartment-temp check itself left the protocol.
   */
  function applyReadingDefaults(checks){
    checks.forEach(function(check){
      const a=answerFor(check);
      ((a&&a.readingFields)||[]).forEach(function(f){
        if(f.defaultValue===undefined||f.defaultValue===null) return;
        check.readings=check.readings||{};
        if(String(check.readings[f.key]??"").trim()==="") check.readings[f.key]=String(f.defaultValue);
      });
    });
  }

  /*
   * THE GUARDIAN PASSTHROUGH.                                    (v0.9.41)
   *
   * Cayden: "there should just be a passthrough to the health reports with
   * their logged temp data if they are enrolled in the wilson guardian add on
   * service. the tech shouldn't have to do anything here."
   *
   * So for an enrolled unit the visit page carries one quiet card, not a
   * task: what the sensor says right now, and the promise that the logged
   * series lands on the health report by itself. Nothing on it is tappable
   * and nothing on it gates completion.
   */
  function guardianPassthroughCard(){
    const asset=draft&&draft.asset;
    if(!window.WILSON_TEMPWATCH_SIM||!asset||!asset.tempMonitoringOptIn) return "";
    const tm=config.tempMonitoring||{};
    /* v0.9.47: one line per SENSOR -- a column watching both compartments
       shows both probes' current story. */
    const rows=window.WILSON_TEMPWATCH_SIM.forAssetSensors
      ? window.WILSON_TEMPWATCH_SIM.forAssetSensors(asset,null)
      : [window.WILSON_TEMPWATCH_SIM.forAsset(asset,null)];
    const bits=rows.map(function(row){
      const latest=row.points[row.points.length-1];
      const label=row.compartmentLabel?row.compartmentLabel+" ":"";
      return label+(latest?latest.value+"°F now":"no data")+(row.stats&&row.stats.inBandPct!==null?", "+row.stats.inBandPct+"% in band":"");
    });
    return `<div class="tech-guardian-note passthrough">◉ <strong>${ui.escapeHtml(tm.serviceName||"Refrigeration Guardian")}</strong> — ${rows.length===1?"compartment temps stream from this unit's sensor":rows.length+" sensors stream this unit's compartment temps"}${bits.length?" ("+ui.escapeHtml(bits.join(" · "))+")":""}. The logged data goes onto the health report automatically — nothing to record here.</div>`;
  }

  function openAsset(id){
    activeAssetId=id;
    armAssetHistory();
    const asset=assets().find(a=>a.id===id), saved=WilsonStore.getTechInspection(visitId,id), key=templateKey(asset);
    /* Age is pre-filled from the install year on the asset -- which the invoice
       importer now supplies -- and carries that source with it, so a documented
       age is never silently relabelled as a technician's guess. */
    const seeded=window.WILSON_AGE.resolve(asset, null, null);
    draft=saved?JSON.parse(JSON.stringify(saved)):{asset,visitId,assetId:id,householdId:household().id,technician:technician(),age:seeded.age===null?"":seeded.age,ageSource:seeded.source.id,tier:tierForBrand(asset.brand),serialPhoto:false,serialPhotoName:"",checks:[],complete:false};
    draft.asset=asset;
    draft.technician=technician();
    /* The protocol this inspection was taken against, stored ON the record.
       The report has to know which protocol produced a check in order to know
       what kind of answer it was, and re-deriving it later from an asset that
       may since have been reclassified would be a different answer. */
    draft.checkpointSet=key;
    draft.checks=buildChecks(asset,saved,key);
    applyReadingDefaults(draft.checks);
    draft.maintenanceDone=Array.isArray(draft.maintenanceDone)?draft.maintenanceDone:[];
    if(!draft.tier) draft.tier=tierForBrand(asset.brand);
    if(draft.age===undefined||draft.age===null) draft.age="";
    if(!draft.ageSource) draft.ageSource=window.WILSON_AGE.resolve(draft.asset,null,null).source.id;
    // Resume where the work actually stopped rather than at check 1.
    openCheck=draft.checks.findIndex(c=>!isDone(c));
    if(openCheck<0) openCheck=-1;
    renderAsset();
    window.scrollTo({top:0,behavior:"smooth"});
  }

  /* v0.9.41: condenserDerived (the fridge TD readout) is gone with its
     readings -- Cayden: "still asking for condenser temps. eliminate those."
     Appliance derived values (dryer rise, oven delta, microwave rise) render
     through WILSON_ANSWERS' derivedLine; HVAC has its own machinery. */
  function readingControls(check,index){
    if(Array.isArray(check.readingFields)&&check.readingFields.length){
      /* A <form> rather than a <div>: iOS Safari only offers its
         Next / Previous keyboard accessory inside a form, and without it every
         field in an eleven-reading HVAC check costs a dismiss-keyboard and a
         re-tap. onsubmit is neutered because there is nothing to submit. */
      return `<form class="tech-reading-fields" onsubmit="return false">${check.readingFields.map(field=>`<div class="field"><label for="reading-${index}-${ui.escapeHtml(field.key)}">${ui.escapeHtml(field.label)}${field.required?' <span class="hint">Required</span>':''}</label><div class="input-unit-wrap"><input id="reading-${index}-${ui.escapeHtml(field.key)}" type="number" inputmode="decimal" step="0.1" data-reading-key="${index}:${ui.escapeHtml(field.key)}" value="${ui.escapeHtml(check.readings?.[field.key]??"")}" placeholder="${ui.escapeHtml(field.placeholder||"Reading")}">${field.unit?`<span>${ui.escapeHtml(field.unit)}</span>`:""}</div></div>`).join("")}</form>`;
    }
    /* The code already knows this is a number when the check carries a unit
       -- it says so in the placeholder -- and was still serving an alphabetic
       keyboard for it. */
    const numeric=Boolean(check.unit);
    return `<div class="field"><label for="reading-${index}">${ui.escapeHtml(check.readingLabel||"Reading / result")}</label><input id="reading-${index}" ${numeric?'inputmode="decimal"':""} data-reading="${index}" value="${ui.escapeHtml(check.reading||"")}" placeholder="${ui.escapeHtml(check.unit?"Enter reading in "+check.unit:"Quick result")}"></div>`;
  }

  function filterBanner(){
    if(templateKey(draft.asset)!=="refrigerator") return "";
    const f=refrigerationFilterStatus(draft.asset);
    return `<div class="tech-filter-status ${f.active?"active":""}"><span>F</span><div><strong>${ui.escapeHtml(f.label)}</strong><small>${ui.escapeHtml(f.detail)}</small></div></div>`;
  }

  /*
   * WHAT STATE IS THIS CHECK IN?
   *
   * One function, because there were three copies of this arithmetic and every
   * one of them read a missing rating as a rating of zero. `Number(null)` is 0,
   * 0 is <= 2, and <= 2 meant "needs follow-up" -- so choosing "Good" on a door
   * seal painted the card red, printed a bold 0 in its pill, and flagged the
   * whole appliance for follow-up. The rating is only consulted when there IS
   * one; an answer without a rating is judged by what was actually chosen.
   */
  function hasRating(check){
    return check.rating !== null && check.rating !== undefined && Number(check.rating) > 0;
  }

  function checkOutcome(check){
    if(check.notApplicable) return {state:"na", label:"Not applicable", pill:"Not applicable"};
    if(!isDone(check)){
      /* An answer chosen but still owing its detail is not "not started" -- say
         which of the two it is, or a technician re-taps a question they already
         answered looking for what is missing. */
      if(check.detailRequired && String(check.detail||"").trim()==="")
        return {state:"needs-detail", label:"Needs the code", pill:"Needs the code"};
      if(check.noteRequired && String(check.note||"").trim()==="")
        return {state:"needs-detail", label:"Needs the reason", pill:"Needs the reason"};
      if(checkPhotoRequired(check) && !check.photo)
        return {state:"needs-detail", label:"Needs the photo", pill:"Needs the photo"};
      return {state:"todo", label:"Not started", pill:"Not started"};
    }
    if(hasRating(check)){
      /* v0.9.39: the pill says the verdict word, not a number -- the number
         is published on the button that was tapped. */
      const r=Number(check.rating);
      if(r<=2) return {state:"attention", label:"Fail", pill:"Fail"};
      if(r===3) return {state:"watch", label:"Cause for concern", pill:"Concern"};
      return {state:"ok", label:"Pass", pill:"Pass"};
    }
    /* No rating: an observation, a trend reading, or a count. The pill shows
       what was recorded rather than a score it never had. */
    if(check.observedAttention)
      return {state:"attention", label:"Needs attention", pill:check.selectionLabel||"Needs attention"};
    if(check.selection)
      return {state:"recorded", label:check.selectionResult||"Recorded", pill:check.selectionLabel||"Recorded"};
    if(check.count!==null&&check.count!==undefined&&check.countOf)
      return {state:"recorded", label:"Recorded", pill:check.count+" of "+check.countOf};
    return {state:"recorded", label:"Recorded", pill:"Recorded"};
  }

  const OUTCOME_CLASS = {
    na:"attention-na", todo:"", "needs-detail":"attention-watch",
    attention:"attention-action", watch:"attention-watch", ok:"done", recorded:"done"
  };

  function checkStateClass(check){ return OUTCOME_CLASS[checkOutcome(check).state] || ""; }
  function checkStateLabel(check){ return checkOutcome(check).label; }

  function ratingQuickButtons(check,index){
    const labels={1:"Poor",2:"Concern",3:"Monitor",4:"Good",5:"Excellent"};
    const classes={1:"poor",2:"concern",3:"monitor",4:"good",5:"excellent"};
    /*
     * Tapping a rating IS the completion action. The separate "Mark performed"
     * checkbox cost one tap per check -- five per appliance, fifty on a ten
     * appliance visit -- and carried no information the rating did not.
     *
     * N/A replaces the one thing the checkbox could express that a rating
     * cannot: a check that genuinely does not apply to this unit (a leak check
     * on a charcoal grill, a second compartment on a single-zone column).
     * Without it, "not performed" and "not applicable" would be the same state
     * and readiness gating could never tell a skipped check from an absent one.
     */
    return `<div class="tech-quick-rating five" role="group" aria-label="Rate ${ui.escapeHtml(check.name)} from 1 to 5">${[1,2,3,4,5].map(r=>`<button type="button" data-quick-rate="${index}:${r}" class="${classes[r]} ${Number(check.rating)===r&&!check.notApplicable?"selected":""}" aria-pressed="${Number(check.rating)===r&&!check.notApplicable?"true":"false"}"><b>${r}</b><span>${labels[r]}</span></button>`).join("")}</div>`;
  }

  /*
   * "Not applicable" belongs to the CHECK, not to the rating.
   *
   * It used to be emitted inside the rating control, so the moment a check
   * stopped being answered with a rating -- a category, a count, a pass/fail --
   * it also lost the only way to say "this unit does not have one of those".
   * A heat-pump dryer with no vent, a charcoal grill with no gas connection: if
   * that cannot be said, the alternative is a fabricated answer.
   */
  function naButton(check,index){
    return `<button type="button" class="tech-na-button ${check.notApplicable?"selected":""}" data-na="${index}" aria-pressed="${check.notApplicable?"true":"false"}">${check.notApplicable?"✓ Not applicable to this unit":"Not applicable to this unit"}</button>`;
  }

  /* A check counts as done when it carries a rating or is marked not applicable.
     `performed` is kept on the record for the report and the stored inspection,
     but it is derived here rather than toggled by the technician. */
  /*
   * Answered, in any of the shapes a check can now take.
   *
   * A rating of zero used to be the only definition of "not answered", which
   * stopped working the moment a check could be answered with a category (no
   * rating at all) or a trended number (no rating either). A check is done
   * when it HAS an answer -- and "not applicable" is one.
   */
  function isDone(check){
    /*
     * A check that demanded a follow-up is NOT done until it has it. "Codes
     * present" with no code recorded is the case: it looks answered, and the
     * one fact anybody could act on is missing.
     */
    if(check.detailRequired && String(check.detail||"").trim()==="") return false;
    /* v0.9.39: a concern or fail without its reason is the same shape of
       unfinished -- the verdict exists and the part anybody can act on does
       not. And a check whose protocol demands a photograph (the IR evaporator
       scan) is not done until the image is attached: the photo IS the record. */
    if(check.noteRequired && String(check.note||"").trim()==="") return false;
    if(!check.notApplicable && checkPhotoRequired(check) && !check.photo) return false;
    if(check.notApplicable) return true;
    if(Number(check.rating)>0) return true;
    if(check.selection) return true;                       /* a category or pass/fail */
    if(check.count!==null&&check.count!==undefined&&check.countOf) return true;   /* X of Y */
    if(check.trendOnly&&String(check.reading??"").trim()!=="") return true;       /* a trended number */
    /*
     * A measurement is answered when its numbers are in.
     *
     * The line above only ever looked at `check.reading`, the single-box value.
     * The moment the oven's "actual temp / set point" became two NAMED fields
     * the readings went to `check.readings` instead, and the check could never
     * be completed at all -- both numbers entered, card still reading "Not
     * started". Introduced by the fix for Cayden's first report, and caught by
     * screenshotting the card afterwards rather than by trusting it.
     *
     * Only for answers whose number IS the answer. A check that also wants a
     * rating or a pass/fail is not finished just because its readings are in.
     */
    const fields=(check.readingFields||[]);
    if(fields.length&&(check.answerKind==="trend"||check.answerControl==="keypad")){
      const required=fields.filter(f=>f.required);
      const gate=required.length?required:fields;
      if(gate.every(f=>String((check.readings||{})[f.key]??"").trim()!=="")) return true;
    }
    return false;
  }

  function completionReadiness(){
    const missingChecks=draft.checks.filter(c=>!isDone(c)).map(c=>c.name);
    /* Either a number, or an explicit "cannot be established". Both are
       answers; only silence is not. */
    const ageEntered=String(draft.age??"").trim()!=="" && Number(draft.age)>=0;
    const ageReady=ageEntered||Boolean(draft.ageUnknownAck);
    const missingReadings=[];
    /* Kept apart from the readings so the blocker can say "1 stored code" and
       not "1 required reading" -- a technician reading that goes looking for a
       thermometer. */
    const missingDetails=[];
    /* v0.9.39: the two new ways a check can be owed something. A concern or
       fail owes its reason; the IR scan owes its image. Named per check, for
       the same reason the details are. */
    const missingReasons=[];
    const missingPhotos=[];
    draft.checks.forEach(c=>{
      if(c.notApplicable) return;
      const a=answerFor(c);
      window.WILSON_INPUT.fieldsFor(c,a).filter(f=>f.required).forEach(f=>{
        if(String(c.readings?.[f.key]??"").trim()==="") missingReadings.push(`${c.name}: ${f.label}`);
      });
      /* A demanded follow-up is as missing as a missing reading, and naming it
         is the difference between "5 checks left" and knowing which one. */
      if(c.detailRequired&&String(c.detail||"").trim()==="")
        missingDetails.push(`${c.name}: ${c.detailLabel||"the code"}`);
      if(c.noteRequired&&String(c.note||"").trim()==="")
        missingReasons.push(c.name);
      if(a.photoRequired&&!c.photo)
        missingPhotos.push(c.name);
    });
    return {ready:ageReady&&draft.serialPhoto&&!missingChecks.length&&!missingReadings.length&&!missingDetails.length&&!missingReasons.length&&!missingPhotos.length,
            ageReady,serialReady:Boolean(draft.serialPhoto),missingChecks,missingReadings,missingDetails,missingReasons,missingPhotos};
  }

  function readinessText(){
    const r=completionReadiness();
    if(r.ready) return {title:"Ready to complete",detail:"All required field steps are captured. Completing this appliance will generate its customer health report.",cls:"ready"};
    const bits=[];
    if(!r.ageReady) bits.push("enter age or mark it unknown");
    if(!r.serialReady) bits.push("capture serial tag");
    if(r.missingChecks.length) bits.push(`${r.missingChecks.length} check${r.missingChecks.length===1?"":"s"} remaining`);
    if(r.missingReadings.length) bits.push(`${r.missingReadings.length} required reading${r.missingReadings.length===1?"":"s"}`);
    if(r.missingDetails.length) bits.push(`${r.missingDetails.length} stored code${r.missingDetails.length===1?"":"s"} to record`);
    if(r.missingReasons.length) bits.push(`the reason on ${r.missingReasons.length===1?r.missingReasons[0]:r.missingReasons.length+" flagged checks"}`);
    if(r.missingPhotos.length) bits.push(`required photo: ${r.missingPhotos.join(", ")}`);
    return {title:"Keep going",detail:bits.join(" · "),cls:"pending"};
  }

  /*
   * The line under the age field: what the number is, and who is claiming it.
   *
   * It exists because age moves a quarter of the score and, before v0.9.12,
   * nothing recorded where the number came from -- so a figure typed from
   * memory and a figure off a dated invoice were indistinguishable by the time
   * a customer read the report.
   */
  /* =====================================================================
     AGE, IN TWO TAPS OR NONE AT ALL

     Age is worth 25% of the score, so it has to be entered on every visit --
     and it was the last free-text field in the protocol.

     Three states, in order of how often they should happen:

       1. THE INVOICE ANSWERED IT. Wilson sold most of this equipment, so the
          install year is usually on file. Nothing is asked: the year is shown
          as a fact with the invoice reference beside it. Zero taps.
       2. DECADE, THEN YEAR. Two taps covers a 2-year-old dishwasher and a
          28-year-old Sub-Zero equally, which "buttons for 0-15, type if it is
          older" does not.
       3. DON'T KNOW. A real answer, not an empty field: the report scores
          measured condition only and says the age is unknown.

     The install YEAR is what gets picked, not the age -- a year is what is on
     the plate and on the invoice, and it does not go stale between visits.
     ================================================================== */
  function currentYear(){ return new Date().getFullYear(); }

  function agePicker(){
    const documented=window.WILSON_AGE.resolve(draft.asset,null,null);
    const info=ageInfo();
    const year=currentYear();

    /*
     * AN AGE ALREADY ON THE RECORD IS NOT ASKED AGAIN.
     *
     * This only pre-filled a DOCUMENTED age, so an install year a technician
     * pinned down last visit was thrown back at them as a blank picker every
     * time -- Cayden's report: "when a new tech visit is launched, it should
     * already be filled in instead of prompting for it."
     *
     * The provenance still has to be honest, and this is the part that was
     * silently wrong: the card said "from the Wilson invoice" for whatever
     * source the year came from. Each source now names itself.
     */
    if(documented.installYear){
      const asset=draft.asset||{};
      const src=String(asset.ageSource||"");
      let provenance;
      if(src==="invoice") provenance="from the Wilson invoice";
      else if(asset.ageEstablishedBy) provenance="established in the field by "+ui.escapeHtml(asset.ageEstablishedBy);
      else if(src==="customer") provenance="as the customer stated";
      /* A year a technician typed is a technician's estimate, and the vocabulary
         already has a name for that. It was falling through to "on the appliance
         record, unverified", which understates it -- somebody was standing in
         front of the machine when they entered it. */
      else if(src==="estimate") provenance="a technician estimate";
      else if(src==="tech") provenance="established in the field";
      else provenance="on the appliance record, unverified";
      return `<div class="tech-age-known${src==="invoice"?"":" unverified"}">
        <span>Installed</span><strong>${documented.installYear}</strong>
        <em>${documented.age} year${documented.age===1?"":"s"} old &middot; ${provenance}</em>
        <button type="button" class="tech-age-change" data-age-open="1">Not right?</button>
      </div>`;
    }

    const picked=draft.installYearPicked?Number(draft.installYearPicked):null;
    if(picked){
      const age=Math.max(0,year-picked);
      return `<div class="tech-age-known">
        <span>Installed</span><strong>${picked}</strong>
        <em>${age} year${age===1?"":"s"} old &middot; ${draft.ageSource==="customer"?"customer stated":"your estimate"}</em>
        <button type="button" class="tech-age-change" data-age-open="1">Change</button>
      </div>`;
    }

    if(draft.ageUnknownAck){
      return `<div class="tech-age-known unknown">
        <span>Install date</span><strong>Not established</strong>
        <em>The report will score measured condition only and say so</em>
        <button type="button" class="tech-age-change" data-age-open="1">Change</button>
      </div>`;
    }

    /* Step one: the decade. Step two: the year inside it. */
    const decade=draft.ageDecade?Number(draft.ageDecade):null;
    if(decade===null){
      const decades=[];
      for(let d=Math.floor(year/10)*10; d>=1980; d-=10) decades.push(d);
      return `<div class="tech-age-pick">
        <span class="tech-age-ask">When was it installed?</span>
        <div class="tech-age-row">${decades.map(d=>`<button type="button" class="tech-age-btn" data-age-decade="${d}">${d}s</button>`).join("")}
          <button type="button" class="tech-age-btn older" data-age-decade="1970">Before 1980</button></div>
        <button type="button" class="tech-age-unknown" data-age-unknown="1">Cannot establish it</button>
      </div>`;
    }
    const years=[];
    const top=Math.min(year,decade+9);
    for(let y=top;y>=decade;y-=1) years.push(y);
    return `<div class="tech-age-pick">
      <span class="tech-age-ask">Which year? <button type="button" class="tech-age-back" data-age-decade="reset">change decade</button></span>
      <div class="tech-age-row">${years.map(y=>`<button type="button" class="tech-age-btn" data-age-year="${y}">${y}</button>`).join("")}</div>
      <button type="button" class="tech-age-unknown" data-age-unknown="1">Cannot establish it</button>
    </div>`;
  }

  function ageSourceLine(){
    const documented=window.WILSON_AGE.resolve(draft.asset,null,null);
    const info=ageInfo();
    const bits=[];
    if(info.documented && documented.installYear){
      bits.push(`<strong>From the Wilson invoice</strong> installed ${documented.installYear}${draft.asset.ageSourceRef?" · "+ui.escapeHtml(draft.asset.ageSourceRef):""}`);
    } else if(info.age===null){
      bits.push(draft.ageUnknownAck
        ? '<strong>Age not established.</strong> The report will score measured condition only and say the age is unknown.'
        : '<strong>No install date on record.</strong> Pick the year above if you can establish one \u2014 otherwise mark it unknown and the report will score condition only.');
    } else if(info.source.id==="customer"){
      bits.push('<strong>Customer stated.</strong> Recorded as unverified.');
    } else {
      bits.push('<strong>Your estimate.</strong> Recorded as unverified.');
      /* Name the source the record actually carries. This said "The invoice
         says installed X" whatever the source was, so an age a technician
         established last visit came back quoting an invoice that did not
         exist. */
      if(documented.installYear){
        const src=String((draft.asset||{}).ageSource||"");
        const who=(draft.asset||{}).ageEstablishedBy;
        const where=src==="invoice"?"The Wilson invoice says"
          :(who?("The record says "+ui.escapeHtml(who)+" established"):"The appliance record says");
        bits.push(`${where} installed ${documented.installYear} (${documented.age} years).`);
      }
    }
    let toggle="";
    if(info.age!==null&&!info.documented){
      toggle=`<button class="tech-age-said" id="tech-age-said" type="button">${info.source.id==="customer"?"Actually my estimate":"Customer told me this"}</button>`;
    } else if(info.age===null){
      /*
       * Completion used to require a number, which on an undated appliance
       * meant the gate itself was demanding a guess -- the tool insisting on
       * data it had no way to get. One tap says so instead, and the report then
       * states it rather than carrying an invented figure.
       */
      toggle=`<button class="tech-age-said" id="tech-age-unknown" type="button">${draft.ageUnknownAck?"Age unknown \u2713":"Age can't be established"}</button>`;
    }
    return bits.join(" ")+toggle;
  }

  function renderAgeSource(){
    const host=document.getElementById("tech-age-source");
    if(!host) return;
    host.innerHTML=ageSourceLine();
    const toggle=document.getElementById("tech-age-said");
    if(toggle) toggle.onclick=()=>{
      draft.ageSource=draft.ageSource==="customer"?"estimate":"customer";
      renderAgeSource();
      refreshLiveMetrics();
      scheduleAutosave();
    };
    const unknown=document.getElementById("tech-age-unknown");
    if(unknown) unknown.onclick=()=>{
      draft.ageUnknownAck=!draft.ageUnknownAck;
      renderAgeSource();
      refreshLiveMetrics();
      scheduleAutosave();
    };
  }

  /*
   * The lifecycle and score captions, in ONE place.
   *
   * They were written twice -- once in the template literal and once in
   * refreshLiveMetrics -- and only the refresh copy learned to handle an
   * appliance with no age. So the first render of an undated appliance said
   * "0% of draft expected life" and "25% lifecycle (null)" until the technician
   * touched something. Two copies of a caption is two chances to be wrong.
   */
  function tierLabelFor(){ return config.lifecycleTiers[draft.tier]?.label||draft.tier; }

  function lifeStageCaption(score){
    if(score.hvac && score.horizon){
      /* The heading above already shows the horizon label, so repeating it here
         printed "Nothing to plan for | ... · Nothing to plan for". This carries
         the numbers instead. */
      return score.horizon.ageKnown
        ? score.horizon.ageYears+" of "+score.expected+" years \u00b7 "+Math.round(score.lifeRatio*100)+"% of draft expected life"
        : "No install date on record \u00b7 no lifecycle figure applied";
    }
    /*
     * If the water shortened this appliance's expected life, SAY SO here.
     *
     * Otherwise a technician reads "12 years" on a luxury dishwasher rated 15
     * and has no way to know why -- and an unexplained number is exactly the
     * kind of thing that makes a tool feel arbitrary. It nearly fooled me while
     * testing: 15 x 0.8 is 12, which is also the premium tier's base figure.
     */
    const life=expectedLifeHere(draft.asset,draft.tier);
    const waterNote=life.applied
      ? " · shortened from "+life.base+"y by this house's water"
      : "";
    return score.dated
      ? Math.round(score.lifeRatio*100)+"% of draft expected life · "+tierLabelFor()+waterNote
      : "No install date on record · "+tierLabelFor()+waterNote;
  }

  /*
   * The heading over the live number.
   *
   * A grade is a claim about the appliance, so it only appears once there is
   * something behind it. "Live health score · F" over a dash was the worst of
   * both: no number, and a letter grade anyway.
   */
  function scoreHeading(score){
    return score.overall===null||score.overall===undefined
      ? "Live health score · not scored yet"
      : "Live health score · "+score.grade;
  }

  function scoreDetailCaption(score){
    /*
     * HVAC says something different, because it IS something different: the
     * number is delivered performance against the nameplate, with no age term
     * and no efficiency term at all. Saying "75% vitals + 25% lifecycle" over
     * an HVAC score would describe a calculation that did not happen.
     */
    if(score.hvac){
      if(!score.health.available){
        return score.health.reason||"Not enough of this system could be evaluated against its design to publish a score.";
      }
      const parts=score.health.scored.map(d=>d.label+" "+d.pct+"%").join(" \u00b7 ");
      const gaps=(score.health.notScored||[]).length;
      const aw=Math.round(Number(config.reportScoring.ageWeight??0.25)*100);
      const vw=100-aw;
      return "Measured against this system's own nameplate. "+parts
        +". Coverage "+score.health.coverage+"%"
        +(gaps?", "+gaps+" dimension"+(gaps===1?"":"s")+" not evaluated":"")
        +". "+(score.dated&&score.ageScore!==null
            ? "Overall is "+vw+"% this measured performance ("+score.vital+") + "+aw+"% age ("+score.ageScore+"), on a draft expected life of "+score.expected+" years."
            : "No install date on record, so no age term is applied.")
        +" The efficiency rating is reported and is not in this number.";
    }
    const vw=Math.round(Number(config.reportScoring.vitalWeight??.75)*100);
    const aw=Math.round(Number(config.reportScoring.ageWeight??.25)*100);
    /*
     * Before anything is measured there is no number to explain, so the caption
     * says what it is waiting for instead of narrating a calculation on zero.
     */
    if(score.vital===null){
      return "No score yet — nothing has been measured on this appliance. "
        +score.scorableTotal+" check"+(score.scorableTotal===1?"":"s")+" on this protocol count toward the score."
        +(score.dated?" Age is known and will carry "+aw+"% of it once there is condition to weigh.":"");
    }
    if(score.measured<score.scorableTotal){
      return (score.dated
          ? vw+"% current vitals ("+score.vital+") + "+aw+"% lifecycle ("+score.ageScore+"). "+score.lifeStage+" · draft expected life "+score.expected+" years."
          : "Measured condition only ("+score.vital+"). No install date on record, so no lifecycle term is applied.")
        +" Based on "+score.measured+" of "+score.scorableTotal+" scoring checks so far.";
    }
    return score.dated
      ? vw+"% current vitals ("+score.vital+") + "+aw+"% lifecycle ("+score.ageScore+"). "+score.lifeStage+" · draft expected life "+score.expected+" years."
      : "Measured condition only ("+score.vital+"). No install date on record, so no lifecycle term is applied.";
  }

  /*
   * The thumbnail container is created when a photo is saved, not only when the
   * section is rendered. Without this the first save showed "✓ Photo saved" and
   * no picture -- the node it would have gone into did not exist yet, so the
   * technician had no way to check what they had just captured.
   */
  function ensureThumb(anchorNode, photoId, wide){
    if(!anchorNode) return null;
    /* AFTER the button row, not inside it. Inside, the thumbnail read as a third
       control -- and a flex-basis of 100% could not push it to its own line
       because max-width clamps the flex base size before the line breaks. */
    const row=anchorNode.closest(".tech-optional-row")||anchorNode;
    const scope=row.parentNode;
    let node=scope.querySelector(':scope > [data-photo-thumb]');
    if(!node){
      node=document.createElement("div");
      node.className="tech-photo-thumb"+(wide?" wide":"");
      row.insertAdjacentElement("afterend",node);
    }
    node.dataset.photoThumb=photoId;
    delete node.dataset.rendered;
    node.innerHTML="";
    return node;
  }

  /*
   * Show the technician what they actually captured.
   *
   * A thumbnail is the only way to catch the two failures that matter in the
   * field: a photograph of a thumb, and a serial plate too blurred to read.
   * Catching either one costs a retake now instead of a return trip later.
   */
  function renderPhotoThumbs(){
    document.querySelectorAll("[data-photo-thumb]").forEach(node=>{
      const id=node.dataset.photoThumb;
      if(!id||node.dataset.rendered==="1") return;
      node.dataset.rendered="1";
      window.WILSON_PHOTOS.url(id).then(src=>{
        if(!src){ node.innerHTML='<span class="tech-photo-missing">Photo not found on this device</span>'; return; }
        const img=document.createElement("img");
        img.src=src; img.alt="Field photograph";
        img.onload=()=>window.URL.revokeObjectURL(src);
        node.innerHTML="";
        node.appendChild(img);
      }).catch(()=>{ node.innerHTML='<span class="tech-photo-missing">Photo could not be read</span>'; });
    });
  }

  /*
   * THE NAMEPLATE CARD.
   *
   * Shown only for HVAC, and it is the mechanism behind the whole scoring
   * principle: every scored target is read off this plate, so a 14-SEER system
   * can score 100 by delivering what a 14-SEER system should deliver.
   *
   * Fields already on the asset record are pre-filled and do not need reading
   * again -- a plate read once stays read. Anything still blank names the
   * dimension it would let us score, because "we could not score static
   * pressure" is more useful to a technician than a silent gap.
   */
  function designCard(score){
    if(!isHvac()) return "";
    const setKey=window.WILSON_PROTOCOL.resolveCheckpointSet(draft.asset);
    const design=designProfile();
    const relevant=(config.hvacDesignProfile||[]).filter(f=>{
      if(setKey==="hvac_furnace") return ["maxEsp","blowerFla","riseRangeLow","riseRangeHigh","ratedAfue"].indexOf(f.key)>=0;
      if(setKey==="hvac_minisplit") return ["ratedTons","condenserRla","refrigerant","ratedSeer"].indexOf(f.key)>=0;
      return ["riseRangeLow","riseRangeHigh","ratedAfue"].indexOf(f.key)<0;
    });
    const missing=relevant.filter(f=>f.scores && !String(design[f.key]??"").trim());
    return `
      <div class="tech-plate-card">
        <div class="tech-plate-head">
          <strong>Nameplate &mdash; what this system is rated to do</strong>
          <span>Every target below is read off the plate, so meeting the design is a full score at any efficiency rating. Read once; it carries to the next visit.</span>
        </div>
        <div class="tech-plate-grid">
          ${relevant.map(f=>`<div class="field"><label>${ui.escapeHtml(f.label)}${f.unit?' <span class="hint">'+ui.escapeHtml(f.unit)+'</span>':''}</label><input data-design="${f.key}" inputmode="${/tons|Cfm|Esp|Rla|Fla|rise|Seer|Afue/i.test(f.key)?"decimal":"text"}" value="${ui.escapeHtml(String(design[f.key]??""))}" placeholder="${f.plate?"From plate":"Select"}"></div>`).join("")}
        </div>
        ${missing.length
          ? `<p class="tech-plate-missing"><strong>Not scored without these:</strong> ${ui.escapeHtml(missing.map(f=>f.label+" ("+(config.hvacScoring.dimensions[f.scores]||{label:f.scores}).label.toLowerCase()+")").join(", "))}. Readings are still recorded either way.</p>`
          : `<p class="tech-plate-complete">Plate data complete. Every dimension can be scored against this system's own design.</p>`}
      </div>`;
  }

  /*
   * Derived readings, live, as the technician enters them.
   *
   * Superheat and subcooling appearing the moment both numbers are in is the
   * single most useful thing this card does: it catches a transposed reading
   * while the gauges are still on the system.
   */
  function derivedCard(score){
    if(!isHvac()||!score.derived||!score.derived.length) return "";
    return `
      <div class="tech-derived-card">
        <span class="tech-derived-label">Derived from your readings</span>
        <div class="tech-derived-grid">
          ${score.derived.map(d=>`<div><strong>${d.value}${ui.escapeHtml(d.unit||"")}</strong><span>${ui.escapeHtml(d.label)}</span></div>`).join("")}
        </div>
      </div>`;
  }

  function refreshLiveMetrics(){
    if(!draft) return;
    const score=scoreDraft();
    const expected=document.getElementById("tech-expected-life"); if(expected) expected.value=score.expected+" years";
    const life=document.getElementById("tech-life-stage-label"); if(life) life.textContent=score.dated?score.lifeStage:"Age unknown";
    const lifeDetail=document.getElementById("tech-life-stage-detail"); if(lifeDetail) lifeDetail.textContent=lifeStageCaption(score);
    /* The source line has to move with the figure. A stale caption saying the
       number is a Sub-Zero refrigeration row, next to a figure that is now a
       category median because the tech changed the tier, is a worse lie than no
       caption. */
    const lifeSource=document.getElementById("tech-life-source");
    if(lifeSource&&draft&&draft.asset) lifeSource.textContent=expectedLifeSource(draft.asset,draft.tier);
    const scoreNumber=document.getElementById("tech-score-number");
    /* An unpublished score is a dash, not the string "null". */
    if(scoreNumber) scoreNumber.textContent=score.overall===null||score.overall===undefined?"\u2013":score.overall;
    const scoreGrade=document.getElementById("tech-score-grade"); if(scoreGrade) scoreGrade.textContent=scoreHeading(score);
    const scoreDetail=document.getElementById("tech-score-detail"); if(scoreDetail) scoreDetail.textContent=scoreDetailCaption(score);
    updateReadiness();
  }

  /* Re-render the protocol list only. Keeps scroll position so opening a check
     does not throw the technician back to the top of the appliance. */
  function renderChecks(opts){
    const y=window.scrollY;
    const host=document.getElementById("tech-checks");
    if(!host) return;
    host.innerHTML=draft.checks.map((c,i)=>checkCard(c,i)).join("");
    bindCheckHandlers();
    /* The thumbnail nodes are rebuilt empty by the line above, and only
       bindAsset and the photo handler used to refill them -- so the first
       rating tap after saving a photo silently blanked the image while the
       button still read "Photo saved". That is the one check on a blurred
       serial plate, so it has to survive every re-render. */
    renderPhotoThumbs();
    window.scrollTo(0,y);
    /* After an auto-advance the next check may sit below the fold. Bring it up
       rather than leaving the technician to hunt for where the form went. */
    if(opts&&opts.revealOpen&&openCheck>=0){
      const card=host.querySelector(`[data-check="${openCheck}"]`);
      if(card){
        const rect=card.getBoundingClientRect();
        if(rect.top<70||rect.bottom>window.innerHeight-90){
          window.scrollTo({top:window.scrollY+rect.top-90,behavior:"smooth"});
        }
      }
    }
  }

  function openNextUnfinished(from){
    const next=draft.checks.findIndex((c,i)=>i>from&&!isDone(c));
    openCheck = next>=0 ? next : draft.checks.findIndex(c=>!isDone(c));
    if(openCheck<0) openCheck=-1;   // everything done: collapse the list
  }

  /* "Serial photo, 3 checks left" -- short enough for a button, specific
     enough to act on without scrolling. */
  function shortBlocker(detail){
    const text=String(detail||"");
    const bits=[];
    if(/serial/i.test(text)) bits.push("serial photo");
    const checks=text.match(/(\d+)\s+check/i);
    if(checks) bits.push(checks[1]+" check"+(checks[1]==="1"?"":"s"));
    const readings=text.match(/(\d+)\s+reading/i);
    if(readings) bits.push(readings[1]+" reading"+(readings[1]==="1"?"":"s"));
    const age=/age/i.test(text);
    if(age) bits.push("age");
    if(!bits.length) return "Still needed: finish the required steps";
    return "Still needed: "+bits.join(", ");
  }

  function el(id){ return document.getElementById(id); }

  function updateCheckVisual(index){
    const check=draft.checks[index], card=document.querySelector(`[data-check="${index}"]`);
    if(!card) return;
    card.classList.remove("done","attention-action","attention-watch","attention-na");
    const outcome=checkOutcome(check);
    const cls=checkStateClass(check); if(cls) card.classList.add(cls);
    /* Same pill as the first render -- the completed state shows what was
       recorded, the unfinished state shows what is still needed. Two code paths
       painting one pill is how it came to show "0". */
    const label=card.querySelector("[data-check-status]");
    if(label){
      label.className=`tech-check-status ${cls||""}`;
      label.textContent=(isDone(check)&&!check.notApplicable)?outcome.pill:outcome.label;
    }
    card.querySelectorAll("[data-quick-rate]").forEach(btn=>{const rating=Number(btn.dataset.quickRate.split(":")[1]), selected=rating===Number(check.rating);btn.classList.toggle("selected",selected);btn.setAttribute("aria-pressed",selected?"true":"false");});
  }

  function updateReadiness(){
    if(!draft) return;
    const r=readinessText(), host=document.getElementById("tech-readiness");
    if(host){host.className=`tech-readiness ${r.cls}`;host.innerHTML=`<span>${r.cls==="ready"?"✓":"→"}</span><div><strong>${r.title}</strong><small>${ui.escapeHtml(r.detail)}</small></div>`;}
    /*
     * The reason has to be ON the button. The readiness panel sits above the
     * sticky action bar in normal flow, so it is only visible at the bottom of
     * the page -- and the "Required steps missing" toast in saveCurrent can
     * never fire, because a disabled button does not raise a click. A
     * technician tapping the greyed button got nothing at all and had to scroll
     * hunting for what was left.
     */
    const done=el("complete-asset");
    if(done){
      const ready=completionReadiness().ready;
      done.disabled=!ready;
      /* The label keeps the word "Complete" in every state -- a button whose
         text is replaced wholesale by an error is a button nobody recognises
         (and the QA suite, which looks for it by name, is a fair proxy for a
         technician doing the same). The reason rides underneath it. */
      done.innerHTML=ready
        ? "Complete &amp; generate report"
        : 'Complete &amp; generate report<small>'+ui.escapeHtml(shortBlocker(r.detail))+'</small>';
    }
    const complete=document.getElementById("complete-asset"); if(complete) complete.disabled=!completionReadiness().ready;
  }

  function draftSnapshot(){
    const score=scoreDraft();
    draft.score=score.overall;
    draft.scoreReason=score.scoreReason||"";
    draft.grade=score.grade;
    draft.condition=score.condition;
    draft.expectedYears=score.expected;
    draft.lifeStage=score.lifeStage;
    draft.ageScore=score.ageScore;
    /* Provenance travels with the snapshot, so the generated report can say
       where its age came from without re-deriving it. */
    draft.ageSource=score.ageSource;
    draft.ageSourceLabel=score.ageSourceLabel;
    draft.ageDocumented=score.ageDocumented;
    draft.ageResolved=score.age;
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

  /*
   * One check open at a time -- but the TECHNICIAN chooses which, never the app.
   * Sequencing the protocol would fight how the work actually happens: what is
   * reachable, what has to warm up or cool down, what the homeowner is standing
   * in front of. So every check stays tappable in any order; only the amount of
   * screen it occupies is managed.
   *
   * Collapsed cards keep their number, name, status and rating visible, so the
   * tech can still see the whole protocol and what is left.
   */
  /*
   * The control for one check, chosen by what the check actually produces.
   *
   * Before v0.9.17 there was one control for everything -- a 1-5 rating -- so
   * a frost pattern, a burner count, a leak check and work Wilson performed
   * were all answered the same way and all scored the same way. What a check
   * IS now decides how it is answered: a category for an observation, a count
   * for something countable, pass/fail for something binary, a number pad for
   * a measurement, and the rating only where a condition judgement genuinely
   * is the answer.
   */
  function answerFor(check){
    const setKey=(check&&check.setKey)
      || (draft&&draft.checkpointSet)
      || (draft&&draft.asset?templateKey(draft.asset):"");
    return window.WILSON_ANSWERS.for(setKey, check.id);
  }

  function checkPhotoRequired(check){
    return Boolean(answerFor(check).photoRequired);
  }

  /*
   * THE LAST THING BEFORE THE BUTTON.                           (v0.9.39)
   *
   * Cayden: "add reminders to end of each appliance health check that reminds
   * the tech to run a cleaning or descale cycle on the appliance if applicable
   * before they move on. dishwasher, icemaker, washing machine for starters."
   *
   * Config-driven (WILSON_CONFIG.cycleReminders), placed between the chips and
   * the readiness panel so it is read at exactly the moment the technician is
   * about to walk away from the machine. When the matching chip is already
   * ticked it collapses to a quiet confirmation instead of nagging.
   */
  function cycleReminder(){
    const reminders=(config.cycleReminders||{});
    const key=draft.checkpointSet||templateKey(draft.asset);
    const reminder=reminders[key];
    if(!reminder) return "";
    const done=Array.isArray(draft.maintenanceDone)&&draft.maintenanceDone.indexOf(reminder.chip)>=0;
    if(done) return `<div class="tech-cycle-reminder done"><span>✓</span><div><strong>${ui.escapeHtml(reminder.doneLabel)}</strong></div></div>`;
    return `<div class="tech-cycle-reminder"><span>↻</span><div><strong>${ui.escapeHtml(reminder.title)}</strong><small>${ui.escapeHtml(reminder.detail)}</small></div></div>`;
  }

  /* The note a concern or fail files: ticked reasons first, own words after.
     One builder, so what gates completion is exactly what reaches the report. */
  function rebuildReason(check){
    const parts=(Array.isArray(check.noteReasons)?check.noteReasons:[]).slice();
    const text=String(check.noteText||"").trim();
    if(text) parts.push(text);
    check.note=parts.join(" — ");
  }

  function answerControls(c,i){
    const a=answerFor(c);
    const body=window.WILSON_INPUT.control(c,i,a);
    const needsRating=a.control==="rating";
    return (a.kind!=="scored"?`<p class="tech-kind-note">${window.WILSON_INPUT.kindBadge(a)} ${ui.escapeHtml(a.kindBlurb)}</p>`:"")+
      body+
      (needsRating?`<div class="tech-rating"><div class="tech-rating-prompt">${a.kind==="maintenance"?"Was it done?":"Rate condition"}</div>${ratingQuickButtons(c,i)}</div>`:"")+
      naButton(c,i);
  }

  function checkCard(c,i){
    const open=openCheck===i;
    const cls=checkStateClass(c);
    const done=isDone(c);
    return `<section class="tech-check-card ${cls} ${open?"open":"collapsed"}" data-check="${i}">
      <button type="button" class="tech-check-head" data-toggle-check="${i}" aria-expanded="${open?"true":"false"}">
        <div class="tech-check-number">${done&&!c.notApplicable?"✓":(c.notApplicable?"–":i+1)}</div>
        <div class="tech-check-title"><strong>${ui.escapeHtml(c.name)}</strong></div>
        <span class="tech-check-status ${cls}" data-check-status>${done&&!c.notApplicable?`<b>${ui.escapeHtml(checkOutcome(c).pill)}</b>`:ui.escapeHtml(checkStateLabel(c))}</span>
      </button>
      ${open?`<div class="tech-check-body">
        ${c.prompt?`<p class="tech-check-prompt">${ui.escapeHtml(c.prompt)}</p>`:""}
        ${c.guidance?`<div class="tech-guidance">${ui.escapeHtml(c.guidance)}</div>`:""}
        <!-- Readings first, rating last. Two reasons, and the second one is
             the important one. (1) Reading top-down, a technician used to rate
             before entering the numbers, which left the check "blocked", so the
             auto-advance never fired and they had to tap the next card open by
             hand. (2) A rating entered before the measurement is a judgement
             formed without it. -->
        ${answerControls(c,i)}
        <!-- v0.9.39: the per-check "+ Note" is gone on Cayden's call ("eliminate
             note under specific health checks and make it a one stop general
             note"). The only note a check carries now is the REQUIRED reason on
             a concern or fail, which renders inside the verdict control. The
             photo stays, and where the protocol demands one it says so. -->
        <div class="tech-optional-row">
          <label class="tech-optional-toggle ${c.photo?"filled":""} ${checkPhotoRequired(c)&&!c.photo?"photo-needed":""}"><span id="photo-label-${i}">${c.photo?"✓ Photo saved":(checkPhotoRequired(c)?"＋ Photo — required":"＋ Photo")}</span><input type="file" accept="image/*" capture="environment" data-photo="${i}" aria-label="Photograph for ${ui.escapeHtml(c.name)}"></label>
          ${checkPhotoRequired(c)&&!c.photo?`<small class="tech-photo-required-hint">Save the IR image to your camera roll, then attach it here.</small>`:""}
        </div>
        ${c.photo?`<div class="tech-photo-thumb" data-photo-thumb="${ui.escapeHtml(c.photo)}"></div>`:""}
      </div>`:""}
    </section>`;
  }


  function bindCheckHandlers(){
    document.querySelectorAll("[data-toggle-check]").forEach(el=>el.onclick=e=>{
      const i=+e.currentTarget.dataset.toggleCheck;
      openCheck = openCheck===i ? -1 : i;      // tapping the open one collapses it
      renderChecks({revealOpen:true});
    });

    /* Rating IS the completion action, and it advances to the next unfinished
       check so the common path is one tap per check with no scrolling. */
    document.querySelectorAll("[data-quick-rate]").forEach(el=>el.onclick=e=>{
      const [idxRaw,ratingRaw]=e.currentTarget.dataset.quickRate.split(":"), i=+idxRaw, rating=+ratingRaw;
      const check=draft.checks[i];
      check.rating=rating;
      check.performed=true;
      check.notApplicable=false;
      const blocked=(check.readingFields||[]).some(f=>f.required&&String(check.readings?.[f.key]??"").trim()==="");
      // Hold the card open when it still owes a required measurement, so the
      // tech is not bounced away from a field they have to fill in.
      if(!blocked) openNextUnfinished(i);
      renderChecks({revealOpen:!blocked}); refreshLiveMetrics(); scheduleAutosave();
    });

    document.querySelectorAll("[data-na]").forEach(el=>el.onclick=e=>{
      const i=+e.currentTarget.dataset.na, check=draft.checks[i];
      check.notApplicable=!check.notApplicable;
      if(check.notApplicable){ check.rating=0; check.performed=true; openNextUnfinished(i); }
      else { check.performed=false; }
      renderChecks({revealOpen:true}); refreshLiveMetrics(); scheduleAutosave();
    });

    /* ---- the tap-only answer controls (v0.9.17) ----
       Each one completes the check and advances, exactly as the rating did, so
       the common path stays one tap per check. */
    document.querySelectorAll("[data-answer-option]").forEach(el=>el.onclick=e=>{
      const [idxRaw,code]=e.currentTarget.dataset.answerOption.split(":"), i=+idxRaw;
      const check=draft.checks[i], a=answerFor(check);
      window.WILSON_INPUT.applyOption(check,a,code);
      /* Do not advance off a check that is not finished. Two ways it can owe
         something: a required reading not taken, or a follow-up the ANSWER
         demanded -- "codes present" owes the code. Advancing past either one
         leaves a check that looks answered and is not. */
      const blocked=window.WILSON_INPUT.fieldsFor(check,a)
                      .some(f=>f.required&&String(check.readings?.[f.key]??"").trim()==="")
                 || Boolean(check.detailRequired&&String(check.detail||"").trim()==="")
                 /* v0.9.39: two more debts. A concern or fail owes its reason,
                    and the IR scan owes its image -- the card stays open with
                    the demand visible rather than advancing past it. */
                 || Boolean(check.noteRequired&&String(check.note||"").trim()==="")
                 || Boolean(a.photoRequired&&!check.photo);
      if(!blocked) openNextUnfinished(i);
      renderChecks({revealOpen:!blocked}); refreshLiveMetrics(); updateReadiness(); scheduleAutosave();
    });

    document.querySelectorAll("[data-answer-total]").forEach(el=>el.onclick=e=>{
      const [idxRaw,totalRaw]=e.currentTarget.dataset.answerTotal.split(":"), i=+idxRaw, total=+totalRaw;
      const check=draft.checks[i];
      check.countOf=total||null;
      /* Changing the total invalidates a count taken against the old one --
         "4 of 6" does not survive becoming "of 4". */
      check.count=null; check.performed=false; check.rating=0;
      renderChecks({revealOpen:true}); refreshLiveMetrics(); scheduleAutosave();
    });

    document.querySelectorAll("[data-answer-count]").forEach(el=>el.onclick=e=>{
      const [idxRaw,countRaw]=e.currentTarget.dataset.answerCount.split(":"), i=+idxRaw;
      const check=draft.checks[i];
      window.WILSON_INPUT.applyCount(check,+countRaw,check.countOf);
      openNextUnfinished(i);
      renderChecks({revealOpen:true}); refreshLiveMetrics(); scheduleAutosave();
    });

    document.querySelectorAll("[data-answer-keypad]").forEach(el=>el.onclick=e=>{
      const [idxRaw,key]=e.currentTarget.dataset.answerKeypad.split(":"), i=+idxRaw;
      const check=draft.checks[i], a=answerFor(check);
      /* The answer resolves the fields -- see WILSON_ANSWERS.for. Reading them
         off the check alone missed every field declared on the answer. */
      const field=window.WILSON_INPUT.fieldsFor(check,a).find(f=>f.key===key)||null;
      const current=field?(check.readings||{})[field.key]:check.reading;
      window.WILSON_INPUT.openKeypad({
        title:(field?field.label:(check.readingLabel||check.name)),
        unit:(field&&field.unit)||check.unit||"",
        target:check.target||"",
        hint:a.kind==="trend"?"Recorded and trended -- no agreed band yet":"",
        value:current,
        onDone:function(value,notMeasured){
          if(field){
            check.readings=check.readings||{};
            check.readings[field.key]=value;
          }
          else { check.reading=value; }
          if(notMeasured&&!field){ check.notApplicable=true; check.performed=true; check.rating=0; }
          /* A trend measurement is complete the moment it has a number: there
             is no rating to wait for, and nothing else to judge it against. */
          if(a.kind==="trend"&&String(value).trim()!==""){ check.performed=true; check.rating=null; check.trendOnly=true; }
          /* v0.9.49, Cayden's field report: "time to boil on a range didn't
             pass to step 6 fan operation automatically." When the reading IS
             the completion (a trend number, or a not-measured waiver), the
             keypad advances exactly as a rating tap does — same debt test as
             the answer options, so a check still owing a required field, a
             reason, or a photo holds its card open instead. */
          const done=Boolean(check.performed)
                  && !window.WILSON_INPUT.fieldsFor(check,a)
                        .some(f=>f.required&&String(check.readings?.[f.key]??"").trim()==="")
                  && !Boolean(check.detailRequired&&String(check.detail||"").trim()==="")
                  && !Boolean(check.noteRequired&&String(check.note||"").trim()==="")
                  && !Boolean(a.photoRequired&&!check.photo);
          if(done) openNextUnfinished(i);
          renderChecks({revealOpen:done}); refreshLiveMetrics(); scheduleAutosave();
        }
      });
    });

    /*
     * The follow-up an answer demanded. Only a stored fault code so far.
     *
     * Same overlay in its letter mode, so there is still no OS keyboard in the
     * protocol -- and the check stays unfinished until this is filled, which is
     * what makes "codes present" mean something on a customer's report.
     */
    document.querySelectorAll("[data-answer-code]").forEach(el=>el.onclick=e=>{
      const i=+e.currentTarget.dataset.answerCode, check=draft.checks[i];
      window.WILSON_INPUT.openKeypad({
        mode:"code",
        title:check.detailLabel||"Code shown on the display",
        hint:"As shown on the display. Several codes: separate them with a space.",
        value:check.detail||"",
        onDone:function(value){
          check.detail=value;
          renderChecks({revealOpen:true}); refreshLiveMetrics(); scheduleAutosave();
        }
      });
    });

    document.querySelectorAll("[data-maint]").forEach(el=>el.onclick=e=>{
      const id=e.currentTarget.dataset.maint;
      draft.maintenanceDone=Array.isArray(draft.maintenanceDone)?draft.maintenanceDone:[];
      const at=draft.maintenanceDone.indexOf(id);
      if(at>=0) draft.maintenanceDone.splice(at,1); else draft.maintenanceDone.push(id);
      /* Re-render just the chip: a full re-render here would collapse the
         open check a technician is in the middle of. */
      e.currentTarget.classList.toggle("selected",at<0);
      e.currentTarget.setAttribute("aria-pressed",at<0?"true":"false");
      const label=e.currentTarget.textContent.replace(/^[+\u2713]\s*/,"");
      e.currentTarget.textContent=(at<0?"\u2713 ":"+ ")+label;
      scheduleAutosave();
    });


    document.querySelectorAll("[data-reading]").forEach(el=>el.oninput=e=>{draft.checks[+e.target.dataset.reading].reading=e.target.value;updateReadiness();scheduleAutosave();});
    document.querySelectorAll("[data-reading-key]").forEach(el=>el.oninput=e=>{
      const [idx,key]=e.target.dataset.readingKey.split(":");
      draft.checks[+idx].readings=draft.checks[+idx].readings||{};
      draft.checks[+idx].readings[key]=e.target.value;
      updateReadiness(); scheduleAutosave();
    });
    /* The free-text half of a reason. The stored note is always rebuilt from
       the ticked reasons plus the typed words, so the two can never disagree
       and clearing one leaves the other standing. */
    document.querySelectorAll("[data-note]").forEach(el=>el.oninput=e=>{
      const check=draft.checks[+e.target.dataset.note];
      check.noteText=e.target.value;
      rebuildReason(check);
      updateReadiness(); scheduleAutosave();
    });
    document.querySelectorAll("[data-answer-reason]").forEach(el=>el.onclick=e=>{
      const raw=e.currentTarget.dataset.answerReason;
      const i=+raw.slice(0,raw.indexOf(":")), reason=raw.slice(raw.indexOf(":")+1);
      const check=draft.checks[i];
      check.noteReasons=Array.isArray(check.noteReasons)?check.noteReasons:[];
      const at=check.noteReasons.indexOf(reason);
      if(at>=0) check.noteReasons.splice(at,1); else check.noteReasons.push(reason);
      rebuildReason(check);
      renderChecks({revealOpen:true}); refreshLiveMetrics(); updateReadiness(); scheduleAutosave();
    });
    document.querySelectorAll("[data-answer-followup]").forEach(el=>el.onclick=e=>{
      const i=+e.currentTarget.dataset.answerFollowup, check=draft.checks[i];
      check.followUp=!check.followUp;
      renderChecks({revealOpen:true}); scheduleAutosave();
    });
    document.querySelectorAll("[data-answer-toggle]").forEach(el=>el.onclick=e=>{
      const [idxRaw,key]=e.currentTarget.dataset.answerToggle.split(":"), i=+idxRaw;
      const check=draft.checks[i];
      check.toggles=check.toggles||{};
      check.toggles[key]=!check.toggles[key];
      /* Turning the fuel off deletes its readings: an electric cooktop must
         not carry a gas pressure from a mistaken tick. And the inverse tick
         (v0.9.41's "can't access") deletes the readings it WAIVES when it
         goes on, so a waived check never carries a half-entered number. */
      const a=answerFor(check);
      if(!check.toggles[key]){
        ((a.readingFields)||[]).filter(f=>f.toggle===key).forEach(f=>{
          if(check.readings) delete check.readings[f.key];
        });
      } else {
        ((a.readingFields)||[]).filter(f=>f.toggleOff===key).forEach(f=>{
          if(check.readings) delete check.readings[f.key];
        });
      }
      renderChecks({revealOpen:true}); updateReadiness(); scheduleAutosave();
    });
    /*
     * The image is STORED, not noted.
     *
     * The label only says "saved" once IndexedDB has confirmed the write, so a
     * technician is never told their evidence is captured when it is not. A
     * failure says so on the spot -- the one moment they can still do something
     * about it.
     */
    document.querySelectorAll("[data-photo]").forEach(el=>el.onchange=e=>{
      const i=+e.target.dataset.photo, f=e.target.files[0];
      if(!f) return;
      const check=draft.checks[i], label=document.getElementById(`photo-label-${i}`);
      if(label) label.textContent="Saving photo…";
      window.WILSON_PHOTOS.put(f,{
        visitId:draft.visitId, assetId:draft.assetId, householdId:draft.householdId,
        checkId:check.id||"", checkName:check.name||"", kind:"condition", technician:technician()
      }).then(stored=>{
        check.photo=stored.id;
        check.photoName=f.name;
        if(label) label.textContent="✓ Photo saved";
        ensureThumb(label.closest("label"), stored.id, false);
        renderPhotoThumbs();
        scheduleAutosave();
      }).catch(err=>{
        if(label) label.textContent="⚠ Photo not saved — tap to retry";
        ui.toast("Photo not saved", String(err && err.message || err));
      });
    });
  }

  function renderAsset(){
    const host=document.getElementById("tech-asset-view"), home=document.getElementById("tech-home-view");
    home.classList.add("hidden"); host.classList.remove("hidden");
    const score=scoreDraft(), readiness=readinessText();
    host.innerHTML=`
      <section class="tech-asset-hero"><button class="tech-back-link" id="back-assets" type="button">← Appliance list</button><div class="tech-asset-hero-row"><div class="tech-asset-hero-icon"><img src="${iconFor(draft.asset)}" alt=""></div><div><span class="eyebrow dark">${ui.escapeHtml(draft.asset.location||"Main House")} · ${ui.escapeHtml(assetHeaderMeta())}</span><h2>${ui.escapeHtml(draft.asset.typeLabel)}</h2><p>${ui.escapeHtml([draft.asset.brand,draft.asset.model,draft.asset.serial?"S/N "+draft.asset.serial:""].filter(Boolean).join(" · ")||"Exact equipment detail to verify")}</p></div><span id="tech-autosave" class="tech-autosave">Autosave on</span></div>
      ${designCard(score)}
      ${derivedCard(score)}
      ${equipmentCard()}
      <div class="tech-lifecycle-card"><div id="tech-age-picker">${agePicker()}</div><div class="tech-age-source" id="tech-age-source">${ageSourceLine()}</div><div class="field"><label for="tech-tier">Product tier <span class="hint">Sets how deep the protocol goes</span></label><select id="tech-tier">${Object.values(config.lifecycleTiers).map(t=>`<option value="${t.id}" ${draft.tier===t.id?"selected":""}>${ui.escapeHtml(t.label)}</option>`).join("")}</select></div><div class="field"><label for="tech-expected-life">Expected life</label><input id="tech-expected-life" value="${score.expected} years" disabled><small class="tech-life-source" id="tech-life-source">${ui.escapeHtml(expectedLifeSource(draft.asset,draft.tier))}</small></div><div class="tech-life-stage"><span>Lifecycle</span><strong id="tech-life-stage-label">${ui.escapeHtml(score.dated?score.lifeStage:"Age unknown")}</strong><small id="tech-life-stage-detail">${ui.escapeHtml(lifeStageCaption(score))}</small></div></div>
      ${filterBanner()}
      ${scopeBanner()}
      <label class="tech-photo-button required-photo"><span id="serial-photo-label">${draft.serialPhoto?"✓ Serial tag saved: "+ui.escapeHtml(draft.serialPhotoName):"▣ Take / upload serial-tag photo (required)"}</span><input id="serial-photo" type="file" accept="image/*" capture="environment"></label>${draft.serialPhoto?`<div class="tech-photo-thumb wide" data-photo-thumb="${ui.escapeHtml(draft.serialPhoto)}"></div>`:""}
      </section>
      <div class="tech-protocol-heading"><div><span class="eyebrow dark">Short health protocol</span><h2>${draft.checks.length} checks</h2></div><p>Work them in whatever order suits the appliance. Tap a check to open it; rating it 1–5 marks it done and opens the next one you have not finished.</p></div>
      ${guardianPassthroughCard()}
      <div id="tech-checks">${draft.checks.map((c,i)=>checkCard(c,i)).join("")}</div>
      <div class="tech-score-preview"><div class="tech-score-number" id="tech-score-number">${score.overall===null||score.overall===undefined?"\u2013":score.overall}</div><div><strong id="tech-score-grade">${ui.escapeHtml(scoreHeading(score))}</strong><br><small id="tech-score-detail">${ui.escapeHtml(scoreDetailCaption(score))}</small></div></div>
      ${window.WILSON_INPUT.maintenanceChips(draft.checkpointSet||templateKey(draft.asset),draft.maintenanceDone)}
      ${cycleReminder()}
      <!-- v0.9.39: THE one note. Cayden: "eliminate note under specific health
           checks and make it a one stop general note if the tech wants to
           mention something of note." Optional, whole-appliance, and it goes on
           the report under the technician's name. -->
      <section class="tech-general-note ${draft.generalNote||(draft.generalPhotos||[]).length?"open":"closed"}">
        <button type="button" class="tech-general-note-toggle" id="tech-general-note-toggle">${draft.generalNote||(draft.generalPhotos||[]).length?"✎ Note for this appliance":"＋ Anything worth noting? One note for the whole appliance"}</button>
        <div class="tech-general-note-body" ${draft.generalNote||(draft.generalPhotos||[]).length?"":"hidden"}>
          <small>Access quirks, customer conversation, anything the next technician or the office should know. It goes on the report under your name.</small>
          <textarea id="tech-general-note" rows="2" placeholder="Nothing to add">${ui.escapeHtml(draft.generalNote||"")}</textarea>
          <!-- v0.9.41, Cayden: "add option for the tech to take a general photo...
               just the option to take a photo there that isn't tied to a specific
               health check." Stored like every other capture, listed on the
               report as a general photo. -->
          <label class="tech-photo-button"><span id="general-photo-label">▣ Add a photo — not tied to a check</span><input id="general-photo" type="file" accept="image/*" capture="environment"></label>
          <div id="general-photo-thumbs">${(draft.generalPhotos||[]).map(p=>`<div class="tech-photo-thumb wide" data-photo-thumb="${ui.escapeHtml(p.id)}"></div>`).join("")}</div>
        </div>
      </section>
      <div id="tech-readiness" class="tech-readiness ${readiness.cls}"><span>${readiness.cls==="ready"?"✓":"→"}</span><div><strong>${readiness.title}</strong><small>${ui.escapeHtml(readiness.detail)}</small></div></div>
      <div class="tech-bottom-actions"><button class="button secondary" id="save-progress" type="button">Save now</button><button class="button" id="complete-asset" type="button" ${completionReadiness().ready?"":"disabled"}>Complete &amp; generate report</button></div>`;
    bindAsset();
    const generalNote=document.getElementById("tech-general-note");
    if(generalNote) generalNote.oninput=e=>{draft.generalNote=e.target.value;scheduleAutosave();};
    const generalPhoto=document.getElementById("general-photo");
    if(generalPhoto) generalPhoto.onchange=e=>{
      const f=e.target.files[0];
      if(!f) return;
      const label=document.getElementById("general-photo-label");
      if(label) label.textContent="Saving photo…";
      window.WILSON_PHOTOS.put(f,{
        visitId:draft.visitId, assetId:draft.assetId, householdId:draft.householdId,
        checkId:"", checkName:"General", kind:"general", technician:technician()
      }).then(stored=>{
        draft.generalPhotos=Array.isArray(draft.generalPhotos)?draft.generalPhotos:[];
        draft.generalPhotos.push({id:stored.id,name:f.name});
        if(label) label.textContent="✓ Photo saved — add another?";
        const thumbs=document.getElementById("general-photo-thumbs");
        if(thumbs){const d=document.createElement("div");d.className="tech-photo-thumb wide";d.setAttribute("data-photo-thumb",stored.id);thumbs.appendChild(d);}
        renderPhotoThumbs();
        scheduleAutosave();
      }).catch(err=>{
        if(label) label.textContent="⚠ Photo not saved — tap to retry";
        ui.toast("Photo not saved", String(err && err.message || err));
      });
    };
    const noteToggle=document.getElementById("tech-general-note-toggle");
    if(noteToggle) noteToggle.onclick=()=>{
      const body=noteToggle.parentNode.querySelector(".tech-general-note-body");
      body.hidden=!body.hidden;
      if(!body.hidden) body.querySelector("textarea")?.focus();
    };
    /* The button's blocking reason is set by updateReadiness, which until now
       only ran on a change -- so the FIRST thing a technician saw was a greyed
       button with no reason on it, which is exactly the state they need it in. */
    updateReadiness();
    renderHead();
  }

  function saveCurrent(complete){
    const readiness=completionReadiness();
    if(complete && !readiness.ready){ui.toast("Required steps missing",readinessText().detail);return false;}
    clearTimeout(autosaveTimer);
    draftSnapshot();
    /*
     * Write the nameplate back onto the appliance.
     *
     * The plate card tells the technician "Read once; it carries to the next
     * visit." It did not: plate edits went into `draft.design`, which lives on
     * the inspection record, so every HVAC visit asked for all eleven
     * nameplate fields again -- and the screen made a promise the tool broke.
     * Eight taps and twenty-four keystrokes per system per visit, for data
     * that is stamped on the side of the equipment and never changes.
     */
    if(draft.design && Object.keys(draft.design).length){
      WilsonStore.saveAssetDesign(draft.assetId, draft.design);
    }
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
      /* renderHome without a scroll left the technician at the bottom of the
         list, with the "Suggested next step" card -- the one-tap path to the
         next appliance -- off screen above them. */
      setTimeout(function(){ renderHome(); window.scrollTo({top:0,behavior:"auto"}); },250);
    } else {
      const label=document.getElementById("tech-autosave"); if(label){label.textContent="Saved";label.classList.add("saved");}
      ui.toast("Progress saved","You can return to this appliance later.");
    }
    return true;
  }

  function bindAsset(){
    document.getElementById("back-assets").onclick=()=>{closeAssetView();};
    /*
     * Editing the number changes who is claiming it.
     *
     * If the invoice says 2014 and the technician types a different age, the
     * age is now the technician's -- keeping the "Wilson invoice" label on it
     * would be the tool telling the customer a document backs a number no
     * document produced. Typing the documented value back restores the
     * documented source, so a tech who checks the figure and agrees with it
     * does not downgrade it.
     */
    /* ---- the age picker (v0.9.17): decade, then year, then done ---- */
    function repaintAge(){
      const host=document.getElementById("tech-age-picker");
      if(host) host.innerHTML=agePicker();
      renderAgeSource();
      refreshLiveMetrics();
      scheduleAutosave();
      bindAgePicker();
    }

    function bindAgePicker(){
      document.querySelectorAll("[data-age-decade]").forEach(el=>el.onclick=e=>{
        const raw=e.currentTarget.dataset.ageDecade;
        draft.ageDecade=raw==="reset"?null:Number(raw);
        repaintAge();
      });
      document.querySelectorAll("[data-age-year]").forEach(el=>el.onclick=e=>{
        const year=Number(e.currentTarget.dataset.ageYear);
        draft.installYearPicked=year;
        draft.age=Math.max(0,currentYear()-year);
        draft.ageUnknownAck=false;
        /* A picked year that matches the invoice restores the DOCUMENTED
           source: a technician who checks the figure and agrees with it must
           not downgrade its provenance to a guess. */
        const documented=window.WILSON_AGE.resolve(draft.asset,null,null);
        draft.ageSource=(documented.installYear&&Number(documented.installYear)===year)
          ? documented.source.id
          : (draft.ageSource==="customer"?"customer":"estimate");
        repaintAge();
      });
      document.querySelectorAll("[data-age-unknown]").forEach(el=>el.onclick=e=>{
        draft.ageUnknownAck=true;
        draft.installYearPicked=null;
        draft.ageDecade=null;
        draft.age="";
        repaintAge();
      });
      document.querySelectorAll("[data-age-open]").forEach(el=>el.onclick=e=>{
        /* Re-opening the picker clears the answer rather than pre-selecting
           it: a "change" that starts from the old value is a confirm button
           wearing a change button's label. */
        draft.installYearPicked=null;
        draft.ageDecade=null;
        draft.ageUnknownAck=false;
        draft.age="";
        draft.ageSource="estimate";
        repaintAge();
      });
    }
    bindAgePicker();
    bindEquipmentCard();
    renderAgeSource();
    renderPhotoThumbs();
    /* Nameplate edits live on the draft and are merged over the asset record,
       so a correction in the field wins without overwriting the stored plate
       until the inspection is completed. */
    document.querySelectorAll("[data-design]").forEach(el=>el.oninput=e=>{
      draft.design=draft.design||{};
      draft.design[e.target.dataset.design]=e.target.value;
      refreshLiveMetrics();
      scheduleAutosave();
    });
    document.getElementById("tech-tier").onchange=e=>{draft.tier=e.target.value;refreshLiveMetrics();scheduleAutosave();};
    /*
     * The serial tag is the one required photograph, because it is the one that
     * proves a technician was physically at the appliance. Readiness only
     * advances after the write succeeds -- gating on a boolean that was set
     * before anything was saved would have let a visit complete with no
     * evidence at all.
     */
    document.getElementById("serial-photo").onchange=e=>{
      const f=e.target.files[0];
      if(!f) return;
      const label=document.getElementById("serial-photo-label");
      if(label) label.textContent="Saving serial-tag photo…";
      window.WILSON_PHOTOS.put(f,{
        visitId:draft.visitId, assetId:draft.assetId, householdId:draft.householdId,
        kind:"serial", checkName:"Serial tag", technician:technician()
      }).then(stored=>{
        draft.serialPhoto=stored.id;
        draft.serialPhotoName=f.name;
        if(label) label.textContent="✓ Serial tag saved: "+f.name;
        ensureThumb(label.closest("label"), stored.id, true);
        renderPhotoThumbs();
        updateReadiness();
        scheduleAutosave();
      }).catch(err=>{
        if(label) label.textContent="⚠ Serial-tag photo not saved — tap to retry";
        ui.toast("Photo not saved", String(err && err.message || err));
      });
    };

    bindCheckHandlers();
    document.getElementById("save-progress").onclick=()=>saveCurrent(false);
    document.getElementById("complete-asset").onclick=()=>saveCurrent(true);
  }

  if(routeError||!household()||!visit()){
    const message=routeError||"The selected household or visit could not be found.";
    document.getElementById("tech-home-view").innerHTML=`<div class="card card-pad" style="margin-top:14px"><div class="empty-state"><strong>Field visit not opened.</strong><br>${ui.escapeHtml(message)}<br><br>Open the specific residence and use the launch button in its Appliance Maintenance section. The field tool will not guess a household or visit.<div class="inline-actions" style="justify-content:center;margin-top:14px"><a class="button" href="customers.html">Choose a household</a></div></div></div>`;
    renderHead();
    return;
  }
  renderHome();
})();

(function () {
  const config = window.WILSON_CONFIG;
  const ui = window.WilsonUI;
  const filters = window.WILSON_FILTERS;
  const tempwatch = window.WILSON_TEMPWATCH;

  let assets = [];
  let areas = [{ id: "area_main", name: "Main House", locked: true }];
  let selectedPlan = "per_appliance";
  let paymentReady = false;
  let estateWasEligible = false;
  let draggedAssetId = null;
  let importedDraftLoaded = false;
  /* v0.9.41: amendment mode. Non-null when this screen was opened from a
     customer file to ADD to an existing plan rather than build a new one.
     Carries the household, the subscription being amended, the annual on
     file, and a snapshot of the locked assets' add-on choices so the approval
     can say exactly what changed. */
  let amendment = null;
  let signatureDrawn = false;
  /* Appliances the customer is taking OFF the plan during an amendment.
     They leave the priced list the moment they land here (all the pricing
     walks `assets`), and the approval panel lists them with an undo -- the
     removal only becomes real when the customer signs. */
  let removedAssets = [];

  const pickerGrid = document.getElementById("appliance-picker-grid");
  const areaBoard = document.getElementById("area-board");
  const estateChoiceWrap = document.getElementById("estate-choice-wrap");
  const estatePlanOptions = document.getElementById("estate-plan-options");
  const simplePlanCard = document.getElementById("simple-plan-card");
  const largeEstateNote = document.getElementById("large-estate-note");
  const summaryTotal = document.getElementById("summary-total");
  const summaryPlanName = document.getElementById("summary-plan-name");
  const summaryLines = document.getElementById("summary-lines");
  const summaryRecommendation = document.getElementById("summary-recommendation");
  const submitButton = document.querySelector(".submit-enrollment-button");
  /* The scheduling-preference control. Mounted from its own module so the HVAC
     signup can mount the identical thing rather than growing a second copy. */
  const schedulingForm = window.WILSON_SCHED_FORM
    ? window.WILSON_SCHED_FORM.mount({}) : null;

  function makeId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  }

  function categoryById(categoryId) {
    return config.customerApplianceCategories.find((item) => item.id === categoryId)
      || config.customerApplianceCategories[0];
  }

  function planById(planId) {
    return config.appliancePlans[planId] || config.appliancePlans.per_appliance;
  }

  function areaById(areaId) {
    return areas.find((item) => item.id === areaId) || areas[0];
  }

  function iconPath(categoryId) {
    const category = categoryById(categoryId);
    return `assets/appliance-icons/${category.icon}`;
  }

  function newAsset(categoryId, overrides) {
    const category = categoryById(categoryId);
    const area = areaById((overrides || {}).areaId || "area_main");
    return Object.assign({
      id: makeId("draft"),
      type: category.id,
      typeLabel: category.label,
      customerCategory: category.id,
      exactType: "",
      exactTypeLabel: "",
      group: category.group,
      checkpointSet: category.checkpointSet,
      filterTypes: category.filterTypes || [],
      filterServiceOptIn: Boolean((overrides || {}).filterServiceOptIn),
      airFilterServiceOptIn: Boolean((overrides || {}).airFilterServiceOptIn),
      tempMonitoringOptIn: Boolean((overrides || {}).tempMonitoringOptIn),
      waterFilterQuantity: Number((overrides || {}).waterFilterQuantity) || null,
      airFilterQuantity: Number((overrides || {}).airFilterQuantity) || null,
      imucVisitsPerYear: category.group === "imuc" ? config.pricing.imucRecommendedVisitsPerYear : 1,
      brand: "",
      model: "",
      serial: "",
      description: "",
      sourceInvoice: "",
      sourceGroupId: "",
      source: "customer",
      needsReview: false,
      areaId: area.id,
      location: area.name
    }, overrides || {});
  }

  function normalizeImportedAsset(raw) {
    const category = categoryById(raw.customerCategory || raw.type || "refrigeration");
    let area = areas.find((item) => item.id === raw.areaId);
    if (!area && raw.location) area = areas.find((item) => item.name.toLowerCase() === String(raw.location).toLowerCase());
    if (!area) area = areas[0];
    return newAsset(category.id, {
      id: raw.id || makeId("draft"),
      type: raw.exactType || raw.type || category.id,
      typeLabel: raw.exactTypeLabel || raw.typeLabel || category.label,
      customerCategory: category.id,
      exactType: raw.exactType || raw.type || "",
      exactTypeLabel: raw.exactTypeLabel || raw.typeLabel || "",
      group: category.group,
      checkpointSet: raw.checkpointSet || category.checkpointSet,
      filterTypes: raw.filterTypes || category.filterTypes || [],
      filterServiceOptIn: Boolean(raw.filterServiceOptIn),
      airFilterServiceOptIn: Boolean(raw.airFilterServiceOptIn),
      tempMonitoringOptIn: Boolean(raw.tempMonitoringOptIn),
      waterFilterQuantity: Number(raw.waterFilterQuantity) || null,
      airFilterQuantity: Number(raw.airFilterQuantity) || null,
      imucVisitsPerYear: category.group === "imuc" ? Number(raw.imucVisitsPerYear || 2) : 1,
      brand: raw.brand || "",
      model: raw.model || "",
      serial: raw.serial || "",
      description: raw.description || "",
      sourceInvoice: raw.sourceInvoice || "",
      sourceGroupId: raw.sourceGroupId || "",
      source: raw.source || "invoice",
      needsReview: Boolean(raw.needsReview),
      areaId: area.id,
      location: area.name
    });
  }

  function categoryCount(categoryId) {
    const category = categoryById(categoryId);
    if ((category.expandsTo || []).length) {
      // One WashTower = one tile count, two appliances. The tile says so.
      return new Set(assets.filter((a) => a.containerCategory === categoryId)
        .map((a) => a.sourceGroupId)).size;
    }
    return assets.filter((asset) => asset.customerCategory === categoryId
      && !asset.containerCategory).length;
  }

  /*
   * Some categories are containers: a WashTower is one product the customer
   * recognises but two maintained appliances. Adding one creates the same
   * labelled pair invoice import produces, so both entry paths converge on
   * identical assets, protocols and pricing.
   */
  function addAsset(categoryId, overrides) {
    const category = categoryById(categoryId);
    const parts = category.expandsTo || [];
    if (parts.length) {
      const groupId = makeId("pair");
      parts.forEach(function (partId) {
        const part = categoryById(partId);
        assets.push(newAsset(partId, Object.assign({
          typeLabel: `${category.label} — ${part.label}`,
          exactTypeLabel: `${category.label} — ${part.label}`,
          containerCategory: category.id,
          sourceGroupId: groupId
        }, overrides || {})));
      });
    } else {
      const added = newAsset(categoryId, overrides);
      assets.push(added);
      refreshAll();
      maybeSpotlightAddOns(added);
      return;
    }
    refreshAll();
  }

  /*
   * THE ADD-ON SPOTLIGHT.                                       (v0.9.40)
   *
   * Cayden, with a screenshot of the toggles buried in the asset card: "the
   * add on options needs to be a little more visible / in your face. maybe
   * when you select the refrigeration card, it then pops up a new card on top
   * of what you are doing... i really think its important to put the
   * customers eyes on these really cool offerings we have. especially the
   * temp monitoring."
   *
   * So: adding a refrigeration appliance pops one card over the page --
   * Guardian first and biggest, filter service under it -- with real add
   * buttons wired to the same opt-ins as the inline toggles. Dismissing it
   * loses nothing: the same choices stay on the appliance card, and the sheet
   * says so, because "decide later" has to be a safe answer or the pop-up is
   * a pressure tactic rather than a spotlight.
   *
   * Once per ADDED appliance, never on re-render, never when the customer is
   * editing an existing list item. Every price on it comes from the engine.
   */
  /*
   * WHAT ADDING THIS SENSOR COSTS -- asked of the engine, never computed
   * here. total(with) minus total(without) is the one arithmetic, so the
   * spotlight, the card toggle and the summary can never quote three
   * different prices for the same tick. (v0.9.44)
   */
  function guardianMarginalPrice(asset) {
    if (!tempwatch) return 0;
    const withIt = assets.map(function (a) {
      return a.id === asset.id ? Object.assign({}, a, { tempMonitoringOptIn: true }) : a;
    });
    const withoutIt = assets.map(function (a) {
      return a.id === asset.id ? Object.assign({}, a, { tempMonitoringOptIn: false }) : a;
    });
    return Math.round((tempwatch.total(withIt, "member", selectedPlan) - tempwatch.total(withoutIt, "member", selectedPlan)) * 100) / 100;
  }

  function guardianIsFirstSensor(asset) {
    if (!tempwatch) return true;
    return !assets.some(function (a) {
      return a.id !== asset.id && tempwatch.forAsset(a).sensors > 0;
    });
  }

  /* What ticking ONE compartment on this appliance would add (or unticking
     it would remove) -- the engine's total(with) minus total(without), never
     arithmetic of our own. (v0.9.47) */
  function guardianCompartmentDelta(asset, key) {
    if (!tempwatch) return 0;
    const watched = tempwatch.watched(asset);
    const withKey = watched.indexOf(key) > -1 ? watched : watched.concat([key]);
    const withoutKey = watched.filter(function (k) { return k !== key; });
    const shape = function (list) {
      return assets.map(function (a) {
        if (a.id !== asset.id) return a;
        return Object.assign({}, a, { tempMonitoringOptIn: list.length > 0, tempMonitoringCompartments: list });
      });
    };
    return Math.round((tempwatch.total(shape(withKey), "member", selectedPlan) - tempwatch.total(shape(withoutKey), "member", selectedPlan)) * 100) / 100;
  }

  function maybeSpotlightAddOns(asset) {
    if (!tempwatch || !tempwatch.eligible(asset)) return;
    const tm = tempwatch.config();
    const kinds = filters.eligible(asset) ? filters.kindsFor(asset) : [];
    const host = document.createElement("div");
    host.className = "addon-spotlight-backdrop";
    host.innerHTML = `
      <div class="addon-spotlight" role="dialog" aria-modal="true" aria-labelledby="addon-spotlight-title">
        <span class="eyebrow dark">For the ${ui.escapeHtml((categoryById(asset.customerCategory).id === "refrigeration" ? "refrigerator" : categoryById(asset.customerCategory).label).toLowerCase())} you just added</span>
        <h3 id="addon-spotlight-title">Two things Wilson can do for it, year-round</h3>

        <div class="addon-hero">
          <div class="addon-hero-copy">
            <strong>${ui.escapeHtml(tm.serviceName || "Wilson Guardian Temp Monitoring")}</strong>
            <p>${ui.escapeHtml(tm.description || "")}</p>
            <small>${ui.escapeHtml(tm.responseCopy || "")}</small>
            ${tempwatch.compartmentsFor(asset).allowed.length > 1 ? `<small class="addon-compartment-hint">Separate fresh-food and freezer compartments? Wilson can put a sensor in each — pick both on the appliance card below.</small>` : ""}
          </div>
          <div class="addon-hero-action">
            <span class="addon-price">${guardianMarginalPrice(asset) === 0 && tempwatch.included && tempwatch.included(selectedPlan) > 0 ? "Included" : ui.money(guardianMarginalPrice(asset))}<small>/ year — ${guardianMarginalPrice(asset) === 0 && tempwatch.included && tempwatch.included(selectedPlan) > 0 ? "with " + ui.escapeHtml(planById(selectedPlan).shortName || planById(selectedPlan).name) : (guardianIsFirstSensor(asset) ? "first sensor" : "additional sensor")}</small></span>
            <button class="button" type="button" data-spotlight-guardian="${asset.id}">${asset.tempMonitoringOptIn ? "✓ Added" : "Add Temp Monitoring"}</button>
          </div>
        </div>

        ${kinds.length ? `<div class="addon-secondary">
          <strong>Wilson Filter Service</strong>
          <p>Wilson tracks and replaces this appliance's filters at every maintenance visit — the exact parts, on the right interval, without you thinking about it.</p>
          <div class="addon-secondary-row">${kinds.map(function (kindId) {
            const kind = filters.kinds()[kindId];
            const on = kindId === "water" ? Boolean(asset.filterServiceOptIn) : Boolean(asset.airFilterServiceOptIn);
            return `<button class="button small ghost" type="button" data-spotlight-filter="${asset.id}:${kindId}">${on ? "✓ " : "+ "}${ui.escapeHtml(kind.label)} · ${ui.money(kind.unitPrice)}/filter/yr</button>`;
          }).join("")}</div>
        </div>` : ""}

        <!-- v0.9.49, Cayden: "the customer has to click outside of the pop
             up window to go back to registering. right now if you hit
             guardian on the pop up it feels like nothing happens." Two
             fixes in one footer: a real continue button (which SAYS what
             was just added, so a selection visibly lands somewhere), and
             the maybe-later link kept beneath it as the no-thanks path. -->
        <div class="addon-spotlight-actions">
          <button class="button addon-done" type="button" data-spotlight-close id="addon-done-button">Continue registering</button>
          <button class="addon-later link-button" type="button" data-spotlight-close>Maybe later — these options stay on the appliance card below</button>
        </div>
      </div>`;
    document.body.appendChild(host);
    const close = function () { host.remove(); refreshAll(); };
    /* The continue button narrates the selections, so tapping "Add Guardian"
       visibly changes TWO things: the button it sits on, and the exit. */
    const restateDone = function () {
      const done = host.querySelector("#addon-done-button");
      if (!done) return;
      const target = assets.find(function (a) { return a.id === asset.id; }) || asset;
      const picked = [];
      if (target.tempMonitoringOptIn) picked.push(tm.serviceShortName || "Temp Monitoring");
      if (target.filterServiceOptIn || target.airFilterServiceOptIn) picked.push("filter service");
      done.textContent = picked.length
        ? "Done — " + picked.join(" + ") + " added. Continue registering"
        : "Continue registering";
      done.classList.toggle("addon-done-selected", picked.length > 0);
    };
    host.addEventListener("click", function (event) {
      if (event.target === host || event.target.closest("[data-spotlight-close]")) { close(); return; }
      const g = event.target.closest("[data-spotlight-guardian]");
      if (g) {
        const target = assets.find(function (a) { return a.id === g.dataset.spotlightGuardian; });
        if (target) {
          target.tempMonitoringOptIn = !target.tempMonitoringOptIn;
          target.tempMonitoringCompartments = target.tempMonitoringOptIn
            ? tempwatch.compartmentsFor(target).defaults.slice() : [];
          g.textContent = target.tempMonitoringOptIn ? "✓ Added" : "Add Temp Monitoring";
          g.classList.toggle("ghost", false);
          g.classList.toggle("addon-picked", target.tempMonitoringOptIn);
          restateDone();
        }
        return;
      }
      const f = event.target.closest("[data-spotlight-filter]");
      if (f) {
        const raw = f.dataset.spotlightFilter;
        const target = assets.find(function (a) { return a.id === raw.split(":")[0]; });
        const kindId = raw.split(":")[1];
        if (target) {
          if (kindId === "air") target.airFilterServiceOptIn = !target.airFilterServiceOptIn;
          else target.filterServiceOptIn = !target.filterServiceOptIn;
          const on = kindId === "air" ? target.airFilterServiceOptIn : target.filterServiceOptIn;
          f.textContent = (on ? "✓ " : "+ ") + f.textContent.replace(/^[+✓]\s*/, "");
          f.classList.toggle("addon-picked", on);
          restateDone();
        }
      }
    });
    document.addEventListener("keydown", function esc(event) {
      if (event.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });
    const primary = host.querySelector("[data-spotlight-guardian]");
    if (primary) primary.focus();
  }

  /* v0.9.42, Cayden's ruling: "Removing appliances from a plan should be
     fine in the field, office confirms changes." Removing a LOCKED (on-plan)
     appliance moves it to the coming-off list -- undoable until the customer
     signs, priced out immediately, confirmed by the office after approval.
     The picker's minus button still only walks back appliances added THIS
     session; taking a covered machine off the plan is deliberate enough to
     deserve its own button on the card it names. */
  function pickerMinusBlocked() {
    ui.toast("Use the card to remove it", "That appliance is on the existing plan. Its card below has the Remove-from-plan button, so the removal is deliberate.");
  }

  function removeOneByCategory(categoryId) {
    const category = categoryById(categoryId);
    if ((category.expandsTo || []).length) {
      // Remove the most recently added pair as a unit -- half a WashTower is not
      // a thing the customer can own.
      const groups = assets.filter((a) => a.containerCategory === categoryId && !a.locked).map((a) => a.sourceGroupId);
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup && assets.some((a) => a.containerCategory === categoryId && a.locked)) { pickerMinusBlocked(); return; }
      if (lastGroup) assets = assets.filter((a) => a.sourceGroupId !== lastGroup);
      refreshAll();
      return;
    }
    const removable = [...assets].map((asset) => (asset.customerCategory === categoryId && !asset.locked) ? asset.customerCategory : null);
    const index = removable.lastIndexOf(categoryId);
    if (index < 0 && assets.some((a) => a.customerCategory === categoryId && a.locked)) { pickerMinusBlocked(); return; }
    if (index >= 0) assets.splice(index, 1);
    refreshAll();
  }

  function removeAsset(assetId) {
    const target = assets.find((asset) => asset.id === assetId);
    if (target && target.locked) {
      removedAssets.push(target);
      assets = assets.filter((asset) => asset.id !== assetId);
      refreshAll();
      return;
    }
    assets = assets.filter((asset) => asset.id !== assetId);
    refreshAll();
  }

  function restoreRemovedAsset(assetId) {
    const target = removedAssets.find(function (a) { return a.id === assetId; });
    if (!target) return;
    removedAssets = removedAssets.filter(function (a) { return a.id !== assetId; });
    assets.push(target);
    refreshAll();
  }

  function selectedPlanVisits(planId) {
    return Number(planById(planId || selectedPlan).visitsPerYear || 1);
  }

  function imucAssets() {
    return assets.filter((item) => item.group === "imuc");
  }

  function imucSecondVisitCount(planId) {
    return window.WILSON_PRICING.imucSecondVisitCount(assets, planId);
  }

  /*
   * THE RUNNING TOTAL, ON A PHONE.
   *
   * The summary panel sits beside the appliance grid on a desktop and below it on
   * a phone, which is the right reading order -- pick first, price second -- and
   * leaves the best part of this screen off-screen while you tap. So the figure
   * is mirrored into a slim fixed bar.
   *
   * A COPY, deliberately. Moving the panel itself was the previous attempt and it
   * ended up covering the tiles: `minmax(0, 1fr)` collapsed the appliance column
   * to zero and the panel kept its 344px. One number, computed once, shown twice.
   */
  function paintTotalBar(count, total, planName) {
    let bar = document.getElementById("total-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "total-bar";
      bar.className = "total-bar";
      bar.setAttribute("role", "status");
      bar.setAttribute("aria-live", "polite");
      bar.innerHTML = '<div class="total-bar-figure"><strong id="total-bar-amount"></strong>' +
                      '<span id="total-bar-note"></span></div>' +
                      '<button type="button" class="total-bar-jump" id="total-bar-jump">Review plan</button>';
      document.body.appendChild(bar);
      bar.querySelector("#total-bar-jump").addEventListener("click", function () {
        const panel = document.querySelector(".enrollment-summary-sticky");
        if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    document.body.classList.toggle("has-total-bar", count > 0);
    if (!count) return;
    bar.querySelector("#total-bar-amount").textContent = ui.money(total) + " / year";
    /* "covers N appliances", not "N appliances": Cayden's field report was
       customers reading the annual figure as per-appliance. The bar now says
       what the number covers rather than leaving the multiplication implied. */
    bar.querySelector("#total-bar-note").textContent =
      "covers " + (count === 1 ? "1 appliance" : "all " + count + " appliances") + (planName ? " \u00b7 " + planName : "");
  }

  /*
   * PRICING MOVED OUT AT v0.9.23.
   *
   * These are now thin passes to WILSON_PRICING in plan-config.js. They lived
   * here, in a screen file, which is exactly why the old quote screen could not
   * reuse them and wrote its own -- and its own had no filter service in it.
   * The wrappers stay because this module calls them in a dozen places and
   * threading `assets` through each call site would be noise, not clarity.
   */
  function estateAdjustment(planId) {
    return window.WILSON_PRICING.estateAdjustment(assets, planId);
  }

  function perApplianceCost() {
    return window.WILSON_PRICING.perAppliance(assets);
  }

  function filterServiceCost(planId) {
    return filters.total(assets, planId);
  }

  function planCost(planId) {
    return window.WILSON_PRICING.annual(assets, planId);
  }

  function bestEstatePlan() {
    const candidates = ["estate_annual", "estate_preferred"];
    return candidates.sort((a, b) => planCost(a) - planCost(b))[0];
  }

  function estateEligible() {
    if (!assets.length) return false;
    return planCost(bestEstatePlan()) + 0.005 < planCost("per_appliance");
  }

  function enforceAutomaticPlan() {
    const eligible = estateEligible();
    const best = eligible ? bestEstatePlan() : "per_appliance";
    let changed = false;
    if (!assets.length) {
      selectedPlan = "per_appliance";
      estateWasEligible = false;
      return false;
    }
    if (eligible && selectedPlan === "per_appliance") {
      selectedPlan = best;
      changed = true;
    }
    if (!eligible && selectedPlan !== "per_appliance") {
      /* v0.9.48, from the audit: in AMENDMENT mode this branch silently moved
         a household OFF their estate plan the moment the screen opened --
         the customer would have signed away their coordinated whole-home
         visits without being told. An amendment never downgrades the plan on
         its own; the customer keeps what they bought, and moving down is an
         office conversation. (Upgrades still announce themselves and appear
         as a signed line on the approval panel.) */
      if (amendment) return changed;
      selectedPlan = "per_appliance";
      changed = true;
    }
    if (eligible && !estateWasEligible) {
      estateWasEligible = true;
      if (!importedDraftLoaded) ui.toast("Estate pricing unlocked", `The form selected ${planById(best).name} because it is the best value for this appliance mix.`);
    }
    if (!eligible) estateWasEligible = false;
    return changed;
  }

  function renderPicker() {
    pickerGrid.innerHTML = config.customerApplianceCategories.map(function (category) {
      const count = categoryCount(category.id);
      return `
        <article class="appliance-picker-card ${count ? "selected" : ""}" data-category-card="${category.id}">
          <button class="appliance-picker-hit" type="button" data-add-category="${category.id}" aria-label="Add ${ui.escapeHtml(category.label)}">
            <span class="appliance-picker-image"><img src="${iconPath(category.id)}" alt=""></span>
            <span class="appliance-picker-name">${ui.escapeHtml(category.label)}</span>
            <span class="appliance-picker-help">${ui.escapeHtml(category.help)}</span>
            ${category.group === "imuc"
              ? '<span class="picker-recommended">2× yearly recommended</span>'
              : category.countsAsNote
                ? `<span class="picker-recommended counts-as">${ui.escapeHtml(category.countsAsNote)}</span>`
                : category.scopeNoteShort
                  ? `<span class="picker-recommended scope-limited">${ui.escapeHtml(category.scopeNoteShort)}</span>`
                  : (category.filterServiceAvailable ? '<span class="picker-recommended filter-available">Filter service available</span>' : "")}
            ${category.scopeNote ? `<span class="picker-scope-note">${ui.escapeHtml(category.scopeNote)}</span>` : ""}
          </button>
          <div class="tile-stepper ${count ? "visible" : ""}" aria-label="${ui.escapeHtml(category.label)} quantity">
            <button type="button" data-decrease-category="${category.id}" aria-label="Remove one ${ui.escapeHtml(category.label)}">−</button>
            <strong>${count}</strong>
            <button type="button" data-increase-category="${category.id}" aria-label="Add one ${ui.escapeHtml(category.label)}">+</button>
          </div>
          ${!count ? '<span class="tile-add-label">+ Add</span>' : ""}
        </article>
      `;
    }).join("");

    pickerGrid.querySelectorAll("[data-add-category]").forEach(function (button) {
      button.addEventListener("click", function () { addAsset(button.dataset.addCategory); });
    });
    pickerGrid.querySelectorAll("[data-increase-category]").forEach(function (button) {
      button.addEventListener("click", function () { addAsset(button.dataset.increaseCategory); });
    });
    pickerGrid.querySelectorAll("[data-decrease-category]").forEach(function (button) {
      button.addEventListener("click", function () { removeOneByCategory(button.dataset.decreaseCategory); });
    });

    document.getElementById("selected-appliance-count").textContent = assets.length;
  }

  function duplicateNumber(asset) {
    const same = assets.filter((item) => item.customerCategory === asset.customerCategory);
    if (same.length <= 1) return "";
    return String(same.findIndex((item) => item.id === asset.id) + 1);
  }

  function areaOptions(selectedAreaId) {
    return areas.map((area) => `<option value="${area.id}" ${area.id === selectedAreaId ? "selected" : ""}>${ui.escapeHtml(area.name)}</option>`).join("");
  }

  function assetDetail(asset) {
    const bits = [asset.brand, asset.model].filter(Boolean).join(" ");
    if (bits) return bits;
    if (asset.exactTypeLabel && asset.exactTypeLabel !== categoryById(asset.customerCategory).label) return asset.exactTypeLabel;
    return "Details verified by Wilson";
  }

  function renderAreaBoard() {
    areaBoard.innerHTML = areas.map(function (area) {
      const areaAssets = assets.filter((asset) => asset.areaId === area.id);
      return `
        <section class="home-area-card" data-drop-area="${area.id}">
          <header class="home-area-head">
            <div>
              <span class="area-icon">⌂</span>
              <div><strong>${ui.escapeHtml(area.name)}</strong><small>${areaAssets.length} appliance${areaAssets.length === 1 ? "" : "s"}</small></div>
            </div>
            <div class="area-head-actions">
              <button type="button" data-rename-area="${area.id}" aria-label="Rename ${ui.escapeHtml(area.name)}">Rename</button>
              ${area.locked ? "" : `<button class="danger-link" type="button" data-remove-area="${area.id}" aria-label="Remove ${ui.escapeHtml(area.name)}">Remove</button>`}
            </div>
          </header>
          <div class="home-area-dropzone ${areaAssets.length ? "" : "empty"}" data-dropzone="${area.id}">
            ${areaAssets.length ? areaAssets.map(function (asset) {
              const category = categoryById(asset.customerCategory);
              const number = duplicateNumber(asset);
              const planIncludesSecond = selectedPlanVisits() >= 2;
              return `
                <article class="selected-appliance-card ${asset.needsReview ? "needs-review" : ""} ${asset.locked ? "on-plan" : ""}" draggable="${asset.locked ? "false" : "true"}" data-asset-id="${asset.id}">
                  ${asset.locked ? "" : `<div class="selected-appliance-drag" title="Drag to another area">⋮⋮</div>`}
                  <img src="${iconPath(category.id)}" alt="" class="selected-appliance-icon">
                  <div class="selected-appliance-copy">
                    <div class="selected-appliance-title">${ui.escapeHtml(category.label)}${number ? ` ${number}` : ""}${asset.locked ? '<span class="badge">On the plan</span>' : ""}${asset.needsReview ? '<span class="badge warning">Review</span>' : ""}</div>
                    <div class="selected-appliance-detail">${ui.escapeHtml(assetDetail(asset))}</div>
                    ${asset.sourceInvoice ? `<div class="selected-appliance-source">Invoice ${ui.escapeHtml(asset.sourceInvoice)}</div>` : ""}
                    ${asset.group === "imuc" ? `
                      <label class="imuc-mini-toggle ${planIncludesSecond ? "included" : ""}">
                        <input type="checkbox" data-imuc-toggle="${asset.id}" ${planIncludesSecond || Number(asset.imucVisitsPerYear) >= 2 ? "checked" : ""} ${planIncludesSecond ? "disabled" : ""}>
                        <span>${planIncludesSecond ? "Two visits included" : "Two visits yearly (recommended)"}</span>
                      </label>
                    ` : ""}
                    ${tempwatch && tempwatch.eligible(asset) ? (function () {
                      /*
                       * THE ADD-ON CARD.                          (v0.9.39)
                       *
                       * Cayden: "if they choose a refrigerator for maintenance
                       * it has a card that pops up and explains filter service
                       * and or temp monitoring as add on options." The filter
                       * toggles below were already that card's first half;
                       * this is the second. Priced by the one engine
                       * (WILSON_TEMPWATCH), never multiplied here.
                       */
                      const tm = tempwatch.config();
                      const picked = Boolean(asset.tempMonitoringOptIn);
                      /* v0.9.44: the price is the ENGINE'S answer to "what
                         does this sensor add" -- $199 when it is the home's
                         first, $99 when another sensor is already on. */
                      const price = guardianMarginalPrice(asset);
                      /* v0.9.47, Cayden: "Some will want a sensor in freezer
                         and refrigerator compartments on same unit." Once
                         Guardian is on, each compartment the unit can carry a
                         probe in is its own tick, its own sensor, its own
                         line on the household's price ladder. */
                      const shape = tempwatch.compartmentsFor(asset);
                      const watched = tempwatch.watched(asset);
                      const compartmentRows = picked && shape.allowed.length > 1
                        ? `<div class="tempwatch-compartments">${shape.allowed.map(function (key) {
                            const meta = (tm.compartments || {})[key] || {};
                            const on = watched.indexOf(key) > -1;
                            const delta = guardianCompartmentDelta(asset, key);
                            return `<label class="tempwatch-compartment"><input type="checkbox" data-temp-compartment="${asset.id}:${key}" ${on ? "checked" : ""}><span>${ui.escapeHtml(meta.label || key)}<small>${on ? "watched — one sensor" : "+ " + ui.money(delta) + " / year"}</small></span></label>`;
                          }).join("")}</div>`
                        : "";
                      return `
                        <label class="filter-mini-toggle tempwatch-toggle">
                          <input type="checkbox" data-temp-monitoring="${asset.id}" ${picked ? "checked" : ""}>
                          <span><strong>${ui.escapeHtml(tm.customerLabel || "Add 24/7 temperature monitoring")}</strong><small>${ui.escapeHtml(tm.description || "")} ${picked ? watched.length + " sensor" + (watched.length === 1 ? "" : "s") + " on this appliance." : ui.money(price) + " / year — " + (guardianIsFirstSensor(asset) ? "the home's first sensor" : "additional-sensor rate") + "."}</small></span>
                        </label>${compartmentRows}`;
                    })() : ""}
                    ${filters.eligible(asset) ? filters.kindsFor(asset).map((kindId) => {
                      const kind = filters.kinds()[kindId];
                      const filterIncluded = filters.planIncludesFilters(selectedPlan);
                      const selected = kindId === "water"
                        ? Boolean(asset.filterServiceOptIn)
                        : Boolean(asset.airFilterServiceOptIn);
                      const quantity = filters.quantity(asset, kindId) || Number(kind.defaultQuantity) || 1;
                      const price = quantity * (Number(kind.unitPrice) || 0);
                      /* Estate Concierge's included-filter list covers water AND
                         air / food-preservation, so both render checked and
                         locked there. On every other plan each kind is an
                         explicit customer choice, never checked by default. */
                      const forceOn = filterIncluded;
                      return `
                        <label class="filter-mini-toggle ${filterIncluded ? "included" : ""}">
                          <input type="checkbox" data-filter-service="${asset.id}" data-filter-kind="${kindId}" ${forceOn || selected ? "checked" : ""} ${forceOn ? "disabled" : ""}>
                          <span><strong>${filterIncluded ? kind.label + " included" : kind.label}</strong><small>${filterIncluded
                            ? "Covered by Estate Concierge"
                            : `${ui.money(kind.unitPrice)} per filter · ${ui.money(price)} / year${quantity > 1 ? ` (${quantity} filters)` : ""}`}</small></span>
                        </label>`;
                    }).join("") : ""}
                  </div>
                  ${asset.locked ? `<div class="selected-appliance-controls">
                    <button class="remove-from-plan" type="button" data-remove-asset="${asset.id}" aria-label="Remove ${ui.escapeHtml(category.label)} from the plan">Remove from plan</button>
                  </div>` : `<div class="selected-appliance-controls">
                    <label><span>Move to</span><select data-move-asset="${asset.id}">${areaOptions(asset.areaId)}</select></label>
                    <button class="remove-appliance-icon" type="button" data-remove-asset="${asset.id}" aria-label="Remove ${ui.escapeHtml(category.label)}">×</button>
                  </div>`}
                </article>
              `;
            }).join("") : `<div class="area-empty-copy"><strong>Drop appliances here</strong><span>Or add a category above and move it here.</span></div>`}
          </div>
        </section>
      `;
    }).join("");

    areaBoard.querySelectorAll("[data-remove-asset]").forEach(function (button) {
      button.addEventListener("click", function () { removeAsset(button.dataset.removeAsset); });
    });
    areaBoard.querySelectorAll("[data-move-asset]").forEach(function (select) {
      select.addEventListener("change", function () {
        const asset = assets.find((item) => item.id === select.dataset.moveAsset);
        if (!asset) return;
        asset.areaId = select.value;
        asset.location = areaById(select.value).name;
        refreshAll();
      });
    });
    areaBoard.querySelectorAll("[data-imuc-toggle]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        const asset = assets.find((item) => item.id === checkbox.dataset.imucToggle);
        if (!asset) return;
        asset.imucVisitsPerYear = checkbox.checked ? 2 : 1;
        refreshAll();
      });
    });
    areaBoard.querySelectorAll("[data-temp-monitoring]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        const asset = assets.find((item) => item.id === checkbox.dataset.tempMonitoring);
        if (!asset) return;
        asset.tempMonitoringOptIn = checkbox.checked;
        /* Adding Guardian watches the unit's default compartment; removing
           it clears the choice so a re-add starts clean. */
        asset.tempMonitoringCompartments = checkbox.checked
          ? tempwatch.compartmentsFor(asset).defaults.slice() : [];
        refreshAll();
      });
    });
    areaBoard.querySelectorAll("[data-temp-compartment]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        const raw = checkbox.dataset.tempCompartment;
        const asset = assets.find((item) => item.id === raw.split(":")[0]);
        if (!asset) return;
        const key = raw.split(":")[1];
        const current = tempwatch.watched(asset);
        const next = checkbox.checked
          ? current.concat(current.indexOf(key) > -1 ? [] : [key])
          : current.filter(function (k) { return k !== key; });
        /* Unticking the last compartment IS declining Guardian on this
           appliance -- one state, not two ways to be off. */
        asset.tempMonitoringCompartments = next;
        asset.tempMonitoringOptIn = next.length > 0;
        refreshAll();
      });
    });
    areaBoard.querySelectorAll("[data-filter-service]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        const asset = assets.find((item) => item.id === checkbox.dataset.filterService);
        if (!asset) return;
        if (checkbox.dataset.filterKind === "air") asset.airFilterServiceOptIn = checkbox.checked;
        else asset.filterServiceOptIn = checkbox.checked;
        refreshAll();
      });
    });
    areaBoard.querySelectorAll("[data-rename-area]").forEach(function (button) {
      button.addEventListener("click", function () {
        const area = areaById(button.dataset.renameArea);
        const proposed = window.prompt("Rename this area", area.name);
        if (!proposed || !proposed.trim()) return;
        area.name = proposed.trim();
        assets.filter((asset) => asset.areaId === area.id).forEach((asset) => { asset.location = area.name; });
        refreshAll();
      });
    });
    areaBoard.querySelectorAll("[data-remove-area]").forEach(function (button) {
      button.addEventListener("click", function () {
        const areaId = button.dataset.removeArea;
        assets.filter((asset) => asset.areaId === areaId).forEach((asset) => {
          asset.areaId = areas[0].id;
          asset.location = areas[0].name;
        });
        areas = areas.filter((area) => area.id !== areaId);
        refreshAll();
      });
    });

    areaBoard.querySelectorAll("[data-asset-id]").forEach(function (card) {
      card.addEventListener("dragstart", function (event) {
        draggedAssetId = card.dataset.assetId;
        card.classList.add("dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", draggedAssetId);
        }
      });
      card.addEventListener("dragend", function () {
        card.classList.remove("dragging");
        draggedAssetId = null;
        areaBoard.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
      });
    });

    areaBoard.querySelectorAll("[data-dropzone]").forEach(function (zone) {
      zone.addEventListener("dragover", function (event) {
        event.preventDefault();
        zone.classList.add("drag-over");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });
      zone.addEventListener("dragleave", function (event) {
        if (!zone.contains(event.relatedTarget)) zone.classList.remove("drag-over");
      });
      zone.addEventListener("drop", function (event) {
        event.preventDefault();
        const assetId = draggedAssetId || (event.dataTransfer ? event.dataTransfer.getData("text/plain") : "");
        const asset = assets.find((item) => item.id === assetId);
        if (asset) {
          asset.areaId = zone.dataset.dropzone;
          asset.location = areaById(asset.areaId).name;
        }
        zone.classList.remove("drag-over");
        refreshAll();
      });
    });
  }

  function estatePlanCopy(planId) {
    if (planId === "estate_annual") return { icon: "1×", title: "Annual", line: "One coordinated whole-home visit" };
    if (planId === "estate_preferred") return { icon: "2×", title: "Preferred", line: "Two coordinated visits each year" };
    return { icon: "★", title: "Concierge", line: "Two visits, filters, priority service, and reports" };
  }

  function renderPlan() {
    const eligible = estateEligible();
    const selected = planById(selectedPlan);
    const total = planCost(selectedPlan);

    if (!assets.length) {
      simplePlanCard.innerHTML = `<div class="simple-plan-empty"><span>1</span><div><strong>Add an appliance to begin</strong><p>Your plan and annual estimate will appear automatically.</p></div></div>`;
    } else if (!eligible) {
      simplePlanCard.innerHTML = `
        <div class="simple-plan-selected">
          <div class="simple-plan-check">✓</div>
          <div><span class="simple-plan-eyebrow">Selected automatically</span><strong>Per-Appliance Maintenance</strong><p>Priced item by item, so you only pay for the ${assets.length} appliance${assets.length === 1 ? "" : "s"} selected above. The figure here is your whole plan for the year — ${assets.length === 1 ? "" : `all ${assets.length} appliances together, `}not a charge per appliance.</p></div>
          <div class="simple-plan-price">${ui.money(total)}<small>/ year, everything above</small></div>
        </div>`;
    } else {
      const best = bestEstatePlan();
      const savings = Math.max(0, planCost("per_appliance") - planCost(selectedPlan));
      simplePlanCard.innerHTML = `
        <div class="simple-plan-selected estate">
          <div class="simple-plan-check">✓</div>
          <div><span class="simple-plan-eyebrow">Estate pricing unlocked</span><strong>${ui.escapeHtml(selected.name)}</strong><p>${selectedPlan === best ? `Automatically selected because this appliance mix saves ${ui.money(savings)} versus item-by-item pricing.` : ui.escapeHtml(selected.description)}</p></div>
          <div class="simple-plan-price">${ui.money(total)}<small>/ year</small></div>
        </div>`;
    }

    if (eligible) {
      estateChoiceWrap.classList.remove("hidden");
      estatePlanOptions.innerHTML = ["estate_annual", "estate_preferred", "estate_concierge"].map(function (planId) {
        const plan = planById(planId);
        const copy = estatePlanCopy(planId);
        return `
          <button class="estate-tier-card ${selectedPlan === planId ? "selected" : ""}" type="button" data-estate-plan="${planId}">
            <span class="estate-tier-icon">${copy.icon}</span>
            <span class="estate-tier-copy"><strong>${copy.title}</strong><small>${copy.line}</small></span>
            <span class="estate-tier-price">${ui.money(planCost(planId))}<small>/ yr</small></span>
            ${planId === bestEstatePlan() ? '<span class="estate-tier-badge">Best value</span>' : (planId === "estate_concierge" ? '<span class="estate-tier-badge">Hands-off</span>' : "")}
          </button>`;
      }).join("");
      estatePlanOptions.querySelectorAll("[data-estate-plan]").forEach(function (button) {
        button.addEventListener("click", function () {
          selectedPlan = button.dataset.estatePlan;
          refreshAll();
        });
      });
    } else {
      estateChoiceWrap.classList.add("hidden");
      estatePlanOptions.innerHTML = "";
    }

    if (assets.length >= config.estatePricing.customReviewStartsAt) {
      largeEstateNote.classList.remove("hidden");
      largeEstateNote.innerHTML = `<strong>Large-estate review</strong>This inventory contains ${assets.length} appliances. Wilson will review the portfolio and confirm the custom proposal before any charge is made.`;
    } else {
      largeEstateNote.classList.add("hidden");
      largeEstateNote.innerHTML = "";
    }
  }

  function renderSummary() {
    const selected = planById(selectedPlan);
    const total = assets.length ? planCost(selectedPlan) : 0;
    const standardCount = assets.filter((item) => item.group !== "imuc").length;
    const imucCount = imucAssets().length;
    const secondImucCount = imucSecondVisitCount(selectedPlan);
    const filterSummary = filters.summary(assets, selectedPlan);
    const filterIncluded = filterSummary.included;
    const adjustment = estateAdjustment(selectedPlan);

    summaryPlanName.textContent = assets.length ? selected.name : "Start by adding appliances";
    summaryTotal.innerHTML = `${ui.money(total)} <small>/ year</small>`;
    /*
     * WHAT THE CARD ACTUALLY SEES, under the annual figure.
     *
     * "$1,694.90 / year" reads as spread across the year. It is not: that house
     * is charged $1,195.00 at the first visit and $499.90 about five months
     * later, and on Preferred or Concierge the entire annual amount lands at
     * the first visit. Nobody saw either of those before v0.9.25, so the second
     * charge arrived unexplained and the first was bigger than expected.
     *
     * One line, not a table -- the annual figure stays the headline. Read from
     * WILSON_PRICING.chargeSchedule, which is the same function store.js builds
     * the actual visits from, so this cannot preview a split that never happens.
     */
    const splitHost = document.getElementById("summary-charge-split");
    if (splitHost) {
      const schedule = assets.length
        ? window.WILSON_PRICING.chargeSchedule(assets, selectedPlan) : [];
      /* A single charge needs no explaining -- saying "first visit $1,195" when
         that is the only charge there will ever be invents a second one. */
      const worthShowing = schedule.length > 1;
      splitHost.hidden = !worthShowing;
      splitHost.innerHTML = worthShowing
        ? schedule.map(function (leg) {
            return `<span><em>${ui.escapeHtml(leg.label)}</em>${
              leg.amount > 0 ? ui.money(leg.amount) : "Included"}</span>`;
          }).join("")
        : "";
    }
    /* The phone's running-total bar. A copy of the figure above, never a second
       calculation, and it exists only once something has been picked. */
    paintTotalBar(assets.length, total, assets.length ? selected.name : "");
    document.getElementById("summary-appliance-count").textContent = assets.length;
    document.getElementById("summary-area-count").textContent = areas.length;
    document.getElementById("summary-visit-count").textContent = assets.length ? selected.visitsPerYear : "—";
    submitButton.disabled = !assets.length;
    /* The quote exit is gated on the same thing the enrollment exit is: there
       is nothing to price until something is on the list. */
    const quoteBtn = document.getElementById("send-quote-button");
    if (quoteBtn) quoteBtn.disabled = !assets.length;

    let lines = "";
    if (!assets.length) {
      lines = `<div class="summary-placeholder">Select appliance categories to build the plan.</div>`;
    } else if (selectedPlan === "per_appliance") {
      if (standardCount) lines += `<div class="summary-line"><span>Standard appliances × ${standardCount}</span><strong>${ui.money(standardCount * config.pricing.standardApplianceAnnual)}</strong></div>`;
      if (imucCount) lines += `<div class="summary-line"><span>Icemaker first visit × ${imucCount}</span><strong>${ui.money(imucCount * config.pricing.imucPerVisit)}</strong></div>`;
      if (secondImucCount) lines += `<div class="summary-line"><span>Recommended second icemaker visit × ${secondImucCount}</span><strong>${ui.money(secondImucCount * config.pricing.imucPerVisit)}</strong></div>`;
    } else {
      lines += `<div class="summary-line"><span>${ui.escapeHtml(selected.name)} base</span><strong>${ui.money(selected.annualPrice)}</strong></div>`;
      if (adjustment.amount) lines += `<div class="summary-line"><span>Appliances above ${config.estatePricing.includedAppliances} × ${adjustment.extraCount}</span><strong>${ui.money(adjustment.amount)}</strong></div>`;
      if (secondImucCount) lines += `<div class="summary-line"><span>Second icemaker visit × ${secondImucCount}</span><strong>${ui.money(secondImucCount * config.pricing.imucPerVisit)}</strong></div>`;

    }
    /* Wilson Temp Watch, when any refrigerator picked it up on the add-on
       card. One line, from the one engine, with the draft-price status. */
    (function () {
      if (!tempwatch) return;
      const sensors = assets.reduce(function (n, a) { return n + tempwatch.forAsset(a).sensors; }, 0);
      if (!sensors) return;
      const amount = tempwatch.total(assets, "member", selectedPlan);
      const included = Math.min(sensors, tempwatch.included ? tempwatch.included(selectedPlan) : 0);
      const tmName = (config.tempMonitoring || {}).serviceShortName || "Temp Monitoring";
      const note = included > 0
        ? ` <small>(${included} included with ${ui.escapeHtml(planById(selectedPlan).shortName || planById(selectedPlan).name)}${sensors > included ? ", " + (sensors - included) + " additional" : ""})</small>`
        : (sensors > 1 ? " <small>(first + additional rate)</small>" : "");
      lines += `<div class="summary-line"><span>${ui.escapeHtml(tmName)} × ${sensors} sensor${sensors === 1 ? "" : "s"}${note}</span><strong>${amount ? ui.money(amount) : "Included"}</strong></div>`;
    })();
    /* Priced filter service, one line per kind. Previously this said "Added"
       with no amount and contributed nothing to the total. */
    Object.keys(filterSummary.kinds).forEach(function (kindId) {
      const bucket = filterSummary.kinds[kindId];
      const detail = `${bucket.shortLabel} × ${bucket.quantity}`;
      if (filterIncluded) {
        lines += `<div class="summary-line"><span>${ui.escapeHtml(detail)}</span><strong>Included</strong></div>`;
      } else {
        lines += `<div class="summary-line"><span>${ui.escapeHtml(detail)} <small>(${ui.money(bucket.unitPrice)} ea)</small></span><strong>${ui.money(bucket.amount)}</strong></div>`;
      }
    });
    if (filterSummary.total) {
      lines += `<div class="summary-line subline"><span>${ui.escapeHtml(config.refrigerationFilterService.pricing.pricingStatus)}</span><strong></strong></div>`;
      /* The estimate promise, at the moment of submission: no model number
         was asked for, so the filter price is Wilson's standard rate until
         the office verifies the exact part — before the first charge. */
      if (config.refrigerationFilterService.pricing.estimateNote) {
        lines += `<div class="summary-line subline"><span>${ui.escapeHtml(config.refrigerationFilterService.pricing.estimateNote)}</span><strong></strong></div>`;
      }
    }
    /* Repeat any limited-scope disclosure in the summary, so it is on screen at
       the moment the customer submits rather than only when they added the tile. */
    const scopeNotes = [];
    config.customerApplianceCategories.forEach(function (category) {
      if (!category.scopeNote) return;
      const count = assets.filter((a) => a.customerCategory === category.id
        || a.containerCategory === category.id).length;
      if (count) scopeNotes.push(`${category.label}: ${category.scopeNote}`);
    });
    scopeNotes.forEach(function (note) {
      lines += `<div class="summary-line summary-scope-note"><span>${ui.escapeHtml(note)}</span><strong></strong></div>`;
    });

    if (assets.length) {
      lines += `<div class="summary-line"><span>Household areas</span><strong>${areas.length}</strong></div>`;
      lines += `<div class="summary-line"><span>Card authorization</span><strong>${paymentReady ? "Connected" : "Not connected"}</strong></div>`;
    }
    summaryLines.innerHTML = lines;

    if (estateEligible()) {
      summaryRecommendation.innerHTML = `<div class="callout"><strong>Best-value guardrail</strong>Estate pricing is active. We selected the lowest-cost Estate service level for this mix; you can still choose Annual, Preferred, or Concierge.</div>`;
    } else if (assets.length) {
      summaryRecommendation.innerHTML = `<div class="callout info"><strong>Nothing else to compare</strong>The form will reveal Estate choices automatically only if they become a better value.</div>`;
    } else {
      summaryRecommendation.innerHTML = "";
    }
  }

  function refreshAll() {
    enforceAutomaticPlan();
    assets.forEach(function (asset) {
      const area = areaById(asset.areaId);
      asset.location = area.name;
    });
    renderPicker();
    renderAreaBoard();
    renderPlan();
    renderSummary();
    if (amendment) renderAmendmentPanel();
  }

  function addArea(name) {
    const clean = String(name || "").trim();
    if (!clean) return;
    if (areas.some((area) => area.name.toLowerCase() === clean.toLowerCase())) {
      ui.toast("Area already exists", `${clean} is already on this household.`);
      return;
    }
    areas.push({ id: makeId("area"), name: clean, locked: false });
    document.getElementById("new-area-name").value = "";
    document.getElementById("add-area-panel").classList.add("hidden");
    refreshAll();
  }

  function formValue(name) {
    const field = document.querySelector(`[name="${name}"]`);
    return field ? field.value.trim() : "";
  }

  function fillContact(contact) {
    if (!contact) return;
    const map = {
      firstName: "first-name",
      lastName: "last-name",
      householdLabel: "household-label",
      phone: "phone",
      email: "email",
      address1: "address1",
      address2: "address2",
      city: "city",
      state: "state",
      zip: "zip",
      notes: "notes"
    };
    Object.keys(map).forEach(function (key) {
      if (contact[key]) document.getElementById(map[key]).value = contact[key];
    });
  }

  function loadInvoiceDraft() {
    if (!window.WilsonStore || typeof WilsonStore.loadInvoiceDraft !== "function") return false;
    const draft = WilsonStore.loadInvoiceDraft();
    if (!draft || !Array.isArray(draft.assets) || !draft.assets.length) return false;

    areas = [{ id: "area_main", name: "Main House", locked: true }];
    (draft.areas || []).forEach(function (area) {
      const name = String(area.name || "").trim();
      if (!name || name.toLowerCase() === "main house") return;
      areas.push({ id: area.id || makeId("area"), name, locked: false });
    });
    if ((draft.areas || []).some((area) => String(area.name).toLowerCase().includes("unassigned")) && !areas.some((area) => area.name.toLowerCase().includes("unassigned"))) {
      areas.push({ id: "area_unassigned", name: "Unassigned — Review", locked: false });
    }

    assets = draft.assets.map(normalizeImportedAsset);
    selectedPlan = "per_appliance";
    importedDraftLoaded = true;
    document.getElementById("invoice-import-banner").classList.remove("hidden");
    fillContact(draft.contact || {});
    refreshAll();
    ui.toast("Invoice inventory loaded", `${assets.length} maintenance appliance records were brought into the enrollment.`);
    return true;
  }

  function loadDemoHome() {
    areas = [
      { id: "area_main", name: "Main House", locked: true },
      { id: "area_casita", name: "Casita", locked: false }
    ];
    assets = [];
    ["refrigeration", "refrigeration", "ice_maker", "ice_maker", "dishwasher", "dishwasher", "range", "ventilation", "microwave", "ovens", "washer", "dryer"].forEach(function (categoryId, index) {
      const areaId = index % 4 === 1 ? "area_casita" : "area_main";
      assets.push(newAsset(categoryId, { areaId, location: areaById(areaId).name }));
    });
    refreshAll();
  }

  /*
   * TWO EXITS, ONE GATE EACH.  (v0.9.23)
   *
   * This screen now leads to an enrollment OR a quote, and the difference
   * between them is entirely what the customer has agreed to -- not what Wilson
   * knows about their house. The appliance list, the areas, the plan and the
   * price are identical either way, because they come from the same picker and
   * the same arithmetic.
   *
   * So the gates differ only at the end:
   *
   *   quote       an appliance list, a name, an address, and a way to reach
   *               them. Demanding a card on file to find out a price is absurd.
   *   enrollment  all of that, plus a payment method and the renewal
   *               authorization -- the two things that make it an agreement.
   */
  function missingAppliances() {
    if (assets.length) return false;
    ui.toast("Add an appliance", "Select at least one appliance category.");
    document.getElementById("picker-section").scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  function focusField(name) {
    const first = document.querySelector(`[name="${name}"]`);
    if (first) {
      first.focus();
      first.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /* Who they are and where the house is: needed to send a price to anybody. */
  function validateForQuote() {
    if (missingAppliances()) return false;
    const required = ["firstName", "lastName", "address1", "city", "state", "zip"];
    const missing = required.filter((name) => !formValue(name));
    if (missing.length) {
      ui.toast("Property details needed",
               "A quote needs the customer's name and the service address.");
      focusField(missing[0]);
      return false;
    }
    /* EITHER, not both. A quote that cannot be sent back to anyone is a
       screenshot with extra steps, but which channel it goes out on is the
       customer's business and not a form's. */
    if (!formValue("phone") && !formValue("email")) {
      ui.toast("A way to reach them", "Add an email address or a phone number so the quote can be sent.");
      focusField("email");
      return false;
    }
    return true;
  }

  function validate() {
    if (!validateForQuote()) return false;
    const required = ["phone", "email"];
    const missing = required.filter((name) => !formValue(name));
    if (missing.length) {
      ui.toast("Household information needed", "Complete the required contact and service-address fields.");
      focusField(missing[0]);
      return false;
    }
    if (!paymentReady) {
      ui.toast("Payment method needed", "Connect the secure payment method before submitting the enrollment.");
      document.getElementById("connect-payment").focus();
      return false;
    }
    if (!document.getElementById("renewal-authorization").checked) {
      ui.toast("Renewal authorization needed", "Confirm the annual renewal and scheduled-maintenance charge authorization.");
      document.getElementById("renewal-authorization").focus();
      return false;
    }
    return true;
  }

  document.getElementById("show-add-area").addEventListener("click", function () {
    document.getElementById("add-area-panel").classList.remove("hidden");
    document.getElementById("new-area-name").focus();
  });
  document.getElementById("cancel-add-area").addEventListener("click", function () {
    document.getElementById("add-area-panel").classList.add("hidden");
  });
  document.getElementById("confirm-add-area").addEventListener("click", function () {
    addArea(document.getElementById("new-area-name").value);
  });
  document.getElementById("new-area-name").addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      addArea(event.target.value);
    }
  });
  document.querySelectorAll("[data-quick-area]").forEach(function (button) {
    button.addEventListener("click", function () { addArea(button.dataset.quickArea); });
  });

  document.getElementById("connect-payment").addEventListener("click", function () {
    paymentReady = true;
    document.getElementById("payment-dot").classList.add("ready");
    document.getElementById("payment-title").textContent = "Demo card connected";
    document.getElementById("payment-subtitle").textContent = "Stripe SetupIntent return simulated — ending in 4242";
    document.getElementById("connect-payment").textContent = "Connected";
    document.getElementById("connect-payment").disabled = true;
    renderSummary();
    ui.toast("Payment setup simulated", "The production button will launch Stripe's secure payment-method flow.");
  });

  document.getElementById("clear-import-draft").addEventListener("click", function () {
    if (window.WilsonStore && typeof WilsonStore.clearInvoiceDraft === "function") WilsonStore.clearInvoiceDraft();
    importedDraftLoaded = false;
    assets = [];
    areas = [{ id: "area_main", name: "Main House", locked: true }];
    document.getElementById("invoice-import-banner").classList.add("hidden");
    refreshAll();
  });

  /*
   * THE PAYLOAD, built in exactly one place.
   *
   * Both exits call this. That is the whole point of the v0.9.23 consolidation:
   * quote-builder.js used to construct its own version of this object with its
   * own pricing, and it was missing filter service entirely -- an 18-appliance
   * house quoted $1,874.90 on Estate Annual and enrolled at $2,224.90. A quote
   * is now the same object as the enrollment it becomes, so the two numbers
   * cannot be different numbers.
   */
  function buildEnrollmentPayload() {
    const payloadAssets = assets.map(function (asset) {
      const category = categoryById(asset.customerCategory);
      const area = areaById(asset.areaId);
      return Object.assign({}, asset, {
        type: asset.exactType || asset.type || category.id,
        typeLabel: asset.exactTypeLabel || asset.typeLabel || category.label,
        customerCategory: category.id,
        location: area.name,
        areaId: area.id
      });
    });

    return {
      category: "appliance",
      planId: selectedPlan,
      annualAmount: planCost(selectedPlan),
      assets: payloadAssets,
      areas: areas,
      paymentReady,
      autoRenew: true,
      filterManagement: filters.planIncludesFilters(selectedPlan)
        || assets.some((item) => item.filterServiceOptIn || item.airFilterServiceOptIn),
      standardFiltersIncluded: selectedPlan === "estate_concierge",
      /* Null on the quote path. A customer who has been shown a price has not
         agreed to anything, and stamping a timestamp here because the object
         happens to have the field would put a fabricated acceptance on the
         record. The enrollment exit sets it below, where it is true. */
      acceptedTermsAt: null,
      /* areaCount is the only line this screen adds -- areas are a property of
         the household being built, not of the price. */
      pricingBreakdown: Object.assign(
        window.WILSON_PRICING.breakdown(assets, selectedPlan),
        { areaCount: areas.length }
      ),
      firstName: formValue("firstName"),
      lastName: formValue("lastName"),
      householdLabel: formValue("householdLabel"),
      preferredContact: formValue("preferredContact"),
      phone: formValue("phone"),
      email: formValue("email"),
      address1: formValue("address1"),
      address2: formValue("address2"),
      city: formValue("city"),
      state: formValue("state"),
      zip: formValue("zip"),
      /*
       * The structured preference, plus a rendered one-line copy.
       *
       * `schedulingPreference` is the record: ids only, so every screen renders
       * the same constraint the same way. `preferredMonths` keeps the one-line
       * summary because the admin queue, the confirmation page and the seeded
       * subscriptions all read it -- a denormalised DISPLAY copy, derived here
       * and never entered, the same pattern as household.waterTest.
       */
      schedulingPreference: schedulingForm ? schedulingForm.read() : null,
      preferredMonths: schedulingForm && !schedulingForm.isEmpty()
        ? window.WILSON_SCHEDULING.summary(schedulingForm.read())
        : "Office to confirm",
      notes: formValue("notes")
    };
  }

  /* EXIT ONE: the enrollment. */
  document.getElementById("appliance-enrollment-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (!validate()) return;
    const payload = buildEnrollmentPayload();
    /* True here and only here: they connected a payment method and ticked the
       renewal authorization to get this far. */
    payload.acceptedTermsAt = new Date().toISOString();
    WilsonStore.createEnrollment(payload);
    if (typeof WilsonStore.clearInvoiceDraft === "function") WilsonStore.clearInvoiceDraft();
    window.location.href = "confirmation.html";
  });

  /* EXIT TWO: the quote. Same list, same plan, same price -- no agreement. */
  const quoteButton = document.getElementById("send-quote-button");
  if (quoteButton) quoteButton.addEventListener("click", function () {
    if (!validateForQuote()) return;
    const enrollment = buildEnrollmentPayload();
    const label = formValue("householdLabel")
      || (formValue("firstName") + " " + formValue("lastName")).trim();
    const valid = new Date();
    valid.setDate(valid.getDate() + Number(config.assumptions.quoteValidDays || 30));
    const quote = WilsonStore.saveQuote({
      status: "Draft",
      propertyName: label,
      contactName: (formValue("firstName") + " " + formValue("lastName")).trim(),
      contactEmail: formValue("email"),
      contactPhone: formValue("phone"),
      address: [formValue("address1"), formValue("address2"), formValue("city"),
                formValue("state"), formValue("zip")].filter(Boolean).join(", "),
      validUntil: valid.toISOString().slice(0, 10),
      notes: formValue("notes"),
      /* The payload itself. Everything above is paperwork about it. */
      enrollment: enrollment
    });
    if (typeof WilsonStore.clearInvoiceDraft === "function") WilsonStore.clearInvoiceDraft();
    window.location.href = "quote-view.html?id=" + encodeURIComponent(quote.id);
  });

  /*
   * =====================================================================
   * AMENDMENT MODE                                              (v0.9.41)
   * =====================================================================
   *
   * Cayden: "when the button is hit, it should move the existing plan and
   * its pricing back into the registration part of the tool with pre filled
   * appliance lists and amount and then allow the tech or admin to add on
   * additional appliances and get an updated price. an updated price after
   * an original registration should populate an approval button for the
   * customer to hit on the techs phone while in the field instead of a
   * submit enrollment or send quote button. maybe even a signature box."
   *
   * So `?amend=<householdId>` reopens THIS screen -- same picker, same
   * areas, same pricing engine, one implementation -- with the plan's
   * appliances pre-filled and locked, the plan's annual as the baseline, and
   * the two exits replaced by one: the customer's approval, signed on the
   * phone. Contact, scheduling and payment sections are hidden because all
   * three are already on file. Nothing here re-prices anything: the new
   * total is planCost() over the combined list, exactly what a fresh
   * registration of the same house would compute.
   */
  /* Whether a STORED asset belongs on this builder at all -- resolved through
     the config's own category resolver, because store records carry the exact
     type ("freezer") where this screen's picker carries the customer category
     ("refrigeration"). Matching on raw ids here silently dropped three of
     Okafor's seven appliances during testing, which would have re-priced the
     plan DOWN and made the "difference" a refund. HVAC is excluded by its
     group; everything else resolves or it does not board. */
  function amendableAsset(asset) {
    if (!asset || asset.group === "hvac") return false;
    const resolved = window.WILSON_BRANDS.categoryForAsset(asset);
    return Boolean(resolved && config.customerApplianceCategories.some(function (c) { return c.id === resolved; }));
  }

  function enterAmendmentMode(householdId) {
    const state = WilsonStore.load();
    const household = (state.households || []).find(function (h) { return h.id === householdId; });
    const subscription = (state.subscriptions || []).find(function (s) {
      return s.householdId === householdId && s.category === "appliance";
    });
    if (!household || !subscription) {
      ui.toast("Nothing to amend", "That household has no appliance plan on file; starting a fresh registration instead.");
      return false;
    }

    /* Areas: the household's saved list, else rebuilt from where its
       appliances actually live. area_main survives either way. */
    if (Array.isArray(household.areas) && household.areas.length) {
      areas = household.areas.map(function (a) { return Object.assign({}, a); });
    }
    const existing = (state.assets || []).filter(function (a) {
      return a.householdId === householdId && a.status !== "Removed" && amendableAsset(a);
    });
    existing.forEach(function (stored) {
      let area = areas.find(function (a) { return a.id === stored.areaId; })
        || areas.find(function (a) { return a.name === stored.location; });
      if (!area && stored.location) {
        area = { id: makeId("area"), name: stored.location };
        areas.push(area);
      }
      assets.push(Object.assign({}, stored, {
        locked: true,
        /* Normalized so the picker counts, the cards and the pricing engine
           all see the category this screen speaks. */
        customerCategory: window.WILSON_BRANDS.categoryForAsset(stored),
        areaId: (area || areas[0]).id
      }));
    });

    selectedPlan = subscription.planId || selectedPlan;
    amendment = {
      household: household,
      subscription: subscription,
      previousAnnual: Number(subscription.annualAmount || 0),
      /* What the locked appliances' add-ons looked like when the screen
         opened -- the diff against this is part of what gets approved. */
      optInSnapshot: existing.reduce(function (all, a) {
        all[a.id] = {
          tempMonitoringOptIn: Boolean(a.tempMonitoringOptIn),
          filterServiceOptIn: Boolean(a.filterServiceOptIn),
          airFilterServiceOptIn: Boolean(a.airFilterServiceOptIn),
          imucVisitsPerYear: Number(a.imucVisitsPerYear || 1)
        };
        return all;
      }, {})
    };

    /* The parts of registration that are already on file. */
    const contactSection = document.getElementById("first-name").closest("section.form-section");
    if (contactSection) contactSection.hidden = true;
    const schedulingSection = document.getElementById("scheduling-section");
    if (schedulingSection) schedulingSection.hidden = true;
    const paymentSection = document.getElementById("connect-payment").closest("section.form-section");
    if (paymentSection) paymentSection.hidden = true;
    /* display, not [hidden]: .button's own display rule outranks the
       attribute, and a Submit button that survives into an amendment is a
       second enrollment waiting to happen. */
    submitButton.style.display = "none";
    const quoteExit = document.getElementById("send-quote-button");
    if (quoteExit) quoteExit.style.display = "none";
    document.querySelectorAll(".summary-body > .disclaimer").forEach(function (p) { p.style.display = "none"; });

    const title = document.querySelector(".enrollment-title h1");
    if (title) title.textContent = "Add to " + household.name + "'s plan";
    const titleCopy = document.querySelector(".enrollment-title p");
    if (titleCopy) titleCopy.textContent = "Everything already on the plan is below, locked. Add appliances or add-ons, the price updates from the same engine registration uses, and the customer approves the difference right here.";

    /* The approval panel replaces both exits. */
    const summaryBody = document.querySelector(".summary-body");
    const panel = document.createElement("div");
    panel.className = "amend-approve-panel";
    panel.id = "amend-approve-panel";
    panel.innerHTML = `
      <div class="summary-line"><span>On file today</span><strong>${ui.money(amendment.previousAnnual)} / year</strong></div>
      <div class="summary-line amend-plan-line" id="amend-plan-line" hidden><span>Plan changes</span><strong id="amend-plan-change">—</strong></div>
      <div class="summary-line"><span>New total</span><strong id="amend-new-total">—</strong></div>
      <div class="summary-line"><span>Yearly difference</span><strong id="amend-difference">—</strong></div>
      <div class="summary-line amend-diff-line"><span>Billed today (prorated)</span><strong id="amend-prorated">—</strong></div>
      <p class="amend-prorate-note" id="amend-prorate-note"></p>
      <div id="amend-removed"></div>
      <p class="amend-sign-hint">Customer signs below to approve the change. The office confirms it and settles the difference on the card on file — nothing is billed from this screen.</p>
      <div class="amend-signature-wrap">
        <canvas id="amend-signature" height="110" aria-label="Customer signature"></canvas>
        <span class="amend-signature-baseline">✕</span>
        <button type="button" class="amend-signature-clear" id="amend-signature-clear">Clear</button>
      </div>
      <button type="button" class="button wide" id="amend-approve-button" disabled>Customer approves</button>`;
    summaryBody.insertBefore(panel, summaryBody.querySelector(".submit-enrollment-button"));
    wireSignaturePad();
    document.getElementById("amend-approve-button").addEventListener("click", approveAmendment);
    refreshAll();
    return true;
  }

  function amendmentChanges() {
    const addedAssets = assets.filter(function (a) { return !a.locked; }).map(function (asset) {
      const category = categoryById(asset.customerCategory);
      const area = areaById(asset.areaId);
      const row = Object.assign({}, asset, {
        type: asset.exactType || asset.type || category.id,
        typeLabel: asset.exactTypeLabel || asset.typeLabel || category.label,
        customerCategory: category.id,
        location: area.name,
        areaId: area.id
      });
      delete row.locked;
      return row;
    });
    const optInSync = assets.filter(function (a) { return a.locked; }).map(function (a) {
      const before = amendment.optInSnapshot[a.id] || {};
      const now = {
        tempMonitoringOptIn: Boolean(a.tempMonitoringOptIn),
        filterServiceOptIn: Boolean(a.filterServiceOptIn),
        airFilterServiceOptIn: Boolean(a.airFilterServiceOptIn),
        imucVisitsPerYear: Number(a.imucVisitsPerYear || 1)
      };
      const changed = Object.keys(now).some(function (k) { return now[k] !== before[k]; });
      return changed ? Object.assign({ assetId: a.id }, now) : null;
    }).filter(Boolean);
    return {
      addedAssets: addedAssets,
      optInSync: optInSync,
      removedAssetIds: removedAssets.map(function (a) { return a.id; }),
      any: addedAssets.length > 0 || optInSync.length > 0 || removedAssets.length > 0
    };
  }

  function renderAmendmentPanel() {
    const totalHost = document.getElementById("amend-new-total");
    if (!totalHost) return;
    const newAnnual = planCost(selectedPlan);
    const difference = Math.round((newAnnual - amendment.previousAnnual) * 100) / 100;
    const changes = amendmentChanges();
    totalHost.textContent = ui.money(newAnnual) + " / year";
    /* v0.9.48: a plan change rides the signature as its own named line --
       never a silent side effect of the appliance mix. */
    const planLine = document.getElementById("amend-plan-line");
    if (planLine) {
      const planMoved = selectedPlan !== amendment.subscription.planId;
      planLine.hidden = !planMoved;
      if (planMoved) {
        document.getElementById("amend-plan-change").textContent =
          (planById(amendment.subscription.planId).name || amendment.subscription.planId) + " → " + planById(selectedPlan).name;
      }
    }
    const diffHost = document.getElementById("amend-difference");
    diffHost.textContent = (difference >= 0 ? "+" : "−") + ui.money(Math.abs(difference)) + " / year";
    /* v0.9.43: prorate and fall into the normal schedule at renewal.
       v0.9.49, Cayden's correction: an added appliance is serviced at THIS
       visit, so its increase is full price. Same helper the store records
       (WILSON_PRICING.amendmentBilling), so the number on this screen IS the
       number the office charges. */
    const proration = window.WILSON_PRICING.amendmentBilling(difference, amendment.subscription.renewalOn, {
      hasAdditions: changes.addedAssets.length > 0
    });
    const proratedHost = document.getElementById("amend-prorated");
    proratedHost.textContent = (proration.amount >= 0 ? "+" : "−") + ui.money(Math.abs(proration.amount));
    proratedHost.parentNode.classList.toggle("credit", proration.amount < 0);
    const prorateNote = document.getElementById("amend-prorate-note");
    prorateNote.textContent = proration.servicedNow
      ? "Full-year price — the added appliance" + (changes.addedAssets.length === 1 ? " is" : "s are") +
        " serviced at this visit, so the year of service starts today. The " + ui.money(newAnnual) +
        " annual takes over on the normal schedule at renewal" +
        (amendment.subscription.renewalOn ? " (" + amendment.subscription.renewalOn + ")" : "") + "."
      : proration.renewalPassed
      ? "This plan's renewal date has passed, so the full yearly difference is due now and the office will roll the renewal forward."
      : proration.daysRemaining === null
        ? "No renewal date on file — the full difference bills now."
        : proration.daysRemaining + " days left this plan year. The " + ui.money(newAnnual) +
          " annual takes over on the normal schedule at renewal" +
          (amendment.subscription.renewalOn ? " (" + amendment.subscription.renewalOn + ")" : "") + ".";
    /* What is coming off the plan, right where the signature happens, each
       with its undo -- nothing is gone until the customer signs. */
    const removedHost = document.getElementById("amend-removed");
    if (removedHost) {
      removedHost.innerHTML = removedAssets.length
        ? '<div class="amend-removed-list"><strong>Coming off the plan</strong>' +
          removedAssets.map(function (a) {
            return '<span class="amend-removed-chip">' + ui.escapeHtml(a.typeLabel || a.type) +
              (a.location ? " · " + ui.escapeHtml(a.location) : "") +
              ' <button type="button" data-amend-restore="' + ui.escapeHtml(a.id) + '">Undo</button></span>';
          }).join("") + "</div>"
        : "";
      removedHost.querySelectorAll("[data-amend-restore]").forEach(function (btn) {
        btn.addEventListener("click", function () { restoreRemovedAsset(btn.dataset.amendRestore); });
      });
    }
    const button = document.getElementById("amend-approve-button");
    button.disabled = !(changes.any && signatureDrawn);
    button.textContent = !changes.any
      ? "Change the plan first — add, remove, or pick an add-on"
      : (!signatureDrawn
        ? "Sign above to approve"
        : (proration.amount > 0
          ? "Customer approves — bill " + ui.money(proration.amount) + " today"
          : proration.amount < 0
            ? "Customer approves — " + ui.money(Math.abs(proration.amount)) + " prorated reduction"
            : "Customer approves the change"));
  }

  /*
   * The signature box Cayden asked about ("maybe even a signature box. is
   * this possible?") -- yes: a plain canvas, drawn with pointer events, saved
   * as an image on the amendment record. Approval stays disabled until a
   * stroke lands on it, because on this screen the signature IS the approval.
   */
  function wireSignaturePad() {
    const canvas = document.getElementById("amend-signature");
    const ctx = canvas.getContext("2d");
    let drawing = false;
    function sizePad() {
      const scale = window.devicePixelRatio || 1;
      const width = canvas.parentNode.clientWidth - 2;
      canvas.width = width * scale; canvas.height = 110 * scale;
      canvas.style.width = width + "px"; canvas.style.height = "110px";
      ctx.scale(scale, scale);
      ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = "#26332c";
    }
    sizePad();
    function point(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    canvas.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      drawing = true;
      const p = point(event);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke();
      if (!signatureDrawn) { signatureDrawn = true; renderAmendmentPanel(); }
    });
    canvas.addEventListener("pointermove", function (event) {
      if (!drawing) return;
      const p = point(event);
      ctx.lineTo(p.x, p.y); ctx.stroke();
    });
    ["pointerup", "pointercancel"].forEach(function (type) {
      canvas.addEventListener(type, function () { drawing = false; });
    });
    document.getElementById("amend-signature-clear").addEventListener("click", function () {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
      signatureDrawn = false;
      renderAmendmentPanel();
    });
  }

  function approveAmendment() {
    const changes = amendmentChanges();
    if (!changes.any || !signatureDrawn) return;
    const newAnnual = planCost(selectedPlan);
    const result = WilsonStore.amendEnrollment({
      householdId: amendment.household.id,
      subscriptionId: amendment.subscription.id,
      addedAssets: changes.addedAssets,
      optInSync: changes.optInSync,
      removedAssetIds: changes.removedAssetIds,
      areas: areas,
      planId: selectedPlan,
      newAnnual: newAnnual,
      pricingBreakdown: Object.assign(
        window.WILSON_PRICING.breakdown(assets, selectedPlan),
        { areaCount: areas.length }
      ),
      signatureDataUrl: document.getElementById("amend-signature").toDataURL("image/png"),
      approvedBy: "Customer, on the technician's device"
    });
    if (!result.ok) { ui.toast("Amendment blocked", result.message || "The plan could not be amended."); return; }
    window.location.href = "household.html?id=" + encodeURIComponent(amendment.household.id);
  }

  const params = new URLSearchParams(window.location.search);
  const amendId = params.get("amend");
  const amended = amendId ? enterAmendmentMode(amendId) : false;
  const loaded = !amended && params.get("import") === "1" ? loadInvoiceDraft() : false;
  if (!loaded && !amended) refreshAll();
  if (params.get("demo") === "1") {
    loadDemoHome();
    document.getElementById("first-name").value = "Ellen";
    document.getElementById("last-name").value = "Reynolds";
    document.getElementById("household-label").value = "Reynolds Household";
    document.getElementById("phone").value = "512-555-0148";
    document.getElementById("email").value = "ellen@example.com";
    document.getElementById("address1").value = "1840 Ridgeview Trail";
    document.getElementById("city").value = "Austin";
    document.getElementById("zip").value = "78738";
  }
})();

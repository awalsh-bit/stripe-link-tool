(function () {
  const config = window.WILSON_CONFIG;
  const ui = window.WilsonUI;
  const filters = window.WILSON_FILTERS;

  let assets = [];
  let areas = [{ id: "area_main", name: "Main House", locked: true }];
  let selectedPlan = "per_appliance";
  let paymentReady = false;
  let estateWasEligible = false;
  let draggedAssetId = null;
  let importedDraftLoaded = false;

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
    return assets.filter((asset) => asset.customerCategory === categoryId).length;
  }

  function addAsset(categoryId, overrides) {
    assets.push(newAsset(categoryId, overrides));
    refreshAll();
  }

  function removeOneByCategory(categoryId) {
    const index = [...assets].map((asset) => asset.customerCategory).lastIndexOf(categoryId);
    if (index >= 0) assets.splice(index, 1);
    refreshAll();
  }

  function removeAsset(assetId) {
    assets = assets.filter((asset) => asset.id !== assetId);
    refreshAll();
  }

  function selectedPlanVisits(planId) {
    return Number(planById(planId || selectedPlan).visitsPerYear || 1);
  }

  function imucAssets() {
    return assets.filter((item) => item.group === "imuc");
  }

  function imucSecondVisitCount(planId) {
    if (selectedPlanVisits(planId) >= 2) return 0;
    return imucAssets().filter((item) => Number(item.imucVisitsPerYear) >= 2).length;
  }

  function estateAdjustment(planId) {
    const extraCount = Math.max(0, assets.length - config.estatePricing.includedAppliances);
    const rate = config.estatePricing.additionalPerAppliance[planId] || 0;
    return { extraCount, rate, amount: extraCount * rate };
  }

  function perApplianceCost() {
    const standardCount = assets.filter((item) => item.group !== "imuc").length;
    const imucCount = imucAssets().length;
    const secondVisits = imucSecondVisitCount("per_appliance");
    return (standardCount * config.pricing.standardApplianceAnnual)
      + (imucCount * config.pricing.imucPerVisit)
      + (secondVisits * config.pricing.imucPerVisit);
  }

  /* Selected filter service raises the annual plan price on every plan except
     Estate Concierge, which includes filters outright. Priced through
     WILSON_FILTERS so the builder, the summary and the demo backend agree. */
  function filterServiceCost(planId) {
    return filters.total(assets, planId);
  }

  function planCost(planId) {
    if (planId === "per_appliance") return perApplianceCost() + filterServiceCost(planId);
    const plan = planById(planId);
    return plan.annualPrice
      + estateAdjustment(planId).amount
      + (imucSecondVisitCount(planId) * config.pricing.imucPerVisit)
      + filterServiceCost(planId);
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
            ${category.group === "imuc" ? '<span class="picker-recommended">2× yearly recommended</span>' : (category.filterServiceAvailable ? '<span class="picker-recommended filter-available">Filter service available</span>' : "")}
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
                <article class="selected-appliance-card ${asset.needsReview ? "needs-review" : ""}" draggable="true" data-asset-id="${asset.id}">
                  <div class="selected-appliance-drag" title="Drag to another area">⋮⋮</div>
                  <img src="${iconPath(category.id)}" alt="" class="selected-appliance-icon">
                  <div class="selected-appliance-copy">
                    <div class="selected-appliance-title">${ui.escapeHtml(category.label)}${number ? ` ${number}` : ""}${asset.needsReview ? '<span class="badge warning">Review</span>' : ""}</div>
                    <div class="selected-appliance-detail">${ui.escapeHtml(assetDetail(asset))}</div>
                    ${asset.sourceInvoice ? `<div class="selected-appliance-source">Invoice ${ui.escapeHtml(asset.sourceInvoice)}</div>` : ""}
                    ${asset.group === "imuc" ? `
                      <label class="imuc-mini-toggle ${planIncludesSecond ? "included" : ""}">
                        <input type="checkbox" data-imuc-toggle="${asset.id}" ${planIncludesSecond || Number(asset.imucVisitsPerYear) >= 2 ? "checked" : ""} ${planIncludesSecond ? "disabled" : ""}>
                        <span>${planIncludesSecond ? "Two visits included" : "Two visits yearly (recommended)"}</span>
                      </label>
                    ` : ""}
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
                  <div class="selected-appliance-controls">
                    <label><span>Move to</span><select data-move-asset="${asset.id}">${areaOptions(asset.areaId)}</select></label>
                    <button class="remove-appliance-icon" type="button" data-remove-asset="${asset.id}" aria-label="Remove ${ui.escapeHtml(category.label)}">×</button>
                  </div>
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
          <div><span class="simple-plan-eyebrow">Selected automatically</span><strong>Per-Appliance Maintenance</strong><p>You only pay for the ${assets.length} appliance${assets.length === 1 ? "" : "s"} selected above.</p></div>
          <div class="simple-plan-price">${ui.money(total)}<small>/ year</small></div>
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
    document.getElementById("summary-appliance-count").textContent = assets.length;
    document.getElementById("summary-area-count").textContent = areas.length;
    document.getElementById("summary-visit-count").textContent = assets.length ? selected.visitsPerYear : "—";
    submitButton.disabled = !assets.length;

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
    }
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

  function validate() {
    const required = ["firstName", "lastName", "phone", "email", "address1", "city", "state", "zip"];
    const missing = required.filter((name) => !formValue(name));
    if (!assets.length) {
      ui.toast("Add an appliance", "Select at least one appliance category.");
      document.getElementById("picker-section").scrollIntoView({ behavior: "smooth", block: "start" });
      return false;
    }
    if (missing.length) {
      ui.toast("Household information needed", "Complete the required contact and service-address fields.");
      const first = document.querySelector(`[name="${missing[0]}"]`);
      if (first) first.focus();
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

  document.getElementById("appliance-enrollment-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (!validate()) return;

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

    const payload = {
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
      acceptedTermsAt: new Date().toISOString(),
      pricingBreakdown: {
        basePlanAmount: selectedPlan === "per_appliance" ? perApplianceCost() : planById(selectedPlan).annualPrice,
        largeEstateAdjustment: selectedPlan === "per_appliance" ? 0 : estateAdjustment(selectedPlan).amount,
        imucSecondVisitCount: imucSecondVisitCount(selectedPlan),
        imucSecondVisitAmount: imucSecondVisitCount(selectedPlan) * config.pricing.imucPerVisit,
        applianceCount: assets.length,
        areaCount: areas.length,
        refrigerationFilterServiceCount: assets.filter((item) => filters.forAsset(item, selectedPlan).lines.length).length,
        filterServiceDetail: filters.summary(assets, selectedPlan),
        filterServiceAmount: filters.total(assets, selectedPlan),
        customReviewRequired: assets.length >= config.estatePricing.customReviewStartsAt
      },
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
      preferredMonths: formValue("preferredMonths"),
      notes: formValue("notes")
    };

    WilsonStore.createEnrollment(payload);
    if (typeof WilsonStore.clearInvoiceDraft === "function") WilsonStore.clearInvoiceDraft();
    window.location.href = "confirmation.html";
  });

  const params = new URLSearchParams(window.location.search);
  const loaded = params.get("import") === "1" ? loadInvoiceDraft() : false;
  if (!loaded) refreshAll();
  if (params.get("demo") === "1") {
    loadDemoHome();
    document.getElementById("first-name").value = "Ellen";
    document.getElementById("last-name").value = "Reynolds";
    document.getElementById("household-label").value = "Reynolds Estate";
    document.getElementById("phone").value = "512-555-0148";
    document.getElementById("email").value = "ellen@example.com";
    document.getElementById("address1").value = "1840 Ridgeview Trail";
    document.getElementById("city").value = "Austin";
    document.getElementById("zip").value = "78738";
  }
})();

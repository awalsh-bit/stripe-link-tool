(function () {
  const config = window.WILSON_CONFIG;
  const ui = window.WilsonUI;
  let assets = [];
  let selectedPlan = "per_appliance";
  let autoSelectedEstate = false;
  let autoSwitchText = "";
  let paymentReady = false;

  const list = document.getElementById("asset-list");
  const planOptions = document.getElementById("plan-options");
  const autoSwitchNotice = document.getElementById("auto-switch-notice");
  const largeEstateNote = document.getElementById("large-estate-note");
  const summaryTotal = document.getElementById("summary-total");
  const summaryLines = document.getElementById("summary-lines");
  const summaryRecommendation = document.getElementById("summary-recommendation");

  function typeById(typeId) {
    return config.applianceTypes.find((item) => item.id === typeId) || config.applianceTypes[config.applianceTypes.length - 1];
  }

  function blankAsset(typeId) {
    const type = typeById(typeId || "refrigerator");
    return {
      id: "draft_" + Math.random().toString(36).slice(2, 9),
      type: type.id,
      typeLabel: type.label,
      group: type.group,
      checkpointSet: type.checkpointSet,
      filterTypes: type.filterTypes || [],
      imucVisitsPerYear: type.group === "imuc" ? config.pricing.imucRecommendedVisitsPerYear : 1,
      brand: "",
      model: "",
      serial: "",
      location: ""
    };
  }

  function assetTypeOptions(selected) {
    return config.applianceTypes.map(function (type) {
      return `<option value="${type.id}" ${type.id === selected ? "selected" : ""}>${ui.escapeHtml(type.label)}</option>`;
    }).join("");
  }

  function selectedPlanVisits() {
    const plan = config.appliancePlans[selectedPlan];
    return plan ? plan.visitsPerYear : 1;
  }

  function imucFrequencyPanel(asset) {
    if (asset.group !== "imuc") return "";
    if (selectedPlanVisits() >= 2) {
      return `
        <div class="imuc-frequency included">
          <div><span class="badge success">Included twice yearly</span><strong>IMUC maintenance frequency</strong><p>${ui.escapeHtml(config.assumptions.imucGuidance)} This plan already includes two coordinated visits.</p></div>
          <div class="frequency-price">Included</div>
        </div>
      `;
    }
    return `
      <div class="imuc-frequency">
        <div class="imuc-frequency-copy">
          <div class="inline-actions"><span class="badge success">Recommended</span><strong>IMUC maintenance frequency</strong></div>
          <p>${ui.escapeHtml(config.assumptions.imucGuidance)}</p>
        </div>
        <div class="frequency-options" role="radiogroup" aria-label="Icemaker maintenance frequency">
          <label class="frequency-option ${asset.imucVisitsPerYear === 2 ? "selected" : ""}">
            <input type="radio" name="imuc-frequency-${asset.id}" value="2" data-imuc-visits="2" ${asset.imucVisitsPerYear === 2 ? "checked" : ""}>
            <span><strong>Twice annually</strong><small>Recommended · +${ui.money(config.pricing.imucPerVisit)} / year</small></span>
          </label>
          <label class="frequency-option ${asset.imucVisitsPerYear === 1 ? "selected" : ""}">
            <input type="radio" name="imuc-frequency-${asset.id}" value="1" data-imuc-visits="1" ${asset.imucVisitsPerYear === 1 ? "checked" : ""}>
            <span><strong>Once annually</strong><small>One ${ui.money(config.pricing.imucPerVisit)} visit</small></span>
          </label>
        </div>
      </div>
    `;
  }

  function filterNote(asset) {
    if (!asset.filterTypes || !asset.filterTypes.length) return "";
    return `<div class="asset-note"><strong>Filter profile:</strong> Wilson will verify ${ui.escapeHtml(asset.filterTypes.join(" and "))} details during setup.</div>`;
  }

  function renderAssets() {
    if (!assets.length) {
      list.innerHTML = `<div class="empty-state">No appliances added yet.</div>`;
      return;
    }

    list.innerHTML = assets.map(function (asset, index) {
      return `
        <article class="asset-card" data-asset-id="${asset.id}">
          <div class="asset-card-head">
            <div class="asset-index"><span class="asset-number">${index + 1}</span><span>${ui.escapeHtml(asset.typeLabel || "Appliance")}</span></div>
            <button class="remove-button" type="button" data-remove-asset="${asset.id}">Remove</button>
          </div>
          <div class="form-grid four">
            <div class="field">
              <label>Appliance type</label>
              <select data-asset-field="type">${assetTypeOptions(asset.type)}</select>
            </div>
            <div class="field">
              <label>Brand</label>
              <input data-asset-field="brand" value="${ui.escapeHtml(asset.brand)}" placeholder="Example: Sub-Zero">
            </div>
            <div class="field">
              <label>Model <span class="hint">Optional</span></label>
              <input data-asset-field="model" value="${ui.escapeHtml(asset.model)}" placeholder="Model number">
            </div>
            <div class="field">
              <label>Location</label>
              <input data-asset-field="location" value="${ui.escapeHtml(asset.location)}" placeholder="Main Kitchen">
            </div>
          </div>
          ${imucFrequencyPanel(asset)}
          ${filterNote(asset)}
        </article>
      `;
    }).join("");

    list.querySelectorAll("[data-remove-asset]").forEach(function (button) {
      button.addEventListener("click", function () {
        assets = assets.filter((item) => item.id !== button.dataset.removeAsset);
        if (!assets.length) assets.push(blankAsset("refrigerator"));
        renderAssets();
        refreshPricing();
      });
    });

    list.querySelectorAll("[data-asset-id]").forEach(function (card) {
      const asset = assets.find((item) => item.id === card.dataset.assetId);
      card.querySelectorAll("[data-asset-field]").forEach(function (input) {
        input.addEventListener("input", function () {
          const field = input.dataset.assetField;
          asset[field] = input.value;
          if (field === "type") {
            const previousGroup = asset.group;
            const type = typeById(input.value);
            asset.typeLabel = type.label;
            asset.group = type.group;
            asset.checkpointSet = type.checkpointSet;
            asset.filterTypes = type.filterTypes || [];
            if (type.group === "imuc" && previousGroup !== "imuc") {
              asset.imucVisitsPerYear = config.pricing.imucRecommendedVisitsPerYear;
            }
            if (type.group !== "imuc") asset.imucVisitsPerYear = 1;
            renderAssets();
            refreshPricing();
          }
        });
      });

      card.querySelectorAll("[data-imuc-visits]").forEach(function (radio) {
        radio.addEventListener("change", function () {
          asset.imucVisitsPerYear = Number(radio.dataset.imucVisits);
          renderAssets();
          refreshPricing();
        });
      });
    });
  }

  function addAsset(typeId) {
    assets.push(blankAsset(typeId));
    renderAssets();
    refreshPricing();
  }

  function imucAssets() {
    return assets.filter((item) => item.group === "imuc");
  }

  function imucSecondVisitCount(planId) {
    const plan = config.appliancePlans[planId];
    if (plan && plan.visitsPerYear >= 2) return 0;
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

  function planCost(planId) {
    if (planId === "per_appliance") return perApplianceCost();
    const plan = config.appliancePlans[planId];
    if (!plan) return 0;
    const adjustment = estateAdjustment(planId).amount;
    const imucAddOn = imucSecondVisitCount(planId) * config.pricing.imucPerVisit;
    return plan.annualPrice + adjustment + imucAddOn;
  }

  function currentAnnualCost() {
    return planCost(selectedPlan);
  }

  function enforceAutoSwitch() {
    if (!assets.length) return false;
    const perCost = planCost("per_appliance");
    const estateCost = planCost("estate_annual");
    if (selectedPlan === "per_appliance" && estateCost + 0.005 < perCost) {
      selectedPlan = "estate_annual";
      autoSelectedEstate = true;
      autoSwitchText = `Estate Annual became the lower-cost comparable option, so the plan changed automatically. The current estimate saves ${ui.money(perCost - estateCost)} per year.`;
      return true;
    }
    if (selectedPlan === "estate_annual" && autoSelectedEstate && perCost + 0.005 < estateCost) {
      selectedPlan = "per_appliance";
      autoSelectedEstate = false;
      autoSwitchText = `Per-appliance pricing became the lower-cost option again, so the plan changed automatically.`;
      return true;
    }
    return false;
  }

  function planFeatures(plan) {
    return (plan.features || []).map((item) => `<li>${ui.escapeHtml(item)}</li>`).join("");
  }

  function renderPlans() {
    planOptions.innerHTML = Object.values(config.appliancePlans).map(function (plan) {
      const currentPrice = plan.id === "per_appliance" ? planCost(plan.id) : planCost(plan.id);
      const priceLabel = assets.length ? ui.money(currentPrice) : (plan.id === "per_appliance" ? "Calculated" : ui.money(plan.annualPrice));
      const baseNote = plan.id !== "per_appliance" && estateAdjustment(plan.id).amount > 0
        ? `<div class="plan-adjustment">Includes ${ui.money(estateAdjustment(plan.id).amount)} large-estate adjustment</div>`
        : "";
      return `
        <label class="plan-option ${selectedPlan === plan.id ? "selected" : ""}" data-plan-id="${plan.id}">
          <input type="radio" name="planId" value="${plan.id}" ${selectedPlan === plan.id ? "checked" : ""}>
          <span class="plan-name"><span>${ui.escapeHtml(plan.name)}</span>${plan.id === "estate_concierge" ? '<span class="badge success">Full service</span>' : ""}</span>
          <div class="plan-price">${priceLabel} <small>/ year estimate</small></div>
          ${baseNote}
          <p>${ui.escapeHtml(plan.description)}</p>
          <ul class="plan-feature-list">${planFeatures(plan)}</ul>
        </label>
      `;
    }).join("");

    planOptions.querySelectorAll("[data-plan-id]").forEach(function (card) {
      card.addEventListener("click", function () {
        selectedPlan = card.dataset.planId;
        autoSelectedEstate = false;
        autoSwitchText = "";
        enforceAutoSwitch();
        renderAssets();
        refreshPricing();
      });
    });
  }

  function renderNotices() {
    if (autoSwitchText) {
      autoSwitchNotice.classList.remove("hidden");
      autoSwitchNotice.innerHTML = `<strong>Best-value plan selected automatically</strong>${ui.escapeHtml(autoSwitchText)}`;
    } else {
      autoSwitchNotice.classList.add("hidden");
      autoSwitchNotice.innerHTML = "";
    }

    if (assets.length >= config.estatePricing.customReviewStartsAt) {
      largeEstateNote.classList.remove("hidden");
      largeEstateNote.innerHTML = `<strong>Large-estate review</strong>This inventory contains ${assets.length} appliances. The estimate remains visible, but Wilson will review the portfolio and prepare a custom confirmation before any charge is made.`;
    } else {
      largeEstateNote.classList.add("hidden");
      largeEstateNote.innerHTML = "";
    }
  }

  function renderSummary() {
    const standardCount = assets.filter((item) => item.group !== "imuc").length;
    const imucCount = imucAssets().length;
    const secondVisitCount = imucSecondVisitCount(selectedPlan);
    const selectedCost = currentAnnualCost();
    const selected = config.appliancePlans[selectedPlan];
    const adjustment = estateAdjustment(selectedPlan);

    summaryTotal.innerHTML = `${ui.money(selectedCost)} <small>/ year</small>`;

    let lines = "";
    if (selectedPlan === "per_appliance") {
      lines += `<div class="summary-line"><span>Standard appliances × ${standardCount}</span><strong>${ui.money(standardCount * config.pricing.standardApplianceAnnual)}</strong></div>`;
      lines += `<div class="summary-line"><span>IMUC first annual visit × ${imucCount}</span><strong>${ui.money(imucCount * config.pricing.imucPerVisit)}</strong></div>`;
      if (secondVisitCount) lines += `<div class="summary-line"><span>Recommended second IMUC visit × ${secondVisitCount}</span><strong>${ui.money(secondVisitCount * config.pricing.imucPerVisit)}</strong></div>`;
    } else {
      lines += `<div class="summary-line"><span>${ui.escapeHtml(selected.name)} base</span><strong>${ui.money(selected.annualPrice)}</strong></div>`;
      if (adjustment.amount) lines += `<div class="summary-line"><span>Appliances above ${config.estatePricing.includedAppliances} × ${adjustment.extraCount}</span><strong>${ui.money(adjustment.amount)}</strong></div>`;
      if (secondVisitCount) lines += `<div class="summary-line"><span>Second IMUC visit × ${secondVisitCount}</span><strong>${ui.money(secondVisitCount * config.pricing.imucPerVisit)}</strong></div>`;
      lines += `<div class="summary-line"><span>Appliances inventoried</span><strong>${assets.length}</strong></div>`;
      lines += `<div class="summary-line"><span>Coordinated visits</span><strong>${selected.visitsPerYear} / year</strong></div>`;
      if (selectedPlan === "estate_concierge") lines += `<div class="summary-line"><span>Plan-covered filters</span><strong>Included</strong></div>`;
    }
    lines += `<div class="summary-line"><span>Card authorization</span><strong>${paymentReady ? "Connected" : "Not connected"}</strong></div>`;
    lines += `<div class="summary-line"><span>Renewal</span><strong>Annual until canceled</strong></div>`;
    summaryLines.innerHTML = lines;

    const perCost = planCost("per_appliance");
    const estateCost = planCost("estate_annual");
    if (selectedPlan === "estate_annual" && estateCost < perCost) {
      summaryRecommendation.innerHTML = `<div class="callout"><strong>Automatic value check</strong>Estate Annual is ${ui.money(perCost - estateCost)} lower than comparable per-appliance pricing for this inventory.</div>`;
    } else if (selectedPlan === "per_appliance") {
      const difference = estateCost - perCost;
      summaryRecommendation.innerHTML = `<div class="callout info"><strong>Whole-home comparison</strong>Estate Annual is currently ${ui.money(Math.max(0, difference))} above this per-appliance estimate. The form will switch automatically if that changes.</div>`;
    } else {
      summaryRecommendation.innerHTML = "";
    }
  }

  function refreshPricing() {
    const changed = enforceAutoSwitch();
    if (changed) ui.toast("Plan updated automatically", autoSwitchText);
    renderPlans();
    renderNotices();
    renderSummary();
  }

  function loadDemoHome() {
    const sample = [
      ["refrigerator", "Sub-Zero", "BI-48S", "Main Kitchen"],
      ["freezer", "Sub-Zero", "BI-36F", "Main Kitchen"],
      ["dishwasher", "Cove", "DW2450", "Main Kitchen - Left"],
      ["dishwasher", "Cove", "DW2450", "Main Kitchen - Right"],
      ["range", "Wolf", "GR486G", "Main Kitchen"],
      ["washer", "Miele", "WXF660", "Primary Laundry"],
      ["dryer", "Miele", "TXI680", "Primary Laundry"],
      ["ice_maker", "Scotsman", "DCE33", "Wet Bar"]
    ];
    assets = sample.map(function (row) {
      const asset = blankAsset(row[0]);
      asset.brand = row[1];
      asset.model = row[2];
      asset.location = row[3];
      return asset;
    });
    selectedPlan = "per_appliance";
    autoSelectedEstate = false;
    autoSwitchText = "";
    renderAssets();
    refreshPricing();
    ui.toast("Sample home loaded", "Eight appliances are entered so the automatic Estate crossover is visible.");
  }

  function formValue(name) {
    const field = document.querySelector(`[name="${name}"]`);
    return field ? field.value.trim() : "";
  }

  function validate() {
    const required = ["firstName", "lastName", "phone", "email", "address1", "city", "state", "zip"];
    const missing = required.filter((name) => !formValue(name));
    if (!assets.length) {
      ui.toast("Add an appliance", "At least one appliance is required.");
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

  document.getElementById("add-appliance").addEventListener("click", function () {
    addAsset("refrigerator");
  });

  document.getElementById("load-demo-home").addEventListener("click", loadDemoHome);

  document.getElementById("connect-payment").addEventListener("click", function () {
    paymentReady = true;
    document.getElementById("payment-dot").classList.add("ready");
    document.getElementById("payment-title").textContent = "Demo card connected";
    document.getElementById("payment-subtitle").textContent = "Stripe SetupIntent return simulated - ending in 4242";
    document.getElementById("connect-payment").textContent = "Connected";
    document.getElementById("connect-payment").disabled = true;
    refreshPricing();
    ui.toast("Payment setup simulated", "The production button will launch Stripe's secure payment-method flow.");
  });

  document.getElementById("appliance-enrollment-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (!validate()) return;
    const payload = {
      category: "appliance",
      planId: selectedPlan,
      annualAmount: currentAnnualCost(),
      assets: assets,
      paymentReady,
      autoRenew: true,
      acceptedTermsAt: new Date().toISOString(),
      pricingBreakdown: {
        basePlanAmount: selectedPlan === "per_appliance" ? perApplianceCost() : config.appliancePlans[selectedPlan].annualPrice,
        largeEstateAdjustment: selectedPlan === "per_appliance" ? 0 : estateAdjustment(selectedPlan).amount,
        imucSecondVisitCount: imucSecondVisitCount(selectedPlan),
        imucSecondVisitAmount: imucSecondVisitCount(selectedPlan) * config.pricing.imucPerVisit,
        applianceCount: assets.length,
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
    window.location.href = "confirmation.html";
  });

  assets.push(blankAsset("refrigerator"));
  renderAssets();
  refreshPricing();

  const params = new URLSearchParams(window.location.search);
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

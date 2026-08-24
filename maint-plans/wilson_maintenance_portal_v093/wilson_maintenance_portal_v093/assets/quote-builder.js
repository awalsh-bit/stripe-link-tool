(function () {
  const config = window.WILSON_CONFIG;
  const ui = window.WilsonUI;
  const estatePlanIds = ["estate_annual", "estate_preferred", "estate_concierge"];
  let selectedPlan = "estate_concierge";
  let assets = [];

  const planHost = document.getElementById("quote-plan-options");
  const assetHost = document.getElementById("quote-asset-list");

  function id() {
    return "quote_asset_" + Math.random().toString(36).slice(2, 9);
  }

  function typeById(typeId) {
    return config.applianceTypes.find((item) => item.id === typeId) || config.applianceTypes[config.applianceTypes.length - 1];
  }

  function blankAsset(typeId) {
    const type = typeById(typeId || "refrigerator");
    return {
      id: id(),
      type: type.id,
      typeLabel: type.label,
      group: type.group,
      brand: "",
      model: "",
      location: "",
      quantity: 1,
      imucVisitsPerYear: type.group === "imuc" ? 2 : 1
    };
  }

  function typeOptions(selected) {
    return config.applianceTypes.map((type) => `<option value="${type.id}" ${selected === type.id ? "selected" : ""}>${ui.escapeHtml(type.label)}</option>`).join("");
  }

  function totalCount() {
    return assets.reduce((total, item) => total + Math.max(1, Number(item.quantity || 1)), 0);
  }

  function imucSecondVisitCount() {
    const plan = config.appliancePlans[selectedPlan];
    if (plan.visitsPerYear >= 2) return 0;
    return assets.filter((item) => item.group === "imuc" && Number(item.imucVisitsPerYear) >= 2).reduce((total, item) => total + Math.max(1, Number(item.quantity || 1)), 0);
  }

  function pricing() {
    const plan = config.appliancePlans[selectedPlan];
    const count = totalCount();
    const extraCount = Math.max(0, count - config.estatePricing.includedAppliances);
    const extraRate = config.estatePricing.additionalPerAppliance[selectedPlan] || 0;
    const extraAmount = extraCount * extraRate;
    const imucCount = imucSecondVisitCount();
    const imucAmount = imucCount * config.pricing.imucPerVisit;
    const adjustment = Number(document.getElementById("manual-adjustment").value || 0);
    const total = Math.max(0, plan.annualPrice + extraAmount + imucAmount + adjustment);
    return { plan, count, extraCount, extraRate, extraAmount, imucCount, imucAmount, adjustment, total };
  }

  function renderPlans() {
    planHost.innerHTML = estatePlanIds.map(function (planId) {
      const plan = config.appliancePlans[planId];
      const extraRate = config.estatePricing.additionalPerAppliance[planId];
      return `<label class="plan-option ${selectedPlan === planId ? "selected" : ""}" data-quote-plan="${planId}"><input type="radio" name="quotePlan" value="${planId}" ${selectedPlan === planId ? "checked" : ""}><span class="plan-name"><span>${ui.escapeHtml(plan.name)}</span>${planId === "estate_concierge" ? '<span class="badge success">Full service</span>' : ""}</span><div class="plan-price">${ui.money(plan.annualPrice)} <small>/ year base</small></div><p>${ui.escapeHtml(plan.description)}</p><ul class="plan-feature-list">${plan.features.map((feature) => `<li>${ui.escapeHtml(feature)}</li>`).join("")}</ul><div class="plan-adjustment">+ ${ui.money(extraRate)} per appliance above ${config.estatePricing.includedAppliances}</div></label>`;
    }).join("");

    planHost.querySelectorAll("[data-quote-plan]").forEach(function (card) {
      card.addEventListener("click", function () {
        selectedPlan = card.dataset.quotePlan;
        renderPlans();
        renderAssets();
        renderPricing();
      });
    });
  }

  function frequencyOptions(asset) {
    if (asset.group !== "imuc") return `<span class="table-sub">Not applicable</span>`;
    const plan = config.appliancePlans[selectedPlan];
    if (plan.visitsPerYear >= 2) return `<span class="badge success">2 visits included</span>`;
    return `<select data-quote-field="imucVisitsPerYear"><option value="2" ${Number(asset.imucVisitsPerYear) === 2 ? "selected" : ""}>2 / year recommended</option><option value="1" ${Number(asset.imucVisitsPerYear) === 1 ? "selected" : ""}>1 / year</option></select>`;
  }

  function renderAssets() {
    if (!assets.length) assets.push(blankAsset("refrigerator"));
    assetHost.innerHTML = assets.map(function (asset) {
      return `<div class="quote-asset-row" data-quote-asset-id="${asset.id}"><select data-quote-field="type">${typeOptions(asset.type)}</select><input data-quote-field="brand" value="${ui.escapeHtml(asset.brand)}" placeholder="Brand"><input data-quote-field="model" value="${ui.escapeHtml(asset.model)}" placeholder="Model"><input data-quote-field="location" value="${ui.escapeHtml(asset.location)}" placeholder="Location"><input data-quote-field="quantity" type="number" min="1" step="1" value="${Math.max(1, Number(asset.quantity || 1))}"><div>${frequencyOptions(asset)}</div><button class="remove-button" data-remove-quote-asset="${asset.id}" type="button">Remove</button></div>`;
    }).join("");

    assetHost.querySelectorAll("[data-quote-asset-id]").forEach(function (row) {
      const asset = assets.find((item) => item.id === row.dataset.quoteAssetId);
      row.querySelectorAll("[data-quote-field]").forEach(function (input) {
        input.addEventListener("input", function () {
          const field = input.dataset.quoteField;
          asset[field] = field === "quantity" || field === "imucVisitsPerYear" ? Number(input.value) : input.value;
          if (field === "type") {
            const type = typeById(input.value);
            asset.typeLabel = type.label;
            asset.group = type.group;
            asset.imucVisitsPerYear = type.group === "imuc" ? 2 : 1;
            renderAssets();
          }
          renderPricing();
        });
      });
    });

    assetHost.querySelectorAll("[data-remove-quote-asset]").forEach(function (button) {
      button.addEventListener("click", function () {
        assets = assets.filter((item) => item.id !== button.dataset.removeQuoteAsset);
        renderAssets();
        renderPricing();
      });
    });
  }

  function renderPricing() {
    const values = pricing();
    document.getElementById("quote-total").innerHTML = `${ui.money(values.total)} <small>/ year</small>`;
    document.getElementById("quote-asset-count").textContent = `${values.count} appliance${values.count === 1 ? "" : "s"}`;
    document.getElementById("quote-summary-lines").innerHTML = `
      <div class="summary-line"><span>${ui.escapeHtml(values.plan.name)} base</span><strong>${ui.money(values.plan.annualPrice)}</strong></div>
      <div class="summary-line"><span>Appliances inventoried</span><strong>${values.count}</strong></div>
      <div class="summary-line"><span>Above included quantity</span><strong>${values.extraCount}</strong></div>
      ${values.extraAmount ? `<div class="summary-line"><span>Large-portfolio adjustment</span><strong>${ui.money(values.extraAmount)}</strong></div>` : ""}
      ${values.imucAmount ? `<div class="summary-line"><span>Second IMUC visits × ${values.imucCount}</span><strong>${ui.money(values.imucAmount)}</strong></div>` : ""}
      ${values.adjustment ? `<div class="summary-line"><span>Manual adjustment</span><strong>${ui.money(values.adjustment)}</strong></div>` : ""}
      <div class="summary-line"><span>Whole-home visits</span><strong>${values.plan.visitsPerYear} / year</strong></div>
    `;

    document.getElementById("quote-value-note").innerHTML = selectedPlan === "estate_concierge"
      ? `<div class="callout"><strong>Concierge scope</strong>Includes standard refrigerator, freezer, and IMUC filters, priority service, and detailed appliance health reports.</div>`
      : `<div class="callout info"><strong>Filter handling</strong>Filters can be tracked internally, but material is only included in the current Concierge draft.</div>`;

    const review = document.getElementById("quote-review-note");
    if (values.count >= config.estatePricing.customReviewStartsAt) {
      review.classList.remove("hidden");
      review.innerHTML = `<strong>Internal review required</strong>This portfolio has ${values.count} appliances. Keep the calculated amount visible, but have management confirm labor assumptions before sending the quote.`;
    } else {
      review.classList.add("hidden");
    }
  }

  function loadDemo() {
    const sample = [
      ["refrigerator", "Sub-Zero", "BI-48S", "Main Kitchen", 1],
      ["freezer", "Sub-Zero", "BI-36F", "Main Kitchen", 1],
      ["dishwasher", "Cove", "DW2450", "Main / Catering Kitchens", 3],
      ["range", "Wolf", "GR486G", "Main Kitchen", 1],
      ["wall_oven", "Wolf", "SO3050CM", "Main / Catering Kitchens", 3],
      ["ice_maker", "Scotsman", "DCE33", "Wet Bar / Outdoor", 2],
      ["washer", "Miele", "WXF660", "Laundry Rooms", 2],
      ["dryer", "Miele", "TXI680", "Laundry Rooms", 2],
      ["other", "Mixed", "Inventory to verify", "Residence", 5]
    ];
    assets = sample.map(function (row) {
      const asset = blankAsset(row[0]);
      asset.brand = row[1];
      asset.model = row[2];
      asset.location = row[3];
      asset.quantity = row[4];
      return asset;
    });
    document.getElementById("property-name").value = "Hamilton Family Estate";
    document.getElementById("contact-name").value = "Jordan Lee";
    document.getElementById("contact-email").value = "jordan@example.com";
    document.getElementById("contact-phone").value = "512-555-0188";
    document.getElementById("property-address").value = "2901 Lake Ridge Drive, Austin, TX 78734";
    document.getElementById("quote-notes").value = "Final model, serial number, and filter inventory will be verified during onboarding.";
    selectedPlan = "estate_concierge";
    renderPlans();
    renderAssets();
    renderPricing();
    ui.toast("Sample estate loaded", "The quote now demonstrates the base-plus adjustment and twice-yearly IMUC logic.");
  }

  function value(idValue) {
    return document.getElementById(idValue).value.trim();
  }

  document.getElementById("add-quote-asset").addEventListener("click", function () {
    assets.push(blankAsset("refrigerator"));
    renderAssets();
    renderPricing();
  });
  document.getElementById("load-quote-demo").addEventListener("click", loadDemo);
  document.getElementById("manual-adjustment").addEventListener("input", renderPricing);

  document.getElementById("quote-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (!value("property-name") || !value("contact-name") || !value("property-address")) {
      ui.toast("Quote details needed", "Enter the property name, contact, and service address.");
      return;
    }
    const values = pricing();
    const quote = WilsonStore.saveQuote({
      status: "Draft",
      propertyName: value("property-name"),
      contactName: value("contact-name"),
      contactEmail: value("contact-email"),
      contactPhone: value("contact-phone"),
      address: value("property-address"),
      preparedBy: value("prepared-by"),
      validUntil: value("valid-until"),
      planId: selectedPlan,
      planName: values.plan.name,
      baseAmount: values.plan.annualPrice,
      additionalApplianceAmount: values.extraAmount,
      additionalApplianceCount: values.extraCount,
      additionalApplianceRate: values.extraRate,
      imucAddOnAmount: values.imucAmount,
      imucSecondVisitCount: values.imucCount,
      adjustmentLabel: value("adjustment-label"),
      manualAdjustment: values.adjustment,
      annualAmount: values.total,
      applianceCount: values.count,
      includedCount: config.estatePricing.includedAppliances,
      customReviewRequired: values.count >= config.estatePricing.customReviewStartsAt,
      assets: assets.map((item) => ({ type: item.type, typeLabel: item.typeLabel, brand: item.brand, model: item.model, location: item.location, quantity: Math.max(1, Number(item.quantity || 1)), imucVisitsPerYear: item.imucVisitsPerYear })),
      notes: value("quote-notes"),
      terms: {
        autoRenew: true,
        chargeTiming: config.assumptions.paymentTiming,
        serviceOrderTarget: config.assumptions.serviceOrderTarget
      }
    });
    window.location.href = "quote-view.html?id=" + encodeURIComponent(quote.id);
  });

  const valid = new Date();
  valid.setDate(valid.getDate() + 30);
  document.getElementById("valid-until").value = valid.toISOString().slice(0, 10);
  assets.push(blankAsset("refrigerator"));
  renderPlans();
  renderAssets();
  renderPricing();
})();

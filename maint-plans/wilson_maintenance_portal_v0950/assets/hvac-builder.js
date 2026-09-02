(function () {
  /* The shared scheduling-preference control. */
  const schedulingForm = window.WILSON_SCHED_FORM
    ? window.WILSON_SCHED_FORM.mount({}) : null;
  const config = window.WILSON_CONFIG;
  const ui = window.WilsonUI;
  let systems = [];
  let selectedPlanId = "hvac_maintenance";
  let paymentReady = false;
  const list = document.getElementById("system-list");
  const planOptions = document.getElementById("hvac-plan-options");

  function selectedPlan() {
    return config.hvacPlans[selectedPlanId];
  }

  function blankSystem() {
    return {
      id: "system_" + Math.random().toString(36).slice(2, 9),
      type: "Split System",
      typeLabel: "HVAC System",
      group: "hvac",
      checkpointSet: "generic",
      filterTypes: ["HVAC media filter"],
      brand: "",
      model: "",
      location: "",
      tonnage: "",
      filterSize: "",
      filterQuantity: 1,
      filterLocation: "Return grille / equipment"
    };
  }

  function typeOptions(selected) {
    return config.hvacSystemTypes.map((type) => `<option ${type === selected ? "selected" : ""}>${ui.escapeHtml(type)}</option>`).join("");
  }

  function renderPlans() {
    planOptions.innerHTML = Object.values(config.hvacPlans).map(function (plan) {
      return `
        <label class="plan-option ${selectedPlanId === plan.id ? "selected" : ""}" data-hvac-plan="${plan.id}">
          <input type="radio" name="hvacPlan" value="${plan.id}" ${selectedPlanId === plan.id ? "checked" : ""}>
          <span class="plan-name"><span>${ui.escapeHtml(plan.name)}</span>${plan.filterManagement ? '<span class="badge success">Filter management</span>' : ""}</span>
          <div class="plan-price">${ui.money(plan.pricePerSystemAnnual)} <small>/ system / year</small></div>
          <p>${ui.escapeHtml(plan.description)}</p>
          <ul class="plan-feature-list">
            <li>${plan.visitsPerYear} maintenance visits per year</li>
            <li>Spring and fall contact, weather permitting</li>
            <li>${plan.filterManagement ? "Filter tracking, sourcing, and replacement" : "Filter service not included"}</li>
            ${plan.filterManagement ? (plan.standardFiltersIncluded ? "<li>Standard filter materials included</li>" : "<li>Filter materials billed separately</li>") : ""}
          </ul>
        </label>
      `;
    }).join("");

    planOptions.querySelectorAll("[data-hvac-plan]").forEach(function (card) {
      card.addEventListener("click", function () {
        selectedPlanId = card.dataset.hvacPlan;
        renderPlans();
        renderSystems();
        updatePricing();
      });
    });
  }

  function addSystem() {
    systems.push(blankSystem());
    renderSystems();
    updatePricing();
  }

  function filterFields(system) {
    if (!selectedPlan().filterManagement) return "";
    return `
      <div class="filter-capture-grid">
        <div class="field"><label>Filter size / part <span class="hint">Optional</span></label><input data-system-field="filterSize" value="${ui.escapeHtml(system.filterSize)}" placeholder="Example: 20x25x4"></div>
        <div class="field"><label>Quantity per change</label><input data-system-field="filterQuantity" type="number" min="1" value="${Number(system.filterQuantity || 1)}"></div>
        <div class="field"><label>Filter location</label><input data-system-field="filterLocation" value="${ui.escapeHtml(system.filterLocation)}"></div>
      </div>
    `;
  }

  function renderSystems() {
    list.innerHTML = systems.map(function (system, index) {
      return `
        <article class="asset-card" data-system-id="${system.id}">
          <div class="asset-card-head">
            <div class="asset-index"><span class="asset-number">${index + 1}</span><span>HVAC system ${index + 1}</span></div>
            <button class="remove-button" type="button" data-remove-system="${system.id}">Remove</button>
          </div>
          <div class="form-grid four">
            <div class="field"><label>System type</label><select data-system-field="type">${typeOptions(system.type)}</select></div>
            <div class="field"><label>Brand</label><input data-system-field="brand" value="${ui.escapeHtml(system.brand)}" placeholder="Trane"></div>
            <div class="field"><label>Model <span class="hint">Optional</span></label><input data-system-field="model" value="${ui.escapeHtml(system.model)}"></div>
            <div class="field"><label>Location / size</label><input data-system-field="location" value="${ui.escapeHtml(system.location)}" placeholder="Upstairs - 2 ton"></div>
          </div>
          ${filterFields(system)}
        </article>
      `;
    }).join("");

    list.querySelectorAll("[data-remove-system]").forEach(function (button) {
      button.addEventListener("click", function () {
        systems = systems.filter((item) => item.id !== button.dataset.removeSystem);
        if (!systems.length) systems.push(blankSystem());
        renderSystems();
        updatePricing();
      });
    });

    list.querySelectorAll("[data-system-id]").forEach(function (card) {
      const system = systems.find((item) => item.id === card.dataset.systemId);
      card.querySelectorAll("[data-system-field]").forEach(function (input) {
        input.addEventListener("input", function () {
          const field = input.dataset.systemField;
          system[field] = field === "filterQuantity" ? Number(input.value || 1) : input.value;
        });
      });
    });
  }

  function annualCost() {
    return systems.length * selectedPlan().pricePerSystemAnnual;
  }

  function updatePricing() {
    const plan = selectedPlan();
    document.getElementById("summary-total").innerHTML = `${ui.money(annualCost())} <small>/ year</small>`;
    document.getElementById("summary-lines").innerHTML = `
      <div class="summary-line"><span>${ui.escapeHtml(plan.name)}<br><small>${ui.money(plan.pricePerSystemAnnual)} × ${systems.length} system${systems.length === 1 ? "" : "s"}</small></span><strong>${ui.money(annualCost())}</strong></div>
      <div class="summary-line"><span>Maintenance visits</span><strong>${plan.visitsPerYear} / system / year</strong></div>
      <div class="summary-line"><span>Filter management</span><strong>${plan.filterManagement ? "Included" : "Not included"}</strong></div>
      <div class="summary-line"><span>Card authorization</span><strong>${paymentReady ? "Connected" : "Not connected"}</strong></div>
      <div class="summary-line"><span>Renewal</span><strong>Annual until canceled</strong></div>
    `;
  }

  function formValue(name) {
    const field = document.querySelector(`[name="${name}"]`);
    return field ? field.value.trim() : "";
  }

  function validate() {
    const required = ["firstName", "lastName", "phone", "email", "address1", "city", "state", "zip"];
    const missing = required.filter((name) => !formValue(name));
    if (missing.length) {
      ui.toast("Household information needed", "Complete the required contact and service-address fields.");
      document.querySelector(`[name="${missing[0]}"]`).focus();
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

  document.getElementById("add-system").addEventListener("click", addSystem);

  document.getElementById("connect-payment").addEventListener("click", function () {
    paymentReady = true;
    document.getElementById("payment-dot").classList.add("ready");
    document.getElementById("payment-title").textContent = "Demo card connected";
    document.getElementById("payment-subtitle").textContent = "Stripe SetupIntent return simulated - ending in 4242";
    document.getElementById("connect-payment").textContent = "Connected";
    document.getElementById("connect-payment").disabled = true;
    updatePricing();
    ui.toast("Payment setup simulated", "The production button will launch Stripe's secure payment-method flow.");
  });

  document.getElementById("hvac-enrollment-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (!validate()) return;
    const plan = selectedPlan();
    WilsonStore.createEnrollment({
      category: "hvac",
      planId: plan.id,
      planName: plan.name,
      annualAmount: annualCost(),
      assets: systems,
      systemCount: systems.length,
      filterManagement: plan.filterManagement,
      standardFiltersIncluded: plan.standardFiltersIncluded,
      paymentReady,
      autoRenew: true,
      acceptedTermsAt: new Date().toISOString(),
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
      /* Same structured preference as the appliance flow, same module. HVAC is
         seasonal, so the month chips carry more weight here than anywhere. */
      schedulingPreference: schedulingForm ? schedulingForm.read() : null,
      preferredMonths: schedulingForm && !schedulingForm.isEmpty()
        ? window.WILSON_SCHEDULING.summary(schedulingForm.read())
        : "Office to confirm",
      notes: formValue("notes")
    });
    window.location.href = "confirmation.html";
  });

  renderPlans();
  addSystem();
})();

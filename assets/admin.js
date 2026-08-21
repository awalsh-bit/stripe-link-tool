(function () {
  const ui = window.WilsonUI;
  const config = window.WILSON_CONFIG;
  let state = WilsonStore.load();
  let search = "";
  let category = "all";
  let status = "all";

  function householdById(id) { return state.households.find((item) => item.id === id); }
  function subscriptionById(id) { return state.subscriptions.find((item) => item.id === id); }
  function paymentForSubscription(subscription) { return subscription ? state.paymentProfiles.find((item) => item.id === subscription.paymentProfileId) : null; }
  function assetsForHousehold(id) { return state.assets.filter((item) => item.householdId === id); }
  function subscriptionsForHousehold(id) { return state.subscriptions.filter((item) => item.householdId === id); }
  function filtersForHousehold(id) { return state.filters.filter((item) => item.householdId === id); }
  function nextVisitForHousehold(id) { return state.visits.filter((item) => item.householdId === id).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null; }

  function statusBadge(value) {
    const lower = String(value || "").toLowerCase();
    let cls = "";
    if (lower.includes("overdue") || lower.includes("missing") || lower.includes("action")) cls = "danger";
    else if (lower.includes("due") || lower.includes("pending") || lower.includes("charge") || lower.includes("draft") || lower.includes("watch")) cls = "warning";
    else if (lower.includes("ready") || lower.includes("active") || lower.includes("pass") || lower.includes("paid") || lower.includes("accepted") || lower.includes("included")) cls = "success";
    else if (lower.includes("queued") || lower.includes("upcoming") || lower.includes("sent")) cls = "info";
    return `<span class="badge ${cls}">${ui.escapeHtml(value || "-")}</span>`;
  }

  function filteredVisits() {
    return state.visits.filter(function (visit) {
      const household = householdById(visit.householdId);
      const subscription = subscriptionById(visit.subscriptionId);
      const assets = assetsForHousehold(visit.householdId);
      const haystack = [household ? household.name : "", household ? household.city : "", subscription ? subscription.planName : "", visit.assetScope || "", assets.map((item) => item.typeLabel + " " + item.brand + " " + item.model).join(" ")].join(" ").toLowerCase();
      const searchMatch = !search || haystack.includes(search);
      const categoryMatch = category === "all" || visit.category === category;
      let statusMatch = true;
      if (status === "overdue") statusMatch = String(visit.status).toLowerCase().includes("overdue");
      if (status === "due") statusMatch = String(visit.status).toLowerCase().includes("due soon") || String(visit.status).toLowerCase().includes("enrollment review");
      if (status === "upcoming") statusMatch = String(visit.status).toLowerCase().includes("upcoming");
      return searchMatch && categoryMatch && statusMatch;
    }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  function renderHeroAndMetrics() {
    const dueVisits = state.visits.filter((visit) => ui.daysFromNow(visit.dueDate) <= 30);
    const dueFilters = state.filters.filter((filter) => ui.daysFromNow(filter.nextDueOn) <= 30);
    const readyPayments = state.paymentProfiles.filter((item) => item.status === "Ready");
    document.getElementById("hero-due-count").textContent = dueVisits.length;
    document.getElementById("hero-filter-count").textContent = dueFilters.length;
    document.getElementById("hero-payment-count").textContent = readyPayments.length;
    document.getElementById("hero-report-count").textContent = state.reports.length;

    const overdue = state.visits.filter((item) => ui.daysFromNow(item.dueDate) < 0).length;
    const chargeable = state.visits.filter((item) => Number(item.amountToCharge || 0) > 0 && !String(item.paymentStatus).toLowerCase().includes("queued")).length;
    const metrics = [
      [state.households.length, "Active households", "Appliance and HVAC records"],
      [dueVisits.length, "Visits due ≤ 30 days", overdue + " currently overdue"],
      [state.assets.length, "Tracked equipment", "Across all household programs"],
      [dueFilters.length, "Filters due ≤ 30 days", "Included and track-only records"],
      [state.quotes.length, "Custom proposals", chargeable + " intervals ready for payment review"]
    ];
    document.getElementById("metric-grid").innerHTML = metrics.map((item) => `<div class="metric-card"><div class="label">${ui.escapeHtml(item[1])}</div><div class="value">${item[0]}</div><div class="sub">${ui.escapeHtml(item[2])}</div></div>`).join("");
  }

  function renderDueQueue() {
    const visits = filteredVisits();
    document.getElementById("due-queue-count").textContent = visits.length + (visits.length === 1 ? " record" : " records");
    const body = document.getElementById("due-table-body");
    if (!visits.length) {
      body.innerHTML = `<tr><td colspan="8"><div class="empty-state">No maintenance visits match these filters.</div></td></tr>`;
      return;
    }
    body.innerHTML = visits.map(function (visit) {
      const household = householdById(visit.householdId);
      const subscription = subscriptionById(visit.subscriptionId);
      const payment = paymentForSubscription(subscription);
      const days = ui.daysFromNow(visit.dueDate);
      const dueLabel = days < 0 ? Math.abs(days) + " days overdue" : days === 0 ? "Due today" : "In " + days + " days";
      const amount = Number(visit.amountToCharge || 0);
      const chargeDisabled = amount <= 0 || !payment || payment.status !== "Ready";
      const chargeLabel = amount > 0 ? "Charge " + ui.money(amount) : "Included";
      return `<tr>
        <td><div class="table-title">${ui.shortDate(visit.dueDate)}</div><div class="table-sub">${dueLabel}</div>${statusBadge(visit.status)}</td>
        <td><a class="table-title text-link" href="household.html?id=${household.id}">${ui.escapeHtml(household.name)}</a><div class="table-sub">${ui.escapeHtml(household.city)}, ${ui.escapeHtml(household.state)}</div></td>
        <td><div class="table-title">${ui.escapeHtml(subscription.planName)}</div><div class="table-sub">${visit.category === "hvac" ? "HVAC" : "Household appliances"}</div></td>
        <td><div class="table-title">${ui.escapeHtml(visit.season || "Maintenance visit")}</div><div class="table-sub">${ui.escapeHtml(visit.assetScope || "Enrolled equipment")}</div></td>
        <td><div class="table-title">${amount > 0 ? ui.money(amount) : "Included"}</div><div class="table-sub">${amount > 0 ? "Charge when ready to schedule" : "No additional charge"}</div></td>
        <td>${statusBadge(visit.paymentStatus)}<div class="table-sub">${payment && payment.last4 ? payment.brand + " •••• " + payment.last4 : "No card details"}</div></td>
        <td>${statusBadge(visit.serviceOrderStatus)}</td>
        <td><div class="inline-actions"><button class="button small secondary" data-action="charge" data-visit-id="${visit.id}" ${chargeDisabled ? "disabled" : ""}>${chargeLabel}</button><button class="button small" data-action="service-order" data-visit-id="${visit.id}">Generate order</button>${visit.reportRequired ? `<a class="button small ghost" href="report-builder.html?household=${household.id}">Health report</a>` : ""}</div></td>
      </tr>`;
    }).join("");
  }

  function renderHouseholds() {
    const filtered = state.households.filter(function (household) {
      const subscriptions = subscriptionsForHousehold(household.id);
      const haystack = [household.name, household.city, subscriptions.map((item) => item.planName).join(" ")].join(" ").toLowerCase();
      return !search || haystack.includes(search);
    });
    document.getElementById("household-count").textContent = filtered.length + " households";
    document.getElementById("household-table-body").innerHTML = filtered.map(function (household) {
      const subscriptions = subscriptionsForHousehold(household.id);
      const assets = assetsForHousehold(household.id);
      const paymentIds = subscriptions.map((item) => item.paymentProfileId);
      const profiles = state.paymentProfiles.filter((item) => paymentIds.includes(item.id));
      const ready = profiles.length && profiles.every((item) => item.status === "Ready");
      const filters = filtersForHousehold(household.id);
      const next = nextVisitForHousehold(household.id);
      const dueFilters = filters.filter((item) => ui.daysFromNow(item.nextDueOn) <= 30).length;
      return `<tr><td><a class="table-title text-link" href="household.html?id=${household.id}">${ui.escapeHtml(household.name)}</a><div class="table-sub">${ui.escapeHtml(household.address1)}, ${ui.escapeHtml(household.city)}</div></td><td>${subscriptions.map((item) => statusBadge(item.planName)).join(" ")}</td><td><div class="table-title">${assets.length}</div><div class="table-sub">equipment records</div></td><td><div class="table-title">${next ? ui.shortDate(next.dueDate) : "-"}</div><div class="table-sub">${next ? next.status : "No interval"}</div></td><td>${statusBadge(ready ? "Ready" : "Follow-up")}</td><td>${statusBadge(dueFilters ? dueFilters + " due" : "Current")}</td><td><a class="button small ghost" href="household.html?id=${household.id}">Open household</a></td></tr>`;
    }).join("") || `<tr><td colspan="7"><div class="empty-state">No households match the search.</div></td></tr>`;
  }

  function renderFilters() {
    const rows = state.filters.slice().sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn));
    document.getElementById("filter-table-count").textContent = rows.length + " filters";
    document.getElementById("filter-table-body").innerHTML = rows.map(function (filter) {
      const household = householdById(filter.householdId);
      const asset = state.assets.find((item) => item.id === filter.assetId);
      return `<tr><td><div class="table-title">${ui.shortDate(filter.nextDueOn)}</div><div class="table-sub">Every ${filter.intervalMonths} months</div></td><td><a class="table-title text-link" href="household.html?id=${household.id}">${ui.escapeHtml(household.name)}</a></td><td>${asset ? `<div class="table-title">${ui.escapeHtml(asset.typeLabel)}</div><div class="table-sub">${ui.escapeHtml(asset.brand)} ${ui.escapeHtml(asset.model)}</div>` : `<div class="table-title">Household equipment</div>`}</td><td><div class="table-title">${ui.escapeHtml(filter.filterType)}</div><div class="table-sub">${ui.escapeHtml(filter.partNumber)}</div></td><td>${filter.quantity}</td><td>${statusBadge(filter.planCoverage || "Track only")}</td><td>${ui.escapeHtml(filter.source)}</td><td>${statusBadge(filter.status)}</td></tr>`;
    }).join("") || `<tr><td colspan="8"><div class="empty-state">No filters are being tracked.</div></td></tr>`;
  }

  function renderReports() {
    const reports = state.reports.slice().sort((a, b) => b.inspectionDate.localeCompare(a.inspectionDate));
    document.getElementById("report-table-body").innerHTML = reports.map(function (report) {
      const household = householdById(report.householdId);
      return `<tr><td><div class="table-title">${ui.shortDate(report.inspectionDate)}</div><div class="table-sub">Next: ${ui.shortDate(report.nextDueOn)}</div></td><td><a class="table-title text-link" href="household.html?id=${household.id}">${ui.escapeHtml(household.name)}</a></td><td><div class="table-title">${ui.escapeHtml(report.applianceLabel)}</div></td><td><span class="badge success">${Number(report.score || 0)}% ${ui.escapeHtml(report.grade || "")}</span></td><td>${statusBadge(report.condition)}</td><td>${ui.escapeHtml(report.technician)}</td><td><a class="button small ghost" href="report-view.html?id=${report.id}">View report</a></td></tr>`;
    }).join("") || `<tr><td colspan="7"><div class="empty-state">No reports stored yet.</div></td></tr>`;
  }

  function renderQuotes() {
    const quotes = (state.quotes || []).slice().sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    document.getElementById("quote-table-body").innerHTML = quotes.map(function (quote) {
      return `<tr><td><div class="table-title">${ui.escapeHtml(quote.quoteNumber)}</div><div class="table-sub">Valid through ${ui.shortDate(quote.validUntil)}</div></td><td><div class="table-title">${ui.escapeHtml(quote.propertyName)}</div><div class="table-sub">${ui.escapeHtml(quote.address)}</div></td><td><div class="table-title">${ui.escapeHtml(quote.contactName)}</div><div class="table-sub">${ui.escapeHtml(quote.contactEmail || quote.contactPhone || "")}</div></td><td>${ui.escapeHtml(quote.planName)}</td><td><strong>${Number(quote.applianceCount || 0)}</strong><div class="table-sub">appliances</div></td><td><strong>${ui.money(quote.annualAmount)}</strong></td><td>${statusBadge(quote.status)}</td><td><a class="button small ghost" href="quote-view.html?id=${quote.id}">Open proposal</a></td></tr>`;
    }).join("") || `<tr><td colspan="8"><div class="empty-state">No custom quotes stored yet.</div></td></tr>`;
  }

  function renderPlans() {
    const plans = Object.values(config.appliancePlans);
    document.getElementById("plan-admin-grid").innerHTML = plans.map(function (plan) {
      const price = plan.id === "per_appliance" ? `${ui.money(config.pricing.standardApplianceAnnual)} standard · ${ui.money(config.pricing.imucPerVisit)} / IMUC visit` : ui.money(plan.annualPrice) + " / year";
      const extra = config.estatePricing.additionalPerAppliance[plan.id];
      return `<article class="plan-option"><div class="plan-name"><span>${ui.escapeHtml(plan.name)}</span><span class="badge">${plan.visitsPerYear} visit${plan.visitsPerYear === 1 ? "" : "s"}</span></div><div class="plan-price">${price}</div><p>${ui.escapeHtml(plan.description)}</p><ul class="plan-feature-list">${(plan.features || []).map((item) => `<li>${ui.escapeHtml(item)}</li>`).join("")}</ul>${extra ? `<div class="plan-adjustment">Draft: + ${ui.money(extra)} per appliance above ${config.estatePricing.includedAppliances}</div>` : ""}</article>`;
    }).join("");

    document.getElementById("hvac-plan-admin-grid").innerHTML = Object.values(config.hvacPlans).map(function (plan) {
      return `<article class="plan-option"><div class="plan-name"><span>${ui.escapeHtml(plan.name)}</span>${plan.filterManagement ? '<span class="badge success">Filter tier</span>' : '<span class="badge">Core</span>'}</div><div class="plan-price">${ui.money(plan.pricePerSystemAnnual)} <small>/ system / year</small></div><p>${ui.escapeHtml(plan.description)}</p><ul class="plan-feature-list"><li>${plan.visitsPerYear} visits per system each year</li><li>Spring and fall contact, weather permitting</li><li>${plan.filterManagement ? "Filter tracking, sourcing, and standard replacement included" : "Filter management not included"}</li></ul></article>`;
    }).join("");

    const rules = [
      ["IMUC", `${ui.money(config.pricing.imucPerVisit)} per visit; second annual visit recommended and selected by default`],
      ["Estate crossover", "Enrollment moves automatically to Estate Annual whenever it becomes the lower comparable price"],
      ["Payment timing", "Card on file at enrollment; office charges when the scheduled interval is ready"],
      ["Renewal", "Annual auto-renewal until canceled by the customer"],
      ["HVAC", `${ui.money(200)} or ${ui.money(400)} per system per year; both include two visits`],
      ["Dispatch integration", "NetSuite service-order button retained as the future integration point"],
      ["Base-plus draft", `First ${config.estatePricing.includedAppliances} appliances included; plan-specific overage above that count`],
      ["Large estates", `${config.estatePricing.customReviewStartsAt}+ appliances trigger internal review without hiding the estimate`]
    ];
    document.getElementById("pricing-rule-grid").innerHTML = rules.map((item) => `<div class="detail-tile"><div class="label">${ui.escapeHtml(item[0])}</div><div class="value">${ui.escapeHtml(item[1])}</div></div>`).join("");
  }

  function renderActivity() {
    const icons = { Report: "R", Plan: "P", Due: "!", Payment: "$", "Service order": "S", Enrollment: "+", Quote: "Q" };
    document.getElementById("activity-list").innerHTML = state.activity.slice(0, 7).map((item) => `<div class="activity-item"><div class="activity-icon">${icons[item.type] || "•"}</div><div><p>${ui.escapeHtml(item.text)}</p><time>${new Date(item.createdAt).toLocaleString()}</time></div></div>`).join("");
  }

  function bindActions() {
    document.getElementById("due-table-body").addEventListener("click", function (event) {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "service-order") {
        WilsonStore.queueServiceOrder(button.dataset.visitId);
        ui.toast("Service order queued", "The visit is marked for NetSuite service-order generation. The external integration is intentionally not connected yet.");
      }
      if (button.dataset.action === "charge") {
        const result = WilsonStore.mockCharge(button.dataset.visitId);
        ui.toast(result.ok ? "Charge queued" : "Payment action blocked", result.message);
      }
      state = WilsonStore.load();
      renderAll();
    });
  }

  function renderAll() {
    renderHeroAndMetrics();
    renderDueQueue();
    renderHouseholds();
    renderFilters();
    renderReports();
    renderQuotes();
    renderPlans();
    renderActivity();
  }

  document.addEventListener("DOMContentLoaded", function () {
    ui.setupTabs(document);
    bindActions();
    renderAll();
    const hash = window.location.hash.replace("#", "");
    if (hash) {
      const button = document.querySelector(`[data-tab-target="panel-${hash}"]`);
      if (button) button.click();
    }
  });

  document.getElementById("apply-filters").addEventListener("click", function () {
    search = document.getElementById("dashboard-search").value.trim().toLowerCase();
    category = document.getElementById("category-filter").value;
    status = document.getElementById("status-filter").value;
    renderDueQueue();
    renderHouseholds();
  });
  document.getElementById("dashboard-search").addEventListener("keydown", function (event) { if (event.key === "Enter") document.getElementById("apply-filters").click(); });
  document.getElementById("reset-demo").addEventListener("click", function () {
    state = WilsonStore.reset();
    search = ""; category = "all"; status = "all";
    document.getElementById("dashboard-search").value = "";
    document.getElementById("category-filter").value = "all";
    document.getElementById("status-filter").value = "all";
    renderAll();
    ui.toast("Demo reset", "Sample households, visits, filters, health report, and quote were restored.");
  });
})();

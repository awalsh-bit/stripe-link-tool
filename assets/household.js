(function () {
  const ui = window.WilsonUI;
  let state = WilsonStore.load();
  const params = new URLSearchParams(window.location.search);
  const householdId = params.get("id") || state.households[0].id;

  function badge(value) {
    const lower = String(value || "").toLowerCase();
    let cls = "";
    if (lower.includes("overdue") || lower.includes("missing") || lower.includes("action")) cls = "danger";
    else if (lower.includes("due") || lower.includes("pending") || lower.includes("charge") || lower.includes("watch")) cls = "warning";
    else if (lower.includes("ready") || lower.includes("active") || lower.includes("pass") || lower.includes("paid") || lower.includes("good") || lower.includes("included")) cls = "success";
    else if (lower.includes("queued") || lower.includes("upcoming")) cls = "info";
    return `<span class="badge ${cls}">${ui.escapeHtml(value || "-")}</span>`;
  }

  function bundle() { return WilsonStore.getHouseholdBundle(householdId); }

  function render() {
    state = WilsonStore.load();
    const data = bundle();
    if (!data) {
      document.querySelector("main .page-shell").innerHTML = `<div class="card card-pad"><div class="empty-state">Household not found. <a class="text-link" href="admin.html">Return to the dashboard.</a></div></div>`;
      return;
    }
    const household = data.household;
    const payment = data.paymentProfiles[0];
    const nextVisit = data.visits.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const planNames = data.subscriptions.map((item) => item.planName).join(" + ");
    const dueFilters = data.filters.filter((item) => ui.daysFromNow(item.nextDueOn) <= 30).length;

    document.getElementById("household-title").innerHTML = `<div class="section-heading"><div><span class="eyebrow dark">Household maintenance record</span><h1>${ui.escapeHtml(household.name)}</h1><p>${ui.escapeHtml(household.address1)}${household.address2 ? ", " + ui.escapeHtml(household.address2) : ""} · ${ui.escapeHtml(household.city)}, ${ui.escapeHtml(household.state)} ${ui.escapeHtml(household.zip)}</p></div><div class="inline-actions"><a class="button ghost" href="admin.html">← Dashboard</a><a class="button" href="report-builder.html?household=${household.id}">New health report</a></div></div>`;
    document.getElementById("new-report-top").href = `report-builder.html?household=${household.id}`;
    document.getElementById("new-report-bottom").href = `report-builder.html?household=${household.id}`;

    document.getElementById("household-summary").innerHTML = `<div class="detail-tile"><div class="label">Plans</div><div class="value">${ui.escapeHtml(planNames)}</div></div><div class="detail-tile"><div class="label">Tracked equipment</div><div class="value">${data.assets.length}</div></div><div class="detail-tile"><div class="label">Next due</div><div class="value">${nextVisit ? ui.shortDate(nextVisit.dueDate) : "-"}</div></div><div class="detail-tile"><div class="label">Payment</div><div class="value">${payment ? ui.escapeHtml(payment.status) : "Missing"}</div></div>`;

    document.getElementById("asset-table-body").innerHTML = data.assets.map(function (asset) {
      let frequency = "Plan interval";
      if (asset.group === "imuc") frequency = `${Number(asset.imucVisitsPerYear || 1)} / year`;
      if (asset.group === "hvac") frequency = "2 / year";
      const filters = (asset.filterTypes || []).join(", ") || "None tracked";
      return `<tr><td><div class="table-title">${ui.escapeHtml(asset.typeLabel)}</div><div class="table-sub">${asset.group === "imuc" ? "IMUC" : asset.group === "hvac" ? "HVAC" : "Standard appliance"}</div></td><td><div class="table-title">${ui.escapeHtml(asset.brand || "Brand not entered")}</div><div class="table-sub">${ui.escapeHtml(asset.model || "Model to verify")}</div></td><td>${ui.escapeHtml(asset.location || "Location not entered")}</td><td>${badge(frequency)}</td><td><div class="table-sub">${ui.escapeHtml(filters)}</div></td><td><span class="badge info">${ui.escapeHtml(asset.checkpointSet || "generic")}</span></td></tr>`;
    }).join("") || `<tr><td colspan="6"><div class="empty-state">No equipment records.</div></td></tr>`;

    document.getElementById("visit-table-body").innerHTML = data.visits.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(function (visit) {
      const subscription = data.subscriptions.find((item) => item.id === visit.subscriptionId);
      const amount = Number(visit.amountToCharge || 0);
      const chargeDisabled = amount <= 0 || !payment || payment.status !== "Ready";
      return `<tr><td><div class="table-title">${ui.shortDate(visit.dueDate)}</div><div class="table-sub">${ui.escapeHtml(visit.season)}</div></td><td><div class="table-title">${ui.escapeHtml(subscription ? subscription.planName : visit.category)}</div></td><td><div class="table-title">${ui.escapeHtml(visit.assetScope || "Enrolled equipment")}</div></td><td>${badge(visit.status)}</td><td><div class="table-title">${amount > 0 ? ui.money(amount) : "Included"}</div><div class="table-sub">${amount > 0 ? "Due at this interval" : "No added charge"}</div></td><td>${badge(visit.paymentStatus)}</td><td>${badge(visit.serviceOrderStatus)}</td><td><div class="inline-actions"><button class="button small secondary" data-action="charge" data-visit-id="${visit.id}" ${chargeDisabled ? "disabled" : ""}>${amount > 0 ? "Charge " + ui.money(amount) : "Included"}</button><button class="button small" data-action="service-order" data-visit-id="${visit.id}">Generate order</button></div></td></tr>`;
    }).join("");

    document.getElementById("report-history-body").innerHTML = data.reports.map(function (report) {
      return `<tr><td>${ui.shortDate(report.inspectionDate)}</td><td><div class="table-title">${ui.escapeHtml(report.applianceLabel)}</div></td><td>${badge(Number(report.score || 0) + "% " + (report.grade || ""))}</td><td>${badge(report.condition)}</td><td>${ui.escapeHtml(report.technician)}</td><td><a class="button small ghost" href="report-view.html?id=${report.id}">View</a></td></tr>`;
    }).join("") || `<tr><td colspan="6"><div class="empty-state">No appliance health reports stored yet.</div></td></tr>`;

    document.getElementById("plan-payment-card").innerHTML = `<div class="section-heading"><div><h2>Contact, plans, and payment</h2><p>${ui.escapeHtml(household.preferredContact)} preferred</p></div></div><div class="summary-lines"><div class="summary-line"><span>Contact</span><strong>${ui.escapeHtml(household.firstName + " " + household.lastName)}</strong></div><div class="summary-line"><span>Phone</span><strong>${ui.escapeHtml(household.phone)}</strong></div><div class="summary-line"><span>Email</span><strong>${ui.escapeHtml(household.email)}</strong></div><div class="summary-line"><span>Payment method</span><strong>${payment && payment.last4 ? `${payment.brand} •••• ${payment.last4}` : "Not connected"}</strong></div><div class="summary-line"><span>Filters due ≤ 30 days</span><strong>${dueFilters}</strong></div></div><div class="subscription-cards">${data.subscriptions.map((subscription) => `<div class="subscription-mini-card"><div><strong>${ui.escapeHtml(subscription.planName)}</strong>${badge(subscription.status)}</div><span>${ui.money(subscription.annualAmount)} / year</span><small>${subscription.autoRenew ? "Auto-renews until canceled" : "Manual renewal"} · ${ui.escapeHtml(subscription.chargeTiming || "Charge at scheduled maintenance")}${subscription.filterManagement ? " · Filter management" : ""}</small></div>`).join("")}</div>${payment && payment.status === "Ready" ? `<div class="callout"><strong>Payment ready</strong>The production server can create the Stripe PaymentIntent when the selected maintenance interval is ready to schedule.</div>` : `<div class="callout warning"><strong>Payment follow-up needed</strong>Connect a payment method before charging the scheduled maintenance interval.</div><button class="button wide secondary" id="connect-household-payment" type="button">Connect demo payment</button>`}${household.notes ? `<div class="callout info"><strong>Household notes</strong>${ui.escapeHtml(household.notes)}</div>` : ""}`;

    if (payment && payment.status !== "Ready") {
      const connect = document.getElementById("connect-household-payment");
      if (connect) connect.addEventListener("click", function () { WilsonStore.connectPayment(household.id); ui.toast("Payment connected", "Prototype payment profile is now ready."); render(); });
    }

    document.getElementById("household-filter-list").innerHTML = data.filters.map(function (filter) {
      const asset = data.assets.find((item) => item.id === filter.assetId);
      return `<div class="activity-item"><div class="activity-icon">F</div><div><p><strong>${ui.escapeHtml(filter.filterType)}</strong><br>${asset ? ui.escapeHtml(asset.typeLabel + " · " + asset.location) : "Household equipment"}</p><time>${ui.shortDate(filter.nextDueOn)} · ${ui.escapeHtml(filter.status)} · ${ui.escapeHtml(filter.partNumber)} · ${ui.escapeHtml(filter.planCoverage || "Track only")}</time></div></div>`;
    }).join("") || `<div class="empty-state">No filters tracked.</div>`;

    document.getElementById("household-activity-list").innerHTML = data.activity.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => `<div class="activity-item"><div class="activity-icon">${ui.escapeHtml(item.type.slice(0, 1))}</div><div><p>${ui.escapeHtml(item.text)}</p><time>${new Date(item.createdAt).toLocaleString()}</time></div></div>`).join("") || `<div class="empty-state">No activity stored.</div>`;
    bindActions();
  }

  function bindActions() {
    document.querySelectorAll("[data-action='charge']").forEach(function (button) {
      button.addEventListener("click", function () { const result = WilsonStore.mockCharge(button.dataset.visitId); ui.toast(result.ok ? "Charge queued" : "Charge blocked", result.message); render(); });
    });
    document.querySelectorAll("[data-action='service-order']").forEach(function (button) {
      button.addEventListener("click", function () { WilsonStore.queueServiceOrder(button.dataset.visitId); ui.toast("Service order queued", "NetSuite integration-ready status saved in the prototype."); render(); });
    });
  }

  document.addEventListener("DOMContentLoaded", render);
})();

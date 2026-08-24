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
    const openVisits = data.visits.filter((v) => v.status !== "Completed").slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const nextVisit = openVisits[0] || null;
    const nextApplianceVisit = openVisits.find((v) => v.category === "appliance") || null;
    const nextHvacVisit = openVisits.find((v) => v.category === "hvac") || null;
    const planNames = data.subscriptions.map((item) => item.planName).join(" + ");
    /* Filter coverage is plan-dependent, so pricing needs the appliance plan id. */
    const applianceSubscription = data.subscriptions.find((item) => item.category === "appliance");
    const subscriptionPlanId = applianceSubscription ? applianceSubscription.planId : null;
    const dueFilters = data.filters.filter((item) => ui.daysFromNow(item.nextDueOn) <= 30).length;

    document.getElementById("household-title").innerHTML = `<div class="section-heading"><div><span class="eyebrow dark">Household maintenance record</span><h1>${ui.escapeHtml(household.name)}</h1><p>${ui.escapeHtml(household.address1)}${household.address2 ? ", " + ui.escapeHtml(household.address2) : ""} · ${ui.escapeHtml(household.city)}, ${ui.escapeHtml(household.state)} ${ui.escapeHtml(household.zip)}</p></div><div class="inline-actions"><a class="button ghost" href="admin.html">← Dashboard</a></div></div>`;

    const applianceLaunch = document.getElementById("launch-appliance-tech");
    if (nextApplianceVisit) {
      applianceLaunch.href = `tech-maintenance.html?household=${encodeURIComponent(household.id)}&visit=${encodeURIComponent(nextApplianceVisit.id)}`;
      applianceLaunch.classList.remove("disabled-link");
      applianceLaunch.removeAttribute("aria-disabled");
      applianceLaunch.textContent = "Launch appliance visit";
    } else {
      applianceLaunch.href = "#";
      applianceLaunch.classList.add("disabled-link");
      applianceLaunch.setAttribute("aria-disabled", "true");
      applianceLaunch.textContent = "No open appliance visit";
    }
    document.getElementById("appliance-visit-context").innerHTML = nextApplianceVisit ? `<span class="badge ${ui.daysFromNow(nextApplianceVisit.dueDate)<=14?"warning":"info"}">${ui.escapeHtml(nextApplianceVisit.status)}</span><strong>${ui.escapeHtml(nextApplianceVisit.season)}</strong><span>${ui.shortDate(nextApplianceVisit.dueDate)} · ${ui.escapeHtml(nextApplianceVisit.assetScope||"Enrolled appliances")}</span>` : `<span class="badge">No open interval</span><span>There is no appliance field visit waiting for this household.</span>`;
    document.getElementById("hvac-visit-context").innerHTML = nextHvacVisit ? `<span class="badge info">${ui.escapeHtml(nextHvacVisit.status)}</span><strong>${ui.escapeHtml(nextHvacVisit.season)}</strong><span>${ui.shortDate(nextHvacVisit.dueDate)} · ${ui.escapeHtml(nextHvacVisit.assetScope||"HVAC systems")}</span>` : `<span class="badge">No open interval</span><span>No HVAC maintenance interval is currently open.</span>`;

    document.getElementById("household-summary").innerHTML = `<div class="detail-tile"><div class="label">Plans</div><div class="value">${ui.escapeHtml(planNames)}</div></div><div class="detail-tile"><div class="label">Tracked equipment</div><div class="value">${data.assets.length}</div></div><div class="detail-tile"><div class="label">Next due</div><div class="value">${nextVisit ? ui.shortDate(nextVisit.dueDate) : "-"}</div></div><div class="detail-tile"><div class="label">Billing</div><div class="value">${ui.escapeHtml(household.billingType || "Card on File")}</div><div class="table-sub">${ui.escapeHtml(household.accountTerms || (payment ? payment.status : "Missing"))}</div></div>`;

    const applianceAssets = data.assets.filter((asset) => asset.group !== "hvac");
    const hvacAssets = data.assets.filter((asset) => asset.group === "hvac");

    document.getElementById("appliance-asset-table-body").innerHTML = applianceAssets.map(function (asset) {
      let frequency = asset.group === "imuc" ? `${Number(asset.imucVisitsPerYear || 1)} / year` : "Plan interval";
      const filterSelection = window.WILSON_FILTERS.forAsset(asset, subscriptionPlanId);
      const filters = (asset.filterTypes || []).join(", ")
        || (filterSelection.lines.length ? "Exact refrigeration filters to verify" : "None tracked");
      const filterNote = filterSelection.lines.length
        ? `<div class="table-sub"><span class="badge success">${ui.escapeHtml(filterSelection.lines.map((line) => `${line.shortLabel} × ${line.quantity}`).join(" · "))}</span>${filterSelection.included ? '<span class="badge info">Included</span>' : `<span class="badge info">${ui.money(filterSelection.total)}/yr</span>`}</div>`
        : '';
      return `<tr><td><div class="table-title">${ui.escapeHtml(asset.typeLabel)}</div><div class="table-sub">${asset.group === "imuc" ? "IMUC" : "Standard appliance"}</div></td><td><div class="table-title">${ui.escapeHtml(asset.brand || "Brand not entered")}</div><div class="table-sub">${ui.escapeHtml(asset.model || "Model to verify")}</div></td><td>${ui.escapeHtml(asset.location || "Location not entered")}</td><td>${badge(frequency)}</td><td><div class="table-sub">${ui.escapeHtml(filters)}</div>${filterNote}</td><td><span class="badge info">${ui.escapeHtml(asset.checkpointSet || "generic")}</span></td></tr>`;
    }).join("") || `<tr><td colspan="6"><div class="empty-state">No appliance equipment enrolled.</div></td></tr>`;

    document.getElementById("hvac-asset-table-body").innerHTML = hvacAssets.map(function (asset) {
      const filters = (asset.filterTypes || []).join(", ") || "Filter details to verify";
      return `<tr><td><div class="table-title">${ui.escapeHtml(asset.typeLabel)}</div><div class="table-sub">HVAC system</div></td><td><div class="table-title">${ui.escapeHtml(asset.brand || "Brand not entered")}</div><div class="table-sub">${ui.escapeHtml(asset.model || "Model to verify")}</div></td><td>${ui.escapeHtml(asset.location || "Location not entered")}</td><td>${badge("2 / year")}</td><td><div class="table-sub">${ui.escapeHtml(filters)}</div></td><td>${badge(asset.status || "Active")}</td></tr>`;
    }).join("") || `<tr><td colspan="6"><div class="empty-state">No HVAC equipment enrolled.</div></td></tr>`;

    document.getElementById("hvac-maintenance-section").classList.toggle("hidden", !hvacAssets.length && !data.subscriptions.some((sub) => sub.category === "hvac"));

    document.getElementById("visit-table-body").innerHTML = data.visits.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(function (visit) {
      const subscription = data.subscriptions.find((item) => item.id === visit.subscriptionId);
      const amount = Number(visit.amountToCharge || 0);
      const chargeDisabled = amount <= 0 || !payment || payment.status !== "Ready";
      return `<tr><td><div class="table-title">${ui.shortDate(visit.dueDate)}</div><div class="table-sub">${ui.escapeHtml(visit.season)}</div></td><td><div class="table-title">${ui.escapeHtml(subscription ? subscription.planName : visit.category)}</div></td><td><div class="table-title">${ui.escapeHtml(visit.assetScope || "Enrolled equipment")}</div></td><td>${badge(visit.status)}</td><td><div class="table-title">${amount > 0 ? ui.money(amount) : "Included"}</div><div class="table-sub">${amount > 0 ? "Due at this interval" : "No added charge"}</div></td><td>${badge(visit.paymentStatus)}</td><td>${badge(visit.serviceOrderStatus)}</td><td><div class="inline-actions"><button class="button small secondary" data-action="charge" data-visit-id="${visit.id}" ${chargeDisabled ? "disabled" : ""}>${amount > 0 ? "Charge " + ui.money(amount) : "Included"}</button><button class="button small" data-action="service-order" data-visit-id="${visit.id}">Generate order</button></div></td></tr>`;
    }).join("");

    const deliveryVisits = data.visits.filter((v) => v.reportDeliveryStatus).sort((a,b) => String(b.reportReadyAt || b.completedOn || b.dueDate).localeCompare(String(a.reportReadyAt || a.completedOn || a.dueDate)));
    const readyInspections = (state.techInspections || []).filter((inspection) => inspection.householdId === household.id && inspection.complete && !state.reports.some((report) => report.visitId === inspection.visitId && report.assetId === inspection.assetId));
    const deliveryHost = document.getElementById("report-delivery-banner");
    const deliveryCards = deliveryVisits.map((visit) => {
      const reports = data.reports.filter((report) => report.visitId === visit.id);
      const ready = String(visit.reportDeliveryStatus || "").toLowerCase().includes("ready");
      return `<div class="report-delivery-strip ${ready ? "ready" : ""}"><div><strong>${ui.escapeHtml(visit.reportDeliveryStatus)}</strong><span>${reports.length} field report${reports.length === 1 ? "" : "s"} · ${ui.escapeHtml(visit.season || "Maintenance visit")} · ${ui.escapeHtml(household.email || "No email on file")}</span></div><div class="inline-actions">${reports.length === 1 ? `<a class="button small ghost" href="report-view.html?id=${reports[0].id}">Review report</a>` : reports.length ? `<a class="button small ghost" href="#report-history-body">Review reports</a>` : ""}${ready ? `<button class="button small" type="button" data-action="email-reports" data-visit-id="${visit.id}">Email to client</button>` : ""}</div></div>`;
    }).join("");
    const recoveryCards = readyInspections.map((inspection) => { const asset=data.assets.find((item)=>item.id===inspection.assetId); return `<div class="report-delivery-strip warning"><div><strong>Field data complete — report not generated</strong><span>${ui.escapeHtml(asset ? [asset.brand,asset.model,asset.typeLabel].filter(Boolean).join(" ") : "Appliance")} · only completed technician data can create this report.</span></div><button class="button small secondary" type="button" data-action="generate-field-report" data-visit-id="${inspection.visitId}" data-asset-id="${inspection.assetId}">Generate health report</button></div>`; }).join("");
    deliveryHost.innerHTML = deliveryCards + recoveryCards;

    document.getElementById("report-history-body").innerHTML = data.reports.map(function (report) {
      return `<tr><td>${ui.shortDate(report.inspectionDate)}</td><td><div class="table-title">${ui.escapeHtml(report.applianceLabel)}</div></td><td>${badge(Number(report.score || 0) + "% " + (report.grade || ""))}</td><td>${badge(report.condition)}</td><td>${ui.escapeHtml(report.technician)}</td><td><a class="button small ghost" href="report-view.html?id=${report.id}">View</a></td></tr>`;
    }).join("") || `<tr><td colspan="6"><div class="empty-state">No appliance health reports stored yet.</div></td></tr>`;

    document.getElementById("plan-payment-card").innerHTML = `<div class="section-heading"><div><h2>Contact, plans, and payment</h2><p>${ui.escapeHtml(household.preferredContact)} preferred</p></div></div><div class="summary-lines"><div class="summary-line"><span>Contact</span><strong>${ui.escapeHtml(household.firstName + " " + household.lastName)}</strong></div><div class="summary-line"><span>Phone</span><strong>${ui.escapeHtml(household.phone)}</strong></div><div class="summary-line"><span>Email</span><strong>${ui.escapeHtml(household.email)}</strong></div><div class="summary-line"><span>Payment method</span><strong>${payment && payment.last4 ? `${payment.brand} •••• ${payment.last4}` : "Not connected"}</strong></div><div class="summary-line"><span>Filters due ≤ 30 days</span><strong>${dueFilters}</strong></div></div><div class="subscription-cards">${data.subscriptions.map((subscription) => `<div class="subscription-mini-card"><div><strong>${ui.escapeHtml(subscription.planName)}</strong>${badge(subscription.status)}</div><span>${ui.money(subscription.annualAmount)} / year</span><small>${subscription.autoRenew ? "Auto-renews until canceled" : "Manual renewal"} · ${ui.escapeHtml(subscription.chargeTiming || "Charge at scheduled maintenance")}${subscription.filterManagement ? " · Filter management" : ""}</small></div>`).join("")}</div>${payment && payment.status === "Ready" ? `<div class="callout"><strong>Payment ready</strong>The production server can create the Stripe PaymentIntent when the selected maintenance interval is ready to schedule.</div>` : `<div class="callout warning"><strong>Payment follow-up needed</strong>Connect a payment method before charging the scheduled maintenance interval.</div><button class="button wide secondary" id="connect-household-payment" type="button">Connect demo payment</button>`}<div class="billing-admin-box"><div class="field"><label>Household billing method</label><select id="household-billing-type"><option value="Card on File" ${(household.billingType||"Card on File")==="Card on File"?"selected":""}>Card on File</option><option value="AR Account" ${household.billingType==="AR Account"?"selected":""}>Account / AR</option></select></div><div class="field"><label>AR terms</label><input id="household-account-terms" value="${ui.escapeHtml(household.accountTerms||"Net 30")}" ${household.billingType==="AR Account"?"":"disabled"}></div><button class="button small secondary" id="save-household-billing" type="button">Save billing</button></div>${household.notes ? `<div class="callout info"><strong>Household notes</strong>${ui.escapeHtml(household.notes)}</div>` : ""}`;

    if (payment && payment.status !== "Ready") {
      const connect = document.getElementById("connect-household-payment");
      if (connect) connect.addEventListener("click", function () { WilsonStore.connectPayment(household.id); ui.toast("Payment connected", "Prototype payment profile is now ready."); render(); });
    }

    const billingType = document.getElementById("household-billing-type");
    const accountTerms = document.getElementById("household-account-terms");
    if (billingType) billingType.addEventListener("change", function(){ accountTerms.disabled = billingType.value !== "AR Account"; });
    const saveBilling = document.getElementById("save-household-billing");
    if (saveBilling) saveBilling.addEventListener("click", function(){ WilsonStore.setHouseholdBilling(household.id, billingType.value, accountTerms.value.trim()); ui.toast("Billing updated", billingType.value === "AR Account" ? "This household will route scheduled maintenance charges to AR." : "This household will use the card on file."); render(); });


    if (applianceLaunch) applianceLaunch.addEventListener("click", function(event){ if (applianceLaunch.getAttribute("aria-disabled") === "true") event.preventDefault(); });

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
    document.querySelectorAll("[data-action='email-reports']").forEach(function (button) {
      button.addEventListener("click", function () { const result=WilsonStore.queueReportEmail(button.dataset.visitId); ui.toast(result.ok ? "Report email queued" : "Report email blocked", result.message); render(); });
    });
    document.querySelectorAll("[data-action='generate-field-report']").forEach(function (button) {
      button.addEventListener("click", function () { const result=WilsonStore.generateReportFromTechInspection(button.dataset.visitId, button.dataset.assetId); ui.toast(result.ok ? "Health report generated" : "Report blocked", result.ok ? "The report was created from the completed technician record." : result.message); render(); });
    });
  }

  document.addEventListener("DOMContentLoaded", render);
})();

(function () {
  const ui = window.WilsonUI;
  const config = window.WILSON_CONFIG;
  let state = WilsonStore.load();
  let search = "";

  function householdById(id) { return state.households.find((item) => item.id === id); }
  function subscriptionById(id) { return state.subscriptions.find((item) => item.id === id); }
  function paymentForSubscription(subscription) { return subscription ? state.paymentProfiles.find((item) => item.id === subscription.paymentProfileId) : null; }
  function assetsForHousehold(id) { return state.assets.filter((item) => item.householdId === id); }
  function subscriptionsForHousehold(id) { return state.subscriptions.filter((item) => item.householdId === id); }
  function filtersForHousehold(id) { return state.filters.filter((item) => item.householdId === id); }
  function nextVisitForHousehold(id) { return state.visits.filter((item) => item.householdId === id && item.status !== "Completed").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null; }
  function withinSearch(household, subscription, visit) {
    if (!search) return true;
    return [household && household.name, household && household.city, subscription && subscription.planName, visit && visit.assetScope].filter(Boolean).join(" ").toLowerCase().includes(search);
  }

  function statusBadge(value) {
    const lower = String(value || "").toLowerCase();
    let cls = "";
    if (lower.includes("overdue") || lower.includes("missing") || lower.includes("action") || lower.includes("needs update") || lower.includes("not created")) cls = "danger";
    else if (lower.includes("due") || lower.includes("pending") || lower.includes("charge") || lower.includes("draft") || lower.includes("watch")) cls = "warning";
    else if (lower.includes("ready") || lower.includes("active") || lower.includes("pass") || lower.includes("paid") || lower.includes("accepted") || lower.includes("included") || lower.includes("completed") || lower.includes("matched")) cls = "success";
    else if (lower.includes("queued") || lower.includes("upcoming") || lower.includes("sent")) cls = "info";
    return `<span class="badge ${cls}">${ui.escapeHtml(value || "-")}</span>`;
  }

  function isCharged(visit) {
    const v = String(visit.paymentStatus || "").toLowerCase();
    return v.includes("charged") || v.includes("posted to ar") || v === "paid";
  }

  function billingReady(household, subscription) {
    if (household && household.billingType === "AR Account") return true;
    const p = paymentForSubscription(subscription);
    return p && p.status === "Ready";
  }

  function preference(subscription) {
    return subscription && subscription.preferredMonths ? subscription.preferredMonths : "No timing preference";
  }

  function opsCard(visit, mode) {
    const h = householdById(visit.householdId);
    const sub = subscriptionById(visit.subscriptionId);
    const days = ui.daysFromNow(visit.dueDate);
    const timing = days < 0 ? `${Math.abs(days)}d past target` : days === 0 ? "Today" : `${days}d to target`;
    const ar = h && h.billingType === "AR Account";
    const visitReports = state.reports.filter((r) => r.visitId === visit.id);
    let action = "";
    if (mode === "payment") action = `<a class="button small ghost" href="household.html?id=${h.id}">Fix billing</a>`;
    if (mode === "charge") action = `<button class="button small secondary" data-action="charge" data-visit-id="${visit.id}">${ar ? "Post to AR" : "Charge " + ui.money(visit.amountToCharge)}</button>`;
    if (mode === "ticket") action = `<button class="button small" data-action="service-order" data-visit-id="${visit.id}">Create ticket</button>`;
    if (mode === "tech") action = `<a class="button small" href="tech-maintenance.html?household=${h.id}&visit=${visit.id}">Open tech visit</a>`;
    if (mode === "report") {
      const ready = String(visit.reportDeliveryStatus || "").toLowerCase().includes("ready");
      action = `<div class="inline-actions"><a class="button small ghost" href="household.html?id=${h.id}#reports">Review ${visitReports.length || visit.reportCount || ""} report${(visitReports.length || visit.reportCount) === 1 ? "" : "s"}</a>${ready ? `<button class="button small" data-action="email-reports" data-visit-id="${visit.id}">Email to client</button>` : ""}</div>`;
    }
    if (mode === "history") action = `<a class="button small ghost" href="household.html?id=${h.id}#reports">View history</a>`;
    const healthStatus = mode === "report" ? ` ${statusBadge(visit.reportDeliveryStatus || "Report ready")}` : "";
    return `<article class="ops-item"><div class="ops-item-top"><a href="household.html?id=${h.id}">${ui.escapeHtml(h.name)}</a><span>${ui.shortDate(visit.dueDate)}</span></div><div class="ops-item-plan">${ui.escapeHtml(sub ? sub.planName : visit.category)} · ${ui.escapeHtml(visit.season || "Maintenance")}</div><div class="ops-item-meta"><span>${timing}</span><span>${ui.escapeHtml(preference(sub))}</span>${ar ? '<span class="ar-chip">AR</span>' : ""}</div><div class="ops-item-bottom"><span>${statusBadge(visit.paymentStatus)} ${statusBadge(visit.serviceOrderStatus)}${healthStatus}</span>${action}</div></article>`;
  }

  function renderCommandCenter() {
    const active = state.visits.filter((v) => v.status !== "Completed");
    const actionRequired = [];
    const readyCharge = [];
    const schedule = [];
    const upcoming = [];

    active.forEach((visit) => {
      const h = householdById(visit.householdId);
      const sub = subscriptionById(visit.subscriptionId);
      if (!withinSearch(h, sub, visit)) return;
      const days = ui.daysFromNow(visit.dueDate);
      const chargeWindow = days >= -14 && days <= 14;
      const payReady = billingReady(h, sub);
      const paymentProblem = Number(visit.amountToCharge || 0) > 0 && !payReady && !isCharged(visit);
      const chargedNoTicket = isCharged(visit) && String(visit.serviceOrderStatus || "").toLowerCase().includes("not created");
      if (paymentProblem || chargedNoTicket) actionRequired.push({ visit, mode: paymentProblem ? "payment" : "ticket" });
      else if (chargeWindow && Number(visit.amountToCharge || 0) > 0 && !isCharged(visit) && payReady) readyCharge.push(visit);
      else if (isCharged(visit) && !String(visit.serviceOrderStatus || "").toLowerCase().includes("matched")) schedule.push(visit);
      else if (days > 14) upcoming.push(visit);
    });

    const completed = state.visits.filter((v) => v.status === "Completed").sort((a,b) => {
      const ar = String(a.reportDeliveryStatus || "").toLowerCase().includes("ready") ? 1 : 0;
      const br = String(b.reportDeliveryStatus || "").toLowerCase().includes("ready") ? 1 : 0;
      if (ar !== br) return br - ar;
      return String(b.completedOn || b.dueDate).localeCompare(String(a.completedOn || a.dueDate));
    }).slice(0, 6);
    const readyToSend = completed.filter((v) => String(v.reportDeliveryStatus || "").toLowerCase().includes("ready"));

    document.getElementById("action-required-count").textContent = actionRequired.length;
    document.getElementById("ready-charge-count").textContent = readyCharge.length;
    document.getElementById("schedule-count").textContent = schedule.length;
    document.getElementById("completed-count").textContent = readyToSend.length || completed.length;
    document.getElementById("hero-due-count").textContent = actionRequired.length;
    document.getElementById("hero-filter-count").textContent = readyCharge.length;
    document.getElementById("hero-payment-count").textContent = schedule.length;
    document.getElementById("hero-report-count").textContent = readyToSend.length;

    document.getElementById("action-required-list").innerHTML = actionRequired.length ? actionRequired.map((x) => opsCard(x.visit, x.mode)).join("") : '<div class="ops-empty">Nothing blocked right now.</div>';
    document.getElementById("ready-charge-list").innerHTML = readyCharge.length ? readyCharge.map((v) => opsCard(v, "charge")).join("") : '<div class="ops-empty">No intervals inside the charge window.</div>';
    document.getElementById("schedule-list").innerHTML = schedule.length ? schedule.map((v) => opsCard(v, "ticket")).join("") : '<div class="ops-empty">No paid intervals waiting on a ticket.</div>';
    document.getElementById("completed-list").innerHTML = completed.length ? completed.map((v) => opsCard(v, v.reportDeliveryStatus ? "report" : "history")).join("") : '<div class="ops-empty">No completed maintenance yet.</div>';

    upcoming.sort((a,b) => a.dueDate.localeCompare(b.dueDate));
    document.getElementById("upcoming-count").textContent = upcoming.length + " upcoming";
    document.getElementById("upcoming-list").innerHTML = upcoming.slice(0, 8).map((v) => {
      const h = householdById(v.householdId); const sub = subscriptionById(v.subscriptionId);
      return `<div class="compact-upcoming-row"><div><a href="household.html?id=${h.id}">${ui.escapeHtml(h.name)}</a><span>${ui.escapeHtml(sub.planName)} · ${ui.escapeHtml(preference(sub))}</span></div><strong>${ui.shortDate(v.dueDate)}</strong></div>`;
    }).join("") || '<div class="empty-state">No upcoming intervals.</div>';
  }

  function renderHouseholds() {
    const filtered = state.households.filter((h) => !search || [h.name,h.city,subscriptionsForHousehold(h.id).map(s=>s.planName).join(" ")].join(" ").toLowerCase().includes(search));
    document.getElementById("household-count").textContent = filtered.length + " households";
    document.getElementById("household-table-body").innerHTML = filtered.map((h) => {
      const subs = subscriptionsForHousehold(h.id), assets = assetsForHousehold(h.id), next = nextVisitForHousehold(h.id), filters = filtersForHousehold(h.id);
      const profiles = state.paymentProfiles.filter((p) => subs.map(s=>s.paymentProfileId).includes(p.id));
      const ready = h.billingType === "AR Account" || (profiles.length && profiles.every(p=>p.status === "Ready"));
      return `<tr><td><a class="table-title text-link" href="household.html?id=${h.id}">${ui.escapeHtml(h.name)}</a><div class="table-sub">${ui.escapeHtml(h.address1)}, ${ui.escapeHtml(h.city)}</div></td><td>${subs.map(s=>statusBadge(s.planName)).join(" ")}</td><td><strong>${assets.length}</strong><div class="table-sub">equipment records</div></td><td><strong>${next ? ui.shortDate(next.dueDate) : "-"}</strong><div class="table-sub">${next ? next.status : "No interval"}</div></td><td>${statusBadge(h.billingType === "AR Account" ? "AR · " + (h.accountTerms || "Account") : (ready ? "Card ready" : "Payment issue"))}</td><td>${statusBadge(filters.filter(f=>ui.daysFromNow(f.nextDueOn)<=30).length ? "Due" : "Current")}</td><td><a class="button small ghost" href="household.html?id=${h.id}">Open</a></td></tr>`;
    }).join("");
  }

  function renderFilters() {
    const rows = state.filters.slice().sort((a,b)=>a.nextDueOn.localeCompare(b.nextDueOn));
    document.getElementById("filter-table-count").textContent = rows.length + " filters";
    document.getElementById("filter-table-body").innerHTML = rows.map((f)=>{ const h=householdById(f.householdId), a=state.assets.find(x=>x.id===f.assetId); return `<tr><td>${ui.shortDate(f.nextDueOn)}</td><td><a class="text-link" href="household.html?id=${h.id}">${ui.escapeHtml(h.name)}</a></td><td>${a?ui.escapeHtml(a.typeLabel+" · "+a.location):"Household"}</td><td>${ui.escapeHtml(f.filterType)}<div class="table-sub">${ui.escapeHtml(f.partNumber)}</div></td><td>${f.quantity}</td><td>${statusBadge(f.planCoverage||"Track only")}</td><td>${ui.escapeHtml(f.source)}</td><td>${statusBadge(f.status)}</td></tr>`; }).join("");
  }

  function renderReports() {
    document.getElementById("report-table-body").innerHTML = state.reports.slice().sort((a,b)=>b.inspectionDate.localeCompare(a.inspectionDate)).map((r)=>{
      const h=householdById(r.householdId), visit=state.visits.find((v)=>v.id===r.visitId);
      const delivery=visit?.reportDeliveryStatus || (r.source === "Field technician" ? "Generated" : "Historical");
      return `<tr><td>${ui.shortDate(r.inspectionDate)}</td><td><a class="text-link" href="household.html?id=${h.id}">${ui.escapeHtml(h.name)}</a></td><td>${ui.escapeHtml(r.applianceLabel)}</td><td>${statusBadge(Number(r.score||0)+"% "+(r.grade||""))}</td><td>${statusBadge(r.condition)}</td><td>${ui.escapeHtml(r.technician)}</td><td>${statusBadge(delivery)}</td><td><a class="button small ghost" href="report-view.html?id=${r.id}">View</a></td></tr>`;
    }).join("") || '<tr><td colspan="8"><div class="empty-state">No field-generated reports stored yet.</div></td></tr>';
  }

  function renderQuotes() {
    const quotes=(state.quotes||[]).slice().sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
    document.getElementById("quote-table-body").innerHTML=quotes.map(q=>`<tr><td>${ui.escapeHtml(q.quoteNumber)}</td><td>${ui.escapeHtml(q.propertyName)}</td><td>${ui.escapeHtml(q.contactName)}</td><td>${ui.escapeHtml(q.planName)}</td><td>${q.applianceCount||0}</td><td><strong>${ui.money(q.annualAmount)}</strong></td><td>${statusBadge(q.status)}</td><td><a class="button small ghost" href="quote-view.html?id=${q.id}">Open</a></td></tr>`).join("") || '<tr><td colspan="8"><div class="empty-state">No custom quotes stored yet.</div></td></tr>';
  }

  function renderPlans() {
    document.getElementById("plan-admin-grid").innerHTML=Object.values(config.appliancePlans).map(plan=>{ const price=plan.id==="per_appliance"?`${ui.money(config.pricing.standardApplianceAnnual)} standard · ${ui.money(config.pricing.imucPerVisit)} / IMUC visit`:ui.money(plan.annualPrice)+" / year"; return `<article class="plan-option"><div class="plan-name"><span>${ui.escapeHtml(plan.name)}</span><span class="badge">${plan.visitsPerYear} visit${plan.visitsPerYear===1?"":"s"}</span></div><div class="plan-price">${price}</div><p>${ui.escapeHtml(plan.description)}</p></article>`;}).join("");
    document.getElementById("hvac-plan-admin-grid").innerHTML=Object.values(config.hvacPlans).map(plan=>`<article class="plan-option"><div class="plan-name"><span>${ui.escapeHtml(plan.name)}</span></div><div class="plan-price">${ui.money(plan.pricePerSystemAnnual)} / system / year</div><p>${ui.escapeHtml(plan.description)}</p></article>`).join("");
    const rules=[["IMUC",`${ui.money(config.pricing.imucPerVisit)} per visit; 2× yearly recommended`],["Estate auto-selection","Compares per-appliance, Estate Annual, and Estate Preferred so IMUC-heavy homes receive the true lowest-cost starting tier"],["Charge window","Team can charge 14 days before through 14 days after the planned interval"],["Billing","Card on file or internal AR account"],["Ticket verification","Future EPASS daily export will verify a maintenance service order exists after payment"]];
    document.getElementById("pricing-rule-grid").innerHTML=rules.map(x=>`<div class="detail-tile"><div class="label">${ui.escapeHtml(x[0])}</div><div class="value">${ui.escapeHtml(x[1])}</div></div>`).join("");
  }

  function renderActivity() {
    document.getElementById("activity-list").innerHTML=state.activity.slice(0,20).map(item=>`<div class="activity-item"><div class="activity-icon">${ui.escapeHtml((item.type||"•").slice(0,1))}</div><div><p>${ui.escapeHtml(item.text)}</p><time>${new Date(item.createdAt).toLocaleString()}</time></div></div>`).join("");
  }

  function renderAll() { renderCommandCenter(); renderHouseholds(); renderFilters(); renderReports(); renderQuotes(); renderPlans(); renderActivity(); }

  function bindActions() {
    document.addEventListener("click", function(event) {
      const button=event.target.closest("[data-action]"); if(!button) return;
      if(button.dataset.action==="charge"){ const result=WilsonStore.mockCharge(button.dataset.visitId); ui.toast(result.ok?"Billing complete":"Billing blocked",result.message); }
      if(button.dataset.action==="service-order"){ WilsonStore.queueServiceOrder(button.dataset.visitId); ui.toast("Ticket queued","Service-order generation is marked ready for the future NetSuite/EPASS integration."); }
      if(button.dataset.action==="email-reports"){ const result=WilsonStore.queueReportEmail(button.dataset.visitId); ui.toast(result.ok?"Report email queued":"Report email blocked",result.message); }
      state=WilsonStore.load(); renderAll();
    });
  }

  document.addEventListener("DOMContentLoaded", function(){
    ui.setupTabs(document); bindActions(); renderAll();
    const hash=window.location.hash.replace("#",""); if(hash){ const b=document.querySelector(`[data-tab-target="panel-${hash}"]`); if(b)b.click(); }
  });
  const chooseFieldVisit=document.getElementById("choose-field-visit");
  if(chooseFieldVisit) chooseFieldVisit.addEventListener("click",function(){
    const tab=document.querySelector('[data-tab-target="panel-households"]'); if(tab) tab.click();
    const panel=document.getElementById("panel-households"); if(panel) panel.scrollIntoView({behavior:"smooth",block:"start"});
    ui.toast("Choose a residence","Open the household record, then launch the exact Appliance Maintenance visit. The tool will not guess a customer.");
  });
  document.getElementById("apply-filters").addEventListener("click",function(){ search=document.getElementById("dashboard-search").value.trim().toLowerCase(); renderCommandCenter(); renderHouseholds(); });
  document.getElementById("dashboard-search").addEventListener("keydown",function(e){if(e.key==="Enter")document.getElementById("apply-filters").click();});
  document.getElementById("reset-demo").addEventListener("click",function(){state=WilsonStore.reset();search="";document.getElementById("dashboard-search").value="";renderAll();ui.toast("Demo reset","Sample operations data restored.");});
})();

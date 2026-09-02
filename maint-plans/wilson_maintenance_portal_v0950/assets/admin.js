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

  /* Settled outcomes first -- see the note on badge() in household.js. A
     charge that went through contains the word "charge" and was reading as one
     that had not. */
  function statusBadge(value) {
    const lower = String(value || "").toLowerCase();
    let cls = "";
    if (lower.startsWith("charged") || lower.startsWith("posted to ar")
        || lower.startsWith("matched") || lower.startsWith("completed")
        || lower === "paid" || lower.includes("no additional charge")) cls = "success";
    else if (lower.includes("overdue") || lower.includes("missing") || lower.includes("action") || lower.includes("needs update") || lower.includes("not created")) cls = "danger";
    else if (lower.includes("due") || lower.includes("pending") || lower.includes("awaiting") || lower.includes("charge") || lower.includes("draft") || lower.includes("watch")) cls = "warning";
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

  const OPS = config.operations;

  /*
   * ONE QUEUE, SIX STAGES, IN THE ORDER THE OFFICE WORKS.  (v0.9.28)
   *
   * `filters` and `quotes` are new, and they are here because the tabs that
   * used to hold them are gone. The Filters tab was four rows, three of them
   * due -- a screen for a to-do list. The Quotes tab was a list nobody was
   * prompted to act on.
   *
   * What is NOT here, deliberately: households with no water test. It is a real
   * gap in the data, but nobody sitting at this screen can test the water --
   * the technician's visit screen already asks for it. An item the reader
   * cannot action is how a queue teaches people to stop reading it.
   */
  const STAGES = {
    blocked: { label: "Blocked",        tone: "danger",  hint: "Payment problem or a charged plan with no ticket" },
    charge:  { label: "Ready to charge", tone: "accent", hint: "Inside the " + OPS.chargeWindowDays + "-day window with payment ready" },
    ticket:  { label: "Needs ticket",    tone: "warn",   hint: "Paid or AR-posted, waiting on a service order" },
    filters: { label: "Filter verification", tone: "warn", hint: "Part number on file is a guess — confirm it in Filter Finder, then mark verified" },
    report:  { label: "Report ready",    tone: "success", hint: "Field complete, ready to send to the customer" },
    /*
     * v0.9.34. A household that enrolled with no brand on anything, which is
     * every household -- registration deliberately does not ask. Cayden's call:
     * "Nothing is blocked; it's a queue item with a due date." So it sits BELOW
     * everything that stops money or a truck, and above the quote nudge.
     */
    equipment: { label: "Needs equipment info", tone: "info", hint: "Enrolled with no brand or model, and a visit coming" },
    /*
     * v0.9.39. The technician's return-visit flag: something found at
     * maintenance that needs its own visit -- a duct teardown, an icemaker
     * deep clean. The office quotes it, gets the customer's approval, and
     * schedules it. It sits above the equipment nudge because a customer is
     * WAITING on it: the report already told them Wilson is coming back.
     */
    /* v0.9.41: the flag now walks Cayden's whole pipeline. Stage one is the
       TECHNICIAN'S row -- in the merged dashboard it IS the My Notifications
       entry ("triggers a backend notification to the techs dashboard to
       build quotes on follow up services"); here the office can see it and
       press the button on the tech's behalf. Stage two is the office's:
       the quote exists in ePass, pull it into Service Estimate Approvals. */
    /* v0.9.41: the customer already signed for this one -- the money is
       agreed, only the charge is outstanding, which is why it sits with the
       billing work rather than the quoting work. */
    amendcharge: { label: "Plan addition to bill", tone: "warn", hint: "Approved and signed in the field; charge the card on file for the difference" },
    followup: { label: "Follow-up quote to build", tone: "warn", hint: "Flagged in the field; the technician builds the quote and hits Quote complete" },
    sendquote: { label: "Estimate to send", tone: "warn", hint: "Quote built in ePass; import the PDF into Service Estimate Approvals — it emails the customer and tracks the answer" },
    quotes:  { label: "Quote quiet",     tone: "info",   hint: "Sent more than " + OPS.quoteStaleAfterDays + " days ago with no answer" },
  };
  /* Queue order is priority order, and it is declared once here rather than
     implied by the order of pushes into an array. */
  const STAGE_ORDER = ["blocked", "charge", "amendcharge", "ticket", "filters", "report", "followup", "sendquote", "equipment", "quotes"];

  let queueFilter = null;
  let lastQueue = [];

  /* "Appliances trending down" rendered here until v0.9.49. Removed at
     Cayden's call: the office has no action on a drifting reading — the
     customer sees the trend in their report year over year, and that is the
     product doing its job. Decline detection (trend-analysis.js) is
     untouched; household files and reports still surface it. */

  function renderQueue(queue) {
    lastQueue = queue;
    const host = document.getElementById("ops-queue");
    if (!host) return;
    const shown = queueFilter ? queue.filter((q) => q.stage === queueFilter) : queue;
    const summary = document.getElementById("queue-summary");
    const clear = document.getElementById("queue-clear-filter");
    if (summary) {
      summary.textContent = queueFilter
        ? `${shown.length} ${STAGES[queueFilter].label.toLowerCase()} · ${queue.length} in the queue`
        : `${queue.length} item${queue.length === 1 ? "" : "s"} in the queue`;
    }
    if (clear) clear.classList.toggle("hidden", !queueFilter);

    if (!shown.length) {
      host.innerHTML = queue.length
        ? `<div class="ops-empty">Nothing at this stage. <button class="link-button" data-queue-filter-clear type="button">Show the whole queue</button></div>`
        : `<div class="ops-empty">The queue is clear. Nothing is blocked, due to charge, or waiting on a ticket.</div>`;
    } else {
      /* Dispatch on kind. The queue used to hold visits only, so this called
         opsCard directly; filters and quotes are not visits and rendering them
         through a visit card would have meant faking a visit shape. */
      host.innerHTML = shown.map(function (q) {
        if (q.kind === "filter") return filterCard(q);
        if (q.kind === "equipment") return equipmentCard(q);
        if (q.kind === "followup") return followUpCard(q.followUp);
        if (q.kind === "sendquote") return sendQuoteCard(q.followUp);
        if (q.kind === "amendcharge") return amendChargeCard(q.amendment);
        if (q.kind === "quote") return quoteCard(q);
        return opsCard(q.visit, q.mode, q.stage);
      }).join("");
    }

    document.querySelectorAll("[data-queue-filter]").forEach((el) => {
      const on = el.dataset.queueFilter === queueFilter;
      el.setAttribute("aria-pressed", on ? "true" : "false");
      el.classList.toggle("active", on);
    });
  }

  function stageChip(stage) {
    return stage && STAGES[stage]
      ? `<span class="stage-chip ${STAGES[stage].tone}" title="${ui.escapeHtml(STAGES[stage].hint)}">${STAGES[stage].label}</span>`
      : "";
  }

  /*
   * A FILTER TO VERIFY.
   *
   * "Filters due" retired at Cayden's call: the filter is always replaced at
   * the maintenance visit, so a due date is not office work. What IS office
   * work is making sure the part number on file is right — a self-registered
   * customer never typed a model number, so their filter records are guesses
   * until someone runs the unit through Filter Finder. The row leads with
   * what needs confirming and deep-links Filter Finder with the unit's brand,
   * model and serial already filled in.
   */
  function filterCard(item) {
    const f = item.filter;
    const h = householdById(f.householdId);
    const asset = state.assets.find(function (a) { return a.id === f.assetId; });
    const guess = f.partNumber && f.partNumber !== "To verify" ? f.partNumber : "";
    const finderLink = "filter-finder.html" + (asset
      ? "?brand=" + encodeURIComponent(asset.brand || "") +
        "&model=" + encodeURIComponent(asset.model || "") +
        "&serial=" + encodeURIComponent(asset.serial || "")
      : "");
    return `<article class="ops-item ops-row stage-filters">
      <div class="ops-row-stage">${stageChip("filters")}<span class="ops-timing">${guess ? "confirm part" : "no part on file"}</span></div>
      <div class="ops-row-body">
        <div class="ops-item-top"><a href="household.html?id=${h.id}">${ui.escapeHtml(h ? h.name : "Household")}</a></div>
        <div class="ops-item-plan">${ui.escapeHtml(f.filterType)} · ${guess ? "on file: " + ui.escapeHtml(guess) : "part number never confirmed"} · qty ${Number(f.quantity || 1)}${asset ? " · " + ui.escapeHtml(asset.typeLabel + " (" + asset.location + ")") : ""}${asset && (asset.brand || asset.model) ? `<div class="table-sub">${ui.escapeHtml([asset.brand, asset.model].filter(Boolean).join(" "))}${asset.serial ? " · S/N " + ui.escapeHtml(asset.serial) : ""}</div>` : ""}</div>
        <div class="ops-item-bottom">${statusBadge(f.planCoverage || "Track only")} ${statusBadge(f.status)}</div>
        ${schedulingChip(h)}
      </div>
      <div class="ops-row-action">
        <a class="button small ghost" href="${finderLink}">Filter Finder</a>
        <button class="button small" type="button" data-action="filter-verified" data-filter-id="${f.id}" data-part="${ui.escapeHtml(guess)}">Mark verified</button>
      </div>
    </article>`;
  }

  /*
   * A HOUSEHOLD WHOSE APPLIANCES ARE STILL ANONYMOUS.
   *
   * Urgency comes from the visit, not from the gap: nobody needs to chase this
   * for a household whose first visit is in July. It escalates as the date
   * approaches and says how many appliances are waiting, because "3 of 11" and
   * "11 of 11" are different jobs.
   */
  function followUpCard(f) {
    const h = householdById(f.householdId);
    const age = Math.max(0, -ui.daysFromNow(f.createdAt ? f.createdAt.slice(0, 10) : ""));
    return `<article class="ops-item ops-row stage-followup">
      <div class="ops-row-stage">${stageChip("followup")}<span class="ops-timing">${isFinite(age) ? age + "d old" : ""}</span></div>
      <div class="ops-row-main">
        <a href="household.html?id=${ui.escapeHtml(f.householdId)}">${ui.escapeHtml(h ? h.name : "Household")}</a>
        <span class="table-sub">${ui.escapeHtml(f.applianceLabel)} · ${ui.escapeHtml(f.checkName)}${f.verdict ? " · " + ui.escapeHtml(f.verdict) : ""}</span>
        ${f.note ? `<span class="table-sub">“${ui.escapeHtml(f.note)}” — ${ui.escapeHtml(f.technician)}</span>` : ""}
        <span class="table-sub ops-merge-note">Merged dashboard: this row lands in ${ui.escapeHtml(f.technician || "the technician")}'s My Notifications to build the quote.</span>
      </div>
      <div class="ops-row-action">
        <button class="button small" type="button" data-followup-quoted="${ui.escapeHtml(f.id)}">Quote complete</button>
        <a class="button small ghost" href="report-view.html?id=${ui.escapeHtml(f.reportId)}">Report</a>
      </div>
    </article>`;
  }

  /* v0.9.41: a field-approved plan addition waiting on its charge. Everything
     on the card is out of the amendment record the customer signed -- the
     numbers were computed by the pricing engine at approval and are never
     recomputed here, because the charge must match the signature. */
  function amendChargeCard(a) {
    const h = householdById(a.householdId);
    const age = Math.max(0, -ui.daysFromNow(a.approvedAt ? a.approvedAt.slice(0, 10) : ""));
    return `<article class="ops-item ops-row stage-amendcharge">
      <div class="ops-row-stage">${stageChip("amendcharge")}<span class="ops-timing">${isFinite(age) ? age + "d ago" : ""}</span></div>
      <div class="ops-row-main">
        <a href="household.html?id=${ui.escapeHtml(a.householdId)}">${ui.escapeHtml(h ? h.name : "Household")}</a>
        <span class="table-sub">${[
          a.addedLabels && a.addedLabels.length ? "Added: " + a.addedLabels.join(", ") : "",
          a.removedLabels && a.removedLabels.length ? "Removed: " + a.removedLabels.join(", ") : "",
          a.planChange ? "Plan: " + a.planChange.from + " → " + a.planChange.to : "",
          a.servicedNow ? "serviced at the visit — full-year price" : "",
          a.renewalPassed ? "renewal passed — full difference due" : "",
          a.optInChanges ? a.optInChanges + " add-on change" + (a.optInChanges === 1 ? "" : "s") : ""
        ].filter(Boolean).map(ui.escapeHtml).join(" · ") || "Add-on changes"}</span>
        <span class="table-sub">${ui.money(a.previousAnnual)} → ${ui.money(a.newAnnual)} / year${a.prorationDaysRemaining !== null && a.prorationDaysRemaining !== undefined ? ` · ${a.prorationDaysRemaining} days left this year` : ""}${a.renewalOn ? ` · new annual from ${ui.escapeHtml(a.renewalOn)}` : ""} · signed ${a.signature ? "✓" : "(no image)"}</span>
      </div>
      <div class="ops-row-action">
        <button class="button small" type="button" data-amendment-charged="${ui.escapeHtml(a.id)}">${(function () {
          const settle = a.proratedDifference !== undefined ? a.proratedDifference : a.difference;
          if (a.chargeStatus === "Pending credit") return "Settle " + ui.money(Math.abs(settle)) + " prorated reduction";
          if (a.chargeStatus === "Pending confirmation") return "Confirm the change";
          return "Charge " + ui.money(settle) + (a.servicedNow || a.renewalPassed ? "" : " prorated");
        })()}</button>
      </div>
    </article>`;
  }

  /* Stage two: the technician's quote exists in ePass; the office pulls the
     service quote PDF into Service Estimate Approvals, which emails the
     customer and distributes the decision. One button, because the moment it
     is imported over there, THAT tool owns it and this queue lets go. */
  function sendQuoteCard(f) {
    const h = householdById(f.householdId);
    const age = Math.max(0, -ui.daysFromNow(f.quotedAt ? f.quotedAt.slice(0, 10) : ""));
    return `<article class="ops-item ops-row stage-sendquote">
      <div class="ops-row-stage">${stageChip("sendquote")}<span class="ops-timing">${isFinite(age) ? age + "d waiting" : ""}</span></div>
      <div class="ops-row-main">
        <a href="household.html?id=${ui.escapeHtml(f.householdId)}">${ui.escapeHtml(h ? h.name : "Household")}</a>
        <span class="table-sub">${ui.escapeHtml(f.applianceLabel)} · ${ui.escapeHtml(f.checkName)}${f.serviceOrderRef ? " · " + ui.escapeHtml(f.serviceOrderRef) : ""}</span>
        <span class="table-sub">Find the quote in ePass, print the Work Order, then Scan a service quote PDF in Service Estimate Approvals — it emails the customer and tracks Sent / Viewed / Shopping from there.</span>
      </div>
      <div class="ops-row-action">
        <button class="button small" type="button" data-followup-handed="${ui.escapeHtml(f.id)}">Imported to Estimate Approvals</button>
        <a class="button small ghost" href="report-view.html?id=${ui.escapeHtml(f.reportId)}">Report</a>
      </div>
    </article>`;
  }

  function equipmentCard(item) {
    const g = item.gaps;
    const h = householdById(g.householdId);
    const days = g.dueDate ? ui.daysFromNow(g.dueDate) : null;
    const timing = days === null ? "No visit booked"
      : days < 0 ? Math.abs(days) + "d overdue"
      : days === 0 ? "Visit today" : days + "d to visit";
    return `<article class="ops-item ops-row stage-equipment">
      <div class="ops-row-stage">${stageChip("equipment")}<span class="ops-timing">${timing}</span></div>
      <div class="ops-row-body">
        <div class="ops-item-top"><a href="household.html?id=${h.id}">${ui.escapeHtml(h ? h.name : "Household")}</a></div>
        <div class="ops-item-plan">${g.missing
          ? g.missing + " of " + g.total + " appliance" + (g.total === 1 ? "" : "s") + " with no brand or model" +
            (g.undated ? " \u00b7 " + g.undated + " with no install date" : "")
          : g.blockedCount + " appliance" + (g.blockedCount === 1 ? "" : "s") + " on the plan Wilson cannot cover"}</div>
        <div class="ops-item-bottom">${g.blockedCount
          ? `<span class="badge danger">${ui.escapeHtml(g.blocked.map(function (x) { return x.serviceability.brand || x.asset.brand; }).join(", "))} — take off the plan</span>`
          : statusBadge(g.missing === g.total ? "Nothing on file yet" : "Partly filled in")}</div>
        ${schedulingChip(h)}
      </div>
      <div class="ops-row-action"><a class="button small" href="equipment.html?id=${h.id}">Add details</a></div>
    </article>`;
  }

  /*
   * A QUOTE THAT HAS GONE QUIET.
   *
   * The softest item in the queue and last in it -- a nudge, not a blocker. It
   * only appears once the quote has been silent past the configured threshold,
   * because a quote sent yesterday is not work.
   */
  function quoteCard(item) {
    const q = item.quote;
    const days = item.silentDays;
    return `<article class="ops-item ops-row stage-quotes">
      <div class="ops-row-stage">${stageChip("quotes")}<span class="ops-timing">${days}d quiet</span></div>
      <div class="ops-row-body">
        <div class="ops-item-top"><a href="quote-view.html?id=${q.id}">${ui.escapeHtml(q.propertyName)}</a></div>
        <div class="ops-item-plan">${ui.escapeHtml(q.quoteNumber)} · ${ui.escapeHtml(q.planName || "Plan")} · ${ui.money(q.annualAmount)} / year${q.contactName ? " · " + ui.escapeHtml(q.contactName) : ""}</div>
        <div class="ops-item-bottom">${statusBadge(q.status)}${q.validUntil ? ` <span class="ops-quote-valid">valid to ${ui.shortDate(q.validUntil)}</span>` : ""}</div>
      </div>
      <div class="ops-row-action"><a class="button small ghost" href="quote-view.html?id=${q.id}">Open quote</a></div>
    </article>`;
  }

  function opsCard(visit, mode, stage) {
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
      const count = visitReports.length || Number(visit.reportCount || 0);
      /* One appliance goes straight to its report; a whole stop goes to the
         compiled review, which is the thing that actually gets sent. */
      const reviewHref = count > 1
        ? `visit-report.html?visit=${encodeURIComponent(visit.id)}`
        : (visitReports.length === 1 ? `report-view.html?id=${visitReports[0].id}` : `household.html?id=${h.id}#reports`);
      action = `<div class="inline-actions"><a class="button small ghost" href="${reviewHref}">${count > 1 ? "Review whole visit (" + count + ")" : "Review report"}</a>${ready ? `<button class="button small" data-action="email-reports" data-visit-id="${visit.id}">Email to client</button>` : ""}</div>`;
    }
    if (mode === "history") action = `<a class="button small ghost" href="household.html?id=${h.id}#reports">View history</a>`;
    const healthStatus = mode === "report" ? ` ${statusBadge(visit.reportDeliveryStatus || "Report ready")}` : "";
    const chip = stageChip(stage);
    /* Three grid children, in reading order: what stage it is at, what it is,
       and the one thing to do about it. The card previously emitted five
       siblings that auto-placed across the grid and scattered. */
    return `<article class="ops-item ops-row ${stage ? "stage-" + stage : ""}">
      <div class="ops-row-stage">${chip}<span class="ops-timing">${timing}</span></div>
      <div class="ops-row-body">
        <div class="ops-item-top"><a href="household.html?id=${h.id}">${ui.escapeHtml(h.name)}</a>${ar ? '<span class="ar-chip">AR</span>' : ""}</div>
        <div class="ops-item-plan">${ui.escapeHtml(sub ? sub.planName : visit.category)} · ${ui.escapeHtml(visit.season || "Maintenance")} · due ${ui.shortDate(visit.dueDate)}</div>
        <div class="ops-item-bottom">${statusBadge(visit.paymentStatus)} ${statusBadge(visit.serviceOrderStatus || "Not created")}${healthStatus}</div>
        ${schedulingChip(h)}
      </div>
      <div class="ops-row-action">${action}</div>
    </article>`;
  }

  /*
   * THE CONSTRAINTS, ON THE ROW WHERE THE TICKET GETS PLACED.  (v0.9.27)
   *
   * A visit waiting on a service order is a visit somebody is about to enter in
   * ePass, and this is the moment they need to know the family is away in
   * February and there is a dog behind the gate. One line, and only when the
   * household actually has constraints -- an empty line on every row would
   * train people to stop reading it.
   *
   * Access constraints get their own amber marker: those are the ones that
   * turn a technician away at the kerb.
   */
  function schedulingChip(household) {
    if (!window.WILSON_SCHEDULING || !household) return "";
    const pref = household.schedulingPreference || null;
    if (window.WILSON_SCHEDULING.isEmpty(pref)) return "";
    const summary = window.WILSON_SCHEDULING.summary(pref);
    const hasAccess = ((pref && pref.access) || []).length > 0;
    return `<div class="ops-item-sched${hasAccess ? " has-access" : ""}">` +
           `${hasAccess ? '<span aria-hidden="true">!</span>' : '<span aria-hidden="true">\u25f4</span>'}` +
           `<span>${ui.escapeHtml(summary)}</span></div>`;
  }

  /*
   * THE STAT BAR, RENDERED FROM THE STAGE LIST.
   *
   * Previously four buttons hardcoded in admin.html, whose ids had drifted from
   * what they displayed. Generating them from STAGE_ORDER means adding a stage
   * cannot leave the bar behind, and the counts come from the assembled queue
   * rather than from four separately-derived arrays.
   *
   * A stage with nothing in it stays visible but reads as empty -- the office
   * needs to know that nothing is blocked, which is different from not being
   * told whether anything is blocked.
   */
  function renderStatBar() {
    const host = document.getElementById("ops-bar-stats");
    if (!host) return;
    host.innerHTML = STAGE_ORDER.map(function (stage) {
      return `<button class="ops-stat" type="button" data-queue-filter="${stage}" aria-pressed="false"
                title="${ui.escapeHtml(STAGES[stage].hint)}">
        <strong data-stat-count="${stage}">0</strong><span>${ui.escapeHtml(STAGES[stage].label)}</span>
      </button>`;
    }).join("");
    const sub = document.getElementById("ops-bar-sub");
    if (sub) {
      sub.textContent = "Charge window is " + OPS.chargeWindowDays +
        " days either side of the planned interval";
    }
  }

  function paintStatBar(queue) {
    const counts = {};
    queue.forEach(function (item) { counts[item.stage] = (counts[item.stage] || 0) + 1; });
    STAGE_ORDER.forEach(function (stage) {
      const el = document.querySelector('[data-stat-count="' + stage + '"]');
      if (el) el.textContent = counts[stage] || 0;
      const btn = document.querySelector('[data-queue-filter="' + stage + '"]');
      if (btn) btn.classList.toggle("is-empty", !counts[stage]);
    });
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
      const chargeWindow = days >= -OPS.chargeWindowDays && days <= OPS.chargeWindowDays;
      const payReady = billingReady(h, sub);
      const paymentProblem = Number(visit.amountToCharge || 0) > 0 && !payReady && !isCharged(visit);
      const chargedNoTicket = isCharged(visit) && String(visit.serviceOrderStatus || "").toLowerCase().includes("not created");
      if (paymentProblem || chargedNoTicket) actionRequired.push({ visit, mode: paymentProblem ? "payment" : "ticket" });
      else if (chargeWindow && Number(visit.amountToCharge || 0) > 0 && !isCharged(visit) && payReady) readyCharge.push(visit);
      else if (isCharged(visit) && !String(visit.serviceOrderStatus || "").toLowerCase().includes("matched")) schedule.push(visit);
      else if (days > OPS.chargeWindowDays) upcoming.push(visit);
    });

    const completed = state.visits.filter((v) => v.status === "Completed").sort((a,b) => {
      const ar = String(a.reportDeliveryStatus || "").toLowerCase().includes("ready") ? 1 : 0;
      const br = String(b.reportDeliveryStatus || "").toLowerCase().includes("ready") ? 1 : 0;
      if (ar !== br) return br - ar;
      return String(b.completedOn || b.dueDate).localeCompare(String(a.completedOn || a.dueDate));
    }).slice(0, 6);
    const readyToSend = completed.filter((v) => String(v.reportDeliveryStatus || "").toLowerCase().includes("ready"));

    /*
     * The four per-column badges are gone with the columns. They duplicated these
     * same four numbers, and one of them disagreed: `completed-count` was
     * `readyToSend.length || completed.length`, so at zero it silently switched to
     * counting completed visits -- the badge meant one thing when non-zero and a
     * different thing at zero. One set of counts now, in the operating bar.
     */
    /* Counts are painted from the assembled queue further down, so the bar and
       the list cannot disagree. The four ids this replaced had drifted from
       their contents -- `hero-filter-count` was showing the charge count -- and
       one of them changed meaning at zero. */

    /*
     * One queue, ordered by urgency. The stage a visit sits in is real information,
     * so it stays -- as a chip on the row rather than as a column the reader has to
     * scan across. Order is the priority the office actually works in: something
     * blocking money first, then money to take, then work to dispatch, then
     * finished work to deliver.
     */
    /*
     * FILTER VERIFICATION. "Filters due" retired (v0.9.49): replacement
     * happens at the maintenance visit, so a due date was noise the office
     * could do nothing with. The queue now holds only filters whose part
     * number nobody has confirmed — no part on file sorts first, because a
     * blank is a plan priced on nothing.
     */
    const filterItems = state.filters
      .filter(function (f) {
        if (f.verified) return false;
        const h = householdById(f.householdId);
        return withinSearch(h, null, null);
      })
      .sort(function (a, b) {
        const aBlank = !a.partNumber || a.partNumber === "To verify" ? 0 : 1;
        const bBlank = !b.partNumber || b.partNumber === "To verify" ? 0 : 1;
        return aBlank - bBlank;
      })
      .map(function (f) { return { kind: "filter", stage: "filters", filter: f }; });

    /*
     * QUOTES GONE QUIET. Only a quote that was actually SENT -- a draft nobody
     * sent is not waiting on the customer, it is waiting on Wilson, and calling
     * it "quiet" would blame the wrong party. An accepted quote has a household
     * and is finished with.
     */
    const quoteItems = (state.quotes || [])
      .filter(function (q) {
        if (q.householdId) return false;
        if (String(q.status || "") !== "Sent") return false;
        if (!withinSearch({ name: q.propertyName, city: "" }, { planName: q.planName || "" }, null)) return false;
        return -ui.daysFromNow(q.updatedAt || q.createdAt) >= OPS.quoteStaleAfterDays;
      })
      .map(function (q) {
        return { kind: "quote", stage: "quotes", quote: q,
                 silentDays: -ui.daysFromNow(q.updatedAt || q.createdAt) };
      })
      .sort(function (a, b) { return b.silentDays - a.silentDays; });

    /*
     * EQUIPMENT GAPS. Only households with a visit actually coming: a gap on a
     * household whose next visit is eight months out is real but is not today's
     * work, and a queue that lists it teaches people to skim.
     */
    const equipmentItems = state.households
      .map(function (h) { return WilsonStore.equipmentGaps(h.id); })
      .filter(function (g) {
        if (!g || (!g.missing && !g.blockedCount)) return false;
        const h = householdById(g.householdId);
        if (!withinSearch(h, null, null)) return false;
        if (!g.dueDate) return false;
        return ui.daysFromNow(g.dueDate) <= OPS.equipmentLeadDays;
      })
      .sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); })
      .map(function (g) { return { kind: "equipment", stage: "equipment", gaps: g }; });

    /* Assembled by declared stage order rather than by the order of these
       pushes, so re-prioritising is a one-line change in STAGE_ORDER. */
    const byStage = {
      blocked: actionRequired.map((x) => ({ kind: "visit", visit: x.visit, mode: x.mode, stage: "blocked" })),
      charge: readyCharge.map((v) => ({ kind: "visit", visit: v, mode: "charge", stage: "charge" })),
      ticket: schedule.map((v) => ({ kind: "visit", visit: v, mode: "ticket", stage: "ticket" })),
      filters: filterItems,
      report: readyToSend.map((v) => ({ kind: "visit", visit: v, mode: "report", stage: "report" })),
      equipment: equipmentItems,
      followup: (WilsonStore.openFollowUps ? WilsonStore.openFollowUps() : [])
        .filter(function (f) { return withinSearch(householdById(f.householdId), null, null); })
        .map(function (f) { return { kind: "followup", stage: "followup", followUp: f }; }),
      sendquote: (WilsonStore.quotedFollowUps ? WilsonStore.quotedFollowUps() : [])
        .filter(function (f) { return withinSearch(householdById(f.householdId), null, null); })
        .map(function (f) { return { kind: "sendquote", stage: "sendquote", followUp: f }; }),
      amendcharge: (WilsonStore.pendingAmendments ? WilsonStore.pendingAmendments() : [])
        .filter(function (a) { return withinSearch(householdById(a.householdId), null, null); })
        .map(function (a) { return { kind: "amendcharge", stage: "amendcharge", amendment: a }; }),
      quotes: quoteItems
    };
    const queue = STAGE_ORDER.reduce(function (all, stage) {
      return all.concat(byStage[stage] || []);
    }, []);
    paintStatBar(queue);
    renderQueue(queue);

    upcoming.sort((a,b) => a.dueDate.localeCompare(b.dueDate));
    document.getElementById("upcoming-count").textContent = upcoming.length + " upcoming";
    document.getElementById("upcoming-list").innerHTML = upcoming.slice(0, OPS.upcomingPreviewCount).map((v) => {
      const h = householdById(v.householdId); const sub = subscriptionById(v.subscriptionId);
      return `<div class="compact-upcoming-row"><div><a href="household.html?id=${h.id}">${ui.escapeHtml(h.name)}</a><span>${ui.escapeHtml(sub.planName)} · ${ui.escapeHtml(preference(sub))}</span></div><strong>${ui.shortDate(v.dueDate)}</strong></div>`;
    }).join("") || '<div class="empty-state">No upcoming intervals.</div>';
  }

  /* One screen, one renderer. renderHouseholds moved to customers.js; the
     Filters, Health, Quotes, Plan Setup and Activity renderers went with their
     tabs -- three were global copies of household panels, one was reference
     material, and the Quotes list became a queue stage. */
  function renderAll() { renderCommandCenter(); }

  function bindActions() {
    document.addEventListener("click", function(event) {
      const button=event.target.closest("[data-action]"); if(!button) return;
      if(button.dataset.action==="charge"){ const result=WilsonStore.mockCharge(button.dataset.visitId); ui.toast(result.ok?"Billing complete":"Billing blocked",result.message); }
      if(button.dataset.action==="service-order"){ WilsonStore.queueServiceOrder(button.dataset.visitId); ui.toast("Ticket queued","Service-order generation is marked ready for the future NetSuite/EPASS integration."); }
      if(button.dataset.action==="email-reports"){ const result=WilsonStore.queueReportEmail(button.dataset.visitId); ui.toast(result.ok?"Report email queued":"Report email blocked",result.message); }
      if(button.dataset.action==="filter-verified"){
        /* Confirm-or-correct in one gesture: the prompt opens prefilled with
           whatever registration guessed, so a right guess is one Enter and a
           wrong one is a paste from Filter Finder. */
        const part = window.prompt("Confirmed part number (from Filter Finder or the manufacturer's lookup):", button.dataset.part || "");
        if (part === null) return;
        if (!String(part).trim()) { ui.toast("Not verified", "A verification needs the confirmed part number."); return; }
        const result = WilsonStore.markFilterVerified(button.dataset.filterId, part);
        ui.toast(result.ok ? "Filter verified" : "Not verified", result.message);
      }
      state=WilsonStore.load(); renderAll();
    });
  }

  document.addEventListener("DOMContentLoaded", function(){
    /* No ui.setupTabs and no hash-to-tab jump: there is one panel now. Links
       that used to point at admin.html#households or #imports go to
       customers.html and invoice-import.html instead. */
    renderStatBar(); bindActions(); renderAll();
  });
  /* This used to click a tab. Field visits are launched from a household, and
     the household list is now its own page. */
  const chooseFieldVisit=document.getElementById("choose-field-visit");
  if(chooseFieldVisit) chooseFieldVisit.addEventListener("click",function(){
    window.location.href = "customers.html";
  });

  /* The summary counts double as queue filters -- clicking "Blocked" narrows the
     queue to blocked items rather than being a number you read and then hunt for. */
  /* Delegated, because the stat buttons are rendered from STAGE_ORDER and did
     not exist when this file loaded. The previous version bound them directly at
     load, which worked only because they were hardcoded in the markup. */
  document.addEventListener("click", function(event){
    const btn = event.target.closest("[data-queue-filter]");
    if (!btn) return;
    const next = btn.dataset.queueFilter;
    queueFilter = queueFilter === next ? null : next;
    renderQueue(lastQueue);
  });
  document.addEventListener("click", function(event){
    if (event.target.closest("#queue-clear-filter") || event.target.closest("[data-queue-filter-clear]")) {
      queueFilter = null;
      renderQueue(lastQueue);
    }
  });
  /* v0.9.41: the two pipeline buttons. Quote complete asks for the SV number
     because the office's next step is finding exactly that quote in ePass --
     but does not demand it; a blank answer still moves the work. */
  document.addEventListener("click", function(event){
    const btn = event.target.closest("[data-followup-quoted]");
    if (!btn) return;
    const ref = (window.prompt("ePass service order / quote number (optional):", "") || "").trim();
    const res = WilsonStore.markFollowUpQuoted(btn.dataset.followupQuoted, { ref: ref });
    if (res && res.ok) renderAll();
  });
  document.addEventListener("click", function(event){
    const btn = event.target.closest("[data-followup-handed]");
    if (!btn) return;
    const res = WilsonStore.handFollowUpToApprovals(btn.dataset.followupHanded);
    if (res && res.ok) renderAll();
  });
  document.addEventListener("click", function(event){
    const btn = event.target.closest("[data-amendment-charged]");
    if (!btn) return;
    const res = WilsonStore.markAmendmentCharged(btn.dataset.amendmentCharged);
    ui.toast(res.ok ? "Difference charged" : "Charge blocked", res.ok
      ? "The production server creates the Stripe PaymentIntent for the difference; the prototype records the action."
      : res.message);
    if (res && res.ok) renderAll();
  });

  document.getElementById("apply-filters").addEventListener("click",function(){ search=document.getElementById("dashboard-search").value.trim().toLowerCase(); renderAll(); });
  document.getElementById("dashboard-search").addEventListener("keydown",function(e){if(e.key==="Enter")document.getElementById("apply-filters").click();});
  /* Guarded: an unguarded getElementById().addEventListener() throws and takes
     the rest of the module's bindings with it. Dropping this button from the
     markup during the v0.9.28 rework did exactly that, and the queue's own
     handlers stopped working as collateral. */
  const resetButton = document.getElementById("reset-demo");
  if (resetButton) resetButton.addEventListener("click", function () {
    state = WilsonStore.reset();
    search = "";
    document.getElementById("dashboard-search").value = "";
    renderAll();
    ui.toast("Demo reset", "Sample operations data restored.");
  });
})();

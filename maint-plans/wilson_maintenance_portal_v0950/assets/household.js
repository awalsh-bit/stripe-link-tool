(function () {
  const ui = window.WilsonUI;
  let state = WilsonStore.load();
  const params = new URLSearchParams(window.location.search);
  const householdId = params.get("id") || state.households[0].id;

  /*
   * SETTLED OUTCOMES ARE CHECKED FIRST, and that ordering is the whole point.
   *
   * These rules match substrings, and the generic ones were winning over the
   * specific ones: "Charged - $3,145.00" contains "charge", so a payment that
   * had gone through wore the same amber badge as one that was still due.
   * "Included - no additional charge" did too, and so did the new "Awaiting
   * payment method" -- which meant the entire payment column rendered one
   * colour and carried no information at all.
   *
   * Four good outcomes were mislabelled this way: a completed charge, a
   * completed visit, a reconciled service order, and a visit with nothing
   * owed. Anything genuinely finished is now matched before the loose words.
   */
  function badge(value) {
    const lower = String(value || "").toLowerCase();
    let cls = "";
    if (lower.startsWith("charged") || lower.startsWith("posted to ar")
        || lower.startsWith("matched") || lower.startsWith("completed")
        || lower === "paid" || lower.includes("no additional charge")) cls = "success";
    else if (lower.includes("overdue") || lower.includes("missing") || lower.includes("action")) cls = "danger";
    else if (lower.includes("due") || lower.includes("pending") || lower.includes("awaiting") || lower.includes("charge") || lower.includes("watch")) cls = "warning";
    else if (lower.includes("ready") || lower.includes("active") || lower.includes("pass") || lower.includes("paid") || lower.includes("good") || lower.includes("included")) cls = "success";
    else if (lower.includes("queued") || lower.includes("upcoming")) cls = "info";
    return `<span class="badge ${cls}">${ui.escapeHtml(value || "-")}</span>`;
  }

  /*
   * WHAT IT TAKES TO GET INTO THIS HOUSE.
   *
   * Shown here because this is the screen somebody is looking at when they go
   * to place the ticket in ePass. Access constraints carry the OFFICE wording
   * and an amber row -- "Gate access needed, Wilson to collect the code by
   * phone" is an instruction, and a technician turned away at a gate is the
   * failure this panel exists to prevent.
   *
   * No entry codes are stored, by design: the customer records that a code
   * exists and Wilson collects it by phone.
   */
  function schedulingPanel(household) {
    if (!window.WILSON_SCHEDULING) return "";
    const pref = household.schedulingPreference || null;
    const lines = window.WILSON_SCHEDULING.lines(pref);
    if (!lines.length) {
      return `<div class="callout info"><strong>Scheduling</strong>
        <span class="sched-office-empty">No timing preference or access constraint on file.
        Worth asking on the next call &mdash; it is what stops a wasted trip.</span></div>`;
    }
    return `<div class="callout info"><strong>Scheduling &amp; access</strong>
      <div class="sched-office">${lines.map(function (line) {
        /* Dates are formatted here, not in the resolver: an ISO range is data,
           "Jan 24, 2027 to Feb 14, 2027" is a thing a person reads. */
        const shown = line.kind === "blackout"
          ? ui.shortDate(line.from) + (line.to ? " to " + ui.shortDate(line.to) : "")
          : line.value;
        return `<div class="sched-office-row${line.attention ? " attention" : ""}">` +
               `<b>${ui.escapeHtml(line.label)}</b>` +
               `<span>${ui.escapeHtml(shown)}</span>` +
               `${line.detail ? `<small>${ui.escapeHtml(line.detail)}</small>` : ""}</div>`;
      }).join("")}</div></div>`;
  }

  /*
   * A SCORE THAT DOES NOT EXIST IS NOT A ZERO.                  (v0.9.37)
   *
   * The fourth and fifth call sites of `Number(report.score || 0)`. On this
   * page an unmeasurable system rendered as a red "0% F" badge, sorted itself
   * to the top of the health table as the household's worst appliance, and --
   * worst of the three -- reported a fabricated decline, because the previous
   * visit's real score minus an invented nought is a large negative number.
   * The appliance report has handled this correctly since v0.9.24.
   */
  function scoreOf(report) {
    const value = report && report.score;
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return isFinite(n) ? n : null;
  }
  /* Unscored sorts LAST. It is not the worst appliance in the house; it is the
     one we could not measure, and putting it at the top of a worst-first list
     says the opposite. */
  function sortScore(report) {
    const n = scoreOf(report);
    return n === null ? Infinity : n;
  }

  function bundle() { return WilsonStore.getHouseholdBundle(householdId); }

  /*
   * Install year on the appliance row, in place of "Standard appliance" -- which
   * said nothing the type column had not already said.
   *
   * Age is a quarter of every health score, so an appliance with no documented
   * install date is a gap in the data that produces every number on its report.
   * Putting it on the row is how the office notices it; the callout above the
   * table is how they act on it.
   */
  function installLine(asset) {
    const info = window.WILSON_AGE.resolve(asset, null, null);
    if (info.installYear && info.documented) return "installed " + info.installYear;
    if (info.installYear) return "installed " + info.installYear + " (unverified)";
    return '<span class="needs-date">install date unknown</span>';
  }

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

    /*
     * The launch decision is the STORE's (applianceVisitLaunch), not this
     * page's — Cayden: repeated clicks were launching "a new appliance visit
     * at any time". Resume goes back into the ongoing visit; launch requires
     * the interval billed and its service order created; blocked says which
     * office step is missing rather than just greying out.
     */
    const launch = WilsonStore.applianceVisitLaunch(household.id);
    const applianceLaunch = document.getElementById("launch-appliance-tech");
    if (launch.mode === "launch" || launch.mode === "resume") {
      applianceLaunch.href = `tech-maintenance.html?household=${encodeURIComponent(household.id)}&visit=${encodeURIComponent(launch.visit.id)}`;
      applianceLaunch.classList.remove("disabled-link");
      applianceLaunch.removeAttribute("aria-disabled");
      applianceLaunch.textContent = launch.mode === "resume"
        ? `Resume appliance visit (${launch.progress.completed} of ${launch.progress.total} done)`
        : "Launch appliance visit";
    } else {
      applianceLaunch.href = "#";
      applianceLaunch.classList.add("disabled-link");
      applianceLaunch.setAttribute("aria-disabled", "true");
      applianceLaunch.textContent = launch.mode === "blocked" ? "Visit not ready to launch" : "No open appliance visit";
    }
    const launchNote = launch.mode === "blocked" || launch.mode === "resume"
      ? `<span class="table-sub">${ui.escapeHtml(launch.reason)}</span>` : "";
    document.getElementById("appliance-visit-context").innerHTML = nextApplianceVisit ? `<span class="badge ${ui.daysFromNow(nextApplianceVisit.dueDate)<=14?"warning":"info"}">${ui.escapeHtml(nextApplianceVisit.status)}</span><strong>${ui.escapeHtml(nextApplianceVisit.season)}</strong><span>${ui.shortDate(nextApplianceVisit.dueDate)} · ${ui.escapeHtml(nextApplianceVisit.assetScope||"Enrolled appliances")}</span>${launchNote}` : `<span class="badge">No open interval</span><span>There is no appliance field visit waiting for this household.</span>`;
    document.getElementById("hvac-visit-context").innerHTML = nextHvacVisit ? `<span class="badge info">${ui.escapeHtml(nextHvacVisit.status)}</span><strong>${ui.escapeHtml(nextHvacVisit.season)}</strong><span>${ui.shortDate(nextHvacVisit.dueDate)} · ${ui.escapeHtml(nextHvacVisit.assetScope||"HVAC systems")}</span>` : `<span class="badge">No open interval</span><span>No HVAC maintenance interval is currently open.</span>`;

    document.getElementById("household-summary").innerHTML = `<div class="detail-tile"><div class="label">Plans</div><div class="value">${ui.escapeHtml(planNames)}</div></div><div class="detail-tile"><div class="label">Tracked equipment</div><div class="value">${data.assets.length}</div></div><div class="detail-tile"><div class="label">Next due</div><div class="value">${nextVisit ? ui.shortDate(nextVisit.dueDate) : "-"}</div></div><div class="detail-tile"><div class="label">Billing</div><div class="value">Card on file</div><div class="table-sub">${ui.escapeHtml(payment ? payment.status : "Not connected")}</div></div>`;

    /* v0.9.42: an appliance removed from the plan by a field amendment keeps
       its record (history, old reports) but leaves the active equipment list. */
    let applianceAssets = data.assets.filter((asset) => asset.group !== "hvac" && asset.status !== "Removed");
    const hvacAssets = data.assets.filter((asset) => asset.group === "hvac" && asset.status !== "Removed");

    /* A 17-appliance estate is a long table, and the office almost always came
       here for one appliance. Anything trending down sorts to the top so it is
       not found by scrolling. */
    const declineFor = function (asset) {
      return window.WILSON_TRENDS ? window.WILSON_TRENDS.forAsset(data, asset.id) : null;
    };
    applianceAssets = applianceAssets.slice().sort(function (a, b) {
      const da = declineFor(a), db = declineFor(b);
      return (db ? db.severity : 0) - (da ? da.severity : 0);
    });

    /*
     * Undated appliances, called out once rather than left for someone to spot
     * by reading a seventeen-row table.
     *
     * This is the cold-start problem stated plainly: Wilson sold most of this
     * equipment, so most of these dates exist on an invoice somebody can pull.
     * Every one that gets filled in makes a quarter of that appliance's health
     * score evidence instead of estimate.
     */
    const label = function (a) { return [a.brand, a.model].filter(Boolean).join(" ") || a.typeLabel; };
    /* Three different states, and they are not interchangeable: a date off an
       invoice, a date somebody remembered, and no date at all. Only the last
       one drops the age term out of the score, so the callout has to separate
       them rather than lumping everything undocumented together. */
    const noDate = applianceAssets.filter(function (a) {
      /* An appliance whose age a technician has already said cannot be
         established is NOT a missing-document problem. Wilson did not sell it,
         there is no invoice to import, and advising one is advice that cannot be
         taken -- so it is counted separately below instead of being listed
         under "import the invoice" forever. */
      if (a.ageUnknownAck) return false;
      return window.WILSON_AGE.resolve(a, null, null).age === null;
    });
    const ageUnestablishable = applianceAssets.filter(function (a) {
      return Boolean(a.ageUnknownAck) && window.WILSON_AGE.resolve(a, null, null).age === null;
    });
    /* Ages a technician pinned down in the field. Worth naming, because the
       previous build discarded these on save and asked again next visit. */
    const fieldEstablished = applianceAssets.filter(function (a) { return Boolean(a.ageEstablishedBy); });
    const unverified = applianceAssets.filter(function (a) {
      const info = window.WILSON_AGE.resolve(a, null, null);
      return info.age !== null && !info.documented;
    });
    const dateGapHost = document.getElementById("appliance-date-gap");
    if (dateGapHost) {
      const parts = [];
      if (noDate.length) {
        parts.push(`<div class="callout warning"><strong>${noDate.length} appliance${noDate.length === 1 ? " has no" : "s have no"} install date on record</strong>Age is 25% of every health score, so ${noDate.length === 1 ? "this appliance is" : "these are"} scored on measured condition alone and the report says so: ${ui.escapeHtml(noDate.map(label).join(", "))}. Importing the Wilson sales invoice fills the date in automatically.</div>`);
      }
      if (unverified.length) {
        parts.push(`<div class="callout info"><strong>${unverified.length} install date${unverified.length === 1 ? " is" : "s are"} unverified</strong>Recorded from what the customer stated or what a technician established in the field rather than from a document, and labelled that way on the report: ${ui.escapeHtml(unverified.map(label).join(", "))}.</div>`);
      }
      if (ageUnestablishable.length) {
        parts.push(`<div class="callout"><strong>${ageUnestablishable.length} appliance${ageUnestablishable.length === 1 ? "'s age cannot" : "s' ages cannot"} be established</strong>A technician has already looked. ${ageUnestablishable.length === 1 ? "It is" : "They are"} scored on measured condition alone and the report says so &mdash; there is no Wilson invoice to import, because ${ageUnestablishable.length === 1 ? "this is not equipment" : "these are not equipment"} Wilson sold: ${ui.escapeHtml(ageUnestablishable.map(label).join(", "))}.</div>`);
      }
      if (fieldEstablished.length) {
        parts.push(`<div class="callout"><strong>${fieldEstablished.length} install date${fieldEstablished.length === 1 ? "" : "s"} established in the field</strong>Recorded by the technician at the visit and kept on the appliance, so the next visit starts with it already filled in: ${ui.escapeHtml(fieldEstablished.map(label).join(", "))}.</div>`);
      }
      if (!parts.length) {
        parts.push(`<div class="callout"><strong>Every appliance has a documented install date</strong>Age is sourced from the Wilson invoice for all ${applianceAssets.length} appliances, so the lifecycle quarter of each health score rests on a document rather than an estimate.</div>`);
      }
      /*
       * THE WAY IN TO THE EQUIPMENT SCREEN.                     (v0.9.37)
       *
       * equipment.html was reachable from exactly one place -- the "Add
       * details" button on the work-queue card -- and that card only exists
       * within `equipmentLeadDays` (45) of a scheduled visit. So the office
       * could not key equipment for a household whose first visit was three
       * months out, and could not go back and correct anything once the queue
       * item cleared. The newest part of the tool was the least reachable part
       * of it.
       *
       * This row is always here, on the page the office actually opens, and it
       * states the gap rather than only offering a button.
       */
      const gaps = WilsonStore.equipmentGaps ? WilsonStore.equipmentGaps(household.id) : null;
      if (gaps && gaps.total) {
        parts.push(`<div class="callout ${gaps.missing ? "warning" : ""} equipment-gap-callout">
          <strong>${gaps.missing
            ? `${gaps.missing} of ${gaps.total} appliance${gaps.total === 1 ? "" : "s"} still ${gaps.missing === 1 ? "needs" : "need"} brand and model`
            : `All ${gaps.total} appliance${gaps.total === 1 ? " has" : "s have"} brand and model on record`}</strong>
          ${gaps.missing
            ? "A technician arriving without them has to identify the machine on site before the protocol can resolve. Invoice import fills most of them in one pass."
            : "Details can still be corrected here, or on the appliance itself during a visit."}
          <a class="button small${gaps.missing ? "" : " ghost"}" href="equipment.html?id=${encodeURIComponent(household.id)}">${gaps.missing ? "Add equipment details" : "Review equipment details"}</a>
        </div>`);
      }

      dateGapHost.innerHTML = parts.join("");
    }

    document.getElementById("appliance-asset-table-body").innerHTML = applianceAssets.map(function (asset) {
      let frequency = asset.group === "imuc" ? `${Number(asset.imucVisitsPerYear || 1)} / year` : "Plan interval";
      const filterSelection = window.WILSON_FILTERS.forAsset(asset, subscriptionPlanId);
      const filters = (asset.filterTypes || []).join(", ")
        || (filterSelection.lines.length ? "Exact refrigeration filters to verify" : "None tracked");
      const filterNote = filterSelection.lines.length
        ? `<div class="table-sub"><span class="badge success">${ui.escapeHtml(filterSelection.lines.map((line) => `${line.shortLabel} × ${line.quantity}`).join(" · "))}</span>${filterSelection.included ? '<span class="badge info">Included</span>' : `<span class="badge info">${ui.money(filterSelection.total)}/yr</span>`}</div>`
        : '';
      /* Decline is the reason someone opens this page from the queue, so it gets
         its own cell rather than living only inside the report. */
      const decline = window.WILSON_TRENDS ? window.WILSON_TRENDS.forAsset(data, asset.id) : null;
      const health = decline
        ? `<span class="badge ${decline.severity >= 3 ? "danger" : "warning"}">Trending down</span><div class="table-sub">${ui.escapeHtml(decline.signals[0].headline)}</div>`
        : (function () {
            const rs = (data.reports || []).filter((r) => r.assetId === asset.id);
            if (!rs.length) return '<span class="table-sub">No report yet</span>';
            const latest = rs.slice().sort((a, b) => String(b.inspectionDate).localeCompare(String(a.inspectionDate)))[0];
            return `${scoreOf(latest) === null ? badge("Not scored") : badge(scoreOf(latest) + "% " + (latest.grade || ""))}<div class="table-sub">${rs.length} visit${rs.length === 1 ? "" : "s"} on record</div>`;
          })();
      return `<tr${decline ? ' class="row-attention"' : ""}><td><div class="table-title">${ui.escapeHtml(asset.typeLabel)}</div><div class="table-sub">${ui.escapeHtml([asset.brand, asset.model].filter(Boolean).join(" ") || "Brand / model to verify")} · ${installLine(asset)}</div></td><td>${ui.escapeHtml(asset.location || "Location not entered")}</td><td>${badge(frequency)}</td><td><div class="table-sub">${ui.escapeHtml(filters)}</div>${filterNote}</td><td>${health}</td></tr>`;
    }).join("") || `<tr><td colspan="5"><div class="empty-state">No appliance equipment enrolled.</div></td></tr>`;

    document.getElementById("hvac-asset-table-body").innerHTML = hvacAssets.map(function (asset) {
      const filters = (asset.filterTypes || []).join(", ") || "Filter details to verify";
      return `<tr><td><div class="table-title">${ui.escapeHtml(asset.typeLabel)}</div><div class="table-sub">${ui.escapeHtml([asset.brand, asset.model].filter(Boolean).join(" ") || "Brand / model to verify")} · HVAC system</div></td><td>${ui.escapeHtml(asset.location || "Location not entered")}</td><td>${badge("2 / year")}</td><td><div class="table-sub">${ui.escapeHtml(filters)}</div></td><td>${badge(asset.status || "Active")}</td></tr>`;
    }).join("") || `<tr><td colspan="5"><div class="empty-state">No HVAC equipment enrolled.</div></td></tr>`;

    document.getElementById("hvac-maintenance-section").classList.toggle("hidden", !hvacAssets.length && !data.subscriptions.some((sub) => sub.category === "hvac"));

    document.getElementById("visit-table-body").innerHTML = data.visits.slice().sort((a, b) => b.dueDate.localeCompare(a.dueDate)).map(function (visit) {
      const subscription = data.subscriptions.find((item) => item.id === visit.subscriptionId);
      const amount = Number(visit.amountToCharge || 0);
      const chargeDisabled = amount <= 0 || !payment || payment.status !== "Ready";
      /* A completed stop is a record, not a task. Its row offers the compiled
         review of the whole visit rather than charge and service-order buttons
         that have nothing left to do. */
      const visitReports = data.reports.filter((report) => report.visitId === visit.id);
      const actions = visit.status === "Completed"
        ? (visitReports.length
            ? `<a class="button small" href="visit-report.html?visit=${encodeURIComponent(visit.id)}">Maintenance review</a><span class="table-sub">${visitReports.length} appliance report${visitReports.length === 1 ? "" : "s"}</span>`
            : `<span class="table-sub">Completed · no reports filed</span>`)
        : `<button class="button small secondary" data-action="charge" data-visit-id="${visit.id}" ${chargeDisabled ? "disabled" : ""}>${amount > 0 ? "Charge " + ui.money(amount) : "Included"}</button><button class="button small" data-action="service-order" data-visit-id="${visit.id}">Generate order</button>`;
      return `<tr><td><div class="table-title">${ui.shortDate(visit.status === "Completed" ? (visit.completedOn || visit.dueDate) : visit.dueDate)}</div><div class="table-sub">${ui.escapeHtml(visit.season)}</div></td><td><div class="table-title">${ui.escapeHtml(subscription ? subscription.planName : visit.category)}</div><div class="table-sub">${ui.escapeHtml(visit.assetScope || "Enrolled equipment")}</div></td><td>${badge(visit.status)}<div class="table-sub">${badge(visit.paymentStatus)} ${badge(visit.serviceOrderStatus)}</div></td><td><div class="table-title">${amount > 0 ? ui.money(amount) : "Included"}</div><div class="table-sub">${amount > 0 ? "Due at this interval" : "No added charge"}</div>${visit.amendedNote ? `<div class="table-sub visit-amended-note">${ui.escapeHtml(visit.amendedNote)}</div>` : ""}</td><td><div class="inline-actions">${actions}</div></td></tr>`;
    }).join("");

    const deliveryVisits = data.visits.filter((v) => v.reportDeliveryStatus).sort((a,b) => String(b.reportReadyAt || b.completedOn || b.dueDate).localeCompare(String(a.reportReadyAt || a.completedOn || a.dueDate)));
    const readyInspections = (state.techInspections || []).filter((inspection) => inspection.householdId === household.id && inspection.complete && !state.reports.some((report) => report.visitId === inspection.visitId && report.assetId === inspection.assetId));
    const deliveryHost = document.getElementById("report-delivery-banner");
    const deliveryCards = deliveryVisits.map((visit) => {
      const reports = data.reports.filter((report) => report.visitId === visit.id);
      const ready = String(visit.reportDeliveryStatus || "").toLowerCase().includes("ready");
      return `<div class="report-delivery-strip ${ready ? "ready" : ""}"><div><strong>${ui.escapeHtml(visit.reportDeliveryStatus)}</strong><span>${reports.length} field report${reports.length === 1 ? "" : "s"} · ${ui.escapeHtml(visit.season || "Maintenance visit")} · ${ui.escapeHtml(household.email || "No email on file")}</span></div><div class="inline-actions">${reports.length === 1 ? `<a class="button small ghost" href="report-view.html?id=${reports[0].id}">Review report</a>` : reports.length ? `<a class="button small ghost" href="visit-report.html?visit=${encodeURIComponent(visit.id)}">Review whole visit</a>` : ""}${ready ? `<button class="button small" type="button" data-action="email-reports" data-visit-id="${visit.id}">Email to client</button>` : ""}</div></div>`;
    }).join("");
    const recoveryCards = readyInspections.map((inspection) => { const asset=data.assets.find((item)=>item.id===inspection.assetId); return `<div class="report-delivery-strip warning"><div><strong>Field data complete — report not generated</strong><span>${ui.escapeHtml(asset ? [asset.brand,asset.model,asset.typeLabel].filter(Boolean).join(" ") : "Appliance")} · only completed technician data can create this report.</span></div><button class="button small secondary" type="button" data-action="generate-field-report" data-visit-id="${inspection.visitId}" data-asset-id="${inspection.assetId}">Generate health report</button></div>`; }).join("");
    deliveryHost.innerHTML = deliveryCards + recoveryCards;

    /*
     * One row per appliance, showing its most recent report.
     *
     * Listing every report ever filed turns this into sixty-four rows on a
     * sixteen-appliance estate with four years of history -- the same "too much
     * at once" problem the ops dashboard had. The prior visits are not lost:
     * the trend column compares against them, each report page plots the full
     * curve, and the completed visits above open the compiled review.
     */
    const latestPerAsset = Object.values(
      data.reports.reduce(function (acc, report) {
        const key = report.assetId || report.id;
        if (!acc[key] || String(report.inspectionDate) > String(acc[key].inspectionDate)) acc[key] = report;
        return acc;
      }, {})
    ).sort(function (a, b) { return sortScore(a) - sortScore(b); });

    document.getElementById("report-history-body").innerHTML = latestPerAsset.map(function (report) {
      const priors = (data.reports || [])
        .filter((r) => r.assetId === report.assetId && String(r.inspectionDate) < String(report.inspectionDate))
        .sort((a, b) => String(b.inspectionDate).localeCompare(String(a.inspectionDate)));
      const prior = priors[0];
      /* A move between two scores needs TWO scores. `Number(x || 0)` invented
         one for an unscored visit and reported the difference as a decline. */
      const now = scoreOf(report), was = prior ? scoreOf(prior) : null;
      const move = now !== null && was !== null ? now - was : null;
      const trend = !prior
        ? '<span class="table-sub">First visit</span>'
        : move === null
          ? `<span class="table-sub">No comparison &mdash; ${now === null ? "this visit" : "the previous visit"} was not scored</span>`
          : `<span class="trend-move ${move < 0 ? "down" : move > 0 ? "up" : "flat"}">${move > 0 ? "+" : ""}${move || "no change"}</span><div class="table-sub">vs ${ui.shortDate(prior.inspectionDate)}</div>`;
      return `<tr><td><div class="table-title">${ui.escapeHtml(report.applianceLabel)}</div><div class="table-sub">${ui.shortDate(report.inspectionDate)} · ${ui.escapeHtml(report.technician)}</div></td><td>${now === null ? badge("Not scored") : badge(now + "% " + (report.grade || ""))}<div class="table-sub">${ui.escapeHtml(now === null ? (report.scoreUnavailableReason || "Not enough could be measured to publish a score") : (report.condition || ""))}</div></td><td>${trend}</td><td><a class="button small ghost" href="report-view.html?id=${report.id}">View</a></td></tr>`;
    }).join("") || `<tr><td colspan="4"><div class="empty-state">No appliance health reports stored yet.</div></td></tr>`;

    document.getElementById("plan-payment-card").innerHTML = `<div class="section-heading"><div><h2>Contact, plans, and payment</h2><p>${ui.escapeHtml(household.preferredContact)} preferred</p></div></div><div class="summary-lines"><div class="summary-line"><span>Contact</span><strong>${ui.escapeHtml(household.firstName + " " + household.lastName)}</strong></div><div class="summary-line"><span>Phone</span><strong>${ui.escapeHtml(household.phone)}</strong></div><div class="summary-line"><span>Email</span><strong>${ui.escapeHtml(household.email)}</strong></div><div class="summary-line"><span>Payment method</span><strong>${payment && payment.last4 ? `${payment.brand} •••• ${payment.last4}` : "Not connected"}</strong></div><div class="summary-line"><span>Filters due ≤ 30 days</span><strong>${dueFilters}</strong></div></div><div class="subscription-cards">${data.subscriptions.map((subscription) => `<div class="subscription-mini-card"><div><strong>${ui.escapeHtml(subscription.planName)}</strong>${badge(subscription.status)}</div><span>${ui.money(subscription.annualAmount)} / year</span><small>${subscription.autoRenew ? "Auto-renews until canceled" : "Manual renewal"} · ${ui.escapeHtml(subscription.chargeTiming || "Charge at scheduled maintenance")}${subscription.filterManagement ? " · Filter management" : ""}</small></div>`).join("")}</div>${applianceSubscription ? `<a class="button wide secondary amend-plan-button" href="appliance-signup.html?amend=${encodeURIComponent(household.id)}">＋ Add appliances to this plan</a><p class="table-sub amend-plan-hint">Opens the builder pre-filled with this plan. Add appliances, the price updates from the same engine, and the customer approves the difference on the spot — the office then bills the card for it.</p>` : ""}${payment && payment.status === "Ready" ? `<div class="callout"><strong>Payment ready</strong>The production server can create the Stripe PaymentIntent when the selected maintenance interval is ready to schedule.</div>` : `<div class="callout warning"><strong>Payment follow-up needed</strong>Connect a payment method before charging the scheduled maintenance interval.</div><button class="button wide secondary" id="connect-household-payment" type="button">Connect demo payment</button>`}${schedulingPanel(household)}${household.notes ? `<div class="callout info"><strong>Household notes</strong>${ui.escapeHtml(household.notes)}</div>` : ""}`;

    if (payment && payment.status !== "Ready") {
      const connect = document.getElementById("connect-household-payment");
      if (connect) connect.addEventListener("click", function () { WilsonStore.connectPayment(household.id); ui.toast("Payment connected", "Prototype payment profile is now ready."); render(); });
    }

    /* v0.9.20: the AR / account billing choice is gone -- card on file only, on
       Cayden's call ("lets remove the ar account option for now and go with only
       card on file"). The store still carries billingType so an existing record
       is not rewritten, and setHouseholdBilling still exists; nothing in the UI
       can select anything but a card.

       v0.9.37: the two element lookups that used to sit here went with it. They
       resolved to null on every render -- the elements were removed from
       household.html at the same time as the control -- and read as if a
       billing control were still being wired up. */


    if (applianceLaunch) applianceLaunch.addEventListener("click", function(event){
      if (applianceLaunch.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
        /* Say WHY, at the moment of the click — the guardrail is a
           sequencing rule, not a dead button. */
        const decision = WilsonStore.applianceVisitLaunch(householdId);
        if (decision && decision.mode === "blocked") ui.toast("Visit not ready to launch", decision.reason);
      }
    });

    document.getElementById("household-filter-list").innerHTML = data.filters.map(function (filter) {
      const asset = data.assets.find((item) => item.id === filter.assetId);
      /* Verified means someone confirmed the part number against the actual
         unit; an unverified row wears the badge so nobody orders material or
         prices coverage off a registration guess. */
      const verifyBadge = filter.verified
        ? `<span class="badge success">Verified${filter.verifiedOn ? " " + ui.shortDate(filter.verifiedOn) : ""}</span>`
        : `<span class="badge warning">Part to verify</span>`;
      return `<div class="activity-item"><div class="activity-icon">F</div><div><p><strong>${ui.escapeHtml(filter.filterType)}</strong> ${verifyBadge}<br>${asset ? ui.escapeHtml(asset.typeLabel + " · " + asset.location) : "Household equipment"}</p><time>${ui.shortDate(filter.nextDueOn)} · ${ui.escapeHtml(filter.status)} · ${ui.escapeHtml(filter.partNumber)} · ${ui.escapeHtml(filter.planCoverage || "Track only")}</time></div></div>`;
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

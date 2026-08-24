(function () {
  const ui = window.WilsonUI;
  const state = WilsonStore.load();
  const params = new URLSearchParams(window.location.search);
  const report = WilsonStore.getReport(params.get("id")) || state.reports[0];

  function statusClass(value) {
    const lower = String(value || "").toLowerCase();
    if (lower.includes("out") || lower.includes("action") || lower.includes("poor")) return "danger";
    if (lower.includes("monitor") || lower.includes("watch")) return "warning";
    if (lower.includes("in range") || lower.includes("pass") || lower.includes("good") || lower.includes("excellent")) return "success";
    return "info";
  }

  function badge(value) {
    return `<span class="badge ${statusClass(value)}">${ui.escapeHtml(value || "-")}</span>`;
  }

  function reportPage(title, kicker, body, pageClass) {
    return `
      <section class="report-page ${pageClass || ""}">
        <header class="report-page-header">
          <div class="report-mini-logo"><img src="assets/logo-black.png" alt="Wilson AC & Appliance"></div>
          <div><span>${ui.escapeHtml(kicker || "Appliance Health Report")}</span><h2>${ui.escapeHtml(title)}</h2></div>
        </header>
        <div class="report-page-body">${body}</div>
        <footer class="report-page-footer"><span>Wilson AC & Appliance · Appliance Health Report</span><span>${ui.escapeHtml(report ? report.reference || report.id : "")}</span></footer>
      </section>
    `;
  }

  function groupedCheckpoints() {
    const groups = {};
    (report.checkpoints || []).forEach(function (item) {
      const category = item.category || "General";
      if (!groups[category]) groups[category] = [];
      groups[category].push(item);
    });
    return groups;
  }

  function scoreLosses() {
    if (report.categoryLosses && report.categoryLosses.length) return report.categoryLosses;
    const checkpoints = (report.checkpoints || []).filter((item) => item.status !== "N/A" && Number(item.rating));
    if (!checkpoints.length) return [];
    const maxPer = 100 / checkpoints.length;
    const map = {};
    checkpoints.forEach(function (item) {
      const category = item.category || "General";
      if (!map[category]) map[category] = 0;
      map[category] += maxPer * (1 - Number(item.rating) / 5);
    });
    return Object.keys(map).map((category) => ({ category, loss: Math.round(map[category] * 10) / 10, explanation: "Checkpoint ratings in this category." })).filter((item) => item.loss > 0).sort((a, b) => b.loss - a.loss);
  }

  function conditionStatement() {
    const actionCount = (report.checkpoints || []).filter((item) => item.status === "Action").length;
    const watchCount = (report.checkpoints || []).filter((item) => item.status === "Watch").length;
    if (actionCount) return `${actionCount} checkpoint${actionCount === 1 ? " requires" : "s require"} corrective action.`;
    if (watchCount) return `${watchCount} checkpoint${watchCount === 1 ? " should" : "s should"} be monitored.`;
    return "No immediate corrective action was identified from the recorded checkpoints.";
  }

  function render() {
    const host = document.getElementById("report-sheet");
    if (!report) {
      host.innerHTML = `<div class="empty-state">No field-generated report was found. Complete the technician maintenance protocol before a customer health report can be created.</div>`;
      return;
    }

    const household = state.households.find((item) => item.id === report.householdId);
    const asset = state.assets.find((item) => item.id === report.assetId);
    const groups = groupedCheckpoints();
    const losses = scoreLosses();
    const measured = report.measurements || [];
    const grade = report.grade || "–";

    const address = household ? [household.address1, household.address2, household.city, household.state, household.zip].filter(Boolean).join(", ") : "";

    const cover = `
      <section class="report-page report-cover-page">
        <div class="report-cover-shape"></div>
        <div class="report-cover-brand"><img src="assets/logo-black.png" alt="Wilson AC & Appliance"></div>
        <div class="report-cover-title"><span>Wilson Estate Care</span><h1>Appliance Health Report</h1><p>${ui.escapeHtml(report.applianceLabel)}</p></div>
        <div class="report-cover-score"><span>Your appliance score</span><strong>${Number(report.score || 0)}%</strong><em>${ui.escapeHtml(grade)} · ${ui.escapeHtml(report.condition || "Not graded")}</em></div>
        <div class="report-cover-details">
          <div><span>Household</span><strong>${ui.escapeHtml(household ? household.name : "Household")}</strong></div>
          <div><span>Service address</span><strong>${ui.escapeHtml(address || "Not recorded")}</strong></div>
          <div><span>Date of service</span><strong>${ui.shortDate(report.inspectionDate)}</strong></div>
          <div><span>Technician</span><strong>${ui.escapeHtml(report.technician || "Not recorded")}</strong></div>
        </div>
        <footer class="report-cover-footer">Wilson AC & Appliance · Trusted since 1949</footer>
      </section>
    `;

    const vitalsBody = `
      <div class="report-intro-grid">
        <div><h3>What are appliance vitals?</h3><p>Vitals are the useful readings and functional observations recorded during this maintenance visit. They help show whether the appliance was operating within the target used by the technician and identify areas that should be monitored or corrected.</p></div>
        <div class="report-score-panel"><span>Your appliance score</span><strong>${Number(report.score || 0)}% ${ui.escapeHtml(grade)}</strong><small>${ui.escapeHtml(report.condition || "Not graded")}</small></div>
      </div>
      <div class="vitals-grid">
        ${measured.length ? measured.map(function (item) {
          return `<article class="vital-card ${statusClass(item.result)}"><div class="vital-card-top"><strong>${ui.escapeHtml(item.label)}</strong>${badge(item.result)}</div><div class="vital-value">${ui.escapeHtml(item.observed || "Not recorded")} ${ui.escapeHtml(item.unit || "")}</div><div class="vital-target"><span>Target / normal</span><strong>${ui.escapeHtml(item.target || "Technician-defined")}</strong></div>${item.notes ? `<p>${ui.escapeHtml(item.notes)}</p>` : ""}</article>`;
        }).join("") : `<div class="report-empty">No measurements were recorded.</div>`}
      </div>
      <div class="report-diagnostic-strip"><strong>Visit overview</strong><span>${ui.escapeHtml(conditionStatement())}</span></div>
    `;

    const breakdownBody = `
      <div class="report-score-explanation"><h3>How this score was calculated</h3><p>${report.lifecycle ? `This score blends current-condition health checks (${Math.round((window.WILSON_CONFIG.reportScoring.vitalWeight||.75)*100)}%) with appliance lifecycle age (${Math.round((window.WILSON_CONFIG.reportScoring.ageWeight||.25)*100)}%). This ${ui.escapeHtml((window.WILSON_CONFIG.lifecycleTiers[report.lifecycle.tier]||{}).label || report.lifecycle.tier || "product")} tier uses a draft expected service life of ${Number(report.lifecycle.expectedYears || 0)} years. Age affects the score, but a well-running older appliance can still score well.` : "Applicable health checkpoints are converted to a 100-point condition score. Lifecycle weighting will be added when age and product-tier information are available."}</p></div>
      <div class="loss-list">
        ${losses.length ? losses.map((item) => `<div class="loss-row"><div><strong>${ui.escapeHtml(item.category)}</strong><p>${ui.escapeHtml(item.explanation || "Recorded checkpoint deduction.")}</p></div><span>-${Number(item.loss || 0).toFixed(Number(item.loss || 0) % 1 ? 1 : 0)}</span></div>`).join("") : `<div class="loss-row no-loss"><div><strong>No point deductions</strong><p>All applicable checkpoints received full points.</p></div><span>0</span></div>`}
      </div>
      <div class="final-score-band"><div><strong>Your appliance score</strong><p>${ui.escapeHtml(report.summary || "")}</p></div><span>${Number(report.score || 0)}% ${ui.escapeHtml(grade)}</span></div>
    `;

    const detailsBody = `
      <div class="report-detail-columns">
        <section><h3>Equipment information</h3><dl class="report-definition-list">
          <div><dt>Appliance type</dt><dd>${ui.escapeHtml(asset ? asset.typeLabel : report.applianceLabel)}</dd></div>
          <div><dt>Brand</dt><dd>${ui.escapeHtml(asset && asset.brand ? asset.brand : "Not recorded")}</dd></div>
          <div><dt>Model</dt><dd>${ui.escapeHtml(asset && asset.model ? asset.model : "Not recorded")}</dd></div>
          <div><dt>Serial</dt><dd>${ui.escapeHtml(asset && asset.serial ? asset.serial : "Not recorded")}</dd></div>
          <div><dt>Location</dt><dd>${ui.escapeHtml(asset && asset.location ? asset.location : "Not recorded")}</dd></div>
          <div><dt>Next maintenance</dt><dd>${ui.shortDate(report.nextDueOn)}</dd></div>${report.lifecycle ? `<div><dt>Approx. age</dt><dd>${Number(report.lifecycle.age||0)} years</dd></div><div><dt>Lifecycle tier</dt><dd>${ui.escapeHtml((window.WILSON_CONFIG.lifecycleTiers[report.lifecycle.tier]||{}).label || report.lifecycle.tier || "Not set")} · ${Number(report.lifecycle.expectedYears||0)} yr expected life</dd></div><div><dt>Lifecycle stage</dt><dd>${ui.escapeHtml(report.lifecycle.stage||"Not set")}</dd></div>` : ""}
        </dl></section>
        <section><h3>Visit information</h3><dl class="report-definition-list">
          <div><dt>Household</dt><dd>${ui.escapeHtml(household ? household.name : "Not recorded")}</dd></div>
          <div><dt>Technician</dt><dd>${ui.escapeHtml(report.technician || "Not recorded")}</dd></div>
          <div><dt>Service date</dt><dd>${ui.shortDate(report.inspectionDate)}</dd></div>
          <div><dt>Service reference</dt><dd>${ui.escapeHtml(report.reference || "Not linked")}</dd></div>
          <div><dt>Report score</dt><dd>${Number(report.score || 0)}% ${ui.escapeHtml(grade)}</dd></div>
          <div><dt>Report status</dt><dd>Final</dd></div>
        </dl></section>
      </div>
      <h3 class="report-subheading">Subsystem review</h3>
      <div class="subsystem-groups">
        ${Object.keys(groups).map(function (category) {
          const items = groups[category];
          const worst = items.some((item) => item.status === "Action") ? "Action" : items.some((item) => item.status === "Watch") ? "Watch" : "Pass";
          return `<section class="subsystem-group"><div class="subsystem-heading"><strong>${ui.escapeHtml(category)}</strong>${badge(worst)}</div>${items.map((item) => `<div class="subsystem-item"><div><strong>${ui.escapeHtml(item.name)}</strong><p>${ui.escapeHtml(item.notes || "No additional note.")}</p></div><span>${badge(item.status)} <em>${Number(item.rating || 0)}/5</em></span></div>`).join("")}</section>`;
        }).join("")}
      </div>
    `;

    const corrective = report.correctiveMeasures || [];
    const correctiveBody = `
      <div class="report-detail-columns corrective-columns">
        <section><h3>Corrective measures</h3>${corrective.length ? `<ul class="corrective-list">${corrective.map((item) => `<li>${ui.escapeHtml(item)}</li>`).join("")}</ul>` : `<div class="report-ok-box">No corrective measures recorded.</div>`}</section>
        <section><h3>Recommendations</h3><div class="report-note-box ${report.recommendations ? "warning" : ""}">${ui.escapeHtml(report.recommendations || "No corrective action recommended at this time.")}</div></section>
      </div>
      <h3 class="report-subheading">Maintenance performed</h3>
      <div class="report-task-grid">${(report.tasks || []).map((task) => `<div><span>✓</span>${ui.escapeHtml(task)}</div>`).join("") || `<div><span>–</span>Inspection only; no maintenance task was recorded.</div>`}</div>
      <h3 class="report-subheading">Filters and consumables</h3>
      <div class="report-info-cards">
        <div><span>Part / size</span><strong>${ui.escapeHtml(report.filterPart || "Not applicable")}</strong></div>
        <div><span>Action</span><strong>${ui.escapeHtml(report.filterAction || "Not applicable")}</strong></div>
        <div><span>Photos recorded</span><strong>${Number(report.photoCount || 0)}</strong></div>
      </div>
    `;

    const informationBody = `
      <div class="report-information-copy">
        <section><h3>Appliance Health Score</h3><p>The Wilson Appliance Health Score summarizes the applicable inspection checkpoints entered by the technician. It is intended to make the condition of the appliance easier to understand and to show where deductions occurred. When age and product tier are available, lifecycle age is blended into the score as a planning signal. It is not a guarantee or prediction of the exact remaining life of the appliance.</p></section>
        <section><h3>Operating vitals</h3><p>Recorded temperatures, cycle observations, sealing checks, airflow conditions, water flow, drain performance, and other readings vary by appliance type. Targets shown in this report are entered by the technician for the specific equipment and test performed.</p></section>
        <section><h3>Subsystem review</h3><p>Subsystem categories group related components and functions, such as temperature performance, water systems, filtration, controls, airflow, drainage, connections, and safety. “Pass” means no action was identified from the recorded inspection. “Watch” identifies an item to monitor. “Action” identifies an item that should be corrected or evaluated through a separate repair order.</p></section>
        <section><h3>Scope and limitations</h3><p>This report records visible conditions, accessible components, readings, and functional observations made during the maintenance visit. It is not a guarantee against future failure, and it does not replace manufacturer instructions, a repair diagnosis, code inspection, or destructive disassembly.</p></section>
      </div>
    `;

    const summaryBody = `
      <div class="service-summary-box"><span>Service summary</span><p>${ui.escapeHtml(report.serviceSummary || report.summary || "No service summary was entered.")}</p></div>
      <div class="report-detail-columns service-final-grid">
        <section><h3>Technician condition summary</h3><p>${ui.escapeHtml(report.summary || "No summary entered.")}</p></section>
        <section><h3>Next planned interval</h3><p>${ui.shortDate(report.nextDueOn)}</p><p class="muted-copy">The office will use the maintenance dashboard to prompt scheduling and payment review at the appropriate interval.</p></section>
      </div>
      <div class="photo-placeholder"><strong>Photo record</strong><span>${Number(report.photoCount || 0)} photo${Number(report.photoCount || 0) === 1 ? "" : "s"} associated with this report in the production workflow.</span></div>
      <div class="signature-grid"><div><span>Technician</span><strong>${ui.escapeHtml(report.technician || "")}</strong></div><div><span>Date</span><strong>${ui.shortDate(report.inspectionDate)}</strong></div><div><span>Report reference</span><strong>${ui.escapeHtml(report.reference || report.id)}</strong></div></div>
    `;

    host.innerHTML = cover
      + reportPage("Appliance Vitals", report.applianceLabel, vitalsBody, "vitals-page")
      + reportPage("Score Breakdown", report.applianceLabel, breakdownBody, "breakdown-page")
      + reportPage("Inspection Details", report.applianceLabel, detailsBody, "details-page")
      + reportPage("Corrective Measures", report.applianceLabel, correctiveBody, "corrective-page")
      + reportPage("Report Information", report.applianceLabel, informationBody, "information-page")
      + reportPage("Service Summary", report.applianceLabel, summaryBody, "summary-page");
  }

  document.getElementById("print-report").addEventListener("click", () => window.print());
  document.addEventListener("DOMContentLoaded", render);
})();

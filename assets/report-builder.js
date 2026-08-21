(function () {
  const ui = window.WilsonUI;
  const config = window.WILSON_CONFIG;
  const state = WilsonStore.load();
  const params = new URLSearchParams(window.location.search);
  let checkpoints = [];
  let measurements = [];

  const householdSelect = document.getElementById("report-household");
  const assetSelect = document.getElementById("report-asset");
  const checkpointList = document.getElementById("checkpoint-list");
  const measurementList = document.getElementById("measurement-list");

  function id(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 8);
  }

  function todayIso(offsetDays) {
    const date = new Date();
    date.setDate(date.getDate() + (offsetDays || 0));
    return date.toISOString().slice(0, 10);
  }

  function gradeForScore(score) {
    return config.reportScoring.gradeBands.find((band) => score >= band.min) || config.reportScoring.gradeBands[config.reportScoring.gradeBands.length - 1];
  }

  function householdOptions() {
    householdSelect.innerHTML = state.households.map((household) => `<option value="${household.id}">${ui.escapeHtml(household.name)}</option>`).join("");
    const requested = params.get("household");
    if (requested && state.households.some((item) => item.id === requested)) householdSelect.value = requested;
  }

  function assetLabel(asset) {
    const model = [asset.brand, asset.model].filter(Boolean).join(" ");
    return `${asset.typeLabel}${model ? " - " + model : ""}${asset.location ? " (" + asset.location + ")" : ""}`;
  }

  function loadAssets() {
    const assets = state.assets.filter((item) => item.householdId === householdSelect.value && item.group !== "hvac");
    assetSelect.innerHTML = assets.map((asset) => `<option value="${asset.id}">${ui.escapeHtml(assetLabel(asset))}</option>`).join("");
    const requestedAsset = params.get("asset");
    if (requestedAsset && assets.some((item) => item.id === requestedAsset)) assetSelect.value = requestedAsset;
    loadTemplates();
  }

  function selectedAsset() {
    return state.assets.find((item) => item.id === assetSelect.value);
  }

  function loadTemplates() {
    const asset = selectedAsset();
    const templateName = asset ? asset.checkpointSet : "generic";
    const checkpointTemplate = config.checkpointSets[templateName] || config.checkpointSets.generic;
    const measurementTemplate = config.measurementSets[templateName] || config.measurementSets.generic;

    checkpoints = checkpointTemplate.map(function (item) {
      return {
        id: id("cp"),
        category: item.category || "General",
        name: item.name || String(item),
        rating: 4,
        status: "Pass",
        notes: ""
      };
    });

    measurements = measurementTemplate.map(function (item) {
      return {
        id: id("measure"),
        label: item.label,
        observed: "",
        unit: item.unit || "",
        target: item.target || "",
        result: "Not tested",
        notes: ""
      };
    });

    renderMeasurements();
    renderCheckpoints();
    updateScore();
  }

  function resultOptions(selected) {
    return ["In range", "Monitor", "Out of range", "Not tested"].map((value) => `<option ${value === selected ? "selected" : ""}>${value}</option>`).join("");
  }

  function renderMeasurements() {
    measurementList.innerHTML = measurements.map(function (measurement) {
      return `
        <div class="measurement-row" data-measurement-id="${measurement.id}">
          <div class="field"><label>Vital / reading</label><input data-measurement-field="label" value="${ui.escapeHtml(measurement.label)}"></div>
          <div class="field"><label>Observed</label><input data-measurement-field="observed" value="${ui.escapeHtml(measurement.observed)}" placeholder="Reading or observation"></div>
          <div class="field compact"><label>Unit</label><input data-measurement-field="unit" value="${ui.escapeHtml(measurement.unit)}"></div>
          <div class="field"><label>Target / normal</label><input data-measurement-field="target" value="${ui.escapeHtml(measurement.target)}"></div>
          <div class="field"><label>Result</label><select data-measurement-field="result">${resultOptions(measurement.result)}</select></div>
          <div class="field measurement-note"><label>Note</label><div class="field-with-action"><input data-measurement-field="notes" value="${ui.escapeHtml(measurement.notes)}" placeholder="Optional context"><button class="remove-button" data-remove-measurement="${measurement.id}" type="button">Remove</button></div></div>
        </div>
      `;
    }).join("");

    measurementList.querySelectorAll("[data-measurement-id]").forEach(function (row) {
      const measurement = measurements.find((item) => item.id === row.dataset.measurementId);
      row.querySelectorAll("[data-measurement-field]").forEach(function (input) {
        input.addEventListener("input", function () {
          measurement[input.dataset.measurementField] = input.value;
        });
      });
    });

    measurementList.querySelectorAll("[data-remove-measurement]").forEach(function (button) {
      button.addEventListener("click", function () {
        measurements = measurements.filter((item) => item.id !== button.dataset.removeMeasurement);
        renderMeasurements();
      });
    });
  }

  function renderCheckpoints() {
    checkpointList.innerHTML = checkpoints.map(function (checkpoint) {
      return `
        <div class="checkpoint-row expanded" data-checkpoint-id="${checkpoint.id}">
          <div class="field checkpoint-category"><label>Category</label><input data-field="category" value="${ui.escapeHtml(checkpoint.category)}"></div>
          <div class="field checkpoint-name"><label>Checkpoint</label><input data-field="name" value="${ui.escapeHtml(checkpoint.name)}"></div>
          <div class="field"><label>Rating</label><select data-field="rating"><option value="5" ${checkpoint.rating === 5 ? "selected" : ""}>5 - Excellent</option><option value="4" ${checkpoint.rating === 4 ? "selected" : ""}>4 - Good</option><option value="3" ${checkpoint.rating === 3 ? "selected" : ""}>3 - Monitor</option><option value="2" ${checkpoint.rating === 2 ? "selected" : ""}>2 - Poor</option><option value="1" ${checkpoint.rating === 1 ? "selected" : ""}>1 - Action</option></select></div>
          <div class="field"><label>Status</label><select data-field="status"><option ${checkpoint.status === "Pass" ? "selected" : ""}>Pass</option><option ${checkpoint.status === "Watch" ? "selected" : ""}>Watch</option><option ${checkpoint.status === "Action" ? "selected" : ""}>Action</option><option ${checkpoint.status === "N/A" ? "selected" : ""}>N/A</option></select></div>
          <div class="field checkpoint-notes"><label>Observation</label><div class="field-with-action"><input data-field="notes" value="${ui.escapeHtml(checkpoint.notes)}" placeholder="Supporting note"><button class="remove-button" type="button" data-remove-checkpoint="${checkpoint.id}">Remove</button></div></div>
        </div>
      `;
    }).join("");

    checkpointList.querySelectorAll("[data-checkpoint-id]").forEach(function (row) {
      const checkpoint = checkpoints.find((item) => item.id === row.dataset.checkpointId);
      row.querySelectorAll("[data-field]").forEach(function (input) {
        input.addEventListener("input", function () {
          const field = input.dataset.field;
          checkpoint[field] = field === "rating" ? Number(input.value) : input.value;
          updateScore();
        });
      });
    });

    checkpointList.querySelectorAll("[data-remove-checkpoint]").forEach(function (button) {
      button.addEventListener("click", function () {
        checkpoints = checkpoints.filter((item) => item.id !== button.dataset.removeCheckpoint);
        renderCheckpoints();
        updateScore();
      });
    });
  }

  function scoreInfo() {
    const scored = checkpoints.filter((item) => item.status !== "N/A" && Number(item.rating));
    if (!scored.length) return { score: 0, grade: "–", condition: "Incomplete", categoryLosses: [] };
    const maxPerItem = 100 / scored.length;
    const points = scored.reduce((total, item) => total + maxPerItem * (Number(item.rating) / 5), 0);
    const score = Math.max(0, Math.min(100, Math.round(points)));
    const band = gradeForScore(score);
    const categoryMap = {};

    scored.forEach(function (item) {
      const loss = maxPerItem * (1 - Number(item.rating) / 5);
      const key = item.category || "General";
      if (!categoryMap[key]) categoryMap[key] = { category: key, loss: 0, notes: [] };
      categoryMap[key].loss += loss;
      if (item.rating < 5 || item.status === "Watch" || item.status === "Action") {
        categoryMap[key].notes.push(item.notes || item.name);
      }
    });

    const categoryLosses = Object.values(categoryMap)
      .map((item) => ({
        category: item.category,
        loss: Math.round(item.loss * 10) / 10,
        explanation: item.notes.filter(Boolean).slice(0, 2).join("; ") || "No material deduction."
      }))
      .filter((item) => item.loss > 0)
      .sort((a, b) => b.loss - a.loss);

    return { score, grade: band.grade, condition: band.label, categoryLosses };
  }

  function updateScore() {
    const info = scoreInfo();
    const asset = selectedAsset();
    const household = state.households.find((item) => item.id === householdSelect.value);
    document.getElementById("score-number").textContent = info.score;
    document.getElementById("score-condition").textContent = info.condition;
    document.getElementById("score-grade").textContent = info.grade;
    document.getElementById("score-heading").innerHTML = `${info.score} <small>/ 100</small>`;
    document.getElementById("score-orb").style.setProperty("--score-angle", (info.score * 3.6) + "deg");
    document.getElementById("report-summary-lines").innerHTML = `
      <div class="summary-line"><span>Household</span><strong>${ui.escapeHtml(household ? household.name : "-")}</strong></div>
      <div class="summary-line"><span>Appliance</span><strong>${ui.escapeHtml(asset ? asset.typeLabel : "-")}</strong></div>
      <div class="summary-line"><span>Vitals</span><strong>${measurements.length}</strong></div>
      <div class="summary-line"><span>Checkpoints</span><strong>${checkpoints.length}</strong></div>
    `;
    document.getElementById("category-loss-preview").innerHTML = info.categoryLosses.length
      ? `<div class="label">Largest score deductions</div>${info.categoryLosses.slice(0, 4).map((item) => `<div class="loss-preview-row"><span>${ui.escapeHtml(item.category)}</span><strong>-${item.loss}</strong></div>`).join("")}`
      : `<div class="callout"><strong>No score deductions</strong>All applicable checkpoints are receiving full points.</div>`;
  }

  function renderTasks() {
    document.getElementById("maintenance-task-grid").innerHTML = config.maintenanceTasks.map(function (task, index) {
      return `<label class="checkbox-card"><input type="checkbox" name="maintenanceTask" value="${ui.escapeHtml(task)}" ${index < 2 ? "checked" : ""}><span>${ui.escapeHtml(task)}</span></label>`;
    }).join("");
  }

  function selectedTasks() {
    return Array.from(document.querySelectorAll("input[name='maintenanceTask']:checked")).map((item) => item.value);
  }

  function applianceFullLabel(asset) {
    return [asset.brand, asset.model, asset.typeLabel].filter(Boolean).join(" ");
  }

  function linesFromTextarea(idValue) {
    return document.getElementById(idValue).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  }

  householdSelect.addEventListener("change", loadAssets);
  assetSelect.addEventListener("change", loadTemplates);

  document.getElementById("add-measurement").addEventListener("click", function () {
    measurements.push({ id: id("measure"), label: "Custom vital", observed: "", unit: "", target: "", result: "Not tested", notes: "" });
    renderMeasurements();
  });

  document.getElementById("add-checkpoint").addEventListener("click", function () {
    checkpoints.push({ id: id("cp"), category: "Custom", name: "Custom checkpoint", rating: 4, status: "Pass", notes: "" });
    renderCheckpoints();
    updateScore();
  });

  document.getElementById("health-report-form").addEventListener("submit", function (event) {
    event.preventDefault();
    const asset = selectedAsset();
    const household = state.households.find((item) => item.id === householdSelect.value);
    const info = scoreInfo();
    const summary = document.getElementById("report-summary").value.trim();
    if (!asset || !household || !summary) {
      ui.toast("Report information needed", "Select a household and appliance, then enter a technician condition summary.");
      return;
    }

    const manualCorrective = linesFromTextarea("corrective-measures");
    const derivedCorrective = checkpoints
      .filter((item) => item.status === "Action" || item.status === "Watch")
      .map((item) => item.notes || item.name)
      .filter(Boolean);
    const correctiveMeasures = Array.from(new Set(manualCorrective.concat(derivedCorrective)));

    const report = WilsonStore.saveReport({
      householdId: household.id,
      assetId: asset.id,
      reportType: "Appliance Health Report",
      applianceLabel: applianceFullLabel(asset),
      technician: document.getElementById("report-technician").value.trim(),
      inspectionDate: document.getElementById("inspection-date").value,
      nextDueOn: document.getElementById("next-due-date").value,
      reference: document.getElementById("report-reference").value.trim(),
      score: info.score,
      grade: info.grade,
      condition: info.condition,
      summary,
      recommendations: document.getElementById("report-recommendations").value.trim(),
      correctiveMeasures,
      serviceSummary: document.getElementById("service-summary").value.trim() || summary,
      filterPart: document.getElementById("filter-part").value.trim(),
      filterAction: document.getElementById("filter-action").value,
      measurements: measurements.map((item) => ({ label: item.label, observed: item.observed, unit: item.unit, target: item.target, result: item.result, notes: item.notes })),
      checkpoints: checkpoints.map((item) => ({ category: item.category, name: item.name, rating: Number(item.rating), status: item.status, notes: item.notes })),
      categoryLosses: info.categoryLosses,
      tasks: selectedTasks(),
      photoCount: document.getElementById("report-photos").files.length
    });
    window.location.href = "report-view.html?id=" + encodeURIComponent(report.id);
  });

  householdOptions();
  loadAssets();
  renderTasks();
  document.getElementById("inspection-date").value = todayIso(0);
  document.getElementById("next-due-date").value = todayIso(180);
  document.getElementById("report-summary").value = "Appliance is operating normally at the time of inspection. Routine maintenance was completed and no immediate repair is required.";
  document.getElementById("service-summary").value = "Routine inspection and maintenance completed. Appliance was returned to normal operation at the end of the visit.";
})();

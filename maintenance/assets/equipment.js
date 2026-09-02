/*
 * THE ENRICHMENT SCREEN.  (v0.9.34)
 *
 * A thin renderer over WILSON_MATCH. Every pairing decision, every confidence
 * and every reason comes from that module; this file draws them, collects what
 * the office changes, and calls the store once at the end.
 *
 * That split is the point. The matching rules are testable without a browser
 * (_qa/verify-equipment-match.js), and a screen cannot quietly develop a second
 * opinion about which line is which appliance.
 */
(function () {
  "use strict";
  const ui = window.WilsonUI;
  const M = window.WILSON_MATCH;
  const B = window.WILSON_BRANDS;

  const host = document.getElementById("equip-results");
  if (!host) return;

  const householdId = new URLSearchParams(window.location.search).get("id") || "";
  let bundle = null;
  let proposal = null;
  let parsedRefs = [];
  /* Per-match office decisions, keyed by slot id: "confirm" | "skip". Held here
     rather than read off the DOM so a re-render never loses them. */
  const decisions = {};
  let selectedFiles = [];

  function load() {
    bundle = window.WilsonStore.getHouseholdBundle(householdId);
    return Boolean(bundle);
  }

  function slots() {
    return bundle.assets.filter(function (a) {
      return a.group !== "hvac" && a.status !== "Removed";
    });
  }

  /* ------------------------------------------------------------------ header */
  function paintHeader() {
    const gaps = window.WilsonStore.equipmentGaps(householdId);
    document.getElementById("equip-household").textContent = bundle.household.name;
    document.getElementById("equip-sub").textContent =
      [bundle.household.address1, bundle.household.city].filter(Boolean).join(" · ");
    document.getElementById("household-link").href = "household.html?id=" + householdId;
    const stats = [
      { n: gaps.total, label: "on the plan" },
      { n: gaps.missing, label: "with no brand or model" },
      { n: gaps.undated, label: "with no install date" },
      { n: (bundle.parked || []).length, label: "sold, not covered" }
    ];
    document.getElementById("equip-stats").innerHTML = stats.map(function (s) {
      return '<div class="ops-stat"><strong>' + s.n + "</strong><span>" + s.label + "</span></div>";
    }).join("");
  }

  /* ------------------------------------------------------------- file picking */
  function bytesLabel(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function renderFiles() {
    const list = document.getElementById("equip-file-list");
    list.innerHTML = selectedFiles.map(function (file, index) {
      return '<div class="invoice-file-chip"><span class="invoice-file-pdf">PDF</span><div><strong>' +
        ui.escapeHtml(file.name) + "</strong><small>" + bytesLabel(file.size) +
        '</small></div><button type="button" data-remove-file="' + index + '" aria-label="Remove ' +
        ui.escapeHtml(file.name) + '">×</button></div>';
    }).join("");
    document.getElementById("equip-parse").disabled = !selectedFiles.length;
    list.querySelectorAll("[data-remove-file]").forEach(function (button) {
      button.addEventListener("click", function () {
        selectedFiles.splice(Number(button.dataset.removeFile), 1);
        renderFiles();
      });
    });
  }

  async function parseFiles() {
    if (!selectedFiles.length) return;
    const button = document.getElementById("equip-parse");
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Reading invoice PDFs…";
    const data = new FormData();
    selectedFiles.forEach(function (file) { data.append("invoices", file, file.name); });
    try {
      const response = await fetch("/api/invoice/import", { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "The invoices could not be parsed.");
      parsedRefs = payload.invoiceNumbers || [];
      proposal = M.propose(slots(), payload.items || []);
      Object.keys(decisions).forEach(function (k) { delete decisions[k]; });
      /* Everything above low confidence starts confirmed. Low starts unchecked,
         because "only the category matches" is a question, not a proposal. */
      proposal.matches.forEach(function (m) {
        decisions[m.slotId] = (m.confidence === "low" || m.wouldOverwrite) ? "skip" : "confirm";
      });
      renderProposal();
      ui.toast("Matched against this household",
        proposal.counts.matched + " of " + proposal.counts.slots + " appliances matched, " +
        proposal.counts.extras + " not on the plan.");
    } catch (error) {
      ui.toast("Invoice import failed",
        error.message || "Check your connection and try again.");
    } finally {
      button.textContent = previous;
      button.disabled = !selectedFiles.length;
    }
  }

  /* --------------------------------------------------------------- proposal */
  function confidenceBadge(confidence) {
    const tone = confidence === "high" ? "success" : confidence === "medium" ? "" : "warning";
    return '<span class="badge ' + tone + '">' + confidence + " confidence</span>";
  }

  /*
   * The guardrail, wearing the office's sentence. The same string the customer
   * report and the technician's card use, from serviceabilityCopy -- one rule,
   * three surfaces, one wording.
   */
  function guardrailNote(serviceability) {
    if (!serviceability || !serviceability.office) return "";
    const tone = serviceability.state === "not_serviced" ? "danger" : "warning";
    return '<p class="equip-guardrail ' + tone + '"><strong>' +
      ui.escapeHtml(serviceability.brand || "This brand") + "</strong> — " +
      ui.escapeHtml(serviceability.office) + "</p>";
  }

  function detailLine(line) {
    return [line.brand, line.model, line.serial ? "S/N " + line.serial : "", line.installYear || ""]
      .filter(Boolean).map(ui.escapeHtml).join(" · ");
  }

  function matchRow(m) {
    const decided = decisions[m.slotId] || "skip";
    const known = [m.slot.brand, m.slot.model].filter(Boolean).join(" ");
    return '<article class="equip-match ' + (decided === "confirm" ? "is-confirmed" : "") + '">' +
      '<div class="equip-match-head">' +
        "<div><strong>" + ui.escapeHtml(m.slot.typeLabel) + "</strong>" +
          '<span class="equip-where">' + ui.escapeHtml(m.slot.location || "no area recorded") + "</span></div>" +
        confidenceBadge(m.confidence) +
      "</div>" +
      '<p class="equip-proposed">' + detailLine(m.line) + "</p>" +
      '<p class="equip-why">' + ui.escapeHtml(m.why) + "</p>" +
      (m.wouldOverwrite
        ? '<p class="equip-guardrail warning">Already on file as <strong>' + ui.escapeHtml(known) +
          "</strong>. Confirming replaces it — leave it unticked to keep what is there.</p>"
        : "") +
      guardrailNote(m.serviceability) +
      '<label class="equip-confirm"><input type="checkbox" data-confirm="' + m.slotId + '"' +
        (decided === "confirm" ? " checked" : "") + "> Use these details</label>" +
      "</article>";
  }

  function renderProposal() {
    if (!proposal) { host.innerHTML = ""; return; }
    const c = proposal.counts;
    const warn = [];
    if (c.lowConfidence) warn.push(c.lowConfidence + " low-confidence");
    if (c.wouldOverwrite) warn.push(c.wouldOverwrite + " would replace details already on file");
    if (c.excluded) warn.push(c.excluded + " on a brand Wilson cannot cover");

    host.innerHTML =
      '<section class="card card-pad equip-proposal">' +
        '<div class="section-heading"><div><h2>Confirm the matches</h2>' +
        "<p>Nothing is written until you press save. Untick anything you are not sure about — an appliance with no details is a queue item, not a problem.</p></div>" +
        '<span class="badge">' + c.matched + " of " + c.slots + " matched</span></div>" +
        (warn.length ? '<p class="equip-warnbar">' + ui.escapeHtml(warn.join(" · ")) + "</p>" : "") +
        '<div class="equip-match-grid">' + proposal.matches.map(matchRow).join("") + "</div>" +

        (proposal.unmatched.length
          ? '<div class="equip-block"><h3>Nothing on the invoice for these</h3>' +
            "<p>They stay on the plan and keep asking. The technician can capture the details on site.</p>" +
            '<ul class="equip-list">' + proposal.unmatched.map(function (s) {
              return "<li><strong>" + ui.escapeHtml(s.typeLabel) + "</strong> · " +
                ui.escapeHtml(s.location || "no area recorded") + "</li>";
            }).join("") + "</ul></div>"
          : "") +

        (proposal.extras.length
          ? '<div class="equip-block"><h3>Sold, not covered</h3>' +
            "<p>On the invoice, not on the plan. These are parked on the customer file.</p>" +
            '<ul class="equip-list">' + proposal.extras.map(function (e) {
              return "<li><strong>" + ui.escapeHtml([e.line.brand, e.line.model].filter(Boolean).join(" ")) +
                "</strong> · " + ui.escapeHtml(e.line.exactTypeLabel || e.line.description || "") +
                '<span class="equip-why">' + ui.escapeHtml(e.reason) + "</span>" +
                (e.serviceability && e.serviceability.state === "not_serviced"
                  ? '<span class="equip-why">Not a brand Wilson services — not an upsell.</span>' : "") +
                "</li>";
            }).join("") + "</ul></div>"
          : "") +

        '<div class="inline-actions" style="margin-top:16px">' +
          '<button class="button" id="equip-save" type="button">Save confirmed details</button>' +
          '<button class="button ghost" id="equip-discard" type="button">Discard this match</button>' +
        "</div>" +
      "</section>";

    host.querySelectorAll("[data-confirm]").forEach(function (box) {
      box.addEventListener("change", function () {
        decisions[box.dataset.confirm] = box.checked ? "confirm" : "skip";
        box.closest(".equip-match").classList.toggle("is-confirmed", box.checked);
      });
    });
    document.getElementById("equip-save").addEventListener("click", saveProposal);
    document.getElementById("equip-discard").addEventListener("click", function () {
      proposal = null; renderProposal();
    });
  }

  function saveProposal() {
    if (!proposal) return;
    const confirm = proposal.matches
      .filter(function (m) { return decisions[m.slotId] === "confirm"; })
      .map(function (m) {
        return { slotId: m.slotId, sourceInvoice: m.line.invoiceNumber || "",
                 details: M.detailsFrom(m.line, m.slot, m.line.invoiceNumber) };
      });
    /*
     * Extras are parked whatever the office ticked. Cayden asked for them kept,
     * and a checkbox that could silently drop something Wilson sold would be a
     * way to lose it.
     */
    const park = proposal.extras.map(function (e) {
      return { line: e.line, reason: e.reason,
               serviceable: !e.serviceability || e.serviceability.state === "ok" ||
                            e.serviceability.state === "unstated" };
    });
    const out = window.WilsonStore.applyEquipmentDetails({
      householdId: householdId, invoiceRefs: parsedRefs, confirm: confirm, park: park
    });
    if (!out.ok) { ui.toast("Could not save", out.message || "Something went wrong."); return; }
    ui.toast("Equipment details saved",
      out.written + " field" + (out.written === 1 ? "" : "s") + " written" +
      (out.parked ? ", " + out.parked + " appliance" + (out.parked === 1 ? "" : "s") + " parked" : "") + ".");
    proposal = null;
    selectedFiles = [];
    document.getElementById("equip-files").value = "";
    renderFiles();
    load(); paintHeader(); renderProposal(); renderManual(); renderParked();
  }

  /* ----------------------------------------------------------------- manual */
  /*
   * Always present, never gated behind a failed upload. Plenty of these
   * households did not buy from Wilson, and for them this is the whole flow.
   */
  function provenanceNote(asset, field) {
    const p = (asset.detailProvenance || {})[field];
    if (!p || !p.source) return "";
    const where = p.source === "invoice" ? ("invoice" + (p.ref ? " " + p.ref : ""))
      : p.source === "tech" ? "the technician on site"
      : p.source === "office" ? "keyed by the office" : p.source;
    return '<small class="equip-prov">from ' + ui.escapeHtml(where) + "</small>";
  }

  /*
   * INDOOR OR OUTDOOR, ON THE OFFICE SCREEN.                    (v0.9.37)
   *
   * Cayden: "our tech or office should be able to flag it as outdoor."
   *
   * A select rather than the technician's one-tap button, because the office is
   * already keying a row of fields here and a third state -- "use the area
   * default" -- matters more from a desk: somebody correcting a mis-set flag
   * should be able to hand the appliance back to the default rather than pin
   * the opposite guess onto it.
   *
   * Only offered where it can change something. A grill has nowhere else to be,
   * and an outdoor dishwasher does not exist.
   */
  function environmentControl(a) {
    const E = window.WILSON_ENVIRONMENT;
    if (!E) return "";
    const env = E.for(a);
    if (env.source === "type") {
      return '<label class="equip-env-fixed">Indoor / outdoor<span>' + ui.escapeHtml(env.label) +
             "</span><small>" + ui.escapeHtml(env.why) + "</small></label>";
    }
    const flagged = a.installEnvironment === "indoor" || a.installEnvironment === "outdoor";
    const line = B ? B.lineForAsset(a) : "";
    /* The note is different when it matters to the expected life and when it is
       merely a fact about the appliance -- the office should be able to tell. */
    const note = E.lifeSensitive(line)
      ? (flagged ? env.why : env.why + " Changes the expected life.")
      : env.why;
    return '<label>Indoor / outdoor' +
      '<select data-env="' + a.id + '">' +
        '<option value="">' + (flagged ? "Use the area default" : "From the area (" + env.label.toLowerCase() + ")") + "</option>" +
        '<option value="indoor"' + (a.installEnvironment === "indoor" ? " selected" : "") + ">Indoor</option>" +
        '<option value="outdoor"' + (a.installEnvironment === "outdoor" ? " selected" : "") + ">Outdoor</option>" +
      "</select>" +
      '<small class="equip-env-note">' + ui.escapeHtml(note) + "</small></label>";
  }

  function bindEnvironmentControls() {
    document.getElementById("equip-manual").querySelectorAll("[data-env]").forEach(function (select) {
      select.addEventListener("change", function () {
        const res = WilsonStore.setAssetEnvironment({
          assetId: select.dataset.env,
          environment: select.value === "" ? null : select.value,
          source: "office"
        });
        if (!res || !res.ok) { ui.toast("Not recorded", (res && res.message) || "Could not record that."); return; }
        /* Re-read: the note under the select has to say the NEW reason, and the
           gap counters at the top of the page move with it. */
        load();
        renderManual();
        paintHeader();
      });
    });
  }

  function renderManual() {
    document.getElementById("equip-manual").innerHTML = slots().map(function (a) {
      return '<div class="equip-manual-row" data-slot="' + a.id + '">' +
        "<div><strong>" + ui.escapeHtml(a.typeLabel) + "</strong>" +
          '<span class="equip-where">' + ui.escapeHtml(a.location || "no area recorded") + "</span></div>" +
        '<label>Brand<input type="text" data-field="brand" value="' + ui.escapeHtml(a.brand || "") +
          '" placeholder="—">' + provenanceNote(a, "brand") + "</label>" +
        '<label>Model<input type="text" data-field="model" value="' + ui.escapeHtml(a.model || "") +
          '" placeholder="—">' + provenanceNote(a, "model") + "</label>" +
        '<label>Serial<input type="text" data-field="serial" value="' + ui.escapeHtml(a.serial || "") +
          '" placeholder="—">' + provenanceNote(a, "serial") + "</label>" +
        '<label>Installed<input type="number" data-field="installYear" min="1970" max="2100" value="' +
          ui.escapeHtml(a.installYear || "") + '" placeholder="—"></label>' +
        environmentControl(a) +
        '<div class="equip-manual-flag" data-flag="' + a.id + '"></div>' +
        "</div>";
    }).join("");
    bindEnvironmentControls();
    /* The guardrail runs as the office types, so an unserviced brand is caught
       at the keystroke rather than at the truck. */
    document.getElementById("equip-manual").querySelectorAll('[data-field="brand"]').forEach(function (input) {
      const row = input.closest(".equip-manual-row");
      const flag = row.querySelector(".equip-manual-flag");
      function paint() {
        const s = B ? B.serviceability({ brand: input.value }) : null;
        flag.innerHTML = (s && s.office)
          ? '<span class="equip-guardrail ' + (s.state === "not_serviced" ? "danger" : "warning") + '">' +
            ui.escapeHtml(s.office) + "</span>" : "";
      }
      input.addEventListener("input", paint);
      paint();
    });
  }

  function saveManual() {
    const confirm = [];
    const at = new Date().toISOString();
    document.getElementById("equip-manual").querySelectorAll(".equip-manual-row").forEach(function (row) {
      const slotId = row.dataset.slot;
      const asset = bundle.assets.find(function (a) { return a.id === slotId; });
      const details = {};
      row.querySelectorAll("[data-field]").forEach(function (input) {
        const field = input.dataset.field;
        const value = String(input.value || "").trim();
        if (!value) return;                                 /* blank never erases */
        if (field === "installYear") {
          if (Number(value) !== Number(asset.installYear)) {
            details.installYear = { value: Number(value), source: "office", ref: "", at: at };
          }
          return;
        }
        if (value === String(asset[field] || "").trim()) return;   /* unchanged */
        details[field] = { value: value, source: "office", ref: "", at: at };
      });
      if (Object.keys(details).length) confirm.push({ slotId: slotId, details: details });
    });
    if (!confirm.length) { ui.toast("Nothing to save", "No fields were changed."); return; }
    const out = window.WilsonStore.applyEquipmentDetails({ householdId: householdId, confirm: confirm });
    if (!out.ok) { ui.toast("Could not save", out.message || "Something went wrong."); return; }
    ui.toast("Equipment details saved", out.written + " field" + (out.written === 1 ? "" : "s") + " written.");
    load(); paintHeader(); renderManual(); renderParked();
  }

  /* ----------------------------------------------------------------- parked */
  function renderParked() {
    const card = document.getElementById("equip-parked-card");
    const list = bundle.parked || [];
    card.hidden = !list.length;
    document.getElementById("equip-parked-count").textContent = list.length;
    document.getElementById("equip-parked").innerHTML = '<ul class="equip-list">' + list.map(function (p) {
      return "<li><strong>" + ui.escapeHtml([p.brand, p.model].filter(Boolean).join(" ") || p.description) +
        "</strong> · " + ui.escapeHtml(p.typeLabel || "") +
        (p.invoiceNumber ? " · " + ui.escapeHtml(p.invoiceNumber) : "") +
        '<span class="equip-why">' + ui.escapeHtml(p.reason) +
        (p.serviceable ? "" : " — not a brand Wilson services") + "</span></li>";
    }).join("") + "</ul>";
  }

  /* ------------------------------------------------------------------- boot */
  if (!householdId || !load()) {
    host.innerHTML = '<section class="card card-pad"><h2>No household selected</h2>' +
      "<p>Open this screen from a household or from the work queue.</p>" +
      '<p><a class="button secondary" href="customers.html">Go to customers</a></p></section>';
    document.getElementById("equip-upload-card").hidden = true;
    document.getElementById("equip-manual-card").hidden = true;
    return;
  }

  paintHeader();
  renderManual();
  renderParked();

  const input = document.getElementById("equip-files");
  const dropzone = document.getElementById("equip-dropzone");
  function setFiles(files) {
    const seen = new Map();
    Array.from(files || []).filter(function (f) { return f.name.toLowerCase().endsWith(".pdf"); })
      .forEach(function (f) { seen.set(f.name + "|" + f.size + "|" + f.lastModified, f); });
    selectedFiles = Array.from(seen.values());
    renderFiles();
  }
  input.addEventListener("change", function () { setFiles(input.files); });
  document.getElementById("equip-choose").addEventListener("click", function () { input.click(); });
  dropzone.addEventListener("click", function () { input.click(); });
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  ["dragenter", "dragover"].forEach(function (type) {
    dropzone.addEventListener(type, function (e) { e.preventDefault(); dropzone.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (type) {
    dropzone.addEventListener(type, function (e) { e.preventDefault(); dropzone.classList.remove("is-over"); });
  });
  dropzone.addEventListener("drop", function (e) { setFiles(e.dataTransfer.files); });
  document.getElementById("equip-parse").addEventListener("click", parseFiles);
  document.getElementById("equip-clear").addEventListener("click", function () {
    selectedFiles = []; input.value = ""; proposal = null; renderFiles(); renderProposal();
  });
  document.getElementById("equip-save-manual").addEventListener("click", saveManual);
})();

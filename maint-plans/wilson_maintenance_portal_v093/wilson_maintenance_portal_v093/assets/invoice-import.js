(function () {
  const ui = window.WilsonUI;
  const config = window.WILSON_CONFIG;

  const input = document.getElementById("invoice-files");
  if (!input) return;

  const dropzone = document.getElementById("invoice-dropzone");
  const fileList = document.getElementById("invoice-file-list");
  const parseButton = document.getElementById("parse-invoices");
  const resultsHost = document.getElementById("invoice-import-results");
  let selectedFiles = [];
  let parsed = null;

  function bytesLabel(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function uniqueFiles(files) {
    const map = new Map();
    files.forEach((file) => map.set(`${file.name}|${file.size}|${file.lastModified}`, file));
    return Array.from(map.values());
  }

  function setFiles(files) {
    selectedFiles = uniqueFiles(Array.from(files || []).filter((file) => file.name.toLowerCase().endsWith(".pdf")));
    renderFiles();
  }

  function renderFiles() {
    fileList.innerHTML = selectedFiles.map(function (file, index) {
      return `<div class="invoice-file-chip"><span class="invoice-file-pdf">PDF</span><div><strong>${ui.escapeHtml(file.name)}</strong><small>${bytesLabel(file.size)}</small></div><button type="button" data-remove-file="${index}" aria-label="Remove ${ui.escapeHtml(file.name)}">×</button></div>`;
    }).join("");
    parseButton.disabled = !selectedFiles.length;
    fileList.querySelectorAll("[data-remove-file]").forEach(function (button) {
      button.addEventListener("click", function () {
        selectedFiles.splice(Number(button.dataset.removeFile), 1);
        renderFiles();
      });
    });
  }

  function clearAll() {
    selectedFiles = [];
    parsed = null;
    input.value = "";
    resultsHost.classList.add("hidden");
    resultsHost.querySelectorAll("input").forEach((field) => { field.value = ""; });
    renderFiles();
  }

  function categoryOptions(selected) {
    const standard = config.customerApplianceCategories.map(function (category) {
      return `<option value="${category.id}" ${selected === category.id ? "selected" : ""}>${ui.escapeHtml(category.label)}</option>`;
    }).join("");
    return `<option value="review" ${selected === "review" ? "selected" : ""}>Needs classification</option><option value="washer_dryer" ${selected === "washer_dryer" ? "selected" : ""}>Washer + Dryer (split pair)</option>${standard}`;
  }

  function areaOptions(selected) {
    const areas = Array.from(new Set(["Main House"].concat(parsed.areas || [], ["Unassigned — Review"])));
    return areas.map((area) => `<option value="${ui.escapeHtml(area)}" ${area === selected ? "selected" : ""}>${ui.escapeHtml(area)}</option>`).join("");
  }

  function reviewBadge(item) {
    if (item.customerCategory === "review") return '<span class="badge danger">Classify</span>';
    if (item.needsReview) return '<span class="badge warning">Review</span>';
    if (item.confidence === "high") return '<span class="badge success">High</span>';
    return '<span class="badge">Check</span>';
  }

  function renderResults() {
    if (!parsed) return;
    resultsHost.classList.remove("hidden");

    document.getElementById("invoice-import-metrics").innerHTML = [
      [parsed.invoiceNumbers.length, "Invoice files combined"],
      [parsed.lineItemCount, "Product lines extracted"],
      [parsed.expandedAssetCount, "Maintenance records"],
      [parsed.ignored.length, "Support lines ignored"]
    ].map((item) => `<div class="metric-card"><div class="metric-label">${ui.escapeHtml(item[1])}</div><div class="metric-value">${item[0]}</div></div>`).join("");

    const warningHost = document.getElementById("invoice-import-warnings");
    if (parsed.warnings && parsed.warnings.length) {
      warningHost.classList.remove("hidden");
      warningHost.innerHTML = `<strong>Review notes</strong><ul>${parsed.warnings.map((warning) => `<li>${ui.escapeHtml(warning)}</li>`).join("")}</ul>`;
    } else {
      warningHost.classList.add("hidden");
      warningHost.innerHTML = "";
    }

    const contact = parsed.contact || {};
    document.getElementById("import-household-name").value = contact.householdLabel || "";
    document.getElementById("import-phone").value = contact.phone || "";
    document.getElementById("import-address1").value = contact.address1 || "";
    document.getElementById("import-city").value = contact.city || "";
    document.getElementById("import-state").value = contact.state || "TX";
    document.getElementById("import-zip").value = contact.zip || "";
    document.getElementById("invoice-number-badge").textContent = parsed.invoiceNumbers.join(" + ") || "Invoice";

    parsed.items.forEach(function (item) {
      if (typeof item._include !== "boolean") item._include = true;
      item._area = item._area || item.area || "Main House";
      item._category = item._category || item.customerCategory || "review";
      item._quantity = Number(item._quantity || item.quantity || 1);
    });

    document.getElementById("invoice-review-body").innerHTML = parsed.items.map(function (item, index) {
      const exactDetail = [item.brand, item.model].filter(Boolean).join(" ");
      return `
        <tr class="${item.needsReview || item.customerCategory === "review" ? "invoice-row-review" : ""}" data-invoice-row="${index}">
          <td><input type="checkbox" data-import-field="include" ${item._include ? "checked" : ""} aria-label="Include ${ui.escapeHtml(item.model || item.description)}"></td>
          <td><select class="compact-select" data-import-field="area">${areaOptions(item._area)}</select></td>
          <td><input class="compact-number" type="number" min="1" max="25" data-import-field="quantity" value="${item._quantity}"></td>
          <td><div class="table-title">${ui.escapeHtml(exactDetail || item.description)}</div><div class="table-sub">${ui.escapeHtml(item.description)}</div><div class="table-sub">${ui.escapeHtml(item.invoiceNumber)}</div></td>
          <td><div class="table-title">${ui.escapeHtml(item.exactTypeLabel)}</div><div class="table-sub">${ui.escapeHtml(item.classification || "Invoice description")}</div></td>
          <td><select class="compact-select category-select" data-import-field="category">${categoryOptions(item._category)}</select></td>
          <td>${reviewBadge(item)}${(item.notes || []).length ? `<div class="row-note">${ui.escapeHtml(item.notes.join(" "))}</div>` : ""}</td>
        </tr>`;
    }).join("");

    document.getElementById("invoice-review-body").querySelectorAll("[data-invoice-row]").forEach(function (row) {
      const item = parsed.items[Number(row.dataset.invoiceRow)];
      row.querySelectorAll("[data-import-field]").forEach(function (field) {
        field.addEventListener("change", function () {
          const key = field.dataset.importField;
          if (key === "include") item._include = field.checked;
          if (key === "area") item._area = field.value;
          if (key === "quantity") item._quantity = Math.max(1, Number(field.value || 1));
          if (key === "category") {
            item._category = field.value;
            item.customerCategory = field.value;
            item.needsReview = field.value === "review" || item.needsReview;
          }
          updateIncludedCount();
        });
      });
    });

    document.getElementById("invoice-ignored-count").textContent = `${parsed.ignored.length} installation, accessory, payment, or credit lines`;
    document.getElementById("invoice-ignored-body").innerHTML = parsed.ignored.map(function (item) {
      return `<tr><td>${ui.escapeHtml(item.invoiceNumber || "")}</td><td>${ui.escapeHtml(item.model || "—")}</td><td>${ui.escapeHtml(item.description || item.classification || "")}</td><td>${ui.escapeHtml(item.reason || "Excluded")}</td></tr>`;
    }).join("") || '<tr><td colspan="4"><div class="empty-state">No ignored lines.</div></td></tr>';

    updateIncludedCount();
    resultsHost.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function includedItems() {
    return parsed ? parsed.items.filter((item) => item._include !== false) : [];
  }

  function expandedCount(items) {
    return items.reduce(function (sum, item) {
      const multiplier = item._category === "washer_dryer" ? 2 : 1;
      return sum + (Number(item._quantity || 1) * multiplier);
    }, 0);
  }

  function updateIncludedCount() {
    const items = includedItems();
    document.getElementById("invoice-included-count").textContent = `${items.length} lines · ${expandedCount(items)} maintenance records`;
  }

  async function parseFiles() {
    if (!selectedFiles.length) return;
    parseButton.disabled = true;
    const previous = parseButton.textContent;
    parseButton.textContent = "Reading invoice PDFs…";
    const data = new FormData();
    selectedFiles.forEach((file) => data.append("invoices", file, file.name));

    try {
      const response = await fetch("/api/invoice/import", { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "The invoices could not be parsed.");
      parsed = payload;
      renderResults();
      ui.toast("Invoice inventory extracted", `${payload.expandedAssetCount} maintenance records were found across ${payload.invoiceNumbers.length} invoice file${payload.invoiceNumbers.length === 1 ? "" : "s"}.`);
    } catch (error) {
      ui.toast("Invoice import failed", error.message || "Open the prototype with OPEN_WILSON_PORTAL.bat and try again.");
    } finally {
      parseButton.textContent = previous;
      parseButton.disabled = !selectedFiles.length;
    }
  }

  function slug(value) {
    return String(value || "area").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "area";
  }

  function categoryConfig(categoryId) {
    return config.customerApplianceCategories.find((item) => item.id === categoryId) || null;
  }

  function exactTypeConfig(typeId) {
    return config.applianceTypes.find((item) => item.id === typeId) || null;
  }

  function createDraft() {
    const items = includedItems();
    if (!items.length) {
      ui.toast("No appliance lines selected", "Select at least one extracted product line.");
      return;
    }
    const unresolved = items.filter((item) => item._category === "review");
    if (unresolved.length) {
      ui.toast("Classification needed", `Choose a customer category for ${unresolved.length} highlighted item${unresolved.length === 1 ? "" : "s"}.`);
      return;
    }

    const areaNames = Array.from(new Set(items.map((item) => item._area || item.area || "Main House")));
    const areaMap = {};
    const areas = areaNames.map(function (name) {
      const id = name.toLowerCase() === "main house" ? "area_main" : `area_${slug(name)}`;
      areaMap[name] = id;
      return { id, name };
    });
    if (!areaMap["Main House"]) {
      areas.unshift({ id: "area_main", name: "Main House" });
      areaMap["Main House"] = "area_main";
    }

    const draftAssets = [];
    items.forEach(function (item, lineIndex) {
      const quantity = Math.max(1, Number(item._quantity || 1));
      const categoryIds = item._category === "washer_dryer" ? ["washer", "dryer"] : [item._category];
      for (let unit = 0; unit < quantity; unit += 1) {
        const groupId = `invoice_${lineIndex}_${unit}`;
        categoryIds.forEach(function (categoryId) {
          const category = categoryConfig(categoryId);
          const exact = exactTypeConfig(item.exactType);
          if (!category) return;
          const areaName = item._area || item.area || "Main House";
          const pairSuffix = item._category === "washer_dryer" ? ` — ${category.label}` : "";
          draftAssets.push({
            id: `import_${lineIndex}_${unit}_${categoryId}`,
            type: item.exactType || categoryId,
            typeLabel: `${item.exactTypeLabel || category.label}${pairSuffix}`,
            exactType: item.exactType || categoryId,
            exactTypeLabel: `${item.exactTypeLabel || category.label}${pairSuffix}`,
            customerCategory: categoryId,
            group: category.group,
            checkpointSet: (exact && exact.checkpointSet) || category.checkpointSet,
            filterTypes: (exact && exact.filterTypes) || category.filterTypes || [],
            imucVisitsPerYear: category.group === "imuc" ? 2 : 1,
            brand: item.brand || "",
            model: item.model || "",
            serial: item.serial || "",
            description: item.description || "",
            sourceInvoice: item.invoiceNumber || "",
            sourceGroupId: groupId,
            source: "invoice",
            needsReview: Boolean(item.needsReview),
            areaId: areaMap[areaName],
            location: areaName
          });
        });
      }
    });

    const draft = {
      version: 1,
      createdAt: new Date().toISOString(),
      invoiceNumbers: parsed.invoiceNumbers,
      sourceFiles: parsed.sourceFiles,
      contact: {
        householdLabel: document.getElementById("import-household-name").value.trim(),
        phone: document.getElementById("import-phone").value.trim(),
        email: document.getElementById("import-email").value.trim(),
        address1: document.getElementById("import-address1").value.trim(),
        city: document.getElementById("import-city").value.trim(),
        state: document.getElementById("import-state").value.trim() || "TX",
        zip: document.getElementById("import-zip").value.trim(),
        notes: `Appliance inventory imported from Wilson invoice ${parsed.invoiceNumbers.join(" + ")}.`
      },
      areas,
      assets: draftAssets,
      warnings: parsed.warnings || []
    };

    WilsonStore.saveInvoiceDraft(draft);
    WilsonStore.recordInvoiceImport({
      invoiceNumbers: parsed.invoiceNumbers,
      sourceFiles: parsed.sourceFiles,
      householdLabel: draft.contact.householdLabel,
      address1: draft.contact.address1,
      applianceCount: draftAssets.length,
      ignoredLineCount: parsed.ignored.length,
      warnings: parsed.warnings || []
    });
    window.location.href = "appliance-signup.html?import=1";
  }

  document.getElementById("choose-invoices").addEventListener("click", function (event) {
    event.stopPropagation();
    input.click();
  });
  dropzone.addEventListener("click", function (event) {
    if (!event.target.closest("button")) input.click();
  });
  dropzone.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", function () { setFiles(input.files); });
  ["dragenter", "dragover"].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.remove("drag-over");
    });
  });
  dropzone.addEventListener("drop", function (event) { setFiles(event.dataTransfer.files); });

  parseButton.addEventListener("click", parseFiles);
  document.getElementById("clear-invoice-files").addEventListener("click", clearAll);
  document.getElementById("reset-invoice-import").addEventListener("click", clearAll);
  document.getElementById("create-maintenance-draft").addEventListener("click", createDraft);
  document.getElementById("open-invoice-import").addEventListener("click", function () {
    const tab = document.querySelector('[data-tab-target="panel-imports"]');
    if (tab) tab.click();
    document.getElementById("panel-imports").scrollIntoView({ behavior: "smooth", block: "start" });
  });
})();

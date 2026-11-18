/* =============================================================
   Wilson Site Walk — spec library
   Read a Steel Cod package, then work through the openings it
   could not read. The library is the durable asset; a package
   upload is just what triggers filling it in.
   ============================================================= */
(function () {
  "use strict";
  var SW = window.WILSON_SW;
  var ui = window.WilsonUI;
  var esc = function (v) { return ui.escapeHtml(v); };

  var lastImport = null;     /* the most recent parse result */
  var draft = null;          /* the model being edited, as a working copy */
  var libFilter = "";        /* the library's search box — rows hide in place, no repaint */
  var draftIsNew = false;
  var busy = false;
  /* The package reader's address. A host that sets window.WILSON_SW_API
     names its own (specImport) or has none; with no host settings this is the
     standalone server's. */
  var IMPORT_URL = window.WILSON_SW_API ? (window.WILSON_SW_API.specImport || "") : "/api/specs/import";

  var RULE_LABELS = { exact: "true", min: "min", max: "max" };

  function deep(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- import ---------------- */
  function importCard() {
    /* v0.9.83: where the host has no package reader of its own (Agility, step
       one), say where packages are read instead of offering an upload that
       cannot work. The standalone server still has /api/specs/import. */
    /* v0.9.85: on a host with no package reader of its own (Agility) the
       card above — the book read in the browser — is the way in, so this
       older server-side reader is simply not offered there. */
    if (!IMPORT_URL) return "";
    var h = '<div class="form-section"><h2>List the models in a spec package</h2>' +
      "<p>The quick version of the card above, read on the server: it lists every model and its installation details without opening a sheet. " +
      "Upload the Full Spec Package PDF. The installation headings, model numbers and page ranges " +
      "come out cleanly. <strong>The opening dimensions do not</strong> — they live in the drawings — so what " +
      "comes back is a list of the openings still to enter, each with the page to read it off.</p>" +
      '<label class="tech-photo-button required-photo" style="text-align:left">' +
      "<span>" + (busy ? "Reading the package…" : "▣ Choose the Full Spec Package PDF") + "</span>" +
      '<input type="file" accept="application/pdf,.pdf" multiple data-act="specfile"' + (busy ? " disabled" : "") + "></label>";

    if (lastImport && lastImport.error) {
      h += '<div class="callout danger" style="margin-top:12px"><strong>Could not read that package</strong>' +
        esc(lastImport.error) + "</div>";
    }
    if (lastImport && lastImport.unavailable) {
      h += '<div class="callout" style="margin-top:12px"><strong>Reading PDFs needs the portal server</strong>' +
        "This preview has no <code>/api/specs/import</code> behind it. Run the tool from the portal " +
        "(<code>OPEN_WILSON_PORTAL.bat</code>) to upload a package, or add models by hand below — " +
        "everything else on this screen works either way.</div>";
    }
    if (lastImport && lastImport.ok) h += importResult(lastImport);
    return h + "</div>";
  }

  function importResult(res) {
    var s = res.summary, p = res.package;
    var h = '<div class="callout success" style="margin-top:14px"><strong>' +
      esc(p.jobNo || "Spec package") + " read — " + s.models + " models, " + s.variations + " installation details</strong>" +
      esc([p.version ? "version " + p.version : "", p.generated, p.pages + " pages"].filter(Boolean).join(" · ")) + "</div>";

    if (s.multiVariation) {
      h += '<div class="callout warning" style="margin-top:10px"><strong>' + s.multiVariation +
        " model" + (s.multiVariation > 1 ? "s carry" : " carries") + " more than one installation detail</strong>" +
        esc(s.multiVariationModels.join(", ")) +
        ". Openings for these are not interchangeable — the walk sheet will hold each one until a basis is picked.</div>";
    }
    (res.warnings || []).forEach(function (warn) {
      h += '<p class="disclaimer" style="margin-top:8px;color:var(--warning)">' + esc(warn) + "</p>";
    });

    h += '<div class="table-wrap" style="margin-top:14px"><table><thead><tr>' +
      "<th>Model</th><th>Brand</th><th>Pages</th><th>Installation details</th><th>In the library</th>" +
      "</tr></thead><tbody>";
    res.models.forEach(function (m) {
      var known = SW.findModel(m.model);
      h += "<tr><td><div class=\"table-title\">" + esc(m.model) + "</div>" +
        '<div class="table-sub">' + esc(m.description || m.category || "") + "</div></td>" +
        "<td>" + esc(m.brand || "—") + "</td>" +
        "<td>" + esc(m.pages) + "</td>" +
        "<td>" + (m.variations.length
          ? m.variations.map(function (v) {
              return '<span class="badge ' + (v.implied ? "" : "info") + '">' + esc(v.label) + " " + esc(v.page) + "</span>";
            }).join(" ")
          : '<span class="table-sub">none found</span>') + "</td>" +
        "<td>" + (known ? '<span class="badge success">yes</span>' : '<span class="badge warning">no</span>') + "</td></tr>";
    });
    h += "</tbody></table></div>";
    h += '<div class="inline-actions" style="margin-top:12px">' +
      '<button class="button small" data-act="adoptmodels">Add these to the library</button>' +
      '<button class="button small ghost" data-act="clearimport">Dismiss</button></div>';
    return h;
  }

  /* Turn a parsed package into library entries, keeping any opening that has
     already been entered for a model we know. */
  function adopt(res) {
    var added = 0, updated = 0;
    res.models.forEach(function (m) {
      var known = SW.findModel(m.model);
      var entry = known ? deep(known) : SW.blankModelEntry();
      entry.model = known ? entry.model : m.model;
      entry.brand = entry.brand || m.brand;
      entry.appliance = entry.appliance || m.description || m.category;
      entry.pages = m.pages;
      entry.prefix = entry.prefix || m.model.replace(/[\/\-].*$/, "");
      entry.source = "spec package " + (res.package.jobNo || "");
      /* blankModelEntry() ships one empty variation so the hand editor has a
         row to type into. Adopting a package must not treat that placeholder
         as a real detail -- it has no key, and it swallowed the incoming one. */
      entry.variations = (entry.variations || []).filter(function (v) { return v.key; });
      m.variations.forEach(function (v) {
        var existing = entry.variations.filter(function (x) { return x.key === v.key; })[0];
        /* An implied variation is a placeholder the parser invented because
           the sheet carried no heading. If the entry already has a single
           variation, that is the same thing under whatever name the library
           gave it — matching on key alone would leave MSER0990S holding both
           "countertop" and "freestanding". */
        if (!existing && v.implied && entry.variations.length === 1 && entry.variations[0].key) {
          existing = entry.variations[0];
        }
        if (existing) {
          if (v.page) existing.page = v.page;
          if (m.proposedOpening && !SW.hasOpening(existing) && !existing.noOpening) existing.proposed = m.proposedOpening;
          if ((m.cutouts || []).length && !SW.hasOpening(existing) && !existing.noOpening) existing.sheetCutouts = m.cutouts;
          return;
        }
        var fresh = SW.blankVariation();
        fresh.key = v.key; fresh.label = v.label; fresh.page = v.page;
        if (v.implied && !v.needsOpening) fresh.noOpening = true;
        if (m.proposedOpening) fresh.proposed = m.proposedOpening;
        if ((m.cutouts || []).length) fresh.sheetCutouts = m.cutouts;
        entry.variations.push(fresh);
      });
      entry.variations = entry.variations.filter(function (v) { return v.key; });
      if (!entry.variations.length) entry.variations = [SW.blankVariation()];
      /* what the sheet says about hook-ups, for the wizard and the walk */
      if ((m.connHints || []).length) entry.connHints = m.connHints;
      SW.saveModel(entry);
      if (known) updated++; else added++;
    });
    return { added: added, updated: updated };
  }

  /* ---------------- the openings queue ---------------- */
  function queuePanel() {
    var queue = SW.openingQueue();
    var h = '<div class="form-section"><h2>Openings still to enter <span class="badge ' +
      (queue.length ? "warning" : "success") + '">' + queue.length + "</span></h2>";
    if (!queue.length) {
      h += "<p>Every installation detail in the library has an opening on it. A walk loaded against these " +
        "models will pre-populate for the tech.</p></div>";
      return h;
    }
    h += "<p>Open the spec package at the page named, read the opening off the drawing, and type it once. " +
      "It is reused on every job from here.</p>";
    queue.slice(0, 40).forEach(function (row) { h += queueRow(row.entry, row.variation); });
    if (queue.length > 40) h += '<p class="disclaimer">Plus ' + (queue.length - 40) + " more.</p>";
    return h + "</div>";
  }

  function queueRow(entry, v) {
    var id = SW.normModel(entry.model) + "|" + v.key;
    var h = '<div class="sw-queue" data-row="' + esc(id) + '">' +
      '<div class="sw-queue-head"><div><strong>' + esc(entry.brand + " " + entry.model) + "</strong>" +
      "<span>" + esc(v.label) + (v.page ? " · " + esc(v.page) : "") + "</span></div>" +
      '<span class="badge warning">opening needed</span></div>';

    if (v.proposed && v.proposed.values) {
      h += '<div class="sw-propose"><strong>The sheet prints these three as minimums</strong>' +
        "<p>" + esc(v.proposed.note || "") + " Source: " + esc(v.proposed.source || "") + "</p>" +
        '<div class="sw-propose-chips">' + v.proposed.values.map(function (val) {
          return SW.DIMS.map(function (d) {
            return '<button class="tech-chip" data-act="usepropose" data-row="' + esc(id) +
              '" data-dim="' + d.k + '" data-v="' + esc(val) + '">' + esc(val) + '" → ' + d.label + "</button>";
          }).join("");
        }).join("") + "</div></div>";
    }

    if (v.sheetCutouts && v.sheetCutouts.length) {
      h += '<div class="sw-propose"><strong>On this sheet</strong>' +
        "<p>The text layer prints these. One tap fills the three boxes — confirm them against the drawing before you save.</p>" +
        '<div class="sw-propose-chips">' + v.sheetCutouts.slice(0, 6).map(function (c) {
          var txt = [c.w != null ? SW.fmtFrac(c.w) + '" W' : "", c.h != null ? SW.fmtFrac(c.h) + '" H' : "", c.d != null ? SW.fmtFrac(c.d) + '" D' : ""].filter(Boolean).join(" × ");
          return '<button class="tech-chip" data-act="usecutout" data-row="' + esc(id) + '" data-w="' + (c.w != null ? c.w : "") + '" data-h="' + (c.h != null ? c.h : "") + '" data-d="' + (c.d != null ? c.d : "") + '">' +
            esc(c.label || "Cutout") + (c.pageNo ? " p." + c.pageNo : "") + " — " + esc(txt) + "</button>";
        }).join("") + "</div></div>";
    }

    h += '<div class="sw-queue-grid">' + SW.DIMS.map(function (d) {
      return '<label class="field"><span class="field-label">' + esc(d.label) + "</span>" +
        '<input class="sw-input sw-num" data-q="' + esc(id) + '" data-dim="' + d.k + '" placeholder="24 1/2" value="' +
        esc(v.opening[d.k] || "") + '">' +
        '<select class="sw-input" data-q="' + esc(id) + '" data-rule="' + d.k + '">' +
        Object.keys(RULE_LABELS).map(function (r) {
          var sel = (v.rule[d.k] || (d.k === "w" ? "exact" : "min")) === r ? " selected" : "";
          return '<option value="' + r + '"' + sel + ">" + RULE_LABELS[r] + "</option>";
        }).join("") + "</select></label>";
    }).join("") + "</div>";

    h += '<div class="inline-actions" style="margin-top:10px">' +
      '<button class="button small" data-act="savequeue" data-row="' + esc(id) + '">Save this opening</button>' +
      '<button class="button small ghost" data-act="noopening" data-row="' + esc(id) + '">No rough opening</button>' +
      "</div></div>";
    return h;
  }

  /* ---------------- the library ---------------- */
  /* ---------------- the shared library, and a spec book for it (v0.9.85) ---------------- */
  var synced = false, syncing = false, dimsEdit = "";
  function shareLine() {
    var st = SW.libraryState();
    if (!st.shared) {
      return '<p class="sw-lib-share local"><strong>This browser only.</strong> There is no server behind this copy of the tool, so the library is kept here.</p>';
    }
    return '<p class="sw-lib-share' + (st.error ? " warn" : "") + '"><strong>Shared library.</strong> ' +
      (st.error ? esc(st.error) + " Changes made here are kept and sent when it can be."
        : "What is added or corrected here is the library for everyone" + (st.at ? " · checked " + esc(ui.shortTime ? ui.shortTime(st.at) : st.at.slice(11, 16)) : "") +
          " · " + st.rows + " shared " + (st.rows === 1 ? "entry" : "entries")) +
      (st.unsent ? ' · <span class="sw-lib-unsent">' + st.unsent + " still to send</span>" : "") +
      (syncing ? " · checking…" : "") + "</p>";
  }
  function bookCard() {
    var PKG = window.WILSON_SW_SPECPKG;
    if (!PKG) return "";
    return '<div class="form-section sw-lib-book"><h2>Add a spec book to the library</h2>' +
      "<p>Drop in a Steel Cod Full Spec Package, or a manufacturer's book for one model. The tool reads the models and their pages; " +
      "you open each one, check its numbers against its own sheet, and save. <strong>No walk is created</strong> — " +
      "the next job with those models arrives with the numbers already confirmed, and asks for a fresh look only if the manufacturer's sheet has been re-cut since.</p>" +
      '<label class="button sw-pkg-pick">Choose a spec book PDF' +
      '<input type="file" accept="application/pdf,.pdf" data-act="pkgfile" data-lib="1" hidden></label></div>';
  }
  function dimsRows() {
    var mem = SW.dimMemory();
    return Object.keys(mem).map(function (k) {
      var r = mem[k], cut = k.indexOf("|");
      return { key: k, rec: r, model: r.model || k.slice(0, cut), basis: r.basisKey != null && r.model ? r.basisKey : (k.slice(cut + 1) === "-" ? "" : k.slice(cut + 1)) };
    }).sort(function (a, b) { return a.model < b.model ? -1 : a.model > b.model ? 1 : 0; });
  }
  function basisLabel(row) {
    var e = SW.findModel(row.model);
    var v = e && (e.variations || []).filter(function (x) { return x.key === row.basis; })[0];
    return row.rec.installType || (v && v.label) || row.basis || "—";
  }
  function confirmedPanel() {
    var rows = dimsRows();
    var h = '<div class="form-section sw-lib-confirmed"><h2>Numbers confirmed against a spec sheet</h2>' +
      "<p>" + (rows.length ? rows.length + " install" + (rows.length === 1 ? "" : "s") + ". Each" : "None yet. Each") + " was read off a manufacturer sheet by a person, at a walk's setup or from a spec book added above. " +
      "They stand for every later job whose sheet carries the same date; a sheet re-cut since asks for a fresh look. Correct one here if it was typed wrong.</p>";
    if (!rows.length) return h + "</div>";
    h += '<div class="table-wrap"><table><thead><tr><th>Model</th><th>Install</th><th>Opening (W × D × H)</th><th>Sheet</th><th>Confirmed</th><th></th></tr></thead><tbody>';
    rows.forEach(function (row) {
      var r = row.rec, q = (row.model + " " + basisLabel(row)).toLowerCase() + " " + SW.normModel(row.model).toLowerCase();
      var hide = libFilter && q.indexOf(libFilter.toLowerCase()) < 0 && SW.normModel(row.model).indexOf(SW.normModel(libFilter)) < 0;
      var open = [r.w, r.d, r.h].map(function (v) { return v ? esc(SW.fmtIn(SW.num(v))) : "—"; }).join(" × ");
      var mx = r.max && (r.max.w || r.max.d || r.max.h) ? '<div class="table-sub">max ' + [r.max.w, r.max.d, r.max.h].map(function (v) { return v ? esc(SW.fmtIn(SW.num(v))) : "—"; }).join(" × ") + "</div>" : "";
      h += '<tr data-libq="' + esc(q) + '"' + (hide ? ' style="display:none"' : "") + '><td><div class="table-title">' + esc(row.model) + "</div></td>" +
        "<td>" + esc(basisLabel(row)) + "</td>";
      if (dimsEdit === row.key) {
        h += '<td colspan="3"><div class="sw-lib-dimsedit">' + ["w", "d", "h"].map(function (k) {
          return "<label>" + k.toUpperCase() + ' <input class="sw-input sw-num" data-dimsedit="' + k + '" value="' + esc(r[k] || "") + '" inputmode="decimal" placeholder="—"></label>';
        }).join("") + '<span class="table-sub">Inches, as on the sheet: 30 1/8 or 30.125. Saving records you as the person who checked it.</span></div></td>' +
          '<td><div class="inline-actions"><button class="button small" data-act="savedims" data-key="' + esc(row.key) + '">Save</button>' +
          '<button class="button small ghost" data-act="canceldims">Cancel</button></div></td></tr>';
        return;
      }
      h += '<td class="sw-num">' + (r.noOpening ? "no opening" : open) + mx + "</td>" +
        "<td>" + esc(r.sourceDoc || "—") + (r.pageNo ? '<div class="table-sub">p.' + esc(r.pageNo) + (r.sheetDate ? " · sheet dated " + esc(r.sheetDate) : "") + "</div>" : "") + "</td>" +
        "<td>" + esc(r.confirmedBy || r.typedBy || "—") + '<div class="table-sub">' + esc(ui.shortDate(String(r.confirmedAt || r.typedAt || "").slice(0, 10))) +
        (r.origin === "edited" ? " · corrected here" : "") + "</div></td>" +
        '<td><div class="inline-actions"><button class="button small ghost" data-act="editdims" data-key="' + esc(row.key) + '">Edit</button>' +
        '<button class="remove-button" data-act="removedims" data-key="' + esc(row.key) + '">Remove</button></div></td></tr>';
    });
    return h + "</tbody></table></div></div>";
  }

  function libraryPanel() {
    var models = SW.libModels();
    var h = '<div class="form-section"><div class="toolbar" style="margin:0 0 6px"><h2 style="margin:0">Spec library</h2>' +
      '<button class="button small ghost" data-act="addmodel">Add a model by hand</button></div>' +
      "<p>" + models.length + " models. An entry you add or correct here shadows the one that ships with the tool. " +
      "Sub-Zero, Wolf and Cove come from their design guides (Sub-Zero 1/2025, Wolf 7/2025, Cove 4/2026); the next most-sold models from their manufacturer sheets in the Oct 2026 Steel Cod books. Every detail carries the page its numbers came from.</p>" +
      '<input class="sw-input sw-lib-filter" data-libfilter="1" type="search" placeholder="Find a model — DEC3050, ice maker, wine, Classic…" value="' + esc(libFilter) + '">';
    h += '<div class="table-wrap"><table><thead><tr><th>Model</th><th>Brand</th><th>Installation details</th><th>Openings</th><th></th></tr></thead><tbody>';
    models.forEach(function (e) {
      var total = (e.variations || []).length;
      var done = (e.variations || []).filter(function (v) { return v.noOpening || SW.hasOpening(v); }).length;
      var complete = done === total;
      var q = [e.model, e.brand, e.appliance, e.category, e.source].filter(Boolean).join(" ").toLowerCase();
      var hide = libFilter && q.indexOf(libFilter.toLowerCase()) < 0 && SW.normModel(e.model).indexOf(SW.normModel(libFilter)) < 0;
      h += '<tr class="' + (complete ? "" : "row-attention") + '" data-libq="' + esc(q + " " + SW.normModel(e.model).toLowerCase()) + '"' + (hide ? ' style="display:none"' : "") + ">" +
        "<td><div class=\"table-title\">" + esc(e.model) + "</div>" +
        '<div class="table-sub">' + esc(e.appliance || "") + "</div></td>" +
        "<td>" + esc(e.brand || "—") +
        (SW.isEdited(e.model) ? '<div class="table-sub">' + (SW.isBuiltIn(e.model) ? "edited" : "added here") + "</div>" : "") + "</td>" +
        "<td>" + (e.variations || []).map(function (v) {
          return '<span class="badge ' + (v.noOpening || SW.hasOpening(v) ? "success" : "warning") + '">' +
            esc(v.label || v.key || "—") + "</span>";
        }).join(" ") + "</td>" +
        '<td class="sw-num">' + done + " / " + total + "</td>" +
        '<td><div class="inline-actions"><button class="button small ghost" data-act="editmodel" data-model="' + esc(e.model) + '">Edit</button>' +
        (SW.isEdited(e.model)
          ? '<button class="remove-button" data-act="resetmodel" data-model="' + esc(e.model) + '">' +
            (SW.isBuiltIn(e.model) ? "Revert" : "Delete") + "</button>"
          : "") + "</div></td></tr>";
    });
    return h + "</tbody></table></div></div>";
  }

  /* ---------------- the editor ---------------- */
  function editorPanel() {
    if (!draft) return "";
    var h = '<div class="form-section sw-editor"><div class="toolbar" style="margin:0 0 6px">' +
      '<h2 style="margin:0">' + (draftIsNew ? "New model" : "Editing " + esc(draft.model)) + "</h2>" +
      '<div class="inline-actions"><button class="button small ghost" data-act="canceledit">Cancel</button>' +
      '<button class="button small" data-act="savemodel">Save model</button></div></div>';
    h += '<div class="form-grid">' +
      f("Model number", "model", draft.model, "CL4850SID/O") +
      f("Brand", "brand", draft.brand, "Sub-Zero") +
      f("Appliance", "appliance", draft.appliance, "48\" side-by-side refrigerator") +
      f("Match prefix", "prefix", draft.prefix, "CL4850") +
      f("Category", "category", draft.category, "refrigeration") +
      f("Pages in the package", "pages", draft.pages, "pp.31–45") +
      "</div>" +
      '<p class="disclaimer">The match prefix is what a walk sheet matches on, so <code>CL4850</code> catches ' +
      "<code>CL4850SID/O</code> and <code>CL4850SID/S</code> alike. Category drives which correction chips the tech sees.</p>";

    (draft.variations || []).forEach(function (v, i) { h += variationEditor(v, i); });
    h += '<button class="button small ghost" style="margin-top:12px" data-act="addvariation">Add an installation detail</button>';
    return h + "</div>";
  }
  function f(label, key, val, ph) {
    return '<div class="field"><label>' + esc(label) + "</label>" +
      '<input data-d="' + key + '" value="' + esc(val || "") + '" placeholder="' + esc(ph || "") + '"></div>';
  }
  function variationEditor(v, i) {
    var h = '<div class="sw-var-edit"><div class="toolbar" style="margin:0 0 8px">' +
      '<strong>Installation detail ' + (i + 1) + "</strong>" +
      '<button class="remove-button" data-act="delvariation" data-i="' + i + '">Remove</button></div>' +
      '<div class="form-grid">' +
      vf("Label", i, "label", v.label, "Flush inset") +
      vf("Key", i, "key", v.key, "flush-inset") +
      vf("Page reference", i, "page", v.page, "p.33") +
      "</div>";
    h += '<div class="sw-queue-grid" style="margin-top:10px">' + SW.DIMS.map(function (d) {
      return '<label class="field"><span class="field-label">' + esc(d.label) + "</span>" +
        '<input class="sw-input sw-num" data-vi="' + i + '" data-vdim="' + d.k + '" placeholder="24 1/2" value="' +
        esc((v.opening || {})[d.k] || "") + '">' +
        '<select class="sw-input" data-vi="' + i + '" data-vrule="' + d.k + '">' +
        Object.keys(RULE_LABELS).map(function (r) {
          var sel = ((v.rule || {})[d.k] || (d.k === "w" ? "exact" : "min")) === r ? " selected" : "";
          return '<option value="' + r + '"' + sel + ">" + RULE_LABELS[r] + "</option>";
        }).join("") + "</select></label>";
    }).join("") + "</div>";
    h += '<label class="field full" style="margin-top:10px"><span class="field-label">What this looks like on site — one per line</span>' +
      '<textarea data-vi="' + i + '" data-vlist="tells" rows="2" placeholder="Finished cleats inside the opening">' +
      esc((v.tells || []).join("\n")) + "</textarea></label>";
    h += '<label class="field full"><span class="field-label">Builder actions this detail always requires — one per line</span>' +
      '<textarea data-vi="' + i + '" data-vlist="requires" rows="2">' + esc((v.requires || []).join("\n")) + "</textarea></label>";
    h += '<label class="field full"><span class="field-label">Note printed under the basis block</span>' +
      '<textarea data-vi="' + i + '" data-vfield="notes" rows="2">' + esc(v.notes || "") + "</textarea></label>";
    h += '<label class="sw-nocheck"><input type="checkbox" data-vi="' + i + '" data-vflag="noOpening"' +
      (v.noOpening ? " checked" : "") + "> No rough opening — freestanding or countertop</label>";
    return h + "</div>";
  }
  function vf(label, i, key, val, ph) {
    return '<div class="field"><label>' + esc(label) + "</label>" +
      '<input data-vi="' + i + '" data-vfield="' + key + '" value="' + esc(val || "") + '" placeholder="' + esc(ph || "") + '"></div>';
  }

  /* ---------------- render ---------------- */
  function render(rerender) {
    /* the first time the screen opens, take what everybody else changed */
    if (!synced && rerender && SW.libraryState().shared) {
      synced = true; syncing = true;
      SW.syncLibrary().then(function () { syncing = false; rerender(); });
    }
    var queue = SW.openingQueue();
    var h = '<div class="page-title"><div class="toolbar" style="margin:0">' +
      '<div><span class="eyebrow dark">Spec library</span><h1>Models and installation details</h1>' +
      '<p style="margin:6px 0 0;color:var(--muted)">Openings are entered once here and reused on every walk.</p></div>' +
      '<div class="inline-actions"><a class="button ghost" href="' + SW.nav("office") + '">← Site walks</a></div>' +
      "</div></div>";
    h += '<div class="section"><div class="metric-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
      '<div class="metric-card"><div class="label">Models</div><div class="value">' + SW.libModels().length + "</div></div>" +
      '<div class="metric-card"><div class="label">Installation details</div><div class="value">' +
      SW.libModels().reduce(function (n, e) { return n + (e.variations || []).length; }, 0) + "</div></div>" +
      '<div class="metric-card"><div class="label">Openings still needed</div><div class="value' +
      (queue.length ? " tone-warning" : "") + '">' + queue.length + "</div></div></div></div>";
    h += '<div class="section">' + shareLine() + bookCard() + importCard() + editorPanel() + queuePanel() + confirmedPanel() + libraryPanel() + "</div>";
    return h;
  }

  /* ---------------- events ---------------- */
  function rowOf(id) {
    var parts = String(id).split("|");
    var entry = SW.libModels().filter(function (e) { return SW.normModel(e.model) === parts[0]; })[0];
    if (!entry) return null;
    var v = (entry.variations || []).filter(function (x) { return x.key === parts[1]; })[0];
    return v ? { entry: entry, variation: v } : null;
  }
  function readQueueRow(host, id) {
    var out = { opening: {}, rule: {} };
    host.querySelectorAll('[data-q="' + CSS.escape(id) + '"]').forEach(function (el) {
      if (el.hasAttribute("data-dim")) out.opening[el.getAttribute("data-dim")] = el.value.trim();
      if (el.hasAttribute("data-rule")) out.rule[el.getAttribute("data-rule")] = el.value;
    });
    return out;
  }
  function persist(entry) {
    var copy = deep(entry);
    SW.saveModel(copy);
    return copy;
  }

  function handle(act, t, host, rerender) {
    if (act === "editdims") { dimsEdit = t.getAttribute("data-key") || ""; rerender(); return true; }
    if (act === "canceldims") { dimsEdit = ""; rerender(); return true; }
    if (act === "savedims" || act === "removedims") {
      var dk = t.getAttribute("data-key") || "", drow = dimsRows().filter(function (x) { return x.key === dk; })[0];
      if (!drow) return true;
      if (act === "removedims") {
        SW.forgetDims(drow.model, drow.basis);
        ui.toast("Removed", drow.model + " will be read off its sheet again next time.");
        rerender(); return true;
      }
      var next = {}, bad = "";
      host.querySelectorAll("[data-dimsedit]").forEach(function (el) {
        var k = el.getAttribute("data-dimsedit"), raw = el.value.trim();
        if (raw && SW.num(raw) == null) bad = raw;
        next[k] = raw && SW.num(raw) != null ? SW.fmtFrac(SW.num(raw)) : "";
      });
      if (bad) { ui.toast("Not a measurement", '"' + bad + '" — type inches as on the sheet, like 30 1/8 or 30.125.'); return true; }
      var who = SW.hasGate && SW.hasGate() && SW.sessionUser ? SW.sessionUser() : null, name = (who && who.displayName) || "";
      SW.rememberDims(drow.model, drow.basis, Object.assign({}, drow.rec, next, {
        by: name || drow.rec.typedBy || "", confirmedBy: name || drow.rec.confirmedBy || "", confirmedAt: SW.isoNow(), origin: "edited"
      }));
      dimsEdit = "";
      ui.toast("Saved", drow.model + " — the corrected numbers are the library's from now on.");
      rerender(); return true;
    }
    if (act === "clearimport") { lastImport = null; rerender(); return true; }

    if (act === "adoptmodels" && lastImport && lastImport.ok) {
      var res = adopt(lastImport);
      ui.toast("Library updated", res.added + " added, " + res.updated + " updated. " +
        SW.openingQueue().length + " openings still to enter.");
      lastImport = null; rerender(); return true;
    }

    if (act === "usecutout") {
      var cid = t.getAttribute("data-row");
      ["w", "h", "d"].forEach(function (k) {
        var val = t.getAttribute("data-" + k), inp = host.querySelector('[data-q="' + CSS.escape(cid) + '"][data-dim="' + k + '"]');
        if (inp && val) inp.value = SW.fmtFrac(SW.num(val));
      });
      return true;
    }
    if (act === "usepropose") {
      var pid = t.getAttribute("data-row");
      var input = host.querySelector('[data-q="' + CSS.escape(pid) + '"][data-dim="' + t.getAttribute("data-dim") + '"]');
      if (input) input.value = t.getAttribute("data-v");
      return true;
    }

    if (act === "savequeue") {
      var id = t.getAttribute("data-row"), row = rowOf(id);
      if (!row) return true;
      var vals = readQueueRow(host, id);
      var filled = SW.DIMS.filter(function (d) { return vals.opening[d.k]; }).length;
      if (!filled) { ui.toast("Nothing entered", "Type at least one dimension, or mark it as having no rough opening."); return true; }
      var bad = SW.DIMS.filter(function (d) { return vals.opening[d.k] && SW.num(vals.opening[d.k]) == null; });
      if (bad.length) { ui.toast("Could not read that", bad[0].label + ' should look like 24, 24 1/2 or 23.5.'); return true; }
      var entry = deep(row.entry);
      var v = entry.variations.filter(function (x) { return x.key === row.variation.key; })[0];
      SW.DIMS.forEach(function (d) {
        v.opening[d.k] = vals.opening[d.k] ? SW.fmtFrac(SW.num(vals.opening[d.k])) : "";
        v.rule[d.k] = vals.rule[d.k] || v.rule[d.k];
      });
      delete v.proposed; delete v.sheetCutouts;
      persist(entry);
      ui.toast("Opening saved", entry.model + " · " + v.label + " — " + SW.openingText(v));
      rerender(); return true;
    }

    if (act === "noopening") {
      var nid = t.getAttribute("data-row"), nrow = rowOf(nid);
      if (!nrow) return true;
      var ne = deep(nrow.entry);
      var nv = ne.variations.filter(function (x) { return x.key === nrow.variation.key; })[0];
      nv.noOpening = true; nv.opening = { w: "", d: "", h: "" };
      persist(ne);
      ui.toast("Marked", ne.model + " · " + nv.label + " has no rough opening.");
      rerender(); return true;
    }

    if (act === "addmodel") { draft = SW.blankModelEntry(); draftIsNew = true; rerender(); return true; }
    if (act === "editmodel") {
      var m = SW.libModels().filter(function (e) { return e.model === t.getAttribute("data-model"); })[0];
      if (!m) return true;
      draft = deep(m); draftIsNew = false;
      draft.variations = draft.variations || [SW.blankVariation()];
      rerender(); return true;
    }
    if (act === "canceledit") { draft = null; rerender(); return true; }
    if (act === "addvariation" && draft) { draft.variations.push(SW.blankVariation()); rerender(); return true; }
    if (act === "delvariation" && draft) {
      draft.variations.splice(+t.getAttribute("data-i"), 1);
      if (!draft.variations.length) draft.variations.push(SW.blankVariation());
      rerender(); return true;
    }
    if (act === "savemodel" && draft) {
      if (!String(draft.model).trim()) { ui.toast("Model number required", "The library is keyed on it."); return true; }
      draft.variations = draft.variations.filter(function (v) { return String(v.label || v.key).trim(); });
      draft.variations.forEach(function (v) {
        if (!v.key) v.key = String(v.label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        SW.DIMS.forEach(function (d) {
          var n = SW.num(v.opening[d.k]);
          v.opening[d.k] = n == null ? "" : SW.fmtFrac(n);
        });
      });
      if (!draft.variations.length) draft.variations = [SW.blankVariation()];
      if (!draft.prefix) draft.prefix = String(draft.model).replace(/[\/\-].*$/, "");
      persist(draft);
      ui.toast("Model saved", draft.model + " is in the library.");
      draft = null; rerender(); return true;
    }
    if (act === "resetmodel") {
      var name = t.getAttribute("data-model");
      if (t.dataset.armed !== "1") { t.dataset.armed = "1"; t.textContent = "Tap again"; return true; }
      SW.removeModel(name);
      ui.toast(SW.isBuiltIn(name) ? "Reverted" : "Deleted", name);
      rerender(); return true;
    }
    return false;
  }

  function onInput(e) {
    var el = e.target;
    if (el.hasAttribute && el.hasAttribute("data-libfilter")) {
      libFilter = el.value;
      var q = libFilter.toLowerCase().trim(), qn = SW.normModel(libFilter).toLowerCase();
      Array.prototype.forEach.call(document.querySelectorAll("tr[data-libq]"), function (tr) {
        var t = tr.getAttribute("data-libq");
        tr.style.display = !q || t.indexOf(q) >= 0 || (qn && t.indexOf(qn) >= 0) ? "" : "none";
      });
      return true;
    }
    if (!draft) return false;
    if (el.hasAttribute("data-d")) { draft[el.getAttribute("data-d")] = el.value; return true; }
    if (el.hasAttribute("data-vi")) {
      var v = draft.variations[+el.getAttribute("data-vi")];
      if (!v) return true;
      if (el.hasAttribute("data-vfield")) v[el.getAttribute("data-vfield")] = el.value;
      else if (el.hasAttribute("data-vlist")) v[el.getAttribute("data-vlist")] = el.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
      else if (el.hasAttribute("data-vdim")) v.opening[el.getAttribute("data-vdim")] = el.value;
      else if (el.hasAttribute("data-vrule")) v.rule[el.getAttribute("data-vrule")] = el.value;
      else if (el.hasAttribute("data-vflag")) v[el.getAttribute("data-vflag")] = el.checked;
      return true;
    }
    return false;
  }

  function upload(files, rerender) {
    if (!IMPORT_URL) return;
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return /\.pdf$/i.test(f.name); });
    if (!list.length) { ui.toast("Not a PDF", "Choose the Full Spec Package PDF."); return; }
    busy = true; lastImport = null; rerender();
    var data = new FormData();
    list.forEach(function (f) { data.append("files", f, f.name); });
    fetch(IMPORT_URL, { method: "POST", body: data })
      .then(function (r) { return r.json().catch(function () { throw new Error("bad response"); }); })
      .then(function (res) {
        busy = false;
        lastImport = res && res.ok ? res : { error: (res && res.error) || "The package could not be parsed." };
        rerender();
      })
      .catch(function () {
        busy = false;
        lastImport = { unavailable: true };
        rerender();
      });
  }

  window.WILSON_SW_LIBRARY = { render: render, handle: handle, onInput: onInput, upload: upload };
})();

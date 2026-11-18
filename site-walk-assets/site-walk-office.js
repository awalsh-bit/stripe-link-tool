/* =============================================================
   Wilson Site Walk — office
   The queue, the job record, the Steel Cod load, and the coverage
   check that stops a model in the spec book going unwalked.
   ============================================================= */
(function () {
  "use strict";
  var SW = window.WILSON_SW;
  var ui = window.WilsonUI;
  var esc = function (v) { return ui.escapeHtml(v); };

  var HOST = null, walkId = null, view = "queue";
  var STAGE_BADGE = {
    setup: "", "ready-to-walk": "info", "in-field": "info", "ready-to-send": "warning", sent: "success"
  };

  function walk() { return SW.walk(walkId); }
  function route() {
    var h = (location.hash || "").replace(/^#\/?/, "").split("/");
    if (h[0] !== "office") return;
    if (h[1] === "library") { walkId = null; view = "library"; return; }
    walkId = h[1] || null;
    view = walkId ? (h[2] || "walk") : "queue";
  }
  function go(hash) { SW.goto(hash); }

  /* ---------------- queue ---------------- */

  /* ---------------- what the shop server holds ----------------
     The queue below is this device's walks. The server panel is every
     device's walks — the phone in the truck included — read back from the
     portal. It renders only when the portal answers, so the single-file
     artifact build quietly shows nothing. */
  var serverWalks = null;        /* null = not asked / not available */
  var signedOut = false;         /* the server answered 401: show the sign-in banner */
  var serverSig = "", renderPending = false;
  /* repaint now, unless somebody is in a field — then as soon as they leave it */
  function softRender() {
    var a = document.activeElement;
    if (a && HOST && HOST.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { renderPending = true; return; }
    renderPending = false; render();
  }
  var mergeSel = [];             /* setup: openings ticked to merge into one */
  function fetchServerWalks() {
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    fetch(SW.apiUrl("walks", "/api/sitewalk/walks"), { credentials: "same-origin" })
      .then(function (r) {
        /* Signed out of this computer's server: the page itself may be an
           old copy the browser kept, so say so plainly instead of quietly
           showing nothing (v0.9.77). */
        if (r.status === 401 || r.status === 403 || (r.redirected && /\/login/.test(r.url || ""))) {
          signedOut = true; render(); return null;
        }
        return r.ok ? r.json() : null;
      })
      .then(function (body) {
        if (!body || !body.ok) return;
        /* v0.9.83: on a timer this must not repaint under somebody's typing,
           and need not repaint at all when nothing moved. Walks held here that
           the server has newer (a phone measuring right now) are brought up to
           date first, so the queue, the review panel and an open walk all show
           the field's work as it lands. */
        var sig = JSON.stringify(body.walks || []), moved = sig !== serverSig || signedOut;
        signedOut = false; serverWalks = body.walks || []; serverSig = sig;
        SW.setServerRows(serverWalks);
        SW.adoptNewer(serverWalks).then(function (n) { if (moved || n) softRender(); });
      })
      .catch(function () { });
  }
  function signedOutBanner() {
    if (!signedOut) return "";
    var next = encodeURIComponent(location.pathname + location.search + location.hash);
    return '<div class="section"><div class="card card-pad sw-signedout" role="alert" ' +
      'style="border:2px solid #b42318;background:#fff4f2">' +
      '<span class="sw-label" style="color:#b42318">Signed out of this computer\'s server</span>' +
      '<p style="margin:6px 0 10px">Nothing you import or walk is being saved, and this page may be an older ' +
      'copy your browser kept. Sign in with the shop passcode, then this page reloads at the current version.</p>' +
      '<a class="button primary" href="' + esc(SW.apiUrl("login", "/login")) + "?next=" + next + '">Sign in</a></div></div>';
  }
  /* v0.9.83 — launching the walk on a phone. Once the desk has finished
     (every opening has its spec and its install type) the walk is ready, and
     "launch" is nothing more than opening its link on the phone: the phone
     fetches the walk, keeps its own copy and starts on the first opening.
     Shown where there is a server behind the page to fetch it from. */
  function launchQr(text) {
    if (!text || typeof window.qrcode !== "function") return "";
    try {
      var q = window.qrcode(0, "M"); q.addData(text); q.make();
      var n = q.getModuleCount(), d = "";
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
      return '<svg class="sw-launch-qr" viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges" role="img" aria-label="QR code for the walk link">' +
        '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    } catch (e) { return ""; }
  }
  function launchLink(w) {
    var path = SW.nav("field", w.id);
    if (path.charAt(0) === "#") return location.origin + location.pathname.replace(/[^/]*$/, "") + "site-walk.html?walk=" + encodeURIComponent(w.id);
    return location.origin + location.pathname.replace(/[^/]*$/, "") + path.replace(/^\//, "");
  }
  function launchPanel(w, st) {
    if (!SW.hasPortal() || !w.items.length) return "";
    if (st.code !== "ready-to-walk" && st.code !== "in-field") return "";
    var held = (w.items || []).filter(function (it) { return SW.basisPending(it); }).length;
    var link = launchLink(w), live = st.code === "in-field";
    return '<div class="section"><div class="card card-pad sw-launch">' +
      '<div class="sw-launch-main"><span class="sw-label">' + (live ? "In the field" : "Ready to walk") + "</span>" +
      "<strong>" + (live ? "This walk is being measured — it fills in here as the phone sends it"
                         : "Open this walk on a phone to start") + "</strong>" +
      "<p>" + (held ? held + " opening" + (held === 1 ? " still needs" : "s still need") + " an install type picked — the phone will ask. "
                     : "") +
      "Point the phone's camera at the code, or send the link. The phone keeps its own copy of the walk and the install sheets, so it carries on with no signal and catches up when it has one.</p>" +
      '<div class="inline-actions"><a class="button" href="' + esc(link) + '">Open the walk</a>' +
      '<button class="button ghost" data-act="copylaunch" data-link="' + esc(link) + '">Copy the link</button></div></div>' +
      launchQr(link) + "</div></div>";
  }
  function serverPanel() {
    if (!serverWalks) return "";
    var h = '<div class="section"><div class="card card-pad">' +
      '<span class="sw-label">On ' + esc(SW.apiUrl("serverName", "the shop server")) + " <em>" + serverWalks.length +
      " walk" + (serverWalks.length === 1 ? "" : "s") + " · every device</em></span>";
    if (!serverWalks.length) {
      return h + '<p style="margin:6px 0 0;color:var(--muted);font-size:13px">Nothing synced yet. ' +
        "A walk lands here on its own as soon as the phone that holds it has signal.</p></div></div>";
    }
    h += '<table class="admin-table" style="margin-top:8px"><thead><tr>' +
      "<th>Job</th><th>Walked by</th><th>Openings</th><th>Stage</th><th>Access</th><th>Last sync</th>" +
      "</tr></thead><tbody>";
    serverWalks.slice(0, 12).forEach(function (w) {
      var counts = w.WalkedCount + " of " + w.OpeningCount + " walked";
      var flags = [];
      if (w.ModifyCount) flags.push(w.ModifyCount + " modify");
      if (w.DecisionCount) flags.push(w.DecisionCount + " decision");
      var access = w.AccessRoute ? (w.AccessState || "") : "not recorded";
      var here = !!SW.walk(w.ClientWalkId);
      h += '<tr><td><a class="sw-server-open" href="' + esc(SW.nav(w.StageCode === "ready-to-send" || w.StageCode === "sent" ? "packet" : "office", w.ClientWalkId)) + '"><strong>' + esc(w.ProjectName || w.JobNo || "—") + "</strong></a>" +
        (SW.liveMs() && !here ? ' <span style="font-size:11px;color:var(--muted-2)">· opens from the server</span>' : "") +
        (w.JobNo ? '<div style="font-size:11px;color:var(--muted-2)">' + esc(w.JobNo) + "</div>" : "") + "</td>" +
        "<td>" + esc(w.WalkedByNameSnapshot || "—") + "</td>" +
        "<td>" + esc(counts) + (flags.length ? '<div style="font-size:11px;color:var(--warning)">' + esc(flags.join(" · ")) + "</div>" : "") + "</td>" +
        "<td>" + esc(w.StageCode || "") + (w.SignedOffAt ? '<div style="font-size:11px;color:var(--success)">signed off' + (w.SignedOffBy ? " · " + esc(w.SignedOffBy) : "") + "</div>" : "") + "</td>" +
        "<td>" + esc(access) + "</td>" +
        "<td>" + esc(String(w.LastSyncedAt || "").slice(0, 16).replace("T", " ")) + "</td></tr>";
    });
    return h + "</tbody></table></div></div>";
  }

  /* Walks the field finished that nobody has reviewed and sent. This is the
     salesperson's inbox: the walk started from their spec package and it
     comes back to them before a builder sees it. */
  function reviewPanel(list) {
    var due = list.filter(function (w) {
      return SW.stage(w).code === "ready-to-send" && !w.sentAt;
    });
    if (!due.length) return "";
    return '<div class="section"><div class="sw-review-panel">' +
      '<div class="sw-review-head"><span class="sw-review-dot">' + due.length + "</span>" +
      "<div><strong>Walk" + (due.length > 1 ? "s" : "") + " back from the field — review before it goes out</strong>" +
      "<p>Check the punch list, the photos and the notes, then send it to the jobsite contact from the packet page.</p></div></div>" +
      '<div class="sw-review-list">' + due.map(function (w) {
        var r = SW.rollup(w);
        return '<a href="' + SW.nav("packet", w.id) + '">' +
          "<span><strong>" + esc(w.project || w.jobNo || "Untitled") + "</strong>" +
          "<em>" + esc([w.walkedBy && "walked by " + w.walkedBy, r.attention.length + " builder action" + (r.attention.length === 1 ? "" : "s")].filter(Boolean).join(" · ")) + "</em></span>" +
          "<b>Review &amp; send →</b></a>";
      }).join("") + "</div></div></div>";
  }

  function queue() {
    var list = SW.walks();
    var PKG = window.WILSON_SW_SPECPKG;
    if (PKG && PKG.active() && !(PKG.isLibrary && PKG.isLibrary())) return PKG.wizard();

    var h = '<div class="page-title"><div class="toolbar" style="margin:0">' +
      "<div><h1>Site walks</h1>" +
      '<p style="margin:6px 0 0;color:var(--muted)">Jobsite readiness verification before appliance delivery.</p></div>' +
      '<div class="inline-actions">' +
      '<a class="button ghost" href="#/office/library">Spec library' + libraryBadge() + "</a>" +
      '<button class="button ghost" data-act="newwalk">Blank walk</button></div></div></div>';

    h += reviewPanel(list);
    h += '<div class="section">' + (PKG ? PKG.startCard() : "") + "</div>";
    /* room left on this browser — the walks' travel copies of the install
       sheets fill localStorage (about 5 MB) after a few test builds, and
       a walk that cannot save is "gone" on the next screen (22 Oct) */
    var sst = SW.storageState();
    if (sst.full || sst.bytes > 3 * 1048576) {
      h += '<div class="callout ' + (sst.full ? "danger" : "warning") + '"><strong>' +
        (sst.full ? "This browser is out of room — the last change was not saved." : "This browser is nearly out of room.") + "</strong>" +
        "It holds about " + (sst.bytes / 1048576).toFixed(1) + " MB of walks; the browser allows roughly 5. " +
        "Delete finished or test walks below (the shop server keeps what was sent) before creating another.</div>";
    }

    if (!list.length) {
      h += serverPanel();
      h += '<div class="section"><div class="card card-pad empty-state">' +
        "<h2 style=\"font-size:19px\">Nothing scheduled</h2>" +
        "<p>Drop the job's spec package above and the walk builds itself, or start a blank walk and paste the specs by hand.</p>" +
        (SW.hasDemo()
          ? '<p style="margin:14px 0 0;font-size:12.5px;color:var(--muted-2)">' +
            "Want to see a finished one first? " +
            '<button class="link-button" data-act="loaddemo">Load the example walk</button>' +
            " — it is stamped EXAMPLE and carries last August's measurements, so never send it to a builder.</p>"
          : "") +
        "</div></div>";
      return h;
    }

    h += serverPanel();
    var att = list.reduce(function (n, w) { return n + SW.rollup(w).attention.length; }, 0);
    var blocked = list.reduce(function (n, w) { return n + SW.rollup(w).blockers.length; }, 0);
    var toSend = list.filter(function (w) { return SW.stage(w).code === "ready-to-send"; }).length;
    h += '<div class="section"><div class="metric-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
      metric("Open walks", list.filter(function (w) { return !w.sentAt; }).length, "") +
      metric("Ready to send", toSend, toSend ? "warning" : "") +
      metric("Builder actions", att, att ? "warning" : "") +
      metric("Basis conflicts", blocked, blocked ? "danger" : "") +
      "</div></div>";

    h += '<div class="section">' +
      (SW.liveMs() ? '<p class="sw-held-here">Open on this computer <em>the walks you have opened here — everything else is in the list above and opens with a click</em></p>' : "") +
      '<div class="table-card"><div class="table-wrap"><table>' +
      "<thead><tr><th>Project</th><th>Job</th><th>Builder</th><th>Walk date</th><th>Stage</th><th>Readiness</th><th>Openings</th><th></th></tr></thead><tbody>";
    list.forEach(function (w) {
      var st = SW.stage(w), r = SW.rollup(w);
      var bad = r.blockers.length || r.counts.modify || r.counts.decision;
      h += '<tr class="' + (bad ? "row-attention" : "") + '">' +
        '<td><div class="table-title">' + esc(w.project || "Untitled project") + "</div>" +
        (w.address ? '<div class="table-sub">' + esc(w.address) + "</div>" : "") + "</td>" +
        "<td>" + esc(w.jobNo || "—") + "</td>" +
        "<td>" + esc(w.builder || "—") + "</td>" +
        "<td>" + ui.shortDate(w.walkDate) + "</td>" +
        '<td><span class="badge ' + (STAGE_BADGE[st.code] || "") + '">' + esc(st.label) + "</span></td>" +
        "<td>" + readinessCell(r) + "</td>" +
        '<td class="sw-num">' + r.done + " / " + r.total + "</td>" +
        '<td><div class="inline-actions">' +
        '<a class="button small ghost" href="' + SW.nav("field", w.id) + '">Field</a>' +
        '<a class="button small ghost" href="' + SW.nav("office", w.id) + '">Setup</a>' +
        (r.total ? '<a class="button small" href="' + SW.nav("packet", w.id) + '">Packet</a>' : "") +
        "</div></td></tr>";
    });
    h += "</tbody></table></div></div></div>";
    return h;
  }
  function libraryBadge() {
    var n = SW.openingQueue ? SW.openingQueue().length : 0;
    return n ? ' <span class="badge warning">' + n + "</span>" : "";
  }
  function metric(label, value, tone) {
    return '<div class="metric-card"><div class="label">' + esc(label) + "</div>" +
      '<div class="value' + (tone ? " tone-" + tone : "") + '">' + value + "</div></div>";
  }
  function readinessCell(r) {
    if (!r.total) return '<span class="badge">No openings</span>';
    var bits = [];
    if (r.counts.ready) bits.push('<span class="badge success">' + r.counts.ready + " ready</span>");
    if (r.counts.verify) bits.push('<span class="badge info">' + r.counts.verify + " verify</span>");
    if (r.counts.modify) bits.push('<span class="badge warning">' + r.counts.modify + " modify</span>");
    if (r.counts.decision) bits.push('<span class="badge danger">' + r.counts.decision + " decision</span>");
    if (r.counts.held) bits.push('<span class="badge warning">' + r.counts.held + " under review</span>");
    if (r.counts.open) bits.push('<span class="badge">' + r.counts.open + " open</span>");
    return '<div class="sw-badges">' + bits.join("") + "</div>";
  }

  /* ---------------- walk setup ---------------- */
  function field(label, key, val, ph, wide) {
    return '<div class="field' + (wide ? " full" : "") + '"><label for="f-' + key + '">' + esc(label) + "</label>" +
      '<input id="f-' + key + '" data-field="' + key + '" value="' + esc(val || "") + '" placeholder="' + esc(ph || "") + '"></div>';
  }

  function setup() {
    var w = walk();
    if (!w) {
      var sst = SW.storageState();
      return '<div class="card card-pad"><p style="margin:0 0 8px"><strong>That walk is not on this device.</strong></p>' +
        '<p style="margin:0 0 8px;color:var(--muted)">It was deleted, or it was created while this browser was out of room and never saved' +
        (sst.full || sst.bytes > 3.5 * 1048576 ? " — this browser holds about " + (sst.bytes / 1048576).toFixed(1) + " MB of walks, and the limit is roughly 5. Delete finished or test walks from the queue and create it again." : ".") +
        '</p><a href="' + SW.nav("office") + '">Back to the queue</a></div>';
    }
    var PKG = window.WILSON_SW_SPECPKG;
    if (PKG && PKG.editing && PKG.editing()) return PKG.wizard();     /* "Edit the spec" on one opening */
    var r = SW.rollup(w), st = SW.stage(w);

    var h = '<div class="page-title"><div class="toolbar" style="margin:0">' +
      '<div><span class="eyebrow dark">Site walk setup</span>' +
      "<h1>" + esc(w.project || "Untitled project") + "</h1>" +
      '<p style="margin:6px 0 0;color:var(--muted)">' + esc([w.jobNo, w.builder].filter(Boolean).join("  ·  ") || "Fill in the job record below") + "</p></div>" +
      '<div class="inline-actions"><span class="badge ' + (STAGE_BADGE[st.code] || "") + '">' + esc(st.label) + "</span>" +
      '<a class="button ghost" href="' + SW.nav("office") + '">← Queue</a>' +
      '<a class="button ghost" href="#/office/library">Spec library' + libraryBadge() + "</a>" +
      '<a class="button secondary" href="' + SW.nav("field", w.id) + '">Open field tool</a>' +
      (r.total ? '<a class="button" href="' + SW.nav("packet", w.id) + '">Packet</a>' : "") +
      "</div></div></div>";

    h += launchPanel(w, st);
    h += '<div class="section"><div class="split-layout"><div class="stack">';

    if (r.held && r.held.length) {
      h += '<div class="callout warning"><strong>' + r.held.length + " opening" + (r.held.length === 1 ? "" : "s") + " sent back by the installer — the packet is a draft until you settle " + (r.held.length === 1 ? "it" : "them") + ".</strong> " +
        r.held.map(function (it) { return esc(SW.rowTitle(it)) + " (" + esc(SW.specDoubtOf(it).note) + ")"; }).join("; ") +
        ". Check the sheet, correct the required dimensions in the table below if they are wrong, then press <em>Confirmed against the sheet</em>.</div>";
    }

    /* job record */
    h += '<div class="form-section"><h2>Job record</h2>' +
      "<p>Everything here prints on the packet the builder receives.</p>" +
      '<div class="form-grid">' +
      field("Project", "project", w.project, "1415 Palomino") +
      field("Job / order no.", "jobNo", w.jobNo, "S00063887") +
      field("Builder", "builder", w.builder) +
      field("Builder contact", "builderContact", w.builderContact) +
      field("Builder email", "builderEmail", w.builderEmail, "name@builder.com") +
      field("Address", "address", w.address) +
      field("Walk date", "walkDate", w.walkDate, "YYYY-MM-DD") +
      field("Walked by", "walkedBy", w.walkedBy) +
      field("Salesperson", "salesName", w.salesName) +
      field("Salesperson email", "salesEmail", w.salesEmail, "name@wilsonappliance.com") +
      field("Installer (cavity sheet contact)", "installerName", w.installerName, "Hudson") +
      field("Installer phone", "installerPhone", w.installerPhone, "512-000-0000") +
      field("Spec basis", "specSource", w.specSource, "Steel Cod Full Spec Package") +
      '<div class="field full"><label for="f-note">Cover note</label>' +
      '<textarea id="f-note" data-field="note" placeholder="One sentence of context for the builder.">' + esc(w.note || "") + "</textarea></div>" +
      "</div></div>";

    /* spec package import — the normal path */
    if (!w.items.length && window.WILSON_SW_SPECPKG) {
      h += window.WILSON_SW_SPECPKG.startCard(true);
    }

    /* manual paste tools — the fallback when there is no clean PDF */
    h += '<details class="sw-manual-tools"' + (w.items.length ? "" : "") + '><summary>Manual tools — paste the contents or spec lines by hand</summary>';

    /* spec package contents */
    h += '<div class="form-section"><h2>Spec package contents</h2>' +
      "<p>Paste the <strong>Contents</strong> block from the front of the Steel Cod Full Spec Package — model numbers and page ranges. The walk gets checked against this, so nothing in the spec book goes unwalked.</p>" +
      '<div class="field full"><textarea id="sw-contents" class="sw-mono" rows="6" placeholder="DEU2450CI/L    4-7&#10;DW2451    8-17&#10;SPO3050TE/S/T    18-21">' +
      esc((w.packageModels || []).map(function (p) { return p.model + "  " + String(p.pages || "").replace(/^pp\./, ""); }).join("\n")) +
      "</textarea></div>" +
      '<div class="inline-actions" style="margin-top:12px">' +
      '<button class="button small" data-act="readcontents">Read the contents</button>' +
      (w.items.length ? "" : '<button class="button small secondary" data-act="buildfromcontents">Build the walk sheet from it</button>') +
      "</div></div>";

    /* steel cod rows */
    h += '<div class="form-section"><h2>Load the spec lines</h2>' +
      "<p>Paste the export straight out of a spreadsheet — tab, comma or pipe separated, header row included. Labelled dimensions like <code>24 W x 25 D x 33 H</code> are read by their letter, so column order does not matter.</p>" +
      '<div class="field full"><textarea id="sw-import" class="sw-mono" rows="6" placeholder="Area | Location | Brand | Model | Appliance | Install | Spec W x D x H | Ref"></textarea></div>' +
      '<div class="inline-actions" style="margin-top:12px">' +
      '<button class="button small" data-act="import">Add these openings</button>' +
      '<button class="button small ghost" data-act="importreplace">Replace all</button>' +
      '<button class="button small ghost" data-act="importsample">Paste an example</button>' +
      "</div></div></details>";

    /* openings */
    if (w.items.length) {
      var picked = mergeSel.map(function (id) { return SW.item(w, id); }).filter(Boolean);
      var mergeWhy = picked.length ? SW.canMerge(picked) : "Tick two to four units that share one cavity.";
      /* columns in the same area: offered as one merge, one tap, never done unasked */
      var sugg = SW.suggestMerges(w);
      h += sugg.map(function (g) {
        var names = g.items.map(function (x) { return (x.model || SW.itemTitle(x)) + (x.spec && x.spec.w ? " (" + SW.fmtIn(x.spec.w) + ")" : ""); }).join(" + ");
        return '<div class="callout info sw-merge-suggest" data-ids="' + esc(g.ids.join(",")) + '"><strong>' + g.items.length + " columns in " + esc(g.area || "the same area") + "</strong> — " + esc(names) +
          ". Columns side by side almost always share one cavity with a kit between them. " +
          '<span class="inline-actions" style="display:inline-flex;gap:8px;margin-left:6px;vertical-align:middle"><button class="button small" data-act="mergesuggest" data-ids="' + esc(g.ids.join(",")) + '">Merge into one opening</button>' +
          '<button class="button small ghost" data-act="mergedismiss" data-ids="' + esc(g.ids.join(",")) + '">Keep them separate</button></span></div>';
      }).join("");
      h += '<div class="table-card"><div class="toolbar" style="padding:16px 18px 0;margin:0">' +
        "<div><strong>Openings</strong> <span class=\"table-sub\">" + w.items.length + " on the walk sheet</span></div>" +
        '<div class="inline-actions">' +
        (picked.length ? '<span class="table-sub">' + esc(mergeWhy || picked.map(function (x) { return x.model || SW.itemTitle(x); }).join(" + ")) + "</span>" : "") +
        '<button class="button small' + (mergeWhy ? " ghost" : "") + '" data-act="mergego"' + (mergeWhy ? " disabled" : "") + ">Merge " + (picked.length > 1 ? picked.length + " " : "") + "into one opening</button>" +
        '<button class="button small ghost" data-act="additem">Add an opening</button></div></div>' +
        '<div class="table-wrap"><table><thead><tr><th title="tick units that share one cavity">Merge</th><th>Area / location</th><th>Appliance</th><th>Basis</th><th>Required opening</th><th>Field</th><th>Status</th><th></th></tr></thead><tbody>';
      w.items.forEach(function (it) {
        var v = SW.itemVariation(it), fl = SW.itemFlags(it), s = SW.statusOf(it);
        var isM = SW.isMerge(it);
        h += '<tr class="' + (fl.length ? "row-attention" : "") + '">' +
          "<td>" + (isM ? '<span class="badge info">Merged</span>' :
            '<input type="checkbox" data-act="mergepick" data-id="' + it.id + '"' + (mergeSel.indexOf(it.id) >= 0 ? " checked" : "") + (!SW.isRefrigeration(it) ? ' disabled title="Only refrigeration merges"' : SW.basisPending(it) ? ' disabled title="Choose the install basis first"' : "") + ">") + "</td>" +
          "<td><div class=\"table-title\">" + esc(it.area || "—") + "</div><div class=\"table-sub\">" + esc(it.location || "") + "</div></td>" +
          "<td><div class=\"table-title\">" + esc(SW.itemTitle(it)) + "</div><div class=\"table-sub\">" + esc([it.brand, it.model].filter(Boolean).join(" ")) + "</div>" +
          (isM ? '<div class="table-sub" style="margin-top:4px">' + esc(SW.mergeUnits(it).map(function (u, i) { return SW.unitPos(i, SW.mergeUnits(it).length) + ": " + (u.model || u.appliance); }).join(" · ")) + "</div>" +
            '<div class="table-sub">' + esc(SW.mergeWidthText(it)) + "</div>" +
            '<div class="inline-actions" style="margin-top:6px"><label class="table-sub">Drawing width <input type="text" data-act="mergewidth" data-id="' + it.id + '" value="' + esc(it.merge.widthBasis === "typed" ? it.spec.w : "") + '" placeholder="sum" style="width:78px;min-height:30px;padding:4px 6px;border:1px solid var(--line-strong);border-radius:7px"></label>' +
            '<span class="table-sub">Kit: ' + esc(SW.kitLabel(SW.kitState(it)) || "not answered") + "</span>" +
            '<button class="remove-button" data-act="unmerge" data-id="' + it.id + '">Unmerge</button></div>' : "") + "</td>" +
          "<td>" + (v ? esc(v.label) + '<div class="table-sub">' + esc(v.page) + "</div>"
            : (SW.basisPending(it) ? '<span class="badge danger">Not chosen</span>' : '<span class="table-sub">—</span>')) +
          (it.specPage ? '<div class="table-sub" style="color:var(--success)">▤ sheet p.' + esc(String(it.specPage.pageNo || "")) + " attached</div>" : "") + "</td>" +
          '<td class="sw-num">' + (SW.specDoubtOf(it)
            ? '<div class="sw-spec-edit">' + ["w", "d", "h"].map(function (k) {
                return '<label>' + k.toUpperCase() + '<input type="text" data-act="specdim" data-id="' + it.id + '" data-k="' + k + '" value="' + esc(it.spec[k] || "") + '"></label>';
              }).join("") + "</div>"
            : (SW.specSummary(it) || "—")) + "</td>" +
          '<td class="sw-num">' + (SW.fieldSummary(it) || "—") + "</td>" +
          "<td>" + (s ? '<span class="badge ' + SW.SK[s].tone + '">' + esc(SW.SK[s].label) + "</span>" : '<span class="badge">Open</span>') +
          (SW.specDoubtOf(it)
            ? '<div class="table-sub" style="color:#7b4b04"><strong>Spec under review</strong> — ' + esc(SW.specDoubtOf(it).note) + "</div>" +
              '<button class="button small" data-act="specok" data-id="' + it.id + '" style="margin-top:6px">Confirmed against the sheet</button>'
            : (fl.length ? '<div class="table-sub" style="color:var(--danger)">' + esc(fl[0].short) + "</div>" : "")) + "</td>" +
          '<td><div class="inline-actions"><a class="button small ghost" href="' + SW.nav("field", w.id, it.id) + '">Open</a>' +
          '<button class="button small ghost" data-act="pkgspecedit" data-walk="' + w.id + '" data-id="' + it.id + '" title="The opening size, the connections and the cabinet prep, against the attached sheet">Edit the spec</button>' +
          '<button class="remove-button" data-act="delitem" data-id="' + it.id + '">Remove</button></div></td></tr>';
      });
      h += "</tbody></table></div></div>";
    }

    h += "</div><div class=\"stack sticky\">";

    /* readiness rail */
    h += '<div class="card card-pad"><span class="eyebrow dark">Readiness</span>' +
      '<div style="margin-top:12px">' + readinessCell(r) + "</div>" +
      '<div class="tech-progress" style="background:#e9efec;margin-top:14px"><span style="background:var(--wilson-green);width:' + r.pct + '%"></span></div>' +
      '<p style="margin:10px 0 0;color:var(--muted);font-size:12px">' + r.done + " of " + r.total + " openings walked</p>";
    if (r.blockers.length) {
      h += '<div class="callout danger" style="margin-top:14px"><strong>' + r.blockers.length + " to resolve before sending</strong>" +
        "<ul class=\"sw-tells\">" + r.blockers.slice(0, 5).map(function (it) {
          return "<li>" + esc(SW.itemTitle(it)) + " — " + esc(SW.itemFlags(it)[0].short) + "</li>";
        }).join("") + "</ul></div>";
    }
    h += "</div>";

    h += ticketPanel(w);
    h += coveragePanel(w);
    h += librarySummary();
    h += '<div class="card card-pad"><span class="eyebrow dark">Job file</span>' +
      '<p style="margin:10px 0 12px;color:var(--muted);font-size:12px">One JSON object per walk — every spec, field reading, verdict and basis decision. This is the hand-off to the operations dashboard.</p>' +
      '<div class="inline-actions"><button class="button small ghost" data-act="exportjob">Download job file</button>' +
      '<button class="remove-button" data-act="delwalk">' + (SW.hasGate() ? "Archive walk" : "Delete walk") + "</button></div>" +
      (SW.hasGate() ? '<p style="margin:10px 0 0;color:var(--muted-2);font-size:11.5px">Archiving takes the walk out of everybody\'s list and off the phones\' pick-up list. It stays on ' + esc(SW.apiUrl("serverName", "the server")) + " and can be restored there.</p>" : "") +
      "</div>";

    h += "</div></div></div>";
    return h;
  }

  /* ---------------- the ePASS ticket, against the walk ----------------
     Phase A of the Agility link. The office drops a pull bundle (the
     epass-open-orders-*.json the agent pushes) or the open-orders CSVs, and
     the walk is compared with the job's tickets: units, quantities, hinge
     and model changes, kits and panels, what is in the building and what
     has no ETA. Nothing is written to the walk except what confirmed itself
     (a hinge change the swing record explains), and only on a click. */
  var ticketData = null;      /* the last bundle read, for this session */
  var ticketResult = {};      /* walk id -> diff result */
  function ticketPanel(w) {
    var T = window.WILSON_SW_TICKET;
    if (!T) return "";
    var r = ticketResult[w.id] || w.ticket || null;
    var h = '<div class="card card-pad sw-ticket"><span class="eyebrow dark">ePASS ticket</span>';
    if (!w.jobNo) {
      return h + '<p style="margin:10px 0 0;color:var(--muted);font-size:12px">Enter the job / order number above and drop an ePASS pull here to compare the walk with the order.</p></div>';
    }
    h += '<p style="margin:10px 0 12px;color:var(--muted);font-size:12px">Compare the walk with everything on ' + esc(SW_T_base(w.jobNo)) +
      ' and its suffixes: models, quantities, hinge and panel changes, kits, what is in the building and what has no date.</p>' +
      '<label class="button small ghost" style="cursor:pointer">' + (ticketData ? "Read another pull" : "Read an ePASS pull") +
      '<input type="file" accept=".json,.csv" multiple data-act="ticketfile" style="display:none"></label>' +
      (ticketData ? ' <button class="button small ghost" data-act="ticketrun">Compare again</button>' : "") +
      '<span class="table-sub" style="display:block;margin-top:6px">A pull is the <code>epass-open-orders-…json</code> bundle from the agent\'s processed folder, or the open-orders, lines, misc, on-hand-serials and open-po-lines CSVs together.</span>';
    if (!r) return h + "</div>";
    h += '<div style="margin-top:12px;font-size:12.5px"><strong>' + r.tickets.length + " ticket" + (r.tickets.length === 1 ? "" : "s") + "</strong>" +
      (r.pulledAt ? ' <span class="table-sub">pull of ' + esc(String(r.pulledAt).slice(0, 16).replace("T", " ")) + "</span>" : "") +
      (r.scheduleDate ? ' · delivery <strong>' + esc(r.scheduleDate) + "</strong>" : "") +
      (r.surveyOnTicket ? ' · <span class="badge info">Check Measurements on ticket</span>' : "") + "</div>" +
      '<ul class="sw-tells" style="margin:6px 0 10px">' + r.tickets.map(function (t) {
        return "<li><code>" + esc(t.code) + "</code> " + esc(t.area || "") + (t.jobStatus ? ' <span class="table-sub">' + esc(t.jobStatus) + "</span>" : "") + "</li>";
      }).join("") + "</ul>";
    var open = r.diffs.filter(function (d) { return d.state === "open"; }), conf = r.diffs.filter(function (d) { return d.state === "confirmed"; });
    var patches = T.patches(r).filter(function (p) { return !(w.ticketApplied || {})[p.diffId]; });
    if (!open.length && !conf.length) h += '<div class="callout" style="margin:0">The walk and the order agree.</div>';
    if (conf.length) {
      h += '<div class="callout" style="margin:0 0 10px"><strong>' + conf.length + " change" + (conf.length === 1 ? "" : "s") + " the walk explains</strong>" +
        '<ul class="sw-tells">' + conf.map(function (d) { return "<li>" + esc(d.text) + "</li>"; }).join("") + "</ul>" +
        (patches.length ? '<button class="button small" data-act="ticketapply" style="margin-top:8px">Apply to the walk (' + patches.length + ")</button>" : '<span class="table-sub">Applied.</span>') + "</div>";
    }
    if (open.length) {
      var groups = {}, order = [];
      open.forEach(function (d) { var k = SW_T_kindLabel(d); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(d); });
      h += '<div class="callout warning" style="margin:0"><strong>' + open.length + " to look at" + (r.counts.blocks ? " · " + r.counts.blocks + " before delivery" : "") + "</strong>";
      order.forEach(function (k) {
        h += '<div style="margin-top:8px;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">' + esc(k) + "</div><ul class=\"sw-tells\">" +
          groups[k].map(function (d) {
            var o = SW.ownerOf(d.owner);
            return "<li>" + esc(d.text) + ' <span class="table-sub">' + esc(o.label) + (d.kind2 === "question" ? " · question" : "") + "</span></li>";
          }).join("") + "</ul>";
      });
      h += "</div>";
    }
    /* what the ticket says is in the building */
    var units = r.units || [];
    if (units.length) {
      h += '<details style="margin-top:10px"><summary class="table-sub" style="cursor:pointer">Units on the order (' + units.length + ")</summary><ul class=\"sw-tells\">" +
        units.map(function (u) {
          return u.lines.map(function (l) {
            return "<li><code>" + esc(l.model) + "</code> × " + l.qty + " — " + esc(T.presenceText(l.presence)) + "</li>";
          }).join("");
        }).join("") + "</ul></details>";
    }
    return h + "</div>";
  }
  function SW_T_base(job) { return window.WILSON_SW_TICKET ? window.WILSON_SW_TICKET.ticketBase(job) : job; }
  function SW_T_kindLabel(d) {
    return { variant: "Model changed on the order", model_changed: "Model changed on the order", not_on_walk: "On the order, not on the walk",
      not_on_ticket: "On the walk, not on an open ticket", qty: "Quantities", accessory: "Kits, panels and parts on order",
      merge_hint: "Possible merge", install_code: "Install charge vs the walk", schedule: "Delivery date" }[d.kind] || d.kind;
  }
  /* Read what the office dropped: one JSON bundle, or CSVs by name. */
  function readTicketFiles(files, done) {
    var T = window.WILSON_SW_TICKET;
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var json = list.filter(function (f) { return /\.json$/i.test(f.name); })[0];
    if (json) {
      json.text().then(function (txt) { done(T.fromBundle(JSON.parse(txt))); }).catch(function (e) { ui.toast("Could not read the pull", e.message); });
      return;
    }
    var want = { "open-orders": "orders", "open-order-lines": "lines", "open-order-misc": "misc", "on-hand-serials": "serials", "open-po-lines": "poLines" };
    var out = { pulledAt: "", orders: [], lines: [], misc: [], serials: [], poLines: [] }, pending = 0, got = 0;
    list.forEach(function (f) {
      var key = Object.keys(want).filter(function (k) { return f.name.toLowerCase().indexOf(k) === 0; })[0];
      if (!key) return;
      pending++;
      f.text().then(function (txt) {
        out[want[key]] = parseCsv(txt); got++;
        if (!out.pulledAt && f.lastModified) out.pulledAt = new Date(f.lastModified).toISOString();
        if (--pending === 0) done(out);
      });
    });
    if (!pending) ui.toast("Nothing recognised", "Drop the agent\'s JSON bundle, or the open-orders / open-order-lines / open-order-misc / on-hand-serials / open-po-lines CSVs.");
  }
  function parseCsv(txt) {
    var rows = [], row = [], cell = "", q = false, i, c;
    txt = txt.replace(/^\uFEFF/, "");
    for (i = 0; i < txt.length; i++) {
      c = txt[i];
      if (q) { if (c === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && txt[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    var head = rows.shift() || [];
    return rows.filter(function (r) { return r.length > 1; }).map(function (r) { var o = {}; head.forEach(function (k, j) { o[k] = r[j] == null ? "" : r[j]; }); return o; });
  }
  function runTicketDiff(w) {
    var T = window.WILSON_SW_TICKET;
    if (!T || !ticketData || !w) return;
    var r = T.diff(w, ticketData, { blockers: SW.rollup(w).attention.length });
    ticketResult[w.id] = r;
    /* keep a compact copy on the walk so the packet and the queue can see it */
    w.ticket = { jobBase: r.jobBase, pulledAt: r.pulledAt, scheduleDate: r.scheduleDate, surveyOnTicket: r.surveyOnTicket,
      tickets: r.tickets, counts: r.counts, units: r.units, diffs: r.diffs.map(function (d) { var c = Object.assign({}, d); delete c.suggest; return c; }) };
    SW.touch(w); SW.save();
  }

  function coveragePanel(w) {
    if (!(w.packageModels || []).length) return "";
    var cv = SW.coverage(w);
    var h = '<div class="card card-pad"><span class="eyebrow dark">Spec package coverage</span>' +
      '<p style="margin:10px 0 12px;color:var(--muted);font-size:12px">' + w.packageModels.length + " models in the package.</p>" +
      '<div class="stack" style="gap:6px">';
    cv.rows.forEach(function (row) {
      var multi = row.pkg.entry && row.pkg.entry.variations.length > 1;
      h += '<div class="sw-cov ' + (row.count ? "ok" : "gap") + '">' +
        "<div><strong>" + esc(row.pkg.model) + "</strong>" +
        '<span>' + esc(row.pkg.entry ? row.pkg.entry.brand : "not in the spec library") +
        (row.pkg.pages ? " · " + esc(row.pkg.pages) : "") + "</span>" +
        (multi ? '<span class="sw-cov-multi">' + row.pkg.entry.variations.length + " installation variations</span>" : "") + "</div>" +
        '<span class="badge ' + (row.count ? "success" : "warning") + '">' + (row.count ? row.count + " walked" : "No opening") + "</span></div>";
    });
    h += "</div>";
    if (cv.missing.length) {
      h += '<button class="button small" style="margin-top:12px" data-act="addmissing">Add the ' +
        cv.missing.length + " missing opening" + (cv.missing.length > 1 ? "s" : "") + "</button>";
    }
    if (cv.extra.length) {
      h += '<p class="disclaimer" style="margin-top:10px;color:var(--warning)">On the walk but not in the spec package: ' +
        esc(cv.extra.map(function (it) { return it.model; }).join(", ")) + ". Check the model numbers.</p>";
    }
    return h + "</div>";
  }

  function librarySummary() {
    var models = SW.libModels();
    var queue = SW.openingQueue().length;
    return '<div class="card card-pad"><span class="eyebrow dark">Spec library</span>' +
      '<p style="margin:10px 0 12px;color:var(--muted);font-size:12px">' + models.length + " models, " +
      models.reduce(function (n, e) { return n + (e.variations || []).length; }, 0) + " installation details." +
      (queue ? " <strong>" + queue + " openings still to enter.</strong>" : " Every detail has an opening on it.") + "</p>" +
      '<a class="button small' + (queue ? "" : " ghost") + '" href="#/office/library">Open the spec library</a></div>';
  }
  function libraryPanelUnused() {
    var models = SW.libModels();
    return '<div class="card card-pad"><span class="eyebrow dark">Spec library</span>' +
      '<p style="margin:10px 0 12px;color:var(--muted);font-size:12px">' + models.length +
      " models. Openings read off the Full Spec Package; where a model carries more than one installation detail they are listed together and the walk sheet will not let an opening through until one is picked.</p>" +
      models.map(function (e) {
        return "<details class=\"sw-lib\"><summary><strong>" + esc(e.model) + "</strong> <span>" + esc(e.brand) +
          (e.pages ? " · " + esc(e.pages) : "") + "</span>" +
          (e.variations.length > 1 ? '<span class="badge danger">' + e.variations.length + "</span>" : "") + "</summary>" +
          e.variations.map(function (v) {
            return '<div class="sw-lib-var"><div><strong>' + esc(v.label) + "</strong><b>" + esc(v.page) + "</b></div>" +
              '<span class="sw-num">' + esc(SW.openingText(v)) + "</span>" +
              (v.notes ? "<p>" + esc(v.notes) + "</p>" : "") + "</div>";
          }).join("") + "</details>";
      }).join("") + "</div>";
  }

  var SAMPLE = [
    "Area\tLocation\tBrand\tModel\tAppliance\tInstall\tSpec W x D x H\tRef",
    "Main house\tKitchen run\tSub-Zero\tCL4850SID/O\t48\" refrigerator\tFlush inset\t50 W x 26 3/16 min D x 84 H\tp.33",
    "Main house\tSink cabinet, left\tCove\tDW2451\tDishwasher\t24\" install\t24 W x 24 min D x 34 1/2 min H\tp.11",
    "Apartment\tBar wall\tWolf\tSPO3050TE/S/T\tSpeed oven\tFlush inset\t30 1/8 W x 24 min D x 18 1/8 min H\tp.19",
    "Apartment\tBar undercounter\tSub-Zero\tDEU2450CI/L\tUndercounter refrigerator\tStandard\t24 W x 24 min D x 34 1/2 min H\tp.5"
  ].join("\n");

  /* ---------------- events ---------------- */
  function onClick(e) {
    var t = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!t) return;
    var act = t.getAttribute("data-act"), w = walk();

    if (view === "library" && window.WILSON_SW_LIBRARY &&
        window.WILSON_SW_LIBRARY.handle(act, t, HOST, render)) return;

    if (act.indexOf("pkg") === 0 && window.WILSON_SW_SPECPKG &&
        window.WILSON_SW_SPECPKG.handle(act, t, HOST, render)) return;

    if (act === "copylaunch") {
      var link = t.getAttribute("data-link") || "";
      var said = function () { ui.toast("Link copied", "Send it to the phone that will walk the job."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(said).catch(function () { window.prompt("Copy this link", link); });
      else window.prompt("Copy this link", link);
      return;
    }
    if (act === "newwalk") { var nw = SW.addWalk(); go(SW.nav("office", nw.id)); return; }
    if (act === "specok" && w) {
      var sit = SW.item(w, t.getAttribute("data-id"));
      if (sit) { SW.setSpecDoubt(sit, ""); SW.touch(w); SW.scheduleSave(); render(); }
      return;
    }

    if (act === "readcontents" && w) {
      var box = document.getElementById("sw-contents");
      if (!box || !box.value.trim()) { ui.toast("Nothing to read", "Paste the contents block first."); return; }
      var pm = SW.parseContents(box.value);
      if (!pm.length) { ui.toast("No models found", "No model numbers were recognised in that block."); return; }
      w.packageModels = pm; SW.touch(w); SW.save();
      var unknown = pm.filter(function (p) { return !SW.findModel(p.model); }).length;
      ui.toast(pm.length + " models read", unknown ? unknown + " are not in the spec library yet." : "All matched to the spec library.");
      render(); return;
    }
    if (act === "buildfromcontents" && w) {
      if (!(w.packageModels || []).length) { ui.toast("Read the contents first", "The walk sheet is built from the package contents."); return; }
      var built = SW.itemsFromContents(w);
      w.items = w.items.concat(built); SW.touch(w); SW.save();
      ui.toast(built.length + " openings created", "Pick an installation basis on any that need one.");
      render(); return;
    }
    if (act === "addmissing" && w) {
      var miss = SW.coverage(w).missing;
      var add = miss.map(function (row) {
        var it = SW.blankItem(); it.model = row.pkg.model; it.specRef = row.pkg.pages;
        var e2 = row.pkg.entry;
        if (e2) { it.brand = e2.brand; it.appliance = e2.appliance; it.category = e2.category || ""; if (e2.variations.length === 1) SW.applyBasis(it, e2.variations[0].key); }
        if (!it.appliance) it.appliance = row.pkg.model;
        return it;
      });
      w.items = w.items.concat(add); SW.touch(w); SW.save();
      ui.toast(add.length + " added", "They were in the spec book with no opening on the walk.");
      render(); return;
    }
    if (act === "importsample") { var b = document.getElementById("sw-import"); if (b) { b.value = SAMPLE; b.focus(); } return; }
    if ((act === "import" || act === "importreplace") && w) {
      var box2 = document.getElementById("sw-import");
      if (!box2 || !box2.value.trim()) { ui.toast("Nothing to read", "Paste the spec lines first."); return; }
      var res = SW.importRows(box2.value);
      if (!res.items.length) { ui.toast("No usable lines", "Check the column names."); return; }
      w.items = act === "importreplace" ? res.items : w.items.concat(res.items);
      SW.touch(w); SW.save();
      ui.toast("Spec lines loaded", res.msg);
      render(); return;
    }
    if (act === "additem" && w) {
      var ni = SW.blankItem();
      ni.area = w.items.length ? w.items[w.items.length - 1].area : "";
      w.items.push(ni); SW.touch(w); SW.save(); render(); return;
    }
    if (act === "ticketrun" && w) { runTicketDiff(w); render(); return; }
    if (act === "ticketapply" && w) {
      var T2 = window.WILSON_SW_TICKET, r2 = ticketResult[w.id];
      if (!T2 || !r2) return;
      w.ticketApplied = w.ticketApplied || {};
      var n = 0;
      T2.patches(r2).forEach(function (pt) { if (w.ticketApplied[pt.diffId]) return; if (T2.applyPatch(w, pt)) { w.ticketApplied[pt.diffId] = new Date().toISOString(); n++; } });
      SW.touch(w); SW.save();
      ui.toast("Applied", n + " change" + (n === 1 ? "" : "s") + " from the order written to the walk.");
      runTicketDiff(w); render(); return;
    }
    if (act === "mergepick" && w) {
      var mid = t.getAttribute("data-id"), mat = mergeSel.indexOf(mid);
      if (t.checked && mat < 0) mergeSel.push(mid); else if (!t.checked && mat >= 0) mergeSel.splice(mat, 1);
      render(); return;
    }
    if (act === "mergego" && w) {
      var mres = SW.mergeItems(w, mergeSel);
      if (mres.error) { ui.toast("Cannot merge", mres.error); return; }
      mergeSel = []; SW.touch(w); SW.save();
      ui.toast("Merged", SW.mergeUnits(mres.host).length + " units are one opening. Type the drawing's width if the merge kit sheet gives one.");
      render(); return;
    }
    if (act === "mergesuggest" && w) {
      var sids = (t.getAttribute("data-ids") || "").split(",").filter(Boolean);
      var sres = SW.mergeItems(w, sids);
      if (sres.error) { ui.toast("Cannot merge", sres.error); return; }
      mergeSel = mergeSel.filter(function (id) { return sids.indexOf(id) < 0; });
      SW.touch(w); SW.save();
      ui.toast("Merged", SW.mergeUnits(sres.host).length + " columns are one opening. Set each unit's hinge side and the kit on the walk, or type the drawing's width here.");
      render(); return;
    }
    if (act === "mergedismiss" && w) {
      SW.dismissMergeSuggestion(w, (t.getAttribute("data-ids") || "").split(",").filter(Boolean));
      SW.touch(w); SW.save(); render(); return;
    }
    if (act === "unmerge" && w) {
      var mh = SW.item(w, t.getAttribute("data-id"));
      if (mh) { SW.unmergeItem(w, mh); SW.touch(w); SW.save(); render(); }
      return;
    }
    if (act === "delitem" && w) {
      var id = t.getAttribute("data-id");
      w.items = w.items.filter(function (x) { return x.id !== id; });
      SW.touch(w); SW.save(); render(); return;
    }
    if (act === "loaddemo") {
      var demo = SW.loadDemo();
      if (demo) ui.toast("Example loaded", "Stamped EXAMPLE. Delete it before your first live walk.");
      render(); return;
    }
    if (act === "delwalk" && w) {
      if (t.dataset.armed !== "1") { t.dataset.armed = "1"; t.textContent = SW.hasGate() ? "Tap again to archive" : "Tap again to delete"; return; }
      /* v0.9.84: where there is a server, "delete" on one computer left the
         walk in everyone else's list for good. The server archives it. */
      t.disabled = true;
      SW.archiveWalk(w).then(function (res) {
        if (!res.ok) { t.disabled = false; t.dataset.armed = ""; t.textContent = "Archive walk"; ui.toast("Not archived", res.why || "Try again."); return; }
        if (res.local) { SW.load().walks = SW.walks().filter(function (x) { return x.id !== w.id; }); SW.save(); }
        else { serverSig = ""; fetchServerWalks(); ui.toast("Archived", (w.project || w.jobNo || "The walk") + " is out of the lists."); }
        go(SW.nav("office"));
      });
      return;
    }
    if (act === "exportjob" && w) { exportJob(w); return; }
  }

  function exportJob(w) {
    var copy = JSON.parse(JSON.stringify(w));
    copy.items.forEach(function (it) {
      it.resolvedStatus = SW.statusOf(it);
      it.verdicts = {};
      SW.DIMS.forEach(function (d) {
        var v = SW.verdict(it, d.k);
        it.verdicts[d.k] = { rule: it.rule[d.k], spec: SW.num(it.spec[d.k]), field: SW.num(it.actual[d.k]), state: v.state, text: v.text };
      });
      var vv = SW.itemVariation(it);
      it.basis = vv ? { key: vv.key, label: vv.label, page: vv.page, opening: vv.opening } : null;
      it.flags = SW.itemFlags(it).map(function (f) { return f.kind; });
      it.photoCount = it.photos.length;
      it.photos = it.photos.map(function (p) { return { id: p.id, portalId: p.portalId || "", caption: p.caption }; });
    });
    var r = SW.rollup(w);
    copy.rollup = { counts: r.counts, total: r.total, walked: r.done, deliverable: r.deliverable, blockers: r.blockers.length };
    /* The same payload the sync transport posts, so a file dropped on the
       office machine and a walk that synced over wifi land in the dashboard
       as the same rows. */
    var payload = SW.syncPayload(w);
    payload.rawWalk = copy;
    var name = String(w.jobNo || w.project || "site-walk").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-site-walk.json";
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    if (window.WILSON_SW_DOWNLOAD) { window.WILSON_SW_DOWNLOAD(name, JSON.stringify(payload, null, 2), "application/json"); return; }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function onInput(e) {
    if (view === "library" && window.WILSON_SW_LIBRARY && window.WILSON_SW_LIBRARY.onInput(e)) return;
    if (window.WILSON_SW_SPECPKG && window.WILSON_SW_SPECPKG.onInput(e)) return;
    var el = e.target;
    if (el.getAttribute && el.getAttribute("data-act") === "specdim") {
      var dw = walk(), dit = dw && SW.item(dw, el.getAttribute("data-id"));
      if (dit) { dit.spec[el.getAttribute("data-k")] = el.value; SW.touch(dw); SW.scheduleSave(); }
      return;
    }
    var key = el.getAttribute && el.getAttribute("data-field");
    if (!key) return;
    var w = walk(); if (!w) return;
    w[key] = el.value;
    SW.touch(w); SW.scheduleSave();
  }

  function render() {
    route();
    if (view === "library" && window.WILSON_SW_LIBRARY) {
      /* v0.9.85: a spec book being read for the library uses the import
         wizard's own screens, here, with no walk at the end */
      var LP = window.WILSON_SW_SPECPKG;
      if (LP && LP.active() && LP.isLibrary && LP.isLibrary()) {
        HOST.innerHTML = signedOutBanner() + LP.wizard();
        if (LP.afterRender) LP.afterRender();
        return;
      }
      HOST.innerHTML = signedOutBanner() + window.WILSON_SW_LIBRARY.render(render);
      return;
    }
    HOST.innerHTML = signedOutBanner() + (walkId ? setup() : queue());
    if (window.WILSON_SW_SPECPKG && window.WILSON_SW_SPECPKG.afterRender) {
      window.WILSON_SW_SPECPKG.afterRender();
    }
  }
  function onChange(e) {
    var el = e.target;
    if (el.getAttribute && el.getAttribute("data-act") === "ticketfile") {
      /* copy the FileList before clearing the input — it is live */
      var tw = walk(), fl = Array.prototype.slice.call(el.files || []); el.value = "";
      readTicketFiles(fl, function (data) { ticketData = data; if (tw) runTicketDiff(tw); render(); });
      return;
    }
    if (el.getAttribute && el.getAttribute("data-act") === "mergewidth") {
      var mw = walk(), mi = mw && SW.item(mw, el.getAttribute("data-id"));
      if (mi) { SW.setMergeWidth(mi, el.value); SW.touch(mw); SW.save(); render(); }
      return;
    }
    if (el.getAttribute && el.getAttribute("data-act") === "pkgfile") {
      /* Grab the File before clearing the input — the FileList is live. */
      var pf = el.files && el.files[0];
      el.value = "";
      window.WILSON_SW_SPECPKG.onFile(pf ? [pf] : [], render, { library: el.getAttribute("data-lib") === "1" });
      return;
    }
    if (el.getAttribute && el.getAttribute("data-act") === "specfile") {
      window.WILSON_SW_LIBRARY.upload(el.files, render);
      el.value = "";
      return;
    }
    if (view === "library" && window.WILSON_SW_LIBRARY && window.WILSON_SW_LIBRARY.onInput(e)) return;
  }
  function mount(host) {
    HOST = host;
    document.body.classList.remove("tech-mode");
    fetchServerWalks();
    /* coming back to a tab left open: the server may have restarted (which
       signs everyone out) — ask again so the banner can say so (v0.9.78) */
    window.addEventListener("focus", fetchServerWalks);
    host.addEventListener("click", onClick);
    host.addEventListener("input", onInput, true);
    host.addEventListener("change", onChange, true);
    host.addEventListener("keydown", function (e) {
      if (window.WILSON_SW_SPECPKG) window.WILSON_SW_SPECPKG.onKeydown(e);
    }, true);
    host.addEventListener("focusin", function (e) {
      if (window.WILSON_SW_SPECPKG) window.WILSON_SW_SPECPKG.onFocus(e);
    }, true);
    window.addEventListener("hashchange", function () { render(); });
    host.addEventListener("focusout", function () { if (renderPending) setTimeout(softRender, 0); });
    render();
    /* v0.9.83: opened by a link to a walk this computer has never held —
       fetch it, keep it, show it */
    var asked = new URLSearchParams(location.search).get("walk");
    if (asked && SW.hasPortal()) SW.ensureWalk(asked).then(function () { softRender(); });
    if (SW.liveMs()) setInterval(function () { if (!document.hidden) fetchServerWalks(); }, SW.liveMs());
    /* v0.9.84: who is at the desk (stamped on what they verify), and let go
       of walks the server already holds */
    SW.whoAmI();
    if (SW.tidyHeld()) softRender();
    /* v0.9.85: the spec library is shared; take what others changed, and when
       it changed anything on screen, draw it */
    SW.syncLibrary().then(function (o) { if (o && o.changed && view === "library") render(); });
  }
  window.WILSON_SW_OFFICE = { mount: mount, render: render };
})();

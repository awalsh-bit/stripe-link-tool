/* =============================================================
   Wilson Site Walk — the builder packet
   Page 1 is the one-pager: Wilson cover furniture with the punch
   list on it, so a builder who reads nothing else still knows
   exactly what to do. Everything after it is the evidence.
   ============================================================= */
(function () {
  "use strict";
  var SW = window.WILSON_SW;
  var ui = window.WilsonUI;
  var esc = function (v) { return ui.escapeHtml(v); };
  function logo() { return (window.WILSON_SW_ASSETS && window.WILSON_SW_ASSETS.logo) || "site-walk-assets/logo-black.png"; }

  var HOST = null, walkId = null;
  function walk() { return SW.walk(walkId); }
  var signing = false;            /* a sign-off is on its way to the server */
  /* cavity: "" = the packet; "all" = one cavity sheet per opening; an
     opening id = that sheet alone. Lives in the URL so the print dialog,
     a bookmark and a QR all land on the same thing. */
  var cavity = "";
  function route() {
    var h = (location.hash || "").replace(/^#\/?/, "").split("/");
    cavity = "";
    if (h[0] === "office" && h[1]) {
      walkId = h[1];
      if (h[2] === "packet" && h[3] === "cavity") cavity = h[4] || "all";
    }
    else if (h[0] === "packet" && h[1]) { walkId = h[1]; if (h[2] === "cavity") cavity = h[3] || "all"; }
    else {
      var q = new URLSearchParams(location.search);
      walkId = q.get("walk") || walkId;
      cavity = q.get("cavity") || "";
    }
  }
  function cavityHref(opId) {
    var o = window.WILSON_SW_NAV;
    if (o && o.packet) {
      var base = o.packet(walkId);
      return base + (base.indexOf("?") >= 0 ? "&" : "?") + "cavity=" + encodeURIComponent(opId || "all");
    }
    return "#/office/" + walkId + "/packet/cavity" + (opId ? "/" + opId : "");
  }
  function packetHref() {
    var o = window.WILSON_SW_NAV;
    return (o && o.packet) ? o.packet(walkId) : "#/office/" + walkId + "/packet";
  }

  /* ---------------- document furniture ---------------- */
  function reportPage(title, kicker, body, pageClass, id) {
    var w = walk();
    return '<section class="report-page ' + (pageClass || "") + '"' + (id ? ' id="' + esc(id) + '"' : "") + ">" +
      '<header class="report-page-header">' +
      '<div class="report-mini-logo"><img src="' + logo() + '" alt="Wilson AC &amp; Appliance"></div>' +
      "<div><span>" + esc(kicker || "Appliance site walk") + "</span><h2>" + esc(title) + "</h2></div>" +
      "</header>" +
      '<div class="report-page-body">' + body + "</div>" +
      '<footer class="report-page-footer"><span>Wilson AC &amp; Appliance · Pre-delivery jobsite readiness</span>' +
      '<span class="sw-foot-r">' + esc(w.jobNo || w.id) + '<b class="sw-pg-no"></b></span></footer></section>';
  }

  function readinessLead(r) {
    if (!r.total) return "No openings have been loaded for this walk.";
    if (r.counts.open) {
      var walked = r.total - r.counts.open;
      return r.counts.open + " of " + r.total + " openings " + (r.counts.open === 1 ? "was" : "were") + " not walked. This packet covers the " +
        walked + " that " + (walked === 1 ? "was" : "were") + (r.counts.held ? ", " + r.counts.held + " of " + (r.counts.held === 1 ? "them" : "those") + " under spec review by Wilson" : "") + ".";
    }
    if (r.counts.held && !r.attention.length) {
      return (r.total - r.counts.held) + " of " + r.total + " openings meet their installation specification. " + r.counts.held +
        (r.counts.held === 1 ? " is" : " are") + " under spec review by Wilson — no builder action on " + (r.counts.held === 1 ? "it" : "those") + " until this packet is reissued.";
    }
    if (!r.attention.length) {
      return "All " + r.total + " openings meet their installation specification. No builder action is required before delivery.";
    }
    var n = r.attention.length;
    return (r.total - n) + " of " + r.total + " openings are ready for set. " + n +
      (n === 1 ? " needs" : " need") + " builder action before the appliances are delivered.";
  }

  /* ---------------- page 1: the punch list ----------------
     v0.9.85. Cayden, 17 Nov 2026: "They won't look at much beyond a page
     unless they need the details to get the mod right. I don't want them to
     open a walk result and be overwhelmed and then close it. Concise punch
     list front page. Details behind it if they need."

     So page one is three things and nothing else: whose job it is, how
     many things have to change, and the list — one numbered row per
     change, grouped by the trade that does it, each with the page its
     drawing is on. Every item is on it; a long list runs onto a second
     sheet rather than dropping rows. What was on the old cover and is not
     a change to make (the jobsite strip, the counts) moved to page two. */
  function splitFix(text) {
    var t = String(text || "").trim();
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    var i = t.indexOf(" — ");
    if (i > 10 && i < 96) return [t.slice(0, i), cap(t.slice(i + 3))];
    var m = /^(.{10,110}?[.?!])\s+(\S.*)$/.exec(t);
    if (m) return [m[1].replace(/\.$/, ""), m[2]];
    return [t.replace(/\.$/, ""), ""];
  }
  /* every row of the builder's list, in the order it prints */
  function punchRowsFor(w) {
    var rows = [];
    SW.accessFindings(w).forEach(function (line) {
      rows.push({ job: true, where: "Jobsite access", text: line });
    });
    var jf = SW.jobFindings(w);
    jf.filter(function (f) { return f.kind !== "question"; }).forEach(function (f) {
      rows.push({ job: true, where: "Jobsite", text: f.detail });
    });
    jf.filter(function (f) { return f.kind === "question"; }).forEach(function (f) {
      rows.push({ job: true, question: true, where: "Jobsite · " + f.label.replace(/\?$/, ""), text: f.detail });
    });
    var groups = [], byOwner = {};
    SW.punchItems(w).forEach(function (row) {
      var k = row.f.owner;
      if (!byOwner[k]) { byOwner[k] = []; groups.push(k); }
      byOwner[k].push(row);
    });
    groups.forEach(function (k) {
      var o = SW.ownerOf(k);
      byOwner[k].forEach(function (row, i) {
        rows.push({ head: i ? null : o, it: row.it, where: SW.rowTitle(row.it), text: row.f.detail || row.f.label,
          cosmetic: row.f.severity === "cosmetic", question: row.f.kind === "question", sales: o.who === "sales" });
      });
    });
    return rows;
  }
  function punchRowHtml(row, n) {
    var parts = splitFix(row.text);
    return (row.head ? '<li class="sw-punch-head who-' + row.head.who + '"><strong>' + esc(row.head.label) + "</strong></li>" : "") +
      '<li class="sw-punch-row' + (row.job ? " sw-job-row" : "") + (row.cosmetic ? " cosmetic" : "") + (row.question ? " question" : "") + '">' +
      '<b class="sw-pl-n">' + n + "</b>" +
      '<div class="sw-pl-t"><div class="sw-pl-l1"><strong>' + esc(parts[0]) +
      (row.question ? ' <em class="sw-tag q">Question</em>' : "") +
      (row.cosmetic ? ' <em class="sw-tag cos">Cosmetic</em>' : "") +
      (row.sales ? ' <em class="sw-tag sales">Spec decision</em>' : "") + "</strong>" +
      '<i class="sw-pl-w">' + esc(row.where) + "</i></div>" +
      (parts[1] ? "<span>" + esc(parts[1]) + "</span>" : "") + "</div>" +
      (row.it ? '<a class="sw-pl-pg" href="#op-' + esc(row.it.id) + '" data-pageref="op-' + esc(row.it.id) + '"></a>' : '<a class="sw-pl-pg" href="#sw-glance" data-pageref="sw-glance"></a>') +
      "</li>";
  }
  function coverPage(w, r) {
    var rows = punchRowsFor(w), n = rows.length;
    var readyN = r.counts.ready + r.counts.verify;
    var h = '<section class="report-page report-cover-page sw-cover sw-pl-cover">' +
      '<div class="report-cover-shape"></div>' +
      '<div class="report-cover-brand"><img src="' + logo() + '" alt="Wilson AC &amp; Appliance"></div>' +
      '<div class="report-cover-title"><span>Pre-delivery site walk</span>' +
      "<h1>" + esc(w.project || "Appliance site walk") + "</h1>" +
      "<p>" + esc(w.builder ? "Jobsite readiness for " + w.builder : "Jobsite readiness and builder punch list") + "</p></div>";

    var facts = [w.jobNo ? "Job " + w.jobNo : "", w.walkDate ? "Walked " + ui.shortDate(w.walkDate) + (w.walkedBy ? " by " + w.walkedBy : "") : "",
      w.address && w.address !== w.project ? w.address : ""].filter(Boolean);
    h += '<p class="sw-pl-facts">' + facts.map(esc).join(" &nbsp;·&nbsp; ") + "</p>";

    /* the verdict: how many things to do, and how much is already right */
    var sub = [];
    if (r.counts.modify) sub.push(r.counts.modify + " need" + (r.counts.modify === 1 ? "s" : "") + " work");
    if (r.counts.decision) sub.push(r.counts.decision + " await" + (r.counts.decision === 1 ? "s" : "") + " a response");
    if (r.counts.held) sub.push(r.counts.held + " under spec review by Wilson");
    if (r.counts.open) sub.push(r.counts.open + " not walked");
    h += '<div class="sw-pl-verdict' + (n ? "" : " clear") + '">' +
      '<div class="sw-pl-count"><strong>' + (r.total ? n : "—") + "</strong><span>" +
      (n === 1 ? "item to complete<br>before delivery" : n ? "items to complete<br>before delivery" : "items — nothing to<br>change before delivery") + "</span></div>" +
      '<div class="sw-pl-ready report-cover-score"><strong>' + esc(r.total ? readyN + " of " + r.total : "—") + "</strong>" +
      "<span>openings ready as built</span>" + (sub.length ? "<em>" + esc(sub.join(" · ")) + "</em>" : "") + "</div></div>";
    if (w.note) h += '<p class="sw-pl-note">' + esc(w.note) + "</p>";

    if (r.held && r.held.length) {
      h += '<div class="report-note-box warning sw-cover-hold"><strong>Draft — ' + r.held.length + " opening" + (r.held.length === 1 ? "" : "s") +
        " under spec review by Wilson.</strong> " + r.held.map(function (it) { return esc(SW.rowTitle(it)); }).join(", ") +
        ": the installer questioned the required dimensions at the walk and Wilson is confirming them against the manufacturer's sheet. " +
        "No builder action on " + (r.held.length === 1 ? "that opening" : "those openings") + " until this packet is reissued.</div>";
    }
    if (n) {
      h += '<div class="sw-cover-punch"><h3>Before the appliances are delivered <small>drawing and manufacturer sheet on the page shown</small></h3>' +
        '<ol class="sw-punch sw-pl">' + rows.map(function (row, i) { return punchRowHtml(row, i + 1); }).join("") + "</ol></div>";
    } else if (r.total) {
      h += '<div class="report-ok-box sw-cover-ok"><strong>No builder action required.</strong> ' +
        "Every opening walked meets the installation detail recorded for it. Items marked verify are confirmed by the installer at set.</div>";
    }
    /* what needs nothing, in one line — so a builder can see his own good
       work without turning a page */
    var good = w.items.filter(function (it) { var s = SW.statusOf(it); return (s === "ready" || s === "verify") && !SW.needsAction(it); });
    if (good.length && n) {
      h += '<p class="sw-pl-good"><strong>Ready as built, nothing to change:</strong> ' +
        good.map(function (it) { return esc(SW.itemTitle(it)) + (it.area ? " <i>(" + esc(it.area) + ")</i>" : ""); }).join(" · ") + ".</p>";
    }
    var c = contact(w);
    h += '<footer class="report-cover-footer"><span>Wilson AC &amp; Appliance · Trusted since 1949</span>' +
      '<span class="sw-pl-contact">Questions: ' + esc(c.name) + " · " + esc(c.phone) + "</span></footer></section>";
    return h;
  }
  function meta(k, v) { return v ? "<div><span>" + esc(k) + "</span><strong>" + esc(v) + "</strong></div>" : ""; }

  /* ---------------- page 2: readiness summary ---------------- */
  /* Tables cannot be split by paginate.js — its atoms are element children,
     and a table has one. So the row count per sheet is decided here. */
  function summaryTable(w, rows, offset) {
    return '<table class="sw-tbl">' +
      "<thead><tr><th>#</th><th>Area / location</th><th>Appliance</th><th>Basis</th><th>Required</th><th>Field</th><th>Status</th><th>Page</th></tr></thead><tbody>" +
      rows.map(function (it, i0) {
        var i = offset + i0;
        var s = SW.statusOf(it), v = SW.itemVariation(it), fl = SW.itemFlags(it);
        return "<tr><td class=\"sw-num\">" + (i + 1) + "</td>" +
          "<td><strong>" + esc(it.area || it.location || "—") + "</strong>" + (it.area && it.location ? "<br>" + esc(it.location) : "") + "</td>" +
          "<td><strong>" + esc(SW.itemTitle(it)) + "</strong>" + (it.model ? "<br>" + esc(it.model) : "") + "</td>" +
          "<td>" + (v ? esc(v.label) + "<br><small>" + esc(v.page) + "</small>" : it.installType ? esc(it.installType) : "—") + "</td>" +
          '<td class="sw-num">' + (SW.specSummary(it) || "—") + "</td>" +
          '<td class="sw-num">' + (SW.fieldSummary(it) || "—") + "</td>" +
          "<td>" + (s ? '<span class="p-chip pc-' + s + '">' + esc(SW.SK[s].label) + "</span>" : '<span class="p-chip">Open</span>') +
          (fl.length ? '<div class="sw-tbl-flag">' + esc(fl[0].short) + "</div>" : acceptedShort(it)) + "</td>" +
          '<td class="sw-tbl-pg"><a href="#op-' + esc(it.id) + '" data-pageref="op-' + esc(it.id) + '"></a></td></tr>';
      }).join("") + "</tbody></table>";
  }
  /* "Ready" over a miss the installer accepted says so on the summary row,
     so the 31" against 30 1/8" two columns over is not a surprise. */
  function acceptedShort(it) {
    var dims = SW.DIMS.filter(function (d) { return SW.acceptedReason(it, d.k); }).map(function (d) { return d.label.toLowerCase(); });
    var utils = SW.utilitiesFor(it).filter(function (u) { return SW.acceptedUtilReason(it, u.key); }).map(function (u) { return SW.utilLabel(u).toLowerCase(); });
    var all = dims.concat(utils);
    if (!all.length) return "";
    return '<div class="sw-tbl-note">' + esc(all.join(", ").replace(/^\w/, function (c) { return c.toUpperCase(); })) + " accepted by the installer</div>";
  }
  /* The house today, in one strip: the route in, the floor, and the
     before-delivery answers. What is wrong gets a chip each; what is fine
     shares one. (On the cover until v0.9.85; anything in it that is a
     change to make is a numbered row on the cover's list.) */
  function jobStrip(w) {
    var bits = SW.jobReadinessBits(w);
    if (!bits.length) return "";
    var SHORT = { "Power on at the panel": "power", "Water on to the house": "water", "Gas on and tested": "gas",
      "Countertops installed": "countertops", "Floor protection down along the route": "floor protection",
      "Route and openings clear of stored material": "route clear", "Someone on site to receive": "someone to receive",
      "Somewhere for crates and packaging": "crates & packaging", "Flooring": "finished floor", "Access": "access" };
    var bad = bits.filter(function (b) { return b.bad; }), good = bits.filter(function (b) { return !b.bad; });
    var goodAccess = good.filter(function (b) { return b.label === "Access"; });
    good = good.filter(function (b) { return b.label !== "Access"; });
    return '<div class="sw-cover-job sw-glance-job"><span class="sw-cover-job-h">Jobsite at the walk</span>' + goodAccess.concat(bad).map(function (b) {
      return '<span class="sw-job-bit' + (b.bad ? " bad" : "") + '"><em>' + esc(b.label) + "</em>" + esc(b.value) + "</span>";
    }).join("") +
      (good.length ? '<span class="sw-job-bit sw-job-ok"><em>In place</em>' + esc(good.map(function (b) { return SHORT[b.label] || b.label.toLowerCase(); }).join(" · ")) + "</span>" : "") +
      "</div>";
  }
  function summaryPages(w, r) {
    /* Page two is the index: every opening on one table with its status
       and the page its detail is on. The row count per sheet is a first
       guess; spillPages() measures and moves rows that do not fit. */
    var out = [], first = true, i = 0;
    while (i < w.items.length) {
      var per = first ? 10 : 16;
      var rows = w.items.slice(i, i + per);
      var body = "";
      if (first) {
        body += jobStrip(w);
        body += accessBlock(w);
      }
      body += summaryTable(w, rows, i);
      out.push(reportPage("All openings at a glance" + (first ? "" : " (continued)"), w.project || "Site walk", body, "sw-summary-page", first ? "sw-glance" : ""));
      first = false;
      i += per;
    }
    return out;
  }

  /* How the appliances get into the building. Printed on every packet, not
     only when there is a problem: "we looked, and the route is a set of
     interior stairs" is worth as much to a delivery crew as a warning. */
  function accessBlock(w) {
    var a = SW.accessOf(w);
    if (!a.route && !a.state) {
      return '<div class="sw-basis-block warn"><div class="sw-basis-h">Jobsite access</div>' +
        '<div class="sw-basis-note">Not recorded on this walk. Confirm the delivery route before the appliances are scheduled.</div></div>';
    }
    var findings = SW.accessFindings(w);
    var tight = SW.num(a.tightestIn);
    var rows = '<div class="sw-basis-row"><span>Route in</span><span>' +
      esc(SW.accessRouteLabel(w) || "—") + "</span></div>" +
      '<div class="sw-basis-row"><span>Condition at the walk</span><span>' +
      esc(SW.accessStateLabel(w) || "—") + "</span></div>" +
      (tight != null
        ? '<div class="sw-basis-row"><span>Tightest point</span><span>' + esc(SW.fmtIn(tight)) + "</span></div>"
        : "");
    return '<div class="sw-basis-block' + (findings.length ? " warn" : "") + '">' +
      '<div class="sw-basis-h">Jobsite access</div>' + rows +
      (a.note ? '<div class="sw-basis-note">' + esc(a.note) + "</div>" : "") +
      (findings.length
        ? '<div class="sw-basis-note"><strong>' + esc(findings[0]) + "</strong></div>"
        : '<div class="sw-basis-note">Route photographed at the walk.</div>') +
      "</div>";
  }

  function bandsBlock(r) {
    var bands = [
      { cls: "band-good", n: r.counts.ready, label: "Ready for set" },
      { cls: "band-good", n: r.counts.verify, label: "Verify at set" },
      { cls: "band-monitor", n: r.counts.modify, label: "Modification required" },
      { cls: "band-action", n: r.counts.decision, label: "Response required" }
    ];
    if (r.counts.held) bands.push({ cls: "band-monitor", n: r.counts.held, label: "Under spec review" });
    return '<div class="portfolio-bands">' + bands.map(function (b) {
      var pct = r.total ? Math.round(b.n / r.total * 100) : 0;
      return '<div class="portfolio-band ' + b.cls + '"><strong>' + b.n + "</strong><span>" + esc(b.label) + "</span>" +
        '<div class="band-meter"><div class="band-meter-fill" style="width:' + pct + '%"></div></div></div>';
    }).join("") + "</div>";
  }

  /* ---------------- per-opening pages ---------------- */
  function dimTable(it) {
    if (it.multiPoint) return dimTablePoints(it);
    var rows = SW.dimsFor(it).map(function (d) {
      var spec = SW.num(it.spec[d.k]), act = SW.num(it.actual[d.k]);
      var skipped = it.actual[d.k] === "NM";
      if (spec == null && act == null && !skipped) return "";
      var v = SW.verdict(it, d.k);
      var rule = it.rule[d.k] || (d.k === "w" ? "exact" : "min");
      var tone = v.state === "bad" ? "#c8341f" : v.state === "ok" ? "#16713a"
              : v.state === "accepted" ? "#475569" : "#64748b";
      return "<tr><td><strong>" + esc(d.label) + "</strong>" +
        (spec == null ? "" : '<div class="sw-rule">' + esc(SW.RULES[rule]) + "</div>") + "</td>" +
        '<td class="sw-num">' + (spec == null ? "—" : esc(SW.specText(it, d.k))) + "</td>" +
        '<td class="sw-num">' + (skipped ? "not measured" : (act == null ? "—" : esc(SW.fmtIn(act)))) + "</td>" +
        '<td class="sw-num" style="color:' + tone + ";font-weight:" + (v.state === "bad" ? 800 : 600) + '">' +
        verdictCell(v) + "</td></tr>";
    }).filter(Boolean).join("");
    if (!rows) return "";
    return '<table class="sw-tbl sw-dimtbl"><thead><tr><th>Dimension</th><th>Required</th><th>Field</th><th>Result</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }
  /* An irregular opening prints every reading, with the one that decided the
     verdict marked. A builder disputing a call can see exactly where it was
     taken. */
  function dimTablePoints(it) {
    var rows = SW.dimsFor(it).map(function (d) {
      var spec = SW.num(it.spec[d.k]);
      var gov = SW.governing(it, d.k);
      var govAt = SW.governingPoint(it, d.k);
      if (spec == null && gov == null) return "";
      var v = SW.verdict(it, d.k);
      var rule = it.rule[d.k] || (d.k === "w" ? "exact" : "min");
      var tone = v.state === "bad" ? "#c8341f" : v.state === "ok" ? "#16713a"
              : v.state === "accepted" ? "#475569" : "#64748b";
      var reads = SW.pointsFor(d.k).map(function (pt) {
        var n = SW.num(it.points[d.k][pt.i]);
        var mark = govAt === pt.i ? ' style="font-weight:800;text-decoration:underline"' : "";
        return "<span" + mark + ">" + (n == null ? "—" : esc(SW.fmtIn(n))) + "</span>";
      }).join(" · ");
      return "<tr><td><strong>" + esc(d.label) + "</strong>" +
        (spec == null ? "" : '<div class="sw-rule">' + esc(SW.RULES[rule]) + "</div>") + "</td>" +
        '<td class="sw-num">' + (spec == null ? "—" : esc(SW.specText(it, d.k))) + "</td>" +
        '<td class="sw-num">' + reads + "</td>" +
        '<td class="sw-num" style="color:' + tone + ";font-weight:" + (v.state === "bad" ? 800 : 600) + '">' +
        esc(v.text) + "</td></tr>";
    }).filter(Boolean).join("");
    if (!rows) return "";
    return '<table class="sw-tbl sw-dimtbl"><thead><tr><th>Dimension</th><th>Required</th>' +
      "<th>Field — left · centre · right</th><th>Result</th></tr></thead><tbody>" + rows + "</tbody></table>" +
      '<p class="sw-points-note">Irregular opening: each dimension taken at three points, perpendicular from the ' +
      "finished panel face. The underlined reading governs.</p>";
  }

  /* 'accepted' is its own column value: showing it as a pass would hide a
     waiver, and showing it as a failure would contradict the block below
     that says Wilson is not asking for a fix. */
  function verdictCell(v) {
    if (v.state !== "accepted") return esc(v.text);
    return '<span class="sw-vacc">' + esc(v.miss || v.text) + " · accepted</span>";
  }

  /* the phone files a photo under the step that took it ("opening",
     "cabinet to the left"); the builder reads a title */
  function photoTitle(p) {
    var t = (p.checkName || "Opening").trim();
    if (/^opening$/i.test(t)) return "The opening";
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function photoFigures(it, limit) {
    var list = it.photos.slice(0, limit || 4);
    if (!list.length) return "";
    return '<div class="photo-grid sw-photos">' + list.map(function (p) { return photoCell(p, photoTitle(p)); }).join("") + "</div>";
  }
  /* One photograph with its marks drawn over it. The marks are vectors on
     the photo's own coordinates; the wrapper hugs the image so they land
     where the finger put them at any print size. */
  function picHtml(src, alt, p) {
    var svg = SW.markupSvg(SW.markupOf(p));
    if (!svg) return '<img src="' + src + '" alt="' + esc(alt) + '">';
    return '<span class="sw-pic"><img src="' + src + '" alt="' + esc(alt) + '">' + svg + "</span>";
  }
  function photoCell(p, title) {
    return '<figure class="photo-cell" data-photo-id="' + esc(p.id) + '" data-portal-id="' + esc(p.portalId || "") + '" data-thumb="' + esc(p.thumb || "") + '">' +
      '<div class="photo-frame">' + (p.thumb ? picHtml(p.thumb, "Field photograph", p) : '<span class="photo-loading">Loading…</span>') + "</div>" +
      "<figcaption><strong>" + esc(title) + "</strong>" +
      (p.caption ? "<span>" + esc(p.caption) + "</span>" : "") +
      (SW.hasMarkup(p) ? "<span>Marked up at the walk.</span>" : "") + "</figcaption></figure>";
  }
  /* The adjacent-cabinet photograph with its pins. The pins locate — no
     homography stands behind them, so the caption never claims an inch. */
  var connCache = {};
  var GROUP_TITLES = { plumbing: "Plumbing connections", electrical: "Electrical connections", other: "Vent and air" };

  /* The section drawing an email cannot argue with: the opening in top
     view, to scale, with the cleat setback the tape found against the one
     the sheet asks for. Drawn from the walk's own numbers — never from a
     dimension nobody measured. */
  function cleatFigure(it) {
    var stripsHtml = stripFigure(it);
    if (stripsHtml) return stripsHtml;
    if (!it.planes4) return "";
    var pl = SW.planeSize(it);
    var specC = SW.num(it.spec.c), actC = SW.num(it.actual.c);
    var d = SW.num(it.spec.d) != null ? SW.num(it.spec.d) : SW.num(it.actual.d);
    if (!pl || actC == null || d == null) return "";
    var v = SW.verdict(it, "c");
    var bad = v.state === "bad";
    var W = pl.w, D = d;
    /* The opening scales to fit; the right side keeps a fixed dimension
       lane so the setback callout never clips. Cleats draw no thinner than
       6px — at true scale a 3/4" cleat on a 50" opening is invisible, and a
       drawing nobody can see teaches nothing. */
    var bw = 340, bh = 190, mT = 22, mB = 34, mL = 14, lane = 104;
    var s = Math.min((bw - mL - lane) / W, (bh - mT - mB) / D);
    var ox = mL + ((bw - mL - lane) - W * s) / 2, oy = mT + ((bh - mT - mB) - D * s) / 2;
    var right = ox + W * s, front = oy + D * s;
    var cleatW = Math.max(0.75 * s, 6);
    var cleatD = Math.max(actC * s, 4);
    var cy = front - cleatD;
    var col = bad ? "#c8341f" : "#16713a";
    var dimX = right + 14;
    var svg =
      '<svg viewBox="0 0 ' + bw + " " + bh + '" class="sw-cleat-svg" role="img" aria-label="Cleat setback, top view">' +
      /* the opening */
      '<rect x="' + ox.toFixed(1) + '" y="' + oy.toFixed(1) + '" width="' + (W * s).toFixed(1) + '" height="' + (D * s).toFixed(1) +
      '" fill="#f4f7f5" stroke="#43554b" stroke-width="1.4"/>' +
      /* cleats on each side wall, front face back to the measured setback */
      '<rect x="' + ox.toFixed(1) + '" y="' + cy.toFixed(1) + '" width="' + cleatW.toFixed(1) + '" height="' + cleatD.toFixed(1) + '" fill="' + col + '"/>' +
      '<rect x="' + (right - cleatW).toFixed(1) + '" y="' + cy.toFixed(1) + '" width="' + cleatW.toFixed(1) + '" height="' + cleatD.toFixed(1) + '" fill="' + col + '"/>' +
      /* front face */
      '<line x1="' + ox.toFixed(1) + '" y1="' + front.toFixed(1) + '" x2="' + right.toFixed(1) + '" y2="' + front.toFixed(1) + '" stroke="#43554b" stroke-width="2.4"/>' +
      '<text x="' + (ox + W * s / 2).toFixed(1) + '" y="' + (front + 13) + '" text-anchor="middle" class="sw-cleat-t">cabinet face</text>' +
      /* width dimension */
      '<text x="' + (ox + W * s / 2).toFixed(1) + '" y="' + (oy - 7) + '" text-anchor="middle" class="sw-cleat-t">opening ' + esc(SW.fmtIn(W)) + "</text>" +
      /* setback dimension in its own lane: extension lines, measured value */
      '<line x1="' + right.toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + (dimX + 6) + '" y2="' + cy.toFixed(1) + '" stroke="' + col + '" stroke-width="1" stroke-dasharray="3 2"/>' +
      '<line x1="' + right.toFixed(1) + '" y1="' + front.toFixed(1) + '" x2="' + (dimX + 6) + '" y2="' + front.toFixed(1) + '" stroke="' + col + '" stroke-width="1" stroke-dasharray="3 2"/>' +
      '<line x1="' + dimX + '" y1="' + cy.toFixed(1) + '" x2="' + dimX + '" y2="' + front.toFixed(1) + '" stroke="' + col + '" stroke-width="1.4"/>' +
      '<text x="' + (dimX + 8) + '" y="' + ((cy + front) / 2 - 2).toFixed(1) + '" class="sw-cleat-t" fill="' + col + '" font-weight="800">' + esc(SW.fmtIn(actC)) + " measured</text>" +
      (specC != null
        ? '<text x="' + (dimX + 8) + '" y="' + ((cy + front) / 2 + 11).toFixed(1) + '" class="sw-cleat-t" fill="#5b6b62">sheet ' + esc(SW.fmtIn(specC)) + "</text>"
        : "") +
      '<text x="' + (dimX + 8) + '" y="' + ((cy + front) / 2 - 15).toFixed(1) + '" class="sw-cleat-t" fill="#5b6b62">cleat setback</text>' +
      '<text x="' + ox.toFixed(1) + '" y="' + (bh - 4) + '" class="sw-cleat-t" fill="#8793a4">cleat thickness drawn oversize for visibility</text>' +
      "</svg>";
    var line;
    if (specC != null && bad) {
      var dd = actC - specC;
      line = "The sheet asks for " + SW.fmtIn(specC) + " and the walk measured " + SW.fmtIn(actC) +
        " — the cleats run " + SW.fmtIn(Math.abs(dd)) + (dd < 0 ? " shy of" : " past") + " the drawing.";
    } else if (specC != null) {
      line = "Measured " + SW.fmtIn(actC) + " against the sheet's " + SW.fmtIn(specC) + " — " + v.text + ".";
    } else {
      line = "Measured " + SW.fmtIn(actC) + " at the walk. No sheet dimension is in the library for this cleat — Wilson to confirm before delivery.";
    }
    return '<div class="sw-cleat' + (bad ? " bad" : "") + '"><div class="sw-basis-h">Cleats / finished returns — top view, to scale</div>' +
      svg + '<div class="sw-basis-note">' + esc(line) + "</div></div>";
  }

  /* The cleats, returns and blocking the sheet calls for, in top view to
     scale: the finished return along each side wall from the cabinet face,
     the cleat standing proud of the wall behind it, a block across the
     back — each with the sheet's number and the tape's. Finished wood is
     solid; blocking is pale and dashed. Nothing is drawn that nobody
     specified. */
  function stripFigure(it) {
    var strips = (it.prep || []).filter(function (pr) { return SW.isStrip(pr); });
    if (!strips.length) return "";
    var pl = SW.planeSize(it);
    var D = SW.depthIn(it) || SW.num(it.spec && it.spec.d) || 24;
    if (!pl) return "";
    var W = pl.w;
    var bw = 400, bh = 200, mT = 22, mB = 34, mL = 14, lane = 150;
    var sc = Math.min((bw - mL - lane) / W, (bh - mT - mB) / D);
    var ox = mL + ((bw - mL - lane) - W * sc) / 2, oy = mT + ((bh - mT - mB) - D * sc) / 2;
    var right = ox + W * sc, front = oy + D * sc;
    var WOOD = "#c9a467", ROUGH = "#e3d6bf";
    var svg = '<svg viewBox="0 0 ' + bw + " " + bh + '" class="sw-cleat-svg" role="img" aria-label="Cleats, returns and blocking — top view">' +
      '<rect x="' + ox.toFixed(1) + '" y="' + oy.toFixed(1) + '" width="' + (W * sc).toFixed(1) + '" height="' + (D * sc).toFixed(1) + '" fill="#f4f7f5" stroke="#43554b" stroke-width="1.4"/>';
    var notes = [], dims = [], anyBad = false;
    strips.forEach(function (pr) {
      var kd = SW.prepKind(pr.kind), geoms = SW.stripGeoms(it, pr), ck = (it.prepChecks || {})[pr.id] || {}, meas = ck.meas || {};
      var finds = SW.stripFindings(it, pr), st = SW.prepState(it, pr.id);
      if (finds.length || st === "missing" || st === "wrong") anyBad = true;
      geoms.forEach(function (g) {
        var fill = g.finished ? WOOD : ROUGH, dash = g.finished ? "" : ' stroke-dasharray="3 2"';
        /* top view: x across, y = depth (front at the bottom) */
        var zTop = front + g.z0 * sc, zBot = front + g.z1 * sc;      /* z is negative going back */
        var tpx = Math.max(g.t * sc, g.t > 0 ? 6 : 3);
        if (g.face === "left" || g.face === "right") {
          var x = g.face === "left" ? ox : right - tpx;
          if (g.t <= 0) svg += '<rect x="' + (g.face === "left" ? ox - 3 : right).toFixed(1) + '" y="' + zTop.toFixed(1) + '" width="3" height="' + (zBot - zTop).toFixed(1) + '" fill="' + fill + '"/>';
          else svg += '<rect x="' + x.toFixed(1) + '" y="' + zTop.toFixed(1) + '" width="' + tpx.toFixed(1) + '" height="' + (zBot - zTop).toFixed(1) + '" fill="' + fill + '" stroke="' + kd.color + '" stroke-width="1"' + dash + "/>";
        } else if (g.face === "back") {
          svg += '<rect x="' + (ox + g.x0 * sc).toFixed(1) + '" y="' + oy.toFixed(1) + '" width="' + ((g.x1 - g.x0) * sc).toFixed(1) + '" height="' + Math.max(g.t * sc, 4).toFixed(1) + '" fill="' + fill + '" stroke="' + kd.color + '" stroke-width="1"' + dash + "/>";
        } else {
          /* top or bottom: in plan it is a band at its depth across the width */
          svg += '<rect x="' + (ox + g.x0 * sc).toFixed(1) + '" y="' + zTop.toFixed(1) + '" width="' + ((g.x1 - g.x0) * sc).toFixed(1) + '" height="' + Math.max(zBot - zTop, 3).toFixed(1) + '" fill="' + fill + '" fill-opacity=".45" stroke="' + kd.color + '" stroke-width="1"' + dash + "/>";
        }
      });
      var s = SW.stripOf(pr);
      SW.stripMeasFor(pr).forEach(function (m) {
        var want = SW.stripTarget(it, pr, m.k), got = SW.num(meas[m.k]);
        if (want == null && got == null) return;
        if (pr.kind === "return" && m.k === "setbackIn" && !want && got == null) return;     /* a return starts at the face */
        var short = m.k === "setbackIn" ? "back from face" : m.k === "thicknessIn" ? (s.face === "back" ? "proud of the wall" : "wide") : "deep";
        dims.push({ color: kd.color, label: kd.label + " · " + short, strip: pr.label || kd.label, short: short === "back from face" ? "back" : short, want: want, got: got, bad: finds.some(function (f) { return f.k === m.k; }) });
      });
      var line = SW.prepText(pr, it) + ".";
      if (st === "built") line += " Built as drawn.";
      else if (st === "missing") line += " Not there at the walk.";
      else if (st === "wrong") line += " Does not match" + (ck.note ? " — " + ck.note : "") + ".";
      else line += " Not checked at the walk.";
      var fin = SW.prepFoundFinished(it, pr.id);
      if (fin) line += " Found " + (fin === "yes" ? "finished" : "unfinished") + ".";
      finds.forEach(function (f) { line += " " + f.detail; });
      notes.push({ color: kd.color, text: line });
    });
    svg += '<line x1="' + ox.toFixed(1) + '" y1="' + front.toFixed(1) + '" x2="' + right.toFixed(1) + '" y2="' + front.toFixed(1) + '" stroke="#43554b" stroke-width="2.4"/>' +
      '<text x="' + (ox + W * sc / 2).toFixed(1) + '" y="' + (front + 13) + '" text-anchor="middle" class="sw-cleat-t">cabinet face</text>' +
      '<text x="' + (ox + W * sc / 2).toFixed(1) + '" y="' + (oy - 7) + '" text-anchor="middle" class="sw-cleat-t">opening ' + esc(SW.fmtIn(W)) + " × " + esc(SW.fmtIn(D)) + " deep</text>";
    /* the dimension lane: sheet and tape, one line each */
    var ly = oy + 4, room = Math.floor((bh - 16 - ly) / 26);
    if (dims.length <= room) {
      dims.forEach(function (d) {
        svg += '<text x="' + (right + 10) + '" y="' + ly.toFixed(1) + '" class="sw-cleat-t" fill="' + (d.bad ? "#c8341f" : "#5b6b62") + '" font-weight="' + (d.bad ? "800" : "600") + '">' + esc(d.label) + "</text>";
        svg += '<text x="' + (right + 10) + '" y="' + (ly + 11).toFixed(1) + '" class="sw-cleat-t" fill="' + (d.bad ? "#c8341f" : "#1f2a24") + '">' +
          (d.want != null ? "sheet " + esc(SW.fmtIn(d.want)) : "") + (d.got != null ? (d.want != null ? " · " : "") + "tape " + esc(SW.fmtIn(d.got)) : "") + "</text>";
        ly += 26;
      });
    } else {
      /* a Wolf flush inset has cleats on four sides — one line per strip,
         the sheet's numbers with the tape beside any that differ (v0.9.74) */
      var groups = [];
      dims.forEach(function (d) {
        var g = groups.filter(function (x) { return x.strip === d.strip; })[0];
        if (!g) { g = { strip: d.strip, parts: [], bad: false }; groups.push(g); }
        g.parts.push(d); if (d.bad) g.bad = true;
      });
      groups.slice(0, room).forEach(function (g) {
        svg += '<text x="' + (right + 10) + '" y="' + ly.toFixed(1) + '" class="sw-cleat-t" fill="' + (g.bad ? "#c8341f" : "#5b6b62") + '" font-weight="' + (g.bad ? "800" : "600") + '">' + esc(g.strip) + "</text>";
        svg += '<text x="' + (right + 10) + '" y="' + (ly + 11).toFixed(1) + '" class="sw-cleat-t" fill="' + (g.bad ? "#c8341f" : "#1f2a24") + '">' + esc(g.parts.map(function (d) {
          var t = d.short + " " + (d.want != null ? SW.fmtIn(d.want) : "—");
          if (d.got != null && (d.want == null || Math.abs(d.got - d.want) > 1e-6)) t += " (tape " + SW.fmtIn(d.got) + ")";
          return t;
        }).join(" · ")) + "</text>";
        ly += 26;
      });
    }
    svg += '<text x="' + ox.toFixed(1) + '" y="' + (bh - 4) + '" class="sw-cleat-t" fill="#8793a4">solid: finished wood · dashed: blocking · thickness drawn oversize for visibility</text></svg>';
    var inter = SW.stripInterior(it);
    /* the flag that travels with the cleats: what panel they were checked for */
    var pbx = SW.panelBasis(it), shifting = strips.some(function (pr) { return pr.strip && pr.strip.panelShift; });
    var flag = "";
    if (pbx && shifting) {
      var allBuilt = strips.filter(function (pr) { return pr.strip.panelShift; }).every(function (pr) { return SW.prepState(it, pr.id) === "built" && !SW.stripFindings(it, pr).length; });
      if (!allBuilt) flag = SW.panelBasisText(it);
      else if (!pbx.confirmed) flag = "Cleats measure to spec, assuming a " + SW.fmtIn(pbx.assumed) + " panel — the thickness the sheet assumes. A different panel moves them by the difference; confirm the panel thickness before delivery.";
      else if (Math.abs(pbx.delta) < 1e-9) flag = "Cleats measure to spec for this job's " + SW.fmtIn(pbx.actual) + " panel.";
      else flag = "Cleats measure to spec for this job's " + SW.fmtIn(pbx.actual) + " panel — " + SW.fmtIn(Math.abs(pbx.delta)) + (pbx.delta > 0 ? " further back" : " further forward") + " than the sheet draws for " + SW.fmtIn(pbx.assumed) + ".";
    }
    return '<div class="sw-cleat' + (anyBad ? " bad" : "") + '"><div class="sw-basis-h">Cleats, returns and blocking — top view, to scale</div>' +
      (flag ? '<div class="sw-panel-flag' + (pbx.confirmed ? "" : " assumed") + '">' + esc(flag) + "</div>" : "") + svg +
      notes.map(function (n) { return '<div class="sw-basis-note"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:' + esc(n.color) + '"></i>' + esc(n.text) + "</div>"; }).join("") +
      (inter && inter.clear != null ? '<div class="sw-basis-note"><strong>Between the cleats: ' + esc(SW.fmtIn(inter.clear)) + "</strong> — " + esc(SW.fmtIn(inter.w)) + " less " + esc(SW.fmtIn(inter.left)) + " left and " + esc(SW.fmtIn(inter.right)) + " right.</div>" : "") +
      "</div>";
  }

  function utilityTable(it) {
    var need = SW.utilitiesFor(it);
    if (!need.length) return "";
    var any = need.some(function (u) { return it.utilities[u.key]; });
    if (!any) return "";
    var label = { ok: "Present, correct location", misplaced: "Present, wrong location", roughed: "Roughed in, not finished",
                  missing: "Not found", na: "Does not apply to this unit" };
    var tone = { ok: "#16713a", misplaced: "#93500a", roughed: "#93500a", missing: "#a1201a", na: "#64748b" };
    return '<h4 class="sw-h4">Utility connections</h4>' +
      '<table class="sw-tbl"><thead><tr><th style="width:1.05in">Connection</th><th style="width:1.5in">Required</th>' +
      "<th>Where it belongs</th><th style="+'"width:1.35in"'+">Found on site</th></tr></thead><tbody>" +
      need.map(function (u) {
        var a = it.utilities[u.key];
        var v = SW.markVerdict(it, u);
        /* A location the tech declared prints as exactly that — a walk
           record with a number, never dressed up as a manufacturer drawing. */
        var z = SW.zoneOf(it, u);
        /* a generic check's `where` is the phone's instruction ("mark it on
           the photo"); the builder is pointed at the sheet */
        var whereText = u.generic ? "Per the attached installation sheet" : (u.where || "—");
        var belongs = z && z.field
          ? "Recorded at the walk: " + SW.posText(it, z.x, z.y)
          : whereText + (u.note ? " " + u.note : "");
        return "<tr><td><strong>" + esc(SW.utilLabel(u)) + "</strong></td>" +
          "<td>" + esc(u.need || "—") + "</td>" +
          "<td>" + esc(belongs) + "</td>" +
          '<td style="color:' + (tone[a] || "#64748b") + ";font-weight:" + (a && a !== "ok" ? 800 : 600) + '">' +
          esc(label[a] || "not checked") +
          foundType(it, u) +
          (v ? '<span class="sw-measured">' + esc(v.text) + "</span>" : "") +
          (SW.utilFlagText(it, u) ? '<span class="sw-measured">' + esc(SW.utilFlagText(it, u)) + "</span>" : "") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }


  /* what the tech confirmed or found: "NEMA 14-50R confirmed" / "found 10-30R" */
  function foundType(it, u) {
    var have = SW.utilTypeOf(it, u), want = SW.requiredUtilType(u, it);
    if (!have) return "";
    var lbl = SW.utilTypeLabel(u, have);
    if (want && have === want) return '<span class="sw-measured">' + esc(lbl) + " confirmed</span>";
    return '<span class="sw-measured" style="color:#a1201a">found ' + esc(lbl) + "</span>";
  }

  /* What was standing in the opening.

     Printed whenever the question was answered, including when the answer is
     "nothing" — because the builder reading this needs to know somebody
     looked. Two jobs' notes turned on pipes and stubs nobody had checked
     against the appliance rough-in. */
  function obstructionBlock(it) {
    var o = SW.obstructionOf(it);
    if (!o.state) return "";
    var proj = SW.num(o.projectsIn);
    var line;
    if (o.state === "none") {
      /* nothing in the way is one line, not a section (v0.9.85) */
      return '<p class="sw-obstruct-none"><strong>Obstructions:</strong> nothing standing in the opening. The unit can sit fully back.</p>';
    } else if (o.state === "clears") {
      line = (o.kind || "An obstruction") + " is present" +
        (proj != null ? ", projecting " + SW.fmtIn(proj) + " from the back wall" : "") +
        ", and clears the unit as measured. Confirm at set before anchoring.";
    } else {
      line = (o.kind || "An obstruction") +
        (proj != null ? " projects " + SW.fmtIn(proj) + " from the back wall and" : "") +
        " will hold the unit off the back wall. It sets the appliance setback and has to be recessed or relocated.";
    }
    return '<div class="sw-basis-block' + (o.state === "holds" ? " warn" : "") + '">' +
      '<div class="sw-basis-h">Obstructions in the opening</div>' +
      '<div class="sw-basis-note">' + esc(line) + "</div></div>";
  }

  /* Dimensions Wilson accepted rather than asked to be corrected. On the
     page, with the reason and the number, because a waiver nobody can trace
     is a waiver somebody will dispute. */
  function acceptedBlock(it) {
    var rows = [];
    SW.dimsFor(it).forEach(function (d) {
      var reason = SW.acceptedReason(it, d.k);
      if (!reason) return;
      var raw = SW.rawVerdict(it, d.k);
      if (raw.state !== "bad") return;
      rows.push('<div class="sw-basis-row"><span>' + esc(d.label) + " " +
        esc(SW.fmtIn(SW.num(it.actual[d.k]))) + " against " +
        esc(SW.specText(it, d.k)) + " — " + esc(raw.text) +
        "</span><span>" + esc(reason) + "</span></div>");
    });
    SW.utilitiesFor(it).forEach(function (u) {
      var reason = SW.acceptedUtilReason(it, u.key);
      if (!reason) return;
      var mv = SW.markVerdict(it, u);
      rows.push('<div class="sw-basis-row"><span>' + esc(SW.utilLabel(u)) + " — " +
        esc(mv ? mv.text : "marked in the wrong location") + "</span><span>" + esc(reason) + "</span></div>");
    });
    if (!rows.length) return "";
    return '<div class="sw-basis-block"><div class="sw-basis-h">Accepted by Wilson — no correction requested</div>' +
      rows.join("") +
      '<div class="sw-basis-note">These readings miss the manufacturer dimension and Wilson is not asking for a change. ' +
      "The installer will verify them at set.</div></div>";
  }

  function panelBlock(it) {
    if (!SW.isPanelReady(it)) return "";
    var spec = SW.panelText(it), p = SW.panelSpec(it);
    if (!spec && SW.panelSpecMissing(it)) {
      spec = "the panel size on the manufacturer sheet — Wilson to confirm the dimension";
    }
    var by = { wilson: "Wilson AC & Appliance", custom: "Custom — cabinet shop", undecided: "Not yet decided" }[it.panelBy] || "Not recorded";
    var state = { verified: "On site and to spec", "onsite-wrong": "On site, does not meet spec", absent: "Not on site at the walk" }[it.panelState] || "";
    var warn = it.panelBy === "custom" && it.panelState !== "verified";
    var h = '<div class="sw-panel-block' + (warn ? " warn" : "") + '"><div class="sw-basis-h">Panel</div>';
    h += '<div class="sw-basis-row"><span>Required panel</span><div class="sw-num">' +
      (spec ? esc(spec) : "see the spec package") + (p && p.page ? " · " + esc(p.page) : "") + "</div></div>";
    h += '<div class="sw-basis-row"><span>Supplied by</span><div>' + esc(by) + "</div></div>";
    var pb = SW.panelBasis(it);
    if (pb) {
      h += '<div class="sw-basis-row"><span>Panel thickness</span><div class="sw-num">' +
        (pb.confirmed ? esc(SW.fmtIn(pb.actual)) + (pb.inRange ? "" : " — outside this model's " + esc(SW.panelRangeText(pb))) : "not confirmed — " + esc(SW.fmtIn(pb.assumed)) + " assumed") +
        (SW.panelRangeText(pb) ? ' <span class="sw-muted">· model takes ' + esc(SW.panelRangeText(pb)) + (pb.page ? ", " + esc(pb.page) : "") + "</span>" : "") + "</div></div>";
      h += '<div class="sw-basis-note">' + esc(SW.panelBasisText(it)) + "</div>";
    }
    if (state) h += '<div class="sw-basis-row"><span>At the walk</span><div>' + esc(state) +
      (it.panelPulls ? " · handle pulls " + (it.panelPulls === "yes" ? "installed" : "not installed") : "") + "</div></div>";
    if (it.panelBy === "custom" && it.panelState === "absent") {
      h += '<div class="sw-basis-note">Custom panels are commonly hung after the site walk. Confirm this one is built to the size above with the handle pulls installed, and notify Wilson AC &amp; Appliance before the delivery is scheduled.</div>';
    }
    return h + "</div>";
  }

  function basisBlock(it) {
    var e = SW.itemEntry(it), v = SW.itemVariation(it);
    if (!e) return "";
    /* An opening with nothing to change gets the basis in a line: which
       detail, which page, where the numbers came from. The alternatives
       not used and the sheet's notes are for an opening somebody has to
       rework, and all of them are on the reference page at the back. */
    if (!SW.needsAction(it) && SW.statusOf(it)) {
      return '<div class="sw-basis-brief"><strong>Installation basis:</strong> ' +
        (v ? esc(v.label) + " — " + esc(e.brand + " " + e.model) + ", spec package " + esc(v.page) +
             (SW.hasOpening(v) ? '. Required opening <span class="sw-num">' + esc(SW.openingText(v)) + "</span>" : "") + "."
           : "not selected — this opening was walked without an installation basis.") +
        verifiedLine(it) + "</div>";
    }
    var others = e.variations.filter(function (x) { return x.key !== (it.basisKey || ""); });
    var h = '<div class="sw-basis-block"><div class="sw-basis-h">Installation basis</div>';
    if (v) {
      h += row("Detail used", "<strong>" + esc(v.label) + "</strong> — " + esc(e.brand + " " + e.model) + ", spec package " + esc(v.page));
      if (SW.hasOpening(v)) h += row("Required opening", '<span class="sw-num">' + esc(SW.openingText(v)) + "</span>");
    } else {
      h += row("Detail used", "<strong>Not selected</strong> — this opening was walked without an installation basis.");
    }
    if (others.length) {
      h += row("Not used", others.map(function (x) {
        return esc(x.label) + " (" + esc(x.page) + (SW.hasOpening(x) ? ", " + esc(SW.openingText(x)) : "") + ")";
      }).join("; "));
    }
    if (v && v.notes) h += '<div class="sw-basis-note">' + esc(v.notes) + "</div>";
    h += verifiedLine(it);
    return h + "</div>";
    function row(k, val) { return '<div class="sw-basis-row"><span>' + esc(k) + "</span><div>" + val + "</div></div>"; }
  }

  /* Where this opening's required dimensions came from. A builder being
     asked to move a wall is entitled to know the number was read off the
     manufacturer's drawing by a named person on a dated sheet — and, where
     nobody did that, to be told so plainly. */
  function verifiedLine(it) {
    var dv = it.dimsVerified;
    var hasSpec = SW.dimsFor(it).some(function (d) { return SW.num(it.spec[d.k]) != null; });
    if (!hasSpec) return "";
    if (!dv || !dv.at) {
      return '<div class="sw-verified-line unchecked">Required dimensions carried from the spec library and not ' +
        "checked against a manufacturer sheet for this job.</div>";
    }
    var bits = ["Required dimensions read from " + (dv.sourceDoc || "the spec package")];
    if (dv.pageNo) bits.push("p." + dv.pageNo);
    if (dv.sheetDate) bits.push("sheet dated " + dv.sheetDate);
    if (dv.by) bits.push("verified by " + dv.by);
    if (dv.at) bits.push(ui.shortDate(String(dv.at).slice(0, 10)));
    return '<div class="sw-verified-line">' + esc(bits.join(" · ")) + ".</div>";
  }
  function conflictBox(it) {
    var flags = SW.itemFlags(it);
    if (!flags.length) return "";
    return flags.map(function (f) {
      return '<div class="report-note-box warning sw-conflict-box"><strong>' + esc(f.short) + "</strong>" +
        "<p>" + esc(f.text) + "</p>" +
        "<small>Confirm the installation detail in writing to Wilson AC &amp; Appliance before the appliance is released for delivery.</small></div>";
    }).join("");
  }
  function decisionBox(it) {
    if (SW.statusOf(it) !== "decision" && !it.question) return "";
    var opts = (it.options || []).filter(Boolean);
    var h = '<div class="sw-decision"><strong>' + esc(it.question || "Builder response required") + "</strong>";
    if (opts.length) opts.forEach(function (o) { h += '<div class="sw-opt"><span class="sw-cb"></span>' + esc(o) + "</div>"; });
    else h += '<div class="sw-writein"></div>';
    h += "<small>Return the marked selection to Wilson AC &amp; Appliance before the appliance is released for delivery.</small></div>";
    return h;
  }
  /* An opening page is built as a list of blocks with a printed height
     each, because the renderer emits strings and cannot measure anything.
     The costs below are the measured heights of each block at print size,
     rounded up; blocks are laid onto sheets in order and anything that will
     not fit starts a continuation page. A packet that runs off the bottom
     of the sheet is worse than one that runs to two pages. */
  var PAGE_BUDGET = 860;

  /* ---- the measuring sheet: its readings with datum, and its checks ---- */
  function formPrint(it) {
    var f = SW.formOf(it);
    if (f.k === "standard") return "";
    var fields = f.fields.map(function (fd) {
      var v = SW.formVal(it, fd.k); if (v == null) return "";
      var vd = SW.formFieldVerdict(it, fd), min = SW.formFieldMin(it, fd);
      return "<tr><td>" + esc(fd.label) + '</td><td class="sw-num">' + esc(SW.fmtIn(v)) + '</td><td class="sw-num">' + (min != null ? esc(SW.fmtIn(min)) + " min" : "—") + "</td><td>" +
        (vd ? '<span class="' + (vd.state === "bad" ? "sw-bad" : "sw-good") + '">' + esc(vd.text) + "</span>" : '<span class="sw-muted">recorded</span>') + "</td></tr>";
    }).join("");
    var checks = f.checks.map(function (c) {
      var a = SW.formCheck(it, c.k); if (!a) return "";
      return "<tr><td>" + esc(c.q) + '</td><td class="' + (a === "no" ? "sw-bad" : a === "yes" ? "sw-good" : "sw-muted") + '">' + (a === "no" ? "No" : a === "yes" ? "Yes" : "N/A") + "</td>" +
        "<td>" + (a === "no" ? esc(c.fix) + ' <span class="sw-owner">' + esc(SW.ownerOf(c.owner || "builder").label) + "</span>" : "") + "</td></tr>";
    }).join("");
    if (!fields && !checks) return "";
    /* A list of checks that all passed is one line (v0.9.85): the builder
       reads the ones that did not, and seven rows of "Yes" hid them. */
    var answers = f.checks.map(function (c) { return SW.formCheck(it, c.k); }).filter(Boolean);
    var noes = answers.filter(function (a) { return a === "no"; }).length;
    if (checks && !noes) {
      var yes = answers.filter(function (a) { return a === "yes"; }).length, na = answers.length - yes;
      checks = "";
      var passed = '<p class="sw-form-pass"><span class="sw-good">✓</span> ' + (yes === 1 ? "The one check" : "All " + yes + " checks") + " for this installation passed at the walk" +
        (na ? " (" + na + " not applicable)" : "") + ".</p>";
      return '<div class="sw-form-print"><strong>' + esc(f.label) + "</strong>" +
        (fields ? "<table><thead><tr><th>Reading</th><th>Field</th><th>Spec</th><th>Result</th></tr></thead><tbody>" + fields + "</tbody></table>" : "") + passed + "</div>";
    }
    return '<div class="sw-form-print"><strong>' + esc(f.label) + "</strong>" +
      (fields ? "<table><thead><tr><th>Reading</th><th>Field</th><th>Spec</th><th>Result</th></tr></thead><tbody>" + fields + "</tbody></table>" : "") +
      (checks ? "<table><thead><tr><th>Check</th><th></th><th>Correction</th></tr></thead><tbody>" + checks + "</tbody></table>" : "") + "</div>";
  }
  /* ---- a merged opening: the units, the width basis, the kit ---- */
  function mergePrint(it) {
    if (!SW.isMerge(it)) return "";
    var units = SW.mergeUnits(it), n = units.length, ks = SW.kitState(it);
    var tone = (SW.KIT_STATES.filter(function (k) { return k.k === ks; })[0] || {}).tone || "";
    return '<div class="sw-merge-print"><strong>Merged opening — ' + n + " units, one cavity</strong>" +
      "<table><thead><tr><th>Position</th><th>Unit</th><th>Unit opening</th></tr></thead><tbody>" +
      units.map(function (u, i) {
        return "<tr><td>" + esc(SW.unitPos(i, n)) + "</td><td><b>" + esc(u.model || u.appliance) + "</b>" +
          (u.appliance && u.model ? " · " + esc(u.appliance) : "") + '</td><td class="sw-num">' +
          (SW.num(u.spec && u.spec.w) != null ? esc(SW.fmtIn(SW.num(u.spec.w))) + " W" : "—") + "</td></tr>";
      }).join("") + "</tbody></table>" +
      esc(SW.mergeWidthText(it)) + " Each unit keeps its own connections; they are listed below by unit." +
      (ks ? '<br><span class="sw-kit ' + tone + '">Join kit: ' + esc(SW.kitLabel(ks)) + "</span>" : "") + "</div>";
  }
  /* ---- the tranche-2 readings, printed where the dimensions are ---- */
  function flushPrint(it) {
    var t = SW.flushText(it);
    if (!t) return "";
    return '<div class="sw-flush-print"><strong>Flush inset — what the panel meets</strong>' + esc(t) + ". Setbacks from the face frame.</div>";
  }
  function panelsPrint(it) {
    var list = it.panels || [];
    if (!list.length) return "";
    return '<div class="sw-panels-print"><strong>Panels measured on site</strong><table>' +
      "<tr><th>Panel</th><th>Measured</th><th>Should be</th><th>Plane</th></tr>" +
      list.map(function (p) {
        var vs = SW.panelVerdicts(p);
        var badW = vs.some(function (v) { return v.k === "w"; }), badH = vs.some(function (v) { return v.k === "h"; });
        var m = [p.w ? SW.fmtIn(SW.num(p.w)) + " W" : "", p.h ? SW.fmtIn(SW.num(p.h)) + " H" : ""].filter(Boolean).join(" × ");
        var tgt = [p.targetW ? SW.fmtIn(SW.num(p.targetW)) + " W" : "", p.targetH ? SW.fmtIn(SW.num(p.targetH)) + " H" : ""].filter(Boolean).join(" × ");
        var pl = SW.PANEL_PLANES.filter(function (x) { return x.k === p.plane; })[0];
        return "<tr><td>" + esc(p.label) + '</td><td class="' + (badW || badH ? "bad" : "") + '">' + (m || "—") + "</td><td>" + (tgt || "—") +
          '</td><td class="' + (p.plane && p.plane !== "ok" ? "bad" : "") + '">' + (pl ? esc(pl.label) : "—") + "</td></tr>";
      }).join("") + "</table></div>";
  }
  function swingPrint(it) {
    var f = SW.swingFinding(it);
    if (!f || f.kind !== "note") return "";
    return '<div class="sw-flush-print"><strong>Door swing</strong>' + esc(f.text) + "</div>";
  }
  function flooringPrint(it) {
    var w = walk(); if (!w) return "";
    var ded = SW.flooringDeduction(w, it), h = SW.num(it.actual && it.actual.h);
    if (!ded || h == null) return "";
    return '<p class="sw-floor-note">Height read ' + esc(SW.fmtIn(h)) + " over the subfloor; " + esc(SW.fmtIn(ded)) +
      " of flooring is still to go in, so the finished opening will measure " + esc(SW.fmtIn(h - ded)) + ". Verdicts use the finished number.</p>";
  }
  function opParts(it) {
    var parts = [];
    function add(html, cost) { if (html) parts.push({ html: html, cost: cost }); }

    var s = SW.statusOf(it);
    add('<div class="sw-op-title">' +
      '<div><span class="sw-op-eyebrow">' + esc(SW.itemWhere(it) || it.category || "Opening") + "</span>" +
      "<h3>" + esc(SW.itemTitle(it)) + "</h3>" +
      '<p class="sw-num">' + esc([it.brand, it.model].filter(Boolean).join(" ")) +
      (it.installType ? " · " + esc(it.installType) : "") + "</p></div>" +
      (s ? '<span class="p-chip pc-' + s + ' sw-op-chip">' + esc(SW.SK[s].long) + "</span>" : "") +
      "</div>", 86);

    /* What has to change goes straight under the title (v0.9.85): a trade
       who turns to this page from the punch list reads the instruction
       first, then the drawing that shows it. */
    var acts = SW.actionsFor(it).filter(function (a) { return SW.whoOf(a) !== "wilson" && a.kind !== "note"; });
    if (acts.length) {
      add('<h4 class="sw-h4">Required before appliance delivery</h4>' +
        '<ol class="corrective-list sw-acts-print">' + acts.map(function (a) {
          var o = SW.ownerOf(a.owner);
          return '<li class="' + (a.severity === "cosmetic" ? "cosmetic" : "") + (a.kind === "question" ? " question" : "") + '"><span>' + esc(a.text) + "</span>" +
            '<em class="sw-own who-' + o.who + '">' + esc(o.label) +
            (a.kind === "question" ? " · question" : a.severity === "cosmetic" ? " · cosmetic" : "") + "</em></li>";
        }).join("") + "</ol>", 26 + acts.length * 66);
    }

    /* v0.9.51: the drawing carries the sheet's zones and the walk's pins;
       the photographs print plain beside it as evidence */
    var marked = roughInFigure(it);
    /* a hood has no opening: its figure is the elevation the tech placed it in */
    var hm = SW.hoodModel ? SW.hoodModel(it, walk()) : null;
    if (hm) {
      var sh = hm.shroud, fm = it.form || {};
      marked = '<figure class="sw-roughin-fig sw-hood-fig">' + SW.hoodSvg(hm, { width: "100%" }) +
        (sh ? SW.shroudPlanSvg(hm, { width: "100%", ductOff: fm.ductOff, ductDia: fm.ductDia }) : "") +
        "<figcaption>" + (sh ? "The custom hood (shroud) and its insert as measured at the walk — " : "The hood as placed at the walk — ") +
        (hm.placed ? esc(SW.fmtIn(hm.bottom)) + " above the cooking surface" : "height above the cooking surface not recorded") +
        (sh && sh.cutW != null ? ". Cutout in the shroud bottom " + esc(SW.fmtIn(sh.cutW)) + (sh.cutD != null ? " × " + esc(SW.fmtIn(sh.cutD)) : "") +
          (sh.specW != null ? " against the sheet's " + esc(SW.fmtIn(sh.specW)) + (sh.specD != null ? " × " + esc(SW.fmtIn(sh.specD)) : "") : "") +
          (sh.cutOk === false || sh.cutDOk === false ? " — under size" : "") : "") +
        (sh && sh.innerH != null ? ". " + esc(SW.fmtIn(sh.innerH)) + " inside for a " + esc(SW.fmtIn(hm.spec.unitH)) + " tall insert" + (sh.innerOk === false ? " — not enough" : "") : "") +
        (sh && sh.wGiven ? ". Shroud " + esc(SW.fmtIn(sh.w)) + " wide over a " + esc(SW.fmtIn(hm.spec.cookW)) + " cooking surface" + (sh.wideOk === false ? " — narrower than the cooking surface" : "") : "") +
        (hm.inBand === false ? " (outside the sheet's band)" : hm.inBand ? " (on the sheet)" : "") +
        (hm.toCeiling != null ? ", " + esc(SW.fmtIn(Math.max(0, hm.toCeiling))) + " from its top to the ceiling" : "") +
        (Math.abs(hm.offset) >= 1 / 16 ? ", " + esc(SW.fmtIn(Math.abs(hm.offset))) + " off the cooktop's centre to the " + (hm.offset > 0 ? "right" : "left") : ", centred on the cooktop") +
        (hm.spec.duct && hm.spec.duct.size ? ". Duct " + esc(hm.spec.duct.size) + (hm.spec.duct.dir ? " " + esc(hm.spec.duct.dir) : "") : "") +
        (hm.spec.jbox ? ". " + esc(hm.spec.jbox) : "") + ".</figcaption></figure>";
    }
    var figs = photoFigures(it);
    var right = it.notReady
      ? '<div class="report-note-box warning sw-note"><strong>Not measured on this walk.</strong> ' +
        esc(it.notReady) + ". The required opening for the installation detail below still applies.</div>"
      : dimTable(it);
    right += mergePrint(it) + formPrint(it) + flushPrint(it) + panelsPrint(it) + swingPrint(it) + flooringPrint(it);
    if (it.notes) right += '<div class="report-note-box sw-note">' + esc(it.notes).replace(/\n/g, "<br>") + "</div>";
    var picCount = (marked ? 1 : 0) + it.photos.length;
    var basisInColumn = false;
    if (marked || figs) {
      /* Portrait phone photos print at full aspect now, capped at 4.6in, so
         a photo row costs what a portrait photo costs — not a 4:3 crop.
         The column beside a photo has room to spare, so the installation
         basis prints there, under the measurements it explains, instead
         of spilling onto a sheet of its own at the end. */
      basisInColumn = true;
      add('<div class="sw-op-cols"><div>' + marked + figs + "</div><div>" + right + basisBlock(it) + "</div></div>",
        Math.max(170 + (it.notes ? 80 : 0), 40 + Math.ceil(picCount / 2) * 480));
    } else {
      add(right, 165 + (it.notes ? 80 : 0));
    }

    /* A utility row is two lines when it is only a requirement and a
       location, and five or six once a measured position is printed under
       the field answer. Estimating them all at the tall figure pushed short
       pages onto a needless second sheet, so the cost follows the content. */
    var need = SW.utilitiesFor(it);
    var utilCost = 34;
    need.forEach(function (u) {
      var belongs = (u.where || "") + (u.note || "");
      utilCost += 56 + Math.floor(belongs.length / 70) * 20 +
        (SW.markVerdict(it, u) ? 90 : 0);
    });
    add(utilityTable(it), utilCost);
    add(prepBlock(it), 40 + (it.prep || []).length * 36);

    var mc = SW.markConflicts(it);
    if (mc.length) {
      add('<div class="report-note-box warning sw-note"><strong>Checked against the photograph.</strong> ' +
        mc.map(esc).join(" ") + " Confirm on site before the connection is signed off.</div>", 80);
    }
    add(obstructionBlock(it), 70);
    add(cleatFigure(it), 250 + (it.prep || []).filter(function (pr) { return SW.isStrip(pr); }).length * 34);
    /* One line of heading and note, plus a row per dimension waived. */
    var waived = 0;
    SW.dimsFor(it).forEach(function (d) { if (SW.acceptedReason(it, d.k)) waived++; });
    add(acceptedBlock(it), 60 + waived * 40);
    add(panelBlock(it), 110);
    add(conflictBox(it), 130);
    add(decisionBox(it), 110);
    if (!basisInColumn) add(basisBlock(it), 100);
    return parts;
  }

  /* The rough-in drawing: the opening to scale with every connection the
     sheet places, dimensioned from the left edge and the floor. Printed
     whenever the office placed one; the builder's trades read this before
     they read a sentence. */
  /* true once anything was measured at the opening: the drawing then has
     readings to carry, connections or not */
  function measured(model) {
    var d = model.dims || {};
    return ["w", "h", "d"].some(function (k) { return d[k] && d[k].state !== "none"; });
  }
  function roughInFigure(it) {
    var model = SW.roughInModel(it);
    if (!model) return "";
    var pins = model.pins || [];
    if (!model.marks.length && !pins.length && !measured(model)) return "";
    var planes = ["opening"];
    model.marks.forEach(function (m) { if (planes.indexOf(m.plane) < 0) planes.push(m.plane); });
    pins.forEach(function (pn) { if (planes.indexOf(pn.plane) < 0 && model.planes[pn.plane]) planes.push(pn.plane); });
    /* the drawing's real extent: every plane it shows, the sink cabinet
       beside a dishwasher included (it was left out, so a wide run was
       laid out as if it were a tall one and printed thumbnail-sized) */
    var ext = [Infinity, -Infinity, Infinity, -Infinity];
    planes.forEach(function (k) {
      var P = model.planes[k]; if (!P) return;
      ext[0] = Math.min(ext[0], P.x); ext[1] = Math.max(ext[1], P.x + P.w); ext[2] = Math.min(ext[2], P.y); ext[3] = Math.max(ext[3], P.y + P.h);
    });
    var tall = ext[3] - ext[2], wide = ext[1] - ext[0];
    /* A tall drawing (a column fridge over a cabinet below) sits beside its
       key; a wide one (a cooktop with cabinets either side) sits above it. */
    var beside = tall > wide * 0.9;
    var key = model.marks.map(function (m) {
      return '<li><i style="background:' + esc(m.color || SW.ZONE_COLORS[m.group] || "#c77d00") + '"></i><span>' + esc(SW.roughInMarkText(m)) + "</span></li>";
    });
    pins.forEach(function (pn) {
      var u = SW.utilByKey(it, pn.key), v = u && SW.markVerdict(it, u);
      key.push('<li><i class="pin' + (pn.bad ? " bad" : "") + '"></i><span>' + esc(v ? v.text.replace(/^Found at /, pn.label + " found at ") : pn.label + " found at " + SW.posText(it, pn.x, pn.y, pn.plane)) +
        (pn.answer === "misplaced" ? " <em>Wrong place, per the installer.</em>" : pn.answer === "missing" ? " <em>Not found.</em>" : "") + "</span></li>");
    });
    var wallsOn = measured(model);
    /* the box, when something sits where the elevation cannot show it — a
       pin on the floor or a side wall — or the tech added a cabinet on site */
    var facePins = pins.some(function (pn) { return SW.FACE_PLANES[pn.plane]; });
    var added = Object.keys(it.planePhotos || {}).filter(function (pk) { return it.planePhotos[pk] && it.planePhotos[pk].added; });
    added.forEach(function (pk) { if (planes.indexOf(pk) < 0) planes.push(pk); });
    var boxHtml = "";
    if (facePins || added.length) {
      var bm = SW.boxModel(it, planes.filter(function (k) { return k !== "opening"; }));
      if (bm) boxHtml = '<div class="sw-box-fig">' + SW.boxSvg(bm, SW.BOX_VIEW, {}) + "</div>";
    }
    return '<figure class="sw-roughin-fig' + (beside ? " beside" : "") + (boxHtml ? " with-box" : "") + '">' + SW.roughInSvg(model, { planes: planes, width: "100%" }) + boxHtml +
      "<figcaption><strong>" + (pins.length ? "Connections — the sheet's locations and the walk's" : "Rough-in, from the sheet") + "</strong>" +
      '<ul class="sw-ri-key">' + key.join("") + "</ul>" +
      "<small>Measured from the left edge of the opening and up from its floor" +
      (planes.length > 1 ? "; a neighbouring cabinet from its own left edge and floor" : "") + "." +
      (wallsOn ? " W, H and D are the opening as measured at the walk; a measurement in red is out of spec, with the figure to build to under it." : "") +
      (boxHtml ? " The box shows the floor and side walls" + (added.length ? ", and the cabinet" + (added.length > 1 ? "s" : "") + " the installer added to the run on site" : "") + "." : "") + "</small></figcaption></figure>";
  }

  /* Cabinet prep as the sheet drew it, and whether it was there. */
  function prepBlock(it) {
    var list = (it.prep || []).filter(function (pr) { return !SW.isStrip(pr); });   /* strips print with their own figure */
    if (!list.length) return "";
    return '<div class="sw-basis-block sw-prep-block"><div class="sw-basis-h">Cabinet prep the sheet calls for</div>' + list.map(function (pr) {
      var st = SW.prepState(it, pr.id), ck = it.prepChecks[pr.id] || {}, kd = SW.prepKind(pr.kind);
      var word = st === "built" ? "Built as drawn" : st === "missing" ? "Not there at the walk" : st === "wrong" ? "Does not match" + (ck.note ? " — " + ck.note : "") : "Not checked at the walk";
      var text = SW.prepText(pr, it), lead = pr.label || kd.label;
      if (text.indexOf(lead + " — ") === 0) text = text.slice(lead.length + 3);
      return '<div class="sw-basis-row"><span><i style="background:' + esc(kd.color) + '"></i>' + esc(lead) + "</span><div>" + esc(text) +
        '<div class="sw-prep-answer ' + (st === "built" ? "sw-good" : st ? "sw-bad" : "sw-muted") + '">' + esc(word) + "</div></div></div>";
    }).join("") + "</div>";
  }

  function openingPages(w, it, n, total) {
    var parts = opParts(it);
    var sheets = [[]], used = 0;
    parts.forEach(function (p) {
      /* The first block never starts a page on its own account — a sheet
         always carries at least one thing. */
      /* v0.9.85: no split by estimate. The estimate left half-empty
         "(continued)" sheets behind most openings; spillPages() measures
         the real page and moves only what does not fit. */
      sheets[sheets.length - 1].push(p.html);
      used += p.cost;
    });
    var kicker = (it.area || w.project || "Site walk") + " · opening " + n + " of " + total + (SW.needsAction(it) ? "" : SW.statusOf(it) ? " · ready as built" : "");
    return sheets.map(function (blocks, i) {
      return reportPage(SW.itemTitle(it) + (i ? " (continued)" : ""),
        kicker + (i ? " · continued" : ""),
        '<div class="sw-op-block">' + blocks.join("") + "</div>", "sw-op-page",
        i ? "" : "op-" + it.id);
    }).join("");
  }

  /* ---------------- reference basis ---------------- */
  function basisPages(w) {
    var per = 7, out = [], first = true;
    for (var i = 0; i < w.items.length; i += per) {
      out.push(basisPage(w, w.items.slice(i, i + per), first, i + per >= w.items.length));
      first = false; per = 10;
    }
    return out;
  }
  function basisPage(w, rows, first, last) {
    var body = first ? '<p class="sw-intro">Which installation detail each field condition was verified against, and which details in the same spec package were deliberately not used — so the builder, the cabinet shop and the installer work from one basis.</p>' : "";
    body += '<table class="sw-tbl"><thead><tr><th>Location / model</th><th>Detail used</th><th>Required opening</th><th>Ref</th><th>Details in the package not used</th></tr></thead><tbody>' +
      rows.map(function (it) {
        var e = SW.itemEntry(it), v = SW.itemVariation(it);
        var others = e ? e.variations.filter(function (x) { return x.key !== (it.basisKey || ""); }) : [];
        return "<tr><td><strong>" + esc(it.model || SW.itemTitle(it)) + "</strong>" +
          (SW.itemWhere(it) ? "<br>" + esc(SW.itemWhere(it)) : "") + "</td>" +
          "<td>" + (v ? "<strong>" + esc(v.label) + "</strong>" : '<span style="color:#b42318">not selected</span>') + "</td>" +
          '<td class="sw-num">' + (v && SW.hasOpening(v) ? esc(SW.openingText(v)) : (SW.specSummary(it) || "—")) + "</td>" +
          "<td>" + esc((v && v.page) || it.specRef || "—") + "</td>" +
          '<td class="sw-notused">' + (others.length ? others.map(function (x) {
            return esc(x.label) + (SW.hasOpening(x) ? " " + esc(SW.openingText(x)) : "") + " (" + esc(x.page) + ")";
          }).join("; ") : "—") + "</td></tr>";
      }).join("") + "</tbody></table>";
    var title = first ? "Installation reference basis" : "Installation reference basis (continued)";
    if (!last) return reportPage(title, w.project || "Site walk", body, "sw-basis-page");
    body += '<div class="report-note-box sw-note"><strong>Not interchangeable.</strong> Where a model carries more than one installation detail, the openings differ by inches, not tolerances — the Wolf speed oven details are 8&quot; apart in width. The detail named above is the one that field condition was verified against.</div>';
    body += '<h4 class="sw-h4">Final installation verification</h4><ul class="sw-list">' +
      "<li>Field dimensions were taken during the site walk on " + esc(ui.shortDate(w.walkDate)) + " and are approximate.</li>" +
      "<li>The final installer verifies physical openings, connection reach, panel and cleat conditions, utility placement and set clearances before anchoring or installing finish panels.</li>" +
      "<li>Items marked <strong>Modification required</strong> or <strong>Response required</strong> should be closed out and confirmed to Wilson AC &amp; Appliance before the delivery is scheduled.</li></ul>";
    body += '<div class="sw-sign">Wilson AC &amp; Appliance' + (w.walkedBy ? " · walked by " + esc(w.walkedBy) : "") +
      " · " + esc(ui.shortDate(w.walkDate)) + (w.jobNo ? " · " + esc(w.jobNo) : "") + "</div>";
    return reportPage(title, w.project || "Site walk", body, "sw-basis-page");
  }

  /* ---------------- the email ---------------- */
  function emailSubject(w, r) {
    var base = "Site walk — " + (w.project || "jobsite") + (w.jobNo ? " (" + w.jobNo + ")" : "");
    if (!r.total) return base;
    if (r.attention.length) return base + " — " + r.attention.length + " item" + (r.attention.length > 1 ? "s" : "") + " to close out before delivery";
    return base + " — jobsite ready for delivery";
  }
  function emailBody(w, r, full) {
    var cap = full ? 1e6 : 8;
    var L = [];
    L.push((w.builderContact || w.builder || "Hello") + ",");
    L.push("");
    L.push("Wilson AC & Appliance completed the pre-delivery appliance site walk at " +
      (w.project || "the jobsite") + " on " + ui.shortDate(w.walkDate) + ".");
    L.push("");
    L.push(readinessLead(r));
    /* v0.9.85: the same rows, in the same order and under the same numbers,
       as page one of the packet — so "item 6" in a reply means one thing */
    var pr = punchRowsFor(w);
    if (pr.length) {
      L.push("");
      L.push("BEFORE THE APPLIANCES ARE DELIVERED");
      L.push("(the same numbers as page 1 of the attached packet)");
      var shown = pr.slice(0, cap * 2);
      shown.forEach(function (row, i) {
        if (row.head) { L.push(""); L.push(row.head.label.toUpperCase()); }
        else if (!i) L.push("");
        var parts = splitFix(row.text);
        L.push((i + 1) + ". " + parts[0] + " — " + row.where +
          (row.cosmetic ? " (cosmetic)" : "") + (row.question ? " (question)" : "") + (row.sales ? " (spec decision)" : ""));
        if (parts[1]) L.push("   " + parts[1]);
      });
      if (pr.length > shown.length) L.push(""), L.push("Items " + (shown.length + 1) + " to " + pr.length + " are on page 1 of the attached packet.");
    }
    L.push("");
    L.push("Page 1 of the attached packet is this list. Behind it, each item has its own page with the drawing, the measurements against the manufacturer's specification, the field photographs and the installation sheet.");
    L.push("");
    L.push("Please confirm these items are closed out and we will schedule the delivery.");
    L.push("");
    L.push(w.walkedBy || "Wilson AC & Appliance");
    L.push("Wilson AC & Appliance");
    return L.join("\n");
  }

  /* ---------------- toolbar + assembly ---------------- */
  function toolbar(w, r) {
    var stage = SW.stage(w);
    var blocked = r.blockers.length;
    var h = '<div class="page-title no-print"><div class="toolbar" style="margin:0">' +
      '<div><span class="eyebrow dark">Builder packet</span>' +
      "<h1>" + esc(w.project || "Site walk") + "</h1>" +
      '<p style="margin:6px 0 0;color:var(--muted)">' + esc([w.jobNo, w.builder, ui.shortDate(w.walkDate)].filter(Boolean).join("  ·  ")) + "</p></div>" +
      '<div class="inline-actions">' +
      '<a class="button ghost" href="#/office">← Queue</a>' +
      '<a class="button ghost" href="#/office/' + w.id + '">Setup</a>' +
      '<a class="button ghost" href="#/field/' + w.id + '">Field tool</a>' +
      '<span class="badge ' + (stage.code === "sent" ? "success" : stage.code === "ready-to-send" ? "warning" : "") + '">' + esc(stage.label) + "</span>" +
      "</div></div>";

    h += '<div class="sw-send">' +
      '<div class="sw-send-main">' +
      "<strong>" + esc(readinessLead(r)) + "</strong>" +
      (w.builderEmail
        ? "<span>Goes to " + esc(w.builderEmail) + (w.sentAt ? " · last sent " + ui.shortDate(w.sentAt.slice(0, 10)) : "") + "</span>"
        : '<span class="sw-send-warn">No builder email on the job record — add one in Setup, or use Copy email text.</span>') +
      "</div>" +
      '<div class="inline-actions">' +
      (w.reviewedAt
        ? '<button class="button" data-act="email"' + (w.builderEmail ? "" : " disabled") + ">Email the builder</button>"
        : '<button class="button" data-act="reviewed">' + (signing ? "Signing off…" : "Sign off — release for sending") + "</button>") +
      '<button class="button secondary" data-act="copy">Copy email text</button>' +
      '<button class="button ghost" data-act="print">Print / Save PDF</button>' +
      '<button class="button ghost" data-act="download">Download packet</button>' +
      '<a class="button ghost" href="' + esc(cavityHref("")) + '">Cavity sheets</a>' +
      "</div></div>";

    /* The person who walked it cleans up the notes and signs off before a
       builder sees it (Cayden, 16 Nov 2026 — it used to be the salesperson's
       stamp). Where the host has a login the server records who; nothing
       goes out unsigned either way. */
    if (!w.reviewedAt) {
      h += '<div class="callout info" style="margin:0 0 4px"><strong>Back from the field — sign off before it goes out.</strong> ' +
        "Clean up the notes, check the punch list against the photographs, open anything marked for builder action, then sign off. " +
        "The email button appears once it is signed off" +
        (w.walkedBy ? " — this one was walked by " + esc(w.walkedBy) : "") + ".</div>";
    } else {
      h += '<p class="disclaimer no-print" style="margin:0 0 4px">Signed off ' +
        esc(ui.shortDate(w.reviewedAt.slice(0, 10))) + (w.reviewedBy ? " by " + esc(w.reviewedBy) : "") + ".</p>";
    }

    if (blocked) {
      h += '<div class="callout danger" style="margin:0 0 4px"><strong>' + blocked +
        " installation basis " + (blocked === 1 ? "conflict" : "conflicts") + " unresolved</strong>" +
        "These print as builder decisions rather than measurements. Resolve them in the field tool if the basis was simply picked wrong.</div>";
    }
    h += '<details class="sw-preview"><summary>Preview the email text</summary><pre>' +
      esc(emailBody(w, r, false)) + "</pre></details>";
    return h + "</div>";
  }

  /* The manufacturer's own install sheet, photographed out of the spec
     package at import, printed full-page right behind the opening it
     governs — "with any photos or applicable spec pages". */
  function specSheetPage(w, it, n, total) {
    if (!it.specPage) return "";
    return [it.specPage].concat((it.specPages || []).filter(function (x) { return !x.auto; })).map(function (sp, i) {
      return specSheetOne(w, it, n, total, sp, i);
    }).join("");
  }
  function specSheetOne(w, it, n, total, sp, i) {
    var caption = [
      [it.brand, it.model].filter(Boolean).join(" "),
      sp.heading ? sp.heading.toLowerCase() : "",
      sp.pageNo ? "p." + sp.pageNo + " of the spec package" : "",
      sp.doc || ""
    ].filter(Boolean).join(" · ");
    return reportPage(SW.itemTitle(it) + " — install sheet" + (i ? " (" + (i + 1) + ")" : ""),
      (it.area || w.project || "Site walk") + " · opening " + n + " of " + total,
      '<figure class="sw-specpage" data-photo-id="' + esc(sp.photoId) + '" data-portal-id="' + esc(sp.portalId || "") + '" data-thumb="' + esc(sp.thumb || "") + '">' +
      '<div class="photo-frame">' + (sp.thumb ? '<img src="' + sp.thumb + '" alt="Manufacturer install sheet">'
        : '<span class="photo-loading">Loading…</span>') + "</div>" +
      "<figcaption>" + esc(caption) + (i ? " — attached with the installation detail." : " — the installation detail this opening was verified against.") + "</figcaption></figure>",
      "sw-specpage-page");
  }

  /* What Wilson does before the truck rolls — parts to order, sales
     decisions, notes to the crew. Printed on its own page so the builder's
     copy can drop it and the Wilson copy can lead with it. */
  function wilsonPage(w) {
    var rows = SW.wilsonItems(w), sales = SW.salesItems(w), qs = SW.questionItems(w);
    if (!rows.length && !sales.length && !qs.length) return "";
    var body = "";
    function list(items, title, intro) {
      if (!items.length) return "";
      return "<h4 class=\"sw-h4\">" + esc(title) + "</h4>" + (intro ? '<p class="sw-intro">' + esc(intro) + "</p>" : "") +
        '<ol class="corrective-list sw-acts-print">' + items.map(function (row) {
          var o = SW.ownerOf(row.f.owner);
          return "<li><span><strong>" + esc(SW.rowTitle(row.it)) + "</strong><br>" +
            esc(row.f.detail || row.f.label) + '</span><em class="sw-own who-' + o.who + '">' + esc(o.label) + "</em></li>";
        }).join("") + "</ol>";
    }
    body += list(sales, "Salesperson — spec decisions", "Raised at the walk. These also go to the salesperson's notifications.");
    body += list(rows.filter(function (x) { return SW.ownerOf(x.f.owner).k === "internal"; }), "Wilson — to order or arrange");
    body += list(rows.filter(function (x) { return SW.ownerOf(x.f.owner).k === "wilson" || x.f.kind === "note"; }), "Install crew — notes for the day");
    body += list(qs, "Open questions for the builder", "Answers needed before the order is finalised.");
    return reportPage("Wilson prep · office copy only", w.project || "Site walk",
      '<div class="callout info sw-office-only-note"><strong>Wilson only.</strong> This sheet shows on screen and is left out of the printed, saved and downloaded packet.</div>' + body,
      "sw-wilson-page no-print");
  }

  /* The order of the packet (v0.9.85): the punch list, the index, then the
     openings that need work — the pages a trade is sent to — and only then
     the openings that need nothing, for the record. Wilson's own prep list
     is last and is not part of what prints or downloads for the builder. */
  function pages(w, forBuilder) {
    var r = SW.rollup(w);
    var out = [coverPage(w, r)];
    if (w.items.length) {
      out = out.concat(summaryPages(w, r));
      var order = w.items.map(function (it, i) { return { it: it, n: i + 1 }; });
      order.filter(function (o) { return SW.needsAction(o.it); }).concat(order.filter(function (o) { return !SW.needsAction(o.it); })).forEach(function (o) {
        out.push(openingPages(w, o.it, o.n, w.items.length));
        out.push(specSheetPage(w, o.it, o.n, w.items.length));
      });
      out = out.concat(basisPages(w));
      if (!forBuilder) out.push(wilsonPage(w));
    }
    return out.join("");
  }


  /* ---------------- the marked photograph ----------------
     The one picture in the packet that ends an argument: the opening as it
     was built, with the zone the manufacturer draws laid over it in the
     same perspective and the connection the tech found pinned in it. Baked
     to a data URI once and cached, so the printed page, the downloaded
     file and the emailed copy are all the same image. */




  function hydratePhotos() {
    HOST.querySelectorAll("[data-photo-id]").forEach(function (cell) {
      var frame = cell.querySelector(".photo-frame");
      if (!frame) return;
      SW.photoUrl(cell.dataset.photoId, { walkId: walkId, portalId: cell.dataset.portalId || "" }).then(function (src) {
        if (!src) {
          if (!cell.dataset.thumb) {
            frame.innerHTML = '<span class="photo-missing">Captured in the field · not available on this device</span>';
          }
          return;
        }
        var found = SW.photoById(walk(), cell.dataset.photoId);
        frame.innerHTML = picHtml(src, "Field photograph", found ? found.photo : null);
        var img = frame.querySelector("img");
        if (img) img.onload = function () { window.URL.revokeObjectURL(src); };
      }).catch(function () { });
    });

  }

  /* ---------------- events ---------------- */
  function onClick(e) {
    var t = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!t) return;
    var w = walk(), r = SW.rollup(w), act = t.getAttribute("data-act");

    if (act === "print") { window.print(); return; }
    if (act === "copy") {
      var text = emailBody(w, r, true);
      var done = function () { ui.toast("Copied", "Paste it into Outlook or Gmail and attach the packet."); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
      } else fallbackCopy(text, done);
      return;
    }
    if (act === "reviewed") {
      if (signing) return;
      signing = true; render();
      SW.signOff(w).then(function (res) {
        signing = false;
        if (res.ok) ui.toast("Signed off", (res.by ? "By " + res.by + ". " : "") + "The email button is live.");
        else ui.toast("Not signed off", res.why || "Try again.");
        render();
      });
      return;
    }
    if (act === "email") {
      if (!w.builderEmail) return;
      var body = emailBody(w, r, false);
      var href = "mailto:" + encodeURIComponent(w.builderEmail) +
        "?subject=" + encodeURIComponent(emailSubject(w, r)) +
        "&body=" + encodeURIComponent(body);
      /* Some mail clients truncate a very long mailto. Keep the punch list
         and say so rather than silently dropping half the email. */
      if (href.length > 1900) {
        href = "mailto:" + encodeURIComponent(w.builderEmail) +
          "?subject=" + encodeURIComponent(emailSubject(w, r)) +
          "&body=" + encodeURIComponent(emailBody(w, r, false).slice(0, 1400) +
            "\n\n[The remaining items are in the attached packet. Use Copy email text for the full list.]");
      }
      window.location.href = href;
      SW.markSent(w, w.builderEmail).then(function (res) {
        if (res.ok) ui.toast("Draft opened", "Attach the packet PDF before you send. The walk is marked as sent.");
        else ui.toast("Draft opened — not marked as sent", res.why || "");
        render();
      });
      return;
    }
    if (act === "download") {
      var name = String(w.jobNo || w.project || "site-walk").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-site-walk-packet.html";
      var doc = standaloneDoc(w);
      if (window.WILSON_SW_DOWNLOAD) { window.WILSON_SW_DOWNLOAD(name, doc, "text/html"); return; }
      var a = document.createElement("a");
      var blob = new Blob([doc], { type: "text/html" });
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      ui.toast("Packet downloaded", "Open it and print to PDF to attach to the email.");
      return;
    }
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (err) { ui.toast("Could not copy", "Select the preview text and copy it manually."); }
    document.body.removeChild(ta);
  }

  /* A self-contained packet file: styles inlined, photo thumbs already data
     URIs, so it opens and prints anywhere. */
  /* =================================================================
     PRINT FOR CAVITY
     -----------------------------------------------------------------
     Hudson leaves manufacturer spec pages taped inside the opening for
     the cabinet sub. This is that page, generated: one sheet per
     opening, meant to be read from three feet away by someone holding a
     saw — the model, the numbers to build to with their datum, the
     manufacturer's drawing, ONLY this opening's corrections, and two QR
     codes: this opening in the packet, and a phone number.

     What it deliberately is not: a summary of the job. The whole packet
     stays on the builder's desk. The person in the cavity gets exactly
     what applies to that cavity.

     Honesty about the QR: until the master jobsite view exists with a
     public token link, the packet URL is the shop server's, which is
     reachable from the shop wifi and nowhere else. The sheet says so in
     small type. WILSON_SW_PUBLIC_BASE, when set, replaces it. */
  function publicBase() {
    var b = window.WILSON_SW_PUBLIC_BASE;
    if (b) return String(b).replace(/\/+$/, "");
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    return "";
  }
  function openingUrl(w, it) {
    var base = publicBase();
    var path = packetHref();
    if (!base) return "";
    if (path.charAt(0) === "#") return base + location.pathname + path + "#op-" + it.id;
    /* a query-string route: one hash on the end is all a URL gets */
    return base + "/" + path.replace(/^\//, "") + "#op-" + it.id;
  }
  function qrSvg(text, cells) {
    if (!text || typeof window.qrcode !== "function") return "";
    try {
      var q = window.qrcode(0, "M");
      q.addData(text);
      q.make();
      var n = q.getModuleCount();
      var size = cells || 4;
      /* Draw it ourselves rather than createSvgTag: no fixed pixel size,
         so CSS can scale it to the footer. */
      var d = "";
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
      return '<svg class="sw-qr" viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
        '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    } catch (e) { return ""; }
  }
  function contact(w) {
    var c = window.WILSON_SW_CONTACT || {};
    return {
      name: w.installerName || c.name || "Wilson AC & Appliance install",
      phone: w.installerPhone || c.phone || "512-894-0907"
    };
  }
  function telUrl(phone) { return "tel:+1" + String(phone || "").replace(/\D/g, "").replace(/^1/, ""); }

  /* Project and address are often the same string with a city on the end;
     printing both is the kind of thing a builder notices. */
  function jobLine(w) {
    var p = (w.project || "").trim(), a = (w.address || "").trim();
    if (!p) return a || "Site walk";
    if (!a) return p;
    var P = p.toUpperCase(), A = a.toUpperCase();
    if (A.indexOf(P) === 0) return a;      /* address is project + city */
    if (P.indexOf(A) >= 0) return p;       /* project already names the address */
    return p + " · " + a;
  }
  function cavityToolbar(w, only) {
    var it = only ? w.items.filter(function (x) { return x.id === only; })[0] : null;
    return '<div class="sw-cavity-bar no-print">' +
      "<div><strong>" + (it ? "Cavity sheet — " + esc(SW.itemTitle(it)) : "Cavity sheets — one per opening, " + w.items.length + " total") + "</strong>" +
      "<span>Tape each one inside the opening it describes. Prints one sheet per page.</span></div>" +
      '<div class="inline-actions">' +
      (it ? '<a class="button ghost" href="' + esc(cavityHref("")) + '">All openings</a>' : "") +
      '<button class="button" data-act="print">Print</button>' +
      '<a class="button ghost" href="' + esc(packetHref()) + '">Back to the packet</a>' +
      "</div></div>";
  }
  function cavityPages(w, only) {
    var list = only ? w.items.filter(function (x) { return x.id === only; }) : w.items;
    if (!list.length) return '<div class="card card-pad">No opening by that id on this walk.</div>';
    return list.map(function (it, i) { return cavitySheet(w, it, i + 1, w.items.length); }).join("");
  }

  function cavitySheet(w, it, n, total) {
    var e = SW.itemEntry(it), v = SW.itemVariation(it);
    var dims = SW.dimsFor(it);
    var hasSpec = dims.some(function (d) { return SW.num(it.spec[d.k]) != null; });
    var noOpening = v && v.noOpening;
    var c = contact(w);
    var url = openingUrl(w, it);
    var where = SW.itemWhere(it);

    /* ---- the numbers, large ---- */
    var numbers;
    if (noOpening) {
      numbers = '<div class="sw-cav-none"><strong>No rough opening</strong><span>' + esc(v.label) + " — the unit stands free. Nothing to cut.</span></div>";
    } else if (!hasSpec) {
      numbers = '<div class="sw-cav-none warn"><strong>No required dimensions on record</strong><span>The office has not verified this opening against a manufacturer sheet. Do not cut to this page.</span></div>';
    } else {
      numbers = '<div class="sw-cav-nums">' + dims.map(function (d) {
        var spec = SW.num(it.spec[d.k]);
        var rule = (it.rule && it.rule[d.k]) || (v && v.rule && v.rule[d.k]) || "";
        var act = SW.num(it.actual[d.k]);
        var vd = spec != null && act != null ? SW.verdict(it, d.k) : null;
        var txt = spec != null ? SW.specText(it, d.k) : "";
        return '<div class="sw-cav-num' + (vd && vd.state === "bad" ? " bad" : "") + (txt.length > 5 ? " long" : "") + '">' +
          "<span>" + esc(d.label) + (rule === "min" ? " · minimum" : rule === "max" ? " · maximum" : rule === "exact" ? " · exact" : rule === "range" ? " · min to max" : "") + "</span>" +
          "<strong>" + (txt ? esc(txt) : "—") + "</strong>" +
          (act != null ? "<small>measured " + esc(SW.fmtIn(act)) + (vd && vd.state === "bad" ? " — change needed" : vd ? " — OK" : "") + "</small>"
                       : "<small>not measured at the walk</small>") +
          "</div>";
      }).join("") + "</div>";
    }
    var basis = v ? esc(v.label) + (v.page ? " · " + esc(v.page) : "") : "installation detail not selected";
    var datum = "Width and height are the finished opening. Depth is from the front of the face frame to the back wall unless the drawing says otherwise.";

    /* ---- what to change here ---- */
    var findings = SW.findingsFor(it).filter(function (f) { return SW.ownerOf(f.owner).who !== "wilson" && f.kind !== "note"; });
    /* When a connection is missing, the correction already quotes the spec
       requirement — printing "Connections the spec calls for" as well says
       the same thing twice on a sheet that has one page to spend. */
    var hasUtilFix = findings.some(function (f) { return f.label === "Utility connection"; });
    var MAX = 8, more = 0;
    if (findings.length > MAX) { more = findings.length - MAX; findings = findings.slice(0, MAX); }
    var changes;
    if (!SW.isDone(it)) {
      changes = '<div class="sw-cav-none warn"><strong>Not walked yet</strong><span>This opening has not been measured. This sheet is a spec reference only.</span></div>';
    } else if (!findings.length) {
      changes = '<div class="sw-cav-clear"><strong>Nothing to change in this opening.</strong>' +
        "<span>Measured " + esc(ui.shortDate(w.walkDate)) + (w.walkedBy ? " by " + esc(w.walkedBy) : "") + ". Leave as built.</span></div>";
    } else {
      changes = '<ol class="sw-cav-list' + (findings.length > 3 ? " two" : "") + '">' + findings.map(function (f) {
        var o = SW.ownerOf(f.owner);
        return '<li class="' + (f.severity === "cosmetic" ? "cosmetic" : "") + '"><strong>' + esc(f.label) +
          ' <em class="sw-own who-' + o.who + '">' + esc(o.label) + (f.severity === "cosmetic" ? " · cosmetic" : "") + "</em></strong>" +
          (f.detail ? "<span>" + esc(f.detail) + "</span>" : "") + "</li>";
      }).join("") + "</ol>" +
      (more ? '<p class="sw-cav-more">…and ' + more + " more for this opening — see the full packet.</p>" : "");
    }

    /* ---- utilities the spec calls for ---- */
    var utils = SW.utilitiesFor(it) || [];
    var utilHtml = utils.length ? '<div class="sw-cav-utils">' + utils.map(function (u) {
      return "<div><span>" + esc(SW.utilLabel(u)) + "</span><strong>" + esc(u.need || "required") + "</strong>" +
        (u.where ? "<em>" + esc(u.where) + "</em>" : "") + "</div>";
    }).join("") + "</div>" : "";
    var ri = SW.roughInModel(it);
    if (ri && ri.marks.length) {
      var riPlanes = ["opening"];
      ri.marks.forEach(function (m) { if (riPlanes.indexOf(m.plane) < 0) riPlanes.push(m.plane); });
      utilHtml += '<div class="sw-cav-roughin">' + SW.roughInSvg(ri, { planes: riPlanes, width: "100%" }) + "</div>";
    }

    /* ---- the drawing ---- */
    var sp = it.specPage;
    var drawing = sp ? '<figure class="sw-cav-draw" data-photo-id="' + esc(sp.photoId) + '" data-portal-id="' + esc(sp.portalId || "") + '" data-thumb="' + esc(sp.thumb || "") + '">' +
      '<div class="photo-frame">' + (sp.thumb ? '<img src="' + sp.thumb + '" alt="Manufacturer install drawing">' : '<span class="photo-loading">Loading…</span>') + "</div>" +
      "<figcaption>" + esc([[it.brand, it.model].filter(Boolean).join(" "), sp.heading ? sp.heading.toLowerCase() : "", sp.pageNo ? "p." + sp.pageNo : ""].filter(Boolean).join(" · ")) + "</figcaption></figure>" : "";

    /* ---- footer: two QR codes and the plain facts ---- */
    var qrOpen = url ? qrSvg(url) : "";
    var qrTel = qrSvg(telUrl(c.phone));
    /* The shop server is reachable from the shop wifi and nowhere else;
       a hosted single-file build is reachable wherever its link is. Say
       the limitation only where it is true. */
    var lanNote = (!window.WILSON_SW_PUBLIC_BASE && url && SW.hasPortal && SW.hasPortal()) ? " Opens on the Wilson shop network." : "";

    return '<section class="report-page sw-cavity-sheet" id="cav-' + esc(it.id) + '">' +
      '<header class="sw-cav-head">' +
      '<div class="sw-cav-brand"><img src="' + logo() + '" alt="Wilson AC &amp; Appliance"></div>' +
      '<div class="sw-cav-tape">Tape inside this opening</div>' +
      '<div class="sw-cav-job">' + esc(jobLine(w)) + "<br>opening " + n + " of " + total + "</div>" +
      "</header>" +
      '<div class="sw-cav-title">' +
      "<span>" + esc(where || (it.area || "Location not set")) + "</span>" +
      "<h1>" + esc([it.brand, it.model].filter(Boolean).join(" ") || SW.itemTitle(it)) + "</h1>" +
      "<p>" + esc((e && e.appliance) || SW.itemTitle(it)) + " · " + basis + "</p>" +
      "</div>" +
      '<div class="sw-cav-body">' +
      '<div class="sw-cav-top' + (drawing ? "" : " nodraw") + '">' +
      '<div class="sw-cav-left">' +
      '<h2>Build to</h2>' + numbers +
      (hasSpec && !noOpening ? '<p class="sw-cav-datum">' + esc(datum) + "</p>" : "") +
      (SW.isMerge(it) ? '<p class="sw-cav-datum"><b>Merged opening:</b> ' + esc(SW.mergeUnits(it).map(function (u, i) { return u.model + " (" + SW.unitPos(i, SW.mergeUnits(it).length) + ")"; }).join(" + ")) + ". " + esc(SW.mergeWidthText(it)) + "</p>" : "") +
      (SW.formText(it) ? '<p class="sw-cav-datum"><b>' + esc(SW.formOf(it).label) + ":</b> " + esc(SW.formText(it)) + "</p>" : "") +
      (SW.flushText(it) ? '<p class="sw-cav-datum"><b>Flush inset:</b> ' + esc(SW.flushText(it)) + ". Setbacks from the face frame.</p>" : "") +
      flooringPrint(it) +
      (utilHtml && !hasUtilFix ? "<h2>Connections the spec calls for</h2>" + utilHtml : "") +
      ((it.panels || []).length ? "<h2>Panels</h2>" + panelsPrint(it) : "") +
      "</div>" +
      '<div class="sw-cav-right">' + drawing + "</div>" +
      "</div>" +
      '<div class="sw-cav-changes">' + "<h2>Change in this opening</h2>" + changes + "</div>" +
      "</div>" +
      '<footer class="sw-cav-foot">' +
      '<div class="sw-cav-qr">' + (qrOpen || '<div class="sw-qr-missing"></div>') + "<span>This opening<br>in the packet</span>" + (lanNote ? "<small>" + esc(lanNote.trim()) + "</small>" : "") + "</div>" +
      '<div class="sw-cav-facts">' +
      (SW.isDone(it)
        ? "<strong>Measured " + esc(ui.shortDate(w.walkDate)) + (w.walkedBy ? " by " + esc(w.walkedBy) : "") + ".</strong>" +
          "<span>If anything in this opening has changed since then, call before you cut. Neighbouring cabinets move; this one has to end up at the numbers above.</span>"
        : "<strong>Spec reference issued " + esc(ui.shortDate(SW.isoNow().slice(0, 10))) + ". Not yet measured on site.</strong>" +
          "<span>Build to the numbers above. The site walk will confirm the opening before delivery is scheduled.</span>") +
      "<span>" + esc(c.name) + " · " + esc(c.phone) + (w.jobNo ? " · job " + esc(w.jobNo) : "") + "</span>" +
      "</div>" +
      '<div class="sw-cav-qr">' + qrTel + "<span>Call the<br>installer</span></div>" +
      "</footer></section>";
  }

  /* The builder's copy: the sheets as fitted and numbered on screen, less
     anything marked office-only. Falls back to the unfitted pages when no
     packet is on screen. */
  function builderHtml(w) {
    var live = document.getElementById("sw-sheet");
    if (!live || live.classList.contains("sw-cavity-set") || !live.querySelector(".sw-cover")) return pages(w, true);
    var copy = live.cloneNode(true);
    Array.prototype.forEach.call(copy.querySelectorAll(".no-print"), function (el) { el.parentNode.removeChild(el); });
    return copy.innerHTML;
  }
  function standaloneDoc(w) {
    var css = "";
    document.querySelectorAll("style").forEach(function (s) { css += s.textContent + "\n"; });
    if (!css) {
      /* Portal build: styles are external. Reference them absolutely so the
         downloaded file still renders from the same folder. */
      css = "";
    }
    var links = "";
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
      links += '<link rel="stylesheet" href="' + l.href + '">';
    });
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>" + esc((w.jobNo ? w.jobNo + " " : "") + (w.project || "Site walk") + " — Wilson site walk packet") + "</title>" +
      links + "<style>" + css + "body{background:#e8ebed}.no-print{display:none}</style></head><body>" +
      '<main><div class="page-shell"><article class="report-sheet multi-page">' + builderHtml(w) + "</article></div></main></body></html>";
  }

  function render() {
    route();
    var w = walk();
    if (!w) {
      HOST.innerHTML = '<div class="card card-pad"><h2 style="font-size:19px;margin:0 0 6px">No walk selected</h2>' +
        '<p style="color:var(--muted)">Pick a site walk from the office queue.</p>' +
        '<a class="button" style="margin-top:12px" href="#/office">Office dashboard</a></div>';
      return;
    }
    var r = SW.rollup(w);
    if (cavity) {
      var only = cavity === "all" ? null : cavity;
      HOST.innerHTML = cavityToolbar(w, only) +
        '<div class="sw-sheet-wrap"><article class="report-sheet multi-page sw-cavity-set" id="sw-sheet">' +
        cavityPages(w, only) + "</article></div>";
      hydratePhotos();
      fit();
      return;
    }
    HOST.innerHTML = toolbar(w, r) +
      '<div class="sw-sheet-wrap"><article class="report-sheet multi-page" id="sw-sheet">' + pages(w) + "</article></div>";
    if (window.WILSON_PAGINATE) window.WILSON_PAGINATE.run(document.getElementById("sw-sheet"));
    fitCover(document.getElementById("sw-sheet"));
    spillPages(document.getElementById("sw-sheet"));
    numberPages(document.getElementById("sw-sheet"));
    hydratePhotos();
    fit();
  }
  /* The cover is one sheet. Its action list was capped by count (nine
     rows), but rows differ in height and a job with access, flooring and
     two jobsite items ran the list under the footer, where print clips it:
     the cabinet shop's and the plumber's items were simply not on the page
     (mock packet, 5 Nov). Measure instead: drop rows from the end until the
     list clears the footer, and say how many are on the opening pages. */
  /* The opening pages and the summary are split by an estimate (a cost per
     block, a row count per sheet). On paper that estimate was wrong often
     enough to matter: the mock packet's wine page lost its missing-outlet
     line and the dryer page its basis under the 11in cap (5 Nov). So after
     the estimate, measure: while anything on a sheet reaches its footer,
     move the last block (an opening's section, or a summary row) to the
     next sheet of the same thing — a new "(continued)" sheet if there is
     none — and a section heading never stays behind without its section. */
  function spillPages(sheet) {
    if (!sheet) return 0;
    var IN = 96, moved = 0, guard = 400;
    function baseTitle(pg) { var h = pg.querySelector(".report-page-header h2"); return h ? h.textContent.replace(/ \(continued\)$/, "") : ""; }
    function holder(pg) { return pg.querySelector(".sw-op-block") || pg.querySelector(".sw-tbl tbody"); }
    function over(pg) {
      var c = holder(pg); if (!c || c.children.length < 2) return false;
      var top = pg.getBoundingClientRect().top, foot = pg.querySelector(".report-page-footer");
      var fh = foot ? foot.offsetHeight : 0;
      var limit = Math.min(foot ? foot.getBoundingClientRect().top - top : 1e9, 11 * IN - fh) - 14;   /* print rounds a few px taller */
      var low = 0;
      Array.prototype.forEach.call(pg.querySelector(".report-page-body").children, function (el) {
        var r = el.getBoundingClientRect(); if (r.height) low = Math.max(low, r.bottom - top + (parseFloat(getComputedStyle(el).marginBottom) || 0));
      });
      Array.prototype.forEach.call(c.children, function (el) { var r = el.getBoundingClientRect(); if (r.height) low = Math.max(low, r.bottom - top); });
      return low > limit;
    }
    function isHead(el) { return el && (/^H[3-5]$/.test(el.tagName) || el.classList.contains("sw-h4") || el.classList.contains("sw-punch-head")); }
    function nextOf(pg) {
      var n = pg.nextElementSibling;
      if (n && n.classList.contains("report-page") && baseTitle(n) === baseTitle(pg) && holder(n)) return n;
      var clone = pg.cloneNode(true), body = clone.querySelector(".report-page-body");
      var c = holder(pg).cloneNode(false);
      body.innerHTML = "";
      if (c.tagName === "TBODY") {
        var t = pg.querySelector(".sw-tbl").cloneNode(false);
        t.appendChild(pg.querySelector(".sw-tbl thead").cloneNode(true)); t.appendChild(c); body.appendChild(t);
      } else body.appendChild(c);
      clone.removeAttribute("id");
      var h2 = clone.querySelector(".report-page-header h2");
      if (h2 && !/\(continued\)$/.test(h2.textContent)) h2.textContent += " (continued)";
      var kick = clone.querySelector(".report-page-header span");
      if (kick && !/continued/.test(kick.textContent)) kick.textContent += " · continued";
      pg.parentNode.insertBefore(clone, pg.nextSibling);
      return clone;
    }
    var pages = Array.prototype.slice.call(sheet.querySelectorAll(".report-page.sw-op-page, .report-page.sw-summary-page"));
    for (var i = 0; i < pages.length && guard > 0; i++) {
      var pg = pages[i];
      while (over(pg) && guard-- > 0) {
        var c = holder(pg), nx = nextOf(pg), dest = holder(nx);
        if (pages.indexOf(nx) < 0) pages.splice(i + 1, 0, nx);
        var el = c.lastElementChild;
        /* the photo-and-measurements block is two columns and can run taller
           than a sheet on its own: peel its right column from the bottom
           (the basis, the notes, the form's checks) before moving it whole */
        if (el.classList.contains("sw-op-cols")) {
          var rc = el.children[1];
          if (rc && rc.children.length > 1) {
            var piece = rc.lastElementChild;
            piece.classList.add("sw-peeled");
            dest.insertBefore(piece, dest.firstChild); moved++;
            continue;
          }
          if (c.children.length <= 2) break;            /* title + this: nothing sensible left to move */
        }
        if (c.children.length <= 2 && c.firstElementChild.classList.contains("sw-op-title")) break;
        dest.insertBefore(el, dest.firstChild); moved++;
        while (c.children.length > 1 && isHead(c.lastElementChild)) { dest.insertBefore(c.lastElementChild, dest.firstChild); }
      }
    }
    return moved;
  }
  /* The cover is one sheet, and every item is on the list (v0.9.85 — it
     used to drop rows and say "plus 3 further items", which is the one
     thing a punch list cannot do). Measured at the printed size: when the
     list reaches the footer, first each row gives up its second line of
     detail; if that is not enough the rows that do not fit move, in
     order, onto a "Punch list (continued)" sheet straight behind the
     cover, under their trade's heading. */
  function fitCover(sheet) {
    var cover = sheet && sheet.querySelector(".sw-cover");
    var list = cover && cover.querySelector(".sw-cover-punch ol");
    if (!list) return 0;
    var oldW = cover.style.width, oldMax = cover.style.maxWidth;
    cover.style.width = "8.5in"; cover.style.maxWidth = "8.5in";
    var IN = 96, limit = cover.getBoundingClientRect().top + 11 * IN - 0.95 * IN - 0.12 * IN;
    var tail = [cover.querySelector(".sw-pl-good")].filter(Boolean);
    function bottom() {
      var b = cover.querySelector(".sw-cover-punch").getBoundingClientRect().bottom;
      tail.forEach(function (el) { b = Math.max(b, el.getBoundingClientRect().bottom); });
      return b;
    }
    var moved = 0;
    if (bottom() > limit) list.classList.add("sw-punch-tight");
    if (bottom() > limit) {
      list.classList.remove("sw-punch-tight");
      var tmp = document.createElement("div");
      tmp.innerHTML = reportPage("Punch list (continued)", walk().project || "Site walk", '<ol class="sw-punch sw-pl sw-op-block"></ol>', "sw-op-page sw-punch-page");
      var cont = tmp.firstChild, dest = cont.querySelector("ol");
      cover.parentNode.insertBefore(cont, cover.nextSibling);
      /* the line about what is ready goes with the end of the list */
      var good = cover.querySelector(".sw-pl-good");
      if (good) { cont.querySelector(".report-page-body").appendChild(good); tail = tail.filter(function (el) { return el !== good; }); }
      var note = document.createElement("p");
      note.className = "sw-punch-more";
      cover.querySelector(".sw-cover-punch").appendChild(note);
      var guard = 200;
      while (bottom() > limit && list.children.length > 2 && guard-- > 0) {
        dest.insertBefore(list.lastElementChild, dest.firstChild); moved++;
        while (list.children.length > 1 && list.lastElementChild.classList.contains("sw-punch-head")) dest.insertBefore(list.lastElementChild, dest.firstChild);
        note.textContent = "The list continues overleaf: items " + (dest.querySelector(".sw-pl-n") || {}).textContent + " to " +
          (dest.querySelectorAll(".sw-pl-n").length ? dest.querySelectorAll(".sw-pl-n")[dest.querySelectorAll(".sw-pl-n").length - 1].textContent : "") + ".";
      }
      /* rows that crossed without their heading get it again */
      if (dest.firstElementChild && !dest.firstElementChild.classList.contains("sw-punch-head") && !dest.firstElementChild.classList.contains("sw-job-row")) {
        var heads = list.querySelectorAll(".sw-punch-head"), last = heads[heads.length - 1];
        if (last) { var again = last.cloneNode(true); again.querySelector("strong").textContent += " (continued)"; dest.insertBefore(again, dest.firstChild); }
      }
      if (!moved) { cont.parentNode.removeChild(cont); note.parentNode.removeChild(note); if (good) cover.insertBefore(good, cover.querySelector(".report-cover-footer")); }
    }
    cover.style.width = oldW; cover.style.maxWidth = oldMax;
    return moved;
  }
  /* Page numbers, once every sheet is where it will print: each footer
     says "page 4 of 17", and every reference on the punch list and the
     index is filled with the page its opening landed on. Office-only
     sheets are not counted; they do not print. */
  function numberPages(sheet) {
    if (!sheet) return;
    var pgs = Array.prototype.filter.call(sheet.querySelectorAll(".report-page"), function (pg) { return !pg.classList.contains("no-print"); });
    pgs.forEach(function (pg, i) {
      pg.setAttribute("data-page", i + 1);
      var slot = pg.querySelector(".sw-pg-no");
      if (slot) slot.textContent = " · page " + (i + 1) + " of " + pgs.length;
    });
    Array.prototype.forEach.call(sheet.querySelectorAll("[data-pageref]"), function (a) {
      var t = document.getElementById(a.getAttribute("data-pageref")), pg = t && (t.classList.contains("report-page") ? t : t.closest(".report-page"));
      a.textContent = pg && pg.getAttribute("data-page") ? "p. " + pg.getAttribute("data-page") : "";
    });
  }
  /* On a phone the sheet is wider than the screen; scale it rather than
     forcing a sideways scroll on the whole page. */
  function fit() {
    var wrap = HOST.querySelector(".sw-sheet-wrap"), sheet = document.getElementById("sw-sheet");
    if (!wrap || !sheet) return;
    var avail = wrap.clientWidth - 8;
    var z = Math.min(1, avail / 980);
    if ("zoom" in sheet.style) sheet.style.zoom = z < 1 ? String(z) : "1";
  }

  function mount(host) {
    HOST = host;
    document.body.classList.remove("tech-mode");
    host.addEventListener("click", onClick);
    window.addEventListener("hashchange", render);
    window.addEventListener("resize", fit);
    render();
    /* v0.9.83: a packet link opened on a computer that has never held the
       walk fetches it; and while it is open, newer work from the field (or a
       sign-off made elsewhere) arrives on its own. */
    SW.tidyHeld();
    var asked = new URLSearchParams(location.search).get("walk");
    if (asked && SW.hasPortal()) SW.ensureWalk(asked).then(function () { render(); });
    if (SW.liveMs()) setInterval(function () {
      if (document.hidden || signing) return;
      fetch(SW.apiUrl("walks", "/api/sitewalk/walks"), { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (b) { return b && b.ok ? SW.adoptNewer(b.walks || []) : 0; })
        .then(function (n) { if (n) render(); }).catch(function () { });
    }, SW.liveMs());
  }
  window.WILSON_SW_REPORT = { mount: mount, render: render, emailBody: emailBody, emailSubject: emailSubject, pages: pages, builderHtml: builderHtml };
})();

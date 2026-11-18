/* =============================================================
   Wilson Site Walk — spec package import
   The walk starts where the job started: the Steel Cod Full Spec
   Package the salesperson sent the builder months ago. Drop that
   PDF here and the walk sheet builds itself — models and page
   ranges off the Contents block, the job record off the cover,
   and the actual manufacturer install sheet photographed out of
   the package and attached to each opening, so the tech carries
   the drawing and the packet prints it.

   The salesperson's part is the one judgment call software must
   not make: WHICH install sheet governs. A CL4850 ships with a
   flush inset page and a standard page and the openings are not
   interchangeable, so the wizard walks model by model and makes
   the person who sold the job pick — with the pages on screen.
   ============================================================= */
(function () {
  "use strict";
  var ui = window.WilsonUI;
  var esc = function (v) { return ui.escapeHtml(v); };
  function SW() { return window.WILSON_SW; }

  /* ---------- pdf.js, from wherever this build gets it ----------
     The portal ships it as a local vendor file so the shop machine
     needs no internet; the single-file preview pulls it from the CDN,
     which is fine because importing a package is a desk job. */
  var PDFJS = window.WILSON_PDFJS || {
    lib: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
  };
  var pdfReady = null;
  function ensurePdfJs() {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS.worker;
      return Promise.resolve(window.pdfjsLib);
    }
    if (pdfReady) return pdfReady;
    pdfReady = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = PDFJS.lib;
      s.onload = function () {
        if (!window.pdfjsLib) { rej(new Error("pdf.js did not load")); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS.worker;
        res(window.pdfjsLib);
      };
      s.onerror = function () { rej(new Error("pdf.js could not be fetched")); };
      document.head.appendChild(s);
    });
    return pdfReady;
  }

  /* ---------- reading the package -------------------------------------- */

  /* Rebuild visual lines from pdf.js text items: group by y, order by x.
     Column gaps become double spaces, which is what the row regexes key on. */
  /* Some manufacturer sheets (JennAir's spec tables, for one) embed a font
     whose glyph codes sit 29 below ASCII, so the text layer reads
     "3RZHU&RUG,QFOXGHG" where the page shows "Power Cord Included". The
     drawing is fine; only the extracted text is shifted. A run is unshifted
     when the shifted version reads like words and the original does not. */
  function unshift29(s) {
    if (!s || !/[A-Z0-9$&+,\]\[\\^_@;<=>?!"#%'()*\/:.-]/.test(s)) return s;
    var out = "", i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c === 32) { out += " "; continue; }
      c += 29;
      if (c < 33 || c > 126) return s;
      out += String.fromCharCode(c);
    }
    return out;
  }
  function readsLikeWords(s) {
    var letters = (s.match(/[A-Za-z]/g) || []).length;
    var lower = (s.match(/[a-z]/g) || []).length;
    var vowels = (s.match(/[aeiouAEIOU]/g) || []).length;
    var odd = (s.match(/[^A-Za-z0-9 ,.\/()\-:;'"%&+]/g) || []).length;
    return letters >= 3 && vowels >= 1 && odd === 0 && lower >= letters * 0.6;
  }
  function fixShifted(s) {
    /* real text has lowercase; shifted text cannot (it would have landed
       past '~'). A real capital letter lands on a digit or punctuation in
       the shifted run — "3RZHU" — so one of those has to be there too, or
       "FLUSH INSET" would decode into nonsense. */
    if (/[a-z]/.test(s) || !/[!-@]/.test(s)) return s;
    var cand = unshift29(s);
    if (cand === s || !readsLikeWords(cand)) return s;
    /* the space glyph shifted off the printable range and was dropped:
       "PowerCordIncluded" — put it back before each inner capital. Then
       every word has to be a word: "JDTS3924SP" decodes to "gaqp PVOQpm",
       and that is where it is caught. */
    cand = cand.replace(/([a-z])([A-Z])/g, "$1 $2");
    var ok = cand.split(/\s+/).every(function (w) { return /^[A-Z]?[a-z]+[,.:;)]?$/.test(w) || /^[(]?[A-Z]?[a-z]+$/.test(w); });
    return ok ? cand : s;
  }

  function pageLines(tc) {
    var rows = [];
    tc.items.forEach(function (item) {
      var s = fixShifted(item.str);
      if (!s || !s.trim()) return;
      var y = item.transform[5], x = item.transform[4];
      var row = null;
      for (var i = 0; i < rows.length; i++) {
        if (Math.abs(rows[i].y - y) < 3.2) { row = rows[i]; break; }
      }
      if (!row) { row = { y: y, parts: [] }; rows.push(row); }
      row.parts.push({ x: x, s: s.trim() });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      return r.parts.map(function (p) { return p.s; }).join("  ").trim();
    });
  }

  /* The same vocabulary the office's Python parser uses, ported verbatim. */
  /* A model number can carry spaces — Miele's "DGC 7870 XL 28-30" — so the
     row is "up to four tokens, then a page range", not one token. */
  var CONTENTS_ROW = /^([A-Z0-9][A-Z0-9.\/*~\-]*(?:\s[A-Z0-9][A-Z0-9.\/*~\-]*){0,3})\s+(\d{1,3})\s*[-–]\s*(\d{1,3})(?:\s|$)/;
  var SKU_ROW = /^SKU:?\s*([A-Z0-9][A-Z0-9.\/*\-]{3,})\s*$/i;
  var VARIATION_RE = /^([A-Z0-9"'”’ \/\-]{2,44} INSTALLATION)\b/;
  /* An LG manual numbers its pages "10 INSTALLATION" — a bare number in
     front of the word is a page header, not an install variation. A real
     numeric variation carries its unit mark: 24" INSTALLATION, 60 CM. */
  var PAGE_HEADER_RE = /^\d+ INSTALLATION/;
  var ORDER_RE = /(?:Sales\s+Order|Invoice\s+Number|Quote\s+Number)\s+([A-Z]{0,2}\d{6,})/i;
  var VERSION_RE = /\bVersion\s+([\d.]+)/i;
  var EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
  var CITY_RE = /^[A-Z][A-Za-z .]+,\s*[A-Z]{2}\s+\d{5}/;
  var PHONE_RE = /\(?\d{3}\)?[ .\-]?\d{3}[ .\-]?\d{4}/;
  var KIND_TAIL = /^(.*?)\s+(Refrigeration|Dishwasher|Washer-Dryer Combo|Laundry Center|Washer|Dryer|Wall Oven|Steam Oven|Speed Oven|Warming Drawer|Cooktop|Rangetop|Ventilation Accessory|Ventilation|Microwave Drawer|Microwave|Range Hood|Range|Hood|Oven|Freezer|Ice Maker|Wine Storage|Beverage Center|Grill|Outdoor|Disposer|Accessory)$/i;

  function splitBrand(line) {
    var m = KIND_TAIL.exec(line);
    if (m) return { brand: m[1], kind: m[2] };
    return { brand: line, kind: "" };
  }

  /* The file name ends up printed on a builder's packet as the source of
     the required dimensions, so it loses the browser's download decorations
     first: a hex prefix, a "(1)" duplicate marker, underscores. */
  function tidyDocName(name) {
    var n = String(name || "spec package");
    n = n.replace(/\.pdf$/i, "");
    n = n.replace(/^[0-9a-f]{6,}[-_]/i, "");
    n = n.replace(/[_]+/g, " ");
    n = n.replace(/\s*\(\d+\)\s*$/, "");
    n = n.replace(/\s{2,}/g, " ").trim();
    return (n || "spec package") + ".pdf";
  }

  /* ---------- the PRODUCT SPECIFICATIONS block --------------------------
     The one table on these sheets that DOES extract cleanly. It carries the
     appliance's own size — never the rough opening, which lives in the
     drawing — so it is used here for two things only: context beside the
     entry fields, and a sanity check on what gets typed. It never fills a
     dimension. Confusing the two is the exact error this tool exists to
     prevent: on the CL4850 sheet the readable number is 48" (the cabinet)
     and the number you build to is a 50" flush opening. */
  var SPEC_ROW = /^([A-Z][A-Za-z /]{2,28})\s\s+(\S.*)$/;
  var APPLIANCE_DIMS = /([\d\s\/]+?)"?\s*W\s*x\s*([\d\s\/]+?)"?\s*H\s*x\s*([\d\s\/]+?)"?\s*D/i;
  var SPEC_STOP = /^(ELECTRICAL|PLUMBING|DIMENSIONS|INTERIOR VIEW|PANEL|ACCESSORIES|FEATURES|NOTE)\b/;

  function parseSheetSpecs(lines) {
    var at = -1, i;
    for (i = 0; i < lines.length; i++) {
      if (/^PRODUCT SPECIFICATIONS/i.test(lines[i])) { at = i; break; }
    }
    if (at < 0) return null;
    var out = { title: "", model: "", dimensionsText: "", appliance: null, rows: [] };
    /* the all-caps banner above the table names the product */
    for (i = at - 1; i >= 0 && i >= at - 3; i--) {
      var t = lines[i].replace(/\s\s+/g, " ").trim();
      if (t && t === t.toUpperCase() && /[A-Z]{3}/.test(t)) {
        out.title = (t + (out.title ? " " + out.title : "")).trim();
      }
    }
    for (i = at + 1; i < lines.length && out.rows.length < 14; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (SPEC_STOP.test(line.replace(/\s\s+/g, " "))) break;
      var m = SPEC_ROW.exec(line);
      if (!m) continue;
      var label = m[1].trim(), value = m[2].replace(/\s\s+/g, " ").trim();
      out.rows.push([label, value]);
      if (/^Model$/i.test(label)) out.model = value;
      if (/^Dimensions$/i.test(label)) {
        out.dimensionsText = value;
        var d = APPLIANCE_DIMS.exec(value);
        /* Note the order on these sheets is W x H x D, not W x D x H. */
        if (d) out.appliance = { w: d[1].trim(), h: d[2].trim(), d: d[3].trim() };
      }
    }
    return out.rows.length ? out : null;
  }

  function scanPackage(file) {
    return ensurePdfJs().then(function (pdfjs) {
      return file.arrayBuffer().then(function (buf) {
        return pdfjs.getDocument({ data: buf }).promise;
      });
    }).then(function (pdf) {
      var jobs = [];
      for (var p = 1; p <= pdf.numPages; p++) {
        (function (n) {
          jobs.push(pdf.getPage(n).then(function (pg) {
            return pg.getTextContent().then(pageLines);
          }));
        })(p);
      }
      return Promise.all(jobs).then(function (allLines) {
        var pkg = parsePackage(allLines);
        pkg.pdf = pdf;
        pkg.docName = tidyDocName(file.name);
        pkg.pageCount = pdf.numPages;
        return pkg;
      });
    });
  }

  function parsePackage(pages) {
    var out = {
      project: "", builder: "", address: "", quoteNo: "",
      salesName: "", salesEmail: "", version: "",
      customer: "", customerPhone: "",
      offset: 0, entries: [], headings: {}, sheetSpecs: {}, sheetDates: {}, connHints: {}, prepHints: {}, cutouts: {}
    };

    /* Where does the spec package itself begin? A "complete" file has the
       ePASS quote stapled in front; the TOC's page numbers count from the
       package cover, not the staple. */
    var start = 0;
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].some(function (l) { return /Specifications\s+for\s+Project/i.test(l); })) { start = i; break; }
    }
    out.offset = start;                       /* package p.1 = file page start+1 */

    /* The ePASS quote in front, when there is one: the client record. */
    if (start > 0) parseQuote(pages.slice(0, start), out);

    /* Cover: project lines, salesperson. */
    var cover = pages[start] || [];
    var proj = [];
    var mode = "";
    cover.forEach(function (l) {
      if (/Specifications\s+for\s+Project/i.test(l)) { mode = "proj"; return; }
      if (/^Salesperson$/i.test(l)) { mode = "sales"; return; }
      if (/REMINDER/.test(l)) { mode = ""; return; }
      if (mode === "proj" && l && !/^Salesperson/i.test(l)) proj.push(l);
      if (mode === "sales" && l) {
        var em = EMAIL_RE.exec(l);
        if (em) { out.salesEmail = out.salesEmail || em[0]; }
        else if (!out.salesName) out.salesName = l;
        return;
      }
    });
    proj = proj.filter(function (l) { return !EMAIL_RE.test(l) && !/^Powered by/i.test(l); });
    if (proj.length) {
      /* A quote-only package titles itself with the quote number; a project
         package leads with the address or project name. */
      if (/^[A-Z]?\d{6,}$/.test(proj[0])) out.quoteNo = out.quoteNo || proj[0];
      else out.project = proj[0];
      if (proj[1] && !/^\d/.test(proj[1]) && proj[1] !== out.project &&
          /LLC|INC|CONSTRUCTION|BUILDERS|HOMES|GROUP|COMPANY|CO\.?$/i.test(proj[1])) {
        out.builder = proj[1];
      }
    }

    /* Contents pages: every page after the cover that carries the standard
       footer. Their lines run together as one stream so an entry whose
       description spills onto the next Contents page still parses. */
    var tocLines = [];
    for (var t = start + 1; t < pages.length; t++) {
      var isToc = pages[t].some(function (l) { return /Note\s+about\s+page\s+numbers/i.test(l); });
      if (!isToc) break;
      tocLines = tocLines.concat(pages[t]);
      var ord = null, ver = null;
      pages[t].forEach(function (l) {
        var m = ORDER_RE.exec(l); if (m && !ord) ord = m[1];
        var v = VERSION_RE.exec(l); if (v && !ver) ver = v[1];
        if (!out.address && CITY_RE.test(l)) {
          out.address = (out.project ? out.project + ", " : "") + l.replace(/\s\s+.*$/, "");
        }
      });
      if (ord) out.quoteNo = out.quoteNo || ord;
      if (ver) out.version = out.version || ver;
    }

    var cur = null;
    tocLines.forEach(function (l) {
      var m = CONTENTS_ROW.exec(l);
      if (m) {
        if (!/\d/.test(m[1]) || m[1].length < 3) return;   /* a page range after a word is not a model */
        cur = { model: m[1].replace(/\s+/g, " ").trim(), from: +m[2], to: +m[3], brand: "", kind: "", description: "", sku: "" };
        out.entries.push(cur);
        return;
      }
      if (!cur) return;
      /* "SKU: 11876080" under a Miele row — the number ePASS orders it by.
         Kept as an alias so the ticket can be matched to the sheet. */
      var sk = SKU_ROW.exec(l.trim());
      if (sk) { cur.sku = sk[1]; return; }
      var clean = l.replace(/\s\s+/g, " ").trim();
      if (!clean) return;
      /* Page furniture: every Contents page repeats the header (project,
         salesperson, quote number, version, date) and the two notices, and
         on the showroom package that header landed mid-description —
         "RISE 30\" Single Oven … Salesperson Convection system". */
      if (/Note\s+about\s+page|Full\s+Spec\s+Package|^Contents\b|^Page\s+no\.?|Wilson\s+AC|wilsonappliance|^Salesperson|Sales\s+Order|Invoice\s+Number|Quote\s+Number|^Version\b|steelcod|specifications\s+are\s+intended|manufacturers\s+reserve|^Because the original|^way, the page|^the page number within|^without notice|^manufacturer's website|^installation\.$|^Specifications\s+for\s+Project/i.test(clean)) return;
      if (/^\d[\d\-–: ]*$/.test(clean)) return;
      if (/^[SQ]\d{8}/.test(clean)) return;
      if (/^[A-Z][a-z]{2,8},?\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(clean)) return;   /* Mon, Sep 1, 2026 */
      if (EMAIL_RE.test(clean) || PHONE_RE.test(clean)) return;
      var sales = (out.salesName || out.quoteSales || "").trim();
      if (sales && clean === sales) return;
      if (out.project && clean === out.project) return;
      if (!cur.brand) {
        var b = splitBrand(clean.split("  ")[0]);
        cur.brand = b.brand; cur.kind = b.kind;
      } else if (cur.description.length < 160) {
        cur.description = (cur.description ? cur.description + " " : "") + clean;
      }
    });

    if (!out.salesName && out.quoteSales) out.salesName = out.quoteSales;

    /* Install-variation headings, the product table, and the date the
       manufacturer cut the sheet — page by page, in package numbering. */
    for (var pp = start; pp < pages.length; pp++) {
      var pkgNo = pp - start + 1;
      pages[pp].forEach(function (l) {
        var mv = VARIATION_RE.exec(l.replace(/\s\s+/g, " ").trim());
        if (mv && mv[1] === mv[1].toUpperCase() && !PAGE_HEADER_RE.test(mv[1])) {
          (out.headings[pkgNo] = out.headings[pkgNo] || []).push(mv[1].trim());
        }
        var gd = /[Gg]enerated on ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(l);
        if (gd && !out.sheetDates[pkgNo]) out.sheetDates[pkgNo] = gd[1];
      });
      var ps = parseSheetSpecs(pages[pp]);
      if (ps) out.sheetSpecs[pkgNo] = ps;
      var hints = parseConnHints(pages[pp]);
      if (hints.length) out.connHints[pkgNo] = hints;
      var phints = parsePrepHints(pages[pp]);
      if (phints.length) out.prepHints[pkgNo] = phints;
      var cuts = parseCutouts(pages[pp]);
      if (cuts.length) out.cutouts[pkgNo] = cuts;
    }
    return out;
  }

  function parseQuote(pages, out) {
    var lines = [];
    pages.forEach(function (pl) { lines = lines.concat(pl); });
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!out.quoteNo) {
        var qm = /\b([SQ]\d{8})\b/.exec(l);
        if (qm) out.quoteNo = qm[1];
      }
      if (!out.customer && /^Bill To:/i.test(l)) {
        /* Bill To and Ship To share rows — the first column cell is the name,
           the duplicate across the gap is the ship-to copy. */
        for (var j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          var cell = lines[j].split(/\s\s+/)[0] || "";
          if (/^[A-Z][A-Z,.'\-]+(?: [A-Z,.'\-]+){0,4}$/.test(cell) && !/BILL TO|SHIP TO/i.test(cell)) {
            out.customer = cell.trim(); break;
          }
        }
      }
      if (!out.customerPhone) {
        var ph = PHONE_RE.exec(l);
        if (ph) out.customerPhone = ph[0];
      }
      if (!out.address && /^[0-9]{2,6} [A-Z0-9 .]+(?:\s\s|$)/.test(l) && !/PHONE|FAX/i.test(l)) {
        var street = l.split(/\s\s+/)[0];
        var city = "";
        if (lines[i + 1]) {
          var cm = /([A-Z][A-Za-z .]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/.exec(lines[i + 1].replace(/\s\s+/g, " "));
          if (cm) city = cm[1];
        }
        out.address = street + (city ? ", " + city : "");
      }
      /* The quote's salesperson sold the job; the package cover's salesperson
         generated the specs. The cover's name-and-email pair is the one the
         review loop notifies, so the quote's name only fills a blank. */
      if (!out.quoteSales && /Salesperson/.test(l) && lines[i + 1]) {
        var cols = lines[i + 1].split(/\s\s+/);
        for (var c = 0; c < cols.length; c++) {
          if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(cols[c])) { out.quoteSales = cols[c]; break; }
        }
      }
    }
    if (out.customer && !out.project) out.project = titleCase(out.customer);
  }
  /* The contents page's description as an appliance name: whole words,
     the colour and finish after the "|" or " - " dropped, no dangling
     "with" — "RISE 30\" Single Oven With MultiMode Convection system" is
     "RISE 30\" Single Oven", not "…MultiMode® Salesperson Convection sys". */
  function shortName(desc) {
    var t = String(desc || "").replace(/\s+/g, " ").trim();
    t = t.split(/\s[|\u2013\u2014-]\s/)[0];                 /* "… | Stainless" / " - Matte Black" */
    if (t.length > 48) t = t.replace(/\s+(with|w\/|featuring|including)\s.*$/i, "");
    if (t.length > 60) { t = t.slice(0, 60).replace(/\s+\S*$/, ""); }
    t = t.replace(/[\s,;:&-]+$/, "").replace(/\s+(and|with|or|for)$/i, "");
    return t || String(desc || "").slice(0, 60);
  }
  function titleCase(s) {
    return String(s || "").toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }

  /* ---------- choosing the page that governs ---------------------------- */

  /* Does a heading found on a page read like this library variation?
     "FLUSH INSET INSTALLATION" ~ "Flush inset"; "60 CM INSTALLATION" ~
     "60 cm install". Word-subset match, both normalized. */
  function headingMatches(heading, label) {
    var H = String(heading).toUpperCase().replace(/INSTALLATION/g, "").replace(/[^A-Z0-9 ]/g, " ");
    var words = String(label).toUpperCase().replace(/INSTALL(ATION)?/g, "").replace(/[^A-Z0-9 ]/g, " ")
      .split(/\s+/).filter(Boolean);
    if (!words.length) return false;
    return words.every(function (w) { return H.indexOf(w) >= 0; });
  }

  /* The install detail this package's own sheet names, when it names
     exactly one. A Sub-Zero section whose drawing page reads "STANDARD
     INSTALLATION" and nowhere "FLUSH INSET INSTALLATION" is a standard
     install — the office should not have to say so before the opening,
     connections and panel fill in (27 Oct: a CL4250UFD card sat blank on
     "Install not set"). Two details named, or none, and it stays a
     person's pick. Most-specific label wins a single heading ("FLUSH INSET"
     is Flush inset, not Flush); a label that splits further ("Standard ·
     27" trim") is matched on its full words first, then on its lead word,
     and two hits there is still no pick. */
  /* The install headings on a model's own pages, in order, once each. */
  function sheetInstallHeadings(en) {
    var full = entryFor(en.model) || en, out = [];
    if (!IMP.pkg || !full.from) return out;
    for (var p = full.from; p <= full.to; p++) {
      (IMP.pkg.headings[p] || []).forEach(function (hd) {
        if (/INSTALLATION/.test(hd) && !NON_INSTALL_HEADING.test(hd) && out.indexOf(hd) < 0) out.push(hd);
      });
    }
    return out;
  }
  var NON_INSTALL_HEADING = /^(ELECTRICAL|GAS|PLUMBING|WATER|DRAIN|DUCT(WORK)?|VENT(ING|ILATION)?|PRODUCT|OVERVIEW|GENERAL|PANEL|HANDLE|ACCESSORY|KIT)\b/;
  function basisFromHeadings(pkg, entry, e) {
    if (!pkg || !entry || !e || !e.variations || e.variations.length < 2) return null;
    var from = entry.from, to = entry.to;
    if (!from) return null;
    function words(label) {
      return String(label).toUpperCase().replace(/INSTALL(ATION)?/g, "").replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    }
    function lead(label) { return String(label).split(/[·(]/)[0].trim(); }
    var picked = {}, seen = [];
    for (var p = from; p <= to; p++) {
      (pkg.headings[p] || []).forEach(function (hd) {
        var best = null, bestN = 0, tie = false;
        [function (v) { return v.label; }, function (v) { return lead(v.label); }].some(function (labelOf) {
          e.variations.forEach(function (v) {
            if (!headingMatches(hd, labelOf(v))) return;
            if (SW().variationBar(e, v, entry.model)) return;
            var n = words(labelOf(v)).length;
            if (n > bestN) { best = v; bestN = n; tie = false; }
            else if (n === bestN && best && best.key !== v.key) tie = true;
          });
          return !!best;
        });
        if (best && !tie) { picked[best.key] = best; seen.push(hd); }
        else if (best && tie) picked["\u0000tie"] = true;
        /* a heading that names an install the library cannot place
           ("FLUSH INSTALLATION" on a model whose details are Standard and
           Flush inset) is a second install on the sheet — no pick */
        else if (!NON_INSTALL_HEADING.test(hd)) picked["\u0000unplaced"] = true;
      });
    }
    var keys = Object.keys(picked);
    if (keys.length !== 1 || keys[0].charAt(0) === "\u0000") return null;
    return { key: keys[0], heading: seen[0] };
  }

  /* The page to attach for an entry, given the chosen basis. Headings found
     in THIS package outrank the library's page reference, which was read
     off a different job's package. */
  function suggestPage(pkg, entry, variation) {
    var from = entry.from, to = entry.to;
    if (variation) {
      for (var p = from; p <= to; p++) {
        var hs = pkg.headings[p] || [];
        for (var i = 0; i < hs.length; i++) {
          if (headingMatches(hs[i], variation.label)) return p;
        }
      }
      var ref = /(\d+)/.exec(variation.page || "");
      if (ref && +ref[1] >= from && +ref[1] <= to) return +ref[1];
    }
    for (var p2 = from; p2 <= to; p2++) if ((pkg.headings[p2] || []).length) return p2;
    return from;
  }

  /* ---------- page rendering ------------------------------------------- */
  function renderPage(pkg, pkgPageNo, maxEdge, quality) {
    var fileNo = pkg.offset + pkgPageNo;
    return pkg.pdf.getPage(fileNo).then(function (page) {
      var vp = page.getViewport({ scale: 1 });
      var scale = maxEdge / Math.max(vp.width, vp.height);
      var v2 = page.getViewport({ scale: scale });
      var c = document.createElement("canvas");
      c.width = Math.round(v2.width); c.height = Math.round(v2.height);
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: ctx, viewport: v2 }).promise.then(function () {
        return { dataUrl: c.toDataURL("image/jpeg", quality || 0.8), width: c.width, height: c.height };
      });
    });
  }

  /* What the sheet says about hook-ups, harvested as plain lines so the
     connections block can offer them instead of asking for a retype. Only
     ever a suggestion: the person reading the drawing decides. */
  var CONN_HEAD = /^(ELECTRICAL|PLUMBING|WATER|GAS|VENTILATION|DRAIN)\b/i;
  /* A heading is the word in capitals on its own, or "Electrical Supply
     115 VAC" with a number on the line. "Gas Dryer Option WKGX301HBA" in
     a manual's feature table is neither. */
  function connHeadOf(head) {
    var m = CONN_HEAD.exec(head);
    if (!m) return null;
    var word = m[1], rest = head.slice(m[0].length);
    if (word === word.toUpperCase()) return m;
    if (/^\s*(supply|connections?|requirements?|service|hook-?up|line|drain|standpipe|valves?|duct|exhaust|outlet|receptacle|circuit|inlet)\b/i.test(rest) && (/\d/.test(rest) || rest.trim().length <= 40)) return m;
    return null;
  }
  /* page furniture that lands under a heading in a manual's text layer */
  var HINT_NOISE = /\.book\b|\bPage \d+\b|^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|^\d{1,3}$|^en-us|^\s*[•·]\s*$/i;
  /* The sheet's own cabinet-prep sentences, offered as taps under 4b:
     an anti-tip block, a cleat, a cutout, blocking behind a bracket.
     Only the line is kept; the office still draws it. */
  var PREP_HINT_RE = [
    [/anti[- ]?tip|block(?:ing)?\b|backer|backing|2\s*[x×]\s*[24]\b|blocks? against|support block|mounting support/i, "blocking"],
    [/\bcleat/i, "cleat"],
    [/\bcut[- ]?out\b.*\b(for|cord|vent|duct|hose|line)|\b(cord|vent|duct|hose|line)s?\b.*\bcut[- ]?out/i, "cutout"]
  ];
  function parsePrepHints(lines) {
    var out = [], seen = {};
    (lines || []).forEach(function (raw) {
      var line = String(raw).replace(/\s\s+/g, " ").trim();
      if (line.length < 12 || line.length > 160 || HINT_NOISE.test(line)) return;
      for (var i = 0; i < PREP_HINT_RE.length; i++) {
        if (PREP_HINT_RE[i][0].test(line)) {
          var k = PREP_HINT_RE[i][1] + "|" + line.toLowerCase();
          if (!seen[k]) { seen[k] = 1; out.push({ kind: PREP_HINT_RE[i][1], text: line }); }
          return;
        }
      }
    });
    return out.slice(0, 6);
  }
  function parseConnHints(lines) {
    var out = [], i, j;
    for (i = 0; i < lines.length; i++) {
      var head = lines[i].replace(/\s\s+/g, " ").trim();
      var m = connHeadOf(head);
      if (!m) continue;
      var group = m[1].toLowerCase();
      var key = group === "electrical" ? "power" : group === "plumbing" || group === "water" ? "water"
        : group === "ventilation" ? "vent" : group;
      var body = [];
      /* "Electrical Supply 115 VAC, 60 Hz" carries its fact on the header
         line itself; a bare "ELECTRICAL" heading has it on the lines below */
      var rest = head.slice(m[0].length).replace(/^[\s:·-]+/, "").trim();
      if (rest && /\d/.test(rest)) body.push(rest.slice(0, 120));
      for (j = i + 1; j < lines.length && body.length < 4; j++) {
        var l = lines[j].replace(/\s\s+/g, " ").trim();
        if (!l) continue;
        if (connHeadOf(l) || /^(PRODUCT SPECIFICATIONS|DIMENSIONS|NOTE|ACCESSORIES|FEATURES)\b/i.test(l)) break;
        if (HINT_NOISE.test(l)) continue;
        if (l.length > 120) l = l.slice(0, 120);
        body.push(l);
      }
      if (!body.length) continue;
      var have = out.filter(function (o) { return o.key === key; })[0];
      if (!have) { out.push({ key: key, text: body.join(" · ") }); continue; }
      /* "Electrical Supply 115 VAC" in the specifications table and an
         ELECTRICAL block lower down are the same hook-up: one hint */
      var parts = have.text.split(" · ");
      body.forEach(function (b) { if (parts.indexOf(b) < 0) parts.push(b); });
      have.text = parts.slice(0, 6).join(" · ");
    }
    return out;
  }

  /* ---------- cutout dimensions off the sheet ----------------------------
     Steel Cod's sheets are vector PDFs, so the numbers on the drawings and
     in the opening tables are text. Where a sheet says CUTOUT / ROUGH
     OPENING / OPENING DIMENSIONS and gives numbers under WIDTH HEIGHT
     DEPTH (or inline as W x H x D), the numbers are offered as a tap —
     never silently applied: a person still confirms them against the
     drawing, which is the whole point of the verify screen. */
  var VULGAR = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875, "⅓": 1 / 3, "⅔": 2 / 3, "⅙": 1 / 6, "⅚": 5 / 6 };
  function inchTokens(line) {
    var out = [], s = String(line || "").replace(/\([^)]*\)/g, " ");     /* (724 mm) */
    var re = /(\d{1,3})(?:\s*[-\s]\s*(\d{1,2})\/(\d{1,2})|\s*([¼½¾⅛⅜⅝⅞⅓⅔⅙⅚])|\.(\d{1,3}))?\s*(?:"|”|''|in\b|-in\b)/g, m;
    while ((m = re.exec(s))) {
      var v = parseInt(m[1], 10);
      if (m[2]) v += parseInt(m[2], 10) / parseInt(m[3], 10);
      else if (m[4]) v += VULGAR[m[4]] || 0;
      else if (m[5]) v = parseFloat(m[1] + "." + m[5]);
      if (v > 0 && v < 200) out.push(v);
    }
    return out;
  }
  var CUTOUT_HEAD = /(CUT-?OUT|ROUGH[\s-]*OPENING|OPENING DIMENSIONS?|CABINET OPENING|FLUSH OPENING|STANDARD OPENING|OVERLAY OPENING|RECOMMENDED OPENING|MINIMUM CABINET OPENING)/i;
  var AXIS_HEAD = /\b(WIDTH|HEIGHT|DEPTH)\b/gi;
  function parseCutouts(lines) {
    var out = [], label = "", labelAt = -99, order = null, orderAt = -99, i;
    function tidy(t) { return t.replace(/\s+/g, " ").toLowerCase().replace(/^\w/, function (c) { return c.toUpperCase(); }); }
    function push(row) {
      if (out.some(function (x) { return x.w === row.w && x.h === row.h && x.d === row.d; })) return;
      out.push(row);
    }
    for (i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/\s\s+/g, " ").trim();
      var hm = CUTOUT_HEAD.exec(l);
      if (hm) { label = tidy(hm[1]); labelAt = i; order = null; }
      /* inline: "Cutout 28 1/2" W x 19" H x 24" D" */
      var inl = /(\d[\d\s\/¼½¾⅛⅜⅝⅞.]*)"?\s*W\b[^\d]*?(\d[\d\s\/¼½¾⅛⅜⅝⅞.]*)"?\s*([HD])\b[^\d]*?(\d[\d\s\/¼½¾⅛⅜⅝⅞.]*)"?\s*([HD])\b/i.exec(l);
      if (inl && i - labelAt <= 2) {
        var vals = inchTokens(inl[1] + '" ' + inl[2] + '" ' + inl[4] + '"');
        if (vals.length === 3) {
          var o = { w: vals[0], label: label || "Cutout", line: i };
          o[inl[3].toLowerCase()] = vals[1]; o[inl[5].toLowerCase()] = vals[2];
          push(o); continue;
        }
      }
      var ax = [], am; AXIS_HEAD.lastIndex = 0;
      while ((am = AXIS_HEAD.exec(l))) ax.push(am[1].toLowerCase().charAt(0));
      if (ax.length >= 2 && i - labelAt <= 6) { order = ax; orderAt = i; continue; }
      if (order && i - orderAt <= 3) {
        var nums = inchTokens(l);
        if (nums.length >= order.length) {
          var row = { label: label || "Opening", line: i };
          order.forEach(function (k, idx) { row[k] = nums[idx]; });
          push(row);
        }
      }
    }
    return out;
  }

  /* ---------- the wizard ------------------------------------------------
     Three screens. The list: every model in the package, one row each,
     coloured by how much of it is settled. The verify screen: the sheet
     big on the left, everything about one opening on the right — install
     detail, opening (with a maximum where the sheet allows a window),
     connections, panel, the pages that travel. Then build. */
  var INSTALL_TYPES = [
    { k: "Standard", label: "Standard", tell: "Front sits proud of the cabinet faces" },
    { k: "Flush inset", label: "Flush inset", tell: "Front sits flush with the cabinet faces — a deeper opening" },
    { k: "Overlay", label: "Overlay / integrated", tell: "Behind a cabinet panel, in line with the doors" },
    { k: "Freestanding", label: "Freestanding / slide-in", tell: "Sits in a gap between cabinets" },
    { k: "Built-in", label: "Built-in", tell: "Trim kit or cabinet surround per the sheet" }
  ];
  var CONN_KINDS = [
    { k: "power", label: "Power" }, { k: "water", label: "Water supply" },
    { k: "drain", label: "Drain" }, { k: "gas", label: "Gas" }, { k: "vent", label: "Vent / duct" }
  ];
  /* What a connection is, as buttons: the sheet's numbers are a handful of
     values, and typing "240 V 20 A NEMA 6-20R" is slower and less exact
     than three taps. The type keys are the core's UTIL_TYPES keys, so the
     field's "what is there" chips line up with what was called for. */
  var CONN_SPEC = {
    power: [
      { f: "volts", opts: [["120", "120 V"], ["208", "208 V"], ["240", "240 V"]] },
      { f: "amps", opts: [["15", "15 A"], ["20", "20 A"], ["30", "30 A"], ["40", "40 A"], ["50", "50 A"]] },
      { f: "type", opts: [["5-15R", "NEMA 5-15R"], ["5-20R", "NEMA 5-20R"], ["6-20R", "NEMA 6-20R"], ["6-50R", "NEMA 6-50R"], ["14-30R", "NEMA 14-30R"], ["10-30R", "NEMA 10-30R"], ["14-50R", "NEMA 14-50R"], ["jbox-1", "Hardwire · j-box"], ["cord", "Cord & plug"]] }
    ],
    water: [{ f: "type", opts: [["1/4-T", '1/4" line'], ["3/8-T", '3/8" line'], ["1/2", '1/2" line'], ["box", "Water box"], ["hotcold", "Hot & cold"]] }],
    drain: [{ f: "type", opts: [["disposer", "Disposer inlet"], ["tailpiece", "Branch tailpiece"], ["standpipe", "Standpipe / own drain"], ["airgap", "Air gap"], ["floor", "Floor drain"], ["pump", "Pump to remote"]] }],
    gas: [{ f: "type", opts: [["1/2-shutoff", '1/2" with shutoff'], ["3/4-shutoff", '3/4" with shutoff'], ["no-shutoff", "No shutoff"], ["lp", "LP"]] }],
    vent: [{ f: "type", opts: [["6-round", '6" round'], ["7-round", '7" round'], ["8-round", '8" round'], ["10-round", '10" round'], ["3x10", '3 1/4 × 10'], ["4-dryer", '4" dryer'], ["recirc", "Recirculating"]] }]
  };
  /* Where, as two taps: which plane, then where on it. The opening's own
     back wall, the four cabinets around it, or the floor. */
  var CONN_PLANES = [
    { k: "opening", label: "In the opening" }, { k: "left", label: "Cabinet left" }, { k: "right", label: "Cabinet right" },
    { k: "above", label: "Cabinet above" }, { k: "below", label: "Cabinet below" }, { k: "floor", label: "Floor" },
    /* a dishwasher's sink cabinet: which side is not known until the walk */
    { k: "adjacent", label: "Sink cabinet beside — either side" }
  ];
  var REACH = "anywhere in it — within reach";
  var CONN_POS = {
    opening: ["top left", "top right", "bottom left", "bottom right", "centre", "low, centred"],
    left: [REACH, "front", "middle", "back", "high", "low"], right: [REACH, "front", "middle", "back", "high", "low"],
    above: [REACH, "left", "centre", "right", "at the back"], below: [REACH, "left", "centre", "right", "at the back"],
    adjacent: [REACH, "under the sink", "on the back wall, low", "at the disposal"],
    floor: ["left", "centre", "right", "at the back"]
  };
  function connSpecLabel(key, f, v) {
    var groups = CONN_SPEC[key] || [];
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].f !== f) continue;
      for (var j = 0; j < groups[i].opts.length; j++) if (groups[i].opts[j][0] === v) return groups[i].opts[j][1];
    }
    return v;
  }
  /* The sentence the sheet would have written, from the taps. */
  function connNeedText(u) {
    var bits = [];
    if (u.volts) bits.push(u.volts + " V");
    if (u.amps) bits.push(u.amps + " A");
    if (u.type) bits.push(connSpecLabel(u.key, "type", u.type));
    if (u.need) bits.push(u.need);
    return bits.join(" · ");
  }
  function connWhereText(u) {
    var pl = CONN_PLANES.filter(function (p) { return p.k === u.plane; })[0];
    var bits = [];
    if (pl) bits.push(u.pos === REACH ? "anywhere in the " + pl.label.toLowerCase().replace(/^cabinet /, "cabinet to the ").replace(/to the above/, "above").replace(/to the below/, "below").replace(/ beside — either side/, " beside it") + ", within reach" : pl.label.toLowerCase().replace(/ beside — either side/, " beside it") + (u.pos ? ", " + u.pos : ""));
    if (u.where) bits.push(u.where);
    var t = bits.join(" — ");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  }
  /* The sheet's own line, read for volts and amps so the chips light up. */
  function connFromText(u, text) {
    var v = /\b(1[12]0|115|208|2[24]0)\s*V/i.exec(text), a = /\b(15|20|30|40|50)\s*A(?:mp)?s?\b/i.exec(text);
    var vv = /Volts?\s+(1[12]0|115|208|2[24]0)/i.exec(text), aa = /Amps?\s+(15|20|30|40|50)/i.exec(text);
    if (v || vv) { var volts = (v || vv)[1]; u.volts = volts === "115" || volts === "110" ? "120" : volts === "220" ? "240" : volts; }
    if (a || aa) u.amps = (a || aa)[1];
    var n = /NEMA\s*(\d{1,2}-\d{2})/i.exec(text);
    if (n) u.type = n[1] + "R";
    else if (/hardwire|hard-wire|junction|j-box|cord included\s+no/i.test(text)) u.type = "jbox-1";
    /* what the chips now carry comes out of the note, so it is not said twice */
    u.need = text
      .replace(/\b(?:Volts?|Amps?|Hz|Watts?|Power Cord Included)\s+\S+/gi, "")
      .replace(/\bNEMA\s*\d{1,2}-\d{2}\s*R?/gi, "")
      .replace(/\b(?:1[12]0|115|208|2[24]0)(?:\/\d{3})?\s*V(?:AC)?\b/gi, "")
      .replace(/\b(?:15|20|30|40|50)\s*A(?:mps?)?\b/gi, "")
      .replace(/\b60\s*Hz\b/gi, "")
      .replace(/\s*·\s*(?=·|$)/g, "").replace(/^\s*·\s*/, "")
      .replace(/[,;]\s*(?=[,;]|$)/g, "").replace(/\s{2,}/g, " ").replace(/^[\s,;·-]+|[\s,;·-]+$/g, "").trim();
  }
  var CONN_WHERE = [
    "Top left of the opening", "Top right of the opening", "Bottom left of the opening", "Bottom right of the opening",
    "Floor, centred", "Rear wall, centred", "Adjacent cabinet, left", "Adjacent cabinet, right"
  ];
  /* Cooking and ventilation never take a cabinet panel; everything else
     gets asked. */
  var NO_PANEL_KIND = /range|cooktop|rangetop|hood|ventilation|oven|microwave|warming|grill|outdoor|laundry|washer|dryer|disposer|accessory/i;

  var IMP = blank();
  var HOST = null, rerender = null;

  function blank(by) {
    return { pkg: null, busy: "", error: "", thumbs: {}, choices: {}, done: 0, total: 0,
             step: "pick", vIdx: 0, vQueue: [], big: {}, zoom: 0, zoomAt: null, zoomScroll: null,
             by: by || "", add: null, pane: "", lib: false };
  }
  /* v0.9.85: the same screens with no walk at the end of them — a spec book
     read for the library, its numbers checked against its sheets and saved */
  function isLibrary() { return !!IMP.lib; }
  function reset() { IMP = blank(IMP ? IMP.by : ""); }

  function active() { return !!(IMP.pkg || IMP.busy || IMP.error); }

  /* The card that starts it all — one box on the queue. */
  function startCard(compact) {
    return '<div class="sw-pkg-start' + (compact ? " compact" : "") + '">' +
      "<div><h2>Start a walk from the spec package</h2>" +
      "<p>Drop the Steel Cod Full Spec Package for the job — the one the builder already has. " +
      "The walk sheet, the job record and every install sheet come out of it.</p></div>" +
      '<label class="button sw-pkg-pick">Choose the package PDF' +
      '<input type="file" accept="application/pdf,.pdf" data-act="pkgfile" hidden></label>' +
      "</div>";
  }

  function wizard() {
    if (IMP.busy) {
      return '<div class="card card-pad sw-pkg-busy"><div class="sw-pkg-spin"></div>' +
        "<strong>" + esc(IMP.busy) + "</strong>" +
        (IMP.total ? '<div class="tech-progress" style="margin-top:10px"><span style="width:' +
          Math.round((IMP.done / IMP.total) * 100) + '%"></span></div>' : "") + "</div>";
    }
    if (IMP.error) {
      var room = /out of room/.test(IMP.error);
      return '<div class="card card-pad"><span class="badge danger">' + (room ? "Could not save it" : "Could not read it") + "</span>" +
        '<p style="margin:10px 0">' + esc(IMP.error) + "</p>" +
        (room ? "" : "<p style=\"color:var(--muted);font-size:13px\">The manual paste tools on the walk setup screen still work for anything this cannot read.</p>") +
        '<div class="inline-actions">' + '<label class="button small">Try another file' +
        '<input type="file" accept="application/pdf,.pdf" data-act="pkgfile" hidden></label>' +
        '<button class="button small ghost" data-act="pkgcancel">Never mind</button></div></div>';
    }
    var pkg = IMP.pkg;
    if (!pkg) return startCard();
    if (IMP.step === "verify" && pkg.entries.length) return verifyScreen();
    return pickScreen();
  }

  /* Walks that already exist for this package's job number: the ones on this
     computer, and (where there is a server) the ones in its queue. */
  function existingWalksFor(pkg) {
    var S = SW(), key = function (v) { return String(v || "").trim().toUpperCase(); };
    var job = key(pkg && pkg.quoteNo);
    if (!job) return [];
    var out = [], seen = {};
    S.walks().forEach(function (w) {
      if (key(w.jobNo) !== job && key(w.quoteNo) !== job) return;
      seen[w.id] = true;
      out.push({ id: w.id, jobNo: w.jobNo, project: w.project, stage: S.stage(w).label, openings: w.items.length, where: "on this computer", href: S.nav("office", w.id) });
    });
    (S.serverRows ? S.serverRows() : []).forEach(function (r) {
      if (seen[r.ClientWalkId] || key(r.JobNo) !== job) return;
      out.push({ id: r.ClientWalkId, jobNo: r.JobNo, project: r.ProjectName, stage: r.StageCode, openings: r.OpeningCount || 0,
        where: "on " + S.apiUrl("serverName", "the server"), href: S.nav("office", r.ClientWalkId) });
    });
    return out;
  }

  /* ---------- the model list --------------------------------------------- */
  function pickScreen() {
    var pkg = IMP.pkg;
    var rows = pkg.entries.map(function (en) { return { en: en, st: rowStatus(en) }; });
    var readyN = rows.filter(function (r) { return r.st.ready; }).length;
    var todoN = rows.length - readyN;
    var pending = rows.filter(function (r) { return r.st.install.state === "pending"; }).length;

    var cta = todoN
      ? '<button class="button sw-pulse" data-act="pkgverify">Finish ' + todoN + " model" + (todoN === 1 ? "" : "s") + " →</button>"
      : '<button class="button" data-act="pkgbuild">Create the walk · ' + rows.length + " opening" + (rows.length === 1 ? "" : "s") + " →</button>";

    /* v0.9.84: a job that already has a walk. Nine copies of one test job
       came from re-importing its package; on a shared server everyone would
       see them. Say so, offer the walk that exists, and make building another
       a deliberate choice. */
    var dupes = editing() || IMP.lib ? [] : existingWalksFor(pkg);
    if (dupes.length && !todoN) {
      cta = '<button class="button ghost" data-act="pkgbuild">Create another walk for this job →</button>';
    }
    /* For the library (v0.9.85): no walk. Whatever has been checked against
       its sheet can be saved at any point; the rest stays to be checked. */
    var checkedN = 0;
    if (IMP.lib) {
      checkedN = pkg.entries.filter(function (en) { return dimStatus(en, choiceOf(en)) === "verified"; }).length;
      var toCheck = rows.length - checkedN;
      cta = (toCheck ? '<button class="button' + (checkedN ? " ghost" : " sw-pulse") + '" data-act="pkgverify">Check ' + toCheck + " model" + (toCheck === 1 ? "" : "s") + " against the sheet →</button>" : "") +
        (checkedN ? '<button class="button" data-act="pkglibsave">Save ' + checkedN + " checked model" + (checkedN === 1 ? "" : "s") + " to the library →</button>" : "");
    }

    var h = '<div class="page-title"><div class="toolbar" style="margin:0">' +
      (IMP.lib
        ? '<div><span class="eyebrow dark">Spec book for the library · ' + esc(pkg.docName) + "</span>" +
          "<h1>Add to the spec library</h1>" +
          '<p style="margin:6px 0 0;color:var(--muted)">No walk is created. Open each model, check its numbers against its own sheet, and save. ' +
          rows.length + " model" + (rows.length === 1 ? "" : "s") + " in this book, " + checkedN + " checked.</p></div>"
        : '<div><span class="eyebrow dark">Spec package · ' + esc(pkg.docName) + "</span>" +
          "<h1>" + esc(pkg.project || pkg.quoteNo || "New site walk") + "</h1>" +
          '<p style="margin:6px 0 0;color:var(--muted)">' +
          esc([pkg.quoteNo, pkg.salesName, rows.length + " models"].filter(Boolean).join("  ·  ")) +
          "</p></div>") +
      '<div class="inline-actions"><button class="button ghost" data-act="pkgcancel">Cancel</button>' + cta +
      "</div></div></div>";

    if (dupes.length) {
      h += '<div class="callout warning sw-pkg-dupe"><strong>' + esc(pkg.quoteNo) + " already has " + (dupes.length === 1 ? "a walk" : dupes.length + " walks") + ".</strong> " +
        "Open the one that exists unless this really is a second walk of the same job." +
        '<ul style="margin:8px 0 0;padding-left:18px">' + dupes.map(function (d) {
          return '<li><a class="text-link" href="' + esc(d.href) + '">' + esc(d.project || d.jobNo) + "</a> — " +
            esc([d.stage, d.openings + " opening" + (d.openings === 1 ? "" : "s"), d.where].filter(Boolean).join(" · ")) + "</li>";
        }).join("") + "</ul></div>";
    }

    if (!rows.length) {
      h += '<div class="card card-pad"><span class="badge warning">No contents block found</span>' +
        "<p style=\"margin:10px 0 0\">This does not look like a Full Spec Package — no model/page contents were found. " +
        "Add the models by hand below, or use the manual paste tools on the walk setup screen.</p></div>";
    }

    h += '<div class="section">';
    h += '<div class="sw-pkg-legend">' +
      '<span class="sw-pkg-count ok"><b>' + readyN + "</b> ready</span>" +
      '<span class="sw-pkg-count todo"><b>' + todoN + "</b> to finish</span>" +
      (pending ? '<span class="sw-pkg-count pending"><b>' + pending + "</b> need the install picked</span>" : "") +
      '<span class="sw-pkg-legend-hint">Open a row to read its sheet. Every number is checked by a person before ' + (IMP.lib ? "it is saved to the library" : "the walk is built") + ".</span></div>";

    h += '<div class="sw-pkg-list">';
    rows.forEach(function (r, i) { h += rowHtml(r.en, r.st, i); });
    h += "</div>";

    /* a model the contents page left out — a steam oven that was on the
       ticket, a hood liner, an accessory on its own sheet */
    h += addModelCard();
    h += "</div>";

    h += '<div class="tech-bottom-actions no-print">' +
      '<button class="button ghost" data-act="pkgcancel">Cancel</button>' + cta + "</div>";
    return h;
  }

  function chip(label, state, text) {
    return '<span class="sw-chip ' + state + '"><i>' + esc(label) + "</i>" + esc(text) + "</span>";
  }

  function rowHtml(en, st, i) {
    var ch = choiceOf(en);
    var cls = st.install.state === "pending" ? "pending" : st.ready ? "ready" : st.any ? "partial" : "todo";
    return '<div class="sw-pkg-row ' + cls + '" id="pkg-en-' + i + '" data-act="pkgverifyat" data-m="' + esc(en.model) + '">' +
      '<span class="sw-pkg-row-dot"></span>' +
      '<div class="sw-pkg-row-main"><strong>' + esc(en.model) + (en.manual ? ' <em class="sw-pkg-manual">added by hand</em>' : "") + "</strong>" +
      "<span>" + esc([[en.brand, en.kind].filter(Boolean).join(" "),
        en.from ? (en.to > en.from ? "pp." + en.from + "–" + en.to : "p." + en.from) : "no sheet in this package",
        ch.where].filter(Boolean).join(" · ")) + "</span>" +
      (en.description ? '<p class="sw-pkg-desc">' + esc(en.description.slice(0, 96)) + "</p>" : "") + "</div>" +
      '<div class="sw-pkg-row-chips">' +
      chip("Install", st.install.state, st.install.text) +
      chip("Opening", st.dims.state, st.dims.text) +
      chip("Connections", st.conn.state, st.conn.text) +
      chip("Panel", st.panel.state, st.panel.text) +
      chip("Pages", st.pages.state, st.pages.text) +
      "</div>" +
      '<span class="sw-pkg-row-go">›</span></div>';
  }

  function addModelCard() {
    var a = IMP.add;
    if (!a) {
      return '<button class="sw-pkg-addrow" data-act="pkgaddopen">+ Add a model that is not in the contents</button>';
    }
    var maxPage = IMP.pkg.pdf ? IMP.pkg.pdf.numPages - IMP.pkg.offset : 999;
    return '<div class="card card-pad sw-pkg-add"><span class="sw-label">Add a model <em>the contents page left it out</em></span>' +
      '<div class="sw-pkg-add-grid">' +
      '<label><span>Model number</span><input class="sw-input" data-pkgadd="model" value="' + esc(a.model) + '" placeholder="DGC 7870 XL" autocomplete="off"></label>' +
      '<label><span>Brand</span><input class="sw-input" data-pkgadd="brand" value="' + esc(a.brand) + '" placeholder="Miele"></label>' +
      '<label><span>What it is</span><input class="sw-input" data-pkgadd="kind" value="' + esc(a.kind) + '" placeholder="Steam oven"></label>' +
      '<label><span>Sheet pages in this package <em>optional</em></span><div class="sw-pkg-add-pages">' +
      '<input class="sw-input" inputmode="numeric" data-pkgadd="from" value="' + esc(a.from) + '" placeholder="from"> – ' +
      '<input class="sw-input" inputmode="numeric" data-pkgadd="to" value="' + esc(a.to) + '" placeholder="to">' +
      '<span class="sw-hint">of ' + maxPage + "</span></div></label>" +
      "</div>" +
      (a.error ? '<p class="sw-pkg-add-err">' + esc(a.error) + "</p>" : "") +
      '<div class="inline-actions" style="margin-top:12px">' +
      '<button class="button" data-act="pkgaddsave">Add it and read the sheet →</button>' +
      '<button class="button ghost" data-act="pkgaddcancel">Cancel</button></div></div>';
  }

  /* ---------- where each model stands ----------------------------------- */
  function rowStatus(en) {
    var S = SW(), ch = choiceOf(en), e = S.findModel(en.model);
    var st = {};

    /* install detail */
    if (e && e.variations.length > 1) {
      var v = ch.basisKey ? S.variationOf(e, ch.basisKey) : null;
      st.install = v ? { state: "ok", text: v.label } : { state: "pending", text: "pick one of " + e.variations.length };
    } else if (e) {
      st.install = { state: "ok", text: (e.variations[0] && e.variations[0].label) || "library" };
    } else {
      st.install = ch.installType ? { state: "ok", text: ch.installType } : { state: "todo", text: "not set" };
    }

    /* opening */
    var ds = dimStatus(en, ch);
    var dimsText = dimsLine(ch);
    st.dims = ds === "verified"
      ? { state: "ok", text: ch.noOpening ? "none to measure" : dimsText }
      : ds === "restale" ? { state: "warn", text: "sheet re-cut — check" }
      : ds === "unconfirmed" ? { state: "warn", text: "check " + (dimsText || "the sheet") }
      : { state: "todo", text: "read the sheet" };

    /* connections */
    var conns = connectionsFor(en, ch);
    st.conn = conns.length
      ? { state: "ok", text: conns.map(function (u) { return u.label || connLabel(u.key); }).join(" · ") }
      : (ch.utilities && !ch.utilities.length)
        ? { state: "ok", text: "none" }
        : { state: "na", text: "tech marks on the photo" };

    /* panel */
    var pr = panelReadyOf(en, ch);
    if (pr === true) {
      /* who supplies it can wait for the field — the tech has the same
         chips standing at the opening; the question here is only whether
         the unit takes a panel at all */
      var by = ch.panel.by === "wilson" ? "Wilson supplies" : ch.panel.by === "custom" ? "custom" : "supplier on site";
      st.panel = { state: "ok", text: by + (S.num(ch.panel.thicknessIn) != null ? " · " + S.fmtIn(S.num(ch.panel.thicknessIn)) : "") };
    } else if (pr === false) {
      st.panel = { state: "na", text: "not panel-ready" };
    } else {
      st.panel = { state: "todo", text: "panel-ready?" };
    }

    /* pages */
    var n = (ch.pageNo ? 1 : 0) + (ch.extraPages || []).length;
    st.pages = n ? { state: "ok", text: "p." + ch.pageNo + ((ch.extraPages || []).length ? " +" + ch.extraPages.length : "") }
                 : { state: en.from ? "todo" : "na", text: en.from ? "pick the page" : "no sheet" };

    st.ready = st.install.state === "ok" && st.dims.state === "ok" && st.panel.state !== "todo";
    st.any = ds !== "none" || !!ch.installType || !!ch.utilities || pr != null;
    return st;
  }

  function dimsLine(ch) {
    var S = SW();
    if (S.num(ch.dims.w) == null && S.num(ch.dims.d) == null && S.num(ch.dims.h) == null) return "";
    return ["w", "d", "h"].map(function (k) {
      var n = S.num(ch.dims[k]), mx = S.num(ch.dimsMax[k]);
      if (n == null) return "";
      return S.fmtIn(n) + (mx != null ? "–" + S.fmtIn(mx) : "") + " " + k.toUpperCase();
    }).filter(Boolean).join(" × ");
  }

  function connLabel(key) {
    var c = CONN_KINDS.filter(function (x) { return x.k === key; })[0];
    return c ? c.label : key;
  }

  /* Connections that will govern this opening: what the office typed off
     the sheet if it did, else what the library knows. */
  function connectionsFor(en, ch) {
    if (ch.utilities) return ch.utilities.filter(function (u) { return u.key; });
    var e = SW().findModel(en.model);
    return (e && e.utilities) ? e.utilities : [];
  }

  /* Panel-ready: what the office said, else what the library says, else
     "no" for anything that never takes a panel — a range is not asked. */
  function panelReadyOf(en, ch) {
    if (ch.panel.ready === true || ch.panel.ready === false) return ch.panel.ready;
    var e = SW().findModel(en.model);
    if (e) return !!SW().entryPanelReady(e, en.model);      /* CL4250UFD/S is stainless, /O takes panels */
    if (NO_PANEL_KIND.test([en.kind, en.description].join(" "))) return false;
    return null;
  }

  function choiceOf(en) {
    var k = en.model;
    if (!IMP.choices[k]) {
      var e = SW().findModel(en.model);
      var full = entryFor(en.model) || en;
      var basisKey = (e && e.variations.length === 1) ? e.variations[0].key : "";
      var auto = (!basisKey && e) ? basisFromHeadings(IMP.pkg, full, e) : null;
      if (auto) basisKey = auto.key;
      var v = e ? SW().variationOf(e, basisKey) : null;
      IMP.choices[k] = { basisKey: basisKey, pageNo: full.from ? suggestPage(IMP.pkg, full, v) : 0, where: "",
        dims: { w: "", d: "", h: "" }, dimsMax: { w: "", d: "", h: "" }, maxOn: {},
        extraPages: [], installType: "", utilities: null,
        panel: { ready: null, by: "", thicknessIn: "", w: "", h: "" },
        noOpening: false, confirmed: false, from: "",
        basisAuto: auto ? auto.heading : "" };
      seedDims(en.model, IMP.choices[k]);
      if (auto) seedPrep(IMP.choices[k], v);
    }
    var ch = IMP.choices[k];
    ch.__model = en.model; ch.__kind = (entryFor(en.model) || en).kind || "";
    ch.rules = ch.rules || {};
    ch.dims = ch.dims || { w: "", d: "", h: "" };
    ch.dimsMax = ch.dimsMax || { w: "", d: "", h: "" };
    ch.maxOn = ch.maxOn || {};
    ch.extraPages = ch.extraPages || [];
    ch.panel = ch.panel || { ready: null, by: "", thicknessIn: "", w: "", h: "" };
    return ch;
  }

  /* Where a card's numbers come from, and whether a person ever checked
     them against a real manufacturer sheet.

     Three sources, one standard. Cached built-in dims were read off some
     earlier package by software-assisted eyeballs and have never been
     audited. Remembered dims are somebody's earlier reading. Empty is
     empty. None of the three is trusted until a person confirms it against
     the sheet in this package — and once they have, it is not asked again
     unless the manufacturer re-cut the sheet, which the generation date on
     the page tells us.

     Memory carries more than the opening now: the install detail, the
     maximums, the connections and the panel answer come back with it, so a
     model seen once is a glance the second time. */
  function seedDims(model, ch) {
    var S = SW();
    var mem = S.rememberedDims(model, ch.basisKey);
    if (mem) {
      ch.dims = { w: mem.w || "", d: mem.d || "", h: mem.h || "" };
      ch.dimsMax = { w: (mem.max && mem.max.w) || "", d: (mem.max && mem.max.d) || "", h: (mem.max && mem.max.h) || "" };
      ["w", "d", "h"].forEach(function (k) { if (ch.dimsMax[k]) ch.maxOn[k] = true; });
      ch.noOpening = !!mem.noOpening;
      ch.installType = ch.installType || mem.installType || "";
      if (mem.rules) ch.rules = Object.assign({}, mem.rules);
      if (mem.prep && mem.prep.length && !(ch.prep && ch.prep.length)) ch.prep = JSON.parse(JSON.stringify(mem.prep));
      if (mem.utilities && !ch.utilities) ch.utilities = mem.utilities.map(function (u) { return Object.assign({}, u); });
      if (mem.panel && ch.panel.ready == null) {
        ch.panel = { ready: mem.panel.ready, by: mem.panel.by || "", thicknessIn: mem.panel.thicknessIn || "",
                     w: mem.panel.w || "", h: mem.panel.h || "" };
      }
      ch.from = "memory";
      ch.memory = mem;
      ch.confirmed = false;
      return;
    }
    var e = S.findModel(model);
    var v = e ? S.variationOf(e, ch.basisKey) : null;
    if (v && S.hasOpening(v)) {
      ch.dims = { w: v.opening.w || "", d: v.opening.d || "", h: v.opening.h || "" };
      /* a window on the sheet (a hood's 30"–36") comes with its top end,
         and a hood its own size, duct and J-box (v0.9.74) */
      var omx = v.openingMax || {};
      ch.dimsMax = { w: omx.w || "", d: omx.d || "", h: omx.h || "" }; ch.maxOn = ch.maxOn || {};
      ["w", "d", "h"].forEach(function (k) { if (ch.dimsMax[k]) ch.maxOn[k] = true; });
      if (v.hood && !ch.hood) ch.hood = JSON.parse(JSON.stringify(v.hood));
      ch.from = "cached";
      ch.confirmed = false;
      return;
    }
    /* A washer in a closet or a countertop microwave has no rough opening at
       all — the library says so, and the box comes pre-ticked rather than
       asking somebody to prove a negative. It is still one look. */
    if (v && v.noOpening) {
      ch.dims = { w: "", d: "", h: "" };
      ch.noOpening = true;
      if (v.hood && !ch.hood) ch.hood = JSON.parse(JSON.stringify(v.hood));
      ch.from = "cached";
      ch.confirmed = false;
      return;
    }
    ch.from = "";
  }

  /* The sheet this package carries for that page, by the date the
     manufacturer generated it. When that differs from the date a person
     confirmed against, the numbers get looked at again — Steel Cod
     regenerates these, and the same job's packages have carried sheets
     dated a month apart. */
  function sheetDateFor(ch) { return (IMP.pkg.sheetDates || {})[ch.pageNo] || ""; }

  function dimStatus(en, ch) {
    var S = SW();
    if (ch.confirmed) return "verified";
    var mem = ch.memory;
    if (mem && mem.confirmedAt) {
      var now = sheetDateFor(ch);
      /* No date on either side is not a mismatch — plenty of manufacturer
         manuals carry no generation stamp at all. */
      if (!now || !mem.confirmedSheetDate || now === mem.confirmedSheetDate) return "verified";
      return "restale";
    }
    if (ch.noOpening) return "unconfirmed";
    var any = S.num(ch.dims.w) != null || S.num(ch.dims.d) != null || S.num(ch.dims.h) != null;
    return any ? "unconfirmed" : "none";
  }

  /* Every model in the package needs a person's eyes — including the ones
     that arrive with cached numbers, because "cached" has never meant
     "checked". Once settled, a model drops out of this list for good. */
  function needsWork(en) { return !rowStatus(en).ready; }
  function verifyList() { return (IMP.pkg.entries || []).filter(needsWork); }
  function dimsDone(ch, en) { return dimStatus(en || {}, ch) === "verified"; }

  /* Every cutout the sheet's text layer gave up, across the model's pages,
     the page on screen first. */
  function sheetCutouts(en, ch) {
    var pkg = IMP.pkg, out = [], idx = 0;
    if (!pkg || !pkg.cutouts || !en.from) return out;
    var pages = [ch.pageNo].concat(ch.extraPages || []);
    for (var p = en.from; p <= en.to; p++) if (pages.indexOf(p) < 0) pages.push(p);
    pages.forEach(function (p) {
      (pkg.cutouts[p] || []).forEach(function (c) { out.push(Object.assign({ pageNo: p, idx: idx++ }, c)); });
    });
    return out;
  }
  function prefillFromSheet(en, ch) {
    if (ch.from || ch.touched || ch.noOpening) return;
    if (SW().num(ch.dims.w) != null || SW().num(ch.dims.h) != null) return;
    var cuts = sheetCutouts(en, ch).filter(function (c) { return c.pageNo === ch.pageNo; });
    if (cuts.length !== 1) return;
    var S = SW();
    ch.dims = { w: S.fmtFrac(cuts[0].w), d: cuts[0].d != null ? S.fmtFrac(cuts[0].d) : "", h: cuts[0].h != null ? S.fmtFrac(cuts[0].h) : "" };
    ch.from = "sheet";
    ch.confirmed = false;
  }

  /* The sanity check. The product table gives the appliance's own size,
     which is never the opening — but it bounds it. A 48" box does not go
     in a 40" hole, and it does not need a 96" one either. This challenges
     what was typed; it never fills it. */
  function dimWarning(en, ch) {
    var S = SW();
    var specs = IMP.pkg.sheetSpecs[ch.pageNo];
    var app = specs && specs.appliance;
    if (ch.noOpening) return "";
    var checks = [["w", "wide"], ["h", "tall"], ["d", "deep"]];
    for (var i = 0; app && i < checks.length; i++) {
      var k = checks[i][0];
      var typed = S.num(ch.dims[k]), unit = S.num(app[k]);
      if (typed == null || unit == null) continue;
      if (Math.abs(typed - unit) <= 1 / 16 && k !== "d") {
        return "That is the unit's own " + ({ w: "width", h: "height", d: "depth" })[k] + " (" + S.fmtIn(unit) +
          "), not the opening — the cutout is on the drawing, usually a little larger. Check it.";
      }
      if (typed < unit - 0.5) {
        return "The unit is " + S.fmtIn(unit) + " " + checks[i][1] +
          " — an opening of " + S.fmtIn(typed) + " is smaller than the appliance. Check the drawing.";
      }
      if (typed > unit + 24) {
        return "That is " + S.fmtIn(typed - unit) + " larger than the " + S.fmtIn(unit) +
          " unit. Check you have not read a wall or cabinet run dimension.";
      }
    }
    for (var j = 0; j < 3; j++) {
      var kk = ["w", "d", "h"][j];
      var lo = S.num(ch.dims[kk]), hi = S.num(ch.dimsMax[kk]);
      if (lo != null && hi != null && hi < lo) {
        return "The maximum " + ({ w: "width", d: "depth", h: "height" })[kk] + " is less than the minimum. One of them is misread.";
      }
    }
    return "";
  }

  /* How each axis is judged. The sheet rarely says; the install does: a
     flush or undercounter unit wants its width exact (reveals), a standard
     column or a freestanding unit is fine a little wide (Cayden: the True
     at 36 3/8 in a 35 1/2 opening is fine for a proud install). Depth and
     height are minimums. The chips under each box change it. */
  function defaultRule(ch, k) {
    var e = SW().findModel(ch.__model || "");
    var v = e && ch.basisKey ? SW().variationOf(e, ch.basisKey) : null;
    if (v && v.rule && v.rule[k]) return v.rule[k];
    if (k !== "w") return "min";
    var inst = (ch.installType || "").toLowerCase();
    if (ch.basisKey && /flush|overlay|integrated/i.test(ch.basisKey)) return "exact";
    if (/flush|overlay|integrated/.test(inst)) return "exact";
    if (/standard|freestanding|slide|built/.test(inst)) return "min";
    if (/dishwasher|undercounter|under-counter|drawer|ice/i.test(ch.__kind || "")) return "exact";
    return "exact";
  }
  function ruleFor(ch, k) { return (ch.rules && ch.rules[k]) || defaultRule(ch, k); }

  /* One dimension read off the sheet: typed as the trades write it. Where
     the sheet gives a window (a range whose counter may be 34 to 36 high),
     "+ max" opens the upper bound. */
  function dimInput(model, k, label, ch, big) {
    var val = ch.dims[k] || "";
    var parsed = val && SW().num(val);
    var maxOn = !!(ch.maxOn[k] || ch.dimsMax[k]);
    var mval = ch.dimsMax[k] || "";
    var mparsed = mval && SW().num(mval);
    return '<div class="sw-pkg-dimcell"><label class="sw-pkg-dim' + (val && parsed == null ? " bad" : "") + (big ? " big" : "") +
      '"><span>' + esc(label) + (maxOn ? " · min" : "") + "</span>" +
      '<input class="sw-input" inputmode="text" autocomplete="off" data-pkgdim="' + esc(model) +
      '" data-k="' + k + '" value="' + esc(val) + '" placeholder="24 1/2"></label>' +
      '<div class="sw-rule-chips">' + [["exact", "exact"], ["min", "min"], ["max", "max"]].map(function (r) {
        var on = ruleFor(ch, k) === r[0];
        return '<button type="button" class="sw-chipbtn tiny' + (on ? " on" : "") + '" data-act="pkgrule" data-m="' + esc(model) + '" data-k="' + k + '" data-v="' + r[0] + '">' + r[1] + "</button>";
      }).join("") + "</div>" +
      (maxOn
        ? '<label class="sw-pkg-dim max' + (mval && mparsed == null ? " bad" : "") + '"><span>max' +
          '<button type="button" class="sw-pkg-maxoff" data-act="pkgmaxoff" data-m="' + esc(model) + '" data-k="' + k + '" title="No maximum">×</button></span>' +
          '<input class="sw-input" inputmode="text" autocomplete="off" data-pkgmax="' + esc(model) +
          '" data-k="' + k + '" value="' + esc(mval) + '" placeholder="36"></label>'
        : '<button type="button" class="sw-pkg-maxon" data-act="pkgmaxon" data-m="' + esc(model) + '" data-k="' + k + '">+ max</button>') +
      "</div>";
  }

  /* ---------- step 2: verify ---------------------------------------------
     The whole reason this screen exists: the numbers have to be right, and
     the only way they are right is that a person read them off the
     manufacturer's drawing. So the drawing is here, big, beside the
     fields — no hunting for the PDF in another window. Read, type, next.

     A model whose numbers are already known arrives filled in; the person
     still looks, because Steel Cod re-cuts these sheets. */
  var FRACS = ["1/16", "1/8", "3/16", "1/4", "5/16", "3/8", "7/16", "1/2",
               "9/16", "5/8", "11/16", "3/4", "13/16", "7/8", "15/16"];

  /* The pass walks a queue captured when it starts, not a live filter.
     A live filter shrinks as models get confirmed, the index then points at
     a different model, and the pass silently skips the ones that shuffled
     past it — which is how five of eleven openings got through unverified
     the first time this ran. */
  function startQueue(fromModel) {
    var list = verifyList();
    IMP.vQueue = list.map(function (x) { return x.model; });
    IMP.vIdx = 0;
    if (fromModel) {
      var at = IMP.vQueue.indexOf(fromModel);
      if (at >= 0) IMP.vIdx = at;
    }
    return IMP.vQueue;
  }
  function queueEntries() {
    return (IMP.vQueue || []).map(entryFor).filter(Boolean);
  }

  function verifyScreen() {
    var S = SW();
    var list = queueEntries();
    if (!list.length) { IMP.step = "pick"; return wizard(); }
    if (IMP.vIdx >= list.length) IMP.vIdx = list.length - 1;
    if (IMP.vIdx < 0) IMP.vIdx = 0;
    var en = list[IMP.vIdx], ch = choiceOf(en);
    prefillFromSheet(en, ch);
    var st = rowStatus(en);
    var doneCount = list.filter(function (x) { return rowStatus(x).ready; }).length;
    var specs = IMP.pkg.sheetSpecs[ch.pageNo];
    var warn = dimWarning(en, ch);
    var sheetDate = IMP.pkg.sheetDates[ch.pageNo];
    var e = S.findModel(en.model);

    var edit = editing();
    var h = '<div class="page-title"><div class="toolbar" style="margin:0">' +
      '<div><span class="eyebrow dark">' + (edit ? "Edit the spec · " + esc(IMP.pkg.project || "this walk") : "Verify against the sheet") + "</span>" +
      "<h1>" + esc(en.model) + "</h1>" +
      '<p style="margin:6px 0 0;color:var(--muted)">' +
      (edit ? esc([en.brand, en.description || en.kind].filter(Boolean).join(" ")) + " · the opening, its connections and the cabinet prep — Save writes them back into this walk"
            : esc([en.brand, en.kind].filter(Boolean).join(" ")) + " · " + (IMP.vIdx + 1) + " of " + list.length + " to finish · " + doneCount + " ready") + "</p></div>" +
      '<div class="inline-actions">' +
      (edit ? '<button class="button ghost" data-act="pkgcancel">Cancel</button><button class="button" data-act="pkgeditsave">Save to the walk</button>'
            : '<button class="button ghost" data-act="pkgbackpick">← All models</button>' +
              '<button class="button' + (doneCount === list.length ? "" : " ghost") + '" data-act="pkgtoreview">Review &amp; create →</button>') +
      "</div></div></div>";

    h += '<div class="sw-verify">';

    /* ---- the drawing ---- */
    h += '<div class="sw-verify-sheet">';
    if (ch.pageNo) {
      var big = IMP.big[ch.pageNo];
      h += '<div class="sw-verify-page' + (IMP.zoom ? " zoomed z" + IMP.zoom : "") + '" data-act="pkgzoom">' +
        (big ? '<img src="' + big + '" alt="Install sheet page ' + ch.pageNo + '" draggable="false">'
             : (IMP.thumbs[ch.pageNo]
                ? '<img class="blurred" src="' + IMP.thumbs[ch.pageNo] + '" alt="Loading the page" draggable="false">'
                : '<span class="photo-loading">Rendering the page…</span>')) +
        "</div>";
      h += '<div class="sw-verify-pagebar"><span>p.' + ch.pageNo +
        (specs && specs.title ? " · " + esc(specs.title.slice(0, 60)) : "") +
        (sheetDate ? " · sheet dated " + esc(sheetDate) : "") + "</span>" +
        '<span class="sw-verify-zoomctl">' +
        '<span class="sw-verify-zoomhint">' + (IMP.zoom ? "Drag to look around · click to zoom closer" : "Click where you want to look") + "</span>" +
        '<button data-act="pkgzoomout" title="Zoom out"' + (IMP.zoom ? "" : " disabled") + ">−</button>" +
        "<b>" + (IMP.zoom ? ZOOMS[IMP.zoom] + "×" : "fit") + "</b>" +
        '<button data-act="pkgzoomin" title="Zoom in"' + (IMP.zoom >= ZOOMS.length - 1 ? " disabled" : "") + ">+</button>" +
        '<button data-act="pkgzoomfit"' + (IMP.zoom ? "" : " disabled") + ">Fit</button>" +
        "</span></div>";
    } else {
      h += '<div class="sw-verify-page none"><div><strong>No sheet in this package for this model.</strong>' +
        "<span>Read the numbers off the manufacturer's sheet and type them here; the packet will say where they came from.</span></div></div>";
    }
    if (en.from) h += '<div class="sw-verify-pages">' + pageStrip(en, ch) + "</div>";
    h += "</div>";

    /* ---- the entry side ---- */
    h += '<div class="sw-verify-form">';

    var status = dimStatus(en, ch);
    if (status !== "none" && status !== "verified") {
      var mem = ch.memory || {};
      var lead, note;
      if (status === "restale") {
        lead = "This sheet was re-cut since these numbers were checked";
        note = [mem.confirmedSheetDate ? "confirmed against a sheet dated " + mem.confirmedSheetDate : "",
                sheetDateFor(ch) ? "this one is dated " + sheetDateFor(ch) : ""].filter(Boolean).join(" · ");
      } else if (ch.from === "memory") {
        lead = "Read off a previous package — check it still matches";
        note = [mem.sourceDoc, mem.pageNo ? "p." + mem.pageNo : "",
                mem.sheetDate ? "sheet dated " + mem.sheetDate : "",
                mem.typedBy ? "by " + mem.typedBy : ""].filter(Boolean).join(" · ");
      } else if (ch.from === "sheet") {
        lead = "Read off this sheet's own text — check it against the drawing";
        note = "The numbers came from the sheet's opening table. Confirm they are the ones for this install.";
      } else if (ch.noOpening) {
        lead = "No rough opening, according to the tool — check the sheet agrees";
        note = "Freestanding, countertop or closet units have nothing to measure against.";
      } else {
        lead = "These came with the tool and have never been checked by a person";
        note = "Compare them to the drawing and correct anything that differs.";
      }
      h += '<div class="sw-verify-memory' + (status === "restale" ? " restale" : "") +
        '"><strong>' + esc(lead) + "</strong>" +
        (note ? "<span>" + esc(note) + "</span>" : "") +
        '<div class="inline-actions" style="margin-top:10px">' +
        '<button class="button small" data-act="pkgconfirm" data-m="' + esc(en.model) + '">✓ Matches this sheet</button>' +
        '<button class="button small ghost" data-act="pkgclear" data-m="' + esc(en.model) + '">Clear and retype</button>' +
        "</div></div>";
    }

    /* 1 · the install detail */
    h += '<div class="sw-vblock"><div class="sw-vblock-head"><span>1</span><strong>Install detail</strong>' +
      (st.install.state === "pending" ? '<em class="bad">pick one</em>' : "") + "</div>";
    if (e && e.variations.length > 1) {
      h += '<div class="sw-pkg-basis">' + e.variations.map(function (v) {
        var bar = S.variationBar(e, v, en.model);
        if (bar) {
          return '<button class="sw-basis-opt barred' + (ch.basisKey === v.key ? " chosen" : "") +
            '" data-act="pkgbasis" data-m="' + esc(en.model) + '" data-k="' + esc(v.key) + '">' +
            "<span><strong>" + esc(v.label) + '</strong><span class="sw-basis-bar">Not for this model — ' + esc(bar) + "</span></span>" +
            "<b>" + esc(v.page) + "</b></button>";
        }
        return '<button class="sw-basis-opt' + (ch.basisKey === v.key ? " chosen" : "") +
          '" data-act="pkgbasis" data-m="' + esc(en.model) + '" data-k="' + esc(v.key) + '">' +
          "<span><strong>" + esc(v.label) + "</strong>" +
          (S.hasOpening(v) ? '<span class="sw-basis-open">' + esc(S.openingText(v)) + "</span>" : "") +
          (v.tells && v.tells.length ? "<span>" + esc(v.tells[0]) + "</span>" : "") + "</span>" +
          "<b>" + esc(v.page) + "</b></button>";
      }).join("") + "</div>";
      var chosenV = ch.basisKey ? S.variationOf(e, ch.basisKey) : null;
      var chosenBar = chosenV ? S.variationBar(e, chosenV, en.model) : "";
      if (chosenBar) {
        h += '<div class="callout danger sw-basis-warn"><strong>' + esc(chosenV.label) + " does not apply to " + esc(en.model) + ".</strong>" +
          esc(chosenBar) + "</div>";
      }
      var drawn = sheetInstallHeadings(en);
      if (chosenV && drawn.length && !drawn.some(function (hd) { return S.headingFits(hd, chosenV.label); })) {
        h += '<div class="callout warning sw-basis-warn"><strong>The builder\'s sheet draws ' + esc(drawn.join(" and ").toLowerCase()) + ".</strong>" +
          "This package has no " + esc(chosenV.label.toLowerCase()) + " page, so the builder is likely framing to the " +
          esc(drawn[0].toLowerCase().replace(/ installation$/, "")) + " numbers. Confirm the install with the builder before walking it as " +
          esc(chosenV.label.toLowerCase()) + ".</div>";
      }
      if (ch.basisAuto && ch.basisKey) {
        h += '<p class="sw-hint sw-basis-auto">Picked from this package: the sheet is headed <strong>' +
          esc(ch.basisAuto) + "</strong> and names no other install. Tap another if the job differs.</p>";
      }
    } else if (e) {
      h += '<p class="sw-hint">' + esc((e.variations[0] && e.variations[0].label) || "Standard") + " — the only installation detail the library carries for this model." +
        ' <button class="sw-link" data-act="pkginstallother" data-m="' + esc(en.model) + '">Different on this job?</button></p>';
      if (ch.installOther) h += installChips(en, ch);
    } else {
      h += installChips(en, ch);
    }
    h += "</div>";

    /* 2 · the opening */
    h += '<div class="sw-vblock"><div class="sw-vblock-head"><span>2</span><strong>Rough opening</strong></div>';
    if (specs && specs.appliance) {
      h += '<div class="sw-verify-unit"><span>The unit itself</span><strong>' +
        esc(specs.dimensionsText) + "</strong>" +
        "<em>The opening is not this number — read it off the drawing.</em></div>";
    }
    /* the three axes carry the names the phone will use for them — a
       hood's "height" is the height above the cooking surface, a cooktop's
       "width" is the countertop cutout — so the office types the right
       number into the right box (the showroom hood got its own height) */
    var fdims = S.dimsFor(previewItem(en, ch)), fk = S.formKeyFor(previewItem(en, ch));
    var dl = {}; fdims.forEach(function (d) { dl[d.k] = d; });
    if (fk && fk !== "cavity" && S.FORMS && S.FORMS[fk]) {
      h += '<p class="sw-hint"><strong>' + esc(S.FORMS[fk].label || fk) + "</strong> — " + fdims.map(function (d) { return esc(d.label) + (d.datum ? " (" + esc(d.datum) + ")" : ""); }).join(" · ") + "</p>";
    }
    /* what the sheet's own text says the opening is — a tap fills the
       boxes, the person still confirms against the drawing */
    var cuts = sheetCutouts(en, ch);
    if (cuts.length) {
      h += '<div class="sw-cut-hints"><span class="sw-mini-label">On this sheet</span>' + cuts.map(function (c) {
        var on = S.num(ch.dims.w) === c.w && S.num(ch.dims.h) === c.h && (c.d == null || S.num(ch.dims.d) === c.d);
        return '<button class="sw-conn-hint' + (on ? " on" : "") + '" data-act="pkgcut" data-m="' + esc(en.model) + '" data-i="' + c.idx + '"><b>' + esc(c.label) + (c.pageNo !== ch.pageNo ? " · p." + c.pageNo : "") + "</b>" +
          esc(S.fmtIn(c.w) + " W" + (c.h != null ? " × " + S.fmtIn(c.h) + " H" : "") + (c.d != null ? " × " + S.fmtIn(c.d) + " D" : "")) + "</button>";
      }).join("") + "</div>";
    }
    h += '<div class="sw-pkg-dims-row big">' +
      dimInput(en.model, "w", (dl.w && dl.w.label) || "Width", ch, true) +
      dimInput(en.model, "d", (dl.d && dl.d.label) || "Depth", ch, true) +
      dimInput(en.model, "h", (dl.h && dl.h.label) || "Height", ch, true) +
      "</div>";
    h += '<div class="sw-verify-fracs">' + FRACS.map(function (f) {
      return '<button data-act="pkgfrac" data-m="' + esc(en.model) + '" data-f="' + f + '">' + f + "</button>";
    }).join("") + "</div>";
    h += '<p class="sw-hint">Click a field, then a fraction — or type it. Whole inches are fine. "+ max" is for a sheet that allows a window, like a counter that may be 34 to 36 high.</p>';
    if (warn) h += '<div class="callout warning sw-verify-warn"><strong>Worth a second look</strong>' + esc(warn) + "</div>";
    h += '<label class="sw-verify-none"><input type="checkbox" data-act="pkgnoopening" data-m="' +
      esc(en.model) + '"' + (ch.noOpening ? " checked" : "") + ">" +
      "<span><strong>No rough opening</strong> — freestanding, countertop or slide-in. Nothing to measure against.</span></label>";
    h += "</div>";

    /* 3 · connections */
    h += connectionsBlock(en, ch, e);

    /* 4 · panel */
    h += hoodBlock(en, ch, e);
    h += panelBlock(en, ch, e);
    h += prepBlock(en, ch, e);

    /* 5 · where */
    h += '<div class="sw-vblock"><div class="sw-vblock-head"><span>5</span><strong>Where is it?</strong><em>optional — the tech can fill it on site</em></div>' +
      '<input class="sw-input" data-pkgwhere="' + esc(en.model) + '" value="' + esc(ch.where) +
      '" placeholder="Kitchen run · left of the range"></div>';

    if (specs && specs.rows.length) {
      h += '<details class="sw-verify-more"><summary>What else this sheet says</summary><table>' +
        specs.rows.slice(0, 10).map(function (r) {
          return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>";
        }).join("") + "</table></details>";
    }

    h += '<div class="sw-verify-nav">' + (edit
      ? '<button class="button ghost" data-act="pkgcancel">Cancel</button><button class="button sw-pulse" data-act="pkgeditsave">Save to the walk</button>'
      : '<button class="button ghost" data-act="pkgprev"' + (IMP.vIdx ? "" : " disabled") + ">← Previous</button>" +
        '<button class="button' + (st.ready ? " sw-pulse" : " ghost") + '" data-act="pkgnext">' +
        (IMP.vIdx < list.length - 1 ? "Next model →" : "Review &amp; create →") + "</button>") +
      "</div>";

    h += "</div></div>";
    return h;
  }

  function installChips(en, ch) {
    return '<div class="sw-pkg-installs">' + INSTALL_TYPES.map(function (t) {
      return '<button class="sw-basis-opt small' + (ch.installType === t.k ? " chosen" : "") +
        '" data-act="pkginstall" data-m="' + esc(en.model) + '" data-k="' + esc(t.k) + '">' +
        "<span><strong>" + esc(t.label) + "</strong><span>" + esc(t.tell) + "</span></span></button>";
    }).join("") + "</div>";
  }

  /* ---- the rough-in drawing, drawn on ----------------------------------
     Cayden's sketch (13 Oct): type 30 × 19 × 24, the box appears; "+
     connection" → "adjacent cabinet" → the cabinets around the opening →
     click one → click-and-drag the area where the electrical or water
     goes. The core draws it; this makes it listen. */
  function drawState(ch) {
    ch.draw = ch.draw || { plane: "opening", placing: null, sizes: {} };
    return ch.draw;
  }
  /* what the next drag lands on: a connection row (a number) or a cabinet
     prep row ({prep: i}) */
  function placingTarget(ch) {
    var d = drawState(ch), p = d.placing;
    if (p == null) return null;
    if (typeof p === "object" && p.prep != null) return (ch.prep || [])[p.prep] || null;
    return (ch.utilities || [])[p] || null;
  }
  /* the row a drawn mark belongs to: a connection row, or a prep row
     ({prep: true}) — keyed the way the core keys its marks */
  function markRow(ch, key) {
    if (!key) return null;
    if (/^prep:/.test(key)) { var pr = (ch.prep || []).filter(function (x) { return "prep:" + x.id === key; })[0]; return pr ? Object.assign({ prep: true }, pr, { __pr: pr }) : null; }
    var list = ch.utilities || [];
    for (var i = 0; i < list.length; i++) if (composedKey(list, i) === key) return list[i];
    return null;
  }
  function markRowRaw(ch, key) {
    if (/^prep:/.test(key)) return (ch.prep || []).filter(function (x) { return "prep:" + x.id === key; })[0] || null;
    var list = ch.utilities || [];
    for (var i = 0; i < list.length; i++) if (composedKey(list, i) === key) return list[i];
    return null;
  }
  function placingIsPrep(ch) { var p = drawState(ch).placing; return !!(p && typeof p === "object" && p.prep != null); }
  /* The opening as the core sees it, from what has been typed so far. */
  function previewItem(en, ch) {
    var S = SW(), it = S.blankItem();
    it.model = en.model;
    it.spec.w = ch.dims.w; it.spec.h = ch.dims.h; it.spec.d = ch.dims.d;
    var e = S.findModel(en.model);
    if (e) { it.brand = e.brand; it.appliance = e.appliance; it.category = e.category || ""; if (ch.basisKey) S.applyBasis(it, ch.basisKey); it.spec.w = ch.dims.w || it.spec.w; it.spec.h = ch.dims.h || it.spec.h; }
    else { it.brand = en.brand || ""; it.appliance = en.description ? shortName(en.description) : (en.kind || en.model); it.category = (en.kind || "").toLowerCase(); }
    if (ch.utilities) { it.utilitiesSpec = composeUtilities(ch); it.utilitiesNone = !it.utilitiesSpec.length; }
    it.prep = composePrep(ch);
    if (ch.hood) it.hood = JSON.parse(JSON.stringify(ch.hood));
    if (S.num(ch.dimsMax.h) != null) it.specMax.h = S.fmtFrac(S.num(ch.dimsMax.h));
    return it;
  }
  /* ---------- ventilation: the hood's own facts ---------------------------
     A hood has no cavity; its sheet gives a height band above the cooking
     surface, the unit's size, a duct and a J-box. The office types those
     here and sees the elevation the tech will place the hood in. */
  var HOOD_TYPES = [["insert", "Insert / liner in a custom hood"], ["wall", "Wall hood"], ["island", "Island hood"], ["undercab", "Under-cabinet"]];
  var HOOD_DUCTS = ['6" round', '8" round', '10" round', '12" round', '3 1/4 × 10', '3 1/4 × 14'];
  function isHoodish(en, ch, e) {
    var S = SW(), it = previewItem(en, ch), fk = S.formKeyFor(it);
    return fk === "hood" || fk === "shroud";
  }
  function hoodBlock(en, ch, e) {
    if (!isHoodish(en, ch, e)) return "";
    var S = SW(), hd = ch.hood = ch.hood || { type: "insert", under: "cooktop", duct: {} };
    hd.duct = hd.duct || {};
    var it = previewItem(en, ch), m = S.hoodModel(it);
    function inp(f, label, ph, sub) {
      var v = sub ? (hd.duct[f] || "") : (hd[f] || "");
      return '<label><span>' + esc(label) + '</span><input class="sw-input" data-pkghood="' + esc(en.model) + '" data-f="' + f + '"' + (sub ? ' data-sub="duct"' : "") + ' value="' + esc(v) + '" placeholder="' + esc(ph || "") + '"></label>';
    }
    var h = '<div class="sw-vblock"><div class="sw-vblock-head"><span>3b</span><strong>Ventilation</strong><em>the hood over the cooking surface — the band comes from the Height (and + max) above</em></div>';
    h += '<div class="sw-conn-kinds">' + HOOD_TYPES.map(function (t) {
      return '<button class="sw-chipbtn' + (hd.type === t[0] ? " on" : "") + '" data-act="pkghoodset" data-m="' + esc(en.model) + '" data-f="type" data-v="' + t[0] + '">' + esc(t[1]) + "</button>";
    }).join("") + "</div>";
    h += '<div class="sw-conn-kinds"><span class="sw-hint" style="margin-right:6px">Under it:</span>' + S.HOOD_UNDER.map(function (u) {
      return '<button class="sw-chipbtn' + (hd.under === u.k ? " on" : "") + '" data-act="pkghoodset" data-m="' + esc(en.model) + '" data-f="under" data-v="' + u.k + '">' + esc(u.label) + "</button>";
    }).join("") + "</div>";
    h += '<div class="sw-prep-fields">' + inp("w", "Hood / liner width", "34 3/8") + inp("h", "Hood / liner height", hd.type === "insert" ? "12" : "18") + inp("d", "Depth", "22 1/2") + inp("cookW", "Cooktop / range width", "36") + "</div>";
    h += '<div class="sw-conn-kinds"><span class="sw-hint" style="margin-right:6px">Duct:</span>' + HOOD_DUCTS.map(function (d) {
      return '<button class="sw-chipbtn' + (hd.duct.size === d ? " on" : "") + '" data-act="pkghoodset" data-m="' + esc(en.model) + '" data-f="size" data-sub="duct" data-v="' + esc(d) + '">' + esc(d) + "</button>";
    }).join("") + ["vertical", "rear", "either"].map(function (d) {
      return '<button class="sw-chipbtn' + (hd.duct.dir === d ? " on" : "") + '" data-act="pkghoodset" data-m="' + esc(en.model) + '" data-f="dir" data-sub="duct" data-v="' + d + '">' + d + "</button>";
    }).join("") + "</div>";
    h += '<div class="sw-prep-fields">' + inp("fromBack", "Collar from the back wall", "11", true) + inp("fromCL", "Collar off the centreline (+ right)", "0", true) +
      inp("jbox", "J-box / receptacle, per the sheet", "in the cavity above the liner · 120 V 15 A dedicated · hard-wired") + "</div>";
    h += '<div class="sw-hood-fig">' + (m ? S.hoodSvg(m, { width: "100%" }) : "") + "</div>";
    h += '<p class="sw-hint">' + (hd.type === "insert"
      ? "An insert or liner: the tech walks the custom shroud — its cutout against the sheet\'s (the Width and Depth above), its bottom above the cooking surface, the room inside for the insert, and the duct and power brought in. "
      : "A finished hood: the tech places it from the height above the cooking surface and the centre offset. ") +
      "Collar position and the J-box are drawing-only on most sheets — read them off the illustrated page.</p>";
    return h + "</div>";
  }
  function roughInBlock(en, ch, list) {
    var S = SW(), d = drawState(ch);
    var it = previewItem(en, ch);
    var model = S.roughInModel(it, planeSizes(ch));
    if (!model) {
      return '<p class="sw-hint">Type the opening width and height above and the drawing appears here — then each connection can be drawn where the sheet puts it.</p>';
    }
    if (!model.planes[d.plane]) d.plane = "opening";        /* a cabinet this opening cannot have (below a fridge) */
    var placing = placingTarget(ch);
    var h = '<div class="sw-ri-wrap" data-m="' + esc(en.model) + '">';
    if (placing && placingIsPrep(ch)) {
      h += '<div class="sw-ri-placing">Drag the <strong>' + esc((placing.label || S.prepKind(placing.kind).label).toLowerCase()) + "</strong> on <strong>" +
        esc(model.planes[d.plane].label) + "</strong> where the sheet draws it. Click another cabinet to place it there instead.</div>";
    } else if (placing) {
      var pstd = S.stdBox(placing);
      h += '<div class="sw-ri-placing">' + (pstd ? "Click on <strong>" + esc(model.planes[d.plane].label) + "</strong> where the sheet puts the " + esc(connLabel(placing.key).toLowerCase()) +
          " — a " + esc(pstd.name) + " (" + esc(S.fmtIn(pstd.w)) + " × " + esc(S.fmtIn(pstd.h)) + ") lands there; drag instead for an area."
        : "Click on <strong>" + esc(model.planes[d.plane].label) + "</strong> where the sheet puts the " + esc(connLabel(placing.key).toLowerCase()) + " for a point, or drag an area.") +
        " Click another cabinet to place it there instead.</div>";
    } else {
      h += '<div class="sw-ri-bar"><strong>Rough-in drawing</strong><span>the opening ' + esc(S.fmtIn(model.opening.w)) + " × " + esc(S.fmtIn(model.opening.h)) +
        ", and the cabinets around it. Press <b>✎ Draw it</b> on a connection, then drag where it goes.</span></div>";
    }
    /* all five planes while the opening is the subject; once a neighbour
       is picked the picture closes in on it and the opening — the sketch's
       "click → it expands" */
    var usesAdj = (ch.utilities || []).some(function (u) { return u.plane === "adjacent" || (u.zone && u.zone.plane === "adjacent"); });
    var shown = (d.plane === "opening" ? ["opening", "left", "right", "above", "below"].concat(usesAdj ? ["adjacent"] : []) : ["opening", d.plane]).filter(function (k) { return !!model.planes[k]; });
    h += S.roughInSvg(model, { interactive: true, active: d.plane, planes: shown, selected: placing ? "" : (d.selected || "") });
    if (!placing && d.selected) {
      var selU = markRow(ch, d.selected), selZ = selU && selU.zone, selStd = selU && !selU.prep ? S.stdBox(selU) : null;
      h += '<div class="sw-ri-bar sw-ri-selbar"><span>Drag a corner to resize, the box to move' + (selZ && selZ.kind === "rect" ? " — <b>" + esc(S.fmtIn(Math.abs(selZ.x1 - selZ.x0))) + " × " + esc(S.fmtIn(Math.abs(selZ.y1 - selZ.y0))) + "</b>" : "") + "</span>" +
        (selStd && selZ && selZ.kind === "rect" ? '<button class="sw-link" data-act="pkgristd" data-m="' + esc(en.model) + '">Standard size (' + esc(selStd.name) + ")</button>" : "") +
        '<button class="sw-link" data-act="pkgrisel" data-m="' + esc(en.model) + '" data-key="">Done</button></div>';
    }
    if (d.plane !== "opening") h += '<div class="sw-ri-bar"><button class="sw-link" data-act="pkgriplane" data-m="' + esc(en.model) + '" data-v="opening">← Show all the cabinets</button></div>';
    /* the neighbouring cabinet's size, when one is in play */
    if (d.plane !== "opening") {
      var sz = planeSizes(ch)[d.plane];
      var side = (d.plane === "left" || d.plane === "right");
      h += '<div class="sw-ri-sizes"><span>' + esc(model.planes[d.plane].label) + (side ? " is" : " is") + "</span>" +
        '<input class="sw-input" data-pkgplane="' + esc(en.model) + '" data-p="' + d.plane + '" data-f="' + (side ? "w" : "h") + '" value="' + esc(side ? sz.w : sz.h) + '">' +
        "<span>" + (side ? "wide" : "tall") + " — change it if you know the cabinet</span></div>";
    }
    if (model.marks.length) {
      h += '<div class="sw-ri-list">' + model.marks.map(function (m) {
        if (m.prep) {
          var pi = (ch.prep || []).map(function (x) { return "prep:" + x.id; }).indexOf(m.key);
          return "<div><span><i style=\"background:" + esc(m.color) + '"></i>' + esc(S.roughInMarkText(m)) + "</span>" +
            (pi >= 0 ? '<button class="sw-link" data-act="pkgprepclear" data-m="' + esc(en.model) + '" data-i="' + pi + '">clear</button>' : "") + "</div>";
        }
        var idx = list.map(function (u, i) { return u.key && composedKey(list, i) === m.key ? i : -1; }).filter(function (i) { return i >= 0; })[0];
        return "<div><span><i style=\"background:" + esc(S.ZONE_COLORS[m.group] || "#c77d00") + '"></i>' + esc(S.roughInMarkText(m)) + "</span>" +
          (idx != null && idx >= 0 ? '<button class="sw-link" data-act="pkgriclear" data-m="' + esc(en.model) + '" data-i="' + idx + '">clear</button>' : "") + "</div>";
      }).join("") + "</div>";
    }
    return h + "</div>";
  }
  function planeSizes(ch) {
    var d = drawState(ch), S = SW(), out = JSON.parse(JSON.stringify(S.PLANE_DEFAULT));
    Object.keys(d.sizes || {}).forEach(function (k) {
      if (!out[k]) return;
      var v = S.num(d.sizes[k]);
      if (v) { if (out[k].w != null) out[k].w = v; else out[k].h = v; }
    });
    return out;
  }
  /* the key a row gets once duplicates are numbered — the same rule as
     applyChoice, so the drawing and the walk agree */
  function composedKey(list, i) {
    var n = 0;
    for (var j = 0; j <= i; j++) if (list[j].key === list[i].key) n++;
    return n > 1 ? list[i].key + n : list[i].key;
  }
  function composePrep(ch) {
    return (ch.prep || []).filter(function (pr) { return pr.kind; }).map(function (pr, i) {
      var out = { id: pr.id || ("prep" + (i + 1)), kind: pr.kind, label: pr.label || "", zone: pr.zone ? JSON.parse(JSON.stringify(pr.zone)) : null,
        setbackIn: pr.setbackIn || "", thicknessIn: pr.thicknessIn || "", note: pr.note || "" };
      if (SW().isStrip(pr)) { out.strip = Object.assign({}, pr.strip); out.finished = SW().prepFinished(pr); out.zone = null; }
      return out;
    });
  }
  /* What an appliance of this kind takes, when the library has nothing
     for the model: the rows block 3 opens on, for the office to confirm
     against the sheet or delete. A WashTower wants a 120 V plug for the
     washer, a 240 V plug for the dryer, hot and cold valves, a standpipe
     and a 4" duct; a countertop microwave wants an outlet and nothing
     else. The sheet's own ELECTRICAL / PLUMBING lines, where it has them,
     are offered underneath as taps. */
  function kindWord(en, e) {
    var w = (e && (e.appliance || e.category)) || (en.description ? shortName(en.description) : en.kind) || "appliance";
    return String(w).replace(/_/g, " ").toLowerCase();
  }
  function defaultRowsFor(en, e) {
    var words = [e && e.category, e && e.appliance, en.kind, en.description, en.model].filter(Boolean).join(" ").toLowerCase();
    var rows = [];
    function row(key, f) { rows.push(Object.assign({ key: key, need: "", where: "", plane: "opening", pos: "", suggested: true }, f || {})); }
    var has = function (re) { return re.test(words); };
    if (has(/washtower|washer[\s-]*dryer|laundry[\s_]?(center|centre|combo)|combo/)) {
      row("power", { volts: "120", amps: "20", type: "5-20R", libLabel: "Power — washer" });
      row("power", { volts: "240", amps: "30", type: "14-30R", libLabel: "Power — dryer" });
      row("water", { type: "hotcold" });
      row("drain", { type: "standpipe" });
      row("vent", { type: "4-dryer" });
    } else if (has(/\bdryer\b/)) {
      if (has(/\bgas\b/)) { row("power", { volts: "120", amps: "15", type: "5-15R" }); row("gas", { type: "1/2-shutoff" }); }
      else row("power", { volts: "240", amps: "30", type: "14-30R" });
      row("vent", { type: "4-dryer" });
    } else if (has(/\bwasher\b/)) {
      row("power", { volts: "120", amps: "20", type: "5-20R" });
      row("water", { type: "hotcold" });
      row("drain", { type: "standpipe" });
    } else if (has(/dishwasher|dish/)) {
      /* the connections are in the sink cabinet beside it, whichever side
         that turns out to be; the sheet never says which */
      row("power", { volts: "120", amps: "15", plane: "adjacent", pos: REACH, zone: { kind: "any", plane: "adjacent", planeSize: { w: 36 } } });
      row("water", { type: "3/8-T", plane: "adjacent", pos: REACH, zone: { kind: "any", plane: "adjacent", planeSize: { w: 36 } } });
      row("drain", { type: "disposer", plane: "adjacent", pos: REACH, zone: { kind: "any", plane: "adjacent", planeSize: { w: 36 } } });
    } else if (has(/hood|ventilation|downdraft/)) {
      row("power", { volts: "120", amps: "15" });
      row("vent", {});
    } else if (has(/range\b|rangetop|cooktop|stove/)) {
      if (has(/\bgas\b|dual[\s-]*fuel/)) { row("power", { volts: "120", amps: "15", type: "5-15R" }); row("gas", { type: "1/2-shutoff" }); }
      else row("power", { volts: "240", amps: has(/cooktop/) ? "40" : "50", type: has(/cooktop/) ? "jbox-1" : "14-50R" });
    } else if (has(/wall oven|double oven|single oven|\boven\b|warming|steam/)) {
      row("power", has(/steam|speed|advantium|microwave/) ? { volts: "120", amps: "20" } : { volts: "240", amps: "30", type: "jbox-1" });
      if (has(/steam|plumbed/)) row("water", { type: "1/4-T" });
    } else if (has(/microwave|coffee|espresso|toaster|countertop|disposer|compactor/)) {
      row("power", { volts: "120", amps: "15", type: "5-15R" });
    } else if (has(/refrigerat|fridge|freezer|column|beverage|wine|ice|undercounter/)) {
      row("power", { volts: "120", amps: "15", type: "5-15R" });
      if (has(/ice|dispens|side-by-side|french|refrigerat|fridge/) && !has(/wine|beverage|freezer only/)) row("water", { type: "1/4-T" });
    } else {
      row("power", { volts: "120", amps: "15" });
    }
    return rows;
  }
  /* The library's connections as editable rows — what block 3 opens on
     for a model the library knows, so the drawing and ✎ Draw it are there
     from the first look, not behind a "different on this sheet?" link.
     Zones come across as the library holds them (edge references such as
     {r: 6} are understood by the drawing); a connection the library names
     in its own words (Condenser air, Hot and cold supply) keeps its name
     and its key, so the walk sees exactly what the library would have
     given it. */
  var CONN_KEYS = { power: 1, water: 1, drain: 1, gas: 1, vent: 1 };
  function rowsFromLibrary(ch, e2) {
    var rows = (e2 && e2.utilities ? e2.utilities : []).map(function (u) {
      var base = u.base || u.key || "power";
      var row = { key: base, need: "", where: u.where || "", plane: u.plane || (u.offPlane ? "" : "opening"), pos: u.pos || "" };
      if (!CONN_KEYS[base]) { row.key = u.key; row.libLabel = u.label || u.key; }
      if (u.fixMissing) row.fixMissing = u.fixMissing;
      if (u.note) row.note = u.note;
      if (u.generic) row.generic = true;
      connFromText(row, u.need || "");
      if (u.volts) row.volts = u.volts; if (u.amps) row.amps = u.amps; if (u.type) row.type = u.type;
      if (row.key === "water" && !row.type && /1\/4/.test(u.need || "")) row.type = "1/4-T";
      if (row.key === "water" && !row.type && /3\/8/.test(u.need || "")) row.type = "3/8-T";
      if (u.zone && u.zone.kind !== "any") {
        row.zone = JSON.parse(JSON.stringify(u.zone));
        row.zone.plane = u.zone.plane || "opening";
        row.plane = row.zone.plane;
      }
      return row;
    });
    if (!rows.length) rows.push({ key: "power", need: "", where: "" });
    /* a dishwasher's hook-ups live in the sink cabinet beside it unless the
       library drew them somewhere in particular */
    if (/dishwasher/i.test([e2 && e2.category, e2 && e2.appliance].filter(Boolean).join(" "))) {
      rows.forEach(function (row) {
        if (row.zone || (row.plane && row.plane !== "opening")) return;
        row.plane = "adjacent"; row.pos = REACH; row.zone = { kind: "any", plane: "adjacent", planeSize: { w: 36 } };
      });
    }
    return rows;
  }
  function composeUtilities(ch) {
    var list = ch.utilities || [], seen = {};
    return list.filter(function (u) { return u.key; }).map(function (u) {
      seen[u.key] = (seen[u.key] || 0) + 1;
      var key = seen[u.key] > 1 ? u.key + seen[u.key] : u.key;
      var out = { key: key, base: u.key, label: u.libLabel || (connLabel(u.key) + (seen[u.key] > 1 ? " " + seen[u.key] : "")),
                  need: connNeedText(u), where: connWhereText(u),
                  plane: u.plane || "", pos: u.pos || "", volts: u.volts || "", amps: u.amps || "", type: u.type || "" };
      if (u.fixMissing) out.fixMissing = u.fixMissing;
      if (u.note) out.note = u.note;
      if (u.generic) out.generic = true;
      if (u.zone) {
        out.zone = JSON.parse(JSON.stringify(u.zone));
        out.plane = u.zone.plane || "opening";
      }
      /* a connection in a cabinet beside, above or below is not in the
         plane of the opening: nothing to draw on its photograph */
      if (out.plane && out.plane !== "opening") out.offPlane = true;
      return out;
    });
  }

  /* pointer work on the drawing: client → inches on a plane */
  var riDrag = null;
  function riPoint(svg, e) {
    var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    var minX = +svg.getAttribute("data-minx"), maxY = +svg.getAttribute("data-maxy"), pad = +svg.getAttribute("data-pad");
    return { x: p.x - pad + minX, y: maxY - (p.y - pad) };        /* inches, y up, opening origin */
  }
  function riPlaneAt(model, pt) {
    var ks = Object.keys(model.planes);
    for (var i = 0; i < ks.length; i++) {
      var P = model.planes[ks[i]];
      if (pt.x >= P.x && pt.x <= P.x + P.w && pt.y >= P.y && pt.y <= P.y + P.h) return ks[i];
    }
    return null;
  }
  function snap8(v) { return Math.round(v * 8) / 8; }
  function riDown(e) {
    var svg = e.target && e.target.closest ? e.target.closest(".sw-roughin.interactive") : null;
    if (!svg || e.button !== 0) return;
    var wrap = svg.closest(".sw-ri-wrap"); if (!wrap) return;
    var ch = choiceOf({ model: wrap.getAttribute("data-m") }), d = drawState(ch);
    var en = entryFor(wrap.getAttribute("data-m"));
    var model = SW().roughInModel(previewItem(en, ch), planeSizes(ch));
    var pt = riPoint(svg, e);
    if (!placingTarget(ch)) {
      /* nothing being placed: a handle resizes the selected box, its body moves it */
      var hd = e.target.closest ? e.target.closest(".sw-ri-handle") : null;
      var mk = e.target.closest ? e.target.closest(".sw-ri-mark.sel") : null;
      var key = hd ? hd.getAttribute("data-key") : mk ? mk.getAttribute("data-key") : "";
      var row = key ? markRowRaw(ch, key) : null;
      if (!row || !row.zone) return;
      var Pz = model.planes[row.zone.plane || "opening"];
      if (!Pz) return;
      riDrag = { svg: svg, model: model, ch: ch, plane: row.zone.plane || "opening", P: Pz, x0: pt.x, y0: pt.y, moved: false,
                 edit: hd ? hd.getAttribute("data-handle") : "move", row: row, zone0: JSON.parse(JSON.stringify(row.zone)) };
      e.preventDefault();
      if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (x) { } }
      return;
    }
    var plane = riPlaneAt(model, pt);
    if (!plane) return;
    if (plane !== d.plane) { d.plane = plane; if (rerender) rerender(); return; }     /* first click picks the cabinet */
    var P = model.planes[plane];
    riDrag = { svg: svg, model: model, ch: ch, plane: plane, P: P, x0: pt.x, y0: pt.y, moved: false };
    e.preventDefault();
    if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (x) { } }
  }
  /* the box an edit drag would leave, in plane inches — resize keeps the
     opposite corner, move keeps the size; 1/8" snap, never past the
     plane's edges, never thinner than 1" */
  function editedZone(dr, pt) {
    var z = JSON.parse(JSON.stringify(dr.zone0)), P = dr.P, dx = pt.x - dr.x0, dy = pt.y - dr.y0;
    if (z.kind === "point") { z.x = snap8(Math.min(P.w, Math.max(0, z.x + dx))); z.y = snap8(Math.min(P.h, Math.max(0, z.y + dy))); return z; }
    if (z.kind !== "rect") return z;
    var x0 = Math.min(z.x0, z.x1), x1 = Math.max(z.x0, z.x1), y0 = Math.min(z.y0, z.y1), y1 = Math.max(z.y0, z.y1);
    if (dr.edit === "move") {
      var w = x1 - x0, hh = y1 - y0;
      x0 = Math.min(P.w - w, Math.max(0, x0 + dx)); y0 = Math.min(P.h - hh, Math.max(0, y0 + dy));
      x0 = snap8(x0); y0 = snap8(y0); x1 = x0 + w; y1 = y0 + hh;
    } else {
      /* the svg's "n" is the plane's high y */
      if (/w/.test(dr.edit)) x0 = Math.min(x1 - 1, Math.max(0, x0 + dx));
      if (/e/.test(dr.edit)) x1 = Math.max(x0 + 1, Math.min(P.w, x1 + dx));
      if (/n/.test(dr.edit)) y1 = Math.max(y0 + 1, Math.min(P.h, y1 + dy));
      if (/s/.test(dr.edit)) y0 = Math.min(y1 - 1, Math.max(0, y0 + dy));
      x0 = snap8(x0); x1 = snap8(x1); y0 = snap8(y0); y1 = snap8(y1);
    }
    z.x0 = x0; z.x1 = x1; z.y0 = y0; z.y1 = y1; z.std = false;
    return z;
  }
  function riMove(e) {
    if (!riDrag) return;
    var pt = riPoint(riDrag.svg, e);
    if (!riDrag.moved && Math.abs(pt.x - riDrag.x0) + Math.abs(pt.y - riDrag.y0) < 0.25) return;
    riDrag.moved = true;
    var live = riDrag.svg.querySelector(".sw-ri-live");
    var minX = +riDrag.svg.getAttribute("data-minx"), maxY = +riDrag.svg.getAttribute("data-maxy"), pad = +riDrag.svg.getAttribute("data-pad");
    if (riDrag.edit) {
      var z = editedZone(riDrag, pt), P = riDrag.P;
      if (z.kind === "point") {
        live.innerHTML = '<circle cx="' + (P.x + z.x - minX + pad) + '" cy="' + (maxY - (P.y + z.y) + pad) + '" r="1.2" fill="#c77d00" fill-opacity=".5" stroke="#1f2a24" stroke-width=".3"/>';
      } else {
        live.innerHTML = '<rect x="' + (P.x + z.x0 - minX + pad) + '" y="' + (maxY - (P.y + z.y1) + pad) + '" width="' + (z.x1 - z.x0) + '" height="' + (z.y1 - z.y0) +
          '" fill="#c77d00" fill-opacity=".2" stroke="#1f2a24" stroke-width=".35" stroke-dasharray="1 .6"/>';
      }
      return;
    }
    var x0 = Math.min(pt.x, riDrag.x0), x1 = Math.max(pt.x, riDrag.x0), y0 = Math.min(pt.y, riDrag.y0), y1 = Math.max(pt.y, riDrag.y0);
    live.innerHTML = '<rect x="' + (x0 - minX + pad) + '" y="' + (maxY - y1 + pad) + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) +
      '" fill="#c77d00" fill-opacity=".25" stroke="#c77d00" stroke-width=".35" stroke-dasharray="1 .6"/>';
  }
  function riUp(e) {
    if (!riDrag) return;
    var dr = riDrag; riDrag = null;
    var pt = riPoint(dr.svg, e), P = dr.P;
    if (dr.edit) {
      if (dr.moved) { dr.row.zone = editedZone(dr, pt); IMP.riJustPlaced = true; if (rerender) rerender(); }
      return;
    }
    function clampX(v) { return snap8(Math.min(P.w, Math.max(0, v - P.x))); }
    function clampY(v) { return snap8(Math.min(P.h, Math.max(0, v - P.y))); }
    var u = placingTarget(dr.ch), isPrep = !!(dr.ch.draw.placing && dr.ch.draw.placing.prep != null);
    if (!u) return;
    var zone = { plane: dr.plane, planeSize: { w: P.w, h: P.h } };
    var std = !isPrep && !dr.moved ? SW().stdBox(u) : null;
    if (std) {
      /* one click: the standard box, centred on the click, inside the plane */
      var cx = dr.x0 - P.x, cy = dr.y0 - P.y;
      var bx0 = Math.min(P.w - std.w, Math.max(0, cx - std.w / 2)), by0 = Math.min(P.h - std.h, Math.max(0, cy - std.h / 2));
      zone.kind = "rect"; zone.std = true;
      zone.x0 = snap8(bx0); zone.x1 = snap8(Math.min(P.w, bx0 + std.w)); zone.y0 = snap8(by0); zone.y1 = snap8(Math.min(P.h, by0 + std.h));
    } else if (!dr.moved && !isPrep) { zone.kind = "point"; zone.x = clampX(dr.x0); zone.y = clampY(dr.y0); }
    else {
      zone.kind = "rect";
      zone.x0 = clampX(Math.min(pt.x, dr.x0)); zone.x1 = clampX(Math.max(pt.x, dr.x0));
      zone.y0 = clampY(Math.min(pt.y, dr.y0)); zone.y1 = clampY(Math.max(pt.y, dr.y0));
      if (!isPrep && zone.x1 - zone.x0 < 0.25 && zone.y1 - zone.y0 < 0.25) { zone.kind = "point"; zone.x = zone.x0; zone.y = zone.y0; }
      /* a prep box has to be a box: a bare tap becomes a 2" × 2" one to drag again */
      if (isPrep && zone.x1 - zone.x0 < 0.25) zone.x1 = clampX(zone.x0 + P.x + 2);
      if (isPrep && zone.y1 - zone.y0 < 0.25) zone.y1 = clampY(zone.y0 + P.y + 2);
    }
    u.zone = zone; u.plane = dr.plane;
    dr.ch.draw.placing = null;
    dr.ch.draw.selected = isPrep ? "prep:" + u.id : composedKey(dr.ch.utilities || [], (dr.ch.utilities || []).indexOf(u));   /* handles come up on what was just placed */
    IMP.riJustPlaced = true;          /* the click that follows the drop must not pick the box back up */
    if (rerender) rerender();
  }
  document.addEventListener("pointerdown", riDown, true);
  /* a press that starts a drag must not start a text selection: the
     browser autoscrolls the page to extend a selection, and the box lands
     somewhere else than where it was drawn */
  document.addEventListener("mousedown", function (e) { if (riDrag || (e.target && e.target.closest && e.target.closest(".sw-roughin.interactive"))) e.preventDefault(); }, true);
  document.addEventListener("selectstart", function (e) { if (riDrag) e.preventDefault(); }, true);
  document.addEventListener("pointermove", riMove, true);
  document.addEventListener("pointerup", riUp, true);

  /* Where the sheet puts power, water, drain and gas. The library knows it
     for the models it carries; for everything else the office reads it off
     the sheet here, and the tech on site marks the actual position on the
     photograph against it. */
  function connectionsBlock(en, ch, e) {
    var h = '<div class="sw-vblock"><div class="sw-vblock-head"><span>3</span><strong>Connections</strong>' +
      "<em>what the sheet calls for, and where</em></div>";
    /* the sheet's hook-up lines, from any page of this model's run */
    var hints = [], full = entryFor(en.model) || en;
    var pFrom = full.from || ch.pageNo, pTo = full.to || ch.pageNo;
    for (var hp = pFrom; hp <= pTo; hp++) {
      ((IMP.pkg.connHints || {})[hp] || []).forEach(function (hh) {
        if (!hints.some(function (x) { return x.key === hh.key; })) hints.push(Object.assign({ pageNo: hp }, hh));
      });
    }
    if (!ch.utilities) {
      if (e && e.utilities && e.utilities.length) { ch.utilities = rowsFromLibrary(ch, e); ch.utilFrom = "library"; }
      else { ch.utilities = defaultRowsFor(en, e); ch.utilFrom = "kind"; }
    }
    if (ch.utilFrom === "library") {
      h += '<p class="sw-hint">Starting from what the library has for this model. Change anything the sheet says differently; the drawing below is where each one goes.</p>';
    } else if (ch.utilFrom === "kind") {
      h += '<p class="sw-hint">The library has no connections for this model, so these are what a ' + esc(kindWord(en, e)) + ' usually takes. Confirm each against the sheet, delete what does not apply, and draw where it goes. Delete them all and the phone asks for none.</p>';
    }
    var list = ch.utilities || [];
    h += roughInBlock(en, ch, list);
    var pvItem = previewItem(en, ch);
    var planeChips = CONN_PLANES.filter(function (pl) { return SW().planeAllowed(pvItem, pl.k); });
    list.forEach(function (u, i) {
      var specRows = CONN_SPEC[u.key] || [];
      h += '<div class="sw-conn-row">' +
        '<div class="sw-conn-kinds">' + (u.libLabel && !CONN_KEYS[u.key] ? '<span class="sw-chipbtn on">' + esc(u.libLabel) + "</span>" : "") +
        (u.libLabel && CONN_KEYS[u.key] ? '<span class="sw-conn-name">' + esc(u.libLabel) + "</span>" : "") + CONN_KINDS.map(function (c) {
          return '<button class="sw-chipbtn' + (u.key === c.k ? " on" : "") + '" data-act="pkgconnkind" data-m="' + esc(en.model) +
            '" data-i="' + i + '" data-k="' + c.k + '">' + esc(c.label) + "</button>";
        }).join("") +
        '<button class="sw-chipbtn x" data-act="pkgconndel" data-m="' + esc(en.model) + '" data-i="' + i + '" title="Remove">×</button>' +
        (u.key ? '<button class="sw-chipbtn sw-ri-draw' + (ch.draw && ch.draw.placing === i ? " on" : "") + '" data-act="pkgridraw" data-m="' + esc(en.model) + '" data-i="' + i + '">' +
          (u.zone ? "✎ Redraw on the drawing" : "✎ Draw it on the drawing") + "</button>" : "") + "</div>";
      specRows.forEach(function (g) {
        h += '<div class="sw-conn-spec">' + g.opts.map(function (o) {
          return '<button class="sw-chipbtn tiny' + (u[g.f] === o[0] ? " on" : "") + '" data-act="pkgconnspec" data-m="' + esc(en.model) +
            '" data-i="' + i + '" data-f="' + g.f + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + "</button>";
        }).join("") + "</div>";
      });
      h += '<input class="sw-input" data-pkgconn="' + esc(en.model) + '" data-i="' + i + '" data-f="need" value="' + esc(u.need || "") +
        '" placeholder="Anything else the sheet says — dedicated circuit, 5\' cord, GFCI">' +
        '<div class="sw-conn-where"><span class="sw-mini-label">Where</span>' + planeChips.map(function (pl) {
          return '<button class="sw-chipbtn tiny' + (u.plane === pl.k ? " on" : "") + '" data-act="pkgconnplane" data-m="' + esc(en.model) +
            '" data-i="' + i + '" data-v="' + pl.k + '">' + esc(pl.label) + "</button>";
        }).join("") + "</div>" +
        (u.plane ? '<div class="sw-conn-where">' + (CONN_POS[u.plane] || []).map(function (pos) {
          return '<button class="sw-chipbtn tiny' + (u.pos === pos ? " on" : "") + '" data-act="pkgconnpos" data-m="' + esc(en.model) +
            '" data-i="' + i + '" data-v="' + esc(pos) + '">' + esc(pos) + "</button>";
        }).join("") + "</div>" : "") +
        '<input class="sw-input" data-pkgconn="' + esc(en.model) + '" data-i="' + i + '" data-f="where" value="' + esc(u.where || "") +
        '" placeholder="Exact position off the sheet — 6&quot; in, 4&quot; up">' +
        "</div>";
    });
    if (!list.length) h += '<p class="sw-hint">No connections — the phone will not ask for any on this opening. Add one if the sheet calls for it.</p>';
    h += '<div class="inline-actions" style="margin-top:8px">' +
      '<button class="button small ghost" data-act="pkgconnadd" data-m="' + esc(en.model) + '">+ Add a connection</button>' +
      '<button class="button small ghost" data-act="pkgconnlib" data-m="' + esc(en.model) + '">' + (e && e.utilities && e.utilities.length ? "Back to the library's" : "Start again from the appliance type") + "</button>" +
      "</div>";
    if (hints.length) {
      h += '<div class="sw-conn-hints"><span>On this sheet</span>' + hints.map(function (hh) {
        return '<button class="sw-conn-hint" data-act="pkgconnhint" data-m="' + esc(en.model) + '" data-k="' + esc(hh.key) + '" data-t="' + esc(hh.text) + '">' +
          "<b>" + esc(connLabel(hh.key)) + "</b>" + esc(hh.text.slice(0, 140)) + "</button>";
      }).join("") + "</div>";
    }
    return h + "</div>";
  }

  /* Panel-ready, and the three things that follow from it: who supplies
     the panel, how thick it is (the cleat setback on a flush job comes off
     this), and its size when the sheet gives one. */
  function panelBlock(en, ch, e) {
    var S = SW();
    var pr = panelReadyOf(en, ch);
    var auto = ch.panel.ready == null;
    var h = '<div class="sw-vblock"><div class="sw-vblock-head"><span>4</span><strong>Panel</strong>' +
      (pr == null ? '<em class="bad">answer this</em>' : auto ? "<em>" + (e ? "from the library" : "assumed — change it if the sheet says otherwise") + "</em>" : "") + "</div>";
    h += '<div class="sw-chiprow">' +
      '<button class="sw-chipbtn' + (pr === true ? " on" : "") + '" data-act="pkgpanel" data-m="' + esc(en.model) + '" data-v="1">Panel-ready</button>' +
      '<button class="sw-chipbtn' + (pr === false ? " on" : "") + '" data-act="pkgpanel" data-m="' + esc(en.model) + '" data-v="0">Not panel-ready</button></div>';
    if (pr === true) {
      var libPanel = e ? ((S.variationOf(e, ch.basisKey) || {}).panel || e.panel) : null;
      h += '<div class="sw-panel-grid">' +
        '<div><span class="sw-mini-label">Who supplies the panel</span><div class="sw-chiprow">' +
        '<button class="sw-chipbtn' + (ch.panel.by === "wilson" ? " on" : "") + '" data-act="pkgpanelby" data-m="' + esc(en.model) + '" data-v="wilson">Wilson — stainless / manufacturer panel</button>' +
        '<button class="sw-chipbtn' + (ch.panel.by === "custom" ? " on" : "") + '" data-act="pkgpanelby" data-m="' + esc(en.model) + '" data-v="custom">Custom — cabinet maker</button>' +
        "</div></div>" +
        '<label class="sw-pkg-dim"><span>Panel thickness</span><input class="sw-input" data-pkgpanel="' + esc(en.model) + '" data-f="thicknessIn" value="' + esc(ch.panel.thicknessIn) + '" placeholder="3/4"></label>' +
        '<label class="sw-pkg-dim"><span>Panel width <em>from the sheet</em></span><input class="sw-input" data-pkgpanel="' + esc(en.model) + '" data-f="w" value="' + esc(ch.panel.w) + '" placeholder="' + esc(libPanel && libPanel.width || "23 3/4") + '"></label>' +
        '<label class="sw-pkg-dim"><span>Panel height</span><input class="sw-input" data-pkgpanel="' + esc(en.model) + '" data-f="h" value="' + esc(ch.panel.h) + '" placeholder="' + esc(libPanel && libPanel.height || "30 3/8") + '"></label>' +
        "</div>";
      if (libPanel) {
        h += '<p class="sw-hint">Library: ' + esc([libPanel.width && libPanel.height ? libPanel.width + " W × " + libPanel.height + " H" : "", libPanel.thickness, libPanel.weight, libPanel.page].filter(Boolean).join(" · ")) +
          ". Leave the size blank to use it.</p>";
      }
      /* the detail's panel rule: what the sheet assumes and what this model takes */
      var pRule = e ? ((S.variationOf(e, ch.basisKey) || {}).panelRule || e.panelRule) : null;
      h += '<p class="sw-hint">A custom panel is a builder item on the walk: the tech checks it is on site, the right size, and pulls fitted. ' +
        (pRule ? "This detail's numbers assume a <strong>" + esc(S.fmtIn(pRule.assumedIn != null ? pRule.assumedIn : 0.75)) + " panel</strong>" +
          (pRule.minIn != null || pRule.maxIn != null ? "; the model takes " + esc(S.panelRangeText({ min: pRule.minIn != null ? pRule.minIn : null, max: pRule.maxIn != null ? pRule.maxIn : null })) : "") +
          (pRule.page ? " (" + esc(pRule.page) + ")" : "") + ". Type the job's thickness above and the cleats and depth move with it; leave it blank and the packet says they were checked for the assumed panel."
          : "No panel rule in the library for this detail — Wilson's standard 3/4\" panel is assumed. A flush install with a 3/4\" panel usually wants the cleat set back 7/8\"–1\".") + "</p>";
    }
    return h + "</div>";
  }

  /* Cabinet prep the sheet calls for — the Miele's cleats, its 4" × 28"
     cutout in the cabinet floor, the door's swing clearance, the vent path
     into the cabinet below. Each one is drawn where the sheet draws it and
     becomes a line the cabinet shop builds to and the tech checks. */
  /* A strip's numbers, the way the design guide gives them: which face,
     how far behind the cabinet face it starts, how far it runs, how far it
     stands proud, how tall (or wide) — and whether it is finished. */
  function stripFields(en, pr, i) {
    var S = SW(), s = S.stripOf(pr), kd = S.prepKind(pr.kind), m = esc(en.model);
    var fin = S.prepFinished(pr), back = s.face === "back", horiz = s.face === "top" || s.face === "bottom";
    function inp(f, label, ph) { return '<label><span>' + esc(label) + '</span><input class="sw-input" data-pkgprep="' + m + '" data-i="' + i + '" data-f="strip.' + f + '" value="' + esc(s[f] || "") + '" placeholder="' + esc(ph || "") + '"></label>'; }
    var h = '<div class="sw-conn-where"><span class="sw-mini-label">Where</span>' + S.STRIP_FACES.map(function (f) {
      return '<button class="sw-chipbtn tiny' + (s.face === f.k ? " on" : "") + '" data-act="pkgprepface" data-m="' + m + '" data-i="' + i + '" data-v="' + f.k + '">' + esc(f.label) + "</button>";
    }).join("") + "</div>";
    h += '<div class="sw-prep-fields">' +
      (back ? "" : inp("setbackIn", "Starts back from the cabinet face", kd.k === "return" ? "0" : "2 3/16")) +
      (back ? "" : inp("runIn", kd.k === "return" ? "Finished depth from the face" : "Depth, front to back", "3 1/2")) +
      (kd.k === "return" ? "" : inp("thicknessIn", back ? "Stands proud of the wall" : "Width into the opening", back ? "1 1/2" : "1 1/4")) +
      inp("fromIn", horiz ? "Starts from the left (blank = full width)" : "Starts off the floor (blank = full height)", "") +
      inp("sizeIn", horiz ? "How wide" : "How tall", "") + "</div>";
    h += '<div class="sw-conn-where"><span class="sw-mini-label">Finish</span>' +
      '<button class="sw-chipbtn tiny' + (fin ? " on" : "") + '" data-act="pkgprepfin" data-m="' + m + '" data-i="' + i + '" data-v="yes">Finished to match the cabinetry — cabinet shop</button>' +
      '<button class="sw-chipbtn tiny' + (!fin ? " on" : "") + '" data-act="pkgprepfin" data-m="' + m + '" data-i="' + i + '" data-v="no">Unfinished, hidden behind the unit — builder</button></div>';
    return h;
  }
  function newPrep(kind, note) {
    var S = SW(), kd = S.prepKind(kind);
    var pr = { id: "prep" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: kind, label: "", setbackIn: "", thicknessIn: "", note: note || "" };
    if (kd.strip) { S.stripOf(pr).face = "both"; pr.finished = kd.finished; }
    return pr;
  }
  /* The install detail's own cleats, returns and blocking (the library's
     `prep` on a variation) land on the choice when the basis is picked,
     until the office touches the list itself. */
  function seedPrep(ch, v) {
    if (ch.prepTouched) return;
    if (!v || !v.prep || !v.prep.length) { if (ch.prepFrom) { ch.prep = []; ch.prepFrom = ""; } return; }
    if (ch.prepFrom === v.key && (ch.prep || []).length) return;
    ch.prep = v.prep.map(function (p) {
      var pr = newPrep(p.kind, p.note || "");
      pr.label = p.label || ""; pr.finished = p.finished != null ? p.finished : pr.finished;
      if (p.strip) Object.assign(SW().stripOf(pr), p.strip);
      return pr;
    });
    ch.prepFrom = v.key;
  }
  function prepBlock(en, ch, e) {
    var S = SW(), list = ch.prep || [];
    var h = '<div class="sw-vblock"><div class="sw-vblock-head"><span>4b</span><strong>Cabinet prep</strong><em>cleats, cutouts, clearances, vent paths, blocking — what the cabinet shop builds first</em></div>';
    list.forEach(function (pr, i) {
      var kd = S.prepKind(pr.kind), placing = drawState(ch).placing && drawState(ch).placing.prep === i;
      h += '<div class="sw-conn-row sw-prep-row">' +
        '<div class="sw-conn-kinds">' + S.PREP_KINDS.map(function (k) {
          return '<button class="sw-chipbtn' + (pr.kind === k.k ? " on" : "") + '" data-act="pkgprepkind" data-m="' + esc(en.model) + '" data-i="' + i + '" data-k="' + k.k + '">' + esc(k.label) + "</button>";
        }).join("") +
        '<button class="sw-chipbtn x" data-act="pkgprepdel" data-m="' + esc(en.model) + '" data-i="' + i + '" title="Remove">×</button>' +
        (kd.strip ? "" : '<button class="sw-chipbtn sw-ri-draw' + (placing ? " on" : "") + '" data-act="pkgprepdraw" data-m="' + esc(en.model) + '" data-i="' + i + '">' + (pr.zone ? "✎ Redraw" : "✎ Draw it on the drawing") + "</button>") + "</div>" +
        (kd.strip ? stripFields(en, pr, i) : "") +
        '<div class="sw-prep-fields">' +
        '<label><span>Label</span><input class="sw-input" data-pkgprep="' + esc(en.model) + '" data-i="' + i + '" data-f="label" value="' + esc(pr.label || "") + '" placeholder="' + esc(kd.label) + '"></label>' +
        '<label class="wide"><span>Note from the sheet</span><input class="sw-input" data-pkgprep="' + esc(en.model) + '" data-i="' + i + '" data-f="note" value="' + esc(pr.note || "") + '" placeholder="' +
          esc(pr.kind === "cutout" ? "for the power cord and ventilation" : pr.kind === "clearance" ? "door swing to the neighbouring cabinet front" : pr.kind === "vent" ? "into the cabinet below" : pr.kind === "blocking" ? "2×2 or 2×4 anti-tip block against the rear wall, 9\" from the floor to the bottom of the block" : pr.kind === "cleat" ? "the body registers against them" : pr.kind === "return" ? "visible beside the door — finish to match the cabinetry" : "") + '"></label>' +
        "</div>" +
        (kd.strip ? '<p class="sw-hint">' + esc(S.prepText(pr)) + "</p>" : pr.zone ? '<p class="sw-hint">' + esc(S.prepText(pr)) + "</p>" : '<p class="sw-hint">Not drawn yet — press ✎ and drag it on the drawing above.</p>') +
        "</div>";
    });
    h += '<div class="inline-actions" style="margin-top:8px">' + S.PREP_KINDS.filter(function (k) { return k.k !== "other"; }).map(function (k) {
      return '<button class="button small ghost" data-act="pkgprepadd" data-m="' + esc(en.model) + '" data-k="' + k.k + '">+ ' + esc(k.label) + "</button>";
    }).join("") + "</div>";
    /* the sheet's own prep sentences, across this model's pages */
    var phints = [], pfull = entryFor(en.model) || en, pFrom = pfull.from || ch.pageNo, pTo = pfull.to || ch.pageNo;
    for (var hp = pFrom; hp <= pTo; hp++) ((IMP.pkg.prepHints || {})[hp] || []).forEach(function (hh) { if (!phints.some(function (x) { return x.text === hh.text; })) phints.push(hh); });
    phints = phints.filter(function (hh) { return !list.some(function (pr) { return pr.note === hh.text || pr.hint === hh.text; }); });
    if (phints.length) {
      h += '<div class="sw-conn-hints"><span>On this sheet</span>' + phints.map(function (hh) {
        return '<button class="sw-conn-hint" data-act="pkgprephint" data-m="' + esc(en.model) + '" data-k="' + esc(hh.kind) + '" data-t="' + esc(hh.text) + '">+ ' + esc(S.prepKind(hh.kind).label) + " — “" + esc(hh.text) + "”</button>";
      }).join("") + "</div>";
    }
    /* what the category nearly always needs, from thirty spec books and
       Hudson's notes — one tap each, so the field sees it pre-loaded */
    var usual = usualPrepFor(en, e).filter(function (hh) { return !list.some(function (pr) { return pr.note === hh.text || pr.hint === hh.text || (hh.strip && S.isStrip(pr) && pr.kind === hh.kind && pr.strip.face === hh.strip.face); }) && !phints.some(function (x) { return x.text === hh.text; }); });
    if (usual.length) {
      h += '<div class="sw-conn-hints usual"><span>Usual for this kind</span>' + usual.map(function (hh) {
        return '<button class="sw-conn-hint" data-act="pkgprephint" data-m="' + esc(en.model) + '" data-k="' + esc(hh.kind) + '" data-t="' + esc(hh.text) + '"' + (hh.strip ? ' data-s="' + esc(JSON.stringify({ strip: hh.strip, finished: hh.finished })) + '"' : "") + '>+ ' + esc(S.prepKind(hh.kind).label) + " — " + esc(hh.text) + "</button>";
      }).join("") + "</div>";
    }
    return h + "</div>";
  }
  var USUAL_PREP = {
    cooking: [
      { kind: "blocking", text: "Anti-tip bracket anchored to the floor or wall behind the range" }
    ],
    oven: [
      { kind: "cleat", text: "Flush inset: finished side cleats recessed 7/8\"–1\" behind a 3/4\" panel", strip: { face: "both", setbackIn: "7/8", thicknessIn: "3/4" }, finished: true },
      { kind: "blocking", text: "Support platform or rails, level and set back for a flush front", strip: { face: "bottom", setbackIn: "7/8", thicknessIn: "3/4" }, finished: false },
      { kind: "blocking", text: "2×4 anti-tip block against the rear wall, 9\" off the floor (microwave drawer)", strip: { face: "back", thicknessIn: "1 1/2", fromIn: "9", sizeIn: "3 1/2" }, finished: false }
    ],
    /* built-in vs column vs undercounter: different anchoring, different returns (24 Oct) */
    builtin: [
      { kind: "blocking", text: "Anti-tip anchoring as the sheet shows — floor brackets 24\" back (Sub-Zero) or a 2×4 across the wall studs at 84\" (Monogram / JennAir / Thermador)" },
      { kind: "return", text: "3 1/2\" finished returns on both sides — visible beside the door", strip: { face: "both", setbackIn: "0", runIn: "3 1/2" }, finished: true },
      { kind: "cleat", text: "Flush inset: 1 1/4\" finished cleats, 3 1/2\" deep, starting 2 3/16\" behind the face (Sub-Zero Classic)", strip: { face: "both", setbackIn: "2 3/16", runIn: "3 1/2", thicknessIn: "1 1/4" }, finished: true },
      { kind: "clearance", text: "Clearance above the unit for the grille per the sheet" }
    ],
    column: [
      { kind: "return", text: "3 1/2\" finished returns on both sides and the top", strip: { face: "both", setbackIn: "0", runIn: "3 1/2" }, finished: true },
      { kind: "blocking", text: "Anti-tip anchoring — wall and floor about 24\" from the front, or 3/4\" plywood side panels anchored to the floor / wall (JennAir, Miele)" },
      { kind: "other", text: "Toe kick open at the column — it breathes through the kickplate" }
    ],
    undercounter: [
      { kind: "blocking", text: "Anti-tip bracket or floor anchor for the undercounter unit" },
      { kind: "other", text: "Finished flooring in under the unit, or the thickness still to come noted" }
    ],
    refrigeration: [
      { kind: "return", text: "Finished returns on both sides — visible beside the door", strip: { face: "both", setbackIn: "0", runIn: "3 1/2" }, finished: true },
      { kind: "blocking", text: "Anti-tip anchoring per the sheet" }
    ],
    ice: [{ kind: "cutout", text: "Access hole where the connections are behind the unit" }],
    dishwasher: [
      { kind: "cutout", text: "Hole in the sink cabinet side for the lines — smooth edges, 1 1/2\" or the sheet's size" },
      { kind: "other", text: "Removable toe kick at least 4\" tall; floor hard and level, no carpet" },
      { kind: "cleat", text: "Mounting: top brackets to wood, or side-mount for a stone counter" }
    ],
    laundry: [
      { kind: "other", text: "Clean-out cut back and capped flush with the wall" },
      { kind: "cutout", text: "Dryer duct port recessed in the wall where the dryer's outlet lands" },
      { kind: "other", text: "Floor solid and level within 1\"; no carpet or platform" }
    ],
    hood: [
      { kind: "blocking", text: "Blocking across the studs at the hood's mounting line" },
      { kind: "cutout", text: "Duct cutout through the cabinet and ceiling or wall at the collar" }
    ],
    grill: [
      { kind: "cutout", text: "Island cutout to the sheet's size, with the insulating jacket if the island is combustible" },
      { kind: "clearance", text: "12\" to combustibles each side and behind below the counter; nothing combustible overhead" },
      { kind: "vent", text: "Vent openings in the island (LP: on two sides, high and low)" }
    ]
  };
  function usualPrepFor(en, e) {
    var S = SW();
    var probe = { brand: en.brand || (e && e.brand) || "", category: (e && e.category) || en.kind || "", appliance: (e && e.appliance) || en.description || "", model: en.model || "" };
    var k = S.kindOf(probe);
    if (k === "refrigeration" || k === "ice") { var rk = S.refrigKind(probe); if (rk && USUAL_PREP[rk]) return USUAL_PREP[rk]; }
    return USUAL_PREP[k] || [];
  }

  /* The pages of this model's sheet, as thumbnails. One is the page the
     numbers were read off and the tech sees first; any others ticked
     travel with it into the packet — a drawing on one page, the
     electrical on the next. */
  function pageStrip(en, ch) {
    var out = "";
    for (var p = en.from; p <= en.to && p < en.from + 16; p++) {
      var hs = (IMP.pkg.headings[p] || []);
      var th = IMP.thumbs[p];
      var primary = ch.pageNo === p, extra = ch.extraPages.indexOf(p) >= 0;
      out += '<div class="sw-verify-pg' + (primary ? " on" : extra ? " extra" : "") + '">' +
        '<button class="sw-verify-pg-img" data-act="pkgpage" data-m="' + esc(en.model) + '" data-p="' + p + '" title="Show this page">' +
        (th ? '<img src="' + th + '" alt="Page ' + p + '">' : '<span class="sw-pkg-page-ph"></span>') + "</button>" +
        '<span class="sw-verify-pg-no">p.' + p + (hs.length ? "<em>" + esc(hs[0].replace(/ INSTALLATION.*/, "")) + "</em>" : "") + "</span>" +
        (primary ? '<span class="sw-verify-pg-tag">the sheet</span>'
                 : '<button class="sw-verify-pg-add' + (extra ? " on" : "") + '" data-act="pkgpagex" data-m="' + esc(en.model) + '" data-p="' + p + '">' +
                   (extra ? "✓ in the packet" : "+ packet") + "</button>") +
        "</div>";
    }
    return out;
  }

  /* Called after every office repaint: make sure the page the verify screen
     is looking at is being rendered at readable size, and put the zoomed
     sheet back where the person was looking. */
  function afterRender() {
    if (!IMP.pkg || IMP.step !== "verify") return;
    var list = queueEntries();
    if (!list.length) return;
    var ch = choiceOf(list[Math.min(IMP.vIdx, list.length - 1)]);
    if (ch.pageNo) hydrateBig(ch.pageNo);
    /* and quietly pre-render the next model's page while they type */
    if (IMP.vIdx + 1 < list.length && IMP.big[ch.pageNo]) {
      var np = choiceOf(list[IMP.vIdx + 1]).pageNo;
      if (np) hydrateBig(np);
    }
    if (IMP.zoom && HOST) {
      var box = HOST.querySelector(".sw-verify-page.zoomed");
      if (box) {
        var im = box.querySelector("img");
        if (im) im.style.width = (ZOOMS[IMP.zoom] * 100) + "%";
      }
      if (box) {
        if (IMP.zoomAt) {
          /* zoom toward the point they clicked: that point ends up in the
             middle of the viewport, so a dimension in the corner is one
             click away instead of unreachable */
          box.scrollLeft = Math.max(0, IMP.zoomAt.fx * box.scrollWidth - box.clientWidth / 2);
          box.scrollTop = Math.max(0, IMP.zoomAt.fy * box.scrollHeight - box.clientHeight / 2);
          IMP.zoomAt = null;
          IMP.zoomScroll = { l: box.scrollLeft, t: box.scrollTop };
        } else if (IMP.zoomScroll) {
          box.scrollLeft = IMP.zoomScroll.l; box.scrollTop = IMP.zoomScroll.t;
        }
      }
    }
  }

  /* Where on the sheet the last click landed, as a fraction of the image,
     captured before the office repaints the DOM out from under it. */
  var ZOOMS = [1, 2, 3, 4.5];
  var drag = null;
  function notePointer(e) {
    var box = e.target && e.target.closest ? e.target.closest(".sw-verify-page") : null;
    if (!box) return;
    var img = box.querySelector("img");
    var r = (img || box).getBoundingClientRect();
    if (!r.width || !r.height) return;
    IMP.lastPoint = { fx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
                      fy: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    /* a press on a zoomed sheet starts a drag — mouse wheels only scroll
       one way, and a sheet is looked at in two */
    if (box.classList.contains("zoomed") && e.button === 0) {
      drag = { box: box, x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop, moved: false };
      if (box.setPointerCapture) { try { box.setPointerCapture(e.pointerId); } catch (x) { } }
    }
  }
  function movePointer(e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    drag.moved = true;
    drag.box.scrollLeft = drag.l - dx; drag.box.scrollTop = drag.t - dy;
    drag.box.classList.add("dragging");
    e.preventDefault();
  }
  function endPointer() {
    if (!drag) return;
    drag.box.classList.remove("dragging");
    IMP.dragged = drag.moved;        /* read, and cleared, by the click that follows */
    drag = null;
  }
  document.addEventListener("pointermove", movePointer, true);
  document.addEventListener("pointerup", endPointer, true);
  document.addEventListener("pointercancel", endPointer, true);
  function noteScroll(e) {
    var box = e.target;
    if (!box || !box.classList || !box.classList.contains("sw-verify-page")) return;
    if (IMP.zoom) IMP.zoomScroll = { l: box.scrollLeft, t: box.scrollTop };
  }
  document.addEventListener("pointerdown", notePointer, true);
  document.addEventListener("scroll", noteScroll, true);

  /* The big render, on demand, cached. 1400px is enough to read a
     dimension line off a Sub-Zero drawing at 100%; zoomed it is shown at
     double, which is where the corners of a crowded Miele sheet become
     legible. */
  function hydrateBig(pageNo) {
    if (!IMP.pkg || !IMP.pkg.pdf || IMP.big[pageNo] || IMP.bigBusy === pageNo) return;
    IMP.bigBusy = pageNo;
    renderPage(IMP.pkg, pageNo, 1600, 0.82).then(function (r) {
      IMP.big[pageNo] = r.dataUrl;
      IMP.bigBusy = null;
      if (rerender) rerender();
    }).catch(function () { IMP.bigBusy = null; });
  }

  /* Render every page thumbnail the wizard needs, then repaint. */
  function hydrateThumbs(only) {
    var pkg = IMP.pkg;
    if (!pkg || !pkg.pdf) return;
    var want = [];
    var S = SW();
    var src = only ? [only] : pkg.entries.slice().sort(function (a, b) {
      /* Multi-variation models first: those pages are the ones a decision
         hangs on. Everything else fills in behind. */
      var av = (S.findModel(a.model) || { variations: [] }).variations.length > 1 ? 0 : 1;
      var bv = (S.findModel(b.model) || { variations: [] }).variations.length > 1 ? 0 : 1;
      return av - bv;
    });
    src.forEach(function (en) {
      if (!en.from) return;
      for (var p = en.from; p <= en.to && p < en.from + 16; p++) {
        if (!IMP.thumbs[p] && want.indexOf(p) < 0) want.push(p);
      }
    });
    if (!want.length) return;
    var i = 0;
    function next() {
      if (i >= want.length || !IMP.pkg) { if (rerender) rerender(); return; }
      var p = want[i++];
      renderPage(pkg, p, 260, 0.64).then(function (r) {
        IMP.thumbs[p] = r.dataUrl;
        if (i % 6 === 0 && rerender) rerender();
        next();
      }).catch(function () { IMP.thumbs[p] = ""; next(); });
    }
    next();
  }

  /* Who checked these numbers, against which sheet, on what date — stamped
     onto the opening so the packet can say it, and remembered so the next
     package with this model is a glance instead of a retype. The install
     detail, the maximums, the connections and the panel answer are
     remembered with it: that is the library cache growing one model per
     walk. */
  function recordVerification(en, ch, it, w, pkg) {
    var S = SW();
    if (dimStatus(en, ch) !== "verified") return;
    /* v0.9.84: whoever is at the desk verified it — the signed-in person where
       there is a login. Never the salesperson off the spec book: until now
       IMP.by was never set, so every packet named the salesperson as the one
       who checked the numbers. With no login and no name, the packet prints
       the sheet and the date and no name. */
    var who = S.hasGate && S.hasGate() && S.sessionUser ? S.sessionUser() : null;
    var by = IMP.by || (who && who.displayName) || "";
    var at = S.isoNow(), doc = pkg.docName;
    var sheetDate = (pkg.sheetDates || {})[ch.pageNo] || "";
    var mem = ch.memory || {};
    /* v0.9.85: numbers that stand on an earlier confirmation — the same
       printing of the sheet, checked before, now possibly by a colleague at
       another desk — keep the name and date of the person who actually
       looked. Whoever is building this walk did not check them. */
    if (!ch.confirmed && mem.confirmedAt) {
      by = mem.confirmedBy || ""; at = mem.confirmedAt; doc = mem.confirmedDoc || mem.sourceDoc || pkg.docName;
    }
    it.dimsVerified = {
      by: by, at: at, sourceDoc: doc,
      pageNo: ch.pageNo, sheetDate: sheetDate
    };
    function frac(v) { return S.num(v) != null ? S.fmtFrac(S.num(v)) : ""; }
    S.rememberDims(en.model, ch.basisKey, {
      w: frac(ch.dims.w), d: frac(ch.dims.d), h: frac(ch.dims.h),
      max: { w: frac(ch.dimsMax.w), d: frac(ch.dimsMax.d), h: frac(ch.dimsMax.h) },
      noOpening: !!ch.noOpening,
      installType: ch.installType || "",
      rules: ch.rules || null,
      prep: composePrep(ch),
      utilities: ch.utilities ? ch.utilities.filter(function (u) { return u.key; }) : null,
      panel: (ch.panel.ready === true || ch.panel.ready === false)
        ? { ready: ch.panel.ready, by: ch.panel.by || "", thicknessIn: ch.panel.thicknessIn || "", w: ch.panel.w || "", h: ch.panel.h || "" }
        : null,
      sourceDoc: doc, pageNo: ch.pageNo, sheetDate: sheetDate,
      by: by,
      confirmedBy: by, confirmedAt: at,
      confirmedSheetDate: sheetDate || mem.confirmedSheetDate || "", confirmedDoc: doc,
      origin: ch.from || "read",
      seenCount: mem.seenCount || 0
    });
  }

  /* How big the copy that travels inside the walk can afford to be.

     localStorage is ~5MB for everything: every walk, every field photo
     thumbnail, this. A 30-model package at 900px would be 2.4MB of spec
     pages before a single site photograph is taken, and the write that
     goes over the edge is the one that silently loses work. So the
     resolution comes down as the package gets bigger, and a very large
     package gets thumbnails plus a note that the sheets come from the
     server. Where a portal is serving the tool this only affects the
     offline fallback, since the full render is fetchable by id. */
  var TRAVEL_BUDGET = 1.1 * 1024 * 1024;     /* bytes of spec pages in state */
  function travelSize(pkg) {
    var n = 0;
    (pkg.entries || []).forEach(function (en) { n += 1 + choiceOf(en).extraPages.length; });
    n = Math.max(1, n);
    var per = TRAVEL_BUDGET / n;
    if (per >= 78 * 1024) return 900;
    if (per >= 50 * 1024) return 700;
    if (per >= 30 * 1024) return 560;
    return 340;
  }

  /* ---------- building the walk ----------------------------------------- */
  /* The unit's own size off the product table on any of the model's pages
     ("23 7/8"W x 34"H x 18"D") — what tells an undercounter from a tall
     built-in when the name does not (v0.9.79). */
  function unitSizeFor(en, ch) {
    var ss = (IMP.pkg && IMP.pkg.sheetSpecs) || {}, first = ss[ch.pageNo];
    if (first && first.dimensionsText) return first.dimensionsText;
    for (var p = en.from || 0; p && p <= (en.to || 0); p++) if (ss[p] && ss[p].dimensionsText) return ss[p].dimensionsText;
    return "";
  }
  function applyChoice(it, en, ch) {
    var S = SW(), e = S.findModel(en.model);
    var us = unitSizeFor(en, ch);
    if (us) it.unitSize = us;
    if (e) {
      it.brand = e.brand; it.appliance = e.appliance; it.category = e.category || "";
      if (ch.basisKey) S.applyBasis(it, ch.basisKey);
      if (ch.installType && (ch.installOther || !ch.basisKey)) it.installType = ch.installType;
    } else {
      it.brand = en.brand || "";
      it.appliance = en.kind ? (en.brand ? en.kind.toLowerCase() : en.kind) : en.model;
      if (en.description) it.appliance = shortName(en.description);
      it.category = (en.kind || "").toLowerCase();
      it.installType = ch.installType || "Per the attached sheet";
    }
    if (!it.appliance) it.appliance = en.model;

    /* The numbers a person verified against this job's sheet win over the
       library's — that is what the verify screen is for. A maximum makes
       the axis a window. */
    if (ch.noOpening) {
      ["w", "d", "h"].forEach(function (k) { it.spec[k] = ""; });
    } else {
      ["w", "d", "h"].forEach(function (k) {
        var n = S.num(ch.dims[k]), mx = S.num(ch.dimsMax[k]);
        if (n != null) it.spec[k] = S.fmtFrac(n);
        if (n != null) it.rule[k] = ruleFor(ch, k);
        if (n != null && mx != null) { it.specMax[k] = S.fmtFrac(mx); it.rule[k] = "range"; }
      });
    }

    /* two of a kind (a column with power top and bottom) keep distinct
       keys, since the field answers are stored by key; `base` tells the
       core which group a key belongs to. Drawn zones ride along. */
    if (ch.utilities) {
      it.utilitiesSpec = composeUtilities(ch);
      it.utilitiesNone = !it.utilitiesSpec.length;      /* the office looked and found none */
      /* the rows as typed, so "Edit the spec" on the walk opens the same
         screen on the same words later (Cayden, 21 Oct: no way back in) */
      it.specRows = JSON.parse(JSON.stringify(ch.utilities.filter(function (u) { return u.key; })));
    }
    it.prep = composePrep(ch);
    if (ch.hood) it.hood = JSON.parse(JSON.stringify(ch.hood));
    it.specChoice = { rules: JSON.parse(JSON.stringify(ch.rules || {})), maxOn: JSON.parse(JSON.stringify(ch.maxOn || {})), noOpening: !!ch.noOpening,
      panel: JSON.parse(JSON.stringify(ch.panel || {})), installOther: !!ch.installOther, extraPages: (ch.extraPages || []).slice() };

    var pr = panelReadyOf(en, ch);
    if (pr === true || pr === false) it.panelReady = pr;
    if (pr === true) {
      it.panelBy = ch.panel.by || "";
      it.panelThicknessIn = S.num(ch.panel.thicknessIn) != null ? S.fmtFrac(S.num(ch.panel.thicknessIn)) : "";
      if (S.num(ch.panel.w) != null || S.num(ch.panel.h) != null) {
        it.panelSize = { w: S.num(ch.panel.w) != null ? S.fmtFrac(S.num(ch.panel.w)) : "", h: S.num(ch.panel.h) != null ? S.fmtFrac(S.num(ch.panel.h)) : "" };
      }
    }
    it.location = ch.where || "";
  }

  function framePage(pkg, w, it, en, pageNo, travel) {
    var S = SW();
    return renderPage(pkg, pageNo, 1500, 0.78).then(function (full) {
      return (travel ? renderPage(pkg, pageNo, travel, 0.62) : Promise.resolve({ dataUrl: "" })).then(function (thumb) {
        return S.putFrame({
          full: full.dataUrl, thumb: thumb.dataUrl, width: full.width, height: full.height,
          meta: { walkId: w.id, itemId: it.id, kind: "spec-page",
            checkName: en.model + " — install sheet p." + pageNo }
        }).then(function (stored) {
          return {
            photoId: stored.id, portalId: stored.portalId || "", thumb: thumb.dataUrl,
            pageNo: pageNo, doc: pkg.docName,
            heading: ((pkg.headings[pageNo] || [])[0] || "")
          };
        });
      });
    });
  }

  /* ---------- editing an opening that already exists --------------------
     The verify screen is the only place the spec, the connections and the
     prep get typed and drawn, and it only existed while a package was
     open. "Edit the spec" on the walk's setup page opens the same screen
     for one opening, seeded from the opening itself, with the install
     sheet it carries; Save writes back into the same opening (its field
     answers, photos and pins untouched) and remembers the reading for
     the next package. */
  function rowsFromSpec(list) {
    return (list || []).map(function (u) {
      var r = { key: u.base || String(u.key || "").replace(/\d+$/, ""), libLabel: u.label || "", plane: u.plane || "opening", pos: u.pos || "",
                volts: u.volts || "", amps: u.amps || "", type: u.type || "", where: "", need: "" };
      if (!r.volts && !r.amps && !r.type && u.need) r.need = u.need;
      if (u.where) r.where = String(u.where).replace(/^[^—]*—\s*/, "");
      if (u.zone) { r.zone = JSON.parse(JSON.stringify(u.zone)); if (u.zone.kind === "any") r.pos = REACH; }
      if (u.fixMissing) r.fixMissing = u.fixMissing;
      if (u.note) r.note = u.note;
      return r;
    });
  }
  function chFromItem(it) {
    var S = SW(), sc = it.specChoice || {};
    var ch = { basisKey: it.basisKey || "", pageNo: it.specPage ? (it.specPage.pageNo || 0) : 0, where: it.location || "",
      dims: { w: it.spec.w || "", d: it.spec.d || "", h: it.spec.h || "" },
      dimsMax: { w: (it.specMax || {}).w || "", d: (it.specMax || {}).d || "", h: (it.specMax || {}).h || "" },
      maxOn: JSON.parse(JSON.stringify(sc.maxOn || {})), extraPages: (sc.extraPages || []).slice(),
      installType: it.installType || "", installOther: !!sc.installOther,
      utilities: it.specRows ? JSON.parse(JSON.stringify(it.specRows)) : (it.utilitiesSpec ? rowsFromSpec(it.utilitiesSpec) : null),
      prep: JSON.parse(JSON.stringify(it.prep || [])),
      hood: it.hood ? JSON.parse(JSON.stringify(it.hood)) : null,
      panel: Object.assign({ ready: null, by: "", thicknessIn: "", w: "", h: "" }, sc.panel || {}),
      noOpening: !!sc.noOpening || (!it.spec.w && !it.spec.h && !it.spec.d && !!it.utilitiesSpec),
      rules: JSON.parse(JSON.stringify(sc.rules || it.rule || {})),
      confirmed: true, touched: true, from: "walk" };
    if (!sc.panel && (it.panelReady === true || it.panelReady === false)) ch.panel = { ready: it.panelReady, by: it.panelBy || "", thicknessIn: it.panelThicknessIn || "", w: (it.panelSize || {}).w || "", h: (it.panelSize || {}).h || "" };
    ["w", "d", "h"].forEach(function (k) { if (ch.dimsMax[k]) ch.maxOn[k] = true; });
    return ch;
  }
  function editOpening(walkId, itemId) {
    var S = SW(), w = S.walk(walkId);
    var it = w && (w.items || []).filter(function (x) { return x.id === itemId; })[0];
    if (!it) return false;
    reset();
    var en = { model: it.model || "(no model)", brand: it.brand || "", kind: it.category || "", description: it.appliance || "", from: 0, to: 0, edit: true };
    IMP.pkg = { docName: (it.specPage && it.specPage.doc) || w.specSource || "this walk", project: w.project || "", quoteNo: w.quoteNo || "",
      entries: [en], sheetSpecs: {}, sheetDates: {}, headings: {}, connHints: {}, cutouts: [], pdf: null, offset: 0, edit: { walkId: walkId, itemId: itemId } };
    IMP.choices[en.model] = chFromItem(it);
    IMP.step = "verify"; IMP.vQueue = [en.model]; IMP.vIdx = 0;
    var sp = it.specPage;
    if (sp && sp.pageNo) {
      if (sp.thumb) IMP.thumbs[sp.pageNo] = sp.thumb;
      S.photoUrl(sp.photoId, { walkId: walkId, portalId: sp.portalId || "" }).then(function (src) {
        if (src && IMP.pkg && IMP.pkg.edit && IMP.pkg.edit.itemId === itemId) { IMP.big[sp.pageNo] = src; if (rerender) rerender(); }
      }).catch(function () { });
    }
    return true;
  }
  function editing() { return !!(IMP.pkg && IMP.pkg.edit); }
  function saveEdit() {
    var S = SW(), ed = IMP.pkg.edit, w = S.walk(ed.walkId);
    var it = w && (w.items || []).filter(function (x) { return x.id === ed.itemId; })[0];
    var en = IMP.pkg.entries[0], ch = choiceOf(en);
    if (!it) { reset(); return; }
    applyChoice(it, en, ch);
    try { recordVerification(en, ch, it, w, IMP.pkg); } catch (e) { }
    S.touch(w); S.save();
    reset();
  }

  function buildWalk(done) {
    var pkg = IMP.pkg, S = SW();
    var w = S.blankWalk();
    w.project = pkg.project || (pkg.quoteNo ? "Quote " + pkg.quoteNo : "New site walk");
    w.jobNo = pkg.quoteNo || "";
    w.quoteNo = pkg.quoteNo || "";
    w.builder = pkg.builder || "";
    w.builderContact = pkg.customer || "";
    w.address = pkg.address || "";
    w.salesName = pkg.salesName || "";
    w.salesEmail = pkg.salesEmail || "";
    w.specSource = "Steel Cod Full Spec Package" +
      (pkg.version ? " v" + pkg.version : "") + " · " + pkg.docName;
    w.packageModels = pkg.entries.map(function (en) {
      return { model: en.model, pages: en.from ? "pp." + en.from + "-" + en.to : "added by hand" };
    });

    var travel = travelSize(pkg);
    var jobs = pkg.entries.map(function (en) {
      var ch = choiceOf(en);
      var it = S.blankItem();
      it.model = en.model;
      it.specRef = en.from ? "pp." + en.from + "–" + en.to : "";
      applyChoice(it, en, ch);

      /* The verification travels with the opening and is remembered for the
         next package. Cached-and-confirmed counts the same as typed: in both
         cases a person put their eyes on this job's drawing. */
      recordVerification(en, ch, it, w, pkg);

      if (!ch.pageNo) return Promise.resolve(it);

      /* photograph the chosen install sheet out of the package — two
         renders, for two journeys. The 1500px copy goes to the photo store:
         IndexedDB here, and up to the shop server, where any device can
         fetch it full size. The travel copy rides inside the walk itself,
         for when there is no portal to fetch from. Any extra pages ticked
         follow the same road. */
      /* With a shop server to fetch from, the model's whole run of pages
         goes up (Cayden: "the whole spec book at the installer's
         fingertips") — the pages the office ticked carry a travel copy,
         the rest are fetched by id when the phone has the server. */
      var ticked = ch.extraPages.slice(), auto = [];
      if (S.hasPortal() && en.from) {
        for (var pn = en.from; pn <= en.to && auto.length < 14; pn++) {
          if (pn !== ch.pageNo && ticked.indexOf(pn) < 0) auto.push(pn);
        }
      }
      return framePage(pkg, w, it, en, ch.pageNo, travel).then(function (sp) {
        it.specPage = sp;
        return ticked.concat(auto).reduce(function (p, pageNo) {
          var isAuto = ticked.indexOf(pageNo) < 0;
          return p.then(function () {
            return framePage(pkg, w, it, en, pageNo, isAuto ? 0 : travel).then(function (x) {
              if (isAuto) { x.thumb = ""; x.auto = true; }
              it.specPages = (it.specPages || []).concat([x]);
            }).catch(function () { });
          });
        }, Promise.resolve()).then(function () { return it; });
      }).catch(function () { return it; });     /* a page that will not render is not a lost opening */
    });

    IMP.busy = "Attaching the install sheets…";
    IMP.total = jobs.length; IMP.done = 0;
    if (rerender) rerender();
    var wrapped = jobs.map(function (j) {
      return j.then(function (it) { IMP.done++; if (rerender) rerender(); return it; });
    });
    Promise.all(wrapped).then(function (items) {
      w.items = items;
      S.load().walks.unshift(w);
      S.save();
      /* Out of room on this browser (v0.9.60). Creating the walk on the
         office page navigates, which reloads from storage — a walk that
         did not save is "gone" on the next screen. First drop the travel
         copies (the shop server holds every page by id); if that is still
         not enough, stay here and say so rather than lose the walk. */
      if (S.storageState().full) {
        items.forEach(function (it) {
          if (it.specPage) it.specPage.thumb = "";
          (it.specPages || []).forEach(function (x) { x.thumb = ""; });
        });
        S.save();
      }
      if (S.storageState().full) {
        var mb = (S.storageState().bytes / 1048576).toFixed(1);
        IMP.busy = "";
        IMP.error = "This browser is out of room — the walk was built but could NOT be saved on this device (it holds about " + mb +
          " MB of walks and the browser allows roughly 5). Delete finished or test walks from the queue, then create this one again.";
        if (rerender) rerender();
        return;
      }
      /* The sheets exist now, so start moving them to the shop server: a
         tech's phone can only fetch a page that was actually uploaded.
         Creating the walk then navigates to the setup page, which cuts this
         drain short — the new page picks it up on load, and this head start
         is what covers a build that does not navigate. */
      S.drainPhotos();
      reset();
      done(w);
    }).catch(function (err) {
      IMP.busy = ""; IMP.error = "The install sheets could not be attached: " + (err && err.message || err);
      if (rerender) rerender();
    });
  }

  /* ---------- events ----------------------------------------------------- */
  function entryFor(model) {
    return (IMP.pkg && IMP.pkg.entries || []).filter(function (x) { return x.model === model; })[0] || null;
  }
  function step(dir) {
    var vl = queueEntries();
    if (dir > 0) {
      if (IMP.vIdx >= vl.length - 1) IMP.step = "pick";
      else IMP.vIdx += 1;
    } else IMP.vIdx = Math.max(0, IMP.vIdx - 1);
    IMP.zoom = 0; IMP.zoomScroll = null;
  }

  function handle(act, t, host, render) {
    HOST = host; rerender = render;
    var m = t.getAttribute && t.getAttribute("data-m");
    var ch = m ? choiceOf({ model: m }) : null;
    if (act === "pkgcancel") { reset(); render(); return true; }
    if (act === "pkgspecedit") { if (editOpening(t.getAttribute("data-walk"), t.getAttribute("data-id"))) { render(); if (window.scrollTo) window.scrollTo(0, 0); } return true; }
    if (act === "pkgeditsave") { saveEdit(); ui.toast("Spec saved", "The opening carries the new numbers, connections and prep."); render(); return true; }
    if (act === "pkgbasis") {
      ch.basisKey = t.getAttribute("data-k");
      ch.basisAuto = "";
      ch.installOther = false; ch.installType = "";
      var en = entryFor(m);
      var e = SW().findModel(en.model);
      if (en.from) ch.pageNo = suggestPage(IMP.pkg, en, SW().variationOf(e, ch.basisKey));
      /* The opening belongs to the variation, not the model — a CL4850's
         flush and standard openings differ by inches — so picking the
         install re-seeds the numbers, unless somebody has already typed
         over them. */
      if (!ch.touched) seedDims(en.model, ch);
      seedPrep(ch, SW().variationOf(e, ch.basisKey));
      render(); return true;
    }
    if (act === "pkginstall") { ch.installType = ch.installType === t.getAttribute("data-k") ? "" : t.getAttribute("data-k"); render(); return true; }
    if (act === "pkginstallother") { ch.installOther = !ch.installOther; if (!ch.installOther) ch.installType = ""; render(); return true; }
    if (act === "pkgpage") {
      ch.pageNo = +t.getAttribute("data-p");
      ch.extraPages = ch.extraPages.filter(function (p) { return p !== ch.pageNo; });
      IMP.zoom = 0; IMP.zoomScroll = null;
      render(); return true;
    }
    if (act === "pkgpagex") {
      var px = +t.getAttribute("data-p");
      if (ch.extraPages.indexOf(px) >= 0) ch.extraPages = ch.extraPages.filter(function (p) { return p !== px; });
      else ch.extraPages.push(px);
      ch.extraPages.sort(function (a, b) { return a - b; });
      render(); return true;
    }

    /* --- the verify pass --- */
    if (act === "pkgverify") { IMP.step = "verify"; startQueue(); render(); return true; }
    if (act === "pkgverifyat") {
      /* Jumping straight at one model still walks the whole queue after it —
         a model opened on its own is not a reason to skip the rest. A model
         that is already ready opens on its own. */
      IMP.step = "verify"; IMP.zoom = 0; IMP.zoomScroll = null;
      startQueue(m);
      if ((IMP.vQueue || []).indexOf(m) < 0) { IMP.vQueue = [m]; IMP.vIdx = 0; }
      render(); return true;
    }
    if (act === "pkgbackpick" || act === "pkgtoreview") { IMP.step = "pick"; render(); return true; }
    if (act === "pkgzoom") {
      /* each click zooms a step closer toward the point clicked; the
         controls under the sheet go the other way. A drag is not a click. */
      if (IMP.dragged) { IMP.dragged = false; return true; }
      if (IMP.zoom >= ZOOMS.length - 1) return true;
      IMP.zoom = (IMP.zoom || 0) + 1; IMP.zoomAt = IMP.lastPoint || { fx: 0.5, fy: 0.5 };
      render(); return true;
    }
    if (act === "pkgzoomin" || act === "pkgzoomout" || act === "pkgzoomfit") {
      var box = HOST.querySelector(".sw-verify-page"), centre = { fx: 0.5, fy: 0.5 };
      if (box && IMP.zoom) {
        /* keep looking at the same spot through the change */
        centre = { fx: (box.scrollLeft + box.clientWidth / 2) / box.scrollWidth,
                   fy: (box.scrollTop + box.clientHeight / 2) / box.scrollHeight };
      }
      IMP.zoom = act === "pkgzoomfit" ? 0 : Math.max(0, Math.min(ZOOMS.length - 1, (IMP.zoom || 0) + (act === "pkgzoomin" ? 1 : -1)));
      IMP.zoomAt = IMP.zoom ? centre : null; IMP.zoomScroll = null;
      render(); return true;
    }
    if (act === "pkgprev") { step(-1); render(); return true; }
    if (act === "pkgnext") { step(1); render(); return true; }
    if (act === "pkgconfirm") {
      /* Confirming IS the review, so it also moves on — one click per
         model instead of two. Anything still open on the card (an install
         not picked, a panel question) keeps the row amber on the list. */
      ch.confirmed = true;
      step(1);
      render(); return true;
    }
    if (act === "pkgclear") {
      ch.dims = { w: "", d: "", h: "" }; ch.dimsMax = { w: "", d: "", h: "" }; ch.maxOn = {};
      ch.from = ""; ch.confirmed = false; ch.memory = null;
      render(); return true;
    }
    if (act === "pkgnoopening") {
      ch.noOpening = !ch.noOpening;
      if (ch.noOpening) { ch.dims = { w: "", d: "", h: "" }; ch.dimsMax = { w: "", d: "", h: "" }; ch.confirmed = true; }
      render(); return true;
    }
    if (act === "pkgcut") {
      var cc2 = sheetCutouts(entryFor(m), ch)[+t.getAttribute("data-i")];
      if (cc2) {
        var S2 = SW();
        ch.dims = { w: S2.fmtFrac(cc2.w), d: cc2.d != null ? S2.fmtFrac(cc2.d) : ch.dims.d, h: cc2.h != null ? S2.fmtFrac(cc2.h) : ch.dims.h };
        ch.noOpening = false; ch.touched = true; ch.confirmed = true; ch.from = "sheet";
      }
      render(); return true;
    }
    if (act === "pkgrule") { ch.rules = ch.rules || {}; ch.rules[t.getAttribute("data-k")] = t.getAttribute("data-v"); ch.touched = true; render(); return true; }
    if (act === "pkgmaxon") {
      ch.maxOn[t.getAttribute("data-k")] = true; render();
      var mf = HOST.querySelector('[data-pkgmax="' + m + '"][data-k="' + t.getAttribute("data-k") + '"]');
      if (mf) { mf.focus(); lastField = mf; }
      return true;
    }
    if (act === "pkgmaxoff") {
      var kk = t.getAttribute("data-k");
      ch.maxOn[kk] = false; ch.dimsMax[kk] = ""; ch.touched = true;
      render(); return true;
    }
    if (act === "pkgfrac") {
      /* Append the fraction to whichever field was last in focus — the one
         thing that makes "36 1/4" two clicks instead of six keystrokes. */
      var f = t.getAttribute("data-f");
      var target = lastField && document.contains(lastField) ? lastField
        : HOST.querySelector('[data-pkgdim="' + m + '"][data-k="w"]');
      if (!target) return true;
      var cur = String(target.value || "").trim().replace(/\s*\d+\/\d+$/, "");
      target.value = (cur ? cur + " " : "") + f;
      var isMax = target.hasAttribute("data-pkgmax");
      var cf = choiceOf({ model: target.getAttribute(isMax ? "data-pkgmax" : "data-pkgdim") });
      (isMax ? cf.dimsMax : cf.dims)[target.getAttribute("data-k")] = target.value;
      cf.touched = true;
      cf.confirmed = true;              /* they edited it — that is a look */
      render();
      var again = HOST.querySelector('[' + (isMax ? "data-pkgmax" : "data-pkgdim") + '="' + target.getAttribute(isMax ? "data-pkgmax" : "data-pkgdim") +
        '"][data-k="' + target.getAttribute("data-k") + '"]');
      if (again) { again.focus(); lastField = again; }
      return true;
    }

    /* --- connections --- */
    if (act === "pkgconnedit") { ch.utilities = rowsFromLibrary(ch, SW().findModel(m)); ch.utilFrom = "library"; render(); return true; }
    if (act === "pkgconnlib") {
      var le = SW().findModel(m), lent = entryFor(m) || { model: m };
      if (le && le.utilities && le.utilities.length) { ch.utilities = rowsFromLibrary(ch, le); ch.utilFrom = "library"; }
      else { ch.utilities = defaultRowsFor(lent, le); ch.utilFrom = "kind"; }
      drawState(ch).placing = null; render(); return true;
    }
    if (act === "pkgconnadd") { ch.utilities = ch.utilities || []; ch.utilities.push({ key: "", need: "", where: "" }); render(); return true; }
    if (act === "pkgconndel") { ch.utilities.splice(+t.getAttribute("data-i"), 1); render(); return true; }
    if (act === "pkgconnkind") { ch.utilities[+t.getAttribute("data-i")].key = t.getAttribute("data-k"); render(); return true; }
    if (act === "pkgridraw") {
      var dd = drawState(ch), di = +t.getAttribute("data-i"), du = ch.utilities[di];
      if (du.zone && du.zone.kind === "any") { delete du.zone; if (du.pos === REACH) du.pos = ""; }
      if (dd.placing === di) dd.placing = null;
      else { dd.placing = di; dd.plane = (du.zone && du.zone.plane) || (du.plane && du.plane !== "floor" ? du.plane : "opening"); }
      render(); return true;
    }
    if (act === "pkgprepadd") {
      ch.prep = ch.prep || []; ch.prepTouched = true;
      var npk = t.getAttribute("data-k") || "cleat";
      ch.prep.push(newPrep(npk, ""));
      if (!SW().prepKind(npk).strip) { drawState(ch).placing = { prep: ch.prep.length - 1 }; drawState(ch).plane = "opening"; }
      render(); return true;
    }
    if (act === "pkgprepface") { var fpr = ch.prep[+t.getAttribute("data-i")]; if (fpr) { SW().stripOf(fpr).face = t.getAttribute("data-v"); ch.prepTouched = true; } render(); return true; }
    if (act === "pkgprepfin") { var npr = ch.prep[+t.getAttribute("data-i")]; if (npr) { npr.finished = t.getAttribute("data-v") === "yes"; ch.prepTouched = true; } render(); return true; }
    if (act === "pkghoodset") {
      ch.hood = ch.hood || { type: "insert", under: "cooktop", duct: {} }; ch.hood.duct = ch.hood.duct || {};
      var hf = t.getAttribute("data-f"), hv = t.getAttribute("data-v"), tgt = t.getAttribute("data-sub") === "duct" ? ch.hood.duct : ch.hood;
      tgt[hf] = tgt[hf] === hv && hf !== "type" && hf !== "under" ? "" : hv;
      render(); return true;
    }
    if (act === "pkgprephint") {
      ch.prep = ch.prep || []; ch.prepTouched = true;
      var hk = t.getAttribute("data-k") || "blocking", hs = t.getAttribute("data-s"), hpr = newPrep(hk, t.getAttribute("data-t") || "");
      if (hs) { try { var hso = JSON.parse(hs); hpr.strip = Object.assign(SW().stripOf(hpr), hso.strip || {}); if (hso.finished != null) hpr.finished = hso.finished; if (hso.label) hpr.label = hso.label; } catch (x) { } }
      if (SW().isStrip(hpr)) { hpr.hint = hpr.note; hpr.note = ""; }     /* the strip's own words say it */
      ch.prep.push(hpr);
      if (!SW().isStrip(hpr)) { drawState(ch).placing = { prep: ch.prep.length - 1 }; drawState(ch).plane = "opening"; }
      render(); return true;
    }
    if (act === "pkgprepkind") {
      var kpr = ch.prep[+t.getAttribute("data-i")], kk = t.getAttribute("data-k");
      kpr.kind = kk; ch.prepTouched = true;
      if (SW().prepKind(kk).strip && !SW().stripOf(kpr).face) kpr.strip.face = "both";
      if (SW().prepKind(kk).strip) { delete kpr.zone; kpr.finished = SW().prepKind(kk).finished; }
      render(); return true;
    }
    if (act === "pkgprepdel") { ch.prep.splice(+t.getAttribute("data-i"), 1); drawState(ch).placing = null; render(); return true; }
    if (act === "pkgprepclear") { delete ch.prep[+t.getAttribute("data-i")].zone; render(); return true; }
    if (act === "pkgprepdraw") {
      var pd = drawState(ch), pix = +t.getAttribute("data-i"), ppr = ch.prep[pix];
      if (pd.placing && pd.placing.prep === pix) pd.placing = null;
      else { pd.placing = { prep: pix }; pd.plane = (ppr.zone && ppr.zone.plane) || "opening"; }
      render(); return true;
    }
    if (act === "pkgriplane" || act === "pkgrimark") {
      if (IMP.riJustPlaced) { IMP.riJustPlaced = false; return true; }
    }
    if (act === "pkgriplane") {
      drawState(ch).plane = t.getAttribute("data-v");
      render(); return true;
    }
    if (act === "pkgrimark") {
      /* tapping a drawn box selects it: handles on the corners to resize,
         the body to move; ✎ Redraw on the row starts over */
      var mk = t.getAttribute("data-key"), ds = drawState(ch);
      if (ds.placing != null) return true;
      ds.selected = ds.selected === mk ? "" : mk;
      var mrow = markRowRaw(ch, mk);
      if (mrow && mrow.zone) ds.plane = mrow.zone.plane || "opening";
      render(); return true;
    }
    if (act === "pkgrisel") { drawState(ch).selected = t.getAttribute("data-key") || ""; render(); return true; }
    if (act === "pkgristd") {
      var srow = markRowRaw(ch, drawState(ch).selected), sstd = srow ? SW().stdBox(srow) : null;
      if (srow && srow.zone && srow.zone.kind === "rect" && sstd) {
        var sz = srow.zone, ps = sz.planeSize || { w: 1e9, h: 1e9 }, scx = (sz.x0 + sz.x1) / 2, scy = (sz.y0 + sz.y1) / 2;
        var nx0 = Math.min(ps.w - sstd.w, Math.max(0, scx - sstd.w / 2)), ny0 = Math.min(ps.h - sstd.h, Math.max(0, scy - sstd.h / 2));
        sz.x0 = snap8(nx0); sz.x1 = snap8(nx0 + sstd.w); sz.y0 = snap8(ny0); sz.y1 = snap8(ny0 + sstd.h); sz.std = true;
      }
      render(); return true;
    }
    if (act === "pkgriclear") { delete ch.utilities[+t.getAttribute("data-i")].zone; render(); return true; }
    if (act === "pkgconnspec") {
      var cs = ch.utilities[+t.getAttribute("data-i")], cf = t.getAttribute("data-f"), cv = t.getAttribute("data-v");
      cs[cf] = cs[cf] === cv ? "" : cv;
      render(); return true;
    }
    if (act === "pkgconnplane") {
      var cp = ch.utilities[+t.getAttribute("data-i")], pv = t.getAttribute("data-v");
      if (cp.plane === pv) { cp.plane = ""; cp.pos = ""; } else { cp.plane = pv; cp.pos = ""; }
      /* the sketch: pick the neighbouring cabinet → the drawing closes in
         on it, ready for the drag — unless a box is already drawn there */
      var cpi = +t.getAttribute("data-i"), cpd = drawState(ch);
      if (cp.zone && cp.zone.kind === "any") delete cp.zone;        /* a new cabinet: the "anywhere" no longer applies */
      if (cp.pos === REACH) cp.pos = "";
      if (cp.plane && cp.plane !== "floor" && !(cp.zone && cp.zone.plane === cp.plane)) {
        if (cp.zone && cp.zone.plane !== cp.plane) delete cp.zone;      /* drawn somewhere else: start again */
        cpd.placing = cpi; cpd.plane = cp.plane;
      } else if (!cp.plane && cpd.placing === cpi) {
        cpd.placing = null; cpd.plane = "opening";
      }
      render(); return true;
    }
    if (act === "pkgconnpos") {
      var cq = ch.utilities[+t.getAttribute("data-i")], cqv = t.getAttribute("data-v"), cqi = +t.getAttribute("data-i");
      cq.pos = cq.pos === cqv ? "" : cqv;
      /* "anywhere in it" is a zone of its own — the whole cabinet, no
         drawing needed — and un-picking it clears that zone */
      if (cq.pos === REACH && cq.plane && cq.plane !== "opening" && cq.plane !== "floor") {
        var rm = SW().roughInModel(previewItem(entryFor(m) || { model: m }, ch), planeSizes(ch));
        var rp = rm && rm.planes[cq.plane];
        cq.zone = { kind: "any", plane: cq.plane, planeSize: rp ? { w: rp.w, h: rp.h } : {} };
        if (drawState(ch).placing === cqi) drawState(ch).placing = null;
      } else if (cq.zone && cq.zone.kind === "any") {
        delete cq.zone;
      }
      render(); return true;
    }
    if (act === "pkgconnhint") {
      ch.utilities = ch.utilities || [];
      var hk = t.getAttribute("data-k"), ht = t.getAttribute("data-t");
      var have = ch.utilities.filter(function (u) { return u.key === hk; })[0];
      if (!have) { have = { key: hk, need: "", where: "" }; ch.utilities.push(have); }
      connFromText(have, ht);
      render(); return true;
    }

    /* --- panel --- */
    if (act === "pkgpanel") {
      ch.panel.ready = t.getAttribute("data-v") === "1";
      if (ch.panel.ready && !ch.panel.thicknessIn) ch.panel.thicknessIn = "3/4";
      render(); return true;
    }
    if (act === "pkgpanelby") { ch.panel.by = ch.panel.by === t.getAttribute("data-v") ? "" : t.getAttribute("data-v"); render(); return true; }

    /* --- a model the contents left out --- */
    if (act === "pkgaddopen") { IMP.add = { model: "", brand: "", kind: "", from: "", to: "", error: "" }; render(); setTimeout(function () { var f = HOST.querySelector('[data-pkgadd="model"]'); if (f) f.focus(); }, 0); return true; }
    if (act === "pkgaddcancel") { IMP.add = null; render(); return true; }
    if (act === "pkgaddsave") {
      var a = IMP.add, model = (a.model || "").trim().toUpperCase().replace(/\s+/g, " ");
      if (!model) { a.error = "The model number is the one thing it needs."; render(); return true; }
      if (entryFor(model)) { a.error = model + " is already in the list."; render(); return true; }
      var from = parseInt(a.from, 10), to = parseInt(a.to, 10);
      var maxPage = IMP.pkg.pdf ? IMP.pkg.pdf.numPages - IMP.pkg.offset : 9999;
      if (a.from && (isNaN(from) || from < 1 || from > maxPage)) { a.error = "Pages run 1 to " + maxPage + " in this package."; render(); return true; }
      if (isNaN(from)) { from = 0; to = 0; }
      else if (isNaN(to) || to < from) to = from;
      if (to > maxPage) to = maxPage;
      var lib = SW().findModel(model);
      var entry = { model: model, brand: (a.brand || (lib && lib.brand) || "").trim(), kind: (a.kind || "").trim(),
                    description: lib ? lib.appliance : "", from: from, to: to, manual: true, sku: "" };
      IMP.pkg.entries.push(entry);
      IMP.add = null;
      if (from) hydrateThumbs(entry);
      IMP.step = "verify"; IMP.zoom = 0;
      startQueue(model);
      if ((IMP.vQueue || []).indexOf(model) < 0) { IMP.vQueue = [model]; IMP.vIdx = 0; }
      render(); return true;
    }

    if (act === "pkglibsave") {
      var out = saveToLibrary();
      reset();
      ui.toast(out.saved.length + " model" + (out.saved.length === 1 ? "" : "s") + " saved to the library",
        (out.skipped.length ? out.skipped.length + " not checked yet and left out: " + out.skipped.slice(0, 4).join(", ") + (out.skipped.length > 4 ? "…" : "") + ". " : "") +
        "The next spec book with " + (out.saved.length === 1 ? "this model" : "these models") + " arrives with the numbers filled in.");
      if (location.hash.indexOf("#/office/library") !== 0) location.hash = "#/office/library";
      render(); return true;
    }
    if (act === "pkgbuild") {
      var pkg = IMP.pkg;
      if (!pkg || !pkg.entries.length) return true;
      var pending = pkg.entries.filter(function (en) {
        var e = SW().findModel(en.model);
        return e && e.variations.length > 1 && !choiceOf(en).basisKey;
      });
      if (pending.length) {
        ui.toast("Pick the install first", pending.map(function (p) { return p.model; }).join(", ") +
          (pending.length > 1 ? " have" : " has") + " more than one installation detail in the book.");
        var el = document.getElementById("pkg-en-" + pkg.entries.indexOf(pending[0]));
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
      }
      buildWalk(function (w) {
        ui.toast("Walk created", w.items.length + " openings, install sheets attached. Send the tech the field link.");
        SW().goto(SW().nav("office", w.id));
        render();
      });
      render(); return true;
    }
    return false;
  }

  /* Every model in the book whose numbers a person has checked goes into
     the library exactly as a walk would have left it: the numbers, the
     rules, the connections and prep, the sheet and its date, and who
     checked. Nothing unchecked is saved. */
  function saveToLibrary() {
    var pkg = IMP.pkg, saved = [], skipped = [];
    (pkg ? pkg.entries : []).forEach(function (en) {
      var ch = choiceOf(en);
      if (dimStatus(en, ch) !== "verified") { skipped.push(en.model); return; }
      recordVerification(en, ch, {}, null, pkg);
      saved.push(en.model);
    });
    return { saved: saved, skipped: skipped };
  }

  function onFile(files, render, opts) {
    rerender = render;
    var f = files && files[0];
    if (!f) return;
    reset();
    IMP.lib = !!(opts && opts.library);
    IMP.busy = "Reading " + (f.name || "the package") + "…";
    render();
    /* v0.9.85: read against the shared library as it stands now — what a
       colleague confirmed this morning should arrive filled in. Four
       seconds at most; the book is read either way. */
    var fresh = SW().syncLibrary ? Promise.race([SW().syncLibrary(), new Promise(function (res) { setTimeout(res, 4000); })]).catch(function () { }) : Promise.resolve();
    fresh.then(function () { return scanPackage(f); }).then(function (pkg) {
      IMP.busy = ""; IMP.pkg = pkg;
      render();
      hydrateThumbs();
    }).catch(function (err) {
      IMP.busy = "";
      IMP.error = (err && err.message) || "That PDF could not be read.";
      render();
    });
  }

  var lastField = null;

  function onInput(e) {
    var el = e.target;
    if (!el.getAttribute) return false;
    var m = el.getAttribute("data-pkgwhere");
    if (m) { choiceOf({ model: m }).where = el.value; return true; }
    var hm = el.getAttribute("data-pkghood");
    if (hm) {
      var hch = choiceOf({ model: hm }); hch.hood = hch.hood || { type: "insert", under: "cooktop", duct: {} }; hch.hood.duct = hch.hood.duct || {};
      (el.getAttribute("data-sub") === "duct" ? hch.hood.duct : hch.hood)[el.getAttribute("data-f")] = el.value;
      return true;
    }
    var dm = el.getAttribute("data-pkgdim"), mx = el.getAttribute("data-pkgmax");
    if (dm || mx) {
      var ch = choiceOf({ model: dm || mx });
      (dm ? ch.dims : ch.dimsMax)[el.getAttribute("data-k")] = el.value;
      ch.touched = true;
      /* Typing over a number IS the look this screen asks for. */
      ch.confirmed = true;
      lastField = el;
      /* live legibility check without a re-render that would steal focus */
      var lab = el.closest ? el.closest(".sw-pkg-dim") : null;
      if (lab) lab.classList.toggle("bad", !!el.value && SW().num(el.value) == null);
      return true;
    }
    var cm = el.getAttribute("data-pkgconn");
    if (cm) {
      var cu = choiceOf({ model: cm }).utilities[+el.getAttribute("data-i")];
      if (cu) cu[el.getAttribute("data-f")] = el.value;
      return true;
    }
    var ppm = el.getAttribute("data-pkgprep");
    if (ppm) {
      var ppch = choiceOf({ model: ppm }), ppr2 = ppch.prep[+el.getAttribute("data-i")], ppf = el.getAttribute("data-f") || "";
      if (ppr2) { if (/^strip\./.test(ppf)) SW().stripOf(ppr2)[ppf.slice(6)] = el.value; else ppr2[ppf] = el.value; ppch.prepTouched = true; }
      return true;
    }
    var plm = el.getAttribute("data-pkgplane");
    if (plm) { drawState(choiceOf({ model: plm })).sizes[el.getAttribute("data-p")] = el.value; return true; }
    var pm = el.getAttribute("data-pkgpanel");
    if (pm) { choiceOf({ model: pm }).panel[el.getAttribute("data-f")] = el.value; return true; }
    var am = el.getAttribute("data-pkgadd");
    if (am && IMP.add) { IMP.add[am] = el.value; IMP.add.error = ""; return true; }
    return false;
  }

  /* Enter walks the three fields and then the models, so a whole package
     can be verified without the mouse. */
  function onKeydown(e) {
    var el = e.target;
    if (!el.getAttribute) return false;
    if (el.getAttribute("data-pkgadd")) {
      if (e.key === "Enter") { e.preventDefault(); handle("pkgaddsave", el, HOST, rerender); }
      return true;
    }
    if (!el.getAttribute("data-pkgdim")) return false;
    lastField = el;
    if (e.key !== "Enter") return false;
    e.preventDefault();
    var order = ["w", "d", "h"];
    var at = order.indexOf(el.getAttribute("data-k"));
    var next = order[at + 1];
    if (next) {
      var nf = HOST.querySelector('[data-pkgdim="' + el.getAttribute("data-pkgdim") +
        '"][data-k="' + next + '"]');
      if (nf) { nf.focus(); nf.select(); lastField = nf; return true; }
    }
    step(1);
    if (rerender) rerender();
    var first = HOST.querySelector('[data-pkgdim][data-k="w"]');
    if (first) { first.focus(); lastField = first; }
    return true;
  }
  function onFocus(e) {
    var el = e.target;
    if (el.getAttribute && (el.getAttribute("data-pkgdim") || el.getAttribute("data-pkgmax"))) lastField = el;
  }

  window.WILSON_SW_SPECPKG = {
    active: active, startCard: startCard, wizard: wizard, editing: editing, editOpening: editOpening, isLibrary: isLibrary,
    handle: handle, onFile: onFile, onInput: onInput,
    onKeydown: onKeydown, onFocus: onFocus, afterRender: afterRender,
    ensurePdfJs: ensurePdfJs, scanPackage: scanPackage, renderPage: renderPage,
    suggestPage: suggestPage, headingMatches: headingMatches, parsePackage: parsePackage,
    pageLines: pageLines, parseConnHints: parseConnHints, parsePrepHints: parsePrepHints, fixShifted: fixShifted, shortName: shortName, parseCutouts: parseCutouts, inchTokens: inchTokens,
    /* for the QA harness */
    _state: function () { return IMP; }, _choiceOf: choiceOf, _rowStatus: rowStatus, _applyChoice: applyChoice
  };
})();

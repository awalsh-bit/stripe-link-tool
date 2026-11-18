/* =============================================================================
   Site walk ↔ ePASS ticket reconciliation — Phase A of the Agility port.

   Pure functions. No DOM, no database, no fetch: a walk document in, the
   job's ticket rows in (as the ePASS open-orders pull delivers them), a diff
   out. Loads as a browser script (window.WILSON_SW_TICKET) and as a Node
   module (require / import), so the same code runs in the office page today
   and in lib/ tomorrow.

   What the ticket can say about a unit, without finished tickets:
     in_building   a serial on hand is reserved to this ticket (with its bin)
     taken         the line is marked taken and no serial is on hand
     on_order      an open PO line is back-ordered for this ticket (ETA or none)
     unknown       none of the above
   A unit on a FINISHED ticket is invisible to the open pull; the walk's
   "Appliance already set" reason covers it by hand until that export exists.

   Rules that name a trade or a SKU were read off the 22 Sep 2026 pull and
   Cayden's notes (merges are refrigeration only; the kits are real part
   numbers). Nothing here invents a dimension.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WILSON_SW_TICKET = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /* ---------- reference data ------------------------------------------- */
  /* Join / merge kits by brand. Refrigeration only. */
  var MERGE_KITS = {
    "7023628": "Sub-Zero dual installation kit (integrated column)",
    "7029829": "Sub-Zero dual installation kit (integrated refrigeration)",
    "9033707": "Sub-Zero classic dual installation kit",
    "9901428": "Liebherr side-by-side installation kit",
    "ZKUN":    "Miele side-by-side dual installation kit",
    "JAJ13HSS": "JennAir column joining kit",
    "216542":  "True undercounter anti-condensation pad (side-by-side)"
  };
  /* ePASS product codes that are accessories, not openings. */
  var ACCESSORY_PRODUCTS = { ACC: 1, PANEL: 1, TRIMK: 1, PED: 1, ACCON: 1, ACKW: 1, LP: 1, CORD: 1, ACAH: 1, STAT: 1, AIRPU: 1, FCET: 1, IMK: 1 };
  /* ePASS product codes that are refrigeration (the only things that merge). */
  var REFRIGERATION_PRODUCTS = /^(RE|IMUC|IMK|WINE|BEV)/;
  /* Install labor codes → what the walk should expect. */
  var INSTALL_CODES = {
    REFRIG3: { form: "standard", panel: "wilson", label: "built-in with panel" },
    REFRIG5: { form: "standard", panel: "wilson", label: "built-in column with panel" },
    REFRIG7: { form: "standard", panel: "wilson", label: "undercounter with panel" },
    REFRIG6: { form: "standard", panel: "",       label: "undercounter, no panel" },
    REFRIG2: { form: "standard", panel: "",       label: "built-in, no panels" },
    REFRIG8: { form: "standard", panel: "",       label: "undercounter drawers" },
    DW2:     { form: "standard", panel: "wilson", label: "dishwasher with panel" },
    DW1:     { form: "standard", panel: "",       label: "dishwasher, standard" },
    "IMAKER-PR": { form: "standard", panel: "wilson", label: "ice maker with panel" },
    IMAKER:  { form: "standard", panel: "",       label: "ice maker" },
    VENT2:   { form: "hood",     panel: "",       label: "wall hood" },
    VENT4:   { form: "hood",     panel: "",       label: "hood liner / insert" },
    CTOP1:   { form: "cooktop",  panel: "",       label: "cooktop, standard" },
    CTOP4:   { form: "cooktop",  panel: "",       label: "pro rangetop" },
    GRILL1:  { form: "grill",    panel: "",       label: "outdoor grill" },
    GRILL4:  { form: "grill",    panel: "",       label: "access door / drawer" },
    LAUNDRY01: { form: "laundry", panel: "",      label: "washer / laundry pair" },
    LAUNDRY03: { form: "laundry", panel: "",      label: "dryer" },
    LAUNDRY06: { form: "laundry", panel: "",      label: "washer / dryer pair" },
    LAUNDRY09: { form: "laundry", panel: "",      label: "laundry center" },
    "MOD-SURVEY": { survey: true, label: "check measurements (site walk)" }
  };
  /* The "install" family a product code belongs to, for pairing a swapped
     model with the opening it replaced. */
  function familyOf(productCode, model) {
    var p = String(productCode || "").toUpperCase();
    if (/^DW/.test(p)) return "dishwasher";
    if (/^IMUC|^IMK/.test(p)) return "icemaker";
    if (/^RE/.test(p)) return "refrigeration";
    if (/^OV|^COFFE|^STEAM|^WD$/.test(p)) return "oven";
    if (/^MW/.test(p)) return "microwave";
    if (/^VH/.test(p)) return "hood";
    if (/^CT/.test(p)) return "cooktop";
    if (/^RA/.test(p)) return "range";
    if (/^WASH|^DR|^WD/.test(p)) return "laundry";
    if (/^GR/.test(p)) return "grill";
    if (/^DISP/.test(p)) return "disposer";
    return p.toLowerCase() || "other";
  }

  /* ---------- model numbers -------------------------------------------- */
  /* The base model drops the hinge / handle / finish suffix so DEU2450CI/L
     and DEU2450CI/R are the same unit; TUR-24-L-OP-C and TUR-24-R-OP-C too. */
  function normModel(m) { return String(m || "").trim().toUpperCase().replace(/\s+/g, ""); }
  function baseModel(m) {
    var s = normModel(m);
    if (!s) return "";
    s = s.split("/")[0];                              /* Sub-Zero, Wolf, Cove: /L /R /O /S/T … */
    s = s.replace(/-(L|R)(?=-)/, "");                /* True: TUR-24-L-OP-C */
    return s;
  }
  /* The hinge a full model code declares, if it declares one. */
  function hingeOf(m) {
    var s = normModel(m);
    var mm = s.match(/\/(L|R)(?:\/|$)/) || s.match(/-(L|R)-/);
    return mm ? (mm[1] === "L" ? "left" : "right") : "";
  }

  /* ---------- which tickets are the job ------------------------------- */
  function ticketBase(code) { return String(code || "").split("-")[0].toUpperCase(); }
  /* The walk stores the whole address; the ticket keeps the street on its
     own line. Compare the street. */
  function sameAddress(a, b) {
    var na = normAddr(String(a || "").split(",")[0]), nb = normAddr(String(b || "").split(",")[0]);
    return na.length >= 6 && na === nb;
  }
  function normAddr(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  /* Every ticket of the base job, plus any ticket at the same sold-to
     address for the same bill-to (the outdoor kitchen on its own number). */
  function ticketsForJob(orders, jobBase, opts) {
    opts = opts || {};
    var base = ticketBase(jobBase);
    var mine = (orders || []).filter(function (o) { return ticketBase(o.Code) === base; });
    var addr = opts.address || (mine[0] && mine[0].SoldToAddress1) || "";
    var bill = String(opts.builder || (mine[0] && mine[0].BillToLastName) || "").toUpperCase();
    (orders || []).forEach(function (o) {
      if (mine.indexOf(o) >= 0) return;
      if (addr && sameAddress(o.SoldToAddress1, addr) && (!bill || String(o.BillToLastName || "").toUpperCase() === bill)) mine.push(o);
    });
    return mine;
  }

  /* ---------- what the ticket says about each unit --------------------- */
  function presenceOf(line, serials, poLines) {
    var inv = line.InvoiceCode, model = normModel(line.ModelCode);
    var onHand = (serials || []).filter(function (s) {
      return normModel(s.ModelCode) === model && (s.OrderedForInvoiceCode === inv || s.InvoiceCode === inv);
    });
    if (onHand.length) return { state: "in_building", bins: onHand.map(function (s) { return s.BinLocationCode || ""; }), received: onHand[0].DateReceived || "" };
    var po = (poLines || []).filter(function (p) {
      return normModel(p.ModelCode) === model && p.BackOrderInvoiceCode === inv && !(p.Received === "True" || p.Received === true || p.Received === "1");
    })[0];
    if (po) return { state: "on_order", po: po.POCode, eta: po.ETADateMostUpdated || po.ETADate || "", supplier: po.SupplierDescription || "" };
    if (line.TakenStatus) return { state: "taken", takenDate: line.TakenDate || "", how: line.TakenStatus };
    return { state: "unknown" };
  }
  function isAccessory(line) {
    var p = String(line.Model_ProductCode || "").toUpperCase();
    return !!ACCESSORY_PRODUCTS[p] || !!MERGE_KITS[normModel(line.ModelCode)];
  }
  function isRefrigerationLine(line) { return REFRIGERATION_PRODUCTS.test(String(line.Model_ProductCode || "").toUpperCase()); }

  /* Ticket lines → units the walk should have openings for, grouped by base
     model with quantities added across the job's tickets. */
  function unitsOnJob(tickets, lines, serials, poLines) {
    var codes = {}; tickets.forEach(function (t) { codes[t.Code] = t; });
    var units = {}, accessories = [];
    (lines || []).forEach(function (l) {
      if (!codes[l.InvoiceCode]) return;
      var rec = {
        invoice: l.InvoiceCode, area: (codes[l.InvoiceCode].SoldToLastName || ""),
        model: normModel(l.ModelCode), base: baseModel(l.ModelCode), brand: l.Model_BrandCode || "",
        product: l.Model_ProductCode || "", family: familyOf(l.Model_ProductCode, l.ModelCode),
        desc: l.ModelDesc || "", qty: Number(l.QtyOrdered || 1) || 1,
        presence: presenceOf(l, serials, poLines),
        modified: l.DateModified || "", modifiedBy: l.UserModified || ""
      };
      if (isAccessory(l)) { rec.kit = MERGE_KITS[rec.model] || ""; accessories.push(rec); return; }
      var k = rec.base;
      if (!units[k]) units[k] = { base: k, family: rec.family, brand: rec.brand, product: rec.product, qty: 0, lines: [] };
      units[k].qty += rec.qty;
      units[k].lines.push(rec);
    });
    return { units: Object.keys(units).map(function (k) { return units[k]; }), accessories: accessories };
  }

  /* ---------- the walk side ------------------------------------------- */
  /* Every unit the walk carries: plain openings, and each unit of a merge. */
  function unitsOnWalk(walk) {
    var out = [];
    (walk.items || []).forEach(function (it) {
      if (it.merge && it.merge.units && it.merge.units.length > 1) {
        it.merge.units.forEach(function (u, i) {
          out.push({ itemId: it.id, unitIdx: i, model: normModel(u.model), base: baseModel(u.model), item: it, merged: true });
        });
      } else if (it.model) {
        out.push({ itemId: it.id, unitIdx: null, model: normModel(it.model), base: baseModel(it.model), item: it, merged: false });
      }
    });
    return out;
  }
  function itemTitle(it) { return it.appliance || it.model || "Untitled opening"; }
  function itemWhere(it) { return [it.area, it.location].filter(Boolean).join(" — "); }
  function walkHinge(it) { return (it.swing && it.swing.on && it.swing.hinge) || ""; }
  function walkWallSide(it) { return (it.swing && it.swing.on && it.swing.wallSide) || ""; }

  /* ---------- the diff ------------------------------------------------- */
  function diff(walk, tickets, opts) {
    opts = opts || {};
    var orders = ticketsForJob(tickets.orders, walk.jobNo || opts.jobBase, { address: walk.address, builder: walk.builder });
    var codes = {}; orders.forEach(function (t) { codes[t.Code] = t; });
    var job = unitsOnJob(orders, tickets.lines, tickets.serials, tickets.poLines);
    var misc = (tickets.misc || []).filter(function (m) { return codes[m.InvoiceCode]; });
    var wu = unitsOnWalk(walk);
    var diffs = [];
    function add(d) { d.id = [d.kind, d.itemId || "", d.invoice || "", d.model || ""].join("|"); diffs.push(d); }

    /* 1. match walk units to ticket units by base model */
    var byBase = {}; job.units.forEach(function (u) { byBase[u.base] = u; });
    var claimed = {};
    var unmatchedWalk = [];
    wu.forEach(function (w) {
      var u = byBase[w.base];
      if (!u) { unmatchedWalk.push(w); return; }
      claimed[u.base] = (claimed[u.base] || 0) + 1;
      /* variant: same unit, different suffix (hinge, handle, finish) */
      var exact = u.lines.filter(function (l) { return l.model === w.model; })[0];
      if (!exact) {
        var line = u.lines[0], th = hingeOf(line.model), wh = hingeOf(w.model), rec = walkHinge(w.item), wall = walkWallSide(w.item);
        var explained = !!(th && rec && th === rec);
        add({
          kind: "variant", itemId: w.itemId, unitIdx: w.unitIdx, invoice: line.invoice, model: line.model,
          from: w.model, to: line.model, hinge: th, walkHinge: rec, walkWallSide: wall,
          state: explained ? "confirmed" : "open",
          owner: explained ? "wilson" : "sales", kind2: explained ? "note" : "question", severity: "blocks",
          text: explained
            ? itemTitle(w.item) + ": the order now reads " + line.model + " (was " + w.model + "). The walk recorded the door hinged " + rec + (wall ? " with the wall on the " + wall : "") + ", so the change agrees with the opening. Model updated on the walk."
            : itemTitle(w.item) + ": the order now reads " + line.model + " (was " + w.model + ")" + (th && wh && th !== wh ? " — hinge " + wh + " → " + th : "") + ". Confirm the hinge side, panel handle and door clearance against the opening before delivery.",
          suggest: explained ? { itemId: w.itemId, unitIdx: w.unitIdx, set: { model: line.model } } : null
        });
      }
    });
    /* 2. ticket units with no opening */
    var unmatchedTicket = job.units.filter(function (u) { return !claimed[u.base]; });
    /* 2a. pair a swapped model with the opening it replaced: one unmatched on
       each side, same family */
    unmatchedWalk.slice().forEach(function (w) {
      var fam = (w.item.category || "").toLowerCase() || familyGuess(w.item);
      var cands = unmatchedTicket.filter(function (u) { return u.family === fam; });
      var sameFamWalk = unmatchedWalk.filter(function (x) { return (familyGuess(x.item)) === fam; });
      if (cands.length === 1 && sameFamWalk.length === 1) {
        var u = cands[0];
        unmatchedTicket.splice(unmatchedTicket.indexOf(u), 1);
        unmatchedWalk.splice(unmatchedWalk.indexOf(w), 1);
        add({
          kind: "model_changed", itemId: w.itemId, unitIdx: w.unitIdx, invoice: u.lines[0].invoice, model: u.lines[0].model,
          from: w.model, to: u.lines[0].model, state: "open", owner: "sales", kind2: "question", severity: "blocks",
          text: itemTitle(w.item) + " was walked as " + w.model + "; the order now carries " + u.lines[0].model + " (" + (u.lines[0].desc || u.family) + "). Re-verify the opening against the new model's sheet before delivery.",
          suggest: null
        });
      }
    });
    unmatchedTicket.forEach(function (u) {
      var l = u.lines[0];
      var inst = installFor(misc, u);
      add({
        kind: "not_on_walk", itemId: null, invoice: l.invoice, model: l.model, family: u.family, qty: u.qty,
        area: l.area, presence: l.presence, form: inst ? inst.form : "", panel: inst ? inst.panel : "",
        state: "open", owner: "internal", kind2: "fix", severity: "blocks",
        text: l.model + " — " + (l.desc || u.family) + " (" + u.qty + " on " + l.invoice + (l.area ? ", " + l.area : "") + ") has no opening on the walk. " + presenceText(l.presence) +
          (inst ? " Ticket installs it as " + inst.label + "." : ""),
        suggest: { addOpening: { model: l.model, brand: l.brand, appliance: l.desc, area: l.area, form: inst ? inst.form : "", panelBy: inst ? inst.panel : "" } }
      });
    });
    unmatchedWalk.forEach(function (w) {
      add({
        kind: "not_on_ticket", itemId: w.itemId, unitIdx: w.unitIdx, invoice: "", model: w.model,
        state: "open", owner: "internal", kind2: "question", severity: "cosmetic",
        text: itemTitle(w.item) + " (" + w.model + ") is not on any open ticket for this job. Either it delivered on a finished ticket, or it was dropped from the order. " +
          (w.item.notReady ? "The walk already marks it: " + w.item.notReady + "." : "Mark it installed or confirm with the salesperson."),
        suggest: null
      });
    });
    /* 3. quantities */
    job.units.forEach(function (u) {
      var have = claimed[u.base] || 0;
      if (have && have !== u.qty) {
        add({
          kind: "qty", itemId: null, invoice: u.lines[0].invoice, model: u.lines[0].model, ticketQty: u.qty, walkQty: have,
          state: "open", owner: "sales", kind2: "question", severity: "blocks",
          text: u.lines[0].model + ": the order carries " + u.qty + ", the walk has " + have + " opening" + (have === 1 ? "" : "s") + ". " +
            (u.qty > have ? "Where does the other one go?" : "Which opening is no longer getting one?"),
          suggest: null
        });
      }
    });
    /* 4. accessories: kits, panels, and anything with no ETA */
    var walkMerges = (walk.items || []).filter(function (it) { return it.merge && it.merge.units && it.merge.units.length > 1; });
    var kits = job.accessories.filter(function (a) { return a.kit; });
    kits.forEach(function (a) {
      var target = walkMerges[0] || null;      /* one merge per job is the common case */
      var kitState = a.presence.state === "in_building" ? "onsite" : "ordered";
      var noEta = a.presence.state === "on_order" && !a.presence.eta;
      add({
        kind: "accessory", sub: "merge_kit", itemId: target ? target.id : null, invoice: a.invoice, model: a.model,
        presence: a.presence, state: target ? "confirmed" : "open", owner: "internal", kind2: target ? "note" : "question", severity: a.presence.state === "on_order" && !a.presence.eta ? "blocks" : "cosmetic",
        text: a.kit + " (" + a.model + ") is on " + a.invoice + ". " + presenceText(a.presence) +
          (noEta ? " Chase the date before delivery is scheduled." : "") +
          (target ? " Answers the merge's kit question: " + kitState + "." : " The walk has no merged opening — is this a merge, or separate cavities?"),
        suggest: target ? { itemId: target.id, set: { "merge.kit.state": kitState } } : null
      });
    });
    walkMerges.forEach(function (m) {
      if (kits.length) return;
      add({
        kind: "accessory", sub: "merge_kit_missing", itemId: m.id, invoice: orders[0] ? orders[0].Code : "", model: "",
        state: "open", owner: "internal", kind2: "fix", severity: "blocks",
        text: itemTitle(m) + " is walked as a merge, and no join / merge kit is on any open ticket for the job. Add the kit to the order.",
        suggest: { itemId: m.id, set: { "merge.kit.state": "missing" } }
      });
    });
    /* panels: a Wilson-supplied panel line answers "who supplies the panel" */
    job.accessories.filter(function (a) { return /^PANEL$/i.test(a.product); }).forEach(function (a) {
      var forModel = (a.desc.match(/for\s+([A-Z0-9][A-Z0-9\/\-]{3,})/i) || [])[1] || "";
      var targets = wu.filter(function (w) { return forModel && w.base === baseModel(forModel) && !w.merged; });
      var shortfall = forModel && byBase[baseModel(forModel)] && byBase[baseModel(forModel)].qty > a.qty;
      var owner = "internal";
      add({
        kind: "accessory", sub: "panel", itemId: targets[0] ? targets[0].itemId : null, invoice: a.invoice, model: a.model,
        presence: a.presence, state: targets.length && !shortfall ? "confirmed" : "open", owner: owner, kind2: shortfall ? "question" : "note", severity: shortfall ? "blocks" : "cosmetic",
        text: "Wilson panel " + a.model + " — " + a.desc + ". " + presenceText(a.presence) +
          (shortfall ? " The order has " + byBase[baseModel(forModel)].qty + " × " + forModel + " and " + a.qty + " panel" + (a.qty === 1 ? "" : "s") + " — who supplies the other?" :
           targets.length ? " Panel supplied by Wilson for " + itemTitle(targets[0].item) + "." : ""),
        suggest: targets.length ? { itemId: targets[0].itemId, set: { panelBy: "wilson" } } : null
      });
    });
    /* anything on order with no date is a Wilson item on its own */
    job.units.concat(job.accessories.map(function (a) { return { lines: [a] }; })).forEach(function (u) {
      u.lines.forEach(function (l) {
        if (l.kit) return;                /* the kit line already says it has no ETA */
        if (l.presence.state === "on_order" && !l.presence.eta) {
          add({
            kind: "accessory", sub: "no_eta", itemId: null, invoice: l.invoice, model: l.model,
            state: "open", owner: "internal", kind2: "fix", severity: "blocks",
            text: l.model + " — " + (l.desc || "") + " is on PO " + l.presence.po + (l.presence.supplier ? " (" + l.presence.supplier + ")" : "") + " with no ETA. Chase the date before delivery is scheduled.",
            suggest: null
          });
        }
      });
    });
    /* 5. merge hint: adjacent refrigeration on the ticket, separate on the walk */
    var fridgeLines = job.units.filter(function (u) { return u.family === "refrigeration" || u.family === "icemaker"; });
    if (fridgeLines.length >= 2 && kits.length && !walkMerges.length) {
      add({
        kind: "merge_hint", itemId: null, invoice: kits[0].invoice, model: kits[0].model,
        state: "open", owner: "wilson", kind2: "question", severity: "cosmetic",
        text: "The job carries " + fridgeLines.map(function (u) { return u.base; }).join(", ") + " and a " + kits[0].kit.toLowerCase() + ". If two of them share one cavity, merge them on the walk so the cavity is measured as one.",
        suggest: null
      });
    }
    /* 6. install labor codes: the ticket's intended basis vs the walk's form / panel answer */
    job.units.forEach(function (u) {
      var inst = installFor(misc, u);
      if (!inst || inst.survey) return;
      wu.filter(function (w) { return w.base === u.base && !w.merged; }).forEach(function (w) {
        var it = w.item;
        if (inst.panel === "wilson" && it.panelBy && it.panelBy !== "wilson") {
          add({
            kind: "install_code", sub: "panel", itemId: w.itemId, invoice: u.lines[0].invoice, model: u.lines[0].model,
            state: "open", owner: "sales", kind2: "question", severity: "blocks",
            text: itemTitle(it) + ": the ticket bills " + inst.label + " (Wilson panel), but the walk says the panel is " + (it.panelBy === "custom" ? "the cabinet shop's" : "undecided") + ". Which is it?",
            suggest: null
          });
        }
        if (inst.form && inst.form !== "standard" && it.formKey && it.formKey !== inst.form) {
          add({
            kind: "install_code", sub: "form", itemId: w.itemId, invoice: u.lines[0].invoice, model: u.lines[0].model,
            state: "open", owner: "wilson", kind2: "note", severity: "cosmetic",
            text: itemTitle(it) + ": the ticket installs it as " + inst.label + "; the walk measured it on the " + it.formKey + " sheet.",
            suggest: { itemId: w.itemId, set: { formKey: inst.form } }
          });
        }
      });
    });
    /* 7. schedule */
    var sched = orders.map(function (o) { return (o.ScheduleDate || "").slice(0, 10); }).filter(Boolean).sort()[0] || "";
    var days = sched ? daysUntil(sched, opts.today) : null;
    var blockers = (opts.blockers != null) ? opts.blockers : null;
    if (sched && days != null && days <= (opts.scheduleWindowDays || 7) && (blockers == null || blockers > 0)) {
      add({
        kind: "schedule", itemId: null, invoice: orders[0].Code, model: "", scheduleDate: sched, daysUntil: days,
        state: "open", owner: "wilson", kind2: "note", severity: days <= 2 ? "blocks" : "cosmetic",
        text: "Delivery is scheduled " + sched + (days === 0 ? " (today)" : days < 0 ? " (" + (-days) + " days ago)" : " (" + days + " day" + (days === 1 ? "" : "s") + " away)") +
          (blockers ? " and the walk still has " + blockers + " open item" + (blockers === 1 ? "" : "s") + "." : "."),
        suggest: null
      });
    }
    /* the survey code, for the office queue */
    var survey = misc.filter(function (m) { return String(m.MiscCode).toUpperCase() === "MOD-SURVEY"; });

    return {
      jobBase: ticketBase(walk.jobNo || opts.jobBase),
      pulledAt: tickets.pulledAt || "",
      tickets: orders.map(function (o) {
        return { code: o.Code, area: o.SoldToLastName || "", type: o.InvTypeCode, status: o.Status, jobStatus: o.JobStatusCode,
                 scheduleDate: (o.ScheduleDate || "").slice(0, 10), salesperson: o.Salesperson1Code || "", builder: o.BillToLastName || "",
                 address: [o.SoldToAddress1, o.SoldToCity, o.SoldToState, o.SoldToZipCode].filter(Boolean).join(", ") };
      }),
      units: job.units, accessories: job.accessories, surveyOnTicket: survey.length > 0,
      scheduleDate: sched,
      diffs: diffs,
      counts: countBy(diffs)
    };
  }

  function installFor(misc, unit) {
    /* the misc line whose family matches this unit — the ticket has one
       install charge per appliance, not per model, so match by family */
    var fam = unit.family;
    var want = {
      refrigeration: /^REFRIG/, icemaker: /^IMAKER/, dishwasher: /^DW[12]$/, oven: /^OVEN/, microwave: /^MICRO/,
      hood: /^VENT/, cooktop: /^CTOP/, range: /^RANGE[0-9]/, laundry: /^LAUNDRY0[1369]$/, grill: /^GRILL/
    }[fam];
    if (!want) return null;
    var hit = misc.filter(function (m) { return want.test(String(m.MiscCode).toUpperCase()) && INSTALL_CODES[String(m.MiscCode).toUpperCase()]; })[0];
    return hit ? INSTALL_CODES[String(hit.MiscCode).toUpperCase()] : null;
  }
  function familyGuess(it) {
    var s = ((it.category || "") + " " + (it.appliance || "") + " " + (it.model || "")).toLowerCase();
    if (/dishwasher|\bdw\b/.test(s)) return "dishwasher";
    if (/ice ?maker/.test(s)) return "icemaker";
    if (/refrig|fridge|freezer|wine|beverage|column/.test(s)) return "refrigeration";
    if (/hood|vent/.test(s)) return "hood";
    if (/cooktop|rangetop/.test(s)) return "cooktop";
    if (/range/.test(s)) return "range";
    if (/washer|dryer|laundry/.test(s)) return "laundry";
    if (/microwave/.test(s)) return "microwave";
    if (/oven|coffee|steam|warming/.test(s)) return "oven";
    if (/grill/.test(s)) return "grill";
    return "other";
  }
  function presenceText(p) {
    if (!p) return "";
    if (p.state === "in_building") return "In the building" + (p.bins && p.bins[0] ? ", bin " + p.bins.filter(Boolean).join(" / ") : "") + (p.received ? ", received " + p.received.slice(0, 10) : "") + ".";
    if (p.state === "on_order") return "On PO " + p.po + (p.eta ? ", ETA " + p.eta.slice(0, 10) : " with no ETA") + (p.supplier ? " (" + p.supplier + ")" : "") + ".";
    if (p.state === "taken") return "Marked taken" + (p.takenDate ? " " + p.takenDate.slice(0, 10) : "") + " and no longer on hand — probably delivered.";
    return "Not in stock and not on order that the pull can see.";
  }
  function daysUntil(iso, today) {
    var t = today ? new Date(today) : new Date();
    var d = new Date(iso + "T12:00:00");
    t.setHours(12, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  }
  function countBy(diffs) {
    var c = { open: 0, confirmed: 0, blocks: 0, byKind: {} };
    diffs.forEach(function (d) {
      if (d.state === "open") c.open++; else if (d.state === "confirmed") c.confirmed++;
      if (d.state === "open" && d.severity === "blocks") c.blocks++;
      c.byKind[d.kind] = (c.byKind[d.kind] || 0) + 1;
    });
    return c;
  }

  /* ---------- reading a pull bundle ----------------------------------- */
  /* The agent's JSON bundle ({datasets:{...}}) or an object of arrays. */
  function fromBundle(obj) {
    var d = (obj && obj.datasets) || obj || {};
    return {
      pulledAt: obj && obj.pulledAt || "",
      orders: d["open-orders"] || d.orders || [],
      lines: d["open-order-lines"] || d.lines || [],
      misc: d["open-order-misc"] || d.misc || [],
      serials: d["on-hand-serials"] || d.serials || [],
      poLines: d["open-po-lines"] || d.poLines || []
    };
  }

  /* ---------- applying what confirmed itself -------------------------- */
  /* Returns the patches to apply, as plain objects; the caller mutates. */
  function patches(result) {
    return result.diffs.filter(function (d) { return d.state === "confirmed" && d.suggest && d.suggest.itemId; })
      .map(function (d) { return { diffId: d.id, itemId: d.suggest.itemId, unitIdx: d.suggest.unitIdx, set: d.suggest.set }; });
  }
  function applyPatch(walk, p) {
    var it = (walk.items || []).filter(function (x) { return x.id === p.itemId; })[0];
    if (!it) return false;
    Object.keys(p.set).forEach(function (k) {
      var v = p.set[k];
      if (k === "model" && p.unitIdx != null && it.merge) { it.merge.units[p.unitIdx].model = v; it.model = it.merge.units.map(function (u) { return u.model; }).join(" + "); return; }
      var path = k.split("."), o = it;
      for (var i = 0; i < path.length - 1; i++) { o[path[i]] = o[path[i]] || {}; o = o[path[i]]; }
      o[path[path.length - 1]] = v;
    });
    return true;
  }

  return {
    MERGE_KITS: MERGE_KITS, INSTALL_CODES: INSTALL_CODES,
    normModel: normModel, baseModel: baseModel, hingeOf: hingeOf, ticketBase: ticketBase,
    ticketsForJob: ticketsForJob, presenceOf: presenceOf, unitsOnJob: unitsOnJob, unitsOnWalk: unitsOnWalk,
    diff: diff, fromBundle: fromBundle, patches: patches, applyPatch: applyPatch, presenceText: presenceText, familyOf: familyOf
  };
});

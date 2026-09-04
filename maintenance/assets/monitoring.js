/*
 * REFRIGERATION GUARDIAN — the hub screen.                      (v0.9.40)
 *
 * v0.9.39 built the fleet view; Cayden's next pass: "need to make the temp
 * watch hub searchable, easily filterable etc. so the office can easily sort
 * and find customers and data."
 *
 * So the hub is now a worklist with controls: free-text search across
 * household, brand, model and location; status and compartment filters; four
 * sorts. The controls live in ONE row above the content and filtering never
 * repaints a sensor's identity -- the same card looks the same in every view.
 *
 * Rendering rules it inherits from the rest of the product:
 *   - one series per chart, its own scale, never a second axis
 *   - the threshold is a band the reading either sits in or does not
 *   - simulated data says it is simulated, on the card, every time
 *   - dispatches go through WilsonStore.recordTempDispatch (idempotent per
 *     appliance per day)
 */
(function () {
  const ui = window.WilsonUI;
  const config = window.WILSON_CONFIG;
  const SIM = window.WILSON_TEMPWATCH_SIM;

  const SERIES = "#12331f";
  const GRID = "#e4ebe6";
  const BAND_OK = "#eaf2ec";

  /* The office's view state. Session-only on purpose: a filter is a way of
     looking, not a fact about the fleet. */
  const view = { q: "", status: "all", kind: "all", sort: "worst" };

  function serviceName() { return (config.tempMonitoring || {}).serviceName || "Wilson Guardian Temp Monitoring"; }

  /*
   * The hub's three-way read of a sensor: flagged, running warm, or in band.
   * "Running warm" is the drifty middle -- inside the band but spending real
   * time near or over the top of it -- and exists so the office can eye an
   * appliance BEFORE it becomes a truck.
   */
  function statusOf(row) {
    if (row.flag.flagged) return "flagged";
    /* v0.9.42: the warning tier from the researched rules joins the drifty
       heuristic -- a sensor sustained past the food-safety line but short of
       a truck is exactly what "running warm" is for. */
    if (row.flag.tier === "warn") return "warm";
    const s = row.stats;
    if (s && ((s.inBandPct !== null && s.inBandPct < 95) ||
              (row.flag.band && s.avg > row.flag.band.setpoint + 1.8))) return "warm";
    return "ok";
  }

  function spark(points, rule, width, height) {
    const w = width || 320, h = height || 96;
    const padL = 30, padR = 8, padT = 8, padB = 16;
    const values = points.map(function (p) { return p.value; });
    let min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (rule && rule.maxF !== undefined) { min = Math.min(min, rule.maxF - 2); max = Math.max(max, rule.maxF + 2); }
    if (rule && rule.dispatchF !== undefined && max > rule.dispatchF - 3) { max = Math.max(max, rule.dispatchF + 2); }
    const span = Math.max(1, max - min);
    const x = function (i) { return padL + (i / (points.length - 1)) * (w - padL - padR); };
    const y = function (v) { return padT + (1 - (v - min) / span) * (h - padT - padB); };
    const line = points.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.value).toFixed(1); }).join(" ");
    const limitY = rule && rule.maxF !== undefined ? y(rule.maxF) : null;
    /* v0.9.42: the dispatch line joins the chart when the trace gets near it
       -- two dashed lines is the whole tier system, drawn. */
    const dispatchY = rule && rule.dispatchF !== undefined && max >= rule.dispatchF ? y(rule.dispatchF) : null;
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="tw-spark" role="img" aria-label="48-hour temperature trace">' +
      (limitY !== null
        ? '<rect x="' + padL + '" y="' + limitY.toFixed(1) + '" width="' + (w - padL - padR) + '" height="' + (h - padB - limitY).toFixed(1) + '" fill="' + BAND_OK + '"></rect>' +
          '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + limitY.toFixed(1) + '" y2="' + limitY.toFixed(1) + '" stroke="#c9b98a" stroke-dasharray="4 3"></line>' +
          '<text x="' + (padL - 4) + '" y="' + (limitY + 4).toFixed(1) + '" text-anchor="end" font-size="9" fill="#8a6a2f">' + rule.maxF + '°</text>'
        : "") +
      (dispatchY !== null
        ? '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + dispatchY.toFixed(1) + '" y2="' + dispatchY.toFixed(1) + '" stroke="#c98a8a" stroke-dasharray="2 3"></line>' +
          '<text x="' + (padL - 4) + '" y="' + (dispatchY + 4).toFixed(1) + '" text-anchor="end" font-size="9" fill="#a04747">' + rule.dispatchF + '°</text>'
        : "") +
      '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + (h - padB) + '" y2="' + (h - padB) + '" stroke="' + GRID + '"></line>' +
      '<path d="' + line + '" fill="none" stroke="' + SERIES + '" stroke-width="1.6"></path>' +
      '<circle cx="' + x(points.length - 1).toFixed(1) + '" cy="' + y(points[points.length - 1].value).toFixed(1) + '" r="3" fill="' + SERIES + '"></circle>' +
      '<text x="' + padL + '" y="' + (h - 4) + '" font-size="9" fill="#7b877f">48h ago</text>' +
      '<text x="' + (w - padR) + '" y="' + (h - 4) + '" text-anchor="end" font-size="9" fill="#7b877f">now</text>' +
      '</svg>';
  }

  function statusBadge(row) {
    const status = statusOf(row);
    if (status === "flagged") {
      /* The reason names WHICH rule fired -- the sustained dispatch line or
         Cayden's failure-to-recover rule -- because the dispatcher's first
         question is "how bad", and the two answers differ. */
      const detail = row.flag.reason || row.flag.rule.dispatchLabel || row.flag.rule.label;
      return '<span class="badge danger">Flagged — ' + ui.escapeHtml(detail) + "</span>";
    }
    if (status === "warm") {
      return '<span class="badge warning">' +
        (row.flag.tier === "warn" ? "Warning — past the line, not yet a truck" : "Running warm — inside the band") +
        '</span>';
    }
    return '<span class="badge success">In band</span>';
  }

  function sensorCard(row) {
    const a = row.asset, f = row.flag, s = row.stats;
    const household = row.household ? row.household.name : "Household";
    const latest = row.points[row.points.length - 1];
    return '<article class="tw-card' + (f.flagged ? " flagged" : "") + '">' +
      '<div class="tw-card-head">' +
        '<div><strong>' + ui.escapeHtml([a.brand, a.model].filter(Boolean).join(" ") || a.typeLabel) +
        (row.compartmentLabel ? ' <em class="tw-compartment">' + ui.escapeHtml(row.compartmentLabel) + " probe</em>" : "") + "</strong>" +
        '<span><a href="household.html?id=' + ui.escapeHtml(a.householdId) + '">' + ui.escapeHtml(household) + "</a> · " +
        ui.escapeHtml(a.location || "") + " · " + ui.escapeHtml(a.typeLabel || "") + "</span></div>" +
        statusBadge(row) +
      "</div>" +
      spark(row.points, f.rule) +
      '<div class="tw-card-foot">' +
        "<div><span>Now</span><strong>" + (latest ? latest.value : "–") + "°F</strong></div>" +
        "<div><span>48h avg</span><strong>" + (s ? s.avg : "–") + "°F</strong></div>" +
        "<div><span>In band</span><strong>" + (s && s.inBandPct !== null ? s.inBandPct + "%" : "–") + "</strong></div>" +
        "<div><span>Excursions</span><strong>" + (s && s.excursions !== null ? s.excursions : "–") + "</strong></div>" +
        (f.flagged
          ? "<div><span>Over for</span><strong>" + Math.round(f.overForMinutes / 60 * 10) / 10 + " h</strong></div>"
          : "") +
        '<em class="tw-sim">Simulated readings</em>' +
      "</div>" +
      (f.flagged
        ? '<div class="tw-card-actions">' +
          '<button class="button small" type="button" data-tw-dispatch="' + ui.escapeHtml(a.id) + '" data-tw-label="' + ui.escapeHtml(f.rule.dispatchLabel || f.rule.label) + '" data-tw-reading="' + (latest ? latest.value : "") + '">Open priority dispatch</button>' +
          '<a class="button small ghost" href="household.html?id=' + ui.escapeHtml(a.householdId) + '">Household</a>' +
          "</div>"
        : "") +
      "</article>";
  }

  /* ---- search / filter / sort, in one place ---------------------------- */
  function applyView(rows) {
    let out = rows.slice();
    const q = view.q.trim().toLowerCase();
    if (q) {
      out = out.filter(function (r) {
        const hay = [
          r.household ? r.household.name : "",
          r.household ? r.household.city : "",
          r.asset.brand, r.asset.model, r.asset.typeLabel, r.asset.location,
          r.compartmentLabel || ""
        ].join(" ").toLowerCase();
        return hay.indexOf(q) > -1;
      });
    }
    if (view.status !== "all") out = out.filter(function (r) { return statusOf(r) === view.status; });
    if (view.kind !== "all") out = out.filter(function (r) { return r.flag.band && r.flag.band.key === view.kind; });
    const sorts = {
      /* Worst first: flagged, then warm, then by least time in band. */
      worst: function (a, b) {
        const rank = { flagged: 0, warm: 1, ok: 2 };
        if (rank[statusOf(a)] !== rank[statusOf(b)]) return rank[statusOf(a)] - rank[statusOf(b)];
        return (a.stats ? a.stats.inBandPct : 100) - (b.stats ? b.stats.inBandPct : 100);
      },
      household: function (a, b) {
        return String(a.household ? a.household.name : "").localeCompare(String(b.household ? b.household.name : ""));
      },
      warmest: function (a, b) {
        const overA = a.stats && a.flag.band ? a.stats.avg - a.flag.band.setpoint : 0;
        const overB = b.stats && b.flag.band ? b.stats.avg - b.flag.band.setpoint : 0;
        return overB - overA;
      },
      inband: function (a, b) {
        return (a.stats ? a.stats.inBandPct : 100) - (b.stats ? b.stats.inBandPct : 100);
      }
    };
    out.sort(sorts[view.sort] || sorts.worst);
    return out;
  }

  function chip(group, value, label, count) {
    const on = view[group] === value;
    return '<button type="button" class="tw-chip' + (on ? " selected" : "") + '"' +
      ' data-tw-filter="' + group + ":" + value + '" aria-pressed="' + (on ? "true" : "false") + '">' +
      ui.escapeHtml(label) + (count !== undefined ? ' <b>' + count + "</b>" : "") + '</button>';
  }

  function controls(rows) {
    const counts = { flagged: 0, warm: 0, ok: 0 };
    rows.forEach(function (r) { counts[statusOf(r)] += 1; });
    return '<div class="tw-controls">' +
      '<input type="search" id="tw-search" placeholder="Search household, brand, model, location" value="' + ui.escapeHtml(view.q) + '" aria-label="Search the fleet">' +
      '<div class="tw-chip-row" role="group" aria-label="Status">' +
        chip("status", "all", "All", rows.length) +
        chip("status", "flagged", "Flagged", counts.flagged) +
        chip("status", "warm", "Running warm", counts.warm) +
        chip("status", "ok", "In band", counts.ok) +
      "</div>" +
      '<div class="tw-chip-row" role="group" aria-label="Compartment">' +
        chip("kind", "all", "All types") +
        chip("kind", "fresh_food", "Fridge") +
        chip("kind", "freezer", "Freezer") +
        chip("kind", "wine", "Wine") +
      "</div>" +
      '<select id="tw-sort" aria-label="Sort order">' +
        '<option value="worst"' + (view.sort === "worst" ? " selected" : "") + ">Worst first</option>" +
        '<option value="household"' + (view.sort === "household" ? " selected" : "") + ">Household A–Z</option>" +
        '<option value="warmest"' + (view.sort === "warmest" ? " selected" : "") + ">Warmest vs set point</option>" +
        '<option value="inband"' + (view.sort === "inband" ? " selected" : "") + ">Least time in band</option>" +
      "</select>" +
      "</div>";
  }

  function render() {
    const state = WilsonStore.load();
    const rows = SIM.fleet(state);
    const flagged = rows.filter(function (r) { return r.flag.flagged; });
    const tm = config.tempMonitoring || {};
    const shown = applyView(rows);

    document.getElementById("tw-title").innerHTML =
      '<div class="section-heading"><div><span class="eyebrow dark">' + ui.escapeHtml(serviceName()) + "</span>" +
      "<h1>Temp Monitoring</h1>" +
      "<p>" + ui.escapeHtml(tm.responseCopy || "") + " " + (function () {
        /* v0.9.44: both tiers stated from config -- the hub is the office's
           reference card for quoting the standalone sale by hand. */
        const p = tm.pricing || {};
        const m = p.member || {}, s = p.standalone || {};
        return "With a maintenance plan: " + ui.money(m.firstAnnual || 0) + "/yr first sensor, " +
          ui.money(m.additionalAnnual || 0) + " each additional. Without a plan: " +
          ui.money(s.firstAnnual || 0) + "/yr first, " + ui.money(s.additionalAnnual || 0) +
          " additional, plus a " + ui.money(s.installFee || 0) + " install fee — " +
          ui.escapeHtml(s.installCreditNote || "").toLowerCase();
      })() + "</p></div>" +
      '<div class="inline-actions"><a class="button ghost" href="admin.html">← Dashboard</a></div></div>';

    document.getElementById("tw-summary").innerHTML =
      '<div class="detail-tile"><div class="label">Sensors enrolled</div><div class="value">' + rows.length + "</div></div>" +
      '<div class="detail-tile"><div class="label">Open flags</div><div class="value">' + flagged.length + "</div></div>" +
      '<div class="detail-tile"><div class="label">Running warm</div><div class="value">' + rows.filter(function (r) { return statusOf(r) === "warm"; }).length + '</div><div class="table-sub">Inside the band, worth an eye</div></div>' +
      '<div class="detail-tile"><div class="label">Data feed</div><div class="value">Simulated</div><div class="table-sub">Production ingests UbiBot push forwarding — see the build notes.</div></div>';

    document.getElementById("tw-flags").innerHTML = flagged.length
      ? flagged.map(sensorCard).join("")
      : '<div class="callout"><strong>Nothing is flagging.</strong> Every monitored appliance is holding its band. This panel is the first place a failing refrigerator shows up — usually before the customer notices.</div>';

    document.getElementById("tw-controls-host").innerHTML = controls(rows);

    document.getElementById("tw-fleet").innerHTML = shown.length
      ? shown.map(sensorCard).join("")
      : (rows.length
        ? '<div class="empty-state">Nothing matches this search and filter. <button class="link-button" id="tw-clear" type="button">Show the whole fleet</button></div>'
        : '<div class="empty-state">No appliances are enrolled yet. The add-on card at registration is where a customer picks it up.</div>');
    const count = document.getElementById("tw-fleet-count");
    if (count) count.textContent = shown.length === rows.length
      ? rows.length + " sensor" + (rows.length === 1 ? "" : "s")
      : shown.length + " of " + rows.length + " sensors";

    const dispatches = (state.tempDispatches || []);
    document.getElementById("tw-dispatches").innerHTML = dispatches.length
      ? dispatches.map(function (d) {
          return '<div class="activity-item"><div class="activity-icon">⚑</div><div><p><strong>' +
            ui.escapeHtml(d.applianceLabel) + "</strong> — " + ui.escapeHtml(d.flagLabel) +
            (d.reading ? " (reading " + ui.escapeHtml(String(d.reading)) + "°F)" : "") +
            '</p><time>' + new Date(d.createdAt).toLocaleString() + " · priority dispatch open</time></div></div>";
        }).join("")
      : '<div class="empty-state">No dispatches opened yet.</div>';

    bind();
  }

  function bind() {
    const search = document.getElementById("tw-search");
    if (search) {
      search.oninput = function () {
        view.q = search.value;
        /* Re-render only the list, so the search box keeps focus and the
           caret does not jump while the office types. */
        const state = WilsonStore.load();
        const rows = SIM.fleet(state);
        const shown = applyView(rows);
        document.getElementById("tw-fleet").innerHTML = shown.length
          ? shown.map(sensorCard).join("")
          : '<div class="empty-state">Nothing matches this search and filter. <button class="link-button" id="tw-clear" type="button">Show the whole fleet</button></div>';
        const count = document.getElementById("tw-fleet-count");
        if (count) count.textContent = shown.length === rows.length
          ? rows.length + " sensor" + (rows.length === 1 ? "" : "s")
          : shown.length + " of " + rows.length + " sensors";
        bindListOnly();
      };
    }
    const sort = document.getElementById("tw-sort");
    if (sort) sort.onchange = function () { view.sort = sort.value; render(); };
    document.querySelectorAll("[data-tw-filter]").forEach(function (button) {
      button.onclick = function () {
        const raw = button.dataset.twFilter;
        const group = raw.slice(0, raw.indexOf(":"));
        view[group] = raw.slice(raw.indexOf(":") + 1);
        render();
      };
    });
    bindListOnly();
  }

  function bindListOnly() {
    const clear = document.getElementById("tw-clear");
    if (clear) clear.onclick = function () { view.q = ""; view.status = "all"; view.kind = "all"; render(); };
    document.querySelectorAll("[data-tw-dispatch]").forEach(function (button) {
      button.onclick = function () {
        const res = WilsonStore.recordTempDispatch({
          assetId: button.dataset.twDispatch,
          flagLabel: button.dataset.twLabel,
          reading: button.dataset.twReading
        });
        if (res && res.ok) {
          ui.toast(res.existing ? "Already dispatched today" : "Priority dispatch opened",
            res.existing
              ? "A dispatch for this appliance is already open from today — it was not filed twice."
              : "Recorded and on the household activity. In production this also pages the on-call coordinator.");
          render();
        }
      };
    });
  }

  document.addEventListener("DOMContentLoaded", render);
})();

(function () {
  /*
   * Whole-visit maintenance review.
   *
   * A per-appliance health report is the record for one machine. It is not what
   * a homeowner should receive after a stop: seventeen appliances would mean
   * seventeen documents, and the thing they actually want to know -- how is my
   * house doing, and what needs me -- is nowhere in any of them.
   *
   * So this is a separate artifact at the VISIT level. It does not replace the
   * individual reports; it compiles them, and links to each one for the detail.
   *
   * THE HEADLINE IS NOT AN AVERAGE
   * ------------------------------
   * Averaging a $12,000 Sub-Zero against a $400 microwave produces a number
   * that means nothing and hides the one appliance that needs attention. The
   * lead is therefore a count -- how many are performing normally, how many
   * need something -- with the average shown as secondary and plainly labelled
   * as an unweighted mean.
   */

  const ui = window.WilsonUI;
  const state = WilsonStore.load();
  const params = new URLSearchParams(window.location.search);
  const visitId = params.get("visit");

  const visit = visitId ? (state.visits || []).find(function (v) { return v.id === visitId; }) : null;
  const household = visit ? (state.households || []).find(function (h) { return h.id === visit.householdId; }) : null;
  const subscription = visit ? (state.subscriptions || []).find(function (s) { return s.id === visit.subscriptionId; }) : null;

  /*
   * The letter grade is gone from this page.                   (v0.9.37)
   *
   * It was the only caller of the grade bands here, and what it produced was a
   * second verdict on each appliance -- one derived from the blended score --
   * printed a centimetre from the status column, which bands on condition. A
   * page that renders two verdicts renders one wrong one. The grade still
   * appears on the appliance's own report, where the score it grades is the
   * one on the page beside it.
   */

  /*
   * "Needs attention" is a claim about CONDITION, so it is banded on the vital
   * score -- what the technician actually measured -- and not on the overall,
   * which folds in 25% age.
   *
   * The distinction matters more than it looks. Banding on the overall means a
   * fifteen-year-old appliance measuring perfectly still drifts into "Monitor"
   * purely for being old, and a review that flags healthy equipment on age is
   * exactly the nudge-toward-replacement this product is not allowed to be.
   * Age has a place -- it is in the longevity guidance, where it is stated as
   * age and can be argued with -- not disguised as a condition finding.
   */
  /*
   * A SCORE THAT DOES NOT EXIST IS NOT A ZERO.   (v0.9.37)
   *
   * Three places did `Number(report.score || 0)`. An HVAC system with no
   * nameplate read -- a real, expected state the appliance report already
   * handles -- rendered in the inventory as "0% / F" with the status column
   * beside it reading "Not scored", dragged the house average down, and sorted
   * itself to the top as the worst equipment in the house.
   *
   * It is the exact defect a comment in store.js says was fixed. It was fixed on
   * the appliance report and not here. One helper now, so a fourth call site
   * cannot reintroduce it.
   */
  function scoreOf(report) {
    const value = report && report.score;
    return value === null || value === undefined || value === "" ? null : Number(value);
  }

  /*
   * WHAT SITS UNDER THE BLENDED SCORE IN THE INVENTORY.        (v0.9.37)
   *
   * This cell used to print the letter grade and condition band of the BLENDED
   * score -- "78% / C Monitor" -- immediately beside a status column that bands
   * on the CONDITION score and therefore read "Performing normally". Same row,
   * two cells, flatly contradicting each other. A fourteen-year-old
   * refrigerator measuring 92 on condition was reported to its owner as a C.
   *
   * The contradiction is not a rendering accident: the status column is
   * deliberately condition-only, so age cannot make a well-kept appliance look
   * unhealthy, and plan-config states the mitigation for the 25% age weight is
   * that every surface printing the overall prints condition and life-used
   * beside it. This page printed the overall alone. Now it does what the config
   * says: the components, not a second verdict that argues with the first.
   */
  function scoreParts(report) {
    const life = report.lifecycle || {};
    const bits = [];
    const vital = life.vitalScore;
    if (vital !== null && vital !== undefined && vital !== "") bits.push("Condition " + Math.round(Number(vital)));
    const ratio = Number(life.lifeRatio);
    if (isFinite(ratio) && ratio > 0 && Number(life.expectedYears) > 0) {
      bits.push(Math.min(100, Math.round(ratio * 100)) + "% of expected life");
    }
    /* No components on record -- an older report, or one with no age term. Say
       what the number is rather than inventing a band for it. */
    return bits.length ? bits.join(" · ") : "Measured condition only";
  }

  function statusOf(report) {
    /*
     * A system that could not be measured is not a failing system. Its score
     * is null (not 0), and banding null as 0 made an HVAC unit with too little
     * nameplate data the worst equipment in the house.
     */
    const vital = (report.lifecycle || {}).vitalScore;
    const hasVital = vital !== null && vital !== undefined && vital !== "";
    const hasScore = report.score !== null && report.score !== undefined && report.score !== "";
    if (!hasVital && !hasScore) return { code: "unscored", label: "Not scored" };
    const measured = Number(hasVital ? vital : report.score);
    if (!Number.isFinite(measured)) return { code: "unscored", label: "Not scored" };

    /*
     * The thresholds come from the same gradeBands the single-appliance report
     * uses. They were hard-coded at 70/85 here while the report graded Monitor
     * at 70-79 and Good at 80-89, so one appliance at 82 read "Good" on its own
     * report and "Monitor" on this one.
     */
    const bands = (window.WILSON_CONFIG.reportScoring || {}).gradeBands || [];
    const monitorFloor = (bands.find(function (b) { return /monitor/i.test(b.label || ""); }) || { min: 70 }).min;
    const goodFloor = (bands.find(function (b) { return /good/i.test(b.label || ""); }) || { min: 80 }).min;
    if (measured < monitorFloor) return { code: "action", label: "Needs attention" };
    if (measured < goodFloor) return { code: "monitor", label: "Monitor" };
    return { code: "good", label: "Performing normally" };
  }

  /*
   * The technician's own words about the reading, matched by the words they
   * share. A number on its own tells a customer that something is off but not
   * what it means; the note taken at the appliance is what turns it into
   * something they can decide about.
   *
   * Best match wins, not first match: on the Davenport dishwasher, both the
   * sump note and the cycle note mention temperature, and first-match handed
   * the customer "sump cleaned" as the explanation for cold inlet water.
   */
  function measurementNote(report, measurement) {
    /* Field-generated rows carry the technician's note on the reading itself,
       because the reading was entered on that checkpoint. Use it and stop --
       matching on words is only for older rows that never had the link. */
    if (measurement.notes) return measurement.notes;
    const words = String(measurement.label || "").toLowerCase().split(/[^a-z]+/).filter(function (w) { return w.length > 3; });
    if (!words.length) return "";
    let best = null, bestScore = 0;
    (report.checkpoints || [])
      .filter(function (c) { return Number(c.rating) <= 3 && c.notes; })
      .forEach(function (c) {
        const text = (c.name + " " + c.notes).toLowerCase();
        const hits = words.filter(function (w) { return text.indexOf(w) >= 0; }).length;
        /* Ties break to the worse rating -- the more serious note. */
        if (hits > bestScore || (hits === bestScore && hits > 0 && best && Number(c.rating) < Number(best.rating))) {
          best = c; bestScore = hits;
        }
      });
    return bestScore > 0 && best ? best.notes : "";
  }

  /*
   * What to print under an appliance that has something to report.
   *
   * Order matters, and it is specificity: a measured reading outside its target
   * beats a projection, a projection beats the checkpoint a technician rated
   * down, and all of them beat "the health score fell 15 points" -- which is
   * true, carries no information a customer can act on, and is the one line
   * that makes a report feel automated. The score signal is therefore the last
   * resort, used only when nothing more specific exists.
   */
  function findingsFor(x) {
    if (x.advice && x.advice.actions.length) return x.advice.actions;

    const signals = (x.decline && x.decline.signals) || [];
    const specific = signals.filter(function (s) { return s.kind !== "score"; });
    if (specific.length) return specific.map(function (s) { return { label: s.label, detail: s.detail }; });

    /*
     * A first visit has no trend, and decline detection needs at least two
     * reports before it will say anything. A reading that is out of range TODAY
     * is still the finding -- most customers are on their first visit, and a
     * review that could only speak once it had history would be silent for the
     * people who most need it to talk.
     */
    const outOfRange = (x.report.measurements || []).filter(function (m) {
      return m.result === "Above range" || m.result === "Below range";
    });
    if (outOfRange.length) {
      return outOfRange.map(function (m) {
        const note = measurementNote(x.report, m);
        /* Don't say the number twice. When the technician's note already
           quotes the reading, the note IS the finding. */
        const reading = m.observed + (m.unit || "") + " against a target of " + m.target + ".";
        return {
          label: m.label,
          detail: note
            ? (note.indexOf(m.observed) >= 0 ? note : reading + " " + note)
            : reading
        };
      });
    }

    /* What the technician rated down, in their own words from the visit,
       worst rating first so the lead line is the worst thing found. */
    const flagged = (x.report.checkpoints || [])
      .filter(function (c) { return Number(c.rating) <= 3; })
      .sort(function (a, b) { return Number(a.rating) - Number(b.rating); });
    if (flagged.length) return flagged.map(function (c) { return { label: c.name, detail: c.notes || "" }; });

    return signals.map(function (s) { return { label: s.label, detail: s.detail }; });
  }

  /*
   * Some categories are deliberately not fully serviced -- a grill is inspected
   * for function and never cleaned. Where a customer can see condition marked
   * down, the review states plainly that remediating it is not something Wilson
   * does, so nobody reads the score as a service we quietly skipped.
   */
  function scopeNoteFor(asset) {
    const categories = (window.WILSON_CONFIG || {}).customerApplianceCategories || [];
    const key = String((asset && asset.customerCategory) || "").toLowerCase();
    const hit = categories.find(function (c) { return String(c.id).toLowerCase() === key; });
    return hit && hit.scopeNote ? hit.scopeNote : "";
  }

  /*
   * "12 of 20 years · from the invoice" -- or "age not on record".
   *
   * Age is a quarter of the score, so the row says both the number and what it
   * rests on. An appliance with no install date says so plainly instead of
   * showing a blank where a figure should be.
   */
  function ageCaption(x) {
    const life = x.report.lifecycle || {};
    if (!x.advice) {
      return life.age === null || life.age === undefined || life.age === "" ? " · age not on record" : "";
    }
    const provenance = x.advice.ageDocumented
      ? "from the invoice"
      : (x.advice.ageSource === "customer" ? "customer stated" : "tech estimate");
    return " · " + x.advice.age + " of " + x.advice.expectedYears + " years (" + provenance + ")";
  }

  /*
   * Photographs on the findings, and only on the findings.
   *
   * A whole-visit review is a summary; sixteen appliances' worth of images would
   * bury it. But the appliances with something to report are exactly where a
   * photograph earns its space -- a customer reading "grease build-up in the
   * firebox is advancing" should be able to see it and judge for themselves
   * rather than take our word for it. Two per appliance, then the report.
   */
  function photoStrip(report) {
    const photos = (report.photos || []).filter(function (p) { return p && p.id; }).slice(0, 2);
    if (!photos.length) return "";
    return '<div class="attention-photos">' + photos.map(function (p) {
      return '<figure class="attention-photo" data-photo-id="' + ui.escapeHtml(p.id) + '">' +
        '<div class="photo-frame"><span class="photo-loading">Loading…</span></div>' +
        '<figcaption>' + ui.escapeHtml(p.checkName || "Condition") + '</figcaption></figure>';
    }).join("") + '</div>';
  }

  /* Images come out of IndexedDB, so they arrive after the document does. */
  function hydratePhotos() {
    if (!window.WILSON_PHOTOS) return;
    document.querySelectorAll("[data-photo-id]").forEach(function (cell) {
      const frame = cell.querySelector(".photo-frame");
      if (!frame) return;
      window.WILSON_PHOTOS.url(cell.dataset.photoId).then(function (src) {
        if (!src) {
          frame.innerHTML = '<span class="photo-missing">Not available on this device</span>';
          return;
        }
        const img = document.createElement("img");
        img.src = src;
        img.alt = "Field photograph";
        img.onload = function () { window.URL.revokeObjectURL(src); };
        frame.innerHTML = "";
        frame.appendChild(img);
      }).catch(function () {
        frame.innerHTML = '<span class="photo-missing">Could not be read</span>';
      });
    });
  }

  function reportPage(title, kicker, body, pageClass) {
    return `
      <section class="report-page ${pageClass || ""}">
        <header class="report-page-header">
          <div class="report-mini-logo"><img src="assets/logo-black.png" alt="Wilson AC &amp; Appliance"></div>
          <div><span>${ui.escapeHtml(kicker || "Maintenance Review")}</span><h2>${ui.escapeHtml(title)}</h2></div>
        </header>
        <div class="report-page-body">${body}</div>
        <footer class="report-page-footer"><span>Wilson AC &amp; Appliance · Estate Maintenance Review</span><span>${ui.escapeHtml(visitId || "")}</span></footer>
      </section>
    `;
  }

  function render() {
    const host = document.getElementById("visit-report-sheet");

    if (!visit) {
      /* Same rule as the individual report: never guess which visit was meant. */
      host.innerHTML = `<div class="empty-state"><strong>${visitId ? "That maintenance visit could not be found." : "No maintenance visit was selected."}</strong><p>Open a completed visit from the household record or the Maintenance Operations queue.</p></div>`;
      return;
    }

    /* Worst-measured first, on the same vital score the status band uses, so
       the ordering and the labels never disagree with each other. */
    const measuredScore = function (r) {
      const vital = (r.lifecycle || {}).vitalScore;
      if (vital !== null && vital !== undefined && vital !== "") return Number(vital);
      const score = scoreOf(r);
      /* Not measured is not "worst". `|| 0` sent an HVAC system with no
         nameplate to the top of the list as the worst equipment in the house;
         it sorts last instead, where "nothing to report" belongs. */
      return score === null ? Infinity : score;
    };
    const reports = (state.reports || [])
      .filter(function (r) { return r.visitId === visitId; })
      .sort(function (a, b) { return measuredScore(a) - measuredScore(b); });

    if (!reports.length) {
      host.innerHTML = `<div class="empty-state"><strong>No completed appliances yet on this visit.</strong><p>The review compiles once the technician has completed field protocols. ${(state.assets || []).filter(function (a) { return a.householdId === visit.householdId; }).length} appliances are in scope.</p><p><a class="button" href="tech-maintenance.html?visit=${ui.escapeHtml(visitId)}&household=${ui.escapeHtml(visit.householdId)}">Open the field visit</a></p></div>`;
      return;
    }

    const assetsById = {};
    (state.assets || []).forEach(function (a) { assetsById[a.id] = a; });

    /* "Main Kitchen - Left" and "Main Kitchen - Right" are positions within one
       room, not two rooms. Group on the room and keep the position on the row,
       or the inventory reads as a house with nine kitchens. */
    const areaOf = function (asset) {
      return String(asset.location || "Residence").split(" - ")[0].trim() || "Residence";
    };

    const rows = reports.map(function (r) {
      const asset = assetsById[r.assetId] || {};
      const decline = window.WILSON_TRENDS ? window.WILSON_TRENDS.forAsset(state, r.assetId) : null;
      const assessed = window.WILSON_LIFECYCLE ? window.WILSON_LIFECYCLE.assess(r, decline) : null;
      /* An "unavailable" assessment is not guidance -- it is the reason there is
         none. It must not flow into posture lines or age captions. */
      const advice = assessed && !assessed.unavailable ? assessed : null;
      return { report: r, asset: asset, decline: decline, advice: advice, status: statusOf(r),
               area: areaOf(asset), position: asset.location || "" };
    });

    const monitor = rows.filter(function (x) { return x.status.code === "monitor"; });
    const action = rows.filter(function (x) { return x.status.code === "action"; });
    const attention = action.concat(monitor);
    /*
     * v0.9.37: AN UNSCORED APPLIANCE IS NOT A NORMAL ONE.
     *
     * `rows.length - attention.length` counted every appliance nobody could
     * measure as "performing normally", so the page printed "12 of 13
     * appliances are performing normally" while the bands below it summed to
     * 11. Unmeasured is its own state and is now counted as one.
     */
    const unscored = rows.filter(function (x) {
      const v = (x.report.lifecycle || {}).vitalScore;
      return v === null || v === undefined || x.report.score === null || x.report.score === undefined;
    });
    const normal = rows.length - attention.length - unscored.length;
    const scored = rows.filter(function (x) { return scoreOf(x.report) !== null; });
    const mean = scored.length
      ? Math.round(scored.reduce(function (sum, x) { return sum + scoreOf(x.report); }, 0) / scored.length)
      : null;
    const technicians = [...new Set(reports.map(function (r) { return r.technician; }).filter(Boolean))];
    const serviceDate = reports.map(function (r) { return r.inspectionDate; }).sort()[reports.length - 1];
    const address = household ? [household.address1, household.city, household.state].filter(Boolean).join(", ") : "";
    const coverCounts = [normal + " performing normally"]
      .concat(monitor.length ? [monitor.length + " to monitor"] : [])
      .concat(action.length ? [action.length + " needing attention"] : [])
      .join(" · ");

    /* ---- cover ---- */
    const cover = `
      <section class="report-page report-cover-page">
        <div class="report-cover-shape"></div>
        <div class="report-cover-brand"><img src="assets/logo-black.png" alt="Wilson AC &amp; Appliance"></div>
        <div class="report-cover-title"><span>Wilson Estate Care</span><h1>Maintenance Review</h1><p>${ui.escapeHtml(visit.season || "Whole-home maintenance visit")}</p></div>
        <div class="report-cover-score visit-cover-score">
          <span>Appliances maintained</span><strong>${rows.length}</strong>
          <em>${ui.escapeHtml(coverCounts)}</em>
        </div>
        <div class="report-cover-details">
          <div><span>Household</span><strong>${ui.escapeHtml(household ? household.name : "Household")}</strong></div>
          <div><span>Service address</span><strong>${ui.escapeHtml(address || "Not recorded")}</strong></div>
          <div><span>Date of service</span><strong>${ui.shortDate(serviceDate)}</strong></div>
          <div><span>Technician${technicians.length > 1 ? "s" : ""}</span><strong>${ui.escapeHtml(technicians.join(", ") || "Not recorded")}</strong></div>
        </div>
        <footer class="report-cover-footer">Wilson AC &amp; Appliance · Trusted since 1949</footer>
      </section>
    `;

    /* ---- portfolio summary ---- */
    const bands = [
      { code: "good", label: "Performing normally", n: rows.filter(function (x) { return x.status.code === "good"; }).length },
      { code: "monitor", label: "Monitor", n: rows.filter(function (x) { return x.status.code === "monitor"; }).length },
      { code: "action", label: "Needs attention", n: rows.filter(function (x) { return x.status.code === "action"; }).length },
    ];

    const summaryBody = `
      <div class="portfolio-lead">
        <strong>${normal} of ${rows.length} appliances are performing normally.</strong>
        <p>${attention.length
          ? (attention.length === 1
              ? "The one below has something specific to report, with the reading that produced it and what it takes to address it. Nothing here is a recommendation to replace an appliance that still has life in it."
              : "The " + attention.length + " below have something specific to report. Each one is named, with the reading that produced it and what it takes to address it. Nothing here is a recommendation to replace an appliance that still has life in it.")
          : (unscored.length
              ? "Nothing that could be measured on this visit needs follow-up. " + unscored.length +
                " item" + (unscored.length === 1 ? "" : "s") + " could not be scored \u2014 each one says why on its own report."
              : "Nothing on this visit needs follow-up. Every appliance was measured, and every reading was inside the target the technician used.")}</p>
      </div>

      <div class="portfolio-bands">
        ${bands.map(function (b) {
          const pct = Math.round((b.n / rows.length) * 100);
          return `<div class="portfolio-band band-${b.code}">
            <strong>${b.n}</strong><span>${ui.escapeHtml(b.label)}</span>
            <div class="band-meter"><div class="band-meter-fill" style="width:${pct}%"></div></div>
          </div>`;
        }).join("")}
      </div>

      <div class="portfolio-mean">
        <span>Average appliance score across this visit</span>
        <strong>${mean === null ? "&mdash;" : mean + "%"}</strong>
        <small>${mean === null
          ? "Nothing on this visit could be scored, so there is no average to take."
          : "An unweighted mean across the " + scored.length + " appliance" + (scored.length === 1 ? "" : "s") + " that could be scored" +
            (scored.length === rows.length ? "" : ", of " + rows.length + " on the visit") +
            ". It is a summary, not a substitute for the individual scores &mdash; a single appliance needing attention matters more than the average suggests."}</small>
      </div>

      ${attention.length ? `<div class="portfolio-attention" data-flow>
        <h3>What we found this visit</h3>
        ${attention.map(function (x) {
          const findings = findingsFor(x);
          const scope = scopeNoteFor(x.asset);
          return `<article class="attention-item status-${x.status.code}">
            <div class="attention-head">
              <strong>${ui.escapeHtml(x.report.applianceLabel)}</strong>
              <span>${ui.escapeHtml(x.position || x.area)}</span>
              <b>${scoreOf(x.report) === null ? "Not scored" : scoreOf(x.report) + "%"}</b>
            </div>
            ${findings.length
              ? `<ul>${findings.map(function (a) { return `<li><strong>${ui.escapeHtml(a.label)}</strong> ${ui.escapeHtml(a.detail || "")}</li>`; }).join("")}</ul>`
              : `<p>${ui.escapeHtml(x.report.recommendations || x.report.summary || "See the appliance report for detail.")}</p>`}
            ${photoStrip(x.report)}
            ${scope ? `<p class="attention-scope"><strong>Scope of cover:</strong> ${ui.escapeHtml(scope)}</p>` : ""}
            ${x.advice && !(x.advice.posture.code === "maintain" && findings.length)
              ? `<p class="attention-posture">${ui.escapeHtml(x.advice.posture.lead)}</p>`
              : ""}
          </article>`;
        }).join("")}
      </div>` : ""}
    `;

    /* ---- appliance-by-appliance, grouped by where they are ---- */
    const byArea = {};
    rows.forEach(function (x) { (byArea[x.area] = byArea[x.area] || []).push(x); });

    /* Rooms lead with whichever holds the appliance that measured worst, so the
       inventory reads in the same order of attention as the summary page rather
       than in whatever order the household record happens to store them. */
    const areaOrder = Object.keys(byArea).sort(function (a, b) {
      const worst = function (area) {
        return Math.min.apply(null, byArea[area].map(function (x) { return measuredScore(x.report); }));
      };
      return worst(a) - worst(b) || a.localeCompare(b);
    });

    const inventoryBody = `
      <p class="portfolio-intro">Every appliance maintained on this visit, grouped by where it sits in the home. Each links to its own health report, which carries the full protocol, the readings and the service history.</p>
      <div class="portfolio-areas" data-flow>
      ${areaOrder.map(function (area) {
        const list = byArea[area].slice().sort(function (a, b) { return measuredScore(a.report) - measuredScore(b.report); });
        return `<section class="portfolio-area">
          <h3>${ui.escapeHtml(area)} <span>${list.length} appliance${list.length === 1 ? "" : "s"}</span></h3>
          <div class="table-wrap"><table class="portfolio-table">
            <thead><tr><th>Appliance</th><th>Score</th><th>Status</th><th></th></tr></thead>
            <tbody>${list.map(function (x) {
              const s = scoreOf(x.report);
              return `<tr>
                <td><div class="table-title">${ui.escapeHtml(x.report.applianceLabel)}</div><div class="table-sub">${x.position && x.position !== x.area ? ui.escapeHtml(x.position) + " · " : ""}${ui.escapeHtml(x.report.technician || "")}${ageCaption(x)}</div></td>
                <td><strong>${s === null ? "&mdash;" : s + "%"}</strong><div class="table-sub">${s === null ? "Not scored" : ui.escapeHtml(scoreParts(x.report))}</div></td>
                <td><span class="portfolio-status status-${x.status.code}">${ui.escapeHtml(x.status.label)}</span></td>
                <td><a class="button small ghost no-print" aria-label="Health report for ${ui.escapeHtml(x.report.applianceLabel || "this appliance")}" href="report-view.html?id=${ui.escapeHtml(x.report.id)}">Report</a></td>
              </tr>`;
            }).join("")}</tbody>
          </table></div>
        </section>`;
      }).join("")}
      </div>
    `;

    /* ---- consumables and what comes next ---- */
    const filters = (state.filters || []).filter(function (f) { return f.householdId === visit.householdId; });
    /*
     * `daysFromNow` returns NaN for a missing or unparseable date, and
     * `NaN <= 90` is false -- so a filter with no due date on record was
     * counted as "not due within 90 days" and the customer was told nothing
     * was coming up. The table beside this paragraph printed "-" for the same
     * row, so the document contradicted itself.
     */
    const dueSoon = filters.filter(function (f) { return Number.isFinite(ui.daysFromNow(f.nextDueOn)) && ui.daysFromNow(f.nextDueOn) <= 90; });
    const undated = filters.filter(function (f) { return !Number.isFinite(ui.daysFromNow(f.nextDueOn)); });

    /* The next stop is a visit record on the household, not a field on this one.
       Looking it up here means the review says a real date instead of falling
       back to "scheduled from the plan renewal date" on every household that
       already has its next visit on the board. */
    const nextVisit = (state.visits || [])
      .filter(function (v) {
        return v.householdId === visit.householdId && v.category === visit.category &&
               v.status !== "Completed" && String(v.dueDate) > String(serviceDate);
      })
      .sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); })[0] || null;

    /* An open item is only useful to a customer if it comes back next visit.
       These are the same findings from the summary page, restated as the list
       the next technician is expected to close out. */
    /* Evidence actually captured on this stop -- counted from the photographs
       themselves, never asserted. */
    const photoTotal = rows.reduce(function (sum, x) {
      return sum + (x.report.photos || []).filter(function (p) { return p && p.id; }).length;
    }, 0);

    const followUps = attention.map(function (x) {
      const finding = findingsFor(x)[0];
      if (!finding) return null;
      return { appliance: x.report.applianceLabel, text: finding.label + (finding.detail ? " — " + finding.detail : "") };
    }).filter(Boolean);
    const nextBody = `
      <div class="portfolio-next">
        <h3>Filters and consumables</h3>
        ${filters.length
          ? `<p>${filters.length} filter${filters.length === 1 ? "" : "s"} tracked on this household${dueSoon.length ? `, ${dueSoon.length} due within 90 days` : (undated.length === filters.length ? "" : ", none due within 90 days")}${undated.length ? `, ${undated.length} with no due date on record yet` : ""}.</p>
             <div class="table-wrap"><table class="portfolio-table">
               <thead><tr><th>Filter</th><th>Equipment</th><th>Next due</th><th>Coverage</th></tr></thead>
               <tbody>${filters.slice(0, 12).map(function (f) {
                 const asset = assetsById[f.assetId];
                 return `<tr><td>${ui.escapeHtml(f.filterType)}<div class="table-sub">${ui.escapeHtml(f.partNumber || "Part to verify")}</div></td><td>${ui.escapeHtml(asset ? asset.typeLabel : "Household")}</td><td>${ui.shortDate(f.nextDueOn)}</td><td>${ui.escapeHtml(f.planCoverage || "Track only")}</td></tr>`;
               }).join("")}</tbody>
             </table></div>`
          : "<p>No filters are currently tracked for this household.</p>"}

        <h3>Next maintenance</h3>
        <p>${subscription ? ui.escapeHtml(subscription.planName) + " · " : ""}${nextVisit
          ? "Next interval " + ui.shortDate(nextVisit.dueDate) + (nextVisit.season ? " · " + ui.escapeHtml(nextVisit.season) : "")
          : "The next interval will be scheduled from the plan renewal date."}</p>
        ${followUps.length ? `<h3>Carried forward to that visit</h3>
          <ul class="portfolio-followups">${followUps.map(function (f) {
            return `<li><strong>${ui.escapeHtml(f.appliance)}</strong> ${ui.escapeHtml(f.text)}</li>`;
          }).join("")}</ul>` : ""}

        <p class="portfolio-basis">${photoTotal ? photoTotal + " photograph" + (photoTotal === 1 ? " was" : "s were") + " taken at the appliances during this visit and are held with the individual reports. " : ""}This review compiles the individual appliance health reports from this visit. Each appliance's full protocol, measured readings and service history remain available in its own report. Expected service life is a draft estimate from appliance category and product tier, not a manufacturer warranty. Wilson does not recommend replacing an appliance that has remaining expected life and an identified, serviceable cause.</p>
      </div>
    `;

    host.innerHTML = cover
      + reportPage("Portfolio Summary", household ? household.name : "Household", summaryBody, "portfolio-summary-page")
      + reportPage("Appliance Inventory", household ? household.name : "Household", inventoryBody, "portfolio-inventory-page")
      + reportPage("Consumables & Next Visit", household ? household.name : "Household", nextBody, "portfolio-next-page");

    /*
     * Split anything too tall for a sheet BEFORE the photographs load.
     *
     * Pagination measures rendered heights, and an image that arrives later
     * would change them after the split was decided. The photo frames have a
     * fixed aspect-ratio box, so they occupy their final height from the start
     * and the measurement holds.
     */
    if (window.WILSON_PAGINATE) window.WILSON_PAGINATE.run(host);

    hydratePhotos();
  }

  const printButton = document.getElementById("print-report");
  if (printButton) printButton.addEventListener("click", function () { window.print(); });
  document.addEventListener("DOMContentLoaded", render);
})();

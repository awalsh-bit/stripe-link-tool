(function () {
  const ui = window.WilsonUI;
  const state = WilsonStore.load();
  const params = new URLSearchParams(window.location.search);
  /*
   * No fallback. `|| state.reports[0]` meant a wrong or missing id silently
   * rendered whichever report happened to be first -- with one seeded report
   * that was invisible; with a real history it means showing one customer
   * another household's appliance data. The field tool already refuses to guess
   * a residence without a visit ID; a customer health report deserves the same
   * rule.
   */
  const requestedReportId = params.get("id");
  const report = requestedReportId ? WilsonStore.getReport(requestedReportId) : null;

  /*
   * The stored reading results are "Above range", "Below range", "High side of
   * range", "In range" and "Recorded" (store.js readingResult). None of the
   * first three matched any branch here, so they fell through to the neutral
   * "info" treatment and printed beside green "In range" cards looking equally
   * unremarkable -- the one card a customer most needs to notice was the one
   * with no emphasis on it. "Above range" is also why testing for "out" was
   * not enough: the word never appears.
   */
  /*
   * v0.9.37: THE FIELD TOOL'S OWN WORDS WERE NOT IN THIS LIST.
   *
   * The branches below were written for the SEEDED vocabulary -- "above range",
   * "in range". The field tool emits "Needs attention", "Normal" and "Recorded",
   * and none of them matched: "attention" does not contain "action", so a
   * flagged reading fell through to the neutral `info` style and rendered
   * exactly like a normal one. A healthy field report showed no green anywhere,
   * and the one card a customer most needed to notice had no emphasis on it.
   *
   * Which is what the comment above this function already claimed was fixed. It
   * was fixed for one vocabulary and not the other, so both are now listed
   * explicitly and the fallback is the last resort it was meant to be.
   */
  function statusClass(value) {
    const lower = String(value || "").toLowerCase().trim();
    if (!lower) return "info";
    /* Field vocabulary, exact -- checked first so no substring rule can shadow it. */
    if (lower === "needs attention" || lower === "action" || lower === "fail") return "danger";
    if (lower === "watch" || lower === "monitor" || lower === "cause for concern") return "warning";
    if (lower === "pass" || lower === "normal") return "success";
    if (lower === "recorded" || lower === "not applicable" || lower === "n/a") return "info";
    /* Seeded and free-text vocabulary. */
    if (lower.includes("above range") || lower.includes("below range")) return "danger";
    if (lower.includes("out") || lower.includes("action") || lower.includes("poor")) return "danger";
    if (lower.includes("attention")) return "danger";
    if (lower.includes("high side")) return "warning";
    if (lower.includes("monitor") || lower.includes("watch")) return "warning";
    if (lower.includes("not applicable")) return "info";
    if (lower.includes("in range") || lower.includes("pass") || lower.includes("good") || lower.includes("excellent")) return "success";
    return "info";
  }

  function badge(value) {
    return `<span class="badge ${statusClass(value)}">${ui.escapeHtml(value || "-")}</span>`;
  }

  function reportPage(title, kicker, body, pageClass) {
    return `
      <section class="report-page ${pageClass || ""}">
        <header class="report-page-header">
          <div class="report-mini-logo"><img src="assets/logo-black.png" alt="Wilson AC & Appliance"></div>
          <div><span>${ui.escapeHtml(kicker || "Appliance Health Report")}</span><h2>${ui.escapeHtml(title)}</h2></div>
        </header>
        <div class="report-page-body">${body}</div>
        <footer class="report-page-footer"><span>Wilson AC & Appliance · Appliance Health Report</span><span>${ui.escapeHtml(report ? report.reference || report.id : "")}</span></footer>
      </section>
    `;
  }

  function groupedCheckpoints() {
    const groups = {};
    (report.checkpoints || []).forEach(function (item) {
      const category = item.category || "General";
      if (!groups[category]) groups[category] = [];
      groups[category].push(item);
    });
    return groups;
  }

  /*
   * THE LEDGER HAS TO ADD UP TO THE SCORE.   (v0.9.37)
   * =================================================
   *
   * This page is headed "How this score was calculated" and it did not
   * calculate it. Two separate reasons, both fixed here:
   *
   *   1. THE AGE TERM WAS NEVER A LINE. The score is
   *      `vital x 0.75 + ageScore x 0.25`, and the ledger only ever accounted
   *      for measured condition -- so a report printing 93 showed deductions
   *      summing to 7 points less than it should, or, on a perfectly-measuring
   *      older appliance, showed ZERO deductions above a score of 85. The
   *      customer read "No point deductions -- all applicable checkpoints
   *      received full points" directly above "Your appliance score 85%".
   *
   *   2. CONDITION LOSSES WERE NOT WEIGHTED. They were computed out of 100 and
   *      printed beside a score in which they are worth 75% of 100.
   *
   * Both halves now come off the SAME arithmetic the score does, and the
   * function returns the reconciliation with them so the page can prove it
   * rather than assert it.
   *
   * The seeded demo reports carry a hand-built `categoryLosses`, which is what
   * has been demoed and is not what a field visit produces. It is still used
   * where present, but the age line is appended to it too -- a demo report that
   * does not add up is the same lie in a nicer suit.
   */
  function scoreLosses() {
    const scoring = window.WILSON_CONFIG.reportScoring || {};
    const vitalWeight = Number(scoring.vitalWeight);
    const ageWeight = Number(scoring.ageWeight);
    const life = report.lifecycle || {};
    const vital = num(life.vitalScore);
    const ageScore = num(life.ageScore);
    const overall = num(report.score);

    /*
     * THE WEIGHT ONLY APPLIES WHEN THERE IS AN AGE TERM.
     *
     * `store.js` computes `dated ? vital*0.75 + ageScore*0.25 : vital`. On an
     * appliance with no established age the score IS the condition score, so
     * scaling its deductions by 0.75 would leave the ledger short -- which is
     * exactly what my first version of this function did, and three seeded
     * dryer reports caught it: printed 92, ledger said 94.
     */
    const dated = ageScore !== null && isFinite(ageWeight) && ageWeight > 0;
    const conditionWeight = dated && isFinite(vitalWeight) ? vitalWeight : 1;

    /* Condition, by subsystem, weighted the way the score weights it. */
    let condition;
    if (report.categoryLosses && report.categoryLosses.length) {
      condition = report.categoryLosses.map(function (row) {
        return { category: row.category, explanation: row.explanation,
                 loss: round1(Number(row.loss || 0) * conditionWeight) };
      });
    } else {
      const checkpoints = (report.checkpoints || [])
        .filter(function (item) { return item.status !== "N/A" && !item.notApplicable && Number(item.rating); });
      const maxPer = checkpoints.length ? 100 / checkpoints.length : 0;
      const map = {};
      checkpoints.forEach(function (item) {
        const category = item.category || "Condition";
        map[category] = (map[category] || 0) + maxPer * (1 - Number(item.rating) / 5);
      });
      condition = Object.keys(map).map(function (category) {
        return { category: category,
                 explanation: "Checkpoint ratings in this subsystem.",
                 loss: round1(map[category] * conditionWeight) };
      });
    }
    condition = condition.filter(function (row) { return row.loss > 0; })
      .sort(function (a, b) { return b.loss - a.loss; });

    /*
     * The age line. It is a deduction against a DRAFT expected life, not a
     * fault, so it says so -- a customer should be able to tell at a glance
     * that these points came off for a birthday and not for a reading.
     */
    const rows = condition.slice();
    if (dated) {
      const ageLoss = round1((100 - ageScore) * ageWeight);
      if (ageLoss > 0) {
        /* `lifeUsedPct` lives on the lifecycle ADVICE object, not on the stored
           lifecycle record, so this branch never once fired and every report
           printed the vague fallback. The ratio is on the record; use it. */
        const ratio = num(life.lifeRatio);
        const pct = ratio !== null ? Math.min(100, Math.round(ratio * 100)) : null;
        const used = pct !== null && Number(life.expectedYears) > 0
          ? pct + "% of a draft expected life of " + life.expectedYears + " years"
          : "age against a draft expected life";
        rows.push({
          category: "Age",
          isAge: true,
          explanation: used + ". Nothing measured on this visit caused these points \u2014 " +
            "they come off for how long the appliance has been in service.",
          loss: ageLoss
        });
      }
    }

    /* What the page can now show instead of asserting. */
    const sum = round1(rows.reduce(function (t, r) { return t + Number(r.loss || 0); }, 0));
    const reconciles = overall === null ? null : Math.abs((100 - sum) - overall) <= 1.1;
    rows.total = sum;
    rows.reconciles = reconciles;
    rows.hasAge = rows.some(function (r) { return r.isAge; });
    return rows;
  }

  function num(value) {
    return value === null || value === undefined || value === "" ? null : Number(value);
  }
  function round1(value) { return Math.round(Number(value) * 10) / 10; }

  /*
   * How the score was reached, said accurately for THIS report.
   *
   * The old copy asserted a 75/25 blend for every report that carried a
   * lifecycle block at all. An appliance with no established age has no age
   * term -- its score is measured condition alone -- and describing a blend
   * that was not applied is the kind of small untruth that costs a customer's
   * trust in every other number on the page.
   */
  /*
   * The age on the report-information page: the number and its source, or a
   * plain statement that there isn't one. `Number(lifecycle.age||0)` printed
   * "0 years" for an appliance nobody had a date for.
   */
  function ageFactLine() {
    const life = report.lifecycle || {};
    const age = life.age;
    if (age === null || age === undefined || age === "") return "Not established";
    const source = window.WILSON_AGE ? window.WILSON_AGE.source(life.ageSource) : null;
    const suffix = source ? " · " + ui.escapeHtml(source.short || source.label) : "";
    return Number(age) + " years" + suffix;
  }

  /* ---------------------------------------------------------------------
   * Photographic record
   *
   * The report used to print "N photos associated with this report in the
   * production workflow" -- a count with nothing behind it, because the field
   * tool discarded every image at capture. The photographs are now stored and
   * rendered, each against the checkpoint it is evidence for.
   *
   * Where an image cannot be found, the report says exactly that. Field photos
   * live in the browser that captured them until the production upload path
   * exists, so a report opened on another machine legitimately has no images --
   * and "not available on this device" is the truthful thing to print, not a
   * number implying they are somewhere in a system.
   * ------------------------------------------------------------------- */
  function photoList() {
    return (report.photos || []).filter(function (p) { return p && p.id; });
  }

  function photoSection() {
    const photos = photoList();
    if (!photos.length) {
      return '<div class="photo-record empty"><strong>Photographic record</strong>' +
        '<span>No photographs were captured with this report.</span></div>';
    }
    return '<div class="photo-record"><strong>Photographic record</strong>' +
      '<span>' + photos.length + ' photograph' + (photos.length === 1 ? "" : "s") +
      ' taken at the appliance during this visit.</span>' +
      '<div class="photo-grid" data-flow>' + photos.map(function (p) {
        return '<figure class="photo-cell" data-photo-id="' + ui.escapeHtml(p.id) + '">' +
          '<div class="photo-frame"><span class="photo-loading">Loading…</span></div>' +
          '<figcaption><strong>' + ui.escapeHtml(p.checkName || (p.kind === "serial" ? "Serial tag" : "Condition")) + '</strong>' +
          (p.caption ? '<span>' + ui.escapeHtml(p.caption) + '</span>' : '') + '</figcaption>' +
        '</figure>';
      }).join("") + '</div></div>';
  }

  /* Images load after the document is in the DOM: they come out of IndexedDB,
     which is async, and blocking the whole report on them would mean a blank
     page while they decode. */
  function hydratePhotos() {
    document.querySelectorAll("[data-photo-id]").forEach(function (cell) {
      const frame = cell.querySelector(".photo-frame");
      if (!frame || !window.WILSON_PHOTOS) return;
      window.WILSON_PHOTOS.url(cell.dataset.photoId).then(function (src) {
        if (!src) {
          frame.innerHTML = '<span class="photo-missing">Captured in the field · not available on this device</span>';
          return;
        }
        const img = document.createElement("img");
        img.src = src;
        img.alt = "Field photograph";
        img.onload = function () { window.URL.revokeObjectURL(src); };
        frame.innerHTML = "";
        frame.appendChild(img);
      }).catch(function () {
        frame.innerHTML = '<span class="photo-missing">Photograph could not be read</span>';
      });
    });
  }

  /*
   * A score, or the honest absence of one.
   *
   * `report.score` is null when an HVAC system could not be evaluated against
   * enough of its own nameplate to publish a number. Every place that printed
   * `Number(report.score || 0)` turned that into "0%", which read as the worst
   * possible result rather than as "we could not measure this".
   */
  const scoreAvailable = report && report.score !== null && report.score !== undefined && report.score !== "";

  /*
   * THE COMPONENTS, BESIDE THE TOTAL.
   *
   * A blended score destroys information: 78 could be a fifteen-year-old
   * refrigerator measuring perfectly or a three-year-old measuring badly, and
   * those two need opposite conversations. Age is worth 25% of the number
   * (owner's decision, and age does predict failure) -- so the condition and
   * the life used are printed next to it, always, and a well-kept older
   * appliance can be seen scoring full marks on what was measured.
   */
  function scoreParts() {
    const life = (report && report.lifecycle) || null;
    if (!life) return "";
    const bits = [];
    const vital = life.vitalScore;
    if (vital !== null && vital !== undefined && vital !== "") {
      bits.push("Condition " + Math.round(Number(vital)));
    }
    const ratio = life.lifeRatio;
    if (ratio !== null && ratio !== undefined && ratio !== "" && Number(life.expectedYears) > 0) {
      bits.push("Life used " + Math.round(Number(ratio) * 100) + "%");
    }
    return bits.join(" \u00b7 ");
  }
  function scoreValue() { return scoreAvailable ? Number(report.score) + "%" : "Not scored"; }

  function scoreNote() {
    if (scoreAvailable) return "";
    return report.scoreUnavailableReason
      || "Not enough of this equipment could be measured against its design to publish a score.";
  }

  /*
   * The one sentence that says where this appliance's expected life came from.
   *
   * Built by `WILSON_BRANDS.basisSentence` -- the same builder the field card
   * and the office screen use -- so the three surfaces cannot describe the same
   * figure in three different ways. Reports written before v0.9.37 carry no
   * basis; those fall back to stating the figure without claiming a source,
   * which is the honest thing to say about a record that never stored one.
   */
  function expectedLifeSentence(audience) {
    const life = report.lifecycle || {};
    const years = Number(life.expectedYears || 0);
    if (window.WILSON_BRANDS && life.lifeBasis) {
      return window.WILSON_BRANDS.basisSentence(life.lifeBasis, years, audience || "customer");
    }
    if (!years) return "";
    return years + " years is the draft expected service life on record for this appliance.";
  }

  /*
   * The fact grid has room for a phrase, not a sentence. The full sentence is
   * on the lifecycle panel; this says only which KIND of figure it is, which is
   * the part that used to be missing entirely -- the grid said "Luxury · 23 yr
   * draft expected life" and the tier had not chosen that number since v0.9.30.
   */
  /*
   * Outdoor, on the customer's report.                          (v0.9.37)
   *
   * Only shown when the appliance IS outdoors. An indoor appliance saying
   * "indoor" is noise; an outdoor one saying nothing is a missing fact, because
   * outdoors is a large part of why the expected life beside it reads the way
   * it does.
   */
  function environmentTag(asset) {
    if (!asset || !window.WILSON_ENVIRONMENT) return "";
    const env = window.WILSON_ENVIRONMENT.for(asset);
    if (env.id !== "outdoor") return "";
    return ' <span class="life-basis-tag">Outdoor install</span>';
  }

  function expectedLifeBadge() {
    const basis = (report.lifecycle || {}).lifeBasis;
    if (!basis) return "";
    if (basis.kind !== "brand") return ' <span class="life-basis-tag">category figure</span>';
    const corroborated = basis.field !== null && basis.field !== undefined &&
      basis.anchored !== null && basis.anchored !== undefined;
    return ' <span class="life-basis-tag">' +
      (corroborated ? "Wilson + published figure" : "Wilson field figure") + "</span>";
  }

  function scoreExplanation() {
    const life = report.lifecycle || null;
    const scoring = window.WILSON_CONFIG.reportScoring;
    const vw = Math.round((scoring.vitalWeight || 0.75) * 100);
    const aw = Math.round((scoring.ageWeight || 0.25) * 100);
    const dated = life && life.age !== null && life.age !== undefined && life.age !== "" && Number(life.expectedYears) > 0;

    /*
     * HVAC scores contain no age term at all -- `scoreHealth` is not given age
     * and is not given the efficiency rating, which is the whole guardrail. But
     * an HVAC report has an age and an expected life on it, so `dated` was true
     * and the customer was told their score "blends condition with lifecycle
     * age (25%)" for a number that never saw it. `ageScore === null` is how the
     * field tool marks a score with no age term in it.
     */
    /*
     * An HVAC report with no age term at all -- an undated system. Its
     * efficiency rating is still never in the number, which is the guardrail
     * that does not move; age is (v0.9.17) when there is an install date.
     */
    if (life && (life.ageScore === null || life.ageScore === undefined)) {
      if (!scoreAvailable) {
        return "There is no score on this report. " + scoreNote();
      }
      return "This score is measured performance against this equipment's own nameplate: what it is " +
        "delivering compared with what it was built to deliver. There is no install date on record, " +
        "so no age term is applied. The efficiency rating is printed on this report as a fact and is " +
        "not part of the number \u2014 equipment meeting its own rating is performing correctly, " +
        "whatever that rating is.";
    }

    if (!scoreAvailable) {
      return "There is no score on this report. " + scoreNote();
    }

    if (!life) {
      return "Applicable health checkpoints are converted to a 100-point condition score. Lifecycle weighting will be added when age and product-tier information are available.";
    }
    if (!dated) {
      return "This score is measured condition only: " + vw + "% of the usual calculation is current-condition health checks, and the remaining " +
        aw + "% is appliance age \u2014 which is not applied here, because no install date is on record for this appliance. " +
        "Nothing has been estimated in its place.";
    }
    const provenance = life.ageDocumented
      ? "The age used is " + life.age + " years, taken from the Wilson invoice that sold this appliance."
      : "The age used is " + life.age + " years, " +
        (life.ageSource === "customer" ? "as stated by the customer" : "estimated by the technician at the visit") +
        " rather than from a document.";
    /*
     * WHERE THE EXPECTED LIFE CAME FROM.
     *
     * This sentence used to read "This Luxury tier uses a draft expected
     * service life of 23 years", which stopped being true in v0.9.30 -- the
     * tier no longer chooses the number when Wilson's brand table has a row for
     * the brand and product line, and on this estate every appliance has one.
     * It now prints the same provenance the technician sees, from the one
     * builder, so the customer can tell a corroborated figure from one that
     * rests on Wilson's experience alone.
     */
    return "This score blends current-condition health checks (" + vw + "%) with appliance lifecycle age (" + aw + "%). " +
      ui.escapeHtml(expectedLifeSentence("customer")) + " " +
      provenance + " Age affects the score, but a well-running older appliance can still score well.";
  }

  function conditionStatement() {
    /* v0.9.39 vocabulary plus the pre-verdict words, so an old stored report
       still counts its own findings. */
    const actionCount = (report.checkpoints || []).filter((item) => item.status === "Fail" || item.status === "Action").length;
    const watchCount = (report.checkpoints || []).filter((item) => item.status === "Cause for concern" || item.status === "Watch").length;
    if (actionCount) return `${actionCount} checkpoint${actionCount === 1 ? " requires" : "s require"} corrective action.`;
    if (watchCount) return `${watchCount} checkpoint${watchCount === 1 ? " should" : "s should"} be monitored.`;
    return "No immediate corrective action was identified from the recorded checkpoints.";
  }


  /* ---------------------------------------------------------------------
   * Service history
   *
   * One visit produces a score; several produce a curve, and the curve is what
   * turns a maintenance call into a health record. Everything below plots a
   * SINGLE series against its own scale -- never two measures on one pair of
   * axes, which is the fastest way to make a chart lie.
   * ------------------------------------------------------------------- */

  const INK = "#33413a";
  const MUTED = "#6b7a70";
  const SERIES = "#12331f";      /* Wilson green, the one data hue */
  const SURFACE = "#ffffff";
  const GRID = "#e4ebe6";
  const BAND = "#eaf2ec";
  const STATUS = { good: "#1f7a3f", warning: "#b3701e", serious: "#a83a20" };

  /* Every report for this appliance, oldest first. */
  function historyFor(currentReport) {
    return (WilsonStore.load().reports || [])
      .filter(function (r) { return r.assetId === currentReport.assetId; })
      .slice()
      .sort(function (a, b) { return String(a.inspectionDate).localeCompare(String(b.inspectionDate)); });
  }

  function numeric(value) {
    const n = parseFloat(String(value === undefined || value === null ? "" : value).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  /* "15-30°F above ambient" / "120-150°F" -> {min, max}. A target we can draw is
     what makes a reading mean something; an unparseable one just isn't drawn. */
  function targetBand(text) {
    const m = String(text || "").match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const min = parseFloat(m[1]), max = parseFloat(m[2]);
    return max > min ? { min: min, max: max } : null;
  }

  /* One measurement label -> its readings across every visit. */
  function measurementSeries(history) {
    const byLabel = {};
    history.forEach(function (report) {
      (report.measurements || []).forEach(function (m) {
        const value = numeric(m.observed);
        if (value === null) return;
        if (!byLabel[m.label]) byLabel[m.label] = { label: m.label, unit: m.unit || "", target: targetBand(m.target), points: [] };
        byLabel[m.label].points.push({ date: report.inspectionDate, value: value });
      });
    });
    /* A set point is a customer setting, not a reading. It was drawing its own
       flat line next to the compartment it explains; it belongs as that chart's
       target instead. */
    Object.keys(byLabel).forEach(function (k) {
      if (!/set ?point/i.test(k)) return;
      const setpoint = byLabel[k];
      const owner = Object.keys(byLabel).find(function (other) {
        return other !== k && k.toLowerCase().indexOf(other.toLowerCase().split(" ")[0]) === 0;
      });
      const latest = setpoint.points[setpoint.points.length - 1];
      if (owner && latest) byLabel[owner].setpoint = latest.value;
      delete byLabel[k];
    });

    return Object.keys(byLabel)
      .map(function (k) { return byLabel[k]; })
      .filter(function (sery) { return sery.points.length >= 2; });
  }

  function niceTicks(min, max) {
    if (max === min) { min -= 1; max += 1; }
    const pad = (max - min) * 0.25 || 1;
    const lo = Math.floor((min - pad) * 2) / 2, hi = Math.ceil((max + pad) * 2) / 2;
    return { lo: lo, hi: hi };
  }

  /*
   * A single-series line. No legend: there is one colour, and the title above it
   * says what is plotted. Only the endpoint is labelled -- a number on every
   * point is chaos and goes unread.
   */
  function sparkChart(sery, opts) {
    const o = opts || {};
    const w = o.width || 260, h = o.height || 92;
    const padL = 8, padR = 40, padT = 12, padB = 20;
    const pts = sery.points;
    const values = pts.map(function (p) { return p.value; });
    let lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    if (sery.target) { lo = Math.min(lo, sery.target.min); hi = Math.max(hi, sery.target.max); }
    if (sery.setpoint !== undefined) { lo = Math.min(lo, sery.setpoint - 2); hi = Math.max(hi, sery.setpoint + 2); }
    const scale = niceTicks(lo, hi);
    const x = function (i) { return padL + (i / Math.max(1, pts.length - 1)) * (w - padL - padR); };
    const y = function (v) { return padT + (1 - (v - scale.lo) / (scale.hi - scale.lo)) * (h - padT - padB); };

    const line = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.value).toFixed(1); }).join(" ");
    const area = line + " L" + x(pts.length - 1).toFixed(1) + " " + (h - padB) + " L" + x(0).toFixed(1) + " " + (h - padB) + " Z";
    const last = pts[pts.length - 1];
    const first = pts[0];
    const delta = last.value - first.value;

    /* Direction has no fixed meaning across measures -- a rising inlet
       temperature is good, a rising condenser split is not. State does: colour
       by whether the latest reading sits inside what it should be, and let the
       delta text carry the direction without claiming a verdict. */
    const band = sery.target || (sery.setpoint !== undefined
      ? { min: sery.setpoint - 2, max: sery.setpoint + 2, derived: true }
      : null);
    const outOfBand = band && (last.value < band.min || last.value > band.max);
    const endColour = outOfBand ? STATUS.serious : SERIES;

    const bandRect = band
      ? '<rect x="' + padL + '" y="' + y(band.max).toFixed(1) + '" width="' + (w - padL - padR) +
        '" height="' + Math.max(1, (y(band.min) - y(band.max))).toFixed(1) +
        '" fill="' + BAND + '"></rect>'
      : "";


    return '<figure class="trend-figure">' +
      '<figcaption><span class="trend-label">' + ui.escapeHtml(sery.label) + '</span>' +
        '<span class="trend-now">' + last.value + (sery.unit ? '<i>' + ui.escapeHtml(sery.unit) + '</i>' : "") + '</span>' +
        '<span class="trend-delta ' + (outOfBand ? "out" : "flat") + '">' +
          (delta === 0 ? "no change" : (delta > 0 ? "+" : "") + Math.round(delta * 10) / 10 + " since " + ui.shortDate(first.date)) +
        '</span>' +
      '</figcaption>' +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + ui.escapeHtml(sery.label) +
        ' from ' + first.value + ' to ' + last.value + ' ' + ui.escapeHtml(sery.unit) + '">' +
        bandRect +
        '<line x1="' + padL + '" y1="' + (h - padB) + '" x2="' + (w - padR) + '" y2="' + (h - padB) +
          '" stroke="' + GRID + '" stroke-width="1"></line>' +
        '<path d="' + area + '" fill="' + SERIES + '" opacity="0.10"></path>' +
        '<path d="' + line + '" fill="none" stroke="' + SERIES + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>' +
        pts.map(function (p, i) {
          return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.value).toFixed(1) + '" r="3" fill="' + SERIES + '" opacity="0.45"><title>' +
            ui.shortDate(p.date) + ": " + p.value + " " + ui.escapeHtml(sery.unit) + '</title></circle>';
        }).join("") +
        '<circle cx="' + x(pts.length - 1).toFixed(1) + '" cy="' + y(last.value).toFixed(1) +
          '" r="4.5" fill="' + endColour + '" stroke="' + SURFACE + '" stroke-width="2"><title>' +
          ui.shortDate(last.date) + ": " + last.value + " " + ui.escapeHtml(sery.unit) + '</title></circle>' +
        '<text x="' + (x(pts.length - 1) + 9).toFixed(1) + '" y="' + (y(last.value) + 4).toFixed(1) +
          '" fill="' + INK + '" font-size="11" font-weight="600">' + last.value + '</text>' +
        (band ? '<text x="' + padL + '" y="' + (h - 6) + '" fill="' + MUTED + '" font-size="9">' +
          (band.derived ? "set point " + sery.setpoint + ui.escapeHtml(sery.unit) + " ±2" : "target " + band.min + "-" + band.max + " " + ui.escapeHtml(sery.unit)) +
          '</text>' : "") +
      '</svg>' +
    '</figure>';
  }

  function historySection(report) {
    const history = historyFor(report);
    if (history.length < 2) {
      return '<div class="trend-empty"><strong>First recorded visit</strong>' +
        '<span>Health scores and measured readings start trending from the next maintenance interval. ' +
        'A single visit shows condition; the history shows direction.</span></div>';
    }

    /*
     * A VISIT THAT COULD NOT BE SCORED IS NOT A VISIT THAT SCORED ZERO.
     *
     * `Number(r.score || 0)` plotted an unscored visit at the bottom of the
     * chart. One HVAC system with no readable nameplate -- a state the report's
     * own cover page handles correctly, printing "Not scored" -- and the hero
     * above this chart read "Health score today 0" and "-88 points across 3
     * visits" on a report that says it has no score. The same defect was fixed
     * on the cover in v0.9.24 and not here.
     *
     * An unscored visit is dropped from the series and named under the chart.
     * It is not interpolated, averaged or drawn: there is no number to draw.
     */
    const scoreOf = function (r) {
      const n = Number(r && r.score);
      return r && r.score !== null && r.score !== undefined && r.score !== "" && isFinite(n) ? n : null;
    };
    const scoredHistory = history.filter(function (r) { return scoreOf(r) !== null; });
    const unscoredCount = history.length - scoredHistory.length;

    /* Two scored visits are what makes a trend. One scored visit inside a
       longer history is a point, not a direction, and saying so beats drawing
       a line through a hole. */
    if (scoredHistory.length < 2) {
      return '<div class="trend-empty"><strong>' +
        (scoredHistory.length === 1 ? "Not enough scored visits to trend yet" : "No scored visits to trend yet") +
        '</strong><span>' +
        (unscoredCount
          ? "This appliance has " + history.length + " recorded visit" + (history.length === 1 ? "" : "s") +
            ", but " + unscoredCount + " of them could not be scored, so there is no direction to plot. " +
            "The readings from each visit are still on that visit's own report."
          : "Health scores and measured readings start trending from the next maintenance interval.") +
        '</span></div>';
    }

    const scoreSeries = {
      label: "Health score",
      unit: "",
      target: null,
      points: scoredHistory.map(function (r) { return { date: r.inspectionDate, value: scoreOf(r) }; }),
    };
    const first = scoreSeries.points[0], last = scoreSeries.points[scoreSeries.points.length - 1];
    const drop = last.value - first.value;
    const measures = measurementSeries(history);

    const table = '<details class="trend-table"><summary>View the numbers as a table</summary>' +
      '<table><thead><tr><th>Visit</th><th>Score</th>' +
      measures.map(function (m) { return "<th>" + ui.escapeHtml(m.label) + (m.unit ? " (" + ui.escapeHtml(m.unit) + ")" : "") + "</th>"; }).join("") +
      '</tr></thead><tbody>' +
      history.map(function (r) {
        /* The table lists EVERY visit, including the ones with no score --
           dropping them would hide that the visit happened. It prints what it
           has, which for those is an em-dash, not a nought. */
        return "<tr><td>" + ui.shortDate(r.inspectionDate) + "</td><td>" +
          (scoreOf(r) === null ? "<span class=\"not-scored\">Not scored</span>" : scoreOf(r)) + "</td>" +
          measures.map(function (m) {
            const hit = m.points.find(function (p) { return p.date === r.inspectionDate; });
            return "<td>" + (hit ? hit.value : "—") + "</td>";
          }).join("") + "</tr>";
      }).join("") +
      '</tbody></table></details>';

    return '<div class="trend-hero">' +
        '<div><span class="trend-hero-label">Health score today</span>' +
          '<strong class="trend-hero-value">' + last.value + '</strong>' +
          '<span class="trend-hero-delta ' + (drop < 0 ? "down" : drop > 0 ? "up" : "flat") + '">' +
            (drop === 0 ? "unchanged" : (drop > 0 ? "+" : "") + drop + " points") +
            " across " + scoredHistory.length + " scored visit" + (scoredHistory.length === 1 ? "" : "s") +
            " since " + ui.shortDate(first.date) +
          '</span>' +
          /* Said out loud rather than left as a discrepancy between the chart
             and the table below it. */
          (unscoredCount
            ? '<span class="trend-hero-note">' + unscoredCount + " further visit" +
              (unscoredCount === 1 ? " is" : "s are") + " on record with no score, and " +
              (unscoredCount === 1 ? "is" : "are") + " not plotted.</span>"
            : "") +
        '</div>' +
        sparkChart(scoreSeries, { width: 300, height: 104 }) +
      '</div>' +
      (measures.length
        ? '<div class="trend-grid">' + measures.map(function (m) { return sparkChart(m); }).join("") + '</div>'
        : "") +
      table;
  }


  /* ---------------------------------------------------------------------
   * Longevity
   *
   * Wilson sold most of these appliances to these customers. The default
   * posture is therefore keeping the appliance alive, and replacement is never
   * offered as a parallel option to compare against -- see the guard in
   * lifecycle-advice.js. This page shows where the appliance stands and what
   * would extend it, and invents no costs.
   * ------------------------------------------------------------------- */
  function longevitySection(currentReport) {
    if (!window.WILSON_LIFECYCLE) return "";
    const decline = window.WILSON_TRENDS ? window.WILSON_TRENDS.forAsset(state, currentReport.assetId) : null;
    const a = window.WILSON_LIFECYCLE.assess(currentReport, decline);
    /* Its own class: "no history to trend yet" and "no age on record" are
       different facts and a test that cannot tell them apart is not a test. */
    /* Its own class per fact: "no history to trend yet", "no age on record" and
       "no expected life for this category" are three different things, and a
       page that renders one message for all three is telling the customer
       something it does not know. */
    if (!a) return '<div class="longevity-empty"><strong>Lifecycle detail not recorded</strong><span>Approximate age and product tier are captured during the field inspection; this appliance predates that record.</span></div>';
    if (a.unavailable) {
      return '<div class="longevity-empty"><strong>' +
        (a.reason === "no-age" ? "Age not established" : "No expected-life figure for this category") + '</strong><span>' +
        (a.reason === "no-age"
          ? 'No install date is on record for this appliance and none could be established at the visit, so no lifecycle figure is shown and none was applied to the score. The score above is measured condition alone. If you have the purchase paperwork, sending it to us puts a documented age on the record.'
          : 'Wilson has not published an expected service life for this appliance category yet. The score above is measured condition alone.') +
        '</span></div>';
    }

    const pct = a.lifeUsedPct;
    return '<div class="longevity">' +
      '<div class="longevity-posture tone-' + a.posture.tone + '">' +
        '<span class="longevity-badge">' + ui.escapeHtml(a.posture.label) + '</span>' +
        '<p>' + ui.escapeHtml(a.posture.lead) + '</p>' +
      '</div>' +

      '<div class="longevity-life">' +
        '<div class="longevity-life-head">' +
          '<span class="trend-hero-label">Expected service life</span>' +
          '<strong>' + a.age + ' of ' + a.expectedYears + ' years</strong>' +
          '<span class="longevity-remaining">' + a.remainingYears + ' years remaining on the draft estimate</span>' +
          /* WHERE THE ESTIMATE ITSELF COMES FROM.
             This read "remaining on the luxury-tier estimate", and the tier
             stopped choosing the number in v0.9.30 -- Wilson's own brand and
             product-line table does, wherever it has a row. Saying which it was
             is the difference between an icemaker's 11 years and a dishwasher's
             15 printing with identical authority and printing honestly. */
          '<span class="longevity-life-basis">' + ui.escapeHtml(expectedLifeSentence("customer")) + '</span>' +
          /* Where the age itself came from. A lifecycle figure is only as good
             as the age under it, and the customer is entitled to know whether
             that age is off a document or off somebody's recollection. */
          '<span class="longevity-age-source' + (a.ageDocumented ? ' documented' : '') + '">' +
            (a.ageDocumented
              ? 'Age from the Wilson invoice that sold this appliance' +
                (a.installYear ? ' \u2014 installed ' + a.installYear : '') +
                (a.ageSourceRef ? ' (' + ui.escapeHtml(a.ageSourceRef) + ')' : '')
              : (a.ageSource === "customer"
                  ? 'Age as stated by the customer, not verified against a document'
                  : 'Age estimated by the technician at the visit, not verified against a document')) +
          '</span>' +
        '</div>' +
        '<div class="life-meter" role="img" aria-label="' + pct + ' percent of expected service life used">' +
          '<div class="life-meter-fill" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="life-meter-scale"><span>New</span><span>' + pct + '% used</span><span>' + a.expectedYears + ' yrs</span></div>' +
      '</div>' +

      (a.actions.length
        ? '<div class="longevity-actions">' +
            '<h3>What extends this appliance</h3>' +
            '<ul>' + a.actions.map(function (act) {
              return '<li><strong>' + ui.escapeHtml(act.label) + '</strong><span>' + ui.escapeHtml(act.detail) + '</span></li>';
            }).join("") + '</ul>' +
            /* These come from trend signals, which that module is explicit
               about NOT being diagnoses: "this reading is moving the wrong
               way, go look", never "the compressor is failing". Saying the
               cause is known was claiming a diagnosis nobody made. */
            '<p class="longevity-note">Each of these is a measured reading that has moved, and each is something a technician can investigate at a maintenance visit. Nothing here indicates the appliance needs replacing.</p>' +
          '</div>'
        : '<div class="longevity-actions"><h3>What extends this appliance</h3>' +
          '<p class="longevity-note">Nothing is currently drifting. Staying on the maintenance interval is what keeps this appliance on its expected life.</p></div>') +

      /* This said the figure came "from the appliance category and product
         tier", which stopped being how it is chosen in v0.9.30 and is now
         stated per appliance above. What belongs here is the part that is true
         of every one of them: it is a draft, not a warranty. */
      '<p class="longevity-basis">Expected life is a draft estimate, not a manufacturer warranty, and it is a figure we keep revising as we service more of these. ' +
        'Wilson does not recommend replacing an appliance that has remaining expected life and an identified, serviceable cause.</p>' +
    '</div>';
  }

  /* ---------------------------------------------------------------------
   * REFRIGERATION GUARDIAN, ON THE HEALTH REPORT.               (v0.9.40)
   *
   * Cayden: "im hoping that we can incorporate the sensor readings for
   * enrolld customers directly into the health reports... the temp data
   * logged there should be pulled from the backend temp hub instead of a tech
   * in the field taking a separate readout."
   *
   * Only rendered for an appliance enrolled in Guardian. The series and the
   * stats come from the SAME resolver the hub uses (WILSON_TEMPWATCH_SIM
   * .forAsset), so the report and the hub cannot chart different data for the
   * same machine. In the prototype the readings are simulated and the sheet
   * says so; in production the block renders from the ingested UbiBot feed
   * through this same shape.
   * ------------------------------------------------------------------- */
  function guardianSpark(points, rule) {
    const w = 640, h = 150, padL = 36, padR = 10, padT = 10, padB = 20;
    const values = points.map(function (p) { return p.value; });
    let min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (rule && rule.maxF !== undefined) { min = Math.min(min, rule.maxF - 2); max = Math.max(max, rule.maxF + 2); }
    /* v0.9.47: the dispatch line joins the chart whenever the trace gets
       near it, so the customer sees BOTH tiers -- the same two dashed lines
       the office's hub draws. */
    if (rule && rule.dispatchF !== undefined && max > rule.dispatchF - 3) { max = Math.max(max, rule.dispatchF + 2); }
    const span = Math.max(1, max - min);
    const x = function (i) { return padL + (i / (points.length - 1)) * (w - padL - padR); };
    const y = function (v) { return padT + (1 - (v - min) / span) * (h - padT - padB); };
    const line = points.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.value).toFixed(1); }).join(" ");
    const limitY = rule && rule.maxF !== undefined ? y(rule.maxF) : null;
    const dispatchY = rule && rule.dispatchF !== undefined && max >= rule.dispatchF ? y(rule.dispatchF) : null;
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="guardian-chart" role="img" aria-label="48-hour temperature trace from the Guardian sensor">' +
      (limitY !== null
        ? '<rect x="' + padL + '" y="' + limitY.toFixed(1) + '" width="' + (w - padL - padR) + '" height="' + Math.max(0, h - padB - limitY).toFixed(1) + '" fill="' + BAND + '"></rect>' +
          '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + limitY.toFixed(1) + '" y2="' + limitY.toFixed(1) + '" stroke="#c9b98a" stroke-dasharray="4 3"></line>' +
          '<text x="' + (padL - 5) + '" y="' + (limitY + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#8a6a2f">' + rule.maxF + '°F</text>'
        : "") +
      (dispatchY !== null
        ? '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + dispatchY.toFixed(1) + '" y2="' + dispatchY.toFixed(1) + '" stroke="#c98a8a" stroke-dasharray="2 3"></line>' +
          '<text x="' + (padL - 5) + '" y="' + (dispatchY + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#a04747">' + rule.dispatchF + '°F</text>'
        : "") +
      '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + (h - padB) + '" y2="' + (h - padB) + '" stroke="' + GRID + '"></line>' +
      '<path d="' + line + '" fill="none" stroke="' + SERIES + '" stroke-width="1.8"></path>' +
      '<circle cx="' + x(points.length - 1).toFixed(1) + '" cy="' + y(points[points.length - 1].value).toFixed(1) + '" r="3.5" fill="' + SERIES + '"></circle>' +
      '<text x="' + padL + '" y="' + (h - 5) + '" font-size="10" fill="' + MUTED + '">48h ago</text>' +
      '<text x="' + (w - padR) + '" y="' + (h - 5) + '" text-anchor="end" font-size="10" fill="' + MUTED + '">report time</text>' +
      '</svg>';
  }

  /* One sensor's chart-and-stats block. Since v0.9.47 a Guardian appliance
     can watch several compartments -- a column's fresh-food and freezer
     probes each get their own block, judged by their own rule. */
  function guardianSensorBlock(row, named) {
    const s = row.stats;
    const latest = row.points[row.points.length - 1];
    const rule = row.flag.rule || {};
    return `
      ${named ? `<h3 class="guardian-compartment-head">${ui.escapeHtml(row.compartmentLabel || row.compartment)} sensor</h3>` : ""}
      ${guardianSpark(row.points, rule)}
      <div class="report-info-cards guardian-stats">
        <div><span>Now</span><strong>${latest ? latest.value : "–"}°F</strong></div>
        <div><span>48-hour average</span><strong>${s ? s.avg : "–"}°F</strong></div>
        <div><span>Range</span><strong>${s ? s.min + "–" + s.max + "°F" : "–"}</strong></div>
        <div><span>Time in band</span><strong>${s && s.inBandPct !== null ? s.inBandPct + "%" : "–"}</strong></div>
        <div><span>Excursions</span><strong>${s && s.excursions !== null ? s.excursions : "–"}</strong></div>
        <div><span>Longest excursion</span><strong>${s && s.longestExcursionMinutes ? Math.round(s.longestExcursionMinutes) + " min" : "None"}</strong></div>
      </div>
      ${row.flag.flagged
        ? `<p class="report-sec-note">This compartment is currently over its safe band and has been for ${Math.round(row.flag.overForMinutes / 60 * 10) / 10} hours. Wilson's monitoring desk sees the same picture and dispatches on it — a sustained flag is a phone call, not an email.</p>`
        : ""}
      <p class="report-sec-note">${rule.label ? "Wilson looks closely when this compartment runs " + ui.escapeHtml(rule.label).toLowerCase() : ""}${rule.dispatchLabel ? "; a priority dispatch opens when it runs " + ui.escapeHtml(rule.dispatchLabel).toLowerCase() + "." : "."}</p>`;
  }

  function guardianSection() {
    const tm = window.WILSON_CONFIG.tempMonitoring || {};
    /* v0.9.48: a report generated since the snapshot fix carries its OWN
       Guardian data -- what the sensor saw at report time -- so reprints are
       stable and the page survives the appliance later leaving the plan.
       Older records without a snapshot fall back to the live resolver, gated
       on current enrollment exactly as before. */
    let rows = Array.isArray(report.guardian) && report.guardian.length ? report.guardian : null;
    if (!rows) {
      const SIM = window.WILSON_TEMPWATCH_SIM;
      const currentAsset = state.assets.find(function (item) { return item.id === report.assetId; });
      if (!SIM || !currentAsset || !currentAsset.tempMonitoringOptIn) return "";
      const householdRecord = state.households.find(function (h) { return h.id === report.householdId; }) || null;
      rows = SIM.forAssetSensors
        ? SIM.forAssetSensors(currentAsset, householdRecord)
        : [SIM.forAsset(currentAsset, householdRecord)];
    }
    if (!rows || !rows.length) return "";
    return `
      <p class="guardian-lede">This appliance carries ${rows.length === 1 ? "a " + ui.escapeHtml(tm.serviceName || "Refrigeration Guardian") + " sensor" : rows.length + " " + ui.escapeHtml(tm.serviceName || "Refrigeration Guardian") + " sensors — one per compartment —"} reporting its temperature around the clock. The figures below come from ${rows.length === 1 ? "that sensor" : "those sensors"} — the 48 hours leading up to this report — not from a one-off reading taken at the visit. <em>Prototype note: these readings are simulated.</em></p>
      ${rows.map(function (row) { return guardianSensorBlock(row, rows.length > 1); }).join("")}
      <p class="report-sec-note">An excursion is a stretch of readings above the safe band — a door held open makes a short one, and that is normal life, not a fault. What Wilson watches for is the excursion that does not end. These thresholds never change this report's health score — the score is what the technician measured; this page is what the sensor saw.</p>`;
  }

  function render() {
    const host = document.getElementById("report-sheet");
    if (!report) {
      host.innerHTML = `<div class="empty-state"><strong>${requestedReportId ? "That report could not be found." : "No report was selected."}</strong><p>${requestedReportId ? "It may have been regenerated under a new revision. Open the household record and choose the report from its history." : "Open a health report from the household record or the Health panel. This page will not guess which report you meant."}</p></div>`;
      return;
    }

    const household = state.households.find((item) => item.id === report.householdId);
    const asset = state.assets.find((item) => item.id === report.assetId);

    /*
     * An appliance report is one machine out of a stop. When the same visit
     * produced others, offer the way back up to the compiled review -- without
     * it the two artifacts only ever link downward and a customer who opens one
     * appliance has no route to the rest of their house.
     */
    const siblingCount = report.visitId
      ? (state.reports || []).filter((item) => item.visitId === report.visitId).length
      : 0;
    const visitLink = document.getElementById("visit-review-link");
    if (visitLink) {
      if (siblingCount > 1) {
        visitLink.href = "visit-report.html?visit=" + encodeURIComponent(report.visitId);
        visitLink.textContent = "Whole-visit review (" + siblingCount + " appliances)";
        visitLink.hidden = false;
      } else {
        visitLink.hidden = true;
      }
    }
    const groups = groupedCheckpoints();
    const losses = scoreLosses();
    const measured = report.measurements || [];
    /* Whether this appliance has anything to be compared with. Resolved once
       so the readings sheet and the History sheet cannot disagree about it. */
    const hasPriorVisits = historyFor(report).length > 1;
    const grade = report.grade || "–";

    const address = household ? [household.address1, household.address2, household.city, household.state, household.zip].filter(Boolean).join(", ") : "";

    const cover = `
      <section class="report-page report-cover-page">
        <div class="report-cover-shape"></div>
        <div class="report-cover-brand"><img src="assets/logo-black.png" alt="Wilson AC & Appliance"></div>
        <div class="report-cover-title"><span>Wilson Estate Care</span><h1>Appliance Health Report</h1><p>${ui.escapeHtml(report.applianceLabel)}</p></div>
        <div class="report-cover-score"><span>${scoreAvailable ? "Your appliance score" : "Condition score"}</span><strong>${ui.escapeHtml(scoreValue())}</strong><em>${scoreAvailable ? ui.escapeHtml(grade) + " · " + ui.escapeHtml(report.condition || "Not graded") : "See inside for what was measured"}</em>${scoreAvailable && scoreParts() ? `<b class="report-cover-parts">${ui.escapeHtml(scoreParts())}</b>` : ""}</div>
        <div class="report-cover-details">
          <div><span>Household</span><strong>${ui.escapeHtml(household ? household.name : "Household")}</strong></div>
          <div><span>Service address</span><strong>${ui.escapeHtml(address || "Not recorded")}</strong></div>
          <div><span>Date of service</span><strong>${ui.shortDate(report.inspectionDate)}</strong></div>
          <div><span>Technician</span><strong>${ui.escapeHtml(report.technician || "Not recorded")}</strong></div>
        </div>
        <footer class="report-cover-footer">Wilson AC & Appliance · Trusted since 1949</footer>
      </section>
    `;

    /*
     * THE NAMEPLATE, ON THE REPORT THAT KEEPS CITING IT.        (v0.9.37)
     *
     * The HVAC score paragraph told the customer "the efficiency rating is
     * printed on this report as a fact and is not part of the number" -- and
     * nothing on any page printed it. The rating is captured in the field and
     * lives on the appliance's design profile; the report simply never read it.
     * The claim is a good one and the guardrail behind it is real, so the fix
     * is to make the sentence true rather than to delete it.
     *
     * Every row here is `plate: true` in the config and `scores: null` where
     * the figure is reported and never scored -- the report says which is
     * which, because "we measured this against it" and "we are telling you
     * what it says" are different claims.
     */
    const nameplateBody = (function () {
      const design = (asset || {}).design;
      const fields = ((window.WILSON_CONFIG.hvacDesignProfile || [])
        .filter(function (f) { return f.plate; }));
      if (!design || !fields.length) return "";
      const rows = fields
        .map(function (f) {
          const raw = design[f.key];
          if (raw === null || raw === undefined || String(raw).trim() === "") return null;
          return { label: f.label, value: String(raw) + (f.unit ? " " + f.unit : ""), scored: Boolean(f.scores) };
        })
        .filter(Boolean);
      if (!rows.length) return "";
      return `
        <section class="report-nameplate">
          <h3>What this equipment was built to do</h3>
          <p class="report-sec-note">Read from the equipment's own nameplate. The figures marked <em>measured against</em> are what this visit's readings were compared with. The rest are stated here as facts about the equipment and are not part of the score &mdash; equipment meeting its own rating is performing correctly, whatever that rating is.</p>
          <dl class="nameplate-grid">
            ${rows.map(function (r) {
              return `<div><dt>${ui.escapeHtml(r.label)}</dt><dd>${ui.escapeHtml(r.value)}<span class="nameplate-role">${r.scored ? "measured against" : "reported, not scored"}</span></dd></div>`;
            }).join("")}
          </dl>
        </section>`;
    })();

    const vitalsBody = `
      ${nameplateBody}
      <div class="report-intro-grid">
        <div><h3>What are appliance vitals?</h3><p>Vitals are the useful readings and functional observations recorded during this maintenance visit. They help show whether the appliance was operating within the target used by the technician and identify areas that should be monitored or corrected.</p></div>
        <div class="report-score-panel"><span>${scoreAvailable ? "Your appliance score" : "Condition score"}</span><strong>${ui.escapeHtml(scoreValue())}${scoreAvailable ? " " + ui.escapeHtml(grade) : ""}</strong><small>${scoreAvailable ? ui.escapeHtml([report.condition || "Not graded", scoreParts()].filter(Boolean).join(" · ")) : ui.escapeHtml(scoreNote())}</small></div>
      </div>
      <div class="vitals-grid">
        ${measured.length ? measured.map(function (item) {
          return `<article class="vital-card ${statusClass(item.result)}"><div class="vital-card-top"><strong>${ui.escapeHtml(item.label)}</strong>${badge(item.result)}</div><div class="vital-value">${ui.escapeHtml(item.observed || "Not recorded")} ${ui.escapeHtml(item.unit || "")}</div><div class="vital-target"><span>Target / normal</span><strong>${ui.escapeHtml(item.target || "Technician-defined")}</strong></div>${item.notes ? `<p>${ui.escapeHtml(item.notes)}</p>` : ""}</article>`;
        }).join("") : `<div class="report-empty">No measurements were recorded.</div>`}
      </div>
      <div class="report-diagnostic-strip"><strong>Visit overview</strong><span>${ui.escapeHtml(conditionStatement())}</span></div>
    `;

    const breakdownBody = `
      <div class="report-score-explanation"><h3>How this score was calculated</h3><p>${scoreExplanation()}</p></div>
      <div class="loss-list">
        ${losses.length ? losses.map((item) => `<div class="loss-row${item.isAge ? " loss-row-age" : ""}"><div><strong>${ui.escapeHtml(item.category)}</strong><p>${ui.escapeHtml(item.explanation || "Recorded checkpoint deduction.")}</p></div><span>-${Number(item.loss || 0).toFixed(Number(item.loss || 0) % 1 ? 1 : 0)}</span></div>`).join("") : `<div class="loss-row no-loss"><div><strong>No point deductions</strong><p>Every applicable checkpoint scored full marks, and the appliance is early enough in its expected life that no age points came off.</p></div><span>0</span></div>`}
      </div>
      ${losses.length ? `<div class="loss-total"><span>100 &minus; ${Number(losses.total).toFixed(Number(losses.total) % 1 ? 1 : 0)} deducted</span><strong>${Math.round(100 - Number(losses.total))}</strong></div>` : ""}
      <div class="final-score-band"><div><strong>${scoreAvailable ? "Your appliance score" : "No score published"}</strong><p>${ui.escapeHtml(scoreAvailable ? (report.summary || "") : scoreNote())}</p></div><span>${ui.escapeHtml(scoreValue())}${scoreAvailable ? " " + ui.escapeHtml(grade) : ""}</span></div>
    `;

    const detailsBody = `
      <div class="report-detail-columns">
        <section><h3>Equipment information</h3><dl class="report-definition-list">
          <div><dt>Appliance type</dt><dd>${ui.escapeHtml(asset ? asset.typeLabel : report.applianceLabel)}</dd></div>
          <div><dt>Brand</dt><dd>${ui.escapeHtml(asset && asset.brand ? asset.brand : "Not recorded")}</dd></div>
          <div><dt>Model</dt><dd>${ui.escapeHtml(asset && asset.model ? asset.model : "Not recorded")}</dd></div>
          <div><dt>Serial</dt><dd>${ui.escapeHtml(asset && asset.serial ? asset.serial : "Not recorded")}</dd></div>
          <div><dt>Location</dt><dd>${ui.escapeHtml(asset && asset.location ? asset.location : "Not recorded")}${environmentTag(asset)}</dd></div>
          <div><dt>Next maintenance</dt><dd>${ui.shortDate(report.nextDueOn)}</dd></div>${report.lifecycle ? `<div><dt>Age</dt><dd>${ageFactLine()}</dd></div><div><dt>Draft expected life</dt><dd>${Number(report.lifecycle.expectedYears||0) || "&mdash;"} yr${expectedLifeBadge()}</dd></div><div><dt>Lifecycle stage</dt><dd>${ui.escapeHtml(report.lifecycle.stage||"Not established")}</dd></div>` : ""}
        </dl></section>
        <section><h3>Visit information</h3><dl class="report-definition-list">
          <div><dt>Household</dt><dd>${ui.escapeHtml(household ? household.name : "Not recorded")}</dd></div>
          <div><dt>Technician</dt><dd>${ui.escapeHtml(report.technician || "Not recorded")}</dd></div>
          <div><dt>Service date</dt><dd>${ui.shortDate(report.inspectionDate)}</dd></div>
          <div><dt>Service reference</dt><dd>${ui.escapeHtml(report.reference || "Not linked")}</dd></div>
          <div><dt>Report score</dt><dd>${ui.escapeHtml(scoreValue())}${scoreAvailable ? " " + ui.escapeHtml(grade) : ""}</dd></div>
          <!-- "Final" was hard-coded with no status field behind it, and a
               report can be regenerated (the activity log says "refreshed"),
               so the word was not even true. The date and the source are on
               the record and are what a customer can act on. -->
          <div><dt>Report issued</dt><dd>${ui.shortDate(report.createdAt || report.inspectionDate)} · ${ui.escapeHtml(report.source || "Wilson")}</dd></div>
        </dl></section>
      </div>
      <h3 class="report-subheading">Subsystem review</h3>
      <div class="subsystem-groups" data-flow>
        ${Object.keys(groups).map(function (category) {
          const items = groups[category];
          const worst = items.some((item) => item.status === "Fail" || item.status === "Action") ? "Fail"
            : items.some((item) => item.status === "Cause for concern" || item.status === "Watch") ? "Cause for concern" : "Pass";
          return `<section class="subsystem-group"><div class="subsystem-heading"><strong>${ui.escapeHtml(category)}</strong>${badge(worst)}</div>${items.map((item) => `<div class="subsystem-item"><div><strong>${ui.escapeHtml(item.name)}</strong><p>${ui.escapeHtml(item.notes || "No additional note.")}</p></div><span>${badge(item.status)} <em>${Number(item.rating || 0)}/5</em></span></div>`).join("")}</section>`;
        }).join("")}
      </div>
    `;

    /* ---------------------------------------------------------------------
       THREE SECTIONS, NOT ONE LIST  (v0.9.17)

       Measured performance, then what Wilson did, then what the technician
       observed. Separating them is what stops a cleaned condenser reading as
       appliance health -- and it is what lets the headline be a COUNT a
       customer can verify rather than a percentage they have to trust.
       ------------------------------------------------------------------ */
    const measuredTally = report.measuredCount || null;
    const conditionTally = report.conditionCount || null;
    const performed = report.maintenancePerformed || [];
    const observations = report.observations || [];
    const codes = report.storedCodes || [];
    const trends = report.trendReadings || [];

    const threeSections = `
      <div class="report-three">
        <section class="report-sec report-sec-measured">
          <h3>Performance checks</h3>
          ${measuredTally && measuredTally.total
            ? `<p class="report-headline-count"><strong>${measuredTally.inside} of ${measuredTally.total}</strong> measured checks were inside the target used at this visit.</p>`
              + (conditionTally && conditionTally.total
                  ? `<p class="report-headline-count second"><strong>${conditionTally.normal} of ${conditionTally.total}</strong> conditions checked by eye were normal. Those are listed below with what each one was worth.</p>`
                  : "")
            : `<p class="report-empty-line">No measured checks applied to this appliance.</p>`}
          ${trends.length ? `<ul class="report-trend-list">${trends.map(function (t) {
              /* A measurement of two things prints as two things plus the
                 difference. An oven set to 350 that measured 327 says so; the
                 old single-value row could only ever show one of the numbers,
                 and after they became named fields it showed neither. */
              const values = (t.values && t.values.length)
                ? t.values.map(function (v) {
                    return `<span class="report-trend-value"><em>${ui.escapeHtml(v.label)}</em>${ui.escapeHtml(v.value)}${ui.escapeHtml(v.unit ? " " + v.unit : "")}</span>`;
                  }).join("")
                : `<span class="report-trend-value">${ui.escapeHtml(t.value)}${ui.escapeHtml(t.unit ? " " + t.unit : "")}</span>`;
              const derived = t.derived
                ? `<span class="report-trend-derived"><em>${ui.escapeHtml(t.derived.label)}</em>${t.derived.value > 0 ? "+" : ""}${ui.escapeHtml(String(t.derived.value))}${ui.escapeHtml(t.derived.unit ? " " + t.derived.unit : "")}</span>`
                : "";
              /* On a FIRST visit there is no history to compare against, and
                 saying there is contradicts the History page two sheets later,
                 which correctly reads "First recorded visit". The reason these
                 readings are unscored is the same either way -- no agreed band
                 -- so that is what a first visit says. */
              const basis = hasPriorVisits
                ? "Recorded &mdash; compared against this appliance's own history rather than a band nobody has agreed yet"
                : "Recorded &mdash; no agreed band for this reading yet, and this is the first visit, so there is nothing to compare it with. It becomes a trend from the next one.";
              return `<li><strong>${ui.escapeHtml(t.name)}</strong><div class="report-trend-values">${values}${derived}</div><em class="report-trend-basis">${basis}</em>${t.note ? `<p>${ui.escapeHtml(t.note)}</p>` : ""}</li>`;
            }).join("")}</ul>` : ""}
          ${codes.length ? `<div class="report-codes">
              <h4>Stored fault codes read at this visit</h4>
              <ul>${codes.map(function (c) {
                return `<li><strong>${ui.escapeHtml(c.code)}</strong><span>${ui.escapeHtml(c.name)}</span></li>`;
              }).join("")}</ul>
              <p class="report-sec-note">A stored code is a record the appliance kept of something that happened, not necessarily a fault present today. It is printed here so whoever works on this appliance next does not have to find it again.</p>
            </div>` : ""}
        </section>

        <section class="report-sec report-sec-performed">
          <h3>Maintenance completed</h3>
          ${performed.length
            ? `<ul class="report-did-list">${performed.map(function (item) {
                return `<li>${ui.escapeHtml(item)}</li>`;
              }).join("")}</ul>
               <p class="report-sec-note">This is the work carried out at this visit. None of it changes the health score above &mdash; cleaning a condenser is what your money bought, not a measurement of how the appliance is doing.</p>`
            : `<p class="report-empty-line">No maintenance items were recorded for this appliance at this visit.</p>`}
        </section>

        <section class="report-sec report-sec-observed">
          <h3>Conditions checked by eye</h3>
          ${observations.length
            ? `<ul class="report-obs-list">${observations.map(function (o) {
                /* The flagged ones read as flagged. As of v0.9.19 a condition
                   also carries a score, so the value it was worth is printed
                   beside it -- a customer can add the column up. */
                const worth = (o.score === null || o.score === undefined)
                  ? "Not scored"
                  : `${o.score} of 5`;
                return `<li class="${o.attention ? "obs-attention" : ""}"><strong>${ui.escapeHtml(o.name)}</strong><span>${ui.escapeHtml(o.selection)}</span><em class="obs-worth">${ui.escapeHtml(worth)}</em>${o.result ? `<em>${ui.escapeHtml(o.result)}</em>` : ""}${o.note ? `<p>${ui.escapeHtml(o.note)}</p>` : ""}</li>`;
              }).join("")}</ul>
               <p class="report-sec-note">These are conditions your technician looked at and matched to a named description rather than measured with an instrument. Each description carries a fixed value, set in advance and the same on every visit and every appliance, so this part of the score does not depend on who was standing there. Ask us for the scale and we will send it &mdash; it is not yet printed anywhere public. Nothing here is reduced for cosmetic wear, or for how the appliance looked before it was cleaned.</p>`
            : `<p class="report-empty-line">No separate observations were recorded.</p>`}
        </section>
      </div>
    `;

    /*
     * THE HOUSE'S WATER, in the customer's words.
     *
     * Written only when it changed something, or when it was tested and did
     * not -- an untested house says nothing here rather than implying its water
     * is fine. The reversibility is the point of the last sentence: this is an
     * adjustment the customer can remove, and telling them so is the difference
     * between a finding and a scare.
     */
    const waterBlock = (function () {
      const w = report.lifecycle && report.lifecycle.water;
      if (!w || !w.tested || !w.waterBearing) return "";
      const band = ui.escapeHtml(String(w.band || "").toLowerCase());
      const figure = `<span class="report-water-figure">${ui.escapeHtml(String(w.gpg))} gpg</span>`;
      /*
       * THE FLAG. Cayden: "There can be a flag that notifies the customer of the
       * hardness in the report."
       *
       * It sits above the explanation and only from "hard" upward, because that
       * is the point at which there is something the customer could actually do
       * about it. Flagging moderately hard water would be flagging the Austin
       * city supply at every address Wilson serves, which teaches people to
       * ignore the flag.
       */
      const flag = w.flagged
        ? `<div class="report-water-flag"><span class="report-water-flag-mark">!</span>
            <div><strong>Your water tested ${figure} &mdash; ${band}.</strong>
            <span>Hard water leaves scale on anything that heats or holds it. This is a property of the
            supply to the whole house, not a fault with this appliance, and softening the water removes
            its effect entirely.</span></div></div>`
        : "";
      if (!w.applied) {
        return `<div class="report-water">${flag}<h4>Water at this address</h4>
          <p>The supply tested ${figure} (${band}). At this hardness Wilson makes no adjustment to
          expected service life.</p></div>`;
      }
      return `<div class="report-water">${flag}<h4>Water at this address</h4>
        <p>The supply tested ${figure} (${band}).
        Scale shortens the life of equipment that runs water, so this appliance's expected service life
        is shown as <span class="report-water-figure">${w.adjustedYears} years</span> here rather than
        the <span class="report-water-figure">${w.baseYears} years</span> Wilson would expect on soft
        water. This affects the expected-life part of the score only &mdash; never what
        the technician measured today &mdash; and softening the water removes it entirely.</p>
        <p style="margin-top:6px;font-size:11.5px;color:#5e6c63;">${ui.escapeHtml(w.basis)}</p></div>`;
    })();

    /*
     * ONE LIST, ONCE.   (v0.9.37)
     *
     * `recommendations` and `correctiveMeasures` are built from the same array
     * in store.js -- the flagged checks -- and were rendered side by side in two
     * columns under two different headings. A customer read the same words
     * twice, and the second heading called a checkpoint name "Wilson's
     * recommendation", which it is not.
     *
     * What is printed now is the finding, once, with what Wilson will do about
     * it stated separately and honestly: these items go on a repair order, and
     * this report is not that order.
     */
    const corrective = report.correctiveMeasures || [];
    /*
     * THE RETURN-VISIT COMMITMENT, IN WRITING.                  (v0.9.39)
     *
     * A technician who flags a check for a return visit has made the customer
     * a promise, and the report is where the customer should be able to read
     * it. Built from the checkpoints' own flags, never re-derived from
     * severity -- the flag is the technician's discretion and the report
     * repeats it rather than second-guessing it.
     */
    const followUps = (report.checkpoints || []).filter(function (c) { return c.followUp; });
    const correctiveBody = threeSections + waterBlock + `
      <div class="corrective-single">
        <section><h3>What needs attention</h3>${corrective.length
          ? `<ul class="corrective-list">${corrective.map((item) => `<li>${ui.escapeHtml(item)}</li>`).join("")}</ul>
             <p class="corrective-next">These are the checks that did not pass at this visit, in the technician&rsquo;s words. Anything here is quoted and scheduled as a separate repair &mdash; a maintenance visit does not carry the parts or the time for it, and this report is not a repair order.</p>`
          : `<div class="report-ok-box">Nothing needed correcting at this visit.</div>`}</section>
        ${followUps.length ? `<section class="followup-commitment"><h3>Wilson is coming back for ${followUps.length === 1 ? "one of these" : followUps.length + " of these"}</h3>
          <ul class="corrective-list">${followUps.map((c) => `<li><strong>${ui.escapeHtml(c.name)}</strong>${c.notes ? " — " + ui.escapeHtml(c.notes) : ""}</li>`).join("")}</ul>
          <p class="corrective-next">Your technician flagged ${followUps.length === 1 ? "this item" : "these items"} for a dedicated return visit &mdash; work that needs more time or parts than a maintenance stop carries. Wilson&rsquo;s office will contact you with a quote and a time. Nothing is scheduled or charged without your approval.</p></section>` : ""}
      </div>
      <h3 class="report-subheading">Maintenance performed</h3>
      <div class="report-task-grid">${(report.tasks || []).map((task) => `<div><span>✓</span>${ui.escapeHtml(task)}</div>`).join("") || `<div><span>–</span>Inspection only; no maintenance task was recorded.</div>`}</div>
      <h3 class="report-subheading">Filters and consumables</h3>
      <div class="report-info-cards">
        <div><span>Part / size</span><strong>${ui.escapeHtml(report.filterPart || "Not applicable")}</strong></div>
        <div><span>Action</span><strong>${ui.escapeHtml(report.filterAction || "Not applicable")}</strong></div>
        <div><span>Photographs</span><strong>${photoList().length || "None"}</strong></div>
      </div>
    `;

    const informationBody = `
      <div class="report-information-copy">
        <section><h3>Appliance Health Score</h3><p>The Wilson Appliance Health Score summarizes the applicable inspection checkpoints entered by the technician. It is intended to make the condition of the appliance easier to understand and to show where deductions occurred. When age and product tier are available, lifecycle age is blended into the score as a planning signal. It is not a guarantee or prediction of the exact remaining life of the appliance.</p></section>
        <section><h3>Operating vitals</h3><p>Recorded temperatures, cycle observations, sealing checks, airflow conditions, water flow, drain performance, and other readings vary by appliance type. Targets shown in this report are entered by the technician for the specific equipment and test performed.</p></section>
        <section><h3>Subsystem review</h3><p>Subsystem categories group related components and functions, such as temperature performance, water systems, filtration, controls, airflow, drainage, connections, and safety. Each health check carries the technician's verdict. “Pass” means no action was identified from the recorded inspection. “Cause for concern” identifies an item that is working today but should be watched, with the technician's reason recorded beside it. “Fail” identifies an item that needs correction, addressed through a separate repair order — it never triggers work or charges without your approval.</p></section>
        <section><h3>Scope and limitations</h3><p>This report records visible conditions, accessible components, readings, and functional observations made during the maintenance visit. It is not a guarantee against future failure, and it does not replace manufacturer instructions, a repair diagnosis, code inspection, or destructive disassembly.</p></section>
      </div>
    `;

    const summaryBody = `
      <div class="service-summary-box"><span>Service summary</span><p>${ui.escapeHtml(report.serviceSummary || report.summary || "The technician did not record a service summary for this visit.")}</p></div>
      ${report.technicianNote ? `<div class="service-summary-box technician-note"><span>From your technician</span><p>${ui.escapeHtml(report.technicianNote)}</p><em>${ui.escapeHtml(report.technician || "Wilson technician")}, at the visit</em></div>` : ""}
      <div class="report-detail-columns service-final-grid">
        <section><h3>Technician condition summary</h3><p>${ui.escapeHtml(report.summary || "No summary entered.")}</p></section>
        <section><h3>Next planned interval</h3><p>${ui.shortDate(report.nextDueOn)}</p><p class="muted-copy">The office will use the maintenance dashboard to prompt scheduling and payment review at the appropriate interval.</p></section>
      </div>
      ${photoSection()}
      <div class="signature-grid"><div><span>Technician</span><strong>${ui.escapeHtml(report.technician || "")}</strong></div><div><span>Date</span><strong>${ui.shortDate(report.inspectionDate)}</strong></div><div><span>Report reference</span><strong>${ui.escapeHtml(report.reference || report.id)}</strong></div></div>
    `;

    const guardianBody = guardianSection();
    host.innerHTML = cover
      + reportPage("Appliance Vitals", report.applianceLabel, vitalsBody, "vitals-page")
      + reportPage("Score Breakdown", report.applianceLabel, breakdownBody, "breakdown-page")
      + reportPage("Inspection Details", report.applianceLabel, detailsBody, "details-page")
      + reportPage("Corrective Measures", report.applianceLabel, correctiveBody, "corrective-page")
      + reportPage("Report Information", report.applianceLabel, informationBody, "information-page")
      + reportPage("Service History", report.applianceLabel, historySection(report), "history-page")
      + (guardianBody ? reportPage(((window.WILSON_CONFIG.tempMonitoring || {}).serviceName || "Refrigeration Guardian"), report.applianceLabel, guardianBody, "guardian-page") : "")
      + reportPage("Longevity", report.applianceLabel, longevitySection(report), "longevity-page")
      + reportPage("Service Summary", report.applianceLabel, summaryBody, "summary-page");

    /*
     * Split any sheet the data has outgrown -- a long protocol on the subsystem
     * review, or a visit that produced a lot of photographs. Runs before the
     * images load: the photo frames hold their aspect-ratio box from the start,
     * so heights measured now are the final ones.
     */
    if (window.WILSON_PAGINATE) window.WILSON_PAGINATE.run(host);

    hydratePhotos();
  }

  document.getElementById("print-report").addEventListener("click", () => window.print());
  document.addEventListener("DOMContentLoaded", render);
})();

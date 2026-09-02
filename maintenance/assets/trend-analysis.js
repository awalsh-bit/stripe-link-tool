(function () {
  /*
   * Decline detection.
   *
   * The point of taking the same reading every spring is to catch a failure a
   * year before the customer does. That only pays off if something goes looking
   * -- otherwise a condenser split that has climbed 8°F is visible only to
   * whoever happens to open that appliance's report, which is nobody.
   *
   * WHAT THIS DELIBERATELY IS NOT
   * -----------------------------
   * It is not a diagnosis. It says "this reading is moving the wrong way, go
   * look", never "the compressor is failing". Every signal carries the numbers
   * that produced it so a technician can disagree with it.
   *
   * FALSE POSITIVES ARE THE REAL RISK
   * ---------------------------------
   * A flag nobody trusts is worse than no flag: the office learns to dismiss
   * the list and the whole feature becomes noise. So the thresholds below are
   * deliberately conservative, slope signals need three visits rather than two,
   * and a reading has to move by more than its own rounding to count at all.
   *
   * One implementation, shared by the dashboard, the household record and the
   * report. Two implementations of "declining" would drift apart the way the
   * protocol resolution did before v0.9.1.
   */

  const RULES = {
    /* A score drop this size over the whole history is worth a look regardless
       of how many visits it took. Roughly a full grade band. */
    scoreDropTotal: 10,

    /* Sustained decline: this many points per year, needing at least three
       visits so a single bad visit cannot trigger it. */
    scoreDropPerYear: 4,
    minVisitsForSlope: 3,

    /* A reading has to move more than this to count as movement at all --
       below it we are reading rounding, not drift. */
    minMeaningfulMove: 1,

    /* How many future visits' worth of drift we project when asking "is this
       heading out of range". Two intervals is about as far as a straight-line
       projection from three points can honestly reach. */
    projectVisits: 2,
  };

  const SEVERITY = { out: 3, projected: 2, score: 1 };

  function numeric(value) {
    const n = parseFloat(String(value === undefined || value === null ? "" : value).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  /* "15-30°F above ambient" / "120-150°F" -> {min,max}. Unparseable targets
     simply produce no band, and a reading with no band can still contribute a
     score signal but never an out-of-range one. */
  function parseBand(text) {
    const m = String(text || "").match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const min = parseFloat(m[1]), max = parseFloat(m[2]);
    return max > min ? { min: min, max: max } : null;
  }

  /* Signal detail is read by customers as well as by the office, so a date in
     it is written the way a person says it, not the way it is stored. */
  function monthYear(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return String(iso || "");
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }

  function yearsBetween(aIso, bIso) {
    const a = new Date(aIso).getTime(), b = new Date(bIso).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.abs(b - a) / (365.25 * 24 * 3600 * 1000);
  }

  /* Least-squares slope in units per year. Used instead of first-to-last so one
     anomalous visit does not define the trend. */
  function slopePerYear(points) {
    if (points.length < 2) return 0;
    const t0 = new Date(points[0].date).getTime();
    const xs = points.map(function (p) { return (new Date(p.date).getTime() - t0) / (365.25 * 24 * 3600 * 1000); });
    const ys = points.map(function (p) { return p.value; });
    const n = xs.length;
    const mx = xs.reduce(function (a, b) { return a + b; }, 0) / n;
    const my = ys.reduce(function (a, b) { return a + b; }, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i += 1) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
    return den === 0 ? 0 : num / den;
  }

  /* Group a single appliance's reports into one series per measurement label. */
  function seriesFor(history) {
    const byLabel = {};
    history.forEach(function (report) {
      (report.measurements || []).forEach(function (m) {
        const value = numeric(m.observed);
        if (value === null) return;
        /* A set point is what the customer asked for, not how the appliance is
           performing. It must never itself be read as decline. */
        if (/set ?point/i.test(m.label)) {
          byLabel["__setpoint__" + m.label] = { setpoint: true, label: m.label, value: value };
          return;
        }
        if (!byLabel[m.label]) byLabel[m.label] = { label: m.label, unit: m.unit || "", band: parseBand(m.target), points: [] };
        byLabel[m.label].points.push({ date: report.inspectionDate, value: value });
      });
    });

    /* Attach a compartment's set point as its band, so "3°F above where the
       customer set it" is detectable even though no printed target exists. */
    Object.keys(byLabel).forEach(function (key) {
      const entry = byLabel[key];
      if (!entry.setpoint) return;
      const owner = Object.keys(byLabel).find(function (other) {
        const o = byLabel[other];
        return !o.setpoint && entry.label.toLowerCase().indexOf(o.label.toLowerCase().split(" ")[0]) === 0;
      });
      if (owner && !byLabel[owner].band) {
        byLabel[owner].band = { min: entry.value - 2, max: entry.value + 2, derived: true, setpoint: entry.value };
      }
      delete byLabel[key];
    });

    return Object.keys(byLabel).map(function (k) { return byLabel[k]; });
  }

  /*
   * Signals for one appliance.
   * Returns { assetId, appliance, householdId, visits, severity, signals: [...] }
   * or null when there is nothing to say.
   */
  function analyseAppliance(history) {
    if (!history || history.length < 2) return null;
    const ordered = history.slice().sort(function (a, b) {
      return String(a.inspectionDate).localeCompare(String(b.inspectionDate));
    });
    const latest = ordered[ordered.length - 1];
    const earliest = ordered[0];
    const signals = [];

    /* --- score --- */
    const scoreDrop = Number(earliest.score || 0) - Number(latest.score || 0);
    const span = yearsBetween(earliest.inspectionDate, latest.inspectionDate);
    const scorePoints = ordered.map(function (r) { return { date: r.inspectionDate, value: Number(r.score || 0) }; });
    const scoreSlope = slopePerYear(scorePoints);

    if (scoreDrop >= RULES.scoreDropTotal) {
      signals.push({
        kind: "score",
        severity: SEVERITY.score,
        label: "Health score",
        headline: "Down " + Math.round(scoreDrop) + " points",
        detail: "From " + earliest.score + " to " + latest.score + " across " + ordered.length +
          " visits" + (span >= 0.8 ? " over " + Math.round(span) + " year" + (Math.round(span) === 1 ? "" : "s") : ""),
      });
    } else if (ordered.length >= RULES.minVisitsForSlope && -scoreSlope >= RULES.scoreDropPerYear) {
      signals.push({
        kind: "score",
        severity: SEVERITY.score,
        label: "Health score",
        headline: "Falling " + Math.round(-scoreSlope) + " points a year",
        detail: "Sustained across " + ordered.length + " visits, now " + latest.score,
      });
    }

    /* --- measured readings --- */
    seriesFor(ordered).forEach(function (sery) {
      if (sery.points.length < 2) return;
      const last = sery.points[sery.points.length - 1];
      const first = sery.points[0];
      const moved = last.value - first.value;
      const unit = sery.unit || "";

      if (sery.band && (last.value < sery.band.min || last.value > sery.band.max)) {
        const overBy = last.value > sery.band.max ? last.value - sery.band.max : sery.band.min - last.value;
        signals.push({
          kind: "out",
          severity: SEVERITY.out,
          label: sery.label,
          headline: last.value + unit + " is outside " +
            (sery.band.derived ? "its set point" : "the target range"),
          detail: (sery.band.derived
            ? "Set to " + sery.band.setpoint + unit + ", reading " + last.value + unit
            : "Target " + sery.band.min + "-" + sery.band.max + unit + ", reading " + last.value + unit) +
            " (" + (Math.round(overBy * 10) / 10) + unit + " out)" +
            (Math.abs(moved) >= RULES.minMeaningfulMove
              ? ", " + (moved > 0 ? "up " : "down ") + Math.abs(Math.round(moved * 10) / 10) + unit + " since " + monthYear(first.date)
              : ""),
        });
        return;   /* already out; no need to also project that it will be */
      }

      /* Heading out: needs three visits, a real move, and a projection that
         crosses the band within the next couple of intervals. */
      if (!sery.band || sery.points.length < RULES.minVisitsForSlope) return;
      if (Math.abs(moved) < RULES.minMeaningfulMove) return;
      const slope = slopePerYear(sery.points);
      if (Math.abs(slope) < RULES.minMeaningfulMove / 2) return;
      const projected = last.value + slope * RULES.projectVisits;
      if (projected <= sery.band.max && projected >= sery.band.min) return;

      signals.push({
        kind: "projected",
        severity: SEVERITY.projected,
        label: sery.label,
        headline: "Heading out of range",
        detail: last.value + unit + " now, moving " + (slope > 0 ? "+" : "") +
          (Math.round(slope * 10) / 10) + unit + " a year against a " +
          (sery.band.derived ? "set point of " + sery.band.setpoint + unit : sery.band.min + "-" + sery.band.max + unit + " target") +
          ". On this trend it leaves range within " + RULES.projectVisits + " visits.",
      });
    });

    if (!signals.length) return null;
    signals.sort(function (a, b) { return b.severity - a.severity; });
    return {
      assetId: latest.assetId,
      householdId: latest.householdId,
      appliance: latest.applianceLabel,
      latestReportId: latest.id,
      visits: ordered.length,
      latestDate: latest.inspectionDate,
      score: Number(latest.score || 0),
      severity: signals[0].severity,
      signals: signals,
    };
  }

  /* Every appliance in the book with something to say, worst first. */
  /*
   * READINGS FROM BEFORE A MACHINE WAS REPLACED ARE NOT THIS MACHINE'S.
   *
   * Cayden: "it wouldn't be surprising to me if i got sent to do maintenance on
   * appliances the customer bought 6 years ago from us, but maybe they replaced
   * the dishwasher in between with someone else."
   *
   * A trend is a claim that a reading moved. Comparing last year's Bosch to this
   * year's Miele produces a confident decline that never happened -- and the
   * decline block is the one screen that turns a reading into a sales
   * conversation, so a false signal there is a call to a customer about a
   * problem their new dishwasher does not have.
   *
   * When a technician marks an appliance as a DIFFERENT MACHINE, the asset gets
   * a `lineageStartedAt` date. Everything before it belongs to the machine that
   * left, and is filtered out here rather than at each call site -- the store
   * still has the reports, and the household page still shows the history; what
   * changes is what may be called a trend.
   */
  function sinceReplacement(state, assetId, reports) {
    const asset = ((state && state.assets) || []).find(function (a) { return a.id === assetId; });
    const since = asset && asset.lineageStartedAt;
    if (!since) return reports;
    return reports.filter(function (r) {
      return String(r.inspectionDate || "") >= String(since);
    });
  }

  function decliningAppliances(state) {
    const reports = (state && state.reports) || [];
    const byAsset = {};
    reports.forEach(function (r) {
      if (!r.assetId) return;
      (byAsset[r.assetId] = byAsset[r.assetId] || []).push(r);
    });
    Object.keys(byAsset).forEach(function (assetId) {
      byAsset[assetId] = sinceReplacement(state, assetId, byAsset[assetId]);
    });
    return Object.keys(byAsset)
      .map(function (assetId) { return analyseAppliance(byAsset[assetId]); })
      .filter(Boolean)
      .sort(function (a, b) {
        if (b.severity !== a.severity) return b.severity - a.severity;
        return a.score - b.score;
      });
  }

  function forAsset(state, assetId) {
    const reports = ((state && state.reports) || []).filter(function (r) { return r.assetId === assetId; });
    return analyseAppliance(sinceReplacement(state, assetId, reports));
  }

  window.WILSON_TRENDS = {
    rules: RULES,
    analyseAppliance: analyseAppliance,
    decliningAppliances: decliningAppliances,
    forAsset: forAsset,
  };
})();

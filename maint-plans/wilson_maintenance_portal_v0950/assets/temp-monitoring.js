/*
 * WILSON TEMP WATCH — the monitoring hub's data layer.          (v0.9.39)
 *
 * Cayden: "i plan to monitor hundreds of customer temps, and be able to catch
 * failing refrigerators remotely, and cleanly dispatch techs on service calls
 * as soon as we pick up on flags."
 *
 * WHAT IS REAL AND WHAT IS SIMULATED, stated plainly because this file is the
 * boundary between them:
 *
 *   REAL      which appliances are enrolled (tempMonitoringOptIn, set on the
 *             registration add-on card), the flag rules (plan-config
 *             tempMonitoring.flagRules), the dispatch records this hub writes,
 *             and every price.
 *
 *   SIMULATED the temperature readings. There is no UbiBot account wired to a
 *             prototype, so each enrolled sensor gets a deterministic 48-hour
 *             series generated from its asset id -- the same appliance shows
 *             the same curve on every load, so the demo can be walked twice.
 *             One seeded unit (the Reynolds estate's declining Sub-Zero) runs
 *             warm on purpose, so the flag -> dispatch flow is visible.
 *
 * THE PRODUCTION SHAPE, so nobody builds the wrong thing from this file:
 * UbiBot's public API allows ONE feed read per channel per MINUTE and six per
 * account -- polling hundreds of sensors is arithmetic that cannot work. The
 * real backend registers UbiBot DATA FORWARDING (their webhook push) per
 * channel, ingests pushed readings into Wilson's own store, and evaluates
 * these same flag rules on ingest. This module's `evaluateFlags` is written
 * against plain reading arrays for exactly that reason: the simulator hands it
 * fake ones today, the ingest hands it real ones later, and the rules do not
 * move. See docs/TEMP_MONITORING_UBIBOT_NOTES.md.
 */
(function () {
  const config = window.WILSON_CONFIG;

  /* Deterministic pseudo-randomness from a string. The same sensor must tell
     the same story on every load, or the demo cannot be rehearsed. */
  function seedFrom(text) {
    let h = 2166136261;
    String(text).split("").forEach(function (ch) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    });
    return function () {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      return ((h >>> 0) % 10000) / 10000;
    };
  }

  /* Which band a monitored appliance is judged against. The setpoint rides
     on the rule (v0.9.42) so config owns it. Since v0.9.47 a sensor is a
     COMPARTMENT, so a caller that knows which compartment it is asking about
     passes the key; the type-sniffing remains as the fallback for callers
     that only have the appliance. */
  function bandFor(asset, compartmentKey) {
    const rules = (config.tempMonitoring || {}).flagRules || {};
    if (compartmentKey && rules[compartmentKey]) {
      return { key: compartmentKey, rule: rules[compartmentKey],
               setpoint: rules[compartmentKey].setpointF !== undefined ? rules[compartmentKey].setpointF
                 : compartmentKey === "wine" ? 55 : compartmentKey === "freezer" ? 0 : 37 };
    }
    const type = String(asset.type || "").toLowerCase();
    const label = String(asset.typeLabel || "").toLowerCase();
    if (type.indexOf("wine") > -1 || label.indexOf("wine") > -1) return { key: "wine", rule: rules.wine, setpoint: (rules.wine || {}).setpointF !== undefined ? rules.wine.setpointF : 55 };
    if (type.indexOf("freezer") > -1 || label.indexOf("freezer") > -1) return { key: "freezer", rule: rules.freezer, setpoint: (rules.freezer || {}).setpointF !== undefined ? rules.freezer.setpointF : 0 };
    return { key: "fresh_food", rule: rules.fresh_food, setpoint: (rules.fresh_food || {}).setpointF !== undefined ? rules.fresh_food.setpointF : 37 };
  }

  /*
   * 48 hours of readings at 15-minute intervals, newest last.
   * `profile` decides the story: "normal" wanders inside the band;
   * "failing" climbs steadily out of it over the last day.
   */
  function simulateSeries(asset, profile, compartmentKey) {
    /* One deterministic story per SENSOR: the same appliance's fresh-food
       and freezer probes must each tell their own repeatable curve. */
    const rand = seedFrom(asset.id + "|" + (compartmentKey || ""));
    const band = bandFor(asset, compartmentKey);
    const points = [];
    const count = 48 * 4;
    let drift = 0;
    for (let i = 0; i < count; i += 1) {
      const hoursAgo = (count - 1 - i) / 4;
      /* Door-opening noise: short warm blips, more often in the evening. */
      const noise = (rand() - 0.5) * 1.6 + (rand() > 0.96 ? 2.5 + rand() * 2 : 0);
      if (profile === "failing" && hoursAgo < 30) {
        /* A condenser losing the fight: ~0.35°F per hour, accelerating. */
        drift += 0.088 + (30 - hoursAgo) * 0.004;
      }
      /* "Drifty": running a couple of degrees warm and noisier than it should,
         still inside the band -- the appliance the office should EYE, and the
         demo's example that not everything is either fine or on fire. */
      const elevated = profile === "drifty" ? 2.2 + Math.sin(i / 20) * 0.8 : 0;
      points.push({
        minutesAgo: Math.round(hoursAgo * 60),
        value: Math.round((band.setpoint + noise + drift + elevated) * 10) / 10
      });
    }
    return points;
  }

  /*
   * WHAT THE CUBE SAYS ABOUT PERFORMANCE, in numbers a report can print.
   *
   * avg / min / max over the window, percent of readings in band, excursion
   * COUNT (distinct trips over the limit, not reading count -- five warm
   * readings in one door-open event are one excursion), and the longest
   * excursion in minutes. These are the "other relevant data we can glean"
   * Cayden asked for, computed one way for the hub, the report and QA.
   */
  function summarize(points, rule) {
    if (!points || !points.length) return null;
    const values = points.map(function (p) { return p.value; });
    const limit = rule && rule.maxF !== undefined ? rule.maxF : null;
    let excursions = 0, over = false, runStart = null, longest = 0, overCount = 0;
    points.forEach(function (p) {
      const out = limit !== null && p.value > limit;
      if (out) overCount += 1;
      if (out && !over) { excursions += 1; runStart = p.minutesAgo; }
      if (!out && over && runStart !== null) {
        longest = Math.max(longest, runStart - p.minutesAgo);
        runStart = null;
      }
      over = out;
    });
    if (over && runStart !== null) longest = Math.max(longest, runStart - points[points.length - 1].minutesAgo);
    const avg = values.reduce(function (t, v) { return t + v; }, 0) / values.length;
    return {
      hours: Math.round(points[0].minutesAgo / 60),
      avg: Math.round(avg * 10) / 10,
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values),
      inBandPct: limit === null ? null : Math.round(((points.length - overCount) / points.length) * 100),
      excursions: limit === null ? null : excursions,
      longestExcursionMinutes: limit === null ? null : longest
    };
  }

  /*
   * THE FLAG RULES, evaluated over any reading array.               (v0.9.42)
   *
   * Three tests per band, all forms of "sustained, never a blip", because a
   * door held open makes a spike and a failing compressor makes a slope:
   *
   *   WARNING   every reading in `holdMinutes` above `maxF` -- past the
   *             food-safety line for longer than any healthy defrost or door
   *             event lasts. The office EYES it.
   *   DISPATCH  every reading in `dispatchHoldMinutes` above `dispatchF` --
   *             the no-cool signature, nothing normal lives there. A truck.
   *   RECOVERY  Cayden's rule: "temp falling outside of a set range and
   *             failing to recover to set point within a threshold." The
   *             current excursion over `maxF` has run `recoverWithinMinutes`
   *             without once coming back under. Catches the slow sealed-
   *             system decline that never reaches the dispatch line. Also a
   *             truck.
   *
   * This function moves to the server unchanged when the real feed arrives.
   */
  function evaluateFlags(asset, points, compartmentKey) {
    const band = bandFor(asset, compartmentKey);
    const rule = band.rule;
    if (!rule || !points || !points.length) return { flagged: false, tier: "ok", band: band };
    const latest = points[points.length - 1];

    function sustained(limit, minutes) {
      if (limit === undefined || minutes === undefined) return false;
      const windowPoints = points.filter(function (p) { return p.minutesAgo <= minutes; });
      return windowPoints.length > 0 && windowPoints.every(function (p) { return p.value > limit; });
    }

    /* How long the CURRENT excursion over the warning line has run --
       counted back from the newest reading, not asserted. */
    let overForMinutes = 0;
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (points[i].value > rule.maxF) overForMinutes = points[i].minutesAgo; else break;
    }

    const warnSustained = sustained(rule.maxF, rule.holdMinutes);
    const dispatchSustained = sustained(rule.dispatchF, rule.dispatchHoldMinutes);
    const failedRecovery = rule.recoverWithinMinutes !== undefined
      && overForMinutes >= rule.recoverWithinMinutes;

    const tier = (dispatchSustained || failedRecovery) ? "dispatch" : (warnSustained ? "warn" : "ok");
    return {
      /* `flagged` stays the dispatch-worthy answer -- every consumer of this
         field (the hub's flag list, the dispatch button, QA) means "roll a
         truck" by it. The warning tier rides beside it, never inside it. */
      flagged: tier === "dispatch",
      tier: tier,
      reason: dispatchSustained ? "sustained past the dispatch line"
        : failedRecovery ? "not recovering — over the line " + Math.round(overForMinutes / 60 * 10) / 10 + "h"
        : warnSustained ? "sustained past the warning line" : "",
      band: band,
      rule: rule,
      latest: latest ? latest.value : null,
      over: latest && rule.maxF !== undefined ? Math.round((latest.value - rule.maxF) * 10) / 10 : null,
      overForMinutes: overForMinutes
    };
  }

  /*
   * The fleet: every enrolled sensor across every household, with its series
   * and flag state. `failingAssetIds` lets the seed nominate the demo's
   * failing unit; everything else runs normal.
   */
  function profileFor(asset) {
    const tm = config.tempMonitoring || {};
    if ((tm.demoFailingModels || ["BI-48S"]).indexOf(asset.model) > -1) return "failing";
    if ((tm.demoDriftyModels || ["CL3650R"]).indexOf(asset.model) > -1) return "drifty";
    return "normal";
  }

  /* One monitored SENSOR (an appliance's compartment), everything about it.
     The hub's fleet is built from this and so is the health report's
     Guardian block -- one resolver, so the two can never chart different
     data for the same probe. `compartmentKey` optional for legacy callers;
     it defaults to the sensor's own band. */
  function forAsset(asset, household, compartmentKey) {
    const key = compartmentKey || bandFor(asset).key;
    const points = simulateSeries(asset, profileFor(asset), key);
    const flag = evaluateFlags(asset, points, key);
    const compartmentMeta = ((config.tempMonitoring || {}).compartments || {})[key] || {};
    return {
      asset: asset,
      household: household || null,
      compartment: key,
      compartmentLabel: compartmentMeta.short || compartmentMeta.label || "",
      points: points,
      flag: flag,
      stats: summarize(points, flag.rule),
      simulated: true
    };
  }

  /* Every watched compartment of one appliance -- the report's Guardian
     sheet iterates this so a two-probe column charts both. */
  function forAssetSensors(asset, household) {
    const watched = window.WILSON_TEMPWATCH ? window.WILSON_TEMPWATCH.watched(asset) : [];
    return watched.map(function (key) { return forAsset(asset, household, key); });
  }

  function fleet(state) {
    const rows = [];
    (state.assets || []).forEach(function (asset) {
      if (!asset.tempMonitoringOptIn || asset.status === "Removed") return;
      const household = (state.households || []).find(function (h) { return h.id === asset.householdId; });
      /* One fleet row per SENSOR: a column watching both compartments is two
         rows, because it is two probes with two rules and two stories. */
      forAssetSensors(asset, household).forEach(function (row) { rows.push(row); });
    });
    /* Flags first, then by household name -- the hub is a worklist. */
    rows.sort(function (a, b) {
      if (a.flag.flagged !== b.flag.flagged) return a.flag.flagged ? -1 : 1;
      return String(a.household ? a.household.name : "").localeCompare(String(b.household ? b.household.name : ""));
    });
    return rows;
  }

  window.WILSON_TEMPWATCH_SIM = {
    bandFor: bandFor,
    simulateSeries: simulateSeries,
    evaluateFlags: evaluateFlags,
    summarize: summarize,
    forAsset: forAsset,
    forAssetSensors: forAssetSensors,
    fleet: fleet
  };
})();

(function () {
  /*
   * =========================================================================
   * HVAC PERFORMANCE - derived readings, and a health score with a guardrail
   * =========================================================================
   *
   * THE GUARDRAIL, FIRST, BECAUSE IT IS THE POINT
   * ---------------------------------------------
   * A system is scored on whether it delivers what its own nameplate says it
   * should deliver. A 13-SEER three-ton unit moving three tons of heat at its
   * rated airflow and rated static is a 100% healthy system. It is not docked
   * for not being a 20-SEER unit, because it was never a 20-SEER unit and the
   * customer already knows that.
   *
   * Efficiency and age are computed and reported. Neither can touch the grade,
   * and `scoreHealth` below has no access to either -- that is enforced by the
   * shape of the function rather than by everyone remembering.
   *
   * WHY: Wilson's replacement work comes from being the outfit that told people
   * the truth for years, including the years the truth was "leave it alone".
   * A tool that quietly shaves points off a healthy older system to manufacture
   * urgency spends that reputation to pull forward a sale it would have won
   * anyway, at the right time, from a customer who trusted it.
   *
   * WHAT IS DERIVED HERE, AND WHAT DELIBERATELY IS NOT
   * -------------------------------------------------
   * Everything below is arithmetic on readings a technician entered. Nothing
   * rests on a refrigerant property table or a psychrometric formula written
   * from memory, because a wrong saturation temperature or a wrong enthalpy
   * would corrupt every number downstream of it, silently and confidently.
   *
   *   derived here      superheat, subcooling, approach, temperature split,
   *                     total external static, temperature rise, amps as a
   *                     percentage of nameplate, CFM per ton, static as a
   *                     percentage of rated
   *
   *   NOT derived here  saturation temperature from pressure (needs verified
   *                     refrigerant tables -- the technician reads it off the
   *                     gauge, which is a normal field workflow)
   *                     enthalpy, wet bulb, delivered capacity in BTU/h,
   *                     EER/SEER (need psychrometrics and rated performance
   *                     data; see `capacityProxy` for what is done instead)
   */

  const config = window.WILSON_CONFIG;

  /* Share of the weighted dimensions that must be evaluable before a single
     health number is published at all. See the floor check in `scoreHealth`. */
  const MIN_COVERAGE = 60;

  /* ---------------------------------------------------------------------
   * v0.9.51 -- THE measureQuick VITALS SET
   *
   * The technician takes the readings measureQuick takes (both pressures,
   * both line temperatures, outdoor air, return/supply dry and wet bulb,
   * statics, airflow) and this file derives the vitals measureQuick prints:
   * superheat, subcooling, condenser approach, temperature split, total
   * external static, filter face velocity. Saturation temperature comes off
   * the gauge pressure through the refrigerant PT table in config, which is
   * the lookup the gauge itself performs.
   *
   * Scoring follows measureQuick's loss buckets minus efficiency: charge,
   * split, static, approach. Age is blended in by the field tool at 25%,
   * exactly as for an appliance. See config.hvacScoring for the words.
   * ------------------------------------------------------------------- */

  function scoringCfg() { return (config.hvacScoring || {}); }
  function bandsCfg() { return scoringCfg().bands || {}; }

  function normalizeRefrigerant(value) {
    const raw = String(value || "").toUpperCase().replace(/[\s-]/g, "");
    if (!raw) return null;
    const known = Object.keys(scoringCfg().refrigerantPT || {});
    const hit = known.find(function (k) { return k.toUpperCase().replace(/[\s-]/g, "") === raw; });
    return hit || null;
  }

  /* Saturation temperature (\u00b0F) for a gauge pressure (psig), by linear
     interpolation on the config table. null outside the table or with no
     refrigerant on record -- never a guess from a different refrigerant. */
  function saturationTemp(psig, refrigerant) {
    const key = normalizeRefrigerant(refrigerant);
    const pressure = num(psig);
    if (key === null || pressure === null) return null;
    const pts = ((scoringCfg().refrigerantPT || {})[key] || {}).points || [];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i], b = pts[i + 1];
      if (pressure >= a[1] && pressure <= b[1]) {
        const t = a[0] + (pressure - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
        return round(t, 1);
      }
    }
    return null;
  }

  function ptVerified(refrigerant) {
    const key = normalizeRefrigerant(refrigerant);
    return key ? Boolean(((scoringCfg().refrigerantPT || {})[key] || {}).verified) : false;
  }

  function meteringKey(design) {
    const raw = String((design || {}).meteringDevice || "").toLowerCase();
    if (/piston|orifice|fixed|cap/.test(raw)) return "piston";
    return "txv";
  }

  /* Where a value sits against a band, and what that costs. Linear: one full
     band-width outside the band is the whole dimension. */
  function bandJudge(value, band) {
    if (value === null || !band) return null;
    const min = num(band.min), max = num(band.max);
    const width = (max !== null && min !== null) ? Math.max(1e-6, max - min) : null;
    const per = num(bandsCfg().deductionPerBandWidth) || 100;
    if (min !== null && value < min) {
      const out = min - value;
      return { inRange: false, direction: "low", out: round(out, 2), pct: Math.max(0, Math.round(100 - (out / (width || Math.max(1, Math.abs(min)))) * per)) };
    }
    if (max !== null && value > max) {
      const out = value - max;
      return { inRange: false, direction: "high", out: round(out, 2), pct: Math.max(0, Math.round(100 - (out / (width || Math.max(1, Math.abs(max)))) * per)) };
    }
    return { inRange: true, direction: "normal", out: 0, pct: 100 };
  }

  function num(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function round(value, places) {
    if (value === null) return null;
    const f = Math.pow(10, places || 0);
    return Math.round(value * f) / f;
  }

  /* ---------------------------------------------------------------------
   * DERIVED READINGS
   *
   * Each returns null rather than a number when its inputs are absent. A
   * missing reading has to stay missing all the way to the report: this is the
   * same rule as an unestablished appliance age, and for the same reason.
   * ------------------------------------------------------------------- */

  /* Saturation temperatures: from the gauge pressure through the PT table,
     or entered directly when the technician read them off a digital gauge. */
  function suctionSatOf(r, design) {
    const direct = num(r.suctionSat);
    if (direct !== null) return direct;
    return saturationTemp(r.lowPressure, (design || {}).refrigerant);
  }
  function liquidSatOf(r, design) {
    const direct = num(r.liquidSat);
    if (direct !== null) return direct;
    return saturationTemp(r.highPressure, (design || {}).refrigerant);
  }

  const DERIVED = {
    suctionSat: {
      id: "suctionSat", label: "Suction saturation", unit: "°F",
      needs: ["lowPressure"],
      compute: function (r, design) { return suctionSatOf(r, design); },
      targetFrom: null
    },
    liquidSat: {
      id: "liquidSat", label: "Liquid saturation", unit: "°F",
      needs: ["highPressure"],
      compute: function (r, design) { return liquidSatOf(r, design); },
      targetFrom: null
    },
    /* Superheat = how far above saturation the suction line is. */
    superheat: {
      id: "superheat",
      label: "Superheat",
      unit: "°F",
      needs: ["suctionLine", "lowPressure"],
      compute: function (r, design) {
        const line = num(r.suctionLine), sat = suctionSatOf(r, design);
        return line === null || sat === null ? null : round(line - sat, 1);
      },
      /* Band depends on metering device and operating conditions. Wilson's
         tech team sets it; until then the reading is recorded and trended but
         not scored, and the report says so. */
      targetFrom: "charge"
    },

    /* Subcooling = how far below saturation the liquid line is. */
    subcooling: {
      id: "subcooling",
      label: "Subcooling",
      unit: "°F",
      needs: ["highPressure", "liquidLine"],
      compute: function (r, design) {
        const sat = liquidSatOf(r, design), line = num(r.liquidLine);
        return sat === null || line === null ? null : round(sat - line, 1);
      },
      targetFrom: "charge"
    },

    /* Compression ratio = absolute discharge over absolute suction. */
    compressionRatio: {
      id: "compressionRatio", label: "Compression ratio", unit: "",
      needs: ["lowPressure", "highPressure"],
      compute: function (r) {
        const low = num(r.lowPressure), high = num(r.highPressure);
        if (low === null || high === null || low + 14.7 <= 0) return null;
        return round((high + 14.7) / (low + 14.7), 2);
      },
      targetFrom: null
    },

    /* Approach = liquid line above outdoor ambient. The clearest single
       indicator of a loaded coil, and it trends beautifully across visits. */
    approach: {
      id: "approach",
      label: "Condenser approach",
      unit: "°F",
      needs: ["liquidLine", "outdoorAir"],
      compute: function (r) {
        const line = num(r.liquidLine), air = num(r.outdoorAir);
        return line === null || air === null ? null : round(line - air, 1);
      },
      targetFrom: "approach"
    },

    /* Temperature split across the coil. */
    deltaT: {
      id: "deltaT",
      label: "Temperature split",
      unit: "°F",
      needs: ["returnDb", "supplyDb"],
      compute: function (r) {
        const ret = num(r.returnDb), sup = num(r.supplyDb);
        return ret === null || sup === null ? null : round(ret - sup, 1);
      },
      targetFrom: "split"
    },

    /* Total external static = what the blower is actually working against. */
    totalStatic: {
      id: "totalStatic",
      label: "Total external static",
      unit: " in wc",
      needs: ["totalStatic"],
      compute: function (r) {
        /* Entered directly (measureQuick prints TESP alone when only the
           total was probed) or summed from the two ports. */
        const direct = num(r.totalStatic);
        if (direct !== null) return round(direct, 2);
        const sup = num(r.supplyStatic), ret = num(r.returnStatic);
        return sup === null || ret === null ? null : round(Math.abs(sup) + Math.abs(ret), 2);
      },
      targetFrom: "static"
    },

    /* Airflow per ton. Measured airflow when there is one; otherwise the
       nominal 400 CFM/ton estimate, flagged as nominal wherever it prints. */
    cfmPerTon: {
      id: "cfmPerTon", label: "Airflow per ton", unit: " CFM/ton",
      needs: ["airflowCfm"],
      compute: function (r, design) {
        const cfm = num(r.airflowCfm) !== null ? num(r.airflowCfm) : num((design || {}).ratedCfm);
        const tons = num((design || {}).ratedTons);
        if (cfm === null || tons === null || tons <= 0) return null;
        return round(cfm / tons, 0);
      },
      targetFrom: null
    },

    /* Filter face velocity = airflow over the filter's face area. Over 500 FPM
       the filter is undersized for the airflow and loads the blower. */
    filterFaceVelocity: {
      id: "filterFaceVelocity", label: "Filter face velocity", unit: " FPM",
      needs: ["airflowCfm"],
      compute: function (r, design) {
        const d = design || {};
        const w = num(d.filterWidth), h = num(d.filterHeight);
        if (w === null || h === null || w <= 0 || h <= 0) return null;
        let cfm = num(r.airflowCfm);
        if (cfm === null) {
          const tons = num(d.ratedTons);
          const nominal = num(((scoringCfg().designDefaults || {}).cfmPerTonNominal || {}).value) || 400;
          if (tons !== null && tons > 0) cfm = tons * nominal;
        }
        if (cfm === null) return null;
        return round(cfm / ((w * h) / 144), 0);
      },
      targetFrom: null
    },

    /* Furnace temperature rise. The plate states its own range, which makes
       this the cleanest design-spec target in the product. */
    temperatureRise: {
      id: "temperatureRise",
      label: "Temperature rise",
      unit: "°F",
      needs: ["returnDb", "supplyDb"],
      compute: function (r) {
        const ret = num(r.returnDb), sup = num(r.supplyDb);
        return ret === null || sup === null ? null : round(sup - ret, 1);
      },
      targetFrom: "capacity"
    },

    /* Amps as a share of the nameplate rating. Definitionally scoreable:
       the plate states the maximum the equipment is built to draw. */
    ampsOfRla: {
      id: "ampsOfRla",
      label: "Amp draw vs nameplate",
      unit: "% of RLA",
      needs: ["condenserAmps"],
      compute: function (r, design) {
        const amps = num(r.condenserAmps) !== null ? num(r.condenserAmps)
          : num(r.condAmps) !== null ? num(r.condAmps)
          : num(r.blowerAmps) !== null ? num(r.blowerAmps) : num(r.ahuAmps);
        const rated = num((design || {}).condenserRla) !== null
          ? num((design || {}).condenserRla)
          : num((design || {}).blowerFla);
        if (amps === null || rated === null || rated <= 0) return null;
        return round((amps / rated) * 100, 0);
      },
      targetFrom: "electrical"
    }
  };

  /*
   * Airflow per ton, when airflow was actually measured.
   *
   * NOT estimated from capacity. measureQuick derives airflow from the
   * sensible/latent split and then multiplies by the ENTERED nominal tonnage --
   * their own documentation says the algorithm yields CFM per ton -- which
   * means a mistyped tonnage silently corrupts airflow, then capacity, then
   * efficiency. It is also the number their own users argue about most.
   *
   * So this reports CFM per ton only when a technician measured airflow with a
   * hood or a flow grid. No measurement, no number.
   */
  function cfmPerTon(readings, design) {
    const cfm = num(readings.measuredCfm);
    const tons = num((design || {}).ratedTons);
    if (cfm === null || tons === null || tons <= 0) return null;
    return round(cfm / tons, 0);
  }

  /*
   * Capacity, honestly.
   *
   * Delivered capacity in BTU/h needs airflow and an enthalpy difference, and
   * enthalpy needs psychrometrics this file will not fake. So capacity is
   * scored on a PROXY: whether the system is moving heat the way its design
   * says it should, judged from temperature split against measured airflow
   * where that exists, and from temperature rise against the plate range on a
   * furnace.
   *
   * Where the proxy cannot be formed, capacity is NOT SCORED. It is reported as
   * unavailable with the reason, which is a truthful outcome. Inventing a
   * capacity percentage would put the least reliable number on the report in
   * the most prominent position.
   */
  function capacityProxy(readings, design, setKey) {
    if (setKey === "hvac_furnace") {
      const rise = DERIVED.temperatureRise.compute(readings);
      const low = num((design || {}).riseRangeLow);
      const high = num((design || {}).riseRangeHigh);
      if (rise === null) return { available: false, reason: "no-reading" };
      if (low === null || high === null) return { available: false, reason: "no-plate-range", value: rise };
      /* Inside the plate range is full marks -- the furnace is firing and
         moving air as designed. Outside it, the distance out is the deduction. */
      if (rise >= low && rise <= high) return { available: true, pct: 100, value: rise, basis: "plate rise range" };
      const out = rise < low ? low - rise : rise - high;
      const span = Math.max(1, high - low);
      return {
        available: true,
        pct: Math.max(0, Math.round(100 - (out / span) * 100)),
        value: rise,
        basis: "plate rise range",
        direction: rise < low ? "low" : "high"
      };
    }

    /*
     * Cooling and heat pump: capacity is NOT scored, and this is deliberate.
     *
     * The first version proxied it from CFM per ton -- which is the exact
     * reading the airflow dimension already scores. That meant one measurement
     * drove 50% of the health score under two different names, so a system
     * 10% low on airflow was docked twice for it. Double-counting a reading is
     * how a scoring model quietly stops meaning what it says.
     *
     * Delivered cooling capacity needs airflow AND an enthalpy difference
     * across the coil, and enthalpy needs psychrometrics this build does not
     * do. Temperature split is not a substitute: a system with half the
     * airflow shows a BIGGER split, not a smaller one, so a naive split-based
     * capacity score would reward the fault.
     *
     * So it is reported as not evaluated, with the reason. When Wilson wants
     * capacity scored, the honest route is verified psychrometrics plus rated
     * performance data -- not a proxy wearing capacity's name.
     */
    return { available: false, reason: "needs-delivered-heat-measurement" };
  }

  /* ---------------------------------------------------------------------
   * SCORING
   *
   * `scoreHealth` receives readings, the design profile and the technician's
   * condition ratings. It is NOT given efficiency, and it is NOT given age.
   * That is the guardrail, expressed as an argument list rather than a
   * convention somebody has to remember.
   * ------------------------------------------------------------------- */

  function staticScore(readings, design) {
    const total = DERIVED.totalStatic.compute(readings);
    if (total === null) return { available: false, reason: "no-reading" };
    const rated = num((design || {}).maxEsp);
    if (rated !== null && rated > 0) {
      const pct = (total / rated) * 100;
      return {
        available: true,
        pct: pct <= 100 ? 100 : Math.max(0, Math.round(100 - (pct - 100))),
        value: total, unit: DERIVED.totalStatic.unit,
        band: { min: null, max: rated },
        inRange: pct <= 100,
        direction: pct <= 100 ? "normal" : "high",
        ratedMax: rated, ofRated: Math.round(pct),
        basis: "nameplate maximum external static (" + rated + " in wc)"
      };
    }
    const band = bandsCfg().static || { min: 0.2, max: 0.7 };
    const j = bandJudge(total, band);
    return Object.assign({ available: true, value: total, unit: DERIVED.totalStatic.unit, band: band,
      basis: (band.draft ? "draft " : "") + "Wilson band " + band.min + "-" + band.max + " in wc (no plate maximum on record)" }, j);
  }

  function splitScore(readings) {
    const split = DERIVED.deltaT.compute(readings);
    if (split === null) return { available: false, reason: "no-reading" };
    const band = bandsCfg().split || { min: 16.5, max: 22.5 };
    const j = bandJudge(split, band);
    return Object.assign({ available: true, value: split, unit: "\u00b0F", band: band,
      basis: (band.draft ? "draft " : "") + "Wilson band " + band.min + "-" + band.max + " \u00b0F" }, j);
  }

  function approachScore(readings) {
    const approach = DERIVED.approach.compute(readings);
    if (approach === null) return { available: false, reason: "no-reading" };
    const band = bandsCfg().approach || { min: 1.5, max: 13 };
    const j = bandJudge(approach, band);
    return Object.assign({ available: true, value: approach, unit: "\u00b0F", band: band,
      basis: (band.draft ? "draft " : "") + "Wilson band " + band.min + "-" + band.max + " \u00b0F" }, j);
  }

  /*
   * Charge: superheat and subcooling, each against the band for this metering
   * device, averaged. Needs the refrigerant on the plate to turn pressure
   * into saturation temperature -- without it there is no superheat and the
   * dimension is not scored, and the report asks for the refrigerant by name.
   */
  function chargeScore(readings, design) {
    const sh = DERIVED.superheat.compute(readings, design);
    const sc = DERIVED.subcooling.compute(readings, design);
    if (sh === null && sc === null) {
      const havePressures = num(readings.lowPressure) !== null || num(readings.highPressure) !== null;
      return { available: false, reason: havePressures && !normalizeRefrigerant((design || {}).refrigerant) ? "no-refrigerant" : "no-reading" };
    }
    const device = meteringKey(design);
    const shBand = ((bandsCfg().superheat || {})[device]) || { min: 6, max: 24 };
    const scBand = ((bandsCfg().subcooling || {})[device]) || { min: 7, max: 13 };
    const parts = [];
    if (sh !== null) parts.push(Object.assign({ id: "superheat", label: "Superheat", value: sh, unit: "\u00b0F", band: shBand }, bandJudge(sh, shBand)));
    if (sc !== null) parts.push(Object.assign({ id: "subcooling", label: "Subcooling", value: sc, unit: "\u00b0F", band: scBand }, bandJudge(sc, scBand)));
    const pct = Math.round(parts.reduce(function (t, p) { return t + p.pct; }, 0) / parts.length);
    const approx = !ptVerified((design || {}).refrigerant) && num(readings.suctionSat) === null;
    return {
      available: true,
      pct: pct,
      inRange: parts.every(function (p) { return p.inRange; }),
      parts: parts,
      value: sh !== null ? sh : sc,
      basis: (device === "txv" ? "TXV" : "fixed-orifice") + " bands: superheat " + shBand.min + "-" + shBand.max + ", subcooling " + scBand.min + "-" + scBand.max + " \u00b0F"
        + (approx ? " (saturation from an unverified PT table -- approximate)" : ""),
      approximate: approx,
      draftBand: Boolean((bandsCfg().superheat || {}).draft)
    };
  }

  /*
   * The health score. Only the dimensions that could be evaluated are scored
   * and the weights are renormalised across those; a coverage floor keeps a
   * two-reading visit from publishing a confident number.
   */
  function scoreHealth(input) {
    const readings = input.readings || {};
    const design = input.design || {};
    const ratings = input.ratings || {};
    const setKey = input.checkpointSet || "hvac_cooling";
    const dims = scoringCfg().dimensions || {};

    let results;
    if (setKey === "hvac_furnace") {
      /* A furnace has no refrigerant circuit: rise against the plate range
         carries the split weight and static keeps its own. */
      results = { split: capacityProxy(readings, design, setKey), static: staticScore(readings, design) };
    } else if (setKey === "hvac_minisplit") {
      results = { split: splitScore(readings), approach: approachScore(readings) };
    } else {
      results = {
        charge:   chargeScore(readings, design),
        split:    splitScore(readings),
        static:   staticScore(readings, design),
        approach: approachScore(readings)
      };
    }

    let weighted = 0;
    let weightUsed = 0;
    const scored = [];
    const notScored = [];

    Object.keys(dims).forEach(function (key) {
      const dim = dims[key];
      const result = results[key];
      if (result && result.available) {
        weighted += result.pct * dim.weight;
        weightUsed += dim.weight;
        scored.push(Object.assign({ id: key, label: dim.label, weight: dim.weight }, result));
      } else if (result) {
        notScored.push({ id: key, label: dim.label, reason: result.reason || "unavailable" });
      }
    });

    if (weightUsed === 0) {
      return { available: false, score: null, coverage: 0, scored: [], notScored: notScored,
               reason: "Nothing on this system could be evaluated yet. Enter the outdoor and indoor readings." };
    }

    const totalWeight = Object.keys(results).reduce(function (t, k) { return t + ((dims[k] || {}).weight || 0); }, 0) || 1;
    const coverage = Math.round((weightUsed / totalWeight) * 100);
    if (coverage < MIN_COVERAGE) {
      return {
        available: false,
        score: null,
        coverage: coverage,
        scored: scored,
        notScored: notScored,
        reason: "Only " + coverage + "% of this system's vitals could be evaluated, which is not enough for a health score. "
          + "The readings taken are below, with what is still needed to score the rest."
      };
    }

    return {
      available: true,
      score: Math.round(weighted / weightUsed),
      coverage: coverage,
      scored: scored,
      notScored: notScored,
      provisional: scored.some(function (s) { return s.provisional; })
    };
  }

  /*
   * THE VITALS, the way measureQuick prints them: each with its band and
   * whether it landed inside. Used by the field tool's derived card and by
   * the customer report's measurement rows. Not-scored vitals (filter face
   * velocity, amps) ride along flagged rather than graded.
   */
  function vitals(readings, design, setKey) {
    const health = scoreHealth({ readings: readings, design: design, checkpointSet: setKey });
    const rows = [];
    (health.scored || []).forEach(function (dim) {
      if (dim.parts) {
        dim.parts.forEach(function (p) {
          rows.push({ id: p.id, label: p.label, value: p.value, unit: p.unit, band: p.band, inRange: p.inRange,
                      direction: p.direction, scored: true, dimension: dim.id, basis: dim.basis });
        });
      } else {
        rows.push({ id: dim.id, label: dim.label, value: dim.value, unit: dim.unit || "", band: dim.band || null,
                    inRange: dim.inRange !== false, direction: dim.direction || "normal", scored: true, dimension: dim.id, basis: dim.basis });
      }
    });
    const ffv = DERIVED.filterFaceVelocity.compute(readings, design);
    if (ffv !== null) {
      const max = num((bandsCfg().filterFaceVelocity || {}).max) || 500;
      rows.push({ id: "filterFaceVelocity", label: "Filter face velocity", value: ffv, unit: " FPM", band: { min: null, max: max },
                  inRange: ffv <= max, direction: ffv <= max ? "normal" : "high", scored: false,
                  basis: "under " + max + " FPM; " + (num(readings.airflowCfm) === null ? "nominal airflow" : "measured airflow") });
    }
    const ofRla = DERIVED.ampsOfRla.compute({ condenserAmps: readings.condAmps, blowerAmps: readings.ahuAmps }, design);
    if (ofRla !== null) {
      rows.push({ id: "ampsOfRla", label: "Amp draw vs nameplate", value: ofRla, unit: "% of RLA", band: { min: null, max: 100 },
                  inRange: ofRla <= 100, direction: ofRla <= 100 ? "normal" : "high", scored: false, basis: "recorded, not scored" });
    }
    return { health: health, rows: rows };
  }

  /*
   * EFFICIENCY - reported, never scored.
   *
   * Deliberately a separate function that `scoreHealth` does not call and does
   * not receive. The comparison is against THIS system's own rating, which is
   * the only comparison that tells a customer anything actionable: a 14-SEER
   * system performing like a 14-SEER system is doing its job.
   *
   * Returns null unless the rating is on record. There is no default SEER.
   */
  function efficiencyNote(design) {
    const rated = num((design || {}).ratedSeer);
    const afue = num((design || {}).ratedAfue);
    if (rated === null && afue === null) return null;
    return {
      ratedSeer: rated,
      ratedAfue: afue,
      /* No delivered-efficiency figure yet: it needs delivered capacity in
         BTU/h and total watts, and delivered capacity needs psychrometrics
         this build does not do. Stating the rating alone is honest; stating a
         computed efficiency built on a guess would not be. */
      delivered: null,
      scoredIntoHealth: false,
      customerNote: rated !== null
        ? "This system is rated at " + rated + " SEER. A system meeting its own rating is performing correctly, whatever that rating is — efficiency is what it costs to run, not a measure of its health, and it is not part of the score above."
        : "This furnace is rated at " + afue + "% AFUE. Efficiency is what it costs to run rather than a measure of its health, and it is not part of the score above."
    };
  }

  /* ---------------------------------------------------------------------
   * THE PLANNING HORIZON
   *
   * This replaces the thing a low score usually does.
   *
   * The distinction Wilson runs on: a maintenance tool should BUILD a
   * replacement pipeline, not EXPEDITE one. Those look similar on a screen and
   * are opposites in practice.
   *
   *   Expediting  is a score of 68 with "Plan ahead" printed under it on a
   *               system that measures fine, so the customer calls someone
   *               about a new unit this month. It works once.
   *
   *   Building    is telling the same customer, honestly, for eight years,
   *               "this is fine, here is what it is doing, here is roughly
   *               when to start thinking about it" -- and being the outfit they
   *               call in year nine because nobody ever sold them anything they
   *               did not need.
   *
   * So there is no replacement recommendation here. There is a statement of
   * where the system is in its life, what it is measuring, and what that
   * combination usually means for timing. It is allowed to say "nothing, for
   * years yet", and it says that most of the time.
   *
   * THE HARD RULES
   * --------------
   *   - Age alone NEVER produces a replacement suggestion. An old system that
   *     measures well is an old system that measures well.
   *   - A serviceable fault is a service call, never a replacement case, while
   *     the system has life left. Same guard as the appliance side.
   *   - No dollar figures. Repair and replacement costs come from Wilson, and
   *     nothing here invents one.
   *   - Every horizon says what it rests on, including when that is a draft
   *     expected-life figure.
   * ------------------------------------------------------------------- */

  const HORIZON = {
    settled: {
      code: "settled",
      label: "Nothing to plan for",
      lead: "This system is doing its job and is not near the end of its expected life. There is nothing to plan for beyond keeping it maintained."
    },
    watch: {
      code: "watch",
      label: "Worth knowing about",
      lead: "This system is performing, and it is far enough into its expected life that it is worth knowing rather than being surprised later. No action now."
    },
    service: {
      code: "service",
      label: "Something to fix",
      lead: "Something measurable is off and it has an identified cause. Addressing it is what keeps this system on its expected life rather than shortening it — this is a repair, not a replacement conversation."
    },
    /*
     * Rewritten in v0.9.16. "Worth budgeting for" / "the one to have a number
     * in mind for" is a replacement-budget steer and an implied cost, and it
     * fired on age plus any one dimension under 80% -- on a DRAFT life figure.
     * The facts are enough: past its draft life, and here is what the readings
     * say. What the customer does about that is a conversation with a
     * technician, not a line on a report.
     */
    budget: {
      code: "budget",
      label: "Past draft expected life",
      lead: "This system is past its draft expected life and the readings have started to move with it. It is still running. The items below are what a service visit would address."
    },
    unknown: {
      code: "unknown",
      label: "Not enough on record",
      lead: "There is no documented install date for this system, so there is no honest way to say where it is in its life. Nothing has been assumed in place of it."
    }
  };

  /*
   * The sentence the report prints under the horizon.
   *
   * Keyed off the horizon rather than off the numbers, so the two can never
   * disagree. Allowed to say "nothing yet" and says it most of the time.
   */
  function guidanceFor(horizon, lifeUsed, remaining) {
    if (horizon.code === "service") {
      return "This is a repair, and doing it is what keeps the system on the life it has left. "
        + (remaining >= 5
            ? "There is plenty of that left."
            : "Worth doing regardless of where it is in its life.");
    }
    if (horizon.code === "budget") {
      return "Past its draft expected life and showing it in the readings. Still running. "
        + "The readings above are what a technician would work from, and they are yours to keep.";
    }
    if (horizon.code === "watch") {
      return lifeUsed >= 1
        ? "Past its draft expected service life and measuring correctly, which is a credit to how it has been looked after. "
          + "Nothing needs doing."
        : "Roughly " + Math.round(remaining) + " year" + (Math.round(remaining) === 1 ? "" : "s")
          + " of expected life left on a draft estimate, and measuring correctly. Worth knowing, not worth acting on.";
    }
    return "On the readings and the age on record, this system has years left. "
      + "Nothing to do but keep it maintained.";
  }

  /*
   * `input` deliberately takes age and condition SEPARATELY and derives the
   * horizon from the pair, because the whole point is that neither one alone
   * gets to reach a conclusion.
   */
  function planningHorizon(input) {
    const ageYears = num((input || {}).ageYears);
    const expectedYears = num((input || {}).expectedYears);
    const health = (input || {}).health || null;
    const decline = (input || {}).decline || null;
    const ageDocumented = Boolean((input || {}).ageDocumented);

    /* A serviceable fault is anything measured that is off with a known cause.
       It outranks every age consideration below. */
    const serviceSignals = ((decline && decline.signals) || []).filter(function (sig) {
      return sig.kind === "out" || sig.kind === "projected";
    });
    const scoredLow = health && health.available
      ? (health.scored || []).filter(function (d) { return d.pct < 80; })
      : [];
    const serviceable = serviceSignals.length > 0 || scoredLow.length > 0;

    /* No documented age is not age zero, and it is not "probably fine". */
    if (ageYears === null || expectedYears === null || expectedYears <= 0) {
      return {
        horizon: serviceable ? HORIZON.service : HORIZON.unknown,
        ageKnown: false,
        serviceable: serviceable,
        items: serviceItems(serviceSignals, scoredLow),
        basis: "No install date on record" + (ageDocumented ? "" : " and none established at the visit") + "."
      };
    }

    const lifeUsed = ageYears / expectedYears;
    const remaining = Math.max(0, expectedYears - ageYears);

    /*
     * ORDER MATTERS, and the first rule is the guard: a serviceable fault with
     * life remaining is a repair. It cannot fall through to "budget" no matter
     * how the numbers look.
     */
    let horizon;
    if (serviceable && lifeUsed < 1) {
      horizon = HORIZON.service;
    } else if (lifeUsed >= 1 && serviceable) {
      horizon = HORIZON.budget;
    } else if (lifeUsed >= 0.85) {
      /* Late in life but measuring fine. This is the case that must NOT become
         a replacement nudge -- it is exactly where a scoring model that folds in
         age would be printing "Plan ahead" on a healthy system. */
      horizon = HORIZON.watch;
    } else if (serviceable) {
      horizon = HORIZON.service;
    } else {
      horizon = HORIZON.settled;
    }

    return {
      horizon: horizon,
      ageKnown: true,
      ageDocumented: ageDocumented,
      ageYears: ageYears,
      expectedYears: expectedYears,
      remainingYears: Math.round(remaining * 10) / 10,
      lifeUsedPct: Math.min(100, Math.round(lifeUsed * 100)),
      serviceable: serviceable,
      items: serviceItems(serviceSignals, scoredLow),
      /* Said out loud on the report: a horizon built on a draft expected-life
         figure is a horizon built on a draft. */
      basis: (ageDocumented
        ? "Age from the documented install date"
        : "Age as recorded, not verified against a document")
        + ", against a draft expected service life of " + expectedYears + " years for this equipment type and tier.",
      /*
       * Never a recommendation, and it must agree with the horizon it sits
       * under. The first version derived this from remaining years alone, so a
       * system with a restricted duct got the horizon "Something to fix" above
       * the sentence "nothing to do but keep it maintained" -- the two halves of
       * the same paragraph contradicting each other.
       */
      guidance: guidanceFor(horizon, lifeUsed, remaining)
    };
  }

  /* What would actually extend this system's life, taken from what was measured
     rather than written generically. No costs, ever. */
  function serviceItems(signals, lowDimensions) {
    const items = signals.map(function (sig) {
      return { label: sig.label, detail: sig.detail, source: "trend" };
    });
    lowDimensions.forEach(function (dim) {
      items.push({
        label: dim.label,
        detail: dim.pct + "% against " + (dim.basis || "its design"),
        source: "measured"
      });
    });
    return items;
  }

  /* Which design fields are missing, so a report can ask for them by name
     rather than just declining to score. */
  function missingPlateData(design) {
    return (config.hvacDesignProfile || [])
      .filter(function (field) { return field.plate && num((design || {})[field.key]) === null && !(design || {})[field.key]; })
      .map(function (field) { return { key: field.key, label: field.label, scores: field.scores }; });
  }

  function derivedFor(readings, design, setKey) {
    const wanted = Object.keys(DERIVED).filter(function (id) {
      if (setKey === "hvac_furnace") return ["temperatureRise", "totalStatic", "ampsOfRla"].indexOf(id) >= 0;
      if (setKey === "hvac_minisplit") return ["deltaT", "approach", "ampsOfRla"].indexOf(id) >= 0;
      return ["suctionSat", "liquidSat", "superheat", "subcooling", "approach", "compressionRatio", "deltaT", "totalStatic", "cfmPerTon", "filterFaceVelocity"].indexOf(id) >= 0;
    });
    return wanted.map(function (id) {
      const spec = DERIVED[id];
      const value = spec.compute(readings, design);
      return { id: id, label: spec.label, unit: spec.unit, value: value,
               scoredUnder: spec.targetFrom };
    }).filter(function (row) { return row.value !== null; });
  }

  window.WILSON_HVAC = {
    saturationTemp: saturationTemp,
    vitals: vitals,
    bandJudge: bandJudge,
    horizons: HORIZON,
    planningHorizon: planningHorizon,
    derived: DERIVED,
    derivedFor: derivedFor,
    cfmPerTon: cfmPerTon,
    scoreHealth: scoreHealth,
    efficiencyNote: efficiencyNote,
    missingPlateData: missingPlateData
  };
})();

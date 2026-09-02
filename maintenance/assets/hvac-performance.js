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

  const DERIVED = {
    /* Superheat = how far above saturation the suction line is. */
    superheat: {
      id: "superheat",
      label: "Superheat",
      unit: "°F",
      needs: ["suctionLine", "suctionSat"],
      compute: function (r) {
        const line = num(r.suctionLine), sat = num(r.suctionSat);
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
      needs: ["liquidSat", "liquidLine"],
      compute: function (r) {
        const sat = num(r.liquidSat), line = num(r.liquidLine);
        return sat === null || line === null ? null : round(sat - line, 1);
      },
      targetFrom: "charge"
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
      targetFrom: "charge"
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
      /* The acceptable band depends on return humidity, so a single number
         would be wrong most of the time. Recorded and trended; Wilson sets the
         band, or supplies the table. */
      targetFrom: null
    },

    /* Total external static = what the blower is actually working against. */
    totalStatic: {
      id: "totalStatic",
      label: "Total external static",
      unit: " in wc",
      needs: ["supplyStatic", "returnStatic"],
      compute: function (r) {
        const sup = num(r.supplyStatic), ret = num(r.returnStatic);
        return sup === null || ret === null ? null : round(sup + ret, 2);
      },
      targetFrom: "static"
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
        const amps = num(r.condenserAmps) !== null ? num(r.condenserAmps) : num(r.blowerAmps);
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
    const rated = num((design || {}).maxEsp);
    if (total === null) return { available: false, reason: "no-reading" };
    if (rated === null || rated <= 0) return { available: false, reason: "no-plate-max", value: total };
    const pct = (total / rated) * 100;
    /* At or under the plate maximum the blower is inside what it was built for.
       Above it, the deduction is proportional to how far past. */
    return {
      available: true,
      pct: pct <= 100 ? 100 : Math.max(0, Math.round(100 - (pct - 100))),
      value: total,
      ratedMax: rated,
      ofRated: Math.round(pct),
      basis: "nameplate maximum external static"
    };
  }

  function electricalScore(readings, design) {
    const ofRla = DERIVED.ampsOfRla.compute(readings, design);
    if (ofRla === null) {
      return {
        available: false,
        reason: num(readings.condenserAmps) === null && num(readings.blowerAmps) === null
          ? "no-reading" : "no-plate-rla"
      };
    }
    return {
      available: true,
      pct: ofRla <= 100 ? 100 : Math.max(0, Math.round(100 - (ofRla - 100) * 2)),
      value: ofRla,
      basis: "nameplate rated load amps"
    };
  }

  /*
   * Charge. Superheat and subcooling are computed, but their acceptable bands
   * depend on the metering device and the day's conditions, and Wilson has not
   * set them. So charge is scored from the TECHNICIAN'S rating of the
   * refrigerant-circuit checkpoint, with the readings recorded alongside it and
   * trended.
   *
   * This is stated plainly rather than dressed up: it is the one HVAC dimension
   * that is currently a judgement rather than a measurement, and it stops being
   * one the moment the bands are agreed.
   */
  function chargeScore(ratings) {
    const rating = num((ratings || {}).hvac_refrigerant);
    if (rating === null) return { available: false, reason: "not-rated" };
    return {
      available: true,
      pct: Math.round((rating / 5) * 100),
      basis: "technician rating, pending agreed superheat and subcooling bands",
      provisional: true
    };
  }

  function conditionScore(ratings, names) {
    const values = (names || []).map(function (n) { return num((ratings || {})[n]); }).filter(function (v) { return v !== null; });
    if (!values.length) return { available: false, reason: "not-rated" };
    const mean = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
    return { available: true, pct: Math.round((mean / 5) * 100), basis: "technician ratings" };
  }

  /*
   * The health score.
   *
   * Only the dimensions that could actually be evaluated are scored, and the
   * weights are renormalised across those. A system missing its plate data
   * gets a score built from what WAS measurable, plus an explicit list of what
   * could not be scored and why -- rather than a confident number resting on
   * defaults.
   */
  function scoreHealth(input) {
    const readings = input.readings || {};
    const design = input.design || {};
    const ratings = input.ratings || {};
    const setKey = input.checkpointSet || "hvac_cooling";
    const dims = config.hvacScoring.dimensions;

    const results = {
      capacity:   capacityProxy(readings, design, setKey),
      airflow:    (function () {
        const perTon = cfmPerTon(readings, design);
        if (perTon === null) {
          /* No measured airflow. Fall back to the technician's airside rating
             so the dimension is not silently dropped, and mark it provisional. */
          const rated = conditionScore(ratings, ["hvac_airside"]);
          if (!rated.available) return { available: false, reason: "no-airflow-measurement" };
          return { available: true, pct: rated.pct, basis: "technician airside rating", provisional: true };
        }
        const min = (config.hvacScoring.designDefaults.cfmPerTonMin || {}).value || 350;
        const max = (config.hvacScoring.designDefaults.cfmPerTonMax || {}).value || 450;
        /* The band itself is a draft (config marks it so), and this is the
           only scored dimension judged against a number the tech team has not
           signed off. Nothing read that flag, so it said so nowhere. */
        const banded = (config.hvacScoring.designDefaults.cfmPerTonMin || {}).draft
          ? "measured CFM per ton, against a draft " + min + "-" + max + " band"
          : "measured CFM per ton, " + min + "-" + max;
        if (perTon >= min && perTon <= max) return { available: true, pct: 100, value: perTon, basis: banded, draftBand: true };
        const out = perTon < min ? min - perTon : perTon - max;
        return { available: true, pct: Math.max(0, Math.round(100 - (out / min) * 100)), value: perTon, basis: banded, draftBand: true };
      })(),
      charge:     chargeScore(ratings),
      static:     staticScore(readings, design),
      electrical: electricalScore(readings, design)
    };

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
      } else {
        notScored.push({ id: key, label: dim.label, reason: (result || {}).reason || "unavailable" });
      }
    });

    /* Nothing measurable at all is not a score of zero. */
    if (weightUsed === 0) {
      return { available: false, score: null, coverage: 0, scored: [], notScored: notScored,
               reason: "Nothing on this system could be evaluated against its design." };
    }

    /*
     * A COVERAGE FLOOR.
     *
     * Without one, a system with no nameplate data on record scored 100 -- a
     * perfect grade earned on two dimensions out of five, presented with the
     * same confidence as a full assessment. That is the same defect as scoring
     * an appliance with no established age: the number is not wrong so much as
     * it is not what it appears to be.
     *
     * Below the floor the dimensions are still reported individually, and the
     * report asks for the plate data by name. There is just no single number,
     * because there is nothing a single number could honestly mean.
     *
     * measureQuick draws this line harder still -- no score at all unless all
     * nine channels are live -- and they are right to.
     */
    const coverage = Math.round(weightUsed * 100);
    if (coverage < MIN_COVERAGE) {
      return {
        available: false,
        score: null,
        coverage: coverage,
        scored: scored,
        notScored: notScored,
        reason: "Only " + coverage + "% of this system could be evaluated against its design, "
          + "which is not enough for a health score. The readings taken are below, and the "
          + "nameplate data needed to score the rest is listed with them."
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
      return id !== "temperatureRise";
    });
    return wanted.map(function (id) {
      const spec = DERIVED[id];
      const value = spec.compute(readings, design);
      return { id: id, label: spec.label, unit: spec.unit, value: value,
               scoredUnder: spec.targetFrom };
    }).filter(function (row) { return row.value !== null; });
  }

  window.WILSON_HVAC = {
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

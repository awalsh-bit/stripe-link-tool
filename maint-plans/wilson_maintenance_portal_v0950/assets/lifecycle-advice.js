(function () {
  /*
   * Longevity guidance.
   *
   * WHAT THIS IS FOR
   * ----------------
   * A homeowner reading a health report has one question: do I fix this or
   * replace it. Wilson sold most of these appliances to these customers, so the
   * honest answer is almost always "keep it running, and here is what that
   * takes". This module exists to make that the default and to make the
   * alternative hard to reach.
   *
   * THE STRUCTURAL GUARD
   * --------------------
   * Replacement is NEVER suggested for an appliance that still has expected
   * life remaining AND has an identified serviceable cause. A dirty condenser
   * is a cleaning, not a sales opportunity, and a tool that blurs that is a
   * sales funnel wearing a health report's clothes. `posture` cannot return
   * "plan" while `serviceable` is true and life remains -- see the rule table.
   *
   * WHAT IT REFUSES TO INVENT
   * -------------------------
   * It computes only what it can know: life used, whether decline is faster
   * than ageing explains, and what remaining life looks like. Repair and
   * replacement costs come from Wilson -- they are inputs, never estimates
   * generated here. With no costs supplied, no economics are shown at all.
   *
   * THE HONEST COMPARISON
   * ---------------------
   * When costs ARE supplied, the number that matters is cost per remaining
   * year, not sticker price. It is the comparison that usually favours repair,
   * which is exactly why it is the one to show.
   */

  const RULES = {
    /* Past this share of expected life, "how much longer" becomes the real
       question rather than a theoretical one. */
    matureRatio: 0.85,

    /* A condition score this far below what age alone predicts means something
       is actually wrong -- which means something is fixable. */
    conditionGapPoints: 8,

    /* Below this, remaining life is too short to plan maintenance around. */
    minPlanYears: 1.5,
  };

  const POSTURE = {
    maintain: {
      code: "maintain",
      label: "Keep maintaining",
      tone: "good",
      lead: "This appliance is performing in line with its age. Staying on the maintenance interval is all it needs.",
    },
    service: {
      code: "service",
      label: "Service now, keep the appliance",
      tone: "action",
      /* "It has a known cause" was a diagnosis. What the tool actually has
         is a reading that moved and a technician who can go and look;
         trend-analysis.js is explicit that its signals are not causes. */
      lead: "Something specific is drifting, and it is the kind of thing a technician can trace at a maintenance visit. Addressing it now is what keeps this appliance on its expected life rather than shortening it.",
    },
    watch: {
      code: "watch",
      label: "Maturing — worth planning around",
      tone: "watch",
      lead: "This appliance is late in its expected life and still performing. Nothing needs replacing; it is worth knowing where it stands so a failure is not a surprise.",
    },
    /*
     * Rewritten in v0.9.16. The old lead said "replacement is worth planning
     * for rather than reacting to" -- a replacement nudge on a customer's
     * report, triggered by age against a DRAFT life figure -- and promised the
     * repair "is costed below", which was false: `economics()` is not rendered
     * by any customer-facing page, so nothing was costed anywhere. Two rules
     * broken in one sentence: no replacement steer, and no claim the data does
     * not back.
     */
    plan: {
      code: "plan",
      label: "Past draft expected life",
      tone: "plan",
      lead: "This appliance is past its draft expected service life and its readings have moved. The findings below are serviceable items, and addressing them is what keeps it running.",
    },
  };

  /*
   * Absent is absent -- it is not zero.
   *
   * This read `Number(v)` and returned it whenever it was finite, and
   * `Number(null)` is 0. So an appliance with no established age arrived here as
   * age zero: brand new, life used 0%, a full age score. The one thing this
   * whole provenance change exists to prevent, sitting in a four-line helper.
   */
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /*
   * decline: the object from WILSON_TRENDS.forAsset (or null)
   * report:  the latest health report, which carries the lifecycle block
   */
  function assess(report, decline) {
    if (!report) return null;
    const life = report.lifecycle || {};
    const age = num(life.age);
    const expected = num(life.expectedYears);
    /*
     * No age, no lifecycle guidance -- and the reason is returned rather than
     * swallowed, so a caller can say WHY it has nothing to show instead of
     * silently omitting the section. Everything here divides by expected life;
     * with a null age that arithmetic produces NaN, and before v0.9.12 an
     * unestablished age arrived as 0, which read as a brand-new appliance.
     */
    if (age === null || expected === null || expected <= 0) {
      return { unavailable: true, reason: age === null ? "no-age" : "no-expected-life",
               ageSource: life.ageSource || "unknown",
               ageSourceLabel: life.ageSourceLabel || "Not established" };
    }

    const lifeUsed = age / expected;
    const remaining = Math.max(0, expected - age);

    /* Serviceable = a measured reading is off, which means there is something to
       fix. A score that is merely low with nothing measurably wrong is not. */
    const serviceSignals = (decline && decline.signals || []).filter(function (s) {
      return s.kind === "out" || s.kind === "projected";
    });
    const serviceable = serviceSignals.length > 0;

    /* Is the decline faster than age alone explains? The score is 75% current
       condition and 25% lifecycle, so a vital score well below the age score
       means the appliance is worse than its years -- and that gap is where the
       fixable problems live. */
    const vital = num(life.vitalScore);
    const ageScore = num(life.ageScore);
    const conditionGap = (vital !== null && ageScore !== null) ? ageScore - vital : null;
    const worseThanItsYears = conditionGap !== null && conditionGap >= RULES.conditionGapPoints;

    /*
     * Posture. Order matters, and the first rule is the guard: anything with a
     * serviceable cause and life left is a service job, full stop. It cannot
     * fall through to "plan" no matter how the score looks.
     */
    let posture;
    if (serviceable && lifeUsed < 1) {
      posture = POSTURE.service;
    } else if (lifeUsed >= 1 && (serviceable || worseThanItsYears || (decline && decline.signals.length))) {
      posture = POSTURE.plan;
    } else if (lifeUsed >= RULES.matureRatio) {
      posture = POSTURE.watch;
    } else if (serviceable || worseThanItsYears) {
      posture = POSTURE.service;
    } else {
      posture = POSTURE.maintain;
    }

    /* What would actually extend this appliance's life, taken from the signals
       rather than written generically. */
    const actions = serviceSignals.map(function (s) {
      return { label: s.label, why: s.headline, detail: s.detail };
    });

    return {
      age: age,
      expectedYears: expected,
      lifeUsed: lifeUsed,
      lifeUsedPct: Math.min(100, Math.round(lifeUsed * 100)),
      remainingYears: Math.round(remaining * 10) / 10,
      tier: life.tier || "",
      stage: life.stage || "",
      serviceable: serviceable,
      worseThanItsYears: worseThanItsYears,
      conditionGap: conditionGap,
      posture: posture,
      actions: actions,
      planWorthwhile: remaining >= RULES.minPlanYears,
      /* Where the age came from, carried through so any surface showing a
         lifecycle figure can say what the figure rests on. Guidance built on a
         guess is still guidance, but the reader is entitled to know. */
      ageSource: life.ageSource || "unknown",
      ageSourceLabel: life.ageSourceLabel || "",
      ageDocumented: Boolean(life.ageDocumented),
      installYear: life.installYear || null,
      ageSourceRef: life.ageSourceRef || "",
      unavailable: false,
    };
  }

  /*
   * Economics, only when Wilson supplies both costs. Cost per remaining year is
   * the comparison that is actually fair: a $6,000 replacement buying twenty
   * years is not obviously worse or better than an $800 repair buying four
   * until you divide.
   *
   * `repairBuysYears` is deliberately conservative -- a repair is assumed to
   * return the appliance to its remaining expected life, never to extend it
   * beyond. Claiming a repair adds life would be the thumb on the scale.
   */
  function economics(assessment, costs) {
    if (!assessment || !costs) return null;
    const repair = num(costs.repairCost);
    const replacement = num(costs.replacementCost);
    if (repair === null || replacement === null || replacement <= 0) return null;

    const repairYears = Math.max(0.5, assessment.remainingYears);
    const replacementYears = Math.max(1, assessment.expectedYears);
    const repairPerYear = repair / repairYears;
    const replacementPerYear = replacement / replacementYears;
    const repairShare = repair / replacement;

    return {
      repairCost: repair,
      replacementCost: replacement,
      repairBuysYears: Math.round(repairYears * 10) / 10,
      replacementBuysYears: replacementYears,
      repairPerYear: Math.round(repairPerYear),
      replacementPerYear: Math.round(replacementPerYear),
      repairSharePct: Math.round(repairShare * 100),
      /* The recommendation the arithmetic supports, stated plainly. Repair wins
         ties: an even comparison favours keeping what the customer already owns. */
      favours: repairPerYear <= replacementPerYear ? "repair" : "replacement",
      margin: Math.abs(Math.round(repairPerYear - replacementPerYear)),
    };
  }

  window.WILSON_LIFECYCLE = {
    rules: RULES,
    postures: POSTURE,
    assess: assess,
    economics: economics,
  };
})();

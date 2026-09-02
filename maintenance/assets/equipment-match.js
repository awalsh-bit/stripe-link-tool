/*
 * MATCHING A SALES INVOICE ONTO THE APPLIANCES A CUSTOMER ENROLLED   (v0.9.34)
 * ===========================================================================
 *
 * Cayden's workflow: "customer registers or accepts a quote on maint - it moves
 * into the command center. our internal team is then prompted to upload a sales
 * invoice if we have it to extract appliance info. or they can manually key it.
 * this should then live in the customer file."
 *
 * And, asked how invoice lines should meet enrolled appliances: "Auto match with
 * confirmation, park the extras."
 *
 * THE SHAPE OF THE PROBLEM
 * ------------------------
 * Registration deliberately does not ask for a brand -- Cayden: "i don't want to
 * force a customer to enter brand or model number during registration as that
 * will reduce our take rate". So a household arrives as a set of SLOTS: three
 * refrigerators, a dishwasher, a range, each with an id, a category and an area,
 * and nothing else.
 *
 * The invoice is the other half. It has eight products from 2019, in Wilson's
 * own line format, and the customer enrolled five of them. Somebody has to say
 * which line is which appliance.
 *
 * WHAT THIS MODULE IS, AND IS NOT
 * -------------------------------
 * It is a PROPOSAL ENGINE. It never writes anything and it never decides
 * anything: it returns matches with a confidence and a written reason, the slots
 * it could not fill, and the invoice lines nobody enrolled. A person confirms.
 *
 * That split is deliberate. The office is being asked "is this the dishwasher we
 * priced", which is a judgement about somebody's kitchen, and a tool that
 * silently attaches a serial number to the wrong machine is worse than one that
 * asks. Every proposal carries WHY it was made so the confirmation is a real
 * decision rather than a rubber stamp.
 *
 * THE RULES, IN ORDER
 * -------------------
 *   1. Nothing crosses a customer category. A dishwasher line never lands on a
 *      refrigerator slot, however well the areas line up. Category is the one
 *      thing registration actually established, so it is the one thing treated
 *      as fact.
 *   2. Inside a category, the best pairings go first: exact type AND area, then
 *      exact type, then area, then category alone.
 *   3. A line with quantity 3 offers three units. Two icemakers on one line is
 *      two appliances, and the household may have enrolled one of them.
 *   4. Surplus lines become EXTRAS -- parked on the customer file, never
 *      discarded. Cayden sold them; that is worth knowing even uncovered.
 *   5. Surplus slots stay UNMATCHED and keep asking. An appliance with no
 *      details is a queue item, not a failure.
 *
 * WHY THE GREEDY PASS IS SAFE HERE
 * --------------------------------
 * This is an assignment problem, and greedy assignment is not optimal in
 * general. It is used anyway because the sets are tiny (a large estate is ~20
 * appliances, and matching happens inside one category at a time -- usually two
 * or three candidates), and because a person confirms every pairing. Optimality
 * would buy a better first guess at the cost of a rule nobody in the office
 * could follow when it guessed differently than they expected. Explainable beats
 * optimal when a human is the next step.
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     Text handling. Areas arrive as free text on both sides -- a slot says
     "Main Kitchen", an invoice says "Kitchen" or "Main House" -- so they are
     compared on significant words rather than as strings.
     ------------------------------------------------------------------ */
  const STOPWORDS = ["the", "and", "of", "area", "room", "main", "house", "home"];

  function words(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(function (w) { return w && STOPWORDS.indexOf(w) === -1; });
  }

  /*
   * Areas agree when they share a significant word. "Main Kitchen" and "Kitchen"
   * agree; "Main House" and "Kitchen" do not, because "main" and "house" are
   * stopwords -- an invoice that says only "Main House" is telling us nothing
   * about which room, and should not be allowed to look like a match.
   */
  function areasAgree(a, b) {
    const wa = words(a), wb = words(b);
    if (!wa.length || !wb.length) return false;
    return wa.some(function (w) { return wb.indexOf(w) > -1; });
  }

  function bothNamedAnArea(a, b) {
    return words(a).length > 0 && words(b).length > 0;
  }

  /* ---------------------------------------------------------------------
     Candidate units. A line with quantity 3 is three appliances.
     ------------------------------------------------------------------ */

  /*
   * Both sides are normalised through WILSON_BRANDS.categoryForAsset before
   * anything is compared.
   *
   * They do not agree out of the box: a seeded or enrolled slot may carry
   * `type: "hood"` while the parser classifies the same product as
   * `ventilation`. A Wolf hood on the invoice and a Wolf hood on the plan then
   * look like two different categories and never match -- which is a silent
   * gap, not an error, and exactly the kind that survives a demo.
   */
  function categoryOf(record) {
    if (window.WILSON_BRANDS && window.WILSON_BRANDS.categoryForAsset) {
      return window.WILSON_BRANDS.categoryForAsset(record) || "";
    }
    return String((record && record.customerCategory) || "");
  }

  /*
   * A WashTower is one line and two maintained appliances -- the importer
   * already splits it that way, and matching has to as well, or a household
   * that enrolled a washer and a dryer would see one match and one gap.
   */
  function categoriesForLine(line) {
    const category = String(line.customerCategory || "");
    if (category === "washer_dryer" || category === "laundry_center") return ["washer", "dryer"];
    return [categoryOf(line)];
  }

  function unitsFromLines(lines) {
    const units = [];
    (lines || []).forEach(function (line, lineIndex) {
      const qty = Math.max(1, Number(line.quantity || 1));
      categoriesForLine(line).forEach(function (category) {
        for (let unit = 0; unit < qty; unit += 1) {
          units.push({
            /* Stable within one proposal, so a UI can key on it. */
            unitId: "line" + lineIndex + "_" + category + "_" + unit,
            lineIndex: lineIndex,
            unitIndex: unit,
            quantity: qty,
            category: category,
            exactType: (line.customerCategory === "washer_dryer" || line.customerCategory === "laundry_center")
              ? category : (line.exactType || ""),
            line: line
          });
        }
      });
    });
    return units;
  }

  /* ---------------------------------------------------------------------
     Scoring. Higher is better; every tier carries the sentence that explains
     it, because a confirmation screen that cannot say why is asking somebody
     to agree with an opinion they cannot see.
     ------------------------------------------------------------------ */
  const TIERS = [
    { score: 4, confidence: "high",
      test: function (slot, unit) {
        return sameExactType(slot, unit) && bothNamedAnArea(slot.location, unit.line.area)
          && areasAgree(slot.location, unit.line.area);
      },
      why: function (slot, unit) {
        return "Same appliance type and the same area (" + (slot.location || "—") + ")";
      } },
    { score: 3, confidence: "medium",
      test: function (slot, unit) { return sameExactType(slot, unit); },
      why: function (slot, unit) {
        return bothNamedAnArea(slot.location, unit.line.area)
          ? "Same appliance type, but the invoice says " + unit.line.area + " and this one is in " + slot.location
          : "Same appliance type; no area on the invoice to check against";
      } },
    { score: 2, confidence: "medium",
      test: function (slot, unit) {
        return bothNamedAnArea(slot.location, unit.line.area) && areasAgree(slot.location, unit.line.area);
      },
      why: function (slot, unit) {
        return "Same category and the same area (" + slot.location + "), but a different exact type";
      } },
    { score: 1, confidence: "low",
      test: function () { return true; },
      why: function (slot, unit) {
        return "Only the category matches — worth checking this is the right machine";
      } }
  ];

  function sameExactType(slot, unit) {
    const a = String(slot.exactType || slot.type || "").toLowerCase();
    const b = String(unit.exactType || "").toLowerCase();
    return Boolean(a) && Boolean(b) && a === b;
  }

  function scoreFor(slot, unit) {
    for (let i = 0; i < TIERS.length; i += 1) {
      if (TIERS[i].test(slot, unit)) {
        return { score: TIERS[i].score, confidence: TIERS[i].confidence, why: TIERS[i].why(slot, unit) };
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------------
     The proposal
     ------------------------------------------------------------------ */

  /*
   * `slots` are the household's enrolled assets. `lines` are parsed invoice
   * items. Nothing is written; the caller confirms and then calls the store.
   *
   * A slot that ALREADY has a brand is still offered a match -- re-importing a
   * corrected invoice is a real thing -- but it is flagged `wouldOverwrite` so
   * the screen can make that its own decision rather than quietly replacing a
   * detail a technician established in the field.
   */
  function propose(slots, lines) {
    const openSlots = (slots || []).filter(function (s) { return s && s.status !== "Removed"; });
    const units = unitsFromLines(lines);

    /* Every legal pairing, best first. Sorting once and walking it greedily is
       what makes the outcome independent of the order the office happens to
       upload files in. */
    const pairs = [];
    openSlots.forEach(function (slot) {
      units.forEach(function (unit) {
        if (categoryOf(slot) !== unit.category) return;          /* rule 1 */
        const scored = scoreFor(slot, unit);
        if (!scored) return;
        pairs.push({ slot: slot, unit: unit, score: scored.score,
                     confidence: scored.confidence, why: scored.why });
      });
    });
    pairs.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      /* Deterministic tie-break: slot order, then line order. Without it two
         runs over the same data could propose different pairings, and the
         office would be confirming something that moved. */
      if (a.slot.sortOrder !== b.slot.sortOrder) {
        return Number(a.slot.sortOrder || 0) - Number(b.slot.sortOrder || 0);
      }
      if (a.unit.lineIndex !== b.unit.lineIndex) return a.unit.lineIndex - b.unit.lineIndex;
      return a.unit.unitIndex - b.unit.unitIndex;
    });

    const takenSlots = {}, takenUnits = {};
    const matches = [];
    pairs.forEach(function (pair) {
      if (takenSlots[pair.slot.id] || takenUnits[pair.unit.unitId]) return;
      takenSlots[pair.slot.id] = true;
      takenUnits[pair.unit.unitId] = true;
      matches.push({
        slotId: pair.slot.id,
        slot: pair.slot,
        unitId: pair.unit.unitId,
        line: pair.unit.line,
        unit: pair.unit,
        confidence: pair.confidence,
        why: pair.why,
        /* A detail somebody already established is not overwritten silently. */
        wouldOverwrite: Boolean(pair.slot.brand || pair.slot.model || pair.slot.serial),
        serviceability: serviceabilityOf(pair.unit.line, pair.slot)
      });
    });

    const unmatched = openSlots.filter(function (s) { return !takenSlots[s.id]; });
    const extras = units.filter(function (u) { return !takenUnits[u.unitId]; })
      .map(function (u) {
        return { unitId: u.unitId, line: u.line, unit: u,
                 /* Why it is an extra, in the two ways it can happen. */
                 reason: openSlots.some(function (s) { return categoryOf(s) === u.category; })
                   ? "More on the invoice than the customer enrolled"
                   : "Nothing of this type is on the plan",
                 serviceability: serviceabilityOf(u.line, null) };
      });

    return {
      matches: matches,
      unmatched: unmatched,
      extras: extras,
      counts: {
        slots: openSlots.length,
        units: units.length,
        matched: matches.length,
        unmatched: unmatched.length,
        extras: extras.length,
        /* Confirmations that deserve a second look before somebody clicks. */
        lowConfidence: matches.filter(function (m) { return m.confidence === "low"; }).length,
        wouldOverwrite: matches.filter(function (m) { return m.wouldOverwrite; }).length,
        excluded: matches.concat(extras).filter(function (m) {
          return m.serviceability && m.serviceability.state !== "ok" && m.serviceability.state !== "unstated";
        }).length
      }
    };
  }

  /*
   * The guardrail, at the moment brand first becomes known.
   *
   * This is the point Cayden's tech question actually lands: "we already had a
   * tech ask if we could register 2 appliances for maintenance that we dont work
   * on". Registration cannot catch it, because registration does not ask for a
   * brand. Import can.
   */
  function serviceabilityOf(line, slot) {
    if (!window.WILSON_BRANDS) return null;
    return window.WILSON_BRANDS.serviceability({
      brand: (line && line.brand) || "",
      model: (line && line.model) || "",
      group: (slot && slot.group) || "",
      checkpointSet: (slot && slot.checkpointSet) || ""
    });
  }

  /*
   * What a confirmed match would write onto the slot. Separated from `propose`
   * so the screen can show it and the store can apply it without either of them
   * re-deriving it -- the same reason pricing lives in one place.
   *
   * A blank on the invoice never overwrites something already known. An invoice
   * with no serial does not erase a serial a technician photographed.
   */
  function detailsFrom(line, slot, ref) {
    const at = new Date().toISOString();
    const out = {};
    ["brand", "model", "serial"].forEach(function (field) {
      const value = String((line && line[field]) || "").trim();
      if (!value) return;
      if (slot && String(slot[field] || "").trim() === value) return;   /* no change, no churn */
      out[field] = { value: value, source: "invoice", ref: ref || (line && line.invoiceNumber) || "", at: at };
    });
    const year = Number(line && line.installYear);
    if (year && (!slot || Number(slot.installYear) !== year)) {
      out.installYear = { value: year, source: "invoice", ref: ref || (line && line.invoiceNumber) || "", at: at };
    }
    return out;
  }

  window.WILSON_MATCH = {
    propose: propose,
    detailsFrom: detailsFrom,
    /* Exposed for the QA suite and for a screen that wants to explain itself. */
    areasAgree: areasAgree,
    unitsFromLines: unitsFromLines,
    tiers: function () {
      return TIERS.map(function (t) { return { score: t.score, confidence: t.confidence }; });
    }
  };
})();

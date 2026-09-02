(function () {
  /*
   * ANSWERING A CHECK WITHOUT A KEYBOARD.
   *
   * The field tool is used one-handed, standing in front of an appliance, often
   * in bad light, by someone whose other hand is holding a probe. Every control
   * in here is a tap. The only typing left in the whole protocol is a note --
   * the one place where the words genuinely are the technician's.
   *
   * WHY NOT SLIDERS
   * ---------------
   * They were the obvious answer and they are the wrong one for readings. Two
   * reasons:
   *
   *   1. Precision. A 390px slider across a fifteen-degree band is about 11px
   *      per degree, and a thumb is worth two. Two degrees is the finding.
   *   2. A slider ALWAYS HAS A VALUE. There is no difference between "I
   *      measured 37" and "I dragged it near the middle". For a product whose
   *      entire claim is a reading you can defend, an unanswered reading must
   *      be able to look unanswered.
   *
   * So numbers are entered on a big in-app keypad: three taps for "37.4", no
   * OS keyboard, no zoom, no next-field hunting, and an empty value stays
   * visibly empty.
   *
   * THE RULE ABOUT LAST YEAR'S NUMBER
   * ---------------------------------
   * History is the most valuable thing this product accumulates and the most
   * dangerous thing to put in an input box. If last year's reading is sitting
   * there, the cheapest action in the world is to accept it -- and a year of
   * "same as last year" is indistinguishable from a year of not looking. So
   * the previous value is shown AFTER a number is entered, never before, and
   * never as a default.
   */

  const cfg = function () { return window.WILSON_CONFIG; };
  const esc = function (v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  /* ---------------------------------------------------------------------
     PASS / FAIL AND CATEGORY -> A SCORE

     A scored pass/fail still has to produce a number, and the mapping has to
     be stated somewhere rather than living in whoever writes the next screen.
     "Not tested" is not a failure and never scores: it is the same answer as
     "not applicable", which is exactly how a heat-pump dryer with no vent
     should be treated.
     ------------------------------------------------------------------ */
  const RESULT_SCORE = [
    { match: /^pass$/i,                       rating: 5 },
    { match: /^normal/i,                      rating: 5 },
    { match: /^(slow|codes stored|wear)/i,    rating: 3 },
    { match: /^(fail|not producing)/i,        rating: 1 },
    { match: /needs attention/i,              rating: 2 },
    { match: /^(not tested|not inspected|not observed)/i, rating: null }
  ];

  /*
   * LEGACY ONLY. Every option in plan-config.js now carries its own `score`,
   * written down and reviewable, and `scoreForOption` below prefers it.
   *
   * This regex remains for one reason: inspections recorded before v0.9.19 were
   * stored with a result string and no score, and re-opening one has to produce
   * the same number it produced then. Nothing new should reach it -- the audit
   * asserts every live option publishes a score, so a new option that forgot to
   * fails the build instead of silently landing here.
   */
  function ratingForResult(result) {
    for (let i = 0; i < RESULT_SCORE.length; i += 1) {
      if (RESULT_SCORE[i].match.test(String(result || ""))) return RESULT_SCORE[i].rating;
    }
    /* An unrecognised result must not silently become a 5. Treated as
       untested, which shows up as an unanswered check rather than a pass. */
    return null;
  }

  /*
   * What one option is worth.
   *
   * The published number wins. `score: null` is a DELIBERATE "this scores
   * nothing" -- "not accessible" is an honest answer, not a failure -- so the
   * key's presence is what distinguishes it from an option that simply forgot,
   * and only a missing key falls through to the legacy wording match.
   */
  function scoreForOption(option) {
    if (option && Object.prototype.hasOwnProperty.call(option, "score")) {
      return option.score === null || option.score === undefined ? null : Number(option.score);
    }
    return ratingForResult(option && option.result);
  }

  /*
   * Apply a chosen option to a check.
   *
   * Returns the check so a caller can chain, and mutates in place because the
   * draft object IS the record the field tool autosaves.
   */
  function applyOption(check, answer, code) {
    const option = (answer.options || []).find(function (o) { return o.code === code; });
    if (!option) return check;
    check.selection = option.code;
    check.selectionLabel = option.label;
    check.selectionResult = option.result;
    check.performed = true;

    /*
     * Some answers are not finished when they are chosen.
     *
     * "Codes present" without the code tells a customer a fault exists and
     * throws away the only part of it anybody can act on. Choosing it therefore
     * leaves the check INCOMPLETE until the code is entered -- see isDone in
     * tech-maintenance.js -- and changing the answer to something else clears
     * the demand and any code already recorded, so a stale code can never ride
     * along on a different answer.
     */
    if (option.requiresDetail) {
      check.detailRequired = option.requiresDetail;
      check.detailLabel = option.detailLabel || "Code shown on the display";
    } else {
      check.detailRequired = "";
      check.detailLabel = "";
      check.detail = "";
    }

    /*
     * A flagged answer raises a finding whether or not it also scores.
     *
     * Kept separate from the score on purpose: "heavy build-up beyond reach"
     * scores a 3 and still needs saying out loud, and a 5-scoring answer never
     * raises one. The report reads this flag rather than re-testing the wording.
     */
    check.observedAttention = Boolean(option.attention);

    /*
     * THE REASON IS PART OF THE ANSWER.                          (v0.9.39)
     *
     * The field team's rule: concern or fail prompts for a note as to why.
     * Enforced here as data -- the option carries `noteRequired`, the check
     * inherits it, and isDone/completionReadiness refuse to call the check
     * finished without it. Switching back to Pass clears the demand AND the
     * reason already written, because a reason for a verdict that no longer
     * stands must not ride along on the one that replaced it.
     */
    check.noteRequired = Boolean(option.noteRequired);
    if (!check.noteRequired) {
      check.note = "";
      check.noteText = "";
      check.noteReasons = [];
      /* A return-visit flag hangs off a concern or fail. A verdict that went
         back to Pass has nothing to come back for. */
      check.followUp = false;
    }

    if (!answer.scores) {
      /*
       * No rating at all -- and `null` is how you say that, not 0.
       *
       * Zero is this product's sentinel for "not answered": storing it printed a
       * bold 0 next to a door seal a technician had just called Good, painted
       * the card red, flagged the whole appliance, and reached the customer's
       * report as status "Action". Cayden found all of that in ten minutes.
       *
       * As of v0.9.19 conditions DO score, so this branch is the trend answers
       * and anything whose kind says it cannot score.
       */
      check.rating = null;
      check.notApplicable = false;
      check.observationOnly = true;
      return check;
    }

    /* The score the option publishes. Not a regex over its label -- see
       scoreForOption. */
    const rating = scoreForOption(option);
    check.observationOnly = answer.kind === "observed";
    if (rating === null) {
      check.notApplicable = true;
      check.rating = 0;
    } else {
      check.notApplicable = false;
      check.rating = rating;
    }
    return check;
  }

  /* X of Y -> a score. 6 of 6 is 5/5; 4 of 6 is a real deduction a customer
     can check for themselves by counting burners. */
  function applyCount(check, count, total) {
    check.count = Number(count);
    check.countOf = Number(total);
    check.performed = Number.isFinite(check.count) && Number.isFinite(check.countOf) && check.countOf > 0;
    check.notApplicable = false;
    if (!check.performed) { check.rating = 0; return check; }
    const share = Math.max(0, Math.min(1, check.count / check.countOf));
    /* 1 is the floor rather than 0: a rating of zero is how this product marks
       "not answered", and "none of the six burners light" is very much an
       answer. */
    check.rating = Math.max(1, Math.round(share * 5));
    return check;
  }

  /* ---------------------------------------------------------------------
     RENDERING
     ------------------------------------------------------------------ */
  /*
   * WHAT THE ANSWER IS WORTH, ON THE BUTTON.
   *
   * Cayden's condition for scoring conditions: "predefined scores for
   * observables, where its clear to the tech what to click so we get mostly
   * consistent results." A technician who cannot see what an answer costs is
   * guessing at the consequence, and a hidden score is how a tool starts
   * feeling arbitrary and stops being trusted.
   *
   * So the number is printed. It reads "3 of 5" on the button, "no score" where
   * the answer is "I could not get to it", and nothing at all on a check whose
   * answers do not score. Showing it also makes the dirt rule visible: the
   * "cleaned at this visit" option sits there saying 5 of 5, the same as
   * pristine, which is easier to believe than a promise in a manual.
   */
  function optionScoreTag(option, answer) {
    if (!answer.scores) return "";
    const score = scoreForOption(option);
    if (score === null) return '<span class="tech-opt-score none">no score</span>';
    return '<span class="tech-opt-score s' + score + '">' + score + ' of 5</span>';
  }

  function optionButtons(check, index, answer) {
    const rows = (answer.options || []).map(function (o) {
      const on = check.selection === o.code;
      return '<button type="button" class="tech-opt' + (on ? " selected" : "") +
        (o.attention ? " attention" : "") + '" data-answer-option="' + index + ":" + esc(o.code) + '"' +
        ' aria-pressed="' + (on ? "true" : "false") + '">' +
        '<span class="tech-opt-label">' + esc(o.label) + '</span>' +
        '<span class="tech-opt-meta"><span class="tech-opt-result">' + esc(o.result) + '</span>' +
        optionScoreTag(o, answer) + '</span></button>';
    }).join("");
    return '<div class="tech-opts" role="group" aria-label="' + esc(answer.label || check.name) + '">' + rows + '</div>';
  }

  function countControl(check, index, answer) {
    const total = Number(check.countOf) || 0;
    const count = check.count === null || check.count === undefined ? null : Number(check.count);
    const totals = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
    if (!total) {
      return '<div class="tech-count"><span class="tech-count-ask">' +
        esc(answer.countLabel || "How many are there?") + '</span>' +
        '<div class="tech-count-row">' + totals.map(function (n) {
          return '<button type="button" class="tech-count-btn" data-answer-total="' + index + ":" + n + '">' + n + '</button>';
        }).join("") + '</div></div>';
    }
    let buttons = "";
    for (let n = 0; n <= total; n += 1) {
      buttons += '<button type="button" class="tech-count-btn' + (count === n ? " selected" : "") +
        '" data-answer-count="' + index + ":" + n + '" aria-pressed="' + (count === n ? "true" : "false") + '">' + n + "</button>";
    }
    return '<div class="tech-count"><span class="tech-count-ask">How many of the ' + total + ' ' +
      esc((answer.countLabel || "are operating").toLowerCase()) + '?' +
      ' <button type="button" class="tech-count-reset" data-answer-total="' + index + ':0">change total</button></span>' +
      '<div class="tech-count-row">' + buttons + '</div>' +
      (count !== null ? '<strong class="tech-count-result">' + count + " of " + total + "</strong>" : "") +
      '</div>';
  }

  function keypadValueButton(check, index, answer, field) {
    const key = field ? field.key : "__reading";
    const raw = field
      ? (check.readings || {})[field.key]
      : check.reading;
    const has = raw !== null && raw !== undefined && String(raw).trim() !== "";
    const unit = (field && field.unit) || check.unit || "";
    const label = field ? field.label : (check.readingLabel || "Reading");
    return '<button type="button" class="tech-keypad-open' + (has ? " filled" : "") + '"' +
      ' data-answer-keypad="' + index + ":" + esc(key) + '">' +
      '<span class="tech-keypad-label">' + esc(label) +
      (field && field.required ? ' <em>required</em>' : "") + '</span>' +
      '<span class="tech-keypad-value">' + (has ? esc(raw) + esc(unit ? " " + unit : "") : "tap to enter") + '</span>' +
      '</button>';
  }

  /*
   * THE NUMBER PAD APPEARS ONLY WHERE A NUMBER IS THE ANSWER.
   *
   * This used to read `if (answer.control === "keypad" || check.readingLabel)`,
   * and every checkpoint in the product carried a readingLabel left over from
   * the typed UI -- "Leak result", "Seal condition", "Codes / result". So 57 of
   * 78 checks opened a number pad for an answer that was never a number: a
   * rubber door seal asked to be entered as a figure, and the pass/fail buttons
   * that were the actual answer sat underneath it looking optional.
   *
   * The rule now is the honest one: a pad if and only if this check takes a
   * reading, and every reading is a NAMED field. `fieldsFor` is the single
   * place that decides.
   */
  function fieldsFor(check, answer) {
    const fromAnswer = (answer && answer.readingFields) || [];
    const base = fromAnswer.length
      ? fromAnswer
      : (Array.isArray(check.readingFields) && check.readingFields.length ? check.readingFields : []);
    /*
     * A field behind a toggle exists only while the toggle is on. The gas
     * checkbox is the case: tick "Gas appliance" and the manometer reading
     * appears AND becomes required; untick it and the field -- and its
     * requiredness -- are gone, so an electric cooktop is never blocked on a
     * gas pressure it cannot have. One filter, here, because the renderer,
     * the completion gate and the report all ask this same function.
     */
    return base.filter(function (f) {
      /* v0.9.41, the inverse: `toggleOff` names a tick that WAIVES the field.
         The dryer vent static is the case -- required on every normal
         install, gone when the tech ticks "can't access the vent", because
         Cayden: "there are many instances of bad installs where we cant get
         to the vent during maint." Same one filter, same three callers. */
      if (f.toggleOff) return !((check.toggles || {})[f.toggleOff]);
      if (!f.toggle) return true;
      return Boolean((check.toggles || {})[f.toggle]);
    });
  }

  function readingButtons(check, index, answer) {
    const fields = fieldsFor(check, answer);
    if (fields.length) {
      return '<div class="tech-keypad-fields">' + fields.map(function (f) {
        return keypadValueButton(check, index, answer, f);
      }).join("") + '</div>' + derivedLine(check, answer);
    }
    if (answer.control === "keypad") {
      return '<div class="tech-keypad-fields">' + keypadValueButton(check, index, answer, null) + '</div>';
    }
    return "";
  }

  /*
   * The number the tool works out for itself.
   *
   * An oven set to 350 that measures 327 is 23 degrees low, and that
   * subtraction is the finding -- not either number on its own. Showing it the
   * moment both readings are in is also the cheapest possible check on a
   * transposed digit, while the technician is still standing at the appliance.
   */
  function derivedValue(check, answer) {
    const spec = answer && answer.derived;
    if (!spec || !Array.isArray(spec.from) || spec.from.length !== 2) return null;
    const readings = check.readings || {};
    const a = Number(readings[spec.from[0]]);
    const b = Number(readings[spec.from[1]]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const value = spec.op === "subtract" ? a - b : null;
    if (value === null) return null;
    return { label: spec.label || "Difference", unit: spec.unit || "", value: Math.round(value * 10) / 10 };
  }

  function derivedLine(check, answer) {
    const d = derivedValue(check, answer);
    if (!d) return "";
    const sign = d.value > 0 ? "+" : "";
    return '<div class="tech-derived-inline"><span>' + esc(d.label) + '</span>' +
      '<strong>' + sign + d.value + esc(d.unit ? " " + d.unit : "") + '</strong></div>';
  }

  /* The one-line explanation of what this check IS, shown on the card. A
     technician who knows a reading is not scored answers it differently -- and
     more honestly -- than one who thinks it is. */
  function kindBadge(answer) {
    if (answer.kind === "scored") return "";
    return '<span class="tech-kind tech-kind-' + esc(answer.kind) + '" title="' + esc(answer.kindBlurb) + '">' +
      esc(answer.kindLabel) + '</span>';
  }

  function maintenanceChips(setKey, selected) {
    const actions = window.WILSON_ANSWERS.maintenance(setKey);
    if (!actions.length) return "";
    const chosen = selected || [];
    return '<section class="tech-maint-card">' +
      '<div class="tech-maint-head"><strong>Maintenance performed</strong>' +
      '<small>Tap what you did. This is what the customer sees their money bought &mdash; ' +
      'and it never changes the health score.</small></div>' +
      '<div class="tech-chips">' + actions.map(function (a) {
        const on = chosen.indexOf(a.id) >= 0;
        return '<button type="button" class="tech-chip' + (on ? " selected" : "") + '"' +
          ' data-maint="' + esc(a.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
          (on ? "✓ " : "+ ") + esc(a.label) + '</button>';
      }).join("") + '</div></section>';
  }

  /*
   * The control for one check. `rating` is still here because a genuinely
   * subjective condition call (operating sound, component wear) is honestly a
   * judgement and is scored as one -- what changed is that it is no longer the
   * answer to everything.
   */
  /*
   * The follow-up an answer can demand.
   *
   * Only a fault code so far. It is alphanumeric -- F21, E24, 6E, HE -- so it
   * gets its own pad rather than the OS keyboard: a keyboard sliding up over
   * the card is exactly what this tool removed, and three taps on a letter grid
   * beats hunting for the number row with gloves on.
   */
  function detailControl(check, index) {
    if (!check.detailRequired) return "";
    const has = String(check.detail || "").trim() !== "";
    return '<div class="tech-detail-ask' + (has ? " filled" : " needed") + '">' +
      '<button type="button" class="tech-keypad-open' + (has ? " filled" : "") + '"' +
      ' data-answer-code="' + index + '">' +
      '<span class="tech-keypad-label">' + esc(check.detailLabel || "Code shown on the display") +
      (has ? "" : ' <em>required</em>') + '</span>' +
      '<span class="tech-keypad-value">' + (has ? esc(check.detail) : "tap to enter") + '</span>' +
      '</button>' +
      (has ? "" : '<small>The code is the part anybody can act on. Enter it as shown, or every ' +
                  'code on the display separated by a space.</small>') +
      '</div>';
  }

  /*
   * THE VERDICT.                                                (v0.9.39)
   *
   * Three buttons, always the same three, scores on their faces. Pass is one
   * tap and done. Concern and fail open the reason area underneath: the reason
   * menu for this check (the old anchored vocabularies, surviving as tappable
   * phrases) plus the technician's own words, and the check is not finished
   * until a reason exists.
   */
  function verdictButtons(check, index, answer) {
    const rows = (answer.options || []).map(function (o) {
      const on = check.selection === o.code;
      return '<button type="button" class="tech-verdict-btn verdict-' + esc(o.code) + (on ? " selected" : "") + '"' +
        ' data-answer-option="' + index + ":" + esc(o.code) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
        '<strong>' + esc(o.label) + '</strong>' +
        '<span>' + (o.score === null ? "no score" : o.score + " of 5") + '</span>' +
        '</button>';
    }).join("");
    return '<div class="tech-verdict-row">' + rows + '</div>' + reasonArea(check, index, answer);
  }

  /*
   * The fuel toggle: a checkbox chip that reveals readings. "need check box
   * for tech to hit if gas, which would populate the gas pressure readout
   * entry" -- Cayden. Rendered ABOVE the readings so ticking it visibly adds
   * the field right below the tick.
   */
  function toggleChip(check, index, answer) {
    if (!answer.toggle) return "";
    const on = Boolean((check.toggles || {})[answer.toggle.key]);
    return '<div class="tech-fuel-toggle">' +
      '<button type="button" class="tech-chip' + (on ? " selected" : "") + '"' +
      ' data-answer-toggle="' + index + ":" + esc(answer.toggle.key) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
      (on ? "✓ " : "+ ") + esc(answer.toggle.label) + '</button></div>';
  }

  function reasonArea(check, index, answer) {
    if (!check.noteRequired) return "";
    const chosen = check.noteReasons || [];
    const chips = (answer.reasons || []).map(function (r) {
      const on = chosen.indexOf(r) >= 0;
      return '<button type="button" class="tech-reason-chip' + (on ? " selected" : "") + '"' +
        ' data-answer-reason="' + index + ":" + esc(r) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
        (on ? "✓ " : "") + esc(r) + '</button>';
    }).join("");
    const has = String(check.note || "").trim() !== "";
    /*
     * THE RETURN-VISIT FLAG.                                    (v0.9.39)
     *
     * Cayden: a technician who finds something that cannot be resolved during
     * maintenance -- a duct run packing with lint, an icemaker that needs a
     * teardown -- flags it here, at their discretion, and the office picks it
     * up as a return service order to quote, get approved, and schedule. The
     * flag only exists on a concern or fail, because a passing check has
     * nothing to come back for.
     */
    const flagged = Boolean(check.followUp);
    return '<div class="tech-reason-area' + (has ? " filled" : " needed") + '">' +
      '<div class="tech-reason-head"><strong>Why?</strong><small>' +
      (has ? "Recorded. It goes on the report beside this check." : "Required — tap what applies, or write it, before this check counts.") +
      '</small></div>' +
      (chips ? '<div class="tech-reason-chips">' + chips + '</div>' : "") +
      '<div class="tech-note-field" data-note-field="' + index + '">' +
      '<input data-note="' + index + '" aria-label="Reason for ' + esc(check.name) + '"' +
      ' value="' + esc(check.noteText || "") + '" placeholder="Own words (optional if a reason above is ticked)"></div>' +
      '<button type="button" class="tech-followup-flag' + (flagged ? " selected" : "") + '"' +
      ' data-answer-followup="' + index + '" aria-pressed="' + (flagged ? "true" : "false") + '">' +
      (flagged ? "✓ Return visit flagged — the office will quote and schedule it" : "⚑ Needs a return visit — flag it for the office") +
      '</button>' +
      '</div>';
  }

  function control(check, index, answer) {
    const readings = readingButtons(check, index, answer);
    if (answer.control === "verdict") {
      return toggleChip(check, index, answer) + readings + verdictButtons(check, index, answer) + detailControl(check, index);
    }
    if (answer.control === "passfail" || answer.control === "category") {
      return readings + optionButtons(check, index, answer) + detailControl(check, index);
    }
    if (answer.control === "count") {
      return readings + countControl(check, index, answer);
    }
    if (answer.control === "keypad") {
      /* A trend measurement needs no judgement beside it: the number IS the
         answer, and a rating next to it would be the opinion we are removing. */
      return readings;
    }
    /* Default: the 1-5 rating, for the checks where a condition judgement
       genuinely IS the answer -- operating sound, component wear. The caller
       appends its own rating buttons after this, which is why nothing is
       returned for it here. */
    return readings;
  }

  /* ---------------------------------------------------------------------
     THE KEYPAD

     One overlay, reused. Big keys, no OS keyboard, and a "Not measured"
     action that is a real answer rather than an empty box.
     ------------------------------------------------------------------ */
  const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "-", "0", "."];
  /* The code pad. Digits first because most fault codes start with a letter and
     end in digits, and both halves have to be reachable without a mode switch.
     Six columns fits a 44px key inside a 390px phone. */
  const CODE_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", " ",
                     "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
                     "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X",
                     "Y", "Z"];
  let pending = null;

  function keypadMarkup() {
    return '<div class="tech-keypad-sheet" id="tech-keypad" hidden role="dialog" aria-modal="true" aria-label="Enter a reading">' +
      '<div class="tech-keypad-inner">' +
      '<div class="tech-keypad-top"><strong id="tech-keypad-title">Reading</strong>' +
      '<small id="tech-keypad-target"></small></div>' +
      '<div class="tech-keypad-display"><span id="tech-keypad-value">&mdash;</span><em id="tech-keypad-unit"></em></div>' +
      '<div class="tech-keypad-keys" id="tech-keypad-numeric">' +
      KEYS.map(function (k) {
        return '<button type="button" class="tech-key" data-key="' + k + '">' + (k === "-" ? "&minus;" : k) + '</button>';
      }).join("") +
      '<button type="button" class="tech-key wide" data-key="back">&#9003;</button>' +
      '<button type="button" class="tech-key na" data-key="na">Not measured</button>' +
      '<button type="button" class="tech-key done" data-key="done">Done</button>' +
      '</div>' +
      '<div class="tech-keypad-keys code" id="tech-keypad-code" hidden>' +
      CODE_KEYS.map(function (k) {
        return '<button type="button" class="tech-key code" data-key="' + k + '">' +
          (k === " " ? "space" : k) + '</button>';
      }).join("") +
      '<button type="button" class="tech-key wide" data-key="back">&#9003;</button>' +
      '<button type="button" class="tech-key done wide" data-key="done">Done</button>' +
      '</div>' +
      '</div></div>';
  }

  function ensureKeypad() {
    let node = document.getElementById("tech-keypad");
    if (!node) {
      const host = document.createElement("div");
      host.innerHTML = keypadMarkup();
      node = host.firstChild;
      document.body.appendChild(node);
      bindKeypad(node);
    }
    return node;
  }

  function bindKeypad(node) {
    node.querySelectorAll("[data-key]").forEach(function (btn) {
      btn.onclick = function () {
        const key = btn.dataset.key;
        if (!pending) return;
        if (key === "done") { closeKeypad(true); return; }
        if (key === "na") { pending.value = ""; closeKeypad(true, true); return; }
        if (key === "back") { pending.value = pending.value.slice(0, -1); paintKeypad(); return; }
        /* A code is free-form text, so none of the numeric key rules apply to
           it: a minus is a character, not a sign, and there is no decimal
           point to keep unique. */
        if (pending.mode === "code") {
          if (pending.value.length < 24) pending.value += key;
          paintKeypad();
          return;
        }
        if (key === "-") {
          pending.value = pending.value.charAt(0) === "-" ? pending.value.slice(1) : "-" + pending.value;
        } else if (key === ".") {
          if (pending.value.indexOf(".") < 0) pending.value = (pending.value || "0") + ".";
        } else {
          pending.value = (pending.value === "0" ? "" : pending.value) + key;
        }
        paintKeypad();
      };
    });
    /* Tapping the dimmed area behind the sheet is the expected way out, and it
       keeps what was typed -- the same as Done. Nothing here is destructive. */
    node.onclick = function (event) { if (event.target === node) closeKeypad(true); };
  }

  function paintKeypad() {
    const value = document.getElementById("tech-keypad-value");
    if (value) value.textContent = pending && pending.value !== "" ? pending.value : "—";
  }

  function openKeypad(opts) {
    const node = ensureKeypad();
    const mode = opts.mode === "code" ? "code" : "number";
    pending = { value: String(opts.value === null || opts.value === undefined ? "" : opts.value),
                onDone: opts.onDone, mode: mode };
    /* One overlay, two key sets. A code pad with a "Not measured" key would be
       nonsense -- the technician has already said a code is present -- so the
       numeric block is hidden rather than restyled. */
    const numeric = document.getElementById("tech-keypad-numeric");
    const codes = document.getElementById("tech-keypad-code");
    if (numeric) numeric.hidden = mode === "code";
    if (codes) codes.hidden = mode !== "code";
    document.getElementById("tech-keypad-title").textContent = opts.title || "Reading";
    document.getElementById("tech-keypad-unit").textContent = opts.unit || "";
    const target = document.getElementById("tech-keypad-target");
    /*
     * The target band, and LAST YEAR'S READING ONLY IF ONE IS BEING SHOWN
     * AFTER ENTRY -- never as a starting value. See the header note: a
     * pre-filled history is an invitation to confirm rather than measure.
     */
    target.textContent = opts.target ? "Target " + opts.target : (opts.hint || "");
    node.hidden = false;
    document.body.classList.add("keypad-open");
    paintKeypad();
  }

  /*
   * What leaves the keypad is what the customer eventually reads, so it is
   * tidied here rather than at every call site. A tech who taps 3 8 . and then
   * Done means 38, not "38." on a printed report; a lone minus sign or a lone
   * decimal point is nothing at all, and must not be stored as a reading that
   * looks like an answer. Nothing about the NUMBER changes -- only the stray
   * punctuation around it.
   */
  function tidyReading(raw) {
    let value = String(raw === null || raw === undefined ? "" : raw).trim();
    if (value === "" || value === "-" || value === "." || value === "-.") return "";
    if (value.charAt(value.length - 1) === ".") value = value.slice(0, -1);
    if (value === "-" || value === "") return "";
    return value;
  }

  function closeKeypad(save, notMeasured) {
    const node = document.getElementById("tech-keypad");
    if (node) node.hidden = true;
    document.body.classList.remove("keypad-open");
    const done = pending && pending.onDone;
    const value = (pending && pending.mode === "code")
      ? String(pending.value || "").trim().toUpperCase().replace(/\s+/g, " ")
      : tidyReading(pending ? pending.value : "");
    pending = null;
    if (save && done) done(value, Boolean(notMeasured));
  }

  window.WILSON_INPUT = {
    control: control,
    verdictButtons: verdictButtons,
    optionButtons: optionButtons,
    countControl: countControl,
    readingButtons: readingButtons,
    kindBadge: kindBadge,
    maintenanceChips: maintenanceChips,
    applyOption: applyOption,
    applyCount: applyCount,
    ratingForResult: ratingForResult,
    scoreForOption: scoreForOption,
    openKeypad: openKeypad,
    closeKeypad: closeKeypad,
    tidyReading: tidyReading,
    fieldsFor: fieldsFor,
    derivedValue: derivedValue,
    keypadIsOpen: function () { return Boolean(pending); }
  };
})();

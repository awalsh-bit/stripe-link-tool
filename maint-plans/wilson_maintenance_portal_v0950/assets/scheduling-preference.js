/*
 * WHEN MAINTENANCE SUITS THE CUSTOMER -- collected as facts, not prose.
 *
 * This replaces a free-text "Preferred timing" box. Customers filled it in with
 * things like "March / September", which is useful to a person reading it and
 * useless to anything else: the office had to interpret a sentence, and none of
 * the things that actually make a visit fail on arrival were captured at all --
 * nobody home, a gate with no code, a dog in the yard, the family away for July.
 *
 * WHY THIS IS NOT A CALENDAR.  ePass owns Wilson's schedule and has no open API,
 * so a date picked here is a date Wilson cannot honour without re-entering it by
 * hand -- while the customer believes it is booked. A promise the software
 * cannot keep is worse than no promise, so nothing here reserves a slot. When
 * the NetSuite migration makes service-order dates writable, THAT is when a
 * calendar becomes honest.
 *
 * WHY THERE ARE NO ENTRY CODES.  A gate or alarm code typed into a web form is a
 * code sitting in a database, and this page is the wrong place to collect one.
 * The customer records that a code EXISTS; Wilson collects it by phone. The
 * office still learns what it needs to plan the trip.
 *
 * Exposed as WILSON_SCHED_FORM so both signup screens mount the same control
 * rather than each growing its own copy.
 */
(function () {
  const ui = window.WilsonUI;

  function mount(options) {
    const opts = options || {};
    const sched = window.WILSON_SCHEDULING;
    if (!sched) return null;
    const vocab = sched.options();

    /* The live value. Ids only -- never a rendered string, because a string is
       something a later screen has to parse back. */
    const value = {
      months: [],
      days: [],
      timeOfDay: "any",
      access: [],
      blackouts: [],
      note: ""
    };

    const hosts = {
      months: document.getElementById(opts.monthsId || "sched-months"),
      days: document.getElementById(opts.daysId || "sched-days"),
      times: document.getElementById(opts.timesId || "sched-times"),
      access: document.getElementById(opts.accessId || "sched-access"),
      blackouts: document.getElementById(opts.blackoutsId || "sched-blackouts"),
      preview: document.getElementById(opts.previewId || "sched-preview")
    };
    if (!hosts.months) return null;

    function chip(id, label, on, group) {
      return `<button type="button" class="sched-chip${on ? " selected" : ""}" ` +
             `data-sched-group="${group}" data-sched-id="${id}" ` +
             `aria-pressed="${on ? "true" : "false"}">${ui.escapeHtml(label)}</button>`;
    }

    function renderChips() {
      hosts.months.innerHTML = vocab.months.map(function (m) {
        return chip(m.id, m.label, value.months.indexOf(m.id) >= 0, "months");
      }).join("");
      hosts.days.innerHTML = vocab.days.map(function (d) {
        return chip(d.id, d.label, value.days.indexOf(d.id) >= 0, "days");
      }).join("");
      /* Time of day is single-select: "mornings AND afternoons" is the same
         answer as "any time", and offering it as two chips invites a customer
         to say the same thing twice. */
      hosts.times.innerHTML = vocab.timesOfDay.map(function (t) {
        return chip(t.id, t.label, value.timeOfDay === t.id, "timeOfDay");
      }).join("");
      hosts.access.innerHTML = vocab.accessConstraints.map(function (a) {
        return chip(a.id, a.label, value.access.indexOf(a.id) >= 0, "access");
      }).join("");
      bindChips();
    }

    function toggle(list, id) {
      const at = list.indexOf(id);
      if (at >= 0) list.splice(at, 1); else list.push(id);
    }

    function bindChips() {
      document.querySelectorAll("[data-sched-group]").forEach(function (el) {
        el.onclick = function () {
          const group = el.dataset.schedGroup;
          const id = el.dataset.schedId;
          if (group === "timeOfDay") {
            /* Tapping the selected one clears back to "any" rather than
               trapping the customer in a choice they cannot undo. */
            value.timeOfDay = value.timeOfDay === id ? "any" : id;
          } else {
            toggle(value[group], id);
          }
          renderChips();
          renderBlackouts();
          renderPreview();
          if (typeof opts.onChange === "function") opts.onChange(read());
        };
      });
    }

    function renderBlackouts() {
      if (!hosts.blackouts) return;
      hosts.blackouts.innerHTML = value.blackouts.length
        ? value.blackouts.map(function (b, index) {
            const range = b.to && b.to !== b.from
              ? ui.shortDate(b.from) + " to " + ui.shortDate(b.to)
              : ui.shortDate(b.from);
            return `<div class="sched-blackout"><div><strong>${ui.escapeHtml(range)}</strong>` +
                   `${b.note ? `<small>${ui.escapeHtml(b.note)}</small>` : ""}</div>` +
                   `<button type="button" class="remove-button" data-sched-drop="${index}">Remove</button></div>`;
          }).join("")
        : "";
      hosts.blackouts.querySelectorAll("[data-sched-drop]").forEach(function (btn) {
        btn.onclick = function () {
          value.blackouts.splice(Number(btn.dataset.schedDrop), 1);
          renderBlackouts();
          renderPreview();
        };
      });
    }

    /*
     * Reads the preference back in the customer's OWN words before they submit.
     * The office-facing wording ("Wilson to collect the code by phone") is not
     * shown here -- that is an instruction to Wilson, and putting it in front of
     * the customer reads as though they have been given a task.
     */
    function renderPreview() {
      if (!hosts.preview) return;
      const empty = sched.isEmpty(read());
      hosts.preview.hidden = empty;
      if (empty) { hosts.preview.innerHTML = ""; return; }
      const bits = [];
      const months = sched.monthPhrase(value.months);
      if (months) bits.push("Months: " + months);
      const days = sched.dayPhrase(value.days);
      if (days) bits.push("Days: " + days);
      if (value.timeOfDay !== "any") {
        const t = vocab.timesOfDay.find(function (x) { return x.id === value.timeOfDay; });
        if (t) bits.push(t.label);
      }
      value.blackouts.forEach(function (b) {
        bits.push("Away " + ui.shortDate(b.from) + (b.to && b.to !== b.from ? "–" + ui.shortDate(b.to) : ""));
      });
      value.access.forEach(function (id) {
        const a = vocab.accessConstraints.find(function (x) { return x.id === id; });
        if (a) bits.push(a.label);
      });
      hosts.preview.innerHTML = `<strong>What we have noted</strong>` +
        `<span>${bits.map(ui.escapeHtml).join(" · ")}</span>` +
        `<em>Nothing here books a date. Wilson calls to arrange each visit.</em>`;
    }

    function addBlackout() {
      const from = (document.getElementById("sched-blackout-from") || {}).value || "";
      const to = (document.getElementById("sched-blackout-to") || {}).value || "";
      const note = ((document.getElementById("sched-blackout-note") || {}).value || "").trim();
      if (!from) {
        ui.toast("A start date is needed", "Pick the first day you will be away.");
        return;
      }
      /* A range that ends before it starts is a typo, not a constraint. */
      if (to && to < from) {
        ui.toast("Check those dates", "The end date is before the start date.");
        return;
      }
      /* Beyond the horizon it is a plan rather than a date, and it will have
         changed by the time a visit is due. */
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + Number(vocab.blackoutHorizonDays || 400));
      if (from > horizon.toISOString().slice(0, 10)) {
        ui.toast("That is a long way out",
                 "Wilson schedules within about a year. Mention it in the notes instead.");
        return;
      }
      value.blackouts.push({ from: from, to: to || from, note: note });
      ["sched-blackout-from", "sched-blackout-to", "sched-blackout-note"].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      renderBlackouts();
      renderPreview();
      if (typeof opts.onChange === "function") opts.onChange(read());
    }

    function read() {
      return {
        months: value.months.slice(),
        days: value.days.slice(),
        timeOfDay: value.timeOfDay,
        access: value.access.slice(),
        blackouts: value.blackouts.map(function (b) { return Object.assign({}, b); }),
        note: value.note
      };
    }

    function set(pref) {
      const incoming = pref || {};
      value.months = (incoming.months || []).slice();
      value.days = (incoming.days || []).slice();
      value.timeOfDay = incoming.timeOfDay || "any";
      value.access = (incoming.access || []).slice();
      value.blackouts = (incoming.blackouts || []).map(function (b) { return Object.assign({}, b); });
      value.note = incoming.note || "";
      renderChips();
      renderBlackouts();
      renderPreview();
    }

    const addButton = document.getElementById("sched-blackout-save");
    if (addButton) addButton.onclick = addBlackout;

    renderChips();
    renderBlackouts();
    renderPreview();

    return { read: read, set: set, isEmpty: function () { return sched.isEmpty(read()); } };
  }

  window.WILSON_SCHED_FORM = { mount: mount };
})();

/*
 * THE CUSTOMER LIST -- the second of the command center's two screens.
 *
 * The Households tab this replaces was a five-column table with a search box.
 * It answered "show me the households" and nothing else: there was no way to
 * find who was blocked on payment, or whose equipment had no install date, or
 * which houses had never had their water tested, without reading every row.
 *
 * Two things changed beyond moving it to its own page:
 *
 *   1. OPEN QUOTES ARE ON THE SAME LIST. A quote is an unaccepted enrollment,
 *      so a prospect is a customer Wilson does not have yet. Keeping them on a
 *      separate screen is how a sent quote gets forgotten.
 *   2. THE SEARCH GAINED FILTERS, each one a question the office actually asks.
 *
 * What this file does NOT do is show a household's filters, reports or history.
 * Those live on the household's own page, where they are about somebody rather
 * than about everybody -- which is the whole reason three tabs could retire.
 */
(function () {
  const ui = window.WilsonUI;
  const config = window.WILSON_CONFIG;
  const OPS = config.operations;
  let state = WilsonStore.load();
  let search = "";
  let active = null;

  function subsFor(id) { return state.subscriptions.filter((s) => s.householdId === id); }
  function assetsFor(id) { return state.assets.filter((a) => a.householdId === id); }
  function filtersFor(id) { return state.filters.filter((f) => f.householdId === id); }
  function nextVisitFor(id) {
    return state.visits
      .filter((v) => v.householdId === id && v.status !== "Completed")
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0] || null;
  }
  function paymentReady(household) {
    if (household.billingType === "AR Account") return true;
    const ids = subsFor(household.id).map((s) => s.paymentProfileId);
    const profiles = state.paymentProfiles.filter((p) => ids.indexOf(p.id) >= 0);
    return profiles.length > 0 && profiles.every((p) => p.status === "Ready");
  }
  function undatedAssets(household) {
    return assetsFor(household.id).filter((a) => !a.installYear).length;
  }
  function waterTested(household) {
    return Boolean(window.WILSON_WATER
      && window.WILSON_WATER.resolve(household.waterTest || null).tested);
  }

  /*
   * Each filter is a question somebody asks out loud. `count` is rendered on the
   * chip so an empty filter says so before it is clicked -- clicking through to
   * an empty list to learn nothing is worse than being told.
   */
  const FILTERS = [
    { id: "payment", label: "Payment problem",
      hint: "No ready card and not an AR account",
      match: function (row) { return row.kind === "household" && !paymentReady(row.household); } },
    { id: "filters_verify", label: "Filters to verify",
      hint: "A filter part number nobody has confirmed against the actual unit",
      match: function (row) {
        return row.kind === "household" && filtersFor(row.household.id)
          .some(function (f) { return !f.verified; });
      } },
    { id: "no_dates", label: "Missing install dates",
      hint: "Equipment with no install year -- age is a quarter of every health score",
      match: function (row) { return row.kind === "household" && undatedAssets(row.household) > 0; } },
    { id: "no_water", label: "Water never tested",
      hint: "No hardness reading on file, so expected life is unadjusted",
      match: function (row) { return row.kind === "household" && !waterTested(row.household); } },
    { id: "quotes", label: "Open quotes",
      hint: "Sent or drafted, not yet converted to an enrollment",
      match: function (row) { return row.kind === "quote"; } }
  ];

  /* One shape for both kinds, so sorting and filtering do not branch. */
  function rows() {
    const households = state.households.map(function (h) {
      return { kind: "household", household: h, name: h.name,
               haystack: [h.name, h.address1, h.city, h.zip,
                          subsFor(h.id).map((s) => s.planName).join(" ")].join(" ").toLowerCase() };
    });
    /* An accepted quote has a household and appears as that household -- listing
       it twice would double-count the customer. */
    const quotes = (state.quotes || []).filter((q) => !q.householdId).map(function (q) {
      return { kind: "quote", quote: q, name: q.propertyName,
               haystack: [q.propertyName, q.contactName, q.quoteNumber, q.address,
                          q.planName].filter(Boolean).join(" ").toLowerCase() };
    });
    return households.concat(quotes);
  }

  function visible() {
    let list = rows();
    if (search) list = list.filter((r) => r.haystack.indexOf(search) >= 0);
    if (active) {
      const f = FILTERS.find((x) => x.id === active);
      if (f) list = list.filter(f.match);
    }
    /* Quotes first when unfiltered: a prospect is the thing most likely to go
       cold, and a household is not going anywhere. */
    return list.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === "quote" ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function badge(value, tone) {
    return `<span class="badge ${tone || ""}">${ui.escapeHtml(value)}</span>`;
  }

  function householdRow(row) {
    const h = row.household;
    const subs = subsFor(h.id);
    const assets = assetsFor(h.id);
    const next = nextVisitFor(h.id);
    const due = filtersFor(h.id).filter((f) => !f.verified).length;
    const undated = undatedAssets(h);
    const flags = [];
    if (!paymentReady(h)) flags.push(badge("Payment problem", "danger"));
    if (due) flags.push(badge(due + " filter" + (due === 1 ? "" : "s") + " to verify", "warning"));
    if (undated) flags.push(badge(undated + " missing install date" + (undated === 1 ? "" : "s"), "warning"));
    if (!waterTested(h)) flags.push(badge("Water not tested"));
    /*
     * Missing brand and model is a gap the office closes, so it belongs on the
     * list the office scans -- beside the other gaps it already flags here.
     * Until v0.9.37 the only route to the screen that closes it was a work-queue
     * card that appears 45 days before a visit and then disappears again.
     */
    const gaps = WilsonStore.equipmentGaps ? WilsonStore.equipmentGaps(h.id) : null;
    if (gaps && gaps.missing) flags.push(badge(gaps.missing + " missing brand/model", "warning"));
    const sched = window.WILSON_SCHEDULING && !window.WILSON_SCHEDULING.isEmpty(h.schedulingPreference)
      ? `<div class="customer-row-sched">${ui.escapeHtml(window.WILSON_SCHEDULING.summary(h.schedulingPreference))}</div>`
      : "";
    return `<article class="customer-row">
      <div class="customer-row-main">
        <a class="customer-row-name" href="household.html?id=${encodeURIComponent(h.id)}">${ui.escapeHtml(h.name)}</a>
        <div class="customer-row-meta">${ui.escapeHtml(h.address1)}, ${ui.escapeHtml(h.city)} &middot; ${assets.length} equipment record${assets.length === 1 ? "" : "s"}${subs.length ? " &middot; " + ui.escapeHtml(subs.map((s) => s.planName).join(" + ")) : ""}</div>
        ${flags.length ? `<div class="customer-row-flags">${flags.join("")}</div>` : ""}
        ${sched}
      </div>
      <div class="customer-row-side">
        <div class="customer-row-next">${next
          ? `<strong>${ui.shortDate(next.dueDate)}</strong><span>${ui.escapeHtml(next.season)}</span>`
          : `<strong>&mdash;</strong><span>No open interval</span>`}</div>
        <div class="customer-row-actions">
          <a class="button small ghost" href="household.html?id=${encodeURIComponent(h.id)}">Open</a>
          ${gaps && gaps.total
            ? `<a class="button small ghost" href="equipment.html?id=${encodeURIComponent(h.id)}">Equipment</a>`
            : ""}
        </div>
      </div>
    </article>`;
  }

  function quoteRow(row) {
    const q = row.quote;
    const silent = -ui.daysFromNow(q.updatedAt || q.createdAt);
    /* Only a SENT quote can be quiet. A draft nobody sent is waiting on Wilson,
       and calling that "quiet" blames the customer for Wilson's inbox. */
    const quiet = String(q.status || "") === "Sent" && silent >= OPS.quoteStaleAfterDays;
    return `<article class="customer-row is-quote">
      <div class="customer-row-main">
        <a class="customer-row-name" href="quote-view.html?id=${encodeURIComponent(q.id)}">${ui.escapeHtml(q.propertyName)}</a>
        <div class="customer-row-meta">${ui.escapeHtml(q.quoteNumber)}${q.contactName ? " &middot; " + ui.escapeHtml(q.contactName) : ""}${q.planName ? " &middot; " + ui.escapeHtml(q.planName) : ""} &middot; ${ui.money(q.annualAmount)} / year</div>
        <div class="customer-row-flags">${badge("Quote", "info")}${badge(q.status, q.status === "Sent" ? "info" : "warning")}${quiet ? badge(silent + "d with no answer", "warning") : ""}</div>
      </div>
      <div class="customer-row-side">
        <div class="customer-row-next">${q.validUntil
          ? `<strong>${ui.shortDate(q.validUntil)}</strong><span>Valid through</span>`
          : `<strong>&mdash;</strong><span>No expiry</span>`}</div>
        <a class="button small ghost" href="quote-view.html?id=${encodeURIComponent(q.id)}">Open</a>
      </div>
    </article>`;
  }

  function renderFilters() {
    const host = document.getElementById("customer-filters");
    if (!host) return;
    const all = rows();
    host.innerHTML = FILTERS.map(function (f) {
      const count = all.filter(f.match).length;
      const on = active === f.id;
      return `<button type="button" class="customer-filter${on ? " selected" : ""}${count ? "" : " is-empty"}"
        data-customer-filter="${f.id}" aria-pressed="${on ? "true" : "false"}"
        title="${ui.escapeHtml(f.hint)}">${ui.escapeHtml(f.label)}<b>${count}</b></button>`;
    }).join("");
  }

  function render() {
    state = WilsonStore.load();
    renderFilters();
    const list = visible();
    const households = list.filter((r) => r.kind === "household").length;
    const quotes = list.length - households;
    document.getElementById("customer-count").textContent =
      households + " household" + (households === 1 ? "" : "s") +
      (quotes ? " · " + quotes + " open quote" + (quotes === 1 ? "" : "s") : "");
    const host = document.getElementById("customer-list");
    if (!list.length) {
      host.innerHTML = `<div class="empty-state">${
        search || active
          ? "Nothing matches. <button class='link-button' data-customer-clear type='button'>Clear the search and filters</button>"
          : "No households or quotes yet. Start from <a class='text-link' href='appliance-signup.html'>a new quote or enrollment</a>."
      }</div>`;
      return;
    }
    host.innerHTML = list.map(function (r) {
      return r.kind === "quote" ? quoteRow(r) : householdRow(r);
    }).join("");
  }

  /* Delegated: the filter chips are rendered, so they do not exist at load. */
  document.addEventListener("click", function (event) {
    const chip = event.target.closest("[data-customer-filter]");
    if (chip) {
      const next = chip.dataset.customerFilter;
      active = active === next ? null : next;
      render();
      return;
    }
    if (event.target.closest("[data-customer-clear]")) {
      search = "";
      active = null;
      const box = document.getElementById("customer-search");
      if (box) box.value = "";
      render();
    }
  });

  function applySearch() {
    search = document.getElementById("customer-search").value.trim().toLowerCase();
    render();
  }
  document.getElementById("customer-search-go").addEventListener("click", applySearch);
  document.getElementById("customer-search").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); applySearch(); }
  });

  document.addEventListener("DOMContentLoaded", render);
})();

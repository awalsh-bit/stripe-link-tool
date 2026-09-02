/*
 * THE PROPOSAL, rendered from the enrollment it will become.  (v0.9.23)
 *
 * Every figure on this page is read off `quote.enrollment` -- the same payload
 * createEnrollment consumes -- and nothing here recomputes a price. The version
 * this replaces read a hand-built summary written by a second appliance picker
 * with its own arithmetic, and that arithmetic had no concept of filter
 * service: an 18-appliance house was quoted $1,874.90 on Estate Annual and
 * enrolled at $2,224.90.
 *
 * So the rule for this file is narrow and worth stating: it FORMATS. If a
 * number needs to be worked out, it belongs in the builder that priced the
 * enrollment, not here.
 */
(function () {
  const ui = window.WilsonUI;
  const config = window.WILSON_CONFIG;
  const params = new URLSearchParams(window.location.search);
  let quote = WilsonStore.getQuote(params.get("id")) || WilsonStore.lastQuote();

  function statusBadge(value) {
    const cls = value === "Accepted" ? "success" : value === "Sent" ? "info" : "warning";
    return `<span class="badge ${cls}">${ui.escapeHtml(value)}</span>`;
  }

  function money(value) { return ui.money(Number(value || 0)); }

  /* The quoted price, and the only place it comes from. */
  function enrollment() { return quote && quote.enrollment ? quote.enrollment : null; }

  /*
   * One row per appliance, grouped by area, because that is how the household
   * itself is organised and how the technician will work it. The old proposal
   * listed a type with a quantity column, which read as an order form rather
   * than an inventory of somebody's house.
   */
  function portfolioTable(en) {
    const assets = en.assets || [];
    const areas = (en.areas || []).length ? en.areas : [{ id: null, name: "Residence" }];
    const rows = areas.map(function (area) {
      const inArea = assets.filter(function (a) {
        return String(a.areaId || "") === String(area.id || "") ||
               (!a.areaId && area.id === null);
      });
      if (!inArea.length) return "";
      return `<tr class="quote-area-row"><th colspan="3">${ui.escapeHtml(area.name)}</th></tr>` +
        inArea.map(function (a) {
          const filterLine = (a.filterServiceOptIn || a.airFilterServiceOptIn)
            ? `<div class="table-sub">Filter service included in the price below</div>` : "";
          /* No Location column: the enrollment payload sets an appliance's
             location TO its area name, so a column of it under an area heading
             printed the same word twice and cost a phone the width it needed
             for the frequency. Anything genuinely more specific than the area
             goes under the appliance name instead. */
          const spot = a.location && a.location !== area.name
            ? `<div class="table-sub">${ui.escapeHtml(a.location)}</div>` : "";
          return `<tr><td><strong>${ui.escapeHtml(a.typeLabel || a.type || "Appliance")}</strong>${spot}${filterLine}</td>` +
                 `<td>${ui.escapeHtml([a.brand, a.model].filter(Boolean).join(" ") || "To verify")}</td>` +
                 `<td>${a.group === "imuc"
                     ? `${Number(a.imucVisitsPerYear || 1)} icemaker visit${Number(a.imucVisitsPerYear || 1) === 1 ? "" : "s"} / yr`
                     : `${visitsPerYear(en)} plan visit${visitsPerYear(en) === 1 ? "" : "s"} / yr`}</td></tr>`;
        }).join("");
    }).join("");
    /* An appliance whose area was deleted still belongs on the customer's
       proposal -- silently dropping a row they are being charged for is the one
       failure mode this table must not have. */
    const listed = new Set();
    areas.forEach(function (area) {
      assets.forEach(function (a) {
        if (String(a.areaId || "") === String(area.id || "") || (!a.areaId && area.id === null)) listed.add(a);
      });
    });
    const orphans = assets.filter(function (a) { return !listed.has(a); });
    const orphanRows = orphans.length
      ? `<tr class="quote-area-row"><th colspan="3">Elsewhere on the property</th></tr>` +
        orphans.map(function (a) {
          return `<tr><td><strong>${ui.escapeHtml(a.typeLabel || a.type || "Appliance")}</strong>` +
                 `${a.location ? `<div class="table-sub">${ui.escapeHtml(a.location)}</div>` : ""}</td>` +
                 `<td>${ui.escapeHtml([a.brand, a.model].filter(Boolean).join(" ") || "To verify")}</td>` +
                 `<td>${visitsPerYear(en)} plan visit${visitsPerYear(en) === 1 ? "" : "s"} / yr</td></tr>`;
        }).join("")
      : "";
    return rows + orphanRows;
  }

  function planOf(en) {
    return (config.appliancePlans || {})[en.planId] || { features: [], visitsPerYear: 1 };
  }
  function visitsPerYear(en) { return Number(planOf(en).visitsPerYear || 1); }

  /*
   * The price, line by line, straight off pricingBreakdown. Filter service is
   * on this list -- its absence from the old proposal is the entire reason for
   * this rewrite.
   */
  function priceLines(en) {
    const b = en.pricingBreakdown || {};
    const plan = planOf(en);
    const perAppliance = en.planId === "per_appliance";
    const lines = [];
    lines.push([
      perAppliance
        ? `Per-appliance pricing · ${Number(b.applianceCount || 0)} appliance${Number(b.applianceCount) === 1 ? "" : "s"}`
        : `${ui.escapeHtml(plan.name || en.planName || "Plan")} base · first ${Number(config.estatePricing.includedAppliances)} appliances`,
      money(b.basePlanAmount)
    ]);
    if (Number(b.largeEstateAdjustment || 0)) {
      const extra = Math.max(0, Number(b.applianceCount || 0) - Number(config.estatePricing.includedAppliances));
      lines.push([`${extra} additional appliance${extra === 1 ? "" : "s"}`, money(b.largeEstateAdjustment)]);
    }
    if (Number(b.imucSecondVisitAmount || 0)) {
      /*
       * THE ONE CHARGE ON THIS QUOTE THAT WAS WEARING SOMEONE ELSE'S AUTHORITY.
       *
       * The plan feature list called this "Manufacturer-recommended", naming no
       * manufacturer and citing no source, and it is default-on. The config's
       * own `imucGuidance` hedges it correctly -- "manufacturer guidance
       * GENERALLY recommends" -- and that hedge was never shown to anyone. It
       * is shown here now, beside the money, where a customer can decline it.
       */
      lines.push([`Second icemaker visit × ${Number(b.imucSecondVisitCount || 0)}`,
                  money(b.imucSecondVisitAmount),
                  (config.assumptions || {}).imucGuidance || ""]);
    }
    if (Number(b.tempMonitoringAmount || 0)) {
      /* v0.9.48: the tier arithmetic is stated on the line, so two sensors at
         $298 never reads as $149 each and the third sensor's price is never
         a surprise. */
      const guardianTier = (((config.tempMonitoring || {}).pricing || {}).member) || {};
      const guardianNote = Number(b.tempMonitoringSensors) > 0 && guardianTier.firstAnnual
        ? "First sensor " + money(guardianTier.firstAnnual) + " + " + money(guardianTier.additionalAnnual) + " each additional per year. " + ((config.tempMonitoring || {}).responseCopy || "")
        : (config.tempMonitoring || {}).responseCopy || "";
      lines.push([`${ui.escapeHtml((config.tempMonitoring || {}).serviceName || "Refrigeration Guardian")} — 24/7 temperature monitoring × ${Number(b.tempMonitoringSensors || 0)} sensor${Number(b.tempMonitoringSensors) === 1 ? "" : "s"}`,
                  money(b.tempMonitoringAmount),
                  guardianNote]);
    }
    const detail = b.filterServiceDetail || null;
    /* v0.9.48, from the audit: the registration summary flagged these prices
       as placeholders but the QUOTE -- the document a client keeps and
       accepts -- printed them as firm money. The draft-price rule follows the
       number wherever it goes. */
    const filterPricing = (config.refrigerationFilterService || {}).pricing || {};
    /* Two truths travel with every filter number: it is draft pricing until
       the real price list lands (pricingStatus), and it is an ESTIMATE by
       design — registration never asks for a model number, so the part is
       verified before the first charge and trued up then (estimateNote). */
    const filterStatus = [filterPricing.pricingStatus, filterPricing.estimateNote]
      .filter(Boolean).join(" · ");
    if (detail && detail.kinds) {
      Object.keys(detail.kinds).forEach(function (kindId) {
        const bucket = detail.kinds[kindId];
        lines.push([`${ui.escapeHtml(bucket.shortLabel)} × ${Number(bucket.quantity || 0)}`,
                    detail.included ? "Included" : money(bucket.amount),
                    detail.included ? "" : filterStatus]);
      });
    } else if (Number(b.filterServiceAmount || 0)) {
      lines.push(["Filter service", money(b.filterServiceAmount), filterStatus]);
    }
    return lines;
  }

  /*
   * WHEN EACH AMOUNT IS CHARGED.
   *
   * The annual total is what the plan costs; it is not what the card sees in one
   * go. A customer reading "$1,694.90 / year" and then being charged $1,195.00
   * followed by $499.90 five months later has been surprised twice by a document
   * that was supposed to prevent surprises -- so the proposal states the
   * schedule outright. Read from WILSON_PRICING, the same function the
   * enrollment builds its visits from.
   */
  function chargeScheduleBlock(en) {
    if (!window.WILSON_PRICING) return "";
    const schedule = window.WILSON_PRICING.chargeSchedule(en.assets || [], en.planId);
    if (!schedule.length) return "";
    return `<div class="quote-schedule"><h4>When each amount is charged</h4>
      <ul>${schedule.map(function (leg) {
        return `<li><strong>${ui.escapeHtml(leg.label)}</strong>
          <span>${leg.amount > 0 ? money(leg.amount) : "Included"}</span>
          <em>${ui.escapeHtml(leg.note)}</em></li>`;
      }).join("")}</ul>
      <p>${ui.escapeHtml(config.assumptions.paymentTiming)}</p></div>`;
  }

  function render() {
    const host = document.getElementById("quote-sheet");
    if (!quote) {
      host.innerHTML = `<div class="empty-state">No quote found.
        <a class="text-link" href="appliance-signup.html">Build one from the registration screen.</a></div>`;
      return;
    }
    const en = enrollment();
    if (!en) {
      /* A quote drafted before v0.9.23. It has no enrollment behind it, so this
         page cannot show a price it can stand behind -- and inventing one would
         recreate the divergence this rewrite removed. */
      host.innerHTML = `<div class="empty-state">
        <strong>${ui.escapeHtml(quote.quoteNumber || "This quote")} predates the current builder.</strong>
        <p>It was written by the old quote screen, which priced appliances separately from enrollment
        and did not account for filter service. Rebuild it from the registration screen so the quoted
        price and the enrolled price are the same number.</p>
        <a class="text-link" href="appliance-signup.html">Rebuild this quote →</a></div>`;
      return;
    }
    const plan = planOf(en);
    const b = en.pricingBreakdown || {};
    const accepted = Boolean(quote.householdId);

    const acceptedBanner = accepted
      ? `<div class="callout success no-print"><strong>Accepted and enrolled</strong>
          This quote created the household on ${ui.shortDate(quote.acceptedAt)}.
          <a class="text-link" href="household.html?id=${encodeURIComponent(quote.householdId)}">Open the household →</a></div>`
      : "";

    host.innerHTML = `
      ${acceptedBanner}
      <section class="quote-cover">
        <div class="quote-cover-top"><div class="quote-logo"><img src="assets/logo-black.png" alt="Wilson AC &amp; Appliance"></div><div class="quote-meta"><span>Proposal ${ui.escapeHtml(quote.quoteNumber)}</span>${statusBadge(quote.status)}</div></div>
        <div class="quote-title-block"><span>Whole-home appliance maintenance</span><h1>${ui.escapeHtml(plan.name || en.planName || "Maintenance plan")}</h1><p>Prepared for ${ui.escapeHtml(quote.propertyName)}</p></div>
        <div class="quote-contact-grid"><div><span>House manager / contact</span><strong>${ui.escapeHtml(quote.contactName)}</strong><small>${ui.escapeHtml(quote.contactEmail || "")}${quote.contactEmail && quote.contactPhone ? " · " : ""}${ui.escapeHtml(quote.contactPhone || "")}</small></div><div><span>Service address</span><strong>${ui.escapeHtml(quote.address)}</strong></div><div><span>Prepared by</span><strong>${ui.escapeHtml(quote.preparedBy || "Wilson AC &amp; Appliance")}</strong></div><div><span>Valid through</span><strong>${ui.shortDate(quote.validUntil)}</strong></div></div>
      </section>

      <section class="quote-body">
        <div class="quote-price-hero"><div><span>Annual plan</span><strong>${money(en.annualAmount)}</strong><small>Automatically renewing until canceled</small></div><div><span>Portfolio</span><strong>${(en.assets || []).length} appliances</strong><small>${visitsPerYear(en)} coordinated visit${visitsPerYear(en) === 1 ? "" : "s"} per year across ${(en.areas || []).length} area${(en.areas || []).length === 1 ? "" : "s"}</small></div></div>

        <section class="quote-section"><div class="quote-section-heading"><span>01</span><div><h2>Recommended service plan</h2><p>${ui.escapeHtml(plan.description || "")}</p></div></div><div class="quote-feature-grid">${(plan.features || []).map((feature) => `<div><span>✓</span>${ui.escapeHtml(feature)}</div>`).join("")}</div></section>

        <section class="quote-section"><div class="quote-section-heading"><span>02</span><div><h2>Appliance portfolio</h2><p>Every appliance below is individually enrolled and individually inspected. Wilson will verify models, serial numbers, filter parts, and access details during onboarding.</p></div></div><div class="table-wrap"><table class="quote-table"><thead><tr><th>Appliance</th><th>Brand / model</th><th>Maintenance frequency</th></tr></thead><tbody>${portfolioTable(en)}</tbody></table></div></section>

        <section class="quote-section"><div class="quote-section-heading"><span>03</span><div><h2>Annual pricing</h2><p>This is the price the enrollment will charge. It is calculated by the same system that runs the enrollment, from the appliance list above.</p></div></div><div class="quote-pricing-card">${priceLines(en).map(function (line) {
          return `<div><span>${line[0]}${line[2] ? `<em class="quote-line-note">${ui.escapeHtml(line[2])}</em>` : ""}</span><strong>${line[1]}</strong></div>`;
        }).join("")}<div class="quote-total-row"><span>Annual total</span><strong>${money(en.annualAmount)}</strong></div></div>${chargeScheduleBlock(en)}${b.customReviewRequired ? `<div class="callout warning"><strong>Portfolio review</strong>This proposal remains subject to Wilson management review because the listed inventory contains ${Number(b.applianceCount || 0)} appliances.</div>` : ""}</section>

        <section class="quote-section"><div class="quote-section-heading"><span>04</span><div><h2>Program terms and next steps</h2></div></div><div class="quote-terms-grid"><div><strong>Payment authorization</strong><p>${ui.escapeHtml(config.assumptions.paymentTiming)}</p></div><div><strong>Renewal</strong><p>${ui.escapeHtml(config.assumptions.renewal)}</p></div><div><strong>Scheduling</strong><p>Wilson maintains the service interval and contacts the household to coordinate access and scheduling.</p></div><div><strong>Service scope</strong><p>Maintenance covers the agreed inspection and accessible maintenance scope. BBQ / grill cleaning, disassembly unless separately approved, repairs, inaccessible components, unusual materials, and replacement parts outside plan coverage are quoted separately.</p></div></div></section>

        <section class="quote-section"><div class="quote-section-heading"><span>05</span><div><h2>Property notes</h2></div></div><div class="quote-note-box">${ui.escapeHtml(quote.notes || "No additional property notes were entered.")}</div></section>

        <footer class="quote-footer"><div><strong>Wilson AC &amp; Appliance</strong><span>Trusted since 1949 · Greater Austin and the Texas Hill Country</span></div><div><strong>${ui.escapeHtml(quote.quoteNumber)}</strong><span>${statusBadge(quote.status)}</span></div></footer>
      </section>
    `;
    paintActions(accepted);
  }

  /* An accepted quote's buttons must not offer to accept it again, or to walk
     its status backwards to Draft while a live household points at it. */
  function paintActions(accepted) {
    const accept = document.getElementById("accept-quote");
    if (accept) {
      accept.disabled = accepted;
      accept.textContent = accepted ? "Enrolled" : "Accept & enroll";
    }
    document.querySelectorAll("[data-quote-status]").forEach(function (button) {
      button.disabled = accepted;
    });
  }

  document.querySelectorAll("[data-quote-status]").forEach(function (button) {
    button.addEventListener("click", function () {
      quote = WilsonStore.updateQuoteStatus(quote.id, button.dataset.quoteStatus);
      render();
      ui.toast("Quote status updated", quote.quoteNumber + " is now " + quote.status + ".");
    });
  });

  const acceptButton = document.getElementById("accept-quote");
  if (acceptButton) acceptButton.addEventListener("click", function () {
    if (!quote) return;
    const result = WilsonStore.acceptQuote(quote.id);
    if (!result.ok) {
      ui.toast("Not converted", result.message);
      if (result.alreadyAccepted) { quote = WilsonStore.getQuote(quote.id); render(); }
      return;
    }
    quote = result.quote;
    render();
    /* Say what is still missing. A converted quote is a real household with no
       card on file and no renewal authorization, and letting the screen imply
       a signed, funded account would be the report-writing equivalent of a
       pencil-whipped service ticket. */
    const outstanding = [];
    if (result.needsPayment) outstanding.push("a payment method");
    if (result.needsTerms) outstanding.push("the renewal authorization");
    ui.toast("Enrollment created",
             outstanding.length
               ? "The household is on file. Still needed before the first charge: " +
                 outstanding.join(" and ") + "."
               : "The household is on file.");
  });

  document.getElementById("print-quote").addEventListener("click", () => window.print());
  document.addEventListener("DOMContentLoaded", render);
})();

(function () {
  const ui = window.WilsonUI;
  const config = window.WILSON_CONFIG;
  const params = new URLSearchParams(window.location.search);
  let quote = WilsonStore.getQuote(params.get("id")) || WilsonStore.lastQuote();

  function statusBadge(value) {
    const cls = value === "Accepted" ? "success" : value === "Sent" ? "info" : "warning";
    return `<span class="badge ${cls}">${ui.escapeHtml(value)}</span>`;
  }

  function render() {
    const host = document.getElementById("quote-sheet");
    if (!quote) {
      host.innerHTML = `<div class="empty-state">No quote found. <a class="text-link" href="quote-builder.html">Create a custom quote.</a></div>`;
      return;
    }
    const plan = config.appliancePlans[quote.planId] || { features: [] };
    const assets = quote.assets || [];
    host.innerHTML = `
      <section class="quote-cover">
        <div class="quote-cover-top"><div class="quote-logo"><img src="assets/logo-black.png" alt="Wilson AC & Appliance"></div><div class="quote-meta"><span>Proposal ${ui.escapeHtml(quote.quoteNumber)}</span>${statusBadge(quote.status)}</div></div>
        <div class="quote-title-block"><span>Whole-home appliance maintenance</span><h1>${ui.escapeHtml(quote.planName)}</h1><p>Prepared for ${ui.escapeHtml(quote.propertyName)}</p></div>
        <div class="quote-contact-grid"><div><span>House manager / contact</span><strong>${ui.escapeHtml(quote.contactName)}</strong><small>${ui.escapeHtml(quote.contactEmail || "")} ${quote.contactPhone ? "· " + ui.escapeHtml(quote.contactPhone) : ""}</small></div><div><span>Service address</span><strong>${ui.escapeHtml(quote.address)}</strong></div><div><span>Prepared by</span><strong>${ui.escapeHtml(quote.preparedBy || "Wilson AC & Appliance")}</strong></div><div><span>Valid through</span><strong>${ui.shortDate(quote.validUntil)}</strong></div></div>
      </section>

      <section class="quote-body">
        <div class="quote-price-hero"><div><span>Estimated annual plan</span><strong>${ui.money(quote.annualAmount)}</strong><small>Automatically renewing until canceled</small></div><div><span>Portfolio</span><strong>${Number(quote.applianceCount || 0)} appliances</strong><small>${Number(plan.visitsPerYear || 1)} coordinated visit${Number(plan.visitsPerYear || 1) === 1 ? "" : "s"} per year</small></div></div>

        <section class="quote-section"><div class="quote-section-heading"><span>01</span><div><h2>Recommended service plan</h2><p>${ui.escapeHtml(plan.description || "")}</p></div></div><div class="quote-feature-grid">${(plan.features || []).map((feature) => `<div><span>✓</span>${ui.escapeHtml(feature)}</div>`).join("")}</div></section>

        <section class="quote-section"><div class="quote-section-heading"><span>02</span><div><h2>Appliance portfolio</h2><p>The inventory below establishes the quoted count. Wilson will verify models, serial numbers, filter parts, and access details during onboarding.</p></div></div><div class="table-wrap"><table class="quote-table"><thead><tr><th>Appliance</th><th>Brand / model</th><th>Location</th><th>Qty</th><th>Maintenance frequency</th></tr></thead><tbody>${assets.map((item) => `<tr><td><strong>${ui.escapeHtml(item.typeLabel)}</strong></td><td>${ui.escapeHtml([item.brand, item.model].filter(Boolean).join(" ") || "To verify")}</td><td>${ui.escapeHtml(item.location || "To verify")}</td><td>${Number(item.quantity || 1)}</td><td>${item.type === "ice_maker" ? `${Number(item.imucVisitsPerYear || 1)} IMUC visit${Number(item.imucVisitsPerYear || 1) === 1 ? "" : "s"} / year` : `${Number(plan.visitsPerYear || 1)} plan visit${Number(plan.visitsPerYear || 1) === 1 ? "" : "s"} / year`}</td></tr>`).join("")}</tbody></table></div></section>

        <section class="quote-section"><div class="quote-section-heading"><span>03</span><div><h2>Annual pricing</h2><p>The base-plus structure keeps the published plan simple while accounting for very large equipment portfolios.</p></div></div><div class="quote-pricing-card"><div><span>${ui.escapeHtml(quote.planName)} base · first ${Number(quote.includedCount || 15)} appliances</span><strong>${ui.money(quote.baseAmount)}</strong></div>${Number(quote.additionalApplianceAmount || 0) ? `<div><span>${Number(quote.additionalApplianceCount || 0)} additional appliances × ${ui.money(quote.additionalApplianceRate || 0)}</span><strong>${ui.money(quote.additionalApplianceAmount)}</strong></div>` : ""}${Number(quote.imucAddOnAmount || 0) ? `<div><span>Recommended second IMUC visits × ${Number(quote.imucSecondVisitCount || 0)}</span><strong>${ui.money(quote.imucAddOnAmount)}</strong></div>` : ""}${Number(quote.manualAdjustment || 0) ? `<div><span>${ui.escapeHtml(quote.adjustmentLabel || "Manual adjustment")}</span><strong>${ui.money(quote.manualAdjustment)}</strong></div>` : ""}<div class="quote-total-row"><span>Estimated annual total</span><strong>${ui.money(quote.annualAmount)}</strong></div></div>${quote.customReviewRequired ? `<div class="callout warning"><strong>Portfolio review</strong>This proposal remains subject to Wilson management review because the listed inventory contains ${Number(quote.applianceCount)} appliances.</div>` : ""}</section>

        <section class="quote-section"><div class="quote-section-heading"><span>04</span><div><h2>Program terms and next steps</h2></div></div><div class="quote-terms-grid"><div><strong>Payment authorization</strong><p>A secure card is placed on file during enrollment. Wilson charges the card when a scheduled maintenance interval is ready to proceed, not when this proposal is created.</p></div><div><strong>Renewal</strong><p>The selected maintenance plan renews annually until canceled by the customer.</p></div><div><strong>Scheduling</strong><p>Wilson maintains the service interval and contacts the household to coordinate access and scheduling.</p></div><div><strong>Service scope</strong><p>Maintenance covers the agreed inspection and accessible maintenance scope. BBQ / grill cleaning, disassembly unless separately approved, repairs, inaccessible components, unusual materials, and replacement parts outside plan coverage are quoted separately.</p></div></div></section>

        <section class="quote-section"><div class="quote-section-heading"><span>05</span><div><h2>Property notes</h2></div></div><div class="quote-note-box">${ui.escapeHtml(quote.notes || "No additional property notes were entered.")}</div></section>

        <footer class="quote-footer"><div><strong>Wilson AC & Appliance</strong><span>Trusted since 1949 · Greater Austin and the Texas Hill Country</span></div><div><strong>${ui.escapeHtml(quote.quoteNumber)}</strong><span>${statusBadge(quote.status)}</span></div></footer>
      </section>
    `;
  }

  document.querySelectorAll("[data-quote-status]").forEach(function (button) {
    button.addEventListener("click", function () {
      quote = WilsonStore.updateQuoteStatus(quote.id, button.dataset.quoteStatus);
      render();
      ui.toast("Quote status updated", quote.quoteNumber + " is now " + quote.status + ".");
    });
  });
  document.getElementById("print-quote").addEventListener("click", () => window.print());
  document.addEventListener("DOMContentLoaded", render);
})();

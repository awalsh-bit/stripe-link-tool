(function () {
  document.addEventListener("DOMContentLoaded", function () {
    const bundle = WilsonStore.lastEnrollment();
    const host = document.getElementById("confirmation-details");
    if (!bundle) {
      host.innerHTML = `<div class="empty-state">No new enrollment is stored in this browser. <a class="text-link" href="index.html">Return to maintenance plans.</a></div>`;
      return;
    }
    const subscription = bundle.subscriptions[0];
    const payment = bundle.paymentProfiles[0];
    document.getElementById("confirmation-plan").textContent = subscription.planName;
    document.getElementById("confirmation-household").textContent = bundle.household.name;
    host.innerHTML = `
      <div class="section-heading">
        <div><h2>Enrollment summary</h2><p>Reference: ${WilsonUI.escapeHtml(subscription.id)}</p></div>
        <span class="badge warning">Pending Wilson review</span>
      </div>
      <div class="detail-grid">
        <div class="detail-tile"><div class="label">Household</div><div class="value">${WilsonUI.escapeHtml(bundle.household.name)}</div></div>
        <div class="detail-tile"><div class="label">Plan</div><div class="value">${WilsonUI.escapeHtml(subscription.planName)}</div></div>
        <div class="detail-tile"><div class="label">Estimated annual amount</div><div class="value">${WilsonUI.money(subscription.annualAmount)}</div></div>
        <div class="detail-tile"><div class="label">Payment setup</div><div class="value">${WilsonUI.escapeHtml(payment.status)}</div></div>
        <div class="detail-tile"><div class="label">Equipment entered</div><div class="value">${bundle.assets.length}</div></div>
        <div class="detail-tile"><div class="label">Preferred timing</div><div class="value">${WilsonUI.escapeHtml(subscription.preferredMonths || "Office to confirm")}</div></div>
        <div class="detail-tile"><div class="label">Renewal</div><div class="value">${subscription.autoRenew ? "Annual until canceled" : "Manual"}</div></div>
        <div class="detail-tile"><div class="label">Charge timing</div><div class="value">Scheduled maintenance interval</div></div>
        <div class="detail-tile"><div class="label">Phone</div><div class="value">${WilsonUI.escapeHtml(bundle.household.phone)}</div></div>
        <div class="detail-tile"><div class="label">Email</div><div class="value">${WilsonUI.escapeHtml(bundle.household.email)}</div></div>
      </div>
    `;
  });
})();

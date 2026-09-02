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
        <!-- Read back from the structured preference, not the free-text box it
             replaced. "Office to confirm" when nothing was given, which is the
             truth rather than a blank. -->
        <div class="detail-tile"><div class="label">Preferred timing</div><div class="value">${WilsonUI.escapeHtml(
          window.WILSON_SCHEDULING && bundle.household.schedulingPreference
            ? window.WILSON_SCHEDULING.summary(bundle.household.schedulingPreference)
            : (subscription.preferredMonths || "Office to confirm"))}</div></div>
        <div class="detail-tile"><div class="label">Renewal</div><div class="value">${subscription.autoRenew ? "Annual until canceled" : "Manual"}</div></div>
        <div class="detail-tile"><div class="label">Charge timing</div><div class="value">Scheduled maintenance interval</div></div>
        <div class="detail-tile"><div class="label">Phone</div><div class="value">${WilsonUI.escapeHtml(bundle.household.phone)}</div></div>
        <div class="detail-tile"><div class="label">Email</div><div class="value">${WilsonUI.escapeHtml(bundle.household.email)}</div></div>
      </div>
      ${chargeSchedule(bundle, subscription, payment)}
    `;
    /* v0.9.48: the "Customer next step" card reads the SAME payment profile
       the charge schedule does, so this page can never assert an authorized
       card while its own summary tile says "Pending setup". */
    const paymentCopy = document.getElementById("confirmation-payment-copy");
    if (paymentCopy) {
      paymentCopy.textContent = payment && payment.status === "Ready"
        ? "The secure payment method is authorized at enrollment. Wilson does not charge the plan until the scheduled maintenance interval is ready to proceed."
        : "Your card is not on file yet — Wilson will send a secure link to set it up, and nothing can be charged until you do. After that, Wilson does not charge the plan until the scheduled maintenance interval is ready to proceed.";
    }
  });

  /*
   * WHAT WILL BE CHARGED, AND WHEN.
   *
   * This is the page a customer keeps, so it is the right place for the full
   * schedule rather than the one-line version the signup panel shows. Built
   * from the household's ACTUAL VISITS -- not re-derived from the plan -- so it
   * states what the system will really do rather than what it intends to. If
   * the office adjusts a visit after enrollment, this reflects that.
   */
  function chargeSchedule(bundle, subscription, payment) {
    const visits = (bundle.visits || [])
      .filter(function (v) { return v.subscriptionId === subscription.id; })
      .slice()
      .sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
    if (!visits.length) return "";
    const total = visits.reduce(function (t, v) { return t + Number(v.amountToCharge || 0); }, 0);
    return `<div class="confirm-schedule">
      <h3>What will be charged, and when</h3>
      <p class="confirm-schedule-lede">${
        /*
         * This read "Your card is on file now" as static text, directly under a
         * tile that can say "Pending setup". The page was telling the customer
         * their card was saved while the record above it said it was not. The
         * sentence now reads the same payment profile the tile does.
         */
        String((payment || {}).status || "").toLowerCase() === "ready"
          ? "Your card is on file. Nothing is charged today &mdash;"
          : "Your card is not on file yet &mdash; we will send a secure link to set it up, and nothing can be charged until you do. When it is,"
      }
      each amount below is charged against its own maintenance visit.</p>
      <ul>${visits.map(function (v) {
        const amount = Number(v.amountToCharge || 0);
        return `<li>
          <strong>${WilsonUI.escapeHtml(v.season)}</strong>
          <span>${amount > 0 ? WilsonUI.money(amount) : "Included"}</span>
          <em>Target ${WilsonUI.shortDate(v.dueDate)} &middot; ${WilsonUI.escapeHtml(v.assetScope || "Enrolled equipment")}</em>
        </li>`;
      }).join("")}</ul>
      <div class="confirm-schedule-total"><span>Total for the plan year</span><strong>${WilsonUI.money(total)}</strong></div>
      <p class="confirm-schedule-note">${WilsonUI.escapeHtml(window.WILSON_CONFIG.assumptions.paymentTiming)}
      Wilson verifies the equipment and scope before the first charge, so these amounts can change if
      the appliance list does &mdash; we will tell you before that happens.</p>
    </div>`;
  }
})();

// Sales order health rules — shared by the Sales Order Health Report and the
// "My Order Flags" queue on the Payments Dashboard, so both pages flag orders
// identically. Rules per Andrew, Aug 2026:
//   Global: no dates in the past (D7 excepted), no negative COD balances.
//   D1 written business; D2/D2T flag COD with no payment; D2R yellow by
//   default, red on COD balance or missing route; D3 flags unscheduled;
//   D3-PRE obsolete = red; D4/D4T red on missing route or COD balance;
//   D7 red if future-dated, yellow if still Open; D8 cancelled = close it;
//   CPU* only checked for past pickup dates. Balances mean COD only.
(function () {
  function isCpu(order) { return /^CPU/i.test(order.jobStatus || ""); }

  function baseStatus(order) {
    const js = String(order.jobStatus || "").toUpperCase();
    if (js === "D2T") return "D2";
    if (js === "D4T") return "D4";
    return js;
  }

  function effectiveDate(order) {
    return isCpu(order)
      ? (order.pickupDate || order.schedDate || "")
      : (order.schedDate || order.pickupDate || "");
  }

  function computeFlags(order, today) {
    const flags = [];
    const red = (text) => flags.push({ level: "red", text });
    const yellow = (text) => flags.push({ level: "yellow", text });
    const js = baseStatus(order);
    const date = effectiveDate(order);
    const cod = String(order.paymentType || "").toUpperCase() === "COD";
    const balance = Number.isFinite(order.balance) ? order.balance : null;
    const total = Number.isFinite(order.total) ? order.total : null;
    const routed = !!String(order.route || "").trim();

    // Customer pickups: only the past-date rule applies for now.
    if (isCpu(order)) {
      if (date && date < today) red("Pickup date in the past");
      return flags;
    }

    // Global rules
    if (js !== "D7") {
      if (date && date < today) red("Date in the past");
      if (!date) yellow("No scheduled date");
    }
    if (cod && balance != null && balance < 0) red("Negative balance");

    switch (js) {
      case "D2":
        if (cod && total != null && total > 0 && balance != null && balance >= total) {
          yellow("COD with no payment — hold ordering");
        }
        break;
      case "D2R":
        yellow("Awaiting product, holding schedule time");
        if (cod && balance != null && balance > 0) red("Balance due on D2R");
        if (!routed) red("Holding schedule but not routed");
        break;
      case "D3":
        if (!routed) yellow("Ready to fulfill — needs scheduling");
        break;
      case "D3-PRE":
        red("Obsolete status (D3-PRE)");
        break;
      case "D4":
        if (!routed) red("Scheduled to go out but not routed");
        if (cod && balance != null && balance > 0) red("Balance due on scheduled order");
        break;
      case "D7":
        if (date && date > today) red("Finished order dated in the future");
        if (String(order.status || "").trim().toLowerCase() === "open") yellow("Finished but still open");
        break;
      case "D8":
        yellow("Cancelled — needs to be closed");
        break;
    }
    return flags;
  }

  function severityOf(flags) {
    if (flags.some((f) => f.level === "red")) return "red";
    if (flags.length) return "yellow";
    return "ok";
  }

  // A stable fingerprint of an order's current flags. Dismissals store this,
  // so a closed flag card stays closed until the order's flags CHANGE — then
  // it reappears with the new problem.
  function flagsSignature(order, flags) {
    return String(order.invoice || "") + "|" +
      flags.map((f) => f.level + ":" + f.text).sort().join(";");
  }

  window.WILSON_ORDER_HEALTH = { isCpu, baseStatus, effectiveDate, computeFlags, severityOf, flagsSignature };
})();

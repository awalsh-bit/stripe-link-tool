// ---------------------------------------------------------------------------
// CASH OPS PROJECTION (Andrew, 2026-09-26) — the sales-and-purchasing cash
// picture straight from ePASS, by month, for the executives.
//
// Money in:
//   1. Open sales book  — every open invoice (feed) by its ScheduleDate month:
//      total, deposits already held (CommittedPaymentTotal), balance due at
//      delivery; firmness from JobStatusCode (D1/D2 soft, D3/D4 firm,
//      D5+ delivering; past schedule = "needs a date").
//   2. Open receivables — ARCurrent netted per invoice, by due month
//      (delivered on terms, not yet paid).
//   3. Actual payments  — InvoicePayment by month and type (last 13 months),
//      so projected vs actual sits side by side.
// Money out:
//   4. Open payables    — APCurrent netted per supplier invoice, by due month.
//   5. Received, not billed — POs received in the last 120 days with no AP
//      link yet: cost scheduled by the supplier's payment terms from receipt.
//   6. Open purchase orders — lines still to receive: cost by ETA month, then
//      scheduled by terms from the ETA.
// Gross margin:
//   7. Open book by delivery month: model revenue (net of linked discounts)
//      against the line cost ePASS carries (landed → average → last →
//      standard → original); plus the finished months' actual GM.
//
// Supplier terms (supplier_payment_terms): invoices batch at billing-close
// days (5th, 20th); each installment is due on the first due day (8th, 23rd)
// on/after close + N days. Default: 50% at 30 days, 50% at 60.
// ---------------------------------------------------------------------------

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => { if (v == null || v === "") return 0; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const pick = (row, ...names) => {
  for (const n of names) {
    const key = Object.keys(row || {}).find((k) => k.toLowerCase() === String(n).toLowerCase());
    if (key != null && row[key] != null && row[key] !== "") return String(row[key]).trim();
  }
  return "";
};
const day = (v) => { const s = String(v || "").trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; const u = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return u ? `${u[3]}-${u[1].padStart(2, "0")}-${u[2].padStart(2, "0")}` : ""; };
const monthOf = (d) => (d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : "");
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthAdd = (ym, n) => { let [y, m] = ym.split("-").map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, "0")}`; };

// First calendar day in `days` (e.g. [5,20]) on or after `iso`.
export function nextDayOfMonth(iso, days) {
  const list = [...new Set((days || []).map(Number).filter((d) => d >= 1 && d <= 31))].sort((a, b) => a - b);
  if (!list.length) return iso;
  let d = new Date(iso + "T00:00:00Z");
  for (let i = 0; i < 62; i++) {
    const dom = d.getUTCDate();
    if (list.includes(dom)) return d.toISOString().slice(0, 10);
    d.setUTCDate(dom + 1);
  }
  return iso;
}

// Schedule one amount through a supplier's terms: [{ due, amount, pct }].
export function scheduleByTerms(amount, fromIso, terms) {
  const t = terms || DEFAULT_TERMS;
  const close = nextDayOfMonth(fromIso, t.closeDays);
  return (t.installments || DEFAULT_TERMS.installments).map((i) => ({
    due: nextDayOfMonth(addDays(close, i.days), t.dueDays), pct: i.pct, amount: r2(amount * i.pct / 100)
  }));
}
export const DEFAULT_TERMS = { closeDays: [5, 20], dueDays: [8, 23], installments: [{ pct: 50, days: 30 }, { pct: 50, days: 60 }] };

function termsLookup(termRows) {
  const map = new Map();
  for (const r of termRows || []) map.set(String(r.supplier_code || r.supplierCode || "").toUpperCase(), { closeDays: r.close_days || r.closeDays, dueDays: r.due_days || r.dueDays, installments: r.installments });
  const def = map.get("*") || DEFAULT_TERMS;
  return (code) => map.get(String(code || "").toUpperCase()) || def;
}

const SOFT = new Set(["D1", "D2", "D2R", "D2T"]);
const FIRM = new Set(["D3", "D4"]);
function firmnessOf(jobStatus) {
  const s = String(jobStatus || "").toUpperCase();
  if (SOFT.has(s)) return "soft";
  if (FIRM.has(s)) return "firm";
  if (/^D[5-7]/.test(s)) return "delivering";
  return s ? "other" : "soft";
}

const lineCost = (l) => { for (const k of ["LandedCost", "AverageCost", "LastCost", "StandardCost", "OriginalCost"]) { const v = num(pick(l, k)); if (v > 0) return v; } return 0; };

export function computeCashProjection({ openBook, finance, actuals = [], today = new Date().toISOString().slice(0, 10), months = 6 } = {}) {
  const thisMonth = today.slice(0, 7);
  const horizon = []; for (let i = 0; i <= months; i++) horizon.push(monthAdd(thisMonth, i));
  const inHorizon = (ym) => horizon.includes(ym);
  const bucketOf = (iso) => { const ym = monthOf(iso); if (!ym) return "unscheduled"; if (ym < thisMonth) return "past"; if (!inHorizon(ym)) return "later"; return ym; };
  const blank = () => ({ deliveries: 0, revenue: 0, revenueNet: 0, cost: 0, deposits: 0, cashAtDelivery: 0, soft: 0, firm: 0, delivering: 0, arDue: 0, apDue: 0, receivedUnbilled: 0, poDue: 0, poArrivingCost: 0 });
  const rows = {}; for (const k of [...horizon, "past", "unscheduled", "later"]) rows[k] = blank();

  // ---- 1 + 7. open sales book -------------------------------------------
  const linesByInv = new Map();
  for (const l of openBook?.lines || []) { const k = pick(l, "InvoiceCode").toUpperCase(); if (!linesByInv.has(k)) linesByInv.set(k, []); linesByInv.get(k).push(l); }
  const discountByLine = new Map(); // invoice|lineTs -> discount (negative)
  for (const m of openBook?.misc || []) {
    const ts = pick(m, "InvoiceModelLineTimeStamp"); if (!ts) continue;
    const inv = (pick(m, "InvoiceModelInvoiceCode") || pick(m, "InvoiceCode")).toUpperCase();
    const k = inv + "|" + ts; discountByLine.set(k, r2((discountByLine.get(k) || 0) + num(pick(m, "Total"))));
  }
  const book = { orders: 0, total: 0, deposits: 0, balance: 0, revenue: 0, cost: 0, discounts: 0, byType: {} };
  // ---- AR families (computed first: the open book needs them) --------------
  // ePASS splits a builder order into sub-invoices as it delivers
  // (S00063116-5, -6, -9 finished; S00063116 still open). The deposit sits
  // on the BASE as a negative AR row; the finished subs carry positive
  // balances until the office transfers the deposit across (PT = payment
  // transfer). Netting per invoice made a customer with $90k on deposit and
  // $55k delivered look like $55k of receivables. So: net per FAMILY.
  //   F = finished sub-invoice balances (positive, invoice not on the open book)
  //   D = credits / deposits across the family (negative rows)
  //   AR due            = max(0, F - D)      the deposit covers delivered first
  //   deposit left      = max(0, D - F)      applied to the still-open base (cash at delivery)
  //   unapplied credit  = deposit left when nothing in the family is open
  const openInvoices = new Set((openBook?.orders || []).map((o) => pick(o, "Code").toUpperCase()).filter(Boolean));
  const baseOf = (inv) => String(inv || "").toUpperCase().replace(/-\d+$/, "");
  const arByInv = new Map();
  for (const r of finance?.ar || []) {
    const k = `${r.customer_code}|${String(r.invoice || "").toUpperCase()}`;
    const cur = arByInv.get(k) || { customer: r.customer_code, invoice: String(r.invoice || "").toUpperCase(), amount: 0, due: "", paymentType: "", rows: 0 };
    cur.amount = r2(cur.amount + num(r.amount)); cur.rows++;
    if (r.due_date && (!cur.due || r.due_date > cur.due)) cur.due = r.due_date;
    if (r.payment_type) cur.paymentType = r.payment_type;
    arByInv.set(k, cur);
  }
  const families = new Map(); // customer|base -> { customer, base, finished: [], credits: [], onOpen: [], F, D, open }
  for (const a of arByInv.values()) {
    if (Math.abs(a.amount) < 0.005) continue;
    const base = baseOf(a.invoice) || `(${a.customer})`;
    const k = `${a.customer}|${base}`;
    const fam = families.get(k) || { customer: a.customer, base, finished: [], credits: [], onOpen: [], F: 0, D: 0, open: false };
    if (a.amount < 0) { fam.credits.push(a); fam.D = r2(fam.D - a.amount); }
    else if (openInvoices.has(a.invoice)) { fam.onOpen.push(a); }
    else { fam.finished.push(a); fam.F = r2(fam.F + a.amount); }
    families.set(k, fam);
  }
  for (const fam of families.values()) {
    fam.open = fam.onOpen.length > 0 || openInvoices.has(fam.base) || [...openInvoices].some((inv) => baseOf(inv) === fam.base);
    fam.arDue = r2(Math.max(0, fam.F - fam.D));
    fam.depositLeft = r2(Math.max(0, fam.D - fam.F));
    fam.coveredByDeposit = r2(Math.min(fam.F, fam.D));
    fam.due = fam.finished.map((a) => a.due).filter(Boolean).sort()[0] || "";
  }
  // deposit still available to an open order after covering its delivered subs
  const depositLeftByBase = new Map();
  for (const fam of families.values()) if (fam.open) depositLeftByBase.set(fam.base, fam);

  const bookRows = [];
  for (const o of openBook?.orders || []) {
    const inv = pick(o, "Code").toUpperCase(); if (!inv) continue;
    const invType = pick(o, "InvTypeCode").toUpperCase();
    const totalNoTax = num(pick(o, "SerialTotal")) + num(pick(o, "ItemTotal")) + num(pick(o, "LaborTotal")) + num(pick(o, "MiscTotal")) + num(pick(o, "WtyTotal"));
    const tax = num(pick(o, "Tax1Total")) + num(pick(o, "Tax2Total")) + num(pick(o, "Tax3Total"));
    const total = r2(totalNoTax + tax);
    const committed = r2(num(pick(o, "CommittedPaymentTotal")));
    // Split families: the deposit ePASS shows on the base has partly paid
    // for delivered sub-invoices already; only what's left offsets this order.
    const fam = depositLeftByBase.get(baseOf(inv));
    const deposits = fam && fam.F > 0 ? r2(Math.min(committed, fam.depositLeft)) : committed;
    const balance = r2(Math.max(0, total - deposits));
    const depositSurplus = r2(Math.max(0, deposits - total)); // more deposit than order left: nothing to collect
    const sched = day(pick(o, "ScheduleDate")) || day(pick(o, "PickUpDate"));
    const status = pick(o, "JobStatusCode").toUpperCase();
    const firmness = firmnessOf(status);
    let revenue = 0, cost = 0, discount = 0;
    for (const l of linesByInv.get(inv) || []) {
      const qty = num(pick(l, "QtyOrdered")) || 1;
      const sell = num(pick(l, "SellingPrice")) * qty;
      const d = discountByLine.get(inv + "|" + pick(l, "LineTimeStamp")) || 0;
      revenue += sell + d; discount += d; cost += lineCost(l) * qty;
    }
    const bucket = bucketOf(sched);
    const row = rows[bucket];
    row.deliveries++; row.revenue = r2(row.revenue + totalNoTax); row.revenueNet = r2(row.revenueNet + revenue); row.cost = r2(row.cost + cost);
    row.deposits = r2(row.deposits + deposits); row.cashAtDelivery = r2(row.cashAtDelivery + balance); row[firmness === "other" ? "soft" : firmness] = r2(row[firmness === "other" ? "soft" : firmness] + balance);
    book.orders++; book.total = r2(book.total + total); book.deposits = r2(book.deposits + deposits); book.balance = r2(book.balance + balance); book.revenue = r2(book.revenue + revenue); book.cost = r2(book.cost + cost); book.discounts = r2(book.discounts + discount);
    book.byType[invType] = r2((book.byType[invType] || 0) + total);
    bookRows.push({ invoice: inv, invType, status, firmness, scheduleDate: sched, bucket, total, deposits, committed, depositSurplus, balance, productRevenue: r2(revenue), productCost: r2(cost), discount: r2(discount),
      customer: [pick(o, "SoldToLastName"), pick(o, "SoldToFirstName")].filter(Boolean).join(", "), shipTo: [pick(o, "SoldToLastName"), pick(o, "SoldToFirstName")].filter(Boolean).join(", "), shipToCity: pick(o, "SoldToCity"),
      billToCode: pick(o, "BillToCode"), billTo: [pick(o, "BillToLastName"), pick(o, "BillToFirstName")].filter(Boolean).join(", "),
      salesperson: pick(o, "Salesperson1Code"), paymentType: pick(o, "PaymentTypeCode") });
  }

  // ---- 2. open receivables: from the families ------------------------------
  const customerNames = {};
  for (const c of finance?.customers || []) if (c.code && c.name) customerNames[String(c.code).toUpperCase()] = c.name;
  for (const b of bookRows) if (b.billToCode && b.billTo && !customerNames[b.billToCode.toUpperCase()]) customerNames[b.billToCode.toUpperCase()] = b.billTo;
  const ar = { open: 0, pastDue: 0, count: 0, families: 0, byCustomer: {}, customerNames, credits: 0, creditCount: 0, coveredByDeposit: 0, depositsOnOpenOrders: 0, unappliedCredits: 0, onOpenOrders: 0, onOpenOrdersCount: 0, byRecordType: {} };
  for (const r of finance?.ar || []) { const t = r.record_type || "?"; ar.byRecordType[t] = ar.byRecordType[t] || { rows: 0, amount: 0 }; ar.byRecordType[t].rows++; ar.byRecordType[t].amount = r2(ar.byRecordType[t].amount + num(r.amount)); }
  const arRows = [];
  for (const fam of families.values()) {
    ar.credits = r2(ar.credits + fam.D); ar.creditCount += fam.credits.length;
    ar.coveredByDeposit = r2(ar.coveredByDeposit + fam.coveredByDeposit);
    for (const a of fam.onOpen) { ar.onOpenOrders = r2(ar.onOpenOrders + a.amount); ar.onOpenOrdersCount++; }
    if (fam.depositLeft > 0) { if (fam.open) ar.depositsOnOpenOrders = r2(ar.depositsOnOpenOrders + fam.depositLeft); else ar.unappliedCredits = r2(ar.unappliedCredits + fam.depositLeft); }
    if (fam.arDue > 0) {
      ar.families++;
      const bucket = bucketOf(fam.due || today);
      const key = bucket === "unscheduled" || bucket === "past" ? thisMonth : bucket; // overdue = collect now
      rows[key].arDue = r2(rows[key].arDue + fam.arDue);
      ar.open = r2(ar.open + fam.arDue); ar.count += fam.finished.length;
      if (fam.due && fam.due < today) ar.pastDue = r2(ar.pastDue + fam.arDue);
      ar.byCustomer[fam.customer] = r2((ar.byCustomer[fam.customer] || 0) + fam.arDue);
    }
    arRows.push({ customer: fam.customer, base: fam.base, open: fam.open, finished: fam.finished.map((a) => ({ invoice: a.invoice, due: a.due, amount: a.amount, paymentType: a.paymentType })),
      credits: fam.credits.map((a) => ({ invoice: a.invoice, amount: a.amount })), onOpen: fam.onOpen.map((a) => ({ invoice: a.invoice, amount: a.amount })),
      delivered: fam.F, deposits: fam.D, coveredByDeposit: fam.coveredByDeposit, arDue: fam.arDue, depositLeft: fam.depositLeft, due: fam.due });
  }

  // ---- 3. actual payments by month + type ---------------------------------
  const payments = {};
  for (const p of finance?.payments || []) {
    const ym = monthOf(p.paid_on || p.post_date); if (!ym) continue;
    if (/^(void|declined|fail)/i.test(String(p.status || ""))) continue;
    const t = p.payment_type || "?";
    payments[ym] = payments[ym] || { total: 0, byType: {} };
    payments[ym].total = r2(payments[ym].total + num(p.amount));
    payments[ym].byType[t] = r2((payments[ym].byType[t] || 0) + num(p.amount));
  }

  // ---- 4. open payables (APCurrent) ---------------------------------------
  const apByInv = new Map();
  for (const r of finance?.ap || []) {
    const k = `${r.supplier_code}|${r.invoice}`;
    const cur = apByInv.get(k) || { supplier: r.supplier_code, invoice: r.invoice, amount: 0, due: "", hold: false };
    cur.amount = r2(cur.amount + num(r.amount));
    if (r.due_date && (!cur.due || r.due_date > cur.due)) cur.due = r.due_date;
    if (r.on_hold) cur.hold = true;
    apByInv.set(k, cur);
  }
  // Same rule on the AP side: a negative net per supplier invoice is a
  // credit / prepayment, not a bill to pay.
  const ap = { open: 0, pastDue: 0, count: 0, onHold: 0, bySupplier: {}, credits: 0, creditCount: 0, byRecordType: {} };
  for (const r of finance?.ap || []) { const t = r.record_type || "?"; ap.byRecordType[t] = ap.byRecordType[t] || { rows: 0, amount: 0 }; ap.byRecordType[t].rows++; ap.byRecordType[t].amount = r2(ap.byRecordType[t].amount + num(r.amount)); }
  const apRows = [];
  for (const a of apByInv.values()) {
    if (Math.abs(a.amount) < 0.005) continue;
    if (a.amount < 0) { ap.credits = r2(ap.credits - a.amount); ap.creditCount++; apRows.push({ ...a, bucket: "credit" }); continue; }
    const bucket = bucketOf(a.due || today);
    const key = bucket === "unscheduled" || bucket === "past" ? thisMonth : bucket; // overdue = pay now
    rows[key].apDue = r2(rows[key].apDue + a.amount);
    ap.open = r2(ap.open + a.amount); ap.count++;
    if (a.due && a.due < today) ap.pastDue = r2(ap.pastDue + a.amount);
    if (a.hold) ap.onHold = r2(ap.onHold + a.amount);
    ap.bySupplier[a.supplier] = r2((ap.bySupplier[a.supplier] || 0) + a.amount);
    apRows.push({ ...a, bucket });
  }
  const billedPOs = new Set((finance?.apPo || []).map((x) => String(x.po_code || "").toUpperCase()).filter(Boolean));

  // ---- 5. received, not yet billed -----------------------------------------
  const termsFor = termsLookup(finance?.terms);
  const unbilled = { count: 0, amount: 0, bySupplier: {} };
  for (const po of finance?.poReceived || []) {
    const code = String(po.po_code || "").toUpperCase();
    if (!code || billedPOs.has(code)) continue;
    const amount = r2(num(po.total_costed) || num(po.total_received));
    const from = po.date_received || po.date_costed; if (!amount || !from) continue;
    unbilled.count++; unbilled.amount = r2(unbilled.amount + amount);
    unbilled.bySupplier[po.supplier_code] = r2((unbilled.bySupplier[po.supplier_code] || 0) + amount);
    for (const inst of scheduleByTerms(amount, from, termsFor(po.supplier_code))) {
      const b = bucketOf(inst.due); const key = b === "past" ? thisMonth : b;
      if (rows[key]) rows[key].receivedUnbilled = r2(rows[key].receivedUnbilled + inst.amount);
    }
  }

  // ---- 6. open purchase orders ---------------------------------------------
  const po = { lines: 0, cost: 0, bySupplier: {}, noEta: 0 };
  for (const l of finance?.poOpen || []) {
    const amount = r2(num(l.qty_open) * num(l.unit_cost)); if (!amount) continue;
    po.lines++; po.cost = r2(po.cost + amount);
    po.bySupplier[l.supplier_code] = r2((po.bySupplier[l.supplier_code] || 0) + amount);
    const eta = l.eta && l.eta >= today ? l.eta : (l.eta ? today : ""); // late ETA = expect it now
    if (!eta) { po.noEta = r2(po.noEta + amount); continue; }
    const arrive = bucketOf(eta); if (rows[arrive]) rows[arrive].poArrivingCost = r2(rows[arrive].poArrivingCost + amount);
    for (const inst of scheduleByTerms(amount, eta, termsFor(l.supplier_code))) {
      const b = bucketOf(inst.due); if (rows[b] && b !== "past" && b !== "unscheduled") rows[b].poDue = r2(rows[b].poDue + inst.amount);
    }
  }

  // ---- totals per month --------------------------------------------------
  const table = horizon.map((ym) => {
    const r = rows[ym];
    const cashIn = r2(r.cashAtDelivery + r.arDue);
    const cashOut = r2(r.apDue + r.receivedUnbilled + r.poDue);
    const gm = r.revenueNet ? r2((r.revenueNet - r.cost) / r.revenueNet * 100) : null;
    return { month: ym, ...r, gmPercent: gm, cashIn, cashOut, net: r2(cashIn - cashOut) };
  });
  let running = 0; for (const t of table) { running = r2(running + t.net); t.cumulative = running; }
  const past = rows.past, unscheduled = rows.unscheduled, later = rows.later;

  // ---- actual GM from finished months (sales_order_detail) ----------------
  const actualByMonth = {};
  for (const a of actuals || []) {
    const ym = monthOf(a.finishDate || a.finish_date); if (!ym) continue;
    const x = actualByMonth[ym] = actualByMonth[ym] || { revenue: 0, cost: 0, orders: 0 };
    x.revenue = r2(x.revenue + num(a.revenue)); x.cost = r2(x.cost + num(a.cost)); x.orders++;
  }
  for (const x of Object.values(actualByMonth)) x.gmPercent = x.revenue ? r2((x.revenue - x.cost) / x.revenue * 100) : null;

  return {
    today, thisMonth, horizon, table,
    past: { ...past, label: "Scheduled before this month — needs a new date" },
    unscheduled: { ...unscheduled, label: "No schedule date yet" },
    later: { ...later, label: `Beyond ${horizon[horizon.length - 1]}` },
    book: { ...book, gmPercent: book.revenue ? r2((book.revenue - book.cost) / book.revenue * 100) : null },
    ar, ap, unbilled, po, payments, actualByMonth,
    detail: {
      book: bookRows.sort((a, b) => (a.scheduleDate || "9999") < (b.scheduleDate || "9999") ? -1 : 1),
      ar: arRows.sort((a, b) => b.arDue - a.arDue || b.deposits - a.deposits),
      ap: apRows.sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : 1)
    }
  };
}

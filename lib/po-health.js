// ---------------------------------------------------------------------------
// PURCHASE ORDER HEALTH (Andrew, 2026-09-27) — every open PO line from the
// ePASS finance feed (POModel with QtyOrdered > QtyReceived, any age), rolled
// up per PO with flags Purchasing can work from:
//
//   no-date        requested delivery date blank (and no ETA either)
//   late           requested delivery date is in the past
//   eta-passed     the (most updated) ETA is in the past
//   unconfirmed    the supplier never confirmed the PO (no confirmation / date)
//   unreleased     the PO is still a draft in ePASS
//   stale          ordered more than 180 days ago and still open
//   partial        some quantity received, the rest still open
//   ticket-closed  special-ordered for a ticket that is no longer open
//
// Nothing here writes to ePASS; the page is a review list.
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
const realDate = (d) => (d && d >= "1950-01-01" ? d : ""); // ePASS's 1899-12-30 = blank
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

export const PO_FLAGS = {
  "late": { label: "Late", note: "Requested delivery date has passed and the line is still open", severity: 3 },
  "no-date": { label: "No date", note: "No requested delivery date and no ETA on the line", severity: 3 },
  "eta-passed": { label: "ETA passed", note: "The most recent ETA is in the past", severity: 2 },
  "unconfirmed": { label: "Unconfirmed", note: "No supplier confirmation recorded on the PO", severity: 2 },
  "ticket-closed": { label: "Ticket closed", note: "Ordered for a sales ticket that is no longer open in ePASS", severity: 2 },
  "stale": { label: "Stale", note: "Ordered more than 180 days ago and still open", severity: 1 },
  "partial": { label: "Partial", note: "Part of the quantity has been received", severity: 0 },
  "unreleased": { label: "Unreleased", note: "Still a draft in ePASS — not sent to the supplier", severity: 1 }
};

export function computePoHealth({ lines, openOrders = [], suppliers = [], today = new Date().toISOString().slice(0, 10), staleDays = 180 } = {}) {
  const openInv = new Map();
  for (const o of openOrders) { const c = pick(o, "Code").toUpperCase(); if (c) openInv.set(c, { status: pick(o, "JobStatusCode"), customer: [pick(o, "SoldToLastName"), pick(o, "SoldToFirstName")].filter(Boolean).join(", "), schedule: day(pick(o, "ScheduleDate")) }); }
  const supName = Object.fromEntries((suppliers || []).map((s) => [String(s.code || "").toUpperCase(), s.description || ""]));
  const pos = new Map();
  for (const l of lines || []) {
    const raw = l.raw || {};
    const code = String(l.po_code || pick(raw, "POCode")).toUpperCase(); if (!code) continue;
    const po = pos.get(code) || {
      po: code, supplierCode: String(l.supplier_code || pick(raw, "SupplierCode")).toUpperCase(), supplier: pick(raw, "SupplierDescription") || supName[String(l.supplier_code || "").toUpperCase()] || l.supplier_code || "",
      ordered: realDate(day(pick(raw, "DateOrdered"))), confirmed: realDate(day(pick(raw, "DateConfirmed"))), confirmation: pick(raw, "Confirmed"), buyer: pick(raw, "Buyer"),
      unreleased: !!l.unreleased, rdd: realDate(day(pick(raw, "PO_RequestedDeliveryDate"))), shipTo: pick(raw, "ShipToName") || pick(raw, "ShipToCode"),
      totalOrdered: r2(num(pick(raw, "TotalOrdered"))), totalReceived: r2(num(pick(raw, "TotalReceived"))),
      lines: [], openCost: 0, openQty: 0, flags: new Set()
    };
    const qtyOrdered = num(pick(raw, "QtyOrdered")), qtyReceived = num(pick(raw, "QtyReceived"));
    const qtyOpen = Math.max(0, num(l.qty_open) || qtyOrdered - qtyReceived);
    const unit = num(l.unit_cost);
    const rdd = realDate(day(pick(raw, "RequestedDeliveryDate"))) || po.rdd;
    const eta = realDate(day(pick(raw, "ETADateMostUpdated"))) || realDate(day(pick(raw, "ETADate")));
    const forInvoice = String(l.for_invoice || pick(raw, "BackOrderInvoiceCode")).toUpperCase();
    const ticket = forInvoice ? openInv.get(forInvoice) || openInv.get(forInvoice.replace(/-\d+$/, "")) || null : null;
    const line = { model: l.model_code || pick(raw, "ModelCode"), qtyOrdered, qtyReceived, qtyOpen, unitCost: unit, openCost: r2(qtyOpen * unit), rdd, eta, rsdConfirmed: pick(raw, "RSDConfirmed"), forInvoice, ticketOpen: forInvoice ? !!ticket : null, ticketCustomer: ticket?.customer || "", ticketStatus: ticket?.status || "", ticketSchedule: ticket?.schedule || "", flags: [] };
    if (!rdd && !eta) line.flags.push("no-date");
    if (rdd && rdd < today) line.flags.push("late");
    if (eta && eta < today) line.flags.push("eta-passed");
    if (qtyReceived > 0 && qtyOpen > 0) line.flags.push("partial");
    if (forInvoice && !ticket) line.flags.push("ticket-closed");
    po.lines.push(line); po.openCost = r2(po.openCost + line.openCost); po.openQty += qtyOpen;
    for (const f of line.flags) po.flags.add(f);
    pos.set(code, po);
  }
  const out = [];
  const counts = {}; for (const k of Object.keys(PO_FLAGS)) counts[k] = { pos: 0, cost: 0 };
  let openCost = 0, openLines = 0;
  for (const po of pos.values()) {
    if (po.unreleased) po.flags.add("unreleased");
    if (!po.confirmed && !po.confirmation && !po.unreleased) po.flags.add("unconfirmed");
    po.ageDays = po.ordered ? daysBetween(po.ordered, today) : null;
    if (po.ageDays != null && po.ageDays > staleDays) po.flags.add("stale");
    po.flags = [...po.flags].sort((a, b) => PO_FLAGS[b].severity - PO_FLAGS[a].severity);
    po.severity = po.flags.reduce((m, f) => Math.max(m, PO_FLAGS[f].severity), 0);
    po.nextDate = po.lines.map((l) => l.eta || l.rdd).filter(Boolean).sort()[0] || "";
    for (const f of po.flags) { counts[f].pos++; counts[f].cost = r2(counts[f].cost + po.openCost); }
    openCost = r2(openCost + po.openCost); openLines += po.lines.length;
    out.push(po);
  }
  out.sort((a, b) => (b.severity - a.severity) || ((a.nextDate || "9999") < (b.nextDate || "9999") ? -1 : (a.nextDate || "9999") > (b.nextDate || "9999") ? 1 : 0));
  const suppliersOut = [...new Set(out.map((p) => p.supplier || p.supplierCode))].sort();
  const buyers = [...new Set(out.map((p) => p.buyer).filter(Boolean))].sort();
  return { today, staleDays, pos: out, totals: { pos: out.length, lines: openLines, openCost, flagged: out.filter((p) => p.flags.length).length, clean: out.filter((p) => !p.flags.length).length }, counts, flags: PO_FLAGS, suppliers: suppliersOut, buyers };
}

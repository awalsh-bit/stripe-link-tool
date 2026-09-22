import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Sales / Service Order Health straight from the ePASS ODBC feed (Andrew,
// 2026-09-22): "use the data we have instead of the Invoice Maintenance
// upload". The 15-minute feed already lands every open sales invoice
// (epass_open_orders) and every open service ticket (epass_open_service) with
// the full Invoice header in `raw`, so the two health snapshots can be rebuilt
// from it on every bundle — same row shape the ExportInvoice parser produced
// (lib/epass-invoices.js), so the pages, the dashboard's "My Order Flags",
// the install-damage truck picker and the flag routing all keep working
// unchanged, and the manual upload buttons still work as a fallback.
//
// Column mapping, checked against the reference ExportInvoice_20260910 export:
//   Invoice #      Code                       SP            Salesperson1Code (KJB2 stays KJB2)
//   Inv Type       InvTypeCode                Route         DispatchRequestedRouteCode (JRC, D01…)
//   Status         Status (Open / Not Posted) Job Status    JobStatusCode (D1, SO1, CPU…)
//   Payment Type   PaymentTypeCode            Balance       Total − (committed + open payments)
//   * Sched Date   SvcScheduleDate ‖ ScheduleDate (service) · ScheduleDate (sales)
//   Pickup Date    PickUpDate                 Finish Date   InvFinishDate ‖ DateFinished
//   Name           SoldToLastName SoldToFirstName (the export has no comma)
//   Address / Zip  SoldToAddress1 / SoldToZipCode
//   Bill To Cust.  BillToCode ‖ SoldToCode    Bill To Email BillToEmail
//   PO # / Ref     PONumber / Reference       Map Zone      MapZoneCode
//   Service Model/Serial/Brand  SvcModel / SvcSerial / SvcBrandCode
//   Units / Qualif. / Priorities  DispatchUnits / Qualification / Priority
//   User Created   UserCreated                Date Created  DateCreated
// Total is the sum of the invoice's component totals (serial, item, labor,
// misc, warranty, three taxes) — the same arithmetic the Service Journey
// mirror uses; /api/epass/feed-vs-upload shows how it lines up against the
// last spreadsheet upload so any systematic gap is visible, not guessed.
// ---------------------------------------------------------------------------

const pick = (row, ...names) => {
  for (const n of names) {
    const k = Object.keys(row || {}).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k != null && row[k] != null && String(row[k]).trim() !== "") return row[k];
  }
  return null;
};
const text = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const isoDate = (v) => {
  const s = String(v == null ? "" : v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
};

export const TOTAL_PARTS = ["SerialTotal", "ItemTotal", "LaborTotal", "MiscTotal", "WtyTotal", "Tax1Total", "Tax2Total", "Tax3Total"];

// One Invoice header (the feed's `raw`) → one health-report row.
export function orderRowFromInvoice(raw, { service = false } = {}) {
  const invoice = text(pick(raw, "Code"), 40).toUpperCase();
  if (!invoice) return null;
  const invType = text(pick(raw, "InvTypeCode"), 10).toUpperCase() || invoice.replace(/\d.*$/, "");
  const total = TOTAL_PARTS.reduce((a, c) => a + (num(pick(raw, c)) || 0), 0);
  const paid = (num(pick(raw, "CommittedPaymentTotal")) || 0) + (num(pick(raw, "OpenPaymentTotal")) || 0);
  const last = text(pick(raw, "SoldToLastName"), 80), first = text(pick(raw, "SoldToFirstName"), 60);
  const sched = service ? (isoDate(pick(raw, "SvcScheduleDate")) || isoDate(pick(raw, "ScheduleDate"))) : isoDate(pick(raw, "ScheduleDate"));
  return {
    invType, invoice,
    sp: text(pick(raw, "Salesperson1Code"), 20), userCreated: text(pick(raw, "UserCreated"), 20), dateCreated: isoDate(pick(raw, "DateCreated")),
    paymentType: text(pick(raw, "PaymentTypeCode"), 20).toUpperCase(), balance: Math.round((total - paid) * 100) / 100, total: Math.round(total * 100) / 100,
    status: text(pick(raw, "Status"), 40), pickupDate: isoDate(pick(raw, "PickUpDate")), schedDate: sched,
    route: text(pick(raw, "DispatchRequestedRouteCode"), 20), jobStatus: text(pick(raw, "JobStatusCode"), 30).toUpperCase(),
    customerNumber: text(pick(raw, "BillToCode") || pick(raw, "SoldToCode"), 40),
    name: [last, first].filter(Boolean).join(" ").slice(0, 120), address: text(pick(raw, "SoldToAddress1"), 160), zip: text(pick(raw, "SoldToZipCode"), 20),
    po: text(pick(raw, "PONumber"), 60), reference: text(pick(raw, "Reference"), 120),
    finishDate: isoDate(pick(raw, "InvFinishDate")) || isoDate(pick(raw, "DateFinished")), mapZone: text(pick(raw, "MapZoneCode"), 20),
    serviceModel: text(pick(raw, "SvcModel"), 60), serviceSerial: text(pick(raw, "SvcSerial"), 60), serviceBrand: text(pick(raw, "SvcBrandCode"), 40),
    billToEmail: text(pick(raw, "BillToEmail"), 120), units: num(pick(raw, "DispatchUnits")), qualification: text(pick(raw, "Qualification"), 10), priorities: text(pick(raw, "Priority"), 40)
  };
}

// The rows the Sales Order Health snapshot stores (the same fields the page's
// own upload posts), from the open-orders feed.
export async function salesOrderRowsFromFeed() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const r = await pool.query(`SELECT code, raw FROM epass_open_orders ORDER BY code`);
  const rows = [];
  for (const t of r.rows) {
    const row = orderRowFromInvoice(t.raw || {});
    if (!row || /^SV\d/.test(row.invoice) || row.invType === "SV" || row.invType === "WTY") continue;
    const { invoice, sp, userCreated, dateCreated, paymentType, balance, total, status, pickupDate, schedDate, route, jobStatus, customerNumber, name, address, zip, po, reference } = row;
    rows.push({ invoice, sp, userCreated, dateCreated, paymentType, balance, total, status, pickupDate, schedDate, route, jobStatus, customerNumber, name, address, zip, po, reference });
  }
  return rows;
}

// The rows the Service Order Health snapshot stores (with the service
// columns the page passes through), from the open-service feed.
export async function serviceOrderRowsFromFeed() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const r = await pool.query(`SELECT code, raw FROM epass_open_service ORDER BY code`);
  const rows = [];
  for (const t of r.rows) {
    const row = orderRowFromInvoice(t.raw || {}, { service: true });
    if (!row) continue;
    rows.push(row);
  }
  return rows;
}

// How the feed-built rows line up against a snapshot that came from a
// spreadsheet upload: per field, how many invoices in both agree. Run once
// after the switch to see whether Total/Balance/Route need a tweak.
export function compareOrderRows(feedRows, uploadRows) {
  const FIELDS = ["sp", "paymentType", "balance", "total", "status", "schedDate", "pickupDate", "route", "jobStatus", "name", "address", "zip", "customerNumber", "po", "reference", "dateCreated"];
  const up = new Map((uploadRows || []).map((r) => [String(r.invoice || "").trim().toUpperCase(), r]));
  const out = { feedRows: feedRows.length, uploadRows: (uploadRows || []).length, inBoth: 0, onlyInFeed: [], onlyInUpload: [], fields: {} };
  for (const f of FIELDS) out.fields[f] = { same: 0, differ: 0, samples: [] };
  const seen = new Set();
  for (const fr of feedRows) {
    const k = String(fr.invoice || "").trim().toUpperCase(); seen.add(k);
    const ur = up.get(k);
    if (!ur) { if (out.onlyInFeed.length < 25) out.onlyInFeed.push(k); continue; }
    out.inBoth += 1;
    for (const f of FIELDS) {
      const a = fr[f], b = ur[f];
      const same = (typeof a === "number" || typeof b === "number") ? Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005 : String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();
      if (same) out.fields[f].same += 1; else { out.fields[f].differ += 1; if (out.fields[f].samples.length < 6) out.fields[f].samples.push({ invoice: k, feed: a, upload: b }); }
    }
  }
  for (const k of up.keys()) if (!seen.has(k) && out.onlyInUpload.length < 25) out.onlyInUpload.push(k);
  return out;
}

// ---------------------------------------------------------------------------
// Open quotes for the Quote Follow-Up board (9/22): the same rows the Invoice
// Maintenance quote export gave parseInvoiceMaintenanceQuotes, built from the
// feed's `open-quotes` dataset. The one ambiguity is which ePASS code the
// export printed as "Customer #" — SoldToCode or BillToCode — and the board
// matches conversions on it, so the caller calibrates: `customerField`
// picks the one that agrees with the quotes already stored.
// ---------------------------------------------------------------------------
export function quotesFromFeedRows(rows, { customerField = "SoldToCode" } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of rows || []) {
    const quoteNumber = text(pick(raw, "Code"), 40).toUpperCase();
    if (!quoteNumber || seen.has(quoteNumber)) continue;
    const status = text(pick(raw, "Status"), 40);
    if (status && status.toLowerCase() !== "open") continue;
    seen.add(quoteNumber);
    const total = TOTAL_PARTS.reduce((a, c) => a + (num(pick(raw, c)) || 0), 0);
    const paid = (num(pick(raw, "CommittedPaymentTotal")) || 0) + (num(pick(raw, "OpenPaymentTotal")) || 0);
    const last = text(pick(raw, "SoldToLastName"), 80), first = text(pick(raw, "SoldToFirstName"), 60);
    out.push({
      quoteNumber,
      spCode: text(pick(raw, "Salesperson1Code"), 20).toUpperCase(),
      dateCreated: isoDate(pick(raw, "DateCreated")),
      total: Math.round(total * 100) / 100,
      balance: Math.round((total - paid) * 100) / 100,
      customerNumber: text(pick(raw, customerField) || pick(raw, "SoldToCode") || pick(raw, "BillToCode"), 40),
      customerName: [last, first].filter(Boolean).join(" ").slice(0, 120),
      address: text(pick(raw, "SoldToAddress1"), 160),
      zip: text(pick(raw, "SoldToZipCode"), 20),
      jobStatus: text(pick(raw, "JobStatusCode"), 30).toUpperCase(),
      paymentType: text(pick(raw, "PaymentTypeCode"), 20).toUpperCase(),
      reference: text(pick(raw, "Reference"), 120)
    });
  }
  return out;
}

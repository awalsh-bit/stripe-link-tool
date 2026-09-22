import { getPostgresPool } from "./data-postgres.js";
import { departmentForInvoice, serviceTypeForTicket, VALUE_COLUMNS } from "./salesperson-activity.js";

// ---------------------------------------------------------------------------
// Finished orders straight from the ePASS ODBC feed (Andrew, 2026-09-22:
// "we need to replace the OE-23 warehouse too"). The pull script's sales
// bundle now carries every invoice finished since the 1st of the previous
// month (header + the cost columns of its lines) plus the Salesperson master.
// This module turns that into the exact ticket shape the OE-23 parser
// (lib/salesperson-activity.js parseActivityGrid) produced, so everything
// downstream — sales_order_detail, Performance vs Target, the sales and
// service commission reports, quote conversions, builder accounts, aging
// inventory — keeps reading the same rows, fifteen minutes fresh instead of
// once a day by hand.
//
// OE-23 row ↔ feed:
//   invoice        Code                     salesperson   Salesperson master name for
//   finish date    InvFinishDate ‖ DateFinished            Salesperson1Code, upper-cased
//   reference      Reference                customer #    BillToCode ‖ SoldToCode
//   customer name  BillTo LAST FIRST ‖ SoldTo LAST FIRST (warranty tickets bill the maker)
//   L: Product     SerialTotal              C: Product    Σ InvoiceSerial.UnitCost (not returned)
//   L: Parts       ItemTotal                C: Parts      Σ InvoiceItem.UnitCost × qty shipped
//   L: Labor       LaborTotal               C: Labor      Σ InvoiceLabor.Cost ‖ ActualCost ‖ StandardCost
//   L: Wty         WtyTotal                 C: Wty        Σ InvoiceWarranty.UnitCost
//   L: Misc        MiscTotal                C: Misc       Σ InvoiceMisc.UnitCost × Qty
//   L: Taxes       0 (sic)                  C: Taxes      Tax1 + Tax2 + Tax3 (where OE-23 prints it)
//   L: Total (no Tax) = the five list columns; Invoice TOTAL = that + taxes
//   P: (profit)    list − cost, column by column
// /api/epass/feed-vs-oe23?month=YYYY-MM shows how the feed's tickets line up
// against the last OE-23 upload of that month, invoice by invoice, so any
// systematic gap (a cost column ePASS books differently) is visible.
// ---------------------------------------------------------------------------

const pick = (row, ...names) => {
  for (const n of names) {
    const k = Object.keys(row || {}).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k != null && row[k] != null && String(row[k]).trim() !== "") return row[k];
  }
  return null;
};
const text = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
const num = (v) => { if (v == null || v === "") return 0; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const truthy = (v) => v === true || /^(true|1|y|yes)$/i.test(String(v == null ? "" : v).trim());
const isoDate = (v) => {
  const s = String(v == null ? "" : v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
};
const emptyValues = () => Object.fromEntries(VALUE_COLUMNS.map((k) => [k, 0]));

// Salesperson master rows → { CODE: "NAME" } (OE-23 printed the master's
// description in capitals).
export function salespersonNamesFromFeed(rows) {
  const out = {};
  for (const r of rows || []) {
    const code = text(pick(r, "Code"), 20).toUpperCase();
    const name = text(pick(r, "Description"), 120);
    if (code && name) out[code] = name.toUpperCase().replace(/\s+/g, " ");
  }
  return out;
}

function sumByInvoice(rows, fn) {
  const out = new Map();
  for (const r of rows || []) {
    const inv = text(pick(r, "InvoiceCode"), 40).toUpperCase();
    if (!inv) continue;
    const v = fn(r);
    if (!Number.isFinite(v)) continue;
    out.set(inv, (out.get(inv) || 0) + v);
  }
  return out;
}

// The bundle's finished-* datasets → OE-23 tickets. `since` (yyyy-mm-dd)
// drops anything finished before the window the pull covered.
export function finishedTicketsFromFeed(datasets, { names = {}, since = "" } = {}) {
  const d = datasets || {};
  const serialCost = sumByInvoice(d["finished-serials"], (r) => (truthy(pick(r, "Returned")) ? 0 : num(pick(r, "UnitCost"))));
  const itemCost = sumByInvoice(d["finished-items"], (r) => {
    const qty = pick(r, "QtyShipped") != null ? num(pick(r, "QtyShipped")) : num(pick(r, "QtyOrdered"));
    return num(pick(r, "UnitCost")) * (qty || 0);
  });
  const laborCost = sumByInvoice(d["finished-labor"], (r) => num(pick(r, "Cost") ?? pick(r, "ActualCost") ?? pick(r, "StandardCost")));
  const miscCost = sumByInvoice(d["finished-misc"], (r) => num(pick(r, "UnitCost")) * (pick(r, "Qty") != null ? num(pick(r, "Qty")) : 1));
  const wtyCost = sumByInvoice(d["finished-warranty"], (r) => num(pick(r, "UnitCost")));

  const tickets = [];
  const seen = new Set();
  for (const raw of d["finished-orders"] || []) {
    const invoice = text(pick(raw, "Code"), 40).toUpperCase();
    if (!invoice || seen.has(invoice)) continue;
    const finishDate = isoDate(pick(raw, "InvFinishDate")) || isoDate(pick(raw, "DateFinished"));
    if (!finishDate || (since && finishDate < since)) continue;
    seen.add(invoice);

    const list = emptyValues();
    list.product = r2(pick(raw, "SerialTotal"));
    list.parts = r2(pick(raw, "ItemTotal"));
    list.labor = r2(pick(raw, "LaborTotal"));
    list.wty = r2(pick(raw, "WtyTotal"));
    list.misc = r2(pick(raw, "MiscTotal"));
    list.taxAdj = 0;
    // OE-23 quirk (checked against a real report, 9/22): the invoice tax is
    // printed on the C: row's Taxes column, the L: row shows 0.00, and only
    // the L: Invoice TOTAL includes it. Stored the same way so feed rows and
    // upload rows are identical.
    const taxes = r2(num(pick(raw, "Tax1Total")) + num(pick(raw, "Tax2Total")) + num(pick(raw, "Tax3Total")));
    list.taxes = 0;
    list.totalNoTax = r2(list.product + list.parts + list.labor + list.wty + list.misc + list.taxAdj);
    list.invoiceTotal = r2(list.totalNoTax + taxes);

    const cost = emptyValues();
    cost.product = r2(serialCost.get(invoice) || 0);
    cost.parts = r2(itemCost.get(invoice) || 0);
    cost.labor = r2(laborCost.get(invoice) || 0);
    cost.wty = r2(wtyCost.get(invoice) || 0);
    cost.misc = r2(miscCost.get(invoice) || 0);
    cost.taxes = taxes;
    cost.totalNoTax = r2(cost.product + cost.parts + cost.labor + cost.wty + cost.misc);
    cost.invoiceTotal = cost.totalNoTax;

    const profit = emptyValues();
    for (const k of VALUE_COLUMNS) profit[k] = r2(list[k] - cost[k]);

    const spCode = text(pick(raw, "Salesperson1Code"), 20).toUpperCase();
    const customerNumber = text(pick(raw, "BillToCode") || pick(raw, "SoldToCode"), 40);
    const billName = [text(pick(raw, "BillToLastName"), 80), text(pick(raw, "BillToFirstName"), 60)].filter(Boolean).join(" ");
    const soldName = [text(pick(raw, "SoldToLastName"), 80), text(pick(raw, "SoldToFirstName"), 60)].filter(Boolean).join(" ");
    tickets.push({
      invoice,
      department: departmentForInvoice(invoice),
      serviceType: serviceTypeForTicket({ invoice, customerNumber }),
      salesperson: names[spCode] || spCode || "(no salesperson)",
      salespersonCode: spCode,
      finishDate,
      reference: text(pick(raw, "Reference"), 120),
      customerNumber,
      customerName: (billName || soldName).slice(0, 160),
      invType: text(pick(raw, "InvTypeCode"), 10).toUpperCase(),
      status: text(pick(raw, "Status"), 20).toUpperCase(),
      jobStatus: text(pick(raw, "JobStatusCode"), 30).toUpperCase(),
      list, cost, profit
    });
  }
  tickets.sort((a, b) => (a.finishDate < b.finishDate ? -1 : a.finishDate > b.finishDate ? 1 : a.invoice < b.invoice ? -1 : 1));
  return tickets;
}

// Group tickets by calendar month of finish date → { "2026-09": [tickets] }.
export function ticketsByMonth(tickets) {
  const out = {};
  for (const t of tickets) (out[t.finishDate.slice(0, 7)] ||= []).push(t);
  return out;
}

// The OE-23 "open orders" run (Report by: Invoice Start Date) that fed
// open_sales_orders, rebuilt from the open-orders feed already on file.
export async function openOrderTicketsFromFeed({ names = {} } = {}) {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const r = await pool.query(`SELECT code, raw FROM epass_open_orders ORDER BY code`);
  const tickets = [];
  let from = "", to = "";
  for (const row of r.rows) {
    const raw = row.raw || {};
    const invoice = text(pick(raw, "Code") || row.code, 40).toUpperCase();
    if (!invoice) continue;
    const spCode = text(pick(raw, "Salesperson1Code"), 20).toUpperCase();
    const start = isoDate(pick(raw, "InvStartDate")) || isoDate(pick(raw, "DateCreated"));
    const total = ["SerialTotal", "ItemTotal", "LaborTotal", "MiscTotal", "WtyTotal", "Tax1Total", "Tax2Total", "Tax3Total"].reduce((a, c) => a + num(pick(raw, c)), 0);
    const billName = [text(pick(raw, "BillToLastName"), 80), text(pick(raw, "BillToFirstName"), 60)].filter(Boolean).join(" ");
    const soldName = [text(pick(raw, "SoldToLastName"), 80), text(pick(raw, "SoldToFirstName"), 60)].filter(Boolean).join(" ");
    if (start && (!from || start < from)) from = start;
    if (start && (!to || start > to)) to = start;
    tickets.push({
      invoice, department: departmentForInvoice(invoice),
      salesperson: names[spCode] || spCode, salespersonCode: spCode,
      finishDate: start,
      customerNumber: text(pick(raw, "BillToCode") || pick(raw, "SoldToCode"), 40),
      customerName: (billName || soldName).slice(0, 160),
      list: { invoiceTotal: r2(total) }
    });
  }
  return { tickets, periodFrom: from, periodTo: to };
}

// Flatten a ticket for the field-by-field compare (feed vs the last OE-23
// upload). Money fields compare within half a cent, text case-insensitively.
export function flattenTicket(t) {
  return {
    invoice: t.invoice, salesperson: t.salesperson, finishDate: t.finishDate, customerNumber: t.customerNumber, customerName: t.customerName,
    reference: t.reference, department: t.department, serviceType: t.serviceType,
    listProduct: Number(t.list?.product) || 0, listParts: Number(t.list?.parts) || 0, listLabor: Number(t.list?.labor) || 0, listWty: Number(t.list?.wty) || 0, listMisc: Number(t.list?.misc) || 0,
    listTaxes: Number(t.list?.taxes) || 0, listTotalNoTax: Number(t.list?.totalNoTax) || 0, listInvoiceTotal: Number(t.list?.invoiceTotal) || 0,
    costProduct: Number(t.cost?.product) || 0, costParts: Number(t.cost?.parts) || 0, costLabor: Number(t.cost?.labor) || 0, costWty: Number(t.cost?.wty) || 0, costMisc: Number(t.cost?.misc) || 0,
    costTotalNoTax: Number(t.cost?.totalNoTax) || 0, profitTotalNoTax: Number(t.profit?.totalNoTax) || 0
  };
}

export function compareTickets(feedTickets, uploadTickets) {
  const FIELDS = ["salesperson", "finishDate", "customerNumber", "customerName", "reference", "department", "serviceType",
    "listProduct", "listParts", "listLabor", "listWty", "listMisc", "listTaxes", "listTotalNoTax", "listInvoiceTotal",
    "costProduct", "costParts", "costLabor", "costWty", "costMisc", "costTotalNoTax", "profitTotalNoTax"];
  const up = new Map((uploadTickets || []).map(flattenTicket).map((r) => [r.invoice, r]));
  const out = { feedTickets: (feedTickets || []).length, uploadTickets: (uploadTickets || []).length, inBoth: 0, onlyInFeed: [], onlyInUpload: [], fields: {}, totals: { feed: 0, upload: 0 } };
  for (const f of FIELDS) out.fields[f] = { same: 0, differ: 0, feedSum: 0, uploadSum: 0, samples: [] };
  const seen = new Set();
  for (const ft of (feedTickets || []).map(flattenTicket)) {
    seen.add(ft.invoice);
    out.totals.feed = r2(out.totals.feed + ft.listTotalNoTax);
    const ur = up.get(ft.invoice);
    if (!ur) { if (out.onlyInFeed.length < 40) out.onlyInFeed.push({ invoice: ft.invoice, finishDate: ft.finishDate, revenue: ft.listTotalNoTax, status: (feedTickets.find((t) => t.invoice === ft.invoice) || {}).status || "" }); continue; }
    out.inBoth += 1;
    for (const f of FIELDS) {
      const a = ft[f], b = ur[f];
      const numeric = typeof a === "number" || typeof b === "number";
      if (numeric) { out.fields[f].feedSum = r2(out.fields[f].feedSum + (Number(a) || 0)); out.fields[f].uploadSum = r2(out.fields[f].uploadSum + (Number(b) || 0)); }
      const same = numeric ? Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005 : String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();
      if (same) out.fields[f].same += 1; else { out.fields[f].differ += 1; if (out.fields[f].samples.length < 8) out.fields[f].samples.push({ invoice: ft.invoice, feed: a, upload: b }); }
    }
  }
  for (const [k, ur] of up) { out.totals.upload = r2(out.totals.upload + ur.listTotalNoTax); if (!seen.has(k) && out.onlyInUpload.length < 40) out.onlyInUpload.push({ invoice: k, finishDate: ur.finishDate, revenue: ur.listTotalNoTax }); }
  return out;
}

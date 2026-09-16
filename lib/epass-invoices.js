import { read as readWorkbook, utils as xlsxUtils } from "xlsx";

// ---------------------------------------------------------------------------
// ePASS Invoice Maintenance export (ExportInvoice_*.xlsx) — ONE parser for
// the whole "open orders" pull (Andrew, 2026-09-16). One filter in ePASS
// now yields every open sales AND service invoice (S, R, CB, AC, MD, SV,
// WTY …); this module reads that workbook once and splits it so a single
// upload feeds the Sales Order Health report, the Service Order Health
// report (+ Service Journey mirror + flag routing) and, when the file also
// carries finished invoices, the commission balance check.
//
// Same column mapping as the two pages' in-browser parsers (headerKey), so
// the snapshots keep their exact shapes. Header row is FOUND, not assumed —
// the raw export has a title row and a blank row above it.
// ---------------------------------------------------------------------------

export const SERVICE_INV_TYPES = new Set(["SV", "WTY"]);

function normHeader(v) {
  return String(v == null ? "" : v).replace(/[\s ]+/g, " ").trim().toLowerCase();
}

function headerKey(header) {
  const h = normHeader(header);
  if (!h) return null;
  if (h.includes("inv type")) return "invType";
  if (h.includes("user created")) return "userCreated";
  if (h === "sp") return "sp";
  if (h.includes("date created")) return "dateCreated";
  if (h.includes("invoice")) return "invoice";
  if (h.includes("payment type")) return "paymentType";
  if (h.includes("balance")) return "balance";
  if (h.includes("total")) return "total";
  if (h.includes("job status")) return "jobStatus";
  if (h === "status") return "status";
  if (h.includes("pickup")) return "pickupDate";
  if (h.includes("finish")) return "finishDate";
  if (h.includes("sched")) return "schedDate";
  if (h.includes("route")) return "route";
  if (h.includes("map") || h.includes("zone")) return "mapZone";
  if (h.includes("customer")) return "customerNumber";
  if (h === "name") return "name";
  if (h.includes("address")) return "address";
  if (h.includes("zip")) return "zip";
  if (h.includes("e-mail") || h.includes("email")) return "billToEmail";
  if (h.includes("serial")) return "serviceSerial";
  if (h.includes("model")) return "serviceModel";
  if (h.includes("brand")) return "serviceBrand";
  if (h.includes("qualif")) return "qualification";
  if (h.includes("priorit")) return "priorities";
  if (h.includes("unit")) return "units";
  if (h === "po" || h.includes("po #")) return "po";
  if (h.includes("reference")) return "reference";
  return null;
}

// Excel serials, JS Dates, "2026-09-19", "9/19/2026" → "YYYY-MM-DD" (or "").
export function toIsoDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 864e5));
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}

const text = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

export function parseInvoiceMaintenanceWorkbook(buffer) {
  const wb = readWorkbook(buffer, { type: "buffer", cellDates: true, raw: true });
  for (const name of wb.SheetNames) {
    const grid = xlsxUtils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    const headerIndex = grid.findIndex((row) => {
      const t = (row || []).map(normHeader);
      return t.some((x) => x.includes("job status")) || (t.some((x) => x.includes("invoice")) && t.some((x) => x.includes("balance") || x.includes("total")) && t.some((x) => x.includes("sched") || x.includes("route")));
    });
    if (headerIndex < 0) continue;
    const keys = grid[headerIndex].map(headerKey);
    const rows = [];
    for (let i = headerIndex + 1; i < grid.length; i++) {
      const raw = grid[i];
      if (!raw || raw.every((c) => c == null || c === "")) continue;
      const r = {};
      keys.forEach((k, col) => { if (k) r[k] = raw[col]; });
      const invoice = text(r.invoice, 40).toUpperCase();
      if (!/^[A-Z]{1,3}\d{4,}/.test(invoice)) continue;
      const invType = text(r.invType, 10).toUpperCase() || invoice.replace(/\d.*$/, "");
      rows.push({
        invType, invoice,
        sp: text(r.sp, 20), userCreated: text(r.userCreated, 20), dateCreated: toIsoDate(r.dateCreated),
        paymentType: text(r.paymentType, 20), balance: num(r.balance), total: num(r.total),
        status: text(r.status, 40), pickupDate: toIsoDate(r.pickupDate), schedDate: toIsoDate(r.schedDate),
        route: text(r.route, 20), jobStatus: text(r.jobStatus, 30), customerNumber: text(r.customerNumber, 40),
        name: text(r.name, 120), address: text(r.address, 160), zip: text(r.zip, 20), po: text(r.po, 60), reference: text(r.reference, 120),
        // service-only columns — present on the service-specific export, blank on the combined pull (fill-only downstream)
        finishDate: toIsoDate(r.finishDate), mapZone: text(r.mapZone, 20), serviceModel: text(r.serviceModel, 60), serviceSerial: text(r.serviceSerial, 60),
        serviceBrand: text(r.serviceBrand, 40), billToEmail: text(r.billToEmail, 120), units: num(r.units), qualification: text(r.qualification, 10), priorities: text(r.priorities, 40)
      });
    }
    if (rows.length) return { sheet: name, headerIndex, rows };
  }
  const err = new Error("Couldn't find the invoice header row (Invoice #, Balance, Job Status…) — is this the ePASS Invoice Maintenance export?");
  err.code = "NOT_INVOICE_EXPORT";
  throw err;
}

// A row is a service ticket by Inv Type (SV / WTY) or, failing that, by the
// SV prefix on the invoice number. Everything else is a sales-side order.
export function isServiceRow(row) {
  return SERVICE_INV_TYPES.has(String(row.invType || "").toUpperCase()) || /^SV\d/.test(String(row.invoice || ""));
}

// Open-order statuses. Anything else (Finished, Posted, Closed…) means the
// invoice is done and its balance is a receivable — the commission balance
// check's business.
const OPEN_STATUSES = new Set(["open", "not posted", "committed", "quote", "cancelled", "canceled", "void", "voided"]);
export function isFinishedRow(row) {
  const s = String(row.status || "").trim().toLowerCase();
  return !!s && !OPEN_STATUSES.has(s);
}

export function splitInvoiceRows(rows) {
  const service = [], sales = [];
  for (const r of rows) (isServiceRow(r) ? service : sales).push(r);
  const finished = rows.filter(isFinishedRow);
  const types = {};
  for (const r of rows) types[r.invType || "?"] = (types[r.invType || "?"] || 0) + 1;
  return { sales, service, finished, types };
}

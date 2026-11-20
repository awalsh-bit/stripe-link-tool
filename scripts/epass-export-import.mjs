#!/usr/bin/env node
// =============================================================================
// Agility - ePASS HISTORY EXPORT -> agent bundles (11/20)
//
// Andrew, 11/20: "I just dropped all of ePASS's historical data in to the
// data folder in wilson-agility. Can you dig through it and see if you can
// figure out how to use that instead of pinging the ODBC for all of our
// historical data?"
//
// Reads the full ePASS export (data/EPASS_FULL_EXPORT_<date>/, Nov 2006 on)
// and writes the same kind of JSON bundles epass-odbc-pull.ps1 writes, marked
// as history, for the agent to send as kind "epass-history":
//
//   epass-history-1-customers-totals.json   Customer Master lifetime sales + service per
//   epass-history-1-customers-brands.json   customer, and the brands they bought, as of --cutoff
//   epass-history-2-catalogue-<yyyy>.json   finished SV/WTY tickets + parts + labor, one year each
//   epass-history-3-orders-<yyyy-mm>.json   finished sales orders (R/S/AC/CAB/MOD) with their
//                                           model / serial / misc / item / labor / warranty lines,
//                                           one calendar month each
//
// Agility only fills in with them (server.js processHistoryBundle): months the
// live feed already has are skipped, tickets already in the service catalogue
// are left alone, and nothing becomes a commission or Performance vs Target
// month. Re-sending a bundle adds nothing twice.
//
// Data minimization: only the columns the ODBC pull itself sends are copied
// (an allow-list per dataset), never emails, tax-exempt numbers, credit
// fields, notes or comments. Files 01 (customers), 02 (all-type master),
// 08 / 09 (comments, notes), 13 / 15 and the backups are not read.
//
// Usage (Node 18+), from the repo folder:
//   node scripts/epass-export-import.mjs                       newest data/EPASS_FULL_EXPORT_* folder
//   node scripts/epass-export-import.mjs --export <folder> --out <folder> --cutoff 2026-11-17
//   node scripts/epass-export-import.mjs --only customers,catalogue,orders
// Default output: <export folder>/_agility-history/epass-history/ (git-ignored
// with the export). Copy that folder's files into the agent's
// outbox\epass-history\ on the ePASS server; see docs/epass-history-import.md.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const SALES_TYPES = new Set(["R", "S", "AC", "CAB", "MOD"]);
const DENY = /SSN|SocialSec|BirthDate|DOB|Password|CreditCard|CardNumber|CardNo|CVV|Routing|BankAcc|DriversLic|DLNumber|TaxId|FedId|FederalId|TINNumber|Exempt|Email|Credit/i;

// ---- arguments ----------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name, def = "") => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function newestExport() {
  const dataDir = path.join(repoRoot, "data");
  const dirs = fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter((d) => /^EPASS_FULL_EXPORT_\d{8}/.test(d) && fs.statSync(path.join(dataDir, d)).isDirectory()).sort() : [];
  return dirs.length ? path.join(dataDir, dirs[dirs.length - 1]) : "";
}
const exportDir = path.resolve(opt("export", newestExport()));
if (!exportDir || !fs.existsSync(path.join(exportDir, "02A_Sales_Invoice_Master.csv"))) {
  console.error(`No ePASS export found${exportDir ? ` at ${exportDir}` : ""} (looked for 02A_Sales_Invoice_Master.csv). Pass --export <folder>.`);
  process.exit(1);
}
const outDir = path.resolve(opt("out", path.join(exportDir, "_agility-history", "epass-history")));
const only = new Set(opt("only", "customers,catalogue,orders").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const addDays = (iso, n) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
function defaultCutoff() {
  // The day before the export's last refresh (the refresh day itself is partial).
  const stamps = fs.readdirSync(exportDir).map((f) => (f.match(/^00_Refresh_(\d{4})(\d{2})(\d{2})\.csv$/) || [])).filter((m) => m.length).map((m) => `${m[1]}-${m[2]}-${m[3]}`).sort();
  const folder = path.basename(exportDir).match(/(\d{4})(\d{2})(\d{2})/);
  const last = stamps.length ? stamps[stamps.length - 1] : folder ? `${folder[1]}-${folder[2]}-${folder[3]}` : "";
  return last ? addDays(last, -1) : addDays(new Date().toISOString().slice(0, 10), -1);
}
const cutoff = opt("cutoff", defaultCutoff());
if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) { console.error(`--cutoff must be yyyy-mm-dd (got "${cutoff}").`); process.exit(1); }
const source = `ePASS export ${path.basename(exportDir)}`;
const pulledAt = new Date().toISOString().slice(0, 19);
const machine = os.hostname();

// ---- CSV, streamed --------------------------------------------------------------
// Full RFC 4180: quoted fields, "" escapes, commas and line breaks inside
// quotes, CRLF or LF. A row cut by a chunk boundary is parsed again whole.
function parseRow(s, i, eof) {
  const row = [], n = s.length;
  for (;;) {
    if (i >= n) { if (eof) { row.push(""); return { row, next: i }; } return null; }
    if (s.charCodeAt(i) === 34) { // "
      let j = i + 1, start = j, val = "";
      for (;;) {
        const q = s.indexOf('"', j);
        if (q === -1) { if (!eof) return null; val += s.slice(start); i = n; break; }
        if (q + 1 >= n && !eof) return null;
        if (s.charCodeAt(q + 1) === 34) { val += s.slice(start, q) + '"'; j = q + 2; start = j; continue; }
        val += s.slice(start, q); i = q + 1; break;
      }
      while (i < n) { const c = s.charCodeAt(i); if (c === 44 || c === 10 || c === 13) break; val += s[i]; i++; } // stray text after a closing quote
      row.push(val);
    } else {
      let j = i;
      while (j < n) { const c = s.charCodeAt(j); if (c === 44 || c === 10 || c === 13) break; j++; }
      if (j >= n && !eof) return null;
      row.push(s.slice(i, j)); i = j;
    }
    if (i >= n) { if (eof) return { row, next: i }; return null; }
    const c = s.charCodeAt(i);
    if (c === 44) { i++; continue; }
    if (c === 13) { if (i + 1 >= n && !eof) return null; return { row, next: s.charCodeAt(i + 1) === 10 ? i + 2 : i + 1 }; }
    return { row, next: i + 1 }; // \n
  }
}
async function readCsv(name, onRow) {
  const file = path.join(exportDir, name);
  if (!fs.existsSync(file)) { console.warn(`  (missing ${name} - skipped)`); return 0; }
  const t0 = Date.now();
  let buf = "", head = null, ix = null, count = 0, first = true;
  const emit = (row) => {
    if (!head) { head = row.map((h) => h.trim()); ix = Object.fromEntries(head.map((h, k) => [h, k])); return; }
    if (row.length === 1 && row[0] === "") return;
    count++;
    onRow((col) => { const k = ix[col]; return k == null ? "" : String(row[k] ?? "").trim(); }, ix);
  };
  for await (const chunk of fs.createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 })) {
    buf += chunk;
    if (first) { if (buf.charCodeAt(0) === 0xfeff) buf = buf.slice(1); first = false; }
    let pos = 0;
    for (;;) { const r = parseRow(buf, pos, false); if (!r) break; emit(r.row); pos = r.next; }
    buf = buf.slice(pos);
  }
  let pos = 0;
  while (pos < buf.length) { const r = parseRow(buf, pos, true); emit(r.row); if (r.next <= pos) break; pos = r.next; }
  console.log(`  read ${name}: ${count.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return count;
}

// ---- values -------------------------------------------------------------------
const isoDay = (v) => {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) { const d = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; return d > "1901" ? d : ""; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m && m[0] > "1901" ? m[0] : "";
};
const num = (v) => { const n = Number(String(v || "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const truthy = (v) => /^(true|1|y|yes)$/i.test(String(v || "").trim());
const finishedSales = (status, isVoid) => ["FINISHED", "NOT POSTED"].includes(status.toUpperCase()) && !truthy(isVoid);
// [outName, sourceColumn, "d" for a date]. Only these columns leave the laptop.
function mapper(spec, prefix = "") {
  for (const [out] of spec) if (DENY.test(out)) throw new Error(`Refusing to copy column ${out}`);
  return (get) => {
    const o = {};
    for (const [out, src, kind] of spec) {
      let v = get(prefix + (src || out));
      if (v === "" && prefix && !src) v = get(out); // the line files also carry InvoiceCode unprefixed
      if (kind === "d") v = isoDay(v);
      if (v !== "") o[out] = v;
    }
    return o;
  };
}
const cols = (s) => s.split(/\s+/).filter(Boolean).map((c) => [c]);
const dates = (s, d) => s.map(([c]) => (d.includes(c) ? [c, c, "d"] : [c]));
const DATE_COLS = ["DateCreated", "InvStartDate", "InvFinishDate", "DateFinished", "DatePosted", "DateCommitted", "ServiceDate"];

const HEADER_SPEC = dates(cols("Code InvTypeCode Status JobStatusCode Department BranchCode DateCreated InvStartDate InvFinishDate DateFinished DatePosted Salesperson1Code Salesperson2Code Salesperson2Percentage SoldToCode BillToCode SoldToLastName SoldToFirstName BillToLastName BillToFirstName PaymentTypeCode Reference PONumber SerialTotal ItemTotal LaborTotal MiscTotal WtyTotal Tax1Total Tax2Total Tax3Total CommittedPaymentTotal OpenPaymentTotal COGSPosted UserCreated UserFinished"), DATE_COLS);
const SERIAL_SPEC = dates(cols("InvoiceCode ModelCode SerialCode UnitCost Returned Status ModelLineTimeStamp ModelDateStamp DateCommitted LocationCode"), DATE_COLS);
const ITEM_SPEC = cols("InvoiceCode ItemCode QtyOrdered QtyShipped SellingPrice UnitCost Total Warranty Status");
const LABOR_SPEC = cols("InvoiceCode LaborRateCode TechnicianCode Total Cost ActualCost StandardCost Warranty TripCharge TripChargeAmt");
const MISC_SPEC = cols("InvoiceCode LineTimeStamp MiscCode MiscDesc Qty SellingPrice UnitCost Total Warranty InvoiceModelCode InvoiceModelInvoiceCode InvoiceModelLineTimeStamp InvoiceModelDateStamp");
const MODEL_SPEC = cols("InvoiceCode LineTimeStamp DateStamp ModelCode ModelDesc QtyOrdered QtyShipped SellingPrice Total ListPriceCode CommissionCode Status NewUsed");
const WARRANTY_SPEC = cols("InvoiceCode ExtWarrantyCode Model SellingPrice UnitCost");
const CAT_SPEC = [["Code", "ServiceInvoice"], ...dates(cols("InvTypeCode Status JobStatusCode DateCreated DateFinished InvFinishDate Salesperson1Code SoldToCode BillToCode SoldToLastName SoldToFirstName SoldToAddress1 SoldToCity SoldToZipCode SoldToPhone1 SvcBrandCode SvcModel SvcSerial SvcProductCode SvcComplaintDesc SvcPerformedDesc SvcRepairCode ItemTotal LaborTotal MiscTotal WtyTotal"), DATE_COLS)];
const CAT_PART_SPEC = [["InvoiceCode", "ServiceInvoice"], ["ItemCode"], ["Description", "ItemDesc"], ["QtyOrdered"], ["QtyShipped"], ["SellingPrice"], ["UnitCost"], ["Total"], ["Warranty"], ["Status", "PartStatus"]];
const CAT_LABOR_SPEC = [["InvoiceCode", "ServiceInvoice"], ["LaborRateCode"], ["TechnicianCode"], ["ServiceDate", "ServiceDate", "d"], ["Rate"], ["Total"], ["Warranty"], ["Labor_Description", "LaborDescription"]];

// ---- writing --------------------------------------------------------------------
fs.mkdirSync(outDir, { recursive: true });
const written = [];
function writeBundle(name, meta, datasets) {
  const head = JSON.stringify({ pulledAt, source, machine, ...meta });
  const body = Object.entries(datasets).map(([k, arr]) => `${JSON.stringify(k)}:[${arr.join(",")}]`).join(",");
  const text = `${head.slice(0, -1)},"datasets":{${body}}}`;
  fs.writeFileSync(path.join(outDir, name), text);
  written.push({ name, bytes: Buffer.byteLength(text), rows: Object.fromEntries(Object.entries(datasets).map(([k, a]) => [k, a.length])) });
}
const pushTo = (map, key, ds, json) => { let b = map.get(key); if (!b) map.set(key, (b = {})); (b[ds] ||= []).push(json); };

console.log(`ePASS export: ${exportDir}`);
console.log(`Through ${cutoff} (finish date). Writing to ${outDir}`);

// ---- 1. sales headers (customers + orders both need them) ------------------------------
const headers = new Map(); // invoice -> { month, fin, invFin, dateFin, bill, sold }
const orderBuckets = new Map(); // "yyyy-mm" -> { dataset: [json] }
const salesPairs = new Map();
if (only.has("customers") || only.has("orders")) {
  const mapHeader = mapper(HEADER_SPEC, "Inv_");
  await readCsv("02A_Sales_Invoice_Master.csv", (get) => {
    const type = get("Inv_InvTypeCode").toUpperCase();
    if (!SALES_TYPES.has(type) || !finishedSales(get("Inv_Status"), get("Inv_Void"))) return;
    const invFin = isoDay(get("Inv_InvFinishDate")), dateFin = isoDay(get("Inv_DateFinished")), fin = invFin || dateFin;
    if (!fin || fin > cutoff) return;
    const code = get("Inv_Code").toUpperCase();
    if (!code || headers.has(code)) return;
    const bill = get("Inv_BillToCode"), sold = get("Inv_SoldToCode");
    headers.set(code, { month: fin.slice(0, 7), invFin, dateFin, bill, sold });
    if (only.has("orders")) pushTo(orderBuckets, fin.slice(0, 7), "finished-orders", JSON.stringify(mapHeader(get)));
    const k = `${bill}\u0001${sold}`;
    const t = salesPairs.get(k) || { BillTo: bill, SoldTo: sold, Invoices: 0, Revenue: 0, FirstInvFinish: "", FirstFinished: "", LastInvFinish: "", LastFinished: "" };
    t.Invoices++;
    t.Revenue += ["SerialTotal", "ItemTotal", "LaborTotal", "MiscTotal", "WtyTotal"].reduce((a, c) => a + num(get("Inv_" + c)), 0);
    if (invFin) { if (!t.FirstInvFinish || invFin < t.FirstInvFinish) t.FirstInvFinish = invFin; if (invFin > t.LastInvFinish) t.LastInvFinish = invFin; }
    if (dateFin) { if (!t.FirstFinished || dateFin < t.FirstFinished) t.FirstFinished = dateFin; if (dateFin > t.LastFinished) t.LastFinished = dateFin; }
    salesPairs.set(k, t);
  });
}

// ---- 2. model lines: orders' finished-models + model master, customers' brands ----------
const brandPairs = new Map();
const masterByMonth = new Map(); // month -> Map(model -> json)
if (only.has("customers") || only.has("orders")) {
  const mapModel = mapper(MODEL_SPEC, "Model_");
  await readCsv("03_Sales_Appliance_Lines.csv", (get) => {
    const inv = (get("InvoiceCode") || get("Model_InvoiceCode")).toUpperCase();
    const h = headers.get(inv);
    if (!h) return;
    const model = get("Model_ModelCode").toUpperCase(), brand = get("Master_BrandCode").toUpperCase();
    if (only.has("orders")) {
      pushTo(orderBuckets, h.month, "finished-models", JSON.stringify(mapModel(get)));
      const product = get("Master_ProductCode");
      if (model && (brand || product)) {
        let m = masterByMonth.get(h.month); if (!m) masterByMonth.set(h.month, (m = new Map()));
        if (!m.has(model)) {
          const o = { Code: model }; if (brand) o.BrandCode = brand; if (product) o.ProductCode = product;
          const d = get("Master_ModelDescription"); if (d) o.Description = d; const sku = get("Master_SKU"); if (sku) o.SKU = sku;
          m.set(model, JSON.stringify(o));
        }
      }
    }
    if (only.has("customers") && brand) {
      const k = `${h.bill}\u0001${h.sold}\u0001${brand}`;
      const b = brandPairs.get(k) || { BillTo: h.bill, SoldTo: h.sold, BrandCode: brand, Lines: 0, LastInvFinish: "", LastFinished: "" };
      b.Lines++;
      if (h.invFin > b.LastInvFinish) b.LastInvFinish = h.invFin;
      if (h.dateFin > b.LastFinished) b.LastFinished = h.dateFin;
      brandPairs.set(k, b);
    }
  });
}

// ---- 3. the other order lines -------------------------------------------------
if (only.has("orders")) {
  for (const [file, ds, spec, prefix] of [
    ["04_Sales_Serials.csv", "finished-serials", SERIAL_SPEC, "Serial_"],
    ["10_Sales_Misc_Install_Lines.csv", "finished-misc", MISC_SPEC, "Misc_"],
    ["11_Sales_Item_Lines.csv", "finished-items", ITEM_SPEC, "Item_"],
    ["12_Sales_Labor_Lines.csv", "finished-labor", LABOR_SPEC, "Labor_"],
    ["14_Sales_Warranty_Lines.csv", "finished-warranty", WARRANTY_SPEC, "Warranty_"]
  ]) {
    const map = mapper(spec, prefix);
    await readCsv(file, (get) => {
      const h = headers.get((get("InvoiceCode") || get(prefix + "InvoiceCode")).toUpperCase());
      if (h) pushTo(orderBuckets, h.month, ds, JSON.stringify(map(get)));
    });
  }
}

// ---- 4. service: lifetime service totals + the catalogue ------------------------------
const servicePairs = new Map();
const tickets = new Map(); // code -> year
const catBuckets = new Map(); // "yyyy" -> { dataset: [json] }
if (only.has("customers") || only.has("catalogue")) {
  const mapCat = mapper(CAT_SPEC);
  await readCsv("05_Service_History.csv", (get) => {
    const type = get("InvTypeCode").toUpperCase(), status = get("Status").toUpperCase(), isVoid = truthy(get("Void"));
    const code = get("ServiceInvoice").toUpperCase();
    if (!code || isVoid) return;
    const invFin = isoDay(get("InvFinishDate")), dateFin = isoDay(get("DateFinished"));
    // Customer-pay service, as the pull counts it: SV, finished or not posted.
    if (only.has("customers") && type === "SV" && ["FINISHED", "NOT POSTED"].includes(status) && (invFin || dateFin) && (invFin || dateFin) <= cutoff) {
      const bill = get("BillToCode"), sold = get("SoldToCode"), k = `${bill}\u0001${sold}`;
      const t = servicePairs.get(k) || { BillTo: bill, SoldTo: sold, Invoices: 0, Revenue: 0, FirstInvFinish: "", FirstFinished: "", LastInvFinish: "", LastFinished: "" };
      t.Invoices++;
      t.Revenue += ["ItemTotal", "LaborTotal", "MiscTotal", "WtyTotal"].reduce((a, c) => a + num(get(c)), 0);
      if (invFin) { if (!t.FirstInvFinish || invFin < t.FirstInvFinish) t.FirstInvFinish = invFin; if (invFin > t.LastInvFinish) t.LastInvFinish = invFin; }
      if (dateFin) { if (!t.FirstFinished || dateFin < t.FirstFinished) t.FirstFinished = dateFin; if (dateFin > t.LastFinished) t.LastFinished = dateFin; }
      servicePairs.set(k, t);
    }
    // The catalogue, as the pull slices it: SV / WTY, FINISHED.
    const fin = dateFin || invFin;
    if (only.has("catalogue") && (type === "SV" || type === "WTY") && status === "FINISHED" && fin && fin <= cutoff && !tickets.has(code)) {
      tickets.set(code, fin.slice(0, 4));
      pushTo(catBuckets, fin.slice(0, 4), "catalogue-history", JSON.stringify(mapCat(get)));
    }
  });
}
if (only.has("catalogue")) {
  for (const [file, ds, spec] of [["06_Service_Parts.csv", "catalogue-parts", CAT_PART_SPEC], ["07_Service_Labor.csv", "catalogue-labor", CAT_LABOR_SPEC]]) {
    const map = mapper(spec);
    await readCsv(file, (get) => { const y = tickets.get(get("ServiceInvoice").toUpperCase()); if (y) pushTo(catBuckets, y, ds, JSON.stringify(map(get))); });
  }
}

// ---- 5. write -------------------------------------------------------------------
const r2 = (n) => Math.round(n * 100) / 100;
if (only.has("customers")) {
  const pairs = (m) => [...m.values()].map((t) => JSON.stringify({ ...t, Revenue: r2(t.Revenue) }));
  writeBundle("epass-history-1-customers-totals.json", { history: "customers", part: "totals", asOf: cutoff }, { "customer-sales": pairs(salesPairs), "customer-service": pairs(servicePairs) });
  writeBundle("epass-history-1-customers-brands.json", { history: "customers", part: "brands", asOf: cutoff }, { "customer-brands": [...brandPairs.values()].map((b) => JSON.stringify(b)) });
}
if (only.has("catalogue")) {
  for (const y of [...catBuckets.keys()].sort()) {
    const b = catBuckets.get(y);
    writeBundle(`epass-history-2-catalogue-${y}.json`, { history: "service-catalogue", catalogueSince: `${y}-01-01`, catalogueUntil: `${y}-12-31` },
      { "catalogue-history": b["catalogue-history"] || [], "catalogue-parts": b["catalogue-parts"] || [], "catalogue-labor": b["catalogue-labor"] || [] });
  }
}
if (only.has("orders")) {
  for (const m of [...orderBuckets.keys()].sort()) {
    const b = orderBuckets.get(m);
    const next = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10);
    writeBundle(`epass-history-3-orders-${m}.json`, { history: "finished-orders", finishedSince: `${m}-01`, finishedUntil: next },
      { "finished-orders": b["finished-orders"] || [], "finished-serials": b["finished-serials"] || [], "finished-items": b["finished-items"] || [], "finished-labor": b["finished-labor"] || [],
        "finished-misc": b["finished-misc"] || [], "finished-models": b["finished-models"] || [], "finished-model-master": [...(masterByMonth.get(m)?.values() || [])], "finished-warranty": b["finished-warranty"] || [] });
  }
}

// ---- 6. summary (counts only - no customer data) ---------------------------------------
const total = written.reduce((a, w) => a + w.bytes, 0);
const biggest = written.reduce((a, w) => (w.bytes > a.bytes ? w : a), { bytes: 0, name: "" });
const lines = [
  `ePASS history bundles - ${pulledAt}`,
  `Export: ${path.basename(exportDir)}   through ${cutoff}`,
  `Files: ${written.length}   total ${(total / 1048576).toFixed(1)} MB   largest ${biggest.name} ${(biggest.bytes / 1048576).toFixed(1)} MB`,
  ""
];
if (only.has("customers")) lines.push(`Customers: ${salesPairs.size.toLocaleString()} sales pairs, ${servicePairs.size.toLocaleString()} service pairs, ${brandPairs.size.toLocaleString()} customer-brand pairs`);
if (only.has("catalogue")) lines.push(`Service catalogue: ${tickets.size.toLocaleString()} finished tickets in ${catBuckets.size} yearly files`);
if (only.has("orders")) lines.push(`Sales orders: ${headers.size.toLocaleString()} finished in ${orderBuckets.size} monthly files`);
lines.push("", ...written.map((w) => `${w.name}  ${(w.bytes / 1048576).toFixed(2)} MB  ${Object.entries(w.rows).map(([k, n]) => `${k} ${n}`).join(", ")}`));
fs.writeFileSync(path.join(path.dirname(outDir), "summary.txt"), lines.join("\n") + "\n");
console.log(lines.slice(0, 7).join("\n"));
if (biggest.bytes > 55 * 1048576) { console.error(`WARNING: ${biggest.name} is over 55 MB; Agility takes at most 60 MB per upload.`); process.exitCode = 2; }

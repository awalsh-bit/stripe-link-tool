import { read as readWorkbook, utils as xlsxUtils } from "xlsx";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// PURCHASING — Proposed Orders from the ePASS Written Models Report (OE-04)
// (written-models.html, Andrew 2026-09-18).
//
// The report is a printed layout dumped to .xls: every written (sold, not
// yet delivered) unit appears as a PAIR of rows under its model —
//   line A: Model#  Qty  Loc  PO#  STD  SP  Invoice#  Date  Cust#  Name  Branch  Status  Del.Date
//   line B: ReqDate  Reference  PONumber  SellPrice  BillTo  …  "paid / total / % / terms"
// followed by a "Total:" row per model (written qty, QOH, QOO / stock QOO,
// min, max, on-hand by location), a stock-class row (Non-Stock / Stock) and,
// when serials are already committed, a "Quantity Spoken For" sub-table.
// The very first line A of the report sits one cell LEFT of every other one
// (the qty is in column 1 instead of 2) and line B's cells wander too, so
// nothing is read by fixed column: line A is anchored on the invoice
// number, line B on its sell-price number.
//
// NetSuite's item export ("Agility Helper - NetSuite Items and Suppliers":
// Item Name, Brand, Display Name, Item Type, Primary Supplier) supplies the
// supplier for each model directly. Precedence: a per-model override set in
// the page → NetSuite's Primary Supplier → the brand → supplier map (for
// items with no supplier, e.g. Speed Queen) → the brand itself → Unassigned
// (HVAC, parts NetSuite doesn't carry). Proposed per model = written − QOH − QOO.
//
//   written_models_snapshot   the latest report, parsed (one row, id = 1)
//   netsuite_items            model → brand / display name / type / base price
//   written_models_settings   supplier map + per-model supplier overrides
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS written_models_snapshot (
  id INTEGER PRIMARY KEY,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '',
  report_date TEXT NOT NULL DEFAULT '',
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  models JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS netsuite_items (
  model_key TEXT PRIMARY KEY,
  model_number TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  item_type TEXT NOT NULL DEFAULT '',
  base_price NUMERIC(12,2),
  short_description TEXT NOT NULL DEFAULT '',
  finish TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE netsuite_items ADD COLUMN IF NOT EXISTS primary_supplier TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS netsuite_items_meta (
  id INTEGER PRIMARY KEY,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS written_models_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

export const normModel = (v) => String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");

// Brand → supplier defaults. Editable in the page (exec); unknown brands are
// their own supplier.
export const DEFAULT_SUPPLIER_MAP = {
  "Whirlpool": "Whirlpool", "Whirlpool Corporation": "Whirlpool", "Maytag": "Whirlpool", "KitchenAid": "Whirlpool", "JennAir": "Whirlpool", "Amana": "Whirlpool",
  "GE": "GE Appliances", "GE Profile": "GE Appliances", "Cafe": "GE Appliances", "Monogram": "GE Appliances", "Hotpoint": "GE Appliances", "Haier": "GE Appliances",
  "Wolf": "Sub-Zero Group", "Sub-Zero": "Sub-Zero Group", "Cove": "Sub-Zero Group",
  "LG": "LG", "LG Signature": "LG", "LG Studio": "LG",
  "Bosch": "BSH", "Thermador": "BSH", "Gaggenau": "BSH"
};

// ePASS supplier code → the NetSuite vendor name Andrew rewrote to be readable
// ("0013 Sub-Zero Group South Central"). The board shows NetSuite's names
// everywhere; ePASS codes only appear as a hint. Seeded for the obvious ones
// (2026-09-21, from the PO probe's supplier list); learned from models that
// exist on both sides; overridden in Settings → epassSupplierMap. Keys are
// upper-cased ePASS Supplier.Code values.
export const DEFAULT_EPASS_SUPPLIER_MAP = {
  "ALMO": "0015 Almo Corporation",
  "BSH": "0011 BSH Home Appliances",
  "GEC": "0024 GE Appliances",
  "LGEUS": "0022 LG Electronics USA",
  "MIELE": "0025 Miele, Inc.",
  "MILESTONE": "0014 Milestone Distribution",
  "TRUE": "0023 True Manufacturing",
  "WESTYE": "0013 Sub-Zero Group South Central",
  "WOLF": "0013 Sub-Zero Group South Central",
  "WP001": "0012 Whirlpool Corporation"
};

// ---------------------------------------------------------------------------
// Report parser
// ---------------------------------------------------------------------------
const INVOICE_RE = /^[A-Z]{1,2}\d{8}(-\d+)?$/;    // S00062812, R00015695, AC00010563, S00064380-1 (split)
const DEPOSIT_RE = /^\$[\d,.\-]+\s*\/\s*\$[\d,.\-]+\s*\/\s*-?\d+%\s*\/\s*\S+/;
const STOCK_CLASSES = new Set(["Non-Stock", "Stock", "Special", "Special Order", "Discontinued", "Display"]);

const text = (v, max = 160) => String(v == null ? "" : v).trim().slice(0, max);
const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };
export function serialToIso(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v)) { const d = new Date(Math.round((v - 25569) * 864e5)); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/); if (m) { const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); }
  return "";
}

function parseDeposit(s) {
  const m = String(s || "").match(/^\$([\d,.\-]+)\s*\/\s*\$([\d,.\-]+)\s*\/\s*(-?\d+)%\s*\/\s*(\S+)/);
  if (!m) return null;
  return { paid: num(m[1]), total: num(m[2]), pct: Number(m[3]), terms: m[4] };
}

function isModelCell(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s || STOCK_CLASSES.has(s)) return false;
  if (/^(Model #|Req Date|Brand:|Job Status|Payment Type|Invoice Type|Supplier From|Bill To From|Report Date|Written Models|WILSON)/i.test(s)) return false;
  return /^[A-Z0-9][A-Z0-9 .\-\/]{2,}$/i.test(s);
}

export function parseWrittenModelsWorkbook(buffer) {
  const wb = readWorkbook(buffer, { type: "buffer", raw: true, cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("The workbook has no sheets.");
  const grid = xlsxUtils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  const lines = [], models = [], warnings = [];
  const byModel = new Map();
  let reportDate = "", startDate = "", endDate = "";
  let current = null;       // model record being filled
  let lastLine = null;      // most recent line A awaiting its line B
  let spokenHeader = false; // inside a "Quantity Spoken For" sub-table
  const lineSeq = new Map();

  const modelRec = (model) => {
    const key = normModel(model);
    if (!byModel.has(key)) { const rec = { model: text(model, 40), key, stockClass: "", written: 0, qoh: null, qoo: null, stockQoo: null, min: null, max: null, locations: "", spokenFor: [] }; byModel.set(key, rec); models.push(rec); }
    return byModel.get(key);
  };

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    const c0 = text(row[0]);
    const strs = row.map((c) => (c == null ? "" : String(c).trim()));

    // report header bits worth keeping
    if (c0 === "Report Date:") { reportDate = serialToIso(row[2]) || text(row[2]); continue; }
    if (strs.includes("Starting Date:")) { const i = strs.indexOf("Starting Date:"); startDate = serialToIso(row[i + 1]) || text(row[i + 1]); }
    if (strs.includes("Ending Date:")) { const i = strs.indexOf("Ending Date:"); endDate = serialToIso(row[i + 1]) || text(row[i + 1]); continue; }
    if (/^Model #/.test(c0) || /^Req Date/.test(c0) || strs.includes("Page:")) { spokenHeader = false; continue; }

    // Totals row: "<model> … Total: n QOH: n … 'x / y' Min: n Max: n <locations>"
    const ti = strs.indexOf("Total:");
    if (ti >= 0 && isModelCell(c0)) {
      const rec = modelRec(c0);
      rec.written = num(row[ti + 1]) ?? rec.written;
      const qi = strs.indexOf("QOH:"); if (qi >= 0) rec.qoh = num(row[qi + 1]);
      const qooCell = strs.find((s) => /^\d+\s*\/\s*\d+$/.test(s)); if (qooCell) { const [a, b] = qooCell.split("/").map((x) => Number(x.trim())); rec.qoo = a; rec.stockQoo = b; }
      const mi = strs.indexOf("Min:"); if (mi >= 0) rec.min = num(row[mi + 1]);
      const xi = strs.indexOf("Max:"); if (xi >= 0) rec.max = num(row[xi + 1]) ?? num(row[xi + 2]);
      const loc = strs.find((s) => /^[A-Za-z0-9]+=\d+/.test(s)); if (loc) rec.locations = loc;
      current = rec; lastLine = null; spokenHeader = false;
      continue;
    }

    // Stock-class row (+ optional "Quantity Spoken For:" count)
    if (STOCK_CLASSES.has(c0)) {
      if (current) current.stockClass = c0;
      spokenHeader = strs.includes("Quantity Spoken For:");
      continue;
    }
    if (spokenHeader && c0 !== "") spokenHeader = false; // a model / written line ends the sub-table
    if (spokenHeader) {
      if (strs.includes("Invoice") && strs.includes("Delivery Date")) continue; // sub-table header
      const ii = row.findIndex((c) => INVOICE_RE.test(String(c ?? "").trim()));
      if (ii >= 0 && current) {
        const after = row.slice(ii + 1);
        const qtyIdx = after.findIndex((c) => typeof c === "number");
        current.spokenFor.push({ invoice: text(row[ii], 20), customer: text(after.slice(0, qtyIdx).filter((c) => c != null)[0] || "", 80), qty: num(after[qtyIdx]) ?? 1, status: text(after[qtyIdx + 1], 20), deliveryDate: serialToIso(after[qtyIdx + 2]), daysInInventory: num(after[qtyIdx + 3]) });
        continue;
      }
      spokenHeader = false;
    }

    // Line A: anchored on the invoice number (never before column 4, so a
    // model number that happens to look like one — PL342212 — is skipped).
    let inv = -1;
    for (let i = 4; i < row.length; i++) if (INVOICE_RE.test(String(row[i] ?? "").trim())) { inv = i; break; }
    if (inv >= 0 && typeof row[inv - 2] === "number") {
      const model = isModelCell(c0) ? c0 : (lastLine?.model || current?.model || "");
      if (!model) { warnings.push(`Row ${r + 1}: written line without a model.`); continue; }
      const rec = modelRec(model);
      const between = row.slice(1, inv - 2);
      const qtyIdx = between.findIndex((c) => c != null && String(c).trim() !== "" && Number.isFinite(Number(c)));
      const qty = qtyIdx >= 0 ? Number(between[qtyIdx]) : 1;
      const extras = between.slice(qtyIdx + 1).map((c) => text(c, 30)).filter(Boolean);
      const line = {
        model: rec.model, key: rec.key, qty, loc: extras[0] || "", po: extras[1] || "",
        stdCost: num(row[inv - 2]), sp: text(row[inv - 1], 10), invoice: text(row[inv], 20), invoiceDate: serialToIso(row[inv + 1]),
        customerNumber: text(row[inv + 2], 30), customerName: text(row[inv + 3], 80), branch: text(row[inv + 4], 30), status: text(row[inv + 5], 20), delDate: serialToIso(row[inv + 6]),
        reference: "", sellPrice: null, billTo: "", deposit: null
      };
      // Stable id so a line ticked off as ordered / pulled from stock stays
      // ticked when the next report is uploaded: model | invoice | qty | nth
      // occurrence of that trio (a sale and its return share invoice + model).
      const trio = `${rec.key}|${line.invoice}|${line.qty}`;
      lineSeq.set(trio, (lineSeq.get(trio) || 0) + 1);
      line.id = `${trio}|${lineSeq.get(trio)}`;
      lines.push(line); lastLine = line; current = rec;
      continue;
    }

    // Line B: sell price is its first number; bill-to follows; deposit string anywhere.
    if (lastLine && c0 === "" && !isModelCell(c0)) {
      const pi = row.findIndex((c) => typeof c === "number");
      const di = strs.findIndex((s) => DEPOSIT_RE.test(s));
      if (pi >= 0 || di >= 0) {
        if (pi >= 0) {
          lastLine.sellPrice = row[pi];
          lastLine.billTo = text(row[pi + 1], 100);
          lastLine.reference = strs.slice(0, pi).filter(Boolean).join(" ").slice(0, 60);
        }
        if (di >= 0) lastLine.deposit = parseDeposit(strs[di]);
        lastLine = null;
        continue;
      }
    }
  }

  if (!lines.length) { const err = new Error("No written lines found — is this the ePASS Written Models Report (OE-04) export?"); err.code = "NOT_WRITTEN_MODELS"; throw err; }
  for (const m of models) if (!m.written) m.written = lines.filter((l) => l.key === m.key).reduce((a, l) => a + (l.qty || 0), 0);
  return { reportDate, startDate, endDate, lines, models, warnings };
}

// ---------------------------------------------------------------------------
// The same snapshot built from the ePASS ODBC feed (2026-09-19) — no OE-04
// export. Input is the "epass-open-orders" bundle epass-odbc-pull.ps1 writes:
// open sales invoices, their InvoiceModel lines, InvoiceSerial rows and the
// Model master (QOH/QOO/min/max/supplier). A written line is an open line
// with units still to ship (QtyOrdered − QtyShipped ≠ 0; returns come out
// negative, as on the report). Serials sitting in stock against an open
// invoice are the "Quantity Spoken For". Line ids follow the same
// model|invoice|qty|seq rule so handled marks survive the source change.
// ---------------------------------------------------------------------------
export function parseWrittenModelsFromEpass(bundle) {
  const get = (row, ...names) => { for (const n of names) { const k = Object.keys(row || {}).find((x) => x.toLowerCase() === n.toLowerCase()); if (k != null && row[k] != null && row[k] !== "") return row[k]; } return null; };
  const str = (row, ...names) => text(get(row, ...names) ?? "", 160);
  const dateOf = (v) => serialToIso(v);
  const ds = (name) => (Array.isArray(bundle?.datasets?.[name]) ? bundle.datasets[name] : []).filter((r) => r && typeof r === "object");
  const invoices = new Map(ds("open-orders").map((r) => [str(r, "Code").toUpperCase(), r]));
  const modelMaster = new Map(ds("open-order-models").map((r) => [normModel(str(r, "Code")), r]));
  const lines = [], models = [], warnings = [];
  const byModel = new Map();
  const lineSeq = new Map();
  const skipped = { ordered: 0, d1: 0 };
  const bool = (v) => v === true || String(v).toLowerCase() === "true" || v === 1 || v === "1";

  const modelRec = (model) => {
    const key = normModel(model);
    if (!byModel.has(key)) {
      const m = modelMaster.get(key);
      const qohMain = num(get(m, "MainStockQOH")), qohLoc = num(get(m, "LocQOH"));
      const inv = str(m, "InventoryTypeCode");
      const stockClass = STOCK_CLASSES.has(inv) ? inv : bool(get(m, "Stock")) ? "Stock" : inv || "Non-Stock";
      const rec = {
        model: text(model, 40), key, stockClass, written: 0,
        qoh: qohMain == null && qohLoc == null ? null : (qohMain || 0) + (qohLoc || 0), qohMain, qohLoc,
        qoo: num(get(m, "TotalQOO")), stockQoo: null, min: num(get(m, "TotalMin")), max: num(get(m, "TotalMax")), locations: "",
        reserved: num(get(m, "TotalReserved")), booked: num(get(m, "TotalBooked")),
        brand: str(m, "BrandCode"), productCode: str(m, "ProductCode"), description: str(m, "Description"), sku: str(m, "SKU"),
        supplierCode: str(m, "SupplierCode"), supplierName: str(m, "Supplier_Description"),
        stdCost: num(get(m, "StandardCost")), lastCost: num(get(m, "LastCost")), lastReceived: dateOf(get(m, "LastDateReceived")), lastOrdered: dateOf(get(m, "LastDateOrdered")),
        obsolete: bool(get(m, "Obsolete")), discontinued: bool(get(m, "BeingDiscontinued")),
        spokenFor: []
      };
      byModel.set(key, rec); models.push(rec);
    }
    return byModel.get(key);
  };

  // Units already in the building for a specific ticket (Serial master,
  // Status blank, OrderedForInvoiceCode set — the "Ordered for Inv" box on the
  // Serial Detail screen). A written line those units cover needs nothing
  // ordered.
  const onHandRows = ds("on-hand-serials");
  const promised = new Map();
  for (const r of onHandRows) {
    const forCode = (str(r, "OrderedForInvoiceCode") || str(r, "InvoiceCode")).toUpperCase();
    if (!forCode || !invoices.has(forCode)) continue;
    const k = `${normModel(str(r, "ModelCode"))}|${forCode}`;
    promised.set(k, (promised.get(k) || 0) + 1);
  }
  skipped.onHand = 0;

  // Every open line is kept — with its PO, its job status and the units on
  // hand for it — and flagged; the Ordering Report filters on the flags, the
  // inventory position shows the lot. (Andrew, 9/21: "the PO should remain
  // showing in the order line detail even if it is serial reserved".)
  //   ordered   line carries a POCode — already bought (the OE-04 rule,
  //             derived by matching the 9/18 report to this feed)
  //   d1        invoice is D1 "Waiting to Order" — not released yet
  //   covered   units on hand promised to this invoice for this model
  //   needed    what still has to be ordered: qty − covered, 0 when ordered / d1
  const openLines = ds("open-order-lines");
  // A unit that arrived on a PO belongs to the line carrying that PO first;
  // only what's left can cover a second, PO-less line of the same model on
  // the same ticket — so PO lines claim their units in a first pass.
  const coveredBy = new Map();
  const claim = (r, poFirst) => {
    if (!!str(r, "POCode") !== poFirst) return;
    const qty = (num(get(r, "QtyOrdered")) || 0) - (num(get(r, "QtyShipped")) || 0);
    if (qty <= 0) return;
    const pk = `${normModel(str(r, "ModelCode"))}|${str(r, "InvoiceCode").toUpperCase()}`;
    const have = promised.get(pk) || 0;
    if (have > 0) { const use = Math.min(have, qty); promised.set(pk, have - use); coveredBy.set(r, use); }
  };
  for (const r of openLines) claim(r, true);
  for (const r of openLines) claim(r, false);

  for (const r of openLines) {
    const model = str(r, "ModelCode");
    const invCode = str(r, "InvoiceCode").toUpperCase();
    if (!model || !invCode) continue;
    const inv = invoices.get(invCode);
    if (!inv) { warnings.push(`${invCode}: line without an open invoice header.`); continue; }
    const ordered = num(get(r, "QtyOrdered")) || 0, shipped = num(get(r, "QtyShipped")) || 0;
    const qty = ordered - shipped;
    if (!qty) continue; // delivered in full — nothing left to order
    const po = str(r, "POCode");
    const d1 = str(inv, "JobStatusCode").toUpperCase() === "D1";
    const covered = coveredBy.get(r) || 0;
    const needed = po || d1 ? 0 : Math.max(0, qty - covered);
    if (po) skipped.ordered++; else if (d1) skipped.d1++; else if (qty > 0 && !needed) skipped.onHand++;
    const rec = modelRec(model);
    const total = ["SerialTotal", "ItemTotal", "LaborTotal", "MiscTotal", "WtyTotal", "Tax1Total", "Tax2Total", "Tax3Total"].reduce((a, c) => a + (num(get(inv, c)) || 0), 0);
    const paid = (num(get(inv, "CommittedPaymentTotal")) || 0) + (num(get(inv, "OpenPaymentTotal")) || 0);
    const terms = str(inv, "PaymentTypeCode");
    const line = {
      model: rec.model, key: rec.key, qty, needed, ordered: !!po, d1, covered, loc: str(r, "LocationCode"), po, poDate: dateOf(get(r, "PODateStamp")),
      stdCost: num(get(r, "StandardCost")) ?? rec.stdCost, sp: str(inv, "Salesperson1Code"), invoice: text(invCode, 20), invoiceDate: dateOf(get(inv, "DateCreated")),
      customerNumber: str(inv, "SoldToCode"), customerName: [str(inv, "SoldToFirstName"), str(inv, "SoldToLastName")].filter(Boolean).join(" ").slice(0, 80),
      branch: str(inv, "BranchCode"), status: str(inv, "JobStatusCode"), delDate: dateOf(get(inv, "ScheduleDate")),
      reference: str(inv, "Reference").slice(0, 60), sellPrice: num(get(r, "SellingPrice")), billTo: [str(inv, "BillToFirstName"), str(inv, "BillToLastName")].filter(Boolean).join(" ").slice(0, 100),
      // Only a real deposit becomes the "x% paid" note; ePASS keeps most
      // payments elsewhere, so a zero here must not read as unpaid COD.
      deposit: paid > 0 && total > 0 ? { paid, total: Math.round(total * 100) / 100, pct: Math.round((paid / total) * 100), terms } : null,
      terms, takenStatus: str(r, "TakenStatus"), invType: str(inv, "InvTypeCode"), invStatus: str(inv, "Status"), color: str(r, "Color"), stock: bool(get(r, "ModelStock")),
      lineTimeStamp: str(r, "LineTimeStamp")
    };
    lines.push(line);
  }
  // Ids (model|invoice|qty|seq) are numbered over the lines that need
  // ordering first, so handled marks made before the PO / D1 / on-hand lines
  // were kept in the snapshot still land on the same line.
  for (const line of [...lines.filter((l) => l.needed || l.qty < 0), ...lines.filter((l) => !(l.needed || l.qty < 0))]) {
    const trio = `${line.key}|${line.invoice}|${line.qty}`;
    lineSeq.set(trio, (lineSeq.get(trio) || 0) + 1);
    line.id = `${trio}|${lineSeq.get(trio)}`;
  }

  const reportDate = dateOf(bundle?.pulledAt) || new Date().toISOString().slice(0, 10);
  const reportMs = new Date(reportDate + "T00:00:00Z").getTime();
  const ageDays = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? Math.max(0, Math.round((reportMs - new Date(iso + "T00:00:00Z").getTime()) / 86400000)) : null);
  const customerOf = (inv) => (inv ? [str(inv, "SoldToFirstName"), str(inv, "SoldToLastName")].filter(Boolean).join(" ").slice(0, 80) : "");

  // Units in stock (Serial master, Status blank) for the models on the report:
  // every one becomes a row on the inventory position, and the ones promised
  // to an open invoice (OrderedForInvoiceCode / InvoiceCode — the OE-04's
  // "Quantity Spoken For", checked 2026-09-21: all 244 of the 9/18 report's
  // spoken-for rows were lines whose PO had arrived) come off the free count.
  // InvoiceSerial only ever holds taken units, so it is no longer read here.
  for (const r of onHandRows) {
    const rec = byModel.get(normModel(str(r, "ModelCode")));
    if (!rec) continue;
    const forCode = (str(r, "OrderedForInvoiceCode") || str(r, "InvoiceCode")).toUpperCase();
    const inv = forCode ? invoices.get(forCode) : null;
    const received = dateOf(get(r, "DateReceived"));
    const unit = {
      serial: str(r, "Code"), received, ageDays: ageDays(received), cost: num(get(r, "Cost")) ?? 0, serialType: str(r, "SerialTypeCode"),
      location: str(r, "LocationCode"), bin: str(r, "BinLocationCode"), po: str(r, "POCode"),
      writtenTo: inv ? text(forCode, 20) : "", customer: customerOf(inv), scheduleDate: inv ? dateOf(get(inv, "ScheduleDate")) : "", status: inv ? str(inv, "JobStatusCode") : "",
      reserved: dateOf(get(r, "DateReserved")), exclusive: bool(get(r, "ReserveExclusive"))
    };
    (rec.units ||= []).push(unit);
    if (inv) rec.spokenFor.push({ invoice: unit.writtenTo, serial: unit.serial, customer: unit.customer, qty: 1, status: unit.status, deliveryDate: unit.scheduleDate, daysInInventory: unit.ageDays, location: unit.location });
  }

  // Purchase-order lines not yet received for those models: the ones cut for
  // an invoice (BackOrderInvoiceCode) are spoken for before they land; the
  // rest is stock on order that can cover new written lines.
  for (const r of ds("open-po-lines")) {
    const rec = byModel.get(normModel(str(r, "ModelCode")));
    if (!rec) continue;
    const ordered = num(get(r, "QtyOrdered")) || 0, received = num(get(r, "QtyReceived")) || 0;
    const qty = Math.max(0, ordered - received);
    if (!qty) continue;
    const forCode = str(r, "BackOrderInvoiceCode").toUpperCase();
    const inv = forCode ? invoices.get(forCode) : null;
    (rec.onOrder ||= []).push({
      po: str(r, "POCode"), qty, supplier: str(r, "SupplierDescription") || str(r, "SupplierCode"),
      eta: dateOf(get(r, "ETADateMostUpdated")) || dateOf(get(r, "ETADate")) || dateOf(get(r, "RequestedDeliveryDate")) || dateOf(get(r, "PO_RequestedDeliveryDate")),
      etaConfirmed: bool(get(r, "RSDConfirmed")), ordered: dateOf(get(r, "PO_DateOrdered")) || dateOf(get(r, "DateStamp")), confirmed: str(r, "PO_Confirmed"),
      forInvoice: forCode ? text(forCode, 20) : "", customer: customerOf(inv), released: !bool(get(r, "Unreleased")) && !bool(get(r, "PO_Unreleased"))
    });
  }

  for (const m of models) {
    const mine = lines.filter((l) => l.key === m.key);
    m.written = mine.reduce((a, l) => a + (l.qty || 0), 0); // ePASS WRI: every open unit, ordered or not
    m.needed = mine.reduce((a, l) => a + (l.needed || 0), 0); // what the report has to buy
    const spoken = m.spokenFor.reduce((a, s) => a + (s.qty || 0), 0);
    if (m.units) { if (m.qoh == null) m.qoh = m.units.length; m.freeQoh = Math.max(0, m.units.length - spoken); } // counted from the units themselves
    else if (m.qoh != null) m.freeQoh = Math.max(0, m.qoh - spoken);
    if (m.onOrder) {
      m.stockQoo = m.onOrder.filter((o) => !o.forInvoice).reduce((a, o) => a + o.qty, 0);
      m.specialQoo = m.onOrder.filter((o) => o.forInvoice).reduce((a, o) => a + o.qty, 0);
      if (m.qoo == null) m.qoo = m.stockQoo + m.specialQoo;
    }
  }
  if (onHandRows.length) skipped.onHandUnits = onHandRows.length;
  if (!lines.length) warnings.push("The ePASS feed had no open sales lines with units left to ship.");
  return { reportDate, startDate: "", endDate: "", lines, models, warnings, source: "epass-odbc", skipped };
}

// ---------------------------------------------------------------------------
// NetSuite items CSV
// ---------------------------------------------------------------------------
export function parseNetsuiteItemsCsv(buffer) {
  const wb = readWorkbook(buffer, { type: "buffer", raw: false });
  const rows = xlsxUtils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const pick = (r, ...names) => { for (const n of names) { const k = Object.keys(r).find((h) => h.trim().toLowerCase() === n); if (k != null && r[k] !== "") return r[k]; } return ""; };
  const items = [];
  for (const r of rows) {
    const modelNumber = text(pick(r, "item name", "model number", "model", "name"), 60);
    const displayName = text(pick(r, "display name", "displayname"), 80);
    const key = normModel(modelNumber || displayName);
    if (!key) continue;
    items.push({ key, modelNumber, displayName, brand: text(pick(r, "brand"), 60), type: text(pick(r, "item type", "type"), 40), basePrice: num(pick(r, "base price", "price")), shortDescription: text(pick(r, "short description", "description"), 160), finish: text(pick(r, "primary finish (color)", "finish", "color"), 40), primarySupplier: text(pick(r, "primary supplier", "supplier", "preferred vendor", "vendor"), 80) });
  }
  if (!items.length) throw new Error("No items found — the CSV needs at least an Item Name (or Model Number) column.");
  items.withSupplier = items.filter((i) => i.primarySupplier).length;
  return items;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export async function saveWrittenModelsSnapshot(parsed, { by = "", sourceFile = "" } = {}) {
  const pool = await getReadyPool();
  // Handled marks for lines that left the report are dropped — they've been
  // delivered or cancelled in ePASS, so there's nothing left to tick.
  try {
    const cur = (await pool.query(`SELECT value FROM written_models_settings WHERE key = 'handled_lines'`)).rows[0]?.value || {};
    const keep = new Set(parsed.lines.map((l) => l.id));
    const pruned = Object.fromEntries(Object.entries(cur).filter(([id]) => keep.has(id)));
    await pool.query(`INSERT INTO written_models_settings (key, value, updated_at) VALUES ('handled_lines', $1::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(pruned)]);
  } catch {}
  await pool.query(
    `INSERT INTO written_models_snapshot (id, uploaded_at, uploaded_by, source_file, report_date, lines, models, warnings)
     VALUES (1, NOW(), $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
     ON CONFLICT (id) DO UPDATE SET uploaded_at = NOW(), uploaded_by = EXCLUDED.uploaded_by, source_file = EXCLUDED.source_file, report_date = EXCLUDED.report_date, lines = EXCLUDED.lines, models = EXCLUDED.models, warnings = EXCLUDED.warnings`,
    [String(by).slice(0, 200), String(sourceFile).slice(0, 200), String(parsed.reportDate || ""), JSON.stringify(parsed.lines), JSON.stringify(parsed.models), JSON.stringify(parsed.warnings || [])]
  );
  return { lines: parsed.lines.length, models: parsed.models.length, warnings: (parsed.warnings || []).length };
}

export async function replaceNetsuiteItems(items, { by = "", sourceFile = "" } = {}) {
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM netsuite_items`);
    const seen = new Set();
    for (const it of items) {
      if (seen.has(it.key)) continue; seen.add(it.key);
      const vals = [it.key, it.modelNumber, it.displayName, it.brand, it.type, it.basePrice, it.shortDescription, it.finish, it.primarySupplier || ""];
      await client.query(`INSERT INTO netsuite_items (model_key, model_number, display_name, brand, item_type, base_price, short_description, finish, primary_supplier, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`, vals);
      // display names sometimes differ from the item name (suffixes) — index those too
      const dk = normModel(it.displayName);
      if (dk && dk !== it.key && !seen.has(dk)) { seen.add(dk); vals[0] = dk; await client.query(`INSERT INTO netsuite_items (model_key, model_number, display_name, brand, item_type, base_price, short_description, finish, primary_supplier, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (model_key) DO NOTHING`, vals); }
    }
    await client.query(`INSERT INTO netsuite_items_meta (id, uploaded_at, uploaded_by, source_file, item_count) VALUES (1, NOW(), $1, $2, $3) ON CONFLICT (id) DO UPDATE SET uploaded_at = NOW(), uploaded_by = EXCLUDED.uploaded_by, source_file = EXCLUDED.source_file, item_count = EXCLUDED.item_count`, [String(by).slice(0, 200), String(sourceFile).slice(0, 200), seen.size]);
    await client.query("COMMIT");
    return { items: seen.size, withSupplier: items.filter((i) => i.primarySupplier).length };
  } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
}

export async function getWrittenModelsSettings() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT key, value FROM written_models_settings`);
  const out = { supplierMap: { ...DEFAULT_SUPPLIER_MAP }, modelSupplier: {}, epassSupplierMap: {}, handledLines: {} };
  for (const row of r.rows) {
    if (row.key === "supplier_map" && row.value && typeof row.value === "object") out.supplierMap = { ...DEFAULT_SUPPLIER_MAP, ...row.value };
    if (row.key === "model_supplier" && row.value && typeof row.value === "object") out.modelSupplier = row.value;
    if (row.key === "epass_supplier_map" && row.value && typeof row.value === "object") out.epassSupplierMap = row.value;
    if (row.key === "handled_lines" && row.value && typeof row.value === "object") out.handledLines = row.value;
  }
  return out;
}
export async function setWrittenModelsSetting(key, value) {
  if (!["supplier_map", "model_supplier", "epass_supplier_map"].includes(key)) throw new Error(`Unknown setting ${key}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} must be an object of names.`);
  const clean = {};
  for (const [k, v] of Object.entries(value)) { const kk = String(k).trim().slice(0, 80); const vv = String(v ?? "").trim().slice(0, 80); if (kk) clean[key === "model_supplier" ? normModel(kk) : key === "epass_supplier_map" ? kk.toUpperCase() : kk] = vv; }
  const pool = await getReadyPool();
  await pool.query(`INSERT INTO written_models_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(clean)]);
  return clean;
}

// Tick a written line off the report (ordered, or assigned from stock) — or
// put it back. Shared by everyone who works the report.
export async function setWrittenLineHandled(lineId, handled, by = "") {
  const id = String(lineId || "").slice(0, 120);
  if (!id) throw new Error("Line id is required.");
  const pool = await getReadyPool();
  const cur = (await pool.query(`SELECT value FROM written_models_settings WHERE key = 'handled_lines'`)).rows[0]?.value || {};
  const next = { ...cur };
  if (handled) next[id] = { at: new Date().toISOString(), by: String(by || "").slice(0, 120) }; else delete next[id];
  await pool.query(`INSERT INTO written_models_settings (key, value, updated_at) VALUES ('handled_lines', $1::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(next)]);
  return { id, handled: !!next[id], mark: next[id] || null, count: Object.keys(next).length };
}

// Reports uploaded before lines carried ids (2026-09-18) get the same stable
// id derived on read, so the red ✕ works without a re-upload.
export function ensureLineIds(lines) {
  const seq = new Map();
  return lines.map((l) => {
    if (l.id) return l;
    const trio = `${l.key}|${l.invoice}|${l.qty}`;
    seq.set(trio, (seq.get(trio) || 0) + 1);
    return { ...l, id: `${trio}|${seq.get(trio)}` };
  });
}

// ---------------------------------------------------------------------------
// Board: every written line with its item, supplier and margin, grouped by
// supplier; models with their proposed order quantity.
// ---------------------------------------------------------------------------
export function marginRate(sell, cost) {
  if (sell == null || cost == null || !(sell > 0)) return null;
  return Math.round(((sell - cost) / sell) * 10000) / 10000;
}

const dateOnlyUtc = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : "");
function endOfMonthPlus(iso, n) {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n + 1, 0); // day 0 of the following month = last day
  return d.toISOString().slice(0, 10);
}
export async function buildWrittenModelsBoard({ month = "", through = "" } = {}) {
  const pool = await getReadyPool();
  const [snap, itemsMeta, settings] = await Promise.all([
    pool.query(`SELECT * FROM written_models_snapshot WHERE id = 1`),
    pool.query(`SELECT * FROM netsuite_items_meta WHERE id = 1`),
    getWrittenModelsSettings()
  ]);
  const s = snap.rows[0];
  const sources = {
    report: s ? { uploadedAt: s.uploaded_at?.toISOString?.() || null, uploadedBy: s.uploaded_by, sourceFile: s.source_file, reportDate: s.report_date } : null,
    items: itemsMeta.rows[0] ? { uploadedAt: itemsMeta.rows[0].uploaded_at?.toISOString?.() || null, uploadedBy: itemsMeta.rows[0].uploaded_by, sourceFile: itemsMeta.rows[0].source_file, count: Number(itemsMeta.rows[0].item_count) } : null
  };
  if (!s) return { sources, settings, months: [], month: "", suppliers: [], totals: { lines: 0, units: 0, proposedUnits: 0, sell: 0, cost: 0, margin: null }, warnings: [] };

  const lines = ensureLineIds(Array.isArray(s.lines) ? s.lines : []);
  const models = Array.isArray(s.models) ? s.models : [];
  const keys = [...new Set(models.map((m) => m.key))];
  const [items, supplierRows, brandRows] = await Promise.all([
    keys.length ? pool.query(`SELECT * FROM netsuite_items WHERE model_key = ANY($1)`, [keys]).then((r) => r.rows) : [],
    pool.query(`SELECT DISTINCT primary_supplier FROM netsuite_items WHERE primary_supplier <> '' ORDER BY 1`).then((r) => r.rows.map((x) => x.primary_supplier)).catch(() => []),
    // Which NetSuite vendor each brand usually buys from — so a model NetSuite
    // doesn't carry still lands in a NetSuite-named group, never a made-up one.
    pool.query(`SELECT brand, primary_supplier, COUNT(*)::int AS n FROM netsuite_items WHERE brand <> '' AND primary_supplier <> '' GROUP BY 1, 2`).then((r) => r.rows).catch(() => [])
  ]);
  const itemByKey = new Map(items.map((i) => [i.model_key, i]));
  const brandToNs = new Map();
  for (const r of brandRows) { const cur = brandToNs.get(r.brand); if (!cur || r.n > cur.n) brandToNs.set(r.brand, { supplier: r.primary_supplier, n: r.n }); }

  // ePASS supplier → NetSuite vendor. Precedence: Settings → learned (the
  // NetSuite vendor most of this ePASS supplier's models carry) → seeded map.
  // Names on the board are always NetSuite's; ePASS's own name is a hint.
  const learnedPairs = new Map();
  for (const rec of models) {
    const code = String(rec.supplierCode || "").trim().toUpperCase();
    const item = itemByKey.get(rec.key);
    if (!code || !item?.primary_supplier) continue;
    if (!learnedPairs.has(code)) learnedPairs.set(code, new Map());
    const c = learnedPairs.get(code); c.set(item.primary_supplier, (c.get(item.primary_supplier) || 0) + 1);
  }
  const epassMap = new Map();
  const epassCodes = new Map(); // code → { name, models }
  for (const rec of models) {
    const code = String(rec.supplierCode || "").trim().toUpperCase();
    if (!code) continue;
    if (!epassCodes.has(code)) epassCodes.set(code, { code, name: rec.supplierName || "", models: 0 });
    epassCodes.get(code).models++;
  }
  for (const code of epassCodes.keys()) {
    const manual = settings.epassSupplierMap?.[code];
    if (manual) { epassMap.set(code, { supplier: manual, source: "settings" }); continue; }
    const learned = learnedPairs.get(code);
    if (learned) {
      // Trust the learned pairing only when it is clear-cut: at least three
      // models and 70 % of them agree. Anything murkier waits for a human.
      const ranked = [...learned.entries()].sort((a, b) => b[1] - a[1]);
      const total = ranked.reduce((a, [, n]) => a + n, 0);
      if (ranked[0][1] >= 3 && ranked[0][1] / total >= 0.7) { epassMap.set(code, { supplier: ranked[0][0], source: "learned" }); continue; }
    }
    if (DEFAULT_EPASS_SUPPLIER_MAP[code]) epassMap.set(code, { supplier: DEFAULT_EPASS_SUPPLIER_MAP[code], source: "default" });
  }
  const epassSuppliers = [...epassCodes.values()].map((c) => ({ ...c, mappedTo: epassMap.get(c.code)?.supplier || "", mapSource: epassMap.get(c.code)?.source || "none" })).sort((a, b) => b.models - a.models);

  // The picker offers NetSuite's vendor names plus anything an override already uses — not ePASS's names.
  const supplierOptions = [...new Set([...supplierRows, ...Object.values(settings.modelSupplier || {}), ...Object.values(settings.epassSupplierMap || {})].map((x) => String(x || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const supplierFor = (key, item, rec) => {
    const override = settings.modelSupplier[key];
    if (override) return { supplier: override, source: "override" };
    if (item?.primary_supplier) return { supplier: item.primary_supplier, source: "netsuite" };
    const code = String(rec?.supplierCode || "").trim().toUpperCase();
    const mapped = code ? epassMap.get(code) : null;
    if (mapped) return { supplier: mapped.supplier, source: "epass-map" };
    const brand = item?.brand || rec?.brand || "";
    if (brand && brandToNs.has(brand)) return { supplier: brandToNs.get(brand).supplier, source: "brand" };
    if (brand && settings.supplierMap[brand]) return { supplier: settings.supplierMap[brand], source: "brand" };
    if (rec?.supplierName || code) return { supplier: rec.supplierName || code, source: "epass" }; // unmapped ePASS supplier — its own name, flagged on the page
    return { supplier: "Unassigned", source: "none" };
  };

  const months = [...new Set(lines.map((l) => (l.delDate || "").slice(0, 7)).filter(Boolean))].sort();
  const m = /^\d{4}-\d{2}$/.test(month) ? month : month === "none" ? "none" : "";
  // Horizon: with no month picked, show lines due through the end of the
  // second month out (the OE-04 was always run that way: 9/18 → 11/30) and
  // hide lines with no schedule date — "All dates" / "No date" lift both.
  const base = dateOnlyUtc(s.report_date) || new Date().toISOString().slice(0, 10);
  const defaultThrough = endOfMonthPlus(base, 2);
  const th = through === "all" ? "" : /^\d{4}-\d{2}$/.test(through) ? `${through}-31` : defaultThrough;
  const inMonth = (l) => m ? ((l.delDate || "").slice(0, 7) === m || (m === "none" && !l.delDate)) : (!th || (l.delDate && l.delDate <= th));

  const modelRows = models.map((rec) => {
    const item = itemByKey.get(rec.key) || null;
    const sup = supplierFor(rec.key, item, rec);
    // Feed snapshots keep every open line; the report lists only what still
    // has to be bought (needed > 0) plus returns. OE-04 lines have no flag.
    const toOrder = (l) => l.needed == null ? true : l.needed > 0 || l.qty < 0;
    const all = lines.filter((l) => l.key === rec.key);
    const shown = all.filter(toOrder).filter(inMonth);
    const written = rec.written ?? all.reduce((a, l) => a + (l.qty || 0), 0);
    const needed = rec.needed ?? all.filter(toOrder).reduce((a, l) => a + (l.qty || 0), 0);
    // Short = what has to be bought minus what can actually cover it: units
    // on hand that aren't promised to another invoice, and stock on order
    // (not a PO cut for someone else). The OE-04 snapshot has neither split,
    // so it falls back to plain QOH / QOO as before.
    const proposed = Math.max(0, needed - (rec.freeQoh ?? rec.qoh ?? 0) - (rec.stockQoo ?? rec.qoo ?? 0));
    const std = all.find((l) => l.stdCost != null)?.stdCost ?? null;
    const outLines = shown.map((l) => ({ ...l, handled: settings.handledLines[l.id] || null, marginRate: marginRate(l.sellPrice, l.stdCost), marginDollars: l.sellPrice != null && l.stdCost != null ? Math.round((l.sellPrice - l.stdCost) * 100) / 100 : null }));
    return {
      model: rec.model, key: rec.key, stockClass: rec.stockClass, written, qoh: rec.qoh, qoo: rec.qoo, stockQoo: rec.stockQoo, min: rec.min, max: rec.max, locations: rec.locations,
      spokenFor: rec.spokenFor || [], proposed, needed, stdCost: std, freeQoh: rec.freeQoh ?? null, specialQoo: rec.specialQoo ?? null,
      onOrder: (rec.onOrder || []).map((o) => ({ po: o.po, qty: o.qty, supplier: o.supplier, eta: o.eta || "", etaConfirmed: !!o.etaConfirmed, ordered: o.ordered || "", forInvoice: o.forInvoice || "", customer: o.customer || "", released: o.released !== false })),
      item: item ? { brand: item.brand, displayName: item.display_name, modelNumber: item.model_number, type: item.item_type, basePrice: item.base_price == null ? null : Number(item.base_price), description: item.short_description, finish: item.finish, primarySupplier: item.primary_supplier || "" }
        : rec.brand || rec.description ? { brand: rec.brand || "", displayName: rec.description || "", modelNumber: rec.model, type: rec.productCode || "", basePrice: null, description: rec.description || "", finish: "", primarySupplier: rec.supplierName || rec.supplierCode || "", fromEpass: true } : null,
      epass: rec.supplierCode || rec.brand ? { supplierCode: rec.supplierCode || "", supplierName: rec.supplierName || "", brand: rec.brand || "", qohMain: rec.qohMain ?? null, qohLoc: rec.qohLoc ?? null, reserved: rec.reserved ?? null, booked: rec.booked ?? null, lastReceived: rec.lastReceived || "", lastOrdered: rec.lastOrdered || "", discontinued: !!rec.discontinued, obsolete: !!rec.obsolete } : null,
      supplier: sup.supplier, supplierSource: sup.source,
      lines: outLines,
      unitsInView: shown.reduce((a, l) => a + (l.qty || 0), 0),
      earliestDel: shown.map((l) => l.delDate).filter(Boolean).sort()[0] || "",
      sellInView: shown.reduce((a, l) => a + (l.sellPrice != null ? l.sellPrice * (l.qty || 1) : 0), 0),
      costInView: shown.reduce((a, l) => a + (l.stdCost != null ? l.stdCost * (l.qty || 1) : 0), 0)
    };
  }).filter((r) => r.lines.length);

  const bySupplier = new Map();
  for (const r of modelRows) {
    if (!bySupplier.has(r.supplier)) bySupplier.set(r.supplier, { supplier: r.supplier, models: [], units: 0, proposedUnits: 0, sell: 0, cost: 0, earliestDel: "" });
    const g = bySupplier.get(r.supplier);
    g.models.push(r); g.units += r.unitsInView; g.proposedUnits += Math.min(r.proposed, r.unitsInView); g.sell += r.sellInView; g.cost += r.costInView;
    if (r.earliestDel && (!g.earliestDel || r.earliestDel < g.earliestDel)) g.earliestDel = r.earliestDel;
  }
  const suppliers = [...bySupplier.values()].map((g) => ({ ...g, sell: Math.round(g.sell * 100) / 100, cost: Math.round(g.cost * 100) / 100, margin: marginRate(g.sell, g.cost), models: g.models.sort((a, b) => (a.earliestDel || "9").localeCompare(b.earliestDel || "9") || a.model.localeCompare(b.model)) }))
    .sort((a, b) => (a.supplier === "Unassigned") - (b.supplier === "Unassigned") || b.units - a.units || a.supplier.localeCompare(b.supplier));

  const totals = {
    lines: modelRows.reduce((a, r) => a + r.lines.length, 0),
    units: modelRows.reduce((a, r) => a + r.unitsInView, 0),
    proposedUnits: suppliers.reduce((a, g) => a + g.proposedUnits, 0),
    sell: Math.round(suppliers.reduce((a, g) => a + g.sell, 0) * 100) / 100,
    cost: Math.round(suppliers.reduce((a, g) => a + g.cost, 0) * 100) / 100,
    unmatchedModels: modelRows.filter((r) => !r.item).length,
    modelsInView: modelRows.length
  };
  totals.margin = marginRate(totals.sell, totals.cost);
  return { sources, settings, supplierOptions, epassSuppliers, months, month: m, through: th, throughDefault: defaultThrough, suppliers, totals, warnings: Array.isArray(s.warnings) ? s.warnings : [] };
}

// ---------------------------------------------------------------------------
// Inventory position for one model — the ePASS "Serial # for Model" screen,
// rebuilt from what Agility already holds: the written-models snapshot
// (QOH / QOO / written / spoken-for / on-hand by location), the serial
// inventory snapshot (each unit on hand with its receive date and the
// ticket it's written to) and the Sales Order Detail warehouse (units
// delivered in the last months).
// ---------------------------------------------------------------------------
export async function getInventoryPosition(modelKey) {
  const key = normModel(modelKey);
  if (!key) throw new Error("Model is required.");
  const pool = await getReadyPool();
  const snap = (await pool.query(`SELECT lines, models, uploaded_at FROM written_models_snapshot WHERE id = 1`)).rows[0];
  const rec = (snap?.models || []).find((m) => m.key === key) || null;
  const lines = (snap?.lines || []).filter((l) => l.key === key);
  const item = (await pool.query(`SELECT * FROM netsuite_items WHERE model_key = $1`, [key])).rows[0] || null;

  // serial units on hand — from the ePASS feed when the snapshot came from it
  // (every unit in stock, refreshed each pull), else the ExportModel upload.
  let units = [], serialSource = null;
  if (Array.isArray(rec?.units)) {
    const todayMs = Date.now();
    serialSource = { uploadedAt: snap?.uploaded_at?.toISOString?.() || null, sourceFile: "ePASS feed (Serial master)", feed: true };
    units = rec.units.map((u) => ({
      serial: u.serial, serialType: u.serialType || "", received: u.received || "", cost: Number(u.cost) || 0,
      ageDays: /^\d{4}-\d{2}-\d{2}$/.test(u.received || "") ? Math.max(0, Math.round((todayMs - new Date(u.received + "T00:00:00Z").getTime()) / 86400000)) : null,
      writtenTo: u.writtenTo || "", customer: u.customer || "", scheduleDate: u.scheduleDate || "", status: u.status || "", description: rec.description || "",
      location: u.location || "", bin: u.bin || "", po: u.po || ""
    }));
    units.sort((a, b) => (a.writtenTo ? 0 : 1) - (b.writtenTo ? 0 : 1) || (a.received || "").localeCompare(b.received || ""));
  } else try {
    const r = await pool.query(`SELECT serial_units, uploaded_at, source_file FROM shop_inventory_snapshot WHERE id = 1`);
    const row = r.rows[0];
    if (row) {
      serialSource = { uploadedAt: row.uploaded_at?.toISOString?.() || null, sourceFile: row.source_file || "" };
      const todayMs = Date.now();
      const byInvoice = new Map(lines.map((l) => [String(l.invoice).toUpperCase(), l]));
      const spokenByInvoice = new Map((rec?.spokenFor || []).map((s) => [String(s.invoice).toUpperCase(), s]));
      for (const u of row.serial_units || []) {
        if ((normModel(u.model) || normModel(u.sku)) !== key) continue;
        const inv = String(u.writtenTo || "").toUpperCase();
        const line = inv ? byInvoice.get(inv) || byInvoice.get(inv.replace(/-\d+$/, "")) || null : null;
        const spoken = inv ? spokenByInvoice.get(inv) || null : null;
        units.push({
          serial: u.serial, serialType: u.serialType || "", received: u.received || "", cost: Number(u.cost) || 0,
          ageDays: /^\d{4}-\d{2}-\d{2}$/.test(u.received || "") ? Math.max(0, Math.round((todayMs - new Date(u.received + "T00:00:00Z").getTime()) / 86400000)) : null,
          writtenTo: u.writtenTo || "", customer: line?.customerName || spoken?.customer || "", scheduleDate: line?.delDate || spoken?.deliveryDate || "", status: line?.status || spoken?.status || "", description: u.description || ""
        });
      }
      units.sort((a, b) => (a.writtenTo ? 0 : 1) - (b.writtenTo ? 0 : 1) || (a.received || "").localeCompare(b.received || ""));
    }
  } catch (e) { serialSource = { error: e.message }; }

  // delivered units by month (Sales Order Detail warehouse), last 3 months present
  let months = [];
  try {
    const r = await pool.query(
      `SELECT source_month AS month, SUM(qty) AS units FROM sales_order_lines
       WHERE upper(regexp_replace(product, '[^0-9A-Za-z]', '', 'g')) = $1 GROUP BY 1 ORDER BY 1 DESC LIMIT 3`, [key]);
    months = r.rows.map((x) => ({ month: x.month, units: Number(x.units) || 0 })).reverse();
  } catch {}

  const spokenUnits = (rec?.spokenFor || []).reduce((a, s) => a + (Number(s.qty) || 0), 0);
  return {
    model: rec?.model || item?.model_number || modelKey, key,
    description: item?.short_description || (item?.display_name && normModel(item.display_name) !== key ? item.display_name : "") || units[0]?.description || "",
    brand: item?.brand || "", supplier: item?.primary_supplier || "",
    summary: {
      qoh: rec?.qoh ?? (units.length || null), qoo: rec?.qoo ?? null, stockQoo: rec?.stockQoo ?? null, written: rec?.written ?? lines.reduce((a, l) => a + (l.qty || 0), 0),
      spokenFor: spokenUnits, free: rec?.freeQoh ?? (rec?.qoh != null ? Math.max(0, rec.qoh - spokenUnits) : null),
      locations: rec?.locations || "", stockClass: rec?.stockClass || "", min: rec?.min ?? null, max: rec?.max ?? null
    },
    months, units, spokenFor: rec?.spokenFor || [],
    onOrder: rec?.onOrder || [],
    writtenLines: lines.map((l) => ({ invoice: l.invoice, customer: l.customerName, qty: l.qty, status: l.status, delDate: l.delDate, invoiceDate: l.invoiceDate, sp: l.sp, po: l.po || "", poDate: l.poDate || "", ordered: !!l.ordered, d1: !!l.d1, covered: l.covered || 0, needed: l.needed ?? null })),
    sources: { report: snap ? { uploadedAt: snap.uploaded_at?.toISOString?.() || null } : null, serials: serialSource }
  };
}

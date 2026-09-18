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
// NetSuite's item export supplies the brand for each model; brands roll up
// to a supplier through an editable map (Whirlpool/Maytag/KitchenAid →
// Whirlpool …), with per-model overrides for the ones NetSuite doesn't
// carry (HVAC, parts). Proposed order per model = written − QOH − QOO.
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
// NetSuite items CSV
// ---------------------------------------------------------------------------
export function parseNetsuiteItemsCsv(buffer) {
  const wb = readWorkbook(buffer, { type: "buffer", raw: false });
  const rows = xlsxUtils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const pick = (r, ...names) => { for (const n of names) { const k = Object.keys(r).find((h) => h.trim().toLowerCase() === n); if (k != null && r[k] !== "") return r[k]; } return ""; };
  const items = [];
  for (const r of rows) {
    const modelNumber = text(pick(r, "model number", "model", "name"), 60);
    const displayName = text(pick(r, "display name", "displayname"), 80);
    const key = normModel(modelNumber || displayName);
    if (!key) continue;
    items.push({ key, modelNumber, displayName, brand: text(pick(r, "brand"), 60), type: text(pick(r, "type"), 40), basePrice: num(pick(r, "base price", "price")), shortDescription: text(pick(r, "short description", "description"), 160), finish: text(pick(r, "primary finish (color)", "finish", "color"), 40) });
  }
  if (!items.length) throw new Error("No items found — the CSV needs at least a Model Number column.");
  return items;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export async function saveWrittenModelsSnapshot(parsed, { by = "", sourceFile = "" } = {}) {
  const pool = await getReadyPool();
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
      await client.query(
        `INSERT INTO netsuite_items (model_key, model_number, display_name, brand, item_type, base_price, short_description, finish, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [it.key, it.modelNumber, it.displayName, it.brand, it.type, it.basePrice, it.shortDescription, it.finish]
      );
      // display names sometimes differ from the model number (suffixes) — index those too
      const dk = normModel(it.displayName);
      if (dk && dk !== it.key && !seen.has(dk)) { seen.add(dk); await client.query(`INSERT INTO netsuite_items (model_key, model_number, display_name, brand, item_type, base_price, short_description, finish, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (model_key) DO NOTHING`, [dk, it.modelNumber, it.displayName, it.brand, it.type, it.basePrice, it.shortDescription, it.finish]); }
    }
    await client.query(`INSERT INTO netsuite_items_meta (id, uploaded_at, uploaded_by, source_file, item_count) VALUES (1, NOW(), $1, $2, $3) ON CONFLICT (id) DO UPDATE SET uploaded_at = NOW(), uploaded_by = EXCLUDED.uploaded_by, source_file = EXCLUDED.source_file, item_count = EXCLUDED.item_count`, [String(by).slice(0, 200), String(sourceFile).slice(0, 200), seen.size]);
    await client.query("COMMIT");
    return { items: seen.size };
  } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
}

export async function getWrittenModelsSettings() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT key, value FROM written_models_settings`);
  const out = { supplierMap: { ...DEFAULT_SUPPLIER_MAP }, modelSupplier: {} };
  for (const row of r.rows) {
    if (row.key === "supplier_map" && row.value && typeof row.value === "object") out.supplierMap = { ...DEFAULT_SUPPLIER_MAP, ...row.value };
    if (row.key === "model_supplier" && row.value && typeof row.value === "object") out.modelSupplier = row.value;
  }
  return out;
}
export async function setWrittenModelsSetting(key, value) {
  if (!["supplier_map", "model_supplier"].includes(key)) throw new Error(`Unknown setting ${key}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} must be an object of names.`);
  const clean = {};
  for (const [k, v] of Object.entries(value)) { const kk = String(k).trim().slice(0, 80); const vv = String(v ?? "").trim().slice(0, 80); if (kk) clean[key === "model_supplier" ? normModel(kk) : kk] = vv; }
  const pool = await getReadyPool();
  await pool.query(`INSERT INTO written_models_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(clean)]);
  return clean;
}

// ---------------------------------------------------------------------------
// Board: every written line with its item, supplier and margin, grouped by
// supplier; models with their proposed order quantity.
// ---------------------------------------------------------------------------
export function marginRate(sell, cost) {
  if (sell == null || cost == null || !(sell > 0)) return null;
  return Math.round(((sell - cost) / sell) * 10000) / 10000;
}

export async function buildWrittenModelsBoard({ month = "" } = {}) {
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

  const lines = Array.isArray(s.lines) ? s.lines : [];
  const models = Array.isArray(s.models) ? s.models : [];
  const keys = [...new Set(models.map((m) => m.key))];
  const items = keys.length ? (await pool.query(`SELECT * FROM netsuite_items WHERE model_key = ANY($1)`, [keys])).rows : [];
  const itemByKey = new Map(items.map((i) => [i.model_key, i]));

  const supplierFor = (key, item) => {
    const override = settings.modelSupplier[key];
    if (override) return { supplier: override, source: "override" };
    if (item?.brand) return { supplier: settings.supplierMap[item.brand] || item.brand, source: "brand" };
    return { supplier: "Unassigned", source: "none" };
  };

  const months = [...new Set(lines.map((l) => (l.delDate || "").slice(0, 7)).filter(Boolean))].sort();
  const m = /^\d{4}-\d{2}$/.test(month) ? month : "";
  const inMonth = (l) => !m || (l.delDate || "").slice(0, 7) === m || (m === "none" && !l.delDate);

  const modelRows = models.map((rec) => {
    const item = itemByKey.get(rec.key) || null;
    const sup = supplierFor(rec.key, item);
    const all = lines.filter((l) => l.key === rec.key);
    const shown = all.filter(inMonth);
    const written = rec.written ?? all.reduce((a, l) => a + (l.qty || 0), 0);
    const proposed = Math.max(0, written - (rec.qoh || 0) - (rec.qoo || 0));
    const std = all.find((l) => l.stdCost != null)?.stdCost ?? null;
    const outLines = shown.map((l) => ({ ...l, marginRate: marginRate(l.sellPrice, l.stdCost), marginDollars: l.sellPrice != null && l.stdCost != null ? Math.round((l.sellPrice - l.stdCost) * 100) / 100 : null }));
    return {
      model: rec.model, key: rec.key, stockClass: rec.stockClass, written, qoh: rec.qoh, qoo: rec.qoo, stockQoo: rec.stockQoo, min: rec.min, max: rec.max, locations: rec.locations,
      spokenFor: rec.spokenFor || [], proposed, stdCost: std,
      item: item ? { brand: item.brand, displayName: item.display_name, modelNumber: item.model_number, type: item.item_type, basePrice: item.base_price == null ? null : Number(item.base_price), description: item.short_description, finish: item.finish } : null,
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
  return { sources, settings, months, month: m, suppliers, totals, warnings: Array.isArray(s.warnings) ? s.warnings : [] };
}

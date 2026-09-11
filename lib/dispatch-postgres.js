import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Dispatch import spine (Agility_Scheduling_Model_Context.md, §40, §51 1–5).
//
// Lands the ePASS DispatchTrack export (later: the NetSuite equivalent) raw,
// normalises it into transactions / lines / service locations / projects,
// and derives DISPATCH WORK headers — the operational obligations the
// scheduler will later place on visits and routes. Nothing here schedules;
// it builds the truthful demand picture the model needs.
//
//   dsp_imports, dsp_raw_rows        landing (raw payload + metadata)
//   dsp_config                       operating standards — configuration, not code
//   dsp_service_location, dsp_project
//   dsp_transaction, dsp_line        commercial truth (one row per invoice / line)
//   dsp_work, dsp_work_line          dispatch truth (DELIVERY / INSTALL headers)
//   dsp_work_relationship            INSTALL_FOR / SAME_INVOICE / SPLIT_FROM
//   dsp_work_status_history          readiness + override audit
//
// Pass one (Andrew, 2026-09-11): appliance delivery + install (departments
// S and R). Other departments are landed and normalised but no work is
// derived for them yet.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS dsp_imports (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'epass_dispatchtrack',
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  work_count INTEGER NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS dsp_raw_rows (
  import_id BIGINT NOT NULL REFERENCES dsp_imports(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (import_id, row_no)
);
CREATE TABLE IF NOT EXISTS dsp_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS dsp_service_location (
  id UUID PRIMARY KEY,
  address_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  address1 TEXT NOT NULL DEFAULT '',
  address2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  map_zone TEXT NOT NULL DEFAULT '',
  modifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra_minutes INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS dsp_project (
  id UUID PRIMARY KEY,
  project_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  customer_code TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  primary_location_id UUID REFERENCES dsp_service_location(id),
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS dsp_transaction (
  invoice TEXT PRIMARY KEY,
  base_invoice TEXT NOT NULL DEFAULT '',
  dept_code TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  customer_code TEXT NOT NULL DEFAULT '',
  bill_name TEXT NOT NULL DEFAULT '',
  bill_address2 TEXT NOT NULL DEFAULT '',
  ship_name TEXT NOT NULL DEFAULT '',
  service_location_id UUID REFERENCES dsp_service_location(id),
  project_id UUID REFERENCES dsp_project(id),
  delivery_date DATE,
  job_status TEXT NOT NULL DEFAULT '',
  truck_code TEXT NOT NULL DEFAULT '',
  map_zone TEXT NOT NULL DEFAULT '',
  priorities TEXT NOT NULL DEFAULT '',
  qualifications TEXT NOT NULL DEFAULT '',
  comment1 TEXT NOT NULL DEFAULT '',
  order_detail TEXT NOT NULL DEFAULT '',
  phone1 TEXT NOT NULL DEFAULT '',
  phone2 TEXT NOT NULL DEFAULT '',
  phone3 TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  salesperson TEXT NOT NULL DEFAULT '',
  salesperson_email TEXT NOT NULL DEFAULT '',
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  source_hash TEXT NOT NULL DEFAULT '',
  first_import_id BIGINT,
  last_import_id BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dsp_txn_date ON dsp_transaction (delivery_date);
CREATE INDEX IF NOT EXISTS idx_dsp_txn_loc ON dsp_transaction (service_location_id);
CREATE TABLE IF NOT EXISTS dsp_line (
  id UUID PRIMARY KEY,
  invoice TEXT NOT NULL REFERENCES dsp_transaction(invoice) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ext NUMERIC(12,2) NOT NULL DEFAULT 0,
  source_points NUMERIC(6,2),
  source_minutes INTEGER,
  product_code TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  line_class TEXT NOT NULL DEFAULT '',
  class_source TEXT NOT NULL DEFAULT '',
  work_type TEXT NOT NULL DEFAULT '',
  UNIQUE (invoice, line_no)
);
CREATE TABLE IF NOT EXISTS dsp_work (
  id UUID PRIMARY KEY,
  work_key TEXT NOT NULL UNIQUE,
  invoice TEXT NOT NULL REFERENCES dsp_transaction(invoice) ON DELETE CASCADE,
  base_invoice TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  work_type TEXT NOT NULL DEFAULT '',
  service_location_id UUID REFERENCES dsp_service_location(id),
  project_id UUID REFERENCES dsp_project(id),
  customer_name TEXT NOT NULL DEFAULT '',
  requested_date DATE,
  scheduled_date DATE,
  source_status TEXT NOT NULL DEFAULT '',
  readiness TEXT NOT NULL DEFAULT 'not_ready',
  readiness_by TEXT NOT NULL DEFAULT '',
  mobility TEXT NOT NULL DEFAULT 'FLEXIBLE',
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  duration_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_minutes INTEGER,
  override_minutes INTEGER,
  override_reason TEXT NOT NULL DEFAULT '',
  override_by TEXT NOT NULL DEFAULT '',
  override_at TIMESTAMPTZ,
  points_out NUMERIC(8,2) NOT NULL DEFAULT 0,
  points_return NUMERIC(8,2) NOT NULL DEFAULT 0,
  requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dsp_work_date ON dsp_work (requested_date, department);
CREATE INDEX IF NOT EXISTS idx_dsp_work_loc ON dsp_work (service_location_id);
CREATE TABLE IF NOT EXISTS dsp_work_line (
  work_id UUID NOT NULL REFERENCES dsp_work(id) ON DELETE CASCADE,
  line_id UUID NOT NULL REFERENCES dsp_line(id) ON DELETE CASCADE,
  PRIMARY KEY (work_id, line_id)
);
CREATE TABLE IF NOT EXISTS dsp_work_relationship (
  work_id UUID NOT NULL REFERENCES dsp_work(id) ON DELETE CASCADE,
  related_work_id UUID NOT NULL REFERENCES dsp_work(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  PRIMARY KEY (work_id, related_work_id, relationship_type)
);
CREATE TABLE IF NOT EXISTS dsp_work_status_history (
  id BIGSERIAL PRIMARY KEY,
  work_id UUID NOT NULL REFERENCES dsp_work(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  prior_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL DEFAULT '',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL);
  await ensurePromise;
  return pool;
}

// ---------------------------------------------------------------------------
// Configuration (seeded once; edited on the page). Every number here is an
// operating value the business owns — the code only knows the concepts.
// ---------------------------------------------------------------------------
export const DEFAULT_CONFIG = {
  departments: {
    S: { label: "Appliance Sales", deriveWork: true, defaultCrew: 2 },
    R: { label: "Appliance Retail", deriveWork: true, defaultCrew: 2 },
    SV: { label: "Repair Service", deriveWork: false, defaultCrew: 1 },
    WTY: { label: "Warranty Service", deriveWork: false, defaultCrew: 1 },
    CAB: { label: "Cabinets", deriveWork: false, defaultCrew: 2 },
    MOD: { label: "Modifications", deriveWork: false, defaultCrew: 1 },
    AC: { label: "HVAC", deriveWork: false, defaultCrew: 2 }
  },
  // ePASS job-status codes → readiness. Anything not listed is not_ready.
  // (Assumed from the export: D1/D2 carry no truck, D2R/D3/D4/D7 do.)
  status_map: {
    ready: ["D2", "D3"],
    scheduled: ["D2R", "D4", "D7"],
    completed: ["D8"],
    labels: { D1: "Entered", D2: "Ready to schedule", D2R: "Rescheduled", D3: "Scheduled", D4: "Confirmed", D7: "Out for delivery", D8: "Delivered" }
  },
  // Line classification, first match wins. Classes: PRODUCT, ACCESSORY,
  // INSTALL, DELIVERY, HAULAWAY, FREIGHT, DISCOUNT, PLAN, FEE, SURVEY, NOTE.
  line_rules: [
    { name: "note line", test: { noModel: true, zeroAmount: true }, cls: "NOTE" },
    { name: "delivery service", test: { modelPrefix: ["DEL"] }, cls: "DELIVERY", workType: "DELIVERY" },
    { name: "delivery policy text", test: { modelRegex: "^\\*1\\.2[46]$" }, cls: "NOTE" },
    { name: "haul-away / removal", test: { modelPrefix: ["HAUL", "REMOVAL"], descRegex: "haul|removal|recycle" }, cls: "HAULAWAY", workType: "DELIVERY" },
    { name: "stairs / access", test: { modelPrefix: ["STAIR"] }, cls: "ACCESS", workType: "DELIVERY" },
    { name: "freight / strip", test: { modelPrefix: ["FREIGHT", "STRIP", "PDIM"] }, cls: "FREIGHT", workType: "DELIVERY" },
    { name: "measure / survey", test: { modelPrefix: ["MOD-SURVEY"] }, cls: "SURVEY", workType: "INSTALL" },
    { name: "cabinet mod on site", test: { modelPrefix: ["MOD-"] }, cls: "INSTALL", workType: "INSTALL" },
    { name: "protection plan", test: { modelRegex: "^ZZ|-LP$" }, cls: "PLAN" },
    { name: "ticket / check reference", test: { modelPrefix: ["PT", "CH"] }, cls: "NOTE" },
    { name: "gas conversion", test: { modelPrefix: ["LPCON"] }, cls: "INSTALL", workType: "INSTALL" },
    { name: "cabinet mod line", test: { modelPrefix: ["CAB-MOD"] }, cls: "INSTALL", workType: "INSTALL" },
    { name: "rebate / discount", test: { negativeQty: true }, cls: "DISCOUNT" },
    { name: "promo text", test: { modelRegex: "^\\*\\d" }, cls: "NOTE" },
    { name: "cord / connection accessory", test: { modelPrefix: ["RANGECORD", "DRYERCORD", "CORD", "WIRE", "SS-FLEX"] }, cls: "ACCESSORY", workType: "DELIVERY" },
    { name: "install service", test: { modelPrefix: ["LAUNDRY01", "LAUNDRY03", "LAUNDRY09", "DW1", "DW2", "DW3", "DW4", "REFRIG", "RANGE", "CTOP", "OVEN", "VENT", "MICRO", "IMAKER", "WD1", "WD2", "GRILL", "INST", "DW-MIELE-PROMO", "COFFEE"] }, cls: "INSTALL", workType: "INSTALL" },
    { name: "accessory / part", test: { modelPrefix: ["LAUNDRY", "SS-FLEX", "RANGECORD", "DRYERCORD", "ACC", "CORD", "WIRE"], productCode: ["ACC", "TRIMK", "PANEL", "PED", "GROUT"] }, cls: "ACCESSORY", workType: "DELIVERY" },
    { name: "accessory by description", test: { descRegex: "\\b(cord|wire|screw|hose|flex line|kit)\\b" }, cls: "ACCESSORY", workType: "DELIVERY" },
    { name: "install by description", test: { descRegex: "\\binstall\\b" }, cls: "INSTALL", workType: "INSTALL" },
    { name: "product", test: { hasProductCode: true }, cls: "PRODUCT", workType: "DELIVERY" },
    { name: "priced line, no code", test: { positiveAmount: true }, cls: "PRODUCT", workType: "DELIVERY", flag: "Priced line without a product code — check the item" }
  ],
  // Revenue attribution: which work header each line class's dollars land on.
  revenue_rules: { PRODUCT: "DELIVERY", ACCESSORY: "DELIVERY", DELIVERY: "DELIVERY", HAULAWAY: "DELIVERY", ACCESS: "DELIVERY", FREIGHT: "DELIVERY", DISCOUNT: "DELIVERY", PLAN: "DELIVERY", FEE: "DELIVERY", INSTALL: "INSTALL", SURVEY: "INSTALL" },
  // Delivery base minutes by the delivery line's model (the service level).
  delivery_types: { DEL1: { label: "Curbside / drop", minutes: 15 }, DEL2: { label: "Standard in-home", minutes: 30 }, DEL4: { label: "Pro package in-home", minutes: 45 }, "DEL-MIL": { label: "Military", minutes: 30 }, default: { minutes: 30 } },
  // Product handling minutes + truck points by ProductCode prefix (longest prefix wins).
  product_standards: {
    RE: { minutes: 20, points: 3, haul: 3 }, REBI: { minutes: 30, points: 4, haul: 4 }, REUC: { minutes: 15, points: 2, haul: 2 }, REDRA: { minutes: 15, points: 2, haul: 2 },
    RA: { minutes: 20, points: 3, haul: 3 }, RAPRO: { minutes: 30, points: 4, haul: 4 }, RADF: { minutes: 30, points: 4, haul: 4 },
    CT: { minutes: 10, points: 1, haul: 1 }, OV: { minutes: 15, points: 2, haul: 2 }, MW: { minutes: 5, points: 1, haul: 1 },
    DW: { minutes: 10, points: 1, haul: 1 }, WASH: { minutes: 15, points: 2, haul: 2 }, DR: { minutes: 15, points: 2, haul: 2 }, WD: { minutes: 15, points: 2, haul: 2 }, WDCOM: { minutes: 20, points: 3, haul: 3 },
    VH: { minutes: 5, points: 1, haul: 1 }, IMUC: { minutes: 10, points: 1, haul: 1 }, CM: { minutes: 10, points: 1, haul: 1 }, GR: { minutes: 15, points: 2, haul: 2 },
    ACC: { minutes: 0, points: 0, haul: 0 }, TRIMK: { minutes: 0, points: 0, haul: 0 }, PANEL: { minutes: 0, points: 0, haul: 0 }, PED: { minutes: 5, points: 1, haul: 0 }, GROUT: { minutes: 0, points: 0, haul: 0 },
    default: { minutes: 10, points: 1, haul: 1 }
  },
  // Install standard minutes by the install line's model.
  install_standards: {
    LAUNDRY01: 30, LAUNDRY03: 20, LAUNDRY09: 45, DW1: 45, DW2: 60, "DW-MIELE-PROMO": 45,
    REFRIG1: 20, REFRIG2: 90, REFRIG3: 120, REFRIG5: 150, REFRIG6: 60, REFRIG7: 90, REFRIG8: 75,
    RANGE1: 30, RANGE4: 60, CTOP1: 45, OVEN1: 60, OVEN2: 75, OVEN5: 45, VENT2: 60, VENT4: 45,
    MICRO1: 30, MICRO2: 10, MICRO3: 45, MICRO4: 45, MICRO5: 45, IMAKER: 60, "IMAKER-PR": 75, WD1: 30, WD2: 45, GRILL1: 45, "MOD-SURVEY": 30, "MOD-CAB": 60, "CAB-MOD": 60, "MOD-CTOP": 45, STAIR: 20,
    DW3: 60, DW4: 75, DW2451: 45, RANGE2: 45, RANGE3: 45, RANGE6: 90, CTOP4: 60, CTOP7: 75, "CTOP-FAB": 60, OVEN3: 90, OVEN7: 90, VENT1: 30, VENT3: 60, VENT7: 90, REFRIG4: 120, LAUNDRY08: 45, COFFEE2: 45, LPCON4: 30, LPCON5: 30,
    default: 30
  },
  // Capability requirements: install models that need the specialty tier;
  // ePASS "Qualifications" codes pass through as capabilities too.
  capability_rules: {
    specialtyInstallModels: ["REFRIG2", "REFRIG3", "REFRIG5", "REFRIG6", "REFRIG7", "REFRIG8", "IMAKER", "IMAKER-PR", "VENT2", "VENT4", "MICRO5", "MICRO3", "MOD-CAB"],
    qualificationCapabilities: { APPL: "APPLIANCE_DELIVERY", IMUC: "ICE_MACHINE", CAB: "CABINET", MOD: "MODIFICATION", HVAC: "HVAC", INST: "INSTALL", DO: "DROP_OFF" },
    proProductCodes: ["RAPRO", "RADF", "REBI", "REBIB", "REBIF", "REBIS", "REBIW", "REBFD"],
    proExtraPeople: 1
  },
  packaging_factor: 0.25,
  raw_imports_kept: 3
};

export async function getDispatchConfig() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT key, value FROM dsp_config`);
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  for (const row of r.rows) cfg[row.key] = row.value;
  return cfg;
}
export async function saveDispatchConfig(key, value, byEmail = "") {
  if (!(key in DEFAULT_CONFIG)) throw new Error(`Unknown configuration key "${key}".`);
  const pool = await getReadyPool();
  await pool.query(
    `INSERT INTO dsp_config (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, JSON.stringify(value), byEmail.slice(0, 200)]
  );
  return getDispatchConfig();
}
export async function resetDispatchConfig(key) {
  const pool = await getReadyPool();
  await pool.query(`DELETE FROM dsp_config WHERE key = $1`, [key]);
  return getDispatchConfig();
}

// ---------------------------------------------------------------------------
// CSV parsing (DispatchTrack export: RFC-4180-ish, UTF-8, CRLF, quoted fields)
// ---------------------------------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((c) => c !== "")) rows.push(row); }
  return rows;
}

const REQUIRED_HEADERS = ["Order Number", "Model", "Description", "Quantity", "Delivery Date", "Delivery Type", "Customer Code", "Ship Name", "Ship Address1", "Ship City", "Ship Zip", "Amount", "Job Status"];

export function parseDispatchTrackExport(text) {
  const grid = parseCsv(text);
  if (!grid.length) throw new Error("The file is empty.");
  const header = grid[0].map((h) => String(h || "").trim());
  const missing = REQUIRED_HEADERS.filter((h) => !header.includes(h));
  if (missing.length) throw new Error(`This doesn't look like the DispatchTrack export — missing columns: ${missing.join(", ")}.`);
  const rows = grid.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    header.forEach((h, j) => { if (h) o[h] = String(r[j] ?? "").trim(); });
    return o;
  }).filter((o) => o["Order Number"]);
  return { header, rows };
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
function usDate(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v || "").trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}
export function addressKey(a1, zip, a2 = "") {
  const norm = (s) => String(s || "").toUpperCase().replace(/[.,#]/g, " ").replace(/\b(ROAD)\b/g, "RD").replace(/\b(DRIVE)\b/g, "DR").replace(/\b(STREET)\b/g, "ST").replace(/\b(LANE)\b/g, "LN").replace(/\b(AVENUE)\b/g, "AVE").replace(/\b(COURT)\b/g, "CT").replace(/\b(CIRCLE)\b/g, "CIR").replace(/\b(BOULEVARD)\b/g, "BLVD").replace(/\b(TRAIL)\b/g, "TRL").replace(/\b(APARTMENT|APT|UNIT|STE|SUITE)\b/g, "#").replace(/\s+/g, " ").trim();
  return `${norm(a1)}|${norm(a2)}|${String(zip || "").slice(0, 5)}`;
}
function longestPrefixMatch(table, code) {
  const c = String(code || "").toUpperCase();
  let best = null, bestLen = 0;
  for (const k of Object.keys(table)) {
    if (k === "default") continue;
    if (c.startsWith(k.toUpperCase()) && k.length > bestLen) { best = table[k]; bestLen = k.length; }
  }
  return best || table.default || null;
}

// Classify one line against the ordered rule list.
export function classifyLine(line, rules) {
  const model = String(line.model || "").toUpperCase();
  const desc = String(line.description || "");
  for (const rule of rules) {
    const t = rule.test || {};
    let ok = true;
    if (t.noModel && model) ok = false;
    if (ok && t.zeroAmount && !(num(line.amount) === 0 || num(line.qty) === 0)) ok = false;
    if (ok && t.negativeQty && !(num(line.qty) < 0 || num(line.amount) < 0)) ok = false;
    if (ok && t.positiveAmount && !(num(line.amount) > 0 && num(line.qty) > 0)) ok = false;
    if (ok && t.hasProductCode && !line.productCode) ok = false;
    if (ok && t.modelPrefix && !t.modelPrefix.some((p) => model.startsWith(String(p).toUpperCase()))) {
      // prefix miss can still hit on description/productCode when those are also given
      ok = !!((t.descRegex && new RegExp(t.descRegex, "i").test(desc)) || (t.productCode && t.productCode.includes(line.productCode)));
    } else if (ok && !t.modelPrefix) {
      if (t.descRegex && !new RegExp(t.descRegex, "i").test(desc)) ok = false;
      if (ok && t.productCode && !t.productCode.includes(line.productCode)) ok = false;
    }
    if (ok && t.modelRegex && !new RegExp(t.modelRegex, "i").test(model)) ok = false;
    if (ok) return { cls: rule.cls, workType: rule.workType || "", source: rule.name, flag: rule.flag || "" };
  }
  return { cls: "UNCLASSIFIED", workType: "", source: "no rule", flag: "No classification rule matched" };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
export async function importDispatchTrack(text, { filename = "", byEmail = "", source = "epass_dispatchtrack" } = {}) {
  const { rows } = parseDispatchTrackExport(text);
  const cfg = await getDispatchConfig();
  const pool = await getReadyPool();
  const client = await pool.connect();
  const summary = { departments: {}, unclassified: 0, noGeocode: 0, newLocations: 0, newTransactions: 0, updatedTransactions: 0, deactivated: 0, workDerived: 0, workUpdated: 0, warnings: 0 };
  try {
    await client.query("BEGIN");
    const imp = (await client.query(
      `INSERT INTO dsp_imports (source, filename, uploaded_by, row_count) VALUES ($1, $2, $3, $4) RETURNING id`,
      [source, filename.slice(0, 200), byEmail.slice(0, 200), rows.length]
    )).rows[0];
    const importId = imp.id;
    // raw landing (batched)
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values = [], params = [];
      chunk.forEach((r, k) => { params.push(importId, r._row, JSON.stringify(r)); values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length}::jsonb)`); });
      await client.query(`INSERT INTO dsp_raw_rows (import_id, row_no, data) VALUES ${values.join(",")}`, params);
    }

    // group by order
    const orders = new Map();
    for (const r of rows) { if (!orders.has(r["Order Number"])) orders.set(r["Order Number"], []); orders.get(r["Order Number"]).push(r); }

    // service locations + projects
    const locCache = new Map((await client.query(`SELECT id, address_key FROM dsp_service_location`)).rows.map((x) => [x.address_key, x.id]));
    const projCache = new Map((await client.query(`SELECT id, project_key FROM dsp_project`)).rows.map((x) => [x.project_key, x.id]));
    const seenInvoices = new Set();

    for (const [invoice, lines] of orders) {
      const h = lines[0];
      const dept = h["Delivery Type"] || h["Account"] || "";
      summary.departments[dept] = (summary.departments[dept] || 0) + 1;
      const key = addressKey(h["Ship Address1"], h["Ship Zip"], h["Ship Address2"]);
      const lat = num(h["Latitude"]) || null, lng = num(h["Longitude"]) || null;
      if (!lat || !lng) summary.noGeocode++;
      let locId = locCache.get(key);
      if (!locId) {
        locId = crypto.randomUUID();
        await client.query(
          `INSERT INTO dsp_service_location (id, address_key, name, address1, address2, city, state, zip, lat, lng, map_zone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [locId, key, h["Ship Name"], h["Ship Address1"], h["Ship Address2"], h["Ship City"], h["Ship State"], h["Ship Zip"], lat, lng, h["Map Zone"] || ""]
        );
        locCache.set(key, locId); summary.newLocations++;
      } else if (lat && lng) {
        await client.query(`UPDATE dsp_service_location SET lat = COALESCE(lat, $2), lng = COALESCE(lng, $3), map_zone = CASE WHEN map_zone = '' THEN $4 ELSE map_zone END, updated_at = NOW() WHERE id = $1`, [locId, lat, lng, h["Map Zone"] || ""]);
      }
      const projectKey = `${h["Customer Code"]}|${locId}`;
      let projId = projCache.get(projectKey);
      if (!projId) {
        projId = crypto.randomUUID();
        await client.query(
          `INSERT INTO dsp_project (id, project_key, name, customer_code, customer_name, primary_location_id) VALUES ($1,$2,$3,$4,$5,$6)`,
          [projId, projectKey, `${h["Ship Name"]} — ${h["Ship Address1"]}`.slice(0, 200), h["Customer Code"], h["Bill Name"], locId]
        );
        projCache.set(projectKey, projId);
      }

      // transaction
      const baseInvoice = invoice.replace(/-\d+$/, "");
      const hashSrc = JSON.stringify(lines.map((r) => [r["Model"], r["Description"], r["Quantity"], r["Amount"], r["Delivery Date"], r["Job Status"], r["Truck"], r["Comment1"], r["Ship Address1"], r["Phone1"], r["Email"]]));
      const hash = crypto.createHash("sha1").update(hashSrc).digest("hex");
      const existing = (await client.query(`SELECT source_hash FROM dsp_transaction WHERE invoice = $1`, [invoice])).rows[0];
      const txnParams = [invoice, baseInvoice, dept, cfg.departments[dept]?.label || dept, h["Customer Code"], h["Bill Name"], h["Bill Address2"], h["Ship Name"], locId, projId,
        usDate(h["Delivery Date"]), h["Job Status"], h["Truck"], h["Map Zone"], h["Priorites"], h["Qualifications"], h["Comment1"] || lines.map((l) => l["Comment1"]).find(Boolean) || "",
        (h["Order Detail"] || "").length > 12 ? h["Order Detail"] : "", h["Phone1"], h["Phone2"], h["Phone3"], h["Email"], h["Salesperson"], h["SalespersonEmail"], num(h["Taxes"]), num(h["Balance"]), hash, importId];
      if (!existing) {
        await client.query(
          `INSERT INTO dsp_transaction (invoice, base_invoice, dept_code, department, customer_code, bill_name, bill_address2, ship_name, service_location_id, project_id, delivery_date, job_status, truck_code, map_zone, priorities, qualifications, comment1, order_detail, phone1, phone2, phone3, email, salesperson, salesperson_email, tax, balance, source_hash, first_import_id, last_import_id, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$28,TRUE)`,
          txnParams
        );
        summary.newTransactions++;
      } else {
        await client.query(
          `UPDATE dsp_transaction SET base_invoice=$2, dept_code=$3, department=$4, customer_code=$5, bill_name=$6, bill_address2=$7, ship_name=$8, service_location_id=$9, project_id=$10, delivery_date=$11, job_status=$12, truck_code=$13, map_zone=$14, priorities=$15, qualifications=$16, comment1=$17, order_detail=$18, phone1=$19, phone2=$20, phone3=$21, email=$22, salesperson=$23, salesperson_email=$24, tax=$25, balance=$26, source_hash=$27, last_import_id=$28, active=TRUE, updated_at=NOW()
           WHERE invoice = $1`,
          txnParams
        );
        if (existing.source_hash !== hash) summary.updatedTransactions++;
      }
      seenInvoices.add(invoice);

      // lines (replace)
      await client.query(`DELETE FROM dsp_line WHERE invoice = $1`, [invoice]);
      const lineRecords = [];
      lines.forEach((r, i) => {
        const line = {
          id: crypto.randomUUID(), invoice, lineNo: i + 1, model: r["Model"], description: r["Description"], qty: num(r["Quantity"]), amount: num(r["Amount"]),
          sourcePoints: r["Points"] === "" ? null : num(r["Points"]), sourceMinutes: r["Service Time"] === "" ? null : Math.round(num(r["Service Time"])),
          productCode: r["ProductCode"] || "", color: r["Color"] || "", serial: r["Serial#"] || ""
        };
        line.ext = r2(line.qty * line.amount);
        const c = classifyLine(line, cfg.line_rules);
        line.cls = c.cls; line.classSource = c.source; line.workType = c.workType; line.flag = c.flag;
        if (c.cls === "UNCLASSIFIED" && cfg.departments[dept]?.deriveWork) summary.unclassified++;
        lineRecords.push(line);
      });
      for (const l of lineRecords) {
        await client.query(
          `INSERT INTO dsp_line (id, invoice, line_no, model, description, qty, amount, ext, source_points, source_minutes, product_code, color, serial, line_class, class_source, work_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [l.id, l.invoice, l.lineNo, l.model, l.description, l.qty, l.amount, l.ext, l.sourcePoints, l.sourceMinutes, l.productCode, l.color, l.serial, l.cls, l.classSource, l.workType]
        );
      }

      // dispatch work (S/R in this pass)
      if (cfg.departments[dept]?.deriveWork) {
        const derived = await deriveWorkForTransaction(client, cfg, { invoice, baseInvoice, dept, h, locId, projId, lines: lineRecords });
        summary.workDerived += derived.created; summary.workUpdated += derived.updated; summary.warnings += derived.warnings;
      }
    }

    // transactions that fell out of the export window
    const gone = await client.query(`UPDATE dsp_transaction SET active = FALSE, updated_at = NOW() WHERE active AND last_import_id <> $1 RETURNING invoice`, [importId]);
    summary.deactivated = gone.rowCount;
    await client.query(`UPDATE dsp_work SET active = FALSE, updated_at = NOW() WHERE active AND invoice IN (SELECT invoice FROM dsp_transaction WHERE active = FALSE)`);
    await client.query(`UPDATE dsp_work SET active = TRUE, updated_at = NOW() WHERE NOT active AND invoice IN (SELECT invoice FROM dsp_transaction WHERE active = TRUE)`);

    await client.query(`UPDATE dsp_imports SET order_count = $2, work_count = $3, summary = $4::jsonb WHERE id = $1`, [importId, orders.size, summary.workDerived + summary.workUpdated, JSON.stringify(summary)]);
    // keep the last N raw payloads
    await client.query(`DELETE FROM dsp_imports WHERE id NOT IN (SELECT id FROM dsp_imports ORDER BY id DESC LIMIT $1)`, [Number(cfg.raw_imports_kept) || 3]);
    await client.query("COMMIT");
    return { importId, orders: orders.size, rows: rows.length, ...summary };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// One transaction → DELIVERY and/or INSTALL headers, with revenue, duration
// standards, points and requirements. Human fields on an existing header
// (readiness set by a person, mobility, override, notes) are preserved.
async function deriveWorkForTransaction(client, cfg, { invoice, baseInvoice, dept, h, locId, projId, lines }) {
  const out = { created: 0, updated: 0, warnings: 0 };
  const byType = { DELIVERY: [], INSTALL: [] };
  const notes = [];
  for (const l of lines) {
    // free-text note lines become dispatch notes; coded policy text (*1.24 etc.) does not
    if (l.cls === "NOTE") { if (!l.model && l.description && !/^[-_*\s]+$/.test(l.description)) notes.push(l.description); continue; }
    const target = cfg.revenue_rules[l.cls] || l.workType || "";
    if (target && byType[target]) byType[target].push(l);
    else if (l.cls !== "UNCLASSIFIED") byType.DELIVERY.push(l);
  }
  const loc = (await client.query(`SELECT extra_minutes, modifiers, lat, lng FROM dsp_service_location WHERE id = $1`, [locId])).rows[0] || {};
  const status = h["Job Status"] || "";
  const readinessFromSource = cfg.status_map.completed.includes(status) ? "completed" : cfg.status_map.scheduled.includes(status) ? "scheduled" : cfg.status_map.ready.includes(status) ? "ready" : "not_ready";
  const requestedDate = usDate(h["Delivery Date"]);
  const qualCaps = String(h["Qualifications"] || "").split(",").map((q) => cfg.capability_rules.qualificationCapabilities[q.trim()]).filter(Boolean);
  const created = {};

  for (const type of ["DELIVERY", "INSTALL"]) {
    const wl = byType[type];
    const workKey = `${invoice}|${type}`;
    if (!wl.length) { await client.query(`UPDATE dsp_work SET active = FALSE, updated_at = NOW() WHERE work_key = $1`, [workKey]); continue; }
    const warnings = [];
    const breakdown = { components: [] };
    let minutes = 0, revenue = 0, pointsOut = 0, pointsReturn = 0;
    const caps = new Set(qualCaps);
    let minPeople = cfg.departments[dept]?.defaultCrew || 2;

    if (type === "DELIVERY") {
      const delLine = wl.find((l) => l.cls === "DELIVERY");
      const dt = delLine ? (cfg.delivery_types[delLine.model.toUpperCase()] || cfg.delivery_types.default) : cfg.delivery_types.default;
      minutes += dt.minutes; breakdown.components.push({ label: delLine ? `${dt.label || delLine.model} base` : "Delivery base (no delivery line)", minutes: dt.minutes });
      if (!delLine && wl.some((l) => l.cls === "PRODUCT")) warnings.push("Products with no delivery service line — base time assumed");
      for (const l of wl) {
        if (l.cls === "PRODUCT") {
          const std = longestPrefixMatch(cfg.product_standards, l.productCode) || cfg.product_standards.default;
          const q = Math.max(1, Math.abs(l.qty));
          const m = (l.sourceMinutes > 0 ? l.sourceMinutes : std.minutes) * q;
          minutes += m; breakdown.components.push({ label: `${l.productCode || "product"} ${l.model}`.trim(), minutes: m, source: l.sourceMinutes > 0 ? "export" : "standard" });
          pointsOut += (l.sourcePoints > 0 ? l.sourcePoints : std.points) * q;
          if (cfg.capability_rules.proProductCodes.some((p) => l.productCode.startsWith(p))) { caps.add("PRO_APPLIANCE"); minPeople = Math.max(minPeople, (cfg.departments[dept]?.defaultCrew || 2) + (cfg.capability_rules.proExtraPeople || 0)); }
          if (!l.productCode) warnings.push(`Line "${l.description.slice(0, 40)}" has no product code — handling time and points are defaults`);
        } else if (l.cls === "HAULAWAY") {
          pointsReturn += 2 * Math.max(1, Math.abs(l.qty)); breakdown.components.push({ label: `Haul-away ${l.description.slice(0, 30)}`, minutes: 10 }); minutes += 10;
        } else if (l.cls === "ACCESS") {
          const m = cfg.install_standards[l.model.toUpperCase()] || cfg.install_standards.STAIR || 20;
          minutes += m; breakdown.components.push({ label: l.description.slice(0, 40), minutes: m });
        }
        if (l.flag) warnings.push(l.flag);
        if (["PRODUCT", "ACCESSORY", "DELIVERY", "HAULAWAY", "ACCESS", "FREIGHT", "DISCOUNT", "PLAN", "FEE"].includes(l.cls)) revenue += l.ext;
      }
      pointsReturn += r2(pointsOut * (Number(cfg.packaging_factor) || 0));
      caps.add("APPLIANCE_DELIVERY");
    } else {
      for (const l of wl) {
        const code = l.model.toUpperCase().replace(/-F$/, "");
        const m = cfg.install_standards[code] ?? cfg.install_standards.default;
        const q = Math.max(1, Math.abs(l.qty));
        minutes += m * q; breakdown.components.push({ label: `${l.model} ${l.description.slice(0, 36)}`.trim(), minutes: m * q, source: cfg.install_standards[code] != null ? "standard" : "default" });
        if (cfg.install_standards[code] == null) warnings.push(`No install standard for ${l.model} — default minutes used`);
        if (cfg.capability_rules.specialtyInstallModels.includes(code)) caps.add("SPECIALTY_INSTALL"); else caps.add("INSTALL");
        if (l.flag) warnings.push(l.flag);
        revenue += l.ext;
      }
    }
    if (loc.extra_minutes) { minutes += loc.extra_minutes; breakdown.components.push({ label: "Location access modifier", minutes: loc.extra_minutes }); }
    if (!loc.lat || !loc.lng) warnings.push("Service location has no coordinates");
    if (!requestedDate) warnings.push("No delivery date on the order");
    const unclassified = lines.filter((l) => l.cls === "UNCLASSIFIED");
    if (type === "DELIVERY" && unclassified.length) warnings.push(`${unclassified.length} line${unclassified.length === 1 ? "" : "s"} not classified: ${unclassified.map((l) => l.model || l.description.slice(0, 20)).join(", ")}`);
    breakdown.total = minutes;
    const requirements = { capabilities: [...caps], minPeople, driverRequired: true, vehicleClass: type === "DELIVERY" ? "BOX_TRUCK" : "" };
    out.warnings += warnings.length;

    const existing = (await client.query(`SELECT id, readiness, readiness_by, source_status FROM dsp_work WHERE work_key = $1`, [workKey])).rows[0];
    const id = existing?.id || crypto.randomUUID();
    if (!existing) {
      await client.query(
        `INSERT INTO dsp_work (id, work_key, invoice, base_invoice, department, work_type, service_location_id, project_id, customer_name, requested_date, scheduled_date, source_status, readiness, mobility, revenue, estimated_minutes, duration_breakdown, points_out, points_return, requirements, warnings, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20::jsonb,$21::jsonb,$22)`,
        [id, workKey, invoice, baseInvoice, dept, type, locId, projId, h["Ship Name"], requestedDate, readinessFromSource === "scheduled" || readinessFromSource === "completed" ? requestedDate : null, status, readinessFromSource,
          readinessFromSource === "completed" ? "COMMITTED" : readinessFromSource === "scheduled" ? "COMMITTED" : "FLEXIBLE",
          r2(revenue), Math.round(minutes), JSON.stringify(breakdown), r2(pointsOut), r2(pointsReturn), JSON.stringify(requirements), JSON.stringify(warnings), notes.join("\n").slice(0, 4000)]
      );
      out.created++;
    } else {
      // readiness follows the source unless a person set it since
      const readiness = existing.readiness_by ? existing.readiness : readinessFromSource;
      if (existing.source_status !== status) {
        await client.query(`INSERT INTO dsp_work_status_history (work_id, field, prior_value, new_value, changed_by) VALUES ($1, 'source_status', $2, $3, 'import')`, [id, existing.source_status, status]);
      }
      await client.query(
        `UPDATE dsp_work SET service_location_id=$2, project_id=$3, customer_name=$4, requested_date=$5, scheduled_date=CASE WHEN $6 IN ('scheduled','completed') THEN COALESCE(scheduled_date, $5) ELSE scheduled_date END,
           source_status=$7, readiness=$8, revenue=$9, estimated_minutes=$10, duration_breakdown=$11::jsonb, points_out=$12, points_return=$13, requirements=$14::jsonb, warnings=$15::jsonb,
           notes = CASE WHEN notes = '' THEN $16 ELSE notes END, active=TRUE, updated_at=NOW()
         WHERE id = $1`,
        [id, locId, projId, h["Ship Name"], requestedDate, readinessFromSource, status, readiness, r2(revenue), Math.round(minutes), JSON.stringify(breakdown), r2(pointsOut), r2(pointsReturn), JSON.stringify(requirements), JSON.stringify(warnings), notes.join("\n").slice(0, 4000)]
      );
      out.updated++;
    }
    await client.query(`DELETE FROM dsp_work_line WHERE work_id = $1`, [id]);
    for (const l of wl) await client.query(`INSERT INTO dsp_work_line (work_id, line_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, l.id]);
    created[type] = id;
  }
  // relationships
  if (created.DELIVERY && created.INSTALL) {
    await client.query(`INSERT INTO dsp_work_relationship (work_id, related_work_id, relationship_type) VALUES ($1, $2, 'INSTALL_FOR'), ($1, $2, 'SAME_INVOICE') ON CONFLICT DO NOTHING`, [created.INSTALL, created.DELIVERY]);
  }
  if (baseInvoice !== invoice) {
    const parents = (await client.query(`SELECT id FROM dsp_work WHERE invoice = $1`, [baseInvoice])).rows;
    for (const t of Object.values(created)) for (const p of parents) await client.query(`INSERT INTO dsp_work_relationship (work_id, related_work_id, relationship_type) VALUES ($1, $2, 'SPLIT_FROM') ON CONFLICT DO NOTHING`, [t, p.id]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
function mapWork(r) {
  return {
    id: r.id, workKey: r.work_key, invoice: r.invoice, baseInvoice: r.base_invoice, department: r.department, workType: r.work_type,
    serviceLocationId: r.service_location_id, projectId: r.project_id, customerName: r.customer_name,
    requestedDate: r.requested_date ? r.requested_date.toISOString().slice(0, 10) : null, scheduledDate: r.scheduled_date ? r.scheduled_date.toISOString().slice(0, 10) : null,
    sourceStatus: r.source_status, readiness: r.readiness, readinessBy: r.readiness_by, mobility: r.mobility,
    revenue: Number(r.revenue) || 0, estimatedMinutes: r.estimated_minutes, durationBreakdown: r.duration_breakdown, snapshotMinutes: r.snapshot_minutes,
    overrideMinutes: r.override_minutes, overrideReason: r.override_reason, overrideBy: r.override_by, overrideAt: r.override_at?.toISOString?.() || null,
    effectiveMinutes: r.override_minutes != null ? r.override_minutes : r.estimated_minutes,
    pointsOut: Number(r.points_out) || 0, pointsReturn: Number(r.points_return) || 0, requirements: r.requirements, warnings: r.warnings, notes: r.notes, active: r.active,
    location: r.address1 != null ? { address1: r.address1, address2: r.address2, city: r.city, zip: r.zip, lat: r.lat, lng: r.lng, mapZone: r.map_zone, extraMinutes: r.extra_minutes, modifiers: r.modifiers } : undefined,
    transaction: r.job_status != null ? { jobStatus: r.job_status, truck: r.truck_code, priorities: r.priorities, qualifications: r.qualifications, comment1: r.comment1, salesperson: r.salesperson, phone1: r.phone1, email: r.email, balance: Number(r.balance) || 0, billName: r.bill_name } : undefined,
    updatedAt: r.updated_at?.toISOString?.() || null
  };
}
const WORK_SELECT = `
  SELECT w.*, l.address1, l.address2, l.city, l.zip, l.lat, l.lng, l.map_zone, l.extra_minutes, l.modifiers,
         t.job_status, t.truck_code, t.priorities, t.qualifications, t.comment1, t.salesperson, t.phone1, t.email, t.balance, t.bill_name
    FROM dsp_work w
    LEFT JOIN dsp_service_location l ON l.id = w.service_location_id
    LEFT JOIN dsp_transaction t ON t.invoice = w.invoice`;

export async function listDispatchWork({ from = null, to = null, department = "", workType = "", readiness = "", search = "", includeInactive = false, limit = 2000 } = {}) {
  const pool = await getReadyPool();
  const where = [], params = [];
  if (!includeInactive) where.push("w.active");
  if (from) { params.push(from); where.push(`w.requested_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`w.requested_date <= $${params.length}`); }
  if (department) { params.push(department); where.push(`w.department = $${params.length}`); }
  if (workType) { params.push(workType); where.push(`w.work_type = $${params.length}`); }
  if (readiness) { params.push(readiness); where.push(`w.readiness = $${params.length}`); }
  if (search) { params.push(`%${search.toUpperCase()}%`); where.push(`(UPPER(w.invoice) LIKE $${params.length} OR UPPER(w.customer_name) LIKE $${params.length} OR UPPER(l.address1) LIKE $${params.length})`); }
  params.push(limit);
  const r = await pool.query(`${WORK_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY w.requested_date NULLS LAST, w.invoice, w.work_type LIMIT $${params.length}`, params);
  return r.rows.map(mapWork);
}

export async function getDispatchWork(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const r = await pool.query(`${WORK_SELECT} WHERE w.id = $1`, [id]);
  if (!r.rows[0]) return null;
  const work = mapWork(r.rows[0]);
  const [lines, rel, hist, sameLoc] = await Promise.all([
    pool.query(`SELECT li.* FROM dsp_work_line wl JOIN dsp_line li ON li.id = wl.line_id WHERE wl.work_id = $1 ORDER BY li.line_no`, [id]),
    pool.query(`SELECT r.relationship_type, r.related_work_id, w2.work_type, w2.invoice, w2.requested_date, w2.readiness FROM dsp_work_relationship r JOIN dsp_work w2 ON w2.id = r.related_work_id WHERE r.work_id = $1
                UNION ALL SELECT r.relationship_type || ' (inverse)', r.work_id, w2.work_type, w2.invoice, w2.requested_date, w2.readiness FROM dsp_work_relationship r JOIN dsp_work w2 ON w2.id = r.work_id WHERE r.related_work_id = $1`, [id]),
    pool.query(`SELECT * FROM dsp_work_status_history WHERE work_id = $1 ORDER BY changed_at DESC LIMIT 50`, [id]),
    pool.query(`SELECT id, invoice, work_type, requested_date, readiness, estimated_minutes, revenue FROM dsp_work WHERE active AND service_location_id = $1 AND id <> $2 ORDER BY requested_date NULLS LAST`, [work.serviceLocationId, id])
  ]);
  const allLines = await pool.query(`SELECT * FROM dsp_line WHERE invoice = $1 ORDER BY line_no`, [work.invoice]);
  const mapLine = (x) => ({ id: x.id, lineNo: x.line_no, model: x.model, description: x.description, qty: Number(x.qty), amount: Number(x.amount), ext: Number(x.ext), productCode: x.product_code, color: x.color, serial: x.serial, lineClass: x.line_class, classSource: x.class_source, workType: x.work_type, sourcePoints: x.source_points == null ? null : Number(x.source_points), sourceMinutes: x.source_minutes });
  return {
    work, lines: lines.rows.map(mapLine), invoiceLines: allLines.rows.map(mapLine),
    related: rel.rows.map((x) => ({ type: x.relationship_type, workId: x.related_work_id, workType: x.work_type, invoice: x.invoice, requestedDate: x.requested_date ? x.requested_date.toISOString().slice(0, 10) : null, readiness: x.readiness })),
    history: hist.rows.map((x) => ({ field: x.field, prior: x.prior_value, next: x.new_value, reason: x.reason, by: x.changed_by, at: x.changed_at.toISOString() })),
    sameLocation: sameLoc.rows.map((x) => ({ id: x.id, invoice: x.invoice, workType: x.work_type, requestedDate: x.requested_date ? x.requested_date.toISOString().slice(0, 10) : null, readiness: x.readiness, minutes: x.estimated_minutes, revenue: Number(x.revenue) || 0 }))
  };
}

// Human inputs: readiness assertion, mobility, duration override, notes.
export async function updateDispatchWork(id, patch, { byEmail = "" } = {}) {
  const pool = await getReadyPool();
  const cur = (await pool.query(`SELECT * FROM dsp_work WHERE id = $1`, [id])).rows[0];
  if (!cur) return null;
  const sets = [], params = [id];
  const hist = [];
  const push = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (patch.readiness && ["not_ready", "ready", "scheduled", "completed", "on_hold"].includes(patch.readiness) && patch.readiness !== cur.readiness) {
    push("readiness", patch.readiness); push("readiness_by", byEmail); hist.push(["readiness", cur.readiness, patch.readiness, patch.reason || ""]);
  }
  if (patch.mobility && ["FLEXIBLE", "PREFERRED", "COMMITTED"].includes(patch.mobility) && patch.mobility !== cur.mobility) {
    push("mobility", patch.mobility); hist.push(["mobility", cur.mobility, patch.mobility, patch.reason || ""]);
  }
  if ("overrideMinutes" in patch) {
    const v = patch.overrideMinutes === null || patch.overrideMinutes === "" ? null : Math.max(0, Math.round(Number(patch.overrideMinutes)));
    if (v !== cur.override_minutes) {
      if (v != null && !String(patch.reason || "").trim()) throw new Error("A duration override needs a reason.");
      push("override_minutes", v); push("override_reason", v == null ? "" : String(patch.reason).slice(0, 300)); push("override_by", v == null ? "" : byEmail); sets.push(v == null ? "override_at = NULL" : "override_at = NOW()");
      hist.push(["override_minutes", cur.override_minutes == null ? "" : String(cur.override_minutes), v == null ? "" : String(v), patch.reason || ""]);
    }
  }
  if ("scheduledDate" in patch) {
    const v = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.scheduledDate || "")) ? patch.scheduledDate : null;
    const curV = cur.scheduled_date ? cur.scheduled_date.toISOString().slice(0, 10) : null;
    if (v !== curV) { push("scheduled_date", v); hist.push(["scheduled_date", curV || "", v || "", patch.reason || ""]); }
  }
  if ("notes" in patch) push("notes", String(patch.notes || "").slice(0, 4000));
  if (!sets.length) return getDispatchWork(id);
  sets.push("updated_at = NOW()");
  await pool.query(`UPDATE dsp_work SET ${sets.join(", ")} WHERE id = $1`, params);
  for (const [f, p, n, reason] of hist) await pool.query(`INSERT INTO dsp_work_status_history (work_id, field, prior_value, new_value, reason, changed_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, f, p, n, String(reason).slice(0, 300), byEmail.slice(0, 200)]);
  return getDispatchWork(id);
}

// Service-location modifiers persist across future visits (§9.5).
export async function updateServiceLocation(id, { extraMinutes, modifiers, notes }, { byEmail = "" } = {}) {
  const pool = await getReadyPool();
  const sets = [], params = [id];
  if (extraMinutes != null) { params.push(Math.max(0, Math.round(Number(extraMinutes) || 0))); sets.push(`extra_minutes = $${params.length}`); }
  if (Array.isArray(modifiers)) { params.push(JSON.stringify(modifiers.map((m) => String(m).slice(0, 60)).slice(0, 20))); sets.push(`modifiers = $${params.length}::jsonb`); }
  if (notes != null) { params.push(String(notes).slice(0, 2000)); sets.push(`notes = $${params.length}`); }
  if (!sets.length) return null;
  sets.push("updated_at = NOW()");
  await pool.query(`UPDATE dsp_service_location SET ${sets.join(", ")} WHERE id = $1`, params);
  // re-derive the duration of active work at this location so the modifier shows immediately
  const works = await pool.query(`SELECT id, duration_breakdown, estimated_minutes FROM dsp_work WHERE active AND service_location_id = $1`, [id]);
  const loc = (await pool.query(`SELECT extra_minutes FROM dsp_service_location WHERE id = $1`, [id])).rows[0];
  for (const w of works.rows) {
    const bd = w.duration_breakdown || { components: [] };
    const comps = (bd.components || []).filter((c) => c.label !== "Location access modifier");
    if (loc.extra_minutes) comps.push({ label: "Location access modifier", minutes: loc.extra_minutes });
    const total = comps.reduce((s, c) => s + (Number(c.minutes) || 0), 0);
    await pool.query(`UPDATE dsp_work SET duration_breakdown = $2::jsonb, estimated_minutes = $3, updated_at = NOW() WHERE id = $1`, [w.id, JSON.stringify({ ...bd, components: comps, total }), total]);
  }
  return true;
}

// Day / department roll-up (§33) for the demand picture.
export async function dispatchSummary({ from, to }) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT w.requested_date, w.department, w.work_type, w.readiness,
            COUNT(*)::int AS n, SUM(w.revenue)::numeric(14,2) AS revenue, SUM(COALESCE(w.override_minutes, w.estimated_minutes))::int AS minutes,
            SUM(w.points_out)::numeric(10,2) AS points_out, COUNT(DISTINCT w.service_location_id)::int AS locations,
            COUNT(*) FILTER (WHERE jsonb_array_length(w.warnings) > 0)::int AS with_warnings
       FROM dsp_work w WHERE w.active AND w.requested_date BETWEEN $1 AND $2
      GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`, [from, to]);
  const consolidation = await pool.query(
    `SELECT w.requested_date, COUNT(DISTINCT w.service_location_id)::int AS locations, COUNT(DISTINCT w.invoice)::int AS invoices,
            COUNT(*) FILTER (WHERE w.work_type = 'INSTALL' AND EXISTS (SELECT 1 FROM dsp_work d WHERE d.active AND d.work_type = 'DELIVERY' AND d.invoice = w.invoice AND d.requested_date = w.requested_date))::int AS install_with_delivery_same_day,
            COUNT(*) FILTER (WHERE w.work_type = 'INSTALL')::int AS installs
       FROM dsp_work w WHERE w.active AND w.requested_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [from, to]);
  const imports = await pool.query(`SELECT id, source, filename, uploaded_by, row_count, order_count, work_count, summary, created_at FROM dsp_imports ORDER BY id DESC LIMIT 5`);
  return {
    rows: r.rows.map((x) => ({ date: x.requested_date ? x.requested_date.toISOString().slice(0, 10) : null, department: x.department, workType: x.work_type, readiness: x.readiness, count: x.n, revenue: Number(x.revenue) || 0, minutes: x.minutes || 0, pointsOut: Number(x.points_out) || 0, locations: x.locations, withWarnings: x.with_warnings })),
    consolidation: consolidation.rows.map((x) => ({ date: x.requested_date.toISOString().slice(0, 10), locations: x.locations, invoices: x.invoices, installs: x.installs, installWithDeliverySameDay: x.install_with_delivery_same_day })),
    imports: imports.rows.map((x) => ({ id: x.id, source: x.source, filename: x.filename, uploadedBy: x.uploaded_by, rows: x.row_count, orders: x.order_count, work: x.work_count, summary: x.summary, at: x.created_at.toISOString() }))
  };
}

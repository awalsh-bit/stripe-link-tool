import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// SPEED QUEEN TRUCKLOAD BUILDER (Andrew, 2026-09-16) — the "SQ TL Template"
// workbook, live. The spreadsheet's four tabs map to:
//   ORDER SHEET   → sq_tl_models (catalog: family, note, kind, TL cost, cash
//                   program) + sq_tl_orders (the ORDER WORKSHEET quantities)
//   TL PRICING    → sq_tl_models.tl_cost (FTL 126 column)
//   Performance   → computed: trailing-twelve-month unit sales per model from
//                   sales_order_lines (the Sales Order Detail warehouse),
//                   with alias models folded in (TR7003WN counts into TR7006WN)
//   PASTE EPASS INVENTORY HERE → QOH computed from the serial inventory
//                   snapshot (the ExportModel feed the agent already pushes);
//                   QOO kept per model (typed, or filled from a Model
//                   Maintenance export upload — on-order units have no serial)
// Stock plan = ROUNDUP(TTM × months / 12). Forecast = plan − QOH − QOO.
// Truck: 126 units; stacked laundry centers count as 2. All tunable.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sq_tl_models (
  model TEXT PRIMARY KEY,
  family TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'washer',
  tl_cost NUMERIC(10,2),
  regular_cost NUMERIC(10,2),
  cash_qty INT,
  cash_dollars NUMERIC(10,2),
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  qoo INT NOT NULL DEFAULT 0,
  qoo_note TEXT NOT NULL DEFAULT '',
  sort INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sq_tl_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sq_tl_orders (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  lines JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  snapshot JSONB
);
`;

export const SQ_KINDS = ["washer", "dryer", "stacked", "pedestal", "accessory"];
export const DEFAULT_SETTINGS = { stock_plan_months: 6, truck_units: 126, ttm_months: 12 };

// The template's ORDER SHEET + TL PRICING, as shipped. Seeded once when the
// catalog is empty; from then on the page's catalog editor owns it.
export const SEED_MODELS = [
  // CLASSIC WASH
  ["CLASSIC WASH", "WHITE", "TC5003WN", "washer", 1021, 14, 50],
  ["CLASSIC WASH", "WHITE ELEC", "DC5004WE", "dryer", 1021],
  ["CLASSIC WASH", "WHITE GAS", "DC5004WG", "dryer", 1089],
  ["CLASSIC WASH", "BLACK", "TC5003BN", "washer", 1089],
  ["CLASSIC WASH", "BLACK ELEC", "DC5004BE", "dryer", 1089],
  ["CLASSIC WASH", "BLACK GAS", "DC5004BG", "dryer", 1157],
  // PERFECT WASH 7
  ["PERFECT WASH 7", "WHITE", "TR7006WN", "washer", 1021, 21, 140, ["TR7003WN"]],
  ["PERFECT WASH 7", "WHITE ELEC", "DR7004WE", "dryer", 1021],
  ["PERFECT WASH 7", "WHITE GAS", "DR7004WG", "dryer", 1089],
  ["PERFECT WASH 7", "BLACK", "TR7006BN", "washer", 1089, null, null, ["TR7003BN"]],
  ["PERFECT WASH 7", "BLACK ELEC", "DR7004BE", "dryer", 1089, 4, 40],
  ["PERFECT WASH 7", "BLACK GAS", "DR7004BG", "dryer", 1157],
  // PERFECT WASH 5
  ["PERFECT WASH 5", "WHITE", "TR5006WN", "washer", 953, null, null, ["TR5003WN"]],
  ["PERFECT WASH 5", "WHITE ELEC", "DR5004WE", "dryer", 953],
  ["PERFECT WASH 5", "WHITE GAS", "DR5004WG", "dryer", 1021],
  // PERFECT WASH 3
  ["PERFECT WASH 3", "WHITE", "TR3006WN", "washer", 885, null, null, ["TR3003WN"]],
  ["PERFECT WASH 3", "WHITE ELEC", "DR3004WE", "dryer", 885],
  ["PERFECT WASH 3", "WHITE GAS", "DR3004WG", "dryer", 953],
  // LAUNDRY CENTER (counts as 2 truck units)
  ["LAUNDRY CENTER", "WHITE ELEC", "SF7008WE", "stacked", 2995, 4, 100, ["SF7007WE"]],
  ["LAUNDRY CENTER", "BLACK ELEC", "SF7008BE", "stacked", 3132, null, null, ["SF7007BE"]],
  ["LAUNDRY CENTER", "BLACK GAS", "SF7008BG", "stacked", 3200, null, null, ["SF7007BG"]],
  ["LAUNDRY CENTER", "WHITE GAS", "SF7008WG", "stacked", 3064, null, null, ["SF7007WG"]],
  // FRONT LOAD
  ["FRONT LOAD", "WHITE LH", "FF7011WN", "washer", 1497, 8, 100, ["FF7009WN"]],
  ["FRONT LOAD", "WHITE RH", "FF7012WN", "washer", 1497, null, null, ["FF7010WN"]],
  ["FRONT LOAD", "WHITE ELEC", "DF7004WE", "dryer", 1497],
  ["FRONT LOAD", "WHITE GAS", "DF7004WG", "dryer", 1565],
  ["FRONT LOAD", "BLACK LH", "FF7011BN", "washer", 1565, null, null, ["FF7009BN"]],
  ["FRONT LOAD", "BLACK RH", "FF7012BN", "washer", 1565, 1, 40, ["FF7010BN"]],
  ["FRONT LOAD", "BLACK ELEC", "DF7004BE", "dryer", 1565],
  ["FRONT LOAD", "BLACK GAS", "DF7004BG", "dryer", 1634],
  // ACCESSORIES
  ["ACCESSORIES", "PED BLACK", "PDR108MB", "pedestal", 168],
  ["ACCESSORIES", "PED WHITE", "PDR108W", "pedestal", 189],
  ["ACCESSORIES", "SIDE VENT KIT", "528P3", "accessory", null],
  ["ACCESSORIES", "LP CONV KIT", "649P3", "accessory", null]
];

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).then(() => seedIfEmpty(pool));
  await ensurePromise;
  return pool;
}

async function seedIfEmpty(pool) {
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM sq_tl_models`)).rows[0].n;
  if (n) return;
  let sort = 0;
  for (const [family, note, model, kind, tlCost, cashQty, cashDollars, aliases] of SEED_MODELS) {
    await pool.query(
      `INSERT INTO sq_tl_models (model, family, note, kind, tl_cost, cash_qty, cash_dollars, aliases, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT (model) DO NOTHING`,
      [model, family, note, kind, tlCost ?? null, cashQty ?? null, cashDollars ?? null, JSON.stringify(aliases || []), sort++]
    );
  }
}

export const normModel = (v) => String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

export async function getSqSettings() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT key, value FROM sq_tl_settings`);
  const out = { ...DEFAULT_SETTINGS };
  for (const row of r.rows) out[row.key] = row.value;
  return out;
}
export async function setSqSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) throw new Error(`Unknown setting ${key}`);
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} must be a positive number.`);
  const pool = await getReadyPool();
  await pool.query(`INSERT INTO sq_tl_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(n)]);
  return { [key]: n };
}

function mapModel(row) {
  return {
    model: row.model, family: row.family, note: row.note, kind: row.kind,
    tlCost: row.tl_cost == null ? null : Number(row.tl_cost),
    regularCost: row.regular_cost == null ? null : Number(row.regular_cost),
    cashQty: row.cash_qty == null ? null : Number(row.cash_qty),
    cashDollars: row.cash_dollars == null ? null : Number(row.cash_dollars),
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    qoo: Number(row.qoo) || 0, qooNote: row.qoo_note || "",
    sort: Number(row.sort) || 0, active: row.active !== false
  };
}

export async function listSqModels({ includeInactive = false } = {}) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM sq_tl_models ${includeInactive ? "" : "WHERE active"} ORDER BY sort, model`);
  return r.rows.map(mapModel);
}

// Catalog editor (executives): upsert one model row. Unknown fields ignored.
export async function upsertSqModel(input) {
  const pool = await getReadyPool();
  const model = normModel(input.model);
  if (!model) throw new Error("Model number is required.");
  const kind = SQ_KINDS.includes(String(input.kind || "")) ? String(input.kind) : "washer";
  const num = (v) => (v === "" || v == null ? null : (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null));
  const int = (v) => (v === "" || v == null ? null : (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null));
  const aliases = (Array.isArray(input.aliases) ? input.aliases : String(input.aliases || "").split(/[,\s]+/)).map(normModel).filter((a) => a && a !== model);
  const existing = (await pool.query(`SELECT sort FROM sq_tl_models WHERE model = $1`, [model])).rows[0];
  const sort = input.sort != null && Number.isFinite(Number(input.sort)) ? Number(input.sort) : existing ? existing.sort : ((await pool.query(`SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM sq_tl_models`)).rows[0].s);
  const r = await pool.query(
    `INSERT INTO sq_tl_models (model, family, note, kind, tl_cost, regular_cost, cash_qty, cash_dollars, aliases, sort, active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,NOW())
     ON CONFLICT (model) DO UPDATE SET family = EXCLUDED.family, note = EXCLUDED.note, kind = EXCLUDED.kind, tl_cost = EXCLUDED.tl_cost, regular_cost = EXCLUDED.regular_cost,
       cash_qty = EXCLUDED.cash_qty, cash_dollars = EXCLUDED.cash_dollars, aliases = EXCLUDED.aliases, sort = EXCLUDED.sort, active = EXCLUDED.active, updated_at = NOW()
     RETURNING *`,
    [model, String(input.family || "").trim().toUpperCase().slice(0, 40), String(input.note || "").trim().toUpperCase().slice(0, 40), kind,
     num(input.tlCost), num(input.regularCost), int(input.cashQty), num(input.cashDollars), JSON.stringify(aliases), sort, input.active !== false]
  );
  return mapModel(r.rows[0]);
}

export async function setSqQoo(model, qoo, note = "") {
  const pool = await getReadyPool();
  const n = Math.max(0, Math.round(Number(qoo) || 0));
  const r = await pool.query(`UPDATE sq_tl_models SET qoo = $2, qoo_note = $3, updated_at = NOW() WHERE model = $1 RETURNING model, qoo`, [normModel(model), n, String(note || "").slice(0, 120)]);
  if (!r.rows[0]) throw new Error("Model not in the catalog.");
  return { model: r.rows[0].model, qoo: Number(r.rows[0].qoo) };
}

// Model Maintenance export (the "PASTE EPASS INVENTORY HERE" tab): rows
// [* Model, Main, Loc, N/A, QOO, Written, ...]. Fills QOO for catalog models.
export async function applyModelMaintenanceQoo(rows, sourceFile = "") {
  const pool = await getReadyPool();
  const models = new Set((await pool.query(`SELECT model FROM sq_tl_models`)).rows.map((r) => r.model));
  let updated = 0;
  for (const r of rows) {
    const model = normModel(r.model);
    if (!models.has(model)) continue;
    const qoo = Math.max(0, Math.round(Number(r.qoo) || 0));
    await pool.query(`UPDATE sq_tl_models SET qoo = $2, qoo_note = $3, updated_at = NOW() WHERE model = $1`, [model, qoo, `from ${String(sourceFile || "Model Maintenance").slice(0, 100)}`]);
    updated++;
  }
  return { updated };
}

// ---- live inputs ----------------------------------------------------------
// TTM unit sales per model from the warehouse. source_month is YYYY-MM; the
// trailing window is the last N months INCLUDING the latest uploaded month.
export async function sqSalesByModel(modelKeys, { ttmMonths = 12 } = {}) {
  const pool = await getReadyPool();
  const out = {};
  try {
    const latest = (await pool.query(`SELECT MAX(source_month) AS m FROM sales_order_lines`)).rows[0]?.m;
    if (!latest) return { byModel: out, latestMonth: null, windowFrom: null };
    const [y, m] = latest.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 - (ttmMonths - 1), 1));
    const from = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const thisYear = String(new Date().getUTCFullYear());
    const lastYear = String(new Date().getUTCFullYear() - 1);
    const r = await pool.query(
      `SELECT upper(regexp_replace(product, '[^0-9A-Za-z]', '', 'g')) AS key,
              SUM(qty) FILTER (WHERE source_month >= $1) AS ttm,
              SUM(qty) FILTER (WHERE source_month LIKE $2 || '-%') AS last_year,
              SUM(qty) FILTER (WHERE source_month LIKE $3 || '-%') AS this_year
       FROM sales_order_lines
       WHERE upper(regexp_replace(product, '[^0-9A-Za-z]', '', 'g')) = ANY($4)
       GROUP BY 1`,
      [from, lastYear, thisYear, modelKeys]
    );
    for (const row of r.rows) out[row.key] = { ttm: Number(row.ttm) || 0, lastYear: Number(row.last_year) || 0, thisYear: Number(row.this_year) || 0 };
    return { byModel: out, latestMonth: latest, windowFrom: from, lastYear, thisYear };
  } catch (e) {
    return { byModel: out, latestMonth: null, windowFrom: null, error: e.message };
  }
}

// QOH per model from the serial inventory snapshot: every unit in the
// snapshot is on hand; "written" units are committed to a ticket.
export async function sqInventoryByModel(modelKeys) {
  const pool = await getReadyPool();
  const out = {};
  try {
    const r = await pool.query(`SELECT serial_units, uploaded_at, source_file FROM shop_inventory_snapshot WHERE id = 1`);
    const row = r.rows[0];
    if (!row) return { byModel: out, uploadedAt: null };
    const want = new Set(modelKeys);
    for (const u of row.serial_units || []) {
      const key = normModel(u.model) || normModel(u.sku);
      if (!want.has(key)) continue;
      const o = (out[key] ||= { qoh: 0, written: 0, cost: 0, oldest: "" });
      o.qoh += 1;
      if (u.writtenTo) o.written += 1;
      if (u.cost) o.cost += Number(u.cost) || 0;
      if (u.received && (!o.oldest || u.received < o.oldest)) o.oldest = u.received;
    }
    return { byModel: out, uploadedAt: row.uploaded_at?.toISOString?.() || null, sourceFile: row.source_file || "" };
  } catch (e) {
    return { byModel: out, uploadedAt: null, error: e.message };
  }
}

// ---- orders ----------------------------------------------------------------
export async function getCurrentSqOrder() {
  const pool = await getReadyPool();
  let r = await pool.query(`SELECT * FROM sq_tl_orders WHERE status = 'draft' ORDER BY updated_at DESC LIMIT 1`);
  if (!r.rows[0]) {
    r = await pool.query(`INSERT INTO sq_tl_orders (name, status, lines) VALUES ($1, 'draft', '{}'::jsonb) RETURNING *`, [`Truckload ${new Date().toISOString().slice(0, 10)}`]);
  }
  return mapOrder(r.rows[0]);
}
function mapOrder(row) {
  return { id: Number(row.id), name: row.name, status: row.status, lines: row.lines || {}, notes: row.notes || "", createdBy: row.created_by, createdAt: row.created_at?.toISOString?.() || null, updatedBy: row.updated_by, updatedAt: row.updated_at?.toISOString?.() || null, submittedAt: row.submitted_at?.toISOString?.() || null, snapshot: row.snapshot || null };
}
export async function setSqOrderLines(id, lines, byEmail = "") {
  const pool = await getReadyPool();
  const clean = {};
  for (const [k, v] of Object.entries(lines || {})) {
    const model = normModel(k); const n = Math.max(0, Math.round(Number(v) || 0));
    if (model && n > 0) clean[model] = n;
  }
  const r = await pool.query(`UPDATE sq_tl_orders SET lines = $2::jsonb, updated_by = $3, updated_at = NOW() WHERE id = $1 AND status = 'draft' RETURNING *`, [id, JSON.stringify(clean), byEmail]);
  if (!r.rows[0]) throw new Error("That order isn't an open draft.");
  return mapOrder(r.rows[0]);
}
export async function patchSqOrder(id, { name, notes }, byEmail = "") {
  const pool = await getReadyPool();
  const r = await pool.query(`UPDATE sq_tl_orders SET name = COALESCE($2, name), notes = COALESCE($3, notes), updated_by = $4, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, name == null ? null : String(name).slice(0, 120), notes == null ? null : String(notes).slice(0, 2000), byEmail]);
  if (!r.rows[0]) throw new Error("Order not found.");
  return mapOrder(r.rows[0]);
}
// Submitting freezes the board as it stood (so the history reads the same
// next year) and opens a fresh draft.
export async function submitSqOrder(id, snapshot, byEmail = "") {
  const pool = await getReadyPool();
  const r = await pool.query(`UPDATE sq_tl_orders SET status = 'submitted', submitted_at = NOW(), snapshot = $2::jsonb, updated_by = $3, updated_at = NOW() WHERE id = $1 AND status = 'draft' RETURNING *`, [id, JSON.stringify(snapshot || {}), byEmail]);
  if (!r.rows[0]) throw new Error("That order isn't an open draft.");
  return mapOrder(r.rows[0]);
}
export async function listSqOrders(limit = 24) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT id, name, status, lines, notes, created_by, created_at, updated_by, updated_at, submitted_at, snapshot->'totals' AS totals FROM sq_tl_orders ORDER BY COALESCE(submitted_at, updated_at) DESC LIMIT $1`, [limit]);
  return r.rows.map((row) => ({ ...mapOrder(row), totals: row.totals || null }));
}
export async function getSqOrder(id) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM sq_tl_orders WHERE id = $1`, [id]);
  return r.rows[0] ? mapOrder(r.rows[0]) : null;
}

// ---- the board ---------------------------------------------------------------
// Every catalog model with its live numbers and the current draft's qty.
// Pure math lives in computeSqRow so the page and tests agree.
export function computeSqRow(m, sales, inv, settings, qty) {
  const months = Number(settings.stock_plan_months) || DEFAULT_SETTINGS.stock_plan_months;
  const ttm = sales?.ttm || 0;
  const stockPlan = Math.ceil((ttm * months) / 12);
  const qoh = inv?.qoh || 0;
  const forecast = stockPlan - qoh - (m.qoo || 0);
  const q = Math.max(0, Math.round(Number(qty) || 0));
  const units = m.kind === "stacked" ? q * 2 : q;
  const lineCost = m.tlCost != null ? Math.round(m.tlCost * q * 100) / 100 : null;
  const savings = m.tlCost != null && m.regularCost != null ? Math.round((m.regularCost - m.tlCost) * q * 100) / 100 : null;
  return { stockPlan, qoh, written: inv?.written || 0, oldestReceived: inv?.oldest || "", qoo: m.qoo || 0, forecast, ttm, lastYear: sales?.lastYear || 0, thisYear: sales?.thisYear || 0, qty: q, truckUnits: units, lineCost, savings };
}

export async function buildSqBoard() {
  const [settings, models, order] = await Promise.all([getSqSettings(), listSqModels({ includeInactive: true }), getCurrentSqOrder()]);
  const keys = new Set();
  for (const m of models) { keys.add(normModel(m.model)); for (const a of m.aliases) keys.add(normModel(a)); }
  const [sales, inv] = await Promise.all([sqSalesByModel([...keys], { ttmMonths: Number(settings.ttm_months) || 12 }), sqInventoryByModel([...keys])]);
  const rows = models.map((m) => {
    const all = [normModel(m.model), ...m.aliases.map(normModel)];
    const s = all.reduce((acc, k) => { const x = sales.byModel[k]; if (x) { acc.ttm += x.ttm; acc.lastYear += x.lastYear; acc.thisYear += x.thisYear; } return acc; }, { ttm: 0, lastYear: 0, thisYear: 0 });
    const i = all.reduce((acc, k) => { const x = inv.byModel[k]; if (x) { acc.qoh += x.qoh; acc.written += x.written; if (x.oldest && (!acc.oldest || x.oldest < acc.oldest)) acc.oldest = x.oldest; } return acc; }, { qoh: 0, written: 0, oldest: "" });
    return { ...m, ...computeSqRow(m, s, i, settings, order.lines[m.model]) };
  });
  const active = rows.filter((r) => r.active);
  const totals = {
    orderQty: active.reduce((a, r) => a + r.qty, 0),
    truckUnits: active.reduce((a, r) => a + r.truckUnits, 0),
    washers: active.filter((r) => r.kind === "washer" || r.kind === "stacked").reduce((a, r) => a + r.qty, 0),
    dryers: active.filter((r) => r.kind === "dryer" || r.kind === "stacked").reduce((a, r) => a + r.qty, 0),
    tlCost: Math.round(active.reduce((a, r) => a + (r.lineCost || 0), 0) * 100) / 100,
    savings: active.some((r) => r.savings != null) ? Math.round(active.reduce((a, r) => a + (r.savings || 0), 0) * 100) / 100 : null,
    stockPlanUnits: active.reduce((a, r) => a + r.stockPlan, 0),
    qoh: active.reduce((a, r) => a + r.qoh, 0),
    forecastShort: active.reduce((a, r) => a + Math.max(0, r.forecast), 0)
  };
  totals.attachRatio = totals.washers ? Math.round((totals.dryers / totals.washers) * 100) / 100 : null;
  totals.truckRemaining = (Number(settings.truck_units) || 126) - totals.truckUnits;
  totals.costPerUnitSaved = totals.savings != null && totals.truckUnits ? Math.round((totals.savings / totals.truckUnits) * 100) / 100 : null;
  return {
    settings, order: { id: order.id, name: order.name, notes: order.notes, updatedAt: order.updatedAt, updatedBy: order.updatedBy, createdAt: order.createdAt },
    rows, totals,
    sources: { sales: { latestMonth: sales.latestMonth, windowFrom: sales.windowFrom, lastYear: sales.lastYear, thisYear: sales.thisYear, error: sales.error }, inventory: { uploadedAt: inv.uploadedAt, sourceFile: inv.sourceFile, error: inv.error } },
    kinds: SQ_KINDS
  };
}

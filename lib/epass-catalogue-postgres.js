import { boardInternals } from "./service-journey-postgres.js";

// ---------------------------------------------------------------------------
// ePASS SERVICE CATALOGUE — every finished SV/WTY ticket with its parts and
// labor lines, plus the LaborRate table (the flat-rate book as ePASS holds
// it). Andrew, 2026-09-23: "customer history needs to be recreated. techs
// and office admin are constantly needing to look back on previous repairs.
// we are reading finished tickets from the odbc. use the data there" and
// "model insight - pull from previous history of similar models to show techs
// info / parts / notes from our previous repairs on similar models".
//
// Fed by the fourth agent bundle, epass-service-catalogue (see
// scripts/epass-odbc-pull.ps1): a one-time backfill in year slices, then a
// daily top-up of tickets finished in the last three weeks. Twenty years is
// ~118k tickets, ~110k part lines, ~117k labor lines (Cayden's doc 07 §1.6).
//
// What reads it: the tech field tool (customer history per stop, "read the
// last visit", Model Insight in three tiers, the component labor picker with
// ePASS's own prices), the board's history drawer, the office queues.
// ---------------------------------------------------------------------------

const { getReadyPool } = boardInternals;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS epass_service_catalogue (
  code TEXT PRIMARY KEY,
  inv_type TEXT NOT NULL DEFAULT '',
  job_status TEXT NOT NULL DEFAULT '',
  date_created DATE,
  date_finished DATE,
  tech_code TEXT NOT NULL DEFAULT '',
  sold_to_code TEXT NOT NULL DEFAULT '',
  bill_to_code TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  address1 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  model_family TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  complaint TEXT NOT NULL DEFAULT '',
  performed TEXT NOT NULL DEFAULT '',
  repair_code TEXT NOT NULL DEFAULT '',
  payment_type TEXT NOT NULL DEFAULT '',
  is_warranty BOOLEAN NOT NULL DEFAULT FALSE,
  labor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  item_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  misc_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_cust ON epass_service_catalogue (sold_to_code);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_phone ON epass_service_catalogue (phone);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_addr ON epass_service_catalogue (address1, zip);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_serial ON epass_service_catalogue (serial);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_model ON epass_service_catalogue (brand, model);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_family ON epass_service_catalogue (model_family);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_bp ON epass_service_catalogue (brand, product_code);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_fin ON epass_service_catalogue (date_finished DESC);
CREATE TABLE IF NOT EXISTS epass_service_catalogue_parts (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  item_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty NUMERIC(10,2) NOT NULL DEFAULT 0,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  warranty BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_parts_code ON epass_service_catalogue_parts (code);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_parts_item ON epass_service_catalogue_parts (item_code);
CREATE TABLE IF NOT EXISTS epass_service_catalogue_labor (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  labor_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tech_code TEXT NOT NULL DEFAULT '',
  service_date DATE,
  rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  warranty BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS epass_service_catalogue_labor_code ON epass_service_catalogue_labor (code);
CREATE TABLE IF NOT EXISTS epass_labor_rates (
  code TEXT PRIMARY KEY,
  stem TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  price NUMERIC(12,2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS epass_labor_rates_stem ON epass_labor_rates (stem);
CREATE TABLE IF NOT EXISTS epass_catalogue_meta (
  id INT PRIMARY KEY,
  last_pulled_at TEXT NOT NULL DEFAULT '',
  last_received_at TIMESTAMPTZ,
  last_filename TEXT NOT NULL DEFAULT '',
  last_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  slices JSONB NOT NULL DEFAULT '[]'::jsonb
);
`;
let ensured = null;
async function pool() { const p = await getReadyPool(); if (!ensured) ensured = p.query(SCHEMA_SQL).catch((e) => { ensured = null; throw e; }); await ensured; return p; }

const up = (v) => String(v ?? "").trim().toUpperCase();
const str = (v, n = 4000) => String(v ?? "").trim().slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const truthy = (v) => v === true || v === 1 || /^(1|y|yes|true|t)$/i.test(String(v ?? "").trim());
// pg hands DATE columns back as local-midnight Date objects
const dstr = (d) => (d instanceof Date ? d.toLocaleDateString("en-CA") : d ? String(d).slice(0, 10) : "");
const dateOnly = (v) => { const s = String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && s > "1900-01-01" ? s : null; };
const pick = (r, ...keys) => { for (const k of keys) { if (r && r[k] != null && r[k] !== "") return r[k]; } const lower = r ? Object.keys(r).reduce((m, k) => { m[k.toLowerCase()] = k; return m; }, {}) : {}; for (const k of keys) { const kk = lower[k.toLowerCase()]; if (kk && r[kk] != null && r[kk] !== "") return r[kk]; } return ""; };
// ePASS lost its apostrophes ("Won?t drain") — repair for display only, and
// only between two letters, which a real question mark never sits between.
export const tidy = (s) => String(s ?? "").replace(/([A-Za-z])\?([A-Za-z])/g, "$1'$2");

// ---- model families (doc 07 §1.7) ----------------------------------------
// brand | product code | stem. Bosch/Thermador/Gaggenau dishwashers share a
// family across handle letters (SHP78 / SHV78 / SHX78 -> SH?78); everything
// else is leading letters + first digit run, production index (/NN) dropped.
export function modelFamily(brand, productCode, model) {
  const b = up(brand), pc = up(productCode);
  const m = up(model).replace(/\/.*$/, "").replace(/[^A-Z0-9]/g, "");
  if (!m) return "";
  if (/BOSCH|THERM|GAGG/.test(b) && /DW/.test(pc)) {
    let x = m.match(/^SH[A-Z]M?(\d{2,3})/); if (x) return `${b}|${pc}|SH?${x[1]}`;
    x = m.match(/^SH[A-Z](\d)([A-Z]{2})/); if (x) return `${b}|${pc}|SH?${x[1]}${x[2]}`;
  }
  let stem;
  if (/^\d/.test(m)) stem = (m.match(/^\d+[A-Z]{0,3}/) || [m])[0];
  else stem = (m.match(/^[A-Z]+\d+/) || [m])[0];
  return `${b}|${pc}|${stem}`;
}
export const familyStem = (family) => String(family || "").split("|")[2] || "";

// ---- ingest ---------------------------------------------------------------
const rowsOf = (bundle, name) => (Array.isArray(bundle?.datasets?.[name]) ? bundle.datasets[name] : []);
const PRICE_KEYS = ["Rate", "Price", "SellingPrice", "Amount", "StandardRate", "DefaultRate", "LaborRate", "UnitPrice", "RegularRate", "RatePerHour", "Charge"];
function ratePrice(r) {
  for (const k of PRICE_KEYS) { const v = pick(r, k); if (v !== "" && Number.isFinite(Number(v))) return num(v); }
  // any numeric column with "rate" or "price" in the name
  for (const [k, v] of Object.entries(r || {})) if (/rate|price|amount/i.test(k) && !/code|date|stamp/i.test(k) && v !== "" && v != null && Number.isFinite(Number(v))) return num(v);
  return null;
}
// ZN1-KA -> stem ZN1 when the suffix is the row's own brand code; otherwise the
// code is its own stem (CE400 and CE400-WP both roll up to CE400).
function rateStem(code, brand) {
  const c = up(code); const b = up(brand);
  if (b && c.endsWith("-" + b)) return c.slice(0, -(b.length + 1));
  const m = c.match(/^(.*?)-([A-Z0-9]{1,8})$/);
  return m ? m[1] : c;
}

export async function processCatalogueBundle(bundle, { filename = "" } = {}) {
  const p = await pool();
  const history = rowsOf(bundle, "catalogue-history"), parts = rowsOf(bundle, "catalogue-parts"), labor = rowsOf(bundle, "catalogue-labor"), rates = rowsOf(bundle, "labor-rates");
  const counts = { tickets: 0, parts: 0, labor: 0, rates: 0 };
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const codes = [];
    for (const r of history) {
      const code = up(pick(r, "Code")); if (!code) continue;
      codes.push(code);
      const brand = up(pick(r, "SvcBrandCode")), model = up(pick(r, "SvcModel")), pc = up(pick(r, "SvcProductCode"));
      const inv = up(pick(r, "InvTypeCode")); const payer = up(pick(r, "PaymentTypeCode"));
      await client.query(
        `INSERT INTO epass_service_catalogue (code, inv_type, job_status, date_created, date_finished, tech_code, sold_to_code, bill_to_code, last_name, first_name, address1, city, zip, phone, brand, model, model_family, product_code, serial, complaint, performed, repair_code, payment_type, is_warranty, labor_total, item_total, misc_total, total, raw, loaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,NOW())
         ON CONFLICT (code) DO UPDATE SET inv_type = EXCLUDED.inv_type, job_status = EXCLUDED.job_status, date_created = EXCLUDED.date_created, date_finished = EXCLUDED.date_finished, tech_code = EXCLUDED.tech_code, sold_to_code = EXCLUDED.sold_to_code, bill_to_code = EXCLUDED.bill_to_code, last_name = EXCLUDED.last_name, first_name = EXCLUDED.first_name, address1 = EXCLUDED.address1, city = EXCLUDED.city, zip = EXCLUDED.zip, phone = EXCLUDED.phone, brand = EXCLUDED.brand, model = EXCLUDED.model, model_family = EXCLUDED.model_family, product_code = EXCLUDED.product_code, serial = EXCLUDED.serial, complaint = EXCLUDED.complaint, performed = EXCLUDED.performed, repair_code = EXCLUDED.repair_code, payment_type = EXCLUDED.payment_type, is_warranty = EXCLUDED.is_warranty, labor_total = EXCLUDED.labor_total, item_total = EXCLUDED.item_total, misc_total = EXCLUDED.misc_total, total = EXCLUDED.total, raw = EXCLUDED.raw, loaded_at = NOW()`,
        [code, inv, up(pick(r, "JobStatusCode")), dateOnly(pick(r, "DateCreated")), dateOnly(pick(r, "DateFinished", "InvFinishDate")), up(pick(r, "Salesperson1Code")), up(pick(r, "SoldToCode")), up(pick(r, "BillToCode")),
          str(pick(r, "SoldToLastName"), 80), str(pick(r, "SoldToFirstName"), 80), str(pick(r, "SoldToAddress1"), 120), str(pick(r, "SoldToCity"), 60), str(pick(r, "SoldToZipCode"), 10).slice(0, 5), String(pick(r, "SoldToPhone1") || "").replace(/\D/g, "").slice(-10),
          brand, model, modelFamily(brand, pc, model), pc, up(pick(r, "SvcSerial")).replace(/[^A-Z0-9]/g, ""), str(pick(r, "SvcComplaintDesc")), str(pick(r, "SvcPerformedDesc")), up(pick(r, "SvcRepairCode")), payer,
          inv === "WTY" || /WTY|WAR/.test(payer), num(pick(r, "LaborTotal")), num(pick(r, "ItemTotal")), num(pick(r, "MiscTotal")),
          num(pick(r, "SerialTotal")) + num(pick(r, "ItemTotal")) + num(pick(r, "LaborTotal")) + num(pick(r, "MiscTotal")) + num(pick(r, "WtyTotal")) + num(pick(r, "Tax1Total")) + num(pick(r, "Tax2Total")) + num(pick(r, "Tax3Total")),
          JSON.stringify(r)]);
      counts.tickets++;
    }
    if (codes.length) {
      await client.query(`DELETE FROM epass_service_catalogue_parts WHERE code = ANY($1)`, [codes]);
      await client.query(`DELETE FROM epass_service_catalogue_labor WHERE code = ANY($1)`, [codes]);
    }
    const codeSet = new Set(codes);
    for (const r of parts) {
      const code = up(pick(r, "InvoiceCode")); if (!code || (codes.length && !codeSet.has(code))) continue;
      await client.query(`INSERT INTO epass_service_catalogue_parts (code, item_code, description, qty, price, cost, total, warranty, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [code, up(pick(r, "ItemCode")).slice(0, 60), str(pick(r, "Description"), 200), num(pick(r, "QtyShipped", "QtyOrdered", "Qty")), num(pick(r, "SellingPrice")), num(pick(r, "UnitCost")), num(pick(r, "Total")), truthy(pick(r, "Warranty")), up(pick(r, "Status")).slice(0, 30)]);
      counts.parts++;
    }
    for (const r of labor) {
      const code = up(pick(r, "InvoiceCode")); if (!code || (codes.length && !codeSet.has(code))) continue;
      await client.query(`INSERT INTO epass_service_catalogue_labor (code, labor_code, description, tech_code, service_date, rate, total, warranty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [code, up(pick(r, "LaborRateCode")).slice(0, 40), str(pick(r, "Labor_Description", "LaborDescription", "Description"), 200), up(pick(r, "TechnicianCode")), dateOnly(pick(r, "ServiceDate")), num(pick(r, "Rate")), num(pick(r, "Total")), truthy(pick(r, "Warranty"))]);
      counts.labor++;
    }
    if (rates.length) {
      await client.query(`DELETE FROM epass_labor_rates`);
      for (const r of rates) {
        const code = up(pick(r, "Code")); if (!code) continue;
        const brand = up(pick(r, "BrandCode", "Brand"));
        await client.query(`INSERT INTO epass_labor_rates (code, stem, description, brand, price, active, raw) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (code) DO UPDATE SET stem = EXCLUDED.stem, description = EXCLUDED.description, brand = EXCLUDED.brand, price = EXCLUDED.price, active = EXCLUDED.active, raw = EXCLUDED.raw, loaded_at = NOW()`,
          [code, rateStem(code, brand), str(pick(r, "Description"), 200), brand, ratePrice(r), !truthy(pick(r, "Obsolete", "Inactive", "Deleted")), JSON.stringify(r)]);
        counts.rates++;
      }
    }
    const slice = { pulledAt: bundle.pulledAt || "", since: bundle.catalogueSince || "", until: bundle.catalogueUntil || "", ...counts, at: new Date().toISOString() };
    await client.query(`INSERT INTO epass_catalogue_meta (id, last_pulled_at, last_received_at, last_filename, last_counts, slices) VALUES (1,$1,NOW(),$2,$3::jsonb,$4::jsonb)
      ON CONFLICT (id) DO UPDATE SET last_pulled_at = EXCLUDED.last_pulled_at, last_received_at = NOW(), last_filename = EXCLUDED.last_filename, last_counts = EXCLUDED.last_counts,
        slices = (SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements(epass_catalogue_meta.slices || EXCLUDED.slices) x ORDER BY x->>'at' DESC LIMIT 60) s)`,
      [bundle.pulledAt || "", String(filename || "").slice(0, 120), JSON.stringify(counts), JSON.stringify([slice])]);
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
  return counts;
}

export async function catalogueStatus() {
  const p = await pool();
  const meta = (await p.query(`SELECT * FROM epass_catalogue_meta WHERE id = 1`)).rows[0];
  const n = (await p.query(`SELECT COUNT(*)::int AS n, MIN(date_finished)::text AS first, MAX(date_finished)::text AS last FROM epass_service_catalogue`)).rows[0];
  const rates = (await p.query(`SELECT COUNT(*)::int AS n FROM epass_labor_rates`)).rows[0].n;
  return { tickets: n.n, first: n.first, last: n.last, rates, lastReceivedAt: meta?.last_received_at ? new Date(meta.last_received_at).toISOString() : null, lastPulledAt: meta?.last_pulled_at || "", lastCounts: meta?.last_counts || {}, slices: meta?.slices || [] };
}

// ---- reads ----------------------------------------------------------------
function mapCall(r) {
  return {
    sv: r.code, type: r.inv_type, status: r.job_status, created: dstr(r.date_created), finished: dstr(r.date_finished),
    tech: r.tech_code || "", customer: [r.first_name, r.last_name].filter(Boolean).join(" "), customerCode: r.sold_to_code || "", address: r.address1 || "", city: r.city || "", zip: r.zip || "", phone: r.phone || "",
    brand: r.brand || "", model: r.model || "", family: r.model_family || "", productCode: r.product_code || "", serial: r.serial || "", unit: [r.brand, r.product_code, r.model].filter(Boolean).join(" "),
    complaint: tidy(r.complaint), performed: tidy(r.performed), repairCode: r.repair_code || "", payer: r.payment_type || "", warranty: !!r.is_warranty,
    labor: Number(r.labor_total) || 0, parts: Number(r.item_total) || 0, total: Number(r.total) || 0
  };
}
async function linesFor(p, codes) {
  if (!codes.length) return { parts: new Map(), labor: new Map() };
  const parts = new Map(), labor = new Map();
  for (const r of (await p.query(`SELECT * FROM epass_service_catalogue_parts WHERE code = ANY($1) ORDER BY id`, [codes])).rows) { if (!parts.has(r.code)) parts.set(r.code, []); parts.get(r.code).push({ part: r.item_code, desc: r.description, qty: Number(r.qty) || 0, price: Number(r.price) || 0, cost: Number(r.cost) || 0, total: Number(r.total) || 0, warranty: !!r.warranty, status: r.status }); }
  for (const r of (await p.query(`SELECT * FROM epass_service_catalogue_labor WHERE code = ANY($1) ORDER BY id`, [codes])).rows) { if (!labor.has(r.code)) labor.set(r.code, []); labor.get(r.code).push({ code: r.labor_code, desc: r.description, tech: r.tech_code, date: dstr(r.service_date), rate: Number(r.rate) || 0, total: Number(r.total) || 0, warranty: !!r.warranty }); }
  return { parts, labor };
}

// One past call, opened: complaint, work performed, parts, labor.
export async function callDetail(code) {
  const p = await pool();
  const r = (await p.query(`SELECT * FROM epass_service_catalogue WHERE code = $1`, [up(code)])).rows[0];
  if (!r) return null;
  const { parts, labor } = await linesFor(p, [r.code]);
  return { ...mapCall(r), partsLines: parts.get(r.code) || [], laborLines: labor.get(r.code) || [] };
}

// The history behind a stop: same ePASS customer, phone, address or serial.
// `why` on each row says which matched; the same unit (serial) sorts first.
export async function customerHistory({ customerCode = "", phone = "", address1 = "", zip = "", serial = "", exclude = "", limit = 40 } = {}) {
  const p = await pool();
  const clauses = [], params = [];
  const cust = up(customerCode), ph = String(phone || "").replace(/\D/g, "").slice(-10), addr = up(address1).replace(/\s+/g, " "), z = String(zip || "").slice(0, 5), ser = up(serial).replace(/[^A-Z0-9]/g, "");
  if (cust) { params.push(cust); clauses.push(`sold_to_code = $${params.length}`); }
  if (ph.length === 10) { params.push(ph); clauses.push(`phone = $${params.length}`); }
  if (addr && z) { params.push(addr, z); clauses.push(`(UPPER(address1) = $${params.length - 1} AND zip = $${params.length})`); }
  if (ser.length >= 4) { params.push(ser); clauses.push(`serial = $${params.length}`); }
  if (!clauses.length) return { calls: [], serialSeen: false };
  params.push(Math.max(1, Math.min(200, Number(limit) || 40)));
  const rows = (await p.query(`SELECT * FROM epass_service_catalogue WHERE (${clauses.join(" OR ")}) ORDER BY date_finished DESC NULLS LAST, date_created DESC LIMIT $${params.length}`, params)).rows.filter((r) => r.code !== up(exclude));
  const { parts, labor } = await linesFor(p, rows.map((r) => r.code));
  const calls = rows.map((r) => ({ ...mapCall(r), sameUnit: !!(ser && r.serial === ser), why: ser && r.serial === ser ? "same unit" : cust && r.sold_to_code === cust ? "same account" : ph && r.phone === ph ? "same phone" : "same address", partsLines: parts.get(r.code) || [], laborLines: labor.get(r.code) || [] }));
  calls.sort((a, b) => (b.sameUnit - a.sameUnit) || String(b.finished || b.created).localeCompare(String(a.finished || a.created)));
  return { calls, serialSeen: calls.some((c) => c.sameUnit) };
}

// Model Insight in three tiers (doc 07 §1.7): exact model, its family, the
// brand's product type — count, parts that actually went in, recent calls.
export async function modelInsight({ brand = "", model = "", productCode = "", limit = 8 } = {}) {
  const p = await pool();
  const b = up(brand), m = up(model).replace(/[^A-Z0-9\/]/g, ""), pc = up(productCode);
  if (!b && !m) return { tiers: [] };
  const family = modelFamily(b, pc, m);
  const tierDefs = [
    m ? { key: "exact", label: m, where: `brand = $1 AND model = $2`, params: [b, m] } : null,
    family ? { key: "family", label: familyStem(family), where: `model_family = $1`, params: [family] } : null,
    b && pc ? { key: "type", label: `${b} ${pc}`, where: `brand = $1 AND product_code = $2`, params: [b, pc] } : null
  ].filter(Boolean);
  const tiers = [];
  for (const t of tierDefs) {
    const n = (await p.query(`SELECT COUNT(*)::int AS n FROM epass_service_catalogue WHERE ${t.where}`, t.params)).rows[0].n;
    if (!n) { tiers.push({ key: t.key, label: t.label, calls: 0, parts: [], recent: [] }); continue; }
    const parts = (await p.query(
      `SELECT pl.item_code, MAX(pl.description) AS description, COUNT(DISTINCT pl.code)::int AS n, ROUND(AVG(NULLIF(pl.price, 0))::numeric, 2) AS price
         FROM epass_service_catalogue_parts pl JOIN epass_service_catalogue c ON c.code = pl.code
        WHERE ${t.where.replace(/\b(brand|model|model_family|product_code)\b/g, "c.$1")} AND pl.item_code <> '' AND pl.qty > 0
          AND pl.item_code NOT SIMILAR TO '(FREIGHT|SHIP|S&H|MISC|LABOR|TAX|ZN%|DZ%)'
        GROUP BY pl.item_code ORDER BY n DESC LIMIT 12`, t.params)).rows;
    const recent = (await p.query(`SELECT * FROM epass_service_catalogue WHERE ${t.where} ORDER BY date_finished DESC NULLS LAST LIMIT $${t.params.length + 1}`, [...t.params, Math.max(1, Math.min(25, Number(limit) || 8))])).rows;
    const labor = (await p.query(
      `SELECT ll.labor_code, MAX(ll.description) AS description, COUNT(*)::int AS n, ROUND(AVG(NULLIF(ll.total, 0))::numeric, 2) AS avg
         FROM epass_service_catalogue_labor ll JOIN epass_service_catalogue c ON c.code = ll.code
        WHERE ${t.where.replace(/\b(brand|model|model_family|product_code)\b/g, "c.$1")} AND ll.labor_code <> '' AND ll.labor_code NOT SIMILAR TO '(ZN|DZ|WTY|FREIGHT|LAB-)%'
        GROUP BY ll.labor_code ORDER BY n DESC LIMIT 8`, t.params)).rows;
    tiers.push({ key: t.key, label: t.label, calls: n,
      parts: parts.map((x) => ({ part: x.item_code, desc: x.description || "", n: x.n, price: x.price == null ? null : Number(x.price) })),
      labor: labor.map((x) => ({ code: x.labor_code, desc: x.description || "", n: x.n, avg: x.avg == null ? null : Number(x.avg) })),
      recent: recent.map(mapCall) });
  }
  return { brand: b, model: m, family, tiers };
}

// The component picker: LaborRate stems (CE400 …) with the plain price and,
// when the book has a brand variant for the job's brand, that price too.
// ZN / DZ / WTY / FREIGHT / LAB- rows are not components and are left out.
export async function laborRateOptions({ q = "", brand = "", limit = 30 } = {}) {
  const p = await pool();
  const b = up(brand); const needle = str(q, 60).toUpperCase();
  const params = [b, `${needle}%`]; let where = `active AND stem NOT SIMILAR TO '(ZN|DZ|WTY|FREIGHT|LAB-|TRIP|MISC)%'`;
  if (needle) { params.push(`%${needle}%`); where += ` AND (UPPER(description) LIKE $${params.length} OR UPPER(stem) LIKE $${params.length})`; }
  params.push(Math.max(1, Math.min(200, Number(limit) || 30)));
  const rows = (await p.query(
    `SELECT stem, MAX(description) AS description,
            MAX(CASE WHEN brand = '' OR code = stem THEN price END) AS price,
            MAX(CASE WHEN brand = $1 AND $1 <> '' THEN price END) AS brand_price,
            MAX(CASE WHEN brand = $1 AND $1 <> '' THEN code END) AS brand_code,
            COUNT(*)::int AS variants
       FROM epass_labor_rates WHERE ${where}
      GROUP BY stem ORDER BY (CASE WHEN $2 <> '%' AND UPPER(MAX(description)) LIKE $2 THEN 0 ELSE 1 END), MAX(description) LIMIT $${params.length}`, params)).rows;
  return rows.map((r) => ({ code: r.brand_code || r.stem, stem: r.stem, desc: r.description || r.stem, price: r.brand_price != null ? Number(r.brand_price) : r.price != null ? Number(r.price) : null, brandPrice: r.brand_price != null, variants: r.variants }));
}
// A single labor code's book price for the job's brand (ZN1-KA over ZN1).
export async function laborRateFor(code, brand = "") {
  const p = await pool(); const c = up(code), b = up(brand);
  const r = (await p.query(`SELECT code, price, description FROM epass_labor_rates WHERE stem = $1 AND active ORDER BY (brand = $2 AND $2 <> '') DESC, (brand = '') DESC LIMIT 1`, [c, b])).rows[0];
  return r ? { code: r.code, price: r.price == null ? null : Number(r.price), desc: r.description } : null;
}
export async function serialSeenBefore(serial) {
  const p = await pool(); const s = up(serial).replace(/[^A-Z0-9]/g, "");
  if (s.length < 4) return false;
  return (await p.query(`SELECT 1 FROM epass_service_catalogue WHERE serial = $1 LIMIT 1`, [s])).rows.length > 0;
}

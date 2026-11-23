import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";
import { getEpassCustomersMeta, upsertEpassCustomers, phone10 } from "./epass-customers-postgres.js";
import { properBrandName } from "./shop-brand-names.js";

// ---------------------------------------------------------------------------
// CUSTOMER MASTER (customer-master.html) — Andrew 11/20: "I need a Customer
// Master to build an email list for the Event RSVP tool. We need to see all
// ePASS customers today - I'll tie them to their NetSuite ID later."
//
//   epass_customers          (lib/epass-customers-postgres.js) every ePASS
//                            customer: name, phones, emails, address, the
//                            Do Not Email / Declined Email flags. Here it gains
//                            last_activity + preferred_contact (Customer.
//                            LastActivityDate / PreferredContact).
//   epass_customer_totals    LIFETIME totals per customer from the daily
//                            epass-customers bundle: finished sales invoices
//                            (R/S/AC/CAB/MOD) and customer-pay service (SV)
//                            since ePASS began — count, pre-tax revenue, first
//                            and last finish date. An invoice is credited to
//                            its bill-to, else its sold-to (as Agility does
//                            everywhere else).
//   epass_customer_brands    the brands each customer has bought (InvoiceModel
//                            lines on those sales invoices): lines, last bought.
//   customer_master_meta     when each part last arrived.
//
// Until the first bundle lands (the pull script and agent need updating on
// the ePASS server), totals and brands come from the order history already
// in Agility — sales_order_detail and epass_sold_serials — and the page says
// they reach back only as far as that history does.
//
// Emailable = has an address, ePASS doesn't say Do Not Email / Declined, and
// the address hasn't unsubscribed from event emails (agility_email_optouts).
// "Add to event" only ever adds emailable customers, and never sends anything.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
ALTER TABLE epass_customers ADD COLUMN IF NOT EXISTS last_activity TEXT NOT NULL DEFAULT '';
ALTER TABLE epass_customers ADD COLUMN IF NOT EXISTS preferred_contact TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_epc_city ON epass_customers (upper(city));
CREATE TABLE IF NOT EXISTS epass_customer_totals (
  code TEXT PRIMARY KEY,
  sales_invoices INTEGER NOT NULL DEFAULT 0,
  sales_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  first_sale TEXT NOT NULL DEFAULT '',
  last_sale TEXT NOT NULL DEFAULT '',
  service_invoices INTEGER NOT NULL DEFAULT 0,
  service_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  last_service TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ect_last_sale ON epass_customer_totals (last_sale);
CREATE TABLE IF NOT EXISTS epass_customer_brands (
  code TEXT NOT NULL,
  brand_code TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  lines INTEGER NOT NULL DEFAULT 0,
  last_bought TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (code, brand_code)
);
CREATE INDEX IF NOT EXISTS idx_ecb_brand ON epass_customer_brands (brand_code);
CREATE TABLE IF NOT EXISTS customer_master_meta (
  part TEXT PRIMARY KEY,
  pulled_at TEXT NOT NULL DEFAULT '',
  rows INTEGER NOT NULL DEFAULT 0,
  filename TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 11/20: the last finish date the lifetime part covers. The history export
-- sends it (asOf); Agility adds its own finished orders after that date, so
-- the totals stay lifetime without re-reading every invoice over ODBC.
ALTER TABLE customer_master_meta ADD COLUMN IF NOT EXISTS as_of TEXT NOT NULL DEFAULT '';
-- The top-up leaves out units loaded from the history export; the column
-- belongs to lib/epass-sold-serials-postgres.js, added here too in case this
-- page is opened before that module has run since the deploy.
ALTER TABLE IF EXISTS epass_sold_serials ADD COLUMN IF NOT EXISTS history BOOLEAN NOT NULL DEFAULT FALSE;
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await getEpassCustomersMeta(); // creates epass_customers first
      await pool.query(SCHEMA_SQL);
    })().catch((err) => { ensurePromise = null; throw err; });
  }
  await ensurePromise;
  return pool;
}

const pick = (row, ...names) => {
  for (const n of names) {
    const key = Object.keys(row || {}).find((k) => k.toLowerCase() === String(n).toLowerCase());
    if (key != null && row[key] != null && String(row[key]).trim() !== "") return String(row[key]).trim();
  }
  return "";
};
const day = (v) => { const s = String(v || "").trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; const u = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return u ? `${u[3]}-${u[1].padStart(2, "0")}-${u[2].padStart(2, "0")}` : ""; };
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
const custOf = (r) => (pick(r, "BillTo", "BillToCode") || pick(r, "SoldTo", "SoldToCode")).toUpperCase().slice(0, 40);
const earliest = (...d) => d.filter(Boolean).sort()[0] || "";
const latest = (...d) => d.filter(Boolean).sort().slice(-1)[0] || "";
const rowsOf = (bundle, name) => (Array.isArray(bundle?.datasets?.[name]) ? bundle.datasets[name] : null);

async function insertChunks(client, head, rows, width, tail, casts = {}) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const params = [];
    const tuples = chunk.map((row) => "(" + row.map((v, j) => `$${params.push(v)}${casts[j] || ""}`).join(", ") + ")");
    await client.query(`${head} VALUES ${tuples.join(", ")} ${tail}`, params);
  }
}

async function noteMeta(client, part, { pulledAt = "", rows = 0, filename = "", asOf = "" }) {
  await client.query(
    `INSERT INTO customer_master_meta (part, pulled_at, rows, filename, as_of, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (part) DO UPDATE SET pulled_at = EXCLUDED.pulled_at, rows = EXCLUDED.rows, filename = EXCLUDED.filename, as_of = EXCLUDED.as_of, updated_at = NOW()`,
    [part, String(pulledAt || "").slice(0, 40), rows, String(filename || "").slice(0, 200), String(asOf || "").slice(0, 10)]
  );
}

// The last finish date a lifetime bundle covers: the history export says so
// (asOf). An older ODBC pull's lifetime bundle (its 5 AM run) is taken as
// covering the day before it ran; that day's own orders come from the feed.
const asOfOf = (bundle) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(bundle?.asOf || ""))) return String(bundle.asOf);
  const d = day(bundle?.pulledAt);
  if (!d) return "";
  const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

// Lifetime totals: invoice rows per bill-to / sold-to pair → one row per
// customer. A dataset that didn't come (its query failed on the ePASS side)
// leaves that half of the totals as it was.
export function totalsFromRows(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const code = custOf(r); if (!code) continue;
    const t = out.get(code) || { invoices: 0, revenue: 0, first: "", last: "" };
    t.invoices += Math.max(0, Math.round(num(pick(r, "Invoices"))));
    t.revenue += num(pick(r, "Revenue"));
    t.first = earliest(t.first, day(pick(r, "FirstInvFinish")), day(pick(r, "FirstFinished")));
    t.last = latest(t.last, day(pick(r, "LastInvFinish")), day(pick(r, "LastFinished")));
    out.set(code, t);
  }
  return out;
}

export function brandsFromRows(rows) {
  const out = new Map(); // "code|brand" -> rec
  for (const r of rows || []) {
    const code = custOf(r), brandCode = pick(r, "BrandCode").toUpperCase().slice(0, 40);
    if (!code || !brandCode) continue;
    const k = `${code}|${brandCode}`;
    const b = out.get(k) || { code, brandCode, brand: properBrandName(brandCode, pick(r, "BrandName", "Brand_Description")).slice(0, 80), lines: 0, last: "" };
    b.lines += Math.max(0, Math.round(num(pick(r, "Lines"))));
    b.last = latest(b.last, day(pick(r, "LastInvFinish")), day(pick(r, "LastFinished")));
    out.set(k, b);
  }
  return [...out.values()];
}

// One epass-customers bundle (any of its three parts).
export async function ingestCustomerBundle(bundle, { filename = "" } = {}) {
  const pool = await getReadyPool();
  const pulledAt = String(bundle?.pulledAt || "");
  const counts = {};
  if (rowsOf(bundle, "customers")?.length) counts.customers = await upsertEpassCustomers(bundle, { filename });

  const extras = rowsOf(bundle, "customer-extras");
  if (extras?.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = extras.map((r) => [pick(r, "Code").toUpperCase().slice(0, 40), day(pick(r, "LastActivityDate")), pick(r, "PreferredContact").slice(0, 40)]).filter((r) => r[0]);
      for (let i = 0; i < rows.length; i += 400) {
        const chunk = rows.slice(i, i + 400), params = [];
        const tuples = chunk.map((row) => `($${params.push(row[0])}, $${params.push(row[1])}, $${params.push(row[2])})`);
        await client.query(`UPDATE epass_customers c SET last_activity = v.la, preferred_contact = v.pc FROM (VALUES ${tuples.join(", ")}) AS v(code, la, pc) WHERE c.code = v.code`, params);
      }
      await noteMeta(client, "extras", { pulledAt, rows: rows.length, filename });
      await client.query("COMMIT");
      counts.extras = rows.length;
    } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
  }

  const sales = rowsOf(bundle, "customer-sales"), service = rowsOf(bundle, "customer-service");
  if (sales?.length || service?.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [half, rows] of [["sales", sales], ["service", service]]) {
        if (!rows?.length) continue;
        const map = totalsFromRows(rows);
        if (half === "sales") await client.query(`UPDATE epass_customer_totals SET sales_invoices = 0, sales_revenue = 0, first_sale = '', last_sale = ''`);
        else await client.query(`UPDATE epass_customer_totals SET service_invoices = 0, service_revenue = 0, last_service = ''`);
        const list = [...map.entries()].map(([code, t]) => half === "sales" ? [code, t.invoices, r2(t.revenue), t.first, t.last] : [code, t.invoices, r2(t.revenue), t.last]);
        if (half === "sales") {
          await insertChunks(client, `INSERT INTO epass_customer_totals (code, sales_invoices, sales_revenue, first_sale, last_sale)`, list, 5,
            `ON CONFLICT (code) DO UPDATE SET sales_invoices = EXCLUDED.sales_invoices, sales_revenue = EXCLUDED.sales_revenue, first_sale = EXCLUDED.first_sale, last_sale = EXCLUDED.last_sale, updated_at = NOW()`);
        } else {
          await insertChunks(client, `INSERT INTO epass_customer_totals (code, service_invoices, service_revenue, last_service)`, list, 4,
            `ON CONFLICT (code) DO UPDATE SET service_invoices = EXCLUDED.service_invoices, service_revenue = EXCLUDED.service_revenue, last_service = EXCLUDED.last_service, updated_at = NOW()`);
        }
        await noteMeta(client, half, { pulledAt, rows: map.size, filename, asOf: asOfOf(bundle) });
        counts[half] = map.size;
      }
      await client.query(`DELETE FROM epass_customer_totals WHERE sales_invoices = 0 AND service_invoices = 0 AND sales_revenue = 0 AND service_revenue = 0`);
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
  }

  const brands = rowsOf(bundle, "customer-brands");
  if (brands?.length) {
    const list = brandsFromRows(brands);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM epass_customer_brands`);
      await insertChunks(client, `INSERT INTO epass_customer_brands (code, brand_code, brand, lines, last_bought)`, list.map((b) => [b.code, b.brandCode, b.brand, b.lines, b.last]), 5, "");
      await noteMeta(client, "brands", { pulledAt, rows: list.length, filename, asOf: asOfOf(bundle) });
      await client.query("COMMIT");
      counts.brands = list.length;
    } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
  }
  return counts;
}

// ---- reading ---------------------------------------------------------------

async function sources(pool) {
  const r = await pool.query(`SELECT
      (SELECT COUNT(*) FROM customer_master_meta WHERE part IN ('sales', 'service'))::int AS totals,
      (SELECT COUNT(*) FROM customer_master_meta WHERE part = 'brands')::int AS brands,
      to_regclass('public.sales_order_detail') IS NOT NULL AS sod,
      to_regclass('public.epass_sold_serials') IS NOT NULL AND to_regclass('public.epass_model_master') IS NOT NULL AS sold,
      to_regclass('public.agility_email_optouts') IS NOT NULL AS optouts`);
  const s = r.rows[0];
  // How far each lifetime part reaches (11/20): Agility adds its own
  // finished orders after that date. A part stored before as_of existed
  // counts as covering the day before it was pulled.
  const asOf = {};
  for (const m of (await pool.query(`SELECT part, as_of, pulled_at FROM customer_master_meta WHERE part IN ('sales', 'service', 'brands')`)).rows) {
    asOf[m.part] = ISO.test(m.as_of || "") ? m.as_of : asOfOf({ pulledAt: m.pulled_at });
  }
  return { lifetimeTotals: s.totals > 0, lifetimeBrands: s.brands > 0, sod: s.sod, sold: s.sold, optouts: s.optouts, asOf };
}

// The totals and brands every query reads: the lifetime tables when the
// ePASS lifetime part has arrived (from the history export, 11/20) plus
// Agility's own finished orders after the date it reaches, otherwise
// Agility's own order history alone. Orders loaded from the history export
// itself are already inside the lifetime part, so the top-up leaves them out.
// Sales orders by number: R / S (appliances), AC (HVAC), CB and MD
// (cabinetry and modifications - ePASS types CAB and MOD), Q (a quote
// finished under its own number); SV is service.
const SALES_RE = `invoice ~ '^(R|S|AC|CB|MD|CAB|MOD|Q)[0-9]'`, SERVICE_RE = `invoice ~ '^SV[0-9]'`;
const after = (d) => (ISO.test(d || "") ? `finish_date > '${d}'` : "FALSE"); // d is a checked yyyy-mm-dd
function totalsSql(src) {
  if (src.lifetimeTotals) {
    const base = `SELECT code, sales_invoices, sales_revenue::float AS sales_revenue, first_sale, last_sale, service_invoices, service_revenue::float AS service_revenue, last_service FROM epass_customer_totals`;
    const sa = after(src.asOf?.sales), sv = after(src.asOf?.service);
    if (!src.sod || (sa === "FALSE" && sv === "FALSE")) return base;
    const since = [src.asOf?.sales, src.asOf?.service].filter((d) => ISO.test(d || "")).sort()[0];
    return `SELECT code, SUM(sales_invoices)::int AS sales_invoices, SUM(sales_revenue)::float AS sales_revenue,
        COALESCE(MIN(NULLIF(first_sale, '')), '') AS first_sale, COALESCE(MAX(NULLIF(last_sale, '')), '') AS last_sale,
        SUM(service_invoices)::int AS service_invoices, SUM(service_revenue)::float AS service_revenue, COALESCE(MAX(NULLIF(last_service, '')), '') AS last_service
      FROM (${base}
        UNION ALL
        SELECT upper(customer_number),
          COUNT(*) FILTER (WHERE ${SALES_RE} AND ${sa})::int,
          COALESCE(SUM(revenue) FILTER (WHERE ${SALES_RE} AND ${sa}), 0)::float,
          COALESCE(MIN(finish_date) FILTER (WHERE ${SALES_RE} AND ${sa}), ''),
          COALESCE(MAX(finish_date) FILTER (WHERE ${SALES_RE} AND ${sa}), ''),
          COUNT(*) FILTER (WHERE ${SERVICE_RE} AND ${sv})::int,
          COALESCE(SUM(revenue) FILTER (WHERE ${SERVICE_RE} AND ${sv}), 0)::float,
          COALESCE(MAX(finish_date) FILTER (WHERE ${SERVICE_RE} AND ${sv}), '')
        FROM sales_order_detail WHERE finish_date > '${since}' AND customer_number <> '' AND source_filename <> 'ePASS history export' GROUP BY 1
      ) x GROUP BY code`;
  }
  if (!src.sod) return `SELECT NULL::text AS code, 0 AS sales_invoices, 0::float AS sales_revenue, '' AS first_sale, '' AS last_sale, 0 AS service_invoices, 0::float AS service_revenue, '' AS last_service WHERE FALSE`;
  return `SELECT upper(customer_number) AS code,
      COUNT(*) FILTER (WHERE ${SALES_RE})::int AS sales_invoices,
      COALESCE(SUM(revenue) FILTER (WHERE ${SALES_RE}), 0)::float AS sales_revenue,
      COALESCE(MIN(finish_date) FILTER (WHERE ${SALES_RE}), '') AS first_sale,
      COALESCE(MAX(finish_date) FILTER (WHERE ${SALES_RE}), '') AS last_sale,
      COUNT(*) FILTER (WHERE ${SERVICE_RE})::int AS service_invoices,
      COALESCE(SUM(revenue) FILTER (WHERE ${SERVICE_RE}), 0)::float AS service_revenue,
      COALESCE(MAX(finish_date) FILTER (WHERE ${SERVICE_RE}), '') AS last_service
    FROM sales_order_detail WHERE finish_date <> '' AND customer_number <> '' GROUP BY upper(customer_number)`;
}
function brandsSql(src) {
  const sold = (where) => `SELECT upper(s.customer_number) AS code, upper(m.brand_code) AS brand_code, MAX(m.brand) AS brand, COUNT(*)::int AS lines, MAX(s.finish_date) AS last_bought
    FROM epass_sold_serials s JOIN epass_model_master m ON m.model = s.model
    WHERE s.customer_number <> '' AND m.brand_code <> '' AND NOT s.returned${where} GROUP BY 1, 2`;
  if (src.lifetimeBrands) {
    const base = `SELECT code, brand_code, brand, lines, last_bought FROM epass_customer_brands`;
    if (!src.sold || !ISO.test(src.asOf?.brands || "")) return base;
    return `SELECT code, brand_code, MAX(brand) AS brand, SUM(lines)::int AS lines, MAX(last_bought) AS last_bought
      FROM (${base} UNION ALL ${sold(` AND s.finish_date > '${src.asOf.brands}' AND NOT s.history`)}) x GROUP BY code, brand_code`;
  }
  if (!src.sold) return `SELECT NULL::text AS code, NULL::text AS brand_code, '' AS brand, 0 AS lines, '' AS last_bought WHERE FALSE`;
  return sold("");
}
const optedOutSql = (src, col) => (src.optouts ? `EXISTS (SELECT 1 FROM agility_email_optouts o WHERE o.email = ${col})` : "FALSE");

// The first address we may use: in ePASS order (Email, Billing, Mailing),
// skipping any that unsubscribed. Empty when the customer is Do Not Email.
const firstEmailSql = (src) => `CASE WHEN c.do_not_email THEN '' ELSE COALESCE((SELECT e FROM unnest(c.emails) WITH ORDINALITY u(e, n) WHERE NOT ${optedOutSql(src, "u.e")} ORDER BY n LIMIT 1), '') END`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function cleanFilters(f = {}) {
  const s = (v, n = 120) => String(v ?? "").trim().slice(0, n);
  const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/)).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  const zips = list(f.zip).filter((z) => /^\d{3,5}$/.test(z)).slice(0, 200);
  const amount = (v) => (v == null || String(v).trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v)); // blank = no limit (cleaning twice keeps it blank)
  const out = {
    q: s(f.q, 120),
    zip: zips,
    city: s(f.city, 60),
    brands: list(f.brands).filter((b) => /^[A-Z0-9&.\- ]{1,40}$/.test(b)).slice(0, 30),
    salesperson: s(f.salesperson, 20).toUpperCase(),
    accountType: s(f.accountType, 40),
    bought: ["buyers", "service", "none"].includes(f.bought) ? f.bought : "",
    lastFrom: ISO.test(f.lastFrom) ? f.lastFrom : "",
    lastTo: ISO.test(f.lastTo) ? f.lastTo : "",
    minRevenue: amount(f.minRevenue),
    maxRevenue: amount(f.maxRevenue),
    emailable: f.emailable === true || f.emailable === "1" || f.emailable === "true",
    sort: ["name", "last", "revenue", "since", "code"].includes(f.sort) ? f.sort : "name"
  };
  return out;
}

function whereFor(f, src, params) {
  const w = [];
  const add = (v) => `$${params.push(v)}`;
  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    const like = add(`%${f.q.replace(/[%_\\]/g, "")}%`);
    const parts = [`c.code ILIKE ${like}`, `c.name ILIKE ${like}`, `(c.first_name || ' ' || c.last_name) ILIKE ${like}`, `c.address1 ILIKE ${like}`, `c.city ILIKE ${like}`, `EXISTS (SELECT 1 FROM unnest(c.emails) e WHERE e ILIKE ${like})`];
    if (digits.length >= 4) parts.push(`EXISTS (SELECT 1 FROM unnest(c.phones) p WHERE p LIKE ${add(`%${digits}%`)})`);
    w.push(`(${parts.join(" OR ")})`);
  }
  if (f.zip.length) {
    const five = f.zip.filter((z) => z.length === 5), pre = f.zip.filter((z) => z.length < 5);
    const zs = [];
    if (five.length) zs.push(`c.zip = ANY(${add(five)}::text[])`);
    if (pre.length) zs.push(`EXISTS (SELECT 1 FROM unnest(${add(pre)}::text[]) z WHERE c.zip LIKE z || '%')`);
    w.push(`(${zs.join(" OR ")})`);
  }
  if (f.city) w.push(`upper(c.city) = upper(${add(f.city)})`);
  // Salesperson (11/20): ePASS fills in the customer's own salesperson on
  // only a few hundred accounts, so the list also takes everyone the
  // salesperson sold to - any finished sales order in Agility's history
  // (back to 2006 with the ePASS history export), by its salesperson.
  if (f.salesperson) {
    const sp = add(f.salesperson);
    w.push(src.sod
      ? `(c.salesperson = ${sp} OR c.code IN (SELECT upper(customer_number) FROM sales_order_detail WHERE salesperson_code = ${sp} AND customer_number <> '' AND ${SALES_RE}))`
      : `c.salesperson = ${sp}`);
  }
  if (f.accountType) w.push(`c.account_type = ${add(f.accountType)}`);
  if (f.brands.length) w.push(`c.code IN (SELECT code FROM br WHERE brand_code = ANY(${add(f.brands)}::text[]))`);
  if (f.bought === "buyers") w.push(`COALESCE(t.sales_invoices, 0) > 0`);
  if (f.bought === "service") w.push(`COALESCE(t.sales_invoices, 0) = 0 AND COALESCE(t.service_invoices, 0) > 0`);
  if (f.bought === "none") w.push(`COALESCE(t.sales_invoices, 0) = 0 AND COALESCE(t.service_invoices, 0) = 0`);
  if (f.lastFrom) w.push(`COALESCE(t.last_sale, '') >= ${add(f.lastFrom)}`);
  if (f.lastTo) w.push(`COALESCE(t.last_sale, '') <> '' AND t.last_sale <= ${add(f.lastTo)}`);
  if (f.minRevenue != null) w.push(`COALESCE(t.sales_revenue, 0) >= ${add(f.minRevenue)}`);
  if (f.maxRevenue != null) w.push(`COALESCE(t.sales_revenue, 0) <= ${add(f.maxRevenue)}`);
  if (f.emailable) w.push(`${firstEmailSql(src)} <> ''`);
  return w.length ? `WHERE ${w.join(" AND ")}` : "";
}

const ORDER = {
  name: `upper(c.last_name), upper(c.first_name), c.code`,
  last: `COALESCE(t.last_sale, '') DESC, upper(c.last_name), c.code`,
  revenue: `COALESCE(t.sales_revenue, 0) DESC, upper(c.last_name), c.code`,
  since: `c.date_created DESC, c.code`,
  code: `c.code`
};

function baseSql(src, where) {
  return `WITH t0 AS (${totalsSql(src)}), br AS (${brandsSql(src)})
    SELECT c.code, c.name, c.first_name, c.last_name, c.account_type, c.salesperson, c.phones, c.emails,
           c.address1, c.address2, c.city, c.state, c.zip, c.parent_code, c.do_not_email, c.date_created, c.date_modified,
           c.last_activity, c.preferred_contact,
           ${firstEmailSql(src)} AS email_ok,
           EXISTS (SELECT 1 FROM unnest(c.emails) u(e) WHERE ${optedOutSql(src, "u.e")}) AS any_unsubscribed,
           COALESCE(t.sales_invoices, 0) AS sales_invoices, COALESCE(t.sales_revenue, 0) AS sales_revenue, COALESCE(t.first_sale, '') AS first_sale, COALESCE(t.last_sale, '') AS last_sale,
           COALESCE(t.service_invoices, 0) AS service_invoices, COALESCE(t.service_revenue, 0) AS service_revenue, COALESCE(t.last_service, '') AS last_service
      FROM epass_customers c LEFT JOIN t0 t ON t.code = c.code
      ${where}`;
}

const mapRow = (r) => ({
  code: r.code, name: r.name, firstName: r.first_name, lastName: r.last_name, accountType: r.account_type, salesperson: r.salesperson,
  phones: r.phones || [], emails: r.emails || [], address1: r.address1, address2: r.address2, city: r.city, state: r.state, zip: r.zip, parentCode: r.parent_code,
  doNotEmail: r.do_not_email, emailOk: r.email_ok || "", anyUnsubscribed: Boolean(r.any_unsubscribed),
  dateCreated: r.date_created, dateModified: r.date_modified, lastActivity: r.last_activity || "", preferredContact: r.preferred_contact || "",
  salesInvoices: Number(r.sales_invoices) || 0, salesRevenue: r2(Number(r.sales_revenue) || 0), firstSale: r.first_sale || "", lastSale: r.last_sale || "",
  serviceInvoices: Number(r.service_invoices) || 0, serviceRevenue: r2(Number(r.service_revenue) || 0), lastService: r.last_service || ""
});

// The Salesperson list (11/20): every code on a finished sales order, plus
// any ePASS has on a customer, with how many customers each would show,
// their last sale and a name (the employee directory, archived entries
// included, else the commission reports' salesperson names). "recent" = a sale in the last two years.
async function salespeopleFacet(pool, src) {
  const sold = src.sod
    ? `SELECT DISTINCT salesperson_code AS sp, upper(customer_number) AS code FROM sales_order_detail WHERE salesperson_code <> '' AND customer_number <> '' AND ${SALES_RE} UNION `
    : "";
  const counts = (await pool.query(`SELECT p.sp, COUNT(*)::int AS customers
      FROM (${sold}SELECT salesperson AS sp, code FROM epass_customers WHERE salesperson <> '') p
      JOIN epass_customers c ON c.code = p.code GROUP BY p.sp`)).rows;
  const last = src.sod
    ? new Map((await pool.query(`SELECT salesperson_code AS sp, MAX(finish_date) AS d FROM sales_order_detail WHERE salesperson_code <> '' AND finish_date <> '' AND ${SALES_RE} GROUP BY 1`)).rows.map((r) => [r.sp, r.d || ""]))
    : new Map();
  // Names: the employee directory (User Admin, archived former staff
  // included) wins, because it's typed by hand; else the name the
  // commission reports gave the code, in ordinary case if it came in capitals.
  const names = new Map();
  const spc = await pool.query(`SELECT upper(code) AS code, COALESCE(NULLIF(trim(name), ''), normalized_name) AS name FROM salesperson_codes WHERE COALESCE(NULLIF(trim(name), ''), normalized_name) <> ''`).catch(() => ({ rows: [] }));
  for (const r of spc.rows) names.set(r.code, r.name === r.name.toUpperCase() ? properCase(r.name) : r.name);
  const dir = await pool.query(`SELECT upper(trim(code)) AS code, trim(name) AS name FROM employee_directory WHERE trim(name) <> '' AND trim(code) <> ''`).catch(() => ({ rows: [] }));
  for (const r of dir.rows) names.set(r.code, r.name);
  const cutoff = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
  return counts
    .filter((r) => r.sp && r.customers > 0)
    .map((r) => { const lastSale = last.get(r.sp) || ""; return { code: r.sp, name: names.get(String(r.sp).toUpperCase()) || "", customers: r.customers, lastSale, recent: lastSale >= cutoff }; })
    .sort((a, b) => Number(b.recent) - Number(a.recent) || (a.name || a.code).localeCompare(b.name || b.code) || a.code.localeCompare(b.code));
}

export async function customerMasterMeta() {
  const pool = await getReadyPool();
  const src = await sources(pool);
  const parts = (await pool.query(`SELECT part, pulled_at, rows, filename, updated_at FROM customer_master_meta`)).rows;
  const master = await getEpassCustomersMeta();
  let historyFrom = "";
  if (!src.lifetimeTotals && src.sod) historyFrom = (await pool.query(`SELECT MIN(finish_date) AS d FROM sales_order_detail WHERE finish_date <> ''`)).rows[0]?.d || "";
  const facets = (await pool.query(`SELECT
      (SELECT array_agg(DISTINCT account_type ORDER BY account_type) FROM epass_customers WHERE account_type <> '') AS account_types`)).rows[0];
  const salespeople = await salespeopleFacet(pool, src);
  const brands = (await pool.query(`WITH br AS (${brandsSql(src)}) SELECT brand_code, MAX(brand) AS brand, COUNT(DISTINCT code)::int AS customers FROM br GROUP BY brand_code ORDER BY customers DESC, brand_code LIMIT 300`)).rows;
  return {
    customers: master.count, masterPulledAt: master.pulledAt, masterUpdatedAt: master.updatedAt,
    lifetime: { totals: src.lifetimeTotals, brands: src.lifetimeBrands, asOf: src.asOf.sales || src.asOf.service || "" },
    parts: Object.fromEntries(parts.map((p) => [p.part, { pulledAt: p.pulled_at, rows: p.rows, at: p.updated_at?.toISOString?.() || null }])),
    historyFrom,
    salespeople, accountTypes: facets.account_types || [],
    brands: brands.map((b) => ({ code: b.brand_code, name: properBrandName(b.brand_code, b.brand), customers: b.customers }))
  };
}

export async function listCustomerMaster(rawFilters = {}, { limit = 100, offset = 0 } = {}) {
  const pool = await getReadyPool();
  const src = await sources(pool);
  const f = cleanFilters(rawFilters);
  const params = [];
  const where = whereFor(f, src, params);
  const base = baseSql(src, where);
  const lim = Math.min(500, Math.max(1, Number(limit) || 100)), off = Math.max(0, Number(offset) || 0);
  const [rows, sum] = await Promise.all([
    pool.query(`${base} ORDER BY ${ORDER[f.sort]} LIMIT ${lim} OFFSET ${off}`, params),
    pool.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE email_ok <> '')::int AS emailable, COALESCE(SUM(sales_revenue), 0)::float AS revenue,
                       COUNT(*) FILTER (WHERE sales_invoices > 0)::int AS buyers FROM (${base}) x`, params)
  ]);
  const list = rows.rows.map(mapRow);
  // the brands each customer on this page has bought, most-bought first
  if (list.length) {
    const b = await pool.query(`WITH br AS (${brandsSql(src)}) SELECT code, brand_code, brand, lines, last_bought FROM br WHERE code = ANY($1::text[]) ORDER BY code, lines DESC, last_bought DESC`, [list.map((c) => c.code)]);
    const by = new Map();
    for (const r of b.rows) { const a = by.get(r.code) || []; a.push({ code: r.brand_code, name: properBrandName(r.brand_code, r.brand), lines: Number(r.lines) || 0, last: r.last_bought || "" }); by.set(r.code, a); }
    for (const c of list) c.brands = by.get(c.code) || [];
  }
  const s = sum.rows[0];
  return { filters: f, total: s.n, emailable: s.emailable, buyers: s.buyers, revenue: r2(s.revenue), offset: off, limit: lim, customers: list };
}

// Every customer matching the filters (for the CSV), brands joined as text.
export async function exportCustomerMaster(rawFilters = {}, { max = 200000 } = {}) {
  const pool = await getReadyPool();
  const src = await sources(pool);
  const f = cleanFilters(rawFilters);
  const params = [];
  const where = whereFor(f, src, params);
  const r = await pool.query(`${baseSql(src, where)} ORDER BY ${ORDER[f.sort]} LIMIT ${Math.min(200000, Math.max(1, max))}`, params);
  const list = r.rows.map(mapRow);
  const brandRows = list.length ? (await pool.query(`SELECT code, brand_code, brand, lines FROM (${brandsSql(src)}) b ORDER BY code, lines DESC, brand_code`)).rows : [];
  const names = new Map();
  for (const b of brandRows) { const a = names.get(b.code) || []; a.push(properBrandName(b.brand_code, b.brand)); names.set(b.code, a); }
  return { filters: f, lifetime: src.lifetimeTotals, rows: list.map((c) => ({ ...c, brandList: (names.get(c.code) || []).join("; ") })) };
}

// ---- CSV -------------------------------------------------------------------
const csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // a spreadsheet must never run a cell as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const phoneText = (p) => (/^\d{10}$/.test(p) ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p);
export function customerMasterCsv(rows) {
  const head = ["Customer #", "Name", "First name", "Last name", "Account type", "Salesperson", "Email to use", "Email status", "All emails", "Phones",
    "Address", "Address 2", "City", "State", "ZIP", "Parent account", "Customer since", "Last activity (ePASS)", "Preferred contact",
    "Sales invoices", "Sales revenue (pre-tax)", "First purchase", "Last purchase", "Service visits", "Service revenue (pre-tax)", "Last service", "Brands bought"];
  const lines = [head.map(csvCell).join(",")];
  for (const c of rows) {
    const status = c.emailOk ? "OK" : !c.emails.length ? "No email" : c.doNotEmail ? "Do Not Email (ePASS)" : c.anyUnsubscribed ? "Unsubscribed" : "No email";
    lines.push([c.code, c.name, c.firstName, c.lastName, c.accountType, c.salesperson, c.emailOk, status, c.emails.join("; "), c.phones.map(phoneText).join("; "),
      c.address1, c.address2, c.city, c.state, c.zip, c.parentCode, c.dateCreated, c.lastActivity, c.preferredContact,
      c.salesInvoices, c.salesRevenue.toFixed(2), c.firstSale, c.lastSale, c.serviceInvoices, c.serviceRevenue.toFixed(2), c.lastService, c.brandList].map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ---- add to an event's guest list --------------------------------------------
export const ADD_TO_EVENT_MAX = 500;

// ePASS names are in capitals ("BRUNO DEBBIE"); the guest list and the
// emails' {first name} read better in ordinary case.
export function properCase(v) {
  return String(v || "").toLowerCase().replace(/(^|[\s\-'(/&.])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, a) => "Mc" + a.toUpperCase())
    .replace(/\b(Llc|Inc|Ii|Iii|Iv|Pc|Lp|Llp)\b/g, (m) => (m === "Llc" ? "LLC" : m === "Pc" ? "PC" : m === "Lp" ? "LP" : m === "Llp" ? "LLP" : m === "Inc" ? "Inc" : m.toUpperCase()))
    .replace(/\s+/g, " ").trim();
}

// codes: the customers ticked on the page (or, with none, every customer the
// filters match). Only emailable ones are added; nobody is emailed.
export async function addCustomersToEvent({ eventId, guestType = "", codes = null, filters = null, by = "" }) {
  const pool = await getReadyPool();
  const src = await sources(pool);
  const ev = (await pool.query(`SELECT id, name, guest_types FROM agility_events WHERE id = $1`, [eventId])).rows[0];
  if (!ev) throw new Error("Event not found.");
  const types = Array.isArray(ev.guest_types) ? ev.guest_types : [];
  const gt = types.find((t) => String(t?.name || "").toLowerCase() === String(guestType || "").trim().toLowerCase())?.name || "";
  let where, params = [];
  if (Array.isArray(codes) && codes.length) {
    const list = [...new Set(codes.map((c) => String(c || "").trim().toUpperCase()).filter(Boolean))];
    if (list.length > ADD_TO_EVENT_MAX) throw Object.assign(new Error(`That's ${list.length.toLocaleString()} customers — tick ${ADD_TO_EVENT_MAX} or fewer at a time.`), { status: 400 });
    where = `WHERE c.code = ANY($1::text[])`; params = [list];
  } else {
    const f = cleanFilters(filters || {});
    where = whereFor(f, src, params);
  }
  const base = baseSql(src, where);
  const tally = (await pool.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE email_ok <> '')::int AS ok,
      COUNT(*) FILTER (WHERE email_ok = '' AND cardinality(emails) = 0)::int AS no_email,
      COUNT(*) FILTER (WHERE email_ok = '' AND cardinality(emails) > 0 AND do_not_email)::int AS dne,
      COUNT(*) FILTER (WHERE email_ok = '' AND cardinality(emails) > 0 AND NOT do_not_email)::int AS unsub
    FROM (${base}) x`, params)).rows[0];
  if (tally.ok > ADD_TO_EVENT_MAX) throw Object.assign(new Error(`${tally.ok.toLocaleString()} of these customers can be emailed — narrow the list to ${ADD_TO_EVENT_MAX} or fewer, or tick the ones to add.`), { status: 400 });
  const usable = (await pool.query(`SELECT * FROM (${base}) x WHERE email_ok <> '' ORDER BY upper(last_name), upper(first_name), code`, params)).rows.map(mapRow);
  // Invited by (11/20): the salesperson the list was filtered by, else the
  // one ePASS has on the customer, else whoever made their latest sale.
  const filteredBy = !(Array.isArray(codes) && codes.length) ? cleanFilters(filters || {}).salesperson : "";
  const lastSoldBy = new Map();
  if (src.sod && usable.length) {
    const r = await pool.query(`SELECT DISTINCT ON (upper(customer_number)) upper(customer_number) AS code, salesperson_code AS sp
        FROM sales_order_detail WHERE upper(customer_number) = ANY($1::text[]) AND salesperson_code <> '' AND finish_date <> '' AND ${SALES_RE}
        ORDER BY upper(customer_number), finish_date DESC, invoice DESC`, [usable.map((c) => c.code)]);
    for (const x of r.rows) lastSoldBy.set(x.code, x.sp);
  }
  const skipped = { noEmail: tally.no_email, doNotEmail: tally.dne, unsubscribed: tally.unsub, alreadyOnList: 0 };
  const existing = new Set((await pool.query(`SELECT lower(email) AS e FROM agility_event_invitees WHERE event_id = $1 AND email <> ''`, [ev.id])).rows.map((r) => r.e));
  const rows = [];
  for (const c of usable) {
    const email = c.emailOk.toLowerCase();
    if (existing.has(email)) { skipped.alreadyOnList++; continue; }
    existing.add(email);
    const person = [properCase(c.firstName), properCase(c.lastName)].filter(Boolean).join(" ");
    const company = c.firstName ? "" : properCase(c.lastName); // no first name in ePASS: a company account
    rows.push([crypto.randomUUID(), ev.id, (person || properCase(c.name) || email).slice(0, 120), company.slice(0, 120), gt, email.slice(0, 120), (c.phones[0] || "").slice(0, 20),
      String(filteredBy || c.salesperson || lastSoldBy.get(c.code) || "").toUpperCase().slice(0, 60), "Planned", "", "", `From Customer Master · ePASS #${c.code}`.slice(0, 1000), 1, "customer-master"]);
  }
  if (rows.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await insertChunks(client, `INSERT INTO agility_event_invitees (id, event_id, name, company, guest_type, email, phone, invited_by, status, date_invited, follow_up, notes, guest_count, source)`, rows, 14, "", { 0: "::uuid", 1: "::uuid" });
      await client.query(`UPDATE agility_events SET updated_at = NOW(), updated_by = $2 WHERE id = $1`, [ev.id, String(by || "").slice(0, 120)]);
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
  }
  return { eventId: ev.id, eventName: ev.name, guestType: gt, matched: tally.n, added: rows.length, skipped };
}

export { phone10 };

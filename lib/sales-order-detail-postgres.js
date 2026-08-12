import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Sales Order Detail (sales-order-detail.html) — the durable, queryable
// per-order warehouse Andrew asked for. Two tables:
//
//   sales_order_detail — one row per sales order, fed by every OE-23
//   (Salesperson Activity Report) upload. Upsert by invoice, so re-running a
//   month refreshes its orders while history accumulates.
//
//   sales_order_lines — line items (models / warranty plans) from the
//   commission report. Lines have no natural unique key (the same model can
//   legitimately appear twice on one order), so each upload REPLACES its
//   month. Join rule: a line matches the order with the EXACT same invoice
//   (OE-23 keeps split orders as separate suffixed rows, e.g. "S00063116-8");
//   only when no exact order exists does a suffixed line roll up to its base
//   invoice ("AC00010530-1" → "AC00010530").
//
// When NetSuite arrives, its exports feed the same tables and every report
// built on top keeps working.
// ---------------------------------------------------------------------------

const SALES_ORDER_DETAIL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sales_order_detail (
  invoice TEXT PRIMARY KEY,
  department TEXT NOT NULL DEFAULT '',
  salesperson TEXT NOT NULL DEFAULT '',
  finish_date TEXT NOT NULL DEFAULT '',
  customer_number TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  list_product NUMERIC(14,2) NOT NULL DEFAULT 0,
  list_parts NUMERIC(14,2) NOT NULL DEFAULT 0,
  list_labor NUMERIC(14,2) NOT NULL DEFAULT 0,
  list_wty NUMERIC(14,2) NOT NULL DEFAULT 0,
  list_misc NUMERIC(14,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  invoice_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_month TEXT NOT NULL DEFAULT '',
  source_filename TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sales_order_detail ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_sod_finish_date ON sales_order_detail (finish_date);
CREATE INDEX IF NOT EXISTS idx_sod_department ON sales_order_detail (department);
CREATE INDEX IF NOT EXISTS idx_sod_salesperson ON sales_order_detail (salesperson);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id BIGSERIAL PRIMARY KEY,
  source_month TEXT NOT NULL,
  invoice TEXT NOT NULL DEFAULT '',
  base_invoice TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '',
  line_type TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  serial_number TEXT NOT NULL DEFAULT '',
  qty NUMERIC(10,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(14,4) NOT NULL DEFAULT 0,          -- 4dp: split commissions carry sub-cent values
  serial_type TEXT NOT NULL DEFAULT '',
  serial_cost NUMERIC(14,4),
  salesperson_code TEXT NOT NULL DEFAULT '',
  salesperson_name TEXT NOT NULL DEFAULT '',
  split BOOLEAN NOT NULL DEFAULT FALSE,
  split_partners TEXT NOT NULL DEFAULT '',
  source_filename TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS serial_number TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS split BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS split_partners TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_sol_base_invoice ON sales_order_lines (base_invoice);
CREATE INDEX IF NOT EXISTS idx_sol_invoice ON sales_order_lines (invoice);
CREATE INDEX IF NOT EXISTS idx_sol_month ON sales_order_lines (source_month);

ALTER TABLE sales_order_detail ADD COLUMN IF NOT EXISTS salesperson_code TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS salesperson_codes (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  normalized_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE salesperson_codes ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_spc_normalized ON salesperson_codes (normalized_name);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(SALES_ORDER_DETAIL_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Commission lines carry sub-cent precision (split commissions); keep 4dp so
// sums reconcile to the source report exactly.
function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

// "Christian Houde" / "CHRISTIAN  HOUDE" → "CHRISTIAN HOUDE" so the OE-23
// (uppercase names) and commission report (mixed case) key the same person.
export function normalizeSalespersonName(name) {
  return String(name || "").toUpperCase().replace(/[\s\u00a0]+/g, " ").trim();
}

// Learn code ↔ name pairs (from commission report sections) and stamp
// matching order rows. Safe to run repeatedly.
async function syncSalespersonCodes(pool, pairs) {
  for (const { code, name } of pairs) {
    if (!code) continue;
    await pool.query(
      `INSERT INTO salesperson_codes (code, name, normalized_name, source, updated_at)
       VALUES ($1, $2, $3, 'commission', NOW())
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         normalized_name = EXCLUDED.normalized_name,
         source = 'commission',
         updated_at = NOW()`,
      [String(code).toUpperCase(), String(name || ""), normalizeSalespersonName(name)]
    );
  }
}

// Fallback teacher: the employee directory (User Admin) carries the same
// ePASS codes with properly spelled/cased names. Never overwrites a
// commission-learned pair (ON CONFLICT DO NOTHING).
async function syncDirectoryCodes(pool) {
  try {
    await pool.query(
      `INSERT INTO salesperson_codes (code, name, normalized_name, source, updated_at)
       SELECT upper(trim(code)), name, upper(regexp_replace(trim(name), '\\s+', ' ', 'g')), 'directory', NOW()
       FROM employee_directory
       WHERE trim(code) <> '' AND trim(name) <> ''
       ON CONFLICT (code) DO NOTHING`
    );
  } catch (err) {
    // Directory table may not exist yet in a fresh environment — fall back
    // silently; commission uploads still teach the mapping.
    console.error("Salesperson code directory sync skipped:", err.message);
  }
}

// Orphan split halves: when a split partner is absent from the commission
// report (their half lives on their own suffixed order, or they aren't
// commissioned), the present half shows ~50% revenue against 100% serial
// cost — and there is no matching row to merge. The OE-23 order row carries
// the WHOLE product/warranty revenue, so reconcile against it: if an
// order's model lines sum well below its list_product (ratio > 1.2, capped
// at 4x for safety), scale every line up to the order total and flag split.
// Runs after both uploads; already-whole orders sit at ratio ≈ 1 and are
// untouched, so it is idempotent.
async function reconcileLineRevenue(pool) {
  for (const [lineType, column] of [["Model", "list_product"], ["Wty", "list_wty"]]) {
    await pool.query(
      `WITH attach AS (
         SELECT l.id, o.invoice AS order_invoice, o.${column} AS target
         FROM sales_order_detail o
         JOIN sales_order_lines l
           ON l.invoice = o.invoice
           OR (l.base_invoice = o.invoice
               AND l.invoice <> o.invoice
               AND NOT EXISTS (SELECT 1 FROM sales_order_detail od WHERE od.invoice = l.invoice))
         WHERE l.line_type = $1
       ),
       sums AS (
         SELECT a.order_invoice, a.target, SUM(l.revenue) AS line_sum
         FROM attach a JOIN sales_order_lines l ON l.id = a.id
         GROUP BY a.order_invoice, a.target
         HAVING SUM(l.revenue) > 0
            AND a.target / SUM(l.revenue) > 1.2
            AND a.target / SUM(l.revenue) <= 4
       )
       UPDATE sales_order_lines l
       SET revenue = ROUND(l.revenue * s.target / s.line_sum, 4),
           split = TRUE
       FROM attach a, sums s
       WHERE l.id = a.id AND a.order_invoice = s.order_invoice`,
      [lineType]
    );
  }
}

async function applyCodesToOrders(pool) {
  await syncDirectoryCodes(pool);
  // One code per name: commission-learned entries outrank directory entries.
  await pool.query(
    `UPDATE sales_order_detail o
     SET salesperson_code = m.code
     FROM (
       SELECT DISTINCT ON (normalized_name) normalized_name, code
       FROM salesperson_codes
       WHERE normalized_name <> ''
       ORDER BY normalized_name, (source <> 'commission'), updated_at DESC
     ) m
     WHERE upper(regexp_replace(o.salesperson, '\\s+', ' ', 'g')) = m.normalized_name
       AND o.salesperson_code IS DISTINCT FROM m.code`
  );
}

// OE-23 tickets (from lib/salesperson-activity.js parseActivityGrid) → order
// rows. Returns the number of rows written.
export async function upsertOrdersFromActivity(tickets, { sourceMonth, filename }) {
  if (!Array.isArray(tickets) || !tickets.length) return 0;
  const pool = await getReadyPool();
  let written = 0;

  for (const t of tickets) {
    const list = t.list || {};
    const cost = t.cost || {};
    const profit = t.profit || {};
    await pool.query(
      `INSERT INTO sales_order_detail (
         invoice, department, salesperson, finish_date, customer_number, customer_name, reference,
         list_product, list_parts, list_labor, list_wty, list_misc,
         revenue, invoice_total, cost, profit, detail,
         source_month, source_filename, service_type, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,NOW())
       ON CONFLICT (invoice) DO UPDATE SET
         service_type = EXCLUDED.service_type,
         department = EXCLUDED.department,
         salesperson = EXCLUDED.salesperson,
         finish_date = EXCLUDED.finish_date,
         customer_number = EXCLUDED.customer_number,
         customer_name = EXCLUDED.customer_name,
         reference = EXCLUDED.reference,
         list_product = EXCLUDED.list_product,
         list_parts = EXCLUDED.list_parts,
         list_labor = EXCLUDED.list_labor,
         list_wty = EXCLUDED.list_wty,
         list_misc = EXCLUDED.list_misc,
         revenue = EXCLUDED.revenue,
         invoice_total = EXCLUDED.invoice_total,
         cost = EXCLUDED.cost,
         profit = EXCLUDED.profit,
         detail = EXCLUDED.detail,
         source_month = EXCLUDED.source_month,
         source_filename = EXCLUDED.source_filename,
         updated_at = NOW()`,
      [
        String(t.invoice || "").toUpperCase(),
        String(t.department || ""),
        String(t.salesperson || ""),
        String(t.finishDate || ""),
        String(t.customerNumber || ""),
        String(t.customerName || ""),
        String(t.reference || ""),
        round2(list.product), round2(list.parts), round2(list.labor), round2(list.wty), round2(list.misc),
        round2(list.totalNoTax), round2(list.invoiceTotal),
        round2(cost.totalNoTax),
        round2(profit.totalNoTax != null ? profit.totalNoTax : round2(list.totalNoTax) - round2(cost.totalNoTax)),
        JSON.stringify({ list, cost, profit }),
        String(sourceMonth || ""),
        String(filename || "").slice(0, 300),
        String(t.serviceType || "")
      ]
    );
    written++;
  }
  await applyCodesToOrders(pool);
  await reconcileLineRevenue(pool);
  return written;
}

// Commission-report lines replace their month wholesale (no natural key).
export async function replaceCommissionLines(sourceMonth, lines, { filename }) {
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM sales_order_lines WHERE source_month = $1`, [sourceMonth]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO sales_order_lines (
           source_month, invoice, base_invoice, customer, line_type, product, serial_number,
           qty, revenue, serial_type, serial_cost, salesperson_code, salesperson_name,
           split, split_partners, source_filename
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          sourceMonth,
          String(l.invoice || ""),
          String(l.baseInvoice || ""),
          String(l.customer || ""),
          String(l.lineType || ""),
          String(l.product || ""),
          String(l.serialNumber || ""),
          round2(l.qty),
          round4(l.revenue),
          String(l.serialType || ""),
          l.serialCost == null ? null : round4(l.serialCost),
          String(l.salespersonCode || ""),
          String(l.salespersonName || ""),
          Boolean(l.split),
          String(l.splitPartners || ""),
          String(filename || "").slice(0, 300)
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Every commission upload carries code ↔ name pairs in its section
  // headers — learn them, then stamp matching order rows.
  const pairs = new Map();
  for (const l of lines) {
    if (l.salespersonCode && !l.split) pairs.set(String(l.salespersonCode).toUpperCase(), l.salespersonName || "");
  }
  await syncSalespersonCodes(pool, [...pairs].map(([code, name]) => ({ code, name })));
  await applyCodesToOrders(pool);
  await reconcileLineRevenue(pool);

  return lines.length;
}

function mapOrderRow(row) {
  return {
    invoice: row.invoice,
    department: row.department,
    // Display the properly-cased name from the code mapping (directory /
    // commission report); the raw OE-23 all-caps name is the fallback.
    salesperson: (row.proper_name || "").trim() || row.salesperson,
    salespersonRaw: row.salesperson,
    salespersonCode: row.salesperson_code || "",
    serviceType: row.service_type || "",
    finishDate: row.finish_date,
    customerNumber: row.customer_number,
    customerName: row.customer_name,
    reference: row.reference,
    listProduct: Number(row.list_product),
    listParts: Number(row.list_parts),
    listLabor: Number(row.list_labor),
    listWty: Number(row.list_wty),
    listMisc: Number(row.list_misc),
    revenue: Number(row.revenue),
    invoiceTotal: Number(row.invoice_total),
    cost: Number(row.cost),
    profit: Number(row.profit),
    sourceMonth: row.source_month,
    sourceFilename: row.source_filename,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null,
    lineCount: row.line_count != null ? Number(row.line_count) : undefined
  };
}

function mapLineRow(row) {
  return {
    id: Number(row.id),
    sourceMonth: row.source_month,
    invoice: row.invoice,
    baseInvoice: row.base_invoice,
    customer: row.customer,
    lineType: row.line_type,
    product: row.product,
    serialNumber: row.serial_number || "",
    qty: Number(row.qty),
    revenue: Number(row.revenue),
    serialType: row.serial_type,
    serialCost: row.serial_cost == null ? null : Number(row.serial_cost),
    salespersonCode: row.salesperson_code,
    salespersonName: row.salesperson_name,
    split: Boolean(row.split),
    splitPartners: row.split_partners || ""
  };
}

// Orders in a finish-date range, with a per-order commission line count so
// the report can show which orders have item detail.
export async function listOrderDetail({ startDate, endDate, department, salesperson }) {
  const pool = await getReadyPool();
  const where = [`finish_date >= $1`, `finish_date <= $2`];
  const params = [String(startDate), String(endDate)];
  if (department) {
    params.push(String(department));
    where.push(`department = $${params.length}`);
  }
  if (salesperson) {
    params.push(String(salesperson));
    where.push(`salesperson = $${params.length}`);
  }
  const result = await pool.query(
    `SELECT o.*, sc.name AS proper_name, (
       SELECT COUNT(*) FROM sales_order_lines l
       WHERE l.invoice = o.invoice
          OR (l.base_invoice = o.invoice
              AND l.invoice <> o.invoice
              AND NOT EXISTS (SELECT 1 FROM sales_order_detail od WHERE od.invoice = l.invoice))
     ) AS line_count
     FROM sales_order_detail o
     LEFT JOIN salesperson_codes sc ON sc.code = o.salesperson_code
     WHERE ${where.join(" AND ")}
     ORDER BY finish_date DESC, invoice DESC
     LIMIT 5000`,
    params
  );
  return result.rows.map(mapOrderRow);
}

// Flat line-item report — every commission line attached to an order in the
// range (same exact-then-base join rule), enriched with the order's fields so
// each row is self-contained. Built for big pulls (a year is ~11k lines).
export async function listOrderLineDetail({ startDate, endDate, department, salesperson }) {
  const pool = await getReadyPool();
  const where = [`o.finish_date >= $1`, `o.finish_date <= $2`];
  const params = [String(startDate), String(endDate)];
  if (department) {
    params.push(String(department));
    where.push(`o.department = $${params.length}`);
  }
  if (salesperson) {
    params.push(String(salesperson));
    where.push(`o.salesperson = $${params.length}`);
  }
  const result = await pool.query(
    `SELECT l.*,
            o.invoice AS order_invoice,
            o.department AS order_department,
            o.salesperson AS order_salesperson,
            o.salesperson_code AS order_salesperson_code,
            o.finish_date AS order_finish_date,
            o.customer_name AS order_customer_name,
            sc.name AS order_proper_name
     FROM sales_order_detail o
     LEFT JOIN salesperson_codes sc ON sc.code = o.salesperson_code
     JOIN sales_order_lines l
       ON l.invoice = o.invoice
       OR (l.base_invoice = o.invoice
           AND l.invoice <> o.invoice
           AND NOT EXISTS (SELECT 1 FROM sales_order_detail od WHERE od.invoice = l.invoice))
     WHERE ${where.join(" AND ")}
     ORDER BY o.finish_date DESC, o.invoice DESC, l.id
     LIMIT 50000`,
    params
  );
  return result.rows.map((row) => ({
    ...mapLineRow(row),
    orderInvoice: row.order_invoice,
    department: row.order_department,
    salesperson: (row.order_proper_name || "").trim() || row.order_salesperson,
    orderSalespersonCode: row.order_salesperson_code || "",
    finishDate: row.order_finish_date,
    orderCustomerName: row.order_customer_name
  }));
}

// What's feeding the report: latest OE-23 upload per month (from the
// revenue_performance snapshot) and commission upload per month.
export async function listSourceVersions() {
  const pool = await getReadyPool();
  let oe23 = [];
  try {
    const r = await pool.query(
      `SELECT month, filename, uploaded_at, ticket_count FROM revenue_performance ORDER BY month DESC LIMIT 60`
    );
    oe23 = r.rows.map((row) => ({
      month: row.month,
      filename: row.filename,
      uploadedAt: row.uploaded_at?.toISOString?.() || null,
      tickets: Number(row.ticket_count)
    }));
  } catch {
    // revenue_performance not created yet — no OE-23 uploads.
  }
  const c = await pool.query(
    `SELECT source_month, MAX(source_filename) AS filename, MAX(uploaded_at) AS uploaded_at, COUNT(*) AS lines
     FROM sales_order_lines GROUP BY source_month ORDER BY source_month DESC LIMIT 60`
  );
  const commissions = c.rows.map((row) => ({
    month: row.source_month,
    filename: row.filename,
    uploadedAt: row.uploaded_at?.toISOString?.() || null,
    lines: Number(row.lines)
  }));
  return { oe23, commissions };
}

// Field Sales Commissions — every commission line for one source month, in
// the camelCase shape lib/field-sales-commissions.js computes from. Split
// lines come back whole (as stored) with their combined code + partners;
// the engine allocates the shares.
export async function listCommissionLinesForMonths(months) {
  const pool = await getReadyPool();
  const list = (Array.isArray(months) ? months : [months]).map(String).filter(Boolean);
  if (!list.length) return [];
  const result = await pool.query(
    `SELECT source_month, invoice, base_invoice, customer, line_type, product,
            serial_number, qty, revenue, serial_type, serial_cost,
            salesperson_code, salesperson_name, split, split_partners
     FROM sales_order_lines
     WHERE source_month = ANY($1)
     ORDER BY salesperson_code, invoice, id`,
    [list]
  );
  return result.rows.map((row) => ({
    sourceMonth: row.source_month,
    invoice: row.invoice,
    baseInvoice: row.base_invoice,
    customer: row.customer,
    lineType: row.line_type,
    product: row.product,
    serialNumber: row.serial_number || "",
    qty: Number(row.qty),
    revenue: Number(row.revenue),
    serialType: row.serial_type || "",
    serialCost: row.serial_cost == null ? null : Number(row.serial_cost),
    salespersonCode: (row.salesperson_code || "").toUpperCase(),
    salespersonName: row.salesperson_name || "",
    split: !!row.split,
    splitPartners: row.split_partners || ""
  }));
}

// ---------------------------------------------------------------------------
// Commission line overrides (Field Sales Commissions) — exec corrections that
// survive re-uploads: list price, serial cost, payout rate, and 100%-credit
// reassignment of split lines. Keyed by a stable line fingerprint (month +
// invoice + line type + product + serial + salesperson code + occurrence),
// NOT the row id, because replaceCommissionLines re-inserts every upload.
// ---------------------------------------------------------------------------

const OVERRIDES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS commission_line_overrides (
  line_key TEXT PRIMARY KEY,
  source_month TEXT NOT NULL DEFAULT '',
  list_price NUMERIC(14,2),
  serial_cost NUMERIC(14,2),
  rate NUMERIC(7,5),
  full_credit_to TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clo_month ON commission_line_overrides (source_month);
`;

let overridesEnsured = null;
async function ensureOverridesTable(pool) {
  if (!overridesEnsured) overridesEnsured = pool.query(OVERRIDES_SCHEMA_SQL);
  await overridesEnsured;
}

export async function listCommissionOverrides(months) {
  const pool = await getReadyPool();
  await ensureOverridesTable(pool);
  const list = (Array.isArray(months) ? months : [months]).map(String).filter(Boolean);
  if (!list.length) return {};
  const result = await pool.query(
    `SELECT * FROM commission_line_overrides WHERE source_month = ANY($1)`,
    [list]
  );
  const map = {};
  for (const row of result.rows) {
    map[row.line_key] = {
      listPrice: row.list_price == null ? null : Number(row.list_price),
      serialCost: row.serial_cost == null ? null : Number(row.serial_cost),
      rate: row.rate == null ? null : Number(row.rate),
      fullCreditTo: row.full_credit_to || "",
      note: row.note || "",
      updatedBy: row.updated_by || "",
      updatedAt: row.updated_at?.toISOString?.() || null
    };
  }
  return map;
}

// Upsert an override; when every overridable field is empty the row is
// deleted (a full clear).
export async function saveCommissionOverride({ lineKey, sourceMonth, listPrice = null, serialCost = null, rate = null, fullCreditTo = "", note = "", byEmail = "" }) {
  const pool = await getReadyPool();
  await ensureOverridesTable(pool);
  const key = String(lineKey || "").slice(0, 500);
  if (!key) throw new Error("Missing line key.");
  const empty = listPrice == null && serialCost == null && rate == null && !fullCreditTo && !String(note || "").trim();
  if (empty) {
    await pool.query(`DELETE FROM commission_line_overrides WHERE line_key = $1`, [key]);
    return null;
  }
  const result = await pool.query(
    `INSERT INTO commission_line_overrides (line_key, source_month, list_price, serial_cost, rate, full_credit_to, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (line_key) DO UPDATE SET
       source_month = EXCLUDED.source_month,
       list_price = EXCLUDED.list_price,
       serial_cost = EXCLUDED.serial_cost,
       rate = EXCLUDED.rate,
       full_credit_to = EXCLUDED.full_credit_to,
       note = EXCLUDED.note,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING line_key`,
    [
      key,
      String(sourceMonth || "").slice(0, 7),
      listPrice, serialCost, rate,
      String(fullCreditTo || "").toUpperCase().slice(0, 10),
      String(note || "").trim().slice(0, 300),
      String(byEmail || "").trim().toLowerCase().slice(0, 200)
    ]
  );
  return result.rows[0]?.line_key || null;
}

// ---------------------------------------------------------------------------
// Paid-balance checks (Field Sales Commissions) — a finished Invoice
// Maintenance export uploaded against a statement month. Only UNPAID
// invoices (balance > 0) are stored; an invoice absent from a stored check
// is treated as paid. Upload replaces the month's check.
// ---------------------------------------------------------------------------

const BALANCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS commission_balance_uploads (
  month TEXT PRIMARY KEY,
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invoice_count INTEGER NOT NULL DEFAULT 0,
  unpaid_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS commission_balance_unpaid (
  month TEXT NOT NULL,
  invoice TEXT NOT NULL,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (month, invoice)
);
`;

let balanceEnsured = null;
async function ensureBalanceTables(pool) {
  if (!balanceEnsured) balanceEnsured = pool.query(BALANCE_SCHEMA_SQL);
  await balanceEnsured;
}

export async function saveCommissionBalanceCheck({ month, rows, filename, byEmail }) {
  const pool = await getReadyPool();
  await ensureBalanceTables(pool);
  const unpaid = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ invoice: String(r.invoice || "").trim().toUpperCase().slice(0, 40), balance: Number(r.balance) }))
    .filter((r) => r.invoice && Number.isFinite(r.balance) && r.balance > 0);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM commission_balance_unpaid WHERE month = $1`, [month]);
    for (const r of unpaid) {
      await client.query(
        `INSERT INTO commission_balance_unpaid (month, invoice, balance) VALUES ($1, $2, $3)
         ON CONFLICT (month, invoice) DO UPDATE SET balance = GREATEST(commission_balance_unpaid.balance, EXCLUDED.balance)`,
        [month, r.invoice, Math.round(r.balance * 100) / 100]
      );
    }
    await client.query(
      `INSERT INTO commission_balance_uploads (month, filename, uploaded_by, uploaded_at, invoice_count, unpaid_count)
       VALUES ($1, $2, $3, NOW(), $4, $5)
       ON CONFLICT (month) DO UPDATE SET
         filename = EXCLUDED.filename, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = NOW(),
         invoice_count = EXCLUDED.invoice_count, unpaid_count = EXCLUDED.unpaid_count`,
      [month, String(filename || "").slice(0, 200), String(byEmail || "").trim().toLowerCase().slice(0, 200), rows.length, unpaid.length]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { month, invoiceCount: rows.length, unpaidCount: unpaid.length };
}

export async function listCommissionBalanceChecks(months) {
  const pool = await getReadyPool();
  await ensureBalanceTables(pool);
  const list = (Array.isArray(months) ? months : [months]).map(String).filter(Boolean);
  if (!list.length) return {};
  const [uploads, unpaid] = await Promise.all([
    pool.query(`SELECT * FROM commission_balance_uploads WHERE month = ANY($1)`, [list]),
    pool.query(`SELECT month, invoice, balance FROM commission_balance_unpaid WHERE month = ANY($1)`, [list])
  ]);
  const out = {};
  for (const row of uploads.rows) {
    out[row.month] = {
      filename: row.filename,
      uploadedBy: row.uploaded_by,
      uploadedAt: row.uploaded_at?.toISOString?.() || null,
      invoiceCount: Number(row.invoice_count),
      unpaidCount: Number(row.unpaid_count),
      balances: {}
    };
  }
  for (const row of unpaid.rows) {
    if (out[row.month]) out[row.month].balances[row.invoice] = Number(row.balance);
  }
  return out;
}

// All commission source months present in the warehouse, newest first.
export async function listCommissionMonths() {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT DISTINCT source_month FROM sales_order_lines ORDER BY source_month DESC`
  );
  return result.rows.map((row) => row.source_month);
}

// Proper-cased display names for every known salesperson code.
export async function listSalespersonNames() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT code, name FROM salesperson_codes`);
  const names = {};
  for (const row of result.rows) names[String(row.code).toUpperCase()] = row.name;
  return names;
}

// Returns report — every negative-quantity commission line (returns / RTV /
// swap-outs), keyed by the commission month it hit, enriched with the order
// when one exists in the warehouse. The export has no serial NUMBER column,
// so granularity is the individual unit line (product + serial type + cost).
export async function listReturnLines({ startMonth, endMonth }) {
  const pool = await getReadyPool();
  // Each return is matched back to its original SALE line anywhere in the
  // commission history (the unfiltered report carries every sale):
  //   tier 0 — same product + same SERIAL NUMBER (v2 exports; definitive)
  //   tier 1 — same base invoice + product (swap / re-ring on the order)
  //   tier 2 — same customer + product (sold on an earlier order)
  //   tier 3 — same product + identical serial cost (each serial carries its
  //            own cost, so an exact cost match fingerprints the unit)
  // Within a tier, an exact serial-cost match wins, then the most recent
  // sale at or before the return's commission month.
  const result = await pool.query(
    `SELECT l.*,
            o.invoice AS order_invoice,
            o.department AS order_department,
            o.finish_date AS order_finish_date,
            o.customer_name AS order_customer_name,
            o.salesperson AS order_salesperson,
            o.salesperson_code AS order_salesperson_code,
            sc.name AS order_proper_name,
            sale.invoice AS sale_invoice,
            sale.source_month AS sale_month,
            sale.revenue AS sale_revenue,
            sale.serial_cost AS sale_serial_cost,
            sale.salesperson_code AS sale_sp_code,
            sale.tier AS sale_match_tier,
            sale.cost_match AS sale_cost_match,
            sale.serial_number AS sale_serial_number
     FROM sales_order_lines l
     LEFT JOIN sales_order_detail o
       ON o.invoice = l.invoice
       OR (o.invoice = l.base_invoice
           AND l.invoice <> l.base_invoice
           AND NOT EXISTS (SELECT 1 FROM sales_order_detail od WHERE od.invoice = l.invoice))
     LEFT JOIN salesperson_codes sc ON sc.code = o.salesperson_code
     LEFT JOIN LATERAL (
       SELECT s.invoice, s.source_month, s.revenue, s.serial_cost, s.salesperson_code, s.serial_number,
              CASE
                WHEN s.serial_number <> '' AND s.serial_number = l.serial_number THEN 0
                WHEN s.base_invoice = l.base_invoice THEN 1
                WHEN upper(trim(s.customer)) = upper(trim(l.customer)) AND l.customer <> '' THEN 2
                ELSE 3
              END AS tier,
              (s.serial_cost IS NOT NULL AND l.serial_cost IS NOT NULL AND abs(s.serial_cost - l.serial_cost) < 0.01) AS cost_match
       FROM sales_order_lines s
       WHERE s.qty > 0
         AND s.product = l.product
         AND s.line_type = l.line_type
         AND s.id <> l.id
         AND ((s.serial_number <> '' AND s.serial_number = l.serial_number)
              OR s.base_invoice = l.base_invoice
              OR (upper(trim(s.customer)) = upper(trim(l.customer)) AND l.customer <> '')
              OR (s.serial_cost IS NOT NULL AND l.serial_cost IS NOT NULL AND abs(s.serial_cost - l.serial_cost) < 0.01))
       ORDER BY tier,
                (s.serial_cost IS NULL OR l.serial_cost IS NULL OR abs(s.serial_cost - l.serial_cost) >= 0.01),
                (s.source_month > l.source_month),
                s.source_month DESC
       LIMIT 1
     ) sale ON TRUE
     WHERE l.qty < 0
       AND l.source_month >= $1
       AND l.source_month <= $2
     ORDER BY l.source_month DESC, l.invoice DESC, l.id
     LIMIT 20000`,
    [String(startMonth), String(endMonth)]
  );
  const MATCH_LABELS = { 0: "serial number", 1: "invoice + product", 2: "customer + product", 3: "serial cost fingerprint" };
  return result.rows.map((row) => ({
    ...mapLineRow(row),
    orderInvoice: row.order_invoice || null,
    department: row.order_department || departmentFromInvoice(row.invoice),
    finishDate: row.order_finish_date || "",
    orderCustomerName: row.order_customer_name || row.customer,
    orderSalesperson: (row.order_proper_name || "").trim() || row.order_salesperson || row.salesperson_name,
    originalSale: row.sale_invoice ? {
      invoice: row.sale_invoice,
      month: row.sale_month,
      revenue: Number(row.sale_revenue),
      serialCost: row.sale_serial_cost == null ? null : Number(row.sale_serial_cost),
      serialNumber: row.sale_serial_number || "",
      salespersonCode: row.sale_sp_code || "",
      matchedBy: MATCH_LABELS[row.sale_match_tier] || "",
      sameSerial: row.sale_match_tier === 0,
      sameSerialCost: Boolean(row.sale_cost_match)
    } : null
  }));
}

// Prefix fallback when a return's order isn't in the warehouse yet.
function departmentFromInvoice(invoice) {
  const inv = String(invoice || "").toUpperCase();
  if (inv.startsWith("SV")) return "Repair Service";
  if (inv.startsWith("CB") || inv.startsWith("MD")) return "Kitchen Design";
  if (inv.startsWith("AC")) return "HVAC Sales";
  if (inv.startsWith("R") || inv.startsWith("S")) return "Appliance";
  return "";
}

export async function listLinesForInvoice(invoice) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM sales_order_lines l
     WHERE l.invoice = $1
        OR (l.base_invoice = $1
            AND l.invoice <> $1
            AND NOT EXISTS (SELECT 1 FROM sales_order_detail od WHERE od.invoice = l.invoice))
     ORDER BY id`,
    [String(invoice || "").toUpperCase()]
  );
  return result.rows.map(mapLineRow);
}

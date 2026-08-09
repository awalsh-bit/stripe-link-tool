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
  qty NUMERIC(10,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(14,4) NOT NULL DEFAULT 0,          -- 4dp: split commissions carry sub-cent values
  serial_type TEXT NOT NULL DEFAULT '',
  serial_cost NUMERIC(14,4),
  salesperson_code TEXT NOT NULL DEFAULT '',
  salesperson_name TEXT NOT NULL DEFAULT '',
  source_filename TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
         source_month, source_filename, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,NOW())
       ON CONFLICT (invoice) DO UPDATE SET
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
        String(filename || "").slice(0, 300)
      ]
    );
    written++;
  }
  await applyCodesToOrders(pool);
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
           source_month, invoice, base_invoice, customer, line_type, product,
           qty, revenue, serial_type, serial_cost, salesperson_code, salesperson_name, source_filename
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          sourceMonth,
          String(l.invoice || ""),
          String(l.baseInvoice || ""),
          String(l.customer || ""),
          String(l.lineType || ""),
          String(l.product || ""),
          round2(l.qty),
          round4(l.revenue),
          String(l.serialType || ""),
          l.serialCost == null ? null : round4(l.serialCost),
          String(l.salespersonCode || ""),
          String(l.salespersonName || ""),
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
    if (l.salespersonCode) pairs.set(String(l.salespersonCode).toUpperCase(), l.salespersonName || "");
  }
  await syncSalespersonCodes(pool, [...pairs].map(([code, name]) => ({ code, name })));
  await applyCodesToOrders(pool);

  return lines.length;
}

function mapOrderRow(row) {
  return {
    invoice: row.invoice,
    department: row.department,
    salesperson: row.salesperson,
    salespersonCode: row.salesperson_code || "",
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
    qty: Number(row.qty),
    revenue: Number(row.revenue),
    serialType: row.serial_type,
    serialCost: row.serial_cost == null ? null : Number(row.serial_cost),
    salespersonCode: row.salesperson_code,
    salespersonName: row.salesperson_name
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
    `SELECT o.*, (
       SELECT COUNT(*) FROM sales_order_lines l
       WHERE l.invoice = o.invoice
          OR (l.base_invoice = o.invoice
              AND l.invoice <> o.invoice
              AND NOT EXISTS (SELECT 1 FROM sales_order_detail od WHERE od.invoice = l.invoice))
     ) AS line_count
     FROM sales_order_detail o
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
            o.customer_name AS order_customer_name
     FROM sales_order_detail o
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
    salesperson: row.order_salesperson,
    orderSalespersonCode: row.order_salesperson_code || "",
    finishDate: row.order_finish_date,
    orderCustomerName: row.order_customer_name
  }));
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

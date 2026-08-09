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
//   month. base_invoice joins lines to orders ("AC00010530-1" → "AC00010530").
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
CREATE INDEX IF NOT EXISTS idx_sol_month ON sales_order_lines (source_month);
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
  return lines.length;
}

function mapOrderRow(row) {
  return {
    invoice: row.invoice,
    department: row.department,
    salesperson: row.salesperson,
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
    `SELECT o.*, (SELECT COUNT(*) FROM sales_order_lines l WHERE l.base_invoice = o.invoice) AS line_count
     FROM sales_order_detail o
     WHERE ${where.join(" AND ")}
     ORDER BY finish_date DESC, invoice DESC
     LIMIT 5000`,
    params
  );
  return result.rows.map(mapOrderRow);
}

export async function listLinesForInvoice(invoice) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM sales_order_lines WHERE base_invoice = $1 ORDER BY id`,
    [String(invoice || "").toUpperCase()]
  );
  return result.rows.map(mapLineRow);
}

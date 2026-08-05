import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Sales Order Health Report (sales-order-health.html) — the latest open-order
// export (ExportInvoice xlsx) is parsed in the browser and stored here as a
// single snapshot, so everyone sees the same data with a "data as of" stamp.
// Health rules are applied client-side so rule tweaks don't require re-upload.
// ---------------------------------------------------------------------------

const SALES_ORDERS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sales_order_snapshots (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '[]'::jsonb
);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(SALES_ORDERS_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

function mapRow(row) {
  return {
    filename: row.filename,
    uploadedByEmail: row.uploaded_by_email,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: row.uploaded_at?.toISOString?.() || null,
    rowCount: row.row_count,
    rows: row.data || []
  };
}

export async function getSalesOrderSnapshot() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM sales_order_snapshots WHERE id = 1`);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function saveSalesOrderSnapshot({ rows, filename, byEmail, byName }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO sales_order_snapshots (id, filename, uploaded_by_email, uploaded_by_name, uploaded_at, row_count, data)
     VALUES (1, $1, $2, $3, NOW(), $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       filename = EXCLUDED.filename,
       uploaded_by_email = EXCLUDED.uploaded_by_email,
       uploaded_by_name = EXCLUDED.uploaded_by_name,
       uploaded_at = NOW(),
       row_count = EXCLUDED.row_count,
       data = EXCLUDED.data
     RETURNING *`,
    [
      String(filename || "").slice(0, 200),
      String(byEmail || "").trim().toLowerCase(),
      String(byName || "").trim(),
      rows.length,
      JSON.stringify(rows)
    ]
  );
  return mapRow(result.rows[0]);
}

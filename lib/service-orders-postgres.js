import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Service Order Health (service-order-health.html, Client Care) — the latest
// open SERVICE ticket export (ExportInvoice xlsx, SV + WTY invoice types) is
// parsed in the browser and stored here as a single snapshot, so everyone
// sees the same data with a "data as of" stamp. Mirrors the Sales Order
// Health plumbing (lib/sales-orders-postgres.js); health/notification rules
// will be layered on client-side later, so rule tweaks won't require
// re-uploads. Card-on-file matching against the Service Request Queue happens
// at read time in server.js so it always reflects the current queue.
// ---------------------------------------------------------------------------

const SERVICE_ORDERS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS service_order_snapshots (
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
    ensurePromise = pool.query(SERVICE_ORDERS_SCHEMA_SQL);
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

export async function getServiceOrderSnapshot() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM service_order_snapshots WHERE id = 1`);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function saveServiceOrderSnapshot({ rows, filename, byEmail, byName }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO service_order_snapshots (id, filename, uploaded_by_email, uploaded_by_name, uploaded_at, row_count, data)
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

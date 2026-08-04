import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Clearance Hit List sold-status — the item list itself lives in
// data/clearance.json (regenerated from the clearance workbook), but which
// units have been SOLD is live state that survives list refreshes. Items are
// keyed by a deterministic id (model|serial#occurrence) so a regenerated
// list re-attaches to its sold marks.
// ---------------------------------------------------------------------------

const CLEARANCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clearance_status (
  item_id TEXT PRIMARY KEY,
  sales_order TEXT NOT NULL DEFAULT '',
  sold_by_email TEXT NOT NULL DEFAULT '',
  sold_by_name TEXT NOT NULL DEFAULT '',
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(CLEARANCE_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

function mapRow(row) {
  return {
    itemId: row.item_id,
    salesOrder: row.sales_order,
    soldByEmail: row.sold_by_email,
    soldByName: row.sold_by_name,
    soldAt: row.sold_at?.toISOString?.() || null
  };
}

export async function listClearanceStatuses() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM clearance_status`);
  return result.rows.map(mapRow);
}

export async function getClearanceStatus(itemId) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM clearance_status WHERE item_id = $1`, [itemId]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// First seller wins: the insert refuses to overwrite an existing sold mark,
// so two salespeople racing for the same unit can't both "win" silently.
export async function markClearanceSold({ itemId, salesOrder, soldByEmail, soldByName }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO clearance_status (item_id, sales_order, sold_by_email, sold_by_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id) DO NOTHING
     RETURNING *`,
    [
      String(itemId).slice(0, 200),
      String(salesOrder || "").trim().slice(0, 60),
      String(soldByEmail || "").trim().toLowerCase(),
      String(soldByName || "").trim()
    ]
  );
  if (!result.rows[0]) {
    return { conflict: true, existing: await getClearanceStatus(itemId) };
  }
  return { conflict: false, status: mapRow(result.rows[0]) };
}

export async function clearClearanceSold(itemId) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `DELETE FROM clearance_status WHERE item_id = $1 RETURNING item_id`,
    [itemId]
  );
  return result.rowCount > 0;
}

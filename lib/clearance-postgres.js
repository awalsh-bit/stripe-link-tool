import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Clearance Hit List line status — the item list itself lives in
// data/clearance.json (regenerated from the clearance workbook); which units
// are on a 24-hour HOLD or SOLD is live state that survives list refreshes.
// Items are keyed by a deterministic id (model|serial#occurrence) so a
// regenerated list re-attaches to its marks. Expired holds are purged lazily
// on every read/write, so they release automatically with no scheduler.
// ---------------------------------------------------------------------------

const CLEARANCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clearance_status (
  item_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'sold',
  sales_order TEXT NOT NULL DEFAULT '',
  held_until TIMESTAMPTZ,
  sold_by_email TEXT NOT NULL DEFAULT '',
  sold_by_name TEXT NOT NULL DEFAULT '',
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE clearance_status ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sold';
ALTER TABLE clearance_status ADD COLUMN IF NOT EXISTS held_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS clearance_price_overrides (
  item_id TEXT PRIMARY KEY,
  price NUMERIC(12,2) NOT NULL,
  set_by_email TEXT NOT NULL DEFAULT '',
  set_by_name TEXT NOT NULL DEFAULT '',
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const HOLD_HOURS = 24;

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

async function purgeExpiredHolds(pool) {
  await pool.query(`DELETE FROM clearance_status WHERE status = 'hold' AND held_until < NOW()`);
}

function mapRow(row) {
  return {
    itemId: row.item_id,
    status: row.status,
    salesOrder: row.sales_order,
    heldUntil: row.held_until?.toISOString?.() || null,
    byEmail: row.sold_by_email,
    byName: row.sold_by_name,
    at: row.sold_at?.toISOString?.() || null
  };
}

export async function listClearanceStatuses() {
  const pool = await getReadyPool();
  await purgeExpiredHolds(pool);
  const result = await pool.query(`SELECT * FROM clearance_status`);
  return result.rows.map(mapRow);
}

export async function getClearanceStatus(itemId) {
  const pool = await getReadyPool();
  await purgeExpiredHolds(pool);
  const result = await pool.query(`SELECT * FROM clearance_status WHERE item_id = $1`, [itemId]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// First writer wins: the insert refuses to overwrite an existing mark, so
// two salespeople racing for the same unit can't both "win" silently.
export async function markClearanceStatus({ itemId, status, salesOrder = "", byEmail, byName }) {
  if (!["sold", "hold"].includes(status)) {
    throw new Error("Bad status.");
  }
  const pool = await getReadyPool();
  await purgeExpiredHolds(pool);
  const result = await pool.query(
    `INSERT INTO clearance_status (item_id, status, sales_order, held_until, sold_by_email, sold_by_name)
     VALUES ($1, $2, $3, ${status === "hold" ? `NOW() + INTERVAL '${HOLD_HOURS} hours'` : "NULL"}, $4, $5)
     ON CONFLICT (item_id) DO NOTHING
     RETURNING *`,
    [
      String(itemId).slice(0, 200),
      status,
      String(salesOrder || "").trim().slice(0, 60),
      String(byEmail || "").trim().toLowerCase(),
      String(byName || "").trim()
    ]
  );
  if (!result.rows[0]) {
    return { conflict: true, existing: await getClearanceStatus(itemId) };
  }
  return { conflict: false, status: mapRow(result.rows[0]) };
}

// Convert an active hold into a sale (permission is checked by the caller).
// The seller becomes whoever completes the sale.
export async function upgradeHoldToSold({ itemId, salesOrder, byEmail, byName }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE clearance_status
     SET status = 'sold', sales_order = $2, held_until = NULL,
         sold_by_email = $3, sold_by_name = $4, sold_at = NOW()
     WHERE item_id = $1 AND status = 'hold'
     RETURNING *`,
    [
      String(itemId).slice(0, 200),
      String(salesOrder || "").trim().slice(0, 60),
      String(byEmail || "").trim().toLowerCase(),
      String(byName || "").trim()
    ]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// Web-shop lock: a submitted online order freezes the unit on the hit list.
// Unlike a salesperson hold it never expires — it releases only when the
// order is canceled (clearClearanceStatus) or completes as a sale
// (upgradeWebToSold). First writer wins, same as markClearanceStatus.
export async function markWebLock({ itemId, orderNumber }) {
  const pool = await getReadyPool();
  await purgeExpiredHolds(pool);
  const result = await pool.query(
    `INSERT INTO clearance_status (item_id, status, sales_order, held_until, sold_by_email, sold_by_name)
     VALUES ($1, 'web', $2, NULL, 'webshop', 'Online Shop')
     ON CONFLICT (item_id) DO NOTHING
     RETURNING *`,
    [String(itemId).slice(0, 200), String(orderNumber || "").trim().slice(0, 60)]
  );
  if (!result.rows[0]) {
    return { conflict: true, existing: await getClearanceStatus(itemId) };
  }
  return { conflict: false, status: mapRow(result.rows[0]) };
}

// Completing a web order flips its locks to Sold under the ePASS ticket.
export async function upgradeWebToSold({ itemId, salesOrder, byEmail, byName }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE clearance_status
     SET status = 'sold', sales_order = $2, held_until = NULL,
         sold_by_email = $3, sold_by_name = $4, sold_at = NOW()
     WHERE item_id = $1 AND status = 'web'
     RETURNING *`,
    [
      String(itemId).slice(0, 200),
      String(salesOrder || "").trim().slice(0, 60),
      String(byEmail || "").trim().toLowerCase(),
      String(byName || "").trim()
    ]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function clearClearanceStatus(itemId) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `DELETE FROM clearance_status WHERE item_id = $1 RETURNING item_id`,
    [itemId]
  );
  return result.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Executive price overrides — the workbook price stays in data/clearance.json
// untouched; an override rides on top and survives list refreshes.
// ---------------------------------------------------------------------------

export async function listPriceOverrides() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM clearance_price_overrides`);
  return result.rows.map((row) => ({
    itemId: row.item_id,
    price: Number(row.price),
    byEmail: row.set_by_email,
    byName: row.set_by_name,
    at: row.set_at?.toISOString?.() || null
  }));
}

export async function setPriceOverride({ itemId, price, byEmail, byName }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO clearance_price_overrides (item_id, price, set_by_email, set_by_name, set_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (item_id) DO UPDATE SET
       price = EXCLUDED.price,
       set_by_email = EXCLUDED.set_by_email,
       set_by_name = EXCLUDED.set_by_name,
       set_at = NOW()
     RETURNING *`,
    [
      String(itemId).slice(0, 200),
      Number(price),
      String(byEmail || "").trim().toLowerCase(),
      String(byName || "").trim()
    ]
  );
  const row = result.rows[0];
  return { itemId: row.item_id, price: Number(row.price), byEmail: row.set_by_email, byName: row.set_by_name, at: row.set_at?.toISOString?.() || null };
}

export async function clearPriceOverride(itemId) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `DELETE FROM clearance_price_overrides WHERE item_id = $1 RETURNING item_id`,
    [itemId]
  );
  return result.rowCount > 0;
}

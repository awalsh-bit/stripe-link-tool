-- Clearance Hit List sold-status (clearance.html).
-- The item list lives in data/clearance.json (regenerated from the clearance
-- workbook); this table records which units are SOLD, keyed by the item's
-- deterministic id (model|serial#occurrence) so sold marks survive list
-- refreshes. The server also runs this idempotently at boot
-- (lib/clearance-postgres.js).

CREATE TABLE IF NOT EXISTS clearance_status (
  item_id TEXT PRIMARY KEY,
  sales_order TEXT NOT NULL DEFAULT '',
  sold_by_email TEXT NOT NULL DEFAULT '',
  sold_by_name TEXT NOT NULL DEFAULT '',
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

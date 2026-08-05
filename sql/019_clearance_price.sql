-- Executive price overrides for the Clearance Hit List (clearance.html).
-- The workbook price in data/clearance.json is never modified; an override
-- rides on top, keyed by the item's deterministic id so it survives list
-- refreshes. The server also runs this idempotently at boot
-- (lib/clearance-postgres.js).

CREATE TABLE IF NOT EXISTS clearance_price_overrides (
  item_id TEXT PRIMARY KEY,
  price NUMERIC(12,2) NOT NULL,
  set_by_email TEXT NOT NULL DEFAULT '',
  set_by_name TEXT NOT NULL DEFAULT '',
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

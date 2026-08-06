-- Flag closure log for "My Sales Order Health" (dashboard.html) and the
-- Closed Flag Log on sales-order-health.html. Every Close writes an
-- append-only record under a flag-instance token — RFI-… for a red flag
-- instance, YFI-… for a yellow one — capturing who closed it, when, the
-- flags at the time, and a snapshot of the order row. The dismissals table
-- (sql/021) only holds the current hide state; this is the history.
-- The server also runs this idempotently at boot (lib/sales-orders-postgres.js).

CREATE TABLE IF NOT EXISTS sales_order_flag_closures (
  token TEXT PRIMARY KEY,               -- RFI-XXXXXX | YFI-XXXXXX
  severity TEXT NOT NULL DEFAULT '',    -- red | yellow (at time of close)
  invoice TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT '',   -- flag fingerprint that was closed
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,          -- [{level, text}, ...]
  order_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, -- the order row as it looked
  closed_by_email TEXT NOT NULL DEFAULT '',
  closed_by_name TEXT NOT NULL DEFAULT '',
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_uploaded_at TIMESTAMPTZ,           -- which report version the close ran against
  report_filename TEXT NOT NULL DEFAULT ''
);

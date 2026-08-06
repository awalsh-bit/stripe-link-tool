-- Sales Order Health Report (sales-order-health.html).
-- The latest open-order export (ExportInvoice xlsx) is parsed in the browser
-- and stored as one snapshot row (id = 1), so everyone sees the same data
-- with a "data as of" stamp. Health rules run client-side. The server also
-- runs this idempotently at boot (lib/sales-orders-postgres.js).

CREATE TABLE IF NOT EXISTS sales_order_snapshots (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '[]'::jsonb  -- array of normalized order rows
);

-- "My Order Flags" queue on the Payments Dashboard: closing a flag card
-- stores the order's current flag signature per user; the card stays closed
-- until the order's flags change, then it reappears.
CREATE TABLE IF NOT EXISTS sales_order_dismissals (
  user_email TEXT NOT NULL,
  invoice TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_email, invoice)
);

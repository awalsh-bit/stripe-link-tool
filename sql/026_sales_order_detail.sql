-- Sales Order Detail (sales-order-detail.html, Admin) — durable per-order
-- reporting warehouse. sales_order_detail holds one row per order from the
-- monthly OE-23 (Salesperson Activity Report) upload: revenue = List
-- "Total (no Tax)", cost = Cost "Total (no Tax)", category splits, finish
-- date, customer, salesperson, department (SV → Repair Service,
-- CB/MD → Kitchen Design, AC → HVAC Sales, R/S → Appliance). Upsert by invoice,
-- so re-running a month refreshes it while history accumulates.
--
-- sales_order_lines holds commission-report line items (models / warranty
-- plans with qty, revenue, serial cost). Split sales (ePASS lists the same
-- line under each partner with divided revenue but full repeated cost) are
-- merged whole at parse time and flagged split=TRUE with the partner codes.
-- Lines have no natural unique key,
-- so each upload REPLACES its source_month. Join rule: a line matches the
-- order with the EXACT same invoice (OE-23 keeps split orders as separate
-- suffixed rows, e.g. "S00063116-8"); only when no exact order exists does a
-- suffixed line roll up to its base invoice ("AC00010530-1" → "AC00010530").
--
-- When NetSuite arrives, its exports feed these same tables.
-- The server also runs this idempotently at boot
-- (lib/sales-order-detail-postgres.js).

CREATE TABLE IF NOT EXISTS sales_order_detail (
  invoice TEXT PRIMARY KEY,
  department TEXT NOT NULL DEFAULT '',
  salesperson TEXT NOT NULL DEFAULT '',
  finish_date TEXT NOT NULL DEFAULT '',            -- 'YYYY-MM-DD'
  customer_number TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  list_product NUMERIC(14,2) NOT NULL DEFAULT 0,
  list_parts NUMERIC(14,2) NOT NULL DEFAULT 0,
  list_labor NUMERIC(14,2) NOT NULL DEFAULT 0,
  list_wty NUMERIC(14,2) NOT NULL DEFAULT 0,
  list_misc NUMERIC(14,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,        -- List Total (no Tax)
  invoice_total NUMERIC(14,2) NOT NULL DEFAULT 0,  -- List TOTAL (with tax)
  cost NUMERIC(14,2) NOT NULL DEFAULT 0,           -- Cost Total (no Tax)
  profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,       -- full { list, cost, profit } value rows
  source_month TEXT NOT NULL DEFAULT '',           -- 'YYYY-MM' of the feeding report
  source_filename TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sod_finish_date ON sales_order_detail (finish_date);
CREATE INDEX IF NOT EXISTS idx_sod_department ON sales_order_detail (department);
CREATE INDEX IF NOT EXISTS idx_sod_salesperson ON sales_order_detail (salesperson);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id BIGSERIAL PRIMARY KEY,
  source_month TEXT NOT NULL,                      -- 'YYYY-MM' chosen at upload
  invoice TEXT NOT NULL DEFAULT '',                -- raw, may carry suffix ("-1")
  base_invoice TEXT NOT NULL DEFAULT '',           -- suffix stripped; joins to sales_order_detail
  customer TEXT NOT NULL DEFAULT '',
  line_type TEXT NOT NULL DEFAULT '',              -- 'Model' | 'Wty'
  product TEXT NOT NULL DEFAULT '',
  serial_number TEXT NOT NULL DEFAULT '',          -- v2 Crystal exports; '' on v1 months and Wty lines
  qty NUMERIC(10,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  serial_type TEXT NOT NULL DEFAULT '',            -- ALL / OPEN / RTV / DISPLAY / SVC / '' (Wty)
  serial_cost NUMERIC(14,2),                       -- NULL on Wty lines
  salesperson_code TEXT NOT NULL DEFAULT '',
  salesperson_name TEXT NOT NULL DEFAULT '',
  split BOOLEAN NOT NULL DEFAULT FALSE,               -- cross-salesperson split, merged whole at parse
  split_partners TEXT NOT NULL DEFAULT '',            -- e.g. 'JD+VWJ'
  source_filename TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS serial_number TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS split BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS split_partners TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_sol_base_invoice ON sales_order_lines (base_invoice);
CREATE INDEX IF NOT EXISTS idx_sol_invoice ON sales_order_lines (invoice);
CREATE INDEX IF NOT EXISTS idx_sol_month ON sales_order_lines (source_month);

-- Salesperson code keying: commission uploads carry code ↔ name pairs in
-- their section headers ("CSH" / "Christian Houde"). Each upload upserts the
-- mapping below (source='commission'), and the employee directory (User
-- Admin) is synced in as a fallback teacher (source='directory', never
-- overwriting commission pairs) — it covers service techs and anyone who
-- never appears on a commission report. Order rows are stamped with
-- salesperson_code by normalized (uppercase, whitespace-collapsed) name
-- match; when both sources know a name, the commission pair wins.
ALTER TABLE sales_order_detail ADD COLUMN IF NOT EXISTS salesperson_code TEXT NOT NULL DEFAULT '';

-- SV service ticket classification (from the OE-23 customer rows): COD
-- tickets bill the real customer (numeric phone-style customer number);
-- warranty tickets bill the manufacturer's account (alpha key like
-- SPEEDQUEEN); customer 5128940907 is Wilson's own "WACA Warranty"
-- goodwill bucket. '' on non-SV orders. Feeds tech comp: COD labor,
-- COD parts margin, warranty labor.
ALTER TABLE sales_order_detail ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS salesperson_codes (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  normalized_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',                 -- 'commission' | 'directory'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spc_normalized ON salesperson_codes (normalized_name);

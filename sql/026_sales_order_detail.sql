-- Sales Order Detail (sales-order-detail.html, Admin) — durable per-order
-- reporting warehouse. sales_order_detail holds one row per order from the
-- monthly OE-23 (Salesperson Activity Report) upload: revenue = List
-- "Total (no Tax)", cost = Cost "Total (no Tax)", category splits, finish
-- date, customer, salesperson, department (SV → Repair Service,
-- CB → Kitchen Design, AC → HVAC Sales, R/S → Appliance). Upsert by invoice,
-- so re-running a month refreshes it while history accumulates.
--
-- sales_order_lines holds commission-report line items (models / warranty
-- plans with qty, revenue, serial cost). Lines have no natural unique key,
-- so each upload REPLACES its source_month. base_invoice joins to
-- sales_order_detail.invoice ("AC00010530-1" → "AC00010530").
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
  qty NUMERIC(10,2) NOT NULL DEFAULT 0,
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  serial_type TEXT NOT NULL DEFAULT '',            -- ALL / OPEN / RTV / DISPLAY / SVC / '' (Wty)
  serial_cost NUMERIC(14,2),                       -- NULL on Wty lines
  salesperson_code TEXT NOT NULL DEFAULT '',
  salesperson_name TEXT NOT NULL DEFAULT '',
  source_filename TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sol_base_invoice ON sales_order_lines (base_invoice);
CREATE INDEX IF NOT EXISTS idx_sol_month ON sales_order_lines (source_month);

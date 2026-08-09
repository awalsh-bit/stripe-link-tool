-- Revenue performance (target-builder.html) — parsed Salesperson Activity
-- Report (ePASS OE-23 .xls) snapshots, one row per calendar month keyed by
-- the report's "From" date. Re-uploading a report for the same month
-- replaces that month's snapshot, so a daily month-to-date export keeps the
-- current month fresh while prior months keep their final numbers.
-- Revenue = List "Total (no Tax)". Departments come from the ticket prefix:
-- SV → Repair Service (service + warranty), CB → Kitchen Design,
-- AC → HVAC Sales, R/S → Appliance. The server also runs this idempotently
-- at boot (lib/revenue-performance-postgres.js).

CREATE TABLE IF NOT EXISTS revenue_performance (
  month TEXT PRIMARY KEY,                            -- 'YYYY-MM'
  period_from TEXT NOT NULL DEFAULT '',              -- 'YYYY-MM-DD' report From
  period_to TEXT NOT NULL DEFAULT '',                -- 'YYYY-MM-DD' report To
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ticket_count INTEGER NOT NULL DEFAULT 0,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,         -- grand List totals (product/parts/labor/wty/misc/totalNoTax/invoiceTotal)
  by_department JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { "Appliance": { revenue, cost, profit, tickets }, ... }
  by_salesperson JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "NAME": { revenue, profit, tickets }, ... }
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,       -- parse-time checksum warnings
  tickets JSONB NOT NULL DEFAULT '[]'::jsonb         -- full ticket detail for future drill-down
);

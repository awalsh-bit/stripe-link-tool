-- Revenue targets (target-builder.html) — one row per calendar month with a
-- total dollar target and department percentage splits (Appliance, HVAC
-- Sales, Repair Service, Kitchen Design). Months with no saved row fall back
-- to the placeholder defaults ($2,000,000 at 90/5/4/1). To-date targets are
-- prorated by working days: Monday–Saturday count, Sundays don't, and the
-- elapsed count includes today. The server also runs this idempotently at
-- boot (lib/revenue-targets-postgres.js).

CREATE TABLE IF NOT EXISTS revenue_targets (
  month TEXT PRIMARY KEY,                     -- 'YYYY-MM'
  total_target NUMERIC(14,2) NOT NULL,
  splits JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { "Appliance": 90, ... } percentages
  updated_by_email TEXT NOT NULL DEFAULT '',
  updated_by_name TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

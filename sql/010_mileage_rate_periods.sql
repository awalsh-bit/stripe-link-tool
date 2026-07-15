-- 010: effective-dated mileage rate periods (replaces the per-year model so
-- mid-year IRS rate changes work). Idempotent; also applied at boot by
-- lib/mileage-postgres.js.
--
-- The rate for a given day is the most recent period whose effective_from is
-- on or before that day. A monthly report uses the rate in effect on the first
-- of its month. Approved months keep their snapshotted rate (rate_used), so
-- adding a period never changes an already-approved report.

CREATE TABLE IF NOT EXISTS mileage_rate_periods (
  effective_from DATE PRIMARY KEY,
  rate NUMERIC(6,3) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

-- Fold any legacy per-year rates (mileage_rates) into periods:
-- year N -> effective N-01-01. Preserves admin-entered values.
INSERT INTO mileage_rate_periods (effective_from, rate)
SELECT make_date(year, 1, 1), rate FROM mileage_rates
ON CONFLICT (effective_from) DO NOTHING;

-- Seed known IRS standard business mileage rates by effective date, including
-- the mid-year 2026 increase (72.5c -> 76c effective July 1, 2026).
INSERT INTO mileage_rate_periods (effective_from, rate) VALUES
  ('2025-01-01', 0.67),
  ('2026-01-01', 0.725),
  ('2026-07-01', 0.76)
ON CONFLICT (effective_from) DO NOTHING;

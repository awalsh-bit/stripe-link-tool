-- 007: mileage reimbursement (replaces the monthly Excel worksheet).
-- Created idempotently at boot by lib/mileage-postgres.js, which also seeds
-- mileage_rates (2025 -> 0.67, 2026 -> 0.725) when the table is empty.
-- Also adds the per-employee standard commute to the employee directory.

CREATE TABLE IF NOT EXISTS mileage_rates (
  year INT PRIMARY KEY,
  rate NUMERIC(6,3) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

CREATE TABLE IF NOT EXISTS mileage_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  commute_miles NUMERIC(7,1) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','denied')),
  submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES app_users(id),
  denial_note TEXT NOT NULL DEFAULT '',
  rate_used NUMERIC(6,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_mileage_reports_status ON mileage_reports (status);
CREATE INDEX IF NOT EXISTS idx_mileage_reports_user ON mileage_reports (user_id);

CREATE TABLE IF NOT EXISTS mileage_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES mileage_reports(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  showroom_start BOOLEAN NOT NULL DEFAULT TRUE,
  purpose TEXT NOT NULL DEFAULT '',
  miles NUMERIC(7,1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mileage_entries_report ON mileage_entries (report_id);

-- Standard round-trip commute (miles), used as the deduction on
-- non-showroom-start days. Managed by executives in User Admin.
ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS commute_miles NUMERIC(7,1) NOT NULL DEFAULT 0;

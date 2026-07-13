-- 008: approved -> paid step for the accounting mileage workflow.
-- Idempotent; also applied at boot by lib/mileage-postgres.js.
-- A report is "paid" when paid_at is set (status stays 'approved', so the
-- locked rate snapshot is untouched).

ALTER TABLE mileage_reports ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE mileage_reports ADD COLUMN IF NOT EXISTS paid_by UUID;

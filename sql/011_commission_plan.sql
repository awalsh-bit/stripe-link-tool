-- 011: commission plan on employee directory entries.
-- Idempotent; also applied at boot by lib/employee-directory.js.
--
-- Free-form-safe TEXT constrained by the app to a fixed list (see
-- COMMISSION_PLANS in lib/employee-directory.js). Empty string = no plan
-- (accounting/office staff). Editable in User Admin → Employee Directory.

ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS commission_plan TEXT NOT NULL DEFAULT '';

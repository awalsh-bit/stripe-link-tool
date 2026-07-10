-- 005: employee directory (codes used on payment tools), editable in
-- User Admin. Created idempotently at boot by lib/employee-directory.js,
-- which also seeds the initial entries from the legacy static file when the
-- table is empty. Entries tie to app_users accounts by email.

CREATE TABLE IF NOT EXISTS employee_directory (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

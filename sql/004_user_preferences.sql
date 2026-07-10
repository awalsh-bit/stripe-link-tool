-- 004: per-user preferences (e.g. dashboard hero card slots).
-- Idempotent; also applied automatically at boot by ensureUserAccessTables()
-- in lib/users-postgres.js.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

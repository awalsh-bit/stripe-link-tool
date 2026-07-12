-- 006: source IP on audit rows, backing the "Agility User Activity Audit"
-- page (audit-log.html). Idempotent; also applied automatically at boot by
-- ensureUserAccessTables() in lib/users-postgres.js. Rows written before
-- this migration have ip = '' (some older rows carry an ip inside detail).

ALTER TABLE access_audit_log ADD COLUMN IF NOT EXISTS ip TEXT NOT NULL DEFAULT '';

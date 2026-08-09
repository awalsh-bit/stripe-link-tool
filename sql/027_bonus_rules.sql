-- Bonus Tracker rules (target-builder.html editor, dashboard.html module).
-- One current ruleset (id=1) as JSONB:
--   { "Appliance": { "deptTiers": [{"threshold":90,"amount":150}, ...],
--                    "companyTiers": [{"threshold":100,"amount":200}] }, ... }
-- Two ladders per department: deptTiers unlock on the department's MTD
-- attainment vs its working-day-prorated target; companyTiers unlock on
-- company-wide attainment, so departments without a revenue target (Client
-- Care) still ride the company's month. Payout per ladder = highest tier
-- reached (not cumulative); total = dept + company amounts.
-- No saved row -> placeholder defaults (lib/bonus-rules-postgres.js), shown
-- as "Using placeholder defaults" in the editor. The server runs this
-- idempotently at boot.

CREATE TABLE IF NOT EXISTS bonus_rules (
  id INTEGER PRIMARY KEY,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_email TEXT NOT NULL DEFAULT '',
  updated_by_name TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

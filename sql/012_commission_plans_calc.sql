-- 012: plan-driven commission calculation (2026 export format).
-- Idempotent; also applied at boot by lib/commissions-postgres.js.
--
-- The monthly ePASS export now carries revenue, serial type, serial cost, and
-- GM% per line; commission is CALCULATED from the salesperson's commission
-- plan (employee_directory.commission_plan), snapshotted onto each line at
-- import so later plan changes never rewrite an existing run.
--
--   Showroom Consultant     5% on DISPLAY/OPEN serial lines; Protect flat 5%;
--                           nothing on ALL (new) product.
--   Field Sales Consultant  GM-tiered % of revenue on serial type ALL
--                           (18-20.99 -> 2%, 21-24.99 -> 3%, 25-30.99 -> 4%,
--                           31+ -> 5%); Protect by monthly attach rate
--                           (<1% -> 5%, 1-4.99% -> 10%, >=5% -> 15%) plus a
--                           $500 bonus when Protect sales exceed $5,000;
--                           payout gated by the $500k/6-month qualification
--                           (fs_qualified, default true).
--   HVAC Selling Technician per-sales-order net-margin payout (existing HVAC
--                           order machinery).
--   Other plans             no automatic rule yet; lines stay hand-editable.

ALTER TABLE commission_lines ADD COLUMN IF NOT EXISTS serial_type TEXT NOT NULL DEFAULT '';
ALTER TABLE commission_lines ADD COLUMN IF NOT EXISTS serial_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE commission_lines ADD COLUMN IF NOT EXISTS gm_percent NUMERIC(9,4) NOT NULL DEFAULT 0;
ALTER TABLE commission_lines ADD COLUMN IF NOT EXISTS salesperson_plan TEXT NOT NULL DEFAULT '';

ALTER TABLE commission_salesperson_statuses ADD COLUMN IF NOT EXISTS fs_qualified BOOLEAN NOT NULL DEFAULT TRUE;

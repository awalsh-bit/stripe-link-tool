-- Clearance line status v2: Available -> 24-hour HOLD or SOLD.
-- Adds the status ('sold' | 'hold') and held_until columns to the table
-- created in 017. Expired holds are purged lazily on every read/write in
-- lib/clearance-postgres.js, so holds release automatically with no
-- scheduler. The server also runs these statements idempotently at boot.

ALTER TABLE clearance_status ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sold';
ALTER TABLE clearance_status ADD COLUMN IF NOT EXISTS held_until TIMESTAMPTZ;

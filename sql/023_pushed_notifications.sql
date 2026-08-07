-- My Notifications (dashboard.html) — pushed company notifications alongside
-- order flags, in four severities: neutral, green, yellow, red. Closing any
-- notification mints a token (NFI/GFI/YFI/RFI) into the shared closure log
-- (sql/022), which doubles as a read receipt inspectable on the Instance
-- Closure Report. The server also runs this idempotently at boot
-- (lib/sales-orders-postgres.js).

CREATE TABLE IF NOT EXISTS pushed_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity TEXT NOT NULL DEFAULT 'neutral',      -- neutral | green | yellow | red
  type_label TEXT NOT NULL DEFAULT 'Company News',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  audience_email TEXT NOT NULL DEFAULT '',       -- '' = everyone, else one user
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The closure log grows three columns so pushed-notification closes live in
-- the same audit trail as order-flag closes:
ALTER TABLE sales_order_flag_closures ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'order_flag';  -- order_flag | notification
ALTER TABLE sales_order_flag_closures ADD COLUMN IF NOT EXISTS ref_id TEXT NOT NULL DEFAULT '';          -- pushed_notifications.id for notification closes
ALTER TABLE sales_order_flag_closures ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';           -- notification title at close

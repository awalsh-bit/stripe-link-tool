-- =====================================================================
-- Wilson AC & Appliance — Proposed Forward-Looking Postgres Schema
--
-- This is a "slightly overbuilt" target schema for the planned full
-- employee portal + customer-facing payments + repair leads + events +
-- future customer balance/rewards work.
--
-- It is intentionally additive to 001_initial_schema.sql.  Tables that
-- already exist (payment_links, card_on_file_charges, service_requests,
-- service_requests_archive, events, event_rsvps, commission_*) are
-- referenced here but NOT redefined.
--
-- Conventions
--   * Primary keys: UUID (gen_random_uuid()) for new application data.
--     Existing string IDs (svc_…, cof_…, plink_…, recovered_…) are
--     preserved as TEXT primary keys to avoid painful remapping.
--   * created_at / updated_at on every table, NOT NULL, default NOW().
--   * Soft delete via deleted_at TIMESTAMPTZ rather than hard DELETE
--     anywhere money or compliance is involved.
--   * All money: NUMERIC(12,2). Never FLOAT.
--   * Lookups Stripe will care about (customer_id, payment_intent_id,
--     payment_method_id, payment_link_id, setup_intent_id) are
--     first-class indexed columns, never buried in JSONB.
--   * Free-form, fast-evolving shapes (addresses, units, raw webhook
--     payloads, form responses) live in JSONB.
--   * Row Level Security is enabled on PII-bearing tables so we can
--     hand a single Postgres role to the app server but still hard-cap
--     visibility per department later.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------
-- 1. AUTH / IDENTITY
-- ---------------------------------------------------------------------
-- Replaces the two-user-in-env setup.  Roles are a separate table so
-- we don't have to redeploy to grant access.  We keep ACCESS_GROUPS
-- as a CHECK-bounded enum-ish text column so the existing access logic
-- ports over cleanly.

CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username        CITEXT      NOT NULL UNIQUE,
  email           CITEXT      NOT NULL UNIQUE,
  display_name    TEXT        NOT NULL DEFAULT '',
  password_hash   TEXT        NOT NULL,          -- bcrypt or argon2id
  password_set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  totp_secret     TEXT        NOT NULL DEFAULT '', -- optional 2FA
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  last_login_ip   INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_active   ON users (is_active) WHERE deleted_at IS NULL;

-- A user can be in 1+ access groups.  Today: leader, executive,
-- accounting, sales, service.  This table is the join row.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_group TEXT        NOT NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by   UUID        REFERENCES users(id),
  PRIMARY KEY (user_id, access_group),
  CONSTRAINT user_roles_access_group_check CHECK (
    access_group IN ('leader','executive','accounting','sales','service','client_care','hvac','kitchen_design','tech_admin')
  )
);

-- Server-side session store.  Today's HMAC cookie has no revocation;
-- moving to a session row lets logout + admin revoke a stolen laptop.
CREATE TABLE IF NOT EXISTS user_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cookie_hash     TEXT        NOT NULL UNIQUE, -- store SHA-256 of cookie value
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_ip    INET,
  user_agent      TEXT        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user        ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at  ON user_sessions (expires_at);

-- Password reset / first-login tokens.  Single-use, short-lived.
CREATE TABLE IF NOT EXISTS user_password_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,
  purpose      TEXT        NOT NULL CHECK (purpose IN ('reset','invite','email_verify')),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_tokens_user ON user_password_tokens (user_id);

-- ---------------------------------------------------------------------
-- 2. EMPLOYEE DIRECTORY (replaces employee-directory.js)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS departments (
  code        TEXT        PRIMARY KEY,                 -- e.g. 'appliance'
  name        TEXT        NOT NULL,                    -- e.g. 'Appliance'
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
  employee_code   TEXT        NOT NULL UNIQUE,         -- 'EHM', 'AMW', '27'
  full_name       TEXT        NOT NULL,
  email           CITEXT      NOT NULL,
  phone           TEXT        NOT NULL DEFAULT '',
  department_code TEXT        REFERENCES departments(code),
  job_title       TEXT        NOT NULL DEFAULT '',
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  hire_date       DATE,
  terminated_date DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_dept   ON employees (department_code) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_employees_email  ON employees (email);

-- ---------------------------------------------------------------------
-- 3. CUSTOMERS  (single canonical record for both Stripe + CRM)
-- ---------------------------------------------------------------------
-- Today there is no customer table; PII is denormalized across
-- payment_links, card_on_file_charges, service_requests, event_rsvps.
-- That blocks future rewards/balance work.  A canonical customer
-- table is the keystone for everything ambitious you've described.

CREATE TABLE IF NOT EXISTS customers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_customer_id TEXT       UNIQUE,                -- nullable; not all customers have one
  full_name         TEXT        NOT NULL DEFAULT '',
  first_name        TEXT        NOT NULL DEFAULT '',
  last_name         TEXT        NOT NULL DEFAULT '',
  email             CITEXT,
  phone             TEXT,
  phone_digits      TEXT,                              -- E.164 or 10-digit, for dedupe
  default_address   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  marketing_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_sms_opt_in   BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT        NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

-- Deduping rule today is "email else name".  We model both, but use a
-- partial unique index that is friendly to NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_stripe_id
  ON customers (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_email        ON customers (email)         WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone_digits ON customers (phone_digits)  WHERE phone_digits IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_full_name    ON customers (lower(full_name));

-- Stored payment methods (currently denormalized into service_requests).
CREATE TABLE IF NOT EXISTS customer_payment_methods (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT    NOT NULL UNIQUE,
  stripe_setup_intent_id   TEXT,
  type                 TEXT        NOT NULL,            -- 'card', 'us_bank_account', etc.
  brand                TEXT        NOT NULL DEFAULT '', -- 'visa'
  last4                TEXT        NOT NULL DEFAULT '',
  exp_month            SMALLINT,
  exp_year             SMALLINT,
  is_default           BOOLEAN     NOT NULL DEFAULT FALSE,
  detached_at          TIMESTAMPTZ,                      -- when removed from Stripe
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pm_customer        ON customer_payment_methods (customer_id) WHERE detached_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pm_setup_intent    ON customer_payment_methods (stripe_setup_intent_id) WHERE stripe_setup_intent_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. CUSTOMER BALANCE / REWARDS (future feature, but model the seam now)
-- ---------------------------------------------------------------------
-- Append-only ledger.  Never UPDATE balance_entries.  Current balance =
-- SUM(amount).  Use FOR UPDATE on customers when settling concurrent
-- credits/debits.

CREATE TABLE IF NOT EXISTS customer_balance_entries (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  entry_kind     TEXT        NOT NULL CHECK (entry_kind IN ('credit','debit','refund_credit','expiration','adjustment','reward')),
  amount         NUMERIC(12,2) NOT NULL,           -- positive credits, negative debits
  currency       TEXT        NOT NULL DEFAULT 'usd',
  reference_type TEXT        NOT NULL DEFAULT '',  -- 'payment_intent', 'manual', etc.
  reference_id   TEXT        NOT NULL DEFAULT '',
  memo           TEXT        NOT NULL DEFAULT '',
  created_by_user_id UUID    REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_customer_created
  ON customer_balance_entries (customer_id, created_at DESC);

-- Optional materialized view for fast dashboards; refresh on a cron.
-- CREATE MATERIALIZED VIEW customer_balances AS
--   SELECT customer_id, SUM(amount)::NUMERIC(12,2) AS balance
--   FROM customer_balance_entries GROUP BY customer_id;

-- ---------------------------------------------------------------------
-- 5. PAYMENT LEDGER (general charge ledger; supersedes terminal-payments.json)
-- ---------------------------------------------------------------------
-- 001_initial_schema.sql created `card_on_file_charges`.  We keep that
-- name for backwards compat but add the columns we'll need for a
-- proper ledger that links to customers + payment_links.

ALTER TABLE card_on_file_charges
  ADD COLUMN IF NOT EXISTS customer_uuid          UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS payment_link_id_ref    TEXT REFERENCES payment_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency               TEXT NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS fee_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_brand             TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last4                  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS deleted_at             TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cof_customer_uuid
  ON card_on_file_charges (customer_uuid) WHERE customer_uuid IS NOT NULL;

-- Refund ledger.  Today refund history is derived live from Stripe API
-- in /api/paid-order-detail.  For audit + offline reporting we need a
-- local mirror.
CREATE TABLE IF NOT EXISTS payment_refunds (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_refund_id    TEXT        NOT NULL UNIQUE,
  payment_intent_id   TEXT        NOT NULL,
  charge_id           TEXT        NOT NULL DEFAULT '',
  amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency            TEXT        NOT NULL DEFAULT 'usd',
  status              TEXT        NOT NULL DEFAULT 'pending',
  reason              TEXT        NOT NULL DEFAULT '',
  initiated_by_user_id UUID       REFERENCES users(id),
  customer_uuid       UUID        REFERENCES customers(id),
  notes               TEXT        NOT NULL DEFAULT '',
  refunded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_payment_intent ON payment_refunds (payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_refunds_customer       ON payment_refunds (customer_uuid) WHERE customer_uuid IS NOT NULL;

-- Stripe webhook log (idempotency + replay protection).
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id   TEXT        NOT NULL UNIQUE,        -- evt_…
  event_type        TEXT        NOT NULL,
  api_version       TEXT        NOT NULL DEFAULT '',
  livemode          BOOLEAN     NOT NULL DEFAULT TRUE,
  payload           JSONB       NOT NULL,
  processed_at      TIMESTAMPTZ,
  processing_error  TEXT        NOT NULL DEFAULT '',
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_received_at ON stripe_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_unprocessed ON stripe_webhook_events (received_at) WHERE processed_at IS NULL;

-- Add the customer FK to payment_links retroactively.
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS customer_uuid UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_payment_links_customer_uuid
  ON payment_links (customer_uuid) WHERE customer_uuid IS NOT NULL;

-- ---------------------------------------------------------------------
-- 6. SERVICE REQUESTS (extends 001 service_requests with customer FK + media)
-- ---------------------------------------------------------------------

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS customer_uuid UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS secure_card_prefill_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS secure_card_prefill_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_service_requests_customer_uuid
  ON service_requests (customer_uuid) WHERE customer_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_assigned
  ON service_requests (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_prefill_token_hash
  ON service_requests (secure_card_prefill_token_hash)
  WHERE secure_card_prefill_token_hash IS NOT NULL;

-- Free-text note timeline tied to a service request (technician notes,
-- internal comments, etc.).  Append-only.
CREATE TABLE IF NOT EXISTS service_request_notes (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id TEXT        NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  author_user_id     UUID        REFERENCES users(id),
  body               TEXT        NOT NULL,
  visibility         TEXT        NOT NULL DEFAULT 'internal'
                                 CHECK (visibility IN ('internal','customer_visible')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_service_notes_request
  ON service_request_notes (service_request_id, created_at DESC) WHERE deleted_at IS NULL;

-- Attached photos / docs.  Store metadata; binary in S3-compatible bucket.
CREATE TABLE IF NOT EXISTS service_request_media (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id TEXT        NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  uploaded_by_user_id UUID       REFERENCES users(id),
  file_name          TEXT        NOT NULL,
  mime_type          TEXT        NOT NULL,
  size_bytes         BIGINT      NOT NULL DEFAULT 0,
  storage_url        TEXT        NOT NULL,
  thumb_url          TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_service_media_request
  ON service_request_media (service_request_id, created_at DESC) WHERE deleted_at IS NULL;

-- Scheduled service appointments.  Today this is implicit in queueStatus.
CREATE TABLE IF NOT EXISTS service_appointments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  TEXT        NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  scheduled_for_start TIMESTAMPTZ NOT NULL,
  scheduled_for_end   TIMESTAMPTZ NOT NULL,
  technician_user_id  UUID        REFERENCES users(id),
  status              TEXT        NOT NULL DEFAULT 'scheduled'
                                  CHECK (status IN ('scheduled','en_route','on_site','completed','cancelled','no_show')),
  notes               TEXT        NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_request
  ON service_appointments (service_request_id);
CREATE INDEX IF NOT EXISTS idx_appointments_tech_day
  ON service_appointments (technician_user_id, scheduled_for_start);

-- ---------------------------------------------------------------------
-- 7. EVENTS (extends 001 events with capacity + bring-your-own-form)
-- ---------------------------------------------------------------------

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS capacity INT,
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hero_image_url TEXT,
  ADD COLUMN IF NOT EXISTS rsvp_form_id UUID; -- forward decl to forms

ALTER TABLE event_rsvps
  ADD COLUMN IF NOT EXISTS customer_uuid UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'public_form';

CREATE INDEX IF NOT EXISTS idx_event_rsvps_customer
  ON event_rsvps (customer_uuid) WHERE customer_uuid IS NOT NULL;

-- ---------------------------------------------------------------------
-- 8. GENERIC FORMS (foundation for "external form tool")
-- ---------------------------------------------------------------------
-- Lets you spin up new public-facing forms (RSVP, repair lead, warranty
-- registration, satisfaction survey) without writing a new SQL table
-- for each one.  Form schema is JSONB; responses are JSONB.  Indexable
-- attributes promoted to first-class columns when you need to report.

CREATE TABLE IF NOT EXISTS forms (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT        NOT NULL UNIQUE,
  title          TEXT        NOT NULL,
  description    TEXT        NOT NULL DEFAULT '',
  schema         JSONB       NOT NULL,                       -- JSONSchema-ish
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  is_public      BOOLEAN     NOT NULL DEFAULT FALSE,
  notify_emails  TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_by_user_id UUID    REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         UUID        NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  customer_uuid   UUID        REFERENCES customers(id),
  submitted_email CITEXT,
  submitted_phone TEXT,
  payload         JSONB       NOT NULL,
  ip_address      INET,
  user_agent      TEXT        NOT NULL DEFAULT '',
  reviewed_by_user_id UUID    REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_created
  ON form_submissions (form_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_form_submissions_customer
  ON form_submissions (customer_uuid) WHERE customer_uuid IS NOT NULL;

-- ---------------------------------------------------------------------
-- 9. NOTIFICATIONS (email/SMS audit + retry queue)
-- ---------------------------------------------------------------------
-- Today: a single Resend POST in server.js with the error stored back
-- onto the payment_links record.  This table makes outbound comms
-- queryable, retryable, and audit-friendly.

CREATE TABLE IF NOT EXISTS notification_messages (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel             TEXT        NOT NULL CHECK (channel IN ('email','sms')),
  template_key        TEXT        NOT NULL,             -- 'payment_link.paid' etc.
  recipient_email     CITEXT,
  recipient_phone     TEXT,
  customer_uuid       UUID        REFERENCES customers(id),
  related_entity_type TEXT        NOT NULL DEFAULT '',
  related_entity_id   TEXT        NOT NULL DEFAULT '',
  payload             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  provider_message_id TEXT        NOT NULL DEFAULT '',
  status              TEXT        NOT NULL DEFAULT 'queued'
                                  CHECK (status IN ('queued','sent','failed','skipped')),
  error_message       TEXT        NOT NULL DEFAULT '',
  attempts            INT         NOT NULL DEFAULT 0,
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_status
  ON notification_messages (status, scheduled_for) WHERE status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS idx_notifications_related
  ON notification_messages (related_entity_type, related_entity_id);

-- ---------------------------------------------------------------------
-- 10. AUDIT LOG (who did what, when, to which row)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL   PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID        REFERENCES users(id),
  actor_label   TEXT        NOT NULL DEFAULT '',         -- for system actors
  action        TEXT        NOT NULL,                    -- 'payment_link.deactivate'
  entity_type   TEXT        NOT NULL,                    -- 'payment_link'
  entity_id     TEXT        NOT NULL,
  ip_address    INET,
  user_agent    TEXT        NOT NULL DEFAULT '',
  before_state  JSONB,
  after_state   JSONB,
  notes         TEXT        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON audit_log (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_action_time
  ON audit_log (action, occurred_at DESC);

-- ---------------------------------------------------------------------
-- 11. APP CONFIGURATION (replaces ad-hoc env-only feature flags)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  updated_by_user_id UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feature flags are just a special case.
INSERT INTO app_settings (key, value, description)
VALUES
  ('feature.commissions_enabled', 'true'::jsonb, 'Show the Commissions UI to executive users.'),
  ('feature.rewards_enabled',     'false'::jsonb, 'Customer balance / rewards module.'),
  ('payments.single_use_limit',   '1'::jsonb,    'Stripe payment_link completed_sessions limit.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 12. UPDATED_AT TRIGGERS  (one trigger function, many tables)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'users','user_sessions','employees','departments',
      'customers','customer_payment_methods',
      'service_appointments',
      'forms','form_submissions',
      'notification_messages','app_settings'
    ])
  LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS trg_%1$s_set_updated_at ON %1$s;
      CREATE TRIGGER trg_%1$s_set_updated_at
        BEFORE UPDATE ON %1$s
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    $f$, t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY (forward-looking; not enforced by default)
-- ---------------------------------------------------------------------
-- Enable RLS on PII tables now so future per-department scoping is a
-- policy change rather than a schema migration.  Until you add policies
-- you'll need to set `BYPASSRLS` on the application role.
--
--   ALTER ROLE wilson_app BYPASSRLS;
--
-- ALTER TABLE customers              ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE service_requests       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE service_request_notes  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE service_request_media  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE form_submissions       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notification_messages  ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- Done.
-- ---------------------------------------------------------------------

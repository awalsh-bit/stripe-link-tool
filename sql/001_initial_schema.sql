CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS payment_links (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',

  creator_code TEXT NOT NULL DEFAULT '',
  creator_name TEXT NOT NULL DEFAULT '',
  creator_email TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',

  sales_order TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',

  workflow_type TEXT NOT NULL DEFAULT 'appliance',
  status TEXT NOT NULL DEFAULT 'sent',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  type TEXT NOT NULL DEFAULT 'card_link',

  currency TEXT NOT NULL DEFAULT 'usd',
  requested_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  requested_total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,

  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_date TIMESTAMPTZ,

  payment_link_id TEXT NOT NULL DEFAULT '',
  payment_link_url TEXT NOT NULL DEFAULT '',
  checkout_session_id TEXT NOT NULL DEFAULT '',
  payment_intent_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  payment_method_id TEXT NOT NULL DEFAULT '',

  payment_method_type TEXT NOT NULL DEFAULT '',
  payment_status_detail TEXT NOT NULL DEFAULT '',
  agreement_text TEXT NOT NULL DEFAULT '',

  payment_notification_sent_at TIMESTAMPTZ,
  payment_notification_error TEXT NOT NULL DEFAULT '',

  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT NOT NULL DEFAULT '',

  balance_charged_at TIMESTAMPTZ,
  balance_payment_intent_id TEXT NOT NULL DEFAULT '',
  balance_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_canceled_at TIMESTAMPTZ,
  balance_cancellation_reason TEXT NOT NULL DEFAULT '',
  balance_original_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_updated_at TIMESTAMPTZ,

  CONSTRAINT payment_links_status_check CHECK (
    status IN ('sent', 'viewed', 'ach_pending', 'paid', 'deactivated')
  ),
  CONSTRAINT payment_links_workflow_type_check CHECK (
    workflow_type IN ('appliance', 'hvac_deposit')
  ),
  CONSTRAINT payment_links_type_check CHECK (
    type IN ('card_link', 'ach_link')
  )
);

CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links (status);
CREATE INDEX IF NOT EXISTS idx_payment_links_department ON payment_links (department);
CREATE INDEX IF NOT EXISTS idx_payment_links_created_at ON payment_links (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_links_paid_date ON payment_links (paid_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_links_sales_order ON payment_links (sales_order);
CREATE INDEX IF NOT EXISTS idx_payment_links_payment_link_id ON payment_links (payment_link_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_payment_intent_id ON payment_links (payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_checkout_session_id ON payment_links (checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_customer_id ON payment_links (customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_workflow_status ON payment_links (workflow_type, status);

CREATE TABLE IF NOT EXISTS card_on_file_charges (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  charge_type TEXT NOT NULL DEFAULT 'card_on_file',
  status TEXT NOT NULL DEFAULT 'paid',

  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',

  creator_code TEXT NOT NULL DEFAULT '',
  creator_name TEXT NOT NULL DEFAULT '',
  creator_email TEXT NOT NULL DEFAULT '',

  reference TEXT NOT NULL DEFAULT '',
  sales_order TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',

  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_date TIMESTAMPTZ,
  payment_intent_id TEXT NOT NULL DEFAULT '',

  hvac_deposit_record_id TEXT NOT NULL DEFAULT '',

  CONSTRAINT card_on_file_charges_type_check CHECK (
    charge_type IN ('terminal', 'card_on_file', 'hvac_balance')
  )
);

CREATE INDEX IF NOT EXISTS idx_card_on_file_charges_created_at ON card_on_file_charges (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_on_file_charges_paid_date ON card_on_file_charges (paid_date DESC);
CREATE INDEX IF NOT EXISTS idx_card_on_file_charges_sales_order ON card_on_file_charges (sales_order);
CREATE INDEX IF NOT EXISTS idx_card_on_file_charges_payment_intent_id ON card_on_file_charges (payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_card_on_file_charges_type ON card_on_file_charges (charge_type);

CREATE TABLE IF NOT EXISTS service_requests (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  queue_status TEXT NOT NULL DEFAULT 'Call Status Pending',
  queue_status_notes TEXT NOT NULL DEFAULT '',
  erp_order_number TEXT NOT NULL DEFAULT '',

  setup_intent_id TEXT NOT NULL DEFAULT '',
  setup_intent_status TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  payment_method_id TEXT NOT NULL DEFAULT '',

  customer_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',

  service_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  billing_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  billing_same_as_service BOOLEAN,

  purchase_date TEXT NOT NULL DEFAULT '',
  purchased_within_12_months TEXT NOT NULL DEFAULT '',
  gate_code TEXT NOT NULL DEFAULT '',
  contact_method TEXT NOT NULL DEFAULT '',

  unit_count TEXT NOT NULL DEFAULT 'One',
  units JSONB NOT NULL DEFAULT '[]'::jsonb,
  problem_description TEXT NOT NULL DEFAULT '',

  card_required BOOLEAN NOT NULL DEFAULT TRUE,
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  card_brand TEXT NOT NULL DEFAULT '',
  last4 TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_service_requests_queue_status ON service_requests (queue_status);
CREATE INDEX IF NOT EXISTS idx_service_requests_created_at ON service_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_requests_updated_at ON service_requests (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_requests_setup_intent_id ON service_requests (setup_intent_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_customer_email ON service_requests (customer_email);
CREATE INDEX IF NOT EXISTS idx_service_requests_customer_phone ON service_requests (customer_phone);

CREATE TABLE IF NOT EXISTS service_requests_archive (
  LIKE service_requests INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED
);

ALTER TABLE service_requests_archive
  ADD PRIMARY KEY (id);

CREATE INDEX IF NOT EXISTS idx_service_requests_archive_queue_status ON service_requests_archive (queue_status);
CREATE INDEX IF NOT EXISTS idx_service_requests_archive_created_at ON service_requests_archive (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_requests_archive_updated_at ON service_requests_archive (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_requests_archive_setup_intent_id ON service_requests_archive (setup_intent_id);

CREATE TABLE IF NOT EXISTS events (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  public_path TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT events_status_check CHECK (
    status IN ('active', 'archived')
  )
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events (starts_at DESC);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_slug TEXT NOT NULL REFERENCES events(slug) ON DELETE CASCADE,
  event_name TEXT NOT NULL DEFAULT '',

  full_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  guest_count INTEGER NOT NULL,
  attendee_type TEXT NOT NULL,
  wants_email_updates BOOLEAN NOT NULL DEFAULT FALSE,
  wants_text_updates BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT event_rsvps_guest_count_check CHECK (guest_count > 0),
  CONSTRAINT event_rsvps_attendee_type_check CHECK (
    attendee_type IN ('Homeowner', 'Builder', 'Designer', 'Outdoor Cooking Fan', 'Other')
  )
);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_event_slug ON event_rsvps (event_slug);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_updated_at ON event_rsvps (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_email ON event_rsvps (email);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_phone ON event_rsvps (phone);

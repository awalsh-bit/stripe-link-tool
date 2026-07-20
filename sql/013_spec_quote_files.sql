-- 013: Quote Library for spec packages.
-- Idempotent; also applied at boot by lib/spec-quotes-postgres.js.
--
-- Uploaded sales order / quote PDFs, stored in Postgres so a quote uploaded
-- from ANY machine can be merged with spec pages from any other machine
-- (works around endpoint security that blocks browser uploads on some
-- laptops). Small transient files; rows purge automatically after 90 days.

CREATE TABLE IF NOT EXISTS spec_quote_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT 'quote.pdf',
  byte_size INT NOT NULL DEFAULT 0,
  pdf_bytes BYTEA NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spec_quote_files_uploaded_at
  ON spec_quote_files (uploaded_at DESC);

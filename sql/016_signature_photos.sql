-- Email signature headshots (Signature Builder page).
-- One photo per user; the id is served publicly at
-- /public/signature-photos/:id so email clients can load it without cookies.
-- Replacing a photo upserts on user_email and KEEPS the same id, so
-- signatures already installed in Outlook/Gmail update automatically.
-- The server also runs this idempotently at boot (lib/signature-postgres.js).

CREATE TABLE IF NOT EXISTS signature_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  byte_size INT NOT NULL DEFAULT 0,
  photo_bytes BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Email signature headshots — one photo per user, stored in Postgres and
// served at a stable public URL (email clients fetch images without cookies,
// so the serving route is unauthenticated). Replacing a photo keeps the same
// id, so already-installed signatures pick up the new picture automatically.
// ---------------------------------------------------------------------------

const SIGNATURE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS signature_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  byte_size INT NOT NULL DEFAULT 0,
  photo_bytes BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(SIGNATURE_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function saveSignaturePhoto({ userEmail, contentType, bytes }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO signature_photos (user_email, content_type, byte_size, photo_bytes, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_email) DO UPDATE SET
       content_type = EXCLUDED.content_type,
       byte_size = EXCLUDED.byte_size,
       photo_bytes = EXCLUDED.photo_bytes,
       updated_at = NOW()
     RETURNING id, updated_at`,
    [normalizeEmail(userEmail), contentType, bytes.length, bytes]
  );
  return {
    id: result.rows[0].id,
    updatedAt: result.rows[0].updated_at?.toISOString?.() || null
  };
}

export async function getSignaturePhoto(id) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT id, content_type, photo_bytes, updated_at FROM signature_photos WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    contentType: row.content_type,
    bytes: row.photo_bytes,
    updatedAt: row.updated_at?.toISOString?.() || null
  };
}

export async function getSignaturePhotoByEmail(email) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT id, content_type, byte_size, updated_at FROM signature_photos WHERE user_email = $1`,
    [normalizeEmail(email)]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    contentType: row.content_type,
    byteSize: row.byte_size,
    updatedAt: row.updated_at?.toISOString?.() || null
  };
}

import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Terms & Conditions signatures (replaces the FormSite form).
//   terms-sign.html        — PUBLIC signing form (direct URL only, no nav)
//   terms-signatures.html  — INTERNAL capture + record viewer
// Each record stores the printed name, the drawn signature (PNG data URL),
// where it was captured, and the terms version signed. sales_order stays
// empty for now — Andrew maps records to sales orders later.
// ---------------------------------------------------------------------------

export const TERMS_VERSION = "2026-08";

const TERMS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS terms_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  normalized_name TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT '',            -- PNG data URL of the drawn signature
  source TEXT NOT NULL DEFAULT 'public',         -- 'public' | 'internal'
  terms_version TEXT NOT NULL DEFAULT '',
  sales_order TEXT NOT NULL DEFAULT '',          -- mapped later
  captured_by TEXT NOT NULL DEFAULT '',          -- internal captures: staff email
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_terms_sig_name ON terms_signatures (normalized_name);
CREATE INDEX IF NOT EXISTS idx_terms_sig_signed ON terms_signatures (signed_at);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(TERMS_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

function mapRow(row, { includeSignature = true } = {}) {
  return {
    id: row.id,
    name: row.name,
    signature: includeSignature ? row.signature : undefined,
    source: row.source,
    termsVersion: row.terms_version,
    salesOrder: row.sales_order,
    capturedBy: row.captured_by,
    signedAt: row.signed_at?.toISOString?.() || null
  };
}

export async function saveTermsSignature({ name, signature, source = "public", capturedBy = "", ip = "", userAgent = "" }) {
  const pool = await getReadyPool();
  const cleanName = String(name || "").trim().slice(0, 120);
  const sig = String(signature || "");
  if (!cleanName) throw new Error("A printed first and last name is required.");
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig)) throw new Error("The signature image is missing or invalid.");
  if (sig.length > 400000) throw new Error("The signature image is too large.");

  const result = await pool.query(
    `INSERT INTO terms_signatures (name, normalized_name, signature, source, terms_version, captured_by, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      cleanName,
      cleanName.toUpperCase().replace(/\s+/g, " "),
      sig,
      source === "internal" ? "internal" : "public",
      TERMS_VERSION,
      String(capturedBy || "").trim().toLowerCase().slice(0, 200),
      String(ip || "").slice(0, 60),
      String(userAgent || "").slice(0, 300)
    ]
  );
  return mapRow(result.rows[0]);
}

export async function listTermsSignatures({ search = "", limit = 200 } = {}) {
  const pool = await getReadyPool();
  const params = [];
  let where = "";
  const term = String(search || "").trim().toUpperCase();
  if (term) {
    params.push(`%${term}%`);
    where = `WHERE normalized_name LIKE $1`;
  }
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  const result = await pool.query(
    `SELECT * FROM terms_signatures ${where} ORDER BY signed_at DESC LIMIT $${params.length}`,
    params
  );
  return result.rows.map((row) => mapRow(row));
}

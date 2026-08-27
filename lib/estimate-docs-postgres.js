// ---------------------------------------------------------------------------
// Original work-order PDFs behind estimate links. The scan already has the
// document in hand — this keeps the bytes so the client's estimate page can
// offer "view the technician's work order" through the same token. Docs are
// saved at scan time (before a token exists), then attached at create;
// unattached scans (abandoned forms) are swept after 48 hours.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS service_estimate_documents (
  id TEXT PRIMARY KEY,
  estimate_token TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sed_token_idx ON service_estimate_documents (estimate_token);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL);
  await ensurePromise;
  return pool;
}

export async function saveEstimateDocument({ buffer, filename = "" }) {
  const pool = await getReadyPool();
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("Missing document bytes.");
  const id = `doc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  await pool.query(
    `INSERT INTO service_estimate_documents (id, filename, content) VALUES ($1, $2, $3)`,
    [id, String(filename || "work-order.pdf").slice(0, 200), buffer]
  );
  // Opportunistic sweep of abandoned scans (form never submitted).
  pool.query(
    `DELETE FROM service_estimate_documents
     WHERE estimate_token = '' AND created_at < NOW() - INTERVAL '48 hours'`
  ).catch(() => {});
  return id;
}

export async function attachEstimateDocument(id, estimateToken) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE service_estimate_documents SET estimate_token = $2
     WHERE id = $1 AND estimate_token = '' RETURNING id`,
    [String(id || "").slice(0, 60), String(estimateToken || "").slice(0, 60)]
  );
  return result.rows.length > 0;
}

export async function getEstimateDocumentByToken(estimateToken) {
  const cleaned = String(estimateToken || "").slice(0, 60);
  if (!cleaned) return null;
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT filename, content FROM service_estimate_documents
     WHERE estimate_token = $1 ORDER BY created_at DESC LIMIT 1`,
    [cleaned]
  );
  const row = result.rows[0];
  return row ? { filename: row.filename, content: row.content } : null;
}

export async function estimateDocumentExists(estimateToken) {
  const cleaned = String(estimateToken || "").slice(0, 60);
  if (!cleaned) return false;
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT 1 FROM service_estimate_documents WHERE estimate_token = $1 LIMIT 1`,
    [cleaned]
  );
  return result.rows.length > 0;
}

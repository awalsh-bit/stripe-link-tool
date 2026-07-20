import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Quote Library (spec packages) — uploaded sales order / quote PDFs, stored
// in Postgres so the merge can run from any machine even when the machine
// that HAS the PDF can't upload and merge in one step (endpoint security).
//
// Quotes are small (tens of KB), transient working files: anyone with
// spec-package access can see and use the library; the uploader (or an
// executive) can delete; everything auto-purges after 90 days.
// ---------------------------------------------------------------------------

const SPEC_QUOTES_SCHEMA_SQL = `
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
`;

const RETENTION_DAYS = 90;
const MAX_LIST = 100;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(SPEC_QUOTES_SCHEMA_SQL);
      await pool.query(
        `DELETE FROM spec_quote_files WHERE uploaded_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
      );
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }

  await ensurePromise;
  return pool;
}

function mapQuoteRow(row, { withBytes = false } = {}) {
  const mapped = {
    id: row.id,
    uploadedByEmail: row.uploaded_by_email || "",
    uploadedByName: row.uploaded_by_name || "",
    filename: row.filename || "quote.pdf",
    byteSize: Number(row.byte_size) || 0,
    uploadedAt: row.uploaded_at?.toISOString?.() || row.uploaded_at || ""
  };
  if (withBytes) mapped.bytes = row.pdf_bytes;
  return mapped;
}

export async function saveSpecQuote({ uploadedByEmail, uploadedByName = "", filename, bytes }) {
  const pool = await getReadyPool();
  const cleanName =
    String(filename || "quote.pdf")
      .replace(/[^A-Za-z0-9 ()._-]+/g, "")
      .trim()
      .slice(0, 120) || "quote.pdf";

  const result = await pool.query(
    `INSERT INTO spec_quote_files (uploaded_by_email, uploaded_by_name, filename, byte_size, pdf_bytes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, uploaded_by_email, uploaded_by_name, filename, byte_size, uploaded_at`,
    [
      String(uploadedByEmail || "").trim().toLowerCase(),
      String(uploadedByName || "").trim(),
      cleanName,
      bytes.length,
      bytes
    ]
  );
  return mapQuoteRow(result.rows[0]);
}

export async function listSpecQuotes() {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT id, uploaded_by_email, uploaded_by_name, filename, byte_size, uploaded_at
     FROM spec_quote_files
     ORDER BY uploaded_at DESC
     LIMIT ${MAX_LIST}`
  );
  return result.rows.map((row) => mapQuoteRow(row));
}

export async function getSpecQuote(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM spec_quote_files WHERE id = $1`, [id]);
  return result.rows[0] ? mapQuoteRow(result.rows[0], { withBytes: true }) : null;
}

// Uploader or executive only — enforced here so every route stays honest.
export async function deleteSpecQuote(id, requesterEmail, isExecutive = false) {
  const pool = await getReadyPool();
  const normalized = String(requesterEmail || "").trim().toLowerCase();

  const result = isExecutive
    ? await pool.query(`DELETE FROM spec_quote_files WHERE id = $1 RETURNING id`, [id])
    : await pool.query(
        `DELETE FROM spec_quote_files WHERE id = $1 AND uploaded_by_email = $2 RETURNING id`,
        [id, normalized]
      );

  return result.rowCount > 0;
}

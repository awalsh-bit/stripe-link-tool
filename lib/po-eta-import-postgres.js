import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// PO ETA Import Builder storage (Purchasing, 2026-10-20).
//
//   po_eta_vendor_maps   per vendor: which portal columns are PO / model / ETA /
//                        requested / qty / status, remembered once the buyer
//                        confirms them so the next export maps itself
//   po_eta_import_runs   every ePASS import file built: who, which vendor and
//                        portal file, how many rows moved, the rows themselves
//                        and the .xlsx bytes (so a file can be re-downloaded
//                        and Cash Ops can see what was pushed into ePASS when)
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS po_eta_vendor_maps (
  vendor_key TEXT PRIMARY KEY,
  headers_sig TEXT NOT NULL DEFAULT '',
  header_names JSONB NOT NULL DEFAULT '{}'::jsonb,
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  sheet_name TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS po_eta_import_runs (
  id BIGSERIAL PRIMARY KEY,
  vendor_key TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '',
  by_email TEXT NOT NULL DEFAULT '',
  by_name TEXT NOT NULL DEFAULT '',
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_exported INTEGER NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  dates_as_text BOOLEAN NOT NULL DEFAULT FALSE,
  file BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE po_eta_import_runs ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'xlsx';
CREATE INDEX IF NOT EXISTS po_eta_import_runs_created_idx ON po_eta_import_runs (created_at DESC);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

export async function listVendorMaps() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT vendor_key, headers_sig, header_names, mapping, sheet_name, updated_by, updated_at FROM po_eta_vendor_maps`);
  const out = {};
  for (const row of r.rows) out[row.vendor_key] = { vendorKey: row.vendor_key, headersSig: row.headers_sig, headerNames: row.header_names || {}, mapping: row.mapping || {}, sheetName: row.sheet_name, updatedBy: row.updated_by, updatedAt: row.updated_at };
  return out;
}

export async function saveVendorMap({ vendorKey, headersSig = "", headerNames = {}, mapping = {}, sheetName = "", by = "" }) {
  const pool = await getReadyPool();
  await pool.query(
    `INSERT INTO po_eta_vendor_maps (vendor_key, headers_sig, header_names, mapping, sheet_name, updated_by, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, NOW())
     ON CONFLICT (vendor_key) DO UPDATE SET headers_sig = EXCLUDED.headers_sig, header_names = EXCLUDED.header_names, mapping = EXCLUDED.mapping, sheet_name = EXCLUDED.sheet_name, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [vendorKey, headersSig, JSON.stringify(headerNames), JSON.stringify(mapping), sheetName, by]
  );
}

export async function recordImportRun({ vendorKey, sourceFile = "", byEmail = "", byName = "", rowsTotal = 0, rowsExported = 0, summary = {}, lines = [], datesAsText = false, format = "csv", file = null }) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `INSERT INTO po_eta_import_runs (vendor_key, source_file, by_email, by_name, rows_total, rows_exported, summary, lines, dates_as_text, format, file)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11) RETURNING id, created_at`,
    [vendorKey, sourceFile, byEmail, byName, rowsTotal, rowsExported, JSON.stringify(summary), JSON.stringify(lines), !!datesAsText, String(format || "csv"), file]
  );
  return { id: Number(r.rows[0].id), createdAt: r.rows[0].created_at };
}

export async function listImportRuns({ limit = 40 } = {}) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT id, vendor_key, source_file, by_email, by_name, rows_total, rows_exported, summary, dates_as_text, format, created_at, (file IS NOT NULL) AS has_file
     FROM po_eta_import_runs ORDER BY created_at DESC LIMIT $1`, [Math.max(1, Math.min(200, Number(limit) || 40))]
  );
  return r.rows.map((row) => ({ id: Number(row.id), vendorKey: row.vendor_key, sourceFile: row.source_file, byEmail: row.by_email, byName: row.by_name, rowsTotal: row.rows_total, rowsExported: row.rows_exported, summary: row.summary || {}, datesAsText: row.dates_as_text, format: row.format || "xlsx", createdAt: row.created_at, hasFile: row.has_file }));
}

export async function getImportRun(id) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM po_eta_import_runs WHERE id = $1`, [Number(id)]);
  const row = r.rows[0]; if (!row) return null;
  return { id: Number(row.id), vendorKey: row.vendor_key, sourceFile: row.source_file, byEmail: row.by_email, byName: row.by_name, rowsTotal: row.rows_total, rowsExported: row.rows_exported, summary: row.summary || {}, lines: row.lines || [], datesAsText: row.dates_as_text, format: row.format || "xlsx", createdAt: row.created_at, file: row.file };
}

// Most recent export per PO + model, so the review table can say "already
// sent to ePASS on 10/18 with this ETA" before the feed catches up.
export async function recentExportedLines({ days = 14 } = {}) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT id, created_at, lines FROM po_eta_import_runs WHERE created_at >= NOW() - ($1 || ' days')::interval ORDER BY created_at DESC`, [String(Math.max(1, Number(days) || 14))]);
  const out = new Map();
  for (const row of r.rows) {
    for (const l of row.lines || []) {
      const key = `${String(l.po || "").toUpperCase()}|${String(l.model || "").toUpperCase()}`;
      if (!out.has(key)) out.set(key, { runId: Number(row.id), at: row.created_at, eta: l.eta || "", rdd: l.rdd || "" });
    }
  }
  return out;
}

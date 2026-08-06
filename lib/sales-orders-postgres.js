import crypto from "node:crypto";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Sales Order Health Report (sales-order-health.html) — the latest open-order
// export (ExportInvoice xlsx) is parsed in the browser and stored here as a
// single snapshot, so everyone sees the same data with a "data as of" stamp.
// Health rules are applied client-side so rule tweaks don't require re-upload.
// ---------------------------------------------------------------------------

const SALES_ORDERS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sales_order_snapshots (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS sales_order_dismissals (
  user_email TEXT NOT NULL,
  invoice TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_email, invoice)
);

CREATE TABLE IF NOT EXISTS sales_order_flag_closures (
  token TEXT PRIMARY KEY,
  severity TEXT NOT NULL DEFAULT '',
  invoice TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT '',
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  order_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed_by_email TEXT NOT NULL DEFAULT '',
  closed_by_name TEXT NOT NULL DEFAULT '',
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_uploaded_at TIMESTAMPTZ,
  report_filename TEXT NOT NULL DEFAULT ''
);
ALTER TABLE sales_order_flag_closures ADD COLUMN IF NOT EXISTS report_uploaded_at TIMESTAMPTZ;
ALTER TABLE sales_order_flag_closures ADD COLUMN IF NOT EXISTS report_filename TEXT NOT NULL DEFAULT '';
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(SALES_ORDERS_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

function mapRow(row) {
  return {
    filename: row.filename,
    uploadedByEmail: row.uploaded_by_email,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: row.uploaded_at?.toISOString?.() || null,
    rowCount: row.row_count,
    rows: row.data || []
  };
}

export async function getSalesOrderSnapshot() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM sales_order_snapshots WHERE id = 1`);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// "My Order Flags" dismissals — closing a flag card on the dashboard stores
// the order's current flag signature; the card stays closed until the order's
// flags change, then it reappears with the new problem.
// ---------------------------------------------------------------------------

export async function listOrderFlagDismissals(userEmail) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT invoice, signature, dismissed_at FROM sales_order_dismissals WHERE user_email = $1`,
    [String(userEmail || "").trim().toLowerCase()]
  );
  return result.rows.map((row) => ({
    invoice: row.invoice,
    signature: row.signature,
    dismissedAt: row.dismissed_at?.toISOString?.() || null
  }));
}

export async function dismissOrderFlag({ userEmail, invoice, signature }) {
  const pool = await getReadyPool();
  await pool.query(
    `INSERT INTO sales_order_dismissals (user_email, invoice, signature, dismissed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_email, invoice) DO UPDATE SET
       signature = EXCLUDED.signature,
       dismissed_at = NOW()`,
    [
      String(userEmail || "").trim().toLowerCase(),
      String(invoice || "").trim().slice(0, 40),
      String(signature || "").slice(0, 800)
    ]
  );
  return true;
}

// ---------------------------------------------------------------------------
// Flag closure log — every Close on "My Sales Order Health" writes an
// append-only record under a flag-instance token (RFI-… for red, YFI-… for
// yellow), so closed "fixes" can be inspected later. The dismissals table
// above only holds the CURRENT hide state; this is the permanent history.
// ---------------------------------------------------------------------------

const TOKEN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateClosureToken(severity) {
  const prefix = severity === "red" ? "RFI" : "YFI";
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) code += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return `${prefix}-${code}`;
}

export async function recordFlagClosure({ severity, invoice, signature, flags, orderSnapshot, byEmail, byName, reportUploadedAt = null, reportFilename = "", closedAt = null }) {
  const pool = await getReadyPool();
  const level = severity === "red" ? "red" : "yellow";
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = generateClosureToken(level);
    const result = await pool.query(
      `INSERT INTO sales_order_flag_closures
         (token, severity, invoice, signature, flags, order_snapshot, closed_by_email, closed_by_name, report_uploaded_at, report_filename, closed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, COALESCE($11, NOW()))
       ON CONFLICT (token) DO NOTHING
       RETURNING token`,
      [
        token,
        level,
        String(invoice || "").trim().slice(0, 40),
        String(signature || "").slice(0, 800),
        JSON.stringify(Array.isArray(flags) ? flags.slice(0, 20) : []),
        JSON.stringify(orderSnapshot || {}),
        String(byEmail || "").trim().toLowerCase(),
        String(byName || "").trim(),
        reportUploadedAt || null,
        String(reportFilename || "").slice(0, 200),
        closedAt || null
      ]
    );
    if (result.rows[0]) return result.rows[0].token;
  }
  throw new Error("Could not allocate a flag-instance token.");
}

export async function listFlagClosures() {
  const pool = await getReadyPool();
  await ensureClosureBackfill();
  const result = await pool.query(
    `SELECT * FROM sales_order_flag_closures ORDER BY closed_at DESC LIMIT 500`
  );
  return result.rows.map(mapClosureRow);
}

// ---------------------------------------------------------------------------
// Backfill: flags closed BEFORE the closure log shipped (or whose log write
// failed) exist only in sales_order_dismissals. On first read per process,
// reconstruct closure records for any dismissal with no matching closure —
// severity and flag texts are recoverable from the stored signature
// ("INVOICE|red:Text;yellow:Text"), closed_at from dismissed_at. The report
// version for backfilled rows is unknown and left null.
// ---------------------------------------------------------------------------

let backfillPromise = null;

function parseSignatureFlags(signature) {
  const bar = String(signature || "").indexOf("|");
  const flagsPart = bar >= 0 ? String(signature).slice(bar + 1) : "";
  const flags = flagsPart
    ? flagsPart.split(";").map((piece) => {
        const colon = piece.indexOf(":");
        if (colon <= 0) return null;
        return {
          level: piece.slice(0, colon) === "red" ? "red" : "yellow",
          text: piece.slice(colon + 1).slice(0, 120)
        };
      }).filter(Boolean)
    : [];
  const severity = flags.some((f) => f.level === "red") ? "red" : "yellow";
  return { flags, severity };
}

async function ensureClosureBackfill() {
  if (!backfillPromise) {
    backfillPromise = runClosureBackfill().catch((err) => {
      console.error("Closure backfill failed:", err.message);
      backfillPromise = null; // retry on next read
    });
  }
  return backfillPromise;
}

async function runClosureBackfill() {
  const pool = await getReadyPool();
  const missing = await pool.query(
    `SELECT d.user_email, d.invoice, d.signature, d.dismissed_at
     FROM sales_order_dismissals d
     WHERE NOT EXISTS (
       SELECT 1 FROM sales_order_flag_closures c
       WHERE c.invoice = d.invoice
         AND c.signature = d.signature
         AND c.closed_by_email = d.user_email
     )`
  );
  if (!missing.rows.length) return 0;

  const snapshotResult = await pool.query(`SELECT data FROM sales_order_snapshots WHERE id = 1`);
  const snapshotRows = snapshotResult.rows[0]?.data || [];
  const byInvoice = new Map(snapshotRows.map((row) => [String(row.invoice || "").trim(), row]));

  let created = 0;
  for (const row of missing.rows) {
    const { flags, severity } = parseSignatureFlags(row.signature);
    await recordFlagClosure({
      severity,
      invoice: row.invoice,
      signature: row.signature,
      flags,
      orderSnapshot: byInvoice.get(row.invoice) || {},
      byEmail: row.user_email,
      byName: "",
      closedAt: row.dismissed_at
    });
    created++;
  }
  console.log(`Closure backfill: created ${created} record(s) from existing dismissals.`);
  return created;
}

// Date-ranged listing for the Instance Closure Report. start/end are
// YYYY-MM-DD in Central time; end is inclusive. The naive midnight is
// interpreted AS Chicago wall time (timestamp AT TIME ZONE), which yields
// the correct UTC instant regardless of the server's timezone.
export async function listFlagClosuresRange({ start, end }) {
  const pool = await getReadyPool();
  await ensureClosureBackfill();
  const result = await pool.query(
    `SELECT * FROM sales_order_flag_closures
     WHERE closed_at >= ($1::date)::timestamp AT TIME ZONE 'America/Chicago'
       AND closed_at < ($2::date + INTERVAL '1 day') AT TIME ZONE 'America/Chicago'
     ORDER BY closed_at DESC
     LIMIT 5000`,
    [start, end]
  );
  return result.rows.map(mapClosureRow);
}

function mapClosureRow(row) {
  return ({
    token: row.token,
    severity: row.severity,
    invoice: row.invoice,
    signature: row.signature,
    flags: row.flags || [],
    order: row.order_snapshot || {},
    closedByEmail: row.closed_by_email,
    closedByName: row.closed_by_name,
    closedAt: row.closed_at?.toISOString?.() || null,
    reportUploadedAt: row.report_uploaded_at?.toISOString?.() || null,
    reportFilename: row.report_filename || ""
  });
}

export async function saveSalesOrderSnapshot({ rows, filename, byEmail, byName }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO sales_order_snapshots (id, filename, uploaded_by_email, uploaded_by_name, uploaded_at, row_count, data)
     VALUES (1, $1, $2, $3, NOW(), $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       filename = EXCLUDED.filename,
       uploaded_by_email = EXCLUDED.uploaded_by_email,
       uploaded_by_name = EXCLUDED.uploaded_by_name,
       uploaded_at = NOW(),
       row_count = EXCLUDED.row_count,
       data = EXCLUDED.data
     RETURNING *`,
    [
      String(filename || "").slice(0, 200),
      String(byEmail || "").trim().toLowerCase(),
      String(byName || "").trim(),
      rows.length,
      JSON.stringify(rows)
    ]
  );
  return mapRow(result.rows[0]);
}

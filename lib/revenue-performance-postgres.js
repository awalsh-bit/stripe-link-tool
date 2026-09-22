import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Revenue performance (target-builder.html) — parsed Salesperson Activity
// Report (ePASS OE-23) snapshots, one row per calendar month. Re-uploading a
// report for the same month replaces that month's snapshot, so the daily
// month-to-date export keeps the month current while prior months keep their
// final numbers. This is the revenue numerator; revenue-targets-postgres.js
// holds the denominator.
// ---------------------------------------------------------------------------

const REVENUE_PERFORMANCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS revenue_performance (
  month TEXT PRIMARY KEY,
  period_from TEXT NOT NULL DEFAULT '',
  period_to TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ticket_count INTEGER NOT NULL DEFAULT 0,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_department JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_salesperson JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  tickets JSONB NOT NULL DEFAULT '[]'::jsonb
);
-- The last OE-23 upload of a month, kept when the ePASS feed takes the month
-- over (2026-09-22), so /api/epass/feed-vs-oe23 can show how the two agree.
CREATE TABLE IF NOT EXISTS revenue_performance_uploads (LIKE revenue_performance INCLUDING ALL);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(REVENUE_PERFORMANCE_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

function mapRow(row, { includeTickets = false } = {}) {
  if (!row) return null;
  const out = {
    month: row.month,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    filename: row.filename,
    uploadedByEmail: row.uploaded_by_email,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: row.uploaded_at?.toISOString?.() || row.uploaded_at || null,
    ticketCount: row.ticket_count,
    totals: row.totals || {},
    byDepartment: row.by_department || {},
    bySalesperson: row.by_salesperson || {},
    warnings: row.warnings || []
  };
  if (includeTickets) out.tickets = row.tickets || [];
  return out;
}

export async function saveRevenuePerformance({
  month, periodFrom, periodTo, filename, byEmail, byName,
  ticketCount, totals, byDepartment, bySalesperson, warnings, tickets
}) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO revenue_performance (
       month, period_from, period_to, filename,
       uploaded_by_email, uploaded_by_name, uploaded_at,
       ticket_count, totals, by_department, by_salesperson, warnings, tickets
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb)
     ON CONFLICT (month) DO UPDATE SET
       period_from = EXCLUDED.period_from,
       period_to = EXCLUDED.period_to,
       filename = EXCLUDED.filename,
       uploaded_by_email = EXCLUDED.uploaded_by_email,
       uploaded_by_name = EXCLUDED.uploaded_by_name,
       uploaded_at = NOW(),
       ticket_count = EXCLUDED.ticket_count,
       totals = EXCLUDED.totals,
       by_department = EXCLUDED.by_department,
       by_salesperson = EXCLUDED.by_salesperson,
       warnings = EXCLUDED.warnings,
       tickets = EXCLUDED.tickets
     RETURNING *`,
    [
      month,
      String(periodFrom || ""),
      String(periodTo || ""),
      String(filename || "").slice(0, 300),
      String(byEmail || "").trim().toLowerCase(),
      String(byName || "").trim(),
      Number(ticketCount) || 0,
      JSON.stringify(totals || {}),
      JSON.stringify(byDepartment || {}),
      JSON.stringify(bySalesperson || {}),
      JSON.stringify(warnings || []),
      JSON.stringify(tickets || [])
    ]
  );
  return mapRow(result.rows[0]);
}

// Snapshot for the month (rollups only — the ticket detail stays server-side
// unless explicitly requested).
export async function getRevenuePerformance(monthStr, { includeTickets = false } = {}) {
  const pool = await getReadyPool();
  const columns = includeTickets ? "*" :
    "month, period_from, period_to, filename, uploaded_by_email, uploaded_by_name, uploaded_at, ticket_count, totals, by_department, by_salesperson, warnings";
  const result = await pool.query(`SELECT ${columns} FROM revenue_performance WHERE month = $1`, [monthStr]);
  return mapRow(result.rows[0], { includeTickets });
}

// Before the feed overwrites a month that a person uploaded, park that
// upload (idempotent: a feed-written row is never copied).
export async function keepLastRevenueUploadCopy(month) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `INSERT INTO revenue_performance_uploads
     SELECT * FROM revenue_performance WHERE month = $1 AND uploaded_by_email <> 'epass-agent'
     ON CONFLICT (month) DO UPDATE SET
       period_from = EXCLUDED.period_from, period_to = EXCLUDED.period_to, filename = EXCLUDED.filename,
       uploaded_by_email = EXCLUDED.uploaded_by_email, uploaded_by_name = EXCLUDED.uploaded_by_name, uploaded_at = EXCLUDED.uploaded_at,
       ticket_count = EXCLUDED.ticket_count, totals = EXCLUDED.totals, by_department = EXCLUDED.by_department,
       by_salesperson = EXCLUDED.by_salesperson, warnings = EXCLUDED.warnings, tickets = EXCLUDED.tickets`,
    [month]
  );
  return r.rowCount || 0;
}

export async function getRevenueUploadCopy(month) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM revenue_performance_uploads WHERE month = $1`, [month]);
  return mapRow(r.rows[0], { includeTickets: true });
}

// Months whose snapshot came from the feed vs a person (the sources table).
export async function listRevenuePerformanceSources() {
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT p.month, p.filename, p.uploaded_by_email, p.uploaded_at, p.ticket_count, (u.month IS NOT NULL) AS has_upload_copy, u.filename AS upload_filename, u.uploaded_at AS upload_at
       FROM revenue_performance p LEFT JOIN revenue_performance_uploads u ON u.month = p.month
      ORDER BY p.month DESC LIMIT 60`
  );
  return r.rows.map((row) => ({
    month: row.month, filename: row.filename, uploadedAt: row.uploaded_at?.toISOString?.() || null, tickets: Number(row.ticket_count),
    fromFeed: row.uploaded_by_email === "epass-agent",
    uploadCopy: row.has_upload_copy ? { filename: row.upload_filename, uploadedAt: row.upload_at?.toISOString?.() || null } : null
  }));
}

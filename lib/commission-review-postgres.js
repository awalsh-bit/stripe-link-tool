// ---------------------------------------------------------------------------
// Commission review: posted statements + exception requests.
//
// Statements on commissions.html are LIVE — they recompute whenever Crystal
// reports are re-uploaded. What a salesperson reviews must not shift under
// them, so posting freezes the rep's statement as a JSONB snapshot keyed by
// (month, code). Re-posting replaces the snapshot; retracting deletes it.
//
// Reps can request an exception against posted lines within the exception
// window: through 45 days after the end of the statement month (calendar
// day, APP_TIMEZONE). After that the month is settled.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS commission_statement_posts (
  month TEXT NOT NULL,
  code TEXT NOT NULL,
  rep_email TEXT NOT NULL DEFAULT '',
  rep_name TEXT NOT NULL DEFAULT '',
  statement JSONB NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_by_email TEXT NOT NULL DEFAULT '',
  posted_by_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (month, code)
);
CREATE INDEX IF NOT EXISTS csp_email_idx ON commission_statement_posts (rep_email);

CREATE TABLE IF NOT EXISTS commission_exceptions (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  code TEXT NOT NULL,
  rep_email TEXT NOT NULL,
  rep_name TEXT NOT NULL DEFAULT '',
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by_email TEXT NOT NULL DEFAULT '',
  resolved_by_name TEXT NOT NULL DEFAULT '',
  response TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS cex_month_idx ON commission_exceptions (month);
CREATE INDEX IF NOT EXISTS cex_email_idx ON commission_exceptions (rep_email);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL);
  await ensurePromise;
  return pool;
}

const normMonth = (m) => String(m || "").trim();
const normCode = (c) => String(c || "").trim().toUpperCase();
const normEmail = (e) => String(e || "").trim().toLowerCase();

// ---------------------------------------------------------------------------
// Exception window: through 45 days after the end of the statement month.
// The deadline is a calendar day; requests are allowed through the end of
// that day in APP_TIMEZONE (America/Chicago by default).
// ---------------------------------------------------------------------------

export function exceptionDeadlineDate(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(normMonth(month));
  if (!m) return null;
  const [, y, mo] = m;
  const lastDayOfMonth = Date.UTC(Number(y), Number(mo), 0); // day 0 of next month
  const deadline = new Date(lastDayOfMonth + 45 * 86400000);
  return deadline.toISOString().slice(0, 10); // YYYY-MM-DD, last allowed day
}

function localDateString(now = new Date()) {
  const tz = process.env.APP_TIMEZONE || "America/Chicago";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function exceptionWindowOpen(month, now = new Date()) {
  const deadline = exceptionDeadlineDate(month);
  if (!deadline) return false;
  return localDateString(now) <= deadline;
}

// ---------------------------------------------------------------------------
// Posted statements
// ---------------------------------------------------------------------------

export async function upsertCommissionPost({ month, code, repEmail, repName, statement, byEmail, byName }) {
  const pool = await getReadyPool();
  await pool.query(
    `INSERT INTO commission_statement_posts (month, code, rep_email, rep_name, statement, posted_at, posted_by_email, posted_by_name)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), $6, $7)
     ON CONFLICT (month, code) DO UPDATE SET
       rep_email = EXCLUDED.rep_email,
       rep_name = EXCLUDED.rep_name,
       statement = EXCLUDED.statement,
       posted_at = NOW(),
       posted_by_email = EXCLUDED.posted_by_email,
       posted_by_name = EXCLUDED.posted_by_name`,
    [normMonth(month), normCode(code), normEmail(repEmail), String(repName || ""), JSON.stringify(statement || {}), normEmail(byEmail), String(byName || "")]
  );
}

export async function deleteCommissionPost(month, code) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `DELETE FROM commission_statement_posts WHERE month = $1 AND code = $2`,
    [normMonth(month), normCode(code)]
  );
  return result.rowCount > 0;
}

function mapPostMeta(row) {
  return {
    month: row.month,
    code: row.code,
    repEmail: row.rep_email,
    repName: row.rep_name,
    postedAt: row.posted_at?.toISOString?.() || null,
    postedByEmail: row.posted_by_email,
    postedByName: row.posted_by_name
  };
}

export async function listCommissionPostsForMonth(month) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT month, code, rep_email, rep_name, posted_at, posted_by_email, posted_by_name
     FROM commission_statement_posts WHERE month = $1 ORDER BY code`,
    [normMonth(month)]
  );
  return result.rows.map(mapPostMeta);
}

export async function listPostedMonthsForEmail(email) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT month, code, posted_at FROM commission_statement_posts
     WHERE rep_email = $1 ORDER BY month DESC`,
    [normEmail(email)]
  );
  return result.rows.map((row) => ({
    month: row.month,
    code: row.code,
    postedAt: row.posted_at?.toISOString?.() || null
  }));
}

export async function getCommissionPostForEmail(email, month) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM commission_statement_posts WHERE rep_email = $1 AND month = $2 LIMIT 1`,
    [normEmail(email), normMonth(month)]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...mapPostMeta(row), statement: row.statement || {} };
}

// ---------------------------------------------------------------------------
// Exception requests
// ---------------------------------------------------------------------------

function mapException(row) {
  return {
    id: row.id,
    month: row.month,
    code: row.code,
    repEmail: row.rep_email,
    repName: row.rep_name,
    lines: Array.isArray(row.lines) ? row.lines : [],
    note: row.note,
    status: row.status,
    createdAt: row.created_at?.toISOString?.() || null,
    resolvedAt: row.resolved_at?.toISOString?.() || null,
    resolvedByEmail: row.resolved_by_email,
    resolvedByName: row.resolved_by_name,
    response: row.response
  };
}

export async function createCommissionException({ month, code, repEmail, repName, lines, note }) {
  const pool = await getReadyPool();
  const id = `cex_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const cleanedLines = (Array.isArray(lines) ? lines : []).slice(0, 60).map((l) => ({
    lineKey: String(l.lineKey || "").slice(0, 200),
    section: String(l.section || "").slice(0, 30),
    invoice: String(l.invoice || "").slice(0, 40),
    product: String(l.product || "").slice(0, 80),
    customer: String(l.customer || "").slice(0, 120)
  }));
  await pool.query(
    `INSERT INTO commission_exceptions (id, month, code, rep_email, rep_name, lines, note)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [id, normMonth(month), normCode(code), normEmail(repEmail), String(repName || ""), JSON.stringify(cleanedLines), String(note || "").slice(0, 2000)]
  );
  return id;
}

export async function listCommissionExceptionsForMonth(month) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM commission_exceptions WHERE month = $1 ORDER BY status DESC, created_at DESC`,
    [normMonth(month)]
  );
  return result.rows.map(mapException);
}

export async function listCommissionExceptionsForRep(email, month) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM commission_exceptions WHERE rep_email = $1 AND month = $2 ORDER BY created_at DESC`,
    [normEmail(email), normMonth(month)]
  );
  return result.rows.map(mapException);
}

export async function countOpenCommissionExceptions() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT COUNT(*)::int AS n FROM commission_exceptions WHERE status = 'open'`);
  return result.rows[0]?.n || 0;
}

export async function getCommissionException(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM commission_exceptions WHERE id = $1`, [String(id || "")]);
  return result.rows[0] ? mapException(result.rows[0]) : null;
}

export async function resolveCommissionException(id, { byEmail, byName, response }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE commission_exceptions
     SET status = 'resolved', resolved_at = NOW(), resolved_by_email = $2, resolved_by_name = $3, response = $4
     WHERE id = $1 AND status = 'open'
     RETURNING *`,
    [String(id || ""), normEmail(byEmail), String(byName || ""), String(response || "").slice(0, 2000)]
  );
  return result.rows[0] ? mapException(result.rows[0]) : null;
}

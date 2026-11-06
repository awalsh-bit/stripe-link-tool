import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Website quote requests (Andrew 11/9): the public website's quote cart —
// out-of-stock models, or a shopper outside the delivery area — posts the
// list and the customer's contact details here. Each request becomes a DIBS
// lead on every consultant's dashboard (claimable, refId "webquote:<token>")
// and a row on the Quote Follow-Up board; the first claim stamps ownership.
// Everything the consultant needs to quote lives on this row.
// ---------------------------------------------------------------------------

export const WEBSITE_QUOTE_REASONS = new Set(["out_of_stock", "out_of_area", "special_order", "other"]);

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS website_quote_requests (
  token TEXT PRIMARY KEY,
  customer JSONB NOT NULL DEFAULT '{}',
  items JSONB NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT 'other',
  zip TEXT NOT NULL DEFAULT '',
  in_area BOOLEAN,
  source TEXT NOT NULL DEFAULT 'website',
  ref TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  estimate_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  claimed_by_email TEXT NOT NULL DEFAULT '',
  claimed_by_name TEXT NOT NULL DEFAULT '',
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS website_quote_requests_created_idx ON website_quote_requests (created_at);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

function rowOut(r) {
  return {
    token: r.token,
    customer: r.customer || {},
    items: Array.isArray(r.items) ? r.items : [],
    notes: r.notes || "",
    reason: r.reason || "other",
    zip: r.zip || "",
    inArea: r.in_area,
    source: r.source || "",
    ref: r.ref || "",
    estimateTotal: Number(r.estimate_total || 0),
    status: r.status || "new",
    claimedByEmail: r.claimed_by_email || "",
    claimedByName: r.claimed_by_name || "",
    claimedAt: r.claimed_at?.toISOString?.() || null,
    createdAt: r.created_at?.toISOString?.() || null
  };
}

export async function createWebsiteQuoteRequest({ customer, items, notes = "", reason = "other", zip = "", inArea = null, source = "website", ref = "", ip = "", estimateTotal = 0 }) {
  const pool = await getReadyPool();
  const token = crypto.randomBytes(12).toString("base64url");
  await pool.query(
    `INSERT INTO website_quote_requests (token, customer, items, notes, reason, zip, in_area, source, ref, ip, estimate_total)
     VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [token, JSON.stringify(customer || {}), JSON.stringify(items || []), String(notes || "").slice(0, 2000),
      WEBSITE_QUOTE_REASONS.has(reason) ? reason : "other", String(zip || "").slice(0, 10), inArea == null ? null : Boolean(inArea),
      String(source || "website").slice(0, 40), String(ref || "").slice(0, 120), String(ip || "").slice(0, 64), Math.round(Number(estimateTotal || 0) * 100) / 100]
  );
  return getWebsiteQuoteRequest(token);
}

export async function getWebsiteQuoteRequest(token) {
  const pool = await getReadyPool();
  const { rows } = await pool.query(`SELECT * FROM website_quote_requests WHERE token = $1`, [String(token || "").slice(0, 80)]);
  return rows[0] ? rowOut(rows[0]) : null;
}

export async function listWebsiteQuoteRequests({ limit = 200 } = {}) {
  const pool = await getReadyPool();
  const { rows } = await pool.query(`SELECT * FROM website_quote_requests ORDER BY created_at DESC LIMIT $1`, [Math.max(1, Math.min(1000, Number(limit) || 200))]);
  return rows.map(rowOut);
}

// DIBS claim / release — mirrors the notification so the request row says who has it.
export async function setWebsiteQuoteClaim(token, { email = "", name = "" } = {}) {
  const pool = await getReadyPool();
  const e = String(email || "").trim().toLowerCase();
  await pool.query(
    e
      ? `UPDATE website_quote_requests SET claimed_by_email = $2, claimed_by_name = $3, claimed_at = NOW(), status = 'claimed' WHERE token = $1`
      : `UPDATE website_quote_requests SET claimed_by_email = '', claimed_by_name = '', claimed_at = NULL, status = 'new' WHERE token = $1`,
    e ? [String(token || "").slice(0, 80), e, String(name || "").slice(0, 120)] : [String(token || "").slice(0, 80)]
  );
}

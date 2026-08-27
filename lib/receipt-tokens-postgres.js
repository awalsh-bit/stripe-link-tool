// ---------------------------------------------------------------------------
// Public receipt links. Texting a receipt can't carry a PDF over SMS, so the
// text includes a tokenized link on the public service host
// (https://service.wilsonappliance.com/receipt.pdf?r=<token>) that renders
// the same PDF the email attaches — regenerated live from Stripe on each
// open, never stored. One token per payment, reused across re-sends;
// unguessable (24 random bytes) and expiring after RECEIPT_LINK_DAYS
// (default 365).
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS receipt_share_tokens (
  token TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL);
  await ensurePromise;
  return pool;
}

export async function getOrCreateReceiptToken(paymentIntentId) {
  const pool = await getReadyPool();
  const pi = String(paymentIntentId || "").slice(0, 100);
  const token = crypto.randomBytes(24).toString("hex");
  const result = await pool.query(
    `INSERT INTO receipt_share_tokens (token, payment_intent_id)
     VALUES ($1, $2)
     ON CONFLICT (payment_intent_id) DO UPDATE SET last_sent_at = NOW()
     RETURNING token`,
    [token, pi]
  );
  return result.rows[0].token;
}

export async function getReceiptTokenRecord(token) {
  const cleaned = String(token || "").slice(0, 80);
  if (!/^[a-f0-9]{48}$/.test(cleaned)) return null;
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM receipt_share_tokens WHERE token = $1`, [cleaned]);
  const row = result.rows[0];
  if (!row) return null;
  const maxDays = Number(process.env.RECEIPT_LINK_DAYS || 365);
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (Number.isFinite(maxDays) && maxDays > 0 && ageMs > maxDays * 86400000) return null;
  return { token: row.token, paymentIntentId: row.payment_intent_id };
}

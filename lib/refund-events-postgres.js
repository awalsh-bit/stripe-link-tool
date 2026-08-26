// ---------------------------------------------------------------------------
// Refunds issued in Agility (Issue Refund page). Each successful Stripe
// refund is recorded here with the context known at issue time — customer,
// card, sales order, who refunded — so Paid History can show the refund and
// build a PDF/email refund receipt without re-deriving everything from
// Stripe list calls.
// ---------------------------------------------------------------------------

import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS refund_events (
  refund_id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  card_brand TEXT NOT NULL DEFAULT '',
  last4 TEXT NOT NULL DEFAULT '',
  sales_order TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  reason_code TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  creator_code TEXT NOT NULL DEFAULT '',
  creator_name TEXT NOT NULL DEFAULT '',
  refunded_by_email TEXT NOT NULL DEFAULT '',
  refunded_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS refund_events_pi_idx ON refund_events (payment_intent_id);
CREATE INDEX IF NOT EXISTS refund_events_created_idx ON refund_events (created_at DESC);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL);
  await ensurePromise;
  return pool;
}

function mapRow(row) {
  return {
    refundId: row.refund_id,
    paymentIntentId: row.payment_intent_id,
    amount: Number(row.amount) || 0,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    cardBrand: row.card_brand,
    last4: row.last4,
    salesOrder: row.sales_order,
    description: row.description,
    reasonCode: row.reason_code,
    note: row.note,
    creatorCode: row.creator_code,
    creatorName: row.creator_name,
    refundedByEmail: row.refunded_by_email,
    refundedByName: row.refunded_by_name,
    createdAt: row.created_at?.toISOString?.() || null
  };
}

export async function recordRefundEvent(event) {
  const pool = await getReadyPool();
  const s = (v, n = 200) => String(v || "").trim().slice(0, n);
  await pool.query(
    `INSERT INTO refund_events (
       refund_id, payment_intent_id, amount, customer_name, customer_email,
       card_brand, last4, sales_order, description, reason_code, note,
       creator_code, creator_name, refunded_by_email, refunded_by_name
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (refund_id) DO NOTHING`,
    [
      s(event.refundId, 100),
      s(event.paymentIntentId, 100),
      Math.round((Number(event.amount) || 0) * 100) / 100,
      s(event.customerName), s(event.customerEmail),
      s(event.cardBrand, 40), s(event.last4, 8),
      s(event.salesOrder, 80), s(event.description, 300),
      s(event.reasonCode, 80), s(event.note, 500),
      s(event.creatorCode, 20), s(event.creatorName),
      s(event.refundedByEmail), s(event.refundedByName)
    ]
  );
}

export async function listRefundEvents(limit = 1000) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM refund_events ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 1000, 1), 5000)]
  );
  return result.rows.map(mapRow);
}

export async function getRefundEvent(refundId) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM refund_events WHERE refund_id = $1`, [String(refundId || "")]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

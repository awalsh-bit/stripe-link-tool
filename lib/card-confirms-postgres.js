// ---------------------------------------------------------------------------
// Card-on-file confirmation tokens. The payment_links store is a fixed-column
// table, so the client-facing confirm flow keeps its token + prior-card
// snapshot here, keyed back to the link record by id.
// ---------------------------------------------------------------------------

import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS card_confirm_tokens (
  token TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  prior JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

export async function createCardConfirm({ token, linkId, prior }) {
  const pool = await getReadyPool();
  await pool.query(
    `INSERT INTO card_confirm_tokens (token, link_id, prior) VALUES ($1, $2, $3::jsonb)`,
    [String(token), String(linkId), JSON.stringify(prior || {})]
  );
}

export async function getCardConfirm(token) {
  const cleaned = String(token || "").slice(0, 80);
  if (!cleaned) return null;
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM card_confirm_tokens WHERE token = $1`, [cleaned]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    token: row.token,
    linkId: row.link_id,
    prior: row.prior || {},
    decidedAt: row.decided_at?.toISOString?.() || null
  };
}

export async function markCardConfirmDecided(token) {
  const pool = await getReadyPool();
  await pool.query(`UPDATE card_confirm_tokens SET decided_at = NOW() WHERE token = $1`, [String(token)]);
}

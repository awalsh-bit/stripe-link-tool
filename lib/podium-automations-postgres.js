// ---------------------------------------------------------------------------
// Text automations — which Podium template (if any) each Agility trigger
// sends, managed from message-automations.html instead of one Render env var
// per template. A trigger fires only when a row exists, is enabled, and
// names a template; the legacy PODIUM_TEMPLATE_* env vars act as fallback
// when no row exists (so nothing already configured breaks).
// ---------------------------------------------------------------------------

import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS podium_automations (
  trigger_key TEXT PRIMARY KEY,
  template_title TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS podium_payment_notes (
  link_id TEXT PRIMARY KEY,
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

function mapRow(row) {
  return {
    triggerKey: row.trigger_key,
    templateTitle: row.template_title || "",
    enabled: row.enabled === true,
    updatedBy: row.updated_by || "",
    updatedAt: row.updated_at?.toISOString?.() || null
  };
}

export async function listPodiumAutomations() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM podium_automations ORDER BY trigger_key`);
  return result.rows.map(mapRow);
}

export async function upsertPodiumAutomation({ triggerKey, templateTitle = "", enabled = false, byEmail = "" }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO podium_automations (trigger_key, template_title, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (trigger_key) DO UPDATE SET
       template_title = EXCLUDED.template_title,
       enabled = EXCLUDED.enabled,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [String(triggerKey).slice(0, 60), String(templateTitle).slice(0, 200), enabled === true, String(byEmail).trim().toLowerCase()]
  );
  cache = { at: 0, rows: [] };
  return mapRow(result.rows[0]);
}

// Small cache so webhook paths don't hit the table on every event.
let cache = { at: 0, rows: [] };
export async function resolveAutomationTemplate(triggerKey, envFallbackTitle = "") {
  if (Date.now() - cache.at > 60 * 1000) {
    try {
      cache = { at: Date.now(), rows: await listPodiumAutomations() };
    } catch {
      cache = { at: Date.now(), rows: cache.rows };
    }
  }
  const row = cache.rows.find((r) => r.triggerKey === triggerKey);
  if (row) return row.enabled && row.templateTitle ? row.templateTitle : null;
  return String(envFallbackTitle || "").trim() || null;
}

// One Podium internal payment note per link record, ever — survives webhook
// re-deliveries and manual Sync clicks. Returns true only for the first
// caller; everyone else sees the existing row and skips.
export async function claimPodiumPaymentNoteOnce(linkId) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO podium_payment_notes (link_id) VALUES ($1)
     ON CONFLICT (link_id) DO NOTHING RETURNING link_id`,
    [String(linkId || "").slice(0, 100)]
  );
  return result.rows.length > 0;
}

import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Service-request photo store. Two producers share it:
//  - installers (install-damage.html field form) — kind 'tag' / 'damage'
//  - customers (applianceservice.html request form) — kind 'customer'
// The report/request itself is a Service Request Queue entry; photos are too
// big for that JSON store, so they live here and the queue card renders them
// via /api/install-damage/photo/:id. Photos arrive client-compressed
// (~<1MB JPEG each), capped server-side by multer.
//
// Customer uploads happen BEFORE the request is submitted (the public form
// uploads on selection), so each row carries a random claim token: the
// submit call proves ownership by echoing {id, token}, and claiming stamps
// report_ref with the queue card id. Unclaimed rows (abandoned forms) are
// purged after 30 days.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS install_damage_photos (
  id SERIAL PRIMARY KEY,
  report_ref TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'damage',
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_install_damage_photos_ref ON install_damage_photos (report_ref);
ALTER TABLE install_damage_photos ADD COLUMN IF NOT EXISTS claim_token TEXT NOT NULL DEFAULT '';
ALTER TABLE install_damage_photos ADD COLUMN IF NOT EXISTS meta JSONB;
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL);
  await ensurePromise;
  return pool;
}

export async function saveInstallDamagePhoto({ reportRef, kind = "damage", contentType = "image/jpeg", buffer }) {
  if (!buffer || !buffer.length) throw new Error("Empty photo.");
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO install_damage_photos (report_ref, kind, content_type, bytes)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [String(reportRef || "").slice(0, 60), String(kind).slice(0, 20), String(contentType).slice(0, 60), buffer]
  );
  return result.rows[0].id;
}

// Maintenance field tool (maintenance/tech-maintenance.html): evidence and
// serial-tag photos synced from the technician's phone. Same table, same
// serving route family — no second photo store. report_ref carries the
// maintenance visit id; meta keeps the asset/check/kind provenance the phone
// recorded so the photo can be matched back to its checkpoint later.
export async function saveMaintenancePhoto({ visitId, kind = "evidence", contentType = "image/jpeg", buffer, meta = {} }) {
  if (!buffer || !buffer.length) throw new Error("Empty photo.");
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO install_damage_photos (report_ref, kind, content_type, bytes, meta)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
    [
      ("maint:" + String(visitId || "")).slice(0, 60),
      ("maint_" + String(kind || "evidence")).slice(0, 20),
      String(contentType).slice(0, 60),
      buffer,
      JSON.stringify(meta || {})
    ]
  );
  return result.rows[0].id;
}

// Customer upload (public form, pre-submit): stores the photo unclaimed and
// hands back a claim token only the uploader's browser knows.
export async function saveCustomerRequestPhoto({ contentType = "image/jpeg", buffer }) {
  if (!buffer || !buffer.length) throw new Error("Empty photo.");
  const token = (await import("crypto")).randomBytes(18).toString("hex");
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO install_damage_photos (report_ref, kind, content_type, bytes, claim_token)
     VALUES ('', 'customer', $1, $2, $3) RETURNING id`,
    [String(contentType).slice(0, 60), buffer, token]
  );
  return { id: result.rows[0].id, token };
}

// Submit-time claim: stamp the queue card id onto every {id, token} pair
// that checks out and is still unclaimed. Returns the ids actually claimed —
// a wrong token or an already-claimed photo is silently skipped, so nobody
// can attach someone else's upload. Also purges month-old abandoned uploads.
export async function claimCustomerRequestPhotos(refs, reportRef) {
  const clean = (Array.isArray(refs) ? refs : []).slice(0, 6)
    .map((r) => ({ id: Number(r?.id), token: String(r?.token || "").slice(0, 60) }))
    .filter((r) => Number.isInteger(r.id) && r.id > 0 && r.token);
  const ref = String(reportRef || "").slice(0, 60);
  if (!clean.length || !ref) return [];
  const pool = await getReadyPool();
  const claimed = [];
  for (const r of clean) {
    const result = await pool.query(
      `UPDATE install_damage_photos SET report_ref = $2
        WHERE id = $1 AND kind = 'customer' AND claim_token = $3 AND report_ref = ''
        RETURNING id`,
      [r.id, ref, r.token]
    );
    if (result.rows[0]) claimed.push(result.rows[0].id);
  }
  pool.query(
    `DELETE FROM install_damage_photos
      WHERE kind = 'customer' AND report_ref = '' AND created_at < NOW() - INTERVAL '30 days'`
  ).catch(() => {});
  return claimed;
}

export async function getInstallDamagePhoto(id) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM install_damage_photos WHERE id = $1`, [numeric]);
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, reportRef: row.report_ref, kind: row.kind, contentType: row.content_type, bytes: row.bytes };
}

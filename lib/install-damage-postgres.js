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
-- Installer photos sent in pieces (11/25; see "Uploads in pieces" below).
-- One row per photo while it is arriving. The phone names the photo (id) and
-- the report it belongs to (report_key); bytes grows a piece at a time until
-- it is total_bytes long. Filing the report moves the photo into
-- install_damage_photos, records photo_id here and empties bytes.
CREATE TABLE IF NOT EXISTS install_damage_uploads (
  id TEXT PRIMARY KEY,
  report_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'damage',
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  total_bytes INTEGER NOT NULL,
  bytes BYTEA NOT NULL DEFAULT ''::bytea,
  owner_email TEXT NOT NULL DEFAULT '',
  photo_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_install_damage_uploads_report ON install_damage_uploads (report_key);
-- One row per report the phone has filed, by the phone's own id for it, so a
-- report sent twice (the answer to the first send was lost on the way back)
-- makes one Service Request Queue entry. card_id is empty while the first
-- send is still being written.
CREATE TABLE IF NOT EXISTS install_damage_reports (
  report_key TEXT PRIMARY KEY,
  card_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
// kind: 'customer' (a photo) or 'signature' (the HVAC form's signed agreement).
export async function saveCustomerRequestPhoto({ contentType = "image/jpeg", buffer, kind = "customer" }) {
  if (!buffer || !buffer.length) throw new Error("Empty photo.");
  const token = (await import("crypto")).randomBytes(18).toString("hex");
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO install_damage_photos (report_ref, kind, content_type, bytes, claim_token)
     VALUES ('', $4, $1, $2, $3) RETURNING id`,
    [String(contentType).slice(0, 60), buffer, token, kind === "signature" ? "signature" : kind === "video" ? "video" : "customer"]
  );
  return { id: result.rows[0].id, token };
}

// Submit-time claim: stamp the queue card id onto every {id, token} pair
// that checks out and is still unclaimed. Returns the ids actually claimed —
// a wrong token or an already-claimed photo is silently skipped, so nobody
// can attach someone else's upload. Also purges month-old abandoned uploads.
export async function claimCustomerRequestPhotos(refs, reportRef) {
  const clean = (Array.isArray(refs) ? refs : []).slice(0, 8)
    .map((r) => ({ id: Number(r?.id), token: String(r?.token || "").slice(0, 60) }))
    .filter((r) => Number.isInteger(r.id) && r.id > 0 && r.token);
  const ref = String(reportRef || "").slice(0, 60);
  if (!clean.length || !ref) return [];
  const pool = await getReadyPool();
  const claimed = [];
  for (const r of clean) {
    const result = await pool.query(
      `UPDATE install_damage_photos SET report_ref = $2
        WHERE id = $1 AND kind IN ('customer', 'signature', 'video') AND claim_token = $3 AND report_ref = ''
        RETURNING id, kind`,
      [r.id, ref, r.token]
    );
    if (result.rows[0]) claimed.push({ id: result.rows[0].id, kind: result.rows[0].kind });
  }
  pool.query(
    `DELETE FROM install_damage_photos
      WHERE kind IN ('customer', 'signature', 'video') AND report_ref = '' AND created_at < NOW() - INTERVAL '30 days'`
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

// ---------------------------------------------------------------------------
// Uploads in pieces (Andrew 11/25: installers on Android "need near full
// service to get it to go through").
//
// The form used to send the whole report - four photos, a megabyte or two -
// in one request. On a weak signal that request stalls or drops and has to
// start over from nothing, every time. Now each photo travels on its own in
// small pieces. A piece that fails is the only thing sent again, the phone
// can stop and pick up later where it left off, and the report itself goes
// last as a few hundred bytes that name the photos already here.
//
//   appendInstallDamageUpload   add the next piece of one photo
//   installDamageUploadStatus   how much of each photo has arrived
//   claimInstallDamageReport    first send of a report wins; a repeat is told so
//   fileInstallDamageUploads    move a report's finished photos into the photo store
// ---------------------------------------------------------------------------
export const INSTALL_DAMAGE_UPLOAD_MAX_BYTES = 12 * 1024 * 1024; // one photo, same cap as the old one-request upload
export const INSTALL_DAMAGE_UPLOAD_MAX_PIECE = 1024 * 1024;
export const INSTALL_DAMAGE_UPLOAD_MAX_PHOTOS = 4; // a filed report: the tag and up to three of the damage
// Photos one report may start uploading. More than it can file, because a
// retaken or removed photo has usually begun its trip already; the ones the
// report doesn't name in the end are purged with the abandoned forms.
const UPLOADS_PER_REPORT = 24;
const UPLOAD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{11,63}$/;
export const installDamageUploadIdOk = (v) => UPLOAD_ID.test(String(v || ""));

let lastUploadPurge = 0;
function purgeOldUploads(pool) {
  if (Date.now() - lastUploadPurge < 60 * 60 * 1000) return;
  lastUploadPurge = Date.now();
  // never filed (a form that was abandoned): two weeks. Filed: the emptied row and the report's key are kept two months.
  pool.query(`DELETE FROM install_damage_uploads WHERE (photo_id IS NULL AND updated_at < NOW() - INTERVAL '14 days') OR (photo_id IS NOT NULL AND updated_at < NOW() - INTERVAL '60 days')`).catch(() => {});
  pool.query(`DELETE FROM install_damage_reports WHERE created_at < NOW() - INTERVAL '60 days'`).catch(() => {});
}

// Add one piece. The piece is taken only if it starts exactly where the
// photo so far ends (offset), so a piece sent twice, or out of order, never
// corrupts the photo: the answer says how much has really arrived and the
// phone carries on from there.
// -> { ok, received, total, done, filed }
export async function appendInstallDamageUpload({ id, reportKey, kind = "damage", contentType = "image/jpeg", total, offset, chunk, ownerEmail = "" }) {
  if (!installDamageUploadIdOk(id) || !installDamageUploadIdOk(reportKey)) throw new Error("Bad upload id.");
  const totalBytes = Math.round(Number(total));
  if (!Number.isInteger(totalBytes) || totalBytes <= 0 || totalBytes > INSTALL_DAMAGE_UPLOAD_MAX_BYTES) throw new Error("That photo is too large.");
  const at = Math.round(Number(offset));
  if (!Number.isInteger(at) || at < 0) throw new Error("Bad offset.");
  const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.alloc(0);
  if (piece.length > INSTALL_DAMAGE_UPLOAD_MAX_PIECE) throw new Error("That piece is too large.");
  const pool = await getReadyPool();
  purgeOldUploads(pool);
  const cleanKind = kind === "tag" ? "tag" : "damage";
  const made = await pool.query(
    `INSERT INTO install_damage_uploads (id, report_key, kind, content_type, total_bytes, owner_email)
     SELECT $1, $2, $3, $4, $5, $6
      WHERE (SELECT COUNT(*) FROM install_damage_uploads WHERE report_key = $2) < $7
     ON CONFLICT (id) DO NOTHING`,
    [id, reportKey, cleanKind, String(contentType || "image/jpeg").slice(0, 60), totalBytes, String(ownerEmail || "").toLowerCase().slice(0, 200), UPLOADS_PER_REPORT]
  );
  if (piece.length) {
    const added = await pool.query(
      `UPDATE install_damage_uploads SET bytes = bytes || $2, updated_at = NOW()
        WHERE id = $1 AND report_key = $3 AND total_bytes = $4 AND photo_id IS NULL
          AND octet_length(bytes) = $5 AND octet_length(bytes) + $6 <= total_bytes
        RETURNING octet_length(bytes) AS received, total_bytes`,
      [id, piece, reportKey, totalBytes, at, piece.length]
    );
    if (added.rows[0]) {
      const received = Number(added.rows[0].received);
      return { ok: true, received, total: totalBytes, done: received === totalBytes, filed: false };
    }
  }
  const now = await pool.query(`SELECT report_key, total_bytes, octet_length(bytes) AS received, photo_id FROM install_damage_uploads WHERE id = $1`, [id]);
  const row = now.rows[0];
  if (!row) {
    if (!made.rowCount) throw new Error("Too many photos were started for this report. Start a new report.");
    throw new Error("Upload not found.");
  }
  if (row.report_key !== reportKey || Number(row.total_bytes) !== totalBytes) throw new Error("That upload id is already in use.");
  const filed = row.photo_id != null;
  const received = filed ? totalBytes : Number(row.received);
  // an empty piece is a question ("how far along is this one?"); a piece that didn't fit is answered the same way
  return { ok: !piece.length || filed, received, total: totalBytes, done: received === totalBytes, filed };
}

// How much of each photo has arrived, for a phone picking up where it left off.
export async function installDamageUploadStatus(ids) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(installDamageUploadIdOk))].slice(0, 12);
  if (!clean.length) return {};
  const pool = await getReadyPool();
  const { rows } = await pool.query(`SELECT id, report_key, total_bytes, octet_length(bytes) AS received, photo_id FROM install_damage_uploads WHERE id = ANY($1)`, [clean]);
  const out = {};
  for (const r of rows) {
    const filed = r.photo_id != null, total = Number(r.total_bytes), received = filed ? total : Number(r.received);
    out[r.id] = { reportKey: r.report_key, received, total, done: received === total, filed };
  }
  return out;
}

// The first send of a report takes its key. -> { fresh: true } to go ahead,
// { fresh: false, cardId } when it was already filed (cardId is the queue
// entry), or { fresh: false, cardId: "" } when another send of the same
// report is being written right now. A send that died half way (the key is
// taken, no entry after two minutes) is taken over instead of blocking the
// report for good.
export async function claimInstallDamageReport(reportKey) {
  if (!installDamageUploadIdOk(reportKey)) throw new Error("Bad report id.");
  const pool = await getReadyPool();
  const got = await pool.query(
    `INSERT INTO install_damage_reports (report_key) VALUES ($1)
     ON CONFLICT (report_key) DO UPDATE SET created_at = NOW()
       WHERE install_damage_reports.card_id = '' AND install_damage_reports.created_at < NOW() - INTERVAL '2 minutes'
     RETURNING report_key`,
    [reportKey]
  );
  if (got.rows[0]) return { fresh: true };
  const now = await pool.query(`SELECT card_id FROM install_damage_reports WHERE report_key = $1`, [reportKey]);
  return { fresh: false, cardId: now.rows[0]?.card_id || "" };
}
export async function finishInstallDamageReport(reportKey, cardId) {
  const pool = await getReadyPool();
  await pool.query(`UPDATE install_damage_reports SET card_id = $2 WHERE report_key = $1`, [reportKey, String(cardId || "").slice(0, 80)]);
}
// The send failed before the queue entry was written: give the key back so the phone's next try can file it.
export async function releaseInstallDamageReport(reportKey) {
  const pool = await getReadyPool();
  await pool.query(`DELETE FROM install_damage_reports WHERE report_key = $1 AND card_id = ''`, [reportKey]);
}

// Which of a report's photos are not all here yet (ids), given the ones the report names.
export async function incompleteInstallDamageUploads(reportKey, ids) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(installDamageUploadIdOk))].slice(0, INSTALL_DAMAGE_UPLOAD_MAX_PHOTOS);
  if (!want.length) return [];
  const pool = await getReadyPool();
  const { rows } = await pool.query(
    `SELECT id FROM install_damage_uploads WHERE id = ANY($1) AND report_key = $2 AND (photo_id IS NOT NULL OR octet_length(bytes) = total_bytes)`,
    [want, reportKey]
  );
  const here = new Set(rows.map((r) => r.id));
  return want.filter((id) => !here.has(id));
}

// Move a report's finished photos into the photo store, in the order the
// report names them. One transaction: all of them or none. A photo already
// moved (a repeat send) is returned as it is. -> [{ id, kind }]
export async function fileInstallDamageUploads(reportKey, ids, reportRef) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(installDamageUploadIdOk))].slice(0, INSTALL_DAMAGE_UPLOAD_MAX_PHOTOS);
  if (!want.length) return [];
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = [];
    for (const id of want) {
      const { rows } = await client.query(`SELECT id, kind, content_type, photo_id, octet_length(bytes) AS received, total_bytes FROM install_damage_uploads WHERE id = $1 AND report_key = $2 FOR UPDATE`, [id, reportKey]);
      const u = rows[0];
      if (!u) throw new Error("A photo for this report is missing.");
      if (u.photo_id != null) { out.push({ id: u.photo_id, kind: u.kind }); continue; }
      if (Number(u.received) !== Number(u.total_bytes)) throw new Error("A photo for this report hasn't finished uploading.");
      const ins = await client.query(
        `INSERT INTO install_damage_photos (report_ref, kind, content_type, bytes)
         SELECT $2, kind, content_type, bytes FROM install_damage_uploads WHERE id = $1 RETURNING id`,
        [id, String(reportRef || "").slice(0, 60)]
      );
      await client.query(`UPDATE install_damage_uploads SET photo_id = $2, bytes = ''::bytea, updated_at = NOW() WHERE id = $1`, [id, ins.rows[0].id]);
      out.push({ id: ins.rows[0].id, kind: u.kind });
    }
    await client.query("COMMIT");
    return out;
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}

/*
 * Site walk — data access (Postgres).
 *
 * Follows the Agility module pattern (platform notes §5): SCHEMA_SQL applied
 * idempotently on first use, getReadyPool(), parameterised queries only,
 * transactions with BEGIN / COMMIT / ROLLBACK, rules imported from a module
 * that has no pool in it (site-walk-rules.js).
 *
 * STEP ONE (this file): a walk is one row — summary columns the queue reads,
 * plus the walk itself as JSONB. That is everything the three pages need to go
 * live: build a walk in the office, open it on a phone, watch it fill in, sign
 * it off, send it.
 *
 * STEP TWO (not here): the reporting projection (openings, dimensions,
 * utilities, findings … 25 tables in sql/sitewalk_schema.sql of the standalone
 * tool), dashboard notifications, and the ePASS ticket comparison. `payload`
 * below already stores every derived value those tables are filled from, so
 * step two is a projection over stored rows, not a re-sync from phones.
 *
 * The Python files in the standalone package (serve_site_walks.py,
 * sitewalk_sync.py) are the reference this was written from. They do not need
 * porting; this file is the port.
 */
import { getPostgresPool } from "./data-postgres.js";
import {
  readSyncPayload, decideWrite, canSend, canSignOff, queueRow, offerRow, walkEvents,
  PayloadError, MAX_PHOTO_BYTES, PHOTO_TYPES, SAFE_ID, readLibraryRow, libraryRow
} from "./site-walk-rules.js";

export { PayloadError };

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sw_walks (
  walk_id            TEXT PRIMARY KEY,                 -- the id the browser gave the walk (walk_…)
  job_no             TEXT NOT NULL DEFAULT '',         -- ePASS base ticket / Steel Cod package number
  project            TEXT NOT NULL DEFAULT '',
  builder            TEXT NOT NULL DEFAULT '',
  builder_contact    TEXT NOT NULL DEFAULT '',
  builder_email      TEXT NOT NULL DEFAULT '',
  address            TEXT NOT NULL DEFAULT '',
  walk_date          DATE,
  walked_by          TEXT NOT NULL DEFAULT '',
  sales_name         TEXT NOT NULL DEFAULT '',
  sales_email        TEXT NOT NULL DEFAULT '',
  stage              TEXT NOT NULL DEFAULT 'setup',    -- setup | ready-to-walk | in-field | ready-to-send | sent
  opening_count      INT  NOT NULL DEFAULT 0,
  walked_count       INT  NOT NULL DEFAULT 0,
  ready_count        INT  NOT NULL DEFAULT 0,
  verify_count       INT  NOT NULL DEFAULT 0,
  modify_count       INT  NOT NULL DEFAULT 0,
  decision_count     INT  NOT NULL DEFAULT 0,
  open_count         INT  NOT NULL DEFAULT 0,
  blocker_count      INT  NOT NULL DEFAULT 0,
  is_deliverable     BOOLEAN NOT NULL DEFAULT FALSE,
  access_route       TEXT NOT NULL DEFAULT '',
  access_state       TEXT NOT NULL DEFAULT '',
  document           JSONB,                            -- the walk as the browser holds it; handed to any device that opens it
  payload            JSONB NOT NULL DEFAULT '{}'::jsonb, -- the derived answers as sent (rollup + openings); source for step two
  payload_schema     TEXT NOT NULL DEFAULT '',
  client_updated_at  TEXT NOT NULL DEFAULT '',         -- the walk's own revision stamp (ISO); newest wins
  signed_off_at      TIMESTAMPTZ,                      -- the walker's sign-off: the one gate before sending
  signed_off_by      TEXT,                             -- email
  signed_off_by_name TEXT,
  sign_off_note      TEXT NOT NULL DEFAULT '',
  packet_sent_at     TIMESTAMPTZ,
  packet_sent_to     TEXT NOT NULL DEFAULT '',
  packet_sent_by     TEXT,
  archived_at        TIMESTAMPTZ,                      -- out of the queue and the phones' list; kept, restorable
  archived_by        TEXT,
  first_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_by     TEXT NOT NULL DEFAULT '',
  last_sync_device   TEXT NOT NULL DEFAULT ''
);
-- later additions go here as ALTER TABLE … ADD COLUMN IF NOT EXISTS (platform notes §4)
ALTER TABLE sw_walks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE sw_walks ADD COLUMN IF NOT EXISTS archived_by TEXT;
CREATE INDEX IF NOT EXISTS sw_walks_job     ON sw_walks (job_no);
CREATE INDEX IF NOT EXISTS sw_walks_stage   ON sw_walks (stage, last_synced_at DESC);
CREATE INDEX IF NOT EXISTS sw_walks_synced  ON sw_walks (last_synced_at DESC);

CREATE TABLE IF NOT EXISTS sw_walk_events (
  id          BIGSERIAL PRIMARY KEY,
  walk_id     TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_email TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL,                           -- created | synced | stale_ignored | signed_off | reopened | sent | archived | restored
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sw_walk_events_walk ON sw_walk_events (walk_id, at);

-- Photographs and the legible spec pages. Its own table rather than
-- install_damage_photos: see QUESTIONS_FOR_ANDREW.md, question 1. Only
-- savePhoto / listPhotoIds / readPhoto below touch it.
CREATE TABLE IF NOT EXISTS sw_photos (
  walk_id      TEXT NOT NULL,
  photo_id     TEXT NOT NULL,                          -- the id the browser gave the photo
  content_type TEXT NOT NULL,
  bytes        BYTEA NOT NULL,
  byte_count   INT NOT NULL DEFAULT 0,
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,     -- kind, capturedAt, opening id, who took it
  stored_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stored_by    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (walk_id, photo_id)
);

-- The shared spec library: what people changed or added. The built-in
-- entries ship in site-walk-core.js; a row here replaces the built-in of the
-- same model ("model") or holds opening numbers confirmed against a
-- manufacturer sheet ("dims"). A removal keeps the row with deleted_at set,
-- so it is removed on every device. Only listLibrary / saveLibraryRow touch it.
CREATE TABLE IF NOT EXISTS sw_spec_library (
  kind            TEXT NOT NULL,                       -- model | dims
  lib_key         TEXT NOT NULL,                       -- model: letters and digits of the model number; dims: that|install type
  doc             JSONB,
  deleted_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT NOT NULL DEFAULT '',
  updated_by_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (kind, lib_key)
);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((e) => { ensurePromise = null; throw e; });
  await ensurePromise;
  return pool;
}

/* walk_date as text: a DATE read through node-postgres becomes a JS Date at
   local midnight, which can print as the day before. */
const SUMMARY_COLUMNS = `walk_id, job_no, project, builder, builder_contact, builder_email, address,
  to_char(walk_date, 'YYYY-MM-DD') AS walk_date,
  walked_by, sales_name, sales_email, stage, opening_count, walked_count, ready_count, verify_count, modify_count,
  decision_count, open_count, blocker_count, is_deliverable, access_route, access_state, client_updated_at,
  signed_off_at, signed_off_by, signed_off_by_name, sign_off_note, packet_sent_at, packet_sent_to, packet_sent_by,
  archived_at, archived_by, first_synced_at, last_synced_at, last_synced_by`;

async function addEvent(client, walkId, kind, actorEmail, detail) {
  await client.query(
    "INSERT INTO sw_walk_events (walk_id, kind, actor_email, detail) VALUES ($1, $2, $3, $4::jsonb)",
    [walkId, kind, actorEmail || "", JSON.stringify(detail || {})]
  );
}

/* Sign-off and sending are decided on the server, under a login. Whatever the
   document a device sent says about them, the stored document repeats the
   server's facts, so every device that opens the walk sees the same answer. */
function withServerFacts(document, row) {
  if (!document) return document;
  const doc = { ...document };
  doc.reviewedAt = row.signed_off_at ? new Date(row.signed_off_at).toISOString() : "";
  doc.reviewedBy = row.signed_off_at ? (row.signed_off_by_name || row.signed_off_by || "") : "";
  doc.sentAt = row.packet_sent_at ? new Date(row.packet_sent_at).toISOString() : "";
  doc.sentTo = row.packet_sent_at ? (row.packet_sent_to || "") : "";
  return doc;
}

/**
 * Store one walk arriving from a browser (office or phone).
 * Idempotent on walk_id; newest wins by the walk's own revision stamp.
 *
 * @param {object} payload            SW.syncPayload(walk), "wilson.sitewalk/2"
 * @param {{byEmail?: string, byName?: string}} who
 * @returns {Promise<{outcome: "CREATED"|"UPDATED"|"IGNORED_STALE", walkId: string, openings: number, receivedAt: string, message?: string}>}
 * @throws {PayloadError} when the payload can never be accepted (route answers 400)
 */
export async function receiveWalk(payload, who = {}) {
  const row = readSyncPayload(payload);
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT walk_id, client_updated_at, signed_off_at, signed_off_by, signed_off_by_name,
              packet_sent_at, packet_sent_to FROM sw_walks WHERE walk_id = $1 FOR UPDATE`,
      [row.walk_id]
    );
    const stored = found.rows[0] || null;
    const outcome = decideWrite(stored, row);
    const receivedAt = new Date().toISOString();

    if (outcome === "IGNORED_STALE") {
      await addEvent(client, row.walk_id, "stale_ignored", who.byEmail, { incoming: row.client_updated_at, stored: stored.client_updated_at });
      await client.query("COMMIT");
      return { outcome, walkId: row.walk_id, openings: 0, receivedAt,
               message: `A newer sync of this walk is already stored (${stored.client_updated_at}).` };
    }

    /* "sent" is the server's to say. A document that claims it without the
       server having recorded a send is treated as finished-not-sent. */
    const serverSent = !!(stored && stored.packet_sent_at);
    const stage = row.stage === "sent" && !serverSent ? "ready-to-send" : (serverSent ? "sent" : row.stage);
    const document = withServerFacts(row.document, stored || {});

    const values = [
      row.walk_id, row.job_no, row.project, row.builder, row.builder_contact, row.builder_email, row.address,
      row.walk_date, row.walked_by, row.sales_name, row.sales_email, stage,
      row.opening_count, row.walked_count, row.ready_count, row.verify_count, row.modify_count,
      row.decision_count, row.open_count, row.blocker_count, row.is_deliverable,
      row.access_route, row.access_state,
      document ? JSON.stringify(document) : null, JSON.stringify(row.payload), row.schema,
      row.client_updated_at, who.byEmail || "", row.device
    ];
    await client.query(
      `INSERT INTO sw_walks (
         walk_id, job_no, project, builder, builder_contact, builder_email, address,
         walk_date, walked_by, sales_name, sales_email, stage,
         opening_count, walked_count, ready_count, verify_count, modify_count,
         decision_count, open_count, blocker_count, is_deliverable,
         access_route, access_state, document, payload, payload_schema,
         client_updated_at, last_synced_by, last_sync_device)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
               $24::jsonb,$25::jsonb,$26,$27,$28,$29)
       ON CONFLICT (walk_id) DO UPDATE SET
         job_no = EXCLUDED.job_no, project = EXCLUDED.project, builder = EXCLUDED.builder,
         builder_contact = EXCLUDED.builder_contact, builder_email = EXCLUDED.builder_email,
         address = EXCLUDED.address, walk_date = EXCLUDED.walk_date, walked_by = EXCLUDED.walked_by,
         sales_name = EXCLUDED.sales_name, sales_email = EXCLUDED.sales_email, stage = EXCLUDED.stage,
         opening_count = EXCLUDED.opening_count, walked_count = EXCLUDED.walked_count,
         ready_count = EXCLUDED.ready_count, verify_count = EXCLUDED.verify_count,
         modify_count = EXCLUDED.modify_count, decision_count = EXCLUDED.decision_count,
         open_count = EXCLUDED.open_count, blocker_count = EXCLUDED.blocker_count,
         is_deliverable = EXCLUDED.is_deliverable, access_route = EXCLUDED.access_route,
         access_state = EXCLUDED.access_state,
         document = COALESCE(EXCLUDED.document, sw_walks.document),
         payload = EXCLUDED.payload, payload_schema = EXCLUDED.payload_schema,
         client_updated_at = EXCLUDED.client_updated_at,
         last_synced_at = NOW(), last_synced_by = EXCLUDED.last_synced_by,
         last_sync_device = EXCLUDED.last_sync_device`,
      values
    );
    await addEvent(client, row.walk_id, outcome === "CREATED" ? "created" : "synced", who.byEmail,
      { stage, walked: row.walked_count, openings: row.opening_count, rev: row.client_updated_at });
    await client.query("COMMIT");
    return { outcome, walkId: row.walk_id, openings: row.payload.openings.length, receivedAt };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * The office queue: one summary row per walk, newest sync first. No documents.
 * Archived walks are left out unless `archived` is true, which lists only those.
 */
export async function listWalks({ limit = 200, archived = false } = {}) {
  const pool = await getReadyPool();
  const { rows } = await pool.query(
    `SELECT ${SUMMARY_COLUMNS} FROM sw_walks
      WHERE archived_at IS ${archived ? "NOT NULL" : "NULL"}
      ORDER BY last_synced_at DESC LIMIT $1::int`, [limit]
  );
  return rows.map(queueRow);
}

/**
 * What a device may open.
 * Without `walkId`: summaries of the walks not yet sent and not archived — no
 * documents, so a phone's pick-up list stays small however many walks are open.
 * With `walkId`: that one walk whatever its state, with its whole document
 * (the "open this walk" link, and the tap on a row of the list).
 */
export async function pullWalks({ walkId = "", limit = 40 } = {}) {
  const pool = await getReadyPool();
  const { rows } = walkId
    ? await pool.query(
        `SELECT ${SUMMARY_COLUMNS}, document FROM sw_walks
          WHERE document IS NOT NULL AND walk_id = $1`, [walkId])
    : await pool.query(
        `SELECT ${SUMMARY_COLUMNS} FROM sw_walks
          WHERE document IS NOT NULL AND packet_sent_at IS NULL AND archived_at IS NULL
          ORDER BY last_synced_at DESC LIMIT $1::int`, [Number(limit) || 40]);
  const tally = await pool.query(
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(CASE WHEN document IS NULL THEN 1 ELSE 0 END), 0)::int AS nodoc,
            COALESCE(SUM(CASE WHEN packet_sent_at IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS sent,
            MAX(last_synced_at) AS last
       FROM sw_walks`
  );
  const t = tally.rows[0];
  return {
    walks: rows.map(offerRow),
    held: { total: t.n, noDocument: t.nodoc, packetSent: t.sent, lastSyncedAt: t.last || "" }
  };
}

/** One walk's summary, its document and its history. Null when not found. */
export async function getWalk(walkId) {
  const pool = await getReadyPool();
  const { rows } = await pool.query(`SELECT ${SUMMARY_COLUMNS}, document FROM sw_walks WHERE walk_id = $1`, [walkId]);
  if (!rows[0]) return null;
  const events = await pool.query(
    "SELECT at, actor_email, kind, detail FROM sw_walk_events WHERE walk_id = $1 ORDER BY at DESC, id DESC LIMIT 100", [walkId]
  );
  return { summary: queueRow(rows[0]), offer: offerRow(rows[0]), events: events.rows };
}

async function changeGate(walkId, apply) {
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT ${SUMMARY_COLUMNS}, document FROM sw_walks WHERE walk_id = $1 FOR UPDATE`, [walkId]);
    const row = found.rows[0] || null;
    const result = await apply(client, row);
    if (result && result.ok) {
      /* keep the stored document in step with the server's facts */
      const after = await client.query(`SELECT ${SUMMARY_COLUMNS}, document FROM sw_walks WHERE walk_id = $1`, [walkId]);
      const fresh = after.rows[0];
      if (fresh.document) {
        await client.query("UPDATE sw_walks SET document = $2::jsonb WHERE walk_id = $1",
          [walkId, JSON.stringify(withServerFacts(fresh.document, fresh))]);
      }
      result.walk = queueRow(fresh);
    }
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * The walker's sign-off. Recorded under the login, never taken from the page.
 * @returns {Promise<{ok: boolean, why?: string, signedOffAt?: string, signedOffBy?: string, walk?: object}>}
 */
export async function signOffWalk(walkId, { byEmail = "", byName = "", note = "" } = {}) {
  return changeGate(walkId, async (client, row) => {
    const gate = canSignOff(row);
    if (!gate.ok) return gate;
    const r = await client.query(
      `UPDATE sw_walks SET signed_off_at = NOW(), signed_off_by = $2, signed_off_by_name = $3, sign_off_note = $4
        WHERE walk_id = $1 RETURNING signed_off_at`,
      [walkId, byEmail, byName || byEmail, String(note || "").slice(0, 2000)]
    );
    await addEvent(client, walkId, "signed_off", byEmail, { name: byName || byEmail });
    return { ok: true, signedOffAt: new Date(r.rows[0].signed_off_at).toISOString(), signedOffBy: byName || byEmail };
  });
}

/** Take a sign-off back (more to fix). Refused once the packet has been sent. */
export async function reopenWalk(walkId, { byEmail = "", note = "" } = {}) {
  return changeGate(walkId, async (client, row) => {
    if (!row) return { ok: false, why: "That walk is not on the server." };
    if (row.packet_sent_at) return { ok: false, why: "The packet has already been sent to the builder." };
    await client.query(
      "UPDATE sw_walks SET signed_off_at = NULL, signed_off_by = NULL, signed_off_by_name = NULL, sign_off_note = '' WHERE walk_id = $1", [walkId]
    );
    await addEvent(client, walkId, "reopened", byEmail, { note: String(note || "").slice(0, 500) });
    return { ok: true };
  });
}

/**
 * Take a walk out of the queue and off the phones' list. Nothing is deleted:
 * the row, its history and its photographs stay, and restoreWalk puts it back.
 * A device that still holds the walk can go on syncing it; it stays archived.
 */
export async function archiveWalk(walkId, { byEmail = "" } = {}) {
  return changeGate(walkId, async (client, row) => {
    if (!row) return { ok: false, why: "That walk is not on the server." };
    if (row.archived_at) return { ok: true, already: true };
    await client.query("UPDATE sw_walks SET archived_at = NOW(), archived_by = $2 WHERE walk_id = $1", [walkId, byEmail]);
    await addEvent(client, walkId, "archived", byEmail, {});
    return { ok: true };
  });
}

/** Put an archived walk back in the queue. */
export async function restoreWalk(walkId, { byEmail = "" } = {}) {
  return changeGate(walkId, async (client, row) => {
    if (!row) return { ok: false, why: "That walk is not on the server." };
    if (!row.archived_at) return { ok: true, already: true };
    await client.query("UPDATE sw_walks SET archived_at = NULL, archived_by = NULL WHERE walk_id = $1", [walkId]);
    await addEvent(client, walkId, "restored", byEmail, {});
    return { ok: true };
  });
}

/** Record that the packet went to the builder. Refused until signed off. */
export async function markWalkSent(walkId, { to = "", byEmail = "" } = {}) {
  return changeGate(walkId, async (client, row) => {
    const gate = canSend(row);
    if (!gate.ok) return gate;
    const r = await client.query(
      `UPDATE sw_walks SET packet_sent_at = NOW(), packet_sent_to = $2, packet_sent_by = $3, stage = 'sent'
        WHERE walk_id = $1 RETURNING packet_sent_at`,
      [walkId, String(to || "").slice(0, 320), byEmail]
    );
    await addEvent(client, walkId, "sent", byEmail, { to: String(to || "").slice(0, 320) });
    return { ok: true, sentAt: new Date(r.rows[0].packet_sent_at).toISOString() };
  });
}

/**
 * What the walks have to say to people right now, newest first. Derived from
 * the stored rows on every call (site-walk-rules.js walkEvents); nothing is
 * written. ?email= keeps one salesperson's, ?since= only newer events.
 */
export async function listEvents({ since = "", email = "" } = {}) {
  const pool = await getReadyPool();
  const { rows } = await pool.query(
    `SELECT walk_id, job_no, project, stage, walked_by, sales_name, sales_email, opening_count, walked_count,
            modify_count, decision_count, signed_off_at, signed_off_by_name, packet_sent_at, packet_sent_to,
            last_synced_at, payload
       FROM sw_walks WHERE archived_at IS NULL ORDER BY last_synced_at DESC LIMIT 500`
  );
  let events = rows.flatMap(walkEvents);
  if (email) events = events.filter((e) => (e.salesEmail || "").toLowerCase() === String(email).toLowerCase());
  if (since) events = events.filter((e) => (e.eventAt || "") > since);
  events.sort((a, b) => (a.eventAt < b.eventAt ? 1 : a.eventAt > b.eventAt ? -1 : 0));
  return events;
}

/* ---------------------------------------------------------------- photos */

/**
 * One photograph (or one legible spec page), raw bytes.
 * Re-sending the same id replaces it, so a retry after a dropped connection
 * is harmless.
 */
export async function savePhoto({ walkId, photoId, contentType, buffer, meta = {}, byEmail = "" }) {
  if (!SAFE_ID.test(photoId || "")) return { ok: false, status: 400, error: "A photo needs a plain id." };
  if (walkId && !SAFE_ID.test(walkId)) return { ok: false, status: 400, error: "That visit id is not one of ours." };
  if (!PHOTO_TYPES[contentType]) return { ok: false, status: 415, error: "Photographs go up as JPEG, PNG or WebP." };
  if (!buffer || !buffer.length) return { ok: false, status: 400, error: "That upload was empty." };
  if (buffer.length > MAX_PHOTO_BYTES) {
    return { ok: false, status: 413, error: `That photo is over ${Math.floor(MAX_PHOTO_BYTES / (1024 * 1024))} MB.` };
  }
  const pool = await getReadyPool();
  const r = await pool.query(
    `INSERT INTO sw_photos (walk_id, photo_id, content_type, bytes, byte_count, meta, stored_by)
     VALUES ($1, $2, $3, $4, $5::int, $6::jsonb, $7)
     ON CONFLICT (walk_id, photo_id) DO UPDATE SET
       content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, byte_count = EXCLUDED.byte_count,
       meta = EXCLUDED.meta, stored_at = NOW(), stored_by = EXCLUDED.stored_by
     RETURNING stored_at`,
    [walkId || "unassigned", photoId, contentType, buffer, buffer.length, JSON.stringify(meta || {}), byEmail]
  );
  return { ok: true, id: photoId, bytes: buffer.length, storedAt: new Date(r.rows[0].stored_at).toISOString() };
}

/** Which photographs the server already holds, so the phone stops offering them. */
export async function listPhotoIds(walkId = "") {
  const pool = await getReadyPool();
  const r = walkId
    ? await pool.query("SELECT photo_id FROM sw_photos WHERE walk_id = $1 ORDER BY photo_id", [walkId])
    : await pool.query("SELECT photo_id FROM sw_photos ORDER BY photo_id");
  return r.rows.map((x) => x.photo_id);
}

/** The bytes of one photograph, or null. */
export async function readPhoto(walkId, photoId) {
  if (!SAFE_ID.test(walkId || "") || !SAFE_ID.test(photoId || "")) return null;
  const pool = await getReadyPool();
  const r = await pool.query(
    "SELECT content_type, bytes, stored_at FROM sw_photos WHERE walk_id = $1 AND photo_id = $2", [walkId, photoId]
  );
  return r.rows[0] ? { contentType: r.rows[0].content_type, buffer: r.rows[0].bytes, storedAt: r.rows[0].stored_at } : null;
}

/* ---------- the shared spec library ---------------------------------------- */

/** Every library row, removals included (the pages need to know what went). */
export async function listLibrary() {
  const pool = await getReadyPool();
  const r = await pool.query("SELECT kind, lib_key, doc, deleted_at, updated_at, updated_by, updated_by_name FROM sw_spec_library ORDER BY updated_at");
  return r.rows.map(libraryRow);
}

/** Write one row: the newest write wins. `body` is what a page posted. */
export async function saveLibraryRow(body, { byEmail = "", byName = "" } = {}) {
  const row = readLibraryRow(body);
  const pool = await getReadyPool();
  const r = await pool.query(
    `INSERT INTO sw_spec_library (kind, lib_key, doc, deleted_at, updated_by, updated_by_name)
     VALUES ($1, $2, $3::jsonb, CASE WHEN $4::boolean THEN NOW() ELSE NULL END, $5, $6)
     ON CONFLICT (kind, lib_key) DO UPDATE SET
       doc = EXCLUDED.doc, deleted_at = EXCLUDED.deleted_at, updated_at = NOW(),
       updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name
     RETURNING kind, lib_key, doc, deleted_at, updated_at, updated_by, updated_by_name`,
    [row.kind, row.key, row.deleted ? null : JSON.stringify(row.doc), row.deleted, byEmail, byName]
  );
  return { ok: true, row: libraryRow(r.rows[0]) };
}

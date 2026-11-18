// ---------------------------------------------------------------------------
// EVENT EMAIL storage (see lib/event-email.js for what the tool does).
//
//   agility_event_emails             one row per send: who, when, what, counts
//   agility_event_email_files        the PDFs that went with it (kept so a
//                                    retry sends the same files, and so the
//                                    history shows exactly what went out)
//   agility_event_email_recipients   one row per person: queued -> sent |
//                                    failed | skipped, Resend's id, the error,
//                                    and the person's own unsubscribe token
//   agility_email_optouts            addresses that asked for no more event
//                                    emails. Every send leaves them out.
// ---------------------------------------------------------------------------
import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agility_event_emails (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  include_details BOOLEAN NOT NULL DEFAULT TRUE,
  reply_to TEXT NOT NULL DEFAULT '',
  sent_by TEXT NOT NULL DEFAULT '',
  sent_by_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sending',
  stop_reason TEXT NOT NULL DEFAULT '',
  files JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_event_emails_event ON agility_event_emails (event_id, created_at DESC);
CREATE TABLE IF NOT EXISTS agility_event_email_files (
  email_id UUID NOT NULL REFERENCES agility_event_emails(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  bytes INTEGER NOT NULL DEFAULT 0,
  data BYTEA NOT NULL,
  PRIMARY KEY (email_id, seq)
);
CREATE TABLE IF NOT EXISTS agility_event_email_recipients (
  id UUID PRIMARY KEY,
  email_id UUID NOT NULL REFERENCES agility_event_emails(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  invitee_id UUID,
  source TEXT NOT NULL DEFAULT 'roster',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  resend_id TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ,
  unsub_token TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_event_email_recipients_email ON agility_event_email_recipients (email_id, seq);
CREATE TABLE IF NOT EXISTS agility_email_optouts (
  email TEXT PRIMARY KEY,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  via TEXT NOT NULL DEFAULT '',
  email_id UUID,
  event_id UUID
);
`;

let ensurePromise = null;
async function pool() {
  const p = await getPostgresPool();
  if (!p) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = p.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return p;
}

const iso = (d) => d?.toISOString?.() || null;
const mapSend = (r) => ({
  id: r.id, eventId: r.event_id, subject: r.subject, body: r.body, includeDetails: r.include_details, replyTo: r.reply_to,
  sentBy: r.sent_by, sentByName: r.sent_by_name, status: r.status, stopReason: r.stop_reason, files: r.files || [],
  createdAt: iso(r.created_at), finishedAt: iso(r.finished_at),
  counts: { total: Number(r.total || 0), sent: Number(r.sent || 0), failed: Number(r.failed || 0), skipped: Number(r.skipped || 0), queued: Number(r.queued || 0) }
});
const mapRecipient = (r) => ({
  id: r.id, email: r.email, name: r.name, inviteeId: r.invitee_id, source: r.source, status: r.status, attempts: r.attempts,
  resendId: r.resend_id, error: r.error, sentAt: iso(r.sent_at), token: r.unsub_token
});
const COUNTS = `(SELECT count(*) FROM agility_event_email_recipients x WHERE x.email_id = e.id AND x.status <> 'skipped') AS total,
  (SELECT count(*) FROM agility_event_email_recipients x WHERE x.email_id = e.id AND x.status = 'sent') AS sent,
  (SELECT count(*) FROM agility_event_email_recipients x WHERE x.email_id = e.id AND x.status = 'failed') AS failed,
  (SELECT count(*) FROM agility_event_email_recipients x WHERE x.email_id = e.id AND x.status = 'skipped') AS skipped,
  (SELECT count(*) FROM agility_event_email_recipients x WHERE x.email_id = e.id AND x.status = 'queued') AS queued`;

export const newUnsubToken = () => crypto.randomBytes(18).toString("base64url");

// A new send with its people and files, ready to go (status 'sending').
export async function createEventEmail({ eventId, subject, body, includeDetails, replyTo, by, byName, recipients, skipped = [], files = [] }) {
  const p = await pool();
  const id = crypto.randomUUID();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agility_event_emails (id, event_id, subject, body, include_details, reply_to, sent_by, sent_by_name, files) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [id, eventId, subject, body, includeDetails !== false, String(replyTo || "").slice(0, 200), String(by || "").slice(0, 120), String(byName || "").slice(0, 120), JSON.stringify(files.map((f) => ({ name: f.name, bytes: f.bytes })))]);
    let seq = 0;
    for (const f of files) await client.query(`INSERT INTO agility_event_email_files (email_id, seq, name, bytes, data) VALUES ($1,$2,$3,$4,$5)`, [id, seq++, f.name, f.bytes, f.data]);
    seq = 0;
    for (const r of recipients) {
      await client.query(`INSERT INTO agility_event_email_recipients (id, email_id, seq, email, name, invitee_id, source, status, unsub_token) VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8)`,
        [crypto.randomUUID(), id, seq++, r.email, r.name || "", r.inviteeId || null, r.source || "roster", newUnsubToken()]);
    }
    for (const r of skipped) {
      await client.query(`INSERT INTO agility_event_email_recipients (id, email_id, seq, email, name, invitee_id, source, status, error, unsub_token) VALUES ($1,$2,$3,$4,$5,$6,$7,'skipped','Unsubscribed from event emails',$8)`,
        [crypto.randomUUID(), id, seq++, r.email, r.name || "", r.inviteeId || null, r.source || "roster", newUnsubToken()]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getEventEmail(id);
}

export async function getEventEmail(id) {
  const p = await pool();
  const r = (await p.query(`SELECT e.*, ${COUNTS} FROM agility_event_emails e WHERE e.id = $1`, [id])).rows[0];
  return r ? mapSend(r) : null;
}
export async function listEventEmails(eventId) {
  const p = await pool();
  return (await p.query(`SELECT e.*, ${COUNTS} FROM agility_event_emails e WHERE e.event_id = $1 ORDER BY e.created_at DESC LIMIT 100`, [eventId])).rows.map(mapSend);
}
export async function listEventEmailRecipients(emailId, { status = null } = {}) {
  const p = await pool();
  const rows = status
    ? (await p.query(`SELECT * FROM agility_event_email_recipients WHERE email_id = $1 AND status = ANY($2) ORDER BY seq`, [emailId, [].concat(status)])).rows
    : (await p.query(`SELECT * FROM agility_event_email_recipients WHERE email_id = $1 ORDER BY seq`, [emailId])).rows;
  return rows.map(mapRecipient);
}
export async function getEventEmailFiles(emailId) {
  const p = await pool();
  return (await p.query(`SELECT seq, name, bytes, data FROM agility_event_email_files WHERE email_id = $1 ORDER BY seq`, [emailId])).rows.map((r) => ({ name: r.name, bytes: r.bytes, data: r.data }));
}
export async function getEventEmailFile(emailId, seq) {
  const p = await pool();
  const r = (await p.query(`SELECT name, bytes, data FROM agility_event_email_files WHERE email_id = $1 AND seq = $2`, [emailId, seq])).rows[0];
  return r ? { name: r.name, bytes: r.bytes, data: r.data } : null;
}

export async function markRecipientSent(id, resendId) {
  const p = await pool();
  await p.query(`UPDATE agility_event_email_recipients SET status = 'sent', resend_id = $2, error = '', sent_at = NOW() WHERE id = $1`, [id, String(resendId || "").slice(0, 80)]);
}
export async function markRecipientFailed(id, error) {
  const p = await pool();
  await p.query(`UPDATE agility_event_email_recipients SET status = 'failed', error = $2, attempts = attempts + 1 WHERE id = $1`, [id, String(error || "").slice(0, 400)]);
}
// Failed (and never-tried) people go back in the queue for "Send to the rest".
export async function requeueEventEmail(emailId) {
  const p = await pool();
  const r = await p.query(`UPDATE agility_event_email_recipients SET status = 'queued' WHERE email_id = $1 AND status IN ('failed', 'queued') RETURNING id`, [emailId]);
  await p.query(`UPDATE agility_event_emails SET status = 'sending', stop_reason = '', finished_at = NULL WHERE id = $1`, [emailId]);
  return r.rowCount;
}
export async function finishEventEmail(emailId, { stopReason = "" } = {}) {
  const p = await pool();
  const c = (await p.query(`SELECT count(*) FILTER (WHERE status = 'sent') AS sent, count(*) FILTER (WHERE status IN ('failed', 'queued')) AS left FROM agility_event_email_recipients WHERE email_id = $1`, [emailId])).rows[0];
  const status = Number(c.left) === 0 ? "done" : Number(c.sent) === 0 ? "failed" : "partial";
  await p.query(`UPDATE agility_event_emails SET status = $2, stop_reason = $3, finished_at = NOW() WHERE id = $1`, [emailId, status, String(stopReason || "").slice(0, 400)]);
  return status;
}
// After a restart nothing is mid-send any more: say so, and wait for a person.
// `except`: sends this process has started itself (they are really running).
export async function markInterruptedEventEmails({ except = [] } = {}) {
  const p = await pool();
  const r = await p.query(`UPDATE agility_event_emails SET status = 'interrupted', finished_at = NOW() WHERE status = 'sending' AND NOT (id = ANY($1::uuid[])) RETURNING id`, [[...except]]);
  return r.rowCount;
}

// Opt-outs.
export async function listOptedOut(emails) {
  const list = [...new Set((emails || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return new Set();
  const p = await pool();
  return new Set((await p.query(`SELECT email FROM agility_email_optouts WHERE email = ANY($1)`, [list])).rows.map((r) => r.email));
}
export async function recipientByToken(token) {
  const t = String(token || "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return null;
  const p = await pool();
  const r = (await p.query(`SELECT r.email, r.email_id, e.event_id, (SELECT 1 FROM agility_email_optouts o WHERE o.email = r.email) AS out FROM agility_event_email_recipients r JOIN agility_event_emails e ON e.id = r.email_id WHERE r.unsub_token = $1`, [t])).rows[0];
  return r ? { email: r.email, emailId: r.email_id, eventId: r.event_id, optedOut: Boolean(r.out) } : null;
}
export async function optOut({ email, via = "link", emailId = null, eventId = null }) {
  const p = await pool();
  const r = await p.query(`INSERT INTO agility_email_optouts (email, via, email_id, event_id) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING`, [String(email).toLowerCase(), via, emailId, eventId]);
  return r.rowCount > 0;
}

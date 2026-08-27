// ---------------------------------------------------------------------------
// Podium API v4 client with OAuth — the direct integration that replaces the
// Zapier bridge. One connection for the org: an exec clicks "Connect Podium"
// once (GET /api/podium/oauth/start), tokens live in Postgres, and access
// tokens auto-refresh (they expire every 10 hours; each refresh rotates the
// pair).
//
// Env:
//   PODIUM_CLIENT_ID / PODIUM_CLIENT_SECRET  from the developer portal app
//   PODIUM_API_BASE / PODIUM_OAUTH_BASE      test overrides (default
//                                            https://api.podium.com)
//
// Scopes expected on the app: read_messages, write_messages, read_users,
// read_locations, write_reviews.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

const API_BASE = () => (process.env.PODIUM_API_BASE || "https://api.podium.com").replace(/\/$/, "");
const OAUTH_BASE = () => (process.env.PODIUM_OAUTH_BASE || process.env.PODIUM_API_BASE || "https://api.podium.com").replace(/\/$/, "");

export const PODIUM_SCOPES = "read_messages write_messages read_users read_locations write_reviews";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS podium_oauth (
  id INTEGER PRIMARY KEY,
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  location_uid TEXT NOT NULL DEFAULT '',
  connected_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

export function podiumOAuthConfigured() {
  return Boolean(process.env.PODIUM_CLIENT_ID && process.env.PODIUM_CLIENT_SECRET);
}

export async function getPodiumConnection() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM podium_oauth WHERE id = 1`);
  const row = result.rows[0];
  if (!row || !row.refresh_token) return null;
  return {
    locationUid: row.location_uid || "",
    connectedBy: row.connected_by || "",
    expiresAt: row.expires_at?.toISOString?.() || null,
    updatedAt: row.updated_at?.toISOString?.() || null
  };
}

export async function podiumConnected() {
  return Boolean(await getPodiumConnection());
}

export async function disconnectPodium() {
  const pool = await getReadyPool();
  await pool.query(`DELETE FROM podium_oauth WHERE id = 1`);
}

// OAuth state: HMAC-signed timestamp so the callback can't be forged. No
// server-side storage needed; valid for 15 minutes.
export function makeOAuthState(secret) {
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", String(secret)).update(ts).digest("base64url");
  return `${ts}.${sig}`;
}
export function verifyOAuthState(state, secret) {
  const [ts, sig] = String(state || "").split(".");
  if (!ts || !sig) return false;
  const expected = crypto.createHmac("sha256", String(secret)).update(ts).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch { return false; }
  return Date.now() - Number(ts) < 15 * 60 * 1000;
}

export function getAuthorizeUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: process.env.PODIUM_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: PODIUM_SCOPES,
    state
  });
  return `${OAUTH_BASE()}/oauth/authorize?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(`${OAUTH_BASE()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PODIUM_CLIENT_ID,
      client_secret: process.env.PODIUM_CLIENT_SECRET,
      ...body
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Podium token request failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function storeTokens(pool, data, extra = {}) {
  const expiresAt = new Date(Date.now() + (Number(data.expires_in) || 36000) * 1000 - 5 * 60 * 1000);
  await pool.query(
    `INSERT INTO podium_oauth (id, access_token, refresh_token, expires_at, location_uid, connected_by, updated_at)
     VALUES (1, $1, $2, $3, COALESCE($4, ''), COALESCE($5, ''), NOW())
     ON CONFLICT (id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       location_uid = CASE WHEN EXCLUDED.location_uid <> '' THEN EXCLUDED.location_uid ELSE podium_oauth.location_uid END,
       connected_by = CASE WHEN EXCLUDED.connected_by <> '' THEN EXCLUDED.connected_by ELSE podium_oauth.connected_by END,
       updated_at = NOW()`,
    [data.access_token, data.refresh_token || "", expiresAt, extra.locationUid || "", extra.connectedBy || ""]
  );
}

export async function exchangeOAuthCode(code, redirectUri, connectedBy = "") {
  const pool = await getReadyPool();
  const data = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  await storeTokens(pool, data, { connectedBy });
  // Learn the location once so every send can default to it.
  try {
    const locations = await podiumFetch("/v4/locations");
    const first = locations?.data?.[0];
    if (first?.uid) {
      await pool.query(`UPDATE podium_oauth SET location_uid = $1 WHERE id = 1`, [String(first.uid)]);
    }
  } catch (err) {
    console.error("Podium location lookup failed (will retry on demand):", err.message);
  }
  return getPodiumConnection();
}

let refreshInFlight = null;
export async function getPodiumAccessToken() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM podium_oauth WHERE id = 1`);
  const row = result.rows[0];
  if (!row || !row.refresh_token) return null;
  if (row.expires_at && new Date(row.expires_at) > new Date()) return row.access_token;
  // Refresh (rotates the pair). Coalesce concurrent callers onto one request.
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refresh_token });
        await storeTokens(pool, data);
        return data.access_token;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function podiumFetch(path, { method = "GET", body = null } = {}) {
  const token = await getPodiumAccessToken();
  if (!token) throw new Error("Podium is not connected.");
  const res = await fetch(API_BASE() + path, {
    method,
    headers: { "Authorization": `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const err = new Error(`Podium ${method} ${path} → ${res.status}: ${(text || "").slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function getDefaultLocationUid() {
  const pool = await getReadyPool();
  const row = (await pool.query(`SELECT location_uid FROM podium_oauth WHERE id = 1`)).rows[0];
  if (row?.location_uid) return row.location_uid;
  const locations = await podiumFetch("/v4/locations");
  const uid = locations?.data?.[0]?.uid ? String(locations.data[0].uid) : "";
  if (uid) await pool.query(`UPDATE podium_oauth SET location_uid = $1 WHERE id = 1`, [uid]);
  return uid;
}

const last10 = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);

// Podium's inbox auto-closes a conversation when an outbound reply goes
// through the API, and attributes the close to the connection owner. Andrew's
// standing rule (2026-08-27): no Agility→Podium activity may leave a
// conversation closed — so every send and note is followed by a best-effort
// reopen. A failure here never breaks the send/note itself.
export async function reopenConversation(conversationUid) {
  return podiumFetch(`/v4/conversations/${encodeURIComponent(conversationUid)}`, {
    method: "PUT",
    body: { closed: false }
  });
}

// Send a real customer-facing text from the showroom number.
export async function podiumSendMessage({ phone, body }) {
  const locationUid = await getDefaultLocationUid();
  if (!locationUid) throw new Error("No Podium location on the connection.");
  const result = await podiumFetch("/v4/messages", {
    method: "POST",
    body: { channel: { type: "phone", identifier: last10(phone) }, body: String(body).slice(0, 1200), locationUid }
  });
  // Undo the auto-close the outbound message just triggered (see above).
  try {
    const convo = await findConversationByPhone(phone);
    if (convo) await reopenConversation(convo.uid);
  } catch (err) {
    console.error("Podium reopen-after-send skipped:", err.message);
  }
  return result;
}

// Most-recent conversation for a phone number (scans up to 5 pages of 100).
export async function findConversationByPhone(phone) {
  const target = last10(phone);
  if (target.length !== 10) return null;
  let cursor = "", best = null;
  for (let page = 0; page < 5; page++) {
    const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
    const data = await podiumFetch(`/v4/conversations${query}`);
    for (const convo of data?.data || []) {
      if (last10(convo?.channel?.identifier) !== target) continue;
      const when = convo.lastItemAt || convo.updatedAt || "";
      if (!best || when > best.when) best = { uid: String(convo.uid), contactName: convo.contactName || "", when };
    }
    cursor = data?.pagination?.endCursor || data?.metadata?.nextCursor || "";
    if (!cursor || !(data?.data || []).length) break;
  }
  return best;
}

export async function addConversationNote(conversationUid, body, senderName) {
  const result = await podiumFetch(`/v4/conversations/${encodeURIComponent(conversationUid)}/notes`, {
    method: "POST",
    body: { body: String(body).slice(0, 2000), senderName: String(senderName || "Wilson Agility").slice(0, 120) }
  });
  // Notes are silent record-keeping — never let one leave the thread looking
  // "handled and closed" (see reopenConversation above).
  try {
    await reopenConversation(conversationUid);
  } catch (err) {
    console.error("Podium reopen-after-note skipped:", err.message);
  }
  return result;
}

export async function findPodiumUserByEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;
  let cursor = "";
  for (let page = 0; page < 3; page++) {
    const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100&includeAgents=false";
    const data = await podiumFetch(`/v4/users${query}`);
    const hit = (data?.data || []).find((u) => String(u.email || "").toLowerCase() === target);
    if (hit) return { uid: String(hit.uid), email: hit.email };
    cursor = data?.pagination?.endCursor || data?.metadata?.nextCursor || "";
    if (!cursor || !(data?.data || []).length) break;
  }
  return null;
}

// Assign (and reopen — assignment doesn't surface on a closed conversation).
export async function assignConversation(conversationUid, userUid, byName, { reopen = true } = {}) {
  return podiumFetch(`/v4/conversations/${encodeURIComponent(conversationUid)}`, {
    method: "PUT",
    body: {
      assignedUserUid: userUid,
      assignedByName: String(byName || "Wilson Agility").slice(0, 120),
      conversationAssigneeUids: [userUid],
      ...(reopen ? { closed: false } : {})
    }
  });
}

// ---- message templates -----------------------------------------------------
// Templates are authored in Podium (Inbox → Templates) and fetched here.
// IMPORTANT Podium quirk: the send endpoint does NOT expand variables, so we
// render the template text ourselves before sending. Tokens look like
// {{First Name}} / {{amount}} — matched case-insensitively with spaces and
// underscores treated the same; unmatched tokens are stripped.

let templateCache = { at: 0, list: [] };

export async function listMessageTemplates({ force = false } = {}) {
  if (!force && templateCache.list.length && Date.now() - templateCache.at < 10 * 60 * 1000) {
    return templateCache.list;
  }
  const out = [];
  let cursor = "";
  for (let page = 0; page < 3; page++) {
    const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
    const data = await podiumFetch(`/v4/templates${query}`);
    for (const t of data?.data || []) {
      out.push({ uid: String(t.uid || ""), title: t.title || t.name || "", text: t.text || t.body || "", type: t.type || "" });
    }
    cursor = data?.pagination?.endCursor || data?.metadata?.nextCursor || "";
    if (!cursor || !(data?.data || []).length) break;
  }
  templateCache = { at: Date.now(), list: out };
  return out;
}

export async function findTemplateByTitle(title) {
  const target = String(title || "").trim().toLowerCase();
  if (!target) return null;
  const templates = await listMessageTemplates();
  return templates.find((t) => t.title.trim().toLowerCase() === target) || null;
}

export function renderTemplateText(text, vars = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(vars)) {
    normalized[String(key).toLowerCase().replace(/[\s_]+/g, "_")] = String(value ?? "");
  }
  return String(text || "")
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, token) => {
      const key = String(token).toLowerCase().replace(/[\s_]+/g, "_");
      return key in normalized ? normalized[key] : "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Send a prebuilt Podium template to a phone number, with variables filled
// server-side. Falls back to fallbackBody when the template doesn't exist
// (so a renamed template degrades gracefully instead of going silent).
export async function sendPodiumTemplateText({ phone, templateTitle, vars = {}, fallbackBody = "" }) {
  const template = await findTemplateByTitle(templateTitle);
  const body = template ? renderTemplateText(template.text, vars) : String(fallbackBody || "").trim();
  if (!body) return { ok: false, error: template ? "template_rendered_empty" : "template_not_found" };
  await podiumSendMessage({ phone, body });
  return { ok: true, usedTemplate: template ? template.title : null };
}

// The composite used when a lead is claimed: drop a context note into the
// customer's thread as the claimer, then route the conversation to them.
export async function noteAndAssign({ phone, note, senderName, assigneeEmail }) {
  const convo = await findConversationByPhone(phone);
  if (!convo) return { ok: false, error: "no_conversation_found" };
  await addConversationNote(convo.uid, note, senderName);
  let assignment = null;
  if (assigneeEmail) {
    const user = await findPodiumUserByEmail(assigneeEmail);
    if (user) {
      await assignConversation(convo.uid, user.uid, senderName);
      assignment = { userUid: user.uid, email: user.email };
    } else {
      assignment = { error: "user_not_found" };
    }
  }
  return { ok: true, conversationUid: convo.uid, contactName: convo.contactName, assignment };
}

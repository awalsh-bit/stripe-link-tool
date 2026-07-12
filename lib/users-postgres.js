import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Schema (idempotent — mirrors sql/003_user_access.sql)
// ---------------------------------------------------------------------------

const USER_ACCESS_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_verification',
  is_executive BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES app_users(id),
  CONSTRAINT app_users_status_check CHECK (
    status IN ('pending_verification', 'invited', 'active', 'disabled')
  )
);

CREATE INDEX IF NOT EXISTS idx_app_users_status ON app_users (status);

CREATE TABLE IF NOT EXISTS user_page_permissions (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  page_path TEXT NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES app_users(id),
  PRIMARY KEY (user_id, page_path)
);

CREATE INDEX IF NOT EXISTS idx_user_page_permissions_user ON user_page_permissions (user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT auth_tokens_kind_check CHECK (kind IN ('invite', 'verify', 'reset'))
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_kind ON auth_tokens (user_id, kind);

CREATE TABLE IF NOT EXISTS access_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_audit_log_created ON access_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_audit_log_target ON access_audit_log (target_user_id);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE access_audit_log ADD COLUMN IF NOT EXISTS ip TEXT NOT NULL DEFAULT '';
`;

let ensurePromise = null;

export function isUserStoreConfigured() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

export async function ensureUserAccessTables() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const pool = await getPostgresPool();
      await pool.query(USER_ACCESS_SCHEMA_SQL);
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }

  return ensurePromise;
}

async function getReadyPool() {
  await ensureUserAccessTables();
  return getPostgresPool();
}

// ---------------------------------------------------------------------------
// Email normalization + policy
// ---------------------------------------------------------------------------

export function normalizeEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  const atIndex = value.lastIndexOf("@");

  if (atIndex <= 0 || atIndex === value.length - 1) {
    return "";
  }

  let local = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);

  // Strip +tag sub-addressing so one mailbox maps to one account.
  const plusIndex = local.indexOf("+");
  if (plusIndex > 0) {
    local = local.slice(0, plusIndex);
  }

  if (!local || !/^[a-z0-9._'-]+$/.test(local) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return "";
  }

  return `${local}@${domain}`;
}

export function getAllowedSignupDomain() {
  return String(process.env.ALLOWED_SIGNUP_DOMAIN || "wilsonappliance.com")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

export function isEmailInAllowedDomain(normalizedEmail) {
  const domain = getAllowedSignupDomain();
  return Boolean(normalizedEmail) && normalizedEmail.endsWith(`@${domain}`);
}

export const PASSWORD_MIN_LENGTH = 12;

export function validatePasswordPolicy(password, email = "") {
  const value = String(password || "");

  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }

  if (value.length > 512) {
    return "Password is too long.";
  }

  const normalized = normalizeEmail(email);
  if (normalized && value.trim().toLowerCase() === normalized) {
    return "Password must not be the same as your email address.";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Password hashing (Node built-in scrypt; no native build dependencies)
// Stored format: scrypt$N$r$p$saltBase64url$hashBase64url
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function scryptAsync(password, salt, keylen, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
}

export async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, nText, rText, pText, saltText, hashText] = parts;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltText, "base64url");
    expected = Buffer.from(hashText, "base64url");
  } catch {
    return false;
  }

  if (!salt.length || !expected.length) {
    return false;
  }

  try {
    const derived = await scryptAsync(String(password), salt, expected.length, { N, r, p });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function mapUserRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || "",
    status: row.status,
    isExecutive: Boolean(row.is_executive),
    emailVerifiedAt: row.email_verified_at?.toISOString?.() || row.email_verified_at || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at || null,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null,
    createdBy: row.created_by || null,
    hasPassword: Boolean(row.password_hash),
    preferences: row.preferences || {}
  };
}

// ---------------------------------------------------------------------------
// Per-user preferences (jsonb on app_users) — e.g. dashboard card slots.
// ---------------------------------------------------------------------------

export async function setUserPreferences(userId, patch) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE app_users
     SET preferences = COALESCE(preferences, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1
     RETURNING preferences`,
    [userId, JSON.stringify(patch || {})]
  );

  return result.rows[0]?.preferences || {};
}

export async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM app_users WHERE email = $1`,
    [normalized]
  );

  return result.rows[0] || null;
}

export async function getUserById(userId) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM app_users WHERE id = $1`,
    [userId]
  );

  return result.rows[0] || null;
}

export async function createUser({
  email,
  passwordHash = null,
  displayName = "",
  status = "pending_verification",
  isExecutive = false,
  createdBy = null
}) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    throw new Error("A valid email address is required.");
  }

  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO app_users (email, password_hash, display_name, status, is_executive, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [normalized, passwordHash, String(displayName || "").trim(), status, Boolean(isExecutive), createdBy]
  );

  return result.rows[0];
}

export async function markUserVerifiedAndActive(userId) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE app_users
     SET email_verified_at = COALESCE(email_verified_at, NOW()),
         status = CASE WHEN status = 'disabled' THEN status ELSE 'active' END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [userId]
  );

  return result.rows[0] || null;
}

export async function updateUserPassword(userId, passwordHash) {
  const pool = await getReadyPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE app_users SET password_hash = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [userId, passwordHash]
    );
    // Password change revokes every existing session.
    await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setUserStatus(userId, status, actorUserId = null, actorIp = "") {
  if (!["pending_verification", "invited", "active", "disabled"].includes(status)) {
    throw new Error("Invalid user status.");
  }

  const pool = await getReadyPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE app_users SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [userId, status]
    );

    if (status === "disabled") {
      // Deactivation immediately revokes access on the next request.
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      await client.query(`UPDATE auth_tokens SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL`, [userId]);
    }

    await insertAuditRow(client, {
      actorUserId,
      action: status === "disabled" ? "user_disabled" : `user_status_${status}`,
      targetUserId: userId,
      detail: { status },
      ip: actorIp
    });

    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setUserExecutive(userId, isExecutive, actorUserId = null, actorIp = "") {
  const pool = await getReadyPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE app_users SET is_executive = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [userId, Boolean(isExecutive)]
    );
    await insertAuditRow(client, {
      actorUserId,
      action: isExecutive ? "executive_granted" : "executive_revoked",
      targetUserId: userId,
      detail: { isExecutive: Boolean(isExecutive) },
      ip: actorIp
    });
    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateUserProfile(userId, { displayName }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE app_users SET display_name = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [userId, String(displayName || "").trim()]
  );

  return result.rows[0] || null;
}

export async function listUsersWithAccess() {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT
       u.*,
       COALESCE(perm.pages, '[]'::json) AS granted_pages,
       sess.last_seen_at AS last_seen_at,
       sess.active_sessions AS active_sessions
     FROM app_users u
     LEFT JOIN LATERAL (
       SELECT json_agg(p.page_path ORDER BY p.page_path) AS pages
       FROM user_page_permissions p
       WHERE p.user_id = u.id AND p.granted = TRUE
     ) perm ON TRUE
     LEFT JOIN LATERAL (
       SELECT MAX(s.last_seen_at) AS last_seen_at,
              COUNT(*) FILTER (WHERE s.expires_at > NOW()) AS active_sessions
       FROM sessions s
       WHERE s.user_id = u.id
     ) sess ON TRUE
     ORDER BY u.created_at ASC`
  );

  return result.rows.map((row) => ({
    ...mapUserRow(row),
    grantedPages: Array.isArray(row.granted_pages) ? row.granted_pages : [],
    lastSeenAt: row.last_seen_at?.toISOString?.() || row.last_seen_at || null,
    activeSessions: Number(row.active_sessions || 0)
  }));
}

export { mapUserRow };

// ---------------------------------------------------------------------------
// Auth tokens (invite / verify / reset) — stored hashed, single-use, expiring
// ---------------------------------------------------------------------------

export const TOKEN_TTLS_SECONDS = {
  invite: 72 * 60 * 60,
  verify: 72 * 60 * 60,
  reset: 60 * 60
};

export function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

export async function createAuthToken(userId, kind, ttlSeconds = null) {
  if (!["invite", "verify", "reset"].includes(kind)) {
    throw new Error("Invalid token kind.");
  }

  const ttl = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : TOKEN_TTLS_SECONDS[kind];
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const pool = await getReadyPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    // Invalidate older outstanding tokens of the same kind so only the most
    // recent emailed link works.
    await client.query(
      `UPDATE auth_tokens SET consumed_at = NOW()
       WHERE user_id = $1 AND kind = $2 AND consumed_at IS NULL`,
      [userId, kind]
    );
    await client.query(
      `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + make_interval(secs => $4))`,
      [userId, kind, hashToken(rawToken), ttl]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return rawToken;
}

// Atomically consume a token: marks it used and returns the owning user row,
// or null when the token is unknown, expired, already used, or the wrong kind.
export async function consumeAuthToken(kind, rawToken) {
  const raw = String(rawToken || "").trim();

  if (!raw || raw.length < 16 || raw.length > 128) {
    return null;
  }

  const tokenHash = hashToken(raw);
  const pool = await getReadyPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const tokenResult = await client.query(
      `UPDATE auth_tokens
       SET consumed_at = NOW()
       WHERE token_hash = $1
         AND kind = $2
         AND consumed_at IS NULL
         AND expires_at > NOW()
       RETURNING id, user_id, token_hash`,
      [tokenHash, kind]
    );

    const tokenRow = tokenResult.rows[0];

    if (
      !tokenRow ||
      !crypto.timingSafeEqual(Buffer.from(tokenRow.token_hash), Buffer.from(tokenHash))
    ) {
      await client.query("ROLLBACK");
      return null;
    }

    const userResult = await client.query(
      `SELECT * FROM app_users WHERE id = $1`,
      [tokenRow.user_id]
    );

    await client.query("COMMIT");
    return userResult.rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Read-only check (used by set-password pages to validate a link before the
// user types a new password). Does NOT consume the token.
export async function peekAuthToken(kind, rawToken) {
  const raw = String(rawToken || "").trim();

  if (!raw || raw.length < 16 || raw.length > 128) {
    return null;
  }

  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT t.user_id, u.email, u.status
     FROM auth_tokens t
     JOIN app_users u ON u.id = t.user_id
     WHERE t.token_hash = $1
       AND t.kind = $2
       AND t.consumed_at IS NULL
       AND t.expires_at > NOW()`,
    [hashToken(raw), kind]
  );

  return result.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Sessions (server-side, revocable)
// ---------------------------------------------------------------------------

export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12;

export async function createSession(userId, { ip = "", userAgent = "", ttlSeconds = DEFAULT_SESSION_TTL_SECONDS } = {}) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const pool = await getReadyPool();

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, NOW() + make_interval(secs => $3), $4, $5)`,
    [userId, hashToken(rawToken), Number(ttlSeconds) || DEFAULT_SESSION_TTL_SECONDS, String(ip || "").slice(0, 100), String(userAgent || "").slice(0, 400)]
  );

  return rawToken;
}

// Resolve a session token to its user. Returns null when the session is
// missing/expired, or when the user is no longer active+verified.
export async function getSessionWithUser(rawToken) {
  const raw = String(rawToken || "").trim();

  if (!raw || raw.length < 16 || raw.length > 128 || raw.includes(".")) {
    return null;
  }

  const tokenHash = hashToken(raw);
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT
       s.id AS session_id,
       s.token_hash AS session_token_hash,
       s.expires_at AS session_expires_at,
       s.last_seen_at AS session_last_seen_at,
       u.*
     FROM sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()`,
    [tokenHash]
  );

  const row = result.rows[0];

  if (
    !row ||
    !crypto.timingSafeEqual(Buffer.from(row.session_token_hash), Buffer.from(tokenHash))
  ) {
    return null;
  }

  if (row.status !== "active" || !row.email_verified_at) {
    // Disabled or no-longer-eligible user: revoke the session outright.
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [row.session_id]);
    return null;
  }

  // Throttle last_seen updates to once a minute to avoid a write per request.
  const lastSeen = new Date(row.session_last_seen_at).getTime();
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 60 * 1000) {
    pool
      .query(`UPDATE sessions SET last_seen_at = NOW() WHERE id = $1`, [row.session_id])
      .catch(() => {});
  }

  return {
    sessionId: row.session_id,
    user: row
  };
}

export async function deleteSessionByToken(rawToken) {
  const raw = String(rawToken || "").trim();
  if (!raw || raw.length < 16 || raw.length > 128) return;

  const pool = await getReadyPool();
  await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(raw)]);
}

export async function deleteSessionsForUser(userId) {
  const pool = await getReadyPool();
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

export async function cleanupExpiredAuthRows() {
  const pool = await getReadyPool();
  await pool.query(`DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '1 day'`);
  await pool.query(`DELETE FROM auth_tokens WHERE expires_at < NOW() - INTERVAL '7 days'`);
}

// ---------------------------------------------------------------------------
// Page permissions
// ---------------------------------------------------------------------------

export async function getGrantedPagesForUser(userId) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT page_path FROM user_page_permissions WHERE user_id = $1 AND granted = TRUE ORDER BY page_path`,
    [userId]
  );

  return result.rows.map((row) => row.page_path);
}

// changes: [{ pagePath, granted }]
export async function setUserPagePermissions(userId, changes, actorUserId = null, actorIp = "") {
  const list = Array.isArray(changes) ? changes : [];
  if (!list.length) return [];

  const pool = await getReadyPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const change of list) {
      await client.query(
        `INSERT INTO user_page_permissions (user_id, page_path, granted, updated_at, updated_by)
         VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT (user_id, page_path) DO UPDATE SET
           granted = EXCLUDED.granted,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by`,
        [userId, String(change.pagePath), Boolean(change.granted), actorUserId]
      );
    }

    await insertAuditRow(client, {
      actorUserId,
      action: "permissions_updated",
      targetUserId: userId,
      detail: {
        changes: list.map((c) => ({ pagePath: String(c.pagePath), granted: Boolean(c.granted) }))
      },
      ip: actorIp
    });

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getGrantedPagesForUser(userId);
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

async function insertAuditRow(client, { actorUserId = null, action, targetUserId = null, detail = {}, ip = "" }) {
  await client.query(
    `INSERT INTO access_audit_log (actor_user_id, action, target_user_id, detail, ip)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [actorUserId, String(action), targetUserId, JSON.stringify(detail || {}), String(ip || "")]
  );
}

export async function recordAudit(entry) {
  const pool = await getReadyPool();
  await insertAuditRow(pool, entry);
}

// Date-ranged audit search for the User Activity Audit page.
// startDate/endDate are inclusive YYYY-MM-DD strings (server local time).
export async function searchAuditLog({ startDate, endDate, userId = null, action = "", limit = 2000 } = {}) {
  const pool = await getReadyPool();

  const params = [String(startDate), String(endDate)];
  const where = [
    `a.created_at >= $1::date`,
    `a.created_at < ($2::date + INTERVAL '1 day')`
  ];

  if (userId) {
    params.push(userId);
    where.push(`(a.actor_user_id = $${params.length} OR a.target_user_id = $${params.length})`);
  }

  if (action) {
    params.push(String(action));
    where.push(`a.action = $${params.length}`);
  }

  params.push(Math.min(Math.max(Number(limit) || 2000, 1), 10000));

  const result = await pool.query(
    `SELECT
       a.id,
       a.action,
       a.detail,
       a.ip,
       a.created_at,
       actor.email AS actor_email,
       target.email AS target_email
     FROM access_audit_log a
     LEFT JOIN app_users actor ON actor.id = a.actor_user_id
     LEFT JOIN app_users target ON target.id = a.target_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY a.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    detail: row.detail || {},
    ip: row.ip || "",
    createdAt: row.created_at?.toISOString?.() || row.created_at || null,
    actorEmail: row.actor_email || "",
    targetEmail: row.target_email || ""
  }));
}

export async function listAuditActions() {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT DISTINCT action FROM access_audit_log ORDER BY action ASC`
  );
  return result.rows.map((row) => row.action);
}

export async function listAuditLog(limit = 200) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT
       a.id,
       a.action,
       a.detail,
       a.created_at,
       actor.email AS actor_email,
       target.email AS target_email
     FROM access_audit_log a
     LEFT JOIN app_users actor ON actor.id = a.actor_user_id
     LEFT JOIN app_users target ON target.id = a.target_user_id
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 200, 1), 1000)]
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    detail: row.detail || {},
    createdAt: row.created_at?.toISOString?.() || row.created_at || null,
    actorEmail: row.actor_email || "",
    targetEmail: row.target_email || ""
  }));
}

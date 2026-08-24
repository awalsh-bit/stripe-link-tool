import crypto from "node:crypto";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Sales Order Health Report (sales-order-health.html) — the latest open-order
// export (ExportInvoice xlsx) is parsed in the browser and stored here as a
// single snapshot, so everyone sees the same data with a "data as of" stamp.
// Health rules are applied client-side so rule tweaks don't require re-upload.
// ---------------------------------------------------------------------------

const SALES_ORDERS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sales_order_snapshots (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS sales_order_dismissals (
  user_email TEXT NOT NULL,
  invoice TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_email, invoice)
);

CREATE TABLE IF NOT EXISTS sales_order_flag_closures (
  token TEXT PRIMARY KEY,
  severity TEXT NOT NULL DEFAULT '',
  invoice TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT '',
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  order_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed_by_email TEXT NOT NULL DEFAULT '',
  closed_by_name TEXT NOT NULL DEFAULT '',
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_uploaded_at TIMESTAMPTZ,
  report_filename TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'order_flag',
  ref_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT ''
);
ALTER TABLE sales_order_flag_closures ADD COLUMN IF NOT EXISTS report_uploaded_at TIMESTAMPTZ;
ALTER TABLE sales_order_flag_closures ADD COLUMN IF NOT EXISTS report_filename TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_order_flag_closures ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'order_flag';
ALTER TABLE sales_order_flag_closures ADD COLUMN IF NOT EXISTS ref_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_order_flag_closures ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS pushed_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity TEXT NOT NULL DEFAULT 'neutral',
  type_label TEXT NOT NULL DEFAULT 'Company News',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  audience_email TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE pushed_notifications ADD COLUMN IF NOT EXISTS ref_id TEXT NOT NULL DEFAULT '';
ALTER TABLE pushed_notifications ADD COLUMN IF NOT EXISTS claimable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pushed_notifications ADD COLUMN IF NOT EXISTS claimed_by_email TEXT NOT NULL DEFAULT '';
ALTER TABLE pushed_notifications ADD COLUMN IF NOT EXISTS claimed_by_name TEXT NOT NULL DEFAULT '';
ALTER TABLE pushed_notifications ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(SALES_ORDERS_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

function mapRow(row) {
  return {
    filename: row.filename,
    uploadedByEmail: row.uploaded_by_email,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: row.uploaded_at?.toISOString?.() || null,
    rowCount: row.row_count,
    rows: row.data || []
  };
}

export async function getSalesOrderSnapshot() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM sales_order_snapshots WHERE id = 1`);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// "My Order Flags" dismissals — closing a flag card on the dashboard stores
// the order's current flag signature; the card stays closed until the order's
// flags change, then it reappears with the new problem.
// ---------------------------------------------------------------------------

export async function listOrderFlagDismissals(userEmail) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT invoice, signature, dismissed_at FROM sales_order_dismissals WHERE user_email = $1`,
    [String(userEmail || "").trim().toLowerCase()]
  );
  return result.rows.map((row) => ({
    invoice: row.invoice,
    signature: row.signature,
    dismissedAt: row.dismissed_at?.toISOString?.() || null
  }));
}

export async function dismissOrderFlag({ userEmail, invoice, signature }) {
  const pool = await getReadyPool();
  await pool.query(
    `INSERT INTO sales_order_dismissals (user_email, invoice, signature, dismissed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_email, invoice) DO UPDATE SET
       signature = EXCLUDED.signature,
       dismissed_at = NOW()`,
    [
      String(userEmail || "").trim().toLowerCase(),
      String(invoice || "").trim().slice(0, 40),
      String(signature || "").slice(0, 800)
    ]
  );
  return true;
}

// ---------------------------------------------------------------------------
// Flag closure log — every Close on "My Sales Order Health" writes an
// append-only record under a flag-instance token (RFI-… for red, YFI-… for
// yellow), so closed "fixes" can be inspected later. The dismissals table
// above only holds the CURRENT hide state; this is the permanent history.
// ---------------------------------------------------------------------------

const TOKEN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const SEVERITY_PREFIXES = { red: "RFI", yellow: "YFI", green: "GFI", neutral: "NFI" };
const NOTIFICATION_SEVERITIES = Object.keys(SEVERITY_PREFIXES);

function generateClosureToken(severity) {
  const prefix = SEVERITY_PREFIXES[severity] || "NFI";
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) code += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return `${prefix}-${code}`;
}

export async function recordFlagClosure({ severity, invoice, signature, flags, orderSnapshot, byEmail, byName, reportUploadedAt = null, reportFilename = "", closedAt = null, kind = "order_flag", refId = "", title = "" }) {
  const pool = await getReadyPool();
  const level = NOTIFICATION_SEVERITIES.includes(severity) ? severity : "yellow";
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = generateClosureToken(level);
    const result = await pool.query(
      `INSERT INTO sales_order_flag_closures
         (token, severity, invoice, signature, flags, order_snapshot, closed_by_email, closed_by_name, report_uploaded_at, report_filename, closed_at, kind, ref_id, title)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, COALESCE($11, NOW()), $12, $13, $14)
       ON CONFLICT (token) DO NOTHING
       RETURNING token`,
      [
        token,
        level,
        String(invoice || "").trim().slice(0, 40),
        String(signature || "").slice(0, 800),
        JSON.stringify(Array.isArray(flags) ? flags.slice(0, 20) : []),
        JSON.stringify(orderSnapshot || {}),
        String(byEmail || "").trim().toLowerCase(),
        String(byName || "").trim(),
        reportUploadedAt || null,
        String(reportFilename || "").slice(0, 200),
        closedAt || null,
        String(kind || "order_flag").slice(0, 30),
        String(refId || "").slice(0, 60),
        String(title || "").slice(0, 200)
      ]
    );
    if (result.rows[0]) return result.rows[0].token;
  }
  throw new Error("Could not allocate a flag-instance token.");
}

export async function listFlagClosures() {
  const pool = await getReadyPool();
  await ensureClosureBackfill();
  const result = await pool.query(
    `SELECT * FROM sales_order_flag_closures ORDER BY closed_at DESC LIMIT 500`
  );
  return result.rows.map(mapClosureRow);
}

// ---------------------------------------------------------------------------
// Backfill: flags closed BEFORE the closure log shipped (or whose log write
// failed) exist only in sales_order_dismissals. On first read per process,
// reconstruct closure records for any dismissal with no matching closure —
// severity and flag texts are recoverable from the stored signature
// ("INVOICE|red:Text;yellow:Text"), closed_at from dismissed_at. The report
// version for backfilled rows is unknown and left null.
// ---------------------------------------------------------------------------

let backfillPromise = null;

function parseSignatureFlags(signature) {
  const bar = String(signature || "").indexOf("|");
  const flagsPart = bar >= 0 ? String(signature).slice(bar + 1) : "";
  const flags = flagsPart
    ? flagsPart.split(";").map((piece) => {
        const colon = piece.indexOf(":");
        if (colon <= 0) return null;
        return {
          level: piece.slice(0, colon) === "red" ? "red" : "yellow",
          text: piece.slice(colon + 1).slice(0, 120)
        };
      }).filter(Boolean)
    : [];
  const severity = flags.some((f) => f.level === "red") ? "red" : "yellow";
  return { flags, severity };
}

async function ensureClosureBackfill() {
  if (!backfillPromise) {
    backfillPromise = runClosureBackfill().catch((err) => {
      console.error("Closure backfill failed:", err.message);
      backfillPromise = null; // retry on next read
    });
  }
  return backfillPromise;
}

async function runClosureBackfill() {
  const pool = await getReadyPool();
  const missing = await pool.query(
    `SELECT d.user_email, d.invoice, d.signature, d.dismissed_at
     FROM sales_order_dismissals d
     WHERE NOT EXISTS (
       SELECT 1 FROM sales_order_flag_closures c
       WHERE c.invoice = d.invoice
         AND c.signature = d.signature
         AND c.closed_by_email = d.user_email
     )`
  );
  if (!missing.rows.length) return 0;

  const snapshotResult = await pool.query(`SELECT data FROM sales_order_snapshots WHERE id = 1`);
  const snapshotRows = snapshotResult.rows[0]?.data || [];
  const byInvoice = new Map(snapshotRows.map((row) => [String(row.invoice || "").trim(), row]));

  let created = 0;
  for (const row of missing.rows) {
    const { flags, severity } = parseSignatureFlags(row.signature);
    await recordFlagClosure({
      severity,
      invoice: row.invoice,
      signature: row.signature,
      flags,
      orderSnapshot: byInvoice.get(row.invoice) || {},
      byEmail: row.user_email,
      byName: "",
      closedAt: row.dismissed_at
    });
    created++;
  }
  console.log(`Closure backfill: created ${created} record(s) from existing dismissals.`);
  return created;
}

// Date-ranged listing for the Instance Closure Report. start/end are
// YYYY-MM-DD in Central time; end is inclusive. The naive midnight is
// interpreted AS Chicago wall time (timestamp AT TIME ZONE), which yields
// the correct UTC instant regardless of the server's timezone.
export async function listFlagClosuresRange({ start, end }) {
  const pool = await getReadyPool();
  await ensureClosureBackfill();
  const result = await pool.query(
    `SELECT * FROM sales_order_flag_closures
     WHERE closed_at >= ($1::date)::timestamp AT TIME ZONE 'America/Chicago'
       AND closed_at < ($2::date + INTERVAL '1 day') AT TIME ZONE 'America/Chicago'
     ORDER BY closed_at DESC
     LIMIT 5000`,
    [start, end]
  );
  return result.rows.map(mapClosureRow);
}

function mapClosureRow(row) {
  return ({
    token: row.token,
    severity: row.severity,
    invoice: row.invoice,
    signature: row.signature,
    flags: row.flags || [],
    order: row.order_snapshot || {},
    closedByEmail: row.closed_by_email,
    closedByName: row.closed_by_name,
    closedAt: row.closed_at?.toISOString?.() || null,
    reportUploadedAt: row.report_uploaded_at?.toISOString?.() || null,
    reportFilename: row.report_filename || "",
    kind: row.kind || "order_flag",
    refId: row.ref_id || "",
    title: row.title || ""
  });
}

// ---------------------------------------------------------------------------
// Pushed notifications — supervisors push a Neutral/Green/Yellow/Red item to
// one user (or everyone); closing it mints a token into the same closure log,
// which doubles as a read receipt.
// ---------------------------------------------------------------------------

export async function createPushedNotification({ severity, typeLabel, title, body, audienceEmail = "", refId = "", claimable = false, byEmail, byName }) {
  const pool = await getReadyPool();
  const level = NOTIFICATION_SEVERITIES.includes(severity) ? severity : "neutral";
  const result = await pool.query(
    `INSERT INTO pushed_notifications (severity, type_label, title, body, audience_email, ref_id, claimable, created_by_email, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      level,
      String(typeLabel || "Company News").trim().slice(0, 60),
      String(title || "").trim().slice(0, 200),
      String(body || "").trim().slice(0, 2000),
      String(audienceEmail || "").trim().toLowerCase().slice(0, 200),
      String(refId || "").trim().slice(0, 120),
      claimable === true,
      String(byEmail || "").trim().toLowerCase(),
      String(byName || "").trim()
    ]
  );
  return mapNotificationRow(result.rows[0]);
}

// Claim every active notification sharing a ref for one user: their copy
// stays on their dashboard (with an Unclaim escape hatch); everyone else's
// copy is hidden while the claim stands. First claim wins — the WHERE
// clause only matches unclaimed rows, so a second claimer updates nothing.
export async function claimPushedNotificationsByRef(refId, byEmail, byName = "") {
  const ref = String(refId || "").trim();
  const email = String(byEmail || "").trim().toLowerCase();
  if (!ref || !email) return 0;
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE pushed_notifications
        SET claimed_by_email = $2, claimed_by_name = $3, claimed_at = NOW()
      WHERE ref_id = $1 AND claimable AND active AND claimed_by_email = ''`,
    [ref, email, String(byName || "").trim()]
  );
  return result.rowCount;
}

// Release a claim (only the claimer can) — the lead reappears on every
// consultant's dashboard.
export async function unclaimPushedNotificationsByRef(refId, byEmail) {
  const ref = String(refId || "").trim();
  const email = String(byEmail || "").trim().toLowerCase();
  if (!ref || !email) return 0;
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE pushed_notifications
        SET claimed_by_email = '', claimed_by_name = '', claimed_at = NULL
      WHERE ref_id = $1 AND claimable AND claimed_by_email = $2`,
    [ref, email]
  );
  return result.rowCount;
}

// Retire every active notification sharing a ref (e.g. all the green flags
// for one web order, once somebody claims it). Retired flags vanish from
// everyone's dashboard — no manual close needed, no closure token minted.
export async function retirePushedNotificationsByRef(refId) {
  const ref = String(refId || "").trim();
  if (!ref) return 0;
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE pushed_notifications SET active = FALSE WHERE ref_id = $1 AND active`,
    [ref]
  );
  return result.rowCount;
}

function mapNotificationRow(row) {
  return {
    id: row.id,
    severity: row.severity,
    typeLabel: row.type_label,
    title: row.title,
    body: row.body,
    audienceEmail: row.audience_email,
    refId: row.ref_id || "",
    active: row.active,
    claimable: row.claimable === true,
    claimedByEmail: row.claimed_by_email || "",
    claimedByName: row.claimed_by_name || "",
    claimedAt: row.claimed_at?.toISOString?.() || null,
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    createdAt: row.created_at?.toISOString?.() || null
  };
}

// Active pushed notifications for a user that they haven't closed yet.
export async function listMyPushedNotifications(userEmail) {
  const pool = await getReadyPool();
  const email = String(userEmail || "").trim().toLowerCase();
  const result = await pool.query(
    `SELECT p.* FROM pushed_notifications p
     WHERE p.active
       AND (p.audience_email = '' OR p.audience_email = $1)
       AND (p.claimed_by_email = '' OR p.claimed_by_email = $1)
       AND NOT EXISTS (
         SELECT 1 FROM sales_order_flag_closures c
         WHERE c.kind = 'notification' AND c.ref_id = p.id::text AND c.closed_by_email = $1
       )
     ORDER BY p.created_at DESC
     LIMIT 50`,
    [email]
  );
  return result.rows.map(mapNotificationRow);
}

// Has a notification with this ref ever been created (active or not)?
// Used to flag a problem order once instead of on every daily upload.
export async function pushedNotificationRefExists(refId) {
  const ref = String(refId || "").trim();
  if (!ref) return false;
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT 1 FROM pushed_notifications WHERE ref_id = $1 LIMIT 1`, [ref]);
  return result.rows.length > 0;
}

export async function getPushedNotification(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM pushed_notifications WHERE id = $1`, [id]);
  return result.rows[0] ? mapNotificationRow(result.rows[0]) : null;
}

export async function saveSalesOrderSnapshot({ rows, filename, byEmail, byName }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO sales_order_snapshots (id, filename, uploaded_by_email, uploaded_by_name, uploaded_at, row_count, data)
     VALUES (1, $1, $2, $3, NOW(), $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       filename = EXCLUDED.filename,
       uploaded_by_email = EXCLUDED.uploaded_by_email,
       uploaded_by_name = EXCLUDED.uploaded_by_name,
       uploaded_at = NOW(),
       row_count = EXCLUDED.row_count,
       data = EXCLUDED.data
     RETURNING *`,
    [
      String(filename || "").slice(0, 200),
      String(byEmail || "").trim().toLowerCase(),
      String(byName || "").trim(),
      rows.length,
      JSON.stringify(rows)
    ]
  );
  return mapRow(result.rows[0]);
}

import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";
import { saveInstallDamagePhoto, getInstallDamagePhoto } from "./install-damage-postgres.js";

// ---------------------------------------------------------------------------
// Company card receipts (receipts.html / receipt-report.html).
//
// Every employee files their own card receipts: a photo of the receipt, the
// date, the amount, the merchant and the business purpose. Reviewers (page
// grant on /receipt-report.html — executives implicitly) pull them by person
// and/or month and export CSV.
//
// One small table. The photo bytes go in the existing install_damage_photos
// store (report_ref 'receipt:<id>', kind 'receipt') — no second photo table.
// Nothing about the card itself is stored: no number, no last-4.
// Deletes are soft (deleted_at) so a month's total can't quietly change.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS card_receipts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  filed_by_email TEXT NOT NULL DEFAULT '',
  filed_by_name TEXT NOT NULL DEFAULT '',
  spent_on DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  merchant TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  photo_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_card_receipts_filer_month ON card_receipts (filed_by_email, spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_card_receipts_spent ON card_receipts (spent_on DESC);
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
  const spentOn = row.spent_on instanceof Date ? row.spent_on.toISOString().slice(0, 10) : String(row.spent_on || "").slice(0, 10);
  return {
    id: row.id,
    userId: row.user_id || null,
    filedByEmail: row.filed_by_email,
    filedByName: row.filed_by_name,
    spentOn,
    month: spentOn.slice(0, 7),
    amount: Number(row.amount) || 0,
    merchant: row.merchant,
    purpose: row.purpose,
    hasPhoto: !!row.photo_id,
    createdAt: row.created_at?.toISOString?.() || null,
    deletedAt: row.deleted_at?.toISOString?.() || null,
    deletedBy: row.deleted_by || ""
  };
}

// Filters shared by "mine" and the report: a person (email), a year and/or
// a month. Returns [whereSql, params].
function buildWhere({ email = "", year = null, month = null, includeDeleted = false } = {}, params = []) {
  const where = [];
  if (!includeDeleted) where.push("deleted_at IS NULL");
  if (email) { params.push(String(email).toLowerCase()); where.push(`LOWER(filed_by_email) = $${params.length}`); }
  if (year) { params.push(Number(year)); where.push(`EXTRACT(YEAR FROM spent_on) = $${params.length}`); }
  if (month) { params.push(Number(month)); where.push(`EXTRACT(MONTH FROM spent_on) = $${params.length}`); }
  return [where.length ? `WHERE ${where.join(" AND ")}` : "", params];
}

export async function createCardReceipt({ userId = null, email, name, spentOn, amount, merchant = "", purpose, photo }) {
  const pool = await getReadyPool();
  const id = crypto.randomUUID();
  let photoId = null;
  if (photo && photo.buffer && photo.buffer.length) {
    photoId = await saveInstallDamagePhoto({
      reportRef: `receipt:${id}`,
      kind: "receipt",
      contentType: photo.contentType || "image/jpeg",
      buffer: photo.buffer
    });
  }
  const result = await pool.query(
    `INSERT INTO card_receipts (id, user_id, filed_by_email, filed_by_name, spent_on, amount, merchant, purpose, photo_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      id,
      userId || null,
      String(email || "").toLowerCase().slice(0, 200),
      String(name || "").slice(0, 120),
      spentOn,
      Math.round(Number(amount) * 100) / 100,
      String(merchant || "").slice(0, 120),
      String(purpose || "").slice(0, 600),
      photoId
    ]
  );
  return mapRow(result.rows[0]);
}

export async function getCardReceipt(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM card_receipts WHERE id = $1`, [id]);
  return result.rows[0] ? { ...mapRow(result.rows[0]), photoId: result.rows[0].photo_id } : null;
}

export async function listCardReceipts(filters = {}) {
  const pool = await getReadyPool();
  const [where, params] = buildWhere(filters);
  const result = await pool.query(
    `SELECT * FROM card_receipts ${where} ORDER BY spent_on DESC, created_at DESC LIMIT 2000`,
    params
  );
  return result.rows.map(mapRow);
}

// Who has filed, and which months exist — feeds the report's filter menus in
// one round trip.
export async function listCardReceiptFilters() {
  const pool = await getReadyPool();
  const [filers, months] = await Promise.all([
    pool.query(
      `SELECT filed_by_email AS email, MAX(filed_by_name) AS name, COUNT(*)::int AS count
         FROM card_receipts WHERE deleted_at IS NULL
        GROUP BY filed_by_email ORDER BY MAX(filed_by_name), filed_by_email`
    ),
    pool.query(
      `SELECT TO_CHAR(spent_on, 'YYYY-MM') AS month, COUNT(*)::int AS count, SUM(amount)::numeric(12,2) AS total
         FROM card_receipts WHERE deleted_at IS NULL
        GROUP BY 1 ORDER BY 1 DESC`
    )
  ]);
  return {
    filers: filers.rows.map((r) => ({ email: r.email, name: r.name || r.email, count: r.count })),
    months: months.rows.map((r) => ({ month: r.month, count: r.count, total: Number(r.total) || 0 }))
  };
}

export async function softDeleteCardReceipt(id, byEmail) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE card_receipts SET deleted_at = NOW(), deleted_by = $2
      WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, String(byEmail || "").slice(0, 200)]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getCardReceiptPhoto(receipt) {
  if (!receipt || !receipt.photoId) return null;
  const photo = await getInstallDamagePhoto(receipt.photoId);
  if (!photo || photo.reportRef !== `receipt:${receipt.id}`) return null;
  return photo;
}

// CSV for the accountant: one row per receipt, filtered like the report.
export function cardReceiptsCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Date", "Filed by", "Email", "Merchant", "Business purpose", "Amount", "Photo", "Filed at", "Receipt id"].join(",")];
  for (const r of rows) {
    lines.push([r.spentOn, r.filedByName, r.filedByEmail, r.merchant, r.purpose, r.amount.toFixed(2), r.hasPhoto ? "yes" : "no", r.createdAt || "", r.id].map(esc).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

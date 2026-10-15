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
-- Category (Andrew 10/7): fuel is rolled up per tech on the service
-- commission board. '' = filed before categories existed; those are
-- classified by merchant/purpose keywords (see FUEL_KEYWORDS_SQL).
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_card_receipts_category ON card_receipts (category);
-- Reviewer corrections (Andrew 10/15: Tracy fixes mis-keyed amounts). The
-- original amount is kept so the report can show "edited (was $X)".
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS edited_by TEXT NOT NULL DEFAULT '';
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2);
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS edit_note TEXT NOT NULL DEFAULT '';
-- Cardholder (Andrew 10/15: "people borrow credit cards and Tracy needs to
-- move a charge from one cardholder to another even if it is submitted by a
-- different user"). filed_by_* stays who keyed the receipt; cardholder_* is
-- whose card statement the charge lands on. They start equal; a reviewer
-- move changes the cardholder only and keeps where it came from.
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS cardholder_email TEXT NOT NULL DEFAULT '';
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS cardholder_name TEXT NOT NULL DEFAULT '';
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS moved_at TIMESTAMPTZ;
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS moved_by TEXT NOT NULL DEFAULT '';
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS moved_from_email TEXT NOT NULL DEFAULT '';
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS moved_from_name TEXT NOT NULL DEFAULT '';
ALTER TABLE card_receipts ADD COLUMN IF NOT EXISTS move_note TEXT NOT NULL DEFAULT '';
UPDATE card_receipts SET cardholder_email = filed_by_email, cardholder_name = filed_by_name WHERE cardholder_email = '';
CREATE INDEX IF NOT EXISTS idx_card_receipts_cardholder_month ON card_receipts (cardholder_email, spent_on DESC);
`;

export const RECEIPT_CATEGORIES = [
  { key: "fuel", label: "Fuel" },
  { key: "parts", label: "Parts & supplies" },
  { key: "tools", label: "Tools & equipment" },
  { key: "meals", label: "Meals & entertainment" },
  { key: "travel", label: "Travel & lodging" },
  { key: "office", label: "Office & software" },
  { key: "other", label: "Other" }
];
export const normalizeReceiptCategory = (v) => { const k = String(v || "").trim().toLowerCase(); return RECEIPT_CATEGORIES.some((c) => c.key === k) ? k : ""; };
// Same words the receipt form uses to pre-select "Fuel". Word-bounded so
// "gas range" (an appliance) doesn't match - "gas station" / "gasoline" do.
export const FUEL_KEYWORDS_RE = /\b(fuel|gasoline|diesel|unleaded|gas station|gas stop|fill[- ]?up|shell|exxon|mobil|chevron|texaco|valero|citgo|conoco|phillips 66|sunoco|marathon|murphy usa|racetrac|quiktrip|qt|circle k|7-eleven|buc-?ee'?s|stripes|love'?s|pilot|flying j|wawa|speedway|casey'?s|sam'?s club fuel|costco gas|h-?e-?b fuel|kroger fuel)\b/i;
// Postgres AREs spell word boundaries \y (\b there is a backspace).
const FUEL_KEYWORDS_SQL = FUEL_KEYWORDS_RE.source.replace(/\\b/g, "\\y");
export const isFuelReceipt = (r) => r.category ? r.category === "fuel" : FUEL_KEYWORDS_RE.test(`${r.merchant || ""} ${r.purpose || ""}`);

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
    cardholderEmail: row.cardholder_email || row.filed_by_email,
    cardholderName: row.cardholder_name || row.filed_by_name,
    // true when the charge sits on someone else's card than the person who filed it
    borrowed: !!row.cardholder_email && row.cardholder_email !== row.filed_by_email,
    movedAt: row.moved_at?.toISOString?.() || null,
    movedBy: row.moved_by || "",
    movedFromEmail: row.moved_from_email || "",
    movedFromName: row.moved_from_name || "",
    moveNote: row.move_note || "",
    spentOn,
    month: spentOn.slice(0, 7),
    amount: Number(row.amount) || 0,
    merchant: row.merchant,
    purpose: row.purpose,
    category: row.category || "",
    // '' rows (pre-category) are classified by keywords so old fuel still counts.
    effectiveCategory: row.category || (FUEL_KEYWORDS_RE.test(`${row.merchant || ""} ${row.purpose || ""}`) ? "fuel" : ""),
    hasPhoto: !!row.photo_id,
    // "photo" is historical: since 2026-09-21 the attachment can be a PDF too.
    photoType: row.photo_type || (row.photo_id ? "image/jpeg" : ""),
    isPdf: String(row.photo_type || "").toLowerCase() === "application/pdf",
    isReturn: (Number(row.amount) || 0) < 0,
    createdAt: row.created_at?.toISOString?.() || null,
    deletedAt: row.deleted_at?.toISOString?.() || null,
    editedAt: row.edited_at?.toISOString?.() || null,
    editedBy: row.edited_by || "",
    originalAmount: row.original_amount == null ? null : Number(row.original_amount),
    editNote: row.edit_note || "",
    deletedBy: row.deleted_by || ""
  };
}

// Filters shared by "mine" and the report: a person (email), a year and/or
// a month. Returns [whereSql, params]. The report's person is the CARDHOLDER
// (whose statement the charge is on); "mine" shows what I filed plus what
// was moved onto my card.
function buildWhere({ email = "", mine = "", year = null, month = null, includeDeleted = false } = {}, params = []) {
  const where = [];
  if (!includeDeleted) where.push("r.deleted_at IS NULL");
  if (email) { params.push(String(email).toLowerCase()); where.push(`LOWER(r.cardholder_email) = $${params.length}`); }
  if (mine) { params.push(String(mine).toLowerCase()); where.push(`(LOWER(r.filed_by_email) = $${params.length} OR LOWER(r.cardholder_email) = $${params.length})`); }
  if (year) { params.push(Number(year)); where.push(`EXTRACT(YEAR FROM r.spent_on) = $${params.length}`); }
  if (month) { params.push(Number(month)); where.push(`EXTRACT(MONTH FROM r.spent_on) = $${params.length}`); }
  return [where.length ? `WHERE ${where.join(" AND ")}` : "", params];
}

export async function createCardReceipt({ userId = null, email, name, spentOn, amount, merchant = "", purpose, photo, category = "" }) {
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
    `INSERT INTO card_receipts (id, user_id, filed_by_email, filed_by_name, spent_on, amount, merchant, purpose, photo_id, category, cardholder_email, cardholder_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $3, $4) RETURNING *`,
    [
      id,
      userId || null,
      String(email || "").toLowerCase().slice(0, 200),
      String(name || "").slice(0, 120),
      spentOn,
      Math.round(Number(amount) * 100) / 100,
      String(merchant || "").slice(0, 120),
      String(purpose || "").slice(0, 600),
      photoId,
      normalizeReceiptCategory(category)
    ]
  );
  return mapRow({ ...result.rows[0], photo_type: photoId ? (photo.contentType || "image/jpeg") : "" });
}

export async function getCardReceipt(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT r.*, p.content_type AS photo_type FROM card_receipts r LEFT JOIN install_damage_photos p ON p.id = r.photo_id WHERE r.id = $1`, [id]);
  return result.rows[0] ? { ...mapRow(result.rows[0]), photoId: result.rows[0].photo_id } : null;
}

export async function listCardReceipts(filters = {}) {
  const pool = await getReadyPool();
  const [where, params] = buildWhere(filters);
  const result = await pool.query(
    `SELECT r.*, p.content_type AS photo_type FROM card_receipts r LEFT JOIN install_damage_photos p ON p.id = r.photo_id ${where} ORDER BY r.spent_on DESC, r.created_at DESC LIMIT 2000`,
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
      `SELECT cardholder_email AS email, MAX(cardholder_name) AS name, COUNT(*)::int AS count
         FROM card_receipts WHERE deleted_at IS NULL
        GROUP BY cardholder_email ORDER BY MAX(cardholder_name), cardholder_email`
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

// Reviewer correction: amount, date, merchant, purpose, category. The first
// edit records the original amount; every edit stamps who and when.
export async function updateCardReceipt(id, patch = {}, byEmail = "") {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const cur = (await pool.query(`SELECT * FROM card_receipts WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0];
  if (!cur) return null;
  const sets = []; const vals = [id];
  const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  if (patch.amount != null && patch.amount !== "") {
    const amount = Math.round(Number(patch.amount) * 100) / 100;
    if (!Number.isFinite(amount) || Math.abs(amount) > 1000000) throw new Error("Enter a valid amount.");
    if (amount === 0) throw new Error("The amount can't be zero.");
    if (amount !== Number(cur.amount)) { add("amount", amount); if (cur.original_amount == null) add("original_amount", Number(cur.amount)); }
  }
  if (patch.spentOn != null && patch.spentOn !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(patch.spentOn))) throw new Error("Enter a valid date.");
    add("spent_on", String(patch.spentOn));
  }
  if (patch.merchant != null) add("merchant", String(patch.merchant).trim().slice(0, 120));
  if (patch.purpose != null) { const purpose = String(patch.purpose).trim().slice(0, 400); if (!purpose) throw new Error("Purpose can't be blank."); add("purpose", purpose); }
  if (patch.category != null) add("category", normalizeReceiptCategory(patch.category));
  if (patch.note != null) add("edit_note", String(patch.note).trim().slice(0, 300));
  if (!sets.length) return mapRow(cur);
  add("edited_by", String(byEmail || "").trim().toLowerCase().slice(0, 200));
  sets.push("edited_at = NOW()");
  const r = await pool.query(`UPDATE card_receipts SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, vals);
  return r.rows[0] ? mapRow(r.rows[0]) : null;
}

// Reviewer move (Andrew 10/15): put the charge on another person's card.
// Who filed it never changes; the previous cardholder is kept on the row so
// the report can show "moved from X". Moving back to the filer clears the
// borrowed flag but still records the move.
export async function moveCardReceipt(id, { email, name } = {}, byEmail = "", note = "") {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const to = String(email || "").trim().toLowerCase().slice(0, 200);
  if (!to || !to.includes("@")) throw new Error("Pick the cardholder to move this charge to.");
  const pool = await getReadyPool();
  const cur = (await pool.query(`SELECT * FROM card_receipts WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0];
  if (!cur) return null;
  const fromEmail = cur.cardholder_email || cur.filed_by_email;
  const fromName = cur.cardholder_name || cur.filed_by_name;
  if (fromEmail === to) return mapRow(cur);
  const r = await pool.query(
    `UPDATE card_receipts
        SET cardholder_email = $2, cardholder_name = $3,
            moved_at = NOW(), moved_by = $4, moved_from_email = $5, moved_from_name = $6, move_note = $7
      WHERE id = $1 RETURNING *`,
    [id, to, String(name || to).trim().slice(0, 120), String(byEmail || "").trim().toLowerCase().slice(0, 200), fromEmail, fromName, String(note || "").trim().slice(0, 300)]
  );
  return r.rows[0] ? mapRow(r.rows[0]) : null;
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

// Fuel spend between two dates (inclusive), one row per receipt, for the
// service commission board's per-tech quarterly roll-up. Categorized rows
// count when category = 'fuel'; uncategorized rows by keyword.
export async function listFuelReceiptsBetween(from, to) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT id, filed_by_email, filed_by_name, spent_on::text AS spent_on, amount, merchant, purpose, category
       FROM card_receipts
      WHERE deleted_at IS NULL AND spent_on >= $1 AND spent_on <= $2
        AND (category = 'fuel' OR (category = '' AND (merchant || ' ' || purpose) ~* $3))
      ORDER BY spent_on`, [from, to, FUEL_KEYWORDS_SQL]);
  return r.rows.map((x) => ({ id: x.id, email: String(x.filed_by_email || "").toLowerCase(), name: x.filed_by_name || "", spentOn: String(x.spent_on).slice(0, 10), amount: Number(x.amount) || 0, merchant: x.merchant || "", purpose: x.purpose || "", keyword: !x.category }));
}

// CSV for the accountant: one row per receipt, filtered like the report.
export function cardReceiptsCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const catLabel = (k) => RECEIPT_CATEGORIES.find((c) => c.key === k)?.label || "";
  const lines = [["Date", "Cardholder", "Cardholder email", "Filed by", "Filed by email", "Moved from", "Moved by", "Merchant", "Business purpose", "Category", "Amount", "Type", "Attachment", "Filed at", "Receipt id", "Original amount", "Edited by", "Edited at", "Edit note"].join(",")];
  for (const r of rows) {
    lines.push([r.spentOn, r.cardholderName, r.cardholderEmail, r.filedByName, r.filedByEmail, r.movedAt ? (r.movedFromName || r.movedFromEmail) : "", r.movedBy || "", r.merchant, r.purpose, catLabel(r.effectiveCategory || r.category) + (!r.category && r.effectiveCategory ? " (by keyword)" : ""), r.amount.toFixed(2), r.amount < 0 ? "return/credit" : "purchase", r.hasPhoto ? (r.isPdf ? "pdf" : "photo") : "no", r.createdAt || "", r.id, r.originalAmount != null && r.originalAmount !== r.amount ? r.originalAmount.toFixed(2) : "", r.editedBy || "", r.editedAt ? String(r.editedAt).slice(0, 19).replace("T", " ") : "", r.editNote || ""].map(esc).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Online shop promo codes (Andrew 10/6).
//  - shop_promo_codes: one row per code. Managed on the Online Shop Orders
//    page: what it does (percent off appliances, dollars off appliances, or
//    free delivery), a minimum appliance subtotal, a redemption cap, a
//    per-shopper cap, an optional date window and an on/off switch.
//  - shop_promo_redemptions: one row per order that used a code. A row is
//    "live" until the order is canceled (released_at set), so a canceled
//    order hands its redemption back to the pool.
// The storefront only ever receives the code's label and math - never the
// limits or the redemption counts.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shop_promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'amount', 'free_delivery')),
  value NUMERIC(10,2) NOT NULL DEFAULT 0,
  min_subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_redemptions INTEGER,
  per_shopper INTEGER NOT NULL DEFAULT 1,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS shop_promo_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id UUID NOT NULL REFERENCES shop_promo_codes(id) ON DELETE CASCADE,
  order_id UUID,
  order_number TEXT NOT NULL DEFAULT '',
  shopper_id UUID,
  discount NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS shop_promo_redemptions_promo_idx ON shop_promo_redemptions (promo_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS shop_promo_redemptions_order_idx ON shop_promo_redemptions (order_id);
`;

let schemaDone = null;
async function promoPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!schemaDone) schemaDone = pool.query(SCHEMA_SQL).catch((e) => { schemaDone = null; throw e; });
  await schemaDone;
  return pool;
}

export const PROMO_KINDS = ["percent", "amount", "free_delivery"];
export const PROMO_KIND_LABELS = { percent: "% off appliances", amount: "$ off appliances", free_delivery: "Free delivery" };

// Codes are letters/digits/dashes, stored upper-case; shoppers can type them
// in any case with stray spaces.
export const normalizePromoCode = (v) => String(v || "").toUpperCase().replace(/\s+/g, "").replace(/[^0-9A-Z-]/g, "").slice(0, 32);

const num = (v) => (v === "" || v == null ? null : Number(v));
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

function mapPromo(row, used = 0) {
  const usedN = Number(used) || 0;
  const max = row.max_redemptions == null ? null : Number(row.max_redemptions);
  return {
    id: row.id,
    code: row.code,
    description: row.description || "",
    kind: row.kind,
    value: money(row.value),
    minSubtotal: money(row.min_subtotal),
    maxRedemptions: max,
    perShopper: Number(row.per_shopper) || 0,
    startsAt: row.starts_at?.toISOString?.() || null,
    endsAt: row.ends_at?.toISOString?.() || null,
    active: Boolean(row.active),
    notes: row.notes || "",
    used: usedN,
    remaining: max == null ? null : Math.max(0, max - usedN),
    createdBy: row.created_by || "",
    createdAt: row.created_at?.toISOString?.() || null,
    updatedBy: row.updated_by || "",
    updatedAt: row.updated_at?.toISOString?.() || null
  };
}

// What the shopper sees once a code is accepted - the math and the label,
// nothing about limits or usage.
export function publicPromo(p) {
  return { code: p.code, description: p.description, kind: p.kind, value: p.value, minSubtotal: p.minSubtotal };
}

function validateFields(b, { partial = false } = {}) {
  const out = {};
  if (!partial || b.code !== undefined) {
    const code = normalizePromoCode(b.code);
    if (code.length < 3) throw new Error("Code needs at least 3 letters or digits.");
    out.code = code;
  }
  if (!partial || b.kind !== undefined) {
    const kind = String(b.kind || "").trim();
    if (!PROMO_KINDS.includes(kind)) throw new Error("Pick what the code does.");
    out.kind = kind;
  }
  const kind = out.kind;
  if (!partial || b.value !== undefined || kind) {
    const value = num(b.value);
    if (kind === "percent") {
      if (!(value > 0 && value <= 100)) throw new Error("Percent off must be between 1 and 100.");
    } else if (kind === "amount") {
      if (!(value > 0 && value <= 100000)) throw new Error("Dollars off must be more than $0.");
    }
    out.value = kind === "free_delivery" ? 0 : money(value);
  }
  if (!partial || b.description !== undefined) out.description = String(b.description || "").trim().slice(0, 80);
  if (!partial || b.minSubtotal !== undefined) {
    const v = num(b.minSubtotal) ?? 0;
    if (!(v >= 0 && v <= 1000000)) throw new Error("Minimum appliance subtotal can't be negative.");
    out.minSubtotal = money(v);
  }
  if (!partial || b.maxRedemptions !== undefined) {
    const v = num(b.maxRedemptions);
    if (v != null && !(Number.isInteger(v) && v >= 1 && v <= 1000000)) throw new Error("Redemption limit must be a whole number (blank = unlimited).");
    out.maxRedemptions = v;
  }
  if (!partial || b.perShopper !== undefined) {
    const v = num(b.perShopper) ?? 1;
    if (!(Number.isInteger(v) && v >= 0 && v <= 1000)) throw new Error("Per-customer limit must be a whole number (0 = unlimited).");
    out.perShopper = v;
  }
  for (const [k, col] of [["startsAt", "startsAt"], ["endsAt", "endsAt"]]) {
    if (!partial || b[k] !== undefined) {
      const raw = String(b[k] || "").trim();
      if (!raw) { out[col] = null; continue; }
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw new Error(`${k === "startsAt" ? "Start" : "End"} date isn't valid.`);
      out[col] = d;
    }
  }
  if (out.startsAt && out.endsAt && out.endsAt <= out.startsAt) throw new Error("End date must be after the start date.");
  if (!partial || b.active !== undefined) out.active = b.active === undefined ? true : Boolean(b.active);
  if (!partial || b.notes !== undefined) out.notes = String(b.notes || "").trim().slice(0, 300);
  return out;
}

const USED_SQL = `(SELECT COUNT(*) FROM shop_promo_redemptions r WHERE r.promo_id = p.id AND r.released_at IS NULL) AS used`;

export async function listShopPromoCodes() {
  const pool = await promoPool();
  const rows = (await pool.query(`SELECT p.*, ${USED_SQL} FROM shop_promo_codes p ORDER BY p.active DESC, p.created_at DESC`)).rows;
  return rows.map((r) => mapPromo(r, r.used));
}

export async function getShopPromoCode(id) {
  const pool = await promoPool();
  const r = (await pool.query(`SELECT p.*, ${USED_SQL} FROM shop_promo_codes p WHERE p.id = $1`, [id])).rows[0];
  return r ? mapPromo(r, r.used) : null;
}

export async function findShopPromoByCode(code) {
  const c = normalizePromoCode(code);
  if (!c) return null;
  const pool = await promoPool();
  const r = (await pool.query(`SELECT p.*, ${USED_SQL} FROM shop_promo_codes p WHERE p.code = $1`, [c])).rows[0];
  return r ? mapPromo(r, r.used) : null;
}

export async function createShopPromoCode(body, byEmail = "") {
  const f = validateFields(body || {});
  const pool = await promoPool();
  try {
    const r = await pool.query(
      `INSERT INTO shop_promo_codes (code, description, kind, value, min_subtotal, max_redemptions, per_shopper, starts_at, ends_at, active, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING *`,
      [f.code, f.description, f.kind, f.value, f.minSubtotal, f.maxRedemptions, f.perShopper, f.startsAt, f.endsAt, f.active, f.notes, String(byEmail || "").toLowerCase().slice(0, 200)]
    );
    return mapPromo(r.rows[0], 0);
  } catch (err) {
    if (err.code === "23505") throw new Error(`${f.code} already exists.`);
    throw err;
  }
}

const COLS = { code: "code", description: "description", kind: "kind", value: "value", minSubtotal: "min_subtotal", maxRedemptions: "max_redemptions", perShopper: "per_shopper", startsAt: "starts_at", endsAt: "ends_at", active: "active", notes: "notes" };

export async function updateShopPromoCode(id, body, byEmail = "") {
  const pool = await promoPool();
  const current = await getShopPromoCode(id);
  if (!current) throw new Error("That promo code no longer exists.");
  // Validate the merged record so a kind change re-checks the value.
  const merged = validateFields({ ...current, ...(body || {}), value: body?.value !== undefined ? body.value : current.value }, { partial: false });
  const sets = [], vals = [];
  for (const [k, col] of Object.entries(COLS)) {
    if (body?.[k] === undefined && !(k === "value" && body?.kind !== undefined)) continue;
    vals.push(merged[k]); sets.push(`${col} = $${vals.length}`);
  }
  if (!sets.length) return current;
  vals.push(String(byEmail || "").toLowerCase().slice(0, 200)); sets.push(`updated_by = $${vals.length}`, `updated_at = NOW()`);
  vals.push(id);
  try {
    await pool.query(`UPDATE shop_promo_codes SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
  } catch (err) {
    if (err.code === "23505") throw new Error(`${merged.code} already exists.`);
    throw err;
  }
  return getShopPromoCode(id);
}

// A code that has been used stays (its redemptions are history on the
// orders); pause it instead. Unused codes can go.
export async function deleteShopPromoCode(id) {
  const pool = await promoPool();
  const used = (await pool.query(`SELECT COUNT(*)::int AS n FROM shop_promo_redemptions WHERE promo_id = $1`, [id])).rows[0]?.n || 0;
  if (used > 0) throw new Error("This code has been used on orders - pause it instead of deleting it.");
  return (await pool.query(`DELETE FROM shop_promo_codes WHERE id = $1`, [id])).rowCount > 0;
}

export async function countShopperPromoRedemptions({ promoId, shopperId }) {
  if (!shopperId) return 0;
  const pool = await promoPool();
  return (await pool.query(`SELECT COUNT(*)::int AS n FROM shop_promo_redemptions WHERE promo_id = $1 AND shopper_id = $2 AND released_at IS NULL`, [promoId, shopperId])).rows[0]?.n || 0;
}

// Why a code can't be used right now, or "" when it can. Pure - the caller
// supplies the counts so it can be reused by the public check and the
// final submit.
export function promoBlockReason(promo, { subtotal = 0, shopperUses = 0, pickup = false, now = new Date() } = {}) {
  if (!promo) return "That code isn't valid.";
  if (!promo.active) return "That code isn't active right now.";
  if (promo.startsAt && new Date(promo.startsAt) > now) return "That code isn't active yet.";
  if (promo.endsAt && new Date(promo.endsAt) < now) return "That code has expired.";
  if (promo.maxRedemptions != null && promo.used >= promo.maxRedemptions) return "That code has reached its redemption limit.";
  if (promo.perShopper > 0 && shopperUses >= promo.perShopper) return promo.perShopper === 1 ? "You've already used that code." : "You've used that code the maximum number of times.";
  if (promo.minSubtotal > 0 && subtotal < promo.minSubtotal) return `That code needs at least $${promo.minSubtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} in appliances.`;
  if (promo.kind === "free_delivery" && pickup) return "That code is for delivery orders - it doesn't apply to customer pickup.";
  return "";
}

// Dollar value of the discount for a cart. Percent/amount come off the
// appliance subtotal (never add-ons or delivery); free_delivery removes the
// delivery fee. Never more than what it discounts.
export function promoDiscount(promo, { itemsTotal = 0, deliveryPrice = 0 } = {}) {
  if (!promo) return 0;
  if (promo.kind === "percent") return money(Math.min(itemsTotal, itemsTotal * promo.value / 100));
  if (promo.kind === "amount") return money(Math.min(itemsTotal, promo.value));
  if (promo.kind === "free_delivery") return money(deliveryPrice);
  return 0;
}

export async function recordShopPromoRedemption({ promoId, orderId, orderNumber, shopperId, discount }) {
  const pool = await promoPool();
  await pool.query(
    `INSERT INTO shop_promo_redemptions (promo_id, order_id, order_number, shopper_id, discount) VALUES ($1, $2, $3, $4, $5)`,
    [promoId, orderId || null, String(orderNumber || "").slice(0, 40), shopperId || null, money(discount)]
  );
}

// Canceled order -> its redemption goes back to the pool.
export async function releaseShopPromoRedemptions({ orderId }) {
  if (!orderId) return 0;
  const pool = await promoPool();
  return (await pool.query(`UPDATE shop_promo_redemptions SET released_at = NOW() WHERE order_id = $1 AND released_at IS NULL`, [orderId])).rowCount;
}

// Recent redemptions for the admin table's detail line.
export async function listShopPromoRedemptions(promoId, limit = 50) {
  const pool = await promoPool();
  const rows = (await pool.query(
    `SELECT order_number, discount, created_at, released_at FROM shop_promo_redemptions WHERE promo_id = $1 ORDER BY created_at DESC LIMIT $2`, [promoId, limit])).rows;
  return rows.map((r) => ({ orderNumber: r.order_number, discount: money(r.discount), at: r.created_at?.toISOString?.() || null, released: Boolean(r.released_at) }));
}

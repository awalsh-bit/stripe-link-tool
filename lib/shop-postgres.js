import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";
// Same scrypt scheme the internal tools use for staff passwords.
import { hashPassword, verifyPassword } from "./users-postgres.js";

// ---------------------------------------------------------------------------
// Online clearance shop (shop.wilsonappliance.com).
//  - shop_shoppers: the sign-up wall that unlocks MAP-protected pricing.
//    A shopper row + opaque token is created after the ZIP gate; the token
//    authorizes price display and checkout for that browser.
//  - shop_orders: submitted web orders (card saved via SetupIntent, never
//    charged online). The sales team claims an order and finishes it as an
//    ePASS ticket; serialized units are web-locked on the Clearance Hit List
//    the moment the order lands (see clearance-postgres markWebLock).
//  - shop_inventory_snapshot: singleton holding the serial set from the
//    latest ePASS ExportModel upload; the storefront only lists clearance
//    units whose serial is still present.
// ---------------------------------------------------------------------------

const SHOP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shop_shoppers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  preferred_contact TEXT NOT NULL DEFAULT '',
  address_line1 TEXT NOT NULL,
  address_line2 TEXT NOT NULL DEFAULT '',
  address_city TEXT NOT NULL,
  address_state TEXT NOT NULL DEFAULT 'TX',
  address_zip TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE shop_shoppers ADD COLUMN IF NOT EXISTS client_code TEXT UNIQUE;
ALTER TABLE shop_shoppers ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_shoppers ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT NOT NULL DEFAULT '';
UPDATE shop_shoppers SET client_code = REPLACE(client_code, '-', '') WHERE client_code LIKE 'W-%';
CREATE INDEX IF NOT EXISTS shop_shoppers_stripe_idx ON shop_shoppers (stripe_customer_id);

CREATE SEQUENCE IF NOT EXISTS shop_order_number_seq START 1001;

CREATE TABLE IF NOT EXISTS shop_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  shopper_id UUID,
  customer JSONB NOT NULL,
  items JSONB NOT NULL,
  addons JSONB NOT NULL DEFAULT '[]',
  delivery JSONB NOT NULL DEFAULT '{}',
  totals JSONB NOT NULL DEFAULT '{}',
  lock_conflicts JSONB NOT NULL DEFAULT '[]',
  stripe_customer_id TEXT NOT NULL DEFAULT '',
  setup_intent_id TEXT NOT NULL DEFAULT '',
  card_summary JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  claimed_by_email TEXT NOT NULL DEFAULT '',
  claimed_by_name TEXT NOT NULL DEFAULT '',
  claimed_at TIMESTAMPTZ,
  epass_ticket TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shop_orders_status_idx ON shop_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_inventory_snapshot (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  serials JSONB NOT NULL DEFAULT '[]',
  source_file TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE shop_inventory_snapshot ADD COLUMN IF NOT EXISTS serial_types JSONB NOT NULL DEFAULT '{}';
ALTER TABLE shop_inventory_snapshot ADD COLUMN IF NOT EXISTS serial_written JSONB NOT NULL DEFAULT '{}';
ALTER TABLE shop_inventory_snapshot ADD COLUMN IF NOT EXISTS serial_units JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS shop_map_prices (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  prices JSONB NOT NULL DEFAULT '{}',
  source_url TEXT NOT NULL DEFAULT '',
  source_note TEXT NOT NULL DEFAULT '',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_express_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cutoff_hour INT NOT NULL DEFAULT 11,
  products JSONB NOT NULL DEFAULT '[]',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(SHOP_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

// ---- Shoppers -------------------------------------------------------------

// Client codes skip the sign-up form on a return visit: the shopper reads
// their code off the confirmation screen and later restores the profile with
// code + phone number. Unambiguous alphabet (no 0/O/1/I/L) — easy to read
// back over the phone too.
const CLIENT_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateClientCode() {
  let code = "W";
  const bytes = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) {
    code += CLIENT_CODE_ALPHABET[bytes[i] % CLIENT_CODE_ALPHABET.length];
  }
  return code;
}

// Accepts any spelling a client reads back — "WDRP2K", "W-DRP2K", lowercase,
// with or without the W — and canonicalizes to the hyphen-less form.
export function normalizeClientCode(raw) {
  const cleaned = String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const body = cleaned.startsWith("W") && cleaned.length === 6 ? cleaned.slice(1) : cleaned;
  return body.length === 5 ? "W" + body : null;
}

export function phoneDigits(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function mapShopper(row) {
  return {
    id: row.id,
    token: row.token,
    clientCode: row.client_code || null,
    hasPassword: Boolean(row.password_hash),
    stripeCustomerId: row.stripe_customer_id || "",
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    preferredContact: row.preferred_contact,
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.address_city,
      state: row.address_state,
      zip: row.address_zip
    },
    createdAt: row.created_at?.toISOString?.() || null
  };
}

export async function createShopper({ firstName, lastName, email, phone, preferredContact, address }) {
  const pool = await getReadyPool();
  const token = crypto.randomBytes(24).toString("base64url");
  const params = [
    token,
    String(firstName || "").trim().slice(0, 80),
    String(lastName || "").trim().slice(0, 80),
    String(email || "").trim().toLowerCase().slice(0, 200),
    String(phone || "").trim().slice(0, 40),
    String(preferredContact || "").trim().slice(0, 30),
    String(address?.line1 || "").trim().slice(0, 200),
    String(address?.line2 || "").trim().slice(0, 200),
    String(address?.city || "").trim().slice(0, 100),
    String(address?.state || "TX").trim().slice(0, 30),
    String(address?.zip || "").trim().slice(0, 12)
  ];
  // Retry on the (astronomically rare) client-code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await pool.query(
        `INSERT INTO shop_shoppers
           (token, first_name, last_name, email, phone, preferred_contact,
            address_line1, address_line2, address_city, address_state, address_zip, client_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [...params, generateClientCode()]
      );
      return mapShopper(result.rows[0]);
    } catch (err) {
      if (err?.code === "23505" && String(err.constraint || "").includes("client_code")) continue;
      throw err;
    }
  }
  throw new Error("Couldn't generate a client code.");
}

// Return-visit lookup: client code + matching phone number restores the
// profile (and its pricing token) without retyping the form. The code is
// the shared secret; the phone must corroborate it.
export async function findShopperByCodeAndPhone({ clientCode, phone }) {
  const code = normalizeClientCode(clientCode);
  const digits = phoneDigits(phone);
  if (!code || digits.length < 7) return null;
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM shop_shoppers WHERE client_code = $1`, [code]);
  const row = result.rows[0];
  if (!row) return null;
  if (phoneDigits(row.phone) !== digits) return null;
  pool.query(`UPDATE shop_shoppers SET last_seen_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});
  return mapShopper(row);
}

// Recovery + duplicate guard: match an existing profile by phone digits
// (last 10) AND last name. Together those two facts already equal profile
// access here (they'd unlock the code, and code+phone restores the profile),
// so revealing the code to someone who has both grants nothing extra —
// the public route is still throttled per IP. Newest match wins.
// Step 1 of the simplified unlock flow: does ANY profile exist for this
// phone? Reveals only yes/no (no names), behind the same per-IP throttle
// as the other lookup routes.
export async function shopperExistsByPhone(phone) {
  const digits = phoneDigits(phone);
  if (digits.length < 10) return false;
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT 1 FROM shop_shoppers
     WHERE RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = RIGHT($1, 10)
     LIMIT 1`,
    [digits]
  );
  return result.rows.length > 0;
}

export async function findShopperByPhoneAndLastName({ phone, lastName }) {
  const digits = phoneDigits(phone);
  const last = String(lastName || "").trim().toLowerCase();
  if (digits.length < 7 || !last) return null;
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM shop_shoppers
     WHERE RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = RIGHT($1, 10)
       AND LOWER(TRIM(last_name)) = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [digits, last]
  );
  const row = result.rows[0];
  if (!row) return null;
  return mapShopper(await ensureClientCode(pool, row));
}

// Profiles created before the client-code column existed have none —
// assign one the next time the row is touched, so the code is always there.
async function ensureClientCode(pool, row) {
  if (row.client_code) return row;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateClientCode();
    try {
      const result = await pool.query(
        `UPDATE shop_shoppers SET client_code = $2 WHERE id = $1 AND client_code IS NULL RETURNING *`,
        [row.id, code]
      );
      return result.rows[0] || row;
    } catch (err) {
      if (err?.code === "23505") continue;
      throw err;
    }
  }
  return row;
}

export async function getShopperByToken(token) {
  const raw = String(token || "").trim();
  if (!raw || raw.length > 64) return null;
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM shop_shoppers WHERE token = $1`, [raw]);
  if (!result.rows[0]) return null;
  const row = await ensureClientCode(pool, result.rows[0]);
  pool.query(`UPDATE shop_shoppers SET last_seen_at = NOW() WHERE token = $1`, [raw]).catch(() => {});
  return mapShopper(row);
}

export async function getShopperById(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM shop_shoppers WHERE id = $1`, [id]);
  if (!result.rows[0]) return null;
  return mapShopper(await ensureClientCode(pool, result.rows[0]));
}

// Staff-side search for the Shopper Profiles page: name, email, client
// code, or phone digits. Empty search → the 200 newest profiles (the page
// is a spreadsheet-style table, so a deep default list is useful there).
export async function searchShopShoppers(search) {
  const pool = await getReadyPool();
  const raw = String(search || "").trim();
  let result;
  if (!raw) {
    result = await pool.query(`SELECT * FROM shop_shoppers ORDER BY created_at DESC LIMIT 200`);
  } else {
    const like = "%" + raw.replace(/[%_]/g, "") + "%";
    const digits = phoneDigits(raw);
    result = await pool.query(
      `SELECT * FROM shop_shoppers
       WHERE (first_name || ' ' || last_name) ILIKE $1
          OR email ILIKE $1
          OR COALESCE(client_code, '') ILIKE $1
          OR ($2 <> '' AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%' || $2 || '%')
       ORDER BY created_at DESC
       LIMIT 200`,
      [like, digits.length >= 4 ? digits : ""]
    );
  }
  const rows = [];
  for (const row of result.rows) rows.push(mapShopper(await ensureClientCode(pool, row)));
  return rows;
}

// Optional shopper password (guest checkout stays fine without one).
export async function setShopperPassword({ token, password }) {
  const raw = String(password || "");
  if (raw.length < 8) throw new Error("Passwords need at least 8 characters.");
  const shopper = await getShopperByToken(token);
  if (!shopper) return null;
  const pool = await getReadyPool();
  const passwordHash = await hashPassword(raw);
  await pool.query(`UPDATE shop_shoppers SET password_hash = $2 WHERE id = $1`, [shopper.id, passwordHash]);
  return { ...shopper, hasPassword: true };
}

// Staff reset: sets a fresh temporary password and returns it in plain
// text ONCE so the rep can read it to the client (who can change it in
// their profile afterwards).
export async function setShopperTempPassword({ id }) {
  const shopper = await getShopperById(id);
  if (!shopper) return null;
  let temp = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) temp += CLIENT_CODE_ALPHABET[bytes[i] % CLIENT_CODE_ALPHABET.length];
  temp = temp.slice(0, 4).toLowerCase() + "-" + temp.slice(4);
  const pool = await getReadyPool();
  const passwordHash = await hashPassword(temp);
  await pool.query(`UPDATE shop_shoppers SET password_hash = $2 WHERE id = $1`, [id, passwordHash]);
  return { tempPassword: temp, shopper };
}

// Phone + password sign-in. Phones aren't unique (households, re-registers),
// so every password-bearing profile on that number gets a verify attempt,
// newest first.
export async function verifyShopperLogin({ phone, password }) {
  const digits = phoneDigits(phone);
  if (digits.length < 7 || !password) return null;
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM shop_shoppers
     WHERE password_hash <> ''
       AND RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [digits]
  );
  for (const row of result.rows) {
    if (await verifyPassword(String(password), row.password_hash)) {
      pool.query(`UPDATE shop_shoppers SET last_seen_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});
      return mapShopper(await ensureClientCode(pool, row));
    }
  }
  return null;
}

// Profile edits — from the storefront's account panel (by token) or the
// dashboard's shopper admin (by id). The routes validate field contents
// (including the delivery-ZIP gate) before calling these.
export async function updateShopperProfile({ token, ...fields }) {
  const shopper = await getShopperByToken(token);
  if (!shopper) return null;
  return updateShopperProfileById({ id: shopper.id, ...fields });
}

export async function updateShopperProfileById({ id, firstName, lastName, email, phone, preferredContact, address }) {
  const shopper = { id };
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE shop_shoppers SET
       first_name = $2, last_name = $3, email = $4, phone = $5, preferred_contact = $6,
       address_line1 = $7, address_line2 = $8, address_city = $9, address_state = $10, address_zip = $11
     WHERE id = $1
     RETURNING *`,
    [
      shopper.id,
      String(firstName || "").trim().slice(0, 80),
      String(lastName || "").trim().slice(0, 80),
      String(email || "").trim().toLowerCase().slice(0, 200),
      String(phone || "").trim().slice(0, 40),
      String(preferredContact || "").trim().slice(0, 30),
      String(address?.line1 || "").trim().slice(0, 200),
      String(address?.line2 || "").trim().slice(0, 200),
      String(address?.city || "").trim().slice(0, 100),
      String(address?.state || "TX").trim().slice(0, 30),
      String(address?.zip || "").trim().slice(0, 12)
    ]
  );
  return result.rows[0] ? mapShopper(result.rows[0]) : null;
}

export async function deleteShopper(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`DELETE FROM shop_shoppers WHERE id = $1 RETURNING id`, [id]);
  return result.rowCount > 0;
}

export async function setShopperStripeCustomerId({ id, stripeCustomerId }) {
  const pool = await getReadyPool();
  await pool.query(
    `UPDATE shop_shoppers SET stripe_customer_id = $2 WHERE id = $1`,
    [id, String(stripeCustomerId || "").slice(0, 80)]
  );
}

// One pass of the Stripe-customer import. Takes a plain customer-shaped
// object ({id, name, email, phone, shipping, address, metadata}) and either:
//  - skips it (already linked / no usable contact info),
//  - links it to an existing shopper matched by phone digits or email, or
//  - creates a new shopper profile (client code included) carrying whatever
//    contact details Stripe has.
// Returns { outcome: "linked"|"created"|"already"|"skipped", shopperId? }.
export async function importStripeCustomerRecord(customer) {
  const stripeId = String(customer?.id || "").trim();
  if (!stripeId.startsWith("cus_")) return { outcome: "skipped", reason: "not a customer" };
  const pool = await getReadyPool();

  const already = await pool.query(`SELECT id FROM shop_shoppers WHERE stripe_customer_id = $1`, [stripeId]);
  if (already.rows[0]) return { outcome: "already", shopperId: already.rows[0].id };

  const name = String(customer?.name || customer?.shipping?.name || "").trim();
  const email = String(customer?.email || "").trim().toLowerCase();
  const phone = String(customer?.phone || customer?.shipping?.phone || "").trim();
  const digits = phoneDigits(phone);
  if (!email && digits.length < 7) return { outcome: "skipped", reason: "no contact info" };

  // Match an existing shopper by phone digits, then email.
  let match = null;
  if (digits.length >= 7) {
    const byPhone = await pool.query(
      `SELECT * FROM shop_shoppers
       WHERE RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1
       ORDER BY created_at ASC LIMIT 1`,
      [digits]
    );
    match = byPhone.rows[0] || null;
  }
  if (!match && email) {
    const byEmail = await pool.query(
      `SELECT * FROM shop_shoppers WHERE email = $1 ORDER BY created_at ASC LIMIT 1`,
      [email]
    );
    match = byEmail.rows[0] || null;
  }
  if (match) {
    if (!match.stripe_customer_id) {
      await pool.query(`UPDATE shop_shoppers SET stripe_customer_id = $2 WHERE id = $1`, [match.id, stripeId]);
      return { outcome: "linked", shopperId: match.id };
    }
    return { outcome: "already", shopperId: match.id };
  }

  // New profile from whatever Stripe knows.
  const addr = customer?.shipping?.address || customer?.address || {};
  const nameParts = name.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || (email ? email.split("@")[0] : "Stripe");
  const lastName = nameParts.slice(1).join(" ") || (nameParts.length ? "" : "Customer");
  const shopper = await createShopper({
    firstName,
    lastName: lastName || "—",
    email,
    phone,
    preferredContact: email && digits.length < 7 ? "Email" : "Call",
    address: {
      line1: String(addr.line1 || "").trim(),
      line2: String(addr.line2 || "").trim(),
      city: String(addr.city || "").trim(),
      state: String(addr.state || "TX").trim(),
      zip: String(addr.postal_code || "").trim()
    }
  });
  await pool.query(`UPDATE shop_shoppers SET stripe_customer_id = $2 WHERE id = $1`, [shopper.id, stripeId]);
  return { outcome: "created", shopperId: shopper.id };
}

// ---- Orders ---------------------------------------------------------------

function mapOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    shopperId: row.shopper_id,
    customer: row.customer || {},
    items: row.items || [],
    addons: row.addons || [],
    delivery: row.delivery || {},
    totals: row.totals || {},
    lockConflicts: row.lock_conflicts || [],
    stripeCustomerId: row.stripe_customer_id,
    setupIntentId: row.setup_intent_id,
    cardSummary: row.card_summary || {},
    status: row.status,
    claimedByEmail: row.claimed_by_email,
    claimedByName: row.claimed_by_name,
    claimedAt: row.claimed_at?.toISOString?.() || null,
    epassTicket: row.epass_ticket,
    completedAt: row.completed_at?.toISOString?.() || null,
    canceledAt: row.canceled_at?.toISOString?.() || null,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at?.toISOString?.() || null
  };
}

export async function createShopOrder({
  shopperId, customer, items, addons, delivery, totals,
  lockConflicts, stripeCustomerId, setupIntentId, cardSummary
}) {
  const pool = await getReadyPool();
  const seq = await pool.query(`SELECT nextval('shop_order_number_seq') AS n`);
  const orderNumber = `WEB-${seq.rows[0].n}`;
  const result = await pool.query(
    `INSERT INTO shop_orders
       (order_number, shopper_id, customer, items, addons, delivery, totals,
        lock_conflicts, stripe_customer_id, setup_intent_id, card_summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      orderNumber,
      shopperId || null,
      JSON.stringify(customer || {}),
      JSON.stringify(items || []),
      JSON.stringify(addons || []),
      JSON.stringify(delivery || {}),
      JSON.stringify(totals || {}),
      JSON.stringify(lockConflicts || []),
      String(stripeCustomerId || ""),
      String(setupIntentId || ""),
      JSON.stringify(cardSummary || {})
    ]
  );
  return mapOrder(result.rows[0]);
}

export async function listShopOrders() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM shop_orders ORDER BY created_at DESC LIMIT 500`);
  return result.rows.map(mapOrder);
}

export async function getShopOrder(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM shop_orders WHERE id = $1`, [id]);
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

// Claim is first-writer-wins so two salespeople can't both grab an order.
export async function claimShopOrder({ id, byEmail, byName }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE shop_orders
     SET status = 'claimed', claimed_by_email = $2, claimed_by_name = $3, claimed_at = NOW()
     WHERE id = $1 AND status = 'new'
     RETURNING *`,
    [id, String(byEmail || "").toLowerCase(), String(byName || "")]
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

// Claimed too fast, phone rang — put it back in the pool. Only claimed
// orders unclaim; the route checks who's allowed.
export async function unclaimShopOrder({ id }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE shop_orders
     SET status = 'new', claimed_by_email = '', claimed_by_name = '', claimed_at = NULL
     WHERE id = $1 AND status = 'claimed'
     RETURNING *`,
    [id]
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function completeShopOrder({ id, epassTicket }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE shop_orders
     SET status = 'completed', epass_ticket = $2, completed_at = NOW()
     WHERE id = $1 AND status IN ('new', 'claimed')
     RETURNING *`,
    [id, String(epassTicket || "").trim().slice(0, 60)]
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function cancelShopOrder({ id, reason }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE shop_orders
     SET status = 'canceled', cancel_reason = $2, canceled_at = NOW()
     WHERE id = $1 AND status IN ('new', 'claimed')
     RETURNING *`,
    [id, String(reason || "").trim().slice(0, 300)]
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function updateShopOrderLockConflicts({ id, lockConflicts }) {
  const pool = await getReadyPool();
  await pool.query(
    `UPDATE shop_orders SET lock_conflicts = $2 WHERE id = $1`,
    [id, JSON.stringify(lockConflicts || [])]
  );
}

export async function updateShopOrderCardSummary({ id, cardSummary }) {
  const pool = await getReadyPool();
  await pool.query(
    `UPDATE shop_orders SET card_summary = $2 WHERE id = $1`,
    [id, JSON.stringify(cardSummary || {})]
  );
}

// ---- Inventory snapshot ---------------------------------------------------

// Snapshot entries are keyed "MODELKEY|SERIAL" (normalized model or SKU +
// serial) because ePASS accessory pseudo-serials like "00001" repeat across
// models — serial alone would cross-match unrelated products.
//  - `types`: { key: "ALL"|"OPEN"|"DISPLAY"|... } from the Serial Type column
//  - `written`: { key: "S00063335" } from the Written To column — units
//    already written to a sales order must never sell on the site.
// Older exports without those columns still refresh availability.
export async function saveShopInventorySnapshot({ serials, types, written, units, sourceFile, uploadedBy }) {
  const pool = await getReadyPool();
  const clean = [...new Set((serials || [])
    .map((s) => String(s || "").trim().toUpperCase())
    .filter((s) => s && s.length <= 120))];
  const cleanTypes = {};
  for (const [rawKey, rawType] of Object.entries(types || {})) {
    const key = String(rawKey || "").trim().toUpperCase();
    const type = String(rawType || "").trim().toUpperCase().slice(0, 20);
    if (key && key.length <= 120 && type) cleanTypes[key] = type;
  }
  const cleanWritten = {};
  for (const [rawKey, rawOrder] of Object.entries(written || {})) {
    const key = String(rawKey || "").trim().toUpperCase();
    const order = String(rawOrder || "").trim().slice(0, 40);
    if (key && key.length <= 120 && order) cleanWritten[key] = order;
  }
  // Per-unit detail rows for the Aging Inventory report (serial, model,
  // received date, written-to ticket, cost). Bounded and sanitized.
  const cleanUnits = (Array.isArray(units) ? units : []).slice(0, 30000).map((u) => ({
    serial: String(u?.serial || "").trim().toUpperCase().slice(0, 60),
    model: String(u?.model || "").trim().slice(0, 80),
    sku: String(u?.sku || "").trim().slice(0, 80),
    brand: String(u?.brand || "").trim().slice(0, 60),
    description: String(u?.description || "").trim().slice(0, 160),
    prod: String(u?.prod || "").trim().slice(0, 30),
    serialType: String(u?.serialType || "").trim().toUpperCase().slice(0, 20),
    writtenTo: String(u?.writtenTo || "").trim().slice(0, 40),
    received: /^\d{4}-\d{2}-\d{2}/.test(String(u?.received || "")) ? String(u.received).slice(0, 10) : "",
    cost: Number.isFinite(Number(u?.cost)) ? Math.round(Number(u.cost) * 100) / 100 : 0,
    list: Number.isFinite(Number(u?.list)) ? Math.round(Number(u.list) * 100) / 100 : 0
  })).filter((u) => u.serial);

  await pool.query(
    `INSERT INTO shop_inventory_snapshot (id, serials, serial_types, serial_written, serial_units, source_file, uploaded_by, uploaded_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET
       serials = EXCLUDED.serials,
       serial_types = EXCLUDED.serial_types,
       serial_written = EXCLUDED.serial_written,
       serial_units = EXCLUDED.serial_units,
       source_file = EXCLUDED.source_file,
       uploaded_by = EXCLUDED.uploaded_by,
       uploaded_at = NOW()`,
    [JSON.stringify(clean), JSON.stringify(cleanTypes), JSON.stringify(cleanWritten), JSON.stringify(cleanUnits), String(sourceFile || "").slice(0, 200), String(uploadedBy || "").toLowerCase()]
  );
  return { count: clean.length, typedCount: Object.keys(cleanTypes).length, writtenCount: Object.keys(cleanWritten).length, unitDetailCount: cleanUnits.length };
}

export async function getShopInventorySnapshot() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM shop_inventory_snapshot WHERE id = 1`);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    serials: row.serials || [],
    serialTypes: row.serial_types || {},
    serialWritten: row.serial_written || {},
    serialUnits: row.serial_units || [],
    sourceFile: row.source_file,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at?.toISOString?.() || null
  };
}

// ---------------------------------------------------------------------------
// MAP / UMRP floor prices — singleton like the inventory snapshot. Refreshed
// overnight from the published price spreadsheet (SHOP_MAP_PRICE_URL) and
// fully replaced on each fetch. Keys are normalized model keys
// (uppercase, alphanumerics only); values are the floor price in dollars.
// A clearance unit only shows a public (no-profile) price when its brand +
// category is whitelisted in data/shop-map-policy.json AND its price is at
// or above this floor — no floor entry means it stays behind the gate.
// ---------------------------------------------------------------------------

export async function saveShopMapPrices({ prices, sourceUrl, sourceNote }) {
  const pool = await getReadyPool();
  const clean = {};
  for (const [model, value] of Object.entries(prices || {})) {
    const key = String(model || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    const price = Number(value);
    if (key && key.length <= 60 && Number.isFinite(price) && price > 0) {
      clean[key] = Math.round(price * 100) / 100;
    }
  }
  await pool.query(
    `INSERT INTO shop_map_prices (id, prices, source_url, source_note, fetched_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       prices = EXCLUDED.prices,
       source_url = EXCLUDED.source_url,
       source_note = EXCLUDED.source_note,
       fetched_at = NOW()`,
    [JSON.stringify(clean), String(sourceUrl || "").slice(0, 500), String(sourceNote || "").slice(0, 500)]
  );
  return { count: Object.keys(clean).length };
}

// ---- Express install program settings (managed on the Online Shop Orders
// page — no env vars, no deploys). Until first saved, the defaults apply:
// 11 AM cutoff, washers + dryers + freestanding refrigerators.
export const SHOP_EXPRESS_DEFAULTS = {
  cutoffHour: 11,
  products: ["Lau|WASHF", "Lau|WASHT", "Lau|DRELE", "Lau|DRGAS", "Ref|REFRE", "Ref|RESXS", "Ref|RETOP"]
};

export async function getShopExpressSettings() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM shop_express_settings WHERE id = 1`);
  const row = result.rows[0];
  if (!row) return { ...SHOP_EXPRESS_DEFAULTS, saved: false, updatedBy: "", updatedAt: null };
  return {
    cutoffHour: Number.isFinite(Number(row.cutoff_hour)) ? Number(row.cutoff_hour) : SHOP_EXPRESS_DEFAULTS.cutoffHour,
    products: Array.isArray(row.products) ? row.products.map(String) : [],
    saved: true,
    updatedBy: row.updated_by || "",
    updatedAt: row.updated_at?.toISOString?.() || null
  };
}

export async function saveShopExpressSettings({ cutoffHour, products, byEmail = "" }) {
  const pool = await getReadyPool();
  const hour = Math.min(23, Math.max(1, Math.round(Number(cutoffHour) || SHOP_EXPRESS_DEFAULTS.cutoffHour)));
  const clean = [...new Set((Array.isArray(products) ? products : [])
    .map((p) => String(p || "").trim().slice(0, 40))
    .filter((p) => /^[\w &-]+\|[\w &-]+$/.test(p)))].slice(0, 100);
  await pool.query(
    `INSERT INTO shop_express_settings (id, cutoff_hour, products, updated_by, updated_at)
     VALUES (1, $1, $2::jsonb, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       cutoff_hour = EXCLUDED.cutoff_hour,
       products = EXCLUDED.products,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [hour, JSON.stringify(clean), String(byEmail || "").trim().toLowerCase().slice(0, 200)]
  );
  return getShopExpressSettings();
}

export async function getShopMapPrices() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM shop_map_prices WHERE id = 1`);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    prices: row.prices || {},
    sourceUrl: row.source_url,
    sourceNote: row.source_note,
    fetchedAt: row.fetched_at?.toISOString?.() || null,
    count: Object.keys(row.prices || {}).length
  };
}

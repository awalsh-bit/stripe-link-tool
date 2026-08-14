import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

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

function mapShopper(row) {
  return {
    id: row.id,
    token: row.token,
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
  const result = await pool.query(
    `INSERT INTO shop_shoppers
       (token, first_name, last_name, email, phone, preferred_contact,
        address_line1, address_line2, address_city, address_state, address_zip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
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
    ]
  );
  return mapShopper(result.rows[0]);
}

export async function getShopperByToken(token) {
  const raw = String(token || "").trim();
  if (!raw || raw.length > 64) return null;
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM shop_shoppers WHERE token = $1`, [raw]);
  if (!result.rows[0]) return null;
  pool.query(`UPDATE shop_shoppers SET last_seen_at = NOW() WHERE token = $1`, [raw]).catch(() => {});
  return mapShopper(result.rows[0]);
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

export async function saveShopInventorySnapshot({ serials, sourceFile, uploadedBy }) {
  const pool = await getReadyPool();
  const clean = [...new Set((serials || [])
    .map((s) => String(s || "").trim().toUpperCase())
    .filter((s) => s && s.length <= 60))];
  await pool.query(
    `INSERT INTO shop_inventory_snapshot (id, serials, source_file, uploaded_by, uploaded_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       serials = EXCLUDED.serials,
       source_file = EXCLUDED.source_file,
       uploaded_by = EXCLUDED.uploaded_by,
       uploaded_at = NOW()`,
    [JSON.stringify(clean), String(sourceFile || "").slice(0, 200), String(uploadedBy || "").toLowerCase()]
  );
  return { count: clean.length };
}

export async function getShopInventorySnapshot() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM shop_inventory_snapshot WHERE id = 1`);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    serials: row.serials || [],
    sourceFile: row.source_file,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at?.toISOString?.() || null
  };
}

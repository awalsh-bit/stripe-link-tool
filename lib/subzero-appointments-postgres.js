// ---------------------------------------------------------------------------
// Sub-Zero landing page consultation appointments. Customers pick a showroom
// time slot on subzero.html; each booking becomes a DIBS-able appointment for
// the showroom sales team. Slots are stored as local-date + 24h local-time
// strings (APP_TIMEZONE) so there's no UTC drift on display. Capacity is
// enforced at insert time — the INSERT only lands while the slot still has
// room, so two simultaneous bookings can't oversell a slot.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS subzero_appointments (
  id TEXT PRIMARY KEY,
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  claimed_by_email TEXT NOT NULL DEFAULT '',
  claimed_by_name TEXT NOT NULL DEFAULT '',
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sza_slot_idx ON subzero_appointments (slot_date, slot_time);
ALTER TABLE subzero_appointments ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE subzero_appointments ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE subzero_appointments ADD COLUMN IF NOT EXISTS contact_pref TEXT NOT NULL DEFAULT '';
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
  return {
    id: row.id,
    slotDate: row.slot_date,
    slotTime: row.slot_time,
    customerName: row.customer_name,
    contact: row.contact,
    email: row.email || "",
    phone: row.phone || "",
    contactPref: row.contact_pref || "",
    role: row.role,
    message: row.message,
    claimedByEmail: row.claimed_by_email || "",
    claimedByName: row.claimed_by_name || "",
    claimedAt: row.claimed_at ? row.claimed_at.toISOString() : "",
    createdAt: row.created_at ? row.created_at.toISOString() : ""
  };
}

// Booked-count per slot for a date range — the slot generator subtracts
// these from capacity before showing times to customers.
export async function countBookingsBySlot(fromDate, toDate) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT slot_date, slot_time, COUNT(*)::int AS booked
       FROM subzero_appointments
      WHERE slot_date >= $1 AND slot_date <= $2
      GROUP BY slot_date, slot_time`,
    [String(fromDate || ""), String(toDate || "")]
  );
  const counts = new Map();
  for (const row of result.rows) counts.set(`${row.slot_date} ${row.slot_time}`, row.booked);
  return counts;
}

// Creates the booking only while the slot still has room. Returns the new
// appointment, or null when the slot filled between pick and submit.
// Slot-less inquiries (plain "reach out" requests) skip the capacity guard —
// they still get a record so a DIBS claim has something to stamp.
export async function createAppointment({ slotDate, slotTime, customerName, contact, email, phone, contactPref, role, message, capacity }) {
  const pool = await getReadyPool();
  const id = `sza_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const cap = Number.isFinite(Number(capacity)) && Number(capacity) > 0 ? Number(capacity) : 2;
  const cleanDate = String(slotDate || "").slice(0, 10);
  const cleanTime = String(slotTime || "").slice(0, 5);
  const hasSlot = Boolean(cleanDate && cleanTime);
  const values = [
    id,
    cleanDate,
    cleanTime,
    String(customerName || "").slice(0, 120),
    String(contact || "").slice(0, 160),
    String(email || "").slice(0, 160),
    String(phone || "").slice(0, 20),
    String(contactPref || "").slice(0, 12),
    String(role || "").slice(0, 40),
    String(message || "").slice(0, 1200)
  ];
  const result = hasSlot
    ? await pool.query(
        `INSERT INTO subzero_appointments (id, slot_date, slot_time, customer_name, contact, email, phone, contact_pref, role, message)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
          WHERE (SELECT COUNT(*) FROM subzero_appointments WHERE slot_date = $2 AND slot_time = $3) < $11
         RETURNING *`,
        [...values, cap]
      )
    : await pool.query(
        `INSERT INTO subzero_appointments (id, slot_date, slot_time, customer_name, contact, email, phone, contact_pref, role, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        values
      );
  return result.rows.length ? mapRow(result.rows[0]) : null;
}

export async function getAppointment(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM subzero_appointments WHERE id = $1`, [String(id || "").slice(0, 60)]);
  return result.rows.length ? mapRow(result.rows[0]) : null;
}

// First claim wins — mirrors the notification claim's WHERE guard so the
// appointment row and the DIBS flag can't disagree about ownership.
export async function claimAppointment(id, byEmail, byName = "") {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE subzero_appointments
        SET claimed_by_email = $2, claimed_by_name = $3, claimed_at = NOW()
      WHERE id = $1 AND claimed_by_email = ''
      RETURNING *`,
    [String(id || "").slice(0, 60), String(byEmail || "").toLowerCase(), String(byName || "").slice(0, 120)]
  );
  return result.rows.length ? mapRow(result.rows[0]) : null;
}

// Only the claimer can release it (matches the notification unclaim rule).
export async function unclaimAppointment(id, byEmail) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE subzero_appointments
        SET claimed_by_email = '', claimed_by_name = '', claimed_at = NULL
      WHERE id = $1 AND claimed_by_email = $2
      RETURNING *`,
    [String(id || "").slice(0, 60), String(byEmail || "").toLowerCase()]
  );
  return result.rows.length ? mapRow(result.rows[0]) : null;
}

// Upcoming appointments (today onward), soonest first — claimed and open.
export async function listUpcomingAppointments(fromDate) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM subzero_appointments
      WHERE slot_date >= $1
      ORDER BY slot_date, slot_time, created_at`,
    [String(fromDate || "")]
  );
  return result.rows.map(mapRow);
}

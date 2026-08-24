// ---------------------------------------------------------------------------
// Delivery runs & stops — the in-house replacement for DispatchTrack's
// delivery-day workflow. A run is one truck's day: an ordered list of stops
// built by dispatch, driven by the driver page, auto-advanced by Samsara
// geofence events, and narrated to customers by Podium texts from the
// showroom number (the thing DT never did).
//
// Status model:
//   run:  planned → active ⇄ paused → done
//   stop: pending → arrived → done   (departed recorded on geofence exit)
//         pending → skipped | exception
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS delivery_runs (
  id BIGSERIAL PRIMARY KEY,
  run_date DATE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  driver_email TEXT NOT NULL DEFAULT '',
  driver_name TEXT NOT NULL DEFAULT '',
  vehicle_id TEXT NOT NULL DEFAULT '',
  vehicle_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  pause_note TEXT NOT NULL DEFAULT '',
  finished_at TIMESTAMPTZ,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delivery_runs_date ON delivery_runs (run_date);

CREATE TABLE IF NOT EXISTS delivery_stops (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,
  order_ref TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  window_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  tracking_token TEXT NOT NULL UNIQUE,
  geofence_id TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  arrived_at TIMESTAMPTZ,
  departed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  signature TEXT NOT NULL DEFAULT '',
  signed_name TEXT NOT NULL DEFAULT '',
  exception_note TEXT NOT NULL DEFAULT '',
  texts JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_text_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delivery_stops_run ON delivery_stops (run_id, seq);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL);
  await ensurePromise;
  return pool;
}

const RUN_STATUSES = ["planned", "active", "paused", "done"];
const STOP_STATUSES = ["pending", "arrived", "done", "skipped", "exception"];

function mapRun(row) {
  return {
    id: Number(row.id),
    runDate: row.run_date instanceof Date ? row.run_date.toISOString().slice(0, 10) : String(row.run_date),
    name: row.name,
    driverEmail: row.driver_email,
    driverName: row.driver_name,
    vehicleId: row.vehicle_id,
    vehicleName: row.vehicle_name,
    status: row.status,
    startedAt: row.started_at?.toISOString?.() || null,
    pausedAt: row.paused_at?.toISOString?.() || null,
    pauseNote: row.pause_note || "",
    finishedAt: row.finished_at?.toISOString?.() || null,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at?.toISOString?.() || null
  };
}

function mapStop(row, { includePod = true } = {}) {
  return {
    id: Number(row.id),
    runId: Number(row.run_id),
    seq: row.seq,
    orderRef: row.order_ref,
    customerName: row.customer_name,
    phone: row.phone,
    address: row.address,
    items: row.items,
    notes: row.notes,
    windowText: row.window_text,
    status: row.status,
    trackingToken: row.tracking_token,
    geofenceId: row.geofence_id || "",
    lat: row.lat, lng: row.lng,
    arrivedAt: row.arrived_at?.toISOString?.() || null,
    departedAt: row.departed_at?.toISOString?.() || null,
    completedAt: row.completed_at?.toISOString?.() || null,
    photoCount: Array.isArray(row.photos) ? row.photos.length : 0,
    ...(includePod ? { photos: row.photos || [], signature: row.signature || "", signedName: row.signed_name || "" } : {}),
    exceptionNote: row.exception_note || "",
    texts: row.texts || [],
    nextTextSentAt: row.next_text_sent_at?.toISOString?.() || null
  };
}

// ---- runs ------------------------------------------------------------------

export async function createDeliveryRun({ runDate, name = "", driverEmail = "", driverName = "", vehicleId = "", vehicleName = "", byEmail = "" }) {
  const pool = await getReadyPool();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(runDate || ""))) throw new Error("A run date (YYYY-MM-DD) is required.");
  const result = await pool.query(
    `INSERT INTO delivery_runs (run_date, name, driver_email, driver_name, vehicle_id, vehicle_name, created_by_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [runDate, String(name).slice(0, 120), String(driverEmail).trim().toLowerCase(), String(driverName).slice(0, 120),
     String(vehicleId).slice(0, 80), String(vehicleName).slice(0, 120), String(byEmail).trim().toLowerCase()]
  );
  return mapRun(result.rows[0]);
}

export async function updateDeliveryRun(id, fields) {
  const pool = await getReadyPool();
  const allowed = { name: "name", driverEmail: "driver_email", driverName: "driver_name", vehicleId: "vehicle_id", vehicleName: "vehicle_name" };
  const sets = [], values = [id];
  for (const [key, col] of Object.entries(allowed)) {
    if (fields[key] !== undefined) { values.push(String(fields[key]).slice(0, 160)); sets.push(`${col} = $${values.length}`); }
  }
  if (!sets.length) return getDeliveryRun(id);
  const result = await pool.query(`UPDATE delivery_runs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, values);
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

export async function setDeliveryRunStatus(id, status, { pauseNote = "" } = {}) {
  if (!RUN_STATUSES.includes(status)) throw new Error("Bad run status.");
  const pool = await getReadyPool();
  const extra =
    status === "active" ? ", started_at = COALESCE(started_at, NOW()), paused_at = NULL, pause_note = ''" :
    status === "paused" ? ", paused_at = NOW(), pause_note = $3" :
    status === "done" ? ", finished_at = NOW(), paused_at = NULL" : "";
  const params = status === "paused" ? [id, status, String(pauseNote).slice(0, 200)] : [id, status];
  const result = await pool.query(`UPDATE delivery_runs SET status = $2${extra} WHERE id = $1 RETURNING *`, params);
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

export async function getDeliveryRun(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM delivery_runs WHERE id = $1`, [id]);
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

export async function deleteDeliveryRun(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`DELETE FROM delivery_runs WHERE id = $1 AND status = 'planned' RETURNING id`, [id]);
  return result.rowCount > 0;
}

export async function listDeliveryRuns({ date = null, activeOnly = false } = {}) {
  const pool = await getReadyPool();
  const where = [], values = [];
  if (date) { values.push(date); where.push(`run_date = $${values.length}`); }
  if (activeOnly) where.push(`status IN ('active', 'paused')`);
  const result = await pool.query(
    `SELECT * FROM delivery_runs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY run_date DESC, id ASC LIMIT 100`, values);
  return result.rows.map(mapRun);
}

// The driver's run: today's (or any active) run assigned to their email.
export async function getRunForDriver(email, runDate) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM delivery_runs
      WHERE driver_email = $1 AND (status IN ('active','paused') OR run_date = $2)
      ORDER BY (status IN ('active','paused')) DESC, run_date DESC LIMIT 1`,
    [String(email || "").trim().toLowerCase(), runDate]
  );
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

// ---- stops -----------------------------------------------------------------

export async function addDeliveryStop(runId, { orderRef = "", customerName, phone = "", address = "", items = "", notes = "", windowText = "", lat = null, lng = null }) {
  const pool = await getReadyPool();
  if (!String(customerName || "").trim()) throw new Error("The customer's name is required.");
  const token = crypto.randomBytes(18).toString("base64url");
  const seqRow = await pool.query(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM delivery_stops WHERE run_id = $1`, [runId]);
  const result = await pool.query(
    `INSERT INTO delivery_stops (run_id, seq, order_ref, customer_name, phone, address, items, notes, window_text, tracking_token, lat, lng)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [runId, seqRow.rows[0].next, String(orderRef).slice(0, 60), String(customerName).slice(0, 160),
     String(phone).slice(0, 40), String(address).slice(0, 300), String(items).slice(0, 500),
     String(notes).slice(0, 500), String(windowText).slice(0, 80), token,
     Number.isFinite(Number(lat)) && lat !== null ? Number(lat) : null,
     Number.isFinite(Number(lng)) && lng !== null ? Number(lng) : null]
  );
  return mapStop(result.rows[0]);
}

export async function updateDeliveryStop(id, fields) {
  const pool = await getReadyPool();
  const allowed = { orderRef: "order_ref", customerName: "customer_name", phone: "phone", address: "address", items: "items", notes: "notes", windowText: "window_text", geofenceId: "geofence_id" };
  const sets = [], values = [id];
  for (const [key, col] of Object.entries(allowed)) {
    if (fields[key] !== undefined) { values.push(String(fields[key]).slice(0, 500)); sets.push(`${col} = $${values.length}`); }
  }
  if (fields.lat !== undefined) { values.push(fields.lat === null ? null : Number(fields.lat)); sets.push(`lat = $${values.length}`); }
  if (fields.lng !== undefined) { values.push(fields.lng === null ? null : Number(fields.lng)); sets.push(`lng = $${values.length}`); }
  if (!sets.length) return getDeliveryStop(id);
  const result = await pool.query(`UPDATE delivery_stops SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, values);
  return result.rows[0] ? mapStop(result.rows[0]) : null;
}

export async function deleteDeliveryStop(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`DELETE FROM delivery_stops WHERE id = $1 RETURNING id`, [id]);
  return result.rowCount > 0;
}

export async function reorderDeliveryStops(runId, stopIds) {
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < stopIds.length; i++) {
      await client.query(`UPDATE delivery_stops SET seq = $1 WHERE id = $2 AND run_id = $3`, [i + 1, stopIds[i], runId]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return listDeliveryStops(runId);
}

export async function listDeliveryStops(runId, opts) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM delivery_stops WHERE run_id = $1 ORDER BY seq ASC, id ASC`, [runId]);
  return result.rows.map((row) => mapStop(row, opts));
}

export async function getDeliveryStop(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM delivery_stops WHERE id = $1`, [id]);
  return result.rows[0] ? mapStop(result.rows[0]) : null;
}

export async function getDeliveryStopByToken(token) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM delivery_stops WHERE tracking_token = $1`, [String(token || "")]);
  return result.rows[0] ? mapStop(result.rows[0]) : null;
}

export async function getDeliveryStopByGeofence(geofenceId) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT s.* FROM delivery_stops s
       JOIN delivery_runs r ON r.id = s.run_id
      WHERE s.geofence_id = $1 AND r.status IN ('active', 'paused')
      ORDER BY s.id DESC LIMIT 1`,
    [String(geofenceId || "")]
  );
  return result.rows[0] ? mapStop(result.rows[0]) : null;
}

export async function setDeliveryStopStatus(id, status, { exceptionNote = "" } = {}) {
  if (!STOP_STATUSES.includes(status)) throw new Error("Bad stop status.");
  const pool = await getReadyPool();
  const extra =
    status === "arrived" ? ", arrived_at = COALESCE(arrived_at, NOW())" :
    status === "done" ? ", completed_at = COALESCE(completed_at, NOW()), departed_at = COALESCE(departed_at, NOW())" :
    status === "exception" ? ", exception_note = $3" : "";
  const params = status === "exception" ? [id, status, String(exceptionNote).slice(0, 300)] : [id, status];
  const result = await pool.query(`UPDATE delivery_stops SET status = $2${extra} WHERE id = $1 RETURNING *`, params);
  return result.rows[0] ? mapStop(result.rows[0]) : null;
}

export async function markDeliveryStopDeparted(id) {
  const pool = await getReadyPool();
  const result = await pool.query(`UPDATE delivery_stops SET departed_at = COALESCE(departed_at, NOW()) WHERE id = $1 RETURNING *`, [id]);
  return result.rows[0] ? mapStop(result.rows[0]) : null;
}

export async function addDeliveryStopPhoto(id, dataUrl) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE delivery_stops
        SET photos = photos || $2::jsonb
      WHERE id = $1 AND jsonb_array_length(photos) < 12
      RETURNING *`,
    [id, JSON.stringify([{ dataUrl, takenAt: new Date().toISOString() }])]
  );
  return result.rows[0] ? mapStop(result.rows[0]) : null;
}

export async function setDeliveryStopSignature(id, { dataUrl, signedName = "" }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE delivery_stops SET signature = $2, signed_name = $3 WHERE id = $1 RETURNING *`,
    [id, String(dataUrl || ""), String(signedName).slice(0, 120)]
  );
  return result.rows[0] ? mapStop(result.rows[0]) : null;
}

// Append to the stop's text log; used by the auto-text engine so a stop's
// history shows every message the customer got.
export async function logDeliveryStopText(id, entry) {
  const pool = await getReadyPool();
  await pool.query(
    `UPDATE delivery_stops SET texts = texts || $2::jsonb WHERE id = $1`,
    [id, JSON.stringify([{ ...entry, at: new Date().toISOString() }])]
  );
}

export async function markNextTextSent(id) {
  const pool = await getReadyPool();
  // Guard: only the first caller wins; a second geofence bounce won't double-text.
  const result = await pool.query(
    `UPDATE delivery_stops SET next_text_sent_at = NOW() WHERE id = $1 AND next_text_sent_at IS NULL RETURNING id`, [id]);
  return result.rowCount > 0;
}

// The next stop a truck should visit: lowest-seq pending stop on the run.
export async function getNextPendingStop(runId) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM delivery_stops WHERE run_id = $1 AND status = 'pending' ORDER BY seq ASC, id ASC LIMIT 1`, [runId]);
  return result.rows[0] ? mapStop(result.rows[0]) : null;
}

// Position info for the public tracking page: how many undone stops sit
// ahead of this one on its run.
export async function countStopsAhead(stop) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n FROM delivery_stops
      WHERE run_id = $1 AND seq < $2 AND status IN ('pending', 'arrived')`,
    [stop.runId, stop.seq]
  );
  return result.rows[0].n;
}

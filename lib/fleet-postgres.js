import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";
import { saveInstallDamagePhoto, getInstallDamagePhoto } from "./install-damage-postgres.js";

// ---------------------------------------------------------------------------
// Fleet Management (fleet.html). Agility is the maintenance record; Samsara
// supplies the telemetry (Andrew, 2026-09-11).
//
//   fleet_vehicles       roster: Samsara identity + Agility's own fields
//                        (ePASS truck code, class, capacity points, crew
//                        limit, availability) + the last telemetry snapshot
//   fleet_service_plans  what gets done how often (fleet-wide or per truck)
//   fleet_service_log    what was done, when, at what mileage, what it cost,
//                        with the shop invoice / receipt attached
//   fleet_renewals       registration, insurance, inspection due dates
//
// Availability feeds dispatch: a truck marked in_shop / out_of_service, or
// carrying an open DVIR defect, drops out of the assignable list.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id UUID PRIMARY KEY,
  samsara_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  epass_code TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  make TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  plate TEXT NOT NULL DEFAULT '',
  vehicle_class TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  capacity_points NUMERIC(6,1) NOT NULL DEFAULT 0,
  max_crew INTEGER NOT NULL DEFAULT 2,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  availability TEXT NOT NULL DEFAULT 'available',
  availability_note TEXT NOT NULL DEFAULT '',
  availability_by TEXT NOT NULL DEFAULT '',
  availability_at TIMESTAMPTZ,
  odometer_mi INTEGER,
  odometer_at TIMESTAMPTZ,
  engine_hours INTEGER,
  fuel_pct NUMERIC(5,1),
  telemetry JSONB NOT NULL DEFAULT '{}'::jsonb,
  samsara_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_vehicles_samsara ON fleet_vehicles (samsara_id) WHERE samsara_id <> '';
CREATE TABLE IF NOT EXISTS fleet_service_plans (
  id UUID PRIMARY KEY,
  vehicle_id UUID REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  interval_miles INTEGER,
  interval_months INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS fleet_service_log (
  id UUID PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  performed_on DATE NOT NULL,
  odometer_mi INTEGER,
  task TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_via TEXT NOT NULL DEFAULT '',
  receipt_id UUID,
  invoice_photo_id INTEGER,
  logged_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_fleet_log_vehicle ON fleet_service_log (vehicle_id, performed_on DESC);
CREATE TABLE IF NOT EXISTS fleet_renewals (
  id UUID PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  due_on DATE NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS fleet_fuel_months (
  vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  gallons NUMERIC(10,1),
  fuel_cost NUMERIC(12,2),
  distance_mi INTEGER,
  idle_minutes INTEGER,
  mpg NUMERIC(6,2),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vehicle_id, month)
);
CREATE TABLE IF NOT EXISTS fleet_defects (
  id TEXT PRIMARY KEY,
  vehicle_id UUID REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  defect_type TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

export const DEFAULT_PLANS = [
  { task: "Oil & filter change", intervalMiles: 7500, intervalMonths: 6 },
  { task: "Tire rotation", intervalMiles: 7500, intervalMonths: null },
  { task: "Brake inspection", intervalMiles: 15000, intervalMonths: 12 },
  { task: "Transmission service", intervalMiles: 60000, intervalMonths: null },
  { task: "Coolant flush", intervalMiles: 50000, intervalMonths: 36 },
  { task: "DOT / state inspection", intervalMiles: null, intervalMonths: 12 }
];
export const RENEWAL_KINDS = ["Registration", "Insurance", "State inspection", "DOT inspection", "Liftgate inspection", "Other"];
export const AVAILABILITY = ["available", "in_shop", "out_of_service", "spare"];
export const VEHICLE_CLASSES = ["BOX_TRUCK", "CARGO_VAN", "PICKUP", "SERVICE_VAN", "TRAILER", "CAR"];
export const PAID_VIA = ["Company card", "ACH", "Check", "Vendor account", "Other"];

const dateOut = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
function mapVehicle(r) {
  return {
    id: r.id, samsaraId: r.samsara_id, name: r.name, epassCode: r.epass_code, vin: r.vin, make: r.make, model: r.model, year: r.year, plate: r.plate,
    vehicleClass: r.vehicle_class, department: r.department, capacityPoints: Number(r.capacity_points) || 0, maxCrew: r.max_crew, active: r.active,
    availability: r.availability, availabilityNote: r.availability_note, availabilityBy: r.availability_by, availabilityAt: r.availability_at?.toISOString?.() || null,
    odometerMi: r.odometer_mi, odometerAt: r.odometer_at?.toISOString?.() || null, engineHours: r.engine_hours, fuelPct: r.fuel_pct == null ? null : Number(r.fuel_pct),
    telemetry: r.telemetry || {}, samsaraTags: r.samsara_tags || [], notes: r.notes, lastSyncedAt: r.last_synced_at?.toISOString?.() || null
  };
}

// ---------------------------------------------------------------------------
// Samsara sync: roster, telemetry, current drivers, defects, fuel by month.
// `samsara` is the module (injected so tests can stub it).
// ---------------------------------------------------------------------------
export async function syncFleetFromSamsara(samsara, { months = 6 } = {}) {
  const pool = await getReadyPool();
  const result = { vehicles: 0, newVehicles: 0, telemetry: 0, drivers: 0, defects: null, fuelRows: null, errors: [] };
  let roster = [];
  try { roster = await samsara.listVehiclesDetailed(); } catch (e) { result.errors.push(`Vehicles: ${e.message}`); }
  const byId = new Map((await pool.query(`SELECT id, samsara_id FROM fleet_vehicles`)).rows.map((r) => [r.samsara_id, r.id]));
  for (const v of roster) {
    // ePASS code from a Samsara tag/attribute like "D03" if present, else keep what Agility has
    const codeFromSamsara = [...v.tags, v.attributes["ePASS Code"] || "", v.attributes["Truck Code"] || ""].find((t) => /^(D\d{2}|[A-Z]{2,4})$/.test(String(t || "").trim())) || "";
    if (byId.has(v.samsaraId)) {
      await pool.query(
        `UPDATE fleet_vehicles SET name=$2, vin=$3, make=$4, model=$5, year=$6, plate=$7, samsara_tags=$8::jsonb, epass_code = CASE WHEN epass_code = '' THEN $9 ELSE epass_code END, last_synced_at=NOW(), updated_at=NOW() WHERE samsara_id = $1`,
        [v.samsaraId, v.name, v.vin, v.make, v.model, String(v.year || ""), v.plate, JSON.stringify(v.tags), codeFromSamsara]
      );
    } else {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO fleet_vehicles (id, samsara_id, name, vin, make, model, year, plate, samsara_tags, epass_code, vehicle_class, last_synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,NOW())`,
        [id, v.samsaraId, v.name, v.vin, v.make, v.model, String(v.year || ""), v.plate, JSON.stringify(v.tags), codeFromSamsara || (/^D\d{2}/.test(v.name) ? v.name.slice(0, 3) : ""), /van/i.test(v.model) ? "CARGO_VAN" : "BOX_TRUCK"]
      );
      byId.set(v.samsaraId, id); result.newVehicles++;
    }
    result.vehicles++;
  }
  // telemetry
  try {
    const stats = await samsara.getVehicleStatsSnapshot();
    const assignments = await samsara.currentDriverAssignments();
    for (const s of stats) {
      const id = byId.get(s.samsaraId); if (!id) continue;
      const tele = { lat: s.lat, lng: s.lng, speedMph: s.speedMph, address: s.address, gpsAt: s.gpsAt, engineState: s.engineState, checkEngine: s.checkEngine, faults: s.faults, driver: assignments[s.samsaraId] || null };
      await pool.query(
        `UPDATE fleet_vehicles SET odometer_mi = COALESCE($2, odometer_mi), odometer_at = CASE WHEN $2 IS NULL THEN odometer_at ELSE NOW() END, engine_hours = COALESCE($3, engine_hours), fuel_pct = COALESCE($4, fuel_pct), telemetry = $5::jsonb, last_synced_at = NOW() WHERE id = $1`,
        [id, s.odometerMi, s.engineHours, s.fuelPct, JSON.stringify(tele)]
      );
      result.telemetry++;
    }
    result.drivers = Object.keys(assignments).length;
  } catch (e) { result.errors.push(`Vehicle stats: ${e.message}`); }
  // defects
  try {
    const defects = await samsara.listOpenDefects();
    if (defects) {
      await pool.query(`UPDATE fleet_defects SET resolved = TRUE WHERE NOT resolved`);
      for (const d of defects) {
        const vid = byId.get(d.vehicleId) || null;
        await pool.query(
          `INSERT INTO fleet_defects (id, vehicle_id, defect_type, comment, created_at, resolved) VALUES ($1,$2,$3,$4,$5,FALSE)
           ON CONFLICT (id) DO UPDATE SET vehicle_id = EXCLUDED.vehicle_id, defect_type = EXCLUDED.defect_type, comment = EXCLUDED.comment, resolved = FALSE, synced_at = NOW()`,
          [d.id, vid, d.type, d.comment, d.createdAt]
        );
      }
      result.defects = defects.length;
    }
  } catch (e) { result.errors.push(`Defects: ${e.message}`); }
  // fuel by month (current + previous months)
  try {
    const now = new Date();
    let rowsSynced = 0;
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const start = d.toISOString().slice(0, 10);
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const month = start.slice(0, 7);
      const report = await samsara.fuelEnergyByVehicle(start, end);
      if (!report) { result.fuelRows = null; break; }
      for (const r of report) {
        const vid = byId.get(r.samsaraId); if (!vid) continue;
        await pool.query(
          `INSERT INTO fleet_fuel_months (vehicle_id, month, gallons, fuel_cost, distance_mi, idle_minutes, mpg) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (vehicle_id, month) DO UPDATE SET gallons = EXCLUDED.gallons, fuel_cost = EXCLUDED.fuel_cost, distance_mi = EXCLUDED.distance_mi, idle_minutes = EXCLUDED.idle_minutes, mpg = EXCLUDED.mpg, synced_at = NOW()`,
          [vid, month, r.gallons, r.fuelCost, r.distanceMi, r.idleMinutes, r.mpg]
        );
        rowsSynced++;
      }
      result.fuelRows = rowsSynced;
    }
  } catch (e) { result.errors.push(`Fuel & energy: ${e.message}`); }
  return result;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function listFleetVehicles({ includeInactive = false } = {}) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM fleet_vehicles ${includeInactive ? "" : "WHERE active"} ORDER BY epass_code NULLS LAST, name`);
  return r.rows.map(mapVehicle);
}

// Service due per vehicle: for every active plan (vehicle-specific overrides
// fleet-wide by task), find the last log entry for that task and project
// the next due by miles and by months, whichever comes first.
export async function fleetOverview({ today = new Date().toISOString().slice(0, 10) } = {}) {
  const pool = await getReadyPool();
  const [vehicles, plans, lastDone, renewals, defects, fuel, spend] = await Promise.all([
    listFleetVehicles(),
    pool.query(`SELECT * FROM fleet_service_plans WHERE active ORDER BY vehicle_id NULLS FIRST, task`),
    pool.query(`SELECT DISTINCT ON (vehicle_id, task) vehicle_id, task, performed_on, odometer_mi FROM fleet_service_log WHERE deleted_at IS NULL ORDER BY vehicle_id, task, performed_on DESC, created_at DESC`),
    pool.query(`SELECT * FROM fleet_renewals ORDER BY due_on`),
    pool.query(`SELECT * FROM fleet_defects WHERE NOT resolved ORDER BY created_at DESC`),
    pool.query(`SELECT vehicle_id, month, gallons, fuel_cost, distance_mi, idle_minutes, mpg FROM fleet_fuel_months WHERE month >= $1 ORDER BY month`, [monthsAgo(today, 5)]),
    pool.query(`SELECT vehicle_id, TO_CHAR(performed_on, 'YYYY-MM') AS month, SUM(cost)::numeric(12,2) AS cost, COUNT(*)::int AS n FROM fleet_service_log WHERE deleted_at IS NULL AND performed_on >= $1 GROUP BY 1,2`, [monthsAgo(today, 5) + "-01"])
  ]);
  const doneKey = new Map(lastDone.rows.map((r) => [`${r.vehicle_id}|${r.task}`, r]));
  const fleetPlans = plans.rows.filter((p) => !p.vehicle_id);
  const out = [];
  for (const v of vehicles) {
    const own = plans.rows.filter((p) => p.vehicle_id === v.id);
    const effective = [...own, ...fleetPlans.filter((fp) => !own.some((o) => o.task === fp.task))];
    const due = [];
    for (const p of effective) {
      const last = doneKey.get(`${v.id}|${p.task}`);
      let dueMi = null, dueOn = null;
      if (p.interval_miles && last?.odometer_mi != null) dueMi = last.odometer_mi + p.interval_miles;
      else if (p.interval_miles && !last && v.odometerMi != null) dueMi = null; // never logged: unknown baseline
      if (p.interval_months && last?.performed_on) { const d = new Date(last.performed_on); d.setUTCMonth(d.getUTCMonth() + p.interval_months); dueOn = d.toISOString().slice(0, 10); }
      const milesLeft = dueMi != null && v.odometerMi != null ? dueMi - v.odometerMi : null;
      const daysLeft = dueOn ? Math.round((new Date(dueOn + "T12:00:00Z") - new Date(today + "T12:00:00Z")) / 86400000) : null;
      let state = "ok";
      if (!last) state = "never_logged";
      else if ((milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft <= 0)) state = "overdue";
      else if ((milesLeft != null && milesLeft <= 500) || (daysLeft != null && daysLeft <= 30)) state = "soon";
      due.push({ task: p.task, intervalMiles: p.interval_miles, intervalMonths: p.interval_months, lastOn: last ? dateOut(last.performed_on) : null, lastMi: last?.odometer_mi ?? null, dueMi, dueOn, milesLeft, daysLeft, state, scope: p.vehicle_id ? "vehicle" : "fleet" });
    }
    const vRenewals = renewals.rows.filter((r) => r.vehicle_id === v.id).map((r) => { const days = Math.round((new Date(dateOut(r.due_on) + "T12:00:00Z") - new Date(today + "T12:00:00Z")) / 86400000); return { id: r.id, kind: r.kind, dueOn: dateOut(r.due_on), notes: r.notes, daysLeft: days, state: days < 0 ? "overdue" : days <= 30 ? "soon" : "ok" }; });
    const vDefects = defects.rows.filter((d) => d.vehicle_id === v.id).map((d) => ({ id: d.id, type: d.defect_type, comment: d.comment, createdAt: d.created_at?.toISOString?.() || null }));
    const faults = v.telemetry?.faults || [];
    const attention = [];
    if (v.availability !== "available") attention.push({ level: "hard", text: `${v.availability.replace(/_/g, " ")}${v.availabilityNote ? " — " + v.availabilityNote : ""}` });
    for (const d of vDefects) attention.push({ level: "hard", text: `Open DVIR defect: ${d.type}${d.comment ? " — " + d.comment : ""}` });
    if (v.telemetry?.checkEngine) attention.push({ level: "warn", text: "Check-engine light on" });
    for (const f of faults.slice(0, 3)) attention.push({ level: "warn", text: `Fault ${f.code}${f.description ? " — " + f.description : ""}` });
    for (const d of due) if (d.state === "overdue") attention.push({ level: "warn", text: `${d.task} overdue` }); else if (d.state === "soon") attention.push({ level: "soon", text: `${d.task} due ${d.milesLeft != null && (d.daysLeft == null || d.milesLeft / 40 < d.daysLeft) ? "in " + d.milesLeft + " mi" : "in " + d.daysLeft + " days"}` });
    for (const r of vRenewals) if (r.state === "overdue") attention.push({ level: "hard", text: `${r.kind} expired ${r.dueOn}` }); else if (r.state === "soon") attention.push({ level: "soon", text: `${r.kind} due ${r.dueOn}` });
    if (v.fuelPct != null && v.fuelPct < 20) attention.push({ level: "soon", text: `Fuel ${Math.round(v.fuelPct)}%` });
    const vFuel = fuel.rows.filter((f) => f.vehicle_id === v.id).map((f) => ({ month: f.month, gallons: f.gallons == null ? null : Number(f.gallons), fuelCost: f.fuel_cost == null ? null : Number(f.fuel_cost), distanceMi: f.distance_mi, idleMinutes: f.idle_minutes, mpg: f.mpg == null ? null : Number(f.mpg) }));
    const vSpend = spend.rows.filter((s) => s.vehicle_id === v.id).map((s) => ({ month: s.month, cost: Number(s.cost) || 0, entries: s.n }));
    const assignable = v.active && v.availability === "available" && !vDefects.length && !vRenewals.some((r) => r.state === "overdue" && /registration|insurance|inspection/i.test(r.kind));
    out.push({ ...v, due, renewals: vRenewals, defects: vDefects, attention, fuel: vFuel, spend: vSpend, assignable });
  }
  const hard = out.filter((v) => v.attention.some((a) => a.level === "hard")).length;
  return {
    vehicles: out, today,
    totals: { vehicles: out.length, assignable: out.filter((v) => v.assignable).length, needsAttention: hard, overdueService: out.reduce((s, v) => s + v.due.filter((d) => d.state === "overdue").length, 0), dueSoon: out.reduce((s, v) => s + v.due.filter((d) => d.state === "soon").length + v.renewals.filter((r) => r.state === "soon").length, 0), openDefects: defects.rows.length },
    plans: fleetPlans.map((p) => ({ id: p.id, task: p.task, intervalMiles: p.interval_miles, intervalMonths: p.interval_months })),
    lastSyncedAt: out.reduce((m, v) => (v.lastSyncedAt && v.lastSyncedAt > m ? v.lastSyncedAt : m), "") || null
  };
}
function monthsAgo(today, n) { const d = new Date(today + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); }

export async function getFleetVehicle(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM fleet_vehicles WHERE id = $1`, [id]);
  if (!r.rows[0]) return null;
  const v = mapVehicle(r.rows[0]);
  const [log, plans] = await Promise.all([
    pool.query(`SELECT l.*, c.merchant AS receipt_merchant, c.amount AS receipt_amount, c.spent_on AS receipt_on FROM fleet_service_log l LEFT JOIN card_receipts c ON c.id = l.receipt_id WHERE l.vehicle_id = $1 AND l.deleted_at IS NULL ORDER BY l.performed_on DESC, l.created_at DESC LIMIT 200`, [id]),
    pool.query(`SELECT * FROM fleet_service_plans WHERE active AND vehicle_id = $1 ORDER BY task`, [id])
  ]);
  return {
    vehicle: v,
    log: log.rows.map((l) => ({ id: l.id, performedOn: dateOut(l.performed_on), odometerMi: l.odometer_mi, task: l.task, vendor: l.vendor, description: l.description, cost: Number(l.cost) || 0, paidVia: l.paid_via, receiptId: l.receipt_id, receipt: l.receipt_id ? { merchant: l.receipt_merchant, amount: Number(l.receipt_amount) || 0, spentOn: dateOut(l.receipt_on) } : null, invoicePhotoId: l.invoice_photo_id, loggedBy: l.logged_by, createdAt: l.created_at.toISOString() })),
    plans: plans.rows.map((p) => ({ id: p.id, task: p.task, intervalMiles: p.interval_miles, intervalMonths: p.interval_months }))
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export async function createFleetVehicle(fields, byEmail = "") {
  const pool = await getReadyPool();
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO fleet_vehicles (id, name, epass_code, vin, make, model, year, plate, vehicle_class, department, capacity_points, max_crew, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, String(fields.name || "").trim().slice(0, 80) || "Vehicle", String(fields.epassCode || "").trim().toUpperCase().slice(0, 10), String(fields.vin || "").slice(0, 30), String(fields.make || "").slice(0, 40), String(fields.model || "").slice(0, 40), String(fields.year || "").slice(0, 6), String(fields.plate || "").slice(0, 16),
      VEHICLE_CLASSES.includes(fields.vehicleClass) ? fields.vehicleClass : "BOX_TRUCK", String(fields.department || "").slice(0, 30), Number(fields.capacityPoints) || 0, Math.max(1, Math.round(Number(fields.maxCrew) || 2)), String(fields.notes || "").slice(0, 4000)]
  );
  return getFleetVehicle(id);
}

export async function updateFleetVehicle(id, patch, byEmail = "") {
  const pool = await getReadyPool();
  const sets = [], params = [id];
  const push = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if ("epassCode" in patch) push("epass_code", String(patch.epassCode || "").trim().toUpperCase().slice(0, 10));
  if ("name" in patch && String(patch.name || "").trim()) push("name", String(patch.name).trim().slice(0, 80));
  if ("vehicleClass" in patch && VEHICLE_CLASSES.includes(patch.vehicleClass)) push("vehicle_class", patch.vehicleClass);
  if ("department" in patch) push("department", String(patch.department || "").slice(0, 30));
  if ("capacityPoints" in patch) push("capacity_points", Math.max(0, Number(patch.capacityPoints) || 0));
  if ("maxCrew" in patch) push("max_crew", Math.max(1, Math.round(Number(patch.maxCrew) || 2)));
  if ("active" in patch) push("active", !!patch.active);
  if ("notes" in patch) push("notes", String(patch.notes || "").slice(0, 4000));
  if ("odometerMi" in patch && patch.odometerMi !== "" && patch.odometerMi != null) { push("odometer_mi", Math.max(0, Math.round(Number(patch.odometerMi) || 0))); sets.push("odometer_at = NOW()"); }
  if ("availability" in patch && AVAILABILITY.includes(patch.availability)) { push("availability", patch.availability); push("availability_note", String(patch.availabilityNote || "").slice(0, 300)); push("availability_by", byEmail); sets.push("availability_at = NOW()"); }
  if (!sets.length) return getFleetVehicle(id);
  sets.push("updated_at = NOW()");
  await pool.query(`UPDATE fleet_vehicles SET ${sets.join(", ")} WHERE id = $1`, params);
  return getFleetVehicle(id);
}

export async function addServiceEntry(vehicleId, entry, { byEmail = "", invoice = null } = {}) {
  const pool = await getReadyPool();
  const task = String(entry.task || "").trim().slice(0, 120);
  if (!task) throw new Error("What was done is required.");
  const performedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.performedOn || "")) ? entry.performedOn : new Date().toISOString().slice(0, 10);
  const id = crypto.randomUUID();
  let photoId = null;
  if (invoice?.buffer?.length) photoId = await saveInstallDamagePhoto({ reportRef: `fleet:${id}`, kind: "fleet_invoice", contentType: invoice.contentType || "image/jpeg", buffer: invoice.buffer });
  const receiptId = /^[0-9a-f-]{36}$/i.test(String(entry.receiptId || "")) ? entry.receiptId : null;
  const odo = entry.odometerMi === "" || entry.odometerMi == null ? null : Math.round(Number(entry.odometerMi));
  await pool.query(
    `INSERT INTO fleet_service_log (id, vehicle_id, performed_on, odometer_mi, task, vendor, description, cost, paid_via, receipt_id, invoice_photo_id, logged_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, vehicleId, performedOn, odo, task, String(entry.vendor || "").slice(0, 120), String(entry.description || "").slice(0, 4000), Math.round((Number(String(entry.cost || "").replace(/[$,]/g, "")) || 0) * 100) / 100, PAID_VIA.includes(entry.paidVia) ? entry.paidVia : String(entry.paidVia || "").slice(0, 30), receiptId, photoId, byEmail.slice(0, 200)]
  );
  // a service entry with a mileage reading is a better odometer than a stale sync
  if (odo != null) await pool.query(`UPDATE fleet_vehicles SET odometer_mi = GREATEST(COALESCE(odometer_mi, 0), $2), updated_at = NOW() WHERE id = $1 AND (odometer_at IS NULL OR odometer_at < NOW() - INTERVAL '1 day')`, [vehicleId, odo]);
  return getFleetVehicle(vehicleId);
}
export async function deleteServiceEntry(vehicleId, entryId) {
  const pool = await getReadyPool();
  await pool.query(`UPDATE fleet_service_log SET deleted_at = NOW() WHERE id = $1 AND vehicle_id = $2`, [entryId, vehicleId]);
  return getFleetVehicle(vehicleId);
}
export async function getServiceInvoicePhoto(entryId) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT invoice_photo_id FROM fleet_service_log WHERE id = $1`, [entryId]);
  if (!r.rows[0]?.invoice_photo_id) return null;
  const photo = await getInstallDamagePhoto(r.rows[0].invoice_photo_id);
  return photo && photo.reportRef === `fleet:${entryId}` ? photo : null;
}

export async function savePlan({ id = null, vehicleId = null, task, intervalMiles, intervalMonths }) {
  const pool = await getReadyPool();
  const t = String(task || "").trim().slice(0, 120);
  if (!t) throw new Error("Task is required.");
  const mi = intervalMiles ? Math.round(Number(intervalMiles)) : null, mo = intervalMonths ? Math.round(Number(intervalMonths)) : null;
  if (!mi && !mo) throw new Error("Give an interval in miles, months, or both.");
  if (id) await pool.query(`UPDATE fleet_service_plans SET task = $2, interval_miles = $3, interval_months = $4 WHERE id = $1`, [id, t, mi, mo]);
  else await pool.query(`INSERT INTO fleet_service_plans (id, vehicle_id, task, interval_miles, interval_months) VALUES ($1,$2,$3,$4,$5)`, [crypto.randomUUID(), vehicleId, t, mi, mo]);
}
export async function deletePlan(id) { const pool = await getReadyPool(); await pool.query(`UPDATE fleet_service_plans SET active = FALSE WHERE id = $1`, [id]); }
export async function seedDefaultPlansIfEmpty() {
  const pool = await getReadyPool();
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM fleet_service_plans`)).rows[0].n;
  if (n) return false;
  for (const p of DEFAULT_PLANS) await pool.query(`INSERT INTO fleet_service_plans (id, vehicle_id, task, interval_miles, interval_months) VALUES ($1, NULL, $2, $3, $4)`, [crypto.randomUUID(), p.task, p.intervalMiles, p.intervalMonths]);
  return true;
}
export async function saveRenewal({ id = null, vehicleId, kind, dueOn, notes = "" }) {
  const pool = await getReadyPool();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueOn || ""))) throw new Error("Give the due date.");
  const k = RENEWAL_KINDS.includes(kind) ? kind : String(kind || "Other").slice(0, 40);
  if (id) await pool.query(`UPDATE fleet_renewals SET kind = $2, due_on = $3, notes = $4 WHERE id = $1 AND vehicle_id = $5`, [id, k, dueOn, String(notes).slice(0, 300), vehicleId]);
  else await pool.query(`INSERT INTO fleet_renewals (id, vehicle_id, kind, due_on, notes) VALUES ($1,$2,$3,$4,$5)`, [crypto.randomUUID(), vehicleId, k, dueOn, String(notes).slice(0, 300)]);
}
export async function deleteRenewal(vehicleId, id) { const pool = await getReadyPool(); await pool.query(`DELETE FROM fleet_renewals WHERE id = $1 AND vehicle_id = $2`, [id, vehicleId]); }

// Card receipts a service entry can be tied to (recent, by merchant / amount).
export async function searchReceiptsForFleet(q) {
  const pool = await getReadyPool();
  const text = String(q || "").trim();
  const amount = Number(text.replace(/[$,]/g, ""));
  const r = await pool.query(
    `SELECT id, spent_on, amount, merchant, purpose, filed_by_name FROM card_receipts WHERE deleted_at IS NULL AND spent_on >= CURRENT_DATE - 120
       AND ($1 = '' OR merchant ILIKE '%' || $1 || '%' OR purpose ILIKE '%' || $1 || '%' OR ($2 > 0 AND amount = $2))
      ORDER BY spent_on DESC LIMIT 25`, [text, Number.isFinite(amount) ? amount : 0]);
  return r.rows.map((x) => ({ id: x.id, spentOn: dateOut(x.spent_on), amount: Number(x.amount) || 0, merchant: x.merchant, purpose: x.purpose, filedBy: x.filed_by_name }));
}

// For dispatch: which trucks can be put on a route today.
export async function listAssignableVehicles() {
  const o = await fleetOverview();
  return o.vehicles.filter((v) => v.assignable).map((v) => ({ id: v.id, samsaraId: v.samsaraId, name: v.name, epassCode: v.epassCode, vehicleClass: v.vehicleClass, capacityPoints: v.capacityPoints, maxCrew: v.maxCrew }));
}

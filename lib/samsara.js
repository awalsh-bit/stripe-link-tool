// ---------------------------------------------------------------------------
// Samsara fleet API client. The trucks already carry Samsara gateways, so
// vehicle GPS comes from real hardware — no phone-browser tracking hacks.
//
// Env:
//   SAMSARA_API_TOKEN   bearer token (self-serve from the Samsara dashboard)
//   SAMSARA_API_BASE    override for tests (default https://api.samsara.com)
//   SAMSARA_WEBHOOK_KEY shared secret segment in our webhook URL
//
// Geofence flow: dispatch creates one circular geofence per stop when a run
// starts; Samsara's GeofenceEntry/GeofenceExit webhooks auto-advance stop
// statuses; geofences are deleted when the run finishes.
// ---------------------------------------------------------------------------

const BASE = () => (process.env.SAMSARA_API_BASE || "https://api.samsara.com").replace(/\/$/, "");

export function samsaraConfigured() {
  return Boolean(process.env.SAMSARA_API_TOKEN);
}

async function samsaraFetch(path, { method = "GET", body = null } = {}) {
  const token = process.env.SAMSARA_API_TOKEN;
  if (!token) throw new Error("SAMSARA_API_TOKEN is not configured.");
  const res = await fetch(BASE() + path, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const err = new Error(`Samsara ${method} ${path} → ${res.status}: ${(text || "").slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Vehicles for the dispatch dropdown.
export async function listVehicles() {
  const data = await samsaraFetch("/fleet/vehicles?limit=100");
  return (data?.data || []).map((v) => ({ id: String(v.id), name: v.name || String(v.id) }));
}

// Current GPS snapshot for one vehicle (or all when id omitted).
export async function getVehicleLocation(vehicleId) {
  const query = vehicleId ? `?vehicleIds=${encodeURIComponent(vehicleId)}` : "";
  const data = await samsaraFetch(`/fleet/vehicles/locations${query}`);
  const row = (data?.data || [])[0];
  if (!row?.location) return null;
  return {
    vehicleId: String(row.id),
    name: row.name || "",
    lat: row.location.latitude,
    lng: row.location.longitude,
    speedMph: row.location.speed ?? null,
    at: row.location.time || null
  };
}

// Create a circular geofence ("address") around a stop. Returns the address id.
export async function createStopGeofence({ name, formattedAddress, lat, lng, radiusMeters = 150 }) {
  const data = await samsaraFetch("/addresses", {
    method: "POST",
    body: {
      name: String(name).slice(0, 120),
      formattedAddress: String(formattedAddress || name).slice(0, 250),
      geofence: { circle: { latitude: lat, longitude: lng, radiusMeters } }
    }
  });
  return data?.data?.id ? String(data.data.id) : null;
}

export async function deleteStopGeofence(addressId) {
  if (!addressId) return false;
  try {
    await samsaraFetch(`/addresses/${encodeURIComponent(addressId)}`, { method: "DELETE" });
    return true;
  } catch (err) {
    if (err.status === 404) return true; // already gone
    throw err;
  }
}

// Parse a Samsara Webhooks 2.0 payload into the one shape the delivery
// engine cares about. Returns null for events we don't handle.
export function parseGeofenceEvent(payload) {
  const type = payload?.eventType || payload?.event?.eventType || "";
  if (!/^Geofence(Entry|Exit)$/.test(type)) return null;
  const details = payload?.data || payload?.event?.data || payload || {};
  const vehicle = details.vehicle || details?.conditions?.[0]?.details?.vehicle || {};
  const address = details.address || details.geofence || {};
  return {
    kind: type === "GeofenceEntry" ? "entry" : "exit",
    vehicleId: vehicle.id != null ? String(vehicle.id) : "",
    addressId: address.id != null ? String(address.id) : "",
    at: payload?.eventTime || payload?.event?.eventTime || new Date().toISOString()
  };
}

// Straight-line miles between two points; used for rough ETA fallback when
// no Google Maps key is configured (Hill Country average ~32 mph door to door).
export function roughEtaMinutes(fromLat, fromLng, toLat, toLng) {
  if (![fromLat, fromLng, toLat, toLng].every((n) => Number.isFinite(Number(n)))) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(toLat - fromLat);
  const dLng = rad(toLng - fromLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(fromLat)) * Math.cos(rad(toLat)) * Math.sin(dLng / 2) ** 2;
  const miles = 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const roadMiles = miles * 1.3; // straight line → road distance fudge
  return Math.max(3, Math.round((roadMiles / 32) * 60));
}

// ---------------------------------------------------------------------------
// Fleet Management reads (fleet.html). Each helper returns [] / null on a
// missing scope or endpoint so the page degrades section by section instead
// of failing whole. Scopes: Vehicles, Vehicle Statistics, Vehicle Trips,
// Drivers, Assignments, Tags/Attributes, DVIRs, Maintenance, Fuel & Energy.
// ---------------------------------------------------------------------------
async function samsaraPaged(path, { maxPages = 10 } = {}) {
  const out = [];
  let after = "";
  for (let i = 0; i < maxPages; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const data = await samsaraFetch(path + (after ? `${sep}after=${encodeURIComponent(after)}` : ""));
    out.push(...(data?.data || []));
    if (!data?.pagination?.hasNextPage || !data?.pagination?.endCursor) break;
    after = data.pagination.endCursor;
  }
  return out;
}

// Full vehicle roster with identity fields and tags/attributes.
export async function listVehiclesDetailed() {
  const rows = await samsaraPaged("/fleet/vehicles?limit=100");
  return rows.map((v) => ({
    samsaraId: String(v.id), name: v.name || String(v.id), vin: v.vin || "", make: v.make || "", model: v.model || "", year: v.year || "",
    plate: v.licensePlate || "", serial: v.serial || "", notes: v.notes || "",
    tags: (v.tags || []).map((t) => t.name).filter(Boolean),
    attributes: Object.fromEntries((v.attributes || []).map((a) => [a.name, (a.stringValues || a.numberValues || []).join(", ")])),
    staticDriver: v.staticAssignedDriver ? { id: String(v.staticAssignedDriver.id), name: v.staticAssignedDriver.name || "" } : null,
    externalIds: v.externalIds || {}
  }));
}

// Latest snapshot per vehicle: GPS, odometer, engine hours, fuel, faults, engine state.
export async function getVehicleStatsSnapshot() {
  const types = "gps,obdOdometerMeters,gpsOdometerMeters,engineSeconds,fuelPercents,faultCodes,engineStates";
  const rows = await samsaraPaged(`/fleet/vehicles/stats?types=${types}&limit=100`);
  const m = (x) => (x == null ? null : Number(x));
  return rows.map((v) => {
    const odoM = v.obdOdometerMeters?.value ?? v.gpsOdometerMeters?.value ?? null;
    const faults = [];
    const fc = v.faultCodes || {};
    for (const f of fc.obdii?.diagnosticTroubleCodes || []) for (const c of f.confirmedDtcs || f.pendingDtcs || []) faults.push({ code: c.dtcShortCode || c.dtcId || "", description: c.dtcDescription || "", system: "OBD-II" });
    for (const f of fc.j1939?.diagnosticTroubleCodes || []) faults.push({ code: `SPN ${f.spnId} FMI ${f.fmiId}`, description: f.spnDescription || f.fmiDescription || "", system: "J1939" });
    const mil = !!(fc.obdii?.checkEngineLightIsOn || fc.j1939?.checkEngineLights?.protectIsOn || fc.j1939?.checkEngineLights?.stopIsOn || fc.j1939?.checkEngineLights?.warningIsOn);
    return {
      samsaraId: String(v.id), name: v.name || "",
      lat: m(v.gps?.latitude), lng: m(v.gps?.longitude), speedMph: m(v.gps?.speedMilesPerHour), address: v.gps?.reverseGeo?.formattedLocation || "", gpsAt: v.gps?.time || null,
      odometerMi: odoM != null ? Math.round(odoM / 1609.344) : null, engineHours: v.engineSeconds?.value != null ? Math.round(v.engineSeconds.value / 3600) : null,
      fuelPct: m(v.fuelPercents?.value), engineState: v.engineStates?.value || "", checkEngine: mil, faults
    };
  });
}

// Driver roster + who is assigned to which vehicle right now.
export async function listDriversDetailed() {
  const rows = await samsaraPaged("/fleet/drivers?limit=100&driverActivationStatus=active");
  return rows.map((d) => ({ samsaraId: String(d.id), name: d.name || "", phone: d.phone || "", username: d.username || "", licenseState: d.licenseState || "", licenseNumber: d.licenseNumber ? "on file" : "", tags: (d.tags || []).map((t) => t.name), staticVehicleId: d.staticAssignedVehicle?.id ? String(d.staticAssignedVehicle.id) : "" }));
}
export async function currentDriverAssignments() {
  try {
    const rows = await samsaraPaged("/fleet/driver-vehicle-assignments?filterBy=vehicles&limit=100");
    const out = {};
    for (const r of rows) {
      const a = (r.driverVehicleAssignments || [])[0];
      if (a?.driver?.id && r.vehicle?.id) out[String(r.vehicle.id)] = { driverId: String(a.driver.id), driverName: a.driver.name || "", since: a.startTime || null };
    }
    return out;
  } catch { return {}; }
}

// Open DVIR defects (last 90 days, unresolved).
export async function listOpenDefects() {
  try {
    const rows = await samsaraPaged(`/fleet/defects?isResolved=false&limit=100`);
    return rows.map((d) => ({ id: String(d.id), vehicleId: d.vehicle?.id ? String(d.vehicle.id) : "", vehicleName: d.vehicle?.name || "", type: d.defectType || "", comment: d.comment || "", createdAt: d.createdAtTime || d.timestamp || null, dvirId: d.dvir?.id ? String(d.dvir.id) : "" }));
  } catch { return null; }
}

// Fuel & energy per vehicle for a date range (YYYY-MM-DD, inclusive).
export async function fuelEnergyByVehicle(startDate, endDate) {
  try {
    const data = await samsaraFetch(`/fleet/reports/vehicles/fuel-energy?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
    return (data?.data?.vehicleReports || []).map((r) => ({
      samsaraId: String(r.vehicle?.id || ""), name: r.vehicle?.name || "",
      gallons: r.fuelConsumedMl != null ? Math.round((r.fuelConsumedMl / 3785.41) * 10) / 10 : null,
      fuelCost: r.estFuelEnergyCost?.amount != null ? Number(r.estFuelEnergyCost.amount) : null,
      distanceMi: r.distanceTraveledMeters != null ? Math.round(r.distanceTraveledMeters / 1609.344) : null,
      idleMinutes: r.engineIdleTimeDurationMs != null ? Math.round(r.engineIdleTimeDurationMs / 60000) : null,
      mpg: r.efficiencyMpge != null ? Number(r.efficiencyMpge) : null
    }));
  } catch { return null; }
}

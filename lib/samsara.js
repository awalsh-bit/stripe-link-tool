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

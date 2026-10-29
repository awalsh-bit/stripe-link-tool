// ---------------------------------------------------------------------------
// Mapbox (Andrew 10/29, Project Manager route planner). Server-side only —
// MAPBOX_TOKEN is a secret token (geocoding + optimization); the browser map
// uses MAPBOX_PUBLIC_TOKEN (a pk. token, which Mapbox designs to be public,
// URL-restricted on the Mapbox side to agility.wilsonappliance.com).
// ---------------------------------------------------------------------------

const TOKEN = process.env.MAPBOX_TOKEN || "";
const BASE = (process.env.MAPBOX_API_BASE || "https://api.mapbox.com").replace(/\/$/, "");

export const mapboxConfigured = () => Boolean(TOKEN);
export const mapboxPublicToken = () => process.env.MAPBOX_PUBLIC_TOKEN || "";

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `Mapbox ${res.status}`);
    return data;
  } finally { clearTimeout(t); }
}

// Forward geocode one address (US, best match). → { lat, lng, place } | null
export async function geocodeAddress(address) {
  const q = String(address || "").trim();
  if (!TOKEN || !q) return null;
  const url = `${BASE}/search/geocode/v6/forward?q=${encodeURIComponent(q)}&country=us&limit=1&access_token=${encodeURIComponent(TOKEN)}`;
  const data = await getJson(url);
  const f = data?.features?.[0];
  const c = f?.geometry?.coordinates;
  if (!c || c.length < 2) return null;
  return { lng: Number(c[0]), lat: Number(c[1]), place: f?.properties?.full_address || f?.properties?.name || "" };
}

// Optimized round trip from `origin` through `stops` (≤ 11 — the Optimization
// v1 API takes 12 coordinates). → { order: [stopIndex…], legs: [{from, to,
// seconds, meters}], totalSeconds, totalMeters, geometry (GeoJSON LineString) }
export async function optimizeRoundTrip(origin, stops) {
  if (!TOKEN) throw new Error("Mapbox isn't configured (MAPBOX_TOKEN).");
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) throw new Error("The route start has no coordinates yet — save the start address on Project Parameters.");
  const pts = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (!pts.length) throw new Error("None of the chosen projects has a mapped address.");
  if (pts.length > 11) throw new Error("Mapbox optimizes up to 11 stops per trip — pick fewer, or split the day.");
  const coords = [origin, ...pts].map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${BASE}/optimized-trips/v1/mapbox/driving/${coords}?source=first&destination=first&roundtrip=true&geometries=geojson&overview=full&steps=false&access_token=${encodeURIComponent(TOKEN)}`;
  const data = await getJson(url);
  if (data.code !== "Ok" || !data.trips?.[0]) throw new Error(data.message || `Mapbox could not build a route (${data.code || "no trip"}).`);
  const trip = data.trips[0];
  // waypoints[i] is input i; waypoint_index is its position on the trip.
  const order = (data.waypoints || []).map((w, inputIndex) => ({ inputIndex, tripIndex: w.waypoint_index })).sort((a, b) => a.tripIndex - b.tripIndex).map((w) => w.inputIndex).filter((i) => i > 0).map((i) => i - 1);
  const legs = (trip.legs || []).map((l) => ({ seconds: Math.round(l.duration || 0), meters: Math.round(l.distance || 0) }));
  return { order, legs, totalSeconds: Math.round(trip.duration || 0), totalMeters: Math.round(trip.distance || 0), geometry: trip.geometry || null };
}

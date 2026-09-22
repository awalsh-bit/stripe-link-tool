import { getSettings as getJourneySettings, boardInternals } from "./service-journey-postgres.js";
import { PLACEMENT_DEFAULTS, estMinutes, listTechDays, todayCentral } from "./service-scheduling-postgres.js";

// ---------------------------------------------------------------------------
// Service dispatch board (2026-09-22) — the live version of
// service-proto-board.html, in Client Care.
//
// Reads the ePASS mirror (sj_jobs, fed every 15 minutes by the ODBC feed),
// the roster (sj_techs), zones, the dispatcher's day controls (sj_tech_days)
// and route blocks (sj_route_blocks). Writes only what ePASS has no field
// for — stop order, half-day window, pin, force, blocks — plus route date /
// tech moves, which go out as the same sync packets the rest of the journey
// uses: a person keys them into ePASS, the next feed confirms them. Nothing
// here writes to ePASS.
//
// Drive times are haversine × placement.drive_min_per_km + drive_base_min
// (settings), the same numbers the placement engine uses, until a provider
// (Mapbox, doc 19 §4) calibrates them.
// ---------------------------------------------------------------------------
const { getReadyPool, getJobRow, updateJob, addHistory, createSyncItem, canonicalTech, CLOSED_STATUSES } = boardInternals;

export const BOARD_DEFAULTS = {
  ...PLACEMENT_DEFAULTS,
  "placement.shop_latlng": [30.1852, -98.0031],   // 4205 E Hwy 290, Dripping Springs
  "board.shift_start_min": 8 * 60,
  "board.am_end_min": 12 * 60,
  "board.pm_end_min": 17 * 60,
  "board.half_day_min": 240,
  "board.shop_touch_min": 10,                     // home-start tech with parts to pick up
  "board.drive_per_stop_guard_min": 35,
  "board.block_labels": ["Haircut", "Van maintenance", "Training", "Lunch", "DMV / errand", "Doctor", "Other"],
  "board.route_statuses": ["REQ", "SO1", "SO4PRE", "SO5", "SO6", "SO3PRE"]
};
const ROUTE_STATUSES_DEFAULT = BOARD_DEFAULTS["board.route_statuses"];

async function boardSettings() {
  const s = await getJourneySettings().catch(() => ({}));
  const out = { ...BOARD_DEFAULTS };
  for (const [k, v] of Object.entries(s)) if (k in BOARD_DEFAULTS) out[k] = v;
  return out;
}

const dateStr = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const addDays = (isoDate, n) => { const d = new Date(`${isoDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dow = (isoDate) => DOW[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
const mondayOf = (isoDate) => { const d = new Date(`${isoDate}T12:00:00Z`); const wd = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - ((wd + 6) % 7)); return d.toISOString().slice(0, 10); };

// Which tech-day rows to show: the roster's active techs, dispatch-visible
// ones first (auto_route), then the rest (JHM's west route, the manager).
function mapBoardTech(t) {
  const skills = (Array.isArray(t.skills) ? t.skills : []).map((s) => String(s).toLowerCase());
  return {
    id: t.sp_code, name: t.name || t.sp_code, role: t.role || "", skills,
    start: t.start_default === "home" ? "home" : "shop", end: t.end_default === "home" ? "home" : "shop",
    home: t.home_lat != null && t.home_lng != null ? [Number(t.home_lat), Number(t.home_lng)] : null,
    auto: !!t.auto_route, autoSchedule: !!t.auto_schedule, active: t.active !== false,
    workDays: String(t.work_days || "Mon,Tue,Wed,Thu,Fri").split(",").map((x) => x.trim()).filter(Boolean),
    note: t.notes || ""
  };
}

// The job as the board sees it (the prototype's J[] shape, plus what ePASS says).
function mapBoardJob(j, S) {
  const cat = String(j.unit_category || "").toLowerCase();
  const isHvac = cat.includes("hvac") || cat.includes("furnace") || cat.includes("heat pump") || cat.includes("thermostat") || String(j.qualification || "").toUpperCase() === "HVAC";
  const install = /^SO(4|5|6)/.test(String(j.status || ""));
  const units = Number(j.units) || 1;
  const dur = j.est_minutes != null ? Number(j.est_minutes) : estMinutes(S, { skill: isHvac ? "hvac" : "appliance", units, install });
  const bal = Number(j.balance) || 0;
  const unit = [j.unit_brand, j.unit_category, j.problem_text ? "· " + String(j.problem_text).slice(0, 80) : ""].filter(Boolean).join(" ").trim();
  return {
    sv: j.sv_number, cust: j.customer_name || "", addr: [j.address1, j.city].filter(Boolean).join(", "), zip: String(j.zip || "").slice(0, 5), zone: j.zone_code || "",
    ll: j.lat != null && j.lng != null ? [Number(j.lat), Number(j.lng)] : null,
    st: j.status || "", epassSt: j.epass_status || "", type: isHvac ? "hvac" : (j.unit_install_type === "built_in" && cat.includes("refrigerator") ? "sealed" : "appliance"),
    unit: unit || String(j.raw_detail || "").slice(0, 100), dur, durSource: j.est_minutes != null ? "units" : "default", units,
    win: j.time_window || "", bal: j.payment_type === "AR" || (j.flags || []).includes("AR") ? "A/R" : (bal > 0 && j.payment_type !== "WTY" ? "COD" : ""), balance: bal,
    wty: !!j.is_warranty, tech: j.assigned_tech || null, day: dateStr(j.route_date), seq: j.stop_seq == null ? 0 : Number(j.stop_seq),
    owner: j.owner_tech || null, eta: dateStr(j.parts_eta), lock: !!j.locked, forced: !!j.forced, note: j.dispatch_note || "",
    epass: { st: j.epass_status || "", day: dateStr(j.epass_route_date), tech: j.epass_tech_code || "", seenAt: j.epass_seen_at ? new Date(j.epass_seen_at).toISOString() : null, inFeed: !!j.in_feed },
    stale: !!j.stale, phone: j.phone || "", access: j.access_notes || "", qual: j.qualification || "", source: j.source || "", flags: j.flags || []
  };
}

export async function getServiceBoard({ from = "", days = 5 } = {}) {
  const pool = await getReadyPool();
  const S = await boardSettings();
  const today = todayCentral();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : mondayOf(today);
  const n = Math.min(Math.max(Number(days) || 5, 1), 14);
  const dates = Array.from({ length: n }, (_, i) => addDays(start, i));
  const to = dates[dates.length - 1];
  const routeStatuses = Array.isArray(S["board.route_statuses"]) ? S["board.route_statuses"] : ROUTE_STATUSES_DEFAULT;

  const [techRows, zoneRows, jobRows, blockRows, techDays, feedMeta] = await Promise.all([
    pool.query(`SELECT * FROM sj_techs WHERE active IS DISTINCT FROM FALSE ORDER BY auto_route DESC, sp_code`),
    pool.query(`SELECT zone_code, zone_group, booking_mode, primary_tech, secondary_techs, centroid_lat, centroid_lng FROM sj_zones`),
    // Everything open that is either on one of these days or waiting to be placed.
    pool.query(
      `SELECT * FROM sj_jobs
       WHERE closed_at IS NULL AND status <> ALL($3)
         AND NOT (in_feed = FALSE AND source = 'import')
         AND ( (route_date >= $1 AND route_date <= $2)
               OR ((route_date IS NULL OR assigned_tech IS NULL OR route_date < $4) AND status = ANY($5)) )
       ORDER BY route_date NULLS LAST, assigned_tech, stop_seq NULLS LAST, sv_number`,
      [start, to, CLOSED_STATUSES, today, routeStatuses]),
    pool.query(`SELECT id, tech_code, work_date::text AS work_date, start_min, end_min, label, set_by FROM sj_route_blocks WHERE work_date >= $1 AND work_date <= $2 ORDER BY work_date, start_min`, [start, to]),
    listTechDays({ from: start, to }),
    pool.query(`SELECT pulled_at, received_at, counts FROM epass_open_service_meta WHERE id = 1`).then((r) => r.rows[0] || null).catch(() => null)
  ]);

  // ZIP → point: the average of geocoded jobs there (the feed geocodes every
  // customer, so this is nearly always the real neighbourhood), else the zone centroid.
  const zipPts = (await pool.query(`SELECT LEFT(zip, 5) AS zip, AVG(lat)::float AS la, AVG(lng)::float AS ln FROM sj_jobs WHERE lat IS NOT NULL AND zip <> '' GROUP BY 1`)).rows;
  const ZIP = {}; for (const r of zipPts) ZIP[r.zip] = [r.la, r.ln];
  const zipZone = (await pool.query(`SELECT zip, zone_code FROM sj_zip_zones`)).rows;
  const ZONE = {}; for (const z of zoneRows.rows) ZONE[z.zone_code] = { zone: z.zone_code, group: z.zone_group || "", mode: z.booking_mode || "office_only", p: z.primary_tech || "", s: Array.isArray(z.secondary_techs) ? z.secondary_techs : [], ll: z.centroid_lat != null ? [Number(z.centroid_lat), Number(z.centroid_lng)] : null };
  const ZIPZONE = {}; for (const r of zipZone) ZIPZONE[r.zip] = r.zone_code;

  const techs = techRows.rows.map(mapBoardTech);
  const jobs = jobRows.rows.map((j) => mapBoardJob(j, S));
  const TD = {};
  for (const d of techDays) { (TD[d.tech_code] ||= {})[d.work_date] = { closed: d.available === false, open: d.available === true, reason: d.reason || "", adjust: Number(d.capacity_adjust_min) || 0, note: d.note || "", by: d.set_by || "" }; }
  const blocks = blockRows.rows.map((b) => ({ id: Number(b.id), tech: b.tech_code, day: b.work_date, start: Number(b.start_min), end: Number(b.end_min), label: b.label || "", by: b.set_by || "" }));

  return {
    today, days: dates.map((k) => ({ k, s: dow(k), n: new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) })),
    techs, zones: ZONE, zipZone: ZIPZONE, zipPts: ZIP, shop: { name: "Shop", ll: S["placement.shop_latlng"] },
    jobs, blocks, td: TD,
    settings: S,
    feed: feedMeta ? { pulledAt: feedMeta.pulled_at || "", receivedAt: feedMeta.received_at ? new Date(feedMeta.received_at).toISOString() : null, tickets: feedMeta.counts?.tickets ?? null } : null
  };
}

// ---- writes -----------------------------------------------------------------
const WINDOWS = new Set(["", "AM", "PM"]);
async function renumber(client, tech, date, order) {
  // `order` = sv numbers in stop order for that tech-day; anything on the day
  // not listed keeps its relative order after them.
  const rows = (await client.query(`SELECT sv_number FROM sj_jobs WHERE assigned_tech = $1 AND route_date = $2 AND closed_at IS NULL ORDER BY stop_seq NULLS LAST, sv_number`, [tech, date])).rows.map((r) => r.sv_number);
  const listed = (order || []).filter((sv) => rows.includes(sv));
  const seq = [...listed, ...rows.filter((sv) => !listed.includes(sv))];
  for (let i = 0; i < seq.length; i++) await client.query(`UPDATE sj_jobs SET stop_seq = $2 WHERE sv_number = $1`, [seq[i], i + 1]);
  return seq;
}

// Put a job on a tech's day (drag-drop, "Place there", Force it). The status
// follows the prototype's rule — SO5 becomes SO6 once a part install has a
// day, REQ becomes SO1 — and the whole thing goes out as one sync packet.
export async function moveServiceJob({ sv, tech, date, window = "", order = null, forced = false, by = "", note = "" }) {
  const pool = await getReadyPool();
  const code = String(sv || "").trim().toUpperCase();
  const t = await canonicalTech(pool, tech);
  if (!code || !t) throw new Error("Job and tech are required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Date is required (YYYY-MM-DD).");
  const win = String(window || "").toUpperCase();
  if (!WINDOWS.has(win)) throw new Error("Window must be AM, PM or blank.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = await getJobRow(client, code);
    if (!job) throw new Error(`${code} is not on the board.`);
    if (job.closed_at) throw new Error(`${code} is closed.`);
    const fromDay = dateStr(job.route_date), fromTech = job.assigned_tech;
    const status = job.status === "SO5" ? "SO6" : job.status === "REQ" ? "SO1" : job.status;
    const changes = { route_date: date, assigned_tech: t, time_window: win, forced: !!forced, source: "dashboard", updated_at: new Date() };
    if (status !== job.status) { changes.status = status; changes.status_changed_at = new Date(); }
    if (note) changes.dispatch_note = String(note).slice(0, 300);
    await updateJob(client, code, changes);
    if (fromTech && fromDay && (fromTech !== t || fromDay !== date)) await renumber(client, fromTech, fromDay, []);
    const seq = await renumber(client, t, date, order || []);
    await addHistory(client, { sv: code, from: job.status, to: status, actorType: "user", actorId: by, trigger: "board.move", note: `${fromTech || "—"} ${fromDay || "—"} → ${t} ${date}${win ? " " + win : ""}${forced ? " (forced)" : ""}` });
    const payload = { route_date: date, tech: t };
    if (win) payload.window = win;
    if (status !== job.status) payload.status = status;
    // One packet per job at a time: replace an unkeyed earlier move rather than stacking them.
    await client.query(`DELETE FROM sj_sync_items WHERE sv_number = $1 AND kind = 'route' AND state = 'pending'`, [code]);
    await createSyncItem(client, { ...job, sv_number: code }, "route", payload, { byEmail: by, note: note ? String(note).slice(0, 200) : "" });
    await client.query("COMMIT");
    return { sv: code, tech: t, date, window: win, status, seq };
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}

// Take a job off its day (back to the unscheduled lane). SO6 falls back to
// SO5 — the part is still in — everything else keeps its status.
export async function unscheduleServiceJob({ sv, by = "", note = "" }) {
  const pool = await getReadyPool();
  const code = String(sv || "").trim().toUpperCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = await getJobRow(client, code);
    if (!job) throw new Error(`${code} is not on the board.`);
    const status = job.status === "SO6" ? "SO5" : job.status;
    const changes = { route_date: null, assigned_tech: null, time_window: "", stop_seq: null, forced: false, source: "dashboard", updated_at: new Date() };
    if (status !== job.status) { changes.status = status; changes.status_changed_at = new Date(); }
    await updateJob(client, code, changes);
    if (job.assigned_tech && job.route_date) await renumber(client, job.assigned_tech, dateStr(job.route_date), []);
    await addHistory(client, { sv: code, from: job.status, to: status, actorType: "user", actorId: by, trigger: "board.unschedule", note: `off ${job.assigned_tech || "—"} ${dateStr(job.route_date) || "—"}` });
    await client.query(`DELETE FROM sj_sync_items WHERE sv_number = $1 AND kind = 'route' AND state = 'pending'`, [code]);
    await createSyncItem(client, { ...job, sv_number: code }, "route", { status, note: `Remove from ${job.assigned_tech || ""} ${dateStr(job.route_date) || ""} — unscheduled${note ? "; " + note : ""}` }, { byEmail: by });
    await client.query("COMMIT");
    return { sv: code, status };
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}

// Stop order and windows for one tech-day (re-optimize, or a drag within the day). No packet: ePASS has no stop order.
export async function sequenceTechDay({ tech, date, order, windows = null, by = "" }) {
  const pool = await getReadyPool();
  const t = await canonicalTech(pool, tech);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Tech and date are required.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seq = await renumber(client, t, date, (order || []).map((s) => String(s).toUpperCase()));
    if (windows && typeof windows === "object") {
      for (const [sv, w] of Object.entries(windows)) { const win = String(w || "").toUpperCase(); if (WINDOWS.has(win)) await client.query(`UPDATE sj_jobs SET time_window = $2 WHERE sv_number = $1 AND assigned_tech = $3 AND route_date = $4`, [String(sv).toUpperCase(), win, t, date]); }
    }
    await client.query("COMMIT");
    return { tech: t, date, seq };
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}

export async function setJobDispatchFlags({ sv, locked, note, partsEta, by = "" }) {
  const pool = await getReadyPool();
  const code = String(sv || "").trim().toUpperCase();
  const changes = { updated_at: new Date() };
  if (locked != null) changes.locked = !!locked;
  if (note != null) changes.dispatch_note = String(note).slice(0, 300);
  if (partsEta !== undefined) changes.parts_eta = partsEta && /^\d{4}-\d{2}-\d{2}$/.test(partsEta) ? partsEta : null;
  const client = await pool.connect();
  try {
    const job = await getJobRow(client, code);
    if (!job) throw new Error(`${code} is not on the board.`);
    await updateJob(client, code, changes);
    return { sv: code, ...changes };
  } finally { client.release(); }
}

export async function addRouteBlock({ tech, date, startMin, endMin, label = "", by = "" }) {
  const pool = await getReadyPool();
  const t = await canonicalTech(pool, tech);
  const s = Number(startMin), e = Number(endMin);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Tech and date are required.");
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || s < 0 || e > 24 * 60) throw new Error("Block needs a start and an end (minutes of the day).");
  const r = await pool.query(`INSERT INTO sj_route_blocks (tech_code, work_date, start_min, end_min, label, set_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [t, date, Math.round(s), Math.round(e), String(label || "").slice(0, 60), by]);
  return { id: Number(r.rows[0].id), tech: t, day: date, start: Math.round(s), end: Math.round(e), label: String(label || "").slice(0, 60) };
}
export async function removeRouteBlock(id) {
  const pool = await getReadyPool();
  const r = await pool.query(`DELETE FROM sj_route_blocks WHERE id = $1`, [Number(id)]);
  return { removed: r.rowCount };
}

import { getSettings as getJourneySettings, boardInternals, invalidateTechCache } from "./service-journey-postgres.js";
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
  "board.route_statuses": ["REQ", "SO1", "SO4PRE", "SO5", "SO6", "SO3PRE"],
  // Waiting on parts: in the Unscheduled pool so the office sees them, placed
  // only once the office has entered a parts ETA (service-office.html).
  "board.parts_statuses": ["SO3", "SO4", "SO4B", "SO4H"],
  // Customer texts from the board. OFF: Confirm route / reschedule still
  // record the decision and lock the stops, and show the exact wording, but
  // nothing is sent until these are true (standing rule: no automated
  // customer contact without an explicit switch).
  "notify.route_confirm.enabled": false,
  "notify.reschedule.enabled": false,
  "board.commute_allow_min": 45
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
  const skills = (Array.isArray(t.skills) ? t.skills : []).map((s) => String(s).toLowerCase().replace(/\s+/g, "-"));
  const mode = t.mode || (t.auto_route ? "route" : "office");
  return {
    id: t.sp_code, name: t.name || t.sp_code, role: t.role || "", skills, aliases: (Array.isArray(t.aliases) ? t.aliases : []).map((a) => String(a).toUpperCase()),
    start: t.start_default === "home" ? "home" : "shop", end: t.end_default === "home" ? "home" : "shop",
    home: t.home_lat != null && t.home_lng != null ? [Number(t.home_lat), Number(t.home_lng)] : null,
    auto: mode === "route" && !!t.auto_route, mode, autoSchedule: !!t.auto_schedule, active: t.active !== false, retireOn: t.retire_on ? dateStr(t.retire_on) : "",
    workDays: String(t.work_days || "Mon,Tue,Wed,Thu,Fri").split(",").map((x) => x.trim()).filter(Boolean),
    pattern: t.pattern && typeof t.pattern === "object" ? t.pattern : {},
    commuteAllow: t.commute_allow_min == null ? null : Number(t.commute_allow_min), maxStops: t.max_stops == null ? null : Number(t.max_stops),
    maxOnsite: t.max_onsite_min == null ? null : Number(t.max_onsite_min), maxDrive: t.max_drive_min == null ? null : Number(t.max_drive_min),
    overflow: t.accepts_overflow !== false, dayEnd: t.day_end_min == null ? null : Number(t.day_end_min),
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
    owner: j.owner_tech || null, eta: dateStr(j.parts_eta), po: j.parts_po || "", partsNote: j.parts_note || "", lock: !!j.locked, forced: !!j.forced, note: j.dispatch_note || "", confirmed: !!j.confirmed_at,
    cx: j.status === "SO9" ? { reason: j.cancel_reason || "", at: j.status_changed_at ? new Date(j.status_changed_at).toISOString() : null, snap: j.cancel_snapshot || null } : null,
    si: /^SI/.test(String(j.status || "")) ? { in: dateStr(j.status_changed_at), sched: [] } : null,
    epass: { st: j.epass_status || "", day: dateStr(j.epass_route_date), tech: j.epass_tech_code || "", seenAt: j.epass_seen_at ? new Date(j.epass_seen_at).toISOString() : null, inFeed: !!j.in_feed },
    stale: !!j.stale, phone: j.phone || "", access: j.access_notes || "", qual: j.qualification || "", source: j.source || "", flags: j.flags || []
  };
}

let boardSchemaDone = null;
async function boardPool() {
  const pool = await getReadyPool();
  if (!boardSchemaDone) boardSchemaDone = pool.query(`ALTER TABLE sj_tech_days ADD COLUMN IF NOT EXISTS parts_loaded BOOLEAN NOT NULL DEFAULT FALSE`).catch((e) => { boardSchemaDone = null; throw e; });
  await boardSchemaDone;
  return pool;
}
export async function getServiceBoard({ from = "", days = 5 } = {}) {
  const pool = await boardPool();
  const S = await boardSettings();
  const today = todayCentral();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : mondayOf(today);
  const n = Math.min(Math.max(Number(days) || 5, 1), 14);
  const dates = Array.from({ length: n }, (_, i) => addDays(start, i));
  const to = dates[dates.length - 1];
  const routeStatuses = Array.isArray(S["board.route_statuses"]) ? S["board.route_statuses"] : ROUTE_STATUSES_DEFAULT;
  const poolStatuses = [...new Set([...routeStatuses, ...(Array.isArray(S["board.parts_statuses"]) ? S["board.parts_statuses"] : BOARD_DEFAULTS["board.parts_statuses"])])];

  const [techRows, zoneRows, jobRows, blockRows, techDays, feedMeta, confRows, partsLoaded] = await Promise.all([
    pool.query(`SELECT * FROM sj_techs WHERE active IS DISTINCT FROM FALSE OR retire_on >= $1 ORDER BY auto_route DESC, sp_code`, [start]),
    pool.query(`SELECT zone_code, zone_group, booking_mode, primary_tech, secondary_techs, centroid_lat, centroid_lng FROM sj_zones`),
    // Everything open on one of these days or waiting to be placed; plus the
    // in-shop lane (SI*), a collector's whole lane, and the last three days'
    // cancellations (so they can be undone).
    pool.query(
      `SELECT j.* FROM sj_jobs j
       WHERE NOT (j.in_feed = FALSE AND j.source = 'import')
         AND ( (j.closed_at IS NULL AND j.status <> ALL($3) AND (
                 (j.route_date >= $1 AND j.route_date <= $2)
                 OR ((j.route_date IS NULL OR j.assigned_tech IS NULL OR j.route_date < $4) AND j.status = ANY($5))
                 OR j.status LIKE 'SI%'
                 OR j.assigned_tech IN (SELECT sp_code FROM sj_techs WHERE mode = 'collector') ))
               OR (j.status = 'SO9' AND j.cancel_snapshot IS NOT NULL AND j.status_changed_at >= NOW() - INTERVAL '3 days') )
       ORDER BY j.route_date NULLS LAST, j.assigned_tech, j.stop_seq NULLS LAST, j.sv_number`,
      [start, to, CLOSED_STATUSES, today, poolStatuses]),
    pool.query(`SELECT id, tech_code, work_date::text AS work_date, start_min, end_min, label, set_by FROM sj_route_blocks WHERE work_date >= $1 AND work_date <= $2 ORDER BY work_date, start_min`, [start, to]),
    listTechDays({ from: start, to }),
    pool.query(`SELECT pulled_at, received_at, counts FROM epass_open_service_meta WHERE id = 1`).then((r) => r.rows[0] || null).catch(() => null),
    pool.query(`SELECT tech_code, work_date::text AS work_date, stops, sent, confirmed_by, confirmed_at FROM sj_route_confirmations WHERE work_date >= $1 AND work_date <= $2`, [start, to]),
    pool.query(`SELECT tech_code, work_date::text AS work_date, parts_loaded FROM sj_tech_days WHERE work_date >= $1 AND work_date <= $2 AND parts_loaded`, [start, to])
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
  for (const r of partsLoaded.rows) { ((TD[r.tech_code] ||= {})[r.work_date] ||= { adjust: 0 }).loadedPrev = true; }
  const blocks = blockRows.rows.map((b) => ({ id: Number(b.id), tech: b.tech_code, day: b.work_date, start: Number(b.start_min), end: Number(b.end_min), label: b.label || "", by: b.set_by || "" }));
  const CONFIRMED = {};
  for (const c of confRows.rows) CONFIRMED[`${c.tech_code}|${c.work_date}`] = { n: Number(c.stops) || 0, sent: !!c.sent, by: c.confirmed_by || "", at: c.confirmed_at ? new Date(c.confirmed_at).toISOString() : null };

  // Self-schedule holds: a customer picked a day on schedule.html and the
  // engine put them on a tech; until the office books the SV in ePASS the
  // hold is the stop. Shown on the board as a HOLD card, counted in capacity.
  const holdRows = (await pool.query(`SELECT id, card_id, zip, zone_code, skill, units, est_minutes, picked_date::text AS day, picked_window, tech_code, picked_at, pick_meta FROM sj_self_holds WHERE released_at IS NULL AND kind = 'picked' AND picked_date >= $1 AND picked_date <= $2 ORDER BY picked_date, id`, [start, to]).catch(() => ({ rows: [] }))).rows;
  const holds = holdRows.map((h) => ({ id: Number(h.id), cardId: h.card_id, zip: String(h.zip || "").slice(0, 5), zone: h.zone_code || "", skill: h.skill || "appliance", units: Number(h.units) || 1, est: Number(h.est_minutes) || 60, day: h.day, win: h.picked_window === "AM" || h.picked_window === "PM" ? h.picked_window : "", tech: h.tech_code || "", pickedAt: h.picked_at ? new Date(h.picked_at).toISOString() : null, why: h.pick_meta?.why || "", by: h.pick_meta?.by || "client" }));

  return {
    today, days: dates.map((k) => ({ k, s: dow(k), n: new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) })),
    techs, zones: ZONE, zipZone: ZIPZONE, zipPts: ZIP, shop: { name: "Shop", ll: S["placement.shop_latlng"] },
    jobs, holds, blocks, td: TD, confirmed: CONFIRMED, notify: { routeConfirm: S["notify.route_confirm.enabled"] === true, reschedule: S["notify.reschedule.enabled"] === true },
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

// ---- route settings (the tech, not the day) --------------------------------
const TECH_SKILLS = ["appliance", "sealed", "hvac", "hvac-backup"];
export async function saveTechSettings(code, f = {}, by = "") {
  const pool = await boardPool();
  const id = String(code || f.id || "").trim().toUpperCase().slice(0, 10);
  if (!id) throw new Error("A tech code is required.");
  const intOrNull = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
  const skills = Array.isArray(f.skills) ? f.skills.map((x) => String(x).toLowerCase()).filter((x) => TECH_SKILLS.includes(x)) : null;
  const pattern = {};
  if (f.pattern && typeof f.pattern === "object") {
    for (const d of DOW) { const p = f.pattern[d]; if (!p || typeof p !== "object") continue; const row = {}; for (const k of ["start", "end"]) if (p[k] != null && p[k] !== "") row[k] = intOrNull(p[k]); for (const k of ["startAt", "endAt"]) if (p[k] === "shop" || p[k] === "home") row[k] = p[k]; if (p.why) row.why = String(p.why).slice(0, 80); if (Object.keys(row).length) pattern[d] = row; }
  }
  const workDays = Array.isArray(f.workDays) ? f.workDays.filter((d) => DOW.includes(d)).join(",") : null;
  const mode = ["route", "office", "collector"].includes(f.mode) ? f.mode : null;
  const client = await pool.connect();
  try {
    const cur = (await client.query(`SELECT * FROM sj_techs WHERE sp_code = $1`, [id])).rows[0];
    if (!cur) {
      if (!f.name) throw new Error("A name is required for a new tech.");
      await client.query(`INSERT INTO sj_techs (sp_code, name, role, aliases, skills, start_default, end_default, work_days, auto_route, auto_schedule, active, notes) VALUES ($1,$2,'tech','[]'::jsonb,$3::jsonb,$4,$5,$6,$7,FALSE,TRUE,$8)`,
        [id, String(f.name).slice(0, 80), JSON.stringify(skills || ["appliance"]), f.start === "home" ? "home" : "shop", f.end === "home" ? "home" : "shop", workDays || "Mon,Tue,Wed,Thu,Fri", mode ? mode === "route" : true, String(f.note || "").slice(0, 200)]);
    }
    const sets = [], vals = [];
    const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (f.name != null) put("name", String(f.name).slice(0, 80));
    if (skills) put("skills", JSON.stringify(skills));
    if (f.start != null) put("start_default", f.start === "home" ? "home" : "shop");
    if (f.end != null) put("end_default", f.end === "home" ? "home" : "shop");
    if (workDays != null) put("work_days", workDays);
    if (f.pattern != null) put("pattern", JSON.stringify(pattern));
    if ("commuteAllow" in f) put("commute_allow_min", intOrNull(f.commuteAllow));
    if ("maxStops" in f) put("max_stops", intOrNull(f.maxStops));
    if ("maxOnsite" in f) put("max_onsite_min", intOrNull(f.maxOnsite));
    if ("maxDrive" in f) put("max_drive_min", intOrNull(f.maxDrive));
    if ("overflow" in f) put("accepts_overflow", f.overflow !== false);
    if ("dayEnd" in f) put("day_end_min", intOrNull(f.dayEnd));
    if (mode) { put("mode", mode); put("auto_route", mode === "route"); }
    if (f.note != null) put("notes", String(f.note).slice(0, 200));
    if (Array.isArray(f.aliases)) { const al = [...new Set(f.aliases.map((a) => String(a).trim().toUpperCase().slice(0, 12)).filter((a) => a && a !== id))]; put("aliases", JSON.stringify(al)); }
    if ("retireOn" in f) { const r = f.retireOn && /^\d{4}-\d{2}-\d{2}$/.test(f.retireOn) ? f.retireOn : null; put("retire_on", r); put("active", !r); if (r) put("auto_route", false); }
    if (f.home && Array.isArray(f.home) && f.home.length === 2) { put("home_lat", Number(f.home[0]) || null); put("home_lng", Number(f.home[1]) || null); }
    put("settings_by", String(by || "").slice(0, 120)); vals.push(id);
    await client.query(`UPDATE sj_techs SET ${sets.join(", ")}, settings_at = NOW() WHERE sp_code = $${vals.length}`, vals);
    invalidateTechCache();
    const row = (await client.query(`SELECT * FROM sj_techs WHERE sp_code = $1`, [id])).rows[0];
    return mapBoardTech(row);
  } finally { client.release(); }
}

export async function setPartsLoaded({ tech, date, loaded, by = "" }) {
  const pool = await boardPool();
  const t = await canonicalTech(pool, tech);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Tech and date are required.");
  await pool.query(`INSERT INTO sj_tech_days (tech_code, work_date, parts_loaded, set_by) VALUES ($1,$2,$3,$4) ON CONFLICT (tech_code, work_date) DO UPDATE SET parts_loaded = EXCLUDED.parts_loaded`, [t, date, !!loaded, by]);
  return { tech: t, date, loaded: !!loaded };
}

// ---- confirm a day's route ---------------------------------------------------
// Locks every stop on the tech-day, records who confirmed it, and returns the
// text each customer would get. Sending happens only when
// notify.route_confirm.enabled is true AND a sender is supplied; otherwise the
// texts are kept on the record as "not sent" and the page says so.
const winWords = (w) => (w === "PM" ? "12 and 5 PM" : w === "AM" ? "8 AM and 12 PM" : "8 AM and 5 PM");
const longDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
export function routeConfirmText(job, techName) {
  const first = String(techName || job.assigned_tech || "your technician").split(" ")[0];
  return `Wilson Appliance: you're booked for ${longDay(dateStr(job.route_date))} between ${winWords(job.time_window)}. ${first} is your technician and will text when he's on the way. Reply to this message if you need to change it. — ${job.sv_number}`;
}
export async function confirmRouteDay({ tech, date, by = "", sender = null }) {
  const pool = await boardPool();
  const S = await boardSettings();
  const t = await canonicalTech(pool, tech);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Tech and date are required.");
  const techRow = (await pool.query(`SELECT name FROM sj_techs WHERE sp_code = $1`, [t])).rows[0];
  const stops = (await pool.query(`SELECT * FROM sj_jobs WHERE assigned_tech = $1 AND route_date = $2 AND closed_at IS NULL AND status NOT LIKE 'SI%' AND status <> ALL($3) AND NOT (in_feed = FALSE AND source = 'import') ORDER BY stop_seq NULLS LAST, sv_number`, [t, date, CLOSED_STATUSES])).rows;
  if (!stops.length) throw new Error("Nothing on that day to confirm.");
  const enabled = S["notify.route_confirm.enabled"] === true && typeof sender === "function";
  const texts = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const j of stops) {
      const body = routeConfirmText(j, techRow?.name);
      let result = { ok: false, skipped: enabled ? "" : "texting off" };
      if (enabled && j.phone) { try { result = await sender({ phone: j.phone, body, sv: j.sv_number }); } catch (err) { result = { ok: false, error: err.message }; } }
      else if (enabled && !j.phone) result = { ok: false, skipped: "no phone" };
      texts.push({ sv: j.sv_number, phone: j.phone || "", body, ok: !!result.ok, skipped: result.skipped || "", error: result.error || "" });
      await updateJob(client, j.sv_number, { locked: true, confirmed_at: new Date(), updated_at: new Date() });
      await addHistory(client, { sv: j.sv_number, from: j.status, to: j.status, actorType: "user", actorId: by, trigger: "board.route_confirmed", note: `${t} ${date}${result.ok ? " · customer texted" : enabled ? " · text not sent (" + (result.skipped || result.error) + ")" : " · texting off"}` });
    }
    const sent = texts.some((x) => x.ok);
    await client.query(`INSERT INTO sj_route_confirmations (tech_code, work_date, stops, texts, sent, confirmed_by, confirmed_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,NOW())
      ON CONFLICT (tech_code, work_date) DO UPDATE SET stops = EXCLUDED.stops, texts = EXCLUDED.texts, sent = sj_route_confirmations.sent OR EXCLUDED.sent, confirmed_by = EXCLUDED.confirmed_by, confirmed_at = NOW()`, [t, date, stops.length, JSON.stringify(texts), sent, by]);
    await client.query("COMMIT");
    return { tech: t, date, n: stops.length, sent, textingOn: enabled, texts };
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}

// ---- self-schedule holds on the board ---------------------------------------
// The office moves a hold (the customer called, or dispatch rebalances); the
// queue card follows through server.js. Releasing happens where it always
// did: when the card is marked Call Scheduled with the SV number.
export async function moveSelfHold({ id, tech, date, window = "", by = "" }) {
  const pool = await boardPool();
  const t = await canonicalTech(pool, tech);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Tech and date are required.");
  const win = ["AM", "PM"].includes(window) ? window : "ANY";
  const r = await pool.query(`UPDATE sj_self_holds SET tech_code = $2, picked_date = $3, picked_window = $4, pick_meta = pick_meta || $5::jsonb, updated_at = NOW() WHERE id = $1 AND released_at IS NULL AND kind = 'picked' RETURNING id, card_id, picked_date::text AS day, picked_window, tech_code`, [Number(id), t, date, win, JSON.stringify({ movedBy: by, movedAt: new Date().toISOString(), movedTo: { tech: t, date, window: win } })]);
  if (!r.rows[0]) throw new Error("That hold is no longer open.");
  return { id: Number(r.rows[0].id), cardId: r.rows[0].card_id, day: r.rows[0].day, win: r.rows[0].picked_window, tech: r.rows[0].tech_code };
}

// ---- service history for a card ---------------------------------------------
// Everything we know about this customer: the ticket's own timeline here,
// the other tickets in the mirror (open or closed) for the same customer /
// phone / address / unit, and the finished ePASS invoices the feed carries
// for them (epass_service_history, last 3 years).
export async function getServiceHistory(sv) {
  const pool = await boardPool();
  const code = String(sv || "").trim().toUpperCase();
  const job = await getJobRow(pool, code);
  if (!job) throw new Error(`${code} is not on the board.`);
  const phone = String(job.phone || "").replace(/\D/g, "").slice(-10), addr = String(job.address1 || "").trim().toUpperCase(), zip = String(job.zip || "").trim().slice(0, 5), serial = String(job.unit_serial || "").trim().toUpperCase(), cust = String(job.customer_code || "").trim();
  const clauses = [], params = [code];
  const add = (sql, v) => { params.push(v); clauses.push(sql.replace("?", "$" + params.length)); };
  if (cust) add("customer_code = ?", cust);
  if (phone) { params.push(phone); clauses.push(`(phone = $${params.length} OR phone_alt = $${params.length})`); }
  if (serial.length > 4) add("UPPER(unit_serial) = ?", serial);
  if (addr && zip) { params.push(addr); params.push(zip); clauses.push(`(UPPER(address1) = $${params.length - 1} AND LEFT(zip, 5) = $${params.length})`); }
  const related = clauses.length ? (await pool.query(`SELECT * FROM sj_jobs WHERE sv_number <> $1 AND (${clauses.join(" OR ")}) ORDER BY COALESCE(epass_created_at, first_seen_at::date) DESC LIMIT 60`, params)).rows : [];
  const hClauses = [], hParams = [];
  const hadd = (sql, v) => { hParams.push(v); hClauses.push(sql.replace("?", "$" + hParams.length)); };
  if (cust) hadd("sold_to_code = ?", cust);
  if (phone) hadd("phone = ?", phone);
  if (serial.length > 4) hadd("serial = ?", serial);
  if (addr && zip) { hParams.push(addr); hParams.push(zip); hClauses.push(`(address1 = $${hParams.length - 1} AND zip = $${hParams.length})`); }
  const epass = hClauses.length ? (await pool.query(`SELECT code, raw, serial FROM epass_service_history WHERE ${hClauses.join(" OR ")} ORDER BY date_created DESC LIMIT 60`).catch(() => ({ rows: [] }))).rows : [];
  const hist = (await pool.query(`SELECT * FROM sj_status_history WHERE sv_number = $1 ORDER BY changed_at DESC, id DESC LIMIT 40`, [code])).rows;
  const seen = new Set([code]);
  const out = [];
  for (const r of related) {
    seen.add(r.sv_number);
    out.push({ sv: r.sv_number, source: "board", st: r.status, open: !r.closed_at, created: dateStr(r.epass_created_at) || dateStr(r.first_seen_at), day: dateStr(r.route_date), tech: r.assigned_tech || r.epass_tech_code || "", unit: [r.unit_brand, r.unit_model].filter(Boolean).join(" "), serial: r.unit_serial || "", problem: r.problem_text || "", sameUnit: !!serial && String(r.unit_serial || "").toUpperCase() === serial, total: r.total == null ? null : Number(r.total) });
  }
  const pick = (row, ...names) => { for (const n of names) { const k = Object.keys(row || {}).find((x) => x.toLowerCase() === n.toLowerCase()); if (k != null && row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim(); } return ""; };
  for (const r of epass) {
    if (seen.has(r.code)) continue; seen.add(r.code);
    const raw = r.raw || {};
    const total = ["SerialTotal", "ItemTotal", "LaborTotal", "MiscTotal", "WtyTotal", "Tax1Total", "Tax2Total", "Tax3Total"].reduce((a, c) => a + (Number(pick(raw, c)) || 0), 0);
    out.push({ sv: r.code, source: "epass", st: pick(raw, "JobStatusCode"), open: false, created: pick(raw, "DateCreated").slice(0, 10), finished: pick(raw, "DateFinished").slice(0, 10), day: pick(raw, "SvcScheduleDate").slice(0, 10), tech: pick(raw, "Salesperson1Code"), unit: [pick(raw, "SvcBrandCode"), pick(raw, "SvcModel")].filter(Boolean).join(" "), serial: pick(raw, "SvcSerial"), problem: pick(raw, "SvcComplaintDesc").slice(0, 400), performed: pick(raw, "SvcPerformedDesc").slice(0, 400), sameUnit: !!serial && String(r.serial || "").toUpperCase() === serial, total: Math.round(total * 100) / 100, wty: pick(raw, "InvTypeCode").toUpperCase() === "WTY" });
  }
  out.sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
  const historyFeed = (await pool.query(`SELECT COUNT(*)::int AS n FROM epass_service_history`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
  return {
    sv: code, cust: job.customer_name || "", phone, addr: job.address1 || "", zip: job.zip || "", customerCode: cust, unit: [job.unit_brand, job.unit_model].filter(Boolean).join(" "), serial,
    timeline: hist.map((h) => ({ at: h.changed_at ? new Date(h.changed_at).toISOString() : null, from: h.from_status, to: h.to_status, by: h.actor_id || h.actor_type || "", trigger: h.trigger_event || "", note: h.note || "" })),
    visits: out, historyFeedLoaded: historyFeed > 0
  };
}

// ---- diagnose: why is the board (not) populated by tech? -------------------
// Reads the raw feed and the mirror side by side so the office can see where
// the tech mapping breaks: which Salesperson1Code values the feed carries,
// whether each one is in the roster, what the mirror has for assigned_tech,
// and whether a pending packet is holding a ticket back from following ePASS.
export async function diagnoseServiceBoard() {
  const pool = await boardPool();
  const S = await getJourneySettings().catch(() => ({}));
  const techs = (await pool.query(`SELECT sp_code, name, aliases, active, mode FROM sj_techs ORDER BY sp_code`)).rows;
  const roster = new Map();
  for (const t of techs) { roster.set(t.sp_code.toUpperCase(), t.sp_code); for (const a of (t.aliases || [])) roster.set(String(a).toUpperCase(), t.sp_code); }
  const meta = (await pool.query(`SELECT pulled_at, received_at, filename, counts FROM epass_open_service_meta WHERE id = 1`).catch(() => ({ rows: [] }))).rows[0] || null;
  const raw = (await pool.query(`SELECT code, raw FROM epass_open_service`).catch(() => ({ rows: [] }))).rows;
  const pick = (row, ...names) => { for (const n of names) { const k = Object.keys(row || {}).find((x) => x.toLowerCase() === n.toLowerCase()); if (k != null && row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim(); } return ""; };
  const feed = { tickets: raw.length, sv: 0, withSalesperson: 0, withRoute: 0, withScheduleDate: 0, salesperson: {}, route: {}, columnsSeen: [] };
  const colSet = new Set();
  for (const r of raw) {
    const sv = String(r.code || "").toUpperCase(); if (!/^SV/.test(sv)) continue; feed.sv += 1;
    for (const k of Object.keys(r.raw || {})) if (/sales|route|sched|dispatch|tech/i.test(k)) colSet.add(k);
    const sp = pick(r.raw, "Salesperson1Code", "SalespersonCode", "SalesPersonCode"), rt = pick(r.raw, "DispatchRequestedRouteCode"), sd = pick(r.raw, "SvcScheduleDate") || pick(r.raw, "ScheduleDate");
    if (sp) { feed.withSalesperson += 1; const k = sp.toUpperCase(); feed.salesperson[k] = feed.salesperson[k] || { n: 0, roster: roster.get(k) || null }; feed.salesperson[k].n += 1; }
    if (rt) { feed.withRoute += 1; const k = rt.toUpperCase(); feed.route[k] = feed.route[k] || { n: 0, roster: roster.get(k) || null }; feed.route[k].n += 1; }
    if (sd) feed.withScheduleDate += 1;
  }
  feed.columnsSeen = [...colSet].sort();
  const mirror = (await pool.query(`SELECT assigned_tech, epass_tech_code, source, in_feed, (route_date IS NOT NULL) AS dated, (closed_at IS NULL) AS open, status FROM sj_jobs WHERE in_feed`)).rows;
  const m = { inFeed: mirror.length, open: 0, dated: 0, byEpassTech: {}, byAssigned: {}, bySource: {}, epassTechNotInRoster: 0, assignedNotInRoster: 0, epassVsAssignedDiffer: 0 };
  for (const j of mirror) {
    if (j.open) m.open += 1; if (j.dated) m.dated += 1;
    const e = (j.epass_tech_code || "").toUpperCase(), a = (j.assigned_tech || "").toUpperCase();
    m.byEpassTech[e || "(blank)"] = (m.byEpassTech[e || "(blank)"] || 0) + 1; m.byAssigned[a || "(blank)"] = (m.byAssigned[a || "(blank)"] || 0) + 1; m.bySource[j.source] = (m.bySource[j.source] || 0) + 1;
    if (e && !roster.has(e)) m.epassTechNotInRoster += 1; if (a && !roster.has(a)) m.assignedNotInRoster += 1; if (e !== a) m.epassVsAssignedDiffer += 1;
  }
  const holding = (await pool.query(`SELECT COUNT(DISTINCT sv_number)::int AS n FROM sj_sync_items WHERE state IN ('pending','keyed')`)).rows[0].n;
  const batches = (await pool.query(`SELECT id, source, file_name, status, message, imported_at FROM sj_import_batches WHERE source = 'epassfeed' ORDER BY id DESC LIMIT 5`)).rows;
  return { generatedAt: new Date().toISOString(), settings: { followEpass: S["sync.follow_epass_for_import_jobs"] !== false }, roster: techs.map((t) => ({ code: t.sp_code, name: t.name, aliases: t.aliases || [], active: t.active !== false, mode: t.mode || "route" })), feedMeta: meta, feed, mirror: m, ticketsHeldByOpenPackets: holding, lastFeedImports: batches };
}

// ---- cancel / uncancel a call -------------------------------------------------
export const CANCEL_REASONS = [["fixed", "It started working again"], ["cost", "Too expensive"], ["elsewhere", "Going with someone else"], ["timing", "Couldn't wait"], ["replace", "Replacing the unit instead"], ["other", "Other (customer)"], ["dup", "Duplicate ticket"], ["noreach", "Couldn't reach the customer"], ["nocard", "No card / no way to pay"], ["dns", "Do not service"], ["office", "Office error"]];
export async function cancelServiceJob({ sv, reason = "dup", note = "", by = "" }) {
  const pool = await boardPool();
  const code = String(sv || "").trim().toUpperCase();
  const rsn = CANCEL_REASONS.some(([k]) => k === reason) ? reason : "other";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = await getJobRow(client, code);
    if (!job) throw new Error(`${code} is not on the board.`);
    if (job.status === "SO9") throw new Error(`${code} is already cancelled.`);
    const snap = { status: job.status, tech: job.assigned_tech, day: dateStr(job.route_date), win: job.time_window, seq: job.stop_seq };
    await updateJob(client, code, { status: "SO9", status_changed_at: new Date(), closed_at: new Date(), route_date: null, assigned_tech: null, time_window: "", stop_seq: null, cancel_reason: rsn, cancel_snapshot: JSON.stringify(snap), dispatch_note: note ? String(note).slice(0, 300) : job.dispatch_note, source: "dashboard", updated_at: new Date() });
    if (snap.tech && snap.day) await renumber(client, snap.tech, snap.day, []);
    const label = CANCEL_REASONS.find(([k]) => k === rsn)?.[1] || rsn;
    await addHistory(client, { sv: code, from: job.status, to: "SO9", actorType: "user", actorId: by, trigger: "board.cancel", reasonCode: "other", note: `${label}${note ? " · " + String(note).slice(0, 200) : ""}` });
    await client.query(`DELETE FROM sj_sync_items WHERE sv_number = $1 AND kind IN ('route','set_status') AND state = 'pending'`, [code]);
    await createSyncItem(client, { ...job, sv_number: code }, "set_status", { status: "SO9", note: `Cancelled — ${label}${note ? "; " + String(note).slice(0, 160) : ""}${snap.tech ? `. Remove from ${snap.tech} ${snap.day}` : ""}` }, { byEmail: by });
    await client.query("COMMIT");
    return { sv: code, reason: rsn, snap };
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}
export async function uncancelServiceJob({ sv, by = "" }) {
  const pool = await boardPool();
  const code = String(sv || "").trim().toUpperCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = await getJobRow(client, code);
    if (!job || job.status !== "SO9" || !job.cancel_snapshot) throw new Error(`${code} has no cancellation to undo.`);
    const snap = job.cancel_snapshot;
    await updateJob(client, code, { status: snap.status || "SO1", status_changed_at: new Date(), closed_at: null, route_date: snap.day || null, assigned_tech: snap.tech || null, time_window: snap.win || "", stop_seq: snap.seq ?? null, cancel_reason: "", cancel_snapshot: null, updated_at: new Date() });
    if (snap.tech && snap.day) await renumber(client, snap.tech, snap.day, []);
    await addHistory(client, { sv: code, from: "SO9", to: snap.status || "SO1", actorType: "user", actorId: by, trigger: "board.uncancel", note: "cancellation undone" });
    await client.query(`DELETE FROM sj_sync_items WHERE sv_number = $1 AND kind = 'set_status' AND state = 'pending'`, [code]);
    await createSyncItem(client, { ...job, sv_number: code }, "set_status", { status: snap.status || "SO1", route_date: snap.day || undefined, tech: snap.tech || undefined, note: "Cancellation undone — put it back" }, { byEmail: by });
    await client.query("COMMIT");
    return { sv: code, ...snap };
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}

// In-shop: the bench says it's repaired → SI5 (owed back), off any day.
export async function markShopRepaired({ sv, by = "" }) {
  const pool = await boardPool();
  const code = String(sv || "").trim().toUpperCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = await getJobRow(client, code);
    if (!job || !/^SI/.test(job.status || "")) throw new Error(`${code} is not in the shop.`);
    await updateJob(client, code, { status: "SI5", status_changed_at: new Date(), route_date: null, assigned_tech: null, time_window: "", stop_seq: null, source: "dashboard", updated_at: new Date() });
    await addHistory(client, { sv: code, from: job.status, to: "SI5", actorType: "user", actorId: by, trigger: "board.shop_repaired", note: "repaired — ready to go back" });
    await createSyncItem(client, { ...job, sv_number: code }, "set_status", { status: "SI5", note: "Repaired in shop — schedule the return" }, { byEmail: by });
    await client.query("COMMIT");
    return { sv: code, status: "SI5" };
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}

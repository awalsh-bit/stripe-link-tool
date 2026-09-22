import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";
import { getSettings as getJourneySettings } from "./service-journey-postgres.js";

// ---------------------------------------------------------------------------
// CLIENT SELF-SCHEDULING — step 2 of the service request (Andrew, 2026-09-19).
//
// After applianceservice.html / hvacservice.html file a request (a card in
// the Service Request Queue), the client lands on schedule.html?r=<token>
// and, when their ZIP is an OPEN booking zone, picks an arrival day from the
// dates the placement engine offers. The pick is written onto the queue card
// (`selfSchedule`) and held here (`sj_self_holds`) so the next customer's
// offers see the capacity as taken. Nothing is sent to the client — the
// confirmation is the page itself (standing rule: no automated contact).
//
// The engine is a port of phase0/wilson_service/placement.py (`suggest` +
// `offer`, spec §4.3) over the Agility tables the ePASS mirror already
// fills: sj_techs (skills, work days, auto_schedule), sj_zones / sj_zip_zones
// (booking mode, primary tech, centroid), sj_jobs (the stops DispatchTrack
// shows per tech per day, with lat/lng when it geocoded them). Every weight
// is an sj_settings key with the Phase 0 default, so the numbers can be
// tuned without a deploy. Doc 13 §3.1's parking-Saturday problem does not
// reach this code: only days a tech works are ever offered.
//
//   sj_self_holds   one row per client pick (or "text me a date" preference)
//   sj_tech_days    dispatcher day overrides: closed / opened / ± minutes
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sj_self_holds (
  id BIGSERIAL PRIMARY KEY,
  card_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  zip TEXT NOT NULL DEFAULT '',
  zone_code TEXT,
  booking_mode TEXT NOT NULL DEFAULT '',
  skill TEXT NOT NULL DEFAULT 'appliance',
  units INT NOT NULL DEFAULT 1,
  est_minutes INT NOT NULL DEFAULT 60,
  kind TEXT NOT NULL DEFAULT 'pending',        -- pending | picked | text_me | office_call
  picked_date DATE,
  picked_window TEXT NOT NULL DEFAULT '',
  tech_code TEXT NOT NULL DEFAULT '',
  offer JSONB NOT NULL DEFAULT '[]'::jsonb,    -- what was shown (internal fields included) for the scorecard
  pick_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  sv_number TEXT NOT NULL DEFAULT '',
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  picked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sj_self_holds_card ON sj_self_holds (card_id);
CREATE INDEX IF NOT EXISTS sj_self_holds_day ON sj_self_holds (tech_code, picked_date) WHERE released_at IS NULL;
CREATE TABLE IF NOT EXISTS sj_tech_days (
  tech_code TEXT NOT NULL,
  work_date DATE NOT NULL,
  available BOOLEAN,                           -- NULL = as the roster says; FALSE = closed; TRUE = opened
  reason TEXT NOT NULL DEFAULT '',
  capacity_adjust_min INT NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  set_by TEXT NOT NULL DEFAULT '',
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tech_code, work_date)
);
`;

let ensurePromise = null;
async function getReadyPool() {
  await getJourneySettings(); // guarantees the sj_ tables exist (and are seeded) first
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

// Phase 0 defaults (spec §11 tunables); any sj_settings row overrides.
export const PLACEMENT_DEFAULTS = {
  "placement.shift_min": 540,
  "placement.horizon_business_days": 10,
  "placement.defer_min_per_day": 8,
  "placement.defer_soft_days": 2,
  "placement.defer_min_per_day_late": 20,
  "placement.same_zone_bonus_min": 6,
  "placement.zone_secondary_penalty_min": 10,
  "placement.zone_other_penalty_min": 40,
  "placement.min_slack_min": 25,
  "placement.drive_base_min": 4,
  "placement.drive_min_per_km": 1.55,
  "offer.hold_max_business_days": 3,
  "offer.route_first": true,
  "booking.max_offers": 7,
  "booking.lead_business_days": 1,
  // OFF by default (Andrew, 2026-09-21: paused until the ePASS feed is the
  // engine's data). Turn on with one settings row — no deploy:
  //   POST /api/service-journey/settings {"key":"booking.self_schedule_enabled","value":true}
  "booking.self_schedule_enabled": false,
  "duration.defaults": { diag_appliance: 60, diag_hvac: 90, install_default: 60, multi_unit_add: 30 }
};
const SHOP = [30.1852, -98.0031]; // 4205 E Hwy 290, Dripping Springs
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WINDOWS = { AM: "Morning · 8 am – 12 pm", PM: "Afternoon · 12 – 5 pm", ANY: "Any time · 8 am – 5 pm" };

// ---- dates ------------------------------------------------------------------
const iso = (d) => d.toISOString().slice(0, 10);
const dateAt = (s) => new Date(`${s}T12:00:00Z`);
const isWeekend = (s) => [0, 6].includes(dateAt(s).getUTCDay());
export function businessDaysAfter(dateIso, n) { let d = dateAt(dateIso); while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (![0, 6].includes(d.getUTCDay())) n--; } return iso(d); }
export function businessDaysBetween(a, b) { let d = dateAt(a); const end = dateAt(b); let n = 0; while (d < end) { d.setUTCDate(d.getUTCDate() + 1); if (![0, 6].includes(d.getUTCDay())) n++; } return n; }
const nextWeekday = (s) => { let d = dateAt(s); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return iso(d); };
const dow = (s) => DOW[dateAt(s).getUTCDay()];
export const todayCentral = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

// ---- geography ----------------------------------------------------------------
function km(a, b) {
  const [la1, lo1, la2, lo2] = [a[0], a[1], b[0], b[1]].map((x) => (x * Math.PI) / 180);
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
const drive = (S, a, b) => (!a || !b ? 0 : Math.round(S["placement.drive_base_min"] + km(a, b) * S["placement.drive_min_per_km"]));

// Cheapest insertion of `here` into start→p1→…→pn→end. Returns [added minutes, index].
function marginalDrive(S, pts, here, start, end) {
  if (!here) return [0, pts.length];
  const route = [start, ...pts.filter(Boolean), end];
  if (route.length === 2) return [drive(S, start, here) + drive(S, here, end), 0];
  let best = null, at = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const added = drive(S, route[i], here) + drive(S, here, route[i + 1]) - drive(S, route[i], route[i + 1]);
    if (best == null || added < best) { best = added; at = i; }
  }
  return [Math.max(best, 0), at];
}

// ---- inputs -------------------------------------------------------------------
async function loadSettings() {
  const s = await getJourneySettings();
  const out = { ...PLACEMENT_DEFAULTS };
  for (const k of Object.keys(PLACEMENT_DEFAULTS)) if (s[k] != null) out[k] = s[k];
  return out;
}
export function estMinutes(S, { skill = "appliance", units = 1, install = false } = {}) {
  const d = S["duration.defaults"] || PLACEMENT_DEFAULTS["duration.defaults"];
  let m = install ? d.install_default : skill === "hvac" ? d.diag_hvac : d.diag_appliance;
  if (units > 1) m += d.multi_unit_add * (units - 1);
  return Math.round(m);
}
const skillsOf = (t) => (Array.isArray(t.skills) ? t.skills : []).map((s) => String(s).toLowerCase());

async function zoneForZip(pool, zip) {
  const z5 = String(zip || "").replace(/\D/g, "").slice(0, 5);
  if (!z5) return { zip: "", zoneCode: null, bookingMode: "office_only", zone: null };
  const zz = (await pool.query(`SELECT zone_code, booking_mode FROM sj_zip_zones WHERE zip = $1`, [z5])).rows[0];
  const zone = zz?.zone_code ? (await pool.query(`SELECT * FROM sj_zones WHERE zone_code = $1`, [zz.zone_code])).rows[0] : null;
  const mode = String(zz?.booking_mode || zone?.booking_mode || "office_only");
  return { zip: z5, zoneCode: zz?.zone_code || null, bookingMode: mode, zone };
}

export async function zoneInfoForZip(zip) { const pool = await getReadyPool(); return zoneForZip(pool, zip); }

// Where a new request sits: the average of DispatchTrack-geocoded jobs in the
// same ZIP, else the zone centroid, else unknown (geo-neutral).
async function locate(pool, zip, zone) {
  if (zip) {
    const r = (await pool.query(`SELECT AVG(lat) AS la, AVG(lng) AS ln, COUNT(lat)::int AS n FROM sj_jobs WHERE zip LIKE $1 AND lat IS NOT NULL`, [zip + "%"])).rows[0];
    if (r && r.n > 0) return [Number(r.la), Number(r.ln)];
  }
  if (zone?.centroid_lat != null && zone?.centroid_lng != null) return [Number(zone.centroid_lat), Number(zone.centroid_lng)];
  return null;
}

// The stops DispatchTrack shows for a tech on a day (open, on a route), plus
// every self-schedule hold still standing — in route order, with locations.
async function dayStops(pool, S, techCode, date, exceptHoldId = null, cache = new Map()) {
  const jobs = (await pool.query(
    `SELECT sv_number, zone_code, lat, lng, zip, units, unit_category, status, est_minutes FROM sj_jobs
     WHERE assigned_tech = $1 AND route_date = $2 AND closed_at IS NULL AND stale = FALSE AND status NOT IN ('SO9','SO7','SO8','SO8I')
     ORDER BY sv_number`, [techCode, date])).rows;
  const holds = (await pool.query(
    `SELECT id, zone_code, zip, est_minutes FROM sj_self_holds WHERE tech_code = $1 AND picked_date = $2 AND released_at IS NULL AND kind = 'picked' ${exceptHoldId ? "AND id <> $3" : ""}`,
    exceptHoldId ? [techCode, date, exceptHoldId] : [techCode, date])).rows;
  const stops = [];
  for (const j of jobs) {
    const install = /^SO(4|5|6)/.test(String(j.status || ""));
    const skill = String(j.unit_category || "").includes("hvac") ? "hvac" : "appliance";
    stops.push({ ref: j.sv_number, zone: j.zone_code, point: j.lat != null && j.lng != null ? [Number(j.lat), Number(j.lng)] : null, zip: j.zip, units: Number(j.units) || 1, minutes: j.est_minutes != null ? Number(j.est_minutes) : estMinutes(S, { skill, units: Number(j.units) || 1, install }) });
  }
  for (const h of holds) stops.push({ ref: `hold:${h.id}`, zone: h.zone_code, point: null, zip: h.zip, minutes: Number(h.est_minutes) || 60, hold: true });
  // fill unknown points from the ZIP average / zone centroid so the route has a shape
  for (const s of stops) if (!s.point) {
    const key = `${s.zone || ""}|${String(s.zip || "").slice(0, 5)}`;
    if (!cache.has(key)) {
      const z = s.zone ? (await pool.query(`SELECT centroid_lat, centroid_lng FROM sj_zones WHERE zone_code = $1`, [s.zone])).rows[0] : null;
      cache.set(key, await locate(pool, String(s.zip || "").slice(0, 5), z));
    }
    s.point = cache.get(key);
  }
  return stops;
}

async function blocksFor(pool, techCode, date) {
  const r = await pool.query(`SELECT start_min AS start, end_min AS "end" FROM sj_route_blocks WHERE tech_code = $1 AND work_date = $2`, [techCode, date]).catch(() => ({ rows: [] }));
  return r.rows.map((b) => ({ start: Number(b.start), end: Number(b.end) }));
}
async function techDay(pool, techCode, date) {
  return (await pool.query(`SELECT * FROM sj_tech_days WHERE tech_code = $1 AND work_date = $2`, [techCode, date])).rows[0] || null;
}
function isOpen(tech, override, date) {
  if (override && override.available != null) return !!override.available;
  const days = String(tech.work_days || "Mon,Tue,Wed,Thu,Fri").split(",").map((x) => x.trim());
  return days.includes(dow(date));
}
function zoneRank(zone, spCode) {
  if (!zone) return 1;
  if ((zone.primary_tech || "") === spCode) return 0;
  const sec = Array.isArray(zone.secondary_techs) ? zone.secondary_techs : String(zone.secondary_techs || "").split(/[\s,]+/);
  return sec.includes(spCode) ? 1 : 2;
}
// pg hands DATE columns back as JS Dates; the rest of the code wants YYYY-MM-DD.
const dateOnly = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
const normHold = (row) => (row ? { ...row, picked_date: dateOnly(row.picked_date) } : row);
const hm = (m) => { m = Math.max(Math.round(m), 0); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };

// ---- the engine (placement.suggest) ------------------------------------------
// `techOnly`: place with this one tech regardless of auto_schedule / skills
// (the diag tech owns the install — blueprint §6.1); `minutes` overrides the
// duration model (a job with est_minutes from ePASS dispatch units).
export async function suggestForRequest({ zip, skill = "appliance", units = 1, today = todayCentral(), earliest = null, exceptHoldId = null, limit = 500, techOnly = "", minutes = null }) {
  const pool = await getReadyPool();
  const S = await loadSettings();
  const z = await zoneForZip(pool, zip);
  const here = await locate(pool, z.zip, z.zone);
  const need = minutes && minutes > 0 ? Math.round(minutes) : estMinutes(S, { skill, units });
  const techs = techOnly
    ? (await pool.query(`SELECT * FROM sj_techs WHERE active = TRUE AND sp_code = $1`, [String(techOnly).toUpperCase()])).rows
    : (await pool.query(`SELECT * FROM sj_techs WHERE active = TRUE AND auto_schedule = TRUE ORDER BY sp_code`)).rows
    // "HVAC backup" (TDP) is an office decision, never an automatic offer.
    .filter((t) => { const sk = skillsOf(t); return skill === "hvac" ? sk.includes("hvac") : sk.includes("appliance"); });
  const lead = Number(S["booking.lead_business_days"]) || 1;
  const start = nextWeekday([earliest, businessDaysAfter(today, lead)].filter(Boolean).sort().pop());
  const out = [];
  const cache = new Map();
  let d = start;
  for (let i = 0; i < S["placement.horizon_business_days"]; i++) {
    for (const t of techs) {
      const ov = await techDay(pool, t.sp_code, d);
      if (!isOpen(t, ov, d)) continue;
      if (t.retire_on && dateOnly(t.retire_on) <= d) continue;
      if (t.mode === "collector" || t.mode === "office") continue; // the lane / office-assigned: never an automatic offer
      const stops0 = await dayStops(pool, S, t.sp_code, d, exceptHoldId, cache);
      // Efficiency (Andrew, 9/22 late): max_stops is the tech's units per day —
      // one unit is 1/12 of Josh's day, 1/6 of DLA's. On such a tech every
      // job's minutes are its units × (shift ÷ max_stops), and the day is
      // full when its units reach max_stops.
      const patT = (t.pattern && typeof t.pattern === "object" ? t.pattern[dow(d)] : null) || {};
      const shiftT = patT.start != null && patT.end != null ? Number(patT.end) - Number(patT.start) : S["placement.shift_min"];
      const unitMin = t.max_stops ? Math.max(10, Math.round(shiftT / Number(t.max_stops))) : null;
      const stops = unitMin ? stops0.map((s) => ({ ...s, minutes: Math.round((s.units || 1) * unitMin) })) : stops0;
      const needT = unitMin ? Math.round((units || 1) * unitMin) : need;
      if (t.max_stops && stops.reduce((a, s) => a + (s.units || 1), 0) + (units || 1) > Number(t.max_stops)) continue;
      const pts = stops.map((s) => s.point);
      const work = stops.reduce((a, s) => a + s.minutes, 0);
      let dr = 0, cur = SHOP; for (const p of pts) if (p) { dr += drive(S, cur, p); cur = p; } dr += stops.length ? drive(S, cur, SHOP) : 0;
      // Capacity the way the board counts it: the tech's pattern shift for
      // that weekday (else the default), minus the day's blocks, plus/minus
      // the dispatcher's adjustment.
      const pat = (t.pattern && typeof t.pattern === "object" ? t.pattern[dow(d)] : null) || {};
      const shift = pat.start != null && pat.end != null ? Number(pat.end) - Number(pat.start) : S["placement.shift_min"];
      const blocked = (await blocksFor(pool, t.sp_code, d)).reduce((a, b) => a + Math.max(0, b.end - b.start), 0);
      const cap = shift - blocked + (ov?.capacity_adjust_min || 0);
      const remaining = cap - work - dr;
      const [added, at] = marginalDrive(S, pts, here, SHOP, SHOP);
      if (remaining - needT - added < S["placement.min_slack_min"]) continue;
      const same = z.zoneCode ? stops.filter((s) => s.zone === z.zoneCode).length : 0;
      const rank = zoneRank(z.zone, t.sp_code);
      const wait = businessDaysBetween(start, d);
      const waitCost = S["placement.defer_min_per_day"] * Math.min(wait, S["placement.defer_soft_days"]) + S["placement.defer_min_per_day_late"] * Math.max(wait - S["placement.defer_soft_days"], 0);
      const cost = added - S["placement.same_zone_bonus_min"] * Math.min(same, 3) + waitCost + [0, S["placement.zone_secondary_penalty_min"], S["placement.zone_other_penalty_min"]][rank];
      const n = stops.length;
      const why = (same ? `${t.sp_code} has ${same} stop${same === 1 ? "" : "s"} in ${z.zoneCode} that day` : n ? `${t.sp_code} has ${n} stop${n === 1 ? "" : "s"} that day` : `${t.sp_code}'s day is empty`) + ` · +${added} min drive · ${hm(remaining - needT - added)} left` + (rank === 0 ? " · primary tech" : rank === 1 ? " · secondary" : " · not this zone's tech");
      out.push({ tech: t.sp_code, date: d, window: at <= Math.floor(Math.max(pts.length, 1) / 2) ? "AM" : "PM", cost: Math.round(cost), addedDrive: added, sameZone: same, stops: n, remainingAfter: remaining - needT - added, zoneRank: rank, waitDays: wait, why });
    }
    d = businessDaysAfter(d, 1);
  }
  out.sort((a, b) => a.cost - b.cost || a.date.localeCompare(b.date) || a.tech.localeCompare(b.tech));
  return { zone: z, need, here, candidates: out.slice(0, limit), techCount: techs.length, settings: S };
}

// placement.offer: the customer's calendar starts on B — the cheapest day no
// more than offer.hold_max_business_days after the first open day — labelled
// "Earliest available" (Cayden 9/17 pm: never "best fit"). Earlier days are
// not shown. One entry per date, best tech for that date.
export async function offerForRequest(args) {
  const res = await suggestForRequest(args);
  const S = res.settings;
  const byDate = new Map();
  for (const c of res.candidates) if (!byDate.has(c.date) || c.cost < byDate.get(c.date).cost) byDate.set(c.date, c);
  const dates = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!dates.length) return { ...res, offers: [] };
  const firstOpen = dates[0].date;
  let pick;
  if (S["offer.route_first"]) {
    const within = dates.filter((c) => businessDaysBetween(firstOpen, c.date) <= S["offer.hold_max_business_days"]);
    pick = within.length ? within.reduce((m, c) => (c.cost < m.cost ? c : m)) : dates[0];
    pick.label = pick.sameZone ? "Earliest available — our route is already in your area that day" : "Earliest available";
  } else { pick = dates[0]; pick.label = "Earliest available"; }
  const ordered = [pick, ...dates.filter((c) => c.date > pick.date)].slice(0, S["booking.max_offers"]);
  const offers = ordered.map((c, i) => ({ ...c, recommended: i === 0, heldBusinessDays: i === 0 ? businessDaysBetween(firstOpen, pick.date) : 0, label: c.label || "", windowLabel: WINDOWS[c.window] || c.window, dayLabel: dow(c.date) }));
  return { ...res, offers, firstOpen };
}

// ---- holds / the client's step ---------------------------------------------
export async function createSelfSchedule({ cardId, zip, skill = "appliance", units = 1 }) {
  const pool = await getReadyPool();
  const z = await zoneForZip(pool, zip);
  const S = await loadSettings();
  const existing = (await pool.query(`SELECT * FROM sj_self_holds WHERE card_id = $1 AND released_at IS NULL ORDER BY id DESC LIMIT 1`, [cardId])).rows[0];
  if (existing) return normHold(existing);
  // No tech the engine may book for this skill (HVAC today: every HVAC tech
  // is auto_schedule = false, the office decides) → the client gets the
  // office-only copy instead of an empty picker.
  const eligible = (await pool.query(`SELECT sp_code, skills FROM sj_techs WHERE active = TRUE AND auto_schedule = TRUE`)).rows
    .filter((t) => { const sk = skillsOf(t); return skill === "hvac" ? sk.includes("hvac") : sk.includes("appliance"); });
  const mode = eligible.length ? z.bookingMode : "office_only";
  const token = crypto.randomBytes(18).toString("base64url");
  const r = await pool.query(
    `INSERT INTO sj_self_holds (card_id, token, zip, zone_code, booking_mode, skill, units, est_minutes, pick_meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
    [String(cardId), token, z.zip, z.zoneCode, mode, skill, Math.max(1, units), estMinutes(S, { skill, units }), JSON.stringify(eligible.length ? {} : { modeReason: `no auto-schedule tech with skill ${skill}` })]
  );
  return normHold(r.rows[0]);
}
export async function getSelfScheduleByToken(token) {
  const pool = await getReadyPool();
  return normHold((await pool.query(`SELECT * FROM sj_self_holds WHERE token = $1`, [String(token || "").slice(0, 60)])).rows[0] || null);
}
export async function getSelfScheduleForCard(cardId) {
  const pool = await getReadyPool();
  return normHold((await pool.query(`SELECT * FROM sj_self_holds WHERE card_id = $1 ORDER BY id DESC LIMIT 1`, [String(cardId)])).rows[0] || null);
}

// What the public page shows: the mode for the ZIP and, when open, the offers
// with every internal field stripped (no tech names, no costs, no why).
export async function buildClientOffer(hold, { today = todayCentral() } = {}) {
  const S = await loadSettings();
  const base = { mode: hold.booking_mode, zip: hold.zip, kind: hold.kind, picked: hold.kind === "picked" ? { date: dateOnly(hold.picked_date), window: hold.picked_window, windowLabel: WINDOWS[hold.picked_window] || hold.picked_window } : null };
  if (!S["booking.self_schedule_enabled"]) return { ...base, mode: "office_only", disabled: true, offers: [] };
  if (hold.booking_mode !== "open" || hold.kind !== "pending") return { ...base, offers: [] };
  const res = await offerForRequest({ zip: hold.zip, skill: hold.skill, units: hold.units, today, exceptHoldId: hold.id });
  const offers = res.offers.map((o) => ({ date: o.date, dayLabel: o.dayLabel, window: o.window, windowLabel: o.windowLabel, label: o.label, recommended: o.recommended }));
  return { ...base, offers, _internal: res.offers };
}

export async function pickSelfSchedule(token, { date, window, today = todayCentral(), by = "client" }) {
  const pool = await getReadyPool();
  const hold = await getSelfScheduleByToken(token);
  if (!hold) throw new Error("This scheduling link isn't valid.");
  if (hold.kind !== "pending") throw new Error("This request already has a date — message Client Care to change it.");
  if (hold.booking_mode !== "open") throw new Error("This area is scheduled by Client Care.");
  const res = await offerForRequest({ zip: hold.zip, skill: hold.skill, units: hold.units, today, exceptHoldId: hold.id });
  // The day is the engine's; the window is the client's preference (the
  // office books the real time in ePASS). The engine's own AM/PM hint is
  // kept in pick_meta for the scorecard.
  const chosen = res.offers.find((o) => o.date === String(date));
  if (!chosen) throw new Error("That day just filled up — please pick another.");
  const win = ["AM", "PM"].includes(window) ? window : "ANY";
  const r = await pool.query(
    `UPDATE sj_self_holds SET kind = 'picked', picked_date = $2, picked_window = $3, tech_code = $4, offer = $5::jsonb, pick_meta = $6::jsonb, picked_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [hold.id, chosen.date, win, chosen.tech, JSON.stringify(res.offers.map((o) => ({ tech: o.tech, date: o.date, window: o.window, cost: o.cost, why: o.why, recommended: o.recommended }))), JSON.stringify({ by, cost: chosen.cost, why: chosen.why, recommended: chosen.recommended, heldBusinessDays: chosen.heldBusinessDays, firstOpen: res.firstOpen, engineWindow: chosen.window })]
  );
  return { hold: normHold(r.rows[0]), chosen: { ...chosen, window: win, windowLabel: WINDOWS[win] } };
}
export async function preferSelfSchedule(token, kind) {
  const pool = await getReadyPool();
  const hold = await getSelfScheduleByToken(token);
  if (!hold) throw new Error("This scheduling link isn't valid.");
  if (hold.kind !== "pending") return hold;
  const k = kind === "text_me" ? "text_me" : "office_call";
  return normHold((await pool.query(`UPDATE sj_self_holds SET kind = $2, picked_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [hold.id, k])).rows[0]);
}
// Office: clear a pick (customer changed their mind on the phone) or attach the SV once booked in ePASS.
export async function releaseSelfSchedule(cardId, { svNumber = "", by = "" } = {}) {
  const pool = await getReadyPool();
  const r = await pool.query(`UPDATE sj_self_holds SET released_at = NOW(), sv_number = COALESCE(NULLIF($2, ''), sv_number), pick_meta = pick_meta || $3::jsonb, updated_at = NOW() WHERE card_id = $1 AND released_at IS NULL RETURNING *`, [String(cardId), String(svNumber || ""), JSON.stringify({ releasedBy: by })]);
  return r.rows.map(normHold);
}
export async function listOpenSelfHolds() {
  const pool = await getReadyPool();
  return (await pool.query(`SELECT id, card_id, zip, zone_code, booking_mode, kind, picked_date::text AS picked_date, picked_window, tech_code, pick_meta, created_at, picked_at FROM sj_self_holds WHERE released_at IS NULL ORDER BY picked_date NULLS LAST, id`)).rows;
}

// ---- dispatcher day controls (capacity.set_day) -----------------------------
export async function setTechDay({ techCode, date, available, reason = "", adjustMin = null, note = "", by = "" }) {
  const pool = await getReadyPool();
  const code = String(techCode || "").toUpperCase().slice(0, 10);
  if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Tech and date are required.");
  const avail = available === true ? true : available === false ? false : null;
  const r = await pool.query(
    `INSERT INTO sj_tech_days (tech_code, work_date, available, reason, capacity_adjust_min, note, set_by, set_at) VALUES ($1,$2,$3,$4,COALESCE($5, 0),$6,$7,NOW())
     ON CONFLICT (tech_code, work_date) DO UPDATE SET available = EXCLUDED.available, reason = EXCLUDED.reason, capacity_adjust_min = COALESCE($5, sj_tech_days.capacity_adjust_min), note = EXCLUDED.note, set_by = EXCLUDED.set_by, set_at = NOW() RETURNING *`,
    [code, date, avail, String(reason || "").slice(0, 40), adjustMin == null ? null : Math.round(Number(adjustMin) || 0), String(note || "").slice(0, 200), String(by || "").slice(0, 120)]
  );
  return r.rows[0];
}
export async function listTechDays({ from, to }) {
  const pool = await getReadyPool();
  return (await pool.query(`SELECT tech_code, work_date::text AS work_date, available, reason, capacity_adjust_min, note, set_by FROM sj_tech_days WHERE work_date >= $1 AND work_date <= $2 ORDER BY work_date, tech_code`, [from, to])).rows;
}

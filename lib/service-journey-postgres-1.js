import { getPostgresPool } from "./data-postgres.js";
import { parseDispatchTrackExport } from "./dispatch-postgres.js";
import { SEED_TECHS, SEED_ZONES, SEED_ZIPS } from "./service-journey-seed.js";

// ---------------------------------------------------------------------------
// Service Call Journey — Phase 0 in Agility (Test Modules, 2026-09-11).
//
// Port of Cayden's spec v1.2 §1–§3 (service_call_journey/docs/07) and the
// phase0 Python package into Agility's Node + Postgres stack. Agility is the
// source of truth; ePASS is mirrored from two exports until NetSuite:
//
//   DispatchTrack export (from ePASS, every 15 min, full snapshot, cp1252)
//     → the epass-agent already ships it (upload kind "dispatch"); the SV
//       rows land here, S/R rows keep going to the delivery import.
//   ExportInvoice (Invoice Maintenance) → the Service Order Health upload.
//
// Import-owned fields are rewritten every snapshot; dashboard-owned fields
// (status, route_date, assigned/owner tech) are never touched by an import
// once the job is source='dashboard'. A job the dashboard has never acted on
// (source='import') simply follows ePASS. Every status change lands in
// sj_status_history; changes that must be keyed into ePASS become
// sj_sync_items with a paste-ready packet, confirmed by the next import.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sj_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sj_import_batches (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  file_name TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS sj_import_batches_file ON sj_import_batches (source, file_name);
CREATE TABLE IF NOT EXISTS sj_techs (
  sp_code TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'Tech',
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  home_base TEXT NOT NULL DEFAULT '',
  start_default TEXT NOT NULL DEFAULT 'shop',
  end_default TEXT NOT NULL DEFAULT 'shop',
  work_days TEXT NOT NULL DEFAULT 'Mon,Tue,Wed,Thu,Fri',
  auto_route BOOLEAN NOT NULL DEFAULT TRUE,
  auto_schedule BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sj_zones (
  zone_code TEXT PRIMARY KEY,
  zone_group TEXT NOT NULL DEFAULT '',
  booking_mode TEXT NOT NULL DEFAULT 'office_only',
  km_from_shop NUMERIC(7,1),
  primary_tech TEXT,
  secondary_techs JSONB NOT NULL DEFAULT '[]'::jsonb,
  centroid_lat NUMERIC(9,6),
  centroid_lng NUMERIC(9,6),
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sj_zip_zones (
  zip TEXT PRIMARY KEY,
  zone_code TEXT,
  zone_group TEXT NOT NULL DEFAULT '',
  booking_mode TEXT NOT NULL DEFAULT 'office_only',
  tickets_2026 INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sj_jobs (
  sv_number TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_code TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_alt TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address1 TEXT NOT NULL DEFAULT '',
  address2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  lat NUMERIC(9,6),
  lng NUMERIC(9,6),
  zone_code TEXT,
  access_notes TEXT NOT NULL DEFAULT '',
  unit_category TEXT NOT NULL DEFAULT '',
  unit_install_type TEXT NOT NULL DEFAULT '',
  unit_brand TEXT NOT NULL DEFAULT '',
  unit_model TEXT NOT NULL DEFAULT '',
  unit_serial TEXT NOT NULL DEFAULT '',
  problem_text TEXT NOT NULL DEFAULT '',
  raw_detail TEXT NOT NULL DEFAULT '',
  qualification TEXT NOT NULL DEFAULT '',
  warranty_flags TEXT NOT NULL DEFAULT '',
  is_warranty BOOLEAN NOT NULL DEFAULT FALSE,
  payment_type TEXT NOT NULL DEFAULT '',
  balance NUMERIC(12,2),
  total NUMERIC(12,2),
  units INT,
  bin_location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  route_date DATE,
  assigned_tech TEXT,
  owner_tech TEXT,
  epass_status TEXT NOT NULL DEFAULT '',
  epass_route_date DATE,
  epass_tech_code TEXT NOT NULL DEFAULT '',
  epass_source TEXT NOT NULL DEFAULT '',
  epass_seen_at TIMESTAMPTZ,
  in_feed BOOLEAN NOT NULL DEFAULT FALSE,
  epass_invoice_status TEXT NOT NULL DEFAULT '',
  epass_finish_date DATE,
  epass_created_at DATE,
  source TEXT NOT NULL DEFAULT 'import',
  needs_intake_review BOOLEAN NOT NULL DEFAULT TRUE,
  stale BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sj_jobs_status ON sj_jobs (status, route_date);
CREATE INDEX IF NOT EXISTS sj_jobs_serial ON sj_jobs (unit_serial);
CREATE INDEX IF NOT EXISTS sj_jobs_customer ON sj_jobs (customer_code);
CREATE INDEX IF NOT EXISTS sj_jobs_phone ON sj_jobs (phone);
CREATE TABLE IF NOT EXISTS sj_job_lines (
  sv_number TEXT NOT NULL,
  line_no INT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty NUMERIC(10,2),
  amount NUMERIC(12,2),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  batch_id BIGINT,
  PRIMARY KEY (sv_number, line_no)
);
CREATE TABLE IF NOT EXISTS sj_status_history (
  id BIGSERIAL PRIMARY KEY,
  sv_number TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT NOT NULL DEFAULT '',
  trigger_event TEXT NOT NULL DEFAULT '',
  reason_code TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sj_status_history_sv ON sj_status_history (sv_number, changed_at);
CREATE TABLE IF NOT EXISTS sj_sync_items (
  id BIGSERIAL PRIMARY KEY,
  sv_number TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  packet_text TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT '',
  keyed_at TIMESTAMPTZ,
  keyed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_by_batch BIGINT,
  epass_values JSONB,
  mismatch_count INT NOT NULL DEFAULT 0,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sj_sync_items_state ON sj_sync_items (state, sv_number);
CREATE TABLE IF NOT EXISTS sj_recalls (
  id BIGSERIAL PRIMARY KEY,
  sv_number TEXT NOT NULL UNIQUE,
  original_sv TEXT,
  tech TEXT,
  days_between INT,
  basis TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'candidate',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Dispatch board (2026-09-22): what the board writes that ePASS has no field
-- for — stop order, half-day window, planned minutes, pin, force — plus the
-- non-call time on a route (van service, training, lunch).
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS est_minutes INTEGER;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS time_window TEXT NOT NULL DEFAULT '';
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS stop_seq INTEGER;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS forced BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS parts_eta DATE;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS dispatch_note TEXT NOT NULL DEFAULT '';
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS home_lat NUMERIC(9,6);
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS home_lng NUMERIC(9,6);
CREATE TABLE IF NOT EXISTS sj_route_blocks (
  id BIGSERIAL PRIMARY KEY,
  tech_code TEXT NOT NULL,
  work_date DATE NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  set_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sj_route_blocks_day ON sj_route_blocks (tech_code, work_date);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).then(() => seedIfEmpty(pool));
  await ensurePromise;
  return pool;
}

// ---------------------------------------------------------------------------
// Vocabulary (spec §2 / phase0 seed.py)
// ---------------------------------------------------------------------------
// status → [name, track, customer stage, sort, stuck-after hours (null = no aging rule)]
export const STATUS_DEFS = {
  REQ: ["Request received, no time picked", "service", "Request received", 0, 24],
  SO1: ["Service scheduled (diagnostic)", "service", "Diagnostic scheduled", 10, null],
  "SO1.AUTH": ["New call awaiting authorization", "service", "Waiting on authorization", 11, 48],
  SO2: ["Unverified quote", "service", "Diagnosed", 20, 24],
  "SO2.1": ["Verified quote", "service", "Diagnosed", 21, 4],
  "SO2.2": ["Sent quote, awaiting approval", "service", "Estimate ready", 22, 120],
  SO3: ["Repair approved, order parts", "service", "Approved", 30, 48],
  SO3PRE: ["Preschedule parts", "service", "Approved", 31, 48],
  SO4: ["Awaiting ordered parts", "service", "Parts ordered", 40, null],
  SO4B: ["Awaiting backordered parts", "service", "Parts ordered", 41, null],
  SO4H: ["Parts shipped to customer", "service", "Parts ordered", 42, null],
  SO4PRE: ["Install held, part not here", "service", "Install scheduled", 43, null],
  SO5: ["Parts in, schedule install", "service", "Part arrived", 50, 48],
  SO6: ["Part install scheduled", "service", "Install scheduled", 60, null],
  SO7: ["Customer declined repair", "service", "Estimate declined", 70, null],
  SO8: ["Service completed", "service", "Repair complete", 80, null],
  SO8I: ["Service completed, WACA install", "service", "Repair complete", 81, null],
  SO9: ["Service cancelled", "service", "Cancelled", 90, null]
};
["SI1", "SI2", "SI3", "SI4", "SI5", "SI6", "SI7", "SI8", "SI9", "SI-TEST"].forEach((c, i) => { STATUS_DEFS[c] = [`In shop ${c}`, "in_shop", "At our shop", 100 + i, null]; });
["WAR1", "WAR3", "WAR4", "WAR4.1", "WARADMIN", "WARPART", "WARPARTORDERED", "WARPROBLEM", "WARTRANE", "CPU", "CPU2", "QUOTE"].forEach((c, i) => { STATUS_DEFS[c] = [`Warranty/admin ${c}`, "warranty", "In progress", 200 + i, null]; });

export const CLOSED_STATUSES = ["SO8", "SO8I", "SO9", "SO7"];
export const DT_ROUTING_STATUSES = ["SO1", "SO4PRE", "SO5", "SO6"]; // what the routing-filtered export carries today
const INSTALL_STATUSES = ["SO4PRE", "SO5", "SO6"];
const VISIT_STATUSES = ["SO1", "SO6"];
const LENIENT_PAIRS = [new Set(["SO4PRE", "SO6"])];
export const REASON_CODES = ["keyed_in_epass", "customer_called", "tech_update", "office_correction", "owner_out", "duplicate", "other"];

export const DEFAULT_SETTINGS = {
  "stale.grace_hours": 18,
  "sync.mismatch_cycles_before_discrepancy": 2,
  "sync.follow_epass_for_import_jobs": true,
  "import.ei_sched_horizon_days": 120,
  "recall.window_days": 30,
  "recall.unreviewed_counts_after_days": 7,
  "fee.diagnostic": 169.95,
  "feed.dt_complete": false
};

const STATUS_ORDER = Object.keys(STATUS_DEFS);
export function statusInfo(code) {
  const d = STATUS_DEFS[code];
  return d ? { code, name: d[0], track: d[1], stage: d[2], sort: d[3], stuckAfterHours: d[4] } : { code, name: code || "—", track: "other", stage: "In progress", sort: 900, stuckAfterHours: null };
}

// ---------------------------------------------------------------------------
// Seeds and settings
// ---------------------------------------------------------------------------
async function seedIfEmpty(pool) {
  const techs = await pool.query(`SELECT COUNT(*)::int AS n FROM sj_techs`);
  if (!techs.rows[0].n) {
    for (const t of SEED_TECHS) {
      await pool.query(
        `INSERT INTO sj_techs (sp_code, name, role, aliases, skills, home_base, start_default, end_default, work_days, auto_route, auto_schedule, notes)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (sp_code) DO NOTHING`,
        [t.code, t.name, t.role, JSON.stringify(t.aliases), JSON.stringify(t.skills), t.homeBase, t.startDefault, t.endDefault, t.workDays, t.autoRoute, t.autoSchedule, t.notes]
      );
    }
  }
  const zones = await pool.query(`SELECT COUNT(*)::int AS n FROM sj_zones`);
  if (!zones.rows[0].n) {
    for (const z of SEED_ZONES) {
      await pool.query(
        `INSERT INTO sj_zones (zone_code, zone_group, booking_mode, km_from_shop, primary_tech, secondary_techs, centroid_lat, centroid_lng, notes)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) ON CONFLICT (zone_code) DO NOTHING`,
        [z.code, z.group, z.bookingMode, z.km, z.primary, JSON.stringify(z.secondary), z.lat, z.lng, z.notes]
      );
    }
    for (const z of SEED_ZIPS) {
      await pool.query(`INSERT INTO sj_zip_zones (zip, zone_code, zone_group, booking_mode, tickets_2026) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (zip) DO NOTHING`,
        [z.zip, z.zone, z.group, z.bookingMode, z.tickets]);
    }
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await pool.query(`INSERT INTO sj_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`, [k, JSON.stringify(v)]);
  }
}

export async function getSettings() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT key, value FROM sj_settings`);
  const out = { ...DEFAULT_SETTINGS };
  for (const row of r.rows) out[row.key] = row.value;
  return out;
}
export async function setSetting(key, value) {
  const pool = await getReadyPool();
  await pool.query(`INSERT INTO sj_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(value)]);
}

let techCache = null;
async function techMap(pool) {
  if (techCache && Date.now() - techCache.at < 60000) return techCache.map;
  const r = await pool.query(`SELECT * FROM sj_techs`);
  const map = new Map();
  for (const t of r.rows) {
    map.set(t.sp_code, t);
    for (const a of (t.aliases || [])) map.set(String(a).toUpperCase(), t);
  }
  techCache = { at: Date.now(), map };
  return map;
}
export function invalidateTechCache() { techCache = null; }
// KJB2 → KJB, VJ → VWJ. Unknown codes pass through upper-cased.
async function canonicalTech(pool, code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return "";
  const map = await techMap(pool);
  return map.get(c)?.sp_code || c;
}
function sameTech(a, b) {
  a = String(a || "").trim().toUpperCase(); b = String(b || "").trim().toUpperCase();
  if (a === b) return true;
  const pair = new Set([a, b]);
  return ["KJB", "KJB2"].every((x) => pair.has(x)) || ["VWJ", "VJ"].every((x) => pair.has(x));
}
export async function listTechs() {
  const pool = await getReadyPool();
  return (await pool.query(`SELECT * FROM sj_techs ORDER BY auto_route DESC, sp_code`)).rows.map(mapTech);
}
const mapTech = (t) => ({ code: t.sp_code, name: t.name, role: t.role, aliases: t.aliases || [], skills: t.skills || [], homeBase: t.home_base, startDefault: t.start_default, endDefault: t.end_default, workDays: t.work_days, autoRoute: t.auto_route, autoSchedule: t.auto_schedule, active: t.active, notes: t.notes });

async function ensureZone(pool, code) {
  const z = String(code || "").trim().toUpperCase();
  if (!z) return null;
  const r = await pool.query(`INSERT INTO sj_zones (zone_code, zone_group, booking_mode, needs_review, notes) VALUES ($1, 'Unmapped', 'office_only', TRUE, 'Seen in an ePASS export; not in the zone table.') ON CONFLICT (zone_code) DO NOTHING RETURNING zone_code`, [z]);
  return z;
}
async function zoneForZip(pool, zip) {
  const z = String(zip || "").trim().slice(0, 5);
  if (!z) return null;
  const r = await pool.query(`SELECT zone_code FROM sj_zip_zones WHERE zip = $1`, [z]);
  return r.rows[0]?.zone_code || null;
}

// ---------------------------------------------------------------------------
// Parsing helpers (phase0 importers/common.py)
// ---------------------------------------------------------------------------
// ePASS product-category codes seen on SV tickets (Order Detail first token) → [category, install type]. Install type drives labor tax later.
const CATEGORY = {
  REFRE: ["refrigerator", "freestanding"], REALL: ["refrigerator", "freestanding"], RESXS: ["side-by-side refrigerator", "freestanding"], REBFD: ["french-door refrigerator", "freestanding"],
  RETOP: ["top-freezer refrigerator", "freestanding"], REBOT: ["bottom-freezer refrigerator", "freestanding"], REFWI: ["wine refrigerator", "built_in"], REDRA: ["refrigerator drawers", "built_in"],
  REBIS: ["built-in side-by-side refrigerator", "built_in"], REBIF: ["built-in french-door refrigerator", "built_in"], REBIC: ["built-in column refrigerator", "built_in"], REBIR: ["built-in refrigerator", "built_in"], REBIB: ["built-in bottom-freezer refrigerator", "built_in"],
  REUC: ["undercounter refrigerator", "built_in"], REUND: ["undercounter refrigerator", "built_in"], WINE: ["wine cooler", "built_in"], FREEZ: ["freezer", "freestanding"],
  IMUC: ["undercounter ice maker", "built_in"], ICEMK: ["ice maker", "built_in"],
  DW: ["dishwasher", "built_in"], DISHW: ["dishwasher", "built_in"], DWDRA: ["dishwasher drawer", "built_in"],
  WASH: ["washer", "freestanding"], WASHF: ["front-load washer", "freestanding"], WASHT: ["top-load washer", "freestanding"], WDCOM: ["washer/dryer combo", "freestanding"], LAUND: ["laundry center", "freestanding"],
  DRELE: ["electric dryer", "freestanding"], DRGAS: ["gas dryer", "freestanding"], DRYER: ["dryer", "freestanding"],
  RADF: ["dual-fuel range", "freestanding"], RAGAS: ["gas range", "freestanding"], RAPRO: ["pro range", "freestanding"], RAELE: ["electric range", "freestanding"], RANGE: ["range", "freestanding"],
  CTIND: ["induction cooktop", "built_in"], CTDD: ["cooktop with downdraft", "built_in"], CTGAS: ["gas cooktop", "built_in"], CTELE: ["electric cooktop", "built_in"], COOKT: ["cooktop", "built_in"],
  OVELE: ["electric wall oven", "built_in"], OVSTE: ["steam oven", "built_in"], OVSPE: ["speed oven", "built_in"], OVMW: ["microwave/oven combo", "built_in"], OVEN: ["wall oven", "built_in"],
  MW: ["microwave", "built_in"], MWDR: ["microwave drawer", "built_in"], MWOTR: ["over-the-range microwave", "built_in"], MICRO: ["microwave", "built_in"],
  VHOOD: ["vent hood", "built_in"], VHBLO: ["vent hood blower", "built_in"], VHINS: ["vent hood insert", "built_in"], VHDD: ["downdraft vent", "built_in"], HOOD: ["vent hood", "built_in"],
  COFFE: ["coffee system", "built_in"], DISP: ["disposal", "built_in"], COMPA: ["compactor", "built_in"], GROUT: ["grill / outdoor", "built_in"], SPOUT: ["specialty / outdoor", "built_in"],
  ACCON: ["hvac condenser", "hvac"], ACAH: ["hvac air handler", "hvac"], HVAC: ["hvac", "hvac"], AC: ["hvac", "hvac"], FURN: ["furnace", "hvac"], HEAT: ["heat pump", "hvac"], STAT: ["thermostat", "hvac"]
};
const DETAIL_RE = /^([A-Z]{2,6})\s+(.*?)\s+(SV|WTY)(?:\s+([\s\S]*))?$/;
export function parseOrderDetail(text) {
  const out = { category: "", installType: "", brand: "", model: "", serial: "", problemText: "", rawDetail: String(text || "").trim() };
  const t = out.rawDetail;
  if (!t) return out;
  const m = t.match(DETAIL_RE);
  if (!m) { out.problemText = t.slice(0, 2000); return out; }
  const [cat, type] = CATEGORY[m[1]] || [m[1].toLowerCase(), ""];
  out.category = cat; out.installType = type;
  const tokens = m[2].split(/\s+/).filter(Boolean);
  if (tokens.length) out.brand = tokens[0].slice(0, 40);
  if (tokens.length >= 3) { out.model = tokens.slice(1, -1).join(" ").slice(0, 60); out.serial = tokens[tokens.length - 1].slice(0, 60); }
  else if (tokens.length === 2) out.model = tokens[1].slice(0, 60);
  out.problemText = String(m[4] || "").trim().slice(0, 2000);
  return out;
}
const KNOWN_FLAGS = ["RCALL", "WTY", "RUSH", "1ST", "VIP", "HOT", "COD", "AR"];
export function warrantyFlags(priorities) {
  const flags = new Set();
  for (let tok of String(priorities || "").toUpperCase().split(/[,\s;/]+/)) {
    tok = tok.trim();
    while (tok) {
      const hit = KNOWN_FLAGS.find((k) => tok.startsWith(k));
      if (hit) { flags.add(hit); tok = tok.slice(hit.length); } else { flags.add(tok); tok = ""; }
    }
  }
  const list = [...flags].filter(Boolean).sort();
  return { flags: list.join(","), isWarranty: list.includes("WTY") };
}
export function parseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return null;
}
const money = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const digits = (v) => String(v || "").replace(/\D/g, "");
// Invoice export writes "HUCKABY NEAL & ELAINE"; DispatchTrack writes "NEAL & ELAINE HUCKABY".
function lastFirstToFirstLast(name) {
  const n = String(name || "").trim();
  const i = n.indexOf(" ");
  return i > 0 ? `${n.slice(i + 1)} ${n.slice(0, i)}` : n;
}
const lastName = (name) => { const parts = String(name || "").trim().split(/\s+/); return (parts[parts.length - 1] || "").toUpperCase(); };

// ---------------------------------------------------------------------------
// Job helpers
// ---------------------------------------------------------------------------
function mapJob(j) {
  if (!j) return null;
  const info = statusInfo(j.status);
  return {
    svNumber: j.sv_number, customerName: j.customer_name, customerCode: j.customer_code, phone: j.phone, phoneAlt: j.phone_alt, email: j.email,
    address1: j.address1, address2: j.address2, city: j.city, state: j.state, zip: j.zip, lat: j.lat == null ? null : Number(j.lat), lng: j.lng == null ? null : Number(j.lng),
    zoneCode: j.zone_code, accessNotes: j.access_notes,
    unit: { category: j.unit_category, installType: j.unit_install_type, brand: j.unit_brand, model: j.unit_model, serial: j.unit_serial },
    problemText: j.problem_text, rawDetail: j.raw_detail, qualification: j.qualification, warrantyFlags: j.warranty_flags, isWarranty: j.is_warranty,
    paymentType: j.payment_type, balance: j.balance == null ? null : Number(j.balance), total: j.total == null ? null : Number(j.total), units: j.units, binLocation: j.bin_location,
    status: j.status, statusName: info.name, stage: info.stage, statusChangedAt: iso(j.status_changed_at), flags: j.flags || [],
    routeDate: dateStr(j.route_date), assignedTech: j.assigned_tech, ownerTech: j.owner_tech,
    epassStatus: j.epass_status, epassRouteDate: dateStr(j.epass_route_date), epassTechCode: j.epass_tech_code, epassSource: j.epass_source, epassSeenAt: iso(j.epass_seen_at), inFeed: j.in_feed,
    epassInvoiceStatus: j.epass_invoice_status, epassFinishDate: dateStr(j.epass_finish_date), epassCreatedAt: dateStr(j.epass_created_at),
    source: j.source, needsIntakeReview: j.needs_intake_review, stale: j.stale, closedAt: iso(j.closed_at), firstSeenAt: iso(j.first_seen_at), updatedAt: iso(j.updated_at),
    hoursInStatus: j.status_changed_at ? Math.round((Date.now() - new Date(j.status_changed_at).getTime()) / 36e5 * 10) / 10 : null,
    stuckAfterHours: info.stuckAfterHours
  };
}
const iso = (d) => d ? (d.toISOString ? d.toISOString() : String(d)) : null;
const dateStr = (d) => d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null;

async function getJobRow(client, sv) {
  const r = await client.query(`SELECT * FROM sj_jobs WHERE sv_number = $1`, [sv]);
  return r.rows[0] || null;
}
async function addHistory(client, { sv, from, to, actorType, actorId, trigger, reasonCode = null, note = "" }) {
  await client.query(
    `INSERT INTO sj_status_history (sv_number, from_status, to_status, actor_type, actor_id, trigger_event, reason_code, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [sv, from || null, to, actorType, String(actorId || ""), trigger, reasonCode, String(note || "").slice(0, 500)]
  );
}
async function updateJob(client, sv, changes) {
  const keys = Object.keys(changes);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  await client.query(`UPDATE sj_jobs SET ${sets.join(", ")} WHERE sv_number = $1`, [sv, ...keys.map((k) => (k === "flags" ? JSON.stringify(changes[k]) : changes[k]))]);
}

// ---------------------------------------------------------------------------
// DispatchTrack export (SV rows) — spec §3.1–§3.4
// ---------------------------------------------------------------------------
export function decodeDispatchTrackBuffer(buffer) {
  // ePASS writes cp1252; a UTF-8 decode replaces 0xA0 and accented names.
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), "utf8");
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return utf8;
  } catch {
    try { return new TextDecoder("windows-1252").decode(bytes); } catch { return bytes.toString("latin1"); }
  }
}

export async function importServiceDispatchTrack(bufferOrText, { filename = "", byEmail = "" } = {}) {
  const pool = await getReadyPool();
  const text = decodeDispatchTrackBuffer(bufferOrText);
  const { rows } = parseDispatchTrackExport(text);
  const groups = new Map();
  for (const r of rows) {
    const on = String(r["Order Number"] || "").trim();
    if (/^SV/i.test(on)) { if (!groups.has(on)) groups.set(on, []); groups.get(on).push(r); }
  }
  const settings = await getSettings();
  const fileName = filename || `DispatchTrack ${new Date().toISOString()}`;
  const client = await pool.connect();
  const res = { source: "dispatchtrack", fileName, rows: rows.length, svOrders: groups.size, created: 0, updated: 0, unchanged: 0, attached: 0, droppedFromFeed: 0, newZones: 0, sync: null, stale: 0, dtComplete: false, skipped: false };
  try {
    await client.query("BEGIN");
    const dup = await client.query(`SELECT id FROM sj_import_batches WHERE source = 'dispatchtrack' AND file_name = $1`, [fileName]);
    if (dup.rows[0] && filename) { await client.query("ROLLBACK"); return { ...res, skipped: true, batchId: dup.rows[0].id }; }
    const batch = await client.query(`INSERT INTO sj_import_batches (source, file_name, imported_by) VALUES ('dispatchtrack', $1, $2) RETURNING id`, [fileName, byEmail]);
    const batchId = batch.rows[0].id;
    const zonesBefore = (await client.query(`SELECT COUNT(*)::int AS n FROM sj_zones`)).rows[0].n;
    // Does this export carry more than the routing statuses? Then DT is a complete mirror.
    const statuses = new Set([...groups.values()].map((g) => String(g[0]["Job Status"] || "").trim()).filter(Boolean));
    res.dtComplete = [...statuses].some((s) => !DT_ROUTING_STATUSES.includes(s));
    if (res.dtComplete && !settings["feed.dt_complete"]) { await client.query(`INSERT INTO sj_settings (key, value, updated_at) VALUES ('feed.dt_complete', 'true', NOW()) ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()`); settings["feed.dt_complete"] = true; }
    const seen = new Set();
    for (const [sv, grp] of groups) {
      const outcome = await upsertFromDispatchTrack(client, sv, grp, batchId);
      seen.add(sv);
      res[outcome] += 1;
    }
    res.newZones = (await client.query(`SELECT COUNT(*)::int AS n FROM sj_zones`)).rows[0].n - zonesBefore;
    // Full snapshot: anything in the feed before and not now has left it.
    const inFeed = await client.query(`SELECT sv_number FROM sj_jobs WHERE in_feed`);
    for (const j of inFeed.rows) {
      if (!seen.has(j.sv_number)) { await client.query(`UPDATE sj_jobs SET in_feed = FALSE, updated_at = NOW() WHERE sv_number = $1`, [j.sv_number]); res.droppedFromFeed += 1; }
    }
    res.sync = await reconcileAfterImport(client, batchId, [...seen], "DT", settings);
    res.stale = await markStale(client, settings);
    await client.query(`UPDATE sj_import_batches SET status = 'ok', summary = $2::jsonb, message = $3 WHERE id = $1`, [batchId, JSON.stringify(res), summaryLine(res)]);
    await client.query("COMMIT");
    return { ...res, batchId };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    await pool.query(`INSERT INTO sj_import_batches (source, file_name, imported_by, status, message) VALUES ('dispatchtrack', $1, $2, 'failed', $3)`, [fileName + " @" + Date.now(), byEmail, String(err.message || err).slice(0, 500)]).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
function summaryLine(r) {
  return `${r.fileName}: ${r.rows} rows, ${r.svOrders} SV → created ${r.created}, updated ${r.updated}, unchanged ${r.unchanged}, attached ${r.attached}${r.droppedFromFeed ? `, dropped ${r.droppedFromFeed}` : ""}${r.newZones ? `, new zones ${r.newZones}` : ""}; sync ${JSON.stringify(r.sync || {})}; stale ${r.stale}`;
}

async function upsertFromDispatchTrack(client, sv, grp, batchId) {
  const h = grp[0];
  const epassStatus = String(h["Job Status"] || "").trim();
  const routeDate = parseDate(h["Delivery Date"]);
  const truck = await canonicalTech(client, h["Truck"]);
  const zoneCode = (await ensureZone(client, h["Map Zone"])) || (await zoneForZip(client, h["Ship Zip"]));
  let lat = num(h["Latitude"]), lng = num(h["Longitude"]);
  if (!lat || !lng) { lat = null; lng = null; }
  const { flags, isWarranty } = warrantyFlags(h["Priorites"] ?? h["Priorities"]);
  const binLoc = (grp.find((r) => String(r["Location"] || "").trim())?.["Location"] || "").trim().slice(0, 20);
  const qual = String(h["Qualifications"] || "").trim().slice(0, 6);
  const balance = money(h["Balance"]);
  const directions = String(h["Directions"] || "").trim().slice(0, 2000);
  const detail = parseOrderDetail(h["Order Detail"] || "");
  const phone = digits(h["Phone2"] || h["Phone1"]).slice(-10);
  const phoneAlt = digits(h["Phone3"] || h["Phone1"]).slice(-10);

  // lines: every row's Model / Description / Quantity (parts for SO4–SO6)
  await client.query(`DELETE FROM sj_job_lines WHERE sv_number = $1`, [sv]);
  let lineNo = 0;
  for (const r of grp) {
    if (!String(r["Model"] || "").trim() && !String(r["Description"] || "").trim()) continue; // header-only row
    lineNo += 1;
    await client.query(`INSERT INTO sj_job_lines (sv_number, line_no, model, description, qty, amount, raw, batch_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [sv, lineNo, String(r["Model"] || "").slice(0, 80), String(r["Description"] || "").slice(0, 200), num(r["Quantity"]), money(r["Amount"]), JSON.stringify(pickRaw(r)), batchId]);
  }

  let job = await getJobRow(client, sv);
  let attached = false;
  if (!job) {
    job = await matchCreateTicket(client, sv, { phone, lastName: lastName(h["Ship Name"]), zip: h["Ship Zip"] });
    attached = !!job;
  }
  const mirror = { epass_status: epassStatus, epass_route_date: routeDate, epass_tech_code: truck, epass_source: "DT", in_feed: true, balance, bin_location: binLoc, warranty_flags: flags, is_warranty: isWarranty, qualification: qual };

  if (!job) {
    await client.query(
      `INSERT INTO sj_jobs (sv_number, customer_name, customer_code, phone, phone_alt, email, address1, address2, city, state, zip, lat, lng, zone_code, access_notes,
         unit_category, unit_install_type, unit_brand, unit_model, unit_serial, problem_text, raw_detail, qualification, warranty_flags, is_warranty, payment_type, balance, bin_location,
         status, status_changed_at, route_date, assigned_tech, owner_tech, epass_status, epass_route_date, epass_tech_code, epass_source, epass_seen_at, in_feed, source, needs_intake_review)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW(),$30,$31,$32,$33,$34,$35,'DT',NOW(),TRUE,'import',TRUE)`,
      [sv, String(h["Ship Name"] || h["Bill Name"] || "").trim().slice(0, 120), String(h["Customer Code"] || "").trim().slice(0, 40), phone, phoneAlt, String(h["Email"] || "").trim().slice(0, 120),
       String(h["Ship Address1"] || "").trim().slice(0, 160), String(h["Ship Address2"] || "").trim().slice(0, 160), String(h["Ship City"] || "").trim().slice(0, 80), String(h["Ship State"] || "").trim().slice(0, 4), String(h["Ship Zip"] || "").trim().slice(0, 10),
       lat, lng, zoneCode, directions, detail.category, detail.installType, detail.brand, detail.model, detail.serial, detail.problemText, detail.rawDetail.slice(0, 2000), qual, flags, isWarranty, isWarranty ? "WTY" : "COD", balance, binLoc,
       epassStatus, routeDate, truck || null, INSTALL_STATUSES.includes(epassStatus) ? (truck || null) : null, epassStatus, routeDate, truck]
    );
    await addHistory(client, { sv, from: null, to: epassStatus, actorType: "import", actorId: "DT", trigger: "import.create", note: `created from DispatchTrack snapshot; truck ${truck || "-"}` });
    if (CLOSED_STATUSES.includes(epassStatus)) await updateJob(client, sv, { closed_at: new Date() });
    await detectRecall(client, sv);
    return "created";
  }

  const changes = {};
  for (const [k, v] of Object.entries(mirror)) {
    if (k === "in_feed") { if (!job.in_feed) changes.in_feed = true; continue; }
    if (k === "balance") { if (!(job.balance == null && v == null) && Number(job.balance) !== Number(v)) changes.balance = v; continue; }
    if (k === "epass_route_date") { if (dateStr(job.epass_route_date) !== v) changes.epass_route_date = v; continue; }
    if ((job[k] ?? "") !== v) changes[k] = v;
  }
  if (!job.zone_code && zoneCode) changes.zone_code = zoneCode;
  if (!job.problem_text && detail.problemText) changes.problem_text = detail.problemText;
  if (!job.raw_detail && detail.rawDetail) changes.raw_detail = detail.rawDetail.slice(0, 2000);
  if (job.lat == null && lat != null) { changes.lat = lat; changes.lng = lng; }
  if (!job.access_notes && directions) changes.access_notes = directions;
  for (const [col, val] of [["unit_category", detail.category], ["unit_install_type", detail.installType], ["unit_brand", detail.brand], ["unit_model", detail.model], ["unit_serial", detail.serial]]) {
    if (!job[col] && val) changes[col] = val;
  }
  if (!job.address1 && h["Ship Address1"]) { changes.address1 = String(h["Ship Address1"]).trim().slice(0, 160); changes.city = String(h["Ship City"] || "").trim().slice(0, 80); changes.state = String(h["Ship State"] || "").trim().slice(0, 4); }
  if (!job.phone && phone) changes.phone = phone;
  if (!job.email && h["Email"]) changes.email = String(h["Email"]).trim().slice(0, 120);
  if (!job.customer_code && h["Customer Code"]) changes.customer_code = String(h["Customer Code"]).trim().slice(0, 40);
  const substantive = Object.keys(changes).filter((k) => k !== "in_feed").length > 0;
  changes.epass_seen_at = new Date();
  if (substantive) changes.updated_at = new Date();
  await updateJob(client, sv, changes);
  if (attached) return "attached";
  return substantive ? "updated" : "unchanged";
}
function pickRaw(r) {
  const out = {};
  for (const k of ["Model", "Description", "Quantity", "Deliver Quantity", "Amount", "Location", "ProductCode", "Points", "Service Time", "Job Status", "Delivery Date", "Truck"]) if (r[k] !== undefined && r[k] !== "") out[k] = r[k];
  return out;
}

// ---------------------------------------------------------------------------
// ePASS ODBC feed (2026-09-22) — the open SV/WTY tickets scripts/epass-odbc-pull.ps1
// pushes every 15 minutes (epass_open_service + _labor + _items, raw Invoice
// rows). Replaces the DispatchTrack export and the ExportInvoice upload as the
// mirror's source: same upsert rules (import-owned mirror fields rewritten
// each snapshot, descriptive fields fill blanks), same full-snapshot drop
// (a ticket that leaves the feed was finished or cancelled), same reconcile
// against open sync packets. ePASS geocodes every customer itself
// (SoldToLatitude / SoldToLongitude), so lat/lng arrive with the ticket.
// One DispatchUnits unit is one hour (Andrew, 9/21): est_minutes = units × 60.
// ---------------------------------------------------------------------------
const rawGet = (row, ...names) => { for (const n of names) { const k = Object.keys(row || {}).find((x) => x.toLowerCase() === n.toLowerCase()); if (k != null && row[k] != null && row[k] !== "") return row[k]; } return null; };
const rawStr = (row, ...names) => String(rawGet(row, ...names) ?? "").trim();

export async function importServiceFromEpassFeed({ byEmail = "epass-agent", pulledAt = "" } = {}) {
  const pool = await getReadyPool();
  const settings = await getSettings();
  const meta = (await pool.query(`SELECT pulled_at, filename FROM epass_open_service_meta WHERE id = 1`).catch(() => ({ rows: [] }))).rows[0];
  const fileName = `ePASS feed ${pulledAt || meta?.pulled_at || new Date().toISOString()}`;
  const tickets = (await pool.query(`SELECT code, raw FROM epass_open_service ORDER BY code`)).rows;
  const laborRows = (await pool.query(`SELECT invoice_code, trip_no, tech_code, raw FROM epass_open_service_labor ORDER BY invoice_code, trip_no NULLS FIRST, id`)).rows;
  const itemRows = (await pool.query(`SELECT invoice_code, raw FROM epass_open_service_items ORDER BY invoice_code, id`)).rows;
  const laborBy = new Map(), itemsBy = new Map();
  for (const r of laborRows) { const k = r.invoice_code.toUpperCase(); if (!laborBy.has(k)) laborBy.set(k, []); laborBy.get(k).push(r); }
  for (const r of itemRows) { const k = r.invoice_code.toUpperCase(); if (!itemsBy.has(k)) itemsBy.set(k, []); itemsBy.get(k).push(r.raw); }
  const client = await pool.connect();
  const res = { source: "epassfeed", fileName, rows: tickets.length, svOrders: 0, created: 0, updated: 0, unchanged: 0, attached: 0, droppedFromFeed: 0, newZones: 0, sync: null, stale: 0, skipped: false };
  try {
    await client.query("BEGIN");
    const dup = await client.query(`SELECT id FROM sj_import_batches WHERE source = 'epassfeed' AND file_name = $1`, [fileName]);
    if (dup.rows[0]) { await client.query("ROLLBACK"); return { ...res, skipped: true, batchId: dup.rows[0].id }; }
    const batch = await client.query(`INSERT INTO sj_import_batches (source, file_name, imported_by) VALUES ('epassfeed', $1, $2) RETURNING id`, [fileName, byEmail]);
    const batchId = batch.rows[0].id;
    const zonesBefore = (await client.query(`SELECT COUNT(*)::int AS n FROM sj_zones`)).rows[0].n;
    const seen = new Set();
    for (const t of tickets) {
      const sv = String(t.code || "").trim().toUpperCase();
      if (!/^SV/.test(sv)) continue; // WTY-typed tickets carry other prefixes; the board is SV-keyed
      res.svOrders += 1;
      const outcome = await upsertFromEpassFeed(client, sv, t.raw, laborBy.get(sv) || [], itemsBy.get(sv) || [], batchId);
      seen.add(sv);
      res[outcome] += 1;
    }
    res.newZones = (await client.query(`SELECT COUNT(*)::int AS n FROM sj_zones`)).rows[0].n - zonesBefore;
    // This feed is the complete set of open SV tickets, so a ticket that has
    // left it was finished or cancelled in ePASS: close it here too (the DT
    // export only ever carried the routing statuses, so it could not say).
    const inFeed = await client.query(`SELECT sv_number, status, closed_at FROM sj_jobs WHERE in_feed`);
    for (const j of inFeed.rows) {
      if (seen.has(j.sv_number)) continue;
      await client.query(`UPDATE sj_jobs SET in_feed = FALSE, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW() WHERE sv_number = $1`, [j.sv_number]);
      if (!j.closed_at) await addHistory(client, { sv: j.sv_number, from: j.status, to: j.status, actorType: "import", actorId: "ODBC", trigger: "feed.left", note: "left the ePASS open-ticket feed (finished or cancelled in ePASS)" });
      res.droppedFromFeed += 1;
    }
    res.sync = await reconcileAfterImport(client, batchId, [...seen], "ODBC", settings);
    res.stale = await markStale(client, settings);
    await client.query(`UPDATE sj_import_batches SET status = 'ok', summary = $2::jsonb, message = $3 WHERE id = $1`, [batchId, JSON.stringify(res), summaryLine(res)]);
    await client.query("COMMIT");
    return { ...res, batchId };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    await pool.query(`INSERT INTO sj_import_batches (source, file_name, imported_by, status, message) VALUES ('epassfeed', $1, $2, 'failed', $3)`, [fileName + " @" + Date.now(), byEmail, String(err.message || err).slice(0, 500)]).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function upsertFromEpassFeed(client, sv, inv, labor, items, batchId) {
  const epassStatus = rawStr(inv, "JobStatusCode").toUpperCase();
  const routeDate = parseDate(rawStr(inv, "SvcScheduleDate")) || parseDate(rawStr(inv, "ScheduleDate"));
  // The tech is the salesperson code on the invoice header — Salesperson1Code
  // is the SP code the office assigns the ticket to, the same code DispatchTrack
  // exported as "Truck" (Andrew, 9/22). Only when the header has none do we
  // fall back to the requested route or the latest labor line's tech.
  const lastLabor = [...labor].reverse().find((l) => l.tech_code);
  const truck = await canonicalTech(client, rawStr(inv, "Salesperson1Code", "SalespersonCode", "SalesPersonCode") || rawStr(inv, "DispatchRequestedRouteCode") || lastLabor?.tech_code || "");
  const zoneCode = (await ensureZone(client, rawStr(inv, "MapZoneCode"))) || (await zoneForZip(client, rawStr(inv, "SoldToZipCode")));
  let lat = num(rawGet(inv, "SoldToLatitude")), lng = num(rawGet(inv, "SoldToLongitude"));
  if (!lat || !lng) { lat = null; lng = null; }
  const invType = rawStr(inv, "InvTypeCode").toUpperCase();
  const pri = warrantyFlags([rawStr(inv, "Priority"), invType === "WTY" ? "WTY" : ""].filter(Boolean).join(" "));
  const isWarranty = pri.isWarranty || /^(true|1|yes)$/i.test(rawStr(inv, "SvcInWarranty"));
  const flags = isWarranty && !pri.flags.split(",").includes("WTY") ? [...pri.flags.split(",").filter(Boolean), "WTY"].sort().join(",") : pri.flags;
  const qual = rawStr(inv, "Qualification").slice(0, 6);
  const total = ["SerialTotal", "ItemTotal", "LaborTotal", "MiscTotal", "WtyTotal", "Tax1Total", "Tax2Total", "Tax3Total"].reduce((a, c) => a + (num(rawGet(inv, c)) || 0), 0);
  const paid = (num(rawGet(inv, "CommittedPaymentTotal")) || 0) + (num(rawGet(inv, "OpenPaymentTotal")) || 0);
  const balance = Math.round((total - paid) * 100) / 100;
  const directions = rawStr(inv, "SoldToDirections").slice(0, 2000);
  const units = num(rawGet(inv, "DispatchUnits"));
  const estMinutes = units && units > 0 && units <= 12 ? Math.round(units * 60) : null;
  const prodCode = rawStr(inv, "SvcProductCode").toUpperCase();
  const [category, installType] = CATEGORY[prodCode] || [prodCode.toLowerCase(), ""];
  const detail = { category, installType, brand: rawStr(inv, "SvcBrandCode").slice(0, 40), model: rawStr(inv, "SvcModel").slice(0, 60), serial: rawStr(inv, "SvcSerial").slice(0, 60), problemText: rawStr(inv, "SvcComplaintDesc").slice(0, 2000), rawDetail: [prodCode, rawStr(inv, "SvcBrandCode"), rawStr(inv, "SvcModel"), rawStr(inv, "SvcSerial"), invType, rawStr(inv, "SvcComplaintDesc")].filter(Boolean).join(" ").slice(0, 2000) };
  const phone = digits(rawStr(inv, "SoldToPhone1") || rawStr(inv, "SoldToPhone2")).slice(-10);
  const phoneAlt = digits(rawStr(inv, "SoldToPhone2") || rawStr(inv, "SoldToBusinessPhone")).slice(-10);
  const email = rawStr(inv, "SoldToEmail").slice(0, 120);
  const name = [rawStr(inv, "SoldToFirstName"), rawStr(inv, "SoldToLastName")].filter(Boolean).join(" ").slice(0, 120);
  const paymentType = isWarranty ? "WTY" : (rawStr(inv, "PaymentTypeCode").toUpperCase() || "COD");
  const binLoc = (items.map((r) => rawStr(r, "LocationCode")).find(Boolean) || "").slice(0, 20);

  await client.query(`DELETE FROM sj_job_lines WHERE sv_number = $1`, [sv]);
  let lineNo = 0;
  for (const r of items) {
    const model = rawStr(r, "ItemCode", "Code"), desc = rawStr(r, "Description");
    if (!model && !desc) continue;
    lineNo += 1;
    await client.query(`INSERT INTO sj_job_lines (sv_number, line_no, model, description, qty, amount, raw, batch_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [sv, lineNo, model.slice(0, 80), desc.slice(0, 200), num(rawGet(r, "QtyOrdered", "Qty", "Quantity")), money(rawGet(r, "Total", "Amount", "SellingPrice")), JSON.stringify({ Model: model, Description: desc, Status: rawStr(r, "Status"), Location: rawStr(r, "LocationCode"), TripNo: rawStr(r, "TripNo") }), batchId]);
  }

  let job = await getJobRow(client, sv);
  let attached = false;
  if (!job) {
    job = await matchCreateTicket(client, sv, { phone, lastName: rawStr(inv, "SoldToLastName").toUpperCase(), zip: rawStr(inv, "SoldToZipCode") });
    attached = !!job;
  }
  const mirror = { epass_status: epassStatus, epass_route_date: routeDate, epass_tech_code: truck, epass_source: "ODBC", in_feed: true, balance, bin_location: binLoc, warranty_flags: flags, is_warranty: isWarranty, qualification: qual,
    epass_invoice_status: rawStr(inv, "Status").toUpperCase(), epass_created_at: parseDate(rawStr(inv, "DateCreated")), units: units == null ? null : Math.round(units), total };

  if (!job) {
    await client.query(
      `INSERT INTO sj_jobs (sv_number, customer_name, customer_code, phone, phone_alt, email, address1, address2, city, state, zip, lat, lng, zone_code, access_notes,
         unit_category, unit_install_type, unit_brand, unit_model, unit_serial, problem_text, raw_detail, qualification, warranty_flags, is_warranty, payment_type, balance, total, units, est_minutes, bin_location,
         status, status_changed_at, route_date, assigned_tech, owner_tech, epass_status, epass_route_date, epass_tech_code, epass_source, epass_seen_at, in_feed, epass_invoice_status, epass_created_at, source, needs_intake_review)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,NOW(),$33,$34,$35,$36,$37,$38,'ODBC',NOW(),TRUE,$39,$40,'import',TRUE)`,
      [sv, name, rawStr(inv, "SoldToCode").slice(0, 40), phone, phoneAlt, email,
       rawStr(inv, "SoldToAddress1").slice(0, 160), rawStr(inv, "SoldToAddress2").slice(0, 160), rawStr(inv, "SoldToCity").slice(0, 80), rawStr(inv, "SoldToState").slice(0, 4), rawStr(inv, "SoldToZipCode").slice(0, 10),
       lat, lng, zoneCode, directions, detail.category, detail.installType, detail.brand, detail.model, detail.serial, detail.problemText, detail.rawDetail, qual, flags, isWarranty, paymentType, balance, total, mirror.units, estMinutes, binLoc,
       epassStatus, routeDate, truck || null, INSTALL_STATUSES.includes(epassStatus) ? (truck || null) : null, epassStatus, routeDate, truck, mirror.epass_invoice_status, mirror.epass_created_at]
    );
    await addHistory(client, { sv, from: null, to: epassStatus, actorType: "import", actorId: "ODBC", trigger: "import.create", note: `created from ePASS feed; tech ${truck || "-"}` });
    if (CLOSED_STATUSES.includes(epassStatus)) await updateJob(client, sv, { closed_at: new Date() });
    await detectRecall(client, sv);
    return "created";
  }

  const changes = {};
  for (const [k, v] of Object.entries(mirror)) {
    if (k === "in_feed") { if (!job.in_feed) changes.in_feed = true; continue; }
    if (k === "balance" || k === "total" || k === "units") { if (!(job[k] == null && v == null) && Number(job[k]) !== Number(v)) changes[k] = v; continue; }
    if (k === "epass_route_date" || k === "epass_created_at") { if (dateStr(job[k]) !== v) changes[k] = v; continue; }
    if ((job[k] ?? "") !== v) changes[k] = v;
  }
  if (job.est_minutes == null && estMinutes != null) changes.est_minutes = estMinutes;
  if (!job.zone_code && zoneCode) changes.zone_code = zoneCode;
  if (!job.problem_text && detail.problemText) changes.problem_text = detail.problemText;
  if (!job.raw_detail && detail.rawDetail) changes.raw_detail = detail.rawDetail;
  if (job.lat == null && lat != null) { changes.lat = lat; changes.lng = lng; }
  if (!job.access_notes && directions) changes.access_notes = directions;
  for (const [col, val] of [["unit_category", detail.category], ["unit_install_type", detail.installType], ["unit_brand", detail.brand], ["unit_model", detail.model], ["unit_serial", detail.serial]]) {
    if (!job[col] && val) changes[col] = val;
  }
  if (!job.address1 && rawStr(inv, "SoldToAddress1")) { changes.address1 = rawStr(inv, "SoldToAddress1").slice(0, 160); changes.city = rawStr(inv, "SoldToCity").slice(0, 80); changes.state = rawStr(inv, "SoldToState").slice(0, 4); }
  if (!job.phone && phone) changes.phone = phone;
  if (!job.email && email) changes.email = email;
  if (!job.customer_code && rawStr(inv, "SoldToCode")) changes.customer_code = rawStr(inv, "SoldToCode").slice(0, 40);
  if (!job.customer_name && name) changes.customer_name = name;
  const substantive = Object.keys(changes).filter((k) => k !== "in_feed").length > 0;
  changes.epass_seen_at = new Date();
  if (substantive) changes.updated_at = new Date();
  await updateJob(client, sv, changes);
  if (attached) return "attached";
  return substantive ? "updated" : "unchanged";
}

// ---------------------------------------------------------------------------
// ExportInvoice (Invoice Maintenance) — the normalized rows the Service Order
// Health page already posts, extended with the service columns.
// ---------------------------------------------------------------------------
export async function importServiceInvoiceRows(rows, { filename = "", byEmail = "" } = {}) {
  const pool = await getReadyPool();
  const settings = await getSettings();
  const svRows = (rows || []).filter((r) => /^SV/i.test(String(r.invoice || "").trim()));
  const fileName = filename || `ExportInvoice ${new Date().toISOString()}`;
  const client = await pool.connect();
  const res = { source: "exportinvoice", fileName, rows: svRows.length, svOrders: svRows.length, created: 0, updated: 0, unchanged: 0, attached: 0, droppedFromFeed: 0, newZones: 0, sync: null, stale: 0, skipped: false };
  try {
    await client.query("BEGIN");
    const dup = await client.query(`SELECT id FROM sj_import_batches WHERE source = 'exportinvoice' AND file_name = $1`, [fileName]);
    if (dup.rows[0] && filename) { await client.query("ROLLBACK"); return { ...res, skipped: true, batchId: dup.rows[0].id }; }
    const batch = await client.query(`INSERT INTO sj_import_batches (source, file_name, imported_by) VALUES ('exportinvoice', $1, $2) RETURNING id`, [fileName, byEmail]);
    const batchId = batch.rows[0].id;
    const zonesBefore = (await client.query(`SELECT COUNT(*)::int AS n FROM sj_zones`)).rows[0].n;
    const seen = [];
    for (const r of svRows) {
      const sv = String(r.invoice).trim();
      res[await upsertFromInvoiceRow(client, sv, r, settings)] += 1;
      seen.push(sv);
    }
    res.newZones = (await client.query(`SELECT COUNT(*)::int AS n FROM sj_zones`)).rows[0].n - zonesBefore;
    res.sync = await reconcileAfterImport(client, batchId, seen, "EI", settings);
    res.stale = await markStale(client, settings);
    await client.query(`UPDATE sj_import_batches SET status = 'ok', summary = $2::jsonb, message = $3 WHERE id = $1`, [batchId, JSON.stringify(res), summaryLine(res)]);
    await client.query("COMMIT");
    return { ...res, batchId };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    await pool.query(`INSERT INTO sj_import_batches (source, file_name, imported_by, status, message) VALUES ('exportinvoice', $1, $2, 'failed', $3)`, [fileName + " @" + Date.now(), byEmail, String(err.message || err).slice(0, 500)]).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function upsertFromInvoiceRow(client, sv, r, settings) {
  const epassStatus = String(r.jobStatus || "").trim();
  const sp = await canonicalTech(client, r.sp || r.route);
  const zoneCode = (await ensureZone(client, r.mapZone)) || (await zoneForZip(client, r.zip));
  const { flags, isWarranty } = warrantyFlags(r.priorities);
  const pay = String(r.paymentType || "").trim().slice(0, 4);
  const qual = String(r.qualification || "").trim().slice(0, 6);
  const balance = money(r.balance), total = money(r.total);
  const finish = parseDate(r.finishDate), created = parseDate(r.dateCreated);
  let sched = parseDate(r.schedDate);
  const horizon = Number(settings["import.ei_sched_horizon_days"] || 120);
  if (sched && (new Date(sched + "T00:00:00Z").getTime() - Date.now()) / 864e5 > horizon) sched = null; // far-future placeholder = unscheduled
  const invStatus = String(r.status || "").trim().slice(0, 12);
  const brand = String(r.serviceBrand || "").trim().slice(0, 40), model = String(r.serviceModel || "").trim().slice(0, 60), serial = String(r.serviceSerial || "").trim().slice(0, 60);
  const units = Number.isFinite(Number(r.units)) && r.units !== "" && r.units != null ? Number(r.units) : null;
  const code = String(r.customerNumber || "").trim().slice(0, 40);
  const phone = /^\d{7,}$/.test(code) ? code.slice(-10) : "";

  let job = await getJobRow(client, sv);
  let attached = false;
  if (!job) { job = await matchCreateTicket(client, sv, { phone, lastName: String(r.name || "").trim().split(/\s+/)[0] || "", zip: r.zip }); attached = !!job; }

  const mirror = { epass_status: epassStatus, epass_tech_code: sp, epass_invoice_status: invStatus, epass_finish_date: finish, epass_created_at: created, balance, total, warranty_flags: flags, is_warranty: isWarranty, payment_type: pay, qualification: qual, units };

  if (!job) {
    const name = lastFirstToFirstLast(r.name);
    await client.query(
      `INSERT INTO sj_jobs (sv_number, customer_name, customer_code, phone, email, address1, state, zip, zone_code, unit_brand, unit_model, unit_serial, qualification, warranty_flags, is_warranty, payment_type, balance, total, units,
         status, status_changed_at, route_date, assigned_tech, owner_tech, epass_status, epass_route_date, epass_tech_code, epass_source, epass_seen_at, in_feed, epass_invoice_status, epass_finish_date, epass_created_at, source, needs_intake_review)
       VALUES ($1,$2,$3,$4,$5,$6,'TX',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),$20,$21,$22,$19,$20,$26,'EI',NOW(),FALSE,$23,$24,$25,'import',TRUE)`,
      [sv, name.slice(0, 120), code, phone, String(r.billToEmail || "").trim().slice(0, 120), String(r.address || "").trim().slice(0, 160), String(r.zip || "").trim().slice(0, 10), zoneCode, brand, model, serial, qual, flags, isWarranty, pay, balance, total, units,
       epassStatus, sched, sp || null, epassStatus && !["SO1", "SO1.AUTH", "REQ"].includes(epassStatus) ? (sp || null) : null, invStatus, finish, created, sp]
    );
    await addHistory(client, { sv, from: null, to: epassStatus, actorType: "import", actorId: "EI", trigger: "import.create", note: `created from ExportInvoice; SP ${sp || "-"}` });
    if (CLOSED_STATUSES.includes(epassStatus)) await updateJob(client, sv, { closed_at: new Date() });
    await detectRecall(client, sv);
    return "created";
  }

  const changes = {};
  for (const [k, v] of Object.entries(mirror)) {
    if (v == null || v === "") continue;
    if (k === "epass_tech_code" && job.in_feed) continue; // DispatchTrack's Truck is the routing authority while the job is in its feed
    if (["balance", "total"].includes(k)) { if (Number(job[k]) !== Number(v)) changes[k] = v; continue; }
    if (["epass_finish_date", "epass_created_at"].includes(k)) { if (dateStr(job[k]) !== v) changes[k] = v; continue; }
    if ((job[k] ?? "") !== v) changes[k] = v;
  }
  if (!job.in_feed && dateStr(job.epass_route_date) !== sched) changes.epass_route_date = sched;
  if (!job.in_feed && job.epass_source !== "EI") changes.epass_source = "EI";
  if (!job.zone_code && zoneCode) changes.zone_code = zoneCode;
  for (const [col, val] of [["unit_brand", brand], ["unit_model", model], ["unit_serial", serial], ["customer_code", code], ["email", String(r.billToEmail || "").trim().slice(0, 120)], ["phone", phone]]) if (!job[col] && val) changes[col] = val;
  const substantive = Object.keys(changes).length > 0;
  changes.epass_seen_at = new Date();
  if (substantive) changes.updated_at = new Date();
  await updateJob(client, sv, changes);
  if (attached) return "attached";
  return substantive ? "updated" : "unchanged";
}

// A dashboard job waiting for its ePASS ticket: an unknown SV whose phone or
// last name + zip matches an open create_ticket item is that ticket.
async function matchCreateTicket(client, sv, { phone, lastName: ln, zip }) {
  const items = await client.query(`SELECT s.id, s.sv_number, j.phone, j.phone_alt, j.customer_name, j.zip FROM sj_sync_items s JOIN sj_jobs j ON j.sv_number = s.sv_number WHERE s.kind = 'create_ticket' AND s.state IN ('pending','keyed') AND j.sv_number LIKE 'NEW-%'`);
  const pd = digits(phone).slice(-10);
  const z = String(zip || "").trim().slice(0, 5);
  for (const it of items.rows) {
    const phones = new Set([digits(it.phone).slice(-10), digits(it.phone_alt).slice(-10)].filter(Boolean));
    if ((pd && phones.has(pd)) || (ln && lastName(it.customer_name) === String(ln).toUpperCase() && z && it.zip === z)) {
      // move the placeholder job onto the real SV number
      await client.query(`UPDATE sj_jobs SET sv_number = $2, updated_at = NOW() WHERE sv_number = $1`, [it.sv_number, sv]);
      await client.query(`UPDATE sj_status_history SET sv_number = $2 WHERE sv_number = $1`, [it.sv_number, sv]);
      await client.query(`UPDATE sj_sync_items SET sv_number = $2 WHERE sv_number = $1`, [it.sv_number, sv]);
      await client.query(`UPDATE sj_sync_items SET state = 'confirmed', confirmed_at = NOW(), note = $2 WHERE id = $1`, [it.id, `matched ePASS ticket ${sv}`]);
      return getJobRow(client, sv);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sync queue (spec §3.5)
// ---------------------------------------------------------------------------
const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${Number(m)}/${Number(d)}/${y}`; };
export function renderPacket(sv, customerName, kind, p) {
  const lines = [`${sv || "NEW TICKET"}  ${customerName || ""}`.trimEnd()];
  if (kind === "create_ticket") {
    const c = p.customer || {}, a = p.address || {}, u = p.unit || {};
    lines.push(`CUSTOMER: ${c.phone || "—"}   ${c.email || ""}`.trimEnd());
    lines.push(`ADDRESS: ${[a.line1, a.line2, a.city, a.zip].filter(Boolean).join(", ")}`);
    const ub = ["category", "brand", "model", "serial"].map((k) => u[k]).filter(Boolean).join(" ");
    if (ub) lines.push(`UNIT: ${ub}`);
    if (p.problem) lines.push(`PROBLEM: ${String(p.problem).slice(0, 200)}`);
  }
  const bits = [];
  if (p.status) bits.push(`STATUS: ${p.status}`);
  if (p.route_date) bits.push(`DATE: ${fmtDate(p.route_date)}`);
  if (p.window) bits.push(`WINDOW: ${{ AM: "8–12", PM: "12–5" }[String(p.window).toUpperCase()] || p.window}`);
  if (p.tech) bits.push(`TECH: ${p.tech}`);
  if (bits.length) lines.push(bits.join("   "));
  if (Array.isArray(p.lines) && p.lines.length) {
    lines.push("LINES:");
    for (const ln of p.lines) lines.push(`  ${String(ln.code || "LAB").padEnd(12)} ${ln.desc || ""}  x${ln.qty ?? 1}  $${Number(ln.price || 0).toFixed(2)}`);
  }
  if (p.payment) lines.push(`PAYMENT: $${Number(p.payment.amount || 0).toFixed(2)} ${p.payment.method || "card"} ${p.payment.ref || ""}`.trimEnd());
  if (p.note) lines.push(`NOTE: ${p.note}`);
  return lines.join("\n");
}
async function createSyncItem(client, job, kind, payload, { byEmail = "", note = "", state = "pending", epassValues = null, batchId = null } = {}) {
  if (note && !payload.note) payload = { ...payload, note };
  const packet = renderPacket(job.sv_number, job.customer_name, kind, payload);
  const r = await client.query(
    `INSERT INTO sj_sync_items (sv_number, kind, payload, packet_text, state, created_by, epass_values, confirmed_by_batch, note) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id`,
    [job.sv_number, kind, JSON.stringify(payload), packet, state, byEmail, epassValues ? JSON.stringify(epassValues) : null, batchId, note]
  );
  return r.rows[0].id;
}
const statusEq = (a, b) => a === b || (a && b && LENIENT_PAIRS.some((s) => s.has(a) && s.has(b)));
function payloadMatches(payload, ev, source, settings) {
  const checks = [];
  if (payload.status) {
    if (source === "DT" && !settings["feed.dt_complete"] && !DT_ROUTING_STATUSES.includes(payload.status) && !ev.status) return null; // this feed can't tell
    checks.push(statusEq(payload.status, ev.status));
  }
  if (payload.route_date) checks.push(String(payload.route_date).slice(0, 10) === (ev.route_date || ""));
  if (payload.tech) checks.push(sameTech(payload.tech, ev.tech));
  if (!checks.length) return null;
  return checks.every(Boolean);
}
async function reconcileAfterImport(client, batchId, svNumbers, source, settings) {
  const counts = { confirmed: 0, mismatched: 0, discrepancies: 0, reverse: 0, followed: 0 };
  const cycles = Number(settings["sync.mismatch_cycles_before_discrepancy"] || 2);
  const follow = settings["sync.follow_epass_for_import_jobs"] !== false;
  for (const sv of svNumbers) {
    const job = await getJobRow(client, sv);
    if (!job) continue;
    const ev = { status: job.epass_status || null, route_date: dateStr(job.epass_route_date), tech: job.epass_tech_code || null };
    const items = await client.query(`SELECT * FROM sj_sync_items WHERE sv_number = $1 AND state IN ('pending','keyed') ORDER BY created_at`, [sv]);
    for (const it of items.rows) {
      const m = payloadMatches(it.payload || {}, ev, source, settings);
      if (m === true) {
        await client.query(`UPDATE sj_sync_items SET state = 'confirmed', confirmed_at = NOW(), confirmed_by_batch = $2, epass_values = $3::jsonb WHERE id = $1`, [it.id, batchId, JSON.stringify(ev)]);
        counts.confirmed += 1;
      } else if (m === false && it.state === "keyed") {
        const mc = (it.mismatch_count || 0) + 1;
        if (mc >= cycles) { await client.query(`UPDATE sj_sync_items SET mismatch_count = $2, epass_values = $3::jsonb, state = 'discrepancy' WHERE id = $1`, [it.id, mc, JSON.stringify(ev)]); counts.discrepancies += 1; }
        else { await client.query(`UPDATE sj_sync_items SET mismatch_count = $2, epass_values = $3::jsonb WHERE id = $1`, [it.id, mc, JSON.stringify(ev)]); counts.mismatched += 1; }
      }
    }
    if (items.rows.length) continue; // an open item explains any difference
    const dash = { status: job.status || null, route_date: dateStr(job.route_date), tech: job.assigned_tech || null };
    const diff = {};
    if (ev.status && !statusEq(ev.status, dash.status)) diff.status = ev.status;
    if (ev.route_date !== dash.route_date && (job.in_feed || source === "EI")) diff.route_date = ev.route_date;
    if (!sameTech(ev.tech, dash.tech) && job.in_feed) diff.tech = ev.tech;
    if (!Object.keys(diff).length) continue;
    if (job.source === "import" && follow) {
      const changes = { updated_at: new Date() };
      if (diff.status) { changes.status = diff.status; changes.status_changed_at = new Date(); await addHistory(client, { sv, from: dash.status, to: diff.status, actorType: "import", actorId: source, trigger: "epass_follow", note: `batch ${batchId}` }); if (CLOSED_STATUSES.includes(diff.status) && !job.closed_at) changes.closed_at = new Date(); }
      if ("route_date" in diff) changes.route_date = diff.route_date;
      if ("tech" in diff) changes.assigned_tech = diff.tech;
      await updateJob(client, sv, changes);
      counts.followed += 1;
      continue;
    }
    const already = await client.query(`SELECT epass_values FROM sj_sync_items WHERE sv_number = $1 AND state = 'discrepancy' ORDER BY created_at DESC LIMIT 1`, [sv]);
    if (already.rows[0] && JSON.stringify(already.rows[0].epass_values) === JSON.stringify(ev)) continue;
    await createSyncItem(client, job, "set_status", { status: dash.status, route_date: dash.route_date, tech: dash.tech, note: "ePASS differs from Agility with no sync item explaining it. Accept ePASS or re-issue." },
      { state: "discrepancy", epassValues: ev, batchId, note: `reverse discrepancy from ${source} batch ${batchId}` });
    counts.reverse += 1;
  }
  return counts;
}

export async function listSyncItems(state = "") {
  const pool = await getReadyPool();
  const r = state
    ? await pool.query(`SELECT s.*, j.customer_name, j.status AS job_status FROM sj_sync_items s LEFT JOIN sj_jobs j ON j.sv_number = s.sv_number WHERE s.state = $1 ORDER BY s.created_at DESC LIMIT 300`, [state])
    : await pool.query(`SELECT s.*, j.customer_name, j.status AS job_status FROM sj_sync_items s LEFT JOIN sj_jobs j ON j.sv_number = s.sv_number WHERE s.state IN ('pending','keyed','discrepancy') ORDER BY CASE s.state WHEN 'discrepancy' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, s.created_at`);
  return r.rows.map(mapSync);
}
const mapSync = (s) => ({ id: Number(s.id), svNumber: s.sv_number, customerName: s.customer_name || "", jobStatus: s.job_status || "", kind: s.kind, payload: s.payload || {}, packetText: s.packet_text, state: s.state, createdAt: iso(s.created_at), createdBy: s.created_by, keyedAt: iso(s.keyed_at), keyedBy: s.keyed_by, confirmedAt: iso(s.confirmed_at), epassValues: s.epass_values, mismatchCount: s.mismatch_count, resolvedAt: iso(s.resolved_at), resolvedBy: s.resolved_by, resolution: s.resolution, note: s.note });
export async function markSyncKeyed(id, byEmail) {
  const pool = await getReadyPool();
  const r = await pool.query(`UPDATE sj_sync_items SET state = 'keyed', keyed_at = NOW(), keyed_by = $2, mismatch_count = 0 WHERE id = $1 AND state = 'pending' RETURNING *`, [id, byEmail]);
  if (!r.rows[0]) throw new Error("That sync item isn't pending.");
  return mapSync(r.rows[0]);
}
export async function resolveSyncItem(id, resolution, byEmail) {
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = (await client.query(`SELECT * FROM sj_sync_items WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!cur || cur.state !== "discrepancy") throw new Error("That sync item isn't in discrepancy.");
    if (resolution === "reissue") {
      await client.query(`UPDATE sj_sync_items SET state = 'pending', keyed_at = NULL, keyed_by = NULL, mismatch_count = 0, epass_values = NULL, resolution = 'reissued', note = $2 WHERE id = $1`, [id, `re-issued by ${byEmail}`]);
    } else if (resolution === "accept_epass") {
      const job = await getJobRow(client, cur.sv_number);
      const ev = cur.epass_values || {};
      const changes = { updated_at: new Date() };
      if (ev.status && ev.status !== job.status) { changes.status = ev.status; changes.status_changed_at = new Date(); await addHistory(client, { sv: job.sv_number, from: job.status, to: ev.status, actorType: "staff", actorId: byEmail, trigger: "epass_accept", reasonCode: "accept_epass", note: `sync item ${id}` }); if (CLOSED_STATUSES.includes(ev.status) && !job.closed_at) changes.closed_at = new Date(); }
      if ("route_date" in ev && ev.route_date !== dateStr(job.route_date)) changes.route_date = ev.route_date;
      if ("tech" in ev && !sameTech(ev.tech, job.assigned_tech)) changes.assigned_tech = ev.tech;
      await updateJob(client, job.sv_number, changes);
      await client.query(`UPDATE sj_sync_items SET state = 'resolved', resolved_at = NOW(), resolved_by = $2, resolution = 'accept_epass' WHERE id = $1`, [id, byEmail]);
    } else throw new Error("resolution must be reissue or accept_epass");
    await client.query("COMMIT");
    return mapSync((await client.query(`SELECT * FROM sj_sync_items WHERE id = $1`, [id])).rows[0]);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

// ---------------------------------------------------------------------------
// Manual status change (spec §2 rule 35): needs a reason code, writes history,
// flips the job to dashboard-owned, and queues the ePASS packet.
// ---------------------------------------------------------------------------
export async function setJobStatus(sv, { status, reasonCode, note = "", routeDate, tech, byEmail = "", byName = "" }) {
  const target = String(status || "").trim().toUpperCase();
  if (!STATUS_DEFS[target]) throw new Error(`Unknown status ${target}.`);
  if (!REASON_CODES.includes(reasonCode)) throw new Error("A reason code is required for a manual status change.");
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = await getJobRow(client, sv);
    if (!job) throw new Error("Job not found.");
    const changes = { status: target, status_changed_at: new Date(), source: "dashboard", updated_at: new Date() };
    if (routeDate !== undefined) changes.route_date = routeDate || null;
    if (tech !== undefined) changes.assigned_tech = tech ? await canonicalTech(client, tech) : null;
    if (CLOSED_STATUSES.includes(target)) changes.closed_at = job.closed_at || new Date(); else changes.closed_at = null;
    await updateJob(client, sv, changes);
    await addHistory(client, { sv, from: job.status, to: target, actorType: "staff", actorId: byEmail, trigger: "staff.manual_status", reasonCode, note });
    let syncId = null;
    if (reasonCode !== "keyed_in_epass") {
      const payload = { status: target, route_date: changes.route_date !== undefined ? changes.route_date : dateStr(job.route_date), tech: changes.assigned_tech !== undefined ? changes.assigned_tech : job.assigned_tech };
      if (note) payload.note = String(note).slice(0, 200);
      syncId = await createSyncItem(client, job, "set_status", payload, { byEmail, note: "" });
    } else {
      // Already keyed in ePASS by hand: the next import confirms it without a packet.
      const payload = { status: target };
      syncId = await createSyncItem(client, job, "set_status", payload, { byEmail, state: "keyed", note: "keyed by hand before the change was recorded" });
      await client.query(`UPDATE sj_sync_items SET keyed_at = NOW(), keyed_by = $2 WHERE id = $1`, [syncId, byEmail]);
    }
    await client.query("COMMIT");
    return { job: mapJob(await getJobRow(pool, sv)), syncId };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}
export async function setIntakeReviewed(sv, byEmail) {
  const pool = await getReadyPool();
  await pool.query(`UPDATE sj_jobs SET needs_intake_review = FALSE, updated_at = NOW() WHERE sv_number = $1`, [sv]);
  return mapJob(await getJobRow(pool, sv));
}
export async function setOwnerTech(sv, tech, byEmail) {
  const pool = await getReadyPool();
  const code = tech ? await canonicalTech(pool, tech) : null;
  await pool.query(`UPDATE sj_jobs SET owner_tech = $2, updated_at = NOW() WHERE sv_number = $1`, [sv, code]);
  return mapJob(await getJobRow(pool, sv));
}

// ---------------------------------------------------------------------------
// Stale and stuck (phase0 stuck.py)
// ---------------------------------------------------------------------------
async function markStale(client, settings) {
  const grace = Number(settings["stale.grace_hours"] || 18);
  const cutoff = new Date(Date.now() - grace * 36e5).toISOString().slice(0, 10);
  await client.query(`UPDATE sj_jobs SET stale = FALSE, updated_at = NOW() WHERE stale AND NOT (closed_at IS NULL AND COALESCE(NULLIF(epass_status,''), status) IN ('SO1','SO6') AND COALESCE(epass_route_date, route_date) < $1::date)`, [cutoff]);
  await client.query(`UPDATE sj_jobs SET stale = TRUE, updated_at = NOW() WHERE NOT stale AND closed_at IS NULL AND COALESCE(NULLIF(epass_status,''), status) IN ('SO1','SO6') AND COALESCE(epass_route_date, route_date) < $1::date`, [cutoff]);
  return (await client.query(`SELECT COUNT(*)::int AS n FROM sj_jobs WHERE stale`)).rows[0].n;
}
export async function listStuckJobs() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM sj_jobs WHERE closed_at IS NULL AND status NOT IN ('SO8','SO8I','SO9','SO7')`);
  const out = [];
  for (const j of r.rows) {
    const info = statusInfo(j.status);
    let thr = info.stuckAfterHours;
    if (j.status === "SO1" && (j.flags || []).includes("research")) thr = 72;
    if (!thr) continue;
    const hours = (Date.now() - new Date(j.status_changed_at).getTime()) / 36e5;
    if (hours > thr) out.push({ ...mapJob(j), hoursInStatus: Math.round(hours * 10) / 10, thresholdHours: thr });
  }
  out.sort((a, b) => b.hoursInStatus - a.hoursInStatus);
  return out;
}
export async function listStaleJobs() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM sj_jobs WHERE stale ORDER BY COALESCE(epass_route_date, route_date), sv_number`);
  return r.rows.map(mapJob);
}

// ---------------------------------------------------------------------------
// Recalls (phase0 kpi.py detect_recall)
// ---------------------------------------------------------------------------
async function detectRecall(client, sv) {
  const job = await getJobRow(client, sv);
  if (!job) return null;
  if ((await client.query(`SELECT 1 FROM sj_recalls WHERE sv_number = $1`, [sv])).rows[0]) return null;
  const settings = await getSettings();
  const window = Number(settings["recall.window_days"] || 30);
  const created = dateStr(job.epass_created_at) || dateStr(job.first_seen_at) || new Date().toISOString().slice(0, 10);
  const since = new Date(new Date(created + "T00:00:00Z").getTime() - window * 864e5).toISOString().slice(0, 10);
  const finishOf = (j) => dateStr(j.epass_finish_date) || dateStr(j.closed_at) || dateStr(j.status_changed_at) || "";
  const pick = (rows) => rows.filter((j) => { const f = finishOf(j); return f && since <= f && f <= created; }).sort((a, b) => finishOf(b).localeCompare(finishOf(a)))[0] || null;
  let original = null, basis = "";
  const serial = String(job.unit_serial || "").trim();
  if (serial && !["—", "-", "0", "00000", "NA", "N/A", "NONE"].includes(serial.toUpperCase())) {
    original = pick((await client.query(`SELECT * FROM sj_jobs WHERE unit_serial = $1 AND sv_number <> $2 AND status IN ('SO8','SO8I')`, [serial, sv])).rows);
    basis = "serial";
  }
  if (!original && job.unit_model && job.address1) {
    original = pick((await client.query(`SELECT * FROM sj_jobs WHERE unit_model = $1 AND address1 = $2 AND zip = $3 AND sv_number <> $4 AND status IN ('SO8','SO8I')`, [job.unit_model, job.address1, job.zip, sv])).rows);
    basis = "model_address";
  }
  const epassRcall = String(job.warranty_flags || "").includes("RCALL");
  if (!original && !epassRcall) return null;
  let days = null, tech = job.owner_tech || job.assigned_tech || null, state = "confirmed", origSv = null;
  if (original) {
    days = Math.round((new Date(created + "T00:00:00Z") - new Date(finishOf(original) + "T00:00:00Z")) / 864e5);
    tech = original.owner_tech || original.assigned_tech || null;
    state = epassRcall ? "confirmed" : "candidate";
    origSv = original.sv_number;
  } else basis = "epass_rcall";
  const r = await client.query(`INSERT INTO sj_recalls (sv_number, original_sv, tech, days_between, basis, state) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [sv, origSv, tech, days, basis, state]);
  const flags = new Set(job.flags || []); flags.add(state === "candidate" ? "recall_candidate" : "recall");
  await updateJob(client, sv, { flags: [...flags] });
  return r.rows[0].id;
}
export async function listRecalls(state = "") {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT r.*, j.customer_name, j.unit_brand, j.unit_category, j.unit_model, j.unit_serial, j.status AS job_status, j.epass_created_at, o.epass_finish_date AS original_finish, o.status AS original_status FROM sj_recalls r LEFT JOIN sj_jobs j ON j.sv_number = r.sv_number LEFT JOIN sj_jobs o ON o.sv_number = r.original_sv ${state ? "WHERE r.state = $1" : ""} ORDER BY CASE r.state WHEN 'candidate' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 300`, state ? [state] : []);
  return r.rows.map((x) => ({ id: Number(x.id), svNumber: x.sv_number, originalSv: x.original_sv, tech: x.tech, daysBetween: x.days_between, basis: x.basis, state: x.state, reviewedBy: x.reviewed_by, reviewedAt: iso(x.reviewed_at), note: x.note, createdAt: iso(x.created_at), customerName: x.customer_name, unit: [x.unit_brand, x.unit_category, x.unit_model].filter(Boolean).join(" "), serial: x.unit_serial, jobStatus: x.job_status, jobCreated: dateStr(x.epass_created_at), originalFinish: dateStr(x.original_finish), originalStatus: x.original_status }));
}
export async function reviewRecall(id, state, byEmail, note = "") {
  if (!["confirmed", "dismissed"].includes(state)) throw new Error("state must be confirmed or dismissed");
  const pool = await getReadyPool();
  const r = await pool.query(`UPDATE sj_recalls SET state = $2, reviewed_by = $3, reviewed_at = NOW(), note = $4 WHERE id = $1 RETURNING sv_number`, [id, state, byEmail, String(note || "").slice(0, 500)]);
  if (!r.rows[0]) throw new Error("Recall not found.");
  const job = await getJobRow(pool, r.rows[0].sv_number);
  if (job) {
    const flags = new Set((job.flags || []).filter((f) => f !== "recall_candidate" && f !== "recall"));
    if (state === "confirmed") flags.add("recall");
    await updateJob(pool, job.sv_number, { flags: [...flags] });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Reads: overview, list, detail, search, history, imports, KPIs
// ---------------------------------------------------------------------------
export async function serviceJourneyOverview() {
  const pool = await getReadyPool();
  const [byStatus, sync, stale, review, imports, recalls, settings] = await Promise.all([
    pool.query(`SELECT status, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE in_feed)::int AS in_feed FROM sj_jobs WHERE closed_at IS NULL GROUP BY status`),
    pool.query(`SELECT state, COUNT(*)::int AS n FROM sj_sync_items WHERE state IN ('pending','keyed','discrepancy') GROUP BY state`),
    pool.query(`SELECT COUNT(*)::int AS n FROM sj_jobs WHERE stale`),
    pool.query(`SELECT COUNT(*)::int AS n FROM sj_jobs WHERE needs_intake_review AND closed_at IS NULL`),
    pool.query(`SELECT DISTINCT ON (source) source, file_name, imported_at, status, summary FROM sj_import_batches WHERE status = 'ok' ORDER BY source, imported_at DESC`),
    pool.query(`SELECT COUNT(*)::int AS n FROM sj_recalls WHERE state = 'candidate'`),
    getSettings()
  ]);
  const stuck = await listStuckJobs();
  const statuses = byStatus.rows.map((r) => ({ status: r.status, ...statusInfo(r.status), count: r.n, inFeed: r.in_feed })).sort((a, b) => a.sort - b.sort);
  const syncCounts = Object.fromEntries(sync.rows.map((r) => [r.state, r.n]));
  return {
    statuses, openJobs: statuses.reduce((s, x) => s + x.count, 0), stuck: stuck.length, stale: stale.rows[0].n, needsReview: review.rows[0].n, recallCandidates: recalls.rows[0].n,
    sync: { pending: syncCounts.pending || 0, keyed: syncCounts.keyed || 0, discrepancy: syncCounts.discrepancy || 0 },
    lastImports: imports.rows.map((r) => ({ source: r.source, fileName: r.file_name, importedAt: iso(r.imported_at), summary: r.summary })),
    dtComplete: settings["feed.dt_complete"] === true
  };
}

export async function listServiceJobs({ q = "", status = "", tech = "", zone = "", onlyOpen = true, stale = false, review = false, limit = 500 } = {}) {
  const pool = await getReadyPool();
  const where = [], params = [];
  if (onlyOpen) where.push(`closed_at IS NULL`);
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (tech) { params.push(tech.toUpperCase()); where.push(`(assigned_tech = $${params.length} OR owner_tech = $${params.length} OR epass_tech_code = $${params.length})`); }
  if (zone) { params.push(zone.toUpperCase()); where.push(`zone_code = $${params.length}`); }
  if (stale) where.push(`stale`);
  if (review) where.push(`needs_intake_review`);
  if (q) {
    const text = String(q).trim();
    const d = digits(text);
    params.push(`%${text.toUpperCase()}%`);
    const p = params.length;
    let cond = `(UPPER(customer_name) LIKE $${p} OR UPPER(sv_number) LIKE $${p} OR UPPER(unit_serial) LIKE $${p} OR UPPER(unit_model) LIKE $${p} OR UPPER(address1) LIKE $${p} OR UPPER(customer_code) LIKE $${p})`;
    if (d.length >= 4) { params.push(`%${d}%`); cond = `(${cond.slice(1, -1)} OR phone LIKE $${params.length} OR phone_alt LIKE $${params.length} OR sv_number LIKE $${params.length})`; }
    where.push(cond);
  }
  params.push(Math.min(Number(limit) || 500, 2000));
  const r = await pool.query(`SELECT * FROM sj_jobs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY closed_at IS NOT NULL, COALESCE(route_date, epass_route_date) NULLS LAST, sv_number DESC LIMIT $${params.length}`, params);
  return r.rows.map(mapJob);
}

export async function getServiceJob(sv) {
  const pool = await getReadyPool();
  const job = await getJobRow(pool, sv);
  if (!job) return null;
  const [lines, history, sync, recall, related] = await Promise.all([
    pool.query(`SELECT * FROM sj_job_lines WHERE sv_number = $1 ORDER BY line_no`, [sv]),
    pool.query(`SELECT * FROM sj_status_history WHERE sv_number = $1 ORDER BY changed_at DESC, id DESC`, [sv]),
    pool.query(`SELECT * FROM sj_sync_items WHERE sv_number = $1 ORDER BY created_at DESC`, [sv]),
    pool.query(`SELECT * FROM sj_recalls WHERE sv_number = $1 OR original_sv = $1`, [sv]),
    relatedJobs(pool, job)
  ]);
  return {
    job: mapJob(job),
    lines: lines.rows.map((l) => ({ lineNo: l.line_no, model: l.model, description: l.description, qty: l.qty == null ? null : Number(l.qty), amount: l.amount == null ? null : Number(l.amount), raw: l.raw })),
    history: history.rows.map((h) => ({ id: Number(h.id), from: h.from_status, to: h.to_status, at: iso(h.changed_at), actorType: h.actor_type, actorId: h.actor_id, trigger: h.trigger_event, reasonCode: h.reason_code, note: h.note })),
    sync: sync.rows.map(mapSync),
    recalls: recall.rows.map((x) => ({ id: Number(x.id), svNumber: x.sv_number, originalSv: x.original_sv, tech: x.tech, daysBetween: x.days_between, basis: x.basis, state: x.state })),
    related
  };
}
// Other jobs for the same customer or unit — the history the office asked for.
async function relatedJobs(pool, job) {
  const clauses = [], params = [job.sv_number];
  if (job.customer_code) { params.push(job.customer_code); clauses.push(`customer_code = $${params.length}`); }
  if (job.phone) { params.push(job.phone); clauses.push(`(phone = $${params.length} OR phone_alt = $${params.length})`); }
  const serial = String(job.unit_serial || "").trim();
  if (serial && serial.length > 4) { params.push(serial); clauses.push(`unit_serial = $${params.length}`); }
  if (job.address1 && job.zip) { params.push(job.address1); params.push(job.zip); clauses.push(`(address1 = $${params.length - 1} AND zip = $${params.length})`); }
  if (!clauses.length) return [];
  const r = await pool.query(`SELECT * FROM sj_jobs WHERE sv_number <> $1 AND (${clauses.join(" OR ")}) ORDER BY COALESCE(epass_created_at, first_seen_at::date) DESC LIMIT 50`, params);
  return r.rows.map((x) => ({ ...mapJob(x), sameUnit: !!serial && x.unit_serial === serial }));
}

export async function listImportBatches(limit = 40) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM sj_import_batches ORDER BY imported_at DESC LIMIT $1`, [limit]);
  return r.rows.map((b) => ({ id: Number(b.id), source: b.source, fileName: b.file_name, importedAt: iso(b.imported_at), importedBy: b.imported_by, status: b.status, summary: b.summary, message: b.message }));
}

// KPIs from the mirror (spec §3.7 starter set; thin until the closed-invoice back-fill).
export async function serviceKpis({ from, to } = {}) {
  const pool = await getReadyPool();
  const f = parseDate(from) || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const t = parseDate(to) || new Date().toISOString().slice(0, 10);
  const settings = await getSettings();
  const diagFee = Number(settings["fee.diagnostic"] || 169.95);
  const techs = await listTechs();
  const jobs = (await pool.query(`SELECT * FROM sj_jobs WHERE (epass_finish_date BETWEEN $1 AND $2) OR (COALESCE(route_date, epass_route_date) BETWEEN $1 AND $2) OR (status_changed_at::date BETWEEN $1 AND $2)`, [f, t])).rows;
  const recalls = (await pool.query(`SELECT tech, state, created_at FROM sj_recalls WHERE created_at::date BETWEEN $1 AND $2`, [f, t])).rows;
  const unreviewedAfter = Number(settings["recall.unreviewed_counts_after_days"] || 7);
  const rows = techs.map((tech) => {
    const mine = jobs.filter((j) => sameTech(j.owner_tech || j.assigned_tech || j.epass_tech_code, tech.code));
    const completed = mine.filter((j) => ["SO8", "SO8I"].includes(j.status) && dateStr(j.epass_finish_date) && dateStr(j.epass_finish_date) >= f && dateStr(j.epass_finish_date) <= t);
    const visits = mine.filter((j) => ["SO1", "SO6", "SO8", "SO8I", "SO7"].includes(j.status) && dateStr(j.route_date || j.epass_route_date) && dateStr(j.route_date || j.epass_route_date) >= f && dateStr(j.route_date || j.epass_route_date) <= t);
    const workingDays = countWorkingDays(f, t, tech.workDays);
    const turnaround = completed.map((j) => j.epass_created_at && j.epass_finish_date ? (new Date(dateStr(j.epass_finish_date)) - new Date(dateStr(j.epass_created_at))) / 864e5 : null).filter((x) => x != null).sort((a, b) => a - b);
    const diagOnly = completed.filter((j) => j.total != null && Math.abs(Number(j.total) - diagFee) < 0.01).length;
    const rc = recalls.filter((r) => sameTech(r.tech, tech.code) && (r.state === "confirmed" || (r.state === "candidate" && (Date.now() - new Date(r.created_at).getTime()) / 864e5 > unreviewedAfter)));
    return {
      tech: tech.code, name: tech.name, autoRoute: tech.autoRoute, visits: visits.length, completed: completed.length, workingDays,
      callsPerDay: workingDays ? Math.round((visits.length / workingDays) * 100) / 100 : null,
      medianTurnaroundDays: turnaround.length ? turnaround[Math.floor(turnaround.length / 2)] : null,
      diagOnly, diagOnlyRate: completed.length ? Math.round((diagOnly / completed.length) * 1000) / 10 : null,
      recalls: rc.length, recallRate: completed.length ? Math.round((rc.length / completed.length) * 1000) / 10 : null
    };
  }).filter((r) => r.visits || r.completed || r.recalls);
  return { from: f, to: t, rows, note: "Computed from the mirrored open-ticket exports. Turnaround and diag-only need the finish date and total from ExportInvoice; recalls need a closed job in the mirror — both fill in as history accumulates (Phase 0.5 back-fill)." };
}
function countWorkingDays(from, to, workDays) {
  const days = new Set(String(workDays || "Mon,Tue,Wed,Thu,Fri").split(",").map((d) => d.trim().slice(0, 3)));
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let n = 0;
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d = new Date(d.getTime() + 864e5)) if (days.has(names[d.getUTCDay()])) n += 1;
  return n;
}

export async function listZones() {
  const pool = await getReadyPool();
  return (await pool.query(`SELECT z.*, (SELECT COUNT(*)::int FROM sj_jobs j WHERE j.zone_code = z.zone_code AND j.closed_at IS NULL) AS open_jobs FROM sj_zones z ORDER BY needs_review DESC, zone_group, zone_code`)).rows
    .map((z) => ({ code: z.zone_code, group: z.zone_group, bookingMode: z.booking_mode, km: z.km_from_shop == null ? null : Number(z.km_from_shop), primaryTech: z.primary_tech, secondaryTechs: z.secondary_techs || [], needsReview: z.needs_review, notes: z.notes, openJobs: z.open_jobs }));
}

// Shared with lib/service-board-postgres.js (the dispatch board writes
// route_date / tech / window / stop order through the same history + sync
// packet path as everything else here).
export const boardInternals = { getReadyPool, getJobRow, updateJob, addHistory, createSyncItem, canonicalTech, INSTALL_STATUSES, CLOSED_STATUSES, mapJob };

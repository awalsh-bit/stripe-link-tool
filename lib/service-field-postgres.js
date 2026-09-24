import { boardInternals, setJobStatus, runStatusRules, getSettings } from "./service-journey-postgres.js";
import { customerHistory, modelInsight, laborRateFor, serialSeenBefore, callDetail, tidy } from "./epass-catalogue-postgres.js";
import { fiscalPeriodFor, listServiceCompPlans, getServiceCompSettings, svTicketsBetween, weeklyQuotaFor } from "./service-commissions-postgres.js";
import { createServiceEstimate, normalizeEta, etaMessage, addBusinessDays, centralDateOf, assessPartsQuality } from "./service-estimates-postgres.js";

// ---------------------------------------------------------------------------
// TECH FIELD TOOL (service-field.html, Client Care)
//
// 9/22 late — first cut on the real mirror (sj_jobs): the tech's day in the
// board's stop order, On my way / Arrived / an outcome per stop through
// setJobStatus (reason tech_update, packet queued), findings + parts to the
// office's Parts Verify step.
//
// 9/23 — Andrew re-read Cayden's field tool prototype and the blueprint and
// listed what had not survived. This file now carries:
//   • labor lines the tech builds (doc 07 §5.1a/b, §8a): the zone fee by
//     distance from the shop (auto, COD only), a component change-out picked
//     from ePASS's own LaborRate table with its price shown, the time the
//     repair will take (30 min … full day) which prices the line at $130/h
//     and sizes the return trip (est_minutes on the job), $20 FREIGHT (COD,
//     office-owned), and every amount editable before "send to the office".
//   • customer history and Model Insight from the ePASS catalogue
//     (lib/epass-catalogue-postgres.js): past calls at this customer /
//     address / serial, opened to complaint + work performed + parts + labor;
//     the exact model, its family and the brand's product type with the
//     parts that actually went in. A tech can flag a model to the service manager (a role, by job code), who
//     publishes it as a bulletin every tech on that family sees.
//   • the serial-tag photo, required on a new diagnostic unless we already
//     have one for that serial (photo on file, or the serial in the
//     catalogue / a closed ticket of ours). Never on an install.
//   • going back into a finished stop: add a note, or change the outcome
//     (same day, or while the ticket is still open in ePASS).
//   • delivered dollars as the day goes (doc 07 §5.6): what each finished
//     stop is worth (labor incl. the diag / zone fee + parts profit; warranty
//     = labor only), this week from the finished-ticket feed, the pace against
//     the tech's weekly quota (Service Commissions plan) or his 4-week average.
// ---------------------------------------------------------------------------

const { getReadyPool, getJobRow, updateJob, addHistory, mapJob } = boardInternals;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sj_field_findings (
  id BIGSERIAL PRIMARY KEY,
  sv_number TEXT NOT NULL,
  tech_code TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'diagnostic',
  outcome TEXT NOT NULL DEFAULT '',
  status_before TEXT NOT NULL DEFAULT '',
  status_after TEXT NOT NULL DEFAULT '',
  findings TEXT NOT NULL DEFAULT '',
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  labor_note TEXT NOT NULL DEFAULT '',
  minutes_on_site INTEGER,
  verified_at TIMESTAMPTZ,
  verified_by TEXT NOT NULL DEFAULT '',
  verified_parts JSONB,
  verify_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sj_field_findings_sv ON sj_field_findings (sv_number, id DESC);
ALTER TABLE sj_field_findings ADD COLUMN IF NOT EXISTS labor JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sj_field_findings ADD COLUMN IF NOT EXISTS est_minutes INTEGER;
ALTER TABLE sj_field_findings ADD COLUMN IF NOT EXISTS zone_band TEXT NOT NULL DEFAULT '';
ALTER TABLE sj_field_findings ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sj_field_findings ADD COLUMN IF NOT EXISTS amends BIGINT;
ALTER TABLE sj_field_findings ADD COLUMN IF NOT EXISTS entry TEXT NOT NULL DEFAULT 'outcome';
ALTER TABLE sj_field_findings ADD COLUMN IF NOT EXISTS dollars JSONB;
ALTER TABLE sj_field_findings ADD COLUMN IF NOT EXISTS verified_labor JSONB;
CREATE INDEX IF NOT EXISTS sj_field_findings_tech_day ON sj_field_findings (tech_code, created_at DESC);
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS field_enroute_at TIMESTAMPTZ;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS field_arrived_at TIMESTAMPTZ;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS field_done_at TIMESTAMPTZ;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS billed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS billed_amount NUMERIC(12,2);
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS billed_note TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS sj_field_photos (
  id BIGSERIAL PRIMARY KEY,
  sv_number TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'photo',
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes BYTEA NOT NULL,
  tech_code TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sj_field_photos_sv ON sj_field_photos (sv_number);
CREATE INDEX IF NOT EXISTS sj_field_photos_serial ON sj_field_photos (serial, kind);
CREATE TABLE IF NOT EXISTS sj_model_flags (
  id BIGSERIAL PRIMARY KEY,
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  model_family TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  sv_number TEXT NOT NULL DEFAULT '',
  tech_code TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  bulletin TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sj_model_flags_family ON sj_model_flags (model_family, status);
`;
let ensured = null;
async function pool() { const p = await getReadyPool(); if (!ensured) ensured = p.query(SCHEMA_SQL).catch((e) => { ensured = null; throw e; }); await ensured; return p; }

const TZ = "America/Chicago";
const dateStr = (d) => (d instanceof Date ? d.toLocaleDateString("en-CA") : d ? String(d).slice(0, 10) : "");
const localDay = (d = new Date()) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const up = (v) => String(v ?? "").trim().toUpperCase();
const INSTALL = new Set(["SO4PRE", "SO5", "SO6"]);
const isShop = (st) => /^SI/.test(String(st || ""));
const kindOf = (st) => (isShop(st) ? "shop_return" : INSTALL.has(String(st || "")) ? "install" : "diagnostic");
// Cayden's prototype (9/19 pm): "sometimes our techs bring appliances from a
// house while they are on the SO1 call for further eval in shop … the field
// tool needs an option the tech can select that they are bringing the
// appliance to the shop with them." Its own outcome (→ SI1), because the
// unit is now on the van and the office owes the customer a delivery back.
// A shop_return stop is that unit going back out on a route (status SI*).
export const OUTCOMES = {
  diagnostic: { onsite: "SO8", parts: "SO2", shop: "SI1", declined: "SO7", replace: "SO7", research: null, access: null },
  install: { complete: "SO8", moreparts: "SO2", partissue: "SO3", notfixed: "SO1", access: null },
  shop_return: { complete: "SO8", moreparts: "SO2", notfixed: "SO1", access: null }
};
// Labor modifiers from the rate book (doc 07 §5.1): hours at the shop rate.
export const LABOR_MODS = [["Difficult access", 0.5], ["Stacked / built-in access", 0.35], ["Additional tech", 0.5], ["Additional component", 0.5]];
// Symptom chips per product family (Cayden's SYMPTOMS), keyed off the ePASS
// product code prefix; the "Error code" chip asks for the code.
export const SYMPTOMS = {
  dishwasher: ["Standing water", "Won't start", "No heat / not drying", "Leaking", "Error code", "Noise", "Not cleaning"],
  refrigerator: ["Not cooling", "Freezer OK, fridge warm", "Ice maker", "Water leak", "Noise / fan", "Frost build-up", "Compressor not running"],
  washer: ["Won't drain", "Won't spin", "Won't fill", "Leaking", "Noise", "Error code", "Door won't lock"],
  dryer: ["No heat", "Won't start", "Noise", "Not tumbling", "Takes too long", "Error code"],
  range: ["No heat / bake", "Burner won't light", "Won't ignite", "Error code", "Door / hinge", "Temperature off"],
  icemaker: ["No ice", "Low production", "Water leak", "Noise", "Not cycling"],
  hvac: ["Not cooling", "Not heating", "Not turning on", "Short cycling", "Water / drain", "Noise", "Error code"],
  other: ["Won't start", "Noise", "Leaking", "Error code", "Intermittent"]
};
export const CAUSES = ["Failed component", "Clogged / blocked", "Wiring / connection", "Installation issue", "Customer use / education", "Cosmetic only", "Undetermined — needs research"];
export function familyOf(productCode, category = "") {
  const c = up(productCode) + " " + up(category);
  if (/^DW|DISH/.test(c)) return "dishwasher";
  if (/^(RE|REF|FRZ|FR)|REFRIG|FREEZ/.test(c)) return "refrigerator";
  if (/^(WA|WASH)/.test(c)) return "washer";
  if (/^(DR|DRY)/.test(c)) return "dryer";
  if (/^(RA|RANGE|OV|WO|CT|COOK)/.test(c)) return "range";
  if (/^(IM|ICE)/.test(c)) return "icemaker";
  if (/^(AC|HV|FUR|HP|HEAT)/.test(c)) return "hvac";
  return "other";
}
// Time the repair will take — sizes the return trip and prices the component
// line (Cayden: 30 min / 1 / 1.5 / 2 hr / half day / full day at $130/h).
export const TIME_PICKS = [
  { minutes: 30, label: "30 min", hours: 0.5 }, { minutes: 60, label: "1 hour", hours: 1 }, { minutes: 90, label: "1.5 hr", hours: 1.5 },
  { minutes: 120, label: "2 hr", hours: 2 }, { minutes: 180, label: "3 hr", hours: 3 }, { minutes: 240, label: "Half day", hours: 4 }, { minutes: 480, label: "Full day", hours: 8 }
];
const RETURN_TRIP = new Set(["parts", "moreparts", "partissue"]);

// ---- pricing helpers (Cayden's labor.py, doc 07 §5.1a/b) --------------------
const SHOP = [30.1852, -98.0031];
function milesBetween(a, b) {
  const R = 3958.8, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b[0] - a[0]), dLng = toR(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function zoneBand(miles, bands = [7, 26, 47]) { for (let i = 0; i < bands.length; i++) if (miles <= bands[i]) return i + 1; return bands.length + 1; }
function warrantyKind(job, settings) {
  if (!job?.is_warranty) return null;
  const brands = (settings["warranty.cod_brands"] || []).map((b) => String(b).toLowerCase());
  const hay = `${job.unit_brand || ""} ${job.unit_model || ""} ${job.payment_type || ""}`.toLowerCase();
  return brands.some((b) => b && hay.includes(b)) ? "cod" : "flat";
}
// Where the job is, in miles from the shop: its geocode, else its zone's
// distance, else the ZIP band override, else band 1.
async function jobBand(p, job, settings) {
  const bands = settings["labor.zone_bands_miles"] || [7, 26, 47];
  const zipOverride = (settings["labor.zone_band_by_zip"] || {})[String(job.zip || "").slice(0, 5)];
  let miles = null;
  if (job.lat != null && job.lng != null) miles = milesBetween(SHOP, [Number(job.lat), Number(job.lng)]);
  else if (job.zone_code) { const z = (await p.query(`SELECT km_from_shop FROM sj_zones WHERE zone_code = $1`, [job.zone_code])).rows[0]; if (z?.km_from_shop != null) miles = Number(z.km_from_shop) * 0.621371; }
  const band = zipOverride ? Number(zipOverride) : miles != null ? zoneBand(miles, bands) : 1;
  return { band, miles: miles == null ? null : Math.round(miles * 10) / 10, source: zipOverride ? "zip" : miles == null ? "default" : job.lat != null ? "geocode" : "zone" };
}
// The lines the tool adds by itself for a COD repair quote: ZNn (+ ZNADD per
// extra unit) and FREIGHT. A warranty ticket gets neither.
export async function autoLaborLines(sv, { settings = null } = {}) {
  const p = await pool(); const job = await getJobRow(p, up(sv)); if (!job) throw new Error("Job not found.");
  const S = settings || await getSettings();
  const wty = warrantyKind(job, S);
  const { band, miles, source } = await jobBand(p, job, S);
  const fees = S["labor.zone_fees"] || {}; const diag = S["labor.diag_fees"] || {};
  const lines = [];
  if (!wty) {
    const zc = `ZN${band}`; const book = await laborRateFor(zc, job.unit_brand).catch(() => null);
    lines.push({ kind: "zone", code: book?.code || zc, desc: `Service Zone ${band}${miles != null ? ` · ${miles} mi from the shop` : ""}`, amount: r2(book?.price ?? fees[zc] ?? 0), auto: true, locked: false });
    for (let i = 1; i < (Number(job.units) || 1); i++) lines.push({ kind: "zone", code: "ZNADD", desc: "Additional appliance", amount: r2(fees.ZNADD ?? 85), auto: true });
    lines.push({ kind: "freight", code: "FREIGHT", desc: "Shipping & handling (office sets this at verify)", amount: r2(S["parts.shipping_default"] ?? 20), auto: true, office: true });
  }
  return { lines, band, miles, bandSource: source, warranty: wty, diagFee: r2(diag[`DZ${band}`] ?? diag.DZ1 ?? 157), hourlyRate: Number(S["labor.hourly_rate"]) || 130, timePicks: TIME_PICKS,
    warrantyNote: wty === "flat" ? "Warranty — the manufacturer pays a flat rate on the claim; no zone fee, no freight, tax exempt. Add the component line so the office knows what to claim; the amount is the warranty admin's to set." : wty === "cod" ? "Warranty on a COD-paying brand — labor at our rate, no zone fee, no freight, tax exempt." : "" };
}
const LABOR_KINDS = new Set(["zone", "freight", "component", "manual", "diag"]);
const cleanLabor = (labor) => (Array.isArray(labor) ? labor : []).map((l) => ({
  kind: LABOR_KINDS.has(l?.kind) ? l.kind : "manual", code: up(l?.code).slice(0, 40), desc: String(l?.desc || "").trim().slice(0, 160),
  hours: l?.hours == null || l?.hours === "" ? null : Math.max(0, Math.min(24, Number(l.hours) || 0)), amount: r2(l?.amount), book: l?.book == null || l?.book === "" ? null : r2(l.book),
  auto: !!l?.auto, office: !!l?.office, edited: !!l?.edited
})).filter((l) => l.desc || l.code).slice(0, 20);

function mapStop(j) {
  const kind = kindOf(j.status);
  return {
    sv: j.sv_number, seq: j.stop_seq == null ? 0 : Number(j.stop_seq), status: j.status, kind, window: j.time_window || "",
    customer: j.customer_name || "", customerCode: j.customer_code || "", phone: j.phone || "", phoneAlt: j.phone_alt || "", email: j.email || "",
    address: [j.address1, j.address2].filter(Boolean).join(", "), address1: j.address1 || "", city: j.city || "", zip: String(j.zip || "").slice(0, 5), lat: j.lat, lng: j.lng,
    access: j.access_notes || "", unit: { category: j.unit_category || "", brand: j.unit_brand || "", model: j.unit_model || "", serial: j.unit_serial || "" },
    problem: j.problem_text || "", units: Number(j.units) || 1, minutes: j.est_minutes != null ? Number(j.est_minutes) : null,
    balance: Number(j.balance) || 0, paymentType: j.payment_type || "", warranty: !!j.is_warranty, note: j.dispatch_note || "", partsNote: j.parts_note || "", bin: j.bin_location || "", contactPref: j.contact_pref || "",
    family: familyOf(j.unit_category, j.unit_install_type), shopReturn: isShop(j.status),
    enrouteAt: j.field_enroute_at ? new Date(j.field_enroute_at).toISOString() : null, arrivedAt: j.field_arrived_at ? new Date(j.field_arrived_at).toISOString() : null, doneAt: j.field_done_at ? new Date(j.field_done_at).toISOString() : null,
    closed: !!j.closed_at
  };
}
const mapFinding = (f) => ({
  id: Number(f.id), sv: f.sv_number, tech: f.tech_code, kind: f.kind, entry: f.entry || "outcome", outcome: f.outcome, from: f.status_before, to: f.status_after, findings: f.findings, parts: f.parts || [], labor: f.labor || [], laborNote: f.labor_note, minutes: f.minutes_on_site, estMinutes: f.est_minutes, zoneBand: f.zone_band || "", photos: f.photos || [],
  dollars: f.dollars || null, amends: f.amends == null ? null : Number(f.amends), verifiedAt: f.verified_at ? new Date(f.verified_at).toISOString() : null, verifiedBy: f.verified_by, verifiedParts: f.verified_parts, verifiedLabor: f.verified_labor || null, verifyNote: f.verify_note, by: f.created_by, at: new Date(f.created_at).toISOString()
});

// The tech's day, in the board's stop order. Finished stops stay listed with
// their last outcome so the tech can go back in (add a note, change it).
export async function getFieldRoute({ tech, date }) {
  const p = await pool();
  const t = up(tech);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : localDay();
  const rows = (await p.query(
    `SELECT * FROM sj_jobs WHERE assigned_tech = $1 AND route_date = $2 AND NOT (in_feed = FALSE AND source = 'import' AND closed_at IS NOT NULL)
      ORDER BY stop_seq NULLS LAST, sv_number`, [t, d])).rows;
  const techRow = (await p.query(`SELECT sp_code, name, work_days FROM sj_techs WHERE sp_code = $1`, [t])).rows[0];
  const svs = rows.map((r) => r.sv_number);
  const findings = svs.length ? (await p.query(`SELECT DISTINCT ON (sv_number) * FROM sj_field_findings WHERE sv_number = ANY($1) AND entry = 'outcome' ORDER BY sv_number, id DESC`, [svs])).rows : [];
  const notes = svs.length ? (await p.query(`SELECT sv_number, COUNT(*)::int AS n FROM sj_field_findings WHERE sv_number = ANY($1) AND entry = 'note' GROUP BY sv_number`, [svs])).rows : [];
  const fBy = new Map(findings.map((f) => [f.sv_number, mapFinding(f)])); const nBy = new Map(notes.map((n) => [n.sv_number, n.n]));
  // "Parts on this truck for this job": the ticket's part lines from ePASS
  const lines = svs.length ? (await p.query(`SELECT sv_number, model, description, qty FROM sj_job_lines WHERE sv_number = ANY($1) ORDER BY sv_number, line_no`, [svs]).catch(() => ({ rows: [] }))).rows : [];
  const lBy = new Map(); for (const l of lines) { if (!lBy.has(l.sv_number)) lBy.set(l.sv_number, []); lBy.get(l.sv_number).push({ part: l.model || "", desc: l.description || "", qty: Number(l.qty) || 1 }); }
  const stops = rows.map((j) => ({ ...mapStop(j), parts: lBy.get(j.sv_number) || [], lastFinding: fBy.get(j.sv_number) || null, lastOutcome: fBy.get(j.sv_number)?.outcome || "", notes: nBy.get(j.sv_number) || 0 }));
  const dollars = await dayDollars({ tech: t, date: d }).catch((err) => ({ error: err.message }));
  return { tech: t, techName: techRow?.name || t, date: d, stops, dollars };
}

export async function markEnroute({ sv, by = "" }) {
  const p = await pool(); const code = up(sv);
  await p.query(`UPDATE sj_jobs SET field_enroute_at = NOW(), updated_at = NOW() WHERE sv_number = $1`, [code]);
  await addHistory(p, { sv: code, from: null, to: (await getJobRow(p, code))?.status || "", actorType: "tech", actorId: by, trigger: "field.enroute", note: "on my way" });
  return { ok: true, at: new Date().toISOString() };
}
export async function markArrived({ sv, by = "" }) {
  const p = await pool(); const code = up(sv);
  await p.query(`UPDATE sj_jobs SET field_arrived_at = NOW(), updated_at = NOW() WHERE sv_number = $1`, [code]);
  await addHistory(p, { sv: code, from: null, to: (await getJobRow(p, code))?.status || "", actorType: "tech", actorId: by, trigger: "field.arrived", note: "arrived" });
  return { ok: true, at: new Date().toISOString() };
}

const cleanParts = (parts) => (Array.isArray(parts) ? parts : []).map((l) => ({
  part: String(l?.part || "").trim().slice(0, 60), desc: String(l?.desc || "").trim().slice(0, 160), qty: Math.max(1, Math.min(99, Math.round(Number(l?.qty) || 1))),
  price: l?.price === "" || l?.price == null ? null : r2(l.price), cost: l?.cost === "" || l?.cost == null ? null : r2(l.cost), availability: String(l?.availability || "").trim().slice(0, 60)
})).filter((l) => l.part || l.desc).slice(0, 30);

// ---- serial tag photos -------------------------------------------------------
const normSerial = (s) => up(s).replace(/[^A-Z0-9]/g, "");
export async function savePhoto({ sv = "", serial = "", kind = "photo", contentType = "image/jpeg", buffer, tech = "", by = "" }) {
  if (!buffer?.length) throw new Error("Empty photo.");
  if (buffer.length > 6 * 1024 * 1024) throw new Error("That photo is over 6 MB — the page should have shrunk it; try again.");
  const p = await pool();
  const r = await p.query(`INSERT INTO sj_field_photos (sv_number, serial, kind, content_type, bytes, tech_code, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
    [up(sv), normSerial(serial), kind === "serial_tag" ? "serial_tag" : "photo", String(contentType || "image/jpeg").slice(0, 60), buffer, up(tech), String(by || "").slice(0, 120)]);
  return { id: Number(r.rows[0].id), kind, at: new Date(r.rows[0].created_at).toISOString() };
}
export async function getPhoto(id) {
  const p = await pool();
  const r = (await p.query(`SELECT id, sv_number, serial, kind, content_type, bytes, created_at FROM sj_field_photos WHERE id = $1`, [Number(id)])).rows[0];
  return r ? { id: Number(r.id), sv: r.sv_number, serial: r.serial, kind: r.kind, contentType: r.content_type, bytes: r.bytes, at: new Date(r.created_at).toISOString() } : null;
}
export async function listPhotos({ sv = "", serial = "" }) {
  const p = await pool(); const s = normSerial(serial);
  const r = await p.query(`SELECT id, sv_number, serial, kind, created_at FROM sj_field_photos WHERE ($1 <> '' AND sv_number = $1) OR ($2 <> '' AND serial = $2) ORDER BY id DESC LIMIT 40`, [up(sv), s]);
  return r.rows.map((x) => ({ id: Number(x.id), sv: x.sv_number, serial: x.serial, kind: x.kind, at: new Date(x.created_at).toISOString() }));
}
// Do we already have this appliance's serial tag? A photo on file for the
// serial (or this ticket), the serial in the ePASS catalogue, or a closed
// ticket of ours on it all count as "previously serviced".
export async function serialTagStatus(job) {
  const p = await pool(); const s = normSerial(job.unit_serial);
  const photo = (await p.query(`SELECT id FROM sj_field_photos WHERE kind = 'serial_tag' AND ((sv_number = $1) OR ($2 <> '' AND serial = $2)) ORDER BY id DESC LIMIT 1`, [job.sv_number, s])).rows[0];
  if (photo) return { onFile: true, why: "photo on file", photoId: Number(photo.id) };
  // "On file" means a PHOTO of this serial's tag (Cayden 9/24) — ePASS
  // history or an earlier ticket on the serial no longer counts.
  return { onFile: false, why: s ? "no serial tag photo on file" : "no serial on the ticket — photograph the tag", photoId: null };
}

// ---- what a stop is worth (doc 07 §5.6) -------------------------------------
// labor list (diag / zone / component lines) + parts profit at list; warranty
// counts labor only. Provisional until the finished-ticket feed reconciles it.
async function estimateForSv(p, sv) {
  const r = (await p.query(`SELECT summary, status FROM service_estimates WHERE UPPER(sv_number) = $1 ORDER BY (status = 'approved') DESC, created_at DESC LIMIT 1`, [sv]).catch(() => ({ rows: [] }))).rows[0];
  return r ? { labor: Number(r.summary?.laborTotal) || 0, parts: Number(r.summary?.partsTotal) || 0, status: r.status || "" } : null;
}
async function stopDollars(p, job, finding, S) {
  const margin = Number(S["pay.parts_margin_default"]) || 0.35;
  const wty = !!job.is_warranty;
  const partsProfit = (lines) => wty ? 0 : (lines || []).reduce((a, l) => { const price = Number(l.price) || 0; if (!price) return a; const cost = l.cost != null && l.cost !== "" ? Number(l.cost) : price * (1 - margin); return a + (price - cost) * (Number(l.qty) || 1); }, 0);
  const laborOf = (lines) => (lines || []).filter((l) => l.kind !== "freight").reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const out = { labor: 0, parts: 0, estimated: true, basis: "", pipeline: 0 };
  const o = finding.outcome;
  if (["onsite", "declined", "replace"].includes(o)) {
    const { band } = await jobBand(p, job, S); const diag = S["labor.diag_fees"] || {};
    out.labor = wty ? laborOf(finding.labor) : r2((Number(diag[`DZ${band}`]) || 157) + laborOf(finding.labor));
    out.parts = r2(partsProfit(finding.parts)); out.basis = wty ? "warranty labor" : `diag DZ${band}${finding.labor?.length ? " + labor lines" : ""}`;
  } else if (o === "complete") {
    const est = await estimateForSv(p, job.sv_number);
    if (est && (est.labor || est.parts)) { out.labor = r2(est.labor); out.parts = wty ? 0 : r2(est.parts * margin); out.basis = `estimate ${est.status || ""}`.trim(); }
    else {
      const prior = (await p.query(`SELECT parts, verified_parts, labor, verified_labor FROM sj_field_findings WHERE sv_number = $1 AND outcome IN ('parts','moreparts') ORDER BY id DESC LIMIT 1`, [job.sv_number])).rows[0];
      if (prior) { out.labor = r2(laborOf(prior.verified_labor || prior.labor)); out.parts = r2(partsProfit(prior.verified_parts || prior.parts)); out.basis = "tech's quote lines"; }
      else { out.labor = r2(laborOf(finding.labor)); out.parts = r2(partsProfit(finding.parts)); out.basis = finding.labor?.length ? "labor lines" : "no lines on file"; }
    }
  } else if (RETURN_TRIP.has(o)) {
    out.pipeline = r2(laborOf(finding.labor) + partsProfit(finding.parts)); out.basis = "quoted — counts when the install is done";
  }
  out.total = r2(out.labor + out.parts);
  return out;
}

// Today's stops with their dollars, this week from the finished feed, pace.
export async function dayDollars({ tech, date }) {
  const p = await pool(); const t = up(tech); const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : localDay();
  const S = await getSettings();
  const rows = (await p.query(
    `SELECT DISTINCT ON (f.sv_number) f.*, j.customer_name, j.is_warranty, j.status AS job_status FROM sj_field_findings f JOIN sj_jobs j ON j.sv_number = f.sv_number
      WHERE f.tech_code = $1 AND f.entry = 'outcome' AND (f.created_at AT TIME ZONE 'America/Chicago')::date = $2::date ORDER BY f.sv_number, f.id DESC`, [t, d])).rows;
  const stops = rows.map((f) => ({ sv: f.sv_number, customer: f.customer_name || "", outcome: f.outcome, warranty: !!f.is_warranty, ...(f.dollars || { labor: 0, parts: 0, total: 0, pipeline: 0, basis: "" }) }));
  const today = r2(stops.reduce((a, s) => a + (s.total || 0), 0)); const pipeline = r2(stops.reduce((a, s) => a + (s.pipeline || 0), 0));
  // the week, from finished tickets (same math as the Service Commissions board)
  let week = { start: d, end: d, n: null, finished: 0, tickets: 0 }; let quota = 0, quotaSource = "";
  try {
    const cs = await getServiceCompSettings(); const per = fiscalPeriodFor(d, cs);
    const w = per?.cal?.weeks?.find((x) => x.n === per.week);
    if (w) {
      week = { start: w.start, end: w.end, n: w.n, finished: 0, tickets: 0 };
      const mine = (await svTicketsBetween(p, w.start, w.end)).filter((x) => x.tech === t);
      const val = (x) => x.serviceType === "COD" ? x.labor + x.parts - x.partsCost : x.labor;
      week.finished = r2(mine.reduce((a, x) => a + val(x), 0)); week.tickets = mine.length;
      const finishedSvs = new Set(mine.map((x) => up(x.invoice)));
      // a stop already in the finished feed is not counted twice
      for (const s of stops) if (finishedSvs.has(up(s.sv))) { s.reconciled = true; }
      const plan = (await listServiceCompPlans(per.year)).find((x) => x.techCode === t && x.active);
      const qq = plan ? weeklyQuotaFor(plan, per.quarter) : 0;
      if (qq) { quota = qq; quotaSource = `Q${per.quarter} weekly quota`; }
      else {
        const back = new Date(w.start + "T12:00:00Z"); back.setUTCDate(back.getUTCDate() - 28);
        const prior = (await svTicketsBetween(p, back.toISOString().slice(0, 10), w.start)).filter((x) => x.tech === t && x.finishDate < w.start);
        quota = r2(prior.reduce((a, x) => a + val(x), 0) / 4); quotaSource = quota ? "your 4-week average" : "";
      }
    }
  } catch (err) { week.error = err.message; }
  const provisional = r2(stops.filter((s) => !s.reconciled).reduce((a, s) => a + (s.total || 0), 0));
  const weekToDate = r2(week.finished + provisional);
  const techRow = (await p.query(`SELECT work_days FROM sj_techs WHERE sp_code = $1`, [t])).rows[0];
  const workDays = String(techRow?.work_days || "Mon,Tue,Wed,Thu,Fri").split(",").map((x) => x.trim()).filter(Boolean);
  let elapsed = 0, total = 0;
  if (week.start) for (let x = new Date(week.start + "T12:00:00Z"); x.toISOString().slice(0, 10) <= week.end; x.setUTCDate(x.getUTCDate() + 1)) {
    const iso = x.toISOString().slice(0, 10); const dow = x.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    if (workDays.includes(dow)) { total++; if (iso <= d) elapsed++; }
  }
  const pace = elapsed ? r2((weekToDate / elapsed) * total) : 0;
  return { date: d, tech: t, today, pipeline, stops, week: { ...week, provisional, toDate: weekToDate, workDaysElapsed: elapsed, workDays: total }, pace, quota, quotaSource, pct: quota ? r2(weekToDate / quota) : null, pacePct: quota ? r2(pace / quota) : null };
}

// ---- outcomes -------------------------------------------------------------------
async function persistFinding(p, { job, kind, outcome, target, findings, parts, labor, laborNote, minutes, estMinutes, zoneBand: zb, photos, by, tech, amends, entry = "outcome", dollars = null }) {
  const ins = await p.query(
    `INSERT INTO sj_field_findings (sv_number, tech_code, kind, outcome, status_before, status_after, findings, parts, labor, labor_note, minutes_on_site, est_minutes, zone_band, photos, created_by, amends, entry, dollars)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18::jsonb) RETURNING id`,
    [job.sv_number, tech, kind, outcome, job.status || "", target || job.status || "", String(findings || "").slice(0, 4000), JSON.stringify(parts), JSON.stringify(labor), String(laborNote || "").slice(0, 1000), minutes, estMinutes, zb || "", JSON.stringify(photos || []), by, amends || null, entry, dollars ? JSON.stringify(dollars) : null]);
  return Number(ins.rows[0].id);
}

// The tech's outcome for a stop (or, with `amend`, a changed outcome for a
// stop he already finished today): findings, parts and labor lines recorded,
// the status moved (packet queued), the rules run, the return trip sized.
export async function submitOutcome({ sv, tech = "", outcome, findings = "", parts = [], labor = [], laborNote = "", minutes: estMinutesIn = null, photos = [], serialTagPhotoId = null, amend = false, by = "", byName = "" }) {
  const p = await pool(); const code = up(sv);
  const job = await getJobRow(p, code);
  if (!job) throw new Error("Job not found.");
  const S = await getSettings();
  // a changed outcome is judged against the visit it changes, not the status it left behind
  const last = amend ? (await p.query(`SELECT id, kind, created_at FROM sj_field_findings WHERE sv_number = $1 AND entry = 'outcome' ORDER BY id DESC LIMIT 1`, [code])).rows[0] : null;
  const kind = last?.kind && OUTCOMES[last.kind] ? last.kind : kindOf(job.status);
  const table = OUTCOMES[kind];
  if (!(outcome in table)) throw new Error(`Outcome must be one of ${Object.keys(table).join(", ")} for a ${kind.replace("_", " ")}.`);
  const target = table[outcome];
  const lines = cleanParts(parts); const laborLines = cleanLabor(labor);
  const estMinutes = estMinutesIn == null || estMinutesIn === "" ? null : Math.max(15, Math.min(600, Math.round(Number(estMinutesIn) || 0)));
  if (outcome === "parts" || outcome === "moreparts") {
    if (!lines.length) throw new Error("List at least one part for a parts quote.");
    if (!laborLines.some((l) => l.kind === "component" || l.kind === "manual")) throw new Error("Add the component labor line for the repair (pick it from the list or type your own).");
    if (!estMinutes) throw new Error("Pick how long the repair will take — it sizes the return trip.");
  }
  if (["research", "access", "declined", "replace", "partissue", "notfixed", "shop"].includes(outcome) && !String(findings || "").trim()) throw new Error("A note is required for this outcome.");
  // serial-tag photo on a new diagnostic (not on installs, not when we already have it)
  let serialTag = null;
  if (kind === "diagnostic" && outcome !== "access" && S["field.serial_tag_required"] !== false) {
    serialTag = await serialTagStatus(job);
    if (!serialTag.onFile && !serialTagPhotoId) throw new Error("Photograph the serial tag first — we have nothing on file for this appliance.");
  }
  if (serialTagPhotoId) await p.query(`UPDATE sj_field_photos SET sv_number = $2, serial = CASE WHEN serial = '' THEN $3 ELSE serial END, kind = 'serial_tag' WHERE id = $1`, [Number(serialTagPhotoId), code, normSerial(job.unit_serial)]);
  const photoIds = [...new Set([...(Array.isArray(photos) ? photos : []).map((x) => Number(x)).filter((x) => x > 0), ...(serialTagPhotoId ? [Number(serialTagPhotoId)] : [])])];
  if (photoIds.length) await p.query(`UPDATE sj_field_photos SET sv_number = $2 WHERE id = ANY($1) AND sv_number = ''`, [photoIds, code]);
  if (amend && last && job.closed_at && localDay(last.created_at) !== localDay()) throw new Error("This ticket is closed in ePASS and the visit was not today — add a note instead, or ask the office.");
  const minutes = job.field_arrived_at && !amend ? Math.max(1, Math.round((Date.now() - new Date(job.field_arrived_at).getTime()) / 60000)) : null;
  const { band } = await jobBand(p, job, S);
  const techCode = up(tech || job.assigned_tech || "");
  const draft = { outcome, labor: laborLines, parts: lines };
  const dollars = await stopDollars(p, job, draft, S).catch(() => null);
  const findingId = await persistFinding(p, { job, kind, outcome, target, findings, parts: lines, labor: laborLines, laborNote, minutes, estMinutes, zoneBand: `ZN${band}`, photos: photoIds, by, tech: techCode, amends: last?.id || null, dollars });
  const jobPatch = { field_done_at: new Date() };
  if (estMinutes && RETURN_TRIP.has(outcome)) { jobPatch.est_minutes = estMinutes; jobPatch.units = Math.max(1, Math.ceil(estMinutes / 60)); }
  await updateJob(p, code, jobPatch);
  let result = null;
  if (target && target !== job.status) {
    const note = `${amend ? "changed: " : ""}${outcome}: ${String(findings || "").slice(0, 160)}`.trim();
    result = await setJobStatus(code, { status: target, reasonCode: "tech_update", note, byEmail: by, byName });
    try { await runStatusRules(code, { from: job.status, byEmail: by }); } catch (err) { console.error("Field outcome rules failed:", err.message); }
  } else {
    await addHistory(p, { sv: code, from: job.status, to: job.status, actorType: "tech", actorId: by, trigger: amend ? "field.amend" : "field.note", note: `${outcome}: ${String(findings || "").slice(0, 300)}` });
  }
  return { ok: true, findingId, status: target || job.status, minutesOnSite: minutes, estMinutes, syncId: result?.syncId || null, dollars, amended: !!last };
}

// Going back in: a note on a stop already finished (any time), no status change.
export async function addFieldNote({ sv, tech = "", note = "", photos = [], by = "" }) {
  const p = await pool(); const code = up(sv);
  const job = await getJobRow(p, code); if (!job) throw new Error("Job not found.");
  if (!String(note || "").trim() && !(Array.isArray(photos) && photos.length)) throw new Error("Write the note first.");
  const photoIds = (Array.isArray(photos) ? photos : []).map((x) => Number(x)).filter((x) => x > 0);
  if (photoIds.length) await p.query(`UPDATE sj_field_photos SET sv_number = $2 WHERE id = ANY($1) AND sv_number = ''`, [photoIds, code]);
  const last = (await p.query(`SELECT id, kind FROM sj_field_findings WHERE sv_number = $1 AND entry = 'outcome' ORDER BY id DESC LIMIT 1`, [code])).rows[0];
  const id = await persistFinding(p, { job, kind: last?.kind || kindOf(job.status), outcome: "note", target: job.status, findings: note, parts: [], labor: [], laborNote: "", minutes: null, estMinutes: null, zoneBand: "", photos: photoIds, by, tech: up(tech || job.assigned_tech), amends: last?.id || null, entry: "note" });
  await addHistory(p, { sv: code, from: job.status, to: job.status, actorType: "tech", actorId: by, trigger: "field.note", note: `note: ${String(note || "").slice(0, 300)}${photoIds.length ? ` (+${photoIds.length} photo${photoIds.length === 1 ? "" : "s"})` : ""}` });
  return { ok: true, findingId: id };
}

// Everything the tech reads before he knocks: this ticket's own findings and
// photos, the customer's past calls (catalogue + our own closed tickets), Model
// Insight, published bulletins for the family, the serial-tag status, the
// auto labor lines and pricing constants.
export async function stopContext(sv) {
  const p = await pool(); const code = up(sv);
  const job = await getJobRow(p, code); if (!job) throw new Error("Job not found.");
  const [findings, photos, history, insight, serialTag, labor] = await Promise.all([
    getFindingsForSv(code), listPhotos({ sv: code, serial: job.unit_serial }),
    customerHistory({ customerCode: job.customer_code, phone: job.phone, address1: job.address1, zip: job.zip, serial: job.unit_serial, exclude: code, limit: 30 }).catch((err) => ({ calls: [], error: err.message })),
    modelInsight({ brand: job.unit_brand, model: job.unit_model, productCode: job.unit_category }).catch((err) => ({ tiers: [], error: err.message })),
    serialTagStatus(job), autoLaborLines(code)
  ]);
  // our own closed tickets on this customer / serial that ePASS may not have finished yet
  const ours = (await p.query(
    `SELECT j.sv_number, j.status, j.closed_at, j.status_changed_at, j.unit_brand, j.unit_category, j.unit_model, j.unit_serial, j.problem_text, j.customer_name, j.assigned_tech, j.owner_tech, f.findings, f.outcome, f.parts, f.labor, f.created_at AS found_at, f.tech_code
       FROM sj_jobs j LEFT JOIN LATERAL (SELECT * FROM sj_field_findings x WHERE x.sv_number = j.sv_number AND x.entry = 'outcome' ORDER BY x.id DESC LIMIT 1) f ON TRUE
      WHERE j.sv_number <> $1 AND ((j.customer_code <> '' AND j.customer_code = $2) OR ($3 <> '' AND j.unit_serial = $3) OR (j.phone <> '' AND j.phone = $4))
      ORDER BY COALESCE(j.closed_at, j.status_changed_at) DESC LIMIT 15`, [code, job.customer_code || "", job.unit_serial || "", job.phone || ""])).rows;
  const catalogued = new Set((history.calls || []).map((c) => c.sv));
  const recent = ours.filter((r) => !catalogued.has(r.sv_number)).map((r) => ({
    sv: r.sv_number, status: r.status, finished: r.closed_at ? dateStr(r.closed_at) : "", created: dateStr(r.status_changed_at), tech: r.tech_code || r.owner_tech || r.assigned_tech || "", customer: r.customer_name || "",
    unit: [r.unit_brand, r.unit_category, r.unit_model].filter(Boolean).join(" "), serial: r.unit_serial || "", sameUnit: !!(job.unit_serial && r.unit_serial === job.unit_serial), complaint: r.problem_text || "", performed: r.findings || "", outcome: r.outcome || "",
    partsLines: (r.parts || []).map((l) => ({ part: l.part, desc: l.desc, qty: l.qty, price: l.price })), laborLines: (r.labor || []).map((l) => ({ code: l.code, desc: l.desc, total: l.amount })), source: "agility", open: !r.closed_at, why: job.unit_serial && r.unit_serial === job.unit_serial ? "same unit" : "same customer"
  }));
  const bulletins = await bulletinsFor({ brand: job.unit_brand, model: job.unit_model, productCode: job.unit_category });
  return { sv: code, status: job.status, laborMods: LABOR_MODS, symptoms: SYMPTOMS[familyOf(job.unit_category, job.unit_install_type)] || SYMPTOMS.other, causes: CAUSES, findings, photos, history: { calls: [...recent.filter((r) => r.sameUnit), ...(history.calls || []), ...recent.filter((r) => !r.sameUnit)], serialSeen: !!history.serialSeen || recent.some((r) => r.sameUnit), error: history.error || "" }, insight, bulletins, serialTag, ...labor };
}

// ---- model flags → service manager role → bulletins -------------------------------------------
export async function flagModel({ sv = "", brand = "", model = "", productCode = "", why = "", tech = "", by = "" }) {
  const p = await pool();
  if (!String(why || "").trim()) throw new Error("Say why — a flag with no reason is noise.");
  const { modelFamily } = await import("./epass-catalogue-postgres.js");
  const fam = modelFamily(brand, productCode, model);
  const r = await p.query(`INSERT INTO sj_model_flags (brand, model, model_family, product_code, sv_number, tech_code, why, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
    [up(brand), up(model), fam, up(productCode), up(sv), up(tech), String(why).trim().slice(0, 2000), String(by || "").slice(0, 120)]);
  return { id: Number(r.rows[0].id), family: fam, at: new Date(r.rows[0].created_at).toISOString() };
}
const mapFlag = (f) => ({ id: Number(f.id), brand: f.brand, model: f.model, family: f.model_family, familyStem: String(f.model_family || "").split("|")[2] || "", productCode: f.product_code, sv: f.sv_number, tech: f.tech_code, techName: f.tech_name || "", why: f.why, status: f.status, bulletin: f.bulletin, reviewedBy: f.reviewed_by, reviewedAt: f.reviewed_at ? new Date(f.reviewed_at).toISOString() : null, by: f.created_by, at: new Date(f.created_at).toISOString() });
export async function listModelFlags({ status = "" } = {}) {
  const p = await pool();
  const r = await p.query(`SELECT f.*, t.name AS tech_name FROM sj_model_flags f LEFT JOIN sj_techs t ON t.sp_code = f.tech_code WHERE ($1 = '' OR f.status = $1) ORDER BY (f.status = 'pending') DESC, f.created_at DESC LIMIT 200`, [String(status || "")]);
  return r.rows.map(mapFlag);
}
export async function reviewModelFlag({ id, action, bulletin = "", by = "" }) {
  const p = await pool();
  const st = action === "publish" ? "published" : action === "retire" ? "retired" : action === "dismiss" ? "dismissed" : null;
  if (!st) throw new Error("Action must be publish, retire or dismiss.");
  const r = await p.query(`UPDATE sj_model_flags SET status = $2, bulletin = CASE WHEN $3 <> '' THEN $3 ELSE bulletin END, reviewed_by = $4, reviewed_at = NOW() WHERE id = $1 RETURNING *`, [Number(id), st, String(bulletin || "").trim().slice(0, 4000), String(by || "").slice(0, 120)]);
  if (!r.rows[0]) throw new Error("Flag not found.");
  return mapFlag(r.rows[0]);
}
export async function bulletinsFor({ brand = "", model = "", productCode = "" }) {
  const p = await pool();
  const { modelFamily } = await import("./epass-catalogue-postgres.js");
  const fam = modelFamily(brand, productCode, model); const b = up(brand), pc = up(productCode);
  const r = await p.query(`SELECT f.*, t.name AS tech_name FROM sj_model_flags f LEFT JOIN sj_techs t ON t.sp_code = f.tech_code WHERE f.status = 'published' AND (($1 <> '' AND f.model_family = $1) OR ($2 <> '' AND $3 <> '' AND f.brand = $2 AND f.product_code = $3 AND f.model_family = '')) ORDER BY f.reviewed_at DESC LIMIT 10`, [fam, b, pc]);
  return r.rows.map(mapFlag);
}

// ---- Parts Verify (office) --------------------------------------------------
export async function listVerifyQueue() {
  const p = await pool();
  const rows = (await p.query(
    `SELECT j.sv_number, j.status, j.status_changed_at, j.customer_name, j.phone, j.address1, j.city, j.zip, j.unit_brand, j.unit_category, j.unit_model, j.unit_serial, j.problem_text, j.is_warranty, j.owner_tech, j.assigned_tech, j.est_minutes,
            t.name AS tech_name, f.id AS finding_id, f.outcome, f.findings, f.parts, f.labor, f.labor_note, f.minutes_on_site, f.est_minutes AS f_est_minutes, f.zone_band, f.photos, f.created_at AS found_at, f.tech_code
       FROM sj_jobs j
       LEFT JOIN LATERAL (SELECT * FROM sj_field_findings x WHERE x.sv_number = j.sv_number AND x.entry = 'outcome' ORDER BY x.id DESC LIMIT 1) f ON TRUE
       LEFT JOIN sj_techs t ON t.sp_code = COALESCE(NULLIF(f.tech_code, ''), j.owner_tech, j.assigned_tech)
      WHERE j.closed_at IS NULL AND j.status IN ('SO2') AND NOT (j.in_feed = FALSE AND j.source = 'import')
      ORDER BY j.status_changed_at, j.sv_number`)).rows;
  return rows.map((r) => ({
    sv: r.sv_number, st: r.status, since: r.status_changed_at ? new Date(r.status_changed_at).toISOString() : null,
    cust: r.customer_name || "", phone: r.phone || "", addr: [r.address1, r.city].filter(Boolean).join(", "), zip: String(r.zip || "").slice(0, 5),
    unit: [r.unit_brand, r.unit_category, r.unit_model].filter(Boolean).join(" "), serial: r.unit_serial || "", problem: r.problem_text || "", wty: !!r.is_warranty,
    tech: r.tech_code || r.owner_tech || r.assigned_tech || "", techName: r.tech_name || "", estMinutes: r.f_est_minutes ?? r.est_minutes ?? null,
    finding: r.finding_id ? { id: Number(r.finding_id), outcome: r.outcome, findings: r.findings || "", parts: Array.isArray(r.parts) ? r.parts : [], labor: Array.isArray(r.labor) ? r.labor : [], laborNote: r.labor_note || "", minutes: r.minutes_on_site, zoneBand: r.zone_band || "", photos: r.photos || [], at: r.found_at ? new Date(r.found_at).toISOString() : null } : null
  }));
}

// The parts buyer's verification: prices / availability on the part lines, the labor
// lines (freight is hers to set), the ticket → SO2.1 (packet queued).
// Parts availability options (Andrew 9/24: buttons, not free text). Each one
// maps to the estimate's ETA mode and to the board's parts ETA.
export const AVAILABILITY = [
  { key: "stock", label: "In stock", eta: "stock", arriveBd: 1 },
  { key: "d3", label: "1–3 days", eta: "stock", arriveBd: 3 },
  { key: "d5", label: "3–5 days", eta: "date", arriveBd: 5, fromBd: 6, toBd: 9 },
  { key: "w2", label: "1–2 weeks", eta: "date", arriveBd: 10, fromBd: 8, toBd: 13 },
  { key: "w3", label: "2+ weeks", eta: "date", arriveBd: 15, fromBd: 13, toBd: 18 },
  { key: "backorder", label: "Backordered — no date", eta: "backorder", arriveBd: null }
];
const availabilityOf = (v) => AVAILABILITY.find((a) => a.key === String(v || "").trim()) || AVAILABILITY.find((a) => a.label.toLowerCase() === String(v || "").trim().toLowerCase()) || null;
// The ticket's ETA is its slowest line.
function etaFromLines(lines, technician = "") {
  const picks = lines.map((l) => availabilityOf(l.availability)).filter(Boolean);
  const worst = picks.sort((a, b) => AVAILABILITY.indexOf(b) - AVAILABILITY.indexOf(a))[0] || AVAILABILITY[0];
  const today = centralDateOf(new Date());
  const eta = worst.eta === "date"
    ? normalizeEta({ mode: "date", from: addBusinessDays(today, worst.fromBd), to: addBusinessDays(today, worst.toBd) }, { technician })
    : normalizeEta({ mode: worst.eta }, { technician });
  return { eta, partsEta: worst.arriveBd == null ? null : addBusinessDays(today, worst.arriveBd), availability: worst.key };
}

export async function verifyParts({ sv, lines = [], labor = null, note = "", by = "", byName = "" }) {
  const p = await pool(); const code = up(sv);
  const job = await getJobRow(p, code);
  if (!job) throw new Error("Job not found.");
  // The board is the source of truth for the journey (Andrew 9/24) — this is
  // not cross-checked against ePASS's status, which stays SO1 until an
  // estimate is approved. Only a closed card can't be verified.
  if (job.closed_at) throw new Error(`${code} is closed (${job.status}).`);
  const clean = cleanParts(lines);
  if (!clean.length) throw new Error("Keep at least one part line.");
  const cleanL = labor == null ? null : cleanLabor(labor);
  const f = (await p.query(`SELECT id FROM sj_field_findings WHERE sv_number = $1 AND entry = 'outcome' ORDER BY id DESC LIMIT 1`, [code])).rows[0];
  if (f) await p.query(`UPDATE sj_field_findings SET verified_at = NOW(), verified_by = $2, verified_parts = $3::jsonb, verified_labor = $5::jsonb, verify_note = $4 WHERE id = $1`, [f.id, by, JSON.stringify(clean), String(note || "").slice(0, 1000), cleanL ? JSON.stringify(cleanL) : null]);
  else await p.query(`INSERT INTO sj_field_findings (sv_number, tech_code, kind, outcome, status_before, status_after, parts, verified_at, verified_by, verified_parts, verified_labor, verify_note, created_by) VALUES ($1,$2,'diagnostic','parts','SO2','SO2.1',$3::jsonb,NOW(),$4,$3::jsonb,$6::jsonb,$5,$4)`, [code, job.owner_tech || job.assigned_tech || "", JSON.stringify(clean), by, String(note || "").slice(0, 1000), cleanL ? JSON.stringify(cleanL) : null]);
  const total = clean.reduce((a, l) => a + (l.price || 0) * l.qty, 0);
  const laborTotal = (cleanL || []).reduce((a, l) => a + (l.amount || 0), 0);
  const r = await setJobStatus(code, { status: "SO2.1", reasonCode: "parts_verified", note: `${clean.length} part line${clean.length === 1 ? "" : "s"} verified${total ? ` · parts ${total.toFixed(2)}` : ""}${laborTotal ? ` · labor ${laborTotal.toFixed(2)}` : ""}${note ? " · " + String(note).slice(0, 120) : ""}`, byEmail: by, byName });
  // Availability → the board's parts ETA and the estimate's "what happens next".
  const techs = await p.query(`SELECT sp_code, name FROM sj_techs`).catch(() => ({ rows: [] }));
  const techName = techs.rows.find((t) => t.sp_code === (job.owner_tech || job.assigned_tech))?.name || "";
  const { eta, partsEta, availability } = etaFromLines(clean, techName);
  if (partsEta) await p.query(`UPDATE sj_jobs SET parts_eta = $2, updated_at = NOW() WHERE sv_number = $1`, [code, partsEta]).catch(() => {});
  // Straight into Service Estimates, prefilled (Andrew 9/24: one click to send
  // for the office; warranty skips the customer and lands as approved).
  let estimate = null;
  try { estimate = await estimateFromVerify({ job, parts: clean, labor: cleanL || [], eta, note, by, byName }); }
  catch (err) { console.error("Verify → estimate failed:", err.message); }
  return { ok: true, status: "SO2.1", lines: clean, labor: cleanL, partsTotal: r2(total), laborTotal: r2(laborTotal), syncId: r.syncId, availability, partsEta, estimate: estimate ? { token: estimate.token, status: estimate.status, warranty: !!job.is_warranty } : null };
}

// Build the estimate summary the estimates page expects (the shape the PDF
// scanner produces), from the verified parts and the tech's labor lines.
async function estimateFromVerify({ job, parts, labor, eta, note = "", by = "", byName = "" }) {
  const settings = await getSettings().catch(() => ({}));
  const taxRate = Number(settings["tax.rate"] ?? 0.0825) || 0;
  const partLines = parts.map((l) => ({ qty: l.qty, model: l.part, description: l.desc, ext: l.price == null ? null : r2(l.price * l.qty) }));
  const freight = labor.filter((l) => l.kind === "freight");
  const laborLines = labor.filter((l) => l.kind !== "freight");
  const partsTotal = r2(partLines.reduce((a, l) => a + (l.ext || 0), 0));
  const laborTotal = r2(laborLines.reduce((a, l) => a + (Number(l.amount) || 0), 0));
  const shippingTotal = r2(freight.reduce((a, l) => a + (Number(l.amount) || 0), 0));
  const subTotal = r2(partsTotal + laborTotal + shippingTotal);
  const tax = r2(subTotal * taxRate);
  const warnings = [];
  if (partLines.some((l) => l.ext == null)) warnings.push("A part line has no price yet — set it before sending.");
  warnings.push(`Tax estimated at ${(taxRate * 100).toFixed(2)}% on parts, labor and freight — match it to ePASS if it differs.`);
  const summary = {
    format: "agility", source: "parts-verify", svNumber: job.sv_number, date: centralDateOf(new Date()),
    customerName: job.customer_name || "", customerNumber: job.customer_code || "", phone: job.phone || "", contactPref: job.contact_pref || "",
    brand: job.unit_brand || "", model: job.unit_model || "", serial: job.unit_serial || "", unit: [job.unit_brand, job.unit_category, job.unit_model].filter(Boolean).join(" "),
    technician: eta.technician || "", complaint: job.problem_text || "",
    parts: partLines, laborLines: laborLines.map((l) => ({ code: l.code || "", description: l.desc || l.code || "Labor", ext: r2(l.amount) })), laborTotal, laborEntries: laborLines.length,
    shippingTotal, refrigerant: [], refrigerantTotal: 0, partsTotal, subTotal, tax, invoiceTotal: r2(subTotal + tax), deposits: null, balance: null,
    warranty: !!job.is_warranty, verifyNote: String(note || "").slice(0, 300), warnings,
    eta, etaMessage: etaMessage(eta)
  };
  summary.partsQuality = assessPartsQuality(summary);
  const pref = String(job.contact_pref || "").toLowerCase();
  const contactPref = /text/.test(pref) ? "text" : /email/.test(pref) ? "email" : /call|phone/.test(pref) ? "call" : "";
  const est = await createServiceEstimate({
    svNumber: job.sv_number, estimateName: [job.unit_brand, job.unit_category].filter(Boolean).join(" ") || "Repair estimate",
    customerName: job.customer_name || "", customerNumber: job.customer_code || "", contactPhone: job.phone || "", contactEmail: job.email || "", contactPref,
    summary, byEmail: by, byName
  });
  if (job.is_warranty) {
    // Warranty: nobody has to approve — it lands in the approved list so the
    // office builds the ePASS ticket to match and orders the parts (SO3).
    const p = await pool();
    await p.query(`UPDATE service_estimates SET status = 'approved', response = COALESCE(response, '{}'::jsonb) || $2::jsonb, responded_at = NOW(), viewed_at = NOW(), closed_at = NULL WHERE token = $1`,
      [est.token, JSON.stringify({ resolvedByStaff: true, staffEmail: by, staffName: byName, staffNotes: "Warranty repair — no customer approval needed; make the ePASS ticket match and order parts (SO3).", resolvedAt: new Date().toISOString(), warranty: true })]).catch((err) => console.error("Warranty estimate auto-approve failed:", err.message));
    est.status = "approved";
  }
  return est;
}

export async function getFindingsForSv(sv) {
  const p = await pool();
  return (await p.query(`SELECT * FROM sj_field_findings WHERE sv_number = $1 ORDER BY id DESC LIMIT 30`, [up(sv)])).rows.map(mapFinding);
}
export { mapJob, callDetail, tidy };

// ---------------------------------------------------------------------------
// Ready to bill (Andrew 9/24): every call the tech finished in the field —
// declined (SO7), fixed on the spot (SO8, no parts) or the install done
// (SO8, with parts) — waits here until an office admin charges the card on
// file and makes the ePASS ticket match and finishes it. Nothing is charged
// by this code; it prepares the amount and records the admin's decision.
// ---------------------------------------------------------------------------
const BILL_OUTCOMES = ["onsite", "declined", "replace", "complete"];
async function billFor(p, job, finding, S) {
  const taxRate = Number(S["tax.rate"] ?? 0.0825) || 0;
  const wty = !!job.is_warranty;
  const laborOf = (lines) => (lines || []).filter((l) => l.kind !== "freight").map((l) => ({ code: l.code || "", desc: l.desc || l.code || "Labor", amount: r2(l.amount) }));
  const freightOf = (lines) => r2((lines || []).filter((l) => l.kind === "freight").reduce((a, l) => a + (Number(l.amount) || 0), 0));
  const partsOf = (lines) => (lines || []).filter((l) => l.part || l.desc).map((l) => ({ part: l.part || "", desc: l.desc || "", qty: Number(l.qty) || 1, price: l.price == null ? null : r2(l.price), ext: l.price == null ? null : r2(l.price * (Number(l.qty) || 1)) }));
  const o = finding.outcome;
  let labor = [], parts = [], freight = 0, basis = "";
  if (["onsite", "declined", "replace"].includes(o)) {
    labor = laborOf(finding.labor);
    if (!wty) { const { band } = await jobBand(p, job, S); const diag = S["labor.diag_fees"] || {}; if (!labor.some((l) => /^DZ/.test(l.code))) labor.unshift({ code: `DZ${band}`, desc: `Diagnostic — zone ${band}`, amount: r2(Number(diag[`DZ${band}`]) || 157) }); }
    parts = partsOf(finding.parts); freight = freightOf(finding.labor);
    basis = o === "declined" ? "repair declined — diagnostic" : o === "replace" ? "unit to be replaced — diagnostic" : "fixed on the spot";
  } else {
    // the install: the approved estimate is the bill; else the verified quote lines; else the tech's lines
    const est = (await p.query(`SELECT summary, status FROM service_estimates WHERE UPPER(sv_number) = $1 ORDER BY (status = 'approved') DESC, created_at DESC LIMIT 1`, [job.sv_number]).catch(() => ({ rows: [] }))).rows[0];
    if (est?.summary && (est.summary.parts?.length || est.summary.laborLines?.length || est.summary.laborTotal)) {
      const sm = est.summary;
      parts = (sm.parts || []).map((l) => ({ part: l.model || "", desc: l.description || "", qty: Number(l.qty) || 1, price: l.ext == null ? null : r2(l.ext / (Number(l.qty) || 1)), ext: l.ext == null ? null : r2(l.ext) }));
      labor = (sm.laborLines || []).length ? sm.laborLines.map((l) => ({ code: l.code || "", desc: l.description || "Labor", amount: r2(l.ext) })) : (sm.laborTotal ? [{ code: "", desc: "Labor", amount: r2(sm.laborTotal) }] : []);
      freight = r2(sm.shippingTotal || 0); basis = `estimate ${est.status || ""}`.trim();
    } else {
      const prior = (await p.query(`SELECT parts, verified_parts, labor, verified_labor FROM sj_field_findings WHERE sv_number = $1 AND outcome IN ('parts','moreparts') ORDER BY id DESC LIMIT 1`, [job.sv_number])).rows[0];
      const src = prior ? { parts: prior.verified_parts || prior.parts, labor: prior.verified_labor || prior.labor } : finding;
      parts = partsOf(src.parts); labor = laborOf(src.labor); freight = freightOf(src.labor); basis = prior ? "verified quote lines" : "tech's lines";
    }
    // anything the tech added on the install visit (extra labor)
    for (const l of laborOf(finding.labor)) if (!labor.some((x) => x.code && x.code === l.code)) labor.push(l);
  }
  if (wty) { labor = labor.filter((l) => !/^(ZN|DZ)/.test(l.code)); freight = 0; }
  const laborTotal = r2(labor.reduce((a, l) => a + l.amount, 0));
  const partsTotal = r2(parts.reduce((a, l) => a + (l.ext || 0), 0));
  const subTotal = r2(laborTotal + partsTotal + freight);
  const tax = wty ? 0 : r2(subTotal * taxRate);
  return { basis, warranty: wty, labor, parts, freight, laborTotal, partsTotal, subTotal, tax, total: r2(subTotal + tax), unpriced: parts.some((l) => l.ext == null) };
}
export async function listReadyToBill() {
  const p = await pool(); const S = await getSettings().catch(() => ({}));
  const rows = (await p.query(
    `SELECT j.*, f.id AS finding_id, f.outcome AS f_outcome, f.findings AS f_findings, f.labor AS f_labor, f.parts AS f_parts, f.tech_code AS f_tech, f.created_at AS f_at, f.minutes_on_site AS f_minutes,
            (SELECT name FROM sj_techs t WHERE t.sp_code = f.tech_code) AS f_tech_name
       FROM sj_jobs j
       JOIN LATERAL (SELECT * FROM sj_field_findings x WHERE x.sv_number = j.sv_number AND x.entry = 'outcome' ORDER BY x.id DESC LIMIT 1) f ON TRUE
      WHERE j.billed_at IS NULL AND j.status IN ('SO7','SO8') AND f.outcome = ANY($1)
      ORDER BY f.created_at DESC LIMIT 200`, [BILL_OUTCOMES])).rows;
  const out = [];
  for (const r of rows) {
    const finding = { outcome: r.f_outcome, findings: r.f_findings, labor: r.f_labor || [], parts: r.f_parts || [] };
    const bill = await billFor(p, r, finding, S);
    out.push({ sv: r.sv_number, cust: r.customer_name, phone: r.phone, email: r.email, addr: [r.address1, r.city].filter(Boolean).join(", "), zip: r.zip, unit: [r.unit_brand, r.unit_category, r.unit_model].filter(Boolean).join(" "), st: r.status, epassSt: r.epass_status || "", wty: !!r.is_warranty, paymentType: r.payment_type || "",
      outcome: r.f_outcome, findings: r.f_findings || "", tech: r.f_tech, techName: r.f_tech_name || r.f_tech, doneAt: new Date(r.f_at).toISOString(), minutes: r.f_minutes, customerCode: r.customer_code || "", source: r.source || "", bill });
  }
  return out;
}
export async function markBilled({ sv, amount = null, note = "", by = "", byName = "" }) {
  const p = await pool(); const code = up(sv);
  const job = await getJobRow(p, code);
  if (!job) throw new Error("Job not found.");
  if (job.billed_at) throw new Error(`${code} was already marked billed ${new Date(job.billed_at).toLocaleDateString("en-US")}.`);
  const amt = amount == null || amount === "" ? null : r2(amount);
  await p.query(`UPDATE sj_jobs SET billed_at = NOW(), billed_by = $2, billed_amount = $3, billed_note = $4, closed_at = COALESCE(closed_at, NOW()), updated_at = NOW() WHERE sv_number = $1`, [code, String(by || "").slice(0, 120), amt, String(note || "").slice(0, 400)]);
  await addHistory(p, { sv: code, from: job.status, to: job.status, actorType: "user", actorId: by || "office", trigger: "billing.done", note: `billed${amt != null ? ` $${amt.toFixed(2)}` : ""} · ePASS ticket matched and finished${note ? " · " + String(note).slice(0, 200) : ""}` });
  return { ok: true, sv: code, amount: amt };
}

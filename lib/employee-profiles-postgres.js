import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Employee Profiles (HR) — Andrew 11/15. Everything HR keeps about a person
// beyond the directory row that User Admin owns:
//
//   employee_profile_details      who they report to, employment type, phones,
//                                 emergency contact, the regular working
//                                 schedule, an HR note
//   employee_documents            uploaded HR documents (bytes in Postgres,
//                                 like every other upload in Agility)
//   employee_counseling_records   performance counseling, behind its OWN
//                                 permission - see the rules below
//   pto_requests                  time-off requests: asked -> approved by the
//                                 manager -> entered in Kronos by HR
//   pto_requests_archive          the same requests once their last day out is
//                                 more than a year past (moved, never deleted)
//
// Rows key on employee_directory.code. Nothing here is ever deleted when a
// person is archived: EEOC recordkeeping wants personnel records kept at least
// a year past termination and through any charge, so removal is always a
// soft mark with who and why.
//
// Counseling records, by design:
//   - never edited after they are written. A correction is an ADDENDUM with
//     its own author and time, so the record reads as it was made;
//   - never deleted. A record entered in error is VOIDED with a reason and
//     stays visible, struck through;
//   - never mixed with medical information. The ADA wants medical records in
//     separate confidential files, so this module has no medical category and
//     the pages say so.
// Standing rule, unchanged: no SSNs or driver's license numbers anywhere.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS employee_profile_details (
  code TEXT PRIMARY KEY,
  reports_to_code TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT '',
  work_phone TEXT NOT NULL DEFAULT '',
  mobile_phone TEXT NOT NULL DEFAULT '',
  emergency_name TEXT NOT NULL DEFAULT '',
  emergency_phone TEXT NOT NULL DEFAULT '',
  emergency_relation TEXT NOT NULL DEFAULT '',
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  schedule_note TEXT NOT NULL DEFAULT '',
  hr_note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_email TEXT NOT NULL DEFAULT '',
  updated_by_name TEXT NOT NULL DEFAULT ''
);

-- Where reports_to_code came from (Org Chart, 11/16): '' = it follows the
-- Org Chart; 'override' = HR set it by hand and it stays until put back to
-- automatic; 'pick' = HR chose between several holders of the boss's job
-- code, kept only while that seat is still shared.
ALTER TABLE employee_profile_details ADD COLUMN IF NOT EXISTS reports_to_mode TEXT NOT NULL DEFAULT '';

-- The default working schedule for a JOB CODE (Andrew 11/16). Everyone
-- holding the code follows it until their supervisor or an executive gives
-- them a schedule of their own (a non-empty employee_profile_details.schedule).
CREATE TABLE IF NOT EXISTS job_code_schedules (
  job_code TEXT PRIMARY KEY,
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  title TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size INT NOT NULL DEFAULT 0,
  bytes BYTEA NOT NULL,
  counseling_id UUID,
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  removed_by_email TEXT NOT NULL DEFAULT '',
  removed_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_employee_documents_code ON employee_documents (employee_code, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS employee_counseling_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL,
  occurred_on DATE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Coaching conversation',
  summary TEXT NOT NULL,
  expectations TEXT NOT NULL DEFAULT '',
  issued_by TEXT NOT NULL DEFAULT '',
  acknowledgment TEXT NOT NULL DEFAULT '',
  follow_up_on DATE,
  follow_up_done_at TIMESTAMPTZ,
  follow_up_done_by TEXT NOT NULL DEFAULT '',
  addenda JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  voided_at TIMESTAMPTZ,
  voided_by TEXT NOT NULL DEFAULT '',
  void_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_employee_counseling_code ON employee_counseling_records (employee_code, occurred_on DESC);

CREATE TABLE IF NOT EXISTS pto_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL,
  employee_name TEXT NOT NULL DEFAULT '',
  employee_email TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'Vacation',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  hours NUMERIC(6,2),
  work_days NUMERIC(5,1) NOT NULL DEFAULT 0,
  scheduled_hours NUMERIC(7,2),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  approver_code TEXT NOT NULL DEFAULT '',
  approver_name TEXT NOT NULL DEFAULT '',
  approver_email TEXT NOT NULL DEFAULT '',
  requested_by_email TEXT NOT NULL DEFAULT '',
  requested_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by_email TEXT NOT NULL DEFAULT '',
  decided_by_name TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  kronos_entered_at TIMESTAMPTZ,
  kronos_entered_by TEXT NOT NULL DEFAULT '',
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',
  kronos_removed_at TIMESTAMPTZ,
  kronos_removed_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pto_requests_employee ON pto_requests (employee_code, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_pto_requests_dates ON pto_requests (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_pto_requests_status ON pto_requests (status);
-- Part of a day (Andrew 11/16): WHICH hours the person is off, so everyone
-- knows when to expect them, and the regular day those hours come out of as
-- it stood when the request was made (blank when no schedule was on file).
-- All four are "HH:MM", 24-hour, store time.
ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS start_time TEXT NOT NULL DEFAULT '';
ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS end_time TEXT NOT NULL DEFAULT '';
ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS day_start TEXT NOT NULL DEFAULT '';
ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS day_end TEXT NOT NULL DEFAULT '';
-- What a request draws from the person's PTO, in hours, worked out under the
-- policy as it stood when the request was made (null for leave that isn't PTO).
ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS pto_hours NUMERIC(7,2);
-- The company's Time Off policy as numbers (one row). Blank until an
-- executive changes something; until then PTO_POLICY_DEFAULTS apply.
CREATE TABLE IF NOT EXISTS pto_policy (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT ''
);
-- Requests whose last day out is more than a year past are MOVED here
-- (Andrew 11/16) so pto_requests, which every Time Off page load reads,
-- stays small. Nothing is deleted: the whole original row is kept as JSON in
-- "request", so a column added to pto_requests later needs no change here,
-- and the request audit can still find it. The plain columns exist only to
-- search on.
CREATE TABLE IF NOT EXISTS pto_requests_archive (
  id UUID PRIMARY KEY,
  employee_code TEXT NOT NULL DEFAULT '',
  employee_name TEXT NOT NULL DEFAULT '',
  approver_email TEXT NOT NULL DEFAULT '',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pto_archive_dates ON pto_requests_archive (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_pto_archive_employee ON pto_requests_archive (employee_code, start_date DESC);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

// ---- vocabularies ----------------------------------------------------------
export const REPORTS_TO_MODES = ["", "override", "pick"];
export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Seasonal", "Contract"];
export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
// No medical category on purpose, and nothing for I-9s (see the header).
export const DOCUMENT_CATEGORIES = ["Onboarding & offer", "Policy acknowledgment", "Certification & training", "Performance review", "Pay & status change", "Other"];
export const COUNSELING_DOCUMENT_CATEGORY = "Counseling";
export const COUNSELING_KINDS = ["Coaching conversation", "Verbal warning", "Written warning", "Final written warning", "Performance improvement plan", "Suspension", "Recognition"];
export const COUNSELING_ACKNOWLEDGMENTS = { "": "Not recorded", signed: "Employee signed", refused: "Employee declined to sign", discussed: "Discussed, nothing to sign" };
// Every kind of time off someone can ask for. Only the first three are PTO
// (Andrew 11/16); the rest are leave that is requested and tracked the same
// way but isn't PTO.
export const PTO_PAID_TYPES = ["Vacation", "Sick", "Personal"];
// Parental leave comes in two kinds (Andrew 11/16): the company-paid days,
// PARENTAL_PAID_MAX_DAYS working days on top of a person's PTO, and unpaid
// leave for the rest of the time away (in practice FMLA leave; the neutral
// name is deliberate).
export const PARENTAL_PAID = "Parental leave (paid)";
export const PARENTAL_UNPAID = "Parental leave (unpaid)";
export const PARENTAL_PAID_MAX_DAYS = 10; // the default: 80 paid hours at 8 hours a day (the policy decides, see PTO_POLICY_DEFAULTS)
export const PTO_TYPE_GROUPS = [
  { label: "PTO", types: PTO_PAID_TYPES },
  { label: "Parental leave", types: [PARENTAL_PAID, PARENTAL_UNPAID] },
  { label: "Other leave (not PTO)", types: ["Bereavement", "Jury duty", "Unpaid", "Other"] }
];
export const PTO_TYPES = PTO_TYPE_GROUPS.flatMap((g) => g.types);
// "pto" draws on the person's PTO; "parental-paid" is the company-paid
// parental days; everything else is leave that isn't PTO.
export const ptoPayClass = (type) => (PTO_PAID_TYPES.includes(type) ? "pto" : type === PARENTAL_PAID ? "parental-paid" : "other");
// One request covers up to 60 days; parental leave runs longer, so up to 26 weeks.
const maxRequestDays = (type) => (type === PARENTAL_UNPAID || type === "Parental leave" ? 182 : 60);
export const PTO_STATUSES = ["pending", "approved", "denied", "cancelled"];
export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
// What may be uploaded: documents and pictures of documents. Nothing that runs.
export const DOCUMENT_TYPES = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain", csv: "text/csv"
};

// ---- small helpers ---------------------------------------------------------
const text = (v, max = 200) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const longText = (v, max = 4000) => String(v == null ? "" : v).replace(/\r\n/g, "\n").trim().slice(0, max);
const codeOf = (v) => String(v || "").trim().toUpperCase();
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
function isoDate(v) {
  if (!v) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}
// "" / null -> null, a real YYYY-MM-DD -> itself, anything else -> undefined (caller rejects).
export function parseDay(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : undefined;
}
const dayMs = (s) => Date.parse(s + "T00:00:00Z");
const addDays = (s, n) => new Date(dayMs(s) + n * 86400000).toISOString().slice(0, 10);
const phoneText = (v) => String(v == null ? "" : v).replace(/[^0-9+() .x-]/gi, "").trim().slice(0, 30);

// ---- the regular working schedule -----------------------------------------
// { mon: { start: "08:00", end: "17:00" }, sat: { off: true }, ..., lunch: 60 }.
// A day that is missing is "not set"; a day with off:true is a regular day
// off. `lunch` is the unpaid meal break in minutes: it comes off every day
// scheduled for more than LUNCH_AFTER_HOURS, so 8 to 5 with an hour's lunch
// counts as the 8 hours Kronos will be keyed with.
export const LUNCH_AFTER_HOURS = 5;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export function normalizeSchedule(input) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};
  for (const day of WEEK_DAYS) {
    const d = src[day];
    if (!d || typeof d !== "object") continue;
    if (d.off) { out[day] = { off: true }; continue; }
    const start = String(d.start || "").trim(), end = String(d.end || "").trim();
    if (!start && !end) continue;
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) throw new Error(`Enter ${day.toUpperCase()} start and end as times (for example 8:00 AM to 5:00 PM), or mark the day off.`);
    if (minutesOf(end) <= minutesOf(start)) throw new Error(`${day.toUpperCase()}: the end time has to be after the start time.`);
    out[day] = { start, end };
  }
  if (src.lunch != null && src.lunch !== "") {
    const lunch = Math.round(Number(src.lunch));
    if (!Number.isFinite(lunch) || lunch < 0 || lunch > 120) throw new Error("Unpaid lunch must be between 0 and 120 minutes.");
    if (lunch) out.lunch = lunch;
  }
  return out;
}
// Hours a day is scheduled for (0 for a day off or a day that is not set).
export function scheduledHours(schedule, day) {
  const d = schedule?.[day];
  if (!d || d.off || !d.start || !d.end) return 0;
  const span = (minutesOf(d.end) - minutesOf(d.start)) / 60;
  const lunch = span > LUNCH_AFTER_HOURS ? (Number(schedule.lunch) || 0) / 60 : 0;
  return Math.round(Math.max(0, span - lunch) * 100) / 100;
}
export const weeklyHours = (schedule) => Math.round(WEEK_DAYS.reduce((sum, d) => sum + scheduledHours(schedule, d), 0) * 100) / 100;
const hasSchedule = (schedule) => WEEK_DAYS.some((d) => schedule?.[d]);
export const scheduleHasDays = hasSchedule;
// The schedule a person actually works: their own when one has been set for
// them, otherwise the default for their job code.
//   -> { schedule, source: "custom" | "job" | "none" }
export function effectiveSchedule(own, jobDefault) {
  if (hasSchedule(own)) return { schedule: own, source: "custom" };
  if (hasSchedule(jobDefault)) return { schedule: jobDefault, source: "job" };
  return { schedule: {}, source: "none" };
}
// Working days and scheduled hours inside a date range. With no schedule on
// file the count falls back to Monday-Friday and hours are left unknown.
// Given the Time Off policy as well, a paid holiday is not a day off work,
// and ptoHours is what the days draw from PTO: each day's scheduled hours
// rounded up to the policy's block (4 hours), never more than a full day (8).
// With no schedule on file each weekday counts as a full day.
export function workSpan(schedule, start, end, policy = null) {
  const known = hasSchedule(schedule);
  const closed = policy ? holidayDatesBetween(start, end, policy.holidays) : new Set();
  const full = policy ? policy.fullDayHours : 8, block = policy ? policy.incrementHours : 0;
  let days = 0, hours = 0, pto = 0, holidays = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const key = WEEK_DAYS[(new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7];
    const h = known ? scheduledHours(schedule, key) : key !== "sat" && key !== "sun" ? full : 0;
    if (!(h > 0)) continue;
    if (closed.has(d)) { holidays += 1; continue; }
    days += 1; if (known) hours += h;
    pto += Math.min(full, block > 0 ? Math.ceil(h / block - 1e-9) * block : h);
  }
  return { workDays: days, scheduledHours: known ? Math.round(hours * 100) / 100 : null, fromSchedule: known, ptoHours: Math.round(pto * 100) / 100, holidays };
}

// ---- job-code default schedules -------------------------------------------
export async function listJobSchedules() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM job_code_schedules`);
  return new Map(r.rows.map((row) => [row.job_code, { schedule: row.schedule && typeof row.schedule === "object" ? row.schedule : {}, updatedAt: iso(row.updated_at), updatedBy: row.updated_by || "" }]));
}
// Save (or, with an empty week, remove) the default for a job code.
export async function saveJobSchedule(jobCode, schedule, { byName = "" } = {}) {
  const code = codeOf(jobCode);
  if (!code) throw new Error("Missing job code.");
  const clean = normalizeSchedule(schedule);
  const pool = await getReadyPool();
  if (!hasSchedule(clean)) { await pool.query(`DELETE FROM job_code_schedules WHERE job_code = $1`, [code]); return {}; }
  await pool.query(
    `INSERT INTO job_code_schedules (job_code, schedule, updated_at, updated_by) VALUES ($1, $2::jsonb, NOW(), $3)
     ON CONFLICT (job_code) DO UPDATE SET schedule = EXCLUDED.schedule, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [code, JSON.stringify(clean), text(byName, 120)]
  );
  return clean;
}

// ---- profile details -------------------------------------------------------
function mapDetails(row) {
  const schedule = row?.schedule && typeof row.schedule === "object" ? row.schedule : {};
  return {
    reportsToCode: row?.reports_to_code || "", reportsToMode: row?.reports_to_mode || "", employmentType: row?.employment_type || "",
    workPhone: row?.work_phone || "", mobilePhone: row?.mobile_phone || "",
    emergencyName: row?.emergency_name || "", emergencyPhone: row?.emergency_phone || "", emergencyRelation: row?.emergency_relation || "",
    schedule, scheduleNote: row?.schedule_note || "", weeklyHours: weeklyHours(schedule),
    hrNote: row?.hr_note || "",
    detailsUpdatedAt: iso(row?.updated_at), detailsUpdatedBy: row?.updated_by_name || row?.updated_by_email || ""
  };
}
export async function listProfileDetails() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM employee_profile_details`);
  return new Map(r.rows.map((row) => [row.code, mapDetails(row)]));
}
export async function getProfileDetails(code) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM employee_profile_details WHERE code = $1`, [codeOf(code)]);
  return mapDetails(r.rows[0] || null);
}
// Only the fields present in `patch` change. Returns the saved details.
export async function saveProfileDetails(code, patch = {}, { byEmail = "", byName = "" } = {}) {
  const key = codeOf(code);
  if (!key) throw new Error("Missing employee code.");
  const cur = await getProfileDetails(key);
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  const reportsTo = has("reportsToCode") ? codeOf(patch.reportsToCode) : cur.reportsToCode;
  if (reportsTo && reportsTo === key) throw new Error("A person can't report to themselves.");
  const reportsToMode = has("reportsToMode") ? String(patch.reportsToMode || "") : cur.reportsToMode;
  if (!REPORTS_TO_MODES.includes(reportsToMode)) throw new Error("Unknown reports-to mode.");
  const employmentType = has("employmentType") ? text(patch.employmentType, 40) : cur.employmentType;
  if (employmentType && !EMPLOYMENT_TYPES.includes(employmentType)) throw new Error("Choose an employment type from the list.");
  const schedule = has("schedule") ? normalizeSchedule(patch.schedule) : cur.schedule;
  const next = {
    reportsTo, employmentType, schedule,
    workPhone: has("workPhone") ? phoneText(patch.workPhone) : cur.workPhone,
    mobilePhone: has("mobilePhone") ? phoneText(patch.mobilePhone) : cur.mobilePhone,
    emergencyName: has("emergencyName") ? text(patch.emergencyName, 120) : cur.emergencyName,
    emergencyPhone: has("emergencyPhone") ? phoneText(patch.emergencyPhone) : cur.emergencyPhone,
    emergencyRelation: has("emergencyRelation") ? text(patch.emergencyRelation, 60) : cur.emergencyRelation,
    scheduleNote: has("scheduleNote") ? text(patch.scheduleNote, 300) : cur.scheduleNote,
    hrNote: has("hrNote") ? longText(patch.hrNote, 2000) : cur.hrNote
  };
  const pool = await getReadyPool();
  const r = await pool.query(
    `INSERT INTO employee_profile_details (code, reports_to_code, employment_type, work_phone, mobile_phone, emergency_name, emergency_phone, emergency_relation, schedule, schedule_note, hr_note, updated_at, updated_by_email, updated_by_name, reports_to_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,NOW(),$12,$13,$14)
     ON CONFLICT (code) DO UPDATE SET reports_to_code = EXCLUDED.reports_to_code, reports_to_mode = EXCLUDED.reports_to_mode, employment_type = EXCLUDED.employment_type, work_phone = EXCLUDED.work_phone, mobile_phone = EXCLUDED.mobile_phone,
       emergency_name = EXCLUDED.emergency_name, emergency_phone = EXCLUDED.emergency_phone, emergency_relation = EXCLUDED.emergency_relation, schedule = EXCLUDED.schedule, schedule_note = EXCLUDED.schedule_note,
       hr_note = EXCLUDED.hr_note, updated_at = NOW(), updated_by_email = EXCLUDED.updated_by_email, updated_by_name = EXCLUDED.updated_by_name
     RETURNING *`,
    [key, next.reportsTo, next.employmentType, next.workPhone, next.mobilePhone, next.emergencyName, next.emergencyPhone, next.emergencyRelation, JSON.stringify(next.schedule), next.scheduleNote, next.hrNote, text(byEmail, 200).toLowerCase(), text(byName, 120), reportsToMode]
  );
  return mapDetails(r.rows[0]);
}
// The Org Chart filling in Reports to. Each update: { code, reportsToCode,
// mode } - mode is written as given ('' when the chart takes over from a
// released pick). Rows HR has overridden are never passed in. The "last
// saved by" stamp is left alone: this isn't an HR edit.
export async function applyChartReportsTo(updates = []) {
  if (!updates.length) return 0;
  const pool = await getReadyPool();
  let n = 0;
  for (const u of updates) {
    const key = codeOf(u.code), to = codeOf(u.reportsToCode);
    if (!key || key === to) continue;
    const r = await pool.query(
      `INSERT INTO employee_profile_details (code, reports_to_code, reports_to_mode) VALUES ($1, $2, '')
       ON CONFLICT (code) DO UPDATE SET reports_to_code = EXCLUDED.reports_to_code, reports_to_mode = ''
        WHERE employee_profile_details.reports_to_mode <> 'override'`, [key, to]
    );
    n += r.rowCount;
  }
  return n;
}
// Would making `managerCode` the manager of `code` create a loop (A -> B -> A)?
export async function reportsToWouldLoop(code, managerCode) {
  const start = codeOf(code); let cur = codeOf(managerCode);
  const all = await listProfileDetails();
  for (let hops = 0; cur && hops < 50; hops++) {
    if (cur === start) return true;
    cur = all.get(cur)?.reportsToCode || "";
  }
  return false;
}

// ---- HR documents ----------------------------------------------------------
const DOC_COLUMNS = `id, employee_code, category, title, filename, content_type, byte_size, counseling_id, uploaded_by_email, uploaded_by_name, uploaded_at, removed_at, removed_by_email, removed_reason`;
function mapDocument(row) {
  return {
    id: row.id, employeeCode: row.employee_code, category: row.category, title: row.title || row.filename, filename: row.filename,
    contentType: row.content_type, byteSize: Number(row.byte_size) || 0, counselingId: row.counseling_id || null,
    uploadedBy: row.uploaded_by_name || row.uploaded_by_email || "", uploadedAt: iso(row.uploaded_at),
    removedAt: iso(row.removed_at), removedBy: row.removed_by_email || "", removedReason: row.removed_reason || ""
  };
}
// The type is decided by the file's EXTENSION against the allow-list; the
// browser's claimed type is ignored.
export function documentTypeFor(filename) {
  const ext = String(filename || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] || "";
  return DOCUMENT_TYPES[ext] || "";
}
export async function addEmployeeDocument({ code, category, title = "", filename, bytes, counselingId = null, byEmail = "", byName = "" }) {
  const key = codeOf(code);
  if (!key) throw new Error("Missing employee code.");
  if (!bytes || !bytes.length) throw new Error("That file is empty.");
  if (bytes.length > DOCUMENT_MAX_BYTES) throw new Error("That file is larger than 15 MB.");
  const name = text(filename, 180) || "document";
  const type = documentTypeFor(name);
  if (!type) throw new Error("Upload a PDF, a picture (PNG, JPG, HEIC), or a Word, Excel, text or CSV file.");
  if (type === "application/pdf" && Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new Error("That file is named .pdf but isn't a PDF. Save it as a PDF again and re-upload.");
  const cat = counselingId ? COUNSELING_DOCUMENT_CATEGORY : text(category, 60);
  if (!counselingId && !DOCUMENT_CATEGORIES.includes(cat)) throw new Error("Choose a document category from the list.");
  const pool = await getReadyPool();
  const r = await pool.query(
    `INSERT INTO employee_documents (employee_code, category, title, filename, content_type, byte_size, bytes, counseling_id, uploaded_by_email, uploaded_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${DOC_COLUMNS}`,
    [key, cat, text(title, 160), name, type, bytes.length, bytes, counselingId, text(byEmail, 200).toLowerCase(), text(byName, 120)]
  );
  return mapDocument(r.rows[0]);
}
// General HR documents only; counseling attachments are listed with their record.
export async function listEmployeeDocuments(code, { includeRemoved = false } = {}) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT ${DOC_COLUMNS} FROM employee_documents WHERE employee_code = $1 AND counseling_id IS NULL ${includeRemoved ? "" : "AND removed_at IS NULL"} ORDER BY uploaded_at DESC`,
    [codeOf(code)]
  );
  return r.rows.map(mapDocument);
}
export async function countEmployeeDocuments() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT employee_code, COUNT(*)::int AS n FROM employee_documents WHERE counseling_id IS NULL AND removed_at IS NULL GROUP BY 1`);
  return new Map(r.rows.map((x) => [x.employee_code, x.n]));
}
// { ...meta, bytes } or null. The caller checks counselingId against the viewer's permission.
export async function getEmployeeDocument(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT ${DOC_COLUMNS}, bytes FROM employee_documents WHERE id = $1`, [id]);
  return r.rows[0] ? { ...mapDocument(r.rows[0]), bytes: r.rows[0].bytes } : null;
}
// Soft removal: the row and its bytes stay, marked with who and why.
export async function removeEmployeeDocument(id, { byEmail = "", reason = "" } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const why = text(reason, 300);
  if (!why) throw new Error("Say why this document is being removed.");
  const pool = await getReadyPool();
  const r = await pool.query(
    `UPDATE employee_documents SET removed_at = NOW(), removed_by_email = $2, removed_reason = $3 WHERE id = $1 AND removed_at IS NULL RETURNING ${DOC_COLUMNS}`,
    [id, text(byEmail, 200).toLowerCase(), why]
  );
  return r.rows[0] ? mapDocument(r.rows[0]) : null;
}

// ---- performance counseling ------------------------------------------------
function mapCounseling(row, attachments = []) {
  return {
    id: row.id, employeeCode: row.employee_code, occurredOn: isoDate(row.occurred_on), kind: row.kind,
    summary: row.summary, expectations: row.expectations || "", issuedBy: row.issued_by || "",
    acknowledgment: row.acknowledgment || "", acknowledgmentLabel: COUNSELING_ACKNOWLEDGMENTS[row.acknowledgment || ""] || "",
    followUpOn: isoDate(row.follow_up_on), followUpDoneAt: iso(row.follow_up_done_at), followUpDoneBy: row.follow_up_done_by || "",
    addenda: Array.isArray(row.addenda) ? row.addenda : [],
    createdAt: iso(row.created_at), createdBy: row.created_by_name || row.created_by_email || "",
    voidedAt: iso(row.voided_at), voidedBy: row.voided_by || "", voidReason: row.void_reason || "",
    attachments
  };
}
export async function listCounselingRecords(code) {
  const pool = await getReadyPool();
  const key = codeOf(code);
  const [recs, docs] = await Promise.all([
    pool.query(`SELECT * FROM employee_counseling_records WHERE employee_code = $1 ORDER BY occurred_on DESC, created_at DESC`, [key]),
    pool.query(`SELECT ${DOC_COLUMNS} FROM employee_documents WHERE employee_code = $1 AND counseling_id IS NOT NULL AND removed_at IS NULL ORDER BY uploaded_at`, [key])
  ]);
  const byRecord = new Map();
  for (const d of docs.rows) { const list = byRecord.get(d.counseling_id) || []; list.push(mapDocument(d)); byRecord.set(d.counseling_id, list); }
  return recs.rows.map((row) => mapCounseling(row, byRecord.get(row.id) || []));
}
export async function getCounselingRecord(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM employee_counseling_records WHERE id = $1`, [id]);
  return r.rows[0] ? mapCounseling(r.rows[0]) : null;
}
// Counts for the list page: { CODE: { total, openFollowUps } } - numbers only.
export async function countCounselingRecords() {
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT employee_code, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE follow_up_on IS NOT NULL AND follow_up_done_at IS NULL)::int AS open_follow_ups
       FROM employee_counseling_records WHERE voided_at IS NULL GROUP BY 1`
  );
  return new Map(r.rows.map((x) => [x.employee_code, { total: x.total, openFollowUps: x.open_follow_ups }]));
}
// Across everyone: follow-ups still open, and records written in the last
// `days` days - for the Counseling Records page.
export async function listCounselingOverview({ days = 90 } = {}) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT * FROM employee_counseling_records
      WHERE voided_at IS NULL AND ((follow_up_on IS NOT NULL AND follow_up_done_at IS NULL) OR created_at > NOW() - ($1 || ' days')::interval)
      ORDER BY occurred_on DESC, created_at DESC LIMIT 500`, [String(Math.max(1, Math.min(Number(days) || 90, 730)))]
  );
  return r.rows.map((row) => mapCounseling(row));
}
export async function addCounselingRecord({ code, occurredOn, kind, summary, expectations = "", issuedBy = "", acknowledgment = "", followUpOn = "", byEmail = "", byName = "" }) {
  const key = codeOf(code);
  if (!key) throw new Error("Missing employee code.");
  const day = parseDay(occurredOn);
  if (!day) throw new Error("Enter the date of the conversation.");
  if (day > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw new Error("The date of the conversation can't be in the future.");
  if (!COUNSELING_KINDS.includes(kind)) throw new Error("Choose the kind of record from the list.");
  const what = longText(summary, 6000);
  if (what.length < 10) throw new Error("Describe what happened and what was said (a sentence or more).");
  if (!Object.prototype.hasOwnProperty.call(COUNSELING_ACKNOWLEDGMENTS, acknowledgment)) throw new Error("Choose how the employee acknowledged it.");
  const follow = parseDay(followUpOn);
  if (follow === undefined) throw new Error("The follow-up date isn't a valid date.");
  const pool = await getReadyPool();
  const r = await pool.query(
    `INSERT INTO employee_counseling_records (employee_code, occurred_on, kind, summary, expectations, issued_by, acknowledgment, follow_up_on, created_by_email, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [key, day, kind, what, longText(expectations, 4000), text(issuedBy, 120), acknowledgment, follow, text(byEmail, 200).toLowerCase(), text(byName, 120)]
  );
  return mapCounseling(r.rows[0]);
}
// A record is never edited: corrections and later notes are appended.
export async function addCounselingAddendum(id, { text: body, byEmail = "", byName = "" } = {}) {
  const note = longText(body, 3000);
  if (note.length < 3) throw new Error("Type the addendum first.");
  const pool = await getReadyPool();
  const entry = { at: new Date().toISOString(), byEmail: text(byEmail, 200).toLowerCase(), byName: text(byName, 120), text: note };
  const r = await pool.query(`UPDATE employee_counseling_records SET addenda = addenda || $2::jsonb WHERE id = $1 AND voided_at IS NULL RETURNING *`, [id, JSON.stringify([entry])]);
  return r.rows[0] ? mapCounseling(r.rows[0]) : null;
}
export async function setCounselingFollowUpDone(id, done, { byName = "" } = {}) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `UPDATE employee_counseling_records SET follow_up_done_at = CASE WHEN $2 THEN NOW() ELSE NULL END, follow_up_done_by = CASE WHEN $2 THEN $3 ELSE '' END
      WHERE id = $1 AND voided_at IS NULL AND follow_up_on IS NOT NULL RETURNING *`,
    [id, Boolean(done), text(byName, 120)]
  );
  return r.rows[0] ? mapCounseling(r.rows[0]) : null;
}
// Entered in error: the record stays, marked void with who and why.
export async function voidCounselingRecord(id, { reason = "", byName = "" } = {}) {
  const why = text(reason, 400);
  if (why.length < 5) throw new Error("Say why this record is being voided.");
  const pool = await getReadyPool();
  const r = await pool.query(`UPDATE employee_counseling_records SET voided_at = NOW(), voided_by = $2, void_reason = $3 WHERE id = $1 AND voided_at IS NULL RETURNING *`, [id, text(byName, 120), why]);
  return r.rows[0] ? mapCounseling(r.rows[0]) : null;
}

// ---- PTO -------------------------------------------------------------------
const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const clockText = (t) => { const h = Number(t.slice(0, 2)), m = t.slice(3, 5); return `${h % 12 || 12}${m === "00" ? "" : ":" + m} ${h < 12 ? "AM" : "PM"}`; };
const clockOf = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
// What a part-day request does to that one day: the hours off come out of
// the regular day, which moves the start back, the finish forward, or
// splits the day in two. Times are "HH:MM"; dayStart/dayEnd are blank when
// no regular day was on file.
//   -> null when there is no window (a whole-day request, or one made before
//      windows were asked for), otherwise
//      { offText, regularText, work: [{ start, end }] | null, workText, expect }
// `expect` is the short form for a calendar: "in at 12 PM", "leaves at 1 PM",
// "out 10 AM to 2 PM". The capacity engine reads `work`.
export function partDayPlan({ startTime = "", endTime = "", dayStart = "", dayEnd = "" } = {}) {
  if (!CLOCK_RE.test(startTime) || !CLOCK_RE.test(endTime) || minutesOf(endTime) <= minutesOf(startTime)) return null;
  const offText = `${clockText(startTime)} to ${clockText(endTime)}`;
  if (!CLOCK_RE.test(dayStart) || !CLOCK_RE.test(dayEnd) || minutesOf(dayEnd) <= minutesOf(dayStart)) return { offText, regularText: "", work: null, workText: "", expect: `out ${offText}` };
  const a = minutesOf(dayStart), b = minutesOf(dayEnd), x = Math.max(a, minutesOf(startTime)), y = Math.min(b, minutesOf(endTime));
  const work = [];
  if (y <= x) work.push({ start: dayStart, end: dayEnd }); // the hours off fall outside the regular day
  else { if (x > a) work.push({ start: dayStart, end: clockOf(x) }); if (y < b) work.push({ start: clockOf(y), end: dayEnd }); }
  const expect = y <= x ? `out ${offText}` : !work.length ? "off the whole day" : x <= a ? `in at ${clockText(clockOf(y))}` : y >= b ? `leaves at ${clockText(clockOf(x))}` : `out ${offText}`;
  return { offText, regularText: `${clockText(dayStart)} to ${clockText(dayEnd)}`, work, workText: work.map((w) => `${clockText(w.start)} to ${clockText(w.end)}`).join(" and "), expect };
}
function mapPto(row) {
  return {
    id: row.id, employeeCode: row.employee_code, employeeName: row.employee_name, employeeEmail: row.employee_email,
    type: row.type, isPto: PTO_PAID_TYPES.includes(row.type), payClass: ptoPayClass(row.type), startDate: isoDate(row.start_date), endDate: isoDate(row.end_date),
    hours: row.hours == null ? null : Number(row.hours), workDays: Number(row.work_days) || 0,
    // hours the regular schedule puts on those days (null when no schedule was on file) - what HR keys into Kronos
    scheduledHours: row.scheduled_hours == null ? null : Number(row.scheduled_hours), note: row.note || "",
    ptoHours: row.pto_hours == null ? null : Number(row.pto_hours),
    // part of a day: which hours, and what that leaves of the regular day
    startTime: row.start_time || "", endTime: row.end_time || "", dayStart: row.day_start || "", dayEnd: row.day_end || "",
    partDay: partDayPlan({ startTime: row.start_time || "", endTime: row.end_time || "", dayStart: row.day_start || "", dayEnd: row.day_end || "" }),
    status: row.status,
    approverCode: row.approver_code || "", approverName: row.approver_name || "", approverEmail: row.approver_email || "",
    requestedBy: row.requested_by_name || row.requested_by_email || "", requestedByEmail: row.requested_by_email || "",
    createdAt: iso(row.created_at),
    decidedAt: iso(row.decided_at), decidedBy: row.decided_by_name || row.decided_by_email || "", decidedByEmail: row.decided_by_email || "", decisionNote: row.decision_note || "",
    kronosEnteredAt: iso(row.kronos_entered_at), kronosEnteredBy: row.kronos_entered_by || "",
    cancelledAt: iso(row.cancelled_at), cancelledBy: row.cancelled_by || "", cancelReason: row.cancel_reason || "",
    kronosRemovedAt: iso(row.kronos_removed_at), kronosRemovedBy: row.kronos_removed_by || "",
    // what HR still has to do in Kronos for this request, if anything
    kronosTask: row.status === "approved" && !row.kronos_entered_at ? "enter" : row.status === "cancelled" && row.kronos_entered_at && !row.kronos_removed_at ? "remove" : ""
  };
}
// What everyone may see of an approved request: who and when. Never the type or the note.
// For part of a day that includes which hours, so people know when to expect them.
export const publicPto = (r) => ({ id: r.id, employeeCode: r.employeeCode, employeeName: r.employeeName, startDate: r.startDate, endDate: r.endDate, partialDay: r.hours != null, startTime: r.startTime, endTime: r.endTime, expect: r.partDay ? r.partDay.expect : "" });

// `employee`: { code, name, email }. `approver`: { code, name, email } or null (HR decides).
// `schedule`: the employee's regular schedule, for the working-day count.
// ---- the Time Off policy ----------------------------------------------------
// The company's written Time Off policy, as numbers Agility can apply
// (Andrew 11/16, read from the policy document). These are the defaults; an
// executive changes them in the Policy section of the Time Off page.
//
//   PTO          a full workday is 8 hours and PTO is used in 4-hour blocks;
//                hours a year by tenure, full time / part time: 120 / 60
//                (0-1 year), 160 / 80 (2-5 years), 200 / 100 (5+ years),
//                reset and deposited each January 1 on the tenure reached in
//                the previous calendar year; in the hire year it builds from
//                the hire date to year end and is available after 90 days;
//                part time needs a 20-hour weekly average
//   holidays     New Year's Day, Independence Day, Thanksgiving, Christmas
//   parental     80 extra paid hours, used within four weeks, applied for 90
//                days ahead
//   jury duty    hourly staff paid 6 hours a day for up to 14 days
//   unpaid leave up to 30 days in one request
export const PTO_HOLIDAYS = [
  { key: "new-years-day", label: "New Year's Day" }, { key: "memorial-day", label: "Memorial Day" }, { key: "independence-day", label: "Independence Day" },
  { key: "labor-day", label: "Labor Day" }, { key: "thanksgiving", label: "Thanksgiving" }, { key: "day-after-thanksgiving", label: "Day after Thanksgiving" },
  { key: "christmas-eve", label: "Christmas Eve" }, { key: "christmas-day", label: "Christmas Day" }
];
export const PTO_POLICY_DEFAULTS = Object.freeze({
  fullDayHours: 8, incrementHours: 4,
  tiers: [{ fromYears: 0, fullTime: 120, partTime: 60 }, { fromYears: 2, fullTime: 160, partTime: 80 }, { fromYears: 5, fullTime: 200, partTime: 100 }],
  partTimeMinWeeklyHours: 20, newHireWaitDays: 90,
  holidays: ["new-years-day", "independence-day", "thanksgiving", "christmas-day"],
  parentalPaidHours: 80, parentalWindowWeeks: 4, parentalNoticeDays: 90,
  juryMaxDays: 14, juryPaidHoursPerDay: 6,
  unpaidLeaveMaxDays: 30,
  // the parts of the policy that are words rather than numbers; shown as written, one paragraph a line
  notes: [
    "Sick time: an unplanned absence for illness is covered with PTO, unless your direct supervisor can make an unpaid exception. Unplanned absences after PTO is used up are treated as unexcused.",
    "Flexible unpaid day: most roles can trade one regular day a week by working longer on four days or working a normally unscheduled day. Arrange it with your supervisor. It is entered in Kronos, not here.",
    "Payout: remaining PTO hours are paid out when you leave in good standing, meaning adequate notice, satisfactory work through your last day, and a documented exit interview."
  ].join("\n")
});
// Agility began recording time off on this day. A balance for a year that
// started earlier only knows part of what was taken, and says so.
export const PTO_TRACKING_SINCE = "2026-11-15";

// Any saved or typed policy -> a complete, sane one. With `strict` a value
// out of range is refused (saving); without it the default takes its place
// (reading), so a damaged row can never take the Time Off page down.
export function normalizePtoPolicy(input, { strict = false } = {}) {
  const src = input && typeof input === "object" ? input : {}, d = PTO_POLICY_DEFAULTS, out = {};
  const num = (key, label, min, max, { whole = true } = {}) => {
    const raw = src[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") { out[key] = d[key]; return; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max || (whole && !Number.isInteger(n))) { if (strict) throw new Error(`${label} has to be ${whole ? "a whole number" : "a number"} from ${min} to ${max}.`); out[key] = d[key]; return; }
    out[key] = n;
  };
  num("fullDayHours", "Hours in a full workday", 1, 24, { whole: false });
  num("incrementHours", "The PTO block", 0.25, 24, { whole: false });
  num("partTimeMinWeeklyHours", "The part-time weekly average", 0, 60, { whole: false });
  num("newHireWaitDays", "The new-hire wait", 0, 365);
  num("parentalPaidHours", "Paid parental hours", 0, 2000, { whole: false });
  num("parentalWindowWeeks", "The parental leave window", 1, 52);
  num("parentalNoticeDays", "Parental leave notice", 0, 365);
  num("juryMaxDays", "Jury duty days", 1, 365);
  num("juryPaidHoursPerDay", "Jury duty hours a day", 0, 24, { whole: false });
  num("unpaidLeaveMaxDays", "Unpaid leave days", 1, 365);
  if (out.incrementHours > out.fullDayHours) { if (strict) throw new Error("The PTO block can't be longer than a full workday."); out.incrementHours = d.incrementHours <= out.fullDayHours ? d.incrementHours : out.fullDayHours; }
  const known = new Set(PTO_HOLIDAYS.map((h) => h.key));
  out.holidays = Array.isArray(src.holidays) ? PTO_HOLIDAYS.map((h) => h.key).filter((k) => src.holidays.includes(k)) : [...d.holidays];
  if (strict && Array.isArray(src.holidays) && src.holidays.some((k) => !known.has(k))) throw new Error("Choose the paid holidays from the list.");
  let tiers = null;
  if (Array.isArray(src.tiers)) {
    tiers = src.tiers.map((t) => ({ fromYears: Number(t?.fromYears), fullTime: Number(t?.fullTime), partTime: Number(t?.partTime) }));
    const bad = !tiers.length || tiers.length > 8 || tiers.some((t) => !Number.isInteger(t.fromYears) || t.fromYears < 0 || t.fromYears > 60 || !Number.isFinite(t.fullTime) || t.fullTime < 0 || t.fullTime > 2000 || !Number.isFinite(t.partTime) || t.partTime < 0 || t.partTime > 2000);
    tiers.sort((a, b) => a.fromYears - b.fromYears);
    const dupes = tiers.some((t, i) => i && t.fromYears === tiers[i - 1].fromYears);
    if (bad || dupes || tiers[0].fromYears !== 0) { if (strict) throw new Error(bad ? "Each PTO row needs whole years of service and hours from 0 to 2,000." : dupes ? "Two PTO rows start at the same years of service." : "The first PTO row has to start at 0 years of service."); tiers = null; }
  }
  out.tiers = tiers || d.tiers.map((t) => ({ ...t }));
  out.notes = typeof src.notes === "string" ? longText(src.notes, 4000) : d.notes;
  return out;
}
export async function getPtoPolicy() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT policy, updated_at, updated_by FROM pto_policy WHERE id = 1`);
  return { ...normalizePtoPolicy(r.rows[0]?.policy), updatedAt: iso(r.rows[0]?.updated_at), updatedBy: r.rows[0]?.updated_by || "" };
}
export async function savePtoPolicy(input, { byName = "" } = {}) {
  const policy = normalizePtoPolicy(input, { strict: true });
  const pool = await getReadyPool();
  await pool.query(
    `INSERT INTO pto_policy (id, policy, updated_at, updated_by) VALUES (1, $1::jsonb, NOW(), $2)
     ON CONFLICT (id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = NOW(), updated_by = EXCLUDED.updated_by`, [JSON.stringify(policy), text(byName, 120)]
  );
  return getPtoPolicy();
}

// The paid holidays that fall inside a range of days, as a Set of YYYY-MM-DD.
const nthWeekday = (year, month, weekday, n) => { // n = 1..4, or -1 for the last one; weekday 0 = Sunday
  if (n > 0) { const first = new Date(Date.UTC(year, month, 1)).getUTCDay(); return new Date(Date.UTC(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7)).toISOString().slice(0, 10); }
  const last = new Date(Date.UTC(year, month + 1, 0)); return new Date(Date.UTC(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7))).toISOString().slice(0, 10);
};
export function holidayDates(year, keys = []) {
  const on = { "new-years-day": `${year}-01-01`, "memorial-day": nthWeekday(year, 4, 1, -1), "independence-day": `${year}-07-04`, "labor-day": nthWeekday(year, 8, 1, 1),
    thanksgiving: nthWeekday(year, 10, 4, 4), "day-after-thanksgiving": addDays(nthWeekday(year, 10, 4, 4), 1), "christmas-eve": `${year}-12-24`, "christmas-day": `${year}-12-25` };
  return new Map((keys || []).filter((k) => on[k]).map((k) => [on[k], PTO_HOLIDAYS.find((h) => h.key === k).label]));
}
function holidayDatesBetween(start, end, keys) {
  const out = new Set();
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) for (const day of holidayDates(y, keys).keys()) if (day >= start && day <= end) out.add(day);
  return out;
}

// A person's PTO for one calendar year under the policy.
//   -> { year, hours, basis: "full-time" | "part-time" | "none", tierFromYears,
//        prorated, availableFrom, why }
// hours is null when it can't be worked out (no hire date on file).
export function ptoAllowance({ hireDate = "", employmentType = "", year, policy }) {
  const y = Number(year), hired = parseDay(hireDate) || "";
  const basis = employmentType === "Part-time" ? "part-time" : employmentType === "Seasonal" || employmentType === "Contract" ? "none" : "full-time";
  const base = { year: y, basis, tierFromYears: 0, prorated: false, availableFrom: hired ? addDays(hired, policy.newHireWaitDays) : "" };
  if (basis === "none") return { ...base, hours: 0, why: `${employmentType} staff are outside the PTO policy.` };
  if (!hired) return { ...base, hours: null, why: "No hire date on file, so PTO can't be worked out. HR sets it on the profile." };
  const hireYear = Number(hired.slice(0, 4));
  if (hireYear > y) return { ...base, hours: 0, why: "Not hired yet that year." };
  const column = basis === "part-time" ? "partTime" : "fullTime";
  const unsure = employmentType ? "" : " Full time is assumed because the profile doesn't say.";
  if (hireYear === y) { // builds from the hire date to the end of the year
    const yearDays = (dayMs(`${y + 1}-01-01`) - dayMs(`${y}-01-01`)) / 86400000, left = (dayMs(`${y + 1}-01-01`) - dayMs(hired)) / 86400000;
    return { ...base, prorated: true, hours: Math.round(policy.tiers[0][column] * left / yearDays), why: `First year: ${policy.tiers[0][column]} hours a year, counted from the hire date to December 31.${unsure}` };
  }
  // the tenure reached in the previous calendar year decides the January 1 deposit
  const years = y - 1 - hireYear;
  const tier = [...policy.tiers].reverse().find((t) => years >= t.fromYears) || policy.tiers[0];
  return { ...base, tierFromYears: tier.fromYears, hours: tier[column], why: `${years} ${years === 1 ? "year" : "years"} of service reached by the end of ${y - 1}.${unsure}` };
}
// What a person has for the year, and what Agility knows they have taken.
// `partial` = the year began before Agility started recording time off, so
// "used" is only what has gone through Agility and "left" is not given.
export async function ptoBalance(code, { year, hireDate = "", employmentType = "", policy, excludeId = null } = {}) {
  const allowance = ptoAllowance({ hireDate, employmentType, year, policy });
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT status, COALESCE(SUM(COALESCE(pto_hours, hours, scheduled_hours, work_days * $4::numeric)), 0)::float AS hours FROM pto_requests
      WHERE employee_code = $1 AND type = ANY($2::text[]) AND status IN ('approved', 'pending') AND start_date >= $3::date AND start_date < ($3::date + INTERVAL '1 year')
        AND ($5::uuid IS NULL OR id <> $5::uuid) GROUP BY status`,
    [codeOf(code), PTO_PAID_TYPES, `${Number(year)}-01-01`, policy.fullDayHours, excludeId]
  );
  const of = (status) => Math.round((r.rows.find((x) => x.status === status)?.hours || 0) * 100) / 100;
  const used = of("approved"), pending = of("pending"), partial = `${Number(year)}-01-01` < PTO_TRACKING_SINCE;
  return { ...allowance, used, pending, partial, trackingSince: PTO_TRACKING_SINCE, left: allowance.hours == null || partial ? null : Math.round((allowance.hours - used - pending) * 100) / 100 };
}

// ---- asking for time off ------------------------------------------------------
// Everything about a request that can be settled without saving it: the
// dates, which hours, what it counts for, and whether the policy allows it.
// Throws a sentence the person can act on. `policy` is the Time Off policy
// in force (getPtoPolicy); `schedule` the week the person works.
export function planPtoRequest({ type, startDate, endDate, startTime = "", endTime = "", schedule = {}, policy = PTO_POLICY_DEFAULTS, today = new Date().toISOString().slice(0, 10) }) {
  if (!PTO_TYPES.includes(type)) throw new Error("Choose the kind of time off from the list.");
  const start = parseDay(startDate), end = parseDay(endDate || startDate);
  if (!start || !end) throw new Error("Enter the first and last day you'll be out.");
  if (end < start) throw new Error("The last day can't be before the first day.");
  const calendarDays = (dayMs(end) - dayMs(start)) / 86400000 + 1;
  if (type === "Unpaid" && calendarDays > policy.unpaidLeaveMaxDays) throw new Error(`Unpaid leave covers up to ${policy.unpaidLeaveMaxDays} days in one request, and those dates are ${calendarDays}. Beyond that, talk with the owners, the general manager and Employer Flexible's HR team.`);
  if (calendarDays - 1 > maxRequestDays(type)) throw new Error(type === PARENTAL_UNPAID ? "Unpaid parental leave can cover up to 26 weeks in one request." : "A single request can cover up to 60 days. Split a longer absence into two requests.");
  if (start < addDays(today, -60)) throw new Error("That start date is more than 60 days ago. Ask HR to record it.");
  if (start > addDays(today, 550)) throw new Error("That is more than 18 months out.");
  const isPto = PTO_PAID_TYPES.includes(type), block = policy.incrementHours;
  const blockText = `${block}-hour`;
  // Part of one day: which hours. The count of hours follows from them.
  let hours = null, dayStart = "", dayEnd = "";
  const offStart = String(startTime || "").trim().slice(0, 5), offEnd = String(endTime || "").trim().slice(0, 5);
  if (offStart || offEnd) {
    if (start !== end) throw new Error("Part of a day only applies to a single day. For several days, ask for whole days.");
    if (!CLOCK_RE.test(offStart) || !CLOCK_RE.test(offEnd)) throw new Error("Say which hours you'll be off: from what time, until what time.");
    if (minutesOf(offEnd) <= minutesOf(offStart)) throw new Error("The time off has to end after it starts.");
    const key = WEEK_DAYS[(new Date(start + "T00:00:00Z").getUTCDay() + 6) % 7], regular = schedule?.[key];
    if (regular && !regular.off && CLOCK_RE.test(regular.start || "") && CLOCK_RE.test(regular.end || "")) {
      // the regular day as it stands today, kept with the request so it still reads right if the schedule changes later
      dayStart = regular.start; dayEnd = regular.end;
      const dayName = new Date(start + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      if (offStart === dayStart && offEnd === dayEnd) throw new Error(`${clockText(dayStart)} to ${clockText(dayEnd)} is the whole regular day. Untick "Only part of one day" to ask for the day off.`);
      if (minutesOf(offStart) < minutesOf(dayStart) || minutesOf(offEnd) > minutesOf(dayEnd)) throw new Error(`The regular day on file for ${dayName} is ${clockText(dayStart)} to ${clockText(dayEnd)}. Pick hours inside it, or have the schedule corrected first.`);
    }
    // the same unpaid-lunch rule a whole day uses: it comes off once the stretch is longer than LUNCH_AFTER_HOURS
    const stretch = (minutesOf(offEnd) - minutesOf(offStart)) / 60;
    hours = Math.round((stretch - (stretch > LUNCH_AFTER_HOURS ? (Number(schedule?.lunch) || 0) / 60 : 0)) * 100) / 100;
    if (!(hours > 0)) throw new Error("Those hours come to nothing once the unpaid lunch is taken off. Pick a longer stretch.");
    // the policy: PTO is used in blocks (4 hours)
    if (isPto && Math.abs(hours / block - Math.round(hours / block)) > 1e-6) throw new Error(`PTO is taken in ${blockText} blocks, and ${clockText(offStart)} to ${clockText(offEnd)} is ${hours} ${hours === 1 ? "hour" : "hours"}. Pick a ${blockText} stretch${policy.fullDayHours > block ? ", or untick the box for the whole day" : ""}.`);
  }
  const span = workSpan(schedule, start, end, policy);
  if (hours == null && span.workDays === 0 && span.holidays > 0) throw new Error("Those dates are a paid holiday. The store is closed, so there is nothing to ask for.");
  if (type === PARENTAL_PAID) {
    const maxDays = Math.floor(policy.parentalPaidHours / policy.fullDayHours + 1e-9);
    if (span.workDays > maxDays) throw new Error(`Paid parental leave covers up to ${maxDays} working days (${policy.parentalPaidHours} hours), and those dates are ${span.workDays}. Send the first ${maxDays} as paid and the rest as Parental leave (unpaid) or PTO.`);
    if (calendarDays > policy.parentalWindowWeeks * 7) throw new Error(`Paid parental leave is used within ${policy.parentalWindowWeeks} weeks, and those dates run ${Math.ceil(calendarDays / 7)} weeks. Pick dates inside ${policy.parentalWindowWeeks} weeks.`);
  }
  if (type === "Jury duty" && span.workDays > policy.juryMaxDays) throw new Error(`Jury duty is covered for up to ${policy.juryMaxDays} days, and those dates are ${span.workDays} working days. Talk with HR about the rest.`);
  return {
    type, start, end, calendarDays, hours, offStart: hours != null ? offStart : "", offEnd: hours != null ? offEnd : "", dayStart, dayEnd,
    workDays: hours != null ? 0.5 : span.workDays, scheduledHours: hours != null ? null : span.scheduledHours, fromSchedule: span.fromSchedule, holidays: hours != null ? 0 : span.holidays,
    // what it draws from the person's PTO (nothing for leave that isn't PTO)
    ptoHours: isPto ? (hours != null ? hours : span.ptoHours) : null,
    partDay: partDayPlan({ startTime: offStart, endTime: offEnd, dayStart, dayEnd })
  };
}
// What the policy has to say about a request that is otherwise fine: things
// for the person and the approver to know, never a refusal. `balance` is
// ptoBalance for the year of the first day, not counting this request.
export function ptoPolicyNotes(plan, { policy, balance = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const notes = [], nice = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const start = plan.start || plan.startDate, hrs = (n) => `${n} ${n === 1 ? "hour" : "hours"}`;
  if (plan.holidays) notes.push(`${plan.holidays === 1 ? "A paid holiday falls" : plan.holidays + " paid holidays fall"} in those dates and ${plan.holidays === 1 ? "is" : "are"} not counted.`);
  if (plan.ptoHours != null && balance) {
    if (balance.availableFrom && start < balance.availableFrom) notes.push(`PTO is available ${policy.newHireWaitDays} days after the hire date, which is ${nice(balance.availableFrom)}. This starts before that.`);
    if (balance.hours == null) notes.push(balance.why);
    else if (balance.partial) notes.push(`PTO for ${balance.year} is ${hrs(balance.hours)}. Agility has counted ${hrs(balance.used + balance.pending)} taken or waiting since ${nice(balance.trackingSince)}; anything earlier is in Kronos.`);
    else if (plan.ptoHours > balance.left + 1e-6) notes.push(`This takes ${hrs(plan.ptoHours)} of PTO and ${hrs(Math.max(0, balance.left))} ${Math.max(0, balance.left) === 1 ? "is" : "are"} left for ${balance.year}.`);
  }
  if (plan.type === PARENTAL_PAID) {
    const ahead = Math.round((dayMs(start) - dayMs(plan.askedOn || today)) / 86400000);
    if (ahead < policy.parentalNoticeDays) notes.push(`The policy asks for paid parental leave to be applied for ${policy.parentalNoticeDays} days ahead and approved by the General Manager. This was asked ${ahead <= 0 ? "on or after the first day" : ahead + (ahead === 1 ? " day" : " days") + " ahead"}.`);
    else notes.push("Paid parental leave is approved by the General Manager.");
  }
  if (plan.type === "Jury duty") notes.push(`Court paperwork goes to HR. Hourly staff are paid ${hrs(policy.juryPaidHoursPerDay)} a day at base pay.`);
  return notes;
}
export async function createPtoRequest({ employee, type, startDate, endDate, startTime = "", endTime = "", note = "", approver = null, schedule = {}, policy = null, byEmail = "", byName = "", today = new Date().toISOString().slice(0, 10) }) {
  const code = codeOf(employee?.code);
  if (!code) throw new Error("We couldn't match you to an employee profile. Ask HR to check the email on your profile.");
  const plan = planPtoRequest({ type, startDate, endDate, startTime, endTime, schedule, policy: policy || (await getPtoPolicy()), today });
  const pool = await getReadyPool();
  const clash = await pool.query(
    `SELECT start_date, end_date, status FROM pto_requests WHERE employee_code = $1 AND status IN ('pending','approved') AND start_date <= $3::date AND end_date >= $2::date LIMIT 1`,
    [code, plan.start, plan.end]
  );
  if (clash.rows[0]) throw new Error(`There is already a ${clash.rows[0].status} request covering ${isoDate(clash.rows[0].start_date)}${isoDate(clash.rows[0].end_date) !== isoDate(clash.rows[0].start_date) ? " to " + isoDate(clash.rows[0].end_date) : ""}. Cancel that one first, or pick other days.`);
  const r = await pool.query(
    `INSERT INTO pto_requests (employee_code, employee_name, employee_email, type, start_date, end_date, hours, work_days, note, approver_code, approver_name, approver_email, requested_by_email, requested_by_name, scheduled_hours, start_time, end_time, day_start, day_end, pto_hours)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [code, text(employee.name, 120), text(employee.email, 200).toLowerCase(), type, plan.start, plan.end, plan.hours, plan.workDays, longText(note, 600),
      codeOf(approver?.code), text(approver?.name, 120), text(approver?.email, 200).toLowerCase(), text(byEmail, 200).toLowerCase(), text(byName, 120), plan.scheduledHours,
      plan.offStart, plan.offEnd, plan.dayStart, plan.dayEnd, plan.ptoHours]
  );
  return mapPto(r.rows[0]);
}

// Working days of paid parental leave a person already has approved in the
// twelve months before `beforeDate` - shown to whoever decides the next one.
export async function paidParentalDaysUsed(code, beforeDate, { excludeId = null } = {}) {
  const day = parseDay(beforeDate);
  if (!day) return 0;
  const pool = await getReadyPool();
  const r = await pool.query(
    // archived requests count too: a request entered late can reach back past the one-year archive line
    `SELECT COALESCE(SUM(work_days), 0) AS days FROM (${PTO_EVERYTHING}) r
      WHERE employee_code = $1 AND type = $2 AND status = 'approved' AND start_date > ($3::date - INTERVAL '12 months') AND start_date <= $3::date AND ($4::uuid IS NULL OR id <> $4::uuid)`,
    [codeOf(code), PARENTAL_PAID, day, excludeId]
  );
  return Number(r.rows[0].days) || 0;
}
export async function getPtoRequest(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM pto_requests WHERE id = $1`, [id]);
  return r.rows[0] ? mapPto(r.rows[0]) : null;
}
export async function listPtoForEmployee(code, { limit = 200 } = {}) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM pto_requests WHERE employee_code = $1 ORDER BY start_date DESC, created_at DESC LIMIT $2`, [codeOf(code), limit]);
  return r.rows.map(mapPto);
}
// Requests waiting on a decision. `approverEmail` narrows to one manager's;
// `includeUnrouted` adds the ones with no manager on file (HR decides those).
export async function listPendingPto({ approverEmail = "", all = false } = {}) {
  const pool = await getReadyPool();
  const r = all
    ? await pool.query(`SELECT * FROM pto_requests WHERE status = 'pending' ORDER BY start_date, created_at`)
    : await pool.query(`SELECT * FROM pto_requests WHERE status = 'pending' AND approver_email = $1 AND $1 <> '' ORDER BY start_date, created_at`, [text(approverEmail, 200).toLowerCase()]);
  return r.rows.map(mapPto);
}
// HR's Kronos list: approved and not entered yet, plus cancelled-after-entry not yet taken back out.
export async function listKronosQueue() {
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT * FROM pto_requests WHERE (status = 'approved' AND kronos_entered_at IS NULL) OR (status = 'cancelled' AND kronos_entered_at IS NOT NULL AND kronos_removed_at IS NULL) ORDER BY start_date, created_at`
  );
  return r.rows.map(mapPto);
}
// ---- the request audit, and the archive behind it ---------------------------
export const PTO_ARCHIVE_AFTER_DAYS = 365;
// Live requests, and live plus archived, each row in pto_requests' own shape
// with archived_at (null while live).
const PTO_LIVE = `SELECT p.*, NULL::timestamptz AS archived_at FROM pto_requests p`;
const PTO_EVERYTHING = `${PTO_LIVE} UNION ALL SELECT p.*, x.archived_at FROM pto_requests_archive x, LATERAL jsonb_populate_record(NULL::pto_requests, x.request) p`;

// Move every request whose last day out is more than a year before `today`
// into the archive. Anything still waiting on someone stays put however old
// it is - a decision, a Kronos entry, or a Kronos removal - so nothing drops
// off a to-do list just by ageing. Returns how many moved.
export async function archiveOldPtoRequests({ today = new Date().toISOString().slice(0, 10), days = PTO_ARCHIVE_AFTER_DAYS } = {}) {
  const day = parseDay(today);
  if (!day) throw new Error("Pick a valid date.");
  const pool = await getReadyPool();
  const r = await pool.query(
    `WITH moved AS (
       DELETE FROM pto_requests p
        WHERE p.end_date < ($1::date - $2::int)
          AND p.status <> 'pending'
          AND NOT (p.status = 'approved' AND p.kronos_entered_at IS NULL)
          AND NOT (p.status = 'cancelled' AND p.kronos_entered_at IS NOT NULL AND p.kronos_removed_at IS NULL)
       RETURNING p.*)
     INSERT INTO pto_requests_archive (id, employee_code, employee_name, approver_email, start_date, end_date, request)
     SELECT m.id, m.employee_code, m.employee_name, m.approver_email, m.start_date, m.end_date, to_jsonb(m) FROM moved m`,
    [day, Math.max(1, Math.round(Number(days) || PTO_ARCHIVE_AFTER_DAYS))]
  );
  return r.rowCount;
}

// The request audit: every request, by date out (newest first), narrowed by
// who (any part of the name, or the employee code) and/or when (requests
// whose days out touch the range). HR passes all: true; anyone else sees only
// the requests that were routed to them to approve. Archived requests are
// searched only when asked for.
export async function searchPtoRequests({ q = "", from = "", to = "", approverEmail = "", all = false, includeArchived = false, limit = 300 } = {}) {
  const a = from ? parseDay(from) : "", b = to ? parseDay(to) : "";
  if ((from && !a) || (to && !b)) throw new Error("Pick valid dates.");
  if (a && b && b < a) throw new Error("The end of the range is before its start.");
  const name = text(q, 80).replace(/[%_\\]/g, "").trim(); // no wildcards of the searcher's own
  if (text(q, 80) && !name) return { requests: [], truncated: false };
  const max = Math.max(1, Math.min(500, Math.round(Number(limit) || 300)));
  const params = [], where = [];
  const use = (v) => { params.push(v); return `$${params.length}`; };
  if (!all) {
    const mine = text(approverEmail, 200).toLowerCase();
    if (!mine) return { requests: [], truncated: false };
    where.push(`r.approver_email = ${use(mine)}`);
  }
  if (name) { const n = use(`%${name}%`), c = use(codeOf(name)); where.push(`(r.employee_name ILIKE ${n} OR r.employee_code = ${c})`); }
  if (a) where.push(`r.end_date >= ${use(a)}::date`);
  if (b) where.push(`r.start_date <= ${use(b)}::date`);
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT * FROM (${includeArchived ? PTO_EVERYTHING : PTO_LIVE}) r ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY r.start_date DESC, r.created_at DESC LIMIT ${use(max + 1)}`, params
  );
  return { requests: r.rows.slice(0, max).map((row) => ({ ...mapPto(row), archived: Boolean(row.archived_at), archivedAt: iso(row.archived_at) })), truncated: r.rows.length > max };
}

export async function listRecentPtoDecisions({ approverEmail = "", all = false, days = 45 } = {}) {
  const pool = await getReadyPool();
  const r = all
    ? await pool.query(`SELECT * FROM pto_requests WHERE status <> 'pending' AND COALESCE(decided_at, cancelled_at) > NOW() - ($1 || ' days')::interval ORDER BY COALESCE(decided_at, cancelled_at) DESC LIMIT 200`, [String(days)])
    : await pool.query(`SELECT * FROM pto_requests WHERE status <> 'pending' AND approver_email = $2 AND $2 <> '' AND COALESCE(decided_at, cancelled_at) > NOW() - ($1 || ' days')::interval ORDER BY COALESCE(decided_at, cancelled_at) DESC LIMIT 200`, [String(days), text(approverEmail, 200).toLowerCase()]);
  return r.rows.map(mapPto);
}
// Approved time off overlapping [from, to] - for the who's-out calendar.
export async function listApprovedPtoBetween(from, to) {
  const a = parseDay(from), b = parseDay(to);
  if (!a || !b || b < a) throw new Error("Pick a valid date range.");
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM pto_requests WHERE status = 'approved' AND start_date <= $2::date AND end_date >= $1::date ORDER BY start_date, employee_name`, [a, b]);
  return r.rows.map(mapPto);
}
// Only a pending request can be decided; the WHERE makes two approvers racing safe.
export async function decidePtoRequest(id, { approve, note = "", byEmail = "", byName = "" } = {}) {
  const why = longText(note, 600);
  if (!approve && why.length < 3) throw new Error("Add a short note so the employee knows why it was declined.");
  const pool = await getReadyPool();
  const r = await pool.query(
    `UPDATE pto_requests SET status = $2, decided_at = NOW(), decided_by_email = $3, decided_by_name = $4, decision_note = $5 WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, approve ? "approved" : "denied", text(byEmail, 200).toLowerCase(), text(byName, 120), why]
  );
  return r.rows[0] ? mapPto(r.rows[0]) : null;
}
export async function cancelPtoRequest(id, { reason = "", byName = "" } = {}) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `UPDATE pto_requests SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1 AND status IN ('pending','approved') RETURNING *`,
    [id, text(byName, 120), text(reason, 300)]
  );
  return r.rows[0] ? mapPto(r.rows[0]) : null;
}
// HR ticks these off as the request goes into (or comes back out of) Kronos.
export async function markPtoKronos(id, { action, byName = "" } = {}) {
  const pool = await getReadyPool();
  const who = text(byName, 120);
  const sql = action === "entered"
    ? `UPDATE pto_requests SET kronos_entered_at = NOW(), kronos_entered_by = $2 WHERE id = $1 AND status = 'approved' AND kronos_entered_at IS NULL RETURNING *`
    : action === "not_entered"
      ? `UPDATE pto_requests SET kronos_entered_at = NULL, kronos_entered_by = '' WHERE id = $1 AND status = 'approved' AND kronos_entered_at IS NOT NULL AND $2 = $2 RETURNING *`
      : action === "removed"
        ? `UPDATE pto_requests SET kronos_removed_at = NOW(), kronos_removed_by = $2 WHERE id = $1 AND status = 'cancelled' AND kronos_entered_at IS NOT NULL AND kronos_removed_at IS NULL RETURNING *`
        : null;
  if (!sql) throw new Error("Unknown Kronos action.");
  const r = await pool.query(sql, [id, who]);
  return r.rows[0] ? mapPto(r.rows[0]) : null;
}
// Per-employee counts for the profile list: upcoming approved days and pending requests.
export async function ptoCountsByEmployee(today = new Date().toISOString().slice(0, 10)) {
  const pool = await getReadyPool();
  const r = await pool.query(
    `SELECT employee_code, COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            MIN(start_date) FILTER (WHERE status = 'approved' AND end_date >= $1::date) AS next_out
       FROM pto_requests GROUP BY 1`, [today]
  );
  return new Map(r.rows.map((x) => [x.employee_code, { pending: x.pending, nextOut: isoDate(x.next_out) }]));
}

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
export const PTO_TYPES = ["Vacation", "Sick", "Personal", "Bereavement", "Jury duty", "Unpaid", "Other"];
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
// Working days and scheduled hours inside a date range. With no schedule on
// file the count falls back to Monday-Friday and hours are left unknown.
export function workSpan(schedule, start, end) {
  const known = hasSchedule(schedule);
  let days = 0, hours = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const key = WEEK_DAYS[(new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7];
    if (known) { const h = scheduledHours(schedule, key); if (h > 0) { days += 1; hours += h; } }
    else if (key !== "sat" && key !== "sun") days += 1;
  }
  return { workDays: days, scheduledHours: known ? Math.round(hours * 100) / 100 : null, fromSchedule: known };
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
function mapPto(row) {
  return {
    id: row.id, employeeCode: row.employee_code, employeeName: row.employee_name, employeeEmail: row.employee_email,
    type: row.type, startDate: isoDate(row.start_date), endDate: isoDate(row.end_date),
    hours: row.hours == null ? null : Number(row.hours), workDays: Number(row.work_days) || 0,
    // hours the regular schedule puts on those days (null when no schedule was on file) - what HR keys into Kronos
    scheduledHours: row.scheduled_hours == null ? null : Number(row.scheduled_hours), note: row.note || "",
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
export const publicPto = (r) => ({ id: r.id, employeeCode: r.employeeCode, employeeName: r.employeeName, startDate: r.startDate, endDate: r.endDate, partialDay: r.hours != null });

// `employee`: { code, name, email }. `approver`: { code, name, email } or null (HR decides).
// `schedule`: the employee's regular schedule, for the working-day count.
export async function createPtoRequest({ employee, type, startDate, endDate, hours = null, note = "", approver = null, schedule = {}, byEmail = "", byName = "", today = new Date().toISOString().slice(0, 10) }) {
  const code = codeOf(employee?.code);
  if (!code) throw new Error("We couldn't match you to an employee profile. Ask HR to check the email on your profile.");
  if (!PTO_TYPES.includes(type)) throw new Error("Choose the kind of time off from the list.");
  const start = parseDay(startDate), end = parseDay(endDate || startDate);
  if (!start || !end) throw new Error("Enter the first and last day you'll be out.");
  if (end < start) throw new Error("The last day can't be before the first day.");
  if ((dayMs(end) - dayMs(start)) / 86400000 > 60) throw new Error("A single request can cover up to 60 days. Split a longer absence into two requests.");
  if (start < addDays(today, -60)) throw new Error("That start date is more than 60 days ago. Ask HR to record it.");
  if (start > addDays(today, 550)) throw new Error("That is more than 18 months out.");
  let hrs = null;
  if (hours != null && String(hours).trim() !== "") {
    hrs = Math.round(Number(hours) * 100) / 100;
    if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) throw new Error("Hours for a partial day must be between 0.25 and 24.");
    if (start !== end) throw new Error("Partial-day hours only apply to a single day. For several days, leave hours blank.");
  }
  const span = workSpan(schedule, start, end);
  const pool = await getReadyPool();
  const clash = await pool.query(
    `SELECT start_date, end_date, status FROM pto_requests WHERE employee_code = $1 AND status IN ('pending','approved') AND start_date <= $3::date AND end_date >= $2::date LIMIT 1`,
    [code, start, end]
  );
  if (clash.rows[0]) throw new Error(`There is already a ${clash.rows[0].status} request covering ${isoDate(clash.rows[0].start_date)}${isoDate(clash.rows[0].end_date) !== isoDate(clash.rows[0].start_date) ? " to " + isoDate(clash.rows[0].end_date) : ""}. Cancel that one first, or pick other days.`);
  const r = await pool.query(
    `INSERT INTO pto_requests (employee_code, employee_name, employee_email, type, start_date, end_date, hours, work_days, note, approver_code, approver_name, approver_email, requested_by_email, requested_by_name, scheduled_hours)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [code, text(employee.name, 120), text(employee.email, 200).toLowerCase(), type, start, end, hrs, hrs != null ? 0.5 : span.workDays, longText(note, 600),
      codeOf(approver?.code), text(approver?.name, 120), text(approver?.email, 200).toLowerCase(), text(byEmail, 200).toLowerCase(), text(byName, 120), hrs != null ? null : span.scheduledHours]
  );
  return mapPto(r.rows[0]);
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

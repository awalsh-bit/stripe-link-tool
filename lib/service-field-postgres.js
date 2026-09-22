import { boardInternals, setJobStatus, runStatusRules } from "./service-journey-postgres.js";

// ---------------------------------------------------------------------------
// TECH FIELD TOOL (service-field.html, Client Care) — Andrew, 2026-09-22 late:
// "we need to get the tech's field tool going" once the AJH pilot and the
// prototypes were removed. Runs on the real mirror (sj_jobs): the tech's day
// is what the dispatch board placed, in stop order; every outcome is a
// status change through setJobStatus (reason tech_update, packet queued for
// ePASS) and the findings — outcome, notes, parts the tech wants, labor —
// are kept in sj_field_findings for the office's Parts Verify step.
//
// Outcomes (blueprint §5.2 / doc 21):
//   diagnostic (SO1)  onsite → SO8 (fixed within the diag hour)
//                     parts  → SO2 (quote needed; parts lines go to Parts Verify)
//                     declined / replace → SO7
//                     research → stays SO1, note only
//                     access → stays SO1, note only (could not get in)
//   install (SO4PRE/SO5/SO6) complete → SO8 · moreparts → SO2 · partissue → SO3
//                     (wrong / damaged part, reorder) · notfixed → SO1
// Parts Verify (Service Office Queues): SO2 with the tech's lines → Kezia
// confirms price / availability per line → SO2.1 (parts_verified). Noell
// builds the customer estimate from there in Service Estimate Approvals.
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
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS field_enroute_at TIMESTAMPTZ;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS field_arrived_at TIMESTAMPTZ;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS field_done_at TIMESTAMPTZ;
`;
let ensured = null;
async function pool() { const p = await getReadyPool(); if (!ensured) ensured = p.query(SCHEMA_SQL).catch((e) => { ensured = null; throw e; }); await ensured; return p; }

const dateStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : "");
const INSTALL = new Set(["SO4PRE", "SO5", "SO6"]);
export const OUTCOMES = {
  diagnostic: { onsite: "SO8", parts: "SO2", declined: "SO7", replace: "SO7", research: null, access: null },
  install: { complete: "SO8", moreparts: "SO2", partissue: "SO3", notfixed: "SO1" }
};

function mapStop(j) {
  const kind = INSTALL.has(String(j.status || "")) ? "install" : "diagnostic";
  return {
    sv: j.sv_number, seq: j.stop_seq == null ? 0 : Number(j.stop_seq), status: j.status, kind, window: j.time_window || "",
    customer: j.customer_name || "", phone: j.phone || "", phoneAlt: j.phone_alt || "", email: j.email || "",
    address: [j.address1, j.address2].filter(Boolean).join(", "), city: j.city || "", zip: String(j.zip || "").slice(0, 5), lat: j.lat, lng: j.lng,
    access: j.access_notes || "", unit: { category: j.unit_category || "", brand: j.unit_brand || "", model: j.unit_model || "", serial: j.unit_serial || "" },
    problem: j.problem_text || "", units: Number(j.units) || 1, minutes: j.est_minutes != null ? Number(j.est_minutes) : null,
    balance: Number(j.balance) || 0, paymentType: j.payment_type || "", warranty: !!j.is_warranty, note: j.dispatch_note || "", partsNote: j.parts_note || "",
    enrouteAt: j.field_enroute_at ? new Date(j.field_enroute_at).toISOString() : null, arrivedAt: j.field_arrived_at ? new Date(j.field_arrived_at).toISOString() : null, doneAt: j.field_done_at ? new Date(j.field_done_at).toISOString() : null,
    closed: !!j.closed_at
  };
}

// The tech's day, in the board's stop order (closed stops stay listed so the
// tech sees what he already finished).
export async function getFieldRoute({ tech, date }) {
  const p = await pool();
  const t = String(tech || "").trim().toUpperCase();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const rows = (await p.query(
    `SELECT * FROM sj_jobs WHERE assigned_tech = $1 AND route_date = $2 AND NOT (in_feed = FALSE AND source = 'import' AND closed_at IS NOT NULL)
      ORDER BY stop_seq NULLS LAST, sv_number`, [t, d])).rows;
  const techRow = (await p.query(`SELECT sp_code, name FROM sj_techs WHERE sp_code = $1`, [t])).rows[0];
  const findings = (await p.query(`SELECT DISTINCT ON (sv_number) sv_number, outcome, created_at FROM sj_field_findings WHERE sv_number = ANY($1) ORDER BY sv_number, id DESC`, [rows.map((r) => r.sv_number)])).rows;
  const fBy = new Map(findings.map((f) => [f.sv_number, f]));
  return { tech: t, techName: techRow?.name || t, date: d, stops: rows.map((j) => ({ ...mapStop(j), lastOutcome: fBy.get(j.sv_number)?.outcome || "" })) };
}

export async function markEnroute({ sv, by = "" }) {
  const p = await pool(); const code = String(sv || "").trim().toUpperCase();
  await p.query(`UPDATE sj_jobs SET field_enroute_at = NOW(), updated_at = NOW() WHERE sv_number = $1`, [code]);
  await addHistory(p, { sv: code, from: null, to: (await getJobRow(p, code))?.status || "", actorType: "tech", actorId: by, trigger: "field.enroute", note: "on my way" });
  return { ok: true, at: new Date().toISOString() };
}
export async function markArrived({ sv, by = "" }) {
  const p = await pool(); const code = String(sv || "").trim().toUpperCase();
  await p.query(`UPDATE sj_jobs SET field_arrived_at = NOW(), updated_at = NOW() WHERE sv_number = $1`, [code]);
  await addHistory(p, { sv: code, from: null, to: (await getJobRow(p, code))?.status || "", actorType: "tech", actorId: by, trigger: "field.arrived", note: "arrived" });
  return { ok: true, at: new Date().toISOString() };
}

const cleanParts = (parts) => (Array.isArray(parts) ? parts : []).map((l) => ({
  part: String(l?.part || "").trim().slice(0, 60), desc: String(l?.desc || "").trim().slice(0, 160), qty: Math.max(1, Math.min(99, Math.round(Number(l?.qty) || 1))),
  price: l?.price === "" || l?.price == null ? null : Math.round(Number(l.price) * 100) / 100, availability: String(l?.availability || "").trim().slice(0, 60)
})).filter((l) => l.part || l.desc).slice(0, 30);

// The tech's outcome for a stop: findings recorded, status moved (packet
// queued), the status rules run, and the on-site clock closed.
export async function submitOutcome({ sv, tech = "", outcome, findings = "", parts = [], laborNote = "", by = "", byName = "" }) {
  const p = await pool(); const code = String(sv || "").trim().toUpperCase();
  const job = await getJobRow(p, code);
  if (!job) throw new Error("Job not found.");
  const kind = INSTALL.has(String(job.status || "")) ? "install" : "diagnostic";
  const table = OUTCOMES[kind];
  if (!(outcome in table)) throw new Error(`Outcome must be one of ${Object.keys(table).join(", ")} for a ${kind}.`);
  const target = table[outcome];
  const lines = cleanParts(parts);
  if (outcome === "parts" && !lines.length) throw new Error("List at least one part for a parts quote.");
  if (["research", "access", "declined", "replace", "partissue", "notfixed"].includes(outcome) && !String(findings || "").trim()) throw new Error("A note is required for this outcome.");
  const minutes = job.field_arrived_at ? Math.max(1, Math.round((Date.now() - new Date(job.field_arrived_at).getTime()) / 60000)) : null;
  const ins = await p.query(
    `INSERT INTO sj_field_findings (sv_number, tech_code, kind, outcome, status_before, status_after, findings, parts, labor_note, minutes_on_site, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) RETURNING id`,
    [code, String(tech || job.assigned_tech || "").toUpperCase(), kind, outcome, job.status || "", target || job.status || "", String(findings || "").slice(0, 4000), JSON.stringify(lines), String(laborNote || "").slice(0, 1000), minutes, by]);
  await p.query(`UPDATE sj_jobs SET field_done_at = NOW(), updated_at = NOW() WHERE sv_number = $1`, [code]);
  let result = null;
  if (target && target !== job.status) {
    const note = `${outcome}: ${String(findings || "").slice(0, 160)}`.trim();
    result = await setJobStatus(code, { status: target, reasonCode: "tech_update", note, byEmail: by, byName });
    try { await runStatusRules(code, { from: job.status, byEmail: by }); } catch (err) { console.error("Field outcome rules failed:", err.message); }
  } else {
    await addHistory(p, { sv: code, from: job.status, to: job.status, actorType: "tech", actorId: by, trigger: "field.note", note: `${outcome}: ${String(findings || "").slice(0, 300)}` });
  }
  return { ok: true, findingId: Number(ins.rows[0].id), status: target || job.status, minutesOnSite: minutes, syncId: result?.syncId || null };
}

// Parts Verify queue: every SO2 with the tech's latest parts lines.
export async function listVerifyQueue() {
  const p = await pool();
  const rows = (await p.query(
    `SELECT j.sv_number, j.status, j.status_changed_at, j.customer_name, j.phone, j.address1, j.city, j.zip, j.unit_brand, j.unit_category, j.unit_model, j.unit_serial, j.problem_text, j.is_warranty, j.owner_tech, j.assigned_tech,
            t.name AS tech_name, f.id AS finding_id, f.outcome, f.findings, f.parts, f.labor_note, f.minutes_on_site, f.created_at AS found_at, f.tech_code
       FROM sj_jobs j
       LEFT JOIN LATERAL (SELECT * FROM sj_field_findings x WHERE x.sv_number = j.sv_number ORDER BY x.id DESC LIMIT 1) f ON TRUE
       LEFT JOIN sj_techs t ON t.sp_code = COALESCE(NULLIF(f.tech_code, ''), j.owner_tech, j.assigned_tech)
      WHERE j.closed_at IS NULL AND j.status IN ('SO2') AND NOT (j.in_feed = FALSE AND j.source = 'import')
      ORDER BY j.status_changed_at, j.sv_number`)).rows;
  return rows.map((r) => ({
    sv: r.sv_number, st: r.status, since: r.status_changed_at ? new Date(r.status_changed_at).toISOString() : null,
    cust: r.customer_name || "", phone: r.phone || "", addr: [r.address1, r.city].filter(Boolean).join(", "), zip: String(r.zip || "").slice(0, 5),
    unit: [r.unit_brand, r.unit_category, r.unit_model].filter(Boolean).join(" "), serial: r.unit_serial || "", problem: r.problem_text || "", wty: !!r.is_warranty,
    tech: r.tech_code || r.owner_tech || r.assigned_tech || "", techName: r.tech_name || "",
    finding: r.finding_id ? { id: Number(r.finding_id), outcome: r.outcome, findings: r.findings || "", parts: Array.isArray(r.parts) ? r.parts : [], laborNote: r.labor_note || "", minutes: r.minutes_on_site, at: r.found_at ? new Date(r.found_at).toISOString() : null } : null
  }));
}

// Kezia's verification: the lines with prices/availability are stored on the
// finding, the ticket moves to SO2.1 (packet queued), Noell takes it from there.
export async function verifyParts({ sv, lines = [], note = "", by = "", byName = "" }) {
  const p = await pool(); const code = String(sv || "").trim().toUpperCase();
  const job = await getJobRow(p, code);
  if (!job) throw new Error("Job not found.");
  if (job.status !== "SO2") throw new Error(`Ticket is ${job.status}, not SO2.`);
  const clean = cleanParts(lines);
  if (!clean.length) throw new Error("Keep at least one part line.");
  const f = (await p.query(`SELECT id FROM sj_field_findings WHERE sv_number = $1 ORDER BY id DESC LIMIT 1`, [code])).rows[0];
  if (f) await p.query(`UPDATE sj_field_findings SET verified_at = NOW(), verified_by = $2, verified_parts = $3::jsonb, verify_note = $4 WHERE id = $1`, [f.id, by, JSON.stringify(clean), String(note || "").slice(0, 1000)]);
  else await p.query(`INSERT INTO sj_field_findings (sv_number, tech_code, kind, outcome, status_before, status_after, parts, verified_at, verified_by, verified_parts, verify_note, created_by) VALUES ($1,$2,'diagnostic','parts','SO2','SO2.1',$3::jsonb,NOW(),$4,$3::jsonb,$5,$4)`, [code, job.owner_tech || job.assigned_tech || "", JSON.stringify(clean), by, String(note || "").slice(0, 1000)]);
  const total = clean.reduce((a, l) => a + (l.price || 0) * l.qty, 0);
  const r = await setJobStatus(code, { status: "SO2.1", reasonCode: "parts_verified", note: `${clean.length} part line${clean.length === 1 ? "" : "s"} verified${total ? ` · parts ${total.toFixed(2)}` : ""}${note ? " · " + String(note).slice(0, 120) : ""}`, byEmail: by, byName });
  return { ok: true, status: "SO2.1", lines: clean, partsTotal: Math.round(total * 100) / 100, syncId: r.syncId };
}

export async function getFindingsForSv(sv) {
  const p = await pool();
  return (await p.query(`SELECT * FROM sj_field_findings WHERE sv_number = $1 ORDER BY id DESC LIMIT 20`, [String(sv || "").trim().toUpperCase()])).rows.map((f) => ({
    id: Number(f.id), tech: f.tech_code, kind: f.kind, outcome: f.outcome, from: f.status_before, to: f.status_after, findings: f.findings, parts: f.parts || [], laborNote: f.labor_note, minutes: f.minutes_on_site,
    verifiedAt: f.verified_at ? new Date(f.verified_at).toISOString() : null, verifiedBy: f.verified_by, verifiedParts: f.verified_parts, verifyNote: f.verify_note, by: f.created_by, at: new Date(f.created_at).toISOString()
  }));
}
export { mapJob };

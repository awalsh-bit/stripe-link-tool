import { getSettings, setSetting } from "./service-journey-postgres.js";
import { listEmployeeDirectory } from "./employee-directory.js";

// ---------------------------------------------------------------------------
// SERVICE ROLES — who gets what, by JOB CODE, never by person.
//
// Andrew, 2026-09-23 (hard rule): "make sure the code is flexible based on a
// quick swap to a job code instead of a specific person — I'm building this
// to scale beyond individuals."
//
// Every notification, gate and piece of copy in the service journey that
// used to say "Noell", "Kezia" or "Mark" now names a ROLE. A role resolves
// to people through the employee directory: the job title code on their
// directory row (User Admin → Job titles & codes; the permanent E10 / NE20
// style key, not the label). Swapping the person is a directory edit;
// adding a second estimator is a second person on the same code.
//
//   roles.<role>.job_codes   ["E31", "NE22"]   ← the rule
//   roles.<role>.emails      ["x@…"]           ← explicit extras / fallback
//                                                 (a person who holds the
//                                                 role without the title yet)
//
// Legacy person-keyed settings (notify.warranty_so3.emails,
// notify.model_flags.emails) are still read as the role's `emails` so
// nothing goes quiet on deploy; they should be emptied once the job codes
// are set. Nothing in this file, or in anything that calls it, may name an
// individual.
// ---------------------------------------------------------------------------

export const ROLES = {
  service_manager: { label: "Service manager", does: "gets model flags from the techs and publishes bulletins; can review anything in the office queues" },
  service_estimator: { label: "Service estimator", does: "builds customer estimates; gets the warranty SO3 flag so the ePASS ticket is updated" },
  parts_buyer: { label: "Parts buyer", does: "Parts Verify and parts ETAs on Service Office Queues" },
  warranty_admin: { label: "Warranty admin", does: "warranty claims and flat rates" },
  dispatcher: { label: "Dispatcher", does: "the dispatch board" },
  field_tech: { label: "Field technician", does: "the field tool first on their dashboard (a directory code on the tech roster counts too)" }
};
const LEGACY_EMAIL_SETTINGS = { service_estimator: "notify.warranty_so3.emails", service_manager: "notify.model_flags.emails" };
const norm = (e) => String(e || "").trim().toLowerCase();
const codes = (v) => (Array.isArray(v) ? v : []).map((c) => String(c || "").trim().toUpperCase()).filter(Boolean);

// The people behind a role right now: job-code holders from the directory
// (not archived) plus any explicit emails.
export async function resolveRole(role, { settings = null, directory = null } = {}) {
  if (!ROLES[role]) throw new Error(`Unknown role "${role}".`);
  const S = settings || await getSettings();
  const jobCodes = codes(S[`roles.${role}.job_codes`]);
  const explicit = [...(Array.isArray(S[`roles.${role}.emails`]) ? S[`roles.${role}.emails`] : []), ...(LEGACY_EMAIL_SETTINGS[role] && Array.isArray(S[LEGACY_EMAIL_SETTINGS[role]]) ? S[LEGACY_EMAIL_SETTINGS[role]] : [])].map(norm).filter(Boolean);
  const dir = directory || await listEmployeeDirectory().catch(() => []);
  const people = dir.filter((p) => !p.archived && p.jobTitleCode && jobCodes.includes(String(p.jobTitleCode).toUpperCase())).map((p) => ({ code: p.code, name: p.name, email: norm(p.email), jobTitleCode: p.jobTitleCode }));
  const emails = [...new Set([...people.map((p) => p.email).filter(Boolean), ...explicit])];
  return { role, label: ROLES[role].label, jobCodes, people, explicit, emails };
}
export async function roleEmails(role, opts) { return (await resolveRole(role, opts)).emails; }
// Does this login hold the role? (job code on their directory row, or an
// explicit email.) Executives are decided by the caller, not here.
export async function hasRole(email, role, opts) {
  const e = norm(email); if (!e) return false;
  const r = await resolveRole(role, opts);
  return r.emails.includes(e);
}
// Every role at once, for the settings page.
export async function listRoles() {
  const S = await getSettings(); const dir = await listEmployeeDirectory().catch(() => []);
  const out = [];
  for (const key of Object.keys(ROLES)) out.push({ ...(await resolveRole(key, { settings: S, directory: dir })), does: ROLES[key].does, legacySetting: LEGACY_EMAIL_SETTINGS[key] || "" });
  return out;
}
export async function setRole(role, { jobCodes = null, emails = null } = {}) {
  if (!ROLES[role]) throw new Error(`Unknown role "${role}".`);
  if (jobCodes != null) await setSetting(`roles.${role}.job_codes`, codes(jobCodes));
  if (emails != null) await setSetting(`roles.${role}.emails`, (Array.isArray(emails) ? emails : []).map(norm).filter(Boolean));
  return resolveRole(role);
}

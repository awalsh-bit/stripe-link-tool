import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Employee directory (codes used on payment tools), stored in Postgres and
// editable from User Admin. Serves /employee-directory.js dynamically; the
// static employee-directory.js file in the repo root is the fallback when
// the database is unreachable.
//
// Entries are tied to app_users accounts by EMAIL — keep directory emails in
// sync with account emails so auto-fill and "my view" defaults work.
// ---------------------------------------------------------------------------

const EMPLOYEE_DIRECTORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS employee_directory (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS commute_miles NUMERIC(7,1) NOT NULL DEFAULT 0;
ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS commission_plan TEXT NOT NULL DEFAULT '';

-- Executive-editable vocabularies (User Admin "Job titles & codes" editor).
-- job_titles doubles as the commission-plan selector AND notification
-- routing (notify_web_orders drives the web-order flags + claim emails).
-- job_codes are the quick-assign permission presets in the permission editor.
CREATE TABLE IF NOT EXISTS job_titles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  notify_web_orders BOOLEAN NOT NULL DEFAULT FALSE,
  sort INT NOT NULL DEFAULT 0
);

-- The JOB CODE: a permanent HR-style classification key (E10, NE20 —
-- exempt/non-exempt + level, numeric room for sub-codes). Executive-typed,
-- immutable once set; the title NAME is just its relabelable display label.
-- Data links on the code, so relabeling never breaks anything.
ALTER TABLE job_titles ADD COLUMN IF NOT EXISTS code TEXT UNIQUE;

-- Which PAY PLAN a title is paid under (Andrew, 2026-09-16). The title is
-- the person's job (Showroom Sales Manager, E50); the plan is how their
-- commission is computed (Showroom Consultant plan). Before this, the
-- title name WAS the plan, so any new title silently fell off every
-- statement. '' = not commissioned. Backfilled below: the built-in titles
-- pay under themselves.
ALTER TABLE job_titles ADD COLUMN IF NOT EXISTS commission_plan TEXT NOT NULL DEFAULT '';

-- Directory rows carry the stable code alongside the display label.
ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS job_title_code TEXT NOT NULL DEFAULT '';

-- The quick-assign permission presets were briefly (mis)named job_codes —
-- rename in place, keeping any rows an early deploy created.
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'job_codes')
     AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'permission_groups') THEN
    ALTER TABLE job_codes RENAME TO permission_groups;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS permission_groups (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  pages JSONB NOT NULL DEFAULT '[]',
  sort INT NOT NULL DEFAULT 0
);

-- Departments: same pattern as job titles — a permanent short code data
-- links on, plus a relabelable display name. Renames migrate directory
-- holders; historical records (payment links etc.) keep the label they
-- were written with.
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  sort INT NOT NULL DEFAULT 0
);

ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS department_code TEXT NOT NULL DEFAULT '';
-- Former employees: archived entries leave the Team list and every tool that
-- keys on directory titles (e.g. Quote Follow-Up), but the row — and every
-- payment/commission record keyed on its code — is kept forever.
ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

-- Uniform sizes (HR uniform ordering, Andrew 2026-08-28). Shirt comes from
-- the SHIRT_SIZES vocabulary below; shoe is free text ("10.5", "W 8",
-- "11 wide"). Blank = not collected yet.
ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS shirt_size TEXT NOT NULL DEFAULT '';
ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS shoe_size TEXT NOT NULL DEFAULT '';

-- Profile dates (Andrew, 2026-09-15): hire date and birthday come from the
-- PEO records (User Admin / import); the person can enter or fix their own
-- birthday from Edit My Profile. Both drive the daily celebration flags on
-- everyone's dashboard. NULL = not on file.
ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE employee_directory ADD COLUMN IF NOT EXISTS birthday DATE;

`;

// Shirt-size vocabulary — standard cuts plus tall variants. The User Admin
// editor, the dashboard self-serve prompt, and the server validator all use
// exactly this list (blank allowed = not set).
export const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "LT", "XLT", "2XLT", "3XLT"];

// Commission plans an employee can be assigned to. Empty ('') means none
// (e.g. accounting/office staff). The User Admin dropdown offers exactly these;
// the server validates against the same list.
export const COMMISSION_PLANS = [
  "Showroom Consultant",
  "Field Sales Consultant",
  "Kitchen Designer",
  "Repair Technician",
  "HVAC Selling Technician",
  "HVAC Installer"
];

// Seeded ONLY when the table is empty (fresh install / first boot after this
// feature ships). After that, the database is the source of truth and edits
// happen in User Admin.
const SEED_DIRECTORY = {
  EHM: { name: "Elliott Mullen", email: "emullen@wilsonappliance.com", department: "Appliance" },
  SPR: { name: "Shaun Ray", email: "sray@wilsonappliance.com", department: "Appliance" },
  AMW: { name: "Andrew Walsh", email: "awalsh@wilsonappliance.com", department: "Client Care" },
  CDM: { name: "Cayden Mayfield", email: "cmayfield@wilsonappliance.com", department: "Client Care" },
  CSH: { name: "Christian Houde", email: "choude@wilsonappliance.com", department: "Appliance" },
  LTC: { name: "Logan Carter", email: "lcarter@wilsonappliance.com", department: "Appliance" },
  TAB: { name: "Terra Bourguignon", email: "tbourguignon@wilsonappliance.com", department: "Appliance" },
  JKO: { name: "Jack Ort", email: "jort@wilsonappliance.com", department: "Client Care" },
  WKE: { name: "Will Echols", email: "wechols@wilsonappliance.com", department: "Client Care" },
  "27": { name: "Trey Wilson", email: "twilson@wilsonappliance.com", department: "Client Care" },
  MAM: { name: "Matt Mocniak", email: "mmocniak@wilsonappliance.com", department: "Appliance" },
  MEP: { name: "Marrissa Perks", email: "mperks@wilsonappliance.com", department: "Appliance" },
  NFC: { name: "Noell Polansky", email: "ncautrell@wilsonappliance.com", department: "Repair Service" },
  CBS: { name: "Chris Shanahan", email: "cshanahan@wilsonappliance.com", department: "Kitchen Design" },
  CAM: { name: "Carol Margos", email: "cmargos@wilsonappliance.com", department: "Kitchen Design" },
  PNT: { name: "Paige Thurgood", email: "pthurgood@wilsonappliance.com", department: "Client Care" },
  ELB: { name: "Erica Bolt", email: "ebolt@wilsonappliance.com", department: "Client Care" },
  RDW: { name: "Ray Wilder", email: "rwilder@wilsonappliance.com", department: "Appliance" },
  MSD: { name: "Michael Davidson", email: "mdavidson@wilsonappliance.com", department: "Repair Service" },
  SAD: { name: "Shelly Doublet", email: "sdoublet@wilsonappliance.com", department: "Appliance" },
  MJI: { name: "Mitchell Irlbeck", email: "mirlbeck@wilsonappliance.com", department: "HVAC Sales" },
  VWJ: { name: "Vince Jones", email: "vjones@wilsonappliance.com", department: "HVAC Sales" },
  TLS: { name: "Tracy Swan", email: "tswan@wilsonappliance.com", department: "Client Care" }
};

// Legacy fixed department vocabulary — seeds the departments table once.
export const SEED_DEPARTMENTS = ["Appliance", "Client Care", "Repair Service", "Kitchen Design", "HVAC Sales"];

// Seed data for the job vocabularies, injected by server.js at boot (the
// legacy hardcoded presets). Applied ONLY when the tables are empty — after
// that the database is the source of truth and edits happen in User Admin.
let jobCodeSeed = {};

export function setJobCodeSeed(seed) {
  jobCodeSeed = seed && typeof seed === "object" ? seed : {};
}

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(EMPLOYEE_DIRECTORY_SCHEMA_SQL);

      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM employee_directory`
      );

      if (!rows[0].count) {
        for (const [code, info] of Object.entries(SEED_DIRECTORY)) {
          await pool.query(
            `INSERT INTO employee_directory (code, name, email, department)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (code) DO NOTHING`,
            [code, info.name, info.email, info.department]
          );
        }
      }

      const titles = await pool.query(`SELECT COUNT(*)::int AS count FROM job_titles`);
      if (!titles.rows[0].count) {
        for (let i = 0; i < COMMISSION_PLANS.length; i++) {
          await pool.query(
            `INSERT INTO job_titles (name, notify_web_orders, sort)
             VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
            [COMMISSION_PLANS[i], COMMISSION_PLANS[i] === "Showroom Consultant", i]
          );
        }
      }

      // Titles that are themselves a plan name pay under that plan.
      // One-time backfill: only while no title has a plan yet, so an
      // executive's explicit "not commissioned" on a built-in title sticks.
      await pool.query(
        `UPDATE job_titles SET commission_plan = name
          WHERE commission_plan = '' AND name = ANY($1::text[])
            AND NOT EXISTS (SELECT 1 FROM job_titles WHERE commission_plan <> '')`,
        [COMMISSION_PLANS]
      );

      const departments = await pool.query(`SELECT COUNT(*)::int AS count FROM departments`);
      if (!departments.rows[0].count) {
        for (let i = 0; i < SEED_DEPARTMENTS.length; i++) {
          await pool.query(
            `INSERT INTO departments (name, sort) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
            [SEED_DEPARTMENTS[i], i]
          );
        }
      }

      const groups = await pool.query(`SELECT COUNT(*)::int AS count FROM permission_groups`);
      if (!groups.rows[0].count && Object.keys(jobCodeSeed).length) {
        let i = 0;
        for (const [key, preset] of Object.entries(jobCodeSeed)) {
          await pool.query(
            `INSERT INTO permission_groups (key, label, pages, sort)
             VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
            [key, preset.label || key, JSON.stringify(preset.pages || []), i++]
          );
        }
      }
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }

  await ensurePromise;
  return pool;
}

export function normalizeEmployeeCode(code) {
  return String(code || "").trim().toUpperCase();
}

export function validateEmployeeCode(code) {
  const normalized = normalizeEmployeeCode(code);
  if (!normalized) return "An employee code is required.";
  // The payment pages cap the code field at 3 characters.
  if (!/^[A-Z0-9]{1,3}$/.test(normalized)) {
    return "Codes are 1-3 letters/numbers (the payment tools cap the field at 3).";
  }
  return null;
}

function toIsoDate(v) {
  if (!v) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}
// Accepts "YYYY-MM-DD" (or "" to clear). Anything else is rejected by the caller.
export function normalizeProfileDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : undefined;
}

function mapDirectoryRow(row) {
  return {
    code: row.code,
    name: row.name,
    email: row.email || "",
    department: row.department || "",
    commuteMiles: Number(row.commute_miles) || 0,
    commissionPlan: row.commission_plan || "",
    jobTitleCode: row.job_title_code || "",
    departmentCode: row.department_code || "",
    shirtSize: row.shirt_size || "",
    shoeSize: row.shoe_size || "",
    hireDate: toIsoDate(row.hire_date),
    birthday: toIsoDate(row.birthday),
    archived: Boolean(row.archived),
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null
  };
}

// Archive / restore a directory entry (former employees). The row is kept —
// payment and commission records link on the code — it just leaves the Team
// list and the title-driven tools.
export async function setEmployeeDirectoryArchived(code, archived) {
  const normalized = normalizeEmployeeCode(code);
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE employee_directory SET archived = $2, updated_at = NOW() WHERE code = $1 RETURNING code`,
    [normalized, Boolean(archived)]
  );
  return result.rowCount > 0;
}

export async function listEmployeeDirectory() {
  const pool = await getReadyPool();
  const [result, titles] = await Promise.all([
    pool.query(`SELECT * FROM employee_directory ORDER BY name ASC`),
    pool.query(`SELECT name, commission_plan FROM job_titles`)
  ]);
  const titleList = titles.rows.map((t) => ({ name: t.name, commissionPlan: t.commission_plan || "" }));
  return result.rows.map((row) => {
    const entry = mapDirectoryRow(row);
    // commissionPlan = the person's TITLE (historical column name);
    // payPlan = the plan that title is paid under — what the commission
    // engine and the statements page key on.
    entry.payPlan = payPlanFor(entry.commissionPlan, titleList);
    return entry;
  });
}

// Shape consumed by the pages: { CODE: { name, email, department } }
export async function getEmployeeDirectoryObject() {
  const entries = await listEmployeeDirectory();
  const directory = {};
  for (const entry of entries) {
    directory[entry.code] = {
      name: entry.name,
      email: entry.email,
      department: entry.department
    };
  }
  return directory;
}

export async function findEmployeeDirectoryEntryByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;

  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM employee_directory WHERE LOWER(email) = $1 LIMIT 1`,
    [normalized]
  );
  return result.rows[0] ? mapDirectoryRow(result.rows[0]) : null;
}

// shirtSize / shoeSize: pass a string (possibly "") to set, or null/undefined
// to LEAVE THE STORED VALUE ALONE — so callers that don't know about sizes
// can never wipe what an employee self-served from their dashboard.
// hireDate / birthday follow the same rule: null = leave alone, "" = clear.
export async function upsertEmployeeDirectoryEntry({ code, name, email, department, commuteMiles = 0, commissionPlan = "", shirtSize = null, shoeSize = null, hireDate = null, birthday = null }, actorUserId = null) {
  const normalizedCode = normalizeEmployeeCode(code);
  const pool = await getReadyPool();

  // Stable keys ride along with the (relabelable) labels so data can link
  // on codes even after future relabels.
  const plan = String(commissionPlan || "").trim();
  let jobTitleCode = "";
  if (plan) {
    const titleRow = await pool.query(`SELECT code FROM job_titles WHERE name = $1`, [plan]);
    jobTitleCode = titleRow.rows[0]?.code || "";
  }
  const dept = String(department || "").trim();
  let departmentCode = "";
  if (dept) {
    const deptRow = await pool.query(`SELECT code FROM departments WHERE LOWER(name) = LOWER($1)`, [dept]);
    departmentCode = deptRow.rows[0]?.code || "";
  }

  const result = await pool.query(
    `INSERT INTO employee_directory (code, name, email, department, commute_miles, commission_plan, job_title_code, department_code, shirt_size, shoe_size, hire_date, birthday, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($10, ''), COALESCE($11, ''), NULLIF($12::text, '')::date, NULLIF($13::text, '')::date, NOW(), $9)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       department = EXCLUDED.department,
       commute_miles = EXCLUDED.commute_miles,
       commission_plan = EXCLUDED.commission_plan,
       job_title_code = EXCLUDED.job_title_code,
       department_code = EXCLUDED.department_code,
       shirt_size = COALESCE($10, employee_directory.shirt_size),
       shoe_size = COALESCE($11, employee_directory.shoe_size),
       hire_date = CASE WHEN $12::text IS NULL THEN employee_directory.hire_date ELSE NULLIF($12::text, '')::date END,
       birthday = CASE WHEN $13::text IS NULL THEN employee_directory.birthday ELSE NULLIF($13::text, '')::date END,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [
      normalizedCode,
      String(name || "").trim(),
      String(email || "").trim().toLowerCase(),
      dept,
      Math.max(Number(commuteMiles) || 0, 0),
      plan,
      jobTitleCode,
      departmentCode,
      actorUserId,
      shirtSize == null ? null : String(shirtSize).trim(),
      shoeSize == null ? null : String(shoeSize).trim(),
      hireDate == null ? null : String(hireDate),
      birthday == null ? null : String(birthday)
    ]
  );
  return mapDirectoryRow(result.rows[0]);
}

// Self-serve profile (Edit My Profile in Personal Settings): the person
// edits their own sizes, commute and birthday. Hire date is HR's (PEO).
// null = leave alone for every field.
export async function updateEmployeeProfileByEmail(email, { shirtSize = null, shoeSize = null, commuteMiles = null, birthday = null } = {}) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE employee_directory SET
       shirt_size = COALESCE($2, shirt_size),
       shoe_size = COALESCE($3, shoe_size),
       commute_miles = COALESCE($4::numeric, commute_miles),
       birthday = CASE WHEN $5::text IS NULL THEN birthday ELSE NULLIF($5::text, '')::date END,
       updated_at = NOW()
     WHERE LOWER(email) = $1
     RETURNING *`,
    [normalized, shirtSize == null ? null : String(shirtSize).trim(), shoeSize == null ? null : String(shoeSize).trim(), commuteMiles == null ? null : Math.max(Number(commuteMiles) || 0, 0), birthday == null ? null : String(birthday)]
  );
  return result.rows[0] ? mapDirectoryRow(result.rows[0]) : null;
}

// Today's birthdays and work anniversaries (active entries only). `today`
// is YYYY-MM-DD in the app time zone. Anniversaries start at one year.
export async function listCelebrations(today) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM employee_directory
      WHERE NOT archived
        AND ((birthday IS NOT NULL AND to_char(birthday, 'MM-DD') = to_char($1::date, 'MM-DD'))
          OR (hire_date IS NOT NULL AND to_char(hire_date, 'MM-DD') = to_char($1::date, 'MM-DD') AND hire_date < $1::date - INTERVAL '300 days'))`,
    [today]
  );
  const year = Number(String(today).slice(0, 4));
  const mmdd = String(today).slice(5, 10);
  const out = [];
  for (const row of result.rows) {
    const entry = mapDirectoryRow(row);
    if (entry.birthday && entry.birthday.slice(5) === mmdd) out.push({ kind: "birthday", entry });
    if (entry.hireDate && entry.hireDate.slice(5) === mmdd) {
      const years = year - Number(entry.hireDate.slice(0, 4));
      if (years >= 1) out.push({ kind: "anniversary", entry, years });
    }
  }
  return out;
}

// Self-serve: an employee sets THEIR OWN sizes from the dashboard prompt.
// Keyed by account email — touches only the two size columns.
export async function setEmployeeSizesByEmail(email, { shirtSize = null, shoeSize = null } = {}) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE employee_directory SET
       shirt_size = COALESCE($2, shirt_size),
       shoe_size = COALESCE($3, shoe_size),
       updated_at = NOW()
     WHERE LOWER(email) = $1
     RETURNING *`,
    [
      normalized,
      shirtSize == null ? null : String(shirtSize).trim(),
      shoeSize == null ? null : String(shoeSize).trim()
    ]
  );
  return result.rows[0] ? mapDirectoryRow(result.rows[0]) : null;
}

export async function deleteEmployeeDirectoryEntry(code) {
  const normalizedCode = normalizeEmployeeCode(code);
  const pool = await getReadyPool();
  const result = await pool.query(
    `DELETE FROM employee_directory WHERE code = $1 RETURNING code`,
    [normalizedCode]
  );
  return result.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Job titles — executive-editable. The title string on a directory entry IS
// the routing/commission key, so a rename MIGRATES every holder in the same
// step (the editor promises this), and deletion is blocked while in use.
// ---------------------------------------------------------------------------

function mapJobTitle(row) {
  return { id: row.id, name: row.name, code: row.code || "", notifyWebOrders: Boolean(row.notify_web_orders), commissionPlan: row.commission_plan || "" };
}

// '' (not commissioned) or one of COMMISSION_PLANS; anything else is an error.
export function normalizeTitlePlan(value) {
  const v = String(value || "").trim();
  if (!v) return { plan: "" };
  const hit = COMMISSION_PLANS.find((p) => p.toLowerCase() === v.toLowerCase());
  return hit ? { plan: hit } : { error: `Unknown commission plan "${v}". Choose one of: ${COMMISSION_PLANS.join(", ")} — or none.` };
}

// The plan a person is PAID under: their title's plan. Titles created
// before the column existed (or unassigned) fall back to the old rule —
// the title name itself when it is a plan name.
export function payPlanFor(titleName, titles) {
  const name = String(titleName || "").trim();
  if (!name) return "";
  const t = (titles || []).find((x) => String(x.name || "").toLowerCase() === name.toLowerCase());
  if (t) return t.commissionPlan || "";
  return COMMISSION_PLANS.includes(name) ? name : "";
}

// Job codes: 1-3 uppercase letters + 1-4 digits — E10, NE20, NE21...
// (Exempt / Non-exempt prefix + level, with numeric room for sub-codes.)
export function validateJobCodeFormat(code) {
  const trimmed = String(code || "").trim().toUpperCase();
  if (!trimmed) return { error: null, code: "" }; // unset is allowed (assign later)
  if (!/^[A-Z]{1,3}[0-9]{1,4}$/.test(trimmed)) {
    return { error: "Job codes are letters then a number — e.g. E10, NE20, NE21." };
  }
  return { error: null, code: trimmed };
}

export function validateJobTitleName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "A title name is required.";
  if (trimmed.length > 60) return "Titles are capped at 60 characters.";
  return null;
}

export async function listJobTitles() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM job_titles ORDER BY sort ASC, name ASC`);
  return result.rows.map(mapJobTitle);
}

// Title names that route web-order notifications (flags + claim emails).
export async function listNotifyTitleNames() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT name FROM job_titles WHERE notify_web_orders`);
  return result.rows.map((r) => r.name);
}

export async function countJobTitleHolders(name) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM employee_directory WHERE LOWER(commission_plan) = LOWER($1)`,
    [String(name || "").trim()]
  );
  return result.rows[0].count;
}

export async function createJobTitle({ name, code = "", notifyWebOrders = false, commissionPlan = "" }) {
  const trimmed = String(name || "").trim();
  const codeCheck = validateJobCodeFormat(code);
  if (codeCheck.error) return { ok: false, error: codeCheck.error };
  const planCheck = normalizeTitlePlan(commissionPlan);
  if (planCheck.error) return { ok: false, error: planCheck.error };
  const pool = await getReadyPool();
  const max = await pool.query(`SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM job_titles`);
  try {
    const result = await pool.query(
      `INSERT INTO job_titles (name, code, notify_web_orders, sort, commission_plan) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [trimmed, codeCheck.code || null, Boolean(notifyWebOrders), max.rows[0].next, planCheck.plan]
    );
    return { ok: true, title: mapJobTitle(result.rows[0]) };
  } catch (err) {
    if (err.code === "23505") {
      return { ok: false, error: String(err.constraint || "").includes("code") ? "That job code is already taken." : "That title already exists." };
    }
    throw err;
  }
}

export async function updateJobTitle({ id, name, code, notifyWebOrders, commissionPlan }) {
  const trimmed = String(name || "").trim();
  const pool = await getReadyPool();
  const existing = await pool.query(`SELECT * FROM job_titles WHERE id = $1`, [id]);
  if (!existing.rows[0]) return { ok: false, error: "Title not found." };
  // undefined = leave the plan alone (older callers); '' = not commissioned
  const planCheck = commissionPlan === undefined ? { plan: existing.rows[0].commission_plan || "" } : normalizeTitlePlan(commissionPlan);
  if (planCheck.error) return { ok: false, error: planCheck.error };
  const oldName = existing.rows[0].name;
  const existingCode = existing.rows[0].code || "";

  // The job code is the permanent linkage key: settable while empty,
  // IMMUTABLE once set (that permanence is the whole point).
  const codeCheck = validateJobCodeFormat(code);
  if (codeCheck.error) return { ok: false, error: codeCheck.error };
  const nextCode = codeCheck.code || "";
  if (existingCode && nextCode && nextCode !== existingCode) {
    return { ok: false, error: `The job code is permanent (${existingCode}) — data links on it. Create a new title if the classification changed.` };
  }
  const finalCode = existingCode || nextCode || null;

  try {
    const result = await pool.query(
      `UPDATE job_titles SET name = $2, code = $3, notify_web_orders = $4, commission_plan = $5 WHERE id = $1 RETURNING *`,
      [id, trimmed, finalCode, Boolean(notifyWebOrders), planCheck.plan]
    );
    // Rename migrates every holder so display labels stay in sync — the
    // stable code on their rows never changes.
    let migrated = 0;
    if (trimmed !== oldName) {
      const moved = await pool.query(
        `UPDATE employee_directory SET commission_plan = $2, updated_at = NOW()
         WHERE LOWER(commission_plan) = LOWER($1)`,
        [oldName, trimmed]
      );
      migrated = moved.rowCount;
    }
    // First-time code assignment backfills every current holder.
    if (!existingCode && finalCode) {
      await pool.query(
        `UPDATE employee_directory SET job_title_code = $2, updated_at = NOW()
         WHERE LOWER(commission_plan) = LOWER($1)`,
        [trimmed, finalCode]
      );
    }
    return { ok: true, title: mapJobTitle(result.rows[0]), migrated, oldName };
  } catch (err) {
    if (err.code === "23505") {
      return { ok: false, error: String(err.constraint || "").includes("code") ? "That job code is already taken." : "That title already exists." };
    }
    throw err;
  }
}

export async function deleteJobTitle(id) {
  const pool = await getReadyPool();
  const existing = await pool.query(`SELECT * FROM job_titles WHERE id = $1`, [id]);
  if (!existing.rows[0]) return { ok: false, error: "Title not found." };
  const holders = await countJobTitleHolders(existing.rows[0].name);
  if (holders > 0) {
    return { ok: false, inUse: holders, error: `${holders} teammate${holders === 1 ? "" : "s"} hold this title — reassign them first.` };
  }
  await pool.query(`DELETE FROM job_titles WHERE id = $1`, [id]);
  return { ok: true, name: existing.rows[0].name };
}

// ---------------------------------------------------------------------------
// Departments — permanent short code + relabelable name, mirroring job
// titles. Renames migrate directory holders' labels; the code never moves.
// Department codes: 1-6 letters/digits (APP, CC, HVAC...).
// ---------------------------------------------------------------------------

function mapDepartment(row) {
  return { id: row.id, name: row.name, code: row.code || "" };
}

export function validateDepartmentCodeFormat(code) {
  const trimmed = String(code || "").trim().toUpperCase();
  if (!trimmed) return { error: null, code: "" };
  if (!/^[A-Z][A-Z0-9]{0,5}$/.test(trimmed)) {
    return { error: "Department codes are 1-6 letters/digits starting with a letter — e.g. APP, CC, HVAC." };
  }
  return { error: null, code: trimmed };
}

export async function listDepartments() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM departments ORDER BY sort ASC, name ASC`);
  return result.rows.map(mapDepartment);
}

export async function countDepartmentMembers(name) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM employee_directory WHERE LOWER(department) = LOWER($1)`,
    [String(name || "").trim()]
  );
  return result.rows[0].count;
}

export async function createDepartment({ name, code = "" }) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return { ok: false, error: "A department name is required." };
  if (trimmed.length > 60) return { ok: false, error: "Department names are capped at 60 characters." };
  const codeCheck = validateDepartmentCodeFormat(code);
  if (codeCheck.error) return { ok: false, error: codeCheck.error };
  const pool = await getReadyPool();
  const max = await pool.query(`SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM departments`);
  try {
    const result = await pool.query(
      `INSERT INTO departments (name, code, sort) VALUES ($1, $2, $3) RETURNING *`,
      [trimmed, codeCheck.code || null, max.rows[0].next]
    );
    return { ok: true, department: mapDepartment(result.rows[0]) };
  } catch (err) {
    if (err.code === "23505") {
      return { ok: false, error: String(err.constraint || "").includes("code") ? "That department code is already taken." : "That department already exists." };
    }
    throw err;
  }
}

export async function updateDepartment({ id, name, code }) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return { ok: false, error: "A department name is required." };
  const pool = await getReadyPool();
  const existing = await pool.query(`SELECT * FROM departments WHERE id = $1`, [id]);
  if (!existing.rows[0]) return { ok: false, error: "Department not found." };
  const oldName = existing.rows[0].name;
  const existingCode = existing.rows[0].code || "";

  const codeCheck = validateDepartmentCodeFormat(code);
  if (codeCheck.error) return { ok: false, error: codeCheck.error };
  const nextCode = codeCheck.code || "";
  if (existingCode && nextCode && nextCode !== existingCode) {
    return { ok: false, error: `The department code is permanent (${existingCode}) — data links on it. Create a new department if the structure changed.` };
  }
  const finalCode = existingCode || nextCode || null;

  try {
    const result = await pool.query(
      `UPDATE departments SET name = $2, code = $3 WHERE id = $1 RETURNING *`,
      [id, trimmed, finalCode]
    );
    // Rename migrates every member's display label; codes never move.
    let migrated = 0;
    if (trimmed !== oldName) {
      const moved = await pool.query(
        `UPDATE employee_directory SET department = $2, updated_at = NOW()
         WHERE LOWER(department) = LOWER($1)`,
        [oldName, trimmed]
      );
      migrated = moved.rowCount;
    }
    // First-time code assignment backfills every current member.
    if (!existingCode && finalCode) {
      await pool.query(
        `UPDATE employee_directory SET department_code = $2, updated_at = NOW()
         WHERE LOWER(department) = LOWER($1)`,
        [trimmed, finalCode]
      );
    }
    return { ok: true, department: mapDepartment(result.rows[0]), migrated, oldName };
  } catch (err) {
    if (err.code === "23505") {
      return { ok: false, error: String(err.constraint || "").includes("code") ? "That department code is already taken." : "That department already exists." };
    }
    throw err;
  }
}

export async function deleteDepartment(id) {
  const pool = await getReadyPool();
  const existing = await pool.query(`SELECT * FROM departments WHERE id = $1`, [id]);
  if (!existing.rows[0]) return { ok: false, error: "Department not found." };
  const members = await countDepartmentMembers(existing.rows[0].name);
  if (members > 0) {
    return { ok: false, inUse: members, error: `${members} teammate${members === 1 ? "" : "s"} are in this department — reassign them first.` };
  }
  await pool.query(`DELETE FROM departments WHERE id = $1`, [id]);
  return { ok: true, name: existing.rows[0].name };
}

// ---------------------------------------------------------------------------
// Permission groups — the quick-assign presets in the User Admin permission
// editor. pages is an array of internal page paths, or ["*"] for "every
// manageable page". Purely a staging convenience: editing a group never
// changes anyone's saved permissions retroactively.
// ---------------------------------------------------------------------------

function mapPermissionGroup(row) {
  return { key: row.key, label: row.label, pages: Array.isArray(row.pages) ? row.pages : [] };
}

export function permissionGroupKeyFromLabel(label) {
  return String(label || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

export async function listPermissionGroups() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM permission_groups ORDER BY sort ASC, label ASC`);
  return result.rows.map(mapPermissionGroup);
}

export async function createPermissionGroup({ label, pages }) {
  const trimmed = String(label || "").trim();
  if (!trimmed) return { ok: false, error: "A label is required." };
  if (trimmed.length > 60) return { ok: false, error: "Labels are capped at 60 characters." };
  const key = permissionGroupKeyFromLabel(trimmed);
  if (!key) return { ok: false, error: "The label needs at least one letter or number." };
  const pool = await getReadyPool();
  const max = await pool.query(`SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM permission_groups`);
  try {
    const result = await pool.query(
      `INSERT INTO permission_groups (key, label, pages, sort) VALUES ($1, $2, $3, $4) RETURNING *`,
      [key, trimmed, JSON.stringify(pages || []), max.rows[0].next]
    );
    return { ok: true, group: mapPermissionGroup(result.rows[0]) };
  } catch (err) {
    if (err.code === "23505") return { ok: false, error: "A permission group with that name already exists." };
    throw err;
  }
}

export async function updatePermissionGroup({ key, label, pages }) {
  const trimmed = String(label || "").trim();
  if (!trimmed) return { ok: false, error: "A label is required." };
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE permission_groups SET label = $2, pages = $3 WHERE key = $1 RETURNING *`,
    [key, trimmed, JSON.stringify(pages || [])]
  );
  if (!result.rows[0]) return { ok: false, error: "Permission group not found." };
  return { ok: true, group: mapPermissionGroup(result.rows[0]) };
}

export async function deletePermissionGroup(key) {
  const pool = await getReadyPool();
  const result = await pool.query(`DELETE FROM permission_groups WHERE key = $1 RETURNING label`, [key]);
  return result.rowCount > 0 ? { ok: true, label: result.rows[0].label } : { ok: false, error: "Permission group not found." };
}


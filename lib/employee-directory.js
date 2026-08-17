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
`;

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
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null
  };
}

export async function listEmployeeDirectory() {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM employee_directory ORDER BY name ASC`
  );
  return result.rows.map(mapDirectoryRow);
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

export async function upsertEmployeeDirectoryEntry({ code, name, email, department, commuteMiles = 0, commissionPlan = "" }, actorUserId = null) {
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
    `INSERT INTO employee_directory (code, name, email, department, commute_miles, commission_plan, job_title_code, department_code, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       department = EXCLUDED.department,
       commute_miles = EXCLUDED.commute_miles,
       commission_plan = EXCLUDED.commission_plan,
       job_title_code = EXCLUDED.job_title_code,
       department_code = EXCLUDED.department_code,
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
      actorUserId
    ]
  );
  return mapDirectoryRow(result.rows[0]);
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
  return { id: row.id, name: row.name, code: row.code || "", notifyWebOrders: Boolean(row.notify_web_orders) };
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

export async function createJobTitle({ name, code = "", notifyWebOrders = false }) {
  const trimmed = String(name || "").trim();
  const codeCheck = validateJobCodeFormat(code);
  if (codeCheck.error) return { ok: false, error: codeCheck.error };
  const pool = await getReadyPool();
  const max = await pool.query(`SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM job_titles`);
  try {
    const result = await pool.query(
      `INSERT INTO job_titles (name, code, notify_web_orders, sort) VALUES ($1, $2, $3, $4) RETURNING *`,
      [trimmed, codeCheck.code || null, Boolean(notifyWebOrders), max.rows[0].next]
    );
    return { ok: true, title: mapJobTitle(result.rows[0]) };
  } catch (err) {
    if (err.code === "23505") {
      return { ok: false, error: String(err.constraint || "").includes("code") ? "That job code is already taken." : "That title already exists." };
    }
    throw err;
  }
}

export async function updateJobTitle({ id, name, code, notifyWebOrders }) {
  const trimmed = String(name || "").trim();
  const pool = await getReadyPool();
  const existing = await pool.query(`SELECT * FROM job_titles WHERE id = $1`, [id]);
  if (!existing.rows[0]) return { ok: false, error: "Title not found." };
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
      `UPDATE job_titles SET name = $2, code = $3, notify_web_orders = $4 WHERE id = $1 RETURNING *`,
      [id, trimmed, finalCode, Boolean(notifyWebOrders)]
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

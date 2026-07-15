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
  const result = await pool.query(
    `INSERT INTO employee_directory (code, name, email, department, commute_miles, commission_plan, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       department = EXCLUDED.department,
       commute_miles = EXCLUDED.commute_miles,
       commission_plan = EXCLUDED.commission_plan,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [
      normalizedCode,
      String(name || "").trim(),
      String(email || "").trim().toLowerCase(),
      String(department || "").trim(),
      Math.max(Number(commuteMiles) || 0, 0),
      String(commissionPlan || "").trim(),
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

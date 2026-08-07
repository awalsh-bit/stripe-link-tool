import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Revenue targets (target-builder.html) — one row per calendar month with a
// total dollar target and department percentage splits. Months with no saved
// row fall back to the placeholder defaults below. The working-days math
// (Monday–Saturday) lives here too so the API and any consumer (the Revenue
// Snapshot module) share one implementation.
// ---------------------------------------------------------------------------

export const TARGET_DEPARTMENTS = ["Appliance", "HVAC Sales", "Repair Service", "Kitchen Design"];

// Placeholder until real targets are entered: $2,000,000 split 90/5/4/1.
export const DEFAULT_TARGET = {
  totalTarget: 2000000,
  splits: {
    "Appliance": 90,
    "HVAC Sales": 5,
    "Repair Service": 4,
    "Kitchen Design": 1
  }
};

const REVENUE_TARGETS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS revenue_targets (
  month TEXT PRIMARY KEY,
  total_target NUMERIC(14,2) NOT NULL,
  splits JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_email TEXT NOT NULL DEFAULT '',
  updated_by_name TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(REVENUE_TARGETS_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

// ---------------------------------------------------------------------------
// Working days: Monday through Saturday count; Sundays don't. "Elapsed"
// includes today (on the first working day of the month the progression is
// 1/total). todayStr is YYYY-MM-DD in the app timezone.
// ---------------------------------------------------------------------------

export function monthWorkingDays(monthStr, todayStr) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthStr || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  let total = 0;
  let elapsed = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun
    const dateStr = `${monthStr}-${String(day).padStart(2, "0")}`;
    const working = dow !== 0;
    if (working) {
      total++;
      if (dateStr <= todayStr) elapsed++;
    }
    days.push({ date: dateStr, dow, working, past: dateStr <= todayStr });
  }

  return {
    total,
    elapsed,
    progression: total ? elapsed / total : 0,
    days
  };
}

export function isValidTargetMonth(monthStr) {
  return /^\d{4}-\d{2}$/.test(String(monthStr || "")) && Number(monthStr.slice(5)) >= 1 && Number(monthStr.slice(5)) <= 12;
}

function mapRow(row) {
  return {
    month: row.month,
    totalTarget: Number(row.total_target),
    splits: row.splits || {},
    updatedByEmail: row.updated_by_email,
    updatedByName: row.updated_by_name,
    updatedAt: row.updated_at?.toISOString?.() || null,
    source: "saved"
  };
}

// Saved target for the month, or the placeholder defaults.
export async function getRevenueTarget(monthStr) {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM revenue_targets WHERE month = $1`, [monthStr]);
  if (result.rows[0]) return mapRow(result.rows[0]);
  return {
    month: monthStr,
    totalTarget: DEFAULT_TARGET.totalTarget,
    splits: { ...DEFAULT_TARGET.splits },
    updatedByEmail: "",
    updatedByName: "",
    updatedAt: null,
    source: "default"
  };
}

export async function saveRevenueTarget({ month, totalTarget, splits, byEmail, byName }) {
  const pool = await getReadyPool();
  const cleanSplits = {};
  for (const dept of TARGET_DEPARTMENTS) {
    cleanSplits[dept] = Math.round(Number(splits?.[dept] || 0) * 100) / 100;
  }
  const result = await pool.query(
    `INSERT INTO revenue_targets (month, total_target, splits, updated_by_email, updated_by_name, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
     ON CONFLICT (month) DO UPDATE SET
       total_target = EXCLUDED.total_target,
       splits = EXCLUDED.splits,
       updated_by_email = EXCLUDED.updated_by_email,
       updated_by_name = EXCLUDED.updated_by_name,
       updated_at = NOW()
     RETURNING *`,
    [
      month,
      Math.round(Number(totalTarget) * 100) / 100,
      JSON.stringify(cleanSplits),
      String(byEmail || "").trim().toLowerCase(),
      String(byName || "").trim()
    ]
  );
  return mapRow(result.rows[0]);
}

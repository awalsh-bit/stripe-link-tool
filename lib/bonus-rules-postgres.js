import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Bonus Tracker rules (target-builder.html editor, dashboard.html module).
// Per-department attainment tiers on two ladders:
//   deptTiers    — unlocked by the department's MTD attainment vs its
//                  working-day-prorated target
//   companyTiers — unlocked by company-wide MTD attainment, so everyone
//                  (including departments with no revenue target, like
//                  Client Care) is invested in the whole company's month.
// Payout per ladder = the HIGHEST tier whose threshold is reached (not
// cumulative); total = dept amount + company amount.
// One current ruleset; months without a saved ruleset use the placeholder
// defaults below (marked source:"default"), mirroring the Target Builder.
// ---------------------------------------------------------------------------

export const BONUS_DEPARTMENTS = ["Appliance", "HVAC Sales", "Repair Service", "Kitchen Design", "Client Care"];

// Placeholder tiers until Andrew enters the real plan.
export const DEFAULT_BONUS_RULES = {
  "Appliance": {
    deptTiers: [{ threshold: 90, amount: 150 }, { threshold: 100, amount: 300 }, { threshold: 110, amount: 500 }],
    companyTiers: [{ threshold: 100, amount: 200 }]
  },
  "HVAC Sales": {
    deptTiers: [{ threshold: 90, amount: 150 }, { threshold: 100, amount: 300 }, { threshold: 110, amount: 500 }],
    companyTiers: [{ threshold: 100, amount: 200 }]
  },
  "Repair Service": {
    deptTiers: [{ threshold: 90, amount: 150 }, { threshold: 100, amount: 300 }, { threshold: 110, amount: 500 }],
    companyTiers: [{ threshold: 100, amount: 200 }]
  },
  "Kitchen Design": {
    deptTiers: [{ threshold: 90, amount: 150 }, { threshold: 100, amount: 300 }, { threshold: 110, amount: 500 }],
    companyTiers: [{ threshold: 100, amount: 200 }]
  },
  "Client Care": {
    deptTiers: [],
    companyTiers: [{ threshold: 90, amount: 100 }, { threshold: 100, amount: 250 }]
  }
};

const BONUS_RULES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS bonus_rules (
  id INTEGER PRIMARY KEY,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
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
    ensurePromise = pool.query(BONUS_RULES_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

function cleanTiers(tiers) {
  return (Array.isArray(tiers) ? tiers : [])
    .map((t) => ({
      threshold: Math.round(Number(t?.threshold) * 10) / 10,
      amount: Math.round(Number(t?.amount) * 100) / 100
    }))
    .filter((t) => Number.isFinite(t.threshold) && t.threshold > 0 && t.threshold <= 500 &&
                   Number.isFinite(t.amount) && t.amount >= 0 && t.amount <= 100000)
    .sort((a, b) => a.threshold - b.threshold);
}

export function sanitizeBonusRules(rules) {
  const out = {};
  for (const dept of BONUS_DEPARTMENTS) {
    const entry = rules?.[dept] || {};
    out[dept] = {
      deptTiers: cleanTiers(entry.deptTiers),
      companyTiers: cleanTiers(entry.companyTiers)
    };
  }
  return out;
}

export async function getBonusRules() {
  const pool = await getReadyPool();
  const result = await pool.query(`SELECT * FROM bonus_rules WHERE id = 1`);
  if (result.rows[0]) {
    return {
      rules: sanitizeBonusRules(result.rows[0].rules),
      updatedByEmail: result.rows[0].updated_by_email,
      updatedByName: result.rows[0].updated_by_name,
      updatedAt: result.rows[0].updated_at?.toISOString?.() || null,
      source: "saved"
    };
  }
  return {
    rules: sanitizeBonusRules(DEFAULT_BONUS_RULES),
    updatedByEmail: "",
    updatedByName: "",
    updatedAt: null,
    source: "default"
  };
}

export async function saveBonusRules({ rules, byEmail, byName }) {
  const pool = await getReadyPool();
  const clean = sanitizeBonusRules(rules);
  await pool.query(
    `INSERT INTO bonus_rules (id, rules, updated_by_email, updated_by_name, updated_at)
     VALUES (1, $1::jsonb, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       rules = EXCLUDED.rules,
       updated_by_email = EXCLUDED.updated_by_email,
       updated_by_name = EXCLUDED.updated_by_name,
       updated_at = NOW()`,
    [JSON.stringify(clean), String(byEmail || "").trim().toLowerCase(), String(byName || "").trim()]
  );
  return clean;
}

// Highest tier reached (attainment in %, e.g. 104.2) plus the next one up.
function evaluateLadder(tiers, attainment) {
  let unlocked = null;
  let next = null;
  for (const tier of tiers) {
    if (Number.isFinite(attainment) && attainment >= tier.threshold) unlocked = tier;
    else if (!next) next = tier;
  }
  return {
    amount: unlocked ? unlocked.amount : 0,
    unlockedThreshold: unlocked ? unlocked.threshold : null,
    nextTier: next
  };
}

// Pure payout math so the module and tests share one implementation.
// deptAttainment/companyAttainment are percentages vs the TO-DATE (working-
// day prorated) targets; pass NaN when there is no target to measure against.
export function computeBonus({ department, deptAttainment, companyAttainment, rules }) {
  const entry = rules?.[department] || { deptTiers: [], companyTiers: [] };
  const dept = evaluateLadder(entry.deptTiers || [], deptAttainment);
  const company = evaluateLadder(entry.companyTiers || [], companyAttainment);
  return {
    department,
    deptAmount: dept.amount,
    deptUnlockedThreshold: dept.unlockedThreshold,
    deptNextTier: dept.nextTier,
    companyAmount: company.amount,
    companyUnlockedThreshold: company.unlockedThreshold,
    companyNextTier: company.nextTier,
    total: Math.round((dept.amount + company.amount) * 100) / 100
  };
}

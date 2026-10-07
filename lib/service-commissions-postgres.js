import { getPostgresPool } from "./data-postgres.js";
import { listEmployeeDirectory, listJobTitles } from "./employee-directory.js";
import { listFuelReceiptsBetween } from "./card-receipts-postgres.js";

// ---------------------------------------------------------------------------
// REPAIR SERVICE COMMISSIONS (service-commissions.html for the manager,
// my-service-commissions.html for each tech) — Andrew, 2026-09-18. Ported
// from "2025 Service Tech Commission Calculator.xlsx":
//
//   Service Dept Quota  → a weekly quota $ per tech, target annual comp and
//                         the base-pay guarantee (60% of target by default)
//   Data Entry          → per fiscal week per tech: COD labor + COD parts
//                         margin + warranty labor (+ Wilson quota credit)
//                         = attainment $, against quota $ → attainment %
//   Tech tabs           → quarter commission = target × (weeks/52) × attainment%
//                         − base × (weeks/52), i.e. the variable 40% scaled
//                         by attainment, worth $0 at 60% and growing linearly
//                         (floored at $0 — the base is guaranteed)
//   Pay Calendar        → quarters of 12 / 14 / 12 / 14 fiscal weeks, week 1
//                         starting the Sunday on or before Jan 1; the quarter
//                         commission lands on the paycheck 20 days after the
//                         quarter's last Saturday (4/11, 7/18, 10/10 in 2025)
//
// The weekly numbers come straight from finished SV tickets in the Sales
// Order Detail warehouse (OE-23 feed, the same one sales commissions use):
// service_type COD → labor + (parts list − parts cost); Manufacturer /
// WACA Warranty → labor only. "Wilson quota credit" stays a manual entry.
//
//   service_comp_plans     tech_code × plan_year: weekly quota, target, base
//                          (LEGACY - the year-row model; still the fallback
//                          for a quarter that hasn't been set up below)
//   service_comp_credits   manual quota credits per tech per week
//   service_comp_settings  fiscal calendar overrides, qualifying job titles,
//                          payroll burden %
//
// Quarter-first model (Andrew 10/7): the department's quota is set for a
// QUARTER as one dollar amount, then distributed to the techs as shares.
// Each tech's weekly quota = dept quarter quota × share ÷ weeks in quarter,
// so changing the dept number re-splits everyone instantly. Techs populate
// from the employee directory by job title ("job codes"); the qualifying
// titles are a setting, and a tech can be added by code or dropped for a
// quarter by hand. "Target annual" is now called OTE (on-target earnings);
// the base guarantee is a % of OTE (default 60%).
//   service_comp_quarters        plan_year × quarter: dept quota $, note
//   service_comp_quarter_techs   plan_year × quarter × tech: share, OTE, base %
// Fuel from card receipts (category 'fuel', or keyword-matched legacy rows)
// is rolled up per tech by directory email for the profitability estimate:
// expected payout (base for the quarter + trending commission + payroll
// burden) + fuel versus labor + parts margin. No effect on commission math.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS service_comp_plans (
  tech_code TEXT NOT NULL,
  plan_year INTEGER NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  weekly_quota NUMERIC(12,2) NOT NULL DEFAULT 0,
  target_annual NUMERIC(12,2) NOT NULL DEFAULT 0,
  base_annual NUMERIC(12,2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tech_code, plan_year)
);
-- Weekly quotas are set BY QUARTER (Andrew 9/23), not once for the year:
-- {"1": 2600, "2": 2700, "3": 2700, "4": 2400}. weekly_quota stays as the
-- fallback for a quarter with no entry.
ALTER TABLE service_comp_plans ADD COLUMN IF NOT EXISTS quarter_quotas JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS service_comp_credits (
  id BIGSERIAL PRIMARY KEY,
  tech_code TEXT NOT NULL,
  week_start DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scc_tech_week ON service_comp_credits (tech_code, week_start);
CREATE TABLE IF NOT EXISTS service_comp_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS service_comp_quarters (
  plan_year INTEGER NOT NULL,
  quarter INTEGER NOT NULL,
  dept_quota NUMERIC(12,2) NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_year, quarter)
);
CREATE TABLE IF NOT EXISTS service_comp_quarter_techs (
  plan_year INTEGER NOT NULL,
  quarter INTEGER NOT NULL,
  tech_code TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  share NUMERIC(9,6) NOT NULL DEFAULT 0,
  ote_annual NUMERIC(12,2) NOT NULL DEFAULT 0,
  base_pct NUMERIC(5,2) NOT NULL DEFAULT 60,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  manual BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_year, quarter, tech_code)
);
-- Difficulty factors (Andrew 10/7) that weight the split: territory mix,
-- drive time and tenure, each -10% / even / +10% against an even share.
ALTER TABLE service_comp_quarter_techs ADD COLUMN IF NOT EXISTS geo_mix TEXT NOT NULL DEFAULT 'all';
ALTER TABLE service_comp_quarter_techs ADD COLUMN IF NOT EXISTS drive_time TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE service_comp_quarter_techs ADD COLUMN IF NOT EXISTS tenure TEXT NOT NULL DEFAULT 'experienced';
-- Per-employee-code settings that don't change quarter to quarter
-- (Andrew 10/7): the base guarantee as a % of OTE.
CREATE TABLE IF NOT EXISTS service_comp_tech_settings (
  tech_code TEXT PRIMARY KEY,
  base_pct NUMERIC(5,2) NOT NULL DEFAULT 60,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

// Split weighting. A tech's weight starts at 1.00 (an even share) and each
// factor adds or takes a swing of 5/10/15/20/25% (Andrew 10/7); the
// weighted share is even share × weight. Core brands / long drives /
// novice pull the quota down; luxury / short drives / advanced push it up.
// Option keys are "<side><pct>" (core10, luxury25) or the even key.
const SWINGS = [5, 10, 15, 20, 25];
function factorOptions(down, even, up) {
  return [
    ...SWINGS.slice().reverse().map((p) => ({ key: `${down.key}${p}`, label: `${down.label} (-${p}%)`, side: down.label, adj: -p / 100 })),
    { key: even.key, label: even.label, side: even.label, adj: 0 },
    ...SWINGS.map((p) => ({ key: `${up.key}${p}`, label: `${up.label} (+${p}%)`, side: up.label, adj: p / 100 }))
  ];
}
export const SPLIT_FACTORS = {
  geoMix: { label: "Geo Mix", options: factorOptions({ key: "core", label: "Core Brands" }, { key: "all", label: "All Brands" }, { key: "luxury", label: "Luxury Brands" }), default: "all" },
  driveTime: { label: "Geo Drive Time", options: factorOptions({ key: "long", label: "Long Drives" }, { key: "standard", label: "Standard Drives" }, { key: "short", label: "Short Drives" }), default: "standard" },
  tenure: { label: "Tenure", options: factorOptions({ key: "novice", label: "Novice" }, { key: "experienced", label: "Experienced" }, { key: "advanced", label: "Advanced" }), default: "experienced" }
};
// Keys saved before the swings existed ("core", "advanced") meant 10%.
const LEGACY_FACTOR_KEYS = { core: "core10", luxury: "luxury10", long: "long10", short: "short10", novice: "novice10", advanced: "advanced10" };
export function normalizeFactor(name, value) {
  const f = SPLIT_FACTORS[name]; let k = String(value || "").trim().toLowerCase();
  if (LEGACY_FACTOR_KEYS[k]) k = LEGACY_FACTOR_KEYS[k];
  return f.options.some((o) => o.key === k) ? k : f.default;
}
export function techWeight(t) {
  let w = 1;
  for (const [name, f] of Object.entries(SPLIT_FACTORS)) { const o = f.options.find((x) => x.key === normalizeFactor(name, t?.[name])); w += o ? o.adj : 0; }
  return Math.round(w * 1000) / 1000;
}
// Shares for the active techs: each tech's even share (1 / N) times their
// weight. Strictly additive - an Advanced tech is +10% of an even share and
// nobody else moves, so the total can land above (or below) 100%; that
// over-assignment is intentional cushion.
export function weightedShares(techs) {
  const on = techs.filter((t) => t.active !== false);
  const n = on.length;
  return Object.fromEntries(on.map((t) => [t.techCode, n ? techWeight(t) / n : 0]));
}

// ---- Base guarantee by employee code ----
export async function getTechSettings() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT tech_code, base_pct, updated_by, updated_at FROM service_comp_tech_settings`);
  return Object.fromEntries(r.rows.map((x) => [x.tech_code, { basePct: Number(x.base_pct), updatedBy: x.updated_by || "", updatedAt: x.updated_at?.toISOString?.() || null }]));
}
export async function saveTechSettings(rows, by = "") {
  boardMemo.clear();
  const pool = await getReadyPool();
  let n = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const code = String(r.techCode || "").trim().toUpperCase().slice(0, 10);
    const pct = Number(String(r.basePct ?? "").replace(/[%\s]/g, ""));
    if (!code) continue;
    if (!(pct >= 0 && pct <= 100)) throw new Error(`${code}: base guarantee is a percent of OTE (0-100).`);
    await pool.query(`INSERT INTO service_comp_tech_settings (tech_code, base_pct, updated_by, updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (tech_code) DO UPDATE SET base_pct = EXCLUDED.base_pct, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [code, r2(pct), String(by || "").slice(0, 120)]);
    n++;
  }
  return n;
}
// The base % for a code: the tech setting, else what the quarter row /
// legacy plan carried before base moved to the code level, else 60.
function basePctFor(code, techSettings, fallback) {
  const s = techSettings?.[code];
  if (s && Number.isFinite(s.basePct)) return s.basePct;
  return Number.isFinite(Number(fallback)) && fallback != null ? Number(fallback) : 60;
}

let ensurePromise = null;
let financeIndexesTried = false;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  if (!financeIndexesTried) {
    // The paid-balance check probes the finance feed's tables by invoice; give
    // them indexes (they're replaced wholesale each pull, so these are cheap).
    financeIndexesTried = true;
    for (const sql of [
      `CREATE INDEX IF NOT EXISTS epass_payments_invoice_idx ON epass_payments (invoice)`,
      `CREATE INDEX IF NOT EXISTS epass_payments_base_idx ON epass_payments (split_part(invoice, '-', 1))`,
      `CREATE INDEX IF NOT EXISTS epass_ar_current_invoice_idx ON epass_ar_current (invoice)`,
      `CREATE INDEX IF NOT EXISTS epass_ar_current_base_idx ON epass_ar_current (split_part(invoice, '-', 1))`,
      `CREATE INDEX IF NOT EXISTS sod_sv_finish_idx ON sales_order_detail (finish_date) WHERE invoice LIKE 'SV%'`
    ]) await pool.query(sql).catch(() => {});
  }
  return pool;
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r2x = (n, d) => { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => { const d = new Date(isoDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

// ---------------------------------------------------------------------------
// Fiscal calendar
// ---------------------------------------------------------------------------
export const DEFAULT_QUARTER_WEEKS = [12, 14, 12, 14];
// Payment types (code or description) that mean the balance was written
// off rather than paid: the ticket is LOST, never counts.
export const DEFAULT_LOST_PAYMENT_TYPES = "write.?off|bad.?debt|^w/?o$|uncollect|lost";

export function defaultWeekOneStart(year) {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  jan1.setUTCDate(jan1.getUTCDate() - jan1.getUTCDay()); // back to Sunday
  return iso(jan1);
}

export async function getServiceCompSettings() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT key, value FROM service_comp_settings`);
  const out = { weekOneStart: {}, quarterWeeks: DEFAULT_QUARTER_WEEKS.slice(), payLagDays: 20, qualifyingTitles: null, burdenPct: 0, lostPaymentTypes: DEFAULT_LOST_PAYMENT_TYPES };
  for (const row of r.rows) {
    if (row.key === "week_one_start" && row.value && typeof row.value === "object") out.weekOneStart = row.value;
    if (row.key === "quarter_weeks" && Array.isArray(row.value) && row.value.length === 4) out.quarterWeeks = row.value.map((n) => Number(n) || 13);
    if (row.key === "pay_lag_days" && Number.isFinite(Number(row.value))) out.payLagDays = Number(row.value);
    if (row.key === "qualifying_titles" && Array.isArray(row.value)) out.qualifyingTitles = row.value.map(String);
    if (row.key === "payroll_burden_pct" && Number.isFinite(Number(row.value))) out.burdenPct = Number(row.value);
    if (row.key === "lost_payment_types" && typeof row.value === "string" && row.value.trim()) out.lostPaymentTypes = row.value;
  }
  return out;
}
export async function setServiceCompSetting(key, value) {
  boardMemo.clear();
  const pool = await getReadyPool();
  let clean;
  if (key === "week_one_start") {
    clean = {};
    for (const [y, d] of Object.entries(value || {})) if (/^\d{4}$/.test(y) && /^\d{4}-\d{2}-\d{2}$/.test(String(d))) clean[y] = String(d);
  } else if (key === "quarter_weeks") {
    clean = (Array.isArray(value) ? value : []).map((n) => Math.max(1, Math.round(Number(n) || 0)));
    if (clean.length !== 4) throw new Error("Give four quarter lengths in weeks.");
  } else if (key === "pay_lag_days") {
    clean = Math.max(0, Math.round(Number(value) || 0));
  } else if (key === "qualifying_titles") {
    clean = [...new Set((Array.isArray(value) ? value : []).map((v) => String(v || "").trim()).filter(Boolean))].slice(0, 50);
  } else if (key === "payroll_burden_pct") {
    clean = Math.min(60, Math.max(0, r2(Number(value) || 0)));
  } else if (key === "lost_payment_types") {
    clean = String(value || "").trim().slice(0, 300) || DEFAULT_LOST_PAYMENT_TYPES;
    try { new RegExp(clean, "i"); } catch { throw new Error("Lost payment types must be a valid pattern (e.g. write.?off|bad.?debt)."); }
  } else throw new Error(`Unknown setting ${key}`);
  await pool.query(`INSERT INTO service_comp_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(clean)]);
  return clean;
}

export function fiscalCalendar(year, settings = {}) {
  const w1 = (settings.weekOneStart || {})[String(year)] || defaultWeekOneStart(year);
  const next = (settings.weekOneStart || {})[String(year + 1)] || defaultWeekOneStart(year + 1);
  const totalWeeks = Math.max(52, Math.round((new Date(next + "T00:00:00Z") - new Date(w1 + "T00:00:00Z")) / (7 * 864e5)));
  const qw = (settings.quarterWeeks || DEFAULT_QUARTER_WEEKS).slice();
  qw[3] += totalWeeks - qw.reduce((a, b) => a + b, 0); // a 53-week year lands in Q4
  const weeks = [], quarters = [];
  let n = 1;
  for (let q = 0; q < 4; q++) {
    const start = addDays(w1, (n - 1) * 7);
    const qweeks = [];
    for (let i = 0; i < qw[q]; i++, n++) { const ws = addDays(w1, (n - 1) * 7); const wk = { n, start: ws, end: addDays(ws, 6), quarter: q + 1, inQuarter: i + 1 }; weeks.push(wk); qweeks.push(wk); }
    const end = qweeks[qweeks.length - 1].end;
    quarters.push({ q: q + 1, start, end, weeks: qweeks.length, firstWeek: qweeks[0].n, lastWeek: qweeks[qweeks.length - 1].n, payDate: addDays(end, settings.payLagDays ?? 20) });
  }
  return { year, weekOneStart: w1, totalWeeks, weeks, quarters };
}

export function fiscalPeriodFor(dateIso, settings = {}) {
  const y = Number(String(dateIso).slice(0, 4));
  for (const year of [y + 1, y, y - 1]) {
    const cal = fiscalCalendar(year, settings);
    if (dateIso >= cal.weekOneStart && dateIso <= cal.weeks[cal.weeks.length - 1].end) {
      const week = cal.weeks.find((w) => dateIso >= w.start && dateIso <= w.end);
      return { year, quarter: week.quarter, week: week.n, cal };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plans & credits
// ---------------------------------------------------------------------------
// The quota that applies in a quarter: the quarter's own, else the year's.
export function weeklyQuotaFor(plan, quarter) {
  const q = plan?.quarterQuotas?.[String(quarter)];
  return q != null && q !== "" && Number.isFinite(Number(q)) ? Number(q) : Number(plan?.weeklyQuota) || 0;
}
function mapPlan(row) {
  const target = Number(row.target_annual) || 0;
  const qq = row.quarter_quotas && typeof row.quarter_quotas === "object" ? Object.fromEntries(Object.entries(row.quarter_quotas).filter(([k, v]) => /^[1-4]$/.test(k) && v != null && v !== "").map(([k, v]) => [k, r2(v)])) : {};
  return {
    techCode: row.tech_code, year: Number(row.plan_year), displayName: row.display_name || "",
    weeklyQuota: Number(row.weekly_quota) || 0, quarterQuotas: qq, targetAnnual: target,
    // A base typed as a small number ("70") was meant as a percent of OTE.
    baseAnnual: row.base_annual == null ? r2(target * 0.6) : Number(row.base_annual) <= 100 ? r2(target * Number(row.base_annual) / 100) : Number(row.base_annual), baseIsDefault: row.base_annual == null,
    basePct: row.base_annual == null ? 60 : Number(row.base_annual) <= 100 ? Number(row.base_annual) : target > 0 ? r2(Number(row.base_annual) / target * 100) : 60,
    active: row.active !== false, updatedAt: row.updated_at?.toISOString?.() || null
  };
}
export async function listServiceCompPlans(year) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM service_comp_plans WHERE plan_year = $1 ORDER BY display_name, tech_code`, [year]);
  return r.rows.map(mapPlan);
}
export async function upsertServiceCompPlan({ techCode, year, displayName = "", weeklyQuota = null, quarterQuotas = null, targetAnnual, baseAnnual = null, active = true }) {
  boardMemo.clear();
  const code = String(techCode || "").trim().toUpperCase().slice(0, 10);
  if (!code) throw new Error("Tech code is required.");
  const y = Number(year); if (!Number.isInteger(y) || y < 2020 || y > 2100) throw new Error("Plan year looks wrong.");
  // quotas by quarter; the year-level number is the fallback (the first
  // quarter given, when none is sent explicitly)
  const qq = {};
  for (const k of ["1", "2", "3", "4"]) { const v = quarterQuotas?.[k]; if (v == null || v === "") continue; const n = Number(String(v).replace(/[$,]/g, "")); if (!(n >= 0)) throw new Error(`Q${k} weekly quota must be a number.`); qq[k] = r2(n); }
  const wqRaw = weeklyQuota == null || weeklyQuota === "" ? (qq["1"] ?? qq["2"] ?? qq["3"] ?? qq["4"] ?? 0) : Number(String(weeklyQuota).replace(/[$,]/g, ""));
  const wq = wqRaw, ta = Number(String(targetAnnual).replace(/[$,]/g, ""));
  if (!(wq >= 0) || !(ta >= 0)) throw new Error("Weekly quota and target annual comp must be numbers.");
  const ba = baseAnnual === "" || baseAnnual == null ? null : Number(String(baseAnnual).replace(/[$,]/g, ""));
  if (ba != null && !(ba >= 0)) throw new Error("Base pay must be a number (or blank for 60% of target).");
  const pool = await getReadyPool();
  const r = await pool.query(
    `INSERT INTO service_comp_plans (tech_code, plan_year, display_name, weekly_quota, quarter_quotas, target_annual, base_annual, active, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,NOW())
     ON CONFLICT (tech_code, plan_year) DO UPDATE SET display_name = EXCLUDED.display_name, weekly_quota = EXCLUDED.weekly_quota, quarter_quotas = CASE WHEN $9 THEN EXCLUDED.quarter_quotas ELSE service_comp_plans.quarter_quotas END, target_annual = EXCLUDED.target_annual, base_annual = EXCLUDED.base_annual, active = EXCLUDED.active, updated_at = NOW()
     RETURNING *`,
    [code, y, String(displayName || "").trim().slice(0, 80), r2(wq), JSON.stringify(qq), r2(ta), ba == null ? null : r2(ba), active !== false, quarterQuotas != null]
  );
  return mapPlan(r.rows[0]);
}
export async function addServiceCompCredit({ techCode, weekStart, amount, note = "", by = "" }) {
  boardMemo.clear();
  const code = String(techCode || "").trim().toUpperCase().slice(0, 10);
  if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart || ""))) throw new Error("Tech and week are required.");
  const amt = Number(String(amount).replace(/[$,]/g, "")); if (!Number.isFinite(amt) || amt === 0) throw new Error("Give a non-zero credit amount.");
  const pool = await getReadyPool();
  const r = await pool.query(`INSERT INTO service_comp_credits (tech_code, week_start, amount, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [code, weekStart, r2(amt), String(note || "").slice(0, 200), String(by || "").slice(0, 120)]);
  return r.rows[0];
}
export async function deleteServiceCompCredit(id) {
  boardMemo.clear();
  const pool = await getReadyPool();
  await pool.query(`DELETE FROM service_comp_credits WHERE id = $1`, [Number(id)]);
}

// ---------------------------------------------------------------------------
// Quarter-first plans
// ---------------------------------------------------------------------------
export const DEFAULT_QUALIFYING_TITLE_RE = /service\s*tech|repair\s*tech|appliance\s*tech|technician/i;
const normTitle = (v) => String(v || "").trim().toLowerCase();

// Which directory entries are techs for the plan: title name (or the title's
// job code) in the qualifying set. With no setting saved yet, any title that
// reads like a technician qualifies, so the page starts populated.
export function qualifyingTechsFromDirectory(directory, titles, qualifyingTitles) {
  const titleByName = new Map((titles || []).map((t) => [normTitle(t.name), t]));
  const set = qualifyingTitles == null ? null : new Set(qualifyingTitles.map(normTitle));
  const qualifies = (entry) => {
    const t = titleByName.get(normTitle(entry.commissionPlan));
    const code = normTitle(entry.jobTitleCode || t?.code);
    if (set) return set.has(normTitle(entry.commissionPlan)) || (code && set.has(code));
    return DEFAULT_QUALIFYING_TITLE_RE.test(entry.commissionPlan || "");
  };
  return (directory || []).filter((e) => !e.archived && e.code && qualifies(e)).map((e) => ({
    techCode: String(e.code).toUpperCase(), name: e.name || "", email: String(e.email || "").toLowerCase(), title: e.commissionPlan || "", jobCode: e.jobTitleCode || titleByName.get(normTitle(e.commissionPlan))?.code || ""
  }));
}

function mapQuarterTech(row) {
  const t = { techCode: row.tech_code, displayName: row.display_name || "", share: Number(row.share) || 0, ote: Number(row.ote_annual) || 0, basePct: row.base_pct == null ? 60 : Number(row.base_pct), active: row.active !== false, manual: Boolean(row.manual),
    geoMix: normalizeFactor("geoMix", row.geo_mix), driveTime: normalizeFactor("driveTime", row.drive_time), tenure: normalizeFactor("tenure", row.tenure) };
  t.weight = techWeight(t);
  return t;
}
export async function getQuarterRows(year, quarter) {
  const pool = await getReadyPool();
  const [q, t] = await Promise.all([
    pool.query(`SELECT * FROM service_comp_quarters WHERE plan_year = $1 AND quarter = $2`, [year, quarter]),
    pool.query(`SELECT * FROM service_comp_quarter_techs WHERE plan_year = $1 AND quarter = $2 ORDER BY display_name, tech_code`, [year, quarter])
  ]);
  const d = q.rows[0];
  return {
    dept: d ? { deptQuota: Number(d.dept_quota) || 0, note: d.note || "", updatedBy: d.updated_by || "", updatedAt: d.updated_at?.toISOString?.() || null } : null,
    techs: t.rows.map(mapQuarterTech)
  };
}

// The plan objects the board runs on for a quarter, as { plans, model }.
// model = "quarter" when the quarter has been set up in the new editor,
// "legacy" when it still rides on the year rows.
export async function resolveQuarterPlans({ year, q, settings, directory = null }) {
  const [rows, techSettings] = await Promise.all([getQuarterRows(year, q.q), getTechSettings()]);
  if (rows.dept) {
    const weeks = q.weeks || 13;
    const dir = directory || await listEmployeeDirectory();
    const byCode = new Map(dir.map((e) => [String(e.code).toUpperCase(), e]));
    const plans = rows.techs.filter((t) => t.active).map((t) => {
      const weeklyQuota = r2(rows.dept.deptQuota * t.share / weeks);
      const e = byCode.get(t.techCode);
      const basePct = basePctFor(t.techCode, techSettings, t.basePct);
      return { techCode: t.techCode, year, displayName: t.displayName || e?.name || t.techCode, email: String(e?.email || "").toLowerCase(), weeklyQuota, yearWeeklyQuota: weeklyQuota, quarterQuotas: {}, targetAnnual: t.ote, ote: t.ote, basePct, baseAnnual: r2(t.ote * basePct / 100), baseIsDefault: basePct === 60, share: t.share, active: true, manual: t.manual, geoMix: t.geoMix, driveTime: t.driveTime, tenure: t.tenure, weight: t.weight };
    });
    return { plans, model: "quarter", dept: rows.dept };
  }
  const legacy = await listServiceCompPlans(year);
  const dir = directory || await listEmployeeDirectory();
  const byCode = new Map(dir.map((e) => [String(e.code).toUpperCase(), e]));
  const plans = legacy.filter((p) => p.active).map((p0) => { const wq = weeklyQuotaFor(p0, q.q); const basePct = basePctFor(p0.techCode, techSettings, p0.basePct); return { ...p0, basePct, baseAnnual: r2(p0.targetAnnual * basePct / 100), weeklyQuota: wq, yearWeeklyQuota: p0.weeklyQuota, ote: p0.targetAnnual, email: String(byCode.get(p0.techCode)?.email || "").toLowerCase(), share: null, manual: false }; });
  return { plans, model: "legacy", dept: null };
}

// Everything the quarter editor shows: the dept quota (seeded from the
// legacy rows the first time), the qualifying titles, and one row per tech
// - directory techs by job title, plus hand-added or dropped ones.
export async function getQuarterPlanEditor({ year, quarter, today }) {
  const settings = await getServiceCompSettings();
  const cal = fiscalCalendar(year, settings);
  const q = cal.quarters[quarter - 1] || cal.quarters[0];
  const [directory, titles, rows, legacy, techSettings] = await Promise.all([listEmployeeDirectory(), listJobTitles(), getQuarterRows(year, q.q), listServiceCompPlans(year), getTechSettings()]);
  const qualifying = qualifyingTechsFromDirectory(directory, titles, settings.qualifyingTitles);
  const qualSet = new Set(qualifying.map((t) => t.techCode));
  const dirByCode = new Map(directory.map((e) => [String(e.code).toUpperCase(), e]));
  const saved = new Map(rows.techs.map((t) => [t.techCode, t]));
  const legacyByCode = new Map(legacy.filter((p) => p.active).map((p) => [p.techCode, p]));
  const seeded = !rows.dept;
  // Seed: previous quarter's rows if the year has one, else the legacy year plans.
  let seedRows = null, seedDept = null, seedFrom = "";
  if (seeded) {
    const prev = q.q > 1 ? await getQuarterRows(year, q.q - 1) : await getQuarterRows(year - 1, 4);
    if (prev.dept) { seedRows = new Map(prev.techs.map((t) => [t.techCode, t])); seedDept = prev.dept.deptQuota; seedFrom = q.q > 1 ? `${year}-Q${q.q - 1}` : `${year - 1}-Q4`; }
    else if (legacyByCode.size) {
      const total = r2([...legacyByCode.values()].reduce((a, p) => a + weeklyQuotaFor(p, q.q) * q.weeks, 0));
      seedDept = total;
      seedRows = new Map([...legacyByCode.values()].map((p) => [p.techCode, { techCode: p.techCode, displayName: p.displayName, share: total > 0 ? r2x(weeklyQuotaFor(p, q.q) * q.weeks / total, 6) : 0, ote: p.targetAnnual, basePct: p.basePct, active: true, manual: false }]));
      seedFrom = `${year} year plans`;
    }
  }
  const codes = new Set([...qualSet, ...saved.keys(), ...(seedRows ? seedRows.keys() : [])]);
  const techs = [...codes].map((code) => {
    const e = dirByCode.get(code); const sv = saved.get(code) || seedRows?.get(code); const qt = qualifying.find((t) => t.techCode === code);
    return {
      techCode: code, name: e?.name || sv?.displayName || code, email: String(e?.email || "").toLowerCase(), title: e?.commissionPlan || "", jobCode: qt?.jobCode || e?.jobTitleCode || "",
      qualifies: qualSet.has(code), inDirectory: Boolean(e), archived: Boolean(e?.archived),
      share: sv ? sv.share : 0, ote: sv ? sv.ote : (legacyByCode.get(code)?.targetAnnual || 0),
      // base % lives at the employee-code level now; the quarter row / legacy
      // value is only the fallback until a code setting is saved
      basePct: basePctFor(code, techSettings, sv ? sv.basePct : legacyByCode.get(code)?.basePct), baseIsCodeSetting: Boolean(techSettings[code]),
      geoMix: normalizeFactor("geoMix", sv?.geoMix), driveTime: normalizeFactor("driveTime", sv?.driveTime), tenure: normalizeFactor("tenure", sv?.tenure),
      active: sv ? sv.active : true, manual: sv ? sv.manual : !qualSet.has(code), saved: saved.has(code)
    };
  }).map((t) => ({ ...t, weight: techWeight(t) })).sort((a, b) => a.name.localeCompare(b.name));
  // A fresh quarter with no shares at all starts on the weighted split.
  if (techs.length && !techs.some((t) => t.share > 0)) { const ws = weightedShares(techs); for (const t of techs) t.share = r2x(ws[t.techCode] || 0, 6); }
  // Anchor: what each tech carried a year ago (same quarter), or failing
  // that the most recent earlier quarter with a plan - weekly quota and how
  // they did against it - so the new number is set against a known one.
  const anchor = await quarterAnchor({ year, quarter: q.q, today, settings });
  for (const t of techs) t.anchor = anchor.byCode[t.techCode] || null;
  return {
    year, quarter: { q: q.q, start: q.start, end: q.end, weeks: q.weeks, payDate: q.payDate },
    dept: rows.dept || { deptQuota: seedDept || 0, note: "", updatedBy: "", updatedAt: null },
    seeded, seedFrom, weeks: q.weeks,
    titles: titles.map((t) => ({ name: t.name, code: t.code || "", holders: directory.filter((e) => !e.archived && normTitle(e.commissionPlan) === normTitle(t.name)).length })),
    qualifyingTitles: settings.qualifyingTitles ?? titles.filter((t) => DEFAULT_QUALIFYING_TITLE_RE.test(t.name)).map((t) => t.name),
    qualifyingIsDefault: settings.qualifyingTitles == null,
    burdenPct: settings.burdenPct,
    factors: SPLIT_FACTORS,
    anchor: { label: anchor.label, windowStart: anchor.windowStart, windowEnd: anchor.windowEnd },
    techSettings: Object.fromEntries(techs.map((t) => [t.techCode, { basePct: t.basePct, saved: t.baseIsCodeSetting }])),
    techs
  };
}

// The anchor for the editor (Andrew 10/7): each tech's AVERAGE weekly quota
// and attainment over the trailing 52 completed fiscal weeks before the
// quarter being planned. Recency over seasonality - parts prices trend and
// labor rates move. Weeks with no plan for a tech don't count against them.
async function quarterAnchor({ year, quarter, today, settings }) {
  const cal = fiscalCalendar(year, settings);
  const q = cal.quarters[quarter - 1];
  const windowEnd = addDays(q.start, -1);
  const windowStart = addDays(q.start, -52 * 7);
  const acc = {};
  // Walk back through the quarters that overlap the window (at most 5).
  let y = year, qq = quarter;
  for (let i = 0; i < 6; i++) {
    qq -= 1; if (qq < 1) { qq = 4; y -= 1; }
    const qc = fiscalCalendar(y, settings).quarters[qq - 1];
    if (qc.end < windowStart) break;
    try {
      const b = await buildServiceCommissionBoard({ year: y, quarter: qq, today });
      for (const t of b.techs) {
        const weeks = t.weeks.filter((w) => w.status === "complete" && w.start >= windowStart && w.end <= windowEnd && w.quota > 0);
        if (!weeks.length) continue;
        const a = acc[t.plan.techCode] ||= { weeks: 0, quota: 0, attainment: 0, quarters: 0 };
        a.weeks += weeks.length; a.quota += weeks.reduce((x, w) => x + w.quota, 0); a.attainment += weeks.reduce((x, w) => x + w.attainment, 0); a.quarters++;
      }
    } catch (err) { console.warn("Anchor quarter lookup failed:", err.message); }
  }
  const byCode = {};
  for (const [code, a] of Object.entries(acc)) {
    byCode[code] = { weeklyQuota: r2(a.quota / a.weeks), weeklyAttainment: r2(a.attainment / a.weeks), attainment: r2(a.attainment), quota: r2(a.quota), pct: a.quota > 0 ? r2(a.attainment / a.quota) : null, weeks: a.weeks, quarters: a.quarters };
  }
  return { label: "trailing 52 wks", windowStart, windowEnd, byCode };
}

// Replace the quarter: dept quota + every tech row. Shares are fractions
// (0.125 = 12.5%); the UI may also send weekly $ which is converted here.
export async function saveQuarterPlan({ year, quarter, deptQuota, note = "", techs = [], by = "" }) {
  boardMemo.clear();
  const y = Number(year), qn = Number(quarter);
  if (!Number.isInteger(y) || y < 2020 || y > 2100 || !Number.isInteger(qn) || qn < 1 || qn > 4) throw new Error("Pick a quarter.");
  const dq = Number(String(deptQuota ?? "").replace(/[$,\s]/g, ""));
  if (!(dq >= 0)) throw new Error("Department quarter quota must be a dollar amount.");
  const [settings, techSettingsAll] = await Promise.all([getServiceCompSettings(), getTechSettings()]);
  const q = fiscalCalendar(y, settings).quarters[qn - 1];
  const clean = [];
  for (const t of Array.isArray(techs) ? techs : []) {
    const code = String(t.techCode || "").trim().toUpperCase().slice(0, 10);
    if (!code) continue;
    let share = t.share == null || t.share === "" ? null : Number(String(t.share).replace(/[%\s]/g, ""));
    if (share != null && share > 1.0001) share = share / 100; // typed as a percent
    if (share == null && t.weeklyQuota != null && t.weeklyQuota !== "") { const w = Number(String(t.weeklyQuota).replace(/[$,\s]/g, "")); share = dq > 0 ? (w * q.weeks) / dq : 0; }
    share = share == null || !(share >= 0) ? 0 : r2x(share, 6);
    const ote = Number(String(t.ote ?? t.targetAnnual ?? 0).replace(/[$,\s]/g, ""));
    if (!(ote >= 0)) throw new Error(`${code}: OTE must be a dollar amount.`);
    // Base % is a code-level setting now; the quarter row just records what
    // applied when it was saved.
    const basePct = basePctFor(code, techSettingsAll, t.basePct);
    clean.push({ code, displayName: String(t.displayName || t.name || "").trim().slice(0, 80), share, ote: r2(ote), basePct: r2(basePct), active: t.active !== false, manual: Boolean(t.manual),
      geoMix: normalizeFactor("geoMix", t.geoMix), driveTime: normalizeFactor("driveTime", t.driveTime), tenure: normalizeFactor("tenure", t.tenure) });
  }
  // Shares may add up to MORE than 100% on purpose (Andrew 10/7): assigning
  // techs a little above the dept target is the cushion that lets the dept
  // still hit its number when one tech misses. Only negatives are rejected.
  const allocated = clean.filter((t) => t.active).reduce((a, t) => a + t.share, 0);
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO service_comp_quarters (plan_year, quarter, dept_quota, note, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (plan_year, quarter) DO UPDATE SET dept_quota = EXCLUDED.dept_quota, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [y, qn, r2(dq), String(note || "").slice(0, 300), String(by || "").slice(0, 120)]);
    await client.query(`DELETE FROM service_comp_quarter_techs WHERE plan_year = $1 AND quarter = $2`, [y, qn]);
    for (const t of clean) {
      await client.query(`INSERT INTO service_comp_quarter_techs (plan_year, quarter, tech_code, display_name, share, ote_annual, base_pct, active, manual, geo_mix, drive_time, tenure, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`, [y, qn, t.code, t.displayName, t.share, t.ote, t.basePct, t.active, t.manual, t.geoMix, t.driveTime, t.tenure]);
    }
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
  return { year: y, quarter: qn, deptQuota: r2(dq), allocated: r2x(allocated, 4), techs: clean.length };
}

// ---------------------------------------------------------------------------
// Commission math (the tech tabs' F8 / C19 / F10–F13)
// ---------------------------------------------------------------------------
export function quarterCommission(plan, quarterWeeks, attainment) {
  const share = quarterWeeks / 52;
  const gross = plan.targetAnnual * share * attainment - plan.baseAnnual * share;
  return r2(Math.max(0, gross));
}

// ---------------------------------------------------------------------------
// Weekly attainment from finished SV tickets
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Held until paid (Andrew 10/7) - the sales-commission rule applied to SV
// tickets: a finished ticket (COD or warranty) only counts for attainment
// once its balance is zero. The balance check is the hourly ePASS AR feed
// (epass_ar_current): an invoice listed with a balance > 0 is HELD; one not
// listed is paid. A ticket whose balance was settled by a write-off type of
// payment is LOST and never counts. A held ticket that gets paid before the
// quarter's commission pays out counts in its finish week; one paid after
// that releases into the week it was paid, like a late-paid sales invoice.
// No AR snapshot at all (finance feed never ran) = nothing is held.
// ---------------------------------------------------------------------------
const baseInvoice = (inv) => String(inv || "").toUpperCase().split("-")[0];

export async function invoicePaidStatus(pool, invoices, { lostPattern = DEFAULT_LOST_PAYMENT_TYPES } = {}) {
  const out = { enabled: false, byInvoice: {} };
  const list = [...new Set((invoices || []).map((i) => String(i || "").toUpperCase()).filter(Boolean))];
  if (!list.length) return out;
  const bases = [...new Set(list.map(baseInvoice))];
  let lostRe; try { lostRe = new RegExp(lostPattern, "i"); } catch { lostRe = new RegExp(DEFAULT_LOST_PAYMENT_TYPES, "i"); }
  try {
    // Holds need an AR snapshot; write-offs come from the payment history
    // and are recognized either way.
    const arCount = await pool.query(`SELECT COUNT(*)::int AS n FROM epass_ar_current`);
    out.enabled = (arCount.rows[0]?.n || 0) > 0;
    const [ar, pay] = await Promise.all([
      out.enabled ? pool.query(`SELECT invoice, amount::float AS amount, NULLIF(raw->>'TotalPaymentAmount','')::float AS paid FROM epass_ar_current WHERE invoice = ANY($1) OR split_part(invoice, '-', 1) = ANY($2)`, [list, bases]) : { rows: [] },
      pool.query(`SELECT p.invoice, p.payment_type, p.paid_on, p.amount::float AS amount, p.status, t.description
                    FROM epass_payments p LEFT JOIN epass_payment_types t ON t.code = p.payment_type
                   WHERE p.invoice = ANY($1) OR split_part(p.invoice, '-', 1) = ANY($2)`, [list, bases])
    ]);
    const balance = {};
    for (const r of ar.rows) { const k = baseInvoice(r.invoice); balance[k] = (balance[k] || 0) + ((Number(r.amount) || 0) - (Number.isFinite(r.paid) ? r.paid : 0)); }
    const paidOn = {}, lost = {};
    for (const r of pay.rows) {
      const k = baseInvoice(r.invoice);
      if (/void|revers|cancel|declin/i.test(String(r.status || ""))) continue;
      if (lostRe.test(String(r.payment_type || "")) || lostRe.test(String(r.description || ""))) { lost[k] = r.payment_type || r.description || "write-off"; continue; }
      const d = String(r.paid_on || "").slice(0, 10);
      if (d && (!paidOn[k] || d > paidOn[k])) paidOn[k] = d;
    }
    for (const inv of list) {
      const k = baseInvoice(inv);
      const bal = r2(balance[k] || 0);
      out.byInvoice[inv] = { balance: bal, held: out.enabled && bal > 0.005 && !lost[k], lost: Boolean(lost[k]), lostType: lost[k] || "", paidOn: paidOn[k] || "" };
    }
  } catch (err) {
    // Finance tables missing (feed never ran) -> treat everything as paid.
    out.enabled = false; out.byInvoice = {};
  }
  return out;
}

export async function svTicketsBetween(pool, from, to, { lostPattern } = {}) {
  const r = await pool.query(
    `SELECT invoice, salesperson, salesperson_code, finish_date, service_type, customer_number,
            list_labor, list_parts, (detail->'cost'->>'parts')::numeric AS parts_cost
     FROM sales_order_detail
     WHERE invoice LIKE 'SV%' AND finish_date >= $1 AND finish_date <= $2`, [from, to]);
  const tickets = r.rows.map((t) => ({
    invoice: t.invoice, tech: String(t.salesperson_code || "").toUpperCase(), techName: t.salesperson || "", finishDate: t.finish_date,
    serviceType: t.service_type || "", labor: Number(t.list_labor) || 0, parts: Number(t.list_parts) || 0, partsCost: Number(t.parts_cost) || 0
  }));
  const status = await invoicePaidStatus(pool, tickets.map((t) => t.invoice), { lostPattern });
  for (const t of tickets) {
    const st = status.byInvoice[String(t.invoice).toUpperCase()] || { balance: 0, held: false, lost: false, lostType: "", paidOn: "" };
    Object.assign(t, { balance: st.balance, held: st.held, lost: st.lost, lostType: st.lostType, paidOn: st.paidOn, released: false });
  }
  tickets.paidCheck = status.enabled;
  return tickets;
}

// Tickets finished BEFORE `from` whose balance was paid inside [from, to]
// after their own quarter's commission had already paid out - they release
// into the week they were paid. Looks back 13 months.
export async function svReleasedTicketsBetween(pool, from, to, settings, { lostPattern } = {}) {
  const lookback = addDays(from, -400);
  // Only tickets that actually received a payment inside the window can
  // release into it - find those invoices first (small), then the tickets.
  let paidInvoices;
  try {
    paidInvoices = (await pool.query(`SELECT DISTINCT split_part(invoice, '-', 1) AS inv FROM epass_payments WHERE paid_on >= $1 AND paid_on <= $2 AND invoice LIKE 'SV%'`, [from, to])).rows.map((x) => x.inv);
  } catch { return []; }
  if (!paidInvoices.length) return [];
  const r = await pool.query(
    `SELECT invoice, salesperson, salesperson_code, finish_date, service_type, customer_number,
            list_labor, list_parts, (detail->'cost'->>'parts')::numeric AS parts_cost
     FROM sales_order_detail
     WHERE invoice LIKE 'SV%' AND finish_date >= $1 AND finish_date < $2 AND split_part(invoice, '-', 1) = ANY($3)`, [lookback, from, paidInvoices]);
  if (!r.rows.length) return [];
  const status = await invoicePaidStatus(pool, r.rows.map((t) => t.invoice), { lostPattern });
  if (!status.enabled) return [];
  const out = [];
  for (const t of r.rows) {
    const st = status.byInvoice[String(t.invoice).toUpperCase()];
    if (!st || st.held || st.lost || !st.paidOn || st.paidOn < from || st.paidOn > to) continue;
    const period = fiscalPeriodFor(String(t.finish_date).slice(0, 10), settings);
    const payDate = period ? period.cal.quarters[period.quarter - 1].payDate : null;
    if (!payDate || st.paidOn <= payDate) continue; // paid in time - counted in its own quarter
    out.push({ invoice: t.invoice, tech: String(t.salesperson_code || "").toUpperCase(), techName: t.salesperson || "", finishDate: t.finish_date, serviceType: t.service_type || "",
      labor: Number(t.list_labor) || 0, parts: Number(t.list_parts) || 0, partsCost: Number(t.parts_cost) || 0, balance: 0, held: false, lost: false, lostType: "", paidOn: st.paidOn, released: true, countDate: st.paidOn });
  }
  return out;
}

// Short memo: the quarter editor's trailing-52-week anchor builds up to five
// earlier quarters per load, and the tech pages hit the same board. Saves
// (quarter plan, credits, settings) clear it; otherwise entries live 2 min.
const boardMemo = new Map();
const BOARD_MEMO_MS = 2 * 60 * 1000;
export function clearServiceBoardMemo() { boardMemo.clear(); }
export async function buildServiceCommissionBoard(opts = {}) {
  const key = JSON.stringify([opts.year ?? "", opts.quarter ?? "", opts.today ?? "", opts.techCode ?? ""]);
  const hit = boardMemo.get(key);
  if (hit && Date.now() - hit.at < BOARD_MEMO_MS) return hit.promise;
  const promise = buildServiceCommissionBoardFresh(opts);
  boardMemo.set(key, { at: Date.now(), promise });
  promise.catch(() => boardMemo.delete(key));
  if (boardMemo.size > 60) { const oldest = [...boardMemo.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) boardMemo.delete(oldest[0]); }
  return promise;
}
async function buildServiceCommissionBoardFresh({ year, quarter, today = new Date().toISOString().slice(0, 10), techCode = "" } = {}) {
  const pool = await getReadyPool();
  const settings = await getServiceCompSettings();
  const cur = fiscalPeriodFor(today, settings);
  const y = Number(year) || cur?.year || Number(today.slice(0, 4));
  const cal = fiscalCalendar(y, settings);
  const q = cal.quarters[(Number(quarter) || (cur && cur.year === y ? cur.quarter : 1)) - 1] || cal.quarters[0];
  const weeks = cal.weeks.filter((w) => w.quarter === q.q);
  const directory = await listEmployeeDirectory();
  const lostPattern = settings.lostPaymentTypes;
  const [resolved, finished, released, credits, fuelRows] = await Promise.all([
    resolveQuarterPlans({ year: y, q, settings, directory }),
    svTicketsBetween(pool, q.start, q.end, { lostPattern }),
    svReleasedTicketsBetween(pool, q.start, q.end, settings, { lostPattern }).catch((err) => { console.warn("Released tickets lookup failed:", err.message); return []; }),
    pool.query(`SELECT id, tech_code, week_start::text AS week_start, amount, note, created_by FROM service_comp_credits WHERE week_start >= $1 AND week_start <= $2 ORDER BY week_start, id`, [q.start, q.end]),
    listFuelReceiptsBetween(q.start, q.end).catch((err) => { console.warn("Fuel receipts lookup failed:", err.message); return []; })
  ]);
  const plans = resolved.plans;
  const paidCheck = Boolean(finished.paidCheck);
  // Every ticket carries the date it counts in: finish date, or for a
  // late-paid release the date it was paid.
  for (const t of finished) {
    t.countDate = t.finishDate;
    // Paid only after this quarter's check went out: it counts in the
    // quarter it was paid in (see svReleasedTicketsBetween), not here.
    t.deferred = Boolean(paidCheck && !t.held && !t.lost && t.paidOn && t.paidOn > q.payDate);
  }
  const tickets = [...finished.filter((t) => !t.deferred), ...released];
  const deferred = finished.filter((t) => t.deferred);
  const wantCode = String(techCode || "").toUpperCase();
  const burdenPct = Number(settings.burdenPct) || 0;
  const techs = plans.filter((p) => p.active && (!wantCode || p.techCode === wantCode)).map((plan) => {
    const rows = weeks.map((w) => {
      const all = tickets.filter((t) => t.tech === plan.techCode && t.countDate >= w.start && t.countDate <= w.end);
      // Only paid tickets count. Held = balance still open; lost = written off.
      const mine = all.filter((t) => !t.held && !t.lost);
      const heldT = all.filter((t) => t.held), lostT = all.filter((t) => t.lost), releasedT = mine.filter((t) => t.released);
      const valueOf = (t) => t.serviceType === "COD" ? t.labor + t.parts - t.partsCost : t.labor;
      const cod = mine.filter((t) => t.serviceType === "COD"), mfg = mine.filter((t) => t.serviceType === "Manufacturer Warranty"), waca = mine.filter((t) => t.serviceType === "WACA Warranty");
      const codLabor = r2(cod.reduce((a, t) => a + t.labor, 0));
      const codPartsMargin = r2(cod.reduce((a, t) => a + t.parts - t.partsCost, 0));
      const wtyLabor = r2([...mfg, ...waca].reduce((a, t) => a + t.labor, 0));
      const held = r2(heldT.reduce((a, t) => a + valueOf(t), 0)), lost = r2(lostT.reduce((a, t) => a + valueOf(t), 0)), releasedAmt = r2(releasedT.reduce((a, t) => a + valueOf(t), 0));
      const creditRows = credits.rows.filter((c) => c.tech_code === plan.techCode && String(c.week_start).slice(0, 10) === w.start).map((c) => ({ id: Number(c.id), amount: Number(c.amount), note: c.note, by: c.created_by }));
      const credit = r2(creditRows.reduce((a, c) => a + c.amount, 0));
      const attainment = r2(codLabor + codPartsMargin + wtyLabor + credit);
      const status = w.end < today ? "complete" : w.start <= today ? "current" : "future";
      return { ...w, status, codLabor, codPartsMargin, wtyLabor, credit, credits: creditRows, attainment, quota: plan.weeklyQuota, pct: plan.weeklyQuota > 0 ? r2(attainment / plan.weeklyQuota) : null, tickets: mine.length, codTickets: cod.length, wtyTickets: mfg.length + waca.length,
        held, heldTickets: heldT.length, heldList: heldT.map((t) => ({ invoice: t.invoice, value: r2(valueOf(t)), balance: t.balance, serviceType: t.serviceType })),
        lost, lostTickets: lostT.length, lostList: lostT.map((t) => ({ invoice: t.invoice, value: r2(valueOf(t)), type: t.lostType, serviceType: t.serviceType })),
        released: releasedAmt, releasedTickets: releasedT.length, releasedList: releasedT.map((t) => ({ invoice: t.invoice, value: r2(valueOf(t)), finishDate: t.finishDate, paidOn: t.paidOn })) };
    });
    const complete = rows.filter((r) => r.status === "complete");
    const current = rows.find((r) => r.status === "current") || null;
    const toDate = r2(complete.reduce((a, r) => a + r.attainment, 0));
    const quotaToDate = r2(plan.weeklyQuota * complete.length);
    const pct = quotaToDate > 0 ? r2(toDate / quotaToDate) : null;
    const qWeeks = q.weeks;
    const remaining = qWeeks - complete.length;
    const quarterQuota = r2(plan.weeklyQuota * qWeeks);
    const projected = pct == null ? null : quarterCommission(plan, qWeeks, pct);
    const at100 = quarterCommission(plan, qWeeks, 1);
    const perPoint = r2(plan.targetAnnual * (qWeeks / 52) / 100);
    const neededPerWeek = remaining > 0 ? r2(Math.max(0, quarterQuota - toDate - (current?.attainment || 0)) / remaining) : null;
    const breakEven = plan.targetAnnual > 0 ? r2(plan.baseAnnual / plan.targetAnnual) : null; // attainment where commission starts
    // Fuel: this tech's card receipts (by directory email) in the quarter.
    const myFuel = plan.email ? fuelRows.filter((f) => f.email === plan.email) : [];
    const fuelByWeek = rows.map((w) => r2(myFuel.filter((f) => f.spentOn >= w.start && f.spentOn <= w.end).reduce((a, f) => a + f.amount, 0)));
    const fuelToDate = r2(myFuel.reduce((a, f) => a + f.amount, 0));
    const elapsed = complete.length + (current ? 1 : 0);
    const fuelProjected = elapsed > 0 ? r2(fuelToDate / elapsed * qWeeks) : null;
    // Profitability (managers): what the quarter is on track to bring in -
    // labor + parts margin, i.e. attainment less manual credits - against
    // what it costs: the base guarantee for the quarter, the trending
    // commission, payroll burden on both, and fuel. Credits are excluded
    // from the gross-profit side (they aren't dollars from tickets).
    const creditTotal = r2(rows.reduce((a, r) => a + r.credit, 0));
    const gpToDate = r2(toDate + (current?.attainment || 0) - creditTotal);
    const gpProjected = pct == null ? null : r2(pct * quarterQuota - creditTotal * (qWeeks / Math.max(1, elapsed)));
    const basePay = r2(plan.baseAnnual * (qWeeks / 52));
    const profit = (gp, commission, fuel) => {
      if (gp == null || commission == null) return null;
      const burden = r2((basePay + commission) * burdenPct / 100);
      const cost = r2(basePay + commission + burden + (fuel || 0));
      return { gp, basePay, commission, burden, fuel: r2(fuel || 0), cost, net: r2(gp - cost), pct: gp > 0 ? r2x((gp - cost) / gp, 4) : null };
    };
    return {
      plan, weeks: rows,
      fuel: { toDate: fuelToDate, projected: fuelProjected, receipts: myFuel.length, byWeek: fuelByWeek, keywordMatched: myFuel.filter((f) => f.keyword).length, hasEmail: Boolean(plan.email) },
      profit: { projected: profit(gpProjected, projected, fuelProjected), at100: profit(r2(quarterQuota), at100, fuelProjected ?? fuelToDate), toDate: { gp: gpToDate, fuel: fuelToDate } },
      summary: { completedWeeks: complete.length, quarterWeeks: qWeeks, remainingWeeks: remaining, attainmentToDate: toDate, quotaToDate, pct, quarterQuota, projectedCommission: projected, commissionAt100: at100, perAttainmentPoint: perPoint, neededPerWeek, breakEvenPct: breakEven, currentWeek: current ? { n: current.n, attainment: current.attainment, pct: current.pct } : null, payDate: q.payDate,
        codLabor: r2(rows.reduce((a, r) => a + r.codLabor, 0)), codPartsMargin: r2(rows.reduce((a, r) => a + r.codPartsMargin, 0)), wtyLabor: r2(rows.reduce((a, r) => a + r.wtyLabor, 0)), credit: creditTotal,
        held: r2(rows.reduce((a, r) => a + r.held, 0)), heldTickets: rows.reduce((a, r) => a + r.heldTickets, 0), lost: r2(rows.reduce((a, r) => a + r.lost, 0)), lostTickets: rows.reduce((a, r) => a + r.lostTickets, 0), released: r2(rows.reduce((a, r) => a + r.released, 0)), releasedTickets: rows.reduce((a, r) => a + r.releasedTickets, 0) }
    };
  });
  // House credit (Andrew 10/7): labor + COD parts margin on finished SV
  // tickets written to anyone who is NOT a tech on the plan - office staff,
  // the house code, techs without a plan - rolled into one line. It counts
  // toward the department's gross profit (nobody is paid commission on it)
  // and shows beside the techs on the board.
  const planned = new Set(plans.map((p) => p.techCode));
  const houseTickets = tickets.filter((t) => !planned.has(t.tech));
  const houseWeek = (w) => {
    const all = houseTickets.filter((t) => t.countDate >= w.start && t.countDate <= w.end);
    const mine = all.filter((t) => !t.held && !t.lost);
    const valueOf = (t) => t.serviceType === "COD" ? t.labor + t.parts - t.partsCost : t.labor;
    const cod = mine.filter((t) => t.serviceType === "COD"), wty = mine.filter((t) => t.serviceType === "Manufacturer Warranty" || t.serviceType === "WACA Warranty");
    const codLabor = r2(cod.reduce((a, t) => a + t.labor, 0)), codPartsMargin = r2(cod.reduce((a, t) => a + t.parts - t.partsCost, 0)), wtyLabor = r2(wty.reduce((a, t) => a + t.labor, 0));
    const status = w.end < today ? "complete" : w.start <= today ? "current" : "future";
    return { ...w, status, codLabor, codPartsMargin, wtyLabor, attainment: r2(codLabor + codPartsMargin + wtyLabor), tickets: mine.length,
      held: r2(all.filter((t) => t.held).reduce((a, t) => a + valueOf(t), 0)), heldTickets: all.filter((t) => t.held).length, lost: r2(all.filter((t) => t.lost).reduce((a, t) => a + valueOf(t), 0)), lostTickets: all.filter((t) => t.lost).length };
  };
  const houseRows = wantCode ? [] : weeks.map(houseWeek);
  const houseComplete = houseRows.filter((r) => r.status === "complete"), houseCurrent = houseRows.find((r) => r.status === "current") || null;
  const houseToDate = r2(houseRows.filter((r) => r.status !== "future").reduce((a, r) => a + r.attainment, 0));
  const houseElapsed = houseComplete.length + (houseCurrent ? 1 : 0);
  const house = wantCode ? null : {
    weeks: houseRows, toDate: houseToDate, completedToDate: r2(houseComplete.reduce((a, r) => a + r.attainment, 0)), tickets: houseTickets.length,
    codLabor: r2(houseRows.reduce((a, r) => a + r.codLabor, 0)), codPartsMargin: r2(houseRows.reduce((a, r) => a + r.codPartsMargin, 0)), wtyLabor: r2(houseRows.reduce((a, r) => a + r.wtyLabor, 0)),
    projected: houseElapsed > 0 ? r2(houseToDate / houseElapsed * q.weeks) : null,
    held: r2(houseRows.reduce((a, r) => a + r.held, 0)), heldTickets: houseRows.reduce((a, r) => a + r.heldTickets, 0), lost: r2(houseRows.reduce((a, r) => a + r.lost, 0)), lostTickets: houseRows.reduce((a, r) => a + r.lostTickets, 0),
    byCode: Object.values(houseTickets.filter((t) => !t.held && !t.lost).reduce((m, t) => { const k = t.tech || "(none)"; m[k] ||= { techCode: k, techName: t.techName || "", tickets: 0, attainment: 0 }; m[k].tickets++; m[k].attainment = r2(m[k].attainment + (t.serviceType === "COD" ? t.labor + t.parts - t.partsCost : t.labor)); return m; }, {})).sort((a, b) => b.attainment - a.attainment)
  };
  // Department roll-up of the profitability estimate (house credit adds to
  // gross profit with no pay against it).
  const sumProfit = (key) => {
    const parts = techs.map((t) => t.profit[key]).filter(Boolean);
    if (!parts.length) return null;
    const houseGp = house ? (key === "projected" ? (house.projected || 0) : (house.projected ?? house.toDate)) : 0;
    const gp = r2(parts.reduce((a, p) => a + p.gp, 0) + houseGp), cost = r2(parts.reduce((a, p) => a + p.cost, 0));
    return { gp, houseGp: r2(houseGp), basePay: r2(parts.reduce((a, p) => a + p.basePay, 0)), commission: r2(parts.reduce((a, p) => a + p.commission, 0)), burden: r2(parts.reduce((a, p) => a + p.burden, 0)), fuel: r2(parts.reduce((a, p) => a + p.fuel, 0)), cost, net: r2(gp - cost), pct: gp > 0 ? r2x((gp - cost) / gp, 4) : null, techs: parts.length };
  };
  const fuelUnmatched = fuelRows.filter((f) => !techs.some((t) => t.plan.email && t.plan.email === f.email));
  // unplanned techs with SV tickets this quarter (so the manager can add them)
  const unplanned = {};
  for (const t of tickets) if (t.tech && !planned.has(t.tech)) { unplanned[t.tech] ||= { techCode: t.tech, techName: t.techName, tickets: 0 }; unplanned[t.tech].tickets++; }
  const dataThrough = finished.reduce((m, t) => (t.finishDate > m ? t.finishDate : m), "");
  return {
    year: y, quarter: q, quarters: cal.quarters.map((x) => ({ q: x.q, start: x.start, end: x.end, weeks: x.weeks, payDate: x.payDate })), today, current: cur ? { year: cur.year, quarter: cur.quarter, week: cur.week } : null,
    settings: { weekOneStart: cal.weekOneStart, weekOneStartAll: settings.weekOneStart, quarterWeeks: settings.quarterWeeks, payLagDays: settings.payLagDays, burdenPct, lostPaymentTypes: settings.lostPaymentTypes },
    paidCheck,
    paid: { held: r2(tickets.filter((t) => t.held).reduce((a, t) => a + (t.serviceType === "COD" ? t.labor + t.parts - t.partsCost : t.labor), 0)), heldTickets: tickets.filter((t) => t.held).length,
      lost: r2(tickets.filter((t) => t.lost).reduce((a, t) => a + (t.serviceType === "COD" ? t.labor + t.parts - t.partsCost : t.labor), 0)), lostTickets: tickets.filter((t) => t.lost).length,
      released: r2(released.reduce((a, t) => a + (t.serviceType === "COD" ? t.labor + t.parts - t.partsCost : t.labor), 0)), releasedTickets: released.length,
      deferred: r2(deferred.reduce((a, t) => a + (t.serviceType === "COD" ? t.labor + t.parts - t.partsCost : t.labor), 0)), deferredTickets: deferred.length },
    planModel: resolved.model, dept: resolved.dept ? { deptQuota: resolved.dept.deptQuota, weekly: r2(resolved.dept.deptQuota / q.weeks), allocated: r2x(plans.reduce((a, p) => a + (p.share || 0), 0), 4) } : null,
    profit: { projected: sumProfit("projected"), at100: sumProfit("at100") },
    fuel: { total: r2(fuelRows.reduce((a, f) => a + f.amount, 0)), receipts: fuelRows.length, unmatched: r2(fuelUnmatched.reduce((a, f) => a + f.amount, 0)), unmatchedReceipts: fuelUnmatched.length, unmatchedFilers: [...new Set(fuelUnmatched.map((f) => f.name || f.email))].slice(0, 12) },
    techs, house, unplanned: Object.values(unplanned), dataThrough, ticketCount: tickets.length
  };
}

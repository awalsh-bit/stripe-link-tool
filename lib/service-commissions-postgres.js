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
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => { const d = new Date(isoDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

// ---------------------------------------------------------------------------
// Fiscal calendar
// ---------------------------------------------------------------------------
export const DEFAULT_QUARTER_WEEKS = [12, 14, 12, 14];

export function defaultWeekOneStart(year) {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  jan1.setUTCDate(jan1.getUTCDate() - jan1.getUTCDay()); // back to Sunday
  return iso(jan1);
}

export async function getServiceCompSettings() {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT key, value FROM service_comp_settings`);
  const out = { weekOneStart: {}, quarterWeeks: DEFAULT_QUARTER_WEEKS.slice(), payLagDays: 20, qualifyingTitles: null, burdenPct: 0 };
  for (const row of r.rows) {
    if (row.key === "week_one_start" && row.value && typeof row.value === "object") out.weekOneStart = row.value;
    if (row.key === "quarter_weeks" && Array.isArray(row.value) && row.value.length === 4) out.quarterWeeks = row.value.map((n) => Number(n) || 13);
    if (row.key === "pay_lag_days" && Number.isFinite(Number(row.value))) out.payLagDays = Number(row.value);
    if (row.key === "qualifying_titles" && Array.isArray(row.value)) out.qualifyingTitles = row.value.map(String);
    if (row.key === "payroll_burden_pct" && Number.isFinite(Number(row.value))) out.burdenPct = Number(row.value);
  }
  return out;
}
export async function setServiceCompSetting(key, value) {
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
  const code = String(techCode || "").trim().toUpperCase().slice(0, 10);
  if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart || ""))) throw new Error("Tech and week are required.");
  const amt = Number(String(amount).replace(/[$,]/g, "")); if (!Number.isFinite(amt) || amt === 0) throw new Error("Give a non-zero credit amount.");
  const pool = await getReadyPool();
  const r = await pool.query(`INSERT INTO service_comp_credits (tech_code, week_start, amount, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [code, weekStart, r2(amt), String(note || "").slice(0, 200), String(by || "").slice(0, 120)]);
  return r.rows[0];
}
export async function deleteServiceCompCredit(id) {
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
  return { techCode: row.tech_code, displayName: row.display_name || "", share: Number(row.share) || 0, ote: Number(row.ote_annual) || 0, basePct: row.base_pct == null ? 60 : Number(row.base_pct), active: row.active !== false, manual: Boolean(row.manual) };
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
  const rows = await getQuarterRows(year, q.q);
  if (rows.dept) {
    const weeks = q.weeks || 13;
    const dir = directory || await listEmployeeDirectory();
    const byCode = new Map(dir.map((e) => [String(e.code).toUpperCase(), e]));
    const plans = rows.techs.filter((t) => t.active).map((t) => {
      const weeklyQuota = r2(rows.dept.deptQuota * t.share / weeks);
      const e = byCode.get(t.techCode);
      return { techCode: t.techCode, year, displayName: t.displayName || e?.name || t.techCode, email: String(e?.email || "").toLowerCase(), weeklyQuota, yearWeeklyQuota: weeklyQuota, quarterQuotas: {}, targetAnnual: t.ote, ote: t.ote, basePct: t.basePct, baseAnnual: r2(t.ote * t.basePct / 100), baseIsDefault: t.basePct === 60, share: t.share, active: true, manual: t.manual };
    });
    return { plans, model: "quarter", dept: rows.dept };
  }
  const legacy = await listServiceCompPlans(year);
  const dir = directory || await listEmployeeDirectory();
  const byCode = new Map(dir.map((e) => [String(e.code).toUpperCase(), e]));
  const plans = legacy.filter((p) => p.active).map((p0) => { const wq = weeklyQuotaFor(p0, q.q); return { ...p0, weeklyQuota: wq, yearWeeklyQuota: p0.weeklyQuota, ote: p0.targetAnnual, email: String(byCode.get(p0.techCode)?.email || "").toLowerCase(), share: null, manual: false }; });
  return { plans, model: "legacy", dept: null };
}

// Everything the quarter editor shows: the dept quota (seeded from the
// legacy rows the first time), the qualifying titles, and one row per tech
// - directory techs by job title, plus hand-added or dropped ones.
export async function getQuarterPlanEditor({ year, quarter, today }) {
  const settings = await getServiceCompSettings();
  const cal = fiscalCalendar(year, settings);
  const q = cal.quarters[quarter - 1] || cal.quarters[0];
  const [directory, titles, rows, legacy] = await Promise.all([listEmployeeDirectory(), listJobTitles(), getQuarterRows(year, q.q), listServiceCompPlans(year)]);
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
      share: sv ? sv.share : 0, ote: sv ? sv.ote : (legacyByCode.get(code)?.targetAnnual || 0), basePct: sv ? sv.basePct : (legacyByCode.get(code)?.basePct ?? 60),
      active: sv ? sv.active : true, manual: sv ? sv.manual : !qualSet.has(code), saved: saved.has(code)
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return {
    year, quarter: { q: q.q, start: q.start, end: q.end, weeks: q.weeks, payDate: q.payDate },
    dept: rows.dept || { deptQuota: seedDept || 0, note: "", updatedBy: "", updatedAt: null },
    seeded, seedFrom, weeks: q.weeks,
    titles: titles.map((t) => ({ name: t.name, code: t.code || "", holders: directory.filter((e) => !e.archived && normTitle(e.commissionPlan) === normTitle(t.name)).length })),
    qualifyingTitles: settings.qualifyingTitles ?? titles.filter((t) => DEFAULT_QUALIFYING_TITLE_RE.test(t.name)).map((t) => t.name),
    qualifyingIsDefault: settings.qualifyingTitles == null,
    burdenPct: settings.burdenPct,
    techs
  };
}
const r2x = (n, d) => { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; };

// Replace the quarter: dept quota + every tech row. Shares are fractions
// (0.125 = 12.5%); the UI may also send weekly $ which is converted here.
export async function saveQuarterPlan({ year, quarter, deptQuota, note = "", techs = [], by = "" }) {
  const y = Number(year), qn = Number(quarter);
  if (!Number.isInteger(y) || y < 2020 || y > 2100 || !Number.isInteger(qn) || qn < 1 || qn > 4) throw new Error("Pick a quarter.");
  const dq = Number(String(deptQuota ?? "").replace(/[$,\s]/g, ""));
  if (!(dq >= 0)) throw new Error("Department quarter quota must be a dollar amount.");
  const settings = await getServiceCompSettings();
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
    let basePct = t.basePct == null || t.basePct === "" ? 60 : Number(String(t.basePct).replace(/[%\s]/g, ""));
    if (!(basePct >= 0 && basePct <= 100)) throw new Error(`${code}: base guarantee is a percent of OTE (0-100).`);
    clean.push({ code, displayName: String(t.displayName || t.name || "").trim().slice(0, 80), share, ote: r2(ote), basePct: r2(basePct), active: t.active !== false, manual: Boolean(t.manual) });
  }
  const allocated = clean.filter((t) => t.active).reduce((a, t) => a + t.share, 0);
  if (allocated > 1.0005) throw new Error(`Shares add up to ${Math.round(allocated * 1000) / 10}% - more than the department quota.`);
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO service_comp_quarters (plan_year, quarter, dept_quota, note, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (plan_year, quarter) DO UPDATE SET dept_quota = EXCLUDED.dept_quota, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [y, qn, r2(dq), String(note || "").slice(0, 300), String(by || "").slice(0, 120)]);
    await client.query(`DELETE FROM service_comp_quarter_techs WHERE plan_year = $1 AND quarter = $2`, [y, qn]);
    for (const t of clean) {
      await client.query(`INSERT INTO service_comp_quarter_techs (plan_year, quarter, tech_code, display_name, share, ote_annual, base_pct, active, manual, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`, [y, qn, t.code, t.displayName, t.share, t.ote, t.basePct, t.active, t.manual]);
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
export async function svTicketsBetween(pool, from, to) {
  const r = await pool.query(
    `SELECT invoice, salesperson, salesperson_code, finish_date, service_type, customer_number,
            list_labor, list_parts, (detail->'cost'->>'parts')::numeric AS parts_cost
     FROM sales_order_detail
     WHERE invoice LIKE 'SV%' AND finish_date >= $1 AND finish_date <= $2`, [from, to]);
  return r.rows.map((t) => ({
    invoice: t.invoice, tech: String(t.salesperson_code || "").toUpperCase(), techName: t.salesperson || "", finishDate: t.finish_date,
    serviceType: t.service_type || "", labor: Number(t.list_labor) || 0, parts: Number(t.list_parts) || 0, partsCost: Number(t.parts_cost) || 0
  }));
}

export async function buildServiceCommissionBoard({ year, quarter, today = new Date().toISOString().slice(0, 10), techCode = "" } = {}) {
  const pool = await getReadyPool();
  const settings = await getServiceCompSettings();
  const cur = fiscalPeriodFor(today, settings);
  const y = Number(year) || cur?.year || Number(today.slice(0, 4));
  const cal = fiscalCalendar(y, settings);
  const q = cal.quarters[(Number(quarter) || (cur && cur.year === y ? cur.quarter : 1)) - 1] || cal.quarters[0];
  const weeks = cal.weeks.filter((w) => w.quarter === q.q);
  const directory = await listEmployeeDirectory();
  const [resolved, tickets, credits, fuelRows] = await Promise.all([
    resolveQuarterPlans({ year: y, q, settings, directory }),
    svTicketsBetween(pool, q.start, q.end),
    pool.query(`SELECT id, tech_code, week_start::text AS week_start, amount, note, created_by FROM service_comp_credits WHERE week_start >= $1 AND week_start <= $2 ORDER BY week_start, id`, [q.start, q.end]),
    listFuelReceiptsBetween(q.start, q.end).catch((err) => { console.warn("Fuel receipts lookup failed:", err.message); return []; })
  ]);
  const plans = resolved.plans;
  const wantCode = String(techCode || "").toUpperCase();
  const burdenPct = Number(settings.burdenPct) || 0;
  const techs = plans.filter((p) => p.active && (!wantCode || p.techCode === wantCode)).map((plan) => {
    const rows = weeks.map((w) => {
      const mine = tickets.filter((t) => t.tech === plan.techCode && t.finishDate >= w.start && t.finishDate <= w.end);
      const cod = mine.filter((t) => t.serviceType === "COD"), mfg = mine.filter((t) => t.serviceType === "Manufacturer Warranty"), waca = mine.filter((t) => t.serviceType === "WACA Warranty");
      const codLabor = r2(cod.reduce((a, t) => a + t.labor, 0));
      const codPartsMargin = r2(cod.reduce((a, t) => a + t.parts - t.partsCost, 0));
      const wtyLabor = r2([...mfg, ...waca].reduce((a, t) => a + t.labor, 0));
      const creditRows = credits.rows.filter((c) => c.tech_code === plan.techCode && String(c.week_start).slice(0, 10) === w.start).map((c) => ({ id: Number(c.id), amount: Number(c.amount), note: c.note, by: c.created_by }));
      const credit = r2(creditRows.reduce((a, c) => a + c.amount, 0));
      const attainment = r2(codLabor + codPartsMargin + wtyLabor + credit);
      const status = w.end < today ? "complete" : w.start <= today ? "current" : "future";
      return { ...w, status, codLabor, codPartsMargin, wtyLabor, credit, credits: creditRows, attainment, quota: plan.weeklyQuota, pct: plan.weeklyQuota > 0 ? r2(attainment / plan.weeklyQuota) : null, tickets: mine.length, codTickets: cod.length, wtyTickets: mfg.length + waca.length };
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
        codLabor: r2(rows.reduce((a, r) => a + r.codLabor, 0)), codPartsMargin: r2(rows.reduce((a, r) => a + r.codPartsMargin, 0)), wtyLabor: r2(rows.reduce((a, r) => a + r.wtyLabor, 0)), credit: creditTotal }
    };
  });
  // Department roll-up of the profitability estimate.
  const sumProfit = (key) => {
    const parts = techs.map((t) => t.profit[key]).filter(Boolean);
    if (!parts.length) return null;
    const gp = r2(parts.reduce((a, p) => a + p.gp, 0)), cost = r2(parts.reduce((a, p) => a + p.cost, 0));
    return { gp, basePay: r2(parts.reduce((a, p) => a + p.basePay, 0)), commission: r2(parts.reduce((a, p) => a + p.commission, 0)), burden: r2(parts.reduce((a, p) => a + p.burden, 0)), fuel: r2(parts.reduce((a, p) => a + p.fuel, 0)), cost, net: r2(gp - cost), pct: gp > 0 ? r2x((gp - cost) / gp, 4) : null, techs: parts.length };
  };
  const fuelUnmatched = fuelRows.filter((f) => !techs.some((t) => t.plan.email && t.plan.email === f.email));
  // unplanned techs with SV tickets this quarter (so the manager can add them)
  const planned = new Set(plans.map((p) => p.techCode));
  const unplanned = {};
  for (const t of tickets) if (t.tech && !planned.has(t.tech)) { unplanned[t.tech] ||= { techCode: t.tech, techName: t.techName, tickets: 0 }; unplanned[t.tech].tickets++; }
  const dataThrough = tickets.reduce((m, t) => (t.finishDate > m ? t.finishDate : m), "");
  return {
    year: y, quarter: q, quarters: cal.quarters.map((x) => ({ q: x.q, start: x.start, end: x.end, weeks: x.weeks, payDate: x.payDate })), today, current: cur ? { year: cur.year, quarter: cur.quarter, week: cur.week } : null,
    settings: { weekOneStart: cal.weekOneStart, weekOneStartAll: settings.weekOneStart, quarterWeeks: settings.quarterWeeks, payLagDays: settings.payLagDays, burdenPct },
    planModel: resolved.model, dept: resolved.dept ? { deptQuota: resolved.dept.deptQuota, weekly: r2(resolved.dept.deptQuota / q.weeks), allocated: r2x(plans.reduce((a, p) => a + (p.share || 0), 0), 4) } : null,
    profit: { projected: sumProfit("projected"), at100: sumProfit("at100") },
    fuel: { total: r2(fuelRows.reduce((a, f) => a + f.amount, 0)), receipts: fuelRows.length, unmatched: r2(fuelUnmatched.reduce((a, f) => a + f.amount, 0)), unmatchedReceipts: fuelUnmatched.length, unmatchedFilers: [...new Set(fuelUnmatched.map((f) => f.name || f.email))].slice(0, 12) },
    techs, unplanned: Object.values(unplanned), dataThrough, ticketCount: tickets.length
  };
}

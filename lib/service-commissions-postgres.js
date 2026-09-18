import { getPostgresPool } from "./data-postgres.js";

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
//   service_comp_credits   manual quota credits per tech per week
//   service_comp_settings  fiscal calendar overrides
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
  const out = { weekOneStart: {}, quarterWeeks: DEFAULT_QUARTER_WEEKS.slice(), payLagDays: 20 };
  for (const row of r.rows) {
    if (row.key === "week_one_start" && row.value && typeof row.value === "object") out.weekOneStart = row.value;
    if (row.key === "quarter_weeks" && Array.isArray(row.value) && row.value.length === 4) out.quarterWeeks = row.value.map((n) => Number(n) || 13);
    if (row.key === "pay_lag_days" && Number.isFinite(Number(row.value))) out.payLagDays = Number(row.value);
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
function mapPlan(row) {
  const target = Number(row.target_annual) || 0;
  return {
    techCode: row.tech_code, year: Number(row.plan_year), displayName: row.display_name || "",
    weeklyQuota: Number(row.weekly_quota) || 0, targetAnnual: target,
    baseAnnual: row.base_annual == null ? r2(target * 0.6) : Number(row.base_annual), baseIsDefault: row.base_annual == null,
    active: row.active !== false, updatedAt: row.updated_at?.toISOString?.() || null
  };
}
export async function listServiceCompPlans(year) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM service_comp_plans WHERE plan_year = $1 ORDER BY display_name, tech_code`, [year]);
  return r.rows.map(mapPlan);
}
export async function upsertServiceCompPlan({ techCode, year, displayName = "", weeklyQuota, targetAnnual, baseAnnual = null, active = true }) {
  const code = String(techCode || "").trim().toUpperCase().slice(0, 10);
  if (!code) throw new Error("Tech code is required.");
  const y = Number(year); if (!Number.isInteger(y) || y < 2020 || y > 2100) throw new Error("Plan year looks wrong.");
  const wq = Number(String(weeklyQuota).replace(/[$,]/g, "")), ta = Number(String(targetAnnual).replace(/[$,]/g, ""));
  if (!(wq >= 0) || !(ta >= 0)) throw new Error("Weekly quota and target annual comp must be numbers.");
  const ba = baseAnnual === "" || baseAnnual == null ? null : Number(String(baseAnnual).replace(/[$,]/g, ""));
  if (ba != null && !(ba >= 0)) throw new Error("Base pay must be a number (or blank for 60% of target).");
  const pool = await getReadyPool();
  const r = await pool.query(
    `INSERT INTO service_comp_plans (tech_code, plan_year, display_name, weekly_quota, target_annual, base_annual, active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (tech_code, plan_year) DO UPDATE SET display_name = EXCLUDED.display_name, weekly_quota = EXCLUDED.weekly_quota, target_annual = EXCLUDED.target_annual, base_annual = EXCLUDED.base_annual, active = EXCLUDED.active, updated_at = NOW()
     RETURNING *`,
    [code, y, String(displayName || "").trim().slice(0, 80), r2(wq), r2(ta), ba == null ? null : r2(ba), active !== false]
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
async function svTicketsBetween(pool, from, to) {
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
  const [plans, tickets, credits] = await Promise.all([
    listServiceCompPlans(y),
    svTicketsBetween(pool, q.start, q.end),
    pool.query(`SELECT id, tech_code, week_start::text AS week_start, amount, note, created_by FROM service_comp_credits WHERE week_start >= $1 AND week_start <= $2 ORDER BY week_start, id`, [q.start, q.end])
  ]);
  const wantCode = String(techCode || "").toUpperCase();
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
    return {
      plan, weeks: rows,
      summary: { completedWeeks: complete.length, quarterWeeks: qWeeks, remainingWeeks: remaining, attainmentToDate: toDate, quotaToDate, pct, quarterQuota, projectedCommission: projected, commissionAt100: at100, perAttainmentPoint: perPoint, neededPerWeek, breakEvenPct: breakEven, currentWeek: current ? { n: current.n, attainment: current.attainment, pct: current.pct } : null, payDate: q.payDate,
        codLabor: r2(rows.reduce((a, r) => a + r.codLabor, 0)), codPartsMargin: r2(rows.reduce((a, r) => a + r.codPartsMargin, 0)), wtyLabor: r2(rows.reduce((a, r) => a + r.wtyLabor, 0)), credit: r2(rows.reduce((a, r) => a + r.credit, 0)) }
    };
  });
  // unplanned techs with SV tickets this quarter (so the manager can add them)
  const planned = new Set(plans.map((p) => p.techCode));
  const unplanned = {};
  for (const t of tickets) if (t.tech && !planned.has(t.tech)) { unplanned[t.tech] ||= { techCode: t.tech, techName: t.techName, tickets: 0 }; unplanned[t.tech].tickets++; }
  const dataThrough = tickets.reduce((m, t) => (t.finishDate > m ? t.finishDate : m), "");
  return {
    year: y, quarter: q, quarters: cal.quarters.map((x) => ({ q: x.q, start: x.start, end: x.end, weeks: x.weeks, payDate: x.payDate })), today, current: cur ? { year: cur.year, quarter: cur.quarter, week: cur.week } : null,
    settings: { weekOneStart: cal.weekOneStart, weekOneStartAll: settings.weekOneStart, quarterWeeks: settings.quarterWeeks, payLagDays: settings.payLagDays },
    techs, unplanned: Object.values(unplanned), dataThrough, ticketCount: tickets.length
  };
}

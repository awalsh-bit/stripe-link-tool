import { getPostgresPool } from "./data-postgres.js";
import { listEmployeeDirectory, listJobTitles } from "./employee-directory.js";
import { listProfileDetails, applyChartReportsTo, listJobSchedules, effectiveSchedule, weeklyHours } from "./employee-profiles-postgres.js";

// ---------------------------------------------------------------------------
// Org Chart (Andrew 11/16). The reporting structure is drawn between JOB
// CODES, not people: "E20 reports to E10". Who a person reports to then
// follows from the job code they hold, so a hire, a promotion or a departure
// re-routes itself without anyone touching a profile.
//
//   org_chart_nodes    one row per job code that is ON the chart, with the
//                      one SOLID line it has (parent_code; '' = top of chart)
//   org_chart_dotted   any number of DOTTED lines from a job code to others
//
// The rules (decided with Andrew):
//   - one solid line per job code;
//   - Reports to = the person in the boss seat. A vacant seat is skipped:
//     the line climbs to the next filled seat up ("the shortest solid line");
//   - a boss seat held by two or more people is never guessed. The person is
//     flagged and HR picks on the profile (mode 'pick'). Until then they stay
//     with whoever they had if that is one of the people in the seat;
//     anyone else is cleared, so their time off goes to HR;
//   - HR can still set one person by hand (mode 'override'); that sticks
//     until it is put back to automatic;
//   - dotted lines change nothing about approval. The people in the dotted
//     seat are told when that person's time off is approved, names and dates
//     only.
// Keys are job_titles.code, the permanent code - relabeling a title never
// moves a box.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS org_chart_nodes (
  job_code TEXT PRIMARY KEY,
  parent_code TEXT NOT NULL DEFAULT '',
  sort INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS org_chart_dotted (
  job_code TEXT NOT NULL,
  to_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (job_code, to_code)
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
const codeOf = (v) => String(v || "").trim().toUpperCase();
const who = (v) => String(v || "").trim().slice(0, 120);

// ---- storage ---------------------------------------------------------------
// { parents: Map(jobCode -> parentCode | ''), dotted: Map(jobCode -> [toCode]) }
export async function listOrgChart() {
  const pool = await getReadyPool();
  const [nodes, dotted] = await Promise.all([
    pool.query(`SELECT job_code, parent_code FROM org_chart_nodes ORDER BY sort, job_code`),
    pool.query(`SELECT job_code, to_code FROM org_chart_dotted ORDER BY job_code, to_code`)
  ]);
  const parents = new Map(nodes.rows.map((r) => [r.job_code, r.parent_code || ""]));
  const lines = new Map();
  for (const r of dotted.rows) { const list = lines.get(r.job_code) || []; list.push(r.to_code); lines.set(r.job_code, list); }
  return { parents, dotted: lines };
}
// Put a job code on the chart under `parentCode` ('' = top of the chart), or
// move it there with everything under it. Refuses a loop.
export async function placeOrgNode(jobCode, parentCode, { byName = "" } = {}) {
  const code = codeOf(jobCode), parent = codeOf(parentCode);
  if (!code) throw new Error("Missing job code.");
  if (parent === code) throw new Error("A job code can't report to itself.");
  const pool = await getReadyPool();
  const { parents } = await listOrgChart();
  if (parent) {
    if (!parents.has(parent)) throw new Error(`${parent} isn't on the chart yet. Place it first.`);
    for (let cur = parent, hops = 0; cur && hops < 200; cur = parents.get(cur) || "", hops++) {
      if (cur === code) throw new Error(`${parent} already sits under ${code}, so that would make a loop. Move ${parent} out from under it first.`);
    }
  }
  await pool.query(
    `INSERT INTO org_chart_nodes (job_code, parent_code, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (job_code) DO UPDATE SET parent_code = EXCLUDED.parent_code, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [code, parent, who(byName)]
  );
  // a dotted line that now duplicates the solid one is redundant
  if (parent) await pool.query(`DELETE FROM org_chart_dotted WHERE job_code = $1 AND to_code = $2`, [code, parent]);
  return { code, parent };
}
// Take a job code off the chart. The boxes under it move up to its boss, and
// its dotted lines (both directions) go with it.
export async function removeOrgNode(jobCode, { byName = "" } = {}) {
  const code = codeOf(jobCode);
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT parent_code FROM org_chart_nodes WHERE job_code = $1 FOR UPDATE`, [code]);
    if (!cur.rows[0]) { await client.query("ROLLBACK"); return null; }
    const parent = cur.rows[0].parent_code || "";
    const moved = await client.query(`UPDATE org_chart_nodes SET parent_code = $2, updated_at = NOW(), updated_by = $3 WHERE parent_code = $1 RETURNING job_code`, [code, parent, who(byName)]);
    await client.query(`DELETE FROM org_chart_dotted WHERE job_code = $1 OR to_code = $1`, [code]);
    // a child moved up may now have a dotted line that duplicates its new solid line
    if (parent) await client.query(`DELETE FROM org_chart_dotted d USING org_chart_nodes n WHERE d.job_code = n.job_code AND n.parent_code = $1 AND d.to_code = $1`, [parent]);
    await client.query(`DELETE FROM org_chart_nodes WHERE job_code = $1`, [code]);
    await client.query("COMMIT");
    return { code, movedUp: moved.rows.map((r) => r.job_code), to: parent };
  } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
}
export async function addOrgDottedLine(jobCode, toCode, { byName = "" } = {}) {
  const code = codeOf(jobCode), to = codeOf(toCode);
  if (!code || !to) throw new Error("Choose both job codes.");
  if (code === to) throw new Error("A dotted line has to go to a different job code.");
  const { parents } = await listOrgChart();
  if (!parents.has(code) || !parents.has(to)) throw new Error("Both job codes have to be on the chart first.");
  if (parents.get(code) === to) throw new Error(`${code} already has its solid line to ${to}.`);
  const pool = await getReadyPool();
  await pool.query(`INSERT INTO org_chart_dotted (job_code, to_code, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [code, to, who(byName)]);
  return { code, to };
}
export async function removeOrgDottedLine(jobCode, toCode) {
  const pool = await getReadyPool();
  const r = await pool.query(`DELETE FROM org_chart_dotted WHERE job_code = $1 AND to_code = $2`, [codeOf(jobCode), codeOf(toCode)]);
  return r.rowCount > 0;
}

// ---- the rules (pure) ------------------------------------------------------
// ctx: { parents: Map, holders: Map(jobCode -> [employeeCode]) } - holders are
// CURRENT employees only, so a departure empties the seat by itself.
//
// -> { status, managerCode, viaJobCode, skipped: [vacant job codes], candidates: [employeeCode] }
//    status  "nocode"    the person has no job code
//            "unplaced"  their job code isn't on the chart
//            "auto"      exactly one person in the nearest filled seat
//            "shared"    that seat has two or more people - HR picks
//            "top"       nothing filled above them (they report to nobody)
export function resolveReportsTo({ employeeCode = "", jobCode = "" }, ctx) {
  const mine = codeOf(jobCode), me = codeOf(employeeCode);
  if (!mine) return { status: "nocode", managerCode: "", viaJobCode: "", skipped: [], candidates: [] };
  if (!ctx.parents.has(mine)) return { status: "unplaced", managerCode: "", viaJobCode: "", skipped: [], candidates: [] };
  const skipped = [];
  for (let cur = ctx.parents.get(mine) || "", hops = 0; cur && hops < 200; cur = ctx.parents.get(cur) || "", hops++) {
    const people = (ctx.holders.get(cur) || []).filter((c) => c !== me);
    if (people.length === 1) return { status: "auto", managerCode: people[0], viaJobCode: cur, skipped, candidates: people };
    if (people.length > 1) return { status: "shared", managerCode: "", viaJobCode: cur, skipped, candidates: people };
    skipped.push(cur); // vacant: keep climbing
  }
  return { status: "top", managerCode: "", viaJobCode: "", skipped, candidates: [] };
}
// The people on the other end of a job code's dotted lines: [{ jobCode, holders: [employeeCode] }].
// No climbing here - a vacant dotted seat is simply nobody.
export function dottedLinesFor(jobCode, ctx, { excluding = "" } = {}) {
  const skip = codeOf(excluding);
  return (ctx.dotted.get(codeOf(jobCode)) || []).filter((to) => ctx.parents.has(to)).map((to) => ({ jobCode: to, holders: (ctx.holders.get(to) || []).filter((c) => c !== skip) }));
}

// ---- everything joined up --------------------------------------------------
// One snapshot of titles, people and the chart. Nodes whose job code no
// longer exists (the title was deleted) are dropped; a box left pointing at
// one is treated as top of the chart.
export async function loadOrgContext() {
  const [entries, titles, details, chart, jobSchedules] = await Promise.all([listEmployeeDirectory(), listJobTitles(), listProfileDetails(), listOrgChart(), listJobSchedules()]);
  const titleByCode = new Map(titles.filter((t) => t.code).map((t) => [codeOf(t.code), t]));
  const codeByTitleName = new Map(titles.filter((t) => t.code).map((t) => [t.name.toLowerCase(), codeOf(t.code)]));
  const jobCodeOf = (e) => codeByTitleName.get(String(e.commissionPlan || "").toLowerCase()) || (titleByCode.has(codeOf(e.jobTitleCode)) ? codeOf(e.jobTitleCode) : "");
  const parents = new Map();
  for (const [code, parent] of chart.parents) if (titleByCode.has(code)) parents.set(code, titleByCode.has(parent) && chart.parents.has(parent) ? parent : "");
  const dotted = new Map();
  for (const [code, list] of chart.dotted) if (parents.has(code)) dotted.set(code, list.filter((to) => parents.has(to)));
  const people = new Map(entries.map((e) => [codeOf(e.code), e]));
  const holders = new Map();
  for (const e of entries) {
    if (e.archived) continue;
    const jc = jobCodeOf(e);
    if (!jc) continue;
    const list = holders.get(jc) || []; list.push(codeOf(e.code)); holders.set(jc, list);
  }
  return { entries, titles, titleByCode, details, people, parents, dotted, holders, jobCodeOf, jobSchedules };
}
// The schedule one person works, and where it comes from: their own
// ("custom") or the default for their job code ("job").
export function scheduleStateFor(entry, ctx) {
  const d = ctx.details.get(codeOf(entry.code)) || {};
  const jobCode = ctx.jobCodeOf(entry);
  const jobSchedule = (jobCode && ctx.jobSchedules.get(jobCode)?.schedule) || {};
  const { schedule, source } = effectiveSchedule(d.schedule || {}, jobSchedule);
  return { schedule, source, weeklyHours: weeklyHours(schedule), scheduleNote: d.scheduleNote || "", jobCode, jobTitle: jobCode ? ctx.titleByCode.get(jobCode)?.name || "" : "", jobSchedule };
}
// Where one person's Reports to stands: the chart's answer plus what is
// stored. source: "auto" | "override" | "pick" | "needs-pick" | "top" | "unplaced" | "nocode"
export function reportsToState(entry, ctx) {
  const code = codeOf(entry.code);
  const d = ctx.details.get(code) || { reportsToCode: "", reportsToMode: "" };
  const r = resolveReportsTo({ employeeCode: code, jobCode: ctx.jobCodeOf(entry) }, ctx);
  const source = d.reportsToMode === "override" ? "override"
    : r.status === "shared" ? (d.reportsToMode === "pick" && d.reportsToCode ? "pick" : "needs-pick")
      : r.status;
  return { ...r, jobCode: ctx.jobCodeOf(entry), source, storedCode: d.reportsToCode || "", mode: d.reportsToMode || "" };
}

// Bring every current employee's stored Reports to in line with the chart.
// Left alone: overrides, HR's pick for a shared boss seat, and anyone whose
// job code isn't on the chart. With a shared seat and no pick, the stored
// manager stands only if they are one of the people in that seat; a leftover
// from somewhere else on the chart is cleared. Returns the changes:
// [{ code, name, from, to }].
let lastSyncAt = 0;
export async function syncOrgReportsTo({ force = false, ctx = null } = {}) {
  if (!force && !ctx && Date.now() - lastSyncAt < 30000) return [];
  const c = ctx || await loadOrgContext();
  const updates = [], changes = [];
  for (const e of c.entries) {
    if (e.archived) continue;
    const s = reportsToState(e, c);
    if (s.mode === "override") continue;
    if (s.status === "shared") {
      if (s.mode === "" && s.storedCode && !s.candidates.includes(s.storedCode)) { updates.push({ code: e.code, reportsToCode: "" }); changes.push({ code: codeOf(e.code), name: e.name, from: s.storedCode, to: "" }); }
      continue;
    }
    if (s.status !== "auto" && s.status !== "top") continue; // unplaced / nocode: not the chart's call
    const want = s.managerCode;
    if (want === s.storedCode && s.mode === "") continue;
    updates.push({ code: e.code, reportsToCode: want });
    if (want !== s.storedCode) changes.push({ code: codeOf(e.code), name: e.name, from: s.storedCode, to: want });
  }
  if (updates.length) await applyChartReportsTo(updates);
  lastSyncAt = Date.now();
  return changes;
}

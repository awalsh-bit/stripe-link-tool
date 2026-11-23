// ---------------------------------------------------------------------------
// Days Wilson is closed, for the shop (Andrew 11/23: "Do I have anywhere today
// to turn off delivery on holidays? Right now users can 'schedule' for
// thanksgiving day").
//
// Two sources, joined in server.js (shopClosedMap):
//   1. The company's paid holidays, from the Time Off policy (lib/employee-
//      profiles-postgres.js: getPtoPolicy + holidayDates). Nothing to enter.
//   2. Extra closed days, kept here and edited on Online Shop Orders ->
//      Closed days: an inventory day, an ice day, a company event.
//
// On a closed day the shop offers no delivery day, no pickup day and no
// showroom visit, and the day doesn't count toward "three working days out".
// ---------------------------------------------------------------------------
import { getPostgresPool } from "./data-postgres.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shop_closed_days (
  day DATE PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL DEFAULT '',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let schemaDone = null;
async function closedPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!schemaDone) schemaDone = pool.query(SCHEMA_SQL).catch((e) => { schemaDone = null; throw e; });
  await schemaDone;
  return pool;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// a real calendar day, yyyy-mm-dd, or ""
export function cleanClosedDay(v) {
  const s = String(v || "").trim();
  if (!ISO.test(s)) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : "";
}
const cleanLabel = (v) => String(v || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);

// Extra closed days from `from` (yyyy-mm-dd) on, soonest first.
export async function listShopClosedDays({ from = "" } = {}) {
  const pool = await closedPool();
  const start = cleanClosedDay(from);
  const r = await pool.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS date, label, added_by FROM shop_closed_days ${start ? "WHERE day >= $1::date" : ""} ORDER BY day`,
    start ? [start] : []
  );
  return r.rows.map((x) => ({ date: x.date, label: x.label || "", addedBy: x.added_by || "" }));
}

export async function addShopClosedDay({ date, label } = {}, byEmail = "", { today = "" } = {}) {
  const day = cleanClosedDay(date);
  if (!day) throw new Error("Pick a date.");
  if (today && day < today) throw new Error("That day has already passed.");
  const pool = await closedPool();
  await pool.query(
    `INSERT INTO shop_closed_days (day, label, added_by) VALUES ($1::date, $2, $3)
     ON CONFLICT (day) DO UPDATE SET label = EXCLUDED.label, added_by = EXCLUDED.added_by, added_at = NOW()`,
    [day, cleanLabel(label), String(byEmail || "").toLowerCase().slice(0, 200)]
  );
  return { date: day, label: cleanLabel(label) };
}

export async function removeShopClosedDay(date) {
  const day = cleanClosedDay(date);
  if (!day) return false;
  const pool = await closedPool();
  return (await pool.query(`DELETE FROM shop_closed_days WHERE day = $1::date`, [day])).rowCount > 0;
}

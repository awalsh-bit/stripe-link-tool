// ---------------------------------------------------------------------------
// Site walk reporting views (step two, part one; 11/18).
//
// Cayden's standalone tool projects every walk into SQL Server tables
// (sql/sitewalk_schema.sql in wilson_site_walks_v0985). On Agility each walk
// is already stored whole in sw_walks.payload, so the same tables are Postgres
// VIEWS over it: lib/site-walk-reporting.sql. Nothing is copied or kept in
// step, and a view always shows the walks as they stand. The views read the
// values the field tool computed; they never decide anything.
//
// This file puts the views in place on start-up, and replaces them when the
// .sql file changes (its hash is kept as the comment on sw_report_walks).
// It never touches Cayden's tables, only the sw_report_* views and functions.
// ---------------------------------------------------------------------------
import fs from "fs";
import crypto from "crypto";
import { getPostgresPool } from "./data-postgres.js";
import { listWalks } from "./site-walk-postgres.js";

const SQL_FILE = new URL("./site-walk-reporting.sql", import.meta.url);

export function siteWalkReportingVersion(sql = fs.readFileSync(SQL_FILE, "utf8")) {
  return "site-walk-reporting " + crypto.createHash("sha1").update(sql).digest("hex").slice(0, 12);
}

export async function ensureSiteWalkReportingViews({ force = false } = {}) {
  const sql = fs.readFileSync(SQL_FILE, "utf8");
  const version = siteWalkReportingVersion(sql);
  if (!String(process.env.DATABASE_URL || "").trim()) return { skipped: "no database" }; // site walks live in Postgres only
  const pool = await getPostgresPool();
  if (!pool) return { skipped: "no database" };
  await listWalks({ limit: 1 }); // Cayden's module makes its tables on first use; the views stand on them
  if (!force) {
    const cur = await pool.query(`SELECT obj_description(to_regclass('sw_report_walks'), 'pg_class') AS v`);
    if (cur.rows[0]?.v === version) return { unchanged: true, version };
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sw_report_views'))");
    // the previous set goes first: views, then the helper functions they use
    const views = await client.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'v' AND c.relname LIKE 'sw\\_report\\_%' AND n.nspname = current_schema()`);
    for (const v of views.rows) await client.query(`DROP VIEW IF EXISTS "${v.relname}" CASCADE`);
    const fns = await client.query(
      `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname LIKE 'sw\\_report\\_%' AND n.nspname = current_schema()`);
    for (const f of fns.rows) await client.query(`DROP FUNCTION IF EXISTS ${f.sig} CASCADE`);
    await client.query(sql);
    await client.query(`COMMENT ON VIEW sw_report_walks IS '${version}'`);
    await client.query("COMMIT");
    return { applied: true, version };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

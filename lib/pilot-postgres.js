import { getPostgresPool } from "./data-postgres.js";
import { PILOT_SEED_JOBS } from "./pilot-seed.js";

// ---------------------------------------------------------------------------
// AJH pilot store (Test Modules, 2026-09-14). Jack's three pilot pages —
// routing, field tool, parts pipeline — were written against one JSON object
// in localStorage (AJH_pilot_developer_handoff.md §1). This is that object
// as one row per job in Postgres, so Andrew's phone and the office share it.
// The pages diff what they changed and post upserts/deletes + log lines; a
// poll with ?since= returns the whole store only when something changed.
// Job records keep the exact shape the pages expect (data JSONB).
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pilot_jobs (
  sv TEXT PRIMARY KEY,
  tech TEXT NOT NULL DEFAULT 'AJH',
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS pilot_log (
  id BIGSERIAL PRIMARY KEY,
  tech TEXT NOT NULL DEFAULT 'AJH',
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  who TEXT NOT NULL DEFAULT '',
  sv TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  by_email TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS pilot_meta (
  tech TEXT PRIMARY KEY,
  updated_ms BIGINT NOT NULL DEFAULT 0,
  seeded_at TIMESTAMPTZ
);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL);
  await ensurePromise;
  return pool;
}
const TECH = "AJH";

async function bump(client) {
  const ms = Date.now();
  await client.query(`INSERT INTO pilot_meta (tech, updated_ms) VALUES ($1, $2) ON CONFLICT (tech) DO UPDATE SET updated_ms = GREATEST(pilot_meta.updated_ms + 1, EXCLUDED.updated_ms)`, [TECH, ms]);
  return (await client.query(`SELECT updated_ms FROM pilot_meta WHERE tech = $1`, [TECH])).rows[0].updated_ms;
}

export async function seedPilotIfEmpty() {
  const pool = await getReadyPool();
  const meta = (await pool.query(`SELECT seeded_at FROM pilot_meta WHERE tech = $1`, [TECH])).rows[0];
  if (meta?.seeded_at) return false;
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM pilot_jobs WHERE tech = $1`, [TECH])).rows[0].n;
  if (!n) await resetPilot("system:seed");
  else await pool.query(`INSERT INTO pilot_meta (tech, updated_ms, seeded_at) VALUES ($1, $2, NOW()) ON CONFLICT (tech) DO UPDATE SET seeded_at = NOW()`, [TECH, Date.now()]);
  return true;
}

export async function resetPilot(byEmail = "") {
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM pilot_jobs WHERE tech = $1`, [TECH]);
    await client.query(`DELETE FROM pilot_log WHERE tech = $1`, [TECH]);
    for (const job of PILOT_SEED_JOBS) {
      await client.query(`INSERT INTO pilot_jobs (sv, tech, data, updated_by) VALUES ($1, $2, $3::jsonb, $4)`, [job.sv, TECH, JSON.stringify(job), byEmail]);
    }
    await client.query(`INSERT INTO pilot_log (tech, who, message, by_email) VALUES ($1, 'Agility', $2, $3)`, [TECH, `Pilot data reset to the ${PILOT_SEED_JOBS.length} seeded tickets`, byEmail]);
    const updated = await bump(client);
    await client.query(`UPDATE pilot_meta SET seeded_at = NOW() WHERE tech = $1`, [TECH]);
    await client.query("COMMIT");
    return { jobs: PILOT_SEED_JOBS.length, updated: Number(updated) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export async function getPilotStore({ since = null } = {}) {
  const pool = await getReadyPool();
  await seedPilotIfEmpty();
  const meta = (await pool.query(`SELECT updated_ms FROM pilot_meta WHERE tech = $1`, [TECH])).rows[0];
  const updated = Number(meta?.updated_ms || 0);
  if (since != null && Number(since) >= updated) return { changed: false, updated };
  const [jobs, log] = await Promise.all([
    pool.query(`SELECT data FROM pilot_jobs WHERE tech = $1 ORDER BY updated_at`, [TECH]),
    pool.query(`SELECT ts, who, message FROM pilot_log WHERE tech = $1 ORDER BY ts DESC, id DESC LIMIT 40`, [TECH])
  ]);
  return { v: 1, changed: true, updated, jobs: jobs.rows.map((r) => r.data), log: log.rows.map((r) => ({ ts: new Date(r.ts).getTime(), who: r.who, msg: r.message })) };
}

// upserts: full job records (page shape); deletes: sv list; log: [{ts, who, msg}]
export async function applyPilotChanges({ upserts = [], deletes = [], log = [] }, byEmail = "") {
  const pool = await getReadyPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let n = 0;
    for (const job of (Array.isArray(upserts) ? upserts : []).slice(0, 200)) {
      if (!job || typeof job !== "object") continue;
      const sv = String(job.sv || "").trim().slice(0, 40);
      if (!sv) continue;
      await client.query(
        `INSERT INTO pilot_jobs (sv, tech, data, updated_by, updated_at) VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (sv) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [sv, TECH, JSON.stringify({ ...job, sv }), byEmail]
      );
      n += 1;
    }
    for (const sv of (Array.isArray(deletes) ? deletes : []).slice(0, 200)) {
      await client.query(`DELETE FROM pilot_jobs WHERE sv = $1 AND tech = $2`, [String(sv).slice(0, 40), TECH]);
    }
    for (const e of (Array.isArray(log) ? log : []).slice(0, 50)) {
      const ts = Number(e?.ts) > 0 ? new Date(Number(e.ts)) : new Date();
      const msg = String(e?.msg || "").slice(0, 400);
      const sv = (msg.match(/\b(SV\d{6,}(?:-\d+)?|TEST-\d+|NEW-[A-Z0-9]+)\b/) || [""])[0];
      await client.query(`INSERT INTO pilot_log (tech, ts, who, sv, message, by_email) VALUES ($1, $2, $3, $4, $5, $6)`, [TECH, ts, String(e?.who || "").slice(0, 60), sv, msg, byEmail]);
    }
    const updated = await bump(client);
    await client.query("COMMIT");
    return { ok: true, upserted: n, deleted: (deletes || []).length, updated: Number(updated) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

// A copy of a live Service Request Queue card into Andrew's backlog —
// additive only, the queue card is untouched (handoff §3).
export async function addPilotJobFromCard(card, byEmail = "") {
  if (!card) throw new Error("Request not found.");
  const unit = (card.units || [])[0] || {};
  const catRaw = String(unit.applianceType || "").toLowerCase();
  const cat = /dish/.test(catRaw) ? "dishwasher" : /refrig|freez|ice|wine/.test(catRaw) ? "refrigerator" : /wash/.test(catRaw) ? "washer" : /dry/.test(catRaw) ? "dryer" : /oven|range|cook|micro/.test(catRaw) ? "oven" : "other";
  const DUR = { dishwasher: 75, refrigerator: 90, washer: 75, dryer: 60, oven: 90, other: 60 };
  const addr = card.serviceAddress || {};
  const zip = String(addr.zip || "").slice(0, 5);
  const brand = String(unit.brand || "").trim();
  const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
  const sv = `Q-${String(card.id || "").replace(/^svc_/, "").slice(-8) || Date.now().toString(36).toUpperCase()}`;
  const job = {
    sv, cust: String(card.customerName || "New customer").slice(0, 80),
    addr: [addr.line1, addr.line2].filter(Boolean).join(" ") + (addr.city ? `, ${addr.city}` : "") + (zip ? ` ${zip}` : ""), zip,
    phone: String(card.customerPhone || "") || null, pref: card.contactMethod === "Phone Call" ? "Call" : card.contactMethod === "Email" ? "Email" : "Text",
    gate: card.gateCode || "—", builtin: false, photos: Array.isArray(card.photos) ? card.photos.length : 0,
    cat, brand, model: String(unit.model || ""), serial: String(unit.serial || ""),
    unit: `${brand ? brand + " " : ""}${unit.applianceType || catLabel}`.trim(),
    problem: String(unit.problemDescription || card.problemDescription || "").slice(0, 600) || null,
    wty: card.purchasedWithin12Months === "Yes", bal: null,
    status: "SO1", bucket: "backlog", day: null, seq: null, win: "AM", eta: null, dur: DUR[cat] || 60,
    reason: `Copied from the Service Request Queue (${card.id}) — the original request is untouched there.`,
    parts: [], partsNeeded: [], source: "copied-from-queue", queueCardId: card.id
  };
  const pool = await getReadyPool();
  await seedPilotIfEmpty();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = (await client.query(`SELECT 1 FROM pilot_jobs WHERE sv = $1`, [sv])).rows[0];
    if (exists) { await client.query("ROLLBACK"); return { job, existed: true }; }
    await client.query(`INSERT INTO pilot_jobs (sv, tech, data, updated_by) VALUES ($1, $2, $3::jsonb, $4)`, [sv, TECH, JSON.stringify(job), byEmail]);
    await client.query(`INSERT INTO pilot_log (tech, who, sv, message, by_email) VALUES ($1, 'Service Request Queue', $2, $3, $4)`, [TECH, sv, `${job.cust} (${sv}) copied into Andrew's backlog by ${byEmail || "the office"}`, byEmail]);
    await bump(client);
    await client.query("COMMIT");
    return { job, existed: false };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export async function listPilotLog(limit = 100) {
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT ts, who, sv, message, by_email FROM pilot_log WHERE tech = $1 ORDER BY ts DESC, id DESC LIMIT $2`, [TECH, limit]);
  return r.rows.map((x) => ({ ts: x.ts.toISOString(), who: x.who, sv: x.sv, message: x.message, byEmail: x.by_email }));
}

import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Client satisfaction survey (Test Modules). Internal-only for now; the
// survey will eventually move to the public side, so responses carry a
// `source` and the schema takes no dependency on internal accounts beyond
// an optional recorded_by email.
// ---------------------------------------------------------------------------

const SATISFACTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS satisfaction_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score INT NOT NULL CHECK (score BETWEEN 1 AND 10),
  priority TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'internal_test',
  recorded_by_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_satisfaction_responses_created_at
  ON satisfaction_responses (created_at DESC);
`;

// The survey's second question — the option list is fixed and validated
// server-side so results stay clean for aggregation.
export const SATISFACTION_PRIORITIES = [
  "The Showroom",
  "Expert Sales Consultants",
  "Professional Installers",
  "Expert Repair Technicians",
  "Competitive Local Pricing on Products and Services"
];

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(SATISFACTION_SCHEMA_SQL);
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }

  await ensurePromise;
  return pool;
}

function mapResponseRow(row) {
  return {
    id: row.id,
    score: Number(row.score),
    priority: row.priority || "",
    source: row.source || "internal_test",
    recordedByEmail: row.recorded_by_email || "",
    createdAt: row.created_at?.toISOString?.() || row.created_at || ""
  };
}

export async function saveSatisfactionResponse({ score, priority, source = "internal_test", recordedByEmail = "" }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO satisfaction_responses (score, priority, source, recorded_by_email)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      Number(score),
      String(priority || "").trim(),
      String(source || "internal_test").trim().slice(0, 40),
      String(recordedByEmail || "").trim().toLowerCase()
    ]
  );
  return mapResponseRow(result.rows[0]);
}

// start/end are YYYY-MM-DD in the app timezone; the caller passes the
// timezone so "today" means the business day, not UTC.
export async function listSatisfactionResponses(startYmd, endYmd, timeZone = "America/Chicago") {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM satisfaction_responses
     WHERE (created_at AT TIME ZONE $3)::date >= $1::date
       AND (created_at AT TIME ZONE $3)::date <= $2::date
     ORDER BY created_at DESC
     LIMIT 5000`,
    [startYmd, endYmd, timeZone]
  );
  return result.rows.map(mapResponseRow);
}

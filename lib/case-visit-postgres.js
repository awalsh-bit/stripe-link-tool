import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Case visit survey (Test Modules). Built for an external use case (security
// check-in + case manager meeting feedback); expected to be temporary in this
// environment — self-contained so it can be lifted out or dropped cleanly.
// ---------------------------------------------------------------------------

const CASE_VISIT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS case_visit_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_rating TEXT CHECK (staff_rating IN ('sad', 'neutral', 'happy')),
  progress TEXT NOT NULL DEFAULT '',
  recorded_by_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single-question windows: each record answers ONE question, so
-- staff_rating is nullable (progress uses '' for unanswered).
ALTER TABLE case_visit_responses ALTER COLUMN staff_rating DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_case_visit_responses_created_at
  ON case_visit_responses (created_at DESC);
`;

export const CASE_VISIT_PROGRESS_OPTIONS = [
  "None",
  "Less than I expected",
  "As much as I expected",
  "More than I expected"
];

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(CASE_VISIT_SCHEMA_SQL);
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }

  await ensurePromise;
  return pool;
}

function mapRow(row) {
  return {
    id: row.id,
    staffRating: row.staff_rating,
    progress: row.progress || "",
    recordedByEmail: row.recorded_by_email || "",
    createdAt: row.created_at?.toISOString?.() || row.created_at || ""
  };
}

export async function saveCaseVisitResponse({ staffRating = null, progress = "", recordedByEmail = "" }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `INSERT INTO case_visit_responses (staff_rating, progress, recorded_by_email)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [
      staffRating ? String(staffRating).trim() : null,
      String(progress || "").trim(),
      String(recordedByEmail || "").trim().toLowerCase()
    ]
  );
  return mapRow(result.rows[0]);
}

// "Change answer" support: the survey saves on first tap and updates the
// same record if the visitor changes their mind before closing the window.
export async function updateCaseVisitResponse(id, { staffRating = null, progress = "" }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE case_visit_responses
     SET staff_rating = COALESCE($2, staff_rating),
         progress = CASE WHEN $3 <> '' THEN $3 ELSE progress END
     WHERE id = $1
     RETURNING *`,
    [id, staffRating ? String(staffRating).trim() : null, String(progress || "").trim()]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function listCaseVisitResponses(startYmd, endYmd, timeZone = "America/Chicago") {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM case_visit_responses
     WHERE (created_at AT TIME ZONE $3)::date >= $1::date
       AND (created_at AT TIME ZONE $3)::date <= $2::date
     ORDER BY created_at DESC
     LIMIT 5000`,
    [startYmd, endYmd, timeZone]
  );
  return result.rows.map(mapRow);
}

import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// HR — candidate profiles + phone screens (the first step of the hiring
// pipeline). Kept deliberately simple and extensible: candidates are the
// durable profile, and pipeline artifacts (phone screens now; interviews,
// offers, etc. later) attach to a candidate.
// ---------------------------------------------------------------------------

const HR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS hr_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  role_applied TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'phone_screen',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_hr_candidates_email ON hr_candidates (LOWER(email));

CREATE TABLE IF NOT EXISTS hr_phone_screens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES hr_candidates(id) ON DELETE CASCADE,
  interviewer_user_id UUID,
  interviewer_name TEXT NOT NULL DEFAULT '',
  screen_date DATE NOT NULL,
  role_applied TEXT NOT NULL DEFAULT '',
  other_roles TEXT NOT NULL DEFAULT '',
  availability_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  comp_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  role_questions TEXT NOT NULL DEFAULT '',
  recommendation TEXT NOT NULL DEFAULT 'maybe',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_hr_phone_screens_candidate ON hr_phone_screens (candidate_id);
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!ensurePromise) {
    ensurePromise = pool.query(HR_SCHEMA_SQL).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
  return pool;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function mapCandidate(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    roleApplied: row.role_applied || "",
    stage: row.stage || "phone_screen",
    createdAt: row.created_at?.toISOString?.() || row.created_at || null,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null,
    screenCount: row.screen_count != null ? Number(row.screen_count) : undefined,
    lastScreenAt: row.last_screen_at?.toISOString?.() || row.last_screen_at || undefined
  };
}

function mapScreen(row) {
  const d = row.screen_date;
  const screenDate = typeof d === "string" ? d.slice(0, 10) : d?.toISOString?.().slice(0, 10) || "";
  return {
    id: row.id,
    candidateId: row.candidate_id,
    interviewerName: row.interviewer_name || "",
    screenDate,
    roleApplied: row.role_applied || "",
    otherRoles: row.other_roles || "",
    availabilityReviewed: Boolean(row.availability_reviewed),
    compReviewed: Boolean(row.comp_reviewed),
    roleQuestions: row.role_questions || "",
    recommendation: row.recommendation || "maybe",
    notes: row.notes || "",
    createdAt: row.created_at?.toISOString?.() || row.created_at || null
  };
}

// Find an existing candidate by email (if given), else create a new one.
// Updates light profile fields when they arrive fuller than what's stored.
export async function findOrCreateCandidate({ name, email, phone, roleApplied }, actorUserId = null) {
  const pool = await getReadyPool();
  const normEmail = normalizeEmail(email);

  if (normEmail) {
    const existing = await pool.query(
      `SELECT * FROM hr_candidates WHERE LOWER(email) = $1 ORDER BY created_at ASC LIMIT 1`,
      [normEmail]
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      const updated = await pool.query(
        `UPDATE hr_candidates
         SET name = COALESCE(NULLIF($2,''), name),
             phone = COALESCE(NULLIF($3,''), phone),
             role_applied = COALESCE(NULLIF($4,''), role_applied),
             updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [row.id, String(name || "").trim(), String(phone || "").trim(), String(roleApplied || "").trim()]
      );
      return mapCandidate(updated.rows[0]);
    }
  }

  const inserted = await pool.query(
    `INSERT INTO hr_candidates (name, email, phone, role_applied, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      String(name || "").trim(),
      normEmail,
      String(phone || "").trim(),
      String(roleApplied || "").trim(),
      actorUserId
    ]
  );
  return mapCandidate(inserted.rows[0]);
}

export async function createPhoneScreen(screen, actorUserId = null) {
  const pool = await getReadyPool();
  const rec = ["advance", "maybe", "pass"].includes(String(screen.recommendation))
    ? screen.recommendation
    : "maybe";

  const result = await pool.query(
    `INSERT INTO hr_phone_screens
       (candidate_id, interviewer_user_id, interviewer_name, screen_date, role_applied,
        other_roles, availability_reviewed, comp_reviewed, role_questions, recommendation, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      screen.candidateId,
      actorUserId,
      String(screen.interviewerName || "").trim(),
      screen.screenDate,
      String(screen.roleApplied || "").trim(),
      String(screen.otherRoles || "").trim(),
      Boolean(screen.availabilityReviewed),
      Boolean(screen.compReviewed),
      String(screen.roleQuestions || "").trim().slice(0, 4000),
      rec,
      String(screen.notes || "").trim().slice(0, 4000),
      actorUserId
    ]
  );
  return mapScreen(result.rows[0]);
}

export async function listCandidates(search = "") {
  const pool = await getReadyPool();
  const q = String(search || "").trim().toLowerCase();
  const params = [];
  let where = "";
  if (q) {
    params.push(`%${q}%`);
    where = `WHERE LOWER(c.name) LIKE $1 OR LOWER(c.email) LIKE $1 OR LOWER(c.role_applied) LIKE $1 OR c.phone LIKE $1`;
  }

  const result = await pool.query(
    `SELECT c.*,
            COUNT(s.id) AS screen_count,
            MAX(s.created_at) AS last_screen_at
     FROM hr_candidates c
     LEFT JOIN hr_phone_screens s ON s.candidate_id = c.id
     ${where}
     GROUP BY c.id
     ORDER BY COALESCE(MAX(s.created_at), c.created_at) DESC
     LIMIT 200`,
    params
  );
  return result.rows.map(mapCandidate);
}

export async function getCandidateWithScreens(candidateId) {
  const pool = await getReadyPool();
  const cand = await pool.query(`SELECT * FROM hr_candidates WHERE id = $1`, [candidateId]);
  if (!cand.rows[0]) return null;

  const screens = await pool.query(
    `SELECT * FROM hr_phone_screens WHERE candidate_id = $1 ORDER BY screen_date DESC, created_at DESC`,
    [candidateId]
  );

  const candidate = mapCandidate(cand.rows[0]);
  candidate.phoneScreens = screens.rows.map(mapScreen);
  return candidate;
}

import crypto from "node:crypto";
import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// Builder Credit Applications — the public multi-step form saves each step
// server-side under a short application code (token), so accounting can see
// and process partially completed applications in the internal
// "Builder Credit Applications" page. Applicants can resume with the code.
// ---------------------------------------------------------------------------

const CREDIT_APP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS builder_credit_applications (
  token TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'in_progress',
  step_completed INTEGER NOT NULL DEFAULT 0,
  legal_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  decision TEXT NOT NULL DEFAULT '',
  decision_credit_line TEXT NOT NULL DEFAULT '',
  decision_reason TEXT NOT NULL DEFAULT '',
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ,
  result_emailed_to TEXT NOT NULL DEFAULT '',
  result_emailed_at TIMESTAMPTZ
);
ALTER TABLE builder_credit_applications ADD COLUMN IF NOT EXISTS decision TEXT NOT NULL DEFAULT '';
ALTER TABLE builder_credit_applications ADD COLUMN IF NOT EXISTS decision_credit_line TEXT NOT NULL DEFAULT '';
ALTER TABLE builder_credit_applications ADD COLUMN IF NOT EXISTS decision_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE builder_credit_applications ADD COLUMN IF NOT EXISTS decided_by TEXT NOT NULL DEFAULT '';
ALTER TABLE builder_credit_applications ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE builder_credit_applications ADD COLUMN IF NOT EXISTS result_emailed_to TEXT NOT NULL DEFAULT '';
ALTER TABLE builder_credit_applications ADD COLUMN IF NOT EXISTS result_emailed_at TIMESTAMPTZ;
`;

let ensurePromise = null;

async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!ensurePromise) {
    ensurePromise = pool.query(CREDIT_APP_SCHEMA_SQL);
  }
  await ensurePromise;
  return pool;
}

// Application codes are shown to the applicant ("resume code") and to
// accounting. Unambiguous alphabet (no 0/O/1/I/L), 8 characters after the
// prefix — enough entropy that codes can't be guessed, short enough to jot
// down. Example: BCA-7KM2-Q9XF
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateToken() {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3) code += "-";
  }
  return `BCA-${code}`;
}

export function normalizeCreditAppToken(raw) {
  const cleaned = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^BCA[A-Z0-9]{8}$/.test(cleaned)) return null;
  const body = cleaned.slice(3);
  return `BCA-${body.slice(0, 4)}-${body.slice(4)}`;
}

function mapRow(row) {
  return {
    token: row.token,
    status: row.status,
    stepCompleted: row.step_completed,
    legalName: row.legal_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    data: row.data || {},
    createdAt: row.created_at?.toISOString?.() || null,
    updatedAt: row.updated_at?.toISOString?.() || null,
    submittedAt: row.submitted_at?.toISOString?.() || null,
    decision: row.decision || "",
    decisionCreditLine: row.decision_credit_line || "",
    decisionReason: row.decision_reason || "",
    decidedBy: row.decided_by || "",
    decidedAt: row.decided_at?.toISOString?.() || null,
    resultEmailedTo: row.result_emailed_to || "",
    resultEmailedAt: row.result_emailed_at?.toISOString?.() || null
  };
}

export async function getCreditApplication(token) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM builder_credit_applications WHERE token = $1`,
    [token]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// Save one wizard step. Creates the application on the first save (no token
// supplied), merges the step's payload into the JSONB data afterwards.
// step_completed only ratchets upward so going back to edit step 1 doesn't
// make a finished-looking application look abandoned.
export async function saveCreditApplicationStep({ token, step, stepData, legalName, contactName, contactEmail }) {
  const pool = await getReadyPool();
  const stepNumber = Math.max(1, Math.min(3, Number(step) || 1));
  const patch = JSON.stringify({ [`step${stepNumber}`]: stepData || {} });

  if (!token) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const candidate = generateToken();
      const result = await pool.query(
        `INSERT INTO builder_credit_applications (token, step_completed, legal_name, contact_name, contact_email, data)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (token) DO NOTHING
         RETURNING *`,
        [candidate, stepNumber, String(legalName || "").trim().slice(0, 200), String(contactName || "").trim().slice(0, 200), String(contactEmail || "").trim().toLowerCase().slice(0, 200), patch]
      );
      if (result.rows[0]) return mapRow(result.rows[0]);
    }
    throw new Error("Could not allocate an application code.");
  }

  const result = await pool.query(
    `UPDATE builder_credit_applications
     SET data = data || $2::jsonb,
         step_completed = GREATEST(step_completed, $3),
         legal_name = CASE WHEN $4 <> '' THEN $4 ELSE legal_name END,
         contact_name = CASE WHEN $5 <> '' THEN $5 ELSE contact_name END,
         contact_email = CASE WHEN $6 <> '' THEN $6 ELSE contact_email END,
         updated_at = NOW()
     WHERE token = $1 AND status = 'in_progress'
     RETURNING *`,
    [
      token,
      patch,
      stepNumber,
      String(legalName || "").trim().slice(0, 200),
      String(contactName || "").trim().slice(0, 200),
      String(contactEmail || "").trim().toLowerCase().slice(0, 200)
    ]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// Final submit: merge the last step and flip to submitted (only once).
export async function submitCreditApplication({ token, stepData }) {
  const pool = await getReadyPool();
  const patch = JSON.stringify({ step3: stepData || {} });
  const result = await pool.query(
    `UPDATE builder_credit_applications
     SET data = data || $2::jsonb,
         step_completed = 3,
         status = 'submitted',
         submitted_at = NOW(),
         updated_at = NOW()
     WHERE token = $1 AND status = 'in_progress'
     RETURNING *`,
    [token, patch]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// Admin listing — newest activity first. The signature image (a data URL in
// step3) is stripped from the list payload to keep it light; the detail
// endpoint returns the full record.
export async function listCreditApplications() {
  const pool = await getReadyPool();
  const result = await pool.query(
    `SELECT * FROM builder_credit_applications ORDER BY updated_at DESC LIMIT 500`
  );
  return result.rows.map((row) => {
    const app = mapRow(row);
    if (app.data?.step3?.signature?.imageData) {
      app.data = {
        ...app.data,
        step3: {
          ...app.data.step3,
          signature: { ...app.data.step3.signature, imageData: "", hasImage: true }
        }
      };
    }
    return app;
  });
}

// Approve or decline a submitted application. Re-deciding is allowed (the
// latest decision wins) so a mistaken click can be corrected.
export async function recordCreditDecision({ token, decision, creditLine = "", reason = "", byName = "" }) {
  if (!["approved", "declined"].includes(decision)) {
    throw new Error("Bad decision.");
  }
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE builder_credit_applications
     SET decision = $2,
         decision_credit_line = $3,
         decision_reason = $4,
         decided_by = $5,
         decided_at = NOW(),
         updated_at = NOW()
     WHERE token = $1 AND status = 'submitted'
     RETURNING *`,
    [
      token,
      decision,
      String(creditLine || "").trim().slice(0, 100),
      String(reason || "").trim().slice(0, 500),
      String(byName || "").trim().slice(0, 120)
    ]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function recordResultEmail({ token, email }) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `UPDATE builder_credit_applications
     SET result_emailed_to = $2, result_emailed_at = NOW(), updated_at = NOW()
     WHERE token = $1
     RETURNING *`,
    [token, String(email || "").trim().toLowerCase().slice(0, 200)]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function deleteCreditApplication(token) {
  const pool = await getReadyPool();
  const result = await pool.query(
    `DELETE FROM builder_credit_applications WHERE token = $1 RETURNING token`,
    [token]
  );
  return result.rowCount > 0;
}

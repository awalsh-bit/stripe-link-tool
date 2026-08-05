-- Builder Credit Applications (builder-credit.html + credit-applications.html).
-- The public form is a three-step wizard; each "Save & Next" writes the step's
-- answers here under a short application code (token, e.g. BCA-7KM2-Q9XF) so
-- accounting can see and process partially completed applications, and the
-- applicant can resume with the code. Final submit flips status to
-- 'submitted' and emails accounting as before. The server also runs this
-- idempotently at boot (lib/credit-app-postgres.js).

CREATE TABLE IF NOT EXISTS builder_credit_applications (
  token TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'in_progress',   -- in_progress | submitted
  step_completed INTEGER NOT NULL DEFAULT 0,    -- highest step saved (1-3)
  legal_name TEXT NOT NULL DEFAULT '',          -- convenience columns for the
  contact_name TEXT NOT NULL DEFAULT '',        -- admin list; the full answers
  contact_email TEXT NOT NULL DEFAULT '',       -- live in data
  data JSONB NOT NULL DEFAULT '{}'::jsonb,      -- { step1: {...}, step2: {...}, step3: {...} }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  -- Approval processing (credit-applications.html): approve with a credit
  -- line or decline with a reason, then email the applicant the result.
  decision TEXT NOT NULL DEFAULT '',            -- '' | approved | declined
  decision_credit_line TEXT NOT NULL DEFAULT '',
  decision_reason TEXT NOT NULL DEFAULT '',
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ,
  result_emailed_to TEXT NOT NULL DEFAULT '',
  result_emailed_at TIMESTAMPTZ
);

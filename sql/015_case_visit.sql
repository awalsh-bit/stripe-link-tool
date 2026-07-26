-- 015: case visit survey (Test Modules — temporary/external pilot).
-- Idempotent; also applied at boot by lib/case-visit-postgres.js.
--
-- Security check-in experience (sad/neutral/happy) + case manager meeting
-- progress. Self-contained so the whole module can be lifted out or dropped:
--   DROP TABLE case_visit_responses;  -- removes all pilot data

-- Each record answers ONE question (the surveys are single-question windows
-- that save on first tap), so staff_rating is nullable and progress uses ''
-- when unanswered.
CREATE TABLE IF NOT EXISTS case_visit_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_rating TEXT CHECK (staff_rating IN ('sad', 'neutral', 'happy')),
  progress TEXT NOT NULL DEFAULT '',
  recorded_by_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE case_visit_responses ALTER COLUMN staff_rating DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_case_visit_responses_created_at
  ON case_visit_responses (created_at DESC);

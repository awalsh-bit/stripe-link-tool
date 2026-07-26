-- 014: client satisfaction survey (Test Modules).
-- Idempotent; also applied at boot by lib/satisfaction-postgres.js.
--
-- Internal pilot of the eventual public NPS survey. `source` distinguishes
-- internal test entries from future public ones; `recorded_by_email` is the
-- signed-in user who captured the response during the pilot.

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

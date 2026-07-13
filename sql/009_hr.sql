-- 009: HR — candidate profiles + phone screens (start of the hiring pipeline).
-- Created idempotently at boot by lib/hr-postgres.js.

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

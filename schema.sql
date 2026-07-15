-- YourBabalawo.com D1 database schema
-- Binding name expected by the Pages Functions: DB

CREATE TABLE IF NOT EXISTS intake_submissions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new_intake',

  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  location TEXT,
  preferred_contact_method TEXT,

  received_ifa_before TEXT,
  received_tehuti_before TEXT,
  spiritual_or_initiation_status TEXT,
  godparent_elder_spiritual_house TEXT,

  primary_concern_category TEXT,
  primary_reason TEXT,
  why_now TEXT,

  question_1 TEXT,
  question_2 TEXT,
  question_3 TEXT,

  consent_spiritual_consultation INTEGER NOT NULL DEFAULT 0,
  consent_not_medical_legal_financial INTEGER NOT NULL DEFAULT 0,
  consent_ebo_correction INTEGER NOT NULL DEFAULT 0,
  consent_payment_required INTEGER NOT NULL DEFAULT 0,

  ip_hint TEXT,
  user_agent TEXT,
  raw_json TEXT,

  -- Reading/result fields for later private admin updates
  odu TEXT,
  orisha TEXT,
  tehuti_neter TEXT,
  ire_ibi TEXT,
  ebo_summary TEXT,
  follow_up_needed TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_intake_created_at
ON intake_submissions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intake_status
ON intake_submissions(status);

CREATE INDEX IF NOT EXISTS idx_intake_email
ON intake_submissions(email);

CREATE TABLE IF NOT EXISTS interaction_log (
  id TEXT PRIMARY KEY,
  intake_id TEXT,
  created_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT,
  metadata_json TEXT,
  FOREIGN KEY (intake_id) REFERENCES intake_submissions(id)
);

CREATE INDEX IF NOT EXISTS idx_interaction_intake_id
ON interaction_log(intake_id);

CREATE INDEX IF NOT EXISTS idx_interaction_created_at
ON interaction_log(created_at DESC);

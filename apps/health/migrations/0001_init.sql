-- All dates/times are local to the user's time zone: dates 'YYYY-MM-DD', wall-clock times 'HH:MM',
-- and local timestamps 'YYYY-MM-DD HH:MM' (sortable as text).

CREATE TABLE medications (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  name                  TEXT NOT NULL COLLATE NOCASE,
  dosage                TEXT,              -- e.g. '500 mg'
  form                  TEXT NOT NULL DEFAULT 'pill' CHECK (form IN ('pill', 'capsule', 'liquid', 'injection', 'inhaler', 'drops', 'cream', 'other')),
  purpose               TEXT,              -- condition it treats
  instructions          TEXT,              -- e.g. 'with food'
  times                 TEXT NOT NULL DEFAULT '[]', -- JSON array of local 'HH:MM', sorted
  days                  TEXT,              -- comma-separated weekdays (sun..sat); NULL = every day
  as_needed             INTEGER NOT NULL DEFAULT 0,
  start_date            TEXT NOT NULL,
  end_date              TEXT,              -- last day of a course
  prescriber            TEXT,
  pharmacy              TEXT,
  stock                 REAL,              -- units on hand; NULL = not tracked
  units_per_dose        REAL NOT NULL DEFAULT 1 CHECK (units_per_dose > 0),
  refill_threshold_days INTEGER NOT NULL DEFAULT 7,
  active                INTEGER NOT NULL DEFAULT 1,
  stopped_at            TEXT,              -- local timestamp when stopped
  created_at            INTEGER NOT NULL,
  UNIQUE (user_id, name)
);
CREATE INDEX idx_meds_user_active ON medications(user_id, active);

-- One row per logged dose. Scheduled doses are unique per slot; as-needed / extra doses have scheduled_time NULL.
CREATE TABLE doses (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  medication_id  TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('taken', 'skipped', 'missed')),
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT,
  actual_at      TEXT NOT NULL,            -- local timestamp
  units          REAL NOT NULL DEFAULT 0,  -- units deducted from stock
  note           TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE (medication_id, scheduled_date, scheduled_time)
);
CREATE INDEX idx_doses_user_date ON doses(user_id, scheduled_date);
CREATE INDEX idx_doses_med_date ON doses(medication_id, scheduled_date);

CREATE TABLE vitals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('blood_pressure', 'heart_rate', 'blood_glucose', 'weight', 'temperature', 'spo2', 'sleep_hours', 'steps', 'respiratory_rate', 'other')),
  name        TEXT,                        -- custom name for type 'other'
  value       REAL NOT NULL,               -- systolic for blood pressure
  value2      REAL,                        -- diastolic for blood pressure
  unit        TEXT NOT NULL,
  context     TEXT,                        -- glucose: fasting / before_meal / after_meal / bedtime / random
  measured_at TEXT NOT NULL,               -- local timestamp
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_vitals_user_time ON vitals(user_id, measured_at);
CREATE INDEX idx_vitals_user_type_time ON vitals(user_id, type, measured_at);

CREATE TABLE symptoms (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL COLLATE NOCASE,
  severity   INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 10),
  body_area  TEXT,
  started_at TEXT NOT NULL,                -- local timestamp
  duration   TEXT,                         -- free text, e.g. '2 hours', 'ongoing'
  triggers   TEXT,
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_symptoms_user_time ON symptoms(user_id, started_at);

CREATE TABLE appointments (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  doctor       TEXT NOT NULL,
  specialty    TEXT,
  scheduled_at TEXT NOT NULL,              -- local timestamp
  location     TEXT,
  reason       TEXT,
  questions    TEXT NOT NULL DEFAULT '[]', -- JSON array of questions to ask
  notes        TEXT,
  outcome      TEXT,
  status       TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_appts_user_time ON appointments(user_id, scheduled_at);

CREATE TABLE health_profile (
  user_id           TEXT PRIMARY KEY,
  conditions        TEXT NOT NULL DEFAULT '[]', -- JSON array
  allergies         TEXT NOT NULL DEFAULT '[]', -- JSON array
  blood_type        TEXT,
  emergency_contact TEXT,
  primary_doctor    TEXT,
  notes             TEXT,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);

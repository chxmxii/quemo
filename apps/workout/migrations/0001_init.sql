-- Exercise library: one row per movement, created on first use.
CREATE TABLE exercises (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL COLLATE NOCASE,
  muscle_group TEXT,              -- lower-case, e.g. chest, back, legs, shoulders, core, cardio
  equipment    TEXT,              -- lower-case, e.g. barbell, dumbbell, machine, bodyweight
  type         TEXT NOT NULL DEFAULT 'strength' CHECK (type IN ('strength', 'cardio', 'mobility', 'sport')),
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

-- Plans such as "Push day": scheduled weekdays plus target sets × reps × weight.
CREATE TABLE routines (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL COLLATE NOCASE,
  days       TEXT,                -- comma-separated weekdays: mon,wed,fri
  notes      TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE routine_exercises (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  routine_id       TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  exercise_id      TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  target_sets      INTEGER NOT NULL DEFAULT 3 CHECK (target_sets > 0),
  target_reps      INTEGER CHECK (target_reps IS NULL OR target_reps > 0),
  target_weight_kg REAL CHECK (target_weight_kg IS NULL OR target_weight_kg >= 0),
  target_distance_km REAL,
  target_duration_sec INTEGER,
  notes            TEXT
);
CREATE INDEX idx_routine_ex ON routine_exercises(routine_id, position);

CREATE TABLE workouts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  date         TEXT NOT NULL,     -- YYYY-MM-DD (user's time zone)
  start_time   TEXT,              -- HH:MM
  duration_min INTEGER CHECK (duration_min IS NULL OR duration_min > 0),
  effort       INTEGER CHECK (effort IS NULL OR effort BETWEEN 1 AND 10),
  notes        TEXT,
  routine_id   TEXT REFERENCES routines(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_workouts_user_date ON workouts(user_id, date);

-- Weights in kg, distances in km, whatever the user's display units.
CREATE TABLE workout_sets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  workout_id   TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id  TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,  -- order of the exercise within the workout
  set_number   INTEGER NOT NULL,
  reps         INTEGER CHECK (reps IS NULL OR reps >= 0),
  weight_kg    REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
  rpe          REAL CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  distance_km  REAL CHECK (distance_km IS NULL OR distance_km >= 0),
  duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec >= 0),
  is_warmup    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_sets_workout ON workout_sets(workout_id, position, set_number);
CREATE INDEX idx_sets_user_exercise ON workout_sets(user_id, exercise_id);

-- One value per metric per day. Weight in kg, girths in cm, body fat in %, resting heart rate in bpm.
CREATE TABLE body_metrics (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  date       TEXT NOT NULL,
  metric     TEXT NOT NULL CHECK (metric IN ('weight', 'body_fat_pct', 'waist', 'chest', 'arms', 'thighs', 'hips', 'neck', 'resting_hr')),
  value      REAL NOT NULL CHECK (value > 0),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, metric, date)
);
CREATE INDEX idx_metrics_user_date ON body_metrics(user_id, date);

-- goal_key = type, or type:exercise_id for per-exercise goals (one goal per key).
CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('workouts_per_week', 'minutes_per_week', 'total_volume_per_week', 'exercise_weight', 'exercise_reps', 'body_weight', 'body_fat_pct')),
  goal_key    TEXT NOT NULL,
  exercise_id TEXT REFERENCES exercises(id) ON DELETE CASCADE,
  target      REAL NOT NULL CHECK (target > 0),
  start_value REAL,
  deadline    TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (user_id, goal_key)
);

CREATE TABLE reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);

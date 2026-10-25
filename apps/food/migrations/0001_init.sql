-- One eating occasion. Nutrition lives on its items; meal totals are their sums.
CREATE TABLE meals (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  meal_type         TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'drink')),
  date              TEXT NOT NULL,     -- YYYY-MM-DD (user's time zone)
  time              TEXT NOT NULL,     -- HH:MM (user's time zone)
  name              TEXT,
  place             TEXT,
  note              TEXT,
  photo_description TEXT,
  mood              INTEGER CHECK (mood BETWEEN 1 AND 5),
  energy            INTEGER CHECK (energy BETWEEN 1 AND 5),
  hunger            INTEGER CHECK (hunger BETWEEN 1 AND 5),
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_meals_user_date ON meals(user_id, date, time);

-- Custom foods / favorites with nutrition per serving.
CREATE TABLE foods (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL COLLATE NOCASE,
  brand        TEXT,
  serving_qty  REAL NOT NULL DEFAULT 1 CHECK (serving_qty > 0),
  serving_unit TEXT NOT NULL DEFAULT 'serving',   -- grams / ml stored as 'g' / 'ml'
  calories     REAL,
  protein_g    REAL,
  carbs_g      REAL,
  fat_g        REAL,
  fiber_g      REAL,
  sugar_g      REAL,
  sodium_mg    REAL,
  favorite     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE meal_items (
  id         TEXT PRIMARY KEY,
  meal_id    TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  food_id    TEXT REFERENCES foods(id) ON DELETE SET NULL,
  name       TEXT NOT NULL COLLATE NOCASE,
  quantity   REAL,
  unit       TEXT,                    -- g / ml for weights & volumes (normalized), else piece, cup, serving…
  servings   REAL,                    -- when logged from a saved food
  calories   REAL,
  protein_g  REAL,
  carbs_g    REAL,
  fat_g      REAL,
  fiber_g    REAL,
  sugar_g    REAL,
  sodium_mg  REAL,
  estimated  INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_items_meal ON meal_items(meal_id, position);
CREATE INDEX idx_items_user_name ON meal_items(user_id, name);

CREATE TABLE water_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  date       TEXT NOT NULL,
  time       TEXT NOT NULL,
  amount_ml  REAL NOT NULL CHECK (amount_ml > 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_water_user_date ON water_logs(user_id, date);

-- Daily targets. NULL = no goal for that nutrient. sugar / sodium are maximums.
CREATE TABLE nutrition_goals (
  user_id       TEXT PRIMARY KEY,
  calories      REAL,
  protein_g     REAL,
  carbs_g       REAL,
  fat_g         REAL,
  fiber_g       REAL,
  sugar_max_g   REAL,
  sodium_max_mg REAL,
  water_ml      REAL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE weights (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  date       TEXT NOT NULL,
  weight_kg  REAL NOT NULL CHECK (weight_kg > 0),
  note       TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, date)
);
CREATE INDEX idx_weights_user_date ON weights(user_id, date);

CREATE TABLE reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);

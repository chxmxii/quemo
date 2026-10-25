CREATE TABLE accounts (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  name                  TEXT NOT NULL COLLATE NOCASE,
  type                  TEXT NOT NULL DEFAULT 'checking' CHECK (type IN ('checking', 'savings', 'cash', 'credit', 'investment', 'other')),
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  archived              INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL COLLATE NOCASE,
  kind       TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, name, kind)
);

CREATE TABLE transactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  category_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  account_id    TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  to_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  merchant      TEXT,
  description   TEXT,
  tags          TEXT,              -- comma-separated, lower-case
  occurred_on   TEXT NOT NULL,     -- YYYY-MM-DD (user's time zone)
  recurring_id  TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_tx_user_date ON transactions(user_id, occurred_on);
CREATE INDEX idx_tx_user_category ON transactions(user_id, category_id);

-- month = 'YYYY-MM' for a one-month override, '*' for the default monthly limit
CREATE TABLE budgets (
  user_id      TEXT NOT NULL,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  PRIMARY KEY (user_id, category_id, month)
);

-- Bills, subscriptions, salary: anything that repeats.
CREATE TABLE recurring (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  account_id     TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  frequency      TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due       TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_recurring_due ON recurring(user_id, active, next_due);

CREATE TABLE savings_goals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL COLLATE NOCASE,
  target_cents INTEGER NOT NULL CHECK (target_cents > 0),
  saved_cents  INTEGER NOT NULL DEFAULT 0,
  deadline     TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  timezone    TEXT NOT NULL DEFAULT 'UTC',
  currency    TEXT NOT NULL DEFAULT 'EUR',
  units       TEXT NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
  created_at  INTEGER NOT NULL,
  verified_at INTEGER
);

-- One row per emailed sign-in: a link token and a 6-digit code (for signing in on another device).
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX idx_login_tokens_user ON login_tokens(user_id, created_at);

CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Personal API keys: one key works with every Quemo tool.
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

-- Tombstones so tool Workers can purge a deleted account's data on their daily cron.
CREATE TABLE deleted_users (
  user_id    TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);

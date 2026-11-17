CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE account_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX account_sessions_expiry ON account_sessions(expires_at);

CREATE TABLE auth_attempts (
  attempt_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE INDEX auth_attempts_window ON auth_attempts(window_start);

ALTER TABLE profiles ADD COLUMN account_id TEXT REFERENCES accounts(id);
CREATE UNIQUE INDEX profiles_account_id ON profiles(account_id);

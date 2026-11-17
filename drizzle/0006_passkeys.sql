CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX passkeys_account ON passkeys(account_id);
CREATE TABLE passkey_challenges (
  challenge TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN ('register','login')),
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX passkey_expiry ON passkey_challenges(expires_at);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  walk_id TEXT NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('join','accepted','cancelled','chat')),
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX notifications_account_recent ON notifications(account_id, id DESC);
CREATE INDEX notifications_account_unread ON notifications(account_id, created_at) WHERE read_at IS NULL;
CREATE INDEX notifications_expiry ON notifications(created_at);
CREATE INDEX notifications_walk ON notifications(walk_id);
CREATE UNIQUE INDEX notifications_unread_chat ON notifications(account_id, walk_id) WHERE kind = 'chat' AND read_at IS NULL;

CREATE TABLE push_devices (
  endpoint TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX push_devices_account ON push_devices(account_id, updated_at);

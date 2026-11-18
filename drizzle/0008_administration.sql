ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin'));
ALTER TABLE accounts ADD COLUMN suspended_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new','reviewing','resolved','dismissed'));
ALTER TABLE reports ADD COLUMN snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN response TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN updated_at INTEGER;
CREATE INDEX reports_state_created ON reports(state,created_at DESC);
CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE account_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('friend_request','friend_accepted','admin','report')),
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX account_notices_recent ON account_notices(account_id,created_at DESC);
CREATE INDEX account_notices_unread ON account_notices(account_id) WHERE read_at IS NULL;
ALTER TABLE walks ADD COLUMN public_latitude REAL;
ALTER TABLE walks ADD COLUMN public_longitude REAL;
CREATE INDEX walks_public_position ON walks(status,public_latitude,public_longitude);

ALTER TABLE join_requests ADD COLUMN details_released INTEGER NOT NULL DEFAULT 0;

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  walk_id TEXT NOT NULL,
  sender_profile_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

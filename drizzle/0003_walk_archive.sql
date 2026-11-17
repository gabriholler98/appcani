ALTER TABLE walks ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 60
  CHECK (duration_minutes BETWEEN 5 AND 1440);
ALTER TABLE walks ADD COLUMN ends_at INTEGER;

CREATE INDEX walks_status_ends_at ON walks(status, ends_at);
CREATE INDEX walks_host_ends_at ON walks(host_profile_id, ends_at);
CREATE INDEX join_requests_profile_walk ON join_requests(profile_id, walk_id);
CREATE INDEX messages_walk_created ON messages(walk_id, created_at);

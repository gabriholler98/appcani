ALTER TABLE profiles ADD COLUMN age_group TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN gender TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN visibility TEXT NOT NULL DEFAULT 'friends';
ALTER TABLE profiles ADD COLUMN push_muted TEXT NOT NULL DEFAULT '[]';

CREATE TABLE dogs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  breed TEXT NOT NULL,
  birth INTEGER NOT NULL,
  size TEXT NOT NULL,
  energy TEXT NOT NULL,
  emoji TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX dogs_owner ON dogs(profile_id, archived);
CREATE INDEX dogs_search ON dogs(name COLLATE NOCASE) WHERE archived=0;
CREATE TABLE dog_photos (dog_id TEXT PRIMARY KEY REFERENCES dogs(id) ON DELETE CASCADE, image BLOB NOT NULL);
INSERT INTO dogs (id, profile_id, name, breed, birth, size, energy, emoji)
SELECT id, id, dog_name, breed, birth_year, size, energy, emoji FROM profiles WHERE account_id IS NOT NULL;

ALTER TABLE walks ADD COLUMN dogs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE walks ADD COLUMN starts_at INTEGER;
ALTER TABLE walks ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE walks ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE join_requests ADD COLUMN dogs_json TEXT NOT NULL DEFAULT '[]';
UPDATE walks SET dogs_json=COALESCE((
  SELECT json_array(json_object('id',d.id,'name',d.name,'breed',d.breed,'size',d.size,'emoji',d.emoji))
  FROM dogs d WHERE d.id=walks.host_profile_id
),'[]'), max_participants=max_participants+1, starts_at=ends_at-duration_minutes*60;
UPDATE join_requests SET dogs_json=COALESCE((
  SELECT json_array(json_object('id',d.id,'name',d.name,'breed',d.breed,'size',d.size,'emoji',d.emoji))
  FROM dogs d WHERE d.id=join_requests.profile_id
),'[]');
CREATE INDEX walk_requests_status ON join_requests(walk_id,status);
CREATE TRIGGER reset_released_location AFTER UPDATE OF area_label,latitude,longitude,city ON walks
WHEN OLD.area_label!=NEW.area_label OR OLD.latitude!=NEW.latitude OR OLD.longitude!=NEW.longitude OR OLD.city!=NEW.city
BEGIN
  UPDATE join_requests SET details_released=0 WHERE walk_id=NEW.id;
END;

CREATE TABLE relationships (
  first_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  second_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('pending','friends')),
  PRIMARY KEY(first_id,second_id),
  CHECK(first_id<second_id AND sender_id IN(first_id,second_id))
);
CREATE INDEX relationships_second ON relationships(second_id,state);
CREATE TABLE blocks (
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY(owner_id,target_id)
);
CREATE TABLE reports (
  id TEXT PRIMARY KEY, reporter_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('profile','walk','message')),
  subject_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(reporter_id,kind,subject_id)
);
CREATE TABLE recovery_codes (
  code_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX recovery_owner ON recovery_codes(account_id);
ALTER TABLE push_devices ADD COLUMN last_test_at INTEGER NOT NULL DEFAULT 0;

DROP INDEX notifications_account_recent;
DROP INDEX notifications_account_unread;
DROP INDEX notifications_expiry;
DROP INDEX notifications_walk;
DROP INDEX notifications_unread_chat;
ALTER TABLE notifications RENAME TO notifications_v1;
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  walk_id TEXT NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('join','accepted','cancelled','chat','changed','withdrawn','rejected')),
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  details TEXT NOT NULL DEFAULT ''
);
INSERT INTO notifications (id,account_id,walk_id,kind,created_at,read_at)
SELECT id,account_id,walk_id,kind,created_at,read_at FROM notifications_v1;
DROP TABLE notifications_v1;
CREATE INDEX notifications_account_recent ON notifications(account_id,id DESC);
CREATE INDEX notifications_account_unread ON notifications(account_id,created_at) WHERE read_at IS NULL;
CREATE INDEX notifications_expiry ON notifications(created_at);
CREATE INDEX notifications_walk ON notifications(walk_id);
CREATE UNIQUE INDEX notifications_unread_chat ON notifications(account_id,walk_id) WHERE kind='chat' AND read_at IS NULL;

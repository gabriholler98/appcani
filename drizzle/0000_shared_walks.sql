CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  write_token TEXT NOT NULL,
  dog_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  breed TEXT NOT NULL,
  birth_year INTEGER NOT NULL,
  size TEXT NOT NULL,
  energy TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE walks (
  id TEXT PRIMARY KEY,
  host_profile_id TEXT NOT NULL,
  host_token TEXT NOT NULL,
  title TEXT NOT NULL,
  city TEXT NOT NULL,
  area_label TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  day TEXT NOT NULL,
  time TEXT NOT NULL,
  max_participants INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE join_requests (
  id TEXT PRIMARY KEY,
  walk_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  UNIQUE(walk_id, profile_id)
);

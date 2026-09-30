CREATE TABLE IF NOT EXISTS screenings (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  venue TEXT,
  banner_image_key TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  start_at TEXT NOT NULL,
  stop_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  screening_id TEXT NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT,
  min_selections INTEGER NOT NULL DEFAULT 1,
  max_selections INTEGER NOT NULL DEFAULT 1,
  image_config TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(screening_id, slug)
);
CREATE TABLE IF NOT EXISTS options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  image_keys TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vote_codes (
  code_hash TEXT PRIMARY KEY,
  screening_id TEXT NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  screening_id TEXT NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES options(id),
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS votes_screening_idx ON votes(screening_id);
CREATE INDEX IF NOT EXISTS votes_poll_idx ON votes(poll_id);

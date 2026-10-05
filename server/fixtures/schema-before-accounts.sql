-- The schema exactly as Meridian created it before accounts existed (server/db.ts and migrate.ts of that version).
-- migrate.test.ts builds a database from it, copies the file and upgrades the copy.
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  country TEXT NOT NULL,
  lang TEXT NOT NULL,
  site_topic TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  goal TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL DEFAULT '',
  retried_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  engine TEXT NOT NULL DEFAULT '',
  step TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  meaning TEXT NOT NULL DEFAULT '',
  intent TEXT NOT NULL DEFAULT '',
  cluster TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS keywords_request ON keywords(request_id);
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  country TEXT NOT NULL,
  lang TEXT NOT NULL,
  site_topic TEXT NOT NULL DEFAULT '',
  keyword TEXT NOT NULL,
  request_id INTEGER REFERENCES requests(id),
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  engine TEXT NOT NULL DEFAULT '',
  step TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  pending_note TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  checks TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  lang_review_by TEXT NOT NULL DEFAULT '',
  lang_review_at INTEGER,
  error TEXT NOT NULL DEFAULT '',
  tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS articles_status ON articles(status);
CREATE TABLE IF NOT EXISTS article_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS article_events_article ON article_events(article_id);

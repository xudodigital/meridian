// The database schema. Every statement is CREATE ... IF NOT EXISTS and every column added later goes through
// migrate(), so running this on an existing database (every server start) only adds what is missing and never
// drops or rewrites data.
import type { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrate.ts';

const TABLES = `
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
  requested_by TEXT NOT NULL DEFAULT '',      -- who asked (their name then); empty for requests made before this was recorded
  retried_by TEXT NOT NULL DEFAULT '',        -- who last asked to run it again
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | work | done | failed
  engine TEXT NOT NULL DEFAULT '',            -- openai-api
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
  basis TEXT NOT NULL DEFAULT '',             -- how the agent arrived at it; never a volume figure
  volume INTEGER,                             -- monthly searches from DataForSEO (dataforseo.ts); NULL: not fetched, or no data
  competition TEXT NOT NULL DEFAULT '',       -- LOW | MEDIUM | HIGH among advertisers, from the same answer; '' unknown
  volume_provider TEXT NOT NULL DEFAULT '',   -- ads | dfs; blank for legacy rows
  volume_country TEXT NOT NULL DEFAULT '',   -- targeting at fetch time
  volume_lang TEXT NOT NULL DEFAULT '',
  volume_group TEXT NOT NULL DEFAULT '',      -- Google close variants share this metric group
  volume_at INTEGER,                          -- when the volume was fetched; NULL: never
  track INTEGER NOT NULL DEFAULT 0            -- 1: a person asked to track its position (rank.ts)
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
  request_id INTEGER REFERENCES requests(id),   -- the keyword research result the keyword came from
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',        -- queued | work | review | revision | approved | rejected | failed
  engine TEXT NOT NULL DEFAULT '',              -- openai-api
  step TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,          -- 0 is the first draft; +1 for every finished revision
  pending_note TEXT NOT NULL DEFAULT '',        -- the reviewer's note while a revision is queued or being written
  content TEXT NOT NULL DEFAULT '',             -- JSON ArticleContent of the latest version (text, sources, reviewer notes)
  checks TEXT NOT NULL DEFAULT '[]',            -- JSON Check[], computed by the server (checks.ts), never by the model
  notes TEXT NOT NULL DEFAULT '',               -- notes from the engine, for example the model that actually ran
  lang_review_by TEXT NOT NULL DEFAULT '',      -- native-speaker review of the latest version: who, and when
  lang_review_at INTEGER,
  error TEXT NOT NULL DEFAULT '',
  tokens INTEGER NOT NULL DEFAULT 0,            -- of the latest job
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,                   -- place in the job queue shared with research requests
  started_at INTEGER,
  finished_at INTEGER,
  images TEXT NOT NULL DEFAULT '[]',            -- JSON Photo[]: openly licensed photos the Site Builder placed (photos.ts)
  photos_status TEXT NOT NULL DEFAULT '',       -- the latest photo job: '' never ran | queued | work | done | failed
  photos_step TEXT NOT NULL DEFAULT '',
  photos_error TEXT NOT NULL DEFAULT '',
  photos_queued_at INTEGER,                     -- place in the shared job queue
  photos_started_at INTEGER,
  photos_finished_at INTEGER,
  photos_tokens INTEGER NOT NULL DEFAULT 0,     -- of the latest photo job
  photos_cost REAL NOT NULL DEFAULT 0,
  archived_at INTEGER,                          -- set when a person archived it: hidden from the lists, nothing else changes
  category TEXT NOT NULL DEFAULT ''             -- the site category it belongs to (links.ts); '' for none
);
CREATE INDEX IF NOT EXISTS articles_status ON articles(status);
CREATE TABLE IF NOT EXISTS article_events (    -- decision history: who did what, when, with what note
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,                         -- requested | written | failed | approved | revision | rejected | language-review | retried | photos | edited | unapproved | archived | unarchived
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS article_events_article ON article_events(article_id);

-- Accounts. Email is unique without regard to case; it is also stored in lower case.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL,                           -- admin | editor | reviewer | viewer
  site TEXT NOT NULL DEFAULT '',                -- a reviewer's one site (site id); '' for everyone else
  pass_hash TEXT NOT NULL,                      -- scrypt$N$r$p$salt$hash (secrets.ts)
  created_at INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT NOT NULL DEFAULT '',         -- base32; '' while 2-step verification is off
  totp_pending TEXT NOT NULL DEFAULT '',        -- a secret being set up, until a code confirms it
  totp_last_step INTEGER NOT NULL DEFAULT 0,    -- the last time step a code was accepted for (no replay)
  recovery_hashes TEXT NOT NULL DEFAULT '[]',   -- JSON array of SHA-256 hashes of unused recovery codes
  totp_fails INTEGER NOT NULL DEFAULT 0,        -- wrong 2-step codes in a row at sign-in (auth-api.ts)
  totp_locked_until INTEGER NOT NULL DEFAULT 0  -- no 2-step code is accepted before this time
);
-- Signed-in browsers. Only a SHA-256 of the cookie token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,                  -- absolute end: 30 days after sign-in
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
-- One-time invitation links. Only a SHA-256 of the link token is stored.
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL,
  site TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
-- One-time links for setting a new password (reset.ts). Only a SHA-256 of the link token is stored; a link works
-- once and for a short time. created_by is the admin who made it in Team, or NULL when it was asked for by email.
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id);
-- The workspace: one JSON document per collection (sites, agents, ...), with a version for optimistic concurrency.
CREATE TABLE IF NOT EXISTS workspace_docs (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER
);
-- The audit log. The API has no route that edits or deletes an entry. An entry the app posted (POST /api/audit) is a
-- person's note about what they did on their screen: client = 1, so it can never pass for one the server wrote.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,                          -- the person's name at the time, or an agent's name
  actor_id INTEGER,                             -- the user, when a person did it
  act TEXT NOT NULL,
  site TEXT,                                    -- site id, or NULL
  client INTEGER NOT NULL DEFAULT 0             -- 1: posted by the app; 0: written by the server itself
);
-- Which server notifications each person has read (their keys, see app/src/store/liveNotifs.ts).
CREATE TABLE IF NOT EXISTS notif_reads (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
-- The steps of the latest run of each job, with the time each began.
CREATE TABLE IF NOT EXISTS job_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                           -- request | article | photos | build | deploy (steps.ts JobKind)
  job_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_steps_job ON job_steps(kind, job_id);
-- How often a job was found mid-run when the server started (jobs.ts). A job that finishes has no row.
CREATE TABLE IF NOT EXISTS job_attempts (
  kind TEXT NOT NULL,                           -- request | article | photos | build | deploy
  job_id INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, job_id)
);
-- Connected services (integrations.ts). Secrets are encrypted (vault.ts); config holds what is not secret.
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,                          -- openai | dfs | cf | probe | slack | tg | email | google | gsc | ga4
  secret TEXT NOT NULL DEFAULT '',              -- vault.seal(JSON of the secret fields)
  config TEXT NOT NULL DEFAULT '{}',            -- JSON of the fields that are not secret (an SMTP host, a Telegram chat id)
  tail TEXT NOT NULL DEFAULT '',                -- what the card shows: the last 4 characters, or the connected account
  status TEXT NOT NULL DEFAULT '',              -- '' (not tested) | ok | warn | bad
  msg TEXT NOT NULL DEFAULT '',                 -- the result of the last test, in words
  tested_at INTEGER,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);
-- Access checks from inside each site's country (probe.ts). The newest per site is what the dashboard shows.
CREATE TABLE IF NOT EXISTS access_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  cc TEXT NOT NULL,
  at INTEGER NOT NULL,
  result TEXT NOT NULL,                         -- ok | blocked | down | error
  dns TEXT NOT NULL DEFAULT '',                 -- a word for the DNS column: Normal | Different | No answer | Failed
  http TEXT NOT NULL DEFAULT '',                -- a word for the HTTP column: 200 | Timeout | Refused | ...
  summary TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '[]',            -- JSON: one entry per probe
  by TEXT NOT NULL DEFAULT ''                   -- who asked, or 'Schedule'
);
CREATE INDEX IF NOT EXISTS access_checks_site ON access_checks(site_id, id);
-- Domains whose owner proved control with a DNS TXT record (verify.ts).
CREATE TABLE IF NOT EXISTS site_verifications (
  site_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (site_id, domain)
);
-- A site's own domain on its Cloudflare Pages project (domains.ts): attached after a deploy, then polled until the
-- certificate is issued. One row per site; nothing here is ever sent to Cloudflare as a delete.
CREATE TABLE IF NOT EXISTS site_domains (
  site_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,                         -- lower case; a site whose domain changes starts again
  project TEXT NOT NULL DEFAULT '',             -- the Pages project it is attached to
  status TEXT NOT NULL DEFAULT 'none',          -- none | dns | cert | live | error
  problem TEXT NOT NULL DEFAULT '',             -- why it waits or stopped: dns-permission | zone-other-account | conflict | caa | in-use | ...
  error TEXT NOT NULL DEFAULT '',               -- the last error: Cloudflare's words, or the sentence shown for a conflict
  cf_status TEXT NOT NULL DEFAULT '',           -- Cloudflare's own status: initializing | pending | active | ...
  method TEXT NOT NULL DEFAULT '',              -- validation method: http | txt
  txt_name TEXT NOT NULL DEFAULT '',            -- the TXT record Cloudflare asks for (txt validation)
  txt_value TEXT NOT NULL DEFAULT '',
  dns_by TEXT NOT NULL DEFAULT '',              -- meridian (it added the record) | you (the person adds it)
  record TEXT NOT NULL DEFAULT '',              -- JSON: the DNS record the domain needs
  zone_id TEXT NOT NULL DEFAULT '',
  zone_name TEXT NOT NULL DEFAULT '',
  record_id TEXT NOT NULL DEFAULT '',           -- the DNS record Meridian created: the only one it may ever change
  pages_url TEXT NOT NULL DEFAULT '',           -- https://<project>.pages.dev
  attached INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,                           -- when the 24 hours of background checks began
  checked_at INTEGER,
  next_check_at INTEGER,                        -- when the background check looks next; NULL: not waiting
  tries INTEGER NOT NULL DEFAULT 0,
  live_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);
-- Alerts for email, Slack and Telegram (notify.ts): queued, held during quiet hours, then delivered once.
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,                     -- what the alert is about, so the same thing is never sent twice
  event TEXT NOT NULL,                          -- approval | error | blocked | budget | review | report
  site TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  result TEXT NOT NULL DEFAULT ''               -- per channel: what happened
);
-- Small facts the server keeps between restarts, such as when the report was last sent.
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Website builds (builds.ts): a static site made from a site's approved articles, its human review and its deploy.
-- The files are in DATA_DIR/sites/<site_id>/builds/<version>/; only the newest ones are kept on disk (pruned = 1).
CREATE TABLE IF NOT EXISTS site_builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  domain TEXT NOT NULL,                         -- the site's domain when the build was asked for
  version INTEGER NOT NULL,                     -- 1, 2, 3... per site
  status TEXT NOT NULL DEFAULT 'queued',        -- queued | work | ready | failed
  step TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  review TEXT NOT NULL DEFAULT '',              -- '' | waiting | approved | rejected
  review_note TEXT NOT NULL DEFAULT '',
  deploy TEXT NOT NULL DEFAULT '',              -- '' | queued | work | live | failed | superseded
  deploy_step TEXT NOT NULL DEFAULT '',
  deploy_url TEXT NOT NULL DEFAULT '',
  deploy_error TEXT NOT NULL DEFAULT '',
  deploy_id TEXT NOT NULL DEFAULT '',
  articles TEXT NOT NULL DEFAULT '[]',          -- JSON: ids of the articles in this build
  pages INTEGER NOT NULL DEFAULT 0,
  files INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  pruned INTEGER NOT NULL DEFAULT 0,            -- 1 once the files were deleted to save space (the row stays)
  by TEXT NOT NULL DEFAULT '',                  -- who asked for it
  created_at INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at INTEGER,
  deploy_queued_at INTEGER,
  deployed_at INTEGER,
  updated_at INTEGER NOT NULL,                  -- any change, so a dashboard can drop an answer older than an event
  tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  UNIQUE (site_id, version)
);
-- Each site's name, tagline, about text, source colour, fonts and labels in the site's language (the Site Builder
-- chooses them once, before the first build).
CREATE TABLE IF NOT EXISTS site_identity (
  site_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,                           -- JSON SiteIdentity (sitebuild.ts)
  updated_at INTEGER NOT NULL
);
-- The spend ledger (ledger.ts): one row per run of the OpenAI Responses API, however it ended. Spend and tokens per site
-- and per agent are sums over these rows; a revision or a retry adds a row and never changes an older one.
CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                           -- request | article | photos | build
  job_id INTEGER NOT NULL,
  site_id TEXT NOT NULL,
  agent TEXT NOT NULL,                          -- Keyword | Content Writer | Site Builder
  model TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,                        -- ok | failed | timeout | cancelled
  backfilled INTEGER NOT NULL DEFAULT 0         -- 1: copied once from the cost a job row held before the ledger existed
);
CREATE INDEX IF NOT EXISTS job_runs_site ON job_runs(site_id, ended_at);
CREATE INDEX IF NOT EXISTS job_runs_ended ON job_runs(ended_at);
-- Search Console per page and query (metrics.ts): one row per site, day, page and query, kept for 16 months. The row
-- with an empty page and query is the day's total for the property (totals by page and query leave rows out).
CREATE TABLE IF NOT EXISTS gsc_rows (
  site_id TEXT NOT NULL,
  date TEXT NOT NULL,                           -- YYYY-MM-DD, as Search Console counts days
  page TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL DEFAULT '',
  clicks REAL NOT NULL DEFAULT 0,
  impressions REAL NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,             -- average position over the row's impressions
  PRIMARY KEY (site_id, date, page, query)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS gsc_rows_query ON gsc_rows(site_id, query, date);
-- Google Analytics 4 per site (ga4.ts). A row with a date and no page is that day's figures; a row with a page and
-- no date is that page over the last 28 days; the row with neither is the 28-day total (users do not add up by day).
CREATE TABLE IF NOT EXISTS ga4_rows (
  site_id TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT '',                -- YYYY-MM-DD, or ''
  page TEXT NOT NULL DEFAULT '',                -- the page path, or ''
  users INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  engaged INTEGER NOT NULL DEFAULT 0,           -- engaged sessions
  PRIMARY KEY (site_id, date, page)
) WITHOUT ROWID;
-- Workflow runs (workflows.ts): one row per run of a fixed sequence for a site ("Weekly content": research, articles,
-- human review, website build, approval, deploy). The jobs themselves are the rows of requests, articles and
-- site_builds this row points to; a run only records where it is, what it waits for and what it did.
CREATE TABLE IF NOT EXISTS workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                           -- weekly-content
  site_id TEXT NOT NULL,
  domain TEXT NOT NULL,                         -- the site's domain when the run started
  schedule_id TEXT NOT NULL DEFAULT '',         -- the schedule that started it; '' for "Run workflow"
  by TEXT NOT NULL DEFAULT '',                  -- who started it: a person's name, or "Schedule"
  topic TEXT NOT NULL DEFAULT '',               -- the research topic ('' = the site's topic)
  n INTEGER NOT NULL DEFAULT 2,                 -- how many articles to queue (1-5)
  status TEXT NOT NULL DEFAULT 'running',       -- running | done | failed | cancelled
  step TEXT NOT NULL DEFAULT 'research',        -- research | write | review | build | approve | deploy | done
  step_at INTEGER NOT NULL,                     -- when it entered this step
  wait TEXT NOT NULL DEFAULT '',                -- JSON { kind: agent | person | budget | queue, text }: what it waits for
  request_id INTEGER,
  own_request INTEGER NOT NULL DEFAULT 0,       -- 1: the run queued the request itself (a cancel may withdraw it)
  articles TEXT NOT NULL DEFAULT '[]',          -- JSON: ids of the articles it queued
  picked INTEGER NOT NULL DEFAULT 0,            -- 1 once the keywords were chosen and their articles queued
  build_id INTEGER,
  outcome TEXT NOT NULL DEFAULT '',             -- how it ended, in one sentence
  error TEXT NOT NULL DEFAULT '',
  log TEXT NOT NULL DEFAULT '[]',               -- JSON [{ at, text }]: what each step did
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS workflow_runs_site ON workflow_runs(site_id, status);
CREATE TABLE IF NOT EXISTS seo_tasks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL, domain TEXT NOT NULL,
 kind TEXT NOT NULL, agent TEXT NOT NULL, brief TEXT NOT NULL, model TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', result TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '',
 error TEXT NOT NULL DEFAULT '', tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
 service_cost_usd REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
 reviewed_at INTEGER, reviewed_by TEXT NOT NULL DEFAULT '', engine TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS seo_tasks_site ON seo_tasks(site_id, status);
`;

/** Creates whatever is missing and brings older tables up to date. Returns the columns migrate() added. */
export function initSchema(db: DatabaseSync): string[] {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(TABLES);
  return migrate(db);
}

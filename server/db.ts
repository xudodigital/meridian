// SQLite storage (Node's built-in node:sqlite). One file: data/meridian.db. The tables are in schema.ts.
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';
import { initSchema } from './schema.ts';

const DB_FILE = join(DATA_DIR, 'meridian.db');
/**
 * Opens the database. The data folder holds password hashes, sessions and the vault key, so only this computer's
 * user may read it: the folder is 0700 and the database files 0600, also for a folder made by an older Meridian.
 * A second writer (a backup, a test, another tool) makes SQLite wait up to 5 seconds instead of failing at once.
 */
function openDb(): DatabaseSync {
  try {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    chmodSync(DATA_DIR, 0o700);
    const opened = new DatabaseSync(DB_FILE, { timeout: 5000 });
    /* Creates missing tables and columns; an existing database keeps everything it has (schema.ts, migrate.ts). */
    initSchema(opened);
    for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) if (existsSync(f)) chmodSync(f, 0o600);
    return opened;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || /unable to open database|readonly database/i.test(String((e as Error).message))) {
      console.error(`Meridian cannot write to its data folder: ${DATA_DIR}\nCheck that the folder exists and that your user may write to it, then start Meridian again.`);
      process.exit(1);
    }
    throw e;
  }
}
export const db = openDb();

export type RequestRow = {
  id: number; site_id: string; domain: string; country: string; lang: string; site_topic: string;
  topic: string; goal: string; model: string; requested_by: string; retried_by: string; status: string; engine: string; step: string;
  summary: string; notes: string; error: string; tokens: number; cost_usd: number;
  created_at: number; started_at: number | null; finished_at: number | null;
};
export type KeywordRow = {
  id: number; request_id: number; site_id: string; keyword: string; meaning: string;
  intent: string; cluster: string; basis: string;
};

export type ArticleRow = {
  id: number; site_id: string; domain: string; country: string; lang: string; site_topic: string; keyword: string;
  request_id: number | null; model: string; status: string; engine: string; step: string; revision: number;
  pending_note: string; content: string; checks: string; notes: string; lang_review_by: string; lang_review_at: number | null;
  error: string; tokens: number; cost_usd: number; created_at: number; queued_at: number; started_at: number | null; finished_at: number | null;
};
export type ArticleEventRow = { id: number; article_id: number; at: number; actor: string; action: string; note: string };

export const q = {
  insertRequest: db.prepare(`INSERT INTO requests (site_id, domain, country, lang, site_topic, topic, goal, model, requested_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  getRequest: db.prepare('SELECT * FROM requests WHERE id = ?'),
  listRequests: db.prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 100'),
  nextQueued: db.prepare(`SELECT * FROM requests WHERE status = 'queued' ORDER BY id ASC LIMIT 1`),
  duplicate: db.prepare(`SELECT id FROM requests WHERE site_id = ? AND lower(topic) = lower(?) AND status IN ('queued', 'work')`),
  start: db.prepare(`UPDATE requests SET status = 'work', engine = ?, step = ?, started_at = ?, error = '' WHERE id = ?`),
  step: db.prepare('UPDATE requests SET step = ? WHERE id = ?'),
  finish: db.prepare(`UPDATE requests SET status = 'done', step = '', summary = ?, notes = ?, tokens = ?, cost_usd = ?, finished_at = ? WHERE id = ?`),
  fail: db.prepare(`UPDATE requests SET status = 'failed', step = '', error = ?, finished_at = ? WHERE id = ?`),
  requeue: db.prepare(`UPDATE requests SET status = 'queued', retried_by = ?, engine = '', step = '', error = '', summary = '', notes = '', started_at = NULL, finished_at = NULL WHERE id = ?`),
  requeueStale: db.prepare(`UPDATE requests SET status = 'queued', engine = '', step = '', started_at = NULL WHERE status = 'work'`),
  deleteKeywords: db.prepare('DELETE FROM keywords WHERE request_id = ?'),
  insertKeyword: db.prepare('INSERT INTO keywords (request_id, site_id, keyword, meaning, intent, cluster, basis) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  keywordsFor: db.prepare('SELECT * FROM keywords WHERE request_id = ? ORDER BY id'),
  allKeywords: db.prepare(`SELECT k.*, r.engine AS engine FROM keywords k JOIN requests r ON r.id = k.request_id WHERE r.status = 'done' ORDER BY k.id DESC LIMIT 500`),
};

/** Back in the queue: a revision when a reviewer's note is waiting, otherwise a first draft. */
const QUEUE_AGAIN = `CASE WHEN pending_note <> '' THEN 'revision' ELSE 'queued' END`;

export const qa = {
  insert: db.prepare(`INSERT INTO articles (site_id, domain, country, lang, site_topic, keyword, request_id, model, created_at, queued_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  get: db.prepare('SELECT * FROM articles WHERE id = ?'),
  list: db.prepare('SELECT * FROM articles ORDER BY id DESC LIMIT 200'),
  nextQueued: db.prepare(`SELECT * FROM articles WHERE status IN ('queued', 'revision') ORDER BY queued_at ASC, id ASC LIMIT 1`),
  duplicate: db.prepare(`SELECT id FROM articles WHERE site_id = ? AND lower(keyword) = lower(?) AND status IN ('queued', 'work', 'review', 'revision')`),
  start: db.prepare(`UPDATE articles SET status = 'work', engine = ?, step = ?, started_at = ?, finished_at = NULL, error = '' WHERE id = ?`),
  step: db.prepare('UPDATE articles SET step = ? WHERE id = ?'),
  finish: db.prepare(`UPDATE articles SET status = 'review', step = '', content = ?, checks = ?, notes = ?,
    revision = revision + (CASE WHEN pending_note <> '' THEN 1 ELSE 0 END), pending_note = '', lang_review_by = '', lang_review_at = NULL,
    tokens = ?, cost_usd = ?, finished_at = ? WHERE id = ?`),
  fail: db.prepare(`UPDATE articles SET status = 'failed', step = '', error = ?, finished_at = ? WHERE id = ?`),
  decide: db.prepare(`UPDATE articles SET status = ? WHERE id = ? AND status = 'review'`),
  revise: db.prepare(`UPDATE articles SET status = 'revision', pending_note = ?, queued_at = ?, error = '' WHERE id = ? AND status = 'review'`),
  languageReview: db.prepare(`UPDATE articles SET lang_review_by = ?, lang_review_at = ?, checks = ? WHERE id = ? AND status = 'review'`),
  retry: db.prepare(`UPDATE articles SET status = ${QUEUE_AGAIN}, engine = '', step = '', error = '', queued_at = ?, started_at = NULL, finished_at = NULL
    WHERE id = ? AND status = 'failed'`),
  requeueStale: db.prepare(`UPDATE articles SET status = ${QUEUE_AGAIN}, engine = '', step = '', started_at = NULL WHERE status = 'work'`),
  insertEvent: db.prepare('INSERT INTO article_events (article_id, at, actor, action, note) VALUES (?, ?, ?, ?, ?)'),
  eventsFor: db.prepare('SELECT * FROM article_events WHERE article_id = ? ORDER BY id'),
};

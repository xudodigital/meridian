// Schema changes for a database created by an older Meridian. Each change is checked against the table first,
// so running the migration again (every server start) changes nothing. No change ever drops or rewrites data.
import type { DatabaseSync } from 'node:sqlite';

/** The columns a table has now. */
export function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
}

/**
 * Adds a column when the table does not have it yet. Returns true when it was added.
 * `decl` must give a default (SQLite fills existing rows with it), for example `TEXT NOT NULL DEFAULT ''`.
 */
export function addColumn(db: DatabaseSync, table: string, column: string, decl: string): boolean {
  if (columns(db, table).includes(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  return true;
}

/** Brings an existing database up to date. Rows that were there before get an empty value. */
export function migrate(db: DatabaseSync): string[] {
  const added: string[] = [];
  /* Who asked for a research request, and who last asked to run it again. Empty for requests made before this. */
  if (addColumn(db, 'requests', 'requested_by', `TEXT NOT NULL DEFAULT ''`)) added.push('requests.requested_by');
  if (addColumn(db, 'requests', 'retried_by', `TEXT NOT NULL DEFAULT ''`)) added.push('requests.retried_by');
  /* The photos the Site Builder placed in an article and its latest photo job (photos.ts). Articles written before
     have none and no job. Checked first: a database from before articles gets the whole table from schema.ts. */
  if (columns(db, 'articles').length) {
    for (const [column, decl] of PHOTO_COLUMNS) if (addColumn(db, 'articles', column, decl)) added.push('articles.' + column);
    /* When a person archived the article (article-edit.ts). Existing articles are not archived. */
    if (addColumn(db, 'articles', 'archived_at', 'INTEGER DEFAULT NULL')) added.push('articles.archived_at');
    /* The category of the article on its site (links.ts). Articles written before have none. */
    if (addColumn(db, 'articles', 'category', `TEXT NOT NULL DEFAULT ''`)) added.push('articles.category');
  }
  /* Wrong 2-step codes in a row and the lock they lead to; and which audit entries the app posted (the rest are the
     server's own). Existing people start unlocked and existing entries count as the server's. */
  if (columns(db, 'users').length) {
    if (addColumn(db, 'users', 'totp_fails', 'INTEGER NOT NULL DEFAULT 0')) added.push('users.totp_fails');
    if (addColumn(db, 'users', 'totp_locked_until', 'INTEGER NOT NULL DEFAULT 0')) added.push('users.totp_locked_until');
  }
  if (columns(db, 'audit_log').length && addColumn(db, 'audit_log', 'client', 'INTEGER NOT NULL DEFAULT 0')) added.push('audit_log.client');
  /* Search volume and competition from DataForSEO, and whether a person tracks the keyword's position. Keywords
     proposed before have no volume and are not tracked. */
  if (columns(db, 'keywords').length) {
    for (const [column, decl] of KEYWORD_COLUMNS) if (addColumn(db, 'keywords', column, decl)) added.push('keywords.' + column);
  }
  for (const table of ['seo_tasks', 'site_builds', 'job_runs']) {
    if (columns(db, table).length && addColumn(db, table, 'engine', `TEXT NOT NULL DEFAULT ''`)) added.push(table + '.engine');
  }
  return added;
}

/** The volume and tracking columns of `keywords`, in the order schema.ts declares them. */
const KEYWORD_COLUMNS: [string, string][] = [
  ['volume', 'INTEGER DEFAULT NULL'],
  ['competition', `TEXT NOT NULL DEFAULT ''`],
  ['volume_at', 'INTEGER DEFAULT NULL'],
  ['track', 'INTEGER NOT NULL DEFAULT 0'],
];

/** The photo columns of `articles`, in the order schema.ts declares them. */
const PHOTO_COLUMNS: [string, string][] = [
  ['images', `TEXT NOT NULL DEFAULT '[]'`],
  ['photos_status', `TEXT NOT NULL DEFAULT ''`],
  ['photos_step', `TEXT NOT NULL DEFAULT ''`],
  ['photos_error', `TEXT NOT NULL DEFAULT ''`],
  ['photos_queued_at', 'INTEGER DEFAULT NULL'],
  ['photos_started_at', 'INTEGER DEFAULT NULL'],
  ['photos_finished_at', 'INTEGER DEFAULT NULL'],
  ['photos_tokens', 'INTEGER NOT NULL DEFAULT 0'],
  ['photos_cost', 'REAL NOT NULL DEFAULT 0'],
  ['photos_engine', `TEXT NOT NULL DEFAULT ''`],
];

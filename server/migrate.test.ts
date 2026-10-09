// The migration of a database made by an older Meridian. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { addColumn, columns, migrate } from './migrate.ts';
import { initSchema } from './schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The requests table as Meridian created it before it recorded who asked. */
function oldDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL, domain TEXT NOT NULL, country TEXT NOT NULL, lang TEXT NOT NULL,
    site_topic TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL, goal TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued', created_at INTEGER NOT NULL, finished_at INTEGER)`);
  db.prepare(`INSERT INTO requests (site_id, domain, country, lang, topic, goal, status, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('s1', 'kopi.example', 'Indonesia', 'Indonesian', 'cold brew', 'Find a new topic cluster', 'done', 1000, 2000);
  return db;
}

const tables = (db: DatabaseSync) => (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map(t => t.name);

describe('migrate', () => {
  it('adds who asked to an existing requests table and keeps its rows, with an empty value', () => {
    const db = oldDatabase();
    assert.deepEqual(migrate(db), ['requests.requested_by', 'requests.retried_by']);
    assert.ok(columns(db, 'requests').includes('requested_by'));
    const rows = db.prepare('SELECT id, topic, status, finished_at, requested_by, retried_by FROM requests').all();
    assert.deepEqual(rows.map(r => ({ ...r })), [{ id: 1, topic: 'cold brew', status: 'done', finished_at: 2000, requested_by: '', retried_by: '' }]);
    /* A new row can record who asked. */
    db.prepare(`INSERT INTO requests (site_id, domain, country, lang, topic, goal, requested_by, created_at) VALUES ('s1', 'k', 'c', 'l', 't', 'g', 'Dewi', 3)`).run();
    assert.equal((db.prepare('SELECT requested_by FROM requests WHERE id = 2').get() as { requested_by: string }).requested_by, 'Dewi');
  });

  it('changes nothing the second time', () => {
    const db = oldDatabase();
    migrate(db);
    const before = columns(db, 'requests');
    assert.deepEqual(migrate(db), []);
    assert.deepEqual(columns(db, 'requests'), before);
    assert.equal(addColumn(db, 'requests', 'requested_by', `TEXT NOT NULL DEFAULT ''`), false);
  });
});

describe('initSchema on a database from before accounts', () => {
  it('adds the account, workspace and step tables to a copy and keeps every row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meridian-migrate-'));
    try {
      const original = join(dir, 'meridian.db'), copy = join(dir, 'copy.db');
      const old = new DatabaseSync(original);
      old.exec(readFileSync(join(HERE, 'fixtures', 'schema-before-accounts.sql'), 'utf8'));
      old.prepare(`INSERT INTO requests (site_id, domain, country, lang, topic, goal, requested_by, status, engine, created_at, finished_at) VALUES ('s1', 'kopi.example', 'Indonesia', 'Indonesian', 'cold brew', 'g', 'Owner', 'done', 'simulation', 1, 2)`).run();
      old.prepare(`INSERT INTO articles (site_id, domain, country, lang, keyword, request_id, status, created_at, queued_at) VALUES ('s1', 'kopi.example', 'Indonesia', 'Indonesian', 'kopi', 1, 'review', 3, 3)`).run();
      old.prepare(`INSERT INTO article_events (article_id, at, actor, action) VALUES (1, 3, 'Owner', 'requested')`).run();
      const before = tables(old);
      old.close();
      copyFileSync(original, copy);

      const db = new DatabaseSync(copy);
      assert.deepEqual(initSchema(db), ['images', 'photos_status', 'photos_step', 'photos_error', 'photos_queued_at', 'photos_started_at', 'photos_finished_at', 'photos_tokens', 'photos_cost', 'photos_engine', 'archived_at', 'category'].map(c => 'articles.' + c).concat(['volume', 'competition', 'volume_at', 'volume_provider', 'volume_country', 'volume_lang', 'volume_group', 'track'].map(c => 'keywords.' + c)).concat(['site_builds.engine', 'job_runs.engine']), 'only the photo columns and the archive mark are new');
      /* The article written before photos existed has none, and no photo job. */
      assert.deepEqual({ ...(db.prepare('SELECT keyword, images, photos_status, photos_queued_at, photos_tokens FROM articles').get() as object) }, { keyword: 'kopi', images: '[]', photos_status: '', photos_queued_at: null, photos_tokens: 0 });
      assert.equal((db.prepare('SELECT archived_at FROM articles').get() as { archived_at: number | null }).archived_at, null, 'and it is not archived');
      assert.equal((db.prepare('SELECT category FROM articles').get() as { category: string }).category, '', 'and it has no category');
      assert.deepEqual(tables(db).filter(t => !before.includes(t)).sort(), ['access_checks', 'alerts', 'audit_log', 'ga4_rows', 'gsc_rows', 'integrations', 'invites', 'job_attempts', 'job_runs', 'job_steps', 'kv', 'notif_reads', 'password_resets', 'seo_tasks', 'sessions', 'site_builds', 'site_domains', 'site_identity', 'site_verifications', 'users', 'workflow_runs', 'workspace_docs']);
      assert.deepEqual({ ...(db.prepare('SELECT topic, requested_by, status FROM requests').get() as object) }, { topic: 'cold brew', requested_by: 'Owner', status: 'done' });
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM article_events').get() as { n: number }).n, 1);
      assert.ok(columns(db, 'users').includes('recovery_hashes'));
      /* Running again (every start) changes nothing. */
      const cols = tables(db).map(t => [t, columns(db, t)]);
      assert.deepEqual(initSchema(db), []);
      assert.deepEqual(tables(db).map(t => [t, columns(db, t)]), cols);
      /* Email is unique whatever its case. */
      db.prepare(`INSERT INTO users (name, email, role, pass_hash, created_at) VALUES ('A', 'a@example.com', 'admin', 'x', 1)`).run();
      assert.throws(() => db.prepare(`INSERT INTO users (name, email, role, pass_hash, created_at) VALUES ('B', 'A@EXAMPLE.COM', 'viewer', 'x', 1)`).run(), /UNIQUE/);
      db.close();
      /* The original was not touched. */
      const orig = new DatabaseSync(original);
      assert.deepEqual(tables(orig), before);
      orig.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

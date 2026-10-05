// Operations without a server: the backup archive and its rotation, restore (with the server lock), the log file and
// its rotation, what daily maintenance deletes, and the launchd service file. Everything runs in temporary folders;
// the real data folder is never opened. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_NAME, backupName, backupNow, backupPath, backupTime, backupsDir, keepers, listBackups, lockHolder, pruneBackups,
  restoreBackup, zipEntries, zipRead,
} from './backup.ts';
import { createLogger, mask, watchJobs } from './log.ts';
import { dueAt, pruneWorkFolders, runMaintenance, scheduledMaintenance, sweepTmp, type MaintResult } from './maintenance.ts';
import { initSchema } from './schema.ts';
import { zip } from './zip.ts';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(HERE);
const tmp = mkdtempSync(join(tmpdir(), 'meridian-ops-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const folder = () => { const d = join(tmp, 'case' + ++n); mkdirSync(d); return d; };
const mode = (p: string) => statSync(p).mode & 0o777;
const DAY = 24 * 3_600_000;

/** A data folder like a running server's: a database in WAL mode with an account, the key, a photo and a built page. */
function dataFolder(): { data: string; db: DatabaseSync } {
  const data = join(folder(), 'data');
  mkdirSync(data);
  const db = new DatabaseSync(join(data, 'meridian.db'));
  db.exec('PRAGMA journal_mode = WAL');
  initSchema(db);
  db.prepare(`INSERT INTO kv (key, value) VALUES ('marker', 'kept')`).run();
  writeFileSync(join(data, 'secret.key'), 'c2VjcmV0LWtleS1mb3ItdGVzdHM=\n', { mode: 0o600 });
  mkdirSync(join(data, 'media', 'articles', '7'), { recursive: true });
  writeFileSync(join(data, 'media', 'articles', '7', 'kopi-800.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  mkdirSync(join(data, 'sites', 's1', 'builds', '1'), { recursive: true });
  writeFileSync(join(data, 'sites', 's1', 'builds', '1', 'index.html'), '<h1>Kopi</h1>'.repeat(50));
  writeFileSync(join(data, 'sites', 's1', 'builds', '2.zip.123.tmp'), 'half');
  mkdirSync(join(data, 'workspaces', 'article-1'), { recursive: true });
  writeFileSync(join(data, 'workspaces', 'article-1', 'notes.txt'), 'work');
  return { data, db };
}

describe('backup', () => {
  it('writes a valid ZIP with a database snapshot that opens, the key, media and sites', async () => {
    const { data, db } = dataFolder();
    /* The connection stays open, as the server's does: what was written sits in the WAL, not in meridian.db. */
    const b = await backupNow(data, new Date(2026, 9, 3, 3, 0, 0));
    assert.equal(b.name, 'meridian-20261003-030000.zip');
    const file = join(data, 'backups', b.name);
    assert.equal(b.bytes, statSync(file).size);
    assert.equal(mode(file), 0o600);
    assert.equal(mode(join(data, 'backups')), 0o700);
    assert.deepEqual(readdirSync(join(data, 'backups')), [b.name], 'nothing is left behind next to the archive');

    /* The system's own unzip accepts it. */
    if (process.platform === 'darwin' || existsSync('/usr/bin/unzip')) execFileSync('unzip', ['-tq', file]);
    const items = zipEntries(file), names = items.map(i => i.name).sort();
    assert.deepEqual(names, ['backup.json', 'media/articles/7/kopi-800.jpg', 'meridian.db', 'secret.key', 'sites/s1/builds/1/index.html']);
    const read = (name: string) => zipRead(file, items.find(i => i.name === name)!);
    assert.equal(read('secret.key').toString(), readFileSync(join(data, 'secret.key'), 'utf8'));
    assert.equal(read('sites/s1/builds/1/index.html').toString(), '<h1>Kopi</h1>'.repeat(50));
    assert.deepEqual([...read('media/articles/7/kopi-800.jpg')], [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    assert.equal((JSON.parse(read('backup.json').toString()) as { app: string }).app, 'meridian');

    const snap = join(folder(), 'snapshot.db');
    writeFileSync(snap, read('meridian.db'));
    const copy = new DatabaseSync(snap);
    const tables = (copy.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(t => t.name);
    for (const t of ['users', 'sessions', 'workspace_docs', 'requests', 'articles', 'audit_log', 'kv']) assert.ok(tables.includes(t), 'table ' + t);
    assert.equal((copy.prepare(`SELECT value FROM kv WHERE key = 'marker'`).get() as { value: string }).value, 'kept');
    assert.equal(Object.values(copy.prepare('PRAGMA integrity_check').get() as object)[0], 'ok');
    copy.close(); db.close();
  });

  it('says so when there is no database yet', async () => {
    const data = join(folder(), 'data');
    await assert.rejects(backupNow(data), /no Meridian database/);
    assert.equal(existsSync(join(data, 'backups')), false);
  });

  it('names: only meridian-YYYYMMDD-HHMMSS.zip is a backup', () => {
    const dir = join(folder(), 'data');
    mkdirSync(join(dir, 'backups'), { recursive: true });
    const good = 'meridian-20261003-030000.zip';
    for (const name of [good, 'notes.txt', 'meridian-20261003-030000.zip.tmp', 'meridian-20261345-030000.zip', 'meridian.db']) writeFileSync(join(dir, 'backups', name), 'x');
    writeFileSync(join(dir, 'secret.key'), 'k');
    assert.deepEqual(listBackups(dir).map(b => b.name), [good]);
    assert.equal(backupPath(good, dir), join(dir, 'backups', good));
    for (const bad of ['../secret.key', 'secret.key', 'notes.txt', 'meridian.db', 'meridian-20261003-030000.zip.tmp', 'meridian-20261345-030000.zip',
      'meridian-20261003-030000.zip/..', '', '.', '..', 'meridian-20261003-030001.zip'])
      assert.equal(backupPath(bad, dir), null, bad);
    assert.equal(BACKUP_NAME.test(backupName(new Date())), true);
    assert.equal(backupTime(good)!.getTime(), new Date(2026, 9, 3, 3, 0, 0).getTime());
  });

  it('rotation keeps the newest of each of 7 days, then the newest of each of 4 weeks', () => {
    /* 60 nights at 03:00 ending Saturday 3 October 2026, plus two extra backups made by hand on the last day. */
    const end = new Date(2026, 9, 3, 3, 0, 0);
    const nightly = Array.from({ length: 60 }, (_, i) => backupName(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i, 3, 0, 0)));
    const manual = [backupName(new Date(2026, 9, 3, 9, 30, 0)), backupName(new Date(2026, 9, 3, 14, 0, 0))];
    const keep = [...keepers([...nightly, ...manual, 'notes.txt'])].sort().reverse();
    assert.deepEqual(keep, [
      /* 7 days: 27 Sep to 3 Oct, the newest of the day. */
      'meridian-20261003-140000.zip', 'meridian-20261002-030000.zip', 'meridian-20261001-030000.zip', 'meridian-20260930-030000.zip',
      'meridian-20260929-030000.zip', 'meridian-20260928-030000.zip', 'meridian-20260927-030000.zip',
      /* 4 weeks before that: the newest of each week (Saturday 26 Sep is the newest left of its week, then Sundays). */
      'meridian-20260926-030000.zip', 'meridian-20260920-030000.zip', 'meridian-20260913-030000.zip', 'meridian-20260906-030000.zip',
    ]);
    assert.deepEqual([...keepers(nightly.slice(0, 3))].length, 3, 'a young installation keeps everything it has');
    assert.equal(keepers([...nightly, ...manual], 2, 1).size, 3);
  });

  it('pruneBackups deletes exactly the files the rotation drops and nothing else', () => {
    const dir = join(folder(), 'data'), b = join(dir, 'backups');
    mkdirSync(b, { recursive: true });
    const names = Array.from({ length: 12 }, (_, i) => backupName(new Date(2026, 9, 3 - i * 3, 3, 0, 0)));
    for (const name of [...names, 'keep-me.txt']) writeFileSync(join(b, name), 'x');
    const keep = keepers(names);
    const gone = pruneBackups(dir);
    assert.deepEqual(gone.sort(), names.filter(x => !keep.has(x)).sort());
    assert.ok(gone.length > 0);
    assert.deepEqual(readdirSync(b).sort(), [...keep, 'keep-me.txt'].sort());
  });

  it('a new backup applies the rotation', async () => {
    const { data, db } = dataFolder();
    mkdirSync(join(data, 'backups'));
    for (let i = 1; i <= 40; i++) writeFileSync(join(data, 'backups', backupName(new Date(2026, 9, 3 - i, 3, 0, 0))), 'old');
    await backupNow(data, new Date(2026, 9, 3, 3, 0, 0));
    const left = listBackups(data);
    assert.equal(left.length, 11);
    assert.equal(left[0]!.name, 'meridian-20261003-030000.zip');
    db.close();
  });
});

describe('restore', () => {
  it('refuses while the server lock is held, and leaves everything as it was', async () => {
    const { data, db } = dataFolder();
    const b = await backupNow(data, new Date(2026, 9, 3, 3, 0, 0));
    db.close();
    const file = join(data, 'backups', b.name);
    /* The lock names a live process: this one. Both forms a lock file may have are understood. */
    for (const text of [String(process.pid), JSON.stringify({ pid: process.pid, port: 4310 }), `${process.pid}\n4310\n`]) {
      writeFileSync(join(data, 'meridian.lock'), text);
      assert.equal(lockHolder(data), process.pid);
      assert.throws(() => restoreBackup(file, data), /Meridian is running \(process \d+\)\. Stop it first/);
    }
    assert.deepEqual(readdirSync(dirname(data)), ['data'], 'no folder was created or renamed');
    assert.equal(existsSync(join(data, 'workspaces', 'article-1', 'notes.txt')), true);
  });

  it('a lock left by a process that is gone does not block; the old data is kept and the backups move along', async () => {
    const { data, db } = dataFolder();
    const b = await backupNow(data, new Date(2026, 9, 3, 3, 0, 0));
    /* Changes after the backup, which the restore must undo. */
    db.prepare(`UPDATE kv SET value = 'changed later' WHERE key = 'marker'`).run();
    db.close();
    writeFileSync(join(data, 'sites', 's1', 'builds', '1', 'index.html'), 'overwritten');
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(join(data, 'meridian.lock'), String(dead));
    assert.equal(lockHolder(data), 0);

    const at = new Date(2026, 9, 4, 10, 0, 0);
    const r = restoreBackup(join(data, 'backups', b.name), data, at);
    assert.equal(r.kept, data + '.before-restore-20261004-100000');
    assert.deepEqual(readdirSync(dirname(data)).sort(), ['data', 'data.before-restore-20261004-100000']);
    /* The restored folder: the snapshot, the key, the files; private. */
    const now = new DatabaseSync(join(data, 'meridian.db'));
    assert.equal((now.prepare(`SELECT value FROM kv WHERE key = 'marker'`).get() as { value: string }).value, 'kept');
    now.close();
    assert.equal(readFileSync(join(data, 'sites', 's1', 'builds', '1', 'index.html'), 'utf8'), '<h1>Kopi</h1>'.repeat(50));
    assert.equal(existsSync(join(data, 'media', 'articles', '7', 'kopi-800.jpg')), true);
    assert.equal(mode(data), 0o700);
    assert.equal(mode(join(data, 'meridian.db')), 0o600);
    assert.equal(mode(join(data, 'secret.key')), 0o600);
    assert.equal(existsSync(join(data, 'meridian.lock')), false);
    assert.deepEqual(listBackups(data).map(x => x.name), [b.name], 'the archives stay with the folder in use');
    /* The data from before: untouched. */
    const old = new DatabaseSync(join(r.kept!, 'meridian.db'));
    assert.equal((old.prepare(`SELECT value FROM kv WHERE key = 'marker'`).get() as { value: string }).value, 'changed later');
    old.close();
    assert.equal(readFileSync(join(r.kept!, 'sites', 's1', 'builds', '1', 'index.html'), 'utf8'), 'overwritten');
    assert.equal(existsSync(join(r.kept!, 'workspaces', 'article-1', 'notes.txt')), true);
  });

  it('refuses a file that is not a backup, a damaged one, and one with paths that leave the folder', async () => {
    const { data, db } = dataFolder();
    db.close();
    const dir = dirname(data);
    const before = () => readdirSync(dir).sort().join();
    const was = before();
    const text = join(dir, 'notes.zip'); writeFileSync(text, 'not a zip at all, just text');
    assert.throws(() => restoreBackup(text, data), /not a Meridian backup/);
    const other = join(dir, 'other.zip'); writeFileSync(other, zip([{ name: 'index.html', data: Buffer.from('hi') }]));
    assert.throws(() => restoreBackup(other, data), /not a Meridian backup/);
    const notDb = join(dir, 'notdb.zip'); writeFileSync(notDb, zip([{ name: 'meridian.db', data: Buffer.from('this is not sqlite') }]));
    assert.throws(() => restoreBackup(notDb, data), /damaged|cannot be opened|not a Meridian backup/);
    const good = readFileSync(join(data, 'meridian.db'));
    for (const name of ['../evil.txt', 'media/../../evil.txt', '/etc/evil', 'workspaces/x', 'sites//x', 'evil.txt']) {
      const z = join(dir, 'evil.zip'); writeFileSync(z, zip([{ name: 'meridian.db', data: good }, { name, data: Buffer.from('x') }]));
      assert.throws(() => restoreBackup(z, data), /should not/, name);
      rmSync(z);
    }
    assert.throws(() => restoreBackup(join(dir, 'missing.zip'), data), /not found/);
    for (const f of [text, other, notDb]) rmSync(f);
    assert.equal(before(), was.replace(',notes.zip', ''), 'nothing was renamed or left behind');
    assert.equal(existsSync(join(dir, 'evil.txt')), false);
    assert.equal(existsSync(join(data, 'meridian.db')), true);
  });

  it('backup.sh: backup, list and restore from the command line, and the refusal exits non-zero', () => {
    const { data, db } = dataFolder();
    db.close();
    const env = { ...process.env, MERIDIAN_DATA: data, PATH: dirname(process.execPath) + ':' + (process.env.PATH || '') };
    const sh = (...args: string[]) => spawnSync(join(ROOT, 'backup.sh'), args, { env, encoding: 'utf8', cwd: tmp });
    const made = sh();
    assert.equal(made.status, 0, made.stderr);
    assert.match(made.stdout, /Backup written: .*meridian-\d{8}-\d{6}\.zip/);
    assert.match(made.stdout, /encryption key/);
    const name = listBackups(data)[0]!.name;
    assert.match(sh('list').stdout, new RegExp(name.replace('.', '\\.')));

    writeFileSync(join(data, 'meridian.lock'), String(process.pid));
    const refused = sh('restore', name);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Meridian is running/);
    rmSync(join(data, 'meridian.lock'));

    const ok = sh('restore', join(data, 'backups', name));
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Restored \d+ files/);
    assert.match(ok.stdout, /before-restore/);
    assert.equal(readdirSync(dirname(data)).filter(f => f.startsWith('data.before-restore-')).length, 1);
    assert.equal(sh('restore').status, 1);
    assert.equal(sh('bogus').status, 1);
  });
});

describe('log file', () => {
  const lines = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);

  it('writes JSON lines with a time, level and event, in a private file', () => {
    const dir = join(folder(), 'logs');
    const log = createLogger(dir);
    log.info('server.start', { version: '0.1.0', port: 4310 });
    log.debug('noise', {});
    log.warn('job.end', { kind: 'article', id: 3, tokens: 1200, costUsd: 0.04 });
    const got = lines(log.file);
    assert.equal(got.length, 2, 'debug is below the default level');
    assert.deepEqual({ ...got[0], t: 0 }, { t: 0, level: 'info', event: 'server.start', version: '0.1.0', port: 4310 });
    assert.match(String(got[0]!.t), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(got[1]!.tokens, 1200);
    assert.equal(mode(log.file), 0o600);
    assert.equal(mode(dir), 0o700);
  });

  it('never writes secrets: fields named like one are dropped and tokens in paths are masked', () => {
    const log = createLogger(join(folder(), 'logs'));
    const token = 'A'.repeat(43);
    log.request({ method: 'POST', path: `/api/invites/${token}/accept`, status: 201, ms: 12, user: null });
    log.error('x', { password: 'hunter2hunter2', apiKey: 'sk-live', token: 'abc', cookie: 'meridian_session=1', body: '{"a":1}', nested: { secret: 's', ok: 1 }, error: new Error('failed for ' + token) });
    const raw = readFileSync(log.file, 'utf8');
    for (const leak of [token, 'hunter2', 'sk-live', 'meridian_session', '{\\"a\\"']) assert.equal(raw.includes(leak), false, leak);
    const got = lines(log.file);
    assert.deepEqual({ ...got[0], t: 0 }, { t: 0, level: 'info', event: 'request', method: 'POST', path: '/api/invites/[token]/accept', status: 201, ms: 12, user: null });
    assert.deepEqual(got[1]!.nested, { ok: 1 });
    assert.equal(got[1]!.error, 'failed for [token]');
    assert.equal(mask('/api/builds/12/zip'), '/api/builds/12/zip');
    log.request({ method: 'GET', path: '/api/state', status: 500, ms: 3, user: 7 });
    assert.equal(lines(log.file)[2]!.level, 'error');
  });

  it('rotates at the size limit and keeps the newest files only', () => {
    const dir = join(folder(), 'logs');
    const log = createLogger(dir, { maxBytes: 1000, keep: 3 });
    for (let i = 0; i < 200; i++) log.info('tick', { i, pad: 'x'.repeat(60) });
    assert.deepEqual(readdirSync(dir).sort(), ['meridian.log', 'meridian.log.1', 'meridian.log.2', 'meridian.log.3']);
    for (const f of readdirSync(dir)) assert.ok(statSync(join(dir, f)).size <= 1000, f);
    /* Oldest to newest across the files, with nothing lost in between and the last line in the current file. */
    const seq = ['meridian.log.3', 'meridian.log.2', 'meridian.log.1', 'meridian.log'].flatMap(f => lines(join(dir, f)).map(l => l.i as number));
    assert.equal(seq.at(-1), 199);
    assert.deepEqual(seq, Array.from({ length: seq.length }, (_, k) => 200 - seq.length + k));
    /* A new process continues the same file. */
    createLogger(dir, { maxBytes: 1000, keep: 3 }).info('again', {});
    assert.equal(lines(join(dir, 'meridian.log')).at(-1)!.event, 'again');
  });

  it('a log folder that cannot be written does not throw', () => {
    const blocker = join(folder(), 'file'); writeFileSync(blocker, 'x');
    const log = createLogger(join(blocker, 'logs'));
    assert.doesNotThrow(() => log.info('lost', {}));
  });

  it('job lines: one at the start and one at the end, with duration, tokens, cost and outcome', () => {
    const log = createLogger(join(folder(), 'logs'));
    const bus = new EventEmitter();
    watchJobs(bus, log);
    const art = { id: 5, siteId: 's1', startedAt: 1000, finishedAt: null, tokens: 0, costUsd: 0, error: '', photos: { status: '' } };
    bus.emit('article', { ...art, status: 'queued' });
    bus.emit('article', { ...art, status: 'work' });
    bus.emit('article', { ...art, status: 'work', step: 'Writing' });
    bus.emit('article', { ...art, status: 'review', finishedAt: 61_000, tokens: 5400, costUsd: 0.21 });
    bus.emit('article', { ...art, status: 'approved', finishedAt: 61_000, tokens: 5400, costUsd: 0.21 });
    bus.emit('request', { id: 2, siteId: 's2', status: 'work', startedAt: 5 });
    bus.emit('request', { id: 2, siteId: 's2', status: 'failed', startedAt: 5, finishedAt: 905, tokens: 0, costUsd: 0, error: 'Claude Code is not signed in.' });
    bus.emit('build', { id: 9, siteId: 's1', status: 'ready', deploy: 'work' });
    bus.emit('build', { id: 9, siteId: 's1', status: 'ready', deploy: 'live' });
    const got = lines(log.file).map(l => { const { t: _t, ...rest } = l; return rest; });
    assert.deepEqual(got, [
      { level: 'info', event: 'job.start', kind: 'article', id: 5, site: 's1' },
      { level: 'info', event: 'job.end', kind: 'article', id: 5, site: 's1', outcome: 'done', status: 'review', ms: 60_000, tokens: 5400, costUsd: 0.21 },
      { level: 'info', event: 'job.start', kind: 'research', id: 2, site: 's2' },
      { level: 'warn', event: 'job.end', kind: 'research', id: 2, site: 's2', outcome: 'failed', status: 'failed', ms: 900, tokens: 0, costUsd: 0, error: 'Claude Code is not signed in.' },
      { level: 'info', event: 'job.start', kind: 'deploy', id: 9, site: 's1' },
      { level: 'info', event: 'job.end', kind: 'deploy', id: 9, site: 's1', outcome: 'done', status: 'live', ms: null, tokens: 0, costUsd: 0 },
    ]);
  });
});

describe('maintenance', () => {
  const now = new Date(2026, 9, 3, 3, 0, 0).getTime();
  const aged = (p: string, days: number) => { const t = new Date(now - days * DAY); utimesSync(p, t, t); };

  it('prunes only job folders older than 7 days', () => {
    const work = join(folder(), 'workspaces');
    const make = (name: string, days: number, inner = days) => {
      mkdirSync(join(work, name), { recursive: true });
      writeFileSync(join(work, name, 'out.txt'), 'x');
      aged(join(work, name, 'out.txt'), inner);
      aged(join(work, name), days);
    };
    make('article-1', 30);
    make('request-2', 8);
    make('photos-3', 6);
    make('build-4', 0);
    /* An old folder whose job ran again yesterday stays. */
    make('article-5', 20, 1);
    make('article-6', 40);
    writeFileSync(join(work, 'loose-file.txt'), 'x'); aged(join(work, 'loose-file.txt'), 90);
    const gone = pruneWorkFolders(work, now, undefined, name => name === 'article-6');
    assert.deepEqual(gone.sort(), ['article-1', 'request-2']);
    assert.deepEqual(readdirSync(work).sort(), ['article-5', 'article-6', 'build-4', 'loose-file.txt', 'photos-3']);
    assert.deepEqual(pruneWorkFolders(join(work, 'missing'), now), []);
  });

  it('sweeps stray .tmp files and stale staging folders, not fresh ones and not real files', () => {
    const data = folder();
    mkdirSync(join(data, 'sites', 's1', 'builds'), { recursive: true });
    mkdirSync(join(data, 'backups', '.staging-1-1'), { recursive: true });
    mkdirSync(join(data, 'backups', '.staging-2-2'), { recursive: true });
    const old = join(data, 'sites', 's1', 'builds', '3.zip.991.tmp'), fresh = join(data, 'sites', 's1', 'builds', '4.zip.992.tmp');
    const real = join(data, 'sites', 's1', 'builds', '3.zip'), top = join(data, 'backups', 'meridian-20261001-030000.zip.5.tmp');
    for (const f of [old, fresh, real, top]) writeFileSync(f, 'x');
    for (const f of [old, real, top, join(data, 'backups', '.staging-1-1')]) aged(f, 1);
    assert.equal(sweepTmp(data, now), 3);
    assert.deepEqual([old, fresh, real, top].map(f => existsSync(f)), [false, true, true, false]);
    assert.deepEqual(readdirSync(join(data, 'backups')), ['.staging-2-2']);
  });

  it('a run does every step, reports what it did, and survives a failing step', async () => {
    const { data, db } = dataFolder();
    aged(join(data, 'workspaces', 'article-1', 'notes.txt'), 10); aged(join(data, 'workspaces', 'article-1'), 10);
    aged(join(data, 'sites', 's1', 'builds', '2.zip.123.tmp'), 1);
    const ran: string[] = [];
    const r = await runMaintenance({ dataDir: data, now: new Date(now), db: { exec: sql => { ran.push(sql); db.exec(sql); } } });
    assert.deepEqual(ran, ['PRAGMA optimize', 'PRAGMA wal_checkpoint(TRUNCATE)']);
    assert.deepEqual({ ...r, ms: 0 }, { at: now, ms: 0, backup: 'meridian-20261003-030000.zip', removedBackups: 0, workFolders: 1, tmpFiles: 1, errors: [] });
    assert.equal(existsSync(join(data, 'workspaces', 'article-1')), false);
    assert.equal(statSync(join(data, 'meridian.db-wal')).size, 0, 'the WAL was folded into the database');
    assert.equal(listBackups(data).length, 1);

    const bad = await runMaintenance({ dataDir: data, now: new Date(now + DAY), db: { exec: () => { throw new Error('database is locked'); } } });
    assert.deepEqual(bad.errors, ['Database optimize: database is locked', 'Database checkpoint: database is locked']);
    assert.equal(bad.backup, 'meridian-20261004-030000.zip', 'the backup still ran');
    db.close();
    const none = await runMaintenance({ dataDir: join(folder(), 'nothing-here') });
    assert.equal(none.errors.length, 1);
    assert.match(none.errors[0]!, /^Backup: There is no Meridian database/);
  });

  it('is due once a day at 03:00 local time, and skips work folders while a job runs', async () => {
    assert.equal(dueAt(new Date(2026, 9, 3, 2, 59)), new Date(2026, 9, 2, 3, 0).getTime());
    assert.equal(dueAt(new Date(2026, 9, 3, 3, 0)), new Date(2026, 9, 3, 3, 0).getTime());
    assert.equal(dueAt(new Date(2026, 9, 3, 23, 0)), new Date(2026, 9, 3, 3, 0).getTime());
    const done: MaintResult[] = [];
    const at = new Date(2026, 9, 3, 9, 0);
    const notDue = await scheduledMaintenance({ db: { exec: () => undefined }, last: () => new Date(2026, 9, 3, 3, 0, 5).getTime(), done: r => done.push(r) }, at);
    assert.equal(notDue, null);
    assert.equal(done.length, 0);

    const { data, db } = dataFolder();
    const old = new Date(at.getTime() - 10 * DAY);
    utimesSync(join(data, 'workspaces', 'article-1', 'notes.txt'), old, old); utimesSync(join(data, 'workspaces', 'article-1'), old, old);
    let last = 0;
    const opts = { dataDir: data, db, last: () => last, done: (r: MaintResult) => { done.push(r); last = r.at; } };
    const busy = await scheduledMaintenance({ ...opts, jobRunning: () => true }, at);
    assert.equal(busy?.workFolders, 0);
    assert.equal(existsSync(join(data, 'workspaces', 'article-1')), true, 'left alone while a job runs');
    assert.equal(busy?.backup, 'meridian-20261003-090000.zip');
    assert.equal(await scheduledMaintenance(opts, new Date(2026, 9, 3, 9, 1)), null, 'not twice on one day');
    const next = await scheduledMaintenance(opts, new Date(2026, 9, 4, 3, 0, 30));
    assert.equal(next?.workFolders, 1);
    assert.equal(done.length, 2);
    db.close();
  });
});

describe('automatic backup setting', () => {
  it('skips archives while disabled, continues housekeeping, and can be enabled on a later run', async () => {
    const { data, db } = dataFolder();
    const ran: string[] = [];
    let enabled = false, last = 0;
    const opts = { dataDir: data, db: { exec: (sql: string) => { ran.push(sql); db.exec(sql); } }, last: () => last, backupEnabled: () => enabled, done: (r: MaintResult) => { last = r.at; } };
    const skipped = await scheduledMaintenance(opts, new Date(2026, 9, 3, 9));
    assert.equal(skipped?.backup, '');
    assert.deepEqual(skipped?.errors, []);
    assert.ok(ran.includes('PRAGMA optimize'));
    assert.equal(existsSync(join(data, 'backups')), false);
    enabled = true;
    const made = await scheduledMaintenance(opts, new Date(2026, 9, 4, 9));
    assert.equal(made?.backup, 'meridian-20261004-090000.zip');
    db.close();
  });
});

describe('service file', () => {
  it('service.sh print gives a launchd plist that passes plutil -lint, with restart and log settings', { skip: process.platform !== 'darwin' }, () => {
    const out = spawnSync(join(ROOT, 'service.sh'), ['print'], { encoding: 'utf8', env: { ...process.env, MERIDIAN_DATA: '/tmp/meridian <data> & more', PORT: '4399' } });
    assert.equal(out.status, 0, out.stderr);
    const file = join(folder(), 'com.meridian.server.plist');
    writeFileSync(file, out.stdout);
    assert.match(execFileSync('plutil', ['-lint', file], { encoding: 'utf8' }), /OK/);
    const json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' })) as Record<string, unknown>;
    assert.equal(json.Label, 'com.meridian.server');
    assert.equal(json.KeepAlive, true);
    assert.equal(json.RunAtLoad, true);
    assert.equal(json.ThrottleInterval, 10);
    assert.equal(json.WorkingDirectory, ROOT);
    const args = json.ProgramArguments as string[];
    assert.match(args[0]!, /\/node$/);
    assert.equal(args.at(-1), join(ROOT, 'server', 'main.ts'));
    /* Paths with characters XML reserves survive. */
    assert.equal(json.StandardOutPath, '/tmp/meridian <data> & more/logs/service.log');
    assert.equal(json.StandardErrorPath, json.StandardOutPath);
    const env = json.EnvironmentVariables as { PORT: string; PATH: string; MERIDIAN_DATA: string };
    assert.equal(env.PORT, '4399');
    assert.equal(env.PATH.split(':')[0], dirname(args[0]!));
    assert.ok(env.PATH.split(':').includes('/usr/bin'));
  });

  it('never installs anything by itself: an unknown command only prints the usage', () => {
    const out = spawnSync(join(ROOT, 'service.sh'), [], { encoding: 'utf8' });
    assert.equal(out.status, 1);
    assert.match(out.stdout, /Usage: \.\/service\.sh install \| uninstall \| status \| print/);
  });
});

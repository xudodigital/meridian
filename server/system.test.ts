// Operations end to end against a real server with a temporary data folder: the admin health view, making, listing
// and downloading backups (and who may), and what the server writes to its log file. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { lockHolder, restoreBackup, zipEntries, zipRead } from './backup.ts';
import { Client, PASSWORD, member, owner, saveSites, startServer, until, type Json, type TestServer } from './testkit.ts';

let s: TestServer, admin: Client, editor: Client, viewer: Client;
const data = () => join(s.tmp, 'data');
const mode = (p: string) => statSync(p).mode & 0o777;
const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const logLines = () => {
  const f = join(data(), 'logs', 'meridian.log');
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Json) : [];
};
/** A plain GET that returns the bytes (a download), with the client's session. */
const download = async (c: Client, path: string) => {
  const r = await fetch(c.base + path, { headers: c.cookie ? { cookie: 'meridian_session=' + c.cookie } : {} });
  return { status: r.status, type: r.headers.get('content-type') || '', disposition: r.headers.get('content-disposition') || '', cache: r.headers.get('cache-control') || '', bytes: Buffer.from(await r.arrayBuffer()) };
};

before(async () => {
  s = await startServer();
  admin = await owner(s, 'Owner Person', 'owner@example.com');
  editor = await member(s, admin, 'editor', 'editor@example.com', 'Eddie Editor');
  viewer = await member(s, admin, 'viewer', 'viewer@example.com', 'Vic Viewer');
  await saveSites(admin, [{ id: 's1', domain: 'example-id.com', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live' } as never]);
  /* What a used installation has on disk besides the database. */
  if (!existsSync(join(data(), 'secret.key'))) writeFileSync(join(data(), 'secret.key'), randomBytes(32).toString('base64') + '\n', { mode: 0o600 });
  mkdirSync(join(data(), 'media', 'articles', '1'), { recursive: true });
  writeFileSync(join(data(), 'media', 'articles', '1', 'kopi-800.jpg'), Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4]));
  mkdirSync(join(data(), 'sites', 's1', 'builds', '1'), { recursive: true });
  writeFileSync(join(data(), 'sites', 's1', 'builds', '1', 'index.html'), '<h1>Kopi</h1>');
});
after(() => { s?.stop(); });

describe('who may', () => {
  it('needs a session, and an admin', async () => {
    const anon = new Client(s.base);
    for (const path of ['/api/system/health', '/api/system/backups', '/api/system/backups/meridian-20260101-000000.zip']) {
      assert.equal((await anon.get(path)).status, 401, path);
      for (const c of [editor, viewer]) {
        const r = await c.get(path);
        assert.equal(r.status, 403, path);
        assert.equal(typeof r.data.error, 'string');
      }
    }
    assert.equal((await anon.post('/api/system/backup')).status, 401);
    assert.equal((await editor.post('/api/system/backup')).status, 403);
    assert.equal((await viewer.post('/api/system/backup')).status, 403);
    assert.equal(existsSync(join(data(), 'backups')), false, 'a refused request makes no backup');
    /* The write header is required like on every other write. */
    assert.equal((await admin.req('POST', '/api/system/backup', {}, { 'x-meridian': '0' })).status, 403);
  });

  it('the open health check stays minimal', async () => {
    const r = await new Client(s.base).get('/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
  });
});

describe('health', () => {
  it('reports version, uptime, database, queue, engine, disk, folders, backups and schedulers', async () => {
    const r = await admin.get('/api/system/health');
    assert.equal(r.status, 200);
    const h = r.data.health as Json;
    assert.deepEqual(Object.keys(h).sort(), ['backups', 'db', 'disk', 'engine', 'folders', 'node', 'queue', 'schedulers', 'startedAt', 'uptimeSec', 'version']);
    assert.equal(h.version, version);
    assert.equal(h.node, process.version);
    assert.ok(typeof h.uptimeSec === 'number' && h.uptimeSec >= 0 && h.uptimeSec < 600);
    assert.ok(Math.abs((h.startedAt as number) - Date.now()) < 600_000);
    const db = h.db as Json;
    assert.equal(db.ok, true);
    assert.ok((db.bytes as number) + (db.walBytes as number) > 0);
    const engine = h.engine as Json;
    assert.deepEqual(Object.keys(engine).sort(), ['apiVersion', 'mode', 'ready', 'reason']);
    assert.equal(engine.mode, 'openai-api');
    const disk = h.disk as Json;
    assert.ok((disk.freeBytes as number) > 0 && (disk.totalBytes as number) >= (disk.freeBytes as number));
    const folders = h.folders as Record<string, number>;
    assert.deepEqual(Object.keys(folders).sort(), ['backups', 'logs', 'media', 'sites', 'workspaces']);
    assert.equal(folders.media, 7);
    assert.equal(folders.sites, 13);
    assert.ok(folders.logs! > 0, 'the log file exists by now');
    assert.deepEqual(h.backups, { count: 0, last: null, keepDaily: 7, keepWeekly: 4, nightlyHour: 3, autoEnabled: true });
    assert.deepEqual(h.schedulers, { maintenance: null, report: null, metrics: null, accessCheck: null });
    /* The queue as jobs.ts reports it, or null from a jobs.ts without a snapshot. */
    if (h.queue !== null) {
      const q = h.queue as Json;
      assert.equal(q.running, null);
      assert.equal(typeof q.queued, 'object');
    }
    /* Nothing secret: no paths of this computer, no keys. */
    assert.equal(JSON.stringify(h).includes(s.tmp), false);
  });
});

describe('backups', () => {
  let name = '';

  it('only an admin can change automatic backups, validates the setting and persists it', async () => {
    const path = '/api/system/backup-settings';
    assert.equal((await new Client(s.base).post(path, { autoEnabled: false })).status, 401);
    assert.equal((await editor.post(path, { autoEnabled: false })).status, 403);
    assert.equal((await viewer.post(path, { autoEnabled: false })).status, 403);
    assert.equal((await admin.req('POST', path, { autoEnabled: false }, { 'x-meridian': '0' })).status, 403);
    assert.equal((await admin.post(path, { autoEnabled: 'false' })).status, 400);
    assert.equal((await admin.post(path, { autoEnabled: false })).status, 200);
    assert.equal(((await admin.get('/api/system/health')).data.health as { backups: { autoEnabled: boolean } }).backups.autoEnabled, false);
    assert.equal((s.db().prepare("SELECT value FROM kv WHERE key = 'maintenance:backup-enabled'").get() as { value: string }).value, 'false');
    assert.equal(existsSync(join(data(), 'backups')), false, 'changing the setting creates no archive');
    assert.equal((await admin.post(path, { autoEnabled: true })).status, 200);
  });

  it('"Back up now" writes a private archive with the database, the key, media and sites, and records who did it', async () => {
    assert.deepEqual((await admin.get('/api/system/backups')).data, { backups: [] });
    const r = await admin.post('/api/system/backup');
    assert.equal(r.status, 201);
    const b = r.data.backup as { name: string; bytes: number; at: number };
    name = b.name;
    assert.match(name, /^meridian-\d{8}-\d{6}\.zip$/);
    assert.ok(Math.abs(b.at - Date.now()) < 60_000);
    const file = join(data(), 'backups', name);
    assert.equal(statSync(file).size, b.bytes);
    assert.equal(mode(file), 0o600);
    assert.equal(mode(join(data(), 'backups')), 0o700);
    assert.deepEqual(r.data.backups, [b]);
    assert.deepEqual((await admin.get('/api/system/backups')).data.backups, [b]);

    const items = zipEntries(file);
    assert.deepEqual(items.map(i => i.name).sort(), ['backup.json', 'media/articles/1/kopi-800.jpg', 'meridian.db', 'secret.key', 'sites/s1/builds/1/index.html']);
    assert.equal(zipRead(file, items.find(i => i.name === 'secret.key')!).toString(), readFileSync(join(data(), 'secret.key'), 'utf8'));
    /* The snapshot opens by itself and has what the running server has, although that still sits in the WAL. */
    const snap = join(s.tmp, 'snapshot.db');
    writeFileSync(snap, zipRead(file, items.find(i => i.name === 'meridian.db')!));
    const copy = new DatabaseSync(snap);
    const emails = (copy.prepare('SELECT email FROM users ORDER BY id').all() as { email: string }[]).map(u => u.email);
    assert.deepEqual(emails, ['owner@example.com', 'editor@example.com', 'viewer@example.com']);
    assert.match((copy.prepare(`SELECT data FROM workspace_docs WHERE id = 'sites'`).get() as { data: string }).data, /example-id\.com/);
    copy.close();

    const audit = ((await admin.get('/api/workspace')).data.audit as { act: string; actor: string }[]).find(a => a.act === 'Made a backup: ' + name);
    assert.equal(audit?.actor, 'Owner Person');
    const h = (await admin.get('/api/system/health')).data.health as Json;
    assert.deepEqual(h.backups, { count: 1, last: b, keepDaily: 7, keepWeekly: 4, nightlyHour: 3, autoEnabled: true });
    assert.equal((h.folders as Record<string, number>).backups, b.bytes);
  });

  it('downloads a backup by its exact name, as an attachment that is not cached', async () => {
    const r = await download(admin, '/api/system/backups/' + name);
    assert.equal(r.status, 200);
    assert.equal(r.type, 'application/zip');
    assert.equal(r.disposition, `attachment; filename="${name}"`);
    assert.equal(r.cache, 'no-store');
    assert.deepEqual(r.bytes, readFileSync(join(data(), 'backups', name)));
    const audit = ((await admin.get('/api/workspace')).data.audit as { act: string }[]).some(a => a.act === 'Downloaded a backup: ' + name);
    assert.equal(audit, true);
    assert.equal((await download(editor, '/api/system/backups/' + name)).status, 403);
    assert.equal((await download(new Client(s.base), '/api/system/backups/' + name)).status, 401);
  });

  it('restore is refused while this server runs, by the lock the server itself holds', () => {
    const pid = lockHolder(data());
    assert.ok(pid > 0 && pid !== process.pid, 'the running server holds data/meridian.lock');
    assert.throws(() => restoreBackup(join(data(), 'backups', name), data()), new RegExp(`Meridian is running \\(process ${pid}\\)\\. Stop it first`));
    assert.equal(existsSync(join(data(), 'meridian.db')), true);
    assert.deepEqual(readdirSync(s.tmp).filter(f => f.startsWith('data.')), [], 'nothing was unpacked or renamed');
  });

  it('refuses every name that is not a backup: other files, other folders, encoded tricks', async () => {
    writeFileSync(join(data(), 'backups', 'notes.txt'), 'private');
    const bad = [
      'notes.txt', 'secret.key', 'meridian.db', name + '.tmp', name.replace('.zip', ''), name.toUpperCase(),
      '..%2Fsecret.key', '..%2F..%2Fdata%2Fsecret.key', '%2e%2e%2fmeridian.db', '..%5Csecret.key', '../secret.key', '..',
      name + '%2F..%2F..%2Fsecret.key', name + '%00', '%00' + name, 'meridian-20261345-999999.zip', 'meridian-00000000-000000.zip',
    ];
    for (const b of bad) {
      const r = await download(admin, '/api/system/backups/' + b);
      assert.ok(r.status === 400 || r.status === 404, `${b} -> ${r.status}`);
      assert.match(r.type, /application\/json/, b);
      assert.equal(r.bytes.includes('private'), false);
    }
    /* A well-formed name with no file behind it. */
    const missing = await admin.get('/api/system/backups/meridian-20200101-000000.zip');
    assert.equal(missing.status, 404);
    assert.match(String(missing.data.error), /not found/i);
    assert.equal((await admin.get('/api/system/nothing')).status, 404);
  });
});

describe('log file', () => {
  it('has the start line with the version and one line per API request with the user id; no bodies, no tokens', async () => {
    const me = ((await admin.get('/api/auth/me')).data.user as { id: number } | undefined)?.id ?? null;
    const token = 'Zz'.repeat(22);
    await new Client(s.base).get(`/api/invites/${token}`);
    await new Client(s.base).post('/api/auth/sign-in', { email: 'owner@example.com', password: PASSWORD + ' wrong' });
    const lines = await until('the request lines', async () => {
      const l = logLines();
      return l.some(x => x.event === 'request' && String(x.path).startsWith('/api/invites/')) && l.some(x => x.path === '/api/auth/sign-in' && x.status !== 200) ? l : null;
    });
    const start = lines.find(l => l.event === 'server.start')!;
    assert.equal(start.version, version);
    assert.equal(start.node, process.version);
    assert.equal(typeof start.pid, 'number');
    assert.equal(lines.filter(l => l.event === 'server.start').length, 1);

    const reqs = lines.filter(l => l.event === 'request');
    for (const r of reqs) assert.deepEqual(Object.keys(r).sort(), ['event', 'level', 'method', 'ms', 'path', 'status', 't', 'user']);
    const health = reqs.find(r => r.path === '/api/system/health' && r.status === 200)!;
    assert.equal(health.method, 'GET');
    assert.equal(typeof health.ms, 'number');
    assert.ok(typeof health.user === 'number' && (me === null || health.user === me), 'the signed-in person');
    assert.ok(reqs.some(r => r.path === '/api/system/backup' && r.method === 'POST' && r.status === 201));
    assert.ok(reqs.some(r => r.path === '/api/system/backup' && r.status === 403 && typeof r.user === 'number' && r.user !== health.user), 'a refused request names who tried');
    assert.ok(reqs.some(r => r.path === '/api/invites/[token]' && r.user === null), 'the token in the path is masked');
    assert.ok(lines.some(l => l.event === 'backup.made' && l.by === health.user));

    const raw = readFileSync(join(data(), 'logs', 'meridian.log'), 'utf8');
    for (const leak of [token, PASSWORD, 'owner@example.com', 'meridian_session', admin.cookie]) assert.equal(raw.includes(leak), false, 'the log holds ' + leak.slice(0, 12));
    assert.equal(mode(join(data(), 'logs', 'meridian.log')), 0o600);
    assert.equal(mode(join(data(), 'logs')), 0o700);
    /* The console keeps its two startup lines and gets no request lines. */
    assert.match(s.output(), /Engine: /);
    assert.match(s.output(), /Meridian is running at http:\/\/localhost:\d+/);
    assert.equal(s.output().includes('"event"'), false);
  });

  it('logs a job from start to end', async () => {
    const r = await admin.post('/api/requests', { siteId: 's1', domain: 'example-id.com', country: 'Indonesia', lang: 'Indonesian', siteTopic: 'Coffee', topic: 'kopi susu', goal: 'Find a new topic cluster', model: 'GPT-6 Luna' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = (r.data.request as Json).id as number;
    const end = await until('the job lines', async () => logLines().find(l => l.event === 'job.end' && l.kind === 'research' && l.id === id));
    assert.equal(end.site, 's1');
    /* The line says what the dashboard says about the request, whichever way the job went. */
    const shown = ((await admin.get('/api/state')).data.requests as { id: number; status: string; tokens: number }[]).find(x => x.id === id)!;
    assert.equal(end.outcome, shown.status, JSON.stringify(end));
    assert.equal(end.level, shown.status === 'failed' ? 'warn' : 'info');
    assert.equal(end.tokens, shown.tokens);
    assert.equal(typeof end.ms, 'number');
    assert.equal(typeof end.tokens, 'number');
    assert.equal(typeof end.costUsd, 'number');
    const lines = logLines();
    const startAt = lines.findIndex(l => l.event === 'job.start' && l.kind === 'research' && l.id === id);
    assert.ok(startAt >= 0 && startAt < lines.findIndex(l => l.event === 'job.end' && l.kind === 'research' && l.id === id));
    assert.equal(readFileSync(join(data(), 'logs', 'meridian.log'), 'utf8').includes('kopi susu'), false, 'no topic, prompt or result text');
  });

  it('writes the stop line when the server stops', async () => {
    const other = await startServer();
    const file = join(other.tmp, 'data', 'logs', 'meridian.log');
    await until('the start line', async () => existsSync(file) && readFileSync(file, 'utf8').includes('server.start'));
    /* stop() also deletes the folder, so the server is asked to stop the way Ctrl+C does and the file read before. */
    const pid = (JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!) as { pid: number }).pid;
    process.kill(pid, 'SIGTERM');
    const last = await until('the stop line', async () => {
      const l = readFileSync(file, 'utf8').trim().split('\n').map(x => JSON.parse(x) as Json).find(x => x.event === 'server.stop');
      return l ?? null;
    });
    assert.equal(last.version, version);
    assert.equal(typeof last.uptimeSec, 'number');
    other.stop();
  });
});

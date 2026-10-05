// Operations, for admins: backups (make one, list them, download one), the detailed health view behind
// Settings > System, and the wiring that starts the log, the job log lines and the nightly maintenance.
// GET /api/health stays open and minimal (main.ts); everything here needs an admin session.
import { createReadStream, statfsSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { actorOf, mayAdmin, type Ctx } from './access.ts';
import { BACKUP_NAME, KEEP_DAILY, KEEP_WEEKLY, backupNow, backupPath, listBackups } from './backup.ts';
import { db } from './db.ts';
import { engineStatus } from './engine.ts';
import { bus } from './events.ts';
import { body, json } from './http.ts';
import * as jobs from './jobs.ts';
import { log, watchJobs } from './log.ts';
import { MAINTENANCE_HOUR, schedule as scheduleMaintenance, type MaintResult } from './maintenance.ts';
import { DATA_DIR } from './paths.ts';
import { sessionByToken, tokenFrom } from './sessions.ts';
import { VERSION } from './version.ts';
import { addAudit } from './workspace.ts';

const DOWNLOAD = /^\/api\/system\/backups\/([^/]+)$/;
const startedAt = Date.now();

const kv = {
  get: db.prepare('SELECT value FROM kv WHERE key = ?'),
  put: db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)'),
  lastCheck: db.prepare(`SELECT MAX(at) AS at FROM access_checks WHERE by = 'Schedule'`),
};
const MAINT_KEY = 'maintenance:last';
const AUTO_BACKUP_KEY = 'maintenance:backup-enabled';
function kvJson<T>(key: string): T | null {
  try { const v = (kv.get.get(key) as { value: string } | undefined)?.value; return v ? JSON.parse(v) as T : null; } catch { return null; }
}
const lastMaintenance = (): MaintResult | null => kvJson<MaintResult>(MAINT_KEY);
const backupEnabled = (): boolean => kvJson<boolean>(AUTO_BACKUP_KEY) !== false;

/**
 * The queue as jobs.ts reports it (the running job with its kind, id and age; how many wait per kind), or null when
 * this jobs.ts has no queueSnapshot. Read through the module object so either version of jobs.ts works.
 */
function queueSnapshot(): unknown {
  const fn = (jobs as Record<string, unknown>).queueSnapshot;
  if (typeof fn !== 'function') return null;
  try { return (fn as () => unknown)() ?? null; } catch { return null; }
}
const jobRunning = (): boolean => { const q = queueSnapshot(); return !!q && typeof q === 'object' && !!(q as { running?: unknown }).running; };

const fileSize = (p: string): number => { try { return statSync(p).size; } catch { return 0; } };
/** The bytes of every file under a folder; 0 when it does not exist. */
async function folderSize(dir: string): Promise<number> {
  let total = 0;
  let list;
  try { list = await readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const d of list) {
    const full = join(dir, d.name);
    if (d.isDirectory()) total += await folderSize(full);
    else if (d.isFile()) total += await stat(full).then(s => s.size, () => 0);
  }
  return total;
}
const FOLDERS = ['media', 'sites', 'backups', 'logs', 'workspaces'] as const;
type Folders = Record<(typeof FOLDERS)[number], number>;
/* Walking the folders costs a moment on a large installation; the card asks every half minute. */
let sizes: { at: number; value: Folders } | null = null;
async function folderSizes(fresh: boolean): Promise<Folders> {
  if (!fresh && sizes && Date.now() - sizes.at < 60_000) return sizes.value;
  const value = Object.fromEntries(await Promise.all(FOLDERS.map(async f => [f, await folderSize(join(DATA_DIR, f))] as const))) as Folders;
  sizes = { at: Date.now(), value };
  return value;
}

function disk(): { freeBytes: number; totalBytes: number } | null {
  try { const s = statfsSync(DATA_DIR); return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }; }
  catch { return null; }
}
function dbOk(): boolean { try { return (db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1; } catch { return false; } }

/** Everything Settings > System shows. `fresh` measures the folders again (after a backup). */
export async function health(fresh = false) {
  const engine = await engineStatus();
  const backups = listBackups();
  const maint = lastMaintenance();
  const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  return {
    version: VERSION, node: process.version, startedAt, uptimeSec: Math.round(process.uptime()),
    db: { ok: dbOk(), bytes: fileSize(join(DATA_DIR, 'meridian.db')), walBytes: fileSize(join(DATA_DIR, 'meridian.db-wal')) },
    queue: queueSnapshot(),
    engine: { mode: engine.mode, apiVersion: engine.apiVersion, ready: engine.ready, reason: engine.reason, ...(engine.model ? { model: engine.model } : {}) },
    disk: disk(),
    folders: await folderSizes(fresh),
    backups: { count: backups.length, last: backups[0] ?? null, keepDaily: KEEP_DAILY, keepWeekly: KEEP_WEEKLY, nightlyHour: MAINTENANCE_HOUR, autoEnabled: backupEnabled() },
    /* When each timer last did its work; null when it never has. */
    schedulers: {
      maintenance: maint ? { at: maint.at, errors: maint.errors } : null,
      report: num(kvJson<{ at?: unknown }>('report:last')?.at),
      metrics: num(kvJson<{ at?: unknown }>('gsc:metrics')?.at),
      accessCheck: num((kv.lastCheck.get() as { at: number | null } | undefined)?.at),
    },
  };
}

export async function systemApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  if (!path.startsWith('/api/system/')) return false;
  const m = req.method || 'GET';
  const no = mayAdmin(ctx.user);
  if (no) { json(res, no.status, { error: no.error }); return true; }

  if (m === 'GET' && path === '/api/system/health') { json(res, 200, { health: await health() }); return true; }
  if (m === 'GET' && path === '/api/system/backups') { json(res, 200, { backups: listBackups() }); return true; }
  if (m === 'POST' && path === '/api/system/backup-settings') {
    const b = await body(req);
    if (typeof b.autoEnabled !== 'boolean') { json(res, 400, { error: 'autoEnabled must be a boolean.' }); return true; }
    kv.put.run(AUTO_BACKUP_KEY, JSON.stringify(b.autoEnabled));
    bus.emit('audit', addAudit(actorOf(ctx), b.autoEnabled ? 'Enabled automatic nightly backups' : 'Disabled automatic nightly backups'));
    json(res, 200, { autoEnabled: b.autoEnabled });
    return true;
  }
  if (m === 'POST' && path === '/api/system/backup') {
    let backup;
    try { backup = await backupNow(); }
    catch (e) {
      log.error('backup.failed', { by: ctx.user.id, error: (e as Error).message });
      json(res, 500, { error: 'The backup could not be made: ' + (e as Error).message.slice(0, 200) });
      return true;
    }
    sizes = null;
    log.info('backup.made', { name: backup.name, bytes: backup.bytes, by: ctx.user.id });
    bus.emit('audit', addAudit(actorOf(ctx), 'Made a backup: ' + backup.name));
    json(res, 201, { backup, backups: listBackups() });
    return true;
  }
  const dl = path.match(DOWNLOAD);
  if (m === 'GET' && dl) {
    const name = dl[1] ?? '';
    /* Only a backup's own name reaches the disk: no folders, no other files of data/backups. */
    if (!BACKUP_NAME.test(name)) { json(res, 400, { error: 'That is not the name of a backup.' }); return true; }
    const file = backupPath(name);
    if (!file) { json(res, 404, { error: 'Backup not found. It may have been removed by the rotation.' }); return true; }
    /* The archive holds the encryption key and password hashes: who took a copy is on record. */
    log.info('backup.download', { name, by: ctx.user.id });
    bus.emit('audit', addAudit(actorOf(ctx), 'Downloaded a backup: ' + name));
    res.writeHead(200, {
      'content-type': 'application/zip', 'content-length': String(statSync(file).size), 'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    });
    await pipeline(createReadStream(file), res).catch(() => { res.destroy(); });
    return true;
  }
  json(res, 404, { error: 'Not found.' });
  return true;
}

/**
 * Writes the request's log line when its answer is finished (or the connection closed): method, masked path, status,
 * time taken and the signed-in person's id. Pages and assets are logged only when they fail; never a body or a header.
 */
export function requestLog(req: IncomingMessage, res: ServerResponse, path: string): void {
  const t = Date.now();
  res.once('close', () => {
    const status = res.statusCode;
    if (!path.startsWith('/api/') && status < 400) return;
    let user: number | null = null;
    try { user = sessionByToken(tokenFrom(req), false)?.user_id ?? null; } catch { /* the line goes out without it */ }
    log.request({ method: req.method || 'GET', path, status, ms: Date.now() - t, user });
  });
}

/** Called once the server listens: the start line, job lines from the bus, the stop line, and the nightly maintenance. */
export function startSystem(port: number): void {
  log.info('server.start', { version: VERSION, node: process.version, port, pid: process.pid });
  watchJobs(bus);
  /* 'exit' runs for every way out (a signal handled by main.ts, a crash handler, a failed start), and the log writes
     synchronously, so the stop line is always the last one. */
  process.once('exit', code => { log.info('server.stop', { version: VERSION, code, uptimeSec: Math.round(process.uptime()) }); });
  /* Seen, not handled: what happens after an uncaught error is main.ts's decision. */
  process.on('uncaughtExceptionMonitor', (e, origin) => { log.error('server.crash', { origin, error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? (e.stack ?? '').split('\n').slice(0, 6).join(' | ') : '' }); });
  scheduleMaintenance({
    db,
    last: () => lastMaintenance()?.at ?? 0,
    jobRunning,
    backupEnabled,
    done: r => {
      try { kv.put.run(MAINT_KEY, JSON.stringify(r)); } catch { /* the next tick runs it again */ }
      sizes = null;
      log[r.errors.length ? 'warn' : 'info']('maintenance', { backup: r.backup, removedBackups: r.removedBackups, workFolders: r.workFolders, tmpFiles: r.tmpFiles, ms: r.ms, errors: r.errors.join('; ') });
    },
  });
}

// Housekeeping once a day, at 03:00 on this computer's clock (or soon after the next start when the server was off
// then): delete the work folders of old jobs and files left half-written by a crash, let SQLite tidy its statistics,
// fold the WAL back into the database file, and make the nightly backup (which applies the backup rotation).
//
// Each step stands alone: one that fails is recorded and the others still run. Nothing here imports db.ts; the server
// hands its connection in (system-api.ts), so the file rules can be tested on a plain folder.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { backupNow, backupsDir, pruneBackups } from './backup.ts';
import { DATA_DIR } from './paths.ts';

/** A job's work folder (data/workspaces/<kind>-<id>) is deleted when nothing in it changed for this long. */
export const WORK_KEEP_MS = 7 * 24 * 3_600_000;
/** A *.tmp file or a backup staging folder this old was left by a crash: whatever wrote it is long gone. */
export const TMP_KEEP_MS = 3_600_000;
/** The hour of the day (local) the daily run is due. */
export const MAINTENANCE_HOUR = 3;

const mtime = (p: string): number => { try { return statSync(p).mtimeMs; } catch { return 0; } };

/**
 * Deletes the job folders under `workDir` that are older than `keepMs`. A folder's age is that of the newest thing
 * directly in it, so a job that ran again last week keeps its folder. Only folders are touched; `skip` names any
 * that must stay (the job running now). Returns the names removed.
 */
export function pruneWorkFolders(workDir: string, now: number = Date.now(), keepMs: number = WORK_KEEP_MS, skip: (name: string) => boolean = () => false): string[] {
  if (!existsSync(workDir)) return [];
  const gone: string[] = [];
  for (const d of readdirSync(workDir, { withFileTypes: true })) {
    if (!d.isDirectory() || skip(d.name)) continue;
    const dir = join(workDir, d.name);
    let newest = mtime(dir);
    try { for (const f of readdirSync(dir)) newest = Math.max(newest, mtime(join(dir, f))); } catch { continue; }
    if (now - newest <= keepMs) continue;
    try { rmSync(dir, { recursive: true, force: true }); gone.push(d.name); } catch { /* in use: next night */ }
  }
  return gone;
}

/**
 * Deletes *.tmp files (a ZIP or a download cut short) older than `keepMs` anywhere under `dir`, and stale backup
 * staging folders. Returns how many were removed.
 */
export function sweepTmp(dir: string, now: number = Date.now(), keepMs: number = TMP_KEEP_MS): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  let list;
  try { list = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const d of list) {
    const full = join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name.startsWith('.staging-')) { if (now - mtime(full) > keepMs) { try { rmSync(full, { recursive: true, force: true }); n++; } catch { /* next night */ } } }
      else n += sweepTmp(full, now, keepMs);
    } else if (d.isFile() && d.name.endsWith('.tmp') && now - mtime(full) > keepMs) {
      try { rmSync(full, { force: true }); n++; } catch { /* next night */ }
    }
  }
  return n;
}

/** The part of a database connection maintenance needs. */
export type MaintDb = { exec: (sql: string) => void };
export type MaintResult = {
  at: number; ms: number;
  /** The nightly backup's name, or '' when it failed (see errors). */
  backup: string;
  removedBackups: number; workFolders: number; tmpFiles: number;
  /** What went wrong, one plain sentence per failed step. Empty when everything ran. */
  errors: string[];
};

export type MaintOptions = {
  dataDir?: string; db?: MaintDb | null; now?: Date;
  /** False leaves the work folders alone this time (a job is running in one of them). */
  pruneWork?: boolean;
  /** False skips making a backup; the other maintenance steps still run. */
  backup?: boolean;
};

/** One maintenance run. Never throws. */
export async function runMaintenance(o: MaintOptions = {}): Promise<MaintResult> {
  const dataDir = o.dataDir ?? DATA_DIR, now = o.now ?? new Date(), t = now.getTime(), started = Date.now();
  const r: MaintResult = { at: t, ms: 0, backup: '', removedBackups: 0, workFolders: 0, tmpFiles: 0, errors: [] };
  const step = async (what: string, fn: () => void | Promise<void>) => {
    try { await fn(); } catch (e) { r.errors.push(`${what}: ${(e as Error).message}`.slice(0, 300)); }
  };
  if (o.pruneWork !== false) await step('Work folders', () => { r.workFolders = pruneWorkFolders(join(dataDir, 'workspaces'), t).length; });
  await step('Temporary files', () => {
    /* Not workspaces/ (a running job may be writing there) and not logs/. */
    for (const f of ['sites', 'media', 'backups']) r.tmpFiles += sweepTmp(join(dataDir, f), t);
  });
  if (o.db) {
    const db = o.db;
    await step('Database optimize', () => { db.exec('PRAGMA optimize'); });
    /* Most of a busy database lives in the WAL until this runs. TRUNCATE also gives the disk space back. */
    await step('Database checkpoint', () => { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); });
  }
  if (o.backup !== false) {
    const before = new Set(existsSync(backupsDir(dataDir)) ? readdirSync(backupsDir(dataDir)) : []);
    await step('Backup', async () => {
      r.backup = (await backupNow(dataDir, now)).name;
      r.removedBackups = [...before].filter(n => n !== r.backup && n.endsWith('.zip') && !existsSync(join(backupsDir(dataDir), n))).length;
    });
  } else {
    await step('Backup rotation', () => { r.removedBackups = pruneBackups(dataDir).length; });
  }
  r.ms = Date.now() - started;
  return r;
}

/** The most recent time the daily run was due, at or before `now` (local time). */
export function dueAt(now: Date = new Date()): number {
  const d = new Date(now); d.setHours(MAINTENANCE_HOUR, 0, 0, 0);
  if (d > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

export type ScheduleOptions = {
  db: MaintDb;
  /** The data folder, when it is not the server's own (the tests). */
  dataDir?: string;
  /** When the last run was (ms), kept between restarts. */
  last: () => number;
  /** Called with each finished run, to store it and write the log line. */
  done: (r: MaintResult) => void;
  /** True while a job runs: the work folders are then left for the next night. */
  jobRunning?: () => boolean;
  /** Read the saved setting at each run so a restart is not needed after changing it. */
  backupEnabled?: () => boolean;
  /** How long after the start the first check happens. Not at once: a start should be quick, and a run that was due
      while the server was off is no more urgent ten minutes later. */
  firstCheckMs?: number;
};

let busy = false;
/** Runs maintenance when it is due and has not run since. Resolves to the run, or null when nothing was due. */
export async function scheduledMaintenance(o: ScheduleOptions, now: Date = new Date()): Promise<MaintResult | null> {
  if (busy || o.last() >= dueAt(now)) return null;
  busy = true;
  try {
    const r = await runMaintenance({ dataDir: o.dataDir, db: o.db, now, pruneWork: !(o.jobRunning?.() ?? false), backup: o.backupEnabled?.() ?? true });
    o.done(r);
    return r;
  } finally { busy = false; }
}

export function schedule(o: ScheduleOptions): void {
  const tick = () => { void scheduledMaintenance(o).catch(() => undefined); };
  setTimeout(() => { tick(); setInterval(tick, 60_000).unref(); }, o.firstCheckMs ?? 10 * 60_000).unref();
}

// Backup and restore of everything Meridian keeps: one ZIP in DATA_DIR/backups with a consistent snapshot of the
// database (VACUUM INTO, so it is whole even while the server writes and most of the live data sits in the WAL),
// secret.key (without it the stored API keys and 2-step secrets cannot be read), media/ and sites/.
//
// The archive holds password hashes and the encryption key: the folder is 0700 and every archive 0600, and whoever
// downloads one must keep it somewhere safe.
//
// Kept: the newest backup of each of the last KEEP_DAILY days that have one, and before those the newest of each of
// KEEP_WEEKLY weeks. Everything else is deleted after each backup.
//
// Also a command, so a backup or a restore needs no running server (backup.sh):
//   node server/backup.ts                 make a backup now
//   node server/backup.ts list            list the backups
//   node server/backup.ts restore <zip>   replace the data folder with a backup (refused while the server runs)
//
// Nothing here imports db.ts: a backup opens its own connection, and a restore must not open the database it replaces.
import {
  chmodSync, closeSync, copyFileSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, readSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import { DATA_DIR } from './paths.ts';
import { VERSION } from './version.ts';
import { filesUnder, writeZip } from './zip.ts';

/** One backup a day is kept for this many days (days without a backup do not count). */
export const KEEP_DAILY = 7;
/** Before those, one backup a week is kept for this many weeks. */
export const KEEP_WEEKLY = 4;
/** The only names a backup has: meridian-YYYYMMDD-HHMMSS.zip, local time. Nothing else is listed, served or deleted. */
export const BACKUP_NAME = /^meridian-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/;
/** The folders of DATA_DIR that go into a backup, besides the database and the key. Work folders, logs and backups do not. */
const FOLDERS = ['media', 'sites'] as const;
const DB_NAME = 'meridian.db', KEY_NAME = 'secret.key', MANIFEST = 'backup.json', LOCK_NAME = 'meridian.lock';

export const backupsDir = (dataDir: string = DATA_DIR): string => join(dataDir, 'backups');
export type BackupInfo = { name: string; bytes: number; at: number };

const two = (n: number) => String(n).padStart(2, '0');
/** "20261003-030000" in local time: the part of the name that sorts by age. */
export const stamp = (d: Date): string =>
  `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
export const backupName = (d: Date): string => `meridian-${stamp(d)}.zip`;
/** When a backup was made, read from its name (local time), or null when the name is not a backup's. */
export function backupTime(name: string): Date | null {
  const m = BACKUP_NAME.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const at = new Date(y, mo - 1, d, h, mi, s);
  /* 20261345 is not a date: the Date would roll over to another month. */
  return at.getFullYear() === y && at.getMonth() === mo - 1 && at.getDate() === d && at.getHours() === h ? at : null;
}

/** The backups on disk, newest first. */
export function listBackups(dataDir: string = DATA_DIR): BackupInfo[] {
  const dir = backupsDir(dataDir);
  if (!existsSync(dir)) return [];
  const out: BackupInfo[] = [];
  for (const name of readdirSync(dir)) {
    const at = backupTime(name);
    if (!at) continue;
    try { const st = statSync(join(dir, name)); if (st.isFile()) out.push({ name, bytes: st.size, at: at.getTime() }); } catch { /* deleted meanwhile */ }
  }
  return out.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1));
}

/** The full path of a backup, or null unless the name is exactly a backup's name and the file exists. */
export function backupPath(name: string, dataDir: string = DATA_DIR): string | null {
  if (!backupTime(name)) return null;
  const full = join(backupsDir(dataDir), name);
  try { return statSync(full).isFile() ? full : null; } catch { return null; }
}

const dayKey = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
/** The Monday of the date's week. */
const weekKey = (d: Date) => { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7); return dayKey(m); };

/**
 * Which of these backup names stay: the newest of each of the `daily` most recent days, then, among the older ones,
 * the newest of each of the `weekly` most recent weeks (Monday to Sunday). Names that are not backups are ignored.
 */
export function keepers(names: readonly string[], daily = KEEP_DAILY, weekly = KEEP_WEEKLY): Set<string> {
  const all = names.map(name => ({ name, at: backupTime(name) })).filter((b): b is { name: string; at: Date } => b.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const keep = new Set<string>(), days: string[] = [], weeks: string[] = [];
  for (const b of all) {
    const d = dayKey(b.at);
    if (!days.includes(d)) { days.push(d); if (days.length <= daily) keep.add(b.name); }
    if (days.indexOf(d) < daily) continue;
    const w = weekKey(b.at);
    if (!weeks.includes(w)) { weeks.push(w); if (weeks.length <= weekly) keep.add(b.name); }
  }
  return keep;
}

/** Deletes the backups the rotation no longer keeps. Returns their names. */
export function pruneBackups(dataDir: string = DATA_DIR, daily = KEEP_DAILY, weekly = KEEP_WEEKLY): string[] {
  const names = listBackups(dataDir).map(b => b.name), keep = keepers(names, daily, weekly);
  const gone = names.filter(n => !keep.has(n));
  for (const n of gone) rmSync(join(backupsDir(dataDir), n), { force: true });
  return gone;
}

/** Puts `from` into the staging folder without using more disk: a hard link, or a copy where links are not possible. */
function stage(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  try { linkSync(from, to); } catch { copyFileSync(from, to); }
}

let running: Promise<BackupInfo> | null = null;
/**
 * Makes a backup now and applies the rotation. Two calls at once share one backup. Safe while the server runs: the
 * database is copied by SQLite itself in one read transaction.
 */
export function backupNow(dataDir: string = DATA_DIR, now: Date = new Date()): Promise<BackupInfo> {
  running ??= makeBackup(dataDir, now).finally(() => { running = null; });
  return running;
}

async function makeBackup(dataDir: string, now: Date): Promise<BackupInfo> {
  const dbFile = join(dataDir, DB_NAME);
  if (!existsSync(dbFile)) throw new Error(`There is no Meridian database in ${dataDir} yet. Start Meridian once first.`);
  const dir = backupsDir(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  /* Everything is gathered in a folder inside backups/ (0700), then zipped: the snapshot, the key, and links to the files. */
  const staging = join(dir, `.staging-${process.pid}-${now.getTime()}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { mode: 0o700 });
  try {
    const src = new DatabaseSync(dbFile, { timeout: 5000 });
    try { src.exec(`VACUUM INTO '${join(staging, DB_NAME).replace(/'/g, "''")}'`); } finally { src.close(); }
    const hasKey = existsSync(join(dataDir, KEY_NAME));
    if (hasKey) copyFileSync(join(dataDir, KEY_NAME), join(staging, KEY_NAME));
    let files = 0;
    for (const folder of FOLDERS) {
      const from = join(dataDir, folder);
      if (!existsSync(from)) continue;
      for (const f of await filesUnder(from)) {
        /* Half-written files of a job in progress are not part of anything. */
        if (f.name.endsWith('.tmp')) continue;
        try { stage(f.path, join(staging, folder, f.name)); files++; } catch { /* deleted since it was listed */ }
      }
    }
    writeFileSync(join(staging, MANIFEST), JSON.stringify({ app: 'meridian', version: VERSION, createdAt: now.toISOString(), key: hasKey, files }, null, 2) + '\n');
    const name = backupName(now), out = join(dir, name);
    await writeZip(staging, out);
    chmodSync(out, 0o600);
    pruneBackups(dataDir);
    return { name, bytes: statSync(out).size, at: backupTime(name)!.getTime() };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/* ---------- Reading a backup ---------- */

export type ZipItem = { name: string; method: number; size: number; packed: number; offset: number; crc: number };
const NOT_A_BACKUP = 'This file is not a Meridian backup.';

function readAt(fd: number, length: number, position: number): Buffer {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, position + got);
    if (!n) throw new Error(NOT_A_BACKUP);
    got += n;
  }
  return buf;
}

/** The files in a ZIP written by zip.ts (no ZIP64, no encryption), from its central directory. */
export function zipEntries(file: string): ZipItem[] {
  const fd = openSync(file, 'r');
  try {
    const size = statSync(file).size;
    if (size < 22) throw new Error(NOT_A_BACKUP);
    /* The end record is the last 22 bytes unless the archive has a comment, which zip.ts never writes. */
    const tailLen = Math.min(size, 22 + 0xffff), tail = readAt(fd, tailLen, size - tailLen);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { at = i; break; }
    if (at < 0) throw new Error(NOT_A_BACKUP);
    const count = tail.readUInt16LE(at + 10), cdSize = tail.readUInt32LE(at + 12), cdOffset = tail.readUInt32LE(at + 16);
    if (cdOffset + cdSize > size) throw new Error(NOT_A_BACKUP);
    const cd = readAt(fd, cdSize, cdOffset);
    const out: ZipItem[] = [];
    for (let p = 0, i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new Error(NOT_A_BACKUP);
      const nameLen = cd.readUInt16LE(p + 28), extra = cd.readUInt16LE(p + 30), comment = cd.readUInt16LE(p + 32);
      out.push({
        name: cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'), method: cd.readUInt16LE(p + 10), crc: cd.readUInt32LE(p + 16),
        packed: cd.readUInt32LE(p + 20), size: cd.readUInt32LE(p + 24), offset: cd.readUInt32LE(p + 42),
      });
      p += 46 + nameLen + extra + comment;
    }
    return out;
  } finally { closeSync(fd); }
}

/** One file's contents, checked against its CRC. */
export function zipRead(file: string, item: ZipItem): Buffer {
  const fd = openSync(file, 'r');
  try {
    const head = readAt(fd, 30, item.offset);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(NOT_A_BACKUP);
    const start = item.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const body = item.packed ? readAt(fd, item.packed, start) : Buffer.alloc(0);
    const data = item.method === 8 ? inflateRawSync(body) : body;
    if (item.method !== 0 && item.method !== 8 || data.length !== item.size || (crc32(data) >>> 0) !== item.crc) throw new Error('The backup file is damaged: ' + item.name);
    return data;
  } finally { closeSync(fd); }
}

/* ---------- Restore ---------- */

/**
 * The process holding the data folder (data/meridian.lock, written by the server while it runs), or 0. A lock left
 * by a process that no longer exists does not count.
 */
export function lockHolder(dataDir: string = DATA_DIR): number {
  let text: string;
  try { text = readFileSync(join(dataDir, LOCK_NAME), 'utf8').trim(); } catch { return 0; }
  let pid = 0;
  try { const v = JSON.parse(text) as unknown; pid = Number(typeof v === 'object' && v ? (v as { pid?: unknown }).pid : v); } catch { pid = Number(/^\d+/.exec(text)?.[0] ?? 0); }
  if (!Number.isInteger(pid) || pid <= 0) return 0;
  try { process.kill(pid, 0); return pid; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' ? pid : 0; }
}

/** A name a backup may contain: the database, the key, the manifest, or a plain relative path under media/ or sites/. */
function safeEntry(name: string): boolean {
  if (name === DB_NAME || name === KEY_NAME || name === MANIFEST) return true;
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/')) return false;
  const parts = name.split('/');
  return parts.length >= 2 && (FOLDERS as readonly string[]).includes(parts[0]!) && parts.every(p => p !== '' && p !== '.' && p !== '..');
}

export type Restored = { dataDir: string; kept: string | null; files: number; users: number };

/**
 * Replaces the data folder with the contents of a backup. Refused while a server holds the folder. The archive is
 * unpacked and its database checked next to the data folder first; only then is the current folder renamed to
 * "<data>.before-restore-<time>" (nothing is deleted) and the unpacked one put in its place. The backups made so far
 * move along into the restored folder.
 */
export function restoreBackup(zipFile: string, dataDir: string = DATA_DIR, now: Date = new Date()): Restored {
  const pid = lockHolder(dataDir);
  if (pid) throw new Error(`Meridian is running (process ${pid}). Stop it first, then restore.`);
  if (!existsSync(zipFile) || !statSync(zipFile).isFile()) throw new Error('Backup file not found: ' + zipFile);
  const items = zipEntries(zipFile);
  if (!items.some(i => i.name === DB_NAME)) throw new Error(NOT_A_BACKUP);
  const bad = items.find(i => !safeEntry(i.name));
  if (bad) throw new Error('The backup holds a file it should not, so nothing was restored: ' + bad.name.slice(0, 80));

  const target = resolve(dataDir), staging = `${target}.restore-${stamp(now)}.tmp`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  try {
    for (const i of items) {
      const to = join(staging, i.name);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, zipRead(zipFile, i), { mode: i.name === DB_NAME || i.name === KEY_NAME ? 0o600 : 0o644 });
    }
    const users = checkDatabase(join(staging, DB_NAME));
    let kept: string | null = null;
    if (existsSync(target)) {
      kept = `${target}.before-restore-${stamp(now)}`;
      if (existsSync(kept)) throw new Error('A folder from an earlier restore is in the way: ' + kept);
      renameSync(target, kept);
    }
    try { renameSync(staging, target); }
    catch (e) { if (kept) renameSync(kept, target); throw e; }
    /* The archives are not part of what was restored: they stay with the folder in use. */
    if (kept && existsSync(backupsDir(kept))) renameSync(backupsDir(kept), backupsDir(target));
    return { dataDir: target, kept, files: items.length, users };
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

/** Opens the unpacked database, checks it is whole and is Meridian's. Returns how many accounts it has. */
function checkDatabase(file: string): number {
  let db: DatabaseSync;
  try { db = new DatabaseSync(file); } catch { throw new Error('The database in the backup cannot be opened.'); }
  try {
    const ok = (db.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined);
    if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('The database in the backup is damaged.');
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(t => t.name);
    if (!tables.includes('users') || !tables.includes('workspace_docs')) throw new Error(NOT_A_BACKUP);
    return Number((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n);
  } catch (e) {
    if (e instanceof Error && /backup/.test(e.message)) throw e;
    throw new Error('The database in the backup is damaged.');
  } finally {
    db.close();
    for (const ext of ['-wal', '-shm']) rmSync(file + ext, { force: true });
  }
}

/* ---------- Command line ---------- */

const size = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' kB';

async function cli(args: string[]): Promise<void> {
  const [cmd = 'now', arg] = args;
  if (cmd === 'now') {
    const b = await backupNow();
    console.log(`Backup written: ${join(backupsDir(), b.name)} (${size(b.bytes)})`);
    console.log('It holds password hashes and the encryption key. Keep copies somewhere only you can reach.');
  } else if (cmd === 'list') {
    const list = listBackups();
    if (!list.length) console.log('No backups yet in ' + backupsDir());
    for (const b of list) console.log(`${b.name}  ${size(b.bytes).padStart(9)}  ${new Date(b.at).toLocaleString('en-GB')}`);
  } else if (cmd === 'restore') {
    if (!arg) throw new Error('Usage: ./backup.sh restore <backup.zip>');
    /* A bare name means a backup in data/backups. */
    const file = existsSync(arg) ? arg : backupPath(arg) ?? arg;
    const r = restoreBackup(file);
    console.log(`Restored ${r.files} files into ${r.dataDir} (${r.users} account${r.users === 1 ? '' : 's'}).`);
    if (r.kept) console.log(`The data from before the restore is kept in ${r.kept}. Delete it when you no longer need it.`);
    console.log('Start Meridian again with ./start.sh.');
  } else {
    throw new Error('Usage: ./backup.sh [now | list | restore <backup.zip>]');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch(e => { console.error((e as Error).message); process.exit(1); });
}

// The server's log file: one JSON object per line in DATA_DIR/logs/meridian.log, so "what happened last night" has
// an answer. At 5 MB the file becomes meridian.log.1 (older ones move up; five are kept).
//
// What is written: start and stop with the version, one line per API request (method, path, status, time taken,
// user id) and each job's start and end (kind, id, site, duration, tokens, cost, outcome). What never is: request or
// response bodies, cookies, headers, prompts or article text. Long tokens in a path (an invitation link) are masked,
// and a field whose name says it holds a secret is dropped.
//
// Nothing here imports the database, so the log works before it opens and after it failed.
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import type { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';

export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
/** The log file is rotated when the next line would take it past this size. */
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
/** Rotated files kept besides the current one: meridian.log.1 (newest) to meridian.log.5. */
export const LOG_KEEP = 5;
export const LOG_NAME = 'meridian.log';
export const logsDir = (dataDir: string = DATA_DIR): string => join(dataDir, 'logs');

export type Fields = Record<string, unknown>;

/** A path or message with anything that looks like a token masked (30 or more URL-safe characters, as main.ts does). */
export const mask = (s: string): string => s.replace(/[A-Za-z0-9_-]{30,}/g, '[token]');

/* "tokens" (a job's token count) is a number worth keeping; a field called "token" is not. */
const SECRET_NAME = /pass|secret|cookie|authorization|api[-_]?key|^(token|key|body|prompt|content)$/i;
const MAX_TEXT = 500;
/** The fields as they are written: secrets dropped by name, text masked and cut, nothing nested deeper than one level. */
function clean(fields: Fields, depth = 0): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || SECRET_NAME.test(k)) continue;
    if (typeof v === 'string') out[k] = mask(v).slice(0, MAX_TEXT);
    else if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : null;
    else if (typeof v === 'boolean' || v === null) out[k] = v;
    else if (v instanceof Error) out[k] = mask(v.message).slice(0, MAX_TEXT);
    else if (typeof v === 'object' && !Array.isArray(v) && depth === 0) out[k] = clean(v as Fields, 1);
    else out[k] = mask(String(v)).slice(0, MAX_TEXT);
  }
  return out;
}

export interface Logger {
  debug: (event: string, fields?: Fields) => void;
  info: (event: string, fields?: Fields) => void;
  warn: (event: string, fields?: Fields) => void;
  error: (event: string, fields?: Fields) => void;
  /** One request: the path is masked, 5xx is an error line. */
  request: (r: { method: string; path: string; status: number; ms: number; user: number | null }) => void;
  /** Where the current file is. */
  file: string;
}

const levelOf = (v: unknown): Level => v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : 'info';

/** A logger writing to `dir`. Writing is synchronous (a line is a few hundred bytes), so the last line before an exit is on disk. */
export function createLogger(dir: string, opts: { maxBytes?: number; keep?: number; level?: Level } = {}): Logger {
  const max = opts.maxBytes ?? LOG_MAX_BYTES, keep = opts.keep ?? LOG_KEEP, min = ORDER[opts.level ?? 'info'];
  const file = join(dir, LOG_NAME);
  /* The size of the current file, or -1 before the first line (and after a failed write, so the folder is checked again). */
  let size = -1;

  function rotate(): void {
    rmSync(`${file}.${keep}`, { force: true });
    for (let i = keep - 1; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    if (keep >= 1) renameSync(file, `${file}.1`); else rmSync(file, { force: true });
    size = 0;
  }

  function write(level: Level, event: string, fields: Fields = {}): void {
    if (ORDER[level] < min) return;
    try {
      if (size < 0) {
        /* The log names who did what and when: this user only, like the database. */
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        size = existsSync(file) ? statSync(file).size : 0;
      }
      const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...clean(fields) }) + '\n';
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > max) rotate();
      const fresh = size === 0;
      appendFileSync(file, line, { mode: 0o600 });
      if (fresh) chmodSync(file, 0o600);
      size += bytes;
    } catch {
      /* A full disk or a folder that went away must never stop the server: the line is lost, the next one tries again. */
      size = -1;
    }
  }

  return {
    file,
    debug: (e, f) => write('debug', e, f),
    info: (e, f) => write('info', e, f),
    warn: (e, f) => write('warn', e, f),
    error: (e, f) => write('error', e, f),
    request: r => write(r.status >= 500 ? 'error' : 'info', 'request', { method: r.method, path: mask(r.path).slice(0, 200), status: r.status, ms: r.ms, user: r.user }),
  };
}

/** The server's log (DATA_DIR/logs). MERIDIAN_LOG_LEVEL sets the lowest level written: debug, info (default), warn or error. */
export const log: Logger = createLogger(logsDir(), { level: levelOf(process.env.MERIDIAN_LOG_LEVEL) });

/* ---------- Job lifecycle, from the events the dashboards get ---------- */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => v !== null && typeof v === 'object' ? v as Obj : null;
const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const str = (v: unknown): string => typeof v === 'string' ? v : '';

/**
 * Writes a line when a job starts and when it ends, read from the events every job already announces on the bus
 * ('request', 'article' with its photo job, 'build' with its deploy). A job is "running" while its status is 'work';
 * the line at the end has how long it took, the tokens and cost recorded for it, and whether it failed.
 */
export function watchJobs(bus: EventEmitter, to: Logger = log): void {
  const working = new Set<string>();
  const track = (kind: string, id: number, site: string, status: string, v: { startedAt: unknown; finishedAt: unknown; tokens: unknown; costUsd: unknown; error: unknown }) => {
    const key = `${kind}:${id}`;
    if (status === 'work') {
      if (!working.has(key)) { working.add(key); to.info('job.start', { kind, id, site }); }
      return;
    }
    if (!working.delete(key)) return;
    const failed = status === 'failed';
    const ms = num(v.startedAt) && num(v.finishedAt) ? Math.max(0, num(v.finishedAt) - num(v.startedAt)) : null;
    to[failed ? 'warn' : 'info']('job.end', {
      kind, id, site, outcome: failed ? 'failed' : status === 'queued' || status === 'revision' ? 'requeued' : 'done', status, ms,
      tokens: num(v.tokens), costUsd: num(v.costUsd), ...(failed && str(v.error) ? { error: str(v.error).slice(0, 200) } : {}),
    });
  };
  bus.on('request', (e: unknown) => {
    const v = obj(e); if (!v) return;
    track('research', num(v.id), str(v.siteId), str(v.status), { startedAt: v.startedAt, finishedAt: v.finishedAt, tokens: v.tokens, costUsd: v.costUsd, error: v.error });
  });
  bus.on('article', (e: unknown) => {
    const v = obj(e); if (!v) return;
    track('article', num(v.id), str(v.siteId), str(v.status), { startedAt: v.startedAt, finishedAt: v.finishedAt, tokens: v.tokens, costUsd: v.costUsd, error: v.error });
    const p = obj(v.photos);
    if (p) track('photos', num(v.id), str(v.siteId), str(p.status), { startedAt: p.startedAt, finishedAt: p.finishedAt, tokens: p.tokens, costUsd: p.costUsd, error: p.error });
  });
  bus.on('build', (e: unknown) => {
    const v = obj(e); if (!v) return;
    track('build', num(v.id), str(v.siteId), str(v.status), { startedAt: v.startedAt, finishedAt: v.finishedAt, tokens: v.tokens, costUsd: v.costUsd, error: v.error });
    /* A deploy has no start time of its own in the event; its line has no duration. */
    track('deploy', num(v.id), str(v.siteId), str(v.deploy), { startedAt: 0, finishedAt: 0, tokens: 0, costUsd: 0, error: v.deployError });
  });
}

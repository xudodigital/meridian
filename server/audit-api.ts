// Reading the audit log: GET /api/audit in pages with filters, and GET /api/audit.csv, the same selection as a file.
// The log itself is written in workspace.ts (addAudit); nothing here changes an entry.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, mayWrite, seesAudit, type Ctx } from './access.ts';
import { db } from './db.ts';
import { bus } from './events.ts';
import { API_HEADERS, json } from './http.ts';
import { addAudit, siteList, viewAudit, type AuditRow, type AuditView } from './workspace.ts';

/** Entries per page: what a request gets without `limit` (as before there were pages), and the most it may ask for. */
export const AUDIT_PAGE = 200, AUDIT_PAGE_MAX = 500;
/** The most entries one CSV file holds. */
export const CSV_MAX = 50_000;

/** What narrows the log. Times are milliseconds; `before` is the id of the oldest entry already shown. */
export type AuditFilter = { before?: number; actor?: string; site?: string; q?: string; from?: number; to?: number };

const num = (v: string | null): number | undefined => { const n = Number(v); return v !== null && v !== '' && Number.isSafeInteger(n) && n >= 0 ? n : undefined; };
const str = (v: string | null, max: number): string | undefined => { const s = (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); return s || undefined; };

/** The filter in a request's query string. Anything malformed is left out rather than refused. */
export function filterOf(p: URLSearchParams): AuditFilter {
  return { before: num(p.get('before')), actor: str(p.get('actor'), 200), site: str(p.get('site'), 64), q: str(p.get('q'), 200), from: num(p.get('from')), to: num(p.get('to')) };
}

/** `text` as a LIKE pattern that matches it anywhere, with LIKE's own wildcards taken literally. */
const contains = (text: string): string => '%' + text.replace(/[\\%_]/g, '\\$&') + '%';

/* The conditions are fixed pieces of SQL; every value from the request is bound, never spliced in. */
function where(f: AuditFilter): { sql: string; args: (string | number)[] } {
  const parts: string[] = [], args: (string | number)[] = [];
  if (f.before !== undefined) { parts.push('id < ?'); args.push(f.before); }
  if (f.actor) { parts.push(`actor LIKE ? ESCAPE '\\'`); args.push(contains(f.actor)); }
  if (f.site) { parts.push('site = ?'); args.push(f.site); }
  if (f.q) { parts.push(`act LIKE ? ESCAPE '\\'`); args.push(contains(f.q)); }
  if (f.from !== undefined) { parts.push('at >= ?'); args.push(f.from); }
  if (f.to !== undefined) { parts.push('at <= ?'); args.push(f.to); }
  return { sql: parts.length ? ' WHERE ' + parts.join(' AND ') : '', args };
}

/** The newest `limit` entries the filter selects, newest first, and whether older ones exist. */
export function auditPage(f: AuditFilter, limit: number): { audit: AuditView[]; more: boolean } {
  const w = where(f);
  const rows = db.prepare(`SELECT * FROM audit_log${w.sql} ORDER BY id DESC LIMIT ?`).all(...w.args, limit + 1) as AuditRow[];
  return { audit: rows.slice(0, limit).map(r => viewAudit(r)), more: rows.length > limit };
}

/**
 * One CSV cell. A spreadsheet runs a cell that starts with = + - or @ as a formula (a tab or a line break before one
 * of those is skipped by some), and the log holds text people typed: article titles, topics, the email tried at
 * sign-in. Such a cell gets a single quote in front, which a spreadsheet shows as plain text. Every cell is quoted.
 */
export function csvCell(v: string): string {
  const s = /^[=+\-@\t\r\n]/.test(v) ? "'" + v : v;
  return '"' + s.replace(/"/g, '""') + '"';
}
const csvLine = (cells: string[]): string => cells.map(csvCell).join(',') + '\r\n';

/** The selected entries as CSV text, newest first: time (UTC), actor, action, site, and who wrote the entry. */
export function auditCsv(f: AuditFilter): { text: string; rows: number } {
  const w = where({ ...f, before: undefined });
  const domains = new Map(siteList().map(s => [s.id, s.domain]));
  const rows = db.prepare(`SELECT * FROM audit_log${w.sql} ORDER BY id DESC LIMIT ?`).all(...w.args, CSV_MAX) as AuditRow[];
  let text = csvLine(['Time (UTC)', 'Actor', 'Action', 'Site', 'Recorded by']);
  for (const r of rows) {
    text += csvLine([new Date(r.at).toISOString(), r.actor, r.act, r.site ? domains.get(r.site) ?? r.site : '', r.client ? 'Dashboard note' : 'Server']);
  }
  return { text, rows: rows.length };
}

const queryOf = (req: IncomingMessage): URLSearchParams => new URL(req.url || '/', 'http://localhost').searchParams;
const stampOf = (d: Date): string => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** Handles GET /api/audit and GET /api/audit.csv. Returns false for anything else (writing an entry is in workspace-api.ts). */
export function auditReadApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): boolean {
  if (req.method !== 'GET' || (path !== '/api/audit' && path !== '/api/audit.csv')) return false;
  const u = ctx.user, p = queryOf(req), f = filterOf(p);
  if (!seesAudit(u)) { json(res, 403, { error: 'Your role reviews articles only.' }); return true; }

  if (path === '/api/audit') {
    const limit = Math.min(Math.max(num(p.get('limit')) ?? AUDIT_PAGE, 1), AUDIT_PAGE_MAX);
    json(res, 200, auditPage(f, limit));
    return true;
  }

  /* A file leaves the dashboard and stays wherever it is saved: for the roles that work with the log, not for viewers. */
  const no = mayWrite(u);
  if (no) { json(res, no.status, { error: no.error }); return true; }
  const { text, rows } = auditCsv(f);
  bus.emit('audit', addAudit(actorOf(ctx), `Exported the audit log as a CSV file (${rows} ${rows === 1 ? 'entry' : 'entries'})`));
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store',
    'content-disposition': `attachment; filename="meridian-audit-${stampOf(new Date())}.csv"`, ...API_HEADERS,
  });
  /* The mark at the start tells a spreadsheet the file is UTF-8, so names and titles in any script read right. */
  res.end('﻿' + text);
  return true;
}

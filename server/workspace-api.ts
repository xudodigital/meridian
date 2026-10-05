// The workspace routes: load everything, save one document (with its version), append to the audit log, remember
// read notifications, and the admin's "Reset workspace". The actor of every entry is the signed-in person.
// Reading the audit log (pages, filters, the CSV file) is in audit-api.ts. The bell's alerts (a blocked domain, the
// budget, the report) are read here from the table notify.ts fills.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, mayAdmin, mayWrite, mayWriteDoc, seesAudit, type Ctx } from './access.ts';
import { auditReadApi } from './audit-api.ts';
import { db } from './db.ts';
import { bus } from './events.ts';
import { body, json, text } from './http.ts';
import {
  DOC_MAX_BYTES, addAudit, addReadKeys, docError, docsFor, isDocId, notifyPrefsDoc, putDoc, readKeys, recentAudit, resetWorkspace, type Json,
} from './workspace.ts';

const DOC = /^\/api\/workspace\/docs\/([A-Za-z]+)$/;
const AUDIT_BATCH = 50;

/* ---------- Alerts for the bell ---------- */

/** The alerts the dashboard cannot work out from what it already shows: a domain blocked or down, the daily budget,
    the weekly report sent. Finished and failed jobs reach the bell from the jobs themselves (the app's liveNotifs.ts). */
const BELL_EVENTS = ['blocked', 'budget', 'report'] as const;
/** The bell shows the last two weeks as new (liveNotifs.ts); a little more is sent so the list does not end abruptly. */
const BELL_DAYS = 30, BELL_MAX = 40;
type BellRow = { id: number; key: string; event: string; site: string | null; title: string; body: string; link: string; created_at: number };
const bellRows = db.prepare(`SELECT id, key, event, site, title, body, link, created_at FROM alerts
  WHERE event IN (${BELL_EVENTS.map(() => '?').join(', ')}) AND created_at >= ? ORDER BY id DESC LIMIT ?`);
/** The alerts for the bell, newest first, leaving out the events whose "In-app" box in Settings > Alerts is off. */
export function bellAlerts(now = Date.now()) {
  const np = notifyPrefsDoc();
  return (bellRows.all(...BELL_EVENTS, now - BELL_DAYS * 86_400_000, BELL_MAX) as BellRow[])
    .filter(a => np?.[a.event]?.[0] !== false)
    .map(a => ({ id: a.id, key: a.key, event: a.event, site: a.site, title: a.title, body: a.body, link: a.link, at: a.created_at }));
}

/** Handles /api/workspace, /api/workspace/docs/:id, /api/workspace/reset, /api/audit and /api/notifications/read. */
export async function workspaceApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const m = req.method || 'GET', u = ctx.user;

  if (m === 'GET' && path === '/api/workspace') {
    json(res, 200, { docs: docsFor(u), audit: seesAudit(u) ? recentAudit() : [], notifRead: readKeys(u.id) });
    return true;
  }

  const d = path.match(DOC);
  if (d) {
    const id = d[1]!;
    if (!isDocId(id)) { json(res, 404, { error: 'Not found.' }); return true; }
    if (m !== 'PUT') { json(res, 405, { error: 'Not allowed.' }); return true; }
    const no = mayWriteDoc(u, id);
    if (no) { json(res, no.status, { error: no.error }); return true; }
    const b = await body(req, DOC_MAX_BYTES + 1000);
    const version = Number(b.version);
    if (!Number.isSafeInteger(version) || version < 0) { json(res, 400, { error: 'Missing version.' }); return true; }
    const data = (b.data ?? null) as Json;
    const err = docError(id, data);
    if (err) { json(res, 400, { error: err }); return true; }
    const r = putDoc(id, version, data, u.id);
    if (!r.ok) { json(res, 409, { error: 'Someone else changed this at the same time.', version: r.current.version, data: r.current.data }); return true; }
    bus.emit('workspace', { doc: id, version: r.version, data });
    json(res, 200, { version: r.version });
    return true;
  }

  if (m === 'POST' && path === '/api/workspace/reset') {
    const no = mayAdmin(u);
    if (no) { json(res, no.status, { error: no.error }); return true; }
    const b = await body(req);
    if (b.confirm !== 'RESET') { json(res, 400, { error: 'Type RESET to confirm.' }); return true; }
    resetWorkspace();
    bus.emit('reset');
    /* The audit log is the one thing a reset keeps: it gains this entry. */
    bus.emit('audit', addAudit(actorOf(ctx), 'Reset the workspace: sites, schedules, settings, agent changes and added skills'));
    json(res, 200, { ok: true });
    return true;
  }

  if (auditReadApi(req, res, path, ctx)) return true;

  if (path === '/api/audit') {
    if (m !== 'POST') { json(res, 405, { error: 'Not allowed.' }); return true; }
    const no = mayWrite(u);
    if (no) { json(res, no.status, { error: no.error }); return true; }
    const b = await body(req, 60_000);
    const list = Array.isArray(b.entries) ? b.entries.slice(0, AUDIT_BATCH) : [];
    const entries = list.flatMap(e => {
      if (!e || typeof e !== 'object') return [];
      const o = e as Record<string, unknown>;
      const act = text(o.act, 300), site = text(o.site, 64) || null, cid = text(o.cid, 40);
      if (!act) return [];
      /* What the app says the person did on their screen. Stored and shown as a note, apart from the server's own entries. */
      const view = { ...addAudit(actorOf(ctx), act, site, true), ...(cid ? { cid } : {}) };
      bus.emit('audit', view);
      return [view];
    });
    json(res, 201, { entries });
    return true;
  }

  if (m === 'GET' && path === '/api/notifications') {
    /* A native reviewer works on one site's articles; alerts about domains, spend and reports are not theirs. */
    if (u.role === 'reviewer') { json(res, 403, { error: 'Your role reviews articles only.' }); return true; }
    json(res, 200, { alerts: bellAlerts() });
    return true;
  }

  if (m === 'POST' && path === '/api/notifications/read') {
    const b = await body(req);
    const keys = (Array.isArray(b.keys) ? b.keys : []).filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 200).slice(0, 300);
    if (keys.length) { addReadKeys(u.id, keys); bus.emit('reads', { userId: u.id, keys }); }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

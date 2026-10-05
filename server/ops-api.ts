// The routes for connected services and what runs on them: integrations (store, test, remove, Google sign-in),
// access checks, DNS verification of a domain, the weekly report, Search Console figures and delivered alerts.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, mayAdmin, mayWrite, seesSite, type Ctx } from './access.ts';
import { testService } from './connectors.ts';
import { bus } from './events.ts';
import { finish, redirectUri, startUrl, type GoogleKind } from './google.ts';
import { body, json } from './http.ts';
import { defOf, listViews, removeValues, rowOf, saveValues, setResult, valuesOf, viewById } from './integrations.ts';
import { forgetMetrics, gscMetricsCached, refreshMetrics } from './metrics.ts';
import { recentAlerts } from './notify.ts';
import { checkSite, checkingNow, latestChecks } from './probe.ts';
import { buildReport, sendReport } from './report.ts';
import { verifySite, verifyViews } from './verify.ts';
import { addAudit, siteInfo } from './workspace.ts';
import type { UserRow } from './users.ts';

const INT = /^\/api\/integrations\/([a-z0-9]+)(\/test)?$/;
const SITE = /^\/api\/sites\/([A-Za-z0-9_-]{1,64})\/(check|verify)$/;
const audit = (ctx: Ctx | null, act: string, site: string | null = null) =>
  bus.emit('audit', addAudit(ctx ? actorOf(ctx) : { name: 'Deploy & Monitor', id: null }, act, site));
const changed = () => bus.emit('integrations-changed', {});
const deny = (res: ServerResponse, no: { status: number; error: string } | null): boolean => { if (no) json(res, no.status, { error: no.error }); return !!no; };

/** What the dashboard gets about services and checks, filtered for the person (part of GET /api/state). */
export function opsState(u: UserRow) {
  const metrics = gscMetricsCached();
  return {
    integrations: listViews(u.role === 'admin'),
    access: latestChecks().filter(c => seesSite(u, c.siteId)),
    checking: checkingNow().filter(id => seesSite(u, id)),
    verify: u.role === 'reviewer' ? [] : verifyViews(),
    metrics: metrics ? { at: metrics.at, sites: Object.fromEntries(Object.entries(metrics.sites).filter(([id]) => seesSite(u, id))) } : null,
  };
}

/** Runs a service's test and records the result. */
async function runTest(id: string, ctx: Ctx) {
  const values = valuesOf(id);
  const def = defOf(id)!;
  const r = await testService(id, values ?? {}, { by: ctx.user.name, email: ctx.user.email });
  if (rowOf(id)) setResult(id, r.status, r.msg, r.tail ?? '');
  else if (def.worksWithout && r.status !== 'ok') { /* Nothing stored: the result is only returned. */ }
  changed();
  return r;
}

/** The open route: Google sends the browser back here. It is matched by its state, not by the session cookie. */
export async function oauthOpenApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (req.method !== 'GET' || path !== '/api/oauth/google/callback') return false;
  const q = new URL(req.url || '/', 'http://localhost').searchParams;
  const r = await finish(q);
  if ('error' in r) {
    if (r.kind && rowOf(r.kind)) { setResult(r.kind, 'bad', r.error); changed(); }
    bus.emit('google-result', { ok: false, kind: r.kind ?? null, msg: r.error });
  } else {
    const def = defOf(r.kind)!;
    const t = await testService(r.kind, valuesOf(r.kind) ?? {}, { by: r.by, email: '' });
    setResult(r.kind, t.status, t.msg, t.tail ?? '');
    bus.emit('audit', addAudit({ name: r.by, id: null }, `Connected ${def.name}${r.account ? ' as ' + r.account : ''}`));
    changed();
    bus.emit('google-result', { ok: t.status !== 'bad', kind: r.kind, msg: t.msg });
    if (r.kind === 'gsc') void refreshMetrics();
  }
  res.writeHead(302, { location: '/integrations', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end();
  return true;
}

export async function opsApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const m = req.method || 'GET', u = ctx.user;

  /* ---------- Integrations ---------- */
  if (m === 'GET' && path === '/api/integrations') {
    json(res, 200, { integrations: listViews(u.role === 'admin'), redirectUri: redirectUri() });
    return true;
  }
  const im = path.match(INT);
  if (im) {
    const id = im[1]!, def = defOf(id);
    if (!def) { json(res, 404, { error: 'Not found.' }); return true; }
    if (deny(res, mayAdmin(u))) return true;
    if (m === 'POST' && im[2]) {
      if (!rowOf(id) && !def.worksWithout) { json(res, 409, { error: 'Nothing is stored for ' + def.name + ' yet.' }); return true; }
      const r = await runTest(id, ctx);
      audit(ctx, `Tested the ${def.name} connection: ${r.msg}`);
      json(res, 200, { result: r, integration: viewById(id, true) });
      return true;
    }
    if (m === 'PUT' && !im[2]) {
      const b = await body(req);
      const values = b.values && typeof b.values === 'object' ? b.values as Record<string, unknown> : {};
      const had = !!rowOf(id);
      const err = saveValues(id, values, u.name);
      if (err) { json(res, 400, { error: err }); return true; }
      const what = def.fields.length > 1 ? 'settings' : def.fields[0]?.k === 'webhook' ? 'webhook' : 'key';
      audit(ctx, `${had ? 'Replaced' : 'Saved'} the ${def.name} ${what}`);
      const r = await runTest(id, ctx);
      json(res, 200, { result: r, integration: viewById(id, true) });
      return true;
    }
    if (m === 'DELETE' && !im[2]) {
      if (!removeValues(id)) { json(res, 404, { error: 'Nothing is stored for ' + def.name + '.' }); return true; }
      if (id === 'gsc') forgetMetrics();
      audit(ctx, `Removed ${def.name}`);
      changed();
      json(res, 200, { integration: viewById(id, true) });
      return true;
    }
    json(res, 405, { error: 'Not allowed.' });
    return true;
  }
  if (m === 'POST' && path === '/api/oauth/google/start') {
    if (deny(res, mayAdmin(u))) return true;
    const b = await body(req);
    const kind = b.kind === 'gsc' || b.kind === 'ga4' ? b.kind as GoogleKind : null;
    if (!kind) { json(res, 400, { error: 'Choose Search Console or Analytics.' }); return true; }
    const r = startUrl(kind, u.name);
    if ('error' in r) { json(res, 409, { error: r.error }); return true; }
    json(res, 200, r);
    return true;
  }

  /* ---------- Sites: access checks and DNS verification ---------- */
  if (m === 'GET' && path === '/api/access') {
    const s = opsState(u);
    json(res, 200, { access: s.access, checking: s.checking, verify: s.verify });
    return true;
  }
  const sm = path.match(SITE);
  if (sm && m === 'POST') {
    const siteId = sm[1]!, what = sm[2]!;
    if (deny(res, mayWrite(u))) return true;
    const s = siteInfo(siteId);
    if (!s) { json(res, 404, { error: 'That site is not saved yet. Wait a moment and try again.' }); return true; }
    if (what === 'verify') {
      const r = await verifySite(siteId, u.name);
      if (!r.ok) { json(res, 409, { error: r.error }); return true; }
      audit(ctx, `Verified ownership of ${s.domain} by DNS`, siteId);
      bus.emit('verify', r.view);
      json(res, 200, { verify: r.view });
      return true;
    }
    /* The check takes up to a minute: it runs on, and the result arrives on the event stream. */
    const started = checkSite(siteId, u.name);
    const first = await Promise.race([started, new Promise<null>(r => setTimeout(() => r(null), 50))]);
    if (first && 'error' in first) { json(res, 409, { error: first.error }); return true; }
    audit(ctx, `Started an access check of ${s.domain} from ${s.country || s.cc}`, siteId);
    void started.then(v => { if ('result' in v) audit(null, `Access check of ${s.domain}: ${v.summary}`, siteId); });
    json(res, 202, { started: true });
    return true;
  }

  /* ---------- Report, figures, alerts ---------- */
  if (m === 'GET' && path === '/api/report') {
    if (u.role === 'reviewer') { json(res, 403, { error: 'Your role reviews articles only.' }); return true; }
    json(res, 200, { report: buildReport() });
    return true;
  }
  if (m === 'POST' && path === '/api/reports/send') {
    if (deny(res, mayWrite(u))) return true;
    try {
      const r = await sendReport(u.name);
      audit(ctx, `Sent the weekly report to ${r.to.join(', ')}`);
      json(res, 200, r);
    } catch (e) { json(res, 409, { error: (e as Error).message }); }
    return true;
  }
  if (m === 'POST' && path === '/api/metrics/refresh') {
    if (deny(res, mayWrite(u))) return true;
    if (!rowOf('gsc')) { json(res, 409, { error: 'Connect Search Console first.' }); return true; }
    const r = await refreshMetrics();
    json(res, r ? 200 : 409, r ? { metrics: r } : { error: viewById('gsc', false)?.msg || 'Search Console did not answer. Try again.' });
    return true;
  }
  if (m === 'GET' && path === '/api/alerts') {
    if (deny(res, mayAdmin(u))) return true;
    json(res, 200, { alerts: recentAlerts() });
    return true;
  }
  return false;
}

// The routes for what Meridian reads about each site's search and visitors: Search Console per page and query, rank
// tracking, Google Analytics 4 (and which property belongs to which site), and search volume for a research result.
// None of it is a native reviewer's business (they review articles of one site), so they get 403 on all of it.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, mayWrite, seesSite, type Ctx } from './access.ts';
import { q, type RequestRow } from './db.ts';
import { bus } from './events.ts';
import { chooseProperty, ga4Overview, refreshGa4, siteGa4 } from './ga4.ts';
import { body, json } from './http.ts';
import { rowOf } from './integrations.ts';
import { budgetStop } from './ledger.ts';
import { costlyActions, slowDownMessage } from './limits.ts';
import { siteSearch } from './metrics.ts';
import { rankEffects, siteRank } from './rank.ts';
import { refreshVolumes, trackKeyword } from './requests.ts';
import { addAudit, siteInfo, siteList } from './workspace.ts';

const NOT_FOR_REVIEWERS = 'Your role reviews articles only.';
const SITE = /^\/api\/metrics\/site\/([A-Za-z0-9_-]{1,64})$/;
const VOLUMES = /^\/api\/requests\/(\d{1,9})\/volumes$/;
const TRACK = /^\/api\/keywords\/(\d{1,9})\/track$/;

export async function insightsApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const m = req.method || 'GET', u = ctx.user;
  const mine = SITE.test(path) || VOLUMES.test(path) || TRACK.test(path) || path === '/api/rank' || path === '/api/ga4' || path === '/api/ga4/map' || path === '/api/ga4/refresh';
  if (!mine) return false;
  if (u.role === 'reviewer') { json(res, 403, { error: NOT_FOR_REVIEWERS }); return true; }
  const audit = (act: string, site: string | null = null) => bus.emit('audit', addAudit(actorOf(ctx), act, site));
  const denied = (): boolean => { const no = mayWrite(u); if (no) json(res, no.status, { error: no.error }); return !!no; };
  /** Calls to other services have an allowance per person (limits.ts). */
  const slowed = (): boolean => { const wait = costlyActions.take('u' + u.id); if (wait) json(res, 429, { error: slowDownMessage(wait) }); return !!wait; };
  const sites = () => siteList().filter(s => seesSite(u, s.id));

  /* ---------- Search Console and Analytics of one site ---------- */
  const sm = path.match(SITE);
  if (sm && m === 'GET') {
    const site = siteInfo(sm[1]!);
    if (!site || !seesSite(u, site.id)) { json(res, 404, { error: 'That site is not saved.' }); return true; }
    json(res, 200, { siteId: site.id, domain: site.domain, gsc: siteSearch(site.id), ga4: siteGa4(site) });
    return true;
  }

  /* ---------- Rank tracking ---------- */
  if (path === '/api/rank' && m === 'GET') {
    json(res, 200, {
      connected: !!rowOf('gsc'),
      sites: Object.fromEntries(sites().map(s => [s.id, siteRank(s.id)])),
      effects: rankEffects(id => seesSite(u, id)),
    });
    return true;
  }
  const tm = path.match(TRACK);
  if (tm && m === 'POST') {
    if (denied()) return true;
    const b = await body(req);
    const done = trackKeyword(Number(tm[1]), b.on !== false);
    if (!done) { json(res, 404, { error: 'That keyword is not part of a finished research.' }); return true; }
    audit(`${b.on !== false ? 'Started' : 'Stopped'} tracking the keyword: ${done.keyword}`, done.siteId);
    json(res, 200, { request: done.request });
    return true;
  }

  /* ---------- Google Analytics 4 ---------- */
  if (path === '/api/ga4' && m === 'GET') { json(res, 200, { ga4: ga4Overview(sites()) }); return true; }
  if (path === '/api/ga4/map' && m === 'POST') {
    if (denied()) return true;
    if (!rowOf('ga4')) { json(res, 409, { error: 'Connect Google Analytics 4 in Integrations first.' }); return true; }
    const b = await body(req);
    const site = siteInfo(typeof b.siteId === 'string' ? b.siteId : '');
    if (!site) { json(res, 404, { error: 'That site is not saved.' }); return true; }
    const property = typeof b.property === 'string' ? b.property.trim() : '';
    if (property && !/^properties\/\d{1,20}$/.test(property)) { json(res, 400, { error: 'Choose a property from the list.' }); return true; }
    const err = chooseProperty(site.id, property);
    if (err) { json(res, 409, { error: err }); return true; }
    audit(property ? `Chose the Analytics property for ${site.domain}` : `Went back to matching the Analytics property of ${site.domain} by domain`, site.id);
    /* The figures of the new property are read in the background; 'insights' says when they are in. */
    void refreshGa4().catch(() => undefined);
    json(res, 200, { ga4: ga4Overview(sites()) });
    return true;
  }
  if (path === '/api/ga4/refresh' && m === 'POST') {
    if (denied() || slowed()) return true;
    if (!rowOf('ga4')) { json(res, 409, { error: 'Connect Google Analytics 4 in Integrations first.' }); return true; }
    const st = await refreshGa4();
    if (st?.error) { json(res, 409, { error: st.error }); return true; }
    json(res, 200, { ga4: ga4Overview(sites()) });
    return true;
  }

  /* ---------- Search volume of a research result ---------- */
  const vm = path.match(VOLUMES);
  if (vm && m === 'POST') {
    if (denied() || slowed()) return true;
    const r = q.getRequest.get(Number(vm[1])) as RequestRow | undefined;
    if (!r) { json(res, 404, { error: 'Not found.' }); return true; }
    const stop = budgetStop(r.site_id);
    if (stop) { json(res, 409, { error: stop }); return true; }
    const done = await refreshVolumes(r.id);
    if (!done.ok) { json(res, done.status, { error: done.error }); return true; }
    audit(`Refreshed search volume for the research: ${r.topic}`, r.site_id);
    json(res, 200, { request: done.request, found: done.found, sent: done.sent });
    return true;
  }
  json(res, 405, { error: 'Not allowed.' });
  return true;
}

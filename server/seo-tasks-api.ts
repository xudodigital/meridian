import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, mayWrite, type Ctx } from './access.ts';
import { body, json, note, text, API_HEADERS } from './http.ts';
import { db } from './db.ts';
import { budgetStop } from './ledger.ts';
import { engineReady, ENGINE_MISSING } from './engine.ts';
import { queueFull, kick } from './jobs.ts';
import { defaultModel, supportedModel } from './openai-models.ts';
import { createTask, taskContext, infographicSvg, listTasks, taskKind, taskRow, taskView } from './seo-tasks.ts';
import { SEO_TASKS } from '../shared/seo-tasks.ts';
import { siteInfo, addAudit, getDoc } from './workspace.ts';
import { bus } from './events.ts';
import { defaultSerpProvider, serpReady } from './serp.ts';
import { isSerpProvider, SERP_PROVIDERS } from '../shared/serp.ts';
import { siteSearch } from './metrics.ts';
import { siteGa4 } from './ga4.ts';
import { costlyActions, slowDownMessage } from './limits.ts';

export async function seoTasksApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  if (path !== '/api/seo-tasks' && !/^\/api\/seo-tasks\/\d{1,9}(?:\/(review|svg))?$/.test(path)) return false;
  if (ctx.user.role === 'reviewer') { json(res, 403, { error: 'Your role reviews articles only.' }); return true; }
  if (req.method === 'GET' && path === '/api/seo-tasks') { json(res, 200, { tasks: listTasks() }); return true; }
  const single = path.match(/^\/api\/seo-tasks\/(\d{1,9})$/);
  if (single && req.method === 'GET') { const row = taskRow(Number(single[1])); json(res, row ? 200 : 404, row ? { task: taskView(row, true) } : { error: 'Task not found.' }); return true; }
  const match = path.match(/^\/api\/seo-tasks\/(\d+)\/(review|svg)$/);
  if (match) {
    const row = taskRow(Number(match[1]));
    if (!row) { json(res, 404, { error: 'Task not found.' }); return true; }
    const task = taskView(row);
    if (req.method === 'GET' && match[2] === 'svg') {
      if (!task.result?.visual) { json(res, 409, { error: 'This task has no infographic.' }); return true; }
      res.writeHead(200, { ...API_HEADERS, 'content-type': 'image/svg+xml; charset=utf-8', 'content-disposition': `attachment; filename="meridian-infographic-${task.id}.svg"`, 'cache-control': 'no-store' }); res.end(infographicSvg(task.result.visual)); return true;
    }
    if (req.method === 'POST' && match[2] === 'review') {
      const no = mayWrite(ctx.user); if (no) { json(res, no.status, { error: no.error }); return true; }
      if (task.status !== 'done') { json(res, 409, { error: 'Wait for a completed result before reviewing it.' }); return true; }
      const site = siteInfo(task.siteId);
      if (!site || site.domain !== task.domain) { json(res, 409, { error: 'The site changed. Create a new task before accepting its result.' }); return true; }
      db.prepare('UPDATE seo_tasks SET reviewed_at = ?, reviewed_by = ? WHERE id = ? AND reviewed_at IS NULL').run(Date.now(), ctx.user.name, task.id);
      const updated = taskView(taskRow(task.id)!); bus.emit('seo-task', updated);
      bus.emit('audit', addAudit(actorOf(ctx), 'Reviewed ' + SEO_TASKS[task.kind].title + ' draft (no content applied)', task.siteId));
      json(res, 200, { task: updated }); return true;
    }
  }
  if (req.method === 'POST' && path === '/api/seo-tasks') {
    const no = mayWrite(ctx.user); if (no) { json(res, no.status, { error: no.error }); return true; }
    const b = await body(req), site = siteInfo(text(b.siteId, 64));
    if (!site) { json(res, 404, { error: 'Choose a saved site first.' }); return true; }
    if (!taskKind(b.kind)) { json(res, 400, { error: 'Choose a supported task.' }); return true; }
    const kind = b.kind, brief = note(b.brief, kind === 'serp' ? 150 : 3000);
    if (!brief) { json(res, 400, { error: 'Describe the audience, goal or question. SERP research needs one search query.' }); return true; }
    if (SEO_TASKS[kind].needsArticles && !taskContext(site).articles.length) { json(res, 409, { error: 'Write an article first; it must be in review or approved.' }); return true; }
    if (kind === 'serp' && b.serpProvider !== undefined && b.serpProvider !== 'auto' && !isSerpProvider(b.serpProvider)) { json(res, 400, { error: 'Choose a supported SERP provider.' }); return true; }
    const serpProvider = kind === 'serp' ? (isSerpProvider(b.serpProvider) ? b.serpProvider : defaultSerpProvider()) : null;
    if (kind === 'serp' && (!serpProvider || !serpReady(serpProvider))) { json(res, 409, { error: serpProvider ? `Connect ${SERP_PROVIDERS[serpProvider]} before SERP research.` : 'Connect SerpApi or DataForSEO before SERP research.' }); return true; }
    if (kind === 'analysis' && siteSearch(site.id).state !== 'ok' && siteGa4(site).state !== 'ok') { json(res, 409, { error: 'Connect Search Console or GA4 and refresh its data first.' }); return true; }
    if (db.prepare("SELECT id FROM seo_tasks WHERE site_id = ? AND kind = ? AND status IN ('queued', 'work')").get(site.id, kind)) { json(res, 409, { error: 'This task is already waiting or running for the site.' }); return true; }
    const stop = budgetStop(site.id), full = queueFull(site.id);
    if (stop || full) { json(res, stop ? 409 : 429, { error: stop || full }); return true; }
    const saved = getDoc('agents').data;
    const configured = Array.isArray(saved) ? saved.find(a => a && typeof a === 'object' && !Array.isArray(a) && a.id === SEO_TASKS[kind].agent) : null;
    const model = text(b.model, 60) || (configured && typeof configured === 'object' && !Array.isArray(configured) && supportedModel(configured.model) ? configured.model : defaultModel(SEO_TASKS[kind].agent));
    if (!supportedModel(model)) { json(res, 400, { error: 'Choose a supported OpenAI model.' }); return true; }
    if (!(await engineReady())) { json(res, 503, { error: ENGINE_MISSING }); return true; }
    const wait = costlyActions.take('u' + ctx.user.id); if (wait) { json(res, 429, { error: slowDownMessage(wait) }); return true; }
    const task = createTask(site, kind, brief, model, kind === 'audit' && b.liveAudit === true, serpProvider ?? undefined);
    bus.emit('audit', addAudit(actorOf(ctx), 'Requested ' + SEO_TASKS[kind].title, site.id)); kick(); json(res, 201, { task }); return true;
  }
  json(res, 405, { error: 'Method not allowed.' }); return true;
}

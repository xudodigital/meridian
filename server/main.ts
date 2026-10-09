// Meridian local server. Node 24+, no npm dependencies.
// Serves the dashboard and a small API on 127.0.0.1 only.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { actorOf, authenticate, mayWrite, mustEnroll, seesSite } from './access.ts';
import { seoTasksApi } from './seo-tasks-api.ts';
import { listTasks } from './seo-tasks.ts';
import { articleApi } from './article-api.ts';
import { NO_SITE, listArticles, type ArticleView } from './articles.ts';
import { authApi, sessionsAdminApi } from './auth-api.ts';
import { resetAdminApi } from './reset.ts';
import { db, q, type RequestRow } from './db.ts';
import { upgradeOpenAI } from './openai-config.ts';
import { defaultModel, supportedModel } from './openai-models.ts';
import { ENGINE_MISSING, engineReady, engineStatus, keywordPrompt } from './engine.ts';
import { bus } from './events.ts';
import { HttpError, body, json, localHost, text, trustedWrite } from './http.ts';
import { kick, queueFull, recover, requeueRunning, shutdown } from './jobs.ts';
import { budgetStop, spendSnapshot, watchBudget } from './ledger.ts';
import { costlyActions, slowDownMessage } from './limits.ts';
import { DATA_DIR, ROOT } from './paths.ts';
import { retryRequest, viewRequest, type RequestView } from './requests.ts';
import { sweepSessions } from './sessions.ts';
import { closeAll as closeStreams, openStream } from './stream.ts';
import { inviteOpenApi, teamApi } from './team-api.ts';
import { addAudit, siteInfo } from './workspace.ts';
import { workspaceApi } from './workspace-api.ts';
import { oauthOpenApi, opsApi, opsState } from './ops-api.ts';
import { photoApi } from './photos-api.ts';
import { buildApi, buildsState } from './build-api.ts';
import { linksApi } from './links-api.ts';
import { workflowApi, workflowsState } from './workflow-api.ts';
import { startWorkflows } from './workflows.ts';
import { domainApi, domainsState, scheduleDomains } from './domains.ts';
import { sealTotpSecrets } from './users.ts';
import { schedule as scheduleChecks } from './probe.ts';
import { schedule as scheduleReport } from './report.ts';
import { schedule as scheduleMetrics } from './metrics.ts';
import { insightsApi } from './insights-api.ts';
import { flush as flushAlerts, watch as watchAlerts } from './notify.ts';
import { articlePrompt } from './writer.ts';
import { requestLog, startSystem, systemApi } from './system-api.ts';

const PORT = Number(process.env.PORT) || 4310;
const HOST = '127.0.0.1';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};
/** The built React app (app/, `npm run build`). */
const APP_DIR = join(ROOT, 'app', 'dist');
const isFile = (p: string) => stat(p).then(s => s.isFile(), () => false);

/** The prompt templates the agent sheet shows: the real prompts, with placeholders where a job puts its values. */
function promptTemplates() {
  const kw = keywordPrompt({ domain: '{domain}', country: '{country}', lang: '{language}', site_topic: '{site topic}', topic: '{topic}', goal: '{goal}' });
  const wr = articlePrompt({ domain: '{domain}', country: '{country}', lang: '{language}', site_topic: '{site topic}', keyword: '{keyword}', revision: 0, pending_note: '' }, null);
  return { kw, wr };
}

/** Sending the weekly report, refreshing Search Console figures, access checks and DNS verification. */
const COSTLY = /^\/api\/(reports\/send|metrics\/refresh|sites\/[^/]{1,64}\/(check|verify))$/;
/** Routes of other modules that put a job in the shared queue: photos for an article, a website build, a deploy. */
const QUEUES_A_JOB = /^\/api\/(articles\/\d{1,9}\/photos|sites\/[^/]{1,64}\/builds|builds\/\d{1,9}\/(approve|deploy))$/;

/**
 * The API. Open without a session: health, first-run status, sign-in, the invitation link. Everything else needs a
 * signed-in person, and every write needs our header from this host (trustedWrite) besides the SameSite cookie.
 */
async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (!localHost(req)) return json(res, 403, { error: 'Not allowed.' });
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD' && !trustedWrite(req)) return json(res, 403, { error: 'Not allowed.' });
  if (method === 'GET' && path === '/api/health') return json(res, 200, { ok: true });
  if (await authApi(req, res, path)) return;
  if (await inviteOpenApi(req, res, path)) return;
  if (await oauthOpenApi(req, res, path)) return;

  const ctx = authenticate(req);
  if (!ctx) return json(res, 401, { error: 'Sign in first.' });
  if (mustEnroll(ctx.user)) return json(res, 403, { error: 'Set up 2-step verification first.', code: 'enroll' });
  const u = ctx.user;

  if (method === 'GET' && path === '/api/state') {
    const requests = (q.listRequests.all() as RequestRow[]).filter(r => seesSite(u, r.site_id)).map(viewRequest);
    const articles = listArticles().filter((a: ArticleView) => seesSite(u, a.siteId));
    /* Spend and tokens per site and agent (ledger.ts). A native reviewer's screen shows none of it. */
    const spend = u.role === 'reviewer' ? null : spendSnapshot();
    return json(res, 200, { engine: await engineStatus(), requests, articles, seoTasks: u.role === 'reviewer' ? [] : listTasks(), ...opsState(u), builds: buildsState(u), workflows: workflowsState(u), domains: domainsState(u), spend });
  }
  if (method === 'GET' && path === '/api/events') return openStream(req, res, ctx);
  if (method === 'GET' && path === '/api/agents/prompts') return json(res, 200, { prompts: promptTemplates() });
  /* Actions that send mail or call other services have an allowance per person; anything that queues an agent job
     is refused while the queue is full (the routes that know the site also keep to the limit per site). */
  if (method === 'POST' && COSTLY.test(path)) {
    const wait = costlyActions.take('u' + u.id);
    if (wait) return json(res, 429, { error: slowDownMessage(wait) });
  }
  if (method === 'POST' && QUEUES_A_JOB.test(path) && mayWrite(u) === null) {
    const full = queueFull();
    if (full) return json(res, 429, { error: full });
  }
  if (await workspaceApi(req, res, path, ctx)) return;
  if (await sessionsAdminApi(req, res, path, ctx)) return;
  if (await resetAdminApi(req, res, path, ctx)) return;
  if (await teamApi(req, res, path, ctx)) return;
  if (await seoTasksApi(req, res, path, ctx)) return;
  if (await articleApi(req, res, path, ctx)) return;
  if (await opsApi(req, res, path, ctx)) return;
  if (await photoApi(req, res, path, ctx)) return;
  if (await buildApi(req, res, path, ctx)) return;
  if (await linksApi(req, res, path, ctx)) return;
  if (await workflowApi(req, res, path, ctx)) return;
  if (await domainApi(req, res, path, ctx)) return;
  if (await insightsApi(req, res, path, ctx)) return;
  if (await systemApi(req, res, path, ctx)) return;

  if (method === 'POST' && path === '/api/engine/refresh') {
    const no = mayWrite(u); if (no) return json(res, no.status, { error: no.error });
    const engine = await engineStatus(true); bus.emit('engine', engine);
    return json(res, 200, { engine });
  }
  if (method === 'POST' && path === '/api/requests') {
    const no = mayWrite(u); if (no) return json(res, no.status, { error: no.error });
    const b = await body(req);
    const topic = text(b.topic, 80), siteId = text(b.siteId, 64);
    if (!topic) return json(res, 400, { error: 'Enter a topic or a few seed keywords.' });
    if (!siteId) return json(res, 400, { error: 'Choose a site.' });
    /* The body names the site. What the agent is told about it (domain, country, language, topic) is the saved
       site, never what the request says: those values go into the agent's prompt. */
    const site = siteInfo(siteId);
    if (!site) return json(res, 404, { error: NO_SITE });
    if (q.duplicate.get(siteId, topic)) return json(res, 409, { error: 'This request is already in the queue for that site.' });
    /* The site's daily budget is a hard stop (ledger.ts). */
    const stop = budgetStop(siteId);
    if (stop) return json(res, 409, { error: stop });
    if (!(await engineReady())) return json(res, 503, { error: (await engineStatus()).reason || ENGINE_MISSING });
    const full = queueFull(siteId);
    if (full) return json(res, 429, { error: full });
    const model = text(b.model, 60) || defaultModel('kw');
    if (!supportedModel(model)) return json(res, 400, { error: 'Select a supported OpenAI model.' });
    const info = q.insertRequest.run(site.id, site.domain, site.country, site.lang, site.topic, topic, text(b.goal, 80), model, u.name, Date.now());
    const row = q.getRequest.get(Number(info.lastInsertRowid)) as RequestRow;
    const view: RequestView = viewRequest(row);
    bus.emit('request', view);
    bus.emit('audit', addAudit(actorOf(ctx), 'Requested keyword research: ' + topic, siteId));
    kick();
    return json(res, 201, { request: view });
  }
  const m = path.match(/^\/api\/requests\/(\d+)\/retry$/);
  if (method === 'POST' && m) {
    const no = mayWrite(u); if (no) return json(res, no.status, { error: no.error });
    if (!(await engineReady())) return json(res, 503, { error: (await engineStatus()).reason || ENGINE_MISSING });
    const full = queueFull();
    if (full) return json(res, 429, { error: full });
    const again = q.getRequest.get(Number(m[1])) as RequestRow | undefined, stop = again ? budgetStop(again.site_id) : null;
    if (stop) return json(res, 409, { error: stop });
    const r = retryRequest(Number(m[1]), u.name);
    if (!r) return json(res, 409, { error: 'This request cannot be retried right now.' });
    bus.emit('audit', addAudit(actorOf(ctx), 'Asked for keyword research again: ' + r.topic, r.site_id));
    kick();
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'Not found.' });
}

/**
 * Serves app/dist. Any path that is not an existing file gets index.html, so client-side routes such as /sites work
 * on reload. Files under /assets have a content hash in their name and may be cached for good; index.html never is.
 * A missing file under /assets is a 404, not the page, so a stale tab fails clearly after a new build.
 */
/**
 * What the dashboard may load: its own script, styles and pictures, and the two Google Fonts stylesheets with their
 * font files (app/index.html). Article text is written by a model from web pages; React escapes it, and this is the
 * second barrier: no inline or foreign script can run, and nothing can frame the page or post a form elsewhere.
 * 'unsafe-inline' is for style attributes only (charts and progress bars set widths and colours that way).
 */
const APP_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:", "connect-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
].join('; ');

async function appFile(res: ServerResponse, path: string): Promise<void> {
  const index = join(APP_DIR, 'index.html');
  const rel = normalize(path === '/' ? '/index.html' : path);
  let full = join(APP_DIR, rel);
  const inside = full.startsWith(APP_DIR + sep);
  if (!inside || !(await isFile(full))) {
    if (inside && rel.startsWith(sep + 'assets' + sep)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    full = index;
  }
  const data = await readFile(full);
  const hashed = full !== index && rel.startsWith(sep + 'assets' + sep);
  res.writeHead(200, {
    'content-type': MIME[extname(full)] || 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-store',
    'x-content-type-options': 'nosniff',
    /* An invitation link carries its token in the path: never send it on as a referrer. No framing by other pages. */
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': APP_CSP,
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  });
  res.end(data);
}

async function file(res: ServerResponse, path: string): Promise<void> {
  /* Checked on every request, so a first build is picked up without restarting the server. Client routes such as
     /invite/<token> get index.html like every other path. */
  if (await isFile(join(APP_DIR, 'index.html'))) return appFile(res, path);
  res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('The Meridian app has not been built yet. Run ./start.sh, which builds it first.');
}

const server = createServer((req, res) => {
  let path: string;
  try { path = decodeURIComponent((req.url || '/').split('?')[0] ?? '/'); }
  catch { res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request'); return; }
  requestLog(req, res, path);
  const done = path.startsWith('/api/') ? api(req, res, path) : file(res, path);
  done.catch(e => {
    if (res.headersSent) res.end();
    else if (e instanceof HttpError) json(res, e.status, { error: e.message });
    else {
      /* The path may hold an invitation token: it is masked, and no body is ever logged. */
      console.error('Request failed:', req.method, path.replace(/[A-Za-z0-9_-]{30,}/g, '[token]'), (e as Error).message);
      json(res, 500, { error: 'Something went wrong on the server. Try again.' });
    }
  });
});

/* ---------- Before anything starts: the right Node, and one server per data folder ---------- */

/** Stops the start with a message a person can act on, instead of a stack trace. */
function refuseToStart(msg: string): never {
  console.error(msg);
  process.exit(1);
}
if (Number(process.versions.node.split('.')[0]) < 24) refuseToStart(`Meridian needs Node.js 24 or newer; this is ${process.version}. Start it with ./start.sh, which uses the bundled Node when there is one.`);

/**
 * data/meridian.lock holds the process id of the server that uses this data folder. Two servers on one folder would
 * both run the job queue (every job twice) and fight over the database, so a second one refuses to start. A lock
 * left by a process that no longer exists (a crash, a power cut) is taken over.
 */
const LOCK = join(DATA_DIR, 'meridian.lock');
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
function takeLock(): void {
  let holder = 0;
  try { holder = Number(/^\d+/.exec(readFileSync(LOCK, 'utf8').trim())?.[0] ?? 0); } catch { /* no lock yet */ }
  if (holder > 0 && holder !== process.pid && alive(holder))
    refuseToStart(`Meridian is already running on this data folder (process ${holder}): ${DATA_DIR}\nOpen that one, or stop it first. Two servers must never share one data folder.`);
  try { writeFileSync(LOCK, process.pid + '\n', { mode: 0o600 }); }
  catch (e) { refuseToStart(`Meridian cannot write to its data folder: ${DATA_DIR}\n${(e as Error).message}`); }
}
let lockHeld = false;
function releaseLock(): void {
  if (!lockHeld) return;
  lockHeld = false;
  try { if (Number(readFileSync(LOCK, 'utf8').trim()) === process.pid) rmSync(LOCK, { force: true }); } catch { /* gone already */ }
}
takeLock();
lockHeld = true;
upgradeOpenAI();
process.on('exit', releaseLock);

/* ---------- Stopping ---------- */

/** How long an orderly stop waits for the running agent to end before it exits anyway. */
const STOP_WAIT_MS = 10_000;
let stopping = false;
/**
 * An orderly stop (Ctrl+C, a service manager, a closed terminal): no new requests, the open dashboards are told to
 * reconnect, the running agent is ended and its job put back in the queue with a step that says why, and the
 * database is checkpointed and closed, so the files in data/ are complete for a copy or a backup.
 */
function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  const finish = () => {
    try { requeueRunning(); } catch (e) { console.error('The running job could not be put back in the queue now; it is at the next start.', (e as Error).message); }
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* the next start reads the log that is left */ }
    process.exit(code);
  };
  try { closeStreams(); server.close(); server.closeIdleConnections(); } catch { /* not listening yet */ }
  const giveUp = setTimeout(finish, STOP_WAIT_MS);
  void shutdown().then(() => { clearTimeout(giveUp); finish(); }, finish);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => stop(0));

/* An error nobody caught leaves the process in an unknown state: it is written down and the server exits with an
   error code, so whatever started it (the service, a person) starts a clean one. Jobs mid-run are picked up at the
   next start (jobs.ts recover). */
process.on('uncaughtException', e => { console.error('Meridian stopped on an error:', e instanceof Error ? e.stack || e.message : e); process.exit(1); });
/* A promise nobody awaited that failed is the same thing: raised as an uncaught error, so it takes the path above. */
process.on('unhandledRejection', e => { throw e instanceof Error ? e : new Error(String(e)); });

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') refuseToStart(`Port ${PORT} is already in use, most likely by another Meridian. Open http://localhost:${PORT}, or start this one on another port: PORT=4311 ./start.sh`);
  if (e.code === 'EACCES') refuseToStart(`Meridian may not listen on port ${PORT}. Choose a port above 1024: PORT=4311 ./start.sh`);
  refuseToStart(`Meridian could not start listening on port ${PORT}: ${e.message}`);
});


/* 2-step secrets from before they were encrypted are encrypted now. */
const sealed = sealTotpSecrets();
if (sealed) console.log(`Encrypted ${sealed} stored 2-step verification secret${sealed === 1 ? '' : 's'}.`);

server.listen(PORT, HOST, async () => {
  startSystem(PORT);
  sweepSessions();
  watchAlerts();
  /* Jobs held by a used-up daily budget start again at midnight or when the budget is raised. */
  watchBudget(kick);
  scheduleChecks();
  scheduleReport();
  scheduleMetrics();
  /* Domains still waiting for DNS or a certificate (also from before a restart) are checked in the background. */
  scheduleDomains();
  void flushAlerts();
  setInterval(sweepSessions, 10 * 60_000).unref();
  const e = await engineStatus(true);
  console.log(`Engine: ${e.ready ? `${e.mode === 'gemma-local' ? 'Gemma localhost' : e.mode === 'codex-local' ? 'Codex Local' : 'OpenAI'} ${e.apiVersion}` : `not available. ${e.reason} Check the selected engine in Integrations.`}`);
  console.log(`Meridian is running at http://localhost:${PORT}`);
  recover();
  /* Workflow runs follow their jobs from here on, and the schedules are looked at every minute (workflows.ts). */
  startWorkflows();
});

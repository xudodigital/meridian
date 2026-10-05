// The workflow engine: a fixed sequence of the jobs Meridian already has, run for one site, and the schedules that
// start it. There is no model call here and no orchestrating agent that decides anything: a run is a row in
// workflow_runs and a small state machine in code that looks at the rows of the jobs it queued.
//
// "Weekly content" for a site:
//   research   keyword research (the site's topic, or the schedule's)
//              then the top N keywords that have no article yet are picked (by search volume when the keywords carry
//              one, else in the Keyword agent's order) and their articles are queued
//   write      the Content Writer writes them
//   review     a person approves or rejects each one (either ends that article's part)
//   build      once every article is decided and at least one was approved: a website build
//   approve    a person approves the build (or Settings say deploys need no approval)
//   deploy     Cloudflare Pages, when it is connected (builds.ts queues it on approval)
//   done
// Every job goes through the functions a person's click uses (requests.ts, articles.ts, builds.ts), so the queue, the
// spend ledger, the daily budget and the human approvals are exactly the same. A step that fails fails the run with the
// reason. A site at its daily budget holds the run ("Waiting for budget") until midnight or a raised budget. A
// cancelled run withdraws the jobs it queued that have not started; a job that is running finishes.
//
// Schedules are the `schedules` workspace document: { id, wf: "Weekly content", site, on, every, weekday, hour, n,
// topic }. The scheduler looks every minute (workflow-time.ts has the rules) and remembers, per schedule, the last slot
// it dealt with in the kv table before it starts anything, so a restart never starts a run twice.
import { defaultModel } from './openai-models.ts';
import { articleRow, createArticle, withdrawArticle } from './articles.ts';
import { buildRow, cloudflareReady, identityOf, requestBuild, withdrawBuild } from './builds.ts';
import { db, q, type KeywordRow, type RequestRow } from './db.ts';
import { engineReady } from './engine.ts';
import { bus } from './events.ts';
import { kick, queueFull } from './jobs.ts';
import { budgetHeld, budgetStop } from './ledger.ts';
import { createRequest, withdrawRequest } from './requests.ts';
import { addAudit, getDoc, siteInfo, type Json, type SiteInfo } from './workspace.ts';
import { cadenceOf, dueNow, nextDue, slotText, zoneOf, type Cadence, type DueState } from './workflow-time.ts';

export const WEEKLY = 'Weekly content';
/** How many articles a run queues: 1 to 5, 2 unless the schedule says otherwise. */
export const N_MIN = 1, N_MAX = 5, N_DEFAULT = 2;
export const clampN = (v: unknown): number => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= N_MIN ? Math.min(N_MAX, n) : N_DEFAULT; };
/** The name the jobs and audit entries of a run carry. It is not a model: the engine is code. */
const ORCHESTRATOR = { name: 'Orchestrator', id: null };
const GOAL = 'Find keywords for new articles (weekly content)';
const CANCELLED = 'Cancelled with its workflow before it started.';
const LOG_MAX = 60;

export type Step = 'research' | 'write' | 'review' | 'build' | 'approve' | 'deploy' | 'done';
export type Status = 'running' | 'done' | 'failed' | 'cancelled';
/** What a running workflow waits for: an agent's job, a person's decision, the site's daily budget, or room in the queue. */
export type Wait = { kind: 'agent' | 'person' | 'budget' | 'queue'; text: string; detail?: string };
type RunRow = {
  id: number; kind: string; site_id: string; domain: string; schedule_id: string; by: string; topic: string; n: number;
  status: Status; step: Step; step_at: number; wait: string; request_id: number | null; own_request: number; articles: string; picked: number;
  build_id: number | null; outcome: string; error: string; log: string; created_at: number; updated_at: number; finished_at: number | null;
};

const qw = {
  insert: db.prepare(`INSERT INTO workflow_runs (kind, site_id, domain, schedule_id, by, topic, n, step_at, created_at, updated_at)
    VALUES ('weekly-content', ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  get: db.prepare('SELECT * FROM workflow_runs WHERE id = ?'),
  list: db.prepare('SELECT * FROM workflow_runs ORDER BY id DESC LIMIT 60'),
  running: db.prepare(`SELECT id FROM workflow_runs WHERE status = 'running' ORDER BY id`),
  runningForSite: db.prepare(`SELECT id FROM workflow_runs WHERE status = 'running' AND site_id = ? ORDER BY id`),
  save: db.prepare(`UPDATE workflow_runs SET status = ?, step = ?, step_at = ?, wait = ?, request_id = ?, own_request = ?, articles = ?, picked = ?,
    build_id = ?, outcome = ?, error = ?, log = ?, updated_at = ?, finished_at = ? WHERE id = ?`),
  articleKeywords: db.prepare('SELECT lower(keyword) AS k FROM articles WHERE site_id = ?'),
  openBuild: db.prepare(`SELECT id FROM site_builds WHERE site_id = ? AND status IN ('queued', 'work') LIMIT 1`),
  kvGet: db.prepare('SELECT value FROM kv WHERE key = ?'),
  kvPut: db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)'),
};

const parse = <T>(json: string, fallback: T): T => { try { return json ? JSON.parse(json) as T : fallback; } catch { return fallback; } };
const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;
const row = (id: number): RunRow | undefined => qw.get.get(id) as RunRow | undefined;
const idsOf = (r: RunRow): number[] => parse<number[]>(r.articles, []).filter(x => Number.isSafeInteger(x));

/* ---------- What the dashboard gets ---------- */

export function viewRun(r: RunRow) {
  return {
    id: r.id, kind: r.kind, name: WEEKLY, siteId: r.site_id, domain: r.domain, scheduleId: r.schedule_id, by: r.by, topic: r.topic, n: r.n,
    status: r.status, step: r.step, stepAt: r.step_at, wait: r.status === 'running' ? parse<Wait | null>(r.wait, null) : null,
    requestId: r.request_id, articles: idsOf(r), buildId: r.build_id, outcome: r.outcome, error: r.error,
    log: parse<{ at: number; text: string }[]>(r.log, []),
    createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at,
  };
}
export type RunView = ReturnType<typeof viewRun>;
export const listRuns = (): RunView[] => (qw.list.all() as RunRow[]).map(viewRun);
export const runView = (id: number): RunView | null => { const r = row(id); return r ? viewRun(r) : null; };
/** The site already has a workflow running (one at a time per site). */
export const runningFor = (siteId: string): number | null => (qw.runningForSite.get(siteId) as { id: number } | undefined)?.id ?? null;

function save(r: RunRow): void {
  r.updated_at = Math.max(Date.now(), r.updated_at + 1);
  qw.save.run(r.status, r.step, r.step_at, r.wait, r.request_id, r.own_request, r.articles, r.picked, r.build_id, r.outcome, r.error, r.log, r.updated_at, r.finished_at, r.id);
  bus.emit('workflow', { run: viewRun(r) });
}

/* ---------- Small moves on a run (in memory; advance() saves) ---------- */

/** Records what a step did. */
function note(r: RunRow, text: string): void {
  const log = parse<{ at: number; text: string }[]>(r.log, []);
  log.push({ at: Date.now(), text: text.slice(0, 400) });
  r.log = JSON.stringify(log.slice(-LOG_MAX));
}
/** What the run waits for now. Returns false: nothing more to do until something changes. */
function wait(r: RunRow, kind: Wait['kind'], text: string, detail = ''): false {
  r.wait = JSON.stringify(detail ? { kind, text, detail } : { kind, text });
  return false;
}
const WAITING_FOR_BUDGET = 'Waiting for budget';
const holdBudget = (r: RunRow, why: string): false => wait(r, 'budget', WAITING_FOR_BUDGET, why);
/** Moves to a step. Returns true: look again at once. */
function enter(r: RunRow, step: Step, text = ''): true {
  if (r.step !== step) { r.step = step; r.step_at = Date.now(); }
  r.wait = '';
  if (text) note(r, text);
  return true;
}
function finish(r: RunRow, status: Exclude<Status, 'running'>, text: string): false {
  r.status = status; r.wait = ''; r.finished_at = Date.now();
  if (status === 'failed') r.error = text.slice(0, 500); else r.outcome = text.slice(0, 500);
  if (status === 'done') { r.step = 'done'; r.step_at = r.finished_at; }
  note(r, status === 'failed' ? 'Stopped: ' + text : text);
  const what = status === 'done' ? 'finished' : status === 'failed' ? 'stopped' : 'was cancelled';
  try { bus.emit('audit', addAudit(ORCHESTRATOR, `"${WEEKLY}" for ${r.domain} ${what}: ${text}`.slice(0, 480), r.site_id)); } catch { /* the run itself says it */ }
  return false;
}
const fail = (r: RunRow, why: string): false => finish(r, 'failed', why);

/** The model an agent is set to in the agents document. */
function agentModel(id: string): string {
  const d = getDoc('agents').data;
  if (!Array.isArray(d)) return defaultModel(id);
  const a = d.find(x => x && typeof x === 'object' && !Array.isArray(x) && (x as Record<string, Json>).id === id) as Record<string, Json> | undefined;
  return typeof a?.model === 'string' ? a.model : defaultModel(id);
}

/* ---------- The steps ---------- */

type Keyword = KeywordRow & { volume?: number | null };
/**
 * The keywords of a finished research that have no article of the site yet (of any status: a rejected or failed one
 * is a person's to try again), best first: by search volume when the research carries volumes, else the agent's order.
 */
export function candidates(requestId: number, siteId: string): { list: Keyword[]; byVolume: boolean } {
  const all = q.keywordsFor.all(requestId) as Keyword[];
  const have = new Set((qw.articleKeywords.all(siteId) as { k: string }[]).map(x => x.k));
  const seen = new Set<string>();
  const list = all.filter(k => { const key = k.keyword.toLowerCase(); if (have.has(key) || seen.has(key)) return false; seen.add(key); return true; });
  const vol = (k: Keyword): number | null => typeof k.volume === 'number' && Number.isFinite(k.volume) ? k.volume : null;
  const byVolume = all.some(k => vol(k) !== null);
  if (byVolume) list.sort((x, y) => (vol(y) ?? -1) - (vol(x) ?? -1) || x.id - y.id);
  return { list, byVolume };
}

function research(r: RunRow, site: SiteInfo): boolean {
  if (r.request_id === null) {
    const topic = r.topic || site.topic;
    if (!topic) return fail(r, 'This site has no topic to research. Add a topic to the site in Sites, or give the schedule one.');
    const same = q.duplicate.get(site.id, topic) as { id: number } | undefined;
    if (same) { r.request_id = same.id; r.own_request = 0; return enter(r, 'research', `Joined the keyword research that was already in the queue: ${topic}`); }
    const stop = budgetStop(site.id);
    if (stop) return holdBudget(r, stop);
    const full = queueFull(site.id);
    if (full) return wait(r, 'queue', 'Waiting for room in the job queue', full);
    const req = createRequest(site, topic, GOAL, agentModel('kw'), ORCHESTRATOR.name);
    r.request_id = req.id; r.own_request = 1;
    kick();
    return enter(r, 'research', `Asked the Keyword agent for keyword research: ${topic}`);
  }
  const req = q.getRequest.get(r.request_id) as RequestRow | undefined;
  if (!req) return fail(r, 'Its keyword research request no longer exists.');
  if (req.status === 'queued') {
    const stop = budgetStop(site.id);
    return stop ? holdBudget(r, stop) : wait(r, 'agent', 'Keyword research is waiting for its turn');
  }
  if (req.status === 'work') return wait(r, 'agent', 'The Keyword agent is researching keywords');
  if (req.status === 'failed') return fail(r, 'Keyword research failed: ' + (req.error || 'no reason given'));
  return pick(r, site, req);
}

/** Queues the articles: one per keyword, best first, until N are queued. A budget stop in the middle holds the run there. */
function pick(r: RunRow, site: SiteInfo, req: RequestRow): boolean {
  const have = idsOf(r), refused = new Set<string>();
  const { list, byVolume } = candidates(req.id, site.id);
  for (const k of list) {
    if (have.length >= r.n) break;
    const stop = budgetStop(site.id);
    if (stop) return holdBudget(r, stop);
    const full = queueFull(site.id);
    if (full) return wait(r, 'queue', 'Waiting for room in the job queue', full);
    const o = createArticle({ siteId: site.id, keyword: k.keyword, requestId: req.id, model: agentModel('wr'), by: ORCHESTRATOR.name });
    if (o.ok) { have.push(o.article.id); r.articles = JSON.stringify(have); }
    else if (!refused.has(k.keyword)) { refused.add(k.keyword); note(r, `Left out "${k.keyword}": ${o.error}`); }
  }
  r.picked = 1;
  if (!have.length) return finish(r, 'done', 'The research found no keyword without an article, so nothing was written.');
  kick();
  const names = have.map(id => articleRow(id)?.keyword).filter((x): x is string => !!x).map(x => `"${x}"`).join(', ');
  const short = have.length < r.n ? ` (the research had only ${plural(have.length, 'keyword')} without an article)` : '';
  return enter(r, 'write', `Queued ${plural(have.length, 'article')}, chosen ${byVolume ? 'by search volume' : "in the Keyword agent's order"}: ${names}${short}`);
}

function articles(r: RunRow, site: SiteInfo): boolean {
  const rows = idsOf(r).map(id => articleRow(id));
  const count = (...st: string[]) => rows.filter(a => a && st.includes(a.status)).length;
  const writing = count('queued', 'work', 'revision'), inReview = count('review'), approved = count('approved'), rejected = count('rejected'), failed = count('failed');
  if (inReview) {
    if (r.step !== 'review') enter(r, 'review', `${plural(inReview, 'article')} ${inReview === 1 ? 'is' : 'are'} ready for review`);
    return wait(r, 'person', `Waiting for your review of ${plural(inReview, 'article')}`, writing ? `The Content Writer is still working on ${writing} more.` : '');
  }
  if (writing) {
    if (r.step !== 'write') enter(r, 'write', 'A revision was asked for: back to the Content Writer');
    if (!count('work')) { const stop = budgetStop(site.id); if (stop) return holdBudget(r, stop); }
    const done = rows.length - writing;
    return wait(r, 'agent', count('work') ? `The Content Writer is writing article ${Math.min(rows.length, done + 1)} of ${rows.length}` : `${plural(writing, 'article')} waiting for the Content Writer`);
  }
  /* Every article's part has ended: approved, rejected, failed (or removed). */
  const tally = [approved ? `${approved} approved` : '', rejected ? `${rejected} rejected` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(', ') || 'none left';
  if (approved) return enter(r, 'build', `Review is over: ${tally}`);
  if (failed && failed === rows.length) return fail(r, `The Content Writer failed on ${failed === 1 ? 'the article' : 'every article'}: ${rows.find(a => a?.status === 'failed')?.error || 'no reason given'}`);
  return finish(r, 'done', `No article was approved (${tally}), so the website was not built.`);
}

function build(r: RunRow, site: SiteInfo): boolean {
  if (r.build_id === null) {
    /* Only a site's first build calls a model (builds.ts): only that one waits for budget. */
    const stop = identityOf(site.id) ? null : budgetStop(site.id);
    if (stop) return holdBudget(r, stop);
    if (qw.openBuild.get(site.id)) return wait(r, 'agent', 'Waiting for the website build that is already running, then it builds again with the new articles');
    const full = queueFull(site.id);
    if (full) return wait(r, 'queue', 'Waiting for room in the job queue', full);
    const o = requestBuild(site, ORCHESTRATOR.name);
    if (!o.ok) return fail(r, 'The website build could not be queued: ' + o.error);
    r.build_id = o.build.id;
    kick();
    return enter(r, 'build', `Asked the Site Builder for website v${o.build.version}`);
  }
  const b = buildRow(r.build_id);
  if (!b) return fail(r, 'Its website build no longer exists.');
  if (b.status === 'queued') {
    const stop = identityOf(site.id) ? null : budgetStop(site.id);
    return stop ? holdBudget(r, stop) : wait(r, 'agent', `Website v${b.version} is waiting for its turn`);
  }
  if (b.status === 'work') return wait(r, 'agent', `The Site Builder is building website v${b.version}`);
  if (b.status === 'failed') return fail(r, `The build of website v${b.version} failed: ${b.error || 'no reason given'}`);
  return enter(r, 'approve', `Website v${b.version} is built: ${plural(b.pages, 'page')}`);
}

function approve(r: RunRow): boolean {
  const b = r.build_id === null ? undefined : buildRow(r.build_id);
  if (!b) return fail(r, 'Its website build no longer exists.');
  if (b.review === 'rejected') return finish(r, 'done', `Website v${b.version} was rejected${b.decided_by ? ' by ' + b.decided_by : ''}, so nothing was deployed.`);
  if (b.review !== 'approved') return wait(r, 'person', `Waiting for your approval of website v${b.version}`);
  return enter(r, 'deploy', `Website v${b.version} was approved${b.decided_by ? ' by ' + b.decided_by : ''}`);
}

function deploy(r: RunRow): boolean {
  const b = r.build_id === null ? undefined : buildRow(r.build_id);
  if (!b) return fail(r, 'Its website build no longer exists.');
  switch (b.deploy) {
    case 'queued': return wait(r, 'agent', `The deploy of website v${b.version} is waiting for its turn`);
    case 'work': return wait(r, 'agent', `Deploy & Monitor is putting website v${b.version} live`);
    case 'failed': return fail(r, `The deploy of website v${b.version} failed: ${b.deploy_error || 'no reason given'}`);
    case 'live': case 'superseded': return finish(r, 'done', `Website v${b.version} is live${b.deploy_url ? ' at ' + b.deploy_url : ''}.`);
    default:
      /* Approved and not queued for a deploy (builds.ts whyNotLive): Cloudflare is not connected, or a newer version is out. */
      return finish(r, 'done', cloudflareReady()
        ? `Website v${b.version} is approved. It was not put live: a newer version is live or on its way.`
        : `Website v${b.version} is approved. Cloudflare is not connected, so it was not deployed: download the ZIP in Build and deploy, or connect Cloudflare and deploy it there.`);
  }
}

function stepOnce(r: RunRow): boolean {
  const site = siteInfo(r.site_id);
  if (!site) return fail(r, 'This site is no longer in Sites.');
  switch (r.step) {
    case 'research': return research(r, site);
    case 'write': case 'review': return articles(r, site);
    case 'build': return build(r, site);
    case 'approve': return approve(r);
    case 'deploy': return deploy(r);
    default: return false;
  }
}

/* ---------- Moving a run along ---------- */

const advancing = new Set<number>(), again = new Set<number>();
/**
 * Looks at the jobs of a run and moves it as far as it can go now. Called when a run starts, when one of its site's
 * jobs changes, when the budget may have changed, and every minute. Creating a job announces it, which calls back in
 * here: that call is noted and answered by one more look.
 */
export function advance(id: number): void {
  if (advancing.has(id)) { again.add(id); return; }
  advancing.add(id);
  try {
    for (let i = 0; i < 30; i++) {
      again.delete(id);
      const r = row(id);
      if (!r || r.status !== 'running') return;
      const before = JSON.stringify(r);
      let more = false;
      try { more = stepOnce(r); }
      catch (e) { fail(r, 'The workflow stopped on an error: ' + String((e as Error).message || e).slice(0, 300)); }
      if (JSON.stringify(r) !== before) save(r);
      if (!more && !again.has(id)) return;
    }
  } finally { advancing.delete(id); again.delete(id); }
}
const safely = (what: string, fn: () => void): void => { try { fn(); } catch (e) { console.error(what, String((e as Error).message || e).slice(0, 300)); } };
function advanceSite(siteId: string): void {
  for (const x of qw.runningForSite.all(siteId) as { id: number }[]) safely('A workflow could not be moved along and is looked at again:', () => advance(x.id));
}
export function advanceAll(): void {
  for (const x of qw.running.all() as { id: number }[]) safely('A workflow could not be moved along and is looked at again:', () => advance(x.id));
}

/* ---------- Starting and cancelling ---------- */

export type NewRun = { siteId: string; n: number; topic: string; scheduleId: string; by: string };
export type Outcome = { ok: true; run: RunView } | { ok: false; status: number; error: string };
export const ALREADY = 'A workflow is already running for this site. Wait for it to finish, or cancel it.';

/** Starts "Weekly content" for a site. The caller checks the role and that OpenAI API is signed in. */
export function startRun(n: NewRun, actor: { name: string; id: number | null } = ORCHESTRATOR): Outcome {
  const site = siteInfo(n.siteId);
  if (!site) return { ok: false, status: 404, error: 'That site is not in Sites (any more). Choose a site that is.' };
  if (runningFor(site.id) !== null) return { ok: false, status: 409, error: ALREADY };
  const now = Date.now();
  const info = qw.insert.run(site.id, site.domain, n.scheduleId, n.by, n.topic, clampN(n.n), now, now, now);
  const id = Number(info.lastInsertRowid), r = row(id)!;
  note(r, n.scheduleId && n.by === SCHEDULE ? 'Started by its schedule' : `Started by ${n.by}`);
  save(r);
  bus.emit('audit', addAudit(actor, `Started "${WEEKLY}" for ${site.domain}: ${plural(clampN(n.n), 'article')}`, site.id));
  advance(id);
  return { ok: true, run: runView(id)! };
}

/** Cancels a running workflow. The jobs it queued that have not started are withdrawn; a job that is running finishes. */
export function cancelRun(id: number, by: string): Outcome {
  const r = row(id);
  if (!r) return { ok: false, status: 404, error: 'Workflow not found.' };
  if (r.status !== 'running') return { ok: false, status: 409, error: 'This workflow is not running.' };
  const mine = { request: r.own_request && r.request_id !== null ? r.request_id : null, articles: idsOf(r), build: r.build_id };
  /* Ended first, so the changes below do not move it along. */
  finish(r, 'cancelled', `Cancelled by ${by}.`);
  save(r);
  let withdrawn = 0;
  if (mine.request !== null && withdrawRequest(mine.request, CANCELLED)) withdrawn++;
  for (const a of mine.articles) if (withdrawArticle(a, by, CANCELLED)) withdrawn++;
  if (mine.build !== null && withdrawBuild(mine.build, CANCELLED)) withdrawn++;
  const left = row(id)!;
  note(left, withdrawn ? `Withdrew ${plural(withdrawn, 'queued job')} that had not started.` : 'No queued job had to be withdrawn.');
  left.outcome = `Cancelled by ${by}. ${withdrawn ? `${plural(withdrawn, 'queued job')} withdrawn.` : 'Nothing was waiting in the queue.'}`;
  save(left);
  return { ok: true, run: viewRun(left) };
}

/* ---------- Schedules ---------- */

const SCHEDULE = 'Schedule';
export type Sched = { id: string; site: string; on: boolean; n: number; topic: string; cadence: Cadence };
/** The schedules the engine runs: "Weekly content" for a site, with a valid cadence. Anything else in the document is ignored. */
export function schedules(): Sched[] {
  const d = getDoc('schedules').data;
  if (!Array.isArray(d)) return [];
  const out: Sched[] = [];
  for (const x of d) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const o = x as Record<string, Json>, cadence = cadenceOf(o);
    if (typeof o.id !== 'string' || o.wf !== WEEKLY || typeof o.site !== 'string' || !o.site || !cadence) continue;
    out.push({ id: o.id, site: o.site, on: o.on === true, n: clampN(o.n), topic: typeof o.topic === 'string' ? o.topic.replace(/\s+/g, ' ').trim().slice(0, 80) : '', cadence });
  }
  return out;
}

/** What is remembered per schedule (kv): `sig` is what its times depend on; a change starts it afresh from now. */
type Memo = DueState & { sig: string; note: string; noteAt: number };
const memoKey = (id: string) => 'workflow:schedule:' + id;
function memoOf(id: string): Memo | null {
  const v = (qw.kvGet.get(memoKey(id)) as { value: string } | undefined)?.value;
  const m = v ? parse<Partial<Memo> | null>(v, null) : null;
  return m && typeof m.sig === 'string' && typeof m.seen === 'number'
    ? { sig: m.sig, seen: m.seen, fired: typeof m.fired === 'number' ? m.fired : null, note: typeof m.note === 'string' ? m.note : '', noteAt: Number(m.noteAt) || 0 } : null;
}
const putMemo = (id: string, m: Memo) => qw.kvPut.run(memoKey(id), JSON.stringify(m));
const sigOf = (s: Sched, tz: string): string => [s.cadence.every, s.cadence.weekday, s.cadence.hour, s.site, tz].join('|');

/** The scheduler's clock. MERIDIAN_SCHEDULER_NOW (ms) fixes it, for the tests of due times and restarts. */
export const clock = (): number => Number(process.env.MERIDIAN_SCHEDULER_NOW) || Date.now();

export type SchedView = { id: string; siteId: string; zone: string; nextDue: number | null; lastDue: number | null; note: string; noteAt: number };
/** Each schedule's next start, the slot it last dealt with, and what happened then when it did not start a run. */
export function scheduleViews(now = clock()): SchedView[] {
  return schedules().map(s => {
    const site = siteInfo(s.site), tz = zoneOf(site?.cc ?? ''), m = memoOf(s.id);
    const st: DueState = m && m.sig === sigOf(s, tz) ? m : { seen: now, fired: null };
    return {
      id: s.id, siteId: s.site, zone: tz, nextDue: s.on && site ? nextDue(now, s.cadence, tz, st) : null,
      lastDue: m?.fired ?? null, note: !site ? 'Its site is no longer in Sites.' : m?.note ?? '', noteAt: m?.noteAt ?? 0,
    };
  });
}
const announceSchedules = (): void => { try { bus.emit('workflow', { schedules: scheduleViews() }); } catch { /* the next load has them */ } };

let passing = false;
/**
 * One look at every schedule: a schedule seen for the first time (or changed, or turned on) counts from now; one whose
 * time has come starts its run once. The slot is written down before anything starts. Returns how many runs started.
 */
export async function schedulerPass(now = clock()): Promise<number> {
  if (passing) return 0;
  passing = true;
  let started = 0, changed = false;
  try {
    for (const s of schedules()) {
      const site = siteInfo(s.site), tz = zoneOf(site?.cc ?? ''), sig = s.on ? sigOf(s, tz) : 'off';
      const m = memoOf(s.id);
      if (!m || m.sig !== sig) { putMemo(s.id, { sig, seen: now, fired: null, note: '', noteAt: 0 }); changed = true; continue; }
      if (!s.on) continue;
      const due = dueNow(now, s.cadence, tz, m);
      if (!due) continue;
      const when = slotText(due.slot, tz);
      const next: Memo = { ...m, seen: due.slot, fired: due.slot, note: '', noteAt: now };
      putMemo(s.id, next);
      changed = true;
      let why = '';
      if (!site) why = `Not started (${when}): its site is no longer in Sites.`;
      else if (due.late) why = `Skipped the run of ${when}: Meridian was not running at that time, and a run more than 6 hours late is not started.`;
      else if (site.status === 'paused') why = `Skipped the run of ${when}: the site is paused.`;
      else if (runningFor(site.id) !== null) why = `Skipped the run of ${when}: the workflow before it was still running for this site.`;
      else if (!(await engineReady())) why = `Not started (${when}): OpenAI was not connected. Add and test the API key in Integrations.`;
      else {
        const o = startRun({ siteId: site.id, n: s.n, topic: s.topic, scheduleId: s.id, by: SCHEDULE });
        if (o.ok) started++; else why = `Not started (${when}): ${o.error}`;
      }
      if (why) {
        putMemo(s.id, { ...next, note: why });
        try { bus.emit('audit', addAudit(ORCHESTRATOR, `"${WEEKLY}" schedule: ${why}`.slice(0, 480), site?.id ?? null)); } catch { /* the schedule row says it */ }
      }
    }
  } finally { passing = false; }
  if (changed) announceSchedules();
  return started;
}

/* ---------- Start ---------- */

let started = false;
/** Follows the jobs, the budget and the schedules. Called once, when the server is listening. */
export function startWorkflows(): void {
  if (started) return;
  started = true;
  /* A moment after the job's own news, not inside it: the job has then written everything it had to, and the spend
     ledger has the run that just ended (ledger.ts writes it a moment later too), so the budget is judged on today's
     real spend. */
  const site = (x: { siteId?: string }) => { const id = x?.siteId; if (typeof id === 'string') setImmediate(() => advanceSite(id)); };
  bus.on('request', site); bus.on('article', site); bus.on('build', site);
  const pass = () => { void schedulerPass().catch(e => console.error('The schedules could not be looked at and are tried again:', String((e as Error).message || e).slice(0, 300))); };
  /* A raised budget, a changed site or schedule: held runs look again, and the next start times are worked out again. */
  bus.on('workspace', (d: { doc: string }) => {
    if (d.doc === 'settings' || d.doc === 'sites') advanceAll();
    if (d.doc === 'schedules' || d.doc === 'sites') { pass(); announceSchedules(); }
  });
  bus.on('reset', () => { advanceAll(); announceSchedules(); });
  const tick = () => { advanceAll(); pass(); };
  setInterval(tick, Number(process.env.MERIDIAN_SCHEDULER_TICK_MS) || 60_000).unref();
  tick();
}

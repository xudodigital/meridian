// The spend ledger: one row in job_runs per run of the OpenAI Responses API, however it ended (engine.ts reports each run,
// with the tokens and cost the API reported). Everything about money is a sum over these rows: a site's spend today, the
// last 7 and 28 days, tokens per agent, the budget alerts (notify.ts) and the weekly report (report.ts). A revision or
// a retry adds a row, so nothing is overwritten and nothing is counted twice.
//
// The daily budget per site (Settings) is a hard stop. Once a site's spend today reaches it, new agent jobs for that
// site are refused (budgetStop) and the ones already waiting are held in the queue (budgetHeld): they start again
// after local midnight or when the budget is raised.
import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from './db.ts';
import { onModelRun, type ModelRun } from './engine.ts';
import { bus } from './events.ts';
import { settingsDoc, siteInfo } from './workspace.ts';

/** The jobs that call a model. A deploy does not. */
export type RunKind = 'seo-task' | 'request' | 'article' | 'photos' | 'build';
/** Which job a API call belongs to. */
export type RunMeta = { kind: RunKind; jobId: number; siteId: string; agent: string };
export type RunRow = RunMeta & { engine?: 'openai-api' | 'codex-local' | ''; model: string; startedAt: number; endedAt: number; tokens: number; costUsd: number; outcome: ModelRun['outcome'] };

const ql = {
  insert: db.prepare(`INSERT INTO job_runs (kind, job_id, site_id, agent, model, started_at, ended_at, tokens, cost_usd, outcome, backfilled, engine)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  siteSince: db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM job_runs WHERE site_id = ? AND ended_at >= ?'),
  bySite: db.prepare(`SELECT site_id AS site,
      COALESCE(SUM(CASE WHEN ended_at >= $day THEN cost_usd END), 0) AS today,
      COALESCE(SUM(CASE WHEN ended_at >= $day THEN tokens END), 0) AS tokensToday,
      COALESCE(SUM(CASE WHEN ended_at >= $d7 THEN cost_usd END), 0) AS d7,
      COALESCE(SUM(cost_usd), 0) AS d28, COALESCE(SUM(tokens), 0) AS tokens28
    FROM job_runs WHERE ended_at >= $d28 GROUP BY site_id`),
  byAgent: db.prepare(`SELECT agent, COALESCE(SUM(tokens), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS runs
    FROM job_runs WHERE ended_at >= ? GROUP BY agent`),
  since: db.prepare('SELECT site_id AS site, COALESCE(SUM(cost_usd), 0) AS usd FROM job_runs WHERE ended_at >= ? GROUP BY site_id'),
  forJob: db.prepare('SELECT * FROM job_runs WHERE kind = ? AND job_id = ? ORDER BY id'),
  kvGet: db.prepare('SELECT value FROM kv WHERE key = ?'),
  kvPut: db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)'),
};

/* ---------- Once: the costs recorded before the ledger existed ---------- */

/**
 * Copies the cost each job row held (the latest run of a request, an article, an article's photo job and a build) into
 * the ledger, once. Older runs of the same job were overwritten back then and cannot be recovered; from here on every
 * run has its own row.
 */
function backfill(): void {
  const DONE = 'ledger:backfilled';
  if (ql.kvGet.get(DONE)) return;
  db.exec('BEGIN');
  try {
    db.exec(`
      INSERT INTO job_runs (kind, job_id, site_id, agent, model, started_at, ended_at, tokens, cost_usd, outcome, backfilled)
        SELECT 'request', id, site_id, 'Keyword', model, COALESCE(started_at, finished_at), finished_at, tokens, cost_usd,
          CASE WHEN status = 'failed' THEN 'failed' ELSE 'ok' END, 1
        FROM requests WHERE finished_at IS NOT NULL AND (cost_usd > 0 OR tokens > 0);
      INSERT INTO job_runs (kind, job_id, site_id, agent, model, started_at, ended_at, tokens, cost_usd, outcome, backfilled)
        SELECT 'article', id, site_id, 'Content Writer', model, COALESCE(started_at, finished_at), finished_at, tokens, cost_usd,
          CASE WHEN status = 'failed' THEN 'failed' ELSE 'ok' END, 1
        FROM articles WHERE finished_at IS NOT NULL AND (cost_usd > 0 OR tokens > 0);
      INSERT INTO job_runs (kind, job_id, site_id, agent, model, started_at, ended_at, tokens, cost_usd, outcome, backfilled)
        SELECT 'photos', id, site_id, 'Site Builder', '', COALESCE(photos_started_at, photos_finished_at), photos_finished_at, photos_tokens, photos_cost,
          CASE WHEN photos_status = 'failed' THEN 'failed' ELSE 'ok' END, 1
        FROM articles WHERE photos_finished_at IS NOT NULL AND (photos_cost > 0 OR photos_tokens > 0);
      INSERT INTO job_runs (kind, job_id, site_id, agent, model, started_at, ended_at, tokens, cost_usd, outcome, backfilled)
        SELECT 'build', id, site_id, 'Site Builder', '', COALESCE(started_at, finished_at), finished_at, tokens, cost_usd,
          CASE WHEN status = 'failed' THEN 'failed' ELSE 'ok' END, 1
        FROM site_builds WHERE finished_at IS NOT NULL AND (cost_usd > 0 OR tokens > 0);`);
    ql.kvPut.run(DONE, String(Date.now()));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
backfill();

/* ---------- Recording ---------- */

/** Local midnight before `now`: the day a budget counts for, on this computer's clock. */
export function dayStart(now = Date.now()): number { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
/** Local midnight `days - 1` days before today's: the start of "the last `days` days", today included. */
function daysBack(now: number, days: number): number { const d = new Date(dayStart(now)); d.setDate(d.getDate() - (days - 1)); return d.getTime(); }

/** Writes one run to the ledger and tells the dashboards and the budget alerts. Throws when the database refuses. */
export function recordRun(r: RunRow): void {
  ql.insert.run(r.kind, r.jobId, r.siteId, r.agent, r.model, r.startedAt, r.endedAt, Math.round(r.tokens) || 0, Number(r.costUsd) || 0, r.outcome, 0, r.engine ?? '');
  /* The row is in; whoever listens must not make it look as if it were not. */
  try { bus.emit('run', { siteId: r.siteId, at: r.endedAt, costUsd: r.costUsd }); } catch (e) { console.error('After a run was written to the spend ledger:', (e as Error).message); }
  announce();
}
/** The ledger rows of one job, oldest first (its first draft, revisions and retries). */
export const runsOf = (kind: RunKind, jobId: number): RunRow[] =>
  (ql.forJob.all(kind, jobId) as { kind: RunKind; job_id: number; site_id: string; agent: string; model: string; started_at: number; ended_at: number; tokens: number; cost_usd: number; outcome: ModelRun['outcome'] }[])
    .map(x => ({ kind: x.kind, engine: (x as { engine?: RunRow['engine'] }).engine, jobId: x.job_id, siteId: x.site_id, agent: x.agent, model: x.model, startedAt: x.started_at, endedAt: x.ended_at, tokens: x.tokens, costUsd: x.cost_usd, outcome: x.outcome }));

/* Which job the API call that just ended belongs to: the job's handler says so around its call (metered), and the
   engine's report arrives inside that call, however deep. */
const current = new AsyncLocalStorage<{ meta: RunMeta; used: Usage }>();
/** What the API calls inside one metered() call used, failed ones included. */
export type Usage = { tokens: number; costUsd: number };

/**
 * Runs `fn` (which calls the API) for a job: every API call inside it is written to the ledger under `meta`.
 * `used`, when given, is added to as runs end, so the caller knows what a job cost even when `fn` throws.
 */
export function metered<T>(meta: RunMeta, fn: () => Promise<T>, used: Usage = { tokens: 0, costUsd: 0 }): Promise<T> {
  return current.run({ meta, used }, fn);
}
/* Runs not written yet. The row is written a moment after the run ends, not inside it: the job's own result goes to
   the database first, so a database that is busy costs the job one wait, not two. A row that cannot be written (the
   database stayed locked) is kept here and tried again, so spend is never lost to a busy moment. */
const unwritten: RunRow[] = [];
const WRITE_AGAIN_MS = 5000;
let writeAgain: ReturnType<typeof setTimeout> | undefined;
function writeRuns(): void {
  clearTimeout(writeAgain);
  while (unwritten.length) {
    try { recordRun(unwritten[0]!); }
    catch (e) {
      console.error('A run could not be written to the spend ledger yet and is tried again:', String((e as Error).message || e).slice(0, 200));
      writeAgain = setTimeout(writeRuns, WRITE_AGAIN_MS);
      writeAgain.unref();
      return;
    }
    unwritten.shift();
  }
}
onModelRun(run => {
  const ctx = current.getStore();
  if (!ctx) return;
  ctx.used.tokens += run.tokens; ctx.used.costUsd += run.costUsd;
  unwritten.push({ ...ctx.meta, ...run });
  setImmediate(writeRuns);
});

/* ---------- Spend ---------- */

/** The daily budget per site in USD (Settings). The app's default applies while it was never saved. */
export const budget = (): number => { const b = Number(settingsDoc().budget); return b > 0 ? b : 25; };

/** Agent spend of a site since local midnight, in USD. */
export function siteSpendToday(siteId: string, now = Date.now()): number {
  return (ql.siteSince.get(siteId, dayStart(now)) as { usd: number }).usd;
}
/** Agent spend per site id since `from`. */
export const spendSince = (from: number): Map<string, number> =>
  new Map((ql.since.all(from) as { site: string; usd: number }[]).map(r => [r.site, Number(r.usd) || 0]));

export type SiteSpend = { today: number; tokensToday: number; d7: number; d28: number; tokens28: number };
export type AgentSpend = { tokens: number; cost: number; runs: number };
/** What the dashboards show: per site and per agent, with the budget and the day it counts for. */
export type SpendSnapshot = { budget: number; day: number; sites: Record<string, SiteSpend>; agents: Record<string, AgentSpend> };

export function spendSnapshot(now = Date.now()): SpendSnapshot {
  const day = dayStart(now);
  const sites: Record<string, SiteSpend> = {};
  for (const r of ql.bySite.all({ day, d7: daysBack(now, 7), d28: daysBack(now, 28) }) as ({ site: string } & SiteSpend)[])
    sites[r.site] = { today: r.today, tokensToday: r.tokensToday, d7: r.d7, d28: r.d28, tokens28: r.tokens28 };
  const agents: Record<string, AgentSpend> = {};
  for (const r of ql.byAgent.all(day) as ({ agent: string } & AgentSpend)[]) agents[r.agent] = { tokens: r.tokens, cost: r.cost, runs: r.runs };
  return { budget: budget(), day, sites, agents };
}
/** Sends the figures to the open dashboards (stream.ts). */
export function announce(): void { try { bus.emit('spend', spendSnapshot()); } catch { /* the next load has them */ } }

/* ---------- The hard stop ---------- */

const usd = (n: number): string => '$' + n.toFixed(2);
/** The site's spend today has reached the daily budget: nothing new starts for it today. */
export const budgetHeld = (siteId: string, now = Date.now()): boolean => siteSpendToday(siteId, now) >= budget();
/** The ids of the sites whose budget is used up today. */
export function heldSites(now = Date.now()): Set<string> {
  const b = budget();
  return new Set([...spendSince(dayStart(now))].filter(([, spent]) => spent >= b).map(([id]) => id));
}
/**
 * Why a new agent job for this site is refused (HTTP 409), or null when it may be queued. For every job that calls a
 * model: research, an article, a revision, a retry, finding photos, and a first build (which asks for the identity).
 */
export function budgetStop(siteId: string, now = Date.now()): string | null {
  if (!budgetHeld(siteId, now)) return null;
  return `${siteInfo(siteId)?.domain || 'This site'} has used its daily budget of ${usd(budget())}. It resets at midnight, or raise the budget in Settings.`;
}
/** The first waiting job whose site still has budget; the others keep their place and wait ("Waiting for budget"). */
export function firstAllowed<T>(waiting: T[], siteOf: (job: T) => string, now = Date.now()): T | undefined {
  if (!waiting.length) return undefined;
  const held = heldSites(now);
  return held.size ? waiting.find(j => !held.has(siteOf(j))) : waiting[0];
}

/**
 * Starts held jobs again when their reason is gone: a new day (local midnight), or a budget raised in Settings (also by
 * a workspace reset). `kick` starts the job queue; the dashboards get the new figures either way.
 */
export function watchBudget(kick: () => void): void {
  const again = () => { announce(); kick(); };
  bus.on('workspace', (d: { doc: string }) => { if (d.doc === 'settings') again(); });
  bus.on('reset', again);
  const midnight = () => {
    const next = new Date(dayStart()); next.setDate(next.getDate() + 1);
    /* A second past midnight, so the new day has certainly begun on this clock. */
    setTimeout(() => { again(); midnight(); }, Math.max(1000, next.getTime() - Date.now() + 1000)).unref();
  };
  midnight();
}

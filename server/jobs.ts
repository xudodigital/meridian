// The job queue shared by every agent job: keyword research, articles, photos, website builds and deploys. One job
// at a time, oldest first. The queue never stops and never takes the server down: a job whose handler throws is
// marked failed here and the next one runs. A job that was running when the server stopped goes back to the queue
// (with a step saying so when the stop was orderly); one found mid-run at two starts in a row is failed instead, so a
// job that crashes the server cannot do it forever.
import { db, q, qa } from './db.ts';
import { nextArticleJob } from './articles.ts';
import { stopEngine } from './engine.ts';
import { nextRequestJob } from './requests.ts';
import { addStep, type JobKind } from './steps.ts';

/** One waiting job: when it joined the queue, and how to run it. `run` records its own result and never throws. */
export type QueuedJob = { queuedAt: number; run: (signal: AbortSignal) => Promise<void> };

let running: AbortController | null = null;
/** The server is stopping: nothing new starts. */
let stopping = false;

/* Where waiting jobs come from, in order of preference on a tie. Research and articles are built in; other kinds
   (photos, site builds, deploys) register themselves with addJobSource() when their module is imported. */
const sources: (() => QueuedJob | null)[] = [nextRequestJob, nextArticleJob];
const recovers: (() => void)[] = [];
/** Adds a kind of job to the shared queue. `recover` puts that kind's jobs that were mid-run back in the queue at start. */
export function addJobSource(next: () => QueuedJob | null, recover?: () => void): void { sources.push(next); if (recover) recovers.push(recover); }

const say = (what: string, e: unknown) => console.error(what, String((e as Error)?.message || e).slice(0, 300));

export function kick() {
  if (running || stopping) return;
  next().catch(e => say('The job queue hit an error and carries on:', e));
}

/** The oldest waiting job of any kind; on a tie, the source registered first goes first. */
function oldest(): QueuedJob | null {
  const jobs = sources.map(s => s()).filter((j): j is QueuedJob => j !== null);
  return jobs.reduce<QueuedJob | null>((best, j) => !best || j.queuedAt < best.queuedAt ? j : best, null);
}

/** How long the queue waits before looking again after the database could not be read. */
const LOOK_AGAIN_MS = 5000;

async function next(): Promise<void> {
  let job: QueuedJob | null;
  try { job = oldest(); }
  catch (e) {
    /* The database is busy or the disk is full: nothing is lost, the queue looks again shortly. */
    say('The job queue could not read the database and will look again:', e);
    setTimeout(kick, LOOK_AGAIN_MS).unref();
    return;
  }
  if (!job) return;
  running = new AbortController();
  try { await job.run(running.signal); }
  catch (e) {
    /* The handler could not even record its own failure (for example the database stayed locked). The job would
       stay "working" for good and, for some kinds, hold up its site: it is marked failed here instead. */
    say('A job stopped without recording why:', e);
    try { failRunning('Stopped: the server could not save the result of this job. Try it again.'); }
    catch (e2) { say('The job could not be marked as failed either; it is put back in the queue at the next start:', e2); }
  }
  finally {
    running = null;
    try { forgetFinished(); } catch { /* counted again at the next start at worst */ }
    if (!stopping) setImmediate(kick);
  }
}

/* ---------- Every kind of job, as rows: what jobs.ts needs to know to count, fail and requeue them ---------- */

type Kind = {
  kind: JobKind;
  /** The jobs running now (at most one in all kinds) with the time they started. */
  work: string;
  /** How many wait, and how many wait for one site. */
  queued: string; queuedForSite: string;
  /** Marks one job failed: (message, now, id). */
  fail: string;
  /** The ids of this kind's jobs that wait or run. Any other job is over, however it ended. */
  open: string;
};
const KINDS: Kind[] = [
  { kind: 'seo-task', work: "SELECT id, started_at AS at FROM seo_tasks WHERE status = 'work'",
    queued: "SELECT COUNT(*) AS n FROM seo_tasks WHERE status = 'queued'", queuedForSite: "SELECT COUNT(*) AS n FROM seo_tasks WHERE status = 'queued' AND site_id = ?",
    fail: "UPDATE seo_tasks SET status = 'failed', error = ?1, finished_at = ?2 WHERE id = ?3 AND status = 'work'",
    open: "SELECT id FROM seo_tasks WHERE status IN ('queued', 'work')" },
  { kind: 'request', work: `SELECT id, started_at AS at FROM requests WHERE status = 'work'`,
    queued: `SELECT COUNT(*) AS n FROM requests WHERE status = 'queued'`, queuedForSite: `SELECT COUNT(*) AS n FROM requests WHERE status = 'queued' AND site_id = ?`,
    fail: `UPDATE requests SET status = 'failed', step = '', error = ?1, finished_at = ?2 WHERE id = ?3 AND status = 'work'`,
    open: `SELECT id FROM requests WHERE status IN ('queued', 'work')` },
  { kind: 'article', work: `SELECT id, started_at AS at FROM articles WHERE status = 'work'`,
    queued: `SELECT COUNT(*) AS n FROM articles WHERE status IN ('queued', 'revision')`, queuedForSite: `SELECT COUNT(*) AS n FROM articles WHERE status IN ('queued', 'revision') AND site_id = ?`,
    fail: `UPDATE articles SET status = 'failed', step = '', error = ?1, finished_at = ?2 WHERE id = ?3 AND status = 'work'`,
    open: `SELECT id FROM articles WHERE status IN ('queued', 'revision', 'work')` },
  { kind: 'photos', work: `SELECT id, photos_started_at AS at FROM articles WHERE photos_status = 'work'`,
    queued: `SELECT COUNT(*) AS n FROM articles WHERE photos_status = 'queued'`, queuedForSite: `SELECT COUNT(*) AS n FROM articles WHERE photos_status = 'queued' AND site_id = ?`,
    fail: `UPDATE articles SET photos_status = 'failed', photos_step = '', photos_error = ?1, photos_finished_at = ?2 WHERE id = ?3 AND photos_status = 'work'`,
    open: `SELECT id FROM articles WHERE photos_status IN ('queued', 'work')` },
  { kind: 'build', work: `SELECT id, started_at AS at FROM site_builds WHERE status = 'work'`,
    queued: `SELECT COUNT(*) AS n FROM site_builds WHERE status = 'queued'`, queuedForSite: `SELECT COUNT(*) AS n FROM site_builds WHERE status = 'queued' AND site_id = ?`,
    fail: `UPDATE site_builds SET status = 'failed', step = '', error = ?1, finished_at = ?2, updated_at = ?2 WHERE id = ?3 AND status = 'work'`,
    open: `SELECT id FROM site_builds WHERE status IN ('queued', 'work')` },
  { kind: 'deploy', work: `SELECT id, updated_at AS at FROM site_builds WHERE deploy = 'work'`,
    queued: `SELECT COUNT(*) AS n FROM site_builds WHERE deploy = 'queued'`, queuedForSite: `SELECT COUNT(*) AS n FROM site_builds WHERE deploy = 'queued' AND site_id = ?`,
    fail: `UPDATE site_builds SET deploy = 'failed', deploy_step = '', deploy_error = ?1, updated_at = ?2 WHERE id = ?3 AND deploy = 'work'`,
    open: `SELECT id FROM site_builds WHERE deploy IN ('queued', 'work')` },
];
const stmts = KINDS.map(k => ({ kind: k.kind, work: db.prepare(k.work), queued: db.prepare(k.queued), queuedForSite: db.prepare(k.queuedForSite), fail: db.prepare(k.fail),
  forget: db.prepare(`DELETE FROM job_attempts WHERE kind = '${k.kind}' AND job_id NOT IN (${k.open})`) }));
type Running = { kind: JobKind; id: number; at: number | null };
const working = (): Running[] => stmts.flatMap(k => (k.work.all() as { id: number; at: number | null }[]).map(r => ({ kind: k.kind, id: r.id, at: r.at })));
const count = (row: unknown): number => Number((row as { n: number } | undefined)?.n) || 0;

function failRunning(msg: string): void {
  const now = Date.now();
  for (const j of working()) {
    stmts.find(k => k.kind === j.kind)!.fail.run(msg, now, j.id);
    addStep(j.kind, j.id, msg, now);
  }
}

/* ---------- What the health view and the limits read ---------- */

/** The job running now (kind, id, how long) and how many wait, per kind. For the System card (system-api.ts). */
export function queueSnapshot(): { running: { kind: JobKind; id: number; startedAt: number | null; ageMs: number } | null; queued: Record<JobKind, number>; total: number } {
  const now = Date.now(), w = working()[0];
  const queued = Object.fromEntries(stmts.map(k => [k.kind, count(k.queued.get())])) as Record<JobKind, number>;
  return {
    running: w ? { kind: w.kind, id: w.id, startedAt: w.at, ageMs: w.at ? Math.max(0, now - w.at) : 0 } : null,
    queued, total: Object.values(queued).reduce((a, b) => a + b, 0),
  };
}

/** Every job spends the OpenAI API quota, so the queue is bounded: this many waiting jobs per site and in all. */
export const QUEUE_MAX_PER_SITE = 20;
export const QUEUE_MAX_TOTAL = 50;
/** Why one more job cannot be queued now (for the site, when given), or '' when it can. Answered with HTTP 429. */
export function queueFull(siteId = ''): string {
  if (stmts.reduce((n, k) => n + count(k.queued.get()), 0) >= QUEUE_MAX_TOTAL)
    return `${QUEUE_MAX_TOTAL} jobs are already waiting. Let the agents finish some of them, then try again.`;
  if (siteId && stmts.reduce((n, k) => n + count(k.queuedForSite.get(siteId)), 0) >= QUEUE_MAX_PER_SITE)
    return `${QUEUE_MAX_PER_SITE} jobs are already waiting for this site. Let the agents finish some of them, then try again.`;
  return '';
}

/* ---------- Start and stop ---------- */

const qt = {
  bump: db.prepare(`INSERT INTO job_attempts (kind, job_id, attempts) VALUES (?, ?, 1)
    ON CONFLICT (kind, job_id) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`),
};
/** A job that is over (finished, failed, decided) starts from zero if a person runs it again. */
const forgetFinished = (): void => { for (const k of stmts) k.forget.run(); };
/** A job found mid-run this many starts in a row is failed instead of run again. */
export const MAX_RECOVERIES = 2;
export const TWICE = 'Stopped after the server restarted twice while this job was running. Try it again when you are ready.';

/**
 * At start: jobs that were mid-run when the server stopped without warning go back to the queue, once. A job found
 * mid-run a second time most likely is what stopped the server, so it fails with a message instead.
 */
export function recover() {
  try {
    const stale = working(), now = Date.now();
    const counts = stale.map(j => ({ j, attempts: Number((qt.bump.get(j.kind, j.id) as { attempts: number }).attempts) }));
    for (const { j, attempts } of counts) {
      if (attempts < MAX_RECOVERIES) continue;
      stmts.find(k => k.kind === j.kind)!.fail.run(TWICE, now, j.id);
      addStep(j.kind, j.id, TWICE, now);
    }
    q.requeueStale.run(); qa.requeueStale.run(); recovers.forEach(r => r());
    forgetFinished();
  } catch (e) { say('Jobs that were running before the restart could not be put back in the queue:', e); }
  kick();
}

/** What a job put back by an orderly stop says in its run history. */
export const STOPPED = 'Server stopped. This job is back in the queue and starts again when Meridian is running.';

/**
 * The server is stopping: nothing new starts, the network request of the running job is aborted (the returned promise
 * resolves when it is gone), and requeueRunning() then puts the job back. The job's own handler never sees the
 * end of its run, so it records no failure.
 */
export function shutdown(): Promise<void> {
  stopping = true;
  return stopEngine();
}
/** Puts the job that was running back in the queue with a step that says why. Called once, right before the exit. */
export function requeueRunning(): number {
  const stale = working(), now = Date.now();
  for (const j of stale) addStep(j.kind, j.id, STOPPED, now);
  /* An orderly stop is not the job's fault: nothing is counted towards MAX_RECOVERIES. */
  q.requeueStale.run(); qa.requeueStale.run(); recovers.forEach(r => r());
  return stale.length;
}

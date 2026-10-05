// Keyword research requests: how they are shown, run by the job queue, and retried; and the search volume of their
// keywords, fetched from DataForSEO after the agent's result when that service is connected (dataforseo.ts).
import { db, q, type KeywordRow, type RequestRow } from './db.ts';
import { cleanKeyword, dfsReady, searchVolumes, type Volume } from './dataforseo.ts';
import { runKeywordJob } from './engine.ts';
import { bus, freshEngine } from './events.ts';
import type { QueuedJob } from './jobs.ts';
import { budgetHeld, firstAllowed, metered, recordRun, type Usage } from './ledger.ts';
import { ServiceError } from './net.ts';
import { addStep, startSteps, stepsOf } from './steps.ts';
import { siteInfo, type SiteInfo } from './workspace.ts';

/** A keyword row with the columns added for volumes and rank tracking (schema.ts). */
export type KeywordFull = KeywordRow & { volume: number | null; competition: string; volume_at: number | null; track: number };

export function viewRequest(r: RequestRow) {
  const keywords = r.status === 'done' ? (q.keywordsFor.all(r.id) as KeywordFull[]) : [];
  return {
    id: r.id, siteId: r.site_id, domain: r.domain, country: r.country, lang: r.lang, topic: r.topic, goal: r.goal, status: r.status, engine: r.engine,
    requestedBy: r.requested_by, retriedBy: r.retried_by,
    step: r.step, summary: r.summary, notes: r.notes, error: r.error, tokens: r.tokens, costUsd: r.cost_usd,
    createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at,
    /* `volume` is null when DataForSEO has no figure for the keyword; `volumeAt` is null when it was never asked. */
    keywords: keywords.map(k => ({
      id: k.id, keyword: k.keyword, meaning: k.meaning, intent: k.intent, cluster: k.cluster, basis: k.basis,
      volume: k.volume ?? null, competition: k.competition ?? '', volumeAt: k.volume_at ?? null, track: !!k.track,
    })),
    steps: stepsOf('request', r.id),
  };
}
export type RequestView = ReturnType<typeof viewRequest>;
/* Its own statements: a failed run records what it used (0 when the API never answered) instead of keeping the
   figures of the run before it, and the queue is read whole so a site without budget does not hold up the others. */
const failed = db.prepare(`UPDATE requests SET status = 'failed', step = '', error = ?, tokens = ?, cost_usd = ?, finished_at = ? WHERE id = ?`);
const waiting = db.prepare(`SELECT * FROM requests WHERE status = 'queued' ORDER BY id ASC LIMIT 100`);
const qv = {
  volume: db.prepare('UPDATE keywords SET volume = ?, competition = ?, volume_at = ? WHERE id = ?'),
  track: db.prepare('UPDATE keywords SET track = ? WHERE id = ?'),
  keyword: db.prepare('SELECT * FROM keywords WHERE id = ?'),
};
const emit = (id: number) => { const r = q.getRequest.get(id) as RequestRow | undefined; if (r) bus.emit('request', viewRequest(r)); };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------- Search volume ---------- */

type Volumes = { at: number; volumes: Map<string, Volume>; found: number; sent: number; cost: number };

/**
 * Asks DataForSEO for the volumes of a request's keywords, in one batch, for the site's country and language (the
 * saved site's; the request's own when the site is gone). The cost DataForSEO states is written to the spend ledger
 * as a run of the Keyword agent that used no tokens. Throws a ServiceError with a message fit to show.
 */
async function volumesOf(r: RequestRow, keywords: string[]): Promise<Volumes> {
  const site = siteInfo(r.site_id), startedAt = Date.now();
  const res = await searchVolumes({ cc: site?.cc ?? '', country: site?.country || r.country, lang: site?.lang || r.lang }, keywords);
  const at = Date.now();
  if (res.sent) recordRun({ kind: 'request', jobId: r.id, siteId: r.site_id, agent: 'Keyword', model: 'DataForSEO search volume', startedAt, endedAt: at, tokens: 0, costUsd: res.cost, outcome: 'ok' });
  return { at, volumes: res.volumes, found: [...res.volumes.values()].filter(v => v.volume !== null).length, sent: res.sent, cost: res.cost };
}
/** Writes the volumes to the request's keyword rows: every keyword was asked for, so each gets the time. */
function saveVolumes(requestId: number, v: Volumes): void {
  for (const k of q.keywordsFor.all(requestId) as KeywordFull[]) {
    const hit = v.volumes.get(cleanKeyword(k.keyword) ?? '');
    qv.volume.run(hit?.volume ?? null, hit?.competition ?? '', v.at, k.id);
  }
}
const volumeNote = (v: Volumes): string =>
  `Search volume is Google Ads data from DataForSEO for ${plural(v.sent, 'keyword')}${v.found < v.sent ? `; ${v.found ? `only ${v.found} ${v.found === 1 ? 'has' : 'have'}` : 'none has'} a figure` : ''}.`;

/**
 * "Refresh volumes" on a finished request. Resolves to the request as it is now, or to why it could not be done
 * (with the HTTP status to answer). The site's daily budget is a stop here as for any paid job.
 */
export async function refreshVolumes(id: number): Promise<{ ok: true; request: RequestView; found: number; sent: number } | { ok: false; status: number; error: string }> {
  const r = q.getRequest.get(id) as RequestRow | undefined;
  if (!r) return { ok: false, status: 404, error: 'Not found.' };
  if (r.status !== 'done') return { ok: false, status: 409, error: 'Volumes can be refreshed once the research is finished.' };
  if (!dfsReady()) return { ok: false, status: 409, error: 'Connect DataForSEO in Integrations to see search volume.' };
  const keywords = (q.keywordsFor.all(id) as KeywordFull[]).map(k => k.keyword);
  if (!keywords.length) return { ok: false, status: 409, error: 'This research has no keywords.' };
  try {
    const v = await volumesOf(r, keywords);
    /* The request may have been queued again meanwhile: its keywords are gone, and the new run fetches its own. */
    if ((q.getRequest.get(id) as RequestRow | undefined)?.status !== 'done') return { ok: false, status: 409, error: 'The research is running again; its new result gets volumes by itself.' };
    saveVolumes(id, v);
    addStep('request', id, `Refreshed search volume: ${v.found} of ${plural(v.sent, 'keyword')} have a figure`, v.at);
    emit(id);
    return { ok: true, request: viewRequest(q.getRequest.get(id) as RequestRow), found: v.found, sent: v.sent };
  } catch (e) {
    if (e instanceof ServiceError) return { ok: false, status: e.status === 429 ? 429 : 409, error: e.message };
    throw e;
  }
}

/** Marks a keyword of a finished request as tracked (or not): its position is then followed in Rank (rank.ts). */
export function trackKeyword(keywordId: number, on: boolean): { request: RequestView; keyword: string; siteId: string } | null {
  const k = qv.keyword.get(keywordId) as KeywordFull | undefined;
  const r = k ? q.getRequest.get(k.request_id) as RequestRow | undefined : undefined;
  if (!k || !r || r.status !== 'done') return null;
  qv.track.run(on ? 1 : 0, keywordId);
  emit(r.id);
  bus.emit('insights', { source: 'rank' });
  return { request: viewRequest(r), keyword: k.keyword, siteId: r.site_id };
}

/* ---------- Running ---------- */

async function runRequest(r: RequestRow, signal: AbortSignal): Promise<void> {
  const used: Usage = { tokens: 0, costUsd: 0 };
  try {
    const engine = await freshEngine();
    const now = Date.now();
    q.start.run(engine.ready ? engine.mode : '', 'Starting', now, r.id);
    startSteps('request', r.id, 'Started the request', now);
    emit(r.id);
    const step = (s: string) => { q.step.run(s, r.id); addStep('request', r.id, s); emit(r.id); };
    const result = await metered({ kind: 'request', jobId: r.id, siteId: r.site_id, agent: 'Keyword' }, () => runKeywordJob(r, engine, step, signal), used);
    /* Volumes are an extra: when they cannot be had, the research is still saved and the notes say why. */
    let vol: Volumes | null = null, volNote = '';
    if (dfsReady() && result.keywords.length) {
      if (budgetHeld(r.site_id)) volNote = 'Search volume was not fetched: the site has used its daily budget. Use "Refresh volumes" tomorrow.';
      else {
        step('Fetching search volume from DataForSEO');
        try { vol = await volumesOf(r, result.keywords.map(k => k.keyword)); volNote = volumeNote(vol); }
        catch (e) {
          if (!(e instanceof ServiceError)) throw e;
          volNote = 'Search volume could not be fetched: ' + e.message;
        }
      }
    }
    db.exec('BEGIN');
    try {
      q.deleteKeywords.run(r.id);
      for (const k of result.keywords) q.insertKeyword.run(r.id, r.site_id, k.keyword, k.meaning, k.intent, k.cluster, k.basis);
      if (vol) saveVolumes(r.id, vol);
      const end = Date.now(), n = result.keywords.length;
      addStep('request', r.id, `Saved ${plural(n, 'keyword')}, ${vol ? `${vol.found} with search volume` : 'without volume data'}`, end);
      q.finish.run(result.summary, [result.notes, volNote].filter(Boolean).join(' ').slice(0, 2000), result.tokens, result.costUsd, end, r.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 500), end = Date.now();
    /* The failure is what matters; the step is a nicety. Neither write may throw past here (jobs.ts would then fail
       the job itself), and a busy database must not hide the reason. */
    try { addStep('request', r.id, 'Stopped: ' + msg, end); } catch { /* the error column still says why */ }
    failed.run(msg, used.tokens, used.costUsd, end, r.id);
  } finally {
    try { emit(r.id); } catch { /* the dashboards catch up on their next load */ }
  }
}

/**
 * The oldest queued research request, as a job for the shared queue. Requests keep their place by creation time. One
 * for a site that used its daily budget waits (ledger.ts) and the next site's goes first.
 */
export function nextRequestJob(): QueuedJob | null {
  const r = firstAllowed(waiting.all() as RequestRow[], x => x.site_id);
  return r ? { queuedAt: r.created_at, run: signal => runRequest(r, signal) } : null;
}

/** Queues a finished or failed request again, recording who asked. The caller starts the queue. */
export function retryRequest(id: number, by: string): RequestRow | null {
  const r = q.getRequest.get(id) as RequestRow | undefined;
  if (!r || r.status === 'queued' || r.status === 'work') return null;
  q.deleteKeywords.run(id);
  q.requeue.run(by, id);
  emit(id);
  return r;
}

/* ---------- For the workflow engine (workflows.ts) ---------- */

/**
 * Queues a keyword research request for a saved site, as POST /api/requests does: what the agent is told about the
 * site is the saved site. The caller checks the budget, the queue and duplicates first, and starts the queue (kick).
 */
export function createRequest(site: SiteInfo, topic: string, goal: string, model: string, by: string): RequestRow {
  const info = q.insertRequest.run(site.id, site.domain, site.country, site.lang, site.topic, topic, goal, model, by, Date.now());
  const row = q.getRequest.get(Number(info.lastInsertRowid)) as RequestRow;
  bus.emit('request', viewRequest(row));
  return row;
}

const withdrawQueued = db.prepare(`UPDATE requests SET status = 'failed', step = '', error = ? WHERE id = ? AND status = 'queued'`);
/**
 * Takes a request that has not started out of the queue (its workflow was cancelled). It ends as failed with `why`,
 * without an end time: nothing ran, so no alert is raised, and "Run again" still works. False when it had started.
 */
export function withdrawRequest(id: number, why: string): boolean {
  if (!Number(withdrawQueued.run(why.slice(0, 500), id).changes)) return false;
  emit(id);
  return true;
}

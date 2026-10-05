/* The agents the server's jobs drive (live mode), so the Workspace shows real work moving:

   Keyword            a keyword research request that is running
   Content Writer     an article being written or revised
   Site Builder       a website build that is running, else a photo job (running, or waiting for its turn)
   Deploy & Monitor   a deploy to Cloudflare Pages that is running, else an access check from a site's country

   An agent a person paused keeps its pause (draft.ts driveAgentTo): no job takes it until it is resumed.

   For each it keeps the job's run (which job, when it started, the server's current step), estimates progress from the
   elapsed time, shows a short "Done" or "Failed" moment when the job ends, and records the hand-offs: the page that
   flies from one agent to the next when work passes between them. Like liveApply it is a mutator, called with an immer
   draft (liveApply, and the simulation tick for the progress and the end of the done moment) or with a plain state
   object in tests. It writes only what changed, so a tick with nothing new leaves the store as it was. */
import { driveAgentTo, nextUid, type ServerJob } from './draft';
import { timedSteps } from './liveArticleApply';
import { orchestratorTo } from './liveWorkflows';
import { siteById } from './rules';
import type { Agent, AppState, BuildWire, JobRun, PhotoJobWire, PhotoWire, ServerArticle } from './types';

export type LiveKind = 'research' | 'article' | 'photos' | 'build' | 'deploy' | 'access' | 'workflow' | 'seo-task';

/** The job an agent shows. A new key is a new job: its progress starts again and the previous one has ended. */
export interface LiveRun {
  key: string;
  kind: LiveKind;
  /** The request, article or build id on the server, or the site id of an access check. */
  ref: string;
  /** When it started (ms): the server's time, or when this page first saw it. null while it waits for its turn. */
  at: number | null;
  /** The server's current step, or ''. */
  step: string;
  /** An access check: the time of the site's newest check when this one was first seen. Only a newer check is its result. */
  since?: number;
  /** When this page started showing the run, for the minimum time a job is shown working (MIN_WORK_MS). */
  shown?: number;
  /** The job has ended on the server and is being shown working until MIN_WORK_MS has passed. */
  replay?: boolean;
}

/** A job that just ended: shown for a few seconds ("Done" or "Failed") before the agent rests. */
export interface LiveEnd { ok: boolean; until: number; note: string }

declare module './types' {
  interface Agent {
    /** Live mode: the server job the agent shows. */
    run?: LiveRun | null;
    /** Live mode: the job that just ended, until the agent goes back to resting. */
    ended?: LiveEnd | null;
  }
}

/** Typical length of each kind of job in seconds: progress is an estimate from the time the job has been running. */
export const TYPICAL_S: Readonly<Record<LiveKind, number>> = { research: 60, article: 150, photos: 60, build: 20, deploy: 40, access: 20, workflow: 300, 'seo-task': 90 };
/** Progress never passes this until the server says the job is done. */
export const PROGRESS_CAP = 92;
/** How long a finished job shows as "Done" (or "Failed"). */
export const DONE_MS = 4000;
/**
 * A job that ends sooner than this after the page first showed it (a rebuild takes a fraction of a second) stays at its
 * desk until then, going through the steps the server recorded for it, so a person can see the work happen. Only the
 * pace is changed: the steps and the outcome are the server's.
 */
export const MIN_WORK_MS = 3500;
/** Where a page goes when work waits for a person: the Office's meeting room, or the Needs approval column. */
export const MEET = '@meet';
/** A hand-off older than this when this page first sees it is not flown (reconnecting does not replay old work). */
const FRESH_MS = 120_000;
/** A photo job queued this close to the end of the writing was queued by it, so the Content Writer handed it over. */
const AUTO_PHOTOS_MS = 60_000;
/** The agents the server drives. */
const DRIVEN = ['kw', 'wr', 'bld', 'dep', 'res', 'arc', 'seo', 'lnk', 'ana', 'gd'] as const;
type Driven = typeof DRIVEN[number];

/** An article's photo job and chosen photos (both missing from an older server). */
const photosOf = (a: ServerArticle): PhotoJobWire | undefined => a.photos;
const imagesOf = (a: ServerArticle): PhotoWire[] => a.images ?? [];

type Target = Pick<AppState, 'live' | 'agents' | 'sites' | 'handoff'> & {
  /** Site ids with an access check running (the sites slice; absent from a plain AppState in tests). */
  checking?: readonly string[];
};

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
const builds = (s: Pick<AppState, 'live'>): BuildWire[] => Object.values(s.live.builds ?? {}).sort((x, y) => y.id - x.id);

/** Progress for a job of `kind` that has run `ms`: about three quarters at its typical length, then slower, capped. */
export function estimate(ms: number, kind: LiveKind): number {
  const x = Math.max(0, ms) / (TYPICAL_S[kind] * 1000);
  return Math.min(PROGRESS_CAP, Math.round((4 + 88 * (1 - Math.exp(-1.5 * x))) * 10) / 10);
}

const runKey = {
  research: (id: number, startedAt: number | null) => `research:${id}:${startedAt ?? 0}`,
  article: (id: number, startedAt: number | null) => `article:${id}:${startedAt ?? 0}`,
  photos: (id: number, p: PhotoJobWire) => `photos:${id}:${p.queuedAt ?? 0}`,
  build: (id: number) => `build:${id}`,
  deploy: (id: number) => `deploy:${id}`,
  access: (siteId: string) => `access:${siteId}`,
};

/** The job each driven agent shows now, or null. */
function jobsOf(s: Target, now: number): Record<Driven, ServerJob | null> {
  const agent = (id: Driven): Agent | undefined => s.agents.find(a => a.id === id);
  /* A job without a server start time keeps the time this page first saw it. */
  const seen = (id: Driven, key: string): number => { const r = agent(id)?.run; return agent(id)?.live && r?.key === key && r.at != null ? r.at : now; };
  const arts = Object.values(s.live.arts).sort((x, y) => y.id - x.id), all = builds(s);

  let kw: ServerJob | null = null;
  const r = Object.values(s.live.reqs).sort((x, y) => y.id - x.id).find(x => x.status === 'work');
  if (r) { const key = runKey.research(r.id, r.startedAt); kw = job(r.id, r.siteId, 'Researching keywords: ' + r.topic, 'research', key, r.startedAt ?? seen('kw', key), r.step); }

  let wr: ServerJob | null = null;
  const w = arts.find(x => x.status === 'work');
  if (w) {
    const key = runKey.article(w.id, w.startedAt);
    wr = job(w.id, w.siteId, (w.pendingNote ? 'Revising an article: ' : 'Writing an article: ') + w.keyword, 'article', key, w.startedAt ?? seen('wr', key), w.step);
  }

  /* The Site Builder: a build that is running, else a photo job that is running, else the photo job waiting longest.
     The server only runs a queued photo job while its article is in review or approved (server/photos.ts `next`): one
     of a rejected article never runs, one of an article being revised waits until the revision is written. */
  let bld: ServerJob | null = null;
  const b = all.find(x => x.status === 'work');
  if (b) { const key = runKey.build(b.id); bld = job(b.id, b.siteId, `Building ${b.domain} v${b.version}`, 'build', key, b.startedAt ?? seen('bld', key), b.step); }
  else {
    const pw = arts.find(x => photosOf(x)?.status === 'work');
    const pq = arts.filter(x => photosOf(x)?.status === 'queued' && (x.status === 'review' || x.status === 'approved'))
      .sort((x, y) => (photosOf(x)?.queuedAt ?? 0) - (photosOf(y)?.queuedAt ?? 0))[0];
    const a = pw ?? pq, p = a && photosOf(a);
    if (a && p) {
      const key = runKey.photos(a.id, p);
      bld = job(a.id, a.siteId, 'Choosing photos: ' + a.keyword, 'photos', key, pw ? p.startedAt ?? seen('bld', key) : null, pw ? p.step : p.step || 'Waiting for its turn');
    }
  }

  /* Deploy & Monitor: a deploy that is running, else the first access check running for a site in the store. While a
     deploy runs, the build's `step` is the deploy's own step (server/builds.ts viewBuild). */
  let dep: ServerJob | null = null;
  const d = all.find(x => x.deploy === 'work');
  if (d) { const key = runKey.deploy(d.id); dep = job(d.id, d.siteId, `Deploying ${d.domain} v${d.version}`, 'deploy', key, seen('dep', key), d.step); }
  else {
    const site = (s.checking ?? []).map(id => siteById(s, id)).find(x => !!x);
    if (site) {
      const key = runKey.access(site.id);
      dep = job(0, site.id, `Checking access: ${site.domain} from ${site.country}`, 'access', key, seen('dep', key), '', site.id);
      dep.run.since = s.live.access[site.id]?.at ?? 0;
    }
  }
  const extra: Record<string, ServerJob | null> = {};
  for (const id of ['res', 'arc', 'seo', 'lnk', 'ana', 'gd']) {
    const task = Object.values(s.live.seoTasks ?? {}).sort((a, b) => a.id - b.id).find(t => t.agent === id && t.status === 'work');
    extra[id] = task ? job(task.id, task.siteId, task.brief, 'seo-task', `seo-task:${task.id}`, task.startedAt, 'Preparing a draft result for review') : null;
  }
  return { kw, wr, bld, dep, ...extra } as Record<Driven, ServerJob | null>;
}

function job(id: number, site: string, task: string, kind: LiveKind, key: string, at: number | null, step: string, ref: string = String(id)): ServerJob {
  return { id, site, task, run: { key, kind, ref, at, step } };
}

/** How the run `r` ended, now that the agent no longer shows it; null when it did not end (it was restarted or removed). */
export function outcomeOf(s: Target, r: LiveRun): Omit<LiveEnd, 'until'> | null {
  const failed = (msg: string) => ({ ok: false, note: msg || 'Stopped' });
  switch (r.kind) {
    case 'research': {
      const q = s.live.reqs[Number(r.ref)];
      if (!q || runKey.research(q.id, q.startedAt) !== r.key) return null;
      return q.status === 'done' ? { ok: true, note: 'Proposed ' + plural(q.keywords?.length ?? 0, 'keyword') } : q.status === 'failed' ? failed(q.error) : null;
    }
    case 'article': {
      const a = s.live.arts[Number(r.ref)];
      if (!a || runKey.article(a.id, a.startedAt) !== r.key) return null;
      if (a.status === 'failed') return failed(a.error);
      return a.status === 'review' ? { ok: true, note: 'Sent to Article review' } : a.status === 'approved' || a.status === 'rejected' ? { ok: true, note: 'Finished' } : null;
    }
    case 'photos': {
      const a = s.live.arts[Number(r.ref)], p = a && photosOf(a);
      if (!a || !p || runKey.photos(a.id, p) !== r.key) return null;
      const n = imagesOf(a).length;
      return p.status === 'done' ? { ok: true, note: n ? 'Chose ' + plural(n, 'photo') : 'Found no photo that fits' } : p.status === 'failed' ? failed(p.error) : null;
    }
    case 'build': {
      const b = s.live.builds?.[Number(r.ref)];
      if (!b) return null;
      return b.status === 'ready' ? { ok: true, note: b.review === 'waiting' ? 'Ready for your approval' : 'Ready' } : b.status === 'failed' ? failed(b.error) : null;
    }
    case 'deploy': {
      const b = s.live.builds?.[Number(r.ref)];
      if (!b) return null;
      return b.deploy === 'live' || b.deploy === 'superseded' ? { ok: true, note: 'Live on Cloudflare Pages' } : b.deploy === 'failed' ? failed(b.deployError) : null;
    }
    case 'access': {
      /* Its result is a check stored after it was first seen. None (the server refused to start it): it just rests. */
      if (s.checking?.includes(r.ref)) return null;
      const c = s.live.access[r.ref];
      if (!c || c.at <= (r.since ?? 0)) return null;
      return c.result === 'error' ? failed(c.summary) : { ok: true, note: c.summary || 'Checked' };
    }
    /* The Orchestrator's workflow: liveWorkflows.ts shows how it ended. */
    case 'workflow': return null;
    case 'seo-task': { const t = s.live.seoTasks?.[Number(r.ref)]; return t?.status === 'done' ? { ok: true, note: 'Draft result ready for review' } : t?.status === 'failed' ? failed(t.error) : null; }
  }
}

/** The step to show while a quick job is replayed: the server's recorded steps of that job, in order, over MIN_WORK_MS. */
function replayStep(s: Target, r: LiveRun, now: number): string {
  const b = r.kind === 'build' ? s.live.builds?.[Number(r.ref)] : undefined;
  const steps = (b?.steps ?? []).filter(x => !b?.finishedAt || x.at <= b.finishedAt).map(x => x.text);
  if (!steps.length) return r.step;
  const i = Math.min(steps.length - 1, Math.floor(((now - (r.shown ?? now)) / MIN_WORK_MS) * steps.length));
  return steps[i] ?? r.step;
}

/** The done moment is over (or the agent was paused meanwhile): it rests. */
function rest(a: Agent): void {
  const idle = a.status === 'idle';
  a.ended = null;
  if (idle) { a.progress = 0; a.task = 'Waiting for a task'; }
}

/**
 * Puts the server's jobs on their agents: a job that starts takes its agent (progress starts again), one that ends
 * shows "Done" or "Failed" for DONE_MS, then the agent rests (and walks to the break room in the Office). Records
 * the hand-offs that happened since the last call.
 */
export function liveAgentsTo(s: Target, now: number = Date.now()): void {
  const jobs = jobsOf(s, now);
  for (const id of DRIVEN) {
    const a = s.agents.find(x => x.id === id), next = jobs[id];
    if (!a) continue;
    const prev = a.live ? a.run : null;
    /* Straight on to another job: no done moment in between. */
    const end = prev && !next ? outcomeOf(s, prev) : null;
    /* A job that ended too quickly to be seen stays on its desk a little longer, replaying its real steps. */
    /* Only a job that was itself quick (its start, on the server's clock, is recent) — not a long one this page happened
       to open near its end. */
    const quick = (t: number | null | undefined) => t != null && now >= t && now - t < MIN_WORK_MS;
    if (prev && end && a.status === 'work' && quick(prev.shown) && (prev.at == null || quick(prev.at))) {
      driveAgentTo(s, id, { id: a.liveReq ?? 0, site: a.site ?? '', task: a.task, run: { ...prev, step: replayStep(s, prev, now) } });
      if (a.run) a.run.replay = true;
      continue;
    }
    const fresh = next && (!prev || prev.key !== next.run.key);
    driveAgentTo(s, id, next ? { ...next, run: { ...next.run, shown: fresh ? now : prev?.shown ?? now } } : null, end && { ...end, until: now + DONE_MS });
  }
  /* The Orchestrator shows the running workflow and what it waits for (liveWorkflows.ts). */
  orchestratorTo(s, now);
  for (const a of s.agents) if (a.ended && (a.status !== 'idle' || now >= a.ended.until)) rest(a);
  handoffsTo(s, now);
}

/**
 * The simulation tick outside demo mode: picks up access checks that started or ended (they do not come through
 * liveApply), ends done moments, and moves the progress of each running job by the time it has run. A running agent
 * without a run (from before runs were recorded) keeps the old slow pace: half a percent per tick.
 */
export function liveTickTo(s: Target, now: number): void {
  if (s.live.on && s.live.ready) liveAgentsTo(s, now);
  else for (const a of s.agents) if (a.ended && now >= a.ended.until) rest(a);
  for (const a of s.agents) if (a.live && a.status !== 'off') liveProgress(a, now);
}

/** One tick of progress for an agent the server drives. A job waiting for its turn does not move. */
export function liveProgress(a: Agent, now: number): void {
  const r = a.run;
  if (!r) { a.progress = Math.min(PROGRESS_CAP, a.progress + 0.5); return; }
  if (r.at == null) return;
  const p = estimate(now - r.at, r.kind);
  if (p > a.progress) a.progress = p;
}

/* ---------- Hand-offs ---------- */

interface Flight { key: string; at: number | null; from: string; to: string }

/** Hand-offs that are facts of the server's state, each with a stable key and the time it happened. */
function flightsOf(s: Target): Flight[] {
  const out: Flight[] = [];
  for (const a of Object.values(s.live.arts)) {
    /* An article asked for from a keyword the research found: the Keyword agent hands it to the Content Writer. */
    if (a.requestId != null) out.push({ key: `h:kw:${a.id}`, at: a.history.find(e => e.action === 'requested')?.at ?? a.createdAt, from: 'kw', to: 'wr' });
    /* A reviewer's note goes back to the Content Writer. */
    for (const e of a.history) if (e.action === 'revision') out.push({ key: `h:rv:${a.id}:${e.at}`, at: e.at, from: MEET, to: 'wr' });
    const p = photosOf(a);
    /* The written article goes to the Site Builder for photos; with its photos it goes to the person who reviews it. */
    if (p?.queuedAt && a.finishedAt && Math.abs(p.queuedAt - a.finishedAt) <= AUTO_PHOTOS_MS) out.push({ key: `h:ph:${a.id}:${p.queuedAt}`, at: p.queuedAt, from: 'wr', to: 'bld' });
    if (p?.status === 'done' && p.finishedAt && a.status === 'review') out.push({ key: `h:pd:${a.id}:${p.finishedAt}`, at: p.finishedAt, from: 'bld', to: MEET });
  }
  /* A built website waits for a person's approval. */
  for (const b of builds(s)) if (b.status === 'ready' && b.review === 'waiting') out.push({ key: `h:br:${b.id}`, at: b.finishedAt, from: 'bld', to: MEET });
  return out;
}

/**
 * Adds a hand-off for each one that happened since the last call (store.handoff: the Office flies a page for each pair).
 * Keys of hand-offs already seen are kept in live.logged. The first time the server's state is applied (live.ready
 * false) everything is only recorded: opening the page does not replay earlier work.
 */
export function handoffsTo(s: Target, now: number): void {
  const seen = new Set(s.live.logged), pairs: { from: string; to: string }[] = [];
  const known = (id: string) => id === MEET || s.agents.some(a => a.id === id);
  /* A page leaves an agent only after its job is seen to end (not while a quick job is still shown working). */
  const busy = (id: string) => !!s.agents.find(a => a.id === id)?.run?.replay;
  const fly = (f: Flight) => {
    if (seen.has(f.key) || busy(f.from)) return;
    seen.add(f.key); s.live.logged.push(f.key);
    if (s.live.ready && (f.at == null || now - f.at <= FRESH_MS) && known(f.from) && known(f.to)) pairs.push({ from: f.from, to: f.to });
  };
  flightsOf(s).forEach(fly);
  /* An approved build goes to Deploy & Monitor each time a deploy of it is queued (a retry or a roll-back too). The key
     lives while the deploy is queued or running, so the next attempt flies again. */
  for (const b of builds(s)) {
    const key = `h:dq:${b.id}`;
    if (b.deploy === 'queued' || b.deploy === 'work') fly({ key, at: null, from: 'bld', to: 'dep' });
    else if (seen.has(key)) { seen.delete(key); s.live.logged.splice(s.live.logged.indexOf(key), 1); }
  }
  if (pairs.length) s.handoff = { seq: s.handoff.seq + 1, pairs };
}

/* ---------- Run history ---------- */

/** Writes each finished or failed photo job and website build to Run history once, under the Site Builder. */
export function logBuilderRunsTo(s: Pick<AppState, 'live' | 'agents' | 'jobLog' | 'uid'>): void {
  const a = s.agents.find(x => x.id === 'bld'), agent = a?.name ?? 'Site Builder', hue = a?.hue ?? 0;
  const runs: JobRun[] = [];
  const once = (key: string): boolean => { if (s.live.logged.includes(key)) return false; s.live.logged.push(key); return true; };
  const dur = (from: number | null, to: number) => from ? Math.max(0, Math.round((to - from) / 1000)) : 0;
  for (const x of Object.values(s.live.arts).sort((p, q) => p.id - q.id)) {
    const p = photosOf(x);
    if (!p?.finishedAt || (p.status !== 'done' && p.status !== 'failed') || !once('p' + x.id + ':' + p.finishedAt)) continue;
    const ok = p.status === 'done', n = imagesOf(x).length;
    runs.push({
      id: nextUid(s), t: new Date(p.finishedAt), agent, hue, task: 'Choosing photos: ' + x.keyword, site: x.siteId, domain: x.domain,
      dur: dur(p.startedAt, p.finishedAt), engine: p.engine, tokens: p.tokens, cost: p.costUsd, status: ok ? 'Done' : 'Failed',
      steps: ok
        ? ['Read the article: ' + x.keyword, 'Searched Wikimedia Commons for openly licensed photos', n ? 'Chose ' + plural(n, 'photo') + ' and wrote their alt text and captions' : 'Found no photo that fits the article']
        : ['Started choosing photos', 'Stopped: ' + (p.error || 'no reason given')],
    });
  }
  for (const b of builds(s).reverse()) {
    const end = b.finishedAt;
    if (!end || (b.status !== 'ready' && b.status !== 'failed') || !once('b' + b.id + ':' + end)) continue;
    const ok = b.status === 'ready';
    /* The server lists the build's steps, then its deploys' (server/builds.ts viewBuild): a deploy runs after the build
       ended, so the build's own steps are the ones up to its end. */
    const own = b.steps.filter(x => x.at <= end);
    runs.push({
      id: nextUid(s), t: new Date(end), agent, hue, task: `Building ${b.domain} v${b.version}`, site: b.siteId, domain: b.domain,
      dur: dur(b.startedAt, end), engine: b.engine, tokens: b.tokens, cost: b.costUsd, status: ok ? 'Done' : 'Failed', ...(b.by ? { by: b.by } : {}),
      ...(timedSteps(own, b.startedAt) ?? {
        steps: ok ? ['Placed ' + plural(b.articles.length, 'approved article'), 'Wrote ' + plural(b.pages, 'page') + ', the sitemap and robots.txt', 'Checked links, images and markup'] : ['Started the build', 'Stopped: ' + (b.error || 'no reason given')],
      }),
    });
  }
  if (!runs.length) return;
  s.jobLog.unshift(...runs);
  s.jobLog.sort((x, y) => y.t.getTime() - x.t.getTime());
}

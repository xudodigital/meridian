/* Rebuilds everything the store derives from the server's research requests, articles and website builds: the
   prototype's liveApply(). A mutator like the ones in draft.ts: it is called with an immer draft (live.ts, the content
   slice, and store.ts when the data mode changes) or with a plain state object in tests. */
import { nextUid } from './draft';
import { liveAgentsTo, logBuilderRunsTo } from './liveAgents';
import { applyArticles, timedSteps } from './liveArticleApply';
import { liveNotifsTo } from './liveNotifs';
import type { AppState, KeywordOut, KwRequest, ServerArticle } from './types';

export type LiveTarget = Pick<AppState, 'live' | 'kwReqs' | 'mod' | 'agents' | 'sites' | 'jobLog' | 'notifs' | 'notifRead' | 'np' | 'uid' | 'articles' | 'handoff'> & {
  /** Site ids with an access check running (the sites slice): Deploy & Monitor shows one. */
  checking?: readonly string[];
};

/**
 * Applies the server's requests, articles (with their photo jobs) and website builds: the derived lists, Run history,
 * the agents the jobs drive with their hand-offs (liveAgents.ts) and the notifications. `now` is for tests.
 */
export function liveApply(s: LiveTarget, now: number = Date.now()): void {
  applyRequests(s);
  applyArticles(s);
  logBuilderRunsTo(s);
  liveAgentsTo(s, now);
  for (const t of Object.values(s.live.seoTasks ?? {})) {
    if (!t.finishedAt || (t.status !== 'done' && t.status !== 'failed')) continue;
    const key = `seo-task:${t.id}:${t.finishedAt}`;
    if (s.live.logged.includes(key)) continue;
    s.live.logged.push(key);
    const a = s.agents.find(a => a.id === t.agent);
    s.jobLog.unshift({ id: nextUid(s), t: new Date(t.finishedAt), agent: a?.name ?? t.agent, hue: a?.hue ?? 0, task: t.kind + ': ' + t.brief, site: t.siteId, domain: t.domain, dur: Math.max(0, (t.finishedAt - (t.startedAt ?? t.createdAt)) / 1000), engine: t.engine, tokens: t.tokens, cost: t.costUsd, status: t.status === 'done' ? 'Done' : 'Failed', ...(timedSteps(t.steps, t.startedAt) ?? { steps: [t.status === 'done' ? 'Saved a draft for human review' : t.error] }) });
    s.jobLog.sort((a, b) => b.t.getTime() - a.t.getTime());
    s.jobLog = s.jobLog.slice(0, 80);
  }

  liveNotifsTo(s);
}

/**
 * One article as the server now has it (the answer to an action, or the event stream). An answer that arrives after
 * the stream already reported a newer change (for example the job starting right after a revision) is dropped.
 */
export function liveArticleTo(s: LiveTarget, a: ServerArticle, now: number = Date.now()): void {
  const known = s.live.arts[a.id];
  if (known && known.updatedAt > a.updatedAt) return;
  s.live.arts[a.id] = a;
  liveApply(s, now);
}

/**
 * The Volume cell of a keyword: the monthly searches DataForSEO gave, "—" when it was asked and has no figure, and
 * "n/a" when it was never asked (the table leaves the column out while every row says that).
 */
export const volumeText = (k: Pick<KeywordOut, 'volume' | 'volumeAt'>): string =>
  typeof k.volume === 'number' ? k.volume.toLocaleString('en-US') : k.volumeAt ? '—' : 'n/a';

function applyRequests(s: LiveTarget): void {
  const serverReq = (rid: number | undefined) => rid == null ? undefined : s.live.reqs[rid];
  const list = Object.values(s.live.reqs).sort((x, y) => y.id - x.id);
  s.kwReqs = list.map((r): KwRequest => ({
    id: 'r' + r.id, rid: r.id, site: r.siteId, domain: r.domain, country: r.country, lang: r.lang, topic: r.topic, goal: r.goal, t: new Date(r.createdAt), st: r.status, engine: r.engine, step: r.step,
    summary: r.summary, notes: r.notes, error: r.error, keywords: r.keywords || [], tokens: r.tokens, cost: r.costUsd,
    dur: r.finishedAt && r.startedAt ? Math.round((r.finishedAt - r.startedAt) / 1000) : 0, end: r.finishedAt, by: r.requestedBy || '',
  }));
  /* Keywords from finished requests go on top of the Keywords table, newest request first. */
  const kw = s.mod.keywords; kw.rows = kw.rows.filter(x => !x.live);
  [...s.kwReqs].reverse().forEach(r => {
    if (r.st === 'done') [...(r.keywords || [])].reverse().forEach(k => {
      kw.rows.unshift({ s: r.site, live: true, domain: r.domain, c: [k.keyword, k.meaning, volumeText(k), 'n/a', k.intent, k.cluster] });
    });
  });
  /* The request that is running is shown on the Keyword agent by liveAgents.ts. */
  const a = s.agents.find(x => x.id === 'kw');
  /* Each finished or failed request is written to the job log once (its notification comes from liveNotifs.ts). */
  s.kwReqs.forEach(r => {
    if (r.st !== 'done' && r.st !== 'failed') return;
    const key = r.rid + ':' + r.end; if (s.live.logged.includes(key)) return;
    s.live.logged.push(key);
    const n = (r.keywords || []).length, srv = serverReq(r.rid), by = srv?.retriedBy || r.by;
    /* The steps the server recorded, with their real times; a request from before steps were recorded gets a summary. */
    const timed = timedSteps(srv?.steps, srv?.startedAt ?? null);
    s.jobLog.unshift({
      id: nextUid(s), t: new Date(r.end || Date.now()), agent: 'Keyword', hue: a ? a.hue : 0, task: 'Researching keywords: ' + r.topic, site: r.site, domain: r.domain,
      dur: r.dur || 0, engine: r.engine, tokens: r.tokens || 0, cost: r.cost || 0, status: r.st === 'done' ? 'Done' : 'Failed', ...(by ? { by } : {}),
      ...(timed ? timed : {
        steps: r.st === 'done'
          ? ['Loaded the site profile and the keyword-research skill', 'Read the request: ' + r.topic, r.engine === 'gemma-local' ? 'Ran through Gemma localhost (Ollama)' : r.engine === 'codex-local' ? 'Ran through Codex local' : 'Ran through OpenAI Responses API', 'Proposed ' + n + ' keywords', 'Saved the result']
          : ['Started the request', 'Stopped: ' + r.error],
      }),
    });
    s.jobLog.sort((x, y) => y.t.getTime() - x.t.getTime());
  });
}

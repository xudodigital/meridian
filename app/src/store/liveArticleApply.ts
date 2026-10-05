/* Real articles from the server in the store: the mapping from a server article to the review queue's Article and the
   job log. Called by liveApply(); the Content Writer's `live` flag comes from liveAgents.ts and the notifications from
   liveNotifs.ts. */
import { nextUid } from './draft';
import { dayTime } from './rules';
import type { AppState, Article, ArticleStatus, JobRun, JobStep, ServerArticle } from './types';

type Target = Pick<AppState, 'live' | 'articles' | 'agents' | 'sites' | 'jobLog' | 'uid'>;

/** The review queue's status: a job that is queued or running is "writing", or "revisi" when it answers a reviewer's note. */
function statusOf(a: ServerArticle): ArticleStatus {
  if (a.status === 'queued' || a.status === 'work') return a.pendingNote ? 'revisi' : 'writing';
  if (a.status === 'revision') return 'revisi';
  return a.status;
}

export function toArticle(a: ServerArticle): Article {
  const c = a.content, r = a.languageReview;
  return {
    id: 'a' + a.id, s: a.siteId, title: c?.title || a.keyword, titleEn: c?.titleEn || c?.title || a.keyword, kw: a.keyword, words: 0, rev: a.revision,
    status: statusOf(a), notes: [],
    native: r ? { st: 'done', by: r.by, note: 'Language checked, ' + dayTime(r.at) + '.' } : { st: 'wait' },
    checks: a.checks.map(x => [x.kind, x.name, x.detail]),
    paras: [],
    ...(a.archivedAt ? { archived: true } : {}),
    live: {
      aid: a.id, state: a.status, domain: a.domain, country: a.country, lang: a.lang, engine: a.engine, step: a.step, pendingNote: a.pendingNote,
      content: c, engineNotes: a.notes, history: a.history, error: a.error, t: new Date(a.createdAt),
    },
  };
}

const FINISHED: readonly string[] = ['review', 'approved', 'rejected', 'failed'];
const ASKS: readonly string[] = ['requested', 'revision', 'retried'];

/** The person whose request, revision note or retry started the job that finished at `end`, if the server recorded one. */
export function askedBy(a: Pick<ServerArticle, 'history'>, end: number): string {
  return a.history.filter(e => e.at <= end && ASKS.includes(e.action)).at(-1)?.by ?? '';
}

/**
 * A job's steps as the server recorded them, with each step's start in seconds from the job's start; null when the
 * server recorded none (a job from before steps were recorded).
 */
export function timedSteps(steps: readonly JobStep[] | undefined, startedAt: number | null): Pick<JobRun, 'steps' | 'stepAt'> | null {
  if (!steps?.length) return null;
  const t0 = startedAt ?? steps[0]!.at;
  return { steps: steps.map(x => x.text), stepAt: steps.map(x => Math.max(0, Math.round((x.at - t0) / 1000))) };
}

/** Writes a finished or failed Content Writer job to Run history once. */
function logJob(s: Target, a: ServerArticle, hue: number): void {
  if (!a.finishedAt || !FINISHED.includes(a.status)) return;
  const key = 'a' + a.id + ':' + a.finishedAt; if (s.live.logged.includes(key)) return;
  s.live.logged.push(key);
  const failed = a.status === 'failed';
  /* A finished revision raised the revision number; a failed one still holds the reviewer's note. */
  const revised = failed ? !!a.pendingNote : a.revision > 0;
  const n = a.content?.sources.length ?? 0, by = askedBy(a, a.finishedAt);
  s.jobLog.unshift({
    id: nextUid(s), t: new Date(a.finishedAt), agent: 'Content Writer', hue, site: a.siteId, domain: a.domain,
    task: (revised ? 'Revising an article: ' : 'Writing an article: ') + a.keyword,
    dur: a.startedAt ? Math.round((a.finishedAt - a.startedAt) / 1000) : 0, engine: a.engine, tokens: a.tokens, cost: a.costUsd, status: failed ? 'Failed' : 'Done', ...(by ? { by } : {}),
    ...(timedSteps(a.steps, a.startedAt) ?? {
      steps: failed ? ['Started the article', 'Stopped: ' + a.error] : [
        'Loaded the site profile and the article-writing and google-seo skills',
        revised ? 'Read the previous version and the reviewer\'s note' : 'Read the keyword: ' + a.keyword,
        a.engine === 'codex-local' ? 'Ran through Codex local' : 'Ran through OpenAI Responses API',
        'Cited ' + n + ' source' + (n === 1 ? '' : 's'),
        'Sent the article to Article review',
      ],
    }),
  });
  s.jobLog.sort((x, y) => y.t.getTime() - x.t.getTime());
}

/**
 * Puts the server's articles on top of the review queue (sample articles stay) and writes finished jobs to Run history.
 * The running job is shown on the Content Writer by liveAgents.ts.
 */
export function applyArticles(s: Target): void {
  const list = Object.values(s.live.arts).sort((x, y) => y.id - x.id);
  s.articles = [...list.map(toArticle), ...s.articles.filter(a => !a.live)];
  const hue = s.agents.find(x => x.id === 'wr')?.hue ?? 0;
  [...list].reverse().forEach(a => logJob(s, a, hue));
}

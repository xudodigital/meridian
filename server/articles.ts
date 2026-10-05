// Articles written by the Content Writer: how they are shown, created, run by the job queue and decided by a person.
// Every change is announced on the event bus. The callers start the queue (jobs.ts kick) after a create, revise or retry.
import type { ArticleContent } from './article-content.ts';
import { supportedModel, defaultModel } from './openai-models.ts';
import { articleChecks, type Check, type LanguageReview, type Sibling } from './checks.ts';
import { db, q, qa, type ArticleEventRow, type ArticleRow, type RequestRow } from './db.ts';
import { bus, freshEngine } from './events.ts';
import type { QueuedJob } from './jobs.ts';
import { budgetStop, firstAllowed, metered, type Usage } from './ledger.ts';
import { clusterOf, siteCategories, siteRefs } from './links.ts';
import type { Photo, PhotoJob } from './photos.ts';
import { addStep, startSteps, stepsOf } from './steps.ts';
import { nativeRequired, siteInfo } from './workspace.ts';
import { runArticleJob } from './writer.ts';

const parse = <T>(json: string, fallback: T): T => { try { return json ? JSON.parse(json) as T : fallback; } catch { return fallback; } };
const contentOf = (a: ArticleRow) => parse<ArticleContent | null>(a.content, null);
const reviewOf = (a: ArticleRow): LanguageReview => a.lang_review_by && a.lang_review_at ? { by: a.lang_review_by, at: a.lang_review_at } : null;

/** The photo columns of an article row: the photos the Site Builder placed and its latest photo job (photos.ts). */
export type PhotoCols = {
  photos_engine?: PhotoJob['engine']; images: string; photos_status: PhotoJob['status']; photos_step: string; photos_error: string;
  photos_queued_at: number | null; photos_started_at: number | null; photos_finished_at: number | null; photos_tokens: number; photos_cost: number;
};
/** The photos of an article, hero first. */
export const imagesOf = (a: Partial<PhotoCols>): Photo[] => parse<Photo[]>(a.images ?? '', []);
const photoJobOf = (a: Partial<PhotoCols>): PhotoJob => ({
  engine: a.photos_engine || '',
  status: a.photos_status ?? '', step: a.photos_step ?? '', error: a.photos_error ?? '',
  queuedAt: a.photos_queued_at ?? null, startedAt: a.photos_started_at ?? null, finishedAt: a.photos_finished_at ?? null,
  tokens: a.photos_tokens ?? 0, costUsd: a.photos_cost ?? 0,
});

/** Only a decided or failed article is archived; one that is tried again or sent back to review is in the lists again. */
const ARCHIVABLE = ['approved', 'rejected', 'failed'];

export function viewArticle(a: ArticleRow & Partial<PhotoCols> & { archived_at?: number | null; category?: string }) {
  const events = qa.eventsFor.all(a.id) as ArticleEventRow[];
  /* Every change sets one of these times, so a dashboard can drop an answer that arrives after a newer event. */
  const updatedAt = Math.max(a.created_at, a.queued_at, a.started_at ?? 0, a.finished_at ?? 0, a.lang_review_at ?? 0, ...events.map(e => e.at),
    a.photos_queued_at ?? 0, a.photos_started_at ?? 0, a.photos_finished_at ?? 0);
  return {
    id: a.id, siteId: a.site_id, domain: a.domain, country: a.country, lang: a.lang, keyword: a.keyword, requestId: a.request_id, model: a.model,
    status: a.status, engine: a.engine, step: a.step, revision: a.revision, pendingNote: a.pending_note,
    content: contentOf(a), checks: parse<Check[]>(a.checks, []), notes: a.notes, languageReview: reviewOf(a),
    history: events.map(e => ({ at: e.at, by: e.actor, action: e.action, note: e.note })),
    error: a.error, tokens: a.tokens, costUsd: a.cost_usd, createdAt: a.created_at, startedAt: a.started_at, finishedAt: a.finished_at, updatedAt,
    steps: stepsOf('article', a.id),
    images: imagesOf(a), photos: photoJobOf(a),
    /* When a person archived it (article-edit.ts): the lists hide it, nothing else changes. */
    archivedAt: ARCHIVABLE.includes(a.status) ? a.archived_at ?? null : null,
    /* The site category it belongs to (links.ts); '' for none. */
    category: a.category ?? '',
  };
}
/** How an article is named in the audit log: its English title once written, else its keyword. */
export const articleTitle = (a: ArticleRow): string => { const c = contentOf(a); return c?.titleEn || c?.title || a.keyword; };
export type ArticleView = ReturnType<typeof viewArticle>;

const row = (id: number) => qa.get.get(id) as ArticleRow | undefined;
export const articleRow = row;

const siblingRows = db.prepare(`SELECT id, status, content FROM articles WHERE site_id = ? AND id <> ? AND status IN ('review', 'approved') AND content <> ''`);
/** The titles and slugs of the site's other articles that are in review or approved, for the duplicate checks. */
export function siblingsOf(a: Pick<ArticleRow, 'id' | 'site_id'>): Sibling[] {
  return (siblingRows.all(a.site_id, a.id) as { id: number; status: string; content: string }[]).flatMap(r => {
    const c = parse<ArticleContent | null>(r.content, null);
    return c ? [{ title: c.title, slug: c.slug, id: r.id, status: r.status }] : [];
  });
}
/** The automated checks of a version of an article, measured against the site's other articles. */
export const checksFor = (a: ArticleRow, c: ArticleContent, review: LanguageReview): Check[] => articleChecks(c, a.keyword, review, siblingsOf(a));
const emit = (id: number): ArticleView | null => { const a = row(id); if (!a) return null; const v = viewArticle(a); bus.emit('article', v); return v; };
const event = (id: number, by: string, action: string, note = '') => qa.insertEvent.run(id, Date.now(), by, action, note);
/** Puts a photo job for the article in the shared queue, after whatever was queued before. */
const queuePhotos = db.prepare(`UPDATE articles SET photos_status = 'queued', photos_step = '', photos_error = '', photos_queued_at = ?,
  photos_started_at = NULL, photos_finished_at = NULL WHERE id = ?`);
/* A photo job runs only for an article in review or approved. One still waiting when the article is rejected, or when
   its revision fails, would never run and would keep "Find photos" refused, so it is dropped: no photo job pending.
   A retried article that is written again queues a new one. */
const dropWaitingPhotos = db.prepare(`UPDATE articles SET photos_status = '', photos_step = '', photos_queued_at = NULL
  WHERE id = ? AND photos_status = 'queued'`);

/**
 * What a person sends to ask for an article. Already validated and clipped by the API. The site's domain, country,
 * language and topic are not among it: they go into the agent's prompt, so they come from the saved site.
 */
export type NewArticle = { siteId: string; keyword: string; requestId: number; model: string; by: string };
export const NO_SITE = 'That site is not in Sites (any more). Choose a site that is.';

/** The outcome of an action: the article as it is now, or why it was refused (HTTP status and message). */
export type Outcome = { ok: true; article: ArticleView } | { ok: false; status: number; error: string };
const refuse = (status: number, error: string): Outcome => ({ ok: false, status, error });
const done = (id: number): Outcome => { const article = emit(id); return article ? { ok: true, article } : refuse(404, 'Article not found.'); };

const DUPLICATE = 'An article for this keyword is already queued, being written or waiting for review for that site.';

export function createArticle(n: NewArticle): Outcome {
  if (n.model && !supportedModel(n.model)) return { ok: false, status: 400, error: 'Select a supported OpenAI model.' };
  const site = siteInfo(n.siteId);
  if (!site) return refuse(404, NO_SITE);
  const r = q.getRequest.get(n.requestId) as RequestRow | undefined;
  if (!r || r.site_id !== site.id) return refuse(400, 'The keyword research request was not found.');
  if (r.status !== 'done') return refuse(409, 'That keyword research request has not finished.');
  if (qa.duplicate.get(n.siteId, n.keyword)) return refuse(409, DUPLICATE);
  /* The site's daily budget is a hard stop (ledger.ts): the same for a revision and for trying again, below. */
  const stop = budgetStop(site.id);
  if (stop) return refuse(409, stop);
  const now = Date.now();
  const info = qa.insert.run(site.id, site.domain, site.country, site.lang, site.topic, n.keyword, r.id, n.model || defaultModel('wr'), now, now);
  const id = Number(info.lastInsertRowid);
  event(id, n.by, 'requested');
  return done(id);
}

/** Runs a decision on an article waiting for review. `change` returns how many rows it changed: 0 means it was not waiting. */
function decision(id: number, change: () => number, by: string, action: string, note = ''): Outcome {
  if (!row(id)) return refuse(404, 'Article not found.');
  if (!change()) return refuse(409, 'This article is not waiting for review.');
  event(id, by, action, note);
  return done(id);
}

export const NEEDS_REVIEW = 'This article needs a language review by a native speaker before it can be approved. Mark the language review as done first, or turn the requirement off in Settings.';
export function approveArticle(id: number, by: string): Outcome {
  const a = row(id);
  if (a?.status === 'review' && parse<Check[]>(a.checks, []).some(c => c.kind === 'bad')) return refuse(409, 'An automated check failed, so this article cannot be approved.');
  /* "Require a native-speaker review" in Settings is a rule, not a hint on the screen: the server holds to it. */
  if (a?.status === 'review' && nativeRequired() && !reviewOf(a)) return refuse(409, NEEDS_REVIEW);
  return decision(id, () => Number(qa.decide.run('approved', id).changes), by, 'approved');
}
export function rejectArticle(id: number, by: string, note: string): Outcome {
  return decision(id, () => {
    const n = Number(qa.decide.run('rejected', id).changes);
    if (n) dropWaitingPhotos.run(id);
    return n;
  }, by, 'rejected', note);
}
export function reviseArticle(id: number, by: string, note: string): Outcome {
  const a = row(id), stop = a?.status === 'review' ? budgetStop(a.site_id) : null;
  if (stop) return refuse(409, stop);
  return decision(id, () => Number(qa.revise.run(note, Date.now(), id).changes), by, 'revision', note);
}
/** Records the native-speaker review of the current version and recomputes the checks. */
export function languageReview(id: number, by: string): Outcome {
  const a = row(id), c = a ? contentOf(a) : null, now = Date.now();
  const checks = a && c ? JSON.stringify(checksFor(a, c, { by, at: now })) : '[]';
  return decision(id, () => Number(qa.languageReview.run(by, now, checks, id).changes), by, 'language-review');
}
export function retryArticle(id: number, by: string): Outcome {
  const a = row(id);
  if (!a) return refuse(404, 'Article not found.');
  const stop = a.status === 'failed' ? budgetStop(a.site_id) : null;
  if (stop) return refuse(409, stop);
  if (!Number(qa.retry.run(Date.now(), id).changes)) return refuse(409, 'Only a failed article can be tried again.');
  event(id, by, 'retried');
  return done(id);
}

/* A failed run records what it used (0 when the API never answered), not the figures of the run before it. */
const failedUsage = db.prepare('UPDATE articles SET tokens = ?, cost_usd = ? WHERE id = ?');
const setCategory = db.prepare('UPDATE articles SET category = ? WHERE id = ?');
/* The whole queue, oldest first, so an article of a site without budget left does not hold up the other sites. */
const waitingArticles = db.prepare(`SELECT * FROM articles WHERE status IN ('queued', 'revision') ORDER BY queued_at ASC, id ASC LIMIT 100`);

async function runArticle(a: ArticleRow, signal: AbortSignal): Promise<void> {
  const used: Usage = { tokens: 0, costUsd: 0 };
  try {
    const engine = await freshEngine();
    const now = Date.now();
    qa.start.run(engine.ready ? engine.mode : '', 'Starting', now, a.id);
    startSteps('article', a.id, a.pending_note ? 'Started the revision' : 'Started the article', now);
    emit(a.id);
    /* Every API call of this job goes to the spend ledger, a failed one too. */
    const res = await metered({ kind: 'article', jobId: a.id, siteId: a.site_id, agent: 'Content Writer' },
      () => runArticleJob(a, contentOf(a), engine, step => { qa.step.run(step, a.id); addStep('article', a.id, step); emit(a.id); }, signal,
        /* The site's other articles (to link to), its categories, and the cluster keyword research gave the keyword. */
        { articles: siteRefs(a.site_id, a.id), categories: siteCategories(a.site_id), cluster: clusterOf(a.request_id, a.keyword) }), used);
    const checks = checksFor(a, res.content, null);
    db.exec('BEGIN');
    try {
      const end = Date.now(), n = res.content.sources.length;
      addStep('article', a.id, `Cited ${n} source${n === 1 ? '' : 's'} and sent the article to Article review`, end);
      qa.finish.run(JSON.stringify(res.content), JSON.stringify(checks), res.notes, res.tokens, res.costUsd, end, a.id);
      /* Category: a revision keeps the one the article has (a person may have set it); a first draft takes the
         agent's proposal, else the keyword's research cluster. */
      const had = a.pending_note ? (row(a.id) as { category?: string } | undefined)?.category ?? '' : '';
      setCategory.run(had || res.category || clusterOf(a.request_id, a.keyword, a.site_id), a.id);
      event(a.id, 'Content Writer', 'written');
      /* The Site Builder looks for photos for this version next (photos.ts). It never holds up the review. */
      queuePhotos.run(end, a.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 500), end = Date.now();
    /* As in requests.ts: the failure itself is written even when the step cannot be. */
    try { addStep('article', a.id, 'Stopped: ' + msg, end); } catch { /* the error column still says why */ }
    qa.fail.run(msg, end, a.id);
    failedUsage.run(used.tokens, used.costUsd, a.id);
    dropWaitingPhotos.run(a.id);
    event(a.id, 'Content Writer', 'failed', msg);
  } finally {
    try { emit(a.id); } catch { /* the dashboards catch up on their next load */ }
  }
}

/** The oldest article waiting to be written or revised, as a job for the shared queue. */
export function nextArticleJob(): QueuedJob | null {
  /* One for a site that used its daily budget waits (ledger.ts); the next site's goes first. */
  const a = firstAllowed(waitingArticles.all() as ArticleRow[], x => x.site_id);
  return a ? { queuedAt: a.queued_at, run: signal => runArticle(a, signal) } : null;
}

export const listArticles = () => (qa.list.all() as ArticleRow[]).map(viewArticle);

/* ---------- For the workflow engine (workflows.ts) ---------- */

const withdrawQueued = db.prepare(`UPDATE articles SET status = 'failed', step = '', error = ? WHERE id = ? AND status = 'queued' AND started_at IS NULL`);
/**
 * Takes an article that has not been started out of the queue (its workflow was cancelled). It ends as failed with
 * `why`, without an end time: nothing ran, so no alert is raised, and "Try again" still works. False when the Content
 * Writer had already started it (a revision a person asked for is never withdrawn).
 */
export function withdrawArticle(id: number, by: string, why: string): boolean {
  if (!Number(withdrawQueued.run(why.slice(0, 500), id).changes)) return false;
  event(id, by, 'failed', why);
  emit(id);
  return true;
}

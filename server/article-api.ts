// The article routes of the API. Every write validates and clips its input; who did it comes from the session, and
// each action is written to the audit log by the server.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, mayReview, mayWrite, type Ctx, type Denial } from './access.ts';
import { archiveArticle, editArticle, unapproveArticle } from './article-edit.ts';
import {
  NO_SITE, approveArticle, articleRow, articleTitle, createArticle, languageReview, rejectArticle, retryArticle, reviseArticle, type ArticleView, type Outcome,
} from './articles.ts';
import { q, type RequestRow } from './db.ts';
import { ENGINE_MISSING, engineReady } from './engine.ts';
import { bus } from './events.ts';
import { body, json, note, text } from './http.ts';
import { kick, queueFull } from './jobs.ts';
import { addAudit, siteInfo } from './workspace.ts';

const ACTION = /^\/api\/articles\/(\d+)\/(approve|revise|reject|language-review|retry|unapprove|archive|unarchive)$/;
const CONTENT = /^\/api\/articles\/(\d{1,9})\/content$/;
const BULK = '/api/articles/bulk';
/** How many articles one "Write selected" asks for at most. */
export const BULK_MAX = 10;
/** A whole article in the site's language: far more than the 20,000 bytes other routes take. */
const EDIT_BYTES = 1_000_000;

/** One keyword of a bulk request: the article it started, or why it was not started. */
export type BulkResult = { keyword: string; ok: true; article: ArticleView } | { keyword: string; ok: false; status: number; error: string };

/* The spend ledger says when a site has used its daily budget. It is asked through a path the type-checker does not
   follow, so this file works with and without it; createArticle holds to the budget as well once the ledger is there. */
const LEDGER = './ledger.ts';
async function budgetStop(siteId: string): Promise<string> {
  try {
    const m = await import(LEDGER) as { budgetStop?: (siteId: string) => unknown };
    const r = m.budgetStop?.(siteId);
    if (typeof r === 'string') return r;
    const o = r !== null && typeof r === 'object' ? r as { error?: unknown } : {};
    return typeof o.error === 'string' ? o.error : '';
  } catch { return ''; }
}

/**
 * Handles POST /api/articles, POST /api/articles/bulk, POST /api/articles/:id/<action> and
 * PATCH /api/articles/:id/content. Returns false for any other path.
 */
export async function articleApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const edit = req.method === 'PATCH' ? path.match(CONTENT) : null;
  const m = req.method === 'POST' ? path.match(ACTION) : null;
  if (!edit && !m && !(req.method === 'POST' && (path === '/api/articles' || path === BULK))) return false;
  const refuse = (d: Denial) => { json(res, d.status, { error: d.error }); return true; };
  const by = ctx.user.name;
  const audit = (id: number, act: (title: string) => string) => {
    const row = articleRow(id);
    if (row) bus.emit('audit', addAudit(actorOf(ctx), act(articleTitle(row)), row.site_id));
  };
  /* Audit entry in the words the app uses for the same action. */
  const answer = (o: Outcome, act: (title: string) => string, created = false) => {
    if (!o.ok) { json(res, o.status, { error: o.error }); return true; }
    audit(o.article.id, act);
    json(res, created ? 201 : 200, { article: o.article });
    return true;
  };
  const tooMany = (siteId: string) => { const full = queueFull(siteId); if (full) json(res, 429, { error: full }); return !!full; };
  const noEngine = async () => { if (await engineReady()) return false; json(res, 503, { error: ENGINE_MISSING }); return true; };
  const b = await body(req, edit ? EDIT_BYTES : undefined);

  if (edit) {
    const id = Number(edit[1]), a = articleRow(id);
    if (!a) { json(res, 404, { error: 'Article not found.' }); return true; }
    const no = mayWrite(ctx.user);
    if (no) return refuse(no);
    /* The text and the category (a column of its own) are what an edit can change. */
    const state = (r: typeof a | undefined) => r ? r.content + '\0' + ((r as { category?: string }).category ?? '') : '';
    const before = state(a), o = editArticle(id, by, b);
    /* Saving without a change is answered with the article as it is and leaves no trace. */
    if (o.ok && state(articleRow(id)) === before) { json(res, 200, { article: o.article }); return true; }
    return answer(o, t => 'Edited the article: ' + t);
  }

  if (path === BULK) {
    const no = mayWrite(ctx.user);
    if (no) return refuse(no);
    const requestId = Number(b.requestId);
    const r = Number.isSafeInteger(requestId) && requestId > 0 ? q.getRequest.get(requestId) as RequestRow | undefined : undefined;
    if (!r) { json(res, 400, { error: 'The keyword research request was not found.' }); return true; }
    /* One article per keyword, however often it was sent. */
    const keywords: string[] = [];
    for (const k of Array.isArray(b.keywords) ? b.keywords : []) {
      const kw = text(k, 120);
      if (kw && !keywords.some(x => x.toLowerCase() === kw.toLowerCase())) keywords.push(kw);
    }
    if (!keywords.length) { json(res, 400, { error: 'Choose at least one keyword.' }); return true; }
    if (keywords.length > BULK_MAX) { json(res, 400, { error: `Choose at most ${BULK_MAX} keywords at a time.` }); return true; }
    if (!siteInfo(r.site_id)) { json(res, 404, { error: NO_SITE }); return true; }
    if (await noEngine()) return true;
    const model = text(b.model, 60), results: BulkResult[] = [];
    for (const keyword of keywords) {
      /* Asked again for every keyword: the articles queued a moment ago count towards the limits. */
      const stop = await budgetStop(r.site_id), full = stop ? '' : queueFull(r.site_id);
      if (stop || full) { results.push({ keyword, ok: false, status: stop ? 409 : 429, error: stop || full }); continue; }
      const o = createArticle({ siteId: r.site_id, keyword, requestId: r.id, by, model });
      if (o.ok) { audit(o.article.id, () => 'Requested an article: ' + keyword); results.push({ keyword, ok: true, article: o.article }); }
      else results.push({ keyword, ok: false, status: o.status, error: o.error });
    }
    const created = results.filter(x => x.ok).length;
    if (created) kick();
    json(res, created ? 201 : 200, { results, created });
    return true;
  }

  if (!m) {
    const no = mayWrite(ctx.user);
    if (no) return refuse(no);
    /* The body names the site; what the agent is told about it (domain, country, language, topic) is the saved site. */
    const keyword = text(b.keyword, 120), siteId = text(b.siteId, 64), requestId = Number(b.requestId);
    if (!keyword) { json(res, 400, { error: 'Choose a keyword.' }); return true; }
    if (!siteId) { json(res, 400, { error: 'Choose a site.' }); return true; }
    if (!siteInfo(siteId)) { json(res, 404, { error: NO_SITE }); return true; }
    if (!Number.isSafeInteger(requestId) || requestId < 1) { json(res, 400, { error: 'The keyword research request was not found.' }); return true; }
    if (await noEngine()) return true;
    if (tooMany(siteId)) return true;
    const o = createArticle({ siteId, keyword, requestId, by, model: text(b.model, 60) });
    if (o.ok) kick();
    return answer(o, () => 'Requested an article: ' + keyword, true);
  }

  const id = Number(m[1]), action = m[2]!;
  const a = articleRow(id);
  if (!a) { json(res, 404, { error: 'Article not found.' }); return true; }
  const no = action === 'revise' || action === 'language-review' ? mayReview(ctx.user, a.site_id) : mayWrite(ctx.user);
  if (no) return refuse(no);

  switch (action) {
    case 'approve': return answer(approveArticle(id, by), t => 'Approved (not published): ' + t);
    case 'reject': return answer(rejectArticle(id, by, note(b.note, 2000)), t => 'Rejected the article: ' + t);
    case 'language-review': return answer(languageReview(id, by), t => 'Finished the language review: ' + t);
    case 'unapprove': return answer(unapproveArticle(id, by), t => 'Sent back to review: ' + t);
    case 'archive': return answer(archiveArticle(id, by, true), t => 'Archived the article: ' + t);
    case 'unarchive': return answer(archiveArticle(id, by, false), t => 'Took the article out of the archive: ' + t);
    case 'revise': {
      const n = note(b.note, 2000);
      if (!n) { json(res, 400, { error: 'Write a revision note first, so the agent knows what to change.' }); return true; }
      if (a.status === 'review' && (await noEngine() || tooMany(a.site_id))) return true;
      const o = reviseArticle(id, by, n);
      if (o.ok) kick();
      return answer(o, t => 'Requested a revision: ' + t);
    }
    default: {
      if (a.status === 'failed' && (await noEngine() || tooMany(a.site_id))) return true;
      const o = retryArticle(id, by);
      if (o.ok) kick();
      return answer(o, t => 'Asked the Content Writer to try again: ' + t);
    }
  }
}

// The routes of the internal links and categories of a site: its link graph (links.ts) and the two things a person
// does to categories from the Architecture tab: rename one (which merges it into another when that name is taken) and
// put one article in another category. A category is a column of the article, not part of its text, so neither needs
// the article sent back to review; the next website build uses the new names. Not a native reviewer's screen.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, mayWrite, seesSite, type Ctx } from './access.ts';
import { CATEGORY_MAX, categoryKey, categoryName, sameCategory } from './article-content.ts';
import { articleRow, articleTitle, viewArticle } from './articles.ts';
import { db, qa } from './db.ts';
import { bus } from './events.ts';
import { body, json } from './http.ts';
import { siteCategories, siteLinks } from './links.ts';
import { addAudit, siteInfo } from './workspace.ts';

const LINKS = /^\/api\/sites\/([^/]{1,64})\/links$/;
const CATEGORIES = /^\/api\/sites\/([^/]{1,64})\/categories$/;
const NOT_FOR_REVIEWERS = 'Your role reviews articles only.';

const qc = {
  any: db.prepare('SELECT 1 AS x FROM articles WHERE site_id = ? LIMIT 1'),
  withCategory: db.prepare(`SELECT id, category FROM articles WHERE site_id = ? AND category <> ''`),
  set: db.prepare('UPDATE articles SET category = ? WHERE id = ?'),
};

/** The site's link graph as the dashboard gets it. */
export function linksView(siteId: string) {
  return { siteId, domain: siteInfo(siteId)?.domain ?? '', ...siteLinks(siteId), allCategories: siteCategories(siteId) };
}
export type LinksView = ReturnType<typeof linksView>;

/** A category name a person typed: one line, at most 60 characters. Throws the message to answer with. */
function nameFrom(v: unknown, what: string): string {
  const raw = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if ([...raw].length > CATEGORY_MAX) throw new Error(`${what} is longer than ${CATEGORY_MAX} characters.`);
  const name = categoryName(raw);
  if (raw && !name) throw new Error('A category needs at least one letter or number.');
  return name;
}

/** Sets the category of the given articles in one transaction, with an entry in each article's history. Announces each. */
function setCategories(ids: number[], to: string, by: string, noteOf: (from: string) => string): void {
  db.exec('BEGIN');
  try {
    const now = Date.now();
    for (const id of ids) {
      const from = (articleRow(id) as { category?: string } | undefined)?.category ?? '';
      qc.set.run(to, id);
      qa.insertEvent.run(id, now, by, 'edited', noteOf(from));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  for (const id of ids) { const a = articleRow(id); if (a) bus.emit('article', viewArticle(a)); }
}

/** Handles GET /api/sites/:id/links and POST /api/sites/:id/categories. Returns false for any other path. */
export async function linksApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const get = req.method === 'GET' ? path.match(LINKS) : null, post = req.method === 'POST' ? path.match(CATEGORIES) : null;
  if (!get && !post) return false;
  const siteId = (get ?? post)![1]!, u = ctx.user;
  if (u.role === 'reviewer' || !seesSite(u, siteId)) { json(res, 403, { error: NOT_FOR_REVIEWERS }); return true; }
  if (!siteInfo(siteId) && !qc.any.get(siteId)) { json(res, 404, { error: 'That site is not in Sites (any more).' }); return true; }
  if (get) { json(res, 200, { links: linksView(siteId) }); return true; }

  const no = mayWrite(u);
  if (no) { json(res, no.status, { error: no.error }); return true; }
  const b = await body(req);
  const quote = (name: string) => name ? `“${name}”` : 'no category';
  let to: string;
  try { to = nameFrom(b.to, 'The category'); } catch (e) { json(res, 400, { error: (e as Error).message }); return true; }

  if (b.articleId !== undefined) {
    /* One article into another category ('' takes it out of its category). */
    const id = Number(b.articleId), a = Number.isSafeInteger(id) ? articleRow(id) as (ReturnType<typeof articleRow> & { category?: string }) | undefined : undefined;
    if (!a || a.site_id !== siteId) { json(res, 404, { error: 'Article not found.' }); return true; }
    const from = a.category ?? '', name = to ? sameCategory(to, siteCategories(siteId)) : '';
    if (name !== from) {
      setCategories([id], name, u.name, () => `Changed the category from ${quote(from)} to ${quote(name)}.`);
      bus.emit('audit', addAudit(actorOf(ctx), `Moved the article to ${name ? 'the category ' + quote(name) : 'no category'}: ${articleTitle(a)}`, siteId));
    }
    json(res, 200, { links: linksView(siteId), changed: name === from ? 0 : 1 });
    return true;
  }

  /* Rename a category. When another category already has the new name, the two become one. */
  let from: string;
  try { from = nameFrom(b.from, 'The category'); } catch (e) { json(res, 400, { error: (e as Error).message }); return true; }
  if (!from) { json(res, 400, { error: 'Choose the category to rename.' }); return true; }
  if (!to) { json(res, 400, { error: 'Enter the new name of the category.' }); return true; }
  const rows = qc.withCategory.all(siteId) as { id: number; category: string }[];
  const mine = rows.filter(r => categoryKey(r.category) === categoryKey(from));
  if (!mine.length) { json(res, 404, { error: `This site has no category ${quote(from)} (any more).` }); return true; }
  /* Every article of both categories gets the new spelling, so the merged category is written one way. */
  const others = categoryKey(to) === categoryKey(from) ? [] : rows.filter(r => categoryKey(r.category) === categoryKey(to));
  const change = [...mine, ...others].filter(r => r.category !== to).map(r => r.id);
  if (change.length) {
    setCategories(change, to, u.name, old => `Changed the category from ${quote(old)} to ${quote(to)}.`);
    /* Named as the site wrote it, not as it was typed here. */
    const n = mine.length, was = mine[0]!.category;
    bus.emit('audit', addAudit(actorOf(ctx), others.length
      ? `Merged the category ${quote(was)} into ${quote(to)}: ${n} article${n === 1 ? '' : 's'} moved`
      : `Renamed the category ${quote(was)} to ${quote(to)}: ${n} article${n === 1 ? '' : 's'}`, siteId));
  }
  json(res, 200, { links: linksView(siteId), changed: change.length, merged: others.length > 0 });
  return true;
}

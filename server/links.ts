// The links between a site's articles, worked out from the stored articles and nothing else: which article links to
// which (the links a person or the Content Writer put in the text), which articles no other article links to
// (orphans), and the site's categories with their articles. No model is asked; the same articles always give the same
// answer. linkGraph() is pure; the functions below it read the database.
//
// An article counts when it is waiting for review or approved and has text. The website shows a link only when its
// target is approved (sitebuild.ts writes the words as plain text otherwise), so each link says whether it is live.
import { categoryKey, categoryName, linksIn, sameCategory, slugify, type ArticleContent } from './article-content.ts';
import { db } from './db.ts';

/* ---------- The graph ---------- */

export type LinkArticle = { id: number; status: string; category: string; content: ArticleContent };
export type LinkNode = {
  id: number; title: string; titleEn: string; slug: string; status: string; category: string;
  /** Links in its text to other articles of the site, links from other articles to it, and links to web pages. */
  out: number; in: number; external: number;
};
/** One link in an article's text to another article. `live`: both are approved, so the website shows it as a link. */
export type LinkEdge = { from: number; to: number; anchor: string; live: boolean };
export type CategoryNode = { name: string; slug: string; articles: number[]; approved: number };
export type SiteLinks = {
  articles: LinkNode[];
  links: LinkEdge[];
  /** Links to an article that is no longer in review or approved (rejected, or sent back to be rewritten). */
  broken: { from: number; to: number; anchor: string }[];
  /** Articles no other article links to, newest first. */
  orphans: number[];
  /** Largest first, then by name. */
  categories: CategoryNode[];
  /** Articles without a category, newest first. */
  uncategorized: number[];
};

/** Categories of a list of articles: grouped without regard to case, named as the newest article writes the name. */
export function groupCategories<T extends { id: number; category: string }>(articles: readonly T[]): { name: string; articles: T[] }[] {
  const groups = new Map<string, { name: string; articles: T[] }>();
  for (const a of [...articles].sort((x, y) => y.id - x.id)) {
    const name = categoryName(a.category);
    if (!name) continue;
    const g = groups.get(categoryKey(name)) ?? { name, articles: [] };
    g.articles.push(a); groups.set(categoryKey(name), g);
  }
  return [...groups.values()].sort((x, y) => y.articles.length - x.articles.length || x.name.localeCompare(y.name));
}

/** The link graph of one site's articles. Pure. */
export function linkGraph(articles: readonly LinkArticle[]): SiteLinks {
  const list = [...articles].sort((x, y) => y.id - x.id), byId = new Map(list.map(a => [a.id, a]));
  const nodes = new Map<number, LinkNode>(list.map(a => [a.id, {
    id: a.id, title: a.content.title, titleEn: a.content.titleEn || a.content.title, slug: a.content.slug, status: a.status,
    category: categoryName(a.category), out: 0, in: 0, external: 0,
  }]));
  const links: LinkEdge[] = [], broken: SiteLinks['broken'] = [];
  for (const a of list) {
    const node = nodes.get(a.id)!;
    for (const { anchor, link } of linksIn(Array.isArray(a.content.blocks) ? a.content.blocks : [])) {
      if (!('article' in link)) { node.external++; continue; }
      const to = byId.get(link.article);
      /* A link to itself is never stored; one found in old data is not a link between two pages. */
      if (!to || to.id === a.id) { if (!to) broken.push({ from: a.id, to: link.article, anchor }); continue; }
      links.push({ from: a.id, to: to.id, anchor, live: a.status === 'approved' && to.status === 'approved' });
      node.out++; nodes.get(to.id)!.in++;
    }
  }
  const groups = groupCategories(list);
  /* Every article of a group carries the group's spelling, so the lists agree with the tree. */
  for (const g of groups) for (const a of g.articles) nodes.get(a.id)!.category = g.name;
  return {
    articles: [...nodes.values()], links, broken,
    orphans: [...nodes.values()].filter(n => !n.in).map(n => n.id),
    categories: groups.map(g => ({ name: g.name, slug: slugify(g.name), articles: g.articles.map(a => a.id), approved: g.articles.filter(a => a.status === 'approved').length })),
    uncategorized: [...nodes.values()].filter(n => !n.category).map(n => n.id),
  };
}

/* ---------- From the database ---------- */

type Row = { id: number; status: string; category: string; content: string };
const ql = {
  /* The same articles the duplicate checks look at (articles.ts siblingsOf): in review or approved, with text. */
  site: db.prepare(`SELECT id, status, category, content FROM articles WHERE site_id = ? AND status IN ('review', 'approved') AND content <> '' ORDER BY id DESC LIMIT 2000`),
  categories: db.prepare(`SELECT id, category FROM articles WHERE site_id = ? AND category <> '' AND status NOT IN ('rejected', 'failed') ORDER BY id DESC LIMIT 2000`),
  cluster: db.prepare(`SELECT cluster FROM keywords WHERE request_id = ? AND lower(keyword) = lower(?) AND cluster <> '' ORDER BY id LIMIT 1`),
};
const parse = (json: string): ArticleContent | null => {
  try { const c = JSON.parse(json) as ArticleContent | null; return c && typeof c.title === 'string' && Array.isArray(c.blocks) ? c : null; } catch { return null; }
};

/** The site's articles in review or approved, newest first. */
export function siteArticles(siteId: string): LinkArticle[] {
  return (ql.site.all(siteId) as Row[]).flatMap(r => { const content = parse(r.content); return content ? [{ id: r.id, status: r.status, category: r.category ?? '', content }] : []; });
}
export const siteLinks = (siteId: string): SiteLinks => linkGraph(siteArticles(siteId));

/** What the Content Writer and the editor's article picker are told about another article of the site. */
export type SiteRef = { id: number; title: string; slug: string; summary: string; category: string; status: string };
const oneLine = (v: unknown, n: number): string => [...String(v ?? '').replace(/\s+/g, ' ').trim()].slice(0, n).join('');
/** One line on what an article is about: its meta description, else the start of its first paragraph. */
function summaryOf(c: ArticleContent): string {
  const first = c.blocks.find(b => b.type === 'p');
  return oneLine(c.metaDescription || (first && first.type === 'p' ? first.text : ''), 200);
}
/** The site's other articles in review or approved, newest first: what an article's links may lead to. */
export function siteRefs(siteId: string, exceptId: number): SiteRef[] {
  return siteArticles(siteId).filter(a => a.id !== exceptId).map(a => ({
    id: a.id, title: oneLine(a.content.title, 200), slug: a.content.slug, summary: summaryOf(a.content), category: categoryName(a.category), status: a.status,
  }));
}
/** The ids an article of the site may link to. */
export const linkTargetIds = (siteId: string, exceptId: number): Set<number> => new Set(siteArticles(siteId).filter(a => a.id !== exceptId).map(a => a.id));

/** The categories the site's articles have (also of articles still being written), largest first. */
export function siteCategories(siteId: string): string[] {
  return groupCategories(ql.categories.all(siteId) as { id: number; category: string }[]).map(g => g.name);
}
/** The cluster keyword research put a keyword in: the default category of its article. '' when there is none. */
export function clusterOf(requestId: number | null, keyword: string, siteId = ''): string {
  if (!requestId) return '';
  const name = categoryName((ql.cluster.get(requestId, keyword) as { cluster: string } | undefined)?.cluster ?? '');
  /* Spelled as the site's category of that name, when it has one. */
  return name && siteId ? sameCategory(name, siteCategories(siteId)) : name;
}

// An article as the Content Writer returns it, and the defensive parser that turns the agent's answer into one.
// Everything is clipped; a source is kept only with an http(s) URL; an answer without a title and a paragraph is refused.
//
// Links inside the text are a structure, never HTML: a paragraph or a list item may carry `links`, each a range of its
// text and a target that is either another article of the same site (by id; its URL is decided when the website is
// built) or an http(s) URL. A link the agent proposes that does not hold (words not in the text, ranges that overlap,
// a target that is not an article of the site or a listed source) is left out and the text stays.
import { asArr, asObj, clip, extractJson } from './engine.ts';

/** A piece of text in the site's language with its English translation for the reviewer. */
/* `enStale` is set when a person edited the text by hand (article-edit.ts): the English no longer says what the text
   says, or there is none for text a person added. The agent never sets it; a rewritten version has none. */
/**
 * A link on a part of a text: the characters from `start` up to (not including) `end`, counted as JavaScript counts a
 * string, lead to another article of the same site or to a web address. Never HTML.
 */
export type Link = { start: number; end: number; article: number } | { start: number; end: number; url: string };
/* `links` is kept on list items only (never on table cells, the byline or the note). */
export type Bi = { text: string; en: string; enStale?: true; links?: Link[] };
export type Block =
  /* `links` is kept on paragraphs only. */
  | { type: 'h2' | 'h3' | 'p'; text: string; en: string; enStale?: true; links?: Link[] }
  | { type: 'list'; items: Bi[] }
  /** The first row is the header row. */
  | { type: 'table'; rows: Bi[][] };
export type Source = { title: string; url: string };

export type ArticleContent = {
  /** Main heading (H1), in the site's language. */
  title: string;
  titleEn: string;
  /** A person changed the title by hand after the agent translated it. */
  titleEnStale?: true;
  /** The <title> element. */
  titleTag: string;
  metaDescription: string;
  slug: string;
  byline: Bi;
  /** The note for readers on how the article was made. */
  disclosure: Bi;
  blocks: Block[];
  sources: Source[];
  /** English notes for the person who reviews the article: claims to double-check, things left out. */
  reviewerNotes: string[];
};

const bi = (v: unknown, n: number): Bi => { const o = asObj(v); return { text: clip(o.text, n), en: clip(o.en, n) }; };

/** Short meaningful words, lowercase, joined by hyphens. Letters of any script are kept (Google accepts UTF-8 URLs). */
export function slugify(v: unknown): string {
  return clip(v, 300).toLowerCase().replace(/^[a-z]+:\/\/[^/]*/, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 120).replace(/-+$/, '');
}

/** An absolute http or https URL, normalised; '' for anything else (javascript:, data:, relative paths, garbage). */
export function httpUrl(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s || s.length > 2000) return '';
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}

/* ---------- Links in the text ---------- */

/** Links in the text of one article, at most. */
export const MAX_LINKS = 8;
/** The linked words are at least this many characters: one linked hyphen in a paragraph is a hidden link. */
export const ANCHOR_MIN = 2;
/** What a link may point at: the ids of the site's other articles, and (for the agent) the URLs it listed as sources. */
export type LinkTargets = { articles: ReadonlySet<number>; urls?: ReadonlySet<string> };
export const NO_TARGETS: LinkTargets = { articles: new Set() };
export const linkTo = (l: Link): string => 'article' in l ? `article ${l.article}` : l.url;
/** The words a link is on. */
export const anchorOf = (text: string, l: Link): string => text.slice(l.start, l.end);
/** Every link in the text of an article, with the words it is on, in reading order. */
export function linksIn(blocks: Block[]): { anchor: string; link: Link; block: number }[] {
  return blocks.flatMap((b, block) => (b.type === 'p' ? [b] : b.type === 'list' ? b.items : [])
    .flatMap(t => (t.links ?? []).map(link => ({ anchor: anchorOf(t.text, link), link, block }))));
}

/**
 * A text on one line (whitespace collapsed and trimmed, as clip() and the editor do) with the positions of its link
 * ranges moved along. A range that is not two whole numbers inside the text is passed on as it is and refused later.
 */
export function collapseLinked(v: unknown, raw: unknown): { text: string; links: unknown[] } {
  const src = typeof v === 'string' ? v : String(v ?? '');
  const map = new Array<number>(src.length + 1);
  let out = '', gap = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { map[i] = out.length; gap = out.length > 0; continue; }
    if (gap) { out += ' '; gap = false; }
    map[i] = out.length; out += ch;
  }
  map[src.length] = out.length;
  const at = (n: unknown): unknown => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= src.length ? map[n] : n;
  const links = asArr(raw).slice(0, 200).map(x => {
    const o = asObj(x);
    return 'start' in o || 'end' in o ? { ...o, start: at(o.start), end: at(o.end) } : o;
  });
  return { text: out, links };
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff, isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
/** A position between the two halves of one character (an emoji, a rare CJK character). */
const splits = (t: string, i: number): boolean => i > 0 && i < t.length && isHigh(t.charCodeAt(i - 1)) && isLow(t.charCodeAt(i));

/**
 * The links of one text, checked: each is a range inside the text that splits no character, has words in it, overlaps
 * no other link, and leads to an article in `targets` or to an http(s) URL (one of `targets.urls` when those are
 * given). The agent may name the words instead of counting (`anchor`: the exact words, found in the text). Returns the
 * links in reading order and, for every one left out, why (a sentence a person can read).
 */
export function cleanLinks(text: string, raw: unknown, targets: LinkTargets): { links: Link[]; refused: string[] } {
  const links: Link[] = [], refused: string[] = [];
  const free = (s: number, e: number) => links.every(l => e <= l.start || s >= l.end);
  for (const x of asArr(raw).slice(0, 200)) {
    const o = asObj(x);
    let to: { article: number } | { url: string } | null = null;
    const art = o.article ?? (typeof o.to === 'number' ? o.to : undefined), url = o.url ?? (typeof o.to === 'string' ? o.to : undefined);
    if (art !== undefined) {
      if (typeof art !== 'number' || !Number.isSafeInteger(art) || !targets.articles.has(art)) { refused.push('It leads to an article that is not one of this site\'s other articles in review or approved.'); continue; }
      to = { article: art };
    } else {
      const u = httpUrl(url);
      if (!u) { refused.push('It has no target, or its address is not an http or https address.'); continue; }
      if (targets.urls && !targets.urls.has(u)) { refused.push('It leads to a page that is not among the listed sources.'); continue; }
      to = { url: u };
    }
    let start = -1, end = -1;
    const anchor = typeof o.anchor === 'string' ? clip(o.anchor, 1000) : '';
    if (anchor) {
      /* The first place the words stand where no other link is. */
      for (let i = text.indexOf(anchor); i >= 0; i = text.indexOf(anchor, i + 1)) if (free(i, i + anchor.length)) { start = i; end = i + anchor.length; break; }
      if (start < 0) { refused.push(text.includes(anchor) ? 'Its words are already part of another link.' : 'Its words are not in the text.'); continue; }
    } else {
      if (typeof o.start !== 'number' || typeof o.end !== 'number' || !Number.isInteger(o.start) || !Number.isInteger(o.end) || o.start < 0 || o.end > text.length || o.start >= o.end) {
        refused.push('It does not say which words of the text it is on.'); continue;
      }
      start = o.start; end = o.end;
    }
    while (start < end && /\s/.test(text[start]!)) start++;
    while (end > start && /\s/.test(text[end - 1]!)) end--;
    if (splits(text, start) || splits(text, end)) { refused.push('It starts or ends in the middle of a character.'); continue; }
    const words = text.slice(start, end);
    if ([...words].length < ANCHOR_MIN || !/[\p{L}\p{N}]/u.test(words)) { refused.push('It is on fewer than two characters, or on no letter or number.'); continue; }
    if (!free(start, end)) { refused.push('It overlaps another link.'); continue; }
    links.push({ start, end, ...to });
  }
  return { links: links.sort((a, b) => a.start - b.start), refused };
}

/** A text with its links; the key is left out when there are none, so text without links is stored as it always was. */
export const withLinks = <T extends { links?: Link[] }>(t: T, links: Link[] | undefined): T => {
  const { links: _old, ...rest } = t;
  return (links?.length ? { ...rest, links } : rest) as T;
};

/* ---------- Categories ---------- */

export const CATEGORY_MAX = 60;
/** A category name on one line, at most 60 characters; '' when it has no letter or number. */
export function categoryName(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = [...v.replace(/\s+/g, ' ').trim()].slice(0, CATEGORY_MAX).join('').trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : '';
}
/** How two category names are compared: without regard to case or spacing. */
export const categoryKey = (name: string): string => name.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
/** The name as one of the site's categories already writes it, else the name itself. */
export const sameCategory = (name: string, existing: readonly string[]): string =>
  existing.find(x => categoryKey(x) === categoryKey(name)) ?? name;

/* ---------- The agent's answer ---------- */

const HEADING: Record<string, 'h2' | 'h3'> = { h1: 'h2', h2: 'h2', h3: 'h3', h4: 'h3', h5: 'h3', h6: 'h3' };

/** What the parser keeps count of while it reads the links of one answer. */
type LinkCount = { targets: LinkTargets; kept: number; left: number; seen: Set<number> };

/** The links the agent gave for one text, as far as they hold and the article has room for them. */
function agentLinks(text: string, rawText: unknown, raw: unknown, n: LinkCount): Link[] {
  if (!asArr(raw).length) return [];
  const moved = collapseLinked(rawText, raw);
  /* Positions were counted in the text as the agent wrote it; when clipping changed it, only named words still hold. */
  const { links, refused } = cleanLinks(text, moved.text === text ? moved.links : moved.links.filter(l => typeof asObj(l).anchor === 'string'), n.targets);
  n.left += refused.length + (moved.text === text ? 0 : moved.links.length - moved.links.filter(l => typeof asObj(l).anchor === 'string').length);
  const out: Link[] = [];
  for (const l of links) {
    /* Each article is linked once, and the article has at most MAX_LINKS links. */
    if (n.kept >= MAX_LINKS || ('article' in l && n.seen.has(l.article))) { n.left++; continue; }
    if ('article' in l) n.seen.add(l.article);
    n.kept++; out.push(l);
  }
  return out;
}

function toBlock(v: unknown, n: LinkCount): Block | null {
  const o = asObj(v), type = String(o.type ?? '').toLowerCase();
  if (type === 'list' || type === 'ul' || type === 'ol') {
    const items = asArr(o.items).slice(0, 50).map(i => { const t = bi(i, 1000); return t.text ? withLinks(t, agentLinks(t.text, asObj(i).text, asObj(i).links, n)) : t; }).filter(i => i.text);
    return items.length ? { type: 'list', items } : null;
  }
  if (type === 'table') {
    const rows = asArr(o.rows).slice(0, 40).map(r => asArr(r).slice(0, 8).map(c => bi(c, 300))).filter(r => r.some(c => c.text));
    return rows.length ? { type: 'table', rows } : null;
  }
  const heading = HEADING[type];
  const text = clip(o.text, heading ? 300 : 3000), en = clip(o.en, heading ? 300 : 3000);
  if (!text) return null;
  if (heading) return { type: heading, text, en };
  return withLinks<Block & { type: 'p' }>({ type: 'p', text, en }, agentLinks(text, o.text, o.links, n));
}

/** What the parser is told about the site: its other articles a link may lead to, and the categories it has. */
export type ParseContext = { articles?: Iterable<number>; categories?: readonly string[] };

/**
 * Turns the Content Writer's answer into an article and the category it proposes ('' when it gives none). Throws a
 * clear error when the answer cannot be used. Without a context no link to another article is kept.
 */
export function parseAnswer(answer: string, ctx: ParseContext = {}): { content: ArticleContent; category: string } {
  let raw: unknown;
  try { raw = extractJson(answer); } catch { throw new Error('The Content Writer did not return the article as JSON.'); }
  const o = asObj(raw);
  /* Sources first: a link to a web page is kept only when that page is a listed source (a page the agent opened). */
  const sources: Source[] = [];
  for (const s of asArr(o.sources).map(asObj)) {
    const url = httpUrl(s.url);
    if (url && sources.length < 40 && !sources.some(x => x.url === url)) sources.push({ title: clip(s.title, 200) || url, url });
  }
  const count: LinkCount = { targets: { articles: new Set(ctx.articles ?? []), urls: new Set(sources.map(s => s.url)) }, kept: 0, left: 0, seen: new Set() };
  const blocks = asArr(o.blocks).slice(0, 150).map(b => toBlock(b, count)).filter((b): b is Block => b !== null);
  const title = clip(o.title, 200);
  if (!title || !blocks.some(b => b.type === 'p')) throw new Error('The Content Writer returned no usable article: a title and at least one paragraph are required.');
  const notes = typeof o.reviewerNotes === 'string' ? [o.reviewerNotes] : asArr(o.reviewerNotes);
  const reviewerNotes = notes.map(n => clip(n, 600)).filter(Boolean).slice(0, 40);
  const byline = bi(o.byline, 200), disclosure = bi(o.disclosure, 1000);
  if (!byline.text) reviewerNotes.push('Meridian: the agent returned no byline.');
  if (!disclosure.text) reviewerNotes.push('Meridian: the agent returned no note for readers on how the article was made.');
  if (count.left) reviewerNotes.push(`Meridian: left out ${count.left} link${count.left === 1 ? '' : 's'} the agent proposed. A link is kept only on words that are in the text, to another article of this site or a listed source, once per article, at most ${MAX_LINKS} in all.`);
  const category = categoryName(o.category);
  return {
    content: {
      title, titleEn: clip(o.titleEn, 200), titleTag: clip(o.titleTag, 200), metaDescription: clip(o.metaDescription, 400), slug: slugify(o.slug),
      byline, disclosure, blocks, sources, reviewerNotes,
    },
    category: category ? sameCategory(category, ctx.categories ?? []) : '',
  };
}

/** Turns the Content Writer's answer into an article. Throws a clear error when it cannot be used. */
export const parseArticle = (answer: string, ctx: ParseContext = {}): ArticleContent => parseAnswer(answer, ctx).content;

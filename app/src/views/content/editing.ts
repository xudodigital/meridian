/* The article editor's working copy, as pure functions: the draft made from an article, what is sent to the server,
   whether anything changed, and where the photos sit while blocks move. The limits and the photo rule are the
   server's (server/article-edit.ts): the editor shows the person what the save will do, the server decides.

   Links are ranges of a paragraph's or a list item's text (ArticleLink). The editor shows the text in a plain text box,
   so the ranges are moved along while the person types (shiftLinks) and when whitespace is collapsed for the save. */
import type { ArticleBlock, ArticleContent, ArticleEditBody, ArticleLink, BlockEdit, PhotoWire } from '@/store/types';

/** The same numbers the server holds an edit to. */
export const LIMITS = { title: 200, titleTag: 200, metaDescription: 400, slug: 120, heading: 300, paragraph: 3000, blocks: 150, items: 50, item: 1000, rows: 40, cells: 8, cell: 300 } as const;
/** What the automated checks measure (server/checks.ts). */
export const TITLE_TAG_MAX = 60, META_MIN = 70, META_MAX = 160;

export type TextType = 'p' | 'h2' | 'h3';
/** One block in the editor. `key` is stable while the block moves; `from` is its place in the saved article. */
/* `links` of a text block count only while it is a paragraph; a list's `links[i]` are those of item i. */
export type DraftBlock = { key: string; from: number | null } & (
  | { type: TextType; text: string; links?: ArticleLink[] }
  | { type: 'list'; items: string[]; links?: ArticleLink[][] }
  | { type: 'table'; rows: string[][] });
export interface Draft { title: string; titleTag: string; metaDescription: string; disclosure: string; slug: string; category: string; blocks: DraftBlock[] }

/** Links in the text of one article, at most (server/article-content.ts MAX_LINKS). */
export const MAX_LINKS = 8;
export const CATEGORY_MAX = 60;

let seq = 0;
/** A key for a block added in the editor. */
export const newKey = (): string => 'n' + (++seq);

export function draftOf(c: ArticleContent, category = ''): Draft {
  return {
    title: c.title, titleTag: c.titleTag, metaDescription: c.metaDescription, disclosure: c.disclosure.text, slug: c.slug, category,
    blocks: c.blocks.map((b, i): DraftBlock => b.type === 'list'
      ? { key: 'b' + i, from: i, type: 'list', items: b.items.map(x => x.text), ...(b.items.some(x => x.links?.length) ? { links: b.items.map(x => x.links ?? []) } : {}) }
      : b.type === 'table' ? { key: 'b' + i, from: i, type: 'table', rows: b.rows.map(r => r.map(x => x.text)) }
        : { key: 'b' + i, from: i, type: b.type, text: b.text, ...(b.type === 'p' && b.links?.length ? { links: b.links } : {}) }),
  };
}

/* ---------- Links ---------- */

const moved = <L extends ArticleLink>(l: L, start: number, end: number): L => ({ ...l, start, end });

/**
 * The links of a text after the person changed it from `before` to `after`. A link before the change stays, one
 * after it moves along, typing inside a link makes it longer or shorter, and a link whose words were partly replaced
 * keeps the words that are left. A link with no words left is gone.
 */
export function shiftLinks(links: readonly ArticleLink[] | undefined, before: string, after: string): ArticleLink[] {
  if (!links?.length) return [];
  if (before === after) return [...links];
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const oldEnd = before.length - s, newEnd = after.length - s, delta = after.length - before.length;
  return links.flatMap((l): ArticleLink[] => {
    let a = l.start, b = l.end;
    if (b <= p) { /* before the change */ }
    else if (a >= oldEnd) { a += delta; b += delta; }
    else if (a <= p && b >= oldEnd) b += delta;
    else if (a < p) b = p;
    else { a = newEnd; b += delta; }
    return b > a && after.slice(a, b).trim() ? [moved(l, a, b)] : [];
  });
}

/** The links that lie wholly inside the part [from, to) of a text, counted from `from`: what a split text takes along. */
export const sliceLinks = (links: readonly ArticleLink[] | undefined, from: number, to: number): ArticleLink[] =>
  (links ?? []).filter(l => l.start >= from && l.end <= to).map(l => moved(l, l.start - from, l.end - from));

/**
 * A text as it is sent (whitespace collapsed and trimmed, as the server does) with its links moved along and trimmed
 * of spaces at their ends. Links that end up empty are left out.
 */
export function collapsed(text: string, links: readonly ArticleLink[] | undefined): { text: string; links: ArticleLink[] } {
  if (!links?.length) return { text: line(text), links: [] };
  const map: number[] = [];
  let out = '', gap = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) { map[i] = out.length; gap = out.length > 0; continue; }
    if (gap) { out += ' '; gap = false; }
    map[i] = out.length; out += ch;
  }
  map[text.length] = out.length;
  const kept = links.flatMap((l): ArticleLink[] => {
    let a = map[Math.max(0, Math.min(text.length, l.start))]!, b = map[Math.max(0, Math.min(text.length, l.end))]!;
    while (a < b && out[a] === ' ') a++;
    while (b > a && out[b - 1] === ' ') b--;
    return b > a ? [moved(l, a, b)] : [];
  });
  return { text: out, links: kept.sort((x, y) => x.start - y.start) };
}

/**
 * Adds a link on the words [start, end) of a text. Returns the new links, or a sentence saying why not: no words
 * chosen, fewer than two characters, or words that are already part of a link.
 */
export function addLink(text: string, links: readonly ArticleLink[] | undefined, start: number, end: number, to: { article: number } | { url: string }): ArticleLink[] | string {
  let a = Math.max(0, Math.min(start, end)), b = Math.min(text.length, Math.max(start, end));
  while (a < b && /\s/.test(text[a]!)) a++;
  while (b > a && /\s/.test(text[b - 1]!)) b--;
  if (b <= a) return 'Select the words the link goes on first.';
  if ([...text.slice(a, b)].length < 2 || !/[\p{L}\p{N}]/u.test(text.slice(a, b))) return 'A link goes on at least two characters with a letter or a number.';
  if ((links ?? []).some(l => a < l.end && b > l.start)) return 'Those words are already part of a link. Remove that link first.';
  return [...(links ?? []), { start: a, end: b, ...to }].sort((x, y) => x.start - y.start);
}

/** An absolute http or https address as the server would store it; '' for anything else. */
export function httpUrl(v: string): string {
  const t = v.trim();
  if (!t || t.length > 2000) return '';
  try { const u = new URL(t); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}

/** How many links the draft's text has. */
export const linkCount = (blocks: readonly DraftBlock[]): number => blockEdits(blocks).reduce((n, b) =>
  n + (b.type === 'p' ? b.links?.length ?? 0 : b.type === 'list' ? b.items.reduce((k, i) => k + (typeof i === 'string' ? 0 : i.links.length), 0) : 0), 0);

/** A new, empty block of a kind. */
export function emptyBlock(type: DraftBlock['type'], text = ''): DraftBlock {
  const key = newKey();
  return type === 'list' ? { key, from: null, type, items: [''] } : type === 'table' ? { key, from: null, type, rows: [['', ''], ['', '']] } : { key, from: null, type, text };
}

const line = (t: string): string => t.replace(/\s+/g, ' ').trim();
/** Characters as a person counts them. */
export const chars = (t: string): number => [...t.trim()].length;

/** The server's slug rule (server/article-content.ts slugify): lowercase words of any script joined by hyphens. */
export function slugify(v: string): string {
  return line(v).slice(0, 300).toLowerCase().replace(/^[a-z]+:\/\/[^/]*/, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.slug).replace(/-+$/, '');
}

/** The blocks as they are sent: whitespace collapsed, empty pieces left out (the server drops them too). */
export function blockEdits(blocks: readonly DraftBlock[]): BlockEdit[] {
  return blocks.flatMap((b): BlockEdit[] => {
    if (b.type === 'list') {
      /* An item with links is sent as { text, links }; one without stays a plain string. */
      const items = b.items.map((t, i) => collapsed(t, b.links?.[i])).filter(x => x.text).map(x => x.links.length ? x : x.text);
      return items.length ? [{ from: b.from, type: 'list', items }] : [];
    }
    if (b.type === 'table') { const rows = b.rows.map(r => r.map(line)).filter(r => r.some(Boolean)); return rows.length ? [{ from: b.from, type: 'table', rows }] : []; }
    const { text, links } = collapsed(b.text, b.type === 'p' ? b.links : undefined);
    return text ? [{ from: b.from, type: b.type, text, ...(links.length ? { links } : {}) }] : [];
  });
}

export function editBody(d: Draft, updatedAt: number): ArticleEditBody {
  return { updatedAt, title: line(d.title), titleTag: line(d.titleTag), metaDescription: line(d.metaDescription), disclosure: line(d.disclosure), slug: slugify(d.slug), category: line(d.category), blocks: blockEdits(d.blocks) };
}

/** What a save would send, without the version: two drafts with the same value here are the same article. */
const valueOf = (d: Draft): string => JSON.stringify(editBody(d, 0));
/** The draft differs from the saved article in something a save would change. */
export const isDirty = (d: Draft, saved: ArticleContent, savedCategory = ''): boolean => valueOf(d) !== valueOf(draftOf(saved, savedCategory));

/** Why the draft cannot be saved as it is, or '' when it can. */
export function problemOf(d: Draft): string {
  if (!line(d.title)) return 'The article needs a title.';
  if (!line(d.disclosure)) return 'The article needs a disclosure.';
  if (chars(line(d.disclosure)) > 1000) return 'The disclosure is longer than 1,000 characters.';
  const blocks = blockEdits(d.blocks);
  if (!blocks.some(b => b.type === 'p')) return 'The article needs at least one paragraph.';
  if (blocks.length > LIMITS.blocks) return `An article has at most ${LIMITS.blocks} blocks. This one has ${blocks.length}.`;
  const links = linkCount(d.blocks);
  if (links > MAX_LINKS) return `An article has at most ${MAX_LINKS} links in its text. This one has ${links}: remove some.`;
  if ([...line(d.category)].length > CATEGORY_MAX) return `The category is longer than ${CATEGORY_MAX} characters.`;
  return '';
}

/** The text of a saved block in the site's language, in the shape blockEdits() gives a draft block. */
const savedText = (b: ArticleBlock): string => JSON.stringify(b.type === 'list' ? b.items.map(x => x.text) : b.type === 'table' ? b.rows.map(r => r.map(x => x.text)) : b.text);
const itemText = (i: string | { text: string }): string => typeof i === 'string' ? i : i.text;
/** The draft block says something else than the saved block it came from (or it is new): its English will not match. */
export function blockEdited(b: DraftBlock, saved: readonly ArticleBlock[]): boolean {
  const old = b.from === null ? undefined : saved[b.from];
  if (!old) return true;
  const now = blockEdits([b])[0];
  if (!now) return true;
  const family = (t: string) => t === 'list' || t === 'table' ? t : 'text';
  if (family(old.type) !== family(b.type)) return true;
  return savedText(old) !== JSON.stringify(now.type === 'list' ? now.items.map(itemText) : now.type === 'table' ? now.rows : now.text);
}

const anchor = (b: { type: string } | undefined): boolean => b?.type === 'h2' || b?.type === 'p';

/**
 * Where the photos sit after the blocks were moved, added or removed: the server's rule (remapPhotos in
 * server/article-edit.ts), so the editor shows each photo where the save will put it. An inline photo follows its
 * block; when that block is gone or can no longer carry a photo, it goes to the nearest heading or paragraph before
 * the place it was in, else the nearest after, and two photos share a block only when no free one is left.
 * Returns photo id -> index into `after`.
 */
export function photoPlaces(images: readonly PhotoWire[], beforeLength: number, after: readonly { type: string; from: number | null }[]): Map<string, number> {
  const now = new Map<number, number>();
  after.forEach((b, i) => { if (b.from !== null) now.set(b.from, i); });
  const taken = new Set<number>(), place = new Map<string, number>();
  const inline = images.filter(p => p.role === 'inline' && typeof p.after === 'number' && p.after >= 0 && p.after < beforeLength);
  for (const p of inline) {
    const i = now.get(p.after as number);
    if (i !== undefined && anchor(after[i]) && !taken.has(i)) { taken.add(i); place.set(p.id, i); }
  }
  const anchors = after.flatMap((b, i) => anchor(b) ? [i] : []);
  for (const p of inline) {
    if (place.has(p.id)) continue;
    let at = -1;
    for (let o = p.after as number; o >= 0 && at < 0; o--) at = now.get(o) ?? -1;
    const free = (i: number) => !taken.has(i);
    const back = anchors.filter(i => i <= at).reverse(), fwd = anchors.filter(i => i > at);
    const i = back.find(free) ?? fwd.find(free) ?? back[0] ?? fwd[0];
    if (i === undefined) continue;
    taken.add(i); place.set(p.id, i);
  }
  return place;
}

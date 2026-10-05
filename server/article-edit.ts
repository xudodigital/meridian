// What a person does to an article by hand: edit its text before approval, send an approved one back to review,
// archive one that is decided. An edit is in the site's language only: the English beside an edited piece is kept
// and marked as not updated (`enStale`), so the reviewer knows it no longer says what the text says. The limits are
// the ones the agent's answer is held to (article-content.ts parseArticle), but a person's text is never cut
// silently: text over a limit is refused with a message that names the piece.
//
// Links in a paragraph or a list item come with the edit as ranges of that text (article-content.ts Link): the same
// rules as for the agent's answer, but a link that does not hold is refused with a message, never dropped. A text sent
// without links has none after the save. The article's category is edited here too (a column, not part of the text).
import type { ArticleContent, Bi, Block, Link, LinkTargets } from './article-content.ts';
import { CATEGORY_MAX, MAX_LINKS, NO_TARGETS, categoryName, cleanLinks, collapseLinked, sameCategory, slugify, withLinks } from './article-content.ts';
import { articleRow, checksFor, imagesOf, viewArticle, type ArticleView, type Outcome, type PhotoCols } from './articles.ts';
import type { LanguageReview } from './checks.ts';
import { db, qa, type ArticleEventRow, type ArticleRow } from './db.ts';
import { bus } from './events.ts';
import { linkTargetIds, siteCategories } from './links.ts';
import type { Photo } from './photos.ts';

/** The same numbers parseArticle clips the agent's answer to. */
export const LIMITS = { title: 200, titleTag: 200, metaDescription: 400, slug: 120, heading: 300, paragraph: 3000, blocks: 150, items: 50, item: 1000, rows: 40, cells: 8, cell: 300 } as const;

type Row = ArticleRow & Partial<PhotoCols> & { archived_at?: number | null; category?: string };
const row = (id: number) => articleRow(id) as Row | undefined;
const parse = <T>(json: string, fallback: T): T => { try { return json ? JSON.parse(json) as T : fallback; } catch { return fallback; } };
const refuse = (status: number, error: string): Outcome => ({ ok: false, status, error });
const emit = (id: number): ArticleView | null => { const a = row(id); if (!a) return null; const v = viewArticle(a); bus.emit('article', v); return v; };
const done = (id: number): Outcome => { const article = emit(id); return article ? { ok: true, article } : refuse(404, 'Article not found.'); };
const event = (id: number, by: string, action: string, note = '') => qa.insertEvent.run(id, Date.now(), by, action, note);
const tx = (fn: () => void): void => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };

const qe = {
  save: db.prepare(`UPDATE articles SET content = ?, checks = ?, images = ?, lang_review_by = ?, lang_review_at = ? WHERE id = ? AND status = 'review'`),
  /* Back in review, and back in the lists: an archived article nobody sees could not be reviewed. */
  unapprove: db.prepare(`UPDATE articles SET status = 'review', checks = ?, archived_at = NULL WHERE id = ? AND status = 'approved'`),
  archive: db.prepare(`UPDATE articles SET archived_at = ? WHERE id = ? AND archived_at IS NULL AND status IN ('approved', 'rejected', 'failed')`),
  unarchive: db.prepare('UPDATE articles SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL'),
  category: db.prepare('UPDATE articles SET category = ? WHERE id = ?'),
};

/* ---------- The edit a person sends ---------- */

/** One block as the editor sends it: text in the site's language only. `from` is the block's place before the edit; a new block has none. */
/* `links` are the links of a paragraph; `itemLinks[i]` those of list item i. Empty when the text has none. */
export type BlockEdit =
  | { from: number | null; type: 'h2' | 'h3' | 'p'; text: string; links: Link[] }
  | { from: number | null; type: 'list'; items: string[]; itemLinks: Link[][] }
  | { from: number | null; type: 'table'; rows: string[][] };
/** What to change; a field left out stays as it is. */
export type ArticleEdit = { title?: string; titleTag?: string; metaDescription?: string; disclosure?: string; slug?: string; category?: string; blocks?: BlockEdit[] };

/** One line of text: whitespace collapsed and trimmed, never cut. */
const line = (v: unknown): string => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
const count = (t: string): number => [...t].length;
const many = (n: number): string => n.toLocaleString('en-US');
class Invalid extends Error {}
/** The text, or a refusal when it is longer than the limit. */
function within(what: string, v: unknown, max: number): string {
  const t = line(v);
  if (count(t) > max) throw new Invalid(`${what} is ${many(count(t))} characters long. The limit is ${many(max)}: shorten it or split it.`);
  return t;
}
/**
 * The text and its links, or a refusal: the text over its limit, or a link that does not hold. The link positions a
 * person's editor sends are counted in the text as sent; they move along when whitespace is collapsed.
 */
function linked(what: string, v: unknown, rawLinks: unknown, max: number, targets: LinkTargets): { text: string; links: Link[] } {
  const text = within(what, v, max);
  if (rawLinks === undefined || rawLinks === null) return { text, links: [] };
  if (!Array.isArray(rawLinks)) throw new Invalid('The article text was not sent in a form Meridian understands.');
  if (!rawLinks.length || !text) return { text, links: [] };
  const moved = collapseLinked(typeof v === 'string' ? v : '', rawLinks);
  const { links, refused } = cleanLinks(text, moved.links, targets);
  if (refused.length) throw new Invalid(`A link in ${what[0]!.toLowerCase() + what.slice(1)} cannot be saved. ${refused[0]}`);
  return { text, links };
}

/**
 * Reads the request body into an edit. Throws Invalid (answered with 400) for text over a limit or a shape the editor
 * never sends. Empty paragraphs, list items and table rows are dropped, as in the agent's answer.
 */
export function readEdit(b: Record<string, unknown>, oldBlocks: number, targets: LinkTargets = NO_TARGETS): ArticleEdit {
  const e: ArticleEdit = {};
  if (b.category !== undefined) {
    const raw = within('The category', b.category, CATEGORY_MAX);
    e.category = categoryName(raw);
    if (raw && !e.category) throw new Invalid('A category needs at least one letter or number.');
  }
  if (b.title !== undefined) {
    e.title = within('The title', b.title, LIMITS.title);
    if (!e.title) throw new Invalid('The article needs a title.');
  }
  if (b.titleTag !== undefined) e.titleTag = within('The title tag', b.titleTag, LIMITS.titleTag);
  if (b.metaDescription !== undefined) e.metaDescription = within('The meta description', b.metaDescription, LIMITS.metaDescription);
  if (b.disclosure !== undefined) {
    e.disclosure = within('The disclosure', b.disclosure, 1000);
    if (!e.disclosure) throw new Invalid('The article needs a disclosure.');
  }
  if (b.slug !== undefined) {
    if (count(line(b.slug)) > 300) throw new Invalid(`The URL slug is too long. The limit is ${LIMITS.slug} characters.`);
    e.slug = slugify(b.slug);
  }
  if (b.blocks !== undefined) {
    if (!Array.isArray(b.blocks)) throw new Invalid('The article text was not sent in a form Meridian understands.');
    if (b.blocks.length > LIMITS.blocks) throw new Invalid(`An article has at most ${LIMITS.blocks} blocks. This one has ${b.blocks.length}.`);
    const seen = new Set<number>(), blocks: BlockEdit[] = [];
    b.blocks.forEach((raw, i) => {
      const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, n = i + 1;
      let from: number | null = null;
      if (o.from !== undefined && o.from !== null) {
        const f = Number(o.from);
        if (!Number.isInteger(f) || f < 0 || f >= oldBlocks || seen.has(f)) throw new Invalid('The article text was not sent in a form Meridian understands.');
        seen.add(f); from = f;
      }
      if (o.type === 'h2' || o.type === 'h3' || o.type === 'p') {
        const { text, links } = o.type === 'p' ? linked(`Paragraph (block ${n})`, o.text, o.links, LIMITS.paragraph, targets) : { text: within(`Heading (block ${n})`, o.text, LIMITS.heading), links: [] };
        if (text) blocks.push({ from, type: o.type, text, links });
      } else if (o.type === 'list') {
        /* An item is its text, or { text, links } when words of it are linked. */
        const items = (Array.isArray(o.items) ? o.items : []).map((x, k) => {
          const it: Record<string, unknown> = x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : { text: x };
          return linked(`List item ${k + 1} (block ${n})`, it.text, it.links, LIMITS.item, targets);
        }).filter(x => x.text);
        if (items.length > LIMITS.items) throw new Invalid(`A list has at most ${LIMITS.items} items. Block ${n} has ${items.length}.`);
        if (items.length) blocks.push({ from, type: 'list', items: items.map(x => x.text), itemLinks: items.map(x => x.links) });
      } else if (o.type === 'table') {
        const rows = (Array.isArray(o.rows) ? o.rows : []).map((r, y) => {
          const cells = Array.isArray(r) ? r : [];
          if (cells.length > LIMITS.cells) throw new Invalid(`A table has at most ${LIMITS.cells} columns. Block ${n} has ${cells.length}.`);
          return cells.map((x, k) => within(`Table cell ${k + 1} in row ${y + 1} (block ${n})`, x, LIMITS.cell));
        }).filter(r => r.some(Boolean));
        if (rows.length > LIMITS.rows) throw new Invalid(`A table has at most ${LIMITS.rows} rows. Block ${n} has ${rows.length}.`);
        if (rows.length) blocks.push({ from, type: 'table', rows });
      } else throw new Invalid('The article text was not sent in a form Meridian understands.');
    });
    if (!blocks.some(x => x.type === 'p')) throw new Invalid('The article needs at least one paragraph.');
    const links = blocks.reduce((sum, x) => sum + (x.type === 'list' ? x.itemLinks.flat().length : x.type === 'table' ? 0 : x.links.length), 0);
    if (links > MAX_LINKS) throw new Invalid(`An article has at most ${MAX_LINKS} links in its text. This one has ${links}: remove some.`);
    e.blocks = blocks;
  }
  return e;
}

/* ---------- Applying it ---------- */

const stale = <T extends { en: string }>(x: T): T & { enStale: true } => ({ ...x, enStale: true });

/**
 * The items of a list after the edit. Text that was there before keeps its English, wherever it moved in the list.
 * Changed text takes, in order, the English of the old items that are gone, marked as not updated; text beyond
 * those is new and has none.
 */
function pieces(now: string[], before: Bi[], links: Link[][]): Bi[] {
  const left = [...before];
  const same = now.map(t => { const k = left.findIndex(o => o.text === t); return k < 0 ? null : left.splice(k, 1)[0]!; });
  /* The links are the ones the edit sent for the item, whatever the item had before. */
  return now.map((text, i) => withLinks<Bi>(same[i] ?? stale({ text, en: left.shift()?.en ?? '' }), links[i]));
}

function blockAfter(e: BlockEdit, old: Block | undefined): Block {
  if (e.type === 'list') return { type: 'list', items: pieces(e.items, old?.type === 'list' ? old.items : [], e.itemLinks) };
  if (e.type === 'table') {
    const was = old?.type === 'table' ? old.rows : [];
    /* Cell by cell, in place: a table has no "same text elsewhere" (many cells say "yes" or "1:8"). */
    return { type: 'table', rows: e.rows.map((r, y) => r.map((text, x) => { const o = was[y]?.[x]; return o && o.text === text ? o : stale({ text, en: o?.en ?? '' }); })) };
  }
  const text = old && (old.type === 'h2' || old.type === 'h3' || old.type === 'p') ? old : undefined;
  /* Only a paragraph carries links: a paragraph turned into a heading loses them. */
  const links = e.type === 'p' ? e.links : [];
  if (text && text.text === e.text) return withLinks({ ...text, type: e.type }, links);
  return withLinks<Block & { type: 'h2' | 'h3' | 'p' }>(stale({ type: e.type, text: e.text, en: text?.en ?? '' }), links);
}

/** The links of a block, for telling whether only they changed. */
const linksOf = (b: Block | BlockEdit): string => JSON.stringify(
  b.type === 'list' ? ('itemLinks' in b ? b.itemLinks : b.items.map(i => i.links ?? [])).map(l => l.map(linkKey))
    : b.type === 'table' ? [] : (b.type === 'p' ? b.links ?? [] : []).map(linkKey));
const linkKey = (l: Link): (string | number)[] => [l.start, l.end, 'article' in l ? l.article : l.url];

/** The text of a block in the site's language, for telling whether a block changed. */
const textOf = (b: Block | BlockEdit): string => JSON.stringify(
  b.type === 'list' ? [b.type, b.items.map(i => typeof i === 'string' ? i : i.text)]
    : b.type === 'table' ? [b.type, b.rows.map(r => r.map(c => typeof c === 'string' ? c : c.text))] : [b.type, b.text]);

const anchor = (b: Block | undefined): boolean => b?.type === 'h2' || b?.type === 'p';

/**
 * Where the photos sit after the blocks were moved, added or removed. An inline photo follows its block wherever the
 * block went. When that block is gone (or became something a photo cannot follow), the photo goes to the nearest
 * heading or paragraph before the place it was in, else the nearest after. Two photos never share a block while a
 * free one is left. `from[i]` is the old index of new block i (null for a new block).
 */
export function remapPhotos(images: Photo[], before: Block[], after: Block[], from: (number | null)[]): Photo[] {
  const now = new Map<number, number>();
  from.forEach((f, i) => { if (f !== null) now.set(f, i); });
  const taken = new Set<number>(), place = new Map<string, number>();
  const inline = images.filter(p => p.role === 'inline' && typeof p.after === 'number' && p.after >= 0 && p.after < before.length);
  const kept = (p: Photo): number | undefined => { const i = now.get(p.after!); return i !== undefined && anchor(after[i]) ? i : undefined; };
  for (const p of inline) { const i = kept(p); if (i !== undefined && !taken.has(i)) { taken.add(i); place.set(p.id, i); } }
  const anchors = after.flatMap((b, i) => anchor(b) ? [i] : []);
  for (const p of inline) {
    if (place.has(p.id)) continue;
    /* Where the photo's old spot is now: its own block if it is still there, else the nearest earlier block that is. */
    let at = -1;
    for (let o = p.after!; o >= 0 && at < 0; o--) at = now.get(o) ?? -1;
    const free = (i: number) => !taken.has(i);
    const back = anchors.filter(i => i <= at).reverse(), fwd = anchors.filter(i => i > at);
    const i = back.find(free) ?? fwd.find(free) ?? back[0] ?? fwd[0];
    if (i === undefined) continue;
    taken.add(i); place.set(p.id, i);
  }
  return images.map(p => place.has(p.id) ? { ...p, after: place.get(p.id)! } : p);
}

/** The category as the site's other articles spell it; the article's own old spelling does not count. */
function sameCategoryOf(siteId: string, name: string, own: string): string {
  return own && name !== own && name.toLocaleLowerCase() === own.toLocaleLowerCase() ? name : sameCategory(name, siteCategories(siteId).filter(x => x !== own));
}

const list = (parts: string[]): string => parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1);
const blocksN = (n: number): string => `${n} block${n === 1 ? '' : 's'}`;

/** The time the article's text last changed: when the latest version was written, or the latest edit by a person. */
function textChangedAt(a: ArticleRow): number {
  const edits = (qa.eventsFor.all(a.id) as ArticleEventRow[]).filter(e => e.action === 'edited').map(e => e.at);
  return Math.max(a.finished_at ?? 0, ...edits);
}

export const CHANGED_MEANWHILE = 'This article was changed by someone else while you were editing, so your changes were not saved. Copy what you need, cancel, and edit the newer version.';
const reviewOf = (a: ArticleRow): LanguageReview => a.lang_review_by && a.lang_review_at ? { by: a.lang_review_by, at: a.lang_review_at } : null;

/**
 * Saves a person's edit of an article waiting for review. `seen` is the `updatedAt` of the version the person edited:
 * when the text changed after that (another edit, a new version from the agent) the edit is refused, never merged.
 * The checks are computed again, the edit goes into the history with what changed, and a language review of the old
 * text is cleared when the title or the body changed (it vouched for words that are no longer there).
 */
export function editArticle(id: number, by: string, body: Record<string, unknown>): Outcome {
  const a = row(id);
  if (!a) return refuse(404, 'Article not found.');
  if (a.status === 'approved') return refuse(409, 'This article is approved. Send it back to review first, then edit it.');
  const old = parse<ArticleContent | null>(a.content, null);
  if (a.status !== 'review' || !old) return refuse(409, 'Only an article waiting for review can be edited.');
  const seen = Number(body.updatedAt);
  if (!Number.isFinite(seen)) return refuse(400, 'The edit does not say which version it changes. Reload the page and edit again.');
  if (textChangedAt(a) > seen) return refuse(409, CHANGED_MEANWHILE);
  let e: ArticleEdit;
  /* A link may lead to the site's other articles in review or approved, or to any http(s) address. */
  try { e = readEdit(body, old.blocks.length, { articles: linkTargetIds(a.site_id, a.id) }); }
  catch (err) { if (err instanceof Invalid) return refuse(400, err.message); throw err; }

  /* For the history: what was changed, then what was added and removed. */
  const what: string[] = [], also: string[] = [];
  const c: ArticleContent = { ...old };
  if (e.title !== undefined && e.title !== old.title) { c.title = e.title; c.titleEnStale = true; what.push('the title'); }
  if (e.titleTag !== undefined && e.titleTag !== old.titleTag) { c.titleTag = e.titleTag; what.push('the title tag'); }
  if (e.metaDescription !== undefined && e.metaDescription !== old.metaDescription) { c.metaDescription = e.metaDescription; what.push('the meta description'); }
  if (e.disclosure !== undefined && e.disclosure !== old.disclosure.text) {
    c.disclosure = stale({ ...old.disclosure, text: e.disclosure });
    what.push('the disclosure');
  }
  if (e.slug !== undefined && e.slug !== old.slug) { c.slug = e.slug; what.push('the URL slug'); }
  /* The category is a column of its own; one the site already has keeps that spelling. */
  const hadCategory = a.category ?? '';
  const category = e.category === undefined ? hadCategory : e.category && categoryName(e.category) ? sameCategoryOf(a.site_id, e.category, hadCategory) : '';
  if (category !== hadCategory) what.push('the category');

  let images = imagesOf(a), bodyChanged = false;
  if (e.blocks) {
    const from = e.blocks.map(b => b.from);
    const changed = e.blocks.filter(b => b.from !== null && textOf(b) !== textOf(old.blocks[b.from]!)).length;
    /* Blocks that say the same but whose links changed: no word changed, so the English and a language review stand. */
    const relinked = e.blocks.filter(b => b.from !== null && textOf(b) === textOf(old.blocks[b.from]!) && linksOf(b) !== linksOf(old.blocks[b.from]!)).length;
    const added = from.filter(f => f === null).length, removed = old.blocks.length - (from.length - added);
    const order = from.filter((f): f is number => f !== null), moved = order.some((f, i) => i > 0 && f < order[i - 1]!);
    bodyChanged = !!(changed || added || removed || moved);
    if (bodyChanged || relinked) {
      /* A structural change renumbers the blocks the photos refer to. The running photo job chose its places in the
         old numbering and saves them when it ends, so the two cannot be reconciled: the person saves again after it. */
      if ((added || removed || moved) && a.photos_status === 'work') return refuse(409, 'The Site Builder is choosing photos for this article right now, and they are placed by block. Save again when it has finished (about a minute).');
      c.blocks = e.blocks.map(b => blockAfter(b, b.from === null ? undefined : old.blocks[b.from]));
      images = remapPhotos(images, old.blocks, c.blocks, from);
      if (changed) what.push(`the text of ${blocksN(changed)}`);
      if (relinked) what.push(`the links in ${blocksN(relinked)}`);
      if (moved) what.push('the order of the blocks');
      if (added) also.push(`Added ${blocksN(added)}.`);
      if (removed) also.push(`Removed ${blocksN(removed)}.`);
    }
  }
  if (!what.length && !also.length) return done(id);

  const textChanged = bodyChanged || c.title !== old.title || c.disclosure.text !== old.disclosure.text;
  const review = textChanged ? null : reviewOf(a);
  const cleared = textChanged && !!reviewOf(a);
  const note = [...(what.length ? [`Changed ${list(what)}.`] : []), ...also,
    ...(cleared ? ['The language review was cleared, because it was done on the text before this edit.'] : [])].join(' ');
  let saved = 0;
  tx(() => {
    saved = Number(qe.save.run(JSON.stringify(c), JSON.stringify(checksFor(a, c, review)), JSON.stringify(images), review?.by ?? '', review?.at ?? null, id).changes);
    if (saved && category !== hadCategory) qe.category.run(category, id);
    if (saved) event(id, by, 'edited', note);
  });
  return saved ? done(id) : refuse(409, 'Only an article waiting for review can be edited.');
}

/* ---------- After the decision ---------- */

/**
 * Sends an approved article back to review. The next website build of its site leaves it out; a build that already
 * exists (also the live one) is not changed. Its checks are computed again: the site may have gained an article with
 * the same slug since.
 */
export function unapproveArticle(id: number, by: string): Outcome {
  const a = row(id);
  if (!a) return refuse(404, 'Article not found.');
  const c = parse<ArticleContent | null>(a.content, null);
  if (a.status !== 'approved' || !c) return refuse(409, 'Only an approved article can be sent back to review.');
  let n = 0;
  tx(() => {
    n = Number(qe.unapprove.run(JSON.stringify(checksFor(a, c, reviewOf(a))), id).changes);
    if (n) event(id, by, 'unapproved');
  });
  return n ? done(id) : refuse(409, 'Only an approved article can be sent back to review.');
}

/** Archives a decided or failed article (it leaves the lists; nothing else changes), or brings it back. */
export function archiveArticle(id: number, by: string, on: boolean): Outcome {
  const a = row(id);
  if (!a) return refuse(404, 'Article not found.');
  let n = 0;
  tx(() => {
    n = Number(on ? qe.archive.run(Date.now(), id).changes : qe.unarchive.run(id).changes);
    if (n) event(id, by, on ? 'archived' : 'unarchived');
  });
  if (n) return done(id);
  if (!on) return refuse(409, 'This article is not archived.');
  return refuse(409, a.archived_at ? 'This article is already archived.' : 'Only an approved, rejected or failed article can be archived. Decide this one first.');
}

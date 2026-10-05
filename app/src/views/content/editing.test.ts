/* The article editor's working copy (editing.ts): what counts as a change, what is sent, and where photos land. */
import { describe, expect, it } from 'vitest';
import { articleContent } from '@/store/articleFixtures';
import type { PhotoWire } from '@/store/types';
import type { ArticleLink } from '@/store/types';
import { addLink, blockEdited, blockEdits, chars, collapsed, draftOf, editBody, emptyBlock, httpUrl, isDirty, linkCount, photoPlaces, problemOf, shiftLinks, sliceLinks, slugify, type Draft, type DraftBlock } from './editing';

const c = articleContent();
const text = (d: Draft, i: number, value: string): Draft => ({ ...d, blocks: d.blocks.map((b, k) => k === i && 'text' in b ? { ...b, text: value } : b) });

describe('the draft of an article', () => {
  it('tracks a disclosure change without changing the article body', () => {
    const d = { ...draftOf(c), disclosure: 'Reviewed by a person after AI drafting.' };
    expect(isDirty(d, c)).toBe(true);
    expect(editBody(d, 1).disclosure).toBe(d.disclosure);
    expect(editBody(d, 1).blocks).toEqual(editBody(draftOf(c), 1).blocks);
    expect(problemOf({ ...d, disclosure: '' })).toBe('The article needs a disclosure.');
  });
  it('starts equal to the saved article and sends every block with the place it came from', () => {
    const d = draftOf(c);
    expect(isDirty(d, c)).toBe(false);
    expect(editBody(d, 42)).toEqual({
      updatedAt: 42, title: c.title, titleTag: c.titleTag, metaDescription: c.metaDescription, disclosure: c.disclosure.text, slug: c.slug, category: '',
      blocks: [
        { from: 0, type: 'p', text: 'Cà phê phin là cách pha phổ biến.' }, { from: 1, type: 'h2', text: 'Tỉ lệ' },
        { from: 2, type: 'list', items: ['Cà phê xay thô'] }, { from: 3, type: 'table', rows: [['Tỉ lệ', 'Thời gian'], ['1:8', '5 phút']] },
      ],
    });
  });

  it('is changed by words, not by spaces the save would drop', () => {
    const d = draftOf(c);
    expect(isDirty(text(d, 0, '  Cà phê phin  là cách pha phổ biến. '), c)).toBe(false);
    expect(isDirty(text(d, 0, 'Cà phê phin là cách pha rất phổ biến.'), c)).toBe(true);
    expect(isDirty({ ...d, slug: 'Cach pha Ca Phe Phin' }, c)).toBe(false);
    expect(isDirty({ ...d, blocks: [...d.blocks, emptyBlock('p')] }, c)).toBe(false);
    expect(isDirty({ ...d, blocks: [d.blocks[1]!, d.blocks[0]!, ...d.blocks.slice(2)] }, c)).toBe(true);
    expect(isDirty({ ...d, blocks: d.blocks.map(b => b.type === 'h2' ? { ...b, type: 'h3' as const } : b) }, c)).toBe(true);
  });

  it('leaves out empty paragraphs, list items and table rows', () => {
    const blocks: DraftBlock[] = [
      { key: 'a', from: 0, type: 'p', text: '   ' }, { key: 'b', from: null, type: 'list', items: ['', ' một ', ''] },
      { key: 'c', from: null, type: 'table', rows: [['a', ''], ['', '']] }, { key: 'd', from: null, type: 'list', items: [''] },
    ];
    expect(blockEdits(blocks)).toEqual([{ from: null, type: 'list', items: ['một'] }, { from: null, type: 'table', rows: [['a', '']] }]);
  });

  it('says why a draft cannot be saved', () => {
    const d = draftOf(c);
    expect(problemOf(d)).toBe('');
    expect(problemOf({ ...d, title: '  ' })).toBe('The article needs a title.');
    expect(problemOf({ ...d, blocks: d.blocks.filter(b => b.type !== 'p') })).toBe('The article needs at least one paragraph.');
  });

  it('knows which blocks no longer match their English', () => {
    const d = draftOf(c);
    expect(d.blocks.map(b => blockEdited(b, c.blocks))).toEqual([false, false, false, false]);
    expect(blockEdited(text(d, 1, 'Tỉ lệ pha').blocks[1]!, c.blocks)).toBe(true);
    expect(blockEdited({ ...d.blocks[2]!, type: 'list', items: ['Cà phê xay thô', 'Nước'] } as DraftBlock, c.blocks)).toBe(true);
    expect(blockEdited(emptyBlock('p', 'Mới'), c.blocks)).toBe(true);
  });

  it('makes slugs and counts characters the way the server does', () => {
    expect(slugify('Cold Brew di Rumah!')).toBe('cold-brew-di-rumah');
    expect(slugify('  Cách pha — cà phê  ')).toBe('cách-pha-cà-phê');
    expect(slugify('https://kopi.example/a b')).toBe('a-b');
    expect(chars(' 🙂é ')).toBe(2);
  });
});

describe('photos while blocks move', () => {
  const photo = (id: string, after: number | null): PhotoWire => ({
    id, role: after === null ? 'hero' : 'inline', after, file: id, ext: 'jpg', widths: [800], width: 800, height: 600, alt: '', altEn: '', caption: '', captionEn: '',
    title: '', author: '', authorUrl: '', license: '', licenseUrl: '', sourceUrl: '', provider: 'Wikimedia Commons',
  });
  /* Saved: 0 p, 1 h2, 2 p, 3 list, 4 h2, 5 p; photos after 0, 2 and 4 (the server's test uses the same article). */
  const images = [photo('p1', null), photo('p2', 0), photo('p3', 2), photo('p4', 4)];
  const b = (from: number | null, type: string) => ({ from, type });
  const places = (after: { from: number | null; type: string }[]) => Object.fromEntries(photoPlaces(images, 6, after));

  it('keeps every photo after its block when blocks are reordered or added', () => {
    expect(places([b(4, 'h2'), b(5, 'p'), b(null, 'p'), b(0, 'p'), b(1, 'h2'), b(2, 'p'), b(3, 'list')])).toEqual({ p2: 3, p3: 5, p4: 0 });
  });
  it('moves the photo of a removed block to the nearest heading or paragraph before it', () => {
    expect(places([b(1, 'h2'), b(3, 'list'), b(4, 'h2'), b(5, 'p')])).toEqual({ p4: 2, p2: 0, p3: 3 });
  });
  it('does not put two photos after one block while a free one is left, and never after an h3', () => {
    expect(places([b(0, 'p'), b(1, 'h3'), b(2, 'h3'), b(4, 'h3'), b(5, 'p')])).toEqual({ p2: 0, p3: 4, p4: 0 });
  });
});

describe('links while the text is edited', () => {
  const T = 'Pahami rasio kopi dan air dulu.';
  const L: ArticleLink[] = [{ start: 7, end: 17, article: 4 }];           // "rasio kopi"
  const words = (text: string, links: ArticleLink[]) => links.map(l => text.slice(l.start, l.end));

  it('moves a link along with its words when text is typed before, after or inside it', () => {
    const before = 'Dulu, pahami rasio kopi dan air dulu.';
    expect(shiftLinks(L, T, 'Pahami rasio kopi dan air dulu, ya.')).toEqual(L);
    expect(words('X ' + T, shiftLinks(L, T, 'X ' + T))).toEqual(['rasio kopi']);
    expect(words(before, shiftLinks(L, T.replace('Pahami', 'pahami'), before.replace('Dulu, ', 'Dulu, ')))).toEqual(['rasio kopi']);
    const inside = 'Pahami rasio seduh kopi dan air dulu.';
    expect(words(inside, shiftLinks(L, T, inside))).toEqual(['rasio seduh kopi']);
    const shorter = 'Pahami ras kopi dan air dulu.';
    expect(words(shorter, shiftLinks(L, T, shorter))).toEqual(['ras kopi']);
    /* Typing right after the link does not make the link longer. */
    const after = 'Pahami rasio kopiku dan air dulu.';
    expect(words(after, shiftLinks(L, T, after))).toEqual(['rasio kopi']);
    expect(shiftLinks(undefined, 'a', 'b')).toEqual([]);
    expect(shiftLinks(L, T, T)).toEqual(L);
  });

  it('keeps what is left of a link whose words were partly replaced, and drops one with no words left', () => {
    const cutEnd = 'Pahami rasio teh dulu.';
    /* The space left at its end is trimmed when the text is sent. */
    expect(words(cutEnd, shiftLinks(L, T, cutEnd))).toEqual(['rasio ']);
    expect(collapsed(cutEnd, shiftLinks(L, T, cutEnd)).links).toEqual([{ start: 7, end: 12, article: 4 }]);
    const gone = 'Pahami dan air dulu.';
    expect(shiftLinks(L, T, gone)).toEqual([]);
    expect(shiftLinks(L, T, '')).toEqual([]);
    const two: ArticleLink[] = [...L, { start: 22, end: 25, url: 'https://a.example/' }];   // "air"
    const t2 = 'Pahami rasio kopi serta air dulu.';
    expect(words(t2, shiftLinks(two, T, t2))).toEqual(['rasio kopi', 'air']);
  });

  it('splits links between the two halves of a split text', () => {
    const two: ArticleLink[] = [...L, { start: 22, end: 25, url: 'https://a.example/' }];
    expect(sliceLinks(two, 0, 18)).toEqual(L);
    expect(sliceLinks(two, 18, T.length)).toEqual([{ start: 4, end: 7, url: 'https://a.example/' }]);
    expect(sliceLinks(two, 0, 10)).toEqual([]);
    expect(sliceLinks(undefined, 0, 10)).toEqual([]);
  });

  it('sends the positions as they are in the collapsed text, and plain text when there is no link', () => {
    const spaced = '  Pahami   rasio kopi  dan air dulu. ';
    const at = spaced.indexOf('rasio');
    expect(collapsed(spaced, [{ start: at - 2, end: at + 12, article: 4 }])).toEqual({ text: T, links: [{ start: 7, end: 17, article: 4 }] });
    expect(collapsed(' a  b ', undefined)).toEqual({ text: 'a b', links: [] });
    expect(collapsed('a   b', [{ start: 1, end: 4, article: 1 }])).toEqual({ text: 'a b', links: [] });
    const blocks: DraftBlock[] = [
      { key: 'a', from: 0, type: 'p', text: spaced, links: [{ start: at, end: at + 10, article: 4 }] },
      { key: 'b', from: 1, type: 'h2', text: 'Judul', links: [{ start: 0, end: 5, article: 4 }] },
      { key: 'c', from: 2, type: 'list', items: ['', 'Lihat air', 'Biasa'], links: [[], [{ start: 6, end: 9, url: 'https://a.example/' }], []] },
    ];
    expect(blockEdits(blocks)).toEqual([
      { from: 0, type: 'p', text: T, links: [{ start: 7, end: 17, article: 4 }] },
      { from: 1, type: 'h2', text: 'Judul' },
      { from: 2, type: 'list', items: [{ text: 'Lihat air', links: [{ start: 6, end: 9, url: 'https://a.example/' }] }, 'Biasa'] },
    ]);
    expect(linkCount(blocks)).toBe(2);
  });

  it('adds a link on selected words, and says why it cannot', () => {
    expect(addLink(T, [], 7, 17, { article: 4 })).toEqual(L);
    expect(addLink(T, [], 17, 6, { article: 4 })).toEqual(L);                     // selected backwards, with the space before
    expect(addLink(T, L, 22, 25, { url: 'https://a.example/' })).toEqual([...L, { start: 22, end: 25, url: 'https://a.example/' }]);
    expect(addLink(T, L, 0, 6, { article: 5 })).toEqual([{ start: 0, end: 6, article: 5 }, ...L]);
    expect(addLink(T, [], 5, 5, { article: 4 })).toBe('Select the words the link goes on first.');
    expect(addLink(T, [], 6, 7, { article: 4 })).toBe('Select the words the link goes on first.');
    expect(addLink(T, [], 0, 1, { article: 4 })).toBe('A link goes on at least two characters with a letter or a number.');
    expect(addLink(T, L, 10, 20, { article: 5 })).toBe('Those words are already part of a link. Remove that link first.');
    expect(httpUrl(' https://a.example/x y ')).toBe('https://a.example/x%20y');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'a.example', '']) expect(httpUrl(bad), bad).toBe('');
  });

  it('opens an article with its links and category, counts them as a change, and refuses more than eight', () => {
    const saved = articleContent({ blocks: [{ type: 'p', text: T, en: '', links: L }, { type: 'list', items: [{ text: 'Lihat air', en: '', links: [{ start: 6, end: 9, url: 'https://a.example/' }] }] }] });
    const d = draftOf(saved, 'Teknik seduh');
    expect(d.category).toBe('Teknik seduh');
    expect(isDirty(d, saved, 'Teknik seduh')).toBe(false);
    expect(editBody(d, 1).blocks).toEqual([{ from: 0, type: 'p', text: T, links: L }, { from: 1, type: 'list', items: [{ text: 'Lihat air', links: [{ start: 6, end: 9, url: 'https://a.example/' }] }] }]);
    expect(editBody(d, 1).category).toBe('Teknik seduh');
    expect(isDirty({ ...d, category: ' Biji  kopi ' }, saved, 'Teknik seduh')).toBe(true);
    expect(isDirty({ ...d, category: ' Teknik  seduh ' }, saved, 'Teknik seduh')).toBe(false);
    const unlinked: Draft = { ...d, blocks: d.blocks.map(b => b.type === 'p' ? { ...b, links: [] } : b) };
    expect(isDirty(unlinked, saved, 'Teknik seduh')).toBe(true);
    /* A link does not change the words: the English beside the text still matches. */
    expect(blockEdited(unlinked.blocks[0]!, saved.blocks)).toBe(false);
    const long = Array.from({ length: 9 }, (_, i) => 'kata' + i).join(' ');
    const many: Draft = { ...d, blocks: [{ key: 'x', from: null, type: 'p', text: long, links: Array.from({ length: 9 }, (_, i) => ({ start: i * 6, end: i * 6 + 5, article: i + 1 })) }] };
    expect(problemOf(many)).toBe('An article has at most 8 links in its text. This one has 9: remove some.');
    expect(problemOf({ ...d, category: 'x'.repeat(61) })).toBe('The category is longer than 60 characters.');
  });
});

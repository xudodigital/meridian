// Automated checks on a written article. Computed by the server from the result, never by the model. They cover what
// the skills state (sources for facts, a <title> on every page, a meta description, the keyword where it fits, no
// claim of testing nobody did), duplicate titles/URLs and useful descriptive counts. Counts do not predict
// search snippets or define Google ranking limits; citation presence does not verify factual accuracy.
// Only three things are "bad" and block approval: no source, no title tag, and a URL slug another article of the site
// already uses (two pages cannot share one address). Everything else is a warning for the reviewer to weigh.
//
// Links in the text get a check of their own once the site has other articles: words such as "click here" say nothing
// about the page they lead to (skill internal-linking), a very long anchor is hard to read as a link, and a link to an
// article that is not approved is shown as plain text on the website until it is. None of these blocks approval.
import { linksIn, type ArticleContent, type Block } from './article-content.ts';

export type CheckKind = 'ok' | 'warn' | 'bad' | 'info';
export type Check = { kind: CheckKind; name: string; detail: string };
export type LanguageReview = { by: string; at: number } | null;
/** The site's other articles in review or approved, for the duplicate checks. */
/* `id` and `status` are given by the server (articles.ts siblingsOf) so links to them can be checked. */
export type Sibling = { title: string; slug: string; id?: number; status?: string };

const norm = (t: string) => t.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Characters as a person counts them (a letter with an accent, an emoji or a CJK character is one). */
const chars = (t: string): number => [...t.trim()].length;

/** Every piece of body text of the given side: paragraphs, headings, list items and table cells. */
function bodyTexts(blocks: Block[], side: 'text' | 'en'): string[] {
  return blocks.flatMap(b => b.type === 'list' ? b.items.map(i => i[side]) : b.type === 'table' ? b.rows.flatMap(r => r.map(c => c[side])) : [b[side]]);
}

/** Words in the body, counted the way the language writes them (Thai, Japanese and Chinese have no spaces). */
export function bodyWords(c: ArticleContent): number {
  const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
  let n = 0;
  for (const t of bodyTexts(c.blocks, 'text')) for (const s of seg.segment(t)) if (s.isWordLike) n++;
  return n;
}

/**
 * Phrases that say the authors tested or used something themselves. The agent tests nothing, so such a sentence is
 * true only when a person did. A short list per language; the English one is also run over the reviewer translation,
 * which catches the claim in a language that has no list here.
 */
const FIRST_HAND_EN = ['we tested', 'we tried', 'we have tested', 'we\'ve tested', 'in our test', 'our testing', 'our hands-on', 'we reviewed', 'i tested', 'i tried'];
const FIRST_HAND: string[] = [
  ...FIRST_HAND_EN,
  /* Indonesian, Malay */
  'kami menguji', 'kami telah menguji', 'kami sudah menguji', 'kami mencoba', 'kami telah mencoba', 'kami sudah mencoba', 'pengujian kami', 'kami uji', 'saya menguji', 'saya mencoba', 'kami telah mencuba', 'ujian kami',
  /* Vietnamese */
  'chúng tôi đã thử', 'chúng tôi đã kiểm tra', 'chúng tôi đã dùng thử', 'chúng tôi đã trải nghiệm',
  /* Thai */
  'เราได้ทดสอบ', 'เราทดสอบ', 'เราได้ลอง', 'เราลองใช้',
  /* Filipino */
  'sinubukan namin', 'sinuri namin',
  /* Spanish, Portuguese */
  'hemos probado', 'probamos', 'nuestras pruebas', 'nós testamos', 'testamos', 'nossos testes',
  /* German, French */
  'wir haben getestet', 'in unserem test', 'nous avons testé', 'nos tests',
  /* Japanese */
  '実際に試し', '実際に使ってみ', 'テストしました',
];
/** The first first-hand phrase the article uses, as written in the list; '' when there is none. */
export function firstHandClaim(c: ArticleContent): string {
  const text = norm([c.title, c.metaDescription, ...bodyTexts(c.blocks, 'text')].join(' \n '));
  const en = norm([c.titleEn, ...bodyTexts(c.blocks, 'en')].join(' \n '));
  /* Whole words for phrases in Latin script, so "probamos" is not found inside "comprobamos". Thai and Japanese
     write no spaces between words: there the phrase is looked for as it stands. */
  const has = (hay: string, p: string) => /^[\p{Script=Latin}' -]+$/u.test(p)
    ? new RegExp(`(?<![\\p{L}\\p{M}])${p}(?![\\p{L}\\p{M}])`, 'u').test(hay) : hay.includes(p);
  return FIRST_HAND.find(p => has(text, p)) ?? FIRST_HAND_EN.find(p => has(en, p)) ?? '';
}

/**
 * Link words that say nothing about the page they lead to, in the languages the sites are written in. Compared with
 * the whole anchor, so "cara menyeduh kopi di sini" is fine and "di sini" is not.
 */
const GENERIC_ANCHORS = new Set([
  'click here', 'here', 'read more', 'more', 'learn more', 'see more', 'this', 'this article', 'this page', 'this link', 'link', 'website', 'article', 'page', 'source',
  /* Indonesian, Malay */
  'di sini', 'disini', 'klik di sini', 'klik disini', 'baca selengkapnya', 'selengkapnya', 'baca juga', 'lihat di sini', 'artikel ini', 'halaman ini', 'tautan ini', 'link ini', 'sumber',
  'baca lagi', 'klik sini', 'di sini',
  /* Vietnamese */
  'tại đây', 'ở đây', 'xem thêm', 'đọc thêm', 'bấm vào đây', 'nhấn vào đây', 'bài viết này',
  /* Thai */
  'คลิกที่นี่', 'ที่นี่', 'อ่านต่อ', 'อ่านเพิ่มเติม', 'บทความนี้',
  /* Filipino */
  'dito', 'mag-click dito', 'i-click dito', 'basahin pa', 'magbasa pa',
  /* Spanish, Portuguese */
  'haz clic aquí', 'clic aquí', 'aquí', 'leer más', 'más información', 'este artículo', 'clique aqui', 'aqui', 'leia mais', 'saiba mais', 'este artigo',
  /* German, French */
  'hier', 'hier klicken', 'mehr lesen', 'weiterlesen', 'mehr erfahren', 'dieser artikel', 'cliquez ici', 'ici', 'lire la suite', 'en savoir plus', 'cet article',
  /* Japanese */
  'こちら', 'ここ', 'こちらをクリック', '続きを読む', '詳しくはこちら', 'この記事',
]);
/** An anchor longer than this reads as a linked sentence, not as a link. */
export const ANCHOR_MAX_CHARS = 100;
const bare = (t: string): string => norm(t).replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '');
/** The anchor says nothing about its target ("click here", "read more", "di sini"). */
export const genericAnchor = (anchor: string): boolean => GENERIC_ANCHORS.has(bare(anchor));

/**
 * The check on the links in the text, or null when it does not apply: the article has no link and the site has no
 * other article to link to.
 */
export function linkCheck(c: ArticleContent, others: Sibling[]): Check | null {
  const all = linksIn(c.blocks), name = 'Links in the text';
  const targets = others.filter(o => typeof o.id === 'number');
  if (!all.length) {
    return targets.length ? { kind: 'info', name, detail: `No link to another article of this site. ${plural(targets.length, 'article is', 'articles are')} in review or approved: link to one where it helps the reader.` } : null;
  }
  const internal = all.filter(x => 'article' in x.link), n = internal.length, ext = all.length - n;
  const generic = all.find(x => genericAnchor(x.anchor)), long = all.find(x => chars(x.anchor) > ANCHOR_MAX_CHARS);
  const count = [n ? plural(n, 'link', 'links') + ' to other articles of this site' : '', ext ? plural(ext, 'link', 'links') + ' to sources' : ''].filter(Boolean).join(', ');
  if (generic) return { kind: 'warn', name, detail: `A link is on the words “${generic.anchor}”, which say nothing about the page it leads to. Link words that describe it.` };
  if (long) return { kind: 'warn', name, detail: `A link is on ${chars(long.anchor)} characters of text (“${[...long.anchor].slice(0, 40).join('')}…”). Link a few words that describe the page instead.` };
  const of = (id: number) => others.find(o => o.id === id);
  const gone = internal.find(x => 'article' in x.link && !of(x.link.article));
  if (gone) return { kind: 'warn', name, detail: `The link on “${gone.anchor}” leads to an article that is no longer in review or approved. The website shows those words as plain text: remove the link or choose another article.` };
  const waiting = internal.filter(x => 'article' in x.link && of(x.link.article)?.status !== 'approved');
  if (waiting.length) return { kind: 'info', name, detail: `${count}. ${plural(waiting.length, 'link leads', 'links lead')} to an article that is not approved yet: the website shows the words as plain text until it is.` };
  return { kind: 'ok', name, detail: count };
}

export function articleChecks(c: ArticleContent, keyword: string, review: LanguageReview, others: Sibling[] = []): Check[] {
  const n = c.sources.length, notes = c.reviewerNotes.length;
  const kw = norm(keyword), inTitle = !!kw && (norm(c.title).includes(kw) || norm(c.titleTag).includes(kw));
  const tag = chars(c.titleTag), meta = chars(c.metaDescription), words = bodyWords(c), claim = firstHandClaim(c);
  const slug = norm(c.slug), sameSlug = slug ? others.find(o => norm(o.slug) === slug) : undefined;
  const sameTitle = others.find(o => norm(o.title) === norm(c.title));
  const links = linkCheck(c, others);
  return [
    !n ? { kind: 'bad', name: 'Sources cited', detail: 'No sources. Meridian requires cited evidence for factual articles; a reviewer must check each important claim.' }
      : { kind: 'ok', name: 'Sources cited', detail: plural(n, 'source', 'sources') + ' listed. A citation is not proof that a claim is supported.' },
    !tag ? { kind: 'bad', name: 'Title tag', detail: 'Missing. Every page needs a <title>.' }
      : { kind: 'ok', name: 'Title tag', detail: `${tag} characters. Google has no fixed character limit; display depends on device width and may be rewritten.` },
    !meta ? { kind: 'warn', name: 'Meta description', detail: 'Missing' }
      : { kind: 'ok', name: 'Meta description', detail: `${meta} characters. Google has no fixed character limit and may select a different snippet.` },
    inTitle ? { kind: 'ok', name: 'Keyword in title', detail: 'The title contains the keyword' }
      : { kind: 'info', name: 'Keyword in title', detail: 'The title does not contain the keyword. That is fine when it still describes the page.' },
    sameSlug ? { kind: 'bad', name: 'URL slug', detail: `Another article on this site already uses “${c.slug}” (${sameSlug.title}). Two pages cannot share an address: change the slug.` }
      : { kind: 'ok', name: 'URL slug', detail: slug ? 'No other article on this site uses it' : 'Empty. The website build makes one from the title.' },
    sameTitle ? { kind: 'warn', name: 'Unique title', detail: 'Another article on this site has the same title. Search engines and readers cannot tell them apart.' }
      : { kind: 'ok', name: 'Unique title', detail: 'No other article on this site has this title' },
    { kind: 'info', name: 'Length', detail: `${words.toLocaleString('en-US')} words. Google has no preferred word count; judge whether the reader’s question is answered.` },
    claim ? { kind: 'warn', name: 'First-hand claims', detail: `The text says “${claim}”. The agent tests nothing: keep it only if a person really did.` }
      : { kind: 'ok', name: 'First-hand claims', detail: 'No claim of own testing found' },
    ...(links ? [links] : []),
    notes ? { kind: 'warn', name: 'Notes to check', detail: plural(notes, 'note', 'notes') + ' from the agent for the reviewer' }
      : { kind: 'ok', name: 'Notes to check', detail: 'None' },
    review ? { kind: 'ok', name: 'Language review', detail: 'Done by ' + review.by }
      : { kind: 'warn', name: 'Language review', detail: 'Not done yet' },
  ];
}

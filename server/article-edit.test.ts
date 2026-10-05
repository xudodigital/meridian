// End-to-end tests of what a person does to an article by hand: editing it before approval, the stronger checks an
// edit can fix, sending an approved article back to review, the archive, and writing several articles at once. A real
// server process on a free port with a temporary data folder and the fake CLI. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client, member, owner, saveSites, startServer, until, type Json, type TestServer } from './testkit.ts';

type Check = { kind: string; name: string; detail: string };
type Bi = { text: string; en: string; enStale?: true };
type Block = { type: string; text?: string; en?: string; enStale?: true; items?: Bi[]; rows?: Bi[][] };
type Content = { title: string; titleEn: string; titleEnStale?: true; titleTag: string; metaDescription: string; disclosure: Bi; slug: string; blocks: Block[] };
type Article = Json & {
  id: number; status: string; keyword: string; updatedAt: number; content: Content; checks: Check[]; archivedAt: number | null;
  languageReview: { by: string; at: number } | null; images: { id: string; role: string; after: number | null }[]; photos: { status: string };
  history: { at: number; by: string; action: string; note: string }[];
};
const SITES = ['s1', 's2', 's3'].map(id => ({ id, domain: id + '.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live' }));

let s: TestServer;
let c: Client, editor: Client, viewer: Client, reviewer: Client;
const rid: Record<string, number> = {};

const state = async (who: Client = c) => (await who.get('/api/state')).data as { requests: Json[]; articles: Article[] };
const article = async (id: number) => (await state()).articles.find(a => a.id === id);
const check = (a: Article, name: string) => a.checks.find(x => x.name === name)!;
/** A written article whose photo job is over: an edit that moves blocks is refused while that job runs. */
const settled = (id: number) => until(`article ${id} to be written and its photo job to end`, async () => {
  const a = await article(id);
  return a?.status === 'review' && (a.photos.status === 'done' || a.photos.status === 'failed') ? a : null;
});
async function research(siteId: string): Promise<number> {
  const { data } = await c.post('/api/requests', { siteId, topic: 'cold brew', goal: 'Find a new topic cluster', model: 'GPT-6 Luna' });
  const id = (data.request as Json).id as number;
  await until(`request ${id}`, async () => (await state()).requests.find(r => r.id === id && r.status === 'done'));
  return id;
}
async function written(siteId: string, keyword: string): Promise<Article> {
  const { status, data } = await c.post('/api/articles', { siteId, keyword, requestId: rid[siteId], model: 'GPT-6.1 Sol' });
  assert.equal(status, 201, JSON.stringify(data));
  return settled((data.article as Article).id);
}
const edit = (a: Article, body: Json, who: Client = c) => who.patch(`/api/articles/${a.id}/content`, { updatedAt: a.updatedAt, ...body });
/** The blocks as the editor sends them back unchanged. */
const same = (a: Article): Json[] => a.content.blocks.map((b, from) => b.type === 'list' ? { from, type: 'list', items: b.items!.map(i => i.text) }
  : b.type === 'table' ? { from, type: 'table', rows: b.rows!.map(r => r.map(x => x.text)) } : { from, type: b.type, text: b.text });
const audit = async () => (await c.get('/api/audit')).data.audit as { actor: string; act: string; site: string | null }[];

before(async () => {
  s = await startServer();
  c = await owner(s, 'Owner');
  await saveSites(c, SITES);
  editor = await member(s, c, 'editor', 'ed@example.com', 'Ed Editor');
  viewer = await member(s, c, 'viewer', 'vi@example.com', 'Vi Viewer');
  reviewer = await member(s, c, 'reviewer', 're@example.com', 'Re Reviewer', 's1');
  for (const id of ['s1', 's2', 's3']) rid[id] = await research(id);
});
after(() => s?.stop());

describe('editing an article before approval', () => {
  let a: Article;
  before(async () => { a = await written('s1', 'cara membuat cold brew'); });

  it('saves the title, search fields and slug, computes the checks again and records what changed', async () => {
    assert.equal(check(a, 'Meta description').kind, 'ok', 'length is not a Google ranking limit');
    const r = await edit(a, {
      title: '  Cara Membuat  Cold Brew yang Enak ', titleTag: 'Cara Membuat Cold Brew yang Enak | Kopi',
      metaDescription: 'Rasio kopi dan air, lama rendam, serta cara menyimpan cold brew di rumah supaya tetap segar.', slug: 'Cold Brew di Rumah!',
    }, editor);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const b = r.data.article as Article;
    assert.equal(b.content.title, 'Cara Membuat Cold Brew yang Enak');
    assert.equal(b.content.titleEn, 'How to make cold brew at home', 'the English is kept');
    assert.equal(b.content.titleEnStale, true, 'and marked as not updated');
    assert.equal(b.content.slug, 'cold-brew-di-rumah', 'a slug is made the way the agent\'s is');
    assert.deepEqual(check(b, 'Meta description'), { kind: 'ok', name: 'Meta description', detail: '92 characters. Google has no fixed character limit and may select a different snippet.' });
    assert.deepEqual(b.content.blocks, a.content.blocks, 'the body was not sent, so it is as it was');
    assert.deepEqual(b.history.at(-1), { at: b.history.at(-1)!.at, by: 'Ed Editor', action: 'edited', note: 'Changed the title, the title tag, the meta description and the URL slug.' });
    assert.ok(b.updatedAt > a.updatedAt);
    assert.ok((await audit()).some(e => e.actor === 'Ed Editor' && e.act === 'Edited the article: How to make cold brew at home' && e.site === 's1'));
    a = b;
  });

  it('keeps the English of unchanged text and marks the English of edited or added text', async () => {
    const blocks = [
      { from: 0, type: 'p', text: 'Cold brew dibuat dengan merendam kopi dalam air dingin selama 12 jam.' },
      { type: 'p', text: 'Paragraf baru dari editor.' },
      { from: 1, type: 'h2', text: 'Takaran' },
      { from: 2, type: 'list', items: ['Air', 'Kopi giling sedang', 'Saringan'] },
      { from: 3, type: 'table', rows: [['Rasio'], ['1:10']] },
    ];
    const r = await edit(a, { blocks });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const b = r.data.article as Article;
    assert.deepEqual(b.content.blocks, [
      { type: 'p', text: 'Cold brew dibuat dengan merendam kopi dalam air dingin selama 12 jam.', en: 'Cold brew is made by steeping coffee in cold water.', enStale: true },
      { type: 'p', text: 'Paragraf baru dari editor.', en: '', enStale: true },
      { type: 'h2', text: 'Takaran', en: 'Ratio' },
      { type: 'list', items: [{ text: 'Air', en: 'Water' }, { text: 'Kopi giling sedang', en: 'Coarse ground coffee', enStale: true }, { text: 'Saringan', en: '', enStale: true }] },
      { type: 'table', rows: [[{ text: 'Rasio', en: 'Ratio' }], [{ text: '1:10', en: '1:8', enStale: true }]] },
    ]);
    assert.equal(b.history.at(-1)!.note, 'Changed the text of 3 blocks. Added 1 block.');
    a = b;
  });

  it('clears a language review when the text changed, and keeps it when only the search fields did', async () => {
    const lr = await c.post(`/api/articles/${a.id}/language-review`);
    a = lr.data.article as Article;
    assert.equal(check(a, 'Language review').kind, 'ok');

    let r = await edit(a, { metaDescription: 'Rasio kopi dan air, lama rendam, dan cara menyimpan cold brew di rumah supaya tetap segar.', blocks: same(a) });
    a = r.data.article as Article;
    assert.equal(a.languageReview?.by, 'Owner', 'the reviewed words are all still there');
    assert.equal(check(a, 'Language review').kind, 'ok');
    assert.equal(a.history.at(-1)!.note, 'Changed the meta description.');

    const blocks = same(a);
    blocks[2] = { from: 2, type: 'h2', text: 'Takaran kopi' };
    r = await edit(a, { blocks });
    a = r.data.article as Article;
    assert.equal(a.languageReview, null);
    assert.deepEqual(check(a, 'Language review'), { kind: 'warn', name: 'Language review', detail: 'Not done yet' });
    assert.equal(a.history.at(-1)!.note, 'Changed the text of 1 block. The language review was cleared, because it was done on the text before this edit.');
  });

  it('answers a save without a change with the article as it is, and leaves no trace', async () => {
    const r = await edit(a, { title: a.content.title, blocks: same(a) });
    assert.equal(r.status, 200);
    assert.equal((r.data.article as Article).history.length, a.history.length);
    assert.equal((r.data.article as Article).updatedAt, a.updatedAt);
  });

  it('allows an honest disclosure update after review, preserves the body, and requires review of the new words', async () => {
    a = (await c.post(`/api/articles/${a.id}/language-review`)).data.article as Article;
    const before = a.content;
    const r = await edit(a, { disclosure: 'Disusun dengan bantuan AI, kemudian dibaca dan disetujui manusia.' });
    assert.equal(r.status, 200);
    a = r.data.article as Article;
    assert.deepEqual(a.content.blocks, before.blocks);
    assert.equal(a.content.disclosure.en, before.disclosure.en);
    assert.equal(a.content.disclosure.enStale, true);
    assert.equal(a.languageReview, null);
    assert.match(a.history.at(-1)!.note, /Changed the disclosure/);
    assert.equal((await edit(a, { disclosure: '' })).status, 400);
    assert.equal((await edit(a, { disclosure: 'x'.repeat(1001) })).status, 400);
  });

  it('refuses an edit of a version that changed meanwhile, and never merges', async () => {
    const stale = a;
    a = (await edit(a, { titleTag: 'Cold Brew di Rumah | Kopi' })).data.article as Article;
    const r = await edit(stale, { title: 'Judul dari tab lain' });
    assert.equal(r.status, 409);
    assert.match(String(r.data.error), /changed by someone else while you were editing/);
    assert.equal((await article(a.id))!.content.title, a.content.title);
    assert.equal((await c.patch(`/api/articles/${a.id}/content`, { title: 'x' })).status, 400, 'an edit must say which version it changes');
  });

  it('refuses text over a limit by naming the piece, an article without a paragraph, and a shape it does not know', async () => {
    const long = await edit(a, { blocks: [{ from: 0, type: 'p', text: 'a'.repeat(3001) }] });
    assert.equal(long.status, 400);
    assert.equal(long.data.error, 'Paragraph (block 1) is 3,001 characters long. The limit is 3,000: shorten it or split it.');
    assert.match(String((await edit(a, { titleTag: 't'.repeat(201) })).data.error), /^The title tag is 201 characters long/);
    assert.equal((await edit(a, { title: '   ' })).data.error, 'The article needs a title.');
    assert.equal((await edit(a, { blocks: [{ from: 2, type: 'h2', text: 'Hanya judul' }] })).data.error, 'The article needs at least one paragraph.');
    for (const blocks of [[{ type: 'script', text: 'x' }], [{ from: 99, type: 'p', text: 'x' }], [{ from: 0, type: 'p', text: 'x' }, { from: 0, type: 'p', text: 'y' }], 'text'])
      assert.equal((await edit(a, { blocks })).status, 400, JSON.stringify(blocks));
    assert.deepEqual((await article(a.id))!.content, a.content, 'nothing of a refused edit is saved');
  });

  it('is for admins and editors, and only while the article waits for review', async () => {
    assert.equal((await edit(a, { title: 'x' }, viewer)).status, 403);
    assert.equal((await edit(a, { title: 'x' }, reviewer)).status, 403);
    assert.equal((await c.patch('/api/articles/99999/content', { updatedAt: 1, title: 'x' })).status, 404);
    assert.equal((await new Client(s.base).patch(`/api/articles/${a.id}/content`, { updatedAt: 1, title: 'x' })).status, 401);
    /* Without our header a write is not from this dashboard. */
    assert.equal((await fetch(`${s.base}/api/articles/${a.id}/content`, { method: 'PATCH', headers: { cookie: 'meridian_session=' + c.cookie, 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await c.post(`/api/articles/${a.id}/language-review`)).status, 200);
    assert.equal((await c.post(`/api/articles/${a.id}/approve`)).status, 200);
    const r = await edit((await article(a.id))!, { title: 'x' });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'This article is approved. Send it back to review first, then edit it.');
  });
});

describe('photos when blocks move', () => {
  const photo = (id: string, after: number | null) => ({ id, role: after === null ? 'hero' : 'inline', after, file: id, ext: 'jpg', widths: [800], width: 800, height: 600, alt: id, altEn: id, caption: '', captionEn: '',
    title: '', author: '', authorUrl: '', license: 'CC0', licenseUrl: '', sourceUrl: '', provider: 'Wikimedia Commons' });
  const places = (x: Article) => Object.fromEntries(x.images.map(p => [p.id, p.after]));
  let a: Article;

  before(async () => {
    writeFileSync(join(s.fakeDir, 'article.txt'), JSON.stringify({
      title: 'Kopi Tubruk', titleEn: 'Tubruk coffee', titleTag: 'Kopi Tubruk | Kopi', metaDescription: 'Cara menyeduh kopi tubruk.', slug: 'kopi-tubruk',
      byline: { text: 'Tim', en: 'Team' }, disclosure: { text: 'AI.', en: 'AI.' },
      blocks: [
        { type: 'p', text: 'Nol.', en: 'Zero.' }, { type: 'h2', text: 'Satu', en: 'One' }, { type: 'p', text: 'Dua.', en: 'Two.' },
        { type: 'list', items: [{ text: 'Tiga', en: 'Three' }] }, { type: 'h2', text: 'Empat', en: 'Four' }, { type: 'p', text: 'Lima.', en: 'Five.' },
      ],
      sources: [{ title: 'A', url: 'https://a.example/' }, { title: 'B', url: 'https://b.example/' }], reviewerNotes: [],
    }));
    a = await written('s2', 'kopi tubruk');
    /* The photo job found nothing (no Commons in this test): three photos are placed by hand, after blocks 0, 2 and 4. */
    s.db().prepare('UPDATE articles SET images = ? WHERE id = ?').run(JSON.stringify([photo('p1', null), photo('p2', 0), photo('p3', 2), photo('p4', 4)]), a.id);
    a = (await article(a.id))!;
  });

  it('keeps every photo after its block when blocks are reordered or added', async () => {
    const b = same(a);
    /* Block 4 ("Empat") and its paragraph move to the top; a new paragraph goes in after them. */
    const r = await edit(a, { blocks: [b[4], b[5], { type: 'p', text: 'Baru.' }, b[0], b[1], b[2], b[3]] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    a = r.data.article as Article;
    assert.deepEqual(places(a), { p1: null, p2: 3, p3: 5, p4: 0 });
    assert.equal(a.history.at(-1)!.note, 'Changed the order of the blocks. Added 1 block.');
  });

  it('moves the photo of a removed block to the nearest heading or paragraph before it, and never doubles up while a free one is left', async () => {
    /* Now: 0 Empat (p4), 1 Lima, 2 Baru, 3 Nol (p2), 4 Satu, 5 Dua (p3), 6 list. Remove "Nol" and "Dua". */
    const b = same(a);
    const r = await edit(a, { blocks: [b[0], b[1], b[2], b[4], b[6]] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    a = r.data.article as Article;
    /* p2 was after "Nol": the block before it, "Baru", takes it. p3 was after "Dua": "Satu" before it takes it. */
    assert.deepEqual(places(a), { p1: null, p2: 2, p3: 3, p4: 0 });
    assert.equal(a.history.at(-1)!.note, 'Removed 2 blocks.');

    /* A heading that becomes an h3 cannot carry a photo: p3 moves to the paragraph before, which p2 has, so it takes the free one before that. */
    const b2 = same(a);
    b2[3] = { from: 3, type: 'h3', text: 'Satu' };
    a = (await edit(a, { blocks: b2 })).data.article as Article;
    assert.deepEqual(places(a), { p1: null, p2: 2, p3: 1, p4: 0 });
  });

  it('refuses to renumber blocks while the Site Builder is choosing photos, but saves a change of words', async () => {
    s.db().prepare(`UPDATE articles SET photos_status = 'work' WHERE id = ?`).run(a.id);
    try {
      const b = same(a);
      const moved = await edit(a, { blocks: [b[1], b[0], ...b.slice(2)] });
      assert.equal(moved.status, 409);
      assert.match(String(moved.data.error), /choosing photos for this article right now/);
      b[1] = { from: 1, type: 'p', text: 'Lima, diubah.' };
      const words = await edit(a, { blocks: b });
      assert.equal(words.status, 200, JSON.stringify(words.data));
      a = words.data.article as Article;
    } finally { s.db().prepare(`UPDATE articles SET photos_status = 'done' WHERE id = ?`).run(a.id); }
  });
});

describe('a second article with the same URL slug', () => {
  it('cannot be approved until a person changes the slug', async () => {
    writeFileSync(join(s.fakeDir, 'article.txt'), JSON.stringify({
      title: 'Kopi Tubruk', titleEn: 'Tubruk coffee again', titleTag: 'Kopi Tubruk | Kopi', metaDescription: 'x', slug: 'kopi-tubruk',
      blocks: [{ type: 'p', text: 'Isi.', en: 'Body.' }], sources: [{ title: 'A', url: 'https://a.example/' }], reviewerNotes: [],
    }));
    let b = await written('s2', 'kopi tubruk asli');
    assert.equal(check(b, 'URL slug').kind, 'bad');
    assert.match(check(b, 'URL slug').detail, /already uses “kopi-tubruk” \(Kopi Tubruk\)/);
    assert.equal(check(b, 'Unique title').kind, 'warn');
    await c.post(`/api/articles/${b.id}/language-review`);
    const no = await c.post(`/api/articles/${b.id}/approve`);
    assert.equal(no.status, 409);
    assert.match(String(no.data.error), /automated check failed/);

    b = (await edit((await article(b.id))!, { slug: 'kopi tubruk asli', titleTag: 'Kopi Tubruk Asli | Kopi' })).data.article as Article;
    assert.deepEqual(check(b, 'URL slug'), { kind: 'ok', name: 'URL slug', detail: 'No other article on this site uses it' });
    assert.equal(b.languageReview?.by, 'Owner', 'the slug is not text a native speaker reviewed');
    assert.equal((await c.post(`/api/articles/${b.id}/approve`)).status, 200);
    /* Another site may use the same slug. */
    const other = await written('s3', 'kopi tubruk');
    assert.equal(check(other, 'URL slug').kind, 'ok');
    assert.equal(check(other, 'Unique title').kind, 'ok');
  });
});

describe('after the decision', () => {
  let a: Article;
  before(async () => {
    const id = (await state()).articles.find(x => x.siteId === 's1' && x.status === 'approved')!.id;
    a = (await article(id))!;
  });

  it('sends an approved article back to review; the next website build leaves it out', async () => {
    assert.equal((await viewer.post(`/api/articles/${a.id}/unapprove`)).status, 403);
    assert.equal((await reviewer.post(`/api/articles/${a.id}/unapprove`)).status, 403);
    const r = await editor.post(`/api/articles/${a.id}/unapprove`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const b = r.data.article as Article;
    assert.equal(b.status, 'review');
    assert.deepEqual([b.history.at(-1)!.by, b.history.at(-1)!.action], ['Ed Editor', 'unapproved']);
    assert.equal(b.languageReview?.by, 'Owner', 'the text did not change, so its language review stands');
    assert.ok((await audit()).some(e => e.actor === 'Ed Editor' && e.act.startsWith('Sent back to review: ')));
    /* It was the site's only approved article: there is nothing to build now. */
    const build = await c.post('/api/sites/s1/builds');
    assert.equal(build.status, 409);
    assert.match(String(build.data.error), /Approve at least one article/);
    const again = await editor.post(`/api/articles/${a.id}/unapprove`);
    assert.equal(again.status, 409);
    assert.equal(again.data.error, 'Only an approved article can be sent back to review.');
    /* Back in review it can be edited and approved again. */
    assert.equal((await edit(b, { titleTag: 'Cold Brew | Kopi' })).status, 200);
    assert.equal((await c.post(`/api/articles/${a.id}/approve`)).status, 200);
  });

  it('archives a decided article and brings it back; one waiting for review cannot be archived', async () => {
    assert.equal((await viewer.post(`/api/articles/${a.id}/archive`)).status, 403);
    const r = await editor.post(`/api/articles/${a.id}/archive`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const b = r.data.article as Article;
    assert.equal(b.status, 'approved', 'archiving changes nothing but where it is listed');
    assert.ok(b.archivedAt && b.archivedAt <= Date.now());
    assert.equal(b.history.at(-1)!.action, 'archived');
    assert.equal((await editor.post(`/api/articles/${a.id}/archive`)).data.error, 'This article is already archived.');
    assert.ok((await state()).articles.find(x => x.id === a.id)!.archivedAt, 'still sent: the list hides it');

    /* Sending it back to review takes it out of the archive: nobody could review what the list hides. */
    const back = (await editor.post(`/api/articles/${a.id}/unapprove`)).data.article as Article;
    assert.equal(back.archivedAt, null);
    const waiting = await editor.post(`/api/articles/${a.id}/archive`);
    assert.equal(waiting.status, 409);
    assert.match(String(waiting.data.error), /Only an approved, rejected or failed article can be archived/);

    assert.equal((await c.post(`/api/articles/${a.id}/reject`, { note: 'Not needed' })).status, 200);
    assert.ok(((await c.post(`/api/articles/${a.id}/archive`)).data.article as Article).archivedAt);
    const out = await c.post(`/api/articles/${a.id}/unarchive`);
    assert.equal((out.data.article as Article).archivedAt, null);
    assert.equal((out.data.article as Article).history.at(-1)!.action, 'unarchived');
    assert.equal((await c.post(`/api/articles/${a.id}/unarchive`)).status, 409);
    assert.ok((await audit()).some(e => e.act.startsWith('Archived the article: ')) && (await audit()).some(e => e.act.startsWith('Took the article out of the archive: ')));
  });
});

describe('writing several articles at once', () => {
  type Result = { keyword: string; ok: boolean; status?: number; error?: string; article?: Article };
  const bulk = (body: Json, who: Client = c) => who.post('/api/articles/bulk', body);

  it('starts one article per keyword and says for each one what happened', async () => {
    /* Slow jobs, so the articles of this test are still waiting when the next ones are asked for. */
    writeFileSync(join(s.fakeDir, 'delay'), '400');
    const r = await bulk({ requestId: rid.s3, keywords: ['rasio cold brew', ' Rasio  Cold Brew ', 'kopi tubruk', 'cold brew tanpa alat', ''], model: 'GPT-6.1 Sol' }, editor);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const results = r.data.results as Result[];
    assert.deepEqual(results.map(x => [x.keyword, x.ok, x.status ?? 0]), [['rasio cold brew', true, 0], ['kopi tubruk', false, 409], ['cold brew tanpa alat', true, 0]]);
    assert.match(String(results[1]!.error), /already queued, being written or waiting for review/);
    assert.equal(r.data.created, 2);
    assert.ok(results[0]!.article!.id && results[0]!.article!.siteId === 's3', 'the site is the research request\'s');
    assert.deepEqual(results[0]!.article!.history.map(h => [h.by, h.action]), [['Ed Editor', 'requested']]);
    const log = await audit();
    for (const k of ['rasio cold brew', 'cold brew tanpa alat']) assert.ok(log.some(e => e.actor === 'Ed Editor' && e.act === 'Requested an article: ' + k && e.site === 's3'), k);
  });

  it('takes at most 10 keywords, needs a finished request, and is for admins and editors', async () => {
    const eleven = await bulk({ requestId: rid.s3, keywords: Array.from({ length: 11 }, (_, i) => 'kata ' + i) });
    assert.equal(eleven.status, 400);
    assert.equal(eleven.data.error, 'Choose at most 10 keywords at a time.');
    assert.equal((await bulk({ requestId: rid.s3, keywords: [] })).data.error, 'Choose at least one keyword.');
    assert.equal((await bulk({ requestId: 99999, keywords: ['a'] })).status, 400);
    assert.equal((await bulk({ requestId: rid.s3, keywords: ['a'] }, viewer)).status, 403);
    assert.equal((await bulk({ requestId: rid.s3, keywords: ['a'] }, reviewer)).status, 403);
  });

  it('keeps to the queue limit per site: the keywords over it are refused, the others start', async () => {
    const waiting = () => (s.db().prepare(`SELECT COUNT(*) AS n FROM articles WHERE site_id = 's3' AND status IN ('queued', 'revision')`).get() as { n: number }).n
      + (s.db().prepare(`SELECT COUNT(*) AS n FROM articles WHERE site_id = 's3' AND photos_status = 'queued'`).get() as { n: number }).n;
    /* Fill the site's queue up to two below its limit of 20 with articles that wait far behind everything else. */
    const add = s.db().prepare(`INSERT INTO articles (site_id, domain, country, lang, keyword, request_id, created_at, queued_at) VALUES ('s3', 's3.example', 'Indonesia', 'Indonesian', ?, ?, ?, ?)`);
    const far = Date.now() + 3_600_000;
    for (let i = waiting(); i < 18; i++) add.run('pengisi ' + i, rid.s3!, far, far);
    const r = await bulk({ requestId: rid.s3, keywords: ['satu', 'dua', 'tiga', 'empat'] });
    const results = r.data.results as Result[];
    const started = results.filter(x => x.ok).length;
    assert.ok(started >= 2 && started < 4, JSON.stringify(results.map(x => [x.keyword, x.ok])));
    const refused = results.filter(x => !x.ok);
    assert.ok(refused.every(x => x.status === 429 && /20 jobs are already waiting for this site/.test(String(x.error))), JSON.stringify(refused));
    assert.equal(r.data.created, started);
    s.db().prepare(`DELETE FROM articles WHERE keyword LIKE 'pengisi %'`).run();
    writeFileSync(join(s.fakeDir, 'delay'), '0');
  });
});

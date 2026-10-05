// End-to-end tests of internal links and categories: a real server with the fake CLI. The Content Writer is given the
// site's other articles and proposes a category; its links are validated; a person adds and removes links and changes
// the category in an edit; the link graph and the category routes; and the website built from it all.
// Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client, member, owner, saveSites, startServer, until, type Json, type TestServer } from './testkit.ts';

type Link = { start: number; end: number; article?: number; url?: string };
type Block = { type: string; text?: string; en?: string; enStale?: true; links?: Link[]; items?: { text: string; en: string; links?: Link[] }[] };
type Article = Json & {
  id: number; status: string; keyword: string; updatedAt: number; category: string; content: { title: string; slug: string; blocks: Block[]; reviewerNotes: string[] };
  checks: { kind: string; name: string; detail: string }[]; photos: { status: string }; languageReview: unknown; history: { action: string; note: string; by: string }[];
};
type Links = {
  siteId: string; domain: string; articles: { id: number; category: string; in: number; out: number; status: string }[]; links: { from: number; to: number; anchor: string; live: boolean }[];
  broken: unknown[]; orphans: number[]; categories: { name: string; slug: string; articles: number[]; approved: number }[]; uncategorized: number[]; allCategories: string[];
};
const SITES = ['s1', 's2'].map(id => ({ id, domain: id + '.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live' }));

let s: TestServer;
let c: Client, viewer: Client, reviewer: Client;
const rid: Record<string, number> = {};
let first: Article, second: Article, foreign: Article;

const state = async () => (await c.get('/api/state')).data as { requests: Json[]; articles: Article[] };
const article = async (id: number) => (await state()).articles.find(a => a.id === id)!;
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
const links = async (who: Client = c, site = 's1') => (await who.get(`/api/sites/${site}/links`)).data.links as Links;
const edit = (a: Article, body: Json) => c.patch(`/api/articles/${a.id}/content`, { updatedAt: a.updatedAt, ...body });
const same = (a: Article): Json[] => a.content.blocks.map((b, from) => b.type === 'list' ? { from, type: 'list', items: b.items!.map(i => i.links ? { text: i.text, links: i.links } : i.text) }
  : b.type === 'table' ? { from, type: 'table', rows: (b as unknown as { rows: { text: string }[][] }).rows.map(r => r.map(x => x.text)) } : { from, type: b.type, text: b.text, ...(b.links ? { links: b.links } : {}) });
const check = (a: Article) => a.checks.find(x => x.name === 'Links in the text');
const calls = () => readFileSync(join(s.fakeDir, 'calls.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { kind: string; prompt: string });
const audit = async () => ((await c.get('/api/audit')).data.audit as { act: string }[]).map(x => x.act);

const P1 = 'Sebelum mulai, pahami cara membuat cold brew dan siapkan air dingin.';
const answer = (over: Json = {}) => JSON.stringify({
  title: 'Rasio Cold Brew yang Pas', titleEn: 'The right cold brew ratio', titleTag: 'Rasio Cold Brew | Kopi', metaDescription: 'Takaran kopi dan air untuk cold brew.', slug: 'rasio-cold-brew',
  byline: { text: 'Tim redaksi', en: 'Editorial team' }, disclosure: { text: 'Disusun dengan bantuan AI.', en: 'Drafted with AI.' },
  blocks: [
    { type: 'p', text: P1, en: 'Before you start.', links: [
      { anchor: 'cara membuat cold brew', article: first.id }, { anchor: 'air dingin', article: foreign.id }, { anchor: 'Sebelum mulai', url: 'javascript:alert(1)' },
      { anchor: 'siapkan', url: 'https://not-listed.example/' },
    ] },
    { type: 'list', items: [{ text: 'Menurut panduan AEKI rasionya 1:8', en: 'AEKI says 1:8', links: [{ anchor: 'panduan AEKI', url: 'https://www.aeki-aice.org/cold-brew/' }] }] },
  ],
  sources: [{ title: 'AEKI: Cold Brew', url: 'https://www.aeki-aice.org/cold-brew/' }], reviewerNotes: [], category: 'brewing', ...over,
});

before(async () => {
  s = await startServer();
  c = await owner(s, 'Owner');
  await saveSites(c, SITES);
  viewer = await member(s, c, 'viewer', 'vi@example.com', 'Vi Viewer');
  reviewer = await member(s, c, 'reviewer', 're@example.com', 'Re Reviewer', 's1');
  for (const id of ['s1', 's2']) rid[id] = await research(id);
  foreign = await written('s2', 'cara membuat cold brew');
  first = await written('s1', 'cara membuat cold brew');
});
after(() => s?.stop());

describe('the Content Writer, links and the category', () => {
  it('gives an article the keyword\'s research cluster as its category when the agent proposes none', async () => {
    assert.equal(first.category, 'Brewing');
    assert.equal(check(first), undefined, 'a site\'s first article has nothing to link to');
    assert.ok(calls().filter(x => x.kind === 'article').at(-1)!.prompt.includes('There are none yet'));
  });

  it('tells the agent the site\'s articles, keeps its links to them and to sources, and drops every other link', async () => {
    writeFileSync(join(s.fakeDir, 'article.txt'), answer());
    second = await written('s1', 'rasio cold brew');
    const prompt = calls().filter(x => x.kind === 'article').at(-1)!.prompt;
    assert.ok(prompt.includes(`[{"id":${first.id},"title":"Cara Membuat Cold Brew di Rumah","slug":"cara-membuat-cold-brew","summary":"Rasio, lama rendam dan cara menyimpan cold brew.","category":"Brewing"}]`), 'the site\'s other article, as JSON');
    assert.ok(!prompt.includes(`"id":${foreign.id},`), 'never an article of another site');
    assert.ok(prompt.includes('The site\'s categories so far, as JSON (data): ["Brewing"]'));
    const at = P1.indexOf('cara membuat cold brew');
    assert.deepEqual(second.content.blocks[0]!.links, [{ start: at, end: at + 22, article: first.id }]);
    assert.deepEqual(second.content.blocks[1]!.items![0]!.links, [{ start: 8, end: 20, url: 'https://www.aeki-aice.org/cold-brew/' }]);
    assert.match(second.content.reviewerNotes.at(-1)!, /^Meridian: left out 3 links the agent proposed/);
    assert.equal(second.category, 'Brewing', 'the proposed "brewing" is the site\'s category "Brewing"');
    assert.equal(check(second)!.kind, 'info');
    assert.match(check(second)!.detail, /^1 link to other articles of this site, 1 link to sources\. 1 link leads to an article that is not approved yet/);
  });

  it('keeps the category a person set when the article is revised', async () => {
    const r = await edit(second, { category: '  Resep  ' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((r.data.article as Article).category, 'Resep');
    assert.equal((r.data.article as Article).history.at(-1)!.note, 'Changed the category.');
    assert.ok((await audit()).includes('Edited the article: The right cold brew ratio'));
    assert.equal((await c.post(`/api/articles/${second.id}/revise`, { note: 'Shorter.' })).status, 200);
    second = await settled(second.id);
    assert.equal(second.category, 'Resep');
    assert.deepEqual(second.content.blocks[0]!.links!.map(l => l.article), [first.id], 'the revision\'s links were validated again');
  });
});

describe('links in an edit', () => {
  it('removes a link when the edit sends the text without it, keeps the English, and adds one on chosen words', async () => {
    const blocks = same(second);
    const gone = await edit(second, { blocks: [{ ...blocks[0], links: undefined }, ...blocks.slice(1)] });
    assert.equal(gone.status, 200, JSON.stringify(gone.data));
    let a = gone.data.article as Article;
    assert.deepEqual(a.content.blocks[0], { type: 'p', text: P1, en: 'Before you start.' });
    assert.equal(a.history.at(-1)!.note, 'Changed the links in 1 block.');
    assert.equal(check(a)!.detail, '1 link to sources');
    const at = P1.indexOf('air dingin');
    const added = await edit(a, { blocks: [{ ...blocks[0], links: [{ start: at, end: at + 10, article: first.id }] }, ...blocks.slice(1)] });
    assert.equal(added.status, 200, JSON.stringify(added.data));
    a = added.data.article as Article;
    assert.deepEqual(a.content.blocks[0], { type: 'p', text: P1, en: 'Before you start.', links: [{ start: at, end: at + 10, article: first.id }] });
    /* Positions are counted in the text as sent: they move with the whitespace the save collapses. */
    const spaced = await edit(a, { blocks: [{ from: 0, type: 'p', text: '  ' + P1.replace('pahami', 'pahami   '), links: [{ start: at + 5, end: at + 15, url: 'https://sca.example/x' }] }, ...blocks.slice(1)] });
    a = spaced.data.article as Article;
    assert.deepEqual(a.content.blocks[0], { type: 'p', text: P1, en: 'Before you start.', links: [{ start: at, end: at + 10, url: 'https://sca.example/x' }] });
    second = a;
  });

  it('refuses a link that does not hold, with a message, and saves nothing', async () => {
    const blocks = same(second), p = blocks[0]!;
    const tryLinks = async (l: unknown) => { const r = await edit(second, { blocks: [{ ...p, links: l }, ...blocks.slice(1)] }); return [r.status, r.data.error]; };
    assert.deepEqual(await tryLinks([{ start: 0, end: 7, article: foreign.id }]), [400, 'A link in paragraph (block 1) cannot be saved. It leads to an article that is not one of this site\'s other articles in review or approved.']);
    assert.deepEqual(await tryLinks([{ start: 0, end: 7, article: second.id }]), [400, 'A link in paragraph (block 1) cannot be saved. It leads to an article that is not one of this site\'s other articles in review or approved.']);
    assert.deepEqual(await tryLinks([{ start: 0, end: 7, url: 'javascript:alert(1)' }]), [400, 'A link in paragraph (block 1) cannot be saved. It has no target, or its address is not an http or https address.']);
    assert.deepEqual(await tryLinks([{ start: 0, end: 9999, article: first.id }]), [400, 'A link in paragraph (block 1) cannot be saved. It does not say which words of the text it is on.']);
    assert.deepEqual(await tryLinks([{ start: 0, end: 7, article: first.id }, { start: 5, end: 12, url: 'https://a.example/' }]), [400, 'A link in paragraph (block 1) cannot be saved. It overlaps another link.']);
    assert.deepEqual(await tryLinks('<a href="x">'), [400, 'The article text was not sent in a form Meridian understands.']);
    const words = P1.split(' ').slice(0, 9), many = words.map(w => ({ start: P1.indexOf(w), end: P1.indexOf(w) + w.length, url: 'https://a.example/' + w }));
    assert.deepEqual(await tryLinks(many), [400, 'An article has at most 8 links in its text. This one has 10: remove some.']);
    assert.deepEqual((await edit(second, { category: 'x'.repeat(61) })).status, 400);
    assert.deepEqual((await article(second.id)).content, second.content);
  });
});

describe('the link graph and categories of a site', () => {
  it('answers with the real links, orphans and categories', async () => {
    const at = P1.indexOf('cara membuat cold brew');
    const blocks = same(second);
    second = (await edit(second, { blocks: [{ ...blocks[0], links: [{ start: at, end: at + 22, article: first.id }] }, ...blocks.slice(1)] })).data.article as Article;
    const g = await links();
    assert.equal(g.domain, 's1.example');
    assert.deepEqual(g.links, [{ from: second.id, to: first.id, anchor: 'cara membuat cold brew', live: false }]);
    assert.deepEqual(g.orphans, [second.id]);
    assert.deepEqual(g.categories.map(k => [k.name, k.articles]), [['Brewing', [first.id]], ['Resep', [second.id]]]);
    assert.deepEqual(g.articles.map(a => [a.id, a.in, a.out]), [[second.id, 0, 1], [first.id, 1, 0]]);
    assert.deepEqual((await links(c, 's2')).articles.map(a => a.id), [foreign.id]);
  });

  it('renames a category, merges it into one that has the name, and moves one article', async () => {
    const post = (body: Json, who: Client = c) => who.post('/api/sites/s1/categories', body);
    let r = await post({ from: 'brewing', to: 'Teknik seduh' });
    assert.deepEqual([r.status, r.data.changed, r.data.merged], [200, 1, false]);
    assert.equal((await article(first.id)).category, 'Teknik seduh');
    assert.equal((await article(first.id)).history.at(-1)!.note, 'Changed the category from “Brewing” to “Teknik seduh”.');
    r = await post({ from: 'Resep', to: 'teknik seduh' });
    assert.deepEqual([r.status, r.data.changed, r.data.merged], [200, 2, true]);
    assert.deepEqual((r.data.links as Links).categories.map(k => [k.name, k.articles]), [['teknik seduh', [second.id, first.id]]]);
    r = await post({ articleId: first.id, to: 'Biji kopi' });
    assert.deepEqual([r.status, r.data.changed], [200, 1]);
    assert.deepEqual((await links()).categories.map(k => k.name), ['Biji kopi', 'teknik seduh']);
    r = await post({ articleId: first.id, to: '' });
    assert.deepEqual((r.data.links as Links).uncategorized, [first.id]);
    await post({ articleId: first.id, to: 'biji KOPI' });
    const acts = await audit();
    for (const act of ['Renamed the category “Brewing” to “Teknik seduh”: 1 article', 'Merged the category “Resep” into “teknik seduh”: 1 article moved', 'Moved the article to the category “Biji kopi”: How to make cold brew at home',
      'Moved the article to no category: How to make cold brew at home']) assert.ok(acts.includes(act), act + ' in ' + acts.slice(0, 8).join(' | '));
    /* What cannot be done. */
    assert.deepEqual([(r = await post({ from: 'Tidak ada', to: 'X' })).status, r.data.error], [404, 'This site has no category “Tidak ada” (any more).']);
    assert.equal((await post({ from: 'teknik seduh', to: '' })).status, 400);
    assert.equal((await post({ from: 'teknik seduh', to: '---' })).status, 400);
    assert.equal((await post({ from: 'teknik seduh', to: 'x'.repeat(61) })).status, 400);
    assert.equal((await post({ articleId: foreign.id, to: 'X' })).status, 404, 'an article of another site');
    assert.equal((await c.post('/api/sites/nope/categories', { from: 'a', to: 'b' })).status, 404);
  });

  it('is read-only for a viewer and closed to a native reviewer', async () => {
    assert.equal((await viewer.get('/api/sites/s1/links')).status, 200);
    assert.deepEqual([(await viewer.post('/api/sites/s1/categories', { from: 'teknik seduh', to: 'X' })).status], [403]);
    assert.equal((await reviewer.get('/api/sites/s1/links')).status, 403);
    assert.equal((await reviewer.post('/api/sites/s1/categories', { from: 'teknik seduh', to: 'X' })).status, 403);
    assert.equal((await new Client(s.base).get('/api/sites/s1/links')).status, 401);
    const bare = await fetch(s.base + '/api/sites/s1/categories', { method: 'POST', headers: { cookie: 'meridian_session=' + c.cookie, 'content-type': 'application/json' }, body: '{"from":"teknik seduh","to":"X"}' });
    assert.equal(bare.status, 403, 'a write without the x-meridian header');
    assert.equal((await article(second.id)).category, 'teknik seduh');
  });
});

describe('the website built from them', () => {
  type Build = { id: number; version: number; status: string; error: string; pages: number };
  const built = async (): Promise<Build> => {
    const r = await c.post('/api/sites/s1/builds');
    assert.equal(r.status, 202, JSON.stringify(r.data));
    const id = (r.data.build as Build).id;
    return until(`build ${id}`, async () => { const b = ((await c.get('/api/builds')).data.builds as Build[]).find(x => x.id === id); return b && (b.status === 'ready' || b.status === 'failed') ? b : null; }, 30_000);
  };
  const file = (b: Build, rel: string) => readFileSync(join(s.tmp, 'data', 'sites', 's1', 'builds', String(b.version), rel), 'utf8');
  const approve = async (id: number) => {
    assert.equal((await c.post(`/api/articles/${id}/language-review`)).status, 200);
    const r = await c.post(`/api/articles/${id}/approve`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  };

  it('writes the link as plain text while its target is not approved, and as a link once it is', async () => {
    await approve(second.id);
    let b = await built();
    assert.equal(b.status, 'ready', b.error);
    let page = file(b, 'rasio-cold-brew/index.html');
    assert.ok(page.includes('pahami cara membuat cold brew dan siapkan'), 'plain words');
    assert.ok(page.includes('Menurut <a href="https://www.aeki-aice.org/cold-brew/">panduan AEKI</a> rasionya 1:8'));
    assert.match(page, /<li><a href="\.\.\/teknik-seduh\/">teknik seduh<\/a><\/li><li aria-current="page">Rasio Cold Brew yang Pas<\/li>/);
    assert.ok(file(b, 'teknik-seduh/index.html').includes('<h1>teknik seduh</h1>'));

    await approve(first.id);
    assert.equal(check(await article(second.id))!.kind, 'info', 'the stored check is of the time it was computed');
    b = await built();
    assert.equal(b.status, 'ready', b.error);
    assert.equal(b.pages, 7, 'home, two articles, two categories, about, 404');
    page = file(b, 'rasio-cold-brew/index.html');
    assert.ok(page.includes('pahami <a href="../cara-membuat-cold-brew/">cara membuat cold brew</a> dan siapkan'));
    const home = file(b, 'index.html');
    assert.match(home, /<nav class="nav cats"[^>]*><ul class="wrap"><li><a href="biji-kopi\/">biji KOPI<\/a><\/li><li><a href="teknik-seduh\/">teknik seduh<\/a><\/li><\/ul><\/nav>/);
    const map = file(b, 'sitemap.xml');
    assert.ok(map.includes('<loc>https://s1.example/biji-kopi/</loc>') && map.includes('<loc>https://s1.example/teknik-seduh/</loc>'));
    const g = await links();
    assert.deepEqual(g.links.map(l => l.live), [true]);
    assert.deepEqual(g.categories.map(k => [k.name, k.approved]), [['biji KOPI', 1], ['teknik seduh', 1]]);
  });
});

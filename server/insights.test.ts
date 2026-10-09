// Insights data end to end against a real server and the fake outside services (fixtures/fake-google.ts,
// fake-dataforseo.ts): Search Console per page and query (paging, token renewal, quota and API errors, retention),
// rank tracking with the rank effect of a deploy, keyword volumes from DataForSEO with their cost in the spend ledger,
// and Google Analytics 4 with the site-to-property mapping. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startFakes } from './fixtures/fake-services.ts';
import { google, resetGoogle, vnRows } from './fixtures/fake-google.ts';
import { DFS_LOGIN, DFS_PASSWORD, dfs, resetDataforseo } from './fixtures/fake-dataforseo.ts';
import { Client, events, member, owner, saveSites, startServer, until, type Json, type TestServer } from './testkit.ts';

type Line = { key: string; clicks: number; impressions: number; ctr: number; position: number };
type Search = { state: string; property: string; fetchedAt: number | null; error: string; from: string; to: string; totals: { clicks: number; impressions: number; ctr: number; position: number }; days: { date: string; clicks: number }[]; pages: Line[]; queries: Line[] };
type Ga4Site = { state: string; property: string; propertyName: string; auto: boolean; error: string; totals: { users: number; sessions: number; engaged: number; rate: number } };
type Ga4 = Ga4Site & { days: { date: string; users: number; sessions: number; engaged: number }[]; pages: { key: string; users: number; sessions: number; engaged: number; rate: number }[]; fetchedAt: number | null };
type Overview = { connected: boolean; fetchedAt: number | null; error: string; properties: { id: string; name: string; account: string }[]; sites: Record<string, Ga4Site> };
type RankRow = { keyword: string; intent: string; source: string; position: number | null; change7: number | null; change28: number | null; page: string; clicks: number; impressions: number };
type Rank = { connected: boolean; sites: Record<string, { state: string; to: string; keywords: RankRow[] }>; effects: Record<string, { change: number; keywords: number }> };
type Keyword = { id: number; keyword: string; volume: number | null; competition: string; volumeAt: number | null; track: boolean };
type Request = Json & { id: number; status: string; notes: string; keywords: Keyword[]; steps: { text: string }[] };
type View = { id: string; connected: boolean; status: string; msg: string };

const DAY = 86_400_000;
let s: TestServer, fakes: Awaited<ReturnType<typeof startFakes>>, admin: Client, editor: Client, viewer: Client, reviewer: Client;

const int = async (id: string) => ((await admin.get('/api/integrations')).data.integrations as View[]).find(x => x.id === id)!;
const site = async (id: string, who: Client = admin) => (await who.get('/api/metrics/site/' + id)).data as { gsc: Search; ga4: Ga4 };
const rank = async (who: Client = admin) => (await who.get('/api/rank')).data as unknown as Rank;
const ga4 = async (who: Client = admin) => (await who.get('/api/ga4')).data.ga4 as Overview;
const count = (sql: string, ...args: (string | number)[]) => (s.db().prepare(sql).get(...args) as { n: number }).n;
/** The bodies of the Search Console row queries the server sent (the ones with dimensions). */
const gscBodies = () => fakes.hits.filter(h => h.path.endsWith('/searchAnalytics/query')).map(h => JSON.parse(h.body) as { dimensions?: string[]; startRow?: number; rowLimit?: number; startDate: string; endDate: string; type?: string; dataState?: string }).filter(b => b.dimensions?.length);
const renewals = () => fakes.hits.filter(h => h.path === '/google-token/token' && h.body.includes('grant_type=refresh_token')).length;

/** Goes through Google sign-in for a service, as a browser would. */
async function connect(kind: 'gsc' | 'ga4'): Promise<void> {
  const start = await admin.post('/api/oauth/google/start', { kind });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const state = new URL(String(start.data.url)).searchParams.get('state')!;
  const back = await fetch(`${s.base}/api/oauth/google/callback?code=good-code&state=${state}`, { redirect: 'manual' });
  assert.equal(back.status, 302);
}
/** Asks for the Search Console figures again and waits until the rows of that round are stored. */
async function refreshRows(): Promise<Search> {
  const was = (await site('s1')).gsc.fetchedAt ?? 0;
  /* The stored status carries the time the round began: a round started in the same millisecond is told apart by waiting one. */
  await new Promise(r => setTimeout(r, 5));
  const r = await editor.post('/api/metrics/refresh');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return until('the rows of the new round', async () => { const g = (await site('s1')).gsc; return (g.fetchedAt ?? 0) > was ? g : null; });
}

before(async () => {
  resetGoogle(); resetDataforseo();
  fakes = await startFakes();
  s = await startServer({ ...fakes.env, MERIDIAN_GSC_PAGE: '100', MERIDIAN_GA4_PAGE: '3' });
  writeFileSync(join(s.fakeDir,'base-cost'),'0.12');
  admin = await owner(s, 'Owner Person', 'owner@example.com');
  editor = await member(s, admin, 'editor', 'editor@example.com', 'Eddie Editor');
  viewer = await member(s, admin, 'viewer', 'viewer@example.com', 'Vic Viewer');
  await saveSites(admin, [
    { id: 's1', domain: 'example-vn.com', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live' },
    { id: 's2', domain: 'kopi.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live' },
    { id: 's3', domain: 'shop-two.example', country: 'Atlantis', cc: 'XX', lang: 'English', topic: 'Shop', status: 'live' },
  ]);
  reviewer = await member(s, admin, 'reviewer', 'reviewer@example.com', 'Linh Reviewer', 's1');
  await admin.put('/api/integrations/google', { values: { clientId: '1234-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret-value' } });
});
after(() => { s?.stop(); fakes?.stop(); });

describe('before anything is connected', () => {
  it('says so for every source, and keeps reviewers and signed-out visitors out', async () => {
    const v = await site('s1');
    assert.equal(v.gsc.state, 'not-connected');
    assert.equal(v.ga4.state, 'not-connected');
    const r = await rank();
    assert.equal(r.connected, false);
    assert.deepEqual(Object.values(r.sites).map(x => x.state), ['not-connected', 'not-connected', 'not-connected']);
    assert.deepEqual(r.effects, {});
    assert.deepEqual(await ga4(), { connected: false, fetchedAt: null, error: '', properties: [], sites: Object.fromEntries(['s1', 's2', 's3'].map(id => [id, { state: 'not-connected', property: '', propertyName: '', auto: false, error: '', totals: { users: 0, sessions: 0, engaged: 0, rate: 0 } }])) });
    for (const path of ['/api/metrics/site/s1', '/api/rank', '/api/ga4']) {
      assert.equal((await reviewer.get(path)).status, 403, path);
      assert.equal((await new Client(s.base).get(path)).status, 401, path);
      assert.equal((await viewer.get(path)).status, 200, path);
    }
    assert.equal((await admin.get('/api/metrics/site/nope')).status, 404);
    assert.equal((await editor.post('/api/ga4/refresh')).status, 409);
    assert.equal((await editor.post('/api/ga4/map', { siteId: 's1', property: 'properties/1001' })).status, 409);
    /* Writes need the dashboard's header, like every other write. */
    assert.equal((await editor.post('/api/ga4/refresh', {}, { 'x-meridian': '0' })).status, 403);
  });
});

describe('Search Console per page and query', () => {
  it('fetches the rows on connect: totals by day, top pages and top queries of the last 28 days', async () => {
    await connect('gsc');
    const g = await until('the rows', async () => { const v = (await site('s1')).gsc; return v.state === 'ok' && v.fetchedAt ? v : null; });
    assert.equal(g.property, 'sc-domain:example-vn.com');
    /* 28 days ending 3 days ago. A day's total is asked for by date alone, so it holds the clicks Google leaves out of the rows (5 a day here). */
    const to = new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10);
    assert.equal(g.to, to);
    assert.equal(g.days.length, 28);
    assert.equal(g.days.at(-1)!.date, to);
    assert.deepEqual(g.days.map(d => d.clicks), Array(28).fill(18));
    assert.deepEqual(g.totals, { clicks: 28 * 18, impressions: 28 * 282, ctr: 0.064, position: g.totals.position });
    assert.deepEqual(g.pages.map(p => [p.key, p.clicks]), [
      ['https://example-vn.com/ca-phe-sua-da/', 168], ['https://example-vn.com/cold-brew/', 84], ['https://example-vn.com/tra-da/', 56], ['https://example-vn.com/', 56],
    ], 'by clicks, then by impressions');
    /* Position is weighted by impressions: "cold brew" is at 5 on one page (60 impressions) and at 9 on another (20). */
    assert.deepEqual(g.queries.map(q => [q.key, q.clicks, q.impressions, q.position]), [
      ['cà phê sữa đá', 168, 2800, 6], ['cold brew', 112, 2240, 6], ['trà đá', 56, 1400, 8.5], ['example vn', 28, 56, 1],
    ]);
    assert.equal(g.queries[0]!.ctr, 0.06);
    /* The first fetch of a site takes 56 days, so a 28-day comparison works at once: 56 totals and 5 rows a day. */
    assert.equal(count(`SELECT COUNT(*) AS n FROM gsc_rows WHERE site_id = 's1'`), 56 * 6);
    assert.equal(count(`SELECT COUNT(*) AS n FROM gsc_rows WHERE site_id = 's1' AND page = '' AND query = ''`), 56);
    /* Paging: 280 rows at 100 a request are asked for from row 0, 100 and 200; web search, final data only. */
    const detail = gscBodies().filter(b => b.dimensions!.join() === 'date,page,query');
    assert.deepEqual(detail.map(b => b.startRow), [0, 100, 200]);
    assert.ok(detail.every(b => b.rowLimit === 100 && b.type === 'web' && b.dataState === 'final'));
    assert.deepEqual(gscBodies().filter(b => b.dimensions!.join() === 'date').map(b => b.startRow), [0]);
    /* A site whose domain has no property in the Google account says so; the totals on the sites still arrive. */
    assert.equal((await site('s2')).gsc.state, 'no-property');
    assert.equal(((await admin.get('/api/state')).data.metrics as { sites: Record<string, { clicks28: number }> }).sites.s1!.clicks28, 280);
  });

  it('renews a token Google ended early, fetches 28 days from then on, and drops rows older than 16 months', async () => {
    s.db().prepare(`INSERT INTO gsc_rows (site_id, date, page, query, clicks, impressions, position) VALUES ('s1', '2024-01-05', '', '', 1, 1, 1)`).run();
    const before = renewals(), asked = gscBodies().length;
    google.tokens.delete('acc-1');
    const got = await events(editor, async () => { await refreshRows(); });
    /* A new sign-in at the fake hands out the same first token again: it is valid again for the tests after this one. */
    google.tokens.add('acc-1');
    const g = (await site('s1')).gsc;
    assert.equal(g.state, 'ok');
    assert.equal(g.error, '');
    assert.equal(renewals(), before + 1, 'one renewal, then the same call again');
    const again = gscBodies().slice(asked);
    assert.deepEqual(again.map(b => b.dimensions!.join()), ['date', 'date', 'date,page,query', 'date,page,query'], 'the refused call is repeated with the new token');
    const days = (b: { startDate: string; endDate: string }) => (Date.parse(b.endDate) - Date.parse(b.startDate)) / DAY + 1;
    assert.deepEqual(again.map(days), [28, 28, 28, 28]);
    /* The 28 days are replaced, the older 28 stay, and the row from 2024 is gone. */
    assert.equal(count(`SELECT COUNT(*) AS n FROM gsc_rows WHERE site_id = 's1'`), 56 * 6);
    assert.equal(count(`SELECT COUNT(*) AS n FROM gsc_rows WHERE date < '2025-01-01'`), 0);
    /* Open dashboards are told to read the figures again; a reviewer's is not. */
    assert.ok(got.some(e => e.event === 'insights'));
  });

  it('keeps the data and says why when the quota is used up or the API fails; the connection is not marked broken', async () => {
    google.gsc.quota = 1;
    let g = await refreshRows();
    assert.equal(g.state, 'ok');
    assert.equal(g.error, 'The Search Console quota is used up for now. Meridian tries again at the next refresh.');
    assert.equal(g.totals.clicks, 28 * 18);
    assert.equal((await int('gsc')).status, 'ok');
    google.gsc.fail = 1;
    g = await refreshRows();
    assert.equal(g.error, 'Search Console answered 500: Internal error encountered.');
    assert.equal((await int('gsc')).status, 'ok');
    g = await refreshRows();
    assert.equal(g.error, '');
  });

  it('lets a viewer read and refuses their refresh', async () => {
    assert.equal((await site('s1', viewer)).gsc.state, 'ok');
    assert.equal((await viewer.post('/api/metrics/refresh')).status, 403);
  });
});

describe('rank tracking', () => {
  const article = (siteId: string, domain: string, keyword: string) => s.db().prepare(`INSERT INTO articles (site_id, domain, country, lang, keyword, status, created_at, queued_at) VALUES (?, ?, 'Vietnam', 'Vietnamese', ?, 'approved', 1, 1)`).run(siteId, domain, keyword);
  const row = (r: Rank, keyword: string) => r.sites.s1!.keywords.find(k => k.keyword === keyword)!;

  it('tracks the keywords of approved articles: position now, 7-day and 28-day change, best page', async () => {
    assert.equal((await rank()).sites.s1!.state, 'no-keywords');
    /* The keyword as a person typed it: Search Console reports queries in lower case with single spaces. */
    article('s1', 'example-vn.com', 'Cà phê  sữa đá'); article('s1', 'example-vn.com', 'cold brew'); article('s1', 'example-vn.com', 'trà đá'); article('s1', 'example-vn.com', 'cà phê trứng');
    article('s2', 'kopi.example', 'kopi susu');
    s.db().prepare(`INSERT INTO articles (site_id, domain, country, lang, keyword, status, created_at, queued_at) VALUES ('s1', 'example-vn.com', 'Vietnam', 'Vietnamese', 'example vn', 'review', 1, 1)`).run();
    const r = await rank();
    assert.equal(r.connected, true);
    assert.equal(r.sites.s1!.state, 'ok');
    assert.deepEqual(r.sites.s1!.keywords.map(k => k.keyword), ['Cà phê  sữa đá', 'cold brew', 'trà đá', 'cà phê trứng'], 'approved articles only');
    /* It climbed from 9 (five weeks ago) over 6 (the week before) to 4: up 2 in 7 days and up 5 in 28. */
    assert.deepEqual(row(r, 'Cà phê  sữa đá'), { keyword: 'Cà phê  sữa đá', intent: '', source: 'article', position: 4, change7: 2, change28: 5, page: 'https://example-vn.com/ca-phe-sua-da/', clicks: 168, impressions: 2800 });
    assert.deepEqual([row(r, 'cold brew').position, row(r, 'cold brew').change7, row(r, 'cold brew').page], [6, 0, 'https://example-vn.com/cold-brew/']);
    assert.deepEqual([row(r, 'trà đá').position, row(r, 'trà đá').change7, row(r, 'trà đá').change28], [10, -2, -2]);
    /* No impressions, no position: never a made-up one. */
    assert.deepEqual([row(r, 'cà phê trứng').position, row(r, 'cà phê trứng').change7, row(r, 'cà phê trứng').page], [null, null, '']);
    /* A site with tracked keywords but no property, and one with nothing to track. */
    assert.equal(r.sites.s2!.state, 'no-property');
    assert.deepEqual(r.sites.s2!.keywords.map(k => k.position), [null]);
    assert.equal(r.sites.s3!.state, 'no-keywords');
  });

  it('gives a deploy its rank effect once Search Console has the 7 days after it', async () => {
    const build = (version: number, daysAgo: number) => Number(s.db().prepare(`INSERT INTO site_builds (site_id, domain, version, status, review, deploy, created_at, queued_at, updated_at, deployed_at)
      VALUES ('s1', 'example-vn.com', ?, 'ready', 'approved', 'superseded', 1, 1, 1, ?)`).run(version, Date.now() - daysAgo * DAY).lastInsertRowid);
    const old = build(1, 13), fresh = build(2, 5);
    const r = await rank();
    /* 13 days ago: "cà phê sữa đá" went from 6.57 to 4.86 (+1.71), "cold brew" stayed, "trà đá" went from 8 to 9.14
       (−1.14); the keyword without impressions does not count. The average of the three is +0.2. */
    assert.deepEqual(r.effects[old], { change: 0.2, keywords: 3 });
    assert.equal(r.effects[fresh], undefined, 'the newer deploy is still being measured');
    assert.deepEqual((await rank(viewer)).effects[old], { change: 0.2, keywords: 3 });
  });
});

describe('keyword volumes', () => {
  const research = async (siteId: string, topic: string): Promise<Request> => {
    const r = await editor.post('/api/requests', { siteId, topic, goal: 'Find a new topic cluster', model: 'GPT-6 Luna' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = (r.data.request as Request).id;
    return until('the research', async () => ((await admin.get('/api/state')).data.requests as Request[]).find(x => x.id === id && (x.status === 'done' || x.status === 'failed')));
  };
  const runs = (jobId: number) => s.db().prepare(`SELECT agent, model, tokens, cost_usd, outcome FROM job_runs WHERE kind = 'request' AND job_id = ? ORDER BY id`).all(jobId).map(r => ({ ...r }));
  let first: Request;

  it('stays as before without DataForSEO: no volume, and nothing to refresh', async () => {
    first = await research('s1', 'cold brew');
    assert.equal(first.status, 'done');
    assert.deepEqual(first.keywords.map(k => [k.keyword, k.volume, k.competition, k.volumeAt, k.track]), [['cara membuat cold brew', null, '', null, false], ['rasio cold brew', null, '', null, false]]);
    assert.equal(first.steps.at(-1)!.text, 'Saved 2 keywords, without volume data');
    assert.equal(first.notes, 'No volumes.');
    const r = await editor.post(`/api/requests/${first.id}/volumes`);
    assert.deepEqual([r.status, r.data.error], [409, 'Connect Google Ads or DataForSEO in Integrations to see search volume.']);
    assert.equal(dfs.tasks.length, 0);
  });

  it('fetches volume and competition in one batch after the agent, for the site\'s country and language, and books the cost', async () => {
    const saved = await admin.put('/api/integrations/dfs', { values: { login: DFS_LOGIN, password: DFS_PASSWORD } });
    assert.equal((saved.data.result as { msg: string }).msg, 'Connected. Balance $12.50.');
    dfs.volumes.set('cara membuat cold brew', { volume: 1900, competition: 'LOW' });
    const r = await research('s1', 'cold brew volumes');
    assert.equal(r.status, 'done');
    assert.deepEqual(r.keywords.map(k => [k.keyword, k.volume, k.competition]), [['cara membuat cold brew', 1900, 'LOW'], ['rasio cold brew', null, '']]);
    assert.ok(r.keywords.every(k => typeof k.volumeAt === 'number'), 'both were asked for, one has no figure');
    assert.deepEqual(r.steps.map(x => x.text).slice(-2), ['Fetching search volume from DataForSEO', 'Saved 2 keywords, 1 with search volume']);
    assert.equal(r.notes, 'No volumes. Search volume is Google Ads data from DataForSEO for 2 keywords; only 1 has a figure.');
    /* One request with one task: both keywords, Vietnam (2000 + ISO 704), the site's language. */
    assert.deepEqual(dfs.tasks, [{ keywords: ['cara membuat cold brew', 'rasio cold brew'], location_code: 2704, language_name: 'Vietnamese', tag: 'meridian' }]);
    /* The ledger has the agent's run and the DataForSEO call, which used no tokens; both count for the site's spend. */
    await until('the ledger rows', async () => runs(r.id).length === 2);
    assert.deepEqual(runs(r.id).map(x => [x.agent, x.model === 'DataForSEO search volume', x.tokens, x.cost_usd, x.outcome]).sort((a, b) => Number(a[3]) - Number(b[3])),
      [['Keyword', true, 0, 0.075, 'ok'], ['Keyword', false, 598625, 0.12, 'ok']]);
    const spend = (await admin.get('/api/state')).data.spend as { sites: Record<string, { today: number }> };
    assert.equal(Math.round(spend.sites.s1!.today * 1000) / 1000, 0.12 + 0.12 + 0.075);
  });

  it('refreshes the volumes of a finished research on request', async () => {
    assert.equal((await viewer.post(`/api/requests/${first.id}/volumes`)).status, 403);
    assert.equal((await reviewer.post(`/api/requests/${first.id}/volumes`)).status, 403);
    assert.equal((await editor.post('/api/requests/9999/volumes')).status, 404);
    dfs.volumes.set('rasio cold brew', { volume: 320, competition: 'MEDIUM' });
    const r = await editor.post(`/api/requests/${first.id}/volumes`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual([r.data.found, r.data.sent], [2, 2]);
    assert.deepEqual((r.data.request as Request).keywords.map(k => [k.volume, k.competition]), [[1900, 'LOW'], [320, 'MEDIUM']]);
    assert.deepEqual(runs(first.id).filter(x => x.model === 'DataForSEO search volume').map(x => x.cost_usd), [0.075]);
    const st = ((await admin.get('/api/state')).data.requests as Request[]).find(x => x.id === first.id)!;
    assert.equal(st.keywords[1]!.volume, 320, 'the stored request carries the new figure');
  });

  it('sends the country by name when it has no code, and leaves out a language DataForSEO does not know', async () => {
    dfs.mode = 'no-language';
    const r = await research('s3', 'shop things');
    assert.equal(r.status, 'done');
    assert.deepEqual(dfs.tasks.slice(-2).map(t => [t.location_name, t.language_name]), [['Atlantis', 'English'], ['Atlantis', undefined]]);
    assert.ok(r.keywords.every(k => typeof k.volumeAt === 'number'));
    dfs.mode = 'ok';
  });

  it('says why when DataForSEO refuses, and the research is saved all the same', async () => {
    dfs.mode = 'broke';
    const r = await research('s2', 'kopi susu');
    assert.equal(r.status, 'done');
    assert.equal(r.notes, 'No volumes. Search volume could not be fetched: The DataForSEO balance is used up. Top up the account, then refresh the volumes.');
    assert.deepEqual(r.keywords.map(k => [k.volume, k.volumeAt]), [[null, null], [null, null]]);
    assert.equal(r.steps.at(-1)!.text, 'Saved 2 keywords, without volume data');
    assert.equal(runs(r.id).length <= 1, true, 'nothing was charged, so nothing is booked');
    const broke = await editor.post(`/api/requests/${r.id}/volumes`);
    assert.deepEqual([broke.status, broke.data.error], [409, 'The DataForSEO balance is used up. Top up the account, then refresh the volumes.']);
    dfs.mode = 'rate';
    const rate = await editor.post(`/api/requests/${r.id}/volumes`);
    assert.deepEqual([rate.status, rate.data.error], [429, 'DataForSEO allows 12 volume requests a minute. Try again in a minute.']);
    dfs.mode = 'ok';
    assert.equal((await editor.post(`/api/requests/${r.id}/volumes`)).status, 200);
  });

  it('marks research keywords to track; they join the tracked keywords of the site', async () => {
    const k = first.keywords[1]!;
    assert.equal((await viewer.post(`/api/keywords/${k.id}/track`, { on: true })).status, 403);
    assert.equal((await editor.post('/api/keywords/99999/track', { on: true })).status, 404);
    /* Search Console has rows for it now. */
    google.gsc.rows['sc-domain:example-vn.com'] = date => [...vnRows(date), { date, page: 'https://example-vn.com/rasio/', query: 'rasio cold brew', clicks: 1, impressions: 10, position: 12 }];
    const on = await editor.post(`/api/keywords/${k.id}/track`, { on: true });
    assert.equal(on.status, 200);
    assert.equal((on.data.request as Request).keywords[1]!.track, true);
    await refreshRows();
    const r = (await rank()).sites.s1!.keywords.find(x => x.keyword === 'rasio cold brew')!;
    /* Only the last 28 days were fetched again, so there is nothing yet to compare with 28 days back. */
    assert.deepEqual(r, { keyword: 'rasio cold brew', intent: 'Informational', source: 'tracked', position: 12, change7: 0, change28: null, page: 'https://example-vn.com/rasio/', clicks: 28, impressions: 280 });
    assert.equal((await editor.post(`/api/keywords/${k.id}/track`, { on: false })).status, 200);
    assert.equal((await rank()).sites.s1!.keywords.some(x => x.keyword === 'rasio cold brew'), false);
    const log = ((await admin.get('/api/audit')).data.entries as { act: string }[] | undefined) ?? [];
    if (log.length) assert.ok(log.some(e => e.act === 'Started tracking the keyword: rasio cold brew'));
  });

  it('is stopped by the site\'s daily budget like any paid job', async () => {
    const cur = await admin.get('/api/workspace');
    const version = ((cur.data.docs as Record<string, { version: number }>).settings ?? { version: 0 }).version;
    assert.equal((await admin.put('/api/workspace/docs/settings', { version, data: { budget: 0.2, native: false } })).status, 200);
    const r = await editor.post(`/api/requests/${first.id}/volumes`);
    assert.equal(r.status, 409);
    assert.match(String(r.data.error), /^example-vn\.com has used its daily budget of \$0\.20\./);
    assert.equal((await admin.put('/api/workspace/docs/settings', { version: version + 1, data: { budget: 25, native: false } })).status, 200);
  });
});

describe('Google Analytics 4', () => {
  const offsets = (prop: string) => fakes.hits.filter(h => h.path === `/ga-data/v1beta/${prop}:runReport`).map(h => JSON.parse(h.body) as { dimensions: { name: string }[]; offset: number; limit: number }).map(b => [b.dimensions[0]!.name, b.offset]);

  it('matches sites to properties by the domain of their web stream and reads users and sessions', async () => {
    google.ga4.adminPage = 1;
    await connect('ga4');
    assert.equal((await int('ga4')).status, 'ok');
    const o = await until('the Analytics figures', async () => { const v = await ga4(); return v.sites.s1?.state === 'ok' && v.fetchedAt ? v : null; });
    assert.equal(o.connected, true);
    /* Two accounts at one a page: the second page is asked for with the page token. */
    assert.deepEqual(o.properties, [
      { id: 'properties/1001', name: 'Example VN', account: 'Meridian sites' }, { id: 'properties/1002', name: 'Old shop', account: 'Meridian sites' }, { id: 'properties/2001', name: 'App only', account: 'Second account' },
    ]);
    assert.ok(fakes.hits.some(h => h.path.startsWith('/ga-admin/v1beta/accountSummaries') && h.path.includes('pageToken=1')));
    /* example-vn.com is the host of property 1001's stream (www. does not matter); the other sites match nothing. */
    assert.deepEqual([o.sites.s1!.property, o.sites.s1!.propertyName, o.sites.s1!.auto], ['properties/1001', 'Example VN', true]);
    assert.deepEqual([o.sites.s2!.state, o.sites.s3!.state], ['no-property', 'no-property']);
    const v = (await site('s1')).ga4;
    assert.equal(v.days.length, 28);
    const sessions = v.days.reduce((n, d) => n + d.sessions, 0), engaged = v.days.reduce((n, d) => n + d.engaged, 0);
    /* Users of the 28 days are the report's own total: they do not add up by day. */
    assert.deepEqual(v.totals, { users: 900, sessions, engaged, rate: Math.round(engaged / sessions * 1000) / 1000 });
    assert.deepEqual(v.pages.map(p => [p.key, p.users, p.sessions, p.rate]), [['/ca-phe-sua-da/', 400, 520, 0.577], ['/', 300, 380, 0.395], ['/cold-brew/', 150, 170, 0.529], ['/tra-da/', 50, 60, 0.333]]);
    /* Paging by offset up to rowCount, at 3 rows a request: 28 days in 10 requests, 4 pages in 2. */
    assert.deepEqual(offsets('properties/1001'), [...Array.from({ length: 10 }, (_, i) => ['date', i * 3]), ['pagePath', 0], ['pagePath', 3]]);
    assert.equal(count(`SELECT COUNT(*) AS n FROM ga4_rows WHERE site_id = 's1'`), 28 + 4 + 1);
  });

  it('lets an editor choose the property of a site that could not be matched', async () => {
    assert.equal((await viewer.post('/api/ga4/map', { siteId: 's3', property: 'properties/1002' })).status, 403);
    assert.equal((await editor.post('/api/ga4/map', { siteId: 's3', property: 'properties/9' })).status, 409);
    assert.equal((await editor.post('/api/ga4/map', { siteId: 's3', property: 'everything' })).status, 400);
    assert.equal((await editor.post('/api/ga4/map', { siteId: 'nope', property: 'properties/1002' })).status, 404);
    const r = await editor.post('/api/ga4/map', { siteId: 's3', property: 'properties/1002' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const o = await until('the chosen property\'s figures', async () => { const v = await ga4(); return v.sites.s3?.state === 'ok' ? v : null; });
    assert.deepEqual([o.sites.s3!.property, o.sites.s3!.auto, o.sites.s3!.totals.users], ['properties/1002', false, 12]);
    /* Back to matching by domain: nothing matches, and the figures of the property that was chosen are not kept. */
    assert.equal((await editor.post('/api/ga4/map', { siteId: 's3', property: '' })).status, 200);
    await until('the rows to go', async () => count(`SELECT COUNT(*) AS n FROM ga4_rows WHERE site_id = 's3'`) === 0);
    assert.equal((await ga4()).sites.s3!.state, 'no-property');
  });

  it('keeps the figures and says why on a used-up quota or a property it may not read', async () => {
    google.ga4.quota.add('properties/1001');
    let r = await editor.post('/api/ga4/refresh');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    let o = r.data.ga4 as Overview;
    assert.deepEqual([o.sites.s1!.state, o.sites.s1!.error, o.sites.s1!.totals.users], ['ok', 'The Google Analytics quota is used up for now. Meridian tries again at the next refresh.', 900]);
    assert.equal((await int('ga4')).status, 'ok');
    google.ga4.quota.clear(); google.ga4.denied.add('properties/1001');
    r = await editor.post('/api/ga4/refresh');
    o = r.data.ga4 as Overview;
    assert.equal(o.sites.s1!.error, 'Google Analytics does not let this Google account read it: User does not have sufficient permissions for this property.');
    google.ga4.denied.clear();
    assert.equal(((await editor.post('/api/ga4/refresh')).data.ga4 as Overview).sites.s1!.error, '');
    assert.equal((await viewer.post('/api/ga4/refresh')).status, 403);
  });

  it('says what to turn on when the Admin API is off, and forgets everything when Analytics is removed', async () => {
    google.ga4.adminOff = true;
    const r = await editor.post('/api/ga4/refresh');
    assert.deepEqual([r.status, r.data.error], [409, 'Turn on the Google Analytics Admin API in Google Cloud, then refresh.']);
    assert.deepEqual([(await int('ga4')).status, (await int('ga4')).msg], ['bad', 'Turn on the Google Analytics Admin API in Google Cloud, then refresh.']);
    /* What was read before is still shown. */
    assert.equal((await ga4()).sites.s1!.totals.users, 900);
    google.ga4.adminOff = false;
    assert.equal((await admin.del('/api/integrations/ga4')).status, 200);
    await until('the figures to go', async () => count('SELECT COUNT(*) AS n FROM ga4_rows') === 0);
    const o = await ga4();
    assert.deepEqual([o.connected, o.properties.length, o.sites.s1!.state], [false, 0, 'not-connected']);
  });
});

describe('when Google access ends', () => {
  it('marks Search Console as not working, keeps the rows, and drops them when it is removed', async () => {
    google.tokens.clear(); google.refreshFails = true;
    await new Promise(r => setTimeout(r, 5));
    const r = await editor.post('/api/metrics/refresh');
    assert.equal(r.status, 200, 'the totals are read with the token that is still stored');
    const g = await until('the connection to be marked', async () => (await int('gsc')).status === 'bad' ? (await site('s1')).gsc : null);
    assert.equal((await int('gsc')).msg, 'Google access was removed or has expired. Connect with Google again.');
    assert.equal(g.error, 'Google access was removed or has expired. Connect with Google again.');
    assert.equal(g.state, 'ok');
    assert.equal(g.totals.clicks > 0, true);
    assert.equal((await admin.del('/api/integrations/gsc')).status, 200);
    assert.equal(count('SELECT COUNT(*) AS n FROM gsc_rows'), 0);
    assert.equal((await site('s1')).gsc.state, 'not-connected');
    assert.equal((await rank()).sites.s1!.state, 'not-connected');
  });
});

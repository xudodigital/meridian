import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { serpApiLocale as locale } from './serpapi.ts';
const searchLocale = (site: Parameters<typeof locale>[0]) => locale(site, 'SearchAPI.io');
import type { SeoTaskWire } from '../shared/seo-tasks.ts';
import { startServer, owner, member, saveSites, until, type TestServer, type Client } from './testkit.ts';

describe('SearchAPI.io integration and actual queue against isolated providers', () => {
  const key = 'test-searchapi-private-key-5678';
  let s: TestServer, admin: Client, editor: Client, provider: ReturnType<typeof createServer>, url = '';
  let searches = 0, accounts = 0, dfsCalls = 0, quota = 123, searchStatus = 200, accountStatus = 200, invalid = false;
  const snapshot = { search_metadata: { status: 'Success', created_at: '2026-10-08 01:00:00 UTC', google_url: 'https://google.com/search?q=coffee', api_key: key }, api_key: key,
    organic_results: [{ position: 1, title: 'Coffee guide', link: 'https://example.com/coffee', snippet: 'A result snippet.' }],
    related_questions: [{ question: 'How to brew?', source: { link: 'https://example.com/brew' }, answer: 'Use a source.' }],
    related_searches: [{ query: 'coffee tips', link: 'https://searchapi.com/search.json?api_key=' + key }],
  };
  const task = async (id: number) => (await admin.get(`/api/seo-tasks/${id}`)).data.task as SeoTaskWire;
  const enqueue = async (brief: string, serpProvider: string = 'auto') => {
    const r = await editor.post('/api/seo-tasks', { siteId: 's1', kind: 'serp', brief, serpProvider });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return (r.data.task as SeoTaskWire).id;
  };
  const finish = (id: number) => until('SERP task result', async () => { const t = await task(id); return ['done', 'failed'].includes(t.status) ? t : null; });
  before(async () => {
    provider = createServer((req, res) => {
      const u = new URL(req.url!, 'http://localhost');
      res.setHeader('content-type', 'application/json');
      if (u.pathname.startsWith('/v3/')) { dfsCalls++; res.end(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ money: { balance: 50 } }] }] })); return; }
      assert.equal(u.searchParams.has('api_key'), false); assert.equal(req.headers.authorization, 'Bearer ' + key);
      if (u.pathname === '/api/v1/me') { accounts++; res.statusCode = accountStatus; res.end(JSON.stringify(accountStatus === 200 ? { api_key: key, account: { remaining_credits: quota } } : { error: key })); return; }
      assert.equal(u.pathname, '/api/v1/search'); searches++;
      for (const [k, v] of Object.entries({ engine: 'google', gl: 'my', hl: 'en', location: 'Malaysia', device: 'desktop' })) assert.equal(u.searchParams.get(k), v);
      assert.ok(u.searchParams.get('q')); assert.equal(u.searchParams.has('start'), false);
      res.statusCode = searchStatus;
      res.end(JSON.stringify(searchStatus !== 200 ? { error: 'Quota exceeded: ' + key } : invalid ? { search_metadata: { status: 'Success' } } : snapshot));
    });
    await new Promise<void>(r => provider.listen(0, '127.0.0.1', r)); const address = provider.address();
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    s = await startServer({ MERIDIAN_URL_SEARCHAPI: url, MERIDIAN_URL_DATAFORSEO: url }); admin = await owner(s);
    editor = await member(s, admin, 'editor', 'editor@example.com', 'Editor');
    await saveSites(admin, [{ id: 's1', domain: 'test.example', cc: 'MY', country: 'Malaysia', lang: 'English', topic: 'Coffee' }]);
    writeFileSync(join(s.fakeDir, 'seo-serp.txt'), JSON.stringify({ summary: 'Inspect the supplied search evidence.', findings: [{ title: 'Guide', detail: 'One observed organic result.', basis: 'observation' }], actions: [], limitations: ['No keyword volume available.'], sources: [], links: [], visual: null }));
  });
  after(() => { s?.stop(); provider?.closeAllConnections(); provider?.close(); });

  it('maps exact country/language and refuses a silent language fallback', () => {
    assert.deepEqual(searchLocale({ cc: 'MY', country: 'Malaysia', lang: 'English' }), { gl: 'my', hl: 'en', location: 'Malaysia' });
    assert.equal(searchLocale({ cc: 'VN', country: 'Vietnam', lang: 'Vietnamese' }).hl, 'vi');
    assert.throws(() => searchLocale({ cc: 'MY', country: 'Malaysia', lang: 'Unknown' }), /no language fallback/);
  });
  it('requires a connected provider and rejects unsupported or unavailable choices', async () => {
    const input = { siteId: 's1', kind: 'serp', brief: 'coffee' };
    assert.equal((await admin.post('/api/seo-tasks', input)).status, 409);
    assert.equal((await admin.post('/api/seo-tasks', { ...input, serpProvider: '__proto__' })).status, 400);
    assert.equal((await admin.post('/api/seo-tasks', { ...input, serpProvider: 'dfs' })).status, 409);
    assert.equal(searches, 0);
  });
  it('tests quota without a search and encrypts credentials without leaking provider responses', async () => {
    assert.equal((await editor.put('/api/integrations/searchapi', { values: { key } })).status, 403);
    const r = await admin.put('/api/integrations/searchapi', { values: { key } });
    assert.equal(r.status, 200); assert.equal((r.data.result as { status: string }).status, 'ok');
    assert.match(JSON.stringify(r.data.result), /123 search credits remaining/); assert.equal(accounts, 1); assert.equal(searches, 0);
    const row = s.db().prepare("SELECT secret FROM integrations WHERE id = 'searchapi'").get() as { secret: string };
    assert.match(row.secret, /^v1\./); assert.ok(!row.secret.includes(key));
    for (const path of ['/api/state', '/api/integrations']) assert.ok(!JSON.stringify((await admin.get(path)).data).includes(key));
    assert.ok(!s.output().includes(key));
  });
  it('runs Research with SearchAPI.io independently of DataForSEO and saves limited real provider evidence', async () => {
    const id = await enqueue('coffee guide'); const t = await finish(id);
    assert.equal(t.status, 'done', t.error); assert.equal(t.agent, 'res'); assert.equal(t.serpProvider, 'searchapi');
    assert.match(JSON.stringify(t.steps), /SearchAPI.io SERP snapshot/); assert.match(t.step!, /human review/);
    const context = JSON.parse(t.context);
    assert.equal(context.serp.cost, null); assert.match(context.serp.coverage, /not an absolute position/);
    assert.equal(context.serp.items[0].rank, 1); assert.equal(context.serp.items[1].rank, null);
    assert.equal(context.serp.items[1].url, 'https://example.com/brew'); assert.equal(context.serp.items[1].description, 'Use a source.'); assert.equal(context.serp.items[2].title, 'coffee tips'); assert.equal(context.serp.items[2].url, ''); assert.ok(!t.context.includes(key)); assert.ok(!t.context.includes('google_url'));
    assert.equal(searches, 1); assert.equal(dfsCalls, 0);
    const steps = s.db().prepare("SELECT text FROM job_steps WHERE kind = 'seo-task' AND job_id = ?").all(id);
    assert.match(JSON.stringify(steps), /SearchAPI.io SERP snapshot/); assert.ok(t.tokens > 0);
  });
  it('reuses saved snapshot after a restart without spending another search', async () => {
    writeFileSync(join(s.fakeDir, 'hang'), ''); const id = await enqueue('restart evidence');
    await until('saved snapshot', async () => (await task(id)).context.includes('Coffee guide'));
    const count = searches, old = s, adminCookie = admin.cookie, editorCookie = editor.cookie;
    await old.halt('SIGTERM'); rmSync(join(old.fakeDir, 'hang'));
    s = await startServer({ MERIDIAN_URL_SEARCHAPI: url, MERIDIAN_URL_DATAFORSEO: url }, old.tmp);
    admin.base = s.base; admin.cookie = adminCookie; editor.base = s.base; editor.cookie = editorCookie;
    const t = await finish(id); assert.equal(t.status, 'done', t.error); assert.equal(t.serpProvider, 'searchapi'); assert.equal(searches, count);
  });
  it('reports quota failure safely without retrying or switching to a connected DataForSEO account', async () => {
    await admin.put('/api/integrations/dfs', { values: { login: 'test@example.com', password: 'test-password' } });
    const prior = searches, dfsPrior = dfsCalls; searchStatus = 429;
    const t = await finish(await enqueue('quota boundary', 'searchapi'));
    assert.equal(t.status, 'failed'); assert.match(t.error, /quota or rate limit/); assert.ok(!t.error.includes(key));
    assert.equal(searches, prior + 1); assert.equal(dfsCalls, dfsPrior); assert.ok(!s.output().includes(key)); searchStatus = 200;
  });
  it('refuses a malformed snapshot and shows exhausted account quota without consuming searches', async () => {
    invalid = true; const t = await finish(await enqueue('missing results', 'searchapi')); invalid = false;
    assert.equal(t.status, 'failed'); assert.match(t.error, /No rankings were inferred/);
    quota = 0; const prior = searches;
    const r = await admin.post('/api/integrations/searchapi/test');
    assert.equal((r.data.result as { status: string }).status, 'warn'); assert.equal(searches, prior);
  });
  it('distinguishes authentication and account permissions without exposing provider errors', async () => {
    for (const [status, message] of [[401, /refused the API key/], [403, /denied account access/]] as const) {
      accountStatus = status;
      const r = await admin.post('/api/integrations/searchapi/test');
      assert.equal((r.data.result as { status: string }).status, 'bad');
      assert.match(JSON.stringify(r.data.result), message); assert.ok(!JSON.stringify(r.data).includes(key));
    }
    accountStatus = 200;
  });
  it('removes the encrypted integration and refuses new tasks that explicitly require it', async () => {
    assert.equal((await editor.del('/api/integrations/searchapi')).status, 403);
    assert.equal((await admin.del('/api/integrations/searchapi')).status, 200);
    assert.equal(s.db().prepare("SELECT id FROM integrations WHERE id = 'searchapi'").get(), undefined);
    assert.equal((await admin.post('/api/seo-tasks', { siteId: 's1', kind: 'serp', brief: 'coffee', serpProvider: 'searchapi' })).status, 409);
  });
});

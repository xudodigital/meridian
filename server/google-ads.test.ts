import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { DFS_LOGIN, DFS_PASSWORD } from './fixtures/fake-dataforseo.ts';
import { startFakes } from './fixtures/fake-services.ts';
import { owner, member, startServer, saveSites, until, type Client, type TestServer } from './testkit.ts';

describe('Google Ads OAuth and keyword volumes through isolated real server/queue', () => {
  let s: TestServer, admin: Client, editor: Client, fakes: Awaited<ReturnType<typeof startFakes>>, provider: ReturnType<typeof createServer>;
  let average: string | undefined = '1200', omitVariants = false;
  let metrics = 0, status = 200, unknownLocale = false, renewOnce = false, manager = false, testAccount = false;
  const hits: { path: string; body: Record<string, unknown>; headers: Record<string, unknown> }[] = [];
  const integration = async () => ((await admin.get('/api/integrations')).data.integrations as { id: string; connected: boolean; status: string; config: Record<string, string> }[]).find(i => i.id === 'ads')!;
  const request = async (id: number) => ((await admin.get('/api/state')).data.requests as { id: number; status: string; notes: string; keywords: { keyword: string; volume: number | null; volumeProvider: string; volumeGroup: string; volumeAt: number }[]; steps: { text: string }[] }[]).find(x => x.id === id)!;
  const connect = async () => {
    const r = await admin.post('/api/oauth/google/start', { kind: 'ads' }); assert.equal(r.status, 200, JSON.stringify(r.data));
    const u = new URL(String(r.data.url)); assert.ok(u.searchParams.get('scope')?.includes('https://www.googleapis.com/auth/adwords'));
    const state = u.searchParams.get('state')!;
    const cb = `${s.base}/api/oauth/google/callback?code=good-code&state=${state}`;
    assert.equal((await fetch(cb, { redirect: 'manual' })).status, 302);
    return cb;
  };
  before(async () => {
    fakes = await startFakes();
    provider = createServer(async (req, res) => {
      let raw = ''; for await (const b of req) raw += b;
      const b = JSON.parse(raw || '{}'); hits.push({ path: req.url!, body: b, headers: req.headers });
      res.setHeader('content-type', 'application/json');
      const send = (code: number, data: unknown) => { res.statusCode = code; res.end(JSON.stringify(data)); };
      assert.equal(req.headers['developer-token'], undefined);
      assert.equal(req.headers['login-customer-id'], '9999999999');
      if (renewOnce) { renewOnce = false; return send(401, { error: { message: 'acc-1 SECRET', status: 'UNAUTHENTICATED' } }); }
      assert.match(String(req.headers.authorization), /^Bearer acc-[12]$/);
      if (req.url?.endsWith(':generateKeywordHistoricalMetrics')) {
        metrics++;
        assert.deepEqual(b.geoTargetConstants, ['geoTargetConstants/2458']); assert.equal(b.language, 'languageConstants/1000'); assert.equal(b.keywordPlanNetwork, 'GOOGLE_SEARCH');
        if (status !== 200) return send(status, { error: { message: 'ref-1 acc-1 client-secret-private', status: status === 429 ? 'RESOURCE_EXHAUSTED' : 'PERMISSION_DENIED', details: [{ errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' } }] }] } });
        return send(200, { results: [{ text: 'cara membuat cold brew', closeVariants: omitVariants ? [] : ['rasio cold brew'], keywordMetrics: { ...(average === undefined ? {} : { avgMonthlySearches: average }), competition: 'MEDIUM' } }] });
      }
      assert.ok(req.url?.endsWith('/googleAds:search'));
      if (b.query.includes('FROM customer ')) return send(200, { results: [{ customer: { id: '1234567890', manager, testAccount, status: 'ENABLED' } }] });
      if (unknownLocale) return send(200, {});
      if (b.query.includes('FROM geo_target_constant ')) { assert.ok(b.query.includes("country_code = 'MY'")); return send(200, { results: [{ geoTargetConstant: { resourceName: 'geoTargetConstants/2458' } }] }); }
      assert.ok(b.query.includes("language_constant.name = 'English'"));
      return send(200, { results: [{ languageConstant: { resourceName: 'languageConstants/1000' } }] });
    });
    await new Promise<void>(r => provider.listen(0, '127.0.0.1', r)); const a = provider.address();
    s = await startServer({ ...fakes.env, MERIDIAN_URL_GOOGLE_ADS: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}` });
    admin = await owner(s); editor = await member(s, admin, 'editor', 'editor@example.com', 'Editor');
    await saveSites(admin, [{ id: 's1', domain: 'test.example', cc: 'MY', country: 'Malaysia', lang: 'English', topic: 'Coffee' }]);
  });
  after(() => { s?.stop(); fakes?.stop(); provider?.closeAllConnections(); provider?.close(); });
  it('requires account setup and Google OAuth client; admins alone may set it up', async () => {
    assert.equal((await editor.put('/api/integrations/ads', { values: { customerId: '1234567890' } })).status, 403);
    assert.equal((await editor.post('/api/oauth/google/start', { kind: 'ads' })).status, 403);
    assert.equal((await admin.put('/api/integrations/ads', { values: { customerId: '123' } })).status, 400);
    assert.equal((await admin.post('/api/oauth/google/start', { kind: 'ads' })).status, 409);
    await admin.put('/api/integrations/google', { values: { clientId: 'test.apps.googleusercontent.com', clientSecret: 'client-secret-private' } });
    assert.equal((await admin.post('/api/oauth/google/start', { kind: 'ads' })).status, 409);
    const r = await admin.put('/api/integrations/ads', { values: { customerId: '123-456-7890', loginCustomerId: '999-999-9999', refresh: 'injected-refresh' } });
    assert.equal(r.status, 200); assert.equal((await integration()).connected, false); assert.equal((await integration()).config.customerId, '1234567890'); assert.equal(hits.length, 0);
    assert.ok(!JSON.stringify((await admin.get('/api/integrations')).data).includes('injected-refresh'));
  });
  it('authorizes via one-use OAuth state, retains account config, encrypts tokens and tests without keyword queries', async () => {
    const cb = await connect(); const v = await integration(); assert.equal(v.status, 'ok'); assert.equal(v.connected, true); assert.equal(v.config.customerId, '1234567890'); assert.equal(metrics, 0);
    const row = s.db().prepare("SELECT secret, config FROM integrations WHERE id='ads'").get() as { secret: string; config: string };
    assert.match(row.secret, /^v1\./); assert.ok(!row.secret.includes('ref-1')); assert.ok(!row.config.includes('acc-1'));
    for (const path of ['/api/state','/api/integrations']) for (const secret of ['ref-1', 'acc-1', 'client-secret-private']) assert.ok(!JSON.stringify((await admin.get(path)).data).includes(secret));
    assert.equal((await fetch(cb, { redirect: 'manual' })).status, 302); assert.equal(metrics, 0);
  });
  let id: number;
  it('fetches country/language-scoped metrics after real queued research and persists close-variant provenance', async () => {
    // Verify the existing authorization still works after a replayed callback.
    await admin.post('/api/integrations/ads/test');
    const r = await editor.post('/api/requests', { siteId: 's1', topic: 'Coffee variants', goal: 'Find a new topic cluster', model: 'GPT-6 Luna' });
    assert.equal(r.status, 201); id = (r.data.request as { id: number }).id;
    const done = await until('keyword research', async () => { const v = await request(id); return ['done','failed'].includes(v.status) ? v : null; });
    assert.equal(done.status, 'done'); assert.equal(metrics, 1);
    assert.deepEqual(done.keywords.map(k => [k.volume, k.volumeProvider, k.volumeGroup]), [[1200,'ads','cara membuat cold brew'],[1200,'ads','cara membuat cold brew']]);
    assert.ok(done.keywords.every(k => k.volumeAt > 0)); assert.match(JSON.stringify(done.steps), /Fetching search volume from Google Ads/);
    assert.match(done.notes, /Google Ads data from Google Ads/);
    assert.equal((s.db().prepare("SELECT count(*) AS n FROM job_runs WHERE model='Google Ads search volume' AND tokens=0 AND cost_usd=0").get() as { n: number }).n, 1);
  });
  it('renews early-expired access once and rejects invalid provider choices', async () => {
    renewOnce = true;
    assert.equal((await editor.post(`/api/requests/${id}/volumes`, { provider: 'ads' })).status, 200);
    assert.ok(fakes.hits.some(h => h.path === '/google-token/token' && h.body.includes('grant_type=refresh_token')));
    assert.equal(hits.at(-1)!.headers.authorization, 'Bearer acc-2');
    assert.equal((await editor.post(`/api/requests/${id}/volumes`, { provider: '__proto__' })).status, 400);
  });
  it('rejects unknown targeting without worldwide fallback; quota and project errors preserve prior metrics', async () => {
    await admin.put('/api/integrations/dfs', { values: { login: DFS_LOGIN, password: DFS_PASSWORD } });
    const dfsBefore = fakes.hits.filter(h => h.path.includes('/keywords_data/')).length;
    const before = metrics; unknownLocale = true;
    const unknown = await editor.post(`/api/requests/${id}/volumes`, { provider: 'ads' }); assert.equal(unknown.status, 409); assert.match(String(unknown.data.error), /no targeting fallback/); assert.equal(metrics, before); unknownLocale = false;
    status = 429;
    const quota = await editor.post(`/api/requests/${id}/volumes`, { provider: 'ads' }); assert.equal(quota.status, 429); assert.match(String(quota.data.error), /quota or rate limit/);
    status = 403;
    const denied = await editor.post(`/api/requests/${id}/volumes`, { provider: 'ads' }); assert.equal(denied.status, 409); assert.match(String(denied.data.error), /Cloud project needs/);
    for (const r of [quota, denied]) assert.ok(!JSON.stringify(r.data).includes('ref-1'));
    assert.equal((await request(id)).keywords[0].volume, 1200);
    assert.equal(fakes.hits.filter(h => h.path.includes('/keywords_data/')).length, dfsBefore, 'no silent provider fallback'); status = 200;
  });
  it('rejects manager/test accounts and preserves authorization when changing customer settings', async () => {
    manager = true; assert.equal(((await admin.post('/api/integrations/ads/test')).data.result as {status:string}).status, 'bad'); manager = false;
    testAccount = true; assert.equal(((await admin.post('/api/integrations/ads/test')).data.result as {status:string}).status, 'bad'); testAccount = false;
    await admin.put('/api/integrations/ads', { values: { customerId: '123-456-7890', loginCustomerId: '9999999999' } }); assert.equal((await integration()).connected, true); assert.equal((await integration()).status, 'ok');
    assert.ok(!s.output().includes('ref-1')); assert.ok(!s.output().includes('client-secret-private'));
  });
  it('distinguishes absent metrics from a real zero; missing keywords remain unknown', async () => {
    average = undefined; omitVariants = true;
    await editor.post(`/api/requests/${id}/volumes`, { provider: 'ads' });
    assert.deepEqual((await request(id)).keywords.map(k => k.volume), [null, null]);
    average = '0';
    await editor.post(`/api/requests/${id}/volumes`, { provider: 'ads' });
    assert.deepEqual((await request(id)).keywords.map(k => k.volume), [0, null]);
    average = '9007199254740993';
    await editor.post(`/api/requests/${id}/volumes`, { provider: 'ads' });
    assert.equal((await request(id)).keywords[0].volume, null, 'unsafe int64 is not rounded into a fabricated metric');
  });
  it('disconnects locally without removing the Google OAuth client, GSC or non-pilot data', async () => {
    const before = (await request(id)).keywords;
    assert.equal((await editor.del('/api/integrations/ads')).status, 403); assert.equal((await admin.del('/api/integrations/ads')).status, 200); assert.equal((await integration()).connected, false);
    assert.equal(s.db().prepare("SELECT id FROM integrations WHERE id='ads'").get(), undefined);
    assert.ok(s.db().prepare("SELECT id FROM integrations WHERE id='google'").get()); assert.deepEqual((await request(id)).keywords, before);
    assert.equal((await editor.post(`/api/requests/${id}/volumes`, { provider: 'ads' })).status, 409);
  });
});

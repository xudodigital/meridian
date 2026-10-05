import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SEO_TASKS, type SeoTaskWire } from '../shared/seo-tasks.ts';
import { parseTaskResult, infographicSvg } from './seo-tasks.ts';
import { htmlObservations, publicAddress } from './live-audit.ts';
import type { ArticleContent } from './article-content.ts';
import { startServer, owner, saveSites, member, until, type TestServer, type Client } from './testkit.ts';

const result = { summary: 'Useful draft', findings: [{ title: 'Evidence', detail: 'Check the source.', basis: 'needs-verification' }], actions: [{ title: 'Review', detail: 'Check this claim with a qualified person.', priority: 'high', owner: 'Editor' }], limitations: ['A draft, not verified truth.'], sources: [{ title: 'Google', url: 'https://developers.google.com/search/docs/essentials' }], links: [], visual: null };
const content: ArticleContent = { title: 'Coffee', titleEn: 'Coffee', titleTag: 'Coffee', metaDescription: 'A useful guide.', slug: 'coffee', byline: { text: 'Editor', en: 'Editor' }, disclosure: { text: 'AI draft', en: 'AI draft' }, blocks: [{ type: 'p', text: 'Learn how to brew coffee safely.', en: 'Learn how to brew coffee safely.' }], sources: [{ title: 'Source', url: 'https://example.com/source' }], reviewerNotes: [] };

describe('SEO task results and public audit boundaries', () => {
  it('rejects incomplete results, removes unsafe URLs and validates contextual link targets', () => {
    assert.throws(() => parseTaskResult('{}', 'audit', []), /incomplete/);
    const articles = [1, 2].map(id => ({ id, status: 'review', category: 'Coffee', content }));
    const r = parseTaskResult(JSON.stringify({ ...result, sources: [{ title: 'bad', url: 'javascript:alert(1)' }], links: [
      { from: 1, to: 2, anchor: 'brew coffee', reason: 'Related guide' }, { from: 1, to: 1, anchor: 'brew coffee' }, { from: 1, to: 999, anchor: 'brew coffee' }, { from: 1, to: 2, anchor: 'invented text' },
    ] }), 'links', articles);
    assert.equal(r.links.length, 1); assert.equal(r.sources.length, 0); assert.match(r.limitations.join(' '), /invalid/);
  });
  it('renders escaped fixed SVG and requires usable visual fields', () => {
    assert.throws(() => parseTaskResult(JSON.stringify(result), 'visual', []), /at least two steps/);
    const v = { title: '<script>oops</script>', alt: 'Process', steps: [{ label: 'First', detail: 'Prepare' }, { label: 'Second', detail: 'Finish' }] };
    const r = parseTaskResult(JSON.stringify({ ...result, visual: v }), 'visual', []);
    const svg = infographicSvg(r.visual!);
    assert.ok(!svg.includes('<script>')); assert.match(svg, /&lt;script&gt;/); assert.match(svg, /aria-labelledby/);
  });
  it('refuses private, local and mapped IPs, and reports actual markup without indexing/CWV claims', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '172.16.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(publicAddress(ip), false, ip);
    assert.equal(publicAddress('1.1.1.1'), true);
    const obs = htmlObservations(`<title>Page</title><h1>Title</h1><link rel="canonical" href="https://example.com/a/"><meta name="robots" content="noindex"><script type="application/ld+json">{bad}</script>`, 'https://example.com/a/');
    assert.equal(obs.noindex, true); assert.equal(obs.invalidSchema, true); assert.equal(obs.h1Count, 1); assert.equal(obs.canonical, 'https://example.com/a/');
  });
});

describe('real SEO queue and APIs with isolated fake services', () => {
  let s: TestServer, admin: Client, viewer: Client, reviewer: Client;
  let provider: ReturnType<typeof createServer>, providerUrl = '', serpCalls = 0;
  const getTask = async (id: number) => (await admin.get(`/api/seo-tasks/${id}`)).data.task as SeoTaskWire;
  const run = async (kind: keyof typeof SEO_TASKS) => {
    const answer = { ...result, ...(kind === 'visual' ? { visual: { title: 'Brew coffee', alt: 'Two steps for coffee', steps: [{ label: 'Prepare', detail: 'Read the guide' }, { label: 'Brew', detail: 'Follow the source' }] } } : {}) };
    writeFileSync(join(s.fakeDir, `seo-${kind}.txt`), JSON.stringify(answer));
    const response = await admin.post('/api/seo-tasks', { siteId: 's1', kind, brief: 'Readers and original coffee expertise', model: 'GPT-6 Luna' });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    const id = (response.data.task as SeoTaskWire).id;
    return until(kind + ' result', async () => { const t = await getTask(id); return t.status === 'done' || t.status === 'failed' ? t : null; });
  };
  before(async () => {
    provider = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      if (req.url?.includes('/serp/')) { serpCalls++; const task = JSON.parse(raw)[0]; assert.equal(task.location_code, 2360); assert.equal(task.language_name, 'Indonesian'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, cost: req.url?.includes('/serp/') ? 0.002 : 0, result: req.url?.includes('/serp/') ? [{ item_types: ['organic'], items: [{ type: 'organic', rank_absolute: 1, title: 'Guide', url: 'https://example.com/guide', description: 'A result snippet' }] }] : [{ money: { balance: 50 } }] }] }));
    });
    await new Promise<void>(r => provider.listen(0, '127.0.0.1', r)); const a = provider.address(); providerUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    s = await startServer({ MERIDIAN_URL_DATAFORSEO: providerUrl }); admin = await owner(s);
    await saveSites(admin, [{ id: 's1', domain: 'coffee.example', cc: 'ID', country: 'Indonesia', lang: 'Indonesian', topic: 'Coffee' }]);
    viewer = await member(s, admin, 'viewer', 'viewer@example.com', 'Viewer'); reviewer = await member(s, admin, 'reviewer', 'reviewer@example.com', 'Reviewer', 's1');
    for (const id of [1, 2]) s.db().prepare("INSERT INTO articles (id, site_id, domain, country, lang, keyword, created_at, queued_at, status, content) VALUES (?, 's1', 'coffee.example', 'Indonesia', 'Indonesian', 'coffee', ?, ?, 'review', ?)").run(id, Date.now(), Date.now(), JSON.stringify({ ...content, slug: 'coffee-' + id }));
  });
  after(() => { s?.stop(); provider?.closeAllConnections(); provider?.close(); });
  it('runs all six specialist agents and PR/maintenance as drafts without altering articles or deploying', async () => {
    for (const kind of ['strategy', 'architecture', 'audit', 'links', 'refresh', 'visual', 'pr'] as const) {
      const t = await run(kind); assert.equal(t.status, 'done', t.error); assert.equal(t.agent, SEO_TASKS[kind].agent); assert.ok(t.tokens > 0); assert.equal(t.reviewedAt, null);
    }
    assert.equal((s.db().prepare('SELECT COUNT(*) AS n FROM site_builds').get() as { n: number }).n, 0);
    assert.equal((s.db().prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'review'").get() as { n: number }).n, 2);
    const state = (await admin.get('/api/state')).data.seoTasks as SeoTaskWire[];
    assert.ok(state.every(t => t.context === ''), 'large evidence is fetched only on demand');
    assert.ok((s.db().prepare("SELECT COUNT(*) AS n FROM job_runs WHERE kind = 'seo-task'").get() as { n: number }).n >= 7);
  });
  it('requires provider data before SERP/analytics and records the actual bounded SERP request and cost', async () => {
    assert.equal((await admin.post('/api/seo-tasks', { siteId: 's1', kind: 'serp', brief: 'coffee' })).status, 409);
    assert.equal((await admin.post('/api/seo-tasks', { siteId: 's1', kind: 'analysis', brief: 'declines' })).status, 409);
    assert.equal((await admin.put('/api/integrations/dfs', { values: { login: 'dfs@example.com', password: 'test-secret' } })).status, 200);
    const t = await run('serp'); assert.equal(t.status, 'done', t.error); assert.equal(t.serviceCostUsd, 0.002); assert.equal(serpCalls, 1); assert.match(t.context, /A result snippet/);
    s.db().prepare("INSERT INTO integrations (id, status, updated_at) VALUES ('gsc', 'ok', ?)").run(Date.now());
    s.db().prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('gsc:rows', ?)").run(JSON.stringify({ at: Date.now(), error: '', sites: { s1: { property: 'sc-domain:coffee.example', from: '2026-09-01', to: '2026-10-01', rows: 1 } } }));
    s.db().prepare("INSERT INTO gsc_rows (site_id, date, clicks, impressions, position) VALUES ('s1', '2026-10-01', 10, 100, 4)").run();
    const a = await run('analysis'); assert.equal(a.status, 'done', a.error); assert.match(a.context, /sc-domain:coffee.example/);
  });
  it('marks a strategy reviewed and passes it to later writers only for that domain', async () => {
    const t = (await admin.get('/api/seo-tasks')).data.tasks as SeoTaskWire[];
    const strategy = t.find(t => t.kind === 'strategy')!;
    assert.equal((await admin.post(`/api/seo-tasks/${strategy.id}/review`)).status, 200);
    assert.equal((await getTask(strategy.id)).reviewedBy, 'Owner Person');
    const request = await admin.post('/api/requests', { siteId: 's1', topic: 'Coffee' });
    const requestId = (request.data.request as { id: number }).id;
    await until('keyword research', async () => ((await admin.get('/api/state')).data.requests as { id: number; status: string }[]).some(r => r.id === requestId && r.status === 'done'));
    const article = await admin.post('/api/articles', { siteId: 's1', requestId, keyword: 'cara membuat cold brew' }); assert.equal(article.status, 201);
    await until('writer call', async () => readFileSync(join(s.fakeDir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x)).find(x => x.kind === 'article'));
    const calls = readFileSync(join(s.fakeDir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
    assert.match(calls.find(x => x.kind === 'article').prompt, /Reviewed editorial strategy.*Useful draft/);
  });
  it('enforces roles, validates tasks and exports only safe visual artifacts', async () => {
    assert.equal((await viewer.post('/api/seo-tasks', { siteId: 's1', kind: 'strategy', brief: 'goal' })).status, 403);
    assert.equal((await reviewer.get('/api/seo-tasks')).status, 403);
    assert.equal((await reviewer.get('/api/seo-tasks/1')).status, 403);
    assert.equal((await admin.post('/api/seo-tasks', { siteId: 's1', kind: '__proto__', brief: 'goal' })).status, 400);
    const visual = ((await admin.get('/api/seo-tasks')).data.tasks as SeoTaskWire[]).find(t => t.kind === 'visual')!;
    const response = await fetch(s.base + `/api/seo-tasks/${visual.id}/svg`, { headers: { cookie: 'meridian_session=' + admin.cookie } });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition') ?? '', /attachment/); assert.match(await response.text(), /Two steps for coffee/);
    assert.equal((await admin.get('/api/seo-tasks/1/svg')).status, 409);
  });
  it('returns a running task to the shared queue after an orderly restart', async () => {
    writeFileSync(join(s.fakeDir, 'hang'), '');
    writeFileSync(join(s.fakeDir, 'seo-architecture.txt'), JSON.stringify(result));
    const response = await admin.post('/api/seo-tasks', { siteId: 's1', kind: 'architecture', brief: 'Restart recovery' });
    const id = (response.data.task as SeoTaskWire).id;
    await until('running task', async () => (await getTask(id)).status === 'work');
    const old = s, cookie = admin.cookie;
    await old.halt('SIGTERM'); rmSync(join(old.fakeDir, 'hang'));
    s = await startServer({ MERIDIAN_URL_DATAFORSEO: providerUrl }, old.tmp);
    admin.base = s.base; admin.cookie = cookie;
    const done = await until('recovered task', async () => { const t = await getTask(id); return t.status === 'done' ? t : null; });
    assert.equal(done.status, 'done');
    assert.match((s.db().prepare("SELECT text FROM job_steps WHERE kind = 'seo-task' AND job_id = ? ORDER BY id DESC LIMIT 1").get(id) as { text: string }).text, /human review/);
  });
  it('fails invalid model output clearly and refuses review of a changed domain', async () => {
    writeFileSync(join(s.fakeDir, 'seo-strategy.txt'), '{}');
    const response = await admin.post('/api/seo-tasks', { siteId: 's1', kind: 'strategy', brief: 'invalid output' });
    const id = (response.data.task as SeoTaskWire).id;
    const failed = await until('failed result', async () => { const t = await getTask(id); return t.status === 'failed' ? t : null; }); assert.match(failed.error, /incomplete/);
    assert.equal((await admin.post(`/api/seo-tasks/${id}/review`)).status, 409);
    await saveSites(admin, [{ id: 's1', domain: 'other.example', cc: 'ID', country: 'Indonesia', lang: 'Indonesian' }]);
    assert.equal((await admin.post('/api/seo-tasks/1/review')).status, 409);
  });
});

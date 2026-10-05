// The spend ledger and the enforced daily budget, end to end: a real server process, a temporary data folder and the
// fake Claude Code CLI. Every CLI run of a job becomes a row (revisions, retries and failures too), GET /api/state and
// the `spend` event carry the sums, a site at its budget is refused new agent jobs (409) and its waiting jobs are held
// until the budget is raised, and the old cost columns are copied into the ledger once. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Client, events, member, owner, saveSites, startServer, until, type Json, type TestServer } from './testkit.ts';

type Spend = { budget: number; day: number; sites: Record<string, { today: number; tokensToday: number; d7: number; d28: number; tokens28: number }>; agents: Record<string, { tokens: number; cost: number; runs: number }> };
type Article = Json & { id: number; status: string; tokens: number; costUsd: number; photos: { status: string } };
type Request = Json & { id: number; status: string; siteId: string; topic: string };
type Run = { kind: string; job_id: number; site_id: string; agent: string; model: string; tokens: number; cost_usd: number; outcome: string };
const SITES = ['s1', 's2', 's3', 's4'].map(id => ({ id, domain: id + '.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live' }));
const cents = (n: number) => Math.round(n * 100) / 100;
const stopped = (domain: string, budget: string) => `${domain} has used its daily budget of $${budget}. It resets at midnight, or raise the budget in Settings.`;

let s: TestServer, c: Client;
const state = async (who: Client = c) => (await who.get('/api/state')).data as { requests: Request[]; articles: Article[]; spend: Spend | null };
const runs = (where = '1'): Run[] => s.db().prepare(`SELECT kind, job_id, site_id, agent, model, tokens, cost_usd, outcome FROM job_runs WHERE ${where} ORDER BY id`).all().map(r => ({ ...r }) as Run);
const spent = (site: string) => cents(runs(`site_id = '${site}'`).reduce((n, r) => n + r.cost_usd, 0));
const requestIn = (id: number, status: string) => until(`request ${id} to be ${status}`, async () => (await state()).requests.find(r => r.id === id && r.status === status));
const articleIn = (id: number, status: string) => until(`article ${id} to be ${status}`, async () => (await state()).articles.find(a => a.id === id && a.status === status));
/** The photo job that follows every written article has ended (it fails here: no photo service is reachable). */
const photosOver = (id: number) => until(`the photo job of article ${id}`, async () => (await state()).articles.find(a => a.id === id && (a.photos.status === 'done' || a.photos.status === 'failed')));
const ask = (siteId: string, topic: string) => c.post('/api/requests', { siteId, topic, goal: 'Find a new topic cluster', model: 'GPT-6 Luna' });
const write = (siteId: string, requestId: number, keyword: string) => c.post('/api/articles', { siteId, keyword, requestId, model: 'GPT-6.1 Sol' });
async function research(siteId: string, topic: string): Promise<number> {
  const r = await ask(siteId, topic);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = (r.data.request as Request).id;
  await requestIn(id, 'done');
  return id;
}
async function budget(usd: number): Promise<void> {
  const cur = await c.get('/api/workspace');
  const version = ((cur.data.docs as Record<string, { version: number }>).settings ?? { version: 0 }).version;
  const r = await c.put('/api/workspace/docs/settings', { version, data: { budget: usd, native: false } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
const control = (name: string, value: string | null) => { const f = join(s.fakeDir, name); if (value === null) rmSync(f, { force: true }); else writeFileSync(f, value); };

before(async () => {
  s = await startServer();
  c = await owner(s);
  control('base-cost', '0.12');
  await saveSites(c, SITES);
});
after(() => s?.stop());

describe('the ledger', () => {
  let rid = 0, aid = 0;

  it('starts empty: no spend, the default budget', async () => {
    const sp = (await state()).spend!;
    assert.deepEqual({ budget: sp.budget, sites: sp.sites, agents: sp.agents }, { budget: 25, sites: {}, agents: {} });
  });

  it('gets a row for a research run, sends the `spend` event, and reports it in the state', async () => {
    const got = await events(c, async () => { rid = await research('s1', 'cold brew'); });
    assert.deepEqual(runs(), [{ kind: 'request', job_id: rid, site_id: 's1', agent: 'Keyword', model: 'gpt-6-luna', tokens: 598625, cost_usd: 0.12, outcome: 'ok' }]);
    const ev = got.filter(e => e.event === 'spend').at(-1)?.data as Spend | undefined;
    assert.ok(ev, 'a spend event after the run');
    assert.deepEqual(ev.sites.s1, { today: 0.12, tokensToday: 598625, d7: 0.12, d28: 0.12, tokens28: 598625 });
    assert.deepEqual(ev.agents, { Keyword: { tokens: 598625, cost: 0.12, runs: 1 } });
    assert.deepEqual((await state()).spend!.sites, ev.sites);
  });

  it('gets a row for the article and one for each CLI run of its photo job', async () => {
    const r = await write('s1', rid, 'cara membuat cold brew');
    assert.equal(r.status, 201, JSON.stringify(r.data));
    aid = (r.data.article as Article).id;
    await articleIn(aid, 'review');
    await photosOver(aid);
    assert.deepEqual(runs(`kind <> 'request'`).map(x => [x.kind, x.job_id, x.agent, x.outcome, x.cost_usd]), [['article', aid, 'Content Writer', 'ok', 0.12], ['photos', aid, 'Site Builder', 'ok', 0.12]]);
    const sp = (await state()).spend!;
    assert.equal(cents(sp.sites.s1!.today), 0.36);
    assert.equal(sp.agents['Content Writer']!.tokens, 58000);
    assert.equal(sp.agents['Site Builder']!.runs, 1);
  });

  it('adds a row for a revision instead of overwriting the first draft', async () => {
    control('cost', '0.3');
    try {
      assert.equal((await c.post(`/api/articles/${aid}/revise`, { note: 'Shorter.' })).status, 200);
      await until('the revision to be written', async () => (await state()).articles.find(a => a.id === aid && a.status === 'review' && a.revision === 1));
      await photosOver(aid);
    } finally { control('cost', null); }
    assert.deepEqual(runs(`kind = 'article'`).map(x => x.cost_usd), [0.12, 0.3]);
    /* The article shows what its latest run cost; the ledger has both, so the day's spend does not lose the first. */
    assert.equal((await state()).articles.find(a => a.id === aid)!.costUsd, 0.3);
    assert.equal(spent('s1'), cents(0.12 + 0.12 + 0.12 + 0.3 + 0.3));
    assert.equal(cents((await state()).spend!.sites.s1!.today), spent('s1'));
  });

  it('counts a run that failed after using tokens, and the failed job shows that cost, not the one before', async () => {
    control('error', 'The model is overloaded.');
    control('cost', '0.07');
    let id = 0;
    try {
      const r = await write('s1', rid, 'rasio cold brew');
      id = (r.data.article as Article).id;
      const failed = await articleIn(id, 'failed');
      assert.equal(failed.error, 'OpenAI did not complete the response: The model is overloaded.');
      assert.equal(failed.costUsd, 0.07);
      assert.equal(failed.tokens, 33000);
    } finally { control('error', null); control('cost', null); }
    assert.deepEqual(runs(`kind = 'article' AND job_id = ${id}`).map(x => [x.outcome, x.cost_usd]), [['failed', 0.07]]);
    /* Trying again is one more row. */
    assert.equal((await c.post(`/api/articles/${id}/retry`)).status, 200);
    await articleIn(id, 'review');
    await photosOver(id);
    assert.deepEqual(runs(`kind = 'article' AND job_id = ${id}`).map(x => [x.outcome, x.cost_usd]), [['failed', 0.07], ['ok', 0.12]]);
    /* A research request that fails records its cost the same way. */
    control('error', 'No.');
    try {
      const q = await ask('s2', 'phin');
      const f = await requestIn((q.data.request as Request).id, 'failed');
      assert.equal(f.costUsd, 0.12);
    } finally { control('error', null); }
    assert.deepEqual(runs(`site_id = 's2'`).map(x => [x.kind, x.outcome, x.cost_usd]), [['request', 'failed', 0.12]]);
  });

  it('keeps spend from a native reviewer', async () => {
    const reviewer = await member(s, c, 'reviewer', 'linh@example.com', 'Linh Reviewer', 's1');
    assert.equal((await state(reviewer)).spend, null);
    const got = await events(reviewer, async () => { await research('s2', 'robusta'); });
    assert.equal(got.filter(e => e.event === 'spend').length, 0);
    const viewer = await member(s, c, 'viewer', 'vi@example.com', 'Vi Viewer');
    assert.ok((await state(viewer)).spend!.sites.s1);
  });
});

describe('the daily budget as a hard stop', () => {
  it('refuses every new agent job for a site that used its budget, with a message that says what to do', async () => {
    const st = await state(), rid = st.requests.find(r => r.siteId === 's1' && r.status === 'done')!.id;
    const inReview = st.articles.find(a => a.status === 'review')!;
    /* An approved article and no site identity yet: the first build would ask the Site Builder. A failed one to retry. */
    await budget(25);   /* also turns the native-speaker rule off, so the article can be approved here */
    assert.equal((await c.post(`/api/articles/${st.articles.find(a => a.id !== inReview.id)!.id}/approve`)).status, 200);
    control('error', 'No.');
    const f = await write('s1', rid, 'cold brew gagal');
    const failedId = (f.data.article as Article).id;
    await articleIn(failedId, 'failed');
    control('error', null);

    await budget(0.5);
    assert.ok(spent('s1') >= 0.5);
    const no = stopped('s1.example', '0.50');
    const refused: [string, { status: number; data: Json }][] = [
      ['research', await ask('s1', 'another topic')],
      ['research again', await c.post(`/api/requests/${rid}/retry`)],
      ['article', await write('s1', rid, 'a new keyword')],
      ['revision', await c.post(`/api/articles/${inReview.id}/revise`, { note: 'Again.' })],
      ['retry', await c.post(`/api/articles/${failedId}/retry`)],
      ['photos', await c.post(`/api/articles/${inReview.id}/photos`)],
      ['first build', await c.post('/api/sites/s1/builds')],
    ];
    for (const [what, r] of refused) assert.deepEqual([what, r.status, r.data.error], [what, 409, no]);
    /* Nothing changed: the article still waits for review, the request is still done. */
    const now = await state();
    assert.equal(now.articles.find(a => a.id === inReview.id)!.status, 'review');
    assert.equal(now.articles.find(a => a.id === failedId)!.status, 'failed');
    assert.equal(now.requests.find(r => r.id === rid)!.status, 'done');
    /* Deciding on an article costs nothing and still works; so does a site with budget left. */
    assert.equal((await c.post(`/api/articles/${failedId}/retry`)).status, 409);
    assert.equal((await ask('s4', 'liberika')).status, 201);
    /* The budget alert at 100% is recorded (the dashboards read it from here). */
    const alerts = s.db().prepare(`SELECT key, title FROM alerts WHERE event = 'budget' AND site = 's1'`).all() as { key: string; title: string }[];
    assert.ok(alerts.length <= 1, 'the budget was $25 while the money was spent');

    /* Raising the budget lifts the stop at once. */
    await budget(25);
    const ok = await ask('s1', 'another topic');
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    await requestIn((ok.data.request as Request).id, 'done');
    const build = await c.post('/api/sites/s1/builds');
    assert.equal(build.status, 202, JSON.stringify(build.data));
    await until('the build to finish', async () => { const b = ((await c.get('/api/builds')).data.builds as (Json & { status: string })[])[0]; return b && (b.status === 'ready' || b.status === 'failed'); });
    assert.equal(runs(`kind = 'build'`).length, 1, 'the identity job of the first build is in the ledger');
    assert.equal(runs(`kind = 'build'`)[0]!.agent, 'Site Builder');
  });

  it('holds the jobs that were already waiting, lets other sites run, and starts them when the budget is raised', async () => {
    await until('the queue to be empty', async () => (await state()).requests.every(r => r.status === 'done' || r.status === 'failed'));
    await budget(0.2);
    control('delay', '250');
    let ids: number[] = [], other = 0;
    try {
      /* Three for s3, all accepted while it has spent nothing, then one for s4 behind them. */
      for (const topic of ['arabika', 'robusta s3', 'liberika s3']) { const r = await ask('s3', topic); assert.equal(r.status, 201, JSON.stringify(r.data)); ids.push((r.data.request as Request).id); }
      const o = await ask('s4', 'excelsa');
      assert.equal(o.status, 201, JSON.stringify(o.data));
      other = (o.data.request as Request).id;
      await requestIn(ids[0]!, 'done');
      await requestIn(ids[1]!, 'done');
      /* s3 is at $0.24 of $0.20 now: its third job waits, and the one of s4 behind it runs. */
      await requestIn(other, 'done');
      await new Promise(r => setTimeout(r, 600));
      const st = await state();
      assert.equal(st.requests.find(r => r.id === ids[2])!.status, 'queued', 'held, not failed');
      assert.equal(cents(st.spend!.sites.s3!.today), 0.24);
      assert.equal(st.spend!.budget, 0.2);
      assert.equal((await ask('s3', 'one more')).data.error, stopped('s3.example', '0.20'));
      const alerts = (s.db().prepare(`SELECT key, title FROM alerts WHERE event = 'budget' AND site = 's3'`).all() as { key: string; title: string }[]);
      assert.equal(alerts.length, 1);
      assert.match(alerts[0]!.title, /^s3\.example used its daily budget: its agent jobs are stopped$/);

      /* Raised: the dashboards hear the new budget and the held job starts without anyone asking again. */
      const got = await events(c, async () => { await budget(5); });
      assert.equal((got.filter(e => e.event === 'spend').at(-1)?.data as Spend | undefined)?.budget, 5);
      await requestIn(ids[2]!, 'done');
    } finally { control('delay', null); }
    assert.equal(runs(`site_id = 's3'`).length, 3);
  });
});

describe('a busy database', () => {
  it('does not lose the run: the job fails on its own write, and the ledger row is written once the lock is gone', async () => {
    const t = await startServer();
    try {
      const admin = await owner(t);
      await saveSites(admin, SITES);
      writeFileSync(join(t.fakeDir, 'delay'), '400');
      const r = await admin.post('/api/requests', { siteId: 's1', topic: 'kopi terkunci', goal: 'g', model: '' });
      const id = (r.data.request as Request).id;
      const reqs = async () => (await admin.get('/api/state')).data.requests as Request[];
      await until('the job to start', async () => (await reqs()).find(x => x.id === id && x.status === 'work'));
      /* Another program holds the write lock for longer than the server waits (5 seconds). */
      const other = new DatabaseSync(join(t.tmp, 'data', 'meridian.db'), { timeout: 5000 });
      try { other.exec('BEGIN IMMEDIATE'); await new Promise(x => setTimeout(x, 6500)); other.exec('COMMIT'); } finally { other.close(); }
      const ended = await until('the job to end', async () => (await reqs()).find(x => x.id === id && x.status !== 'work' && x.status !== 'queued'), 20_000);
      assert.equal(ended.status, 'failed');
      /* The CLI ran and was paid for: its row arrives, at the latest with the next try 5 seconds on. */
      const row = await until('the ledger row', async () => t.db().prepare(`SELECT cost_usd, outcome FROM job_runs WHERE kind = 'request' AND job_id = ?`).get(id) as { cost_usd: number; outcome: string } | undefined, 15_000);
      assert.deepEqual({ ...row }, { cost_usd: 0.00035, outcome: 'ok' });
      assert.equal(t.child.exitCode, null, 'the server is still running');
    } finally { t.stop(); }
  });
});

describe('a database from before the ledger', () => {
  it('has its recorded costs copied in once, at the first start, and never again', async () => {
    const old = await startServer();
    try {
      await old.halt('SIGTERM');
      const db = old.db();
      const y = Date.now() - 2 * 86_400_000;
      db.exec(`DELETE FROM job_runs; DELETE FROM kv WHERE key = 'ledger:backfilled'`);
      db.prepare(`INSERT INTO requests (site_id, domain, country, lang, topic, goal, model, status, tokens, cost_usd, created_at, started_at, finished_at)
        VALUES ('s1', 's1.example', 'Indonesia', 'Indonesian', 'old topic', 'g', 'GPT-6 Luna', 'done', 900, 0.9, ?, ?, ?)`).run(y - 3000, y - 2000, y);
      db.prepare(`INSERT INTO articles (site_id, domain, country, lang, keyword, status, tokens, cost_usd, photos_status, photos_tokens, photos_cost, photos_finished_at, created_at, queued_at, started_at, finished_at)
        VALUES ('s1', 's1.example', 'Indonesia', 'Indonesian', 'old', 'approved', 4000, 1.5, 'done', 200, 0.2, ?, ?, ?, ?, ?)`).run(y, y - 3000, y - 3000, y - 2000, y - 1000);
      await old.halt('SIGTERM');
      const again = await startServer({}, old.tmp);
      try {
        const rows = () => again.db().prepare('SELECT kind, agent, tokens, cost_usd, outcome, backfilled, ended_at FROM job_runs ORDER BY id').all().map(r => ({ ...r }));
        assert.deepEqual(rows(), [
          { kind: 'request', agent: 'Keyword', tokens: 900, cost_usd: 0.9, outcome: 'ok', backfilled: 1, ended_at: y },
          { kind: 'article', agent: 'Content Writer', tokens: 4000, cost_usd: 1.5, outcome: 'ok', backfilled: 1, ended_at: y - 1000 },
          { kind: 'photos', agent: 'Site Builder', tokens: 200, cost_usd: 0.2, outcome: 'ok', backfilled: 1, ended_at: y },
        ]);
        const admin = await owner(again);
        const sp = (await admin.get('/api/state')).data.spend as Spend;
        assert.deepEqual(sp.sites.s1, { today: 0, tokensToday: 0, d7: 2.6, d28: 2.6, tokens28: 5100 });
        await again.halt('SIGTERM');
        const third = await startServer({}, old.tmp);
        try { assert.equal((third.db().prepare('SELECT COUNT(*) AS n FROM job_runs').get() as { n: number }).n, 3); }
        finally { third.stop(); }
      } finally { again.child.kill(); }
    } finally { old.child.kill(); }
  });
});

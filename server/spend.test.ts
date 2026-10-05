// The spend ledger in this process (ledger.ts): the one-time copy of the costs recorded before it existed, spend per
// site by local day, 7 and 28 days, tokens per agent, the hard stop at the daily budget, the alerts at 80% and 100%
// (notify.ts), the weekly report (report.ts), and a row for every CLI run however it ended. Uses a temporary data
// folder and the fake CLI. Run with `npm run test:server`.
/* First: db.ts opens the database when imported, and it must be a temporary one, never the real workspace. */
import { TEST_DATA } from './fixtures/temp-data.ts';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { db } from './db.ts';
import { runOpenAI, type ApiJob } from './engine.ts';
import { startFakeOpenAI } from './fixtures/fake-openai.ts';
import { putDoc } from './workspace.ts';

/* Loaded in before(), after the old job rows are in the database: the ledger copies them once, when it is imported. */
let L: typeof import('./ledger.ts');
let N: typeof import('./notify.ts');
let R: typeof import('./report.ts');

const NOW = Date.now();
const midnight = (() => { const d = new Date(NOW); d.setHours(0, 0, 0, 0); return d.getTime(); })();
/** A moment of the local day `days` before today (noon, so a clock change cannot move it to another day). */
const daysAgo = (days: number): number => { const d = new Date(midnight); d.setDate(d.getDate() - days); d.setHours(12); return d.getTime(); };
const cents = (n: number) => Math.round(n * 100) / 100;
const rows = (where = '1') => db.prepare(`SELECT kind, job_id, site_id, agent, tokens, cost_usd, outcome, backfilled FROM job_runs WHERE ${where} ORDER BY id`).all().map(r => ({ ...r }));
const alerts = () => (db.prepare(`SELECT key, title, body FROM alerts WHERE event = 'budget' ORDER BY id`).all() as { key: string; title: string; body: string }[]);
let version = 0;
const settings = (data: Record<string, number | boolean | string>) => { const r = putDoc('settings', version, data, 0); assert.ok(r.ok); version = r.version; };

const fakeDir = join(TEST_DATA, 'fake');
let fake: Awaited<ReturnType<typeof startFakeOpenAI>>;
const job = (over: Partial<ApiJob> = {}): ApiJob => ({ prompt: 'Meridian task: none\n', model:'gpt-6-luna', timeoutMin:1, ...over });

before(async () => {
  mkdirSync(fakeDir, { recursive: true });
  fake = await startFakeOpenAI(fakeDir);
  process.env.MERIDIAN_URL_OPENAI=fake.url; process.env.OPENAI_API_KEY='test-openai-key';
  /* What an older Meridian left behind: the cost of each job's latest run, in the job's own row. */
  const y = daysAgo(1);
  db.prepare(`INSERT INTO requests (site_id, domain, country, lang, topic, goal, model, status, tokens, cost_usd, created_at, started_at, finished_at)
    VALUES ('s1', 'kopi.example', 'Indonesia', 'Indonesian', 'cold brew', 'g', 'GPT-6 Luna', 'done', 1000, 0.5, ?, ?, ?),
           ('s1', 'kopi.example', 'Indonesia', 'Indonesian', 'never ran', 'g', '', 'queued', 0, 0, ?, NULL, NULL),
           ('s2', 'other.example', 'Vietnam', 'Vietnamese', 'phin', 'g', '', 'failed', 700, 7, ?, ?, ?)`).run(y - 5000, y - 4000, y - 3000, y, y - 900, y - 800, y - 700);
  db.prepare(`INSERT INTO articles (site_id, domain, country, lang, keyword, status, tokens, cost_usd, photos_status, photos_tokens, photos_cost, photos_started_at, photos_finished_at, created_at, queued_at, started_at, finished_at)
    VALUES ('s1', 'kopi.example', 'Indonesia', 'Indonesian', 'a', 'review', 5000, 1.25, 'done', 300, 0.25, ?, ?, ?, ?, ?, ?)`).run(y - 200, y - 100, y - 2000, y - 2000, y - 1500, y - 1000);
  db.prepare(`INSERT INTO site_builds (site_id, domain, version, status, tokens, cost_usd, created_at, queued_at, started_at, finished_at, updated_at)
    VALUES ('s1', 'kopi.example', 1, 'ready', 400, 0.1, ?, ?, ?, ?, ?), ('s1', 'kopi.example', 2, 'ready', 0, 0, ?, ?, ?, ?, ?)`).run(y - 90, y - 90, y - 80, y - 70, y - 70, y - 60, y - 60, y - 50, y - 40, y - 40);
  L = await import('./ledger.ts');
  N = await import('./notify.ts');
  R = await import('./report.ts');
  assert.ok(putDoc('sites', 0, [{ id: 's1', domain: 'kopi.example', country: 'Indonesia', cc: 'ID' }, { id: 's2', domain: 'other.example', country: 'Vietnam', cc: 'VN' }, { id: 's3', domain: 'teh.example', country: 'Indonesia', cc: 'ID' }], 0).ok);
  N.watch();
});
after(() => {
  fake.close();
  db.close();
  rmSync(TEST_DATA, { recursive: true, force: true });
});

const run = (siteId: string, at: number, costUsd: number, over: Partial<import('./ledger.ts').RunRow> = {}) =>
  L.recordRun({ kind: 'article', jobId: 50, siteId, agent: 'Content Writer', model: 'sonnet', startedAt: at - 1000, endedAt: at, tokens: 1000, costUsd, outcome: 'ok', ...over });

describe('the costs recorded before the ledger existed', () => {
  it('are copied once: one row per job that used something, marked as copied, and jobs that never ran are left out', () => {
    assert.deepEqual(rows(), [
      { kind: 'request', job_id: 1, site_id: 's1', agent: 'Keyword', tokens: 1000, cost_usd: 0.5, outcome: 'ok', backfilled: 1 },
      { kind: 'request', job_id: 3, site_id: 's2', agent: 'Keyword', tokens: 700, cost_usd: 7, outcome: 'failed', backfilled: 1 },
      { kind: 'article', job_id: 1, site_id: 's1', agent: 'Content Writer', tokens: 5000, cost_usd: 1.25, outcome: 'ok', backfilled: 1 },
      { kind: 'photos', job_id: 1, site_id: 's1', agent: 'Site Builder', tokens: 300, cost_usd: 0.25, outcome: 'ok', backfilled: 1 },
      { kind: 'build', job_id: 1, site_id: 's1', agent: 'Site Builder', tokens: 400, cost_usd: 0.1, outcome: 'ok', backfilled: 1 },
    ]);
    assert.ok(db.prepare(`SELECT value FROM kv WHERE key = 'ledger:backfilled'`).get(), 'so the next start copies nothing');
    /* They ended yesterday: nothing of it is today's spend. */
    assert.equal(L.siteSpendToday('s1', NOW), 0);
    assert.equal(cents(L.spendSnapshot(NOW).sites.s1!.d7), 2.1);
  });
});

describe('spend from the ledger', () => {
  it('sums a site\'s runs by local day, 7 days and 28 days, and tokens per agent today', () => {
    run('s1', NOW - 1000, 0.4, { tokens: 2000 });
    run('s1', NOW - 500, 0.6, { kind: 'request', jobId: 9, agent: 'Keyword', tokens: 500, outcome: 'failed' });
    run('s1', midnight - 60_000, 3);          /* a minute before midnight: yesterday */
    run('s1', daysAgo(6), 10);                /* the 7th day back, today included */
    run('s1', daysAgo(7), 100);
    run('s1', daysAgo(27), 1000, { tokens: 9 });
    run('s1', daysAgo(28), 5000);
    run('s2', NOW - 100, 2, { agent: 'Site Builder', kind: 'photos', tokens: 40 });
    const snap = L.spendSnapshot(NOW), s1 = snap.sites.s1!;
    assert.equal(cents(L.siteSpendToday('s1', NOW)), 1);
    assert.equal(cents(s1.today), 1);
    assert.equal(s1.tokensToday, 2500);
    assert.equal(cents(s1.d7), cents(1 + 3 + 10 + 2.1));
    assert.equal(cents(s1.d28), cents(1 + 3 + 10 + 2.1 + 100 + 1000));
    assert.equal(s1.tokens28, 2500 + 1000 * 3 + 9 + 6700);
    assert.equal(L.siteSpendToday('s3', NOW), 0);
    assert.equal(snap.sites.s3, undefined);
    assert.deepEqual(snap.agents, { 'Content Writer': { tokens: 2000, cost: 0.4, runs: 1 }, Keyword: { tokens: 500, cost: 0.6, runs: 1 }, 'Site Builder': { tokens: 40, cost: 2, runs: 1 } });
    assert.equal(snap.budget, 25);
    assert.equal(snap.day, midnight);
  });

  it('counts a revision and a retry as their own rows, never twice and never instead of the first run', () => {
    const before = L.siteSpendToday('s3', NOW);
    run('s3', NOW - 300, 0.2, { jobId: 77 });
    run('s3', NOW - 200, 0.3, { jobId: 77, outcome: 'failed' });
    run('s3', NOW - 100, 0.5, { jobId: 77 });
    assert.deepEqual(L.runsOf('article', 77).map(r => [r.costUsd, r.outcome]), [[0.2, 'ok'], [0.3, 'failed'], [0.5, 'ok']]);
    assert.equal(cents(L.siteSpendToday('s3', NOW) - before), 1);
  });

  it('is the spend of the week in the report, per site, with the budget in the issue column', () => {
    settings({ budget: 25 });
    const report = R.buildReport(NOW).rows;
    const of = (id: string) => report.find(r => r.siteId === id)!;
    assert.equal(cents(of('s1').spend), cents([...L.spendSince(NOW - 7 * 86_400_000)].find(([id]) => id === 's1')![1]));
    assert.ok(of('s1').spend >= 1 + 3 && of('s1').spend < 200);
    assert.equal(cents(of('s3').spend), 1);
    assert.equal(of('s3').issue, 'None');
    settings({ budget: 1.2 });
    assert.equal(R.buildReport(NOW).rows.find(r => r.siteId === 's3')!.issue, 'Near daily budget');
    settings({ budget: 1 });
    assert.equal(R.buildReport(NOW).rows.find(r => r.siteId === 's3')!.issue, 'Daily budget used: agent jobs stopped');
  });
});

describe('the daily budget', () => {
  it('stops a site at 100% of the budget with a message that names it, and only that site', () => {
    settings({ budget: 25 });
    assert.equal(L.budgetStop('s3'), null);
    assert.equal(L.budgetHeld('s3'), false);
    settings({ budget: 1 });
    assert.equal(L.budgetStop('s3'), 'teh.example has used its daily budget of $1.00. It resets at midnight, or raise the budget in Settings.');
    assert.equal(L.budgetStop('s1'), 'kopi.example has used its daily budget of $1.00. It resets at midnight, or raise the budget in Settings.');
    assert.equal(L.budgetStop('never-spent'), null);
    assert.deepEqual([...L.heldSites()].sort(), ['s1', 's2', 's3']);
    settings({ budget: 1.5 });
    assert.deepEqual([...L.heldSites()].sort(), ['s2']);
    /* Tomorrow nothing was spent yet: every site may run again. */
    assert.equal(L.heldSites(NOW + 86_400_000).size, 0);
    assert.equal(L.budgetStop('s2', NOW + 86_400_000), null);
  });

  it('uses the default of $25 while no budget is saved or the saved one is not a positive number', () => {
    settings({ budget: 0 });
    assert.equal(L.budget(), 25);
    settings({ native: true });
    assert.equal(L.budget(), 25);
    settings({ budget: 40 });
    assert.equal(L.budget(), 40);
  });

  it('lets the jobs of sites with budget left go first and keeps the held ones in their place', () => {
    settings({ budget: 1.5 });
    const queue = [{ id: 1, site: 's2' }, { id: 2, site: 's1' }, { id: 3, site: 's2' }];
    assert.equal(L.firstAllowed(queue, j => j.site)?.id, 2);
    assert.equal(L.firstAllowed([queue[0]!, queue[2]!], j => j.site), undefined);
    assert.equal(L.firstAllowed(queue, j => j.site, NOW + 86_400_000)?.id, 1);
    assert.equal(L.firstAllowed([], (j: { site: string }) => j.site), undefined);
    settings({ budget: 25 });
    assert.equal(L.firstAllowed(queue, j => j.site)?.id, 1);
  });

  it('raises one alert at 80% and one at 100%, each once per site and day', () => {
    settings({ budget: 10 });
    db.exec(`DELETE FROM alerts`);
    const at = Date.now();
    run('s4', at, 5);
    assert.deepEqual(alerts(), [], 'half the budget: no alert');
    run('s4', at, 3.5);
    assert.equal(alerts().length, 1);
    assert.match(alerts()[0]!.key, /^budget:s4:/);
    assert.match(alerts()[0]!.title, /passed 80% of its daily budget/);
    assert.match(alerts()[0]!.body, /\$8\.50 of \$10\.00/);
    run('s4', at, 0.1);
    assert.equal(alerts().length, 1, 'still over 80%: not sent again');
    run('s4', at, 2);
    assert.equal(alerts().length, 2);
    assert.match(alerts()[1]!.key, /^budget-stop:s4:/);
    assert.match(alerts()[1]!.title, /used its daily budget: its agent jobs are stopped/);
    assert.match(alerts()[1]!.body, /\$10\.60 of \$10\.00.*held.*midnight/);
    run('s4', at, 2);
    assert.equal(alerts().length, 2, 'already stopped: not sent again');
    /* One run that takes a site from nothing past the budget: the stop alert only. */
    run('s5', at, 11);
    assert.deepEqual(alerts().slice(2).map(a => a.key.split(':').slice(0, 2).join(':')), ['budget-stop:s5']);
    /* A run that ended yesterday does not count as today's. */
    run('s6', daysAgo(1), 50);
    assert.equal(alerts().length, 3);
  });
});

describe('a run of the CLI', () => {
  const meta = { kind: 'request' as const, jobId: 900, siteId: 's9', agent: 'Keyword' };
  const last = () => rows(`site_id = 's9'`).at(-1);
  /** The row is written right after the run, once the job's own result is (ledger.ts). */
  const tick = () => new Promise(r => setImmediate(r));

  it('is written to the ledger with what the CLI said it used, and added up for the job', async () => {
    const used = { tokens: 0, costUsd: 0 };
    const r = await L.metered(meta, () => runOpenAI(job(), new AbortController().signal), used);
    assert.equal(r.tokens, 1500);
    assert.deepEqual(used, { tokens: 1500, costUsd: 0.00035 }, 'known to the job at once');
    await tick();
    assert.deepEqual(last(), { kind: 'request', job_id: 900, site_id: 's9', agent: 'Keyword', tokens: 1500, cost_usd: 0.00035, outcome: 'ok', backfilled: 0 });
    await L.metered(meta, () => runOpenAI(job(), new AbortController().signal), used);
    await tick();
    assert.deepEqual(used, { tokens: 3000, costUsd: 0.0007 });
    assert.equal(L.runsOf('request', 900).length, 2);
    assert.equal(L.runsOf('request', 900)[0]!.model, 'gpt-6-luna');
  });

  it('that failed after using tokens is counted like one that worked', async () => {
    writeFileSync(join(fakeDir, 'error'), 'The model is overloaded.');
    writeFileSync(join(fakeDir, 'cost'), '0.005');
    const used = { tokens: 0, costUsd: 0 };
    try {
      await assert.rejects(L.metered(meta, () => runOpenAI(job(), new AbortController().signal), used), /OpenAI did not complete the response: The model is overloaded\./);
    } finally { rmSync(join(fakeDir, 'error')); rmSync(join(fakeDir, 'cost')); }
    await tick();
    assert.deepEqual(last(), { kind: 'request', job_id: 900, site_id: 's9', agent: 'Keyword', tokens: 48000, cost_usd: 0.005, outcome: 'failed', backfilled: 0 });
    assert.deepEqual(used, { tokens: 48000, costUsd: 0.005 });
  });

  it('that timed out or was cancelled has a row too, with no usage because the CLI reported none', async () => {
    writeFileSync(join(fakeDir, 'delay'), '20000');
    try {
      await assert.rejects(L.metered(meta, () => runOpenAI(job({ timeoutMin: 0.005 }), new AbortController().signal)), /did not finish/);
      await tick();
      assert.deepEqual(last(), { kind: 'request', job_id: 900, site_id: 's9', agent: 'Keyword', tokens: 0, cost_usd: 0, outcome: 'timeout', backfilled: 0 });
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 200);
      await assert.rejects(L.metered(meta, () => runOpenAI(job(), ctl.signal)), /cancelled/);
      await tick();
      assert.equal((last() as { outcome: string }).outcome, 'cancelled');
    } finally { rmSync(join(fakeDir, 'delay')); }
  });

  it('outside a job (no metered call around it) is not written anywhere', async () => {
    const n = rows().length;
    await runOpenAI(job(), new AbortController().signal);
    await tick();
    assert.equal(rows().length, n);
  });
});

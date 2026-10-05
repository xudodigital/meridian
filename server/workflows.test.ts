// The workflow engine and its schedules. The time rules (workflow-time.ts) are tested as pure functions, for several
// time zones and across a clock change. Everything else runs end to end: a real server with the fake Claude Code CLI
// and the fake Cloudflare, a "Weekly content" run through every state including the two human waits, a cancel that
// withdraws queued jobs, a budget hold that resumes, a failed step, the role checks, and schedules that start a run
// once across restarts (the scheduler's clock is fixed with MERIDIAN_SCHEDULER_NOW). Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { CF_ACCOUNT, CF_TOKEN } from './fixtures/fake-cloudflare.ts';
import { DFS_LOGIN, DFS_PASSWORD, dfs } from './fixtures/fake-dataforseo.ts';
import { startFakes } from './fixtures/fake-services.ts';
import { Client, events, member, owner, saveSites, startServer, until, type Json, type TestServer } from './testkit.ts';
import { LATE_MS, cadenceOf, dueNow, lastSlot, nextDue, nextSlot, slotText, wallToUtc, zoneOf, type Cadence } from './workflow-time.ts';

const utc = (iso: string) => Date.parse(iso);
const HOUR = 3_600_000, DAY = 24 * HOUR;
const MONDAY_6: Cadence = { every: 'week', weekday: 1, hour: 6 };

describe('when a schedule is due', () => {
  it('uses the time zone of the site\'s country, else the given one', () => {
    assert.equal(zoneOf('ID'), 'Asia/Jakarta');
    assert.equal(zoneOf('vn'), 'Asia/Ho_Chi_Minh');
    assert.equal(zoneOf('BR'), 'America/Sao_Paulo');
    assert.equal(zoneOf('', 'Europe/Berlin'), 'Europe/Berlin');
    assert.equal(zoneOf('ZZ', 'Europe/Berlin'), 'Europe/Berlin');
    assert.equal(zoneOf('ZZ', 'Not/AZone'), 'UTC');
  });

  it('puts "Monday 06:00" on each site\'s own clock', () => {
    const now = utc('2026-10-04T12:00:00Z'); // a Sunday
    assert.equal(nextSlot(now, MONDAY_6, 'Asia/Jakarta'), utc('2026-10-04T23:00:00Z'));          // UTC+7
    assert.equal(nextSlot(now, MONDAY_6, 'America/Mexico_City'), utc('2026-10-05T12:00:00Z'));   // UTC-6
    assert.equal(nextSlot(now, MONDAY_6, 'Asia/Kolkata'), utc('2026-10-05T00:30:00Z'));          // UTC+5:30
    assert.equal(nextSlot(now, MONDAY_6, 'UTC'), utc('2026-10-05T06:00:00Z'));
    /* The same instant is already Monday in Auckland (01:00): its slot comes five hours later, long before Jakarta's. */
    assert.equal(nextSlot(now, MONDAY_6, 'Pacific/Auckland'), utc('2026-10-04T17:00:00Z'));      // UTC+13 (summer time)
    assert.equal(lastSlot(now, MONDAY_6, 'Pacific/Auckland'), utc('2026-09-27T17:00:00Z'));
    assert.equal(lastSlot(utc('2026-10-04T17:00:00Z'), MONDAY_6, 'Pacific/Auckland'), utc('2026-10-04T17:00:00Z'), 'a slot is due at its own instant');
    assert.equal(lastSlot(now, MONDAY_6, 'Asia/Jakarta'), utc('2026-09-27T23:00:00Z'));
    assert.equal(slotText(utc('2026-10-04T23:00:00Z'), 'Asia/Jakarta'), 'Mon 5 Oct, 06:00');
  });

  it('keeps the wall-clock hour across a clock change', () => {
    /* New York leaves summer time on 1 November 2026: 06:00 is 10:00 UTC before and 11:00 UTC after. */
    assert.equal(wallToUtc(2026, 10, 26, 6, 'America/New_York'), utc('2026-10-26T10:00:00Z'));
    assert.equal(nextSlot(utc('2026-10-26T10:00:00Z'), MONDAY_6, 'America/New_York'), utc('2026-11-02T11:00:00Z'));
    /* Berlin starts summer time on 29 March 2026. */
    assert.equal(nextSlot(utc('2026-03-23T12:00:00Z'), MONDAY_6, 'Europe/Berlin'), utc('2026-03-30T04:00:00Z'));
  });

  it('starts a slot once, skips one more than 6 hours late, and counts from when the schedule was made', () => {
    const tz = 'Asia/Jakarta', slot = utc('2026-10-04T23:00:00Z');
    const made = { seen: slot - 3 * HOUR, fired: null };
    assert.equal(dueNow(slot - 1, MONDAY_6, tz, made), null, 'not yet');
    assert.deepEqual(dueNow(slot, MONDAY_6, tz, made), { slot, late: false });
    assert.deepEqual(dueNow(slot + LATE_MS, MONDAY_6, tz, made), { slot, late: false }, 'six hours late still starts');
    assert.deepEqual(dueNow(slot + LATE_MS + 1, MONDAY_6, tz, made), { slot, late: true });
    /* Once dealt with (also after a restart: the state is stored), the same slot never comes again. */
    assert.equal(dueNow(slot + HOUR, MONDAY_6, tz, { seen: slot, fired: slot }), null);
    /* A schedule made after this week's slot waits for next week's: the past slot is not made up for. */
    assert.equal(dueNow(slot + 2 * HOUR, MONDAY_6, tz, { seen: slot + HOUR, fired: null }), null);
    assert.equal(nextDue(slot + 2 * HOUR, MONDAY_6, tz, { seen: slot + HOUR, fired: null }), slot + 7 * DAY);
    /* A server that was off for three weeks deals with the newest slot only. */
    assert.deepEqual(dueNow(slot + 21 * DAY + HOUR, MONDAY_6, tz, { seen: slot, fired: slot }), { slot: slot + 21 * DAY, late: false });
  });

  it('runs every second week and on the first such weekday of a month', () => {
    const tz = 'Asia/Jakarta', slot = utc('2026-10-04T23:00:00Z');
    const two: Cadence = { every: '2weeks', weekday: 1, hour: 6 };
    assert.deepEqual(dueNow(slot, two, tz, { seen: slot - DAY, fired: null }), { slot, late: false }, 'the first one runs');
    const after1 = { seen: slot, fired: slot };
    assert.equal(dueNow(slot + 7 * DAY + HOUR, two, tz, after1), null, 'the week after is left out');
    assert.deepEqual(dueNow(slot + 14 * DAY, two, tz, after1), { slot: slot + 14 * DAY, late: false });
    assert.equal(nextDue(slot + HOUR, two, tz, after1), slot + 14 * DAY);
    assert.equal(nextDue(slot + HOUR, MONDAY_6, tz, after1), slot + 7 * DAY);

    const month: Cadence = { every: 'month', weekday: 1, hour: 6 };
    assert.equal(lastSlot(utc('2026-10-20T00:00:00Z'), month, tz), slot, 'Monday 5 October is the first Monday');
    assert.equal(nextSlot(slot, month, tz), utc('2026-11-01T23:00:00Z'), 'then Monday 2 November');
    assert.equal(dueNow(slot + 7 * DAY, month, tz, { seen: slot, fired: slot }), null);
  });

  it('reads a cadence only from well-formed values', () => {
    assert.deepEqual(cadenceOf({ every: 'week', weekday: 1, hour: 6 }), MONDAY_6);
    for (const bad of [{ every: 'day', weekday: 1, hour: 6 }, { every: 'week', weekday: 7, hour: 6 }, { every: 'week', weekday: 1, hour: 24 }, { every: 'week', weekday: '1', hour: 6 }, { every: 'week', weekday: 1.5, hour: 6 }, { cad: 'Every Monday 06:00' }])
      assert.equal(cadenceOf(bad as never), null, JSON.stringify(bad));
  });
});

/* ---------- End to end ---------- */

type Wait = { kind: string; text: string; detail?: string } | null;
type Run = Json & {
  id: number; siteId: string; domain: string; status: string; step: string; wait: Wait; by: string; n: number; scheduleId: string;
  requestId: number | null; articles: number[]; buildId: number | null; outcome: string; error: string; log: { at: number; text: string }[];
};
type Sched = { id: string; siteId: string; zone: string; nextDue: number | null; lastDue: number | null; note: string };
type Article = Json & { id: number; status: string; keyword: string; error: string; siteId: string };
type Request = Json & { id: number; status: string; error: string; siteId: string; requestedBy: string };
type Build = Json & { id: number; status: string; review: string; deploy: string; deployUrl: string; error: string };

const site = (id: string, cc = 'ID') => ({ id, domain: id + '.example', country: 'Indonesia', cc, lang: 'Indonesian', topic: 'Coffee', status: 'build' });
const workflows = async (c: Client) => (await c.get('/api/workflows')).data as { runs: Run[]; schedules: Sched[] };
const state = async (c: Client) => (await c.get('/api/state')).data as { requests: Request[]; articles: Article[]; builds: Build[]; workflows: { runs: Run[] } | null };
const runIs = (c: Client, id: number, test: (r: Run) => boolean, what: string, ms = 30_000) =>
  until(`workflow ${id} ${what}`, async () => { const r = (await workflows(c)).runs.find(x => x.id === id); return r && test(r) ? r : null; }, ms);
async function saveDoc(c: Client, doc: string, data: unknown): Promise<void> {
  const cur = (await c.get('/api/workspace')).data.docs as Record<string, { version: number }>;
  const r = await c.put('/api/workspace/docs/' + doc, { version: cur[doc]?.version ?? 0, data });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
const logOf = (r: Run) => r.log.map(l => l.text);

describe('Weekly content, end to end', () => {
  let fakes: Awaited<ReturnType<typeof startFakes>>;
  let s: TestServer, admin: Client, reviewer: Client, viewer: Client;
  const control = (name: string, value: string | null) => { const f = join(s.fakeDir, name); if (value === null) rmSync(f, { force: true }); else writeFileSync(f, value); };
  const calls = () => existsSync(join(s.fakeDir, 'calls.jsonl')) ? readFileSync(join(s.fakeDir, 'calls.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { kind: string }) : [];
  const start = (siteId: string, n?: number, c: Client = admin) => c.post('/api/workflows', { siteId, ...(n ? { n } : {}) });

  before(async () => {
    fakes = await startFakes();
    s = await startServer({ ...fakes.env, MERIDIAN_SCHEDULER_TICK_MS: '300' });
    control('base-cost', '0.12');
    admin = await owner(s, 'Owner');
    await saveSites(admin, ['s1', 's2', 's3', 's4', 's5'].map(id => site(id)) as never);
    await saveDoc(admin, 'settings', { native: false });
    reviewer = await member(s, admin, 'reviewer', 'rina@example.com', 'Rina', 's1');
    viewer = await member(s, admin, 'viewer', 'vic@example.com', 'Vic');
  });
  after(() => { s?.stop(); fakes?.stop(); });

  it('keeps to the roles: reviewers see nothing, viewers only look, writes need the header', async () => {
    assert.equal((await reviewer.get('/api/workflows')).status, 403);
    assert.equal((await reviewer.post('/api/workflows', { siteId: 's1' })).status, 403);
    assert.equal((await state(reviewer)).workflows, null);
    assert.deepEqual((await workflows(viewer)).runs, []);
    const v = await start('s1', 2, viewer);
    assert.equal(v.status, 403);
    assert.equal(v.data.error, 'View-only role. Ask an admin to make changes.');
    assert.equal((await viewer.post('/api/workflows/1/cancel')).status, 403);
    assert.equal((await admin.post('/api/workflows', { siteId: 's1' }, { 'x-meridian': '0' })).status, 403);
    assert.equal((await new Client(s.base).get('/api/workflows')).status, 401);
    assert.equal((await start('nope')).status, 404);
    assert.equal((await admin.post('/api/workflows', {})).status, 400);
    assert.equal((await admin.post('/api/workflows', { scheduleId: 'gone' })).status, 404);
    assert.equal((await admin.post('/api/workflows/999/cancel')).status, 404);
    assert.deepEqual((await workflows(admin)).runs, [], 'nothing was started');
  });

  it('runs research, queues the articles, waits for review, builds, waits for approval, deploys and ends', async () => {
    let id = 0;
    const seen = await events(admin, async () => {
      const r = await start('s1', 2);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      const run = r.data.run as Run;
      id = run.id;
      assert.deepEqual({ status: run.status, step: run.step, by: run.by, n: run.n, siteId: run.siteId, domain: run.domain }, { status: 'running', step: 'research', by: 'Owner', n: 2, siteId: 's1', domain: 's1.example' });
      assert.ok(run.requestId, 'the research request is queued at once');
    });
    assert.ok(seen.some(e => e.event === 'workflow' && (e.data.run as Run | undefined)?.id === id), 'the `workflow` event carries the run');
    const again = await start('s1');
    assert.equal(again.status, 409);
    assert.equal(again.data.error, 'A workflow is already running for this site. Wait for it to finish, or cancel it.');

    /* Human wait 1: the two articles the research proposed are written and wait for a person. */
    let run = await runIs(admin, id, r => r.step === 'review' && r.wait?.text === 'Waiting for your review of 2 articles', 'to wait for the review of 2 articles');
    assert.equal(run.wait?.kind, 'person');
    assert.equal(run.articles.length, 2);
    const st = await state(admin);
    assert.equal(st.requests.find(r => r.id === run.requestId)?.requestedBy, 'Orchestrator');
    assert.deepEqual(st.articles.filter(a => run.articles.includes(a.id)).map(a => a.keyword).sort(), ['cara membuat cold brew', 'rasio cold brew']);
    assert.equal(st.workflows?.runs[0]?.id, id, 'GET /api/state carries the runs');
    /* Every paid job of the run is in the spend ledger. */
    const ledger = () => s.db().prepare(`SELECT kind, COUNT(*) AS n FROM job_runs WHERE site_id = 's1' AND kind IN ('request', 'article') GROUP BY kind ORDER BY kind`).all().map(r => ({ ...r }));
    await until('the ledger rows', async () => ledger().length === 2 && ledger()[0]!.n === 2);
    assert.deepEqual(ledger(), [{ kind: 'article', n: 2 }, { kind: 'request', n: 1 }]);

    /* Approving one does not end the wait; rejecting the other ends that article's part too. */
    const [a1, a2] = run.articles as [number, number];
    assert.equal((await admin.post(`/api/articles/${a1}/approve`)).status, 200);
    run = await runIs(admin, id, r => r.wait?.text === 'Waiting for your review of 1 article', 'to wait for the last article');
    assert.equal(run.step, 'review');
    assert.equal((await admin.post(`/api/articles/${a2}/reject`, { note: 'Same page as the other one.' })).status, 200);

    /* Human wait 2: the website is built and waits for approval. */
    run = await runIs(admin, id, r => r.step === 'approve' && r.wait?.kind === 'person', 'to wait for the build approval');
    assert.equal(run.wait?.text, 'Waiting for your approval of website v1');
    assert.ok(run.buildId);
    const cf = await admin.put('/api/integrations/cf', { values: { token: CF_TOKEN, account: CF_ACCOUNT } });
    assert.equal(cf.status, 200, JSON.stringify(cf.data));
    const ok = await admin.post(`/api/builds/${run.buildId}/approve`);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));

    run = await runIs(admin, id, r => r.status !== 'running', 'to end');
    assert.equal(run.status, 'done', run.error);
    assert.equal(run.step, 'done');
    assert.equal(run.wait, null);
    assert.match(run.outcome, /^Website v1 is live at https:\/\/s1-example[a-z0-9-]*\.pages\.dev\.$/);
    const b = (await state(admin)).builds.find(x => x.id === run.buildId)!;
    assert.equal(b.deploy, 'live');
    /* Each step recorded what it did. */
    const log = logOf(run);
    assert.equal(log[0], 'Started by Owner');
    assert.equal(log[1], 'Asked the Keyword agent for keyword research: Coffee');
    assert.equal(log[2], `Queued 2 articles, chosen in the Keyword agent's order: "cara membuat cold brew", "rasio cold brew"`);
    assert.ok(log.includes('1 article is ready for review'), 'review opens with the first written article');
    assert.ok(log.includes('Review is over: 1 approved, 1 rejected'));
    assert.ok(log.includes('Asked the Site Builder for website v1'));
    assert.ok(log.includes('Website v1 was approved by Owner'));
    assert.equal(log.at(-1), run.outcome);
    const audit = ((await admin.get('/api/workspace')).data.audit as { actor: string; act: string }[]).map(e => `${e.actor}: ${e.act}`);
    assert.ok(audit.includes('Owner: Started "Weekly content" for s1.example: 2 articles'));
    assert.ok(audit.some(e => e.startsWith('Orchestrator: "Weekly content" for s1.example finished: Website v1 is live')));
  });

  it('ends without writing when every keyword already has an article', async () => {
    const before = calls().filter(c => c.kind === 'article').length;
    const r = await start('s1', 3);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const run = await runIs(admin, (r.data.run as Run).id, x => x.status !== 'running', 'to end');
    assert.equal(run.status, 'done');
    assert.equal(run.outcome, 'The research found no keyword without an article, so nothing was written.');
    assert.deepEqual(run.articles, []);
    assert.equal(calls().filter(c => c.kind === 'article').length, before);
  });

  it('cancels: queued jobs it created are withdrawn, a running one finishes', async () => {
    /* A slow job of another site holds the queue, so the run's research request waits behind it. */
    const keywordCalls = calls().filter(c => c.kind === 'keyword').length;
    control('delay', '1500');
    const other = await admin.post('/api/requests', { siteId: 's3', topic: 'slow one', goal: 'g', model: '' });
    assert.equal(other.status, 201, JSON.stringify(other.data));
    const r1 = await start('s2', 2);
    const id1 = (r1.data.run as Run).id;
    const waiting = await runIs(admin, id1, r => r.wait?.text === 'Keyword research is waiting for its turn', 'to wait for the queue');
    assert.equal(waiting.wait?.kind, 'agent');
    const c1 = await admin.post(`/api/workflows/${id1}/cancel`);
    assert.equal(c1.status, 200, JSON.stringify(c1.data));
    const done1 = c1.data.run as Run;
    assert.equal(done1.status, 'cancelled');
    assert.equal(done1.outcome, 'Cancelled by Owner. 1 queued job withdrawn.');
    const req = (await state(admin)).requests.find(x => x.id === done1.requestId)!;
    assert.deepEqual({ status: req.status, error: req.error }, { status: 'failed', error: 'Cancelled with its workflow before it started.' });
    assert.equal((await admin.post(`/api/workflows/${id1}/cancel`)).status, 409, 'only a running workflow can be cancelled');
    await until('the slow request', async () => (await state(admin)).requests.find(x => x.id === (other.data.request as Request).id && x.status === 'done'));
    assert.equal(calls().filter(c => c.kind === 'keyword').length, keywordCalls + 1, 'the withdrawn request never ran');

    /* Cancelled while the first article is being written: the second, still queued, is withdrawn; the first is finished. */
    const r2 = await start('s2', 2);
    const id2 = (r2.data.run as Run).id;
    const writing = await runIs(admin, id2, r => r.step === 'write' && r.wait?.text === 'The Content Writer is writing article 1 of 2', 'to write its first article');
    const c2 = await admin.post(`/api/workflows/${id2}/cancel`);
    assert.equal((c2.data.run as Run).outcome, 'Cancelled by Owner. 1 queued job withdrawn.');
    control('delay', null);
    const [first, second] = writing.articles as [number, number];
    await until('the first article to be written', async () => (await state(admin)).articles.find(a => a.id === first && a.status === 'review'));
    const st = await state(admin);
    assert.deepEqual({ status: st.articles.find(a => a.id === second)!.status, error: st.articles.find(a => a.id === second)!.error }, { status: 'failed', error: 'Cancelled with its workflow before it started.' });
    assert.equal((await workflows(admin)).runs.find(x => x.id === id2)!.status, 'cancelled', 'and the run stays cancelled');
    /* Withdrawn jobs raised no error alert: nothing ran. */
    const alerts = s.db().prepare(`SELECT title FROM alerts WHERE event = 'error'`).all() as { title: string }[];
    assert.deepEqual(alerts.map(a => a.title), []);
  });

  it('holds a run at the daily budget ("Waiting for budget") and resumes when the budget is raised', async () => {
    /* s3 spent $0.12 on the slow request; the run's research takes it to $0.24, past a budget of $0.20. */
    await saveDoc(admin, 'settings', { native: false, budget: 0.2 });
    const r = await start('s3', 2);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = (r.data.run as Run).id;
    const held = await runIs(admin, id, x => x.wait?.kind === 'budget', 'to be held');
    assert.deepEqual({ status: held.status, step: held.step, text: held.wait?.text, articles: held.articles }, { status: 'running', step: 'research', text: 'Waiting for budget', articles: [] });
    assert.match(held.wait?.detail ?? '', /^s3\.example has used its daily budget of \$0\.20\./);
    const articleCalls = calls().filter(c => c.kind === 'article').length;
    await new Promise(res => setTimeout(res, 700));   // two scheduler ticks: still held, nothing queued
    assert.equal((await workflows(admin)).runs.find(x => x.id === id)!.wait?.kind, 'budget');
    assert.equal(calls().filter(c => c.kind === 'article').length, articleCalls);

    await saveDoc(admin, 'settings', { native: false, budget: 25 });
    const resumed = await runIs(admin, id, x => x.step === 'review' && x.wait?.text === 'Waiting for your review of 2 articles', 'to resume and reach review');
    assert.equal(resumed.articles.length, 2);
    assert.equal(resumed.wait?.kind, 'person');
  });

  it('fails the run with the reason when a step fails', async () => {
    control('error', 'The model is overloaded.');
    try {
      const r = await start('s4', 1);
      const run = await runIs(admin, (r.data.run as Run).id, x => x.status !== 'running', 'to end');
      assert.equal(run.status, 'failed');
      assert.equal(run.step, 'research', 'it stays on the step that failed');
      assert.match(run.error, /^Keyword research failed: .*The model is overloaded/);
      assert.equal(logOf(run).at(-1), 'Stopped: ' + run.error);
    } finally { control('error', null); }
    /* The site is free again: a new run may start. */
    const next = await start('s4', 1);
    assert.equal(next.status, 201, JSON.stringify(next.data));
    const run = await runIs(admin, (next.data.run as Run).id, x => x.step === 'review', 'to reach review');
    assert.equal(run.articles.length, 1, 'N = 1 queues one article');
  });

  it('"Run now" on a schedule uses the saved schedule, and shows when it runs next', async () => {
    const r0 = (await workflows(admin)).runs.find(x => x.siteId === 's4' && x.status === 'running')!;
    assert.equal((await admin.post(`/api/workflows/${r0.id}/cancel`)).status, 200);
    await saveDoc(admin, 'schedules', [
      { id: 'c1', wf: 'Weekly content', site: 's4', on: true, every: 'week', weekday: 1, hour: 6, n: 1, topic: 'Tea' },
      { id: 'c2', wf: 'Weekly content', site: 's2', on: false, every: 'month', weekday: 5, hour: 16, n: 9 },
      { id: 'old', wf: 'Weekly content', site: 's1', cad: 'Every Monday 06:00', on: true },
      { id: 'c4', wf: 'Internal link audit', site: 's1', on: true, every: 'week', weekday: 1, hour: 6 },
    ]);
    const w = await until('the schedules', async () => { const x = await workflows(admin); return x.schedules.length === 2 ? x : null; });
    assert.deepEqual(w.schedules.map(x => x.id), ['c1', 'c2'], 'only "Weekly content" schedules with a cadence are run');
    const c1 = w.schedules[0]!;
    assert.equal(c1.zone, 'Asia/Jakarta');
    assert.ok(c1.nextDue && c1.nextDue > Date.now() && c1.nextDue <= Date.now() + 7 * DAY);
    assert.equal(new Date(c1.nextDue + 7 * HOUR).getUTCDay(), 1, 'a Monday in Jakarta');
    assert.equal(new Date(c1.nextDue + 7 * HOUR).getUTCHours(), 6, 'at 06:00 there');
    assert.equal(w.schedules[1]!.nextDue, null, 'a schedule that is off has no next run');

    const r = await admin.post('/api/workflows', { scheduleId: 'c1', siteId: 's1', n: 5, topic: 'ignored' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const run = r.data.run as Run;
    assert.deepEqual({ siteId: run.siteId, n: run.n, scheduleId: run.scheduleId, by: run.by }, { siteId: 's4', n: 1, scheduleId: 'c1', by: 'Owner' });
    assert.equal(run.log[1]?.text, 'Asked the Keyword agent for keyword research: Tea');
    assert.equal((await admin.post(`/api/workflows/${run.id}/cancel`)).status, 200);
  });

  it('picks by search volume when the research has volumes (DataForSEO connected)', async () => {
    const saved = await admin.put('/api/integrations/dfs', { values: { login: DFS_LOGIN, password: DFS_PASSWORD } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    /* The Keyword agent proposes "cara membuat cold brew" first; the second keyword is the one people search for. */
    dfs.volumes.set('rasio cold brew', { volume: 5400, competition: 'LOW' });
    const r = await start('s5', 1);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const run = await runIs(admin, (r.data.run as Run).id, x => x.articles.length === 1 || x.status !== 'running', 'to queue its article');
    assert.equal(run.status, 'running', run.error);
    assert.ok(logOf(run).includes('Queued 1 article, chosen by search volume: "rasio cold brew"'), logOf(run).join(' | '));
    assert.equal((await state(admin)).articles.find(a => a.id === run.articles[0])?.keyword, 'rasio cold brew');
    assert.equal((await admin.post(`/api/workflows/${run.id}/cancel`)).status, 200);
  });
});

describe('schedules across restarts', () => {
  /* Monday 5 October 2026, 06:00 in Jakarta. */
  const SLOT = utc('2026-10-04T23:00:00Z');
  let s: TestServer | null = null, cookie = '';
  const tmpOf = { dir: '' };
  async function boot(now: number): Promise<Client> {
    if (s) await s.halt('SIGTERM');
    s = await startServer({ MERIDIAN_SCHEDULER_NOW: String(now), MERIDIAN_SCHEDULER_TICK_MS: '150' }, tmpOf.dir || undefined);
    tmpOf.dir = s.tmp;
    if (!cookie) { const c = await owner(s, 'Owner'); cookie = c.cookie; return c; }
    const c = new Client(s.base); c.cookie = cookie; return c;
  }
  const settle = () => new Promise(res => setTimeout(res, 700));   // several scheduler ticks
  after(() => s?.stop());

  it('starts a due run once, never again after a restart, and says when it skipped one', async () => {
    /* Sunday evening in Jakarta: the schedule is made three hours before its time. */
    let c = await boot(SLOT - 3 * HOUR);
    await saveSites(c, [site('s1')] as never);
    await saveDoc(c, 'settings', { native: false });
    await saveDoc(c, 'schedules', [{ id: 'c1', wf: 'Weekly content', site: 's1', on: true, every: 'week', weekday: 1, hour: 6, n: 1 }]);
    let w = await until('the schedule', async () => { const x = await workflows(c); return x.schedules[0]?.nextDue ? x : null; });
    assert.deepEqual({ nextDue: w.schedules[0]!.nextDue, zone: w.schedules[0]!.zone, lastDue: w.schedules[0]!.lastDue, note: w.schedules[0]!.note }, { nextDue: SLOT, zone: 'Asia/Jakarta', lastDue: null, note: '' });
    await settle();
    assert.deepEqual((await workflows(c)).runs, [], 'nothing starts before its time');

    /* The server comes back an hour after the slot: the run starts, by its schedule. */
    c = await boot(SLOT + HOUR);
    const run = await until('the scheduled run', async () => (await workflows(c)).runs[0]);
    assert.deepEqual({ by: run.by, scheduleId: run.scheduleId, n: run.n, siteId: run.siteId }, { by: 'Schedule', scheduleId: 'c1', n: 1, siteId: 's1' });
    assert.equal(run.log[0]?.text, 'Started by its schedule');
    w = await workflows(c);
    assert.deepEqual({ nextDue: w.schedules[0]!.nextDue, lastDue: w.schedules[0]!.lastDue }, { nextDue: SLOT + 7 * DAY, lastDue: SLOT });
    await settle();
    assert.equal((await workflows(c)).runs.length, 1, 'later ticks do not start it again');

    /* A restart at the same time: the slot was written down before the run started, so it is not started twice. */
    c = await boot(SLOT + HOUR + 60_000);
    await settle();
    assert.equal((await workflows(c)).runs.length, 1, 'a restart never double-fires');
    await runIs(c, run.id, r => r.step === 'review' && r.wait?.kind === 'person', 'to go on after the restart and wait for review');

    /* A week later the server was off at the slot and comes back seven hours late: skipped, and the schedule says so. */
    c = await boot(SLOT + 7 * DAY + 7 * HOUR);
    w = await until('the skipped slot', async () => { const x = await workflows(c); return x.schedules[0]?.note ? x : null; });
    assert.equal(w.schedules[0]!.note, 'Skipped the run of Mon 12 Oct, 06:00: Meridian was not running at that time, and a run more than 6 hours late is not started.');
    assert.equal(w.schedules[0]!.lastDue, SLOT + 7 * DAY);
    assert.equal(w.schedules[0]!.nextDue, SLOT + 14 * DAY);
    assert.equal(w.runs.length, 1);

    /* The week after, on time, but the first run still waits for a person: never a second run for the same site. */
    c = await boot(SLOT + 14 * DAY + HOUR);
    w = await until('the busy slot', async () => { const x = await workflows(c); return x.schedules[0]?.lastDue === SLOT + 14 * DAY ? x : null; });
    assert.equal(w.schedules[0]!.note, 'Skipped the run of Mon 19 Oct, 06:00: the workflow before it was still running for this site.');
    assert.equal(w.runs.length, 1);

    /* Turned off and on again a week later, after the slot: it counts from now, the past slot is not made up for. */
    c = await boot(SLOT + 21 * DAY + HOUR);
    await until('the on-time slot to be dealt with', async () => (await workflows(c)).schedules[0]?.lastDue === SLOT + 21 * DAY);
    await saveDoc(c, 'schedules', [{ id: 'c1', wf: 'Weekly content', site: 's1', on: true, every: 'week', weekday: 3, hour: 9, n: 1 }]);
    w = await until('the changed schedule', async () => { const x = await workflows(c); return x.schedules[0]?.lastDue === null ? x : null; });
    assert.equal(w.schedules[0]!.note, '');
    assert.equal(w.schedules[0]!.nextDue, utc('2026-10-28T02:00:00Z'), 'Wednesday 28 October, 09:00 in Jakarta');
  });
});

/* Notifications derived from the server's state: stable keys, no duplicates, read state that survives a reload, the 14-day rule. */
import { describe, expect, it } from 'vitest';
import { serverArticle, T_ART } from './articleFixtures';
import { buildWire } from './buildFixtures';
import { NOTIF_FRESH_MS, NOTIF_MAX, READ_KEYS_MAX, alertNotifs, articleNotifs, buildNotifs, deriveLiveNotifs, liveNotifsTo, markReadTo, requestNotifs } from './liveNotifs';
import { makeEmptyState, makeState } from './testing';
import type { AccessWire, AppState, ArticleEvent, BellAlertWire, ServerArticle, ServerRequest } from './types';

const DAY = 864e5;
const NOW = T_ART + 3_600_000;
const ev = (at: number, action: ArticleEvent['action'], by = 'Content Writer', note = ''): ArticleEvent => ({ at, by, action, note });
const req = (id: number, over: Partial<ServerRequest> = {}): ServerRequest => ({
  id, siteId: 'a', domain: 'kopi.example', topic: 'topic ' + id, goal: 'x', status: 'done', engine: 'openai-api', step: '', summary: '', notes: '', error: '',
  tokens: 0, costUsd: 0, createdAt: T_ART, startedAt: T_ART, finishedAt: T_ART + id * 1000, keywords: [], ...over,
});
/** The server's state put into a state object, then the notifications derived from it. */
function apply(s: AppState, reqs: ServerRequest[], arts: ServerArticle[] = [], now = NOW): AppState {
  s.live.on = true;
  reqs.forEach(r => { s.live.reqs[r.id] = r; });
  arts.forEach(a => { s.live.arts[a.id] = a; });
  liveNotifsTo(s, now);
  return s;
}

describe('deriving notifications from the server', () => {
  it('gives each finished or failed request one notification with a key of kind, id and finish time', () => {
    expect(requestNotifs(req(1)).map(n => [n.key, n.title, n.body, n.view])).toEqual([[`research-done:1:${T_ART + 1000}`, 'Keyword research is ready: topic 1', 'Open Research and SEO, Keywords tab.', 'research']]);
    expect(requestNotifs(req(2, { status: 'failed', error: 'Timed out.' })).map(n => [n.key, n.k, n.title, n.body, n.ev])).toEqual([[`research-failed:2:${T_ART + 2000}`, 'bad', 'Keyword research failed: topic 2', 'Timed out.', 'error']]);
    expect([...requestNotifs(req(4, { status: 'work', finishedAt: null })), ...requestNotifs(req(5, { status: 'queued', finishedAt: null }))]).toEqual([]);
  });

  it('reads an article\'s history: first version, failure and revision, each keyed by its event time', () => {
    const a = serverArticle(5, { revision: 1, history: [ev(T_ART, 'requested', 'Dana'), ev(T_ART + 10, 'failed', 'Content Writer', 'No JSON.'), ev(T_ART + 20, 'retried', 'Dana'), ev(T_ART + 30, 'written'), ev(T_ART + 40, 'language-review', 'Linh'), ev(T_ART + 50, 'revision', 'Linh', 'Shorter.'), ev(T_ART + 60, 'written')] });
    expect(articleNotifs(a).map(n => [n.key, n.title, n.art, n.handled])).toEqual([
      [`article-failed:5:${T_ART + 10}`, 'Article failed: cà phê phin', 'a5', true],
      [`article-written:5:${T_ART + 30}`, 'Article ready for review: How to brew phin coffee', 'a5', true],
      [`article-revised:5:${T_ART + 60}`, 'A revised article is back in review', 'a5', false],
    ]);
    /* A language review alone does not answer a written version. */
    expect(articleNotifs(serverArticle(6, { history: [ev(T_ART, 'requested'), ev(T_ART + 30, 'written'), ev(T_ART + 40, 'language-review', 'Linh')] }))[0]?.handled).toBe(false);
    /* Nor do the photos the Site Builder chooses right after every version: the article still waits for a person. */
    const photos = ev(T_ART + 50, 'photos', 'Site Builder', 'Site Builder chose 3 photos');
    expect(articleNotifs(serverArticle(6, { history: [ev(T_ART, 'requested'), ev(T_ART + 30, 'written'), photos] })).map(n => [n.key, n.handled])).toEqual([[`article-written:6:${T_ART + 30}`, false]]);
    expect(articleNotifs(serverArticle(6, { revision: 1, history: [ev(T_ART, 'requested'), ev(T_ART + 30, 'written'), ev(T_ART + 40, 'revision', 'Linh', 'x'), ev(T_ART + 45, 'written'), photos] })).map(n => n.handled)).toEqual([true, false]);
    for (const decided of ['approved', 'rejected'] as const)
      expect(articleNotifs(serverArticle(6, { history: [ev(T_ART, 'requested'), ev(T_ART + 30, 'written'), photos, ev(T_ART + 60, decided, 'Dana')] }))[0]?.handled).toBe(true);
    expect(articleNotifs(serverArticle(7, { status: 'queued', content: null, history: [ev(T_ART, 'requested')] }))).toEqual([]);
  });

  it('orders everything newest first', () => {
    const list = deriveLiveNotifs([req(1), req(3)], [serverArticle(5, { history: [ev(T_ART, 'requested'), ev(T_ART + 2000, 'written')] })]);
    expect(list.map(n => n.key.split(':')[0] + ':' + n.key.split(':')[1])).toEqual(['research-done:3', 'article-written:5', 'research-done:1']);
  });
});

describe('the bell', () => {
  it('gets the same notifications, with the same ids, however often the state is applied', () => {
    const s = apply(makeEmptyState(), [req(1), req(2, { status: 'failed', error: 'x' })], [serverArticle(5)]);
    const first = s.notifs.map(n => [n.id, n.key]);
    expect(first).toHaveLength(3);
    liveNotifsTo(s, NOW); liveNotifsTo(s, NOW);
    apply(s, [req(1)]);
    expect(s.notifs.map(n => [n.id, n.key])).toEqual(first);
    expect(new Set(s.notifs.map(n => n.key)).size).toBe(3);
  });

  it('replaces a request\'s notification when it is run again and finishes later', () => {
    const s = apply(makeEmptyState(), [req(1)]);
    apply(s, [req(1, { status: 'queued', finishedAt: null })]);
    expect(s.notifs).toEqual([]);
    apply(s, [req(1, { finishedAt: T_ART + 9000 })]);
    expect(s.notifs.map(n => n.key)).toEqual([`research-done:1:${T_ART + 9000}`]);
  });

  it('keeps notifications made in this browser and the seeded ones, ordered by time, at most 40', () => {
    const sample = makeState();
    const seeded = sample.notifs.map(n => n.title);
    apply(sample, [req(1, { finishedAt: Date.now() + 1000 })], [], Date.now());
    expect(sample.notifs.map(n => n.title)).toEqual(['Keyword research is ready: topic 1', ...seeded]);

    const s = apply(makeEmptyState(), Array.from({ length: 45 }, (_, i) => req(i + 1)));
    expect(s.notifs).toHaveLength(NOTIF_MAX);
    expect(s.notifs[0]?.title).toBe('Keyword research is ready: topic 45');
    expect(s.notifs.at(-1)?.title).toBe('Keyword research is ready: topic 6');
  });

  it('shows events older than 14 days as read', () => {
    const s = apply(makeEmptyState(), [req(1), req(2)], [], T_ART + 2000 + NOTIF_FRESH_MS + 1);
    expect(s.notifs.map(n => [n.title, n.read])).toEqual([['Keyword research is ready: topic 2', true], ['Keyword research is ready: topic 1', true]]);
    const fresh = apply(makeEmptyState(), [req(1)], [], T_ART + 13 * DAY);
    expect(fresh.notifs[0]?.read).toBe(false);
  });

  it('leaves out what the In-app channel of its alert is switched off for', () => {
    const s = makeEmptyState();
    s.np.review[0] = false;
    apply(s, [req(1)], [serverArticle(5)]);
    expect(s.notifs.map(n => n.title)).toEqual(['Keyword research is ready: topic 1']);
  });

  it('remembers what was read across a reload, through the read keys the server keeps', () => {
    const s = apply(makeEmptyState(), [req(1), req(2)], [serverArticle(5)]);
    const key = s.notifs.find(n => n.title.startsWith('Article ready'))!.key!;
    markReadTo(s, [key]);
    markReadTo(s, [key]);
    expect(s.notifRead).toEqual([key]);

    /* Reload: the read keys come back from the server (GET /api/workspace notifRead), then the same server state. */
    const back = makeEmptyState();
    back.notifRead = JSON.parse(JSON.stringify(s.notifRead)) as string[];
    apply(back, [req(1), req(2)], [serverArticle(5)]);
    expect(back.notifs.map(n => [n.key, n.read])).toEqual(s.notifs.map(n => [n.key, n.key === key]));
  });

  it('keeps only the newest read keys', () => {
    const s = makeEmptyState();
    markReadTo(s, Array.from({ length: READ_KEYS_MAX + 5 }, (_, i) => 'k' + i));
    expect(s.notifRead).toHaveLength(READ_KEYS_MAX);
    expect(s.notifRead[0]).toBe('k5');
  });
});

describe('website build notifications', () => {
  it('say when a build waits for approval, failed, or its deploy failed, with the server\'s words', () => {
    const ready = buildWire(3, 's1', 'kopi.example', 1);
    expect(buildNotifs(ready).map(n => [n.key, n.title, n.view, n.ev, n.handled])).toEqual([
      [`build-ready:3:${ready.finishedAt}`, 'Website v1 of kopi.example is ready for approval', 'deploy', 'approval', false],
    ]);
    expect(buildNotifs({ ...ready, review: 'approved', decidedAt: ready.finishedAt! + 5000 })[0]?.handled).toBe(true);
    /* Approved by itself when it finished (Settings: no approval needed): nobody was asked. */
    expect(buildNotifs({ ...ready, review: 'approved', decidedAt: ready.finishedAt })).toEqual([]);
    expect(buildNotifs(buildWire(4, 's1', 'kopi.example', 2, { status: 'queued', review: '', finishedAt: null }))).toEqual([]);
    const failed = buildWire(5, 's1', 'kopi.example', 3, { status: 'failed', review: '', error: 'The check found 1 problem.' });
    expect(buildNotifs(failed).map(n => [n.title, n.body, n.k, n.ev])).toEqual([['Website v3 of kopi.example failed to build', 'The check found 1 problem.', 'bad', 'error']]);
    const steps = [{ at: T_ART + 10, text: 'Started' }, { at: T_ART + 20, text: 'Stopped: Token refused.' }];
    const dep = buildWire(6, 's1', 'kopi.example', 4, { review: 'approved', decidedAt: 1, deploy: 'failed', deployError: 'Token refused.', steps });
    expect(buildNotifs(dep).map(n => [n.key, n.title, n.body])).toEqual([
      ['build-ready:6:' + dep.finishedAt, 'Website v4 of kopi.example is ready for approval', 'Preview it in Build and deploy, then approve or reject it.'],
      [`deploy-failed:6:${T_ART + 20}`, 'Deploy of kopi.example v4 failed', 'Token refused.'],
    ]);
    /* A newer build of the site answers a failed one. */
    expect(deriveLiveNotifs([], [], [failed, buildWire(7, 's1', 'kopi.example', 5)]).find(n => n.key.startsWith('build-failed'))?.handled).toBe(true);
  });

  it('come into the bell with the rest, and the In-app switch of their alert turns them off', () => {
    const s = makeEmptyState();
    s.live.builds[3] = buildWire(3, 's1', 'kopi.example', 1, { finishedAt: NOW - 1000 });
    apply(s, [req(1)]);
    expect(s.notifs.map(n => [n.title, n.read])).toEqual([['Website v1 of kopi.example is ready for approval', false], ['Keyword research is ready: topic 1', false]]);
    s.np.approval[0] = false;
    liveNotifsTo(s, NOW);
    expect(s.notifs.map(n => n.title)).toEqual(['Keyword research is ready: topic 1']);
  });
});

describe('the server\'s own alerts', () => {
  const alert = (id: number, event: string, key: string, title: string, over: Partial<BellAlertWire> = {}): BellAlertWire =>
    ({ id, key, event, site: 's1', title, body: 'Body of ' + title, link: event === 'blocked' ? '/deploy' : event === 'budget' ? '/analytics' : '/reports', at: NOW - id * 1000, ...over });
  const access = (result: AccessWire['result'], at: number): AccessWire => ({ siteId: 's1', domain: 'kopi.example', cc: 'ID', at, result, dns: '', http: '', summary: '', probes: [], by: '' });
  const blocked = alert(1, 'blocked', 'access:s1:7', 'kopi.example is blocked in Indonesia');
  const down = alert(2, 'blocked', 'access:s1:5', 'kopi.example is down');
  const near = alert(3, 'budget', 'budget:s1:Sat Oct 03 2026', 'kopi.example passed 80% of its daily budget');
  const stopped = alert(4, 'budget', 'budget-stop:s1:Sat Oct 03 2026', 'kopi.example used its daily budget: its agent jobs are stopped');
  const report = alert(5, 'report', 'report:1759500000000', 'The weekly report was sent', { site: null });

  it('become notifications in the server\'s words, keyed by the server\'s key, each leading to its screen', () => {
    expect([blocked, down, near, stopped, report].flatMap(a => alertNotifs(a)).map(n => [n.key, n.k, n.icon, n.title, n.to ?? n.view, n.ev])).toEqual([
      ['alert:access:s1:7', 'bad', 'block', 'kopi.example is blocked in Indonesia', 'deploy', 'blocked'],
      ['alert:access:s1:5', 'bad', 'cloud_off', 'kopi.example is down', 'deploy', 'blocked'],
      ['alert:budget:s1:Sat Oct 03 2026', 'warn', 'payments', 'kopi.example passed 80% of its daily budget', 'analytics', 'budget'],
      ['alert:budget-stop:s1:Sat Oct 03 2026', 'bad', 'payments', 'kopi.example used its daily budget: its agent jobs are stopped', 'analytics', 'budget'],
      ['alert:report:1759500000000', 'ok', 'mail', 'The weekly report was sent', 'reports', 'report'],
    ]);
    expect(alertNotifs(blocked)[0]).toMatchObject({ t: blocked.at, body: 'Body of kopi.example is blocked in Indonesia', handled: false });
    /* Finished and failed jobs reach the bell from the jobs themselves: the server's alert for them is not shown twice. */
    expect([alert(6, 'error', 'error:a1:1', 'The Content Writer failed'), alert(7, 'review', 'review:a1:1', 'Article ready'), alert(8, 'approval', 'x', 'y')].flatMap(a => alertNotifs(a))).toEqual([]);
    /* A link that is not a screen of the app falls back to the screen of that kind of alert. */
    expect(alertNotifs({ ...blocked, link: '/nowhere' })[0]?.view).toBe('deploy');
    expect(alertNotifs({ ...report, link: '' })[0]).toMatchObject({ view: 'analytics', to: 'reports' });
    /* "/reports" was a screen and is now a tab of Analytics: the alert leads to that tab. */
    expect(alertNotifs(report)[0]).toMatchObject({ view: 'analytics', to: 'reports' });
    expect(alertNotifs(blocked)[0]?.to).toBeUndefined();
  });

  it('count a blocked domain as handled once a later check found it open again', () => {
    expect(alertNotifs(blocked, { s1: access('blocked', blocked.at + 5000) })[0]?.handled).toBe(false);
    expect(alertNotifs(blocked, { s1: access('ok', blocked.at - 5000) })[0]?.handled).toBe(false);
    expect(alertNotifs(blocked, { s1: access('ok', blocked.at + 5000) })[0]?.handled).toBe(true);
    expect(alertNotifs(blocked, { other: access('ok', blocked.at + 5000) })[0]?.handled).toBe(false);
  });

  it('come into the bell with the rest, in time order, without duplicates, read by key', () => {
    const s = makeEmptyState();
    s.live.alerts = [blocked, near, report];
    apply(s, [req(1, { finishedAt: NOW - 2500 })]);
    expect(s.notifs.map(n => [n.title, n.read, n.to ?? n.view])).toEqual([
      ['kopi.example is blocked in Indonesia', false, 'deploy'],
      ['Keyword research is ready: topic 1', false, 'research'],
      ['kopi.example passed 80% of its daily budget', false, 'analytics'],
      ['The weekly report was sent', false, 'reports'],
    ]);
    const ids = s.notifs.map(n => n.id);
    liveNotifsTo(s, NOW); liveNotifsTo(s, NOW);
    expect(s.notifs.map(n => n.id)).toEqual(ids);
    markReadTo(s, ['alert:access:s1:7']);
    s.live.access = { s1: access('ok', NOW) };
    liveNotifsTo(s, NOW);
    expect(s.notifs.map(n => n.read)).toEqual([true, false, false, false]);
    /* Old alerts are shown as read, like every other event. */
    liveNotifsTo(s, NOW + NOTIF_FRESH_MS + 1);
    expect(s.notifs.every(n => n.read)).toBe(true);
  });

  it('follow the In-app box of their alert in Settings', () => {
    const s = makeEmptyState();
    s.live.alerts = [blocked, near, report];
    s.np.blocked[0] = false; s.np.report[0] = false;
    liveNotifsTo(s, NOW);
    expect(s.notifs.map(n => n.title)).toEqual(['kopi.example passed 80% of its daily budget']);
    s.np.blocked[0] = true; s.np.budget[0] = false;
    liveNotifsTo(s, NOW);
    expect(s.notifs.map(n => n.title)).toEqual(['kopi.example is blocked in Indonesia']);
    /* A store without alerts (an older server, a native reviewer) works as before. */
    delete s.live.alerts;
    liveNotifsTo(s, NOW);
    expect(s.notifs).toEqual([]);
  });
});

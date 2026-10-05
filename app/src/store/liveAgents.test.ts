/* The agents real jobs drive (liveAgents.ts): which job each one shows, the progress estimate, the done moment, the
   hand-offs between agents and Site Builder runs in Run history. */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { agentLook, roomOf } from '@/views/workspace/helpers';
import { serverArticle, T_ART } from './articleFixtures';
import { build, photo, photoJob, req, withPhotos } from './liveAgentFixtures';
import { liveApply } from './liveApply';
import { DONE_MS, estimate, liveAgentsTo, MEET, MIN_WORK_MS, PROGRESS_CAP } from './liveAgents';
import { simTick, type TickEnv } from './sim';
import { makeEmptyState } from './testing';
import type { AccessWire, AppState, BuildWire, ServerArticle, ServerRequest } from './types';
import { docOf } from './workspace';

const T = T_ART;
type State = AppState & { checking?: string[] };

function withSite(): State {
  const s: State = makeEmptyState();
  s.sites.push({ id: 'a', domain: 'kopi.example', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
  s.live.on = true;
  return s;
}
interface Wire { reqs?: ServerRequest[]; arts?: ServerArticle[]; builds?: BuildWire[] }
/** Puts the server's state in the store and applies it, as live.ts does for the first answer and each event. */
function put(s: State, w: Wire, now: number): void {
  w.reqs?.forEach(r => { s.live.reqs[r.id] = r; });
  w.arts?.forEach(a => { s.live.arts[a.id] = a; });
  w.builds?.forEach(b => { s.live.builds[b.id] = b; });
  liveApply(s, now);
}
/** The first state from the server: applied before the page counts as ready. */
function load(w: Wire, now: number): State { const s = withSite(); put(s, w, now); s.live.ready = true; return s; }
const agent = (s: AppState, id: string) => s.agents.find(a => a.id === id)!;
const env = (now: number): TickEnv => ({ now, lastActive: now, rand: () => 0.5 });
const check = (at: number, over: Partial<AccessWire> = {}): AccessWire => ({
  siteId: 'a', domain: 'kopi.example', cc: 'VN', at, result: 'ok', dns: 'ok', http: '200', summary: 'Opens normally in Vietnam.', probes: [], by: 'Schedule', ...over,
});

describe('the agents real jobs drive', () => {
  it('shows research, writing, photos, builds, deploys and access checks on their agents, with the server\'s step', () => {
    const working = serverArticle(5, { status: 'work', step: 'Reading the skills', content: null, finishedAt: null });
    const s = load({ reqs: [req(1)], arts: [working, withPhotos(serverArticle(6, { keyword: 'phin filter' }), photoJob())] }, T + 100_000);
    expect(agent(s, 'kw')).toMatchObject({ live: true, status: 'work', site: 'a', task: 'Researching keywords: phin coffee', run: { kind: 'research', at: T, step: 'Reading the keyword-research skill' } });
    expect(agent(s, 'wr')).toMatchObject({ live: true, liveReq: 5, task: 'Writing an article: cà phê phin', run: { kind: 'article', at: T + 5_000, step: 'Reading the skills' } });
    /* A photo job waiting for its turn shows on the Site Builder without moving. */
    expect(agent(s, 'bld')).toMatchObject({ live: true, status: 'work', task: 'Choosing photos: phin filter', progress: 4, run: { kind: 'photos', at: null, step: 'Waiting for its turn' } });
    expect(agent(s, 'dep')).toMatchObject({ status: 'idle', task: 'Waiting for a task' });
    expect(agent(s, 'dep').live).toBeFalsy();

    put(s, { arts: [withPhotos(serverArticle(6, { keyword: 'phin filter' }), photoJob({ status: 'work', startedAt: T + 96_000, step: 'Searching Wikimedia Commons' }))] }, T + 100_000);
    expect(agent(s, 'bld').run).toMatchObject({ at: T + 96_000, step: 'Searching Wikimedia Commons' });
    /* A website build that runs comes first. */
    put(s, { builds: [build(3)] }, T + 101_000);
    expect(agent(s, 'bld')).toMatchObject({ task: 'Building kopi.example v2', liveReq: 3, progress: 4, run: { kind: 'build', at: T, step: 'Writing pages, sitemap and robots.txt' } });

    /* An access check from the site's country, then a deploy, which comes first. */
    s.checking = ['gone', 'a'];
    liveApply(s, T + 102_000);
    expect(agent(s, 'dep')).toMatchObject({ live: true, status: 'work', site: 'a', task: 'Checking access: kopi.example from Vietnam', run: { kind: 'access', at: T + 102_000 } });
    liveApply(s, T + 110_000);
    expect(agent(s, 'dep').run?.at).toBe(T + 102_000);
    put(s, { builds: [build(2, { version: 1, status: 'ready', review: 'approved', deploy: 'work' })] }, T + 111_000);
    expect(agent(s, 'dep')).toMatchObject({ task: 'Deploying kopi.example v1', liveReq: 2, run: { kind: 'deploy', at: T + 111_000 } });
  });

  it('shows a deploy\'s current step as the server sends it, also when the page opens during the deploy', () => {
    /* While a deploy runs, the server sends the deploy's own step as the build's step (server/builds.ts viewBuild). */
    const s = load({ builds: [build(2, { status: 'ready', review: 'approved', deploy: 'work', step: 'Uploading 12 files' })] }, T);
    expect(agent(s, 'dep').run?.step).toBe('Uploading 12 files');
    expect(agentLook(agent(s, 'dep'))).toMatchObject({ task: 'Deploying kopi.example v2', step: 'Uploading 12 files' });
    put(s, { builds: [build(2, { status: 'ready', review: 'approved', deploy: 'work', step: 'Waiting for Cloudflare to finish' })] }, T + 5_000);
    expect(agent(s, 'dep').run?.step).toBe('Waiting for Cloudflare to finish');
  });

  it('does not show a photo job the server will not run: its article was rejected, is being revised or failed', () => {
    const s = load({ arts: [
      withPhotos(serverArticle(5, { status: 'rejected' }), photoJob()),
      withPhotos(serverArticle(6, { status: 'queued', pendingNote: 'Shorter.', startedAt: null, finishedAt: null }), photoJob({ queuedAt: T + 96_000 })),
      withPhotos(serverArticle(7, { status: 'failed', pendingNote: 'Shorter.', error: 'The CLI stopped.' }), photoJob({ queuedAt: T + 97_000 })),
    ] }, T + 100_000);
    const bld = agent(s, 'bld');
    expect(bld).toMatchObject({ status: 'idle', task: 'Waiting for a task' });
    expect(bld.live).toBeFalsy();
    simTick(s, env(T + 3_700_000));
    expect(bld.status).toBe('idle');
    /* So a website build that ends shows its done moment, then the agent rests. */
    put(s, { builds: [build(3)] }, T + 3_700_000);
    put(s, { builds: [build(3, { status: 'ready', review: 'waiting', finishedAt: T + 3_720_000 })] }, T + 3_720_000);
    expect(bld).toMatchObject({ status: 'idle', progress: 100, ended: { ok: true, note: 'Ready for your approval' } });
    simTick(s, env(T + 3_720_000 + DONE_MS));
    expect(bld).toMatchObject({ status: 'idle', progress: 0, task: 'Waiting for a task', ended: null });
    expect(roomOf(bld)).toBe('break');
    /* Back in review with the revision written, its photo job waits for its turn again. */
    put(s, { arts: [withPhotos(serverArticle(6), photoJob({ queuedAt: T + 96_000 }))] }, T + 3_800_000);
    expect(bld).toMatchObject({ live: true, status: 'work', task: 'Choosing photos: cà phê phin', run: { kind: 'photos', at: null, step: 'Waiting for its turn' } });
  });

  it('shows Failed when an access check could not be done, and nothing when the server refused to start it', () => {
    const s = load({}, T);
    s.live.access.a = check(T - 7 * 3_600_000);
    s.checking = ['a'];
    simTick(s, env(T + 1_000));
    const dep = agent(s, 'dep');
    expect(dep).toMatchObject({ live: true, status: 'work', task: 'Checking access: kopi.example from Vietnam' });
    s.checking = [];
    s.live.access.a = check(T + 20_000, { result: 'error', dns: '—', http: '—', summary: 'No probe in Vietnam gave a result. Try again later.' });
    simTick(s, env(T + 20_000));
    expect(dep).toMatchObject({ status: 'idle', progress: 0, ended: { ok: false, note: 'No probe in Vietnam gave a result. Try again later.' } });
    expect(agentLook(dep)).toMatchObject({ st: 'failed', label: 'Failed', bar: 0 });
    simTick(s, env(T + 20_000 + DONE_MS));
    expect(dep.ended).toBeNull();

    /* The sites slice marks a check running before the server answers; a refusal takes it back, and no check is stored. */
    s.checking = ['a'];
    simTick(s, env(T + 60_000));
    expect(dep.live).toBe(true);
    s.checking = [];
    simTick(s, env(T + 60_100));
    expect(dep).toMatchObject({ live: false, status: 'idle', progress: 0, task: 'Waiting for a task' });
    expect(dep.ended).toBeFalsy();
  });

  it('estimates progress from the time a job has run, and stops short until the server says it is done', () => {
    expect(estimate(0, 'article')).toBe(4);
    expect(estimate(150_000, 'article')).toBeCloseTo(72.4, 1);
    expect(estimate(20_000, 'build')).toBe(estimate(150_000, 'article'));
    expect(estimate(10 * 60_000, 'article')).toBeGreaterThan(90);
    expect(estimate(3_600_000, 'article')).toBe(PROGRESS_CAP);
    expect(estimate(-5_000, 'deploy')).toBe(4);

    const s = load({ arts: [serverArticle(5, { status: 'work', content: null, finishedAt: null }), withPhotos(serverArticle(6), photoJob())] }, T + 5_000);
    const wr = agent(s, 'wr'), bld = agent(s, 'bld');
    simTick(s, env(T + 80_000));
    expect(wr.progress).toBe(estimate(75_000, 'article'));
    /* Never backwards, never past the cap; a job waiting for its turn does not move. */
    simTick(s, env(T + 6_000));
    expect(wr.progress).toBe(estimate(75_000, 'article'));
    simTick(s, env(T + 3_600_000));
    expect(wr.progress).toBe(PROGRESS_CAP);
    expect(bld.progress).toBe(4);
  });

  it('shows Done for a moment when a job ends, then the agent rests and walks to the break room', () => {
    const s = load({ arts: [withPhotos(serverArticle(5), photoJob({ status: 'work', startedAt: T + 96_000 }))] }, T + 100_000);
    const bld = agent(s, 'bld');
    expect(roomOf(bld)).toBe('tech');
    put(s, { arts: [withPhotos(serverArticle(5), photoJob({ status: 'done', startedAt: T + 96_000, finishedAt: T + 150_000 }), [photo('p1'), photo('p2')])] }, T + 150_000);
    expect(bld).toMatchObject({ live: false, status: 'idle', progress: 100, task: 'Choosing photos: cà phê phin', run: null, ended: { ok: true, note: 'Chose 2 photos', until: T + 150_000 + DONE_MS } });
    /* It stays at its desk for the moment, then rests. */
    expect(roomOf(bld)).toBe('tech');
    simTick(s, env(T + 150_000 + DONE_MS - 1));
    expect(bld.ended).not.toBeNull();
    simTick(s, env(T + 150_000 + DONE_MS));
    expect(bld).toMatchObject({ status: 'idle', progress: 0, task: 'Waiting for a task', ended: null });
    expect(roomOf(bld)).toBe('break');

    /* A failed job says why; a new job during the moment takes the agent at once. */
    put(s, { builds: [build(3)] }, T + 200_000);
    put(s, { builds: [build(3, { status: 'failed', error: 'A link points to a missing page.', finishedAt: T + 210_000 })] }, T + 210_000);
    expect(bld).toMatchObject({ status: 'idle', progress: 0, ended: { ok: false, note: 'A link points to a missing page.' } });
    put(s, { builds: [build(4, { version: 3 })] }, T + 211_000);
    expect(bld).toMatchObject({ live: true, status: 'work', task: 'Building kopi.example v3', ended: null });

    /* Research, a deploy and an access check end the same way. */
    put(s, { reqs: [req(1)] }, T + 220_000);
    put(s, { reqs: [req(1, { status: 'done', finishedAt: T + 280_000, keywords: [{ keyword: 'phin', meaning: '', intent: '', cluster: '', basis: '' }, { keyword: 'phin nhôm', meaning: '', intent: '', cluster: '', basis: '' }] })] }, T + 280_000);
    expect(agent(s, 'kw').ended).toMatchObject({ ok: true, note: 'Proposed 2 keywords' });
    put(s, { builds: [build(2, { status: 'ready', review: 'approved', deploy: 'work' })] }, T + 300_000);
    put(s, { builds: [build(2, { status: 'ready', review: 'approved', deploy: 'live', deployUrl: 'https://kopi-example.pages.dev' })] }, T + 340_000);
    expect(agent(s, 'dep').ended).toMatchObject({ ok: true, note: 'Live on Cloudflare Pages' });
    s.checking = ['a'];
    simTick(s, env(T + 400_000));
    expect(agent(s, 'dep')).toMatchObject({ live: true, task: 'Checking access: kopi.example from Vietnam', ended: null });
    s.checking = [];
    s.live.access.a = { siteId: 'a', domain: 'kopi.example', cc: 'VN', at: T + 415_000, result: 'ok', dns: 'ok', http: '200', summary: 'Reachable from Vietnam', probes: [], by: 'Dana Owner' };
    simTick(s, env(T + 415_000));
    expect(agent(s, 'dep')).toMatchObject({ live: false, status: 'idle', task: 'Checking access: kopi.example from Vietnam', ended: { ok: true, note: 'Reachable from Vietnam' } });
  });

  it('rests at once when the job is gone or was started again', () => {
    const s = load({ arts: [serverArticle(5, { status: 'work', content: null, finishedAt: null })] }, T + 10_000);
    put(s, { arts: [serverArticle(5, { status: 'queued', content: null, startedAt: null, finishedAt: null })] }, T + 20_000);
    expect(agent(s, 'wr')).toMatchObject({ status: 'idle', progress: 0, task: 'Waiting for a task' });
    expect(agent(s, 'wr').ended).toBeFalsy();
  });
});

describe('an agent a person paused', () => {
  const offIn = (s: AppState, id: string) => (docOf(s, 'agents') as unknown as { id: string; off: boolean }[]).find(x => x.id === id)?.off;
  const pause = (a: AppState['agents'][number]) => Object.assign(a, { status: 'off', progress: 0, task: 'Paused by admin' });

  it('stays paused, also in the saved agents document, while the server runs jobs it would show', () => {
    const s = load({}, T);
    const bld = pause(agent(s, 'bld')), dep = pause(agent(s, 'dep'));
    put(s, { arts: [withPhotos(serverArticle(5), photoJob())] }, T + 100_000);
    put(s, { arts: [withPhotos(serverArticle(5), photoJob({ status: 'work', startedAt: T + 100_000 }))] }, T + 100_000);
    s.checking = ['a'];
    simTick(s, env(T + 101_000));
    simTick(s, env(T + 103_000));
    for (const a of [bld, dep]) {
      expect(a).toMatchObject({ status: 'off', progress: 0, task: 'Paused by admin' });
      expect(a.live).toBeFalsy();
      expect(offIn(s, a.id)).toBe(true);
    }
    /* The jobs end: no done moment, still paused. */
    put(s, { arts: [withPhotos(serverArticle(5), photoJob({ status: 'done', startedAt: T + 100_000, finishedAt: T + 150_000 }), [photo('p1')])] }, T + 150_000);
    s.checking = [];
    s.live.access.a = check(T + 150_000);
    simTick(s, env(T + 150_000));
    for (const a of [bld, dep]) {
      expect(a).toMatchObject({ status: 'off', task: 'Paused by admin' });
      expect(a.ended).toBeFalsy();
      expect(offIn(s, a.id)).toBe(true);
    }
  });

  it('lets go of the job it was showing when paused, and takes it again once resumed', () => {
    const s = load({ builds: [build(3)] }, T + 1_000);
    const bld = agent(s, 'bld');
    expect(bld).toMatchObject({ live: true, status: 'work' });
    pause(bld);
    simTick(s, env(T + 5_000));
    expect(bld).toMatchObject({ live: false, run: null, status: 'off', progress: 0, task: 'Paused by admin' });
    /* Resumed (slices/workspace.ts pauseAgent): the build that still runs takes it again. */
    Object.assign(bld, { status: 'idle', task: 'Waiting for a task' });
    simTick(s, env(T + 10_000));
    expect(bld).toMatchObject({ live: true, status: 'work', task: 'Building kopi.example v2', run: { kind: 'build', at: T } });
    expect(bld.progress).toBe(estimate(10_000, 'build'));
  });
});

describe('hand-offs of real work', () => {
  const asked = (at: number) => [{ at, by: 'Dana Owner', action: 'requested' as const, note: '' }];

  it('flies the page from the Keyword agent to the Content Writer, on to the Site Builder, then to the people who decide', () => {
    /* Opening the page replays nothing, even work that just happened. */
    const s = load({ arts: [serverArticle(5, { status: 'queued', content: null, startedAt: null, finishedAt: null, history: asked(T) })] }, T + 1_000);
    expect(s.handoff).toEqual({ seq: 0, pairs: [] });

    put(s, { arts: [serverArticle(7, { status: 'queued', content: null, startedAt: null, finishedAt: null, history: asked(T + 60_000) })] }, T + 61_000);
    expect(s.handoff).toEqual({ seq: 1, pairs: [{ from: 'kw', to: 'wr' }] });
    put(s, { arts: [serverArticle(7, { status: 'work', content: null, startedAt: T + 62_000, finishedAt: null, history: asked(T + 60_000) })] }, T + 62_000);
    expect(s.handoff.seq).toBe(1);

    /* Written: the photo job it queued goes to the Site Builder. */
    const written = { startedAt: T + 62_000, finishedAt: T + 200_000, updatedAt: T + 200_000, history: [...asked(T + 60_000), { at: T + 200_000, by: 'Content Writer', action: 'written' as const, note: '' }] };
    put(s, { arts: [withPhotos(serverArticle(7, written), photoJob({ queuedAt: T + 200_000 }))] }, T + 200_000);
    expect(s.handoff).toEqual({ seq: 2, pairs: [{ from: 'wr', to: 'bld' }] });
    /* With its photos the article waits for a person. */
    put(s, { arts: [withPhotos(serverArticle(7, written), photoJob({ status: 'done', queuedAt: T + 200_000, startedAt: T + 201_000, finishedAt: T + 250_000 }), [photo('p1')])] }, T + 250_000);
    expect(s.handoff).toEqual({ seq: 3, pairs: [{ from: 'bld', to: MEET }] });
    /* The same state again flies nothing. */
    liveApply(s, T + 251_000);
    expect(s.handoff.seq).toBe(3);

    /* A reviewer's note goes back to the Content Writer. */
    const revision = { ...written, status: 'queued' as const, pendingNote: 'Shorter.', history: [...written.history, { at: T + 300_000, by: 'Linh Reviewer', action: 'revision' as const, note: 'Shorter.' }] };
    put(s, { arts: [withPhotos(serverArticle(7, revision), photoJob({ status: 'done', queuedAt: T + 200_000, startedAt: T + 201_000, finishedAt: T + 250_000 }))] }, T + 300_000);
    expect(s.handoff).toEqual({ seq: 4, pairs: [{ from: MEET, to: 'wr' }] });

    /* Photos asked for by a person long after the writing are not the Content Writer's hand-off. */
    put(s, { arts: [withPhotos(serverArticle(5, { history: asked(T) }), photoJob({ queuedAt: T + 900_000 }))] }, T + 900_000);
    expect(s.handoff.seq).toBe(4);
  });

  it('hands a built website to the people who decide, and to Deploy & Monitor each time a deploy is queued', () => {
    const s = load({ builds: [build(3)] }, T + 1_000);
    put(s, { builds: [build(3, { status: 'ready', review: 'waiting', finishedAt: T + 20_000 })] }, T + 20_000);
    expect(s.handoff).toEqual({ seq: 1, pairs: [{ from: 'bld', to: MEET }] });
    put(s, { builds: [build(3, { status: 'ready', review: 'approved', deploy: 'queued', finishedAt: T + 20_000 })] }, T + 60_000);
    expect(s.handoff).toEqual({ seq: 2, pairs: [{ from: 'bld', to: 'dep' }] });
    put(s, { builds: [build(3, { status: 'ready', review: 'approved', deploy: 'work', finishedAt: T + 20_000 })] }, T + 61_000);
    put(s, { builds: [build(3, { status: 'ready', review: 'approved', deploy: 'failed', deployError: 'The token cannot deploy to Pages.', finishedAt: T + 20_000 })] }, T + 90_000);
    expect(s.handoff.seq).toBe(2);
    /* Try deploy again. */
    put(s, { builds: [build(3, { status: 'ready', review: 'approved', deploy: 'queued', finishedAt: T + 20_000 })] }, T + 120_000);
    expect(s.handoff).toEqual({ seq: 3, pairs: [{ from: 'bld', to: 'dep' }] });
  });

  it('does not fly old work that arrives late, or to an agent that was removed', () => {
    const s = load({}, T);
    put(s, { arts: [serverArticle(7, { status: 'queued', content: null, startedAt: null, finishedAt: null, history: asked(T) })] }, T + 10 * 60_000);
    expect(s.handoff.seq).toBe(0);
    s.agents = s.agents.filter(a => a.id !== 'bld');
    put(s, { builds: [build(3, { status: 'ready', review: 'waiting', finishedAt: T + 10 * 60_000 })] }, T + 10 * 60_000);
    expect(s.handoff.seq).toBe(0);
  });
});

describe('the Site Builder in Run history', () => {
  it('writes each finished photo job and website build once', () => {
    const steps = [{ at: T, text: 'Choosing the site\'s name, colours and labels' }, { at: T + 4_000, text: 'Placing 1 approved article' }, { at: T + 9_000, text: 'Ready' }];
    const s = load({
      arts: [withPhotos(serverArticle(5), photoJob({ status: 'done', startedAt: T + 100_000, finishedAt: T + 160_000, tokens: 900, costUsd: 0.05 }), [photo('p1')])],
      builds: [build(3, { status: 'ready', review: 'waiting', finishedAt: T + 9_000, steps, tokens: 300, costUsd: 0.02 }), build(4, { version: 3, status: 'failed', error: 'A link points to a missing page.', startedAt: T + 200_000, finishedAt: T + 205_000 })],
    }, T + 300_000);
    const runs = s.jobLog.filter(r => r.agent === 'Site Builder');
    expect(runs.map(r => [r.task, r.status, r.dur, r.tokens, r.cost, r.by])).toEqual([
      ['Building kopi.example v3', 'Failed', 5, 0, 0, 'Dana Owner'],
      ['Choosing photos: cà phê phin', 'Done', 60, 900, 0.05, undefined],
      ['Building kopi.example v2', 'Done', 9, 300, 0.02, 'Dana Owner'],
    ]);
    expect(runs[0]?.steps).toEqual(['Started the build', 'Stopped: A link points to a missing page.']);
    expect(runs[1]?.steps).toContain('Chose 1 photo and wrote their alt text and captions');
    expect(runs[2]?.steps).toEqual(steps.map(x => x.text));
    expect(runs[2]?.stepAt).toEqual([0, 4, 9]);
    liveApply(s, T + 301_000);
    expect(s.jobLog.filter(r => r.agent === 'Site Builder')).toHaveLength(3);
  });

  it('lists only a build\'s own steps under it, not those of its deploy', () => {
    /* The server sends the build's steps followed by its deploys' (server/builds.ts viewBuild). */
    const own = [{ at: T + 1_000, text: 'Placing 1 approved article' }, { at: T + 15_000, text: 'Checking links, images and markup' }, { at: T + 20_000, text: 'Ready for approval' }];
    const steps = [...own, { at: T + 3_600_000, text: 'Started putting kopi.example v2 live' }, { at: T + 3_640_000, text: 'Live at https://kopi.pages.dev' }];
    const s = load({ builds: [build(3, { status: 'ready', review: 'approved', deploy: 'live', step: '', finishedAt: T + 20_000, steps })] }, T + 4_000_000);
    expect(s.jobLog.find(r => r.task === 'Building kopi.example v2')).toMatchObject({ dur: 20, steps: own.map(x => x.text), stepAt: [1, 15, 20] });
  });
});

describe('a store with nothing new', () => {
  it('is left exactly as it was by another apply or a tick', () => {
    const s0 = produce(withSite(), d => { put(d, { arts: [withPhotos(serverArticle(5), photoJob({ status: 'done', startedAt: T + 96_000, finishedAt: T + 150_000 }))], builds: [build(3, { status: 'ready', review: 'approved', deploy: 'live' })] }, T + 200_000); d.live.ready = true; });
    expect(produce(s0, d => { liveAgentsTo(d, T + 201_000); })).toBe(s0);
    expect(produce(s0, d => { simTick(d, env(T + 202_000)); })).toBe(s0);
  });
});

describe('a job that ends too quickly to see', () => {
  const steps = [
    { at: T + 10, text: 'Started website v2 of kopi.example' }, { at: T + 20, text: 'Placing 1 approved article' },
    { at: T + 30, text: 'Writing pages, sitemap and robots.txt' }, { at: T + 40, text: 'Checking links, images and markup' },
    { at: T + 50, text: 'Ready for approval' },
  ];
  it('stays at its desk going through its real steps, then shows Done, and only then hands its page on', () => {
    const s = load({}, T);
    put(s, { builds: [build(3, { startedAt: T, steps: steps.slice(0, 2), step: 'Placing 1 approved article' })] }, T);
    expect(agent(s, 'bld')).toMatchObject({ status: 'work', task: 'Building kopi.example v2' });
    /* 100 ms later the build is ready and waiting for approval. */
    put(s, { builds: [build(3, { status: 'ready', review: 'waiting', step: '', startedAt: T, finishedAt: T + 50, steps })] }, T + 100);
    expect(agent(s, 'bld')).toMatchObject({ status: 'work', run: { replay: true, step: 'Started website v2 of kopi.example' } });
    const seq = s.handoff.seq;
    liveAgentsTo(s, T + MIN_WORK_MS / 2);
    expect(agent(s, 'bld').run?.step).toBe('Writing pages, sitemap and robots.txt');
    expect(s.handoff.seq).toBe(seq);
    liveAgentsTo(s, T + MIN_WORK_MS);
    expect(agent(s, 'bld')).toMatchObject({ status: 'idle', progress: 100, ended: { ok: true, note: 'Ready for your approval' } });
    expect(s.handoff.seq).toBe(seq + 1);
    expect(s.handoff.pairs).toEqual([{ from: 'bld', to: MEET }]);
  });
  it('is not held back when it ran long enough to be seen', () => {
    const s = load({}, T);
    put(s, { builds: [build(3, { startedAt: T })] }, T);
    put(s, { builds: [build(3, { status: 'ready', review: 'waiting', startedAt: T, finishedAt: T + 20_000, steps })] }, T + 20_000);
    expect(agent(s, 'bld')).toMatchObject({ status: 'idle', ended: { ok: true } });
  });
  it('shows an access check that started and ended between two ticks', () => {
    const s = load({}, T);
    s.checking = ['a'];
    liveAgentsTo(s, T);
    expect(agent(s, 'dep')).toMatchObject({ status: 'work', task: 'Checking access: kopi.example from Vietnam' });
    s.live.access.a = check(T + 5, { result: 'down', summary: 'kopi.example does not resolve on public DNS.' });
    s.checking = [];
    liveAgentsTo(s, T + 10);
    expect(agent(s, 'dep')).toMatchObject({ status: 'work', run: { replay: true } });
    liveAgentsTo(s, T + MIN_WORK_MS);
    expect(agent(s, 'dep')).toMatchObject({ status: 'idle', ended: { ok: true, note: 'kopi.example does not resolve on public DNS.' } });
  });
});

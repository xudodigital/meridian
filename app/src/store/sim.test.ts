import { describe, expect, it } from 'vitest';
import { costOf, siteById } from './rules';
import { simTick, type TickEnv } from './sim';
import { T0, makeEmptyState, makeState } from './testing';
import type { AppState } from './types';

/** A fixed random value makes every tick predictable: progress +1, tokens +330 per worker. */
const env = (r = 0.5, over: Partial<TickEnv> = {}): TickEnv => ({ now: T0, lastActive: T0, rand: () => r, ...over });
const agent = (s: AppState, id: string) => s.agents.find(a => a.id === id)!;

describe('simTick', () => {
  it('does nothing while signed out', () => {
    const s = makeState(null), before = JSON.stringify(s);
    expect(simTick(s, env()).skipped).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('signs the person out after the idle timeout', () => {
    const s = makeState(); s.settings.timeout = 'm15';
    expect(simTick(s, env(0.5, { lastActive: T0 - 15 * 60_000 })).signedOut).toBe(false);
    const r = simTick(s, env(0.5, { lastActive: T0 - 15 * 60_000 - 1 }));
    expect(r.signedOut).toBe(true);
    expect(s.session).toBeNull();
    expect(s.loginNote).toBe('You were signed out after 15 minutes without activity.');
  });

  it('adds tokens to the agent and their cost to the site spend', () => {
    const s = makeState(), a = siteById(s, 'a')!;
    const working = s.agents.filter(x => x.status === 'work' && x.site === 'a');   // Orchestrator, Content Writer, Graphic Designer
    expect(working.map(x => x.id)).toEqual(['orc', 'wr', 'gd']);
    const spend0 = a.spend, tok0 = working.map(x => x.tokens), prog0 = working.map(x => x.progress);
    simTick(s, env());
    const dts = working.map(x => Math.round(330 * x.workers));
    expect(working.map((x, i) => x.tokens - tok0[i]!)).toEqual(dts);
    expect(working.map((x, i) => x.progress - prog0[i]!)).toEqual([1, 1, 1]);
    const expected = working.reduce((n, x, i) => n + costOf(dts[i]!, x.model, T0), 0);
    expect(a.spend - spend0).toBeCloseTo(expected, 10);
    expect(expected).toBeGreaterThan(0);
  });

  it('stops an agent whose provider key is missing, warns once, and lets it start again when the key is back', () => {
    const s = makeState(), claude = s.ints.find(x => x.id === 'openai')!;
    const working = s.agents.filter(x => x.status === 'work');
    const tail = claude.tail; claude.tail = null;
    const tokens = working.map(x => x.tokens), spend = siteById(s, 'a')!.spend, notifs = s.notifs.length;
    simTick(s, env());
    for (const x of working) {
      expect(x.status).toBe('err'); expect(x.errKey).toBe(true); expect(x.progress).toBe(0);
      expect(x.task).toBe('OpenAI API key is missing. Add it in Integrations.');
    }
    expect(working.map(x => x.tokens)).toEqual(tokens);
    expect(siteById(s, 'a')!.spend).toBe(spend);
    expect(s.keyWarned).toBe(true);
    expect(s.notifs.length).toBe(notifs + 1);
    expect(s.notifs[0]).toMatchObject({ k: 'bad', icon: 'key', title: 'Agents stopped: the OpenAI API key is missing', view: 'integrations' });
    expect(s.log[0]!.act).toBe('Stopped: the OpenAI API key is missing');
    simTick(s, env());
    expect(s.notifs.length).toBe(notifs + 1);
    /* Idle agents do not pick up work without a key either. */
    simTick(s, env(0));
    expect(s.agents.filter(x => x.status === 'work')).toEqual([]);
    claude.tail = tail;
    simTick(s, env());
    for (const x of working) { expect(x.status).toBe('idle'); expect(x.errKey).toBe(false); expect(x.task).toBe('Waiting for a task'); }
    expect(s.keyWarned).toBe(false);
  });

  it('stops agents on a site that used its daily budget', () => {
    const s = makeState(), a = siteById(s, 'a')!;
    a.spend = s.settings.budget;
    simTick(s, env());
    for (const id of ['orc', 'wr', 'gd']) { expect(agent(s, id).status).toBe('idle'); expect(agent(s, id).task).toBe('Waiting for a task'); expect(agent(s, id).progress).toBe(0); }
    expect(a.spend).toBe(s.settings.budget);
    expect(s.log.filter(l => l.act === 'Stopped: the site used its daily budget' && l.site === 'a')).toHaveLength(3);
    /* Agents on other sites keep working. */
    expect(agent(s, 'seo').status).toBe('work');
  });

  it('notifies when a site passes 80% and 100% of its budget', () => {
    const s = makeState(), a = siteById(s, 'a')!;
    a.spend = s.settings.budget * 0.8 - 0.0001;
    simTick(s, env());
    expect(s.notifs[0]).toMatchObject({ k: 'warn', title: 'domain-a.example passed 80% of its daily budget', view: 'analytics' });
    a.spend = s.settings.budget - 0.0001;
    const n = s.notifs.length;
    simTick(s, env());
    expect(s.notifs.length).toBe(n + 1);
    expect(s.notifs[0]).toMatchObject({ k: 'bad', title: 'domain-a.example used its whole daily budget' });
    s.np.budget[0] = false; a.spend = s.settings.budget * 0.8 - 0.0001;
    simTick(s, env());
    expect(s.notifs.length).toBe(n + 1);   // the In-app channel for budget alerts is off
  });

  it('finishes a job: logs the run, hands it on, and sends the writer\'s article to review', () => {
    const s = makeState(), wr = agent(s, 'wr');
    wr.progress = 99.5; const task = wr.task, articles = s.articles.length, runs = s.jobLog.length;
    const r = simTick(s, env());
    expect(r.finished).toEqual(['wr']);
    expect(wr.status).toBe('idle'); expect(wr.progress).toBe(0);
    expect(s.jobLog.length).toBe(runs + 1);
    expect(s.jobLog[0]).toMatchObject({ agent: 'Content Writer', task, status: 'Done', site: 'a' });
    expect(s.articles.length).toBe(articles + 1);
    expect(s.articles[0]).toMatchObject({ id: 5, s: 'a', status: 'review', title: 'Sample article #5 (Vietnamese)' });
    expect(s.notifs[0]!.title).toBe('An article is ready for review');
  });

  it('publishes without review when publish approval is off', () => {
    const s = makeState(); s.settings.apPublish = false; agent(s, 'wr').progress = 99.5;
    const articles = s.articles.length;
    simTick(s, env());
    expect(s.articles.length).toBe(articles);
    expect(s.autoPub).toBe(1);
    expect(s.log.some(l => l.act === 'Published without human review (publish approval is off)')).toBe(true);
  });

  it('asks for deploy approval at the deploy gate', () => {
    const s = makeState(), dep = agent(s, 'dep');
    s.approvals = []; dep.status = 'work'; dep.progress = 99.5; dep.pending = null; dep.task = 'Preparing a deploy of new pages';
    const r = simTick(s, env(0.5));
    expect(r.approvalsChanged).toBe(true);
    expect(dep.status).toBe('wait');
    expect(s.approvals).toEqual([{ id: dep.pending, kind: 'Deploy', what: 'Preparing a deploy of new pages', site: 'b', agent: 'dep' }]);
    expect(s.notifs[0]).toMatchObject({ k: 'warn', title: 'A deploy needs your approval', view: 'deploy' });
    /* With deploy approval switched off the agent just goes idle. */
    const t = makeState(), d2 = agent(t, 'dep'); t.settings.apDeploy = false; t.approvals = []; d2.status = 'work'; d2.progress = 99.5;
    simTick(t, env(0.5));
    expect(d2.status).toBe('idle'); expect(t.approvals).toEqual([]);
  });

  it('lets an idle agent pick up a task on an open site', () => {
    const s = makeState(), arc = agent(s, 'arc');
    simTick(s, env(0.5));
    expect(arc.status).toBe('idle');
    simTick(s, env(0.01));
    expect(arc.status).toBe('work'); expect(arc.progress).toBe(2); expect(arc.tok0).toBe(arc.tokens);
    expect(arc.tasks).toContain(arc.task);
    expect(s.log.some(l => l.actor === 'Architect' && l.act === 'Started: ' + arc.task)).toBe(true);
  });

  it('retries an errored agent after its countdown', () => {
    const s = makeState(), kw = agent(s, 'kw');
    expect(kw.status).toBe('err'); expect(kw.errT).toBe(25);
    for (let i = 0; i < 24; i++) simTick(s, env());
    expect(kw.status).toBe('err');
    simTick(s, env());
    expect(kw.status).toBe('work'); expect(kw.progress).toBe(5);
    expect(s.log.some(l => l.actor === 'Keyword' && l.act === 'Retried automatically and resumed')).toBe(true);
  });

  it('gives the oldest queued keyword request to the Keyword agent, in demo mode even while the server answers', () => {
    const s = makeState(), kw = agent(s, 'kw');
    kw.status = 'idle'; kw.task = 'Waiting for a task';
    s.kwReqs.unshift({ id: 201, site: 'a', topic: 'older', goal: 'Find a new topic cluster', t: new Date(T0), st: 'queued' });
    s.kwReqs.unshift({ id: 202, site: 'b', topic: 'newer', goal: 'Find a new topic cluster', t: new Date(T0), st: 'queued' });
    /* Demo mode never uses the server's data, so its requests are simulated here. */
    s.live.on = true;
    simTick(s, env());
    expect(kw).toMatchObject({ status: 'work', site: 'a', task: 'Researching keywords: older', req: 201, progress: 2 });
    expect(s.kwReqs.map(r => r.st)).toEqual(['queued', 'work']);
    kw.progress = 99.5;
    simTick(s, env());
    expect(s.kwReqs.find(r => r.id === 201)!.st).toBe('done');
    expect(s.notifs[0]!.title).toBe('Keyword research is ready: older');
  });

  it('skips an agent the server is driving', () => {
    const s = makeState(), kw = agent(s, 'kw');
    kw.live = true; kw.status = 'work'; kw.progress = 91.8; const tokens = kw.tokens;
    simTick(s, env());
    expect(kw.progress).toBe(92); expect(kw.tokens).toBe(tokens); expect(kw.status).toBe('work');
    simTick(s, env());
    expect(kw.progress).toBe(92);
  });

  it('invents nothing outside sample-data mode, over many ticks', () => {
    const s = makeEmptyState();
    /* A real site and a queued request must not start any work either. */
    s.sites.push({ id: 's1', domain: 'real.example', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
    s.kwReqs.push({ id: 1, site: 's1', topic: 'phin', goal: 'Find a new topic cluster', t: new Date(T0), st: 'queued' });
    const before = structuredClone(s);
    for (let i = 0; i < 500; i++) {
      const r = simTick(s, env((i % 100) / 100));
      expect(r).toEqual({ skipped: false, signedOut: false, finished: [], approvalsChanged: false });
    }
    expect(s).toEqual(before);
    expect(s.agents.every(a => a.status === 'idle' && a.tokens === 0 && a.progress === 0 && a.site === null)).toBe(true);
    expect([s.log, s.notifs, s.jobLog, s.articles, s.approvals]).toEqual([[], [], [], [], []]);
  });

  it('still moves a server-driven agent and still signs out outside sample-data mode', () => {
    const s = makeEmptyState(), kw = agent(s, 'kw');
    kw.live = true; kw.status = 'work'; kw.progress = 4;
    const others = structuredClone(s.agents.filter(a => a.id !== 'kw'));
    simTick(s, env()); simTick(s, env());
    expect(kw).toMatchObject({ progress: 5, tokens: 0, status: 'work' });
    for (let i = 0; i < 400; i++) simTick(s, env());
    expect(kw.progress).toBe(92);
    expect(s.agents.filter(a => a.id !== 'kw')).toEqual(others);
    expect(s.log).toEqual([]);
    s.settings.timeout = 'm15';
    expect(simTick(s, env(0.5, { lastActive: T0 - 15 * 60_000 - 1 })).signedOut).toBe(true);
    expect(s.session).toBeNull();
  });

  it('returns a revised article to the review queue', () => {
    const s = makeState(), x = s.articles.find(a => a.id === 2)!;
    x.status = 'revisi'; x.wait = 2;
    simTick(s, env());
    expect(x.status).toBe('revisi');
    simTick(s, env());
    expect(x).toMatchObject({ status: 'review', rev: 1, native: { st: 'wait' } });
    expect(x.checks.map(c => c[0])).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(x.checks[1]).toEqual(['ok', 'Testing claim', 'Fixed in revision 1']);
  });
});

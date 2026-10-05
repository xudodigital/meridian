/* The helpers behind the "professional level" pass: one date-time format, one status vocabulary, planned agents and
   the setup checklist. Pure functions, so they run without a DOM. */
import { describe, expect, it } from 'vitest';
import { serverArticle } from './articleFixtures';
import { buildWire, cloudflareWire } from './buildFixtures';
import { req } from './liveAgentFixtures';
import { ACC, MOD_EMPTY, MOD_EMPTY_HEAD, RUNNER_AGENTS, SST, agentPlanned, mapData, setupSteps, siteStatusText, stamp } from './rules';
import { makeEmptyState, makeState, sessionFor } from './testing';
import type { Site } from './types';

describe('stamp: the one date-time format', () => {
  const now = new Date(2026, 9, 3, 15, 0).getTime();
  it('shows the time alone for today', () => {
    expect(stamp(new Date(2026, 9, 3, 12, 31), now)).toBe('12:31');
    expect(stamp(new Date(2026, 9, 3, 0, 5).getTime(), now)).toBe('00:05');
  });
  it('shows the day and the time for any other day', () => {
    expect(stamp(new Date(2026, 9, 2, 12, 31), now)).toBe('2 Oct, 12:31');
    expect(stamp(new Date(2026, 8, 30, 23, 59), now)).toBe('30 Sept, 23:59');
    /* The same hour yesterday is not "today". */
    expect(stamp(new Date(2026, 9, 2, 15, 0), now)).toBe('2 Oct, 15:00');
  });
});

describe('status vocabulary', () => {
  it('keeps "Blocked by ISP" and "Not reachable" apart', () => {
    expect(ACC.blocked[1]).toBe('Blocked by ISP');
    expect(ACC.down[1]).toBe('Not reachable');
    expect(ACC.ok[1]).toBe('Reachable');
  });
  it('words a site status the same everywhere, per mode', () => {
    expect(siteStatusText('build', true)).toBe(SST.build[1]);
    expect(siteStatusText('build', false)).toBe('Being set up');
    expect(siteStatusText('live', false)).toBe('Live');
    expect(siteStatusText('paused', true)).toBe('Paused');
  });
  it('counts a domain that does not answer as not reachable, not as blocked', () => {
    const s = makeEmptyState();
    const site = (id: string, access: Site['access']): Site => ({ id, domain: id + '.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 't', status: 'build', access, checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
    s.sites = [site('a', 'down')];
    expect(mapData(s)).toEqual([expect.objectContaining({ cc: 'ID', blocked: 0, down: 1, k: 'bad', bad: ['a.example'] })]);
    s.sites = [site('a', 'down'), site('b', 'blocked'), site('c', 'ok')];
    expect(mapData(s)[0]).toMatchObject({ n: 3, blocked: 1, down: 1, k: 'bad', bad: ['a.example', 'b.example'] });
    s.sites = [site('c', 'ok')];
    expect(mapData(s)[0]).toMatchObject({ blocked: 0, down: 0, k: 'warn' });
  });
  it('gives every module table an honest empty state', () => {
    for (const id of Object.keys(MOD_EMPTY) as (keyof typeof MOD_EMPTY)[]) {
      expect(MOD_EMPTY_HEAD[id][1].length).toBeGreaterThan(3);
      /* No table promises data "once" something happens that nothing in Meridian does yet. */
      expect(MOD_EMPTY[id]).not.toMatch(/once the (Research agent|Architect|SEO\/GEO Optimizer)/);
    }
    /* Rank tracking and GA4 are read from the connected Google account now: neither says "planned" any more. */
    expect(MOD_EMPTY.rank).toContain('Search Console');
    expect(MOD_EMPTY.ga4).toContain('users and sessions');
    expect(MOD_EMPTY.rank + MOD_EMPTY.ga4).not.toMatch(/planned|not read/);
  });
});

describe('planned agents', () => {
  it('are the agents without a job runner, outside demo mode only', () => {
    const s = makeEmptyState();
    expect(s.agents.filter(a => !agentPlanned(s, a))).toHaveLength(11);
    expect(s.agents.filter(a => agentPlanned(s, a))).toHaveLength(0);
    expect(agentPlanned(s, { id: 'x12-abcde' })).toBe(true);
    /* Demo mode simulates every agent. */
    expect(makeState().agents.some(a => agentPlanned({ sample: true }, a))).toBe(false);
    /* The Orchestrator is the workflow engine (server/workflows.ts): real, and it makes no model call. */
    expect(RUNNER_AGENTS.size).toBe(11);
  });
});

describe('setupSteps: the Finish setup checklist', () => {
  const done = (s: Parameters<typeof setupSteps>[0]) => setupSteps(s).filter(x => x.done).map(x => x.id);

  it('starts with nothing done on an empty workspace', () => {
    const s = makeEmptyState();
    expect(setupSteps(s).map(x => x.id)).toEqual(['engine', 'site', 'verify', 'research', 'article', 'build', 'cloudflare', 'gsc', 'email', 'twofa']);
    expect(done(s)).toEqual([]);
    expect(setupSteps(s).every(x => x.title && x.hint && x.action)).toBe(true);
  });

  it('ticks each step from what the server reports', () => {
    const s = makeEmptyState();
    s.live.on = true;
    s.live.engine = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.0', ready: true, reason: '' };
    expect(done(s)).toEqual(['engine']);
    s.sites = [{ id: 'a', domain: 'kopi.example', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'build', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 }];
    expect(done(s)).toEqual(['engine', 'site']);

    /* Ownership counts only once the record was found, and only for a domain that is still in the workspace. */
    s.live.verify.a = { siteId: 'a', domain: 'kopi.example', host: '_meridian', value: 'v', verifiedAt: null, by: '' };
    expect(done(s)).not.toContain('verify');
    s.live.verify.a.verifiedAt = 1;
    expect(done(s)).toContain('verify');
    s.live.verify.a.domain = 'old.example';
    expect(done(s)).not.toContain('verify');
    s.live.verify.a.domain = 'kopi.example';

    s.live.reqs[1] = req(1, { status: 'work' });
    expect(done(s)).not.toContain('research');
    s.live.reqs[1] = req(1, { status: 'done' });
    s.live.arts[5] = serverArticle(5, { status: 'review' });
    expect(done(s)).toContain('research');
    expect(done(s)).not.toContain('article');
    s.live.arts[5] = serverArticle(5, { status: 'approved' });
    s.live.builds[1] = buildWire(1, 'a', 'kopi.example', 1, { status: 'failed' });
    expect(done(s)).toContain('article');
    expect(done(s)).not.toContain('build');
    s.live.builds[1] = buildWire(1, 'a', 'kopi.example', 1);

    /* A connection whose last test failed does not count. */
    s.live.ints.cf = cloudflareWire(true, { status: 'bad' });
    expect(done(s)).not.toContain('cloudflare');
    s.live.ints.cf = cloudflareWire(true);
    s.live.ints.gsc = cloudflareWire(true, { id: 'gsc' });
    s.live.ints.email = cloudflareWire(true, { id: 'email' });
    s.session = { ...sessionFor('admin'), twofa: true };
    expect(done(s)).toEqual(['engine', 'site', 'verify', 'research', 'article', 'build', 'cloudflare', 'gsc', 'email', 'twofa']);
  });

  it('links each step to its screen, and Integrations only for an admin', () => {
    const admin = setupSteps(makeEmptyState('admin'));
    expect(Object.fromEntries(admin.map(x => [x.id, x.to]))).toEqual({
      engine: 'integrations', site: 'sites', verify: 'sites', research: 'keywords', article: 'review', build: 'website',
      cloudflare: 'integrations', gsc: 'integrations', email: 'integrations', twofa: 'account',
    });
    const editor = setupSteps(makeEmptyState('editor'));
    expect(editor.filter(x => x.to === null).map(x => x.id)).toEqual(['cloudflare', 'gsc', 'email']);
    expect(editor.find(x => x.id === 'gsc')?.hint).toContain('Ask an admin');
  });
});

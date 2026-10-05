/* Loading and saving the workspace through a fake server (fakeApi.ts): documents saved with their version, a stale
   write merged and saved again, a failed save shown and retried, other browsers' changes applied, audit entries sent
   and replaced by the server's copy, read notifications remembered, and nothing at all in demo mode. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, answer, emptyWorkspace } from './fakeApi';
import { useStore } from './store';
import { SAVE_DELAY_MS, remoteAudit, remoteDoc, remoteReads, remoteReset, startSync } from './sync';
import { defaultSettings } from './empty';
import { meFor, resetStore } from './testing';
import type { Site } from './types';
import type { Json } from './workspace';

const site = (id: string, domain: string): Site => ({ id, domain, country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
const st = () => useStore.getState();
let api: FakeApi;
let docs: Record<string, { version: number; data: Json | null }>;

/** A server that keeps documents with versions, as server/workspace.ts does. */
function server() {
  docs = emptyWorkspace().docs as Record<string, { version: number; data: Json | null }>;
  return new FakeApi()
    .on('GET', '/api/workspace', () => ({ ...emptyWorkspace(), docs, audit: [{ id: 1, t: Date.UTC(2026, 9, 1), actor: 'Dana Owner', act: 'Created the owner account', site: null }], notifRead: ['research-done:1:5'] }))
    .on('PUT', /^\/api\/workspace\/docs\/(\w+)$/, (c, m) => {
      const id = m[1]!, b = c.body as { version: number; data: Json }, cur = docs[id]!;
      if (b.version !== cur.version) return answer(409, { error: 'Someone else changed this at the same time.', version: cur.version, data: cur.data });
      docs[id] = { version: cur.version + 1, data: b.data };
      return { version: cur.version + 1 };
    })
    .on('POST', '/api/audit', c => ({ entries: (c.body as { entries: { act: string; site: string | null; cid: string }[] }).entries.map((e, i) => ({ id: 100 + i, t: Date.now(), actor: 'Dana Owner', ...e })) }))
    .on('POST', '/api/notifications/read', () => ({ ok: true }));
}
const flushAll = async (ms = SAVE_DELAY_MS + 50) => { await vi.advanceTimersByTimeAsync(ms); };
const puts = (id: string) => api.to('PUT', '/api/workspace/docs/' + id);

beforeAll(() => { startSync(); });
beforeEach(async () => {
  vi.useFakeTimers();
  api = server();
  vi.stubGlobal('fetch', api.fetch);
  resetStore(false);
  st().signIn(meFor('admin', 'Dana Owner', 'owner@example.com'));
  await flushAll(0);
});
afterEach(() => {
  /* Signing out forgets every pending save. */
  st().signOut(undefined, false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loading', () => {
  it('loads the workspace after sign-in, with the audit log and the read notifications', () => {
    expect(api.to('GET', '/api/workspace')).toHaveLength(1);
    expect(st().sync).toEqual({ loaded: true, error: '' });
    expect(st().log.map(l => [l.id, l.actor, l.act])).toEqual([[1, 'Dana Owner', 'Created the owner account']]);
    expect(st().notifRead).toEqual(['research-done:1:5']);
    expect(st().agents).toHaveLength(11);
    expect(st().settings.twofa).toBe(false);
  });
});

describe('saving', () => {
  it('saves a changed document once, debounced, with the version it was based on', async () => {
    st().addSite({ domain: 'kopi.example', country: 0, lang: 'Vietnamese', topic: 'Coffee', status: 'live' });
    st().addSite({ domain: 'teh.example', country: 0, lang: 'Vietnamese', topic: 'Tea', status: 'live' });
    expect(puts('sites')).toEqual([]);
    await flushAll();
    expect(puts('sites')).toHaveLength(1);
    const body = puts('sites')[0]!.body as { version: number; data: { domain: string; id: string }[] };
    expect(body.version).toBe(0);
    expect(body.data.map(x => x.domain)).toEqual(['kopi.example', 'teh.example']);
    /* Ids are random outside demo mode, so two browsers never pick the same one. */
    expect(body.data[0]!.id).toMatch(/^s\d+-[a-z0-9]+$/);
    expect(puts('sites')[0]!.headers['x-meridian']).toBe('1');
    /* Only the document that changed is saved. */
    expect(api.calls.filter(c => c.method === 'PUT').map(c => c.path)).toEqual(['/api/workspace/docs/sites']);

    st().setSiteReviewMode(st().sites[0]!.id, 'risk');
    await flushAll();
    expect(puts('reviewModes')[0]?.body).toEqual({ version: 0, data: { [st().sites[0]!.id]: 'risk' } });
    expect(puts('sites')).toHaveLength(1);
    st().pauseSite(st().sites[0]!.id);
    await flushAll();
    expect((puts('sites')[1]!.body as { version: number }).version).toBe(1);
  });

  it('merges a stale write onto the newer version and saves again', async () => {
    /* Another browser added a site meanwhile. */
    docs.sites = { version: 3, data: [site('s-other', 'other.example')] as unknown as Json };
    st().addSite({ domain: 'kopi.example', country: 0, lang: 'Vietnamese', topic: 'Coffee', status: 'live' });
    await flushAll();
    await flushAll();
    const [first, second] = puts('sites').map(c => c.body as { version: number; data: { domain: string }[] });
    expect(first?.version).toBe(0);
    expect(second?.version).toBe(3);
    expect(second?.data.map(x => x.domain)).toEqual(['other.example', 'kopi.example']);
    expect(st().sites.map(x => x.domain)).toEqual(['other.example', 'kopi.example']);
    expect(docs.sites!.version).toBe(4);
  });

  it('shows a failed save without blocking, and clears it when a retry works', async () => {
    let down = true;
    api.on('PUT', '/api/workspace/docs/settings', c => {
      if (down) return answer(500, { error: 'Something went wrong on the server. Try again.' });
      docs.settings = { version: 1, data: (c.body as { data: Json }).data };
      return { version: 1 };
    });
    st().setSystemSetting('budget', 40);
    await flushAll();
    expect(st().sync.error).toBe('Your changes could not be saved: Something went wrong on the server. Try again. Trying again…');
    expect(st().settings.budget).toBe(40);
    down = false;
    await flushAll(2100);
    expect(st().sync.error).toBe('');
    expect((docs.settings!.data as { budget: number }).budget).toBe(40);
  });

  it('puts the server\'s version back when a change is refused for good', async () => {
    api.on('PUT', '/api/workspace/docs/schedules', () => answer(403, { error: 'Only an admin can do this.' }));
    useStore.setState(d => { d.schedules.push({ id: 'c1', wf: 'Weekly', site: null, cad: 'Every hour', on: true }); });
    await flushAll();
    expect(st().schedules).toEqual([]);
    expect(st().snackMsg?.msg).toBe('Your change was not saved: Only an admin can do this.');
  });
});

describe('documents saved in an older shape', () => {
  /* A sites document from an earlier version of the app: it still carries the last deploy, which the app now reads
     from the server's builds (serverFacts.ts) and leaves out of the document. */
  const oldSites = () => [{ ...site('s1', 'kopi.example'), deploy: 'v2 · 1 Oct, 10:00' }] as unknown as Json;
  const signInAs = async (role: 'admin' | 'editor' | 'viewer' | 'reviewer') => {
    st().signOut(undefined, false);
    resetStore(false);
    st().signIn(meFor(role));
    await flushAll(0);
  };

  it('are saved back once in today\'s shape by someone who may save them', async () => {
    docs.sites = { version: 3, data: oldSites() };
    await signInAs('editor');
    await flushAll(10 * (SAVE_DELAY_MS + 50));
    expect(puts('sites')).toHaveLength(1);
    expect((puts('sites')[0]!.body as { data: Record<string, unknown>[] }).data[0]).not.toHaveProperty('deploy');
  });

  it('are left alone for a role that cannot save them, so nothing is sent or refused', async () => {
    /* Settings without a field added since: the app reads it with that field's default. Only an admin saves Settings. */
    const { repOn: _r, ...older } = defaultSettings();
    docs.settings = { version: 2, data: older as unknown as Json };
    api.on('PUT', /^\/api\/workspace\/docs\/(\w+)$/, () => answer(403, { error: 'Your role can only look.' }));
    for (const role of ['viewer', 'reviewer', 'editor'] as const) {
      /* The editor may save sites (saved back in today's shape by someone who may, above), not Settings. */
      const { access: _a, checked: _c, clicks: _k, deploy: _d, ...today } = site('s1', 'kopi.example');
      docs.sites = { version: 3, data: role === 'editor' ? [today] as unknown as Json : oldSites() };
      api.calls.length = 0;
      await signInAs(role);
      await flushAll(10 * (SAVE_DELAY_MS + 50));
      expect(st().sites.map(x => x.domain)).toEqual(['kopi.example']);
      expect(st().settings.repOn).toBe(false);
      expect(api.calls.filter(c => c.method === 'PUT')).toEqual([]);
      expect(st().snackMsg).toBeNull();
    }
  });

  it('are not sent again after the server refused the save for good', async () => {
    docs.sites = { version: 3, data: oldSites() };
    api.on('PUT', '/api/workspace/docs/sites', () => answer(403, { error: 'Only an admin can do this.' }));
    await signInAs('admin');
    await flushAll(10 * (SAVE_DELAY_MS + 50));
    expect(puts('sites')).toHaveLength(1);
    expect(st().snackMsg?.msg).toBe('Your change was not saved: Only an admin can do this.');
  });
});

describe('other browsers', () => {
  it('apply a newer document, and merge it under a change that is not saved yet', async () => {
    remoteDoc('sites', 1, [site('s1', 'kopi.example')] as unknown as Json);
    expect(st().sites.map(x => x.domain)).toEqual(['kopi.example']);
    /* An older version (for example the echo of this browser's own save) is ignored. */
    remoteDoc('sites', 1, []);
    expect(st().sites).toHaveLength(1);
    await flushAll();
    expect(puts('sites')).toEqual([]);

    st().addSite({ domain: 'teh.example', country: 0, lang: 'Vietnamese', topic: 'Tea', status: 'live' });
    remoteDoc('sites', 2, [site('s1', 'kopi.example'), site('s2', 'kopi2.example')] as unknown as Json);
    expect(st().sites.map(x => x.domain)).toEqual(['kopi.example', 'kopi2.example', 'teh.example']);
    docs.sites = { version: 2, data: null };
    await flushAll();
    expect((puts('sites')[0]!.body as { version: number }).version).toBe(2);
  });

  it('add their audit entries, and the server\'s copy replaces an entry made here', async () => {
    st().addSite({ domain: 'kopi.example', country: 0, lang: 'Vietnamese', topic: 'Coffee', status: 'live' });
    const mine = st().log[0]!;
    expect(mine.cid).toMatch(/^c/);
    expect(mine.id).toBeUndefined();
    await flushAll();
    expect(api.to('POST', '/api/audit')[0]?.body).toEqual({ entries: [{ act: 'Added kopi.example (Vietnam)', site: st().sites[0]!.id, cid: mine.cid }] });
    expect(st().log[0]).toMatchObject({ id: 100, actor: 'Dana Owner', act: 'Added kopi.example (Vietnam)' });
    /* The same entry from the event stream changes nothing; another person's entry is added. */
    remoteAudit({ id: 100, t: Date.now(), actor: 'Dana Owner', act: 'Added kopi.example (Vietnam)', site: null, cid: mine.cid });
    remoteAudit({ id: 101, t: Date.now() + 1, actor: 'Eli Editor', act: 'Paused kopi.example', site: null });
    expect(st().log.map(l => l.id)).toEqual([101, 100, 1]);
  });

  it('share which notifications the person read', async () => {
    useStore.setState(d => { d.notifRead = [...d.notifRead, 'article-written:5:9']; });
    await flushAll(0);
    expect(api.to('POST', '/api/notifications/read')[0]?.body).toEqual({ keys: ['article-written:5:9'] });
    remoteReads(['article-failed:6:1']);
    expect(st().notifRead).toContain('article-failed:6:1');
    await flushAll(0);
    expect(api.to('POST', '/api/notifications/read')).toHaveLength(1);
  });

  it('load everything again after a reset', async () => {
    remoteReset();
    expect(st().sync.loaded).toBe(false);
    await flushAll(0);
    expect(api.to('GET', '/api/workspace')).toHaveLength(2);
    expect(st().sync.loaded).toBe(true);
  });
});

describe('retired demo mode', () => {
  it('cannot replace real records or suspend saving when an old caller tries to enable it', async () => {
    const sites = st().sites, log = st().log, session = st().session;
    st().setSampleData(true);
    expect(st().sample).toBe(false);
    expect(st().sites).toBe(sites); expect(st().log).toBe(log); expect(st().session).toBe(session);
    st().setSystemSetting('budget', 99);
    await flushAll();
    expect(api.calls.some(c => c.method === 'PUT')).toBe(true);
  });
});

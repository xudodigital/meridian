import { describe, expect, it } from 'vitest';
import { serverArticle } from '@/store/articleFixtures';
import { buildWire } from '@/store/buildFixtures';
import { req } from '@/store/liveAgentFixtures';
import { makeEmptyState } from '@/store/testing';
import { hasRecordedWork, nextStart, startProgress } from './start';

const state = (site = true) => {
  const s = makeEmptyState();
  s.live.on = s.live.ready = true;
  s.live.engine = { mode: 'openai-api' as const, keyConfigured: true, apiVersion: 'Responses API', ready: true, reason: '' };
  if (site) s.sites.push({ id: 'a', domain: 'kopi.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'build', access: 'pending', checked: '', deploy: '', silos: [], spend: 0, clicks: 0, tok28: 0 });
  return s;
};
describe('the next real step for a new Meridian user', () => {
  it('starts with the API connection, then the site, then one research topic', () => {
    const s = state(false); s.live.engine = null;
    expect(nextStart(s)).toMatchObject({ step: 0, action: 'connect' });
    expect(startProgress(s)).toEqual([false, false, false, false, false, false]);
    s.live.engine = state().live.engine;
    expect(nextStart(s)).toMatchObject({ step: 1, action: 'site' });
    s.sites = state().sites;
    expect(nextStart(s)).toMatchObject({ step: 2, action: 'research' });
    expect(startProgress(s)).toEqual([true, true, false, false, false, false]);
    expect(hasRecordedWork(s)).toBe(false);
  });
  it('uses acknowledged requests to follow work and open its actual result', () => {
    const s = state(); s.live.reqs[1] = req(1, { domain: 'kopi.example', status: 'queued' });
    expect(nextStart(s)).toMatchObject({ step: 2, state: 'working', action: 'result', requestId: 1 });
    expect(hasRecordedWork(s)).toBe(true);
    s.live.reqs[1]!.status = 'done';
    expect(nextStart(s)).toMatchObject({ step: 3, action: 'result', requestId: 1 });
    expect(startProgress(s)[2]).toBe(true);
  });
  it('follows writing, review, approval, build and preview without a Cloudflare connection', () => {
    const s = state();
    s.live.arts[5] = serverArticle(5, { domain: 'kopi.example', status: 'work' });
    expect(nextStart(s)).toMatchObject({ step: 3, state: 'working', action: 'review' });
    s.live.arts[5]!.status = 'review';
    expect(nextStart(s)).toMatchObject({ step: 4, action: 'review' });
    s.live.arts[5]!.status = 'approved';
    expect(nextStart(s)).toMatchObject({ step: 5, action: 'build' });
    s.live.builds[1] = buildWire(1, 'a', 'kopi.example', 1, { status: 'work' });
    expect(nextStart(s)).toMatchObject({ state: 'working', action: 'preview' });
    s.live.builds[1]!.status = 'ready';
    expect(nextStart(s)).toMatchObject({ state: 'complete', action: 'preview' });
    expect(s.live.ints.cf).toBeUndefined();
  });
  it('does not reuse deleted sites, changed domains, or another site’s progress', () => {
    const s = state();
    s.live.reqs[1] = req(1, { domain: 'old.example', status: 'done' });
    s.live.arts[5] = serverArticle(5, { domain: 'old.example', status: 'approved' });
    s.live.builds[1] = buildWire(1, 'a', 'old.example', 1);
    expect(nextStart(s).action).toBe('research');
    s.sites.push({ ...s.sites[0]!, id: 'b', domain: 'teh.example' });
    s.live.reqs[2] = req(2, { domain: 'kopi.example', status: 'done' });
    s.siteFilter = 'b';
    expect(nextStart(s)).toMatchObject({ action: 'research', siteId: 'b' });
    expect(startProgress(s)).toEqual([true, true, false, false, false, false]);
  });
  it('keeps review and preview available when the API connection is lost', () => {
    const s = state(); s.live.engine = null;
    s.live.arts[5] = serverArticle(5, { domain: 'kopi.example', status: 'review' });
    expect(nextStart(s).action).toBe('review');
    expect(startProgress(s)[0]).toBe(false);
    s.live.builds[1] = buildWire(1, 'a', 'kopi.example', 1);
    expect(nextStart(s).action).toBe('preview');
    expect(startProgress(s)[0]).toBe(false);
  });
  it('shows actionable job failures instead of inviting duplicate work', () => {
    const s = state(); s.live.reqs[1] = req(1, { domain: 'kopi.example', status: 'failed', error: 'Rate limit reached.' });
    expect(nextStart(s)).toMatchObject({ state: 'failed', action: 'result', body: 'Rate limit reached.', requestId: 1 });
    s.live.arts[5] = serverArticle(5, { domain: 'kopi.example', status: 'failed', error: 'Writing stopped.' });
    expect(nextStart(s)).toMatchObject({ state: 'failed', action: 'review', body: 'Writing stopped.' });
    s.live.builds[1] = buildWire(1, 'a', 'kopi.example', 1, { status: 'failed', error: 'Build stopped.' });
    expect(nextStart(s)).toMatchObject({ state: 'failed', action: 'preview', body: 'Build stopped.' });
  });
  it('does not direct a new user to send a job to a paused site or a missing Keyword agent', () => {
    const s = state(); s.sites[0]!.status = 'paused';
    expect(nextStart(s).action).toBe('sites');
    s.sites[0]!.status = 'build';
    s.agents = s.agents.filter(a => a.id !== 'kw');
    expect(nextStart(s).action).toBe('team');
  });
  it('does not mark a pruned build as a usable preview', () => {
    const s = state(); s.live.builds[1] = buildWire(1, 'a', 'kopi.example', 1, { pruned: true });
    expect(nextStart(s).action).toBe('research');
    expect(startProgress(s)[5]).toBe(false);
  });
});

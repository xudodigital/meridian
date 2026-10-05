// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { SeoTasks } from './SeoTasks';
import { useStore } from '@/store/store';
import { resetStore, makeState, meFor } from '@/store/testing';
import { liveApply } from '@/store/liveApply';
import type { SeoTaskWire } from '../../../../shared/seo-tasks';
let root: Root;
const task: SeoTaskWire = { id: 10, siteId: 'a', domain: 'domain-a.example', kind: 'strategy', agent: 'res', brief: 'Readers and goals', status: 'done', result: { summary: 'A draft strategy', findings: [], actions: [], sources: [], limitations: ['Check original value.'], links: [], visual: null }, error: '', context: '', createdAt: 1, startedAt: 2, finishedAt: 3, tokens: 100, costUsd: 0.01, serviceCostUsd: 0, reviewedAt: null, reviewedBy: '' };
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia; window.Element.prototype.scrollIntoView = () => {}; });
beforeEach(() => {
  resetStore(false); useStore.getState().signIn(meFor('admin'));
  const site = makeState().sites[0]!;
  useStore.setState(d => { d.sites = [site]; d.live.on = true; d.live.ready = true; d.live.engine = { mode: 'openai-api', ready: true, keyConfigured: true, apiVersion: '', reason: '' }; });
  document.body.innerHTML = '<div id="test-root"></div>'; root = createRoot(document.getElementById('test-root')!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
const mount = () => act(async () => root.render(<SeoTasks />));
it('starts with a focused strategy and never queues paid work by mounting', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await mount();
  expect(document.querySelector('textarea')?.placeholder).toContain('Audience');
  expect((document.querySelector('button.filled') as HTMLButtonElement).disabled).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  expect((document.querySelector('details.more') as HTMLDetailsElement).open).toBe(false);
});
it('shows a completed draft with evidence fetched only when requested, and reviews without applying edits', async () => {
  useStore.setState(d => { d.live.seoTasks = { 10: task }; });
  const fetcher = vi.fn(async (path: string, _init?: RequestInit) => new Response(JSON.stringify({ task: path.endsWith('/review') ? { ...task, reviewedAt: 4, reviewedBy: 'Editor' } : { ...task, context: '{"coverage":"cached data"}' } }), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher); await mount(); expect(fetcher).not.toHaveBeenCalled();
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
  await act(async () => buttons().find(b => b.textContent === 'Load saved evidence')!.click());
  expect(document.querySelector('pre')?.textContent).toContain('cached data');
  await act(async () => buttons().find(b => b.textContent === 'I have reviewed this draft')!.click());
  expect(fetcher.mock.calls.map(c => c[0])).toEqual(['/api/seo-tasks/10', '/api/seo-tasks/10/review']);
  expect(useStore.getState().live.arts).toEqual({});
  expect(document.body.textContent).toContain('Reviewed by Editor');
});
it('does not offer mutation to a viewer and drives a specialist from actual job status', async () => {
  useStore.setState(d => { d.session = { ...d.session!, role: 'viewer' }; d.live.seoTasks = { 10: { ...task, status: 'work', finishedAt: null } }; liveApply(d); });
  expect(useStore.getState().agents.find(a => a.id === 'res')?.status).toBe('work');
  await mount(); expect((document.querySelector('button.filled') as HTMLButtonElement).disabled).toBe(true);
  useStore.setState(d => { d.live.seoTasks![10] = { ...task, startedAt: Date.now() - 10_000, finishedAt: Date.now() }; liveApply(d, Date.now() + 20_000); });
  expect(useStore.getState().jobLog.filter(j => j.agent === 'Research')).toHaveLength(1);
  useStore.setState(d => liveApply(d, Date.now() + 30_000));
  expect(useStore.getState().jobLog.filter(j => j.agent === 'Research')).toHaveLength(1);
});

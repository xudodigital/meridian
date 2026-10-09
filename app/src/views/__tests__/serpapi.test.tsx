// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi } from '@/store/fakeApi';
import { useStore } from '@/store/store';
import { liveApply } from '@/store/liveApply';
import { makeState, meFor, resetStore } from '@/store/testing';
import type { IntegrationWire } from '@/store/types';
import type { SeoTaskWire } from '../../../../shared/seo-tasks';
import { Integrations } from '../Integrations';
import { SeoTasks } from '../research/SeoTasks';

let root: Root, api: FakeApi;
const service: IntegrationWire = { id: 'serpapi', name: 'SerpApi', connected: false, tail: '', status: '', msg: '', testedAt: null, updatedAt: null, updatedBy: '', config: {}, fields: [{ k: 'key', label: 'API key', secret: true }], oauth: false, worksWithout: '', help: 'Test checks remaining searches without consuming search credits.' };
const t: SeoTaskWire = { id: 1, siteId: 'a', domain: 'test.example', kind: 'serp', serpProvider: 'serpapi', engine: 'gemma-local', agent: 'res', brief: 'coffee', status: 'done', result: { summary: 'Saved evidence', findings: [], actions: [], limitations: ['No volume data.'], sources: [], links: [], visual: null }, error: '', createdAt: 1, startedAt: 1, finishedAt: 2, tokens: 100, costUsd: 0, serviceCostUsd: 0, reviewedAt: null, reviewedBy: '', context: '' };
const mount = async (node: ReactNode) => { await act(async () => root.render(node)); };
const click = async (node: Element) => { await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); };
const runButton = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Run this task'))!;
const provider = () => [...document.querySelectorAll<HTMLSelectElement>('select')].find(s => s.parentElement?.querySelector('button')?.getAttribute('aria-label')?.startsWith('SERP provider:'))!;
const chooseProvider = async (value: string) => { await act(async () => { provider().value = value; provider().dispatchEvent(new Event('change', { bubbles: true })); }); };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  resetStore(false); useStore.getState().signIn(meFor('admin'));
  useStore.setState(d => { d.sync.loaded = true; d.live.on = d.live.ready = true; d.live.engine = { mode: 'gemma-local', ready: true, keyConfigured: false, model: 'gemma4:31b', apiVersion: 'Ollama', reason: '' }; d.live.ints.serpapi = { ...service }; d.live.ints.searchapi = { ...service, id: 'searchapi', name: 'SearchAPI.io' }; d.sites = [{ ...makeState().sites[0], id: 'a', domain: 'test.example', country: 'Malaysia', cc: 'MY', lang: 'English' }]; });
  api = new FakeApi(); vi.stubGlobal('fetch', api.fetch);
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('SerpApi dashboard', () => {
  it('drives the Research avatar with the server step and records its real history', () => {
    const startedAt = Date.now() - 60_000;
    const step = 'Reading the SerpApi SERP snapshot';
    useStore.setState(d => { d.live.seoTasks = { 1: { ...t, status: 'work', result: null, startedAt, finishedAt: null, step, steps: [{ at: startedAt, text: step }] } }; liveApply(d); });
    expect(useStore.getState().agents.find(a => a.id === 'res')).toMatchObject({ status: 'work', task: 'coffee', run: { step } });
    useStore.setState(d => { d.live.seoTasks![1] = { ...t, startedAt, finishedAt: Date.now(), steps: [{ at: startedAt, text: step }, { at: Date.now(), text: 'Saved a draft for human review' }] }; liveApply(d); });
    expect(useStore.getState().jobLog[0].steps).toContain(step);
  });
  it('offers an encrypted key form while retaining Gemma, Codex and DataForSEO', async () => {
    await mount(<Integrations />);
    const card = [...document.querySelectorAll('.int')].find(c => c.querySelector('h3')?.textContent === 'SerpApi')!;
    expect(card.textContent).toContain('Not connected'); await click(card.querySelector('button')!);
    expect(document.querySelector('#svc-serpapi-key')?.getAttribute('type')).toBe('password');
    expect(document.body.textContent).toContain('without consuming search credits');
    expect(document.body.textContent).toContain('DataForSEO'); expect(document.body.textContent).toContain('Gemma localhost');
    expect(useStore.getState().live.engine?.mode).toBe('gemma-local');
  });
  it('connects SearchAPI.io separately and selects it when SerpApi is unavailable', async () => {
    await mount(<Integrations />);
    const card = [...document.querySelectorAll('.int')].find(c => c.querySelector('h3')?.textContent === 'SearchAPI.io')!;
    await click(card.querySelector('button')!);
    expect(document.querySelector('#svc-searchapi-key')?.getAttribute('type')).toBe('password');
    await act(async () => useStore.setState(d => { d.live.ints.searchapi.connected = true; d.live.ints.searchapi.status = 'ok'; }));
    api.on('POST', '/api/seo-tasks', () => ({ task: { ...t, serpProvider: 'searchapi' } }));
    await mount(<SeoTasks initialKind="serp" />);
    expect(provider().selectedOptions[0].textContent).toContain('SearchAPI.io');
    await chooseProvider('searchapi');
    const brief = document.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(brief, 'coffee'); brief.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(runButton().disabled).toBe(false); await click(runButton());
    expect(api.to('POST', '/api/seo-tasks')[0].body).toMatchObject({ serpProvider: 'searchapi' });
    expect(useStore.getState().live.engine?.mode).toBe('gemma-local');
  });
  it('blocks research without a provider and preserves an explicit unavailable selection', async () => {
    await mount(<SeoTasks initialKind="serp" />);
    expect(document.body.textContent).toContain('Connect SerpApi, SearchAPI.io or DataForSEO');
    expect(runButton().disabled).toBe(true);
    await act(async () => useStore.setState(d => { d.live.ints.serpapi.connected = true; d.live.ints.serpapi.status = 'ok'; }));
    expect(provider().selectedOptions[0].textContent).toContain('SerpApi');
    await chooseProvider('dfs'); expect(document.body.textContent).toContain('Connect DataForSEO'); expect(runButton().disabled).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
  it('submits the selected provider with a local engine and discloses missing keyword volumes', async () => {
    useStore.setState(d => { d.live.ints.serpapi.connected = true; d.live.ints.serpapi.status = 'ok'; });
    api.on('POST', '/api/seo-tasks', () => ({ task: t }));
    await mount(<SeoTasks initialKind="serp" />); await chooseProvider('serpapi');
    const brief = document.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(brief, 'coffee'); brief.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(runButton().disabled).toBe(false); await click(runButton());
    expect(api.to('POST', '/api/seo-tasks')[0].body).toMatchObject({ siteId: 'a', kind: 'serp', brief: 'coffee', serpProvider: 'serpapi' });
    expect(document.body.textContent).toContain('Keyword volume is separate');
    expect(document.body.textContent).toContain('gemma4:31b'); expect(document.body.textContent).not.toContain('$');
  });
  it('labels historical evidence with its provider without attributing unknown SerpApi costs to DataForSEO', async () => {
    useStore.setState(d => { d.live.engine!.mode = 'openai-api'; d.live.seoTasks = { 1: { ...t, engine: 'openai-api' } }; });
    await mount(<SeoTasks initialKind="serp" />);
    const result = document.querySelector('.seo-task-result')!;
    expect(result.textContent).toContain('SerpApi'); expect(result.textContent).not.toContain('DataForSEO $');
    expect(result.textContent).toContain('No volume data.');
  });
});

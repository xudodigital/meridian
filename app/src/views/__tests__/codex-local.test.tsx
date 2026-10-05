// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi } from '@/store/fakeApi';
import { engineReady, keyOK, setupSteps } from '@/store/rules';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { EngineStatus } from '@/store/types';
import { AgentGrid } from '../skills/AgentGrid';
import { executionModel } from '../skills/model';
import { Integrations } from '../Integrations';
import { History } from '../History';
import { StartGuide } from '../workspace/StartGuide';
import { nextStart } from '../workspace/start';

let root: Root, api: FakeApi;
const st = () => useStore.getState();
const local: EngineStatus = { mode: 'codex-local', ready: true, keyConfigured: false, apiVersion: 'Codex 0.160.0', model: 'gpt-6.1-sol', reason: '' };
const mount = async (view: React.ReactNode) => { await act(async () => { root.render(view); }); };
const $ = <T extends Element = HTMLElement>(q: string) => document.querySelector<T>(q);
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = q => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  window.Element.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});
beforeEach(() => {
  resetStore(false); st().signIn(meFor('admin'));
  useStore.setState(d => { d.sync.loaded = true; d.live.on = d.live.ready = true; d.live.engine = local; });
  api = new FakeApi(); vi.stubGlobal('fetch', api.fetch);
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
describe('Codex local runtime without an API key', () => {
  it('unlocks jobs and setup only when the local runtime is ready', () => {
    expect(engineReady(st())).toBe(true);
    expect(keyOK(st(), st().agents.find(a => a.id === 'kw')!)).toBe(true);
    expect(setupSteps(st())[0]).toMatchObject({ done: true, title: 'Connect Codex local' });
    expect(nextStart(st())).toMatchObject({ action: 'site' });
    useStore.setState(d => { d.live.engine = { ...local, ready: false, reason: 'Codex is signed out.' }; });
    expect(engineReady(st())).toBe(false);
    expect(keyOK(st(), st().agents.find(a => a.id === 'kw')!)).toBe(false);
    expect(nextStart(st())).toMatchObject({ action: 'connect', body: 'Codex is signed out.' });
  });
  it('starts at the site and discloses ChatGPT limits without an API billing step', async () => {
    await mount(<StartGuide />);
    expect($('.start-now h3')?.textContent).toBe('Add the site you want to work on');
    expect($('.start-path li')?.textContent).toContain('Connect Codex local');
    expect($('.start-key-help')).toBeNull();
    expect($('.start-later')?.textContent).toContain('ChatGPT usage limits');
    expect(api.calls).toHaveLength(0);
  });
  it('recovers a signed-out local runtime by checking it rather than opening an API key form', async () => {
    useStore.setState(d => { d.live.engine = { ...local, ready: false, reason: 'Codex is signed out.' }; });
    api.on('POST', '/api/engine/refresh', () => ({ engine: local }));
    await mount(<StartGuide />);
    await act(async () => { $('.start-now button')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(api.to('POST', '/api/engine/refresh')).toHaveLength(1);
    expect($('dialog[open]')).toBeNull();
    expect($('.start-now h3')?.textContent).toBe('Add the site you want to work on');
  });
  it('shows the actual runtime model and keeps API choices from implying execution or dollar rates', async () => {
    expect(executionModel(st(), st().agents.find(a => a.id === 'kw')!)).toMatchObject({ label: 'Codex local · gpt-6.1-sol' });
    await mount(<AgentGrid />);
    const card = $('[data-agent="kw"]');
    expect(card?.textContent).toContain('gpt-6.1-sol');
    expect(card?.textContent).not.toContain('per 1M tokens');
    expect(card?.querySelector('select')).toBeNull();
    expect(card?.textContent).not.toContain('Needs the');
  });
  it('labels API integrations optional and does not mislabel Codex as a ready API connection', async () => {
    await mount(<Integrations />);
    expect(document.body.textContent).toContain('Codex on this computer');
    expect(document.body.textContent).toContain('OpenAI API (optional)');
    expect(document.body.textContent).not.toContain('OpenAI ready');
  });
  it('keeps historical API cost while showing a Codex run as subscription usage', async () => {
    useStore.setState(d => { d.jobLog = [
      { id: 1, t: new Date(), agent: 'Keyword', hue: 0, task: 'Local research', site: null, dur: 1, tokens: 500, cost: 0, engine: 'codex-local', status: 'Done', steps: [] },
      { id: 2, t: new Date(), agent: 'Keyword', hue: 0, task: 'Earlier API research', site: null, dur: 1, tokens: 500, cost: 0.12, engine: 'openai-api', status: 'Done', steps: [] },
    ]; });
    await mount(<History />);
    expect(document.body.textContent).toContain('ChatGPT limits');
    expect(document.body.textContent).toContain('$0.12');
    expect(document.body.textContent).not.toContain('$0.00');
  });
});

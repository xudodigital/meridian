// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi } from '@/store/fakeApi';
import { req } from '@/store/liveAgentFixtures';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { IntegrationWire, Role } from '@/store/types';
import { Workspace } from '../Workspace';
import { StartGuide } from '../workspace/StartGuide';

let root: Root, api: FakeApi;
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const st = () => useStore.getState();
const ready = { mode: 'openai-api' as const, keyConfigured: true, apiVersion: 'Responses API', ready: true, reason: '' };
const openai: IntegrationWire = { id: 'openai', name: 'OpenAI API', connected: false, status: '', tail: '', msg: '', testedAt: null, updatedAt: null, updatedBy: '', config: {}, fields: [{ k: 'key', label: 'API key', secret: true }], oauth: false, worksWithout: '', help: '' };
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const type = async (selector: string, value: string) => { await act(async () => { const el = $<HTMLInputElement>(selector); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value); el?.dispatchEvent(new window.Event('input', { bubbles: true })); }); };
const submit = async () => { await act(async () => { $('dialog[open] form')?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); };
const mount = async (workspace = false) => { await act(async () => { root.render(workspace ? <Workspace /> : <StartGuide />); }); };
const role = (r: Role) => act(async () => { st().signIn(meFor(r)); });
const addSite = () => act(async () => { st().addSite({ domain: 'kopi.example', country: 0, lang: 'Vietnamese', topic: 'Coffee', status: 'build' }); });
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = q => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  window.Element.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});
beforeEach(() => {
  resetStore(false); st().signIn(meFor('admin'));
  useStore.setState(d => { d.sync.loaded = true; d.live.on = d.live.ready = true; d.live.engine = { mode: 'none', keyConfigured: false, apiVersion: '', ready: false, reason: 'Add your API key.' }; d.live.ints.openai = openai; });
  api = new FakeApi(); vi.stubGlobal('fetch', api.fetch);
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => { root.unmount(); }); vi.unstubAllGlobals(); });

describe('a guided first job without automatic paid work', () => {
  it('puts one primary next action first and collapses office, planned agents and optional setup', async () => {
    await mount(true);
    expect($('.start-now h3')?.textContent).toBe('Connect OpenAI to power your agents');
    expect(document.querySelectorAll('.start-guide button.filled')).toHaveLength(1);
    expect($<HTMLDetailsElement>('.starter-monitor')?.open).toBe(false);
    expect($('#planned')).toBeNull();
    expect($<HTMLDetailsElement>('.start-later')?.open).toBe(false);
    expect($('.kpis, #setup, .journey-home')).toBeNull();
    expect(api.calls).toHaveLength(0);
  });
  it('saves and tests OpenAI in place, advances to adding the site, and does not submit a job', async () => {
    api.on('PUT', '/api/integrations/openai', () => ({ result: { status: 'ok', msg: 'Connected.' }, integration: { ...openai, connected: true, status: 'ok', tail: 'test', updatedAt: 1 } }));
    api.on('POST', '/api/engine/refresh', () => ({ engine: ready }));
    await mount(); await click($('.start-now button'));
    expect($('dialog[open] h2')?.textContent).toBe('Connect OpenAI API');
    await type('#svc-openai-key', 'sk-fixture-only-key'); await submit();
    expect($('dialog[open]')).toBeNull();
    expect($('.start-now h3')?.textContent).toBe('Add the site you want to work on');
    expect(api.to('POST', '/api/requests')).toHaveLength(0);
    expect(st().live.engine?.mode).toBe('openai-api');
  });
  it('keeps a failed connection on screen with its reason and does not tick it as done', async () => {
    api.on('PUT', '/api/integrations/openai', () => ({ result: { status: 'bad', msg: 'The API key is invalid.' }, integration: { ...openai, connected: true, status: 'bad', msg: 'The API key is invalid.', updatedAt: 1 } }));
    await mount(); await click($('.start-now button'));
    await type('#svc-openai-key', 'sk-fixture-only-key'); await submit();
    expect($('dialog[open] .err')?.textContent).toBe('The API key is invalid.');
    expect($('.start-path li')?.getAttribute('data-state')).toBe('current');
    expect(api.to('POST', '/api/engine/refresh')).toHaveLength(0);
  });
  it('adds a site in place, explains local preparation, then offers research rather than adding agents', async () => {
    useStore.setState(d => { d.live.engine = ready; });
    await mount(); await click($('.start-now button'));
    expect($('dialog[open]')?.textContent).toContain('Domain purchase, DNS and publication are separate.');
    expect($<HTMLSelectElement>('#sdCountry')?.value).toBe('');
    await act(async () => { const el = $<HTMLSelectElement>('#sdCountry')!; el.value = '0'; el.dispatchEvent(new window.Event('change', { bubbles: true })); });
    await type('#sdDomain', 'kopi.example'); await type('#sdTopic', 'Coffee'); await submit();
    expect($('dialog[open]')).toBeNull();
    expect(st().sites).toHaveLength(1);
    expect($('.start-now button')?.textContent).toContain('Start your first research');
    expect(st().agents).toHaveLength(11);
    expect(api.to('POST', '/api/requests')).toHaveLength(0);
  });
  it('discloses the cost before submission and immediately follows the acknowledged request without SSE', async () => {
    useStore.setState(d => { d.live.engine = ready; }); await addSite(); const site = st().sites[0]!;
    api.on('POST', '/api/requests', () => ({ request: req(8, { siteId: site.id, domain: site.domain, status: 'queued', step: '', topic: 'cold brew' }) }));
    await mount(); await click($('.start-now button'));
    expect($('dialog[open]')?.textContent).toContain('uses your OpenAI API balance');
    expect($('dialog[open]')?.textContent).toContain('GPT-6 Luna');
    expect(api.to('POST', '/api/requests')).toHaveLength(0);
    await type('#krTopic', 'cold brew'); await submit();
    expect(api.to('POST', '/api/requests')).toHaveLength(1);
    expect($('dialog[open]')).toBeNull();
    expect($('.start-now h3')?.textContent).toBe('Your keyword research is on its way');
    expect($('.start-now button')?.textContent).toContain('View research progress');
  });
  it('does not replace a newer SSE state with the older POST acknowledgment', async () => {
    useStore.setState(d => { d.live.engine = ready; }); await addSite(); const site = st().sites[0]!;
    api.on('POST', '/api/requests', () => {
      useStore.setState(d => { d.live.reqs[8] = req(8, { siteId: site.id, domain: site.domain, status: 'done' }); });
      return { request: req(8, { siteId: site.id, domain: site.domain, status: 'queued' }) };
    });
    await mount(); await click($('.start-now button')); await type('#krTopic', 'cold brew'); await submit();
    expect(st().live.reqs[8]?.status).toBe('done');
    expect($('.start-now h3')?.textContent).toBe('Choose one keyword for your first article');
  });
  it('loads server facts before enabling a paid action', async () => {
    useStore.setState(d => { d.live.ready = false; }); await mount();
    expect($('.start-now h3')?.textContent).toBe('Checking your workspace…');
    expect($<HTMLButtonElement>('.start-now button')?.disabled).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
  it.each(['editor', 'viewer'] as const)('explains the admin prerequisite to a %s without offering API key changes', async r => {
    await role(r); await mount();
    await act(async () => { useStore.setState(d => { d.live.on = d.live.ready = true; }); });
    expect($<HTMLButtonElement>('.start-now button')?.disabled).toBe(true);
    expect($('.start-permission')?.textContent).toContain('Ask an admin to connect OpenAI');
    expect($('button.filled')?.textContent).toContain('Connect OpenAI');
    expect(api.calls).toHaveLength(0);
  });
});

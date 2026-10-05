// @vitest-environment jsdom
/* The Office page (/office) through the whole app against a fake server (store/fakeApi.ts): it passes the same gates as
   the rest of the app, shows the office without the side navigation and the top bar, sends a role that cannot see the
   Workspace to its home view, and "Open dashboard" goes back to the Workspace in the same tab, leaving full screen.
   jsdom has no Fullscreen API: requestFullscreen, exitFullscreen and fullscreenElement are stand-ins. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, emptyWorkspace } from './store/fakeApi';
import type { Me } from './store/types';

let fsEl: Element | null = null;
const requested: Element[] = [];
let exits = 0;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.scrollTo = () => {};
  window.Element.prototype.scrollIntoView = () => {};
  window.HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
  window.Element.prototype.requestFullscreen = async function (this: Element) { requested.push(this); fsEl = this; document.dispatchEvent(new window.Event('fullscreenchange')); };
  document.exitFullscreen = async () => { exits++; fsEl = null; document.dispatchEvent(new window.Event('fullscreenchange')); };
});
afterAll(() => {
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  delete (window.Element.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  delete (document as { exitFullscreen?: unknown }).exitFullscreen;
});

/* The first import transforms the whole app, which takes seconds: do it once here, outside the tests' time limit. */
beforeAll(async () => { await import('./App'); }, 60_000);

const me = (over: Partial<Me> = {}): Me => ({ id: '1', name: 'Dana Owner', email: 'owner@example.com', role: 'admin', site: null, created: 1, disabled: false, twofa: false, mustEnroll: false, ...over });
const ENGINE = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.0', ready: true, reason: '' };
const PASSWORD = 'correct horse battery staple';

let root: Root | null = null;
let api: FakeApi;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const text = () => document.body.textContent ?? '';
const settle = async (ms = 30) => {
  const { router } = await import('./router');
  const end = Date.now() + 10_000;
  do {
    await act(async () => { await new Promise(r => setTimeout(r, ms)); });
    if (!router.state.isLoading && !router.state.matches.some(m => m.status === 'pending')) return;
  } while (Date.now() < end);
  throw new Error('Lazy route did not finish loading');
};
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); }); await settle(); };
const key = async (k: string) => { await act(async () => { document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }); await settle(); };
const type = async (sel: string, value: string) => {
  const el = $<HTMLInputElement>(sel);
  expect(el, sel).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const submit = async (form: Element | null) => { expect(form).not.toBeNull(); await act(async () => { form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); await settle(); };
async function until(what: string, ok: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('Timed out waiting for ' + what + '. Page: ' + text().slice(0, 300)); await settle(10); }
}

/** A server with an empty workspace; tests add or change routes. */
function server(status: { setup: boolean; me: Me | null }) {
  return new FakeApi()
    .on('GET', '/api/auth/status', () => status)
    .on('GET', '/api/workspace', () => emptyWorkspace())
    .on('GET', '/api/state', () => ({ engine: ENGINE, requests: [], articles: [] }))
    .on('POST', '/api/auth/touch', () => ({ ok: true }))
    .on('POST', '/api/auth/sign-out', () => ({ ok: true }));
}
/** A fresh page load at `path`. */
async function load(path: string): Promise<void> {
  vi.resetModules();
  history.replaceState(null, '', path);
  vi.stubGlobal('fetch', api.fetch);
  const { App } = await import('./App');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(<App />); });
  await settle();
}

beforeEach(() => { localStorage.clear(); fsEl = null; requested.length = 0; exits = 0; });
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  vi.unstubAllGlobals();
});

describe('the Office page', () => {
  it('shows the office on its own, without the side navigation or the top bar', async () => {
    api = server({ setup: false, me: me() });
    await load('/office');
    await until('the office', () => !!$('.od'));
    expect(location.pathname).toBe('/office');
    expect(document.title).toBe('Office · Meridian');
    expect([$('.app'), $('#side'), $('#top'), $('#title')]).toEqual([null, null, null, null]);
    expect($('.od h1')?.textContent).toBe('Office');
    expect($('.od-eyebrow')?.textContent).toBe('Meridian');
    /* Outside demo mode only the agents that run jobs (and the Orchestrator, the workflow engine) have a desk; the planned ones are not drawn idling. */
    expect($$('.od .office.big .stn')).toHaveLength(11);
    expect($$('.od-sum li').map(li => li.textContent)).toEqual(['bolt0 working now', 'front_hand0 needs approval', 'coffee11 idle']);
    expect($('.od-tick h2')?.textContent).toBe('Latest activity');
    expect($('.od-tick li')?.textContent).toBe('No activity yet.');
    expect($('.od a[href="/workspace"]')?.textContent).toBe('dashboardOpen dashboard');
    expect($$('.od-acts button').map(b => b.textContent)).toEqual(['fullscreenFull screen']);
  });

  it('asks a signed-out person to sign in first, then shows the office they asked for', async () => {
    api = server({ setup: false, me: null }).on('POST', '/api/auth/sign-in', () => ({ me: me() }));
    await load('/office');
    expect($('.lform h1')?.textContent).toBe('Sign in');
    expect($('.od')).toBeNull();
    await type('#lgEmail', 'owner@example.com');
    await type('#lgPass', PASSWORD);
    await submit($('form.lform'));
    await until('the office', () => !!$('.od'));
    expect(location.pathname).toBe('/office');
    expect($('.app')).toBeNull();
  });

  it('sends a native reviewer, who cannot see the Workspace, to Article review', async () => {
    api = server({ setup: false, me: me({ id: '5', name: 'Linh Tran', email: 'linh@example.com', role: 'reviewer', site: 's1' }) });
    await load('/office');
    await until('Article review', () => $('#title')?.textContent === 'Article review');
    expect(location.pathname).toBe('/review');
    expect($('.od')).toBeNull();
  });

  it('goes back to the Workspace in the same tab, and leaves full screen on the way', async () => {
    api = server({ setup: false, me: me() });
    await load('/office');
    await until('the office', () => !!$('.od'));
    await key('f');
    expect(requested).toEqual([document.documentElement]);
    expect($('.od')?.dataset.full).toBe('1');
    await click($('.od a[href="/workspace"]'));
    await until('the Workspace', () => $('#title')?.textContent === 'Workspace');
    expect(location.pathname).toBe('/workspace');
    expect($('.od')).toBeNull();
    expect(exits).toBe(1);
    expect(fsEl).toBeNull();
    expect(document.title).toBe('Workspace · Meridian');
  });
});

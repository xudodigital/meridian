// @vitest-environment jsdom
/* The event stream's health (live.ts): a stream that goes silent is reopened, a reconnect and a tab that was hidden
   for long catch up with the server (state snapshot and workspace), so a second tab or a TV never drifts from the
   dashboard. jsdom has no EventSource: a stand-in records the streams the page opens and lets the test fire events. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverArticle } from './articleFixtures';
import { FakeApi, emptyWorkspace } from './fakeApi';
import { queryClient, STREAM_SILENT_MS, useLiveMode } from './live';
import { useStore } from './store';
import { meFor, resetStore } from './testing';
import type { EngineStatus } from './types';

class FakeEventSource {
  static all: FakeEventSource[] = [];
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
  readyState = 1;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  constructor(public url: string) { FakeEventSource.all.push(this); }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
  close() { this.closed = true; this.readyState = 2; }
  /** Fires an event as the server would send it. */
  emit(name: string, data: unknown = {}) { for (const fn of this.listeners.get(name) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent<string>); }
}

const engine: EngineStatus = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.0', ready: true, reason: '' };
let api: FakeApi;
let root: Root | null = null;
let stateCalls = 0;
let articles = [serverArticle(1)];

function Host() { useLiveMode(); return null; }
const mount = async () => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(<QueryClientProvider client={queryClient}><Host /></QueryClientProvider>); });
};
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const stream = () => FakeEventSource.all.at(-1)!;

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.all = [];
  stateCalls = 0;
  articles = [serverArticle(1)];
  api = new FakeApi()
    .on('GET', '/api/state', () => { stateCalls++; return { engine, requests: [], articles }; })
    .on('GET', '/api/workspace', () => emptyWorkspace())
    .on('GET', '/api/integrations', () => ({ integrations: [], redirectUri: '' }));
  vi.stubGlobal('fetch', api.fetch);
  resetStore(false);
  useStore.getState().signIn(meFor('admin'));
  useStore.setState(d => { d.sync = { loaded: true, error: '' }; });
});
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the event stream', () => {
  it('opens once and applies the first snapshot', async () => {
    await mount(); await flush();
    expect(FakeEventSource.all).toHaveLength(1);
    expect(stream().url).toBe('/api/events');
    expect(stateCalls).toBe(1);
    expect(useStore.getState().live.on).toBe(true);
    expect(useStore.getState().live.arts[1]?.status).toBe('review');
  });

  it('is reopened, and the state fetched again, when no event or ping arrives for too long', async () => {
    await mount(); await flush();
    stream().emit('open');
    /* Pings keep it alive. */
    for (let i = 0; i < 4; i++) { await act(async () => { await vi.advanceTimersByTimeAsync(25_000); }); stream().emit('ping', { t: 1 }); }
    expect(FakeEventSource.all).toHaveLength(1);
    expect(stateCalls).toBe(1);
    /* Silence: the first stream is closed and a new one opened; the snapshot is fetched again and applied. */
    articles = [serverArticle(1, { status: 'approved' }), serverArticle(2, { keyword: 'robusta' })];
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_SILENT_MS + 10_000); });
    expect(FakeEventSource.all).toHaveLength(2);
    expect(FakeEventSource.all[0]?.closed).toBe(true);
    expect(stateCalls).toBe(2);
    expect(useStore.getState().live.arts[1]?.status).toBe('approved');
    expect(useStore.getState().live.arts[2]?.keyword).toBe('robusta');
  });

  it('catches up after a reconnect (events in between were lost)', async () => {
    await mount(); await flush();
    stream().emit('open');
    expect(stateCalls).toBe(1);
    articles = [];
    /* The browser reconnected by itself: a second "open" on the same stream. */
    stream().emit('open');
    await flush();
    expect(stateCalls).toBe(2);
    expect(useStore.getState().live.arts[1]).toBeUndefined();
    expect(api.to('GET', '/api/workspace').length).toBeGreaterThanOrEqual(1);
  });

  it('catches up when the tab is shown again after a long time hidden, but not after a short one', async () => {
    await mount(); await flush();
    stream().emit('open');
    const hide = (state: 'hidden' | 'visible') => { Object.defineProperty(document, 'visibilityState', { value: state, configurable: true }); document.dispatchEvent(new window.Event('visibilitychange')); };
    hide('hidden'); await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); hide('visible'); await flush();
    expect(stateCalls).toBe(1);
    hide('hidden'); stream().emit('ping', { t: 2 }); await act(async () => { await vi.advanceTimersByTimeAsync(70_000); }); stream().emit('ping', { t: 3 }); hide('visible'); await flush();
    expect(stateCalls).toBe(2);
  });
});

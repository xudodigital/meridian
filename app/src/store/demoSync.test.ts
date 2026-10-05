import { describe, it, expect, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { makeState } from './testing';
import type { AppStore } from './store';
import { startDemoSync } from './demoSync';
import { simTick } from './sim';
function harness() {
  let delayed = false; const queue: (() => void)[] = [];
  const listeners = new Set<(e: MessageEvent) => void>();
  const channel = () => {
    let own: (e: MessageEvent) => void;
    return {
      postMessage: (data: unknown) => { for (const listener of [...listeners]) if (listener !== own) { const event = { data: structuredClone(data) } as MessageEvent; if (delayed) queue.push(() => listener(event)); else listener(event); } },
      addEventListener: (_: string, listener: (e: MessageEvent) => void) => { own = listener; listeners.add(listener); },
      close: () => listeners.delete(own),
    };
  };
  let tail = Promise.resolve();
  const locks = { request: (_: string, options: { signal: AbortSignal }, callback: () => Promise<void>) => {
    const next = tail.then(() => options.signal.aborted ? undefined : callback());
    tail = next.catch(() => undefined); return next;
  } } as unknown as Pick<LockManager, 'request'>;
  const make = () => createStore<AppStore>(() => ({ ...makeState(), tick: vi.fn() }) as unknown as AppStore);
  return { channel, locks, make, delay: () => { delayed = true; }, deliver: () => { delayed = false; while (queue.length) queue.pop()!(); } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
describe('shared demo office', () => {
  it('hydrates new tabs, shares actions both ways and hands over the only clock', async () => {
    const h = harness(), a = h.make(), b = h.make();
    const first = startDemoSync(a, h.channel(), h.locks); await flush();
    a.setState({ agents: a.getState().agents.map(x => ({ ...x, status: 'idle' })) });
    const second = startDemoSync(b, h.channel(), h.locks); await flush();
    expect(b.getState().agents).toEqual(a.getState().agents);
    b.setState({ approvals: [] }); expect(a.getState().approvals).toEqual([]);
    first.tick(); second.tick();
    expect(a.getState().tick).toHaveBeenLastCalledWith(true);
    expect(b.getState().tick).toHaveBeenLastCalledWith(false);
    first.stop(); await flush(); second.tick();
    expect(b.getState().tick).toHaveBeenLastCalledWith(true);
    second.stop();
  });
  it('does not share sessions, live data or filters, or apply demo data in real mode', async () => {
    const h = harness(), a = h.make(), b = h.make(); b.setState({ siteFilter: 'b' });
    const first = startDemoSync(a, h.channel(), h.locks), second = startDemoSync(b, h.channel(), h.locks); await flush();
    const session = b.getState().session, live = b.getState().live;
    a.setState({ siteFilter: 'a', approvals: [] });
    expect(b.getState().siteFilter).toBe('b'); expect(b.getState().session).toBe(session); expect(b.getState().live).toBe(live);
    b.setState({ sample: false }); a.setState({ artN: 999 }); expect(b.getState().artN).not.toBe(999);
    first.stop(); second.stop();
  });
  it('keeps local checks without inventing work when coordination is unavailable', () => {
    const h = harness(), a = h.make(), sync = startDemoSync(a, null, undefined);
    sync.tick(); expect(a.getState().tick).toHaveBeenCalledWith(false); sync.stop();
  });
  it('converges after simultaneous changes and out-of-order messages', async () => {
    const h = harness(), a = h.make(), b = h.make();
    const first = startDemoSync(a, h.channel(), h.locks), second = startDemoSync(b, h.channel(), h.locks); await flush();
    h.delay(); a.setState({ artN: 101 }); b.setState({ artN: 202 }); h.deliver();
    expect(a.getState().artN).toBe(b.getState().artN);
    h.delay(); a.setState({ artN: 303 }); a.setState({ artN: 404 }); h.deliver();
    expect(b.getState().artN).toBe(404);
    first.stop(); second.stop();
  });
  it('a follower keeps idle sign-out without advancing its own random simulation', () => {
    const s = makeState(), agents = structuredClone(s.agents);
    simTick(s, { now: 100, lastActive: 100, rand: () => 0.5, demoClock: false });
    expect(s.agents).toEqual(agents);
    const result = simTick(s, { now: 1e12, lastActive: 0, rand: () => 0.5, demoClock: false });
    expect(result.signedOut).toBe(true);
  });

});

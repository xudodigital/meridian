/* Demo data stays in memory. Same-origin tabs share it without storing sessions, credentials or live data. */
import type { StoreApi } from 'zustand';
import type { AppStore } from './store';

export const demoKeys = ['sites', 'agents', 'approvals', 'articles', 'artN', 'log', 'jobLog', 'kwReqs',
  'deploys', 'notifs', 'uid', 'autoPub', 'handoff', 'settings', 'np', 'skills', 'mod', 'schedules'] as const;
type Snapshot = Pick<AppStore, typeof demoKeys[number]>;
type Stamp = [number, string];
type Versions = Partial<Record<typeof demoKeys[number], Stamp>>;
type Message = { type: 'hello' } | { type: 'state'; data: Partial<Snapshot>; versions: Versions };
interface Channel {
  postMessage(message: Message): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<Message>) => void): void;
  close(): void;
}

/** One Web Lock owns the demo clock; closing/signing out releases it to another tab.
 * Per-field logical versions make crossed messages converge without replacing local filters or sessions.
 * Followers still run their local idle-session check. Each user action publishes only changed domain fields.
 * Without browser coordination support the demo stays static instead of inventing divergent work. */
export function startDemoSync(store: StoreApi<AppStore>, channel: Channel | null,
  locks: Pick<LockManager, 'request'> | undefined): { tick: () => void; stop: () => void } {
  let applying = false, leader = false, stopped = false, clock = 0;
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, versions: Versions = {};
  const newer = (a: Stamp, b?: Stamp) => !b || a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  let pending: AbortController | undefined;
  let release: (() => void) | undefined;
  const eligible = () => { const s = store.getState(); return s.sample && !!s.session; };
  const send = (data: Partial<Snapshot>) => channel?.postMessage({ type: 'state', data, versions: Object.fromEntries(demoKeys.filter(k => Object.hasOwn(data, k)).map(k => [k, versions[k] ?? [0, '']])) });
  const snapshot = () => Object.fromEntries(demoKeys.map(k => [k, store.getState()[k]])) as Snapshot;
  const elect = () => {
    if (!eligible()) { pending?.abort(); pending = undefined; release?.(); release = undefined; leader = false; return; }
    if (pending || !channel || !locks || stopped) return;
    const controller = new AbortController(); pending = controller;
    channel.postMessage({ type: 'hello' });
    void locks.request('meridian-demo-clock-v1', { signal: controller.signal }, async () => {
      if (controller.signal.aborted || stopped || !eligible()) return;
      leader = true;
      send(snapshot());
      await new Promise<void>(resolve => { release = resolve; });
      leader = false;
    }).catch(() => { /* Aborted on mode/session change or browser shutdown. */ });
  };
  channel?.addEventListener('message', event => {
    if (stopped || !eligible()) return;
    if (event.data?.type === 'hello') { if (leader) send(snapshot()); return; }
    if (event.data?.type !== 'state' || !event.data.data || typeof event.data.data !== 'object') return;
    const data = event.data.data;
    const incoming = event.data.versions;
    if (!incoming) return;
    const accepted = demoKeys.filter(k => {
      const stamp = incoming[k];
      if (!Object.hasOwn(data, k) || !Array.isArray(stamp) || !Number.isFinite(stamp[0]) || typeof stamp[1] !== 'string') return false;
      clock = Math.max(clock, stamp[0]);
      if (!newer(stamp, versions[k])) return false;
      versions[k] = stamp; return true;
    });
    const patch = Object.fromEntries(accepted.map(k => [k, data[k]]));
    applying = true;
    try { store.setState(patch); } finally { applying = false; }
  });
  const unsubscribe = store.subscribe((s, previous) => {
    if (s.sample !== previous.sample || !!s.session !== !!previous.session) {
      for (const key of demoKeys) delete versions[key];
      elect();
    }
    if (applying || !s.sample || !s.session || !previous.sample || !previous.session) return;
    const changed = demoKeys.filter(k => s[k] !== previous[k]);
    if (changed.length) {
      clock++; for (const key of changed) versions[key] = [clock, id];
      send(Object.fromEntries(changed.map(k => [k, s[k]])));
    }
  });
  elect();
  return {
    tick: () => store.getState().tick(leader),
    stop: () => { stopped = true; unsubscribe(); pending?.abort(); release?.(); channel?.close(); },
  };
}

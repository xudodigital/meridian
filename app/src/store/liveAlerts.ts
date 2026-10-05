/* The server's own alerts for the bell: a domain blocked or down (from an access check), a site near or at its daily
   budget, the weekly report sent. The server keeps them (its `alerts` table) and leaves out the events whose "In-app"
   box in Settings > Alerts is off; this file loads them into store.live.alerts, and liveNotifs.ts turns them into
   notifications with the rest. They are loaded when the workspace is (sign-in, a reset, demo mode turned off) and
   again a moment after an event that can raise one (live.ts calls alertsSoon). Native reviewers and demo mode get none. */
import { liveNotifsTo } from './liveNotifs';
import { apiGet } from './serverApi';
import { useStore } from './store';
import type { AppState, BellAlertWire } from './types';

const wanted = (s: Pick<AppState, 'sample' | 'session'>): boolean => !s.sample && !!s.session && !s.session.enroll && s.session.role !== 'reviewer';

/** Loads the alerts and rebuilds the bell. A failure leaves the bell as it is; the next event tries again. */
export async function refreshAlerts(): Promise<void> {
  const before = useStore.getState();
  if (!wanted(before)) return;
  const sid = before.session?.id;
  try {
    const r = await apiGet<{ alerts: BellAlertWire[] }>('/api/notifications');
    useStore.setState(d => {
      if (!wanted(d) || d.session?.id !== sid || !Array.isArray(r.alerts)) return;
      d.live.alerts = r.alerts;
      liveNotifsTo(d);
    });
  } catch { /* an ended session is handled by the API layer */ }
}

/** How long after an event the alerts are fetched: the events of one job arrive together and need one fetch. */
export const ALERTS_DELAY_MS = 600;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Something happened that can raise an alert (an access check, a recorded run, a sent report): load them shortly. */
export function alertsSoon(ms: number = ALERTS_DELAY_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void refreshAlerts(); }, ms);
}

/* The workspace was just loaded for this person: their alerts come with it. */
useStore.subscribe((s, prev) => { if (s.sync.loaded && !prev.sync.loaded) void refreshAlerts(); });

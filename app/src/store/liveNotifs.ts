/* Notifications for real events on the server: finished and failed keyword research, articles written, revised or
   failed, website builds ready for approval or failed, failed deploys, and the alerts the server itself raises (a
   domain blocked or down, the daily budget, the weekly report sent: liveAlerts.ts loads them). They are derived from the server's state every time it is applied (liveApply), not raised when the page
   sees a change, so a reload or another browser on this computer shows the same events. Each event has a stable key
   (kind, server id and the event's time); re-applying the same state gives the same notifications, never duplicates.
   What the person has read is kept as a list of keys (state.notifRead, kept per person on the server by sync.ts); the texts
   are rebuilt from the server every time. */
import { ALIAS, isAliasId, isViewId } from './constants';
import { nextUid } from './draft';
import type { AccessWire, AliasId, AppState, Article, ArticleAction, BellAlertWire, BuildWire, Notification, NotifyEvent, PillKind, ServerArticle, ServerRequest, ViewId } from './types';

/** The bell shows at most this many notifications, newest first. */
export const NOTIF_MAX = 40;
/** Events older than this are shown as read: the bell does not ask for attention for them. */
export const NOTIF_FRESH_MS = 14 * 864e5;
/** Read keys kept in storage; older ones belong to events long gone from the bell. */
export const READ_KEYS_MAX = 300;

/** One notification derived from the server, before it gets an id and its read state. */
export interface LiveNotif {
  key: string;
  /** Time of the event (ms). */
  t: number;
  k: PillKind;
  icon: string;
  title: string;
  body: string;
  view: ViewId;
  /** The tab of that view to open (an alias id), when the event belongs to one tab. */
  to?: AliasId;
  /** Ties it to a Settings alert, so the In-app channel can switch it off. */
  ev?: NotifyEvent;
  /** The article to select in Article review. */
  art?: Article['id'];
  /** Something happened since (a decision, a retry): nothing left to do, so it is shown as read. */
  handled: boolean;
}

/** A finished or failed research request: one notification for that run. */
export function requestNotifs(r: ServerRequest): LiveNotif[] {
  if (!r.finishedAt || (r.status !== 'done' && r.status !== 'failed')) return [];
  if (r.status === 'failed') {
    return [{ key: `research-failed:${r.id}:${r.finishedAt}`, t: r.finishedAt, k: 'bad', icon: 'error', title: 'Keyword research failed: ' + r.topic, body: r.error || '', view: 'research', ev: 'error', handled: false }];
  }
  return [{ key: `research-done:${r.id}:${r.finishedAt}`, t: r.finishedAt, k: 'info', icon: 'search', title: 'Keyword research is ready: ' + r.topic, body: 'Open Research and SEO, Keywords tab.', view: 'research', handled: false }];
}

/** What a person decides about a written version. A language review or the Site Builder's photos leave it waiting. */
const DECISIONS: readonly ArticleAction[] = ['approved', 'rejected', 'revision'];

/**
 * An article's history, one notification per event that deserves one: written (first draft) and waiting for review,
 * a revision finished, a job that failed. Later events mark it handled: a decision after a written version (approval,
 * rejection or a revision request), a retry after a failure.
 */
export function articleNotifs(a: ServerArticle): LiveNotif[] {
  const out: LiveNotif[] = [], art = 'a' + a.id, title = a.content?.titleEn || a.content?.title || a.keyword;
  let revising = false;
  a.history.forEach((e, i) => {
    const later = a.history.slice(i + 1);
    if (e.action === 'revision') revising = true;
    else if (e.action === 'written') {
      const handled = later.some(x => DECISIONS.includes(x.action));
      out.push(revising
        ? { key: `article-revised:${a.id}:${e.at}`, t: e.at, k: 'info', icon: 'rate_review', title: 'A revised article is back in review', body: title, view: 'review', ev: 'review', art, handled }
        : { key: `article-written:${a.id}:${e.at}`, t: e.at, k: 'info', icon: 'rate_review', title: 'Article ready for review: ' + title, body: 'Open Article review.', view: 'review', ev: 'review', art, handled });
      revising = false;
    } else if (e.action === 'failed') {
      out.push({ key: `article-failed:${a.id}:${e.at}`, t: e.at, k: 'bad', icon: 'error', title: 'Article failed: ' + a.keyword, body: e.note || a.error, view: 'review', ev: 'error', art, handled: later.length > 0 });
    }
  });
  return out;
}

/**
 * A website build (server/builds.ts), one notification per outcome that asks something of a person, worded like the
 * server's alerts: ready for approval (handled once decided), a failed build (handled once a newer build of the site
 * exists) and a failed deploy (keyed by the time it stopped; gone once it is deployed again). A build approved by itself
 * (Settings: deploys need no approval; decided when it finished) never waited for anyone.
 */
export function buildNotifs(b: BuildWire, newer = false): LiveNotif[] {
  const out: LiveNotif[] = [], name = `v${b.version} of ${b.domain}`;
  if (b.status === 'failed' && b.finishedAt) {
    out.push({ key: `build-failed:${b.id}:${b.finishedAt}`, t: b.finishedAt, k: 'bad', icon: 'error', title: `Website ${name} failed to build`, body: b.error, view: 'deploy', ev: 'error', handled: newer });
  }
  const auto = b.review === 'approved' && b.decidedAt !== null && b.decidedAt === b.finishedAt;
  if (b.status === 'ready' && b.finishedAt && b.review && !auto) {
    out.push({ key: `build-ready:${b.id}:${b.finishedAt}`, t: b.finishedAt, k: 'info', icon: 'web', title: `Website ${name} is ready for approval`, body: 'Preview it in Build and deploy, then approve or reject it.', view: 'deploy', ev: 'approval', handled: b.review !== 'waiting' });
  }
  if (b.deploy === 'failed') {
    const at = b.steps.at(-1)?.at ?? b.updatedAt;
    out.push({ key: `deploy-failed:${b.id}:${at}`, t: at, k: 'bad', icon: 'error', title: `Deploy of ${b.domain} v${b.version} failed`, body: b.deployError, view: 'deploy', ev: 'error', handled: newer });
  }
  return out;
}

/** Where a click on each kind of server alert leads when the alert names no screen of its own: a view, or a tab's alias. */
const ALERT_VIEW = { blocked: 'deploy', budget: 'analytics', report: 'reports' } as const satisfies Partial<Record<NotifyEvent, ViewId | AliasId>>;
const isAlertEvent = (v: string): v is keyof typeof ALERT_VIEW => Object.hasOwn(ALERT_VIEW, v);
/** A view id or a tab's alias as the notification's target: the view, plus the tab when there is one. */
const target = (id: ViewId | AliasId): Pick<LiveNotif, 'view' | 'to'> => isAliasId(id) ? { view: ALIAS[id].view, to: id } : { view: id };

/**
 * An alert the server raised (server/notify.ts), in the server's own words: a domain blocked or down after an access
 * check, a site near or at its daily budget, the weekly report sent. The key is the server's key for the alert, so
 * every browser and every reload gives the same notification. A blocked or unreachable domain is handled once a
 * later check of that site found it open again.
 */
export function alertNotifs(a: BellAlertWire, access: Readonly<Record<string, AccessWire>> = {}): LiveNotif[] {
  if (!isAlertEvent(a.event)) return [];
  /* The server links by path ("/deploy", "/analytics", "/reports"). A path that became a tab ("/reports") opens that tab; a
     notification for Build and deploy opens its Website tab (openNotification). */
  const linked = a.link.replace(/^\//, '');
  const base = { key: 'alert:' + a.key, t: a.at, title: a.title, body: a.body, ...target(isAliasId(linked) || isViewId(linked) ? linked : ALERT_VIEW[a.event]), ev: a.event };
  if (a.event === 'blocked') {
    const now = a.site ? access[a.site] : undefined;
    return [{ ...base, k: 'bad', icon: / is down$/.test(a.title) ? 'cloud_off' : 'block', handled: !!now && now.at > a.at && now.result === 'ok' }];
  }
  if (a.event === 'budget') return [{ ...base, k: a.key.startsWith('budget-stop:') ? 'bad' : 'warn', icon: 'payments', handled: false }];
  return [{ ...base, k: 'ok', icon: 'mail', handled: false }];
}

/** Every live notification for the server's requests, articles and website builds, newest first. */
export function deriveLiveNotifs(reqs: readonly ServerRequest[], arts: readonly ServerArticle[], builds: readonly BuildWire[] = []): LiveNotif[] {
  const newer = (b: BuildWire) => builds.some(x => x.siteId === b.siteId && x.version > b.version);
  return [...reqs.flatMap(requestNotifs), ...arts.flatMap(articleNotifs), ...builds.flatMap(b => buildNotifs(b, newer(b)))].sort((x, y) => y.t - x.t);
}

/** Read when the person read it (in any earlier visit), when it is handled, or when it is older than 14 days. */
export const liveRead = (n: LiveNotif, readKeys: readonly string[], now: number): boolean =>
  n.handled || now - n.t > NOTIF_FRESH_MS || readKeys.includes(n.key);

type Target = Pick<AppState, 'live' | 'notifs' | 'notifRead' | 'np' | 'uid'>;

/**
 * Rebuilds the live notifications in the bell from the server's state. Notifications made in this browser (no key)
 * stay; the list is ordered by time and cut to the newest 40. A live notification keeps its id across re-application.
 */
export function liveNotifsTo(s: Target, now: number = Date.now()): void {
  const derived = [
    ...deriveLiveNotifs(Object.values(s.live.reqs), Object.values(s.live.arts), Object.values(s.live.builds ?? {})),
    ...(s.live.alerts ?? []).flatMap(a => alertNotifs(a, s.live.access)),
  ].filter(n => !n.ev || s.np[n.ev]?.[0] !== false);
  const ids: Record<string, number> = {};
  s.notifs.forEach(n => { if (n.key) ids[n.key] = n.id; });
  type Entry = { at: number; local: Notification } | { at: number; live: LiveNotif };
  const entries: Entry[] = [
    ...s.notifs.filter(n => !n.key).map(local => ({ at: local.t.getTime(), local })),
    ...derived.map(live => ({ at: live.t, live })),
  ].sort((x, y) => y.at - x.at).slice(0, NOTIF_MAX);
  s.notifs = entries.map(e => {
    if ('local' in e) return e.local;
    const n = e.live;
    return {
      id: ids[n.key] ?? nextUid(s), t: new Date(n.t), k: n.k, icon: n.icon, title: n.title, body: n.body, view: n.view,
      read: liveRead(n, s.notifRead, now), key: n.key, ...(n.to ? { to: n.to } : {}), ...(n.art ? { art: n.art } : {}),
    };
  });
}

/** Remembers that the person read these live notifications (the newest READ_KEYS_MAX keys are kept). */
export function markReadTo(s: Pick<AppState, 'notifRead'>, keys: readonly string[]): void {
  const fresh = keys.filter(k => !s.notifRead.includes(k));
  if (!fresh.length) return;
  s.notifRead = [...s.notifRead, ...fresh].slice(-READ_KEYS_MAX);
}

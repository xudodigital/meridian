/* Mutators: small functions that change a state object in place.
   They are called with an immer draft (inside the store's `set`) or with a plain object (in the seed and in tests),
   and they are the single implementation of addLog, notify, snack, the run log and the publish gate.
   They never touch the DOM, localStorage or the network. */
import { MODES } from './constants';
import type { LiveEnd, LiveRun } from './liveAgents';
import { costOf, homeSite, mkSteps, rand as randBetween, siteById, type Rand } from './rules';
import { actor } from './session';
import type { Agent, AppState, Article, AuthSession, NotifyEvent, PillKind, ViewId } from './types';

type S<K extends keyof AppState> = Pick<AppState, K>;

/** Next id for anything created at run time (the prototype's ++uid). */
export const nextUid = (s: S<'uid'>): number => ++s.uid;

/** Shows the snackbar. Without an icon: a lock for "View-only…" messages, a check mark otherwise. */
export function snackTo(s: S<'snackMsg'>, msg: string, icon?: string): void {
  s.snackMsg = { seq: (s.snackMsg?.seq ?? 0) + 1, msg, icon: icon || (/^View-only/.test(msg) ? 'lock' : 'check_circle') };
}

/** Adds an audit-log entry under `who` (newest first, 200 kept). For what an agent did; see logMineTo for the person. */
export function addLogTo(s: S<'log'>, who: string, act: string, site?: string | null, cid?: string): void {
  s.log.unshift({ t: new Date(), actor: who, act, site: site || null, ...(cid ? { cid } : {}) });
  if (s.log.length > 200) s.log.pop();
}

let cidN = 0;
/** A client id for an audit entry made in this browser, so the server's copy can replace it. */
export const newCid = (): string => 'c' + Date.now().toString(36) + (++cidN).toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * Adds an audit-log entry for something the signed-in person did, under their name (the prototype's "Admin" actor),
 * and shows the same text in the snackbar. Outside demo mode the entry carries a client id: sync.ts sends it to the
 * server, which records it under the signed-in person and sends it back to every browser.
 * Do not use it for something the server does itself (research, articles, team, account): the server logs those.
 */
export function logMineTo(s: S<'log' | 'session' | 'snackMsg' | 'sample'>, act: string, site?: string | null): void {
  addLogTo(s, actor(s), act, site, s.sample ? undefined : newCid());
  snackTo(s, act);
}

/** A new id for something saved in the workspace (site, agent, skill). Random outside demo mode, so two browsers never pick the same one. */
export function newId(s: S<'uid' | 'sample'>, prefix: string): string {
  const n = nextUid(s);
  return s.sample ? prefix + n : prefix + n + '-' + Math.random().toString(36).slice(2, 7);
}

/**
 * Adds a notification (newest first, 40 kept).
 * @param ev When given and the In-app channel for that event is switched off in Settings, nothing is added.
 */
export function notifyTo(s: S<'notifs' | 'np' | 'uid'>, k: PillKind, icon: string, title: string, body: string, view: ViewId, ev?: NotifyEvent): void {
  if (ev && s.np[ev] && !s.np[ev][0]) return;
  s.notifs.unshift({ id: nextUid(s), t: new Date(), k, icon, title, body, view, read: false });
  if (s.notifs.length > 40) s.notifs.pop();
}

/** Records a finished job in Run history (newest first, 80 kept). `back` dates it that many milliseconds ago. */
export function logRunTo(s: S<'jobLog' | 'uid'>, a: Agent, status: 'Done' | 'Failed', back: number = 0, rng: Rand = Math.random, now: number = Date.now()): void {
  const tk = Math.max(1200, a.tok0 != null ? a.tokens - a.tok0 : Math.round(8e3 + rng() * 6e4));
  s.jobLog.unshift({ id: nextUid(s), t: new Date(now - back), agent: a.name, hue: a.hue, task: a.task, site: a.site, dur: Math.round(40 + rng() * 500), tokens: tk, cost: costOf(tk, a.model, now), status, steps: mkSteps(a) });
  if (s.jobLog.length > 80) s.jobLog.pop();
}

/**
 * The publish gate: called when an agent with gate "Publish" finishes a job.
 * Depending on the site's review mode the article goes to the review queue or publishes without a person.
 */
export function submitArticleTo(s: S<'sites' | 'settings' | 'articles' | 'artN' | 'autoPub' | 'log' | 'notifs' | 'np' | 'uid'>, a: Agent, rng: Rand = Math.random): void {
  const site = siteById(s, a.site); if (!site) return;
  const n = ++s.artN, mode = s.settings.apPublish ? (site.mode || 'all') : 'none', flag = rng() < .3;
  const toReview = mode === 'all' || (mode === 'sample' && n % 5 === 0) || (mode === 'risk' && flag);
  if (!toReview) { s.autoPub++; addLogTo(s, a.name, `Published without human review (${mode === 'none' ? 'publish approval is off' : MODES[mode].toLowerCase()})`, site.id); return; }
  if (s.articles.filter(x => x.status === 'review' || x.status === 'revisi').length >= 8) { addLogTo(s, a.name, 'Review queue is full, article held', site.id); return; }
  const article: Article = {
    id: n, s: site.id, title: `Sample article #${n} (${site.lang})`, titleEn: `Sample article #${n} for ${site.domain}`, kw: 'sample keyword', words: Math.round(randBetween(900, 2200, rng)), rev: 0, status: 'review', notes: [], native: { st: 'wait' },
    checks: [['ok', 'Duplication', 'Under 5%'], flag ? ['warn', 'Facts and figures', '1 figure has no source'] : ['ok', 'Facts and figures', 'Match the source'], ['ok', 'On-page', 'Complete']],
    paras: [[`(The ${site.lang} article text appears here.)`, '(The English translation appears here.)']],
  };
  s.articles.unshift(article);
  addLogTo(s, a.name, 'Sent an article to the review queue', site.id);
  notifyTo(s, 'info', 'rate_review', 'An article is ready for review', `Sample article #${n} for ${site.domain}`, 'review', 'review');
}

/** A job the server is running for an agent: its server id, its site, the task text and the run (liveAgents.ts). */
export interface ServerJob { id: number; site: string; task: string; run: LiveRun }

/**
 * Shows the job the server is running on its agent (live mode); the simulation only moves the progress of an agent
 * flagged `live`. A job for a site that is not in the store still runs on the server, so the agent shows it without a
 * site. A new run (another key) starts the progress again. With no job, an agent the server was driving goes back to
 * idle: at once, or after a short done moment when `end` says how the job ended (liveAgents.ts ends that moment).
 * An agent a person paused is left paused: its status is saved in the agents document (workspace.ts docOf), so a job
 * that set it working would resume it for everyone. It only lets go of a job it was showing; once resumed, the next
 * call puts the job back on it.
 * Only changed values are written, so applying the same state again leaves an immer draft unchanged.
 */
export function driveAgentTo(s: S<'agents' | 'sites'>, id: string, job: ServerJob | null, end: LiveEnd | null = null): void {
  const a = s.agents.find(x => x.id === id); if (!a) return;
  if (a.status === 'off') {
    if (a.live) { a.live = false; a.liveReq = null; a.run = null; }
    if (a.ended) a.ended = null;
    return;
  }
  if (job) {
    const r = job.run;
    if (!a.live || !a.run || a.run.key !== r.key) { a.progress = 4; a.tok0 = a.tokens; a.run = { ...r }; }
    else {
      const cur = a.run;
      if (cur.at !== r.at) cur.at = r.at;
      if (cur.step !== r.step) cur.step = r.step;
    }
    a.live = true; a.liveReq = job.id; a.status = 'work'; a.errKey = false; a.site = siteById(s, job.site) ? job.site : null; a.task = job.task;
    if (a.ended) a.ended = null;
  } else if (a.live) {
    a.live = false; a.liveReq = null; a.run = null; a.status = 'idle';
    if (end) { a.ended = end; a.progress = end.ok ? 100 : 0; }
    else { a.progress = 0; a.task = 'Waiting for a task'; }
  }
}

/** Agents waiting on an approval that no longer exists go back to idle. */
export function releaseOrphansTo(s: S<'agents' | 'approvals'>): void {
  s.agents.forEach(x => { if (x.pending && !s.approvals.some(p => p.id === x.pending)) { x.pending = null; x.status = 'idle'; x.progress = 0; x.task = 'Waiting for a task'; } });
}

/** Removes matching items in place (the prototype's purge). */
export function purge<T>(arr: T[], fn: (x: T) => boolean): void { for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i]!)) arr.splice(i, 1); }

/** Signed in: the person the server answered with, and the site filter they start with. */
export function signInTo(s: S<'session' | 'loginNote' | 'siteFilter' | 'sample'>, session: AuthSession): void {
  s.loginNote = '';
  s.session = session;
  s.siteFilter = homeSite(s);
}

/** Signs out of the page, optionally with a note shown on the sign-in screen, and closes every shell overlay. */
export function signOutTo(s: S<'session' | 'auth' | 'loginNote' | 'confirm' | 'pop' | 'searchOpen' | 'navOpen'>, msg?: string): void {
  s.session = null; s.auth = 'signin'; s.loginNote = msg || '';
  s.confirm = null; s.pop = null; s.searchOpen = false; s.navOpen = false;
}

/* Workflow runs and schedule times from the server in the store (outside demo mode), the Orchestrator's desk, and the
   small pure derivations the Workflows tab and the Workspace share. Mutators like the ones in draft.ts: called with an
   immer draft (live.ts, the sites slice, liveAgents.ts) or a plain state object in tests. They write only what changed.

   The Orchestrator is the workflow engine (server/workflows.ts): code that queues the other agents' jobs in order. It
   makes no model call, so it has no tokens and no cost. Its desk shows the running workflow and what it waits for:
   "Weekly content for kopi.example · waiting for your review of 2 articles". */
import type { LiveRun } from './liveAgents';
import { inSite, siteById } from './rules';
import type { Agent, AppState, Schedule, ScheduleDueWire, ScheduleEvery, WorkflowStep, WorkflowWire, WorkflowsWire } from './types';

export const WEEKLY = 'Weekly content';
/** How many articles a run may queue. */
export const N_MIN = 1, N_MAX = 5, N_DEFAULT = 2;
/** How long the Orchestrator shows "Done" or "Failed" after a workflow ended (as liveAgents.ts DONE_MS). */
const DONE_MS = 4000;

type Target = Pick<AppState, 'live' | 'agents' | 'sites'> & Partial<Pick<AppState, 'sample'>>;

/* ---------- Putting the server's answer in the store ---------- */

/** One run as the server now has it (an answer or the event stream): the newest change wins. */
export function workflowTo(s: Target, w: WorkflowWire, now: number = Date.now()): void {
  const known = s.live.workflows[w.id];
  if (known && known.updatedAt > w.updatedAt) return;
  s.live.workflows[w.id] = w;
  if (!s.sample) orchestratorTo(s, now);
}
export function schedDueTo(s: Pick<AppState, 'live'>, list: readonly ScheduleDueWire[]): void {
  s.live.schedDue = Object.fromEntries(list.map(x => [x.id, x]));
}
/** Everything the server has (GET /api/state, GET /api/workflows): replaces what the store held. Null: nothing for this role. */
export function workflowsTo(s: Target, w: WorkflowsWire | null | undefined, now: number = Date.now()): void {
  s.live.workflows = Object.fromEntries((w?.runs ?? []).map(r => [r.id, r]));
  schedDueTo(s, w?.schedules ?? []);
  if (!s.sample) orchestratorTo(s, now);
}

/* ---------- The Orchestrator's desk ---------- */

const lowerFirst = (t: string): string => /^[A-Z][a-z ]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
export const workflowKey = (id: number): string => `workflow:${id}`;
const all = (s: Pick<AppState, 'live'>): WorkflowWire[] => Object.values(s.live.workflows ?? {});

/** Which running workflow the desk shows first: one that waits for a person, then one that is held, then the others. */
const urgency = (r: WorkflowWire): number => r.wait?.kind === 'person' ? 0 : r.wait?.kind === 'budget' || r.wait?.kind === 'queue' ? 1 : 2;

/**
 * Shows the running workflow on the Orchestrator: the one that waits for a person before the others, the newest first
 * among equals. While it waits for a person the agent "Needs approval" (and sits in the Office's meeting room); a workflow that
 * ended shows "Done" or "Failed" for a moment, then the agent rests (liveAgents.ts ends that moment).
 */
export function orchestratorTo(s: Target, now: number = Date.now()): void {
  const a = s.agents.find(x => x.id === 'orc');
  if (!a) return;
  const mine = a.live && a.run?.kind === 'workflow';
  if (a.status === 'off') {
    if (mine) { a.live = false; a.liveReq = null; a.run = null; }
    return;
  }
  const running = all(s).filter(r => r.status === 'running').sort((x, y) => urgency(x) - urgency(y) || y.id - x.id);
  const run = running[0];
  if (run) {
    const w = run.wait, person = w?.kind === 'person', held = w?.kind === 'budget' || w?.kind === 'queue';
    const more = running.length > 1 ? ` (and ${running.length - 1} more)` : '';
    const what = w ? lowerFirst(w.text) : '';
    /* What it waits for is part of the task while nothing moves; while an agent works it is the step after the task. */
    const task = `${run.name} for ${run.domain}${what && (person || held) ? ' · ' + what : ''}${more}`;
    const next: LiveRun = { key: workflowKey(run.id), kind: 'workflow', ref: String(run.id), at: w?.kind === 'agent' ? run.stepAt : null, step: person || held ? '' : what };
    if (!mine || a.run?.key !== next.key) { a.progress = 4; a.run = next; }
    else {
      if (a.run.at !== next.at) a.run.at = next.at;
      if (a.run.step !== next.step) a.run.step = next.step;
    }
    const status: Agent['status'] = person ? 'wait' : 'work', site = siteById(s, run.siteId) ? run.siteId : null;
    if (!a.live) a.live = true;
    if (a.liveReq !== run.id) a.liveReq = run.id;
    if (a.status !== status) a.status = status;
    if (a.errKey) a.errKey = false;
    if (a.site !== site) a.site = site;
    if (a.task !== task) a.task = task;
    if (a.ended) a.ended = null;
    return;
  }
  if (!mine) return;
  const last = s.live.workflows[Number(a.run?.ref)];
  a.live = false; a.liveReq = null; a.run = null; a.status = 'idle';
  if (last && last.status !== 'running') {
    const ok = last.status !== 'failed';
    a.ended = { ok, until: now + DONE_MS, note: last.status === 'failed' ? last.error || 'Stopped' : last.status === 'cancelled' ? 'Cancelled' : last.outcome || 'Finished' };
    a.progress = ok ? 100 : 0;
  } else { a.progress = 0; a.task = 'Waiting for a task'; }
}

/* ---------- What the screens show ---------- */

export interface FlowStep { id: Exclude<WorkflowStep, 'done'>; label: string; icon: string; who: string }
/** The steps of "Weekly content" in order, with who does each. */
export const FLOW: readonly FlowStep[] = [
  { id: 'research', label: 'Keyword research', icon: 'key', who: 'Keyword agent' },
  { id: 'write', label: 'Writing', icon: 'edit_note', who: 'Content Writer' },
  { id: 'review', label: 'Your review', icon: 'rate_review', who: 'You' },
  { id: 'build', label: 'Website build', icon: 'construction', who: 'Site Builder' },
  { id: 'approve', label: 'Your approval', icon: 'verified', who: 'You' },
  { id: 'deploy', label: 'Deploy', icon: 'rocket_launch', who: 'Deploy & Monitor' },
];
export type StepState = 'done' | 'now' | 'todo' | 'failed' | 'stopped';
/** How each step of a run is drawn: done, the current one, not reached; the step a run failed or was cancelled on. */
export function stepStates(r: Pick<WorkflowWire, 'status' | 'step'>): StepState[] {
  const at = r.step === 'done' ? FLOW.length : FLOW.findIndex(f => f.id === r.step);
  return FLOW.map((_, i) => i < at ? 'done' : i > at ? 'todo' : r.status === 'running' ? 'now' : r.status === 'failed' ? 'failed' : 'stopped');
}

/** Runs of sites that exist and are inside the site filter, newest first. */
export function runsShown(s: Pick<AppState, 'live' | 'sites' | 'siteFilter'>): WorkflowWire[] {
  return all(s).filter(r => siteById(s, r.siteId) && inSite(s, r.siteId)).sort((x, y) => y.id - x.id);
}
export const runningShown = (s: Pick<AppState, 'live' | 'sites' | 'siteFilter'>): WorkflowWire[] => runsShown(s).filter(r => r.status === 'running');

/** A schedule the server's engine runs: "Weekly content" for a site, with a weekday and an hour. */
export const realSchedule = (c: Schedule): c is Schedule & { site: string; every: ScheduleEvery; weekday: number; hour: number } =>
  c.wf === WEEKLY && !!c.site && !!c.every && typeof c.weekday === 'number' && typeof c.hour === 'number';

export const WEEKDAYS: readonly string[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const hourText = (h: number): string => String(h).padStart(2, '0') + ':00';
/** "Every Monday at 06:00", "Every 2 weeks on Monday at 06:00", "First Monday of the month at 06:00". */
export function cadenceText(c: { every: ScheduleEvery; weekday: number; hour: number }): string {
  const day = WEEKDAYS[c.weekday] ?? 'Monday', at = ' at ' + hourText(c.hour);
  return c.every === 'week' ? `Every ${day}${at}` : c.every === '2weeks' ? `Every 2 weeks on ${day}${at}` : `First ${day} of the month${at}`;
}
/** A time on a site's own clock: "Mon 12 Oct, 06:00". Falls back to this computer's clock for a zone the browser does not know. */
export function zoneTime(ms: number, zone: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try { return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: zone }).format(new Date(ms)); }
  catch { return new Intl.DateTimeFormat('en-GB', opts).format(new Date(ms)); }
}
/** "Asia/Ho_Chi_Minh" as "Ho Chi Minh time". */
export const zoneName = (zone: string): string => (zone.split('/').pop() || zone).replace(/_/g, ' ') + ' time';

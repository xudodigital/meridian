/* Workflow runs in the store (liveWorkflows.ts): the Orchestrator's desk, how the steps of a run are drawn, the words
   for a schedule, and that a schedule's new fields survive the workspace document. */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { agentLook, roomOf } from '@/views/workspace/helpers';
import { T_ART } from './articleFixtures';
import { liveApply } from './liveApply';
import { cadenceText, orchestratorTo, realSchedule, runningShown, stepStates, workflowTo, workflowsTo, zoneName, zoneTime } from './liveWorkflows';
import { agentPlanned } from './rules';
import { makeEmptyState } from './testing';
import type { AppState, Schedule } from './types';
import { dueWire, workflowWire } from './workflowFixtures';
import { applyDoc, docOf } from './workspace';

const T = T_ART;
function withSite(): AppState {
  const s = makeEmptyState();
  s.sites.push({ id: 'a', domain: 'kopi.example', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
  s.live.on = true; s.live.ready = true;
  return s;
}
const orc = (s: AppState) => s.agents.find(a => a.id === 'orc')!;

describe('the Orchestrator', () => {
  it('is a real agent outside demo mode, idle while no workflow runs', () => {
    const s = withSite();
    expect(agentPlanned(s, orc(s))).toBe(false);
    liveApply(s, T);
    expect(orc(s)).toMatchObject({ status: 'idle', task: 'Waiting for a task' });
    expect(orc(s).live).toBeFalsy();
  });

  it('shows the running workflow and what it waits for, and needs approval while it waits for a person', () => {
    const s = withSite();
    workflowTo(s, workflowWire(1), T);
    expect(orc(s)).toMatchObject({ status: 'wait', live: true, site: 'a', task: 'Weekly content for kopi.example · waiting for your review of 2 articles' });
    expect(agentLook(orc(s))).toMatchObject({ label: 'Needs approval', task: 'Weekly content for kopi.example · waiting for your review of 2 articles' });
    expect(roomOf(orc(s))).toBe('meet');
    expect(orc(s).run).toMatchObject({ key: 'workflow:1', kind: 'workflow', at: null });
    /* It made no model call: no tokens. */
    expect(orc(s).tokens).toBe(0);
  });

  it('works while an agent has the step, with the step after the task', () => {
    const s = withSite();
    workflowTo(s, workflowWire(1, { step: 'write', wait: { kind: 'agent', text: 'The Content Writer is writing article 1 of 2' } }), T);
    expect(orc(s)).toMatchObject({ status: 'work', task: 'Weekly content for kopi.example' });
    expect(agentLook(orc(s))).toMatchObject({ label: 'Working', step: 'the Content Writer is writing article 1 of 2' });
    /* Held by the budget: nothing moves, and the task says so. */
    workflowTo(s, workflowWire(1, { step: 'research', wait: { kind: 'budget', text: 'Waiting for budget', detail: 'kopi.example has used its daily budget of $25.00.' }, updatedAt: T + 300_000 }), T);
    expect(orc(s)).toMatchObject({ status: 'work', task: 'Weekly content for kopi.example · waiting for budget' });
    expect(orc(s).run?.at).toBeNull();
  });

  it('shows how the workflow ended for a moment, then rests', () => {
    const s = withSite();
    workflowTo(s, workflowWire(1), T);
    workflowTo(s, workflowWire(1, { status: 'done', step: 'done', wait: null, outcome: 'Website v1 is live at https://kopi.pages.dev.', finishedAt: T + 400_000, updatedAt: T + 400_000 }), T + 400_000);
    expect(orc(s)).toMatchObject({ status: 'idle', live: false });
    expect(agentLook(orc(s))).toMatchObject({ st: 'done', label: 'Done', step: 'Website v1 is live at https://kopi.pages.dev.' });
    liveApply(s, T + 400_000 + 5000);
    expect(orc(s).ended).toBeFalsy();
    expect(orc(s).task).toBe('Waiting for a task');

    workflowTo(s, workflowWire(2, { updatedAt: T + 500_000 }), T + 500_000);
    workflowTo(s, workflowWire(2, { status: 'failed', wait: null, error: 'Keyword research failed: no answer', updatedAt: T + 600_000 }), T + 600_000);
    expect(agentLook(orc(s))).toMatchObject({ st: 'failed', label: 'Failed', step: 'Keyword research failed: no answer' });
  });

  it('shows the workflow that waits for a person first, counts the others, and leaves a paused agent paused', () => {
    const s = withSite();
    s.sites.push({ ...s.sites[0]!, id: 'b', domain: 'masak.example' });
    workflowsTo(s, { runs: [workflowWire(1), workflowWire(2, { siteId: 'b', domain: 'masak.example' })], schedules: [] }, T);
    expect(orc(s).task).toBe('Weekly content for masak.example · waiting for your review of 2 articles (and 1 more)');
    /* A newer run that an agent is working on does not take the desk from one that waits for a person. */
    workflowTo(s, workflowWire(3, { step: 'write', wait: { kind: 'agent', text: 'The Content Writer is writing article 1 of 2' }, updatedAt: T + 300_000 }), T);
    expect(orc(s).run?.key).toBe('workflow:2');
    expect(orc(s).task).toBe('Weekly content for masak.example · waiting for your review of 2 articles (and 2 more)');
    orc(s).status = 'off';
    orchestratorTo(s, T);
    expect(orc(s)).toMatchObject({ status: 'off', live: false, run: null });
  });

  it('drops an answer older than what the stream already brought, and writes nothing when nothing changed', () => {
    const s = withSite();
    workflowTo(s, workflowWire(1, { updatedAt: T + 900 }), T);
    workflowTo(s, workflowWire(1, { step: 'research', updatedAt: T + 100 }), T);
    expect(s.live.workflows[1]?.step).toBe('review');
    const same = produce(s, d => { liveApply(d, T); orchestratorTo(d, T); });
    expect(same.agents).toBe(s.agents);
  });

  it('is left alone in demo mode', () => {
    const s = withSite();
    s.sample = true;
    workflowTo(s, workflowWire(1), T);
    expect(s.live.workflows[1]).toBeTruthy();
    expect(orc(s).live).toBeFalsy();
  });
});

describe('what the Workflows tab draws', () => {
  it('marks the steps before the current one done, and the step a run failed or stopped on', () => {
    expect(stepStates({ status: 'running', step: 'review' })).toEqual(['done', 'done', 'now', 'todo', 'todo', 'todo']);
    expect(stepStates({ status: 'failed', step: 'build' })).toEqual(['done', 'done', 'done', 'failed', 'todo', 'todo']);
    expect(stepStates({ status: 'cancelled', step: 'research' })).toEqual(['stopped', 'todo', 'todo', 'todo', 'todo', 'todo']);
    expect(stepStates({ status: 'done', step: 'done' })).toEqual(Array(6).fill('done'));
    /* Ended early without a failure (nothing to write, a rejected build): the steps it never reached stay open. */
    expect(stepStates({ status: 'done', step: 'done' }).length).toBe(6);
  });

  it('lists running workflows inside the site filter, for sites that exist', () => {
    const s = withSite();
    workflowsTo(s, { runs: [workflowWire(1), workflowWire(2, { siteId: 'gone' }), workflowWire(3, { status: 'done' })], schedules: [dueWire('c1')] }, T);
    expect(runningShown(s).map(r => r.id)).toEqual([1]);
    expect(runningShown({ ...s, siteFilter: 'other' })).toEqual([]);
    expect(s.live.schedDue.c1?.zone).toBe('Asia/Ho_Chi_Minh');
    workflowsTo(s, null, T);
    expect([s.live.workflows, s.live.schedDue]).toEqual([{}, {}]);
  });

  it('words a cadence and a time on the site\'s own clock', () => {
    expect(cadenceText({ every: 'week', weekday: 1, hour: 6 })).toBe('Every Monday at 06:00');
    expect(cadenceText({ every: '2weeks', weekday: 5, hour: 16 })).toBe('Every 2 weeks on Friday at 16:00');
    expect(cadenceText({ every: 'month', weekday: 0, hour: 0 })).toBe('First Sunday of the month at 00:00');
    expect(zoneTime(Date.UTC(2026, 9, 4, 23, 0, 0), 'Asia/Ho_Chi_Minh')).toBe('Mon 5 Oct, 06:00');
    expect(zoneTime(Date.UTC(2026, 9, 5, 12, 0, 0), 'America/Mexico_City')).toBe('Mon 5 Oct, 06:00');
    expect(zoneName('Asia/Ho_Chi_Minh')).toBe('Ho Chi Minh time');
    expect(() => zoneTime(0, 'Not/AZone')).not.toThrow();
  });

  it('keeps a schedule\'s site, time, number of articles and topic through the workspace document', () => {
    const s = withSite();
    const c: Schedule = { id: 'c1', wf: 'Weekly content', site: 'a', cad: 'Manual only', on: true, every: '2weeks', weekday: 3, hour: 9, n: 4, topic: 'Tea' };
    s.schedules.push(c, { id: 'old', wf: 'Weekly content', site: null, cad: 'Every Monday 06:00', on: true });
    const doc = docOf(s, 'schedules');
    const back = makeEmptyState();
    applyDoc(back, 'schedules', doc);
    expect(back.schedules).toEqual(s.schedules);
    expect(realSchedule(back.schedules[0]!)).toBe(true);
    expect(realSchedule(back.schedules[1]!)).toBe(false);
  });
});

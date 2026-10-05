/* Workflow runs and schedule times as the server sends them, for tests. */
import { T_ART } from './articleFixtures';
import type { ScheduleDueWire, WorkflowWire } from './types';

/** A running "Weekly content" for site `a`, waiting for the review of two articles. */
export const workflowWire = (id: number, over: Partial<WorkflowWire> = {}): WorkflowWire => ({
  id, kind: 'weekly-content', name: 'Weekly content', siteId: 'a', domain: 'kopi.example', scheduleId: '', by: 'Dana Owner', topic: '', n: 2,
  status: 'running', step: 'review', stepAt: T_ART + 200_000,
  wait: { kind: 'person', text: 'Waiting for your review of 2 articles' },
  requestId: 1, articles: [5, 6], buildId: null, outcome: '', error: '',
  log: [{ at: T_ART, text: 'Started by Dana Owner' }, { at: T_ART + 1000, text: 'Asked the Keyword agent for keyword research: Coffee' }],
  createdAt: T_ART, updatedAt: T_ART + 200_000, finishedAt: null, ...over,
});

export const dueWire = (id: string, over: Partial<ScheduleDueWire> = {}): ScheduleDueWire => ({
  id, siteId: 'a', zone: 'Asia/Ho_Chi_Minh', nextDue: Date.UTC(2026, 9, 4, 23, 0, 0), lastDue: null, note: '', noteAt: 0, ...over,
});

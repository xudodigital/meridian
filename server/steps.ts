// The steps of a job's latest run, each with the time it began, so Run history shows real timings.
import { db } from './db.ts';

export type JobKind = 'seo-task' | 'request' | 'article' | 'photos' | 'build' | 'deploy';
export type Step = { at: number; text: string };

const qs = {
  clear: db.prepare('DELETE FROM job_steps WHERE kind = ? AND job_id = ?'),
  add: db.prepare('INSERT INTO job_steps (kind, job_id, at, text) VALUES (?, ?, ?, ?)'),
  list: db.prepare('SELECT at, text FROM job_steps WHERE kind = ? AND job_id = ? ORDER BY id'),
};

/** A new run: the steps of the previous run are dropped and the first step is recorded. */
export function startSteps(kind: JobKind, id: number, text: string, at = Date.now()): void {
  qs.clear.run(kind, id);
  qs.add.run(kind, id, at, text.slice(0, 500));
}
export const addStep = (kind: JobKind, id: number, text: string, at = Date.now()) => qs.add.run(kind, id, at, text.slice(0, 500));
export const stepsOf = (kind: JobKind, id: number): Step[] => (qs.list.all(kind, id) as Step[]).map(s => ({ at: s.at, text: s.text }));

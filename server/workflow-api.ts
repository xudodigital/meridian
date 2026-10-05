// The workflow routes: GET /api/workflows (runs, and each schedule's next start), POST /api/workflows (run "Weekly
// content" now, for a site or from one of its schedules) and POST /api/workflows/:id/cancel. Workflows are part of
// Build and deploy, which is not a native reviewer's screen: reviewers get 403. Starting and cancelling are for admins
// and editors; a viewer may look. The engine itself is workflows.ts.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, mayWrite, type Ctx } from './access.ts';
import { ENGINE_MISSING, engineReady } from './engine.ts';
import { body, json, text } from './http.ts';
import { queueFull } from './jobs.ts';
import type { UserRow } from './users.ts';
import { cancelRun, clampN, listRuns, scheduleViews, schedules, startRun, type RunView, type SchedView } from './workflows.ts';

const NOT_FOR_REVIEWERS = 'Your role reviews articles only.';
const LIST = '/api/workflows';
const CANCEL = /^\/api\/workflows\/(\d{1,9})\/cancel$/;

export type WorkflowsState = { runs: RunView[]; schedules: SchedView[] };
/** Runs and schedule times for GET /api/state: null for a native reviewer. */
export function workflowsState(u: UserRow): WorkflowsState | null {
  return u.role === 'reviewer' ? null : { runs: listRuns(), schedules: scheduleViews() };
}

/** Handles the workflow routes. Returns false for any other path. */
export async function workflowApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const m = req.method || 'GET', u = ctx.user, cancel = path.match(CANCEL);
  if (!(path === LIST && (m === 'GET' || m === 'POST')) && !(cancel && m === 'POST')) return false;
  if (u.role === 'reviewer') { json(res, 403, { error: NOT_FOR_REVIEWERS }); return true; }
  if (m === 'GET') { json(res, 200, workflowsState(u)); return true; }

  const no = mayWrite(u);
  if (no) { json(res, no.status, { error: no.error }); return true; }

  if (cancel) {
    const o = cancelRun(Number(cancel[1]), u.name);
    if (!o.ok) json(res, o.status, { error: o.error }); else json(res, 200, { run: o.run });
    return true;
  }

  const b = await body(req);
  /* "Run now" on a schedule uses what the saved schedule says (site, how many, topic), never what the request says. */
  const scheduleId = text(b.scheduleId, 64);
  const sched = scheduleId ? schedules().find(s => s.id === scheduleId) : undefined;
  if (scheduleId && !sched) { json(res, 404, { error: 'That schedule no longer exists.' }); return true; }
  const siteId = sched ? sched.site : text(b.siteId, 64);
  if (!siteId) { json(res, 400, { error: 'Choose a site.' }); return true; }
  if (!(await engineReady())) { json(res, 503, { error: ENGINE_MISSING }); return true; }
  const full = queueFull(siteId);
  if (full) { json(res, 429, { error: full }); return true; }
  const o = startRun({ siteId, n: sched ? sched.n : clampN(b.n), topic: sched ? sched.topic : text(b.topic, 80), scheduleId: sched?.id ?? '', by: u.name }, actorOf(ctx));
  if (!o.ok) json(res, o.status, { error: o.error }); else json(res, 201, { run: o.run });
  return true;
}

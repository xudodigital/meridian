/* HTTP calls for workflows (server/workflow-api.ts). Nothing here touches the store. Schedules themselves are the
   `schedules` workspace document (sync.ts saves it); the server answers with when each one runs next. */
import { apiGet, apiSend } from './serverApi';
import type { WorkflowWire, WorkflowsWire } from './types';

const run = (r: { run: WorkflowWire }) => r.run;

export const workflowApi = {
  /** Runs and each schedule's next start. */
  list: () => apiGet<WorkflowsWire>('/api/workflows'),
  /** "Run workflow": starts "Weekly content" for a site now (201). Refused while that site has one running. */
  run: (body: { siteId: string; n: number; topic: string }) => apiSend<{ run: WorkflowWire }>('/api/workflows', body).then(run),
  /** "Run now" on a schedule: the server uses the saved schedule's site, number of articles and topic. */
  runSchedule: (scheduleId: string) => apiSend<{ run: WorkflowWire }>('/api/workflows', { scheduleId }).then(run),
  /** Cancels a running workflow; the jobs it queued that have not started are withdrawn. */
  cancel: (id: number) => apiSend<{ run: WorkflowWire }>(`/api/workflows/${id}/cancel`).then(run),
};

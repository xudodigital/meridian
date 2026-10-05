/* Workspace slice: the agent cards and office, the agent detail sheet and the Add agent form.
   Ported from the prototype's click handlers ag-w, ag-retry, ag-pause, all-resume, ws-mode and the "agent" form submit. */
import { PROV } from '../constants';
import { logMineTo, newId, snackTo } from '../draft';
import { keyOK, pick, provOf, siteById, siteOpen, totalWorkers } from '../rules';
import { KEY_WS, readKey, writeKey } from '../storage';
import type { Slice } from './slice';

export type WsMode = 'cards' | 'office';

/** What the Add agent form sends. */
export interface NewAgent { name: string; role: string; model: string }
/**
 * Outcome of a form submit: done (close the sheet), or not done with the message to show under the fields.
 * An empty message keeps the sheet open without a message, as the prototype does for a refused role or blank fields.
 */
export type FormResult = { ok: true } | { ok: false; msg: string };

export interface WorkspaceState {
  /** How agents are shown. Saved under "das-ws". */
  wsMode: WsMode;
  /** Agent whose detail sheet is open (the prototype's openAgent). The global search sets it too. */
  agentSheet: string | null;
}
export interface WorkspaceActions {
  setWsMode: (m: WsMode) => void;
  openAgent: (id: string) => void;
  closeAgent: () => void;
  /** The worker stepper (ag-w): one more (d = 1) or one fewer (d = -1) parallel worker. */
  setWorkers: (id: string, d: 1 | -1) => void;
  /** Restarts an agent in error (ag-retry). */
  retryAgent: (id: string) => void;
  /** Pauses a running agent or resumes a paused one (ag-pause). */
  pauseAgent: (id: string) => void;
  /** Resumes every paused agent (all-resume). */
  resumeAll: () => void;
  /** The Add agent form. */
  addAgent: (v: NewAgent) => FormResult;
}

const limitMsg = (n: number): string => `Limit reached: ${n} parallel workers. Raise it in Settings.`;

export const workspaceSlice: Slice<WorkspaceState, WorkspaceActions> = {
  initial: {
    wsMode: readKey(KEY_WS) === 'office' ? 'office' : 'cards',
    agentSheet: null,
  },
  actions: (set, get) => ({
    setWsMode: m => { const v: WsMode = m === 'office' ? 'office' : 'cards'; set(d => { d.wsMode = v; }); writeKey(KEY_WS, v); },
    openAgent: id => { if (get().agents.some(a => a.id === id)) set(d => { d.agentSheet = id; }); },
    closeAgent: () => set(d => { d.agentSheet = null; }),

    setWorkers: (id, step) => {
      if (!get().guard()) return;
      set(d => {
        const a = d.agents.find(x => x.id === id); if (!a) return;
        if (step > 0 && a.status !== 'off' && totalWorkers(d) >= d.settings.parallel) { snackTo(d, limitMsg(d.settings.parallel), 'info'); return; }
        if (step > 0 && a.workers >= 8) { snackTo(d, 'An agent can have at most 8 workers.', 'info'); return; }
        if (step < 0 && a.workers <= 1) return;
        a.workers = Math.max(1, Math.min(8, a.workers + step));
        logMineTo(d, `${a.name} now has ${a.workers} worker${a.workers === 1 ? '' : 's'}`);
      });
    },

    retryAgent: id => {
      if (!get().guard()) return;
      set(d => {
        const a = d.agents.find(x => x.id === id); if (!a) return;
        if (!keyOK(d, a)) { snackTo(d, 'Add the ' + PROV[provOf(a.model)].name + ' API key in Integrations first, or pick another model.', 'info'); return; }
        a.errKey = false;
        if (!siteOpen(d, siteById(d, a.site))) { a.status = 'idle'; a.progress = 0; a.task = 'Waiting for a task'; }
        else { a.status = 'work'; a.progress = 5; a.task = pick(a.tasks); a.tok0 = a.tokens; }
        logMineTo(d, 'Restarted ' + a.name, a.site);
      });
    },

    pauseAgent: id => {
      if (!get().guard()) return;
      set(d => {
        const a = d.agents.find(x => x.id === id); if (!a) return;
        if (a.status === 'off') {
          if (totalWorkers(d) + a.workers > d.settings.parallel) { snackTo(d, limitMsg(d.settings.parallel), 'info'); return; }
          a.status = 'idle'; a.task = 'Waiting for a task';
        } else {
          if (a.pending) { const p = d.approvals.find(q => q.id === a.pending); if (p) p.agent = null; a.pending = null; }
          a.errKey = false; a.status = 'off'; a.progress = 0; a.task = 'Paused by admin';
        }
        logMineTo(d, (a.status === 'off' ? 'Paused ' : 'Resumed ') + a.name);
      });
    },

    resumeAll: () => {
      if (!get().guard()) return;
      set(d => {
        d.agents.forEach(x => { if (x.status === 'off') { x.status = 'idle'; x.task = 'Waiting for a task'; } });
        logMineTo(d, 'Resumed every agent');
      });
    },

    addAgent: v => {
      if (!get().guard()) return { ok: false, msg: '' };
      const name = v.name.trim(), role = v.role.trim(), s = get();
      if (!name || !role) return { ok: false, msg: '' };
      if (s.agents.some(a => a.name.toLowerCase() === name.toLowerCase())) return { ok: false, msg: 'An agent with this name already exists.' };
      if (totalWorkers(s) + 1 > s.settings.parallel) return { ok: false, msg: `Limit reached: ${s.settings.parallel} parallel workers. Raise it in Settings or pause an agent first.` };
      set(d => {
        d.agents.push({
          id: newId(d, 'x'), hue: d.agents.length % 11, name, role, model: v.model, skills: [], workers: 1, tokens: 0, status: 'idle', progress: 0,
          site: d.sample && d.sites[0] ? d.sites[0].id : null, task: 'Waiting for a task', tasks: ['Working on: ' + role],
        });
        logMineTo(d, 'Added the agent ' + name);
      });
      return { ok: true };
    },
  }),
};

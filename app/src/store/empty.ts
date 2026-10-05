/* The empty state: what the app starts from outside demo mode, before the workspace arrives from the server, and what
   each workspace document falls back to while nobody has saved it. It keeps configuration (the agent roles, the
   skills, the integrations list with nothing connected, default settings and alert channels, the column layout of the
   module tables) and holds no sites, articles, activity or numbers. The configuration is independent of test fixtures. */
import type { SeedData } from './seed';
import { defaultConfig } from './defaults';
import { emptyLive } from './liveState';
import type { Agent, ModId, ModTable, Settings } from './types';

/** The part of an agent that is configuration: who it is, what it runs on and what it may load. */
export type AgentConfig = Pick<Agent, 'id' | 'name' | 'role' | 'model' | 'skills' | 'workers' | 'hue' | 'tasks' | 'gate' | 'prev'>;

/** An agent with no work, no site and no tokens used: idle, or paused when `off`. */
export function restingAgent(a: AgentConfig, off: boolean = false): Agent {
  return {
    id: a.id, name: a.name, role: a.role, model: a.model, skills: [...a.skills], workers: a.workers, hue: a.hue, tasks: [...a.tasks],
    ...(a.gate ? { gate: a.gate } : {}), ...(a.prev ? { prev: { ...a.prev } } : {}),
    tokens: 0, progress: 0, site: null, status: off ? 'off' : 'idle', task: off ? 'Paused by admin' : 'Waiting for a task',
  };
}

/**
 * The settings a new workspace starts with (and returns to after Reset workspace). The server applies the same two
 * security defaults while nobody has saved Settings: 2-step verification not required, sign-out after 8 hours idle.
 */
export function defaultSettings(): Settings {
  return { ...defaultConfig().settings, twofa: false, timeout: 'h8', repTo: '', repOn: false };
}

export function createEmpty(): SeedData {
  const seed = defaultConfig();
  const mod: Record<ModId, ModTable> = { ...seed.mod };
  (Object.keys(mod) as ModId[]).forEach(id => { mod[id] = { ...mod[id], rows: [] }; });
  return {
    sites: [], approvals: [], articles: [], artN: 0, log: [], schedules: [], deploys: [], jobLog: [], kwReqs: [], runs: [], notifs: [],
    agents: seed.agents.map(a => restingAgent(a)),
    skills: seed.skills,
    ints: seed.ints.map(n => ({ ...n, tail: null, st: null, msg: null })),
    settings: defaultSettings(),
    np: seed.np,
    sessions: [],
    users: [],
    live: emptyLive(), mod, uid: 100,
  };
}

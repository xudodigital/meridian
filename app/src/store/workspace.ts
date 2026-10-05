/* The workspace as the server stores it: one JSON document per collection (server/workspace.ts DOC_IDS). This module
   turns store state into those documents and back, and merges a local change onto a newer server version (rebase).
   Pure: no store, network or storage. sync.ts does the loading and saving.

   sites        Site[] without the review mode          agents       configuration only (no task, progress or tokens)
   skills       Skill[] without the version history      settings     Settings
   schedules    Schedule[]                               reviewModes  site id -> review mode
   notifyPrefs  the alert table (NotifyPrefs)                                                                           */
import { defaultSettings, restingAgent, type AgentConfig } from './empty';
import { defaultConfig } from './defaults';
import type { Agent, AppState, Gate, NotifyPrefs, ProviderId, ReviewMode, Schedule, Settings, Site, Skill } from './types';

export const DOC_IDS = ['sites', 'agents', 'skills', 'settings', 'schedules', 'reviewModes', 'notifyPrefs'] as const;
export type DocId = typeof DOC_IDS[number];

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };
export const isObj = (v: Json | undefined): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The state a document is made from and put back into. */
export type DocTarget = Pick<AppState, 'sites' | 'agents' | 'skills' | 'settings' | 'schedules' | 'np'>;

/** The fields of the state each document comes from: a change to one of them may need a save. */
export const DOC_SOURCES: Readonly<Record<DocId, readonly (keyof DocTarget)[]>> = {
  sites: ['sites'], reviewModes: ['sites'], agents: ['agents'], skills: ['skills'], settings: ['settings'], schedules: ['schedules'], notifyPrefs: ['np'],
};

/** An agent's configuration as saved: what a person set, plus whether it is paused. */
export type AgentDoc = AgentConfig & { off: boolean };

/** JSON with object keys sorted, so two documents with the same content always compare equal. */
export function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
}
/** A plain JSON copy of state (drops undefined, revives nothing). */
const toJson = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? null)) as Json;

export function docOf(s: DocTarget, id: DocId): Json {
  switch (id) {
    /* Access, the time of the last check, clicks and the last deploy come from the server's own records (serverFacts.ts),
       not the document. */
    case 'sites': return toJson(s.sites.map(({ mode: _mode, access: _a, checked: _c, clicks: _k, deploy: _d, ...rest }) => rest));
    case 'reviewModes': return toJson(Object.fromEntries(s.sites.filter(x => x.mode).map(x => [x.id, x.mode])));
    case 'agents': return toJson(s.agents.map((a): AgentDoc => ({
      id: a.id, name: a.name, role: a.role, model: a.model, skills: a.skills, workers: a.workers, hue: a.hue, tasks: a.tasks,
      ...(a.gate ? { gate: a.gate } : {}), ...(a.prev ? { prev: a.prev } : {}), off: a.status === 'off',
    })));
    case 'skills': return toJson(s.skills.map(({ hist: _hist, ...k }) => k));
    case 'settings': return toJson(s.settings);
    case 'schedules': return toJson(s.schedules);
    case 'notifyPrefs': return toJson(s.np);
  }
}

/* ---------- Reading documents back (the server checked their shape; these guards keep the types honest) ---------- */

const str = (v: Json | undefined, d = ''): string => typeof v === 'string' ? v : d;
const num = (v: Json | undefined, d = 0): number => typeof v === 'number' && Number.isFinite(v) ? v : d;
const strs = (v: Json | undefined): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const items = (v: Json | null): Obj[] => Array.isArray(v) ? v.filter(isObj).filter(x => typeof x.id === 'string') : [];
const REVIEW_MODES: readonly ReviewMode[] = ['all', 'sample', 'risk'];
const isMode = (v: Json | undefined): v is ReviewMode => typeof v === 'string' && (REVIEW_MODES as readonly string[]).includes(v);

function siteOf(o: Obj): Site {
  const status = str(o.status, 'build'), access = str(o.access, 'pending');
  const site: Site = {
    id: str(o.id), domain: str(o.domain), country: str(o.country), cc: str(o.cc), lang: str(o.lang), topic: str(o.topic),
    status: status === 'live' || status === 'dns' || status === 'paused' ? status : 'build',
    access: access === 'ok' || access === 'blocked' || access === 'down' ? access : 'pending',
    checked: str(o.checked, '—'), deploy: str(o.deploy, 'Never'), silos: strs(o.silos),
    spend: num(o.spend), clicks: num(o.clicks), tok28: num(o.tok28),
  };
  if (typeof o.token === 'string') site.token = o.token;
  const prev = str(o.prev);
  if (prev === 'live' || prev === 'build' || prev === 'dns') site.prev = prev;
  return site;
}
function agentDocOf(o: Obj): AgentDoc {
  const gate = str(o.gate), prev = isObj(o.prev) ? o.prev : null;
  const doc: AgentDoc = {
    id: str(o.id), name: str(o.name), role: str(o.role), model: ({'gpt-6-luna':'GPT-6 Luna','gpt-6.1-sol':'GPT-6.1 Sol','gpt-6-astra':'GPT-6 Astra'} as Record<string,string>)[str(o.model)] || (['GPT-6 Luna','GPT-6.1 Sol','GPT-6 Astra'].includes(str(o.model)) ? str(o.model) : /haiku|flash.*lite/i.test(str(o.model)) || o.id === 'kw' ? 'GPT-6 Luna' : 'GPT-6.1 Sol'), skills: strs(o.skills), workers: Math.max(1, num(o.workers, 1)),
    hue: num(o.hue), tasks: strs(o.tasks), off: o.off === true,
  };
  if (gate === 'Publish' || gate === 'Deploy') doc.gate = gate as Gate;
  if (prev) {
    const p: Partial<Record<ProviderId, string>> = {};
    for (const k of ['openai'] as const) if (typeof prev[k] === 'string') p[k] = prev[k];
    doc.prev = p;
  }
  return doc;
}
function skillOf(o: Obj): Skill {
  const k: Skill = { id: str(o.id), name: str(o.name), desc: str(o.desc), ver: str(o.ver, '0.1') };
  if (typeof o.def === 'string') k.def = o.def;
  if (o.only === 'openai') k.only = o.only;
  if (o.fresh === true) k.fresh = true;
  return k;
}
function scheduleOf(o: Obj): Schedule {
  const c: Schedule = { id: str(o.id), wf: str(o.wf), site: typeof o.site === 'string' ? o.site : null, cad: str(o.cad, 'Manual only') as Schedule['cad'], on: o.on === true };
  /* What the server's workflow engine runs a schedule from (server/workflows.ts). */
  if (o.every === 'week' || o.every === '2weeks' || o.every === 'month') c.every = o.every;
  if (typeof o.weekday === 'number') c.weekday = o.weekday;
  if (typeof o.hour === 'number') c.hour = o.hour;
  if (typeof o.n === 'number') c.n = o.n;
  if (typeof o.topic === 'string') c.topic = o.topic;
  return c;
}

/**
 * An agent from its saved configuration. An agent that is already in the store keeps what it is doing (its task,
 * progress, tokens and a job the server is running); pausing or resuming it here changes its status.
 */
function mergeAgent(cur: Agent | undefined, c: AgentDoc): Agent {
  const fresh = restingAgent(c, c.off);
  if (!cur) return fresh;
  const a: Agent = { ...cur, name: c.name, role: c.role, model: c.model, skills: [...c.skills], workers: c.workers, hue: c.hue, tasks: [...c.tasks] };
  if (c.gate) a.gate = c.gate; else delete a.gate;
  if (c.prev) a.prev = { ...c.prev }; else delete a.prev;
  if (c.off && cur.status !== 'off') { a.status = 'off'; a.progress = 0; a.task = 'Paused by admin'; a.pending = null; }
  if (!c.off && cur.status === 'off') { a.status = 'idle'; a.task = 'Waiting for a task'; }
  return a;
}

/** The default of each document: what the workspace holds while nobody has saved it, and after Reset workspace. */
function defaults(): DocTarget {
  const seed = defaultConfig();
  return { sites: [], agents: seed.agents.map(a => restingAgent(a)), skills: seed.skills, settings: defaultSettings(), schedules: [], np: seed.np };
}
export const defaultDoc = (id: DocId): Json => docOf(defaults(), id);

/** Puts a document into the state. `null` (never saved) puts the default back. */
export function applyDoc(s: DocTarget, id: DocId, data: Json | null): void {
  const d = data ?? defaultDoc(id);
  switch (id) {
    case 'sites': {
      const modes = Object.fromEntries(s.sites.filter(x => x.mode).map(x => [x.id, x.mode]));
      s.sites = items(d).map(siteOf).map(x => { const m = modes[x.id]; return m ? { ...x, mode: m } : x; });
      return;
    }
    case 'reviewModes': {
      const m = isObj(d) ? d : {};
      s.sites = s.sites.map(x => { const { mode: _old, ...rest } = x; const v = m[x.id]; return isMode(v) ? { ...rest, mode: v } : rest; });
      return;
    }
    case 'agents': {
      const cur = new Map(s.agents.map(a => [a.id, a]));
      s.agents = items(d).map(agentDocOf).map(c => mergeAgent(cur.get(c.id), c));
      return;
    }
    case 'skills': {
      const hist = new Map(s.skills.map(k => [k.id, k.hist]));
      s.skills = items(d).map(skillOf).map(k => { const h = hist.get(k.id); return h && h[0]?.v === k.ver ? { ...k, hist: h } : k; });
      return;
    }
    case 'settings': {
      const base = defaultSettings(), o = isObj(d) ? d : {};
      const next: Settings = { ...base };
      for (const k of Object.keys(base) as (keyof Settings)[]) {
        const v = o[k];
        if (v !== undefined && typeof v === typeof base[k]) (next as unknown as Record<string, Json>)[k] = v;
      }
      s.settings = next;
      return;
    }
    case 'schedules': s.schedules = items(d).map(scheduleOf); return;
    case 'notifyPrefs': {
      const base = defaultConfig().np, o = isObj(d) ? d : {};
      const np: NotifyPrefs = { ...base };
      for (const k of Object.keys(base) as (keyof NotifyPrefs)[]) {
        const v = o[k];
        if (Array.isArray(v) && v.length === 4 && v.every(b => typeof b === 'boolean')) np[k] = [v[0] === true, v[1] === true, v[2] === true, v[3] === true];
      }
      s.np = np;
      return;
    }
  }
}

/* ---------- Merging a local change onto a newer server version ---------- */

const idOf = (x: Json): string | null => isObj(x) && typeof x.id === 'string' ? x.id : null;

/**
 * Three-way merge: what changed from `base` to `local` is applied onto `server`. Lists of items with ids merge item by
 * item (local additions, edits and removals win; an item the server removed stays removed); objects merge key by key;
 * anything else is replaced by the local value.
 */
export function rebase(base: Json, local: Json, server: Json): Json {
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(server) && [...base, ...local, ...server].every(x => idOf(x) !== null)) {
    const b = new Map(base.map(x => [idOf(x)!, x])), l = new Map(local.map(x => [idOf(x)!, x]));
    const out = server
      .filter(x => { const id = idOf(x)!; return !(b.has(id) && !l.has(id)); })
      .map(x => { const id = idOf(x)!, mine = l.get(id); return mine !== undefined && canon(mine) !== canon(b.get(id)) ? mine : x; });
    for (const x of local) { const id = idOf(x)!; if (!b.has(id) && !out.some(y => idOf(y) === id)) out.push(x); }
    return out;
  }
  if (isObj(base) && isObj(local) && isObj(server)) {
    const out: Obj = { ...server };
    for (const k of new Set([...Object.keys(base), ...Object.keys(local)])) {
      if (canon(local[k]) === canon(base[k])) continue;
      if (k in local) out[k] = local[k]!; else delete out[k];
    }
    return out;
  }
  return local;
}

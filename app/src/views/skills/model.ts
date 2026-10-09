/* Models and skills: everything the page shows that is worked out from the store, kept free of React so it can be
   tested as plain functions. Nothing here changes the store. */
import { PROV, PROVIDER_IDS, RATE, RUNNER_AGENTS } from '@/store/constants';
import { agentPlanned, engineName, localRuntime, runtimeModel, priceOf, provOK, provOf, tierOf, usd } from '@/store/rules';
import { readKey, writeKey } from '@/store/storage';
import type { Agent, AppState, Skill } from '@/store/types';

/* ---------- The view switch ---------- */

export type SkillsView = 'agents' | 'skills' | 'matrix';
export const SKILLS_VIEWS: readonly (readonly [SkillsView, string, string])[] = [
  ['agents', 'By agent', 'smart_toy'], ['skills', 'By skill', 'psychology'], ['matrix', 'Coverage', 'grid_on'],
];
/** The view last opened on this page, remembered in this browser only. */
export const KEY_SKILLS_VIEW = 'das-skills-view';
export const isSkillsView = (v: string | null): v is SkillsView => SKILLS_VIEWS.some(x => x[0] === v);
export const readSkillsView = (): SkillsView => { const v = readKey(KEY_SKILLS_VIEW); return isSkillsView(v) ? v : 'agents'; };
export const writeSkillsView = (v: SkillsView): void => writeKey(KEY_SKILLS_VIEW, v);

/* ---------- Models and tiers ---------- */

export type Tier = 0 | 1 | 2;
/** Plain names of the three tiers every provider has: high-volume, balanced, most demanding. */
export const TIER_NAME: readonly [string, string, string] = ['Fast', 'Balanced', 'Most capable'];
/** A model name without its provider prefix, short enough for a legend: OpenAI model names retain their full label. */
export const shortModel = (m: string): string => m;
/** List price as "$2 / $10" (input / output per 1M tokens); empty for a model with no known price. */
export const priceText = (m: string, now: number = Date.now()): string => { const p = priceOf(m, now); return p ? `${usd(p[0])} / ${usd(p[1])}` : ''; };

export interface MixPart { model: string; short: string; tier: Tier; n: number; price: string; agents: string[] }
/** How many agents run on each model, cheapest tier first (then in the order the price list has the models). */
export function modelMix(agents: readonly Pick<Agent, 'name' | 'model'>[], now: number = Date.now()): MixPart[] {
  const order = Object.keys(RATE), by = new Map<string, MixPart>();
  for (const a of agents) {
    const p = by.get(a.model) ?? { model: a.model, short: shortModel(a.model), tier: tierOf(a.model), n: 0, price: priceText(a.model, now), agents: [] };
    p.n++; p.agents.push(a.name); by.set(a.model, p);
  }
  const at = (m: string) => { const i = order.indexOf(m); return i < 0 ? order.length : i; };
  return [...by.values()].sort((a, b) => a.tier - b.tier || at(a.model) - at(b.model));
}
/** The mix as one sentence, for the bar's text alternative: "GPT-6 Luna: 3 agents, GPT-6.1 Sol: 6 agents". */
export const mixText = (mix: readonly MixPart[]): string => mix.map(p => `${p.short}: ${p.n} ${p.n === 1 ? 'agent' : 'agents'}`).join(', ');

/* ---------- The three facts ---------- */

export interface Facts {
  agents: number; active: number; planned: number;
  skills: number; assigned: number;
  providers: number; connected: string[];
}
export function facts(s: Pick<AppState, 'agents' | 'skills' | 'ints' | 'live' | 'sample'>): Facts {
  const planned = s.agents.filter(a => agentPlanned(s, a)).length;
  const used = new Set(s.agents.flatMap(a => a.skills));
  return {
    agents: s.agents.length, active: s.agents.length - planned, planned,
    skills: s.skills.length, assigned: s.skills.filter(k => used.has(k.id)).length,
    providers: localRuntime(s) ? 1 : PROVIDER_IDS.length, connected: localRuntime(s) ? s.live.engine?.ready ? [engineName(s.live.engine.mode)] : [] : PROVIDER_IDS.filter(k => provOK(s, k)).map(k => PROV[k].name),
  };
}

/* ---------- What a setting really does (outside demo mode) ---------- */

/** Agents whose chosen model is used by their next job. The other runners (Orchestrator, Deploy & Monitor) are code. */
export const MODEL_AGENTS: ReadonlySet<string> = new Set(['kw', 'wr', 'bld', 'res', 'arc', 'seo', 'lnk', 'ana', 'gd']);
export type ModelEffect = 'next-job' | 'code' | 'planned';
/** What choosing a model for this agent changes today; null in demo mode, where every change applies to the next job. */
export const modelEffect = (s: Pick<AppState, 'sample'>, a: Pick<Agent, 'id'>): ModelEffect | null =>
  s.sample ? null : MODEL_AGENTS.has(a.id) ? 'next-job' : RUNNER_AGENTS.has(a.id) ? 'code' : 'planned';
export const EFFECT_TEXT: Readonly<Record<ModelEffect, string>> = {
  'next-job': 'Used by its next job',
  code: 'Runs as code, so no model is called',
  planned: 'Saved for when this agent runs',
};
/** The provider whose key the agent's model needs and that is not connected; null when the model can run. */
export const missingKey = (s: Pick<AppState, 'ints' | 'live'>, a: Pick<Agent, 'model'>): string | null =>
  provOK(s, provOf(a.model)) ? null : PROV[provOf(a.model)].name;

/* ---------- Skills: categories, size, summary, search ---------- */

export type CategoryId = 'research' | 'content' | 'site' | 'ops' | 'custom';
export interface Category { id: CategoryId; name: string; icon: string }
export const CATEGORIES: readonly Category[] = [
  { id: 'research', name: 'Research', icon: 'travel_explore' },
  { id: 'content', name: 'Content', icon: 'edit_note' },
  { id: 'site', name: 'Site and technical', icon: 'lan' },
  { id: 'ops', name: 'Operations', icon: 'rocket_launch' },
  { id: 'custom', name: 'Custom', icon: 'extension' },
];
/* The built-in skills by id (store/seed.ts). A skill a person adds has an id of its own and is "Custom". */
const CATEGORY_OF: Readonly<Record<string, CategoryId>> = {
  s1: 'research', s2: 'research',
  s4: 'content', s6: 'content', s13: 'content',
  s3: 'site', s5: 'site', s7: 'site', s8: 'site', s11: 'site', s12: 'site',
  s9: 'ops', s10: 'ops', s14: 'ops',
};
export const categoryOf = (k: Pick<Skill, 'id'>): CategoryId => CATEGORY_OF[k.id] ?? 'custom';

export interface SkillGroup extends Category { skills: Skill[] }
/** The skills under their category headings, in the fixed category order; a category with no skill is left out. */
export function groupSkills(skills: readonly Skill[]): SkillGroup[] {
  return CATEGORIES.map(c => ({ ...c, skills: skills.filter(k => categoryOf(k) === c.id) })).filter(g => g.skills.length > 0);
}

/** The number of rules a skill's description states ("123 rules from ..."), or null when it states none. */
export function ruleCount(desc: string): number | null {
  const m = /(\d[\d,]*)\s+rules\b/.exec(desc);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
}
/** The largest rule count among the skills (0 when none states one): the full width of the size meter. */
export const maxRules = (skills: readonly Pick<Skill, 'desc'>[]): number => skills.reduce((n, k) => Math.max(n, ruleCount(k.desc) ?? 0), 0);

/** The one sentence that says what a skill is for: the first one that is not the "123 rules from ..." sentence. */
export function summaryOf(desc: string): string {
  const parts = desc.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.find(p => !/^\d[\d,]*\s+rules\b/.test(p)) ?? desc.trim();
}

/** Skills whose name or description contains every word typed. */
export function filterSkills<T extends Pick<Skill, 'name' | 'desc'>>(skills: readonly T[], q: string): T[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...skills];
  return skills.filter(k => { const t = (k.name + ' ' + k.desc).toLowerCase(); return words.every(w => t.includes(w)); });
}

/** Agents that have the skill attached, in the order of the agent list. */
export const usersOf = <T extends Pick<Agent, 'skills'>>(agents: readonly T[], skillId: string): T[] => agents.filter(a => a.skills.includes(skillId));

/* ---------- Coverage: agents by skills ---------- */

export interface Coverage {
  /** Column groups, in order; `cols` is the same skills as one flat list. */
  groups: SkillGroup[];
  cols: Skill[];
  rows: { agent: Agent; on: boolean[]; total: number }[];
  /** Agents per skill, by column. */
  colTotals: number[];
  /** Filled cells. */
  attached: number;
}
export function coverage(agents: readonly Agent[], skills: readonly Skill[]): Coverage {
  const groups = groupSkills(skills), cols = groups.flatMap(g => g.skills);
  const rows = agents.map(agent => { const on = cols.map(k => agent.skills.includes(k.id)); return { agent, on, total: on.filter(Boolean).length }; });
  const colTotals = cols.map((_, c) => rows.filter(r => r.on[c]).length);
  return { groups, cols, rows, colTotals, attached: colTotals.reduce((n, x) => n + x, 0) };
}

/** Shows the exact configured OpenAI model used by the next job. */
export function executionModel(s: Pick<AppState, 'sample' | 'live'>, a: Pick<Agent, 'id' | 'model'>): { label: string; detail: string; fallback: boolean } {
  if (s.sample) return { label: 'Demo simulation', detail: 'No provider is called.', fallback: false };
  if (!MODEL_AGENTS.has(a.id)) return RUNNER_AGENTS.has(a.id)
    ? { label: 'Built-in code', detail: 'This agent does not call an AI model.', fallback: false }
    : { label: 'Not implemented', detail: 'This configuration is saved for a future runner.', fallback: false };
  if (localRuntime(s)) return { label: `${engineName(s.live.engine?.mode)} · ${runtimeModel(s, a.model)}`, detail: s.live.engine?.ready ? 'Uses the selected runtime model. API model settings do not apply.' : s.live.engine?.reason || 'Check the selected engine in Integrations.', fallback: false };
  const ready = s.live.engine?.mode === 'openai-api' && s.live.engine.ready;
  return { label: ready ? `OpenAI · ${a.model}` : 'OpenAI unavailable',
    detail: ready ? 'The next job calls this configured model through the Responses API.' : 'Connect the OpenAI API key in Integrations to run this model.', fallback: false };
}

import { executionSkills } from '../shared/agent-skills.ts';
import { getDoc } from './workspace.ts';

/** Resolve saved assignments at the start of each model call; absent documents use the shipped defaults. */
export function agentSkills(id: string): string[] {
  const data = getDoc('agents').data;
  const agent = Array.isArray(data) ? data.find(a => a && typeof a === 'object' && !Array.isArray(a) && a.id === id) : null;
  const defaults: Record<string, string[]> = { kw: ['s1', 's2', 's12'], wr: ['s4', 's6', 's12'], bld: ['s8', 's11', 's13'] };
  const assigned = agent && !Array.isArray(agent) && typeof agent === 'object' && Array.isArray(agent.skills)
    ? agent.skills.filter((s): s is string => typeof s === 'string') : defaults[id] ?? [];
  return executionSkills(id, assigned);
}

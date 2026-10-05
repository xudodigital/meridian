import type { Agent } from '@/store/types';

export type AvatarAgent = Pick<Agent, 'id' | 'hue'> & Partial<Pick<Agent, 'task' | 'ended'>>;
export type AvatarBehavior = 'working' | 'break' | 'approval' | 'dizzy' | 'error' | 'paused' | 'done';

/** Decoration follows the real status. A retained error message must not affect a later job. */
export function avatarBehavior(a: AvatarAgent, state: string): AvatarBehavior {
  if (state === 'err' || state === 'failed') {
    const reason = state === 'failed' ? a.ended?.note ?? a.task ?? '' : a.task ?? '';
    return /\b429\b|rate[\s_-]*limit|too many requests|insufficient[\s_-]*quota|quota[\s_-]*(?:exceeded|exhausted)|\bquota\b.{0,30}(?:used up|exhausted|exceeded)|resource_exhausted/i.test(reason) ? 'dizzy' : 'error';
  }
  if (state === 'wait') return 'approval';
  if (state === 'idle') return 'break';
  if (state === 'work') return 'working';
  return state === 'done' ? 'done' : 'paused';
}

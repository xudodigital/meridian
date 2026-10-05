import { describe, expect, it } from 'vitest';
import { avatarBehavior } from './agent-behavior';

const agent = { id: 'wr', hue: 4, task: 'Writing an article' };
describe('avatar behavior follows the job outcome', () => {
  it('recognizes provider rate and quota failures', () => {
    for (const reason of ['OpenAI HTTP 429', 'API rate limit reached', 'insufficient_quota', 'quotaExceeded', 'RESOURCE_EXHAUSTED', 'The API quota is used up for now.']) {
      expect(avatarBehavior({ ...agent, ended: { ok: false, until: 10, note: reason } }, 'failed')).toBe('dizzy');
    }
    expect(avatarBehavior({ ...agent, task: 'Keyword API rate limit.' }, 'err')).toBe('dizzy');
  });
  it('keeps budget, missing credentials and ordinary errors separate from API limits', () => {
    for (const reason of ['Daily budget limit reached', 'OpenAI API key missing', 'Connection timed out']) {
      expect(avatarBehavior({ ...agent, ended: { ok: false, until: 10, note: reason } }, 'failed')).toBe('error');
    }
  });
  it('does not carry a previous rate limit into a new job or idle state', () => {
    const previous = { ...agent, task: 'HTTP 429', ended: { ok: false, until: 10, note: 'rate limit' } };
    expect(avatarBehavior(previous, 'work')).toBe('working');
    expect(avatarBehavior(previous, 'idle')).toBe('break');
    expect(avatarBehavior(previous, 'wait')).toBe('approval');
    expect(avatarBehavior(previous, 'off')).toBe('paused');
    expect(avatarBehavior(previous, 'done')).toBe('done');
  });
});

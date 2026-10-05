import { Pill } from '@/components';
import { AgentAvatar } from '@/components/AgentAvatar';
import { useStore } from '@/store/store';
import type { Agent } from '@/store/types';
import { agentLook, siteText } from './helpers';

/**
 * One agent avatar in Office. Its pose follows the current job state; after a
 * server job ends it shows a check mark ("done") or error mark ("failed") briefly.
 */
export function Station({ a }: { a: Agent }) {
  const where = useStore(s => siteText(s, a.site));
  const openAgent = useStore(s => s.openAgent);
  const look = agentLook(a);
  const line = look.step ? look.task + ' · ' + look.step : look.task;
  return (
    <button type="button" className={'stn h' + a.hue} id={'desk-' + a.id} data-st={look.st} aria-label={`${a.name}, ${look.label.toLowerCase()}. Open details`} onClick={() => openAgent(a.id)}>
      <span className="bubble" title={line}><span>{line}</span></span>
      <AgentAvatar a={a} state={look.st} />
      <span className="plate"><b>{a.name}</b><span><Pill kind={look.kind} live={look.pulse}>{look.label}</Pill></span></span>
      <span className="where">{where || '\u00a0'}</span>
    </button>
  );
}

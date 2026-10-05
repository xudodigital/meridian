import { AgentAvatar } from '@/components/AgentAvatar';
import { Card, Icon, IconButton, LinkButton, Pill, Tag } from '@/components';
import { runtimeModel, agentPlanned, short } from '@/store/rules';
import { useStore } from '@/store/store';
import type { Agent } from '@/store/types';
import { agentLook, siteText, workersText } from './helpers';

/**
 * One agent card in the Cards view (the prototype's deskHTML). The card is neutral; the agent's colour is on its avatar
 * and progress bar, and the card is tinted only while the agent works. An idle card is compact: header, model and
 * controls. The task, the bar, the site and the tokens show while there is work to show. For a job the server runs, the
 * task line also shows the server's current step, and a finished job shows "Done" for a moment. Removing an agent is in
 * its detail sheet.
 * Outside demo mode nothing here pretends: the server runs one job at a time, so there is no worker stepper and no
 * pause (a card paused earlier can still be resumed), and an agent without a job runner is a compact "Planned" card.
 */
export function DeskCard({ a }: { a: Agent }) {
  const where = useStore(s => siteText(s, a.site));
  const sample = useStore(s => s.sample);
  const openAgent = useStore(s => s.openAgent);
  const setWorkers = useStore(s => s.setWorkers);
  const retryAgent = useStore(s => s.retryAgent);
  const pauseAgent = useStore(s => s.pauseAgent);
  const live = useStore(s => s.live);
  const look = agentLook(a);
  const off = a.status === 'off';
  const planned = agentPlanned({ sample }, a);
  /* Something to show beyond the header: a job in progress, a gate, an error, or the moment after a job ended. */
  const busy = !planned && look.st !== 'idle' && look.st !== 'off';
  const head = (
    <header>
      <span className={'ava agent-portrait h' + a.hue} aria-hidden="true"><AgentAvatar a={a} state={look.st} portrait />{look.st === 'done' ? <span className="donemark"><Icon name="check" /></span> : null}</span>
      <div className="who"><h3><LinkButton title="Open details" onClick={() => openAgent(a.id)}>{a.name}</LinkButton></h3><p>{a.role}</p></div>
      <span>{planned ? <Pill kind="mut">Planned</Pill> : <Pill kind={look.kind} live={look.pulse}>{look.label}</Pill>}</span>
    </header>
  );
  if (planned) {
    return (
      <Card className={'desk planned h' + a.hue} id={'desk-' + a.id} data-st="planned">
        {head}
        <div className="tags"><Tag icon="memory">{runtimeModel({live}, a.model)}</Tag></div>
      </Card>
    );
  }
  return (
    <Card lift className={'desk h' + a.hue} id={'desk-' + a.id} data-st={look.st}>
      {head}
      {busy ? <p className="task"><span>{look.task}</span>{look.step ? <span className="step"> · {look.step}</span> : null}</p> : null}
      {busy ? <div className="bar" role="presentation"><i style={{ width: look.bar + '%' }} /></div> : null}
      <div className="tags">
        {busy && a.site ? <Tag icon="language"><span>{where}</span></Tag> : null}
        {/* The Orchestrator is the workflow engine: code, not a model. */}
        {['orc', 'dep'].includes(a.id) && !sample ? <Tag icon="code">Runs as code</Tag> : <Tag icon="memory">{runtimeModel({live}, a.model)}</Tag>}
        {a.tokens > 0 && (busy || sample) ? <Tag icon="toll"><span>{short(a.tokens)}</span> tokens</Tag> : null}
        {sample ? <Tag icon="groups">{workersText(a.workers)}</Tag> : null}
      </div>
      {sample ? (
        <footer>
          <span className="stepper">
            <IconButton icon="remove" label={'Fewer workers for ' + a.name} title="Fewer workers" onClick={() => setWorkers(a.id, -1)} />
            <output>{a.workers}</output>
            <IconButton icon="add" label={'More workers for ' + a.name} title="More workers" onClick={() => setWorkers(a.id, 1)} />
          </span>
          <span className="grow" />
          {a.status === 'err' ? <IconButton icon="refresh" tone="tonal" label={'Retry ' + a.name} title="Retry" onClick={() => retryAgent(a.id)} /> : null}
          <IconButton icon={off ? 'play_arrow' : 'pause'} label={(off ? 'Resume ' : 'Pause ') + a.name} title={off ? 'Resume' : 'Pause'} onClick={() => pauseAgent(a.id)} />
        </footer>
      ) : off ? (
        <footer><span className="grow" /><IconButton icon="play_arrow" label={'Resume ' + a.name} title="Resume" onClick={() => pauseAgent(a.id)} /></footer>
      ) : null}
    </Card>
  );
}

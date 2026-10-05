import { useRef, useState, type RefObject } from 'react';
import { Button, Callout, Icon, Info, SyncBanner, Tabs } from '@/components';
import { agentPlanned, cnt, codexLocal, missingProv, totalWorkers } from '@/store/rules';
import type { WsMode } from '@/store/slices/workspace';
import { useStore, useStoreShallow } from '@/store/store';
import { Activity } from './workspace/Activity';
import { AddAgentSheet } from './workspace/AddAgentSheet';
import { AgentSheet } from './workspace/AgentSheet';
import { DeskCard } from './workspace/DeskCard';
import { canFullscreen, enterFullscreen, exitFullscreen, useFullscreenElement, useFullscreenFocus, useFullscreenNote, useWakeLock } from './workspace/fullscreen';
import { officeHref } from './workspace/helpers';
import { WorkJourney } from './journey/WorkJourney';
import { Hero } from './workspace/Hero';
import { useCardFlights } from './workspace/motion';
import { Office } from './workspace/Office';
import { Pipeline } from './workspace/Pipeline';
import { StartGuide } from './workspace/StartGuide';
import { hasRecordedWork } from './workspace/start';
import './workspace/workspace.css';

const MODES = [{ id: 'cards', label: 'Cards', icon: 'view_agenda' }, { id: 'office', label: 'Office', icon: 'apartment' }] as const;

/** Explains the missing OpenAI connection before an agent job can run. */
function MissingKey() {
  const local = useStore(codexLocal);
  const reason = useStore(s => s.live.engine?.reason);
  if (local) return <Callout icon="terminal"><b>Codex local is not ready.</b> {reason || 'Sign in to Codex on this computer, then check again in Integrations.'}</Callout>;
  return <Callout icon="key"><b>OpenAI is not connected.</b> Add and test the OpenAI API key in Integrations before running agent jobs.</Callout>;
}

/**
 * Office mode only: open the Office on a page of its own in a new tab (it keeps the site filter), or show it in full
 * screen right here (`trigger` is that button). Escape, or the button inside the office, leaves full screen.
 */
function OfficeActions({ box, trigger }: { box: RefObject<HTMLDivElement | null>; trigger: RefObject<HTMLButtonElement | null> }) {
  const siteFilter = useStore(s => s.siteFilter);
  const snack = useStore(s => s.snack);
  const full = async () => {
    const el = box.current;
    if (el && !(await enterFullscreen(el))) snack('The browser did not allow full screen.', 'fullscreen');
  };
  return (
    <div className="row ws-office-acts">
      <a className="btn text" href={officeHref(siteFilter)} target="_blank" rel="noopener" title="Open the office on its own page, for a second screen or a TV">
        <Icon name="open_in_new" />Open in new tab
      </a>
      {canFullscreen() ? <Button ref={trigger} variant="text" icon="fullscreen" onClick={() => { void full(); }} title="Show the office in full screen. Press Escape to leave.">Full screen</Button> : null}
    </div>
  );
}

/** What each pose in the Office means, as an icon key. */
function OfficeKey({ sample }: { sample: boolean }) {
  return (
    <Info label="What the office shows">
      <ul className="office-key">
        <li><Icon name="keyboard" />Typing: working</li>
        <li><Icon name="front_hand" />Raised hand: needs your approval</li>
        {sample ? null : <li><Icon name="check_circle" />Green check: a job just finished</li>}
        <li><Icon name="coffee" />Coffee mug: idle</li>
        <li><Icon name="error" />Red mark: an error</li>
        <li><Icon name="chair" />Empty chair: paused</li>
      </ul>
      <p>Each person is one agent. People walk to the meeting room when they need your approval and to the break room when idle; a flying page is a finished job handed to the next agent{sample ? '' : ', or to you for review'}. Select a person for details and controls.</p>
    </Info>
  );
}

/**
 * The Agents section: the Cards / Office toggle, the summary line and the agents in the chosen layout. The Office
 * flies its own hand-off pages; the Cards view flies them for real work (demo mode keeps the prototype's cards).
 * Outside demo mode the agents the server runs jobs for come first; the ones without a job runner sit in an expanded
 * "Planned agents" group, and the summary says how jobs really run (one at a time) instead of counting workers.
 * In full screen the office gets an exit button of its own (focus moves to it and stays inside the office until full
 * screen ends, then goes back to the Full screen button), shows a failed save, and keeps the screen awake. The
 * snackbar and flying pages show inside it too (Snackbar.tsx, motion.ts).
 */
function Agents() {
  const [agents, parallel, wsMode, setWsMode, handoff, sample] = useStoreShallow(s => [s.agents, s.settings.parallel, s.wsMode, s.setWsMode, s.handoff, s.sample] as const);
  const office = wsMode === 'office';
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const exit = useRef<HTMLButtonElement>(null);
  const fsEl = useFullscreenElement();
  const full = office && fsEl instanceof HTMLElement && fsEl.classList.contains('office');
  const note = useFullscreenNote('The office is in full screen. Press Escape to leave.');
  useWakeLock(full);
  useFullscreenFocus(full, box, exit, trigger);
  useCardFlights(handoff, !office && !sample);
  const planned = agents.filter(a => agentPlanned({ sample }, a)), active = agents.filter(a => !agentPlanned({ sample }, a));
  const working = cnt({ agents: active }, 'work');
  return (
    <section>
      <div className="sh">
        <h2>Agents</h2>
        <Tabs<WsMode> label="How agents are shown" value={wsMode} onChange={setWsMode} items={MODES} />
        {office ? <OfficeActions box={box} trigger={trigger} /> : null}
        <span className="note" id="k-sub">{sample
          ? `${cnt({ agents }, 'idle')} idle · ${totalWorkers({ agents })} of ${parallel} parallel workers`
          : `${agents.length} configured · ${cnt({ agents: active }, 'idle')} idle · ${working} working${planned.length ? ` · ${planned.length} not implemented` : ''}`}</span>
      </div>
      {office ? (
        <Office boxRef={box}>
          {full ? <>
            <Button ref={exit} className="office-exit" variant="tonal" size="sm" icon="fullscreen_exit" onClick={() => { void exitFullscreen(); }}>Exit full screen</Button>
            <SyncBanner className="office-alert" />
          </> : null}
          <p className="sr-only" role="status">{note}</p>
        </Office>
      ) : <div className="cards" id="desks">{active.map(a => <DeskCard key={a.id} a={a} />)}</div>}
      {office ? <OfficeKey sample={sample} /> : null}
      {planned.length ? (
        <details className="planned-group" id="planned">
          <summary><Icon name="chevron_right" />Planned agents ({planned.length})<span className="note">No job runner yet</span></summary>
          {office ? null : <div className="cards">{planned.map(a => <DeskCard key={a.id} a={a} />)}</div>}
          <p className="note">
            {office ? planned.map(a => a.name).join(', ') + '. ' : ''}These agents are configured, with a role, a model and skills, but Meridian has no job for them yet, so they never run and cannot be paused or given workers. Keyword, Content Writer, Site Builder and Deploy &amp; Monitor do the work today, in the order the Orchestrator (the workflow engine) queues it or you ask for it.
          </p>
        </details>
      ) : null}
    </section>
  );
}

/** Workspace: hero, the setup checklist (outside demo mode), agent cards or office, content pipeline, live activity, approvals. Prototype: vWorkspace() and helpers, lines 1274-1389. Slice: workspace. */
export function Workspace() {
  const [ints, agents, live, guard, sample] = useStoreShallow(s => [s.ints, s.agents, s.live, s.guard, s.sample] as const);
  const [adding, setAdding] = useState(false);
  /* Outside demo mode only the agents that run jobs can be held up by a provider. */
  const missing = missingProv({ ints, agents: agents.filter(a => !agentPlanned({ sample }, a)), live });
  const add = () => { if (guard()) setAdding(true); };
  const work = sample || hasRecordedWork({ live });
  return (
    <>
      {sample ? <Hero onAdd={add} /> : <StartGuide />}
      {work && !sample ? <Hero onAdd={add} summaryOnly /> : null}
      {work ? <WorkJourney /> : null}
      {work && missing.length ? <MissingKey /> : null}
      <details className="starter-monitor" open={work || undefined}><summary><Icon name="apartment" />View your agents and office<span>Already configured · no setup needed here</span></summary><Agents /></details>
      {work ? <Pipeline /> : null}
      {work ? <Activity /> : null}
      <AddAgentSheet open={adding} onClose={() => setAdding(false)} />
      <AgentSheet />
    </>
  );
}

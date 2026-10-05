import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Icon } from '@/components';
import { agentPlanned, hhmm, TICK_MS } from '@/store/rules';
import { useStore } from '@/store/store';
import type { Agent } from '@/store/types';
import { ROOMS, roomOf, type RoomId } from './helpers';
import { useOfficeMotion } from './motion';
import { Station } from './Station';

/** A compact office header with a live clock. */
function Wall() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), TICK_MS); return () => clearInterval(t); }, []);
  return (
    <div className="wall">
      <span className="office-label"><Icon name="apartment" />Agent office</span>
      <span className="clock"><Icon name="schedule" /><span id="officeClock">{hhmm(now)}</span></span>
    </div>
  );
}

interface RoomProps { id: RoomId; cls: string; icon: string; name: string; sub?: string; list: Agent[]; none: string }
/**
 * The prototype's roomHTML: a room that grows with the number of people in it. Its id is a hand-off target (motion.ts).
 * Its width follows the seat width --seat-w (116px; larger on the Office page and in full screen, workspace.css).
 */
function Room({ id, cls, icon, name, sub, list, none }: RoomProps) {
  const style: CSSProperties = { flex: `${Math.max(1, list.length)} 1 calc(${Math.max(2, list.length)} * (var(--seat-w, 116px) + 8px) + 26px)` };
  return (
    <div className={'room' + (cls ? ' ' + cls : '')} id={'room-' + id} style={style}>
      <h3><Icon name={icon} /><span>{name}{sub ? <> <small>· {sub}</small></> : null}</span><span className="cnt">{list.length}</span></h3>
      {list.length ? <div className="seats">{list.map(a => <Station key={a.id} a={a} />)}</div> : <p className="none">{none}</p>}
    </div>
  );
}

export interface OfficeProps {
  /** The .office element, for a parent that shows it in full screen. */
  boxRef?: RefObject<HTMLDivElement | null>;
  /** Sized for a big screen: seats grow with the viewport (the Office page). Full screen does the same through CSS. */
  big?: boolean;
  /** Put first inside the office, for example the button that leaves full screen. */
  children?: ReactNode;
}

/**
 * The Office view of the agents (the prototype's agentsHTML in office mode and floorHTML). Outside demo mode only the
 * agents that run jobs have a station: a planned agent never works, so a person idling forever would say nothing true.
 */
export function Office({ boxRef, big, children }: OfficeProps) {
  const all = useStore(s => s.agents);
  const sample = useStore(s => s.sample);
  const agents = all.filter(a => !agentPlanned({ sample }, a));
  const planned = all.filter(a => agentPlanned({ sample }, a));
  const handoff = useStore(s => s.handoff);
  const own = useRef<HTMLDivElement>(null);
  const box = boxRef ?? own;
  useOfficeMotion(box, handoff);
  const inR = (k: RoomId) => agents.filter(a => roomOf(a) === k);
  return (
    <div className={'office' + (big ? ' big' : '')} id="desks" ref={box}>
      {children}
      <Wall />
      {planned.length ? <p className="office-availability">{all.length} configured roles · {agents.length} supported. Not implemented ({planned.length}): {planned.map(a => a.name).join(', ')}. These roles have no job runner and are not counted as idle.</p> : null}
      <div className="floor">
        {ROOMS.filter(r => r[0] !== 'flex' || inR('flex').length).map(r => (
          <Room key={r[0]} id={r[0]} cls="" icon={r[2]} name={r[1]} list={inR(r[0])} none="Everyone on this team is in another room." />
        ))}
        <Room id="meet" cls="meet" icon="front_hand" name="Meeting room" sub="waiting for your approval" list={inR('meet')} none="Nobody is waiting for approval." />
        <Room id="break" cls="break" icon="coffee" name="Break room" sub="idle" list={inR('break')} none="Nobody is idle." />
      </div>
    </div>
  );
}

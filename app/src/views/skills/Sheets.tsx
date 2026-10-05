import { Button, Pill, Sheet, SheetActions, Switch } from '@/components';
import { initials } from '@/store/rules';
import { skillHistory } from '@/store/slices/system';
import { useStore } from '@/store/store';
import { groupSkills, ruleCount, summaryOf } from './model';

const PLAN_NOTE = 'Built-in assignments apply to the next AI call for Keyword, Content Writer and Site Builder. Required task guidelines cannot be disabled. Other agents keep assignments as a plan; added catalog entries have no executable instructions.';

/** One skill, every agent: a switch per agent (the prototype's openAssign(id), lines 1632-1638). */
export function AssignSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const k = useStore(s => s.skills.find(x => x.id === id));
  const agents = useStore(s => s.agents);
  const setSkillAgent = useStore(s => s.setSkillAgent);
  const sample = useStore(s => s.sample);
  return (
    <Sheet open={!!k} onClose={onClose} title={k?.name} description={sample ? "Choose which agents load this skill. Changes apply to each agent's next job." : 'Choose agents for this skill. ' + PLAN_NOTE}>
      {k ? (
        <div className="alist">
          {agents.map(a => (
            <label key={a.id} className={'arow h' + a.hue}>
              <span className={'ava s' + (a.hue % 4 + 1)} aria-hidden="true">{initials(a.name)}</span>
              <span className="who"><h3>{a.name}</h3><p>{a.role}</p></span>
              <Switch id={`as-${k.id}-${a.id}`} checked={a.skills.includes(k.id)} label={`${k.name} for ${a.name}`} onChange={on => setSkillAgent(k.id, a.id, on)} />
            </label>
          ))}
        </div>
      ) : null}
      <SheetActions><Button variant="filled" onClick={onClose}>Done</Button></SheetActions>
    </Sheet>
  );
}

/** One agent, every skill: the same switches from the agent's side, under the category headings. */
export function AgentSkillsSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const a = useStore(s => s.agents.find(x => x.id === id));
  const skills = useStore(s => s.skills);
  const setSkillAgent = useStore(s => s.setSkillAgent);
  const sample = useStore(s => s.sample);
  return (
    <Sheet open={!!a} onClose={onClose} title={a ? 'Skills for ' + a.name : undefined} description={sample ? "Choose which skills this agent loads. Changes apply to its next job." : 'Choose skills for this agent. ' + PLAN_NOTE}>
      {a ? groupSkills(skills).map(g => (
        <div className="sx-pick" key={g.id}>
          <h3>{g.name}</h3>
          <div className="alist">
            {g.skills.map(k => {
              const n = ruleCount(k.desc);
              return (
                <label key={k.id} className="arow">
                  <span className="who"><h3>{k.name}</h3><p>{n ? n + ' rules · ' : ''}{summaryOf(k.desc)}</p></span>
                  <Switch id={`sk-${a.id}-${k.id}`} checked={a.skills.includes(k.id)} label={`${k.name} for ${a.name}`} onChange={on => setSkillAgent(k.id, a.id, on)} />
                </label>
              );
            })}
          </div>
        </div>
      )) : null}
      <SheetActions><Button variant="filled" onClick={onClose}>Done</Button></SheetActions>
    </Sheet>
  );
}

/** The versions of one skill, with Restore (the prototype's openSkillHist(id), lines 1975-1982). */
export function VersionsSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const k = useStore(s => s.skills.find(x => x.id === id));
  const restoreSkill = useStore(s => s.restoreSkill);
  const sample = useStore(s => s.sample);
  return (
    <Sheet open={!!k} onClose={onClose} title={k?.name} description="This history restores the catalog metadata. Executable instructions are maintained in the project skills folder and are not restored here.">
      {k ? (
        <div className="dsec">
          <h3>Versions</h3>
          <div className="queue">
            {(k.hist ?? skillHistory(k, sample)).map(h => (
              <div className="q" key={h.v}>
                <Pill kind={h.v === k.ver ? 'ok' : 'mut'}>{'v' + h.v}</Pill>
                <p><b>{h.note}</b><br /><span className="chip">{h.when}</span></p>
                {h.v === k.ver ? <span className="note">In use</span> : <Button size="sm" variant="tonal" onClick={() => { if (restoreSkill(k.id, h.v)) onClose(); }}>Restore</Button>}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <SheetActions><Button variant="text" onClick={onClose}>Close</Button></SheetActions>
    </Sheet>
  );
}

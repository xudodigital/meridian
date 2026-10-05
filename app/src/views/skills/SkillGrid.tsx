import { useId, useState } from 'react';
import { Empty, Icon, IconButton } from '@/components';
import { PROV } from '@/store/constants';
import { initials } from '@/store/rules';
import { useStore } from '@/store/store';
import type { Agent, Skill } from '@/store/types';
import { filterSkills, groupSkills, maxRules, ruleCount, summaryOf, usersOf } from './model';
import { AssignSheet, VersionsSheet } from './Sheets';

/** Avatars shown in a stack before the rest fold into "+3". */
const STACK = 5;

/** "By skill": the skills under plain category headings, one compact card each, filtered by the search box. */
export function SkillGrid({ q }: { q: string }) {
  const skills = useStore(s => s.skills);
  const agents = useStore(s => s.agents);
  const guard = useStore(s => s.guard);
  const initSkillHist = useStore(s => s.initSkillHist);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [histId, setHistId] = useState<string | null>(null);

  const shown = filterSkills(skills, q), groups = groupSkills(shown), max = maxRules(skills);
  return (
    <>
      {q.trim() ? <p className="sx-cap" role="status">{shown.length} of {skills.length} skills match "{q.trim()}"</p> : null}
      {groups.map(g => (
        <section className="sx-sec" key={g.id} data-category={g.id}>
          <div className="sx-sec-head"><Icon name={g.icon} /><h2>{g.name}</h2><span className="sx-count">{g.skills.length}</span></div>
          <div className="sx-grid">
            {g.skills.map(k => (
              <SkillCard key={k.id} k={k} agents={agents} max={max}
                onAssign={() => { if (guard()) setAssignId(k.id); }}
                onVersions={() => { initSkillHist(k.id); setHistId(k.id); }} />
            ))}
          </div>
        </section>
      ))}
      {groups.length ? null : <Empty icon="search_off" title="No skill matches">Try a shorter word, or clear the search to see all {skills.length} skills.</Empty>}
      <AssignSheet id={assignId} onClose={() => setAssignId(null)} />
      <VersionsSheet id={histId} onClose={() => setHistId(null)} />
    </>
  );
}

function SkillCard({ k, agents, max, onAssign, onVersions }: { k: Skill; agents: Agent[]; max: number; onAssign: () => void; onVersions: () => void }) {
  const [more, setMore] = useState(false);
  const descId = useId();
  const us = usersOf(agents, k.id), names = us.map(a => a.name).join(', ');
  const rules = ruleCount(k.desc), summary = summaryOf(k.desc), hasMore = summary !== k.desc.trim();
  return (
    <article className="sx-card sx-skill" data-skill={k.id}>
      <header className="sx-sk-head">
        <h3>{k.name}</h3>
        <span className="sx-ver">v{k.ver}</span>
      </header>
      {k.def || k.only || k.fresh ? (
        <div className="sx-badges">
          {k.def ? <span className="sx-badge">{k.def}</span> : null}
          {k.only ? <span className="sx-badge warn">{'For ' + PROV[k.only].name + ' agents only'}</span> : null}
          {k.fresh ? <span className="sx-badge new">New</span> : null}
        </div>
      ) : null}
      <p id={descId} className={'sx-desc' + (more ? ' open' : '')}>{more ? k.desc : summary}</p>
      {hasMore ? <button type="button" className="sx-more" aria-expanded={more} aria-controls={descId} onClick={() => setMore(!more)}>{more ? 'Less' : 'More'}<span className="sr-only"> about {k.name}</span></button> : null}

      <div className="sx-size">
        {rules ? (
          <>
            <span className="sx-size-n"><b>{rules}</b> rules</span>
            <span className="sx-meter" aria-hidden="true"><i style={{ width: Math.max(4, Math.round(rules / max * 100)) + '%' }} /></span>
          </>
        ) : <span className="sx-cap">Rule count not listed</span>}
      </div>

      <footer className="sx-sk-foot">
        {us.length ? (
          <span className="sx-stack" role="img" aria-label={`Used by ${us.length} ${us.length === 1 ? 'agent' : 'agents'}: ${names}`} title={names}>
            {us.slice(0, STACK).map(a => <span key={a.id} className={'sx-ava sm h' + a.hue}>{initials(a.name)}</span>)}
            {us.length > STACK ? <span className="sx-ava sm rest">+{us.length - STACK}</span> : null}
            <span className="sx-stack-n">{us.length} {us.length === 1 ? 'agent' : 'agents'}</span>
          </span>
        ) : <span className="sx-cap sx-unused">No agent yet</span>}
        <span className="sx-acts">
          <IconButton icon="group_add" label={'Assign agents to ' + k.name} title="Assign agents" onClick={onAssign} />
          <IconButton icon="history" label={'Versions of ' + k.name} title="Versions" onClick={onVersions} />
        </span>
      </footer>
    </article>
  );
}

import { useState } from 'react';
import { Button, Info, SearchField, Tabs } from '@/components';
import { codexLocal } from '@/store/rules';
import { useStore } from '@/store/store';
import { AgentGrid } from './skills/AgentGrid';
import { Matrix } from './skills/Matrix';
import { readSkillsView, SKILLS_VIEWS, writeSkillsView, type SkillsView } from './skills/model';
import { SkillGrid } from './skills/SkillGrid';
import { Summary } from './skills/Summary';
import { SkillForm } from './system/SkillForm';
import './system/skills.css';

/**
 * Models and skills: the model mix and three facts, then the same agents and skills from three sides: by agent
 * (model picker and skill chips), by skill (grouped cards, search) and as a coverage matrix. Slice: system.
 */
export function Skills() {
  const local = useStore(codexLocal);
  const guard = useStore(s => s.guard);
  const sample = useStore(s => s.sample);
  const [view, setView] = useState<SkillsView>(readSkillsView);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const pick = (v: SkillsView) => { setView(v); writeSkillsView(v); };
  return (
    <>
      <div className="sx-intro">
        <p className="lede">Choose agent models and skills.{sample ? " Changes apply to each agent's next job." : ''}</p>
        {sample ? null : (
          <Info label="What changes a job today">
            {local ? 'AI agents use the model configured in Codex local. The API model choices are kept for API mode. ChatGPT usage limits apply. ' : 'Agent jobs call OpenAI Responses API with the selected OpenAI model. GPT-6 Luna handles simple tasks; GPT-6.1 Sol is the balanced default for articles and site identity; GPT-6 Astra is available for demanding tasks when you select it. '}Assigned built-in skills apply to the next AI call. Required task guidelines always remain active. Added catalog entries do not load instructions. Site Builder uses Material 3 tokens in its HTML/CSS template; it asks AI for identity and photos. Agents marked Planned do not run.
          </Info>
        )}
      </div>
      <Summary />
      <div className="sh sx-bar-row">
        <Tabs label="View" value={view} onChange={pick} items={SKILLS_VIEWS.map(([id, label, icon]) => ({ id, label, icon }))} />
        <span className="grow" />
        {view === 'skills' ? <SearchField label="Search skills" placeholder="Search skills" value={q} onChange={e => setQ(e.target.value)} /> : null}
        <Button variant="filled" icon="add" onClick={() => { if (guard()) setAdding(true); }}>Add skill</Button>
      </div>
      {view === 'agents' ? <AgentGrid /> : view === 'skills' ? <SkillGrid q={q} /> : <Matrix />}
      <SkillForm open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

import { useState } from 'react';
import { AgentAvatar } from '@/components/AgentAvatar';
import { Icon, IconButton, Select } from '@/components';
import { MODELS, PROV } from '@/store/constants';
import { agentPlanned, codexLocal, runtimeModel, provOK, provOf, skillClash, tierOf } from '@/store/rules';
import { useStore } from '@/store/store';
import type { Agent } from '@/store/types';
import { EFFECT_TEXT, executionModel, missingKey, modelEffect, priceText, TIER_NAME } from './model';
import { AgentSkillsSheet } from './Sheets';
import { BUILTIN_SKILLS, REQUIRED_SKILLS, executionSkills } from '../../../../shared/agent-skills';

/** "By agent": one card per agent with its status, its model (the picker) and its skills. */
export function AgentGrid() {
  const agents = useStore(s => s.agents);
  const sample = useStore(s => s.sample);
  const local = useStore(codexLocal);
  const guard = useStore(s => s.guard);
  const [editId, setEditId] = useState<string | null>(null);
  const edit = (id: string) => { if (guard()) setEditId(id); };

  const planned = agents.filter(a => agentPlanned({ sample }, a)), active = agents.filter(a => !planned.includes(a));
  return (
    <>
      {active.length ? (
        <section className="sx-sec" data-group="active">
          <div className="sx-sec-head"><h2>{planned.length ? 'Active agents' : 'Agents'}</h2><span className="sx-count">{active.length}</span></div>
          <div className="sx-grid">{active.map(a => <AgentCard key={a.id} a={a} planned={false} onSkills={() => edit(a.id)} />)}</div>
        </section>
      ) : null}
      {planned.length ? (
        <section className="sx-sec" data-group="planned">
          <div className="sx-sec-head"><h2>Planned agents</h2><span className="sx-count">{planned.length}</span><p className="sx-cap">No job runner yet. Their settings are kept for when they run.</p></div>
          <div className="sx-grid">{planned.map(a => <AgentCard key={a.id} a={a} planned onSkills={() => edit(a.id)} />)}</div>
        </section>
      ) : null}
      <p className="note">{local ? 'Codex local uses the model configured on this computer for all AI agents.' : 'OpenAI models are listed here. Connect the OpenAI API key in Integrations to run agent jobs.'}</p>
      <AgentSkillsSheet id={editId} onClose={() => setEditId(null)} />
    </>
  );
}

function AgentCard({ a, planned, onSkills }: { a: Agent; planned: boolean; onSkills: () => void }) {
  const skills = useStore(s => s.skills);
  const ints = useStore(s => s.ints);
  const live = useStore(s => s.live);
  const sample = useStore(s => s.sample);
  const setAgentModel = useStore(s => s.setAgentModel);

  const local = !sample && codexLocal({live});
  const conn = { ints, live };
  const tier = tierOf(a.model), price = priceText(a.model);
  const effect = modelEffect({ sample }, a);
  const usesModel = sample || effect === 'next-job';
  const options = MODELS.map(m => ({ value:m, label:m + (usesModel && !provOK(conn,provOf(m)) ? ' (key missing)' : '') }));
  const needsKey = local || planned || !usesModel ? null : missingKey(conn, a);
  const clash = skillClash({ skills }, a), only = clash[0]?.only;
  const execution = executionModel({sample,live},a);
  const mine = a.skills.map(id => skills.find(k => k.id === id)).filter(k => !!k);

  return (
    <article className={'sx-card sx-agent h' + a.hue + (planned ? ' planned' : '')} data-agent={a.id}>
      <header className="sx-who">
        <span className="sx-ava agent-portrait" aria-hidden="true"><AgentAvatar a={a} state={planned ? 'planned' : a.status} portrait /></span>
        <h3>{a.name}</h3>
        <span className={'sx-status ' + (planned ? 'planned' : 'active')}>{planned ? 'Planned' : 'Active'}</span>
        <p title={a.role}>{a.role}</p>
      </header>

      <div className="sx-block">
        <span className="sx-label">{local ? usesModel ? 'Local runtime model' : 'Execution' : 'Configured API model'}</span>
        <div className={'sx-model t' + tier}>
          {local ? <b>{usesModel ? runtimeModel({live}, a.model) : 'Built-in code'}</b> : <Select id={'md-' + a.id} label={'Model for ' + a.name} value={a.model} options={options} onChange={m => setAgentModel(a.id, m)} />}
        </div>
        {local ? null : <p className="sx-cap sx-price">{TIER_NAME[tier]}{price ? ` · ${price} per 1M tokens` : ''}</p>}
        {needsKey ? <p className="sx-warn"><Icon name="warning" fill />Needs the {needsKey} key. Add it in Integrations.</p> : null}
        {only ? <p className="sx-warn"><Icon name="warning" fill />{clash.map(k => k.name).join(', ')} {clash.length === 1 ? 'is' : 'are'} written for {PROV[only].name}.</p> : null}
        <div className="sx-execution" data-fallback={execution.fallback}><span className="sx-label">Execution engine</span><b>{execution.label}</b><p className="sx-cap">{execution.detail}</p></div>
        {effect ? <p className={'sx-effect ' + effect}><Icon name={effect === 'next-job' ? 'check_circle' : effect === 'code' ? 'code' : 'schedule'} />{effect === 'next-job' && local ? 'Uses the local runtime model' : effect === 'next-job' && execution.fallback ? 'Uses the configured OpenAI model' : EFFECT_TEXT[effect]}</p> : null}
      </div>

      <div className="sx-block">
        <span className="sx-label">Skills<span className="sx-count">{mine.length}</span></span>
        <div className="sx-chips">
          {mine.map(k => <span key={k.id} className="sx-chip" data-skill={k.id}>{k.name}</span>)}
          {mine.length ? null : <span className="sx-cap">No skills yet</span>}
          <IconButton icon="add" className="sx-add" label={'Change skills for ' + a.name} title="Add or remove optional assignments" onClick={onSkills} />
        </div>
        {!sample && REQUIRED_SKILLS[a.id] ? <p className="sx-cap">Loaded on the next AI call: {executionSkills(a.id, a.skills).join(', ')}. Required guidelines stay active. {mine.some(k => !BUILTIN_SKILLS[k.id]) ? 'Custom catalog entries are not executable.' : ''}</p> : null}
      </div>
    </article>
  );
}

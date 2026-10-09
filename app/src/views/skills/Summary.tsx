import { engineName, localRuntime, runtimeModel } from '@/store/rules';
import { useStore } from '@/store/store';
import { facts, MODEL_AGENTS, mixText, modelMix, TIER_NAME } from './model';

/** The top of Models and skills: the model mix as one bar, three facts, and Switch provider. */
export function Summary() {
  const agents = useStore(s => s.agents);
  const skills = useStore(s => s.skills);
  const ints = useStore(s => s.ints);
  const live = useStore(s => s.live);
  const sample = useStore(s => s.sample);

  const local = !sample && localRuntime({live});
  const mix = modelMix(local ? agents.map(a => ({...a,model: MODEL_AGENTS.has(a.id) ? runtimeModel({live}, a.model) : 'Built-in code'})) : agents);
  const f = facts({ agents, skills, ints, live, sample });
  const unused = f.skills - f.assigned;
  return (
    <section className="sx-sum" aria-label="Summary">
      <div className="sx-sum-head">
        <h2>Model mix</h2>
        <span className="sx-cap">{f.agents} {f.agents === 1 ? 'agent' : 'agents'} by configured model</span>
        <span className="grow" />
      </div>
      <div className="sx-sum-body">
        <div className="sx-mix">
          {mix.length ? (
            <>
              <div className="sx-bar" role="img" aria-label={'Model mix. ' + mixText(mix)}>
                {mix.map(p => <span key={p.model} className={'sx-seg t' + p.tier} style={{ flexGrow: p.n }} title={`${p.model}: ${p.agents.join(', ')}`}>{p.n}</span>)}
              </div>
              <ul className="sx-legend">
                {mix.map(p => (
                  <li key={p.model} data-model={p.model}>
                    <i className={'sx-tdot t' + p.tier} aria-hidden="true" />
                    <span className="sx-lg-name"><b>{p.short}</b><span className="sx-lg-n">{p.n} {p.n === 1 ? 'agent' : 'agents'}</span></span>
                    <span className="sx-cap">{local ? p.model === 'Built-in code' ? 'No AI call' : engineName(live.engine?.mode) : TIER_NAME[p.tier]}{!local && p.price ? ' · ' + p.price : ''}</span>
                  </li>
                ))}
              </ul>
              <p className="sx-cap sx-foot">{local ? 'Local runtime model for AI jobs.' : 'USD per 1M tokens · input / output.'}</p>
            </>
          ) : <p className="sx-cap">No agents yet.</p>}
        </div>
        <dl className="sx-facts">
          <div data-fact="agents">
            <dt>Agents</dt>
            <dd><b>{f.agents}</b><span>{f.planned ? `${f.active} active · ${f.planned} planned` : 'All active'}</span></dd>
          </div>
          <div data-fact="skills">
            <dt>Skills</dt>
            <dd><b>{f.skills}</b><span>{unused ? `${f.assigned} assigned · ${unused} unused` : 'All assigned'}</span></dd>
          </div>
          <div data-fact="providers">
            <dt>Providers</dt>
            <dd><b>{f.connected.length}<small> of {f.providers}</small></b><span>{f.connected.length ? local ? engineName(live.engine?.mode) + ' connected' : f.connected.join(', ') + ' connected' : 'None connected yet'}</span></dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

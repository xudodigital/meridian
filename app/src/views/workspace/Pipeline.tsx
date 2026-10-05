import { Button, Empty, Icon, Info, Pill } from '@/components';
import { go } from '@/nav';
import { useStoreShallow } from '@/store/store';
import { WorkspaceRuns } from '../workflows/WorkspaceRuns';
import { pipeData, type StageCount } from './helpers';

/** One stage of the pipeline. The two human gates are buttons that open their view. */
function StageItem({ c }: { c: StageCount }) {
  const st = c.st;
  const body = (
    <>
      <span className="ico"><Icon name={st.icon} /></span>
      <span className="pt"><b className="n">{c.n}</b><span className="l">{st.label}</span><span className="flag">{c.flag ? <Pill kind={c.flag.kind}>{c.flag.text}</Pill> : null}</span></span>
      <span className="docs" aria-hidden="true">{Array.from({ length: Math.min(c.n, 6) }, (_, i) => <i key={i} />)}</span>
    </>
  );
  const view = st.view;
  return view
    ? <button type="button" className="pst" data-s={st.id} data-n={c.n} data-k={c.k} aria-label={`${st.label}: ${c.n}. Open`} onClick={() => go(view)}>{body}</button>
    : <div className="pst" data-s={st.id} data-n={c.n} data-k={c.k}>{body}</div>;
}

/** The content pipeline section (the prototype's pipeHTML and pipeUpd). */
export function Pipeline() {
  const [agents, articles, approvals, sites, siteFilter, autoPub, sample, live] = useStoreShallow(s => [s.agents, s.articles, s.approvals, s.sites, s.siteFilter, s.autoPub, s.sample, s.live] as const);
  const d = pipeData({ agents, articles, approvals, sites, siteFilter, autoPub, sample, live });
  /* Outside demo mode a pipeline of zeros is replaced by a sentence. */
  if (!sample && d.every(c => c.n === 0)) {
    return (
      <section>
        <div className="sh"><h2>Content pipeline</h2></div>
        <WorkspaceRuns />
        <Empty icon="conveyor_belt" title="Nothing is in the pipeline"
          action={sites.length
            ? <Button variant="tonal" icon="add" onClick={() => go('keywords')}>New research request</Button>
            : <Button variant="tonal" icon="language" onClick={() => go('sites')}>Add your first domain</Button>}>
          Its stages fill in when agents start work for a site.
        </Empty>
      </section>
    );
  }
  return (
    <section>
      <div className="sh"><h2>Content pipeline</h2><span className="note">Jobs in progress at each stage{siteFilter === 'all' ? '' : ' for this site'}</span></div>
      <WorkspaceRuns />
      <div className="pipe" id="pipe" data-run={agents.some(a => a.status === 'work') ? '1' : '0'}>
        {d.map(c => <StageItem key={c.st.id} c={c} />)}
      </div>
      <Info label="How the stages are counted"><p>{sample
        ? 'Agent stages count running workers. Human review and Deploy approval count items waiting for a person; Published counts this session.'
        : 'Agent stages count jobs running now. Human review counts articles that are being written or wait for a decision, and Deploy approval counts website builds waiting for a person.'}</p></Info>
    </section>
  );
}

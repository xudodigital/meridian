import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Icon, SheetActions } from '@/components';
import { go } from '@/nav';
import { leaveEdit } from '@/store/editGuard';
import { siteBuilds } from '@/store/builds';
import { artOpen, stamp } from '@/store/rules';
import { useStore } from '@/store/store';
import type { BuildWire } from '@/store/types';
import { cfState, mayWrite } from '../deploy/parts';
import { BuildItem } from '../deploy/WebsiteSection';
import { RejectBuildSheet } from '../deploy/RejectBuildSheet';
import { KwResultSheet } from '../research/KwResultSheet';
import { RunCard } from '../workflows/RunCard';
import { journeyFor } from './model';
import { closeJourney, openJourney, useJourney } from './state';
import './journey.css';

export function JourneyDialog() {
  const heading = useRef<HTMLHeadingElement>(null);
  const target = useJourney(s => s.target);
  useEffect(() => { heading.current?.focus({preventScroll:true}); const dialog = heading.current?.closest('dialog'); if (dialog) dialog.scrollTop = 0; }, [target?.kind, target?.id]);
  const state = useStore();
  const [result, setResult] = useState<number | null>(null);
  const [reject, setReject] = useState<BuildWire | null>(null);
  const j = target ? journeyFor(state, target) : null;
  const a = j?.article, b = j?.build;
  const site = j && state.sites.find(s => s.id === j.site && s.domain === j.domain);
  const list = site ? siteBuilds(state.live.builds, site) : [];
  const openArticle = () => {
    if (!a) return;
    leaveEdit(() => {
      state.setShowArchived(!!a.archived);
      state.selectArticle(a.id, artOpen(a) ? 'open' : 'done');
      closeJourney(); go('review');
    });
  };
  return <>
    <Dialog open={!!target} onClose={closeJourney} className="journey-dialog" label="Work journey" backdropClose>
      <header className="journey-head"><div><span className="journey-eyebrow">{state.sample ? 'Demo work journey' : 'Work journey'}</span><h2 ref={heading} tabIndex={-1}>{j?.title || 'Record unavailable'}</h2><p>{j?.domain}</p></div><Button variant="text" icon="close" aria-label="Close work journey" onClick={closeJourney}>Close</Button></header>
      {j ? <>
        <div className="journey-now"><Icon name="route" /><div><h3>Current state</h3><p>{j.message}</p></div></div>
        {a ? <section className="journey-quality" aria-label="Article quality checks"><h3>Quality checkpoints</h3><dl><div><dt>Automated checks</dt><dd>{a.checks.filter(c => c[0] === 'ok').length} / {a.checks.length} pass</dd></div><div><dt>Native-language review</dt><dd>{a.native.st === 'done' ? 'Completed' : 'Not completed'}</dd></div><div><dt>Sources</dt><dd>{a.live ? state.live.arts[a.live.aid]?.content?.sources.length ?? 'Not loaded' : 'Demo excerpt'}</dd></div></dl><p className="note">Check the sources and read the article before approval. These checkpoints do not verify every factual claim or predict search rankings.</p></section> : null}
        {a ? <div className="journey-action"><p>{a.status === 'review' ? 'Check sources, automated checks and native-language review before making a decision.' : 'Open the article for its content, checks and available actions.'}</p><Button variant="filled" icon="article" onClick={openArticle}>Open this article</Button></div> : null}
        {j.request?.rid != null ? <div className="journey-action"><p>{j.request.st === 'done' ? 'Review the research and choose keywords to turn into articles.' : j.request.st === 'failed' ? 'Read the error and retry when its cause is resolved.' : 'The request is tracked here while the agent works.'}</p>{['done','failed'].includes(j.request.st) ? <Button variant="filled" onClick={() => setResult(j.request!.rid!)}>{j.request.st === 'done' ? 'Open research result' : 'Open request error'}</Button> : null}</div> : null}
        {target?.kind === 'deploy' && state.sample ? <Button variant="tonal" onClick={() => { closeJourney(); go('website'); }}>Open demo deployments</Button> : null}
        {b ? <section aria-label="Selected build"><h3>This build</h3><ul className="web-builds"><BuildItem b={b} cf={cfState(state)} write={mayWrite(state) && !!site} list={list} onReject={setReject} /></ul></section> : null}
        {j.workflow ? <RunCard run={j.workflow} detail /> : null}
        {target?.kind === 'sites' ? <Button variant="tonal" onClick={() => leaveEdit(() => { state.setSiteFilter(j.site); state.setSmode('list'); closeJourney(); go('sites'); })}>Open this site's list</Button> : null}
        <section><h3>{target?.kind === 'sites' ? 'Site activity' : 'Connected records'}</h3><p className="note">{state.sample ? 'Example records. Demo data does not contain full production lineage.' : 'Connections use saved record IDs. A missing record is not proof that a step was skipped.'}</p>
          <div className="journey-groups">{j.groups.map(g => <section key={g.label}><h4>{g.label} <span>{g.links.length}</span></h4>{g.links.length ? <ul>{g.links.map(r => <li key={r.id}><button type="button" aria-current={r.kind === target?.kind && r.id === target.id ? 'true' : undefined} onClick={() => openJourney(r)}><span>{r.title}<small>{r.status}</small></span><Icon name="arrow_forward" /></button></li>)}</ul> : <p className="note">No connected record loaded.</p>}</section>)}</div>
        </section>
        <details className="journey-history"><summary>Recorded history ({j.events.length})</summary>{j.events.length ? <ol>{j.events.map((e,i)=><li key={i}><time>{stamp(e.at)}</time><span>{e.text}</span></li>)}</ol> : <p className="note">No history loaded for this record.</p>}</details>
      </> : <p>This record is no longer loaded, is outside your site filter, or is unavailable to your role.</p>}
      <SheetActions><Button variant="text" onClick={closeJourney}>Close</Button></SheetActions>
      <KwResultSheet rid={j ? result : null} onClose={() => setResult(null)} />
      <RejectBuildSheet build={j ? reject : null} onClose={() => setReject(null)} />
    </Dialog>
  </>;
}

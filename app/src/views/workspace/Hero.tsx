import { Button, Icon } from '@/components';
import { go } from '@/nav';
import { artVisible, cnt, short, totalTok, waitN } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import { heroCopy } from './helpers';

/**
 * The hero block of the Workspace: headline, the main buttons and the live counters. Outside demo mode it shows what
 * is real: pausing does not stop a server job, so there is no "Pause all" (agents paused earlier can be resumed), the
 * approved articles are counted, and "Tokens today" is the sum of the server's spend ledger (store/spend.ts).
 */
export function Hero({ onAdd, summaryOnly = false }: { onAdd: () => void; summaryOnly?: boolean }) {
  const [agents, sites, articles, approvals, siteFilter, sample, live, openConfirm, resumeAll] = useStoreShallow(s =>
    [s.agents, s.sites, s.articles, s.approvals, s.siteFilter, s.sample, s.live, s.openConfirm, s.resumeAll] as const);
  const setWsMode = useStore(s => s.setWsMode);
  const wsMode = useStore(s => s.wsMode);
  const nrev = articles.filter(a => artVisible({ sites, siteFilter }, a) && a.status === 'review').length;
  const copy = heroCopy({ sample, agents, sites, live });
  return (
    <section className={'hero' + (summaryOnly ? ' workspace-metrics' : '')} aria-label={summaryOnly ? 'Workspace status' : undefined}>
      {summaryOnly ? null : <div>
        <span className="eyebrow"><i />{copy.eyebrow}</span>
        <h2>{copy.title}</h2>
        <p className="sub">{copy.sub}</p>
        <div className="row">
          {wsMode !== 'office' ? <Button size="lg" variant={sites.length ? "onhero" : "ghost"} icon="meeting_room" onClick={() => setWsMode('office')}>Open visual office</Button> : null}
          {sites.length ? null : <Button size="lg" variant="onhero" icon="language" onClick={() => go('sites')}>Add your first domain</Button>}
          {sample ? <Button size="lg" variant={sites.length && wsMode === 'office' ? 'onhero' : 'ghost'} icon="add" onClick={onAdd}>Add agent</Button> : null}
          {sample || sites.length ? <Button size="lg" variant={!sample && wsMode === 'office' ? 'onhero' : 'ghost'} icon="rate_review" onClick={() => go('review')}>Review queue{nrev ? ` (${nrev})` : ''}</Button> : null}
          {sample ? null : <Button size="lg" variant="ghost" icon="add" onClick={onAdd}>Add agent</Button>}
          {sample && agents.some(a => a.status !== 'off')
            ? <Button size="lg" variant="ghost" icon="pause_circle" onClick={() => openConfirm('all:pause')}>Pause all</Button>
            : agents.some(a => a.status === 'off') ? <Button size="lg" variant="ghost" icon="play_circle" onClick={resumeAll}>Resume all</Button> : null}
        </div>
      </div>}
      <div className={sample ? 'kpis' : 'kpis five'}>
        <div className="kpi"><Icon name="bolt" /><b id="k-work">{cnt({ agents }, 'work')}</b><span className="l">Working now</span></div>
        <div className="kpi"><Icon name="front_hand" /><b id="k-wait">{waitN({ approvals, articles, sites, siteFilter, live, sample })}</b><span className="l">Needs approval</span></div>
        {sample
          ? <div className="kpi"><Icon name="toll" /><b id="k-tok">{short(totalTok({ agents }))}</b><span className="l">Tokens today</span></div>
          : <>
            <div className="kpi"><Icon name="task_alt" /><b id="k-done">{articles.filter(a => artVisible({ sites, siteFilter }, a) && a.status === 'approved').length}</b><span className="l">Articles approved</span></div>
            <div className="kpi"><Icon name="toll" /><b id="k-tok">{short(totalTok({ agents }))}</b><span className="l">Tokens today</span></div>
          </>}
        <div className="kpi"><Icon name="error" /><b id="k-err">{cnt({ agents }, 'err')}</b><span className="l">Errors</span></div>
      </div>
    </section>
  );
}

import { Empty, Pill, SiteChip } from '@/components';
import { inSite, liveVer, siteById } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { Approval, Deploy } from '@/store/types';
import { BuildTimeline } from '../deploy/BuildTimeline';

/**
 * The prototype's timelineHTML(): one track per site, oldest version on the left, then the deploys waiting for
 * approval. Outside demo mode the versions are the server's website builds.
 */
export function DeployTimeline() {
  const sample = useStore(s => s.sample);
  return sample ? <SampleTimeline /> : <BuildTimeline />;
}

function SampleTimeline() {
  const [deploys, approvals, sites, siteFilter] = useStoreShallow(s => [s.deploys, s.approvals, s.sites, s.siteFilter] as const);
  const ids = [...new Set(deploys.map(d => d.site))].filter(id => siteById({ sites }, id) && inSite({ siteFilter }, id));
  if (!ids.length) return <Empty>{deploys.length ? 'No deploys yet for this site.' : 'No deploys yet. The timeline shows each site\'s versions once the first one goes live.'}</Empty>;
  return (
    <div className="tl">
      {ids.map(id => (
        <TimelineRow key={id} id={id} list={deploys.filter(d => d.site === id).sort((x, y) => x.ver - y.ver)} lv={liveVer({ deploys }, id)}
          pend={approvals.filter(p => p.site === id && p.kind === 'Deploy')} />
      ))}
    </div>
  );
}

function TimelineRow({ id, list, lv, pend }: { id: string; list: Deploy[]; lv: number; pend: Approval[] }) {
  return (
    <div className="tlrow">
      <div className="sh"><SiteChip id={id} /><span className="note">v{lv} is live</span></div>
      <div className="tltrack">
        {list.map(d => (
          <div key={d.id} className={'tln ' + (d.live ? 'live' : d.ver > lv ? 'rb' : '')}>
            <b>v{d.ver}{d.live ? ' · live' : ''}</b>
            <span>{d.when} · {d.what}</span>
            <span className="row">{d.ver > lv ? <Pill kind="warn">Rolled back</Pill> : null}<RankPill rank={d.rank} /></span>
          </div>
        ))}
        {pend.map(p => (
          <div key={p.id} className="tln pend"><b>Next</b><span>{p.what}</span><span className="row"><Pill kind="info">Waiting for approval</Pill></span></div>
        ))}
      </div>
    </div>
  );
}

function RankPill({ rank }: { rank: number | undefined }) {
  if (rank == null) return <Pill kind="mut">Rank effect: measuring</Pill>;
  return rank > 0
    ? <Pill kind="ok">Up {rank.toFixed(1)} positions after 7 days</Pill>
    : <Pill kind="bad">Down {Math.abs(rank).toFixed(1)} positions after 7 days</Pill>;
}

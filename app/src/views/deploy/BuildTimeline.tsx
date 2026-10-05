/* "Deploy timeline" on Build and deploy outside demo mode, made from the server's website builds. Demo mode keeps the
   prototype's timeline (views/sites/DeployTimeline.tsx). */
import { Empty, Pill, SiteChip } from '@/components';
import { deploying, siteBuilds } from '@/store/builds';
import { inSite, stamp } from '@/store/rules';
import { useStoreShallow } from '@/store/store';
import type { BuildWire, Site } from '@/store/types';
import { RankEffect } from '../research/RankEffect';
import { articlesText, liveVersion, wentLive } from './parts';

/** One track per site that has had a version live, oldest on the left, then the builds waiting for approval. */
export function BuildTimeline() {
  const [builds, sites, siteFilter] = useStoreShallow(s => [s.live.builds, s.sites, s.siteFilter] as const);
  const tracks = sites.filter(s => inSite({ siteFilter }, s.id)).map(s => [s, siteBuilds(builds, s)] as const).filter(([, list]) => list.some(wentLive));
  if (!tracks.length) return <Empty>No deploys yet. The timeline shows each site's versions once the first one goes live.</Empty>;
  return <div className="tl">{tracks.map(([s, list]) => <BuildTrack key={s.id} site={s} list={list} />)}</div>;
}

function BuildTrack({ site, list }: { site: Site; list: readonly BuildWire[] }) {
  const lv = liveVersion(list), asc = [...list].reverse();
  /* Versions that went live, and approved ones newer than the live version; older approved ones that never went live are left out. */
  const nodes = asc.filter(b => wentLive(b) || (b.review === 'approved' && b.version > lv));
  const pend = asc.filter(b => b.status === 'ready' && b.review === 'waiting');
  return (
    <div className="tlrow">
      <div className="sh"><SiteChip id={site.id} /><span className="note">{lv ? `v${lv} is live` : 'No version is live'}</span></div>
      <div className="tltrack">
        {nodes.map(b => (
          <div key={b.id} className={'tln ' + (b.deploy === 'live' ? 'live' : b.version > lv && wentLive(b) ? 'rb' : '')}>
            <b>v{b.version}{b.deploy === 'live' ? ' · live' : ''}</b>
            <span>{stamp(b.deployedAt ?? b.decidedAt ?? b.createdAt)} · {articlesText(b.articles.length)}</span>
            <span className="row">
              {b.version > lv && wentLive(b) ? <Pill kind="warn">Rolled back</Pill> : null}
              {wentLive(b) ? <RankEffect buildId={b.id} /> : null}
              {wentLive(b) ? null : deploying(b) ? <Pill kind="info" live>Deploying</Pill> : b.deploy === 'failed' ? <Pill kind="bad">Deploy failed</Pill> : <Pill kind="mut">Not deployed</Pill>}
            </span>
          </div>
        ))}
        {pend.map(b => (
          <div key={b.id} className="tln pend"><b>Next</b><span>v{b.version} · {articlesText(b.articles.length)}</span><span className="row"><Pill kind="info">Waiting for approval</Pill></span></div>
        ))}
      </div>
    </div>
  );
}

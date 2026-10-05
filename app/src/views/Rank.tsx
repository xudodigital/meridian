import { Callout, Empty, Icon, Pager, Pill, SiteChip, Table, usePaged } from '@/components';
import { go } from '@/nav';
import { dayLabel, num, pagePath, useRank, type RankRowWire, type RankState, type RankWire } from '@/store/insightsApi';
import { MOD_EMPTY, inSite } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { Site } from '@/store/types';
import { ModLede, ModSection, SourceCallout } from './research/ModPage';
import { RankHeat } from './research/RankHeat';
import { signed } from './research/heatData';
import { ConnectAction } from './system/SiteDetail';
import './system/insights.css';

/**
 * The Rank tab of Analytics: heat map and tracked keywords. Demo mode is the prototype's vTable('rank') and
 * heatHTML(), lines 1551-1561 and 1582-1590. Otherwise the positions are the ones the server reads from Search
 * Console for each site's tracked keywords (GET /api/rank): the keywords of approved articles, and research keywords
 * marked "Track".
 */
export function Rank() {
  const sample = useStore(s => s.sample);
  if (!sample) return <LiveRank />;
  return (
    <>
      <ModLede id="rank" />
      <SourceCallout need="gsc" />
      <RankHeat />
      <ModSection id="rank" title="Tracked keywords" />
    </>
  );
}

/** Why a site has no positions to show, in words. Null when it has. */
export function rankReason(state: RankState): string | null {
  switch (state) {
    case 'ok': return null;
    case 'not-connected': return 'Search Console is not connected.';
    case 'no-keywords': return 'No tracked keywords yet: approve an article, or mark a research keyword with Track.';
    case 'no-property': return 'The connected Google account has no Search Console property for this domain.';
    case 'waiting': return 'The first figures are being read from Search Console.';
    default: return 'No data yet: Google needs a few days after a site goes live.';
  }
}

/** A position change with an arrow: up is good. "—" when there is nothing to compare. */
export function Change({ v }: { v: number | null }) {
  if (v === null) return <span className="chg none" title="Nothing to compare with yet">—</span>;
  const dir = v >= 0.05 ? 'up' : v <= -0.05 ? 'down' : 'flat';
  return (
    <span className={'chg ' + dir} title={dir === 'up' ? `Moved up ${v.toFixed(1)} positions` : dir === 'down' ? `Moved down ${Math.abs(v).toFixed(1)} positions` : 'No change'}>
      <Icon name={dir === 'up' ? 'arrow_upward' : dir === 'down' ? 'arrow_downward' : 'remove'} />{signed(v)}
    </span>
  );
}

type Line = { site: Site; k: RankRowWire };
const lines = (rank: RankWire, sites: readonly Site[]): Line[] =>
  sites.flatMap(site => (rank.sites[site.id]?.keywords ?? []).map(k => ({ site, k })))
    /* Keywords with a position first, best first; the ones Google has not shown yet after them. */
    .sort((x, y) => (x.k.position ?? 1e9) - (y.k.position ?? 1e9) || y.k.clicks - x.k.clicks || x.k.keyword.localeCompare(y.k.keyword));

function LiveRank() {
  const connected = useStore(s => !!s.live.ints.gsc?.connected);
  const [sites, siteFilter] = useStoreShallow(s => [s.sites, s.siteFilter] as const);
  const q = useRank(connected);
  const shown = sites.filter(s => inSite({ siteFilter }, s.id));
  const rows = q.data ? lines(q.data, shown) : [];
  const pg = usePaged('rank', rows, 25);
  const lede = <p className="lede">Positions of each site's tracked keywords, from Search Console. Meridian never queries Google to check a rank.</p>;

  if (!connected) {
    return (
      <>
        {lede}
        <Empty icon="leaderboard" title="Search Console is not connected" action={<ConnectAction go={() => go('integrations')} />}>{MOD_EMPTY.rank}</Empty>
      </>
    );
  }
  if (!sites.length) return <>{lede}<Empty icon="language" title="No sites yet">Add a domain in Sites. The keywords of its approved articles are tracked here.</Empty></>;
  if (q.isError) return <>{lede}<Callout icon="error" warn>{(q.error as Error).message}</Callout></>;
  const rank = q.data;
  /* Sites that have nothing to show, each with its reason; a site with keywords but no data keeps its rows too. */
  const reasons = rank ? shown.map(s => [s, rankReason(rank.sites[s.id]?.state ?? 'waiting')] as const).filter((x): x is readonly [Site, string] => !!x[1]) : [];
  const allSame = reasons.length === shown.length && new Set(reasons.map(r => r[1])).size === 1 ? rank?.sites[shown[0]?.id ?? '']?.state : undefined;
  const newest = rank ? shown.map(s => rank.sites[s.id]?.to ?? '').sort().at(-1) : '';
  return (
    <>
      {lede}
      <RankHeat rank={rank} />
      <section>
        <div className="sh"><h2>Tracked keywords</h2></div>
        {!rank ? <Table cols={['Keyword', 'Site', 'Position', '7 days', '28 days', 'Best page', 'Clicks']} rows={[]} loading />
          : !rows.length ? (
            allSame === 'no-keywords'
              ? <Empty icon="leaderboard" title="No tracked keywords yet">The keywords of approved articles are tracked by themselves. You can also mark a keyword of a research result with Track.</Empty>
              : allSame === 'no-property'
                ? <Empty icon="domain_disabled" title="No Search Console property">The connected Google account has no property for {shown.length === 1 ? shown[0]!.domain : 'these domains'}. Add and verify the domain in Search Console with that account.</Empty>
                : <Empty icon="leaderboard" title="No positions yet">{reasons[0]?.[1] ?? 'No data yet: Google needs a few days after a site goes live.'}</Empty>
          ) : (
            <>
              <Table
                cols={['Keyword', 'Site', 'Position', '7 days', '28 days', 'Best page', 'Clicks, 28 days']} num={[2, 3, 4, 6]}
                rowKey={(_, i) => pg.rows[i]!.site.id + ':' + pg.rows[i]!.k.keyword}
                rows={pg.rows.map(({ site, k }) => [
                  <><b>{k.keyword}</b>{k.source === 'tracked' ? <> <Pill kind="mut">Tracked by hand</Pill></> : null}{k.intent ? <span className="sub2">{k.intent}</span> : null}</>,
                  <SiteChip id={site.id} />,
                  k.position === null ? <span title="No impressions in the newest 7 days of data">—</span> : k.position.toFixed(1),
                  <Change v={k.change7} />, <Change v={k.change28} />,
                  k.page ? <span className="ins-url" title={k.page}>{pagePath(k.page)}</span> : '—',
                  num(k.clicks),
                ])}
              />
              <Pager pkey="rank" paged={pg} />
            </>
          )}
        {rows.length && reasons.length ? (
          <ul className="ins-states">{reasons.slice(0, 8).map(([s, why]) => <li key={s.id}><b>{s.domain}</b>: {why}</li>)}{reasons.length > 8 ? <li>And {reasons.length - 8} more sites without positions.</li> : null}</ul>
        ) : null}
        {rows.length ? (
          <p className="note">
            Position is the average over the newest 7 days of Search Console data{newest ? ` (to ${dayLabel(newest)})` : ''}; the changes compare it with the 7 days before, and with the 7 days that ended 28 days earlier. A dash means Google showed no result for the keyword then.
          </p>
        ) : null}
      </section>
    </>
  );
}

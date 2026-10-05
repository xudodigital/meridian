import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Callout, Empty, SiteChip, Table, Tile, Tiles } from '@/components';
import { go } from '@/nav';
import { dayLabel, insightsStale, num, pagePath, pct, useSiteInsights, type SearchLine, type SiteSearchWire } from '@/store/insightsApi';
import { MOD_EMPTY, MOD_EMPTY_HEAD, dayTime, inSite } from '@/store/rules';
import { servicesApi } from '@/store/servicesApi';
import { useStore, useStoreShallow } from '@/store/store';
import type { Site } from '@/store/types';
import { SourceCallout } from '../research/ModPage';
import { DayChart } from './DayChart';
import { ConnectAction, RefreshButton, SiteDetailHead, usePickedSite } from './SiteDetail';
import './insights.css';

/**
 * The Search Console tab outside demo mode: each site's 28-day totals, then one site's clicks per day, top pages and
 * top queries, read from the rows the server fetches once a day (GET /api/metrics/site/:id).
 */
export function SearchConsole() {
  const connected = useStore(s => !!s.live.ints.gsc?.connected);
  const known = useStore(s => s.live.metrics?.sites ?? null);
  const hasSites = useStore(s => s.sites.length > 0);
  const [sites, siteFilter] = useStoreShallow(s => [s.sites, s.siteFilter] as const);
  const rows = sites.filter(s => inSite({ siteFilter }, s.id) && !!known?.[s.id]);
  const p = usePickedSite(s => !!known?.[s.id]);
  const q = useSiteInsights(p.site?.id ?? null, connected);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  if (!connected) {
    return (
      <>
        <SourceCallout need="gsc" />
        <Empty icon={MOD_EMPTY_HEAD.gsc[0]} title={MOD_EMPTY_HEAD.gsc[1]} action={<ConnectAction go={() => go('integrations')} />}>{MOD_EMPTY.gsc}</Empty>
      </>
    );
  }
  if (!hasSites) return <Empty icon="language" title="No sites yet">Add a domain in Sites. Its Search Console figures appear here once Google has data for it.</Empty>;

  const refresh = async () => {
    if (!useStore.getState().guard()) return;
    setBusy(true);
    try { await servicesApi.refreshMetrics(); await insightsStale(qc); useStore.getState().snack('Reading Search Console again. Pages and queries follow in a moment.', 'refresh'); }
    catch (e) { useStore.getState().snack((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <section>
        <div className="sh"><h2>By site, last 28 days</h2></div>
        <Table
          cols={['Site', 'Clicks', 'Impressions', 'CTR', 'Average position']} num={[1, 2, 3, 4]} rowKey={(_, i) => rows[i]!.id}
          rows={rows.map(s => { const m = known![s.id]!; return [<SiteChip id={s.id} />, num(m.clicks28), num(m.impressions28), m.impressions28 ? pct(m.clicks28 / m.impressions28) : '0%', m.position28 ? m.position28.toFixed(1) : '—']; })}
          empty={known ? 'The connected Google account has no Search Console property for these sites. Add and verify each domain in Search Console with that account.' : 'Reading Search Console. The figures appear here in a moment.'}
        />
      </section>
      {p.site ? (
        <section>
          <SiteDetailHead title="Site detail" {...p} site={p.site}><RefreshButton busy={busy} onClick={refresh} /></SiteDetailHead>
          {q.data ? <SearchDetail site={p.site} g={q.data.gsc} /> : q.isError ? <Callout icon="error" warn>{(q.error as Error).message}</Callout> : <Table cols={['Page', 'Clicks', 'Impressions', 'CTR', 'Average position']} rows={[]} loading />}
        </section>
      ) : null}
    </>
  );
}

function SearchDetail({ site, g }: { site: Site; g: SiteSearchWire }) {
  if (g.state === 'no-property') {
    return <Empty icon="domain_disabled" title={`No Search Console property for ${site.domain}`}>The connected Google account has no property for this domain. Add and verify the domain in Search Console with that account, then refresh.</Empty>;
  }
  if (g.state === 'waiting') return <Empty icon="hourglass_top" title="Reading Search Console">{g.error || 'The first figures for this site are being fetched. They appear here in a moment.'}</Empty>;
  if (g.state !== 'ok') return <Empty icon="search" title="No data yet">Google needs a few days after a site goes live before it reports searches. Meridian asks again every day.</Empty>;
  const lines = (list: SearchLine[], path: boolean) => list.map(x => [<span className="ins-url" title={x.key}>{path ? pagePath(x.key) : x.key}</span>, num(x.clicks), num(x.impressions), pct(x.ctr), x.position ? x.position.toFixed(1) : '—']);
  return (
    <>
      {g.error ? <Callout icon="sync_problem" warn><b>The last refresh did not finish.</b> {g.error} The figures below are from the fetch before it.</Callout> : null}
      <Tiles>
        <Tile tone="a" value={num(g.totals.clicks)} label="Clicks" />
        <Tile tone="b" value={num(g.totals.impressions)} label="Impressions" />
        <Tile tone="c" value={pct(g.totals.ctr)} label="Click-through rate" />
        <Tile tone="d" value={g.totals.position ? g.totals.position.toFixed(1) : '—'} label="Average position" />
      </Tiles>
      <DayChart title="Clicks per day" unit="clicks" days={g.days.map(d => ({ date: d.date, value: d.clicks }))} />
      <div className="ins-two">
        <div>
          <h3>Top pages</h3>
          <Table cols={['Page', 'Clicks', 'Impressions', 'CTR', 'Average position']} num={[1, 2, 3, 4]} rowKey={(_, i) => g.pages[i]!.key} rows={lines(g.pages, true)} empty="Google reported no page with impressions in these 28 days." />
        </div>
        <div>
          <h3>Top queries</h3>
          <Table cols={['Query', 'Clicks', 'Impressions', 'CTR', 'Average position']} num={[1, 2, 3, 4]} rowKey={(_, i) => g.queries[i]!.key} rows={lines(g.queries, false)} empty="Google reported no query in these 28 days. It leaves out queries that very few people searched." />
        </div>
      </div>
      <p className="note">
        {dayLabel(g.from)} to {dayLabel(g.to)}, web search, from the property {g.property}. Search Console data is about 3 days behind.
        {g.fetchedAt ? ` Fetched ${dayTime(g.fetchedAt)}.` : ''} The totals count every search; pages and queries are Google's top rows and can add up to less.
        {g.truncated ? ' This site has more rows than Meridian keeps: the top 200,000 are stored.' : ''}
      </p>
    </>
  );
}

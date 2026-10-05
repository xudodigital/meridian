import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Callout, Empty, Pill, Select, SiteChip, Table, Tile, Tiles } from '@/components';
import { go } from '@/nav';
import { INSIGHTS_KEY, dayLabel, insightsApi, insightsStale, num, pct, useGa4, useSiteInsights, type Ga4OverviewWire, type SiteGa4Wire } from '@/store/insightsApi';
import { MOD_EMPTY, MOD_EMPTY_HEAD, dayTime, inSite } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { Site } from '@/store/types';
import { SourceCallout } from '../research/ModPage';
import { DayChart } from './DayChart';
import { ConnectAction, RefreshButton, SiteDetailHead, usePickedSite } from './SiteDetail';
import './insights.css';

const MATCH = '';

/**
 * The GA4 tab outside demo mode: which Analytics property belongs to each site (matched by domain, or chosen here),
 * each site's users and sessions of the last 28 days, then one site's sessions per day and top pages.
 */
export function Ga4() {
  const connected = useStore(s => !!s.live.ints.ga4?.connected);
  const [sites, siteFilter] = useStoreShallow(s => [s.sites, s.siteFilter] as const);
  const may = useStore(s => s.session?.role === 'admin' || s.session?.role === 'editor');
  const o = useGa4(connected);
  const p = usePickedSite(s => o.data?.sites[s.id]?.state === 'ok');
  const q = useSiteInsights(p.site?.id ?? null, connected);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  if (!connected) {
    return (
      <>
        <SourceCallout need="ga4" />
        <Empty icon={MOD_EMPTY_HEAD.ga4[0]} title={MOD_EMPTY_HEAD.ga4[1]} action={<ConnectAction go={() => go('integrations')} />}>{MOD_EMPTY.ga4}</Empty>
      </>
    );
  }
  if (!sites.length) return <Empty icon="language" title="No sites yet">Add a domain in Sites. Its Analytics figures appear here once a property is matched to it.</Empty>;

  const put = (v: Ga4OverviewWire) => qc.setQueryData([...INSIGHTS_KEY, 'ga4'], v);
  const refresh = async () => {
    if (!useStore.getState().guard()) return;
    setBusy(true);
    try { put(await insightsApi.ga4Refresh()); await insightsStale(qc); useStore.getState().snack('Analytics figures are up to date.', 'refresh'); }
    catch (e) { useStore.getState().snack((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const choose = async (site: Site, property: string) => {
    if (!useStore.getState().guard()) return;
    try { put(await insightsApi.ga4Map(site.id, property)); useStore.getState().snack(property ? `Reading the chosen property for ${site.domain}.` : `Matching ${site.domain} by domain again.`, 'analytics'); }
    catch (e) { useStore.getState().snack((e as Error).message, 'error'); }
  };

  const data = o.data, shown = sites.filter(s => inSite({ siteFilter }, s.id));
  const options = [{ value: MATCH, label: 'Match by domain' }, ...(data?.properties ?? []).map(x => ({ value: x.id, label: x.account ? `${x.name} (${x.account})` : x.name }))];
  return (
    <>
      {data?.error ? <Callout icon="sync_problem" warn><b>The last refresh did not finish.</b> {data.error}</Callout> : null}
      <section>
        <div className="sh"><h2>By site, last 28 days</h2><RefreshButton busy={busy} onClick={refresh} /></div>
        <Table
          cols={['Site', 'Property', 'Users', 'Sessions', 'Engaged sessions', 'Engagement rate']} num={[2, 3, 4, 5]}
          loading={o.isLoading} rowKey={(_, i) => shown[i]!.id}
          empty={o.isError ? (o.error as Error).message : undefined}
          rows={data ? shown.map(s => {
            const v = data.sites[s.id], ok = v?.state === 'ok';
            return [
              <SiteChip id={s.id} />,
              <PropertyCell site={s} v={v} may={may} options={options} onChoose={choose} />,
              ok ? num(v.totals.users) : '—', ok ? num(v.totals.sessions) : '—', ok ? num(v.totals.engaged) : '—', ok ? pct(v.totals.rate) : '—',
            ];
          }) : []}
        />
        {data && !data.properties.length && !data.error ? <p className="note">{data.fetchedAt ? 'The connected Google account has no Analytics property.' : 'Reading the properties of the connected Google account.'}</p> : null}
      </section>
      {p.site ? (
        <section>
          <SiteDetailHead title="Site detail" {...p} site={p.site} />
          {q.data ? <Ga4Detail site={p.site} g={q.data.ga4} /> : q.isError ? <Callout icon="error" warn>{(q.error as Error).message}</Callout> : <Table cols={['Page', 'Users', 'Sessions', 'Engagement rate']} rows={[]} loading />}
        </section>
      ) : null}
    </>
  );
}

function PropertyCell({ site, v, may, options, onChoose }: { site: Site; v: Ga4OverviewWire['sites'][string] | undefined; may: boolean; options: { value: string; label: string }[]; onChoose: (s: Site, property: string) => void }) {
  const how = !v?.property ? <Pill kind="warn">No property</Pill> : v.auto ? <span className="sub2">Matched by domain</span> : <span className="sub2">Chosen by a person</span>;
  if (!may || options.length < 2) return <>{v?.propertyName || null}{how}</>;
  return (
    <>
      <Select label={`Analytics property of ${site.domain}`} value={v && !v.auto ? v.property : MATCH} onChange={x => onChoose(site, x)} options={options} searchPlaceholder="Search properties" />
      {v?.auto ? <span className="sub2">Matched: {v.propertyName}</span> : !v?.property ? <span className="sub2">No property has this domain. Choose one.</span> : null}
      {v?.error ? <span className="sub2">{v.error}</span> : null}
    </>
  );
}

function Ga4Detail({ site, g }: { site: Site; g: SiteGa4Wire }) {
  if (g.state === 'no-property') {
    return <Empty icon="domain_disabled" title={`No Analytics property for ${site.domain}`}>No property of the connected Google account has a web data stream for this domain. Choose its property in the table above.</Empty>;
  }
  if (g.state === 'waiting') return <Empty icon="hourglass_top" title="Reading Google Analytics">{g.error || 'The figures of this property are being fetched. They appear here in a moment.'}</Empty>;
  if (g.state !== 'ok') return <Empty icon="monitoring" title="No data yet">The property {g.propertyName} has no sessions in the last 28 days. Check that the site has the Google tag of this property.</Empty>;
  return (
    <>
      {g.error ? <Callout icon="sync_problem" warn><b>The last refresh did not finish.</b> {g.error} The figures below are from the fetch before it.</Callout> : null}
      <Tiles>
        <Tile tone="a" value={num(g.totals.users)} label="Users" />
        <Tile tone="b" value={num(g.totals.sessions)} label="Sessions" />
        <Tile tone="c" value={num(g.totals.engaged)} label="Engaged sessions" />
        <Tile tone="d" value={pct(g.totals.rate)} label="Engagement rate" />
      </Tiles>
      <DayChart title="Sessions per day" unit="sessions" days={g.days.map(d => ({ date: d.date, value: d.sessions }))} />
      <div>
        <h3 className="ins-h3">Top pages</h3>
        <Table
          cols={['Page', 'Users', 'Sessions', 'Engaged sessions', 'Engagement rate']} num={[1, 2, 3, 4]} rowKey={(_, i) => g.pages[i]!.key}
          rows={g.pages.map(x => [<span className="ins-url">{x.key}</span>, num(x.users), num(x.sessions), num(x.engaged), pct(x.rate)])}
          empty="Analytics reported no page for these 28 days."
        />
      </div>
      <p className="note">
        {dayLabel(g.from)} to {dayLabel(g.to)}, from the property {g.propertyName}{g.auto ? ', matched by domain' : ''}.{g.fetchedAt ? ` Fetched ${dayTime(g.fetchedAt)}.` : ''} Users are counted once for the whole period, so the days do not add up to them. An engaged session lasted over 10 seconds, had a key event, or two or more page views.
      </p>
    </>
  );
}

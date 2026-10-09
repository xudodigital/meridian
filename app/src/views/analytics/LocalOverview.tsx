import { Empty, Table, Tile, Tiles } from '@/components';
import { fmt, short } from '@/store/rules';
import { useStore } from '@/store/store';
import { Card } from './parts';

/** Local inference is measured by work and token usage, not an invented API price. */
export function LocalOverview() {
  const s = useStore();
  const sites = s.sites.filter(x => s.siteFilter === 'all' || !s.siteFilter || x.id === s.siteFilter);
  const owns = (x: {siteId:string}) => sites.some(a => a.id === x.siteId);
  const runs = s.jobLog.filter(x => s.siteFilter === 'all' || !s.siteFilter || x.site === s.siteFilter);
  const articles = Object.values(s.live.arts).filter(owns);
  const knownClicks = (id: string) => s.live.metrics?.sites[id]?.clicks28;
  const measured = sites.filter(x => knownClicks(x.id) !== undefined);
  const gsc = measured.length > 0;
  const tokens = sites.reduce((n,x) => n + (s.live.spend?.sites[x.id]?.tokens28 || 0),0);
  return <>
    <p className="lede">Search performance, completed work and token usage.</p>
    <Tiles>
      <Tile tone="a" value={gsc ? fmt(measured.reduce((n,x) => n+(knownClicks(x.id) || 0),0)) : '—'} label="Organic clicks, 28 days" />
      <Tile tone="b" value={runs.length} label="Runs recorded" />
      <Tile tone="c" value={short(tokens)} label="Tokens used, 28 days" />
      <Tile tone="d" value={articles.filter(x => x.status === 'review').length} label="Articles awaiting review" />
    </Tiles>
    <Card title="By site">
      <Table cols={['Site','Country','Clicks, 28 days','Tokens, 28 days']} num={[2,3]} rows={sites.map(x => [x.domain,x.country,knownClicks(x.id) !== undefined ? fmt(knownClicks(x.id)!) : '—',short(s.live.spend?.sites[x.id]?.tokens28 || 0)])} empty={<Empty icon="monitoring" title="No sites yet">Add a site to track its work here.</Empty>} />
      {!gsc ? <p className="note">Connect Search Console to measure clicks.</p> : null}
    </Card>
    <Card title="Agent activity">
      <Table cols={['Agent','Runs today','Tokens today']} num={[1,2]} rows={s.agents.map(a => { const usage = s.live.spend?.agents[a.name]; return [a.name,usage?.runs || 0,short(usage?.tokens || 0)]; })} />
    </Card>
  </>;
}

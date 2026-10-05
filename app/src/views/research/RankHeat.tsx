import { Fragment } from 'react';
import type { RankWire } from '@/store/insightsApi';
import { useStoreShallow } from '@/store/store';
import { KG, LIVE_KG, heatRows, liveHeatRows, signed } from './heatData';
import '../system/insights.css';

const LEGEND = (
  <div className="lg">
    <span><i className="sq u2"></i>Up 2.5 or more</span><span><i className="sq u1"></i>Up</span><span><i className="sq z"></i>Flat</span><span><i className="sq d1"></i>Down</span><span><i className="sq d2"></i>Down 2.5 or more</span>
  </div>
);

/**
 * The heat map of Rank tracking: position change by country and intent. Demo mode draws the prototype's heatHTML()
 * from sample numbers; otherwise it is drawn from `rank` (the tracked keywords the server reads from Search Console),
 * and it is left out while no tracked keyword has a 7-day change (the table below says why).
 */
export function RankHeat({ rank }: { rank?: RankWire }) {
  const [sample, sites, siteFilter] = useStoreShallow(s => [s.sample, s.sites, s.siteFilter] as const);
  if (!sample) {
    const rows = liveHeatRows(rank, sites, siteFilter);
    if (!rows.length) return null;
    return (
      <section>
        <div className="sh"><h2>Position change by country and intent, 7 days</h2></div>
        <div className="heat" role="table" aria-label="Average position change of tracked keywords by country and keyword intent">
          <span></span>
          {LIVE_KG.map(([full, abr]) => <span key={full} className="hh"><span className="full">{full}</span><span className="abr" title={full}>{abr}</span></span>)}
          {rows.map(r => (
            <Fragment key={r.cc}>
              <span className="hr"><span className="cc sm" aria-hidden="true">{r.cc}</span>{r.name}</span>
              {r.cells.map(x => x.v === null
                ? <span key={x.group} className="hc na" title={`${r.name}, ${x.group}: no tracked keyword with a change yet`}>—</span>
                : <span key={x.group} className={'hc ' + x.cls} title={`${r.name}, ${x.group}: ${signed(x.v)} positions, ${x.n} keyword${x.n === 1 ? '' : 's'}`}>{signed(x.v)}</span>)}
            </Fragment>
          ))}
        </div>
        {LEGEND}
        <p className="note">Search Console positions: latest 7 days vs previous 7. Plus = moved up; dash = no comparison.</p>
      </section>
    );
  }
  const rows = heatRows({ sample, sites, siteFilter });
  if (!rows.length) return null;
  return (
    <section>
      <div className="sh"><h2>Position change by country and intent, 7 days</h2></div>
      <div className="heat" role="table" aria-label="Average position change by country and keyword intent">
        <span></span>
        {KG.map(([full, abr]) => <span key={full} className="hh"><span className="full">{full}</span><span className="abr" title={full}>{abr}</span></span>)}
        {rows.map(({ country: c, cells }) => (
          <Fragment key={c.cc}>
            <span className="hr"><span className="cc sm" aria-hidden="true">{c.cc}</span>{c.name}</span>
            {cells.map(x => <span key={x.group} className={'hc ' + x.cls} title={`${c.name}, ${x.group}: ${signed(x.v)} positions`}>{signed(x.v)}</span>)}
          </Fragment>
        ))}
      </div>
      {LEGEND}
      <p className="note">Average position change per country. Plus = moved up. Investigate widespread declines.</p>
    </section>
  );
}

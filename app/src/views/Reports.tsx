import { useState } from 'react';
import { Button, Pager, Pill, Table, Tile, Tiles, usePaged } from '@/components';
import { fmt } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import { CsvSheet } from './content/CsvSheet';
import { Delivery } from './content/Delivery';
import { LiveReport } from './content/LiveReport';
import { reportCSV, reportRows, type ReportRow } from './content/report';

type NumKey = 'clicks' | 'published' | 'waiting' | 'spend';
const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The Reports tab of Analytics: the weekly summary, CSV copy and scheduled delivery. Prototype: vReports() (1687-1697), reportRows() and reportCSV() (1682-1686), showCSV() (1983-1986). */
export function Reports() {
  const sample = useStore(s => s.sample);
  return sample ? <SampleReport /> : <LiveReport />;
}

/** Demo mode: the prototype's report from the sample data. */
function SampleReport() {
  const [sites, articles, settings, siteFilter] = useStoreShallow(s => [s.sites, s.articles, s.settings, s.siteFilter] as const);
  const sendReport = useStore(s => s.sendReport);
  const snack = useStore(s => s.snack);
  const [csv, setCsv] = useState<string | null>(null);

  const rows = reportRows({ sites, articles, settings, siteFilter });
  const sum = (k: NumKey) => rows.reduce((x, r) => x + r[k], 0);
  const byClicks = [...rows].sort((x, y) => y.clicks - x.clicks);
  const top = byClicks[0], bad = rows.filter(r => r.issue !== 'None');
  const waiting = sum('waiting');
  const pg = usePaged<ReportRow>('rep', byClicks);

  /* copy-csv: the clipboard when the browser allows it, otherwise a sheet with the text selected. */
  const copy = () => {
    const txt = reportCSV(rows);
    try { navigator.clipboard.writeText(txt).then(() => snack('Report copied as CSV'), () => setCsv(txt)); }
    catch { setCsv(txt); }
  };

  return (
    <>
      <div className="sh">
        <p className="lede">A weekly summary for people who never open the dashboard. Period: the last 7 days.</p>
        <span className="grow" />
        <Button variant="tonal" icon="content_copy" onClick={copy}>Copy as CSV</Button>
        <Button variant="filled" icon="send" onClick={sendReport}>Send now</Button>
      </div>
      <Tiles>
        <Tile tone="a" value={fmt(sum('clicks'))} label="Organic clicks" />
        <Tile tone="b" value={sum('published')} label="Articles published" />
        <Tile tone="c" value={waiting} label="Waiting for review" />
        <Tile tone="d" value={'$' + fmt(Math.round(sum('spend')))} label="Agent spend" />
      </Tiles>
      <section>
        <h2>By site</h2>
        <Table
          cols={['Site', 'Country', 'Clicks', 'Published', 'Waiting', 'Spend', 'Issue']}
          num={[2, 3, 4, 5]}
          empty={sites.length ? undefined : 'No sites yet, so there is nothing to report. Add a domain in Sites.'}
          rows={pg.rows.map(r => [
            <b>{r.site}</b>,
            r.country,
            fmt(r.clicks),
            String(r.published),
            String(r.waiting),
            money(r.spend),
            r.issue === 'None' ? <Pill kind="ok">None</Pill> : <Pill kind="warn">{r.issue}</Pill>,
          ])}
        />
        <Pager pkey="rep" paged={pg} />
      </section>
      <section>
        <h2>Highlights</h2>
        <ul className="checks">
          {top && top.clicks ? <li><Pill kind="ok">Top site</Pill><span>{top.site} brought {fmt(top.clicks)} clicks this week.</span></li> : null}
          {bad.length > 4 ? <li><Pill kind="warn">Needs attention</Pill><span>{bad.length} sites have an open issue. The first four are listed here.</span></li> : null}
          {bad.slice(0, 4).map(r => <li key={r.site}><Pill kind="warn">Needs attention</Pill><span>{r.site}: {r.issue}.</span></li>)}
          <li><Pill kind="info">Review</Pill><span>{waiting} article{waiting === 1 ? ' is' : 's are'} waiting for a person to approve.</span></li>
        </ul>
      </section>
      <Delivery />
      <CsvSheet csv={csv} onClose={() => setCsv(null)} />
    </>
  );
}

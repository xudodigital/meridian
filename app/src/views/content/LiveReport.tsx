import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Empty, Pager, Pill, Table, Tile, Tiles, usePaged } from '@/components';
import { go } from '@/nav';
import { REPORT_KEY } from '@/store/live';
import { dayTime, fmt, inSite } from '@/store/rules';
import { usableInt } from '@/store/serverFacts';
import { NO_EMAIL } from '@/store/slices/content';
import { servicesApi, type ServerReport } from '@/store/servicesApi';
import { useStore } from '@/store/store';
import { CsvSheet } from './CsvSheet';
import { Delivery } from './Delivery';

type Row = ServerReport['rows'][number];
const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function csvOf(rows: readonly Row[]): string {
  const esc = (v: string) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  return 'Site,Country,Clicks,Articles approved,Waiting for review,Spend (USD),Issue\n'
    + rows.map(r => [r.site, r.country, r.clicks === null ? '' : String(r.clicks), String(r.published), String(r.waiting), r.spend.toFixed(2), r.issue].map(esc).join(',')).join('\n');
}

/** Reports outside demo mode: the figures the server has for the last 7 days, the same ones the email carries. */
export function LiveReport() {
  const sid = useStore(s => s.session?.id ?? null);
  const siteFilter = useStore(s => s.siteFilter);
  const emailOk = useStore(s => usableInt(s, 'email'));
  const sendReport = useStore(s => s.sendReport);
  const snack = useStore(s => s.snack);
  const [csv, setCsv] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /* Finished jobs, decisions, checks and sent reports make it stale (live.ts invalidates REPORT_KEY on those events). */
  const q = useQuery({ queryKey: [...REPORT_KEY, sid], queryFn: servicesApi.report, enabled: !!sid, staleTime: 60_000 });
  const r = q.data;
  const rows = (r?.rows ?? []).filter(x => inSite({ siteFilter }, x.siteId));
  const byClicks = [...rows].sort((x, y) => (y.clicks ?? 0) - (x.clicks ?? 0) || x.site.localeCompare(y.site));
  const pg = usePaged<Row>('rep', byClicks);
  const sum = (k: 'published' | 'waiting' | 'spend') => rows.reduce((x, y) => x + y[k], 0);
  const clicks = rows.reduce((x, y) => x + (y.clicks ?? 0), 0);
  const bad = rows.filter(x => x.issue !== 'None');
  const top = r?.clicksKnown ? byClicks[0] : undefined;

  const copy = () => {
    const txt = csvOf(rows);
    try { navigator.clipboard.writeText(txt).then(() => snack('Report copied as CSV'), () => setCsv(txt)); }
    catch { setCsv(txt); }
  };
  const send = () => { setSending(true); sendReport(); setTimeout(() => setSending(false), 1500); };

  if (q.isError) return <Empty icon="error" title="The report could not be loaded" action={<Button variant="tonal" icon="refresh" onClick={() => { void q.refetch(); }}>Try again</Button>}>{(q.error as Error).message}</Empty>;
  return (
    <>
      <div className="sh">
        <p className="lede">A weekly summary for people who never open the dashboard. Period: the last 7 days{r ? `, ${dayTime(r.from)} to ${dayTime(r.to)}` : ''}.</p>
        <span className="grow" />
        <Button variant="tonal" icon="content_copy" disabled={!rows.length} onClick={copy}>Copy as CSV</Button>
        <Button variant="filled" icon="send" disabled={!emailOk || sending} title={emailOk ? undefined : NO_EMAIL} onClick={send}>{sending ? 'Sending…' : 'Send now'}</Button>
      </div>
      <Tiles>
        <Tile tone="a" value={r?.clicksKnown ? fmt(clicks) : '—'} label={r?.clicksKnown ? 'Organic clicks' : 'Organic clicks (connect Search Console)'} />
        <Tile tone="b" value={sum('published')} label="Articles approved" />
        <Tile tone="c" value={sum('waiting')} label="Waiting for review" />
        <Tile tone="d" value={money(sum('spend'))} label="API/service spend" />
      </Tiles>
      <section>
        <h2>By site</h2>
        <Table
          cols={['Site', 'Country', 'Clicks', 'Approved', 'Waiting', 'Spend', 'Issue']}
          num={[2, 3, 4, 5]}
          loading={q.isPending}
          empty={<Empty icon="summarize" title="Nothing to report yet" action={<Button variant="tonal" icon="language" onClick={() => go('sites')}>Open Sites</Button>}>There are no sites yet. Add a domain in Sites and its week is summarised here.</Empty>}
          rowKey={(_, i) => pg.rows[i]!.siteId}
          rows={pg.rows.map(x => [
            <b>{x.site}</b>, x.country, x.clicks === null ? <span className="note">Not connected</span> : fmt(x.clicks), String(x.published), String(x.waiting), money(x.spend),
            x.issue === 'None' ? <Pill kind="ok">None</Pill> : <Pill kind="warn">{x.issue}</Pill>,
          ])}
        />
        <Pager pkey="rep" paged={pg} />
        <p className="note">Clicks come from Search Console for the 7 days ending about 3 days ago, because Search Console data arrives late. Spend covers recorded API and service costs. Codex subscription costs are not estimated.</p>
      </section>
      {rows.length ? (
        <section>
          <h2>Highlights</h2>
          <ul className="checks">
            {top && top.clicks ? <li><Pill kind="ok">Top site</Pill><span>{top.site} brought {fmt(top.clicks)} clicks this week.</span></li> : null}
            {bad.slice(0, 4).map(x => <li key={x.siteId}><Pill kind="warn">Needs attention</Pill><span>{x.site}: {x.issue}.</span></li>)}
            {bad.length > 4 ? <li><Pill kind="warn">Needs attention</Pill><span>{bad.length - 4} more sites have an open issue.</span></li> : null}
            <li><Pill kind="info">Review</Pill><span>{sum('waiting')} article{sum('waiting') === 1 ? ' is' : 's are'} waiting for a person to approve.</span></li>
          </ul>
        </section>
      ) : null}
      <Delivery lastSent={r?.lastSent ?? null} />
      <CsvSheet csv={csv} onClose={() => setCsv(null)} />
    </>
  );
}

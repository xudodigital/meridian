import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Field, Icon, Select, SiteChip, Table } from '@/components';
import { AUDIT_PAGE, auditApi, type AuditFilter } from '@/store/auditApi';
import { inSite, siteById, stamp } from '@/store/rules';
import { useStore } from '@/store/store';
import { auditEntry } from '@/store/sync';
import type { LogEntry } from '@/store/types';
import './audit.css';

/** The store keeps this many of the newest entries (sync.ts); with that many there may be older ones on the server. */
const STORE_CAP = 200;
/** A filter is sent to the server this long after the last keystroke. */
export const FILTER_DELAY_MS = 250;

/** "2026-10-03" as the first or last millisecond of that local day; undefined for an empty or unfinished date. */
export function dayEdge(v: string, end: boolean): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return undefined;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (end ? 1 : 0)).getTime() - (end ? 1 : 0);
  return Number.isFinite(t) ? t : undefined;
}

/** Whether an entry passes the filter: the same test the server makes (text anywhere, any case; one site; a time span). */
export function auditMatch(l: LogEntry, f: AuditFilter): boolean {
  const has = (text: string, part: string | undefined) => !part?.trim() || text.toLowerCase().includes(part.trim().toLowerCase());
  return has(l.actor, f.actor) && has(l.act, f.q) && (!f.site || l.site === f.site)
    && (f.from === undefined || l.t.getTime() >= f.from) && (f.to === undefined || l.t.getTime() <= f.to);
}

const keyOf = (l: LogEntry, i: number): string => l.id !== undefined ? 'i' + l.id : 'c' + (l.cid ?? i);
const newestFirst = (a: LogEntry, b: LogEntry): number => b.t.getTime() - a.t.getTime() || (b.id ?? Infinity) - (a.id ?? Infinity);
const message = (e: unknown): string => e instanceof Error ? e.message : String(e);

/**
 * The Audit log tab of Activity: who did what, newest first, with filters (text, actor, site, dates), "Load more" and a CSV export.
 * Prototype: vAudit(), lines 1655-1658. Slice: system.
 *
 * Outside demo mode the newest entries are the store's (they arrive live); a filter and "Load more" ask the server
 * for the matching entries in pages, and the two are shown as one list. The site picker in the top bar narrows this
 * screen as it does every other: entries of that site, and the ones that belong to no site. In demo mode everything
 * is filtered in the browser.
 */
export function Audit() {
  const log = useStore(s => s.log);
  const sites = useStore(s => s.sites);
  const siteFilter = useStore(s => s.siteFilter);
  const sample = useStore(s => s.sample);
  const role = useStore(s => s.session?.role);

  const [q, setQ] = useState('');
  const [actor, setActor] = useState('');
  const [site, setSite] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const filter = useMemo<AuditFilter>(() => ({
    ...(q.trim() ? { q: q.trim() } : {}), ...(actor.trim() ? { actor: actor.trim() } : {}), ...(site ? { site } : {}),
    ...(dayEdge(from, false) !== undefined ? { from: dayEdge(from, false) } : {}), ...(dayEdge(to, true) !== undefined ? { to: dayEdge(to, true) } : {}),
  }), [q, actor, site, from, to]);
  const filterKey = JSON.stringify(filter), filtered = filterKey !== '{}';

  /* What the server sent for this filter, whether it has older entries, and how many rows demo mode shows. */
  const [pages, setPages] = useState<LogEntry[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(AUDIT_PAGE);
  /* Bumped when the filter changes, so the answer to an older question is dropped. */
  const asked = useRef(0);
  /* Every server entry the store has had while this screen is open. The store keeps the newest 200 only; without
     this, entries pushed out by new ones would leave a hole above the older pages. */
  const seen = useRef(new Map<number, LogEntry>());
  if (!sample) for (const l of log) if (l.id !== undefined) seen.current.set(l.id, l);

  useEffect(() => {
    const turn = ++asked.current;
    setPages([]); setMore(null); setError(''); setShown(AUDIT_PAGE); setBusy(false);
    if (sample || !filtered) return;
    setBusy(true);
    const t = setTimeout(() => {
      auditApi.page(filter).then(
        r => { if (turn === asked.current) { setPages(r.audit.map(auditEntry)); setMore(r.more); setBusy(false); } },
        (e: unknown) => { if (turn === asked.current) { setError(message(e)); setBusy(false); } },
      );
    }, FILTER_DELAY_MS);
    return () => clearTimeout(t);
    /* filterKey stands for the filter: the same text means the same filter. */
  }, [filterKey, filtered, sample]);

  const list = useMemo(() => {
    const byKey = new Map<string, LogEntry>();
    const source = sample ? log : [...log, ...seen.current.values(), ...pages];
    source.forEach((l, i) => { if (auditMatch(l, filter) && (!l.site || inSite({ siteFilter }, l.site))) byKey.set(keyOf(l, i), l); });
    return [...byKey.values()].sort(newestFirst);
    /* filterKey stands for the filter: the same text means the same filter. */
  }, [log, pages, filterKey, siteFilter, sample]);
  const visible = sample ? list.slice(0, shown) : list;
  /* Older entries may exist: the server said so, or (before it was asked) the store is as full as it gets. */
  const canLoadMore = sample ? list.length > shown : more ?? (!filtered && log.length >= STORE_CAP);

  const loadMore = () => {
    if (sample) { setShown(n => n + AUDIT_PAGE); return; }
    /* Older than everything the server-side list holds for this filter, whatever the site picker hides. */
    const ids = [...(filtered ? [] : [...seen.current.keys()]), ...pages.flatMap(l => l.id !== undefined ? [l.id] : [])];
    const before = ids.length ? Math.min(...ids) : undefined;
    const turn = asked.current;
    setBusy(true); setError('');
    auditApi.page(filter, before).then(
      r => { if (turn === asked.current) { setPages(p => [...p, ...r.audit.map(auditEntry)]); setMore(r.more); setBusy(false); } },
      (e: unknown) => { if (turn === asked.current) { setError(message(e)); setBusy(false); } },
    );
  };
  const clear = () => { setQ(''); setActor(''); setSite(''); setFrom(''); setTo(''); };

  const rows = visible.map(l => [
    stamp(l.t),
    <b>{l.actor}</b>,
    l.note ? <>{l.act} <span className="note nw" title="Recorded from the dashboard under this person's name. Entries without this label were written by the server itself.">· from the dashboard</span></> : l.act,
    l.site && siteById({ sites }, l.site) ? <SiteChip id={l.site} /> : '',
  ]);
  const nothing = !log.length && !filtered;
  const empty = nothing
    ? <Empty icon="history" title="Nothing recorded yet">Everything you and the agents do is listed here.</Empty>
    : <Empty icon="filter_alt_off" title="No entries match" action={filtered ? <Button onClick={clear}>Clear filters</Button> : undefined}>{filtered ? 'Try a shorter search, another person or a wider date range.' : 'Nothing was recorded for the site chosen in the top bar.'}</Empty>;
  const mayExport = !sample && (role === 'admin' || role === 'editor');

  return (
    <>
      <p className="lede">Every agent and admin action is recorded. API key values never enter the log.</p>
      <section>
        {nothing ? null : (
          <>
            <div className="aud-filters" role="search" aria-label="Filter the audit log">
              <Field label="Action contains"><input type="text" id="auQ" value={q} placeholder="approved" autoComplete="off" onChange={e => setQ(e.target.value)} /></Field>
              <Field label="Actor"><input type="text" id="auActor" value={actor} placeholder="A person or an agent" autoComplete="off" onChange={e => setActor(e.target.value)} /></Field>
              <Field label="Site"><Select id="auSite" label="Site" value={site} onChange={setSite} searchPlaceholder="Search sites" options={[{ value: '', label: 'All sites' }, ...sites.map(x => ({ value: x.id, label: x.domain }))]} /></Field>
              <Field label="From"><input type="date" id="auFrom" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></Field>
              <Field label="To"><input type="date" id="auTo" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></Field>
            </div>
            <div className="aud-bar">
              <p className="note" id="auCount" role="status">
                {busy && !visible.length ? 'Loading…' : canLoadMore ? `Showing the newest ${visible.length} entries.` : `${visible.length} ${visible.length === 1 ? 'entry' : 'entries'}${filtered ? (visible.length === 1 ? ' matches.' : ' match.') : '.'}`}
              </p>
              {filtered ? <Button variant="text" icon="filter_alt_off" id="auClear" onClick={clear}>Clear filters</Button> : null}
              {mayExport ? (
                <a className="btn" id="auExport" href={auditApi.csvUrl(filter)} download title="Downloads every entry that matches the filters above, as a file for a spreadsheet. The site picker in the top bar does not narrow the file.">
                  <Icon name="download" />Export CSV
                </a>
              ) : null}
            </div>
          </>
        )}
        <Table cols={['Time', 'Actor', 'Action', 'Site']} rows={rows} num={[0]} loading={busy && !rows.length} rowKey={(_, i) => keyOf(visible[i]!, i)} empty={empty} />
        {error ? <p className="err" id="auErr" role="alert">The audit log could not be loaded: {error}</p> : null}
        {canLoadMore && rows.length ? (
          <div className="aud-more"><Button id="auMore" icon="expand_more" disabled={busy} onClick={loadMore}>{busy ? 'Loading…' : 'Load more'}</Button></div>
        ) : null}
      </section>
    </>
  );
}

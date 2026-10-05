// Search Console figures per site, kept so a restart does not lose them. Two things are fetched:
// - the totals of each site (28 and 7 days), when Search Console is connected and again every 6 hours, in the kv
//   table: the dashboard shows them as the sites' clicks and the report uses the 7-day clicks;
// - the rows per day, page and query of the last 28 days, once a day (and on connect and on a manual refresh), in
//   gsc_rows, kept for 16 months: the Search Console tab (siteSearch) and rank tracking (rank.ts) read them.
import { db } from './db.ts';
import { bus } from './events.ts';
import { QuotaError, gscDaily, gscDetail, gscMetrics, gscProperties, propertyFor, type GscRow, type SiteMetrics } from './google.ts';
import { rowOf, setResult } from './integrations.ts';
import { ServiceError } from './net.ts';
import { siteList } from './workspace.ts';
import { forgetGa4, scheduleGa4 } from './ga4.ts';

export type Metrics = { at: number; sites: Record<string, SiteMetrics> };
const get = db.prepare('SELECT value FROM kv WHERE key = ?');
const put = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
const del = db.prepare('DELETE FROM kv WHERE key = ?');
const KEY = 'gsc:metrics', ROWS_KEY = 'gsc:rows';
const kvJson = <T>(key: string): T | null => {
  const v = (get.get(key) as { value: string } | undefined)?.value;
  try { return v ? JSON.parse(v) as T : null; } catch { return null; }
};

/** The last figures, or null when Search Console is not connected or nothing was fetched yet. */
export function gscMetricsCached(): Metrics | null {
  return rowOf('gsc') ? kvJson<Metrics>(KEY) : null;
}
export const forgetMetrics = () => {
  del.run(KEY); del.run(ROWS_KEY); qm.clear.run();
  bus.emit('metrics', null); bus.emit('insights', { source: 'gsc' });
};

let busy = false;
/**
 * Fetches the totals now. Resolves to them, or null when not connected or it failed (the card then says why). With
 * `rows`, the rows per page and query are fetched after it, in the background ('insights' says when they are in).
 */
export async function refreshMetrics(rows = true): Promise<Metrics | null> {
  const row = rowOf('gsc');
  if (!row || row.status === 'bad' || busy) return null;
  busy = true;
  try {
    const sites = await gscMetrics(siteList().map(s => ({ id: s.id, domain: s.domain })));
    const m: Metrics = { at: Date.now(), sites };
    put.run(KEY, JSON.stringify(m));
    bus.emit('metrics', m);
    if (rows) void refreshRows().catch(e => console.error('Search Console rows could not be fetched:', String((e as Error).message || e).slice(0, 200)));
    return m;
  } catch (e) {
    if (e instanceof ServiceError) { setResult('gsc', 'bad', e.message); bus.emit('integrations-changed', {}); }
    return null;
  } finally { busy = false; }
}

/* ---------- Rows per day, page and query ---------- */

const DAY = 86_400_000;
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);
/** A date `n` days after `date` (before, when negative). Dates are YYYY-MM-DD. */
export const addDays = (date: string, n: number): string => iso(Date.parse(date + 'T00:00:00Z') + n * DAY);
/** Search Console's final data ends about 3 days ago. */
export const LAG_DAYS = 3;
/** The days each daily fetch covers, and the days of a site's first fetch (so 28-day comparisons work at once). */
export const DAYS = 28, FIRST_DAYS = 56;
/** Search Console itself keeps 16 months; so does Meridian. */
export const KEEP_DAYS = 488;

const qm = {
  clear: db.prepare('DELETE FROM gsc_rows'),
  clearSite: db.prepare('DELETE FROM gsc_rows WHERE site_id = ?'),
  clearRange: db.prepare('DELETE FROM gsc_rows WHERE site_id = ? AND date BETWEEN ? AND ?'),
  prune: db.prepare('DELETE FROM gsc_rows WHERE date < ?'),
  insert: db.prepare('INSERT OR REPLACE INTO gsc_rows (site_id, date, page, query, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  any: db.prepare('SELECT 1 FROM gsc_rows WHERE site_id = ? LIMIT 1'),
  last: db.prepare('SELECT MAX(date) AS d FROM gsc_rows WHERE site_id = ?'),
  days: db.prepare(`SELECT date, clicks, impressions, position FROM gsc_rows WHERE site_id = ? AND page = '' AND query = '' AND date BETWEEN ? AND ? ORDER BY date`),
  pages: db.prepare(`SELECT page AS k, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
    FROM gsc_rows WHERE site_id = ? AND page <> '' AND date BETWEEN ? AND ? GROUP BY page ORDER BY clicks DESC, impressions DESC, page LIMIT ?`),
  queries: db.prepare(`SELECT query AS k, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
    FROM gsc_rows WHERE site_id = ? AND query <> '' AND date BETWEEN ? AND ? GROUP BY query ORDER BY clicks DESC, impressions DESC, query LIMIT ?`),
};

/** What the last fetch of rows did, per site: which property, which days, how many rows, or why it failed. */
export type RowsStatus = {
  at: number; error: string;
  sites: Record<string, { property: string; from: string; to: string; rows: number; truncated?: boolean; error?: string }>;
};
export const rowsStatus = (): RowsStatus | null => rowOf('gsc') ? kvJson<RowsStatus>(ROWS_KEY) : null;

function storeRows(siteId: string, from: string, to: string, daily: GscRow[], detail: GscRow[]): void {
  db.exec('BEGIN');
  try {
    qm.clearRange.run(siteId, from, to);
    for (const r of daily) qm.insert.run(siteId, r.date, '', '', r.clicks, r.impressions, r.position);
    for (const r of detail) if (r.page || r.query) qm.insert.run(siteId, r.date, r.page, r.query, r.clicks, r.impressions, r.position);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

let rowsBusy = false, rowsAgain = false;
/**
 * Fetches each site's rows now: the totals per day, then the rows per day, page and query. A site's failure is
 * written next to it and the others go on; a used-up quota or an ended sign-in stops the round. Resolves to what
 * happened, or null when Search Console is not connected (or a fetch is already running).
 */
export async function refreshRows(now = Date.now()): Promise<RowsStatus | null> {
  const row = rowOf('gsc');
  if (!row || row.status === 'bad') return null;
  /* Asked for while a round is running (a refresh right after connecting): one more round follows it. */
  if (rowsBusy) { rowsAgain = true; return null; }
  rowsBusy = true;
  const before = kvJson<RowsStatus>(ROWS_KEY), status: RowsStatus = { at: now, error: '', sites: {} };
  try {
    const props = await gscProperties();
    const to = iso(now - LAG_DAYS * DAY);
    for (const s of siteList()) {
      const property = propertyFor(s.domain, props);
      if (!property) continue;
      /* Another property than last time (the domain changed): the old rows are not this site's any more. */
      const known = before?.sites[s.id]?.property;
      if (known && known !== property) qm.clearSite.run(s.id);
      const from = addDays(to, -((qm.any.get(s.id) ? DAYS : FIRST_DAYS) - 1));
      try {
        const daily = await gscDaily(property, from, to), detail = await gscDetail(property, from, to);
        storeRows(s.id, from, to, daily, detail.rows);
        status.sites[s.id] = { property, from, to, rows: detail.rows.length, ...(detail.truncated ? { truncated: true } : {}) };
      } catch (e) {
        if (!(e instanceof ServiceError)) throw e;
        const prev = before?.sites[s.id];
        status.sites[s.id] = { property, from: prev?.from ?? from, to: prev?.to ?? to, rows: prev?.rows ?? 0, error: e.message };
        /* A used-up quota or an ended sign-in fails every site after this one too: the round stops. */
        if (e instanceof QuotaError || e.status === 401) throw e;
      }
    }
    qm.prune.run(iso(now - KEEP_DAYS * DAY));
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
    status.error = e.message;
    /* Sites the round did not reach keep what was known about them. */
    status.sites = { ...before?.sites, ...status.sites };
    /* A quota that is used up is not a broken connection; an ended sign-in is. */
    if (!(e instanceof QuotaError)) { setResult('gsc', 'bad', e.message); bus.emit('integrations-changed', {}); }
  } finally { rowsBusy = false; }
  if (rowOf('gsc')) put.run(ROWS_KEY, JSON.stringify(status));
  bus.emit('insights', { source: 'gsc' });
  if (rowsAgain) { rowsAgain = false; if (!status.error) void refreshRows().catch(() => undefined); }
  return status;
}

export type SearchLine = { key: string; clicks: number; impressions: number; ctr: number; position: number };
export type SearchDay = { date: string; clicks: number; impressions: number; position: number };
/**
 * A site's Search Console detail (GET /api/metrics/site/:id). `state` says why there is nothing to show:
 * not-connected, waiting (the first fetch has not finished), no-property (the account has no property for the
 * domain), no-data (Google has no rows yet) or ok.
 */
export type SiteSearch = {
  state: 'not-connected' | 'waiting' | 'no-property' | 'no-data' | 'ok';
  property: string; fetchedAt: number | null; error: string; truncated: boolean; from: string; to: string;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  days: SearchDay[]; pages: SearchLine[]; queries: SearchLine[];
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const ctr = (clicks: number, impressions: number) => impressions > 0 ? Math.round(clicks / impressions * 1000) / 1000 : 0;
export const TOP = 25;

/** The newest day a site has rows for, or null. */
export const lastDay = (siteId: string): string | null => (qm.last.get(siteId) as { d: string | null }).d;

export function siteSearch(siteId: string): SiteSearch {
  const none: Omit<SiteSearch, 'state'> = { property: '', fetchedAt: null, error: '', truncated: false, from: '', to: '', totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 }, days: [], pages: [], queries: [] };
  if (!rowOf('gsc')) return { state: 'not-connected', ...none };
  const summary = gscMetricsCached(), st = rowsStatus(), mine = st?.sites[siteId];
  const property = mine?.property ?? summary?.sites[siteId]?.property ?? '';
  const base = { ...none, property, fetchedAt: st?.at ?? null, error: mine?.error ?? st?.error ?? '', truncated: !!mine?.truncated };
  const to = lastDay(siteId);
  if (!to) {
    if (!summary && !st) return { state: 'waiting', ...base };
    if (!property) return { state: 'no-property', ...base };
    return { state: st && (mine || !st.error) ? 'no-data' : 'waiting', ...base };
  }
  const from = addDays(to, -(DAYS - 1));
  const got = new Map((qm.days.all(siteId, from, to) as SearchDay[]).map(d => [d.date, d]));
  const days: SearchDay[] = [];
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(from, i), d = got.get(date);
    days.push({ date, clicks: d?.clicks ?? 0, impressions: d?.impressions ?? 0, position: d ? r1(d.position) : 0 });
  }
  const clicks = days.reduce((n, d) => n + d.clicks, 0), impressions = days.reduce((n, d) => n + d.impressions, 0);
  const weighted = [...got.values()].reduce((n, d) => n + d.position * d.impressions, 0);
  const line = (x: { k: string; clicks: number; impressions: number; position: number | null }): SearchLine =>
    ({ key: x.k, clicks: x.clicks, impressions: x.impressions, ctr: ctr(x.clicks, x.impressions), position: r1(x.position ?? 0) });
  const pages = (qm.pages.all(siteId, from, to, TOP) as Parameters<typeof line>[0][]).map(line);
  const queries = (qm.queries.all(siteId, from, to, TOP) as Parameters<typeof line>[0][]).map(line);
  return {
    state: impressions > 0 || pages.length || queries.length ? 'ok' : 'no-data', ...base, from, to,
    totals: { clicks, impressions, ctr: ctr(clicks, impressions), position: impressions > 0 ? r1(weighted / impressions) : 0 },
    days, pages, queries,
  };
}

/* ---------- Schedule ---------- */

export function schedule(): void {
  const tick = () => {
    if (!rowOf('gsc')) return;
    const m = gscMetricsCached(), st = rowsStatus();
    const rowsDue = !st || Date.now() - st.at > 24 * 3_600_000;
    if (!m || Date.now() - m.at > 6 * 3_600_000) void refreshMetrics(rowsDue);
    else if (rowsDue) void refreshRows().catch(() => undefined);
  };
  setTimeout(tick, 5_000).unref();
  setInterval(tick, 10 * 60_000).unref();
  scheduleGa4();
  /* Removing Analytics in Integrations drops what was read from it. */
  bus.on('integrations-changed', () => { if (!rowOf('ga4')) forgetGa4(); });
}

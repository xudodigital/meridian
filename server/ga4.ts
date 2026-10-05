// Google Analytics 4 per site: which property belongs to which site, and the users, sessions and engaged sessions
// read from it once a day (and on connect, on a manual refresh and when a person picks a property), kept in ga4_rows.
//
// A site is matched to a property by its domain: the property whose web data stream has the site's host. When none
// matches (or several do), a person picks one in Analytics > GA4; that choice wins over the match. Reports run one
// after the other, never in parallel (a property allows ten requests at a time).
import { db } from './db.ts';
import { bus } from './events.ts';
import { QuotaError, ga4Properties, ga4Report, type Ga4Property } from './google.ts';
import { rowOf, setResult } from './integrations.ts';
import { ServiceError } from './net.ts';
import { siteList } from './workspace.ts';

const kv = {
  get: db.prepare('SELECT value FROM kv WHERE key = ?'),
  put: db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)'),
  del: db.prepare('DELETE FROM kv WHERE key = ?'),
};
const kvJson = <T>(key: string): T | null => {
  const v = (kv.get.get(key) as { value: string } | undefined)?.value;
  try { return v ? JSON.parse(v) as T : null; } catch { return null; }
};
const PROPS = 'ga4:props', MAP = 'ga4:map', STATUS = 'ga4:status';

const qg = {
  clear: db.prepare('DELETE FROM ga4_rows'),
  clearSite: db.prepare('DELETE FROM ga4_rows WHERE site_id = ?'),
  clearRange: db.prepare(`DELETE FROM ga4_rows WHERE site_id = ? AND (date = '' OR date BETWEEN ? AND ?)`),
  prune: db.prepare(`DELETE FROM ga4_rows WHERE date <> '' AND date < ?`),
  insert: db.prepare('INSERT OR REPLACE INTO ga4_rows (site_id, date, page, users, sessions, engaged) VALUES (?, ?, ?, ?, ?, ?)'),
  days: db.prepare(`SELECT date, users, sessions, engaged FROM ga4_rows WHERE site_id = ? AND page = '' AND date BETWEEN ? AND ? ORDER BY date`),
  total: db.prepare(`SELECT users, sessions, engaged FROM ga4_rows WHERE site_id = ? AND page = '' AND date = ''`),
  pages: db.prepare(`SELECT page AS key, users, sessions, engaged FROM ga4_rows WHERE site_id = ? AND date = '' AND page <> '' ORDER BY sessions DESC, users DESC, page LIMIT ?`),
};

const DAY = 86_400_000, DAYS = 28, KEEP_DAYS = 488, TOP = 25;
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);
const bare = (domain: string): string => domain.toLowerCase().replace(/^www\./, '');

type Props = { at: number; list: Ga4Property[] };
export type Ga4Status = { at: number; error: string; sites: Record<string, { property: string; from: string; to: string; rows: number; truncated?: boolean; error?: string }> };
const props = (): Props | null => kvJson<Props>(PROPS);
const manual = (): Record<string, string> => kvJson<Record<string, string>>(MAP) ?? {};
export const ga4Status = (): Ga4Status | null => rowOf('ga4') ? kvJson<Ga4Status>(STATUS) : null;

/** The property of a site: the one a person chose, else the one whose web stream has the site's host. */
export function propertyOf(site: { id: string; domain: string }, list: Ga4Property[] = props()?.list ?? [], chosen = manual()): { property: string; name: string; auto: boolean } | null {
  const pick = chosen[site.id], picked = pick ? list.find(p => p.id === pick) : undefined;
  if (picked) return { property: picked.id, name: picked.name, auto: false };
  const host = bare(site.domain);
  const hit = list.find(p => p.hosts.includes(host));
  return hit ? { property: hit.id, name: hit.name, auto: true } : null;
}

/** Stores a person's choice of property for a site ('' goes back to matching by domain). Returns an error, or null. */
export function chooseProperty(siteId: string, property: string): string | null {
  const list = props()?.list ?? [];
  if (property && !list.some(p => p.id === property)) return 'This Google account cannot read that property. Refresh, then choose again.';
  const m = manual();
  if (property) m[siteId] = property; else delete m[siteId];
  kv.put.run(MAP, JSON.stringify(m));
  return null;
}

export function forgetGa4(): void {
  if (!kv.get.get(PROPS) && !kv.get.get(STATUS)) return;
  kv.del.run(PROPS); kv.del.run(STATUS); kv.del.run(MAP); qg.clear.run();
  bus.emit('insights', { source: 'ga4' });
}

let busy = false, again = false;
/**
 * Reads the properties and each mapped site's reports now. A site's failure is written next to it and the others go
 * on; a used-up quota or an ended sign-in stops the round. Null when Analytics is not connected or a fetch is running.
 */
export async function refreshGa4(now = Date.now()): Promise<Ga4Status | null> {
  const row = rowOf('ga4');
  if (!row || row.status === 'bad') return null;
  /* Asked for while a round is running (a property chosen right after connecting): one more round follows it. */
  if (busy) { again = true; return null; }
  busy = true;
  const before = kvJson<Ga4Status>(STATUS), status: Ga4Status = { at: now, error: '', sites: {} };
  try {
    const list = await ga4Properties();
    kv.put.run(PROPS, JSON.stringify({ at: now, list } satisfies Props));
    const to = iso(now - DAY), from = iso(now - DAYS * DAY);
    for (const s of siteList()) {
      const p = propertyOf(s, list);
      if (!p) { if (before?.sites[s.id]) qg.clearSite.run(s.id); continue; }
      if (before?.sites[s.id] && before.sites[s.id]!.property !== p.property) qg.clearSite.run(s.id);
      try {
        const days = await ga4Report(p.property, from, to, 'date'), pages = await ga4Report(p.property, from, to, 'pagePath');
        db.exec('BEGIN');
        try {
          qg.clearRange.run(s.id, from, to);
          for (const d of days.rows) qg.insert.run(s.id, d.key, '', d.users, d.sessions, d.engaged);
          for (const x of pages.rows) qg.insert.run(s.id, '', x.key, x.users, x.sessions, x.engaged);
          const t = days.total ?? { users: 0, sessions: days.rows.reduce((n, d) => n + d.sessions, 0), engaged: days.rows.reduce((n, d) => n + d.engaged, 0) };
          qg.insert.run(s.id, '', '', t.users, t.sessions, t.engaged);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        status.sites[s.id] = { property: p.property, from, to, rows: days.rows.length + pages.rows.length, ...(pages.truncated ? { truncated: true } : {}) };
      } catch (e) {
        if (!(e instanceof ServiceError)) throw e;
        const prev = before?.sites[s.id];
        status.sites[s.id] = { property: p.property, from: prev?.from ?? from, to: prev?.to ?? to, rows: prev?.rows ?? 0, error: e.message };
        /* The quota is per property: the next site's property may still have some. An ended sign-in stops the round. */
        if (e.status === 401) throw e;
      }
    }
    qg.prune.run(iso(now - KEEP_DAYS * DAY));
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
    status.error = e.message;
    /* Sites the round did not reach keep what was known about them. */
    status.sites = { ...before?.sites, ...status.sites };
    if (!(e instanceof QuotaError)) { setResult('ga4', 'bad', e.message); bus.emit('integrations-changed', {}); }
  } finally { busy = false; }
  if (rowOf('ga4')) kv.put.run(STATUS, JSON.stringify(status));
  bus.emit('insights', { source: 'ga4' });
  if (again) { again = false; if (!status.error) void refreshGa4().catch(() => undefined); }
  return status;
}

export type Ga4Totals = { users: number; sessions: number; engaged: number; rate: number };
export type Ga4Line = Ga4Totals & { key: string };
/**
 * A site's Analytics figures. `state`: not-connected, waiting (nothing was read yet), no-property (no property is
 * matched or chosen), no-data (the property has no sessions in the 28 days) or ok.
 */
export type SiteGa4 = {
  state: 'not-connected' | 'waiting' | 'no-property' | 'no-data' | 'ok';
  property: string; propertyName: string; auto: boolean; fetchedAt: number | null; error: string; from: string; to: string;
  totals: Ga4Totals; days: { date: string; users: number; sessions: number; engaged: number }[]; pages: Ga4Line[];
};
const rate = (engaged: number, sessions: number) => sessions > 0 ? Math.round(engaged / sessions * 1000) / 1000 : 0;

export function siteGa4(site: { id: string; domain: string }): SiteGa4 {
  const none: Omit<SiteGa4, 'state'> = { property: '', propertyName: '', auto: false, fetchedAt: null, error: '', from: '', to: '', totals: { users: 0, sessions: 0, engaged: 0, rate: 0 }, days: [], pages: [] };
  if (!rowOf('ga4')) return { state: 'not-connected', ...none };
  const st = ga4Status(), known = props();
  if (!known) return { state: 'waiting', ...none, error: st?.error ?? '' };
  const p = propertyOf(site, known.list), mine = st?.sites[site.id];
  const base = { ...none, property: p?.property ?? '', propertyName: p?.name ?? '', auto: !!p?.auto, fetchedAt: st?.at ?? null, error: mine?.error ?? st?.error ?? '' };
  if (!p) return { state: 'no-property', ...base };
  /* Figures read from another property than the one now chosen are not shown as this one's. */
  if (!mine || mine.property !== p.property) return { state: 'waiting', ...base };
  const got = new Map((qg.days.all(site.id, mine.from, mine.to) as SiteGa4['days']).map(d => [d.date, d]));
  const days: SiteGa4['days'] = [];
  for (let t = Date.parse(mine.from + 'T00:00:00Z'), end = Date.parse(mine.to + 'T00:00:00Z'); t <= end && days.length < 60; t += DAY) {
    const date = iso(t), d = got.get(date);
    days.push({ date, users: d?.users ?? 0, sessions: d?.sessions ?? 0, engaged: d?.engaged ?? 0 });
  }
  const t = qg.total.get(site.id) as { users: number; sessions: number; engaged: number } | undefined;
  const totals: Ga4Totals = { users: t?.users ?? 0, sessions: t?.sessions ?? 0, engaged: t?.engaged ?? 0, rate: rate(t?.engaged ?? 0, t?.sessions ?? 0) };
  const pages = (qg.pages.all(site.id, TOP) as Omit<Ga4Line, 'rate'>[]).map(x => ({ ...x, rate: rate(x.engaged, x.sessions) }));
  return { state: totals.sessions > 0 || pages.length ? 'ok' : mine.error ? 'waiting' : 'no-data', ...base, from: mine.from, to: mine.to, totals, days, pages };
}

/** What the GA4 tab lists: the properties a person can pick from, and each site's property and 28-day totals. */
export type Ga4Overview = {
  connected: boolean; fetchedAt: number | null; error: string;
  properties: { id: string; name: string; account: string }[];
  sites: Record<string, Pick<SiteGa4, 'state' | 'property' | 'propertyName' | 'auto' | 'error' | 'totals'>>;
};
export function ga4Overview(sites: { id: string; domain: string }[]): Ga4Overview {
  const connected = !!rowOf('ga4'), st = ga4Status();
  return {
    connected, fetchedAt: st?.at ?? null, error: st?.error ?? '',
    properties: connected ? (props()?.list ?? []).map(p => ({ id: p.id, name: p.name, account: p.account })) : [],
    sites: Object.fromEntries(sites.map(s => { const v = siteGa4(s); return [s.id, { state: v.state, property: v.property, propertyName: v.propertyName, auto: v.auto, error: v.error, totals: v.totals }]; })),
  };
}

export function scheduleGa4(): void {
  const tick = () => {
    const row = rowOf('ga4');
    if (!row || row.status === 'bad') return;
    const st = ga4Status();
    if (!st || Date.now() - st.at > 24 * 3_600_000) void refreshGa4().catch(e => console.error('Analytics figures could not be fetched:', String((e as Error).message || e).slice(0, 200)));
  };
  setTimeout(tick, 7_000).unref();
  setInterval(tick, 10 * 60_000).unref();
  /* Connected just now (ops-api.ts announces the result of the Google sign-in): read it at once. */
  bus.on('google-result', (r: { ok?: boolean; kind?: string }) => { if (r.ok && r.kind === 'ga4') void refreshGa4().catch(() => undefined); });
}

// Rank tracking from Search Console, never by querying Google: the position of each tracked keyword of a site is the
// average position of the site's links for that query over the query's impressions (gsc_rows, metrics.ts).
//
// The tracked keywords of a site are the keywords of its approved articles, and the research keywords a person marked
// "Track". "Position now" is the average over the newest 7 days of data; the 7-day and 28-day changes compare it with
// the 7 days that ended 7 and 28 days earlier (positive: the site moved up). A keyword without impressions in a window
// has no position there, and a change is only given when both windows have one.
import { db } from './db.ts';
import { rowOf } from './integrations.ts';
import { addDays, lastDay, siteSearch } from './metrics.ts';

const qr = {
  approved: db.prepare(`SELECT keyword FROM articles WHERE site_id = ? AND status = 'approved' AND archived_at IS NULL ORDER BY id`),
  research: db.prepare(`SELECT k.keyword, k.intent, k.track FROM keywords k JOIN requests r ON r.id = k.request_id WHERE k.site_id = ? AND r.status = 'done' ORDER BY k.id`),
  window: db.prepare(`SELECT page, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
    FROM gsc_rows WHERE site_id = ? AND query = ? AND date BETWEEN ? AND ? GROUP BY page`),
  deploys: db.prepare('SELECT id, site_id, deployed_at FROM site_builds WHERE deployed_at IS NOT NULL ORDER BY id'),
};

/** A keyword as Search Console reports queries: lower case, single spaces. */
export const queryOf = (keyword: string): string => keyword.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const r1 = (n: number) => Math.round(n * 10) / 10;

export type Tracked = { keyword: string; query: string; intent: string; source: 'article' | 'tracked' };
/** The tracked keywords of a site, each once: approved articles first, then the research keywords marked "Track". */
export function trackedKeywords(siteId: string): Tracked[] {
  const research = qr.research.all(siteId) as { keyword: string; intent: string; track: number }[];
  const intents = new Map<string, string>();
  for (const k of research) if (k.intent) intents.set(queryOf(k.keyword), k.intent);
  const out = new Map<string, Tracked>();
  const add = (keyword: string, source: Tracked['source']) => { const query = queryOf(keyword); if (query && !out.has(query)) out.set(query, { keyword, query, intent: intents.get(query) ?? '', source }); };
  for (const a of qr.approved.all(siteId) as { keyword: string }[]) add(a.keyword, 'article');
  for (const k of research) if (k.track) add(k.keyword, 'tracked');
  return [...out.values()];
}

type Win = { position: number | null; clicks: number; impressions: number; page: string };
/** A query's figures for a site over the days from `from` to `to`: its position, and the page with the most clicks. */
function windowOf(siteId: string, query: string, from: string, to: string): Win {
  const rows = qr.window.all(siteId, query, from, to) as { page: string; clicks: number; impressions: number; weighted: number }[];
  let clicks = 0, impressions = 0, weighted = 0, best: typeof rows[number] | undefined;
  for (const x of rows) {
    clicks += x.clicks; impressions += x.impressions; weighted += x.weighted;
    if (x.page && (!best || x.clicks > best.clicks || (x.clicks === best.clicks && x.impressions > best.impressions))) best = x;
  }
  return { position: impressions > 0 ? weighted / impressions : null, clicks, impressions, page: best?.page ?? '' };
}
const change = (then: number | null, now: number | null): number | null => then === null || now === null ? null : r1(then - now);

export type RankRow = {
  keyword: string; intent: string; source: Tracked['source'];
  /** Average position over the newest 7 days of data; null when the keyword had no impressions then. */
  position: number | null;
  /** Positions gained (positive) or lost against the 7 days before, and against the 7 days that ended 28 days earlier. */
  change7: number | null; change28: number | null;
  /** The page that got the most clicks for the keyword in the last 28 days. */
  page: string; clicks: number; impressions: number;
};
/**
 * `state`: not-connected, no-keywords (nothing is tracked yet), waiting (the first fetch has not finished),
 * no-property (the Google account has no property for the domain), no-data (Google has no rows yet) or ok.
 */
export type SiteRank = { state: 'not-connected' | 'no-keywords' | 'waiting' | 'no-property' | 'no-data' | 'ok'; to: string; keywords: RankRow[] };

export function siteRank(siteId: string): SiteRank {
  if (!rowOf('gsc')) return { state: 'not-connected', to: '', keywords: [] };
  const tracked = trackedKeywords(siteId);
  if (!tracked.length) return { state: 'no-keywords', to: '', keywords: [] };
  const to = lastDay(siteId);
  const blank = (t: Tracked): RankRow => ({ keyword: t.keyword, intent: t.intent, source: t.source, position: null, change7: null, change28: null, page: '', clicks: 0, impressions: 0 });
  if (!to) { const st = siteSearch(siteId).state; return { state: st === 'ok' ? 'no-data' : st as SiteRank['state'], to: '', keywords: tracked.map(blank) }; }
  const keywords = tracked.map((t): RankRow => {
    const now = windowOf(siteId, t.query, addDays(to, -6), to);
    const d7 = windowOf(siteId, t.query, addDays(to, -13), addDays(to, -7));
    const d28 = windowOf(siteId, t.query, addDays(to, -34), addDays(to, -28));
    const month = windowOf(siteId, t.query, addDays(to, -27), to);
    return {
      ...blank(t), position: now.position === null ? null : r1(now.position), change7: change(d7.position, now.position), change28: change(d28.position, now.position),
      page: month.page, clicks: month.clicks, impressions: month.impressions,
    };
  });
  return { state: 'ok', to, keywords };
}

/** What a deploy did to rankings: the average position change of the tracked keywords, and how many it is based on. */
export type RankEffect = { change: number; keywords: number };
const DAY = 86_400_000;

/**
 * The rank effect of each deploy of the given sites, by build id: the average over the site's tracked keywords of
 * (position in the 7 days before the deploy's day) minus (position in the 7 days after it). Only keywords with a
 * position in both windows count, and a deploy has an effect only once Search Console has the 7th day after it.
 */
export function rankEffects(sees: (siteId: string) => boolean): Record<number, RankEffect> {
  const out: Record<number, RankEffect> = {};
  if (!rowOf('gsc')) return out;
  const tracked = new Map<string, Tracked[]>(), last = new Map<string, string | null>();
  for (const b of qr.deploys.all() as { id: number; site_id: string; deployed_at: number }[]) {
    if (!sees(b.site_id)) continue;
    if (!last.has(b.site_id)) last.set(b.site_id, lastDay(b.site_id));
    const to = last.get(b.site_id), day = new Date(b.deployed_at - (b.deployed_at % DAY)).toISOString().slice(0, 10);
    if (!to || to < addDays(day, 7)) continue;
    if (!tracked.has(b.site_id)) tracked.set(b.site_id, trackedKeywords(b.site_id));
    let sum = 0, n = 0;
    for (const t of tracked.get(b.site_id)!) {
      const before = windowOf(b.site_id, t.query, addDays(day, -7), addDays(day, -1)).position;
      const after = windowOf(b.site_id, t.query, addDays(day, 1), addDays(day, 7)).position;
      if (before !== null && after !== null) { sum += before - after; n++; }
    }
    if (n) out[b.id] = { change: r1(sum / n), keywords: n };
  }
  return out;
}

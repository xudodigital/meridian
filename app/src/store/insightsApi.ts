/* What the server reads about each site's search and visitors (server/insights-api.ts): Search Console per page and
   query, rank tracking with the rank effect of deploys, Google Analytics 4 with its site-to-property mapping, and the
   search volume of a research result. The screens read these with TanStack Query; the event stream's "insights" and
   "metrics" events mark them stale (live.ts), so an open tab shows new figures by itself. Nothing here touches the
   store, and demo mode never calls it. */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { apiGet, apiSend } from './serverApi';
import type { ServerRequest } from './types';

export type SourceState = 'not-connected' | 'waiting' | 'no-property' | 'no-data' | 'ok';
export interface SearchLine { key: string; clicks: number; impressions: number; ctr: number; position: number }
export interface SearchDay { date: string; clicks: number; impressions: number; position: number }
/** A site's Search Console detail for the last 28 days of data. */
export interface SiteSearchWire {
  state: SourceState; property: string; fetchedAt: number | null; error: string; truncated: boolean; from: string; to: string;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  days: SearchDay[]; pages: SearchLine[]; queries: SearchLine[];
}
export interface Ga4Totals { users: number; sessions: number; engaged: number; rate: number }
/** A site's Analytics figures for the last 28 days. */
export interface SiteGa4Wire {
  state: SourceState; property: string; propertyName: string; auto: boolean; fetchedAt: number | null; error: string; from: string; to: string;
  totals: Ga4Totals; days: { date: string; users: number; sessions: number; engaged: number }[]; pages: (Ga4Totals & { key: string })[];
}
export interface SiteInsightsWire { siteId: string; domain: string; gsc: SiteSearchWire; ga4: SiteGa4Wire }

export interface Ga4OverviewWire {
  connected: boolean; fetchedAt: number | null; error: string;
  properties: { id: string; name: string; account: string }[];
  sites: Record<string, Pick<SiteGa4Wire, 'state' | 'property' | 'propertyName' | 'auto' | 'error' | 'totals'>>;
}

export type RankState = 'not-connected' | 'no-keywords' | 'waiting' | 'no-property' | 'no-data' | 'ok';
export interface RankRowWire {
  keyword: string; intent: string; source: 'article' | 'tracked';
  position: number | null; change7: number | null; change28: number | null; page: string; clicks: number; impressions: number;
}
export interface RankWire {
  connected: boolean;
  sites: Record<string, { state: RankState; to: string; keywords: RankRowWire[] }>;
  /** By build id: the average position change of the site's tracked keywords, 7 days after the deploy against the 7 before. */
  effects: Record<string, { change: number; keywords: number }>;
}

export const insightsApi = {
  site: (siteId: string) => apiGet<SiteInsightsWire>('/api/metrics/site/' + encodeURIComponent(siteId)),
  rank: () => apiGet<RankWire>('/api/rank'),
  ga4: () => apiGet<{ ga4: Ga4OverviewWire }>('/api/ga4').then(r => r.ga4),
  ga4Map: (siteId: string, property: string) => apiSend<{ ga4: Ga4OverviewWire }>('/api/ga4/map', { siteId, property }).then(r => r.ga4),
  ga4Refresh: () => apiSend<{ ga4: Ga4OverviewWire }>('/api/ga4/refresh').then(r => r.ga4),
  volumes: (rid: number, provider?: 'ads' | 'dfs') => apiSend<{ request: ServerRequest; found: number; sent: number }>(`/api/requests/${rid}/volumes`, provider ? { provider } : {}),
  track: (keywordId: number, on: boolean) => apiSend<{ request: ServerRequest }>(`/api/keywords/${keywordId}/track`, { on }).then(r => r.request),
};

export const INSIGHTS_KEY = ['live', 'insights'] as const;
/** New figures arrived on the server: every insights query that is on screen reads again. */
export const insightsStale = (qc: QueryClient): Promise<void> => qc.invalidateQueries({ queryKey: INSIGHTS_KEY });

const opts = { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } as const;
/** One site's Search Console and Analytics detail. `siteId` null: nothing is asked. */
export const useSiteInsights = (siteId: string | null, on = true) =>
  useQuery({ queryKey: [...INSIGHTS_KEY, 'site', siteId], queryFn: () => insightsApi.site(siteId!), enabled: on && !!siteId, ...opts });
export const useRank = (on = true) => useQuery({ queryKey: [...INSIGHTS_KEY, 'rank'], queryFn: insightsApi.rank, enabled: on, ...opts });
export const useGa4 = (on = true) => useQuery({ queryKey: [...INSIGHTS_KEY, 'ga4'], queryFn: insightsApi.ga4, enabled: on, ...opts });

/* ---------- Words and numbers shared by the tabs ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-07" -> "7 Sep" (the date as the source counts days; no time zone is applied). */
export const dayLabel = (date: string): string => { const [, m, d] = date.split('-'); return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`.trim(); };
export const num = (v: number): string => Math.round(v).toLocaleString('en-US');
export const pct = (v: number): string => (v * 100).toFixed(1) + '%';
/** A URL as a path when it is on the site's own domain ("/cold-brew/"), else as it is. */
export function pagePath(url: string): string {
  try { const u = new URL(url); return (u.pathname || '/') + u.search; } catch { return url; }
}

/* Data behind the heat map on Rank tracking. Demo mode: the prototype's KG and heatHTML(), lines 1551-1561, without
   the markup. Outside demo mode: the 7-day position change of the tracked keywords the server reads from Search
   Console (liveHeatRows). */
import type { RankWire } from '@/store/insightsApi';
import { hashStr, mapData, seeded, type CountryStat } from '@/store/rules';
import type { AppState, Site } from '@/store/types';

/** Keyword intent groups: [full name, short name for narrow screens]. */
export const KG: readonly (readonly [string, string])[] = [['Informational', 'Info'], ['Commercial', 'Comm.'], ['Transactional', 'Trans.'], ['Local', 'Local'], ['Long-tail', 'Long']];
/** The intents the Keyword agent gives a keyword (server/engine.ts), in the same shape. */
export const LIVE_KG: readonly (readonly [string, string])[] = [['Informational', 'Info'], ['Commercial', 'Comm.'], ['Transactional', 'Trans.'], ['Navigational', 'Nav.'], ['Local', 'Local']];

export type HeatClass = 'u2' | 'u1' | 'z' | 'd1' | 'd2';
export interface HeatCell { group: string; v: number; cls: HeatClass }
export interface HeatRow { country: CountryStat; cells: HeatCell[] }

/** "+1.4", "−2.0" (a minus sign, not a hyphen), "0.0" */
export const signed = (v: number): string => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);

export const heatClass = (v: number): HeatClass => v >= 2.5 ? 'u2' : v >= .5 ? 'u1' : v > -.5 ? 'z' : v > -2.5 ? 'd1' : 'd2';

/**
 * One row per country with live sites inside the site filter, by name. Blocked domains pull a country's row down.
 * The values are sample numbers: outside demo mode the rows come from liveHeatRows().
 */
export function heatRows(s: Pick<AppState, 'sample' | 'sites' | 'siteFilter'>): HeatRow[] {
  if (!s.sample) return [];
  return mapData(s).filter(c => c.live).sort((x, y) => x.name.localeCompare(y.name)).map(c => ({
    country: c,
    cells: KG.map(([group]) => {
      const r = seeded(hashStr(c.cc + group));
      const v = Math.max(-9, Math.round((r() * 7 - 2.5 - (c.blocked ? 2 + c.blocked / c.n * 10 : 0)) * 10) / 10);
      return { group, v, cls: heatClass(v) };
    }),
  }));
}

/** A cell of the real heat map: the average 7-day change of `n` keywords, or nothing to show (`v` null). */
export interface LiveHeatCell { group: string; v: number | null; n: number; cls: HeatClass | 'na' }
export interface LiveHeatRow { cc: string; name: string; cells: LiveHeatCell[] }

/**
 * One row per country that has a tracked keyword with a 7-day change, by name: for each intent, the average change
 * of the keywords of that intent on the country's sites inside the site filter. A keyword without an intent (its
 * article did not come from a research result) is in the table only.
 */
export function liveHeatRows(rank: RankWire | undefined, sites: readonly Pick<Site, 'id' | 'cc' | 'country'>[], siteFilter: string): LiveHeatRow[] {
  if (!rank) return [];
  const by = new Map<string, { name: string; sums: Map<string, { sum: number; n: number }> }>();
  for (const s of sites) {
    if (siteFilter !== 'all' && siteFilter !== s.id) continue;
    for (const k of rank.sites[s.id]?.keywords ?? []) {
      if (k.change7 === null || !LIVE_KG.some(([g]) => g === k.intent)) continue;
      const c = by.get(s.cc) ?? { name: s.country || s.cc, sums: new Map() };
      const x = c.sums.get(k.intent) ?? { sum: 0, n: 0 };
      x.sum += k.change7; x.n++;
      c.sums.set(k.intent, x); by.set(s.cc, c);
    }
  }
  return [...by].map(([cc, c]) => ({
    cc, name: c.name,
    cells: LIVE_KG.map(([group]): LiveHeatCell => {
      const x = c.sums.get(group);
      if (!x) return { group, v: null, n: 0, cls: 'na' };
      const v = Math.round(x.sum / x.n * 10) / 10;
      return { group, v, n: x.n, cls: heatClass(v) };
    }),
  })).sort((x, y) => x.name.localeCompare(y.name));
}

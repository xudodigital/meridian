/* The weekly report: the prototype's reportRows() and reportCSV() (lines 1682-1686), as pure functions of the state. */
import { inSite } from '@/store/rules';
import type { AppState } from '@/store/types';

export interface ReportRow {
  site: string;
  country: string;
  clicks: number;
  published: number;
  waiting: number;
  /** USD, last 7 days. */
  spend: number;
  /** "None" when the site has no open issue. */
  issue: string;
}

/** Articles published before this sample started, per site id. */
const PB: Readonly<Record<string, number>> = { a: 6, b: 4, c: 2 };

export function reportRows(s: Pick<AppState, 'sites' | 'articles' | 'settings' | 'siteFilter'>): ReportRow[] {
  return s.sites.filter(x => inSite(s, x.id)).map(x => ({
    site: x.domain,
    country: x.country,
    clicks: Math.round((x.clicks || 0) / 4),
    published: (PB[x.id] || 0) + s.articles.filter(a => a.s === x.id && a.status === 'published').length,
    waiting: s.articles.filter(a => a.s === x.id && a.status === 'review').length,
    spend: x.spend * 7 * 0.8,
    issue: x.access === 'blocked' ? 'Blocked in ' + x.country : x.status === 'dns' ? 'Waiting for DNS' : x.spend / s.settings.budget >= .8 ? 'Near daily budget' : 'None',
  }));
}

export function reportCSV(rows: readonly ReportRow[]): string {
  return 'Site,Country,Clicks,Articles published,Waiting for review,Spend (USD),Issue\n'
    + rows.map(r => [r.site, r.country, r.clicks, r.published, r.waiting, r.spend.toFixed(2), r.issue].join(',')).join('\n');
}

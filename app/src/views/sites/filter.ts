/* Pure helpers of the Sites list (the prototype's sitesFiltered(), line 1489). */
import { inSite } from '@/store/rules';
import type { SitesStatusFilter } from '@/store/slices/sites';
import type { Site } from '@/store/types';

export interface SitesQuery { siteFilter: string; sq: string; sst: SitesStatusFilter; sco: string }

/** Sites inside the top-bar filter that match the search text, the status (or "blocked") and the country. */
export function sitesFiltered(sites: readonly Site[], f: SitesQuery): Site[] {
  const q = f.sq.trim().toLowerCase();
  return sites.filter(s => inSite(f, s.id)
    && (!q || (s.domain + ' ' + s.country + ' ' + s.topic + ' ' + s.lang).toLowerCase().includes(q))
    && (!f.sst || (f.sst === 'blocked' ? s.access === 'blocked' : s.status === f.sst))
    && (!f.sco || s.country === f.sco));
}

/** "1 site" / "3 sites". */
export const nSites = (n: number): string => `${n} site${n === 1 ? '' : 's'}`;

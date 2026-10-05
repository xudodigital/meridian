/* Data behind the silo tree on Site architecture: the prototype's treeHTML(), lines 1538-1550, without the markup.
   Silos listed in the Architecture table use its numbers; the others get stable sample numbers from a seeded generator. */
import { cellText, hashStr, inSite, seeded } from '@/store/rules';
import type { AppState } from '@/store/types';

export interface SiloNode {
  name: string;
  slug: string;
  /** Pages in the silo. */
  n: number;
  /** Click depth, as text ("2"). */
  depth: string;
  published: number;
  draft: number;
  planned: number;
  orphan: number;
}
export interface SiloTree {
  domain: string;
  silos: SiloNode[];
  total: { n: number; published: number; draft: number; planned: number; orphan: number };
}

/** "Hanoi cafés" -> "/hanoi-cafes/" */
export const slugOf = (name: string): string =>
  '/' + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '/';

/** The tree of the first site inside the site filter that has silos, or null when there is none. */
export function siloTree(s: Pick<AppState, 'sites' | 'siteFilter' | 'mod'>): SiloTree | null {
  const site = s.sites.find(x => inSite(s, x.id) && x.silos.length);
  if (!site) return null;
  const known = s.mod.architecture.rows.filter(r => r.s === site.id);
  const total = { n: 0, published: 0, draft: 0, planned: 0, orphan: 0 };
  const silos = site.silos.map((name): SiloNode => {
    const r = seeded(hashStr(site.id + name)), row = known.find(x => cellText(x.c[0]) === name);
    /* The order of the r() calls follows the prototype, so the sample numbers match it. */
    const n = row ? Number(cellText(row.c[2])) : 6 + Math.floor(r() * 12);
    const orphan = row ? Number((/(\d+) orphan/.exec(cellText(row.c[4])) || [0, 0])[1]) : 0;
    const rest = n - orphan, published = Math.round(rest * (site.status === 'live' ? .6 + r() * .3 : r() * .15));
    const draft = Math.min(rest - published, 1 + Math.floor(r() * 3)), planned = rest - published - draft;
    const slug = row ? cellText(row.c[1]) : slugOf(name);
    const depth = row ? cellText(row.c[3]) : String(2 + Math.floor(r() * 2));
    total.n += n; total.published += published; total.draft += draft; total.planned += planned; total.orphan += orphan;
    return { name, slug, n, depth, published, draft, planned, orphan };
  });
  return { domain: site.domain, silos, total };
}

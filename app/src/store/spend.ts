/* Real spend and tokens outside demo mode, from the server's ledger (server/ledger.ts): one row per run of an agent
   job, summed per site and per agent. The server sends the sums with GET /api/state and again in a `spend` event after
   every run, at midnight and when the budget changes; live.ts keeps them in store.live.spend. spendTo() puts them
   where the screens read them (a site's spend today and 28-day tokens, an agent's tokens today), and the helpers below
   answer what the daily budget means for a site right now. Demo mode keeps the simulation's numbers. */
import { showBudget } from './rules';
import type { Agent, AppState, Site, SpendWire } from './types';

/** The agents whose jobs the server runs, by the name the ledger records them under. */
export const LEDGER_AGENT: Readonly<Record<string, string>> = { kw: 'Keyword', wr: 'Content Writer', bld: 'Site Builder', res: 'Research', arc: 'Architect', seo: 'SEO/GEO Optimizer', lnk: 'Internal Linker', ana: 'Analyst', gd: 'Graphic Designer' };

export type SpendTarget = Pick<AppState, 'live' | 'sites' | 'sample'> & { agents?: Agent[] };

/**
 * Writes the ledger's sums into the sites and agents. Called with an immer draft whenever the sums or the sites
 * document change (serverFacts.ts), because the saved documents do not carry these server-owned numbers.
 */
export function spendTo(d: SpendTarget): void {
  if (d.sample) return;
  const sp = d.live.spend;
  d.sites.forEach(s => {
    const x = sp?.sites[s.id];
    s.spend = x?.today ?? 0;
    /* In millions, like the demo data: the charts print it with an "M". */
    s.tok28 = (x?.tokens28 ?? 0) / 1e6;
  });
  d.agents?.forEach(a => { a.tokens = sp?.agents[LEDGER_AGENT[a.id] ?? '']?.tokens ?? 0; });
}

type S = Pick<AppState, 'live' | 'sample'>;

/** The daily budget per site the server enforces, or null when it has not said (demo mode, an older server). */
export const liveBudget = (s: S): number | null => s.sample ? null : s.live.spend?.budget ?? null;

/** The site used its daily budget: the server refuses new agent jobs for it and holds the waiting ones until midnight. */
export function budgetUsed(s: S, siteId: string): boolean {
  const sp = s.sample ? null : s.live.spend;
  return showBudget(s) && !!sp && (sp.sites[siteId]?.today ?? 0) >= sp.budget;
}

/** What a waiting job of such a site shows instead of "Queued". */
export const HELD_LABEL = 'Waiting for budget';
/** The sentence next to it: why, and the two ways it starts again. */
export const heldNote = (sp: Pick<SpendWire, 'budget'>, domain: string): string =>
  `${domain} has used its daily budget of ${usd(sp.budget)}. This job starts after midnight, or when the budget is raised in Settings.`;
/** `heldNote` for a site id, or null when the site still has budget (or in demo mode). */
export function heldFor(s: S & Pick<AppState, 'sites'>, siteId: string, domain = ''): string | null {
  if (!budgetUsed(s, siteId) || !s.live.spend) return null;
  return heldNote(s.live.spend, s.sites.find(x => x.id === siteId)?.domain || domain || 'This site');
}

/** "$0.36", "$12.40": two decimals, because one article costs well under a dollar. */
export const usd = (n: number): string => '$' + n.toFixed(2);
/** Tokens as people read them: 950, 12.4k, 1.25M. */
export const tokensText = (n: number): string => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));

/** How many of a site's jobs wait for budget: research requests, articles and photo jobs that are queued. */
export function heldJobs(s: Pick<AppState, 'live' | 'sample'>, siteId: string): number {
  if (!budgetUsed(s, siteId)) return 0;
  const reqs = Object.values(s.live.reqs).filter(r => r.siteId === siteId && r.status === 'queued').length;
  const arts = Object.values(s.live.arts).filter(a => a.siteId === siteId);
  return reqs + arts.filter(a => a.status === 'queued' || a.status === 'revision').length
    + arts.filter(a => a.photos?.status === 'queued' && (a.status === 'review' || a.status === 'approved')).length;
}

/** The sites in `all` that used their budget today, for the notice on Analytics. */
export const stoppedSites = (s: S, all: readonly Site[]): Site[] => all.filter(x => budgetUsed(s, x.id));

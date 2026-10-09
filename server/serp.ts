import { SERP_PROVIDERS, type SerpProvider } from '../shared/serp.ts';
import { dfsReady, serpSnapshot } from './dataforseo.ts';
import { serpApiReady, serpApiSnapshot } from './serpapi.ts';
import { searchApiReady, searchApiSnapshot } from './searchapi.ts';
import { ServiceError } from './net.ts';
export { SERP_PROVIDERS };
export const serpReady = (provider: SerpProvider) => provider === 'serpapi' ? serpApiReady() : provider === 'searchapi' ? searchApiReady() : dfsReady();
/** Resolve once when queued. Never spend on another provider after a quota or network failure. */
export const defaultSerpProvider = (): SerpProvider | null => serpApiReady() ? 'serpapi' : searchApiReady() ? 'searchapi' : dfsReady() ? 'dfs' : null;
export async function readSerp(provider: SerpProvider, site: { cc: string; country: string; lang: string }, keyword: string, signal: AbortSignal) {
  if (!serpReady(provider)) throw new ServiceError(`Connect ${SERP_PROVIDERS[provider]} in Integrations before SERP research.`);
  return provider === 'serpapi' ? serpApiSnapshot(site, keyword, signal) : provider === 'searchapi' ? searchApiSnapshot(site, keyword, signal) : { ...await serpSnapshot(site, keyword, signal), provider: 'dfs' as const };
}

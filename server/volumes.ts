import { dfsReady, searchVolumes } from './dataforseo.ts';
import { googleAdsReady, googleAdsVolumes } from './google-ads.ts';
import { ServiceError } from './net.ts';
import { VOLUME_PROVIDERS, type VolumeProvider } from '../shared/volumes.ts';
export const defaultVolumeProvider = (): VolumeProvider | null => googleAdsReady() ? 'ads' : dfsReady() ? 'dfs' : null;
export async function fetchVolumes(site: { cc: string; country: string; lang: string }, keywords: string[], chosen?: VolumeProvider) {
  const provider = chosen ?? defaultVolumeProvider();
  if (!provider) throw new ServiceError('Connect Google Ads or DataForSEO in Integrations to see search volume.');
  if (provider === 'ads' ? !googleAdsReady() : !dfsReady()) throw new ServiceError(`Connect ${VOLUME_PROVIDERS[provider]} in Integrations to see search volume.`);
  // A failed or quota-limited request never silently switches to another provider.
  return { ...await (provider === 'ads' ? googleAdsVolumes(site, keywords) : searchVolumes(site, keywords)), provider };
}

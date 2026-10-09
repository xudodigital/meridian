export const VOLUME_PROVIDERS = { ads: 'Google Ads', dfs: 'DataForSEO' } as const;
export type VolumeProvider = keyof typeof VOLUME_PROVIDERS;
export const isVolumeProvider = (x: unknown): x is VolumeProvider => typeof x === 'string' && Object.hasOwn(VOLUME_PROVIDERS, x);

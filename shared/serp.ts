export const SERP_PROVIDERS = { serpapi: 'SerpApi', searchapi: 'SearchAPI.io', dfs: 'DataForSEO' } as const;
export type SerpProvider = keyof typeof SERP_PROVIDERS;
export const isSerpProvider = (v: unknown): v is SerpProvider => typeof v === 'string' && Object.hasOwn(SERP_PROVIDERS, v);

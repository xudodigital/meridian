// Search volume and competition for keywords, from DataForSEO's Google Ads "search volume" endpoint (live method).
// One request carries one task with up to 1,000 keywords and costs the same for 1 keyword as for 1,000, so a research
// result is always sent as one batch. The figures are Google Ads data for one country: approximate monthly searches,
// and competition among advertisers (not how hard it is to rank). A keyword Google Ads has no data for gets none.
import { rowOf, usable, valuesOf } from './integrations.ts';
import { ServiceError, base, call, short } from './net.ts';

/** DataForSEO is set up and its last test did not fail. */
export const dfsReady = (): boolean => !!rowOf('dfs') && usable('dfs');

/* Google Ads location codes for countries are 2000 + the ISO 3166-1 numeric code (United States 2840, Vietnam 2704). */
const ISO_NUMERIC: Record<string, number> = {
  AE: 784, AR: 32, AT: 40, AU: 36, BD: 50, BE: 56, BG: 100, BR: 76, CA: 124, CH: 756, CL: 152, CN: 156, CO: 170, CZ: 203, DE: 276, DK: 208,
  DZ: 12, EG: 818, ES: 724, FI: 246, FR: 250, GB: 826, GH: 288, GR: 300, HK: 344, HU: 348, ID: 360, IE: 372, IL: 376, IN: 356, IT: 380, JP: 392,
  KE: 404, KH: 116, KR: 410, LK: 144, MA: 504, MM: 104, MX: 484, MY: 458, NG: 566, NL: 528, NO: 578, NP: 524, NZ: 554, PE: 604, PH: 608, PK: 586,
  PL: 616, PT: 620, RO: 642, RS: 688, SA: 682, SE: 752, SG: 702, TH: 764, TR: 792, TW: 158, UA: 804, US: 840, VN: 704, ZA: 710,
};
/** The location of a request: the code for a known country code, else the country's name as DataForSEO spells it. */
export function locationOf(site: { cc: string; country: string }): { location_code: number } | { location_name: string } | null {
  const n = ISO_NUMERIC[site.cc.trim().toUpperCase()];
  if (n) return { location_code: 2000 + n };
  const name = site.country.trim();
  return name ? { location_name: name } : null;
}

/**
 * A keyword as it may be sent: lower case, at most 80 characters and 10 words, and none of the symbols Google Ads
 * refuses (punctuation that is not part of the phrase is dropped first). Null when it cannot be sent.
 */
export function cleanKeyword(k: string): string | null {
  const t = k.normalize('NFC').toLowerCase().replace(/[,!?@%^()={};~`<>\\|"*:[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80 || t.split(' ').length > 10) return null;
  return /^[\p{L}\p{M}\p{N} .'&+#_/-]+$/u.test(t) ? t : null;
}

export type Volume = { volume: number | null; competition: '' | 'LOW' | 'MEDIUM' | 'HIGH' };
export type VolumeResult = {
  /** By keyword as cleanKeyword() returns it. A keyword that is not in the map was not sent or has no data. */
  volumes: Map<string, Volume>;
  /** What DataForSEO charged for the request, in USD (from its answer). */
  cost: number;
  sent: number;
};

type Task = { status_code?: number; status_message?: string; cost?: number; result?: { keyword?: string; search_volume?: number | null; competition?: string | null }[] | null };
type Answer = { status_code?: number; status_message?: string; cost?: number; tasks?: Task[] | null };

/** The live Google Ads endpoints allow 12 requests a minute per account: the 13th is not sent. */
const RATE = 12, sentAt: number[] = [];
const RATE_MSG = 'DataForSEO allows 12 volume requests a minute. Try again in a minute.';

function refusal(http: number, code: number, msg: string): ServiceError {
  if (http === 401 || code === 40100) return new ServiceError('DataForSEO refused the login or API password. Check it in Integrations.', 401);
  if (http === 402 || code === 40200 || code === 40210) return new ServiceError('The DataForSEO balance is used up. Top up the account, then refresh the volumes.', 402);
  if (http === 429 || code === 40202 || code === 40209) return new ServiceError(RATE_MSG, 429);
  return new ServiceError(`DataForSEO answered ${code || http}${msg ? ': ' + short(msg, 140) : '.'}`, http);
}

async function post(task: Record<string, unknown>): Promise<{ http: number; data: Answer }> {
  const now = Date.now();
  while (sentAt.length && now - sentAt[0]! > 60_000) sentAt.shift();
  if (sentAt.length >= RATE) throw new ServiceError(RATE_MSG, 429);
  sentAt.push(now);
  const v = valuesOf('dfs') ?? {};
  const r = await call<Answer>('DataForSEO', base('DATAFORSEO') + '/v3/keywords_data/google_ads/search_volume/live', {
    headers: { authorization: 'Basic ' + Buffer.from(`${v.login ?? ''}:${v.password ?? ''}`).toString('base64') },
    /* One task per call, as the live method requires. */
    body: [task], timeoutMs: 60_000,
  });
  return { http: r.status, data: r.data };
}

/**
 * Search volume and competition for `keywords` in the site's country and language, in one request. Throws a
 * ServiceError with a message fit to show when DataForSEO is not set up, refuses, or cannot be reached.
 */
export async function searchVolumes(site: { cc: string; country: string; lang: string }, keywords: string[]): Promise<VolumeResult> {
  if (!dfsReady()) throw new ServiceError('DataForSEO is not connected. Add the API login and password in Integrations.');
  const where = locationOf(site);
  if (!where) throw new ServiceError('The site has no country, so there is no place to ask search volume for.');
  const list = [...new Set(keywords.map(cleanKeyword).filter((k): k is string => !!k))].slice(0, 1000);
  if (!list.length) return { volumes: new Map(), cost: 0, sent: 0 };
  const lang = site.lang.trim();
  let r = await post({ keywords: list, ...where, ...(lang ? { language_name: lang } : {}), tag: 'meridian' });
  let task = r.data.tasks?.[0], cost = Number(task?.cost ?? r.data.cost) || 0;
  /* A language name DataForSEO does not know (40501, invalid field) is left out: the country still decides the figures. */
  if (lang && task?.status_code === 40501 && /language/i.test(task.status_message ?? '')) {
    r = await post({ keywords: list, ...where, tag: 'meridian' });
    task = r.data.tasks?.[0]; cost += Number(task?.cost ?? r.data.cost) || 0;
  }
  const top = Number(r.data.status_code) || 0;
  if (r.http !== 200 || (top && top !== 20000)) throw refusal(r.http, top, r.data.status_message ?? '');
  if (!task) throw new ServiceError('DataForSEO answered without a result.');
  if (task.status_code && task.status_code !== 20000) throw refusal(200, task.status_code, task.status_message ?? '');
  const volumes = new Map<string, Volume>();
  for (const x of task.result ?? []) {
    const k = typeof x.keyword === 'string' ? x.keyword.toLowerCase() : '';
    if (!k) continue;
    const c = String(x.competition ?? '').toUpperCase();
    volumes.set(k, { volume: typeof x.search_volume === 'number' && x.search_volume >= 0 ? Math.round(x.search_volume) : null, competition: c === 'LOW' || c === 'MEDIUM' || c === 'HIGH' ? c : '' });
  }
  return { volumes, cost, sent: list.length };
}

/** A bounded provider SERP snapshot, never direct Google scraping. No silent country/language fallback. */
export async function serpSnapshot(site: { cc: string; country: string; lang: string }, keyword: string, signal: AbortSignal) {
  if (!dfsReady()) throw new ServiceError('Connect DataForSEO in Integrations before SERP research.');
  const where = locationOf(site);
  if (!where || !site.lang.trim()) throw new ServiceError('Save the site country and language first.');
  signal.throwIfAborted();
  type SerpAnswer = { status_code?: number; status_message?: string; tasks?: { status_code?: number; status_message?: string; cost?: number; result?: { items?: Record<string, unknown>[]; datetime?: string; item_types?: string[] }[] }[] };
  const v = valuesOf('dfs') ?? {};
  const r = await call<SerpAnswer>('DataForSEO', base('DATAFORSEO') + '/v3/serp/google/organic/live/advanced', {
    headers: { authorization: 'Basic ' + Buffer.from(`${v.login ?? ''}:${v.password ?? ''}`).toString('base64') },
    body: [{ keyword, ...where, language_name: site.lang.trim(), device: 'desktop', depth: 10, tag: 'meridian-serp' }], timeoutMs: 60_000, signal,
  });
  signal.throwIfAborted();
  const t = r.data.tasks?.[0];
  if (r.status !== 200 || r.data.status_code !== 20000 || !t || t.status_code !== 20000) throw refusal(r.status, t?.status_code ?? r.data.status_code ?? 0, t?.status_message ?? r.data.status_message ?? '');
  const result = t.result?.[0];
  if (!result?.items) throw new ServiceError('DataForSEO returned no SERP snapshot.');
  return { at: Date.now(), providerTime: result.datetime ?? '', keyword, country: site.country, language: site.lang, device: 'desktop', cost: Number(t.cost) || 0, types: result.item_types ?? [], items: result.items.slice(0, 30).map(x => ({ type: x.type, rank: x.rank_absolute, url: typeof x.url === 'string' ? x.url.slice(0, 2000) : '', title: String(x.title ?? '').slice(0, 300), description: String(x.description ?? '').slice(0, 1500) })) };
}

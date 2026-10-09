// Google Ads v25: query account/target constants and historical keyword metrics only. No campaign mutations.
import { accessToken } from './google.ts';
import { valuesOf, usable } from './integrations.ts';
import { base, call, ServiceError } from './net.ts';
import { cleanKeyword, type VolumeResult, type Volume } from './dataforseo.ts';
import type { TestResult } from './connectors.ts';

export const googleAdsReady = () => usable('ads') && !!valuesOf('ads')?.refresh && !!valuesOf('ads')?.customerId;
const VERSION = 'v25';
type Config = Record<string, string>;
function account(v: Config) {
  if (!/^\d{10}$/.test(v.customerId ?? '') || (v.loginCustomerId && !/^\d{10}$/.test(v.loginCustomerId)))
    throw new ServiceError('Save a valid Google Ads Customer ID (10 digits) in Integrations.');
  return v.customerId;
}
function refused(status: number, data: unknown): ServiceError {
  // Classify structured enums; never echo Google error messages, URLs or token material.
  const e = data as { error?: { status?: string; details?: { errors?: { errorCode?: Record<string, string> }[]; reason?: string }[] } };
  const codes = (e?.error?.details ?? []).flatMap(d => [d.reason ?? '', ...(d.errors ?? []).flatMap(x => Object.values(x.errorCode ?? {}))]).join(' ');
  if (status === 429 || /RESOURCE_EXHAUSTED|RESOURCE_TEMPORARILY_EXHAUSTED|EXCESSIVE_SHORT_TERM_QUERY_RESOURCE_CONSUMPTION/.test(codes + ' ' + e?.error?.status))
    return new ServiceError('Google Ads quota or rate limit reached. Wait before refreshing volumes.', 429);
  if (/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|CLOUD_PROJECT_NOT_APPROVED|DEVELOPER_TOKEN_NOT_APPROVED/.test(codes))
    return new ServiceError('Your OAuth client’s Google Cloud project needs Google Ads API production and keyword-planning access. Check Google Ads API Overview in Google Cloud.', 403);
  if (/SERVICE_DISABLED/.test(codes)) return new ServiceError('Enable Google Ads API in the OAuth client’s Google Cloud project.', 403);
  if (status === 401) return new ServiceError('Google Ads access has expired or was removed. Connect with Google again.', 401);
  if (status === 403 || /USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|INVALID_LOGIN_CUSTOMER_ID|CUSTOMER_NOT_FOUND|ACTION_NOT_PERMITTED/.test(codes))
    return new ServiceError('Google Ads refused access. Check the selected customer, optional manager, account status and project keyword-planning permissions.', 403);
  return new ServiceError(`Google Ads could not complete the request (HTTP ${status}). Check account access and targeting.`, status);
}
async function adsCall<T>(suffix: string, body: unknown, v: Config = valuesOf('ads') ?? {}): Promise<T> {
  const customer = account(v);
  const send = (token: string) => call<T>('Google Ads', `${base('GOOGLE_ADS')}/${VERSION}/customers/${customer}${suffix}`, {
    headers: { authorization: 'Bearer ' + token, ...(v.loginCustomerId ? { 'login-customer-id': v.loginCustomerId } : {}) }, body, timeoutMs: 60_000,
  });
  let r = await send(await accessToken('ads', v));
  if (r.status === 401) r = await send(await accessToken('ads', valuesOf('ads') ?? v, true));
  if (r.status !== 200) throw refused(r.status, r.data);
  if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data)) throw new ServiceError('Google Ads returned an invalid response.');
  return r.data;
}
type Rows = { results?: { customer?: { id?: string; manager?: boolean; testAccount?: boolean; status?: string }; geoTargetConstant?: { resourceName?: string }; languageConstant?: { resourceName?: string } }[] };
export async function testGoogleAds(v: Config): Promise<TestResult> {
  if (!v.refresh) return { status: 'warn', msg: 'Customer saved. Connect with Google to authorize keyword metrics.' };
  const r = await adsCall<Rows>('/googleAds:search', { query: 'SELECT customer.id, customer.manager, customer.test_account, customer.status FROM customer LIMIT 1' }, v);
  const c = r.results?.[0]?.customer;
  if (!c || c.id !== account(v)) return { status: 'bad', msg: 'Google Ads did not confirm the selected customer account.' };
  if (c.manager) return { status: 'bad', msg: 'Choose a client Customer ID; put the manager ID in the optional manager field.' };
  if (c.testAccount) return { status: 'bad', msg: 'This is a Google Ads test account. Real keyword metrics require an eligible production account.' };
  if (c.status !== 'ENABLED') return { status: 'bad', msg: 'The selected Google Ads account is not enabled.' };
  return { status: 'ok', msg: 'Account access verified. Keyword-planning permission is checked when fetching volumes; no search was run.', tail: 'Customer ' + c.id };
}
const quoted = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const metric = (x: unknown): number | null => {
  if (typeof x !== 'number' && !(typeof x === 'string' && /^\d+$/.test(x))) return null;
  const n = Number(x); return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
/** Targets are looked up from Google; unknown languages/countries never become worldwide or English. */
export async function googleAdsVolumes(site: { cc: string; country: string; lang: string }, keywords: string[]): Promise<VolumeResult> {
  if (!googleAdsReady()) throw new ServiceError('Connect Google Ads in Integrations to fetch keyword volume.');
  const cc = site.cc.trim().toUpperCase(), language = site.lang.trim();
  if (!/^[A-Z]{2}$/.test(cc) || !language || language.length > 80) throw new ServiceError('Save the site country code and language before fetching Google Ads volumes.');
  const list = [...new Set(keywords.map(cleanKeyword).filter((x): x is string => !!x))];
  if (list.length > 1000) throw new ServiceError('Fetch at most 1,000 keywords in one batch.');
  if (!list.length) return { volumes: new Map(), sent: 0, cost: 0 };
  const geo = await adsCall<Rows>('/googleAds:search', { query: `SELECT geo_target_constant.resource_name FROM geo_target_constant WHERE geo_target_constant.country_code = '${cc}' AND geo_target_constant.target_type = 'Country' AND geo_target_constant.status = 'ENABLED' LIMIT 2` });
  const lang = await adsCall<Rows>('/googleAds:search', { query: `SELECT language_constant.resource_name FROM language_constant WHERE language_constant.name = '${quoted(language)}' LIMIT 2` });
  const g = geo.results?.[0]?.geoTargetConstant?.resourceName, l = lang.results?.[0]?.languageConstant?.resourceName;
  if (geo.results?.length !== 1 || lang.results?.length !== 1 || !/^geoTargetConstants\/\d+$/.test(g ?? '') || !/^languageConstants\/\d+$/.test(l ?? ''))
    throw new ServiceError('Google Ads could not resolve this country or language uniquely. Update the site profile; no targeting fallback was used.');
  type Answer = { results?: { text?: string; closeVariants?: string[]; keywordMetrics?: { avgMonthlySearches?: string | number; competition?: string } }[] };
  const result = await adsCall<Answer>(':generateKeywordHistoricalMetrics', { keywords: list, language: l, geoTargetConstants: [g], keywordPlanNetwork: 'GOOGLE_SEARCH' });
  if (result.results !== undefined && !Array.isArray(result.results)) throw new ServiceError('Google Ads returned an invalid keyword metric list.');
  const volumes = new Map<string, Volume>(), wanted = new Set(list);
  for (const row of result.results ?? []) {
    const group = typeof row.text === 'string' ? cleanKeyword(row.text) : null;
    if (!group) continue;
    const variants = [row.text!, ...(Array.isArray(row.closeVariants) ? row.closeVariants.filter(x => typeof x === 'string') : [])].map(cleanKeyword).filter((x): x is string => !!x && wanted.has(x));
    const c = row.keywordMetrics?.competition;
    const v: Volume = { volume: metric(row.keywordMetrics?.avgMonthlySearches), competition: c === 'LOW' || c === 'MEDIUM' || c === 'HIGH' ? c : '', group };
    // Same figure is a shared group, never individual estimates for each close variant.
    for (const k of variants) volumes.set(k, v);
  }
  return { volumes, sent: list.length, cost: 0 };
}

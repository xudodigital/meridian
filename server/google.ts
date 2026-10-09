// Google sign-in for Search Console and Analytics: the OAuth flow, refreshing access tokens, the connection tests,
// Search Console clicks per site and per page and query, and the Analytics properties with their reports. Uses the
// OAuth client the admin stored under "Google sign-in" (integrations.ts).
//
// The flow: "Connect with Google" asks for /api/oauth/google/start (signed in, admin) and goes to Google with a random
// `state`; Google sends the browser back to /api/oauth/google/callback, which is matched by that state (the session
// cookie is SameSite=Strict, so it does not come along on a redirect from Google). Tokens are stored encrypted.
import { randomToken } from './secrets.ts';
import { ServiceError, base, call, errorText, short } from './net.ts';
import { defOf, refreshValues, storeValues, valuesOf } from './integrations.ts';

export type GoogleKind = 'gsc' | 'ga4' | 'ads';
const SCOPES: Record<GoogleKind, string> = {
  ads: 'https://www.googleapis.com/auth/adwords',
  gsc: 'https://www.googleapis.com/auth/webmasters.readonly',
  ga4: 'https://www.googleapis.com/auth/analytics.readonly',
};

/** The redirect URI to register in Google Cloud. Google requires an exact match, so it is always this one. */
export const redirectUri = (): string => `http://localhost:${Number(process.env.PORT) || 4310}/api/oauth/google/callback`;

type Pending = { kind: GoogleKind; by: string; exp: number };
const pending = new Map<string, Pending>();
const sweep = () => { const now = Date.now(); for (const [k, p] of pending) if (p.exp < now) pending.delete(k); };

/** The Google consent URL for a service, or an error when the OAuth client is not set up. */
export function startUrl(kind: GoogleKind, by: string): { url: string } | { error: string } {
  const c = valuesOf('google');
  if (!c?.clientId || !c.clientSecret) return { error: 'Set up Google sign-in first: paste the OAuth client ID and secret from Google Cloud.' };
  if (kind === 'ads' && !valuesOf('ads')?.customerId) return { error: 'Save the Google Ads Customer ID first.' };
  sweep();
  const state = randomToken(24);
  pending.set(state, { kind, by, exp: Date.now() + 10 * 60_000 });
  const q = new URLSearchParams({
    client_id: c.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email ' + SCOPES[kind],
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return { url: `${base('GOOGLE_AUTH')}/o/oauth2/v2/auth?${q}` };
}

type TokenAnswer = { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string; error_description?: string };

/** The email in an ID token from Google's token endpoint (received directly over TLS, so not verified again). */
function emailOf(idToken: string | undefined): string {
  try { const p = JSON.parse(Buffer.from((idToken ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: unknown }; return typeof p.email === 'string' ? p.email : ''; }
  catch { return ''; }
}

/** Google sent the browser back. Stores the tokens; returns what was connected, or the error to show. */
export async function finish(q: URLSearchParams): Promise<{ kind: GoogleKind; by: string; account: string } | { error: string; kind?: GoogleKind }> {
  const state = q.get('state') ?? '';
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.exp < Date.now()) return { error: 'This Google sign-in has expired. Click Connect with Google again.' };
  if (q.get('error')) return { kind: p.kind, error: q.get('error') === 'access_denied' ? 'Google access was not granted.' : 'Google answered: ' + short(q.get('error') ?? '', 80) };
  const c = valuesOf('google');
  if (!c?.clientId || !c.clientSecret) return { kind: p.kind, error: 'Google sign-in is not set up any more.' };
  const r = await call<TokenAnswer>('Google', base('GOOGLE_TOKEN') + '/token', {
    form: { code: q.get('code') ?? '', client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code' },
  });
  if (r.status !== 200 || !r.data.access_token) return { kind: p.kind, error: 'Google refused the sign-in. Check the OAuth client and try again.' };
  if (!r.data.refresh_token) return { kind: p.kind, error: 'Google did not give a lasting token. Remove Meridian\'s access at myaccount.google.com/permissions, then connect again.' };
  const account = emailOf(r.data.id_token);
  storeValues(defOf(p.kind)!, {
    ...(valuesOf(p.kind) ?? {}), refresh: r.data.refresh_token, access: r.data.access_token, accessExp: String(Date.now() + (r.data.expires_in ?? 3600) * 1000), account,
  }, p.by);
  return { kind: p.kind, by: p.by, account };
}

/** A valid access token for a connected service, refreshed when it is about to expire (or when `force` says so). */
export async function accessToken(kind: GoogleKind, v = valuesOf(kind), force = false): Promise<string> {
  if (!v?.refresh) throw new ServiceError('Not connected to Google.');
  if (!force && v.access && Number(v.accessExp) > Date.now() + 60_000) return v.access;
  const c = valuesOf('google');
  if (!c?.clientId || !c.clientSecret) throw new ServiceError('Google sign-in is not set up any more. Paste the OAuth client again.');
  const r = await call<TokenAnswer>('Google', base('GOOGLE_TOKEN') + '/token', {
    form: { refresh_token: v.refresh, client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'refresh_token' },
  });
  if (r.status !== 200 || !r.data.access_token) {
    if (r.data.error === 'invalid_grant') throw new ServiceError('Google access was removed or has expired. Connect with Google again.', 401);
    throw new ServiceError('Google refused to renew access. Check the OAuth client and reconnect.');
  }
  const next = { ...v, access: r.data.access_token, accessExp: String(Date.now() + (r.data.expires_in ?? 3600) * 1000) };
  refreshValues(defOf(kind)!, next);
  return r.data.access_token;
}

type Site = { siteUrl: string; permissionLevel: string };

/** The Search Console properties the account can read. */
export async function gscSites(token: string): Promise<Site[]> {
  const r = await call<{ siteEntry?: Site[] }>('Search Console', base('SEARCH_CONSOLE') + '/webmasters/v3/sites', { headers: { authorization: 'Bearer ' + token } });
  if (r.status !== 200) throw new ServiceError('Search Console answered ' + r.status + (errorText(r.data) ? ': ' + short(errorText(r.data), 120) : '.'), r.status);
  return (r.data.siteEntry ?? []).filter(s => s.permissionLevel !== 'siteUnverifiedUser');
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Test connection for Search Console and Analytics. */
export async function googleTest(kind: GoogleKind, v: Record<string, string>): Promise<{ status: 'ok' | 'warn' | 'bad'; msg: string; tail?: string }> {
  const token = await accessToken(kind, v);
  const who = v.account ? ` as ${v.account}` : '';
  if (kind === 'gsc') {
    const sites = await gscSites(token);
    return { status: sites.length ? 'ok' : 'warn', msg: sites.length ? `Connected${who}. ${plural(sites.length, 'property')} can be read.` : `Connected${who}, but this account has no Search Console properties.`, tail: v.account || plural(sites.length, 'property') };
  }
  type Acc = { accountSummaries?: { propertySummaries?: unknown[] }[] };
  const r = await call<Acc>('Google Analytics', base('GA_ADMIN') + '/v1beta/accountSummaries?pageSize=200', { headers: { authorization: 'Bearer ' + token } });
  if (r.status === 403 && /has not been used|disabled/i.test(errorText(r.data))) return { status: 'bad', msg: 'Turn on the Google Analytics Admin API in Google Cloud, then test again.' };
  if (r.status !== 200) return { status: 'bad', msg: 'Google Analytics answered ' + r.status + (errorText(r.data) ? ': ' + short(errorText(r.data), 120) : '.') };
  const n = (r.data.accountSummaries ?? []).reduce((x, a) => x + (a.propertySummaries?.length ?? 0), 0);
  return { status: n ? 'ok' : 'warn', msg: n ? `Connected${who}. ${plural(n, 'property')} can be read.` : `Connected${who}, but this account has no Analytics properties.`, tail: v.account || plural(n, 'property') };
}

/** Search Console figures for one site: the last 28 days, and the last 7, both ending 3 days ago (Search Console lags). */
export type SiteMetrics = { clicks28: number; impressions28: number; position28: number; clicks7: number; property: string; to: string };

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The property that covers a domain: the domain property first, then the https and http URL prefixes. */
export function propertyFor(domain: string, sites: Site[]): string | null {
  const d = domain.toLowerCase().replace(/^www\./, '');
  const want = [`sc-domain:${d}`, `https://${d}/`, `https://www.${d}/`, `http://${d}/`, `http://www.${d}/`];
  for (const w of want) { const hit = sites.find(s => s.siteUrl.toLowerCase() === w); if (hit) return hit.siteUrl; }
  return null;
}

type Totals = { clicks: number; impressions: number; position: number };
async function totals(token: string, prop: string, from: string, to: string): Promise<Totals | null> {
  type Q = { rows?: Totals[] };
  const r = await call<Q>('Search Console', `${base('SEARCH_CONSOLE')}/webmasters/v3/sites/${encodeURIComponent(prop)}/searchAnalytics/query`, {
    headers: { authorization: 'Bearer ' + token }, body: { startDate: from, endDate: to },
  });
  if (r.status !== 200) return null;
  return r.data.rows?.[0] ?? { clicks: 0, impressions: 0, position: 0 };
}

/** Figures for each domain that has a Search Console property the account can read. */
export async function gscMetrics(domains: { id: string; domain: string }[], now = Date.now()): Promise<Record<string, SiteMetrics>> {
  const token = await accessToken('gsc');
  const sites = await gscSites(token);
  const end = now - 3 * 86_400_000, to = day(end);
  const out: Record<string, SiteMetrics> = {};
  for (const s of domains) {
    const prop = propertyFor(s.domain, sites); if (!prop) continue;
    const m28 = await totals(token, prop, day(end - 27 * 86_400_000), to);
    const m7 = await totals(token, prop, day(end - 6 * 86_400_000), to);
    if (!m28 || !m7) continue;
    out[s.id] = { clicks28: m28.clicks, impressions28: m28.impressions, position28: Math.round(m28.position * 10) / 10, clicks7: m7.clicks, property: prop, to };
  }
  return out;
}

/* ---------- Reading data: Search Console rows, Analytics properties and reports ---------- */

/** Google's quota for a service or a property is used up for now: nothing is wrong with the connection. */
export class QuotaError extends ServiceError {}

type GoogleErr = { error?: { status?: string; errors?: { reason?: string }[] } };
/** A refusal from a Google data API, in words a person can act on. */
export function googleError(service: string, api: string, status: number, data: unknown): ServiceError {
  const e = (data as GoogleErr | null)?.error, why = `${e?.status ?? ''} ${e?.errors?.[0]?.reason ?? ''}`, own = short(errorText(data), 140);
  if (status === 429 || /RESOURCE_EXHAUSTED|quotaExceeded|rateLimitExceeded/i.test(why)) return new QuotaError(`The ${service} quota is used up for now. Meridian tries again at the next refresh.`, 429);
  if (status === 401) return new ServiceError('Google access was removed or has expired. Connect with Google again.', 401);
  if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(own + ' ' + why)) return new ServiceError(`Turn on the ${api} in Google Cloud, then refresh.`, 403);
  if (status === 403) return new ServiceError(`${service} does not let this Google account read it${own ? ': ' + own : '.'}`, 403);
  return new ServiceError(`${service} answered ${status}${own ? ': ' + own : '.'}`, status);
}

/** A call with the service's token. A 401 (Google ended the token early) renews the token once and tries again. */
async function withToken<T>(kind: GoogleKind, fn: (token: string) => Promise<{ status: number; data: T }>): Promise<{ status: number; data: T }> {
  const r = await fn(await accessToken(kind));
  return r.status === 401 ? fn(await accessToken(kind, valuesOf(kind), true)) : r;
}
const bearer = (token: string) => ({ authorization: 'Bearer ' + token });
const envInt = (name: string, def: number, max: number): number => { const n = Math.floor(Number(process.env[name])); return n >= 1 && n <= max ? n : def; };

/** The Search Console properties the connected account can read (with a renewed token when needed). */
export async function gscProperties(): Promise<Site[]> {
  const r = await withToken<{ siteEntry?: Site[] }>('gsc', t => call('Search Console', base('SEARCH_CONSOLE') + '/webmasters/v3/sites', { headers: bearer(t) }));
  if (r.status !== 200) throw googleError('Search Console', 'Search Console API', r.status, r.data);
  return (r.data.siteEntry ?? []).filter(s => s.permissionLevel !== 'siteUnverifiedUser');
}

/** One row of Search Console data. `page` and `query` are empty in a day's total. */
export type GscRow = { date: string; page: string; query: string; clicks: number; impressions: number; position: number };
type GscAnswer = { rows?: { keys?: string[]; clicks?: number; impressions?: number; position?: number }[] };

/** Rows per request: Search Console allows 1 to 25,000. The tests set a small page to exercise paging. */
const gscPage = () => envInt('MERIDIAN_GSC_PAGE', 25_000, 25_000);
/** Paging stops here: the API only exposes the top rows anyway, and a small site is far below it. */
export const GSC_MAX_ROWS = 200_000;

/**
 * searchAnalytics.query for web search, final data only, grouped by `dims`, paged by `startRow` until a page comes
 * back empty. Dates are inclusive, YYYY-MM-DD.
 */
async function gscQuery(prop: string, from: string, to: string, dims: ('date' | 'page' | 'query')[]): Promise<{ rows: GscRow[]; truncated: boolean }> {
  const url = `${base('SEARCH_CONSOLE')}/webmasters/v3/sites/${encodeURIComponent(prop)}/searchAnalytics/query`;
  const rows: GscRow[] = [], size = gscPage();
  for (let start = 0; ; start += size) {
    if (start >= GSC_MAX_ROWS) return { rows, truncated: true };
    const r = await withToken<GscAnswer>('gsc', t => call('Search Console', url, {
      headers: bearer(t), timeoutMs: 60_000,
      body: { startDate: from, endDate: to, dimensions: dims, type: 'web', dataState: 'final', aggregationType: 'auto', rowLimit: size, startRow: start },
    }));
    if (r.status !== 200) throw googleError('Search Console', 'Search Console API', r.status, r.data);
    const got = r.data.rows ?? [];
    for (const x of got) {
      const k = x.keys ?? [], at = (d: string) => { const i = dims.indexOf(d as 'date'); return i < 0 ? '' : String(k[i] ?? ''); };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(at('date'))) continue;
      rows.push({ date: at('date'), page: at('page').slice(0, 2000), query: at('query').slice(0, 500), clicks: Number(x.clicks) || 0, impressions: Number(x.impressions) || 0, position: Number(x.position) || 0 });
    }
    if (got.length < size) return { rows, truncated: false };
  }
}
/** A property's totals per day. Grouping by page or query leaves rows out, so the totals are asked for by date alone. */
export const gscDaily = async (prop: string, from: string, to: string): Promise<GscRow[]> => (await gscQuery(prop, from, to, ['date'])).rows;
/** A property's rows per day, page and query. */
export const gscDetail = (prop: string, from: string, to: string) => gscQuery(prop, from, to, ['date', 'page', 'query']);

/** An Analytics property the account can read, with the hosts of its web data streams (for matching it to a site). */
export type Ga4Property = { id: string; name: string; account: string; hosts: string[] };
const hostOf = (uri: string): string => { try { return new URL(/^https?:\/\//i.test(uri) ? uri : 'https://' + uri).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
/** More pages than this of accounts or streams is not a list a person would pick from. */
const ADMIN_MAX_PAGES = 20;

/** Every property of the connected account (accountSummaries, paged), each with its web streams' hosts (dataStreams). */
export async function ga4Properties(): Promise<Ga4Property[]> {
  type Acc = { accountSummaries?: { displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[]; nextPageToken?: string };
  type Streams = { dataStreams?: { type?: string; webStreamData?: { defaultUri?: string } }[]; nextPageToken?: string };
  const admin = base('GA_ADMIN'), out: Ga4Property[] = [];
  let page = '';
  for (let i = 0; i < ADMIN_MAX_PAGES; i++) {
    const r = await withToken<Acc>('ga4', t => call('Google Analytics', `${admin}/v1beta/accountSummaries?pageSize=200${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, { headers: bearer(t) }));
    if (r.status !== 200) throw googleError('Google Analytics', 'Google Analytics Admin API', r.status, r.data);
    for (const a of r.data.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) {
      if (/^properties\/\d{1,20}$/.test(p.property ?? '')) out.push({ id: p.property!, name: short(p.displayName ?? '', 100) || p.property!, account: short(a.displayName ?? '', 100), hosts: [] });
    }
    page = r.data.nextPageToken ?? '';
    if (!page) break;
  }
  for (const p of out) {
    let next = '';
    for (let i = 0; i < ADMIN_MAX_PAGES; i++) {
      const r = await withToken<Streams>('ga4', t => call('Google Analytics', `${admin}/v1beta/${p.id}/dataStreams?pageSize=200${next ? '&pageToken=' + encodeURIComponent(next) : ''}`, { headers: bearer(t) }));
      if (r.status === 429) throw googleError('Google Analytics', 'Google Analytics Admin API', r.status, r.data);
      /* A property whose streams cannot be listed is still offered in the select; it only cannot be matched by itself. */
      if (r.status !== 200) break;
      for (const s of r.data.dataStreams ?? []) { const h = s.type === 'WEB_DATA_STREAM' ? hostOf(s.webStreamData?.defaultUri ?? '') : ''; if (h && !p.hosts.includes(h)) p.hosts.push(h); }
      next = r.data.nextPageToken ?? '';
      if (!next) break;
    }
  }
  return out;
}

/** Users, sessions and engaged sessions of one day or one page. */
export type Ga4Row = { key: string; users: number; sessions: number; engaged: number };
export type Ga4Report = { rows: Ga4Row[]; total: Omit<Ga4Row, 'key'> | null; truncated: boolean };
const ga4Page = () => envInt('MERIDIAN_GA4_PAGE', 10_000, 250_000);
export const GA4_MAX_ROWS = 50_000;

/**
 * runReport for one property: active users, sessions and engaged sessions by date or by page path, with the totals
 * of the whole range, paged by `offset` up to the report's rowCount. One request at a time (a property allows ten).
 */
export async function ga4Report(property: string, from: string, to: string, by: 'date' | 'pagePath'): Promise<Ga4Report> {
  type Val = { value?: string };
  type Rep = { rows?: { dimensionValues?: Val[]; metricValues?: Val[] }[]; totals?: { metricValues?: Val[] }[]; rowCount?: number };
  const url = `${base('GA_DATA')}/v1beta/${property}:runReport`, size = ga4Page();
  const num = (v: Val[] | undefined, i: number) => Math.round(Number(v?.[i]?.value)) || 0;
  const out: Ga4Report = { rows: [], total: null, truncated: false };
  for (let offset = 0; ; offset += size) {
    if (offset >= GA4_MAX_ROWS) { out.truncated = true; return out; }
    const r = await withToken<Rep>('ga4', t => call('Google Analytics', url, {
      headers: bearer(t), timeoutMs: 60_000,
      body: {
        dateRanges: [{ startDate: from, endDate: to }], dimensions: [{ name: by }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'engagedSessions' }],
        orderBys: by === 'date' ? [{ dimension: { dimensionName: 'date' } }] : [{ metric: { metricName: 'sessions' }, desc: true }],
        metricAggregations: ['TOTAL'], limit: size, offset,
      },
    }));
    if (r.status !== 200) throw googleError('Google Analytics', 'Google Analytics Data API', r.status, r.data);
    const got = r.data.rows ?? [];
    for (const x of got) {
      const raw = x.dimensionValues?.[0]?.value ?? '';
      const key = by === 'date' ? raw.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : raw.slice(0, 2000);
      if (by === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(key) : !!key) out.rows.push({ key, users: num(x.metricValues, 0), sessions: num(x.metricValues, 1), engaged: num(x.metricValues, 2) });
    }
    const t = r.data.totals?.[0]?.metricValues;
    if (t && !out.total) out.total = { users: num(t, 0), sessions: num(t, 1), engaged: num(t, 2) };
    if (!got.length || offset + got.length >= (Number(r.data.rowCount) || 0)) return out;
  }
}

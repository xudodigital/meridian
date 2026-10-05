// Fake Google data APIs for the server tests, answering in the shapes of the real ones: Search Console
// searchAnalytics.query with dimensions (rows with `keys`, paged by rowLimit and startRow), the Analytics Admin API
// (accountSummaries and dataStreams, paged by pageToken) and the Analytics Data API runReport (dimensionValues and
// metricValues as strings, rowCount, totals, paged by limit and offset). Every data call needs a bearer token the fake
// knows; `google` holds the data and the switches (a revoked token, a used-up quota, an API that is turned off) and
// resetGoogle() restores it. The token endpoint and the property list stay in fake-services.ts.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hit } from './fake-services.ts';

export type FakeGscRow = { date: string; page: string; query: string; clicks: number; impressions: number; position: number };
export type FakeGa4 = {
  /** Shown as the property's name in the account summaries. */
  name: string; account: string;
  /** The default URIs of its web data streams. */
  streams: string[];
  day: (date: string) => { users: number; sessions: number; engaged: number };
  pages: { path: string; users: number; sessions: number; engaged: number }[];
  /** Users of the whole range (they do not add up by day). */
  users: number;
};

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): string[] => { const out: string[] = []; for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += DAY) out.push(iso(t)); return out; };
/** How many days `date` is before today (UTC). */
const age = (date: string) => Math.round((Date.parse(iso(Date.now()) + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / DAY);

/**
 * The rows of example-vn.com for one day. "cà phê sữa đá" climbs: position 4 in the newest days, 6 the week before,
 * 9 five weeks ago. "cold brew" is on two pages. "trà đá" slips from 8 to 10 in the newest week.
 */
export function vnRows(date: string): FakeGscRow[] {
  const a = age(date);
  const milk = a <= 9 ? 4 : a <= 16 ? 6 : a <= 30 ? 7 : 9, tea = a <= 9 ? 10 : 8;
  return [
    { date, page: 'https://example-vn.com/ca-phe-sua-da/', query: 'cà phê sữa đá', clicks: 6, impressions: 100, position: milk },
    { date, page: 'https://example-vn.com/cold-brew/', query: 'cold brew', clicks: 3, impressions: 60, position: 5 },
    { date, page: 'https://example-vn.com/', query: 'cold brew', clicks: 1, impressions: 20, position: 9 },
    { date, page: 'https://example-vn.com/tra-da/', query: 'trà đá', clicks: 2, impressions: 50, position: tea },
    { date, page: 'https://example-vn.com/', query: 'example vn', clicks: 1, impressions: 2, position: 1 },
  ];
}

function initial() {
  return {
    /** Access tokens the data APIs accept (the fake token endpoint issues acc-1, then acc-2 on renewal). */
    tokens: new Set(['acc-1', 'acc-2']),
    /** The token endpoint refuses a renewal with invalid_grant (the person removed Meridian's access). */
    refreshFails: false,
    gsc: {
      /** Rows per property and day. A property that is not here has no data yet. */
      rows: { 'sc-domain:example-vn.com': vnRows } as Record<string, (date: string) => FakeGscRow[]>,
      /** Clicks a day's total has beyond the rows by page and query (queries Google leaves out of the rows). */
      hidden: 5,
      /** Answer the next N row queries with "quota exceeded". */
      quota: 0,
      /** Answer the next N row queries with a 500. */
      fail: 0,
    },
    ga4: {
      properties: {
        'properties/1001': {
          name: 'Example VN', account: 'Meridian sites', streams: ['https://www.example-vn.com'], users: 900,
          day: (date: string) => { const n = Number(date.slice(-2)); return { users: 30 + n, sessions: 40 + n, engaged: 20 + n }; },
          pages: [
            { path: '/ca-phe-sua-da/', users: 400, sessions: 520, engaged: 300 }, { path: '/', users: 300, sessions: 380, engaged: 150 },
            { path: '/cold-brew/', users: 150, sessions: 170, engaged: 90 }, { path: '/tra-da/', users: 50, sessions: 60, engaged: 20 },
          ],
        },
        'properties/1002': { name: 'Old shop', account: 'Meridian sites', streams: ['https://shop.example.org'], users: 12, day: () => ({ users: 1, sessions: 1, engaged: 0 }), pages: [{ path: '/', users: 12, sessions: 14, engaged: 3 }] },
        'properties/2001': { name: 'App only', account: 'Second account', streams: [], users: 0, day: () => ({ users: 0, sessions: 0, engaged: 0 }), pages: [] },
      } as Record<string, FakeGa4>,
      /** Account summaries per page, to exercise pageToken. */
      adminPage: 200,
      /** The Admin API is turned off in the Google Cloud project. */
      adminOff: false,
      /** Properties whose reports answer "quota exhausted", and ones the account may not read. */
      quota: new Set<string>(), denied: new Set<string>(),
    },
  };
}
export let google = initial();
export function resetGoogle(): void { google = initial(); }

export const googleEnv = (u: (p: string) => string) => ({ MERIDIAN_URL_GA_ADMIN: u('ga-admin'), MERIDIAN_URL_GA_DATA: u('ga-data') });

const err = (code: number, status: string, message: string, reason?: string) => ({ error: { code, message, status, ...(reason ? { errors: [{ message, domain: 'usageLimits', reason }] } : {}) } });

/** Answers the request when it is a Google data call this fake knows. Returns false when it is not. */
export function googleRoute(req: IncomingMessage, res: ServerResponse, path: string, body: string, _hits: Hit[]): boolean {
  const send = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v)); return true; };
  const p = path.split('?')[0]!, query = new URLSearchParams(path.split('?')[1] ?? '');
  if (p === '/google-token/token' && google.refreshFails && new URLSearchParams(body).get('grant_type') === 'refresh_token')
    return send(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
  const gscQuery = p.startsWith('/gsc/webmasters/v3/sites/') && p.endsWith('/searchAnalytics/query');
  let dims: string[] = [], b: Record<string, unknown> = {};
  if (gscQuery) { try { b = JSON.parse(body) as Record<string, unknown>; } catch { /* answered below */ } dims = Array.isArray(b.dimensions) ? b.dimensions.map(String) : []; }
  /* The query without dimensions (a property's totals) is answered by fake-services.ts, as before. */
  if (!(gscQuery && dims.length) && !p.startsWith('/ga-admin/') && !p.startsWith('/ga-data/')) return false;
  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!google.tokens.has(token)) return send(401, err(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'));

  if (gscQuery) {
    const g = google.gsc;
    if (g.quota > 0) { g.quota--; return send(429, err(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for quota metric \'Queries\' and limit \'Queries per day\'.', 'quotaExceeded')); }
    if (g.fail > 0) { g.fail--; return send(500, err(500, 'INTERNAL', 'Internal error encountered.')); }
    const prop = decodeURIComponent(p.slice('/gsc/webmasters/v3/sites/'.length, -'/searchAnalytics/query'.length));
    const limit = Number(b.rowLimit ?? 1000), start = Number(b.startRow ?? 0);
    if (!(limit >= 1 && limit <= 25_000)) return send(400, err(400, 'INVALID_ARGUMENT', 'Invalid value at \'row_limit\': must be between 1 and 25000.'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.endDate)) || String(b.startDate) > String(b.endDate)) return send(400, err(400, 'INVALID_ARGUMENT', 'Invalid date range.'));
    if (new Set(dims).size !== dims.length || dims.some(d => !['date', 'page', 'query', 'country', 'device', 'searchAppearance'].includes(d))) return send(400, err(400, 'INVALID_ARGUMENT', 'Invalid dimensions.'));
    const gen = g.rows[prop];
    const all = gen ? daysBetween(String(b.startDate), String(b.endDate)).filter(d => age(d) >= 2).flatMap(gen) : [];
    let rows: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[];
    if (dims.includes('page') || dims.includes('query')) {
      rows = all.map(r => ({ keys: dims.map(d => d === 'date' ? r.date : d === 'page' ? r.page : r.query), clicks: r.clicks, impressions: r.impressions, ctr: r.clicks / r.impressions, position: r.position }));
    } else {
      /* By date alone: the property's totals of the day, which hold more than the rows by page and query add up to. */
      const byDate = new Map<string, FakeGscRow[]>();
      for (const r of all) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
      rows = [...byDate].map(([date, list]) => {
        const clicks = list.reduce((n, r) => n + r.clicks, 0) + g.hidden, impressions = list.reduce((n, r) => n + r.impressions, 0) + g.hidden * 10;
        return { keys: [date], clicks, impressions, ctr: clicks / impressions, position: list.reduce((n, r) => n + r.position * r.impressions, 0) / list.reduce((n, r) => n + r.impressions, 0) };
      });
    }
    const page = rows.slice(start, start + limit);
    return send(200, { ...(page.length ? { rows: page } : {}), responseAggregationType: dims.includes('page') ? 'byPage' : 'byProperty' });
  }

  const a = google.ga4;
  if (p === '/ga-admin/v1beta/accountSummaries') {
    if (a.adminOff) return send(403, err(403, 'PERMISSION_DENIED', 'Google Analytics Admin API has not been used in project 123 before or it is disabled.'));
    const accounts = [...new Set(Object.values(a.properties).map(x => x.account))];
    const from = Number(query.get('pageToken') ?? 0) || 0, size = Math.min(a.adminPage, Number(query.get('pageSize')) || 50);
    const page = accounts.slice(from, from + size);
    return send(200, {
      accountSummaries: page.map((name, i) => ({
        name: `accountSummaries/${from + i + 1}`, account: `accounts/${from + i + 1}`, displayName: name,
        propertySummaries: Object.entries(a.properties).filter(([, x]) => x.account === name).map(([id, x]) => ({ property: id, displayName: x.name, propertyType: 'PROPERTY_TYPE_ORDINARY', parent: `accounts/${from + i + 1}` })),
      })),
      ...(from + size < accounts.length ? { nextPageToken: String(from + size) } : {}),
    });
  }
  const streams = p.match(/^\/ga-admin\/v1beta\/(properties\/\d+)\/dataStreams$/);
  if (streams) {
    const prop = a.properties[streams[1]!];
    if (!prop) return send(404, err(404, 'NOT_FOUND', 'Property not found.'));
    return send(200, { dataStreams: prop.streams.map((uri, i) => ({ name: `${streams[1]}/dataStreams/${i + 1}`, type: 'WEB_DATA_STREAM', displayName: 'Web', webStreamData: { measurementId: 'G-FAKE' + i, defaultUri: uri } })) });
  }
  const report = p.match(/^\/ga-data\/v1beta\/(properties\/\d+):runReport$/);
  if (report && req.method === 'POST') {
    const id = report[1]!, prop = a.properties[id];
    if (a.quota.has(id)) return send(429, err(429, 'RESOURCE_EXHAUSTED', 'Exhausted property tokens for a project per hour. These quota tokens will return in under an hour.'));
    if (!prop || a.denied.has(id)) return send(403, err(403, 'PERMISSION_DENIED', 'User does not have sufficient permissions for this property.'));
    type Body = { dateRanges?: { startDate: string; endDate: string }[]; dimensions?: { name: string }[]; metrics?: { name: string }[]; limit?: number | string; offset?: number | string; metricAggregations?: string[] };
    let r: Body = {}; try { r = JSON.parse(body) as Body; } catch { /* refused below */ }
    const metrics = (r.metrics ?? []).map(m => m.name), dim = r.dimensions?.[0]?.name, range = r.dateRanges?.[0];
    if (!metrics.length || !range || (r.dimensions ?? []).length > 9) return send(400, err(400, 'INVALID_ARGUMENT', 'A report needs a date range and at least one metric.'));
    const val = (x: { users: number; sessions: number; engaged: number }) => metrics.map(m => ({ value: String(m === 'activeUsers' ? x.users : m === 'sessions' ? x.sessions : m === 'engagedSessions' ? x.engaged : 0) }));
    let rows: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] = [];
    if (dim === 'date') rows = daysBetween(range.startDate, range.endDate).map(d => ({ dimensionValues: [{ value: d.replaceAll('-', '') }], metricValues: val(prop.day(d)) }));
    else if (dim === 'pagePath') rows = [...prop.pages].sort((x, y) => y.sessions - x.sessions).map(x => ({ dimensionValues: [{ value: x.path }], metricValues: val(x) }));
    else return send(400, err(400, 'INVALID_ARGUMENT', `Field ${dim} is not a valid dimension.`));
    const limit = Number(r.limit ?? 10_000), offset = Number(r.offset ?? 0);
    const sessions = dim === 'date' ? daysBetween(range.startDate, range.endDate).reduce((n, d) => n + prop.day(d).sessions, 0) : prop.pages.reduce((n, x) => n + x.sessions, 0);
    const engaged = dim === 'date' ? daysBetween(range.startDate, range.endDate).reduce((n, d) => n + prop.day(d).engaged, 0) : prop.pages.reduce((n, x) => n + x.engaged, 0);
    return send(200, {
      dimensionHeaders: [{ name: dim }], metricHeaders: metrics.map(name => ({ name, type: 'TYPE_INTEGER' })),
      rows: rows.slice(offset, offset + limit), rowCount: rows.length,
      ...(r.metricAggregations?.includes('TOTAL') ? { totals: [{ dimensionValues: [{ value: 'RESERVED_TOTAL' }], metricValues: val({ users: prop.users, sessions, engaged }) }] } : {}),
      metadata: { currencyCode: 'USD', timeZone: 'Asia/Ho_Chi_Minh' }, kind: 'analyticsData#runReport',
    });
  }
  return send(404, err(404, 'NOT_FOUND', 'unknown fake Google route ' + p));
}

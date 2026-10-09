// SearchAPI.io is a different provider from SerpApi.com. Never send its key to SerpApi.
import { rowOf, usable, valuesOf } from './integrations.ts';
import { base, call, ServiceError } from './net.ts';
import { serpApiLocale } from './serpapi.ts';
import type { TestResult } from './connectors.ts';

export const searchApiReady = () => !!rowOf('searchapi') && usable('searchapi');
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
function refused(status: number): ServiceError {
  // Provider error text may contain credentials: never repeat it.
  if (status === 401) return new ServiceError('SearchAPI.io refused the API key. Copy the key from your SearchAPI.io dashboard.', status);
  if (status === 403) return new ServiceError('SearchAPI.io denied account access. Check key permissions and account verification in its dashboard.', status);
  if (status === 429 || status === 402) return new ServiceError('SearchAPI.io search quota or rate limit reached. Check your account quota.', 429);
  return new ServiceError('SearchAPI.io could not complete this request. Check the connection and query.', status);
}
/** Read quota through /me; this does not run a search. Return no account identity or secrets. */
export async function testSearchApi(v: Record<string, string>): Promise<TestResult> {
  const r = await call('SearchAPI.io', base('SEARCHAPI') + '/api/v1/me', { headers: { authorization: 'Bearer ' + (v.key ?? '') } });
  const data = object(r.data);
  if (r.status !== 200 || data.error) return { status: 'bad', msg: refused(r.status).message };
  const left = object(data.account).remaining_credits;
  if (typeof left !== 'number' || !Number.isFinite(left) || left < 0) return { status: 'bad', msg: 'SearchAPI.io returned no usable account quota. Check your account dashboard.' };
  return { status: left === 0 ? 'warn' : 'ok', msg: left === 0 ? 'Connected. No search credits remaining; research must wait.' : `Connected. ${Math.floor(left).toLocaleString('en-US')} search credits remaining. No search was run.` };
}
export async function searchApiSnapshot(site: { cc: string; country: string; lang: string }, keyword: string, signal: AbortSignal) {
  if (!searchApiReady()) throw new ServiceError('Connect SearchAPI.io in Integrations before SERP research.');
  signal.throwIfAborted();
  const key = valuesOf('searchapi')?.key ?? '';
  const url = new URL(base('SEARCHAPI') + '/api/v1/search');
  url.search = new URLSearchParams({ engine: 'google', q: keyword, ...serpApiLocale(site, 'SearchAPI.io'), device: 'desktop' }).toString();
  const r = await call('SearchAPI.io', url.toString(), { headers: { authorization: 'Bearer ' + key }, timeoutMs: 60_000, signal });
  signal.throwIfAborted();
  const data = object(r.data), metadata = object(data.search_metadata);
  if (r.status !== 200 || data.error || metadata.status !== 'Success') throw refused(r.status);
  if (!Array.isArray(data.organic_results)) throw new ServiceError('SearchAPI.io returned no organic result list. No rankings were inferred.');
  const clean = (v: unknown, max: number) => typeof v === 'string' ? (key ? v.split(key).join('[redacted]') : v).slice(0, max) : '';
  const safeUrl = (v: unknown) => {
    if (typeof v !== 'string' || v.length > 2000 || (key && (v.includes(key) || v.includes(encodeURIComponent(key))))) return '';
    try {
      const u = new URL(v);
      return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && ![...u.searchParams.keys()].some(k => /^(api_?key|token|access_token|authorization)$/i.test(k)) ? v : '';
    } catch { return ''; }
  };
  const items: { type: string; rank: number | null; url: string; title: string; description: string }[] = [];
  const add = (type: string, list: unknown[]) => {
    for (const value of list) {
      const x = object(value); if (!Object.keys(x).length) continue;
      const source = object(x.source);
      items.push({ type, rank: type === 'organic' && typeof x.position === 'number' && Number.isFinite(x.position) && x.position > 0 ? x.position : null,
        url: safeUrl(x.link ?? source.link), title: clean(x.title ?? x.question ?? x.query, 300), description: clean(x.snippet ?? x.answer ?? x.description, 1500) });
    }
  };
  add('organic', data.organic_results.slice(0, 10));
  for (const type of ['related_questions', 'related_searches']) if (Array.isArray(data[type])) add(type, data[type].slice(0, 6));
  for (const type of ['answer_box', 'knowledge_graph']) if (data[type]) add(type, [data[type]]);
  return { provider: 'searchapi' as const, at: Date.now(), providerTime: clean(metadata.created_at, 100), keyword, country: site.country, language: site.lang, device: 'desktop', cost: null,
    types: [...new Set(items.map(x => x.type))], items,
    coverage: 'One Google search page, at most 10 organic results and selected related questions/searches, answer box and knowledge graph. Organic position is within organic results, not an absolute position among all SERP features. Omitted features and full competitor pages were not inspected. Results may come from provider cache; monetary cost and keyword volume are not supplied by this snapshot.',
  };
}

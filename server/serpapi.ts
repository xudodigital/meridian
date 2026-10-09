// SerpApi Google results and quota checks. Keys and full provider responses never reach the dashboard or logs.
import { rowOf, usable, valuesOf } from './integrations.ts';
import { base, call, ServiceError } from './net.ts';
import type { TestResult } from './connectors.ts';

export const serpApiReady = () => !!rowOf('serpapi') && usable('serpapi');
const LANGUAGES: Record<string, string> = {
  english: 'en', malay: 'ms', vietnamese: 'vi', indonesian: 'id', thai: 'th', filipino: 'tl', tagalog: 'tl',
  bengali: 'bn', bangla: 'bn', urdu: 'ur', hindi: 'hi', portuguese: 'pt', spanish: 'es', arabic: 'ar', turkish: 'tr',
  french: 'fr', german: 'de', japanese: 'ja', korean: 'ko', chinese: 'zh-cn',
};
export function serpApiLocale(site: { cc: string; country: string; lang: string }, service = 'SerpApi') {
  const gl = site.cc.trim().toLowerCase();
  const hl = LANGUAGES[site.lang.trim().toLowerCase()];
  const location = site.country.trim() === 'Türkiye' ? 'Turkey' : site.country.trim();
  if (!/^[a-z]{2}$/.test(gl) || !location) throw new ServiceError(`Save the site country and country code before ${service} research.`);
  if (!hl) throw new ServiceError(`This site language is not mapped for ${service}. Update the language before running research; no language fallback was used.`);
  return { gl: gl === 'gb' ? 'uk' : gl, hl, location };
}
function refused(status: number, error: unknown): ServiceError {
  // Do not echo provider text: errors can repeat an API key or a request URL.
  if (status === 401 || status === 403) return new ServiceError('SerpApi refused the API key. Check it in Integrations.', status);
  if (status === 429 || status === 402 || (typeof error === 'string' && /limit|quota|credits|searches.*(?:left|exceeded|run out)/i.test(error)))
    return new ServiceError('SerpApi search quota or rate limit reached. Check your account quota and try again when available.', 429);
  return new ServiceError('SerpApi could not complete this request. Check the connection and query.', status);
}
/** Account API is free and does not consume a search. Only allow-listed quota fields are returned. */
export async function testSerpApi(v: Record<string, string>): Promise<TestResult> {
  const url = new URL(base('SERPAPI') + '/account.json'); url.searchParams.set('api_key', v.key ?? '');
  const r = await call<{ error?: string; account_status?: string; total_searches_left?: number; searches_per_month?: number }>('SerpApi', url.toString());
  if (!r.data || typeof r.data !== 'object') return { status: 'bad', msg: 'SerpApi returned an invalid account response.' };
  if (r.status !== 200 || r.data.error) {
    const e = refused(r.status, r.data.error); return { status: 'bad', msg: e.message };
  }
  if (r.data.account_status !== 'Active') return { status: 'bad', msg: 'SerpApi account is not active. Check your account dashboard.' };
  const left = r.data.total_searches_left;
  if (typeof left !== 'number' || !Number.isFinite(left) || left < 0) return { status: 'bad', msg: 'SerpApi returned no usable search quota. Check your account dashboard.' };
  return { status: left === 0 ? 'warn' : 'ok', msg: left === 0 ? 'Connected. No searches remaining; research must wait for available quota.' : `Connected. ${Math.floor(left).toLocaleString('en-US')} searches remaining. Testing uses no search credits.` };
}
type Result = { position?: number; title?: string; link?: string; snippet?: string; question?: string };
type Answer = {
  error?: string; search_metadata?: { status?: string; id?: string; created_at?: string };
  organic_results?: Result[]; related_questions?: Result[]; related_searches?: Result[];
  answer_box?: Result; knowledge_graph?: Result;
};
const safeUrl = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 2000) return '';
  try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.searchParams.has('api_key') ? v : ''; } catch { return ''; }
};
export async function serpApiSnapshot(site: { cc: string; country: string; lang: string }, keyword: string, signal: AbortSignal) {
  if (!serpApiReady()) throw new ServiceError('Connect SerpApi in Integrations before SERP research.');
  signal.throwIfAborted();
  const locale = serpApiLocale(site);
  const url = new URL(base('SERPAPI') + '/search.json');
  url.search = new URLSearchParams({ engine: 'google', q: keyword, ...locale, device: 'desktop', api_key: valuesOf('serpapi')?.key ?? '' }).toString();
  const r = await call<Answer>('SerpApi', url.toString(), { timeoutMs: 60_000, signal });
  signal.throwIfAborted();
  if (!r.data || typeof r.data !== 'object') throw new ServiceError('SerpApi returned an invalid search response.');
  if (r.status !== 200 || r.data.error || r.data.search_metadata?.status !== 'Success') throw refused(r.status, r.data.error);
  if (!Array.isArray(r.data.organic_results)) throw new ServiceError('SerpApi returned no organic result list. No rankings were inferred.');
  const items: { type: string; rank: number | null; url: string; title: string; description: string }[] = [];
  const add = (type: string, list: Result[]) => { for (const x of list) if (x && typeof x === 'object') items.push({ type, rank: type === 'organic' && typeof x.position === 'number' && Number.isFinite(x.position) ? x.position : null, url: safeUrl(x.link), title: String(x.title ?? x.question ?? '').slice(0, 300), description: String(x.snippet ?? '').slice(0, 1500) }); };
  add('organic', r.data.organic_results.slice(0, 10));
  if (Array.isArray(r.data.related_questions)) add('related_questions', r.data.related_questions.slice(0, 6));
  if (Array.isArray(r.data.related_searches)) add('related_searches', r.data.related_searches.slice(0, 6));
  if (r.data.answer_box) add('answer_box', [r.data.answer_box]);
  if (r.data.knowledge_graph) add('knowledge_graph', [r.data.knowledge_graph]);
  return { provider: 'serpapi' as const, at: Date.now(), providerTime: String(r.data.search_metadata.created_at ?? '').slice(0, 100), keyword, country: site.country, language: site.lang, device: 'desktop', cost: null,
    types: [...new Set(items.map(x => x.type))], items,
    coverage: 'One Google search page, at most 10 organic results and selected related questions/searches, answer box and knowledge graph. Organic position is within organic results, not an absolute position among all SERP features. Omitted features and full competitor pages were not inspected. Results may come from provider cache; monetary cost is not supplied by this API.',
  };
}

// Fake DataForSEO for the server tests: the account call behind "Test connection" and the Google Ads search volume
// endpoint (live), answering in the real envelope (status_code 20000, one task with its own status, cost and result).
// It is strict where the real one is: Basic auth, exactly one task per call, at most 1,000 keywords of at most 80
// characters, a location, and keywords come back in lower case. `dfs` holds the data and the switches.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hit } from './fake-services.ts';

export const DFS_LOGIN = 'seo@example.com', DFS_PASSWORD = 'dfs-api-password-1';

function initial() {
  return {
    balance: 12.5,
    /** What one search volume request costs. */
    cost: 0.075,
    /** Monthly searches and competition per keyword (lower case). A keyword that is not here has no data. */
    volumes: new Map<string, { volume: number; competition: 'LOW' | 'MEDIUM' | 'HIGH' }>([
      ['cà phê sữa đá', { volume: 12100, competition: 'LOW' }], ['cold brew', { volume: 2400, competition: 'MEDIUM' }], ['trà đá', { volume: 880, competition: 'LOW' }],
    ]),
    /** 'rate': too many requests; 'broke': the balance is used up; 'no-language': the language name is not known. */
    mode: 'ok' as 'ok' | 'rate' | 'broke' | 'no-language',
    /** The tasks received, as sent. */
    tasks: [] as Record<string, unknown>[],
  };
}
export let dfs = initial();
export function resetDataforseo(): void { dfs = initial(); }
export const dataforseoEnv = (u: (p: string) => string) => ({ MERIDIAN_URL_DATAFORSEO: u('dataforseo') });

const envelope = (status_code: number, status_message: string, cost: number, tasks: unknown[]) =>
  ({ version: '0.1.20260101', status_code, status_message, time: '0.1 sec.', cost, tasks_count: tasks.length, tasks_error: tasks.filter(t => (t as { status_code: number }).status_code !== 20000).length, tasks });

export function dataforseoRoute(req: IncomingMessage, res: ServerResponse, path: string, body: string, _hits: Hit[]): boolean {
  const p = path.split('?')[0]!;
  if (!p.startsWith('/dataforseo/')) return false;
  const send = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v)); return true; };
  const ok = req.headers.authorization === 'Basic ' + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  if (!ok) return send(401, envelope(40100, 'You are not authorized to access this resource.', 0, []));
  if (p === '/dataforseo/v3/appendix/user_data') return send(200, envelope(20000, 'Ok.', 0, [{ id: 'u1', status_code: 20000, status_message: 'Ok.', cost: 0, result: [{ login: DFS_LOGIN, money: { total: 50, balance: dfs.balance } }] }]));
  if (p === '/dataforseo/v3/keywords_data/google_ads/search_volume/live' && req.method === 'POST') {
    let tasks: unknown; try { tasks = JSON.parse(body); } catch { tasks = null; }
    if (!Array.isArray(tasks) || tasks.length !== 1) return send(200, envelope(40000, 'You can set only one task at a time.', 0, []));
    const t = tasks[0] as { keywords?: unknown; location_code?: unknown; location_name?: unknown; language_name?: unknown; language_code?: unknown };
    dfs.tasks.push(t as Record<string, unknown>);
    const task = (status_code: number, status_message: string, cost: number, result: unknown[] | null) =>
      ({ id: '01011200-0001-0367-0000-' + String(dfs.tasks.length).padStart(12, '0'), status_code, status_message, time: '0.1 sec.', cost, result_count: result?.length ?? 0, path: ['v3', 'keywords_data', 'google_ads', 'search_volume', 'live'], data: { api: 'keywords_data', function: 'search_volume', se: 'google_ads', ...t }, result });
    if (dfs.mode === 'rate') return send(200, envelope(20000, 'Ok.', 0, [task(40202, 'Rate limit per minute exceeded.', 0, null)]));
    if (dfs.mode === 'broke') return send(402, envelope(40200, 'Payment Required.', 0, []));
    const kws = Array.isArray(t.keywords) ? t.keywords.map(String) : [];
    if (!kws.length || kws.length > 1000 || kws.some(k => k.length > 80 || k.trim().split(/\s+/).length > 10)) return send(200, envelope(20000, 'Ok.', 0, [task(40501, 'Invalid Field: \'keywords\'.', 0, null)]));
    if (typeof t.location_code !== 'number' && typeof t.location_name !== 'string') return send(200, envelope(20000, 'Ok.', 0, [task(40501, 'Invalid Field: \'location_name\'.', 0, null)]));
    if (dfs.mode === 'no-language' && t.language_name !== undefined) return send(200, envelope(20000, 'Ok.', 0, [task(40501, 'Invalid Field: \'language_name\'.', 0, null)]));
    const result = kws.map(k => {
      const key = k.toLowerCase(), v = dfs.volumes.get(key);
      return {
        keyword: key, spell: null, location_code: typeof t.location_code === 'number' ? t.location_code : null, language_code: null, search_partners: false,
        competition: v?.competition ?? null, competition_index: v ? (v.competition === 'LOW' ? 12 : v.competition === 'MEDIUM' ? 50 : 88) : null,
        search_volume: v?.volume ?? null, low_top_of_page_bid: v ? 0.1 : null, high_top_of_page_bid: v ? 0.6 : null, cpc: v ? 0.3 : null,
        monthly_searches: v ? [{ year: 2026, month: 9, search_volume: v.volume }] : null,
      };
    });
    dfs.balance -= dfs.cost;
    return send(200, envelope(20000, 'Ok.', dfs.cost, [task(20000, 'Ok.', dfs.cost, result)]));
  }
  return send(404, envelope(40400, 'Not Found.', 0, []));
}

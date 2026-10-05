/* A stand-in for the Meridian server in app tests: replaces fetch with routes that answer JSON, and records every
   call (method, path, parsed body, headers). Not a test file itself. Install with vi.stubGlobal('fetch', api.fetch). */

export interface ApiCall { method: string; path: string; body: unknown; headers: Record<string, string> }
export interface ApiAnswer { status?: number; body: unknown }
/** A route answers with a body (status 200) or with { status, body }. */
export type RouteFn = (call: ApiCall, match: RegExpMatchArray) => unknown;
type Route = { method: string; path: string | RegExp; fn: RouteFn };

const isAnswer = (v: unknown): v is ApiAnswer => !!v && typeof v === 'object' && 'body' in v && ('status' in v);
export const answer = (status: number, body: unknown): ApiAnswer => ({ status, body });

export class FakeApi {
  routes: Route[] = [];
  calls: ApiCall[] = [];

  on(method: string, path: string | RegExp, fn: RouteFn): this { this.routes.unshift({ method, path, fn }); return this; }
  /** The calls to one path (and method). */
  to(method: string, path: string): ApiCall[] { return this.calls.filter(c => c.method === method && c.path === path); }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    let body: unknown = undefined;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    const call: ApiCall = { method, path, body, headers };
    this.calls.push(call);
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = typeof r.path === 'string' ? (r.path === path ? [path] as RegExpMatchArray : null) : path.match(r.path);
      if (!m) continue;
      const out = r.fn(call, m);
      const a = isAnswer(out) ? out : { status: 200, body: out };
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
}

/** An empty workspace as GET /api/workspace answers on a new install. */
export const emptyWorkspace = () => ({
  docs: Object.fromEntries(['sites', 'agents', 'skills', 'settings', 'schedules', 'reviewModes', 'notifyPrefs'].map(id => [id, { version: 0, data: null }])),
  audit: [] as unknown[],
  notifRead: [] as string[],
});

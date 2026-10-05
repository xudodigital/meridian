// Outgoing HTTP calls to the services Meridian connects to. Every call has a time limit, and every base URL can be
// pointed elsewhere with an environment variable (MERIDIAN_URL_<NAME>), which the tests use for a local fake service.
// Nothing here logs a request: URLs and headers may hold keys.
import { VERSION } from './version.ts';

export const BASES = {
  OPENAI: 'https://api.openai.com',
  DATAFORSEO: 'https://api.dataforseo.com',
  CLOUDFLARE: 'https://api.cloudflare.com',
  GLOBALPING: 'https://api.globalping.io',
  TELEGRAM: 'https://api.telegram.org',
  GOOGLE_AUTH: 'https://accounts.google.com',
  GOOGLE_TOKEN: 'https://oauth2.googleapis.com',
  GOOGLE_APIS: 'https://www.googleapis.com',
  SEARCH_CONSOLE: 'https://searchconsole.googleapis.com',
  GA_ADMIN: 'https://analyticsadmin.googleapis.com',
  GA_DATA: 'https://analyticsdata.googleapis.com',
  /** Wikimedia Commons: its Action API is at <base>/w/api.php (commons.ts). */
  COMMONS: 'https://commons.wikimedia.org',
} as const;
export type BaseName = keyof typeof BASES;

export const base = (name: BaseName): string => (process.env['MERIDIAN_URL_' + name] || BASES[name]).replace(/\/+$/, '');

/**
 * The hosts photo files may be downloaded from: Wikimedia's media servers, or the comma-separated host[:port] list in
 * MERIDIAN_MEDIA_HOSTS (the tests' fake). Lower case.
 */
export const mediaHosts = (): string[] =>
  (process.env.MERIDIAN_MEDIA_HOSTS || 'upload.wikimedia.org,thumb.wikimedia.org').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);

/** A service answered with an error, or could not be reached. `message` is fit to show a person. */
export class ServiceError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}

export type CallInit = { method?: string; headers?: Record<string, string>; body?: unknown; form?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal };

/**
 * Calls a service and returns its JSON answer (or {} for an empty body). A network failure or timeout becomes a
 * ServiceError that names the service; an HTTP error is returned to `onError`, or becomes a ServiceError with its status.
 */
export async function call<T = Record<string, unknown>>(service: string, url: string, init: CallInit = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'Meridian/' + VERSION, ...init.headers };
  let body: string | undefined;
  if (init.form) { body = new URLSearchParams(init.form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
  else if (init.body !== undefined) { body = JSON.stringify(init.body); headers['content-type'] = 'application/json'; }
  let res: Response;
  try {
    res = await fetch(url, { method: init.method || (body ? 'POST' : 'GET'), headers, body, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(init.timeoutMs ?? 20_000)]) : AbortSignal.timeout(init.timeoutMs ?? 20_000), redirect: 'error' });
  } catch (e) {
    const name = (e as Error).name;
    throw new ServiceError(name === 'TimeoutError' || name === 'AbortError' ? `${service} did not answer in time.` : `Could not reach ${service}. Check the internet connection.`);
  }
  const textBody = await res.text().catch(() => '');
  let data: unknown = {};
  if (textBody) { try { data = JSON.parse(textBody); } catch { data = { text: textBody.slice(0, 500) }; } }
  return { status: res.status, data: data as T };
}

/** The error message inside a service's JSON answer, if it has one in a usual place. */
export function errorText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const e = d.error;
  if (typeof e === 'string') return d.error_description && typeof d.error_description === 'string' ? d.error_description : e;
  if (e && typeof e === 'object') { const m = (e as Record<string, unknown>).message; if (typeof m === 'string') return m; }
  if (Array.isArray(d.errors) && d.errors[0] && typeof d.errors[0] === 'object') { const m = (d.errors[0] as Record<string, unknown>).message; if (typeof m === 'string') return m; }
  for (const k of ['message', 'description', 'status_message']) if (typeof d[k] === 'string') return d[k] as string;
  return '';
}

/** One line, at most `max` characters, for showing a service's own error text. */
export const short = (s: string, max = 160): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };

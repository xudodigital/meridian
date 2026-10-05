/* HTTP calls to the Meridian server. Nothing here touches the store, so the store, its slices, live.ts and sync.ts can
   all use it. The session is an HttpOnly cookie the browser sends by itself; writes carry the header the server
   requires (x-meridian), so another website cannot make them. An answer saying the session has ended is passed to
   the handler the store registers (setAuthHandlers), which signs the person out of the page. */
import type { ArticleEditBody, BulkArticleResult, NewArticleBody, ServerArticle } from './types';

/** A refusal from the server, with its status and message (and `code`, for example "enroll"). */
export class ApiError extends Error {
  status: number;
  code: string;
  /** The rest of the answer, for example the current document of a 409. */
  data: Record<string, unknown>;
  constructor(status: number, message: string, code = '', data: Record<string, unknown> = {}) { super(message); this.status = status; this.code = code; this.data = data; }
}

type Handlers = { ended: () => void; enroll: () => void };
let handlers: Handlers = { ended: () => {}, enroll: () => {} };
/** The store tells the API layer what to do when the session ended (401) or 2-step setup is required (403 "enroll"). */
export function setAuthHandlers(h: Handlers): void { handlers = h; }

/** Paths whose 401 is an answer to the form (a wrong password), not an ended session. */
const AUTH_FORMS = /^\/api\/(auth\/(sign-in|setup|status|password|2fa\/disable)|invites\/)/;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(method === 'GET' ? {} : { 'x-meridian': '1' }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ApiError(0, 'The Meridian server is not available. Start it with ./start.sh.'); }
  const json = (r.headers.get('content-type') || '').includes('application/json');
  const d = (json ? await r.json().catch(() => ({})) : {}) as Record<string, unknown>;
  if (!r.ok) {
    const err = new ApiError(r.status, typeof d.error === 'string' ? d.error : json ? 'The server refused the request.' : 'The Meridian server is not available. Start it with ./start.sh.', typeof d.code === 'string' ? d.code : '', d);
    if (r.status === 401 && !AUTH_FORMS.test(path)) handlers.ended();
    if (r.status === 403 && err.code === 'enroll') handlers.enroll();
    throw err;
  }
  if (!json) throw new ApiError(r.status, 'The Meridian server is not available. Start it with ./start.sh.');
  return d as T;
}

export const apiGet = <T>(path: string): Promise<T> => call<T>('GET', path);
/** POST (or another method) with the write header. Rejects with the server's own message. */
export const apiSend = <T>(path: string, body: unknown = {}, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST'): Promise<T> => call<T>(method, path, body);

const act = (aid: number, action: string, body: Record<string, string> = {}) =>
  apiSend<{ article: ServerArticle }>(`/api/articles/${aid}/${action}`, body).then(r => r.article);

/** The article endpoints. Each resolves to the article as the server now has it. Who acted comes from the session. */
export const articleApi = {
  create: (body: NewArticleBody) => apiSend<{ article: ServerArticle }>('/api/articles', body).then(r => r.article),
  approve: (aid: number) => act(aid, 'approve'),
  revise: (aid: number, note: string) => act(aid, 'revise', { note }),
  reject: (aid: number) => act(aid, 'reject'),
  languageReview: (aid: number) => act(aid, 'language-review'),
  retry: (aid: number) => act(aid, 'retry'),
  /** Saves a person's edit of an article waiting for review. Refused with 409 when the text changed meanwhile. */
  edit: (aid: number, body: ArticleEditBody) => apiSend<{ article: ServerArticle }>(`/api/articles/${aid}/content`, body, 'PATCH').then(r => r.article),
  /** Sends an approved article back to review. */
  unapprove: (aid: number) => act(aid, 'unapprove'),
  archive: (aid: number) => act(aid, 'archive'),
  unarchive: (aid: number) => act(aid, 'unarchive'),
  /** One article per keyword of a finished research request (at most 10): what happened to each. */
  bulk: (body: { requestId: number; keywords: string[]; model: string }) => apiSend<{ results: BulkArticleResult[]; created: number }>('/api/articles/bulk', body),
};

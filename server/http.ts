// Small HTTP helpers shared by the API routes.
import type { IncomingMessage, ServerResponse } from 'node:http';

/** On every API answer: it is data, so a browser must never run, load or frame anything from it. */
export const API_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
} as const;

export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...API_HEADERS });
  res.end(JSON.stringify(body));
}

/** A request the client got wrong; answered with its status and message. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** The JSON object in the request body, or an empty object. At most `max` bytes (20,000 unless a route allows more). */
export async function body(req: IncomingMessage, max = 20_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    /* Too large: the rest is read and dropped (up to a limit), so the client gets the answer instead of a reset. */
    if (size > max) { if (size > max * 4 + 5_000_000) req.destroy(); continue; }
    chunks.push(chunk as Buffer);
  }
  if (size > max) throw new HttpError(413, 'Request body is too large.');
  /* Joined before decoding, so a character split across two chunks stays whole. */
  const str = Buffer.concat(chunks).toString('utf8');
  if (!str) return {};
  let v: unknown;
  try { v = JSON.parse(str); } catch { throw new HttpError(400, 'The request body is not valid JSON.'); }
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d{1,5})?$/;
/** The Host header names this computer. Anything else (for example a DNS-rebinding page) gets nothing from the API. */
export const localHost = (req: IncomingMessage): boolean => LOCAL_HOST.test(req.headers.host || '');

/** Writes are accepted only from this dashboard: same host, and our own header (which other websites cannot send without CORS approval). */
export function trustedWrite(req: IncomingMessage): boolean {
  if (req.headers['x-meridian'] !== '1') return false;
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; } }
  return localHost(req);
}

/** Who is asking, for slowing down repeated failed sign-ins: the socket's address (on this computer, the same for everyone). */
export const clientKey = (req: IncomingMessage): string => req.socket.remoteAddress || 'unknown';

/** One line of text from the client: whitespace collapsed, at most `max` characters. */
export const text = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** A multi-line note from the client: line breaks kept, other whitespace runs collapsed, at most `max` characters. */
export const note = (v: unknown, max: number) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
/** A string from the client as typed (a password): not trimmed, not collapsed. '' for anything that is not a string. */
export const raw = (v: unknown): string => typeof v === 'string' ? v : '';

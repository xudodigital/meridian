// Sign-in sessions: a random 32-byte token in an HttpOnly cookie; the database keeps only its SHA-256.
// A session ends after the idle time chosen in Settings (counted from the last request), after 30 days at most,
// at sign-out, or when the person or an admin ends it.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from './db.ts';
import { randomToken, sha256 } from './secrets.ts';
import { idleMs } from './workspace.ts';

export const COOKIE = 'meridian_session';
export const MAX_AGE_MS = 30 * 864e5;
/** last_seen is written at most this often per session, so reads do not turn into writes. */
const TOUCH_MS = 10_000;

export type SessionRow = { id: number; token_hash: string; user_id: number; created_at: number; last_seen: number; expires_at: number; user_agent: string };

const qs = {
  insert: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)'),
  byHash: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
  byId: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  forUser: db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen DESC'),
  touch: db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM sessions WHERE id = ?'),
  removeForUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  removeOthers: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?'),
  removeOne: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?'),
  sweep: db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen <= ?'),
};

/** Creates a session and returns the token for the cookie. The token is not stored. */
export function createSession(userId: number, userAgent: string): { token: string; row: SessionRow } {
  const token = randomToken(), now = Date.now();
  const info = qs.insert.run(sha256(token), userId, now, now, now + MAX_AGE_MS, userAgent.slice(0, 300));
  return { token, row: qs.byId.get(Number(info.lastInsertRowid)) as SessionRow };
}

/** Still valid: not past its 30 days and used within the idle time. */
export const sessionLive = (s: SessionRow, now = Date.now()): boolean => s.expires_at > now && now - s.last_seen <= idleMs();

/** The live session for a token, or null. An ended one is deleted. Touches last_seen unless `touch` is false. */
export function sessionByToken(token: string, touch = true): SessionRow | null {
  if (!token) return null;
  const s = qs.byHash.get(sha256(token)) as SessionRow | undefined;
  if (!s) return null;
  const now = Date.now();
  if (!sessionLive(s, now)) { qs.remove.run(s.id); return null; }
  if (touch && now - s.last_seen >= TOUCH_MS) { qs.touch.run(now, s.id); s.last_seen = now; }
  return s;
}
/** The session by id if it is still live (for the event stream, which checks before every event). */
export function liveSessionById(id: number): SessionRow | null {
  const s = qs.byId.get(id) as SessionRow | undefined;
  if (!s) return null;
  if (!sessionLive(s)) { qs.remove.run(s.id); return null; }
  return s;
}
/** Marks the session as used now ("touch" from an active browser). */
export const touchSession = (s: SessionRow) => { const now = Date.now(); qs.touch.run(now, s.id); s.last_seen = now; };

export const sessionsOf = (userId: number): SessionRow[] => (qs.forUser.all(userId) as SessionRow[]).filter(s => sessionLive(s));
export const endSession = (id: number) => qs.remove.run(id);
export const endSessionOf = (userId: number, id: number): boolean => Number(qs.removeOne.run(userId, id).changes) > 0;
export const endAllSessions = (userId: number) => qs.removeForUser.run(userId);
export const endOtherSessions = (userId: number, keep: number): number => Number(qs.removeOthers.run(userId, keep).changes);
/** Removes sessions that have ended, at start-up and now and then. */
export const sweepSessions = () => qs.sweep.run(Date.now(), Date.now() - idleMs());

/* ---------- Cookie ---------- */

/** The session token in the request's Cookie header, or ''. */
export function tokenFrom(req: IncomingMessage): string {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      const v = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{20,100}$/.test(v) ? v : '';
    }
  }
  return '';
}
/** HttpOnly, SameSite=Strict, Path=/. Not Secure: Meridian is served over http://localhost. */
export function setSessionCookie(res: ServerResponse, token: string) {
  res.setHeader('set-cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_MS / 1000}`);
}
export function clearSessionCookie(res: ServerResponse) {
  res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

/** "Chrome on macOS" from a user agent. Only for showing the person their own sessions. */
export function deviceOf(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl\//.test(ua) ? 'curl' : /node|undici/i.test(ua) ? 'Script' : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

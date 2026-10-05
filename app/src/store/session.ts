/* Who is signed in: the person the server says (GET /api/auth/me), their name as every audit-log entry and article
   history records it, and the checks the sign-in forms run before asking the server. Pure helpers: no store, DOM,
   storage or network access. The session itself is an HttpOnly cookie the page never sees. */
import type { AppState, AuthSession, Me } from './types';

/** The longest name a person can give themselves. */
export const NAME_MAX = 60;
/** Password length the server accepts (server/secrets.ts). */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

/** A name as typed, with surrounding and repeated whitespace removed. */
export const cleanName = (v: string): string => v.replace(/\s+/g, ' ').trim();

/** Why a typed name cannot be used, or '' when it can. */
export function nameError(v: string): string {
  const n = cleanName(v);
  if (!n) return 'Enter your name, for example Dewi Lestari.';
  if (n.length > NAME_MAX) return `Enter a name of at most ${NAME_MAX} characters.`;
  return '';
}

/** Why a new password cannot be used, or '' when it can. The same rule as the server's. */
export function passwordError(pw: string, confirm?: string): string {
  if (pw.length < PASSWORD_MIN) return `Use a password of at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Use a password of at most ${PASSWORD_MAX} characters.`;
  if (confirm !== undefined && pw !== confirm) return 'The two passwords are not the same.';
  return '';
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const emailError = (v: string): string => EMAIL.test(v.trim()) ? '' : 'Enter a valid email address.';

/** The name recorded for something the signed-in person did. The server records the same name from the session. */
export const actor = (s: Pick<AppState, 'session'>): string => s.session?.name.trim() || 'Unknown';

/** The store's session from the server's answer. */
export const sessionOf = (me: Me): AuthSession =>
  ({ id: me.id, email: me.email, role: me.role, name: me.name, site: me.site, twofa: me.twofa, enroll: me.mustEnroll });

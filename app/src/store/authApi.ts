/* The account and team endpoints of the server (server/auth-api.ts, server/team-api.ts, server/reset.ts). No store
   access: the store and the screens call these and put the answers where they belong. */
import { apiGet, apiSend } from './serverApi';
import type { Me, Role } from './types';

/** `resetByEmail`: the server can email a link for a forgotten password (Email (SMTP) is set up and works). */
export interface Status { setup: boolean; me: Me | null; resetByEmail?: boolean }
/** Step one of a sign-in: signed in, or 2-step verification wants a code (the ticket names this sign-in attempt). */
export type SignInStep = { me: Me } | { twofa: true; ticket: string };
export interface ServerSession { id: string; device: string; created: number; lastSeen: number; current: boolean }
export interface ServerUser { id: string; name: string; email: string; role: Role; site: string | null; created: number; disabled: boolean; twofa: boolean }
export interface ServerInvite { id: string; email: string; role: Role; site: string | null; created: number; expires: number }
export interface InviteInfo { email: string; role: Role; site: string | null; domain: string | null; expires: number }
/** Who a password reset link is for, and until when it works. */
export interface ResetInfo { email: string; expires: number }
/** A reset link an admin made for someone: shown once. */
export interface ResetLink { link: string; expires: number; minutes: number }
/** A signed-in browser of anyone on the team, as an admin sees it (GET /api/sessions). */
export interface TeamSession { id: string; userId: string; device: string; created: number; lastSeen: number; current: boolean }

const meOf = (r: { me: Me }) => r.me;

export const authApi = {
  status: () => apiGet<Status>('/api/auth/status'),
  setup: (b: { name: string; email: string; password: string; confirm: string }) => apiSend<{ me: Me }>('/api/auth/setup', b).then(meOf),
  signIn: (b: { email: string; password: string }) => apiSend<SignInStep>('/api/auth/sign-in', b),
  code: (ticket: string, code: string) => apiSend<{ me: Me }>('/api/auth/sign-in/code', { ticket, code }).then(meOf),
  signOut: () => apiSend<{ ok: true }>('/api/auth/sign-out'),
  touch: () => apiSend<{ ok: true }>('/api/auth/touch'),
  me: () => apiGet<{ me: Me }>('/api/auth/me').then(meOf),
  rename: (name: string) => apiSend<{ me: Me }>('/api/auth/me', { name }, 'PATCH').then(meOf),
  password: (current: string, next: string, confirm: string) => apiSend<{ ok: true; endedSessions: number }>('/api/auth/password', { current, next, confirm }),
  twofaSetup: () => apiSend<{ secret: string; uri: string }>('/api/auth/2fa/setup'),
  twofaEnable: (code: string) => apiSend<{ me: Me; recoveryCodes: string[] }>('/api/auth/2fa/enable', { code }),
  twofaDisable: (password: string) => apiSend<{ me: Me }>('/api/auth/2fa/disable', { password }).then(meOf),
  sessions: () => apiGet<{ sessions: ServerSession[] }>('/api/auth/sessions').then(r => r.sessions),
  endSession: (id: string) => apiSend<{ ok: true }>('/api/auth/sessions/' + encodeURIComponent(id), {}, 'DELETE'),
  endOthers: () => apiSend<{ ended: number }>('/api/auth/sessions/sign-out-others'),
  /** Asks for a reset link by email. The answer is the same whether the email has an account or not. */
  resetRequest: (email: string) => apiSend<{ ok: true; message: string }>('/api/auth/reset/request', { email }),
  resetLookup: (token: string) => apiGet<{ reset: ResetInfo }>('/api/auth/reset/' + encodeURIComponent(token)).then(r => r.reset),
  resetPassword: (token: string, b: { password: string; confirm: string }) => apiSend<{ ok: true; email: string }>('/api/auth/reset/' + encodeURIComponent(token), b),
};

export const teamApi = {
  list: () => apiGet<{ users: ServerUser[]; invites: ServerInvite[] }>('/api/users'),
  invite: (b: { email: string; role: Role; site?: string }) => apiSend<{ invite: ServerInvite; link: string }>('/api/invites', b),
  revoke: (id: string) => apiSend<{ ok: true }>('/api/invites/' + encodeURIComponent(id), {}, 'DELETE'),
  update: (id: string, b: { role?: Role; site?: string | null; disabled?: boolean }) => apiSend<{ user: ServerUser }>('/api/users/' + encodeURIComponent(id), b, 'PATCH'),
  remove: (id: string) => apiSend<{ ok: true }>('/api/users/' + encodeURIComponent(id), {}, 'DELETE'),
  resetTwofa: (id: string) => apiSend<{ user: ServerUser }>(`/api/users/${encodeURIComponent(id)}/reset-2fa`),
  resetLink: (id: string) => apiSend<ResetLink>(`/api/users/${encodeURIComponent(id)}/reset-link`),
  sessions: () => apiGet<{ sessions: TeamSession[] }>('/api/sessions').then(r => r.sessions),
  endSession: (id: string) => apiSend<{ ok: true }>('/api/sessions/' + encodeURIComponent(id), {}, 'DELETE'),
  signOutEverywhere: (id: string) => apiSend<{ ended: number }>(`/api/users/${encodeURIComponent(id)}/sign-out`),
  lookup: (token: string) => apiGet<{ invite: InviteInfo }>('/api/invites/' + encodeURIComponent(token)).then(r => r.invite),
  accept: (token: string, b: { name: string; password: string; confirm: string }) => apiSend<{ me: Me }>(`/api/invites/${encodeURIComponent(token)}/accept`, b).then(meOf),
};

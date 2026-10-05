// Who is asking (the session in the cookie) and what their role may do. The rules mirror the app's
// (app/src/store/rules.ts canSee and the store's guard): admin everything; editor everything except Team,
// Integrations, Settings and audit administration; native reviewer only Article review for their own site;
// viewer read-only.
import type { IncomingMessage } from 'node:http';
import { sessionByToken, tokenFrom, type SessionRow } from './sessions.ts';
import { userById, type Role, type UserRow } from './users.ts';
import { ADMIN_DOCS, twofaRequired, type DocId } from './workspace.ts';

export type Ctx = { user: UserRow; session: SessionRow };
/** The person recorded for something done in this request. */
export const actorOf = (c: Ctx) => ({ name: c.user.name, id: c.user.id });

/** The signed-in person, or null. A disabled account has no access, even with a session left over. */
export function authenticate(req: IncomingMessage, touch = true): Ctx | null {
  const session = sessionByToken(tokenFrom(req), touch);
  if (!session) return null;
  const user = userById(session.user_id);
  return user && !user.disabled ? { user, session } : null;
}

/** 2-step verification is required in Settings and this person has not set it up: only the account routes are open. */
export const mustEnroll = (u: UserRow): boolean => twofaRequired() && !u.totp_secret;

/** An answer refusing an action: status and message. */
export type Denial = { status: 403; error: string };
const VIEW_ONLY = 'View-only role. Ask an admin to make changes.';
const REVIEW_ONLY = 'Your role reviews articles only.';
const ADMIN_ONLY = 'Only an admin can do this.';
const deny = (error: string): Denial => ({ status: 403, error });

const writer = (r: Role): boolean => r === 'admin' || r === 'editor';
const refusal = (r: Role): Denial => deny(r === 'viewer' ? VIEW_ONLY : r === 'reviewer' ? REVIEW_ONLY : ADMIN_ONLY);

/** Changing work: research, articles, the workspace documents an editor may change. */
export const mayWrite = (u: UserRow): Denial | null => writer(u.role) ? null : refusal(u.role);
/** Admin-only: Team and roles, Settings, resetting the workspace. */
export const mayAdmin = (u: UserRow): Denial | null => u.role === 'admin' ? null : refusal(u.role);
/** The two things a native reviewer may do (language review, request a revision), on their own site only. */
export const mayReview = (u: UserRow, site: string): Denial | null =>
  writer(u.role) || (u.role === 'reviewer' && !!u.site && u.site === site) ? null : refusal(u.role);
/** A workspace document: Settings and alert preferences are admin-only, the rest is for editors too. */
export const mayWriteDoc = (u: UserRow, id: DocId): Denial | null => ADMIN_DOCS.includes(id) ? mayAdmin(u) : mayWrite(u);

/** Things that belong to a site: a native reviewer sees their own site only. */
export const seesSite = (u: UserRow, site: string): boolean => u.role !== 'reviewer' || (!!u.site && u.site === site);
/** The audit log is a screen reviewers cannot open. */
export const seesAudit = (u: UserRow): boolean => u.role !== 'reviewer';

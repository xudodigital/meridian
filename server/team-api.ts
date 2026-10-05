// Team and roles: people and invitations (admin only), and the two open invitation routes (look up a link, accept it).
// Meridian sends no email: an invitation is a one-time link that the admin shares. The last active admin can never be
// removed, demoted or disabled, and nobody can do any of these to themselves.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, authenticate, mayAdmin, type Ctx } from './access.ts';
import { clearTotpFails, me } from './auth-api.ts';
import { db } from './db.ts';
import { bus } from './events.ts';
import { body, json, raw, text } from './http.ts';
import { hashPassword, passwordError } from './secrets.ts';
import { createSession, endAllSessions, endSession, setSessionCookie } from './sessions.ts';
import { closeEnded } from './stream.ts';
import {
  activeAdminCount, cleanEmail, cleanName, clearTotp, createInvite, createUser, emailOk, hasOpenInvite, inviteByToken, isRole, listUsers,
  nameError, openInvites, removeUser, revokeInvite, setDisabled, setRole, useInvite, userByEmail, userById, viewInvite, viewUser,
  type InviteRow, type Role, type UserRow,
} from './users.ts';
import { addAudit, clearReadKeys, getDoc } from './workspace.ts';

const LABEL: Record<Role, string> = { admin: 'Admin', editor: 'Editor', reviewer: 'Native reviewer', viewer: 'Viewer' };
const NO_SITE = 'Choose one site for a native reviewer. They review a single site in their own language.';
const BAD_LINK = 'This invitation link does not work. It may have been used, revoked or have expired. Ask an admin for a new one.';

/** The sites in the workspace, as id and domain. */
function sites(): { id: string; domain: string }[] {
  const d = getDoc('sites').data;
  if (!Array.isArray(d)) return [];
  return d.flatMap(x => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string' ? [{ id: x.id, domain: typeof x.domain === 'string' ? x.domain : x.id }] : []);
}
/** The site a reviewer is limited to: a site id that exists, or '' with the message. */
function reviewerSite(role: Role, v: unknown): { site: string; error: string } {
  if (role !== 'reviewer') return { site: '', error: '' };
  const id = text(v, 64);
  return sites().some(s => s.id === id) ? { site: id, error: '' } : { site: '', error: NO_SITE };
}
const domainOf = (site: string): string | null => site ? sites().find(s => s.id === site)?.domain ?? null : null;
/** http://localhost:<port>/invite/<token>. The Host header was checked to be this computer (localHost) before any route runs. */
const inviteLink = (req: IncomingMessage, token: string) => `http://${String(req.headers.host).replace(/^127\.0\.0\.1(?=:|$)/, 'localhost')}/invite/${token}`;
const changed = (userId?: number) => { bus.emit('team'); if (userId) bus.emit('account', userId); };

/** Open invitation routes: GET /api/invites/:token and POST /api/invites/:token/accept. Returns false for other paths. */
export async function inviteOpenApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const m = path.match(/^\/api\/invites\/([A-Za-z0-9_-]{30,100})(\/accept)?$/);
  if (!m) return false;
  const inv = inviteByToken(m[1]!);
  const usable = (i: InviteRow | undefined): i is InviteRow => !!i && !i.used_at && i.expires_at > Date.now();
  if (req.method === 'GET' && !m[2]) {
    if (!usable(inv)) json(res, 404, { error: BAD_LINK });
    else json(res, 200, { invite: { email: inv.email, role: inv.role, site: inv.site || null, domain: domainOf(inv.site), expires: inv.expires_at } });
    return true;
  }
  if (req.method === 'POST' && m[2]) {
    const b = await body(req);
    if (!usable(inv)) { json(res, 404, { error: BAD_LINK }); return true; }
    const name = cleanName(b.name), password = raw(b.password);
    const err = nameError(name) || passwordError(password) || (password === raw(b.confirm) ? '' : 'The two passwords are not the same.');
    if (err) { json(res, 400, { error: err }); return true; }
    if (userByEmail(inv.email)) { json(res, 409, { error: 'An account with this email already exists. Sign in instead.' }); return true; }
    const passHash = await hashPassword(password);
    db.exec('BEGIN IMMEDIATE');
    let u: UserRow;
    try {
      if (!useInvite(inv.id) || userByEmail(inv.email)) { db.exec('ROLLBACK'); json(res, 404, { error: BAD_LINK }); return true; }
      u = createUser({ name, email: inv.email, role: inv.role, site: inv.site, passHash });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    /* The person signs in on this browser; a session another account had here ends. */
    const old = authenticate(req, false);
    if (old) endSession(old.session.id);
    const { token } = createSession(u.id, String(req.headers['user-agent'] || ''));
    setSessionCookie(res, token);
    bus.emit('audit', addAudit({ name: u.name, id: u.id }, 'Joined the team as ' + LABEL[u.role], u.site || null));
    changed();
    json(res, 201, { me: me(u) });
    return true;
  }
  json(res, 405, { error: 'Not allowed.' });
  return true;
}

/** Admin routes: /api/users, /api/users/:id, /api/users/:id/reset-2fa, /api/invites, /api/invites/:id. */
export async function teamApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const user = path.match(/^\/api\/users\/(\d+)(\/reset-2fa)?$/), invite = path.match(/^\/api\/invites\/(\d+)$/);
  if (path !== '/api/users' && path !== '/api/invites' && !user && !invite) return false;
  const no = mayAdmin(ctx.user);
  if (no) { json(res, no.status, { error: no.error }); return true; }
  const m = req.method || 'GET', who = actorOf(ctx);

  if (m === 'GET' && (path === '/api/users' || path === '/api/invites')) {
    json(res, 200, { users: listUsers().map(viewUser), invites: openInvites().map(viewInvite) });
    return true;
  }

  if (m === 'POST' && path === '/api/invites') {
    const b = await body(req);
    const email = cleanEmail(b.email), role = b.role;
    if (!emailOk(email)) { json(res, 400, { error: 'Enter a valid email address.' }); return true; }
    if (!isRole(role)) { json(res, 400, { error: 'Choose a role.' }); return true; }
    const { site, error } = reviewerSite(role, b.site);
    if (error) { json(res, 400, { error }); return true; }
    if (userByEmail(email)) { json(res, 409, { error: 'This person is already on the team.' }); return true; }
    if (hasOpenInvite(email)) { json(res, 409, { error: 'This person already has an invitation that has not been used. Revoke it first to make a new link.' }); return true; }
    const { row, token } = createInvite({ email, role, site, by: ctx.user.id });
    bus.emit('audit', addAudit(who, `Invited ${email} as ${LABEL[role]}`, site || null));
    changed();
    json(res, 201, { invite: viewInvite(row), link: inviteLink(req, token) });
    return true;
  }

  if (m === 'DELETE' && invite) {
    const row = openInvites().find(i => i.id === Number(invite[1]));
    if (!row || !revokeInvite(row.id)) { json(res, 404, { error: 'That invitation was already used, revoked or has expired.' }); return true; }
    bus.emit('audit', addAudit(who, 'Revoked the invitation for ' + row.email));
    changed();
    json(res, 200, { ok: true });
    return true;
  }

  if (!user) { json(res, 404, { error: 'Not found.' }); return true; }
  const target = userById(Number(user[1]));
  if (!target) { json(res, 404, { error: 'That person is not on the team.' }); return true; }
  const self = target.id === ctx.user.id;
  const lastAdmin = target.role === 'admin' && !target.disabled && activeAdminCount() <= 1;

  if (m === 'POST' && user[2]) {
    /* Turning off your own second factor takes your password (the account menu), and is refused while 2-step
       verification is required. A session alone must not be enough, or a stolen one could remove it. */
    if (self) { json(res, 409, { error: 'You cannot reset your own 2-step verification here. Turn it off from your account menu, which asks for your password, or ask another admin.' }); return true; }
    if (!target.totp_secret) { json(res, 409, { error: target.name + ' does not have 2-step verification on.' }); return true; }
    clearTotp(target.id);
    clearTotpFails(target.id);
    bus.emit('audit', addAudit(who, 'Reset 2-step verification for ' + target.email));
    changed(target.id);
    json(res, 200, { user: viewUser(userById(target.id)!) });
    return true;
  }

  if (m === 'PATCH') {
    const b = await body(req);
    if (self) { json(res, 409, { error: 'You cannot change your own role or disable yourself. Ask another admin.' }); return true; }
    const role = b.role === undefined ? target.role : b.role;
    if (!isRole(role)) { json(res, 400, { error: 'Choose a role.' }); return true; }
    const disabled = b.disabled === undefined ? !!target.disabled : b.disabled === true;
    if (lastAdmin && (role !== 'admin' || disabled)) { json(res, 409, { error: 'This is the last admin. Make someone else an admin first.' }); return true; }
    const { site, error } = reviewerSite(role, b.site === undefined ? target.site : b.site);
    if (error) { json(res, 400, { error }); return true; }
    if (role !== target.role || site !== target.site) {
      setRole(target.id, role, site);
      /* What an open browser shows and may do was decided for the old role: the person signs in again under the new one. */
      endAllSessions(target.id); closeEnded();
      bus.emit('audit', addAudit(who, `Changed the role of ${target.email} to ${LABEL[role]}`, site || null));
    }
    if (disabled !== !!target.disabled) {
      setDisabled(target.id, disabled);
      if (disabled) { endAllSessions(target.id); closeEnded(); }
      bus.emit('audit', addAudit(who, (disabled ? 'Disabled ' : 'Enabled ') + target.email));
    }
    changed(target.id);
    json(res, 200, { user: viewUser(userById(target.id)!) });
    return true;
  }

  if (m === 'DELETE') {
    if (self) { json(res, 409, { error: 'You cannot remove yourself. Ask another admin.' }); return true; }
    if (lastAdmin) { json(res, 409, { error: 'This is the last admin. Make someone else an admin first.' }); return true; }
    endAllSessions(target.id); clearReadKeys(target.id); removeUser(target.id);
    closeEnded();
    bus.emit('audit', addAudit(who, 'Removed ' + target.email + ' from the team'));
    changed();
    json(res, 200, { ok: true });
    return true;
  }

  json(res, 405, { error: 'Not allowed.' });
  return true;
}

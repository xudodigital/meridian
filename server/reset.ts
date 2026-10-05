// Setting a new password with a one-time link, for someone who forgot theirs.
//
// A link is asked for on the sign-in screen (it is then emailed, when Email (SMTP) is set up and works) or made by an
// admin in Team for another person (shown to the admin once, to pass on). Either way the link carries a random
// 32-byte token; the database keeps only its SHA-256, the link works once and for 30 minutes, and nothing here logs
// a token or a password. Using it sets the password, ends every session of that person and is written to the audit
// log. It does not sign the person in: they sign in with the new password, and with their 2-step code when that is on.
//
// The request route gives the same answer whether the email belongs to an account or not, and answers before it
// looks, so neither the answer nor the time it takes says anything. Emails are limited per account and in all; a
// request over the limit is dropped silently. A limit never takes anything away from the account's owner: links
// already sent keep working, a new request does not cancel them, and an admin can always make a link in Team.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, authenticate, mayAdmin, type Ctx } from './access.ts';
import { db } from './db.ts';
import { bus } from './events.ts';
import { body, json, raw } from './http.ts';
import { rowOf, usable, valuesOf } from './integrations.ts';
import { Bucket, emailLimiter } from './limits.ts';
import { hashPassword, passwordError, randomToken, sha256 } from './secrets.ts';
import { clearSessionCookie } from './sessions.ts';
import { sendMail, smtpConfig } from './smtp.ts';
import { closeEnded } from './stream.ts';
import { cleanEmail, emailOk, userByEmail, userById, type UserRow } from './users.ts';
import { addAudit } from './workspace.ts';

/** How long a reset link works. */
export const RESET_MINUTES = 30;
const RESET_MS = RESET_MINUTES * 60_000;
/** Reset emails for one account: 3 at once, then one every 20 minutes. */
export const PER_ACCOUNT_BURST = 3;
const perAccount = new Bucket(PER_ACCOUNT_BURST, 20 * 60_000);
/** Reset emails in all: 20 at once, then one a minute. Only emails that would really be sent count, so requests for
    addresses without an account cannot use the allowance up. */
const inAll = new Bucket(20, 60_000);

const BAD_LINK = 'This link does not work. It may have been used already or have expired. Ask for a new one on the sign-in screen, or ask an admin.';
/** The one answer to every request for a link. */
const ASKED = { ok: true, message: `If that email belongs to an account, a link to set a new password is on its way. It works for ${RESET_MINUTES} minutes.` };

type ResetRow = { id: number; token_hash: string; user_id: number; created_by: number | null; created_at: number; expires_at: number };
const qr = {
  insert: db.prepare('INSERT INTO password_resets (token_hash, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
  byHash: db.prepare('SELECT * FROM password_resets WHERE token_hash = ?'),
  /* Using a link deletes it: the first request to get here wins, and only while the link has not expired. */
  use: db.prepare('DELETE FROM password_resets WHERE id = ? AND expires_at > ?'),
  forUser: db.prepare('DELETE FROM password_resets WHERE user_id = ?'),
  fromAdmins: db.prepare('DELETE FROM password_resets WHERE user_id = ? AND created_by IS NOT NULL'),
  byId: db.prepare('DELETE FROM password_resets WHERE id = ?'),
  sweep: db.prepare('DELETE FROM password_resets WHERE expires_at <= ?'),
  setPassword: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
  endSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
};

/** Makes a link token for a person and returns it. It exists only in the link; the database gets its hash. */
function createReset(userId: number, by: number | null): { token: string; id: number; expires: number } {
  const token = randomToken(), now = Date.now();
  qr.sweep.run(now);
  const info = qr.insert.run(sha256(token), userId, by, now, now + RESET_MS);
  return { token, id: Number(info.lastInsertRowid), expires: now + RESET_MS };
}
/** The link's row and its person, when the link still works and the account may sign in. */
function lookup(token: string): { row: ResetRow; user: UserRow } | null {
  const row = qr.byHash.get(sha256(token)) as ResetRow | undefined;
  if (!row || row.expires_at <= Date.now()) return null;
  const user = userById(row.user_id);
  return user && !user.disabled ? { row, user } : null;
}
/** Cancels every reset link of a person: after they changed their password themselves. */
export const dropResets = (userId: number): void => { qr.forUser.run(userId); };

/** Email (SMTP) is set up and its last test did not fail: links can be emailed. */
export const resetByEmail = (): boolean => !!rowOf('email') && usable('email');

/* The link opens the dashboard on this computer. It is built from the server's own port, never from the request's
   Host header, so a request cannot make the server email a link that points somewhere else. */
const linkOf = (token: string): string => `http://localhost:${Number(process.env.PORT) || 4310}/reset/${token}`;

async function mail(to: string, subject: string, text: string): Promise<void> {
  const v = valuesOf('email');
  if (!v) throw new Error('Email is not set up.');
  await sendMail(smtpConfig(v), { to: [to], subject, text });
}

/** What a request for a link does after it was answered. Never throws. */
async function requested(email: string): Promise<void> {
  try {
    if (!resetByEmail()) return;
    const u = userByEmail(email);
    if (!u || u.disabled) return;
    if (perAccount.take('u' + u.id) || inAll.take('all')) return;
    const made = createReset(u.id, null);
    try {
      await mail(u.email, 'Meridian: set a new password',
        `Hello ${u.name},\n\nSomeone asked to set a new password for your Meridian account (${u.email}). To choose one, open this link within ${RESET_MINUTES} minutes:\n\n${linkOf(made.token)}\n\n`
        + 'The link works once. If you did not ask for this, ignore this email: your password stays as it is.\n');
      bus.emit('audit', addAudit({ name: u.name, id: u.id }, 'Asked for a password reset link by email'));
    } catch (e) {
      /* A link nobody received is of no use to anyone. The admins read why in the audit log. */
      qr.byId.run(made.id);
      bus.emit('audit', addAudit({ name: 'Meridian', id: null }, `A password reset email to ${u.email} could not be sent: ${(e as Error).message}`.slice(0, 400)));
    }
  } catch (e) { console.error('A password reset request failed:', (e as Error).message); }
}

const OPEN = /^\/api\/auth\/reset\/([A-Za-z0-9_-]{30,100})$/;

/**
 * The open routes: POST /api/auth/reset/request (ask for a link by email), GET /api/auth/reset/:token (does the link
 * work, and for whom) and POST /api/auth/reset/:token (set the new password). Returns false for any other path.
 */
export async function resetOpenApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith('/api/auth/reset/')) return false;
  const m = req.method || 'GET';

  if (path === '/api/auth/reset/request') {
    if (m !== 'POST') { json(res, 405, { error: 'Not allowed.' }); return true; }
    const email = cleanEmail((await body(req)).email);
    /* The shape of what was typed says nothing about who has an account. */
    if (!emailOk(email)) { json(res, 400, { error: 'Enter your email address.' }); return true; }
    json(res, 200, ASKED);
    setImmediate(() => { void requested(email); });
    return true;
  }

  const t = path.match(OPEN);
  if (!t) { json(res, 404, { error: BAD_LINK }); return true; }
  const found = lookup(t[1]!);

  if (m === 'GET') {
    if (!found) json(res, 404, { error: BAD_LINK });
    else json(res, 200, { reset: { email: found.user.email, expires: found.row.expires_at } });
    return true;
  }
  if (m !== 'POST') { json(res, 405, { error: 'Not allowed.' }); return true; }

  const b = await body(req);
  if (!found) { json(res, 404, { error: BAD_LINK }); return true; }
  const { row, user } = found;
  const password = raw(b.password);
  const err = passwordError(password) || (password === raw(b.confirm) ? '' : 'The two passwords are not the same.');
  if (err) { json(res, 400, { error: err }); return true; }
  const passHash = await hashPassword(password);
  /* One write: the link is used up, the password set, every other link of the person cancelled and every session
     ended. Two requests with the same link cannot both get past the first statement. */
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!Number(qr.use.run(row.id, Date.now()).changes)) { db.exec('ROLLBACK'); json(res, 404, { error: BAD_LINK }); return true; }
    qr.setPassword.run(passHash, user.id);
    qr.forUser.run(user.id);
    qr.endSessions.run(user.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  closeEnded();
  /* Whoever holds the link reads the person's email: wrong passwords tried before no longer keep them out. */
  emailLimiter.clear(user.email.toLowerCase());
  /* This browser's cookie, if it was one of the person's sessions, is of no use now. */
  if (authenticate(req, false) === null) clearSessionCookie(res);
  bus.emit('audit', addAudit({ name: user.name, id: user.id }, row.created_by === null ? 'Set a new password with a reset link sent by email' : 'Set a new password with a reset link from an admin'));
  bus.emit('account', user.id);
  json(res, 200, { ok: true, email: user.email });
  if (resetByEmail()) {
    void mail(user.email, 'Meridian: your password was changed',
      `Hello ${user.name},\n\nThe password of your Meridian account (${user.email}) was just changed with a reset link, and every signed-in session was signed out.\n\n`
      + 'If this was not you, tell an admin right away: they can make you a new reset link in Team and roles.\n').catch(() => undefined);
  }
  return true;
}

/** Admin route: POST /api/users/:id/reset-link makes a link for another person. Returns false for any other path. */
export async function resetAdminApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const m = path.match(/^\/api\/users\/(\d+)\/reset-link$/);
  if (!m) return false;
  const no = mayAdmin(ctx.user);
  if (no) { json(res, no.status, { error: no.error }); return true; }
  if (req.method !== 'POST') { json(res, 405, { error: 'Not allowed.' }); return true; }
  const target = userById(Number(m[1]));
  if (!target) { json(res, 404, { error: 'That person is not on the team.' }); return true; }
  /* Your own password changes from the account menu, which asks for the current one. A session alone must not be
     enough to replace it, or a stolen session could take the account over. */
  if (target.id === ctx.user.id) { json(res, 409, { error: 'You cannot make a reset link for yourself. Change your password from the account menu, or ask another admin.' }); return true; }
  if (target.disabled) { json(res, 409, { error: target.name + ' is disabled. Enable the account first.' }); return true; }
  /* A link an admin made before is replaced: the admin cannot see it again, and only the newest should work. */
  qr.fromAdmins.run(target.id);
  const made = createReset(target.id, ctx.user.id);
  bus.emit('audit', addAudit(actorOf(ctx), 'Made a password reset link for ' + target.email));
  json(res, 201, { link: linkOf(made.token), expires: made.expires, minutes: RESET_MINUTES });
  return true;
}

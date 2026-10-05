// /api/auth/*: first-run owner account, sign-in (with the 2-step code when the person has it on), sign-out, the
// person's own account (name, password, 2-step verification) and their sessions. Passwords, codes and tokens are
// never logged or returned; the only secret ever returned is a new 2-step setup key and the recovery codes, once.
// Setting a new password with a one-time link is in reset.ts (its open routes are passed on from here). The admin's
// view of everyone's sessions is at the end of this file.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, authenticate, mayAdmin, mustEnroll, type Ctx } from './access.ts';
import { bus } from './events.ts';
import { body, clientKey, json, raw, text } from './http.ts';
import { Bucket, accountLimiter, clientSlowdown, emailLimiter, lockedMessage, totpLockMs } from './limits.ts';
import { hashPassword, passwordError, randomToken, sha256, verifyPassword } from './secrets.ts';
import {
  clearSessionCookie, createSession, deviceOf, endAllSessions, endOtherSessions, endSession, endSessionOf, liveSessionById, sessionLive, sessionsOf,
  setSessionCookie, touchSession, type SessionRow,
} from './sessions.ts';
import { dropResets, resetByEmail, resetOpenApi } from './reset.ts';
import { closeEnded } from './stream.ts';
import { hashRecovery, isRecoveryCode, newRecoveryCodes, newSecret, otpauthUri, stepAt, verifyCode } from './totp.ts';
import {
  cleanEmail, cleanName, clearTotp, totpPending, totpSecret, createUser, emailOk, enableTotp, nameError, recoveryHashes, setName, setPassword, setPendingTotp,
  setRecoveryHashes, useTotpStep, userByEmail, userById, userCount, viewUser, type UserRow,
} from './users.ts';
import { db } from './db.ts';
import { addAudit, twofaRequired } from './workspace.ts';

/** The signed-in person as the app sees them. */
export const me = (u: UserRow) => ({ ...viewUser(u), mustEnroll: mustEnroll(u) });

const WRONG = 'Email or password is incorrect.';
const WRONG_CODE = 'That code is not correct. Enter the current 6-digit code from your authenticator app, or a recovery code.';

/* ---------- Step two of a sign-in: a short-lived ticket, kept in memory ---------- */

type Ticket = { userId: number; email: string; exp: number; tries: number };
const tickets = new Map<string, Ticket>();
const TICKET_MS = 5 * 60_000;
function newTicket(u: UserRow): string {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.exp <= now) tickets.delete(k);
  const token = randomToken();
  tickets.set(sha256(token), { userId: u.id, email: u.email, exp: now + TICKET_MS, tries: 0 });
  return token;
}

/** Signs the person in on this browser: a new session (any session cookie the browser had is ended first). */
function startSession(req: IncomingMessage, res: ServerResponse, u: UserRow): void {
  const old = authenticate(req, false);
  if (old) endSession(old.session.id);
  const { token } = createSession(u.id, String(req.headers['user-agent'] || ''));
  setSessionCookie(res, token);
}

/** A code from an authenticator app or a recovery code. A recovery code is used up. */
function checkSecondFactor(u: UserRow, code: string): boolean {
  if (isRecoveryCode(code)) {
    const h = hashRecovery(code), left = recoveryHashes(u);
    if (!left.includes(h)) return false;
    setRecoveryHashes(u.id, left.filter(x => x !== h));
    return true;
  }
  const step = verifyCode(totpSecret(u), code, Date.now(), u.totp_last_step);
  return step !== null && useTotpStep(u.id, step);
}

/** Refuses when the email is locked out after wrong passwords. */
function locked(res: ServerResponse, email: string): boolean {
  const wait = emailLimiter.wait(email);
  if (wait) json(res, 429, { error: lockedMessage(wait) });
  return wait > 0;
}
/** A signed-in person confirming their own password or code: counted per account, apart from sign-in attempts. */
const accountKey = (u: UserRow) => 'u' + u.id;
function accountLocked(res: ServerResponse, u: UserRow): boolean {
  const wait = accountLimiter.wait(accountKey(u));
  if (wait) json(res, 429, { error: lockedMessage(wait) });
  return wait > 0;
}
/** A client with many failed sign-ins waits before its next attempt is looked at (limits.ts); nobody else does. */
async function slowed(client: string): Promise<void> {
  const ms = clientSlowdown.delay(client);
  if (ms) await new Promise(r => setTimeout(r, ms));
}

/* ---------- Sign-in events in the audit log ---------- */

/* Failed attempts can come from anyone who reaches the sign-in page, so they are written sparingly: at most one a
   minute per email and a few a minute in all. Lockouts and successful sign-ins are always written. */
const failuresPerEmail = new Bucket(1, 60_000), failuresInAll = new Bucket(20, 30_000);
/** Who an entry about a sign-in attempt is filed under: the email that was tried. Never anything else that was typed
    (a password pasted into the email field does not look like an email address and is not written down). */
const tried = (email: string, u?: UserRow) => ({ name: emailOk(email) ? email : 'Someone (no valid email given)', id: u?.id ?? null });
const record = (email: string, act: string, u?: UserRow) => { bus.emit('audit', addAudit(tried(email, u), act)); };
function recordFailure(email: string, act: string, u?: UserRow): void {
  if (failuresPerEmail.take(email) || failuresInAll.take('all')) return;
  record(email, act, u);
}
const minutes = (ms: number): string => { const m = Math.max(1, Math.ceil(ms / 60_000)); return `${m} minute${m === 1 ? '' : 's'}`; };

/** A wrong password (or an unknown email) at sign-in. */
function wrongPassword(email: string, client: string, u?: UserRow): void {
  clientSlowdown.fail(client);
  const lockedNow = emailLimiter.fail(email);
  recordFailure(email, 'Failed sign-in: wrong email or password', u);
  if (lockedNow) record(email, `Sign-in locked for ${minutes(emailLimiter.wait(email))} after repeated wrong passwords`, u);
}

/* ---------- Wrong 2-step codes, counted with the account so a restart or a new sign-in does not reset them ---------- */

const qt = {
  get: db.prepare('SELECT totp_fails AS fails, totp_locked_until AS until FROM users WHERE id = ?'),
  set: db.prepare('UPDATE users SET totp_fails = ?, totp_locked_until = ? WHERE id = ?'),
};
const totpState = (id: number) => (qt.get.get(id) as { fails: number; until: number } | undefined) ?? { fails: 0, until: 0 };
/** Forgets a person's wrong 2-step codes: after a right one, and when their 2-step verification is reset. */
export const clearTotpFails = (id: number) => { qt.set.run(0, 0, id); };

const R = {
  sessions: /^\/api\/auth\/sessions\/(\d+)$/,
};

/** Handles /api/auth/*. Returns false for any other path. */
export async function authApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith('/api/auth/')) return false;
  const m = req.method || 'GET';
  const client = clientKey(req);

  /* ---------- Open routes ---------- */

  if (m === 'GET' && path === '/api/auth/status') {
    const ctx = authenticate(req);
    /* resetByEmail: the sign-in screen offers "Forgot your password?" by email only when a link can be sent. */
    json(res, 200, { setup: userCount() === 0, me: ctx ? me(ctx.user) : null, resetByEmail: resetByEmail() });
    return true;
  }

  if (await resetOpenApi(req, res, path)) return true;

  if (m === 'POST' && path === '/api/auth/setup') {
    const b = await body(req);
    const name = cleanName(b.name), email = cleanEmail(b.email), password = raw(b.password);
    const err = nameError(name) || (emailOk(email) ? '' : 'Enter a valid email address.') || passwordError(password)
      || (password === raw(b.confirm) ? '' : 'The two passwords are not the same.');
    if (err) { json(res, 400, { error: err }); return true; }
    if (userCount() > 0) { json(res, 409, { error: 'The owner account already exists. Sign in instead.' }); return true; }
    const passHash = await hashPassword(password);
    /* Checked again inside a write transaction: two first-run requests at once still make one owner. */
    db.exec('BEGIN IMMEDIATE');
    let u: UserRow;
    try {
      if (userCount() > 0) { db.exec('ROLLBACK'); json(res, 409, { error: 'The owner account already exists. Sign in instead.' }); return true; }
      u = createUser({ name, email, role: 'admin', site: '', passHash });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    startSession(req, res, u);
    bus.emit('audit', addAudit({ name: u.name, id: u.id }, 'Created the owner account'));
    json(res, 201, { me: me(u) });
    return true;
  }

  if (m === 'POST' && path === '/api/auth/sign-in') {
    const b = await body(req);
    const email = cleanEmail(b.email), password = raw(b.password);
    await slowed(client);
    if (locked(res, email)) return true;
    const u = email ? userByEmail(email) : undefined;
    /* Always one password check, against a decoy when there is no such account: same time, same message. */
    const ok = await verifyPassword(password.slice(0, 1000), u?.pass_hash);
    if (!u || !ok) { wrongPassword(email, client, u); json(res, 401, { error: WRONG }); return true; }
    if (u.disabled) {
      recordFailure(email, 'Sign-in refused: the account is disabled', u);
      json(res, 403, { error: 'This account is disabled. Ask an admin to enable it.' });
      return true;
    }
    /* With 2-step verification on, the password is only half of a sign-in: the count of wrong passwords stays until
       the code is right too, so nobody can reset it by alternating a right password with wrong codes. */
    if (u.totp_secret) { json(res, 200, { twofa: true, ticket: newTicket(u) }); return true; }
    emailLimiter.clear(email);
    startSession(req, res, u);
    bus.emit('audit', addAudit({ name: u.name, id: u.id }, 'Signed in on ' + deviceOf(String(req.headers['user-agent'] || ''))));
    json(res, 200, { me: me(u) });
    return true;
  }

  if (m === 'POST' && path === '/api/auth/sign-in/code') {
    const b = await body(req);
    const key = sha256(raw(b.ticket)), t = tickets.get(key), code = text(b.code, 40);
    if (!t || t.exp <= Date.now()) { tickets.delete(key); json(res, 401, { error: 'This sign-in has expired. Enter your email and password again.' }); return true; }
    await slowed(client);
    const u = userById(t.userId);
    if (!u || u.disabled || !u.totp_secret) { tickets.delete(key); json(res, 401, { error: 'This sign-in has expired. Enter your email and password again.' }); return true; }
    const now = Date.now(), st = totpState(u.id);
    if (st.until > now) { json(res, 429, { error: lockedMessage(st.until - now) }); return true; }
    if (!checkSecondFactor(u, code)) {
      const fails = st.fails + 1, lock = totpLockMs(fails);
      qt.set.run(fails, lock ? now + lock : 0, u.id);
      clientSlowdown.fail(client);
      recordFailure(t.email, 'Failed sign-in: wrong 2-step code', u);
      if (lock) record(t.email, `2-step verification locked for ${minutes(lock)} after ${fails} wrong codes in a row`, u);
      if (++t.tries >= 5) tickets.delete(key);
      json(res, 401, { error: WRONG_CODE });
      return true;
    }
    tickets.delete(key);
    clearTotpFails(u.id);
    emailLimiter.clear(t.email);
    startSession(req, res, u);
    bus.emit('audit', addAudit({ name: u.name, id: u.id }, 'Signed in with 2-step verification on ' + deviceOf(String(req.headers['user-agent'] || ''))));
    json(res, 200, { me: me(userById(u.id)!) });
    return true;
  }

  if (m === 'POST' && path === '/api/auth/sign-out') {
    const ctx = authenticate(req, false);
    if (ctx) { endSession(ctx.session.id); closeEnded(); }
    clearSessionCookie(res);
    json(res, 200, { ok: true });
    return true;
  }

  /* ---------- The signed-in person's own account (open while 2-step setup is required) ---------- */

  const ctx = authenticate(req);
  if (!ctx) { json(res, 401, { error: 'Sign in first.' }); return true; }
  const u = ctx.user;

  if (m === 'GET' && path === '/api/auth/me') { json(res, 200, { me: me(u) }); return true; }

  if (m === 'POST' && path === '/api/auth/touch') { touchSession(ctx.session); json(res, 200, { ok: true }); return true; }

  if (m === 'PATCH' && path === '/api/auth/me') {
    const b = await body(req);
    const name = cleanName(b.name), err = nameError(name);
    if (err) { json(res, 400, { error: err }); return true; }
    if (name !== u.name) {
      setName(u.id, name);
      bus.emit('audit', addAudit({ name, id: u.id }, 'Changed their name from ' + u.name));
      bus.emit('account', u.id);
      bus.emit('team');
    }
    json(res, 200, { me: me(userById(u.id)!) });
    return true;
  }

  if (m === 'POST' && path === '/api/auth/password') {
    const b = await body(req);
    const current = raw(b.current), next = raw(b.next);
    if (accountLocked(res, u)) return true;
    if (!(await verifyPassword(current.slice(0, 1000), u.pass_hash))) { accountLimiter.fail(accountKey(u)); json(res, 400, { error: 'Your current password is not correct.' }); return true; }
    accountLimiter.clear(accountKey(u));
    const err = passwordError(next) || (next === raw(b.confirm) ? '' : 'The two new passwords are not the same.') || (next === current ? 'Choose a password you do not use here already.' : '');
    if (err) { json(res, 400, { error: err }); return true; }
    setPassword(u.id, await hashPassword(next));
    /* A reset link asked for before (by them, or by someone who got into their mailbox) must not outlive this. */
    dropResets(u.id);
    const ended = endOtherSessions(u.id, ctx.session.id);
    closeEnded();
    bus.emit('audit', addAudit(actorOf(ctx), 'Changed their password'));
    json(res, 200, { ok: true, endedSessions: ended });
    return true;
  }

  if (m === 'POST' && path === '/api/auth/2fa/setup') {
    if (u.totp_secret) { json(res, 409, { error: '2-step verification is already on.' }); return true; }
    const secret = newSecret();
    setPendingTotp(u.id, secret);
    json(res, 200, { secret, uri: otpauthUri(secret, u.email) });
    return true;
  }

  if (m === 'POST' && path === '/api/auth/2fa/enable') {
    const b = await body(req);
    if (u.totp_secret) { json(res, 409, { error: '2-step verification is already on.' }); return true; }
    if (!u.totp_pending) { json(res, 400, { error: 'Start the setup again.' }); return true; }
    if (accountLocked(res, u)) return true;
    const step = verifyCode(totpPending(u), text(b.code, 20), Date.now(), 0);
    if (step === null) { accountLimiter.fail(accountKey(u)); json(res, 400, { error: 'That code is not correct. Enter the 6-digit code your authenticator app shows now.' }); return true; }
    const codes = newRecoveryCodes();
    accountLimiter.clear(accountKey(u));
    enableTotp(u.id, Math.max(step, stepAt(Date.now())), codes.map(hashRecovery));
    clearTotpFails(u.id);
    bus.emit('audit', addAudit(actorOf(ctx), 'Turned on 2-step verification'));
    bus.emit('team');
    json(res, 200, { me: me(userById(u.id)!), recoveryCodes: codes });
    return true;
  }

  if (m === 'POST' && path === '/api/auth/2fa/disable') {
    const b = await body(req);
    if (!u.totp_secret) { json(res, 409, { error: '2-step verification is already off.' }); return true; }
    if (twofaRequired()) { json(res, 409, { error: '2-step verification is required for everyone in Settings, so it cannot be turned off.' }); return true; }
    if (accountLocked(res, u)) return true;
    if (!(await verifyPassword(raw(b.password).slice(0, 1000), u.pass_hash))) { accountLimiter.fail(accountKey(u)); json(res, 400, { error: 'Your password is not correct.' }); return true; }
    accountLimiter.clear(accountKey(u));
    clearTotp(u.id);
    bus.emit('audit', addAudit(actorOf(ctx), 'Turned off 2-step verification'));
    bus.emit('team');
    json(res, 200, { me: me(userById(u.id)!) });
    return true;
  }

  if (m === 'GET' && path === '/api/auth/sessions') {
    json(res, 200, {
      sessions: sessionsOf(u.id).map(s => ({
        id: String(s.id), device: deviceOf(s.user_agent), created: s.created_at, lastSeen: s.last_seen, current: s.id === ctx.session.id,
      })),
    });
    return true;
  }

  if (m === 'POST' && path === '/api/auth/sessions/sign-out-others') {
    const n = endOtherSessions(u.id, ctx.session.id);
    closeEnded();
    if (n) bus.emit('audit', addAudit(actorOf(ctx), `Signed out ${n} other session${n === 1 ? '' : 's'}`));
    json(res, 200, { ended: n });
    return true;
  }

  const s = path.match(R.sessions);
  if (m === 'DELETE' && s) {
    const id = Number(s[1]);
    if (!endSessionOf(u.id, id)) { json(res, 404, { error: 'That session has already ended.' }); return true; }
    if (id === ctx.session.id) clearSessionCookie(res);
    closeEnded();
    json(res, 200, { ok: true });
    return true;
  }

  json(res, 404, { error: 'Not found.' });
  return true;
}

/* ---------- Everyone's sessions, for admins (Team and roles) ---------- */

const allSessions = db.prepare('SELECT * FROM sessions ORDER BY last_seen DESC, id DESC');
const plural = (n: number): string => `${n} session${n === 1 ? '' : 's'}`;

/**
 * Admin routes: GET /api/sessions (every signed-in browser: whose, which device, last seen), DELETE /api/sessions/:id
 * (sign that one out) and POST /api/users/:id/sign-out (sign the person out everywhere; for yourself, everywhere
 * but here). Tokens are never returned: a session is named by its row id. Returns false for any other path.
 */
export async function sessionsAdminApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const one = path.match(/^\/api\/sessions\/(\d+)$/), person = path.match(/^\/api\/users\/(\d+)\/sign-out$/);
  if (path !== '/api/sessions' && !one && !person) return false;
  const no = mayAdmin(ctx.user);
  if (no) { json(res, no.status, { error: no.error }); return true; }
  const m = req.method || 'GET';

  if (path === '/api/sessions') {
    if (m !== 'GET') { json(res, 405, { error: 'Not allowed.' }); return true; }
    const now = Date.now();
    json(res, 200, {
      sessions: (allSessions.all() as SessionRow[]).filter(s => sessionLive(s, now)).map(s => ({
        id: String(s.id), userId: String(s.user_id), device: deviceOf(s.user_agent), created: s.created_at, lastSeen: s.last_seen, current: s.id === ctx.session.id,
      })),
    });
    return true;
  }

  if (one) {
    if (m !== 'DELETE') { json(res, 405, { error: 'Not allowed.' }); return true; }
    const s = liveSessionById(Number(one[1])), owner = s ? userById(s.user_id) : undefined;
    if (!s || !owner) { json(res, 404, { error: 'That session has already ended.' }); return true; }
    endSession(s.id);
    if (s.id === ctx.session.id) clearSessionCookie(res);
    closeEnded();
    bus.emit('audit', addAudit(actorOf(ctx), owner.id === ctx.user.id ? `Signed out their session on ${deviceOf(s.user_agent)}` : `Signed out ${owner.email} on ${deviceOf(s.user_agent)}`));
    json(res, 200, { ok: true });
    return true;
  }

  if (m !== 'POST') { json(res, 405, { error: 'Not allowed.' }); return true; }
  const target = userById(Number(person![1]));
  if (!target) { json(res, 404, { error: 'That person is not on the team.' }); return true; }
  /* For yourself this is "Sign out other sessions": the browser you are using stays signed in. */
  const self = target.id === ctx.user.id;
  const ended = self ? endOtherSessions(target.id, ctx.session.id) : Number(endAllSessions(target.id).changes);
  closeEnded();
  if (ended) bus.emit('audit', addAudit(actorOf(ctx), self ? `Signed out ${plural(ended)} of their own on other devices` : `Signed out ${target.email} everywhere (${plural(ended)})`));
  json(res, 200, { ended });
  return true;
}

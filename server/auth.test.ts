// Accounts end to end against a real server: first run, sign-in and lockout, the session cookie, expiry and rotation,
// 2-step verification with recovery codes, invitations, roles, and the actor taken from the session.
// Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { codeAt, stepAt } from './totp.ts';
import { Client, PASSWORD, member, saveSites, startServer, type Json, type TestServer } from './testkit.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(() => s?.stop());

type Me = { id: string; name: string; email: string; role: string; site: string | null; twofa: boolean; mustEnroll: boolean };
const meOf = (r: { data: Json }) => r.data.me as Me;

describe('first run', () => {
  it('reports that no account exists, then creates the owner once, as an admin', async () => {
    const anon = new Client(s.base);
    assert.deepEqual((await anon.get('/api/auth/status')).data, { setup: true, me: null, resetByEmail: false });
    assert.equal((await anon.get('/api/health')).status, 200);
    assert.equal((await anon.get('/api/state')).status, 401);

    const bad = async (b: Json) => (await anon.post('/api/auth/setup', b)).data.error;
    assert.equal(await bad({ name: '', email: 'o@example.com', password: PASSWORD, confirm: PASSWORD }), 'Enter your name, for example Dewi Lestari.');
    assert.equal(await bad({ name: 'O', email: 'nope', password: PASSWORD, confirm: PASSWORD }), 'Enter a valid email address.');
    assert.equal(await bad({ name: 'O', email: 'o@example.com', password: 'short', confirm: 'short' }), 'Use a password of at least 12 characters.');
    assert.equal(await bad({ name: 'O', email: 'o@example.com', password: PASSWORD, confirm: PASSWORD + 'x' }), 'The two passwords are not the same.');
    /* Without our header the write is refused before anything else. */
    assert.equal((await anon.post('/api/auth/setup', { name: 'O', email: 'o@example.com', password: PASSWORD, confirm: PASSWORD }, { 'x-meridian': '0' })).status, 403);

    const o = new Client(s.base);
    const r = await o.post('/api/auth/setup', { name: '  Owner   Person ', email: 'Owner@Example.com', password: PASSWORD, confirm: PASSWORD });
    assert.equal(r.status, 201);
    assert.deepEqual({ ...meOf(r), id: 'x' }, { id: 'x', name: 'Owner Person', email: 'owner@example.com', role: 'admin', site: null, created: (meOf(r) as Me & { created: number }).created, disabled: false, twofa: false, mustEnroll: false });
    assert.ok(!JSON.stringify(r.data).includes('scrypt'), 'no password material in the answer');
    assert.match(o.lastSetCookie, /^meridian_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/);
    assert.ok(!/Secure/.test(o.lastSetCookie));

    /* Only once. */
    const again = await new Client(s.base).post('/api/auth/setup', { name: 'Mallory', email: 'm@example.com', password: PASSWORD, confirm: PASSWORD });
    assert.equal(again.status, 409);
    assert.equal((await anon.get('/api/auth/status')).data.setup, false);
    /* The token itself is not stored; its SHA-256 is. */
    const row = s.db().prepare('SELECT token_hash FROM sessions').get() as { token_hash: string };
    assert.notEqual(row.token_hash, o.cookie);
    assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  });
});

describe('sign-in', () => {
  it('signs in with the right password and gives one message for an unknown email and a wrong password', async () => {
    const c = new Client(s.base);
    const ok = await c.post('/api/auth/sign-in', { email: 'OWNER@example.com', password: PASSWORD });
    assert.equal(ok.status, 200);
    assert.equal(meOf(ok).email, 'owner@example.com');
    assert.equal((await c.get('/api/auth/me')).status, 200);

    const wrong = await new Client(s.base).post('/api/auth/sign-in', { email: 'owner@example.com', password: 'not the password' });
    const unknown = await new Client(s.base).post('/api/auth/sign-in', { email: 'nobody@example.com', password: PASSWORD });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.data.error, 'Email or password is incorrect.');
    assert.deepEqual(unknown.data, wrong.data);
  });

  it('locks an email out after five failures, even for the right password', async () => {
    const c = new Client(s.base);
    await member(s, await signedIn('owner@example.com'), 'viewer', 'lock@example.com', 'Lock Test');
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/sign-in', { email: 'lock@example.com', password: 'wrong password ' + i })).status, 401);
    const locked = await c.post('/api/auth/sign-in', { email: 'lock@example.com', password: PASSWORD });
    assert.equal(locked.status, 429);
    assert.equal(locked.data.error, 'Too many failed attempts. Try again in 5 minutes.');
    /* Another email is not affected. */
    assert.equal((await c.post('/api/auth/sign-in', { email: 'owner@example.com', password: PASSWORD })).status, 200);
  });

  it('rotates the session at sign-in and ends it at sign-out', async () => {
    const c = await signedIn('owner@example.com');
    const first = c.cookie;
    await c.post('/api/auth/sign-in', { email: 'owner@example.com', password: PASSWORD });
    assert.notEqual(c.cookie, first);
    const stale = new Client(s.base); stale.cookie = first;
    assert.equal((await stale.get('/api/auth/me')).status, 401, 'the old token no longer works');
    assert.equal((await c.get('/api/auth/me')).status, 200);
    const out = await c.post('/api/auth/sign-out');
    assert.equal(out.status, 200);
    assert.match(c.lastSetCookie, /^meridian_session=; .*Max-Age=0$/);
    const ended = new Client(s.base); ended.cookie = c.cookie;
    assert.equal((await ended.get('/api/auth/me')).status, 401, 'the signed-out token no longer works');
  });

  it('ends a session after the idle time from Settings and after 30 days', async () => {
    const c = await signedIn('owner@example.com');
    const db = s.db();
    db.prepare('UPDATE sessions SET last_seen = last_seen - ? ').run(9 * 3600_000);
    assert.equal((await c.get('/api/auth/me')).status, 401, 'idle for more than the default 8 hours');

    const d = await signedIn('owner@example.com');
    db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
    assert.equal((await d.get('/api/state')).status, 401, 'past 30 days');

    /* "1 minute" in Settings: two minutes of quiet ends the session. */
    const e = await signedIn('owner@example.com');
    const ws = await e.get('/api/workspace');
    const v = (ws.data.docs as Record<string, { version: number }>).settings!.version;
    assert.equal((await e.put('/api/workspace/docs/settings', { version: v, data: { timeout: 'demo' } })).status, 200);
    assert.equal((await e.post('/api/auth/touch')).status, 200);
    db.prepare('UPDATE sessions SET last_seen = last_seen - 120000').run();
    assert.equal((await e.get('/api/auth/me')).status, 401);
    db.prepare(`UPDATE workspace_docs SET data = '{"timeout":"h8"}' WHERE id = 'settings'`).run();
  });

  it('lists the person\'s own sessions and signs out the others', async () => {
    const a = await signedIn('owner@example.com'), b = await signedIn('owner@example.com');
    const list = (await a.get('/api/auth/sessions')).data.sessions as { id: string; device: string; current: boolean; lastSeen: number }[];
    assert.ok(list.length >= 2);
    assert.equal(list.filter(x => x.current).length, 1);
    assert.equal(list[0]!.device, 'Script');
    const r = await a.post('/api/auth/sessions/sign-out-others');
    assert.ok((r.data.ended as number) >= 1);
    assert.equal((await b.get('/api/auth/me')).status, 401);
    assert.equal((await a.get('/api/auth/me')).status, 200);
    const mine = (await a.get('/api/auth/sessions')).data.sessions as { id: string }[];
    assert.equal(mine.length, 1);
    assert.equal((await a.del('/api/auth/sessions/' + mine[0]!.id)).status, 200);
    assert.equal((await a.get('/api/auth/me')).status, 401);
  });
});

/** A new client signed in with the test password. */
async function signedIn(email: string): Promise<Client> {
  const c = new Client(s.base);
  const r = await c.post('/api/auth/sign-in', { email, password: PASSWORD });
  if (r.status !== 200 || !r.data.me) throw new Error('sign-in failed: ' + JSON.stringify(r.data));
  return c;
}

describe('the person\'s own account', () => {
  it('changes the name and the password; the name is what the audit log records', async () => {
    const c = await signedIn('owner@example.com');
    assert.equal((await c.patch('/api/auth/me', { name: ' ' })).status, 400);
    const r = await c.patch('/api/auth/me', { name: 'Owner Renamed' });
    assert.equal(meOf(r).name, 'Owner Renamed');
    const audit = (await c.get('/api/workspace')).data.audit as { actor: string; act: string }[];
    assert.deepEqual(audit[0], { ...audit[0], actor: 'Owner Renamed', act: 'Changed their name from Owner Person' });

    const other = await signedIn('owner@example.com');
    assert.equal((await c.post('/api/auth/password', { current: 'wrong', next: 'a new long password', confirm: 'a new long password' })).data.error, 'Your current password is not correct.');
    assert.equal((await c.post('/api/auth/password', { current: PASSWORD, next: 'short', confirm: 'short' })).data.error, 'Use a password of at least 12 characters.');
    const ok = await c.post('/api/auth/password', { current: PASSWORD, next: 'a new long password', confirm: 'a new long password' });
    assert.equal(ok.status, 200);
    assert.equal((await other.get('/api/auth/me')).status, 401, 'other sessions end when the password changes');
    assert.equal((await new Client(s.base).post('/api/auth/sign-in', { email: 'owner@example.com', password: PASSWORD })).status, 401);
    assert.equal((await c.post('/api/auth/password', { current: 'a new long password', next: PASSWORD, confirm: PASSWORD })).status, 200);
  });
});

describe('2-step verification', () => {
  it('sets up with a code, asks for it at sign-in, refuses a replay, and accepts each recovery code once', async () => {
    const admin = await signedIn('owner@example.com');
    const c = await member(s, admin, 'editor', 'totp@example.com', 'Totp Person');
    const setup = await c.post('/api/auth/2fa/setup');
    const secret = setup.data.secret as string;
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.equal(setup.data.uri, `otpauth://totp/Meridian%3Atotp%40example.com?secret=${secret}&issuer=Meridian&algorithm=SHA1&digits=6&period=30`);
    assert.equal((await c.post('/api/auth/2fa/enable', { code: '000000' === codeAt(secret, stepAt(Date.now())) ? '111111' : '000000' })).status, 400);
    const on = await c.post('/api/auth/2fa/enable', { code: codeAt(secret, stepAt(Date.now())) });
    assert.equal(on.status, 200);
    assert.equal(meOf(on).twofa, true);
    const codes = on.data.recoveryCodes as string[];
    assert.equal(codes.length, 10);
    const row = s.db().prepare(`SELECT recovery_hashes FROM users WHERE email = 'totp@example.com'`).get() as { recovery_hashes: string };
    assert.ok(!codes.some(x => row.recovery_hashes.includes(x)), 'recovery codes are stored hashed');

    /* Sign-in: the password gives a ticket, not a session. */
    const d = new Client(s.base);
    const step1 = await d.post('/api/auth/sign-in', { email: 'totp@example.com', password: PASSWORD });
    assert.equal(step1.data.twofa, true);
    assert.equal(d.cookie, '');
    assert.equal((await d.post('/api/auth/sign-in/code', { ticket: step1.data.ticket, code: '12345' })).status, 401);
    /* The code used to switch 2-step on cannot be used again. */
    const used = codeAt(secret, stepAt(Date.now()));
    const replay = await d.post('/api/auth/sign-in/code', { ticket: step1.data.ticket, code: used });
    assert.equal(replay.status, 401);
    const next = codeAt(secret, stepAt(Date.now()) + 1);
    const ok = await d.post('/api/auth/sign-in/code', { ticket: step1.data.ticket, code: next });
    assert.equal(ok.status, 200);
    assert.ok(d.cookie);
    /* The ticket is gone after use. */
    assert.equal((await d.post('/api/auth/sign-in/code', { ticket: step1.data.ticket, code: next })).status, 401);

    const e = new Client(s.base);
    const t2 = (await e.post('/api/auth/sign-in', { email: 'totp@example.com', password: PASSWORD })).data.ticket;
    assert.equal((await e.post('/api/auth/sign-in/code', { ticket: t2, code: codes[0]!.toUpperCase() })).status, 200);
    const f = new Client(s.base);
    const t3 = (await f.post('/api/auth/sign-in', { email: 'totp@example.com', password: PASSWORD })).data.ticket;
    assert.equal((await f.post('/api/auth/sign-in/code', { ticket: t3, code: codes[0] })).status, 401, 'a recovery code works once');
    assert.equal((await f.post('/api/auth/sign-in/code', { ticket: t3, code: codes[1] })).status, 200);

    /* An admin can reset it; then the password alone signs in. */
    const id = meOf(on).id;
    assert.equal((await admin.post(`/api/users/${id}/reset-2fa`)).status, 200);
    assert.ok((await new Client(s.base).post('/api/auth/sign-in', { email: 'totp@example.com', password: PASSWORD })).data.me);
  });

  it('makes everyone without it set it up first when Settings require it', async () => {
    const admin = await signedIn('owner@example.com');
    const c = await member(s, admin, 'viewer', 'enroll@example.com', 'Enroll Person');
    const ws = await admin.get('/api/workspace');
    const v = (ws.data.docs as Record<string, { version: number; data: Json | null }>).settings!;
    assert.equal((await admin.put('/api/workspace/docs/settings', { version: v.version, data: { ...(v.data ?? {}), twofa: true } })).status, 200);
    assert.equal(meOf(await c.get('/api/auth/me')).mustEnroll, true);
    const refused = await c.get('/api/state');
    assert.deepEqual([refused.status, refused.data.code], [403, 'enroll']);
    /* Turning it off is refused while it is required. */
    const secret = (await c.post('/api/auth/2fa/setup')).data.secret as string;
    const on = await c.post('/api/auth/2fa/enable', { code: codeAt(secret, stepAt(Date.now())) });
    assert.equal(meOf(on).mustEnroll, false);
    assert.equal((await c.get('/api/state')).status, 200);
    assert.equal((await c.post('/api/auth/2fa/disable', { password: PASSWORD })).status, 409);
    /* The admin, who has no 2-step yet, must also enrol now. */
    assert.equal((await admin.get('/api/state')).status, 403);
    s.db().prepare(`UPDATE workspace_docs SET data = '{"timeout":"h8","twofa":false}' WHERE id = 'settings'`).run();
    assert.equal((await admin.get('/api/state')).status, 200);
    assert.equal((await c.post('/api/auth/2fa/disable', { password: 'wrong' })).status, 400);
    assert.equal(meOf(await c.post('/api/auth/2fa/disable', { password: PASSWORD })).twofa, false);
  });
});

describe('invitations', () => {
  it('creates a one-time link that sets name and password and signs the person in', async () => {
    const admin = await signedIn('owner@example.com');
    await saveSites(admin, [{ id: 's1', domain: 'kopi.example' }]);
    const bad = async (b: Json) => (await admin.post('/api/invites', b)).data.error;
    assert.equal(await bad({ email: 'x', role: 'editor' }), 'Enter a valid email address.');
    assert.equal(await bad({ email: 'r@example.com', role: 'owner' }), 'Choose a role.');
    assert.equal(await bad({ email: 'r@example.com', role: 'reviewer' }), 'Choose one site for a native reviewer. They review a single site in their own language.');
    assert.equal(await bad({ email: 'owner@example.com', role: 'editor' }), 'This person is already on the team.');

    const inv = await admin.post('/api/invites', { email: 'Rev@Example.com', role: 'reviewer', site: 's1' });
    assert.equal(inv.status, 201);
    const link = inv.data.link as string;
    assert.match(link, /^http:\/\/localhost:\d+\/invite\/[A-Za-z0-9_-]{43}$/);
    const token = link.split('/invite/')[1]!;
    assert.equal(await bad({ email: 'rev@example.com', role: 'editor' }), 'This person already has an invitation that has not been used. Revoke it first to make a new link.');
    const stored = s.db().prepare('SELECT token_hash FROM invites WHERE email = ?').get('rev@example.com') as { token_hash: string };
    assert.notEqual(stored.token_hash, token);

    const anon = new Client(s.base);
    const look = await anon.get('/api/invites/' + token);
    assert.deepEqual({ ...(look.data.invite as Json), expires: 0 }, { email: 'rev@example.com', role: 'reviewer', site: 's1', domain: 'kopi.example', expires: 0 });
    assert.equal((await anon.post(`/api/invites/${token}/accept`, { name: 'Linh', password: 'short', confirm: 'short' })).status, 400);
    const acc = await anon.post(`/api/invites/${token}/accept`, { name: 'Linh Reviewer', password: PASSWORD, confirm: PASSWORD });
    assert.equal(acc.status, 201);
    assert.deepEqual([meOf(acc).role, meOf(acc).site, meOf(acc).email], ['reviewer', 's1', 'rev@example.com']);
    assert.ok(anon.cookie);
    assert.equal((await anon.get('/api/auth/me')).status, 200);
    /* Used once. */
    assert.equal((await new Client(s.base).get('/api/invites/' + token)).status, 404);
    assert.equal((await new Client(s.base).post(`/api/invites/${token}/accept`, { name: 'Again', password: PASSWORD, confirm: PASSWORD })).status, 404);
    assert.equal((await new Client(s.base).get('/api/invites/' + 'x'.repeat(43))).status, 404);
  });

  it('expires after 7 days and can be revoked', async () => {
    const admin = await signedIn('owner@example.com');
    const a = await admin.post('/api/invites', { email: 'late@example.com', role: 'viewer' });
    const exp = (a.data.invite as { expires: number; created: number });
    assert.equal(exp.expires - exp.created, 7 * 864e5);
    s.db().prepare('UPDATE invites SET expires_at = ? WHERE email = ?').run(Date.now() - 1, 'late@example.com');
    const token = String(a.data.link).split('/invite/')[1];
    assert.equal((await new Client(s.base).post(`/api/invites/${token}/accept`, { name: 'Late', password: PASSWORD, confirm: PASSWORD })).status, 404);

    const b = await admin.post('/api/invites', { email: 'revoked@example.com', role: 'viewer' });
    const id = (b.data.invite as { id: string }).id;
    assert.ok(((await admin.get('/api/users')).data.invites as { id: string }[]).some(i => i.id === id));
    assert.equal((await admin.del('/api/invites/' + id)).status, 200);
    assert.equal((await admin.del('/api/invites/' + id)).status, 404);
    const t = String(b.data.link).split('/invite/')[1];
    assert.equal((await new Client(s.base).get('/api/invites/' + t)).status, 404);
  });
});

describe('roles', () => {
  it('lets a viewer read and refuses every change', async () => {
    const admin = await signedIn('owner@example.com');
    const v = await member(s, admin, 'viewer', 'viewer@example.com', 'Vic Viewer');
    assert.equal((await v.get('/api/state')).status, 200);
    assert.equal((await v.get('/api/workspace')).status, 200);
    const refused = await v.post('/api/requests', { siteId: 's1', domain: 'kopi.example', topic: 'kopi', goal: 'x' });
    assert.deepEqual([refused.status, refused.data.error], [403, 'View-only role. Ask an admin to make changes.']);
    assert.equal((await v.put('/api/workspace/docs/sites', { version: 1, data: [] })).status, 403);
    assert.equal((await v.post('/api/audit', { entries: [{ act: 'x' }] })).status, 403);
    assert.equal((await v.get('/api/users')).status, 403);
    assert.equal((await v.post('/api/engine/refresh')).status, 403);
  });

  it('lets an editor change the work but not Settings, Team or the reset', async () => {
    const admin = await signedIn('owner@example.com');
    const e = await member(s, admin, 'editor', 'editor@example.com', 'Eli Editor');
    const ws = (await e.get('/api/workspace')).data.docs as Record<string, { version: number }>;
    assert.equal((await e.put('/api/workspace/docs/schedules', { version: ws.schedules!.version, data: [] })).status, 200);
    const st = await e.put('/api/workspace/docs/settings', { version: ws.settings!.version, data: { twofa: false } });
    assert.deepEqual([st.status, st.data.error], [403, 'Only an admin can do this.']);
    assert.equal((await e.put('/api/workspace/docs/notifyPrefs', { version: 0, data: {} })).status, 403);
    assert.equal((await e.post('/api/invites', { email: 'z@example.com', role: 'admin' })).status, 403);
    assert.equal((await e.post('/api/workspace/reset', { confirm: 'RESET' })).status, 403);
  });

  it('protects the last admin and the admin themselves', async () => {
    const admin = await signedIn('owner@example.com');
    const me = meOf(await admin.get('/api/auth/me'));
    assert.equal((await admin.del('/api/users/' + me.id)).data.error, 'You cannot remove yourself. Ask another admin.');
    assert.equal((await admin.patch('/api/users/' + me.id, { role: 'viewer' })).data.error, 'You cannot change your own role or disable yourself. Ask another admin.');
    const second = await member(s, admin, 'admin', 'admin2@example.com', 'Second Admin');
    const id2 = meOf(await second.get('/api/auth/me')).id;
    /* With two admins one can demote the other, but not the last. */
    assert.equal((await second.patch('/api/users/' + me.id, { role: 'editor' })).status, 200);
    /* A change of role ends the person's sessions: they sign in again, under the new role. */
    assert.equal((await admin.get('/api/users')).status, 401, 'the demoted admin was signed out at once');
    assert.equal((await admin.post('/api/auth/sign-in', { email: 'owner@example.com', password: PASSWORD })).status, 200);
    assert.equal((await admin.get('/api/users')).status, 403, 'and is an editor from then on');
    assert.equal((await second.patch('/api/users/' + me.id, { role: 'admin' })).status, 200);
    assert.equal((await admin.get('/api/users')).status, 401);
    assert.equal((await admin.post('/api/auth/sign-in', { email: 'owner@example.com', password: PASSWORD })).status, 200);
    /* An admin cannot take their own second factor away with a session alone. */
    const self = await admin.post(`/api/users/${me.id}/reset-2fa`);
    assert.equal(self.status, 409);
    assert.match(String(self.data.error), /You cannot reset your own 2-step verification here/);
    /* Disable ends the person's sessions. */
    const viewer = await signedIn('viewer@example.com');
    const vid = meOf(await viewer.get('/api/auth/me')).id;
    assert.equal((await admin.patch('/api/users/' + vid, { disabled: true })).status, 200);
    assert.equal((await viewer.get('/api/auth/me')).status, 401);
    assert.equal((await new Client(s.base).post('/api/auth/sign-in', { email: 'viewer@example.com', password: PASSWORD })).data.error, 'This account is disabled. Ask an admin to enable it.');
    assert.equal((await admin.patch('/api/users/' + vid, { disabled: false })).status, 200);
    /* Remove the second admin, then the owner is the last one. */
    assert.equal((await admin.del('/api/users/' + id2)).status, 200);
    assert.equal((await second.get('/api/auth/me')).status, 401);
    const list = (await admin.get('/api/users')).data.users as { email: string; role: string }[];
    assert.ok(!list.some(u => u.email === 'admin2@example.com'));
    assert.ok(!JSON.stringify(list).includes('scrypt'));
  });

  it('limits a native reviewer to their own site and to the review actions', async () => {
    const admin = await signedIn('owner@example.com');
    const rev = await signedIn('rev@example.com');
    /* Articles of two sites, written straight into the database (no job needed for a permission check). */
    const db = s.db(), now = Date.now();
    const add = (site: string) => Number(db.prepare(`INSERT INTO articles (site_id, domain, country, lang, keyword, status, content, created_at, queued_at, finished_at)
      VALUES (?, ?, 'Vietnam', 'Vietnamese', 'kw ' || ?, 'review', '{"title":"T","titleEn":"Title","titleTag":"T","metaDescription":"","slug":"t","byline":{"text":"","en":""},"disclosure":{"text":"","en":""},"blocks":[],"sources":[],"reviewerNotes":[]}', ?, ?, ?)`).run(site, site + '.example', site, now, now, now).lastInsertRowid);
    const mine = add('s1'), other = add('s2');
    const seen = ((await rev.get('/api/state')).data.articles as { id: number }[]).map(a => a.id);
    assert.ok(seen.includes(mine) && !seen.includes(other));
    assert.ok(((await admin.get('/api/state')).data.articles as { id: number }[]).some(a => a.id === other));
    assert.equal((await rev.post(`/api/articles/${other}/language-review`)).status, 403);
    assert.equal((await rev.post(`/api/articles/${mine}/approve`)).data.error, 'Your role reviews articles only.');
    const lr = await rev.post(`/api/articles/${mine}/language-review`, { by: 'Someone Else' });
    assert.equal(lr.status, 200);
    /* The actor is the session's person, whatever the body says. */
    assert.equal(((lr.data.article as Json).languageReview as Json).by, 'Linh Reviewer');
    assert.deepEqual(((lr.data.article as Json).history as Json[]).at(-1), { at: ((lr.data.article as Json).history as { at: number }[]).at(-1)!.at, by: 'Linh Reviewer', action: 'language-review', note: '' });
    assert.equal(((await rev.get('/api/workspace')).data.audit as unknown[]).length, 0, 'reviewers do not get the audit log');
    const audit = (await admin.get('/api/workspace')).data.audit as { actor: string; act: string; site: string }[];
    assert.deepEqual(audit[0], { ...audit[0], actor: 'Linh Reviewer', act: 'Finished the language review: Title', site: 's1' });
  });
});

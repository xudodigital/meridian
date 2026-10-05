// Password reset links and the admin's view of sessions, end to end against a real server and the fake SMTP server
// (fixtures/fake-services.ts): what the request route gives away (nothing), how a link is stored, how long and how
// often it works, what using it ends, the limits, the admin's link in Team, and signing other people out.
// Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { mode, startFakes, type Mail } from './fixtures/fake-services.ts';
import { sha256 } from './secrets.ts';
import { codeAt, stepAt } from './totp.ts';
import { Client, PASSWORD, member, owner, startServer, until, type Json, type TestServer } from './testkit.ts';

let s: TestServer, fakes: Awaited<ReturnType<typeof startFakes>>, admin: Client;
/* As in reset.ts, which a test cannot import: it would open the real data folder. */
const RESET_MINUTES = 30, PER_ACCOUNT_BURST = 3;
const NEW = 'a brand new passphrase 42';
const ASKED = { ok: true, message: `If that email belongs to an account, a link to set a new password is on its way. It works for ${RESET_MINUTES} minutes.` };

/** The text of an email as the person reads it (the body travels as base64). */
const textOf = (m: Mail): string => Buffer.from(m.data.split('\r\n\r\n').slice(1).join(''), 'base64').toString('utf8');
const mailsTo = (email: string, subject: RegExp): Mail[] => fakes.mails.filter(m => m.to.includes(email) && subject.test(m.data));
const resetMails = (email: string) => mailsTo(email, /^Subject: Meridian: set a new password$/m);
const tokenIn = (m: Mail): string => textOf(m).match(/\/reset\/([A-Za-z0-9_-]+)/)![1]!;
const ask = (email: string) => new Client(s.base).post('/api/auth/reset/request', { email });
/** Asks for a link and returns the token from the email that arrives. */
async function linkFor(email: string): Promise<string> {
  const n = resetMails(email).length;
  assert.equal((await ask(email)).status, 200);
  await until('the reset email for ' + email, async () => resetMails(email).length > n);
  return tokenIn(resetMails(email).at(-1)!);
}
const rows = (email: string) => s.db().prepare('SELECT r.* FROM password_resets r JOIN users u ON u.id = r.user_id WHERE u.email = ?').all(email) as { id: number; token_hash: string; created_by: number | null; created_at: number; expires_at: number }[];
const idOf = (email: string) => String((s.db().prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number }).id);
const auditActs = async () => ((await admin.get('/api/audit?limit=500')).data.audit as { actor: string; act: string }[]).map(a => `${a.actor}: ${a.act}`);
const signIn = (email: string, password: string) => new Client(s.base).post('/api/auth/sign-in', { email, password });
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

before(async () => {
  fakes = await startFakes();
  s = await startServer(fakes.env);
  admin = await owner(s, 'Owner Person', 'owner@example.com');
});
after(() => { s?.stop(); fakes?.stop(); });

describe('asking for a reset link', () => {
  it('is not offered by email until Email (SMTP) is set up, and still answers the same', async () => {
    await member(s, admin, 'editor', 'editor@example.com', 'Eddie Editor');
    assert.equal((await new Client(s.base).get('/api/auth/status')).data.resetByEmail, false);
    const r = await ask('editor@example.com');
    assert.deepEqual([r.status, r.data], [200, ASKED]);
    await pause(150);
    assert.deepEqual(rows('editor@example.com'), []);
    assert.equal(fakes.mails.length, 0);
  });

  it('answers the same for an account and for no account, and emails only the account', async () => {
    const values = { host: '127.0.0.1', port: String(fakes.smtpPort), user: 'mailer@example.com', pass: mode.smtpPass, from: 'meridian@example.com' };
    assert.equal(((await admin.put('/api/integrations/email', { values })).data.result as Json).status, 'ok');
    assert.equal((await new Client(s.base).get('/api/auth/status')).data.resetByEmail, true);

    const known = await ask('  Editor@Example.com '), unknown = await ask('nobody@example.com');
    assert.deepEqual([known.status, known.data], [200, ASKED]);
    assert.deepEqual([unknown.status, unknown.data], [200, ASKED]);
    assert.equal(known.cookie, '', 'asking signs nobody in');
    await until('the email', async () => resetMails('editor@example.com').length === 1);
    await pause(150);
    assert.equal(mailsTo('nobody@example.com', /./).length, 0);
    assert.equal((s.db().prepare('SELECT COUNT(*) AS n FROM password_resets').get() as { n: number }).n, 1);
    /* What was typed must look like an email address; that says nothing about who has an account. */
    assert.equal((await ask('not an email')).status, 400);
    assert.equal((await ask('')).status, 400);
    /* A write like any other: without the dashboard's header it is refused. */
    assert.equal((await fetch(s.base + '/api/auth/reset/request', { method: 'POST', body: JSON.stringify({ email: 'editor@example.com' }) })).status, 403);
  });

  it('emails a link to this computer that is stored only as a hash, lasts 30 minutes and is never printed', async () => {
    const m = resetMails('editor@example.com')[0]!, token = tokenIn(m), text = textOf(m);
    assert.deepEqual([m.from, m.to], ['meridian@example.com', ['editor@example.com']]);
    assert.ok(text.includes(`http://localhost:${s.port}/reset/${token}\n`), text);
    assert.match(text, /^Hello Eddie Editor,/);
    assert.match(text, /within 30 minutes/);
    assert.match(text, /If you did not ask for this, ignore this email/);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    const [row] = rows('editor@example.com');
    assert.equal(row!.token_hash, sha256(token));
    assert.equal(row!.created_by, null);
    assert.equal(row!.expires_at - row!.created_at, RESET_MINUTES * 60_000);
    const stored = JSON.stringify(s.db().prepare('SELECT * FROM password_resets').all());
    assert.ok(!stored.includes(token));
    assert.ok(!s.output().includes(token), 'the token is never printed');
    /* Nor written to the log file, where the request for the link's page is a line (the path is masked). */
    await new Client(s.base).get('/api/auth/reset/' + token);
    await pause(100);
    const logFile = join(s.tmp, 'data', 'logs', 'meridian.log');
    assert.ok(existsSync(logFile));
    const log = readFileSync(logFile, 'utf8');
    assert.ok(log.includes('/api/auth/reset/[token]'), 'the request is logged with the token masked');
    assert.ok(!log.includes(token));
    assert.ok((await auditActs()).includes('Eddie Editor: Asked for a password reset link by email'));
    assert.ok(!JSON.stringify(await admin.get('/api/audit?limit=500')).includes(token));
  });
});

describe('using a reset link', () => {
  it('says who the link is for, and refuses a link that never existed', async () => {
    const token = tokenIn(resetMails('editor@example.com')[0]!);
    const r = await new Client(s.base).get('/api/auth/reset/' + token);
    assert.equal(r.status, 200);
    assert.equal((r.data.reset as Json).email, 'editor@example.com');
    assert.deepEqual(Object.keys(r.data.reset as Json).sort(), ['email', 'expires']);
    const none = await new Client(s.base).get('/api/auth/reset/' + 'A'.repeat(43));
    assert.equal(none.status, 404);
    assert.match(String(none.data.error), /^This link does not work\./);
    assert.equal((await new Client(s.base).post('/api/auth/reset/' + 'A'.repeat(43), { password: NEW, confirm: NEW })).status, 404);
  });

  it('keeps the password rules, then sets the password once, ends every session and tells the person', async () => {
    const token = tokenIn(resetMails('editor@example.com')[0]!);
    const one = new Client(s.base), two = new Client(s.base);
    for (const c of [one, two]) assert.equal((await c.post('/api/auth/sign-in', { email: 'editor@example.com', password: PASSWORD })).status, 200);
    const page = new Client(s.base);
    assert.deepEqual((await page.post('/api/auth/reset/' + token, { password: 'short', confirm: 'short' })).data, { error: 'Use a password of at least 12 characters.' });
    assert.deepEqual((await page.post('/api/auth/reset/' + token, { password: NEW, confirm: NEW + 'x' })).data, { error: 'The two passwords are not the same.' });
    assert.equal((await one.get('/api/auth/me')).status, 200, 'a refused attempt changes nothing');

    const done = await page.post('/api/auth/reset/' + token, { password: NEW, confirm: NEW });
    assert.deepEqual([done.status, done.data], [200, { ok: true, email: 'editor@example.com' }]);
    assert.equal(page.cookie, '', 'the link sets the password; it does not sign in');
    for (const c of [one, two]) assert.equal((await c.get('/api/auth/me')).status, 401);
    assert.equal((s.db().prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(Number(idOf('editor@example.com'))) as { n: number }).n, 0);
    assert.equal((await signIn('editor@example.com', PASSWORD)).status, 401);
    assert.equal((await signIn('editor@example.com', NEW)).status, 200);

    /* Once only. */
    const again = await page.post('/api/auth/reset/' + token, { password: NEW + ' again', confirm: NEW + ' again' });
    assert.equal(again.status, 404);
    assert.equal((await page.get('/api/auth/reset/' + token)).status, 404);
    assert.equal((await signIn('editor@example.com', NEW)).status, 200);
    assert.deepEqual(rows('editor@example.com'), []);

    await until('the confirmation email', async () => mailsTo('editor@example.com', /^Subject: Meridian: your password was changed$/m).length === 1);
    assert.match(textOf(mailsTo('editor@example.com', /your password was changed/)[0]!), /every signed-in session was signed out/);
    assert.ok((await auditActs()).includes('Eddie Editor: Set a new password with a reset link sent by email'));
    assert.ok(!s.output().includes(NEW));
  });

  it('lets only one of two requests with the same link through', async () => {
    await member(s, admin, 'viewer', 'race@example.com', 'Rae Race');
    const token = await linkFor('race@example.com');
    const [a, b] = await Promise.all([
      new Client(s.base).post('/api/auth/reset/' + token, { password: NEW + ' one', confirm: NEW + ' one' }),
      new Client(s.base).post('/api/auth/reset/' + token, { password: NEW + ' two', confirm: NEW + ' two' }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 404]);
    const winner = a.status === 200 ? NEW + ' one' : NEW + ' two', loser = a.status === 200 ? NEW + ' two' : NEW + ' one';
    assert.equal((await signIn('race@example.com', winner)).status, 200);
    assert.equal((await signIn('race@example.com', loser)).status, 401);
  });

  it('stops working after 30 minutes', async () => {
    await member(s, admin, 'viewer', 'late@example.com', 'Lena Late');
    const token = await linkFor('late@example.com');
    s.db().prepare('UPDATE password_resets SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, sha256(token));
    assert.equal((await new Client(s.base).get('/api/auth/reset/' + token)).status, 404);
    assert.equal((await new Client(s.base).post('/api/auth/reset/' + token, { password: NEW, confirm: NEW })).status, 404);
    assert.equal((await signIn('late@example.com', PASSWORD)).status, 200);
  });

  it('leaves 2-step verification on: the new password alone does not sign in', async () => {
    const c = await member(s, admin, 'editor', 'twostep@example.com', 'Tia Twostep');
    const secret = (await c.post('/api/auth/2fa/setup')).data.secret as string;
    assert.equal((await c.post('/api/auth/2fa/enable', { code: codeAt(secret, stepAt(Date.now())) })).status, 200);
    const token = await linkFor('twostep@example.com');
    assert.equal((await new Client(s.base).post('/api/auth/reset/' + token, { password: NEW, confirm: NEW })).status, 200);
    const step1 = await signIn('twostep@example.com', NEW);
    assert.equal(step1.status, 200);
    assert.equal(step1.data.twofa, true);
    assert.equal(step1.cookie, '');
    assert.equal(step1.data.me, undefined);
  });

  it('lifts a sign-in lock from wrong passwords, since the person proved the mailbox is theirs', async () => {
    await member(s, admin, 'viewer', 'locked@example.com', 'Lou Locked');
    for (let i = 0; i < 5; i++) await signIn('locked@example.com', 'wrong password ' + i);
    assert.equal((await signIn('locked@example.com', PASSWORD)).status, 429);
    const token = await linkFor('locked@example.com');
    assert.equal((await new Client(s.base).post('/api/auth/reset/' + token, { password: NEW, confirm: NEW })).status, 200);
    assert.equal((await signIn('locked@example.com', NEW)).status, 200);
  });

  it('sends nothing to a disabled account, and a link made before stops working while it is disabled', async () => {
    await member(s, admin, 'viewer', 'off@example.com', 'Olly Off');
    const token = await linkFor('off@example.com');
    assert.equal((await admin.patch('/api/users/' + idOf('off@example.com'), { disabled: true })).status, 200);
    assert.deepEqual((await ask('off@example.com')).data, ASKED);
    await pause(200);
    assert.equal(resetMails('off@example.com').length, 1);
    assert.equal((await new Client(s.base).post('/api/auth/reset/' + token, { password: NEW, confirm: NEW })).status, 404);
  });
});

describe('limits on reset emails', () => {
  it('send a few per account, drop the rest silently, and never cancel a link already sent', async () => {
    await member(s, admin, 'viewer', 'flood@example.com', 'Flo Flood');
    const first = await linkFor('flood@example.com');
    const answers = await Promise.all(Array.from({ length: 6 }, () => ask('flood@example.com')));
    for (const r of answers) assert.deepEqual([r.status, r.data], [200, ASKED]);
    await until('the allowed emails', async () => resetMails('flood@example.com').length === PER_ACCOUNT_BURST);
    await pause(250);
    assert.equal(resetMails('flood@example.com').length, PER_ACCOUNT_BURST);
    assert.equal(rows('flood@example.com').length, PER_ACCOUNT_BURST);
    /* Someone else flooding the form cannot take the person's own link away, nor anyone else's allowance. */
    assert.equal((await new Client(s.base).get('/api/auth/reset/' + first)).status, 200);
    const other = await member(s, admin, 'viewer', 'calm@example.com', 'Cal Calm');
    assert.equal((await other.get('/api/auth/me')).status, 200);
    await linkFor('calm@example.com');
    assert.equal((await new Client(s.base).post('/api/auth/reset/' + first, { password: NEW, confirm: NEW })).status, 200);
    assert.deepEqual(rows('flood@example.com'), [], 'using one link cancels the others');
  });

  it('do not count requests for addresses without an account', async () => {
    for (let i = 0; i < 40; i++) assert.equal((await ask(`ghost${i}@example.com`)).status, 200);
    await member(s, admin, 'viewer', 'real@example.com', 'Rea Real');
    await linkFor('real@example.com');
  });
});

describe('a reset link from an admin', () => {
  let editorId = '';
  it('is made in Team for another person, shown once, and replaces an earlier one', async () => {
    editorId = idOf('editor@example.com');
    const first = await admin.post(`/api/users/${editorId}/reset-link`);
    assert.equal(first.status, 201);
    assert.match(String(first.data.link), new RegExp(`^http://localhost:${s.port}/reset/[A-Za-z0-9_-]{43}$`));
    assert.equal(first.data.minutes, RESET_MINUTES);
    const second = await admin.post(`/api/users/${editorId}/reset-link`);
    const [t1, t2] = [first, second].map(r => String(r.data.link).split('/reset/')[1]!);
    assert.equal((await new Client(s.base).get('/api/auth/reset/' + t1)).status, 404);
    assert.equal((await new Client(s.base).get('/api/auth/reset/' + t2)).status, 200);
    const [row] = rows('editor@example.com');
    assert.equal(row!.token_hash, sha256(t2!));
    assert.equal(row!.created_by, 1);
    assert.ok(!JSON.stringify(await admin.get('/api/users')).includes(t2!));
    assert.ok((await auditActs()).includes('Owner Person: Made a password reset link for editor@example.com'));

    assert.equal((await new Client(s.base).post('/api/auth/reset/' + t2, { password: PASSWORD, confirm: PASSWORD })).status, 200);
    assert.equal((await signIn('editor@example.com', PASSWORD)).status, 200);
    assert.ok((await auditActs()).includes('Eddie Editor: Set a new password with a reset link from an admin'));
  });

  it('is for admins only, never for yourself, and not for a disabled or unknown person', async () => {
    const editor = new Client(s.base);
    await editor.post('/api/auth/sign-in', { email: 'editor@example.com', password: PASSWORD });
    assert.equal((await editor.post('/api/users/1/reset-link')).status, 403);
    assert.equal((await new Client(s.base).post('/api/users/1/reset-link')).status, 401);
    const self = await admin.post('/api/users/1/reset-link');
    assert.equal(self.status, 409);
    assert.match(String(self.data.error), /^You cannot make a reset link for yourself\./);
    assert.equal((await admin.post(`/api/users/${idOf('off@example.com')}/reset-link`)).status, 409);
    assert.equal((await admin.post('/api/users/9999/reset-link')).status, 404);
    assert.equal((await admin.get(`/api/users/${editorId}/reset-link`)).status, 405);
  });

  it('stops working when the person changes their password themselves', async () => {
    const link = String((await admin.post(`/api/users/${editorId}/reset-link`)).data.link).split('/reset/')[1]!;
    const editor = new Client(s.base);
    await editor.post('/api/auth/sign-in', { email: 'editor@example.com', password: PASSWORD });
    assert.equal((await editor.post('/api/auth/password', { current: PASSWORD, next: NEW, confirm: NEW })).status, 200);
    assert.equal((await new Client(s.base).get('/api/auth/reset/' + link)).status, 404);
    assert.equal((await editor.post('/api/auth/password', { current: NEW, next: PASSWORD, confirm: PASSWORD })).status, 200);
  });
});

describe('everyone\'s sessions, for admins', () => {
  type Sess = { id: string; userId: string; device: string; created: number; lastSeen: number; current: boolean };
  const list = async () => (await admin.get('/api/sessions')).data.sessions as Sess[];
  const editorSignIn = async (ua: string) => {
    const c = new Client(s.base);
    assert.equal((await c.post('/api/auth/sign-in', { email: 'editor@example.com', password: PASSWORD }, { 'user-agent': ua })).status, 200);
    return c;
  };
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';

  it('lists who is signed in where, without any token, to admins only', async () => {
    const editorId = idOf('editor@example.com');
    s.db().prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(editorId));
    const chrome = await editorSignIn(CHROME);
    await editorSignIn(FIREFOX);
    const all = await list();
    assert.deepEqual(all.filter(x => x.userId === editorId).map(x => x.device).sort(), ['Chrome on macOS', 'Firefox on Windows']);
    assert.equal(all.filter(x => x.current).length, 1);
    assert.equal(all.find(x => x.current)!.userId, '1');
    assert.deepEqual(Object.keys(all[0]!).sort(), ['created', 'current', 'device', 'id', 'lastSeen', 'userId']);
    assert.equal((await chrome.get('/api/sessions')).status, 403);
    assert.equal((await chrome.del('/api/sessions/' + all.find(x => x.current)!.id)).status, 403);
    assert.equal((await chrome.post('/api/users/1/sign-out')).status, 403);
    assert.equal((await admin.get('/api/auth/me')).status, 200);
  });

  it('signs out one session of a person, and that browser is out at once', async () => {
    const editorId = idOf('editor@example.com');
    s.db().prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(editorId));
    const chrome = await editorSignIn(CHROME), firefox = await editorSignIn(FIREFOX);
    const target = (await list()).find(x => x.userId === editorId && x.device === 'Firefox on Windows')!;
    assert.equal((await admin.del('/api/sessions/' + target.id)).status, 200);
    assert.equal((await firefox.get('/api/auth/me')).status, 401);
    assert.equal((await chrome.get('/api/auth/me')).status, 200);
    assert.equal((await admin.del('/api/sessions/' + target.id)).status, 404);
    assert.ok((await auditActs()).includes('Owner Person: Signed out editor@example.com on Firefox on Windows'));
  });

  it('signs a person out everywhere; for yourself, everywhere but this browser', async () => {
    const editorId = idOf('editor@example.com');
    const a = await editorSignIn(CHROME), b = await editorSignIn(FIREFOX);
    const r = await admin.post(`/api/users/${editorId}/sign-out`);
    assert.equal(r.status, 200);
    assert.ok(Number(r.data.ended) >= 2);
    for (const c of [a, b]) assert.equal((await c.get('/api/auth/me')).status, 401);
    assert.equal((await list()).filter(x => x.userId === editorId).length, 0);
    assert.ok((await auditActs()).some(x => /^Owner Person: Signed out editor@example\.com everywhere \(\d+ sessions?\)$/.test(x)));
    assert.deepEqual((await admin.post(`/api/users/${editorId}/sign-out`)).data, { ended: 0 });

    const elsewhere = new Client(s.base);
    await elsewhere.post('/api/auth/sign-in', { email: 'owner@example.com', password: PASSWORD });
    const mine = await admin.post('/api/users/1/sign-out');
    assert.ok(Number(mine.data.ended) >= 1);
    assert.equal((await elsewhere.get('/api/auth/me')).status, 401);
    assert.equal((await admin.get('/api/auth/me')).status, 200);
    assert.equal((await admin.post('/api/users/9999/sign-out')).status, 404);
  });
});

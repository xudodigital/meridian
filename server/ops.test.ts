// Connected services end to end against a real server and fake outside services (fixtures/fake-services.ts):
// encrypted key storage, Test connection, Slack, Telegram and email, access checks from inside a country with the
// alert they raise, DNS verification, the weekly report by email, Google sign-in with Search Console figures, and
// encrypted 2-step secrets. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mode, startFakes } from './fixtures/fake-services.ts';
import { codeAt, stepAt } from './totp.ts';
import { Client, PASSWORD, member, owner, saveSites, startServer, until, type Json, type TestServer } from './testkit.ts';

let s: TestServer, fakes: Awaited<ReturnType<typeof startFakes>>, admin: Client, editor: Client;
type View = { id: string; connected: boolean; tail: string; status: string; msg: string; config: Record<string, string> };
const ints = async (c: Client) => (await c.get('/api/integrations')).data.integrations as View[];
const int = async (c: Client, id: string) => (await ints(c)).find(x => x.id === id)!;

before(async () => {
  fakes = await startFakes();
  s = await startServer({...fakes.env, MERIDIAN_URL_OPENAI: fakes.url('openai')});
  admin = await owner(s, 'Owner Person', 'owner@example.com');
  editor = await member(s, admin, 'editor', 'editor@example.com', 'Eddie Editor');
  await saveSites(admin, [{ id: 's1', domain: 'example-vn.com', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live' } as never]);
});
after(() => { s?.stop(); fakes?.stop(); });

describe('integrations', () => {
  it('lists every service; nothing is connected but the probe network, which works without a token', async () => {
    const list = await ints(admin);
    assert.deepEqual(list.map(x => x.id), ['gemma', 'openai', 'dfs', 'serpapi', 'cf', 'probe', 'slack', 'tg', 'email', 'google', 'ads', 'gsc', 'ga4']);
    assert.deepEqual(list.filter(x => x.connected).map(x => x.id), ['probe']);
    assert.equal((await int(admin, 'probe')).tail, 'Public access');
  });

  it('stores a key encrypted, tests it for real at once, and never returns it', async () => {
    const r = await admin.put('/api/integrations/openai', { values: { key: mode.openaiKey } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.result, { status: 'ok', msg: 'Connected. The key can use 2 models.' });
    const hit = fakes.hits.find(h => h.path.startsWith('/openai/v1/models') && h.headers.authorization === 'Bearer ' + mode.openaiKey)!;
    assert.equal(hit.headers.authorization, 'Bearer ' + mode.openaiKey);
    const v = await int(admin, 'openai');
    assert.equal(v.tail, '1234');
    assert.equal(v.status, 'ok');
    assert.ok(!JSON.stringify(await admin.get('/api/integrations')).includes(mode.openaiKey));
    assert.ok(!JSON.stringify(await admin.get('/api/state')).includes(mode.openaiKey));
    const row = s.db().prepare(`SELECT secret FROM integrations WHERE id = 'openai'`).get() as { secret: string };
    assert.match(row.secret, /^v1\./);
    assert.ok(!row.secret.includes(mode.openaiKey));
    assert.match(s.output(), /^(?![\s\S]*sk-test-good)/, 'the key is never printed');
  });

  it('says so when the service refuses the key', async () => {
    const r = await admin.put('/api/integrations/openai', { values: { key: 'sk-test-wrong-key-999' } });
    assert.deepEqual(r.data.result, { status: 'bad', msg: 'OpenAI refused the key: Invalid API key' });
    assert.equal((await int(admin, 'openai')).tail, 'y-999'.slice(-4));
  });

  it('is for admins only; others see what is connected, not how', async () => {
    assert.equal((await editor.put('/api/integrations/openai', { values: { key: 'sk-test-something-long' } })).status, 403);
    assert.equal((await editor.post('/api/integrations/openai/test')).status, 403);
    assert.equal((await editor.del('/api/integrations/openai')).status, 403);
    await admin.put('/api/integrations/tg', { values: { token: '123456:good-token', chat: '-100555' } });
    assert.deepEqual((await int(editor, 'tg')).config, {});
    assert.deepEqual((await int(admin, 'tg')).config, { chat: '-100555' });
  });

  it('checks the form: a required field, a URL, an empty save', async () => {
    assert.equal((await admin.put('/api/integrations/dfs', { values: { login: 'me@example.com' } })).data.error, 'Enter the API password.');
    assert.equal((await admin.put('/api/integrations/slack', { values: { webhook: 'not a url' } })).data.error, 'Incoming webhook URL must be a full URL.');
    assert.equal((await admin.put('/api/integrations/slack', { values: {} })).data.error, 'Enter the incoming webhook URL.');
    assert.equal((await admin.put('/api/integrations/tg', { values: {} })).data.error, 'Enter the values to save.');
    assert.equal((await admin.put('/api/integrations/nope', { values: {} })).status, 404);
  });

  it('posts a real test message to Slack and Telegram', async () => {
    const sl = await admin.put('/api/integrations/slack', { values: { webhook: fakes.url('slack/hook') } });
    assert.deepEqual(sl.data.result, { status: 'ok', msg: 'Connected. A test message was posted to the channel.' });
    assert.match(fakes.hits.find(h => h.path === '/slack/hook')!.body, /Meridian test: alerts will arrive here\. Sent by Owner Person\./);
    const tg = await admin.post('/api/integrations/tg/test');
    assert.deepEqual(tg.data.result, { status: 'ok', msg: 'Connected. A test message was sent to "Meridian alerts".' });
    const sent = JSON.parse(fakes.hits.filter(h => h.path.endsWith('/sendMessage')).at(-1)!.body) as { chat_id: string; text: string };
    assert.equal(sent.chat_id, '-100555');
    /* A webhook that Slack no longer knows. */
    const gone = await admin.put('/api/integrations/slack', { values: { webhook: fakes.url('slack/gone') } });
    assert.equal(gone.data.result && (gone.data.result as Json).status, 'bad');
    await admin.put('/api/integrations/slack', { values: { webhook: fakes.url('slack/hook') } });
  });

  it('sends a real test email over SMTP, and explains a refused password', async () => {
    const values = { host: '127.0.0.1', port: String(fakes.smtpPort), user: 'mailer@example.com', pass: 'wrong-pass', from: 'meridian@example.com' };
    const bad = await admin.put('/api/integrations/email', { values });
    assert.deepEqual(bad.data.result, { status: 'bad', msg: 'The email server refused the user name or password. For Gmail, use an app password.' });
    const ok = await admin.put('/api/integrations/email', { values: { pass: mode.smtpPass } });
    assert.deepEqual(ok.data.result, { status: 'ok', msg: 'Connected. A test email was sent to owner@example.com.' });
    const mail = fakes.mails.at(-1)!;
    assert.deepEqual([mail.from, mail.to, mail.user], ['meridian@example.com', ['owner@example.com'], 'mailer@example.com']);
    assert.match(mail.data, /^Subject: Meridian test email$/m);
    assert.equal((await int(admin, 'email')).tail, 'meridian@example.com');
  });

  it('removes a service', async () => {
    await admin.put('/api/integrations/openai', { values: { key: mode.openaiKey } });
    assert.equal((await admin.del('/api/integrations/openai')).status, 200);
    assert.equal((await int(admin, 'openai')).connected, false);
    assert.equal((await admin.del('/api/integrations/openai')).status, 404);
    const audit = (await admin.get('/api/workspace')).data.audit as { act: string }[];
    assert.ok(audit.some(a => a.act === 'Removed OpenAI API'));
    assert.ok(audit.some(a => a.act === 'Saved the Slack webhook'));
  });
});

describe('access checks', () => {
  const latest = async () => ((await admin.get('/api/access')).data.access as { siteId: string; result: string; dns: string; http: string; summary: string; probes: unknown[] }[])[0];

  it('finds a block from inside the country, and alerts by Slack and email', async () => {
    const before = fakes.hits.filter(h => h.path === '/slack/hook').length;
    const r = await editor.post('/api/sites/s1/check');
    assert.equal(r.status, 202);
    const c = await until('the check', async () => latest());
    assert.equal(c.result, 'blocked');
    assert.equal(c.dns, 'Different');
    assert.equal(c.http, 'Timeout');
    assert.match(c.summary, /^Opens from outside the country but not from 2 networks in Vietnam \(Timeout, DNS answers differ\)\. This is the pattern of an ISP or DNS block\.$/);
    assert.equal(c.probes.length, 2);
    const posted = JSON.parse(fakes.hits.find(h => h.path === '/globalping/v1/measurements' && h.body.includes('"dns"'))!.body) as { locations: unknown };
    assert.equal(posted.locations, 'm-http', 'the DNS lookup runs on the same probes');
    /* Default alert table: a blocked domain goes to In-app, Email and Slack. */
    await until('the Slack alert', async () => fakes.hits.filter(h => h.path === '/slack/hook').length > before);
    assert.match(fakes.hits.filter(h => h.path === '/slack/hook').at(-1)!.body, /example-vn\.com is blocked in Vietnam/);
    await until('the email alert', async () => fakes.mails.some(m => m.data.includes('blocked in Vietnam') && m.to.includes('editor@example.com')));
  });

  it('does not alert again for the same problem, and records an ok check', async () => {
    const n = fakes.hits.filter(h => h.path === '/slack/hook').length;
    await editor.post('/api/sites/s1/check');
    await until('the second check', async () => (s.db().prepare('SELECT COUNT(*) AS n FROM access_checks').get() as { n: number }).n === 2);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(fakes.hits.filter(h => h.path === '/slack/hook').length, n);
    mode.probes = 'ok';
    await editor.post('/api/sites/s1/check');
    const c = await until('an ok check', async () => { const x = await latest(); return x?.result === 'ok' ? x : null; });
    assert.equal(c.summary, 'Opens normally from 2 networks in Vietnam.');
    assert.equal(c.dns, 'Normal');
  });

  it('tells a probe that timed out from a network that blocks', async () => {
    const count = () => (s.db().prepare('SELECT COUNT(*) AS n FROM access_checks').get() as { n: number }).n;
    let n = count();
    mode.probes = 'partial';
    await editor.post('/api/sites/s1/check');
    await until('the partial check', async () => count() > n);
    let c = (await latest())!;
    assert.equal(c.result, 'ok');
    assert.equal(c.http, '1 of 2 OK');
    assert.equal(c.summary, 'Opens on 1 of 2 networks in Vietnam. Net 45899 (Timeout) failed without a sign of blocking, which is usually the probe itself.');
    n = count();
    mode.probes = 'partial-dns';
    await editor.post('/api/sites/s1/check');
    await until('the second partial check', async () => count() > n);
    c = (await latest())!;
    assert.equal(c.result, 'blocked');
    assert.equal(c.dns, 'Different on 1 of 2');
    assert.equal(c.summary, 'Blocked on some networks in Vietnam: Net 45899 (Timeout, DNS Private IP 10.10.34.35). Other networks open it.');
    mode.probes = 'ok';
  });

  it('says when no probe is online, and refuses viewers and unknown sites', async () => {
    mode.probes = 'none';
    await editor.post('/api/sites/s1/check');
    const c = await until('the failed check', async () => { const x = await latest(); return x?.result === 'error' ? x : null; });
    assert.equal(c.summary, 'No probe is online in that country right now. Try again later.');
    mode.probes = 'ok';
    assert.equal((await editor.post('/api/sites/zzz/check')).status, 404);
    const viewer = await member(s, admin, 'viewer', 'viewer@example.com', 'Vera Viewer');
    assert.equal((await viewer.post('/api/sites/s1/check')).status, 403);
  });
});

describe('DNS verification', () => {
  it('asks for a TXT record and verifies it on public DNS', async () => {
    const v = ((await admin.get('/api/access')).data.verify as { siteId: string; host: string; value: string; verifiedAt: number | null }[])[0]!;
    assert.equal(v.host, '_meridian.example-vn.com');
    assert.match(v.value, /^meridian-verify=[0-9a-f]{32}$/);
    assert.equal(v.verifiedAt, null);
    const no = await editor.post('/api/sites/s1/verify');
    assert.equal(no.status, 409);
    assert.match(String(no.data.error), /^No TXT record at _meridian\.example-vn\.com yet\./);
    mode.txt.set('_meridian.example-vn.com', 'meridian-verify=wrong');
    assert.match(String((await editor.post('/api/sites/s1/verify')).data.error), /has a TXT record, but not the value Meridian asked for/);
    mode.txt.set('_meridian.example-vn.com', v.value);
    const ok = await editor.post('/api/sites/s1/verify');
    assert.equal(ok.status, 200);
    assert.ok(((ok.data.verify as Json) as { verifiedAt: number }).verifiedAt > 0);
  });
});

describe('weekly report', () => {
  it('needs recipients, then emails the report with a CSV', async () => {
    const r = await admin.get('/api/report');
    const rows = (r.data.report as { rows: { site: string; issue: string; clicks: number | null }[] }).rows;
    assert.deepEqual(rows.map(x => [x.site, x.clicks]), [['example-vn.com', null]]);
    assert.equal((await admin.post('/api/reports/send')).data.error, 'Add at least one recipient under Scheduled delivery.');
    const cur = await admin.get('/api/workspace');
    const version = ((cur.data.docs as Record<string, { version: number }>).settings ?? { version: 0 }).version;
    await admin.put('/api/workspace/docs/settings', { version, data: { repTo: 'boss@example.com, team@example.com', repOn: false, budget: 25 } });
    const sent = await editor.post('/api/reports/send');
    assert.deepEqual(sent.data.to, ['boss@example.com', 'team@example.com']);
    const mail = fakes.mails.at(-1)!;
    assert.deepEqual(mail.to, ['boss@example.com', 'team@example.com']);
    assert.match(mail.data, /Content-Disposition: attachment; filename="meridian-report-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.ok(((await admin.get('/api/report')).data.report as { lastSent: { to: string[] } }).lastSent.to.length === 2);
  });
});

describe('Google sign-in', () => {
  it('connects Search Console through Google, renews the token, and reads clicks per site', async () => {
    assert.equal((await admin.post('/api/oauth/google/start', { kind: 'gsc' })).status, 409);
    await admin.put('/api/integrations/google', { values: { clientId: '1234-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret-value' } });
    const start = await admin.post('/api/oauth/google/start', { kind: 'gsc' });
    const url = new URL(String(start.data.url));
    assert.equal(url.pathname, '/google-auth/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.match(String(url.searchParams.get('redirect_uri')), /^http:\/\/localhost:\d+\/api\/oauth\/google\/callback$/);
    assert.match(String(url.searchParams.get('scope')), /webmasters\.readonly/);
    const state = url.searchParams.get('state')!;
    /* Google sends the browser back without our cookie or header: the state is what counts. */
    const back = await fetch(`${s.base}/api/oauth/google/callback?code=good-code&state=${state}`, { redirect: 'manual' });
    assert.equal(back.status, 302);
    assert.equal(back.headers.get('location'), '/integrations');
    const g = await int(admin, 'gsc');
    assert.equal(g.status, 'ok');
    assert.equal(g.msg, 'Connected as seo@example.com. 1 property can be read.');
    /* A state is used once. */
    assert.equal((await fetch(`${s.base}/api/oauth/google/callback?code=good-code&state=${state}`, { redirect: 'manual' })).status, 302);
    assert.equal((await int(admin, 'gsc')).status, 'ok');
    const m = await until('the figures', async () => (await admin.get('/api/state')).data.metrics as { sites: Record<string, { clicks28: number; clicks7: number; position28: number }> } | null);
    assert.deepEqual(m.sites.s1 && [m.sites.s1.clicks28, m.sites.s1.clicks7, m.sites.s1.position28], [280, 70, 12.3]);
    const row = s.db().prepare(`SELECT secret, config FROM integrations WHERE id = 'gsc'`).get() as { secret: string; config: string };
    assert.ok(!row.secret.includes('ref-1') && !row.config.includes('ref-1'));
    assert.equal(((await admin.get('/api/report')).data.report as { rows: { clicks: number }[] }).rows[0]!.clicks, 70);
  });
});

describe('2-step secrets', () => {
  it('are stored encrypted and still accept codes', async () => {
    const c = new Client(s.base);
    await c.post('/api/auth/sign-in', { email: 'editor@example.com', password: PASSWORD });
    const secret = (await c.post('/api/auth/2fa/setup')).data.secret as string;
    const pending = s.db().prepare(`SELECT totp_pending FROM users WHERE email = 'editor@example.com'`).get() as { totp_pending: string };
    assert.match(pending.totp_pending, /^v1\./);
    assert.equal((await c.post('/api/auth/2fa/enable', { code: codeAt(secret, stepAt(Date.now())) })).status, 200);
    const on = s.db().prepare(`SELECT totp_secret FROM users WHERE email = 'editor@example.com'`).get() as { totp_secret: string };
    assert.match(on.totp_secret, /^v1\./);
    assert.ok(!on.totp_secret.includes(secret));
  });
});

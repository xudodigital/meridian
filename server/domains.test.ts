// End-to-end tests of custom domains (domains.ts): a real server, the fake Claude Code CLI and the fake Cloudflare
// (fixtures/fake-cloudflare.ts: Pages domains, zones, DNS records, and the site answering over HTTPS). Each site is
// built, approved and deployed, then its domain is followed through every branch: zone in the account, zone
// elsewhere, a token without DNS permission, a record someone else made, validation errors, and a restart while
// Cloudflare is still validating. The fake records every delete and every change to a record Meridian did not create
// in `cf.problems`, which must stay empty. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { CF_ACCOUNT, CF_TOKEN, cf, record, zone } from './fixtures/fake-cloudflare.ts';
import { mode, startFakes } from './fixtures/fake-services.ts';
import { Client, events, member, owner, saveSites, startServer, until, type Json, type TestServer } from './testkit.ts';

type Build = Json & { id: number; siteId: string; version: number; status: string; review: string; deploy: string; deployUrl: string; deployError: string; error: string };
type Domain = Json & {
  siteId: string; domain: string; project: string; status: string; problem: string; message: string; cfStatus: string; method: string;
  txt: { name: string; value: string } | null; dnsBy: string; record: { type: string; name: string; content: string; proxied: boolean } | null;
  pagesUrl: string; checkedAt: number | null; nextCheckAt: number | null; liveAt: number | null; updatedAt: number;
};

const SITES = [
  { id: 'a', domain: 'www.kopia.example' }, { id: 'b', domain: 'kopib.example' }, { id: 'c', domain: 'www.kopic.example' },
  { id: 'd', domain: 'kopid.example' }, { id: 'e', domain: 'kopie.example' }, { id: 'f', domain: 'kopif.example' },
].map(x => ({ ...x, country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'build' }));
const OTHER_ACCOUNT = 'f'.repeat(32);

let fakes: Awaited<ReturnType<typeof startFakes>>;
let s: TestServer;
let admin: Client, reviewer: Client, viewer: Client;
let articleId = 0;

const builds = async () => ((await admin.get('/api/builds')).data.builds ?? []) as Build[];
const buildIs = (id: number, test: (b: Build) => boolean, what: string) =>
  until(`build ${id} ${what}`, async () => { const b = (await builds()).find(x => x.id === id); return b && test(b) ? b : null; }, 30_000);
const domains = async (c: Client = admin) => ((await c.get('/api/domains')).data.domains ?? []) as Domain[];
const domainOf = async (siteId: string) => (await domains()).find(d => d.siteId === siteId);
const domainIs = (siteId: string, test: (d: Domain) => boolean, what: string) =>
  until(`the domain of ${siteId} ${what}`, async () => { const d = await domainOf(siteId); return d && test(d) ? d : null; }, 20_000);
const check = async (siteId: string, c: Client = admin) => c.post(`/api/sites/${siteId}/domain/check`);
const checked = async (siteId: string): Promise<Domain> => {
  const r = await check(siteId);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.domain as Domain;
};
const siteStatus = async (id: string) => {
  const docs = (await admin.get('/api/workspace')).data.docs as Record<string, { data: Json[] }>;
  return docs.sites!.data.find(x => x.id === id)?.status;
};
const audit = async () => ((await admin.get('/api/audit')).data.audit as Json[]).map(a => `${String(a.actor)}: ${String(a.act)}`);
const cfCalls = (methodName: string, part: string) => fakes.hits.filter(h => h.method === methodName && h.path.startsWith('/cloudflare/') && h.path.includes(part));
const recordsAt = (name: string) => cf.records.filter(r => r.name === name);

/** The approved article of site a, copied to another site, so that site has something to build. */
function copyArticle(siteId: string, domain: string): void {
  const db = s.db();
  const row = { ...(db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as Record<string, unknown>) };
  delete row.id;
  row.site_id = siteId; row.domain = domain;
  const cols = Object.keys(row);
  const info = db.prepare(`INSERT INTO articles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => row[c] as string | number | null));
  db.prepare(`INSERT INTO article_events (article_id, at, actor, action) VALUES (?, ?, 'Owner', 'approved')`).run(Number(info.lastInsertRowid), Date.now());
}
/** Builds the site, approves the build and waits until it is live on Cloudflare Pages. */
async function deploy(siteId: string): Promise<Build> {
  const r = await admin.post(`/api/sites/${siteId}/builds`);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const b = await buildIs((r.data.build as Build).id, x => x.status === 'ready' || x.status === 'failed', 'to finish');
  assert.equal(b.status, 'ready', b.error);
  const ok = await admin.post(`/api/builds/${b.id}/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const live = await buildIs(b.id, x => x.deploy === 'live' || x.deploy === 'failed', 'to be deployed');
  assert.equal(live.deploy, 'live', live.deployError);
  return live;
}

before(async () => {
  fakes = await startFakes();
  mode.probes = 'ok';
  s = await startServer(fakes.env);
  admin = await owner(s, 'Owner');
  await saveSites(admin, SITES as never);
  reviewer = await member(s, admin, 'reviewer', 'rina@example.com', 'Rina', 'a');
  viewer = await member(s, admin, 'viewer', 'vic@example.com', 'Vic');
  const saved = await admin.put('/api/integrations/cf', { values: { token: CF_TOKEN, account: CF_ACCOUNT } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  /* One article, written by the fake Content Writer, approved; the other sites get a copy of it. */
  const rq = await admin.post('/api/requests', { siteId: 'a', domain: 'www.kopia.example', country: 'Indonesia', lang: 'Indonesian', siteTopic: 'Coffee', topic: 'cold brew', goal: 'Find a topic', model: 'GPT-6 Luna' });
  const rid = (rq.data.request as Json).id as number;
  await until('research', async () => ((await admin.get('/api/state')).data.requests as Json[]).find(r => r.id === rid && r.status === 'done'));
  const ar = await admin.post('/api/articles', { siteId: 'a', domain: 'www.kopia.example', country: 'Indonesia', lang: 'Indonesian', siteTopic: 'Coffee', keyword: 'cara membuat cold brew', requestId: rid, model: 'GPT-6.1 Sol' });
  assert.equal(ar.status, 201, JSON.stringify(ar.data));
  articleId = (ar.data.article as Json).id as number;
  await until('the article', async () => {
    const a = ((await admin.get('/api/state')).data.articles as Json[]).find(x => x.id === articleId);
    const photos = (a?.photos ?? {}) as Json;
    return a?.status === 'review' && photos.status !== 'queued' && photos.status !== 'work' ? a : null;
  }, 30_000);
  assert.equal((await admin.post(`/api/articles/${articleId}/language-review`)).status, 200);
  assert.equal((await admin.post(`/api/articles/${articleId}/approve`)).status, 200);
  for (const x of SITES.slice(1)) copyArticle(x.id, x.domain);
});
after(() => { s?.stop(); fakes?.stop(); });

describe('custom domains', () => {
  it('has nothing to check before a deploy, and is not for reviewers or viewers', async () => {
    assert.deepEqual(await domains(), []);
    assert.deepEqual((await admin.get('/api/state')).data.domains, []);
    const r = await check('a');
    assert.equal(r.status, 409);
    assert.match(String(r.data.error), /Deploy the website first/);
    assert.equal((await check('nope')).status, 404);
    assert.equal((await check('a', viewer)).status, 403);
    assert.equal((await check('a', reviewer)).status, 403);
    assert.equal((await reviewer.get('/api/domains')).status, 403);
    assert.equal((await viewer.get('/api/domains')).status, 200);
    assert.deepEqual((await reviewer.get('/api/state')).data.domains, []);
    assert.equal(cfCalls('POST', '/domains').length, 0);
  });

  let v1: Build;
  it('zone in the account: attaches the domain, adds the proxied CNAME itself and waits for the certificate', async () => {
    const z = zone('kopia.example');
    /* An unrelated record in the zone, which must still be there at the end. */
    record(z, 'TXT', 'kopia.example', 'v=spf1 -all');
    cf.certPolls = 1e9;
    v1 = await deploy('a');
    assert.equal(v1.deployUrl, 'https://www-kopia-example.pages.dev');
    const d = await domainIs('a', x => x.status === 'cert', 'to wait for the certificate');
    assert.equal(d.domain, 'www.kopia.example');
    assert.equal(d.project, 'www-kopia-example');
    assert.equal(d.dnsBy, 'meridian');
    assert.equal(d.record, null, 'nothing for the person to add');
    assert.equal(d.pagesUrl, 'https://www-kopia-example.pages.dev');
    assert.match(d.message, /Cloudflare is issuing the certificate/);
    assert.ok(d.nextCheckAt, 'the background check goes on');
    assert.ok(cf.domains.has('www-kopia-example/www.kopia.example'));
    const made = recordsAt('www.kopia.example');
    assert.equal(made.length, 1);
    assert.deepEqual({ type: made[0]!.type, content: made[0]!.content, proxied: made[0]!.proxied, byApi: made[0]!.byApi },
      { type: 'CNAME', content: 'www-kopia-example.pages.dev', proxied: true, byApi: true });
    assert.match(made[0]!.comment, /Meridian/);
    assert.equal(await siteStatus('a'), 'build', 'not live before the certificate');
    const log = await audit();
    assert.ok(log.includes('Deploy & Monitor: Connected www.kopia.example to the Cloudflare Pages project www-kopia-example'), log.join('\n'));
    assert.ok(log.includes('Deploy & Monitor: Added the DNS record for www.kopia.example in Cloudflare: CNAME to www-kopia-example.pages.dev, proxied'));
    assert.equal(((await admin.get('/api/state')).data.domains as Domain[])[0]!.siteId, 'a');
    assert.deepEqual(cf.problems, []);
  });

  it('repairs the record it created, and only that one', async () => {
    const mine = recordsAt('www.kopia.example')[0]!;
    mine.content = 'old-host.example'; mine.proxied = false;
    const d = await checked('a');
    assert.equal(mine.content, 'www-kopia-example.pages.dev');
    assert.equal(mine.proxied, true);
    assert.equal(recordsAt('www.kopia.example').length, 1);
    assert.notEqual(d.status, 'error');
    assert.equal(cf.domains.get('www-kopia-example/www.kopia.example')!.retries, 1, 'Cloudflare was asked to validate again');
    const log = await audit();
    assert.ok(log.includes('Deploy & Monitor: Repaired the DNS record for www.kopia.example in Cloudflare: CNAME to www-kopia-example.pages.dev, proxied'), log.join('\n'));
    assert.ok(log.some(x => x.startsWith('Owner: Checked the domain www.kopia.example again: ')));
    assert.deepEqual(cf.problems, []);
  });

  it('goes live when Cloudflare is active and the site answers over HTTPS: the site becomes Live and gets its first access check', async () => {
    fakes.hits.length = 0;
    let live: Domain | undefined;
    const got = await events(admin, async () => {
      cf.certPolls = 2;
      live = await domainIs('a', x => x.status === 'live', 'to go live');
    }, 3000);
    assert.equal(live!.message, 'Live on https://www.kopia.example');
    assert.equal(live!.cfStatus, 'active');
    assert.equal(live!.nextCheckAt, null, 'nothing left to wait for');
    assert.ok(live!.liveAt);
    assert.ok(got.some(e => e.event === 'domain' && e.data.siteId === 'a' && e.data.status === 'live'), 'a domain event');
    const ws = got.find(e => e.event === 'workspace' && e.data.doc === 'sites');
    assert.ok(ws, 'the sites document goes to the open dashboards');
    assert.equal((ws.data.data as Json[]).find(x => x.id === 'a')?.status, 'live');
    assert.equal(await siteStatus('a'), 'live');
    assert.equal(await siteStatus('b'), 'build', 'other sites are not touched');
    assert.ok(fakes.hits.some(h => h.path === '/cloudflare-site/www.kopia.example/' && h.method === 'HEAD'), 'one HTTPS request from this computer');
    const log = await audit();
    assert.ok(log.includes('Deploy & Monitor: www.kopia.example is live on its own domain, with a certificate from Cloudflare'), log.join('\n'));
    assert.ok(log.includes('Deploy & Monitor: Set www.kopia.example to Live: it answers over HTTPS on its own domain'));
    /* The first access check from inside the country. */
    const access = await until('the first access check', async () => ((await admin.get('/api/access')).data.access as Json[]).find(x => x.siteId === 'a'));
    assert.equal(access.by, 'Deploy & Monitor');
    assert.equal(access.result, 'ok');
    await until('its audit entry', async () => (await audit()).some(x => x.startsWith('Deploy & Monitor: Access check of www.kopia.example: ')));
    /* A reviewer of the site hears nothing of the domain. */
    assert.deepEqual((await reviewer.get('/api/state')).data.domains, []);
    assert.deepEqual(cf.problems, []);
  });

  it('keeps the domain attached through a new deploy and a rollback', async () => {
    const before = (await domainOf('a'))!;
    fakes.hits.length = 0;
    const v2 = await deploy('a');
    assert.equal(v2.version, 2);
    await domainIs('a', x => (x.checkedAt ?? 0) > (before.checkedAt ?? 0), 'to be looked at after the deploy');
    const mid = (await domainOf('a'))!;
    const back = await admin.post(`/api/builds/${v1.id}/deploy`);
    assert.equal(back.status, 202, JSON.stringify(back.data));
    await buildIs(v1.id, b => b.deploy === 'live', 'to be live again');
    const d = await domainIs('a', x => (x.checkedAt ?? 0) > (mid.checkedAt ?? 0), 'to be looked at after the rollback');
    assert.equal(d.status, 'live');
    assert.equal(d.liveAt, before.liveAt);
    assert.equal(await siteStatus('a'), 'live');
    assert.equal(cfCalls('POST', '/pages/projects/www-kopia-example/domains').length, 0, 'not attached a second time');
    assert.ok(cfCalls('GET', '/pages/projects/www-kopia-example/domains/www.kopia.example').length >= 2, 'looked at after each deploy');
    assert.equal([...cf.domains.keys()].filter(k => k.startsWith('www-kopia-example/')).length, 1);
    assert.equal(cfCalls('DELETE', '').length, 0, 'nothing is ever deleted at Cloudflare');
    assert.equal(recordsAt('www.kopia.example').length, 1);
    assert.equal(recordsAt('kopia.example')[0]!.content, 'v=spf1 -all');
    assert.deepEqual(cf.problems, []);
  });

  it('zone elsewhere: shows the exact record to add, and the pages.dev address works meanwhile', async () => {
    await deploy('b');
    const d = await domainIs('b', x => x.status === 'dns', 'to wait for DNS');
    assert.equal(d.dnsBy, 'you');
    assert.equal(d.problem, '');
    assert.deepEqual(d.record, { type: 'CNAME', name: 'kopib.example', content: 'kopib-example.pages.dev', proxied: true });
    assert.match(d.message, /The DNS of kopib\.example is not in this Cloudflare account\. Add the record below where its DNS is managed, then press Check again\./);
    assert.match(d.message, /bare domain/);
    assert.equal(d.pagesUrl, 'https://kopib-example.pages.dev');
    assert.ok(d.nextCheckAt);
    assert.equal(await siteStatus('b'), 'build', 'only on pages.dev: still being set up');
    assert.equal(cf.records.filter(r => r.name === 'kopib.example').length, 0);
    /* Checking again without the record changes nothing, but asks Cloudflare to look. */
    const again = await checked('b');
    assert.equal(again.status, 'dns');
    assert.equal(cf.domains.get('kopib-example/kopib.example')!.retries, 1);
  });

  it('goes on after a restart while Cloudflare is still validating, and waits for HTTPS before it says live', async () => {
    assert.equal((await domainOf('b'))!.status, 'dns');
    await s.halt('SIGTERM');
    s = await startServer(fakes.env, s.tmp);
    for (const c of [admin, reviewer, viewer]) c.base = s.base;
    const kept = (await domainOf('b'))!;
    assert.equal(kept.status, 'dns');
    assert.ok(kept.nextCheckAt, 'still due after the restart');
    /* The person adds the record at their DNS provider; nobody presses anything. */
    cf.httpsDown.add('kopib.example');
    cf.externalDns.add('kopib.example');
    const waiting = await domainIs('b', x => x.status === 'cert' && x.problem === 'https', 'to be active without HTTPS');
    assert.match(waiting.message, /did not answer from this computer yet/);
    assert.equal(waiting.record, null);
    assert.equal(await siteStatus('b'), 'build');
    cf.httpsDown.delete('kopib.example');
    const live = await domainIs('b', x => x.status === 'live', 'to go live');
    assert.equal(live.message, 'Live on https://kopib.example');
    assert.equal(await siteStatus('b'), 'live');
    assert.equal((await domainOf('a'))!.status, 'live', 'the other site is as it was');
    assert.deepEqual(cf.problems, []);
  });

  it('token without DNS permission: says which permission is missing and shows the record, then adds it once allowed', async () => {
    const z = zone('kopic.example');
    cf.dns = 'none';
    try {
      await deploy('c');
      let d = await domainIs('c', x => x.status === 'dns', 'to wait for DNS');
      assert.equal(d.problem, 'dns-permission');
      assert.equal(d.dnsBy, 'you');
      assert.match(d.message, /The Cloudflare token may not edit the DNS of www\.kopic\.example\. Give the token Zone > Zone > Read and Zone > DNS > Edit/);
      assert.deepEqual(d.record, { type: 'CNAME', name: 'www.kopic.example', content: 'www-kopic-example.pages.dev', proxied: true });
      /* It can read the zone but not change it. */
      cf.dns = 'read';
      d = await checked('c');
      assert.equal(d.status, 'dns');
      assert.equal(d.problem, 'dns-permission');
      assert.match(d.message, /may not edit the DNS of kopic\.example/);
      assert.equal(cf.records.filter(r => r.zone === z.id).length, 0);
      /* The background check keeps the reason: it does not look at the DNS itself. */
      const later = await domainIs('c', x => (x.checkedAt ?? 0) > (d.checkedAt ?? 0), 'to be polled');
      assert.equal(later.problem, 'dns-permission');
      assert.ok(later.record);
    } finally { cf.dns = 'edit'; }
    const ok = await checked('c');
    assert.equal(ok.dnsBy, 'meridian');
    assert.equal(ok.problem, '');
    assert.equal(ok.record, null);
    assert.equal(recordsAt('www.kopic.example').length, 1);
    await domainIs('c', x => x.status === 'live', 'to go live');
    assert.deepEqual(cf.problems, []);
  });

  it('zone in another account, then a record someone else made: reports it and never touches it', async () => {
    const z = zone('kopid.example', OTHER_ACCOUNT);
    await deploy('d');
    let d = await domainIs('d', x => x.status === 'dns', 'to wait for DNS');
    assert.equal(d.problem, 'zone-other-account');
    assert.match(d.message, /kopid\.example is a zone in another Cloudflare account than the one Meridian deploys to/);
    assert.ok(d.record);
    assert.equal(cfCalls('GET', `/zones/${z.id}/dns_records`).length, 0, 'the other account\'s records are not read');

    /* Still waiting a day later: the background check stops and says so. */
    const stopped = await until('the 24 hours to pass', async () => {
      s.db().prepare(`UPDATE site_domains SET started_at = ? WHERE site_id = 'd' AND next_check_at IS NOT NULL`).run(Date.now() - 25 * 3_600_000);
      const x = await domainOf('d');
      return x?.problem === 'timeout' ? x : null;
    });
    assert.equal(stopped.nextCheckAt, null);
    assert.equal(stopped.status, 'dns');
    assert.match(stopped.message, /Meridian stopped checking after 24 hours/);

    /* The zone is in the account after all, with an A record a person made. */
    z.account = CF_ACCOUNT;
    const theirs = record(z, 'A', 'kopid.example', '203.0.113.7', true);
    record(z, 'MX', 'kopid.example', 'mail.kopid.example');
    d = await checked('d');
    assert.equal(d.status, 'error');
    assert.equal(d.problem, 'conflict');
    assert.equal(d.message, 'kopid.example already has an A record to 203.0.113.7 in Cloudflare DNS that Meridian did not create, so Meridian left it alone. Change it yourself to one proxied CNAME to kopid-example.pages.dev, or remove it, then press Check again.');
    assert.deepEqual(d.record, { type: 'CNAME', name: 'kopid.example', content: 'kopid-example.pages.dev', proxied: true });
    assert.equal(d.nextCheckAt, null, 'it stops until a person acts');
    assert.deepEqual({ type: theirs.type, content: theirs.content }, { type: 'A', content: '203.0.113.7' });
    assert.equal(cf.records.filter(r => r.zone === z.id).length, 2, 'nothing added, nothing removed');
    assert.equal(cfCalls('PATCH', '/dns_records/').filter(h => h.path.includes(theirs.id)).length, 0);
    assert.equal(await siteStatus('d'), 'build');

    /* A CNAME to somewhere else that a person made is left alone too. */
    theirs.type = 'CNAME'; theirs.content = 'other-host.example';
    d = await checked('d');
    assert.equal(d.problem, 'conflict');
    assert.match(d.message, /already has a CNAME record to other-host\.example/);
    assert.equal(theirs.content, 'other-host.example');

    /* The person points it at the site themselves: Meridian goes on, and the record stays theirs. */
    theirs.content = 'kopid-example.pages.dev';
    d = await checked('d');
    assert.notEqual(d.status, 'error');
    assert.equal(d.dnsBy, 'you');
    assert.equal(theirs.proxied, true);
    await domainIs('d', x => x.status === 'live', 'to go live');
    assert.equal(cfCalls('PATCH', '/dns_records/').filter(h => h.path.includes(theirs.id)).length, 0);
    assert.equal(cf.records.filter(r => r.zone === z.id).length, 2);
    assert.deepEqual(cf.problems, []);
  });

  it('validation errors: a CAA record and any other error in Cloudflare\'s words, with TXT validation shown', async () => {
    cf.validation = 'txt';
    cf.domainErrors.set('kopie.example', 'CAA records on kopie.example prevent the certificate authority from issuing a certificate.');
    try {
      await deploy('e');
      let d = await domainIs('e', x => x.status === 'error', 'to fail validation');
      assert.equal(d.problem, 'caa');
      assert.match(d.message, /A CAA record of kopie\.example stops Cloudflare from issuing the certificate\. Cloudflare says: CAA records on kopie\.example prevent the certificate authority from issuing a certificate\. Allow Let's Encrypt, Google Trust Services and SSL\.com/);
      assert.equal(d.nextCheckAt, null);
      assert.equal(await siteStatus('e'), 'build');

      cf.domainErrors.set('kopie.example', 'The hostname is on a banned list.');
      d = await checked('e');
      assert.equal(d.status, 'error');
      assert.equal(d.problem, 'validation');
      assert.equal(d.message, 'Cloudflare could not validate kopie.example: The hostname is on a banned list. Fix it in the Cloudflare dashboard or at the DNS provider, then press Check again.');

      /* Fixed: it waits for DNS again, and shows the TXT record Cloudflare asks for. */
      cf.domainErrors.clear();
      d = await checked('e');
      assert.equal(d.status, 'dns');
      assert.equal(d.method, 'txt');
      assert.equal(d.txt?.name, '_acme-challenge.kopie.example');
      assert.match(d.txt?.value ?? '', /^fake-txt-/);
      assert.match(d.message, /Cloudflare also asks for the TXT record below/);
      assert.ok(d.nextCheckAt);
    } finally { cf.validation = 'http'; cf.domainErrors.clear(); }
    assert.deepEqual(cf.problems, []);
  });

  it('a domain another project uses is refused in plain words; a Cloudflare that is not connected says so', async () => {
    cf.usedDomains.add('kopif.example');
    await deploy('f');
    let d = await domainIs('f', x => x.status === 'error', 'to be refused');
    assert.equal(d.problem, 'in-use');
    assert.match(d.message, /^kopif\.example is already connected to another Cloudflare Pages project \(Cloudflare says: This domain is already in use by another Pages project\)\. Remove it there/);
    assert.ok(!d.message.includes(CF_TOKEN));
    assert.equal(await siteStatus('f'), 'build');
    assert.equal(d.pagesUrl, 'https://kopif-example.pages.dev');

    /* The token loses Pages. */
    cf.usedDomains.clear();
    cf.pages = false;
    try {
      d = await checked('f');
      assert.equal(d.status, 'error');
      assert.equal(d.problem, 'permission');
      assert.match(d.message, /Account > Cloudflare Pages > Edit/);
    } finally { cf.pages = true; }
    d = await checked('f');
    assert.equal(d.status, 'dns');

    /* A site that is live stays shown as live when Cloudflare cannot be asked. */
    cf.pages = false;
    try {
      const a = await checked('a');
      assert.equal(a.status, 'live');
    } finally { cf.pages = true; }

    assert.equal((await admin.del('/api/integrations/cf')).status, 200);
    const off = await check('f');
    assert.equal(off.status, 409);
    assert.match(String(off.data.error), /Connect Cloudflare in Integrations first/);
    assert.equal(cfCalls('DELETE', '').length, 0);
    assert.deepEqual(cf.problems, []);
  });

  it('removing a site leaves its project, domain and DNS record at Cloudflare', async () => {
    const hitsBefore = fakes.hits.length;
    await saveSites(admin, SITES.filter(x => x.id !== 'c').map(x => ({ ...x, status: x.id === 'e' || x.id === 'f' ? 'build' : 'live' })) as never);
    assert.ok(!(await domains()).some(d => d.siteId === 'c'), 'its domain state is no longer shown');
    await new Promise(r => setTimeout(r, 300));
    assert.ok(cf.projects.has('www-kopic-example'));
    assert.ok(cf.domains.has('www-kopic-example/www.kopic.example'));
    assert.equal(recordsAt('www.kopic.example').length, 1);
    assert.equal(fakes.hits.slice(hitsBefore).filter(h => h.method === 'DELETE').length, 0);
    assert.deepEqual(cf.problems, []);
  });
});

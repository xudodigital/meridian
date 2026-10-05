// Deploying to Cloudflare Pages (cfpages.ts) against the fake Cloudflare (fixtures/fake-cloudflare.ts), in this process,
// and the Cloudflare "Test connection" (connectors.ts). The fake checks every key against wrangler's hash of what was
// uploaded, so `cf.problems` staying empty is part of each successful deploy. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { startFakes } from './fixtures/fake-services.ts';
import { CF_ACCOUNT, CF_TOKEN, cf, cloudflareEnv, record, resetCloudflare, zone } from './fixtures/fake-cloudflare.ts';
import {
  DNS_COMMENT, PagesError, addPagesDomain, assetHash, createCname, deployToPages, dnsRecordsAt, findZone, getPagesDomain, projectName, repairCname,
  retryPagesDomain, type DeployInput,
} from './cfpages.ts';

const tmp = mkdtempSync(join(tmpdir(), 'meridian-cf-'));
/* connectors.ts reaches the database through google.ts: point it at the temporary folder before importing it. */
process.env.MERIDIAN_DATA = join(tmp, 'data');
const { testService } = await import('./connectors.ts');
const { defOf } = await import('./integrations.ts');
let fakes: Awaited<ReturnType<typeof startFakes>>;
before(async () => {
  fakes = await startFakes();
  Object.assign(process.env, cloudflareEnv(fakes.url), { MERIDIAN_CF_POLL_MS: '1' });
});
after(() => { fakes?.stop(); rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => { resetCloudflare(); steps.length = 0; fakes.hits.length = 0; });

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const SITE: Record<string, string | Uint8Array> = {
  'index.html': '<h1>Hello</h1>',
  'kopi/index.html': '<!doctype html><title>Kopi</title><h1>Kopi Lampung</h1>',
  'tentang/index.html': '<!doctype html><title>Tentang</title><h1>Tentang kami</h1>',
  '404.html': '<!doctype html><title>404</title><h1>Tidak ditemukan</h1>',
  'assets/site.1a2b3c4d.css': 'body{margin:0}',
  'media/kopi-lampung-1a2b3c4d-960.jpg': JPEG,
  'robots.txt': 'User-agent: *\nAllow: /\n',
  'sitemap.xml': '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>',
  /* Same content and extension as robots.txt: one stored file serves both. */
  'copy.txt': 'User-agent: *\nAllow: /\n',
  '_headers': '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n',
  '.DS_Store': 'junk',
  'media/.DS_Store': 'junk',
};
const ASSETS = ['/404.html', '/assets/site.1a2b3c4d.css', '/copy.txt', '/index.html', '/kopi/index.html', '/media/kopi-lampung-1a2b3c4d-960.jpg', '/robots.txt', '/sitemap.xml', '/tentang/index.html'];

function site(files: Record<string, string | Uint8Array> = SITE): string {
  const dir = mkdtempSync(join(tmp, 'site-'));
  for (const [name, v] of Object.entries(files)) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), v); }
  return dir;
}
const steps: string[] = [];
const input = (dir: string, over: Partial<DeployInput> = {}): DeployInput =>
  ({ dir, project: 'example-vn-com', account: CF_ACCOUNT, token: CF_TOKEN, onStep: s => { steps.push(s); }, ...over });
const cfHits = () => fakes.hits.filter(h => h.path.startsWith('/cloudflare/'));
/** Rejects with a PagesError of this kind whose message matches, and never shows the token. */
const fails = (p: Promise<unknown>, problem: string, message: RegExp) => assert.rejects(p, (e: unknown) => {
  assert.ok(e instanceof PagesError, String(e));
  assert.equal(e.problem, problem, e.message);
  assert.match(e.message, message);
  assert.ok(!e.message.includes(CF_TOKEN));
  return true;
});

describe('deployToPages', () => {
  it('creates the project, uploads each file under wrangler\'s key and goes live', async () => {
    const r = await deployToPages(input(site()));
    assert.deepEqual(cf.problems, []);
    assert.equal(cf.projects.get('example-vn-com')?.production_branch, 'main');
    assert.equal(r.productionUrl, 'https://example-vn-com.pages.dev');
    assert.match(r.url, /^https:\/\/[0-9a-f]{8}\.example-vn-com\.pages\.dev$/);
    assert.equal(r.files, 9);
    assert.equal(r.uploaded, 9);
    const d = cf.deployments[0]!;
    assert.equal(r.deploymentId, d.id);
    assert.equal(d.environment, 'production');
    /* Keys start with "/"; _headers goes as its own part, .DS_Store not at all. */
    assert.deepEqual(Object.keys(d.manifest).sort(), ASSETS);
    assert.equal(d.headers, SITE._headers);
    assert.deepEqual(d.parts, ['manifest', '_headers']);
    /* Pinned keys from an independent BLAKE3 port: the fake checked the rest. */
    assert.equal(d.manifest['/index.html'], '8deb79e268ae1932009657bb3e496c87');
    assert.equal(d.manifest['/robots.txt'], '4c17b5bc571cafcb56cb7fe5e9d8ee40');
    assert.equal(d.manifest['/copy.txt'], d.manifest['/robots.txt']);
    /* Eight different contents, each uploaded once, all of them upserted. */
    const uploaded = cf.uploads.flat();
    assert.equal(uploaded.length, 8);
    assert.equal(new Set(uploaded).size, 8);
    assert.deepEqual(new Set(cf.upserts[0]), new Set(Object.values(d.manifest)));
    assert.equal(cf.assets.get(d.manifest['/assets/site.1a2b3c4d.css']!)?.contentType, 'text/css');
    assert.equal(cf.assets.get(d.manifest['/media/kopi-lampung-1a2b3c4d-960.jpg']!)?.contentType, 'image/jpeg');
    assert.equal(cf.assets.get(d.manifest['/sitemap.xml']!)?.contentType, 'application/xml');
    assert.deepEqual(steps, [
      'Reading the website files', 'Getting the Pages project example-vn-com ready', 'Creating the Pages project example-vn-com',
      'Checking which of the 9 files Cloudflare already has', 'Uploading 9 files', 'Starting the deployment', 'Waiting for Cloudflare to put it live',
    ]);
    /* The API token goes only to the account API, the upload JWT only to the asset API. */
    for (const h of cfHits()) {
      const auth = String(h.headers.authorization);
      if (h.path.includes('/pages/assets/')) assert.notEqual(auth, 'Bearer ' + CF_TOKEN);
      else assert.equal(auth, 'Bearer ' + CF_TOKEN);
    }
  });

  it('uploads only what Cloudflare does not have yet', async () => {
    const dir = site();
    await deployToPages(input(dir));
    const again = await deployToPages(input(dir));
    assert.equal(again.uploaded, 0);
    assert.equal(again.files, 9);
    assert.ok(steps.includes('All 9 files are already stored at Cloudflare'));
    assert.equal(cfHits().filter(h => h.method === 'POST' && h.path.endsWith('/pages/projects')).length, 1);
    writeFileSync(join(dir, 'kopi/index.html'), '<!doctype html><title>Kopi</title><h1>Kopi Lampung, diperbarui</h1>');
    const third = await deployToPages(input(dir));
    assert.equal(third.uploaded, 1);
    assert.ok(steps.includes('Uploading 1 file (8 already stored)'));
    assert.equal(cf.deployments.length, 3);
    assert.deepEqual(cf.problems, []);
  });

  it('deploys a branch as a preview', async () => {
    await deployToPages(input(site(), { branch: 'review-v2' }));
    const d = cf.deployments[0]!;
    assert.equal(d.environment, 'preview');
    assert.ok(d.parts.includes('branch'));
    assert.deepEqual(cf.problems, []);
  });

  it('renews a refused upload token and retries a gateway error', async () => {
    cf.refuseJwt = 1; cf.failUploads = 1;
    const r = await deployToPages(input(site()));
    assert.equal(r.uploaded, 9);
    assert.ok(cfHits().filter(h => h.path.endsWith('/upload-token')).length >= 2);
    assert.equal(cfHits().filter(h => h.path.endsWith('/pages/assets/upload')).length >= 2, true);
    assert.deepEqual(cf.problems, []);
  });

  it('renews an upload token whose expiry is near before using it', async () => {
    cf.jwtSeconds = 2;
    await deployToPages(input(site()));
    /* The first token, then one before each asset call (check-missing, three uploads, upsert). */
    assert.ok(cfHits().filter(h => h.path.endsWith('/upload-token')).length >= 4);
    assert.deepEqual(cf.problems, []);
  });

  it('waits through a queued deployment, and gives up honestly when it never finishes', async () => {
    cf.polls = 3;
    await deployToPages(input(site()));
    /* Longer than wrangler's five polls: still live, not a failure. */
    cf.polls = 12;
    const slow = await deployToPages(input(site()));
    assert.equal(slow.productionUrl, 'https://example-vn-com.pages.dev');
    cf.polls = 99;
    await fails(deployToPages(input(site())), 'deploy', /had not finished the deployment after five minutes\. Look at the project example-vn-com/);
    /* 1 + 2 + 4 + 8 + 16 units, then every 16 units up to about 300: 22 polls. */
    assert.equal(cf.deployments.at(-1)!.polls, 22);
  });

  it('reports a failed deploy stage with Cloudflare\'s reason', async () => {
    cf.outcome = 'failure';
    await fails(deployToPages(input(site())), 'deploy', /could not put the site live: The fake deploy step failed\./);
  });

  it('refuses a deployment that came back without files', async () => {
    cf.empty = true;
    await fails(deployToPages(input(site())), 'deploy', /without any files/);
  });

  it('stops at the file limit in the upload token', async () => {
    cf.maxFiles = 3;
    await fails(deployToPages(input(site())), 'files', /9 files; Cloudflare Pages takes up to 3/);
    assert.equal(cf.uploads.length, 0);
  });

  it('refuses a file over 25 MB, an empty build and a missing folder before calling Cloudflare', async () => {
    const dir = site({ 'index.html': '<h1>Hi</h1>', 'media/huge.png': '' });
    truncateSync(join(dir, 'media/huge.png'), 25 * 1024 * 1024 + 1);
    const before = cfHits().length;
    await fails(deployToPages(input(dir)), 'files', /media\/huge\.png is too large for Cloudflare Pages \(25\.1 MB; the limit is 25 MB a file\)/);
    await fails(deployToPages(input(site({ '_headers': '/*\n  X-Test: 1\n' }))), 'files', /no files to deploy/);
    await fails(deployToPages(input(join(tmp, 'no-such-build'))), 'files', /missing/);
    assert.equal(cfHits().length, before);
  });

  it('deploys a root folder named functions like any other, since a build never holds Pages Functions', async () => {
    const dir = site({ 'index.html': '<a href="functions/">Functions</a>', 'functions/index.html': '<h1>Functions</h1>', '_worker.js': 'export default {}', '_routes.json': '{}' });
    const r = await deployToPages(input(dir));
    assert.equal(r.files, 2);
    assert.deepEqual(Object.keys(cf.deployments[0]!.manifest).sort(), ['/functions/index.html', '/index.html']);
    assert.deepEqual(cf.problems, []);
  });

  it('refuses a build with pages under cdn-cgi/, which Cloudflare answers itself', async () => {
    const before = cfHits().length;
    await fails(deployToPages(input(site({ 'index.html': '<h1>Hi</h1>', 'cdn-cgi/index.html': '<h1>CDN</h1>' }))), 'files', /cdn-cgi\/, an address Cloudflare keeps for itself/);
    assert.equal(cfHits().length, before);
    /* Deeper down it is an ordinary folder. */
    await deployToPages(input(site({ 'index.html': '<h1>Hi</h1>', 'kopi/cdn-cgi/index.html': '<h1>x</h1>' })));
    assert.ok('/kopi/cdn-cgi/index.html' in cf.deployments[0]!.manifest);
  });

  it('leaves out links that could point outside the build', async () => {
    const dir = site({ 'index.html': '<h1>Hi</h1>' });
    symlinkSync('/etc/hosts', join(dir, 'hosts.txt'));
    await deployToPages(input(dir));
    assert.deepEqual(Object.keys(cf.deployments[0]!.manifest), ['/index.html']);
  });

  it('says what to fix when the account, the token or its permissions are wrong', async () => {
    const dir = site();
    await fails(deployToPages(input(dir, { account: '' })), 'account', /needs the Cloudflare Account ID/);
    await fails(deployToPages(input(dir, { account: 'my-account' })), 'account', /does not look right/);
    await fails(deployToPages(input(dir, { account: 'f'.repeat(32) })), 'permission', /Account > Cloudflare Pages > Edit/);
    await fails(deployToPages(input(dir, { token: 'cf-wrong-token-123' })), 'token', /did not accept the API token/);
    cf.pages = false;
    await fails(deployToPages(input(dir)), 'permission', /Account > Cloudflare Pages > Edit/);
    await fails(deployToPages(input(dir, { project: 'Not A Name' })), 'project', /cannot be a Pages project name/);
    await fails(deployToPages(input(dir, { project: 'ends-with-' })), 'project', /not at either end/);
  });

  it('explains a project name that is taken and a project connected to Git', async () => {
    cf.takenNames.add('example-vn-com');
    await fails(deployToPages(input(site())), 'project', /will not create a Pages project named "example-vn-com"/);
    cf.projects.set('git-site', { name: 'git-site', subdomain: 'git-site.pages.dev', production_branch: 'main', source: { type: 'github' }, created_on: '' });
    await fails(deployToPages(input(site(), { project: 'git-site' })), 'project', /connected to GitHub/);
  });

  it('stops when asked', async () => {
    const ctl = new AbortController();
    const p = deployToPages(input(site(), { signal: ctl.signal, onStep: s => { if (s.startsWith('Uploading')) ctl.abort(); } }));
    await fails(p, 'stopped', /stopped/);
    assert.equal(cf.deployments.length, 0);
  });

  it('names projects after the domain, one name per domain', () => {
    /* A plain domain reads as itself. */
    assert.equal(projectName('kopi.co.id'), 'kopi-co-id');
    assert.equal(projectName(' Kopi.CO.id '), 'kopi-co-id');
    assert.equal(projectName('s1.example'), 's1-example');
    /* Anything else gets a tag from the domain's hash, ending in a digit where a plain name ends in a letter. */
    assert.match(projectName('Example-VN.com'), /^example-vn-com-[0-9a-f]{7}[0-9]$/);
    assert.equal(projectName('Example-VN.com'), projectName('example-vn.com'));
    assert.match(projectName('...'), /^site-[0-9a-f]{7}[0-9]$/);
    const domains = ['vn.example.com', 'vn-example.com', 'vn--example.com', 'vn.example-com', 'kopi.example.id', 'kopi-example.id',
      'kopi--example.id', 'a'.repeat(57) + '.com', 'a'.repeat(57) + '.co', 'a'.repeat(80) + '.com', 'a'.repeat(81) + '.com',
      'kopi-'.repeat(11) + 'ab.example.id', 'xn--80ak6aa92e.com', '10.0.0.1', 'example.com.', 'b'.repeat(55) + '.id', 'b'.repeat(56) + '.id'];
    const names = domains.map(projectName);
    assert.equal(new Set(names).size, domains.length, names.join(' '));
    for (const n of names) assert.match(n, /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/, n);
    /* 58 characters is still plain; one more gets a tag. */
    assert.equal(projectName('b'.repeat(55) + '.id'), 'b'.repeat(55) + '-id');
    assert.match(projectName('b'.repeat(56) + '.id'), /^b{49}-[0-9a-f]{7}[0-9]$/);
  });

  it('deploys two sites whose domains differ only by a hyphen to two projects', async () => {
    const a = await deployToPages(input(site({ 'index.html': '<h1>A</h1>' }), { project: projectName('vn.example.com') }));
    const b = await deployToPages(input(site({ 'index.html': '<h1>B</h1>' }), { project: projectName('vn-example.com') }));
    assert.notEqual(a.productionUrl, b.productionUrl);
    assert.equal(cf.projects.size, 2);
    assert.notEqual(cf.deployments[0]!.project, cf.deployments[1]!.project);
    assert.deepEqual(cf.problems, []);
  });
});

describe('fake Cloudflare', () => {
  it('fails a deployment whose key is not wrangler\'s hash of the content', async () => {
    const api = fakes.url('cloudflare') + '/client/v4';
    const auth = { authorization: 'Bearer ' + CF_TOKEN, 'content-type': 'application/json' };
    await fetch(`${api}/accounts/${CF_ACCOUNT}/pages/projects`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'strict', production_branch: 'main' }) });
    const { result: { jwt } } = await (await fetch(`${api}/accounts/${CF_ACCOUNT}/pages/projects/strict/upload-token`, { headers: auth })).json() as { result: { jwt: string } };
    const value = Buffer.from('<h1>Hello</h1>').toString('base64');
    /* The right content under the key of another extension: exactly the mistake that leaves a site serving 404s. */
    const wrong = assetHash(Buffer.from('<h1>Hello</h1>'), 'index.htm');
    const up = await fetch(`${api}/pages/assets/upload`, { method: 'POST', headers: { authorization: 'Bearer ' + jwt, 'content-type': 'application/json' }, body: JSON.stringify([{ key: wrong, value, metadata: { contentType: 'text/html' }, base64: true }]) });
    assert.equal(up.status, 200);
    const form = new FormData();
    form.append('manifest', JSON.stringify({ '/index.html': wrong }));
    const dep = await fetch(`${api}/accounts/${CF_ACCOUNT}/pages/projects/strict/deployments`, { method: 'POST', headers: { authorization: 'Bearer ' + CF_TOKEN }, body: form });
    assert.equal(dep.status, 400);
    assert.match(cf.problems[0] ?? '', /\/index\.html has key .* hash to 8deb79e268ae1932009657bb3e496c87/);
  });
});

describe('Cloudflare test connection', () => {
  const ctx = { by: 'Test Person', email: 'owner@example.com' };
  const test = (v: Record<string, string>) => testService('cf', v, ctx);

  it('says Pages deploys will work when the token reaches Pages in the account', async () => {
    const r = await test({ token: CF_TOKEN, account: CF_ACCOUNT });
    assert.equal(r.status, 'ok');
    assert.match(r.msg, /reach Cloudflare Pages in this account, so deploys will work\. It can see 2 zones\./);
    assert.ok(cfHits().some(h => h.path === `/cloudflare/client/v4/accounts/${CF_ACCOUNT}/pages/projects`));
  });

  it('accepts a token made under the account', async () => {
    cf.accountToken = true;
    assert.equal((await test({ token: CF_TOKEN, account: CF_ACCOUNT })).status, 'ok');
  });

  it('asks for the Account ID when it is missing', async () => {
    const r = await test({ token: CF_TOKEN });
    assert.equal(r.status, 'warn');
    assert.match(r.msg, /Add the Account ID to deploy/);
  });

  it('says deploys will not work without Pages permission or with a wrong account', async () => {
    cf.pages = false;
    const r = await test({ token: CF_TOKEN, account: CF_ACCOUNT });
    assert.equal(r.status, 'bad');
    assert.match(r.msg, /Account > Cloudflare Pages > Edit/);
    cf.pages = true;
    assert.equal((await test({ token: CF_TOKEN, account: 'f'.repeat(32) })).status, 'bad');
    assert.match((await test({ token: CF_TOKEN, account: 'not-an-id' })).msg, /does not look right/);
    assert.equal((await test({ token: 'cf-wrong-token-123', account: CF_ACCOUNT })).status, 'bad');
  });

  it('tells in the help which permissions to give and that the Account ID is needed to deploy', () => {
    const help = defOf('cf')?.help ?? '';
    assert.match(help, /Account > Cloudflare Pages > Edit/);
    assert.match(help, /Zone > Zone > Read and Zone > DNS > Edit only if you will connect custom domains/);
    assert.match(help, /shows the record to add by hand/);
    assert.match(help, /Account ID is required to deploy/);
  });
});

describe('custom domains, zones and DNS records', () => {
  const auth = { account: CF_ACCOUNT, token: CF_TOKEN };
  const project = async () => { await deployToPages(input(site())); return 'example-vn-com'; };

  it('attaches a domain to the project, reads it, retries it, and says when another project has it', async () => {
    const p = await project();
    assert.equal(await getPagesDomain(auth, p, 'example-vn.com'), null);
    const d = await addPagesDomain(auth, p, 'example-vn.com');
    assert.deepEqual({ name: d.name, status: d.status, verification: d.verification, method: d.method }, { name: 'example-vn.com', status: 'initializing', verification: 'pending', method: 'http' });
    assert.equal(d.error, 'CNAME record not set');
    const hit = cfHits().find(h => h.method === 'POST' && h.path.endsWith('/domains'))!;
    assert.deepEqual(JSON.parse(hit.body), { name: 'example-vn.com' });
    assert.equal((await getPagesDomain(auth, p, 'example-vn.com'))?.status, 'pending');
    assert.equal((await retryPagesDomain(auth, p, 'example-vn.com'))?.status, 'pending');
    assert.equal(cfHits().at(-1)!.method, 'PATCH');
    assert.equal(await retryPagesDomain(auth, p, 'not-attached.example'), null);
    cf.usedDomains.add('taken.example');
    await fails(addPagesDomain(auth, p, 'taken.example'), 'in-use', /^taken\.example is already connected to another Cloudflare Pages project/);
    cf.pages = false;
    await fails(getPagesDomain(auth, p, 'example-vn.com'), 'permission', /Cloudflare Pages > Edit/);
    await fails(addPagesDomain({ account: CF_ACCOUNT, token: 'wrong-token-value' }, p, 'x.example'), 'token', /did not accept the API token/);
    assert.deepEqual(cf.problems, []);
  });

  it('finds the zone of a domain: the longest name first, in this account, another one, or nowhere', async () => {
    assert.deepEqual(await findZone(auth, 'www.kopi.co.id'), { where: 'elsewhere' });
    assert.deepEqual(cfHits().map(h => new URL(h.path, 'http://x').searchParams.get('name')), ['www.kopi.co.id', 'kopi.co.id', 'co.id']);
    const parent = zone('kopi.co.id');
    assert.deepEqual(await findZone(auth, 'www.kopi.co.id'), { where: 'account', id: parent.id, name: 'kopi.co.id' });
    const sub = zone('www.kopi.co.id');
    assert.deepEqual(await findZone(auth, 'www.kopi.co.id'), { where: 'account', id: sub.id, name: 'www.kopi.co.id' });
    zone('other.example', 'f'.repeat(32));
    assert.deepEqual(await findZone(auth, 'shop.other.example'), { where: 'other', name: 'other.example' });
    cf.dns = 'none';
    assert.deepEqual(await findZone(auth, 'www.kopi.co.id'), { where: 'unreadable' });
    await fails(findZone({ account: CF_ACCOUNT, token: 'wrong-token-value' }, 'kopi.co.id'), 'token', /did not accept the API token/);
  });

  it('reads the records at one name, adds a proxied CNAME, and repairs only by id', async () => {
    const z = zone('kopi.example');
    record(z, 'TXT', 'kopi.example', 'v=spf1 -all');
    record(z, 'A', 'shop.kopi.example', '203.0.113.9');
    assert.deepEqual((await dnsRecordsAt(auth, z.id, 'www.kopi.example')), []);
    const made = await createCname(auth, z.id, 'www.kopi.example', 'kopi-example.pages.dev');
    assert.ok(made !== 'forbidden' && made !== 'exists');
    assert.deepEqual({ type: made.type, name: made.name, content: made.content, proxied: made.proxied, comment: made.comment },
      { type: 'CNAME', name: 'www.kopi.example', content: 'kopi-example.pages.dev', proxied: true, comment: DNS_COMMENT });
    assert.deepEqual(JSON.parse(cfHits().at(-1)!.body), { type: 'CNAME', name: 'www.kopi.example', content: 'kopi-example.pages.dev', proxied: true, ttl: 1, comment: DNS_COMMENT });
    const at = await dnsRecordsAt(auth, z.id, 'www.kopi.example');
    assert.ok(at !== 'forbidden' && at.length === 1 && at[0]!.id === made.id);
    /* A name that already has an address record: nothing is added. */
    assert.equal(await createCname(auth, z.id, 'shop.kopi.example', 'kopi-example.pages.dev'), 'exists');
    assert.equal(await createCname(auth, z.id, 'www.kopi.example', 'kopi-example.pages.dev'), 'exists');
    assert.equal(cf.records.length, 3);
    cf.records.find(r => r.id === made.id)!.content = 'elsewhere.example';
    const fixed = await repairCname(auth, z.id, made.id, 'www.kopi.example', 'kopi-example.pages.dev');
    assert.ok(fixed !== 'forbidden' && fixed.content === 'kopi-example.pages.dev');
    cf.dns = 'read';
    assert.equal(await createCname(auth, z.id, 'new.kopi.example', 'kopi-example.pages.dev'), 'forbidden');
    assert.equal(await repairCname(auth, z.id, made.id, 'www.kopi.example', 'kopi-example.pages.dev'), 'forbidden');
    assert.ok(Array.isArray(await dnsRecordsAt(auth, z.id, 'www.kopi.example')));
    cf.dns = 'none';
    assert.equal(await dnsRecordsAt(auth, z.id, 'www.kopi.example'), 'forbidden');
    assert.deepEqual(cf.problems, []);
    assert.ok(!cfHits().some(h => h.method === 'DELETE' || h.method === 'PUT'));
  });
});

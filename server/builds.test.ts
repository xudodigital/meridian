// End-to-end tests of website builds: a real server with the fake Claude Code CLI (the Site Builder's identity answer
// comes from fixtures/fake-answers/site-identity.json) and the fake Cloudflare (fixtures/fake-cloudflare.ts). An
// article is written and approved, the site is built, previewed, downloaded, approved, deployed, rolled back and
// pruned. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';
import { CF_ACCOUNT, CF_TOKEN, cf } from './fixtures/fake-cloudflare.ts';
import { startFakes } from './fixtures/fake-services.ts';
import { encodePng } from './png.ts';
import { cachedZip, zip } from './zip.ts';
import { events, member, owner, saveSites, startServer, until, type Client, type Json, type TestServer } from './testkit.ts';

type Build = Json & {
  id: number; siteId: string; version: number; status: string; step: string; error: string; review: string; reviewNote: string;
  deploy: string; deployUrl: string; deployError: string; articles: number[]; pages: number; files: number; bytes: number;
  by: string; decidedBy: string; previewPath: string; pruned: boolean; tokens: number; steps: { at: number; text: string }[];
};

let fakes: Awaited<ReturnType<typeof startFakes>>;
let s: TestServer;
let admin: Client, reviewer: Client, viewer: Client;
let articleId = 0;

const builds = async (c: Client = admin) => ((await c.get('/api/builds')).data.builds ?? []) as Build[];
const build = async (id: number) => (await builds()).find(b => b.id === id);
const buildIs = (id: number, test: (b: Build) => boolean, what: string) => until(`build ${id} ${what}`, async () => { const b = await build(id); return b && test(b) ? b : null; });
const ready = (id: number) => buildIs(id, b => b.status === 'ready' || b.status === 'failed', 'to finish');
const calls = () => existsSync(join(s.fakeDir, 'calls.jsonl'))
  ? readFileSync(join(s.fakeDir, 'calls.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { kind: string; body: Record<string, unknown> }) : [];
/** A GET with the session cookie, as a browser tab would send it; the raw answer. */
const raw = (c: Client, path: string) => fetch(s.base + path, { headers: { cookie: 'meridian_session=' + c.cookie }, redirect: 'manual' });
/** A GET whose path is sent exactly as written (fetch would resolve "..").  */
function rawPath(c: Client, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = request(s.base + '/', { path, headers: { cookie: 'meridian_session=' + c.cookie } }, res => {
      let body = ''; res.on('data', d => { body += d; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    r.on('error', reject);
    r.end();
  });
}
async function newBuild(): Promise<Build> {
  const r = await admin.post('/api/sites/s1/builds');
  assert.equal(r.status, 202, JSON.stringify(r.data));
  return ready((r.data.build as Build).id);
}
/** No deploy of any build is queued or running. */
const deploysDone = () => until('the deploys to finish', async () => !(await builds()).some(b => b.deploy === 'queued' || b.deploy === 'work'), 30_000);
/** Settings: do deploys need a person's approval? */
async function needApproval(on: boolean): Promise<void> {
  const cur = (await admin.get('/api/workspace')).data.docs as Record<string, { version: number }>;
  const put = await admin.put('/api/workspace/docs/settings', { version: cur.settings?.version ?? 0, data: { apDeploy: on } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
}
const buildFolder = (version: number) => join(s.tmp, 'data', 'sites', 's1', 'builds', String(version));
/** The compression method of one file in a ZIP (0 stored, 8 deflated), from its central directory record. */
function methodOf(buf: Buffer, name: string): number {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < buf.readUInt16LE(end + 10); i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    if (buf.subarray(p + 46, p + 46 + nameLen).toString('utf8') === name) return buf.readUInt16LE(p + 10);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  throw new Error('not in the ZIP: ' + name);
}
/** The files in a ZIP, read from its central directory and checked against their CRC-32. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end > 0, 'end of central directory');
  const n = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    assert.equal(buf.readUInt16LE(p + 8) & 0x0800, 0x0800, 'UTF-8 names');
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const packed = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(packed) : packed;
    assert.equal(crc32(data) >>> 0, crc, name);
    out.set(name, Buffer.from(data));
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

before(async () => {
  fakes = await startFakes();
  s = await startServer(fakes.env);
  admin = await owner(s, 'Owner');
  await saveSites(admin, [{ id: 's1', domain: 's1.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'build' } as never]);
  reviewer = await member(s, admin, 'reviewer', 'rina@example.com', 'Rina', 's1');
  viewer = await member(s, admin, 'viewer', 'vic@example.com', 'Vic');
  /* An article, written by the fake Content Writer and waiting for review. */
  const rq = await admin.post('/api/requests', { siteId: 's1', domain: 's1.example', country: 'Indonesia', lang: 'Indonesian', siteTopic: 'Coffee', topic: 'cold brew', goal: 'Find a topic', model: 'GPT-6 Luna' });
  const rid = (rq.data.request as Json).id as number;
  await until('research', async () => ((await admin.get('/api/state')).data.requests as Json[]).find(r => r.id === rid && r.status === 'done'));
  const ar = await admin.post('/api/articles', { siteId: 's1', domain: 's1.example', country: 'Indonesia', lang: 'Indonesian', siteTopic: 'Coffee', keyword: 'cara membuat cold brew', requestId: rid, model: 'GPT-6.1 Sol' });
  assert.equal(ar.status, 201, JSON.stringify(ar.data));
  articleId = (ar.data.article as Json).id as number;
  /* Written, and any photo job it started has finished (photos never block a review). */
  await until('the article', async () => {
    const a = ((await admin.get('/api/state')).data.articles as Json[]).find(x => x.id === articleId);
    const photos = (a?.photos ?? {}) as Json;
    return a?.status === 'review' && photos.status !== 'queued' && photos.status !== 'work' ? a : null;
  }, 30_000);
});
after(() => { s?.stop(); fakes?.stop(); });

describe('website builds', () => {
  it('needs an approved article, and is not for reviewers or viewers', async () => {
    const r = await admin.post('/api/sites/s1/builds');
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'Approve at least one article for this site first.');
    assert.equal((await admin.post('/api/sites/nope/builds')).status, 404);
    assert.equal((await reviewer.get('/api/builds')).status, 403);
    assert.equal((await reviewer.post('/api/sites/s1/builds')).status, 403);
    assert.equal((await raw(reviewer, '/api/preview/s1/1/')).status, 403);
    assert.equal((await viewer.post('/api/sites/s1/builds')).status, 403);
    assert.equal((await viewer.get('/api/builds')).status, 200);
    assert.deepEqual((await reviewer.get('/api/state')).data.builds, []);
  });

  let v1: Build;
  it('builds the site from its approved articles, with the identity chosen once by the Site Builder', async () => {
    /* The native review is required by default: the language review comes before the approval. */
    assert.equal((await admin.post(`/api/articles/${articleId}/language-review`)).status, 200);
    assert.equal((await admin.post(`/api/articles/${articleId}/approve`)).status, 200);
    /* A photo, as the photo job stores them, so the build copies it. */
    const png = encodePng(4, 3, new Uint8Array(48).fill(200));
    mkdirSync(join(s.tmp, 'data', 'media', 'articles', String(articleId)), { recursive: true });
    writeFileSync(join(s.tmp, 'data', 'media', 'articles', String(articleId), 'kebun-kopi-1a2b3c4d-960.png'), png);
    const photo = { id: 'p1', role: 'hero', after: null, file: 'kebun-kopi-1a2b3c4d', ext: 'png', widths: [960], width: 960, height: 720,
      alt: 'Kebun kopi di lereng gunung', altEn: 'Coffee farm', caption: 'Kebun kopi.', captionEn: 'A coffee farm.', title: 'Coffee farm',
      author: 'A. Person', authorUrl: '', license: 'CC0', licenseUrl: '', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Coffee.png', provider: 'Wikimedia Commons' };
    s.db().prepare('UPDATE articles SET images = ? WHERE id = ?').run(JSON.stringify([photo]), articleId);

    let first: Build | undefined, again: number | undefined;
    const got = await events(admin, async () => {
      const r = await admin.post('/api/sites/s1/builds');
      assert.equal(r.status, 202, JSON.stringify(r.data));
      first = r.data.build as Build;
      again = (await admin.post('/api/sites/s1/builds')).status;
    }, 2000);
    assert.equal(again, 409, 'one build of a site at a time');
    assert.ok(got.some(e => e.event === 'build' && e.data.siteId === 's1'), 'build events on the stream');
    assert.equal(first!.version, 1);
    assert.equal(first!.by, 'Owner');
    v1 = await ready(first!.id);
    assert.equal(v1.status, 'ready', v1.error);
    assert.equal(v1.review, 'waiting');
    assert.equal(v1.deploy, '');
    assert.deepEqual(v1.articles, [articleId]);
    assert.equal(v1.pages, 5, 'home, article, its category (the research cluster), about, 404');
    assert.ok(v1.files > 10 && v1.bytes > 1000);
    assert.equal(v1.tokens, 1500);
    assert.equal(v1.previewPath, '/api/preview/s1/1/');
    assert.deepEqual(v1.steps.map(x => x.text), [
      'Started website v1 of s1.example', "Choosing the site's name, colours and labels", 'Placing 1 approved article',
      'Writing pages, sitemap and robots.txt', 'Checking links, images and markup', 'Ready for approval',
    ]);
    const identity = calls().filter(c => c.kind === 'site-identity');
    assert.equal(identity.length, 1);
    assert.equal(identity[0]!.body.model, 'gpt-6.1-sol');
    assert.equal(identity[0]!.body.tools, undefined);
    assert.equal(identity[0]!.body.store, false);
    assert.ok(existsSync(join(s.tmp, 'data', 'sites', 's1', 'builds', '1', 'index.html')));
    const state = (await admin.get('/api/state')).data.builds as Build[];
    assert.equal(state[0]!.id, v1.id);
    const alerts = (await admin.get('/api/alerts')).data.alerts as Json[];
    assert.ok(alerts.some(a => a.title === 'Website v1 of s1.example is ready for approval' && a.event === 'approval'), JSON.stringify(alerts));
    const audit = (await admin.get('/api/audit')).data.audit as Json[];
    assert.ok(audit.some(a => a.act === 'Asked for a website build of s1.example' && a.actor === 'Owner'));
    assert.ok(audit.some(a => String(a.act).startsWith('Built website v1 of s1.example') && a.actor === 'Site Builder'));
  });

  it('previews the build under a strict content security policy', async () => {
    const home = await raw(admin, '/api/preview/s1/1/');
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(home.headers.get('content-security-policy'), "default-src 'none'; img-src 'self' data:; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    assert.equal(home.headers.get('x-robots-tag'), 'noindex');
    assert.equal(home.headers.get('cache-control'), 'no-store');
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    const html = await home.text();
    assert.ok(html.includes('<h1>Kopi Nusantara</h1>'));
    assert.ok(html.includes('<html lang="id" dir="ltr">'));
    assert.ok(html.includes('<link rel="canonical" href="https://s1.example/">'));
    const css = html.match(/href="(assets\/site\.[0-9a-f]{8}\.css)"/)![1]!;
    const sheet = await raw(admin, '/api/preview/s1/1/' + css);
    assert.equal(sheet.status, 200);
    assert.equal(sheet.headers.get('content-type'), 'text/css; charset=utf-8');
    const art = await raw(admin, '/api/preview/s1/1/cara-membuat-cold-brew/');
    assert.equal(art.status, 200);
    const page = await art.text();
    assert.ok(page.includes('<h1>Cara Membuat Cold Brew di Rumah</h1>'));
    assert.ok(page.includes('src="../media/kebun-kopi-1a2b3c4d-960.png"') && page.includes('fetchpriority="high"'));
    assert.ok(page.includes('Foto: <a href="https://commons.wikimedia.org/wiki/File:Coffee.png">Coffee farm</a> · A. Person · CC0 · Wikimedia Commons'));
    const img = await raw(admin, '/api/preview/s1/1/media/kebun-kopi-1a2b3c4d-960.png');
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    for (const [p, type] of [['sitemap.xml', 'application/xml; charset=utf-8'], ['robots.txt', 'text/plain; charset=utf-8'], ['favicon.ico', 'image/x-icon'], ['favicon.svg', 'image/svg+xml']]) {
      const r = await raw(admin, '/api/preview/s1/1/' + p);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers.get('content-type'), type, p);
    }
    /* Without the slash, the pages' relative links would break: redirected. */
    const bare = await raw(admin, '/api/preview/s1/1');
    assert.equal(bare.status, 301);
    assert.equal(bare.headers.get('location'), '/api/preview/s1/1/');
    const folder = await raw(admin, '/api/preview/s1/1/cara-membuat-cold-brew');
    assert.equal(folder.status, 308);
    assert.equal(folder.headers.get('location'), '/api/preview/s1/1/cara-membuat-cold-brew/');
    /* A missing page is the site's own 404 page, with its links moved under the preview. */
    const missing = await raw(admin, '/api/preview/s1/1/no/such/page/');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('content-security-policy')?.startsWith("default-src 'none'"), true);
    const nf = await missing.text();
    assert.ok(nf.includes('Halaman tidak ditemukan'));
    assert.match(nf, /href="\/api\/preview\/s1\/1\/assets\/site\.[0-9a-f]{8}\.css"/);
    assert.equal((await raw(admin, '/api/preview/s1/9/')).status, 404);
    assert.equal((await raw(admin, '/api/preview/s2/1/')).status, 404);
  });

  it('never serves a file outside the build folder', async () => {
    for (const p of [
      '/api/preview/s1/1/../../../meridian.db', '/api/preview/s1/1/%2e%2e/%2e%2e/%2e%2e/meridian.db', '/api/preview/s1/1/..%2f..%2f..%2fmeridian.db',
      '/api/preview/s1/1/..%5c..%5c..%5cmeridian.db', '/api/preview/s1/1/index.html%00.png', '/api/preview/s1/1//etc/passwd', '/api/preview/s1/1/%2fetc%2fpasswd',
    ]) {
      const r = await rawPath(admin, p);
      assert.ok(r.status === 404 || r.status === 400, `${p}: ${r.status}`);
      assert.ok(!r.body.includes('SQLite format') && !r.body.includes('root:'), p);
    }
  });

  it('downloads the build as a valid ZIP', async () => {
    const r = await raw(admin, `/api/builds/${v1.id}/zip`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="s1.example-v1.zip"');
    const buf = Buffer.from(await r.arrayBuffer());
    const files = unzip(buf);
    for (const f of ['index.html', 'cara-membuat-cold-brew/index.html', 'tentang-kami/index.html', '404.html', 'sitemap.xml', 'robots.txt', '_headers', 'favicon.ico', 'media/kebun-kopi-1a2b3c4d-960.png']) assert.ok(files.has(f), f);
    assert.equal(files.size, v1.files);
    assert.equal(files.get('index.html')!.toString('utf8'), await (await raw(admin, '/api/preview/s1/1/')).text());
    if (spawnSync('unzip', ['-v']).status === 0) {
      const file = join(s.tmp, 'site.zip');
      writeFileSync(file, buf);
      const t = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
      assert.equal(t.status, 0, t.stdout + t.stderr);
      assert.match(t.stdout, /No errors detected/);
    }
    assert.equal((await raw(reviewer, `/api/builds/${v1.id}/zip`)).status, 403);
    assert.equal((await raw(admin, '/api/builds/999/zip')).status, 404);
    /* Written once next to the build folder (never inside it, so neither the preview nor a deploy sees it), then
       served from there; the photo is stored, not deflated again. */
    assert.ok(existsSync(buildFolder(1) + '.zip'));
    assert.ok(!existsSync(join(buildFolder(1), 's1.example-v1.zip')));
    const again = await raw(admin, `/api/builds/${v1.id}/zip`);
    assert.equal(again.status, 200);
    assert.equal(again.headers.get('content-length'), String(buf.length));
    assert.deepEqual(Buffer.from(await again.arrayBuffer()), buf);
    assert.equal(methodOf(buf, 'media/kebun-kopi-1a2b3c4d-960.png'), 0);
    assert.equal(methodOf(buf, 'index.html'), 8);
  });

  it('is approved or rejected by a person; without Cloudflare it waits for a ZIP upload', async () => {
    assert.equal((await viewer.post(`/api/builds/${v1.id}/approve`)).status, 403);
    const ok = await admin.post(`/api/builds/${v1.id}/approve`);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const b = ok.data.build as Build;
    assert.equal(b.review, 'approved');
    assert.equal(b.decidedBy, 'Owner');
    assert.equal(b.deploy, '', 'nothing to deploy to');
    assert.equal((await admin.post(`/api/builds/${v1.id}/approve`)).status, 409);
    const d = await admin.post(`/api/builds/${v1.id}/deploy`);
    assert.equal(d.status, 409);
    assert.match(String(d.data.error), /Connect Cloudflare/);

    const v2 = await newBuild();
    assert.equal(v2.version, 2);
    assert.equal(calls().filter(c => c.kind === 'site-identity').length, 1, 'the identity is chosen once');
    assert.ok(!v2.steps.some(x => x.text.startsWith('Choosing')));
    assert.equal((await admin.post(`/api/builds/${v2.id}/reject`, {})).status, 400);
    const no = await admin.post(`/api/builds/${v2.id}/reject`, { note: 'The tagline is too long.' });
    assert.equal(no.status, 200);
    assert.equal((no.data.build as Build).review, 'rejected');
    assert.equal((no.data.build as Build).reviewNote, 'The tagline is too long.');
    assert.equal((await admin.post(`/api/builds/${v2.id}/deploy`)).status, 409, 'a rejected build is never deployed');
    const audit = (await admin.get('/api/audit')).data.audit as Json[];
    assert.ok(audit.some(a => a.act === 'Approved website v1 of s1.example'));
    assert.ok(audit.some(a => a.act === 'Rejected website v2 of s1.example: The tagline is too long.'));
  });

  let v3: Build;
  it('deploys an approved build to Cloudflare Pages when Cloudflare is connected, and rolls back to an older one', async () => {
    const saved = await admin.put('/api/integrations/cf', { values: { token: CF_TOKEN, account: CF_ACCOUNT } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.notEqual((saved.data.result as Json).status, 'bad', JSON.stringify(saved.data.result));
    v3 = await newBuild();
    const ok = await admin.post(`/api/builds/${v3.id}/approve`);
    assert.equal(ok.status, 200);
    assert.equal((ok.data.build as Build).deploy, 'queued');
    const live = await buildIs(v3.id, b => b.deploy === 'live' || b.deploy === 'failed', 'to be deployed');
    assert.equal(live.deploy, 'live', live.deployError);
    assert.match(live.deployUrl, /^https:\/\/s1-example[a-z0-9-]*\.pages\.dev$/);
    assert.ok(live.steps.some(x => x.text === `Live at ${live.deployUrl}`));
    assert.deepEqual(cf.problems, []);
    const dep = cf.deployments.at(-1)!;
    assert.equal(dep.project, 's1-example');
    assert.ok(dep.manifest['/index.html'] && dep.manifest['/cara-membuat-cold-brew/index.html'] && dep.manifest['/sitemap.xml']);
    assert.ok(!dep.manifest['/_headers'], '_headers goes with the deployment, not as an asset');
    assert.match(dep.headers ?? '', /X-Content-Type-Options: nosniff/);
    const audit = (await admin.get('/api/audit')).data.audit as Json[];
    assert.ok(audit.some(a => a.act === 'Put s1.example v3 live on Cloudflare Pages' && a.actor === 'Deploy & Monitor'));

    /* Roll back: v1 (approved earlier) goes live again, v3 is superseded. */
    const back = await admin.post(`/api/builds/${v1.id}/deploy`);
    assert.equal(back.status, 202, JSON.stringify(back.data));
    await buildIs(v1.id, b => b.deploy === 'live', 'to be live again');
    assert.equal((await build(v3.id))!.deploy, 'superseded');
    assert.deepEqual(cf.problems, []);
  });

  it('approves itself when Settings say deploys need no approval', async () => {
    const cur = (await admin.get('/api/workspace')).data.docs as Record<string, { version: number }>;
    const put = await admin.put('/api/workspace/docs/settings', { version: cur.settings?.version ?? 0, data: { apDeploy: false } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    const v4 = await newBuild();
    assert.equal(v4.review, 'approved');
    assert.equal(v4.decidedBy, 'Automatic (approval is off in Settings)');
    const live = await buildIs(v4.id, b => b.deploy === 'live' || b.deploy === 'failed', 'to be deployed');
    assert.equal(live.deploy, 'live', live.deployError);
    assert.equal((await build(v1.id))!.deploy, 'superseded');
    const alerts = (await admin.get('/api/alerts')).data.alerts as Json[];
    assert.ok(!alerts.some(a => String(a.title).startsWith('Website v4')), 'no approval alert when none is needed');
  });

  it('keeps the newest builds on disk and never the files of older ones', async () => {
    for (let i = 0; i < 8; i++) await newBuild();
    const all = await builds();
    assert.equal(all.length, 12);
    const byVersion = (v: number) => all.find(b => b.version === v)!;
    for (const v of [1, 2]) {
      const b = byVersion(v);
      assert.equal(b.pruned, true, 'v' + v);
      assert.equal(b.previewPath, '');
      assert.ok(!existsSync(buildFolder(v)));
      assert.ok(!existsSync(buildFolder(v) + '.zip'), 'its ZIP is removed too');
      assert.equal((await raw(admin, `/api/preview/s1/${v}/`)).status, 410);
      assert.equal((await raw(admin, `/api/builds/${b.id}/zip`)).status, 410);
    }
    assert.equal((await admin.post(`/api/builds/${byVersion(1).id}/deploy`)).status, 410);
    for (let v = 3; v <= 12; v++) assert.equal(byVersion(v).pruned, false, 'v' + v);
    assert.equal(calls().filter(c => c.kind === 'site-identity').length, 1);
  });

  it('puts a newly approved build live even while another deploy of the site waits, and never an older one by itself', async () => {
    await needApproval(true);
    await deploysDone();
    const a = await newBuild(), b = await newBuild();
    assert.equal(a.review, 'waiting');
    assert.equal(b.review, 'waiting');
    /* A slower Cloudflare, so the first deploy is still on its way when the second build is approved. */
    cf.polls = 6;
    try {
      const ra = await admin.post(`/api/builds/${a.id}/approve`);
      assert.equal(ra.status, 200, JSON.stringify(ra.data));
      assert.equal(ra.data.deployQueued, true);
      const rb = await admin.post(`/api/builds/${b.id}/approve`);
      assert.equal(rb.status, 200, JSON.stringify(rb.data));
      assert.equal((rb.data.build as Build).deploy, 'queued', 'queued behind the deploy of the older build');
      assert.equal(rb.data.deployQueued, true);
      assert.equal(rb.data.note, '');
      const live = await buildIs(b.id, x => x.deploy === 'live' || x.deploy === 'failed', 'to be deployed');
      assert.equal(live.deploy, 'live', live.deployError);
      assert.equal((await build(a.id))!.deploy, 'superseded', 'the newest build is deployed last');
    } finally { cf.polls = 1; }

    /* An older build approved after a newer one went live stays off the site: going back is a rollback, asked for with Deploy. */
    const c = await newBuild(), d = await newBuild();
    assert.equal((await admin.post(`/api/builds/${d.id}/approve`)).status, 200);
    await buildIs(d.id, x => x.deploy === 'live', 'to be live');
    const rc = await admin.post(`/api/builds/${c.id}/approve`);
    assert.equal(rc.status, 200, JSON.stringify(rc.data));
    assert.equal((rc.data.build as Build).review, 'approved');
    assert.equal((rc.data.build as Build).deploy, '');
    assert.equal(rc.data.deployQueued, false);
    assert.equal(rc.data.note, `Not put live: v${d.version}, a newer version of s1.example, is live or on its way. Deploy this build to roll back to it.`);
    await new Promise(r => setTimeout(r, 300));
    assert.equal((await build(d.id))!.deploy, 'live');
    assert.equal((await build(c.id))!.deploy, '');
    const back = await admin.post(`/api/builds/${c.id}/deploy`);
    assert.equal(back.status, 202, JSON.stringify(back.data));
    await buildIs(c.id, x => x.deploy === 'live', 'to be live after the rollback');
    assert.equal((await build(d.id))!.deploy, 'superseded');
    assert.deepEqual(cf.problems, []);
  });

  it('puts a build that needs no approval live after a deploy asked for while it was being built', async () => {
    await needApproval(false);
    await deploysDone();
    const older = (await builds()).find(b => b.review === 'approved' && b.deploy === 'superseded' && !b.pruned)!;
    /* The build asks the Site Builder for the identity again, slowly, so a rollback can be asked for meanwhile. */
    s.db().prepare("DELETE FROM site_identity WHERE site_id = 's1'").run();
    writeFileSync(join(s.fakeDir, 'delay'), '1500');
    try {
      const r = await admin.post('/api/sites/s1/builds');
      assert.equal(r.status, 202, JSON.stringify(r.data));
      const id = (r.data.build as Build).id;
      await buildIs(id, b => b.status === 'work', 'to start');
      const back = await admin.post(`/api/builds/${older.id}/deploy`);
      assert.equal(back.status, 202, JSON.stringify(back.data));
      const n = await ready(id);
      assert.equal(n.status, 'ready', n.error);
      assert.equal(n.review, 'approved');
      assert.equal(n.deploy, 'queued', 'queued behind the rollback that was waiting when it finished');
      const live = await buildIs(id, b => b.deploy === 'live' || b.deploy === 'failed', 'to be deployed');
      assert.equal(live.deploy, 'live', live.deployError);
      assert.equal((await build(older.id))!.deploy, 'superseded');
    } finally { rmSync(join(s.fakeDir, 'delay'), { force: true }); }
    assert.deepEqual(cf.problems, []);
  });

  it('takes a build nobody decided on out of the approval queue when its files go, and never approves a build without files', async () => {
    await needApproval(true);
    await deploysDone();
    const old = await newBuild();
    assert.equal(old.review, 'waiting');
    const newer: Build[] = [];
    for (let i = 0; i < 10; i++) newer.push(await newBuild());
    const gone = (await build(old.id))!;
    assert.equal(gone.pruned, true);
    assert.equal(gone.previewPath, '');
    assert.equal(gone.review, 'rejected');
    assert.equal(gone.reviewNote, 'Nobody approved or rejected it before 10 newer builds were made, so its files were removed to save space. Build the website again to review it.');
    assert.equal((await admin.post(`/api/builds/${old.id}/approve`)).status, 409);
    /* Files that went some other way: refused, and no deploy that could only fail is queued. */
    const last = newer.at(-1)!;
    rmSync(buildFolder(last.version), { recursive: true, force: true });
    const r = await admin.post(`/api/builds/${last.id}/approve`);
    assert.equal(r.status, 410);
    assert.equal(r.data.error, 'The files of this build were removed to save space. Build the website again.');
    const after = (await build(last.id))!;
    assert.equal(after.review, 'waiting');
    assert.equal(after.deploy, '');
    assert.equal((await raw(admin, `/api/builds/${last.id}/zip`)).status, 410);
    const alerts = (await admin.get('/api/alerts')).data.alerts as Json[];
    assert.ok(!alerts.some(a => a.event === 'error' && String(a.title).startsWith('Deploy of')), JSON.stringify(alerts.filter(a => a.event === 'error')));
  });
});

describe('zip', () => {
  it('stores files that do not shrink and deflates the rest, with UTF-8 names', () => {
    const text = Buffer.from('<p>halo</p>'.repeat(100)), noise = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 97 + 13) & 255));
    const buf = zip([{ name: 'index.html', data: text }, { name: 'กาแฟ/index.html', data: noise }, { name: 'empty.txt', data: Buffer.alloc(0) }]);
    const files = unzip(buf);
    assert.deepEqual([...files.keys()], ['index.html', 'กาแฟ/index.html', 'empty.txt']);
    assert.deepEqual(files.get('index.html'), text);
    assert.deepEqual(files.get('กาแฟ/index.html'), noise);
    assert.equal(files.get('empty.txt')!.length, 0);
    assert.equal(methodOf(buf, 'index.html'), 8);
    assert.equal(methodOf(buf, 'กาแฟ/index.html'), 0);
  });

  it('never deflates photos and icons, which are compressed already', () => {
    const flat = Buffer.alloc(4096, 7);
    const buf = zip([{ name: 'media/a-960.jpg', data: flat }, { name: 'b.png', data: flat }, { name: 'favicon.ico', data: flat }, { name: 'c.css', data: flat }]);
    for (const n of ['media/a-960.jpg', 'b.png', 'favicon.ico']) assert.equal(methodOf(buf, n), 0, n);
    assert.equal(methodOf(buf, 'c.css'), 8);
    assert.deepEqual(unzip(buf).get('b.png'), flat);
  });

  it('writes a folder\'s ZIP to a file once, the same bytes as in memory, and shares a write asked for twice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meridian-zip-')), site = join(dir, 'site'), out = join(dir, 'site.zip');
    try {
      const at = new Date(2026, 9, 3, 11, 20, 30);
      const entries = [
        { name: '404.html', data: Buffer.from('<h1>404</h1>') }, { name: 'index.html', data: Buffer.from('<p>halo</p>'.repeat(200)) },
        { name: 'kopi/index.html', data: Buffer.from('<p>kopi</p>'.repeat(50)) }, { name: 'media/kebun-960.jpg', data: Buffer.alloc(3000, 1) },
      ];
      for (const e of entries) {
        mkdirSync(join(site, e.name, '..'), { recursive: true });
        writeFileSync(join(site, e.name), e.data);
        utimesSync(join(site, e.name), at, at);
      }
      const [p1, p2] = await Promise.all([cachedZip(site, out), cachedZip(site, out)]);
      assert.equal(p1, out);
      assert.equal(p2, out);
      const file = readFileSync(out);
      assert.deepEqual(file, zip(entries.map(e => ({ ...e, mtime: at }))));
      assert.deepEqual([...unzip(file).keys()], entries.map(e => e.name));
      /* Kept: asked again, nothing is written. */
      writeFileSync(join(site, 'index.html'), 'changed');
      assert.equal(await cachedZip(site, out), out);
      assert.deepEqual(readFileSync(out), file);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

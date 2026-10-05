// The Site Builder's photos: the Commons metadata rules (licenses, credits, sizes) on their own, then the whole job
// end to end against a real server, the fake Claude Code CLI (fixtures/fake-answers/photo-*.json) and a fake Wikimedia
// Commons (fixtures/fake-commons.ts). Run with `npm run test:server`.
/* First: photos.ts opens the database when imported, and it must be a temporary one, never the real workspace. */
import { TEST_DATA } from './fixtures/temp-data.ts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Block } from './article-content.ts';
import { authorOf, htmlToText, imageSize, licenseOf, mediaUrl, servedWidth, toCandidate, userAgent, type ExtMetadata, type Page } from './commons.ts';
import { FAKE_FILES, USABLE, commonsMode, fakeJpeg, fakePng, resetCommons } from './fixtures/fake-commons.ts';
import { startFakes } from './fixtures/fake-services.ts';
import { DATA_DIR, ROOT } from './paths.ts';
import { Client, member, owner, saveSites, startServer, until, type Json, type TestServer } from './testkit.ts';

const ext = (meta: Record<string, string>): ExtMetadata => Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { value: v, source: 'commons-desc-page' }]));
const page = (f: typeof FAKE_FILES[number]): Page => ({
  title: f.title, index: f.index, ns: 6,
  imageinfo: [{ width: f.width, height: f.height, mime: f.mime, descriptionurl: 'https://commons.wikimedia.org/wiki/' + f.title.replace(/ /g, '_'), thumburl: 'https://upload.wikimedia.org/x.jpg', extmetadata: ext(f.meta) }],
});

describe('Commons metadata', () => {
  it('accepts CC0, public domain, CC BY and CC BY-SA only', () => {
    const kept = FAKE_FILES.map(page).map(toCandidate).filter(c => typeof c !== 'string').map(c => c.file);
    assert.deepEqual(new Set(kept), new Set(USABLE));
    const lic = (meta: Record<string, string>) => licenseOf(ext(meta));
    assert.deepEqual(lic({ License: 'cc-by-sa-4.0', LicenseShortName: 'CC BY-SA 4.0', LicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0' }), { kind: 'by-sa', name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0' });
    assert.deepEqual(lic({ License: 'cc0', LicenseShortName: 'CC0' }), { kind: 'cc0', name: 'CC0', url: '' });
    assert.deepEqual(lic({ License: 'cc0', LicenseShortName: 'CC0', LicenseUrl: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en' }), { kind: 'cc0', name: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en' });
    assert.deepEqual(lic({ License: 'cc-pd', LicenseShortName: 'Public domain' }), { kind: 'pd', name: 'Public domain', url: '' });
    assert.deepEqual(lic({ LicenseShortName: 'Public Domain Mark 1.0' }), { kind: 'pd', name: 'Public Domain Mark 1.0', url: '' });
    /* A ported license without its URL gets the deed of that port; http becomes https. */
    assert.equal(lic({ License: 'cc-by-sa-3.0-de', LicenseShortName: 'CC BY-SA 3.0 de' })?.url, 'https://creativecommons.org/licenses/by-sa/3.0/de/');
    assert.equal(lic({ License: 'cc-by-2.0', LicenseShortName: 'CC BY 2.0', LicenseUrl: 'http://creativecommons.org/licenses/by/2.0' })?.url, 'https://creativecommons.org/licenses/by/2.0');
    for (const refused of [
      { LicenseShortName: 'CC BY-NC 4.0' } as Record<string, string>, { LicenseShortName: 'CC BY-ND 2.0' }, { License: 'cc-by-nc-sa-2.0', LicenseShortName: 'CC BY-NC-SA 2.0' },
      { LicenseShortName: 'GFDL' }, { LicenseShortName: 'GFDL 1.2' }, { LicenseShortName: 'FAL' }, { LicenseShortName: 'Copyrighted free use' },
      { LicenseShortName: 'Attribution' }, { LicenseShortName: 'Fair use' }, {}, { License: 'cc0' },
      { License: 'cc-by-4.0', LicenseShortName: 'CC BY 4.0', NonFree: 'true' },
      { License: 'cc-by-4.0', LicenseShortName: 'CC BY 4.0', DeletionReason: 'Copyright violation' },
      { License: 'cc-by-4.0', LicenseShortName: 'CC BY 4.0', Restrictions: 'trademarked' },
      { License: 'gfdl', LicenseShortName: 'CC BY 4.0' },
    ]) assert.equal(lic(refused), null, JSON.stringify(refused));
    assert.ok(lic({ License: 'cc-by-4.0', LicenseShortName: 'CC BY 4.0', NonFree: 'false', Restrictions: '' }));
  });

  it('keeps photos only: JPEG or PNG, at least 960 px wide, not extremely wide or tall', () => {
    const base = FAKE_FILES.find(f => f.title === USABLE[0])!;
    assert.equal(toCandidate(page({ ...base, mime: 'image/gif' })), 'format');
    assert.equal(toCandidate(page({ ...base, width: 900, height: 600 })), 'size');
    assert.equal(toCandidate(page({ ...base, width: 6000, height: 1000 })), 'size');
    assert.equal(toCandidate({ title: 'File:X.jpg', missing: true }), 'format');
  });

  it('credits the author: their own credit line, else the Artist, else the Credit, with the Artist link made absolute', () => {
    const meta = (t: string) => ext(FAKE_FILES.find(f => f.title === t)!.meta);
    assert.deepEqual(authorOf(meta('File:Coffea canephora cherries in Lampung.jpg')), { author: 'Ksd5', authorUrl: 'https://commons.wikimedia.org/wiki/User:Ksd5' });
    assert.deepEqual(authorOf(meta('File:Coffee beans by Budi.jpg')), { author: 'Photo: Budi Santoso / Example Studio', authorUrl: 'https://www.flickr.com/people/budi' });
    assert.deepEqual(authorOf(meta('File:Hand coffee grinder, coarse setting.jpg')), { author: 'Kleingrothe & Co.', authorUrl: '' });
    assert.deepEqual(authorOf(ext({ Artist: 'Unknown author', Credit: '<a href="https://example.org/archive">City archive</a>' })), { author: 'City archive', authorUrl: '' });
    assert.equal(authorOf(ext({ Artist: '<a href="/w/index.php?title=User:X&amp;action=edit&amp;redlink=1">X</a>' })).authorUrl, '');
    assert.equal(htmlToText('<p>Ripe <i>Coffea</i>&nbsp;cherries &amp; leaves&#x2014;Lampung<br>2024 &#8211; &ndash;</p><script>alert(1)</script>'), 'Ripe Coffea cherries & leaves—Lampung 2024 – –');
  });

  it('knows which width Commons really serves, never trusting the reported thumbwidth', () => {
    assert.equal(servedWidth(960, 4000), 960);
    assert.equal(servedWidth(1280, 1250), 1250, 'a narrower original is served as it is');
    assert.equal(servedWidth(640, 3264), 960, '640 is not a step: rounded up');
    assert.equal(servedWidth(480, 3264), 500);
    assert.equal(servedWidth(330, 2400), 330);
  });

  it('reads the pixel size from PNG and JPEG headers, applying the EXIF orientation', () => {
    assert.deepEqual(imageSize(fakePng(960, 640)), { type: 'png', width: 960, height: 640 });
    assert.deepEqual(imageSize(fakeJpeg(1280, 960)), { type: 'jpg', width: 1280, height: 960 });
    assert.deepEqual(imageSize(fakeJpeg(1280, 960, 6)), { type: 'jpg', width: 960, height: 1280 }, 'turned a quarter: browsers show it upright');
    assert.deepEqual(imageSize(fakeJpeg(1280, 960, 3)), { type: 'jpg', width: 1280, height: 960 });
    assert.equal(imageSize(Buffer.from('<html>not an image</html>')), null);
    assert.equal(imageSize(fakeJpeg(1280, 960).subarray(0, 40)), null, 'cut off before the frame header');
    assert.equal(imageSize(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')), null);
  });

  it('says who is calling, and downloads only from Wikimedia\'s media servers', () => {
    const before = { contact: process.env.MERIDIAN_CONTACT, hosts: process.env.MERIDIAN_MEDIA_HOSTS };
    try {
      delete process.env.MERIDIAN_CONTACT; delete process.env.MERIDIAN_MEDIA_HOSTS;
      assert.match(userAgent(), /^MeridianBot\/1\.0 \(https:\/\/github\.com\/; local install\) node\/\d+$/);
      process.env.MERIDIAN_CONTACT = 'ops@example.com';
      assert.match(userAgent(), /^MeridianBot\/1\.0 \(https:\/\/github\.com\/; ops@example\.com\) node\/\d+$/);
      /* fetch refuses a header with a character above U+00FF before sending: every Commons request would fail. */
      process.env.MERIDIAN_CONTACT = 'Đặng Nguyễn — ops@example.org (Jakarta)\r\nX-Evil: 1';
      assert.match(userAgent(), /^MeridianBot\/1\.0 \(https:\/\/github\.com\/; Dang Nguyen ops@example\.org Jakarta X-Evil: 1\) node\/\d+$/);
      assert.doesNotThrow(() => new Headers({ 'user-agent': userAgent() }));
      process.env.MERIDIAN_CONTACT = '— 東京 —';
      assert.match(userAgent(), /\(https:\/\/github\.com\/; local install\)/, 'nothing usable left');
      assert.equal(mediaUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg?utm_source=commons.wikimedia.org&utm_content=original')?.href, 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg');
      assert.ok(mediaUrl('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/960px-X.jpg'));
      for (const bad of ['http://upload.wikimedia.org/x.jpg', 'https://evil.example/x.jpg', 'https://upload.wikimedia.org.evil.example/x.jpg', 'https://u:p@upload.wikimedia.org/x.jpg', 'file:///etc/passwd', 'not a url'])
        assert.equal(mediaUrl(bad), null, bad);
      process.env.MERIDIAN_MEDIA_HOSTS = '127.0.0.1:8080';
      assert.ok(mediaUrl('http://127.0.0.1:8080/x.jpg'), 'http only for the local fake');
      assert.equal(mediaUrl('https://upload.wikimedia.org/x.jpg'), null, 'the list replaces the default');
    } finally {
      for (const [k, v] of [['MERIDIAN_CONTACT', before.contact], ['MERIDIAN_MEDIA_HOSTS', before.hosts]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});

describe('the agent\'s answers', () => {
  /* photos.ts opens the database when imported: the temporary one of fixtures/temp-data.ts. */
  let ph: typeof import('./photos.ts');
  before(async () => {
    assert.ok(ROOT && !TEST_DATA.startsWith(ROOT) && DATA_DIR === TEST_DATA, 'never the real workspace');
    ph = await import('./photos.ts');
  });
  after(() => rmSync(TEST_DATA, { recursive: true, force: true }));
  const blocks = [
    { type: 'p', text: 'a', en: 'a' }, { type: 'h2', text: 'b', en: 'b' }, { type: 'list', items: [{ text: 'c', en: 'c' }] },
    { type: 'p', text: 'd', en: 'd' }, { type: 'h3', text: 'e', en: 'e' }, { type: 'p', text: 'f', en: 'f' }, { type: 'p', text: 'g', en: 'g' },
  ] as Block[];
  const w = (alt = 'Alt') => ({ alt, altEn: 'Alt', caption: 'Cap', captionEn: 'Cap' });

  it('keeps 3 to 6 plain searches without operators or repeats', () => {
    assert.deepEqual(ph.parseQueries('```json\n{"hero":"x","queries":["Coffea canephora","\\"kopi\\" filetype:drawing","-site:x.com coffee","coffea CANEPHORA","a","b","c","d","e"]}\n```').queries,
      ['Coffea canephora', 'kopi', 'coffee', 'a', 'b', 'c']);
    assert.throws(() => ph.parseQueries('{"queries":[]}'), /no searches/);
    assert.throws(() => ph.parseQueries('I cannot help.'), /did not return its searches as JSON/);
  });

  it('drops invented candidates, repeats, bad places and empty alt text; at most a hero and 3 inline photos', () => {
    const { picks } = ph.parseChoice(JSON.stringify({
      hero: { candidate: 2, ...w() },
      inline: [
        { candidate: 7, after: 0, ...w() }, { candidate: -1, after: 0, ...w() }, { candidate: 1.5, after: 0, ...w() },
        { candidate: 2, after: 0, ...w() }, { candidate: 0, after: 2, ...w() }, { candidate: 0, after: 4, ...w() }, { candidate: 0, after: 99, ...w() },
        { candidate: 0, after: 0, ...w('') }, { candidate: '0', after: 5, ...w() }, { candidate: 1, after: 5, ...w() }, { candidate: 1, after: 3, ...w() },
        { candidate: 3, after: 0, ...w() }, { candidate: 4, after: 6, ...w() }, { candidate: 5, after: 1, ...w() },
      ],
    }), 6, blocks);
    assert.deepEqual(picks.map(p => [p.role, p.candidate, p.after]), [['hero', 2, null], ['inline', 3, 0], ['inline', 1, 3], ['inline', 0, 5]]);
    /* A place that is not a block number is no place: never block 0 or 1 by accident. */
    const placed = (after: unknown) => ph.parseChoice(JSON.stringify({ hero: { candidate: 0, ...w() }, inline: [{ candidate: 1, after, ...w() }] }), 2, blocks).picks.map(p => [p.role, p.after]);
    for (const bad of [null, '', ' ', true, false, [], {}, '1e0', '-1', 0.5, undefined]) assert.deepEqual(placed(bad), [['hero', null]], JSON.stringify(bad));
    assert.deepEqual(placed('3'), [['hero', null], ['inline', 3]]);
  });

  it('makes the first fitting inline photo the hero when the agent gave none, and accepts no photo at all', () => {
    const { picks, notes } = ph.parseChoice(JSON.stringify({ hero: null, inline: [{ candidate: 1, after: 3, ...w() }, { candidate: 0, after: 1, ...w() }], notes: 'Two fit.' }), 2, blocks);
    assert.deepEqual(picks.map(p => [p.role, p.candidate, p.after]), [['hero', 0, null], ['inline', 1, 3]]);
    assert.equal(notes, 'Two fit.');
    assert.deepEqual(ph.parseChoice('{"hero": null, "inline": [], "notes": "None fits."}', 4, blocks).picks, []);
    assert.deepEqual(ph.parseChoice('{"hero": {"candidate": 0, "alt": "x"}}', 0, blocks).picks, [], 'no candidates: nothing can be chosen');
  });

  it('names files in the site\'s language, short, with the source\'s hash', () => {
    const name = ph.fileBase('Buah kopi robusta matang di dahan, siap dipetik oleh petani di Lampung Barat', 'https://commons.wikimedia.org/wiki/File:A.jpg');
    assert.match(name, /^buah-kopi-robusta-matang-di-dahan-siap-dipetik-oleh-petani-[0-9a-f]{8}$/);
    assert.notEqual(name, ph.fileBase('Buah kopi robusta matang di dahan, siap dipetik oleh petani di Lampung Barat', 'https://commons.wikimedia.org/wiki/File:B.jpg'));
    for (const text of ['เมล็ดกาแฟโรบัสต้าสุกบนกิ่ง', 'Cà phê phin nhỏ giọt', 'قهوة باردة مع الثلج', 'कोल्ड ब्रू कॉफ़ी', '!!!'])
      assert.match(ph.fileBase(text, 'x') + '-960.jpg', ph.MEDIA_NAME, text);
    assert.match(ph.fileBase('', 'x'), /^photo-[0-9a-f]{8}$/);
  });
});

/* ---------- End to end ---------- */

type Photo = Json & { id: string; role: string; after: number | null; file: string; ext: string; widths: number[]; width: number; height: number };
type PhotoJob = { status: string; step: string; error: string; queuedAt: number | null; startedAt: number | null; finishedAt: number | null; tokens: number; costUsd: number };
type Article = Json & { id: number; status: string; finishedAt: number; images: Photo[]; photos: PhotoJob; history: { by: string; action: string; note: string }[] };
type Call = { kind: string; body: Record<string, any>; prompt: string };

let s: TestServer, fakes: Awaited<ReturnType<typeof startFakes>>;
let admin: Client, viewer: Client, reviewer: Client, otherReviewer: Client;
let id = 0;

const articleOf = async (c: Client = admin) => ((await c.get('/api/state')).data.articles as Article[]).find(a => a.id === id)!;
/** The article once its photo job has ended (`status`) after `since`. */
const photosEnded = (status: string, since = 0) => until(`photos ${status}`, async () => { const a = await articleOf(); return a.photos.status === status && (a.photos.finishedAt ?? 0) > since ? a : null; });
const calls = (): Call[] => existsSync(join(s.fakeDir, 'calls.jsonl')) ? readFileSync(join(s.fakeDir, 'calls.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Call) : [];
const promptOf = (c: Call) => c.prompt;
const mediaDir = () => join(s.tmp, 'data', 'media', 'articles', String(id));
const files = () => existsSync(mediaDir()) ? readdirSync(mediaDir()).sort() : [];
const names = (photos: Photo[]) => photos.flatMap(p => p.widths.map(w => `${p.file}-${w}.${p.ext}`)).sort();
const commonsHits = (from = 0) => fakes.hits.slice(from).filter(h => h.path.startsWith('/commons'));
/** A GET with the path sent exactly as written (fetch would resolve dot segments first). */
function rawGet(path: string, c?: Client): Promise<{ status: number; type: string; cache: string; nosniff: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const r = request(s.base + path, { headers: c ? { cookie: 'meridian_session=' + c.cookie } : {} }, res => {
      const chunks: Buffer[] = [];
      res.on('data', d => chunks.push(d as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), cache: String(res.headers['cache-control']), nosniff: String(res.headers['x-content-type-options']), body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

describe('photos for an article', () => {
  before(async () => {
    fakes = await startFakes();
    s = await startServer(fakes.env);
    admin = await owner(s, 'Owner');
    await saveSites(admin, [
      { id: 's1', domain: 'kopi.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live' },
      { id: 's2', domain: 'ca-phe.example', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live' },
    ] as never);
    viewer = await member(s, admin, 'viewer', 'viewer@example.com', 'Vera Viewer');
    reviewer = await member(s, admin, 'reviewer', 'dewi@example.com', 'Dewi Reviewer', 's1');
    otherReviewer = await member(s, admin, 'reviewer', 'linh@example.com', 'Linh Reviewer', 's2');
  });
  after(() => { s?.stop(); fakes?.stop(); resetCommons(); });

  it('finds photos on its own once the Content Writer has written the article', async () => {
    const r = await admin.post('/api/requests', { siteId: 's1', domain: 'kopi.example', country: 'Indonesia', lang: 'Indonesian', siteTopic: 'Coffee', topic: 'cold brew', goal: 'x' });
    const rid = (r.data.request as Json).id as number;
    await until('the research', async () => ((await admin.get('/api/state')).data.requests as Json[]).find(x => x.id === rid && x.status === 'done'));
    const created = await admin.post('/api/articles', { siteId: 's1', domain: 'kopi.example', country: 'Indonesia', lang: 'Indonesian', siteTopic: 'Coffee', keyword: 'cara membuat cold brew', requestId: rid, model: 'GPT-6.1 Sol' });
    assert.equal(created.status, 201);
    id = (created.data.article as Article).id;
    assert.deepEqual((created.data.article as Article).photos, { engine: '', status: '', step: '', error: '', queuedAt: null, startedAt: null, finishedAt: null, tokens: 0, costUsd: 0 });
    assert.deepEqual((created.data.article as Article).images, []);
    const hits = fakes.hits.length;

    const a = await photosEnded('done');
    assert.equal(a.status, 'review', 'photos never change the article\'s status');
    assert.equal(a.photos.queuedAt, a.finishedAt, 'queued the moment the article was written');
    assert.equal(a.photos.error, '');
    assert.equal(a.photos.tokens, 3000, 'two CLI calls');
    assert.ok(Math.abs(a.photos.costUsd - 0.014) < 1e-9);
    assert.equal(a.tokens, 1500, 'the article keeps its own figures');

    /* Hero, then the inline photos in reading order. Invented, repeated, misplaced and alt-less picks were dropped. */
    assert.deepEqual(a.images.map(p => [p.id, p.role, p.after]), [['p1', 'hero', null], ['p2', 'inline', 0], ['p3', 'inline', 1]]);
    const [hero, cold, grinder] = a.images as [Photo, Photo, Photo];
    assert.match(hero.file, /^buah-kopi-robusta-matang-di-dahan-[0-9a-f]{8}$/);
    assert.deepEqual({ ...hero, file: '' }, {
      id: 'p1', role: 'hero', after: null, file: '', ext: 'jpg', widths: [960, 1280], width: 1280, height: 960,
      alt: 'Buah kopi robusta matang di dahan', altEn: 'Ripe robusta coffee cherries on the branch',
      caption: 'Buah Coffea canephora (robusta) di sebuah kebun di Lampung.', captionEn: 'Coffea canephora (robusta) cherries on a farm in Lampung.',
      title: 'Coffea canephora cherries in Lampung', author: 'Ksd5', authorUrl: 'https://commons.wikimedia.org/wiki/User:Ksd5',
      license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Coffea_canephora_cherries_in_Lampung.jpg', provider: 'Wikimedia Commons',
    });
    assert.deepEqual([cold.ext, cold.widths, cold.width, cold.height, cold.license, cold.licenseUrl, cold.author], ['png', [960, 1280], 1280, 853, 'CC0', '', 'Jane Doe']);
    /* 1250 px wide: the original stands in for 1280, never enlarged. */
    assert.deepEqual([grinder.ext, grinder.widths, grinder.width, grinder.height, grinder.license, grinder.licenseUrl, grinder.author], ['jpg', [960, 1250], 1250, 1000, 'Public domain', '', 'Kleingrothe & Co.']);
    assert.equal(grinder.alt, 'Penggiling kopi manual dengan gilingan kasar');
    assert.deepEqual(files(), names(a.images));
    assert.ok(!existsSync(join(s.tmp, 'data', 'workspaces', `photos-${id}`, 'previews')), 'previews are deleted after the job');

    assert.deepEqual(a.history.at(-1), { at: (a.history.at(-1) as Json).at, by: 'Site Builder', action: 'photos', note: 'Site Builder chose 3 photos' });
    const steps = (s.db().prepare(`SELECT text FROM job_steps WHERE kind = 'photos' AND job_id = ? ORDER BY id`).all(id) as { text: string }[]).map(x => x.text);
    assert.equal(steps[0], 'Started looking for photos');
    assert.ok(steps.includes('Searching Wikimedia Commons: "Coffea canephora cherries", "cold brew coffee", "coffee grinder", "roasted coffee beans"'), steps.join('\n'));
    assert.ok(steps.includes('Found 4 openly licensed photos (CC0, public domain, CC BY or CC BY-SA) and left out 9 files whose license does not allow use on the site'), steps.join('\n'));
    assert.equal(steps.at(-1), 'Placed 3 photos: the main photo and 2 in the text');
    const audit = (await admin.get('/api/audit')).data.audit as Json[];
    assert.ok(audit.some(e => e.actor === 'Site Builder' && e.act === 'Chose 3 photos for the article: How to make cold brew at home' && e.site === 's1'));

    const mine = calls().filter(c => c.kind.startsWith('photo-'));
    assert.deepEqual(mine.map(c=>c.kind), ['photo-queries','photo-choice']);
    for(const c of mine) {
      assert.equal(c.body.model,'gpt-6.1-sol');
      assert.equal(c.body.tools,undefined);
      assert.equal(c.body.store,false);
      assert.ok(String(c.body.instructions).includes('images-and-alt-text/SKILL.md'));
      assert.ok(!JSON.stringify(c.body).includes('test-openai-key'));
    }
    const previews=mine[1]!.body.input[0].content.filter((c: {type:string})=>c.type==='input_image');
    assert.ok(previews.length>0);
    assert.ok(previews.every((c: {image_url:string})=>/^data:image\/(jpeg|png);base64,/.test(c.image_url)));
    const [q, choice] = mine.map(promptOf) as [string, string];
    assert.match(q, /^Meridian task: photo-queries$/m);
    assert.match(q, /- Keyword: cara membuat cold brew/);
    assert.match(q, /- Country: Indonesia/);
    assert.match(choice, /^Meridian task: photo-choice$/m);
    assert.match(choice, /images-and-alt-text guidelines are included/);
    assert.match(choice, /alt text and caption in Indonesian/);
    assert.match(choice, /What the main photo should show, from step 1: Ripe robusta coffee cherries on the branch/);
    assert.match(choice, /\[2\] list \(context only\)/);
    /* Exactly the four usable files are offered, each with a preview the agent can look at. */
    const offered = [...choice.matchAll(/^\[(\d+)\] Title: (.*)$/gm)].map(m => m[2]);
    assert.deepEqual(offered, ['Coffea canephora cherries in Lampung', 'Cold brew coffee with ice', 'Hand coffee grinder, coarse setting', 'Coffee beans by Budi']);
    assert.match(choice, /Preview: attached as Candidate 1/);
    assert.match(choice, /License: CC BY-SA 4\.0/);
    assert.doesNotMatch(choice, /Iced coffee|Barista|GFDL|FAL|nonfree/);

    /* Every Commons request: our User-Agent; the API one at a time with the documented parameters; standard widths only. */
    const got = commonsHits(hits);
    for (const h of got) assert.match(String(h.headers['user-agent']), /^MeridianBot\/1\.0 \(https:\/\/github\.com\/; local install\) node\/\d+$/);
    const api = got.filter(h => h.path.startsWith('/commons/w/api.php')).map(h => new URL(h.path, 'http://x').searchParams);
    const searches = api.filter(p => p.get('generator') === 'search');
    assert.deepEqual(searches.map(p => p.get('gsrsearch')), ['Coffea canephora cherries', 'cold brew coffee', 'coffee grinder', 'roasted coffee beans']
      .map(x => `${x} filetype:bitmap filew:>1200 -hastemplate:"Personality rights" -hastemplate:"Trademarked"`));
    for (const p of searches) {
      assert.deepEqual([p.get('format'), p.get('formatversion'), p.get('maxlag'), p.get('gsrnamespace'), p.get('prop'), p.get('iiprop'), p.get('iiurlwidth')], ['json', '2', '5', '6', 'imageinfo', 'url|size|mime|extmetadata', '330']);
      assert.match(p.get('iiextmetadatafilter') ?? '', /LicenseShortName\|License\|LicenseUrl\|Artist\|Credit\|Attribution/);
    }
    const lookups = api.filter(p => p.get('titles'));
    assert.deepEqual(lookups.map(p => p.get('iiurlwidth')), ['960', '1280']);
    assert.deepEqual(lookups[0]!.get('titles')!.split('|'), USABLE.slice(0, 3));
    const media = got.filter(h => h.path.startsWith('/commons-media/')).map(h => h.path);
    assert.ok(media.every(p => !p.includes('utm_')), 'tracking parameters are dropped');
    assert.equal(media.filter(p => p.includes('/330px-')).length, 4, 'one preview per candidate');
    assert.deepEqual(media.filter(p => !p.includes('/330px-')).map(p => p.replace(/^.*\/(\d+px-)?([^/]+)$/, '$1$2')).sort(), [
      '1280px-Coffea_canephora_cherries_in_Lampung.jpg', '1280px-Cold_brew_coffee_with_ice.png', '960px-Coffea_canephora_cherries_in_Lampung.jpg',
      '960px-Cold_brew_coffee_with_ice.png', '960px-Hand_coffee_grinder%2C_coarse_setting.jpg', 'Hand_coffee_grinder%2C_coarse_setting.jpg',
    ]);
  });

  it('serves the files to people who may see the site, and nothing outside the article\'s folder', async () => {
    const a = await articleOf(), [hero, cold] = a.images as [Photo, Photo];
    const url = (p: Photo, w: number) => `/api/media/articles/${id}/${encodeURIComponent(`${p.file}-${w}.${p.ext}`)}`;
    const ok = await rawGet(url(hero, 1280), admin);
    assert.deepEqual([ok.status, ok.type, ok.cache, ok.nosniff], [200, 'image/jpeg', 'private, max-age=3600', 'nosniff']);
    assert.deepEqual(imageSize(ok.body), { type: 'jpg', width: 1280, height: 960 });
    const png = await rawGet(url(cold, 960), reviewer);
    assert.deepEqual([png.status, png.type], [200, 'image/png'], 'a reviewer of the article\'s site');
    assert.deepEqual(imageSize(png.body), { type: 'png', width: 960, height: 640 });
    assert.equal((await rawGet(url(hero, 960), viewer)).status, 200);
    assert.equal((await rawGet(url(hero, 960), otherReviewer)).status, 403, 'a reviewer of another site');
    assert.equal((await rawGet(url(hero, 960))).status, 401, 'signed out');
    for (const bad of [
      `/api/media/articles/${id}/..%2F..%2F..%2Fmeridian.db`, `/api/media/articles/${id}/%2e%2e%2fmeridian.db`, `/api/media/articles/${id}/..`,
      `/api/media/articles/${id}/..%5C..%5Cmeridian.db`, `/api/media/articles/${id}/${hero.file}-960.jpg%00.png`, `/api/media/articles/${id}/${hero.file}-960.JPG`,
      `/api/media/articles/${id}/${hero.file}-9.jpg`, `/api/media/articles/${id}/${hero.file}-1920.jpg`, `/api/media/articles/9999/${hero.file}-960.jpg`,
      `/api/media/articles/${id}/meridian.db`, `/api/media/articles/${id}/`,
    ]) {
      const r = await rawGet(bad, admin);
      assert.equal(r.status, 404, bad);
      assert.match(r.type, /application\/json/, bad);
    }
  });

  it('lets an admin or editor remove a photo, and deletes its files', async () => {
    const del = (c: Client, photo: string) => c.del(`/api/articles/${id}/photos/${photo}`);
    assert.equal((await del(viewer, 'p2')).status, 403);
    assert.equal((await del(reviewer, 'p2')).status, 403);
    const r = await del(admin, 'p2');
    assert.equal(r.status, 200);
    const images = (r.data.article as Article).images;
    assert.deepEqual(images.map(p => p.id), ['p1', 'p3']);
    assert.deepEqual(files(), names(images), 'the removed photo\'s files are gone');
    assert.equal((await del(admin, 'p2')).status, 404);
    assert.equal((await admin.del('/api/articles/9999/photos/p1')).status, 404);
    const audit = (await admin.get('/api/audit')).data.audit as Json[];
    assert.ok(audit.some(e => e.actor === 'Owner' && e.act === 'Removed a photo from How to make cold brew at home' && e.site === 's1'));
  });

  it('finds photos again on request; one at a time; a failure only records its error', async () => {
    const before = (await articleOf()).photos.finishedAt ?? 0, kept = (await articleOf()).images;
    assert.equal((await reviewer.post(`/api/articles/${id}/photos`)).status, 403);
    assert.equal((await viewer.post(`/api/articles/${id}/photos`)).status, 403);
    assert.equal((await admin.post('/api/articles/9999/photos')).status, 404);
    writeFileSync(join(s.fakeDir, 'delay'), '400');
    commonsMode.down = true;
    try {
      const r = await admin.post(`/api/articles/${id}/photos`);
      assert.equal(r.status, 202);
      assert.equal((r.data.article as Article).photos.status, 'queued');
      const again = await admin.post(`/api/articles/${id}/photos`);
      assert.equal(again.status, 409);
      assert.match(String(again.data.error), /already looking for photos/);
      await until('the job to start', async () => (await articleOf()).photos.status === 'work');
      assert.equal((await admin.del(`/api/articles/${id}/photos/p1`)).status, 409, 'not while the job is placing photos');
      const failed = await photosEnded('failed', before);
      assert.equal(failed.photos.error, 'Wikimedia Commons answered with HTTP 500.');
      assert.equal(failed.status, 'review');
      assert.deepEqual(failed.images, kept, 'the photos it had stay');
      assert.deepEqual(files(), names(kept));
      assert.equal(failed.photos.tokens, 1500, 'the call that ran is counted');
      assert.equal(failed.history.at(-1)?.action, 'photos', 'no event for a failed photo job');
    } finally { rmSync(join(s.fakeDir, 'delay'), { force: true }); commonsMode.down = false; }
    /* Photos never hold up a decision. */
    assert.equal((await admin.post(`/api/articles/${id}/language-review`)).status, 200);
    const ok = await admin.post(`/api/articles/${id}/approve`);
    assert.equal(ok.status, 200);
    assert.equal((ok.data.article as Article).status, 'approved');
  });

  it('waits when Wikimedia Commons asks it to (maxlag), and works for an approved article too', async () => {
    const before = (await articleOf()).photos.finishedAt ?? 0, hits = fakes.hits.length;
    commonsMode.maxlag = 1;
    assert.equal((await admin.post(`/api/articles/${id}/photos`)).status, 202);
    const a = await photosEnded('done', before);
    assert.equal(a.status, 'approved');
    assert.deepEqual(a.images.map(p => p.id), ['p1', 'p2', 'p3']);
    assert.deepEqual(files(), names(a.images));
    const searches = commonsHits(hits).filter(h => h.path.includes('generator=search')).map(h => new URL(h.path, 'http://x').searchParams.get('gsrsearch'));
    assert.equal(searches.length, 5, 'the first search is asked again after the maxlag answer');
    assert.equal(searches[0], searches[1]);
  });

  it('places no photo when nothing fits, and removes the old files', async () => {
    let before = (await articleOf()).photos.finishedAt ?? 0;
    writeFileSync(join(s.fakeDir, 'photo-choice.txt'), '{"hero": null, "inline": [], "notes": "None shows robusta cherries."}');
    try {
      assert.equal((await admin.post(`/api/articles/${id}/photos`)).status, 202);
      const a = await photosEnded('done', before);
      assert.deepEqual(a.images, []);
      assert.deepEqual(files(), []);
      assert.equal(a.history.at(-1)?.note, 'Site Builder found no photo that fits');
      const steps = (s.db().prepare(`SELECT text FROM job_steps WHERE kind = 'photos' AND job_id = ? ORDER BY id`).all(id) as { text: string }[]).map(x => x.text);
      assert.ok(steps.includes('Site Builder: None shows robusta cherries.'));
      assert.equal(steps.at(-1), 'No photo fit the article closely enough, so none was placed');
    } finally { rmSync(join(s.fakeDir, 'photo-choice.txt'), { force: true }); }

    /* Searches that find nothing: the second call never runs. */
    before = (await articleOf()).photos.finishedAt ?? 0;
    const n = calls().length;
    commonsMode.empty = true;
    try {
      assert.equal((await admin.post(`/api/articles/${id}/photos`)).status, 202);
      const a = await photosEnded('done', before);
      assert.deepEqual(a.images, []);
      assert.deepEqual(calls().slice(n).map(c => c.kind), ['photo-queries']);
    } finally { commonsMode.empty = false; }
  });

  /* Every CLI call takes 2.5 s. Research asked for while the article is being written runs right after it, so the
     article's photo job waits in the queue (behind the research) that long. Returns the article and the research id. */
  const st = async () => (await admin.get('/api/state')).data as { requests: Json[]; articles: Article[] };
  async function photosWaiting(keyword: string): Promise<{ aid: number; research: number }> {
    const rid = (await st()).requests.find(r => r.status === 'done' && r.siteId === 's1')!.id as number;
    writeFileSync(join(s.fakeDir, 'delay'), '2500');
    const created = await admin.post('/api/articles', { siteId: 's1', domain: 'kopi.example', country: 'Indonesia', lang: 'Indonesian', siteTopic: 'Coffee', keyword, requestId: rid, model: 'GPT-6.1 Sol' });
    const aid = (created.data.article as Article).id;
    const r = await admin.post('/api/requests', { siteId: 's1', domain: 'kopi.example', country: 'Indonesia', lang: 'Indonesian', siteTopic: 'Coffee', topic: keyword + ' more', goal: 'x' });
    const written = await until('the article in review', async () => (await st()).articles.find(a => a.id === aid && a.status === 'review'));
    assert.equal(written.photos.status, 'queued');
    return { aid, research: (r.data.request as Json).id as number };
  }
  /** Once the queue is empty: the photo job never ran and "Find photos" is not refused as "already looking". */
  async function neverRan(aid: number, research: number): Promise<Article> {
    await until('the research', async () => (await st()).requests.find(x => x.id === research && x.status === 'done'));
    await until('an empty queue', async () => (await st()).articles.every(a => a.status !== 'revision' && a.status !== 'work' && a.photos.status !== 'work'));
    const a = (await st()).articles.find(x => x.id === aid)!;
    assert.deepEqual([a.photos.status, a.photos.queuedAt], ['', null]);
    assert.ok(!a.history.some(e => e.action === 'photos'), 'it never runs');
    const find = await admin.post(`/api/articles/${aid}/photos`);
    assert.equal(find.status, 409);
    assert.match(String(find.data.error), /once the article is written/);
    return a;
  }

  it('drops a photo job still waiting in the queue when its article is rejected', async () => {
    try {
      const { aid, research } = await photosWaiting('rasio cold brew');
      const rejected = await admin.post(`/api/articles/${aid}/reject`, { note: 'Not for this site.' });
      assert.equal(rejected.status, 200);
      const a = rejected.data.article as Article;
      assert.deepEqual([a.status, a.photos.status, a.photos.queuedAt], ['rejected', '', null]);
      rmSync(join(s.fakeDir, 'delay'), { force: true });
      assert.equal((await neverRan(aid, research)).status, 'rejected');
    } finally { rmSync(join(s.fakeDir, 'delay'), { force: true }); }
  });

  it('drops it too when the revision it waited for fails', async () => {
    try {
      const { aid, research } = await photosWaiting('lama rendam cold brew');
      /* While a revision is waiting, the old version's photo job waits with it (the revision queues a new one). */
      const revised = await reviewer.post(`/api/articles/${aid}/revise`, { note: 'Add the steeping time.' });
      assert.equal(revised.status, 200);
      assert.deepEqual([(revised.data.article as Article).status, (revised.data.article as Article).photos.status], ['revision', 'queued']);
      writeFileSync(join(s.fakeDir, 'article.txt'), 'I cannot write this article.');
      rmSync(join(s.fakeDir, 'delay'), { force: true });
      assert.equal((await neverRan(aid, research)).status, 'failed');
    } finally { rmSync(join(s.fakeDir, 'delay'), { force: true }); rmSync(join(s.fakeDir, 'article.txt'), { force: true }); }
  });
});

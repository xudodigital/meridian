// Unit tests of the website generator (sitebuild.ts), the theme (theme.ts) and the icon encoder (png.ts): pure
// functions, no server. Hostile text from a model must stay text, every internal link must resolve, and the SEO and
// performance rules the pages promise must hold. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inflateSync } from 'node:zlib';
import type { ArticleContent } from './article-content.ts';
import { encodePng, iconSvg, monogram } from './png.ts';
import {
  ENGLISH_LABELS, buildSite, checkSite, identityFrom, isoDate, langTag, rebaseRootUrls, type SiteArticle, type SiteFiles, type SitePhoto,
} from './sitebuild.ts';
import { isHex, schemes, seedColor } from './theme.ts';

const DAY = 86_400_000, T0 = Date.UTC(2026, 9, 2, 4, 20);
const HOSTILE = `<script>alert("x")</script> & "quotes" 'single' </script><img src=x onerror=alert(1)>`;

function content(over: Partial<ArticleContent> = {}): ArticleContent {
  return {
    title: 'Cara Membuat Cold Brew', titleEn: 'How to make cold brew', titleTag: 'Cara Membuat Cold Brew | Kopi',
    metaDescription: 'Rasio, lama rendam dan cara menyimpan.', slug: 'cara-membuat-cold-brew',
    byline: { text: 'Tim redaksi', en: 'Editorial team' }, disclosure: { text: 'Disusun dengan bantuan AI.', en: 'Drafted with AI.' },
    blocks: [
      { type: 'p', text: 'Cold brew dibuat dengan air dingin.', en: '' },
      { type: 'h2', text: 'Takaran', en: '' },
      { type: 'p', text: 'Rasio 1:8.', en: '' },
      { type: 'h2', text: 'Penyimpanan', en: '' },
      { type: 'list', items: [{ text: 'Kulkas', en: '' }] },
      { type: 'table', rows: [[{ text: 'Waktu', en: '' }, { text: 'Rasa', en: '' }], [{ text: '12 jam', en: '' }, { text: 'Ringan', en: '' }]] },
    ],
    sources: [{ title: 'AEKI', url: 'https://www.aeki-aice.org/cold-brew/' }, { title: 'Bad', url: 'javascript:alert(1)' }],
    reviewerNotes: ['Never published: check the ratio.'],
    ...over,
  };
}
function photo(over: Partial<SitePhoto> = {}): SitePhoto {
  return {
    id: 'p1', role: 'hero', after: null, file: 'kebun-kopi-1a2b3c4d', ext: 'jpg', widths: [960, 1280], width: 1280, height: 853,
    alt: 'Kebun kopi di lereng gunung', caption: 'Kebun kopi arabika.', title: 'Coffee farm', author: 'A. Person',
    authorUrl: 'https://commons.wikimedia.org/wiki/User:A', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Coffee.jpg', provider: 'Wikimedia Commons', ...over,
  };
}
const identity = identityFrom({
  name: 'Kopi Nusantara', tagline: 'Panduan kopi', description: 'Artikel tentang kopi Indonesia.', about: ['Tentang situs ini.'],
  sourceColor: '#8b5a2b', fonts: 'editorial', labels: { home: 'Beranda', about: 'Tentang kami', latest: 'Terbaru', published: 'Terbit', updated: 'Diperbarui', by: 'Oleh', photo: 'Foto' },
}, 'kopi.example');

const articles = (): SiteArticle[] => [
  { id: 2, published: T0, updated: null, content: content(), images: [photo(), photo({ id: 'p2', role: 'inline', after: 2, file: 'rasio-kopi-5e6f7a8b', ext: 'png', widths: [960], width: 960, height: 640, alt: 'Takaran kopi dan air' })] },
  { id: 1, published: T0 - 5 * DAY, updated: T0 - DAY, content: content({ title: 'Arabika dan Robusta', slug: 'arabika-robusta', titleTag: '' }), images: [] },
];
const media = (_id: number, name: string) => /-(960|1280)\.(jpg|png)$/.test(name) ? Buffer.from('image bytes of ' + name) : null;
const site = (over: Partial<Parameters<typeof buildSite>[0]> = {}): SiteFiles =>
  buildSite({ domain: 'kopi.example', country: 'Indonesia', lang: 'Indonesian', identity, identityUpdatedAt: T0 - 30 * DAY, articles: articles(), media, ...over });
const html = (f: SiteFiles, p: string) => { const v = f.get(p); assert.ok(v !== undefined, 'missing ' + p); return String(v); };
const ld = (page: string) => [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]!) as Record<string, unknown>);

describe('site generator', () => {
  it('writes every page and file of a site, and the result passes its own check', () => {
    const f = site();
    for (const p of ['index.html', 'cara-membuat-cold-brew/index.html', 'arabika-robusta/index.html', 'tentang-kami/index.html', '404.html',
      'sitemap.xml', 'robots.txt', '_headers', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest',
      'media/kebun-kopi-1a2b3c4d-960.jpg', 'media/kebun-kopi-1a2b3c4d-1280.jpg', 'media/rasio-kopi-5e6f7a8b-960.png']) assert.ok(f.has(p), p);
    assert.ok([...f.keys()].some(k => /^assets\/site\.[0-9a-f]{8}\.css$/.test(k)), 'fingerprinted CSS');
    assert.deepEqual(checkSite(f, 'kopi.example'), []);
  });

  it('escapes hostile text everywhere and links only http(s) URLs', () => {
    const evil = content({
      title: HOSTILE, titleTag: HOSTILE, metaDescription: HOSTILE, byline: { text: HOSTILE, en: '' }, disclosure: { text: HOSTILE, en: '' },
      blocks: [{ type: 'p', text: HOSTILE, en: '' }, { type: 'h2', text: HOSTILE, en: '' }, { type: 'list', items: [{ text: HOSTILE, en: '' }] },
        { type: 'table', rows: [[{ text: HOSTILE, en: '' }], [{ text: HOSTILE, en: '' }]] }],
      sources: [{ title: HOSTILE, url: 'https://example.org/?q="><script>' }, { title: 'js', url: 'javascript:alert(1)' }, { title: 'data', url: 'data:text/html,hi' }],
    });
    const evilPhoto = photo({ alt: HOSTILE, caption: HOSTILE, title: HOSTILE, author: HOSTILE, license: HOSTILE, sourceUrl: 'javascript:alert(1)', authorUrl: 'data:x', licenseUrl: 'vbscript:x' });
    const evilId = identityFrom({ ...identity, name: HOSTILE, tagline: HOSTILE, description: HOSTILE, about: [HOSTILE], labels: { ...identity.labels, home: HOSTILE, about: HOSTILE } }, 'kopi.example');
    const f = site({ identity: evilId, articles: [{ id: 7, published: T0, updated: null, content: evil, images: [evilPhoto] }] });
    for (const [p, v] of f) {
      if (!p.endsWith('.html')) continue;
      const page = String(v);
      assert.ok(!page.includes('<script>alert'), p + ' has a raw script');
      assert.ok(!/<img src=x/.test(page), p + ' has a raw img');
      /* With attribute values blanked out, no tag carries an event handler. */
      assert.ok(!/<[a-z][^>]*\son[a-z]+=/i.test(page.replace(/"[^"]*"/g, '""')), p + ' has an event handler');
      assert.ok(!/href="(javascript|data|vbscript):/i.test(page), p + ' links a script URL');
      /* The only scripts are JSON-LD, and each still parses (a "</script>" in a title cannot end it). */
      assert.equal((page.match(/<script\b/g) ?? []).length, (page.match(/<script type="application\/ld\+json">/g) ?? []).length, p);
      for (const x of ld(page)) assert.ok(x['@type'], p);
    }
    const art = [...f.keys()].find(k => k.endsWith('/index.html') && html(f, k).includes('og:type" content="article'))!;
    const page = html(f, art);
    assert.ok(page.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
    assert.ok(page.includes('href="https://example.org/?q=%22%3E%3Cscript%3E"'), 'URL normalised and escaped');
    assert.ok(!page.includes('Never published'), 'reviewer notes are never published');
    assert.deepEqual(checkSite(f, 'kopi.example'), []);
  });

  it('makes links relative, so the files work at the root and under a preview path', () => {
    const f = site();
    const art = html(f, 'cara-membuat-cold-brew/index.html');
    assert.match(art, /<link rel="stylesheet" href="\.\.\/assets\/site\.[0-9a-f]{8}\.css">/);
    assert.ok(art.includes('href="../tentang-kami/"'));
    assert.ok(art.includes('<a href="../">Beranda</a>'));
    const home = html(f, 'index.html');
    assert.ok(home.includes('href="cara-membuat-cold-brew/"'));
    assert.ok(home.includes('href="./"'));
    assert.ok(!/(href|src)="\/[^/]/.test(home), 'no root-relative URL on the home page');
    /* Absolute URLs only where they must be. */
    assert.ok(art.includes('<link rel="canonical" href="https://kopi.example/cara-membuat-cold-brew/">'));
    assert.ok(art.includes('<meta property="og:image" content="https://kopi.example/media/kebun-kopi-1a2b3c4d-1280.jpg">'));
    /* A broken link is caught. */
    const broken = new Map(f);
    broken.set('index.html', home.replace('href="cara-membuat-cold-brew/"', 'href="gone/"'));
    assert.ok(checkSite(broken, 'kopi.example').some(p => p.includes('gone/')));
  });

  it('serves the 404 page from the root, and the preview can move it', () => {
    const f = site();
    const nf = html(f, '404.html');
    assert.match(nf, /<meta name="robots" content="noindex">/);
    assert.ok(!nf.includes('rel="canonical"'));
    assert.match(nf, /href="\/assets\/site\.[0-9a-f]{8}\.css"/);
    const moved = rebaseRootUrls(nf, '/api/preview/s1/3/');
    assert.match(moved, /href="\/api\/preview\/s1\/3\/assets\/site\.[0-9a-f]{8}\.css"/);
    assert.ok(moved.includes('<a class="btn" href="/api/preview/s1/3/">'));
    assert.ok(!/(href|src)="\/(?!api\/preview\/s1\/3\/)/.test(moved), 'every root URL moved');
    assert.ok(!/srcset="[^"]*(^|, )\/media/.test(moved));
  });

  it('has exactly one h1 per page, a title, a language and a canonical', () => {
    const f = site();
    for (const [p, v] of f) {
      if (!p.endsWith('.html')) continue;
      const page = String(v);
      assert.equal((page.match(/<h1[\s>]/g) ?? []).length, 1, p);
      assert.match(page, /<html lang="id" dir="ltr">/, p);
      if (p !== '404.html') assert.match(page, /<link rel="canonical" href="https:\/\/kopi\.example\//, p);
    }
    assert.ok(html(f, 'index.html').includes('<h1>Kopi Nusantara</h1>'));
    assert.ok(html(f, 'cara-membuat-cold-brew/index.html').includes('<h1>Cara Membuat Cold Brew</h1>'));
  });

  it('marks up articles: dates, byline, breadcrumbs, BlogPosting and WebSite only on the home page', () => {
    const f = site();
    const art = html(f, 'arabika-robusta/index.html');
    const [posting, crumbs] = ld(art) as [Record<string, unknown>, Record<string, unknown>];
    assert.equal(posting['@type'], 'BlogPosting');
    assert.equal(posting.headline, 'Arabika dan Robusta');
    assert.equal(posting.datePublished, isoDate(T0 - 5 * DAY, 'Asia/Jakarta'));
    assert.equal(posting.dateModified, isoDate(T0 - DAY, 'Asia/Jakarta'));
    assert.match(String(posting.datePublished), /^2026-09-27T11:20:00\+07:00$/);
    assert.equal(posting.inLanguage, 'id');
    assert.deepEqual(posting.author, [{ '@type': 'Organization', name: 'Kopi Nusantara', url: 'https://kopi.example/' }]);
    assert.deepEqual((posting.mainEntityOfPage as Record<string, unknown>)['@id'], 'https://kopi.example/arabika-robusta/');
    assert.equal(crumbs['@type'], 'BreadcrumbList');
    assert.equal((crumbs.itemListElement as unknown[]).length, 2);
    /* Visible dates match the structured data. */
    assert.ok(art.includes(`Terbit <time datetime="${posting.datePublished}">27 September 2026</time>`));
    assert.ok(art.includes(`Diperbarui <time datetime="${posting.dateModified}">`));
    assert.ok(art.includes('<title>Arabika dan Robusta | Kopi Nusantara</title>'), 'a title tag from the title and site name when the agent gave none');
    assert.ok(art.includes('Oleh Tim redaksi'));
    assert.ok(art.includes('<li aria-current="page">Arabika dan Robusta</li>'));
    assert.deepEqual(ld(html(f, 'index.html')).map(x => x['@type']), ['WebSite']);
    assert.ok(!ld(art).some(x => x['@type'] === 'WebSite'));
    assert.match(art, /<a href="https:\/\/www\.aeki-aice\.org\/cold-brew\/">AEKI<\/a>/);
    assert.ok(!art.includes('javascript:'));
    assert.ok(art.includes('Disusun dengan bantuan AI.'));
  });

  it('gives photos srcset, width, height, alt and credits, and loads only the hero eagerly', () => {
    const f = site();
    const art = html(f, 'cara-membuat-cold-brew/index.html');
    const imgs = [...art.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
    const hero = imgs.find(i => i.includes('kebun-kopi'))!;
    assert.ok(hero.includes('srcset="../media/kebun-kopi-1a2b3c4d-960.jpg 960w, ../media/kebun-kopi-1a2b3c4d-1280.jpg 1280w"'));
    assert.ok(hero.includes('src="../media/kebun-kopi-1a2b3c4d-1280.jpg"'));
    assert.ok(hero.includes('width="1280" height="853"'));
    assert.ok(hero.includes('fetchpriority="high"'));
    assert.ok(!hero.includes('loading='));
    assert.ok(hero.includes('sizes="'));
    const inline = imgs.find(i => i.includes('rasio-kopi'))!;
    assert.ok(inline.includes('loading="lazy"') && inline.includes('decoding="async"') && !inline.includes('fetchpriority'));
    assert.ok(inline.includes('alt="Takaran kopi dan air"'));
    /* The inline photo sits right after block 2 (the paragraph under "Takaran"). */
    const body = art.slice(art.indexOf('<div class="prose">'));
    assert.ok(body.indexOf('Rasio 1:8.') < body.indexOf('rasio-kopi') && body.indexOf('rasio-kopi') < body.indexOf('Penyimpanan'));
    assert.equal(imgs.filter(i => i.includes('fetchpriority="high"')).length, 1);
    for (const i of imgs) { assert.match(i, /\salt="/); assert.match(i, /\swidth="\d+" height="\d+"/); }
    assert.ok(art.includes('<figcaption><span>Kebun kopi arabika.</span><span class="credit">Foto: <a href="https://commons.wikimedia.org/wiki/File:Coffee.jpg">Coffee farm</a> · <a rel="ugc nofollow" href="https://commons.wikimedia.org/wiki/User:A">A. Person</a> · <a rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> · Wikimedia Commons · Ukuran dan format foto disesuaikan untuk web.</span></figcaption>'));
    assert.ok(art.includes('<th scope="col">Waktu</th>'));
    /* The latest article's photo is the LCP image of the home page; card photos are lazy. */
    const home = html(f, 'index.html');
    assert.equal((home.match(/fetchpriority="high"/g) ?? []).length, 1);
    /* Wherever a photo is shown small (the home page's feature, cards), its credit links its source page and its
       license, as CC BY and BY-SA ask of every copy shown. */
    const short = '<p class="card__credit">Foto: <a href="https://commons.wikimedia.org/wiki/File:Coffee.jpg">A. Person</a> · <a rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> · Ukuran dan format foto disesuaikan untuk web.</p>';
    assert.ok(home.includes(short), 'home feature');
    assert.ok(html(f, 'arabika-robusta/index.html').includes(short), 'card in the band of more articles');
    assert.ok(html(f, '404.html').includes(short), 'card on the not-found page');
    const css = html(f, [...f.keys()].find(k => k.startsWith('assets/'))!);
    assert.match(css, /\.card__credit a \{ position: relative; z-index: 2;/, 'credit links above the link that covers the card');
    /* No source page and a public domain mark without a deed: plain text, never an empty link. */
    const pd = site({ articles: [{ id: 9, published: T0, updated: null, content: content(), images: [photo({ author: '', sourceUrl: '', license: 'Public domain', licenseUrl: '' })] }] });
    assert.ok(html(pd, 'index.html').includes('<p class="card__credit">Foto: Coffee farm · Public domain · Ukuran dan format foto disesuaikan untuk web.</p>'));
    /* A photo whose files are missing is left out instead of breaking the page. */
    const none = site({ media: () => null });
    assert.ok(!html(none, 'cara-membuat-cold-brew/index.html').includes('<img src="../media'));
    assert.deepEqual(checkSite(none, 'kopi.example'), []);
    /* So is a photo without alt text, and its files are not copied into the site. */
    const noAlt = site({ articles: [{ id: 2, published: T0, updated: null, content: content(), images: [photo(), photo({ id: 'p2', role: 'inline', after: 0, file: 'tanpa-alt-9f9f9f9f', alt: ' ' })] }] });
    assert.ok(noAlt.has('media/kebun-kopi-1a2b3c4d-960.jpg'));
    assert.ok(![...noAlt.keys()].some(k => k.includes('tanpa-alt')));
  });

  it('lists exactly the indexable pages in the sitemap, with images, and points robots.txt at it', () => {
    const f = site();
    const map = html(f, 'sitemap.xml');
    const locs = [...map.matchAll(/<url><loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    assert.deepEqual(locs, ['https://kopi.example/', 'https://kopi.example/cara-membuat-cold-brew/', 'https://kopi.example/arabika-robusta/', 'https://kopi.example/tentang-kami/']);
    assert.ok(map.includes('<image:loc>https://kopi.example/media/kebun-kopi-1a2b3c4d-1280.jpg</image:loc>'));
    assert.ok(map.includes(`<loc>https://kopi.example/arabika-robusta/</loc><lastmod>${isoDate(T0 - DAY, 'Asia/Jakarta')}</lastmod>`));
    assert.ok(!map.includes('404'));
    assert.equal(html(f, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://kopi.example/sitemap.xml\n');
    const headers = html(f, '_headers');
    assert.match(headers, /\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
    assert.match(headers, /X-Content-Type-Options: nosniff/);
    /* Every page: no script, nothing from another host, no frame around it. */
    assert.ok(headers.includes("/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\n"));
    /* A sitemap that misses a page is caught. */
    const bad = new Map(f); bad.set('sitemap.xml', map.replace('<url><loc>https://kopi.example/tentang-kami/</loc>', '<url><loc>https://kopi.example/x/</loc>'));
    assert.equal(checkSite(bad, 'kopi.example').length, 2);
  });

  it('gives each article its own folder, away from the folders the site itself uses', () => {
    const f = site({ articles: [
      { id: 3, published: T0, updated: null, content: content({ slug: 'assets' }), images: [] },
      { id: 2, published: T0 - DAY, updated: null, content: content({ slug: 'kopi' }), images: [] },
      { id: 1, published: T0 - 2 * DAY, updated: null, content: content({ slug: 'kopi' }), images: [] },
      { id: 4, published: T0 - 3 * DAY, updated: null, content: content({ slug: 'tentang-kami' }), images: [] },
      { id: 5, published: T0 - 4 * DAY, updated: null, content: content({ slug: '', title: 'กาแฟเย็น' }), images: [] },
    ] });
    for (const p of ['assets-2/index.html', 'kopi/index.html', 'kopi-2/index.html', 'tentang-kami-2/index.html', 'tentang-kami/index.html', 'กาแฟเย็น/index.html']) assert.ok(f.has(p), p);
    assert.ok(html(f, 'index.html').includes(`href="${encodeURIComponent('กาแฟเย็น')}/"`));
    assert.deepEqual(checkSite(f, 'kopi.example'), []);
  });

  it('never uses cdn-cgi/, which Cloudflare answers itself, and the check catches it', () => {
    const f = site({
      identity: { ...identity, labels: { ...identity.labels, about: 'CDN CGI' } },
      articles: [{ id: 3, published: T0, updated: null, content: content({ slug: 'cdn-cgi' }), images: [] }],
    });
    assert.ok(f.has('cdn-cgi-2/index.html') && f.has('about/index.html'));
    assert.ok(![...f.keys()].some(k => k.startsWith('cdn-cgi/')));
    assert.deepEqual(checkSite(f, 'kopi.example'), []);
    const bad = new Map(f); bad.set('cdn-cgi/index.html', html(f, 'cdn-cgi-2/index.html'));
    assert.ok(checkSite(bad, 'kopi.example').some(p => p.includes('cdn-cgi/ is an address Cloudflare keeps for itself')));
  });

  it('gives headings ids that never repeat an id the page itself uses', () => {
    const english = identityFrom({ name: 'Coffee Guide', labels: {} }, 'kopi.example');
    const blocks = ['Main', 'How', 'Sources', 'More', 'Latest', 'All', 'Toc title', 'How'].flatMap(t => [{ type: 'h2' as const, text: t, en: '' }, { type: 'p' as const, text: 'x', en: '' }]);
    const f = site({ identity: english, lang: 'English', country: 'United States', articles: [
      { id: 1, published: T0, updated: null, content: content({ slug: 'guide', blocks, disclosure: { text: 'Made with AI.', en: '' } }), images: [] },
      { id: 2, published: T0 - DAY, updated: null, content: content({ slug: 'other' }), images: [] },
    ] });
    assert.deepEqual(checkSite(f, 'kopi.example'), []);
    const art = html(f, 'guide/index.html');
    const ids = [...art.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]!);
    assert.equal(new Set(ids).size, ids.length, ids.join(' '));
    for (const own of ['main', 'how', 'sources', 'more', 'toc-title']) assert.ok(ids.includes(own), own);
    assert.ok(art.includes('<h2 id="how-2">How</h2>') && art.includes('<h2 id="how-3">How</h2>') && art.includes('<h2 id="sources-2">Sources</h2>'));
    assert.ok(art.includes('<a href="#more-2">More</a>'), 'the table of contents links the heading, not the band');
    assert.ok(art.includes('aria-labelledby="sources"><h2 id="sources">Sources</h2>'));
    /* A page with an id used twice is caught. */
    const bad = new Map(f); bad.set('guide/index.html', art.replace('<h2 id="how-2">', '<h2 id="how">'));
    assert.ok(checkSite(bad, 'kopi.example').some(p => p === 'guide/index.html: the id "how" is used twice.'));
  });

  it('writes the language tag and direction of the site language', () => {
    assert.deepEqual(langTag('Indonesian', 'Indonesia'), { tag: 'id', dir: 'ltr' });
    assert.deepEqual(langTag('Portuguese', 'Brazil'), { tag: 'pt-BR', dir: 'ltr' });
    assert.deepEqual(langTag('Portuguese', 'Portugal'), { tag: 'pt', dir: 'ltr' });
    assert.deepEqual(langTag('Spanish', 'Mexico'), { tag: 'es-MX', dir: 'ltr' });
    assert.deepEqual(langTag('Arabic', 'Egypt'), { tag: 'ar', dir: 'rtl' });
    assert.deepEqual(langTag('Urdu', 'Pakistan'), { tag: 'ur', dir: 'rtl' });
    assert.deepEqual(langTag('Filipino', 'Philippines'), { tag: 'fil', dir: 'ltr' });
    assert.deepEqual(langTag('Klingon', 'Nowhere'), { tag: 'und', dir: 'ltr' });
    const f = site({ lang: 'Arabic', country: 'Egypt' });
    assert.match(html(f, 'index.html'), /<html lang="ar" dir="rtl">/);
  });

  it('has no JavaScript and makes no request to another host', () => {
    const f = site();
    for (const [p, v] of f) {
      if (!p.endsWith('.html') && !p.endsWith('.css')) continue;
      const t = String(v);
      assert.ok(!/<script(?![^>]*application\/ld\+json)/.test(t), p);
      assert.ok(!/\son[a-z]+=/i.test(t), p + ' has an event handler');
      /* Outside URLs appear only as links (<a>) and in head metadata, never as a resource the page loads. */
      assert.ok(!/<(img|link|source)\b[^>]*(src|href)="https?:\/\/(?!kopi\.example)/.test(t.replace(/<link rel="canonical"[^>]*>/, '')), p);
      assert.ok(!/@import|url\(https?:/.test(t), p);
    }
  });

  it('uses an HCT theme from the source colour, with light and dark schemes', () => {
    const { light, dark } = schemes('#8b5a2b');
    assert.equal(Object.keys(light).length, 33);
    for (const v of [...Object.values(light), ...Object.values(dark)]) assert.ok(isHex(v), v);
    assert.notEqual(light.primary, dark.primary);
    const css = String([...site()].find(([k]) => k.startsWith('assets/'))![1]);
    assert.ok(css.includes(`--md-sys-color-primary: ${light.primary};`));
    assert.ok(css.includes(`--md-sys-color-primary: ${dark.primary};`));
    assert.match(css, /@media \(prefers-color-scheme: dark\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /:focus-visible/);
    assert.ok(!/text-transform:\s*uppercase/.test(css));
    assert.ok(css.includes('"Iowan Old Style"'));
  });
  it('ships the skill token layer, adaptive breakpoints and complete interactive states', () => {
    const f = site();
    const css = String([...f].find(([k]) => k.endsWith('.css'))![1]);
    assert.match(css, /--md-sys-typescale-label-small:/);
    assert.match(css, /--md-sys-shape-corner-extra-large-increased:/);
    for (const width of [600,840,1200,1600]) assert.ok(css.includes(`min-width: ${width}px`));
    for (const state of ['hover','focus','pressed']) assert.ok(css.includes(`var(--md-sys-state-${state}-opacity)`));
    assert.match(css, /\.toc a[^}]+min-height: 48px/);
    assert.match(css, /\.cats a[^}]+min-height: 48px/);
    assert.ok(!/border-radius:\s*(?:10|11)px/.test(css));
    assert.ok(!/text-overflow:\s*ellipsis/.test(css));
    const key = [...f.keys()].find(k => k.endsWith('.css'))!;
    f.set(key, css.replace('--md-sys-state-focus-opacity:', '--removed-focus-opacity:'));
    assert.ok(checkSite(f,'kopi.example').some(p => p.includes('undefined design token --md-sys-state-focus-opacity')));
  });
  it('keeps text/background contrast for the generated light and dark roles across brand colours', () => {
    const lum = (hex: string) => {
      const channels = hex.slice(1).match(/../g)!.map(v => parseInt(v,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
      return channels[0]!*.2126+channels[1]!*.7152+channels[2]!*.0722;
    };
    for (const seed of ['#8b5a2b','#ffffff','#000000','#00ff00','#ff0000','#006d77']) {
      for (const palette of Object.values(schemes(seed))) {
        for (const [bg,fg] of [['primary','on-primary'],['surface','on-surface'],['surface-container-low','on-surface-variant'],['primary-container','on-primary-container']]) {
          const a=lum(palette[bg!]!), b=lum(palette[fg!]!);
          assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5, `${seed}: ${bg}/${fg}`);
        }
      }
    }
  });

  it('turns an incomplete identity answer into a usable one', () => {
    const id = identityFrom({ name: '  ', sourceColor: 'red', fonts: 'comic', labels: { home: 'Inicio', about: 42 } }, 'cafe-de-mexico.mx');
    assert.equal(id.name, 'Cafe De Mexico');
    assert.ok(isHex(id.sourceColor));
    assert.equal(id.sourceColor, seedColor('cafe-de-mexico.mx'));
    assert.equal(id.fonts, 'editorial');
    assert.equal(id.labels.home, 'Inicio');
    assert.equal(id.labels.about, ENGLISH_LABELS.about);
    assert.deepEqual(id.about, []);
    assert.deepEqual(identityFrom(null, 'x.example').labels, ENGLISH_LABELS);
  });

  it('draws the favicon as PNG-in-ICO (48, 32, 16), with the site initial', () => {
    const f = site();
    const ico = f.get('favicon.ico') as Buffer;
    assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 3]);
    const sizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const e = 6 + 16 * i, len = ico.readUInt32LE(e + 8), off = ico.readUInt32LE(e + 12);
      const png = ico.subarray(off, off + len);
      assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
      assert.equal(png.readUInt32BE(16), ico[e]);
      sizes.push(ico[e]!);
    }
    assert.deepEqual(sizes, [48, 32, 16]);
    const touch = f.get('apple-touch-icon.png') as Buffer;
    assert.equal(touch.readUInt32BE(16), 180);
    assert.equal(monogram('Kopi Nusantara', 'kopi.example'), 'K');
    assert.equal(monogram('Échos', 'x.example'), 'E');
    assert.equal(monogram('กาแฟ', 'kafe.co.th'), 'K');
    assert.equal(monogram('กาแฟ', 'xn--12c.th'), '');
    assert.match(iconSvg('K', '#8b5a2b', '#ffffff'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64">/);
    const manifest = JSON.parse(html(f, 'site.webmanifest')) as Record<string, unknown>;
    assert.equal(manifest.name, 'Kopi Nusantara');
    assert.equal(manifest.lang, 'id');
  });

  it('encodes PNG files that decode to the same pixels', () => {
    const px = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) & 255);
    const png = encodePng(3, 2, px);
    const at = png.indexOf('IDAT'), len = png.readUInt32BE(at - 4);
    const raw = inflateSync(png.subarray(at + 4, at + 4 + len));
    /* Undo the Sub filter of each row. */
    const out: number[] = [];
    for (let y = 0; y < 2; y++) {
      const row = raw.subarray(y * 13 + 1, y * 13 + 13);
      assert.equal(raw[y * 13], 1);
      for (let i = 0; i < 12; i++) out.push((row[i]! + (i >= 4 ? out[y * 12 + i - 4]! : 0)) & 255);
    }
    assert.deepEqual(out, [...px]);
  });
});

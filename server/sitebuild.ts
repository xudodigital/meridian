// The website generator: a pure function from a site's identity and approved articles to the files of a static
// site (HTML, CSS, sitemap, robots.txt, icons, photos, Cloudflare Pages _headers). Nothing here touches the disk or
// the database, so it is easy to test; builds.ts reads the inputs and writes the output.
//
// What the pages follow (skills: google-seo, site-architecture, on-page-audit, images-and-alt-text, internal-linking,
// web-performance, material-3-web): one h1 and one language per page, self-referencing absolute canonical, accurate
// visible dates that match the structured data, real <a href> links with descriptive anchors, every image with alt,
// width and height, the LCP photo never lazy and fetched with high priority, a sitemap of exactly the indexable pages,
// fingerprinted CSS, no JavaScript and no request to another host. The theme is Material 3 from the site's source
// colour (theme.ts), light and dark.
//
// Every internal link and asset URL is relative to the page, so the same files work at the domain root and under
// Meridian's preview path. The 404 page is the exception: Cloudflare Pages serves it for any missing path at any
// depth, so its URLs start at the root ("/assets/…"); the preview rewrites them (build-api.ts).
//
// Text comes from a model: every value is escaped for HTML text or attributes, and only http(s) URLs become links.
//
// Structure (skills site-architecture and internal-linking): articles keep their flat URLs; each category has a page
// at /<category-slug>/ that links to all its articles; an article's breadcrumbs are Home, its category, the article,
// with the same trail as BreadcrumbList; the end of an article links to related articles (its category first). Links
// inside the text are stored as ranges (article-content.ts Link) and written here as <a href>: relative for another
// article of this build, the address itself for a web page. A link to an article that is not in the build (not
// approved) is written as plain text, so no page ever links to a page that does not exist.
import { createHash } from 'node:crypto';
import { readSkillFile } from './skill-files.ts';
import { categoryKey, categoryName, httpUrl, slugify, type ArticleContent, type Block, type Link } from './article-content.ts';
import { encodeIco, iconPng, iconSvg, monogram } from './png.ts';
import { FONT_PAIRINGS, FONTS, isHex, langHeight, rgbOf, schemes, seedColor, tokens, type FontPairing } from './theme.ts';

/* ---------- Inputs ---------- */

/** Words the pages use around the content, in the site's language (the Site Builder writes them once per site). */
export type Labels = {
  home: string; articles: string; latest: string; about: string; sources: string; published: string; updated: string;
  photo: string; by: string; license: string; notFoundTitle: string; notFoundText: string; backHome: string;
  menu: string; skip: string; breadcrumbs: string; disclosure: string; onThisPage: string;
  /** The heading of the related articles at the end of an article. Sites set up before it existed have none (relatedLabel). */
  related?: string;
  /** Describes resizing/encoding of the openly licensed source photo. */
  photoChanges?: string;
};
export const ENGLISH_LABELS: Labels = {
  home: 'Home', articles: 'Articles', latest: 'Latest', about: 'About', sources: 'Sources', published: 'Published',
  updated: 'Updated', photo: 'Photo', by: 'By', license: 'License', notFoundTitle: 'Page not found',
  notFoundText: 'This page does not exist or has moved. The articles below may help.', backHome: 'Back to the home page',
  menu: 'Main menu', skip: 'Skip to content', breadcrumbs: 'Breadcrumbs', disclosure: 'How this article was made',
  onThisPage: 'On this page',
};
const LABEL_KEYS = Object.keys(ENGLISH_LABELS) as (keyof Labels)[];

/** A site's identity: chosen once by the Site Builder, in the site's language (table site_identity). */
export type SiteIdentity = {
  name: string; tagline: string; description: string; about: string[];
  sourceColor: string; fonts: FontPairing; labels: Labels;
};

/** A photo of an article as stored by the photo job (app/src/store/types.ts PhotoWire). */
export type SitePhoto = {
  id: string; role: 'hero' | 'inline'; after: number | null; file: string; ext: 'jpg' | 'png'; widths: number[];
  width: number; height: number; alt: string; caption: string;
  title: string; author: string; authorUrl: string; license: string; licenseUrl: string; sourceUrl: string; provider: string;
};
export type SiteArticle = {
  id: number; content: ArticleContent; images: SitePhoto[];
  /** The site category it belongs to; '' or missing for none. */
  category?: string;
  /** When it was first approved, and when it was approved again later (null when never). Milliseconds. */
  published: number; updated: number | null;
};
export type SiteInput = {
  domain: string;
  /** English names, as in the sites document. */
  country: string; lang: string;
  identity: SiteIdentity;
  /** When the identity was last changed (the about page's date). */
  identityUpdatedAt: number;
  /** Newest first. */
  articles: SiteArticle[];
  /** The bytes of a stored photo file of an article ("<file>-<width>.<ext>"), or null when it is missing. */
  media: (articleId: number, name: string) => Buffer | null;
};
export type SiteFiles = Map<string, Buffer | string>;

/** A stored photo file name: a slug, the width, the extension. Nothing else is ever read or written. */
export const MEDIA_NAME = /^[a-z0-9\p{L}\p{M}-]+-\d{2,4}\.(jpg|png)$/u;

/* ---------- Small helpers ---------- */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Text or an attribute value, escaped. */
export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]!);
const line = (v: unknown, n: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** A string from the agent's answer, one line, clipped; '' for anything that is not a string. */
const str = (v: unknown, n: number): string => typeof v === 'string' ? line(v, n) : '';
/** JSON for a <script type="application/ld+json">: nothing in it can end the element. */
const ldJson = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
/** A path segment for a URL (slugs and file names may hold letters of any script). */
const seg = (s: string): string => encodeURIComponent(s);

const LANGS: Record<string, string> = {
  indonesian: 'id', vietnamese: 'vi', thai: 'th', filipino: 'fil', tagalog: 'fil', urdu: 'ur', hindi: 'hi', malay: 'ms',
  english: 'en', arabic: 'ar', turkish: 'tr', bengali: 'bn', bangla: 'bn', japanese: 'ja', korean: 'ko', french: 'fr',
  german: 'de', italian: 'it', dutch: 'nl', russian: 'ru', persian: 'fa', farsi: 'fa', swahili: 'sw', burmese: 'my',
  khmer: 'km', lao: 'lo', nepali: 'ne', sinhala: 'si', tamil: 'ta', polish: 'pl', ukrainian: 'uk', romanian: 'ro',
};
/** The BCP 47 tag of a site's language (from its English name) and its writing direction. */
export function langTag(lang: string, country: string): { tag: string; dir: 'ltr' | 'rtl' } {
  const l = lang.trim().toLowerCase(), c = country.trim().toLowerCase();
  let tag = 'und';
  if (l === 'portuguese') tag = c === 'brazil' ? 'pt-BR' : 'pt';
  else if (l === 'spanish') tag = c === 'mexico' ? 'es-MX' : 'es';
  else if (LANGS[l]) tag = LANGS[l]!;
  else if (/^[a-z]{2,3}(-[a-z]{2})?$/i.test(l)) tag = l.replace(/-([a-z]{2})$/i, (_, r: string) => '-' + r.toUpperCase());
  return { tag, dir: ['ar', 'ur', 'fa', 'he'].includes(tag.split('-')[0]!) ? 'rtl' : 'ltr' };
}

const ZONES: Record<string, string> = {
  indonesia: 'Asia/Jakarta', vietnam: 'Asia/Ho_Chi_Minh', 'viet nam': 'Asia/Ho_Chi_Minh', thailand: 'Asia/Bangkok',
  philippines: 'Asia/Manila', pakistan: 'Asia/Karachi', india: 'Asia/Kolkata', malaysia: 'Asia/Kuala_Lumpur',
  brazil: 'America/Sao_Paulo', mexico: 'America/Mexico_City', turkey: 'Europe/Istanbul', 'türkiye': 'Europe/Istanbul',
  turkiye: 'Europe/Istanbul', bangladesh: 'Asia/Dhaka', egypt: 'Africa/Cairo', 'saudi arabia': 'Asia/Riyadh',
  'united arab emirates': 'Asia/Dubai', nigeria: 'Africa/Lagos', kenya: 'Africa/Nairobi', singapore: 'Asia/Singapore',
  japan: 'Asia/Tokyo', 'south korea': 'Asia/Seoul', spain: 'Europe/Madrid', portugal: 'Europe/Lisbon',
  argentina: 'America/Argentina/Buenos_Aires', colombia: 'America/Bogota', peru: 'America/Lima', chile: 'America/Santiago',
  'united kingdom': 'Europe/London', germany: 'Europe/Berlin', france: 'Europe/Paris', italy: 'Europe/Rome',
  'united states': 'America/New_York', canada: 'America/Toronto', australia: 'Australia/Sydney', myanmar: 'Asia/Yangon',
  cambodia: 'Asia/Phnom_Penh', 'sri lanka': 'Asia/Colombo', nepal: 'Asia/Kathmandu', morocco: 'Africa/Casablanca',
};
/** The time zone readers of a country live in (the main one), for the dates shown and in structured data. */
export const zoneOf = (country: string): string => ZONES[country.trim().toLowerCase()] ?? 'UTC';

/** ISO 8601 with the zone's offset, for example 2026-10-03T11:20:00+07:00. */
export function isoDate(ms: number, zone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset',
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  const off = (parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${off}`;
}
/** A date as readers of the site's language write it ("3 Oktober 2026"). */
function longDate(ms: number, tag: string, zone: string): string {
  try { return new Intl.DateTimeFormat(tag, { dateStyle: 'long', timeZone: zone }).format(new Date(ms)); }
  catch { return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: zone }).format(new Date(ms)); }
}

/* ---------- Identity from the Site Builder's answer ---------- */

/** A site name for a domain when the agent gives none: "kopi-nusantara.id" becomes "Kopi Nusantara". */
const nameFromDomain = (domain: string): string => {
  const base = domain.replace(/^www\./, '').split('.')[0] || domain;
  return base.split(/[-_]+/).filter(Boolean).map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ') || domain;
};

/**
 * Turns the Site Builder's identity answer into a usable identity: everything clipped, a valid colour and font
 * pairing, and English labels for any label it left out. Never throws.
 */
export function identityFrom(raw: unknown, domain: string): SiteIdentity {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const lb = o.labels && typeof o.labels === 'object' && !Array.isArray(o.labels) ? o.labels as Record<string, unknown> : {};
  const labels = { ...ENGLISH_LABELS };
  for (const k of LABEL_KEYS) { const v = str(lb[k], k === 'notFoundText' ? 300 : 80); if (v) labels[k] = v; }
  const related = str(lb.related, 80);
  if (related) labels.related = related;
  const photoChanges = str(lb.photoChanges, 160);
  if (photoChanges) labels.photoChanges = photoChanges;
  const about = (Array.isArray(o.about) ? o.about : typeof o.about === 'string' ? [o.about] : [])
    .map(p => str(p, 1200)).filter(Boolean).slice(0, 8);
  const color = typeof o.sourceColor === 'string' ? o.sourceColor.trim().toLowerCase() : '';
  return {
    name: str(o.name, 60) || nameFromDomain(domain),
    tagline: str(o.tagline, 160),
    description: str(o.description, 320),
    about,
    sourceColor: isHex(color) ? color : seedColor(domain),
    fonts: FONT_PAIRINGS.includes(o.fonts as FontPairing) ? o.fonts as FontPairing : 'editorial',
    labels,
  };
}

/* ---------- Styles ---------- */

/** The stylesheet: M3 tokens of the site's scheme, then the components. Minified lightly; fingerprinted by the caller. */
function stylesheet(identity: SiteIdentity, tag: string): string {
  const { light, dark } = schemes(identity.sourceColor);
  const f = FONTS[identity.fonts];
  const css = `
${readSkillFile('material-3-web', 'references/tokens.css')}
:root {
  color-scheme: light;
${tokens(light)}
  --md-ref-typeface-brand: ${f.brand};
  --md-ref-typeface-plain: ${f.plain};
  --md-lang-height: ${langHeight(tag)};
  --margin: 16px;
  --wrap: 1200px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${tokens(dark, '    ')}
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
${tokens(dark)}
}
@media (min-width: 600px) { :root { --margin: 24px; } }
@media (min-width: 840px) { :root { --wrap: 1120px; } }
@media (min-width: 1200px) { :root { --margin: 32px; --wrap: 1200px; } }
@media (min-width: 1600px) { :root { --wrap: 1440px; } }

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; scroll-padding-top: 88px; }
body {
  margin: 0; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column;
  background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large); letter-spacing: 0.01em;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility;
}
main { flex: 1 0 auto; }
img { display: block; max-width: 100%; height: auto; }
h1, h2, h3, p, figure, ol, ul { margin: 0; }
a { color: var(--md-sys-color-primary); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.2em; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--md-sys-color-secondary); outline-offset: 2px; border-radius: var(--md-sys-shape-corner-extra-small); }
::selection { background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
.wrap { width: min(100% - 2 * var(--margin), var(--wrap)); margin-inline: auto; }

/* Skip link: off screen until focused. */
.skip {
  position: absolute; inset-inline-start: var(--margin); top: -120px; z-index: 20; padding: 12px 20px;
  border-radius: var(--md-sys-shape-corner-full); background: var(--md-sys-color-inverse-surface); color: var(--md-sys-color-inverse-on-surface);
  font: var(--md-sys-typescale-label-large); text-decoration: none;
}
.skip:focus { top: 12px; }

/* Top app bar: stays on top, translucent surface. */
.topbar {
  position: sticky; top: 0; z-index: 10;
  background: color-mix(in srgb, var(--md-sys-color-surface) 86%, transparent);
  -webkit-backdrop-filter: saturate(1.6) blur(16px); backdrop-filter: saturate(1.6) blur(16px);
  border-bottom: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 70%, transparent);
}
.topbar__inner { display: flex; flex-wrap: wrap; padding-block: 8px; align-items: center; justify-content: space-between; gap: 16px; min-height: 64px; }
.brand {
  display: inline-flex; align-items: center; gap: 12px; min-height: 48px; min-width: 0;
  color: var(--md-sys-color-on-surface); text-decoration: none; font: var(--md-sys-typescale-title-large); font-weight: 600; letter-spacing: -0.005em;
}
/* The site name never truncates (Material 3: no truncated labels); on phones it gets a smaller size and may wrap. */
.brand span { overflow-wrap: anywhere; }
.brand img { flex: none; width: 36px; height: 36px; border-radius: var(--md-sys-shape-corner-medium); }
.nav ul { display: flex; flex-wrap: wrap; gap: 4px; padding: 0; list-style: none; }
.nav a, .btn {
  position: relative; isolation: isolate; display: inline-flex; align-items: center; justify-content: center;
  min-height: 48px; min-width: 48px; padding: 0 16px; border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large); letter-spacing: 0.00625rem; text-decoration: none; white-space: nowrap;
}
.nav { min-width: 0; max-width: 100%; }
.nav li { min-width: 0; max-width: 100%; }
.nav a { white-space: normal; overflow-wrap: anywhere; max-width: 100%; color: var(--md-sys-color-on-surface-variant); }
.nav a::after, .btn::after { content: ""; position: absolute; inset: 50% 0 auto; height: 48px; transform: translateY(-50%); }
.nav a::before, .btn::before, .card::before, .feature::before, .toc a::before {
  content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; background: currentColor; opacity: 0;
  transition: opacity var(--md-sys-motion-standard-default-effects);
}
@media (hover: hover) { .nav a:hover::before, .btn:hover::before, .toc a:hover::before { opacity: var(--md-sys-state-hover-opacity); } .card:hover::before, .feature:hover::before { opacity: var(--md-sys-state-hover-opacity); } }
.nav a:focus-visible::before, .btn:focus-visible::before, .toc a:focus-visible::before, .card:has(a:focus-visible)::before, .feature:has(a:focus-visible)::before { opacity: var(--md-sys-state-focus-opacity); }
.nav a:active::before, .btn:active::before, .toc a:active::before, .card:active::before, .feature:active::before { opacity: var(--md-sys-state-pressed-opacity); }
.nav a[aria-current="page"] { background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); }
@media (max-width: 599px) {
  .brand { font: var(--md-sys-typescale-title-medium); font-family: var(--md-ref-typeface-brand); font-weight: 600; gap: 8px; }
  .brand img { width: 32px; height: 32px; border-radius: var(--md-sys-shape-corner-small); }
  .nav a { padding: 0 12px; }
}
.btn { background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); padding: 0 24px; min-height: 48px; }
/* Compact screens: the site's name already leads home, so the top bar keeps room for it. */
@media (max-width: 599px) { .topbar .nav li:first-child { display: none; } .nav a { padding: 0 12px; } }

/* Categories: a row under the top bar that scrolls sideways when it does not fit. */
.cats { border-bottom: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 70%, transparent); }
.cats ul { flex-wrap: nowrap; gap: 8px; padding-block: 8px; overflow-x: auto; scrollbar-width: none; }
.cats ul::-webkit-scrollbar { display: none; }
.cats li { flex: none; }
.cats a { min-height: 48px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--md-sys-shape-corner-small); }
.cats a[aria-current="page"] { border-color: transparent; }

/* Home: masthead with M3 Expressive shapes. */
.masthead {
  position: relative; overflow: hidden; isolation: isolate; margin-block: 24px 8px;
  padding: clamp(40px, 7vw, 88px) clamp(24px, 5vw, 64px);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container);
}
.masthead::before, .masthead::after { content: ""; position: absolute; z-index: -1; border-radius: var(--md-sys-shape-corner-full); }
.masthead::before {
  width: clamp(150px, 34vw, 420px); aspect-ratio: 1; inset-inline-end: clamp(-140px, -6vw, -60px); top: clamp(-160px, -9vw, -70px);
  background: var(--md-sys-color-tertiary-container);
}
.masthead::after {
  width: clamp(140px, 20vw, 260px); aspect-ratio: 1; inset-inline-end: clamp(40px, 16vw, 260px); bottom: clamp(-150px, -8vw, -70px);
  background: color-mix(in srgb, var(--md-sys-color-secondary-container) 85%, var(--md-sys-color-primary-container));
  border-radius: var(--md-sys-shape-corner-full);
}
.masthead h1 { font: var(--md-sys-typescale-display-small); font-weight: 600; letter-spacing: -0.02em; }
.masthead p { margin-top: 16px; font: var(--md-sys-typescale-title-large); font-family: var(--md-ref-typeface-plain); opacity: 0.92; }
@media (min-width: 600px) { .masthead h1 { font: var(--md-sys-typescale-display-medium); font-weight: 600; letter-spacing: -0.02em; } }
@media (min-width: 1200px) { .masthead h1 { font: var(--md-sys-typescale-display-large); font-weight: 600; letter-spacing: -0.025em; } }

.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-block: 56px 20px; }
.section-head h2 { font: var(--md-sys-typescale-headline-small); font-weight: 600; letter-spacing: -0.01em; }
.section-head h2 a { color: inherit; text-decoration: none; }
.section-head h2 a:hover { color: var(--md-sys-color-primary); text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 0.18em; }
.count { flex: none; color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-label-large); font-variant-numeric: tabular-nums; }
.chip {
  display: inline-flex; align-items: center; min-height: 32px; padding: 0 14px; border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-tertiary-container); color: var(--md-sys-color-on-tertiary-container); font: var(--md-sys-typescale-label-large);
}

/* Featured article. */
.feature {
  position: relative; isolation: isolate; display: grid; overflow: hidden;
  border-radius: var(--md-sys-shape-corner-medium); background: var(--md-sys-color-surface-container-highest);
}
.feature__media { position: relative; overflow: hidden; background: var(--md-sys-color-secondary-container); min-height: 220px; }
.feature__media img { width: 100%; height: 100%; aspect-ratio: 16 / 10; object-fit: cover; transition: transform var(--md-sys-motion-standard-default-spatial); }
.feature__body { display: flex; flex-direction: column; justify-content: center; align-items: stretch; gap: 16px; padding: 24px 24px 32px; min-width: 0; }
.feature__body > .chip { align-self: flex-start; }
.feature__title { font: var(--md-sys-typescale-headline-medium); font-weight: 600; letter-spacing: -0.015em; }
.feature__text { color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-body-large); }
@media (min-width: 840px) {
  .feature { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
  /* Side by side the photo fills its column at the height of the text (at least 440px), whatever its own shape: a tall
     portrait photo would otherwise stretch the whole card. Only the shown part changes; the file is the original. */
  .feature__media { min-height: 440px; }
  .feature__media img { position: absolute; inset: 0; aspect-ratio: auto; }
  .feature__body { padding: 40px 48px; }
}
@media (min-width: 1200px) { .feature__title { font: var(--md-sys-typescale-headline-large); font-weight: 600; letter-spacing: -0.02em; } }

/* Cards. The title link covers the whole card, so a card is one link with the title as its words. */
.grid { display: grid; gap: 8px; padding: 0; list-style: none; }
@media (min-width: 600px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } }
@media (min-width: 1200px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.card {
  position: relative; isolation: isolate; display: flex; flex-direction: column; height: 100%; overflow: hidden;
  border-radius: var(--md-sys-shape-corner-medium); background: var(--md-sys-color-surface-container-highest); color: var(--md-sys-color-on-surface);
}
.card__media { position: relative; overflow: hidden; aspect-ratio: 3 / 2; margin: 8px 8px 0; border-radius: var(--md-sys-shape-corner-extra-small); background: var(--md-sys-color-secondary-container); }
.card__media img { width: 100%; height: 100%; object-fit: cover; transition: transform var(--md-sys-motion-standard-default-spatial); }
.card__body { display: flex; flex-direction: column; gap: 8px; flex: 1; padding: 16px; }
.card__title { font: var(--md-sys-typescale-title-large); font-weight: 600; letter-spacing: -0.005em; }
.card__text {
  color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-body-medium);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden;
}
.meta { margin-top: auto; padding-top: 4px; color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-label-medium); }
.card__credit { margin-top: -4px; color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-body-small); overflow-wrap: anywhere; }
/* The credit's links (the photo's page and its license) sit above the title link that covers the card. */
.card__credit a { position: relative; z-index: 2; color: inherit; }
.feature__title a, .card__title a { color: inherit; text-decoration: none; }
.feature__title a::after, .card__title a::after { content: ""; position: absolute; inset: 0; z-index: 1; border-radius: inherit; }
.feature__title a:focus-visible, .card__title a:focus-visible { outline: none; }
.feature:has(.feature__title a:focus-visible), .card:has(.card__title a:focus-visible) { outline: 3px solid var(--md-sys-color-secondary); outline-offset: 3px; }
@media (hover: hover) {
  .feature:hover .feature__title a, .card:hover .card__title a { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 0.18em; }
  .feature:hover .feature__media img, .card:hover .card__media img { transform: scale(1.035); }
}
/* A card without a photo: a tonal panel with the title's first letter (decorative). */
.initial {
  display: grid; place-items: center; width: 100%; height: 100%; min-height: 160px;
  background: radial-gradient(circle at 78% 18%, var(--md-sys-color-tertiary-container) 0 24%, transparent 24.5%), var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container); font: var(--md-sys-typescale-display-large); font-weight: 600;
}

/* Article. */
.crumbs { margin-top: 24px; }
.crumbs ol { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 0; list-style: none; color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-label-large); }
.crumbs li { display: inline-flex; align-items: center; flex: none; }
.crumbs li + li::before { content: "/"; margin-inline-end: 8px; color: var(--md-sys-color-outline); }
.crumbs a { display: inline-flex; align-items: center; min-height: 48px; color: var(--md-sys-color-on-surface-variant); text-decoration: none; }
.crumbs a:hover { color: var(--md-sys-color-primary); text-decoration: underline; }
.crumbs [aria-current] { display: block; flex: 0 1 auto; min-width: 0; overflow-wrap: anywhere; }
.head { width: min(100% - 2 * var(--margin), var(--wrap)); margin: 16px auto 32px; }
.lead-story { margin-top: 32px; }
.head h1 { font: var(--md-sys-typescale-headline-large); font-weight: 600; letter-spacing: -0.02em; }
@media (min-width: 600px) { .head h1 { font: var(--md-sys-typescale-display-small); font-weight: 600; letter-spacing: -0.02em; } }
@media (min-width: 1200px) { .head h1 { font: var(--md-sys-typescale-display-medium); font-weight: 600; letter-spacing: -0.025em; } .head { margin-top: 24px; } }
.dek { margin-top: 20px; color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-title-large); font-family: var(--md-ref-typeface-plain); font-weight: 400; }
.byline {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; margin-top: 28px; padding-top: 20px;
  border-top: 1px solid var(--md-sys-color-outline-variant); color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-body-medium);
}
.byline__who { display: inline-flex; align-items: center; gap: 12px; color: var(--md-sys-color-on-surface); font: var(--md-sys-typescale-title-small); }
.byline__who img { width: 32px; height: 32px; border-radius: var(--md-sys-shape-corner-small); }
.byline__who a { color: inherit; text-decoration: none; }
.byline__who a:hover { text-decoration: underline; }
.byline time { color: var(--md-sys-color-on-surface); }
.hero { width: min(100% - 2 * var(--margin), var(--wrap)); margin: 0 auto 48px; }
.hero img { width: 100%; max-height: min(78vh, 760px); object-fit: cover; border-radius: var(--md-sys-shape-corner-extra-large); background: var(--md-sys-color-surface-container); }
figcaption { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; padding-inline: 4px; color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-body-medium); }
.credit { font: var(--md-sys-typescale-body-small); letter-spacing: 0.02em; }
.credit a { color: inherit; }

.layout { width: min(100% - 2 * var(--margin), var(--wrap)); margin-inline: auto; display: grid; gap: 32px; }
@media (min-width: 1200px) {
  .layout:has(> .toc) { grid-template-columns: 224px minmax(0, 1fr); column-gap: 32px; }
  .layout:has(> .toc) > .prose { grid-column: 2; }
  .layout > .toc { grid-column: 1; grid-row: 1; justify-self: end; position: sticky; top: 96px; align-self: start; width: min(100%, 260px); }
}
.toc { border-radius: var(--md-sys-shape-corner-medium); background: var(--md-sys-color-surface-container-highest); padding: 20px 16px 16px; }
.toc h2 { padding-inline: 12px; margin-bottom: 8px; color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-title-small); }
.toc ol { display: grid; gap: 2px; padding: 0; list-style: none; }
.toc a {
  position: relative; isolation: isolate; display: flex; align-items: center; min-height: 48px; padding: 8px 12px;
  border-radius: var(--md-sys-shape-corner-large); color: var(--md-sys-color-on-surface); font: var(--md-sys-typescale-body-medium); text-decoration: none;
}
@media (min-width: 1200px) { .toc { background: none; padding: 0; } .toc h2 { padding-inline: 12px; } }

.prose { overflow-wrap: anywhere; width: 100%; min-width: 0; font: var(--md-sys-typescale-body-large); }

.prose > * + * { margin-top: 1.25em; }
.prose h2 { margin-top: 2.2em; font: var(--md-sys-typescale-headline-medium); font-weight: 600; letter-spacing: -0.015em; }
.prose h3 { margin-top: 1.8em; font: var(--md-sys-typescale-title-large); font-weight: 600; }
.prose h2 + *, .prose h3 + * { margin-top: 0.75em; }

.prose ul, .prose ol { padding-inline-start: 1.4em; }
.prose li + li { margin-top: 0.5em; }
.prose li::marker { color: var(--md-sys-color-primary); }
.prose p a, .prose li a { font-weight: 500; overflow-wrap: anywhere; }
.prose figure { margin-block: 2em; }
.prose figure img { width: 100%; border-radius: var(--md-sys-shape-corner-large-increased); background: var(--md-sys-color-surface-container); }
.table { overflow-x: auto; border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--md-sys-shape-corner-large); }
.table table { width: 100%; border-collapse: collapse; font: var(--md-sys-typescale-body-medium); font-variant-numeric: tabular-nums; }
.table th, .table td { padding: 12px 16px; text-align: start; vertical-align: top; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.table th { background: var(--md-sys-color-surface-container); color: var(--md-sys-color-on-surface); font-weight: 600; }
.table tr:last-child td { border-bottom: 0; }
.sources { margin-top: 3em; padding-top: 2em; border-top: 1px solid var(--md-sys-color-outline-variant); }
.sources h2 { margin-top: 0; font: var(--md-sys-typescale-title-large); font-weight: 600; }
.sources ol { margin-top: 16px; padding: 0; list-style: none; counter-reset: src; display: grid; gap: 12px; }
.sources li { counter-increment: src; display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: 8px; margin: 0; font: var(--md-sys-typescale-body-medium); }
.sources li::before {
  content: counter(src); display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); font: var(--md-sys-typescale-label-medium);
}
.sources a { overflow-wrap: anywhere; }
.host { display: block; color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-body-small); }
.note { margin-top: 2em; padding: 20px 24px; border-radius: var(--md-sys-shape-corner-large-increased); background: var(--md-sys-color-surface-container); }
.note h2 { margin: 0 0 6px; font: var(--md-sys-typescale-title-small); }
.note p { color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-body-medium); }

/* A band of more articles at the end of a page. */
.band { margin-top: 72px; padding-block: 8px 72px; background: var(--md-sys-color-surface-container-low); }
.band .card { background: var(--md-sys-color-surface); }
.band .section-head { margin-top: 48px; }

/* About and not found. */
.page { width: min(100% - 2 * var(--margin), var(--wrap)); margin: 16px auto 0; }
.page h1 { font: var(--md-sys-typescale-headline-large); font-weight: 600; letter-spacing: -0.02em; }
@media (min-width: 600px) { .page h1 { font: var(--md-sys-typescale-display-small); font-weight: 600; letter-spacing: -0.02em; } }
.lead { margin-top: 20px; color: var(--md-sys-color-on-surface-variant); font: var(--md-sys-typescale-title-large); font-family: var(--md-ref-typeface-plain); }
.page .prose { margin-top: 32px; }
.listing .section-head { margin-top: 8px; align-items: baseline; }
.listing h1 { font: var(--md-sys-typescale-headline-large); font-weight: 600; letter-spacing: -0.02em; }
@media (min-width: 600px) { .listing h1 { font: var(--md-sys-typescale-display-small); font-weight: 600; letter-spacing: -0.02em; } }
.missing { padding-block: 64px 24px; text-align: center; }
.missing .code { color: var(--md-sys-color-primary); font: var(--md-sys-typescale-display-large); font-weight: 700; letter-spacing: -0.03em; }
.missing p { margin: 16px auto 32px; color: var(--md-sys-color-on-surface-variant); }

/* Footer. */
.footer { margin-top: 0; padding-block: 48px 40px; background: var(--md-sys-color-surface-container); color: var(--md-sys-color-on-surface-variant); }
main + .footer { margin-top: 72px; }
main:has(> .band:last-child) + .footer { margin-top: 0; }
.footer__inner { display: grid; gap: 24px; }
@media (min-width: 840px) { .footer__inner { grid-template-columns: minmax(0, 2fr) auto; align-items: start; } }
.footer .brand { font: var(--md-sys-typescale-title-large); font-weight: 600; }
.footer p { margin-top: 8px; font: var(--md-sys-typescale-body-medium); }
.footer .nav ul { flex-wrap: wrap; }
.footer small { display: block; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--md-sys-color-outline-variant); font: var(--md-sys-typescale-body-small); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
`;
  /* Comments out and whitespace collapsed: smaller, and stable for the fingerprint. */
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n').replace(/\n+/g, '\n').trim() + '\n';
}

/* ---------- The site ---------- */

/** A category of the site: its name as the newest article writes it, its folder, and its articles, newest first. */
type Category = { name: string; slug: string; articles: SiteArticle[] };
/** Categories are in the navigation and on the home page from this many on; one category alone is the whole site. */
const NAV_MIN_CATEGORIES = 2;
/** Articles of a category the home page shows before its heading's link leads to the rest. */
const HOME_PER_CATEGORY = 3;

type Ctx = {
  input: SiteInput; id: SiteIdentity; L: Labels; tag: string; dir: string; zone: string;
  origin: string; css: string; aboutSlug: string;
  /** Largest first, then by name. */
  cats: Category[];
  /** The category of each article id that has one. */
  catOf: Map<number, Category>;
  /** The heading over related articles, in the site's language. */
  related: string;
  /** Slug of each article id. */
  slugs: Map<number, string>;
  /** Photos that have at least one stored file, with the widths that have one. */
  photos: Map<number, SitePhoto[]>;
  /** Light and dark surface colours, for theme-color. */
  surface: [string, string];
};

const abs = (c: Ctx, path = ''): string => `${c.origin}/${path}`;
const articlePath = (c: Ctx, id: number): string => seg(c.slugs.get(id)!) + '/';
const mediaName = (p: SitePhoto, w: number): string => `${p.file}-${w}.${p.ext}`;
const largest = (p: SitePhoto): number => p.widths[p.widths.length - 1]!;
const heroOf = (c: Ctx, a: SiteArticle): SitePhoto | undefined => c.photos.get(a.id)?.find(p => p.role === 'hero');
/** The picture for an article's card: its hero, else its first photo. */
const coverOf = (c: Ctx, a: SiteArticle): SitePhoto | undefined => heroOf(c, a) ?? c.photos.get(a.id)?.[0];
const lastChange = (a: SiteArticle): number => Math.max(a.published, a.updated ?? 0);
const categoryPath = (cat: Category): string => seg(cat.slug) + '/';
/** The categories are part of the navigation and the home page. */
const showCats = (c: Ctx): boolean => c.cats.length >= NAV_MIN_CATEGORIES;

/** "Related articles" in the languages sites are written in, for a site whose identity was chosen before the label existed. */
const RELATED: Record<string, string> = {
  en: 'Related articles', id: 'Artikel terkait', ms: 'Artikel berkaitan', vi: 'Bài viết liên quan', th: 'บทความที่เกี่ยวข้อง', fil: 'Mga kaugnay na artikulo',
  es: 'Artículos relacionados', pt: 'Artigos relacionados', de: 'Ähnliche Artikel', fr: 'Articles similaires', it: 'Articoli correlati', nl: 'Gerelateerde artikelen',
  tr: 'İlgili yazılar', ja: '関連記事', ko: '관련 글', ar: 'مقالات ذات صلة', hi: 'संबंधित लेख', ur: 'متعلقہ مضامین', bn: 'সম্পর্কিত নিবন্ধ', ru: 'Похожие статьи',
  pl: 'Powiązane artykuły', uk: 'Схожі статті', ro: 'Articole similare', fa: 'مقالات مرتبط', sw: 'Makala zinazohusiana',
};
/** The site's own label, else the built-in one of its language, else its word for "articles" (never English on a site in another language). */
const relatedLabel = (L: Labels, tag: string): string => L.related || RELATED[tag.split('-')[0]!.toLowerCase()] || L.articles;

/**
 * A text with its links as HTML. Every piece of text is escaped; a link becomes <a href> only when its range holds
 * and its target exists: another article of this build (a relative URL) or an http(s) address. Anything else, and a
 * link to the page itself, stays plain text.
 */
function linkedText(c: Ctx, text: string, links: Link[] | undefined, root: string, self: number): string {
  if (!Array.isArray(links) || !links.length) return esc(text);
  let out = '', at = 0;
  for (const l of links.filter(x => x && typeof x === 'object').sort((x, y) => x.start - y.start)) {
    if (!Number.isInteger(l.start) || !Number.isInteger(l.end) || l.start < at || l.end <= l.start || l.end > text.length) continue;
    const href = 'article' in l ? (l.article !== self && c.slugs.has(l.article) ? root + articlePath(c, l.article) : '') : httpUrl((l as { url?: unknown }).url);
    const words = text.slice(l.start, l.end);
    if (!href || !words.trim()) continue;
    out += esc(text.slice(at, l.start)) + `<a href="${esc(href)}">${esc(words)}</a>`;
    at = l.end;
  }
  return out + esc(text.slice(at));
}

/** An <img> of a stored photo: every stored width in srcset, the largest as src, the real aspect in width/height. */
function img(c: Ctx, p: SitePhoto, root: string, o: { sizes: string; lcp?: boolean; alt?: string }): string {
  const url = (w: number) => `${root}media/${seg(mediaName(p, w))}`;
  const srcset = p.widths.map(w => `${url(w)} ${w}w`).join(', ');
  const loading = o.lcp ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"';
  return `<img src="${esc(url(largest(p)))}" srcset="${esc(srcset)}" sizes="${esc(o.sizes)}" width="${p.width}" height="${p.height}" alt="${esc(o.alt ?? p.alt)}"${loading}>`;
}

/** A photo's license name, linked to the license (rel="license") when it has a deed; CC0 and public domain may have none. */
function licenseOf(p: SitePhoto, n: number): string {
  const lic = httpUrl(p.licenseUrl), name = line(p.license, n);
  return name ? (lic ? `<a rel="license" href="${esc(lic)}">${esc(name)}</a>` : esc(name)) : '';
}

/**
 * The credit line of a photo: title (linked to its source page), author, license (linked when it has a deed). The
 * author's link comes from the Commons file's Artist field, which anyone editing Commons can set, so it is marked as
 * user-generated and not followed.
 */
function credit(c: Ctx, p: SitePhoto): string {
  const src = httpUrl(p.sourceUrl), who = httpUrl(p.authorUrl);
  const title = line(p.title, 200) || line(p.file, 120);
  const parts = [
    src ? `<a href="${esc(src)}">${esc(title)}</a>` : esc(title),
    p.author ? (who ? `<a rel="ugc nofollow" href="${esc(who)}">${esc(line(p.author, 160))}</a>` : esc(line(p.author, 160))) : '',
    licenseOf(p, 80),
    esc(line(p.provider, 60) || 'Wikimedia Commons'),
    esc(photoChanges(c)),
  ].filter(Boolean);
  return `<span class="credit">${esc(c.L.photo)}: ${parts.join(' · ')}</span>`;
}

/**
 * A short credit for a photo shown small (cards, the home page's feature): who made it, linked to the photo's source
 * page (which has the full credit), and its license, linked to the license. Every page that shows a CC BY or BY-SA
 * photo carries both links, as those licenses ask.
 */
function shortCredit(c: Ctx, p: SitePhoto): string {
  const src = httpUrl(p.sourceUrl), who = line(p.author, 80) || line(p.title, 80) || line(p.file, 80);
  const parts = [src ? `<a href="${esc(src)}">${esc(who)}</a>` : esc(who), licenseOf(p, 60), esc(photoChanges(c))].filter(Boolean);
  return `<p class="card__credit">${esc(c.L.photo)}: ${parts.join(' · ')}</p>`;
}

/** Stored responsive photos are resized/encoded versions, never the unchanged source. */
function photoChanges(c: Ctx): string {
  return c.L.photoChanges || (c.tag.startsWith('id') ? 'Ukuran dan format foto disesuaikan untuk web.' : 'Photo resized and encoded for the web.');
}

function figure(c: Ctx, p: SitePhoto, root: string, cls: string, sizes: string, lcp = false): string {
  const cap = line(p.caption, 400);
  return `<figure class="${cls}">${img(c, p, root, { sizes, lcp })}<figcaption>${cap ? `<span>${esc(cap)}</span>` : ''}${credit(c, p)}</figcaption></figure>`;
}

type PageOpts = {
  /** Path of the page's folder from the root: "" for the home page, "slug/" for an article; null for the 404 page. */
  at: string | null;
  /** The page the navigation marks as current: 'home', 'about', a category's slug, or '' for none. */
  title: string; description: string; current: string;
  ogType?: 'website' | 'article'; image?: SitePhoto; ld?: unknown[]; main: string; after?: string;
  extraHead?: string;
};

/** The relative prefix back to the root from a page folder ("../" per level), or "/" for the 404 page. */
const rootOf = (at: string | null): string => at === null ? '/' : '../'.repeat(at.split('/').filter(Boolean).length);
const homeHref = (root: string): string => root || './';

function page(c: Ctx, o: PageOpts): string {
  const root = rootOf(o.at), canonical = o.at === null ? '' : abs(c, o.at);
  const hero = o.image;
  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(o.title)}</title>`,
    o.description ? `<meta name="description" content="${esc(o.description)}">` : '',
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : `<meta name="robots" content="noindex">`,
    `<link rel="icon" href="${root}favicon.ico" sizes="48x48">`,
    `<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="${root}apple-touch-icon.png">`,
    `<link rel="manifest" href="${root}site.webmanifest">`,
    `<meta name="theme-color" content="${c.surface[0]}" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="${c.surface[1]}" media="(prefers-color-scheme: dark)">`,
    `<link rel="stylesheet" href="${root}assets/${c.css}">`,
    `<meta property="og:site_name" content="${esc(c.id.name)}">`,
    `<meta property="og:type" content="${o.ogType ?? 'website'}">`,
    `<meta property="og:title" content="${esc(o.title)}">`,
    o.description ? `<meta property="og:description" content="${esc(o.description)}">` : '',
    canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
    hero ? [
      `<meta property="og:image" content="${esc(abs(c, 'media/' + seg(mediaName(hero, largest(hero)))))}">`,
      `<meta property="og:image:width" content="${hero.width}">`, `<meta property="og:image:height" content="${hero.height}">`,
      `<meta property="og:image:alt" content="${esc(hero.alt)}">`,
    ].join('\n') : '',
    `<meta name="twitter:card" content="${hero ? 'summary_large_image' : 'summary'}">`,
    o.extraHead ?? '',
    ...(o.ld ?? []).map(x => `<script type="application/ld+json">${ldJson(x)}</script>`),
  ].filter(Boolean).join('\n');
  const nav = (label: string) => `<nav class="nav" aria-label="${esc(label)}"><ul>` +
    `<li><a href="${homeHref(root)}"${o.current === 'home' ? ' aria-current="page"' : ''}>${esc(c.L.home)}</a></li>` +
    `<li><a href="${root}${seg(c.aboutSlug)}/"${o.current === 'about' ? ' aria-current="page"' : ''}>${esc(c.L.about)}</a></li></ul></nav>`;
  /* The categories: a row of their own under the top bar, and in the footer between Home and About. */
  const catLinks = showCats(c) ? c.cats.map(k => `<li><a href="${root}${categoryPath(k)}"${o.current === k.slug ? ' aria-current="page"' : ''}>${esc(k.name)}</a></li>`).join('') : '';
  const catsNav = catLinks ? `\n<nav class="nav cats" aria-label="${esc(c.L.articles)}"><ul class="wrap">${catLinks}</ul></nav>` : '';
  const footNav = `<nav class="nav" aria-label="${esc(c.id.name)}"><ul>` +
    `<li><a href="${homeHref(root)}"${o.current === 'home' ? ' aria-current="page"' : ''}>${esc(c.L.home)}</a></li>${catLinks}` +
    `<li><a href="${root}${seg(c.aboutSlug)}/"${o.current === 'about' ? ' aria-current="page"' : ''}>${esc(c.L.about)}</a></li></ul></nav>`;
  const year = new Date(Math.max(c.input.identityUpdatedAt, ...c.input.articles.map(lastChange))).getUTCFullYear();
  return `<!doctype html>
<html lang="${c.tag}" dir="${c.dir}">
<head>
${head}
</head>
<body>
<a class="skip" href="#main">${esc(c.L.skip)}</a>
<header class="topbar"><div class="topbar__inner wrap">
<a class="brand" href="${homeHref(root)}"><img src="${root}favicon.svg" alt="" width="36" height="36"><span>${esc(c.id.name)}</span></a>
${nav(c.L.menu)}
</div></header>${catsNav}
<main id="main">
${o.main}
${o.after ?? ''}
</main>
<footer class="footer"><div class="wrap">
<div class="footer__inner">
<div><a class="brand" href="${homeHref(root)}"><span>${esc(c.id.name)}</span></a>${c.id.description ? `<p>${esc(c.id.description)}</p>` : ''}</div>
${footNav}
</div>
<small>© ${year} ${esc(c.id.name)}</small>
</div></footer>
</body>
</html>
`;
}

/** A card for the feed: photo (or a decorative initial), title as the link, description, date. */
function card(c: Ctx, a: SiteArticle, root: string, heading: 'h2' | 'h3'): string {
  const p = coverOf(c, a), t = a.content;
  const media = p
    ? `<div class="card__media">${img(c, p, root, { sizes: '(min-width: 1200px) 380px, (min-width: 600px) 50vw, 100vw' })}</div>`
    : `<div class="card__media" aria-hidden="true"><div class="initial">${esc([...t.title.trim()][0] ?? '')}</div></div>`;
  return `<li><article class="card">${media}<div class="card__body">` +
    `<${heading} class="card__title"><a href="${root}${articlePath(c, a.id)}">${esc(t.title)}</a></${heading}>` +
    (t.metaDescription ? `<p class="card__text">${esc(t.metaDescription)}</p>` : '') +
    `<p class="meta"><time datetime="${isoDate(a.published, c.zone)}">${esc(longDate(a.published, c.tag, c.zone))}</time></p>` +
    (p ? shortCredit(c, p) : '') + `</div></article></li>`;
}

/** A band of other articles at the end of a page (internal links between articles). */
function band(c: Ctx, root: string, heading: string, list: SiteArticle[]): string {
  if (!list.length) return '';
  return `<section class="band" aria-labelledby="more"><div class="wrap">` +
    `<div class="section-head"><h2 id="more">${esc(heading)}</h2></div>` +
    `<ul class="grid">${list.map(a => card(c, a, root, 'h3')).join('')}</ul></div></section>`;
}
/** The newest articles, for pages that are not an article. */
const moreBand = (c: Ctx, root: string, n = 3): string => band(c, root, c.L.latest, c.input.articles.slice(0, n));
/**
 * The articles an article leads on to: the others of its category first (newest first), then the newest of the rest.
 * The heading says "related" only when at least one of them shares the category; else they are simply the latest.
 */
function relatedBand(c: Ctx, root: string, a: SiteArticle, n = 3): string {
  const cat = c.catOf.get(a.id);
  const same = cat ? cat.articles.filter(x => x.id !== a.id) : [];
  const rest = c.input.articles.filter(x => x.id !== a.id && !same.includes(x));
  return band(c, root, same.length ? c.related : c.L.latest, [...same, ...rest].slice(0, n));
}

const website = (c: Ctx) => ({ '@context': 'https://schema.org', '@type': 'WebSite', name: c.id.name, url: abs(c) });
const organization = (c: Ctx) => ({ '@type': 'Organization', name: c.id.name, url: abs(c), logo: { '@type': 'ImageObject', url: abs(c, 'icon-512.png') } });
/** One step of a breadcrumb trail after Home: its name and its folder from the root. The last one is the page itself. */
type Crumb = { name: string; at: string };
const breadcrumbs = (c: Ctx, ...trail: Crumb[]) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: c.L.home, item: abs(c) },
    ...trail.map((t, i) => ({ '@type': 'ListItem', position: i + 2, name: t.name, item: abs(c, t.at) })),
  ],
});
/** The visible trail: the same steps as the structured data, every one but the page itself a link. */
const crumbsNav = (c: Ctx, root: string, ...trail: Crumb[]) =>
  `<nav class="crumbs wrap" aria-label="${esc(c.L.breadcrumbs)}"><ol><li><a href="${homeHref(root)}">${esc(c.L.home)}</a></li>` +
  trail.map((t, i) => i === trail.length - 1 ? `<li aria-current="page">${esc(t.name)}</li>` : `<li><a href="${root}${t.at}">${esc(t.name)}</a></li>`).join('') + `</ol></nav>`;

function homePage(c: Ctx): string {
  const [first, ...rest] = c.input.articles;
  const root = '';
  let feature = '';
  if (first) {
    const hero = coverOf(c, first), t = first.content;
    feature = `<section class="wrap lead-story" aria-labelledby="latest">` +
      `<article class="feature">` +
      `<div class="feature__media">${hero ? img(c, hero, root, { sizes: '(min-width: 1200px) 680px, (min-width: 840px) 58vw, 100vw', lcp: true }) : `<div class="initial" aria-hidden="true">${esc([...t.title.trim()][0] ?? '')}</div>`}</div>` +
      `<div class="feature__body"><span class="chip">${esc(c.L.latest)}</span>` +
      `<h2 class="feature__title" id="latest"><a href="${articlePath(c, first.id)}">${esc(t.title)}</a></h2>` +
      (t.metaDescription ? `<p class="feature__text">${esc(t.metaDescription)}</p>` : '') +
      `<p class="meta"><time datetime="${isoDate(first.published, c.zone)}">${esc(longDate(first.published, c.tag, c.zone))}</time></p>` +
      (hero ? shortCredit(c, hero) : '') + `</div></article></section>`;
  }
  const section = (id: string, head: string, list: SiteArticle[]) =>
    `<section class="wrap" aria-labelledby="${id}"><div class="section-head">${head}</div><ul class="grid">${list.map(a => card(c, a, root, 'h3')).join('')}</ul></section>`;
  let feed = '';
  if (showCats(c)) {
    /* One section per category with its newest articles; the heading leads to the category page, which has them all.
       Articles without a category follow under the general heading, so every article is one or two links from here. */
    feed = c.cats.map((k, i) => {
      const list = k.articles.filter(a => a !== first).slice(0, HOME_PER_CATEGORY);
      return list.length ? section(`c${i + 1}`, `<h2 id="c${i + 1}"><a href="${categoryPath(k)}">${esc(k.name)}</a></h2><span class="count">${k.articles.length}</span>`, list) : '';
    }).join('');
    const loose = rest.filter(a => !c.catOf.has(a.id));
    if (loose.length) feed += section('all', `<h2 id="all">${esc(c.L.articles)}</h2>`, loose);
  } else if (rest.length) feed = section('all', `<h2 id="all">${esc(c.L.articles)}</h2>`, rest);
  const main = `<div class="wrap"><div class="masthead"><h1>${esc(c.id.name)}</h1>${c.id.tagline ? `<p>${esc(c.id.tagline)}</p>` : ''}</div></div>${feature}${feed}`;
  return page(c, {
    at: '', title: c.id.tagline ? `${c.id.name} | ${c.id.tagline}` : c.id.name, description: c.id.description, current: 'home',
    image: first ? coverOf(c, first) : undefined, ld: [website(c)], main,
  });
}

/** The ids the pages use for their own parts: heading ids made from article text avoid them. */
const FIXED_IDS = ['main', 'more', 'toc-title', 'sources', 'how', 'latest', 'all'];

function blockHtml(b: Block, ids: Map<Block, string>, sawH2: boolean, linked: (text: string, links?: Link[]) => string): string {
  switch (b.type) {
    case 'h2': return `<h2 id="${esc(ids.get(b) ?? '')}">${esc(b.text)}</h2>`;
    /* An h3 before any h2 would skip a level: it becomes an h2. */
    case 'h3': return sawH2 ? `<h3>${esc(b.text)}</h3>` : `<h2>${esc(b.text)}</h2>`;
    case 'p': return `<p>${linked(b.text, b.links)}</p>`;
    case 'list': return `<ul>${b.items.map(i => `<li>${linked(i.text, i.links)}</li>`).join('')}</ul>`;
    case 'table': {
      const [head, ...rows] = b.rows;
      const th = head ? `<thead><tr>${head.map(x => `<th scope="col">${esc(x.text)}</th>`).join('')}</tr></thead>` : '';
      return `<div class="table"><table>${th}<tbody>${rows.map(r => `<tr>${r.map(x => `<td>${esc(x.text)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
  }
}

function articlePage(c: Ctx, a: SiteArticle): string {
  const t = a.content, at = articlePath(c, a.id), root = '../';
  const hero = heroOf(c, a);
  const inline = (c.photos.get(a.id) ?? []).filter(p => p.role === 'inline');
  /* Inline photos after their block; one that names no valid block goes after the last one. */
  const after = new Map<number, SitePhoto[]>();
  for (const p of inline) {
    const i = typeof p.after === 'number' && p.after >= 0 && p.after < t.blocks.length ? p.after : t.blocks.length - 1;
    after.set(i, [...(after.get(i) ?? []), p]);
  }
  /* Heading ids never take an id the page itself uses (the sources, the disclosure, the band of more articles). */
  const ids = new Map<Block, string>(), used = new Set<string>(FIXED_IDS);
  t.blocks.forEach((b, i) => {
    if (b.type !== 'h2') return;
    let id = slugify(b.text) || `s${i + 1}`;
    for (let n = 2; used.has(id); n++) id = `${slugify(b.text) || 's' + (i + 1)}-${n}`;
    used.add(id); ids.set(b, id);
  });
  let sawH2 = false;
  const body = t.blocks.map((b, i) => {
    const html = blockHtml(b, ids, sawH2, (text, links) => linkedText(c, text, links, root, a.id));
    if (b.type === 'h2') sawH2 = true;
    return html + (after.get(i) ?? []).map(p => figure(c, p, root, 'figure', '(min-width: 760px) 672px, calc(100vw - 32px)')).join('');
  }).join('\n');
  const h2s = t.blocks.filter(b => b.type === 'h2');
  const toc = h2s.length >= 2
    ? `<nav class="toc" aria-labelledby="toc-title"><h2 id="toc-title">${esc(c.L.onThisPage)}</h2><ol>${h2s.map(b => `<li><a href="#${esc(seg(ids.get(b)!))}">${esc(b.type === 'h2' ? b.text : '')}</a></li>`).join('')}</ol></nav>`
    : '';
  const sources = t.sources.map(s => ({ title: line(s.title, 200), url: httpUrl(s.url) })).filter(s => s.url);
  const sourcesHtml = sources.length
    ? `<section class="sources" aria-labelledby="sources"><h2 id="sources">${esc(c.L.sources)}</h2><ol>${sources.map(s => {
      let host = ''; try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* checked by httpUrl */ }
      return `<li><span><a href="${esc(s.url)}">${esc(s.title || s.url)}</a><span class="host">${esc(host)}</span></span></li>`;
    }).join('')}</ol></section>`
    : '';
  const disclosure = t.disclosure.text
    ? `<aside class="note" aria-labelledby="how"><h2 id="how">${esc(c.L.disclosure)}</h2><p>${esc(t.disclosure.text)}</p></aside>`
    : '';
  const by = line(t.byline.text, 200) || c.id.name;
  const byText = by.toLowerCase().startsWith(c.L.by.toLowerCase() + ' ') ? by : `${c.L.by} ${by}`;
  const updated = a.updated && a.updated > a.published ? a.updated : null;
  const dates = `<span>${esc(c.L.published)} <time datetime="${isoDate(a.published, c.zone)}">${esc(longDate(a.published, c.tag, c.zone))}</time></span>` +
    (updated ? `<span>${esc(c.L.updated)} <time datetime="${isoDate(updated, c.zone)}">${esc(longDate(updated, c.tag, c.zone))}</time></span>` : '');
  /* Home, the article's category when it has one, the article. */
  const cat = c.catOf.get(a.id);
  const trail: Crumb[] = [...(cat ? [{ name: cat.name, at: categoryPath(cat) }] : []), { name: t.title, at }];
  const main = crumbsNav(c, root, ...trail) +
    `<article>` +
    `<header class="head"><h1>${esc(t.title)}</h1>${t.metaDescription ? `<p class="dek">${esc(t.metaDescription)}</p>` : ''}` +
    `<div class="byline"><span class="byline__who"><img src="${root}favicon.svg" alt="" width="32" height="32"><a href="${root}${seg(c.aboutSlug)}/">${esc(byText)}</a></span>${dates}</div></header>` +
    (hero ? figure(c, hero, root, 'hero', '(min-width: 1200px) 1152px, calc(100vw - 48px)', true) : '') +
    `<div class="layout">${toc}<div class="prose">\n${body}\n${sourcesHtml}${disclosure}</div></div>` +
    `</article>`;
  const iso = isoDate(a.published, c.zone), modified = isoDate(updated ?? a.published, c.zone);
  const posting = {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: t.title, ...(t.metaDescription ? { description: t.metaDescription } : {}),
    ...(hero ? { image: [abs(c, 'media/' + seg(mediaName(hero, largest(hero))))] } : {}),
    datePublished: iso, dateModified: modified,
    author: [{ '@type': 'Organization', name: c.id.name, url: abs(c) }],
    publisher: organization(c),
    mainEntityOfPage: { '@type': 'WebPage', '@id': abs(c, at) },
    url: abs(c, at), inLanguage: c.tag,
  };
  return page(c, {
    at, title: t.titleTag || `${t.title} | ${c.id.name}`, description: t.metaDescription, current: '', ogType: 'article', image: hero,
    ld: [posting, breadcrumbs(c, ...trail)], main, after: relatedBand(c, root, a),
    extraHead: `<meta property="article:published_time" content="${iso}">` + (updated ? `\n<meta property="article:modified_time" content="${modified}">` : ''),
  });
}

/** The first sentence or two of a text, up to about `n` characters, for a meta description. */
function summary(text: string, n = 180): string {
  if (text.length <= n) return text;
  const cut = text.slice(0, n), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 60 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

function aboutPage(c: Ctx): string {
  const at = seg(c.aboutSlug) + '/', root = '../';
  const paras = c.id.about.length ? c.id.about : [c.id.description].filter(Boolean);
  const main = crumbsNav(c, root, { name: c.L.about, at }) +
    `<div class="page"><h1>${esc(c.L.about)}</h1>${c.id.tagline ? `<p class="lead">${esc(c.id.tagline)}</p>` : ''}` +
    `<div class="prose">${paras.map(p => `<p>${esc(p)}</p>`).join('\n')}</div></div>`;
  const first = c.input.articles[0];
  return page(c, {
    at, title: `${c.L.about} | ${c.id.name}`, description: summary(paras[0] ?? c.id.description), current: 'about',
    image: first ? coverOf(c, first) : undefined, ld: [breadcrumbs(c, { name: c.L.about, at })], main, after: moreBand(c, root),
  });
}

/** A category's page: its name and every article in it, newest first. This is where the breadcrumbs of its articles lead. */
function categoryPage(c: Ctx, cat: Category): string {
  const at = categoryPath(cat), root = '../';
  const main = crumbsNav(c, root, { name: cat.name, at }) +
    `<div class="wrap listing"><div class="section-head"><h1>${esc(cat.name)}</h1><span class="count">${cat.articles.length}</span></div>` +
    `<ul class="grid">${cat.articles.map(a => card(c, a, root, 'h2')).join('')}</ul></div>`;
  /* No sentence of its own exists in the site's language, so the description names what the page lists. */
  const first = cat.articles[0];
  return page(c, {
    at, title: `${cat.name} | ${c.id.name}`, description: summary(cat.articles.map(a => line(a.content.title, 200)).join(' · '), 160), current: cat.slug,
    image: first ? coverOf(c, first) : undefined, ld: [breadcrumbs(c, { name: cat.name, at })], main,
  });
}

function notFoundPage(c: Ctx): string {
  const root = '/';
  const main = `<div class="page missing"><p class="code" aria-hidden="true">404</p><h1>${esc(c.L.notFoundTitle)}</h1>` +
    `<p>${esc(c.L.notFoundText)}</p><a class="btn" href="/">${esc(c.L.backHome)}</a></div>`;
  return page(c, { at: null, title: `${c.L.notFoundTitle} | ${c.id.name}`, description: '', current: '', main, after: moreBand(c, root) });
}

function sitemap(c: Ctx): string {
  const day = (ms: number) => isoDate(ms, c.zone);
  const newest = Math.max(c.input.identityUpdatedAt, ...c.input.articles.map(lastChange));
  const url = (loc: string, lastmod: number, images: string[] = []) => `<url><loc>${esc(loc)}</loc><lastmod>${day(lastmod)}</lastmod>` +
    images.map(i => `<image:image><image:loc>${esc(i)}</image:loc></image:image>`).join('') + `</url>`;
  const entries = [
    url(abs(c), newest),
    ...c.input.articles.map(a => url(abs(c, articlePath(c, a.id)), lastChange(a),
      (c.photos.get(a.id) ?? []).map(p => abs(c, 'media/' + seg(mediaName(p, largest(p))))))),
    ...c.cats.map(k => url(abs(c, categoryPath(k)), Math.max(...k.articles.map(lastChange)))),
    url(abs(c, seg(c.aboutSlug) + '/'), c.input.identityUpdatedAt),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries.join('\n')}\n</urlset>\n`;
}

/**
 * The pages load their own stylesheet, pictures and icons and nothing else: no script, no other host, no frame around
 * them. The escaping above is what keeps model-written text harmless; this policy is the second barrier.
 */
const SITE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const HEADERS = `/assets/*
  Cache-Control: public, max-age=31536000, immutable
/media/*
  Cache-Control: public, max-age=31536000, immutable
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Content-Security-Policy: ${SITE_CSP}
`;

/**
 * Folder names an article slug never takes: the ones the generator itself uses, and cdn-cgi, which Cloudflare answers
 * itself on every hostname (a page there would never be shown, so cfpages.ts refuses to deploy it).
 */
const RESERVED = new Set(['assets', 'media', 'index', '404', 'sitemap', 'robots', 'favicon', 'cdn-cgi']);
/** Folders at the root that a deploy to Cloudflare Pages cannot serve. */
const CLOUDFLARE_ONLY = 'cdn-cgi';

/** Builds the whole site. Paths are relative to the site root ("index.html", "kopi/index.html", "assets/site.1a2b3c4d.css"). */
export function buildSite(input: SiteInput): SiteFiles {
  const id = input.identity, L = id.labels;
  const { tag, dir } = langTag(input.lang, input.country);
  const domain = input.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const files: SiteFiles = new Map();

  /* Photos: only files that exist are used; a photo without any, or without alt text, is left out everywhere. */
  const photos = new Map<number, SitePhoto[]>();
  for (const a of input.articles) {
    const kept: SitePhoto[] = [];
    for (const p of a.images ?? []) {
      if (!p || (p.ext !== 'jpg' && p.ext !== 'png') || !(p.width > 0) || !(p.height > 0) || !line(p.alt, 1000)) continue;
      const stored = new Map<string, Buffer>();
      const widths = [...new Set(p.widths ?? [])].filter(w => Number.isInteger(w) && w > 0).sort((x, y) => x - y)
        .filter(w => { const name = `${p.file}-${w}.${p.ext}`; if (!MEDIA_NAME.test(name)) return false; const b = input.media(a.id, name); if (!b) return false; stored.set(name, b); return true; });
      if (!widths.length) continue;
      /* Only the files of a photo the pages show are copied. */
      for (const [name, b] of stored) files.set('media/' + name, b);
      kept.push({ ...p, widths, width: Math.round(Number(p.width)), height: Math.round(Number(p.height)) });
    }
    /* At most one hero; any other "hero" is shown inline. */
    let hero = false;
    photos.set(a.id, kept.map(p => { if (p.role !== 'hero') return p; if (hero) return { ...p, role: 'inline' as const }; hero = true; return p; }));
  }

  const aboutSlug = (() => { const s = slugify(L.about) || 'about'; return RESERVED.has(s) ? 'about' : s; })();
  const slugs = new Map<number, string>(), taken = new Set([...RESERVED, aboutSlug]);
  for (const a of input.articles) {
    const base = slugify(a.content.slug) || slugify(a.content.title) || `article-${a.id}`;
    let s = base;
    for (let n = 2; taken.has(s); n++) s = `${base}-${n}`;
    taken.add(s); slugs.set(a.id, s);
  }

  /* Categories: articles grouped by their category without regard to case, named as the newest article writes it.
     Their folders come after the articles', so an article never changes its address because a category appeared. */
  const groups = new Map<string, Category>(), catOf = new Map<number, Category>();
  for (const a of input.articles) {
    const name = categoryName(a.category);
    if (!name) continue;
    const k = groups.get(categoryKey(name)) ?? { name, slug: '', articles: [] };
    k.articles.push(a); groups.set(categoryKey(name), k); catOf.set(a.id, k);
  }
  const cats = [...groups.values()].sort((x, y) => y.articles.length - x.articles.length || x.name.localeCompare(y.name));
  cats.forEach((k, i) => {
    const base = slugify(k.name) || `category-${i + 1}`;
    let s = base;
    for (let n = 2; taken.has(s); n++) s = `${base}-${n}`;
    taken.add(s); k.slug = s;
  });

  const css = stylesheet(id, tag);
  const cssName = `site.${createHash('sha256').update(css).digest('hex').slice(0, 8)}.css`;
  const { light, dark } = schemes(id.sourceColor);
  const c: Ctx = {
    input, id, L, tag, dir, zone: zoneOf(input.country), origin: `https://${domain}`, css: cssName, aboutSlug, slugs, photos,
    cats, catOf, related: relatedLabel(L, tag),
    surface: [light.surface!, dark.surface!],
  };

  files.set(`assets/${cssName}`, css);
  files.set('index.html', homePage(c));
  for (const a of input.articles) files.set(`${slugs.get(a.id)}/index.html`, articlePage(c, a));
  for (const k of cats) files.set(`${k.slug}/index.html`, categoryPage(c, k));
  files.set(`${aboutSlug}/index.html`, aboutPage(c));
  files.set('404.html', notFoundPage(c));
  files.set('sitemap.xml', sitemap(c));
  files.set('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: https://${domain}/sitemap.xml\n`);
  files.set('_headers', HEADERS);

  /* Icons, in the theme's primary colour. */
  const mark = monogram(id.name, domain), fg = rgbOf(light['on-primary']!), bg = rgbOf(light.primary!);
  files.set('favicon.svg', iconSvg(mark, light.primary!, light['on-primary']!));
  files.set('favicon.ico', encodeIco([48, 32, 16].map(size => ({ size, png: iconPng(size, mark, bg, fg) }))));
  files.set('apple-touch-icon.png', iconPng(180, mark, bg, fg, true));
  files.set('icon-192.png', iconPng(192, mark, bg, fg));
  files.set('icon-512.png', iconPng(512, mark, bg, fg));
  files.set('site.webmanifest', JSON.stringify({
    name: id.name, short_name: [...id.name].slice(0, 24).join(''), description: id.description, lang: tag, dir,
    start_url: './', display: 'browser', background_color: light.surface, theme_color: light.primary,
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  }, null, 2) + '\n');
  return files;
}

/**
 * The 404 page with its root-relative URLs ("/assets/…", "/media/…", "/") moved under `base` (which ends with "/"), for
 * serving it somewhere other than a domain's root, such as Meridian's preview.
 */
export function rebaseRootUrls(html: string, base: string): string {
  const move = (u: string) => u.startsWith('/') && !u.startsWith('//') ? base + u.slice(1) : u;
  return html
    .replace(/(\s(?:href|src)=")([^"]*)"/g, (_, attr: string, url: string) => `${attr}${move(url)}"`)
    .replace(/(\ssrcset=")([^"]*)"/g, (_, attr: string, set: string) => `${attr}${set.split(', ').map(move).join(', ')}"`);
}

/* ---------- Checking the output ---------- */

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1]! : null;
};
const unesc = (s: string): string => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The file a link from `from` points at, or null for an outside URL or an in-page anchor. */
function target(from: string, href: string): string | null {
  const h = unesc(href);
  if (!h || h.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//')) return null;
  const clean = h.split('#')[0]!.split('?')[0]!;
  const base = h.startsWith('/') ? [] : from.split('/').slice(0, -1);
  const parts = [...base];
  for (const p of clean.split('/').slice(h.startsWith('/') ? 1 : 0)) {
    if (p === '' || p === '.') continue;
    if (p === '..') { if (!parts.length) return '\0outside'; parts.pop(); } else { try { parts.push(decodeURIComponent(p)); } catch { return '\0bad'; } }
  }
  const path = parts.join('/');
  return clean.endsWith('/') || clean === '' || clean === '.' ? (path ? path + '/index.html' : 'index.html') : path;
}

/**
 * Checks a built site the way a crawler and a careful reviewer would. Returns the problems (empty when fine): links
 * and images that point at nothing, images without alt, width or height, pages without exactly one h1 or without a
 * canonical, an id used twice on a page, a sitemap that does not list exactly the indexable pages, JSON-LD that does
 * not parse, any other script, and a folder Cloudflare Pages cannot serve.
 */
export function checkSite(files: SiteFiles, domain: string): string[] {
  const problems: string[] = [];
  const origin = `https://${domain}`;
  // Catch missing token definitions before an unusable theme reaches preview or deployment.
  for (const [path, data] of files) if (path.endsWith('.css')) {
    const css = String(data);
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
    for (const token of new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]))) {
      if (!defined.has(token)) problems.push(`${path}: undefined design token ${token}.`);
    }
    if (/text-transform:\s*uppercase/.test(css)) problems.push(`${path}: interface labels must use sentence case.`);
    if (!css.includes('prefers-reduced-motion')) problems.push(`${path}: no reduced-motion support.`);
  }
  const canonicals = new Set<string>();
  /* Every address a breadcrumb trail names, with the page that names it: each must be a page of the site. */
  const crumbs: [page: string, url: string][] = [];
  for (const path of files.keys()) if (path.split('/')[0] === CLOUDFLARE_ONLY) { problems.push(`${path}: ${CLOUDFLARE_ONLY}/ is an address Cloudflare keeps for itself.`); break; }
  for (const [path, data] of files) {
    if (!path.endsWith('.html')) continue;
    const html = String(data);
    const where = path;
    for (const m of html.matchAll(/<(a|link|img|source)\b[^>]*>/g)) {
      const tag = m[0]!;
      for (const k of ['href', 'src']) {
        const v = attr(tag, k);
        if (v === null) continue;
        const t = target(path, v);
        if (t && !files.has(t)) problems.push(`${where}: ${k}="${v}" points at a file that is not in the site.`);
      }
      const set = attr(tag, 'srcset');
      if (set) for (const part of unesc(set).split(',')) {
        const url = part.trim().split(/\s+/)[0] ?? '';
        const t = target(path, url);
        if (t && !files.has(t)) problems.push(`${where}: srcset entry ${url} points at a file that is not in the site.`);
      }
      if (m[1] === 'img') {
        const alt = attr(tag, 'alt');
        if (alt === null) problems.push(`${where}: an image has no alt text.`);
        if (!/^\d+$/.test(attr(tag, 'width') ?? '') || !/^\d+$/.test(attr(tag, 'height') ?? '')) problems.push(`${where}: an image has no width and height.`);
        /* Empty alt is for decoration only: the logo beside the site's name, which says the same. */
        if (alt === '' && !/favicon\.svg"/.test(tag)) problems.push(`${where}: an image that is not decorative has empty alt text.`);
      }
    }
    const seen = new Set<string>();
    for (const m of html.matchAll(/<[a-z][a-z0-9]*\b[^>]*?\sid="([^"]*)"/g)) {
      if (seen.has(m[1]!)) problems.push(`${where}: the id "${m[1]}" is used twice.`);
      seen.add(m[1]!);
    }
    const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
    if (h1 !== 1) problems.push(`${where}: ${h1} h1 headings (one expected).`);
    if (!/<html lang="[^"]+"/.test(html)) problems.push(`${where}: no language on <html>.`);
    if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${where}: no title.`);
    const noindex = /<meta name="robots" content="[^"]*noindex/.test(html);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
    if (!noindex) {
      if (!canonical) problems.push(`${where}: no canonical link.`);
      else if (!unesc(canonical).startsWith(origin + '/')) problems.push(`${where}: the canonical link is not on https://${domain}/.`);
      else canonicals.add(unesc(canonical));
    }
    for (const s of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!/type="application\/ld\+json"/.test(s[1]!)) { problems.push(`${where}: has a script (sites have no JavaScript).`); continue; }
      try {
        const d = JSON.parse(s[2]!) as { '@type'?: unknown; itemListElement?: unknown };
        if (d['@type'] === 'BreadcrumbList') {
          const items = Array.isArray(d.itemListElement) ? d.itemListElement as { position?: unknown; name?: unknown; item?: unknown }[] : [];
          if (items.length < 2) problems.push(`${where}: a breadcrumb trail with fewer than two steps.`);
          items.forEach((it, i) => {
            if (it.position !== i + 1 || typeof it.name !== 'string' || !it.name || typeof it.item !== 'string') problems.push(`${where}: step ${i + 1} of the breadcrumb trail has no position, name or address.`);
            else crumbs.push([where, it.item]);
          });
          /* The visible trail has the same steps. */
          const shown = (html.match(/<nav class="crumbs[^>]*>[\s\S]*?<\/nav>/)?.[0].match(/<li[\s>]/g) ?? []).length;
          if (shown !== items.length) problems.push(`${where}: the breadcrumbs shown (${shown}) and the ones in the structured data (${items.length}) differ.`);
        }
      } catch { problems.push(`${where}: structured data (JSON-LD) does not parse.`); }
    }
    /* Links: each has words to click (or a picture with alt text), and none sits inside another. */
    for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
      const inner = m[1]!;
      if (/<a\b/.test(inner)) problems.push(`${where}: a link inside another link.`);
      else if (!inner.replace(/<img\b[^>]*\salt="[^"]+"[^>]*>/g, 'x').replace(/<[^>]*>/g, '').trim()) problems.push(`${where}: a link without text (${attr(m[0]!, 'href') ?? ''}).`);
    }
    const scripts = (html.match(/<script\b/g) ?? []).length, blocks = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].length;
    if (scripts !== blocks) problems.push(`${where}: an unclosed script element.`);
  }
  const map = files.get('sitemap.xml');
  if (!map) problems.push('No sitemap.xml.');
  else {
    const locs = new Set([...String(map).matchAll(/<url><loc>([^<]+)<\/loc>/g)].map(m => unesc(m[1]!)));
    for (const u of canonicals) if (!locs.has(u)) problems.push(`The sitemap does not list ${u}.`);
    for (const u of locs) if (!canonicals.has(u)) problems.push(`The sitemap lists ${u}, which is not an indexable page.`);
  }
  for (const [where, u] of crumbs) if (!canonicals.has(u)) problems.push(`${where}: its breadcrumbs name ${u}, which is not a page of the site.`);
  const robots = files.get('robots.txt');
  if (!robots || !String(robots).includes(`Sitemap: ${origin}/sitemap.xml`)) problems.push('robots.txt does not point at the sitemap.');
  if (!files.has('favicon.ico')) problems.push('No favicon.ico.');
  return problems;
}

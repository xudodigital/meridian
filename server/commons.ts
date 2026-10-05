// Wikimedia Commons: searching for openly licensed photos, deciding from their metadata whether Meridian may use them
// (and how they must be credited), and downloading the sizes a page needs. It follows Wikimedia's rules for automated
// clients: a User-Agent that says who is calling, one API request at a time with a pause between requests, maxlag and
// Retry-After honoured, at most two file downloads at once, and only the standard thumbnail widths.
// No database here, so the tests can import it directly.
import { setTimeout as sleep } from 'node:timers/promises';
import { httpUrl } from './article-content.ts';
import { asArr, asObj, clip } from './engine.ts';
import { base, mediaHosts } from './net.ts';

/* ---------- Who we are ---------- */

/**
 * Wikimedia's User-Agent policy: "<client>/<version> (<contact>) <library>/<version>". Clients without one are
 * blocked. The contact part comes from MERIDIAN_CONTACT (an email or a URL of whoever runs this install). A header
 * carries plain ASCII only (fetch refuses anything above U+00FF before sending), so accents are dropped
 * ("Nguyễn" → "Nguyen") and any other character becomes a space.
 */
export function userAgent(): string {
  const ascii = (process.env.MERIDIAN_CONTACT || '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]|[()]/g, ' ');
  const contact = clip(ascii, 120) || 'local install';
  return `MeridianBot/1.0 (https://github.com/; ${contact}) node/${process.versions.node.split('.')[0]}`;
}

/* ---------- Thumbnail sizes ---------- */

/** The widths Wikimedia renders thumbnails at. Other widths are refused (HTTP 400) or rounded up by the API. */
export const THUMB_STEPS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840] as const;

/**
 * The width Commons really serves when a width is asked for through the API: rounded up to the next standard step,
 * and never wider than the original (a narrower original is served as it is). The API's own thumbwidth reports the
 * width asked for, not this, so it is never trusted.
 */
export function servedWidth(requested: number, original: number): number {
  const step = THUMB_STEPS.find(s => s >= requested) ?? requested;
  return Math.min(step, original);
}

/* ---------- Metadata: text, license, credit ---------- */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©',
};
/** Plain text from the HTML Commons puts in Artist, Credit, ImageDescription and Attribution. One line. */
export function htmlToText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d: string) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
}
const safeChar = (n: number) => n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';

/** One extmetadata field as the API sends it with formatversion=2: { value, source, hidden? }. */
export type ExtField = { value?: unknown; source?: string; hidden?: string };
export type ExtMetadata = Record<string, ExtField | undefined>;
const field = (m: ExtMetadata | undefined, k: string): string => {
  const v = m?.[k]?.value;
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
};
/** "true", "True", "1", "yes"... Commons writes its booleans as strings, with either case. */
const truthy = (v: string) => !!v.trim() && !/^(false|0|no)$/i.test(v.trim());

/** A license Meridian accepts: free for commercial use and changes, credited as `name`, linked to `url` ('' for CC0/PD). */
export type License = { kind: 'cc0' | 'pd' | 'by' | 'by-sa'; name: string; url: string };

/** NC, ND, fair use, non-free: none of these may go on a public, possibly commercial site. */
const NOT_FREE = /(^|[^a-z0-9])(nc|nd)([^a-z0-9]|$)|non-?commercial|no-?deriv|fair[ -]use|non-?free/i;

/** A license URL on https; a protocol-relative one is made absolute. '' for anything that is not a web address. */
function licenseUrl(v: string): string {
  const u = httpUrl(v.trim().startsWith('//') ? 'https:' + v.trim() : v);
  return u.replace(/^http:/, 'https:');
}
/** The deed of a Creative Commons license from Commons' normalised key, for a file whose LicenseUrl is missing. */
function ccDeed(key: string): string {
  const m = key.match(/^cc-(by(?:-sa)?)-(\d(?:\.\d)?)(?:-([a-z]{2,8}))?$/);
  return m ? `https://creativecommons.org/licenses/${m[1]}/${m[2]}/${m[3] ? m[3] + '/' : ''}` : '';
}

/**
 * Whether a file may be used, from its extmetadata, and how its license is named and linked. Accepted: CC0, public
 * domain (pd, cc-pd, Public Domain Mark), CC BY and CC BY-SA of any version or port. Refused: NC, ND, fair use, GFDL
 * alone, Free Art License, "Copyrighted free use" and "Attribution" (not machine-checkable), anything marked non-free,
 * nominated for deletion or carrying restrictions (personality rights, trademarks, insignia...), and a missing license.
 * The normalised `License` key is read first; without it, only a recognisable LicenseShortName is accepted.
 */
export function licenseOf(m: ExtMetadata | undefined): License | null {
  const name = clip(htmlToText(field(m, 'LicenseShortName')), 80), key = field(m, 'License').trim().toLowerCase();
  if (!name) return null;
  if (field(m, 'DeletionReason').trim() || truthy(field(m, 'NonFree')) || field(m, 'Restrictions').trim()) return null;
  if (NOT_FREE.test(name) || NOT_FREE.test(key)) return null;
  let kind: License['kind'] | null = null;
  if (key) {
    if (key === 'cc0') kind = 'cc0';
    else if (key === 'pd' || key === 'cc-pd') kind = 'pd';
    else if (/^cc-by-sa-\d/.test(key)) kind = 'by-sa';
    else if (/^cc-by-\d/.test(key)) kind = 'by';
  } else if (/^cc0\b|^cc-zero\b/i.test(name)) kind = 'cc0';
  else if (/^(public domain( mark)?|pdm)\b/i.test(name)) kind = 'pd';
  else if (/^cc[ -]by[ -]sa[ -]\d/i.test(name)) kind = 'by-sa';
  else if (/^cc[ -]by[ -]\d/i.test(name)) kind = 'by';
  if (!kind) return null;
  const url = licenseUrl(field(m, 'LicenseUrl')) || (kind === 'by' || kind === 'by-sa' ? ccDeed(key) : '');
  /* Attribution licenses must link to their terms; without a known link the file is not used. */
  if ((kind === 'by' || kind === 'by-sa') && !url) return null;
  return { kind, name, url };
}

/** The first link in an HTML fragment as an absolute https URL (Commons writes //commons.wikimedia.org/...), or ''. */
export function firstHref(html: string): string {
  const m = html.match(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const raw = htmlToText(m?.[1] ?? m?.[2] ?? '');
  if (!raw || /[?&](redlink=1|action=edit)/.test(raw)) return '';
  const abs = raw.startsWith('//') ? 'https:' + raw : raw.startsWith('/') ? 'https://commons.wikimedia.org' + raw : raw;
  const u = httpUrl(abs);
  return /^http:\/\/([a-z0-9-]+\.)*(wikimedia|wikipedia|wikidata)\.org\//i.test(u) ? u.replace(/^http:/, 'https:') : u;
}

/** Who to credit (TASL "author"): the author's own credit line, else the Artist, else the Credit (source) field. */
export function authorOf(m: ExtMetadata | undefined): { author: string; authorUrl: string } {
  const artistHtml = field(m, 'Artist');
  let artist = htmlToText(artistHtml);
  if (/^(unknown|unknown author|author unknown)$/i.test(artist)) artist = '';
  const author = htmlToText(field(m, 'Attribution')) || artist || htmlToText(field(m, 'Credit'));
  return { author: clip(author, 200), authorUrl: firstHref(artistHtml) };
}

/* ---------- Search ---------- */

/** One page of a formatversion=2 query answer, with the imageinfo fields Meridian asks for. */
export type ImageInfo = {
  size?: number; width?: number; height?: number; mime?: string; url?: string; descriptionurl?: string;
  thumburl?: string; thumbwidth?: number; thumbheight?: number; extmetadata?: ExtMetadata;
};
export type Page = { pageid?: number; ns?: number; title?: string; index?: number; missing?: boolean; imageinfo?: ImageInfo[] };

/** A photo that passed the license and size checks, with everything needed to credit it. */
export type Candidate = {
  /** The file page title, "File:...". */
  file: string;
  /** TASL title: ObjectName, or the file name without "File:" and its extension. */
  title: string;
  description: string;
  width: number; height: number;
  mime: 'image/jpeg' | 'image/png';
  /** A small (330 px) rendering for the agent to look at. */
  previewUrl: string;
  /** The file's description page on Commons (TASL source). */
  sourceUrl: string;
  author: string; authorUrl: string;
  license: License;
};

/** Why a page was not kept, for the job's step text. */
export type Skip = 'license' | 'format' | 'size';

const EXT_FIELDS = 'LicenseShortName|License|LicenseUrl|Artist|Credit|Attribution|AttributionRequired|UsageTerms|ImageDescription|ObjectName|Restrictions|Copyrighted|NonFree|DeletionReason';
/** Smallest original kept: the article pages show photos 960 and 1280 px wide. */
export const MIN_WIDTH = 960;

/** A candidate from one page of a search answer, or why it is not one. */
export function toCandidate(p: Page): Candidate | Skip {
  const ii = p.imageinfo?.[0];
  if (!ii || p.missing || !p.title) return 'format';
  if (ii.mime !== 'image/jpeg' && ii.mime !== 'image/png') return 'format';
  const width = Number(ii.width) || 0, height = Number(ii.height) || 0;
  /* Too small for a page, or so wide or tall that it would not work as an article photo. */
  if (width < MIN_WIDTH || !height || width / height > 2.5 || width / height < 0.5) return 'size';
  const license = licenseOf(ii.extmetadata);
  if (!license) return 'license';
  const sourceUrl = httpUrl(ii.descriptionurl);
  if (!sourceUrl) return 'format';
  const m = ii.extmetadata;
  const fileName = p.title.replace(/^File:/i, '').replace(/\.[a-z0-9]{2,5}$/i, '');
  return {
    file: p.title, title: clip(htmlToText(field(m, 'ObjectName')) || fileName, 200),
    description: clip(htmlToText(field(m, 'ImageDescription')), 500),
    width, height, mime: ii.mime, previewUrl: ii.thumburl || '', sourceUrl, ...authorOf(m), license,
  };
}

/**
 * Searches Commons for photos (bitmaps wider than 1200 px, without personality-rights or trademark templates) and
 * returns the usable ones in relevance order, and the files it dropped with the reason. Metadata and a 330 px preview
 * come back in the same request.
 */
export async function searchPhotos(query: string, signal: AbortSignal, limit = 12): Promise<{ candidates: Candidate[]; skipped: { file: string; why: Skip }[] }> {
  const data = await apiGet({
    action: 'query', format: 'json', formatversion: '2', maxlag: '5',
    generator: 'search', gsrnamespace: '6', gsrlimit: String(limit),
    gsrsearch: `${query} filetype:bitmap filew:>1200 -hastemplate:"Personality rights" -hastemplate:"Trademarked"`,
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '330',
    iiextmetadatafilter: EXT_FIELDS, iiextmetadatalanguage: 'en',
  }, signal);
  /* With a generator, pages do not come back in relevance order: `index` gives it. */
  const pages = (asArr(asObj(data.query).pages) as Page[]).filter(p => p && typeof p === 'object').sort((a, b) => (a.index ?? 1e9) - (b.index ?? 1e9));
  const skipped: { file: string; why: Skip }[] = [], candidates: Candidate[] = [];
  for (const p of pages) {
    const c = toCandidate(p);
    if (typeof c === 'string') skipped.push({ file: p.title || '', why: c }); else candidates.push(c);
  }
  return { candidates, skipped };
}

/**
 * The URL of each file rendered at `width` (the API rounds it up to a standard step, or gives the original when that
 * is narrower), by file title. One request for up to 50 files.
 */
export async function thumbUrls(files: string[], width: number, signal: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!files.length) return out;
  const data = await apiGet({
    action: 'query', format: 'json', formatversion: '2', maxlag: '5',
    titles: files.slice(0, 50).join('|'), prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: String(width),
  }, signal);
  const q = asObj(data.query);
  /* A title may come back normalised (underscores as spaces); map it back to the one asked for. */
  const asked = new Map<string, string>(files.map(f => [f, f]));
  for (const n of asArr(q.normalized).map(asObj)) if (typeof n.from === 'string' && typeof n.to === 'string') asked.set(n.to, n.from);
  for (const p of asArr(q.pages) as Page[]) {
    const url = p?.imageinfo?.[0]?.thumburl || p?.imageinfo?.[0]?.url;
    const title = p?.title ? asked.get(p.title) : undefined;
    if (title && url) out.set(title, url);
  }
  return out;
}

/* ---------- The API, one request at a time ---------- */

/** Pause after a slow request and the base of the backoff after maxlag or 429/503, in ms (the tests shorten it). */
const politeWait = () => Number(process.env.MERIDIAN_COMMONS_WAIT_MS) || 5_000;
/** Pause between two quick requests: keeps an unauthenticated client well under 5 requests a second. */
const GAP_MS = 200;
const TRIES = 4;

let chain: Promise<unknown> = Promise.resolve();
let nextAt = 0;
/** Runs API requests strictly one after another, whoever asks (Wikimedia's robot policy: concurrency 1). */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  try { await sleep(ms, undefined, { signal }); } catch { throw new Error('The job was cancelled.'); }
}
/** How long to wait before try `attempt` + 1: what Retry-After says, at least the polite wait, doubling each time. */
function backoff(attempt: number, retryAfter: string | null): number {
  const said = Number(retryAfter) * 1000;
  return Math.min(Math.max(Number.isFinite(said) ? said : 0, politeWait() * 2 ** attempt), 120_000);
}
const both = (signal: AbortSignal, ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);

/** One Action API GET. Retries on maxlag, 429 and 503 after the wait the server asks for; throws a readable error. */
async function apiGet(params: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const url = base('COMMONS') + '/w/api.php?' + new URLSearchParams(params).toString();
  return serial(async () => {
    for (let attempt = 0; ; attempt++) {
      await pause(nextAt - Date.now(), signal);
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(url, { headers: { 'user-agent': userAgent(), accept: 'application/json' }, redirect: 'error', signal: both(signal, 30_000) });
      } catch (e) {
        nextAt = Date.now() + politeWait();
        if (signal.aborted) throw new Error('The job was cancelled.');
        throw new Error((e as Error).name === 'TimeoutError' ? 'Wikimedia Commons did not answer in time.' : 'Could not reach Wikimedia Commons. Check the internet connection.');
      }
      /* Robot policy: after a request that took over a second, wait 5 seconds before the next. */
      nextAt = Date.now() + (Date.now() - started > 1000 ? politeWait() : GAP_MS);
      const retryAfter = res.headers.get('retry-after');
      if (res.status === 429 || res.status === 503) {
        await res.body?.cancel();
        if (attempt + 1 < TRIES) { nextAt = Date.now() + backoff(attempt, retryAfter); continue; }
        throw new Error(`Wikimedia Commons is busy (HTTP ${res.status}). Try again later.`);
      }
      if (!res.ok) { await res.body?.cancel(); throw new Error(`Wikimedia Commons answered with HTTP ${res.status}.`); }
      let data: Record<string, unknown>;
      try { data = asObj(await res.json()); } catch { throw new Error('Wikimedia Commons sent an answer that is not JSON.'); }
      const err = asObj(data.error);
      if (err.code === 'maxlag') {
        if (attempt + 1 < TRIES) { nextAt = Date.now() + backoff(attempt, retryAfter); continue; }
        throw new Error('Wikimedia Commons is under heavy load. Try again later.');
      }
      if (err.code) throw new Error('Wikimedia Commons refused the request: ' + clip(err.info || err.code, 200));
      return data;
    }
  });
}

/* ---------- Downloads ---------- */

/** Largest photo file accepted. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/**
 * A media URL Meridian may download: https on an allowed host (http only for 127.0.0.1, the tests' fake), without the
 * utm_* tracking parameters Commons appends (they are not used by MediaWiki). Null for anything else.
 */
export function mediaUrl(v: string): URL | null {
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.username || u.password || !mediaHosts().includes(u.host.toLowerCase())) return null;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1')) return null;
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
  return u;
}

/* Robot policy for media: at most two downloads at once. */
let free = 2;
const waiting: (() => void)[] = [];
async function slot(): Promise<() => void> {
  if (free > 0) free--; else await new Promise<void>(r => waiting.push(r));
  return () => { const next = waiting.shift(); if (next) next(); else free++; };
}

export type ImageFile = { bytes: Buffer; type: 'jpg' | 'png'; width: number; height: number };

/**
 * Downloads one image from Wikimedia's media servers: redirects only to allowed hosts, a JPEG or PNG only (by header
 * and by content), at most `maxBytes`, with its real pixel size read from the file.
 */
export async function downloadImage(url: string, signal: AbortSignal, maxBytes = MAX_PHOTO_BYTES): Promise<ImageFile> {
  const first = mediaUrl(url);
  if (!first) throw new Error('The photo is not on Wikimedia\'s media servers.');
  let u: URL = first;
  const release = await slot();
  try {
    let res: Response;
    for (let hops = 0, attempt = 0; ;) {
      try {
        res = await fetch(u, { headers: { 'user-agent': userAgent(), accept: 'image/jpeg, image/png' }, redirect: 'manual', signal: both(signal, 60_000) });
      } catch {
        if (signal.aborted) throw new Error('The job was cancelled.');
        throw new Error('Could not download a photo from Wikimedia Commons.');
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel();
        const next: URL | null = loc ? mediaUrl(new URL(loc, u).href) : null;
        if (!next || ++hops > 3) throw new Error('A photo download was redirected away from Wikimedia\'s media servers.');
        u = next;
        continue;
      }
      if ((res.status === 429 || res.status === 503) && attempt < 2) {
        await res.body?.cancel();
        await pause(backoff(attempt++, res.headers.get('retry-after')), signal);
        continue;
      }
      break;
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`Wikimedia's media server answered with HTTP ${res.status}.`); }
    const type = (res.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'image/jpeg' && type !== 'image/png') { await res.body?.cancel(); throw new Error('A photo download was not a JPEG or PNG file.'); }
    if (Number(res.headers.get('content-length')) > maxBytes) { await res.body?.cancel(); throw new Error('A photo file is too large.'); }
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        size += chunk.byteLength;
        if (size > maxBytes) { await res.body.cancel().catch(() => undefined); throw new Error('A photo file is too large.'); }
        chunks.push(Buffer.from(chunk));
      }
    }
    const bytes = Buffer.concat(chunks), dim = imageSize(bytes);
    if (!dim || dim.type !== (type === 'image/png' ? 'png' : 'jpg')) throw new Error('A downloaded photo is not a valid JPEG or PNG file.');
    return { bytes, ...dim };
  } finally { release(); }
}

/* ---------- Pixel size from the file header ---------- */

/** The EXIF orientation (1-8) in a JPEG APP1 segment's body, or null. */
function exifOrientation(seg: Buffer): number | null {
  if (seg.length < 14 || seg.toString('latin1', 0, 6) !== 'Exif\0\0') return null;
  const t = seg.subarray(6), order = t.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o: number) => le ? t.readUInt16LE(o) : t.readUInt16BE(o);
  const u32 = (o: number) => le ? t.readUInt32LE(o) : t.readUInt32BE(o);
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : null; }
  }
  return null;
}

/**
 * The format and displayed pixel size of a JPEG or PNG from its header: PNG IHDR; JPEG's first frame header (SOFn),
 * with width and height swapped when the EXIF orientation turns the picture a quarter (browsers apply it). Null when
 * the bytes are neither.
 */
export function imageSize(b: Buffer): { type: 'jpg' | 'png'; width: number; height: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a && b.toString('latin1', 12, 16) === 'IHDR') {
    const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
    return width && height ? { type: 'png', width, height } : null;
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2, orientation = 1;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) { i++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    if (marker === 0xe1) orientation = exifOrientation(b.subarray(i + 4, i + 2 + len)) ?? orientation;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (len < 7) return null;
      const height = b.readUInt16BE(i + 5), width = b.readUInt16BE(i + 7);
      if (!width || !height) return null;
      return orientation >= 5 ? { type: 'jpg', width: height, height: width } : { type: 'jpg', width, height };
    }
    i += 2 + len;
  }
  return null;
}

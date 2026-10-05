// Puts a built site live on Cloudflare Pages with Direct Upload over the HTTP API, the way `wrangler pages deploy`
// does it (cloudflare/workers-sdk: wrangler/src/pages/{deploy,upload,validate}.ts, api/pages/deploy.ts):
//   project (get, or create with production branch "main") → upload JWT → check-missing → upload the missing files
//   in buckets → upsert-hashes → create the deployment (multipart: manifest + _headers/_redirects) → poll its status.
// Files are named by wrangler's exact key, blake3(base64(bytes) + extension) cut to 32 hex: Cloudflare accepts any
// key, but files stored under another key are not served (and unchanged files are skipped across deploys only
// because the key comes from the content). Tokens and JWTs never appear in a message or a log.
//
// The second half connects a site's own domain to its project (domains.ts drives it): the project's custom domains
// (list, add, read, retry validation), the zone a domain belongs to, and the DNS records at one name. It only ever
// reads, adds and changes: nothing here deletes a domain or a DNS record.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { extname, join } from 'node:path';
import { blake3Hex } from './blake3.ts';
import { ServiceError, base, errorText, short } from './net.ts';

export type DeployInput = {
  /** Folder with the built site (index.html at its root). */
  dir: string;
  /** Pages project name ([a-z0-9-], see projectName). Created when missing. */
  project: string;
  account: string;
  token: string;
  /** Omitted: the production branch. */
  branch?: string;
  onStep: (step: string) => void;
  signal?: AbortSignal;
};
export type DeployResult = {
  /** The URL of this deployment (https://<short>.<project>.pages.dev). */
  url: string;
  /** The project's production URL (https://<subdomain>), where a production deploy is live. */
  productionUrl: string;
  deploymentId: string;
  /** Files in the deployment, and how many had to be uploaded (others were already stored). */
  files: number;
  uploaded: number;
};

/** What stopped a deploy, for callers that react to it (for example marking the Cloudflare token as not working). */
export type PagesProblem = 'token' | 'permission' | 'account' | 'project' | 'files' | 'upload' | 'deploy' | 'network' | 'stopped'
  /* Custom domains (the second half of this file): the domain belongs to another project, or Cloudflare refused it. */
  | 'in-use' | 'domain';
/** A deploy that could not finish. `message` is fit to show a person. */
export class PagesError extends ServiceError {
  problem: PagesProblem;
  constructor(message: string, problem: PagesProblem, status = 0) { super(message, status); this.problem = problem; }
}

const MIB = 1024 * 1024;
/* Wrangler's limits (pages/constants.ts) and the platform's (developers.cloudflare.com/pages/platform/limits). */
const MAX_FILE_BYTES = 25 * MIB, MAX_FILES = 20_000, BUCKET_BYTES = 40 * MIB, BUCKET_FILES = 2000, UPLOAD_LANES = 3;
const UPLOAD_TRIES = 5, CHECK_TRIES = 5, CREATE_TRIES = 3, JWT_RENEWALS = 3;
/* Status polls: wrangler's backoff of 1, 2, 4, 8 and 16 units, then every 16 units until about 300 units (5 minutes). */
const POLL_STEP_MAX = 16, POLL_UNITS = 300;
/* Pages API error codes: unknown error (worth a retry), project not found, upload JWT refused (expired). */
const CODE_UNKNOWN = 8000000, CODE_NO_PROJECT = 8000007, CODE_JWT = 8000013;
/* Left out of the asset upload: these names at the root, these anywhere. `_headers` and `_redirects` travel with the
   deployment itself; `_worker.js` and `_routes.json` would be Pages Functions, which Meridian never makes. Wrangler also
   skips a root `functions` folder and `.wrangler` because they are source and state in a project folder; a build
   folder holds only the site, where `functions/` is an ordinary article address (slugify keeps "Functions"), so it
   is deployed like any other folder. */
const SKIP_AT_ROOT = new Set(['_worker.js', '_redirects', '_headers', '_routes.json']);
/* Cloudflare answers /cdn-cgi/ on every hostname itself ("managed and served by Cloudflare", cdn-cgi endpoint docs),
   so files there would never be shown: the deploy stops and says so rather than leave a page that 404s. */
const CLOUDFLARE_ONLY = 'cdn-cgi';
const SKIP_ANYWHERE = new Set(['.DS_Store', 'node_modules', '.git']);
const SPECIAL = ['_headers', '_redirects'];
/* The Content-Type each file is served with (wrangler uses the `mime` package; these are its answers). */
const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript',
  json: 'application/json', map: 'application/json', webmanifest: 'application/manifest+json', xml: 'application/xml',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/vnd.microsoft.icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf', wasm: 'application/wasm',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', zip: 'application/zip',
};

/* A domain of letters, digits and single dots ending in a top-level domain of letters: most domains the app accepts. */
const PLAIN_DOMAIN = /^[a-z0-9]+(\.[a-z0-9]+)*\.[a-z]+$/;

/**
 * The Pages project name for a domain: [a-z0-9-], 1 to 58 characters, no hyphen at either end (it is the DNS label
 * of <name>.pages.dev). Each domain gets its own name, because a project is reused when it exists and a second site
 * deployed into it would replace the first one's live site:
 * - a plain domain is written with "-" for each dot ("kopi.co.id" → "kopi-co-id"). That alone is not enough once
 *   domains may contain hyphens ("vn.example.com" and "vn-example.com" would both be "vn-example-com");
 * - any other domain (hyphens, a long name, anything unusual) is the readable part cut to 49 characters, "-", and a
 *   tag of 8 characters from sha256 of the domain whose last character is a digit. A plain name ends in a letter
 *   (its top-level domain), so the two kinds can never meet; two tagged names meet only if their hashes do.
 */
export function projectName(domain: string): string {
  const d = domain.trim().toLowerCase();
  const readable = d.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (PLAIN_DOMAIN.test(d) && readable.length <= 58) return readable;
  const h = createHash('sha256').update(d).digest('hex');
  const tag = h.slice(0, 7) + (parseInt(h.slice(7, 9), 16) % 10);
  return (readable.slice(0, 49).replace(/-+$/, '') || 'site') + '-' + tag;
}
/* What Cloudflare takes as a project name. */
const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;

/** The key Pages stores a file under, exactly as wrangler's hashFile: blake3(base64(bytes) + extension without the dot), hex, first 32. */
export function assetHash(bytes: Uint8Array, name: string): string {
  const b64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  return blake3Hex(b64 + extname(name).slice(1)).slice(0, 32);
}

type SiteFile = { name: string; full: string; size: number; type: string; hash: string };
type Jwt = { value: string; exp: number; max: number };
type Project = { name?: string; subdomain?: string; production_branch?: string; source?: { type?: string } | null };
type Stage = { name?: string; status?: string };
type Deployment = { id?: string; short_id?: string; url?: string; latest_stage?: Stage | null; file_count?: number };
type Answer<T> = { status: number; ok: boolean; result: T | undefined; code: number; text: string };
/** One deploy's connection: the account, the API token, and the upload JWT that is shared by the parallel uploads. */
type Conn = { account: string; token: string; project: string; signal?: AbortSignal; jwt: Jwt; renewing: Promise<void> | null; lanes: number };

const stopped = () => new PagesError('The deploy was stopped before it finished.', 'stopped');
const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
/* Rounded up, so a file just over the limit does not read as exactly 25 MB. */
const mb = (n: number) => `${(Math.ceil(n / MIB * 10) / 10).toFixed(1)} MB`;
/* One unit of backoff: 1 s like wrangler; the tests shorten it. */
const unit = () => Number(process.env.MERIDIAN_CF_POLL_MS) || 1000;

async function wait(c: Conn, ms: number): Promise<void> {
  try { await sleep(ms, undefined, { signal: c.signal }); } catch { throw stopped(); }
}

/** A Cloudflare API call. Answers with the status and the parsed envelope; throws only when Cloudflare cannot be reached. */
async function api<T>(c: { signal?: AbortSignal }, path: string, init: { auth: string; json?: unknown; form?: FormData; timeoutMs?: number; method?: 'GET' | 'POST' | 'PATCH' }): Promise<Answer<T>> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'Meridian/1.0', authorization: 'Bearer ' + init.auth };
  let body: string | FormData | undefined;
  /* FormData gets its multipart boundary from fetch, so no content-type is set for it here. */
  if (init.form) body = init.form;
  else if (init.json !== undefined) { body = JSON.stringify(init.json); headers['content-type'] = 'application/json'; }
  const limit = AbortSignal.timeout(Math.ceil(init.timeoutMs ?? 30_000));
  const signal = c.signal ? AbortSignal.any([c.signal, limit]) : limit;
  let res: Response, raw = '';
  try {
    res = await fetch(base('CLOUDFLARE') + '/client/v4' + path, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, signal, redirect: 'error' });
    raw = await res.text();
  } catch (e) {
    if (c.signal?.aborted) throw stopped();
    const late = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError';
    throw new PagesError(late ? 'Cloudflare did not answer in time.' : 'Could not reach Cloudflare. Check the internet connection.', 'network');
  }
  let data: { success?: boolean; result?: T; errors?: { code?: number }[] } = {};
  try { data = raw ? JSON.parse(raw) as typeof data : {}; } catch { /* a gateway page, not JSON */ }
  const ok = res.status >= 200 && res.status < 300 && data.success !== false;
  /* Cloudflare's own words go inside sentences of ours, so without their closing period. */
  return { status: res.status, ok, result: data.result, code: Number(data.errors?.[0]?.code) || 0, text: short(errorText(data), 200).replace(/\.+$/, '') };
}

/* Worth trying again: Cloudflare could not be reached, or answered with a server error or a rate limit. */
const transient = (a: Answer<unknown>) => a.status >= 500 || a.status === 429 || a.code === CODE_UNKNOWN;
const gateway = (a: Answer<unknown>) => a.status === 502 || a.status === 503 || a.status === 504;
const unreachable = (e: unknown) => e instanceof PagesError && e.problem === 'network';

/** An answer to a call made with the API token, in words. */
function refusal(a: Answer<unknown>, doing: string): PagesError {
  if (a.status === 401) return new PagesError('Cloudflare did not accept the API token. Check it under Integrations > Cloudflare.', 'token', a.status);
  if (a.code === 7003 || a.code === 7000) return new PagesError('Cloudflare does not know this Account ID. Copy it from the account home page in the Cloudflare dashboard into Integrations > Cloudflare.', 'account', a.status);
  if (a.status === 403 || a.code === 10000) return new PagesError('The Cloudflare token may not use Pages in this account. Give it the permission Account > Cloudflare Pages > Edit, and check that the Account ID is the right one.', 'permission', a.status);
  return new PagesError(`Cloudflare could not ${doing}: ${a.text || 'it answered ' + a.status}.`, transient(a) ? 'network' : 'deploy', a.status);
}

/** The site's files, in a stable order, with `_headers` and `_redirects` set apart. Checks the per-file size limit. */
async function siteFiles(dir: string): Promise<{ assets: SiteFile[]; special: Map<string, Buffer> }> {
  const assets: SiteFile[] = [];
  const special = new Map<string, Buffer>();
  const walk = async (folder: string, prefix: string): Promise<void> => {
    const names = (await readdir(folder)).sort();
    for (const n of names) {
      if (!prefix && n === CLOUDFLARE_ONLY) throw new PagesError(`This build has ${n}/, an address Cloudflare keeps for itself, so the page there would never be shown. Give that article another slug and build the website again.`, 'files');
      if ((!prefix && SKIP_AT_ROOT.has(n)) || SKIP_ANYWHERE.has(n)) {
        if (!prefix && SPECIAL.includes(n)) { const s = await lstat(join(folder, n)); if (s.isFile()) special.set(n, await readFile(join(folder, n))); }
        continue;
      }
      const full = join(folder, n), rel = prefix + n, s = await lstat(full);
      /* A link could point outside the build folder; a build never makes one. */
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) { await walk(full, rel + '/'); continue; }
      if (!s.isFile()) continue;
      if (s.size > MAX_FILE_BYTES) throw new PagesError(`${rel} is too large for Cloudflare Pages (${mb(s.size)}; the limit is 25 MB a file).`, 'files');
      assets.push({ name: rel, full, size: s.size, type: MIME[extname(n).slice(1).toLowerCase()] ?? 'application/octet-stream', hash: '' });
    }
  };
  try { await walk(dir, ''); }
  catch (e) {
    if (e instanceof PagesError) throw e;
    throw new PagesError('The files of this build are missing, so there is nothing to deploy. Build the website again.', 'files');
  }
  return { assets, special };
}

/** A file's bytes; a build folder does not change, so a failure means it was removed or changed during the deploy. */
async function contentOf(f: SiteFile): Promise<Buffer> {
  try { return await readFile(f.full); }
  catch { throw new PagesError(`${f.name} disappeared from the build while it was being deployed. Build the website again.`, 'files'); }
}

/** The project to deploy to, created (production branch "main") when the account does not have it yet. */
async function ensureProject(c: Conn, onStep: (s: string) => void): Promise<Project> {
  const path = `/accounts/${c.account}/pages/projects/${c.project}`;
  const got = await api<Project>(c, path, { auth: c.token });
  if (got.ok && got.result) {
    const git = got.result.source?.type;
    if (git) throw new PagesError(`The Pages project "${c.project}" in this account is connected to ${git === 'gitlab' ? 'GitLab' : 'GitHub'}, so Meridian cannot upload to it. Rename or delete that project in the Cloudflare dashboard, then deploy again.`, 'project');
    return got.result;
  }
  if (!(got.code === CODE_NO_PROJECT || (got.status === 404 && got.code !== 7003 && got.code !== 7000))) throw refusal(got, 'open the Pages project');
  onStep(`Creating the Pages project ${c.project}`);
  const made = await api<Project>(c, `/accounts/${c.account}/pages/projects`, { auth: c.token, json: { name: c.project, production_branch: 'main' } });
  if (made.ok && made.result) return made.result;
  if (made.status === 409 || /already exists|taken|in use|not available|unavailable/i.test(made.text)) {
    throw new PagesError(`Cloudflare will not create a Pages project named "${c.project}"${made.text ? ': ' + made.text : ', the name is taken'}. Free the name in the Cloudflare dashboard, then deploy again.`, 'project', made.status);
  }
  throw refusal(made, 'create the Pages project');
}

function claims(jwt: string): { exp?: unknown; max_file_count_allowed?: unknown } {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>; } catch { return {}; }
}

/** A fresh upload JWT for /pages/assets/*. Its claims say when it expires and how many files a deployment may have. */
async function uploadToken(c: Conn): Promise<Jwt> {
  const a = await api<{ jwt?: string }>(c, `/accounts/${c.account}/pages/projects/${c.project}/upload-token`, { auth: c.token });
  const value = a.result?.jwt;
  if (!a.ok || typeof value !== 'string' || !value) throw refusal(a, 'give an upload token');
  const cl = claims(value);
  return { value, exp: typeof cl.exp === 'number' ? cl.exp : 0, max: typeof cl.max_file_count_allowed === 'number' ? cl.max_file_count_allowed : MAX_FILES };
}

/** Replaces the JWT that was refused. Parallel uploads refused at once share one renewal. */
async function renewJwt(c: Conn, refused: string): Promise<void> {
  if (c.jwt.value !== refused) return;
  c.renewing ??= uploadToken(c).then(j => { c.jwt = j; }).finally(() => { c.renewing = null; });
  await c.renewing;
}
/** The JWT to use now: renewed first when its `exp` has passed (or is a few seconds away). */
async function jwtNow(c: Conn): Promise<string> {
  if (c.jwt.exp && c.jwt.exp * 1000 <= Date.now() + 5_000) await renewJwt(c, c.jwt.value);
  return c.jwt.value;
}
const jwtRefused = (a: Answer<unknown>) => a.code === CODE_JWT || a.status === 401;

/**
 * A call to /pages/assets/* with the upload JWT: renews a refused JWT (without counting it as a try), retries what is
 * worth retrying with backoff, and returns the answer that ended it. `tries` counts real failures only.
 */
async function assetCall<T>(c: Conn, path: string, json: unknown, tries: number, timeoutMs?: number, backoff = (n: number, a: Answer<unknown> | null) => unit() * 2 ** n * (a && gateway(a) ? 5 : 1)): Promise<Answer<T> | null> {
  let failures = 0, renewals = 0, last: Answer<T> | null = null;
  for (;;) {
    const jwt = await jwtNow(c);
    try { last = await api<T>(c, path, { auth: jwt, json, timeoutMs }); }
    catch (e) { if (!unreachable(e)) throw e; last = null; }
    if (last?.ok) return last;
    if (last && jwtRefused(last) && renewals < JWT_RENEWALS) { renewals++; await renewJwt(c, jwt); continue; }
    if (last && !transient(last)) return last;
    if (++failures >= tries) return last;
    /* A gateway in trouble: wrangler drops to one upload at a time and waits longer. */
    if (last && gateway(last)) c.lanes = 1;
    await wait(c, backoff(failures - 1, last));
  }
}

/** Places files largest first into buckets of at most 40 MiB and 2000 files, as wrangler does (three to start with). */
function buckets(files: SiteFile[]): SiteFile[][] {
  const bs = Array.from({ length: UPLOAD_LANES }, () => ({ files: [] as SiteFile[], room: BUCKET_BYTES }));
  let offset = 0;
  for (const f of [...files].sort((a, b) => b.size - a.size)) {
    const b = bs.map((_, i) => bs[(i + offset) % bs.length]!).find(x => x.room >= f.size && x.files.length < BUCKET_FILES);
    if (b) { b.files.push(f); b.room -= f.size; } else bs.push({ files: [f], room: BUCKET_BYTES - f.size });
    offset++;
  }
  return bs.map(b => b.files).filter(fs => fs.length);
}

async function uploadBucket(c: Conn, files: SiteFile[]): Promise<void> {
  /* Read only now, so at most three buckets of contents are in memory. */
  const payload = await Promise.all(files.map(async f => ({ key: f.hash, value: (await contentOf(f)).toString('base64'), metadata: { contentType: f.type }, base64: true })));
  const bytes = files.reduce((n, f) => n + f.size, 0);
  /* A full bucket is about 53 MB of JSON: allow a slow line (100 KB/s) on top of a minute. */
  const a = await assetCall(c, '/pages/assets/upload', payload, UPLOAD_TRIES, 60_000 + bytes / 100);
  if (a?.ok) return;
  if (!a) throw new PagesError(`Could not reach Cloudflare to upload the files after ${UPLOAD_TRIES} tries. Check the internet connection and deploy again.`, 'network');
  throw new PagesError(`Cloudflare did not take the files${a.text ? ': ' + a.text : ' (it answered ' + a.status + ')'}. Deploy again in a few minutes.`, transient(a) ? 'network' : 'upload', a.status);
}

/** Uploads the buckets, three at a time (one at a time once a gateway error was seen). */
async function uploadAll(c: Conn, files: SiteFile[]): Promise<void> {
  const queue = buckets(files);
  const lane = async (n: number): Promise<void> => {
    try { while (n < c.lanes && queue.length) await uploadBucket(c, queue.shift()!); }
    /* One bucket failed for good: the deploy fails, so the other lanes take no more work. */
    catch (e) { queue.length = 0; throw e; }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_LANES, queue.length) }, (_, n) => lane(n)));
}

async function checkMissing(c: Conn, hashes: string[]): Promise<Set<string>> {
  const a = await assetCall<unknown>(c, '/pages/assets/check-missing', { hashes }, CHECK_TRIES);
  if (a?.ok && Array.isArray(a.result)) return new Set(a.result.filter((h): h is string => typeof h === 'string'));
  if (!a) throw new PagesError('Could not reach Cloudflare to check the files. Check the internet connection and deploy again.', 'network');
  throw new PagesError(`Cloudflare could not check which files it already has${a.text ? ': ' + a.text : ' (it answered ' + a.status + ')'}.`, transient(a) ? 'network' : 'upload', a.status);
}

/** Tells Cloudflare that every file of this deployment is in use. A failure only slows the next deploy (wrangler warns and goes on). */
async function upsertHashes(c: Conn, hashes: string[]): Promise<void> {
  try { await assetCall(c, '/pages/assets/upsert-hashes', { hashes }, 2, undefined, () => unit()); }
  catch (e) { if (e instanceof PagesError && e.problem === 'stopped') throw e; }
}

async function createDeployment(c: Conn, manifest: Record<string, string>, special: Map<string, Buffer>, branch?: string): Promise<Deployment> {
  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest));
  if (branch) form.append('branch', branch);
  for (const [name, bytes] of special) form.append(name, new File([new Uint8Array(bytes)], name));
  for (let n = 0; ; n++) {
    let a: Answer<Deployment> | null = null;
    try { a = await api<Deployment>(c, `/accounts/${c.account}/pages/projects/${c.project}/deployments`, { auth: c.token, form, timeoutMs: 120_000 }); }
    catch (e) { if (!unreachable(e) || n + 1 >= CREATE_TRIES) throw e; }
    if (a?.ok && a.result?.id) return a.result;
    if (a && (!transient(a) || n + 1 >= CREATE_TRIES)) throw refusal(a, 'start the deployment');
    await wait(c, unit() * 2 ** n);
  }
}

const finished = (s: Stage | null | undefined) => !!s && (s.status === 'failure' || s.status === 'canceled' || (s.name === 'deploy' && s.status === 'success'));

/**
 * Polls the deployment until its deploy stage succeeds or something fails. Wrangler stops after five polls (about
 * 30 s) and calls the outcome unknown; a deployment queued behind others at Cloudflare can take longer, and calling it
 * failed while it then goes live would leave Meridian saying the opposite of what is served. So this keeps asking
 * every 16 units for up to about 5 minutes, and only then says it does not know.
 */
async function settle(c: Conn, first: Deployment): Promise<Deployment> {
  const path = `/accounts/${c.account}/pages/projects/${c.project}/deployments/${first.id}`;
  let dep = first;
  for (let n = 0, waited = 0; waited < POLL_UNITS && !finished(dep.latest_stage); n++) {
    const units = Math.min(2 ** n, POLL_STEP_MAX);
    await wait(c, unit() * units);
    waited += units;
    let a: Answer<Deployment> | null = null;
    try { a = await api<Deployment>(c, path, { auth: c.token }); } catch (e) { if (!unreachable(e)) throw e; }
    if (a?.ok && a.result) dep = a.result;
    else if (a && (a.status === 401 || a.status === 403)) throw refusal(a, 'tell how the deployment went');
  }
  const s = dep.latest_stage;
  if (s?.status === 'failure' || s?.status === 'canceled') {
    /* For Direct Upload the last log line says why (wrangler shows the same). */
    let why = '';
    try {
      const logs = await api<{ data?: { line?: string }[] }>(c, path + '/history/logs?size=10000000', { auth: c.token });
      why = short(String(logs.result?.data?.at(-1)?.line ?? '').replace('Error:', ''), 200);
    } catch { /* the reason is a nicety */ }
    throw new PagesError(s.status === 'canceled' ? 'The deployment was canceled at Cloudflare.' : `Cloudflare could not put the site live${why ? ': ' + why : '.'}`, 'deploy');
  }
  if (!finished(s)) throw new PagesError(`Cloudflare took the files but had not finished the deployment after five minutes. Look at the project ${c.project} in the Cloudflare dashboard: if this deployment is not live there, deploy again.`, 'deploy');
  /* A deployment can succeed with no files at all; it would serve nothing but errors. */
  if (dep.file_count === 0) throw new PagesError('Cloudflare made the deployment without any files, so the site would be empty. Deploy again.', 'deploy');
  return dep;
}

/* Only an https address made of host characters goes on to the dashboard. */
const httpsUrl = (u: unknown, fallback: string): string => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+(\/[\w\-./]*)?$/i.test(u) ? u.replace(/\/$/, '') : fallback;

/** Deploys a build folder to a Pages project and waits until it is live. Throws a PagesError that says what to fix. */
export async function deployToPages(i: DeployInput): Promise<DeployResult> {
  const account = (i.account || '').trim(), token = (i.token || '').trim();
  if (!account) throw new PagesError('Deploying needs the Cloudflare Account ID. Add it under Integrations > Cloudflare.', 'account');
  if (!/^[0-9a-f]{32}$/i.test(account)) throw new PagesError('The Cloudflare Account ID does not look right: it is 32 characters of 0-9 and a-f, shown on the account home page in the Cloudflare dashboard.', 'account');
  if (!token) throw new PagesError('Deploying needs a Cloudflare API token. Add it under Integrations > Cloudflare.', 'token');
  if (!PROJECT_NAME.test(i.project)) throw new PagesError(`"${short(i.project, 70)}" cannot be a Pages project name: it takes a-z, 0-9 and hyphens (not at either end), up to 58 characters.`, 'project');
  const c: Conn = { account, token, project: i.project, signal: i.signal, jwt: { value: '', exp: 0, max: MAX_FILES }, renewing: null, lanes: UPLOAD_LANES };
  if (i.signal?.aborted) throw stopped();

  i.onStep('Reading the website files');
  const { assets, special } = await siteFiles(i.dir);
  if (!assets.length) throw new PagesError('This build has no files to deploy. Build the website again.', 'files');

  i.onStep(`Getting the Pages project ${i.project} ready`);
  const project = await ensureProject(c, i.onStep);
  c.jwt = await uploadToken(c);
  if (assets.length > c.jwt.max) throw new PagesError(`This build has ${plural(assets.length, 'file')}; Cloudflare Pages takes up to ${c.jwt.max.toLocaleString('en-US')} in one deployment.`, 'files');

  i.onStep(`Checking which of the ${plural(assets.length, 'file')} Cloudflare already has`);
  for (const f of assets) {
    if (c.signal?.aborted) throw stopped();
    f.hash = assetHash(await contentOf(f), f.name);
  }
  const hashes = [...new Set(assets.map(f => f.hash))];
  const missing = await checkMissing(c, hashes);
  const toUpload = assets.filter(f => missing.has(f.hash));
  /* Files with the same content and extension share a key: one upload serves them all. */
  const unique = [...new Map(toUpload.map(f => [f.hash, f])).values()];
  const kept = assets.length - toUpload.length;
  i.onStep(toUpload.length ? `Uploading ${plural(toUpload.length, 'file')}${kept ? ` (${kept.toLocaleString('en-US')} already stored)` : ''}` : `All ${plural(assets.length, 'file')} are already stored at Cloudflare`);
  await uploadAll(c, unique);
  await upsertHashes(c, hashes);

  i.onStep('Starting the deployment');
  /* Manifest keys start with "/" (wrangler's upload.ts); the API docs' example leaves it out, wrangler is what works. */
  const manifest = Object.fromEntries(assets.map(f => ['/' + f.name, f.hash]));
  const created = await createDeployment(c, manifest, special, i.branch);

  i.onStep('Waiting for Cloudflare to put it live');
  const dep = await settle(c, created);
  const sub = /^[a-z0-9.-]+$/i.test(project.subdomain ?? '') ? project.subdomain! : `${i.project}.pages.dev`;
  const productionUrl = 'https://' + sub;
  return {
    url: httpsUrl(dep.url, dep.short_id && /^[a-z0-9]+$/i.test(dep.short_id) ? `https://${dep.short_id}.${sub}` : productionUrl),
    productionUrl, deploymentId: String(dep.id ?? created.id), files: assets.length, uploaded: toUpload.length,
  };
}

/* ---------- Custom domains: the project's domains, the zone, and DNS records ---------- */

/** The account and API token of the Cloudflare integration. */
export type CfAuth = { account: string; token: string; signal?: AbortSignal };

/**
 * A custom domain of a Pages project as Cloudflare reports it (Pages > Projects > Domains in the API reference).
 * `status`: initializing | pending | active | deactivated | blocked | error. `verification` is whether the DNS points
 * at the project (pending | active | deactivated | blocked | error); `validation` is the certificate (initializing |
 * pending | active | deactivated | error) with its method (http | txt) and, for txt, the record to add.
 */
export type PagesDomain = {
  name: string; status: string; verification: string; validation: string; method: string;
  txtName: string; txtValue: string; error: string; zoneTag: string;
};
type RawDomain = {
  name?: unknown; status?: unknown; zone_tag?: unknown;
  validation_data?: { method?: unknown; status?: unknown; error_message?: unknown; txt_name?: unknown; txt_value?: unknown } | null;
  verification_data?: { status?: unknown; error_message?: unknown } | null;
};
const word = (v: unknown, max = 40): string => typeof v === 'string' ? short(v, max) : '';
function domainOf(r: RawDomain | undefined, name: string): PagesDomain {
  const va = r?.validation_data ?? {}, ve = r?.verification_data ?? {};
  return {
    name: word(r?.name, 253) || name, status: word(r?.status), verification: word(ve.status), validation: word(va.status), method: word(va.method),
    txtName: word(va.txt_name, 300), txtValue: word(va.txt_value, 600),
    /* Cloudflare's own words about what is wrong, the certificate's first (it is the more specific one). */
    error: (word(va.error_message, 300) || word(ve.error_message, 300)).replace(/\.+$/, ''), zoneTag: word(r?.zone_tag, 64),
  };
}
const domainsPath = (a: CfAuth, project: string, name?: string) =>
  `/accounts/${a.account}/pages/projects/${encodeURIComponent(project)}/domains${name ? '/' + encodeURIComponent(name) : ''}`;
const missing = (a: Answer<unknown>) => a.status === 404 && a.code !== 7003 && a.code !== 7000;

/** The custom domain as the project has it, or null when it is not attached to this project. */
export async function getPagesDomain(a: CfAuth, project: string, name: string): Promise<PagesDomain | null> {
  const r = await api<RawDomain>(a, domainsPath(a, project, name), { auth: a.token });
  if (r.ok && r.result) return domainOf(r.result, name);
  if (missing(r)) return null;
  throw refusal(r, 'tell whether the domain is connected');
}

/**
 * Attaches a domain to the project (POST …/domains). Cloudflare then checks that the DNS points at the project and
 * issues a certificate. A domain that another project (or account) already uses is refused: problem 'in-use'.
 */
export async function addPagesDomain(a: CfAuth, project: string, name: string): Promise<PagesDomain> {
  const r = await api<RawDomain>(a, domainsPath(a, project), { auth: a.token, json: { name } });
  if (r.ok && r.result) return domainOf(r.result, name);
  if (r.status === 401 || r.status === 403 || r.code === 7003 || r.code === 7000 || r.code === 10000) throw refusal(r, 'connect the domain');
  if (r.status === 409 || /already|in use|taken|another (project|account)/i.test(r.text)) {
    throw new PagesError(`${name} is already connected to another Cloudflare Pages project${r.text ? ' (Cloudflare says: ' + r.text + ')' : ''}. Remove it there under Custom domains in the Cloudflare dashboard, then check again.`, 'in-use', r.status);
  }
  if (transient(r)) throw refusal(r, 'connect the domain');
  throw new PagesError(`Cloudflare did not accept ${name} as a custom domain: ${r.text || 'it answered ' + r.status}.`, 'domain', r.status);
}

/** Asks Cloudflare to check the domain again now (PATCH …/domains/<name>), after the DNS was changed. */
export async function retryPagesDomain(a: CfAuth, project: string, name: string): Promise<PagesDomain | null> {
  const r = await api<RawDomain>(a, domainsPath(a, project, name), { auth: a.token, method: 'PATCH' });
  if (r.ok && r.result) return domainOf(r.result, name);
  if (missing(r)) return null;
  throw refusal(r, 'check the domain again');
}

/**
 * Where the DNS of a domain is managed, as far as the token can tell: a zone of this account ('account'), a zone the
 * token sees in another account ('other'), no zone the token sees ('elsewhere': another DNS provider, or a zone the
 * token was not given), or 'unreadable' when the token may not list zones at all (it needs Zone > Zone > Read).
 */
export type ZoneAnswer = { where: 'account'; id: string; name: string } | { where: 'other'; name: string } | { where: 'elsewhere' } | { where: 'unreadable' };
type RawZone = { id?: unknown; name?: unknown; account?: { id?: unknown } | null };
export async function findZone(a: CfAuth, domain: string): Promise<ZoneAnswer> {
  const labels = domain.toLowerCase().split('.');
  let other = '';
  /* The longest zone name first: "shop.kopi.example" may be its own zone, or a name in the zone "kopi.example". */
  for (let i = 0; i + 2 <= labels.length; i++) {
    const name = labels.slice(i).join('.');
    const r = await api<RawZone[]>(a, `/zones?name=${encodeURIComponent(name)}&per_page=50`, { auth: a.token });
    if (r.status === 401) throw refusal(r, 'look up the zone');
    if (r.status === 403 || r.code === 10000) return { where: 'unreadable' };
    if (!r.ok) throw refusal(r, 'look up the zone');
    for (const z of Array.isArray(r.result) ? r.result : []) {
      if (typeof z?.id !== 'string' || !/^[0-9a-f]{32}$/i.test(z.id) || String(z.name).toLowerCase() !== name) continue;
      if (String(z.account?.id ?? '').toLowerCase() === a.account.toLowerCase()) return { where: 'account', id: z.id, name };
      other ||= name;
    }
  }
  return other ? { where: 'other', name: other } : { where: 'elsewhere' };
}

export type DnsRecord = { id: string; type: string; name: string; content: string; proxied: boolean; comment: string };
type RawRecord = { id?: unknown; type?: unknown; name?: unknown; content?: unknown; proxied?: unknown; comment?: unknown };
const recordOf = (r: RawRecord): DnsRecord => ({
  id: word(r.id, 64), type: word(r.type, 10).toUpperCase(), name: word(r.name, 253).toLowerCase(), content: word(r.content, 300), proxied: r.proxied === true, comment: word(r.comment, 200),
});
const forbidden = (r: Answer<unknown>) => r.status === 403 || r.code === 10000;

/** Every DNS record at exactly this name in the zone, or 'forbidden' when the token may not read the zone's DNS. */
export async function dnsRecordsAt(a: CfAuth, zoneId: string, name: string): Promise<DnsRecord[] | 'forbidden'> {
  const r = await api<RawRecord[]>(a, `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=100`, { auth: a.token });
  if (r.status === 401) throw refusal(r, 'read the DNS records');
  if (forbidden(r)) return 'forbidden';
  if (!r.ok) throw refusal(r, 'read the DNS records');
  return (Array.isArray(r.result) ? r.result : []).map(recordOf).filter(x => x.id && x.name === name.toLowerCase());
}

/** The note on a record Meridian made, so a person reading the zone knows where it came from. */
export const DNS_COMMENT = 'Added by Meridian for the Cloudflare Pages site';
/**
 * Adds the proxied CNAME that points a name at the project (POST /zones/<id>/dns_records; the token needs Zone > DNS >
 * Edit). 'forbidden' when the token may not; 'exists' when Cloudflare says a record is already at that name (someone
 * added one since the caller looked): nothing was changed.
 */
export async function createCname(a: CfAuth, zoneId: string, name: string, target: string): Promise<DnsRecord | 'forbidden' | 'exists'> {
  const r = await api<RawRecord>(a, `/zones/${zoneId}/dns_records`, { auth: a.token, json: { type: 'CNAME', name, content: target, proxied: true, ttl: 1, comment: DNS_COMMENT } });
  if (r.ok && r.result) return recordOf(r.result);
  if (r.status === 401) throw refusal(r, 'add the DNS record');
  if (forbidden(r)) return 'forbidden';
  if (r.code === 81053 || r.code === 81057 || r.code === 81058 || /already exists/i.test(r.text)) return 'exists';
  throw new PagesError(`Cloudflare did not add the DNS record for ${name}: ${r.text || 'it answered ' + r.status}.`, transient(r) ? 'network' : 'domain', r.status);
}

/** Points a CNAME that Meridian made earlier back at the project, proxied (PATCH). The caller checks it is Meridian's own. */
export async function repairCname(a: CfAuth, zoneId: string, recordId: string, name: string, target: string): Promise<DnsRecord | 'forbidden'> {
  const r = await api<RawRecord>(a, `/zones/${zoneId}/dns_records/${encodeURIComponent(recordId)}`, { auth: a.token, method: 'PATCH', json: { type: 'CNAME', name, content: target, proxied: true } });
  if (r.ok && r.result) return recordOf(r.result);
  if (r.status === 401) throw refusal(r, 'repair the DNS record');
  if (forbidden(r)) return 'forbidden';
  throw new PagesError(`Cloudflare did not repair the DNS record for ${name}: ${r.text || 'it answered ' + r.status}.`, transient(r) ? 'network' : 'domain', r.status);
}

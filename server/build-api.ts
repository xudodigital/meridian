// The website routes: list builds, ask for one, approve or reject it, deploy it, download it as a ZIP, and preview its
// files. Build and deploy is not a reviewer's screen, so native reviewers get 403 on all of them. Every change is
// announced on the bus as 'build' (builds.ts) and written to the audit log here, in the words the app uses.
//
// The preview serves a build's files under /api/preview/<site>/<version>/ with the session cookie, like any GET. The
// pages have no script, and the content security policy forbids scripts, frames of the preview elsewhere, forms and
// anything from another host, so a preview can never call Meridian's API.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { open, readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { actorOf, mayWrite, seesSite, type Ctx } from './access.ts';
import {
  approveBuild, approvedCount, buildAt, buildDir, buildRow, deployBuild, filesKept, identityOf, listBuilds, rejectBuild, requestBuild,
  zipPath, type BuildRow, type BuildView, type Outcome,
} from './builds.ts';
import { ENGINE_MISSING, engineReady } from './engine.ts';
import { bus } from './events.ts';
import { body, json, note } from './http.ts';
import { kick } from './jobs.ts';
import { rebaseRootUrls } from './sitebuild.ts';
import type { UserRow } from './users.ts';
import { addAudit, siteInfo } from './workspace.ts';
import { cachedZip } from './zip.ts';

const NOT_FOR_REVIEWERS = 'Your role reviews articles only.';
const FILES_GONE = 'The files of this build were removed to save space. Build the website again.';
const LIST = '/api/builds';
const ASK = /^\/api\/sites\/([^/]{1,64})\/builds$/;
const ACTION = /^\/api\/builds\/(\d{1,9})\/(approve|reject|deploy)$/;
const ZIP = /^\/api\/builds\/(\d{1,9})\/zip$/;
const PREVIEW = /^\/api\/preview\/([^/]{1,64})\/(\d{1,6})(\/.*)?$/;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.json': 'application/json; charset=utf-8',
};
const PREVIEW_HEADERS = {
  'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-robots-tag': 'noindex', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
};

/** Builds visible to a person, newest first, for GET /api/state (none for a native reviewer). */
export function buildsState(u: UserRow): BuildView[] {
  return u.role === 'reviewer' ? [] : listBuilds().filter(b => seesSite(u, b.siteId));
}

/** A path inside a build folder, or null when it would leave it (.., NUL, backslashes, anything odd). */
function inside(dir: string, rel: string): string | null {
  if (rel.includes('\0') || rel.includes('\\') || rel.split('/').some(p => p === '..' || p === '.')) return null;
  const full = resolve(dir, '.' + rel);
  return full === dir || full.startsWith(dir + sep) ? full : null;
}
const isFile = (p: string) => stat(p).then(s => s.isFile(), () => false);
const isDir = (p: string) => stat(p).then(s => s.isDirectory(), () => false);

async function preview(res: ServerResponse, siteId: string, version: number, rest: string | undefined): Promise<void> {
  const b = buildAt(siteId, version);
  if (!b || b.status !== 'ready') return json(res, 404, { error: 'This build is not ready.' });
  if (b.pruned) return json(res, 410, { error: FILES_GONE });
  const base = `/api/preview/${encodeURIComponent(siteId)}/${version}/`;
  /* Without the slash, the pages' relative links would resolve one level too high. */
  if (rest === undefined) { res.writeHead(301, { location: base, 'cache-control': 'no-store' }).end(); return; }
  const dir = buildDir(b);
  let file = inside(dir, rest.endsWith('/') ? rest + 'index.html' : rest);
  /* A folder without the slash goes to the slash, as Cloudflare Pages does. */
  if (file && !rest.endsWith('/') && await isDir(file)) {
    res.writeHead(308, { location: base + rest.slice(1).split('/').map(encodeURIComponent).join('/') + '/', 'cache-control': 'no-store' }).end();
    return;
  }
  let status = 200;
  if (!file || !(await isFile(file))) { status = 404; file = resolve(dir, '404.html'); }
  let data = await readFile(file);
  /* The not-found page links from the site's root (it is served at any depth); here the root is the preview path. */
  if (status === 404) data = Buffer.from(rebaseRootUrls(data.toString('utf8'), base));
  res.writeHead(status, { 'content-type': TYPES[extname(file).toLowerCase()] || 'text/plain; charset=utf-8', ...PREVIEW_HEADERS });
  res.end(data);
}

/** Sends a build as a ZIP: written once next to the build folder, then streamed from that file. */
async function sendZip(res: ServerResponse, b: BuildRow): Promise<void> {
  if (b.status !== 'ready') return json(res, 409, { error: 'This build is not ready.' });
  if (!filesKept(b)) return json(res, 410, { error: FILES_GONE });
  let file: string;
  try { file = await cachedZip(buildDir(b), zipPath(b)); }
  catch (e) {
    if (!filesKept(buildRow(b.id) ?? b)) return json(res, 410, { error: FILES_GONE });
    throw e;
  }
  /* Opened before the answer starts, so a prune deleting the file meanwhile cannot cut the download short. */
  const fh = await open(file, 'r');
  let size: number;
  try { size = (await fh.stat()).size; } catch (e) { await fh.close(); throw e; }
  const name = `${b.domain.replace(/[^A-Za-z0-9.-]+/g, '-')}-v${b.version}.zip`;
  res.writeHead(200, {
    'content-type': 'application/zip', 'content-length': String(size), 'content-disposition': `attachment; filename="${name}"`,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  });
  /* A download the browser stops is not an error of the server. */
  await pipeline(fh.createReadStream(), res).catch(() => undefined);
}

/** Handles the website routes. Returns false for any other path. */
export async function buildApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const m = req.method || 'GET', u = ctx.user;
  const ask = path.match(ASK), act = path.match(ACTION), zip = path.match(ZIP), pre = path.match(PREVIEW);
  const list = path === LIST;
  if (!(list && m === 'GET') && !(ask && m === 'POST') && !(act && m === 'POST') && !(zip && m === 'GET') && !(pre && m === 'GET')) return false;
  if (u.role === 'reviewer') { json(res, 403, { error: NOT_FOR_REVIEWERS }); return true; }

  if (list) { json(res, 200, { builds: buildsState(u) }); return true; }
  if (pre) { await preview(res, pre[1]!, Number(pre[2]), pre[3]); return true; }

  if (zip) {
    const b = buildRow(Number(zip[1]));
    if (!b) { json(res, 404, { error: 'Build not found.' }); return true; }
    await sendZip(res, b);
    return true;
  }

  const no = mayWrite(u);
  if (no) { json(res, no.status, { error: no.error }); return true; }
  const audit = (act: string, site: string) => bus.emit('audit', addAudit(actorOf(ctx), act, site));
  const answer = (o: Outcome, status = 200): true => {
    if (!o.ok) json(res, o.status, { error: o.error });
    else json(res, status, { build: o.build });
    return true;
  };

  if (ask) {
    const site = siteInfo(ask[1]!);
    if (!site) { json(res, 404, { error: 'That site is not saved yet. Wait a moment and try again.' }); return true; }
    /* The first build asks the Site Builder for the site's name and colours: that needs OpenAI API. */
    if (approvedCount(site.id, site.domain) && !identityOf(site.id) && !(await engineReady())) { json(res, 503, { error: ENGINE_MISSING }); return true; }
    const o = requestBuild(site, u.name);
    if (o.ok) { audit(`Asked for a website build of ${site.domain}`, site.id); kick(); }
    return answer(o, 202);
  }

  const id = Number(act![1]), action = act![2]!;
  const b = buildRow(id);
  if (!b) { json(res, 404, { error: 'Build not found.' }); return true; }
  const what = `website v${b.version} of ${b.domain}`;
  if (action === 'approve') {
    const o = approveBuild(id, u.name);
    if (!o.ok) return answer(o);
    audit(`Approved ${what}`, b.site_id);
    if (o.deployQueued) kick();
    /* `note` says why it is not going live by itself, when it is not. */
    json(res, 200, { build: o.build, deployQueued: !!o.deployQueued, note: o.note ?? '' });
    return true;
  }
  if (action === 'reject') {
    const n = note((await body(req)).note, 2000);
    if (!n) { json(res, 400, { error: 'Write a note first, so the Site Builder knows what to change.' }); return true; }
    const o = rejectBuild(id, u.name, n);
    if (o.ok) audit(`Rejected ${what}: ${n}`, b.site_id);
    return answer(o);
  }
  const o = deployBuild(id);
  if (o.ok) { audit(`Asked to put ${b.domain} v${b.version} live on Cloudflare Pages`, b.site_id); kick(); }
  return answer(o, 202);
}

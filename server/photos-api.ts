// The photo routes: ask the Site Builder to find photos for an article again, take a photo out, and serve the stored
// photo files to the dashboard. Writes need an admin or editor and are written to the audit log; a file is served only
// to people who may see the article's site, and only from that article's own folder.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { actorOf, mayWrite, seesSite, type Ctx } from './access.ts';
import { articleRow, articleTitle, type Outcome } from './articles.ts';
import { ENGINE_MISSING, engineStatus, engineReady } from './engine.ts';
import { bus } from './events.ts';
import { body, json } from './http.ts';
import { kick } from './jobs.ts';
import { MEDIA_NAME, articleMediaDir, findPhotos, removePhoto } from './photos.ts';
import { addAudit } from './workspace.ts';

const FIND = /^\/api\/articles\/(\d{1,9})\/photos$/;
const ONE = /^\/api\/articles\/(\d{1,9})\/photos\/([a-z0-9]{1,16})$/;
const MEDIA = /^\/api\/media\/articles\/(\d{1,9})\/([^/]{1,240})$/;

/** Handles the photo routes. Returns false for any other path. */
export async function photoApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const method = req.method || 'GET';
  let m: RegExpMatchArray | null;

  if ((method === 'GET' || method === 'HEAD') && (m = path.match(MEDIA))) {
    await media(req, res, Number(m[1]), m[2]!, ctx);
    return true;
  }

  /* Audit entry under the session's person, in the words the app uses. */
  const answer = (o: Outcome, status: number, act: (title: string) => string) => {
    if (!o.ok) { json(res, o.status, { error: o.error }); return true; }
    const row = articleRow(o.article.id);
    if (row) bus.emit('audit', addAudit(actorOf(ctx), act(articleTitle(row)), row.site_id));
    json(res, status, { article: o.article });
    return true;
  };

  if (method === 'POST' && (m = path.match(FIND))) {
    await body(req);
    const no = mayWrite(ctx.user);
    if (no) { json(res, no.status, { error: no.error }); return true; }
    if (!articleRow(Number(m[1]))) { json(res, 404, { error: 'Article not found.' }); return true; }
    if (!(await engineReady())) { json(res, 503, { error: (await engineStatus()).reason || ENGINE_MISSING }); return true; }
    const o = findPhotos(Number(m[1]));
    if (o.ok) kick();
    return answer(o, 202, t => 'Asked the Site Builder to find photos for: ' + t);
  }

  if (method === 'DELETE' && (m = path.match(ONE))) {
    const no = mayWrite(ctx.user);
    if (no) { json(res, no.status, { error: no.error }); return true; }
    return answer(removePhoto(Number(m[1]), m[2]!), 200, t => 'Removed a photo from ' + t);
  }
  return false;
}

/**
 * GET /api/media/articles/:id/:name: one stored photo file. The name must look like one Meridian writes and must be a
 * regular file inside that article's folder, so no path can reach anything else.
 */
async function media(req: IncomingMessage, res: ServerResponse, id: number, rawName: string, ctx: Ctx): Promise<void> {
  const notFound = () => json(res, 404, { error: 'Not found.' });
  const a = articleRow(id);
  if (!a) return notFound();
  if (!seesSite(ctx.user, a.site_id)) return json(res, 403, { error: 'Not allowed.' });
  const name = rawName.normalize('NFC');
  if (!MEDIA_NAME.test(name)) return notFound();
  const dir = resolve(articleMediaDir(id)), full = resolve(dir, name);
  if (!full.startsWith(dir + sep)) return notFound();
  const st = await lstat(full).catch(() => null);
  if (!st?.isFile()) return notFound();
  const data = await readFile(full);
  res.writeHead(200, {
    'content-type': name.endsWith('.png') ? 'image/png' : 'image/jpeg',
    'content-length': data.length,
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

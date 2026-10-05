/* HTTP calls for an article's photos (server/photos-api.ts) and a site's website builds (server/build-api.ts). Nothing
   here touches the store. Photo files, build previews and ZIP downloads are plain same-origin GETs (an <img>, a link):
   the session cookie goes with them, so they need no call here, only their paths. */
import { apiSend } from './serverApi';
import type { BuildWire, PhotoWire, ServerArticle } from './types';

const article = (r: { article: ServerArticle }) => r.article;
/** An action on a build answers with the build as the server now has it; an older server may answer without it. */
const build = (r: { build?: BuildWire }) => r.build ?? null;

export const photosApi = {
  /** "Find photos": queues a photo job for the article (202). */
  find: (aid: number) => apiSend<{ article: ServerArticle }>(`/api/articles/${aid}/photos`).then(article),
  /** Removes one photo from the article, and its files. */
  remove: (aid: number, photoId: string) => apiSend<{ article: ServerArticle }>(`/api/articles/${aid}/photos/${encodeURIComponent(photoId)}`, {}, 'DELETE').then(article),
};

export const buildsApi = {
  /** "Build website": queues a build of the site from its approved articles (202). */
  build: (siteId: string) => apiSend<{ build?: BuildWire }>(`/api/sites/${encodeURIComponent(siteId)}/builds`).then(build),
  /** Approves a build waiting for review. `note` says why it is not going live by itself ('' when it is, or when an
      older server did not say): Cloudflare is not connected, or a newer version is live (deploying this one rolls back). */
  approve: (id: number) => apiSend<{ build?: BuildWire; note?: string }>(`/api/builds/${id}/approve`)
    .then(r => ({ build: build(r), note: typeof r.note === 'string' ? r.note : '' })),
  reject: (id: number, note: string) => apiSend<{ build?: BuildWire }>(`/api/builds/${id}/reject`, { note }).then(build),
  /** Puts an approved build live on Cloudflare Pages: a first deploy, a retry, or a roll back to an older version (202). */
  deploy: (id: number) => apiSend<{ build?: BuildWire }>(`/api/builds/${id}/deploy`).then(build),
};

/** The stored base name of a photo file: the server makes it from letters, digits and hyphens only. */
const FILE_RE = /^[\p{L}\p{M}a-z0-9-]+$/u;

/** Where the dashboard reads one stored width of a photo, or '' when the server sent something that is not a file name. */
export function photoSrc(aid: number, p: Pick<PhotoWire, 'file' | 'ext'>, width: number): string {
  if (!FILE_RE.test(p.file) || (p.ext !== 'jpg' && p.ext !== 'png') || !Number.isInteger(width) || width <= 0) return '';
  return `/api/media/articles/${aid}/${encodeURIComponent(`${p.file}-${width}.${p.ext}`)}`;
}
/** The srcset of a photo: every stored width. */
export const photoSrcSet = (aid: number, p: Pick<PhotoWire, 'file' | 'ext' | 'widths'>): string =>
  p.widths.map(w => [photoSrc(aid, p, w), w] as const).filter(([src]) => src).map(([src, w]) => `${src} ${w}w`).join(', ');

/** The ZIP of a build (a download link). */
export const buildZipPath = (id: number): string => `/api/builds/${id}/zip`;

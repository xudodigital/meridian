/* The photos of a real article: openly licensed photos from Wikimedia Commons that the Site Builder chose on the
   server, with their alt text, caption and credit, and the photo job's status. Files are read from the server
   (/api/media/...), never from the photo's source, so reviewing an article does not reach any third party. */
import { useId, useState } from 'react';
import { Button, Callout, Chip, Dialog, Empty, Pill, SheetActions } from '@/components';
import { photoSrc, photoSrcSet } from '@/store/buildsApi';
import { HELD_LABEL, heldFor } from '@/store/spend';
import { useStore } from '@/store/store';
import type { Article, ArticleBlock, PhotoJobWire, PhotoWire, ServerArticle } from '@/store/types';
import './photos.css';

/** A link only for an absolute http(s) URL; anything else is shown as text. */
const isHttp = (url: string): boolean => /^https?:\/\//i.test(url);
const ext = (href: string, text: string) => isHttp(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{text}</a> : text;

/** The main photo first, then the others in the order they appear in the text. */
export const photosInOrder = (list: readonly PhotoWire[]): PhotoWire[] =>
  [...list].sort((x, y) => (x.role === 'hero' ? -1 : x.after ?? 0) - (y.role === 'hero' ? -1 : y.after ?? 0));

/** Admins and editors find and remove photos; the server refuses everyone else. */
const useMayWrite = (): boolean => useStore(s => s.session?.role === 'admin' || s.session?.role === 'editor');

/** "Photo: title, author, license, via Wikimedia Commons", as the built site credits it. */
export function Credit({ p }: { p: PhotoWire }) {
  return (
    <>
      {ext(p.sourceUrl, p.title || 'Photo')}{p.author ? <>, {ext(p.authorUrl, p.author)}</> : null}, {p.licenseUrl ? ext(p.licenseUrl, p.license) : p.license}, via {p.provider}
    </>
  );
}

/** The photo as it sits in the article: the image and its caption in the site's language. */
export function PhotoFigure({ aid, p }: { aid: number; p: PhotoWire }) {
  const src = photoSrc(aid, p, p.widths.at(0) ?? p.width);
  return (
    <figure className="ph-fig">
      {src ? <img src={src} srcSet={photoSrcSet(aid, p)} sizes="(min-width: 1200px) 480px, 90vw" width={p.width} height={p.height} alt={p.alt} loading="lazy" decoding="async" /> : null}
      <figcaption>{p.caption}</figcaption>
    </figure>
  );
}

/** The English side of a photo in the article table: what it shows, for the team. */
export const photoEnglish = (p: PhotoWire) => <><Chip>{p.role === 'hero' ? 'Main photo' : 'Photo'}</Chip> {p.captionEn}<span className="note ph-alt">Alt text: {p.altEn}</span></>;

/** The block an inline photo follows, in English, shortened. */
function placeOf(blocks: readonly ArticleBlock[], after: number | null): string {
  const b = after == null ? undefined : blocks[after];
  if (!b || !('en' in b)) return 'In the text';
  const t = b.en.length > 48 ? b.en.slice(0, 47).trimEnd() + '…' : b.en;
  return `After “${t}”`;
}

/** The Photos section of a written real article. */
export function ArticlePhotos({ a, srv }: { a: Article; srv: ServerArticle }) {
  const mayWrite = useMayWrite();
  const findPhotos = useStore(s => s.findPhotos);
  /* The server holds a waiting photo job of a site that used its daily budget (store/spend.ts). */
  const held = useStore(s => heldFor(s, srv.siteId, srv.domain));
  const removePhoto = useStore(s => s.removePhoto);
  const [removing, setRemoving] = useState<PhotoWire | null>(null);
  const titleId = useId();
  const job = srv.photos, images = photosInOrder(srv.images ?? []);
  const busy = job?.status === 'queued' || job?.status === 'work', failed = job?.status === 'failed';
  /* The running job replaces the photos when it ends, so the server refuses a removal meanwhile (server/photos.ts). */
  const mayRemove = mayWrite && job?.status !== 'work';
  /* The server finds photos for an article in review or approved only. */
  const canFind = mayWrite && (srv.status === 'review' || srv.status === 'approved');
  const blocks = srv.content?.blocks ?? [];
  return (
    <section>
      <div className="ph-head">
        <h3>Photos</h3>
        {canFind && !busy && !failed
          ? <Button size="sm" variant="tonal" icon="image_search" onClick={() => findPhotos(a.id)}>{images.length || job?.status ? 'Find photos again' : 'Find photos'}</Button>
          : null}
      </div>
      <JobStatus job={job} held={held} canRetry={canFind} onRetry={() => findPhotos(a.id)} />
      {images.length ? (
        <ul className="ph-list">
          {images.map(p => {
            const big = photoSrc(srv.id, p, p.widths.at(-1) ?? p.width), small = photoSrc(srv.id, p, p.widths.at(0) ?? p.width);
            return (
              <li key={p.id} className="ph-item">
                {small ? (
                  <a href={big} target="_blank" rel="noopener" aria-label={'Open the full photo: ' + p.altEn}>
                    <img src={small} srcSet={photoSrcSet(srv.id, p)} sizes="(min-width: 1200px) 320px, (min-width: 600px) 45vw, 90vw" width={p.width} height={p.height} alt={p.alt} loading="lazy" decoding="async" />
                  </a>
                ) : null}
                <div className="ph-body">
                  <div className="row">
                    {p.role === 'hero' ? <Pill kind="info">Main photo</Pill> : <Pill kind="mut">In the text</Pill>}
                    {p.role === 'hero' ? <span className="note">Above the text</span> : <span className="note">{placeOf(blocks, p.after)}</span>}
                  </div>
                  <dl>
                    <dt>Alt text</dt><dd>{p.alt}<span className="note">{p.altEn}</span></dd>
                    <dt>Caption</dt><dd>{p.caption}<span className="note">{p.captionEn}</span></dd>
                    <dt>Credit</dt><dd><Credit p={p} /></dd>
                  </dl>
                  {mayRemove ? <div className="ph-foot"><Button size="sm" variant="danger" icon="delete" aria-label={'Remove the photo: ' + p.altEn} onClick={() => setRemoving(p)}>Remove</Button></div> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : busy || failed ? null : (
        /* A finished job and no photos: the Site Builder found none, or a person removed them. The job's status does not
           tell the two apart, so the text claims neither. */
        <Empty>{job?.status === 'done'
          ? canFind ? 'No photos in this article. Find photos again looks on Wikimedia Commons for openly licensed photos that fit it.' : 'No photos in this article.'
          : canFind ? 'No photos yet. Find photos looks on Wikimedia Commons for openly licensed photos that fit this article.' : 'No photos yet.'}</Empty>
      )}
      {images.length && mayWrite && !mayRemove ? <p className="note">Photos can be removed once the Site Builder has finished.</p> : null}
      {images.length ? <p className="note">Only openly licensed photos are used. The built site credits each one under the photo, with its license.</p> : null}
      <Dialog open={!!removing} onClose={() => setRemoving(null)} labelledBy={titleId} className="ph-ask">
        <h2 id={titleId}>Remove this photo?</h2>
        <p>It is taken out of the article and its files are deleted. You can find photos again later.</p>
        <SheetActions>
          <Button variant="text" onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { if (removing) removePhoto(a.id, removing.id); setRemoving(null); }}>Remove</Button>
        </SheetActions>
      </Dialog>
    </section>
  );
}

/** Where the photo job is: waiting, choosing (with the server's step), or stopped with its error and "Try again". */
function JobStatus({ job, held, canRetry, onRetry }: { job: PhotoJobWire | undefined; held?: string | null; canRetry: boolean; onRetry: () => void }) {
  if (job?.status === 'queued' && held) return <div className="row"><Pill kind="warn">{HELD_LABEL}</Pill><span className="note">{held}</span></div>;
  if (job?.status === 'queued') return <div className="row"><Pill kind="info" live>Queued</Pill><span className="note">Waiting in the queue. Agent jobs run one at a time, oldest first.</span></div>;
  if (job?.status === 'work') return <div className="row"><Pill kind="info" live>Choosing photos</Pill><span>{job.step || 'Starting'}</span></div>;
  if (job?.status === 'failed') {
    return (
      <>
        <Callout icon="error" warn>The Site Builder could not finish: {job.error || 'the job stopped without a message.'} The article itself is not affected.</Callout>
        {canRetry ? <div className="row"><Button size="sm" variant="tonal" icon="refresh" onClick={onRetry}>Try again</Button></div> : null}
      </>
    );
  }
  return null;
}

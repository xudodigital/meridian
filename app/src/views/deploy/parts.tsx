/* Small parts the website screens of Build and deploy share: the status pills of a build, its contents, the Preview and
   Download ZIP links, whether its files are still kept, whether Cloudflare can take a deploy, and the guard that sends
   one request at a time from a build's buttons. Outside demo mode only. */
import { useRef, useState } from 'react';
import { Icon, Pill } from '@/components';
import { buildZipPath } from '@/store/buildsApi';
import type { AppState, BuildWire } from '@/store/types';

/** Admins and editors build, decide and deploy; the server refuses everyone else, so the others see no buttons. */
export const mayWrite = (s: Pick<AppState, 'session'>): boolean => s.session?.role === 'admin' || s.session?.role === 'editor';

/**
 * Whether a deploy to Cloudflare Pages can run: 'ok', 'off' (not connected), 'bad' (its last test failed) or 'account'
 * (connected without the Account ID; only an admin can see that, so for others it reads 'ok' and the server says so).
 */
export type CfState = 'ok' | 'off' | 'bad' | 'account';
export function cfState(s: Pick<AppState, 'live' | 'session'>): CfState {
  const w = s.live.ints.cf;
  if (!w || !w.connected) return 'off';
  if (w.status === 'bad') return 'bad';
  const f = w.fields.find(x => x.k === 'account');
  if (s.session?.role === 'admin' && f && !f.secret && !(w.config.account ?? '').trim()) return 'account';
  return 'ok';
}

/**
 * One request at a time for the buttons of a build: `busy` while it runs (to disable them), and a second click before
 * the answer sends nothing, even before the disabled state is drawn.
 */
export function useOneAtATime(): [boolean, (fn: () => Promise<unknown>) => Promise<void>] {
  const flight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    if (flight.current) return;
    flight.current = true; setBusy(true);
    try { await fn(); } finally { flight.current = false; setBusy(false); }
  };
  return [busy, run];
}

/* A number and its unit never wrap apart (no-break space). */
const plural = (n: number, one: string): string => `${n}\u00a0${one}${n === 1 ? '' : 's'}`;
/** "640 KB", "1.2 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return plural(bytes, 'byte');
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + '\u00a0KB';
  return (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + '\u00a0MB';
}
/** "4 articles · 7 pages · 1.2 MB" for a finished build. */
export const contentsText = (b: BuildWire): string => [plural(b.articles.length, 'article'), plural(b.pages, 'page'), sizeText(b.bytes)].join(' · ');
export const articlesText = (n: number): string => plural(n, 'article');

/** The live version among a site's builds, or 0. */
export const liveVersion = (list: readonly BuildWire[]): number => list.find(b => b.deploy === 'live')?.version ?? 0;
/** The build went live at some point: it is live, or a newer one replaced it. */
export const wentLive = (b: BuildWire): boolean => b.deploy === 'live' || b.deploy === 'superseded';

/** The build job, then the person's decision, then the deploy, as pills. */
export function BuildPills({ b }: { b: BuildWire }) {
  return (
    <>
      {b.status === 'queued' ? <Pill kind="mut">Queued</Pill>
        : b.status === 'work' ? <Pill kind="info" live>Building</Pill>
          : b.status === 'failed' ? <Pill kind="bad">Build failed</Pill> : null}
      {b.review === 'waiting' ? <Pill kind="warn">Waiting for approval</Pill>
        : b.review === 'approved' ? <Pill kind="ok">Approved</Pill>
          : b.review === 'rejected' ? <Pill kind="bad">Rejected</Pill> : null}
      {b.deploy === 'queued' ? <Pill kind="info" live>Deploy queued</Pill>
        : b.deploy === 'work' ? <Pill kind="info" live>Deploying</Pill>
          : b.deploy === 'live' ? <Pill kind="ok">Live</Pill>
            : b.deploy === 'failed' ? <Pill kind="bad">Deploy failed</Pill>
              : b.deploy === 'superseded' ? <Pill kind="mut">No longer live</Pill> : null}
    </>
  );
}

/**
 * The build is ready and its files are still on the server: Meridian keeps the newest 10 builds of a site and removes
 * the files of older ones it does not need (server/builds.ts prune), and then sends no preview path. Preview, ZIP and
 * deploy all need the files.
 */
export const filesKept = (b: Pick<BuildWire, 'status' | 'previewPath'>): boolean => b.status === 'ready' && b.previewPath.startsWith('/api/preview/');

/** The built site, served by Meridian for review, in a new tab. Shown once the build is ready and its files are kept. */
export function PreviewLink({ b }: { b: BuildWire }) {
  if (!filesKept(b)) return null;
  return <a className="btn text sm" href={b.previewPath} target="_blank" rel="noopener" aria-label={`Preview ${b.domain} v${b.version}`}><Icon name="visibility" />Preview</a>;
}

/** The built site as a ZIP, to upload to any static host. */
export function ZipLink({ b }: { b: BuildWire }) {
  if (!filesKept(b)) return null;
  return <a className="btn text sm" href={buildZipPath(b.id)} download aria-label={`Download ZIP of ${b.domain} v${b.version}`}><Icon name="download" />Download ZIP</a>;
}

/** The live site, when the deploy gave an http(s) address. */
export function LiveLink({ b, label = 'Open live site' }: { b: BuildWire; label?: string }) {
  if (b.deploy !== 'live' || !/^https:\/\//i.test(b.deployUrl)) return null;
  return <a className="btn text sm" href={b.deployUrl} target="_blank" rel="noopener noreferrer"><Icon name="open_in_new" />{label}</a>;
}

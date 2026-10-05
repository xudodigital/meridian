/* Research requests, photo jobs and website builds as the server sends them, for the tests of the agents real jobs
   drive (liveAgents.test.ts and the live Workspace view tests). Articles come from articleFixtures.ts. */
import { T_ART } from './articleFixtures';
import type { BuildWire, PhotoJobWire, PhotoWire, ServerArticle, ServerRequest } from './types';

export const req = (id: number, over: Partial<ServerRequest> = {}): ServerRequest => ({
  id, siteId: 'a', domain: 'kopi.example', country: 'Vietnam', lang: 'Vietnamese', topic: 'phin coffee', goal: 'Find a new topic cluster', status: 'work',
  engine: 'openai-api', step: 'Reading the keyword-research skill', summary: '', notes: '', error: '', tokens: 0, costUsd: 0, createdAt: T_ART, startedAt: T_ART,
  finishedAt: null, keywords: [], ...over,
});

export const build = (id: number, over: Partial<BuildWire> = {}): BuildWire => ({
  id, siteId: 'a', domain: 'kopi.example', version: 2, status: 'work', step: 'Writing pages, sitemap and robots.txt', error: '', review: '', reviewNote: '',
  deploy: '', deployUrl: '', deployError: '', articles: [5], pages: 4, files: 12, bytes: 40_000, by: 'Dana Owner', createdAt: T_ART, startedAt: T_ART, finishedAt: null,
  decidedBy: '', decidedAt: null, deployedAt: null, tokens: 0, costUsd: 0, previewPath: '/api/preview/a/2/', steps: [], updatedAt: T_ART, ...over,
});

/** A photo job queued when the article fixture's writing finished (T_ART + 95 s). */
export const photoJob = (over: Partial<PhotoJobWire> = {}): PhotoJobWire => ({
  status: 'queued', step: '', error: '', queuedAt: T_ART + 95_000, startedAt: null, finishedAt: null, tokens: 0, costUsd: 0, ...over,
});

export const photo = (id: string): PhotoWire => ({
  id, role: 'hero', after: null, file: 'ca-phe-phin-' + id, ext: 'jpg', widths: [960, 1280], width: 1280, height: 853, alt: 'Phin', altEn: 'Phin', caption: '', captionEn: '',
  title: 'Phin', author: 'A. Person', authorUrl: '', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Phin.jpg', provider: 'Wikimedia Commons',
});

/** An article with its photo job (and the photos it chose). */
export const withPhotos = (a: ServerArticle, photos: PhotoJobWire, images: PhotoWire[] = []): ServerArticle => ({ ...a, photos, images });

/* Photos and website builds as the server sends them, for tests. */
import type { BuildWire, IntegrationWire, PhotoJobWire, PhotoWire } from './types';

export const T_BUILD = Date.UTC(2026, 9, 3, 4, 0, 0);

export const photoWire = (id: string, over: Partial<PhotoWire> = {}): PhotoWire => ({
  id, role: 'hero', after: null, file: 'phin-nhom-tren-ly-' + id + '-3f9a2c1d', ext: 'jpg', widths: [960, 1280], width: 1280, height: 853,
  alt: 'Phin nhôm trên ly cà phê', altEn: 'An aluminium phin on a glass of coffee', caption: 'Phin nhỏ giọt chậm.', captionEn: 'A phin drips slowly.',
  title: 'Vietnamese iced coffee', author: 'A. Photographer', authorUrl: 'https://commons.wikimedia.org/wiki/User:A', license: 'CC BY 2.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/2.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Phin.jpg', provider: 'Wikimedia Commons',
  ...over,
});

export const photoJob = (status: PhotoJobWire['status'], over: Partial<PhotoJobWire> = {}): PhotoJobWire => ({
  status, step: '', error: '', queuedAt: T_BUILD, startedAt: status === 'queued' ? null : T_BUILD, finishedAt: status === 'done' || status === 'failed' ? T_BUILD + 60_000 : null,
  tokens: 0, costUsd: 0, ...over,
});

/** A finished build of site `siteId` at version `version`, waiting for review unless `over` says otherwise. */
export const buildWire = (id: number, siteId: string, domain: string, version: number, over: Partial<BuildWire> = {}): BuildWire => ({
  id, siteId, domain, version, status: 'ready', step: '', error: '', review: 'waiting', reviewNote: '', deploy: '', deployUrl: '', deployError: '',
  articles: [5], pages: 5, files: 18, bytes: 1_234_567, by: 'Dana Owner',
  createdAt: T_BUILD + version * 3_600_000, startedAt: T_BUILD + version * 3_600_000, finishedAt: T_BUILD + version * 3_600_000 + 20_000,
  decidedBy: '', decidedAt: null, deployedAt: null, tokens: 800, costUsd: 0.01, previewPath: `/api/preview/${siteId}/${version}/`, steps: [],
  updatedAt: T_BUILD + version * 3_600_000 + 20_000, ...over,
});

/** The Cloudflare integration as the server reports it to an admin. */
export const cloudflareWire = (connected: boolean, over: Partial<IntegrationWire> = {}): IntegrationWire => ({
  id: 'cf', name: 'Cloudflare', connected, tail: connected ? 'a1b2' : '', status: connected ? 'ok' : '', msg: '', testedAt: null, updatedAt: null, updatedBy: '',
  config: connected ? { account: '0123456789abcdef' } : {}, fields: [{ k: 'token', label: 'API token', secret: true }, { k: 'account', label: 'Account ID', secret: false }],
  oauth: false, worksWithout: '', help: '', ...over,
});

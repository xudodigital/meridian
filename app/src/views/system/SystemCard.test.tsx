// @vitest-environment jsdom
/* Settings > System: the facts from the server's health view, backups (make, list, download), and the honest
   states when there is nothing yet or the server does not answer. The server is a FakeApi. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, answer } from '@/store/fakeApi';
import { dayTime } from '@/store/rules';
import { useStore } from '@/store/store';
import { backupHref, type BackupWire, type SystemHealth } from '@/store/systemApi';
import { meFor, resetStore } from '@/store/testing';
import { Settings } from '../Settings';
import { SystemCard, fmtBytes, fmtUptime } from './SystemCard';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
});

const AT = new Date(2026, 9, 3, 3, 0, 0).getTime();
const b1: BackupWire = { name: 'meridian-20261003-030000.zip', bytes: 1_250_000, at: AT };
const b0: BackupWire = { name: 'meridian-20261002-030000.zip', bytes: 1_100_000, at: AT - 86_400_000 };
const healthOf = (over: Partial<SystemHealth> = {}): SystemHealth => ({
  version: '0.1.0', node: 'v24.21.0', startedAt: AT + 6 * 3_600_000, uptimeSec: 3 * 3600 + 12 * 60,
  db: { ok: true, bytes: 4096, walBytes: 3_600_000 },
  queue: { running: null, queued: { request: 0, article: 0, photos: 0, build: 0, deploy: 0 }, total: 0 },
  engine: { mode: 'openai-api', apiVersion: '2.1.284 (Claude Code)', ready: true, reason: '' },
  disk: { freeBytes: 212e9, totalBytes: 494e9 },
  folders: { media: 12_000_000, sites: 40_500_000, backups: 2_350_000, logs: 90_000, workspaces: 0 },
  backups: { count: 2, last: b1, keepDaily: 7, keepWeekly: 4, nightlyHour: 3 },
  schedulers: { maintenance: null, report: null, metrics: null, accessCheck: null },
  ...over,
});

let root: Root | null = null;
let api: FakeApi;
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const mount = async (node: ReactNode) => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  await act(async () => { root?.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
  await settle();
};
const button = (label: string) => { const el = $$('button').find(x => x.textContent?.includes(label)); if (!el) throw new Error('No button ' + label); return el; };
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await settle(); };
const fact = (label: string) => { const el = $$('.sys-fact').find(x => x.querySelector('dt')?.textContent === label); if (!el) throw new Error('No fact ' + label); return el.querySelector('dd')?.textContent ?? ''; };

beforeEach(() => {
  localStorage.clear();
  resetStore(false);
  useStore.getState().signIn(meFor('admin', 'Owner', 'owner@example.com'));
  api = new FakeApi()
    .on('GET', '/api/system/health', () => ({ health: healthOf() }))
    .on('GET', '/api/system/backups', () => ({ backups: [b1, b0] }))
    .on('GET', '/api/auth/sessions', () => ({ sessions: [] }))
    .on('GET', '/api/alerts', () => ({ alerts: [] }));
  vi.stubGlobal('fetch', api.fetch);
  vi.spyOn(console, 'error');
});
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('System card', () => {
  it('shows what the server reports: version, uptime, engine, queue, database, disk and storage', async () => {
    await mount(<SystemCard />);
    expect($('h2')?.textContent).toBe('System');
    expect(fact('Version')).toBe('0.1.0Node 24.21.0');
    expect(fact('Running for')).toBe('3 h 12 min' + 'Since ' + dayTime(AT + 6 * 3_600_000));
    expect(fact('Engine')).toBe('ReadyOpenAI Responses API');
    expect(fact('Job queue')).toBe('IdleNothing waiting');
    expect(fact('Database')).toBe('3.6 MBWorking');
    expect(fact('Free disk space')).toBe('212 GBof 494 GB');
    expect($('.sys-storage')?.textContent).toBe('Storage used: photos 12 MB · websites 40.5 MB · backups 2.4 MB · logs 90 kB · job folders 0 B');
    expect($$('.callout')).toHaveLength(0);
  });

  it('lists the backups with a download link each, and says where to keep them', async () => {
    await mount(<SystemCard />);
    expect($('.sys-backup-title')?.textContent).toBe(`BackupsLast backup ${dayTime(AT)} · 1.3 MB`);
    const rows = $$('.sys-list li');
    expect(rows.map(r => r.textContent)).toEqual([`${dayTime(b1.at)}1.3 MBdownloadDownload`, `${dayTime(b0.at)}1.1 MBdownloadDownload`]);
    const links = $$('.sys-list a');
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/api/system/backups/meridian-20261003-030000.zip', '/api/system/backups/meridian-20261002-030000.zip']);
    expect(links[0]?.getAttribute('download')).toBe(b1.name);
    expect($('.sys-backup .note')?.textContent).toContain('Keep downloaded copies somewhere only you can reach.');
    expect($('.sys-backup .note')?.textContent).toContain('every night at 03:00 while Meridian is running; one a day is kept for 7 days, then one a week for 4 weeks');
  });

  it('"Back up now" asks the server, shows the result and the new list', async () => {
    const made: BackupWire = { name: 'meridian-20261003-141500.zip', bytes: 1_300_000, at: AT + 11.25 * 3_600_000 };
    api.on('POST', '/api/system/backup', () => answer(201, { backup: made, backups: [made, b0] }));
    await mount(<SystemCard />);
    await click(button('Back up now'));
    const posts = api.to('POST', '/api/system/backup');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.headers['x-meridian']).toBe('1');
    expect($('.sys-msg')?.textContent).toBe('Backup made: meridian-20261003-141500.zip (1.3 MB).');
    expect($('.sys-msg')?.getAttribute('role')).toBe('status');
    expect($$('.sys-list a').map(a => a.getAttribute('download'))).toEqual([made.name, b0.name]);
    expect($('.sys-backup-title span')?.textContent).toBe(`Last backup ${dayTime(made.at)} · 1.3 MB`);
    expect(button('Back up now').hasAttribute('disabled')).toBe(false);
  });

  it('says what the server said when a backup fails, and keeps the list', async () => {
    api.on('POST', '/api/system/backup', () => answer(500, { error: 'The backup could not be made: no space left on device' }));
    await mount(<SystemCard />);
    await click(button('Back up now'));
    expect($('.sys-msg.bad')?.textContent).toBe('The backup could not be made: no space left on device');
    expect($('.sys-msg')?.getAttribute('role')).toBe('alert');
    expect($$('.sys-list li')).toHaveLength(2);
  });

  it('has an honest empty state before the first backup', async () => {
    api.on('GET', '/api/system/backups', () => ({ backups: [] }))
      .on('GET', '/api/system/health', () => ({ health: healthOf({ backups: { count: 0, last: null, keepDaily: 7, keepWeekly: 4, nightlyHour: 3 } }) }));
    await mount(<SystemCard />);
    expect($('.sys-backup-title span')?.textContent).toBe('No backup yet');
    expect($('.sys-none')?.textContent).toBe('No backups yet. One is made every night at 03:00 while Meridian is running, or make one now.');
    expect($('.sys-list')).toBeNull();
    expect(button('Back up now')).toBeTruthy();
  });

  it('shows backups disabled and saves the automatic setting without creating an archive', async () => {
    let autoEnabled = false;
    api.on('GET', '/api/system/backups', () => ({ backups: [] }))
      .on('GET', '/api/system/health', () => ({ health: healthOf({ backups: { count: 0, last: null, keepDaily: 7, keepWeekly: 4, nightlyHour: 3, autoEnabled } }) }))
      .on('POST', '/api/system/backup-settings', call => { autoEnabled = (call.body as { autoEnabled: boolean }).autoEnabled; return { autoEnabled }; });
    await mount(<SystemCard />);
    expect($('.sys-none')?.textContent).toContain('No backups stored. Automatic backups are off.');
    expect(($('input#auto-backup') as HTMLInputElement).checked).toBe(false);
    await click($('input#auto-backup')!);
    expect(api.to('POST', '/api/system/backup-settings')[0]?.body).toEqual({ autoEnabled: true });
    expect(($('input#auto-backup') as HTMLInputElement).checked).toBe(true);
    expect($('.sys-msg')?.textContent).toBe('Automatic nightly backups enabled.');
    expect(api.to('POST', '/api/system/backup')).toHaveLength(0);
  });

  it('keeps the saved backup setting when the server refuses a change', async () => {
    api.on('POST', '/api/system/backup-settings', () => answer(500, { error: 'The setting could not be saved.' }));
    await mount(<SystemCard />);
    await click($('input#auto-backup')!);
    expect(($('input#auto-backup') as HTMLInputElement).checked).toBe(true);
    expect($('.sys-msg.bad')?.textContent).toBe('The setting could not be saved.');
    expect($('input#auto-backup')?.hasAttribute('disabled')).toBe(false);
  });

  it('shows problems plainly: engine signed out, database not answering, low disk, a job running, failed maintenance', async () => {
    api.on('GET', '/api/system/health', () => ({ health: healthOf({
      engine: { mode: 'none', apiVersion: '2.1.284', ready: false, reason: 'Claude Code is installed but not signed in.' },
      db: { ok: false, bytes: 0, walBytes: 0 },
      disk: { freeBytes: 1.2e9, totalBytes: 494e9 },
      queue: { running: { kind: 'article', id: 4, startedAt: 1, ageMs: 125_000 }, queued: { request: 1, article: 2 }, total: 3 },
      schedulers: { maintenance: { at: AT, errors: ['Backup: no space left on device'] }, report: null, metrics: null, accessCheck: null },
    }) }));
    await mount(<SystemCard />);
    expect(fact('Engine')).toBe('Not availableClaude Code is installed but not signed in.');
    expect(fact('Database')).toBe('Not respondingRestart Meridian. If this stays, restore a backup.');
    expect(fact('Free disk space')).toBe('1.2 GBRunning low');
    expect(fact('Job queue')).toBe('Writing an articleRunning for 2 min · 3 waiting');
    expect($('.callout.warn')?.textContent).toContain(`The nightly maintenance of ${dayTime(AT)} did not finish every step: Backup: no space left on device`);
  });

  it('works with a server that reports no queue and no disk figure', async () => {
    api.on('GET', '/api/system/health', () => ({ health: healthOf({ queue: null, disk: null }) }));
    await mount(<SystemCard />);
    expect(fact('Job queue')).toBe('Not reportedThis server does not report its queue.');
    expect(fact('Free disk space')).toBe('UnknownCould not be measured.');
  });

  it('says so when the details cannot be loaded, and loads them on "Try again"', async () => {
    let fail = true;
    api.on('GET', '/api/system/health', () => fail ? answer(500, { error: 'Something went wrong on the server. Try again.' }) : { health: healthOf() });
    await mount(<SystemCard />);
    expect($('.callout')?.textContent).toContain('System details could not be loaded: Something went wrong on the server. Try again.');
    expect($('.sys-facts')).toBeNull();
    expect($('.sys-backup')).toBeNull();
    fail = false;
    await click(button('Try again'));
    expect($('.callout')).toBeNull();
    expect(fact('Version')).toContain('0.1.0');
  });

  it('says so when only the list of backups cannot be loaded', async () => {
    api.on('GET', '/api/system/backups', () => answer(500, { error: 'x' }));
    await mount(<SystemCard />);
    expect($('.sys-none')?.textContent).toBe('The list of backups could not be loaded.');
    expect(fact('Version')).toContain('0.1.0');
  });
});

describe('Settings', () => {
  const systemCalls = () => api.calls.filter(c => c.path.startsWith('/api/system/')).length;

  it('shows System to an admin outside demo mode', async () => {
    await mount(<Settings />);
    expect($$('h2').map(h => h.textContent)).toContain('System');
    expect(systemCalls()).toBe(2);
  });

  it('not in demo mode, and not to someone who is not an admin', async () => {
    resetStore(true);
    useStore.getState().signIn(meFor('admin', 'Owner', 'owner@example.com'));
    await mount(<Settings />);
    expect($$('h2').map(h => h.textContent)).not.toContain('System');
    await act(async () => { root?.unmount(); }); root = null;
    resetStore(false);
    useStore.getState().signIn(meFor('editor'));
    await mount(<Settings />);
    expect($$('h2').map(h => h.textContent)).not.toContain('System');
    expect(systemCalls()).toBe(0);
  });
});

describe('formatting', () => {
  it('sizes, uptime and download paths', () => {
    expect([0, 512, 1536, 999_999, 3_604_096, 212e9, 1.25e12].map(fmtBytes)).toEqual(['0 B', '512 B', '1.5 kB', '1 MB', '3.6 MB', '212 GB', '1.3 TB']);
    expect([0, 42, 60, 3599, 3600, 11_520, 86_400, 190_000].map(fmtUptime)).toEqual(['Just started', 'Just started', '1 min', '59 min', '1 h', '3 h 12 min', '1 d', '2 d 4 h']);
    expect(backupHref('meridian-20261003-030000.zip')).toBe('/api/system/backups/meridian-20261003-030000.zip');
    for (const bad of ['../secret.key', 'meridian.db', 'meridian-20261003-030000.zip/../x', 'javascript:alert(1)', '']) expect(backupHref(bad)).toBe('');
  });
});

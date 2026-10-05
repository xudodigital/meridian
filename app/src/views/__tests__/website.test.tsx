// @vitest-environment jsdom
/* Build and deploy outside demo mode: building a site from its approved articles, the build's progress, preview and
   ZIP, approving and rejecting it, deploying it to Cloudflare Pages (or why not), the approval queue, the timeline and
   the history with roll back. Every action calls the server (a fake, fakeApi.ts); nothing is invented. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { allOk, serverArticle } from '@/store/articleFixtures';
import { T_BUILD, buildWire, cloudflareWire } from '@/store/buildFixtures';
import { FakeApi, answer } from '@/store/fakeApi';
import { liveApply } from '@/store/liveApply';
import { liveBuildTo } from '@/store/liveBuilds';
import { serverFactsTo } from '@/store/serverFacts';
import { NO_ARTICLES } from '@/store/slices/sites';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { BuildWire, Role, ServerArticle } from '@/store/types';
import { docOf } from '@/store/workspace';
import { Deploy } from '../Deploy';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

let root: Root | null = null;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string, from: ParentNode = document) => [...from.querySelectorAll<HTMLElement>(sel)];
const st = () => useStore.getState();
const text = () => document.body.textContent ?? '';
const byText = (sel: string, t: string, from: ParentNode = document) => $$(sel, from).find(e => e.textContent === t) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const type = async (el: HTMLTextAreaElement | null, value: string) => {
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const submit = async (form: Element | null) => { expect(form).not.toBeNull(); await act(async () => { form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); await settle(); };
const unmount = async () => { if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; } };
const mount = async (node: ReactNode) => {
  await unmount();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(node); });
};
const change = (fn: () => void) => act(async () => { fn(); });
const nb = (s: string) => s.replace(/\u00a0/g, ' ');
/** The server's clock for answers and events: every change is later than the fixtures and the one before. */
let clock = T_BUILD + 100 * 3_600_000;
const later = () => ++clock;

let api: FakeApi;
let site = '', other = '';
const art = (id: number, over: Partial<ServerArticle> = {}) => serverArticle(id, { siteId: site, domain: 'kopi.example', status: 'approved', checks: allOk(), languageReview: { by: 'Dewi', at: 1 }, ...over });
const build = (id: number, version: number, over: Partial<BuildWire> = {}) => buildWire(id, site, 'kopi.example', version, over);
/** The server's state as GET /api/state would bring it. */
const serve = (o: { arts?: ServerArticle[]; builds?: BuildWire[]; cf?: boolean } = {}) => change(() => useStore.setState(d => {
  d.live.on = true;
  (o.arts ?? []).forEach(a => { d.live.arts[a.id] = a; });
  (o.builds ?? []).forEach(b => { d.live.builds[b.id] = b; });
  d.live.ints = { cf: cloudflareWire(!!o.cf) };
  liveApply(d); serverFactsTo(d); d.live.ready = true;
}));
const as = (role: Role) => change(() => st().signIn(meFor(role, 'Dana Owner', role + '@example.com')));
const panel = (domain = 'kopi.example') => $(`.web-site[aria-label="${domain}"]`);
const rows = () => $$('.web-build', panel() ?? document);
const section = (h: string) => $$('section').find(s => s.querySelector('h2')?.textContent === h) ?? null;

beforeEach(() => {
  localStorage.clear();
  resetStore(false);
  st().signIn(meFor('admin', 'Dana Owner', 'owner@example.com'));
  st().addSite({ domain: 'kopi.example', country: 0, lang: 'Vietnamese', topic: 'Coffee', status: 'live' });
  st().addSite({ domain: 'masak.example', country: 12, lang: 'Indonesian', topic: 'Cooking', status: 'build' });
  [site, other] = st().sites.map(s => s.id) as [string, string];
  api = new FakeApi();
  vi.stubGlobal('fetch', api.fetch);
  vi.spyOn(console, 'error');
});
afterEach(async () => {
  await unmount();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the Website section', () => {
  it('comes first outside demo mode, and builds a site only once it has an approved article', async () => {
    await serve({ arts: [art(5, { status: 'review' })] });
    await mount(<Deploy />);
    expect($$('h2').map(h => h.textContent)).toEqual(['Watch your next release take shape.', 'Website', 'Needs approval', 'Domain access by country', 'Deploy timeline', 'Deploy history']);
    expect(nb(panel()?.querySelector('.web-name .note')?.textContent ?? '')).toBe('No approved articles yet · Never deployed');
    const btn = byText('button', 'constructionBuild website', panel()!);
    expect(btn?.hasAttribute('disabled')).toBe(true);
    expect(panel()?.textContent).toContain(NO_ARTICLES);
    expect(btn?.getAttribute('aria-describedby')).toBe(panel()?.querySelector('p.note[id]')?.id);

    await change(() => useStore.setState(d => { d.live.arts[5] = art(5); d.live.arts[6] = art(6, { keyword: 'phin filter' }); liveApply(d); }));
    expect(nb(panel()?.querySelector('.web-name .note')?.textContent ?? '')).toBe('2 articles approved · Never deployed');
    expect(byText('button', 'constructionBuild website', panel()!)?.hasAttribute('disabled')).toBe(false);

    api.on('POST', `/api/sites/${site}/builds`, () => answer(202, { build: build(1, 1, { status: 'queued', review: '', finishedAt: null, pages: 0, bytes: 0, articles: [], updatedAt: later() }) }));
    await click(byText('button', 'constructionBuild website', panel()!));
    await settle();
    const [call] = api.to('POST', `/api/sites/${site}/builds`);
    expect(call?.headers['x-meridian']).toBe('1');
    expect(st().snackMsg?.msg).toBe('Asked the Site Builder to build kopi.example.');
    expect(rows().map(r => r.querySelector('.web-pills')?.textContent)).toEqual(['Queued']);
    expect(rows()[0]?.textContent).toContain('Waiting in the queue.');
    expect(byText('button', 'constructionBuilding…', panel()!)?.hasAttribute('disabled')).toBe(true);

    /* The event stream reports the step, then the finished build. */
    await change(() => useStore.setState(d => liveBuildTo(d, build(1, 1, { status: 'work', review: '', step: 'Writing pages, sitemap and robots.txt', finishedAt: null, updatedAt: later() }))));
    expect(rows()[0]?.querySelector('.web-what')?.textContent).toBe('Writing pages, sitemap and robots.txt');
    expect(rows()[0]?.querySelector('.pill.live')?.textContent).toBe('Building');
    expect($('a[href^="/api/preview/"]')).toBeNull();
    await change(() => useStore.setState(d => liveBuildTo(d, build(1, 1, { articles: [5, 6], updatedAt: later() }))));
    expect(nb(rows()[0]?.querySelector('.web-what')?.textContent ?? '')).toBe('2 articles · 5 pages · 1.2 MB');
    expect(rows()[0]?.querySelector('.web-pills')?.textContent).toBe('Waiting for approval');
  });

  it('opens the preview in a new tab, downloads the ZIP, and approves', async () => {
    await serve({ arts: [art(5)], builds: [build(3, 1)] });
    await mount(<Deploy />);
    const preview = $$('a', rows()[0]!).find(a => a.textContent === 'visibilityPreview');
    expect([preview?.getAttribute('href'), preview?.getAttribute('target'), preview?.getAttribute('rel')]).toEqual([`/api/preview/${site}/1/`, '_blank', 'noopener']);
    const zip = $$('a', rows()[0]!).find(a => a.textContent === 'downloadDownload ZIP');
    expect([zip?.getAttribute('href'), zip?.hasAttribute('download')]).toEqual(['/api/builds/3/zip', true]);

    /* The server says why it does not go live by itself (server/builds.ts whyNotLive). */
    api.on('POST', '/api/builds/3/approve', () => ({
      build: build(3, 1, { review: 'approved', decidedBy: 'Dana Owner', decidedAt: Date.now(), updatedAt: later() }),
      deployQueued: false, note: 'Connect Cloudflare to put it live; download the ZIP meanwhile.',
    }));
    await click(byText('button', 'checkApprove', rows()[0]!));
    await settle();
    expect(api.to('POST', '/api/builds/3/approve')).toHaveLength(1);
    expect(st().snackMsg?.msg).toBe('Approved kopi.example v1. Connect Cloudflare to put it live; download the ZIP meanwhile.');
    expect(rows()[0]?.querySelector('.web-pills')?.textContent).toBe('Approved');
    /* Without Cloudflare it waits: approving worked, the ZIP can go anywhere. */
    expect(rows()[0]?.querySelector('.web-msg')?.textContent).toBe('Approved by Dana Owner. Connect Cloudflare to put it live; download the ZIP meanwhile.');
    expect(byText('button', 'rocket_launchDeploy')).toBeNull();
    expect($('.callout')?.textContent).toContain('Cloudflare is not connected.');
    expect(st().sites.find(s => s.id === site)?.deploy).toBe('v1 approved, not live');
  });

  it('asks why before rejecting, and shows the reason', async () => {
    await serve({ arts: [art(5)], builds: [build(3, 1)] });
    await mount(<Deploy />);
    await click(byText('button', 'Reject', rows()[0]!));
    expect($('dialog[open] h2')?.textContent).toBe('Reject kopi.example v1?');
    api.on('POST', '/api/builds/3/reject', c => ({ build: build(3, 1, { review: 'rejected', reviewNote: (c.body as { note: string }).note, decidedBy: 'Dana Owner', updatedAt: later() }) }));
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('Write why it is rejected, so the next build can fix it.');
    expect(api.to('POST', '/api/builds/3/reject')).toEqual([]);
    await type($<HTMLTextAreaElement>('#rbNote'), 'The About page is missing.');
    await submit($('dialog[open] form'));
    expect(api.to('POST', '/api/builds/3/reject').map(c => c.body)).toEqual([{ note: 'The About page is missing.' }]);
    expect($('dialog[open]')).toBeNull();
    expect(rows()[0]?.querySelector('.web-pills')?.textContent).toBe('Rejected');
    expect(rows()[0]?.querySelector('.web-msg')?.textContent).toBe('Rejected by Dana Owner: The About page is missing.');
    expect(st().snackMsg?.msg).toBe('Rejected kopi.example v1.');
  });

  it('deploys to Cloudflare Pages once connected, and offers to try again after a failure', async () => {
    await serve({ arts: [art(5)], builds: [build(3, 1, { review: 'approved', decidedBy: 'Dana Owner', deploy: 'failed', deployError: 'The token cannot edit Cloudflare Pages.' })], cf: true });
    await mount(<Deploy />);
    expect($('.callout')).toBeNull();
    expect(rows()[0]?.querySelector('.web-msg')?.textContent).toBe('The deploy failed: The token cannot edit Cloudflare Pages.');
    api.on('POST', '/api/builds/3/deploy', () => answer(202, { build: build(3, 1, { review: 'approved', deploy: 'queued', updatedAt: later() }) }));
    await click(byText('button', 'rocket_launchTry deploy again', rows()[0]!));
    await settle();
    expect(api.to('POST', '/api/builds/3/deploy')).toHaveLength(1);
    expect(st().snackMsg?.msg).toBe('Deploy & Monitor is putting kopi.example v1 live.');
    expect(rows()[0]?.querySelector('.pill.live')?.textContent).toBe('Deploy queued');
    expect(byText('button', 'rocket_launchTry deploy again')).toBeNull();

    await change(() => useStore.setState(d => liveBuildTo(d, build(3, 1, { review: 'approved', deploy: 'live', deployUrl: 'https://kopi-example.pages.dev', deployedAt: Date.UTC(2026, 9, 3, 9, 5), updatedAt: later() }))));
    const liveLink = byText('a', 'open_in_newOpen live site', panel()!);
    expect([liveLink?.getAttribute('href'), liveLink?.getAttribute('target'), liveLink?.getAttribute('rel')]).toEqual(['https://kopi-example.pages.dev', '_blank', 'noopener noreferrer']);
    expect(nb(panel()?.querySelector('.web-name .note')?.textContent ?? '')).toBe('1 article approved · v1 is live');
    expect(st().sites.find(s => s.id === site)?.deploy).toMatch(/^v1 · 3 Oct, \d\d:05$/);
    /* The Last deploy column shows it; the sites document does not carry it. */
    expect(text()).toContain(st().sites.find(s => s.id === site)!.deploy);
    expect(JSON.stringify(docOf(st(), 'sites'))).not.toContain('v1 ·');
  });

  it('says when the Account ID is missing or the last Cloudflare test failed', async () => {
    await serve({ arts: [art(5)], builds: [build(3, 1, { review: 'approved' })] });
    await change(() => useStore.setState(d => { d.live.ints.cf = cloudflareWire(true, { config: {} }); }));
    await mount(<Deploy />);
    expect($('.callout')?.textContent).toContain('The Cloudflare Account ID is missing.');
    expect(byText('button', 'rocket_launchDeploy')).toBeNull();
    await change(() => useStore.setState(d => { d.live.ints.cf = cloudflareWire(true, { status: 'bad' }); }));
    expect($('.callout')?.textContent).toContain('Cloudflare is not working.');
    /* An editor cannot see the account id: the server answers for it. */
    await as('editor');
    await change(() => useStore.setState(d => { d.live.ints.cf = cloudflareWire(true, { config: {} }); }));
    expect($('.callout')).toBeNull();
    expect(byText('button', 'rocket_launchDeploy', rows()[0]!)).not.toBeNull();
  });

  it('shows a viewer the builds without any button that changes them', async () => {
    await serve({ arts: [art(5)], builds: [build(3, 1)], cf: true });
    await as('viewer');
    await mount(<Deploy />);
    expect(rows()).toHaveLength(1);
    expect($$('button', panel()!)).toEqual([]);
    expect($$('a', rows()[0]!).map(a => a.textContent)).toEqual(['visibilityPreview', 'downloadDownload ZIP']);
    expect($$('#queue button')).toEqual([]);
  });

  it('lists three builds per site until asked for all, and follows the site filter', async () => {
    await serve({ arts: [art(5)], builds: [1, 2, 3, 4].map(v => build(v, v, { review: 'rejected' })) });
    await mount(<Deploy />);
    expect(rows().map(r => r.querySelector('.web-ver b')?.textContent)).toEqual(['v4', 'v3', 'v2']);
    await click(byText('button', 'Show all 4 builds', panel()!));
    expect(rows()).toHaveLength(4);
    expect($$('.web-site').map(s => s.getAttribute('aria-label'))).toEqual(['kopi.example', 'masak.example']);
    await change(() => st().setSiteFilter(other));
    expect($$('.web-site').map(s => s.getAttribute('aria-label'))).toEqual(['masak.example']);
  });

  it('warns that builds go live without approval when Settings ask for none', async () => {
    await change(() => st().setSystemSetting('apDeploy', false));
    await serve({ arts: [art(5)], cf: true });
    await mount(<Deploy />);
    expect($('.callout')?.textContent).toBe('warningBuilds go live without approval. “Require approval before a deploy” is off in Settings, so every website build is approved by itself and put live on Cloudflare Pages as soon as it is built, without a preview first.');
    expect(panel()?.textContent).toContain('No builds yet. A build turns the approved articles into a static site. Deploys need no approval (Settings), so each build is approved as soon as it is built.');
    expect(panel()?.textContent).not.toContain('preview before anything goes live');
    expect(text()).toContain('No website builds need approval. Deploys need no approval (Settings), so each build is approved as soon as it is built.');
    /* Without Cloudflare nothing goes live by itself: only the Cloudflare callout is shown. */
    await change(() => useStore.setState(d => { d.live.ints.cf = cloudflareWire(false); }));
    expect($$('.callout').map(c => c.textContent)).toEqual([expect.stringContaining('Cloudflare is not connected.')]);
    await change(() => st().setSystemSetting('apDeploy', true));
    expect(panel()?.textContent).toContain('a static site you can preview before anything goes live.');
  });

  it('offers no Preview, ZIP or Deploy for a build whose files were removed to save space', async () => {
    /* The server keeps the files of the newest 10 builds and then sends no preview path for the others. */
    await serve({ arts: [art(5)], builds: [build(3, 1, { review: 'approved', previewPath: '' })], cf: true });
    await mount(<Deploy />);
    expect($$('a', rows()[0]!)).toEqual([]);
    expect(byText('button', 'rocket_launchDeploy', rows()[0]!)).toBeNull();
    expect(rows()[0]?.querySelector('.web-msg')?.textContent).toBe('Its files were removed to save space: Meridian keeps the newest 10 builds of a site. Build the website again to preview, download or deploy it.');
  });

  it('refuses a build the server refuses, in the snackbar', async () => {
    await serve({ arts: [art(5)] });
    api.on('POST', `/api/sites/${site}/builds`, () => answer(409, { error: 'A build of this site is already queued or running.' }));
    await mount(<Deploy />);
    await click(byText('button', 'constructionBuild website', panel()!));
    await settle();
    expect(st().snackMsg?.msg).toBe('A build of this site is already queued or running.');
    expect(rows()).toEqual([]);
  });
});

describe('the approval queue, the timeline and the history', () => {
  const live = () => [
    build(1, 1, { review: 'approved', decidedBy: 'Dana Owner', deploy: 'superseded', deployedAt: Date.UTC(2026, 9, 1, 9), articles: [5] }),
    build(2, 2, { review: 'approved', decidedBy: 'Eli Editor', deploy: 'live', deployUrl: 'https://kopi-example.pages.dev', deployedAt: Date.UTC(2026, 9, 2, 9), articles: [5, 6] }),
    build(3, 3, { articles: [5, 6, 7] }),
  ];

  it('queues the builds waiting for approval, with their preview', async () => {
    await serve({ arts: [art(5)], builds: live(), cf: true });
    await mount(<Deploy />);
    const q = $$('#queue .q');
    expect(q.map(x => nb(x.querySelector('p')?.textContent ?? ''))).toEqual(['kopi.example v3 · 3 articles · 5 pages · 1.2 MBVN · kopi.example']);
    expect(q[0]?.querySelector('a')?.getAttribute('href')).toBe(`/api/preview/${site}/3/`);
    api.on('POST', '/api/builds/3/approve', () => ({ build: build(3, 3, { review: 'approved', deploy: 'queued', updatedAt: later() }) }));
    await click(byText('#queue button', 'Approve'));
    await settle();
    expect(st().snackMsg?.msg).toBe('Approved kopi.example v3. Deploy & Monitor is putting it live.');
    expect(text()).toContain('No website builds need approval.');
  });

  it('draws the versions that went live, and rolls back after asking', async () => {
    await serve({ arts: [art(5)], builds: live(), cf: true });
    await mount(<Deploy />);
    const track = $$('.tlrow');
    expect(track).toHaveLength(1);
    expect(track[0]?.querySelector('.sh')?.textContent).toBe('VN · kopi.examplev2 is live');
    expect($$('.tln b').map(b => b.textContent)).toEqual(['v1', 'v2 · live', 'Next']);
    expect($('.tln.pend')?.textContent).toContain('Waiting for approval');

    const history = section('Deploy history')!;
    const cells = $$('tbody tr', history).map(tr => $$('td', tr).map(td => nb(td.textContent ?? '')));
    expect(cells.map(r => [r[0], r[2], r[3], r[5], r[6]])).toEqual([
      ['v2', '1 new article · 2 articles in all', 'Eli Editor', 'Live', ''],
      ['v1', 'First version: 1 article', 'Dana Owner', 'Previous', 'Roll back'],
    ]);
    await click(byText('button', 'Roll back', history));
    expect($('dialog[open] h2')?.textContent).toBe('Roll back to v1?');
    expect($('dialog[open] p')?.textContent).toBe('kopi.example switches to v1 on Cloudflare Pages. The other versions are kept, so you can switch again later.');
    api.on('POST', '/api/builds/1/deploy', () => answer(202, { build: build(1, 1, { review: 'approved', deploy: 'queued', updatedAt: later() }) }));
    await click(byText('dialog[open] button', 'Roll back'));
    await settle();
    expect(api.to('POST', '/api/builds/1/deploy')).toHaveLength(1);
    expect($('dialog[open]')).toBeNull();
    /* While a deploy runs, nothing else of that site can be put live. */
    expect(byText('button', 'Roll back', history)).toBeNull();
  });

  it('sends one approval however often Approve is clicked before the answer', async () => {
    await serve({ arts: [art(5)], builds: live(), cf: true });
    api.on('POST', '/api/builds/3/approve', () => ({ build: build(3, 3, { review: 'approved', deploy: 'queued', updatedAt: later() }) }));
    /* The server's answer is held back until `answered`: the call itself is recorded when it is sent. */
    let answered = () => {};
    const held = new Promise<void>(r => { answered = r; });
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => { const res = api.fetch(input, init); return held.then(() => res); });
    await mount(<Deploy />);
    const btn = byText('#queue button', 'Approve')!;
    await act(async () => { for (let i = 0; i < 3; i++) btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(api.to('POST', '/api/builds/3/approve')).toHaveLength(1);
    expect(byText('#queue button', 'Approve')?.hasAttribute('disabled')).toBe(true);
    expect(byText('#queue button', 'Reject')?.hasAttribute('disabled')).toBe(true);
    await act(async () => { answered(); });
    await settle();
    expect(st().snackMsg?.msg).toBe('Approved kopi.example v3. Deploy & Monitor is putting it live.');
    expect(api.to('POST', '/api/builds/3/approve')).toHaveLength(1);
  });

  it('offers no roll back to a version whose files were removed to save space', async () => {
    const builds = [build(1, 1, { review: 'approved', deploy: 'superseded', deployedAt: Date.UTC(2026, 9, 1, 9), previewPath: '' }), ...live().slice(1)];
    await serve({ arts: [art(5)], builds, cf: true });
    await mount(<Deploy />);
    const history = section('Deploy history')!;
    const v1 = $$('tbody tr', history).find(tr => tr.querySelector('td')?.textContent === 'v1')!;
    expect(byText('button', 'Roll back', v1)).toBeNull();
    expect(v1.querySelector('td:last-child')?.textContent).toBe('Files removed');
    expect(api.calls.filter(c => c.method === 'POST')).toEqual([]);
  });

  it('stays empty and honest without builds', async () => {
    await serve({ arts: [art(5)] });
    await mount(<Deploy />);
    expect(text()).toContain('No website builds need approval.');
    expect(text()).toContain('No deploys yet. The timeline shows each site\'s versions once the first one goes live.');
    expect(text()).toContain('No approved builds yet.');
    expect($$('.tl, .tlrow')).toEqual([]);
    expect(text()).not.toMatch(/simulat|prototype|fake|Rank effect/i);
  });
});

// @vitest-environment jsdom
/* The photos of a real article in Article review: the Site Builder's photo job (queued, working, failed with Try
   again), the photos with alt text, caption and credit read from the Meridian server, where they sit in the article,
   Find photos and Remove (admins and editors only). The server is a fake (fakeApi.ts). */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverArticle } from '@/store/articleFixtures';
import { photoJob, photoWire } from '@/store/buildFixtures';
import { FakeApi, answer } from '@/store/fakeApi';
import { liveApply } from '@/store/liveApply';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { Role, ServerArticle } from '@/store/types';
import { Review } from '../Review';

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
const byText = (sel: string, t: string, from: ParentNode = document) => $$(sel, from).find(e => e.textContent === t) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const unmount = async () => { if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; } };
const mount = async (node: ReactNode) => {
  await unmount();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(node); });
};
const change = (fn: () => void) => act(async () => { fn(); });

let api: FakeApi;
let site = '';
const hero = photoWire('p1');
const inline = photoWire('p2', {
  role: 'inline', after: 1, file: 'hat-ca-phe-rang-9b1c22aa', alt: 'Hạt cà phê rang', altEn: 'Roasted coffee beans', caption: 'Hạt Robusta rang vừa.', captionEn: 'Medium roast Robusta beans.',
  author: '', authorUrl: '', license: 'CC0', licenseUrl: '', title: 'Roasted beans', sourceUrl: 'javascript:alert(1)',
});
const art = (over: Partial<ServerArticle> = {}) => serverArticle(5, { siteId: site, domain: 'kopi.example', ...over });
const goLive = (a: ServerArticle) => change(() => useStore.setState(d => { d.live.on = true; d.live.arts[a.id] = a; liveApply(d); d.live.ready = true; }));
const photos = () => $$('.rvd section').find(s => s.querySelector('h3')?.textContent === 'Photos') ?? null;
const as = (role: Role) => change(() => st().signIn(meFor(role, 'Dana Owner', role + '@example.com')));
const media = (file: string, w: number) => `/api/media/articles/5/${file}-${w}.jpg`;

beforeEach(() => {
  localStorage.clear();
  resetStore(false);
  st().signIn(meFor('admin', 'Dana Owner', 'owner@example.com'));
  st().addSite({ domain: 'kopi.example', country: 0, lang: 'Vietnamese', topic: 'Coffee', status: 'live' });
  site = st().sites[0]!.id;
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

describe('the photos of a real article', () => {
  it('lists the main photo first, from the Meridian server, with alt text, caption and credit', async () => {
    await goLive(art({ images: [inline, hero], photos: photoJob('done') }));
    await mount(<Review />);
    const items = $$('.ph-item', photos()!);
    expect(items.map(x => x.querySelector('.pill')?.textContent)).toEqual(['Main photo', 'In the text']);
    const img = items[0]!.querySelector('img')!;
    expect([img.getAttribute('src'), img.getAttribute('srcset'), img.getAttribute('width'), img.getAttribute('height'), img.getAttribute('alt'), img.getAttribute('loading')])
      .toEqual([media(hero.file, 960), `${media(hero.file, 960)} 960w, ${media(hero.file, 1280)} 1280w`, '1280', '853', 'Phin nhôm trên ly cà phê', 'lazy']);
    expect(items[0]!.querySelector('a')?.getAttribute('href')).toBe(media(hero.file, 1280));
    expect($$('dd', items[0]!).map(d => d.textContent)).toEqual([
      'Phin nhôm trên ly cà phêAn aluminium phin on a glass of coffee',
      'Phin nhỏ giọt chậm.A phin drips slowly.',
      'Vietnamese iced coffee, A. Photographer, CC BY 2.0, via Wikimedia Commons',
    ]);
    expect($$('dd a', items[0]!).map(a => [a.textContent, a.getAttribute('href'), a.getAttribute('rel')])).toEqual([
      ['Vietnamese iced coffee', hero.sourceUrl, 'noopener noreferrer'], ['A. Photographer', hero.authorUrl, 'noopener noreferrer'], ['CC BY 2.0', hero.licenseUrl, 'noopener noreferrer'],
    ]);
    /* A public-domain photo names its license without a link, and a source that is not http(s) is not a link. */
    expect($$('dd', items[1]!)[2]?.textContent).toBe('Roasted beans, CC0, via Wikimedia Commons');
    expect($$('dd a', items[1]!)).toEqual([]);
    expect(items[1]!.querySelector('.note')?.textContent).toBe('After “Ratio”');
    /* No photo is loaded from anywhere but the Meridian server. */
    expect($$('img').every(i => i.getAttribute('src')?.startsWith('/api/media/articles/5/'))).toBe(true);
  });

  it('places the photos in the article where the built site puts them', async () => {
    await goLive(art({ images: [hero, inline], photos: photoJob('done') }));
    await mount(<Review />);
    const rows = $$('table.bi tbody tr').map(tr => $$('td', tr).map(td => td.textContent));
    expect(rows.slice(0, 6)).toEqual([
      ['H1 Cách pha cà phê phin', 'H1 How to brew phin coffee'],
      ['Byline Ban biên tập', 'Byline Editorial team'],
      ['Phin nhỏ giọt chậm.', 'Main photo A phin drips slowly.Alt text: An aluminium phin on a glass of coffee'],
      ['Cà phê phin là cách pha phổ biến.', 'Phin coffee is a common way to brew.'],
      ['H2 Tỉ lệ', 'H2 Ratio'],
      ['Hạt Robusta rang vừa.', 'Photo Medium roast Robusta beans.Alt text: Roasted coffee beans'],
    ]);
    expect($('table.bi figure img')?.getAttribute('alt')).toBe('Phin nhôm trên ly cà phê');
  });

  it('asks the Site Builder to find photos, and shows the job until it is done', async () => {
    await goLive(art());
    await mount(<Review />);
    expect(photos()?.querySelector('.empty')?.textContent).toBe('No photos yet. Find photos looks on Wikimedia Commons for openly licensed photos that fit this article.');
    api.on('POST', '/api/articles/5/photos', () => answer(202, { article: art({ photos: photoJob('queued'), updatedAt: art().updatedAt + 1 }) }));
    await click(byText('button', 'image_searchFind photos', photos()!));
    await settle();
    const [call] = api.to('POST', '/api/articles/5/photos');
    expect(call?.headers['x-meridian']).toBe('1');
    expect(st().snackMsg?.msg).toBe('Asked the Site Builder to find photos: How to brew phin coffee');
    expect(photos()?.querySelector('.pill.live')?.textContent).toBe('Queued');
    expect(photos()?.querySelector('.empty')).toBeNull();
    expect($$('button', photos()!)).toEqual([]);

    await goLive(art({ photos: photoJob('work', { step: 'Searching Wikimedia Commons' }), updatedAt: art().updatedAt + 2 }));
    expect(photos()?.querySelector('.row')?.textContent).toBe('Choosing photosSearching Wikimedia Commons');
    await goLive(art({ photos: photoJob('done'), updatedAt: art().updatedAt + 3 }));
    expect(photos()?.querySelector('.empty')?.textContent).toBe('No photos in this article. Find photos again looks on Wikimedia Commons for openly licensed photos that fit it.');
    expect(byText('button', 'image_searchFind photos again', photos()!)).not.toBeNull();
  });

  it('shows why the photo job failed and tries again, without touching the article', async () => {
    await goLive(art({ photos: photoJob('failed', { error: 'Wikimedia Commons did not answer.' }) }));
    await mount(<Review />);
    expect(photos()?.querySelector('.callout')?.textContent).toBe('errorThe Site Builder could not finish: Wikimedia Commons did not answer. The article itself is not affected.');
    expect($('.decide')).not.toBeNull();
    api.on('POST', '/api/articles/5/photos', () => answer(202, { article: art({ photos: photoJob('queued'), updatedAt: art().updatedAt + 1 }) }));
    await click(byText('button', 'refreshTry again', photos()!));
    await settle();
    expect(api.to('POST', '/api/articles/5/photos')).toHaveLength(1);
    expect(photos()?.querySelector('.callout')).toBeNull();
  });

  it('removes a photo after asking', async () => {
    await goLive(art({ images: [hero, inline], photos: photoJob('done') }));
    await mount(<Review />);
    await click($$('button', photos()!).find(b => b.getAttribute('aria-label') === 'Remove the photo: Roasted coffee beans') ?? null);
    expect($('dialog[open] h2')?.textContent).toBe('Remove this photo?');
    api.on('DELETE', '/api/articles/5/photos/p2', () => ({ article: art({ images: [hero], photos: photoJob('done'), updatedAt: art().updatedAt + 1 }) }));
    await click(byText('dialog[open] button', 'Remove'));
    await settle();
    expect(api.to('DELETE', '/api/articles/5/photos/p2')).toHaveLength(1);
    expect($('dialog[open]')).toBeNull();
    expect($$('.ph-item', photos()!)).toHaveLength(1);
    expect(st().snackMsg?.msg).toBe('Removed a photo from How to brew phin coffee');
  });

  it('does not say the Site Builder found nothing after a person removed the last photo', async () => {
    await goLive(art({ images: [hero], photos: photoJob('done') }));
    await mount(<Review />);
    await click($$('button', photos()!).find(b => b.getAttribute('aria-label') === 'Remove the photo: An aluminium phin on a glass of coffee') ?? null);
    /* The server keeps the finished job as it was: only the photos change. */
    api.on('DELETE', '/api/articles/5/photos/p1', () => ({ article: art({ images: [], photos: photoJob('done'), updatedAt: art().updatedAt + 1 }) }));
    await click(byText('dialog[open] button', 'Remove'));
    await settle();
    expect($$('.ph-item', photos()!)).toEqual([]);
    expect(photos()?.querySelector('.empty')?.textContent).toBe('No photos in this article. Find photos again looks on Wikimedia Commons for openly licensed photos that fit it.');
    expect(photos()?.textContent).not.toContain('found no');
  });

  it('offers no Remove while the Site Builder is choosing photos, which the server refuses', async () => {
    await goLive(art({ images: [hero], photos: photoJob('work', { step: 'Downloading 1 photo' }) }));
    await mount(<Review />);
    expect($$('.ph-item', photos()!)).toHaveLength(1);
    expect($$('button', photos()!)).toEqual([]);
    expect($$('.note', photos()!).map(n => n.textContent)).toContain('Photos can be removed once the Site Builder has finished.');
    /* Waiting in the queue, nothing is being replaced yet: the server lets a photo be removed. */
    await goLive(art({ images: [hero], photos: photoJob('queued'), updatedAt: art().updatedAt + 1 }));
    expect($$('button', photos()!).map(b => b.textContent)).toEqual(['deleteRemove']);
  });

  it('shows the snackbar when the server refuses', async () => {
    await goLive(art());
    await mount(<Review />);
    api.on('POST', '/api/articles/5/photos', () => answer(409, { error: 'Photos are already being found for this article.' }));
    await click(byText('button', 'image_searchFind photos', photos()!));
    await settle();
    expect(st().snackMsg?.msg).toBe('Photos are already being found for this article.');
  });

  it('gives a native reviewer and a viewer the photos without Find or Remove', async () => {
    for (const role of ['reviewer', 'viewer'] as const) {
      await as(role);
      if (role === 'reviewer') await change(() => useStore.setState(d => { d.session!.site = site; d.siteFilter = site; }));
      await goLive(art({ images: [hero], photos: photoJob('failed', { error: 'Timed out.' }) }));
      await mount(<Review />);
      expect($$('.ph-item', photos()!)).toHaveLength(1);
      expect($$('button', photos()!)).toEqual([]);
    }
  });

  it('shows no photo whose stored name is not a file name', async () => {
    await goLive(art({ images: [photoWire('p1', { file: '../../secret' })], photos: photoJob('done') }));
    await mount(<Review />);
    expect($$('.ph-item', photos()!)).toHaveLength(1);
    expect($$('img')).toEqual([]);
  });
});

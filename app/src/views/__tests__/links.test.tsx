// @vitest-environment jsdom
/* Package H in the app: links in an article's text (shown, added and removed in the editor), the article's category,
   the real link graph and orphan list on the Internal links tab, and the real category tree on the Architecture tab
   with rename, merge and move. Every change calls the server. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { articleContent, serverArticle } from '@/store/articleFixtures';
import { editGuard } from '@/store/editGuard';
import { liveApply } from '@/store/live';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { EngineStatus, Role, ServerArticle, SiteLinksWire } from '@/store/types';
import { Architecture } from '../Architecture';
import { Links } from '../Links';
import { Review } from '../Review';
import { buildSiteGraph, nodeInfo, siteGraphKey } from '../research/graph';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  /* jsdom has no canvas: the graph engine gets no context and draws nothing. */
  window.HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

let root: Root | null = null;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const st = () => useStore.getState();
const text = () => document.body.textContent ?? '';
const button = (t: string, within = 'body') => $$(within + ' button').find(e => e.textContent?.replace(/^[a-z_]+(?=[A-Z])/, '') === t) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const type = async (el: HTMLTextAreaElement | HTMLInputElement | null, value: string) => {
  expect(el).not.toBeNull();
  await act(async () => {
    const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const field = (id: string) => $<HTMLTextAreaElement>(`[data-ed="${id}"]`);
const unmount = async () => { if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; } };
const mount = async (node: ReactNode) => {
  await unmount();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(node); });
  await settle();
};
const change = (fn: () => void) => act(async () => { fn(); });

const engineOn: EngineStatus = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.0', ready: true, reason: '' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = [method: string, url: string, body: Record<string, unknown>];
function server(answer: (method: string, url: string, body: Record<string, unknown>) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, method = init?.method ?? 'GET';
    calls.push([method, url, body]);
    return answer(method, url, body);
  }));
  return calls;
}
const goLive = (arts: ServerArticle[] = []) => change(() => useStore.setState(d => {
  d.live.on = true; d.live.engine = engineOn; arts.forEach(a => { d.live.arts[a.id] = a; }); liveApply(d); d.live.ready = true;
}));
let site = '';
const art = (id: number, over: Partial<ServerArticle> = {}) => serverArticle(id, { siteId: site, domain: 'kopi.example', ...over });
const signIn = (role: Role) => change(() => st().signIn(meFor(role, undefined, undefined, role === 'reviewer' ? { site } : {})));

const P = 'Pahami rasio kopi dan air dulu.';
const node = (id: number, title: string, category: string, over: Partial<SiteLinksWire['articles'][number]> = {}) =>
  ({ id, title, titleEn: title + ' (en)', slug: 's' + id, status: 'approved' as const, category, out: 0, in: 0, external: 0, ...over });
const graph = (over: Partial<SiteLinksWire> = {}): SiteLinksWire => ({
  siteId: site, domain: 'kopi.example',
  articles: [node(13, 'V60', 'Teknik seduh', { status: 'review', out: 1 }), node(12, 'Rasio kopi', 'Teknik seduh', { in: 2 }), node(11, 'Arabika', 'Biji kopi', { out: 1 }), node(10, 'Sejarah', '')],
  links: [{ from: 13, to: 12, anchor: 'rasio kopi', live: false }, { from: 11, to: 12, anchor: 'takaran kopi dan air', live: true }],
  broken: [], orphans: [13, 11, 10],
  categories: [{ name: 'Teknik seduh', slug: 'teknik-seduh', articles: [13, 12], approved: 1 }, { name: 'Biji kopi', slug: 'biji-kopi', articles: [11], approved: 1 }],
  uncategorized: [10], allCategories: ['Teknik seduh', 'Biji kopi'], ...over,
});

beforeEach(() => {
  localStorage.clear();
  resetStore(false);
  editGuard.end();
  st().signIn(meFor('admin', 'Dana Owner', 'owner@example.com'));
  st().addSite({ domain: 'kopi.example', country: 0, lang: 'Indonesian', topic: 'Coffee', status: 'live' });
  site = st().sites[0]!.id;
  vi.spyOn(console, 'error');
});
afterEach(async () => {
  await unmount();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('links in an article', () => {
  const linked = () => art(11, {
    category: 'Teknik seduh',
    content: articleContent({ blocks: [
      { type: 'p', text: P, en: 'Understand the ratio first.', links: [{ start: 7, end: 17, article: 12 }, { start: 22, end: 25, url: 'https://sca.example/water' }] },
      { type: 'p', text: 'Baca ini <b>tebal</b>.', en: '', links: [{ start: 5, end: 8, url: 'javascript:alert(1)' } as never, { start: 90, end: 99, article: 12 }] },
      { type: 'list', items: [{ text: 'Lihat arabika', en: 'See arabica', links: [{ start: 6, end: 13, article: 99 }] }] },
    ] }),
  });
  const other = () => art(12, { content: articleContent({ title: 'Rasio kopi', titleEn: 'Coffee ratio', slug: 'rasio-kopi' }) });

  it('shows them where they stand and lists where each leads, never as HTML', async () => {
    await goLive([linked(), other()]);
    await mount(<Review />);
    await click($$('.rvlist button, [data-art]').find(e => e.textContent?.includes('How to brew phin coffee') && !e.textContent.includes('Coffee ratio')) ?? $('.rvd'));
    const cells = $$('table.bi td:first-child');
    const p = cells.find(td => td.textContent?.startsWith('Pahami'))!;
    expect([...p.querySelectorAll('.ed-lk')].map(e => [e.tagName, e.textContent, e.getAttribute('href'), e.getAttribute('title')])).toEqual([
      ['SPAN', 'rasio kopi', null, 'Links to the article: Coffee ratio'], ['A', 'air', 'https://sca.example/water', null],
    ]);
    expect(p.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect([...p.querySelectorAll('.ed-links li')].map(li => li.textContent)).toEqual(['articlerasio kopi → Rasio kopi', 'open_in_newair → https://sca.example/water']);
    /* A javascript: address is never a link, a range outside the text is skipped, and markup in the text is text. */
    const hostile = cells.find(td => td.textContent?.startsWith('Baca ini'))!;
    expect(hostile.querySelector('a')).toBeNull();
    expect(hostile.querySelector('b:not(.ed-links b)')).toBeNull();
    expect(hostile.textContent).toContain('Baca ini <b>tebal</b>.');
    expect(cells.find(td => td.textContent?.includes('Lihat arabika'))!.querySelector('.ed-lk')?.getAttribute('title')).toBe('Links to an article that is no longer on this site');
    expect($$('section table')[0]?.textContent).toContain('CategoryTeknik seduh');
  });

  it('adds a link on the selected words from the site\'s articles, removes one, and saves both with the category', async () => {
    const a = art(11, { category: 'Teknik seduh', content: articleContent({ blocks: [{ type: 'p', text: P, en: 'Understand the ratio first.', links: [{ start: 22, end: 25, url: 'https://sca.example/water' }] }] }) });
    await goLive([a]);
    await mount(<Review />);
    const calls = server((method, url) => method === 'GET' && url.endsWith('/links') ? json({ links: graph({ articles: [node(12, 'Rasio kopi', 'Teknik seduh'), node(11, 'Phin', 'Teknik seduh')] }) }) : json({ article: { ...a, updatedAt: a.updatedAt + 1 } }));
    await click(button('Edit', '.rvhead'));
    expect(calls).toEqual([]);
    expect($('.ed .note')?.textContent ?? text()).toBeTruthy();
    expect(text()).toContain('1 of 8 links used');
    const box = field('b0')!;
    /* No words selected: the dialog says so and adds nothing. */
    box.setSelectionRange(3, 3);
    await click($('[aria-label="Link the selected words of block 1"]'));
    await settle();
    expect($('dialog.ed-linkdlg[open] h2')?.textContent).toBe('Add a link');
    expect($('dialog.ed-linkdlg')?.textContent).toContain('No words are selected.');
    expect((button('Add link') as HTMLButtonElement).disabled).toBe(true);
    await click(button('Cancel', 'dialog.ed-linkdlg'));
    /* Words selected: choose the article they lead to. */
    box.setSelectionRange(7, 17);
    await click($('[aria-label="Link the selected words of block 1"]'));
    await settle();
    expect(calls.map(c => c.slice(0, 2))).toEqual([['GET', `/api/sites/${site}/links`]]);
    expect($('dialog.ed-linkdlg .ed-words')?.textContent).toBe('rasio kopi');
    expect($$<HTMLOptionElement>('dialog.ed-linkdlg select option').map(o => o.textContent)).toEqual(['Choose an article', 'Rasio kopi · Rasio kopi (en)']);
    await click(button('Add link'));
    expect($('dialog.ed-linkdlg [role="alert"]')?.textContent).toBe('Choose the article the words lead to.');
    await act(async () => { const sel = $<HTMLSelectElement>('dialog.ed-linkdlg select')!; Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(sel, '12'); sel.dispatchEvent(new window.Event('change', { bubbles: true })); });
    await click(button('Add link'));
    expect($('dialog.ed-linkdlg[open]')).toBeNull();
    expect($$('.ed-o .ed-links li').map(li => li.textContent)).toEqual(['articlerasio kopi → an article that is no longer on this sitelink_off', 'open_in_newair → https://sca.example/waterlink_off']);
    expect(text()).toContain('2 of 8 links used');
    /* Typing before the links moves them along; removing one leaves the other. */
    await type(box, 'Dulu, ' + P);
    await click($('[aria-label="Remove the link on “air”"]'));
    await type($<HTMLInputElement>('input[list="edCats"]'), 'Biji kopi');
    expect($$<HTMLOptionElement>('#edCats option').map(o => o.value)).toEqual(['Teknik seduh', 'Biji kopi']);
    await click(button('Save changes'));
    await settle();
    const patch = calls.find(c => c[0] === 'PATCH')!;
    expect(patch[1]).toBe('/api/articles/11/content');
    expect(patch[2].category).toBe('Biji kopi');
    expect(patch[2].blocks).toEqual([{ from: 0, type: 'p', text: 'Dulu, ' + P, links: [{ start: 13, end: 23, article: 12 }] }]);
  });

  it('takes a web address only when it is http or https, and refuses words that are already linked', async () => {
    const a = art(11, { content: articleContent({ blocks: [{ type: 'p', text: P, en: '', links: [{ start: 7, end: 17, article: 12 }] }] }) });
    await goLive([a]);
    await mount(<Review />);
    server(() => json({ links: graph({ articles: [] }) }));
    await click(button('Edit', '.rvhead'));
    field('b0')!.setSelectionRange(12, 25);
    await click($('[aria-label="Link the selected words of block 1"]'));
    await settle();
    expect($('dialog.ed-linkdlg')?.textContent).toContain('This site has no other article in review or approved yet');
    await click($$('dialog.ed-linkdlg [role="tab"]').find(t => t.textContent === 'Web address') ?? null);
    const url = $<HTMLInputElement>('dialog.ed-linkdlg input[type="url"]');
    await type(url, 'javascript:alert(1)');
    await click(button('Add link'));
    expect($('dialog.ed-linkdlg [role="alert"]')?.textContent).toBe('Enter a full web address that starts with https:// or http://.');
    await type(url, 'https://sca.example/x');
    await click(button('Add link'));
    expect($('dialog.ed-linkdlg [role="alert"]')?.textContent).toBe('Those words are already part of a link. Remove that link first.');
    expect($$('.ed-o .ed-links li')).toHaveLength(1);
  });
});

describe('the real link graph', () => {
  it('is built from the server\'s links: categories around Home, lines for links, orphans marked', () => {
    const g = buildSiteGraph({ ...graph(), siteId: 's' });
    expect(g.nodes.map(n => [n.label, n.type])).toEqual([['Home', 'home'], ['Teknik seduh', 'category'], ['V60', 'orphan'], ['Rasio kopi', 'page'], ['Biji kopi', 'category'], ['Arabika', 'orphan'], ['Sejarah', 'orphan']]);
    /* Home to 2 categories and 1 loose article, 3 category-to-article lines, 2 links in the text. */
    expect(g.edges).toHaveLength(8);
    expect(g.groups.map(x => [x.label, x.items.length])).toEqual([['kopi.example', 1], ['Teknik seduh', 3], ['Biji kopi', 2], ['No category', 1], ['No link from another article', 3]]);
    expect(nodeInfo(g.nodes[3]!)).toBe(' · Article, approved · 2 links from other articles, 0 links to other articles.');
    expect(nodeInfo(g.nodes[2]!)).toContain('No other article links here. Write a link:');
    expect(g.note).toContain('2 links between the articles of kopi.example');
    expect(buildSiteGraph({ ...graph(), siteId: 's' })).toEqual(g);
    expect(buildSiteGraph(graph({ articles: [], links: [], orphans: [], categories: [], uncategorized: [] })).note).toBe('kopi.example has no article in review or approved yet. Its link map appears here once it has one.');
    expect(siteGraphKey(graph())).not.toBe(siteGraphKey(graph({ links: [] })));
  });

  it('is drawn on the Internal links tab outside demo mode, with the orphans and a hint to write a link', async () => {
    const calls = server(() => json({ links: graph() }));
    await goLive();
    await mount(<Links />);
    expect(calls).toEqual([['GET', `/api/sites/${site}/links`, {}]]);
    expect($$('#legend span').map(x => x.textContent)).toEqual(['Home', 'Category', 'Orphan page', 'Article']);
    expect($$('#tree summary').map(x => x.textContent)).toEqual(['kopi.example (1)', 'Teknik seduh (3)', 'Biji kopi (2)', 'No category (1)', 'No link from another article (3)']);
    const [orphans, links] = $$('section table');
    expect([...orphans!.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))).toEqual([
      ['V60V60 (en)', 'Teknik seduh', 'In review', 'Rasio kopi · Arabika'], ['ArabikaArabika (en)', 'Biji kopi', 'Approved', 'V60 · Rasio kopi'], ['SejarahSejarah (en)', 'None', 'Approved', 'V60 · Rasio kopi'],
    ]);
    expect(text()).toContain('Write a link: open a related article in Article review');
    expect([...links!.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))).toEqual([
      ['V60', 'rasio kopi', 'Rasio kopi', 'Plain text until both are approved'], ['Arabika', 'takaran kopi dan air', 'Rasio kopi', 'Shown as a link'],
    ]);
    /* An article changes: the links are read again. */
    await goLive([art(13, { updatedAt: 5 })]);
    await settle();
    expect(calls).toHaveLength(2);
  });

  it('says so when the links cannot be read, and keeps the sample out of it', async () => {
    server(() => json({ error: 'Your role reviews articles only.' }, 403));
    await goLive();
    await mount(<Links />);
    expect(text()).toContain('The links of kopi.example could not be read. Your role reviews articles only.');
    expect(text()).not.toContain('article 1');
  });
});

describe('the category tree on Architecture', () => {
  it('shows the site\'s categories with their articles and counts', async () => {
    server(() => json({ links: graph() }));
    await goLive();
    await mount(<Architecture />);
    expect($('.sh h2')?.textContent).toBe('Category tree for kopi.example');
    expect($('.sh .note')?.textContent).toBe('2 categories, 4 articles: 3 approved, 1 in review');
    expect($$('.st-pillar').map(x => x.querySelector('b')?.textContent + ' | ' + x.querySelector('.note')?.textContent)).toEqual([
      'Teknik seduh | /teknik-seduh/ · 2 articles · 1 approved', 'Biji kopi | /biji-kopi/ · 1 article · 1 approved', 'No category | 1 article · linked from the home page only',
    ]);
    expect($$('.ct-a').map(x => x.querySelector('.ct-t')?.textContent)).toEqual(['V60 · V60 (en)', 'Rasio kopi · Rasio kopi (en)', 'Arabika · Arabika (en)', 'Sejarah · Sejarah (en)']);
    expect($$('.ct-a')[1]?.textContent).toContain('2 links in, 0 out');
  });

  it('renames a category, warns before a merge, and moves an article', async () => {
    const merged = graph({ categories: [{ name: 'Biji kopi', slug: 'biji-kopi', articles: [13, 12, 11], approved: 2 }], allCategories: ['Biji kopi'] });
    const calls = server((method, _url, body) => method === 'GET' ? json({ links: graph() }) : json({ links: merged, changed: 2, merged: body.to === 'biji kopi' }));
    await goLive();
    await mount(<Architecture />);
    await click($('[aria-label="Rename the category Teknik seduh"]'));
    const input = () => $<HTMLInputElement>('dialog.ct-dlg input');
    expect(input()?.value).toBe('Teknik seduh');
    expect((button('Rename') as HTMLButtonElement).disabled).toBe(true);
    await type(input(), 'biji kopi');
    expect($('dialog.ct-dlg .callout')?.textContent).toContain('“Biji kopi” already exists. The two categories become one, named “biji kopi”, with 3 articles.');
    await click(button('Merge categories'));
    await settle();
    expect(calls.at(-1)).toEqual(['POST', `/api/sites/${site}/categories`, { from: 'Teknik seduh', to: 'biji kopi' }]);
    expect($('dialog.ct-dlg[open]')).toBeNull();
    expect($$('.st-pillar b').map(x => x.textContent)).toEqual(['Biji kopi', 'No category']);
    expect(st().snackMsg?.msg ?? JSON.stringify(st().snackMsg)).toContain('Merged “Teknik seduh” into “biji kopi”.');
    await click($('[aria-label="Change the category of Sejarah"]'));
    await type(input(), 'Budaya');
    await click(button('Save'));
    await settle();
    expect(calls.at(-1)).toEqual(['POST', `/api/sites/${site}/categories`, { articleId: 10, to: 'Budaya' }]);
  });

  it('shows what the server refused, and offers no change to a viewer', async () => {
    server(method => method === 'GET' ? json({ links: graph() }) : json({ error: 'This site has no category “Teknik seduh” (any more).' }, 404));
    await goLive();
    await mount(<Architecture />);
    await click($('[aria-label="Rename the category Teknik seduh"]'));
    await type($<HTMLInputElement>('dialog.ct-dlg input'), 'Seduh');
    await click(button('Rename'));
    await settle();
    expect($('dialog.ct-dlg [role="alert"]')?.textContent).toBe('This site has no category “Teknik seduh” (any more).');
    await click(button('Cancel', 'dialog.ct-dlg'));
    await signIn('viewer');
    expect($$('.ct .linkbtn')).toEqual([]);
    expect($$('.st-pillar b').map(x => x.textContent)).toEqual(['Teknik seduh', 'Biji kopi', 'No category']);
  });

  it('keeps the sample tree in demo mode and the planned note without the server', async () => {
    await mount(<Architecture />);
    expect(text()).toContain('No silo tree yet');
    await unmount();
    resetStore(true);
    st().signIn(meFor('admin'));
    await mount(<Architecture />);
    expect($('.sh h2')?.textContent).toMatch(/^Silo tree for /);
  });
});

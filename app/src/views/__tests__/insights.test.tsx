// @vitest-environment jsdom
/* Insights data on screen, outside demo mode: the Search Console and GA4 tabs with their honest empty states, the
   day chart, rank tracking with its heat map and the rank effect on the deploy timeline, and search volume with
   "Track" in a research result. The server's answers are faked at fetch(). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWire, cloudflareWire } from '@/store/buildFixtures';
import type { Ga4OverviewWire, RankWire, SiteGa4Wire, SiteInsightsWire, SiteSearchWire } from '@/store/insightsApi';
import { dayLabel, pagePath } from '@/store/insightsApi';
import { liveApply, volumeText } from '@/store/liveApply';
import { MOD_EMPTY } from '@/store/rules';
import { serverFactsTo } from '@/store/serverFacts';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { KeywordOut, Role, ServerRequest, Site } from '@/store/types';
import { Rank, rankReason } from '../Rank';
import { Research } from '../Research';
import { BuildTimeline } from '../deploy/BuildTimeline';
import { KwResultSheet } from '../research/KwResultSheet';
import { liveHeatRows } from '../research/heatData';
import { DayChart, niceMax } from '../system/DayChart';
import { SourceTab } from '../system/SourceTab';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

let root: Root | null = null;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string, within: ParentNode = document) => [...within.querySelectorAll<HTMLElement>(sel)];
const st = () => useStore.getState();
const text = () => document.body.textContent ?? '';
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); });
const mount = async (node: ReactNode) => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); }
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => { root?.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>); });
  await flush();
};
const section = (h: string) => $$('section').find(s => s.querySelector('h2')?.textContent?.startsWith(h)) ?? null;
const table = (within: ParentNode) => $$('tbody tr', within).map(tr => $$('td', tr).map(td => td.textContent ?? ''));
const button = (label: string) => $$('button').find(b => b.textContent?.includes(label)) ?? null;
const click = (el: Element | null) => act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

const site = (id: string, domain: string, cc = 'VN', country = 'Vietnam'): Site =>
  ({ id, domain, country, cc, lang: 'Vietnamese', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });

/* ---------- The server's answers ---------- */

const days = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 4 + i)).toISOString().slice(0, 10), v: f(i) }));
const GSC: SiteSearchWire = {
  state: 'ok', property: 'sc-domain:kopi.example', fetchedAt: Date.UTC(2026, 9, 4, 6), error: '', truncated: false, from: '2026-09-04', to: '2026-10-01',
  totals: { clicks: 1234, impressions: 45678, ctr: 0.027, position: 8.4 },
  days: days(28, i => 30 + i).map(d => ({ date: d.date, clicks: d.v, impressions: d.v * 20, position: 8 })),
  pages: [{ key: 'https://kopi.example/cold-brew/?ref=1', clicks: 800, impressions: 20000, ctr: 0.04, position: 4.2 }, { key: 'https://kopi.example/', clicks: 300, impressions: 9000, ctr: 0.033, position: 0 }],
  queries: [{ key: 'cara membuat cold brew', clicks: 500, impressions: 7000, ctr: 0.071, position: 3.1 }],
};
const GA4: SiteGa4Wire = {
  state: 'ok', property: 'properties/1001', propertyName: 'Kopi', auto: true, fetchedAt: Date.UTC(2026, 9, 4, 6), error: '', from: '2026-09-06', to: '2026-10-03',
  totals: { users: 900, sessions: 1500, engaged: 600, rate: 0.4 },
  days: days(28, i => 50 + i).map(d => ({ date: d.date, users: d.v - 10, sessions: d.v, engaged: 20 })),
  pages: [{ key: '/cold-brew/', users: 400, sessions: 520, engaged: 300, rate: 0.577 }],
};
const blankGsc = (state: SiteSearchWire['state'], error = ''): SiteSearchWire => ({ ...GSC, state, error, fetchedAt: null, totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 }, days: [], pages: [], queries: [] });
const blankGa4 = (state: SiteGa4Wire['state']): SiteGa4Wire => ({ ...GA4, state, property: '', propertyName: '', auto: false, totals: { users: 0, sessions: 0, engaged: 0, rate: 0 }, days: [], pages: [] });
const OVERVIEW: Ga4OverviewWire = {
  connected: true, fetchedAt: Date.UTC(2026, 9, 4, 6), error: '',
  properties: [{ id: 'properties/1001', name: 'Kopi', account: 'Sites' }, { id: 'properties/1002', name: 'Old shop', account: 'Sites' }],
  sites: {
    a: { state: 'ok', property: 'properties/1001', propertyName: 'Kopi', auto: true, error: '', totals: GA4.totals },
    b: { state: 'no-property', property: '', propertyName: '', auto: false, error: '', totals: { users: 0, sessions: 0, engaged: 0, rate: 0 } },
  },
};
const RANK: RankWire = {
  connected: true,
  sites: {
    a: { state: 'ok', to: '2026-10-01', keywords: [
      { keyword: 'cara membuat cold brew', intent: 'Informational', source: 'article', position: 4, change7: 2, change28: 5, page: 'https://kopi.example/cold-brew/', clicks: 168, impressions: 2800 },
      { keyword: 'rasio cold brew', intent: 'Informational', source: 'tracked', position: 12.3, change7: -1, change28: null, page: 'https://kopi.example/rasio/', clicks: 28, impressions: 280 },
      { keyword: 'beli kopi', intent: 'Transactional', source: 'article', position: 9, change7: 0, change28: 0, page: '', clicks: 0, impressions: 40 },
      { keyword: 'kopi tubruk', intent: '', source: 'article', position: null, change7: null, change28: null, page: '', clicks: 0, impressions: 0 },
    ] },
    b: { state: 'no-data', to: '', keywords: [{ keyword: 'teh tarik', intent: 'Informational', source: 'article', position: null, change7: null, change28: null, page: '', clicks: 0, impressions: 0 }] },
  },
  effects: { 7: { change: 0.9, keywords: 2 } },
};

type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];
let answers: Record<string, () => unknown> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const detail = (gsc: SiteSearchWire, ga4: SiteGa4Wire = GA4) => (): SiteInsightsWire => ({ siteId: 'a', domain: 'kopi.example', gsc, ga4 });

/** Outside demo mode, signed in, the server answering, two sites; `ints` are the connected services. */
const live = (role: Role = 'admin', ints: string[] = ['gsc', 'ga4']) => {
  resetStore(false);
  st().signIn(meFor(role));
  useStore.setState(d => {
    d.sync = { loaded: true, error: '' };
    d.live.on = true;
    d.live.engine = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.284 (Claude Code)', ready: true, reason: '' };
    d.sites.push(site('a', 'kopi.example', 'ID', 'Indonesia'), site('b', 'teh.example', 'MY', 'Malaysia'));
    for (const id of ['gsc', 'ga4', 'dfs', 'ads', 'cf']) d.live.ints[id] = cloudflareWire(ints.includes(id), { id, name: id === 'gsc' ? 'Google Search Console' : id === 'ga4' ? 'Google Analytics 4' : id });
    if (ints.includes('gsc')) d.live.metrics = { at: 1, sites: { a: { clicks28: 1234, impressions28: 45678, position28: 8.4, clicks7: 300, property: 'sc-domain:kopi.example', to: '2026-10-01' } } };
    liveApply(d); serverFactsTo(d); d.live.ready = true;
  });
};

beforeEach(() => {
  localStorage.clear();
  calls = [];
  answers = { '/api/metrics/site/a': detail(GSC), '/api/metrics/site/b': detail(blankGsc('no-property'), blankGa4('no-property')), '/api/rank': () => RANK, '/api/ga4': () => ({ ga4: OVERVIEW }) };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), method = init?.method ?? 'GET';
    /* Signing in also asks for the bell's alerts: not what these tests are about. */
    if (path !== '/api/notifications') calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const a = answers[method === 'GET' ? path : method + ' ' + path];
    return a ? json(a()) : json({ error: 'offline' }, 503);
  }));
});
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  vi.unstubAllGlobals();
});

describe('the day chart', () => {
  it('scales to a round number and reads out each day with the arrow keys', async () => {
    expect([niceMax(0), niceMax(3), niceMax(57), niceMax(100), niceMax(1234)]).toEqual([4, 4, 100, 100, 2000]);
    await mount(<DayChart title="Clicks per day" unit="clicks" days={[{ date: '2026-09-30', value: 10 }, { date: '2026-10-01', value: 40 }, { date: '2026-10-02', value: 25 }]} />);
    const plot = $('.dc-plot')!;
    expect(plot.getAttribute('aria-label')).toBe('Clicks per day: 75 clicks from 30 Sep to 2 Oct. Use the left and right arrow keys to read each day.');
    expect($$('.dc-y span').map(x => x.textContent)).toEqual(['40', '30', '20', '10', '0']);
    expect($$('.dc-x span').map(x => x.textContent)).toEqual(['30 Sep', '1 Oct', '2 Oct']);
    /* The line starts at the first day's value and the area closes on the baseline. */
    expect($('.dc-line')?.getAttribute('d')).toBe('M0.00 75.00 L50.00 0.00 L100.00 37.50');
    expect($('.dc-area')?.getAttribute('d')?.endsWith('L100.00 100 L0.00 100 Z')).toBe(true);
    expect($('.dc-tip')).toBeNull();
    const key = (k: string) => act(async () => { plot.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
    await key('ArrowRight');
    expect($('.dc-tip')?.textContent).toBe('10 clicks30 Sep');
    await key('ArrowRight'); await key('ArrowRight'); await key('ArrowRight');
    expect($('.dc-tip')?.textContent).toBe('25 clicks2 Oct');
    await key('Escape');
    expect($('.dc-tip')).toBeNull();
    /* The same days as a table, for a screen reader. */
    expect(table($('.daychart table')!)).toEqual([['2026-09-30', '10'], ['2026-10-01', '40'], ['2026-10-02', '25']]);
    expect([dayLabel('2026-09-07'), pagePath('https://kopi.example/a/?x=1'), pagePath('not a url')]).toEqual(['7 Sep', '/a/?x=1', 'not a url']);
  });
});

describe('Search Console tab', () => {
  it('says it is not connected, and asks the server nothing', async () => {
    live('admin', []);
    await mount(<SourceTab id="gsc" />);
    expect(text()).toContain('Google Search Console is not connected.');
    expect(text()).toContain(MOD_EMPTY.gsc);
    expect(button('Open Integrations')).not.toBeNull();
    expect(calls).toEqual([]);
    /* Someone who cannot open Integrations gets no button to it. */
    live('viewer', []);
    await mount(<SourceTab id="gsc" />);
    expect(button('Open Integrations')).toBeNull();
  });

  it('shows the totals by site, then a site\'s tiles, clicks per day, top pages and top queries', async () => {
    live();
    await mount(<SourceTab id="gsc" />);
    expect(table(section('By site')!)).toEqual([['ID · kopi.example', '1,234', '45,678', '2.7%', '8.4']]);
    const d = section('Site detail')!;
    expect($$('.tile', d).map(x => x.textContent)).toEqual(['1,234Clicks', '45,678Impressions', '2.7%Click-through rate', '8.4Average position']);
    expect($('.daychart figcaption', )?.textContent).toBe('Clicks per day');
    expect($$('.daychart tbody tr')).toHaveLength(28);
    const [pages, queries] = $$('.ins-two > div', d);
    expect(table(pages!)).toEqual([['/cold-brew/?ref=1', '800', '20,000', '4.0%', '4.2'], ['/', '300', '9,000', '3.3%', '—']]);
    expect(table(queries!)).toEqual([['cara membuat cold brew', '500', '7,000', '7.1%', '3.1']]);
    expect(text()).toContain('4 Sep to 1 Oct, web search, from the property sc-domain:kopi.example. Search Console data is about 3 days behind.');
    expect(calls.map(c => c.path)).toEqual(['/api/metrics/site/a']);
  });

  it('says why a site has nothing: no property, no data yet, still reading, a failed refresh', async () => {
    live();
    useStore.setState(d => { d.siteFilter = 'b'; });
    await mount(<SourceTab id="gsc" />);
    expect(text()).toContain('No Search Console property for teh.example');
    expect($('.daychart')).toBeNull();
    /* With one site in the filter there is nothing to pick. */
    expect($('.ins-pick .dd, .ins-pick select')).toBeNull();

    useStore.setState(d => { d.siteFilter = 'all'; });
    answers['/api/metrics/site/a'] = detail(blankGsc('no-data'));
    await mount(<SourceTab id="gsc" />);
    expect(text()).toContain('No data yetGoogle needs a few days after a site goes live before it reports searches.');

    answers['/api/metrics/site/a'] = detail(blankGsc('waiting'));
    await mount(<SourceTab id="gsc" />);
    expect(text()).toContain('Reading Search ConsoleThe first figures for this site are being fetched.');

    answers['/api/metrics/site/a'] = detail({ ...GSC, error: 'The Search Console quota is used up for now. Meridian tries again at the next refresh.' });
    await mount(<SourceTab id="gsc" />);
    expect($('.callout.warn')?.textContent).toBe('sync_problemThe last refresh did not finish. The Search Console quota is used up for now. Meridian tries again at the next refresh. The figures below are from the fetch before it.');
    expect($$('.tile')).toHaveLength(4);
  });

  it('refreshes for an editor; a viewer has no Refresh button', async () => {
    live('editor');
    answers['POST /api/metrics/refresh'] = () => ({ metrics: { at: 2, sites: {} } });
    await mount(<SourceTab id="gsc" />);
    await click(button('Refresh'));
    await flush();
    expect(calls.filter(c => c.method === 'POST').map(c => c.path)).toEqual(['/api/metrics/refresh']);
    expect(calls.filter(c => c.path === '/api/metrics/site/a')).toHaveLength(2);
    live('viewer');
    await mount(<SourceTab id="gsc" />);
    expect(button('Refresh')).toBeNull();
    expect($$('.tile')).toHaveLength(4);
  });
});

describe('GA4 tab', () => {
  it('says it is not connected', async () => {
    live('admin', ['gsc']);
    await mount(<SourceTab id="ga4" />);
    expect(text()).toContain('Google Analytics 4 is not connected.');
    expect(text()).toContain(MOD_EMPTY.ga4);
    expect(calls).toEqual([]);
  });

  it('lists each site with its property and figures, and a site\'s sessions per day and top pages', async () => {
    live('viewer');
    await mount(<SourceTab id="ga4" />);
    /* A viewer reads which property is used; only people who may change things get the select. */
    expect(table(section('By site')!)).toEqual([
      ['ID · kopi.example', 'KopiMatched by domain', '900', '1,500', '600', '40.0%'],
      ['MY · teh.example', 'No property', '—', '—', '—', '—'],
    ]);
    const d = section('Site detail')!;
    expect($$('.tile', d).map(x => x.textContent)).toEqual(['900Users', '1,500Sessions', '600Engaged sessions', '40.0%Engagement rate']);
    expect($('.daychart figcaption')?.textContent).toBe('Sessions per day');
    expect(table($$('.scroll', d).at(-1)!)).toEqual([['/cold-brew/', '400', '520', '300', '57.7%']]);
    expect(text()).toContain('from the property Kopi, matched by domain.');
  });

  it('lets an editor choose the property of a site that was not matched', async () => {
    live('editor');
    answers['POST /api/ga4/map'] = () => ({ ga4: { ...OVERVIEW, sites: { ...OVERVIEW.sites, b: { ...OVERVIEW.sites.a!, property: 'properties/1002', propertyName: 'Old shop', auto: false, state: 'waiting' } } } });
    await mount(<SourceTab id="ga4" />);
    const row = $$('tbody tr', section('By site')!)[1]!;
    expect(row.textContent).toContain('No property has this domain. Choose one.');
    const select = row.querySelector('select')!;
    expect([...select.options].map(o => o.textContent)).toEqual(['Match by domain', 'Kopi (Sites)', 'Old shop (Sites)']);
    await act(async () => { select.value = 'properties/1002'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(calls.find(c => c.method === 'POST')).toEqual({ method: 'POST', path: '/api/ga4/map', body: { siteId: 'b', property: 'properties/1002' } });
    expect($$('tbody tr', section('By site')!)[1]!.querySelector('select')!.value).toBe('properties/1002');
  });

  it('says so when a site has no property or its property has no sessions', async () => {
    live();
    useStore.setState(d => { d.siteFilter = 'b'; });
    await mount(<SourceTab id="ga4" />);
    expect(text()).toContain('No Analytics property for teh.example');
    useStore.setState(d => { d.siteFilter = 'a'; });
    answers['/api/metrics/site/a'] = detail(GSC, { ...GA4, state: 'no-data', days: [], pages: [] });
    await mount(<SourceTab id="ga4" />);
    expect(text()).toContain('No data yetThe property Kopi has no sessions in the last 28 days.');
  });
});

describe('Rank tab', () => {
  it('says Search Console is not connected', async () => {
    live('admin', []);
    await mount(<Rank />);
    expect(text()).toContain('Search Console is not connected' + MOD_EMPTY.rank);
    expect(calls).toEqual([]);
  });

  it('lists the tracked keywords with position and changes, best first, and why a site has none', async () => {
    live();
    await mount(<Rank />);
    const t = section('Tracked keywords')!;
    expect(table(t)).toEqual([
      ['cara membuat cold brewInformational', 'ID · kopi.example', '4.0', 'arrow_upward+2.0', 'arrow_upward+5.0', '/cold-brew/', '168'],
      ['beli kopiTransactional', 'ID · kopi.example', '9.0', 'remove0.0', 'remove0.0', '—', '0'],
      ['rasio cold brew Tracked by handInformational', 'ID · kopi.example', '12.3', 'arrow_downward−1.0', '—', '/rasio/', '28'],
      ['kopi tubruk', 'ID · kopi.example', '—', '—', '—', '—', '0'],
      ['teh tarikInformational', 'MY · teh.example', '—', '—', '—', '—', '0'],
    ]);
    /* The arrow is not the only sign: the title says it in words. */
    expect($('.chg.up')?.getAttribute('title')).toBe('Moved up 2.0 positions');
    expect($('.ins-states')?.textContent).toBe('teh.example: No data yet: Google needs a few days after a site goes live.');
    expect(text()).toContain('Position is the average over the newest 7 days of Search Console data (to 1 Oct)');
  });

  it('draws the heat map from the tracked keywords: one row per country, a dash where nothing is known', async () => {
    live();
    await mount(<Rank />);
    const heat = $('.heat')!;
    expect($$('.hh .full', heat).map(x => x.textContent)).toEqual(['Informational', 'Commercial', 'Transactional', 'Navigational', 'Local']);
    expect($$('.hr', heat).map(x => x.textContent)).toEqual(['IDIndonesia']);
    /* Informational: (+2 and −1) / 2. */
    expect($$('.hc', heat).map(x => [x.textContent, x.className])).toEqual([['+0.5', 'hc u1'], ['—', 'hc na'], ['0.0', 'hc z'], ['—', 'hc na'], ['—', 'hc na']]);
    expect($('.hc.u1')?.getAttribute('title')).toBe('Indonesia, Informational: +0.5 positions, 2 keywords');
    expect(liveHeatRows(RANK, [site('a', 'kopi.example', 'ID', 'Indonesia'), site('b', 'teh.example', 'MY', 'Malaysia')], 'b')).toEqual([]);
    expect(liveHeatRows(undefined, [], 'all')).toEqual([]);
  });

  it('has one empty state when nothing is tracked, and words for every reason', async () => {
    live();
    answers['/api/rank'] = () => ({ connected: true, sites: { a: { state: 'no-keywords', to: '', keywords: [] }, b: { state: 'no-keywords', to: '', keywords: [] } }, effects: {} });
    await mount(<Rank />);
    expect($('.heat')).toBeNull();
    expect(text()).toContain('No tracked keywords yetThe keywords of approved articles are tracked by themselves.');
    expect(rankReason('ok')).toBeNull();
    expect(rankReason('no-data')).toBe('No data yet: Google needs a few days after a site goes live.');
    expect(rankReason('not-connected')).toBe('Search Console is not connected.');
    expect(rankReason('no-property')).toContain('no Search Console property');
  });
});

describe('rank effect on the deploy timeline', () => {
  it('is shown on a deploy the server measured, and on no other', async () => {
    live();
    useStore.setState(d => {
      d.live.builds[7] = buildWire(7, 'a', 'kopi.example', 1, { review: 'approved', deploy: 'superseded', deployedAt: Date.UTC(2026, 8, 10) });
      d.live.builds[8] = buildWire(8, 'a', 'kopi.example', 2, { review: 'approved', deploy: 'live', deployedAt: Date.UTC(2026, 9, 2) });
    });
    await mount(<BuildTimeline />);
    const nodes = $$('.tln');
    expect(nodes.map(n => n.querySelector('.rank-effect')?.textContent ?? null)).toEqual(['Rank +0.9', null]);
    expect($('.rank-effect')?.getAttribute('title')).toContain('Average position change of 2 tracked keywords');
    /* Without Search Console nothing is asked and nothing is claimed. */
    calls = [];
    live('admin', []);
    useStore.setState(d => { d.live.builds[7] = buildWire(7, 'a', 'kopi.example', 1, { review: 'approved', deploy: 'live', deployedAt: Date.UTC(2026, 8, 10) }); });
    await mount(<BuildTimeline />);
    expect($('.rank-effect')).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('search volume in keyword research', () => {
  const kw = (id: number, keyword: string, over: Partial<KeywordOut> = {}): KeywordOut => ({ id, keyword, meaning: 'm', intent: 'Informational', cluster: 'Brewing', basis: 'Seed', volume: null, competition: '', volumeAt: null, track: false, ...over });
  const request = (keywords: KeywordOut[]): ServerRequest => ({
    id: 1, siteId: 'a', domain: 'kopi.example', country: 'Indonesia', lang: 'Indonesian', topic: 'cold brew', goal: 'g', status: 'done', engine: 'openai-api', step: '', summary: 'Two ideas.',
    notes: '', error: '', tokens: 1500, costUsd: 0.12, createdAt: 1000, startedAt: 2000, finishedAt: 5000, keywords,
  });
  const put = (keywords: KeywordOut[]) => useStore.setState(d => { d.live.reqs[1] = request(keywords); liveApply(d); });
  const heads = (within: ParentNode = document) => $$('thead th', within).map(th => th.textContent);

  it('is "n/a" when never asked, a dash when there is no figure, else the number', () => {
    expect([volumeText({ volume: 1900, volumeAt: 5 }), volumeText({ volume: null, volumeAt: 5 }), volumeText({ volume: null, volumeAt: null }), volumeText({})]).toEqual(['1,900', '—', 'n/a', 'n/a']);
  });

  it('stays hidden without volumes, and shows Volume in the result and in the Keywords table once a keyword has one', async () => {
    live('editor', ['gsc']);
    put([kw(11, 'cara membuat cold brew'), kw(12, 'rasio cold brew')]);
    await mount(<KwResultSheet rid={1} onClose={() => {}} />);
    expect(heads()).toEqual(['Select', 'Keyword', 'Meaning', 'Intent', 'Cluster', 'Why proposed', 'Track', 'Actions']);
    expect(button('Refresh volumes')).toBeNull();
    useStore.setState(d => { d.rctab = 'keywords'; });
    await mount(<Research />);
    expect(heads(section('Keywords') ?? document).some(h => h === 'Volume/mo')).toBe(false);
    expect(text()).toContain('Search volume is not shown: connect Google Ads or DataForSEO in Integrations to add it.');

    live('editor', ['gsc', 'dfs']);
    put([kw(11, 'cara membuat cold brew', { volume: 1900, competition: 'LOW', volumeAt: 5 }), kw(12, 'rasio cold brew', { volumeAt: 5 })]);
    await mount(<KwResultSheet rid={1} onClose={() => {}} />);
    expect(heads()).toEqual(['Select', 'Keyword', 'Meaning', 'Volume/mo', 'Competition', 'Intent', 'Cluster', 'Why proposed', 'Track', 'Actions']);
    expect(table(document).map(r => [r[1], r[3], r[4]])).toEqual([['cara membuat cold brew', '1,900', 'Low'], ['rasio cold brew', '—', '—']]);
    expect(text()).toContain('Volume is approximate monthly searches in Indonesia (Indonesian) from Google Ads via DataForSEO.');
    useStore.setState(d => { d.rctab = 'keywords'; });
    await mount(<Research />);
    expect(text()).toContain('Search volume comes from DataForSEO');
    const cols = $$('thead th').map(th => th.textContent);
    expect(cols).toContain('Volume/mo');
    expect(cols).not.toContain('KD');
    expect(text()).toContain('1,900');
  });

  it('refreshes the volumes and marks a keyword to track through the server', async () => {
    live('editor', ['gsc', 'dfs']);
    put([kw(11, 'cara membuat cold brew'), kw(12, 'rasio cold brew')]);
    answers['POST /api/requests/1/volumes'] = () => ({ request: request([]), found: 1, sent: 2 });
    answers['POST /api/keywords/12/track'] = () => ({ request: request([]) });
    await mount(<KwResultSheet rid={1} onClose={() => {}} />);
    await click(button('Refresh volumes'));
    await flush();
    expect(st().snackMsg?.msg).toBe('Search volume refreshed: 1 of 2 keywords have a figure.');
    const box = $$('input[type=checkbox]').find(i => i.getAttribute('aria-label') === 'Track the position of: rasio cold brew' || i.closest('label')?.textContent?.includes('Track the position of: rasio cold brew'))!;
    await click(box);
    await flush();
    expect(calls.filter(c => c.method === 'POST')).toEqual([
      { method: 'POST', path: '/api/requests/1/volumes', body: { provider: 'dfs' } },
      { method: 'POST', path: '/api/keywords/12/track', body: { on: true } },
    ]);
    /* A viewer gets neither. */
    live('viewer', ['gsc', 'dfs']);
    put([kw(11, 'cara membuat cold brew', { volume: 1900, volumeAt: 5 })]);
    await mount(<KwResultSheet rid={1} onClose={() => {}} />);
    expect(button('Refresh volumes')).toBeNull();
    expect(heads()).not.toContain('Track');
    expect(heads()).toContain('Volume/mo');
  });
  it('uses Google Ads independently, labels shared groups and refreshes through the selected provider', async () => {
    live('editor', ['ads']);
    put([kw(11, 'coffee', { volume: 0, volumeAt: 5, volumeProvider: 'ads', volumeGroup: 'coffee', volumeCountry: 'Malaysia', volumeLanguage: 'English' }), kw(12, 'coffees', { volume: 0, volumeAt: 5, volumeProvider: 'ads', volumeGroup: 'coffee' })]);
    answers['POST /api/requests/1/volumes'] = () => ({ request: request([]), found: 0, sent: 2 });
    await mount(<KwResultSheet rid={1} onClose={() => {}} />);
    expect(text()).toContain('Malaysia (English) from Google Ads directly');
    expect(text()).toContain('shared group: coffee'); expect(text()).toContain('must not be added together');
    expect(text()).toContain('Last fetched:'); expect(button('Refresh volumes')).not.toBeNull();
    await click(button('Refresh volumes')); await flush();
    expect(calls.find(c => c.path.endsWith('/volumes'))?.body).toEqual({ provider: 'ads' });
    expect(st().snackMsg?.msg).toBe('No search volume is available for these keywords.');
  });
  it('allows choosing DataForSEO while Google Ads is also connected', async () => {
    live('editor', ['ads', 'dfs']); put([kw(11, 'coffee')]);
    answers['POST /api/requests/1/volumes'] = () => ({ request: request([]), found: 1, sent: 1 });
    await mount(<KwResultSheet rid={1} onClose={() => {}} />);
    const select = document.querySelector<HTMLSelectElement>('select')!;
    expect(select.value).toBe('ads');
    await act(async () => { select.value = 'dfs'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await click(button('Refresh volumes')); await flush();
    expect(calls.find(c => c.path.endsWith('/volumes'))?.body).toEqual({ provider: 'dfs' });
  });

});

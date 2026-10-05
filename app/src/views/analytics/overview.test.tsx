// @vitest-environment jsdom
/* The Analytics overview on screen: the bubble chart and its accessible twin with the sample data, and how the layout
   adapts outside demo mode when there are only a few sites. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { liveApply } from '@/store/liveApply';
import { serverFactsTo } from '@/store/serverFacts';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { Role, Site, SpendWire } from '@/store/types';
import { Overview } from './Overview';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, within: ParentNode = document) => [...within.querySelectorAll<T>(sel)];
const st = () => useStore.getState();
const text = () => document.body.textContent ?? '';
const mount = async (node: ReactNode) => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); }
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => { root?.render(node); });
};
const section = (h: string) => $$('section').find(s => s.querySelector('h2')?.textContent === h) ?? null;
const fire = (el: Element, type: string, init: KeyboardEventInit = {}) => act(async () => {
  el.dispatchEvent(type === 'keydown' ? new window.KeyboardEvent(type, { bubbles: true, ...init }) : new window.FocusEvent(type, { bubbles: true }));
});
afterEach(async () => { if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; } });

const site = (id: string, domain: string): Site =>
  ({ id, domain, country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
const use = (today: number, d28: number, tokens28: number) => ({ today, tokensToday: 0, d7: d28, d28, tokens28 });
/** Outside demo mode: the given sites, the ledger's sums, and Search Console clicks when `clicks` is given. */
function live(sites: Site[], spend: SpendWire, clicks: Record<string, number> | null = null, role: Role = 'admin') {
  resetStore(false);
  st().signIn(meFor(role));
  useStore.setState(d => {
    d.sync = { loaded: true, error: '' };
    d.live.on = true;
    d.sites.push(...sites);
    d.live.spend = spend;
    if (clicks) {
      d.ints.find(x => x.id === 'gsc')!.tail = 'Connected';
      d.live.metrics = { sites: Object.fromEntries(Object.entries(clicks).map(([id, c]) => [id, { clicks28: c, impressions28: c * 20, position28: 12 }])) } as typeof d.live.metrics;
    }
    liveApply(d); serverFactsTo(d); d.live.ready = true;
  });
}
const AGENTS = { 'Content Writer': { tokens: 45_000, cost: 3, runs: 4 } };

describe('Overview with the sample data (120 sites)', () => {
  it('draws one focusable, named bubble per site that has numbers, and mirrors them in a table', async () => {
    resetStore();
    st().signIn(meFor('admin'));
    await mount(<Overview />);
    const chart = section('Traffic against cost')!;
    const bubbles = $$<SVGGElement>('.an-bub', chart);
    expect(bubbles.length).toBeGreaterThan(90);
    expect(bubbles.every(b => b.getAttribute('role') === 'img' && b.hasAttribute('tabindex') && !!b.getAttribute('aria-label'))).toBe(true);
    /* One tab stop for the chart: the site with the most clicks. The arrow keys reach the others. */
    expect(bubbles.filter(b => b.getAttribute('tabindex') === '0').map(b => b.dataset.site)).toEqual(['a']);
    expect($<SVGGElement>('.an-bub[data-site="a"]')?.getAttribute('aria-label')).toMatch(/^domain-a\.example, VN: 18,420 clicks, \$\d+\.\d\d agent spend and 1\.90M tokens in 28 days\. Within budget\.$/);
    expect($$('.an-bub.blocked', chart).length).toBeGreaterThan(0);
    expect($$('.an-bub.near', chart).map(b => b.dataset.site)).toEqual(['b']);
    /* The table for screen readers has every bubble, most clicks first. */
    const rows = $$('table.an-sr tbody tr', chart);
    expect(rows).toHaveLength(bubbles.length);
    expect($$('th, td', rows[0]).map(c => c.textContent).slice(0, 3)).toEqual(['domain-a.example', 'VN', '18,420']);
    expect($('table.an-sr caption')?.textContent).toBe('Traffic against cost, 28 days: every site in the chart');
    /* Only a few are labelled directly, and the legend says what colour and size mean. */
    const labels = $$('.an-labels text', chart).map(t => t.textContent);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThanOrEqual(6);
    expect($$('.an-legend li', chart).map(li => li.textContent)).toEqual(['Within budget', 'Over 80% of budget', 'Blocked or not reachable', 'Bubble size: tokens used', '17 sites with no clicks or spend are not drawn']);
  });

  it('shows a site\'s numbers on focus, moves with the arrow keys and hides them on Escape', async () => {
    resetStore();
    st().signIn(meFor('admin'));
    await mount(<Overview />);
    expect($('.an-tip')).toBeNull();
    const a = $<SVGGElement>('.an-bub[data-site="a"]')!;
    await act(async () => { a.focus(); });
    expect($('.an-tip b')?.textContent).toBe('domain-a.example');
    expect($$('.an-tip dt').map(d => d.textContent)).toEqual(['Organic clicks', 'Agent spend', 'Tokens', 'Clicks per $1']);
    expect($('.an-tip dd')?.textContent).toBe('18,420');
    await fire(a, 'keydown', { key: 'ArrowRight' });
    /* The next site by clicks. */
    expect(document.activeElement?.getAttribute('data-site')).toBe('b');
    expect($('.an-tip b')?.textContent).toBe('domain-b.example');
    expect($$('.an-bub[tabindex="0"]').map(b => b.dataset.site)).toEqual(['b']);
    await fire(document.activeElement!, 'keydown', { key: 'Escape' });
    expect($('.an-tip')).toBeNull();
  });

  it('has one ranked list, one stacked bar and one budget list, and no rings', async () => {
    resetStore();
    st().signIn(meFor('admin'));
    await mount(<Overview />);
    expect($$('.ring, .meters, .bars')).toEqual([]);
    expect($$('.an-rank')).toHaveLength(1);
    expect($$('.an-rank li').map(li => li.querySelector('.an-rank-d')?.textContent).slice(0, 2)).toEqual(['domain-a.example', 'domain-b.example']);
    expect($('.an-rank li.other')?.textContent).toMatch(/^\+Other 112 sites/);
    expect($$('.an-stack')).toHaveLength(1);
    const budget = section('Spend today against the daily budget')!;
    expect($$('.an-budget li', budget)).toHaveLength(8);
    expect($$('.an-budget li .pill', budget).map(p => p.textContent)).toEqual(['Over 80%']);
    expect(budget.querySelector('.an-desc')?.textContent).toBe('1 site is over 80%. None has stopped.');
    expect(text()).toContain('How this is worked out');
  });

  it('says "All clear" when nothing needs attention', async () => {
    resetStore();
    st().signIn(meFor('admin'));
    useStore.setState(d => { d.sites = d.sites.filter(x => x.id === 'a'); });
    await mount(<Overview />);
    expect($('.an-clear')?.textContent).toBe('check_circleAll clear. No site is near its budget, blocked or spending without traffic.');
    expect(section('Needs attention')).toBeNull();
    expect($$('.an-insight')).toEqual([]);
  });
});

describe('Overview with little data', () => {
  it('one site with spend and no Search Console: a comparison card, no chart, no ranked list, and the next step', async () => {
    live([site('a', 'kopi.example')], { budget: 25, day: 0, sites: { a: use(3.42, 14.8, 412_000) }, agents: AGENTS });
    await mount(<Overview />);
    const centre = section('Traffic against cost')!;
    expect($$('svg, .an-bub, table', centre)).toEqual([]);
    expect($$('.an-site', centre)).toHaveLength(1);
    expect($$('.an-stat', centre).map(x => x.textContent)).toEqual(['Organic clicksNot measured', 'Agent spend$14.80', 'Tokens used412.0k', 'Clicks per $1—']);
    /* One site has nothing to be compared with: no bars. */
    expect($$('.an-stat-bar', centre)).toEqual([]);
    expect(section('Top sites')).toBeNull();
    const card = $('.an-insight')!;
    expect(card.querySelector('h3')?.textContent).toBe('Clicks are not measured yet.');
    expect(card.querySelector('button')?.textContent).toBe('Connect Search Console');
    expect($('.an-kpi-v')?.textContent).toBe('—');
    expect(text()).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('two sites with clicks: side by side with bars on a shared scale, and spend without clicks is flagged', async () => {
    live([site('a', 'kopi.example'), site('b', 'teh.example')], { budget: 25, day: 0, sites: { a: use(6.5, 62.25, 1_250_000), b: use(2.4, 26, 309_000) }, agents: AGENTS }, { a: 4210, b: 0 });
    await mount(<Overview />);
    const centre = section('Traffic against cost')!;
    expect($$('svg', centre)).toEqual([]);
    expect($$('.an-site-h b', centre).map(b => b.textContent)).toEqual(['kopi.example', 'teh.example']);
    expect($$('.an-site', centre).map(c => $$('dd', c).map(d => d.textContent))).toEqual([['4,210', '$62.25', '1.25M', '68'], ['0', '$26.00', '309.0k', '—']]);
    expect($$<HTMLElement>('.an-stat-bar i', centre).map(i => i.style.width).slice(0, 4)).toEqual(['100%', '100%', '100%', '0%']);
    expect($$('.an-insight h3').map(h => h.textContent)).toEqual(['teh.example has agent spend but no clicks.']);
    expect($$('.an-kpi-v').map(v => v.textContent)).toEqual(['4,210', '$8.90', '1.56M', '48']);
  });

  it('three sites with clicks and spend: the chart, every bubble named, no median guides', async () => {
    live([site('a', 'kopi.example'), site('b', 'teh.example'), site('c', 'susu.example')],
      { budget: 25, day: 0, sites: { a: use(20.5, 62.25, 1_250_000), b: use(25.4, 26, 309_000), c: use(4.1, 38.4, 640_000) }, agents: AGENTS }, { a: 4210, b: 380, c: 1620 });
    await mount(<Overview />);
    const centre = section('Traffic against cost')!;
    expect($$('.an-bub', centre)).toHaveLength(3);
    expect($$('.an-labels text', centre).map(t => t.textContent).sort()).toEqual(['kopi.example', 'susu.example', 'teh.example']);
    expect($$('.an-quad line, .an-quad text', centre)).toEqual([]);
    expect(centre.querySelector('.an-desc')?.textContent).not.toContain('median');
    expect($$('.an-rank li')).toHaveLength(3);
    expect($$('.an-insight h3').map(h => h.textContent)).toEqual(['teh.example has used the daily budget of $25.00.', 'kopi.example is over 80% of the daily budget.']);
  });

  it('a site with nothing measured: one empty state with the next action, and none for someone who cannot connect', async () => {
    live([site('a', 'kopi.example')], { budget: 25, day: 0, sites: {}, agents: {} });
    await mount(<Overview />);
    expect($$('.empty h3').map(h => h.textContent)).toEqual(['Nothing measured yet']);
    expect($('.empty button')?.textContent).toBe('extensionConnect Search Console');
    expect($$('section')).toEqual([]);
    live([site('a', 'kopi.example')], { budget: 25, day: 0, sites: {}, agents: {} }, null, 'viewer');
    await mount(<Overview />);
    expect($('.empty button')).toBeNull();
  });

  it('spend in the last 28 days but none today: the budget and agent cards say so instead of drawing', async () => {
    live([site('a', 'kopi.example')], { budget: 25, day: 0, sites: { a: use(0, 14.8, 412_000) }, agents: {} });
    await mount(<Overview />);
    expect($$('.empty h3').map(h => h.textContent)).toEqual(['No agent has used tokens today', 'No agent spend today']);
    expect($$('.an-stack, .an-budget')).toEqual([]);
    expect($$('.an-site')).toHaveLength(1);
  });
});

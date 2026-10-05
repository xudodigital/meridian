// @vitest-environment jsdom
/* Real spend and tokens on screen, outside demo mode: the Analytics overview drawn from the server's ledger, the
   "Spend today" column of Sites, "Tokens today" on the Workspace, the enforced budget in Settings, and a waiting job
   of a site that used its budget shown as "Waiting for budget". */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverArticle } from '@/store/articleFixtures';
import { buildWire } from '@/store/buildFixtures';
import { spendWireTo } from '@/store/live';
import { photoJob, req, withPhotos } from '@/store/liveAgentFixtures';
import { liveApply } from '@/store/liveApply';
import { serverFactsTo } from '@/store/serverFacts';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { Role, Site, SpendWire } from '@/store/types';
import { Analytics } from '../Analytics';
import { Deploy } from '../Deploy';
import { Settings } from '../Settings';
import { Sites } from '../Sites';
import { Workspace } from '../Workspace';
import { ArticlePhotos } from '../content/ArticlePhotos';
import { KwRequests } from '../research/KwRequests';

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
const change = (fn: () => void) => act(async () => { fn(); });
const mount = async (node: ReactNode) => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); }
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => { root?.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>); });
};
const section = (h: string) => $$('section').find(s => s.querySelector('h2')?.textContent?.startsWith(h)) ?? null;

const site = (id: string, domain: string): Site =>
  ({ id, domain, country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
const SPEND: SpendWire = {
  budget: 25, day: 0,
  sites: { a: { today: 20.5, tokensToday: 40_000, d7: 31, d28: 62.25, tokens28: 1_250_000 }, b: { today: 25.4, tokensToday: 9000, d7: 26, d28: 26, tokens28: 9000 } },
  agents: { Keyword: { tokens: 1500, cost: 0.12, runs: 1 }, 'Content Writer': { tokens: 45_000, cost: 3.4, runs: 4 }, 'Site Builder': { tokens: 3500, cost: 0.3, runs: 2 } },
};
/** Outside demo mode, signed in, the server answering, three sites: one under budget, one over it, one that spent nothing. */
const live = (role: Role = 'admin', spend: SpendWire | null = SPEND) => {
  resetStore(false);
  st().signIn(meFor(role));
  useStore.setState(d => {
    d.sync = { loaded: true, error: '' };
    d.live.on = true;
    d.live.engine = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.284 (Claude Code)', ready: true, reason: '' };
    d.sites.push(site('a', 'kopi.example'), site('b', 'teh.example'), site('c', 'susu.example'));
    d.live.spend = spend;
    liveApply(d); serverFactsTo(d); d.live.ready = true;
  });
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  vi.unstubAllGlobals();
});

describe('Analytics with real spend', () => {
  it('shows the sums of the ledger: figures, sites side by side, tokens per agent and spend against the budget', async () => {
    live();
    await mount(<Analytics />);
    /* Search Console is not connected, so clicks are unknown: a dash, never a zero that looks measured. */
    expect($$('.an-kpi').map(t => [t.querySelector('.an-kpi-l')?.textContent, t.querySelector('.an-kpi-v')?.textContent, t.querySelector('.an-kpi-s')?.textContent])).toEqual([
      ['Organic clicks, 28 days', '—', 'Search Console is not connected'],
      ['Agent spend today', '$45.90', '61% of $75.00: 3 sites at $25.00 a day'],
      ['Tokens used, 28 days', '1.26M', '$88.25 of agent spend'],
      ['Clicks per $1 of agent spend', '—', 'Shown once sites have both clicks and spend'],
    ]);
    /* Two sites have numbers: too few for a chart, so they stand side by side, and there is no ranked list. */
    const centre = section('Traffic against cost')!;
    expect($$('svg', centre)).toEqual([]);
    expect($$('.an-site', centre).map(c => [c.querySelector('.an-site-h b')?.textContent, ...$$('dd', c).map(d => d.textContent)])).toEqual([
      ['kopi.example', 'Not measured', '$62.25', '1.25M', '—'], ['teh.example', 'Not measured', '$26.00', '9.0k', '—'],
    ]);
    expect(section('Top sites')).toBeNull();
    /* Spend today: the sites that spent, highest share of the budget first; the one over it is stopped. */
    const spend = section('Spend today against the daily budget')!;
    expect($$('.an-budget li', spend).map(m => [m.querySelector('.an-b-d')?.textContent, m.querySelector('.an-b-amt')?.textContent, m.querySelector('.pill')?.textContent ?? '', m.querySelector('.an-b-track')?.getAttribute('aria-label')]))
      .toEqual([['teh.example', '$25.40 of $25.00', 'Stopped', 'teh.example used 101 percent of its budget'], ['kopi.example', '$20.50 of $25.00', 'Over 80%', 'kopi.example used 82 percent of its budget']]);
    expect(spend.querySelector('.an-desc')?.textContent).toBe('2 sites are over 80%. 1 has stopped.');
    expect(spend.textContent).toContain('new agent jobs for it are refused and the waiting ones are held until midnight');
    /* Tokens per agent today: the three agents the server runs, largest share first, with what the ledger says they cost. */
    const agents = section('Token use by agent, today')!;
    expect($$('.an-table tbody tr', agents).map(r => [r.querySelector('th span span')?.textContent, ...$$('td', r).slice(1).map(d => d.textContent)])).toEqual([
      ['Content Writer', '45.0k', '$3.40 · 4 runs', '90%'], ['Site Builder', '3.5k', '$0.30 · 2 runs', '7%'], ['Keyword', '1.5k', '$0.12 · 1 run', '3%'],
    ]);
    expect(agents.querySelector('.an-stack')?.getAttribute('aria-label')).toBe('Share of today\'s tokens: Content Writer 90%, Site Builder 7%, Keyword 3%');
    expect(text()).toContain('Every run of an agent job is recorded');
    expect(text()).not.toMatch(/simulat|prototype|not charted here yet/i);
  });

  it('says which site is stopped, how many jobs wait, and how to start them', async () => {
    live();
    await change(() => useStore.setState(d => {
      d.live.reqs[1] = req(1, { siteId: 'b', domain: 'teh.example', status: 'queued', step: '', startedAt: null });
      d.live.arts[5] = withPhotos(serverArticle(5, { siteId: 'b', domain: 'teh.example' }), photoJob());
      liveApply(d);
    }));
    await mount(<Analytics />);
    const note = $$('.an-insight').find(c => c.textContent?.includes('daily budget'))!;
    expect(note.textContent).toContain('teh.example has used the daily budget of $25.00.');
    expect(note.textContent).toContain('New agent jobs for it are refused and 2 waiting jobs are held until midnight.');
    expect(note.querySelector('button')?.textContent).toBe('Open Settings');
    /* Someone who cannot change Settings is told who can. */
    live('viewer');
    await mount(<Analytics />);
    const forViewer = $$('.an-insight').find(c => c.textContent?.includes('daily budget'))!;
    expect(forViewer.textContent).toContain('An admin can raise the budget in Settings');
    expect(forViewer.querySelector('button')).toBeNull();
  });

  it('draws nothing while nothing was measured, and says what will appear', async () => {
    live('admin', { budget: 40, day: 0, sites: {}, agents: {} });
    await mount(<Analytics />);
    expect($$('.ring, .bars, .meters, .an svg, .an-stack, .an-budget, .an-rank')).toEqual([]);
    /* One empty state for the whole screen instead of an empty box per chart. */
    expect($$('.empty').map(e => e.querySelector('h3')?.textContent)).toEqual(['Nothing measured yet']);
    expect(text()).toContain('measured here against its daily budget of $40.00');
    expect($('.empty button')?.textContent).toBe('extensionConnect Search Console');
    expect($$('.an-insight')).toEqual([]);
  });

  it('follows the server: a `spend` event redraws it, and a raised budget lifts the stop', async () => {
    live();
    await mount(<Analytics />);
    expect(text()).toContain('teh.example has used the daily budget');
    await change(() => spendWireTo({ ...SPEND, budget: 50 }));
    expect(text()).not.toContain('has used the daily budget');
    expect($$('.an-b-amt').map(p => p.textContent)).toEqual(['$25.40 of $50.00', '$20.50 of $50.00']);
    expect($$('.an-budget .pill')).toEqual([]);
    expect(st().sites.find(x => x.id === 'a')).toMatchObject({ spend: 20.5, tok28: 1.25 });
    /* A new day: the server sends empty sums. */
    await change(() => spendWireTo({ budget: 50, day: 1, sites: {}, agents: {} }));
    expect(text()).toContain('Nothing measured yet');
    expect(st().agents.every(a => a.tokens === 0)).toBe(true);
  });
});

describe('spend on the other screens', () => {
  it('Sites has a "Spend today" column with the stop marked, and no column while the server has not sent spend', async () => {
    live();
    await mount(<Sites />);
    expect($$('th').map(h => h.textContent)).toContain('Spend today');
    const cell = (domain: string) => $$('tbody tr').find(r => r.textContent?.includes(domain))?.querySelector('td[data-label="Spend today"]')?.textContent;
    expect([cell('kopi.example'), cell('teh.example'), cell('susu.example')]).toEqual(['$20.50', '$25.40 Budget used', '$0.00']);
    live('admin', null);
    await mount(<Sites />);
    expect($$('th').map(h => h.textContent)).not.toContain('Spend today');
  });

  it('the Workspace counts the tokens used today next to the other counters', async () => {
    live();
    await mount(<Workspace />);
    expect($$('.kpis .kpi .l').map(l => l.textContent)).toEqual(['Working now', 'Needs approval', 'Articles approved', 'Tokens today', 'Errors']);
    expect($('#k-tok')?.textContent).toBe('50K');
    expect($('.kpis')?.className).toBe('kpis five');
  });

  it('Settings says that the budget stops jobs', async () => {
    live();
    await mount(<Settings />);
    expect(text()).toContain('New jobs pause when the daily limit is reached.');
    expect(text()).toContain('Waiting jobs resume at local midnight or when you raise the limit.');
    expect(text()).toContain('A site passes 80% of its budget, or is stopped at 100%');
  });
});

describe('a job that waits for budget', () => {
  it('is shown as "Waiting for budget" in the research requests, and as "Queued" for a site with budget left', async () => {
    live();
    await change(() => useStore.setState(d => {
      d.live.reqs[1] = req(1, { siteId: 'b', domain: 'teh.example', topic: 'teh tarik', status: 'queued', step: '', startedAt: null });
      d.live.reqs[2] = req(2, { siteId: 'a', domain: 'kopi.example', topic: 'kopi susu', status: 'queued', step: '', startedAt: null });
      liveApply(d);
    }));
    await mount(<KwRequests />);
    const status = (topic: string) => $$('tbody tr').find(r => r.textContent?.includes(topic))?.querySelector('.pill')?.textContent;
    expect([status('teh tarik'), status('kopi susu')]).toEqual(['Waiting for budget', 'Queued']);
    expect(text()).toContain('teh.example has used its daily budget of $25.00. This job starts after midnight, or when the budget is raised in Settings.');
    /* The budget is raised: the same request is simply queued again. */
    await change(() => spendWireTo({ ...SPEND, budget: 100 }));
    expect(status('teh tarik')).toBe('Queued');
  });

  it('is shown on an article\'s photo job', async () => {
    live();
    const srv = withPhotos(serverArticle(5, { siteId: 'b', domain: 'teh.example' }), photoJob());
    await change(() => useStore.setState(d => { d.live.arts[5] = srv; liveApply(d); }));
    const a = st().articles.find(x => x.id === 'a5')!;
    await mount(<ArticlePhotos a={a} srv={srv} />);
    expect($$('.pill').map(p => p.textContent)).toContain('Waiting for budget');
    expect(text()).not.toContain('Waiting in the queue.');
    await change(() => spendWireTo({ ...SPEND, budget: 100 }));
    expect($$('.pill').map(p => p.textContent)).toContain('Queued');
  });

  it('is shown on a site\'s first website build only', async () => {
    live();
    await change(() => useStore.setState(d => {
      d.live.arts[5] = serverArticle(5, { siteId: 'b', domain: 'teh.example', status: 'approved' });
      d.live.builds[1] = buildWire(1, 'b', 'teh.example', 1, { status: 'queued', step: '', startedAt: null, finishedAt: null });
      liveApply(d); serverFactsTo(d);
    }));
    await mount(<Deploy />);
    expect(text()).toContain('Waiting for budget. teh.example has used its daily budget of $25.00.');
    /* A later build calls no model, so it is not held: it waits its turn like any job. */
    await change(() => useStore.setState(d => {
      d.live.builds[1] = buildWire(1, 'b', 'teh.example', 1, { status: 'ready' });
      d.live.builds[2] = buildWire(2, 'b', 'teh.example', 2, { status: 'queued', step: '', startedAt: null, finishedAt: null });
      liveApply(d); serverFactsTo(d);
    }));
    expect(text()).not.toContain('Waiting for budget');
    expect(text()).toContain('Waiting in the queue.');
  });
});

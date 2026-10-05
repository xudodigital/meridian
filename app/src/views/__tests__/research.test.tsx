// @vitest-environment jsdom
/* Smoke tests for the research group: Research and SEO (with keyword requests in simulation and live mode),
   Site architecture, Internal link engine, Experiments and Rank tracking. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveApply } from '@/store/live';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { EngineStatus, ServerRequest } from '@/store/types';
import { Architecture } from '../Architecture';
import { Experiments } from '../Experiments';
import { Links } from '../Links';
import { Rank } from '../Rank';
import { Research } from '../Research';

const disconnect = vi.fn();
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  /* jsdom has no canvas and no ResizeObserver: the graph runs its layout without drawing. */
  window.HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() { disconnect(); } };
});

let root: Root | null = null;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const byText = (sel: string, text: string) => $$(sel).find(e => e.textContent === text) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const type = async (el: HTMLInputElement | null, value: string) => {
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const submit = async (form: Element | null) => { expect(form).not.toBeNull(); await act(async () => { form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); await settle(); };
const mount = async (node: ReactNode) => {
  document.body.innerHTML = '<div id="root"></div>';
  const el = document.getElementById('root');
  if (!el) throw new Error('no root');
  root = createRoot(el);
  await act(async () => { root?.render(node); });
};
const sheet = () => $('dialog[open]');

beforeEach(() => {
  resetStore();
  useStore.getState().signIn(meFor('admin', 'Dana Admin', 'admin@example.com'));
});
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  vi.unstubAllGlobals();
});

describe('Research and SEO', () => {
  it('renders the tabs and the module table of each tab', async () => {
    await mount(<Research />);
    expect($$('.tabs [role="tab"]').map(b => b.textContent)).toEqual(['Research', 'Keywords', 'SEO/GEO', 'AI Overview', 'Calls to action', 'Architecture', 'Internal links', 'Experiments']);
    expect($('.tabs')?.getAttribute('aria-label')).toBe('Research and SEO sections');
    expect($('.lede')?.textContent).toMatch(/^The Research agent maps competitors/);
    expect($$('thead th').map(t => t.textContent)).toEqual(['Research topic', 'Site', 'Source', 'Finding', 'Status']);
    await click(byText('.tabs [role="tab"]', 'Calls to action'));
    expect(useStore.getState().rctab).toBe('cta');
    expect($('.lede')?.textContent).toMatch(/^The CTA router picks/);
    expect(byText('button', 'addNew research request')).toBeNull();
  });

  it('queues a simulated keyword request that the Keyword agent picks up', async () => {
    useStore.getState().setRctab('keywords');
    await mount(<Research />);
    expect($('.callout')).toBeNull();
    await click(byText('button', 'addNew research request'));
    expect(sheet()?.querySelector('h2')?.textContent).toBe('New research request');
    expect(sheet()?.querySelector('.dd')?.getAttribute('aria-label')).toBe('Site: domain-a.example (Vietnam)');

    await type($<HTMLInputElement>('#krTopic'), '   ');
    await submit($('dialog[open] form'));
    expect($('#formMsg')?.textContent).toBe('Enter a topic or a few seed keywords.');

    await type($<HTMLInputElement>('#krTopic'), 'cold brew');
    await submit($('dialog[open] form'));
    expect(sheet()).toBeNull();
    const s = useStore.getState();
    expect(s.kwReqs[0]).toMatchObject({ site: 'a', topic: 'cold brew', goal: 'Find a new topic cluster', st: 'queued' });
    expect(s.log[0]).toMatchObject({ act: 'Requested keyword research: cold brew', site: 'a' });
    expect(s.snackMsg?.msg).toBe('Request sent. The Keyword agent takes it when it is free.');
    expect(byText('section h2', 'Research requests')).not.toBeNull();
    expect($$('thead th').slice(0, 5).map(t => t.textContent)).toEqual(['Topic', 'Site', 'Goal', 'Requested', 'Status']);
    expect(byText('.pill', 'Queued')).not.toBeNull();

    expect(useStore.getState().addKwRequest({ siteId: 'a', topic: 'Cold Brew', goal: 'x' })).toBe('This request is already in the queue for that site.');

    await act(async () => {
      useStore.setState(d => { const k = d.agents.find(a => a.id === 'kw'); if (k) { k.status = 'idle'; k.req = null; } });
      useStore.getState().tick();
    });
    expect(useStore.getState().kwReqs[0]?.st).toBe('work');
    expect(byText('.pill', 'In progress')).not.toBeNull();
  });

  it('refuses the request form for a viewer', async () => {
    useStore.getState().signIn(meFor('viewer', 'Viewer', 'viewer@example.com'));
    useStore.getState().setRctab('keywords');
    await mount(<Research />);
    await click(byText('button', 'addNew research request'));
    expect(sheet()).toBeNull();
    expect(useStore.getState().snackMsg?.msg).toBe('View-only role. Ask an admin to make changes.');
  });
});

describe('Research and SEO in live mode', () => {
  const engineOff: EngineStatus = { mode: 'none', keyConfigured: false, apiVersion: '', ready: false, reason: 'The Claude Code CLI was not found on this computer.' };
  /* Live mode is outside demo mode: the workspace has one real site. */
  beforeEach(() => {
    resetStore(false);
    useStore.getState().signIn(meFor('admin', 'Dana Admin', 'admin@example.com'));
    useStore.setState(d => { d.sites.push({ id: 'a', domain: 'domain-a.example', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 }); });
  });
  const req = (id: number, over: Partial<ServerRequest>): ServerRequest => ({
    id, siteId: 'a', domain: 'domain-a.example', topic: 'topic ' + id, goal: 'Find a new topic cluster', status: 'queued', engine: '', step: '', summary: '',
    notes: '', error: '', tokens: 0, costUsd: 0, createdAt: Date.UTC(2026, 9, 2, 8, id), startedAt: null, finishedAt: null, keywords: [], ...over,
  });
  const goLive = (engine: EngineStatus, reqs: ServerRequest[]) => useStore.setState(d => {
    d.live.on = true; d.live.engine = engine; reqs.forEach(r => { d.live.reqs[r.id] = r; }); liveApply(d); d.live.ready = true; d.rctab = 'keywords';
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('shows the engine callout, the requests table and the result sheet', async () => {
    goLive(engineOff, [
      req(1, { status: 'done', engine: 'openai-api', summary: 'Three ideas.', notes: 'No volumes.', tokens: 1200, startedAt: 1000, finishedAt: 5000,
        keywords: [{ keyword: '<script>alert(1)</script>', meaning: 'test', intent: 'Informational', cluster: 'Brewing', basis: 'Seed' }] }),
      req(2, { status: 'failed', engine: 'openai-api', error: 'The CLI stopped.' }),
      req(3, { status: 'work', engine: 'openai-api', step: 'Reading the site profile' }),
    ]);
    await mount(<Research />);
    expect($('.callout.warn p')?.textContent).toBe('OpenAI is not connected. Add and test the API key in Integrations, then try again. Until then requests are refused, so nothing is made up. Check again');
    expect(document.body.textContent).not.toMatch(/simulat|placeholder/i);
    const tables = $$('table');
    expect([...tables[0].querySelectorAll('th')].map(t => t.textContent)).toEqual(['Topic', 'Site', 'Goal', 'Requested', 'Status', 'Done by', 'Actions']);
    const rows = [...tables[0].querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
    expect(rows.map(r => r[0])).toEqual(['topic 3', 'topic 2', 'topic 1']);
    expect(rows[0][4]).toBe('In progress Reading the site profile');
    expect(rows.map(r => r[5])).toEqual(['OpenAI', 'OpenAI', 'OpenAI']);
    expect(rows.map(r => r[6])).toEqual(['', 'View error', 'View result']);

    /* The finished request's keywords lead the Keywords table, as text. Volume and difficulty have no data source
       yet, so their "n/a" columns are not drawn (ModTable). */
    const kw = [...tables[1].querySelectorAll('tbody tr')][0];
    expect([...kw.querySelectorAll('td')].map(td => td.textContent)).toEqual(['<script>alert(1)</script>', 'VN · domain-a.example', 'test', 'Informational', 'Brewing']);
    expect(document.querySelector('script')).toBeNull();

    await click(byText('button', 'View result'));
    expect(sheet()?.querySelector('h2')?.textContent).toBe('topic 1');
    expect([...(sheet()?.querySelectorAll('.tag') ?? [])].map(t => t.textContent)).toEqual(['languagedomain-a.example', 'smart_toyOpenAI', 'timer4s', 'toll1,200 tokens']);
    expect(sheet()?.querySelector('td b')?.textContent).toBe('<script>alert(1)</script>');
    expect(sheet()?.querySelector('p.note')?.textContent).toBe('No volumes.');

    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await click(byText('dialog[open] button', 'refreshRun again'));
    await settle();
    /* Who asked comes from the session on the server: the body names nobody. */
    expect(fetchMock).toHaveBeenCalledWith('/api/requests/1/retry', expect.objectContaining({ method: 'POST', body: '{}', headers: expect.objectContaining({ 'x-meridian': '1' }) }));
    expect(useStore.getState().snackMsg?.msg).toBe('Request queued again.');
    expect(sheet()).toBeNull();

    await click(byText('button', 'View error'));
    expect(sheet()?.querySelector('.callout.warn')?.textContent).toBe('errorThe CLI stopped.');
  });

  it('sends a request through the server and shows its refusal in the form', async () => {
    goLive({ ...engineOff, mode: 'openai-api', ready: true, keyConfigured: true, apiVersion: '2.1.0', reason: '' }, []);
    await mount(<Research />);
    expect($('.callout p')?.textContent).toBe('Live mode. Requests are done by the Keyword agent through OpenAI Responses API. Search volume is not shown: connect DataForSEO in Integrations to add it. Keyword difficulty is not shown.');

    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'The queue is full.' }, 409)));
    await click(byText('button', 'addNew research request'));
    await type($<HTMLInputElement>('#krTopic'), 'phin filters');
    await submit($('dialog[open] form'));
    expect($('#formMsg')?.textContent).toBe('The queue is full.');
    expect(byText('dialog[open] button', 'Send to Keyword agent')?.hasAttribute('disabled')).toBe(false);

    const fetchMock = vi.fn(async () => json({ request: req(9, {}) }));
    vi.stubGlobal('fetch', fetchMock);
    await submit($('dialog[open] form'));
    expect(sheet()).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/requests');
    expect(JSON.parse(String(init.body))).toMatchObject({ siteId: 'a', domain: 'domain-a.example', topic: 'phin filters', goal: 'Find a new topic cluster' });
    expect(JSON.parse(String(init.body))).not.toHaveProperty('by');
    /* The server writes the audit log for this, under the session's person; the page adds nothing of its own. */
    expect(useStore.getState().log).toEqual([]);
    expect(useStore.getState().snackMsg?.msg).toBe('Request sent to the Keyword agent.');
  });

  it('checks the engine again', async () => {
    goLive(engineOff, []);
    await mount(<Research />);
    vi.stubGlobal('fetch', vi.fn(async () => json({ engine: { ...engineOff, mode: 'openai-api', ready: true, keyConfigured: true, apiVersion: '2.1.0', reason: '' } })));
    await click(byText('button', 'Check again'));
    await settle();
    expect(useStore.getState().snackMsg?.msg).toBe('OpenAI is connected. Agents can run.');
    expect($('.callout p b')?.textContent).toBe('Live mode.');
  });
});

describe('Site architecture', () => {
  it('shows the silo tree and the silos table', async () => {
    await mount(<Architecture />);
    expect($('.lede')?.textContent).toBe('The Architect agent plans silos and pillar pages for each site.');
    expect($('section .sh h2')?.textContent).toBe('Silo tree for domain-a.example');
    expect($$('.stree li')).toHaveLength(5);
    expect($('.st-pillar .note')?.textContent).toBe('/cach-pha/ · 18 pages · click depth 2');
    const leaves = $('.st-leaves');
    expect(leaves?.querySelectorAll('i')).toHaveLength(18);
    expect(leaves?.getAttribute('role')).toBe('img');
    expect(byText('h2', 'Silos')).not.toBeNull();
    expect(byText('p.note', 'Showing the first site. Pick a site in the top bar to see its tree. Each small block is one page.')).not.toBeNull();

    await act(async () => { useStore.getState().setSiteFilter('c'); });
    expect($('section .sh h2')?.textContent).toBe('Silo tree for domain-c.example');
    expect(byText('.st-pillar .pill', '4 orphan pages')).not.toBeNull();
    expect($$('.stree .pg.o')).toHaveLength(4);
    expect(byText('p.note', 'Each small block is one page under its pillar.')).not.toBeNull();
  });
});

describe('Internal links', () => {
  it('builds the graph, selects nodes, switches mode and cleans up', async () => {
    await mount(<Links />);
    expect($('.lede')?.textContent).toMatch(/^Pages and the links between them/);
    expect($$('#legend span').map(s => s.textContent)).toEqual(['Home', 'Pillar page', 'Article', 'Orphan page']);
    expect($('#gnote')?.textContent).toBe('Showing domain-a.example. Pick another site at the top; links are never created between sites.');
    const groups = $$('#tree summary').map(s => s.textContent);
    expect(groups).toHaveLength(7);
    expect([groups[0], groups[1]?.replace(/\d+/, 'n'), groups[6]]).toEqual(['domain-a.example (1)', 'Brewing (n)', 'Orphan pages (3)']);
    expect($('#ginfo')?.textContent).toBe('Hover a node, or pick a page from the list.');

    await click(byText('#tree button', 'Orphan page 2'));
    expect(byText('#tree button', 'Orphan page 2')?.className).toBe('on');
    expect($('#ginfo')?.textContent).toBe('Orphan page 2 · Orphan page · 0 connections. No page links here yet. The Internal Linker can propose a link from a relevant pillar page.');

    disconnect.mockClear();
    await click(byText('[role="tab"]', 'Agents'));
    expect(useStore.getState().gmode).toBe('agent');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect($('[role="tab"][aria-selected="true"]')?.textContent).toBe('Agents');
    expect($$('#legend span').map(s => s.textContent)).toContain('Skill');
    expect($$('#tree summary').map(s => s.textContent?.replace(/ \(\d+\)$/, ''))).toEqual(['Sites', 'Agents', 'Attached skills']);
    expect($('#gnote')?.textContent).toBe('A line to a site appears while an agent is working on it.');
    expect($('#ginfo')?.textContent).toBe('Hover a node, or pick a page from the list.');

    /* A tick does not rebuild the graph, so a selection survives it. */
    await click(byText('#tree button', 'Orchestrator'));
    await act(async () => { useStore.getState().tick(); });
    expect(byText('#tree button', 'Orchestrator')?.className).toBe('on');
  });

  it('says when the site has no pages yet', async () => {
    useStore.getState().setSiteFilter('e');
    await mount(<Links />);
    expect($('#gnote')?.textContent).toBe('domain-e.example has no link map yet. Mapping the links between a site\'s pages is planned; the Agents tab shows how agents and skills connect today.');
    expect($('#tree p.note')?.textContent).toBe('No pages yet.');
  });
});

describe('Experiments', () => {
  it('shows the lede and the experiments table, filtered by site', async () => {
    await mount(<Experiments />);
    expect($('.lede')?.textContent).toBe('Agents propose hypotheses and variants. Results are measured from data, not guessed by the model.');
    expect($$('tbody tr')).toHaveLength(4);
    await act(async () => { useStore.getState().setSiteFilter('b'); });
    expect($$('tbody tr')).toHaveLength(2);
  });
});

describe('Rank tracking', () => {
  it('shows the heat map, the tracked keywords and the Search Console callout', async () => {
    await mount(<Rank />);
    expect(byText('h2', 'Position change by country and intent, 7 days')).not.toBeNull();
    expect($$('.heat .hh .full').map(s => s.textContent)).toEqual(['Informational', 'Commercial', 'Transactional', 'Local', 'Long-tail']);
    const countries = $$('.heat .hr').map(s => s.textContent);
    expect(countries[0]).toBe('BDBangladesh');
    expect(countries).toEqual([...countries].sort((x, y) => x.slice(2).localeCompare(y.slice(2))));
    expect($$('.heat .hc')[0]?.textContent).toMatch(/^[+−]?\d+\.\d$/);
    expect(byText('h2', 'Tracked keywords')).not.toBeNull();
    expect($('.callout')).toBeNull();

    await act(async () => { useStore.getState().revokeKey('gsc'); });
    expect($('.callout.warn p')?.textContent).toBe('Google Search Console is not connected. These numbers are the last data received and are no longer updating.');
  });
});

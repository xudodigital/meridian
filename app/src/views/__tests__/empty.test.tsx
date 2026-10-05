// @vitest-environment jsdom
/* The app outside demo mode: every view renders with nothing in it and says what to do next, never says "simulated"
   or "prototype", the demo mode switch, Reset workspace, research requests whose site is not in the store, Claude
   through Claude Code, and the first-run path from an empty app to a research result. The server is a fake (fakeApi). */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi } from '@/store/fakeApi';
import { liveApply, queryClient } from '@/store/live';
import { QueryClientProvider } from '@tanstack/react-query';
import { MOD_EMPTY } from '@/store/rules';
import { docOf } from '@/store/workspace';
import { NO_SERVER } from '@/store/slices/research';
import { NO_PROBE } from '@/store/slices/sites';
import { serverFactsTo } from '@/store/serverFacts';
import { KEY_DEMO } from '@/store/storage';
import { useStore } from '@/store/store';
import { makeState, meFor, resetStore } from '@/store/testing';
import type { AccessWire, AliasId, EngineStatus, IntegrationWire, ServerRequest, ViewId } from '@/store/types';
import { Analytics } from '../Analytics';
import { Architecture } from '../Architecture';
import { Audit } from '../Audit';
import { Deploy } from '../Deploy';
import { Experiments } from '../Experiments';
import { History } from '../History';
import { Integrations } from '../Integrations';
import { Links } from '../Links';
import { Rank } from '../Rank';
import { Reports } from '../Reports';
import { Research } from '../Research';
import { Review } from '../Review';
import { Settings } from '../Settings';
import { Sites } from '../Sites';
import { Skills } from '../Skills';
import { Team } from '../Team';
import { Workflows } from '../Workflows';
import { Workspace } from '../Workspace';
import { OfficeDisplay } from '../workspace/OfficeDisplay';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  window.HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

let root: Root | null = null;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const st = () => useStore.getState();
const text = () => document.body.textContent ?? '';
const byText = (sel: string, t: string) => $$(sel).find(e => e.textContent === t) ?? null;
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
const unmount = async () => { if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; } };
const mount = async (node: ReactNode) => {
  await unmount();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>); });
};
const change = (fn: () => void) => act(async () => { fn(); });

const engineOn: EngineStatus = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.0', ready: true, reason: '' };
const engineOff: EngineStatus = { mode: 'none', keyConfigured: true, apiVersion: '2.1.0', ready: false, reason: 'Claude Code is installed but not signed in.' };
const req = (id: number, over: Partial<ServerRequest>): ServerRequest => ({
  id, siteId: 'a', domain: 'domain-a.example', topic: 'topic ' + id, goal: 'Find a new topic cluster', status: 'queued', engine: '', step: '', summary: '',
  notes: '', error: '', tokens: 0, costUsd: 0, createdAt: Date.UTC(2026, 9, 2, 8, id), startedAt: null, finishedAt: null, keywords: [], ...over,
});
const goLive = (engine: EngineStatus, reqs: ServerRequest[] = []) => change(() => useStore.setState(d => {
  d.live.on = true; d.live.engine = engine; reqs.forEach(r => { d.live.reqs[r.id] = r; }); liveApply(d); d.live.ready = true;
}));
const wire = (id: string, over: Partial<IntegrationWire> = {}): IntegrationWire => ({
  id, name: st().ints.find(n => n.id === id)?.name ?? id, connected: false, tail: '', status: '', msg: '', testedAt: null, updatedAt: null, updatedBy: '',
  config: {}, fields: [{ k: 'key', label: 'API key', secret: true }], oauth: false, worksWithout: '', help: '', ...over,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const addSite = (domain = 'kopi.example') => st().addSite({ domain, country: 0, lang: 'Vietnamese', topic: 'Coffee', status: 'live' });

let api: FakeApi;
beforeEach(() => {
  localStorage.clear();
  resetStore(false);
  st().signIn(meFor('admin', 'Owner', 'owner@example.com'));
  api = new FakeApi()
    .on('GET', '/api/users', () => ({ users: [{ id: '1', name: 'Owner', email: 'owner@example.com', role: 'admin', site: null, created: 1, disabled: false, twofa: false }], invites: [] }))
    .on('GET', '/api/auth/sessions', () => ({ sessions: [{ id: '7', device: 'Chrome on macOS', created: 1, lastSeen: Date.now(), current: true }] }))
    .on('GET', '/api/report', () => ({ report: { from: Date.now() - 7 * 86_400_000, to: Date.now(), rows: [], clicksKnown: false, lastSent: null } }))
    .on('GET', '/api/alerts', () => ({ alerts: [] }))
    .on('GET', '/api/agents/prompts', () => ({ prompts: { kw: 'You are the Keyword agent of Meridian. Topic: {topic}', wr: 'You are the Content Writer agent of Meridian. Keyword: {keyword}' } }));
  vi.stubGlobal('fetch', api.fetch);
  vi.spyOn(console, 'error');
});
afterEach(async () => {
  await unmount();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* Per view: the element and a sentence it must show while there is nothing in it. */
const VIEWS: readonly (readonly [ViewId | AliasId, () => ReactNode, string])[] = [
  ['workspace', () => <Workspace />, 'Create your first article and website.'],
  ['review', () => <Review />, 'No articles to review yetAn article is listed here when the Content Writer finishes it'],
  ['sites', () => <Sites />, 'No sites yetAdd your first domain to get started.'],
  ['workflows', () => <Workflows />, 'No workflow is runningA workflow runs for one site. Add a site first.'],
  ['history', () => <History />, 'No runs yetEvery job an agent finishes is listed here with its cost and log.'],
  ['deploy', () => <Deploy />, 'No domains to check yetAdd a domain in Sites and it is listed here.'],
  ['research', () => <Research />, MOD_EMPTY.research],
  ['architecture', () => <Architecture />, 'The Architect agent, which would plan a site\'s silos, is planned and has no job yet.'],
  ['links', () => <Links />, 'Mapping the links between a site\'s pages is planned'],
  ['experiments', () => <Experiments />, MOD_EMPTY.experiments],
  ['rank', () => <Rank />, 'Search Console is not connectedPositions come from Search Console.'],
  ['analytics', () => <Analytics />, 'No sites to compare yetAdd a domain in Sites.'],
  ['reports', () => <Reports />, 'Nothing to report yetThere are no sites yet.'],
  ['skills', () => <Skills />, 'Model mix'],
  ['team', () => <Team />, 'owner@example.com'],
  ['integrations', () => <Integrations />, 'Not connected'],
  ['audit', () => <Audit />, 'Nothing recorded yetEverything you and the agents do is listed here.'],
  ['settings', () => <Settings />, 'Reset workspace'],
];
/** Visuals that must not be drawn from nothing. */
const VISUALS = 'canvas, .ring, .bars, .heat, .stree, .pipe, .tl, .tlrow, .map';
const ODD = /undefined|NaN|\b0 of 0\b|Infinity|Removed site|\.example/;
/** Words that would mean something is pretended outside demo mode. */
const PRETEND = /simulat|prototype|fake|any email|any 6 digits/i;

describe('every view with nothing in it', () => {
  it('starts from an empty store', () => {
    const s = st();
    expect(s.sample).toBe(false);
    expect([s.sites, s.articles, s.approvals, s.runs, s.schedules, s.deploys, s.jobLog, s.notifs, s.kwReqs]).toEqual([[], [], [], [], [], [], [], [], []]);
    expect(s.log).toEqual([]);
    expect(s.users).toEqual([]);
    expect(s.agents).toHaveLength(11);
  });

  it.each(VIEWS)('%s renders, says what to do next, and pretends nothing', async (_id, view, copy) => {
    await mount(view());
    await settle();
    expect(text()).toContain(copy);
    expect(text().replace('owner@example.com', '')).not.toMatch(ODD);
    expect(text()).not.toMatch(PRETEND);
    expect($$(VISUALS)).toEqual([]);
    expect($$('.pill').map(p => p.textContent)).not.toContain('Highest use');
  });

  it('says on the Office page that nothing happened yet, and counts only what is true', async () => {
    await mount(<OfficeDisplay />);
    expect($('.od-tick li')?.textContent).toBe('No activity yet.');
    /* All built-in agents now have a runner and an idle desk. */
    expect($$('.od-sum li').map(li => li.textContent)).toEqual(['bolt0 working now', 'front_hand0 needs approval', 'coffee11 idle']);
    expect($$('.od .stn')).toHaveLength(11);
    expect($('.office-availability')).toBeNull();
    expect(text()).not.toContain('Demo mode');
    expect(text()).not.toMatch(ODD);
    expect(text()).not.toMatch(PRETEND);
  });

  it('says on Build and deploy where websites come from', async () => {
    await mount(<Deploy />);
    expect($$('h2').map(h => h.textContent)).toEqual(['Watch your next release take shape.', 'Website', 'Needs approval', 'Domain access by country', 'Deploy timeline', 'Deploy history']);
    expect(text()).toContain('No sites yetAdd a domain in Sites. Its website is built here from the articles you approve.');
    expect($('.callout')).toBeNull();
  });

  it('guides an empty workspace before showing operational counters', async () => {
    await mount(<Workspace />);
    expect($('#start-title')?.textContent).toBe('Create your first article and website.');
    expect($('.start-now h3')?.textContent).toBe('Checking your workspace…');
    expect(text()).not.toContain('Live simulation');
    expect($('.kpis')).toBeNull();
    expect($('.starter-monitor')?.hasAttribute('open')).toBe(false);

    await change(() => { addSite(); });
    await goLive(engineOn);
    expect($('.start-now h3')?.textContent).toBe('Give Meridian one topic to research');
    expect($('.start-now button')?.textContent).toContain('Start your first research');
    expect($('.start-site')?.textContent).toContain('kopi.example');
    expect($('.callout')).toBeNull();
  });

  it('reads well on the other tabs and modes too', async () => {
    await change(() => st().setRctab('keywords'));
    await mount(<Research />);
    expect($('.callout.warn')?.textContent).toContain(NO_SERVER);
    expect(text()).toContain('Research is done for one site at a time');
    expect(text()).toContain(MOD_EMPTY.keywords);
    /* Without a site there is nothing to send a request for: the empty state offers Sites instead of the form. */
    expect(byText('button', 'addNew research request')).toBeNull();
    expect(byText('.empty button', 'languageOpen Sites')).not.toBeNull();

    await change(() => st().setAtab('gsc'));
    await mount(<Analytics />);
    expect(text()).toContain('Google Search Console is not connected. Connect it in Integrations to see its data here.');
    expect(text()).toContain(MOD_EMPTY.gsc);

    /* With no site, every mode of Sites is the one empty state; the Themes list is a demo-mode tab. */
    await change(() => st().setSmode('map'));
    await mount(<Sites />);
    expect(text()).toContain('No sites yetAdd your first domain to get started.');
    await change(() => st().setSmode('themes'));
    expect(text()).not.toContain('Themes');
    expect($$('.tabs')).toEqual([]);

    /* Drafts and review modes belong to the demo simulation: outside it an article being written is under Waiting. */
    await change(() => st().setRtab('drafts'));
    await mount(<Review />);
    expect($$('.tabs [role="tab"]').map(b => b.textContent)).toEqual(['Waiting (0)', 'Decided (0)']);
    expect(text()).not.toContain('Review mode by site');
    expect(text()).toContain('No articles to review yet');
  });

  it('shows no invented numbers for a real site', async () => {
    await change(() => { addSite(); });
    await mount(<Rank />);
    expect($$('.heat')).toEqual([]);
    await mount(<Analytics />);
    expect($$('.ring, .bars')).toEqual([]);
    await mount(<Architecture />);
    expect($$('.stree')).toEqual([]);
    expect(text()).toContain('No silo tree yet');
    await mount(<Deploy />);
    /* Until the server says the probe network works, there is no Check now. */
    expect(byText('button', 'Check now')).toBeNull();
    expect(text()).toContain(NO_PROBE);
    /* Nothing is built until an article is approved, and nothing goes live without Cloudflare. */
    expect($('.web-site .web-name .note')?.textContent).toBe('No approved articles yet · Never deployed');
    expect(byText('button', 'constructionBuild website')?.hasAttribute('disabled')).toBe(true);
    expect(text()).toContain('Cloudflare is not connected.');
    expect(text()).toContain('No website builds need approval.');
    expect(text()).toContain('No approved builds yet.');
    expect($$('tbody tr td').map(td => td.textContent)).toContain('Never');
    await mount(<Sites />);
    expect($$('tbody tr')).toHaveLength(1);
    expect(st().runs).toEqual([]);
    expect(st().sites[0]).toMatchObject({ domain: 'kopi.example', status: 'live', access: 'pending', silos: [], spend: 0 });
    expect(st().sites[0]?.token).toBeUndefined();
  });
});

describe('retired demo mode', () => {
  it('removes the control and preserves real sites, sessions and server results', async () => {
    addSite(); await mount(<Settings />);
    expect($('#st-sample')).toBeNull();
    const sites = st().sites, session = st().session;
    await change(() => st().setSampleData(true));
    expect(st().sample).toBe(false); expect(st().sites).toBe(sites); expect(st().session).toBe(session);
    expect(localStorage.getItem(KEY_DEMO)).toBeNull();
  });
  it('clears an old in-memory fixture and its logs when leaving the retired mode', async () => {
    useStore.setState({...makeState(), session:st().session});
    expect(st().log.length).toBeGreaterThan(0);
    await change(() => st().setSampleData(false));
    expect(st().sample).toBe(false);
    expect([st().sites,st().articles,st().log,st().jobLog,st().notifs,st().approvals]).toEqual([[],[],[],[],[],[]]);
  });
});

describe('Reset workspace', () => {
  it('asks for RESET to be typed, then asks the server', async () => {
    api.on('POST', '/api/workspace/reset', () => ({ ok: true }));
    await mount(<Settings />);
    await click(byText('button', 'restart_altReset workspace'));
    expect($('dialog[open] h2')?.textContent).toBe('Reset the workspace?');
    expect($('dialog[open]')?.textContent).toContain('Accounts, research results, articles and the audit log are kept.');
    await type($<HTMLInputElement>('#rsConfirm'), 'reset');
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('Type RESET to confirm.');
    expect(api.to('POST', '/api/workspace/reset')).toEqual([]);
    await type($<HTMLInputElement>('#rsConfirm'), 'RESET');
    await submit($('dialog[open] form'));
    expect($('dialog[open]')).toBeNull();
    const [call] = api.to('POST', '/api/workspace/reset');
    expect(call?.body).toEqual({ confirm: 'RESET' });
    expect(call?.headers['x-meridian']).toBe('1');
    expect(st().snackMsg?.msg).toBe('The workspace was reset.');
  });
});

describe('research requests whose site is not in the store', () => {
  const done = req(1, { status: 'done', engine: 'openai-api', summary: 'One idea.', startedAt: 1000, finishedAt: 5000, keywords: [{ keyword: 'phin', meaning: 'filter', intent: 'Informational', cluster: 'Brewing', basis: 'Seed' }] });

  it('are listed with the domain stored on the request, under "All sites"', async () => {
    await change(() => { addSite(); st().setRctab('keywords'); });
    await goLive(engineOn, [done, req(2, { status: 'work', engine: 'openai-api', domain: 'other.example', siteId: 'zz' })]);
    await mount(<Research />);
    const tables = $$('table');
    const reqRows = [...tables[0].querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
    expect(reqRows.map(r => [r[0], r[1]])).toEqual([['topic 2', 'other.example'], ['topic 1', 'domain-a.example']]);
    expect([...tables[1].querySelectorAll('tbody tr td')].map(td => td.textContent)).toEqual(['phin', 'domain-a.example', 'filter', 'Informational', 'Brewing']);
    /* Volume and difficulty have no data source yet, so their columns are not drawn (ModTable). */
    expect([...tables[1].querySelectorAll('th')].map(th => th.textContent)).toEqual(['Keyword', 'Site', 'Meaning', 'Intent', 'Cluster']);
    expect(text()).not.toContain('Removed site');
    /* The Keyword agent shows the running request without a site. */
    expect(st().agents.find(a => a.id === 'kw')).toMatchObject({ live: true, status: 'work', site: null, task: 'Researching keywords: topic 2' });

    await click(byText('button', 'View result'));
    expect([...($('dialog[open]')?.querySelectorAll('.tag') ?? [])].map(t => t.textContent)).toContain('languagedomain-a.example');
    await click(byText('dialog[open] button', 'Close'));

    await mount(<History />);
    expect($$('tbody tr td')[3]?.textContent).toBe('domain-a.example');

    /* With a site picked in the top bar they are not that site's, so they are hidden. */
    await change(() => st().setSiteFilter(st().sites[0]!.id));
    await mount(<Research />);
    expect($$('table')).toEqual([]);
    expect(text()).not.toContain('topic 1');
  });
});

describe('OpenAI API connection', () => {
  it('stores a key on the server: the card asks to connect, and the sheet sends the key to be saved and tested', async () => {
    const openai = wire('openai', { fields: [{ k: 'key', label: 'API key', secret: true, placeholder: 'sk-test-…' }], help: 'From platform.openai.com > API keys.' });
    await change(() => useStore.setState(d => {
      d.live.ints = { openai, google: wire('google'), ga4: wire('ga4', { oauth: true, fields: [] }), probe: wire('probe', { connected: true, tail: 'Public access', worksWithout: 'Works without a token.' }) };
      serverFactsTo(d);
    }));
    api.on('PUT', '/api/integrations/openai', () => ({
      result: { status: 'ok', msg: 'Connected. The key can use 2 models.' },
      integration: { ...openai, connected: true, tail: '1234', status: 'ok', msg: 'Connected. The key can use 2 models.', updatedAt: 1, testedAt: Date.now() },
    }));
    api.on('POST', '/api/engine/refresh', () => ({ engine: engineOn }));
    await mount(<Integrations />);
    expect($('.callout b')?.textContent).toBe('Keys are encrypted on this computer.');
    const card = () => $$('.card.int')[0]!;
    expect(card().querySelector('h3')?.textContent).toBe('OpenAI API');
    expect(card().querySelector('.pill')?.textContent).toBe('Not connected');
    await click(byText('.card.int button', 'Connect'));
    expect($('dialog[open] h2')?.textContent).toBe('Connect OpenAI API');
    await type($<HTMLInputElement>('#svc-openai-key'), 'sk-test-test-0001234');
    await submit($('dialog[open] form'));
    expect(api.to('PUT', '/api/integrations/openai').map(c => c.body)).toEqual([{ values: { key: 'sk-test-test-0001234' } }]);
    expect($('dialog[open]')).toBeNull();
    expect(card().querySelector('.key')?.textContent).toBe('••••••••••••1234');
    expect(card().querySelector('.pill')?.textContent).toBe('Connected');
    expect(card().textContent).toContain('Connected. The key can use 2 models.');
    expect(st().ints.find(n => n.id === 'openai')).toMatchObject({ tail: '1234', st: 'ok' });
    /* The probe network works without a token; Google services wait for Google sign-in. */
    expect(byText('.card.int .pill', 'Ready')).not.toBeNull();
    const ga = $$('.card.int').find(c => c.querySelector('h3')?.textContent === 'Google Analytics 4');
    expect([...ga!.querySelectorAll('button')].find(b => b.textContent === 'Connect with Google')?.hasAttribute('disabled')).toBe(true);
    expect(ga?.textContent).toContain('Set up Google sign-in first.');
  });

  it('shows a real access check, and asks the server for a new one', async () => {
    await change(() => { addSite(); });
    const id = st().sites[0]!.id;
    const check: AccessWire = { siteId: id, domain: 'kopi.example', cc: 'VN', at: Date.UTC(2026, 9, 3, 9, 30), result: 'blocked', dns: 'Different', http: 'Timeout', summary: 'Opens from outside the country but not from 2 networks in Vietnam.', probes: [{ place: 'Hanoi, VN', network: 'Viettel', dns: 'Different (10.0.0.1)', http: 'Timeout', ok: false }], by: 'Owner' };
    await change(() => useStore.setState(d => { d.live.ints = { probe: wire('probe', { connected: true, tail: 'Public access', worksWithout: 'Works without a token.' }) }; d.live.access[id] = check; serverFactsTo(d); }));
    api.on('POST', `/api/sites/${id}/check`, () => ({ status: 202, body: { started: true } }));
    await mount(<Deploy />);
    expect(st().sites[0]?.access).toBe('blocked');
    expect(text()).toContain('kopi.example cannot be opened from Vietnam.');
    expect(text()).toContain(check.summary);
    expect(text()).toContain('Viettel (Hanoi, VN)');
    await click(byText('button', 'Check now'));
    expect(api.to('POST', `/api/sites/${id}/check`)).toHaveLength(1);
    expect(st().checking).toEqual([id]);
    expect(byText('button', 'Checking…')).not.toBeNull();
    /* Server-owned fields are not saved in the sites document. */
    expect(JSON.stringify(docOf(st(), 'sites'))).not.toContain('blocked');
  });

  it('says how to sign in when OpenAI is not connected', async () => {
    await goLive(engineOff);
    await mount(<Integrations />);
    const card = $$('.card.int')[0];
    expect(card.querySelector('.pill')?.textContent).toBe('Not connected');
    expect(card.querySelector('p.note')?.textContent).toBe('Connect OpenAI to run agents. Check again');
    expect(card.querySelector('#key-openai')).toBeNull();
    await mount(<Workspace />);
    expect($('.start-now h3')?.textContent).toBe('Connect OpenAI to power your agents');
    expect($('.start-now button')?.textContent).toContain('Connect OpenAI');
    expect($('.start-key-help')?.textContent).toContain('Create an OpenAI API key');
    await change(() => st().setRctab('keywords'));
    await mount(<Research />);
    expect($('.callout.warn')?.textContent).toContain('OpenAI is not connected. Add and test the API key in Integrations, then try again.');
    expect(text()).not.toMatch(PRETEND);
  });

  it('shows OpenAI as connected through OpenAI Code and asks for no key', async () => {
    await goLive(engineOn);
    await mount(<Integrations />);
    const cards = $$('.card.int');
    expect([...cards[0].querySelectorAll('.pill')].map(p => p.textContent)).toEqual(['OpenAI ready', '9 agents']);
    expect(cards[0].querySelector('p.note')?.textContent).toBe('Ready for agent jobs. Check again');
    expect(cards[0].querySelector('#key-openai')).toBeNull();
    expect(cards.map(c=>c.querySelector('h3')?.textContent)).not.toContain('Claude API');
    expect(cards.map(c=>c.querySelector('h3')?.textContent)).not.toContain('Google Gemini API');
    await mount(<Workspace />);
    expect($('.callout')).toBeNull();
  });
});

describe('the first-run path', () => {
  it('goes from an empty app to a research result', async () => {
    await goLive(engineOn);
    await mount(<Sites />);
    await click(byText('button', 'addAdd domain'));
    expect($('dialog[open] p')?.textContent).toBe('Agents use this profile whenever they work for the site, for example on a research request.');
    await type($<HTMLInputElement>('#sdDomain'), 'kopi.example');
    await change(() => { const el = $<HTMLSelectElement>('#sdCountry')!; el.value = '0'; el.dispatchEvent(new window.Event('change', { bubbles: true })); });
    await type($<HTMLInputElement>('#sdTopic'), 'Coffee at home');
    await submit($('dialog[open] form'));
    expect($('dialog[open]')).toBeNull();
    expect($$('tbody tr')).toHaveLength(1);
    expect($('tbody tr b')?.textContent).toBe('kopi.example');
    expect($('tbody tr .pill')?.textContent).toBe('Being set up');
    const site = st().sites[0]!;

    /* The site can be picked in the request form. */
    const { TopBar } = await import('@/shell/TopBar');
    await mount(<TopBar view="research" scrolled={false} />);
    /* With one site there is nothing to pick between, so the top bar has no site picker. */
    expect($('.sitepick')).toBeNull();

    await change(() => st().setRctab('keywords'));
    await mount(<Research />);
    await click(byText('button', 'addNew research request'));
    expect($('dialog[open] .dd')?.getAttribute('aria-label')).toBe('Site: kopi.example (Vietnam)');
    await type($<HTMLInputElement>('#krTopic'), 'cold brew');
    const fetchMock = vi.fn(async () => json({ request: req(7, {}) }));
    vi.stubGlobal('fetch', fetchMock);
    await submit($('dialog[open] form'));
    expect($('dialog[open]')).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/requests');
    expect(JSON.parse(String(init.body))).toMatchObject({ siteId: site.id, domain: 'kopi.example', country: 'Vietnam', topic: 'cold brew' });

    /* The server reports the finished request (the event stream does this in the app). */
    const result = req(7, { siteId: site.id, domain: 'kopi.example', topic: 'cold brew', status: 'done', engine: 'openai-api', summary: 'Two ideas.', startedAt: 1000, finishedAt: 9000, tokens: 2100,
      keywords: [{ keyword: 'cà phê ủ lạnh', meaning: 'cold brew coffee', intent: 'Informational', cluster: 'Brewing', basis: 'Seed' }] });
    await goLive(engineOn, [result]);
    const tables = $$('table');
    expect(tables[0].querySelector('tbody tr')?.textContent).toContain('cold brew');
    expect(tables[0].querySelector('tbody tr')?.textContent).toContain('VN · kopi.example');
    expect([...tables[1].querySelectorAll('tbody tr td')].map(td => td.textContent).slice(0, 3)).toEqual(['cà phê ủ lạnh', 'VN · kopi.example', 'cold brew coffee']);
    await click(byText('button', 'View result'));
    expect($('dialog[open] h2')?.textContent).toBe('cold brew');
    expect($('dialog[open] p')?.textContent).toBe('Two ideas.');
    expect(st().notifs[0]?.title).toBe('Keyword research is ready: cold brew');
  });
});

// @vitest-environment jsdom
/* The "professional level" pass on screen: the Empty component, skeleton rows, the error snackbar, the Finish setup
   checklist, planned agents, one status vocabulary on Sites, and the controls that are not offered outside demo mode
   because they would do nothing there. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, Empty, ModTable, Snackbar, Table } from '@/components';
import { signedOutNote } from '@/shell/Login';
import { serverArticle } from '@/store/articleFixtures';
import { buildWire } from '@/store/buildFixtures';
import { req } from '@/store/liveAgentFixtures';
import { liveApply } from '@/store/liveApply';
import { serverFactsTo } from '@/store/serverFacts';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import { Analytics } from '../Analytics';
import { History } from '../History';
import { Settings } from '../Settings';
import { Sites } from '../Sites';
import { Skills } from '../Skills';
import { Workflows } from '../Workflows';
import { Workspace } from '../Workspace';
import { KwRequestSheet } from '../research/KwRequestSheet';
import { KEY_SETUP, SetupChecklist } from '../workspace/SetupChecklist';

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
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const st = () => useStore.getState();
const text = () => document.body.textContent ?? '';
const byText = (sel: string, t: string) => $$(sel).find(e => e.textContent === t) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const change = (fn: () => void) => act(async () => { fn(); });
const mount = async (node: ReactNode) => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); }
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => { root?.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>); });
};

/** Outside demo mode, signed in, with the server answering and Claude Code signed in. */
const live = (role: 'admin' | 'editor' | 'viewer' = 'admin') => {
  resetStore(false);
  st().signIn(meFor(role));
  useStore.setState(d => {
    d.sync = { loaded: true, error: '' };
    d.live.on = true; d.live.ready = true;
    d.live.engine = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.284 (Claude Code)', ready: true, reason: '' };
  });
};
const addSite = () => useStore.setState(d => {
  d.sites.push({ id: 'a', domain: 'kopi.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'build', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
});

beforeEach(() => {
  localStorage.clear();
  /* No server in these tests: anything a screen asks for fails quietly. */
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Empty', () => {
  it('is the quiet one-line box with text only', async () => {
    await mount(<Empty>No matches.</Empty>);
    expect($('.empty')?.textContent).toBe('No matches.');
    expect($('.empty h3')).toBeNull();
    expect($('.empty .empty-ico')).toBeNull();
    expect($('.empty .empty-act')).toBeNull();
  });

  it('shows an icon, a title, a body and the next action', async () => {
    const go = vi.fn();
    await mount(<Empty icon="language" title="No sites yet" action={<Button onClick={go}>Add your first domain</Button>}>Agents work for one site at a time.</Empty>);
    expect($('.empty .empty-ico .ms')?.textContent).toBe('language');
    expect($('.empty .empty-ico .ms')?.getAttribute('aria-hidden')).toBe('true');
    expect($('.empty h3')?.textContent).toBe('No sites yet');
    expect($('.empty p.empty-body')?.textContent).toBe('Agents work for one site at a time.');
    await click($('.empty .empty-act button'));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('is what a Table shows without rows, as text or as a full empty state', async () => {
    await mount(<Table cols={['A', 'B']} rows={[]} empty="Nothing yet." />);
    expect($('.empty')?.textContent).toBe('Nothing yet.');
    expect($('table')).toBeNull();
    await mount(<Table cols={['A', 'B']} rows={[]} empty={<Empty icon="history" title="Nothing recorded yet">Listed here.</Empty>} />);
    /* An <Empty> passed in is used as it is, not wrapped in a second box. */
    expect($$('.empty')).toHaveLength(1);
    expect($('.empty h3')?.textContent).toBe('Nothing recorded yet');
  });
});

describe('Table while loading', () => {
  it('shows skeleton rows instead of the empty state, then the rows', async () => {
    await mount(<Table cols={['Name', 'Email']} rows={[]} loading empty="No people." />);
    expect($('.empty')).toBeNull();
    expect($('.scroll')?.getAttribute('aria-busy')).toBe('true');
    expect($$('tbody tr.skel-row')).toHaveLength(3);
    expect($$('tbody tr.skel-row:first-child td .skel')).toHaveLength(2);
    expect($('[role="status"]')?.textContent).toBe('Loading…');
    await mount(<Table cols={['Name', 'Email']} rows={[['Dana', 'dana@example.com']]} loading />);
    expect($$('tr.skel-row')).toEqual([]);
    expect($('.scroll')?.hasAttribute('aria-busy')).toBe(false);
    expect($('tbody td')?.textContent).toBe('Dana');
  });
});

describe('Snackbar', () => {
  it('hides a confirmation after 4 seconds, and keeps an error until it is dismissed', async () => {
    vi.useFakeTimers();
    resetStore();
    await mount(<Snackbar />);
    await change(() => st().snack('Saved'));
    expect($('#snack')?.className).toBe('snack');
    expect($('#snack')?.getAttribute('role')).toBe('status');
    expect($('#snack button')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(4100); });
    expect(st().snackMsg).toBeNull();

    await change(() => st().snack('The server refused the change.', 'error'));
    expect($('#snack')?.className).toBe('snack err');
    expect($('#snack')?.getAttribute('role')).toBe('alert');
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(st().snackMsg?.msg).toBe('The server refused the change.');
    await click($('#snack button[aria-label="Dismiss"]'));
    expect(st().snackMsg).toBeNull();
  });
});

describe('Finish setup', () => {
  it('is not shown in demo mode', async () => {
    resetStore();
    st().signIn(meFor('admin'));
    await mount(<SetupChecklist />);
    expect($('#setup')).toBeNull();
  });

  it('lists the steps from real state, each open one with a link to its screen', async () => {
    live();
    await mount(<SetupChecklist />);
    expect($('#setup h2')?.textContent).toBe('Finish setup');
    expect($('.setup-head .note')?.textContent).toBe('1 of 10 done');
    expect($('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1');
    expect($$('.setup-list li').map(li => [li.dataset.step, li.dataset.done])).toEqual([
      ['engine', '1'], ['site', '0'], ['verify', '0'], ['research', '0'], ['article', '0'], ['build', '0'], ['cloudflare', '0'], ['gsc', '0'], ['email', '0'], ['twofa', '0'],
    ]);
    /* A done step has no hint and no link; an open one has both. */
    expect($('[data-step="engine"]')?.textContent).toBe('check_circleConnect OpenAI (done)');
    expect($('[data-step="site"] .sub2')?.textContent).toBe('One domain per country, with its language and topic.');
    expect($$('.setup-list button').map(b => b.textContent)).toEqual(['Open Sites', 'Open Sites', 'Open Keywords', 'Open Article review', 'Open Build and deploy', 'Open Integrations', 'Open Integrations', 'Open Integrations', 'Open account menu']);

    /* The account step opens the account menu, where 2-step verification is set up. */
    await click(byText('.setup-list button', 'Open account menu'));
    expect(st().pop).toBe('menu');
  });

  it('follows the server: a site, research, an approved article and a build tick their steps', async () => {
    live();
    await mount(<SetupChecklist />);
    await change(() => {
      addSite();
      useStore.setState(d => {
        d.live.reqs[1] = req(1, { status: 'done', domain: 'kopi.example' });
        d.live.arts[5] = serverArticle(5, { status: 'approved', domain: 'kopi.example' });
        d.live.builds[1] = buildWire(1, 'a', 'kopi.example', 1);
        liveApply(d); serverFactsTo(d);
      });
    });
    expect($('.setup-head .note')?.textContent).toBe('5 of 10 done');
    expect($$('.setup-list li[data-done="1"]').map(li => li.dataset.step)).toEqual(['engine', 'site', 'research', 'article', 'build']);
    expect($('[data-step="verify"] button')?.textContent).toBe('Open Sites');
  });

  it('tells a role without Integrations to ask an admin, without a dead link', async () => {
    live('editor');
    await mount(<SetupChecklist />);
    expect($('[data-step="cloudflare"] button')).toBeNull();
    expect($('[data-step="cloudflare"] .sub2')?.textContent).toContain('Ask an admin');
    expect($('[data-step="site"] button')).not.toBeNull();
  });

  it('can be dismissed once everything is done, and this browser remembers', async () => {
    live();
    const allDone = () => useStore.setState(d => {
      d.sites.push({ id: 'a', domain: 'kopi.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live', access: 'ok', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
      d.live.verify.a = { siteId: 'a', domain: 'kopi.example', host: 'h', value: 'v', verifiedAt: 5, by: 'Dana' };
      d.live.reqs[1] = req(1, { status: 'done' });
      d.live.arts[5] = serverArticle(5, { status: 'approved' });
      d.live.builds[1] = buildWire(1, 'a', 'kopi.example', 1);
      for (const id of ['cf', 'gsc', 'email']) d.live.ints[id] = { id, name: id, connected: true, tail: 'ab12', status: 'ok', msg: '', testedAt: null, updatedAt: 1, updatedBy: '', config: {}, fields: [], oauth: false, worksWithout: '', help: '' };
      if (d.session) d.session.twofa = true;
    });
    await mount(<SetupChecklist />);
    /* While a step is open there is nothing to dismiss. */
    expect(byText('#setup button', 'Dismiss')).toBeNull();
    await change(allDone);
    expect($('#setup h2')?.textContent).toBe('Setup complete');
    expect($('.setup-head .note')?.textContent).toBe('10 of 10 done');
    expect($$('.setup-list button')).toEqual([]);
    await click(byText('#setup button', 'Dismiss'));
    expect($('#setup')).toBeNull();
    expect(localStorage.getItem(KEY_SETUP)).toBe('1');
    await mount(<SetupChecklist />);
    expect($('#setup')).toBeNull();

    /* A step that opens again (2-step turned off) brings the card back, dismissed or not. */
    await change(() => useStore.setState(d => { if (d.session) d.session.twofa = false; }));
    expect($('#setup h2')?.textContent).toBe('Finish setup');
  });
});

describe('planned agents on the Workspace', () => {
  it('shows all eleven built-in agents as idle, without simulated controls', async () => {
    live(); await mount(<Workspace />);
    expect($$('#desks > .desk')).toHaveLength(11);
    expect($('#planned')).toBeNull();
    expect($$('#desks .stepper, #desks [aria-label^="Pause"], #desks [aria-label^="Remove"]')).toEqual([]);
    expect($('#k-sub')?.textContent).toBe('11 configured · 11 idle · 0 working');
    expect(byText('.hero button', 'pause_circlePause all')).toBeNull();
  });
  it('opens a specialist task entry in the agent sheet and still allows removal', async () => {
    live(); await mount(<Workspace />);
    await click(byText('#desks .linkbtn', 'Analyst'));
    const sheet = $('dialog[open]');
    expect(sheet?.textContent).not.toContain('has no job');
    expect(sheet?.textContent).toContain('Open SEO tasks');
    await click(sheet?.querySelector('[aria-label="Remove Analyst"]') ?? null);
    expect(st().confirm).toMatchObject({ key: 'ag:ana' });
  });

  it('are ordinary agents in demo mode, which simulates all of them', async () => {
    resetStore();
    st().signIn(meFor('admin'));
    await mount(<Workspace />);
    expect($$('#desks > .desk')).toHaveLength(11);
    expect($('#planned')).toBeNull();
    expect($$('.pill').map(p => p.textContent)).not.toContain('Planned');
    expect($$('#desks .stepper')).toHaveLength(11);
    expect($('#setup')).toBeNull();
  });

  it('keeps an idle card compact and shows the task and bar while the agent works', async () => {
    resetStore();
    st().signIn(meFor('admin'));
    await mount(<Workspace />);
    expect($('#desk-arc')?.getAttribute('data-st')).toBe('idle');
    expect($('#desk-arc .task')).toBeNull();
    expect($('#desk-arc .bar')).toBeNull();
    expect($('#desk-wr .task')?.textContent).toContain('Writing');
    expect($('#desk-wr .bar')).not.toBeNull();
  });
});

describe('one status vocabulary on Sites', () => {
  it('calls a domain that does not answer "Not reachable" in the pill, the visual overview and the map, never "blocked"', async () => {
    live();
    addSite();
    useStore.setState(d => {
      d.live.access.a = { siteId: 'a', domain: 'kopi.example', cc: 'ID', at: Date.now(), result: 'down', dns: 'No answer', http: 'No answer', summary: '', probes: [], by: '' };
      serverFactsTo(d);
    });
    await mount(<Sites />);
    expect($$('.vs-count').map(t => t.textContent)).toEqual(['0', '0', '0', '1']);
    await click($$('.vs-station')[3]);
    expect($('.vs-records')?.textContent).toContain('Not reachable');
    expect($$('#sitesTbl tbody .pill').map(p => p.textContent)).toEqual(['Being set up', 'Not reachable']);
    expect($$('th').map(t => t.textContent)).toEqual(['Site', 'Country', 'Status', 'Access', 'Last deploy', 'Actions']);

    await change(() => st().setSmode('map'));
    expect($('.mapd .pill')?.textContent).toBe('Not reachable');
    expect($('.mapd dl')?.textContent).toBe('Live0Being set up1Paused0Blocked by ISP0Not reachable1');
    expect($('.crow')?.textContent).toBe('IDIndonesia1 site · 1 not reachable');
    expect($('.mk')?.getAttribute('aria-label')).toBe('Indonesia: 1 site, 0 blocked, 1 not reachable');
    expect(text()).not.toContain('Blocked in');
  });

  it('offers the same words in the status filter, and no Themes tab outside demo mode', async () => {
    live();
    addSite();
    await mount(<Sites />);
    expect($$('.tabs [role="tab"]').map(e => e.textContent)).toEqual(['table_rowsList', 'publicMap']);
    expect([...($<HTMLSelectElement>('#sf-st')?.options ?? [])].map(o => o.textContent)).toEqual(['Any status', 'Live', 'Being set up', 'Paused', 'Blocked by ISP']);

    await change(() => { resetStore(); st().signIn(meFor('admin')); });
    await mount(<Sites />);
    expect([...($<HTMLSelectElement>('#sf-st')?.options ?? [])].map(o => o.textContent)).toEqual(['Any status', 'Live', 'Building', 'Waiting for DNS', 'Paused', 'Blocked by ISP']);
    expect($$('.vs-station-name').map(e => e.firstChild?.textContent)).toEqual(['Live sites', 'Being set up', 'Paused', 'Access issues']);
  });
});

describe('nothing pretends outside demo mode', () => {
  it('Settings has no parallel workers, no publish switch and no 1-minute sign-out', async () => {
    live();
    await mount(<Settings />);
    expect($('#st-parallel')).toBeNull();
    expect($('#st-apPublish')).toBeNull();
    expect($('#st-budget')).not.toBeNull();
    expect($('#st-apDeploy')).not.toBeNull();
    expect($('#st-native')).not.toBeNull();
    /* The budget is enforced by the server now, and the screen says so. */
    expect(text()).toContain('New jobs pause when the daily limit is reached.');
    expect(text()).not.toContain('Jobs are not stopped at the limit yet.');
    expect([...($<HTMLSelectElement>('#st-timeout')?.options ?? [])].map(o => o.textContent)).toEqual(['15 minutes', '1 hour', '8 hours']);
    /* A workspace that already has "1 minute" saved still shows its value. */
    await change(() => useStore.setState(d => { d.settings.timeout = 'demo'; }));
    expect([...($<HTMLSelectElement>('#st-timeout')?.options ?? [])].map(o => o.textContent)).toEqual(['1 minute (to try it now)', '15 minutes', '1 hour', '8 hours']);

    resetStore();
    st().signIn(meFor('admin'));
    await mount(<Settings />);
    expect($('#st-parallel')).not.toBeNull();
    expect($('#st-apPublish')).not.toBeNull();
    expect([...($<HTMLSelectElement>('#st-timeout')?.options ?? [])].map(o => o.textContent)).toContain('1 minute (to try it now)');
  });

  it('Workflows shows the real engine, and a schedule from before it says it never runs', async () => {
    live();
    useStore.setState(d => { d.schedules.push({ id: 'c1', wf: 'Weekly content', site: null, cad: 'Every Monday 06:00', on: true }); });
    await mount(<Workflows />);
    expect($$('h2').map(h => h.textContent)).toEqual(['Running now', 'Schedules', 'What Weekly content does', 'Site builds']);
    /* A schedule without a site and a time (the old sample shape) cannot run: no Run now, and the row says why. */
    expect(byText('button', 'Run now')).toBeNull();
    expect(text()).toContain('Never: it has no site or time. Edit it to set them.');
    /* No prototype step chips or templates, and the access check is a read-only row, not a schedule. */
    expect($$('.steps, .reflist')).toEqual([]);
    expect(text()).toContain('Domain access checkEvery live siteEvery 6 hours for live sites6 hours after');
    expect(text()).toContain('The Orchestrator itself makes no model calls.');
  });

  it('the research form does not offer "Refresh search volumes"', async () => {
    live();
    addSite();
    await mount(<KwRequestSheet open onClose={() => {}} />);
    expect([...($<HTMLSelectElement>('#krGoal')?.options ?? [])].map(o => o.textContent)).toEqual(['Find a new topic cluster', 'Expand an existing cluster']);
    resetStore();
    st().signIn(meFor('admin'));
    await mount(<KwRequestSheet open onClose={() => {}} />);
    expect([...($<HTMLSelectElement>('#krGoal')?.options ?? [])].map(o => o.textContent)).toContain('Refresh search volumes');
  });

  it('Analytics says what the budget does and draws no chart while nothing was measured', async () => {
    live();
    addSite();
    await mount(<Analytics />);
    expect(text()).toContain('At 100% its agent jobs stop until midnight.');
    expect(text()).not.toContain('it does not stop jobs yet');
    expect($$('.ring, .bars, .meters')).toEqual([]);
  });

  it('Models and skills says what changes a job, and the skill form has no field that is thrown away', async () => {
    live();
    await mount(<Skills />);
    expect($('.callout')).toBeNull();
    expect($('details.more')?.textContent).toContain('Assigned built-in skills apply to the next AI call');
    expect($$('.sx-agent.planned .sx-status')).toHaveLength(0);
    expect($$('.sx-agent:not(.planned) .sx-status').map(f => f.textContent)).toEqual(Array(11).fill('Active'));
    await click(byText('button', 'addAdd skill'));
    expect($('#skName')).not.toBeNull();
    expect($('#skBody')).toBeNull();
  });

  it('hides volume and difficulty until something feeds them', async () => {
    live();
    addSite();
    useStore.setState(d => {
      d.live.reqs[1] = req(1, { status: 'done', domain: 'kopi.example', finishedAt: 5, keywords: [{ keyword: 'phin', meaning: 'filter', intent: 'Informational', cluster: 'Brewing', basis: 'Seed' }] });
      liveApply(d);
    });
    await mount(<ModTable id="keywords" />);
    expect($$('th').map(t => t.textContent)).toEqual(['Keyword', 'Site', 'Meaning', 'Intent', 'Cluster']);
    /* The column comes back by itself once a row carries a value. */
    await change(() => useStore.setState(d => { d.mod.keywords.rows[0]!.c[2] = '1,900'; }));
    expect($$('th').map(t => t.textContent)).toEqual(['Keyword', 'Site', 'Meaning', 'Volume/mo', 'Intent', 'Cluster']);
    expect($('td.n')?.textContent).toBe('1,900');
  });
});

describe('small copy fixes', () => {


  it('explains a session that ended, and passes any other note through', () => {
    expect(signedOutNote('Your session ended. Sign in again.')).toBe('You were signed out because your session ended, usually after a while without activity. Your work is saved. Sign in to continue.');
    expect(signedOutNote('You were signed out after 15 minutes without activity.')).toBe('You were signed out after 15 minutes without activity.');
  });

  it('dates a run from another day, and shows the time alone for one from today', async () => {
    live();
    addSite();
    const today = new Date(); today.setHours(9, 5, 0, 0);
    const old = new Date(2026, 0, 14, 16, 40);
    useStore.setState(d => {
      d.jobLog = [
        { id: 1, t: today, agent: 'Site Builder', hue: 7, task: 'Building kopi.example v3', site: 'a', domain: 'kopi.example', dur: 20, tokens: 800, cost: 0.01, status: 'Done', steps: [], by: 'Dana Owner' },
        { id: 2, t: old, agent: 'Keyword', hue: 2, task: 'Researching keywords: phin', site: 'a', domain: 'kopi.example', dur: 95, tokens: 1200, cost: 0.2, status: 'Failed', steps: [] },
      ];
    });
    await mount(<History />);
    const rows = $$('tbody tr').map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
    expect(rows.map(r => r[0])).toEqual(['09:05', '14 Jan, 16:40']);
    /* The Site column names the site, so the task does not repeat the domain; "Asked by" is a second line. */
    expect(rows[0]![2]).toBe('Building website v3Asked by Dana Owner');
    expect($('tbody tr .sub2')?.textContent).toBe('Asked by Dana Owner');
    expect(rows[1]![2]).toBe('Researching keywords: phin');
    expect($('.tile.bad b')?.textContent).toBe('1');
  });
});

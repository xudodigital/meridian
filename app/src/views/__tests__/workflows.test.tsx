// @vitest-environment jsdom
/* The Workflows tab outside demo mode: real runs with their steps and what each waits for, starting and cancelling a
   run, schedules (new, edit, on/off, run now, remove) with the server's next run time, the read-only access check row,
   the roles, and the running workflow on the Workspace. Every action calls the server (a fake, fakeApi.ts). */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverArticle, T_ART } from '@/store/articleFixtures';
import { buildWire } from '@/store/buildFixtures';
import { FakeApi, answer } from '@/store/fakeApi';
import { liveApply } from '@/store/liveApply';
import { schedDueTo, workflowsTo } from '@/store/liveWorkflows';
import { serverFactsTo } from '@/store/serverFacts';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { BuildWire, Role, ServerArticle, WorkflowWire } from '@/store/types';
import { dueWire, workflowWire } from '@/store/workflowFixtures';
import { Workflows } from '../Workflows';
import { Workspace } from '../Workspace';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

let root: Root | null = null;
const $ = <T extends Element = HTMLElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel);
const $$ = (sel: string, from: ParentNode = document) => [...from.querySelectorAll<HTMLElement>(sel)];
const st = () => useStore.getState();
const text = () => document.body.textContent ?? '';
const byText = (sel: string, t: string, from: ParentNode = document) => $$(sel, from).find(e => e.textContent === t) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const submit = async (form: Element | null) => { expect(form).not.toBeNull(); await act(async () => { form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); await settle(); };
/** Chooses an option of a Select through its native <select> (the hidden one that keeps the value). */
const choose = async (id: string, value: string) => {
  const el = $<HTMLSelectElement>('select#' + id);
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
};
const type = async (el: HTMLInputElement | null, value: string) => {
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const unmount = async () => { if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; } };
const mount = async (node: ReactNode) => {
  await unmount();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(node); });
};
const change = (fn: () => void) => act(async () => { fn(); });

let api: FakeApi;
let site = '', other = '';
const run = (id: number, over: Partial<WorkflowWire> = {}) => workflowWire(id, { siteId: site, ...over });
const art = (id: number, over: Partial<ServerArticle> = {}) => serverArticle(id, { siteId: site, domain: 'kopi.example', ...over });
/** The server's state as GET /api/state would bring it. */
const serve = (o: { runs?: WorkflowWire[]; arts?: ServerArticle[]; builds?: BuildWire[]; engine?: boolean } = {}) => change(() => useStore.setState(d => {
  d.live.on = true;
  d.live.engine = o.engine === false ? null : { mode: 'openai-api', keyConfigured: true, apiVersion: '9', ready: true, reason: '' };
  (o.arts ?? []).forEach(a => { d.live.arts[a.id] = a; });
  (o.builds ?? []).forEach(b => { d.live.builds[b.id] = b; });
  workflowsTo(d, { runs: o.runs ?? [], schedules: [] });
  liveApply(d); serverFactsTo(d); d.live.ready = true;
}));
const as = (role: Role) => change(() => st().signIn(meFor(role, 'Dana Owner', role + '@example.com')));
const section = (h: string) => $$('section').find(s => s.querySelector('h2')?.textContent === h) ?? null;
const cards = (h = 'Running now') => $$('.wf-run', section(h) ?? document);
const rows = () => $$('tbody tr', section('Schedules') ?? document).map(tr => $$('td', tr).map(td => td.textContent));

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

describe('a running workflow', () => {
  it('shows its steps, what it waits for and the articles to review', async () => {
    await serve({ runs: [run(1)], arts: [art(5), art(6, { keyword: 'phin filter', content: null })] });
    await mount(<Workflows />);
    expect($$('h2').map(h => h.textContent)).toEqual(['Running now', 'Schedules', 'What Weekly content does', 'Site builds']);
    const [card] = cards();
    expect(card?.getAttribute('aria-label')).toBe('Weekly content for kopi.example');
    expect($('.wf-name .note', card)?.textContent).toContain('by Dana Owner · up to 2 articles');
    expect($('.wf-head .pill', card)?.textContent).toBe('Waiting for you');
    expect($$('.wf-steps li', card).map(li => [$('.wf-lbl', li)?.firstChild?.textContent, li.dataset.s])).toEqual([
      ['Keyword research', 'done'], ['Writing', 'done'], ['Your review', 'now'], ['Website build', 'todo'], ['Your approval', 'todo'], ['Deploy', 'todo'],
    ]);
    expect($('.wf-steps li[aria-current="step"] .wf-who', card)?.textContent).toBe('You');
    expect($('.wf-now', card)?.dataset.k).toBe('person');
    expect($('.wf-now b', card)?.textContent).toBe('Waiting for your review of 2 articles');
    expect($('.wf-now .note', card)?.textContent).toMatch(/^On this step since /);
    /* The articles it waits on, by title (or keyword), each opening Article review on that article. */
    expect($$('.wf-waits li .linkbtn', card).map(b => b.textContent)).toEqual(['How to brew phin coffee', 'phin filter']);
    await click($$('.wf-waits li .linkbtn', card)[1] ?? null);
    expect(st().rsel).toBe('a6');
    expect($$('.wf-log li', card).map(li => $('span', li)?.textContent)).toEqual(['Started by Dana Owner', 'Asked the Keyword agent for keyword research: Coffee']);
  });

  it('says honestly when it waits for an agent, the budget or a build approval', async () => {
    await serve({ runs: [run(1, { step: 'write', wait: { kind: 'agent', text: 'The Content Writer is writing article 1 of 2' } })] });
    await mount(<Workflows />);
    expect($('.wf-head .pill')?.textContent).toBe('Running');
    expect($('.wf-now b')?.textContent).toBe('The Content Writer is writing article 1 of 2');
    expect($$('.wf-waits li')).toEqual([]);

    await serve({ runs: [run(1, { step: 'research', wait: { kind: 'budget', text: 'Waiting for budget', detail: 'kopi.example has used its daily budget of $25.00. It resets at midnight, or raise the budget in Settings.' }, updatedAt: T_ART + 300_000 })] });
    expect($('.wf-head .pill')?.textContent).toBe('Waiting for budget');
    expect($('.wf-now .note')?.textContent).toContain('kopi.example has used its daily budget of $25.00.');
    expect(byText('.wf-links button', 'Open Settings')).not.toBeNull();

    await serve({
      runs: [run(1, { step: 'approve', buildId: 3, wait: { kind: 'person', text: 'Waiting for your approval of website v1' }, updatedAt: T_ART + 400_000 })],
      builds: [buildWire(3, site, 'kopi.example', 1)],
    });
    expect($('.wf-now b')?.textContent).toBe('Waiting for your approval of website v1');
    expect($('.wf-links a')?.getAttribute('href')).toBe(`/api/preview/${site}/1/`);
    expect(byText('.wf-links button', 'Open the Website tab')).not.toBeNull();
  });

  it('is cancelled on the server after a confirmation, and moves to Recent runs', async () => {
    await serve({ runs: [run(1)] });
    await mount(<Workflows />);
    api.on('POST', '/api/workflows/1/cancel', () => ({ run: run(1, { status: 'cancelled', wait: null, outcome: 'Cancelled by Dana Owner. 1 queued job withdrawn.', finishedAt: T_ART + 500_000, updatedAt: T_ART + 500_000 }) }));
    await click($('[aria-label="Cancel Weekly content for kopi.example"]'));
    expect($('dialog.wf-ask[open] h2')?.textContent).toBe('Cancel this workflow?');
    expect(api.calls).toEqual([]);
    await click(byText('dialog.wf-ask[open] button', 'Cancel workflow'));
    await settle();
    expect(api.to('POST', '/api/workflows/1/cancel')).toHaveLength(1);
    expect(cards()).toEqual([]);
    expect(text()).toContain('No workflow is running');
    const [ended] = cards('Recent runs');
    expect($('.wf-head .pill', ended)?.textContent).toBe('Cancelled');
    expect($('.wf-now b', ended)?.textContent).toBe('Cancelled by Dana Owner. 1 queued job withdrawn.');
    expect($$('.wf-steps li', ended).map(li => li.dataset.s)).toEqual(['done', 'done', 'stopped', 'todo', 'todo', 'todo']);
    expect($('[aria-label^="Cancel Weekly content"]')).toBeNull();
    expect(st().snackMsg?.msg).toBe('Cancelled "Weekly content" for kopi.example.');
  });

  it('shows why a run failed, on the step it failed on', async () => {
    await serve({ runs: [run(2, { status: 'failed', step: 'research', wait: null, error: 'Keyword research failed: The model is overloaded.', finishedAt: T_ART + 9000 })] });
    await mount(<Workflows />);
    const [card] = cards('Recent runs');
    expect($('.wf-head .pill', card)?.textContent).toBe('Failed');
    expect($('.wf-now', card)?.dataset.k).toBe('failed');
    expect($('.wf-now b', card)?.textContent).toBe('Keyword research failed: The model is overloaded.');
    expect($('.wf-steps li', card)?.dataset.s).toBe('failed');
  });
});

describe('starting a workflow', () => {
  it('"Run workflow" asks the server and shows the run it answers with', async () => {
    await serve();
    await mount(<Workflows />);
    await click(byText('button', 'play_arrowRun workflow'));
    expect($('dialog[open] #wfRunT')?.textContent).toBe('Run Weekly content');
    await choose('wfRunN', '3');
    await type($<HTMLInputElement>('#wfRunTopic'), ' Cold brew ');
    api.on('POST', '/api/workflows', () => answer(201, { run: run(7, { n: 3, topic: 'Cold brew', step: 'research', wait: { kind: 'agent', text: 'Keyword research is waiting for its turn' }, articles: [], log: [] }) }));
    await submit($('dialog[open] form'));
    expect(api.to('POST', '/api/workflows').map(c => c.body)).toEqual([{ siteId: site, n: 3, topic: 'Cold brew' }]);
    expect($('dialog[open]')).toBeNull();
    expect(cards().map(c => c.getAttribute('aria-label'))).toEqual(['Weekly content for kopi.example']);
    expect($('.wf-now b')?.textContent).toBe('Keyword research is waiting for its turn');

    /* A second one for the same site cannot be started; another site can, and a refusal is shown in the form. */
    await click(byText('button', 'play_arrowRun workflow'));
    expect(byText('dialog[open] button', 'play_arrowStart')?.hasAttribute('disabled')).toBe(true);
    expect($('dialog[open]')?.textContent).toContain('A workflow is already running for this site.');
    await choose('wfRunSite', other);
    api.on('POST', '/api/workflows', () => answer(503, { error: 'Claude Code is not signed in on this computer. Run ./login.sh in the Meridian folder, then try again.' }));
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('Claude Code is not signed in on this computer. Run ./login.sh in the Meridian folder, then try again.');
  });

  it('says so when Claude Code is not signed in', async () => {
    await serve({ engine: false });
    await mount(<Workflows />);
    expect($('.callout')?.textContent).toContain('OpenAI is not connected, so no workflow can start.');
  });
});

describe('schedules', () => {
  it('are added with a site, a time and a number of articles, and show the next run on the site\'s clock', async () => {
    await serve();
    await mount(<Workflows />);
    /* With none yet: the built-in access check is the only row, read-only. */
    expect(rows()).toEqual([['Domain access check', 'Every live site', 'Every 6 hours for live sites', '6 hours after each site\'s last check', 'Always on', 'Built in']]);
    expect(text()).toContain('No schedules yet');

    await click(byText('button', 'addNew schedule'));
    expect($('dialog[open] #wfSchT')?.textContent).toBe('New schedule');
    expect($('#wfSchWhen')?.textContent).toContain('Every Monday at 06:00, on the clock of Vietnam.');
    await choose('wfSchEvery', '2weeks');
    await choose('wfSchDay', '5');
    await choose('wfSchHour', '16');
    await choose('wfSchN', '4');
    expect($('#wfSchWhen')?.textContent).toContain('Every 2 weeks on Friday at 16:00');
    await submit($('dialog[open] form'));
    expect($('dialog[open]')).toBeNull();
    const [c] = st().schedules;
    expect(c).toMatchObject({ wf: 'Weekly content', site, on: true, every: '2weeks', weekday: 5, hour: 16, n: 4, topic: '' });
    expect(st().log[0]?.act).toBe('Scheduled "Weekly content" for kopi.example: every 2 weeks on friday at 16:00, 4 articles');
    /* Until the server has answered with its time the row says so; then the time, in the site's zone. */
    expect(rows()[0]?.slice(0, 4)).toEqual(['Weekly content', 'VN · kopi.example', 'Every 2 weeks on Friday at 16:004 articles per run', 'Saving…']);
    await change(() => useStore.setState(d => { schedDueTo(d, [dueWire(c!.id, { nextDue: Date.UTC(2026, 9, 9, 9, 0, 0) })]); }));
    expect(rows()[0]?.[3]).toBe('Fri 9 Oct, 16:00Ho Chi Minh time');
    expect(text()).not.toContain('No schedules yet');
  });

  it('show a skipped run, pause, run now, edit and remove', async () => {
    await serve();
    await change(() => useStore.setState(d => {
      d.schedules.push({ id: 'c1', wf: 'Weekly content', site, cad: 'Manual only', on: true, every: 'week', weekday: 1, hour: 6, n: 2, topic: '' });
      schedDueTo(d, [dueWire('c1', { lastDue: 1, note: 'Skipped the run of Mon 28 Sep, 06:00: Meridian was not running at that time, and a run more than 6 hours late is not started.' })]);
    }));
    await mount(<Workflows />);
    expect(rows()[0]?.[3]).toBe('Mon 5 Oct, 06:00Ho Chi Minh timeSkipped the run of Mon 28 Sep, 06:00: Meridian was not running at that time, and a run more than 6 hours late is not started.');

    api.on('POST', '/api/workflows', () => answer(201, { run: run(9, { scheduleId: 'c1', step: 'research', wait: null, articles: [] }) }));
    await click($('[aria-label="Run the Weekly content schedule now"]'));
    await settle();
    expect(api.to('POST', '/api/workflows').map(c => c.body)).toEqual([{ scheduleId: 'c1' }]);
    expect(cards()).toHaveLength(1);
    /* One workflow per site: Run now waits for it. */
    expect($('[aria-label="Run the Weekly content schedule now"]')?.hasAttribute('disabled')).toBe(true);

    await click($('#sch-c1'));
    expect(st().schedules[0]?.on).toBe(false);
    expect(rows()[0]?.[3]).toMatch(/^Paused/);

    await click($('[aria-label="Edit the Weekly content schedule"]'));
    expect($('dialog[open] #wfSchT')?.textContent).toBe('Edit schedule');
    expect($<HTMLSelectElement>('select#wfSchDay')?.value).toBe('1');
    await choose('wfSchEvery', 'month');
    await type($<HTMLInputElement>('#wfSchTopic'), 'Tea');
    await submit($('dialog[open] form'));
    expect(st().schedules).toHaveLength(1);
    expect(st().schedules[0]).toMatchObject({ id: 'c1', every: 'month', weekday: 1, hour: 6, topic: 'Tea', on: false });
    expect(rows()[0]?.[2]).toBe('First Monday of the month at 06:002 articles per run · topic: Tea');

    await click($('[aria-label="Remove the Weekly content schedule"]'));
    expect($('dialog.wf-ask[open] h2')?.textContent).toBe('Remove this schedule?');
    await click(byText('dialog.wf-ask[open] button', 'Remove'));
    expect(st().schedules).toEqual([]);
    expect(st().log[0]?.act).toBe('Removed the "Weekly content" schedule of kopi.example');
  });

  it('a viewer only looks: no buttons, no switches', async () => {
    await serve({ runs: [run(1)] });
    await change(() => useStore.setState(d => { d.schedules.push({ id: 'c1', wf: 'Weekly content', site, cad: 'Manual only', on: true, every: 'week', weekday: 1, hour: 6, n: 2, topic: '' }); }));
    await as('viewer');
    await mount(<Workflows />);
    expect(cards()).toHaveLength(1);
    expect(byText('button', 'play_arrowRun workflow')).toBeNull();
    expect(byText('button', 'addNew schedule')).toBeNull();
    expect($$('[aria-label^="Cancel"], .switch, .wf-acts')).toEqual([]);
    expect(rows()[0]?.[4]).toBe('On');
  });
});

describe('on the Workspace', () => {
  it('a running workflow has a line above the pipeline and sits on the Orchestrator\'s desk', async () => {
    await serve({ runs: [run(1)], arts: [art(5), art(6)] });
    await mount(<Workspace />);
    const line = $('#ws-workflows .wf-line');
    expect(line?.getAttribute('aria-label')).toBe('Weekly content for kopi.example: Waiting for your review of 2 articles. Open Workflows');
    expect($('.wf-line-text', line ?? document)?.textContent).toBe('Weekly content for kopi.exampleStep 3 of 6: Your review · Waiting for your review of 2 articles');
    expect($('.pill', line ?? document)?.textContent).toBe('Waiting for you');
    const desk = $('#desk-orc');
    expect(desk?.dataset.st).toBe('wait');
    expect($('.task', desk ?? document)?.textContent).toBe('Weekly content for kopi.example · waiting for your review of 2 articles');
    expect($('.tags', desk ?? document)?.textContent).toContain('Runs as code');
    await click(line);
    expect(st().dtab).toBe('workflows');
  });

  it('shows nothing of it in demo mode or when no workflow runs', async () => {
    await serve();
    await mount(<Workspace />);
    expect($('#ws-workflows')).toBeNull();
    expect($('#desk-orc')?.dataset.st).toBe('idle');
  });
});

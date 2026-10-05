// @vitest-environment jsdom
/* Smoke tests of the Workspace view: it renders from the seeded store, and its main controls change the store as the
   prototype does. jsdom has no layout, so the move animation itself is not measured; the hand-off page and the focus
   that follows a person to another room are. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Snackbar } from '@/components';
import { useStore, type AppStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import { flyDoc } from '../workspace/motion';
import { Workspace } from '../Workspace';

let reduced = false;
const animations: { el: Element; duration: number }[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (q: string) => ({ matches: reduced && q.includes('reduced-motion'), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  window.Element.prototype.scrollIntoView = () => {};
  window.Element.prototype.animate = function (this: Element, _k: Keyframe[] | PropertyIndexedKeyframes | null, o?: number | KeyframeAnimationOptions) {
    animations.push({ el: this, duration: typeof o === 'number' ? o : Number(o?.duration ?? 0) });
    return { onfinish: null } as unknown as Animation;
  };
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

/* These tests follow the prototype: they run against the sample data. */
resetStore();
const initial: AppStore = useStore.getState();
let root: Root;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const byLabel = (label: string) => $(`[aria-label="${label}"]`);
const byText = (sel: string, text: string) => $$(sel).find(b => b.textContent === text) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const run = async (fn: () => void) => { await act(async () => { fn(); }); };
const type = async (el: HTMLInputElement | null, value: string) => {
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const submit = async (form: Element | null) => { await act(async () => { form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); };
const agent = (id: string) => useStore.getState().agents.find(a => a.id === id);

beforeEach(async () => {
  reduced = false; animations.length = 0;
  localStorage.clear();
  useStore.setState(initial, true);
  useStore.getState().signIn(meFor('admin', 'Admin', 'admin@example.com'));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root.render(<Workspace />); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); });
afterAll(() => { localStorage.clear(); });

describe('Workspace', () => {
  it('renders the hero, the agents, the pipeline and the approvals from the seed', () => {
    expect($('.hero h2')?.textContent).toBe('Your agents are on shift.');
    expect($('.hero .sub')?.textContent).toMatch(/^11 AI agents are working across \d+ sites in \d+ countries\. Nothing publishes or deploys without your approval\.$/);
    expect(byText('.hero button', 'rate_reviewReview queue (4)')).not.toBeNull();
    expect([$('#k-work'), $('#k-wait'), $('#k-err')].map(e => e?.textContent)).toEqual(['6', '5', '1']);
    expect($$('.sh h2, .cols section > h2').map(h => h.textContent)).toEqual(['Work journeys', 'Agents', 'Content pipeline', 'Live activity', 'Needs approval']);
    expect($('#k-sub')?.textContent).toBe('3 idle · 19 of 24 parallel workers');
    expect($$('#desks.cards article.card.desk')).toHaveLength(11);
    expect($('#desk-kw')?.dataset.st).toBe('err');
    expect(byLabel('Retry Keyword')).not.toBeNull();
    expect($$('#pipe .pst')).toHaveLength(8);
    expect($$('#pipe button.pst').map(b => b.getAttribute('aria-label'))).toEqual(['Human review: 4. Open', 'Deploy approval: 1. Open']);
    expect($('#pipe [data-s="kw"]')?.dataset.k).toBe('bad');
    expect($('#pipe [data-s="rev"] .flag')?.textContent).toBe('Bottleneck');
    expect($('#rvline')?.textContent).toBe('Publish4 articles waiting for reviewOpen review');
    expect($$('#queue .q')).toHaveLength(1);
    expect($$('#feed li').length).toBeGreaterThan(0);
  });

  it('changes workers within the limits', async () => {
    await click(byLabel('More workers for Orchestrator'));
    expect(agent('orc')?.workers).toBe(2);
    expect($('#desk-orc output')?.textContent).toBe('2');
    expect(useStore.getState().log[0]?.act).toBe('Orchestrator now has 2 workers');
    await run(() => useStore.getState().mutate(d => { d.settings.parallel = 20; }));
    await click(byLabel('More workers for Orchestrator'));
    expect(agent('orc')?.workers).toBe(2);
    expect(useStore.getState().snackMsg?.msg).toBe('Limit reached: 20 parallel workers. Raise it in Settings.');
    await click(byLabel('Fewer workers for Orchestrator'));
    await click(byLabel('Fewer workers for Orchestrator'));
    expect(agent('orc')?.workers).toBe(1);
  });

  it('pauses and resumes one agent, and pauses every agent after confirming', async () => {
    await click(byLabel('Pause Research'));
    expect(agent('res')?.status).toBe('off');
    expect($('#desk-res')?.dataset.st).toBe('off');
    await click(byLabel('Resume Research'));
    expect(agent('res')?.status).toBe('idle');

    await click(byText('.hero button', 'pause_circlePause all'));
    expect(useStore.getState().confirm?.key).toBe('all:pause');
    await run(() => useStore.getState().confirmOk());
    expect(useStore.getState().agents.every(a => a.status === 'off')).toBe(true);
    await click(byText('.hero button', 'play_circleResume all'));
    expect(useStore.getState().agents.every(a => a.status === 'idle')).toBe(true);
    expect(useStore.getState().log[0]?.act).toBe('Resumed every agent');
  });

  it('approves a deploy from the queue', async () => {
    await click(byText('#queue button', 'Approve'));
    expect(useStore.getState().approvals).toHaveLength(0);
    expect(agent('dep')?.status).toBe('idle');
    expect($$('#queue .q')).toHaveLength(0);
  });

  it('removes an agent after confirming', async () => {
    /* Removing lives in the agent's sheet, not on every card. */
    expect(byLabel('Remove Analyst')).toBeNull();
    await click(byText('#desk-ana .linkbtn', 'Analyst'));
    await click(byLabel('Remove Analyst'));
    expect(useStore.getState().agentSheet).toBeNull();
    expect(useStore.getState().confirm).toMatchObject({ key: 'ag:ana', title: 'Remove this agent?' });
    await run(() => useStore.getState().confirmOk());
    expect(agent('ana')).toBeUndefined();
    expect($$('#desks article.desk')).toHaveLength(10);
  });

  it('warns when running agents miss their provider key', async () => {
    expect($('.callout')).toBeNull();
    await run(() => useStore.getState().mutate(d => { const k = d.ints.find(n => n.id === 'openai'); if (k) k.tail = null; }));
    expect($('.callout')?.textContent).toBe('keyOpenAI is not connected. Add and test the OpenAI API key in Integrations before running agent jobs.');
  });

  it('adds an agent with validation and the parallel-worker limit', async () => {
    await click(byText('.hero button', 'addAdd agent'));
    expect($('dialog[open] h2')?.textContent).toBe('Add an agent');
    await type($<HTMLInputElement>('#agName'), 'orchestrator');
    await type($<HTMLInputElement>('#agRole'), 'Creates and validates schema');
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('An agent with this name already exists.');
    await type($<HTMLInputElement>('#agName'), 'Schema Markup');
    await run(() => useStore.getState().mutate(d => { d.settings.parallel = 19; }));
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('Limit reached: 19 parallel workers. Raise it in Settings or pause an agent first.');
    await run(() => useStore.getState().mutate(d => { d.settings.parallel = 24; }));
    await submit($('dialog[open] form'));
    expect($('dialog[open]')).toBeNull();
    const added = useStore.getState().agents.at(-1);
    expect(added).toMatchObject({ name: 'Schema Markup', role: 'Creates and validates schema', model: 'GPT-6 Luna', status: 'idle', workers: 1, hue: 0, tasks: ['Working on: Creates and validates schema'] });
    expect(useStore.getState().log[0]?.act).toBe('Added the agent Schema Markup');
    expect($$('#desks article.desk')).toHaveLength(12);
  });

  it('opens the agent sheet from global search and closes it on Pause', async () => {
    await run(() => useStore.getState().openAgent('kw'));
    expect($('dialog[open] #sheetT')?.textContent).toBe('Keyword');
    expect($('dialog[open] .sysprompt')?.textContent).toMatch(/^You are the Keyword agent\. Role: clusters and prioritizes keywords\.\n/);
    expect(byText('dialog[open] button', 'refreshRetry')).not.toBeNull();
    await click(byText('dialog[open] button', 'pausePause'));
    expect(useStore.getState().agentSheet).toBeNull();
    expect($('dialog[open]')).toBeNull();
    expect(agent('kw')?.status).toBe('off');
  });

  it('refuses changes for a viewer', async () => {
    await run(() => useStore.getState().signIn(meFor('viewer', 'Viewer', 'viewer@example.com')));
    await click(byLabel('Pause Research'));
    expect(agent('res')?.status).toBe('work');
    expect(useStore.getState().snackMsg?.msg).toBe('View-only role. Ask an admin to make changes.');
    await click(byText('.hero button', 'addAdd agent'));
    expect($('dialog[open]')).toBeNull();
  });

  it('shows the office with rooms and opens a person', async () => {
    await click(byText('[role="tab"]', 'apartmentOffice'));
    expect(localStorage.getItem('das-ws')).toBe('office');
    expect($('[role="tab"][aria-selected="true"]')?.textContent).toBe('apartmentOffice');
    expect($$('#desks.office .room h3 > span:not(.ms):not(.cnt)').map(h => h.textContent)).toEqual(['Strategy room', 'Content studio', 'Tech and data lab', 'Meeting room · waiting for your approval', 'Break room · idle']);
    expect($$('#desks .stn')).toHaveLength(11);
    expect($$('.room.meet .stn').map(s => s.getAttribute('aria-label'))).toEqual(['Deploy & Monitor, needs approval. Open details']);
    expect($$('.room.break .stn')).toHaveLength(3);
    await click($('#desk-orc'));
    expect($('dialog[open] #sheetT')?.textContent).toBe('Orchestrator');
  });

  it('flies a page on hand-off and keeps focus on a person who changes room', async () => {
    await click(byText('[role="tab"]', 'apartmentOffice'));
    $('#desk-res')?.focus();
    await run(() => { useStore.getState().mutate(d => { const r = d.agents.find(a => a.id === 'res'); if (r) r.progress = 99.9; }); });
    await run(() => useStore.getState().tick());
    expect(useStore.getState().handoff.pairs).toContainEqual({ from: 'res', to: 'kw' });
    expect($('.room.break #desk-res')).not.toBeNull();
    expect(document.activeElement?.id).toBe('desk-res');
    expect(animations.some(x => x.el.classList.contains('fly') && x.duration === 1200)).toBe(true);
  });

  it('does not animate when the person prefers reduced motion', async () => {
    reduced = true;
    await click(byText('[role="tab"]', 'apartmentOffice'));
    $('#desk-res')?.focus();
    await run(() => { useStore.getState().mutate(d => { const r = d.agents.find(a => a.id === 'res'); if (r) r.progress = 99.9; }); });
    await run(() => useStore.getState().tick());
    expect($('.room.break #desk-res')).not.toBeNull();
    expect(document.activeElement?.id).toBe('desk-res');
    expect(animations).toHaveLength(0);
    expect($('.fly')).toBeNull();
  });
});

describe('the office in a new tab and in full screen', () => {
  let fsEl: Element | null = null;
  const requested: Element[] = [];
  let exits = 0;
  beforeEach(() => {
    fsEl = null; requested.length = 0; exits = 0;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
    window.Element.prototype.requestFullscreen = async function (this: Element) { requested.push(this); fsEl = this; document.dispatchEvent(new window.Event('fullscreenchange')); };
    document.exitFullscreen = async () => { exits++; fsEl = null; document.dispatchEvent(new window.Event('fullscreenchange')); };
  });
  afterEach(() => {
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
    delete (window.Element.prototype as { requestFullscreen?: unknown }).requestFullscreen;
    delete (document as { exitFullscreen?: unknown }).exitFullscreen;
  });
  const link = () => $<HTMLAnchorElement>('.sh a.btn');
  const fullButton = () => byText('.sh button', 'fullscreenFull screen');

  it('offers both only in Office mode, and the link keeps the site filter', async () => {
    expect(link()).toBeNull();
    expect(fullButton()).toBeNull();
    await click(byText('[role="tab"]', 'apartmentOffice'));
    expect(link()?.getAttribute('href')).toBe('/office');
    expect(link()?.getAttribute('target')).toBe('_blank');
    expect(link()?.getAttribute('rel')).toBe('noopener');
    expect(link()?.textContent).toBe('open_in_newOpen in new tab');
    expect(fullButton()).not.toBeNull();
    await run(() => useStore.getState().setSiteFilter('a'));
    expect(link()?.getAttribute('href')).toBe('/office?site=a');
    await click(byText('[role="tab"]', 'view_agendaCards'));
    expect(link()).toBeNull();
    expect(fullButton()).toBeNull();
  });

  it('shows the office in full screen in place, with its own way out', async () => {
    await click(byText('[role="tab"]', 'apartmentOffice'));
    await click(fullButton());
    expect(requested).toEqual([$('#desks.office')]);
    const exit = byText('#desks.office button.office-exit', 'fullscreen_exitExit full screen');
    expect(exit).not.toBeNull();
    expect($('#desks.office [role="status"]')?.textContent).toBe('The office is in full screen. Press Escape to leave.');
    await click(exit);
    expect(exits).toBe(1);
    expect($('.office-exit')).toBeNull();
    expect($('#desks.office [role="status"]')?.textContent).toBe('Full screen is off.');
  });

  /** A Tab key press on `el`; true when the page took it over (the browser would not move focus itself then). */
  const tabFrom = async (el: Element | null | undefined, shiftKey = false): Promise<boolean> => {
    expect(el).toBeTruthy();
    const e = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    await act(async () => { el?.dispatchEvent(e); });
    return e.defaultPrevented;
  };
  const focus = async (el: HTMLElement | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { el?.focus(); }); };

  it('moves focus into the office, keeps Tab inside it, and gives focus back to the Full screen button after', async () => {
    await click(byText('[role="tab"]', 'apartmentOffice'));
    const trigger = fullButton();
    await focus(trigger);
    await click(trigger);
    const exit = $<HTMLButtonElement>('.office-exit');
    expect(document.activeElement).toBe(exit);

    /* Round and round: Tab on the last person goes to the exit button, Shift + Tab there to the last person. */
    const stations = $$('#desks.office .stn'), last = stations.at(-1);
    expect(stations).toHaveLength(11);
    expect(await tabFrom(last)).toBe(true);
    expect(document.activeElement).toBe(exit);
    expect(await tabFrom(exit, true)).toBe(true);
    expect(document.activeElement).toBe(last);
    /* In between, Tab is the browser's. */
    expect(await tabFrom(stations[0])).toBe(false);
    /* Focus on a control hidden behind the office comes back in. */
    const hidden = $<HTMLButtonElement>('#pipe button.pst');
    await focus(hidden);
    expect(await tabFrom(hidden)).toBe(true);
    expect(document.activeElement).toBe(exit);

    /* A person's details over the office keep their own focus. */
    await click(stations[0] ?? null);
    const inSheet = $<HTMLButtonElement>('dialog[open] .actions button');
    await focus(inSheet);
    expect(await tabFrom(inSheet)).toBe(false);
    await run(() => useStore.getState().closeAgent());

    /* The exit button goes away with full screen: focus goes back to the button that started it. */
    await focus(exit);
    await click(exit);
    expect(exits).toBe(1);
    expect(document.activeElement).toBe(fullButton());
    /* Tab is the browser's again. */
    expect(await tabFrom(last)).toBe(false);
  });

  it('leaves focus on the person who has it when full screen ends with Escape', async () => {
    await click(byText('[role="tab"]', 'apartmentOffice'));
    await click(fullButton());
    const orc = $('#desk-orc');
    await focus(orc);
    await run(() => { void document.exitFullscreen(); });
    expect($('.office-exit')).toBeNull();
    expect(document.activeElement).toBe(orc);
  });

  it('shows the snackbar and a failed save inside the office while it is in full screen', async () => {
    const MSG = 'Your changes could not be saved: the server did not answer. Trying again…';
    const host = document.createElement('div');
    document.body.append(host);
    const snackRoot = createRoot(host);
    await act(async () => { snackRoot.render(<Snackbar />); });
    expect($('#snack')?.parentElement).toBe(host);

    await click(byText('[role="tab"]', 'apartmentOffice'));
    await click(fullButton());
    await run(() => useStore.getState().snack('View-only role. Ask an admin to make changes.', 'lock'));
    expect($('#snack')?.parentElement).toBe($('#desks.office'));
    expect($('#snack')?.textContent).toBe('lockView-only role. Ask an admin to make changes.');

    /* Demo mode saves nothing; outside it a failed save shows in the office too. */
    await run(() => useStore.setState(d => { d.sync.error = MSG; }));
    expect($('#desks.office .office-alert')).toBeNull();
    await run(() => useStore.setState(d => { d.sample = false; }));
    expect($('#desks.office .office-alert[role="alert"]')?.textContent).toBe('cloud_off' + MSG);

    await click($('.office-exit'));
    expect($('#snack')?.parentElement).toBe(host);
    expect($('.office-alert')).toBeNull();
    await act(async () => { snackRoot.unmount(); });
    host.remove();
  });

  it('flies hand-off pages inside the office while it is in full screen', async () => {
    await click(byText('[role="tab"]', 'apartmentOffice'));
    await click(fullButton());
    await run(() => { useStore.getState().mutate(d => { const r = d.agents.find(a => a.id === 'res'); if (r) r.progress = 99.9; }); });
    await run(() => useStore.getState().tick());
    expect(useStore.getState().handoff.pairs).toContainEqual({ from: 'res', to: 'kw' });
    const fly = $('.fly');
    expect(fly?.parentElement).toBe($('#desks.office'));
  });

  it('puts a flying page in the element in full screen, else in the body', () => {
    const r = new DOMRect(0, 0, 10, 10);
    flyDoc(r, r);
    expect($$('.fly').map(f => f.parentElement)).toEqual([document.body]);
    const box = document.createElement('div');
    document.body.append(box);
    fsEl = box;
    flyDoc(r, r);
    expect($$('.fly').at(-1)?.parentElement).toBe(box);
    /* A whole page in full screen shows the body. */
    fsEl = document.documentElement;
    flyDoc(r, r);
    expect($$('.fly').at(-1)?.parentElement).toBe(document.body);
  });
});

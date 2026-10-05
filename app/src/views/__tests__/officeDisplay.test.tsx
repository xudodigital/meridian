// @vitest-environment jsdom
/* The Office page (OfficeDisplay) on its own, in demo mode: the header with the live summary, the floor, the latest
   activity and its ticker, the agent sheet, a site filter from the link, the F shortcut, the header and cursor hiding
   in full screen, and the Screen Wake Lock. jsdom has neither the Fullscreen API nor the Wake Lock API: both are
   stand-ins here. It lays nothing out and runs no CSS animations either: the ticker's widths are stand-ins too. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_TICKER } from '@/store/storage';
import { useStore, type AppStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { LogEntry } from '@/store/types';
import { IDLE_MS } from '../workspace/fullscreen';
import { OfficeDisplay } from '../workspace/OfficeDisplay';
import { rowKeys, TICKER_ROWS, TICKER_SPEED_EM } from '../workspace/OfficeTicker';

let fsEl: Element | null = null;
let refuse = false;
const requested: Element[] = [];
let exits = 0;
const fullscreenChange = () => document.dispatchEvent(new window.Event('fullscreenchange'));
function stubFullscreen(): void {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
  window.Element.prototype.requestFullscreen = async function (this: Element) {
    requested.push(this);
    if (refuse) throw new TypeError('Permissions check failed');
    fsEl = this; fullscreenChange();
  };
  document.exitFullscreen = async () => { exits++; fsEl = null; fullscreenChange(); };
}
function unstubFullscreen(): void {
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  delete (window.Element.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  delete (document as { exitFullscreen?: unknown }).exitFullscreen;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

/* These tests run against the sample data. */
resetStore();
const initial: AppStore = useStore.getState();
let root: Root | null = null;
const st = () => useStore.getState();
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const od = () => $('.od') as HTMLElement;
const fsButton = () => $<HTMLButtonElement>('.od-acts button');
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); };
const key = async (k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  await act(async () => { target.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })); });
};
const pointer = async () => { await act(async () => { document.dispatchEvent(new window.Event('pointermove')); }); };
const press = async (el: Element | null) => { await act(async () => { el?.dispatchEvent(new window.Event('pointerdown', { bubbles: true })); }); };
const focus = async (el: HTMLElement | null) => { expect(el).not.toBeNull(); await act(async () => { el?.focus(); }); };
/* What the browser does on Tab: the key press, then focus moves on. */
const tab = async (to: HTMLElement | null, shiftKey = false) => { await key('Tab', { shiftKey }, document.activeElement ?? document.body); await focus(to); };
const idle = () => od().dataset.idle;
const later = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const mount = async () => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(<OfficeDisplay />); });
};

beforeEach(() => {
  localStorage.clear();
  useStore.setState(initial, true);
  st().signIn(meFor('admin', 'Admin', 'admin@example.com'));
  fsEl = null; refuse = false; requested.length = 0; exits = 0;
  history.replaceState(null, '', '/office');
  stubFullscreen();
  vi.spyOn(console, 'error');
});
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  vi.useRealTimers();
  unstubFullscreen();
  delete (navigator as { wakeLock?: unknown }).wakeLock;
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('the Office page', () => {
  it('shows the live summary, the floor sized for the screen, the latest activity and demo mode', async () => {
    await mount();
    expect(document.title).toBe('Office · Meridian');
    expect($$('.od-sum li').map(li => li.textContent)).toEqual(['bolt6 working now', 'front_hand5 needs approval', 'coffee3 idle', 'error1 error']);
    expect($('.od-head .pill')?.textContent).toBe('Demo mode: example data');
    expect($('.od-site')).toBeNull();
    expect($$('.od-main .office.big .room')).toHaveLength(5);
    expect($$('.od-main .stn')).toHaveLength(11);
    const rows = st().log.slice(0, TICKER_ROWS);
    expect(rows.length).toBeGreaterThan(3);
    expect($$('.od-tick li')).toHaveLength(rows.length);
    expect($$('.od-tick li b').map(b => b.textContent)).toEqual(rows.map(l => l.actor));
    expect($('.od-tick li')?.textContent).toContain(rows[0]?.act ?? '?');
    expect(fsButton()?.textContent).toBe('fullscreenFull screen');
    expect(fsButton()?.getAttribute('aria-keyshortcuts')).toBe('F');
    expect($('.od a[href="/workspace"]')?.textContent).toBe('dashboardOpen dashboard');
  });

  it('opens the details of the person selected', async () => {
    await mount();
    await click($('#desk-orc'));
    expect($('dialog[open] #sheetT')?.textContent).toBe('Orchestrator');
  });

  it('applies the site filter the link carries, and says so', async () => {
    const a = st().sites.find(s => s.id === 'a');
    history.replaceState(null, '', '/office?site=a');
    await mount();
    expect(st().siteFilter).toBe('a');
    expect($('.od-site')?.textContent).toBe(`languageSite: ${a?.cc} · ${a?.domain}`);
  });

  it('ignores a site the workspace does not have', async () => {
    history.replaceState(null, '', '/office?site=nope');
    await mount();
    expect(st().siteFilter).toBe('all');
    expect($('.od-site')).toBeNull();
  });
});

describe('full screen on the Office page', () => {
  it('toggles with F, says so to screen readers, and ignores F while typing or with a modifier', async () => {
    await mount();
    await key('f');
    expect(requested).toEqual([document.documentElement]);
    expect(od().dataset.full).toBe('1');
    expect(fsButton()?.textContent).toBe('fullscreen_exitExit full screen');
    expect($('.od > [role="status"]')?.textContent).toBe('Full screen is on. Press F or Escape to leave.');

    await key('F', { shiftKey: true });
    expect(exits).toBe(1);
    expect(od().dataset.full).toBeUndefined();
    expect(fsButton()?.textContent).toBe('fullscreenFull screen');
    expect($('.od > [role="status"]')?.textContent).toBe('Full screen is off.');

    const input = document.createElement('input');
    od().append(input);
    await key('f', {}, input);
    await key('f', { ctrlKey: true });
    await key('f', { metaKey: true });
    await key('f', { repeat: true });
    expect(requested).toHaveLength(1);

    await click(fsButton());
    expect(requested).toHaveLength(2);
    await click(fsButton());
    expect(exits).toBe(2);
  });

  it('says so when the browser refuses full screen', async () => {
    refuse = true;
    await mount();
    await click(fsButton());
    expect(requested).toHaveLength(1);
    expect(od().dataset.full).toBeUndefined();
    expect(st().snackMsg?.msg).toBe('The browser did not allow full screen.');
  });

  it('has no Full screen button, and F does nothing, where the browser cannot do full screen', async () => {
    unstubFullscreen();
    await mount();
    expect(fsButton()).toBeNull();
    expect($('.od a[href="/workspace"]')).not.toBeNull();
    await key('f');
    expect(requested).toEqual([]);
  });

  it('hides the header and the cursor after 3 seconds without input, and shows them again on movement or a key', async () => {
    await mount();
    vi.useFakeTimers();
    /* Not before full screen. */
    await later(IDLE_MS * 2);
    expect(od().dataset.idle).toBeUndefined();

    await key('f');
    await later(IDLE_MS - 1);
    expect(od().dataset.idle).toBeUndefined();
    await later(1);
    expect(od().dataset.idle).toBe('1');

    await pointer();
    expect(od().dataset.idle).toBeUndefined();
    await later(IDLE_MS);
    expect(od().dataset.idle).toBe('1');
    await key('ArrowDown');
    expect(od().dataset.idle).toBeUndefined();

    /* Never while the details of a person are open. */
    await click($('#desk-orc'));
    await later(IDLE_MS * 2);
    expect(od().dataset.idle).toBeUndefined();
    await act(async () => { st().closeAgent(); });
    await later(IDLE_MS);
    expect(od().dataset.idle).toBe('1');

    /* Leaving full screen shows everything again. */
    await act(async () => { await document.exitFullscreen(); });
    expect(od().dataset.idle).toBeUndefined();
    expect(od().dataset.full).toBeUndefined();
  });

  it('lets the header hide again after a click on its button and a key press; focus moved there by Tab keeps it', async () => {
    await mount();
    vi.useFakeTimers();
    const link = $<HTMLAnchorElement>('.od a[href="/workspace"]');
    /* A mouse click: the button keeps focus, and the browser marks it :focus-visible after any key press. */
    await press(fsButton());
    await focus(fsButton());
    await click(fsButton());
    expect(od().dataset.full).toBe('1');
    await later(IDLE_MS);
    expect(idle()).toBe('1');
    await key('ArrowDown', {}, fsButton() ?? document.body);
    expect(idle()).toBeUndefined();
    await later(IDLE_MS);
    expect(idle()).toBe('1');

    /* Tab into the header: it stays, however long. */
    await tab(link);
    expect(idle()).toBeUndefined();
    await later(IDLE_MS * 3);
    expect(idle()).toBeUndefined();
    await tab(fsButton(), true);
    await later(IDLE_MS * 3);
    expect(idle()).toBeUndefined();

    /* Tab on to the floor: it hides again. */
    await tab(link);
    await tab($('#desk-orc'));
    await later(IDLE_MS);
    expect(idle()).toBe('1');

    /* Back in by Tab, then a pointer press in the header hands it back to the timer. */
    await tab(link, true);
    await later(IDLE_MS * 2);
    expect(idle()).toBeUndefined();
    await press(link);
    await later(IDLE_MS);
    expect(idle()).toBe('1');
  });

  it('decides in the code, not with :focus-visible, whether focus keeps the header', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../workspace/office-display.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.od\[data-idle\] \.od-top\{/);
    /* No rule about the header or the idle page looks at focus (the ticker's Pause button has a focus ring). */
    const rules = css.match(/[^{}]*\{[^{}]*\}/g) ?? [];
    expect(rules.filter(r => /data-idle|\.od-top|\.od-head/.test(r))).not.toHaveLength(0);
    expect(rules.filter(r => /data-idle|\.od-top|\.od-head/.test(r) && /:focus/.test(r))).toEqual([]);
  });

  it('keeps the screen awake in full screen, asks again when the page is shown again, and lets go after', async () => {
    const locks: { released: boolean; release: () => Promise<void> }[] = [];
    const request = vi.fn(async (_type: string) => {
      const l = { released: false, release: vi.fn(async () => { l.released = true; }) };
      locks.push(l);
      return l;
    });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    await mount();
    expect(request).not.toHaveBeenCalled();

    await key('f');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');

    /* The browser drops the lock while the tab is hidden; back on screen, it is asked for again. */
    const first = locks[0];
    if (first) first.released = true;
    await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
    expect(request).toHaveBeenCalledTimes(2);

    await key('f');
    expect(locks[1]?.release).toHaveBeenCalledTimes(1);
    expect(locks[1]?.released).toBe(true);
  });

  it('works without the Wake Lock API, and when the browser refuses the lock', async () => {
    await mount();
    await key('f');
    expect(od().dataset.full).toBe('1');
    await key('f');

    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: vi.fn(async () => { throw new DOMException('Battery saver is on', 'NotAllowedError'); }) } });
    await key('f');
    expect(od().dataset.full).toBe('1');
  });
});

describe('a failed save on the Office page', () => {
  const MSG = 'Your changes could not be saved: the server did not answer. Trying again…';
  it('shows under the header outside demo mode, and stays while the header hides', async () => {
    await mount();
    expect($('.od-alert [role="alert"]')).toBeNull();
    await act(async () => { useStore.setState(d => { d.sample = false; d.sync.error = MSG; }); });
    expect($('.od-alert [role="alert"]')?.textContent).toBe('cloud_off' + MSG);
    vi.useFakeTimers();
    await key('f');
    await later(IDLE_MS);
    expect(od().dataset.idle).toBe('1');
    expect($('.od-top .od-alert')).toBeNull();
    expect($('.od-alert [role="alert"]')).not.toBeNull();
    await act(async () => { useStore.setState(d => { d.sync.error = ''; }); });
    expect($('.od-alert [role="alert"]')).toBeNull();
  });

  it('says nothing in demo mode, where nothing is saved', async () => {
    await act(async () => { useStore.setState(d => { d.sync.error = MSG; }); });
    await mount();
    expect($('.od-alert')?.textContent).toBe('');
  });
});

describe('the activity ticker on the Office page', () => {
  /* Stand-ins for the layout: the width of one copy of the entries and of the lane they move in. */
  let copyW = 0, laneW = 0;
  /* Stand-in for the preference for reduced motion, with the listeners the page subscribed. */
  let reduced = false;
  const motionListeners = new Set<() => void>();
  beforeEach(() => {
    copyW = 0; laneW = 0; reduced = false; motionListeners.clear();
    vi.spyOn(window.Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) { return this.classList.contains('od-tick-list') ? copyW : 0; });
    vi.spyOn(window.Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) { return this.classList.contains('od-tick-lane') ? laneW : 0; });
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => {
      const motion = q.includes('prefers-reduced-motion');
      return {
        matches: motion && reduced, media: q, onchange: null, dispatchEvent: () => false, addListener() {}, removeListener() {},
        addEventListener: (_t: string, cb: () => void) => { if (motion) motionListeners.add(cb); },
        removeEventListener: (_t: string, cb: () => void) => { motionListeners.delete(cb); },
      } as unknown as MediaQueryList;
    });
  });

  const tick = () => $('.od-tick') as HTMLElement;
  const lists = () => $$('.od-tick-list');
  const pp = () => $<HTMLButtonElement>('.od-tick-pp');
  const track = () => $('.od-tick-track') as HTMLElement;
  const view = () => $('.od-tick-view') as HTMLElement;
  const texts = (ul: HTMLElement | undefined) => [...(ul?.querySelectorAll('li') ?? [])].map(li => li.textContent);
  /** The window was resized: the ticker measures again (jsdom has no ResizeObserver). */
  const resize = async (copy: number, lane: number) => { copyW = copy; laneW = lane; await act(async () => { window.dispatchEvent(new window.Event('resize')); }); };
  const enter = async (el: Element) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true })); }); };
  const leave = async (el: Element) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })); }); };
  const loopEnds = async (el: Element = track()) => { await act(async () => { el.dispatchEvent(new window.Event('animationiteration', { bubbles: true })); }); };
  const T = Date.UTC(2026, 9, 3, 9, 0, 0);
  let n = 0;
  const entry = (what: string, site: string | null = null): LogEntry => ({ t: new Date(Date.now() + ++n * 1000), actor: 'Keyword', act: what, site });
  const add = async (what: string, site: string | null = null) => { await act(async () => { useStore.setState(d => { d.log.unshift(entry(what, site)); }); }); };
  const remount = async () => { if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; } await mount(); };

  it('keys entries by client id, server id or content', () => {
    const t = new Date(T);
    const keys = rowKeys([
      { t, actor: 'Admin', act: 'Saved', site: null, cid: 'c1', id: 7 },
      { t, actor: 'Admin', act: 'Saved', site: null, id: 8 },
      { t, actor: 'Admin', act: 'Saved', site: null },
      { t, actor: 'Admin', act: 'Saved', site: null },
    ]);
    expect(keys).toEqual(['c1', '#8', `${T}|Admin|Saved`, `${T}|Admin|Saved~1`]);
    expect(new Set(keys).size).toBe(4);
  });

  it('shows the 12 newest entries in full, inside the site filter, and stands still when they fit', async () => {
    useStore.setState(d => { for (let i = 0; i < 9; i++) d.log.unshift(entry(`Checked page ${i}`, i % 2 ? 'a' : 'b')); });
    expect(st().log.length).toBeGreaterThan(TICKER_ROWS);
    await mount();
    const rows = st().log.slice(0, TICKER_ROWS);
    expect(tick().tagName).toBe('SECTION');
    expect(tick().getAttribute('aria-labelledby')).toBe('od-tick-h');
    expect($('#od-tick-h')?.textContent).toBe('Latest activity');
    expect(tick().dataset.mode).toBe('still');
    expect(tick().dataset.run).toBeUndefined();
    expect(lists()).toHaveLength(1);
    expect(pp()).toBeNull();
    expect($$('.od-tick li')).toHaveLength(TICKER_ROWS);
    expect($$('.od-tick li b').map(b => b.textContent)).toEqual(rows.map(l => l.actor));
    expect($('.od-tick li')?.textContent).toContain('Checked page 8');
    expect($('.od-tick [aria-live]')).toBeNull();

    /* A site filter: entries of other sites leave, entries without a site stay. */
    await act(async () => { st().setSiteFilter('a'); });
    const a = st().sites.find(s => s.id === 'a');
    const inA = st().log.filter(l => !l.site || l.site === 'a').slice(0, TICKER_ROWS);
    expect(texts(lists()[0])).toHaveLength(inA.length);
    expect($$('.od-tick .chip').every(c => c.textContent === a?.cc)).toBe(true);
    expect(texts(lists()[0]).some(t => t?.includes('Checked page 8'))).toBe(false);
  });

  it('cuts no entry short and moves by one copy per loop, at a steady speed, in its CSS', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../workspace/office-display.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const tickRules = css.match(/[^{}]*\.od-tick[^{}]*\{[^{}]*\}/g) ?? [];
    expect(tickRules.length).toBeGreaterThan(10);
    expect(tickRules.join('\n')).not.toMatch(/ellipsis|line-clamp/);
    expect(css).toContain('@keyframes od-tick{from{transform:translateX(0)}to{transform:translateX(-50%)}}');
    expect(css).toMatch(/\.od-tick\[data-mode="move"\] \.od-tick-track\{animation:od-tick var\(--od-tick-dur,60s\) linear infinite/);
    expect(css).toMatch(/\.od-tick\[data-mode="move"\]:not\(\[data-run\]\) \.od-tick-track\{animation-play-state:paused\}/);
    expect(css).toMatch(/mask-image:linear-gradient\(to right,transparent,/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^@]*\.od-tick-track[^{]*\{animation:none!important\}/);
    /* The Pause button shows keyboard focus: .ib (shell.css, in the proto layer) unsets the outline of base.css, and
       this file is outside the layers, so its ring wins. */
    expect(css).not.toContain('@layer');
    expect(css).toMatch(/\.od-tick \.od-tick-pp:focus-visible\{outline:max\(3px,0\.2em\) solid var\(--md-sys-color-primary\);outline-offset:/);
  });

  it('moves only when one copy is wider than its lane, with a hidden, inert second copy and a loop as long as the copy', async () => {
    copyW = 2100; laneW = 800;
    await mount();
    expect(tick().dataset.mode).toBe('move');
    expect(tick().dataset.run).toBe('1');
    const [one, two] = lists();
    expect(lists()).toHaveLength(2);
    expect(one?.getAttribute('aria-hidden')).toBeNull();
    expect(one?.hasAttribute('inert')).toBe(false);
    expect(two?.getAttribute('aria-hidden')).toBe('true');
    expect(two?.hasAttribute('inert')).toBe(true);
    expect(texts(two)).toEqual(texts(one));
    expect(texts(one)).toHaveLength(Math.min(TICKER_ROWS, st().log.length));
    /* 70 px a second at the base 14 px: 2100 px take 30 seconds. jsdom's text is 16 px: 26.25 seconds. */
    expect(TICKER_SPEED_EM * 14).toBe(70);
    expect(getComputedStyle(one as HTMLElement).fontSize).toBe('16px');
    expect(track().style.getPropertyValue('--od-tick-dur')).toBe('26.3s');
    expect(pp()?.getAttribute('aria-label')).toBe('Pause the activity ticker');
    expect(pp()?.getAttribute('aria-pressed')).toBe('false');
    expect(pp()?.title).toBe('Pause the activity ticker');
    expect(pp()?.textContent).toBe('pause');
    expect(view().hasAttribute('tabindex')).toBe(false);
    expect($('.od-tick [aria-live]')).toBeNull();

    /* The lane grows wider than the entries: they stand still, once, without the button. */
    await resize(2100, 2400);
    expect(tick().dataset.mode).toBe('still');
    expect(tick().dataset.over).toBeUndefined();
    expect(lists()).toHaveLength(1);
    expect(pp()).toBeNull();

    /* A longer track takes longer. */
    await resize(4200, 800);
    expect(tick().dataset.mode).toBe('move');
    expect(lists()).toHaveLength(2);
    expect(track().style.getPropertyValue('--od-tick-dur')).toBe('52.5s');

    /* The speed grows with the text (--od-fs): at 28 px, 4200 px are 30 em, which take 30 em / 5 em a second. */
    (lists()[0] as HTMLElement).style.fontSize = '28px';
    await resize(4200, 800);
    expect(track().style.getPropertyValue('--od-tick-dur')).toBe('30s');
  });

  it('pauses and plays with its button, and remembers the choice in this browser', async () => {
    copyW = 2100; laneW = 800;
    await mount();
    await click(pp());
    expect(pp()?.getAttribute('aria-pressed')).toBe('true');
    expect(pp()?.getAttribute('aria-label')).toBe('Pause the activity ticker');
    expect(pp()?.textContent).toBe('play_arrow');
    /* The tooltip says what a click does, as the icon shows. */
    expect(pp()?.title).toBe('Play the activity ticker');
    expect(tick().dataset.mode).toBe('move');
    expect(tick().dataset.run).toBeUndefined();
    expect(localStorage.getItem(KEY_TICKER)).toBe('1');

    await remount();
    expect(pp()?.getAttribute('aria-pressed')).toBe('true');
    expect(tick().dataset.run).toBeUndefined();

    await click(pp());
    expect(pp()?.getAttribute('aria-pressed')).toBe('false');
    expect(pp()?.textContent).toBe('pause');
    expect(pp()?.title).toBe('Pause the activity ticker');
    expect(tick().dataset.run).toBe('1');
    expect(localStorage.getItem(KEY_TICKER)).toBeNull();
  });

  it('pauses while the pointer is over it or focus is in it, the button included, but not for a pointer left there in full screen', async () => {
    copyW = 2100; laneW = 800;
    await mount();
    /* Anywhere on the strip: the entries, the heading, the button. */
    for (const el of [view(), $('#od-tick-h') as HTMLElement, pp() as HTMLElement]) {
      await enter(el);
      expect(tick().dataset.run).toBeUndefined();
      await leave(el);
      expect(tick().dataset.run).toBe('1');
    }

    /* Tab to the Pause button, the one thing in it that takes focus: it holds still; Tab on, and it moves again. */
    await tab(pp());
    expect(tick().dataset.run).toBeUndefined();
    expect(pp()?.getAttribute('aria-pressed')).toBe('false');
    await tab($('#desk-orc'));
    expect(tick().dataset.run).toBe('1');

    /* Pause, then Play with focus still on the button: Play moves it at once. Focus that leaves and comes back holds
       it again. */
    await tab(pp(), true);
    await click(pp());
    expect(pp()?.getAttribute('aria-pressed')).toBe('true');
    expect(tick().dataset.run).toBeUndefined();
    await click(pp());
    expect(document.activeElement).toBe(pp());
    expect(pp()?.getAttribute('aria-pressed')).toBe('false');
    expect(tick().dataset.run).toBe('1');
    await tab($('#desk-orc'));
    expect(tick().dataset.run).toBe('1');
    await tab(pp(), true);
    expect(tick().dataset.run).toBeUndefined();
    await tab($('#desk-orc'));

    /* The same with the pointer on the button. */
    await enter(pp() as HTMLElement);
    await click(pp());
    await click(pp());
    expect(tick().dataset.run).toBe('1');
    await leave(pp() as HTMLElement);
    expect(tick().dataset.run).toBe('1');
    await enter(view());
    expect(tick().dataset.run).toBeUndefined();
    await leave(view());
    expect(tick().dataset.run).toBe('1');

    /* In full screen with nobody there the pointer is hidden: one left over the ticker no longer holds it. */
    vi.useFakeTimers();
    await key('f');
    await enter(view());
    expect(tick().dataset.run).toBeUndefined();
    await later(IDLE_MS);
    expect(od().dataset.idle).toBe('1');
    expect(tick().dataset.run).toBe('1');
    await pointer();
    expect(tick().dataset.run).toBeUndefined();
  });

  it('is not held by focus on a Pause button that went away when the entries came to fit', async () => {
    copyW = 2100; laneW = 800;
    await mount();
    await tab(pp());
    expect(tick().dataset.run).toBeUndefined();
    await resize(2100, 2400);
    expect(pp()).toBeNull();
    await resize(2100, 800);
    expect(tick().dataset.mode).toBe('move');
    expect(tick().dataset.run).toBe('1');
  });

  it('stands still, in one copy without the button, when the person prefers reduced motion, and scrolls by hand', async () => {
    reduced = true;
    copyW = 2100; laneW = 800;
    await mount();
    expect(tick().dataset.mode).toBe('still');
    expect(tick().dataset.over).toBe('1');
    expect(tick().dataset.run).toBeUndefined();
    expect(lists()).toHaveLength(1);
    expect(pp()).toBeNull();
    expect(view().getAttribute('tabindex')).toBe('0');
    expect(view().getAttribute('role')).toBe('group');
    expect(view().getAttribute('aria-labelledby')).toBe('od-tick-h');

    /* The setting changes while the page is open. */
    reduced = false;
    await act(async () => { motionListeners.forEach(cb => cb()); });
    expect(tick().dataset.mode).toBe('move');
    expect(lists()).toHaveLength(2);
    reduced = true;
    await act(async () => { motionListeners.forEach(cb => cb()); });
    expect(tick().dataset.mode).toBe('still');
    expect(lists()).toHaveLength(1);
  });

  it('puts new entries in at the end of a loop while it moves, and at once while it stands still or is paused', async () => {
    copyW = 2100; laneW = 800;
    await mount();
    const before = texts(lists()[0]);
    await add('Found 40 new keywords');
    expect(texts(lists()[0])).toEqual(before);
    expect(texts(lists()[1])).toEqual(before);
    /* Not when something inside the track ends a loop of its own. */
    await loopEnds(lists()[0]?.querySelector('li') as HTMLElement);
    expect(texts(lists()[0])).toEqual(before);
    /* At the end of the loop both copies take it, before the entries that were there; the oldest goes. */
    await loopEnds();
    expect(texts(lists()[0])?.[0]).toContain('Found 40 new keywords');
    expect(texts(lists()[0]).slice(1)).toEqual(before.slice(0, TICKER_ROWS - 1));
    expect(texts(lists()[1])).toEqual(texts(lists()[0]));

    /* Paused with the button: at once. */
    await click(pp());
    await add('Paused, still updated');
    expect(texts(lists()[0])[0]).toContain('Paused, still updated');
    await click(pp());

    /* Another site filter is not newer entries, even though the newest entries (without a site) stay: it replaces
       the list at once, while it moves too. */
    await act(async () => { st().setSiteFilter('a'); });
    expect(tick().dataset.mode).toBe('move');
    expect(tick().dataset.run).toBe('1');
    const inA = st().log.filter(l => !l.site || l.site === 'a').slice(0, TICKER_ROWS);
    expect(texts(lists()[0])).toHaveLength(inA.length);
    expect(texts(lists()[0])[0]).toContain('Paused, still updated');
    const siteA = st().sites.find(s => s.id === 'a')?.cc;
    expect([...(lists()[0]?.querySelectorAll('.chip') ?? [])].map(c => c.textContent)).toEqual(inA.filter(l => l.site).map(() => siteA));
    expect(texts(lists()[1])).toEqual(texts(lists()[0]));

    /* Standing still: at once. */
    await resize(2100, 4000);
    expect(tick().dataset.mode).toBe('still');
    await add('Fits, so it stands still');
    expect(texts(lists()[0])[0]).toContain('Fits, so it stands still');
  });

  it('lets any change wait for the end of a loop while it moves: an entry out of time order, or one that moved down', async () => {
    copyW = 2100; laneW = 800;
    await mount();
    const before = texts(lists()[0]);
    /* The server's copy of an entry, timed just before the newest (another clock): it goes in below the newest. */
    await act(async () => {
      useStore.setState(d => { const t0 = d.log[0]?.t.getTime() ?? T; d.log.splice(1, 0, { t: new Date(t0 - 1), actor: 'Keyword', act: 'Out of order', site: null, id: 9001 }); });
    });
    expect(texts(lists()[0])).toEqual(before);
    expect(texts(lists()[1])).toEqual(before);
    await loopEnds();
    const now = texts(lists()[0]);
    expect(now[0]).toBe(before[0]);
    expect(now[1]).toContain('Out of order');
    expect(now.slice(2)).toEqual(before.slice(1, TICKER_ROWS - 1));
    expect(texts(lists()[1])).toEqual(now);

    /* The newest entry moves down two places (the server put it earlier): it waits too. */
    await act(async () => { useStore.setState(d => { const [first] = d.log.splice(0, 1); if (first) d.log.splice(2, 0, first); }); });
    expect(texts(lists()[0])).toEqual(now);
    await loopEnds();
    expect(texts(lists()[0])).toEqual([now[1], now[2], now[0], ...now.slice(3)]);

    /* Paused with the button: at once. */
    await click(pp());
    await act(async () => { useStore.setState(d => { d.log.splice(1, 1); }); });
    expect(texts(lists()[0]).slice(0, 3)).toEqual([now[1], now[0], now[3]]);
  });
});

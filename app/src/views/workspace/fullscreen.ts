/* Full screen for the Office: the Fullscreen API, a Screen Wake Lock while in full screen (so a TV or a wall display
   does not go to sleep), and the idle timer that hides the header and the cursor of the Office page.
   Every browser API here is optional: where one is missing nothing happens and nothing throws. */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { fullscreenElement as current, onFullscreenChange as subscribe } from '@/components/fullscreen';

export { useFullscreenElement } from '@/components/fullscreen';

/** Whether this browser can show an element in full screen (not, for example, Safari on iPhone or a sandboxed frame). */
export const canFullscreen = (): boolean =>
  typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false;

/** Shows `el` in full screen. Resolves to false when the browser refused; never throws. */
export async function enterFullscreen(el: Element): Promise<boolean> {
  try {
    await el.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return false;
  }
}

/** Leaves full screen, if anything is in full screen. Never throws. */
export async function exitFullscreen(): Promise<void> {
  if (!current() || typeof document.exitFullscreen !== 'function') return;
  try { await document.exitFullscreen(); } catch { /* full screen already ended */ }
}

/** What a screen reader hears after full screen turns on (`on`) or off; '' until it changed once. */
export function useFullscreenNote(on: string): string {
  const [note, setNote] = useState('');
  useEffect(() => subscribe(() => setNote(current() ? on : 'Full screen is off.')), [on]);
  return note;
}

type Sentinel = { released: boolean; release: () => Promise<void> };
type WakeLockApi = { request: (type: 'screen') => Promise<Sentinel> };

/**
 * Keeps the screen awake while `on`: a Screen Wake Lock, asked for again when the page becomes visible (the browser
 * drops the lock whenever the tab is hidden) and released when `on` turns false. Where the API is missing or the
 * browser refuses (battery saver, an insecure page), nothing happens.
 */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (!on || typeof navigator === 'undefined') return;
    const api = (navigator as { wakeLock?: WakeLockApi }).wakeLock;
    if (!api || typeof api.request !== 'function') return;
    let lock: Sentinel | null = null, done = false, asking = false;
    const ask = async () => {
      if (done || asking || document.visibilityState === 'hidden' || (lock && !lock.released)) return;
      asking = true;
      try {
        const l = await api.request('screen');
        if (done) void l.release().catch(() => undefined);
        else lock = l;
      } catch { /* refused: nothing to do */ }
      asking = false;
    };
    const onVisible = () => { void ask(); };
    void ask();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock && !lock.released) void lock.release().catch(() => undefined);
      lock = null;
    };
  }, [on]);
}

/** Input that counts as someone being there. */
const WAKE = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** How long the Office page waits without input before it hides the header and the cursor. */
export const IDLE_MS = 3000;

/** True after `ms` without pointer movement, a click, a touch, the wheel or a key press, while `on`. */
export function useIdle(on: boolean, ms: number = IDLE_MS): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!on) return;
    let t = setTimeout(() => setIdle(true), ms);
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), ms); };
    for (const e of WAKE) document.addEventListener(e, wake, { capture: true, passive: true });
    return () => {
      clearTimeout(t);
      for (const e of WAKE) document.removeEventListener(e, wake, { capture: true });
      setIdle(false);
    };
  }, [on, ms]);
  return on && idle;
}

/** What Tab can move focus to. */
const TABBABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex], [contenteditable]:not([contenteditable="false"])';
const tabbables = (box: HTMLElement): HTMLElement[] =>
  [...box.querySelectorAll<HTMLElement>(TABBABLE)].filter(e => e.tabIndex >= 0 && !e.closest('[hidden], [inert]'));

/**
 * Keyboard focus for an element shown in full screen in place (the Workspace's office), while `on`: focus moves to
 * `start` when full screen begins, and Tab and Shift + Tab go round inside `box` (the rest of the page is hidden then,
 * but would still take focus). When full screen ends and focus was lost (the exit button that had it is gone), focus
 * goes back to `back`, the control that started it. An open dialog over it (a person's details) keeps its own focus.
 */
export function useFullscreenFocus(on: boolean, box: RefObject<HTMLElement | null>, start: RefObject<HTMLElement | null>, back: RefObject<HTMLElement | null>): void {
  const was = useRef(on);
  useEffect(() => {
    const before = was.current;
    was.current = on;
    if (on) start.current?.focus();
    else if (before) {
      const a = document.activeElement;
      if (!a || a === document.body || !a.isConnected) back.current?.focus();
    }
  }, [on, start, back]);

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      const el = box.current;
      if (!el || e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('dialog[open]')) return;
      const list = tabbables(el), first = list[0], last = list[list.length - 1];
      if (!first || !last) return;
      const to = !t || !el.contains(t) ? (e.shiftKey ? last : first)
        : !e.shiftKey && t === last ? first
        : e.shiftKey && t === first ? last
        : null;
      if (!to) return;
      e.preventDefault();
      to.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [on, box]);
}

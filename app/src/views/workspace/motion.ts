/* Motion of the Workspace (prototype lines 1306, 1317-1323 and 1853-1861):
   - in the Office, people walk to their new room when their status changes (a FLIP animation of 650 ms),
   - a page flies from an agent that finished a job to the agent that receives it (1200 ms). For real work the page can
     also fly to or from the people who decide (MEET): the meeting room in the Office, the Needs approval column in
     the Cards view, where pages fly between agent cards too,
   - the focused person keeps focus when their station moves to another room.
   Both animations are skipped when the person prefers reduced motion; the focus is kept either way. */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { fullscreenHost } from '@/components/fullscreen';
import { MEET } from '@/store/liveAgents';
import { useStore } from '@/store/store';
import type { Handoff } from '@/store/types';

const REDUCE = '(prefers-reduced-motion: reduce)';
/** Respect the system preference and the local visual-motion control. */
export const reduceMotion = (): boolean => (typeof document !== 'undefined' && document.documentElement.dataset.motionPaused === 'true') || (typeof matchMedia === 'function' && matchMedia(REDUCE).matches);
const onReduceChange = (cb: () => void): (() => void) => {
  const q = typeof matchMedia === 'function' ? matchMedia(REDUCE) : null;
  q?.addEventListener?.('change', cb);
  window.addEventListener('meridian-motion-change', cb);
  return () => { q?.removeEventListener?.('change', cb); window.removeEventListener('meridian-motion-change', cb); };
};
/** Whether motion is reduced, kept current for OS settings, local pause and tab visibility. */
export const useReducedMotion = (): boolean => useSyncExternalStore(onReduceChange, reduceMotion, () => false);

type Boxes = Record<string, DOMRect>;
interface Snapshot {
  /** Station and room positions before the change, by element id; null when motion is reduced. */
  boxes: Boxes | null;
  /** id of the focused station ("desk-<agent id>"), or "". */
  focus: string;
}

/** Element id of one end of a hand-off: an agent's desk, or `meet` for the people who decide. */
export const endId = (id: string, meet: string): string => id === MEET ? meet : 'desk-' + id;

const stations = (box: HTMLElement): HTMLElement[] => [...box.querySelectorAll<HTMLElement>('.stn')];
const measure = (box: HTMLElement): Boxes =>
  Object.fromEntries([...stations(box), ...box.querySelectorAll<HTMLElement>('.room[id]')].map(e => [e.id, e.getBoundingClientRect()]));

/**
 * The prototype's flyDoc(o, n): a page icon that arcs from one station to another and disappears. It flies inside the
 * element in full screen, if any (only that element is shown then), else in the page body.
 */
export function flyDoc(o: DOMRect | undefined, n: DOMRect | undefined): void {
  if (!o || !n || reduceMotion()) return;
  const el = document.createElement('span'), icon = document.createElement('span');
  el.className = 'fly'; icon.className = 'ms'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = 'description';
  el.append(icon); (fullscreenHost() ?? document.body).append(el);
  const x0 = o.left + o.width / 2 - 17, y0 = o.top + o.height * 0.4, x1 = n.left + n.width / 2 - 17, y1 = n.top + n.height * 0.4;
  el.animate([
    { transform: `translate(${x0}px,${y0}px) scale(.6)`, opacity: 0 },
    { transform: `translate(${x0}px,${y0 - 18}px) scale(1)`, opacity: 1, offset: 0.15 },
    { transform: `translate(${(x0 + x1) / 2}px,${Math.min(y0, y1) - 56}px) scale(1.1)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${x1}px,${y1}px) scale(.7)`, opacity: 0 },
  ], { duration: 1200, easing: 'ease-in-out' }).onfinish = () => el.remove();
}

/**
 * Runs the Office motion for the element `box` (the .office container).
 * Positions are measured when the agents or the hand-offs change in the store, before React updates the screen, and
 * again after the update; each station that moved more than 2px slides from its old place to the new one. `handoff`
 * is the store's hand-off record: when its seq changes, a page flies for each hand-off that has a receiver, from where
 * the sender was to where the receiver is now (a room for MEET).
 */
export function useOfficeMotion(box: RefObject<HTMLElement | null>, handoff: Handoff): void {
  const snap = useRef<Snapshot | null>(null);
  const seen = useRef(handoff.seq);

  useLayoutEffect(() => useStore.subscribe((s, prev) => {
    const el = box.current;
    if (snap.current || !el || (s.agents === prev.agents && s.handoff === prev.handoff)) return;
    const f = document.activeElement;
    snap.current = { boxes: reduceMotion() ? null : measure(el), focus: f instanceof HTMLElement && f.id.startsWith('desk-') && el.contains(f) ? f.id : '' };
  }), [box]);

  useLayoutEffect(() => {
    const el = box.current, before = snap.current;
    const pairs = handoff.seq !== seen.current ? handoff.pairs : [];
    snap.current = null; seen.current = handoff.seq;
    if (!el || !before) return;
    if (before.focus) { const fe = document.getElementById(before.focus); if (fe && fe !== document.activeElement) fe.focus({ preventScroll: true }); }
    if (!before.boxes || reduceMotion()) return;
    const from = before.boxes, after = measure(el);
    for (const e of stations(el)) {
      const o = from[e.id], n = after[e.id]; if (!o || !n) continue;
      const dx = o.left - n.left, dy = o.top - n.top;
      if (Math.abs(dx) + Math.abs(dy) > 2) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.2,0,0,1)' });
    }
    for (const p of pairs) if (p.to) flyDoc(from[endId(p.from, 'room-meet')], after[endId(p.to, 'room-meet')]);
  });
}

/** Whether a box is at least partly on screen: a page never flies in from or out to a place the person cannot see. */
const onScreen = (r: DOMRect | undefined): r is DOMRect => !!r && r.bottom >= 0 && r.top <= window.innerHeight;
const rectOf = (id: string): DOMRect | undefined => document.getElementById(id)?.getBoundingClientRect();

/**
 * The Cards view: when the hand-off record changes, a page flies between agent cards (or to the Needs approval column,
 * id "ws-approvals", for MEET). Cards do not move, so they are measured once. Only while `on` (real work outside demo
 * mode); nothing moves when the person prefers reduced motion.
 */
export function useCardFlights(handoff: Handoff, on: boolean): void {
  const seen = useRef(handoff.seq);
  useEffect(() => {
    if (handoff.seq === seen.current) return;
    seen.current = handoff.seq;
    if (!on || reduceMotion()) return;
    for (const p of handoff.pairs) {
      if (!p.to) continue;
      const o = rectOf(endId(p.from, 'ws-approvals')), n = rectOf(endId(p.to, 'ws-approvals'));
      if (onScreen(o) && onScreen(n)) flyDoc(o, n);
    }
  }, [handoff, on]);
}

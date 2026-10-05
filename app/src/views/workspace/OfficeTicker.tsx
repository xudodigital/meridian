/* The latest activity on the Office page (OfficeDisplay.tsx): the newest entries of the Workspace's Live activity
   inside the site filter, as a ticker that moves from right to left at a steady reading speed. Styles: the .od-tick
   rules in office-display.css.
   - It moves only when the entries are wider than their lane. Then they are there twice in a row (the second copy is
     hidden from assistive technology and cannot take focus) and the track moves by one copy per loop, so the loop has
     no seam. Otherwise, and when the person prefers reduced motion, the entries stand still, in full.
   - The speed is TICKER_SPEED_EM em of the ticker's text a second, so it grows with the page's text (--od-fs) and a
     longer track takes longer. The length of a loop is measured from the width of one copy (ResizeObserver) into
     --od-tick-dur.
   - It pauses while the pointer is over the ticker (not while the page is idle in full screen: the pointer is hidden
     then and may just have been left there), while focus is inside it, the Pause button included, and with the Pause
     button, whose choice is remembered in this browser (WCAG 2.2.2). Play moves it at once, even with the pointer or
     focus still on the button; they hold it again once they have left the ticker and come back. This is how the
     WAI-ARIA Authoring Practices' auto-rotating carousel behaves.
   - While it moves, any change of the entries waits for the end of a loop, so the track never jumps mid-way. Then
     what is on screen stays where it is: the first entry keeps its place, and newer entries come in from the right
     with the rest of the loop. While it stands still or is paused with the button, changes go in at once, the same
     way. Another site filter replaces the entries at once and starts the loop again: the person just asked for it.
   Nothing is announced as it moves: there is no live region. */
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type FocusEvent } from 'react';
import { Chip, IconButton } from '@/components';
import { hhmm, siteById } from '@/store/rules';
import { KEY_TICKER, readKey, writeKey } from '@/store/storage';
import { useStore, useStoreShallow } from '@/store/store';
import type { LogEntry } from '@/store/types';
import { feedRows } from './helpers';
import { useReducedMotion } from './motion';

/** How many entries the ticker shows. */
export const TICKER_ROWS = 12;
/** Reading speed, in em of the ticker's text a second: 70 CSS px a second at the base 14 px. */
export const TICKER_SPEED_EM = 5;
/** The CSS animation that moves the track (office-display.css). */
const LOOP = 'od-tick';

/** As last measured: the width of one copy of the entries (px) and the length of a loop (s). */
interface Geo { w: number; dur: number }
/** Where the loop was when the entries changed: the first entry then, and how far into a copy the track was (px). */
interface Anchor { key: string; x: number }

/** A key per entry that stays when newer entries arrive: its client id, else its server id, else time, actor and text. */
export function rowKeys(rows: readonly LogEntry[]): string[] {
  const seen = new Map<string, number>();
  return rows.map(l => {
    const k = l.cid ?? (l.id != null ? `#${l.id}` : `${l.t.getTime()}|${l.actor}|${l.act}`);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n ? `${k}~${n}` : k;
  });
}

/** The track's loop, where the browser has the Web Animations API (jsdom does not). */
const loopOf = (track: HTMLElement): Animation | undefined =>
  typeof track.getAnimations === 'function' ? track.getAnimations().find(a => (a as CSSAnimation).animationName === LOOP) : undefined;
/** How far into the current loop, from 0 to 1. */
const progressOf = (a: Animation | undefined): number => a?.effect?.getComputedTiming().progress ?? 0;

/** Moves the loop to `x` px into a copy. */
function seek(track: HTMLElement, geo: Geo, x: number): void {
  const a = loopOf(track);
  if (!a || geo.w <= 0) return;
  a.currentTime = ((((x % geo.w) + geo.w) % geo.w) / geo.w) * geo.dur * 1000;
}

/**
 * Measures the ticker: sets the length of a loop from the width of one copy, keeping the loop where it is, and says
 * whether the entries are wider than their lane. The gap after the last entry of a moving copy does not count.
 */
function measure(lane: HTMLElement, list: HTMLElement, track: HTMLElement, geo: Geo): boolean {
  const fs = parseFloat(getComputedStyle(list).fontSize) || 14;
  const w = list.scrollWidth;
  const last = list.lastElementChild;
  const tail = last ? parseFloat(getComputedStyle(last).paddingRight) || 0 : 0;
  const dur = Math.max(1, Math.round((w / (fs * TICKER_SPEED_EM)) * 10) / 10);
  if (dur !== geo.dur) {
    const a = loopOf(track), p = progressOf(a);
    track.style.setProperty('--od-tick-dur', `${dur}s`);
    if (a) a.currentTime = p * dur * 1000;
  }
  geo.w = w;
  geo.dur = dur;
  return w - tail > lane.clientWidth;
}

/** The ticker. `idle`: the Office page is in full screen with nobody there, and the pointer is hidden. */
export function OfficeTicker({ idle = false }: { idle?: boolean }) {
  const latest = useStoreShallow(s => feedRows(s, TICKER_ROWS));
  const site = useStore(s => s.siteFilter);
  const sites = useStore(s => s.sites);
  const reduce = useReducedMotion();
  /* The entries on screen, and the site filter they were picked with. */
  const [shown, setShown] = useState(() => ({ rows: latest, site }));
  const [over, setOver] = useState(false);
  const [paused, setPaused] = useState(() => readKey(KEY_TICKER) === '1');
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const box = useRef<HTMLElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const geo = useRef<Geo>({ w: 0, dur: 0 });
  const anchor = useRef<Anchor | null>(null);

  const rows = shown.rows;
  const keys = rowKeys(rows);
  /* The store has other entries than those on screen; the person chose another site since they were picked. */
  const fresh = latest !== rows;
  const otherSite = shown.site !== site;
  const move = over && !reduce && rows.length > 0;
  const run = move && !paused && !(hover && !idle) && !focusIn;
  /* While it moves, changes wait for the end of a loop. Not when paused with the button (it could stay so), and not
     another site. */
  const waits = move && !paused && !otherSite;
  /* Wider than the lane while standing still (reduced motion): it scrolls sideways by hand, also with the keyboard. */
  const scroll = over && !move;

  /**
   * Before the entries change while it moves: remembers the first entry and how far the loop has gone, so that what
   * is on screen can stay where it is; for another site, that the loop starts again.
   */
  const keep = (restart: boolean) => {
    const tr = track.current;
    anchor.current = !tr || !move ? null : restart || !keys.length ? { key: '', x: 0 } : { key: keys[0], x: progressOf(loopOf(tr)) * geo.current.w };
  };

  /* Changes go in at once, unless they wait for the end of a loop. Another site goes in at once in any case. */
  useLayoutEffect(() => {
    if (!otherSite && (!fresh || waits)) return;
    if (fresh) keep(otherSite);
    setShown({ rows: latest, site });
  }, [latest, site, shown, waits]);

  /* At the end of a loop the waiting entries go in. */
  const onLoop = useEffectEvent(() => {
    if (!fresh) return;
    keep(false);
    setShown({ rows: latest, site });
  });
  useEffect(() => {
    const tr = track.current;
    if (!tr || !move) return;
    const on = (e: Event) => { if (e.target === tr) onLoop(); };
    tr.addEventListener('animationiteration', on);
    return () => tr.removeEventListener('animationiteration', on);
  }, [move]);

  /* After the entries changed: measure again, and keep on screen what was there. Entries now before the first one
     that was on screen (newer ones) come in from the right after the oldest. When what stays cannot fill the view
     (or the oldest that went were on screen), when the first entry is gone, and for another site, the loop starts
     again from the newest. */
  useLayoutEffect(() => {
    const ln = lane.current, ls = list.current, tr = track.current;
    if (!ln || !ls || !tr) return;
    setOver(measure(ln, ls, tr, geo.current));
    const a = anchor.current;
    anchor.current = null;
    if (!a || !move) return;
    const i = a.key ? keys.indexOf(a.key) : -1;
    const li = i < 0 ? undefined : ls.children[i];
    const x = li ? a.x + li.getBoundingClientRect().left - ls.getBoundingClientRect().left : 0;
    seek(tr, geo.current, x + ln.clientWidth > geo.current.w ? 0 : x);
  }, [rows, move]);

  /* The lane changes width with the window; a copy changes width when the text size or the fonts change. */
  const remeasure = useEffectEvent(() => {
    const ln = lane.current, ls = list.current, tr = track.current;
    if (ln && ls && tr) setOver(measure(ln, ls, tr, geo.current));
  });
  useEffect(() => {
    const ln = lane.current, ls = list.current;
    if (!ln || !ls) return;
    const on = () => remeasure();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', on);
      return () => window.removeEventListener('resize', on);
    }
    const ro = new ResizeObserver(on);
    ro.observe(ln);
    ro.observe(ls);
    return () => ro.disconnect();
  }, []);

  /* The Pause button goes when the ticker stops moving, and a browser may not say that focus left with it: it would
     hold the ticker once it moves again. */
  useLayoutEffect(() => {
    if (!box.current?.contains(document.activeElement)) setFocusIn(false);
  }, [move]);

  const toggle = () => {
    const p = !paused;
    setPaused(p);
    writeKey(KEY_TICKER, p ? '1' : null);
    /* Play moves it at once, though the pointer or focus is still on the button. */
    if (!p) { setHover(false); setFocusIn(false); }
  };
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setFocusIn(false);
  };

  const items = rows.map((l, i) => {
    const s = siteById({ sites }, l.site);
    return <li key={keys[i]}><time>{hhmm(l.t)}</time><span><b>{l.actor}</b> {l.act}{s ? <> <Chip>{s.cc}</Chip></> : null}</span></li>;
  });
  /* The Pause button's name stays the same and aria-pressed says whether it is paused: a name that changed with the
     state would contradict it ("Play the activity ticker", pressed). Its tooltip says what a click does, as its icon
     shows. The second copy is only there while it moves. */
  return (
    <section ref={box} className="od-tick" aria-labelledby="od-tick-h" data-mode={move ? 'move' : 'still'} data-over={over ? '1' : undefined} data-run={run ? '1' : undefined}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setFocusIn(true)} onBlur={onBlur}>
      <h2 id="od-tick-h">Latest activity</h2>
      <div className="od-tick-lane" ref={lane}>
        {move ? (
          <IconButton className="od-tick-pp" tone="tonal" icon={paused ? 'play_arrow' : 'pause'} label="Pause the activity ticker"
            title={paused ? 'Play the activity ticker' : 'Pause the activity ticker'} aria-pressed={paused} onClick={toggle} />
        ) : null}
        <div className="od-tick-view" tabIndex={scroll ? 0 : undefined} role={scroll ? 'group' : undefined} aria-labelledby={scroll ? 'od-tick-h' : undefined}>
          <div className="od-tick-track" ref={track}>
            <ul className="od-tick-list" ref={list}>{items.length ? items : <li className="none"><span>No activity yet.</span></li>}</ul>
            {move ? <ul className="od-tick-list" aria-hidden="true" inert>{items}</ul> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

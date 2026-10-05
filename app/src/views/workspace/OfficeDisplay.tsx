import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { Button, Icon, Pill, SyncBanner } from '@/components';
import { go } from '@/nav';
import { MotionControl } from '@/shell/MotionControl';
import { agentPlanned, cnt, siteById, waitN } from '@/store/rules';
import { useStore } from '@/store/store';
import { AgentSheet } from './AgentSheet';
import { canFullscreen, enterFullscreen, exitFullscreen, useFullscreenElement, useFullscreenNote, useIdle, useWakeLock } from './fullscreen';
import { Office } from './Office';
import { OfficeTicker } from './OfficeTicker';
import './workspace.css';
import './office-display.css';

/** The person is typing: a key press there is text, not a shortcut. */
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || !!t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));

/** Shows the whole page in full screen, or leaves it. */
async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) { await exitFullscreen(); return; }
  if (!(await enterFullscreen(document.documentElement))) useStore.getState().snack('The browser did not allow full screen.', 'fullscreen');
}

/**
 * What the agents are doing right now, counted as the Workspace hero and the Agents section count it. Idle counts the
 * agents that have a desk: outside demo mode a planned agent has none (Office.tsx), so it is not counted as idling.
 */
function Summary() {
  const work = useStore(s => cnt(s, 'work'));
  const wait = useStore(waitN);
  const idle = useStore(s => s.agents.filter(a => a.status === 'idle' && !agentPlanned(s, a)).length);
  const err = useStore(s => cnt(s, 'err'));
  const planned = useStore(s => s.agents.filter(a => agentPlanned(s, a)).length);
  return (
    <ul className="od-sum" aria-label="Right now">
      <li data-k="work"><Icon name="bolt" /><b>{work}</b> working now</li>
      <li data-k={wait ? 'wait' : ''}><Icon name="front_hand" /><b>{wait}</b> needs approval</li>
      <li data-k="idle"><Icon name="coffee" /><b>{idle}</b> idle</li>
      {planned ? <li><Icon name="construction" /><b>{planned}</b> not implemented</li> : null}
      {err ? <li data-k="err"><Icon name="error" /><b>{err}</b> {err === 1 ? 'error' : 'errors'}</li> : null}
    </ul>
  );
}

/**
 * The Office on a page of its own (/office), for a second tab, a second screen or a TV on the wall: a slim header with
 * the live summary, the office floor sized for the screen and the latest activity as a ticker (OfficeTicker.tsx). No
 * side navigation or top bar.
 * F or the Full screen button shows it in full screen; there the header and the cursor hide after 3 seconds without
 * input and come back on any movement or key press, and the screen is kept awake. The header stays while the pointer is
 * over it, or while keyboard focus is in it after Tab or Shift + Tab (a button that was clicked keeps focus too, but
 * that must not hold the header up). A failed save shows under the header and does not hide.
 * "?site=<id>" applies a site filter.
 */
export function OfficeDisplay() {
  const sample = useStore(s => s.sample);
  const sheetOpen = useStore(s => s.agentSheet != null);
  const site = useStore(s => s.siteFilter === 'all' ? undefined : siteById(s, s.siteFilter));
  const full = useFullscreenElement() === document.documentElement;
  const note = useFullscreenNote('Full screen is on. Press F or Escape to leave.');
  const [overHead, setOverHead] = useState(false);
  const [tabbedIn, setTabbedIn] = useState(false);
  const tabbing = useRef(false);
  const idle = useIdle(full && !sheetOpen && !overHead && !tabbedIn);
  const fsOk = canFullscreen();
  useWakeLock(full);

  useEffect(() => {
    document.title = 'Office · Meridian';
    /* A link from the Workspace carries its site filter. */
    const id = new URLSearchParams(window.location.search).get('site');
    const s = useStore.getState();
    if (id && id !== s.siteFilter && siteById(s, id)) s.setSiteFilter(id);
    /* Leaving the page (Open dashboard) leaves full screen too. */
    return () => { if (document.fullscreenElement === document.documentElement) void exitFullscreen(); };
  }, []);

  /* F toggles full screen, except while typing or with a modifier (Ctrl or Cmd + F is the browser's find). */
  useEffect(() => {
    if (!fsOk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      void toggleFullscreen();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fsOk]);

  /* Whether focus moves by Tab: the last key pressed was Tab and no pointer was pressed since. A pointer press in the
     header hands it back to the idle timer. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { tabbing.current = e.key === 'Tab'; };
    const onPointer = () => { tabbing.current = false; setTabbedIn(false); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  const onHeadFocus = () => setTabbedIn(tabbing.current);
  const onHeadBlur = (e: FocusEvent<HTMLElement>) => {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setTabbedIn(false);
  };

  /* A plain click stays in this tab without reloading the app; a middle or modified click opens a new tab as usual. */
  const toDashboard = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go('workspace');
  };

  return (
    <div className="od" data-full={full ? '1' : undefined} data-idle={idle ? '1' : undefined}>
      <div className="od-top">
        <div className="od-clip">
          <header className="od-head" onPointerEnter={() => setOverHead(true)} onPointerLeave={() => setOverHead(false)} onFocus={onHeadFocus} onBlur={onHeadBlur}>
            <div className="od-brand">
              <span className="logo" aria-hidden="true"><Icon name="hub" /></span>
              <div><span className="od-eyebrow">Meridian</span><h1>Office</h1></div>
            </div>
            <Summary />
            <MotionControl />
            {site ? <span className="od-site" title="Needs approval and the activity show this site only"><Icon name="language" />Site: {site.cc} · {site.domain}</span> : null}
            {sample ? <Pill kind="mut">Demo mode: example data</Pill> : null}
            <div className="od-acts">
              {fsOk ? (
                <Button variant="tonal" icon={full ? 'fullscreen_exit' : 'fullscreen'} onClick={() => { void toggleFullscreen(); }} aria-keyshortcuts="F" title={full ? 'Exit full screen (F or Escape)' : 'Full screen (F)'}>
                  <span className="lbl">{full ? 'Exit full screen' : 'Full screen'}</span>
                </Button>
              ) : null}
              <a className="btn text" href="/workspace" onClick={toDashboard} title="Open the Workspace in this tab">
                <Icon name="dashboard" /><span className="lbl">Open dashboard</span>
              </a>
            </div>
          </header>
        </div>
      </div>
      <div className="od-alert"><SyncBanner /></div>
      <main className="od-main">
        <h2 className="sr-only">Office floor</h2>
        <Office big />
      </main>
      <OfficeTicker idle={idle} />
      <p className="sr-only" role="status">{note}</p>
      <AgentSheet />
    </div>
  );
}

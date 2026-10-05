import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { SyncBanner } from '@/components';
import { TITLES } from '@/store/constants';
import { useStore } from '@/store/store';
import type { ViewId } from '@/store/types';
import { Popover } from './Popover';
import { SearchDialog } from './SearchDialog';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';
import { useJourney, closeJourney } from '@/views/journey/state';
const JourneyDialog = lazy(() => import('@/views/journey/JourneyDialog').then(m => ({default:m.JourneyDialog})));

/**
 * The signed-in frame (the prototype's .app): side navigation, backdrop, top bar and the scrolling <main> that holds
 * the current view inside <div class="view">. Also owns the shell-wide keyboard shortcuts.
 */
export function Shell({ view, children }: { view: ViewId; children: ReactNode }) {
  const journey = useJourney(s => s.target);
  useEffect(() => () => closeJourney(), []);
  const navOpen = useStore(s => s.navOpen);
  const setNavOpen = useStore(s => s.setNavOpen);
  const setSearchOpen = useStore(s => s.setSearchOpen);
  const [scrolled, setScrolled] = useState(false);
  const [anim, setAnim] = useState(false);
  const main = useRef<HTMLElement>(null);

  /* On every view change (and at sign-in): scroll to the top, play the entrance animation, set the document title. */
  useEffect(() => {
    document.title = TITLES[view] + ' · Meridian';
    if (main.current) main.current.scrollTop = 0;
    setAnim(true);
    const t = setTimeout(() => setAnim(false), 700);
    return () => clearTimeout(t);
  }, [view]);

  /* Ctrl or Cmd + K opens search; Escape closes the side navigation. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      else if (e.key === 'Escape' && useStore.getState().navOpen) setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setNavOpen, setSearchOpen]);

  const onScroll = (e: UIEvent<HTMLElement>) => setScrolled(e.currentTarget.scrollTop > 4);

  return (
    <>
      <a className="skip-link" href="#view">Skip to content</a>
      <div className="app meridian-next" id="app" data-view={view}>
        <SideNav view={view} />
        <div className="backdrop" id="backdrop" hidden={!navOpen} onClick={() => setNavOpen(false)} />
        <main ref={main} onScroll={onScroll}>
          <TopBar view={view} scrolled={scrolled} />
          <SyncBanner id="syncBanner" />
          <div className="view" id="view" tabIndex={-1} data-anim={anim ? '1' : undefined}>{children}</div>
        </main>
      </div>
      <Popover />
      <SearchDialog />
      {journey ? <Suspense fallback={<div role="status" className="journey-loading">Opening work journey…</div>}><JourneyDialog /></Suspense> : null}
    </>
  );
}


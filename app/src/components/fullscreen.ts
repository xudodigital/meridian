/* Which element is in full screen, for anything that must stay visible there. In element full screen (the Workspace's
   office) the browser paints only that element's subtree and the top layer (open dialogs), so a fixed overlay outside
   it, such as the snackbar or a flying page, is not seen. The whole page in full screen (the root element, on the
   Office page) still shows the body. */
import { useSyncExternalStore } from 'react';

/** Calls `cb` whenever an element enters or leaves full screen; returns the unsubscribe function. */
export const onFullscreenChange = (cb: () => void): (() => void) => {
  document.addEventListener('fullscreenchange', cb);
  return () => document.removeEventListener('fullscreenchange', cb);
};

/** The element in full screen now, or null. */
export const fullscreenElement = (): Element | null => (typeof document === 'undefined' ? null : document.fullscreenElement ?? null);

/** The element in full screen now, or null. The component re-renders when it changes. */
export function useFullscreenElement(): Element | null {
  return useSyncExternalStore(onFullscreenChange, fullscreenElement, () => null);
}

/**
 * Where an overlay that is not in the top layer must go to be seen: the element in full screen, or null when nothing is
 * in full screen or the whole page is (the root element), where the overlay can stay where it is.
 */
export function fullscreenHost(fs: Element | null = fullscreenElement()): Element | null {
  return fs && fs !== document.documentElement ? fs : null;
}

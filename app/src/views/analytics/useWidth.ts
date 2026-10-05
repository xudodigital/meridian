import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * The element's width in pixels, followed as it changes. Charts are drawn at their real size (not scaled with a
 * viewBox) so text keeps its size on a phone. `fallback` is used until the element is measured, and where nothing
 * can be measured (a test).
 */
export function useWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { const n = Math.round(el.clientWidth); if (n > 0) setW(n); };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

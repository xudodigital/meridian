import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface TabItem<T extends string> { id: T; label: ReactNode; icon?: string }
export interface TabsProps<T extends string> {
  /** Accessible name of the tab list. */
  label?: string;
  value: T;
  onChange: (id: T) => void;
  items: readonly TabItem<T>[];
}
/**
 * The prototype's tabsHTML(): a segmented row of role="tab" buttons with aria-selected. The row scrolls sideways when
 * it is wider than the screen; the selected tab is brought into view (a tab opened by URL may be the last of eight).
 */
export function Tabs<T extends string>({ label, value, onChange, items }: TabsProps<T>) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = row.current, t = c?.querySelector('[aria-selected="true"]');
    if (!c || !t) return;
    const cr = c.getBoundingClientRect(), tr = t.getBoundingClientRect();
    if (tr.left < cr.left) c.scrollLeft -= cr.left - tr.left + 8;
    else if (tr.right > cr.right) c.scrollLeft += tr.right - cr.right + 8;
  }, [value]);
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={row}>
      {items.map(t => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.icon ? <Icon name={t.icon} /> : null}{t.label}
        </button>
      ))}
    </div>
  );
}

import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * A longer explanation folded under a short label ("How this works"), so a screen can keep a one-line lede. A native
 * <details>: keyboard and screen readers get it for free, and the text stays in the page for find-in-page.
 */
export function Info({ label = 'How this works', children }: { label?: string; children: ReactNode }) {
  return <details className="more"><summary><Icon name="info" />{label}</summary><div>{children}</div></details>;
}

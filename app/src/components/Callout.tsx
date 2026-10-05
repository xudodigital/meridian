import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface CalloutProps {
  icon: string;
  /** Warning colours instead of error colours. */
  warn?: boolean;
  /** Neutral colours, for status that is not a problem. */
  info?: boolean;
  /** Rendered inside the callout's <p>. */
  children: ReactNode;
}
export function Callout({ icon, warn, info, children }: CalloutProps) {
  return <div className={cx('callout', warn && 'warn', info && 'info')}><Icon name={icon} /><p>{children}</p></div>;
}

import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface TagProps { icon?: string; className?: string; children: ReactNode }
/** The prototype's .tag: a small labelled fact with an optional icon. Wrap several in <div className="tags">. */
export function Tag({ icon, className, children }: TagProps) {
  return <span className={cx('tag', className)}>{icon ? <Icon name={icon} /> : null}{children}</span>;
}

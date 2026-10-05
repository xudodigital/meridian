import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface EmptyProps {
  /** Material Symbol above the title. */
  icon?: string;
  /** A short title: what is missing ("No sites yet"). */
  title?: ReactNode;
  /** The body: one or two sentences on why it is empty and what fills it. */
  children?: ReactNode;
  /** The next step, when there is one: usually one Button. */
  action?: ReactNode;
  className?: string;
}

/**
 * The "nothing here" state: an icon, a short title, a sentence and the next action. Every part is optional, so a
 * plain `<Empty>text</Empty>` is still the quiet one-line box for small places (a popover, a filtered list).
 */
export function Empty({ icon, title, children, action, className }: EmptyProps) {
  return (
    <div className={cx('empty', className)}>
      {icon ? <span className="empty-ico"><Icon name={icon} /></span> : null}
      {title ? <h3>{title}</h3> : null}
      {children != null && children !== false ? (title || icon || action ? <p className="empty-body">{children}</p> : children) : null}
      {action ? <div className="empty-act">{action}</div> : null}
    </div>
  );
}

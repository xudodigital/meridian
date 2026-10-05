import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Lifts on hover. */
  lift?: boolean;
  children: ReactNode;
}
/** The prototype's <article class="card">. Put <header>, .who, .tags, <footer> inside as in the prototype. */
export function Card({ lift, className, children, ...rest }: CardProps) {
  return <article className={cx('card', lift && 'lift', className)} {...rest}>{children}</article>;
}
/** The .cards grid that holds Card elements. */
export function Cards({ children }: { children: ReactNode }) { return <div className="cards">{children}</div>; }

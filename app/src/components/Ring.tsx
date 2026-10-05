import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

export interface RingProps {
  /** 0 to 100. */
  percent: number;
  /** Accessible description, for example "Research used 12 percent of today's tokens". */
  label: string;
  tone?: 'warn' | 'bad';
  /** Text in the middle; defaults to the rounded percentage. */
  children?: ReactNode;
}
/** The conic progress ring. Inside an element with a hue class (h0..h10) it takes the agent colour. */
export function Ring({ percent, label, tone, children }: RingProps) {
  const p = Math.max(0, Math.min(100, percent));
  return <div className={cx('ring', tone)} style={{ '--p': p.toFixed(1) } as CSSProperties} role="img" aria-label={label}><b>{children ?? p.toFixed(0) + '%'}</b></div>;
}

export interface MeterProps {
  /** Extra class, usually the agent hue ("h3"). */
  className?: string;
  /** A Ring, then <h3>, <p> and optionally a Pill. */
  children: ReactNode;
}
/** One .meter card. Wrap several in <div className="meters">. */
export function Meter({ className, children }: MeterProps) { return <div className={cx('meter', className)}>{children}</div>; }

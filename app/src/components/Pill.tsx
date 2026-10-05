import type { ReactNode } from 'react';
import type { PillKind } from '@/store/types';
import { cx } from './cx';

export interface PillProps {
  kind: PillKind;
  /** Pulsing dot, for something in progress. */
  live?: boolean;
  children: ReactNode;
}
/** The prototype's pill(kind, text, live). */
export function Pill({ kind, live, children }: PillProps) {
  return <span className={cx('pill', kind, live && 'live')}>{children}</span>;
}

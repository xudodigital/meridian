import type { ReactNode } from 'react';

export interface TileProps {
  /** The dot beside the label: a primary, b tertiary, c cyan, d success; warn and bad for a count that needs attention. */
  tone: 'a' | 'b' | 'c' | 'd' | 'warn' | 'bad';
  value: ReactNode;
  label: ReactNode;
}
/** One figure of a stat strip: the number with its label. The same on every screen. */
export function Tile({ tone, value, label }: TileProps) {
  return <div className={'tile ' + tone}><b>{value}</b><span>{label}</span></div>;
}
/** The .tiles strip that holds Tile elements. */
export function Tiles({ children }: { children: ReactNode }) { return <div className="tiles">{children}</div>; }

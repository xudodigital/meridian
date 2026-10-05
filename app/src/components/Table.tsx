import { isValidElement, type Key, type ReactNode } from 'react';
import { cx } from './cx';
import { Empty } from './Empty';

/** A column heading: plain text, or a text label (used for data-label) plus what to render in the <th>. */
export type TableCol = string | { label: string; head: ReactNode };

export interface TableProps {
  cols: readonly TableCol[];
  /** One array of cells per row, in column order. */
  rows: readonly (readonly ReactNode[])[];
  /** Indexes of numeric columns (tabular figures, no wrapping). */
  num?: readonly number[];
  /** Shown instead of the table when there are no rows: text for the plain box, or an <Empty> with icon, title and action. */
  empty?: ReactNode;
  /** The data is still being fetched: with no rows yet, the table shows skeleton rows instead of the empty state. */
  loading?: boolean;
  /** Stable React key per row; the row index is used when omitted. */
  rowKey?: (row: readonly ReactNode[], index: number) => Key;
  /** Extra class on <table>, for example "bi" for the two-language article table. */
  tableClass?: string;
  /** Adapt to available container space, for tables inside dialogs. */
  responsive?: 'viewport' | 'container';
}

const colLabel = (c: TableCol): string => typeof c === 'string' ? c : c.label;
/** Bar widths of a skeleton row, varied so the rows do not look like a grid of identical blocks. */
const SKEL = [72, 48, 60, 40, 56, 44];

/**
 * The prototype's tbl(cols, rows, num).
 * Each <td> carries data-label with its column heading: below 840px the CSS turns every row into a card and prints
 * that label beside the value. With 7 or more columns the wrapper gets the class "wide" and stays a card grid up to 1399px.
 * With responsive="container", cards instead depend on the space available inside the table's parent.
 */
export function Table({ cols, rows, num = [], empty = 'Nothing here yet for this site.', loading, rowKey, tableClass, responsive = 'viewport' }: TableProps) {
  const busy = !!loading && !rows.length;
  if (!rows.length && !busy) return isValidElement(empty) && empty.type === Empty ? empty : <Empty>{empty}</Empty>;
  const content = (
    <div className={cx('scroll', cols.length >= 7 && 'wide', responsive === 'container' && 'container-table')} aria-busy={busy || undefined}>
      <table className={tableClass}>
        <thead><tr>{cols.map((c, i) => <th key={i}>{typeof c === 'string' ? c : c.head}</th>)}</tr></thead>
        <tbody>
          {busy ? [0, 1, 2].map(ri => (
            <tr key={ri} className="skel-row">
              {cols.map((c, i) => <td key={i} data-label={colLabel(c)}><span className="skel" style={{ width: SKEL[(i + ri) % SKEL.length] + '%' }} /></td>)}
            </tr>
          )) : rows.map((r, ri) => (
            <tr key={rowKey ? rowKey(r, ri) : ri}>
              {r.map((c, i) => <td key={i} data-label={cols[i] === undefined ? undefined : colLabel(cols[i])} className={num.includes(i) ? 'n' : undefined}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {busy ? <span className="sr-only" role="status">Loading…</span> : null}
    </div>
  );
  return responsive === 'container' ? <div className="table-container">{content}</div> : content;
}

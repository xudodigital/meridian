import { useStore } from '@/store/store';
import { IconButton } from './Button';

export interface Paged<T> {
  /** The rows of the current page. */
  rows: T[];
  /** Zero-based page, clamped to the available pages. */
  page: number;
  pages: number;
  total: number;
  size: number;
}

/**
 * The prototype's paged(key, rows, size). The page index lives in the store under `pg[key]`, so it survives
 * navigation and is reset by the site filter and by tab changes, as in the prototype.
 * Use the same key the prototype uses ("sites", "modes", "dep", "rep").
 */
export function usePaged<T>(key: string, rows: readonly T[], size: number = 10): Paged<T> {
  const stored = useStore(s => s.pg[key] || 0);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(Math.max(0, stored), pages - 1);
  return { rows: rows.slice(page * size, page * size + size), page, pages, total: rows.length, size };
}

export interface PagerProps {
  /** The key given to usePaged. */
  pkey: string;
  /** The value usePaged returned. */
  paged: Pick<Paged<unknown>, 'page' | 'pages' | 'total' | 'size'>;
}
/** "1–10 of 120" with previous and next buttons. Renders nothing when everything fits on one page. */
export function Pager({ pkey, paged }: PagerProps) {
  const setPage = useStore(s => s.setPage);
  const { page: p, pages: n, total, size } = paged;
  if (total <= size) return null;
  return (
    <div className="pager">
      <span className="note">{p * size + 1}–{Math.min(total, (p + 1) * size)} of {total}</span>
      <IconButton icon="chevron_left" label="Previous page" disabled={p === 0} onClick={() => setPage(pkey, p - 1)} />
      <IconButton icon="chevron_right" label="Next page" disabled={p >= n - 1} onClick={() => setPage(pkey, p + 1)} />
    </div>
  );
}

import type { ReactNode } from 'react';
import { MOD_EMPTY, MOD_EMPTY_HEAD, cellText, isModPill, modView } from '@/store/rules';
import { useStoreShallow } from '@/store/store';
import type { ModCell, ModId } from '@/store/types';
import { SiteChip } from './Chip';
import { Empty } from './Empty';
import { Pill } from './Pill';
import { Table } from './Table';

/** Renders one cell of a MOD table: text, a pill, or text followed by a pill. */
export function ModCellView({ cell }: { cell: ModCell }): ReactNode {
  if (Array.isArray(cell)) return <>{cell.map((c, i) => <span key={i}>{i ? ' ' : ''}<ModCellView cell={c} /></span>)}</>;
  return isModPill(cell) ? <Pill kind={cell.pill} live={cell.live}>{cell.text}</Pill> : cell;
}

/** A cell that only says the value is not known. */
const NA = 'n/a';

/**
 * The prototype's modTbl(id): one of the tables in store.mod, filtered by the top-bar site filter, with the
 * Site column inserted (first for gsc, ga4, factory and themes; second for the others).
 * A table with no rows at all says what will fill it; one emptied by the site filter keeps the general text.
 * Outside demo mode a column in which every row says "n/a" is left out: nothing feeds it yet (for example keyword
 * volume and difficulty), and it comes back by itself once a row carries a value. `query` keeps the rows whose text
 * contains it.
 */
export function ModTable({ id, query = '', action }: { id: ModId; query?: string; action?: ReactNode }) {
  const [mod, sites, siteFilter, sample] = useStoreShallow(s => [s.mod, s.sites, s.siteFilter, s.sample] as const);
  const v = modView({ mod, sites, siteFilter }, id);
  const q = query.trim().toLowerCase();
  const rows = q ? v.rows.filter(r => r.cells.some(c => c !== null && cellText(c).toLowerCase().includes(q))) : v.rows;
  const keep = v.cols.map((_, i) => sample || !v.rows.length || v.rows.some(r => { const c = r.cells[i]; return c == null || cellText(c) !== NA; }));
  const only = <T,>(list: readonly T[]): T[] => list.filter((_, i) => keep[i]);
  const [icon, title] = MOD_EMPTY_HEAD[id];
  return (
    <Table
      cols={only(v.cols)}
      num={v.num.filter(i => keep[i]).map(i => keep.slice(0, i).filter(Boolean).length)}
      empty={mod[id].rows.length ? (q && v.rows.length ? 'Nothing matches this search.' : undefined) : <Empty icon={icon} title={title} action={action}>{MOD_EMPTY[id]}</Empty>}
      rows={rows.map(r => only(r.cells).map((c, i) => c === null ? <SiteChip key={i} id={r.site} domain={r.domain} /> : <ModCellView key={i} cell={c} />))}
    />
  );
}

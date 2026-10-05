import { shareText as pc } from '../analytics/model';

/** One row of the ranked list: a site, its value, its share of the total and a smaller second value. */
export interface BarItem { id: string; cc: string; domain: string; value: number; share: number; text: string; secondary: string }
export interface BarsOther { n: number; share: number; text: string; secondary: string }


/**
 * A ranked list of sites: rank, country, domain and value on one line; under it a bar as long as the value against
 * the first row's, the share of the total and the second value. `other` adds the rest of the sites as one total row.
 */
export function Bars({ items, other, label }: { items: readonly BarItem[]; other?: BarsOther | null; label: string }) {
  const top = Math.max(.0001, ...items.map(x => x.value));
  return (
    <ol className="an-rank" aria-label={label}>
      {items.map((x, i) => (
        <li key={x.id}>
          <span className="an-rank-n">{i + 1}</span>
          <span className="an-rank-site"><span className="an-cc">{x.cc}</span><span className="an-rank-d" title={x.domain}>{x.domain}</span></span>
          <b className="an-rank-v">{x.text}</b>
          <span className="an-rank-m"><span className="an-rank-bar" aria-hidden="true"><i style={{ width: Math.max(1, x.value / top * 100) + '%' }} /></span><span className="an-rank-s"><span>{pc(x.share)}</span><span>{x.secondary}</span></span></span>
        </li>
      ))}
      {other ? (
        <li className="other">
          <span className="an-rank-n" aria-hidden="true">+</span>
          <span className="an-rank-site"><span className="an-rank-d">Other {other.n} site{other.n === 1 ? '' : 's'}</span></span>
          <b className="an-rank-v">{other.text}</b>
          <span className="an-rank-m"><span className="an-rank-s"><span>{pc(other.share)}</span><span>{other.secondary}</span></span></span>
        </li>
      ) : null}
    </ol>
  );
}

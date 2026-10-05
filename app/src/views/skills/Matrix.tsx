import { useRef, useState, type KeyboardEvent } from 'react';
import { initials } from '@/store/rules';
import { useStore } from '@/store/store';
import { coverage } from './model';

/**
 * "Coverage": agents down the side, skills across the top under their categories, a filled dot where a skill is
 * attached. Each dot is a toggle button (the same store action as the Assign switches). The grid is one tab stop:
 * the arrow keys move between dots. The row and column of the dot under the pointer or the focus are highlighted.
 */
export function Matrix() {
  const agents = useStore(s => s.agents);
  const skills = useStore(s => s.skills);
  const sample = useStore(s => s.sample);
  const setSkillAgent = useStore(s => s.setSkillAgent);
  const [hot, setHot] = useState<{ r: number; c: number } | null>(null);
  const [cur, setCur] = useState({ r: 0, c: 0 });
  const table = useRef<HTMLTableElement>(null);

  const cov = coverage(agents, skills);
  const nR = cov.rows.length, nC = cov.cols.length;
  if (!nR || !nC) return null;
  /* The cell that holds the tab stop must exist (a skill or agent may have been removed). */
  const at = { r: Math.min(cur.r, nR - 1), c: Math.min(cur.c, nC - 1) };
  /* First column of each category, to draw the group dividers. */
  const starts = new Set<number>(); { let i = 0; for (const g of cov.groups) { starts.add(i); i += g.skills.length; } }

  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    const d = e.key === 'ArrowRight' ? [0, 1] : e.key === 'ArrowLeft' ? [0, -1] : e.key === 'ArrowDown' ? [1, 0] : e.key === 'ArrowUp' ? [-1, 0] : null;
    const to = d ? { r: Math.max(0, Math.min(nR - 1, at.r + d[0]!)), c: Math.max(0, Math.min(nC - 1, at.c + d[1]!)) }
      : e.key === 'Home' ? { r: at.r, c: 0 } : e.key === 'End' ? { r: at.r, c: nC - 1 } : null;
    if (!to) return;
    e.preventDefault(); setCur(to);
    table.current?.querySelector<HTMLButtonElement>(`[data-cell="${to.r}-${to.c}"]`)?.focus();
  };

  return (
    <section className="sx-sec">
      <div className="sx-sec-head">
        <h2>Coverage</h2><span className="sx-count">{cov.attached}</span>
        <p className="sx-cap">Which agent has which skill. Select a dot to attach or detach{sample ? '' : ' (this records your plan and does not change a job yet)'}.</p>
      </div>
      <div className="sx-mx-wrap" onMouseLeave={() => setHot(null)}>
        <table className="sx-mx" ref={table} onKeyDown={onKey} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(null); }}>
          <caption className="sr-only">Skills by agent: {cov.attached} attached. Rows are agents, columns are skills grouped by category. Use the arrow keys to move between cells.</caption>
          <thead>
            <tr className="sx-mx-groups">
              <td rowSpan={2} className="sx-mx-corner" />
              {cov.groups.map(g => <th key={g.id} scope="colgroup" colSpan={g.skills.length}><span>{g.name}</span></th>)}
              <th rowSpan={2} scope="col" className="sx-mx-total"><span className="sx-mx-col">Skills</span></th>
            </tr>
            <tr className="sx-mx-cols">
              {cov.cols.map((k, c) => (
                <th key={k.id} scope="col" className={(starts.has(c) ? 'start ' : '') + (hot?.c === c ? 'hot' : '')}><span className="sx-mx-col" title={k.name}>{k.name}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cov.rows.map((row, r) => (
              <tr key={row.agent.id} className={'h' + row.agent.hue + (hot?.r === r ? ' hot' : '')} data-agent={row.agent.id}>
                <th scope="row"><span className="sx-mx-agent"><span className="sx-ava sm" aria-hidden="true">{initials(row.agent.name)}</span>{row.agent.name}</span></th>
                {row.on.map((on, c) => {
                  const k = cov.cols[c]!;
                  return (
                    <td key={k.id} className={(starts.has(c) ? 'start ' : '') + (hot?.c === c ? 'hot' : '')}>
                      <button type="button" className="sx-cell" data-cell={r + '-' + c} data-on={on ? '1' : undefined} aria-pressed={on}
                        aria-label={`${row.agent.name}: ${k.name}, ${on ? 'attached' : 'not attached'}`} title={`${row.agent.name} · ${k.name}`}
                        tabIndex={at.r === r && at.c === c ? 0 : -1}
                        onMouseEnter={() => setHot({ r, c })} onFocus={() => { setHot({ r, c }); setCur({ r, c }); }}
                        onClick={() => setSkillAgent(k.id, row.agent.id, !on)}>
                        <i aria-hidden="true" />
                      </button>
                    </td>
                  );
                })}
                <td className="sx-mx-total">{row.total}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Agents per skill</th>
              {cov.colTotals.map((n, c) => <td key={cov.cols[c]!.id} className={(starts.has(c) ? 'start ' : '') + (hot?.c === c ? 'hot' : '') + (n ? '' : ' zero')}>{n}</td>)}
              <td className="sx-mx-total">{cov.attached}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <ul className="sx-mx-key" aria-hidden="true">
        <li><i className="on" />Attached</li>
        <li><i />Not attached</li>
      </ul>
    </section>
  );
}

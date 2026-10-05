import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { dayLabel, num } from '@/store/insightsApi';
import './insights.css';

export interface DayPoint { date: string; value: number }

/** The axis top for a largest value: 1, 2 or 5 times a power of ten, so the grid lines are round numbers. */
export function niceMax(max: number): number {
  if (max <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 4, 5, 10]) if (m * p >= max) return Math.max(4, m * p);
  return 10 * p;
}

/**
 * One measure per day as a line over a soft area, from zero. One series, so there is no legend: the title names it.
 * The line and area stretch with the box (the stroke keeps its width); the axis labels are HTML, so text never
 * stretches. Pointing at the plot (or the arrow keys, when it has focus) shows the day under the pointer with its
 * value; the same days are in a table for screen readers.
 */
export function DayChart({ title, unit, days }: { title: string; unit: string; days: readonly DayPoint[] }) {
  const [at, setAt] = useState<number | null>(null);
  const n = days.length;
  if (!n) return null;
  const top = niceMax(Math.max(...days.map(d => d.value)));
  const x = (i: number) => n === 1 ? 50 : i / (n - 1) * 100;
  const y = (v: number) => 100 - v / top * 100;
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(d.value).toFixed(2)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(2)} 100 L${x(0).toFixed(2)} 100 Z`;
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const labels = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) setAt(Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left) / r.width * (n - 1)))));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (e.key === 'Escape') setAt(null);
    if (!step) return;
    e.preventDefault();
    setAt(i => Math.max(0, Math.min(n - 1, (i ?? (step > 0 ? -1 : n)) + step)));
  };
  const cur = at === null ? null : days[at] ?? null;
  const total = days.reduce((s, d) => s + d.value, 0);
  return (
    <figure className="daychart">
      <figcaption>{title}</figcaption>
      <div className="dc-body">
        <div className="dc-y" aria-hidden="true">{ticks.map(t => <span key={t}>{num(top * t)}</span>)}</div>
        <div
          className="dc-plot" role="img" tabIndex={0}
          aria-label={`${title}: ${num(total)} ${unit} from ${dayLabel(days[0]!.date)} to ${dayLabel(days[n - 1]!.date)}. Use the left and right arrow keys to read each day.`}
          onPointerMove={move} onPointerDown={move} onPointerLeave={() => setAt(null)} onKeyDown={key} onBlur={() => setAt(null)}
        >
          {ticks.map(t => <i key={t} className={'dc-grid' + (t === 0 ? ' base' : '')} style={{ top: (1 - t) * 100 + '%' }} />)}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path className="dc-area" d={area} />
            <path className="dc-line" d={line} vectorEffect="non-scaling-stroke" />
          </svg>
          {cur && at !== null ? (
            <>
              <i className="dc-cross" style={{ left: x(at) + '%' }} />
              <i className="dc-dot" style={{ left: x(at) + '%', top: y(cur.value) + '%' }} />
              <div className={'dc-tip' + (x(at) > 60 ? ' left' : '')} style={{ left: x(at) + '%' }} role="status">
                <b>{num(cur.value)} {unit}</b><span>{dayLabel(cur.date)}</span>
              </div>
            </>
          ) : null}
        </div>
        <div className="dc-x" aria-hidden="true">{labels.map(i => <span key={i} style={{ left: x(i) + '%' }} className={i === 0 ? 'first' : i === n - 1 ? 'last' : ''}>{dayLabel(days[i]!.date)}</span>)}</div>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Day</th><th>{unit}</th></tr></thead>
        <tbody>{days.map(d => <tr key={d.date}><td>{d.date}</td><td>{d.value}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

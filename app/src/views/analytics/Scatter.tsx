import { useState, type KeyboardEvent } from 'react';
import { fmt } from '@/store/rules';
import { tokensText, usd } from '@/store/spend';
import { TONE_LABEL, bubbleLabel, plotted, ratioText, scatterLayout, type SiteRow, type SiteTone } from './model';
import { useWidth } from './useWidth';

const TONES: readonly SiteTone[] = ['ok', 'near', 'blocked'];

/**
 * "Traffic against cost": one bubble per site. Across: agent spend in 28 days; up: organic clicks in 28 days; size:
 * tokens; colour: whether the site is fine, near its budget or blocked. Pointing at a bubble, or moving to it with
 * the arrow keys, shows its numbers; a table for screen readers holds every site.
 */
export function Scatter({ rows }: { rows: readonly SiteRow[] }) {
  const [ref, w] = useWidth<HTMLDivElement>(720);
  const [hot, setHot] = useState<string | null>(null);
  const [stop, setStop] = useState<string | null>(null);
  const few = plotted(rows).length <= 8;
  const h = Math.round(Math.min(few ? 380 : 540, Math.max(320, w * 0.8)));
  const L = scatterLayout(rows, w, h);
  const { plot } = L;
  const narrow = w < 520;
  const at = L.bubbles.find(b => b.row.id === hot) ?? null;
  const tabStop = stop && L.order.includes(stop) ? stop : L.order[0];

  const move = (e: KeyboardEvent<SVGGElement>, id: string) => {
    const i = L.order.indexOf(id);
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1
      : e.key === 'Home' ? 0 : e.key === 'End' ? L.order.length - 1 : null;
    if (e.key === 'Escape') { setHot(null); return; }
    if (to == null) return;
    e.preventDefault();
    const next = L.order[(to + L.order.length) % L.order.length];
    setStop(next);
    e.currentTarget.ownerSVGElement?.querySelector<SVGGElement>(`[data-site="${next}"]`)?.focus();
  };
  const present = TONES.filter(t => L.bubbles.some(b => b.row.tone === t));
  const below = at ? at.y - at.r < 120 : false;

  return (
    <div className="an-scatter">
      <div className="an-plot" ref={ref} style={{ height: h }}>
        <svg width={w} height={h} role="group" aria-label={`Bubble chart of ${L.bubbles.length} sites: agent spend across, organic clicks up. Use the arrow keys to move between sites.`}>
          {/* Grid and axes: hairlines, one step off the surface. */}
          <g className="an-grid" aria-hidden="true">
            {L.yTicks.map(t => <line key={'y' + t.v} x1={plot.l} x2={plot.r} y1={t.at} y2={t.at} />)}
            {L.xTicks.map(t => <line key={'x' + t.v} x1={t.at} x2={t.at} y1={plot.t} y2={plot.b} />)}
          </g>
          <g className="an-axis" aria-hidden="true">
            {L.yTicks.map(t => <text key={t.v} x={plot.l - 8} y={t.at} dy="0.32em" textAnchor="end">{t.text}</text>)}
            {L.xTicks.map((t, i) => <text key={t.v} x={t.at} y={plot.b + 18} textAnchor={i === L.xTicks.length - 1 ? 'end' : 'middle'}>{t.text}</text>)}
            <text className="an-axis-t" x={plot.l - (narrow ? 32 : 44)} y={12}>Organic clicks</text>
            <text className="an-axis-t" x={plot.r} y={h - 6} textAnchor="end">Agent spend, 28 days</text>
          </g>
          {/* Quadrants: split at the median site, named in plain words. */}
          <g className="an-quad" aria-hidden="true">
            {L.guides ? <line x1={L.xMid} x2={L.xMid} y1={plot.t} y2={plot.b} /> : null}
            {L.guides ? <line x1={plot.l} x2={plot.r} y1={L.yMid} y2={L.yMid} /> : null}
            {L.quads.map(q => <text key={q.key} x={q.x} y={q.y} textAnchor={q.anchor}>{q.text}</text>)}
          </g>
          <g>
            {L.bubbles.map(b => (
              <g key={b.row.id} className={'an-bub ' + b.row.tone + (hot === b.row.id ? ' hot' : '')} data-site={b.row.id} role="img" aria-label={bubbleLabel(b.row)}
                tabIndex={b.row.id === tabStop ? 0 : -1}
                onPointerEnter={() => setHot(b.row.id)} onPointerLeave={() => setHot(v => v === b.row.id ? null : v)}
                onFocus={() => { setHot(b.row.id); setStop(b.row.id); }} onBlur={() => setHot(v => v === b.row.id ? null : v)}
                onKeyDown={e => move(e, b.row.id)}>
                <circle className="hit" cx={b.x} cy={b.y} r={Math.max(12, b.r + 3)} />
                <circle className="dot" cx={b.x} cy={b.y} r={b.r} />
              </g>
            ))}
          </g>
          <g className="an-labels" aria-hidden="true">
            {L.bubbles.map(b => b.label ? <text key={b.row.id} x={b.label.x} y={b.label.y} dy="0.32em" textAnchor={b.label.anchor}>{b.row.domain}</text> : null)}
          </g>
          {at ? <circle className={'an-ring ' + at.row.tone} cx={at.x} cy={at.y} r={at.r + 3} aria-hidden="true" /> : null}
        </svg>
        {at ? (
          <div className={'an-tip' + (below ? ' below' : '')} aria-hidden="true"
            style={{ left: Math.min(Math.max(at.x, 104), w - 104), top: below ? at.y + at.r + 10 : at.y - at.r - 10 }}>
            <b>{at.row.domain}</b>
            <span className={'an-key ' + at.row.tone}>{at.row.cc} · {TONE_LABEL[at.row.tone]}</span>
            <dl>
              <div><dt>Organic clicks</dt><dd>{fmt(at.row.clicks)}</dd></div>
              <div><dt>Agent spend</dt><dd>{usd(at.row.spend28)}</dd></div>
              <div><dt>Tokens</dt><dd>{tokensText(at.row.tokens28)}</dd></div>
              <div><dt>Clicks per $1</dt><dd>{at.row.spend28 > 0 && at.row.clicks > 0 ? ratioText(at.row.clicks / at.row.spend28) : '—'}</dd></div>
            </dl>
          </div>
        ) : null}
      </div>
      <ul className="an-legend" aria-label="What the colours and sizes mean">
        {present.map(t => <li key={t}><span className={'an-key ' + t}>{TONE_LABEL[t]}</span></li>)}
        <li><span className="an-size" aria-hidden="true"><i /><i /></span>Bubble size: tokens used</li>
        {L.hidden ? <li>{L.hidden} site{L.hidden === 1 ? '' : 's'} with no clicks or spend {L.hidden === 1 ? 'is' : 'are'} not drawn</li> : null}
      </ul>
      <table className="an-sr">
        <caption>Traffic against cost, 28 days: every site in the chart</caption>
        <thead><tr><th scope="col">Site</th><th scope="col">Country</th><th scope="col">Organic clicks</th><th scope="col">Agent spend</th><th scope="col">Tokens</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {L.order.map(id => { const r = L.bubbles.find(b => b.row.id === id)!.row; return (
            <tr key={id}><th scope="row">{r.domain}</th><td>{r.cc}</td><td>{fmt(r.clicks)}</td><td>{usd(r.spend28)}</td><td>{tokensText(r.tokens28)}</td><td>{TONE_LABEL[r.tone]}</td></tr>
          ); })}
        </tbody>
      </table>
    </div>
  );
}

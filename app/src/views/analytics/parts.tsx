/* The cards of the Analytics overview other than the bubble chart. Each takes numbers worked out in model.ts. */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Empty, Icon, Info, Pill, cx } from '@/components';
import { go } from '@/nav';
import { fmt, runtimeModel } from '@/store/rules';
import { tokensText, usd } from '@/store/spend';
import { useStore } from '@/store/store';
import { Bars } from '../system/Bars';
import { budgetList, money, ratioText, shareText, topSites, type AgentShare, type Insight, type SiteRow, type Totals } from './model';
import { useWidth } from './useWidth';

/** A card of the overview: a title, one line that says what it shows, and the content. */
export function Card({ title, desc, span, aside, children }: { title: string; desc?: ReactNode; span?: 4 | 5 | 7 | 8; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={cx('an-card', span && 'an-c' + span)}>
      <header className="an-head">
        <h2>{title}</h2>
        {aside ? <div className="an-aside">{aside}</div> : null}
        {desc ? <p className="an-desc">{desc}</p> : null}
      </header>
      {children}
    </section>
  );
}

/* ---------- KPI strip ---------- */

function Kpi({ label, value, sub, children }: { label: string; value: ReactNode; sub: ReactNode; children?: ReactNode }) {
  return <div className="an-kpi"><span className="an-kpi-l">{label}</span><b className="an-kpi-v">{value}</b>{children}<span className="an-kpi-s">{sub}</span></div>;
}

export function Kpis({ t, budget, gsc, sample, local = false }: { t: Totals; budget: number; gsc: boolean; sample: boolean; local?: boolean }) {
  const p = t.todayPct, tone = p >= 100 ? 'bad' : p >= 80 ? 'warn' : '';
  return (
    <div className="an-kpis">
      <Kpi label="Organic clicks, 28 days" value={gsc ? fmt(t.clicks) : '—'}
        sub={!gsc ? 'Search Console is not connected' : t.clicks > 0 ? `${t.withClicks} of ${t.sites} site${t.sites === 1 ? ' has' : 's have'} traffic` : 'No clicks recorded yet. Data arrives about 3 days late.'} />
      <Kpi label={local ? 'API/service spend today' : 'Agent spend today'} value={money(t.today)}
        sub={t.sites === 1 ? `${shareText(p)} of the ${money(budget)} daily budget` : `${shareText(p)} of ${money(t.budgetAll)}: ${t.sites} sites at ${money(budget)} a day`}>
        <span className={cx('an-gauge', tone)} role="img" aria-label={`${Math.round(p)} percent of the total daily budget used`}><i style={{ width: Math.min(100, p) + '%' }} /></span>
      </Kpi>
      <Kpi label="Tokens used, 28 days" value={tokensText(t.tokens28)}
        sub={t.tokens28 > 0 ? (sample ? `About ${money(t.spend28)} at list prices` : `${money(t.spend28)} of ${local ? 'API/service' : 'agent'} spend`) : 'Counted each time an agent runs a job'} />
      <Kpi label="Clicks per $1 of agent spend" value={t.perUsd == null ? '—' : ratioText(t.perUsd)}
        sub={t.perUsd == null ? 'Shown once sites have both clicks and spend' : `${fmt(t.clicks)} clicks for ${money(t.spend28)}, 28 days`} />
    </div>
  );
}

/* ---------- Needs attention ---------- */

export function Attention({ items }: { items: readonly Insight[] }) {
  const setAtab = useStore(s => s.setAtab);
  if (!items.length) {
    return <p className="an-clear"><Icon name="check_circle" fill /><span><b>All clear.</b> No site is near its budget, blocked or spending without traffic.</span></p>;
  }
  return (
    <section className="an-attn">
      <h2>Needs attention</h2>
      <div className="an-insights">
        {items.map(x => (
          <article key={x.id} className={'an-insight ' + x.tone}>
            <span className="an-insight-i"><Icon name={x.icon} /></span>
            <div>
              <h3>{x.title}</h3>
              <p>{x.body}</p>
              {x.action ? <Button variant="text" size="sm" onClick={() => { const a = x.action!; if (a.to === 'gsc') setAtab('gsc'); else go(a.to); }}>{x.action.label}</Button> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ---------- Small data: sites side by side instead of a chart ---------- */

const tonePill = (r: SiteRow): ReactNode =>
  r.access === 'blocked' ? <Pill kind="bad">Blocked</Pill> : r.access === 'down' ? <Pill kind="bad">Not reachable</Pill>
    : r.pct >= 100 ? <Pill kind="bad">Stopped</Pill> : r.pct >= 80 ? <Pill kind="warn">Over 80%</Pill> : null;

/** With one or two sites (or before clicks are measured) a chart would be mostly empty: the same numbers, per site. */
export function Compare({ rows, gsc }: { rows: readonly SiteRow[]; gsc: boolean }) {
  const shown = [...rows].sort((a, b) => b.clicks - a.clicks || b.spend28 - a.spend28).slice(0, 4);
  const many = shown.length > 1;
  const max = (f: (r: SiteRow) => number) => Math.max(.0001, ...shown.map(f));
  const mC = max(r => r.clicks), mS = max(r => r.spend28), mT = max(r => r.tokens28);
  const stat = (label: string, value: string, part?: number, quiet?: boolean) => (
    <div key={label} className={cx('an-stat', quiet && 'quiet')}>
      <dt>{label}</dt><dd>{value}</dd>
      {many && part != null ? <span className="an-stat-bar" aria-hidden="true"><i style={{ width: part * 100 + '%' }} /></span> : null}
    </div>
  );
  return (
    <div className={cx('an-compare', many && 'many')}>
      {shown.map(r => (
        <div key={r.id} className="an-site">
          <div className="an-site-h"><span className="an-cc">{r.cc}</span><b>{r.domain}</b>{tonePill(r)}</div>
          <dl>
            {gsc ? stat('Organic clicks', fmt(r.clicks), r.clicks / mC) : stat('Organic clicks', 'Not measured', undefined, true)}
            {stat('Agent spend', usd(r.spend28), r.spend28 / mS)}
            {stat('Tokens used', tokensText(r.tokens28), r.tokens28 / mT)}
            {stat('Clicks per $1', r.clicks > 0 && r.spend28 > 0 ? ratioText(r.clicks / r.spend28) : '—', undefined, !(r.clicks > 0 && r.spend28 > 0))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/* ---------- Top sites ---------- */

export function TopSites({ rows, span }: { rows: readonly SiteRow[]; span?: 4 }) {
  const r = topSites(rows);
  const clicks = r.metric === 'clicks';
  return (
    <Card title="Top sites" span={span}
      desc={clicks ? 'By organic clicks in 28 days, with each site\'s share of all clicks and its agent spend.' : 'By agent spend in 28 days, with each site\'s share of all spend and its tokens. No clicks are recorded yet.'}>
      <Bars items={r.items} other={r.other} label={clicks ? 'Sites by organic clicks' : 'Sites by agent spend'} />
    </Card>
  );
}

/* ---------- Token use by agent, today ---------- */

export function AgentTokens({ use, sample, local = false }: { use: readonly AgentShare[]; sample: boolean; local?: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>(640);
  const [hot, setHot] = useState<string | null>(null);
  const live = useStore(s => s.live);
  const total = use.reduce((n, u) => n + u.tokens, 0), cost = use.reduce((n, u) => n + u.cost, 0);
  const how = sample
    ? <p>Each segment is the agent's share of all tokens used today, across every site. Cost uses each agent's current model at its standard list price, assuming three input tokens per output token, with no caching or batch discount. The 28-day spend per site on this screen is estimated from its tokens the same way.</p>
    : <p>Every run of an agent job is recorded with reported token usage, including failed runs and retries. API costs are estimated from reported usage; Codex subscription costs are not estimated. "Today" is this computer's day, from midnight. Each segment is the agent's share of all tokens used today, across every site. What each single job cost is in Activity, under Runs, and the weekly figures per site are in the Reports tab.</p>;
  if (!use.length) {
    return (
      <Card title="Token use by agent, today" span={7}>
        <Empty icon="toll" title="No agent has used tokens today">{sample ? 'Each agent\'s share is shown here once it has done some work.' : 'Agent token usage appears after the first job today.'}</Empty>
        <Info label="How this is worked out">{how}</Info>
      </Card>
    );
  }
  return (
    <Card title="Token use by agent, today" span={7} desc="Each agent's share of all tokens used today, across every site."
      aside={<><b>{tokensText(total)}</b> tokens · {local ? 'API/service ' : sample ? 'about ' : ''}{usd(cost)}</>}>
      <div className="an-stack" ref={ref} role="img" aria-label={'Share of today\'s tokens: ' + use.map(u => `${u.name} ${shareText(u.share)}`).join(', ')}>
        {use.filter(u => u.share > 0).map(u => {
          const px = u.share / 100 * w, name = u.name + ' ' + shareText(u.share);
          const fits = px >= name.length * 7.2 + 20, pctFits = px >= 44;
          return (
            <span key={u.id} className={cx('an-seg', 'h' + u.hue, hot && hot !== u.id && 'dim')} style={{ flexGrow: u.share } as CSSProperties}
              title={`${u.name}: ${tokensText(u.tokens)} tokens, ${shareText(u.share)}`}
              onPointerEnter={() => setHot(u.id)} onPointerLeave={() => setHot(null)}>
              {fits ? name : pctFits ? shareText(u.share) : null}
            </span>
          );
        })}
      </div>
      <div className="an-tablewrap">
        <table className="an-table">
          <thead><tr><th scope="col">Agent</th><th scope="col" className="an-hide-s">{local ? 'Configured runtime' : 'Model'}</th><th scope="col" className="r">Tokens</th><th scope="col" className="r">{local ? 'API/service spend' : sample ? 'Est. cost' : 'Cost'}</th><th scope="col" className="r">Share</th></tr></thead>
          <tbody>
            {use.map(u => (
              <tr key={u.id} className={cx('h' + u.hue, hot === u.id && 'hot')} onPointerEnter={() => setHot(u.id)} onPointerLeave={() => setHot(null)}>
                <th scope="row"><span className="an-agent"><i className="an-sw" aria-hidden="true" /><span>{u.name}</span>{u.top ? <Pill kind="warn">Highest use</Pill> : null}</span></th>
                <td className="an-hide-s an-model">{local ? runtimeModel({live}, u.model) : u.model}</td>
                <td className="r">{tokensText(u.tokens)}</td>
                <td className="r">{usd(u.cost)}{u.runs != null ? <span className="an-runs"> · {u.runs} run{u.runs === 1 ? '' : 's'}</span> : null}</td>
                <td className="r"><b>{shareText(u.share)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Info label="How this is worked out">{how}</Info>
    </Card>
  );
}

/* ---------- Spend today against the daily budget ---------- */

export function BudgetCard({ rows, budget }: { rows: readonly SiteRow[]; budget: number }) {
  const b = budgetList(rows);
  const title = 'Spend today against the daily budget';
  if (!b.shown.length) {
    return (
      <Card title={title} span={5}>
        <Empty icon="savings" title="No agent spend today">Each site's spend is measured here against its daily budget of {usd(budget)}. At 100% its agent jobs stop until midnight.</Empty>
      </Card>
    );
  }
  return (
    <Card title={title} span={5} desc={b.summary}>
      <ul className="an-budget">
        {b.shown.map(r => {
          const tone = r.pct >= 100 ? 'bad' : r.pct >= 80 ? 'warn' : '';
          return (
            <li key={r.id} className={tone}>
              <span className="an-b-site"><span className="an-cc">{r.cc}</span><span className="an-b-d" title={r.domain}>{r.domain}</span>{r.pct >= 100 ? <Pill kind="bad">Stopped</Pill> : r.pct >= 80 ? <Pill kind="warn">Over 80%</Pill> : null}</span>
              <span className="an-b-amt"><b>{usd(r.today)}</b> of {usd(budget)}</span>
              <span className="an-b-track" role="img" aria-label={`${r.domain} used ${Math.floor(r.pct)} percent of its budget`}><i style={{ width: Math.min(100, r.pct) + '%' }} /></span>
            </li>
          );
        })}
      </ul>
      <p className="an-foot">
        <span className="an-b-key" aria-hidden="true" />The mark is 80%; the end of the bar is the limit.
        {b.more ? ` ${b.more} more site${b.more === 1 ? '' : 's'} spent less today.` : ''}
        {' '}When a site uses its whole budget, new agent jobs for it are refused and the waiting ones are held until midnight or until the budget is raised in Settings.
      </p>
    </Card>
  );
}

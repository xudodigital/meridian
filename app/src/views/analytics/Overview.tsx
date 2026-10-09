import { Button, Empty } from '@/components';
import { go } from '@/nav';
import { codexLocal, showCosts } from '@/store/rules';
import { heldJobs, usd } from '@/store/spend';
import { useStore, useStoreShallow } from '@/store/store';
import { LocalOverview } from './LocalOverview';
import { Scatter } from './Scatter';
import { AgentTokens, Attention, BudgetCard, Card, Compare, Kpis, TopSites } from './parts';
import { MIN_GUIDES, agentShares, agentUse, budgetOf, centreMode, insights, plotted, siteRows, totals } from './model';
import './analytics.css';

/**
 * The Overview tab of Analytics. Top to bottom: four figures, what needs a person, traffic against cost per site (a
 * bubble chart, or the sites side by side when there are too few for one), the ranked list of sites, the agents'
 * share of today's tokens and today's spend against the budget. Demo mode draws the simulation's numbers; otherwise
 * every number is measured (Search Console and the server's spend ledger) and what is missing is said, not drawn.
 */
export function Overview() {
  const [sites, siteFilter, sample, live, settings, agents] = useStoreShallow(s => [s.sites, s.siteFilter, s.sample, s.live, s.settings, s.agents] as const);
  const gsc = useStore(s => s.sample || !!s.ints.find(x => x.id === 'gsc')?.tail);
  const costs = useStore(showCosts);
  const admin = useStore(s => s.session?.role === 'admin');
  const local = !sample && codexLocal({live});
  const state = { sites, siteFilter, sample, live, settings, agents };
  const rows = siteRows(state), budget = budgetOf(state);
  const t = totals(rows, budget);
  const use = agentShares(agentUse(state));
  const mode = centreMode(rows);
  const held = rows.filter(r => r.pct >= 100).reduce((n, r) => n + heldJobs({ live, sample }, r.id), 0);
  const lede = <p className="lede">How the sites compare: clicks from Search Console, and what the agents used and spent.</p>;
  const connect = !gsc && admin ? <Button variant="tonal" icon="extension" onClick={() => go('integrations')}>Connect Search Console</Button> : undefined;

  if (!costs) return <LocalOverview />;
  if (!rows.length) {
    return (
      <>
        {lede}
        <Empty icon="monitoring" title="No sites to compare yet" action={<Button variant="tonal" icon="language" onClick={() => go('sites')}>Open Sites</Button>}>
          Add a domain in Sites. Its clicks, agent spend and tokens are compared here once there is something to measure.
        </Empty>
      </>
    );
  }
  const quiet = mode === 'empty' && !use.length && !rows.some(r => r.today > 0);
  const wide = plotted(rows).length > 2;
  return (
    <>
      {lede}
      {local ? <p className="note">Dollar figures cover recorded API and service spend. Codex subscription costs are not estimated; ChatGPT usage limits apply.</p> : null}
      <div className="an-wrap">
        <div className="an">
          <Kpis t={t} budget={budget} gsc={gsc} sample={sample} local={local} />
          {quiet ? (
            <Empty className="an-full" icon="monitoring" title="Nothing measured yet" action={connect}>
              {gsc ? 'Search Console is connected; its clicks arrive about 3 days late. ' : 'Clicks come from Search Console once it is connected. '}
              Spend and tokens are recorded each time an agent runs a job. Each site's spend is measured here against its daily budget of {usd(budget)}. At 100% its agent jobs stop until midnight.
            </Empty>
          ) : (
            <>
              <Attention items={insights(rows, { budget, gsc, admin, held })} />
              {mode === 'scatter' ? (
                <Card title="Traffic against cost" span={8} desc={'One bubble per site, 28 days. Higher is more organic clicks; further right is more agent spend.' + (plotted(rows).length >= MIN_GUIDES ? ' The lines mark the median site.' : '')}>
                  <Scatter rows={rows} />
                </Card>
              ) : mode === 'compare' ? (
                <Card title="Traffic against cost" span={wide ? 8 : undefined} desc={gsc ? 'Organic clicks and agent spend per site, 28 days.' : 'Agent spend and tokens per site, 28 days. Clicks appear once Search Console is connected.'}>
                  <Compare rows={plotted(rows)} gsc={gsc} />
                </Card>
              ) : (
                <Card title="Traffic against cost">
                  <Empty icon="bubble_chart" title="No clicks or spend in the last 28 days" action={connect}>
                    {gsc ? 'Each site is placed here by its organic clicks and its agent spend once it has either.' : 'Each site is placed here by its organic clicks and its agent spend. Clicks come from Search Console once it is connected.'}
                  </Empty>
                </Card>
              )}
              {mode !== 'empty' && wide ? <TopSites rows={rows} span={4} /> : null}
              <AgentTokens use={use} sample={sample} local={local} />
              <BudgetCard rows={rows} budget={budget} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

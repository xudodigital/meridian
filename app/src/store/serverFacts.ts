/* What the server knows about services and sites, put into the store outside demo mode: the integration cards
   (connected, last four characters, the last test), each site's access from its country and when it was checked,
   Search Console clicks, and the site's last deploy and newest build from its website builds (the Site builds table of
   Workflows). A mutator like liveApply: called with an immer draft after the server's answer or an event, and after
   the sites document is applied (sync.ts), because the document does not carry these server-owned fields (workspace.ts
   docOf strips them). The spend ledger's sums go the same way (spend.ts): a site's spend today and 28-day tokens, and
   each agent's tokens today. */
import { building, deployText, deploying, siteBuilds } from './builds';
import { dayTime, modPill } from './rules';
import { spendTo } from './spend';
import type { Agent, AppState, BuildWire, Integration, IntegrationWire, ModCell } from './types';

/** `agents` is optional so a caller that only has the sites (a test, the builds mutator) still type-checks. */
export type FactsTarget = Pick<AppState, 'live' | 'ints' | 'sites' | 'sample' | 'mod'> & { agents?: Agent[] };

/** The short label on a card's status pill. The full result is the card's note. */
export const statusLabel = (w: IntegrationWire): string =>
  !w.connected ? 'Not connected' : w.status === 'ok' ? 'Connected' : w.status === 'warn' ? 'Needs attention' : w.status === 'bad' ? 'Not working' : w.worksWithout && !w.updatedAt ? 'Ready' : 'Not tested';

function intTo(n: Integration, w: IntegrationWire | undefined): void {
  if (!w || !w.connected) { n.tail = null; n.st = null; n.msg = null; return; }
  n.tail = w.tail || 'Connected';
  n.st = w.status === 'ok' || (w.worksWithout && !w.updatedAt && w.status === '') ? 'ok' : w.status === 'warn' ? 'warn' : w.status === 'bad' ? 'bad' : null;
  n.msg = statusLabel(w);
}

export function serverFactsTo(d: FactsTarget): void {
  if (d.sample) return;
  const L = d.live;
  if (Object.keys(L.ints).length) d.ints.forEach(n => intTo(n, L.ints[n.id]));
  d.sites.forEach(s => {
    const a = L.access[s.id];
    const own = a && a.domain === s.domain ? a : undefined;
    s.access = own && own.result !== 'error' ? own.result : 'pending';
    s.checked = own ? dayTime(own.at) : '—';
    const m = L.metrics?.sites[s.id];
    s.clicks = m ? m.clicks28 : 0;
    s.deploy = deployText(siteBuilds(L.builds, s));
  });
  spendTo(d);
  /* The "Site builds" table of Workflows: one row per site, its newest build. */
  d.mod.factory.rows = d.sites.flatMap(s => {
    const b = siteBuilds(L.builds, s)[0];
    if (!b) return [];
    const [stage, progress] = buildStage(b);
    return [{ s: s.id, c: [stage, `Static site v${b.version}`, String(b.pages), progress] }];
  });
  /* The Search Console tab of Analytics: one row per site with a property. */
  const n = (v: number) => Math.round(v).toLocaleString('en-US');
  d.mod.gsc.rows = d.sites.flatMap(s => {
    const m = L.metrics?.sites[s.id];
    return m ? [{ s: s.id, c: [n(m.clicks28), n(m.impressions28), m.impressions28 ? (m.clicks28 / m.impressions28 * 100).toFixed(1) + '%' : '0%', m.position28 ? m.position28.toFixed(1) : '—'] }] : [];
  });
}

/** Where a site's newest build is, for the "Site builds" table of Workflows: [current stage, progress]. */
function buildStage(b: BuildWire): [string, ModCell] {
  if (building(b)) return [b.status === 'queued' ? 'Waiting in the queue' : b.step || 'Starting', modPill('info', 'Building', true)];
  if (b.status === 'failed') return ['Build', modPill('bad', 'Failed')];
  if (b.review === 'waiting') return ['Review', modPill('warn', 'Needs approval')];
  if (b.review === 'rejected') return ['Review', modPill('bad', 'Rejected')];
  if (deploying(b)) return ['Deploy', modPill('info', 'Deploying', true)];
  if (b.deploy === 'failed') return ['Deploy', modPill('bad', 'Deploy failed')];
  return b.deploy === 'live' ? ['Live', modPill('ok', 'Live')] : ['Approved', modPill('mut', 'Not live')];
}

/** The ids of the services that are connected and whose last test did not fail. */
export const usableInt = (s: Pick<AppState, 'live'>, id: string): boolean => { const w = s.live.ints[id]; return !!w && w.connected && w.status !== 'bad'; };

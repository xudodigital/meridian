import { Button, Callout, Empty, Info, Pager, Pill, SiteChip, Table, Tabs, usePaged } from '@/components';
import { go } from '@/nav';
import { OperationScene } from './visual/OperationScene';
import { wentLive } from './deploy/parts';
import { ACC, DTABS, inSite, liveVer, siteById, stamp } from '@/store/rules';
import { usableInt } from '@/store/serverFacts';
import { NO_PROBE } from '@/store/slices/sites';
import { useStore, useStoreShallow } from '@/store/store';
import type { Site } from '@/store/types';
import { BuildHistory } from './deploy/BuildHistory';
import { WebsiteSection } from './deploy/WebsiteSection';
import { Workflows } from './Workflows';
import { ApprovalQueue } from './sites/ApprovalQueue';
import { DeployTimeline } from './sites/DeployTimeline';

/** Build and deploy: two tabs, the website (builds, approvals, domain access, deploys) and the workflows. */
export function Deploy() {
  const tab = useStore(s => s.dtab);
  const setTab = useStore(s => s.setDtab);
  return (
    <>
      <Tabs label="Build and deploy sections" value={tab} onChange={setTab} items={DTABS.map(([id, label]) => ({ id, label }))} />
      {tab === 'workflows' ? <Workflows /> : <><OperationScene kind="deploy" /><DeployWebsite /></>}
    </>
  );
}

/**
 * The Website tab: access checks, approvals, deploy timeline and history. Prototype: vDeploy() and timelineHTML(),
 * lines 1522-1536 and 1562-1566. Slice: sites. Outside demo mode it starts with the websites: the Site Builder builds
 * each site from its approved articles, a person previews and approves the build, and Deploy & Monitor puts it live on
 * Cloudflare Pages; the queue, timeline and history are made of those builds.
 */
export function DeployWebsite() {
  const sample = useStore(s => s.sample);
  /* The note under the timeline belongs to a drawn timeline only (A9). */
  const drawn = useStore(s => s.sample ? s.deploys.some(d => siteById(s, d.site) && inSite(s, d.site)) : Object.values(s.live.builds).some(b => wentLive(b) && siteById(s, b.siteId) && inSite(s, b.siteId)));
  const history = <p className="note">Roll back to an earlier version; newer builds stay available.</p>;
  if (sample) {
    return (
      <>
        <p className="lede">Deploys, approvals and whether each domain opens from inside its country.</p>
        <Info><p>Access is tested from a network inside the target country, because blocking happens at the local ISP or DNS level. In demo mode the checks are simulated.</p></Info>
        <BlockedCallout />
        <section><h2>Domain access by country</h2><AccessTable /></section>
        <section><h2>Needs approval</h2><ApprovalQueue /></section>
        <section><h2>Deploy timeline</h2><DeployTimeline />{drawn ? <p className="note">Oldest on the left. The rank effect is the average position change 7 days after the deploy, from Search Console.</p> : null}</section>
        <section><h2>Deploy history</h2><DeployHistory />{history}</section>
      </>
    );
  }
  return (
    <>
      <p className="lede">Build, preview and publish approved articles.</p>
      <Info><p>Access is tested from networks inside the target country, because blocking happens at the local ISP or DNS level. Checks run on the Globalping probe network, and live sites are checked again every 6 hours. A domain that does not answer at all, for example because its DNS is not pointed yet, is “Not reachable”; “Blocked by ISP” means it answers elsewhere but not inside the country.</p></Info>
      <BlockedCallout />
      <section><h2>Website</h2><WebsiteSection /></section>
      <section><h2>Needs approval</h2><ApprovalQueue /></section>
      <section><h2>Domain access by country</h2><AccessTable /></section>
      <section><h2>Deploy timeline</h2><DeployTimeline />{drawn ? <p className="note">Oldest on the left.</p> : null}</section>
      <section><h2>Deploy history</h2><BuildHistory />{history}</section>
    </>
  );
}

/** The red callout when domains are blocked in their target country. */
function BlockedCallout() {
  const [sites, siteFilter, sample] = useStoreShallow(s => [s.sites, s.siteFilter, s.sample] as const);
  const bad = sites.filter(s => s.access === 'blocked' && inSite({ siteFilter }, s.id));
  if (!bad.length) return null;
  const head = bad.length === 1 ? bad[0].domain + ' cannot be opened from ' + bad[0].country : bad.length + ' domains cannot be opened from their target country';
  const list = bad.length > 1
    ? 'They include ' + bad.slice(0, 3).map(x => x.domain + ' (' + x.country + ')').join(', ') + (bad.length > 3 ? ' and ' + (bad.length - 3) + ' more, listed first in the table below' : '') + '. '
    : '';
  return (
    <Callout icon="gpp_bad">
      <b>{head}.</b> {list}{sample
        ? 'Local ISPs redirect the DNS while the origin server answers normally. That pattern is a block, not an outage, and Googlebot will not see it because it crawls mostly from the US.'
        : 'The site answers from outside the country, so this is a block by local networks, not an outage. Googlebot will not see it because it crawls mostly from the US. What each network saw is in the table below.'}
    </Callout>
  );
}

const blockedFirst = (x: Site, y: Site): number => Number(y.access === 'blocked') - Number(x.access === 'blocked');

/** A DNS or HTTP word from a real check, as a pill. */
const word = (w: string, good: boolean) => <Pill kind={!w || w === '—' ? 'mut' : good ? 'ok' : 'bad'}>{w || '—'}</Pill>;

/** Access per domain from inside its country, blocked domains first, 10 per page. */
function AccessTable() {
  const [sites, siteFilter, checking, sample, access] = useStoreShallow(s => [s.sites, s.siteFilter, s.checking, s.sample, s.live.access] as const);
  const probeOk = useStore(s => s.sample || usableInt(s, 'probe'));
  const check = useStore(s => s.checkAccess);
  const list = sites.filter(s => inSite({ siteFilter }, s.id)).sort(blockedFirst);
  const pg = usePaged('dep', list);
  const rows = pg.rows.map(s => {
    const busy = checking.includes(s.id), [kind, text] = ACC[s.access];
    const real = sample ? undefined : access[s.id];
    const c = real && real.domain === s.domain ? real : undefined;
    return [
      <><b>{s.domain}</b>{c ? <><br /><span className="note">{c.summary}</span></> : null}</>,
      c && c.probes.length ? c.probes.map(p => p.network ? `${p.network} (${p.place})` : p.place).join(', ') : `A network in ${s.country}`,
      c ? word(c.dns, c.dns === 'Normal') : s.access === 'ok' ? <Pill kind="ok">Normal</Pill> : s.access === 'blocked' ? <Pill kind="bad">Redirected</Pill> : <Pill kind="mut">—</Pill>,
      c ? word(c.http, c.result === 'ok') : s.access === 'ok' ? <Pill kind="ok">200</Pill> : s.access === 'blocked' ? <Pill kind="bad">Timeout</Pill> : <Pill kind="mut">—</Pill>,
      busy ? <Pill kind="info" live>Checking</Pill> : c?.result === 'error' ? <Pill kind="warn">Check failed</Pill> : <Pill kind={kind}>{text}</Pill>,
      c ? stamp(c.at) : s.checked,
      s.deploy,
      probeOk ? <Button size="sm" variant="text" disabled={busy} onClick={() => check(s.id)}>{busy ? 'Checking…' : 'Check now'}</Button> : <span className="note">{NO_PROBE}</span>,
    ];
  });
  return (
    <>
      <Table cols={['Domain', 'Tested from', 'DNS', 'HTTPS', 'Result', 'Checked', 'Last deploy', 'Actions']} rows={rows} num={[5]} rowKey={(_, i) => pg.rows[i].id}
        empty={sites.length ? undefined : <Empty icon="travel_explore" title="No domains to check yet" action={<Button variant="tonal" icon="language" onClick={() => go('sites')}>Open Sites</Button>}>Add a domain in Sites and it is listed here.</Empty>} />
      <Pager pkey="dep" paged={pg} />
    </>
  );
}

/** Every deploy inside the site filter, with roll back or roll forward for the versions that are not live. */
function DeployHistory() {
  const [deploys, sites, siteFilter] = useStoreShallow(s => [s.deploys, s.sites, s.siteFilter] as const);
  const openConfirm = useStore(s => s.openConfirm);
  const list = deploys.filter(x => siteById({ sites }, x.site) && inSite({ siteFilter }, x.site));
  const rows = list.map(x => {
    const newer = x.ver > liveVer({ deploys }, x.site);
    return [
      `v${x.ver}`,
      <SiteChip id={x.site} />,
      x.what,
      x.by,
      x.when,
      x.live ? <Pill kind="ok">Live</Pill> : <Pill kind="mut">{newer ? 'Newer, not live' : 'Previous'}</Pill>,
      x.live ? null : <Button size="sm" variant="text" onClick={() => openConfirm(`rb:${x.id}`)}>{newer ? 'Roll forward' : 'Roll back'}</Button>,
    ];
  });
  return <Table cols={['Version', 'Site', 'What changed', 'Approved by', 'When', 'Status', 'Actions']} rows={rows} num={[0]} rowKey={(_, i) => list[i].id}
    empty={deploys.length ? undefined : 'No deploys yet. Every version that goes live is listed here, and can be rolled back.'} />;
}

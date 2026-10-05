import { Button, Chip, Empty, Pill, SiteChip } from '@/components';
import { go } from '@/nav';
import { artVisible, inSite, siteById, stamp, waitingBuildsN } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import { feedRows } from './helpers';

/** The live activity feed (the prototype's feedHTML): the 14 newest audit-log entries inside the site filter. */
function Feed() {
  const rows = useStoreShallow(s => feedRows(s, 14));
  const sites = useStore(s => s.sites);
  return (
    <ul className="feed" id="feed">
      {rows.length ? rows.map((l, i) => {
        const site = siteById({ sites }, l.site);
        return <li key={i}><time>{stamp(l.t)}</time><span><b>{l.actor}</b> {l.act}{site ? <> <Chip>{site.cc}</Chip></> : null}</span></li>;
      }) : <li><span>No activity yet. What you and the agents do is listed here as it happens.</span></li>}
    </ul>
  );
}

/**
 * The "Needs approval" column: the review line (rvLine) and the approval queue (queueHTML). Outside demo mode the
 * server's website builds waiting for approval get a line too (decided on Build and deploy, where the preview is).
 */
function Approvals() {
  const [approvals, articles, sites, siteFilter] = useStoreShallow(s => [s.approvals, s.articles, s.sites, s.siteFilter] as const);
  const nb = useStore(waitingBuildsN);
  const decide = useStore(s => s.decideApproval);
  const queue = approvals.filter(p => inSite({ siteFilter }, p.site));
  const n = articles.filter(a => artVisible({ sites, siteFilter }, a) && a.status === 'review').length;
  return (
    <>
      <div id="rvline">
        {n ? (
          <div className="q">
            <Pill kind="warn">Publish</Pill>
            <p><b>{n} article{n === 1 ? '' : 's'} waiting for review</b></p>
            <Button size="sm" variant="tonal" onClick={() => go('review')}>Open review</Button>
          </div>
        ) : null}
        {nb ? (
          <div className="q">
            <Pill kind="info">Website</Pill>
            <p><b>{nb} website build{nb === 1 ? '' : 's'} waiting for approval</b></p>
            <Button size="sm" variant="tonal" onClick={() => go('website')}>Open Build and deploy</Button>
          </div>
        ) : null}
        {n || nb || queue.length ? null : <Empty icon="task_alt">Nothing needs approval.</Empty>}
      </div>
      <div className="queue" id="queue">
        {queue.map(p => (
          <div className="q" key={p.id}>
            <Pill kind="info">{p.kind}</Pill>
            <p><b>{p.what}</b><br /><SiteChip id={p.site} /></p>
            <Button size="sm" variant="tonal" onClick={() => decide(p.id, true)}>Approve</Button>
            <Button size="sm" variant="danger" onClick={() => decide(p.id, false)}>Reject</Button>
          </div>
        ))}
      </div>
    </>
  );
}

/** The two columns under the pipeline: live activity and the things waiting for a person. */
export function Activity() {
  return (
    <div className="cols">
      <section><h2>Live activity</h2><Feed /></section>
      <section id="ws-approvals"><h2>Needs approval</h2><Approvals /></section>
    </div>
  );
}

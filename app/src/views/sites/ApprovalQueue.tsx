import { Button, Empty, Pill, SiteChip } from '@/components';
import { inSite } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import { BuildQueue } from '../deploy/BuildQueue';

/**
 * The prototype's queueHTML() as Build and deploy shows it: every approval inside the site filter. Outside demo mode
 * what waits for a person here is a website build (the server's), with its preview.
 */
export function ApprovalQueue() {
  const sample = useStore(s => s.sample);
  return sample ? <SampleQueue /> : <BuildQueue />;
}

function SampleQueue() {
  const [approvals, siteFilter] = useStoreShallow(s => [s.approvals, s.siteFilter] as const);
  const decide = useStore(s => s.decideApproval);
  const q = approvals.filter(a => inSite({ siteFilter }, a.site));
  return (
    <div className="queue" id="queue">
      {q.length ? q.map(a => (
        <div key={a.id} className="q">
          <Pill kind="info">{a.kind}</Pill>
          <p><b>{a.what}</b><br /><SiteChip id={a.site} /></p>
          <Button size="sm" variant="tonal" onClick={() => decide(a.id, true)}>Approve</Button>
          <Button size="sm" variant="danger" onClick={() => decide(a.id, false)}>Reject</Button>
        </div>
      )) : <Empty>No deploys need approval.</Empty>}
    </div>
  );
}

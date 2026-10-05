/* "Needs approval" on Build and deploy outside demo mode: the website builds waiting for a person, with their preview.
   Demo mode keeps the prototype's queue (views/sites/ApprovalQueue.tsx). */
import { useState } from 'react';
import { Button, Empty, Pill, SiteChip } from '@/components';
import { waitingBuilds } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { BuildWire } from '@/store/types';
import { contentsText, mayWrite, PreviewLink, useOneAtATime } from './parts';
import { RejectBuildSheet } from './RejectBuildSheet';
import './deploy.css';

/** The builds waiting for a person's approval inside the site filter, oldest first. */
export function BuildQueue() {
  const [builds, sites, siteFilter] = useStoreShallow(s => [s.live.builds, s.sites, s.siteFilter] as const);
  const write = useStore(mayWrite);
  const askFirst = useStore(s => s.settings.apDeploy);
  const [rejecting, setRejecting] = useState<BuildWire | null>(null);
  const q = waitingBuilds(builds, { sites, siteFilter });
  return (
    <div className="queue" id="queue">
      {q.length ? q.map(b => <QueueItem key={b.id} b={b} write={write} onReject={setRejecting} />) : <Empty>{askFirst
        ? 'No website builds need approval. A build waits here once the Site Builder has finished it.'
        : 'No website builds need approval. Deploys need no approval (Settings), so each build is approved as soon as it is built.'}</Empty>}
      <RejectBuildSheet build={rejecting} onClose={() => setRejecting(null)} />
    </div>
  );
}

/** One build waiting for approval. Approve and Reject wait for the answer, so a second click sends nothing. */
function QueueItem({ b, write, onReject }: { b: BuildWire; write: boolean; onReject: (b: BuildWire) => void }) {
  const approveBuild = useStore(s => s.approveBuild);
  const [busy, run] = useOneAtATime();
  return (
    <div className="q">
      <Pill kind="info">Website</Pill>
      <p><b>{b.domain} v{b.version}</b> <span className="web-q-what">· {contentsText(b)}</span><br /><SiteChip id={b.siteId} domain={b.domain} /></p>
      <PreviewLink b={b} />
      {write ? <Button size="sm" variant="tonal" disabled={busy} onClick={() => { void run(() => approveBuild(b.id)); }}>Approve</Button> : null}
      {write ? <Button size="sm" variant="danger" disabled={busy} onClick={() => onReject(b)}>Reject</Button> : null}
    </div>
  );
}

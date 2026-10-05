/* "Deploy history" on Build and deploy outside demo mode: every approved website build, with deploy, try again, roll
   back and roll forward. Demo mode keeps the prototype's history (Deploy.tsx). */
import { useId, useState } from 'react';
import { Button, Dialog, Pager, Pill, SheetActions, SiteChip, Table, usePaged } from '@/components';
import { deploying } from '@/store/builds';
import { siteById, siteShown, stamp } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { BuildWire } from '@/store/types';
import { articlesText, cfState, filesKept, liveVersion, mayWrite } from './parts';
import './deploy.css';

const n = (k: number, one: string): string => `${k}\u00a0${one}${k === 1 ? '' : 's'}`;

/** What an approved build changed against the approved build before it: articles added and removed. */
function changesText(b: BuildWire, all: readonly BuildWire[]): string {
  const prev = all.filter(x => x.siteId === b.siteId && x.review === 'approved' && x.version < b.version).sort((x, y) => y.version - x.version)[0];
  if (!prev) return 'First version: ' + articlesText(b.articles.length);
  const added = b.articles.filter(id => !prev.articles.includes(id)).length, gone = prev.articles.filter(id => !b.articles.includes(id)).length;
  const parts = [added ? n(added, 'new article') : '', gone ? gone + ' removed' : ''].filter(Boolean);
  return parts.length ? parts.join(', ') + ' · ' + articlesText(b.articles.length) + ' in all' : 'Rebuilt with the same ' + articlesText(b.articles.length);
}

/** Every approved build inside the site filter, with deploy, try again, roll back or roll forward. */
export function BuildHistory() {
  const [builds, sites, siteFilter] = useStoreShallow(s => [s.live.builds, s.sites, s.siteFilter] as const);
  const canDeploy = useStore(s => mayWrite(s) && cfState(s) === 'ok');
  const deployBuild = useStore(s => s.deployBuild);
  const [asking, setAsking] = useState<BuildWire | null>(null);
  const titleId = useId();
  const all = Object.values(builds);
  const at = (b: BuildWire): number => Math.max(b.deployedAt ?? 0, b.decidedAt ?? 0, b.createdAt);
  const list = all.filter(b => b.review === 'approved' && siteShown({ sites, siteFilter }, b.siteId, b.domain)).sort((x, y) => at(y) - at(x) || y.version - x.version);
  const pg = usePaged('bh', list);
  const ofSite = (b: BuildWire) => all.filter(x => x.siteId === b.siteId);
  /* What the button does to this version: put it live for the first time, try again, or switch the live version. */
  const action = (b: BuildWire): string | null => {
    const mine = ofSite(b), lv = liveVersion(mine);
    if (!canDeploy || b.deploy === 'live' || mine.some(deploying) || !filesKept(b)) return null;
    if (lv && b.version < lv) return 'Roll back';
    if (lv && b.deploy === 'superseded') return 'Roll forward';
    return b.deploy === 'failed' ? 'Try deploy again' : 'Deploy';
  };
  const rows = pg.rows.map(b => {
    const lv = liveVersion(ofSite(b)), act = action(b), swap = act === 'Roll back' || act === 'Roll forward';
    return [
      `v${b.version}`,
      <SiteChip id={b.siteId} domain={b.domain} />,
      changesText(b, all),
      b.decidedBy,
      stamp(b.deployedAt ?? b.decidedAt ?? b.createdAt),
      b.deploy === 'live' ? <Pill kind="ok">Live</Pill>
        : deploying(b) ? <Pill kind="info" live>Deploying</Pill>
          : b.deploy === 'failed' ? <Pill kind="bad">Deploy failed</Pill>
            : <Pill kind="mut">{lv && b.version > lv ? 'Newer, not live' : b.deploy === 'superseded' ? 'Previous' : 'Not deployed'}</Pill>,
      act ? <Button size="sm" variant="text" onClick={() => { if (swap) setAsking(b); else void deployBuild(b.id); }}>{act}</Button>
        : b.deploy !== 'live' && !filesKept(b) ? <span className="note" title="Meridian keeps the files of the newest 10 builds of a site. Build the website again to deploy it.">Files removed</span> : null,
    ];
  });
  const ask = asking ? { b: asking, fw: asking.version > liveVersion(ofSite(asking)) } : null;
  return (
    <>
      <Table cols={['Version', 'Site', 'What changed', 'Approved by', 'When', 'Status', 'Actions']} rows={rows} num={[0]} rowKey={(_, i) => pg.rows[i]!.id}
        empty="No approved builds yet. Every website build you approve is listed here, and you can roll back to one that went live." />
      <Pager pkey="bh" paged={pg} />
      <Dialog open={!!ask} onClose={() => setAsking(null)} labelledBy={titleId} className="web-ask">
        {ask ? (
          <>
            <h2 id={titleId}>{ask.fw ? 'Roll forward' : 'Roll back'} to v{ask.b.version}?</h2>
            <p>{siteById({ sites }, ask.b.siteId)?.domain ?? ask.b.domain} switches to v{ask.b.version} on Cloudflare Pages. The other versions are kept, so you can switch again later.</p>
            <SheetActions>
              <Button variant="text" onClick={() => setAsking(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => { void deployBuild(ask.b.id); setAsking(null); }}>{ask.fw ? 'Roll forward' : 'Roll back'}</Button>
            </SheetActions>
          </>
        ) : null}
      </Dialog>
    </>
  );
}

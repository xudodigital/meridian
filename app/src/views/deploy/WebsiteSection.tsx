import { useId, useState } from 'react';
import { Button, Callout, Empty, Pager, usePaged } from '@/components';
import { go } from '@/nav';
import { building, deploying, siteBuilds } from '@/store/builds';
import { inSite, stamp } from '@/store/rules';
import { NO_ARTICLES } from '@/store/slices/sites';
import { HELD_LABEL, heldFor } from '@/store/spend';
import { useStore, useStoreShallow } from '@/store/store';
import type { BuildWire, ServerArticle, Site } from '@/store/types';
import { BuildPills, LiveLink, PreviewLink, ZipLink, articlesText, cfState, contentsText, filesKept, mayWrite, useOneAtATime, type CfState } from './parts';
import { DomainStep } from './DomainStep';
import { RejectBuildSheet } from './RejectBuildSheet';
import './deploy.css';

/** Builds listed per site before "Show all". */
const SHOWN = 3;

/** What a build makes, and whether a person approves it before it can go live ("Require approval before a deploy"). */
const staticSite = (askFirst: boolean): string => askFirst
  ? 'a static site you can preview before anything goes live.'
  : 'a static site. Deploys need no approval (Settings), so each build is approved as soon as it is built.';

/** The approved articles of a site that a build of it would place: same site, same domain. */
const approvedOf = (arts: Readonly<Record<number, ServerArticle>>, site: Site): number[] =>
  Object.values(arts).filter(a => a.siteId === site.id && a.domain === site.domain && a.status === 'approved').map(a => a.id);

/**
 * Build and deploy outside demo mode: per site, "Build website" (the Site Builder makes a static site from the approved
 * articles), the build in progress, and the builds with Preview, Download ZIP, Approve, Reject and Deploy.
 */
export function WebsiteSection() {
  const [sites, siteFilter] = useStoreShallow(s => [s.sites, s.siteFilter] as const);
  const cf = useStore(cfState);
  const list = sites.filter(s => inSite({ siteFilter }, s.id));
  const pg = usePaged('web', list, 5);
  const [rejecting, setRejecting] = useState<BuildWire | null>(null);
  if (!list.length) return <Empty icon="construction" title="No sites yet" action={<Button variant="tonal" icon="language" onClick={() => go('sites')}>Open Sites</Button>}>Add a domain in Sites. Its website is built here from the articles you approve.</Empty>;
  return (
    <>
      <CloudflareCallout cf={cf} />
      <NoApprovalCallout cf={cf} />
      <div className="web-list">{pg.rows.map(s => <SitePanel key={s.id} site={s} cf={cf} onReject={setRejecting} />)}</div>
      <Pager pkey="web" paged={pg} />
      <RejectBuildSheet build={rejecting} onClose={() => setRejecting(null)} />
    </>
  );
}

/** What deploying needs, when Cloudflare cannot take a deploy yet. Approving and the ZIP work either way. */
function CloudflareCallout({ cf }: { cf: CfState }) {
  const admin = useStore(s => s.session?.role === 'admin');
  if (cf === 'ok') return null;
  const open = admin ? <> <Button size="sm" variant="text" onClick={() => go('integrations')}>Open Integrations</Button></> : null;
  if (cf === 'bad') return <Callout icon="cloud_off" warn><b>Cloudflare is not working.</b> Its last test failed, so nothing can be deployed. Test it again in Integrations. Approving still works, and every build can be downloaded as a ZIP.{open}</Callout>;
  if (cf === 'account') return <Callout icon="cloud_off" warn><b>The Cloudflare Account ID is missing.</b> Add it in Integrations to deploy. Approving still works, and every build can be downloaded as a ZIP.{open}</Callout>;
  return (
    <Callout icon="cloud_off" info>
      <b>Cloudflare is not connected.</b> You can still build, preview and approve each website, and download it as a ZIP for any static host. To put sites live from here, connect Cloudflare in Integrations with an API token that has Cloudflare Pages: Edit, and the Account ID.{open}
    </Callout>
  );
}

/**
 * "Require approval before a deploy" is off in Settings: the server approves every build itself and, with Cloudflare
 * ready, puts it live right away (server/builds.ts runBuild), so "Build website" is also "put it live".
 */
function NoApprovalCallout({ cf }: { cf: CfState }) {
  const askFirst = useStore(s => s.settings.apDeploy);
  if (askFirst || cf !== 'ok') return null;
  return (
    <Callout icon="warning" warn>
      <b>Builds go live without approval.</b> “Require approval before a deploy” is off in Settings, so every website build is approved by itself and put live on Cloudflare Pages as soon as it is built, without a preview first.
    </Callout>
  );
}

function SitePanel({ site, cf, onReject }: { site: Site; cf: CfState; onReject: (b: BuildWire) => void }) {
  const builds = useStore(s => s.live.builds);
  const arts = useStore(s => s.live.arts);
  const write = useStore(mayWrite);
  const buildWebsite = useStore(s => s.buildWebsite);
  const askFirst = useStore(s => s.settings.apDeploy);
  const [asking, setAsking] = useState(false);
  const [all, setAll] = useState(false);
  const noteId = useId();
  const list = siteBuilds(builds, site), approved = approvedOf(arts, site);
  const running = list.find(building), live = list.find(b => b.deploy === 'live');
  /* Approved articles the newest finished build does not have yet: building again places them. */
  const last = list.find(b => b.status === 'ready');
  const fresh = last ? approved.filter(id => !last.articles.includes(id)).length : 0;
  const ask = async () => { setAsking(true); try { await buildWebsite(site.id); } finally { setAsking(false); } };
  return (
    <article className="web-site" aria-label={site.domain}>
      <header className="web-head">
        <span className="cc sm" aria-hidden="true">{site.cc}</span>
        <div className="web-name">
          <b>{site.domain}</b>
          <span className="note">
            {approved.length ? articlesText(approved.length) + ' approved' : 'No approved articles yet'}
            {fresh ? ` (${fresh} not in a build yet)` : ''} · {live ? `v${live.version} is live` : 'Never deployed'}
          </span>
        </div>
        {live ? <LiveLink b={live} /> : null}
        {write ? (
          <Button variant="filled" size="sm" icon="construction" disabled={!approved.length || !!running || asking} aria-describedby={approved.length ? undefined : noteId} onClick={() => { void ask(); }}>
            {running ? 'Building…' : 'Build website'}
          </Button>
        ) : null}
      </header>
      <DomainStep site={site} live={live} cf={cf} write={write} />
      {list.length || (write && !approved.length) ? null : <p className="note">No builds yet. A build turns the approved articles into {staticSite(askFirst)}</p>}
      {write && !approved.length ? <p className="note" id={noteId}>{NO_ARTICLES} {list.length ? 'A build places every approved article of the site.' : 'A build then turns them into ' + staticSite(askFirst)}</p> : null}
      {list.length ? <ul className="web-builds">{(all ? list : list.slice(0, SHOWN)).map(b => <BuildItem key={b.id} b={b} cf={cf} write={write} list={list} onReject={onReject} />)}</ul> : null}
      {list.length > SHOWN ? <div><Button variant="text" size="sm" onClick={() => setAll(!all)}>{all ? 'Show fewer builds' : `Show all ${list.length} builds`}</Button></div> : null}
    </article>
  );
}

/** One build: when and by whom, what is in it (or the step it is on), its pills, its actions and what went wrong. */
export function BuildItem({ b, cf, write, list, onReject }: { b: BuildWire; cf: CfState; write: boolean; list: readonly BuildWire[]; onReject: (b: BuildWire) => void }) {
  const approveBuild = useStore(s => s.approveBuild);
  const deployBuild = useStore(s => s.deployBuild);
  const [busy, run] = useOneAtATime();
  /* Deploying from here is for the newest approved build; older ones are rolled back to from Deploy history. */
  const newestOk = list.find(x => x.review === 'approved');
  const canDeploy = write && cf === 'ok' && b.id === newestOk?.id && (b.deploy === '' || b.deploy === 'failed') && filesKept(b) && !list.some(deploying);
  const waiting = b.status === 'ready' && b.review === 'waiting';
  /* Only a site's first build calls a model (for its name and colours), so only that one waits for budget. */
  const held = useStore(s => b.status === 'queued' && !list.some(x => x.status === 'ready') ? heldFor(s, b.siteId, b.domain) : null);
  return (
    <li className="web-build">
      <div className="web-ver"><b>v{b.version}</b><span className="note">{stamp(b.finishedAt ?? b.createdAt)}</span>{b.by ? <span className="note">{b.by}</span> : null}</div>
      <div className="web-what">
        {building(b) ? (b.status === 'queued' ? (held ? `${HELD_LABEL}. ${held}` : 'Waiting in the queue. Agent jobs run one at a time.') : b.step || 'Starting') : b.status === 'ready' ? contentsText(b) : 'Not built'}
      </div>
      <div className="web-pills"><BuildPills b={b} /></div>
      <div className="web-acts">
        <PreviewLink b={b} />
        <ZipLink b={b} />
        {write && waiting ? <Button size="sm" variant="tonal" icon="check" disabled={busy} onClick={() => { void run(() => approveBuild(b.id)); }}>Approve</Button> : null}
        {write && waiting ? <Button size="sm" variant="danger" disabled={busy} onClick={() => onReject(b)}>Reject</Button> : null}
        {canDeploy ? <Button size="sm" variant="tonal" icon="rocket_launch" disabled={busy} onClick={() => { void run(() => deployBuild(b.id)); }}>{b.deploy === 'failed' ? 'Try deploy again' : 'Deploy'}</Button> : null}
      </div>
      <BuildMessage b={b} cf={cf} newest={b.id === newestOk?.id} />
    </li>
  );
}

/** The line under a build that needs one: an error, the reason it was rejected, the deploy step, or what deploying needs. */
function BuildMessage({ b, cf, newest }: { b: BuildWire; cf: CfState; newest: boolean }) {
  if (b.status === 'failed') return <p className="web-msg err">{b.error || 'The build stopped without a message.'}</p>;
  if (b.review === 'rejected') return <p className="web-msg note">Rejected{b.decidedBy ? ' by ' + b.decidedBy : ''}{b.reviewNote ? ': ' + b.reviewNote : '.'}</p>;
  if (deploying(b)) return <p className="web-msg note">{b.deploy === 'queued' ? 'The deploy is waiting in the queue.' : b.step || 'Deploying to Cloudflare Pages.'}</p>;
  if (b.status === 'ready' && b.deploy !== 'live' && !filesKept(b)) return <p className="web-msg note">Its files were removed to save space: Meridian keeps the newest 10 builds of a site. Build the website again to preview, download or deploy it.</p>;
  if (b.deploy === 'failed') return <p className="web-msg err">The deploy failed: {b.deployError || 'it stopped without a message.'}</p>;
  if (b.review === 'approved' && b.deploy === '' && newest && cf !== 'ok') return <p className="web-msg note">Approved{b.decidedBy ? ' by ' + b.decidedBy : ''}. Connect Cloudflare to put it live; download the ZIP meanwhile.</p>;
  return null;
}

import { artVisible, siteShown } from '@/store/rules';
import type { AppState } from '@/store/types';

export type SceneKind = 'research' | 'review' | 'deploy' | 'sites';
export type SceneTone = 'neutral' | 'active' | 'waiting' | 'success' | 'error';
export interface SceneRecord { id: string; title: string; detail: string; working?: boolean }
export interface SceneStage { id: string; label: string; icon: string; tone: SceneTone; hint: string; records: SceneRecord[] }
export interface SceneModel { title: string; description: string; unit: string; stages: SceneStage[] }
export type SceneState = Pick<AppState, 'sites' | 'siteFilter' | 'session' | 'articles' | 'kwReqs' | 'live' | 'sample' | 'deploys' | 'approvals'>;

/** Each record belongs to exactly one group. Counts are loaded records, never estimated progress or totals. */
export function sceneModel(kind: SceneKind, s: SceneState): SceneModel {
  const visible = (id: string, domain?: string) =>
    (s.session?.role !== 'reviewer' || s.session.site === id) && siteShown(s, id, domain);
  const domain = (id: string) => s.sites.find(x => x.id === id)?.domain ?? 'Site no longer listed';
  const stage = (id: string, label: string, icon: string, tone: SceneTone, hint: string): SceneStage => ({ id, label, icon, tone, hint, records: [] });
  if (kind === 'research') {
    const stages = [
      stage('queued', 'Queued', 'inbox', 'neutral', 'Requests waiting for the Keyword agent. Budget holds stay here.'),
      stage('work', 'Researching', 'travel_explore', 'active', 'The Keyword agent is working on these topics.'),
      stage('done', 'Results ready', 'key', 'success', 'Open a result below to choose keywords for an article.'),
      stage('failed', 'Needs attention', 'error_outline', 'error', 'Review the reason below before retrying a request.'),
    ];
    for (const r of s.kwReqs.filter(r => visible(r.site, r.domain))) {
      stages.find(x => x.id === r.st)?.records.push({ id: String(r.id), title: r.topic,
        detail: `${r.domain || domain(r.site)} · ${r.error || r.step || (r.st === 'done' ? `${r.keywords?.length ?? 0} keywords returned` : 'Waiting to start')}`, working: r.st === 'work' });
    }
    return { title: 'From a topic to an opportunity.', description: 'Follow the research desk. Select a station to see the requests behind each number.', unit: 'requests', stages };
  }
  if (kind === 'review') {
    const stages = [
      stage('writing', 'In production', 'edit_note', 'active', 'Drafts and revisions. Queued work stays still until the writer starts.'),
      stage('review', 'Your review', 'front_hand', 'waiting', 'Read the article, check its sources, then make your decision below.'),
      stage('approved', 'Approved', 'task_alt', 'success', 'Approved content is ready for a website build. Approval alone does not publish it.'),
      stage('attention', 'Other outcomes', 'assignment_late', 'error', 'Rejected or failed articles. Their history explains what happened.'),
    ];
    for (const a of s.articles.filter(a => !a.archived && visible(a.s, a.live?.domain) && artVisible(s, a))) {
      const id = ['writing', 'revisi'].includes(a.status) ? 'writing' : ['approved', 'published'].includes(a.status) ? 'approved' : a.status === 'review' ? 'review' : 'attention';
      stages.find(x => x.id === id)!.records.push({ id: String(a.id), title: a.titleEn || a.title || a.kw,
        detail: `${domain(a.s)} · ${a.live?.step || (a.status === 'revisi' ? 'Revision requested' : a.status === 'review' ? 'Waiting for a decision' : a.status === 'published' ? 'Published' : a.status === 'approved' ? 'Approved for a build' : a.status === 'writing' ? 'Waiting for the writer' : a.status)}`,
        working: a.live ? a.live.state === 'work' : s.sample && a.status === 'writing' });
    }
    return { title: 'Good content. A human decision.', description: 'See what is being written, what needs you, and what is ready for the next build.', unit: 'unarchived articles', stages };
  }
  if (kind === 'sites') {
    const stages = [
      stage('live', 'Live sites', 'public', 'success', 'Sites marked live. Check the access results below to confirm reachability.'),
      stage('setup', 'Being set up', 'construction', 'active', 'Sites being prepared, including domains waiting for DNS.'),
      stage('paused', 'Paused', 'pause_circle', 'neutral', 'Paused sites remain here with their data and history.'),
      stage('attention', 'Access issues', 'wifi_off', 'error', 'Sites with a blocked or unreachable result from the latest access check.'),
    ];
    for (const site of s.sites.filter(x => visible(x.id))) {
      const id = ['blocked', 'down'].includes(site.access) ? 'attention' : site.status === 'live' ? 'live' : site.status === 'paused' ? 'paused' : 'setup';
      const access = site.access === 'ok' ? 'Access check passed' : site.access === 'blocked' ? 'Blocked by ISP' : site.access === 'down' ? 'Not reachable' : 'Access not checked';
      stages.find(x => x.id === id)!.records.push({ id: site.id, title: site.domain, detail: `${site.country} · ${access}` });
    }
    return { title: 'Your sites, at a glance.', description: 'One independent site per country. Explore the network by status, then open the map or list.', unit: 'sites', stages };
  }
  const stages = [
    stage('build', 'Building', 'web', 'active', 'Queued and running builds. Pages are assembled from approved articles.'),
    stage('review', 'Approval', 'verified_user', 'waiting', 'Preview these builds before approving or rejecting them below.'),
    stage('deploy', 'Delivery', 'rocket_launch', 'active', 'Approved builds awaiting deployment, uploading, or ready to download.'),
    stage('live', 'Live builds', 'language', 'success', 'The current live build of each site, including its Pages address.'),
    stage('attention', 'Other versions', 'history', 'neutral', 'Failed, rejected, expired and superseded builds remain in history.'),
  ];
  if (s.sample) {
    for (const a of s.approvals.filter(a => a.kind === 'Deploy' && a.site && visible(a.site)))
      stages[1].records.push({ id: `approval-${a.id}`, title: a.what, detail: `${domain(a.site!)} · Demo approval` });
    for (const b of s.deploys.filter(b => visible(b.site)))
      stages[b.live ? 3 : 4].records.push({ id: String(b.id), title: `${domain(b.site)} · v${b.ver}`, detail: b.live ? 'Demo live version' : 'Demo previous version' });
  } else {
    for (const b of Object.values(s.live.builds).filter(b => visible(b.siteId, b.domain)).sort((a, b) => b.version - a.version)) {
      const id = b.status === 'failed' || b.deploy === 'failed' || b.review === 'rejected' || b.deploy === 'superseded' || b.pruned ? 'attention'
        : b.deploy === 'live' ? 'live' : b.status === 'work' || b.status === 'queued' ? 'build' : b.review === 'waiting' ? 'review' : 'deploy';
      stages.find(x => x.id === id)!.records.push({ id: String(b.id), title: `${b.domain} · v${b.version}`,
        detail: b.deployError || b.error || b.deployStep || b.step || (b.deploy === 'live' ? 'Deployed to Cloudflare Pages' : b.review === 'waiting' ? 'Waiting for approval' : b.review === 'approved' ? 'Approved; not deployed' : 'Saved in build history'),
        working: b.status === 'work' || b.deploy === 'work' });
    }
  }
  return { title: 'Watch your next release take shape.', description: 'From approved words to a live website. Each station shows the state of your loaded builds.', unit: s.sample ? 'demo records' : 'builds', stages };
}

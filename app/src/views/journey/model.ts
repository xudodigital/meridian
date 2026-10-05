import { siteShown } from '@/store/rules';
import type { AppState, Article, BuildWire, KwRequest, WorkflowWire } from '@/store/types';
import type { JourneyTarget } from './state';
export type JourneyState = Pick<AppState, 'sites' | 'siteFilter' | 'session' | 'sample' | 'live' | 'articles' | 'kwReqs' | 'deploys' | 'approvals'>;
export interface JourneyLink extends JourneyTarget { title: string; status: string }
export interface Journey {
  title: string; site: string; domain: string; message: string;
  request?: KwRequest; article?: Article; build?: BuildWire; workflow?: WorkflowWire;
  groups: { label: string; links: JourneyLink[] }[];
  events: { at: number; text: string }[];
}
/** Follow stored IDs, never infer lineage from matching titles, keywords or a shared site. */
export function journeyFor(s: JourneyState, target: JourneyTarget): Journey | null {
  const reviewer = s.session?.role === 'reviewer';
  if (!s.session || (reviewer && target.kind !== 'review')) return null;
  if (s.sample && target.kind === 'deploy') {
    const approval = s.approvals.find(a => `approval-${a.id}` === target.id && a.kind === 'Deploy');
    const deploy = s.deploys.find(b => String(b.id) === target.id);
    const siteId = approval?.site ?? deploy?.site;
    const site = s.sites.find(x => x.id === siteId);
    if (!site || !siteShown(s, site.id)) return null;
    return {title:approval?.what ?? `${site.domain} · v${deploy?.ver}`,site:site.id,domain:site.domain,
      message:approval ? 'Example build waiting for approval. Demo mode does not publish a website.' : deploy?.live ? 'Example live version. This is simulated data.' : 'Example previous version. This is simulated data.',groups:[],events:[]};
  }
  const request = target.kind === 'research' ? s.kwReqs.find(r => String(r.id) === target.id) : undefined;
  const article = target.kind === 'review' ? s.articles.find(a => String(a.id) === target.id) : undefined;
  const build = target.kind === 'deploy' && !s.sample ? s.live.builds[Number(target.id)] : undefined;
  const workflow = target.kind === 'workflow' && !s.sample ? s.live.workflows[Number(target.id)] : undefined;
  const site = target.kind === 'sites' ? s.sites.find(x => x.id === target.id) : undefined;
  if (!request && !article && !build && !workflow && !site) return null;
  const siteId = request?.site ?? article?.s ?? build?.siteId ?? workflow?.siteId ?? site!.id;
  const domain = request?.domain ?? article?.live?.domain ?? build?.domain ?? workflow?.domain ?? s.sites.find(x => x.id === siteId)?.domain ?? '';
  if (!siteShown(s, siteId, domain) || (reviewer && s.session.site !== siteId)) return null;
  const aWire = article?.live ? s.live.arts[article.live.aid] : undefined;
  const same = (id: string, d?: string) => id === siteId && (!d || !domain || d === domain);
  const aid = aWire?.id;
  const articles = s.articles.filter(a => same(a.s, a.live?.domain) && (site || (article ? a.id === article.id :
    workflow ? !!a.live && workflow.articles.includes(a.live.aid) : build ? !!a.live && build.articles.includes(a.live.aid) :
    !!a.live && request?.rid != null && s.live.arts[a.live.aid]?.requestId === request.rid)));
  const aids = articles.flatMap(a => a.live ? [a.live.aid] : []);
  const builds = reviewer ? [] : Object.values(s.live.builds).filter(b => same(b.siteId, b.domain) && (site || (build ? b.id === build.id : workflow ? b.id === workflow.buildId : b.articles.some(id => aids.includes(id)))));
  const requests = reviewer ? [] : s.kwReqs.filter(r => same(r.site, r.domain) && (site || (request ? r.id === request.id : workflow ? r.rid != null && r.rid === workflow.requestId :
    r.rid != null && articles.some(a => a.live && s.live.arts[a.live.aid]?.requestId === r.rid))));
  const flows = reviewer ? [] : Object.values(s.live.workflows).filter(w => same(w.siteId, w.domain) && (site || (workflow ? w.id === workflow.id :
    request ? request.rid != null && w.requestId === request.rid : article ? aid != null && w.articles.includes(aid) : w.buildId === build?.id)));
  const events = workflow?.log ?? (aWire ? [...(aWire.steps ?? []), ...aWire.history.map(e => ({ at: e.at, text: `${e.action} · ${e.by}${e.note ? ': ' + e.note : ''}` }))] : build?.steps ?? (request?.rid != null ? s.live.reqs[request.rid]?.steps : []) ?? []);
  return {
    title: site?.domain ?? workflow?.name ?? (article?.titleEn || article?.title || article?.kw) ?? request?.topic ?? `${domain} · v${build?.version}`,
    site: siteId, domain, request, article, build, workflow,
    message: workflow ? workflow.error || workflow.wait?.text || workflow.outcome || workflow.status :
      request ? request.error || request.step || request.st :
      aWire ? aWire.error || aWire.step || aWire.status : article ? article.status :
      build ? build.deployError || build.error || build.deployStep || build.step || build.review || build.status : 'Activity recorded for this site. These records may belong to different work journeys.',
    groups: [
      {label:'Research',links:requests.map(r=>({kind:'research' as const,id:String(r.id),title:r.topic,status:r.st}))},
      {label:'Articles',links:articles.map(a=>({kind:'review' as const,id:String(a.id),title:a.titleEn || a.title || a.kw,status:a.status}))},
      {label:'Build and delivery',links:builds.map(b=>({kind:'deploy' as const,id:String(b.id),title:`${b.domain} · v${b.version}`,status:b.deploy || b.review || b.status}))},
      {label:'Workflows',links:flows.map(w=>({kind:'workflow' as const,id:String(w.id),title:`${w.name} · #${w.id}`,status:w.wait?.text || w.status}))},
    ].filter(g => !reviewer || g.label === 'Articles'),
    events: [...events].sort((a,b)=>b.at-a.at),
  };
}

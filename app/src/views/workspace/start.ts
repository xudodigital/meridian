import { codexLocal, engineReady, engineName } from '@/store/rules';
import type { AppState } from '@/store/types';

export const START_STEPS = ['Connect OpenAI', 'Add a site', 'Find keywords', 'Write an article', 'Review the article', 'Preview the website'] as const;
export type StartAction = 'connect' | 'site' | 'research' | 'result' | 'review' | 'build' | 'preview' | 'team' | 'sites';
export interface StartStep {
  step: number;
  title: string;
  body: string;
  action: StartAction;
  label: string;
  state: 'next' | 'working' | 'failed' | 'complete';
  requestId?: number;
  siteId?: string;
}
export type StartState = Pick<AppState, 'sites' | 'siteFilter' | 'agents' | 'live'>;
export const startSite = (s: StartState) => s.sites.find(x => x.id === s.siteFilter) ?? s.sites[0];
export const hasRecordedWork = (s: Pick<AppState, 'live'>): boolean =>
  [s.live.reqs, s.live.arts, s.live.builds, s.live.workflows].some(rows => Object.keys(rows).length > 0)
  || Object.values(s.live.spend?.agents ?? {}).some(a => a.runs > 0 || a.tokens > 0 || a.cost > 0);

export function startProgress(s: StartState): boolean[] {
  const site = startSite(s);
  const own = (x: { siteId: string; domain: string }) => !!site && x.siteId === site.id && x.domain === site.domain;
  const arts = Object.values(s.live.arts).filter(own);
  return [engineReady(s), !!site, Object.values(s.live.reqs).some(r => own(r) && r.status === 'done'),
    arts.some(a => a.status === 'review' || a.status === 'approved'), arts.some(a => a.status === 'approved'),
    Object.values(s.live.builds).some(b => own(b) && b.status === 'ready' && !b.pruned)];
}

/** A next action, derived from real work for this site/domain. No manually ticked or browser-only progress. */
export function nextStart(s: StartState): StartStep {
  const site = startSite(s);
  const step = (n: number, title: string, body: string, action: StartAction, label: string, state: StartStep['state'] = 'next', requestId?: number): StartStep =>
    ({ step: n, title, body, action, label, state, requestId, siteId: site?.id });
  const local = codexLocal(s);
  const connect = () => s.live.engine?.mode === 'gemma-local' ? step(0,'Connect Gemma on this computer',s.live.engine.reason || 'Start Ollama, install Gemma 4 and configure it in Integrations.','connect','Configure Gemma localhost') : local ? step(0, 'Connect Codex on this computer', s.live.engine?.reason || 'Sign in to Codex on this computer, then check its status in Integrations.', 'connect', 'Check Codex local') : step(0, 'Connect OpenAI to power your agents', 'You need an OpenAI API key with API billing set up. Save and test it here; connecting a key does not start any AI work.', 'connect', 'Connect OpenAI');
  if (!site) return !engineReady(s) ? connect() : step(1, 'Add the site you want to work on', 'Enter its domain, target country, content language and topic. Meridian saves this profile for every request. Adding a site does not publish it.', 'site', 'Add your first site');
  const own = (x: { siteId: string; domain: string }) => x.siteId === site.id && x.domain === site.domain;
  const builds = Object.values(s.live.builds).filter(own).sort((a, b) => b.createdAt - a.createdAt);
  const arts = Object.values(s.live.arts).filter(own).sort((a, b) => b.createdAt - a.createdAt);
  const reqs = Object.values(s.live.reqs).filter(own).sort((a, b) => b.createdAt - a.createdAt);
  const build = builds[0];
  if (build && !build.pruned) {
    if (build.status === 'ready') return step(5, 'Your website is ready to preview', 'Open Build and deploy to preview the pages or download a ZIP. Review the build before approving it. Cloudflare is only needed when you want to put it online.', 'preview', 'Open website preview', 'complete');
    if (build.status === 'queued' || build.status === 'work') return step(5, 'Your website is being built', build.step || 'The approved articles are becoming website pages. Follow the build here; you do not need to send another request.', 'preview', 'View build progress', 'working');
    if (build.status === 'failed') return step(5, 'The website build needs attention', build.error || 'Open the build to see what stopped it and try again.', 'preview', 'View build issue', 'failed');
  }
  const review = arts.find(a => a.status === 'review');
  if (review) return step(4, 'Read and review your first article', 'Check the writing, sources and images in Article review. You can request changes. A build can include it only after the required reviews and your approval.', 'review', 'Review article');
  const writing = arts.find(a => ['queued', 'work', 'revision'].includes(a.status));
  if (writing) return step(3, 'Your article is on its way', writing.step || 'The Content Writer is preparing your draft. It will appear in Article review. You do not need to send it again.', 'review', 'View article progress', 'working');
  if (arts.some(a => a.status === 'approved')) return !engineReady(s) ? connect() : step(5, 'Turn your approved article into a website', `Open Build and deploy and choose Build website for this site. The first build uses ${engineName(s.live.engine?.mode)} and produces pages you can preview.`, 'build', 'Prepare website build');
  const research = reqs.find(r => r.status === 'queued' || r.status === 'work');
  if (research) return step(2, 'Your keyword research is on its way', research.step || 'The Keyword agent is finding ideas for your site. Requests run one at a time. You can follow this request while you wait.', 'result', 'View research progress', 'working', research.id);
  const failedArticle = arts.find(a => a.status === 'failed');
  if (failedArticle) return step(3, 'The article needs attention', failedArticle.error || 'Open Article review to see why the job stopped and try again.', 'review', 'View article issue', 'failed');
  const result = reqs.find(r => r.status === 'done');
  if (result) return !engineReady(s) ? connect() : step(3, 'Choose one keyword for your first article', 'Open the research result, choose a keyword, then select Write article. You will confirm the request before the Content Writer starts.', 'result', 'Choose a keyword', 'next', result.id);
  if (!engineReady(s)) return connect();
  if (site.status === 'paused') return step(2, 'Resume this site before starting work', 'This site is paused. Open Sites and resume it, or select another site from the top bar.', 'sites', 'Open Sites');
  const keyword = s.agents.find(a => a.id === 'kw');
  if (!keyword || keyword.status === 'off') return step(2, 'The Keyword agent needs to be enabled', 'The Keyword agent is paused or has been removed. Open Team and roles to enable or restore it before sending a research request.', 'team', 'Open Team and roles');
  const failed = reqs.find(r => r.status === 'failed');
  if (failed) return step(2, 'The research request needs attention', failed.error || 'Open the request to see why it stopped and try again.', 'result', 'View research issue', 'failed', failed.id);
  return step(2, 'Give Meridian one topic to research', (s.live.engine?.mode === 'gemma-local' ? 'Gemma runs on this computer. ' : local ? 'Codex uses your ChatGPT usage limits. ' : '') + 'Start with a subject your site covers, such as “cold brew coffee at home”. You will receive keyword ideas, then choose one for an article.' + (local || s.live.engine?.mode === 'gemma-local' ? '' : ' Sending the request uses your OpenAI API balance.'), 'research', 'Start your first research');
}

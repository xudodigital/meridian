/* Pure helpers of the Workspace view: how an agent looks, rooms of the Office view and the content pipeline counts.
   Prototype: TEAM, ROOMS, roomOf (lines 1307-1309) and STAGES, pipeData (lines 1325-1332). */
import { agentPlanned, artOpen, artVisible, engineName, engineReady, inSite, siteById, ST, waitingBuildsN } from '@/store/rules';
import type { Agent, AgentStatus, AliasId, AppState, LogEntry, PillKind, ViewId } from '@/store/types';

/** "VN · domain-a.example", or nothing when the agent has no site (no "—" filler). */
export function siteText(s: Pick<AppState, 'sites'>, id: string | null): string {
  const x = siteById(s, id);
  return x ? x.cc + ' · ' + x.domain : '';
}

/** "1 worker", "3 workers". */
export const workersText = (n: number): string => `${n} worker${n === 1 ? '' : 's'}`;

/* ---------- How an agent looks ---------- */

export interface AgentLook {
  /** data-st of its card and station: its status, or "done" / "failed" for the moment after a server job ended. */
  st: AgentStatus | 'done' | 'failed';
  kind: PillKind;
  label: string;
  /** The task, and the server's current step (or how the job ended) after it; '' when there is none. */
  task: string;
  step: string;
  /** Width of the progress bar, in percent. */
  bar: number;
  /** The pill pulses while the agent works. */
  pulse: boolean;
}

/** The status pill, task line and progress of an agent; a job the server just finished shows "Done" or "Failed". */
export function agentLook(a: Agent): AgentLook {
  const end = a.status === 'idle' ? a.ended : null;
  if (end) return { st: end.ok ? 'done' : 'failed', kind: end.ok ? 'ok' : 'bad', label: end.ok ? 'Done' : 'Failed', task: a.task, step: end.note, bar: end.ok ? 100 : 0, pulse: false };
  const [kind, label] = ST[a.status], work = a.status === 'work';
  return { st: a.status, kind, label, task: a.task, step: work && a.run ? a.run.step : '', bar: work || a.status === 'wait' ? a.progress : 0, pulse: work };
}

/* ---------- Hero ---------- */

export interface HeroCopy { eyebrow: string; title: string; sub: string }
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * What the hero says. Sample-data mode keeps the prototype's wording. Otherwise it says what is true: how the agents
 * would run (OpenAI API, or nothing connected), and either "add your first site" or how many real sites there are.
 * Only the agents that run jobs with a model are counted there; the planned ones do no work.
 */
export function heroCopy(s: Pick<AppState, 'sample' | 'agents' | 'sites' | 'live'>): HeroCopy {
  const gate = 'Nothing publishes or deploys without your approval.';
  const countries = new Set(s.sites.map(x => x.country)).size;
  if (s.sample) return { eyebrow: 'Live simulation', title: 'Your agents are on shift.', sub: `${s.agents.length} AI agents are working across ${s.sites.length} sites in ${countries} countries. ${gate}` };
  const eyebrow = engineReady(s) ? 'Connected to ' + engineName(s.live.engine?.mode) : s.live.on ? engineName(s.live.engine?.mode) + ' needs attention' : 'Not connected to the Meridian server';
  const agents = count(s.agents.filter(a => !agentPlanned(s, a)).length, 'agent', 'agents');
  if (!s.sites.length) return { eyebrow, title: 'Start with your first site.', sub: `${agents} ready. Add a site to begin.` };
  return { eyebrow, title: 'Your agents are ready.', sub: `${agents} · ${count(s.sites.length, 'site', 'sites')} · ${count(countries, 'country', 'countries')}. Articles need your review.` };
}

/* ---------- Live activity ---------- */

/** Confirmed server activity inside the site filter. Client notes can precede a refused save;
 * they remain in the audit log, but must not be presented as completed work in live Office feeds. */
export const feedRows = (s: Pick<AppState, 'log' | 'siteFilter'> & Partial<Pick<AppState, 'sample'>>, n: number): LogEntry[] =>
  s.log.filter(l => (s.sample || (!l.note && !l.cid)) && (!l.site || inSite(s, l.site))).slice(0, n);

/* ---------- The Office page ---------- */

/** The Office on a page of its own (router.tsx), for a second tab or a wall display. */
export const OFFICE_PATH = '/office';
/** Link to the Office page; it keeps a site filter, which the page applies (OfficeDisplay.tsx). */
export const officeHref = (siteFilter: string): string =>
  siteFilter === 'all' ? OFFICE_PATH : `${OFFICE_PATH}?site=${encodeURIComponent(siteFilter)}`;

/* ---------- Office rooms ---------- */

export type RoomId = 'plan' | 'content' | 'tech' | 'flex' | 'meet' | 'break';
type TeamRoom = Extract<RoomId, 'plan' | 'content' | 'tech' | 'flex'>;

/** Team room of each seeded agent; agents added later sit at the flex desks. */
const TEAM: Readonly<Record<string, TeamRoom>> = { orc: 'plan', res: 'plan', kw: 'plan', arc: 'plan', wr: 'content', gd: 'content', seo: 'content', lnk: 'content', bld: 'tech', dep: 'tech', ana: 'tech' };
/** Team rooms: [id, name, icon]. */
export const ROOMS: readonly (readonly [TeamRoom, string, string])[] = [['plan', 'Strategy room', 'explore'], ['content', 'Content studio', 'edit_note'], ['tech', 'Tech and data lab', 'terminal'], ['flex', 'Flex desks', 'chair']];

/**
 * Where an agent sits: the meeting room while it waits for approval, the break room while idle, otherwise its team
 * room. An agent whose server job just ended stays at its desk for the done moment, then walks to the break room.
 */
export const roomOf = (a: Pick<Agent, 'id' | 'status' | 'ended'>): RoomId =>
  a.status === 'wait' ? 'meet' : a.status === 'idle' && !a.ended ? 'break' : (TEAM[a.id] || 'flex');

/* ---------- Content pipeline ---------- */

export interface Stage {
  id: 'res' | 'kw' | 'arc' | 'wr' | 'seo' | 'rev' | 'dep' | 'live';
  label: string;
  icon: string;
  /** Agents whose running workers are counted; null for the human gates and Published. */
  agents: readonly string[] | null;
  /** View (or tab, by its alias) opened by a click; only the human gates are buttons. */
  view?: ViewId | AliasId;
}
export const STAGES: readonly Stage[] = [
  { id: 'res', label: 'Research', icon: 'travel_explore', agents: ['res'] },
  { id: 'kw', label: 'Keywords', icon: 'key', agents: ['kw'] },
  { id: 'arc', label: 'Architecture', icon: 'lan', agents: ['arc'] },
  { id: 'wr', label: 'Writing and visuals', icon: 'edit_note', agents: ['wr', 'gd'] },
  { id: 'seo', label: 'SEO and links', icon: 'troubleshoot', agents: ['seo', 'lnk'] },
  { id: 'rev', label: 'Human review', icon: 'rate_review', agents: null, view: 'review' },
  { id: 'dep', label: 'Deploy approval', icon: 'rocket_launch', agents: null, view: 'website' },
  { id: 'live', label: 'Published', icon: 'public', agents: null },
];

export interface StageCount {
  st: Stage;
  n: number;
  /** data-k: "bad" when an agent of the stage has an error, "warn" for the bottleneck gate. */
  k: '' | 'bad' | 'warn';
  /** The pill under the label. */
  flag: { kind: PillKind; text: string } | null;
}

/**
 * Count per stage, inside the site filter: running workers for agent stages, items waiting for a person at the two
 * gates, and articles published this session. The busier gate with 3 or more items is flagged as the bottleneck.
 */
export function pipeData(s: Pick<AppState, 'agents' | 'articles' | 'approvals' | 'sites' | 'siteFilter' | 'autoPub'> & Partial<Pick<AppState, 'live' | 'sample'>>): StageCount[] {
  const d = STAGES.map((st): StageCount => {
    const ag = st.agents ? s.agents.filter(a => st.agents?.includes(a.id) && inSite(s, a.site)) : [];
    const n = st.agents ? ag.filter(a => a.status === 'work').reduce((t, a) => t + a.workers, 0)
      : st.id === 'rev' ? s.articles.filter(a => artVisible(s, a) && artOpen(a)).length
      : st.id === 'dep' ? s.approvals.filter(p => inSite(s, p.site)).length + waitingBuildsN(s)
      : s.articles.filter(a => artVisible(s, a) && a.status === 'published').length + s.autoPub;
    const err = ag.some(a => a.status === 'err');
    return { st, n, k: err ? 'bad' : '', flag: err ? { kind: 'bad', text: 'Error' } : null };
  });
  const gate = [d[5], d[6]].filter((x): x is StageCount => !!x && x.n >= 3).sort((x, y) => y.n - x.n)[0];
  if (gate) { gate.k = 'warn'; gate.flag = { kind: 'warn', text: 'Bottleneck' }; }
  return d;
}

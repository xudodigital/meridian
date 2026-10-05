/* Research slice: Research and SEO with its tabs (Architecture, Internal links and Experiments among them) and the Rank tab of Analytics.
   Owner: the research screens builder. */
import type { ResearchTab } from '../constants';
import { logMineTo, nextUid, snackTo } from '../draft';
import { siteById } from '../rules';
import type { AppState } from '../types';
import type { Slice } from './slice';

/** What the Internal link engine draws: the pages of one site, or the agents with their sites and skills. */
export type GraphMode = 'link' | 'agent';

/** The fields of the "New research request" form. */
export interface KwRequestInput { siteId: string; topic: string; goal: string }

export interface ResearchState {
  /** Tab of Research and SEO. */
  rctab: ResearchTab;
  /** Internal link engine mode (the prototype's state.gmode). */
  gmode: GraphMode;
}
export interface ResearchActions {
  /** The prototype's "tab" action: switches the tab and returns every list to its first page. */
  setRctab: (t: ResearchTab) => void;
  /** The prototype's "gmode" action (read-only, no role check). */
  setGmode: (m: GraphMode) => void;
  /**
   * Submits a keyword research request in simulation mode: the request is queued in the browser and the simulated
   * Keyword agent picks it up. Returns the form message on failure, null on success, and '' when the role may not do it
   * (the guard has already shown its snackbar). In live mode use sendRequest from store/live instead. Outside
   * demo mode nothing is simulated, so without the server the request is refused.
   */
  addKwRequest: (input: KwRequestInput) => string | null;
}

/** Why a request cannot be sent outside demo mode while the page is not served by the Meridian server. */
export const NO_SERVER = 'The Meridian server is not connected, so the request cannot run. Start it with ./start.sh and open the address it prints.';

/** The checks both modes run first (the prototype's first two fail() calls of the kwreq form). */
export function kwRequestError(s: Pick<AppState, 'sites'>, input: KwRequestInput): string | null {
  if (!input.topic.trim()) return 'Enter a topic or a few seed keywords.';
  if (!siteById(s, input.siteId)) return 'Choose a site.';
  return null;
}

export const researchSlice: Slice<ResearchState, ResearchActions> = {
  initial: { rctab: 'research', gmode: 'link' },
  actions: (set, get) => ({
    setRctab: t => set(d => { d.rctab = t; d.pg = {}; }),
    setGmode: m => set(d => { d.gmode = m; }),
    addKwRequest: input => {
      if (!get().guard()) return '';
      const s = get(), err = kwRequestError(s, input);
      if (err) return err;
      if (!s.sample) return NO_SERVER;
      const topic = input.topic.trim();
      if (!s.agents.some(a => a.id === 'kw')) return 'The Keyword agent was removed. Add it again in Team before sending a request.';
      if (s.kwReqs.some(r => r.st !== 'done' && r.site === input.siteId && r.topic.toLowerCase() === topic.toLowerCase())) return 'This request is already in the queue for that site.';
      set(d => {
        d.kwReqs.unshift({ id: nextUid(d), site: input.siteId, topic, goal: input.goal, t: new Date(), st: 'queued' });
        logMineTo(d, 'Requested keyword research: ' + topic, input.siteId);
        snackTo(d, 'Request sent. The Keyword agent takes it when it is free.', 'search');
      });
      return null;
    },
  }),
};

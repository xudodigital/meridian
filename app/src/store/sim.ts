/* The simulation tick, ported from the "Simulation" section of web/index.html.
   Paced like real work: a task takes about three minutes, an idle agent waits about a minute for the next one.
   It invents work only in demo mode (state.sample). Otherwise it does two things: the idle sign-out, and the agents
   the server drives (liveAgents.ts liveTickTo): their progress by the time a job has run, access checks starting and
   ending, and the end of the short done moment after a job.

   simTick() mutates the state object it is given (an immer draft inside the store, a plain object in tests) and
   returns what the caller needs to know. It does not render anything: React re-renders from the store. */
import { PROV, TICK_MS, TLBL, TOMS } from './constants';
import { addLogTo, logRunTo, nextUid, notifyTo, signOutTo, submitArticleTo } from './draft';
import { liveProgress, liveTickTo } from './liveAgents';
import { costOf, keyOK, liveOn, missingProv, pick, provOf, rand, siteById, siteOpen, type Rand } from './rules';
import type { AppState } from './types';

export interface TickEnv {
  /** False in follower tabs: retain idle sign-out, but only the shared clock invents demo work. */
  demoClock?: boolean;
  /** Current time in milliseconds. */
  now: number;
  /** Time of the person's last pointer or key press, for the idle sign-out. */
  lastActive: number;
  /** Random source in [0, 1). */
  rand: Rand;
}

export interface TickResult {
  /** The tick did nothing because nobody is signed in. */
  skipped: boolean;
  /** The person was signed out for inactivity during this tick. */
  signedOut: boolean;
  /** Ids of agents that finished a job in this tick, in order. */
  finished: string[];
  /** A deploy approval was requested in this tick. */
  approvalsChanged: boolean;
}

/** Everything in the state the tick reads or writes. */
export type SimState = Pick<AppState,
  'sample' | 'session' | 'auth' | 'loginNote' | 'confirm' | 'pop' | 'searchOpen' | 'navOpen'
  | 'sites' | 'agents' | 'approvals' | 'articles' | 'artN' | 'autoPub' | 'settings' | 'ints' | 'kwReqs' | 'live'
  | 'log' | 'snackMsg' | 'notifs' | 'np' | 'jobLog' | 'uid' | 'keyWarned' | 'handoff'> & {
  /** Site ids with an access check running (the sites slice; absent from a plain AppState in tests). */
  checking?: readonly string[];
};

export function simTick(s: SimState, env: TickEnv): TickResult {
  const res: TickResult = { skipped: false, signedOut: false, finished: [], approvalsChanged: false };
  const rng = env.rand;
  if (!s.session) { res.skipped = true; return res; }
  if (env.now - env.lastActive > TOMS[s.settings.timeout]) {
    signOutTo(s, 'You were signed out after ' + TLBL[s.settings.timeout] + ' without activity.');
    res.signedOut = true; return res;
  }
  /* Outside demo mode nothing is invented: only the agents the server is driving move. */
  if (!s.sample) { liveTickTo(s, env.now); return res; }
  if (env.demoClock === false) return res;
  const liveSites = s.sites.filter(x => siteOpen(s, x));
  for (const a of s.agents) {
    if (a.live) { liveProgress(a, env.now); continue; }
    const hasKey = keyOK(s, a), pn = PROV[provOf(a.model)].name;
    if (a.status === 'work') {
      const ss = siteById(s, a.site);
      if (!hasKey) {
        a.status = 'err'; a.errKey = true; a.progress = 0; a.task = pn + ' API key is missing. Add it in Integrations.';
        addLogTo(s, a.name, 'Stopped: the ' + pn + ' API key is missing', a.site);
        if (!s.keyWarned) { s.keyWarned = true; notifyTo(s, 'bad', 'key', 'Agents stopped: the ' + pn + ' API key is missing', 'Add the key in Integrations, or switch those agents to another model.', 'integrations', 'error'); }
        continue;
      }
      if (!ss || !siteOpen(s, ss)) {
        addLogTo(s, a.name, 'Stopped: ' + (!ss ? 'the site was removed' : ss.status === 'paused' ? 'the site is paused' : ss.spend >= s.settings.budget ? 'the site used its daily budget' : 'the site is not ready'), ss ? ss.id : null);
        a.status = 'idle'; a.progress = 0; a.task = 'Waiting for a task'; continue;
      }
      a.progress = Math.min(100, a.progress + rand(0.5, 1.5, rng));
      const dt = Math.round(rand(100, 560, rng) * a.workers); a.tokens += dt;
      {
        const b0 = ss.spend / s.settings.budget; ss.spend += costOf(dt, a.model, env.now); const b1 = ss.spend / s.settings.budget;
        if (b0 < .8 && b1 >= .8) notifyTo(s, 'warn', 'savings', `${ss.domain} passed 80% of its daily budget`, 'Agents on this site stop when the budget is used up.', 'analytics', 'budget');
        if (b0 < 1 && b1 >= 1) notifyTo(s, 'bad', 'savings', `${ss.domain} used its whole daily budget`, 'Its agents are held until tomorrow or until you raise the budget.', 'analytics', 'budget');
      }
      if (a.progress >= 100) {
        addLogTo(s, a.name, 'Finished: ' + a.task, a.site); logRunTo(s, a, 'Done', 0, rng, env.now); res.finished.push(a.id);
        if (a.req) { const r = s.kwReqs.find(x => x.id === a.req); a.req = null; if (r) { r.st = 'done'; notifyTo(s, 'info', 'search', 'Keyword research is ready: ' + r.topic, 'Open Research and SEO, Keywords tab.', 'research'); } }
        if (a.gate === 'Publish') submitArticleTo(s, a, rng);
        const need = a.gate === 'Deploy' ? s.settings.apDeploy : false;
        if (need && s.approvals.length < 5 && rng() < .6) {
          const id = nextUid(s); s.approvals.push({ id, kind: 'Deploy', what: a.task, site: a.site, agent: a.id }); a.pending = id; a.status = 'wait'; res.approvalsChanged = true;
          addLogTo(s, a.name, 'Requested deploy approval', a.site); notifyTo(s, 'warn', 'rocket_launch', 'A deploy needs your approval', a.task, 'deploy', 'approval');
        } else { a.status = 'idle'; a.progress = 0; a.task = 'Waiting for a task'; }
      }
    } else if (a.status === 'idle') {
      if (a.req) { const r0 = s.kwReqs.find(x => x.id === a.req); if (r0 && r0.st === 'work') r0.st = 'queued'; a.req = null; }
      /* Outside live mode the Keyword agent takes the oldest queued research request first. */
      const rq = !liveOn(s) && a.id === 'kw' && hasKey ? [...s.kwReqs].reverse().find(r => r.st === 'queued' && siteOpen(s, siteById(s, r.site))) : null;
      if (rq) { rq.st = 'work'; a.req = rq.id; a.site = rq.site; a.task = 'Researching keywords: ' + rq.topic; a.status = 'work'; a.progress = 2; a.tok0 = a.tokens; addLogTo(s, a.name, 'Started: ' + a.task, a.site); }
      else if (hasKey && liveSites.length && rng() < .03) { a.site = pick(liveSites, rng).id; a.task = pick(a.tasks, rng); a.status = 'work'; a.progress = 2; a.tok0 = a.tokens; addLogTo(s, a.name, 'Started: ' + a.task, a.site); }
    } else if (a.status === 'err') {
      if (a.errKey) { if (hasKey) { a.errKey = false; a.status = 'idle'; a.task = 'Waiting for a task'; addLogTo(s, a.name, 'Ready again: the ' + pn + ' API key is available'); } }
      else if (hasKey) {
        /* The prototype's `--a.errT<=0`: an agent without a countdown never retries on its own. */
        a.errT = (a.errT as number) - 1;
        if (a.errT <= 0) { a.status = 'work'; a.progress = 5; a.task = pick(a.tasks, rng); a.tok0 = a.tokens; addLogTo(s, a.name, 'Retried automatically and resumed', a.site); }
      }
    }
  }
  if (!missingProv(s).length) s.keyWarned = false;
  /* Articles sent back for revision return to the queue once the writer has had time to rewrite them.
     A real article is revised by the server, not here. */
  const writer = s.agents.find(a => a.gate === 'Publish' && a.status !== 'off' && a.status !== 'err');
  for (const x of s.articles) {
    if (x.status !== 'revisi' || x.live || !writer || !keyOK(s, writer)) continue;
    x.wait = (x.wait as number) - 1;
    if (x.wait <= 0) {
      x.status = 'review'; x.rev++; x.native = { st: 'wait' };
      x.checks = x.checks.map(c => c[0] === 'ok' || c[0] === 'info' ? c : ['ok', c[1], 'Fixed in revision ' + x.rev]);
      x.notes.push(`Revision ${x.rev}: the agent rewrote the article from the note. The language review starts again.`);
      addLogTo(s, 'Content Writer', 'Resubmitted after revision: ' + x.titleEn, x.s);
      notifyTo(s, 'info', 'rate_review', 'A revised article is back in review', x.titleEn, 'review', 'review');
    }
  }
  return res;
}

/** Starts the one interval that drives the simulation. Returns a function that stops it. */
export function startSim(tick: () => void, ms: number = TICK_MS): () => void {
  const id = setInterval(tick, ms);
  return () => clearInterval(id);
}

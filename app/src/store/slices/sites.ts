/* Sites slice: Sites, Workflows, Build and deploy. Owner: the sites screens builder.
   Ported from the prototype's handlers: site-verify, site-pause, map-sel, map-list, sites-mode, the sf filters and the
   sq search, the "site" form, check, wf-next, sch-run, and the data-cad / data-sch changes. Outside demo mode it also
   asks the server for website builds and decides them (approve, reject, deploy); the server records who did it in the
   audit log, so these actions only show the snackbar, and its answer is put in the store (liveBuilds.ts). */
import { ACC, COUNTRIES, WF_STEPS, type DeployTab } from '../constants';
import { deploying } from '../builds';
import { buildsApi } from '../buildsApi';
import { addLogTo, logMineTo, newId, snackTo } from '../draft';
import { liveBuildTo } from '../liveBuilds';
import { N_MAX, N_MIN, WEEKLY, cadenceText, workflowTo } from '../liveWorkflows';
import { hhmm, siteById } from '../rules';
import { servicesApi } from '../servicesApi';
import type { BuildWire, Cadence, ScheduleEvery, SiteStatus } from '../types';
import { workflowApi } from '../workflowApi';
import type { Slice, SliceGet, SliceSet } from './slice';

export type SitesMode = 'list' | 'map' | 'themes';
/** Status filter of the sites list; "blocked" filters on access instead of status. */
export type SitesStatusFilter = '' | SiteStatus | 'blocked';

/** The status a person can give a domain they add outside demo mode. */
export type NewSiteStatus = Extract<SiteStatus, 'build' | 'live'>;
/** What the "Add a domain" form sends. `country` is an index into COUNTRIES; `status` is used outside demo mode. */
export interface NewSite { domain: string; country: number; lang: string; topic: string; status: NewSiteStatus }

/** What the "New schedule" and "Edit schedule" forms send (outside demo mode). `id` names the schedule being edited. */
export interface ScheduleInput { id?: string; site: string; every: ScheduleEvery; weekday: number; hour: number; n: number; topic: string }

/** Why "Check now" cannot run: the probe network's last test failed. */
export const NO_PROBE = 'The probe network is not working. Test it in Integrations.';

/** Why a site cannot be built yet (the server says the same). */
export const NO_ARTICLES = 'Approve at least one article for this site first.';

/** How long a simulated access check takes, in ms. */
export const CHECK_MS = 1200;

export interface SitesState {
  /** How the Sites screen is shown. */
  smode: SitesMode;
  /** Tab of Build and deploy: the website (builds, approvals, access, deploys) or the workflows. */
  dtab: DeployTab;
  /** Search text of the sites list. */
  sq: string;
  sst: SitesStatusFilter;
  /** Country name filter, "" for any. */
  sco: string;
  /** Country code selected on the map, or null for the first country in the list. */
  mapSel: string | null;
  /** Site ids with an access check in flight (the prototype's state.checking). */
  checking: string[];
}
export interface SitesActions {
  /** Switches the tab of Build and deploy and returns every list to its first page. */
  setDtab: (t: DeployTab) => void;
  setSmode: (m: SitesMode) => void;
  /** Sets any of the list filters and returns the list to its first page. */
  setSitesFilter: (f: Partial<Pick<SitesState, 'sq' | 'sst' | 'sco'>>) => void;
  /** The prototype's map-sel: selects a country on the map. */
  selectMapCountry: (cc: string) => void;
  /** The prototype's map-list: shows the sites of one country in the list. */
  showCountryInList: (cc: string) => void;
  /** The prototype's site-verify: marks the DNS as verified (simulated) and starts building. Demo mode. */
  verifySite: (id: string) => void;
  /** Looks up the site's TXT record on public DNS (outside demo mode). Resolves to the reason it is not verified, or null. */
  verifyOwnership: (id: string) => Promise<string | null>;
  /** The prototype's site-pause: pauses a site, or resumes it in the status it had. */
  pauseSite: (id: string) => void;
  /** The "site" form. Returns the validation message, or null when the domain was added. */
  addSite: (f: NewSite) => string | null;
  /** The prototype's check: an access check from inside the site's country (simulated in demo mode, on the probe network otherwise). */
  checkAccess: (id: string) => void;
  /** The prototype's wf-next: moves a running workflow (index in `runs`) to its next step. */
  advanceRun: (index: number) => void;
  /** The prototype's sch-run: starts a scheduled workflow now. Outside demo mode the server starts the run. */
  runSchedule: (id: string) => Promise<void>;
  /** "Run workflow": starts "Weekly content" for a site now, on the server. Resolves to the server's refusal, '' when the role may not, or null. */
  runWorkflow: (f: { siteId: string; n: number; topic: string }) => Promise<string | null>;
  /** "Cancel" on a running workflow: the server withdraws the jobs it queued that have not started. */
  cancelWorkflow: (id: number) => Promise<void>;
  /** Adds a "Weekly content" schedule, or changes the one named by `id`. Returns the validation message, '' when the role may not, or null. */
  saveSchedule: (f: ScheduleInput) => string | null;
  removeSchedule: (id: string) => void;
  /** The prototype's data-cad change. */
  setCadence: (id: string, cad: Cadence) => void;
  /** The prototype's data-sch change: enables or pauses a schedule. */
  setScheduleOn: (id: string, on: boolean) => void;
  /** "Build website": the Site Builder builds the site from its approved articles, on the server. Resolves when answered. */
  buildWebsite: (siteId: string) => Promise<void>;
  /** "Approve" on a build waiting for review. The server then queues the deploy when Cloudflare is connected. */
  approveBuild: (id: number) => Promise<void>;
  /** "Reject" on a build waiting for review, with the reason. Resolves to the message to show, '' when the role may not, or null. */
  rejectBuild: (id: number, note: string) => Promise<string | null>;
  /** "Deploy", "Try deploy again" or a roll back: puts an approved build live on Cloudflare Pages, on the server. */
  deployBuild: (id: number) => Promise<void>;
}

const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

const message = (e: unknown): string => e instanceof Error ? e.message : String(e);
/** "kopi.example v3", for snackbars. */
const buildName = (b: Pick<BuildWire, 'domain' | 'version'> | undefined): string => b ? b.domain + ' v' + b.version : 'the build';

type BuildDone = (b: BuildWire | undefined) => readonly [msg: string, icon: string];
/**
 * Sends a request about a build and puts the server's answer in the store, with the snackbar `done` gives for it (or
 * for the build as the store knew it, when the answer carries none). Resolves to the server's refusal, or null.
 */
async function buildCall(set: SliceSet, call: Promise<BuildWire | null>, known: BuildWire | undefined, done: BuildDone): Promise<string | null> {
  try {
    const b = await call;
    set(d => { if (b) liveBuildTo(d, b); const [msg, icon] = done(b ?? known); snackTo(d, msg, icon); });
    return null;
  } catch (e) { return message(e); }
}
/** The same, with a refusal shown in the snackbar. */
async function buildAct(set: SliceSet, get: SliceGet, call: Promise<BuildWire | null>, known: BuildWire | undefined, done: BuildDone): Promise<void> {
  const err = await buildCall(set, call, known, done);
  if (err) get().snack(err, 'error');
}

export const sitesSlice: Slice<SitesState, SitesActions> = {
  initial: { smode: 'list', dtab: 'website', sq: '', sst: '', sco: '', mapSel: null, checking: [] },
  actions: (set, get) => ({
    setDtab: t => set(d => { d.dtab = t; d.pg = {}; }),
    setSmode: m => set(d => { d.smode = m === 'map' || m === 'themes' ? m : 'list'; }),
    setSitesFilter: f => set(d => { Object.assign(d, f); d.pg.sites = 0; }),

    selectMapCountry: cc => set(d => { d.mapSel = cc; }),
    showCountryInList: cc => set(d => {
      d.sco = d.sites.find(x => x.cc === cc)?.country ?? ''; d.sst = ''; d.sq = ''; d.smode = 'list'; d.pg.sites = 0;
    }),

    verifySite: id => {
      if (!get().guard()) return;
      set(d => {
        const s = siteById(d, id); if (!s) return;
        s.status = 'build'; s.access = 'ok'; s.checked = hhmm(new Date()); s.silos = ['Silo 1', 'Silo 2', 'Silo 3'];
        d.runs.forEach(r => { if (r.site === s.id && r.step === 0) r.step = 1; });
        logMineTo(d, 'DNS verified (simulated)', s.id);
      });
    },

    verifyOwnership: async id => {
      if (!get().guard()) return '';
      try {
        const r = await servicesApi.verify(id);
        set(d => { d.live.verify[id] = r.verify; snackTo(d, 'Verified: you control ' + r.verify.domain + '.', 'verified'); });
        return null;
      } catch (e) { return e instanceof Error ? e.message : String(e); }
    },

    pauseSite: id => {
      if (!get().guard()) return;
      set(d => {
        const s = siteById(d, id); if (!s) return;
        if (s.status === 'paused') s.status = s.prev || 'live'; else { s.prev = s.status; s.status = 'paused'; }
        logMineTo(d, (s.status === 'paused' ? 'Paused ' : 'Resumed ') + s.domain, s.id);
      });
    },

    addSite: f => {
      if (!get().guard()) return null;
      const domain = f.domain.trim().toLowerCase();
      if (!DOMAIN_RE.test(domain)) return 'That domain is not valid. Write it without https://, for example domain-f.example.';
      if (get().sites.some(s => s.domain === domain)) return 'This domain is already registered.';
      const c = COUNTRIES[f.country] ?? COUNTRIES[0];
      const token = 'verify-' + Math.random().toString(36).slice(2, 8);
      set(d => {
        const id = newId(d, 's');
        const site = { id, domain, country: c[0], cc: c[1], lang: f.lang.trim() || c[2], topic: f.topic.trim(), spend: 0, clicks: 0, tok28: 0, access: 'pending' as const, checked: '—', deploy: 'Never', silos: [] };
        /* The DNS check and the "New site" workflow are part of the simulation. Outside it the domain is simply recorded. */
        if (d.sample) { d.sites.push({ ...site, status: 'dns', token }); d.runs.push({ name: 'New site', site: id, step: 0 }); }
        else d.sites.push({ ...site, status: f.status });
        logMineTo(d, `Added ${domain} (${c[0]})`, id);
      });
      return null;
    },

    checkAccess: id => {
      if (!get().guard()) return;
      if (!get().sample) {
        if (get().checking.includes(id)) return;
        /* The check runs on the server for up to a minute; the event stream ends "Checking" and brings the result. */
        set(d => { d.checking.push(id); });
        servicesApi.check(id).catch((e: unknown) => {
          set(d => { d.checking = d.checking.filter(x => x !== id); });
          get().snack(e instanceof Error ? e.message : String(e), 'error');
        });
        return;
      }
      set(d => { if (!d.checking.includes(id)) d.checking.push(id); });
      setTimeout(() => set(d => {
        d.checking = d.checking.filter(x => x !== id);
        const s = siteById(d, id); if (!s) return;
        s.checked = hhmm(new Date());
        if (s.access === 'pending' && s.status !== 'dns') s.access = 'ok';
        addLogTo(d, 'Deploy & Monitor', 'Access check: ' + ACC[s.access][1].toLowerCase() + ' from ' + s.country, id);
      }), CHECK_MS);
    },

    advanceRun: index => {
      if (!get().guard()) return;
      const r = get().runs[index];
      if (r && siteById(get(), r.site)?.status === 'dns') { get().snack('Verify the domain\'s DNS before this workflow can continue.', 'info'); return; }
      set(d => {
        const run = d.runs[index];
        if (run && run.step < WF_STEPS.length - 1) { run.step++; addLogTo(d, 'Orchestrator', `"${run.name}" moved to ${WF_STEPS[run.step]}`, run.site); }
      });
    },

    runSchedule: async id => {
      if (!get().guard()) return;
      if (get().sample) {
        set(d => { const c = d.schedules.find(x => x.id === id); if (c) logMineTo(d, 'Started "' + c.wf + '" now', c.site); });
        return;
      }
      /* The server starts the run from the saved schedule and records who asked in the audit log. */
      try {
        const run = await workflowApi.runSchedule(id);
        set(d => { workflowTo(d, run); snackTo(d, `Started "${run.name}" for ${run.domain}.`, 'play_arrow'); });
      } catch (e) { get().snack(message(e), 'error'); }
    },

    runWorkflow: async f => {
      if (!get().guard()) return '';
      const site = siteById(get(), f.siteId);
      if (!site) return 'Choose a site.';
      const n = Math.round(f.n);
      if (!(n >= N_MIN && n <= N_MAX)) return `Choose ${N_MIN} to ${N_MAX} articles.`;
      try {
        const run = await workflowApi.run({ siteId: site.id, n, topic: f.topic.trim() });
        set(d => { workflowTo(d, run); snackTo(d, `Started "${run.name}" for ${run.domain}.`, 'play_arrow'); });
        return null;
      } catch (e) { return message(e); }
    },

    cancelWorkflow: async id => {
      if (!get().guard()) return;
      try {
        const run = await workflowApi.cancel(id);
        set(d => { workflowTo(d, run); snackTo(d, `Cancelled "${run.name}" for ${run.domain}.`, 'cancel'); });
      } catch (e) { get().snack(message(e), 'error'); }
    },

    saveSchedule: f => {
      if (!get().guard()) return '';
      const site = siteById(get(), f.site);
      if (!site) return 'Choose a site.';
      const n = Math.round(f.n), weekday = Math.round(f.weekday), hour = Math.round(f.hour);
      if (!(n >= N_MIN && n <= N_MAX)) return `Choose ${N_MIN} to ${N_MAX} articles per run.`;
      if (!(weekday >= 0 && weekday <= 6) || !(hour >= 0 && hour <= 23)) return 'Choose a weekday and an hour.';
      if (f.every !== 'week' && f.every !== '2weeks' && f.every !== 'month') return 'Choose how often it runs.';
      const topic = f.topic.replace(/\s+/g, ' ').trim().slice(0, 80);
      set(d => {
        const cur = f.id ? d.schedules.find(x => x.id === f.id) : undefined;
        const when = cadenceText({ every: f.every, weekday, hour });
        if (cur) {
          Object.assign(cur, { wf: WEEKLY, site: site.id, every: f.every, weekday, hour, n, topic });
          logMineTo(d, `Changed the "${WEEKLY}" schedule of ${site.domain}: ${when.toLowerCase()}, ${n} article${n === 1 ? '' : 's'}`, site.id);
        } else {
          d.schedules.push({ id: newId(d, 'c'), wf: WEEKLY, site: site.id, cad: 'Manual only', on: true, every: f.every, weekday, hour, n, topic });
          logMineTo(d, `Scheduled "${WEEKLY}" for ${site.domain}: ${when.toLowerCase()}, ${n} article${n === 1 ? '' : 's'}`, site.id);
        }
      });
      return null;
    },

    removeSchedule: id => {
      if (!get().guard()) return;
      set(d => {
        const i = d.schedules.findIndex(x => x.id === id); if (i < 0) return;
        const c = d.schedules[i]!;
        d.schedules.splice(i, 1);
        logMineTo(d, `Removed the "${c.wf}" schedule` + (siteById(d, c.site) ? ' of ' + siteById(d, c.site)!.domain : ''), c.site);
      });
    },

    setCadence: (id, cad) => {
      if (!get().guard()) return;
      set(d => { const c = d.schedules.find(x => x.id === id); if (!c) return; c.cad = cad; logMineTo(d, `"${c.wf}" now runs: ${cad.toLowerCase()}`, c.site); });
    },

    setScheduleOn: (id, on) => {
      if (!get().guard()) return;
      set(d => { const c = d.schedules.find(x => x.id === id); if (!c) return; c.on = on; logMineTo(d, `${on ? 'Enabled' : 'Paused'} the schedule for "${c.wf}"`, c.site); });
    },

    buildWebsite: async siteId => {
      if (!get().guard()) return;
      const site = siteById(get(), siteId); if (!site) return;
      await buildAct(set, get, buildsApi.build(siteId), undefined, () => ['Asked the Site Builder to build ' + site.domain + '.', 'construction']);
    },

    approveBuild: async id => {
      if (!get().guard()) return;
      /* The server says why an approved build does not go live by itself (no Cloudflare, or a newer version is live). */
      let note = '';
      const call = buildsApi.approve(id).then(r => { note = r.note; return r.build; });
      await buildAct(set, get, call, get().live.builds[id], b => b && deploying(b)
        ? ['Approved ' + buildName(b) + '. Deploy & Monitor is putting it live.', 'rocket_launch']
        : ['Approved ' + buildName(b) + '.' + (note ? ' ' + note : ''), 'verified']);
    },

    rejectBuild: async (id, note) => {
      if (!get().guard()) return '';
      const text = note.trim();
      if (!text) return 'Write why it is rejected, so the next build can fix it.';
      return buildCall(set, buildsApi.reject(id, text), get().live.builds[id], b => ['Rejected ' + buildName(b) + '.', 'block']);
    },

    deployBuild: async id => {
      if (!get().guard()) return;
      await buildAct(set, get, buildsApi.deploy(id), get().live.builds[id], b => ['Deploy & Monitor is putting ' + buildName(b) + ' live.', 'rocket_launch']);
    },
  }),
};

/* The Zustand store holds real server data and UI state. Demo mode is retired.
   Sample records are available only to isolated tests and are stripped from production builds.
   Sessions come from the server; updates go through Immer drafts. */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';
import { authApi } from './authApi';
import { ALIAS, PROV } from './constants';
import { addLogTo, logMineTo, nextUid, notifyTo, purge, releaseOrphansTo, signInTo, signOutTo, snackTo } from './draft';
import { artOpen, canSee, hhmm, homeSite, liveVer, nextAgent, provOf, siteById } from './rules';
import { createEmpty } from './empty';
import { liveApply } from './liveApply';
import { markReadTo } from './liveNotifs';
import { ApiError } from './serverApi';
import { actor, cleanName, nameError, sessionOf } from './session';
import { createSeed, type SeedData } from './seed';
import { emptyLive } from './liveState';
import { serverFactsTo } from './serverFacts';
import { simTick } from './sim';
import { KEY_DEMO, KEY_THEME, readKey, writeKey } from './storage';
import { contentSlice, type ContentActions, type ContentState } from './slices/content';
import { researchSlice, type ResearchActions, type ResearchState } from './slices/research';
import { sitesSlice, type SitesActions, type SitesState } from './slices/sites';
import type { SliceGet, SliceSet } from './slices/slice';
import { systemSlice, type SystemActions, type SystemState } from './slices/system';
import { workspaceSlice, type WorkspaceActions, type WorkspaceState } from './slices/workspace';
import type {
  AliasId, AppState, ConfirmKey, ConfirmKind, ConfirmState, Me, NotifyEvent, PillKind, PopId, Theme, ViewId,
} from './types';

export interface CoreActions {
  /** Escape hatch for one-off changes from a component: mutate the draft. Prefer a named action in your slice. */
  mutate: (recipe: (draft: AppStore) => void) => void;

  /**
   * Role check for anything that changes data. Returns false and shows the prototype's snackbar when the signed-in
   * role may not do it. Call it first in every mutating action: `if (!get().guard()) return;`
   * Use guard('review') for the two things a native reviewer may do (language review, request a revision).
   */
  guard: (kind?: 'write' | 'review') => boolean;

  /** Audit-log entry under `who` (an agent's name). For what the signed-in person did use logMine. */
  addLog: (who: string, act: string, site?: string | null) => void;
  /** Audit-log entry under the signed-in person's name, also shown as a snackbar (the prototype's addLog('Admin', ...)). */
  logMine: (act: string, site?: string | null) => void;
  /** In-app notification. `ev` ties it to a Settings alert so it can be switched off. */
  notify: (k: PillKind, icon: string, title: string, body: string, view: ViewId, ev?: NotifyEvent) => void;
  /** "Mark all read": every notification the role can see; the read state of live ones is remembered across reloads. */
  markNotificationsRead: () => void;
  readNotification: (id: number) => void;
  /** A click in the bell: marks it read, closes the panel, selects its article or the Keywords tab. Returns the view to open. */
  openNotification: (id: number) => ViewId | null;
  snack: (msg: string, icon?: string) => void;
  hideSnack: () => void;

  /**
   * The server signed the person in (first-run owner account, sign-in with or without the 2-step code, or an accepted
   * invitation). Outside demo mode sync.ts then loads the workspace.
   */
  signIn: (me: Me) => void;
  /** The server's newer answer about the signed-in person (name, role, 2-step): updates the session. */
  setMe: (me: Me) => void;
  /**
   * Signs out of this page with an optional note for the sign-in screen, and clears the workspace from memory so the
   * next person starts clean. `server` false when the session already ended there (an expired session).
   */
  signOut: (msg?: string, server?: boolean) => void;
  /** "Change name" in the account menu, saved on the server. Resolves to the message to show, or null when saved. */
  changeName: (name: string) => Promise<string | null>;

  setTheme: (t: Theme | null) => void;
  /** Switches between light and dark, starting from what is shown now. */
  toggleTheme: () => void;

  /** Top-bar site filter: "all" or a site id. Returns every list to its first page. */
  setSiteFilter: (id: string) => void;
  setPage: (key: string, page: number) => void;
  resetPages: () => void;

  /** Opens the confirm dialog for a destructive action. See ConfirmKey for the keys. */
  openConfirm: (key: ConfirmKey) => void;
  closeConfirm: () => void;
  /** The confirm button: runs what the open dialog asked about. */
  confirmOk: () => void;
  /** Revokes a key or disconnects an account at once. Use openConfirm('key:<id>') when agents run on that provider. */
  revokeKey: (id: string) => void;
  /** Approves or rejects an item in the "Needs approval" queue (Workspace and Build and deploy). */
  decideApproval: (id: number, ok: boolean) => void;

  setPop: (p: PopId | null) => void;
  setSearchOpen: (open: boolean) => void;
  setNavOpen: (open: boolean) => void;

  /** Applies an old module alias (sets the tab it maps to) and returns the view to open. */
  applyAlias: (alias: AliasId) => ViewId;

  /** One simulation step. Called every 1800 ms from main.tsx; never call it from a screen. */
  tick: (demoClock?: boolean) => void;

  /** Compatibility cleanup for older tabs. Enabling retired demo mode is ignored. */
  setSampleData: (on: boolean) => void;
}

export type AppStore = AppState & CoreActions
  & WorkspaceState & WorkspaceActions
  & ContentState & ContentActions
  & SitesState & SitesActions
  & ResearchState & ResearchActions
  & SystemState & SystemActions;

/* ---------- Things that live outside the state ---------- */

/** Time of the last pointer or key press; the simulation signs the person out after the configured idle time. */
let lastActive = Date.now();
export const touchActivity = (): void => { lastActive = Date.now(); };
export const lastActivity = (): number => lastActive;

function storedTheme(): Theme | null { const t = readKey(KEY_THEME); return t === 'light' || t === 'dark' ? t : null; }

/** The theme on screen: the explicit choice, else the operating system's. */
export function isDark(theme: Theme | null = useStore.getState().theme): boolean {
  if (theme) return theme === 'dark';
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/* ---------- Confirm dialog: what each key asks and does ---------- */

function describeConfirm(s: AppStore, key: ConfirmKey): ConfirmState | null {
  const i = key.indexOf(':'), kind = key.slice(0, i) as ConfirmKind, id = key.slice(i + 1);
  const mk = (title: string, body: string, label = 'Remove'): ConfirmState => ({ key, kind, id, title, body, label });
  switch (kind) {
    case 'ag': { const a = s.agents.find(x => x.id === id); return a ? mk('Remove this agent?', `${a.name} leaves the workspace and its current task stops.`) : null; }
    case 'site': { const x = siteById(s, id); return x ? mk('Remove this domain?', `${x.domain} is removed from the dashboard together with its workflows, schedules, deploy history and articles waiting for review. The website itself is not changed.${s.sample ? '' : ' Its Cloudflare Pages project, domain and DNS records are not deleted: remove them in the Cloudflare dashboard if the site should go offline.'}`) : null; }
    case 'rb': {
      const x = s.deploys.find(d => d.id === id); if (!x) return null; const fw = x.ver > liveVer(s, x.site);
      return mk((fw ? 'Roll forward' : 'Roll back') + ' to v' + x.ver + '?', `${siteById(s, x.site)?.domain ?? 'The site'} switches to "${x.what}". The other versions are kept, so you can switch again later.`, fw ? 'Roll forward' : 'Roll back');
    }
    case 'key': {
      const n = s.ints.find(x => x.id === id); if (!n) return null; const u = s.agents.filter(a => provOf(a.model) === id).length;
      return mk('Revoke the ' + n.name + ' key?', `${u} agent${u === 1 ? ' runs' : 's run'} on this provider and will stop until you add a key again or switch ${u === 1 ? 'it' : 'them'} to another model. To change the key without stopping anything, use Replace key instead.`, 'Revoke');
    }
    case 'all': return mk('Pause every agent?', 'All agents stop after their current step. Nothing is lost, and you can resume them at any time.', 'Pause all');
    case 'user': { const u = s.users.find(x => x.id === id && !x.invite); return u ? mk('Remove this person?', `${u.name} (${u.email}) will no longer be able to sign in.`) : null; }
    case 'inv': { const u = s.users.find(x => x.id === id && x.invite); return u ? mk('Revoke this invitation?', `The link sent to ${u.email} stops working. You can invite them again later.`, 'Revoke') : null; }
    case 'art': { const x = s.articles.find(r => String(r.id) === id); return x ? mk('Reject this article?', `"${x.titleEn}" will not be published. This decision is recorded in the audit log.`, 'Reject') : null; }
    default: return null;
  }
}

function revokeKeyIn(d: AppStore, id: string): void {
  const n = d.ints.find(x => x.id === id); if (!n) return;
  n.tail = null; n.st = null; n.msg = null; logMineTo(d, 'Revoked the ' + n.name + ' credential');
}

function runConfirm(d: AppStore, c: ConfirmState): void {
  const id = c.id;
  switch (c.kind) {
    case 'ag': { /* ag-del */
      const a = d.agents.find(x => x.id === id); if (!a) return;
      d.approvals.forEach(p => { if (p.agent === a.id) p.agent = null; });
      d.agents.splice(d.agents.indexOf(a), 1);
      if (d.agentSheet === id) d.agentSheet = null;
      logMineTo(d, 'Removed the agent ' + a.name); return;
    }
    case 'site': { /* site-del */
      const x = siteById(d, id); if (!x) return;
      d.sites.splice(d.sites.indexOf(x), 1);
      d.approvals = d.approvals.filter(p => p.site !== id); releaseOrphansTo(d);
      purge(d.runs, r => r.site === id); purge(d.schedules, s => s.site === id); purge(d.deploys, s => s.site === id);
      /* Real articles stay on the server and keep their own domain, like research requests. */
      purge(d.articles, a => a.s === id && !a.live);
      if (d.siteFilter === id) d.siteFilter = 'all';
      logMineTo(d, 'Removed the domain ' + x.domain); return;
    }
    case 'rb': { /* dep-rb */
      const x = d.deploys.find(s => s.id === id), site = x && siteById(d, x.site); if (!x || !site) return;
      const fw = x.ver > liveVer(d, x.site);
      d.deploys.forEach(s => { if (s.site === x.site) s.live = false; }); x.live = true;
      site.deploy = (fw ? 'Rolled forward' : 'Rolled back') + ' to v' + x.ver;
      logMineTo(d, 'Rolled ' + site.domain + (fw ? ' forward' : ' back') + ' to v' + x.ver, x.site); return;
    }
    case 'key': revokeKeyIn(d, id); return;
    case 'all': /* all-pause */
      d.agents.forEach(x => { x.pending = null; x.errKey = false; x.status = 'off'; x.progress = 0; x.task = 'Paused by admin'; });
      d.approvals.forEach(p => { p.agent = null; });
      logMineTo(d, 'Paused every agent'); return;
    case 'user': { /* user-del, demo mode (the real team is changed on the server by the system slice) */
      const u = d.users.find(x => x.id === id); if (!u) return;
      d.users.splice(d.users.indexOf(u), 1); logMineTo(d, 'Removed ' + u.email + ' from the team'); return;
    }
  }
}

/* ---------- The two data modes ---------- */

/** The domain data a mode starts from: the sample data, or the empty state (the server's workspace is loaded into it). */
const dataFor = (sample: boolean): SeedData => import.meta.env.MODE === 'test' && sample ? createSeed() : createEmpty();

/**
 * Rebuilds the store for one data mode. The session, the theme, open overlays and the connection to the server are
 * kept; lists return to their first page and every selection is cleared. Outside demo mode the workspace is marked as
 * not loaded, so sync.ts loads it from the server again, and what the server already sent about research and articles
 * is applied to the new data. Demo mode shows none of the server's data.
 */
export function resetTo(d: AppStore, sample: boolean): void {
  const live = d.live;
  Object.assign(d, dataFor(sample), contentSlice.initial, sitesSlice.initial, researchSlice.initial, systemSlice.initial);
  d.sample = sample; d.agentSheet = null; d.confirm = null; d.notifRead = [];
  d.sync = { loaded: false, error: '' };
  d.siteFilter = homeSite(d); d.pg = {}; d.autoPub = 0; d.keyWarned = false; d.handoff = { seq: 0, pairs: [] };
  d.live = { ...live, ready: false, logged: [] };
  if (live.on && !sample) { liveApply(d); serverFactsTo(d); d.live.ready = true; }
}

/* ---------- Store ---------- */

/* Remove the retired demo preference, including the mode used by older open tabs. */
writeKey(KEY_DEMO, null);
const sample0 = false;

export const useStore = create<AppStore>()(immer((set, get) => {
  const sset: SliceSet = recipe => set(recipe);
  const sget: SliceGet = get;

  const state: AppState = {
    ...dataFor(sample0),
    notifRead: [],
    sample: sample0,
    session: null,
    auth: 'loading',
    loginNote: '',
    sync: { loaded: false, error: '' },
    siteFilter: 'all',
    pg: {},
    autoPub: 0,
    keyWarned: false,
    theme: storedTheme(),
    snackMsg: null,
    confirm: null,
    pop: null,
    searchOpen: false,
    navOpen: false,
    handoff: { seq: 0, pairs: [] },
  };

  const core: CoreActions = {
    mutate: recipe => set(recipe),

    guard: (kind = 'write') => {
      const s = get().session; if (!s) return false;
      if (s.role === 'viewer') { set(d => snackTo(d, 'View-only role. Ask an admin to make changes.')); return false; }
      if (s.role === 'reviewer' && kind !== 'review') { set(d => snackTo(d, 'Your role reviews articles only.', 'lock')); return false; }
      return true;
    },

    addLog: (who, act, site) => set(d => addLogTo(d, who, act, site)),
    logMine: (act, site) => set(d => logMineTo(d, act, site)),
    notify: (k, icon, title, body, view, ev) => set(d => notifyTo(d, k, icon, title, body, view, ev)),
    markNotificationsRead: () => set(d => {
      const seen = d.notifs.filter(n => canSee(d.session, n.view));
      seen.forEach(n => { n.read = true; });
      markReadTo(d, seen.flatMap(n => n.key ? [n.key] : []));
    }),
    readNotification: id => set(d => { const n = d.notifs.find(x => x.id === id); if (!n) return; n.read = true; if (n.key) markReadTo(d, [n.key]); }),
    openNotification: id => {
      const n = get().notifs.find(x => x.id === id); if (!n) return null;
      get().readNotification(id);
      set(d => { d.pop = null; });
      const a = n.art != null ? get().articles.find(x => x.id === n.art) : undefined;
      if (a) get().selectArticle(a.id, artOpen(a) ? 'open' : 'done');
      /* Server events on the Research view are keyword research results: open its Keywords tab. */
      if (n.to) get().applyAlias(n.to);
      else if (n.key && n.view === 'research') get().setRctab('keywords');
      /* Everything the bell says about Build and deploy is a build, a deploy or a domain; about Analytics, a budget. */
      else if (n.view === 'deploy') get().applyAlias('website');
      else if (n.view === 'analytics') get().setAtab('overview');
      return n.view;
    },
    snack: (msg, icon) => set(d => snackTo(d, msg, icon)),
    hideSnack: () => set(d => { d.snackMsg = null; }),

    signIn: me => {
      touchActivity();
      set(d => {
        /* Another account had loaded the workspace on this page (an invitation accepted here): start clean for the new one. */
        if (d.session && d.session.id !== me.id && d.sync.loaded) { d.live = emptyLive(); resetTo(d, d.sample); }
        signInTo(d, sessionOf(me)); d.rdetail = false;
      });
    },
    setMe: me => set(d => {
      if (!d.session || d.session.id !== me.id) return;
      const before = d.session.role, site = d.session.site;
      d.session = sessionOf(me);
      if (before !== me.role || site !== me.site) d.siteFilter = homeSite(d);
    }),
    signOut: (msg, server = true) => {
      if (server && get().session) void authApi.signOut().catch(() => undefined);
      set(d => {
        signOutTo(d, msg);
        /* Nothing of the workspace stays in memory for whoever signs in next on this browser. */
        d.live = emptyLive();
        resetTo(d, d.sample);
      });
    },
    changeName: async name => {
      const err = nameError(name), s = get().session;
      if (err || !s) return err || 'Sign in first.';
      const next = cleanName(name);
      if (next === s.name) return null;
      try {
        const me = await authApi.rename(next);
        set(d => { if (d.session) d.session.name = me.name; snackTo(d, 'Your name is now ' + me.name + '.'); });
        return null;
      } catch (e) { return e instanceof ApiError || e instanceof Error ? e.message : String(e); }
    },

    setTheme: t => set(d => { d.theme = t; }),
    toggleTheme: () => set(d => { d.theme = isDark(d.theme) ? 'light' : 'dark'; }),

    setSiteFilter: id => set(d => { d.siteFilter = id; d.pg = {}; }),
    setPage: (key, page) => set(d => { d.pg[key] = Math.max(0, page); }),
    resetPages: () => set(d => { d.pg = {}; }),

    openConfirm: key => {
      if (!get().guard()) return;
      const c = describeConfirm(get(), key);
      if (c) set(d => { d.confirm = c; });
    },
    closeConfirm: () => set(d => { d.confirm = null; }),
    confirmOk: () => {
      const c = get().confirm; if (!c) return;
      set(d => { d.confirm = null; });
      if (!get().guard()) return;
      /* rv-no: the content slice rejects, on the server for a real article. */
      if (c.kind === 'art') { const x = get().articles.find(r => String(r.id) === c.id); if (x) get().rejectArticle(x.id); return; }
      /* Outside demo mode people and invitations are changed on the server. */
      if (c.kind === 'user' && !get().sample) { void get().removeUser(c.id); return; }
      if (c.kind === 'inv') { void get().revokeInvite(c.id); return; }
      if (c.kind === 'key' && !get().sample) { void get().removeService(c.id); return; }
      set(d => runConfirm(d, c));
    },
    revokeKey: id => {
      if (!get().guard()) return;
      if (!get().sample) { void get().removeService(id); return; }
      set(d => revokeKeyIn(d, id));
    },

    decideApproval: (id, ok) => {
      if (!get().guard()) return;
      set(d => {
        const p = d.approvals.find(x => x.id === id); if (!p) return;
        d.approvals = d.approvals.filter(x => x.id !== id);
        logMineTo(d, `${ok ? 'Approved' : 'Rejected'} ${p.kind.toLowerCase()}: ${p.what}`, p.site);
        const site = siteById(d, p.site);
        if (ok && p.kind === 'Deploy' && site) {
          const when = 'Today ' + hhmm(new Date());
          site.deploy = when;
          const mv = Math.max(0, ...d.deploys.filter(x => x.site === site.id).map(x => x.ver));
          d.deploys.forEach(x => { if (x.site === site.id) x.live = false; });
          d.deploys.unshift({ id: 'd' + nextUid(d), site: site.id, ver: mv + 1, what: p.what, by: actor(d), when, live: true });
        }
        const ag = d.agents.find(x => x.pending === p.id);
        if (ag) { ag.pending = null; ag.status = 'idle'; ag.progress = 0; ag.task = 'Waiting for a task'; }
      });
    },

    setPop: p => set(d => { d.pop = p; }),
    setSearchOpen: open => set(d => { d.searchOpen = open; if (open) d.navOpen = false; }),
    setNavOpen: open => set(d => { d.navOpen = open; }),

    applyAlias: alias => {
      const al = ALIAS[alias];
      set(d => {
        switch (al.key) {
          case 'rctab': d.rctab = al.tab; break;
          case 'rtab': d.rtab = al.tab; break;
          case 'atab': d.atab = al.tab; break;
          case 'smode': d.smode = al.tab; break;
          case 'dtab': d.dtab = al.tab; break;
          case 'actab': d.actab = al.tab; break;
        }
      });
      return al.view;
    },

    tick: (demoClock = true) => {
      let ended = false;
      set(d => {
        const res = simTick(d, { now: Date.now(), lastActive, rand: Math.random, demoClock });
        ended = res.signedOut;
        if (res.finished.length) d.handoff = { seq: d.handoff.seq + 1, pairs: res.finished.map(id => ({ from: id, to: nextAgent(d, id)?.id ?? null })) };
      });
      /* The idle sign-out also ends the session on the server, and the workspace leaves memory. */
      if (ended) {
        void authApi.signOut().catch(() => undefined);
        set(d => { d.live = emptyLive(); resetTo(d, d.sample); });
      }
    },

    setSampleData: on => {
      writeKey(KEY_DEMO, null);
      if (on || !get().sample) return;
      set(d => { resetTo(d, false); });
    },
  };

  return {
    ...state,
    ...core,
    ...workspaceSlice.initial, ...workspaceSlice.actions(sset, sget),
    ...contentSlice.initial, ...contentSlice.actions(sset, sget),
    ...sitesSlice.initial, ...sitesSlice.actions(sset, sget),
    ...researchSlice.initial, ...researchSlice.actions(sset, sget),
    ...systemSlice.initial, ...systemSlice.actions(sset, sget),
  };
}));

/** Select several values at once without re-rendering when none of them changed: useStoreShallow(s => [s.a, s.b]). */
export function useStoreShallow<T>(selector: (s: AppStore) => T): T { return useStore(useShallow(selector)); }

/** Name of the provider an agent's model belongs to, for messages. */
export const providerName = (model: string): string => PROV[provOf(model)].name;

/* ---------- Side effects: theme, activity (saving the workspace is sync.ts) ---------- */

/** The browser bar colour of each theme (index.html has one theme-color tag per colour scheme). */
const BAR = { light: '#fbf8ff', dark: '#11131c' } as const;

function applyTheme(t: Theme | null): void {
  if (typeof document === 'undefined') return;
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  /* A theme picked in the app overrides the system's: both tags then carry its colour. */
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(m => {
    const own = m.media.includes('dark') ? BAR.dark : BAR.light;
    m.content = t === 'dark' || t === 'light' ? BAR[t] : own;
  });
}

applyTheme(useStore.getState().theme);
useStore.subscribe((s, prev) => {
  if (s.theme !== prev.theme) { applyTheme(s.theme); writeKey(KEY_THEME, s.theme); }
});
if (typeof document !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown'] as const) document.addEventListener(ev, touchActivity, true);
  /* Older tabs cannot turn demo mode back on. */
  window.addEventListener('storage', e => {
    if (e.key !== KEY_DEMO) return;
    if (e.newValue != null) writeKey(KEY_DEMO, null);
    if (useStore.getState().sample) useStore.getState().setSampleData(false);
  });
}

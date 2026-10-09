/* System slice: Analytics, Models and skills, Team and roles, Integrations, Audit log, Settings.
   Ports the prototype's handlers for these screens (web/index.html, lines 2087-2088, 2093, 2134, 2136, 2151-2154,
   2171-2173, 2186, 2188-2190). Outside demo mode the team, the person's sessions, Reset workspace and the connected
   services (stored encrypted and tested on the server, servicesApi.ts) are on the server, which records those
   actions in the audit log itself. */
import { authApi, teamApi, type ServerInvite, type ServerUser } from '../authApi';
import type { ActivityTab, AnalyticsTab } from '../constants';
import { CH, EVENTS, MODELS, PROV, PROVIDER_IDS, ROLE_LABEL } from '../constants';
import { logMineTo, newId, snackTo } from '../draft';
import { dayTime, provOK, provOf, provPlan, siteById } from '../rules';
import { ApiError, apiSend } from '../serverApi';
import { serverFactsTo } from '../serverFacts';
import { servicesApi } from '../servicesApi';
import type { DeviceSession, NotifyEvent, ProviderId, Role, Settings, Skill, SkillVersion, User, UserRole } from '../types';
import type { Slice } from './slice';

/** The Invite form: email, role and, for a native reviewer, the site (a site id; '' for all sites). */
export interface InviteInput { email: string; role: UserRole; site: string }
/** An invitation was made: the one-time link to share (null in demo mode, where nothing is sent), or why not. */
export type InviteResult = { ok: true; link: string | null } | { ok: false; msg: string };

export interface SystemState {
  /** Tab of Analytics. */
  atab: AnalyticsTab;
  /** Tab of Activity: the run history or the audit log. */
  actab: ActivityTab;
  /** Provider last picked in the Switch provider sheet (the prototype's state.provTo). */
  provTo: ProviderId | null;
  /** The team was loaded from the server (Team and roles is open, or was): team events reload it. */
  teamLoaded: boolean;
}
export interface SystemActions {
  /** The prototype's "tab" action: switches the tab and returns every list to its first page. */
  setAtab: (t: AnalyticsTab) => void;
  /** The same for Activity. */
  setActab: (t: ActivityTab) => void;

  /* Models and skills */
  /** Form "skill". Returns the validation message, or null when the skill was added (or the role may not add it). */
  addSkill: (name: string, desc: string) => string | null;
  /** Change of an Assign agents switch: attaches or detaches a skill. */
  setSkillAgent: (skillId: string, agentId: string, on: boolean) => void;
  /** Versions sheet: builds the skill's version list the first time it is opened (the prototype's openSkillHist). */
  initSkillHist: (id: string) => void;
  /** sk-restore. Returns true when the version was restored. */
  restoreSkill: (id: string, v: string) => boolean;
  /** Change of a model selector in "Model by agent". */
  setAgentModel: (agentId: string, model: string) => void;
  /** prov-open: picks the provider the Switch provider sheet starts on. Returns true when the sheet may open. */
  openProvider: () => boolean;
  /** prov-pick: a provider tab in the Switch provider sheet. */
  pickProvider: (pid: ProviderId) => void;
  /** prov-apply. Returns true when the switch was applied. */
  applyProvider: (pid: ProviderId) => boolean;

  /* Team and roles */
  /** Loads the people and open invitations from the server (admins; not in demo mode). */
  loadTeam: () => Promise<void>;
  /** Form "user": makes an invitation. In demo mode the person is added to the sample team. */
  inviteUser: (input: InviteInput) => Promise<InviteResult>;
  /** Changes a person's role (and a reviewer's site) or disables / enables them. Resolves to the message, or null. */
  updateUser: (id: string, change: { role?: UserRole; site?: string; disabled?: boolean }) => Promise<string | null>;
  /** Removes a person (after the confirm dialog, key "user:<id>"). */
  removeUser: (id: string) => Promise<void>;
  /** Revokes an open invitation (after the confirm dialog, key "inv:<id>"). */
  revokeInvite: (id: string) => Promise<void>;
  /** An admin resets another person's 2-step verification. */
  resetTwofa: (id: string) => Promise<void>;

  /* Integrations */
  /** Inline key form of a provider or service without a key. */
  saveKey: (id: string, value: string) => void;
  /** Form "keyrep". Returns the validation message, or null when the key was replaced (or the role may not replace it). */
  replaceKey: (id: string, value: string) => string | null;
  /** key-test */
  testKey: (id: string) => void;
  /** oauth: "Connect with Google" (simulated in demo mode; outside it, the page goes to Google's consent screen). */
  connectOAuth: (id: string) => void;
  /** Stores a service's values on the server, which tests them at once. Resolves to the error to show, or null. */
  saveService: (id: string, values: Record<string, string>) => Promise<string | null>;
  /** Test connection, on the server. Shows the result. */
  testService: (id: string) => Promise<void>;
  /** Removes what is stored for a service (after the confirm dialog for a provider agents use). */
  removeService: (id: string) => Promise<void>;

  /* Settings */
  /** Change of a data-set control in Settings. Numbers must already be at least 1. */
  setSystemSetting: <K extends SystemSettingKey>(key: K, value: Settings[K]) => void;
  /** Change of a checkbox in the alert table: event by channel index (CH order). */
  setAlert: (ev: NotifyEvent, ch: number, on: boolean) => void;
  /** Loads the signed-in person's own sessions from the server (not in demo mode). */
  loadSessions: () => Promise<void>;
  /** sess-del: signs out one session. */
  endSession: (id: string) => void;
  /** "Sign out other sessions". */
  endOtherSessions: () => Promise<void>;
  /** Admin-only "Reset workspace", confirmed by typing RESET. Resolves to the message to show, or null when done. */
  resetWorkspace: (typed: string) => Promise<string | null>;
}

/** Shown when "Connect with Google" cannot start yet. */
export const NO_GOOGLE = 'Set up Google sign-in first: paste the OAuth client ID and secret from Google Cloud.';

const ROLE_OF: Readonly<Record<UserRole, Role>> = { Admin: 'admin', Editor: 'editor', 'Native reviewer': 'reviewer', Viewer: 'viewer' };
const message = (e: unknown): string => e instanceof ApiError || e instanceof Error ? e.message : String(e);

/** A person or open invitation from the server, as a Team row. The site is shown by its domain in the view. */
export const teamUser = (u: ServerUser): User => ({
  id: u.id, name: u.name, email: u.email, role: ROLE_LABEL[u.role], scope: u.site ? '' : 'All sites', site: u.site,
  st: u.disabled ? 'Disabled' : 'Active', twofa: u.twofa,
});
export const teamInvite = (i: ServerInvite): User => ({
  id: i.id, name: i.email.split('@')[0] ?? i.email, email: i.email, role: ROLE_LABEL[i.role], scope: i.site ? '' : 'All sites', site: i.site,
  st: 'Invited', invite: true, expires: i.expires,
});
/** A session from the server, as a row of the Settings table. */
export const deviceRow = (x: { id: string; device: string; lastSeen: number; current: boolean }): DeviceSession =>
  ({ id: x.id, dev: x.device, where: dayTime(x.lastSeen), last: x.lastSeen, ...(x.current ? { cur: true } : {}) });

/** The settings the Settings screen changes (repTo, repFreq and repOn belong to Reports). */
export type SystemSettingKey = Exclude<keyof Settings, 'repTo' | 'repFreq' | 'repOn'>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * The version list a skill gets when its Versions sheet first opens. In demo mode it is invented from the
 * version number, as in the prototype; otherwise only the version in use is known.
 */
export function skillHistory(k: Pick<Skill, 'ver' | 'fresh'>, sample: boolean): SkillVersion[] {
  if (!sample) return [{ v: k.ver, when: k.fresh ? 'Added by you' : 'Built in', note: 'Current version' }];
  if (k.fresh) return [{ v: k.ver, when: 'Just now', note: 'First version' }];
  const [M = 0, m = 0] = k.ver.split('.').map(Number);
  const h: SkillVersion[] = [{ v: k.ver, when: '3 days ago', note: 'Current wording' }];
  if (m > 0) h.push({ v: M + '.' + (m - 1), when: '2 weeks ago', note: 'Before the last edit' });
  if (M > 1 || m > 1) h.push({ v: (m > 1 ? M : M - 1) + '.' + (m > 1 ? m - 2 : 0), when: 'Last month', note: 'Earlier version' });
  return h;
}

export const systemSlice: Slice<SystemState, SystemActions> = {
  initial: { atab: 'overview', actab: 'runs', provTo: null, teamLoaded: false },
  actions: (set, get) => ({
    setAtab: t => set(d => { d.atab = t; d.pg = {}; }),
    setActab: t => set(d => { d.actab = t; d.pg = {}; }),

    addSkill: (name, desc) => {
      if (!get().guard()) return null;
      const n = name.trim(), ds = desc.trim(); if (!n || !ds) return null;
      if (get().skills.some(x => x.name.toLowerCase() === n.toLowerCase())) return 'A skill with this name already exists.';
      set(d => { d.skills.push({ id: newId(d, 'k'), name: n, desc: ds, ver: '0.1', fresh: true }); logMineTo(d, 'Added the skill ' + n); });
      return null;
    },
    setSkillAgent: (skillId, agentId, on) => {
      if (!get().guard()) return;
      set(d => {
        const a = d.agents.find(x => x.id === agentId), k = d.skills.find(x => x.id === skillId); if (!a || !k) return;
        if (on) { if (!a.skills.includes(k.id)) a.skills.push(k.id); } else a.skills = a.skills.filter(x => x !== k.id);
        logMineTo(d, `${on ? 'Attached' : 'Detached'} "${k.name}" ${on ? 'to' : 'from'} ${a.name}`);
      });
    },
    initSkillHist: id => {
      const k = get().skills.find(x => x.id === id); if (!k || k.hist) return;
      set(d => { const x = d.skills.find(s => s.id === id); if (x && !x.hist) x.hist = skillHistory(x, d.sample); });
    },
    restoreSkill: (id, v) => {
      if (!get().guard() || !get().skills.some(x => x.id === id)) return false;
      set(d => { const k = d.skills.find(x => x.id === id); if (!k) return; k.ver = v; logMineTo(d, `Restored "${k.name}" to v${k.ver}`); });
      return true;
    },
    setAgentModel: (agentId, model) => {
      if (!get().guard()) return;
      if (!MODELS.some(m=>m===model)) { get().snack('Select a supported OpenAI model.', 'info'); return; }
      set(d => { const a = d.agents.find(x => x.id === agentId); if (!a) return; a.model = model; logMineTo(d, `${a.name} now runs on ${model}`); });
    },
    openProvider: () => {
      if (!get().guard()) return false;
      const s = get(), first = s.agents[0], cur = first ? provOf(first.model) : null;
      const pid = s.provTo || PROVIDER_IDS.filter(k => provOK(s, k)).find(k => k !== cur) || 'openai';
      set(d => { d.provTo = pid; });
      return true;
    },
    pickProvider: pid => { if (get().guard()) set(d => { d.provTo = pid; }); },
    applyProvider: pid => {
      if (!get().guard() || !provOK(get(), pid)) return false;
      set(d => {
        let n = 0;
        provPlan(d, pid).forEach(p => {
          if (p.to === p.a.model) return;
          p.a.prev = { ...(p.a.prev || {}), [provOf(p.a.model)]: p.a.model };
          p.a.model = p.to; n++;
        });
        const name = PROV[pid].name;
        logMineTo(d, `Switched ${plural(n, 'agent')} to ${name}`);
        snackTo(d, `${plural(n, 'agent')} now run on ${name}. Changes apply to each agent's next job.`, 'swap_horiz');
      });
      return true;
    },

    loadTeam: async () => {
      const s = get();
      if (s.sample || s.session?.role !== 'admin') return;
      try {
        const r = await teamApi.list();
        set(d => { if (d.sample) return; d.users = [...r.users.map(teamUser), ...r.invites.map(teamInvite)]; d.teamLoaded = true; });
      } catch (e) { get().snack(message(e), 'error'); }
    },
    inviteUser: async ({ email, role, site }) => {
      if (!get().guard()) return { ok: false, msg: '' };
      const em = email.trim().toLowerCase();
      if (!EMAIL.test(em)) return { ok: false, msg: 'Enter a valid email address.' };
      if (get().users.some(u => u.email === em)) return { ok: false, msg: 'This person is already on the team.' };
      if (role === 'Native reviewer' && !site) return { ok: false, msg: 'Choose one site for a native reviewer. They review a single site in their own language.' };
      if (get().sample) {
        const scope = role === 'Native reviewer' ? siteById(get(), site)?.domain ?? site : 'All sites';
        set(d => { d.users.push({ id: newId(d, 'u'), name: em.split('@')[0] ?? em, email: em, role, scope, st: 'Invited' }); logMineTo(d, 'Invited ' + em + ' as ' + role); });
        return { ok: true, link: null };
      }
      try {
        const r = await teamApi.invite({ email: em, role: ROLE_OF[role], ...(role === 'Native reviewer' ? { site } : {}) });
        set(d => { d.users.push(teamInvite(r.invite)); snackTo(d, 'Invitation created for ' + em + '. Share the link yourself.', 'link'); });
        return { ok: true, link: r.link };
      } catch (e) { return { ok: false, msg: message(e) }; }
    },
    updateUser: async (id, change) => {
      if (!get().guard()) return '';
      try {
        const r = await teamApi.update(id, { ...(change.role ? { role: ROLE_OF[change.role] } : {}), ...(change.site !== undefined ? { site: change.site } : {}), ...(change.disabled !== undefined ? { disabled: change.disabled } : {}) });
        set(d => { const i = d.users.findIndex(u => u.id === id && !u.invite); if (i >= 0) d.users[i] = teamUser(r.user); snackTo(d, 'Saved the changes for ' + r.user.email); });
        return null;
      } catch (e) { return message(e); }
    },
    removeUser: async id => {
      const u = get().users.find(x => x.id === id && !x.invite);
      try {
        await teamApi.remove(id);
        set(d => { d.users = d.users.filter(x => x.invite || x.id !== id); snackTo(d, 'Removed ' + (u?.email ?? 'the person') + ' from the team'); });
      } catch (e) { get().snack(message(e), 'error'); }
    },
    revokeInvite: async id => {
      if (get().sample) return;
      const u = get().users.find(x => x.id === id && x.invite);
      try {
        await teamApi.revoke(id);
        set(d => { d.users = d.users.filter(x => !(x.invite && x.id === id)); snackTo(d, 'Revoked the invitation for ' + (u?.email ?? 'that person')); });
      } catch (e) { get().snack(message(e), 'error'); }
    },
    resetTwofa: async id => {
      if (!get().guard()) return;
      try {
        const r = await teamApi.resetTwofa(id);
        set(d => { const i = d.users.findIndex(u => u.id === id && !u.invite); if (i >= 0) d.users[i] = teamUser(r.user); snackTo(d, 'Reset 2-step verification for ' + r.user.email); });
      } catch (e) { get().snack(message(e), 'error'); }
    },

    saveKey: (id, value) => {
      if (!get().guard()) return;
      if (!get().sample) { void get().saveService(id, { key: value }); return; }
      const v = value.trim(); if (v.length < 8) return;
      set(d => { const n = d.ints.find(x => x.id === id); if (!n) return; n.tail = v.slice(-4); n.st = 'ok'; n.msg = 'Saved'; logMineTo(d, 'Saved the ' + n.name.replace(/ API$/, '') + ' API key'); });
    },
    replaceKey: (id, value) => {
      if (!get().guard()) return null;
      if (!get().sample) { void get().saveService(id, { key: value }); return null; }
      const n = get().ints.find(x => x.id === id), v = value.trim(); if (!n) return null;
      if (v.length < 8) return 'The key looks too short. Paste the whole key.';
      if (v.slice(-4) === n.tail) return 'This is the same key that is already saved.';
      set(d => {
        const x = d.ints.find(i => i.id === id); if (!x) return;
        x.tail = v.slice(-4); if (x.st !== 'warn') { x.st = 'ok'; x.msg = 'Replaced'; }
        logMineTo(d, 'Replaced the ' + x.name.replace(/ API$/, '') + ' API key');
      });
      return null;
    },
    testKey: id => {
      if (!get().guard()) return;
      if (!get().sample) { void get().testService(id); return; }
      set(d => {
        const n = d.ints.find(x => x.id === id); if (!n) return;
        if (n.st === 'warn') logMineTo(d, 'Tested the ' + n.name + ' connection: it works, but ' + (n.msg || '').toLowerCase());
        else { n.st = 'ok'; n.msg = 'Connected (demo)'; logMineTo(d, 'Tested the ' + n.name + ' connection'); }
      });
    },
    connectOAuth: id => {
      if (!get().guard()) return;
      if (!get().sample) {
        if (id !== 'gsc' && id !== 'ga4' && id !== 'ads') return;
        servicesApi.googleStart(id).then(r => { window.location.assign(r.url); }, (e: unknown) => get().snack(message(e), 'error'));
        return;
      }
      set(d => { const n = d.ints.find(x => x.id === id); if (!n) return; n.tail = 'Sample account connected'; n.st = 'ok'; n.msg = 'Connected (demo)'; logMineTo(d, 'Connected ' + n.name); });
    },

    saveService: async (id, values) => {
      if (!get().guard()) return '';
      try {
        const r = await servicesApi.save(id, values);
        set(d => { d.live.ints[id] = r.integration; serverFactsTo(d); snackTo(d, r.integration.name + ': ' + r.result.msg, r.result.status === 'ok' ? 'check_circle' : 'error'); });
        return null;
      } catch (e) { return message(e); }
    },
    testService: async id => {
      if (!get().guard()) return;
      try {
        const r = await servicesApi.test(id);
        set(d => { d.live.ints[id] = r.integration; serverFactsTo(d); snackTo(d, r.integration.name + ': ' + r.result.msg, r.result.status === 'ok' ? 'check_circle' : 'error'); });
      } catch (e) { get().snack(message(e), 'error'); }
    },
    removeService: async id => {
      if (!get().guard()) return;
      try {
        const r = await servicesApi.remove(id);
        set(d => { d.live.ints[id] = r.integration; serverFactsTo(d); snackTo(d, 'Removed ' + r.integration.name, 'link_off'); });
      } catch (e) { get().snack(message(e), 'error'); }
    },

    setSystemSetting: (key, value) => {
      if (!get().guard()) return;
      set(d => { d.settings[key] = value; logMineTo(d, 'Updated settings'); });
    },
    setAlert: (ev, ch, on) => {
      if (!get().guard()) return;
      const label = EVENTS.find(x => x[0] === ev)?.[1] ?? ev;
      set(d => { d.np[ev][ch] = on; logMineTo(d, `${on ? 'Turned on' : 'Turned off'} ${CH[ch]} alerts for "${label.toLowerCase()}"`); });
    },
    loadSessions: async () => {
      if (get().sample || !get().session) return;
      try { const list = await authApi.sessions(); set(d => { if (!d.sample) d.sessions = list.map(deviceRow); }); }
      catch (e) { get().snack(message(e), 'error'); }
    },
    endSession: id => {
      /* Everyone may end their own sessions; in demo mode the sample sessions follow the prototype's role check. */
      if (get().sample) {
        if (!get().guard()) return;
        set(d => { const i = d.sessions.findIndex(x => x.id === id); if (i < 0) return; const x = d.sessions[i]!; d.sessions.splice(i, 1); logMineTo(d, 'Signed out the session on ' + x.dev); });
        return;
      }
      const x = get().sessions.find(r => r.id === id);
      authApi.endSession(id).then(
        () => { if (x?.cur) { get().signOut('You signed out this browser.', false); return; } set(d => { d.sessions = d.sessions.filter(r => r.id !== id); snackTo(d, 'Signed out the session on ' + (x?.dev ?? 'that device')); }); },
        (e: unknown) => get().snack(message(e), 'error'),
      );
    },
    endOtherSessions: async () => {
      if (get().sample) { set(d => { d.sessions = d.sessions.filter(x => x.cur); snackTo(d, 'Signed out every other session'); }); return; }
      try {
        const r = await authApi.endOthers();
        set(d => { d.sessions = d.sessions.filter(x => x.cur); snackTo(d, r.ended ? `Signed out ${r.ended} other session${r.ended === 1 ? '' : 's'}` : 'No other sessions were signed in'); });
      } catch (e) { get().snack(message(e), 'error'); }
    },
    resetWorkspace: async typed => {
      const s = get();
      if (s.session?.role !== 'admin') return 'Only an admin can do this.';
      if (s.sample) return 'Turn off demo mode first. Demo mode has nothing saved to reset.';
      if (typed !== 'RESET') return 'Type RESET to confirm.';
      try { await apiSend<{ ok: true }>('/api/workspace/reset', { confirm: 'RESET' }); get().snack('The workspace was reset.', 'restart_alt'); return null; }
      catch (e) { return message(e); }
    },
  }),
};

/* Pure rules and helpers, ported from "Rules shared by every flow" and the pricing helpers of web/index.html.
   Nothing here reads the store, the DOM or the clock on its own: state, time and randomness come in as arguments,
   so every function can be unit tested and reused by the store, the simulation and the screens. */
import {
  ACTABS, ADMIN_ONLY, ALIAS, NEXT_AG, PER_SITE_MODS, PROV, PROVIDER_IDS, RATE, REV_SITE, RUNNER_AGENTS, TOOL, isAliasId, isViewId,
  type ActivityTab, type AliasTarget,
} from './constants';
import type {
  Agent, AgentStatus, AliasId, AppState, Article, AuthSession, BuildWire, ModCell, ModId, ModPill, PillKind, ProviderId, Site, Skill, ViewId,
} from './types';

export * from './constants';

/* ---------- Formatting ---------- */

/** 18420 -> "18,420" */
export const fmt = (n: number | string): string => Number(n).toLocaleString('en-US');
/** 1240000 -> "1.24M", 412000 -> "412K" */
export const short = (n: number): string => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
/** Local time as "09:12". */
export const hhmm = (d: Date): string => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
/** Local day and time as "2 Oct, 09:12", for things that may be days old. */
export const dayTime = (d: Date | number): string => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/**
 * The one way a moment is shown in tables, feeds and logs: the time alone for today ("12:31"), the day and time for
 * anything else ("3 Oct, 12:31"). `now` is for tests.
 */
export const stamp = (d: Date | number, now: number = Date.now()): string => {
  const t = new Date(d);
  return t.toDateString() === new Date(now).toDateString() ? hhmm(t) : dayTime(t);
};
/** Seconds as "45s" or "3m 05s". */
export const fmtDur = (x: number): string => x < 60 ? x + 's' : Math.floor(x / 60) + 'm ' + String(x % 60).padStart(2, '0') + 's';
/** "SEO/GEO Optimizer" -> "SG", "Deploy & Monitor" -> "DM" */
export const initials = (n: string): string => n.split(/[\s/&]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
/** 2 -> "$2", 0.75 -> "$0.75" */
export const usd = (v: number): string => '$' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
/** "Just now", "12 min ago", "3 h ago" */
export const ago = (t: Date | number, now: number = Date.now()): string => {
  const m = Math.max(0, Math.round((now - Number(t)) / 6e4));
  return m < 1 ? 'Just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
};

/* ---------- Randomness ---------- */

export type Rand = () => number;
export const rand = (a: number, b: number, rng: Rand = Math.random): number => a + rng() * (b - a);
export const pick = <T>(a: readonly T[], rng: Rand = Math.random): T => a[Math.floor(rng() * a.length)]!;
/** mulberry32: the seeded generator behind the silo tree, the rank heat map and the link graph. */
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
/** FNV-1a over UTF-16 code units of each code point's first unit, as in the prototype. */
export function hashStr(t: string): number { let h = 2166136261; for (const c of String(t)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/* ---------- Providers and pricing ---------- */

export function provOf(m: string): ProviderId { return PROVIDER_IDS.find(k => PROV[k].models.includes(m)) || 'openai'; }
/** Price in force at `now`: [input, output] USD per 1M tokens. GPT-6.1 Sol has an announced price change. */
export const priceOf = (m: string, now: number = Date.now()): readonly [number, number] | null => {
  const r = RATE[m]; if (!r) return null; const c = r[3];
  return c && now >= Date.parse(c.from + 'T00:00:00Z') ? c.p : [r[0], r[1]];
};
/** " · $2 / $10" plus the announced change, for the model tags in Integrations. */
export const priceNote = (m: string, now: number = Date.now()): string => {
  const r = RATE[m]; if (!r) return ''; const p = priceOf(m, now)!, c = r[3];
  return ` · ${usd(p[0])} / ${usd(p[1])}` + (c && p === c.p ? '' : c ? `, ${usd(c.p[0])} / ${usd(c.p[1])} from ${new Date(c.from + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : '');
};
/** Blended rate: three input tokens per output token, no caching, no batch discount. Unpriced sample tiers use $9. */
export const rateOf = (m: string, now: number = Date.now()): number => { const p = priceOf(m, now); return p ? (3 * p[0] + p[1]) / 4 : 9; };
/** Cost in USD of `tk` tokens on model `m`. */
export const costOf = (tk: number, m: string, now: number = Date.now()): number => tk / 1e6 * rateOf(m, now);
/** Tier of a model inside its provider: 0 high-volume, 1 balanced, 2 most demanding. */
export const tierOf = (m: string): 0 | 1 | 2 => {
  const p = PROV[provOf(m)]; const i = p.tiers.indexOf(m);
  return i >= 0 ? (i as 0 | 1 | 2) : p.models.indexOf(m) === p.models.length - 1 ? 2 : 1;
};

type S<K extends keyof AppState> = Pick<AppState, K>;

/**
 * The server's research requests and articles are in use: the server answered and demo mode is off. Demo mode never
 * reads or writes server data, so everything in it is simulated in the browser.
 */
export const liveOn = (s: S<'live' | 'sample'>): boolean => s.live.on && !s.sample;
/** The server confirmed a usable OpenAI API connection. */
export const openaiReady = (s: S<'live'>): boolean => s.live.on && s.live.engine?.mode === 'openai-api';
/** A usable runtime, including the explicitly enabled local Codex CLI. */
export const engineReady = (s: S<'live'>): boolean => s.live.on && !!s.live.engine?.ready && s.live.engine.mode !== 'none';
export const codexLocal = (s: S<'live'>): boolean => s.live.on && s.live.engine?.mode === 'codex-local';
/** Both locally selected engines keep API model defaults intact. Codex still calls the Codex service. */
export const localRuntime = (s: S<'live'>): boolean => s.live.on && ['codex-local','gemma-local'].includes(s.live.engine?.mode || '');
export const showBudget = (s: S<'live' | 'sample'>): boolean => s.sample || !localRuntime(s) || !!s.live.ints.dfs?.updatedAt;
export const showCosts = (s: S<'live' | 'sample'>): boolean => s.sample || !localRuntime(s);
export const engineName = (mode: string | null | undefined): string => mode === 'gemma-local' ? 'Gemma localhost' : mode === 'codex-local' ? 'Codex local' : mode === 'openai-api' || mode === 'none' ? 'OpenAI' : 'AI runtime';
export const runtimeUsage = (s: S<'live'>): string => s.live.engine?.mode === 'gemma-local' ? 'Runs on this computer.' : codexLocal(s) ? 'Uses ChatGPT usage limits.' : 'Uses your OpenAI API quota.';
export const runtimeModel = (s: S<'live'>, apiModel: string): string => localRuntime(s) ? s.live.engine?.model || 'Local runtime model' : apiModel;
/** Agents can run on the provider: it has a key saved, or the server confirmed its environment key. */
export const provOK = (s: S<'ints' | 'live'>, id: string): boolean => (id === 'openai' && s.live.on && s.live.engine ? engineReady(s) : !!s.ints.find(x => x.id === id && x.st !== 'bad')?.tail);
/** Agents can run on the agent's provider. */
export const keyOK = (s: S<'ints' | 'live'>, a: Pick<Agent, 'model'>): boolean => provOK(s, provOf(a.model));
/** Models of every connected provider. */
export const availModels = (s: S<'ints' | 'live'>): string[] => PROVIDER_IDS.filter(k => provOK(s, k)).flatMap(k => [...PROV[k].models]);
/** Names of providers that running agents need but that have no key. */
export const missingProv = (s: S<'ints' | 'live' | 'agents'>): string[] => [...new Set(s.agents.filter(a => a.status !== 'off' && !keyOK(s, a)).map(a => PROV[provOf(a.model)].name))];
/** Skills attached to the agent that were written for a different provider than its model's. */
export const skillClash = (s: S<'skills'>, a: Pick<Agent, 'skills' | 'model'>): Skill[] =>
  a.skills.map(id => s.skills.find(k => k.id === id)).filter((k): k is Skill => !!k && !!k.only && k.only !== provOf(a.model));
/** What "Switch provider" would do: each agent with the model it moves to. */
export function provPlan(s: S<'agents'>, _pid: ProviderId): { a: Agent; to: string }[] { return s.agents.map(a => ({ a, to: a.model })); }

/* ---------- Sites, agents, deploys ---------- */

export const siteById = (s: S<'sites'>, id: string | null | undefined): Site | undefined => s.sites.find(x => x.id === id);
/** Agents may work on the site: it is live or building and has budget left. */
export const siteOpen = (s: S<'settings'>, x: Site | null | undefined): boolean => !!x && (x.status === 'live' || x.status === 'build') && x.spend < s.settings.budget;
export const totalWorkers = (s: S<'agents'>): number => s.agents.filter(a => a.status !== 'off').reduce((n, a) => n + a.workers, 0);
/** Version number of the live deploy of a site, 0 when none. */
export const liveVer = (s: S<'deploys'>, id: string): number => { const l = s.deploys.find(d => d.site === id && d.live); return l ? l.ver : 0; };
/** The site passes the top-bar filter. */
export const inSite = (s: S<'siteFilter'>, id: string | null | undefined): boolean => s.siteFilter === 'all' || s.siteFilter === id;
/**
 * A thing that belongs to a site passes the top-bar filter. Something whose site is not in the store but that carries
 * its own domain (a server request made for an earlier site) is shown only under "All sites".
 */
export const siteShown = (s: S<'sites' | 'siteFilter'>, id: string, domain?: string): boolean => siteById(s, id) ? inSite(s, id) : !!domain && s.siteFilter === 'all';
/** Text of a site chip: "VN · domain-a.example", "All sites" for null; for an unknown id the given domain, else "Removed site". */
export const chipText = (s: S<'sites'>, id: string | null | undefined, domain?: string): string => { const x = siteById(s, id); return x ? `${x.cc} · ${x.domain}` : id == null ? 'All sites' : domain || 'Removed site'; };
export const cnt = (s: S<'agents'>, k: AgentStatus): number => s.agents.filter(a => a.status === k).length;
export const totalTok = (s: S<'agents'>): number => s.agents.reduce((n, a) => n + a.tokens, 0);
/** Who receives a finished job from agent `id`: the next agent in the chain, else the Orchestrator; never itself. */
export function nextAgent(s: S<'agents'>, id: string): Agent | null {
  const t = s.agents.find(x => x.id === NEXT_AG[id] && x.status !== 'off') || s.agents.find(x => x.id === 'orc' && x.status !== 'off');
  return t && t.id !== id ? t : null;
}
/** The five steps written to a run's log. */
export function mkSteps(a: Pick<Agent, 'id' | 'skills'>): string[] {
  const n = a.skills.length;
  return ['Loaded the site profile and ' + (n || 'no') + ' skill' + (n === 1 ? '' : 's'), 'Read the inputs handed over by the previous step', 'Called tools: ' + (TOOL[a.id] || 'internal data'), 'Checked the result against the skill rules', 'Wrote the output and handed it on'];
}

/* ---------- Roles ---------- */

export const isRev = (session: AuthSession | null): boolean => !!session && session.role === 'reviewer';
/** Role-based access to a view: reviewers see only Article review, editors everything but team, integrations and settings. */
export const canSee = (session: AuthSession | null, v: ViewId): boolean =>
  !session ? false : session.role === 'reviewer' ? v === 'review' : session.role === 'editor' ? !ADMIN_ONLY.has(v) : true;
/**
 * Role-based access to a tab that has an id of its own (an alias): the role must be able to open its view. The Audit
 * log keeps the rule it had as a screen of its own: a native reviewer never sees it.
 */
export const canSeeTab = (session: AuthSession | null, a: AliasId): boolean => canSee(session, ALIAS[a].view) && !(a === 'audit' && isRev(session));
/** The Activity tabs the role may open. With one of the two, the screen shows just that one, without the tab row. */
export const activityTabs = (session: AuthSession | null): ActivityTab[] =>
  ACTABS.map(t => t[0]).filter(t => canSeeTab(session, t === 'runs' ? 'history' : 'audit'));
/** Where a person lands when the requested view is not allowed. */
export const homeView = (session: AuthSession | null): ViewId => isRev(session) ? 'review' : 'workspace';
/**
 * The one site a native reviewer works on: the site their account is limited to, or in demo mode the sample's
 * reviewer site. '' when they have none (they then see nothing to review).
 */
export const revSite = (s: S<'session' | 'sample'>): string => s.sample ? REV_SITE : s.session?.site ?? '';
/** Site filter a person starts with at sign-in. */
export const homeSite = (s: S<'session' | 'sample'>): string => isRev(s.session) ? revSite(s) || 'all' : 'all';

/** Resolves a view id or a tab's alias (an old module or screen id). Returns null for an unknown id. */
export function unalias(v: string): { view: ViewId; alias: AliasTarget | null } | null {
  if (isAliasId(v)) return { view: ALIAS[v].view, alias: ALIAS[v] };
  return isViewId(v) ? { view: v, alias: null } : null;
}

/* ---------- Articles ---------- */

/** Not decided yet: waiting, being written or revised, or failed (Waiting tab). */
export const artOpen = (a: Pick<Article, 'status'>): boolean => a.status === 'review' || a.status === 'revisi' || a.status === 'writing' || a.status === 'failed';
/**
 * The article passes the site filter. A real article whose site is not in the store carries its own domain and is
 * shown under "All sites" only, like a research request.
 */
export const artVisible = (s: S<'sites' | 'siteFilter'>, a: Pick<Article, 's' | 'live'>): boolean => siteShown(s, a.s, a.live?.domain);
/** Can be approved right now: waiting, every check passes and the native review is done (when required). */
export const artReady = (s: S<'settings'>, a: Article): boolean => a.status === 'review' && a.checks.every(c => c[0] === 'ok') && (a.native.st === 'done' || !s.settings.native);
/**
 * The server's website builds waiting for a person's approval inside the site filter, oldest first. Callers pass the
 * builds only outside demo mode: demo mode keeps the server's builds aside (liveBuilds.ts).
 */
export const waitingBuilds = (builds: Readonly<Record<number, BuildWire>>, s: S<'sites' | 'siteFilter'>): BuildWire[] =>
  Object.values(builds)
    .filter(b => b.status === 'ready' && b.review === 'waiting' && siteShown(s, b.siteId, b.domain))
    .sort((x, y) => (x.finishedAt ?? x.createdAt) - (y.finishedAt ?? y.createdAt));
/** Website builds waiting for approval, outside demo mode (0 in demo mode or when the state has no builds). */
export const waitingBuildsN = (s: S<'sites' | 'siteFilter'> & Partial<S<'live' | 'sample'>>): number =>
  s.live && !s.sample ? waitingBuilds(s.live.builds, s).length : 0;
/** Things waiting for a person: deploy approvals (demo) or website builds (the server's), plus articles in review, inside the site filter. */
export const waitN = (s: S<'approvals' | 'articles' | 'sites' | 'siteFilter'> & Partial<S<'live' | 'sample'>>): number =>
  s.approvals.filter(p => inSite(s, p.site)).length + waitingBuildsN(s) + s.articles.filter(a => artVisible(s, a) && a.status === 'review').length;
/** Badge on the Article review nav entry. */
export const reviewCount = (s: S<'articles' | 'sites' | 'session' | 'sample'>): number =>
  s.articles.filter(a => a.status === 'review' && (siteById(s, a.s) || a.live) && (!isRev(s.session) || a.s === revSite(s))).length;
/** A real article for this site and keyword is already queued, being written or revised, or waiting for review. */
export const articleQueued = (s: S<'articles'>, siteId: string, keyword: string): boolean =>
  s.articles.some(a => a.live && a.s === siteId && a.kw.toLowerCase() === keyword.toLowerCase() && (a.status === 'writing' || a.status === 'revisi' || a.status === 'review'));
/** Unread notifications the signed-in role may open. */
export const unreadCount = (s: S<'notifs' | 'session'>): number => s.notifs.filter(x => !x.read && canSee(s.session, x.view)).length;

/* ---------- MOD tables ---------- */

export const isModPill = (c: string | ModPill): c is ModPill => typeof c !== 'string';
/** Plain text of a cell, for data-label, search and parsing (for example "4 orphan pages"). */
export const cellText = (c: ModCell): string => Array.isArray(c) ? c.map(x => isModPill(x) ? x.text : x).join(' ') : isModPill(c) ? c.text : c;
export const modPill = (pill: PillKind, text: string, live?: boolean): ModPill => live ? { pill, text, live } : { pill, text };

export interface ModView {
  cols: string[];
  /** Each row: the site id plus the cells, with `null` standing where the Site chip goes. */
  rows: { site: string; domain?: string; cells: (ModCell | null)[] }[];
  /** Numeric column indexes in `cols`. */
  num: number[];
}
/** The prototype's modTbl(): filters rows by site and inserts the Site column (first for per-site tables, second otherwise). */
export function modView(s: S<'mod' | 'sites' | 'siteFilter'>, id: ModId): ModView {
  const m = s.mod[id], perSite = PER_SITE_MODS.includes(id);
  return {
    cols: perSite ? ['Site', ...m.cols] : [m.cols[0]!, 'Site', ...m.cols.slice(1)],
    rows: m.rows.filter(r => siteShown(s, r.s, r.domain)).map(r => ({ site: r.s, domain: r.domain, cells: perSite ? [null, ...r.c] : [...r.c.slice(0, 1), null, ...r.c.slice(1)] })),
    num: (m.num || []).map(i => perSite ? i + 1 : (i === 0 ? 0 : i + 1)),
  };
}

/* ---------- Countries (Sites map and Rank heat map) ---------- */

export interface CountryStat {
  cc: string; name: string; lang: string; n: number; live: number; setup: number; paused: number;
  /** Sites an access check found blocked by networks inside the country. */
  blocked: number;
  /** Sites that do not answer at all (for example DNS not pointed yet): not reachable, which is not a block. */
  down: number;
  /** Domains that cannot be opened from the country, blocked or not reachable. */
  bad: string[];
  /** Worst state among the country's sites. */
  k: 'ok' | 'warn' | 'bad' | 'mut';
}
/** The prototype's mapData(): one entry per country inside the site filter, worst first. */
export function mapData(s: S<'sites' | 'siteFilter'>): CountryStat[] {
  const m: Record<string, Omit<CountryStat, 'k'>> = {};
  s.sites.filter(x => inSite(s, x.id)).forEach(x => {
    const c = m[x.cc] || (m[x.cc] = { cc: x.cc, name: x.country, lang: x.lang, n: 0, live: 0, setup: 0, paused: 0, blocked: 0, down: 0, bad: [] }); c.n++;
    if (x.access === 'blocked') { c.blocked++; c.bad.push(x.domain); }
    else if (x.access === 'down') { c.down++; c.bad.push(x.domain); }
    if (x.status === 'live') c.live++; else if (x.status === 'paused') c.paused++; else c.setup++;
  });
  return Object.values(m).map((c): CountryStat => ({ ...c, k: c.blocked || c.down ? 'bad' : c.setup ? 'warn' : c.live ? 'ok' : 'mut' }))
    .sort((x, y) => y.blocked - x.blocked || y.down - x.down || y.n - x.n || x.name.localeCompare(y.name));
}

/* ---------- Planned agents ---------- */

/**
 * The agent has no job runner on the server, so outside demo mode it is "Planned": listed, but without controls that
 * would pretend to do something. Demo mode simulates every agent, so none is planned there.
 */
export const agentPlanned = (s: S<'sample'>, a: Pick<Agent, 'id'>): boolean => !s.sample && !RUNNER_AGENTS.has(a.id);

/* ---------- Finish setup (the Workspace checklist) ---------- */

export type SetupStepId = 'engine' | 'site' | 'verify' | 'research' | 'article' | 'build' | 'cloudflare' | 'gsc' | 'email' | 'twofa';
export interface SetupStep {
  id: SetupStepId;
  title: string;
  /** What to do, shown while the step is open. */
  hint: string;
  done: boolean;
  /** The screen where the step is done; 'account' opens the account menu. Null when this role cannot open that screen. */
  to: ViewId | AliasId | 'account' | null;
  /** Label of the link to that screen. */
  action: string;
}

/**
 * The setup checklist, computed from what the server reports: nothing is ticked by hand. Integrations is an admin
 * screen, so for other roles those steps carry no link and say to ask an admin.
 */
export function setupSteps(s: S<'live' | 'sites' | 'session'>): SetupStep[] {
  const L = s.live, admin = s.session?.role === 'admin';
  const connected = (id: string): boolean => { const w = L.ints[id]; return !!w && w.connected && w.status !== 'bad'; };
  const mine = (id: string, domain: string): boolean => s.sites.some(x => x.id === id && x.domain === domain);
  const int = (id: SetupStepId, key: string, title: string, hint: string): SetupStep =>
    ({ id, title, hint: admin ? hint : hint + ' Ask an admin: Integrations is an admin screen.', done: connected(key), to: admin ? 'integrations' : null, action: 'Open Integrations' });
  return [
    { id: 'engine', title: 'Connect ' + engineName(s.live.engine?.mode), hint: localRuntime(s) ? 'Configure and check the selected engine in Integrations.' : 'Add and test the OpenAI API key in Integrations.', done: engineReady(s), to: 'integrations', action: 'Open Integrations' },
    { id: 'site', title: 'Add your first site', hint: 'One domain per country, with its language and topic.', done: s.sites.length > 0, to: 'sites', action: 'Open Sites' },
    { id: 'verify', title: 'Verify you own the domain', hint: 'Add the DNS TXT record shown in Sites, then choose Verify.', done: Object.values(L.verify).some(v => !!v.verifiedAt && mine(v.siteId, v.domain)), to: 'sites', action: 'Open Sites' },
    { id: 'research', title: 'Run the first keyword research', hint: 'Send the Keyword agent a topic for a site.', done: Object.values(L.reqs).some(r => r.status === 'done'), to: 'keywords', action: 'Open Keywords' },
    { id: 'article', title: 'Approve the first article', hint: 'Choose "Write article" on a keyword, then read and approve it in Article review.', done: Object.values(L.arts).some(a => a.status === 'approved'), to: 'review', action: 'Open Article review' },
    { id: 'build', title: 'Build the first website', hint: 'Build and deploy turns the approved articles into a site you can preview.', done: Object.values(L.builds).some(b => b.status === 'ready'), to: 'website', action: 'Open Build and deploy' },
    int('cloudflare', 'cf', 'Connect Cloudflare', 'Needed to put a site live from here. Until then each build can be downloaded as a ZIP.'),
    int('gsc', 'gsc', 'Connect Search Console', 'Brings each site\'s clicks and positions into Analytics and Reports.'),
    int('email', 'email', 'Set up email', 'Needed for email alerts and the weekly report.'),
    { id: 'twofa', title: 'Turn on 2-step verification', hint: 'Protects your account with a code from your phone at sign-in.', done: !!s.session?.twofa, to: 'account', action: 'Open account menu' },
  ];
}

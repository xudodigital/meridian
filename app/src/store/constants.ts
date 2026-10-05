/* Fixed lookup tables from the prototype. Nothing here changes at run time; anything that does lives in the store. */
import type {
  AgentStatus, AliasId, ArticleStatus, Cadence, Country, ModId, NotifyEvent, PillKind, Provider, ProviderId, Rate,
  RequestStatus, ReviewMode, Role, SiteAccess, SiteStatus, TimeoutId, UserRole, ViewId,
} from './types';

export const COUNTRIES: readonly Country[] = [['Vietnam','VN','Vietnamese'],['Bangladesh','BD','Bengali'],['Thailand','TH','Thai'],['Philippines','PH','Filipino'],['Pakistan','PK','Urdu'],['India','IN','Hindi'],['Malaysia','MY','Malay'],['Brazil','BR','Portuguese'],['Mexico','MX','Spanish'],['Nigeria','NG','English'],['Egypt','EG','Arabic'],['Türkiye','TR','Turkish'],['Indonesia','ID','Indonesian']];
/** The countries the sample data is generated from; kept separate so adding a country does not change the sample sites. */
export const SAMPLE_COUNTRIES: readonly Country[] = COUNTRIES.slice(0, 12);

export const OAI = ['GPT-6 Luna','GPT-6.1 Sol','GPT-6 Astra'] as const;
export const MODELS = OAI;
export const PROV: Readonly<Record<ProviderId, Provider>> = { openai: { name:'OpenAI', models:OAI, tiers:[OAI[0],OAI[1],OAI[1]] } };
export const PROVIDER_IDS: ProviderId[] = ['openai'];
/** Standard list price, USD per million input/output tokens; official OpenAI pricing, 5 Oct 2026. */
export const RATE: Readonly<Record<string, Rate>> = {'GPT-6 Luna':[.1,.5,'gpt-6-luna'],'GPT-6.1 Sol':[2,10,'gpt-6.1-sol'],'GPT-6 Astra':[10,50,'gpt-6-astra']};

export const MODES: Readonly<Record<ReviewMode, string>> = {all:'Review everything',sample:'Sample 1 in 5',risk:'Risk-based'};

/** Idle sign-out: label and milliseconds per setting. */
export const TLBL: Readonly<Record<TimeoutId, string>> = {demo:'1 minute',m15:'15 minutes',h1:'1 hour',h8:'8 hours'};
export const TOMS: Readonly<Record<TimeoutId, number>> = {demo:6e4,m15:9e5,h1:36e5,h8:288e5};

export const CADS: readonly Cadence[] = ['Manual only','Every hour','Every day 06:00','Every Monday 06:00','Every Friday 16:00'];
/** Next run label per cadence (the prototype's NEXT). */
export const NEXT: Readonly<Record<Cadence, string>> = {'Manual only':'—','Every hour':'Within the hour','Every day 06:00':'Tomorrow 06:00','Every Monday 06:00':'Monday 06:00','Every Friday 16:00':'Friday 16:00'};

export const EVENTS: readonly (readonly [NotifyEvent, string])[] = [['approval','Something needs approval'],['error','An agent fails'],['blocked','A domain is blocked or down'],['budget','A site passes 80% of its budget, or is stopped at 100%'],['review','An article is ready for review'],['report','The weekly report is ready']];
export const CH = ['In-app','Email','Slack','Telegram'] as const;

/** Tools each agent calls, shown in a run's step log. */
export const TOOL: Readonly<Record<string, string>> = {orc:'job queue',res:'SERP data API',kw:'keyword data API',arc:'site map store',wr:'content repository',seo:'page fetcher, schema validator',lnk:'page index, embeddings search',bld:'Git repository, build runner',dep:'deploy API, country probes',ana:'Search Console API, GA4 API',gd:'SVG renderer, image optimizer, media library'};

export const WF_STEPS = ['Site profile','Research','Keywords','Architecture','Theme','Content','Review','Deploy','Monitor'] as const;

/** Side navigation: [group title, [[view id, title, icon], ...]]. */
/** The side navigation: 11 views in four groups. Each entry is [view id, title, icon]. */
export const NAV: readonly (readonly [string, readonly (readonly [ViewId, string, string])[]])[] = [
 ['Work',[['workspace','Workspace','groups'],['review','Article review','rate_review']]],
 ['Sites',[['sites','Sites','language'],['deploy','Build and deploy','rocket_launch']]],
 ['Insights',[['research','Research and SEO','travel_explore'],['analytics','Analytics','bar_chart'],['activity','Activity','receipt_long']]],
 ['System',[['skills','Models and skills','psychology'],['team','Team and roles','group'],['integrations','Integrations','extension'],['settings','Settings','settings']]],
];
export const VIEW_IDS: readonly ViewId[] = NAV.flatMap(g => g[1].map(v => v[0]));
export const TITLES = Object.fromEntries(NAV.flatMap(g => g[1].map(v => [v[0], v[1]]))) as Readonly<Record<ViewId, string>>;
export const isViewId = (v: string): v is ViewId => Object.hasOwn(TITLES, v);

export type ResearchTab = 'research' | 'keywords' | 'seo' | 'aio' | 'cta' | 'architecture' | 'links' | 'experiments';
export type AnalyticsTab = 'overview' | 'gsc' | 'ga4' | 'rank' | 'reports';
export type DeployTab = 'website' | 'workflows';
export type ActivityTab = 'runs' | 'audit';
export const RTABS: readonly (readonly [ResearchTab, string])[] = [['research','Research'],['keywords','Keywords'],['seo','SEO/GEO'],['aio','AI Overview'],['cta','Calls to action'],['architecture','Architecture'],['links','Internal links'],['experiments','Experiments']];
export const ATABS: readonly (readonly [AnalyticsTab, string])[] = [['overview','Overview'],['gsc','Search Console'],['ga4','GA4'],['rank','Rank'],['reports','Reports']];
export const DTABS: readonly (readonly [DeployTab, string])[] = [['website','Website'],['workflows','Workflows']];
export const ACTABS: readonly (readonly [ActivityTab, string])[] = [['runs','Runs'],['audit','Audit log']];

/** The store field that remembers a view's tab, with the tabs it can hold. */
export interface AliasTabs { rctab: ResearchTab; rtab: 'drafts'; atab: AnalyticsTab; smode: 'themes'; dtab: DeployTab; actab: ActivityTab }
export type AliasKey = keyof AliasTabs;
export type AliasTarget = { [K in AliasKey]: { view: ViewId; key: K; tab: AliasTabs[K]; label: string; icon?: string } }[AliasKey];
/** Tabs with an id of their own: id -> view, state key, tab, name shown in search (and its icon there). */
export const ALIAS: Readonly<Record<AliasId, AliasTarget>> = {
  keywords:{view:'research',key:'rctab',tab:'keywords',label:'Keywords'},
  seo:{view:'research',key:'rctab',tab:'seo',label:'SEO/GEO'},
  aio:{view:'research',key:'rctab',tab:'aio',label:'AI Overview'},
  cta:{view:'research',key:'rctab',tab:'cta',label:'Calls to action'},
  architecture:{view:'research',key:'rctab',tab:'architecture',label:'Site architecture',icon:'lan'},
  links:{view:'research',key:'rctab',tab:'links',label:'Internal links',icon:'hub'},
  experiments:{view:'research',key:'rctab',tab:'experiments',label:'Experiments',icon:'science'},
  content:{view:'review',key:'rtab',tab:'drafts',label:'Content factory (drafts)'},
  website:{view:'deploy',key:'dtab',tab:'website',label:'Website builds and deploys',icon:'web'},
  workflows:{view:'deploy',key:'dtab',tab:'workflows',label:'Workflows',icon:'account_tree'},
  factory:{view:'deploy',key:'dtab',tab:'workflows',label:'Website factory (site builds)'},
  gsc:{view:'analytics',key:'atab',tab:'gsc',label:'Search Console (GSC)'},
  ga4:{view:'analytics',key:'atab',tab:'ga4',label:'GA4'},
  rank:{view:'analytics',key:'atab',tab:'rank',label:'Rank tracking',icon:'leaderboard'},
  reports:{view:'analytics',key:'atab',tab:'reports',label:'Reports',icon:'summarize'},
  history:{view:'activity',key:'actab',tab:'runs',label:'Run history',icon:'receipt_long'},
  audit:{view:'activity',key:'actab',tab:'audit',label:'Audit log',icon:'history'},
  themes:{view:'sites',key:'smode',tab:'themes',label:'Themes'},
};
export const ALIAS_IDS = Object.keys(ALIAS) as AliasId[];
export const isAliasId = (v: string): v is AliasId => Object.hasOwn(ALIAS, v);

/* Status labels: [pill kind, text]. */
type Label = readonly [PillKind, string];
export const ST: Readonly<Record<AgentStatus, Label>> = {work:['ok','Working'],idle:['mut','Idle'],wait:['warn','Needs approval'],err:['bad','Error'],off:['mut','Paused']};
export const AST: Readonly<Record<ArticleStatus, Label>> = {review:['warn','Waiting for review'],revisi:['info','Agent is revising'],published:['ok','Published'],rejected:['bad','Rejected'],writing:['info','Agent is writing'],approved:['ok','Approved, not published'],failed:['bad','Failed']};
export const SST: Readonly<Record<SiteStatus, Label>> = {live:['ok','Live'],build:['info','Building'],dns:['warn','Waiting for DNS'],paused:['mut','Paused']};
export const ACC: Readonly<Record<SiteAccess, Label>> = {ok:['ok','Reachable'],blocked:['bad','Blocked by ISP'],pending:['mut','Not checked'],down:['bad','Not reachable']};
/**
 * The one vocabulary for a site's status and access, used word for word by the pill, the filter, the tiles and the map.
 * "Blocked by ISP" is only what an access check found blocked inside the country; a domain that does not answer at all
 * (for example DNS not pointed yet) is "Not reachable". Outside demo mode nothing builds a site by itself, so "build"
 * is the person's own "Being set up".
 */
export const siteStatusText = (st: SiteStatus, sample: boolean): string => st === 'build' && !sample ? 'Being set up' : SST[st][1];
export const REQ_ST: Readonly<Record<RequestStatus, Label>> = {queued:['mut','Queued'],work:['info','In progress'],done:['ok','Done'],failed:['bad','Failed']};

/** Who receives a finished job: agent id -> next agent id. */
export const NEXT_AG: Readonly<Record<string, string>> = {res:'kw',kw:'arc',arc:'wr',wr:'gd',gd:'seo',seo:'lnk',lnk:'dep',bld:'dep',dep:'ana',ana:'orc',orc:'res'};

/** The one site a native reviewer in this sample is assigned to. */
export const REV_SITE = 'a';
export const ADMIN_ONLY: ReadonlySet<ViewId> = new Set<ViewId>(['team','integrations','settings']);
export const ROLE_LABEL: Readonly<Record<Role, UserRole>> = {admin:'Admin',editor:'Editor',reviewer:'Native reviewer',viewer:'Viewer'};

/** Tables that show one row per site, with the Site column first. */
export const PER_SITE_MODS: readonly string[] = ['gsc','ga4','factory','themes'];

/**
 * The agents the server runs jobs for: Keyword, Content Writer, Site Builder, Deploy & Monitor, and the Orchestrator,
 * whose "job" is the workflow engine (server/workflows.ts: code that sequences the others, with no model call). Every
 * other agent (and any agent a person adds) is configuration only until it gets a job runner: outside demo mode it is
 * shown as "Planned" and has no controls that would pretend otherwise.
 */
export const RUNNER_AGENTS: ReadonlySet<string> = new Set(['orc', 'kw', 'wr', 'bld', 'dep', 'res', 'arc', 'seo', 'lnk', 'ana', 'gd']);

/**
 * What each module table says while it has no rows at all. Demo mode fills every table, so these are read outside it:
 * each says what is true today, and a table nothing feeds yet says so instead of promising data.
 */
export const MOD_EMPTY: Readonly<Record<ModId, string>> = {
  research: 'Run a focused research or strategy task in Research and SEO. Keyword requests are in the Keywords tab.',
  keywords: 'Send a research request above. The keywords it proposes are listed here.',
  architecture: 'The Architect agent is planned and has no job yet, so no silos are planned for a site.',
  content: 'Articles that are being written are listed under Waiting.',
  seo: 'The SEO/GEO Optimizer is planned and has no job yet. Each article is checked automatically when it is written: see Article review.',
  aio: 'AI Overview tracking is planned. Meridian has no data source for it yet.',
  cta: 'Calls to action are planned. The websites Meridian builds have no call-to-action component yet.',
  factory: 'A build is listed here when you start one in Build and deploy.',
  themes: 'Every built site gets its own theme, but themes are not listed here yet.',
  experiments: 'Experiments are planned. No agent proposes or runs them yet.',
  gsc: 'Connect Search Console in Integrations to see clicks, impressions and positions for each site here.',
  ga4: 'Connect Google Analytics 4 in Integrations to see users and sessions for each site here.',
  rank: 'Positions come from Search Console. Connect it in Integrations: the keywords of approved articles are then tracked by themselves.',
};
/** Icon and title of each module table's empty state. */
export const MOD_EMPTY_HEAD: Readonly<Record<ModId, readonly [icon: string, title: string]>> = {
  research: ['travel_explore', 'No research findings'],
  keywords: ['key', 'No keywords yet'],
  architecture: ['lan', 'No silos planned'],
  content: ['edit_note', 'No drafts'],
  seo: ['troubleshoot', 'No on-page checks'],
  aio: ['auto_awesome', 'No AI Overview data'],
  cta: ['ads_click', 'No calls to action'],
  factory: ['construction', 'No site builds yet'],
  themes: ['palette', 'No themes listed'],
  experiments: ['science', 'No experiments'],
  gsc: ['search', 'No Search Console data yet'],
  ga4: ['monitoring', 'No GA4 data'],
  rank: ['leaderboard', 'No tracked keywords'],
};

/** Simulation interval in milliseconds. */
export const TICK_MS = 1800;

import type { SeoTaskWire } from '../../../shared/seo-tasks';
/* Types for every entity in the prototype's "Sample data" section and for the app state.
   Field names follow the prototype (web/index.html) so the two can be read side by side. */

export type Role = 'admin' | 'editor' | 'reviewer' | 'viewer';

export type ViewId =
  | 'workspace' | 'review'
  | 'sites' | 'deploy'
  | 'research' | 'analytics' | 'activity'
  | 'skills' | 'team' | 'integrations' | 'settings';

/**
 * Ids that open a tab of a view: the prototype's merged modules, and the eight screens that became tabs when the
 * navigation went from 18 views to 11 (workflows, history, audit, architecture, links, experiments, rank, reports).
 * Each one is still a URL ("/rank") and a go() target; both select the tab and open the view.
 */
export type AliasId =
  | 'keywords' | 'seo' | 'aio' | 'cta' | 'content' | 'factory' | 'gsc' | 'ga4' | 'themes'
  | 'website' | 'workflows' | 'history' | 'audit' | 'architecture' | 'links' | 'experiments' | 'rank' | 'reports';

/** Colour of a status pill, notification icon tile or automated check. */
export type PillKind = 'ok' | 'warn' | 'bad' | 'info' | 'mut';

/** [country name, ISO code, content language] */
export type Country = readonly [name: string, cc: string, lang: string];

export type SiteStatus = 'live' | 'build' | 'dns' | 'paused';
export type SiteAccess = 'ok' | 'blocked' | 'pending' | 'down';
export type ReviewMode = 'all' | 'sample' | 'risk';

export interface Site {
  id: string;
  domain: string;
  country: string;
  cc: string;
  lang: string;
  topic: string;
  status: SiteStatus;
  access: SiteAccess;
  /** Time of the last access check, "09:12" or "—". */
  checked: string;
  /** Human-readable last deploy, for example "Yesterday 16:40" or "Never". */
  deploy: string;
  silos: string[];
  /** DNS verification token shown while status is "dns". */
  token?: string;
  /** Agent spend today in USD. The simulation adds to it. */
  spend: number;
  /** Organic clicks, last 28 days. */
  clicks: number;
  /** Tokens used in the last 28 days, in millions. */
  tok28: number;
  /** Review mode; missing means "all". */
  mode?: ReviewMode;
  /** Status before the site was paused, restored on resume. */
  prev?: SiteStatus;
}

export type ProviderId = 'openai';

export interface Provider {
  name: string;
  models: readonly string[];
  /** [high-volume, balanced, most demanding] used by the provider switch. */
  tiers: readonly [string, string, string];
}

export interface PriceChange { from: string; p: readonly [number, number] }
/** Standard list price in USD per 1M tokens: [input, output, API model id, announced change]. */
export type Rate = readonly [input: number, output: number, apiId?: string, change?: PriceChange];

export interface SkillVersion { v: string; when: string; note: string }
export interface Skill {
  id: string;
  name: string;
  desc: string;
  ver: string;
  /** Label of a default skill, for example "Default for SEO". */
  def?: string;
  /** Skill written for one provider only. */
  only?: ProviderId;
  /** Added in this session. */
  fresh?: boolean;
  hist?: SkillVersion[];
}

export type AgentStatus = 'work' | 'idle' | 'wait' | 'err' | 'off';
export type Gate = 'Publish' | 'Deploy';

export interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  skills: string[];
  workers: number;
  tokens: number;
  status: AgentStatus;
  progress: number;
  site: string | null;
  task: string;
  tasks: string[];
  /** Index of the hue class h0..h10. */
  hue: number;
  /** Human gate this agent stops at when a job finishes. */
  gate?: Gate;
  /** Id of the approval this agent waits for. */
  pending?: number | null;
  /** Ticks left before an errored agent retries on its own. */
  errT?: number;
  /** The error is a missing provider key. */
  errKey?: boolean;
  /** Token count when the current job started; the run log uses the difference. */
  tok0?: number | null;
  /** Keyword request (simulation mode) this agent is working on. */
  req?: number | string | null;
  /** Driven by the server in live mode; the simulation skips it. */
  live?: boolean;
  /** Server id of the request or article it is working on. */
  liveReq?: number | null;
  /** Model the agent ran on before a provider switch, by provider. */
  prev?: Partial<Record<ProviderId, string>>;
}

export interface Approval {
  id: number;
  kind: Gate;
  what: string;
  site: string | null;
  agent: string | null;
}

/**
 * Where an article is. The prototype's four, plus three for real articles from the server: `writing` (queued or being
 * written for the first time), `approved` (approved by a person but not published: there is no deploy yet) and `failed`.
 */
export type ArticleStatus = 'review' | 'revisi' | 'published' | 'rejected' | 'writing' | 'approved' | 'failed';
export type NativeReview = { st: 'wait' } | { st: 'done'; by: string; note: string };
export type ArticleCheck = [kind: PillKind, name: string, detail: string];
export type ArticlePara = [original: string, english: string];

/** A real article as the server keeps it (server/articles.ts viewArticle); `content` is null until the first version. */
export interface LiveArticle {
  /** Server id. */
  aid: number;
  /** Status on the server, finer than the article's `status`. */
  state: ServerArticleStatus;
  /** Site profile stored with the article; shown when its site is not in the store. */
  domain: string;
  country: string;
  lang: string;
  engine: EngineMode | '';
  step: string;
  /** The reviewer's note while a revision is queued or being written. */
  pendingNote: string;
  content: ArticleContent | null;
  /** Notes from the engine, for example that another model ran than the one chosen. */
  engineNotes: string;
  history: ArticleEvent[];
  error: string;
  /** Requested at. */
  t: Date;
}

/** An article in the review queue (the prototype's `articles`). */
export interface Article {
  /** Sample data: a number. Real articles: "a" + server id. */
  id: number | string;
  /** Site id. */
  s: string;
  title: string;
  titleEn: string;
  kw: string;
  words: number;
  rev: number;
  status: ArticleStatus;
  notes: string[];
  native: NativeReview;
  checks: ArticleCheck[];
  paras: ArticlePara[];
  /** Ticks left until a revision returns to review. */
  wait?: number;
  /** A real article written by the Content Writer on the server (live mode). */
  live?: LiveArticle;
  /** Archived by a person: hidden from the review lists unless "Show archived" is on. */
  archived?: boolean;
}

/**
 * Audit log entry (the prototype's `log`). Outside demo mode the server keeps the log: `id` is its number there.
 * `cid` marks an entry made in this browser until the server confirms it (then the server's `id`, time and actor win).
 */
export interface LogEntry {
  t: Date; actor: string; act: string; site: string | null; id?: number; cid?: string;
  /** Recorded from the dashboard by this person (the server marks these so they cannot pass for its own entries). */
  note?: boolean;
}

export interface Integration {
  id: string;
  name: string;
  use: string;
  icon: string;
  type: 'key' | 'oauth';
  /** Last characters of the key or the connected account; null means not connected. */
  tail: string | null;
  /** The last test: worked, works with a warning, failed (normal mode only), or not tested. */
  st: 'ok' | 'warn' | 'bad' | null;
  msg?: string | null;
  /** An AI provider; its id is a ProviderId. */
  ai?: boolean;
}

export type TimeoutId = 'demo' | 'm15' | 'h1' | 'h8';
export type QuietId = 'none' | 'night' | 'weekend';

export interface Settings {
  budget: number;
  parallel: number;
  apPublish: boolean;
  apDeploy: boolean;
  native: boolean;
  twofa: boolean;
  timeout: TimeoutId;
  quiet: QuietId;
  repTo: string;
  repFreq: string;
  repOn: boolean;
}

export type Cadence = 'Manual only' | 'Every hour' | 'Every day 06:00' | 'Every Monday 06:00' | 'Every Friday 16:00';

/** How often a real schedule runs: every week, every second week, or on the first such weekday of each month. */
export type ScheduleEvery = 'week' | '2weeks' | 'month';
/**
 * A schedule. Demo mode uses `cad` (the prototype's cadence text). Outside it the server's workflow engine runs
 * "Weekly content" from `every`, `weekday` (0 Sunday … 6 Saturday), `hour` (0–23 on the site's own clock), `n` (how
 * many articles, 1–5) and `topic` ('' = the site's topic); a schedule without them is never run.
 */
export interface Schedule {
  id: string; wf: string; site: string | null; cad: Cadence; on: boolean;
  every?: ScheduleEvery; weekday?: number; hour?: number; n?: number; topic?: string;
}

export interface Deploy {
  id: string;
  site: string;
  ver: number;
  what: string;
  by: string;
  when: string;
  live: boolean;
  /** Average position change 7 days after the deploy; undefined means still measuring. */
  rank?: number;
}

export type NotifyEvent = 'approval' | 'error' | 'blocked' | 'budget' | 'review' | 'report';
/** Per event, one flag per channel in CH order: In-app, Email, Slack, Telegram. */
export type NotifyPrefs = Record<NotifyEvent, [boolean, boolean, boolean, boolean]>;

/** A signed-in device listed in Settings (the prototype's `sessions`). Outside demo mode `last` is when it was last used. */
export interface DeviceSession { id: string; dev: string; where: string; cur?: boolean; last?: number }

/**
 * The signed-in person, from the server (GET /api/auth/me). `site` is a native reviewer's one site (a site id).
 * `enroll`: Settings require 2-step verification and this person has not set it up, so the app asks for that first.
 */
export interface AuthSession { id: string; email: string; role: Role; name: string; site: string | null; twofa: boolean; enroll: boolean }

/** The server's answer for the signed-in person (server/auth-api.ts me()). */
export interface Me { id: string; name: string; email: string; role: Role; site: string | null; created: number; disabled: boolean; twofa: boolean; mustEnroll: boolean }

/** Where the app is with signing in: asking the server, first run (no account yet), signed out, or the server is not reachable. */
export type AuthPhase = 'loading' | 'setup' | 'signin' | 'offline';

/** One finished job in Run history (the prototype's `jobLog`). */
export interface JobRun {
  id: number;
  t: Date;
  agent: string;
  hue: number;
  task: string;
  site: string | null;
  /** Seconds. */
  dur: number;
  tokens: number;
  cost: number;
  /** Runtime used for this run; subscription usage has no API dollar estimate. */
  engine?: EngineMode | '';
  status: 'Done' | 'Failed';
  steps: string[];
  /** Domain stored on the server request, shown when `site` is not in the store. */
  domain?: string;
  /** The person who asked for the job (live mode), when the server recorded it. */
  by?: string;
  /** Seconds from the start at which each step began, recorded by the server (live mode). */
  stepAt?: number[];
}

export type RequestStatus = 'queued' | 'work' | 'done' | 'failed';
/** `none`: OpenAI API was not found or is not connected, so no agent job can run. */
export type EngineMode = 'openai-api' | 'codex-local' | 'gemma-local' | 'none';
/** One step of a server job's latest run, with the time it began. */
export interface JobStep { at: number; text: string }
export interface KeywordOut {
  keyword: string; meaning: string; intent: string; cluster: string; basis: string;
  /** The keyword's id on the server, for marking it "Track". Missing from an older server. */
  id?: number;
  /** Monthly searches from Google Ads or DataForSEO; null when it has no figure. `volumeAt` is when it was asked: null or missing means never. */
  volume?: number | null;
  /** LOW, MEDIUM or HIGH among advertisers (Google Ads data), or ''. */
  competition?: string;
  volumeAt?: number | null;
  volumeProvider?: string;
  volumeCountry?: string;
  volumeLanguage?: string;
  /** Shared Google close-variant metric, never sum duplicates in the same group. */
  volumeGroup?: string;
  /** A person asked to track its position in Rank. */
  track?: boolean;
}

/** A keyword research request (the prototype's `kwReqs`). In live mode the extra fields come from the server. */
export interface KwRequest {
  /** Simulation: a number. Live mode: "r" + server id. */
  id: number | string;
  /** Server id (live mode only). */
  rid?: number;
  site: string;
  /** Domain the server stored with the request (live mode); shown when `site` is not in the store. */
  domain?: string;
  topic: string;
  goal: string;
  t: Date;
  st: RequestStatus;
  engine?: EngineMode | '';
  step?: string;
  summary?: string;
  notes?: string;
  error?: string;
  keywords?: KeywordOut[];
  tokens?: number;
  cost?: number;
  /** Seconds. */
  dur?: number;
  end?: number | null;
  /** Country and language stored with the request on the server; a Write article request falls back to them. */
  country?: string;
  lang?: string;
  /** Who asked (live mode); empty when the server did not record it. */
  by?: string;
}

/** GET /api/state `engine`, and the SSE "engine" event (server/engine.ts EngineStatus). */
export interface EngineStatus { mode: EngineMode; keyConfigured: boolean; apiVersion: string; ready: boolean; reason: string; model?: string }

/** One request as the server sends it (server/jobs.ts viewRequest). */
export interface ServerRequest {
  id: number;
  siteId: string;
  domain: string;
  /** Missing from a server started before articles existed. */
  country?: string;
  lang?: string;
  topic: string;
  goal: string;
  status: RequestStatus;
  engine: EngineMode | '';
  step: string;
  summary: string;
  notes: string;
  error: string;
  tokens: number;
  costUsd: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  keywords: KeywordOut[];
  /** Who asked, and who last asked to run it again. Empty for requests made before this was recorded; missing from an older server. */
  requestedBy?: string;
  retriedBy?: string;
  /** Steps of the latest run with their times. */
  steps?: JobStep[];
}

/* ---------- Articles on the server (server/article-content.ts, server/articles.ts) ---------- */

export type ServerArticleStatus = 'queued' | 'work' | 'review' | 'revision' | 'approved' | 'rejected' | 'failed';
/** Text in the site's language with its English translation for the reviewer. */
/* `enStale`: a person edited the text by hand, so the English beside it was not updated (or there is none). */
/**
 * A link on a part of a text (server/article-content.ts Link): the characters from `start` up to `end` lead to another
 * article of the same site (by its server id) or to a web address. Never HTML.
 */
export type ArticleLink = { start: number; end: number; article: number } | { start: number; end: number; url: string };
/* `links` only on list items. */
export interface Bi { text: string; en: string; enStale?: true; links?: ArticleLink[] }
export type ArticleBlock =
  /* `links` only on paragraphs. */
  | { type: 'h2' | 'h3' | 'p'; text: string; en: string; enStale?: true; links?: ArticleLink[] }
  | { type: 'list'; items: Bi[] }
  /** The first row is the header row. */
  | { type: 'table'; rows: Bi[][] };
export interface ArticleSource { title: string; url: string }
export interface ArticleContent {
  title: string;
  titleEn: string;
  /** A person changed the title by hand after the agent translated it. */
  titleEnStale?: true;
  titleTag: string;
  metaDescription: string;
  slug: string;
  byline: Bi;
  /** The note for readers on how the article was made. */
  disclosure: Bi;
  blocks: ArticleBlock[];
  sources: ArticleSource[];
  /** The agent's notes for the reviewer: claims to double-check, things left out. */
  reviewerNotes: string[];
}
export type ArticleAction = 'requested' | 'written' | 'failed' | 'approved' | 'revision' | 'rejected' | 'language-review' | 'retried' | 'photos'
  | 'edited' | 'unapproved' | 'archived' | 'unarchived';
/** One entry of an article's decision history. */
export interface ArticleEvent { at: number; by: string; action: ArticleAction; note: string }

/** One article as the server sends it (server/articles.ts viewArticle). */
export interface ServerArticle {
  id: number;
  siteId: string;
  domain: string;
  country: string;
  lang: string;
  keyword: string;
  requestId: number | null;
  model: string;
  status: ServerArticleStatus;
  engine: EngineMode | '';
  step: string;
  /** 0 is the first draft; one more for every finished revision. */
  revision: number;
  pendingNote: string;
  content: ArticleContent | null;
  /** Computed by the server, never by the model. */
  checks: { kind: PillKind; name: string; detail: string }[];
  notes: string;
  languageReview: { by: string; at: number } | null;
  history: ArticleEvent[];
  error: string;
  tokens: number;
  costUsd: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Time of the latest change; orders the answer to an action against the event stream. */
  updatedAt: number;
  /** Steps of the latest run with their times. */
  steps?: JobStep[];
  /** Openly licensed photos chosen for the article by the Site Builder (missing from an older server). */
  images?: PhotoWire[];
  /** The latest photo job of this article (missing from an older server). */
  photos?: PhotoJobWire;
  /** When a person archived it: the lists hide it. Null or missing when it is not archived. */
  archivedAt?: number | null;
  /** The site category it belongs to; '' for none (missing from an older server). */
  category?: string;
}

/** Body of POST /api/articles. Who asked comes from the session. */
export interface NewArticleBody {
  siteId: string; domain: string; country: string; lang: string; siteTopic: string; keyword: string; requestId: number; model: string;
}

/** One block of an edit, in the site's language only. `from` is the block's place before the edit; null for a new block. */
/* `links` (a paragraph) and an item given as { text, links } are sent only when the text has links: text sent without
   them has none after the save. */
export type BlockEdit =
  | { from: number | null; type: 'h2' | 'h3' | 'p'; text: string; links?: ArticleLink[] }
  | { from: number | null; type: 'list'; items: (string | { text: string; links: ArticleLink[] })[] }
  | { from: number | null; type: 'table'; rows: string[][] };
/** PATCH /api/articles/:id/content. `updatedAt` is that of the version the person edited. */
export interface ArticleEditBody { updatedAt: number; title: string; titleTag: string; metaDescription: string; disclosure: string; slug: string; category: string; blocks: BlockEdit[] }

/** One article in a site's link graph (server/links.ts LinkNode). */
export interface LinkNodeWire { id: number; title: string; titleEn: string; slug: string; status: ServerArticleStatus; category: string; out: number; in: number; external: number }
/**
 * A site's real internal links and categories (GET /api/sites/:id/links, server/links.ts): the links people and the
 * Content Writer put in the text, the articles no other article links to, and the categories with their articles.
 */
export interface SiteLinksWire {
  siteId: string; domain: string;
  articles: LinkNodeWire[];
  /** `live`: both articles are approved, so the website shows the link. */
  links: { from: number; to: number; anchor: string; live: boolean }[];
  broken: { from: number; to: number; anchor: string }[];
  orphans: number[];
  categories: { name: string; slug: string; articles: number[]; approved: number }[];
  uncategorized: number[];
  /** Every category name the site uses, also of articles still being written. */
  allCategories: string[];
}
/** One keyword of POST /api/articles/bulk: the article it started, or why it was not started. */
export type BulkArticleResult = { keyword: string; ok: true; article: ServerArticle } | { keyword: string; ok: false; status: number; error: string };

/**
 * A photo placed in an article (server/photos.ts). Files are stored by the server as <file>-<width>.<ext> for each width
 * in `widths`; the dashboard reads them at /api/media/articles/<article id>/<file>-<width>.<ext>.
 */
export interface PhotoWire {
  /** Stable id within the article, for example "p1". */
  id: string;
  /** "hero" is the article's main image (shown above the text); "inline" sits after the block `after`. */
  role: 'hero' | 'inline';
  /** Index into content.blocks after which an inline photo is placed; null for the hero. */
  after: number | null;
  /** Stored base name without width and extension, for example "kopi-robusta-lampung-buah-kopi-3f9a2c1d". */
  file: string;
  ext: 'jpg' | 'png';
  /** Stored widths in pixels, ascending, for example [960, 1280]. */
  widths: number[];
  /** Pixel size of the widest stored file. */
  width: number;
  height: number;
  /** Alternative text and caption in the site's language, with English for the reviewer. */
  alt: string;
  altEn: string;
  caption: string;
  captionEn: string;
  /** Attribution (TASL): the work's title, its author, the source page and the license. */
  title: string;
  author: string;
  authorUrl: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  provider: 'Wikimedia Commons';
}
/** The photo job of an article: '' never ran. */
export interface PhotoJobWire {
  engine?: EngineMode | '';
  status: '' | 'queued' | 'work' | 'done' | 'failed';
  step: string;
  error: string;
  queuedAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  tokens: number;
  costUsd: number;
}
/**
 * One website build of a site (server/builds.ts): a static site made from the site's approved articles, previewed in
 * Meridian, approved by a person, then deployed to Cloudflare Pages (or downloaded as a ZIP).
 */
export interface BuildWire {
  engine?: EngineMode | '';
  id: number;
  siteId: string;
  domain: string;
  /** 1, 2, 3… per site. */
  version: number;
  /** The build job. */
  status: 'queued' | 'work' | 'ready' | 'failed';
  step: string;
  error: string;
  /** The human decision on a ready build: '' while not ready, then waiting, approved or rejected. */
  review: '' | 'waiting' | 'approved' | 'rejected';
  reviewNote: string;
  /** Deploy to Cloudflare Pages: '' not asked; queued, work, live, failed; superseded once a newer version went live. */
  deploy: '' | 'queued' | 'work' | 'live' | 'failed' | 'superseded';
  /** The deploy's current step while it runs (`step` carries it then too). */
  deployStep?: string;
  deployUrl: string;
  deployError: string;
  /** Article ids included in this build. */
  articles: number[];
  pages: number;
  files: number;
  bytes: number;
  by: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  decidedBy: string;
  decidedAt: number | null;
  deployedAt: number | null;
  tokens: number;
  costUsd: number;
  /** The files were deleted to save space (Meridian keeps the newest 10 builds of a site): no preview, ZIP or deploy. */
  pruned?: boolean;
  /** Where Meridian serves the built site for preview, for example "/api/preview/s1/2/"; '' once pruned or not ready. */
  previewPath: string;
  steps: JobStep[];
  /** Time of the latest change, to order answers against events. */
  updatedAt: number;
}

/**
 * A site's own domain on its Cloudflare Pages project (server/domains.ts DomainView). `status`: none (not attached),
 * dns (waiting for the DNS to point at the project), cert (Cloudflare is issuing the certificate), live (active and
 * answering over HTTPS) or error (a person has to do something; `message` says what, in plain words).
 */
export interface DomainWire {
  siteId: string; domain: string; project: string;
  status: 'none' | 'dns' | 'cert' | 'live' | 'error';
  problem: string; message: string; cfStatus: string; method: string;
  /** The TXT record Cloudflare asks for when it validates by TXT. */
  txt: { name: string; value: string } | null;
  /** Who puts the DNS record in place: Meridian did, or the person has to (then `record` is what to add). */
  dnsBy: '' | 'meridian' | 'you';
  record: { type: string; name: string; content: string; proxied: boolean } | null;
  /** The project's own https://<name>.pages.dev address, which works from the first deploy. */
  pagesUrl: string;
  checkedAt: number | null; startedAt: number | null; liveAt: number | null; nextCheckAt: number | null;
  /** Time of the latest change, to order answers against events. */
  updatedAt: number;
}

export interface ServerState {
  seoTasks?: SeoTaskWire[];
  engine: EngineStatus;
  requests: ServerRequest[];
  /** Missing from a server started before articles existed. */
  articles?: ServerArticle[];
  /* Connected services and checks (server/ops-api.ts opsState). Missing from an older server. */
  integrations?: IntegrationWire[];
  access?: AccessWire[];
  checking?: string[];
  verify?: VerifyWire[];
  metrics?: MetricsWire | null;
  /** Website builds (server/build-api.ts). Missing from an older server. */
  builds?: BuildWire[];
  /** Each site's own domain on its Cloudflare Pages project (server/domains.ts). Missing from an older server. */
  domains?: DomainWire[];
  /** Spend and tokens from the server's ledger (server/ledger.ts). Null for a native reviewer; missing from an older server. */
  spend?: SpendWire | null;
  /** Workflow runs and schedule times (server/workflow-api.ts). Null for a native reviewer; missing from an older server. */
  workflows?: WorkflowsWire | null;
}

/** One site's agent spend in USD and tokens: today (the server's local day), the last 7 and 28 days. */
export interface SiteSpendWire { today: number; tokensToday: number; d7: number; d28: number; tokens28: number }
/**
 * What the server's spend ledger adds up to (server/ledger.ts spendSnapshot): per site id and, for today, per agent
 * name (Keyword, Content Writer, Site Builder). `budget` is the daily budget per site the server enforces and `day`
 * the start of the day it counts for.
 */
export interface SpendWire {
  budget: number; day: number;
  sites: Record<string, SiteSpendWire>;
  agents: Record<string, { tokens: number; cost: number; runs: number }>;
}

/** One field of a service's form, as the server defines it (server/integrations.ts). */
export interface IntegrationField { k: string; label: string; secret: boolean; optional?: boolean; placeholder?: string; kind?: 'text' | 'url' | 'number' | 'email' }
/** A connected service as the server reports it. Never holds a secret. `config` holds the non-secret values (admins only). */
export interface IntegrationWire {
  id: string; name: string; connected: boolean; tail: string; status: '' | 'ok' | 'warn' | 'bad'; msg: string; testedAt: number | null;
  updatedAt: number | null; updatedBy: string; config: Record<string, string>;
  fields: IntegrationField[]; oauth: boolean; worksWithout: string; help: string;
}
/** One probe of an access check: where it was, and what DNS and HTTPS gave there. */
export interface ProbeWire { place: string; network: string; dns: string; http: string; ok: boolean }
/** The newest access check of a site, from inside its country (server/probe.ts). */
export interface AccessWire {
  siteId: string; domain: string; cc: string; at: number; result: 'ok' | 'blocked' | 'down' | 'error'; dns: string; http: string; summary: string; probes: ProbeWire[]; by: string;
}
/** DNS ownership of a site: the TXT record to add, and when it was found. */
export interface VerifyWire { siteId: string; domain: string; host: string; value: string; verifiedAt: number | null; by: string }
/** Search Console figures per site id (28 days and 7 days, ending about 3 days ago). */
export interface MetricsWire { at: number; sites: Record<string, { clicks28: number; impressions28: number; position28: number; clicks7: number; property: string; to: string }> }

/** Body of POST /api/requests. Who asked comes from the session. */
export interface NewRequestBody {
  siteId: string; domain: string; country: string; lang: string; siteTopic: string; topic: string; goal: string; model: string;
}

/** An alert the server raised that the bell shows (GET /api/notifications): a domain blocked or down, the daily
    budget, the weekly report sent. `key` is the server's own name for the event; `link` is the screen it points to. */
export interface BellAlertWire { id: number; key: string; event: string; site: string | null; title: string; body: string; link: string; at: number }

export interface LiveState {
  seoTasks?: Record<number, SeoTaskWire>;
  /** The Meridian server answered GET /api/state. */
  on: boolean;
  /** The first state was applied. */
  ready: boolean;
  engine: EngineStatus | null;
  /** Requests by server id. */
  reqs: Record<number, ServerRequest>;
  /** Articles by server id. */
  arts: Record<number, ServerArticle>;
  /** "rid:finishedAt" (requests) and "a<id>:finishedAt" (articles) keys already written to the job log. */
  logged: string[];
  /** Connected services by id, as the server reports them. */
  ints: Record<string, IntegrationWire>;
  /** The newest access check per site id. */
  access: Record<string, AccessWire>;
  /** DNS ownership per site id. */
  verify: Record<string, VerifyWire>;
  /** Search Console figures, or null when it is not connected. */
  metrics: MetricsWire | null;
  /** The redirect URI to register for Google sign-in. */
  redirectUri: string;
  /** Website builds by id. */
  builds: Record<number, BuildWire>;
  /** Each site's own domain on Cloudflare Pages, by site id (domains.ts). */
  domains: Record<string, DomainWire>;
  /** The server's alerts for the bell (liveAlerts.ts); absent until they were loaded. */
  alerts?: BellAlertWire[];
  /** Spend and tokens from the server's ledger; null until the server sent them (and for a native reviewer). */
  spend: SpendWire | null;
  /** Workflow runs by id, and each schedule's times by schedule id (liveWorkflows.ts). */
  workflows: Record<number, WorkflowWire>;
  schedDue: Record<string, ScheduleDueWire>;
}

export interface WorkflowRun { name: string; site: string; step: number }

/** The steps of a real "Weekly content" run, in order (server/workflows.ts). */
export type WorkflowStep = 'research' | 'write' | 'review' | 'build' | 'approve' | 'deploy' | 'done';
/** What a running workflow waits for: an agent's job, a person's decision, the site's daily budget, or room in the queue. */
export interface WorkflowWait { kind: 'agent' | 'person' | 'budget' | 'queue'; text: string; detail?: string }
/** One workflow run as the server sends it (GET /api/workflows, the `workflow` event). */
export interface WorkflowWire {
  id: number; kind: string; name: string; siteId: string; domain: string;
  /** The schedule that started it, or '' for "Run workflow". `by` is the person, or "Schedule". */
  scheduleId: string; by: string; topic: string; n: number;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  step: WorkflowStep; stepAt: number;
  wait: WorkflowWait | null;
  /** The jobs it queued: the research request, the articles and the website build. */
  requestId: number | null; articles: number[]; buildId: number | null;
  /** How it ended, in a sentence; `error` when it failed. */
  outcome: string; error: string;
  log: JobStep[];
  createdAt: number; updatedAt: number; finishedAt: number | null;
}
/** A schedule's times on the server: when it starts next, the slot it last dealt with and why that one did not start a run. */
export interface ScheduleDueWire { id: string; siteId: string; zone: string; nextDue: number | null; lastDue: number | null; note: string; noteAt: number }
/** GET /api/workflows, and `workflows` of GET /api/state (null for a native reviewer). */
export interface WorkflowsWire { runs: WorkflowWire[]; schedules: ScheduleDueWire[] }

export type UserRole = 'Admin' | 'Editor' | 'Native reviewer' | 'Viewer';
/**
 * A person on the team. In demo mode these are the sample people; otherwise they come from the server (admins only):
 * accounts (`st` Active or Disabled) and open invitations (`st` Invited, `invite` set, `expires` when the link stops working).
 */
export interface User {
  id: string; name: string; email: string; role: UserRole; scope: string; st: 'Active' | 'Invited' | 'Disabled';
  /** The reviewer's site id (server people). */
  site?: string | null;
  /** 2-step verification is on (server people). */
  twofa?: boolean;
  /** An open invitation rather than an account. */
  invite?: boolean;
  expires?: number;
}

export interface Notification {
  id: number;
  t: Date;
  k: PillKind;
  icon: string;
  title: string;
  body: string;
  view: ViewId;
  /** The tab of that view a click opens (an alias id), when the notification is about one tab. */
  to?: AliasId;
  read: boolean;
  /** Derived from a server event (liveNotifs.ts): its stable key. Absent for one made in this browser. */
  key?: string;
  /** The article it is about: a click selects it in Article review. */
  art?: Article['id'];
}

/* ---------- MOD tables ---------- */

export type ModId =
  | 'research' | 'keywords' | 'architecture' | 'content' | 'seo' | 'aio' | 'cta'
  | 'factory' | 'themes' | 'experiments' | 'gsc' | 'ga4' | 'rank';

/** A status pill inside a table cell: the prototype's P(kind, text, live). */
export interface ModPill { pill: PillKind; text: string; live?: boolean }
/** A cell is text, a pill, or a short sequence of both (text followed by a pill). */
export type ModCell = string | ModPill | (string | ModPill)[];
export interface ModRow {
  /** Site id. */
  s: string;
  c: ModCell[];
  /** Row added from a finished live keyword request. */
  live?: boolean;
  /** Domain of that request, shown when the site is not in the store. */
  domain?: string;
}
export interface ModTable {
  /** Description shown as the lede. */
  d: string;
  cols: string[];
  /** Indexes of numeric columns (in `cols`, before the Site column is inserted). */
  num?: number[];
  rows: ModRow[];
}

/* ---------- Shell state ---------- */

export interface SnackState { seq: number; msg: string; icon: string }

export type ConfirmKind = 'ag' | 'site' | 'rb' | 'key' | 'all' | 'user' | 'art' | 'inv';
/** "ag:<agent id>", "site:<site id>", "rb:<deploy id>", "key:<integration id>", "all:pause", "user:<user id>", "art:<article id>", "inv:<invite id>". */
export type ConfirmKey = `${ConfirmKind}:${string}`;
export interface ConfirmState { key: ConfirmKey; kind: ConfirmKind; id: string; title: string; body: string; label: string }

export type PopId = 'notif' | 'menu';
export type Theme = 'light' | 'dark';

/** Jobs that finished in the last simulation tick; the Workspace animates a page flying from `from` to `to`. */
export interface Handoff { seq: number; pairs: { from: string; to: string | null }[] }

/** Saving the workspace to the server: whether it was loaded, and the last save error (shown until a retry works). */
export interface SyncState { loaded: boolean; error: string }

/* ---------- App state ---------- */

/** Domain data plus the shell state every screen shares. Screen-specific state lives in the slices. */
export interface AppState {
  /**
   * Demo mode: the state was built from the sample data and the simulation invents activity. Purely in this browser:
   * nothing is loaded from or saved to the server. Off: the workspace from the server, only real things.
   */
  sample: boolean;
  sites: Site[];
  agents: Agent[];
  skills: Skill[];
  approvals: Approval[];
  articles: Article[];
  /** Counter for generated sample articles (the prototype's artN). */
  artN: number;
  log: LogEntry[];
  ints: Integration[];
  settings: Settings;
  schedules: Schedule[];
  deploys: Deploy[];
  np: NotifyPrefs;
  sessions: DeviceSession[];
  jobLog: JobRun[];
  kwReqs: KwRequest[];
  live: LiveState;
  runs: WorkflowRun[];
  users: User[];
  notifs: Notification[];
  /** Keys of the live notifications the person has read (liveNotifs.ts), kept on the server per person. */
  notifRead: string[];
  mod: Record<ModId, ModTable>;
  /** Id counter shared by everything created at run time (the prototype's uid). */
  uid: number;

  session: AuthSession | null;
  /** What the signed-out screen shows: first run, sign-in, still asking, or the server is not reachable. */
  auth: AuthPhase;
  /** A note on the sign-in screen, for example why the person was signed out. */
  loginNote: string;
  /** Loading and saving the workspace (sync.ts). */
  sync: SyncState;

  /** Site filter in the top bar: "all" or a site id (the prototype's state.site). */
  siteFilter: string;
  /** Page index per list key (the prototype's state.pg). */
  pg: Record<string, number>;
  /** Articles published without review this session. */
  autoPub: number;
  /** The "API key is missing" notification was already sent. */
  keyWarned: boolean;

  /** Explicit theme, or null to follow the operating system. */
  theme: Theme | null;
  /** The message in the snackbar, or null. Set it with the snack() action. */
  snackMsg: SnackState | null;
  confirm: ConfirmState | null;
  pop: PopId | null;
  searchOpen: boolean;
  navOpen: boolean;
  handoff: Handoff;
}

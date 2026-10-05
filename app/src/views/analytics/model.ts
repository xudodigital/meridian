/* The numbers behind the Analytics overview, as plain functions (no store, no DOM) so each rule can be tested:
   one row per site, the "Needs attention" insights, the bubble chart's geometry, the ranked list, each agent's share
   of today's tokens and the budget list. Outside demo mode everything comes from Search Console (site.clicks) and the
   server's spend ledger (store/spend.ts); demo mode uses the simulation's numbers and estimates 28-day spend from
   tokens at list price, because the sample data has no ledger. */
import { costOf, fmt, totalTok } from '@/store/rules';
import { LEDGER_AGENT, tokensText, usd } from '@/store/spend';
import type { Agent, AppState, SiteAccess } from '@/store/types';

/** What a site's colour says on the chart: blocked beats budget, because nobody can read a blocked site. */
export type SiteTone = 'ok' | 'near' | 'blocked';

export interface SiteRow {
  id: string; domain: string; cc: string; access: SiteAccess;
  /** Organic clicks, 28 days. */
  clicks: number;
  /** Agent spend today in USD, and as a percentage of the daily budget (not capped). */
  today: number; pct: number;
  /** Agent spend in USD and tokens used, 28 days. */
  spend28: number; tokens28: number;
  tone: SiteTone;
}

export const TONE_LABEL: Readonly<Record<SiteTone, string>> = { ok: 'Within budget', near: 'Over 80% of budget', blocked: 'Blocked or not reachable' };

type RowsState = Pick<AppState, 'sites' | 'siteFilter' | 'sample' | 'live' | 'settings' | 'agents'>;

/** The daily budget per site: what the server enforces, or the saved setting until it has said (and in demo mode). */
export const budgetOf = (s: Pick<AppState, 'sample' | 'live' | 'settings'>): number => (s.sample ? null : s.live.spend?.budget) ?? s.settings.budget;

/** Demo mode only: USD per million tokens across the agents' current models, to turn 28-day tokens into a cost. */
export function blendedRate(agents: readonly Pick<Agent, 'tokens' | 'model'>[]): number {
  const tk = totalTok({ agents: agents as Agent[] });
  return tk > 0 ? agents.reduce((n, a) => n + costOf(a.tokens, a.model), 0) / tk * 1e6 : 9;
}

export function siteRows(s: RowsState): SiteRow[] {
  const budget = budgetOf(s);
  const rate = s.sample ? blendedRate(s.agents) : 0;
  return s.sites.filter(x => s.siteFilter === 'all' || s.siteFilter === x.id).map(x => {
    const led = s.sample ? undefined : s.live.spend?.sites[x.id];
    const today = s.sample ? x.spend : led?.today ?? 0;
    const tokens28 = s.sample ? x.tok28 * 1e6 : led?.tokens28 ?? 0;
    const spend28 = s.sample ? x.tok28 * rate : led?.d28 ?? 0;
    const pct = budget > 0 ? today / budget * 100 : 0;
    const tone: SiteTone = x.access === 'blocked' || x.access === 'down' ? 'blocked' : pct >= 80 ? 'near' : 'ok';
    return { id: x.id, domain: x.domain, cc: x.cc, access: x.access, clicks: x.clicks, today, pct, spend28, tokens28, tone };
  });
}

const sum = <T>(a: readonly T[], f: (x: T) => number): number => a.reduce((n, x) => n + f(x), 0);
const plural = (n: number, one: string, many: string): string => n === 1 ? one : many;
/** "kopi.example", "kopi.example and teh.example", "a, b, c and 4 more". */
export function names(domains: readonly string[], max = 3): string {
  if (domains.length <= 1) return domains[0] ?? '';
  if (domains.length <= max) return domains.slice(0, -1).join(', ') + ' and ' + domains[domains.length - 1];
  return domains.slice(0, max).join(', ') + ` and ${domains.length - max} more`;
}

/* ---------- Totals for the KPI strip ---------- */

export interface Totals {
  sites: number; clicks: number; withClicks: number; today: number; budgetAll: number; todayPct: number; spend28: number; tokens28: number;
  /** Organic clicks per USD of agent spend over 28 days; null while either side is missing. */
  perUsd: number | null;
}
export function totals(rows: readonly SiteRow[], budget: number): Totals {
  const clicks = sum(rows, r => r.clicks), spend28 = sum(rows, r => r.spend28), today = sum(rows, r => r.today), budgetAll = budget * rows.length;
  return {
    sites: rows.length, clicks, withClicks: rows.filter(r => r.clicks > 0).length, today, budgetAll,
    todayPct: budgetAll > 0 ? today / budgetAll * 100 : 0, spend28, tokens28: sum(rows, r => r.tokens28),
    perUsd: clicks > 0 && spend28 > 0 ? clicks / spend28 : null,
  };
}
/** Dollars with two decimals, and thousands separators from $1,000 up: "$0.36", "$3,000.00". */
export const money = (n: number): string => n >= 1000 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : usd(n);
/** "1,284" for a ratio people read as a count; one decimal under ten. */
export const ratioText = (n: number): string => n >= 10 ? fmt(Math.round(n)) : n.toFixed(1);

/* ---------- Needs attention ---------- */

export type InsightId = 'stopped' | 'near' | 'blocked' | 'down' | 'noclicks' | 'gsc';
/** Where the card's button leads: a view, or the Search Console tab of this screen. */
export type InsightTarget = 'settings' | 'deploy' | 'integrations' | 'gsc';
export interface Insight {
  id: InsightId; tone: 'bad' | 'warn' | 'info'; icon: string; title: string; body: string;
  /** The sites the card is about. */
  sites: string[];
  action: { label: string; to: InsightTarget } | null;
}
export interface InsightContext {
  budget: number;
  /** Search Console is connected (always true in demo mode). */
  gsc: boolean;
  /** The person may change Settings and Integrations. */
  admin: boolean;
  /** Jobs of stopped sites that wait for budget. */
  held?: number;
}

/**
 * What needs a person, worst first: sites stopped at 100% of the budget, sites over 80%, sites blocked or not
 * reachable in their country, and sites the agents spent on that have no clicks. Without Search Console clicks are
 * unknown, not zero, so that last card becomes "connect Search Console". Empty means all clear.
 */
export function insights(rows: readonly SiteRow[], c: InsightContext): Insight[] {
  const out: Insight[] = [];
  const dom = (a: readonly SiteRow[]) => a.map(r => r.domain);
  const fix = c.admin ? { label: 'Open Settings', to: 'settings' as const } : null;
  const stopped = rows.filter(r => r.pct >= 100).sort((a, b) => b.pct - a.pct);
  if (stopped.length) {
    const one = stopped.length === 1, held = c.held ?? 0;
    out.push({
      id: 'stopped', tone: 'bad', icon: 'savings', sites: dom(stopped),
      title: `${one ? stopped[0].domain + ' has' : stopped.length + ' sites have'} used the daily budget of ${usd(c.budget)}.`,
      body: `New agent jobs for ${one ? 'it' : 'them'} are refused${held ? ` and ${held} waiting job${held === 1 ? ' is' : 's are'} held` : ''} until midnight. `
        + (c.admin ? 'Raise the budget to start them now.' : 'An admin can raise the budget in Settings to start them now.'),
      action: fix,
    });
  }
  const near = rows.filter(r => r.pct >= 80 && r.pct < 100).sort((a, b) => b.pct - a.pct);
  if (near.length) {
    const one = near.length === 1;
    out.push({
      id: 'near', tone: 'warn', icon: 'data_usage', sites: dom(near),
      title: `${one ? near[0].domain + ' is' : near.length + ' sites are'} over 80% of the daily budget.`,
      body: `${names(near.map(r => `${r.domain} (${Math.floor(r.pct)}%)`))}. Agent jobs stop at 100% until midnight.`
        + (c.admin ? '' : ' An admin can raise the budget in Settings.'),
      action: fix,
    });
  }
  const access = (id: 'blocked' | 'down', verb: string, why: string) => {
    const hit = rows.filter(r => r.access === id).sort((a, b) => b.clicks - a.clicks);
    if (!hit.length) return;
    const one = hit.length === 1;
    out.push({
      id, tone: 'bad', icon: id === 'blocked' ? 'gpp_bad' : 'cloud_off', sites: dom(hit),
      title: `${one ? hit[0].domain + ' is' : hit.length + ' sites are'} ${verb} in ${one ? 'its' : 'their'} country.`,
      body: `${one ? '' : names(dom(hit)) + '. '}${why}`,
      action: { label: 'Open Build and deploy', to: 'deploy' },
    });
  };
  access('blocked', 'blocked', 'Readers there cannot open the site, so clicks will fall.');
  access('down', 'not reachable', 'The last check from inside the country got no answer.');
  const spent = rows.filter(r => r.spend28 > 0);
  if (c.gsc) {
    const none = spent.filter(r => r.clicks === 0).sort((a, b) => b.spend28 - a.spend28);
    if (none.length) {
      const one = none.length === 1;
      out.push({
        id: 'noclicks', tone: 'warn', icon: 'ads_click', sites: dom(none),
        title: `${one ? none[0].domain + ' has' : none.length + ' sites have'} agent spend but no clicks.`,
        body: `${names(none.map(r => `${r.domain} (${usd(r.spend28)})`))} in 28 days, with no organic clicks yet. Check what the ${plural(none.length, 'site ranks', 'sites rank')} for.`,
        action: { label: 'Open Search Console', to: 'gsc' },
      });
    }
  } else if (spent.length) {
    out.push({
      id: 'gsc', tone: 'info', icon: 'query_stats', sites: [],
      title: 'Clicks are not measured yet.',
      body: `Agents spent ${usd(sum(spent, r => r.spend28))} in 28 days, but without Search Console nobody can tell what that brought in.`
        + (c.admin ? '' : ' An admin can connect it in Integrations.'),
      action: c.admin ? { label: 'Connect Search Console', to: 'integrations' } : null,
    });
  }
  return out;
}

/* ---------- Traffic against cost: the bubble chart ---------- */

export type LabelAnchor = 'start' | 'end' | 'middle';
/** The four corners of the chart, in plain words. */
export const QUADRANT = { tl: 'High traffic, low cost', tr: 'High traffic, high cost', bl: 'Low traffic, low cost', br: 'Costly, little traffic' } as const;
export interface Tick { v: number; at: number; text: string }
export interface Bubble {
  row: SiteRow; x: number; y: number; r: number;
  /** The label drawn beside the bubble, when it is one of the few that get one. */
  label: { x: number; y: number; anchor: LabelAnchor } | null;
}
export interface ScatterLayout {
  w: number; h: number;
  plot: { l: number; t: number; r: number; b: number };
  /** Draw order: largest first, so a small bubble is never hidden under a large one. */
  bubbles: Bubble[];
  /** Keyboard order: most clicks first. */
  order: string[];
  xTicks: Tick[]; yTicks: Tick[];
  /** The quadrant guides: the median spend and the median clicks of the plotted sites, in pixels. */
  xMid: number; yMid: number;
  /** Whether the median lines are drawn (five sites or more), and the quadrant names that have room. */
  guides: boolean;
  quads: { key: string; text: string; x: number; y: number; anchor: 'start' | 'end' }[];
  /** Sites with neither clicks nor spend, which have no place on the chart. */
  hidden: number;
}

/** 1, 2, 2.5, 5 or 10 times a power of ten: the nearest such number at or above `v`. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
const niceRound = (v: number): number => {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  return (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.75 ? 2.5 : m < 7.5 ? 5 : 10) * p;
};
const median = (a: readonly number[]): number => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 : 0; };
const compact = (n: number): string => n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? +(n / 1e3).toFixed(1) + 'k' : String(+n.toFixed(n < 10 && n % 1 ? 1 : 0));

/** The sites that have a place on the chart: any clicks or any spend in 28 days. */
export const plotted = (rows: readonly SiteRow[]): SiteRow[] => rows.filter(r => r.clicks > 0 || r.spend28 > 0);

/**
 * How the centrepiece is drawn. A bubble chart needs both measures and at least three sites to say anything; with
 * fewer (or with no clicks or no spend at all) the same numbers are shown as a per-site comparison, and with nothing
 * measured there is only an empty state.
 */
export type CentreMode = 'scatter' | 'compare' | 'empty';
export function centreMode(rows: readonly SiteRow[]): CentreMode {
  const p = plotted(rows);
  if (!p.length) return 'empty';
  return p.length >= 3 && p.some(r => r.clicks > 0) && p.some(r => r.spend28 > 0) ? 'scatter' : 'compare';
}

/** Width of a label in pixels at the chart's 12px label size: close enough to keep labels off each other. */
const textW = (t: string): number => t.length * 6.6 + 4;
const MAX_LABELS = 6;
/** Fewer sites than this have no meaningful median, so the quadrant guides are left out. */
export const MIN_GUIDES = 5;

/**
 * Positions for a chart of `w` by `h` pixels. Both axes use a square-root scale, which keeps zero on the chart (a
 * site with spend and no clicks sits on the baseline) and stops a few large sites from pressing the rest into a
 * corner. Bubble area follows tokens. Labels go to the outliers only: most clicks, most spend, then anything that
 * needs attention, each kept only if it does not run into a label already placed.
 */
export function scatterLayout(rows: readonly SiteRow[], w: number, h: number): ScatterLayout {
  const pts = plotted(rows);
  const narrow = w < 520;
  const plot = { l: narrow ? 40 : 52, t: 28, r: w - 16, b: h - 44 };
  const xMax = niceCeil(Math.max(...pts.map(r => r.spend28), 0.01) * 1.04), yMax = niceCeil(Math.max(...pts.map(r => r.clicks), 1) * 1.04);
  const px = (v: number) => plot.l + Math.sqrt(Math.max(0, v) / xMax) * (plot.r - plot.l);
  const py = (v: number) => plot.b - Math.sqrt(Math.max(0, v) / yMax) * (plot.b - plot.t);
  const ticks = (max: number, to: (v: number) => number, text: (v: number) => string): Tick[] => {
    const vs = [0, ...[0.0625, 0.25, 0.5625].map(f => niceRound(max * f)), max];
    return [...new Set(vs)].sort((a, b) => a - b).map(v => ({ v, at: to(v), text: text(v) }));
  };
  const tMax = Math.max(...pts.map(r => r.tokens28), 1);
  const [rMin, rMax] = pts.length > 40 ? [3.5, narrow ? 10 : 13] : narrow ? [5, 14] : [6, 20];
  const bubbles: Bubble[] = pts.map(row => ({ row, x: px(row.spend28), y: py(row.clicks), r: rMin + Math.sqrt(row.tokens28 / tMax) * (rMax - rMin), label: null }));

  /* Who gets a label: with few sites everyone, otherwise the outliers. */
  const by = (f: (r: SiteRow) => number) => [...bubbles].sort((a, b) => f(b.row) - f(a.row));
  const want: Bubble[] = pts.length <= MAX_LABELS ? by(r => r.clicks)
    : [...by(r => r.clicks).slice(0, 3), ...by(r => r.spend28).slice(0, 2), ...by(r => r.pct).filter(b => b.row.tone !== 'ok').slice(0, 2)];
  /* A label may not cover a bubble, a quadrant name or another label. It is tried right, left, above and below. */
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const hits = (p: Box, q: Box) => p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0;
  const quad = (text: string, left: boolean, top: boolean): Box => {
    const tw = textW(text), x0 = left ? plot.l + 4 : plot.r - 8 - tw, y0 = top ? plot.t + 2 : plot.b - 22;
    return { x0, x1: x0 + tw + 4, y0, y1: y0 + 20 };
  };
  const dots: (Box & { id: string })[] = bubbles.map(b => ({ id: b.row.id, x0: b.x - b.r, x1: b.x + b.r, y0: b.y - b.r, y1: b.y + b.r }));
  /* A quadrant name is dropped where a bubble sits on it: the site matters more than the caption. */
  const guides = pts.length >= MIN_GUIDES;
  const corners = (!guides ? [] : [['tl', true, true], ['br', false, false], ...(narrow ? [] : [['tr', false, true], ['bl', true, false]])] as [keyof typeof QUADRANT, boolean, boolean][])
    .map(([key, left, top]) => ({ key, left, top, box: quad(QUADRANT[key], left, top) }))
    .filter(c => !dots.some(d => hits(c.box, d)));
  const placed: Box[] = [];
  const few = pts.length <= MAX_LABELS;
  let n = 0;
  for (const b of want) {
    if (b.label || n >= MAX_LABELS) continue;
    const tw = textW(b.row.domain), g = b.r + 6;
    const tries: { x: number; y: number; anchor: LabelAnchor; box: Box }[] = [
      { x: b.x + g, y: b.y, anchor: 'start', box: { x0: b.x + g, x1: b.x + g + tw, y0: b.y - 9, y1: b.y + 9 } },
      { x: b.x - g, y: b.y, anchor: 'end', box: { x0: b.x - g - tw, x1: b.x - g, y0: b.y - 9, y1: b.y + 9 } },
      { x: b.x, y: b.y - g - 6, anchor: 'middle', box: { x0: b.x - tw / 2, x1: b.x + tw / 2, y0: b.y - g - 15, y1: b.y - g + 3 } },
      { x: b.x, y: b.y + g + 6, anchor: 'middle', box: { x0: b.x - tw / 2, x1: b.x + tw / 2, y0: b.y + g - 3, y1: b.y + g + 15 } },
    ];
    const inside = (t: Box) => t.x0 >= plot.l + 2 && t.x1 <= w - 2 && t.y0 >= 0 && t.y1 <= plot.b - 2;
    /* With a handful of sites every one is named, and the site with the most clicks always is, so those labels may
       sit on a neighbour's bubble rather than be dropped. */
    const ok = tries.find(t => inside(t.box) && !placed.some(p => hits(t.box, p)) && !corners.some(c => hits(t.box, c.box)) && !dots.some(d => d.id !== b.row.id && hits(t.box, d)))
      ?? (few || b === want[0] ? tries.find(t => inside(t.box) && !placed.some(p => hits(t.box, p)) && !corners.some(c => hits(t.box, c.box))) : undefined);
    if (!ok) continue;
    b.label = { x: ok.x, y: ok.y, anchor: ok.anchor }; placed.push(ok.box); n++;
  }
  return {
    w, h, plot,
    bubbles: [...bubbles].sort((a, b) => b.r - a.r),
    order: by(r => r.clicks).map(b => b.row.id),
    xTicks: ticks(xMax, px, v => '$' + compact(v)), yTicks: ticks(yMax, py, compact),
    xMid: px(median(pts.map(r => r.spend28))), yMid: py(median(pts.map(r => r.clicks))),
    guides,
    quads: corners.map(c => ({ key: c.key, text: QUADRANT[c.key], x: c.left ? plot.l + 8 : plot.r - 8, y: c.top ? plot.t + 14 : plot.b - 8, anchor: c.left ? 'start' as const : 'end' as const })),
    hidden: rows.length - pts.length,
  };
}

/** One sentence per bubble, for a screen reader and the tooltip's hidden twin. */
export const bubbleLabel = (r: SiteRow): string =>
  `${r.domain}, ${r.cc}: ${fmt(r.clicks)} clicks, ${usd(r.spend28)} agent spend and ${tokensText(r.tokens28)} tokens in 28 days. ${TONE_LABEL[r.tone]}.`;

/* ---------- Top sites: one ranked list ---------- */

export interface RankItem { id: string; cc: string; domain: string; value: number; share: number; text: string; secondary: string }
export interface Ranking {
  /** Ranked by clicks when any site has clicks, otherwise by 28-day agent spend. */
  metric: 'clicks' | 'spend';
  items: RankItem[];
  /** The sites below the top 8, as one total. */
  other: { n: number; share: number; text: string; secondary: string } | null;
  total: number;
}
export function topSites(rows: readonly SiteRow[], limit = 8): Ranking {
  const metric: Ranking['metric'] = rows.some(r => r.clicks > 0) ? 'clicks' : 'spend';
  const val = (r: SiteRow) => metric === 'clicks' ? r.clicks : r.spend28;
  const text = (v: number) => metric === 'clicks' ? fmt(v) : usd(v);
  const second = (spend: number, tokens: number) => metric === 'clicks' ? usd(spend) : tokensText(tokens) + ' tokens';
  const total = sum(rows, val);
  const sorted = rows.filter(r => val(r) > 0).sort((a, b) => val(b) - val(a) || a.domain.localeCompare(b.domain));
  const top = sorted.slice(0, limit), top_ids = new Set(top.map(r => r.id)), rest = rows.filter(r => !top_ids.has(r.id));
  const share = (v: number) => total > 0 ? v / total * 100 : 0;
  return {
    metric, total,
    items: top.map(r => ({ id: r.id, cc: r.cc, domain: r.domain, value: val(r), share: share(val(r)), text: text(val(r)), secondary: second(r.spend28, r.tokens28) })),
    other: top.length && rest.length ? { n: rest.length, share: share(sum(rest, val)), text: text(sum(rest, val)), secondary: second(sum(rest, r => r.spend28), sum(rest, r => r.tokens28)) } : null,
  };
}
/** "12%", "<1%" for a share that would round to nothing, "0%" for none. */
export const shareText = (p: number): string => p <= 0 ? '0%' : p < 1 ? '<1%' : Math.round(p) + '%';

/* ---------- Token use by agent, today ---------- */

export interface AgentUse { id: string; name: string; hue: number; model: string; tokens: number; cost: number; runs?: number }
export interface AgentShare extends AgentUse { share: number; top: boolean }

/** Today's tokens per agent: the simulation's in demo mode, the ledger's otherwise (only agents that ran a job). */
export function agentUse(s: Pick<AppState, 'agents' | 'sample' | 'live'>): AgentUse[] {
  if (s.sample) return s.agents.filter(a => a.tokens > 0).map(a => ({ id: a.id, name: a.name, hue: a.hue, model: a.model, tokens: a.tokens, cost: costOf(a.tokens, a.model) }));
  const led = s.live.spend?.agents;
  return s.agents.flatMap(a => {
    const u = led?.[LEDGER_AGENT[a.id] ?? ''];
    return u && (u.tokens > 0 || u.cost > 0) ? [{ id: a.id, name: a.name, hue: a.hue, model: a.model, tokens: u.tokens, cost: u.cost, runs: u.runs }] : [];
  });
}
/** Each agent's share of the tokens, largest first. The shares add up to 100; the largest is marked when there is more than one. */
export function agentShares(use: readonly AgentUse[]): AgentShare[] {
  const total = sum(use, u => u.tokens);
  const sorted = [...use].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  return sorted.map((u, i) => ({ ...u, share: total > 0 ? u.tokens / total * 100 : 0, top: i === 0 && sorted.length > 1 && u.tokens > 0 }));
}

/* ---------- Spend today against the daily budget ---------- */

export interface BudgetList {
  /** Highest percentage first; at most 8, the sites at 50% or more ahead of the rest by that same order. */
  shown: SiteRow[];
  over80: number; stopped: number;
  /** Sites that spent today and are not listed. */
  more: number;
  summary: string;
}
export function budgetList(rows: readonly SiteRow[], limit = 8): BudgetList {
  const spent = rows.filter(r => r.today > 0).sort((a, b) => b.pct - a.pct || a.domain.localeCompare(b.domain));
  const over80 = spent.filter(r => r.pct >= 80).length, stopped = spent.filter(r => r.pct >= 100).length;
  const half = spent.filter(r => r.pct >= 50);
  /* A long list shows only the sites past half their budget; a short one shows everything that spent. */
  const shown = (spent.length > limit && half.length ? half : spent).slice(0, limit);
  const summary = !over80 ? `No site is over 80% of its budget.`
    : `${over80} ${plural(over80, 'site is', 'sites are')} over 80%. ${!stopped ? 'None has stopped.' : stopped === over80 ? (stopped === 1 ? 'It has stopped.' : 'All have stopped.') : `${stopped} ${plural(stopped, 'has', 'have')} stopped.`}`;
  return { shown, over80, stopped, more: spent.length - shown.length, summary };
}

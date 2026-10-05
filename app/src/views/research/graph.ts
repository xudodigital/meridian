/* The Internal link engine's graph model: the prototype's buildGraph() and GTYPE, lines 1714-1744.
   Pure: it reads a state snapshot and returns plain data. The canvas engine (graphEngine.ts) animates a copy. */
import { seeded, siteById } from '@/store/rules';
import type { GraphMode } from '@/store/slices/research';
import type { AppState, Site, SiteLinksWire } from '@/store/types';

export type NodeType = 'home' | 'pillar' | 'category' | 'page' | 'orphan' | 'site' | 'agentOn' | 'agent' | 'skill';

/** Per node type: [colour custom property, radius, glows and gets a label, name in the legend]. */
export const GTYPE: Readonly<Record<NodeType, readonly [color: string, radius: number, glow: boolean, name: string]>> = {
  home: ['--graph-b', 11, true, 'Home'], pillar: ['--graph-b', 8, true, 'Pillar page'], category: ['--graph-b', 8, true, 'Category'], page: ['--graph-a', 3.5, false, 'Article'],
  orphan: ['--graph-warn', 4.5, false, 'Orphan page'], site: ['--graph-c', 9, true, 'Site'], agentOn: ['--graph-a', 8, true, 'Working agent'],
  agent: ['--graph-line', 6, false, 'Other agent'], skill: ['--graph-ok', 3.5, false, 'Skill'],
};

export interface GraphNode {
  /** Index in `nodes`. */
  id: number;
  label: string;
  type: NodeType;
  /** Starting position, in graph units around (0, 0). */
  x: number;
  y: number;
  /** Number of edges. */
  deg: number;
  /** Silo index (link mode), -1 home, -2 orphans; 0 sites, 1 agents, 2 skills (agent mode). */
  g: number;
  /** Real graphs: what the info panel says after the label, instead of the sample's sentence. */
  info?: string;
  /** Real graphs: the server id of the article the node stands for. */
  article?: number;
}
/** An edge between two node indexes, with its rest length. */
export interface GraphEdge { a: number; b: number; len: number }
/** A group in the list beside the canvas. */
export interface GraphGroup { label: string; items: number[] }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; groups: GraphGroup[]; note: string }

type GraphInput = Pick<AppState, 'sites' | 'siteFilter' | 'agents' | 'skills'>;

/** The site the link graph shows: the filtered site, else the first one. */
export const linkSite = (s: Pick<AppState, 'sites' | 'siteFilter'>): Site | undefined =>
  (s.siteFilter === 'all' ? undefined : siteById(s, s.siteFilter)) || s.sites[0];

/**
 * Changes when the graph must be built again: the mode, the site filter and the site's silos (link mode), or the
 * agents, their skills and the skill names (agent mode). Like the prototype, the simulation tick does not rebuild it.
 */
export function graphKey(s: GraphInput, mode: GraphMode): string {
  if (mode === 'link') {
    const site = linkSite(s);
    return ['link', s.siteFilter, site ? site.id + ':' + site.domain + ':' + site.silos.join('/') : ''].join('|');
  }
  return ['agent', s.agents.map(a => a.id + ':' + a.name + ':' + a.skills.join(',')).join(';'), s.skills.map(k => k.id + ':' + k.name).join(';')].join('|');
}

export function buildGraph(s: GraphInput, mode: GraphMode): Graph {
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], groups: GraphGroup[] = [];
  const N = (label: string, type: NodeType, g: number): GraphNode => { const n: GraphNode = { id: nodes.length, label, type, x: 0, y: 0, deg: 0, g }; nodes.push(n); return n; };
  const E = (a: GraphNode, b: GraphNode, len = 44) => { edges.push({ a: a.id, b: b.id, len }); a.deg++; b.deg++; };

  if (mode === 'link') {
    const site = linkSite(s);
    const note = s.siteFilter === 'all' && site ? `Showing ${site.domain}. Pick another site at the top; links are never created between sites.` : '';
    if (!site) return { nodes, edges, groups, note: 'There are no sites yet. Mapping the links between a site\'s pages is planned; the Agents tab shows how agents and skills connect today.' };
    if (!site.silos.length) return { nodes, edges, groups, note: `${site.domain} has no link map yet. Mapping the links between a site's pages is planned; the Agents tab shows how agents and skills connect today.` };
    const r = seeded([...site.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) + site.silos.length);
    const home = N('Home', 'home', -1); groups.push({ label: site.domain, items: [home.id] });
    const pillars: GraphNode[] = [];
    site.silos.forEach((name, i) => {
      const p = N(name, 'pillar', i); pillars.push(p); E(home, p, 130);
      const items = [p], k = 7 + Math.floor(r() * 9);
      for (let j = 1; j <= k; j++) {
        const n = N(`${name} · article ${j}`, 'page', i); items.push(n); E(p, n);
        if (r() < .28 && items.length > 2) E(n, items[1 + Math.floor(r() * (items.length - 2))], 36);
        if (r() < .07 && pillars.length > 1) E(n, pillars[Math.floor(r() * (pillars.length - 1))], 150);
      }
      groups.push({ label: name, items: items.map(x => x.id) });
    });
    const orph = [1, 2, 3].map(j => N(`Orphan page ${j}`, 'orphan', -2)); groups.push({ label: 'Orphan pages', items: orph.map(x => x.id) });
    nodes.forEach(n => {
      const ang = n.g < 0 ? r() * 6.28 : n.g / site.silos.length * 6.28;
      const d = n.type === 'home' ? 0 : n.type === 'orphan' ? 240 : n.type === 'pillar' ? 120 : 150 + r() * 40;
      n.x = Math.cos(ang) * d + r() * 30; n.y = Math.sin(ang) * d + r() * 30;
    });
    return { nodes, edges, groups, note };
  }

  const sN: Record<string, GraphNode> = {}, kN: Record<string, GraphNode> = {};
  s.sites.filter(x => s.agents.some(a => a.site === x.id)).forEach(x => { sN[x.id] = N(x.cc + ' · ' + x.domain, 'site', 0); });
  groups.push({ label: 'Sites', items: Object.values(sN).map(x => x.id) });
  const ag = s.agents.map(a => ({ a, n: N(a.name, a.status === 'work' ? 'agentOn' : 'agent', 1) }));
  const on = ag.find(x => x.a.id === 'orc')?.n;
  ag.forEach(({ a, n }) => {
    if (on && n !== on) E(on, n, 150);
    const site = a.site == null ? undefined : sN[a.site];
    if (a.status === 'work' && site) E(n, site, 95);
    a.skills.forEach(id => {
      const k = s.skills.find(x => x.id === id); if (!k) return;
      if (!kN[id]) kN[id] = N(k.name, 'skill', 2);
      E(n, kN[id], 70);
    });
  });
  groups.push({ label: 'Agents', items: ag.map(x => x.n.id) }); groups.push({ label: 'Attached skills', items: Object.values(kN).map(x => x.id) });
  const r = seeded(42);
  nodes.forEach(n => { const a = r() * 6.28, d = 90 + r() * 230; n.x = Math.cos(a) * d; n.y = Math.sin(a) * d; });
  return { nodes, edges, groups, note: 'A line to a site appears while an agent is working on it.' };
}

const STATUS: Record<string, string> = { approved: 'approved', review: 'waiting for review' };
const n1 = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** What to do about an article no other article links to. */
export const WRITE_A_LINK = 'Write a link: open a related article in Article review, select a few words that describe this one, and link them to it.';

/**
 * The real link graph of one site (server/links.ts): Home, its categories, and its articles in review or approved.
 * A line from Home to a category and from a category to its articles is the site's navigation (the category page
 * lists them); a line between two articles is a link in the text of one of them. An article no other article links
 * to is drawn as an orphan. The layout is worked out from the data alone, so the same site always looks the same.
 */
export function buildSiteGraph(d: SiteLinksWire): Graph {
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], groups: GraphGroup[] = [];
  const domain = d.domain || 'This site';
  if (!d.articles.length) return { nodes, edges, groups, note: `${domain} has no article in review or approved yet. Its link map appears here once it has one.` };
  const N = (label: string, type: NodeType, g: number, info: string, article?: number): GraphNode => {
    const n: GraphNode = { id: nodes.length, label, type, x: 0, y: 0, deg: 0, g, info, ...(article === undefined ? {} : { article }) }; nodes.push(n); return n;
  };
  const E = (a: GraphNode, b: GraphNode, len: number) => { edges.push({ a: a.id, b: b.id, len }); a.deg++; b.deg++; };
  const orphan = new Set(d.orphans), byId = new Map(d.articles.map(a => [a.id, a]));
  const home = N('Home', 'home', -1, ` · Home page of ${domain}. It links to every category and to the newest articles.`);
  groups.push({ label: domain, items: [home.id] });
  const nodeOf = new Map<number, GraphNode>();
  const article = (id: number, g: number): GraphNode | null => {
    const a = byId.get(id); if (!a) return null;
    const lone = orphan.has(id);
    const n = N(a.title, lone ? 'orphan' : 'page', g,
      ` · Article, ${STATUS[a.status] ?? a.status} · ${n1(a.in, 'link', 'links')} from other articles, ${n1(a.out, 'link', 'links')} to other articles.` + (lone ? ' No other article links here. ' + WRITE_A_LINK : ''), id);
    nodeOf.set(id, n); return n;
  };
  d.categories.forEach((k, i) => {
    const c = N(k.name, 'category', i, ` · Category page /${k.slug}/ · ${n1(k.articles.length, 'article', 'articles')}, ${k.approved} approved. It lists all of them.`);
    E(home, c, 130);
    const items = [c];
    for (const id of k.articles) { const n = article(id, i); if (n) { items.push(n); E(c, n, 48); } }
    groups.push({ label: k.name, items: items.map(x => x.id) });
  });
  const loose = d.uncategorized.map(id => article(id, d.categories.length)).filter((n): n is GraphNode => !!n);
  loose.forEach(n => E(home, n, 110));
  if (loose.length) groups.push({ label: 'No category', items: loose.map(n => n.id) });
  for (const l of d.links) { const a = nodeOf.get(l.from), b = nodeOf.get(l.to); if (a && b) E(a, b, 70); }
  const lonely = d.orphans.map(id => nodeOf.get(id)).filter((n): n is GraphNode => !!n);
  if (lonely.length) groups.push({ label: 'No link from another article', items: lonely.map(n => n.id) });
  /* Categories around Home, each article around its category. */
  const sectors = d.categories.length + (loose.length ? 1 : 0) || 1;
  const seen = new Map<number, number>();
  nodes.forEach(n => {
    if (n.type === 'home') return;
    const ang = (n.g + .5) / sectors * 6.28;
    if (n.type === 'category') { n.x = Math.cos(ang) * 130; n.y = Math.sin(ang) * 130; return; }
    const k = seen.get(n.g) ?? 0; seen.set(n.g, k + 1);
    const spread = ang + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * .22;
    n.x = Math.cos(spread) * (200 + (k % 3) * 22); n.y = Math.sin(spread) * (200 + (k % 3) * 22);
  });
  const links = d.links.length;
  return {
    nodes, edges, groups,
    note: `${n1(links, 'link', 'links')} between the articles of ${domain}. A line between two articles is a link in the text of one of them; lines from Home and from a category are the site's navigation. Links are never created between sites.`,
  };
}
/** Changes when the real graph must be built again. */
export const siteGraphKey = (d: SiteLinksWire | null): string => d ? JSON.stringify([d.siteId, d.articles.map(a => [a.id, a.title, a.status, a.category]), d.links.map(l => [l.from, l.to]), d.categories.map(k => k.name)]) : '';

/** Node types in order of first appearance, for the legend. */
export const usedTypes = (g: Graph): NodeType[] => [...new Set(g.nodes.map(n => n.type))];

/** The info panel text after the node's bold label (the prototype's info()). */
export function nodeInfo(n: GraphNode): string {
  if (n.info !== undefined) return n.info;
  const extra = n.type === 'orphan' ? ' No page links here yet. The Internal Linker can propose a link from a relevant pillar page.' : n.type === 'pillar' ? ' The pillar page for this silo.' : '';
  return ` · ${GTYPE[n.type][3]} · ${n.deg} connection${n.deg === 1 ? '' : 's'}.${extra}`;
}

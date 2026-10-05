/* Website builds (server/build-api.ts BuildWire): small pure derivations shared by serverFacts.ts and the Build and
   deploy screens. No store, no network. */
import { dayTime } from './rules';
import type { BuildWire } from './types';

/** The builds of a site for its current domain, newest first. */
export const siteBuilds = (builds: Readonly<Record<number, BuildWire>>, site: { id: string; domain: string }): BuildWire[] =>
  Object.values(builds).filter(b => b.siteId === site.id && b.domain === site.domain).sort((x, y) => y.version - x.version);

/** A build job that is queued or running. */
export const building = (b: Pick<BuildWire, 'status'>): boolean => b.status === 'queued' || b.status === 'work';
/** A deploy that is queued or running. */
export const deploying = (b: Pick<BuildWire, 'deploy'>): boolean => b.deploy === 'queued' || b.deploy === 'work';

/** The Sites and Build and deploy "Last deploy" text: the live version and when it went live, else an approved one. */
export function deployText(list: readonly BuildWire[]): string {
  const live = list.find(b => b.deploy === 'live');
  if (live) return `v${live.version} · ${dayTime(live.deployedAt ?? live.updatedAt)}`;
  const ok = [...list].sort((x, y) => y.version - x.version).find(b => b.review === 'approved');
  return ok ? `v${ok.version} approved, not live` : 'Never';
}

/**
 * Where an approved article is on its way to its site, from the site's builds: in the live version, in a version being
 * put live, in an approved version newer than the live one (not deployed, or its deploy failed), in a version waiting
 * for approval, or in none yet (the next build places it). The newest build that has it decides each case.
 */
export type ArticlePlace = { at: 'live' | 'deploying' | 'approved' | 'waiting'; b: BuildWire } | { at: 'next' };
export function articlePlace(builds: Readonly<Record<number, BuildWire>>, siteId: string, articleId: number): ArticlePlace {
  const ofSite = Object.values(builds).filter(b => b.siteId === siteId).sort((x, y) => y.version - x.version);
  const has = ofSite.filter(b => b.status === 'ready' && b.articles.includes(articleId));
  const live = has.find(b => b.deploy === 'live');
  if (live) return { at: 'live', b: live };
  const going = has.find(deploying);
  if (going) return { at: 'deploying', b: going };
  /* An approved version older than the live one is a roll back, not the way this article goes live. */
  const lv = ofSite.find(b => b.deploy === 'live')?.version ?? 0;
  const ok = has.find(b => b.review === 'approved' && b.version > lv && (b.deploy === '' || b.deploy === 'failed'));
  if (ok) return { at: 'approved', b: ok };
  const waiting = has.find(b => b.review === 'waiting');
  return waiting ? { at: 'waiting', b: waiting } : { at: 'next' };
}

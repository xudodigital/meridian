/** Only shipped skill IDs resolve to files. Display names and user data never become file paths. */
export const BUILTIN_SKILLS: Readonly<Record<string, string>> = {
  s1: 'serp-research', s2: 'keyword-research', s3: 'site-architecture', s4: 'article-writing',
  s5: 'on-page-audit', s6: 'ai-search-features', s7: 'internal-linking', s8: 'web-performance',
  s9: 'deploy-and-access-checks', s10: 'search-analytics', s11: 'material-3-web', s12: 'google-seo',
  s13: 'images-and-alt-text', s14: 'agent-orchestration',
};
/** Required guidelines remain in force even when a user removes their optional assignment. */
export const REQUIRED_SKILLS: Readonly<Record<string, readonly string[]>> = {
  res: ['serp-research', 'google-seo'], arc: ['site-architecture', 'google-seo'],
  seo: ['on-page-audit', 'ai-search-features', 'google-seo'], lnk: ['internal-linking', 'google-seo'],
  ana: ['search-analytics', 'google-seo'], gd: ['images-and-alt-text', 'material-3-web', 'google-seo'],
  kw: ['keyword-research', 'google-seo'], wr: ['article-writing', 'google-seo'],
  bld: ['material-3-web', 'web-performance', 'images-and-alt-text'],
};
export function executionSkills(agent: string, assigned: readonly string[]): string[] {
  return [...new Set([...(REQUIRED_SKILLS[agent] ?? []), ...assigned.map(id => BUILTIN_SKILLS[id]).filter(Boolean)])];
}

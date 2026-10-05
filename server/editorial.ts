import { db } from './db.ts';
/** Only a person-reviewed strategy for this domain may guide subsequent articles. */
export function editorialBrief(siteId: string, domain: string): string {
  const row = db.prepare("SELECT result FROM seo_tasks WHERE site_id = ? AND domain = ? AND kind = 'strategy' AND status = 'done' AND reviewed_at IS NOT NULL ORDER BY id DESC LIMIT 1").get(siteId, domain) as { result: string } | undefined;
  return row?.result ?? '';
}

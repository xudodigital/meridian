/* Reading the audit log from the server in pages, with filters, and the address of its CSV file
   (server/audit-api.ts). Nothing here touches the store. */
import { apiGet } from './serverApi';
import type { AuditWire } from './sync';

/** What narrows the log. Times are milliseconds; the site is a site id. Empty or missing means "any". */
export interface AuditFilter { actor?: string; site?: string; q?: string; from?: number; to?: number }
/** Entries per page of the Audit log screen. */
export const AUDIT_PAGE = 100;

/** The filter as a query string ("" when nothing is set), with the page position when given. */
export function auditQuery(f: AuditFilter, page: { before?: number; limit?: number } = {}): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string | number | undefined) => { if (v !== undefined && v !== '') p.set(k, String(v)); };
  put('actor', f.actor?.trim()); put('site', f.site); put('q', f.q?.trim()); put('from', f.from); put('to', f.to);
  put('before', page.before); put('limit', page.limit);
  const s = p.toString();
  return s ? '?' + s : '';
}

export const auditApi = {
  /** One page, newest first: the entries older than `before` (an entry id), and whether still older ones exist. */
  page: (f: AuditFilter, before?: number) => apiGet<{ audit: AuditWire[]; more: boolean }>('/api/audit' + auditQuery(f, { before, limit: AUDIT_PAGE })),
  /** Where the browser downloads everything the filter selects as a CSV file (admins and editors). */
  csvUrl: (f: AuditFilter): string => '/api/audit.csv' + auditQuery(f),
};

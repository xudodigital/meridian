/* HTTP calls for connected services and what runs on them (server/ops-api.ts). Nothing here touches the store. */
import { apiGet, apiSend } from './serverApi';
import type { AccessWire, IntegrationWire, MetricsWire, VerifyWire } from './types';

export type TestResult = { status: '' | 'ok' | 'warn' | 'bad'; msg: string };
/** The weekly report as the server builds it. `clicks` is null when Search Console is not connected. */
export interface ServerReport {
  from: number; to: number; clicksKnown: boolean;
  rows: { siteId: string; site: string; country: string; clicks: number | null; published: number; waiting: number; spend: number; issue: string }[];
  lastSent: { at: number; to: string[]; by: string } | null;
}
/** A delivered (or held) alert, for Settings. */
export interface AlertWire { id: number; event: string; site: string | null; title: string; at: number; sentAt: number | null; result: string }

export const servicesApi = {
  integrations: () => apiGet<{ integrations: IntegrationWire[]; redirectUri: string }>('/api/integrations'),
  save: (id: string, values: Record<string, string>) => apiSend<{ result: TestResult; integration: IntegrationWire }>(`/api/integrations/${id}`, { values }, 'PUT'),
  test: (id: string) => apiSend<{ result: TestResult; integration: IntegrationWire }>(`/api/integrations/${id}/test`),
  remove: (id: string) => apiSend<{ integration: IntegrationWire }>(`/api/integrations/${id}`, {}, 'DELETE'),
  googleStart: (kind: 'gsc' | 'ga4' | 'ads') => apiSend<{ url: string }>('/api/oauth/google/start', { kind }),
  access: () => apiGet<{ access: AccessWire[]; checking: string[]; verify: VerifyWire[] }>('/api/access'),
  check: (siteId: string) => apiSend<{ started: true }>(`/api/sites/${encodeURIComponent(siteId)}/check`),
  verify: (siteId: string) => apiSend<{ verify: VerifyWire }>(`/api/sites/${encodeURIComponent(siteId)}/verify`),
  report: () => apiGet<{ report: ServerReport }>('/api/report').then(r => r.report),
  sendReport: () => apiSend<{ to: string[]; at: number }>('/api/reports/send'),
  refreshMetrics: () => apiSend<{ metrics: MetricsWire }>('/api/metrics/refresh'),
  alerts: () => apiGet<{ alerts: AlertWire[] }>('/api/alerts').then(r => r.alerts),
};

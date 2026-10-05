// The weekly report: figures per site from what the server knows (articles, research, agent spend, access checks,
// Search Console when connected), shown on Reports, sent by email with a CSV attached, on demand or on schedule.
import { db } from './db.ts';
import { bus } from './events.ts';
import { usable, valuesOf } from './integrations.ts';
import { latestChecks } from './probe.ts';
import { budget as dailyBudget, siteSpendToday, spendSince } from './ledger.ts';
import { alert } from './notify.ts';
import { sendMail, smtpConfig, SmtpError } from './smtp.ts';
import { settingsDoc, siteList } from './workspace.ts';
import { gscMetricsCached } from './metrics.ts';

export type ReportRow = { siteId: string; site: string; country: string; clicks: number | null; published: number; waiting: number; spend: number; issue: string };
export type Report = { from: number; to: number; rows: ReportRow[]; clicksKnown: boolean; lastSent: { at: number; to: string[]; by: string } | null };

const WEEK = 7 * 86_400_000;
const qr = {
  approved: db.prepare(`SELECT a.site_id AS site, COUNT(DISTINCT a.id) AS n FROM article_events e JOIN articles a ON a.id = e.article_id
    WHERE e.action = 'approved' AND e.at >= ? AND a.status = 'approved' GROUP BY a.site_id`),
  waiting: db.prepare(`SELECT site_id AS site, COUNT(*) AS n FROM articles WHERE status = 'review' GROUP BY site_id`),
  failed: db.prepare(`SELECT site, COUNT(*) AS n FROM (
    SELECT site_id AS site FROM requests WHERE status = 'failed' AND finished_at >= ?
    UNION ALL SELECT site_id AS site FROM articles WHERE status = 'failed' AND finished_at >= ?) GROUP BY site`),
  kvGet: db.prepare('SELECT value FROM kv WHERE key = ?'),
  kvPut: db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)'),
};
const byKey = (rows: unknown[], f: 'n'): Map<string, number> => new Map((rows as Record<string, number | string>[]).map(r => [String(r.site), Number(r[f]) || 0]));

export const kvGet = (k: string): string | null => (qr.kvGet.get(k) as { value: string } | undefined)?.value ?? null;
export const kvPut = (k: string, v: string) => qr.kvPut.run(k, v);

export function buildReport(now = Date.now()): Report {
  const from = now - WEEK;
  const approved = byKey(qr.approved.all(from), 'n'), waiting = byKey(qr.waiting.all(), 'n');
  /* Spend is the sum of the ledger's runs of the week (ledger.ts), the same figures as the daily budget. */
  const spend = spendSince(from), failed = byKey(qr.failed.all(from, from), 'n');
  const access = new Map(latestChecks().map(c => [c.siteId, c]));
  const metrics = gscMetricsCached();
  const budget = dailyBudget();
  const rows = siteList().map((s): ReportRow => {
    const a = access.get(s.id), f = failed.get(s.id) ?? 0;
    const issue = a?.result === 'blocked' ? 'Blocked in ' + (s.country || s.cc)
      : a?.result === 'down' ? 'Site down'
      : f ? `${f} failed job${f === 1 ? '' : 's'}`
      : siteSpendToday(s.id, now) >= budget ? 'Daily budget used: agent jobs stopped'
      : siteSpendToday(s.id, now) >= budget * 0.8 ? 'Near daily budget'
      : 'None';
    const m = metrics?.sites[s.id];
    return { siteId: s.id, site: s.domain, country: s.country, clicks: m ? m.clicks7 : null, published: approved.get(s.id) ?? 0, waiting: waiting.get(s.id) ?? 0, spend: spend.get(s.id) ?? 0, issue };
  });
  let lastSent: Report['lastSent'] = null;
  try { const v = kvGet('report:last'); if (v) lastSent = JSON.parse(v) as Report['lastSent']; } catch { /* none */ }
  return { from, to: now, rows, clicksKnown: !!metrics, lastSent };
}

export function reportCsv(r: Report): string {
  const esc = (v: string) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  return 'Site,Country,Clicks,Articles approved,Waiting for review,Spend (USD),Issue\n'
    + r.rows.map(x => [x.site, x.country, x.clicks === null ? '' : String(x.clicks), String(x.published), String(x.waiting), x.spend.toFixed(2), x.issue].map(esc).join(',')).join('\n') + '\n';
}

const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function reportText(r: Report): string {
  const sum = (k: 'published' | 'waiting' | 'spend') => r.rows.reduce((x, y) => x + y[k], 0);
  const clicks = r.clicksKnown ? r.rows.reduce((x, y) => x + (y.clicks ?? 0), 0).toLocaleString('en-US') : 'not connected';
  const issues = r.rows.filter(x => x.issue !== 'None');
  return [
    `Meridian weekly report, ${day(r.from)} to ${day(r.to)}`, '',
    `Sites: ${r.rows.length}`, `Organic clicks (Search Console): ${clicks}`, `Articles approved: ${sum('published')}`,
    `Waiting for review: ${sum('waiting')}`, `Agent spend: $${sum('spend').toFixed(2)}`, '',
    issues.length ? 'Needs attention:\n' + issues.map(x => `• ${x.site}: ${x.issue}`).join('\n') : 'No site has an open issue.', '',
    'The figures per site are in the attached CSV.',
  ].join('\n');
}

export const recipients = (): string[] => String(settingsDoc().repTo ?? '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

/** Sends the report now. Resolves to who received it; rejects with a message fit to show. */
export async function sendReport(by: string, now = Date.now()): Promise<{ to: string[]; at: number }> {
  const to = recipients();
  if (!to.length) throw new SmtpError('Add at least one recipient under Scheduled delivery.');
  const v = valuesOf('email');
  if (!v || !usable('email')) throw new SmtpError('Set up Email (SMTP) in Integrations first.');
  const r = buildReport(now);
  await sendMail(smtpConfig(v), {
    to, subject: `Meridian weekly report, ${day(r.from)} to ${day(r.to)}`, text: reportText(r),
    attachments: [{ filename: `meridian-report-${new Date(now).toISOString().slice(0, 10)}.csv`, contentType: 'text/csv; charset=utf-8', content: reportCsv(r) }],
  });
  const at = Date.now();
  kvPut('report:last', JSON.stringify({ at, to, by }));
  alert('report', `report:${at}`, null, 'The weekly report was sent', `Sent to ${to.join(', ')}.`, '/reports');
  bus.emit('report', { at, to, by });
  return { to, at };
}

/** The most recent time the schedule says a report is due, at or before `now` (local time, 08:00). */
export function dueAt(freq: string, now = new Date()): number {
  const d = new Date(now); d.setSeconds(0, 0); d.setHours(8, 0);
  if (freq === 'Every day 08:00') { if (d > now) d.setDate(d.getDate() - 1); return d.getTime(); }
  if (freq === 'First day of the month') { d.setDate(1); if (d > now) d.setMonth(d.getMonth() - 1); return d.getTime(); }
  /* Every Monday 08:00 */
  const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back); if (d > now) d.setDate(d.getDate() - 7);
  return d.getTime();
}

/** Sends the scheduled report when one is due and was not sent since. A report more than 12 hours late is skipped. */
export async function scheduledReport(now = new Date()): Promise<boolean> {
  const st = settingsDoc();
  if (st.repOn !== true || !recipients().length) return false;
  const due = dueAt(String(st.repFreq ?? 'Every Monday 08:00'), now);
  const last = Number(kvGet('report:due') ?? 0);
  if (last >= due || now.getTime() - due > 12 * 3_600_000) return false;
  kvPut('report:due', String(due));
  try { await sendReport('Schedule', now.getTime()); return true; }
  catch (e) { alert('error', `report-failed:${due}`, null, 'The scheduled report could not be sent', (e as Error).message, '/reports'); return false; }
}

export function schedule(): void {
  setInterval(() => { void scheduledReport(); }, 60_000).unref();
}

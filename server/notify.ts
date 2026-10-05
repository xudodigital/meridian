// Alerts by email, Slack and Telegram, as chosen in Settings > Alerts (the notifyPrefs document). In-app alerts are
// the dashboard's own notifications and are not sent from here.
//
// Every alert is stored once (by key, so the same thing is never sent twice), held during quiet hours, then delivered
// to the channels turned on for its event. When a service refuses (a removed webhook, a wrong password), its card in
// Integrations shows that. Several alerts waiting at once (after quiet hours) go out as one summary per channel.
import { db } from './db.ts';
import { bus } from './events.ts';
import { budget, siteSpendToday } from './ledger.ts';
import { slackPost, telegramSend } from './connectors.ts';
import { setResult, usable, valuesOf } from './integrations.ts';
import { ServiceError } from './net.ts';
import { sendMail, smtpConfig, SmtpError } from './smtp.ts';
import { listUsers } from './users.ts';
import { notifyPrefsDoc, settingsDoc, siteInfo } from './workspace.ts';
import type { ArticleView } from './articles.ts';
import type { RequestView } from './requests.ts';

export const EVENTS = ['approval', 'error', 'blocked', 'budget', 'review', 'report'] as const;
export type AlertEvent = typeof EVENTS[number];
/* The app's defaults (app/src/store/seed.ts np), for a workspace that never saved the alert table. */
const DEFAULT_NP: Record<AlertEvent, boolean[]> = {
  approval: [true, true, false, false], error: [true, false, true, false], blocked: [true, true, true, false],
  budget: [true, true, false, false], review: [true, false, false, false], report: [true, true, false, false],
};
/** Channel index in the alert table: 0 In-app, 1 Email, 2 Slack, 3 Telegram. */
const EMAIL = 1, SLACK = 2, TELEGRAM = 3;

type AlertRow = { id: number; key: string; event: string; site: string | null; title: string; body: string; link: string; created_at: number; sent_at: number | null; result: string };
const qn = {
  insert: db.prepare('INSERT OR IGNORE INTO alerts (key, event, site, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  pending: db.prepare('SELECT * FROM alerts WHERE sent_at IS NULL ORDER BY id LIMIT 50'),
  done: db.prepare('UPDATE alerts SET sent_at = ?, result = ? WHERE id = ?'),
  recent: db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT ?'),
  trim: db.prepare('DELETE FROM alerts WHERE sent_at IS NOT NULL AND sent_at < ?'),
};

export const channelsFor = (ev: AlertEvent): boolean[] => {
  const np = notifyPrefsDoc();
  const v = np?.[ev];
  return v && v.length === 4 ? v : DEFAULT_NP[ev];
};

/** Quiet hours from Settings, in this computer's time zone: 22:00-07:00, plus all of Saturday and Sunday for "weekend". */
export function quietNow(d = new Date()): boolean {
  const q = settingsDoc().quiet;
  if (q !== 'night' && q !== 'weekend') return false;
  const h = d.getHours(), night = h >= 22 || h < 7;
  if (q === 'night') return night;
  const day = d.getDay();
  return night || day === 0 || day === 6;
}

const origin = (): string => `http://localhost:${Number(process.env.PORT) || 4310}`;

/** Records an alert. Sent at once, or when quiet hours end. A key that was used before is ignored. */
export function alert(event: AlertEvent, key: string, site: string | null, title: string, body: string, link = ''): void {
  const ch = channelsFor(event);
  const info = qn.insert.run(key, event, site, title.slice(0, 200), body.slice(0, 2000), link, Date.now());
  if (!Number(info.changes)) return;
  if (!ch[EMAIL] && !ch[SLACK] && !ch[TELEGRAM]) { qn.done.run(Date.now(), 'No external channel is on for this alert.', Number(info.lastInsertRowid)); return; }
  setImmediate(() => { void flush(); });
}

/** Who gets alerts by email: active admins and editors; for a review, also the native reviewer of that site. */
function emailRecipients(event: string, site: string | null): string[] {
  return listUsers().filter(u => !u.disabled && (u.role === 'admin' || u.role === 'editor' || (event === 'review' && u.role === 'reviewer' && !!site && u.site === site))).map(u => u.email);
}

const line = (a: AlertRow): string => { const s = a.site ? siteInfo(a.site)?.domain : ''; return `${a.title}${s && !a.title.includes(s) ? ' (' + s + ')' : ''}`; };
const linkOf = (a: AlertRow): string => a.link ? origin() + a.link : origin();

/** The text for a group of alerts going to one channel. */
function compose(list: AlertRow[]): { subject: string; text: string } {
  if (list.length === 1) {
    const a = list[0]!;
    return { subject: 'Meridian: ' + line(a), text: `${line(a)}\n\n${a.body}\n\nOpen Meridian: ${linkOf(a)}` };
  }
  return {
    subject: `Meridian: ${list.length} alerts`,
    text: `${list.length} alerts while you were away:\n\n` + list.map(a => `• ${line(a)}\n  ${a.body}`).join('\n\n') + `\n\nOpen Meridian: ${origin()}`,
  };
}

const failText = (e: unknown): string => e instanceof ServiceError || e instanceof SmtpError ? e.message : (e as Error).message;

let flushing = false;
/** Delivers waiting alerts, unless it is quiet hours. Returns how many were handled. */
export async function flush(now = new Date()): Promise<number> {
  if (flushing || quietNow(now)) return 0;
  flushing = true;
  try {
    const list = qn.pending.all() as AlertRow[];
    if (!list.length) return 0;
    const results = new Map<number, string[]>(list.map(a => [a.id, []]));
    const note = (as: AlertRow[], s: string) => as.forEach(a => results.get(a.id)!.push(s));

    /* Email: grouped by who receives them, so a reviewer gets only their own site's reviews. */
    /* The report itself goes by email to its own recipients (report.ts), so its alert is for Slack and Telegram only. */
    const forEmail = list.filter(a => a.event !== 'report' && channelsFor(a.event as AlertEvent)[EMAIL]);
    if (forEmail.length) {
      const v = valuesOf('email');
      if (!v || !usable('email')) note(forEmail, 'Email: not set up');
      else {
        const byTo = new Map<string, AlertRow[]>();
        for (const a of forEmail) for (const to of emailRecipients(a.event, a.site)) byTo.set(to, [...(byTo.get(to) ?? []), a]);
        for (const [to, as] of byTo) {
          try { const m = compose(as); await sendMail(smtpConfig(v), { to: [to], subject: m.subject, text: m.text }); note(as, 'Email: sent to ' + to); }
          catch (e) { note(as, 'Email: ' + failText(e)); setResult('email', 'bad', 'Sending an alert failed: ' + failText(e)); }
        }
      }
    }
    const forSlack = list.filter(a => channelsFor(a.event as AlertEvent)[SLACK]);
    if (forSlack.length) {
      const v = valuesOf('slack');
      if (!v?.webhook || !usable('slack')) note(forSlack, 'Slack: not set up');
      else {
        const m = compose(forSlack);
        try { await slackPost(v.webhook, m.text); note(forSlack, 'Slack: sent'); }
        catch (e) { note(forSlack, 'Slack: ' + failText(e)); setResult('slack', 'bad', 'Sending an alert failed: ' + failText(e)); }
      }
    }
    const forTg = list.filter(a => channelsFor(a.event as AlertEvent)[TELEGRAM]);
    if (forTg.length) {
      const v = valuesOf('tg');
      if (!v?.token || !v.chat || !usable('tg')) note(forTg, 'Telegram: not set up');
      else {
        const m = compose(forTg);
        try { await telegramSend(v.token, v.chat, m.text); note(forTg, 'Telegram: sent'); }
        catch (e) { note(forTg, 'Telegram: ' + failText(e)); setResult('tg', 'bad', 'Sending an alert failed: ' + failText(e)); }
      }
    }
    const at = Date.now();
    for (const a of list) qn.done.run(at, results.get(a.id)!.join('; ') || 'No channel', a.id);
    bus.emit('integrations-changed', {});
    return list.length;
  } finally { flushing = false; }
}

export type AlertView = { id: number; event: string; site: string | null; title: string; at: number; sentAt: number | null; result: string };
export const recentAlerts = (n = 30): AlertView[] => (qn.recent.all(n) as AlertRow[]).map(a => ({ id: a.id, event: a.event, site: a.site, title: a.title, at: a.created_at, sentAt: a.sent_at, result: a.result }));

/* ---------- What raises an alert ---------- */

const today = (t: number) => new Date(t).toDateString();
/* Spend is a sum over the ledger (ledger.ts): every API call of research, articles, photo jobs and first builds, the
   failed ones and every revision included, each counted once. */
export { siteSpendToday };

/**
 * Called for every run written to the ledger. At 80% of the daily budget the site gets a warning, at 100% the news
 * that its agent jobs are stopped (ledger.ts refuses new ones and holds the waiting ones). Each is sent once per site
 * and day; a run that takes a site from under 80% straight past the budget sends the second only.
 */
export function budgetCheck(siteId: string, at: number): void {
  /* Only a run that ended today can push today's spend over the line. */
  if (today(at) !== today(Date.now())) return;
  const b = budget(), usd = siteSpendToday(siteId, at), domain = siteInfo(siteId)?.domain || 'A site';
  const spent = `Agents spent $${usd.toFixed(2)} of $${b.toFixed(2)} today.`;
  if (usd >= b) alert('budget', `budget-stop:${siteId}:${today(at)}`, siteId, `${domain} used its daily budget: its agent jobs are stopped`,
    `${spent} New jobs for this site are refused and the ones waiting are held. They start again at midnight, or when you raise the budget in Settings.`, '/analytics');
  else if (usd >= b * 0.8) alert('budget', `budget:${siteId}:${today(at)}`, siteId, `${domain} passed 80% of its daily budget`,
    `${spent} At 100% its agent jobs stop until midnight.`, '/analytics');
}

/** Listens to job results and raises the alerts they call for. */
export function watch(): void {
  bus.on('article', (a: ArticleView) => {
    if (!a.finishedAt) return;
    if (a.status === 'review') alert('review', `review:a${a.id}:${a.finishedAt}`, a.siteId, `Article ready for review: "${a.content?.titleEn || a.content?.title || a.keyword}"`, `${a.domain} · ${a.revision ? 'revision ' + a.revision : 'first draft'}. A person must approve it before it can be published.`, '/review');
    if (a.status === 'failed') alert('error', `error:a${a.id}:${a.finishedAt}`, a.siteId, `The Content Writer failed on "${a.keyword}"`, a.error || 'The job stopped.', '/review');
  });
  bus.on('request', (r: RequestView) => {
    if (!r.finishedAt) return;
    if (r.status === 'failed') alert('error', `error:r${r.id}:${r.finishedAt}`, r.siteId, `Keyword research failed: ${r.topic}`, r.error || 'The job stopped.', '/research');
  });
  /* Every API call that was written to the spend ledger, of any kind of job and however it ended. */
  bus.on('run', (r: { siteId: string; at: number }) => {
    try { budgetCheck(r.siteId, r.at); } catch (e) { console.error('The budget alert could not be checked:', (e as Error).message); }
  });
  /* Waiting alerts go out when quiet hours end; old delivered ones are dropped after 90 days. */
  setInterval(() => { void flush(); qn.trim.run(Date.now() - 90 * 86_400_000); }, 60_000).unref();
}

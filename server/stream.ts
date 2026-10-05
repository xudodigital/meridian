// GET /api/events: one server-sent event stream per signed-in browser. Every event on the bus is passed on to the
// streams whose person may see it (a native reviewer gets their own site only, the audit log goes to the roles that
// can open it, team changes to admins). The session is checked before every event and every 25 seconds: a stream whose
// session ended gets "signed-out" and is closed.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { seesAudit, seesSite, type Ctx } from './access.ts';
import { bus } from './events.ts';
import { json } from './http.ts';
import { verifyViews } from './verify.ts';
import { liveSessionById } from './sessions.ts';
import { userById, type UserRow } from './users.ts';
import { docFor, isDocId, type Doc, type Json } from './workspace.ts';

type Stream = { res: ServerResponse; sessionId: number; ping?: ReturnType<typeof setInterval> };
const streams = new Set<Stream>();
/** How often an open stream is pinged. The page expects one at least every 3 pings (live.ts). */
export const PING_MS = 25_000;

/** The person behind a stream right now, or null when the session or the account has ended. */
function personOf(s: Stream): UserRow | null {
  const session = liveSessionById(s.sessionId);
  const user = session ? userById(session.user_id) : undefined;
  return user && !user.disabled ? user : null;
}
const write = (s: Stream, event: string, data: unknown) => s.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
function close(s: Stream, event = 'signed-out'): void {
  streams.delete(s);
  clearInterval(s.ping);
  try { write(s, event, {}); s.res.end(); } catch { /* already gone */ }
}

/** Sends `event` to every stream whose person passes `who`. */
function fanout(event: string, data: unknown, who: (u: UserRow) => boolean = () => true): void {
  for (const s of [...streams]) {
    const u = personOf(s);
    if (!u) { close(s); continue; }
    if (who(u)) write(s, event, data);
  }
}

/** One browser rarely needs more than a few tabs; a script holding hundreds of streams open is refused. */
export const MAX_STREAMS_PER_SESSION = 5;

export function openStream(req: IncomingMessage, res: ServerResponse, ctx: Ctx): void {
  let open = 0;
  for (const x of streams) if (x.sessionId === ctx.session.id) open++;
  if (open >= MAX_STREAMS_PER_SESSION) {
    json(res, 429, { error: `Live updates are already open in ${MAX_STREAMS_PER_SESSION} tabs of this browser. Close a tab, then reload this one.` });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
  res.write('retry: 3000\n\n');
  const s: Stream = { res, sessionId: ctx.session.id };
  streams.add(s);
  /* A real event, not a comment: the page watches for it and reconnects when none arrives (a laptop that slept,
     a connection that died without a close). */
  s.ping = setInterval(() => { if (personOf(s)) write(s, 'ping', { t: Date.now() }); else close(s); }, PING_MS);
  req.on('close', () => { clearInterval(s.ping); streams.delete(s); });
}

/** The server is stopping: every stream is told ("restarting") and ended, so the pages reconnect when it is back. */
export function closeAll(): void { for (const s of [...streams]) close(s, 'restarting'); }

/** Closes the streams of sessions that no longer exist (sign-out, account disabled or removed) at once. */
export function closeEnded(): void { for (const s of [...streams]) if (!personOf(s)) close(s); }

type SiteThing = { siteId: string };
bus.on('request', (r: SiteThing) => fanout('request', r, u => seesSite(u, r.siteId)));
bus.on('article', (a: SiteThing) => fanout('article', a, u => seesSite(u, a.siteId)));
bus.on('engine', (e: unknown) => fanout('engine', e));
/* A saved document goes out as each person may see it: a native reviewer gets their own site and the few settings
   their screen uses, and no word of the other documents (workspace.ts docFor). */
bus.on('workspace', (d: { doc: string; version: number; data: Json }) => {
  for (const s of [...streams]) {
    const u = personOf(s);
    if (!u) { close(s); continue; }
    const seen: Doc | null = isDocId(d.doc) ? docFor(u, d.doc, { version: d.version, data: d.data }) : null;
    if (seen) write(s, 'workspace', { doc: d.doc, version: seen.version, data: seen.data });
  }
});
bus.on('audit', (e: unknown) => fanout('audit', e, seesAudit));
bus.on('reset', () => fanout('reset', {}));
bus.on('team', () => fanout('team', {}, u => u.role === 'admin'));
/** Something about this person's account changed (role, name, 2-step): their browsers fetch it again. */
bus.on('account', (userId: number) => fanout('account', {}, u => u.id === userId));
bus.on('reads', (r: { userId: number; keys: string[] }) => fanout('reads', { keys: r.keys }, u => u.id === r.userId));
/* Services and checks. Integration details differ by role, so browsers fetch them again on this signal. */
bus.on('integrations-changed', () => fanout('integrations', {}));
bus.on('access', (c: SiteThing) => fanout('access', c, u => seesSite(u, c.siteId)));
bus.on('access-running', (c: SiteThing & { running: boolean }) => fanout('access-running', c, u => seesSite(u, c.siteId)));
bus.on('verify', (v: SiteThing) => fanout('verify', v, u => u.role !== 'reviewer'));
/* A saved sites document can add a site, which needs its own TXT value: the whole list goes out again. */
bus.on('workspace', (d: { doc: string }) => { if (d.doc === 'sites') fanout('verify-list', verifyViews(), u => u.role !== 'reviewer'); });
bus.on('metrics', (m: unknown) => fanout('metrics', m ?? null, u => u.role !== 'reviewer'));
bus.on('report', (r: unknown) => fanout('report', r, u => u.role !== 'reviewer'));
/* Spend and tokens per site and agent, after every run written to the ledger (ledger.ts). */
bus.on('spend', (s: unknown) => fanout('spend', s, u => u.role !== 'reviewer'));
/** The outcome of a Google sign-in, for the admins' Integrations screen. */
bus.on('google-result', (r: unknown) => fanout('google-result', r, u => u.role === 'admin'));
/** A site build or its deploy changed (server/builds.ts). Reviewers do not see Build and deploy. */
bus.on('build', (b: SiteThing) => fanout('build', b, u => u.role !== 'reviewer' && seesSite(u, b.siteId)));
/** A site's own domain on its Pages project changed state (server/domains.ts). Part of Build and deploy. */
bus.on('domain', (d: SiteThing) => fanout('domain', d, u => u.role !== 'reviewer' && seesSite(u, d.siteId)));
/** A workflow run changed, or the schedules' next start times did (server/workflows.ts). Not a reviewer's screen. */
bus.on('workflow', (w: { run?: SiteThing }) => fanout('workflow', w, u => u.role !== 'reviewer' && (!w.run || seesSite(u, w.run.siteId))));
/** Search Console rows, Analytics figures or the tracked keywords changed (server/metrics.ts, ga4.ts, requests.ts): the Analytics tabs read them again. */
bus.on('insights', (i: unknown) => fanout('insights', i ?? {}, u => u.role !== 'reviewer'));

bus.on('seo-task', (t: SiteThing) => fanout('seo-task', t, u => u.role !== 'reviewer' && seesSite(u, t.siteId)));

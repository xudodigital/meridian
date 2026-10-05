/* Loading and saving the workspace (outside demo mode). After sign-in the workspace documents, the audit log and the
   person's read notifications are loaded from the server (GET /api/workspace). From then on:

   - a change to sites, agents, skills, settings, schedules, review modes or alert preferences is saved as that
     document, debounced, with the version it was based on. A stale write (409) gets the server's version back: the
     local change is merged onto it (workspace.ts rebase) and saved again. Other failures show a non-blocking error
     (state.sync.error, the shell's banner) and are retried;
   - an audit entry the person made here (logMineTo, with a client id) is sent to the server, which records it under
     the signed-in person; the server's copy replaces the local one;
   - notifications the person reads are remembered on the server;
   - other browsers' changes arrive on the event stream (live.ts) and are applied here (remote* functions).

   Demo mode never loads or saves anything. App starts it with startSync(). */
import { liveNotifsTo, markReadTo } from './liveNotifs';
import { ApiError, apiGet, apiSend } from './serverApi';
import { useStore, type AppStore } from './store';
import type { AppState, LogEntry } from './types';
import { serverFactsTo } from './serverFacts';
import { DOC_IDS, DOC_SOURCES, applyDoc as applyDocOnly, canon, defaultDoc, docOf, rebase, type DocId, type Json } from './workspace';

/** Puts a document into the state; the server's facts about sites (access, clicks, spend) and agents (tokens today) go back on top. */
function applyDoc(d: AppStore, id: DocId, data: Json | null): void {
  applyDocOnly(d, id, data);
  if (id === 'sites' || id === 'agents') serverFactsTo(d);
}

/** An audit entry as the server sends it (server/workspace.ts AuditView). */
export interface AuditWire { id: number; t: number; actor: string; act: string; site: string | null; cid?: string; note?: boolean }
/** GET /api/workspace. A document never saved has version 0 and data null. */
export interface WorkspaceWire { docs: Partial<Record<DocId, { version: number; data: Json | null }>>; audit: AuditWire[]; notifRead: string[] }

/** Changes are saved this long after the last one. */
export const SAVE_DELAY_MS = 400;
const AUDIT_DELAY_MS = 250;
/** Waits before retrying a save that failed, growing with each failure. */
const RETRY_MS = [2000, 5000, 10_000, 30_000];

type DocSync = { version: number; base: Json; text: string; busy: boolean; again: boolean; tries: number; timer: ReturnType<typeof setTimeout> | null };
let docs: Partial<Record<DocId, DocSync>> = {};
let loading = false;
/** Bumped at sign-out, reset and reload, so the answer to an older request is ignored. */
let generation = 0;
const failing = new Map<string, string>();
const sentCids = new Set<string>();
const knownReads = new Set<string>();
let auditTimer: ReturnType<typeof setTimeout> | null = null;

type S = Pick<AppState, 'sample' | 'session' | 'sync'>;
/** Saving applies: signed in, not in demo mode, not waiting for 2-step setup, and the workspace was loaded. */
const active = (s: S): boolean => !s.sample && !!s.session && !s.session.enroll && s.sync.loaded;
const wantsLoad = (s: S): boolean => !s.sample && !!s.session && !s.session.enroll && !s.sync.loaded;
/** Settings and alert preferences are the admin's; editors save the other documents; viewers and native reviewers none
    (server/access.ts mayWriteDoc, server/workspace.ts ADMIN_DOCS). */
const ADMIN_DOCS: readonly DocId[] = ['settings', 'notifyPrefs'];
const mayWriteDoc = (s: Pick<AppState, 'session'>, id: DocId): boolean =>
  s.session?.role === 'admin' || (s.session?.role === 'editor' && !ADMIN_DOCS.includes(id));
const message = (e: unknown): string => e instanceof Error ? e.message : String(e);

function showError(): void {
  const msg = [...failing.values()][0] ?? '';
  if (useStore.getState().sync.error !== msg) useStore.setState(d => { d.sync.error = msg; });
}
function fail(key: string, msg: string): void { failing.set(key, msg); showError(); }
function ok(key: string): void { if (failing.delete(key)) showError(); }

/* ---------- Audit entries ---------- */

/* The server prefixes an entry the dashboard posted with "Note: " and flags it. The flag is kept (the Audit log shows
   it as a small label); the prefix is dropped, so activity feeds read as before. */
export const auditEntry = (w: AuditWire): LogEntry => ({
  t: new Date(w.t), actor: w.actor, act: w.note ? w.act.replace(/^Note: /, '') : w.act, site: w.site, id: w.id,
  ...(w.cid ? { cid: w.cid } : {}), ...(w.note ? { note: true } : {}),
});

/** The server's copy of an audit entry: replaces the local entry with the same client id, else joins the log in time order. */
export function auditTo(d: Pick<AppState, 'log'>, w: AuditWire): void {
  if (d.log.some(l => l.id === w.id)) return;
  const e = auditEntry(w), i = w.cid ? d.log.findIndex(l => l.cid === w.cid && l.id === undefined) : -1;
  if (i >= 0) d.log[i] = e; else d.log.unshift(e);
  d.log.sort((a, b) => b.t.getTime() - a.t.getTime());
  if (d.log.length > 200) d.log.length = 200;
}

async function flushAudit(): Promise<void> {
  auditTimer = null;
  const s = useStore.getState();
  if (!active(s)) return;
  const pending = s.log.filter(l => l.cid && l.id === undefined && !sentCids.has(l.cid)).reverse();
  if (!pending.length) return;
  pending.forEach(l => sentCids.add(l.cid!));
  const gen = generation;
  try {
    const r = await apiSend<{ entries: AuditWire[] }>('/api/audit', { entries: pending.map(l => ({ act: l.act, site: l.site, cid: l.cid })) });
    if (gen !== generation) return;
    useStore.setState(d => { r.entries.forEach(w => auditTo(d, w)); });
    ok('audit');
  } catch (e) {
    if (gen !== generation) return;
    pending.forEach(l => sentCids.delete(l.cid!));
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return;
    fail('audit', 'The audit log could not be saved: ' + message(e) + ' Trying again…');
    auditTimer = setTimeout(() => void flushAudit(), RETRY_MS[1]);
  }
}

/* ---------- Documents ---------- */

function schedule(id: DocId, ms = SAVE_DELAY_MS): void {
  const ds = docs[id]; if (!ds) return;
  if (ds.timer) clearTimeout(ds.timer);
  ds.timer = setTimeout(() => { ds.timer = null; void flush(id); }, ms);
}

/** The server's newer version arrived while this browser has its own change: the change is put on top of it. */
function merge(id: DocId, version: number, server: Json | null): void {
  const ds = docs[id]; if (!ds) return;
  const theirs = server ?? defaultDoc(id);
  const merged = rebase(ds.base, docOf(useStore.getState(), id), theirs);
  ds.version = version; ds.base = theirs; ds.text = canon(theirs);
  useStore.setState(d => applyDoc(d, id, merged));
}

/** Saves one document if it differs from what the server has. */
export async function flush(id: DocId): Promise<void> {
  const ds = docs[id]; if (!ds) return;
  if (ds.busy) { ds.again = true; return; }
  const s = useStore.getState();
  if (!active(s)) return;
  const data = docOf(s, id), text = canon(data);
  if (text === ds.text) return;
  ds.busy = true;
  const gen = generation;
  let retry = 0;
  try {
    const r = await apiSend<{ version: number }>('/api/workspace/docs/' + id, { version: ds.version, data }, 'PUT');
    if (gen !== generation) return;
    ds.version = r.version; ds.base = data; ds.text = text; ds.tries = 0;
    ok(id);
  } catch (e) {
    if (gen !== generation) return;
    if (e instanceof ApiError && e.status === 409 && typeof e.data.version === 'number') {
      merge(id, e.data.version, (e.data.data ?? null) as Json | null);
      ds.again = true;
    } else if (e instanceof ApiError && (e.status === 400 || e.status === 403 || e.status === 413)) {
      /* Refused for good (for example the role changed meanwhile): the server's version is put back, as the app reads
         it, so a field the app reads differently does not count as a change and is not sent (and refused) again. */
      useStore.setState(d => applyDoc(d, id, ds.base));
      ds.base = docOf(useStore.getState(), id); ds.text = canon(ds.base);
      useStore.getState().snack('Your change was not saved: ' + e.message, 'error');
    } else if (!(e instanceof ApiError && e.status === 401)) {
      retry = RETRY_MS[Math.min(ds.tries, RETRY_MS.length - 1)]!;
      ds.tries++;
      fail(id, 'Your changes could not be saved: ' + message(e) + ' Trying again…');
    }
  } finally {
    ds.busy = false;
    if (gen === generation) {
      if (retry) schedule(id, retry);
      else if (ds.again) { ds.again = false; schedule(id); }
      else if (canon(docOf(useStore.getState(), id)) !== ds.text) schedule(id);
    }
  }
}

/** Loads the workspace from the server into the store. Called by the subscriber below after sign-in. */
export async function loadWorkspace(): Promise<void> {
  if (loading) return;
  loading = true;
  const gen = generation;
  try {
    const w = await apiGet<WorkspaceWire>('/api/workspace');
    if (gen !== generation || !wantsLoad(useStore.getState())) return;
    /* Known before the store changes, so the keys that came from the server are not sent back to it. */
    knownReads.clear(); w.notifRead.forEach(k => knownReads.add(k));
    useStore.setState(d => {
      for (const id of DOC_IDS) applyDoc(d, id, w.docs[id]?.data ?? null);
      d.log = w.audit.map(auditEntry);
      d.notifRead = w.notifRead;
      liveNotifsTo(d);
      d.sync = { loaded: true, error: '' };
    });
    failing.clear(); showError();
    const s = useStore.getState();
    docs = {};
    for (const id of DOC_IDS) {
      /* A document the app reads differently (an older shape) is saved back once in today's shape, by someone who may
         save it. For anyone else the app's reading is the base: the server would refuse the save, again and again. */
      const got = w.docs[id], base = got?.data != null && mayWriteDoc(s, id) ? got.data : docOf(s, id);
      docs[id] = { version: got?.version ?? 0, base, text: canon(base), busy: false, again: false, tries: 0, timer: null };
      if (canon(docOf(s, id)) !== docs[id]!.text) schedule(id);
    }
  } catch (e) {
    if (gen !== generation || (e instanceof ApiError && (e.status === 401 || e.status === 403))) return;
    fail('load', 'The workspace could not be loaded: ' + message(e) + ' Trying again…');
    setTimeout(() => { if (gen === generation && wantsLoad(useStore.getState())) void loadWorkspace(); }, RETRY_MS[1]);
  } finally {
    loading = false;
  }
}

/** Forgets everything about the server's workspace (sign-out, demo mode, reset). */
function stop(): void {
  generation++;
  for (const ds of Object.values(docs)) if (ds?.timer) clearTimeout(ds.timer);
  if (auditTimer) clearTimeout(auditTimer);
  docs = {}; auditTimer = null; loading = false;
  failing.clear(); sentCids.clear(); knownReads.clear();
}

/* ---------- What other browsers did (live.ts passes the event stream here) ---------- */

/** Another browser saved a document. */
export function remoteDoc(id: DocId, version: number, data: Json | null): void {
  const ds = docs[id];
  if (!ds || version <= ds.version || !active(useStore.getState())) return;
  if (!ds.busy && canon(docOf(useStore.getState(), id)) === ds.text) {
    ds.version = version;
    useStore.setState(d => applyDoc(d, id, data));
    /* As the app reads it: fields the app keeps elsewhere (a site's access, from the server's checks) do not count as a change. */
    ds.base = docOf(useStore.getState(), id); ds.text = canon(ds.base);
  } else merge(id, version, data);
}
/** A new audit entry, from this browser's own append or anyone else's action. */
export function remoteAudit(w: AuditWire): void {
  if (!active(useStore.getState())) return;
  useStore.setState(d => auditTo(d, w));
}
/** The person read notifications in another browser. */
export function remoteReads(keys: string[]): void {
  if (!active(useStore.getState())) return;
  keys.forEach(k => knownReads.add(k));
  useStore.setState(d => { markReadTo(d, keys); liveNotifsTo(d); });
}
/** An admin reset the workspace: everything is loaded again. */
export function remoteReset(): void {
  if (useStore.getState().sample) return;
  stop();
  useStore.setState(d => { d.sync = { loaded: false, error: '' }; });
}

/**
 * Brings the workspace up to date after the event stream was away (a reconnect, a tab that was hidden): every document
 * the server has newer goes through the same merge as an event would, and audit entries and read notifications are
 * added. Unsaved local changes are kept, as with an event.
 */
export async function resyncWorkspace(): Promise<void> {
  if (!active(useStore.getState())) return;
  const gen = generation;
  const w = await apiGet<WorkspaceWire>('/api/workspace');
  if (gen !== generation || !active(useStore.getState())) return;
  for (const id of DOC_IDS) { const got = w.docs[id]; if (got) remoteDoc(id, got.version, got.data); }
  w.notifRead.forEach(k => knownReads.add(k));
  useStore.setState(d => { w.audit.forEach(a => auditTo(d, a)); markReadTo(d, w.notifRead); liveNotifsTo(d); });
}

/* ---------- Watching the store ---------- */

function watch(s: AppStore, prev: AppStore): void {
  if ((!s.session && prev.session) || (s.sample && !prev.sample) || (s.session && prev.session && s.session.id !== prev.session.id)) stop();
  if (wantsLoad(s) && !loading) { void loadWorkspace(); return; }
  if (!active(s)) return;
  for (const id of DOC_IDS) if (DOC_SOURCES[id].some(k => s[k] !== prev[k])) schedule(id);
  if (s.log !== prev.log && s.log.some(l => l.cid && l.id === undefined && !sentCids.has(l.cid))) {
    if (auditTimer) clearTimeout(auditTimer);
    auditTimer = setTimeout(() => void flushAudit(), AUDIT_DELAY_MS);
  }
  if (s.notifRead !== prev.notifRead) {
    const fresh = s.notifRead.filter(k => !knownReads.has(k));
    if (fresh.length) {
      fresh.forEach(k => knownReads.add(k));
      apiSend('/api/notifications/read', { keys: fresh }).catch(() => fresh.forEach(k => knownReads.delete(k)));
    }
  }
}

let started = false;
/** Starts watching the store. Safe to call more than once. */
export function startSync(): void {
  if (started) return;
  started = true;
  useStore.subscribe(watch);
  if (wantsLoad(useStore.getState())) void loadWorkspace();
}

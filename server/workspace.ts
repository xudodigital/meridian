// The workspace everybody shares: one versioned JSON document per collection, the audit log, and each person's read
// notifications. A write names the version it was based on; a stale one is refused so the app can merge and retry.
import { db } from './db.ts';
import { supportedModel } from './openai-models.ts';

export const DOC_IDS = ['sites', 'agents', 'skills', 'settings', 'schedules', 'reviewModes', 'notifyPrefs'] as const;
export type DocId = typeof DOC_IDS[number];
export const isDocId = (v: string): v is DocId => (DOC_IDS as readonly string[]).includes(v);
/** Who may write each document: Settings and the alert preferences are on the Settings screen, which is for admins. */
export const ADMIN_DOCS: readonly DocId[] = ['settings', 'notifyPrefs'];

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };
const isObj = (v: Json | undefined): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Largest document, serialized. */
export const DOC_MAX_BYTES = 1_000_000;
const LIST_MAX = 5000;

const TIMEOUTS: Record<string, number> = { demo: 60_000, m15: 900_000, h1: 3_600_000, h8: 28_800_000 };
const REVIEW_MODES = ['all', 'sample', 'risk'];
/** The defaults the app also starts from (app/src/store/empty.ts): 2-step verification not required, 8 hours idle. */
const DEFAULT_TIMEOUT = 'h8';

/** A host name: labels of letters, digits and hyphens with dots between them. Nothing else may follow "https://". */
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i;
const SITE_TEXT_MAX = 120;
/**
 * A site's domain is fetched by the access check and, with its country, language and topic, written into the agents'
 * prompts: the domain must be a plain host name and the others one short line each.
 */
function siteError(site: Obj): string {
  if ('domain' in site && !(typeof site.domain === 'string' && DOMAIN.test(site.domain))) return 'Enter the domain as a host name, for example kopi.example (no https://, path or spaces).';
  for (const k of ['country', 'cc', 'lang', 'topic'] as const) {
    const v = site[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > SITE_TEXT_MAX || /[\u0000-\u001f\u007f]/.test(v)) return `A site's ${k === 'cc' ? 'country code' : k === 'lang' ? 'language' : k} must be one line of at most ${SITE_TEXT_MAX} characters.`;
  }
  return '';
}

/** Why a document cannot be stored, or ''. The app renders everything as text, so the checks are about shape. */
export function docError(id: DocId, data: Json): string {
  if (JSON.stringify(data).length > DOC_MAX_BYTES) return 'This is too much data to save at once.';
  switch (id) {
    case 'sites': case 'agents': case 'skills': case 'schedules': {
      if (!Array.isArray(data) || data.length > LIST_MAX) return 'Expected a list.';
      const ids = new Set<string>();
      for (const item of data) {
        if (!isObj(item) || typeof item.id !== 'string' || !item.id || item.id.length > 64) return 'Every item needs an id.';
        if (ids.has(item.id)) return 'Two items have the same id.';
        ids.add(item.id);
        if (id === 'agents' && item.model !== undefined && !supportedModel(item.model)) return 'Select a supported OpenAI model.';
        if (id === 'agents' && isObj(item.prev) && Object.keys(item.prev).some(k => k !== 'openai')) return 'Only OpenAI configurations are supported.';
        if (id === 'skills' && item.only !== undefined && item.only !== 'openai') return 'Only OpenAI configurations are supported.';
        if (id === 'sites') { const err = siteError(item); if (err) return err; }
      }
      return '';
    }
    case 'settings': {
      if (!isObj(data)) return 'Expected settings.';
      if ('twofa' in data && typeof data.twofa !== 'boolean') return 'The 2-step setting must be on or off.';
      if ('timeout' in data && !(typeof data.timeout === 'string' && data.timeout in TIMEOUTS)) return 'Unknown sign-out time.';
      return '';
    }
    case 'reviewModes':
      if (!isObj(data)) return 'Expected review modes.';
      return Object.values(data).every(v => typeof v === 'string' && REVIEW_MODES.includes(v)) ? '' : 'Unknown review mode.';
    case 'notifyPrefs':
      if (!isObj(data)) return 'Expected alert preferences.';
      return Object.values(data).every(v => Array.isArray(v) && v.length === 4 && v.every(b => typeof b === 'boolean')) ? '' : 'Unknown alert preference.';
  }
}

type DocRow = { id: string; version: number; data: string; updated_at: number; updated_by: number | null };
const qd = {
  get: db.prepare('SELECT * FROM workspace_docs WHERE id = ?'),
  all: db.prepare('SELECT * FROM workspace_docs'),
  insert: db.prepare('INSERT INTO workspace_docs (id, version, data, updated_at, updated_by) VALUES (?, 1, ?, ?, ?)'),
  update: db.prepare('UPDATE workspace_docs SET version = version + 1, data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?'),
  clear: db.prepare('DELETE FROM workspace_docs'),
};

export type Doc = { version: number; data: Json };
const parse = (s: string): Json => { try { return JSON.parse(s) as Json; } catch { return null; } };

/** A document as stored, or version 0 and null when nobody saved it yet (the app then uses its defaults). */
export function getDoc(id: DocId): Doc {
  const r = qd.get.get(id) as DocRow | undefined;
  return r ? { version: r.version, data: parse(r.data) } : { version: 0, data: null };
}
export function allDocs(): Record<DocId, Doc> {
  const out = Object.fromEntries(DOC_IDS.map(id => [id, { version: 0, data: null }])) as Record<DocId, Doc>;
  for (const r of qd.all.all() as DocRow[]) if (isDocId(r.id)) out[r.id] = { version: r.version, data: parse(r.data) };
  return out;
}

/** Stores a document if `base` is its current version. Returns the new version, or the current document when stale. */
export function putDoc(id: DocId, base: number, data: Json, by: number): { ok: true; version: number } | { ok: false; current: Doc } {
  const text = JSON.stringify(data), now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const cur = getDoc(id);
    if (cur.version !== base) { db.exec('ROLLBACK'); return { ok: false, current: cur }; }
    if (base === 0) qd.insert.run(id, text, now, by); else qd.update.run(text, now, by, id, base);
    db.exec('COMMIT');
    return { ok: true, version: base + 1 };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ---------- Settings the server itself enforces ---------- */

const settings = (): Obj => { const d = getDoc('settings').data; return isObj(d) ? d : {}; };
/** "Require a 2-step verification code at sign-in". */
export const twofaRequired = (): boolean => settings().twofa === true;
/** "Require a native-speaker review before approval". On unless Settings turned it off, as in the app (seed.ts). */
export const nativeRequired = (): boolean => settings().native !== false;
/** "Sign out after inactivity", in milliseconds. */
export const idleMs = (): number => { const t = settings().timeout; return TIMEOUTS[typeof t === 'string' ? t : DEFAULT_TIMEOUT] ?? TIMEOUTS[DEFAULT_TIMEOUT]!; };

/* ---------- Audit log ---------- */

export type AuditRow = { id: number; at: number; actor: string; actor_id: number | null; act: string; site: string | null; client: number };
/** `note` marks an entry the app posted: what a person says they did on their screen, not something the server did or checked. */
export type AuditView = { id: number; t: number; actor: string; act: string; site: string | null; cid?: string; note?: true };
const qa = {
  insert: db.prepare('INSERT INTO audit_log (at, actor, actor_id, act, site, client) VALUES (?, ?, ?, ?, ?, ?)'),
  recent: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?'),
};
/** How an entry the app posted begins, in every view of the log, so it cannot pass for one the server wrote. */
const NOTE = 'Note: ';
const shown = (act: string, client: boolean): string => client ? NOTE + act : act;
export const viewAudit = (r: AuditRow, cid?: string): AuditView =>
  ({ id: r.id, t: r.at, actor: r.actor, act: shown(r.act, !!r.client), site: r.site, ...(r.client ? { note: true as const } : {}), ...(cid ? { cid } : {}) });
/** Writes an audit entry. `client` is true only for entries the app posted (POST /api/audit). */
export function addAudit(actor: { name: string; id: number | null }, act: string, site: string | null = null, client = false): AuditView {
  const at = Date.now(), text = act.slice(0, 500);
  const info = qa.insert.run(at, actor.name, actor.id, text, site, client ? 1 : 0);
  return { id: Number(info.lastInsertRowid), t: at, actor: actor.name, act: shown(text, client), site, ...(client ? { note: true as const } : {}) };
}
export const recentAudit = (n = 200): AuditView[] => (qa.recent.all(n) as AuditRow[]).map(r => viewAudit(r));

/** "Reset workspace": every document back to its default. Accounts, research, articles and the audit log stay. */
export function resetWorkspace(): void {
  qd.clear.run();
}

/* ---------- Read notifications ---------- */

const READ_MAX = 300;
const qn = {
  list: db.prepare('SELECT key FROM notif_reads WHERE user_id = ? ORDER BY at DESC, key LIMIT ?'),
  add: db.prepare('INSERT OR IGNORE INTO notif_reads (user_id, key, at) VALUES (?, ?, ?)'),
  trim: db.prepare('DELETE FROM notif_reads WHERE user_id = ? AND key NOT IN (SELECT key FROM notif_reads WHERE user_id = ? ORDER BY at DESC LIMIT ?)'),
  clear: db.prepare('DELETE FROM notif_reads WHERE user_id = ?'),
};
export const readKeys = (userId: number): string[] => (qn.list.all(userId, READ_MAX) as { key: string }[]).map(r => r.key).reverse();
export function addReadKeys(userId: number, keys: string[]): void {
  const now = Date.now();
  for (const k of keys) qn.add.run(userId, k, now);
  qn.trim.run(userId, userId, READ_MAX);
}
export const clearReadKeys = (userId: number) => qn.clear.run(userId);

/* ---------- What other server modules read from the workspace ---------- */

/** A site as the server needs it (from the sites document). */
export type SiteInfo = { id: string; domain: string; country: string; cc: string; lang: string; topic: string; status: string };
export function siteList(): SiteInfo[] {
  const d = getDoc('sites').data;
  if (!Array.isArray(d)) return [];
  const s = (v: Json | undefined) => typeof v === 'string' ? v : '';
  return d.filter(isObj).map(o => ({ id: s(o.id), domain: s(o.domain), country: s(o.country), cc: s(o.cc), lang: s(o.lang), topic: s(o.topic), status: s(o.status) }))
    .filter(x => x.id && x.domain);
}
export const siteInfo = (id: string): SiteInfo | undefined => siteList().find(x => x.id === id);
/** The Settings document as stored (the app's defaults apply to anything missing). */
export const settingsDoc = (): Obj => settings();
/** The alert table: event -> [In-app, Email, Slack, Telegram]. Null when never saved (the app's defaults apply). */
export function notifyPrefsDoc(): Record<string, boolean[]> | null {
  const d = getDoc('notifyPrefs').data;
  if (!isObj(d)) return null;
  const out: Record<string, boolean[]> = {};
  for (const [k, v] of Object.entries(d)) if (Array.isArray(v)) out[k] = v.map(x => x === true);
  return out;
}

/* ---------- What each role gets of the workspace ---------- */

/** The Settings a native reviewer's screen uses: what Article review shows and how their own session behaves. */
const REVIEWER_SETTINGS = ['native', 'apDeploy', 'twofa', 'timeout'] as const;
const HIDDEN: Doc = { version: 0, data: null };
/**
 * A document as one person may see it. Everyone but a native reviewer gets it whole. A reviewer gets their own site
 * only, the few settings their screen needs, and nothing of the rest (report recipients, budget, agents, schedules,
 * alert preferences): `null` data, for which the app shows its defaults. Returns null when the person gets no
 * news of this document at all (the event stream then stays silent).
 */
export function docFor(u: { role: string; site: string }, id: DocId, doc: Doc): Doc | null {
  if (u.role !== 'reviewer') return doc;
  switch (id) {
    case 'sites': return { version: doc.version, data: Array.isArray(doc.data) ? doc.data.filter(x => isObj(x) && !!u.site && x.id === u.site) : doc.data };
    case 'reviewModes': return { version: doc.version, data: isObj(doc.data) ? Object.fromEntries(Object.entries(doc.data).filter(([site]) => !!u.site && site === u.site)) : doc.data };
    case 'settings': {
      if (!isObj(doc.data)) return doc;
      const all = doc.data;
      return { version: doc.version, data: Object.fromEntries(REVIEWER_SETTINGS.flatMap(k => k in all ? [[k, all[k]!]] : [])) };
    }
    default: return null;
  }
}
export function docsFor(u: { role: string; site: string }): Record<DocId, Doc> {
  const all = allDocs();
  return Object.fromEntries(DOC_IDS.map(id => [id, docFor(u, id, all[id]) ?? HIDDEN])) as Record<DocId, Doc>;
}

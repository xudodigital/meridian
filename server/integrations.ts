// The services Meridian connects to: what each one asks for, how it is stored, and what the dashboard may see.
// Secret fields are encrypted together in one sealed value (vault.ts) and never leave the server; the dashboard gets
// the last four characters (or the connected account), the non-secret fields and the result of the last test.
import { db } from './db.ts';
import { open, seal } from './vault.ts';

export type FieldDef = {
  k: string; label: string; secret: boolean; optional?: boolean; placeholder?: string;
  kind?: 'text' | 'url' | 'number' | 'email';
  /** A value used when the field is left empty. */
  fallback?: string;
};
export type IntegrationDef = {
  id: string; name: string; fields: FieldDef[];
  /** Connected through Google sign-in instead of a form. */
  oauth?: boolean;
  /** Works without anything stored (with lower limits). */
  worksWithout?: string;
  /** One or two sentences under the form: where the values come from, and what Meridian does with them. */
  help: string;
};

export const DEFS: readonly IntegrationDef[] = [
  { id: 'openai', name: 'OpenAI API', fields: [{ k: 'key', label: 'API key', secret: true, placeholder: 'sk-…' }],
    help: 'From platform.openai.com > API keys. Agent jobs use this encrypted key through the OpenAI Responses API. Test connection lists available models.' },
  { id: 'dfs', name: 'DataForSEO', fields: [{ k: 'login', label: 'API login', secret: false, kind: 'email' }, { k: 'password', label: 'API password', secret: true }],
    help: 'From app.dataforseo.com > API Access. This is the API password, not the password you sign in with. Test connection shows the balance.' },
  { id: 'cf', name: 'Cloudflare', fields: [{ k: 'token', label: 'API token', secret: true }, { k: 'account', label: 'Account ID (needed to deploy)', secret: false, optional: true, placeholder: '32 characters, from the account home page' }],
    help: 'Create a token at dash.cloudflare.com > My Profile > API Tokens with the permission Account > Cloudflare Pages > Edit. The Account ID is required to deploy websites to Cloudflare Pages. Add Zone > Zone > Read and Zone > DNS > Edit only if you will connect custom domains whose DNS is at Cloudflare in this account: Meridian then adds the DNS record of each site itself. Without them it shows the record to add by hand. Test connection checks the token and whether Pages deploys will work.' },
  { id: 'probe', name: 'Multi-country probes', fields: [{ k: 'token', label: 'Globalping token (optional)', secret: true }],
    worksWithout: 'Works without a token at the public limit of 250 tests an hour.',
    help: 'Access checks run on the Globalping network, from probes inside each target country. A free token from dash.globalping.io raises the limit to 500 tests an hour.' },
  { id: 'slack', name: 'Slack', fields: [{ k: 'webhook', label: 'Incoming webhook URL', secret: true, kind: 'url', placeholder: 'https://hooks.slack.com/services/…' }],
    help: 'In Slack: Apps > Incoming Webhooks > Add to a channel, then copy the webhook URL. Test connection posts a short message to that channel.' },
  { id: 'tg', name: 'Telegram', fields: [{ k: 'token', label: 'Bot token', secret: true, placeholder: '123456:ABC…' }, { k: 'chat', label: 'Chat ID', secret: false, placeholder: '-1001234567890' }],
    help: 'Create a bot with @BotFather, add it to the group, and use the group\'s chat ID. Test connection sends a short message to that chat.' },
  { id: 'email', name: 'Email (SMTP)', fields: [
    { k: 'host', label: 'SMTP server', secret: false, placeholder: 'smtp.gmail.com' },
    { k: 'port', label: 'Port', secret: false, kind: 'number', placeholder: '587', fallback: '587' },
    { k: 'user', label: 'User name', secret: false, kind: 'email' },
    { k: 'pass', label: 'Password or app password', secret: true },
    { k: 'from', label: 'From address (optional)', secret: false, kind: 'email', optional: true },
  ], help: 'Port 587 uses STARTTLS and port 465 uses TLS. For Gmail, use an app password. Test connection sends a test email to you.' },
  { id: 'google', name: 'Google sign-in', fields: [{ k: 'clientId', label: 'OAuth client ID', secret: false, placeholder: '…apps.googleusercontent.com' }, { k: 'clientSecret', label: 'OAuth client secret', secret: true }],
    help: 'In Google Cloud Console: enable the Search Console API, the Google Analytics Admin API and the Google Analytics Data API, then create an OAuth client of type "Web application" with the redirect URI shown here.' },
  { id: 'gsc', name: 'Google Search Console', fields: [], oauth: true, help: 'Read-only access to the Search Console properties of the Google account you choose.' },
  { id: 'ga4', name: 'Google Analytics 4', fields: [], oauth: true, help: 'Read-only access to the Analytics properties of the Google account you choose.' },
];
export const defOf = (id: string): IntegrationDef | undefined => DEFS.find(d => d.id === id);

export type IntegrationRow = {
  id: string; secret: string; config: string; tail: string; status: string; msg: string; tested_at: number | null; updated_at: number; updated_by: string;
};
export type Status = '' | 'ok' | 'warn' | 'bad';

/** What the dashboard gets for one service. Never a secret. */
export type IntegrationView = {
  id: string; name: string; connected: boolean; tail: string; status: Status; msg: string; testedAt: number | null;
  updatedAt: number | null; updatedBy: string; config: Record<string, string>;
  fields: Omit<FieldDef, 'fallback'>[]; oauth: boolean; worksWithout: string; help: string;
};

const qi = {
  get: db.prepare('SELECT * FROM integrations WHERE id = ?'),
  all: db.prepare('SELECT * FROM integrations'),
  upsert: db.prepare(`INSERT INTO integrations (id, secret, config, tail, status, msg, tested_at, updated_at, updated_by) VALUES (?, ?, ?, ?, '', '', NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET secret = excluded.secret, config = excluded.config, tail = excluded.tail, status = '', msg = '', tested_at = NULL,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by`),
  result: db.prepare('UPDATE integrations SET status = ?, msg = ?, tested_at = ?, tail = CASE WHEN ? <> \'\' THEN ? ELSE tail END WHERE id = ?'),
  remove: db.prepare('DELETE FROM integrations WHERE id = ?'),
  /* A renewed token: the values change, the test result stays. */
  refresh: db.prepare('UPDATE integrations SET secret = ?, config = ? WHERE id = ?'),
};

const parse = (s: string): Record<string, string> => {
  try { const v: unknown = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string> : {}; }
  catch { return {}; }
};
export const rowOf = (id: string): IntegrationRow | undefined => qi.get.get(id) as IntegrationRow | undefined;

/** Every stored value of a service, secret ones decrypted. Null when nothing is stored. Server use only. */
export function valuesOf(id: string): Record<string, string> | null {
  const r = rowOf(id);
  if (!r) return null;
  let secret: Record<string, string> = {};
  try { secret = parse(open(r.secret)); } catch { return null; }
  return { ...parse(r.config), ...secret };
}

/** "API password" stays as it is; "Bot token" becomes "bot token". */
const lowerFirst = (v: string): string => /^[A-Z]{2}/.test(v) ? v : v.charAt(0).toLowerCase() + v.slice(1);
const last4 = (v: string): string => v.length > 8 ? v.slice(-4) : '';
/** What the card shows for stored values before any test: the last 4 characters of the main secret, or the account. */
function tailOf(def: IntegrationDef, v: Record<string, string>): string {
  switch (def.id) {
    case 'dfs': return v.login ?? '';
    case 'tg': return v.chat ? 'Chat ' + v.chat : '';
    case 'email': return v.from || v.user || '';
    case 'google': return v.clientId ? v.clientId.slice(0, 12) + '…' : '';
    case 'gsc': case 'ga4': return v.account || 'Google account';
    default: { const main = def.fields.find(f => f.secret); return main ? last4(v[main.k] ?? '') : ''; }
  }
}

/** A value for one field, or why it cannot be used. */
function fieldError(f: FieldDef, v: string): string {
  if (f.kind === 'number' && v && !/^\d{1,5}$/.test(v)) return `${f.label} must be a number.`;
  if (f.kind === 'email' && v && f.k !== 'user' && f.k !== 'login' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return `${f.label} must be an email address.`;
  if (f.kind === 'url' && v) {
    let u: URL; try { u = new URL(v); } catch { return `${f.label} must be a full URL.`; }
    const local = u.protocol === 'http:' && u.hostname === '127.0.0.1' && !!process.env.MERIDIAN_ALLOW_LOCAL_HOOKS;
    if (u.protocol !== 'https:' && !local) return `${f.label} must start with https://.`;
  }
  if (f.secret && v && v.length < 8 && f.k !== 'pass') return `${f.label} looks too short. Paste the whole value.`;
  return '';
}

/**
 * Stores a service's values. A field left empty keeps what is stored (so a form can change one field), or takes its
 * fallback; a required field that ends up empty is refused. Returns the error, or null when stored.
 */
export function saveValues(id: string, input: Record<string, unknown>, by: string): string | null {
  const def = defOf(id);
  if (!def || def.oauth) return 'This service cannot be set up with a form.';
  const old = valuesOf(id) ?? {};
  const next: Record<string, string> = {};
  let changed = false;
  for (const f of def.fields) {
    const raw = typeof input[f.k] === 'string' ? (input[f.k] as string).trim() : '';
    if (raw.length > 2000) return `${f.label} is too long.`;
    const err = fieldError(f, raw); if (err) return err;
    if (raw) changed = true;
    const v = raw || old[f.k] || f.fallback || '';
    if (!v && !f.optional && !(def.worksWithout)) return `Enter the ${lowerFirst(f.label.replace(/ \(optional\)$/, ''))}.`;
    if (v) next[f.k] = v;
  }
  if (!changed) return 'Enter the values to save.';
  storeValues(def, next, by);
  return null;
}

/** Writes values as they are (also used for Google tokens). Resets the test result. */
export function storeValues(def: IntegrationDef, values: Record<string, string>, by: string): void {
  const { secret, config } = split(def, values);
  qi.upsert.run(def.id, secret, config, tailOf(def, values), Date.now(), by);
}
/** Replaces the stored values without touching the test result (a renewed Google access token). */
export function refreshValues(def: IntegrationDef, values: Record<string, string>): void {
  const { secret, config } = split(def, values);
  qi.refresh.run(secret, config, def.id);
}
function split(def: IntegrationDef, values: Record<string, string>): { secret: string; config: string } {
  const secretKeys = new Set(def.oauth ? ['refresh', 'access', 'accessExp'] : def.fields.filter(f => f.secret).map(f => f.k));
  const secret: Record<string, string> = {}, config: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) (secretKeys.has(k) ? secret : config)[k] = v;
  return { secret: seal(JSON.stringify(secret)), config: JSON.stringify(config) };
}

/** Records the result of a test. `tail` replaces what the card shows (for example the connected account), when given. */
export const setResult = (id: string, status: Status, msg: string, tail = '') => qi.result.run(status, msg, Date.now(), tail, tail, id);
export const removeValues = (id: string): boolean => Number(qi.remove.run(id).changes) > 0;

/** A service is usable: something is stored (or it works without), and the last test did not fail. */
export function usable(id: string): boolean {
  const def = defOf(id); if (!def) return false;
  const r = rowOf(id);
  if (!r) return !!def.worksWithout;
  return r.status !== 'bad';
}

export function viewOf(def: IntegrationDef, r: IntegrationRow | undefined, admin: boolean): IntegrationView {
  const config = r ? parse(r.config) : {};
  return {
    id: def.id, name: def.name, connected: !!r || !!def.worksWithout,
    /* The end of a key, an SMTP user or a chat id tells a reader which account it is: for admins only. */
    tail: r ? (admin ? r.tail : '') : def.worksWithout ? 'Public access' : '',
    status: (r?.status ?? '') as Status, msg: r ? r.msg : '', testedAt: r?.tested_at ?? null,
    updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? '',
    /* Only admins open Integrations; others learn what is connected, not how. */
    config: admin ? config : {},
    fields: def.fields.map(({ fallback: _f, ...f }) => f), oauth: !!def.oauth, worksWithout: def.worksWithout ?? '', help: def.help,
  };
}

export function listViews(admin: boolean): IntegrationView[] {
  const rows = new Map((qi.all.all() as IntegrationRow[]).map(r => [r.id, r]));
  return DEFS.map(d => viewOf(d, rows.get(d.id), admin));
}
export const viewById = (id: string, admin: boolean): IntegrationView | null => { const d = defOf(id); return d ? viewOf(d, rowOf(id), admin) : null; };

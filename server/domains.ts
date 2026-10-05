// A site's own domain on its Cloudflare Pages project. After a production deploy the domain is attached to the project
// (cfpages.ts addPagesDomain); when its zone is in the same Cloudflare account and the token may edit DNS, the proxied
// CNAME to the project is added; then Cloudflare's validation and certificate are polled in the background, with
// backoff, for up to 24 hours. The state of each site is one row in site_domains, so a restart goes on where it was.
// When Cloudflare reports the domain active and the site answers over HTTPS from this computer, the site's status in
// the sites document becomes "live", which also turns on the 6-hourly access recheck (probe.ts), and a first access
// check is started.
//
// Careful with DNS: the only record ever changed is one this server created itself (its id is stored in the row).
// Any other record at the name is reported and left alone, and nothing is ever deleted: not a DNS record, not a
// domain of a project, not a project. Removing a site in Meridian leaves all of that at Cloudflare as it is.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mayWrite, seesSite, type Ctx } from './access.ts';
import {
  PagesError, addPagesDomain, createCname, dnsRecordsAt, findZone, getPagesDomain, projectName, repairCname, retryPagesDomain,
  type CfAuth, type DnsRecord, type PagesDomain,
} from './cfpages.ts';
import { db } from './db.ts';
import { bus } from './events.ts';
import { json } from './http.ts';
import { usable, valuesOf } from './integrations.ts';
import { costlyActions, slowDownMessage } from './limits.ts';
import { short } from './net.ts';
import { checkSite } from './probe.ts';
import type { UserRow } from './users.ts';
import { addAudit, getDoc, putDoc, siteInfo, siteList, type Json, type SiteInfo } from './workspace.ts';

/** none: not attached · dns: waiting for the DNS to point at the project · cert: Cloudflare is issuing the certificate ·
    live: active and answering over HTTPS · error: stopped, a person has to do something. */
export type DomainStatus = 'none' | 'dns' | 'cert' | 'live' | 'error';
/** Why it waits or stopped, for the words the dashboard shows. */
export type DomainProblem = '' | 'cloudflare' | 'token' | 'permission' | 'account' | 'dns-permission' | 'zone-other-account' | 'conflict' | 'caa'
  | 'in-use' | 'validation' | 'removed' | 'https' | 'network' | 'timeout';
/** A DNS record as the dashboard shows it for copying. */
export type RecordView = { type: string; name: string; content: string; proxied: boolean };
export type DomainView = {
  siteId: string; domain: string; project: string; status: DomainStatus; problem: DomainProblem;
  /** One or two plain sentences: where it is and what, if anything, the person should do. */
  message: string;
  /** Cloudflare's own status of the domain (initializing | pending | active | …), and how it validates (http | txt). */
  cfStatus: string; method: string;
  /** The TXT record Cloudflare asks for when it validates by TXT. */
  txt: { name: string; value: string } | null;
  /** Who puts the DNS record in place: Meridian did, or the person has to (then `record` is what to add). */
  dnsBy: '' | 'meridian' | 'you';
  record: RecordView | null;
  /** The project's own address, which works as soon as the first deploy is live. */
  pagesUrl: string;
  checkedAt: number | null; startedAt: number | null; liveAt: number | null;
  /** When the background check runs next; null when it is not waiting for anything. */
  nextCheckAt: number | null;
  updatedAt: number;
};

type Row = {
  site_id: string; domain: string; project: string; status: string; problem: string; error: string; cf_status: string;
  method: string; txt_name: string; txt_value: string; dns_by: string; record: string; zone_id: string; zone_name: string; record_id: string;
  pages_url: string; attached: number; started_at: number | null; checked_at: number | null; next_check_at: number | null; tries: number;
  live_at: number | null; updated_at: number;
};

const q = {
  get: db.prepare('SELECT * FROM site_domains WHERE site_id = ?'),
  all: db.prepare('SELECT * FROM site_domains'),
  due: db.prepare(`SELECT site_id FROM site_domains WHERE next_check_at IS NOT NULL AND next_check_at <= ? ORDER BY next_check_at LIMIT 20`),
  put: db.prepare(`INSERT INTO site_domains (site_id, domain, project, status, problem, error, cf_status, method, txt_name, txt_value, dns_by, record,
      zone_id, zone_name, record_id, pages_url, attached, started_at, checked_at, next_check_at, tries, live_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (site_id) DO UPDATE SET domain = excluded.domain, project = excluded.project, status = excluded.status, problem = excluded.problem,
      error = excluded.error, cf_status = excluded.cf_status, method = excluded.method, txt_name = excluded.txt_name, txt_value = excluded.txt_value,
      dns_by = excluded.dns_by, record = excluded.record, zone_id = excluded.zone_id, zone_name = excluded.zone_name, record_id = excluded.record_id,
      pages_url = excluded.pages_url, attached = excluded.attached, started_at = excluded.started_at, checked_at = excluded.checked_at,
      next_check_at = excluded.next_check_at, tries = excluded.tries, live_at = excluded.live_at, updated_at = excluded.updated_at`),
  /* Read only: the build of the site's current domain that is live now (builds.ts owns the table). */
  liveBuild: db.prepare(`SELECT deploy_url FROM site_builds WHERE site_id = ? AND lower(domain) = lower(?) AND deploy = 'live' ORDER BY version DESC LIMIT 1`),
};
const rowOf = (siteId: string): Row | undefined => q.get.get(siteId) as Row | undefined;
const fresh = (siteId: string, domain: string): Row => ({
  site_id: siteId, domain, project: '', status: 'none', problem: '', error: '', cf_status: '', method: '', txt_name: '', txt_value: '', dns_by: '', record: '',
  zone_id: '', zone_name: '', record_id: '', pages_url: '', attached: 0, started_at: null, checked_at: null, next_check_at: null, tries: 0, live_at: null, updated_at: 0,
});
function store(r: Row): void {
  r.updated_at = Math.max(Date.now(), r.updated_at + 1);
  q.put.run(r.site_id, r.domain, r.project, r.status, r.problem, r.error, r.cf_status, r.method, r.txt_name, r.txt_value, r.dns_by, r.record,
    r.zone_id, r.zone_name, r.record_id, r.pages_url, r.attached, r.started_at, r.checked_at, r.next_check_at, r.tries, r.live_at, r.updated_at);
}
/** Stores the row and tells the open dashboards. */
function save(r: Row): DomainView {
  store(r);
  const v = viewOf(r);
  bus.emit('domain', v);
  return v;
}

const DEPLOYER = { name: 'Deploy & Monitor', id: null };
const audit = (act: string, site: string) => bus.emit('audit', addAudit(DEPLOYER, act, site));

/* ---------- Words ---------- */

const CONNECT_CF = 'Connect Cloudflare in Integrations first: an API token with Cloudflare Pages: Edit and the Account ID.';
const DEPLOY_FIRST = 'Deploy the website first. Its domain is connected right after the first deploy.';
const AGAIN = 'then press Check again';

function parseRecord(text: string): RecordView | null {
  try {
    const v = JSON.parse(text) as Partial<RecordView> | null;
    return v && typeof v.type === 'string' && typeof v.name === 'string' && typeof v.content === 'string' ? { type: v.type, name: v.name, content: v.content, proxied: v.proxied === true } : null;
  } catch { return null; }
}

/** What the card says for a row. Composed here, in one place, from the stored facts. */
function messageOf(r: Row): string {
  const d = r.domain, says = r.error ? ` Cloudflare says: ${r.error}.` : '';
  const tail = r.problem === 'timeout' ? ` Meridian stopped checking after 24 hours: fix the DNS, ${AGAIN}.`
    : r.problem === 'network' ? ' The last check could not reach Cloudflare; Meridian tries again by itself.' : '';
  switch (r.status as DomainStatus) {
    case 'live': return `Live on https://${d}`;
    case 'cert':
      if (r.problem === 'https') return `Cloudflare reports ${d} as active, but https://${d} did not answer from this computer yet. Meridian keeps checking.` + tail;
      return `The DNS of ${d} points at the site. Cloudflare is issuing the certificate, which usually takes a few minutes.` + tail;
    case 'dns': {
      const txt = r.method === 'txt' && r.txt_name ? ' Cloudflare also asks for the TXT record below before it issues the certificate.' : '';
      if (r.dns_by === 'meridian') return `Meridian added the DNS record for ${d}. Waiting for Cloudflare to see it, which usually takes a few minutes.` + txt + tail;
      if (r.problem === 'dns-permission') {
        return `The Cloudflare token may not edit the DNS of ${r.zone_name || d}. Give the token Zone > Zone > Read and Zone > DNS > Edit in the Cloudflare dashboard, ${AGAIN}; or add the record below yourself in Cloudflare DNS.` + txt + tail;
      }
      if (r.problem === 'zone-other-account') {
        return `${r.zone_name || d} is a zone in another Cloudflare account than the one Meridian deploys to. Add the record below in that account, ${AGAIN}.` + txt + tail;
      }
      if (r.dns_by === 'you') {
        const apex = d.split('.').length === 2 ? ' If your DNS provider does not allow a CNAME on the bare domain, move its DNS to Cloudflare in this account or use www.' : '';
        return `The DNS of ${d} is not in this Cloudflare account. Add the record below where its DNS is managed, ${AGAIN}.` + apex + txt + tail;
      }
      return `Waiting for the DNS of ${d} to point at the site.` + txt + tail;
    }
    case 'error':
      if (r.problem === 'conflict') return r.error;
      if (r.problem === 'caa') {
        return `A CAA record of ${d} stops Cloudflare from issuing the certificate.${says} Allow Let's Encrypt, Google Trust Services and SSL.com in the CAA records (letsencrypt.org, pki.goog, ssl.com), or remove the CAA records, ${AGAIN}.`;
      }
      if (r.problem === 'validation') return `Cloudflare could not validate ${d}${r.error ? ': ' + r.error : ''}. Fix it in the Cloudflare dashboard or at the DNS provider, ${AGAIN}.`;
      if (r.problem === 'cloudflare') return CONNECT_CF;
      /* token, permission, account, in-use: the sentence cfpages.ts wrote. */
      return r.error || `Something is wrong with ${d} at Cloudflare. Press Check again.`;
    default:
      if (r.problem === 'removed') return `${d} is no longer connected to the Pages project at Cloudflare. Press Check again to connect it.`;
      if (r.problem === 'cloudflare') return CONNECT_CF;
      return r.error || `${d} is not connected to the Pages project yet.`;
  }
}

function viewOf(r: Row): DomainView {
  const status = (['none', 'dns', 'cert', 'live', 'error'].includes(r.status) ? r.status : 'none') as DomainStatus;
  const waiting = status === 'dns' || (status === 'error' && r.problem === 'conflict');
  return {
    siteId: r.site_id, domain: r.domain, project: r.project, status, problem: r.problem as DomainProblem, message: messageOf(r),
    cfStatus: r.cf_status, method: r.method,
    txt: status !== 'live' && r.method === 'txt' && r.txt_name && r.txt_value ? { name: r.txt_name, value: r.txt_value } : null,
    dnsBy: r.dns_by === 'meridian' || r.dns_by === 'you' ? r.dns_by : '',
    /* The record to add is shown while it is the person's to add (or to put right). */
    record: waiting && r.dns_by !== 'meridian' ? parseRecord(r.record) : null,
    pagesUrl: r.pages_url, checkedAt: r.checked_at, startedAt: r.started_at, liveAt: r.live_at, nextCheckAt: r.next_check_at, updatedAt: r.updated_at,
  };
}

/** The domain state of every site that still has that domain, for GET /api/state. Native reviewers get none. */
export function domainsState(u: UserRow): DomainView[] {
  if (u.role === 'reviewer') return [];
  const sites = new Map(siteList().map(s => [s.id, s.domain.toLowerCase()]));
  return (q.all.all() as Row[]).filter(r => sites.get(r.site_id) === r.domain && seesSite(u, r.site_id)).map(viewOf);
}

/* ---------- Timing ---------- */

/** One unit of the poll backoff: 15 s; the tests shorten it. */
const unit = () => Number(process.env.MERIDIAN_DOMAIN_POLL_MS) || 15_000;
/** 15 s, 30 s, 1, 2 and 5 minutes, then every 10 minutes. */
const BACKOFF = [1, 2, 4, 8, 20, 40];
/** How long the background check keeps asking, from the attach or the last "Check again". The tests shorten it. */
const giveUpMs = () => Number(process.env.MERIDIAN_DOMAIN_GIVE_UP_MS) || 24 * 60 * 60_000;
export const pollDelay = (tries: number): number => unit() * BACKOFF[Math.min(Math.max(tries, 0), BACKOFF.length - 1)]!;

/** Sets when the row is looked at next, or stops when 24 hours have passed without it going live. */
function scheduleNext(r: Row, now: number): void {
  if (r.status !== 'dns' && r.status !== 'cert') { r.next_check_at = null; return; }
  if (now - (r.started_at ?? now) >= giveUpMs()) { r.next_check_at = null; r.problem = 'timeout'; return; }
  r.next_check_at = now + pollDelay(r.tries);
  r.tries++;
}

/* ---------- The site answers over HTTPS ---------- */

/**
 * One request from this computer: the site answers on its own domain with a valid certificate. The tests point
 * MERIDIAN_DOMAIN_HTTPS_URL at their fake, which answers for <base>/<domain>/.
 */
async function answersHttps(domain: string): Promise<boolean> {
  const over = process.env.MERIDIAN_DOMAIN_HTTPS_URL;
  const url = over ? `${over.replace(/\/+$/, '')}/${encodeURIComponent(domain)}/` : `https://${domain}/`;
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Meridian/1.0' } });
    /* Cloudflare answers 5xx (522, 525, 526) while the domain is not served yet. */
    return r.status < 500;
  } catch { return false; }
}

/* ---------- DNS ---------- */

type DnsOutcome = { by: '' | 'meridian' | 'you'; problem: DomainProblem; error: string; zoneId: string; zoneName: string; recordId: string; note: string };
const sameHost = (a: string, b: string) => a.toLowerCase().replace(/\.$/, '') === b.toLowerCase().replace(/\.$/, '');
const ADDRESS = new Set(['A', 'AAAA', 'CNAME']);
const describe = (x: DnsRecord) => `${x.type === 'A' || x.type === 'AAAA' ? 'an ' : 'a '}${x.type} record to ${short(x.content, 80)}`;

/**
 * Puts the CNAME in place when the zone is in this account and the token may edit DNS; otherwise says who has to.
 * A record at the name that this server did not create is never changed: it is described (`conflict`) and left.
 */
async function ensureDns(a: CfAuth, r: Row, target: string): Promise<DnsOutcome> {
  const out: DnsOutcome = { by: 'you', problem: '', error: '', zoneId: '', zoneName: '', recordId: '', note: '' };
  const z = await findZone(a, r.domain);
  if (z.where === 'elsewhere') return out;
  if (z.where === 'unreadable') return { ...out, problem: 'dns-permission' };
  if (z.where === 'other') return { ...out, problem: 'zone-other-account', zoneName: z.name };
  out.zoneId = z.id; out.zoneName = z.name;
  const recs = await dnsRecordsAt(a, z.id, r.domain);
  if (recs === 'forbidden') return { ...out, problem: 'dns-permission' };
  const at = recs.filter(x => ADDRESS.has(x.type));
  const mine = (x: DnsRecord) => !!r.record_id && x.id === r.record_id && r.zone_id === z.id;
  if (!at.length) {
    const made = await createCname(a, z.id, r.domain, target);
    if (made === 'forbidden') return { ...out, problem: 'dns-permission' };
    if (made === 'exists') {
      return { ...out, problem: 'conflict', error: `${r.domain} already has a DNS record in Cloudflare that Meridian did not create, so Meridian left it alone. Change it yourself to a proxied CNAME to ${target}, or remove it, ${AGAIN}.` };
    }
    return { ...out, by: 'meridian', recordId: made.id, note: `Added the DNS record for ${r.domain} in Cloudflare: CNAME to ${target}, proxied` };
  }
  const only = at.length === 1 ? at[0]! : null;
  if (only && only.type === 'CNAME' && sameHost(only.content, target)) {
    /* Already right. Only Meridian's own record is touched, to turn the proxy back on. */
    if (!mine(only)) return { ...out, by: 'you' };
    if (!only.proxied) {
      const fixed = await repairCname(a, z.id, only.id, r.domain, target);
      if (fixed === 'forbidden') return { ...out, by: 'meridian', recordId: only.id, problem: 'dns-permission' };
      return { ...out, by: 'meridian', recordId: only.id, note: `Repaired the DNS record for ${r.domain} in Cloudflare: proxied again` };
    }
    return { ...out, by: 'meridian', recordId: only.id };
  }
  if (only && only.type === 'CNAME' && mine(only)) {
    const fixed = await repairCname(a, z.id, only.id, r.domain, target);
    if (fixed === 'forbidden') return { ...out, by: 'meridian', recordId: only.id, problem: 'dns-permission' };
    return { ...out, by: 'meridian', recordId: only.id, note: `Repaired the DNS record for ${r.domain} in Cloudflare: CNAME to ${target}, proxied` };
  }
  const what = at.slice(0, 3).map(describe).join(' and ') + (at.length > 3 ? ' and more' : '');
  return {
    ...out, problem: 'conflict',
    error: `${r.domain} already has ${what} in Cloudflare DNS that Meridian did not create, so Meridian left ${at.length === 1 ? 'it' : 'them'} alone. Change ${at.length === 1 ? 'it' : 'them'} yourself to one proxied CNAME to ${target}, or remove ${at.length === 1 ? 'it' : 'them'}, ${AGAIN}.`,
  };
}

/* ---------- The site goes live ---------- */

type Obj = { [key: string]: Json };
const isObj = (v: Json | undefined): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Sets the site's status to "live" in the sites document, the way a person's change is saved (versioned, announced to
 * every open dashboard). Only a site that is being set up changes; a paused one goes live when it is resumed.
 * Returns true when the document was changed.
 */
function promote(siteId: string, domain: string): boolean {
  for (let n = 0; n < 4; n++) {
    const doc = getDoc('sites');
    if (!Array.isArray(doc.data)) return false;
    const cur = doc.data.find((x): x is Obj => isObj(x) && x.id === siteId);
    if (!cur || typeof cur.domain !== 'string' || cur.domain.toLowerCase() !== domain) return false;
    let next: Obj;
    if (cur.status === 'build' || cur.status === 'dns') next = { ...cur, status: 'live' };
    else if (cur.status === 'paused' && (cur.prev === 'build' || cur.prev === 'dns')) next = { ...cur, prev: 'live' };
    else return false;
    const data = doc.data.map(x => x === cur ? next : x);
    /* 0: written by the server, not by a person. */
    const r = putDoc('sites', doc.version, data, 0);
    if (!r.ok) continue;
    bus.emit('workspace', { doc: 'sites', version: r.version, data });
    return next.status === 'live';
  }
  return false;
}

/** The first access check from inside the country, in the background; its result goes to the audit log like any other. */
function firstAccessCheck(site: SiteInfo): void {
  void checkSite(site.id, DEPLOYER.name).then(v => {
    if ('result' in v) audit(`Access check of ${site.domain}: ${v.summary}`, site.id);
  }, e => console.error('The first access check failed:', (e as Error).message));
}

/* ---------- One look at a site's domain ---------- */

/** deploy: after a production deploy · check: a person pressed "Check again" · poll: the background check. */
type Mode = 'deploy' | 'check' | 'poll';
const BAD = new Set(['error', 'blocked', 'deactivated']);

/** Reads Cloudflare's answer into the row: waiting for DNS, issuing the certificate, active, or an error in its words. */
function read(r: Row, d: PagesDomain): void {
  r.cf_status = d.status; r.method = d.method; r.txt_name = d.txtName; r.txt_value = d.txtValue;
  if (BAD.has(d.status) || d.validation === 'error' || BAD.has(d.verification)) {
    r.status = 'error'; r.error = d.error || `the domain is ${d.status}`;
    r.problem = /\bCAA\b/i.test(d.error) ? 'caa' : 'validation';
    return;
  }
  r.error = d.status === 'active' ? '' : d.error;
  r.status = d.status === 'active' ? 'cert' : d.verification === 'active' ? 'cert' : 'dns';
}

async function look(siteId: string, mode: Mode): Promise<DomainView | { error: string }> {
  const site = siteInfo(siteId);
  const had = rowOf(siteId);
  if (!site) {
    /* The site was removed from Meridian: stop asking. Everything at Cloudflare stays as it is. */
    if (had?.next_check_at) { had.next_check_at = null; store(had); }
    return { error: 'That site is not in the workspace.' };
  }
  const domain = site.domain.toLowerCase(), now = Date.now();
  /* A site whose domain was changed starts again; the old domain stays attached at Cloudflare. */
  const r = had && had.domain === domain ? had : fresh(siteId, domain);
  const wasLive = r.status === 'live', problemBefore = r.problem;
  const v = valuesOf('cf');
  if (!v?.token || !v.account || !usable('cf')) {
    if (mode === 'poll') { if (wasLive) return viewOf(r); scheduleNext(r, now); return save(r); }
    return { error: CONNECT_CF };
  }
  const live = q.liveBuild.get(siteId, site.domain) as { deploy_url: string } | undefined;
  if (!live) {
    if (mode === 'poll') { r.next_check_at = null; return save(r); }
    return { error: DEPLOY_FIRST };
  }
  const project = projectName(site.domain);
  const host = /^https:\/\/([a-z0-9.-]+)$/i.exec(live.deploy_url)?.[1]?.toLowerCase() ?? `${project}.pages.dev`;
  r.project = project; r.pages_url = 'https://' + host;
  r.record = JSON.stringify({ type: 'CNAME', name: domain, content: host, proxied: true } satisfies RecordView);
  const a: CfAuth = { account: v.account.trim(), token: v.token.trim() };
  try {
    let d = await getPagesDomain(a, project, domain);
    if (!d) {
      if (mode === 'poll') {
        /* Someone removed it at Cloudflare: say so and wait for a person, rather than attach it behind their back. */
        r.status = 'none'; r.problem = 'removed'; r.error = ''; r.cf_status = ''; r.attached = 0; r.checked_at = now; r.next_check_at = null;
        return save(r);
      }
      d = await addPagesDomain(a, project, domain);
      audit(`Connected ${domain} to the Cloudflare Pages project ${project}`, siteId);
      r.attached = 1; r.started_at = now; r.tries = 0;
    } else r.attached = 1;
    if (mode === 'check' || r.started_at === null) { r.started_at = now; r.tries = 0; }

    let dns: DnsOutcome | null = null;
    if (d.status !== 'active' && mode !== 'poll') {
      dns = await ensureDns(a, r, host);
      if (dns.note) audit(dns.note, siteId);
      r.dns_by = dns.by; r.zone_id = dns.zoneId; r.zone_name = dns.zoneName;
      if (dns.recordId) r.record_id = dns.recordId;
      /* The DNS was looked at again (or just put right): Cloudflare is asked to look again too. */
      if (mode === 'check' && dns.problem !== 'conflict') d = await retryPagesDomain(a, project, domain) ?? d;
    }
    r.problem = '';
    read(r, d);
    if (r.status !== 'error' && dns) {
      if (dns.problem === 'conflict') { r.status = 'error'; r.problem = 'conflict'; r.error = dns.error; }
      else if (r.status === 'dns') r.problem = dns.problem;
    } else if (r.status === 'dns' && !dns && (problemBefore === 'dns-permission' || problemBefore === 'zone-other-account')) {
      /* A background check does not look at the DNS again: who has to add the record is still true. */
      r.problem = problemBefore;
    }
    if (d.status === 'active') {
      if (wasLive || await answersHttps(domain)) { r.status = 'live'; r.problem = ''; r.error = ''; r.live_at ??= Date.now(); }
      else { r.status = 'cert'; r.problem = 'https'; }
    }
    r.checked_at = Date.now();
    scheduleNext(r, r.checked_at);
    const view = save(r);
    if (r.status === 'live' && !wasLive) {
      audit(`${domain} is live on its own domain, with a certificate from Cloudflare`, siteId);
      if (promote(siteId, domain)) {
        audit(`Set ${domain} to Live: it answers over HTTPS on its own domain`, siteId);
        firstAccessCheck({ ...site, status: 'live' });
      }
    }
    return view;
  } catch (e) {
    if (!(e instanceof PagesError)) throw e;
    /* A site that is live stays as it is shown: one failed look says nothing about the site. */
    if (wasLive) return viewOf(r);
    r.checked_at = Date.now();
    if (e.problem === 'network' || e.problem === 'stopped') {
      if (r.status === 'none' && mode !== 'poll') { r.status = 'error'; r.problem = 'network'; r.error = e.message; r.next_check_at = null; return save(r); }
      r.problem = 'network';
      r.started_at ??= r.checked_at;
      if (r.status === 'error' || r.status === 'none') r.next_check_at = null; else scheduleNext(r, r.checked_at);
      return save(r);
    }
    r.status = 'error'; r.error = e.message; r.next_check_at = null;
    r.problem = e.problem === 'token' || e.problem === 'permission' || e.problem === 'account' || e.problem === 'in-use' ? e.problem : 'validation';
    if (r.problem === 'validation') r.error = e.message.replace(/\.$/, '');
    return save(r);
  }
}

/** One look per site at a time; a second one waits for the first. */
const flights = new Map<string, Promise<unknown>>();
function run(siteId: string, mode: Mode): Promise<DomainView | { error: string }> {
  const before = flights.get(siteId) ?? Promise.resolve();
  const p = before.then(() => look(siteId, mode));
  const tail = p.catch(() => undefined);
  flights.set(siteId, tail);
  void tail.then(() => { if (flights.get(siteId) === tail) flights.delete(siteId); });
  return p;
}

/**
 * Called by the deploy job when a production deploy went live (also a rollback or a deploy of an older build): the
 * domain is attached if it is not yet, and otherwise left exactly as it is. Never throws and is not awaited: a
 * problem with the domain is shown on the Domain step, it does not fail the deploy.
 */
export function domainAfterDeploy(siteId: string): void {
  void run(siteId, 'deploy').catch(e => console.error('Connecting the domain failed:', (e as Error).message));
}

/** "Check again": looks at the DNS and asks Cloudflare to validate again, now. */
export const checkDomain = (siteId: string): Promise<DomainView | { error: string }> => run(siteId, 'check');

let ticker: ReturnType<typeof setInterval> | null = null;
/** The background check: every few seconds, the rows whose time has come (also those left waiting by a restart). */
export function scheduleDomains(): void {
  if (ticker) return;
  const pass = () => {
    let due: { site_id: string }[];
    try { due = q.due.all(Date.now()) as { site_id: string }[]; } catch { return; }
    for (const { site_id } of due) {
      if (flights.has(site_id)) continue;
      void run(site_id, 'poll').catch(e => console.error('The domain check failed:', (e as Error).message));
    }
  };
  ticker = setInterval(pass, Math.min(5000, unit()));
  ticker.unref();
}

/* ---------- Routes ---------- */

const CHECK = /^\/api\/sites\/([A-Za-z0-9_-]{1,64})\/domain\/check$/;

/** GET /api/domains and POST /api/sites/:id/domain/check. Returns false for any other path. */
export async function domainApi(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  const m = req.method || 'GET', u = ctx.user;
  if (m === 'GET' && path === '/api/domains') {
    if (u.role === 'reviewer') { json(res, 403, { error: 'Your role reviews articles only.' }); return true; }
    json(res, 200, { domains: domainsState(u) });
    return true;
  }
  const c = path.match(CHECK);
  if (!c || m !== 'POST') return false;
  const no = mayWrite(u);
  if (no) { json(res, no.status, { error: no.error }); return true; }
  const site = siteInfo(c[1]!);
  if (!site) { json(res, 404, { error: 'That site is not saved yet. Wait a moment and try again.' }); return true; }
  const wait = costlyActions.take('u' + u.id);
  if (wait) { json(res, 429, { error: slowDownMessage(wait) }); return true; }
  const r = await checkDomain(site.id);
  if ('error' in r) { json(res, 409, { error: r.error }); return true; }
  bus.emit('audit', addAudit({ name: u.name, id: u.id }, `Checked the domain ${site.domain} again: ${short(r.message, 300)}`, site.id));
  json(res, 200, { domain: r });
  return true;
}

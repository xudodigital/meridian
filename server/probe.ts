// Access checks from inside each site's country, on the Globalping probe network (api.globalping.io).
// Blocking happens at the local ISP or DNS level, so a site that opens fine from here can be unreachable there.
//
// One check: the domain's A records from public resolvers (1.1.1.1, 8.8.8.8) as the reference; then, from up to three
// probes in the country, an HTTPS request and a DNS lookup. When no probe gets through, the site is tried from this
// computer too: if it answers here, it is blocked there; if not, it is down. Results are stored (access_checks) and
// announced on the event stream; live sites are checked again every few hours (schedule()).
import { Resolver } from 'node:dns/promises';
import { db } from './db.ts';
import { bus } from './events.ts';
import { ServiceError, base, call, errorText, short } from './net.ts';
import { usable, valuesOf } from './integrations.ts';
import { alert } from './notify.ts';
import { siteInfo, siteList, type SiteInfo } from './workspace.ts';

export type AccessResult = 'ok' | 'blocked' | 'down' | 'error';
export type ProbeView = { place: string; network: string; dns: string; http: string; ok: boolean };
export type AccessView = {
  siteId: string; domain: string; cc: string; at: number; result: AccessResult; dns: string; http: string; summary: string; probes: ProbeView[]; by: string;
};
type Row = { id: number; site_id: string; domain: string; cc: string; at: number; result: string; dns: string; http: string; summary: string; detail: string; by: string };

const qc = {
  insert: db.prepare('INSERT INTO access_checks (site_id, domain, cc, at, result, dns, http, summary, detail, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  latest: db.prepare(`SELECT * FROM access_checks WHERE id IN (SELECT MAX(id) FROM access_checks GROUP BY site_id)`),
  latestFor: db.prepare('SELECT * FROM access_checks WHERE site_id = ? ORDER BY id DESC LIMIT 1'),
  trim: db.prepare('DELETE FROM access_checks WHERE site_id = ? AND id NOT IN (SELECT id FROM access_checks WHERE site_id = ? ORDER BY id DESC LIMIT 50)'),
};

const viewOf = (r: Row): AccessView => {
  let probes: ProbeView[] = [];
  try { const v: unknown = JSON.parse(r.detail); if (Array.isArray(v)) probes = v as ProbeView[]; } catch { /* stays empty */ }
  return { siteId: r.site_id, domain: r.domain, cc: r.cc, at: r.at, result: r.result as AccessResult, dns: r.dns, http: r.http, summary: r.summary, probes, by: r.by };
};
/** The newest check of every site. */
export const latestChecks = (): AccessView[] => (qc.latest.all() as Row[]).map(viewOf);
const latestFor = (siteId: string): AccessView | null => { const r = qc.latestFor.get(siteId) as Row | undefined; return r ? viewOf(r) : null; };

/** Site ids with a check running now. */
const running = new Set<string>();
export const checkingNow = (): string[] => [...running];

/* ---------- Globalping ---------- */

type GpProbe = { country?: string; city?: string; network?: string; asn?: number };
type GpResult = { probe?: GpProbe; result?: { status?: string; statusCode?: number; rawOutput?: string; answers?: { type?: string; value?: string }[]; statusCodeName?: string } };
type GpMeasurement = { id?: string; status?: string; results?: GpResult[] };

const authHeader = (): Record<string, string> => { const t = valuesOf('probe')?.token; return t ? { authorization: 'Bearer ' + t } : {}; };

/** Runs a measurement and waits for it. `same` reuses the probes of an earlier measurement (Globalping accepts its id as the location). */
async function measure(kind: 'http' | 'dns', domain: string, cc: string, same?: string): Promise<{ id: string; results: GpResult[] }> {
  const locations = same ?? [{ country: cc, limit: 3 }];
  const body = kind === 'http'
    ? { type: 'http', target: domain, locations, measurementOptions: { protocol: 'HTTPS', request: { method: 'HEAD', path: '/' } } }
    : { type: 'dns', target: domain, locations, measurementOptions: { query: { type: 'A' } } };
  const r = await call<GpMeasurement>('Globalping', base('GLOBALPING') + '/v1/measurements', { body, headers: authHeader() });
  if (r.status === 429) throw new ServiceError('The probe network\'s hourly limit is used up. Try again later, or add a Globalping token in Integrations.', 429);
  if (r.status === 422 && /no suitable probes|no probes/i.test(errorText(r.data))) throw new ServiceError('No probe is online in that country right now. Try again later.', 422);
  if (r.status === 401 || r.status === 403) throw new ServiceError('Globalping refused the token. Check it in Integrations.', r.status);
  if (r.status !== 202 && r.status !== 200 || !r.data.id) throw new ServiceError('Globalping answered ' + r.status + (errorText(r.data) ? ': ' + short(errorText(r.data), 120) : '.'), r.status);
  const end = Date.now() + 40_000;
  for (;;) {
    await new Promise(res => setTimeout(res, Number(process.env.MERIDIAN_PROBE_POLL_MS) || 1000));
    const m = await call<GpMeasurement>('Globalping', `${base('GLOBALPING')}/v1/measurements/${encodeURIComponent(r.data.id)}`);
    if (m.status === 200 && m.data.status !== 'in-progress' || Date.now() > end) return { id: r.data.id, results: m.data.results ?? [] };
  }
}

/* ---------- Reading the results ---------- */

/** An HTTP probe's outcome in a word or two. */
function httpWord(r: GpResult['result']): { word: string; ok: boolean } {
  if (!r) return { word: 'No result', ok: false };
  if (r.status === 'finished' && typeof r.statusCode === 'number') {
    return { word: String(r.statusCode), ok: r.statusCode < 400 };
  }
  const raw = (r.rawOutput ?? '').toLowerCase();
  if (r.status === 'offline') return { word: 'Probe offline', ok: false };
  if (/timeout|timed out|etimedout/.test(raw)) return { word: 'Timeout', ok: false };
  if (/econnreset|reset/.test(raw)) return { word: 'Reset', ok: false };
  if (/econnrefused|refused/.test(raw)) return { word: 'Refused', ok: false };
  if (/enotfound|getaddrinfo|eai_again/.test(raw)) return { word: 'No DNS', ok: false };
  if (/cert|tls|ssl/.test(raw)) return { word: 'TLS error', ok: false };
  return { word: 'Failed', ok: false };
}

const placeOf = (p: GpProbe | undefined): string => [p?.city, p?.country].filter(Boolean).join(', ') || 'Unknown place';
const isPrivate = (ip: string) => /^(10\.|127\.|0\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/** The DNS answer of one probe, compared with the public answer. */
function dnsWord(r: GpResult['result'], ref: Set<string>): { word: string; odd: boolean } {
  if (!r || r.status !== 'finished') return { word: 'Failed', odd: true };
  const ips = (r.answers ?? []).filter(a => a.type === 'A' && a.value).map(a => a.value!);
  if (!ips.length) return { word: r.statusCodeName && r.statusCodeName !== 'NOERROR' ? r.statusCodeName : 'No answer', odd: true };
  if (ips.some(ip => ref.has(ip))) return { word: 'Normal', odd: false };
  return { word: ips.some(isPrivate) ? 'Private IP ' + ips[0] : 'Different (' + ips[0] + ')', odd: true };
}

async function publicIps(domain: string): Promise<string[]> {
  const r = new Resolver({ timeout: 5000, tries: 2 });
  r.setServers((process.env.MERIDIAN_DNS_SERVERS || '1.1.1.1,8.8.8.8').split(','));
  try { return await r.resolve4(domain); } catch { return []; }
}

/** Whether the site answers from this computer (outside the country). */
async function answersHere(domain: string): Promise<boolean> {
  if (process.env.MERIDIAN_FAKE_HERE) return process.env.MERIDIAN_FAKE_HERE === 'up';
  try { const r = await fetch('https://' + domain + '/', { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) }); return r.status < 500; }
  catch { return false; }
}

const mostCommon = (xs: string[]): string => {
  const n = new Map<string, number>(); xs.forEach(x => n.set(x, (n.get(x) ?? 0) + 1));
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};

type Outcome = Omit<AccessView, 'siteId' | 'domain' | 'cc' | 'at' | 'by'>;

async function runCheck(s: SiteInfo): Promise<Outcome> {
  const ref = await publicIps(s.domain);
  if (!ref.length) {
    return { result: 'down', dns: 'No answer', http: '—', summary: `${s.domain} does not resolve on public DNS. Point the domain at the server first.`, probes: [] };
  }
  let http: GpResult[], dns: GpResult[];
  try {
    const h = await measure('http', s.domain, s.cc);
    http = h.results;
    /* The DNS lookup runs on the same probes, so each row of the result is one network. */
    dns = (await measure('dns', s.domain, s.cc, h.id)).results;
  }
  catch (e) { return { result: 'error', dns: '—', http: '—', summary: e instanceof ServiceError ? e.message : 'The check failed: ' + short((e as Error).message, 120), probes: [] }; }
  const refSet = new Set(ref);
  const same = (a: GpProbe | undefined, b: GpProbe | undefined) => !!a && !!b && a.asn === b.asn && a.city === b.city && a.network === b.network;
  const probes: ProbeView[] = http.map((h, i) => {
    const d = dns.find(x => same(x.probe, h.probe)) ?? dns[i];
    const hw = httpWord(h.result), dw = dnsWord(d?.result, refSet);
    return { place: placeOf(h.probe), network: h.probe?.network ?? '', dns: dw.word, http: hw.word, ok: hw.ok };
  });
  if (!probes.length) return { result: 'error', dns: '—', http: '—', summary: `No probe in ${s.country || s.cc} gave a result. Try again later.`, probes };
  const okN = probes.filter(p => p.ok).length, n = probes.length;
  const oddDns = dns.map(d => dnsWord(d.result, refSet)).filter(d => d.odd).length;
  const dnsCol = oddDns === 0 ? 'Normal' : oddDns === dns.length ? 'Different' : `Different on ${oddDns} of ${dns.length}`;
  const httpCol = okN === n ? mostCommon(probes.map(p => p.http)) : okN === 0 ? mostCommon(probes.map(p => p.http)) : `${okN} of ${n} OK`;
  const where = `from ${n === 1 ? 'a network' : n + ' networks'} in ${s.country || s.cc}`;
  if (okN === n) return { result: 'ok', dns: dnsCol, http: httpCol, summary: `Opens normally ${where}.`, probes };
  const failed = probes.filter(p => !p.ok);
  if (okN > 0) {
    /* Some networks open it. A failure there is a block only with a sign of interference: a different DNS answer, a
       reset or refused connection, or 403 / 451. A timeout alone on one network is more often the probe itself. */
    const signs = failed.filter(p => p.dns !== 'Normal' || /^(Reset|Refused|No DNS|TLS error|403|451)$/.test(p.http));
    const nets = (ps: ProbeView[]) => ps.map(p => `${p.network || p.place} (${p.http}${p.dns !== 'Normal' ? ', DNS ' + p.dns : ''})`).join(', ');
    return signs.length
      ? { result: 'blocked', dns: dnsCol, http: httpCol, summary: `Blocked on some networks in ${s.country || s.cc}: ${nets(signs)}. Other networks open it.`, probes }
      : { result: 'ok', dns: dnsCol, http: httpCol, summary: `Opens on ${okN} of ${n} networks in ${s.country || s.cc}. ${nets(failed)} failed without a sign of blocking, which is usually the probe itself.`, probes };
  }
  if (await answersHere(s.domain)) {
    return { result: 'blocked', dns: dnsCol, http: httpCol, summary: `Opens from outside the country but not ${where} (${mostCommon(probes.map(p => p.http))}${oddDns ? ', DNS answers differ' : ''}). This is the pattern of an ISP or DNS block.`, probes };
  }
  return { result: 'down', dns: dnsCol, http: httpCol, summary: `Does not open ${where}, nor from this computer. The site is down, not blocked.`, probes };
}

/** Checks one site now. Resolves to the stored check, or an error message (another check running, unknown site). */
export async function checkSite(siteId: string, by: string): Promise<AccessView | { error: string }> {
  const s = siteInfo(siteId);
  if (!s) return { error: 'That site is not in the workspace.' };
  if (!s.cc) return { error: 'This site has no target country.' };
  if (running.has(siteId)) return { error: 'A check of this site is already running.' };
  if (!usable('probe')) return { error: 'The probe network is not usable: test it in Integrations.' };
  running.add(siteId);
  bus.emit('access-running', { siteId, running: true });
  try {
    const before = latestFor(siteId);
    const o = await runCheck(s);
    const at = Date.now();
    const info = qc.insert.run(siteId, s.domain, s.cc, at, o.result, o.dns, o.http, o.summary, JSON.stringify(o.probes), by);
    qc.trim.run(siteId, siteId);
    const view: AccessView = { siteId, domain: s.domain, cc: s.cc, at, by, ...o };
    bus.emit('access', view);
    /* A new problem is an alert; the same problem found again is not. */
    if ((o.result === 'blocked' || o.result === 'down') && before?.result !== o.result) {
      alert('blocked', `access:${siteId}:${info.lastInsertRowid}`, siteId,
        o.result === 'blocked' ? `${s.domain} is blocked in ${s.country || s.cc}` : `${s.domain} is down`, o.summary, '/deploy');
    }
    return view;
  } finally {
    running.delete(siteId);
    bus.emit('access-running', { siteId, running: false });
  }
}

/* ---------- Schedule ---------- */

/** Live sites are checked again when their newest check is older than this. */
export const RECHECK_MS = 6 * 60 * 60_000;
let busy = false;

/** One pass: checks, one after another, the live sites whose newest check is too old. */
export async function scheduledPass(now = Date.now()): Promise<number> {
  if (busy || !usable('probe')) return 0;
  busy = true;
  let n = 0;
  try {
    const last = new Map(latestChecks().map(c => [c.siteId, c.at]));
    for (const s of siteList()) {
      if (s.status !== 'live' || !s.cc) continue;
      if (now - (last.get(s.id) ?? 0) < RECHECK_MS) continue;
      const r = await checkSite(s.id, 'Schedule');
      n++;
      /* Out of tests for this hour: stop, and try again on a later pass. */
      if ('result' in r && r.result === 'error' && /limit/.test(r.summary)) break;
    }
  } finally { busy = false; }
  return n;
}

export function schedule(): void {
  setInterval(() => { void scheduledPass().catch(e => console.error('Access check pass failed:', (e as Error).message)); }, 10 * 60_000).unref();
}

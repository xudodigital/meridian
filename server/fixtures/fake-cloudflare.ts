// Fake Cloudflare for the server tests: the token checks behind "Test connection" and every Pages Direct Upload call
// that cfpages.ts makes (project, upload token, check-missing, upload, upsert-hashes, deployments, status, logs).
// It is strict where a mistake would pass unnoticed at the real service: /pages/assets/* takes only an upload JWT it
// issued, and at deployment every manifest key must equal wrangler's hash of the uploaded content plus the path's
// extension (Cloudflare accepts any key, then serves nothing). Each mistake is answered with an error and recorded in
// `cf.problems`, so a test that deploys fails. `cf` holds the state and the switches; resetCloudflare() restores it.
//
// Custom domains (domains.ts): a project's domains (list, add, read, retry), zones by name, and the DNS records of a
// zone. A domain goes initializing → pending → active once its DNS points at the project: a CNAME in one of the fake's
// zones, or a name in `cf.externalDns` (the person added the record at another DNS provider). Deleting a domain or a
// DNS record, replacing a record (PUT), and changing a record that was not created through this API are mistakes
// Meridian must never make: each is recorded in `cf.problems`. /cloudflare-site/<domain>/ stands in for the site on
// its own domain: it answers 200 once the domain is active.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { blake3Hex } from '../blake3.ts';
import type { Hit } from './fake-services.ts';

/** The API token and Account ID the fake accepts. Save these as the Cloudflare integration in an end-to-end test. */
export const CF_TOKEN = 'cf-test-token-pages-edit';
export const CF_ACCOUNT = '0123456789abcdef0123456789abcdef';

export type FakeProject = { name: string; subdomain: string; production_branch: string; source: { type: string } | null; created_on: string };
export type FakeZone = { id: string; name: string; account: string };
export type FakeRecord = { id: string; zone: string; type: string; name: string; content: string; proxied: boolean; comment: string; /** Created through the API (by Meridian), not there before. */ byApi: boolean };
export type FakeDomain = { id: string; name: string; project: string; polls: number; seen: boolean; retries: number; created_on: string };
export type FakeDeployment = {
  id: string; short_id: string; project: string; branch: string; environment: 'production' | 'preview';
  manifest: Record<string, string>; parts: string[]; headers: string | null; redirects: string | null;
  polls: number; files: number; outcome: 'success' | 'failure';
};

function initial() {
  return {
    token: CF_TOKEN, account: CF_ACCOUNT,
    /** The token belongs to the account (it verifies at /accounts/{id}/tokens/verify, not at /user/tokens/verify). */
    accountToken: false,
    /** The token has Pages permission; false answers 403 (code 10000) on every /accounts/{id}/pages call. */
    pages: true,
    zones: 2,
    /** How long an upload JWT lives, and the file limit it carries (undefined: no such claim). */
    jwtSeconds: 300, maxFiles: undefined as number | undefined,
    /** Refuse the next N asset calls as if their JWT had expired (code 8000013). */
    refuseJwt: 0,
    /** Answer the next N uploads with a 503 gateway page. */
    failUploads: 0,
    /** Creating a project with one of these names answers 409. */
    takenNames: new Set<string>(),
    /** How the deploy stage ends, after how many status polls, and whether the deployment comes back without files. */
    outcome: 'success' as 'success' | 'failure', polls: 1, empty: false,
    projects: new Map<string, FakeProject>(),
    /** Stored assets by key: the base64 content and the content type it is served with. */
    assets: new Map<string, { value: string; contentType: string }>(),
    /** The keys of each upload request, the hashes of each upsert, and how many check-missing calls came. */
    uploads: [] as string[][], upserts: [] as string[][], checks: 0,
    /** Issued upload JWTs and their expiry (seconds). */
    jwts: new Map<string, number>(),
    deployments: [] as FakeDeployment[],
    /** Zones the token sees (zone() adds one), and what it may do with zones and DNS: 'edit' everything, 'read' (list
        zones and records, change nothing) or 'none' (no zone lookup, no records). */
    zoneList: [] as FakeZone[], dns: 'edit' as 'edit' | 'read' | 'none',
    records: [] as FakeRecord[],
    /** Custom domains by "<project>/<name>", and names another project already uses. */
    domains: new Map<string, FakeDomain>(), usedDomains: new Set<string>(),
    /** Names whose DNS at another provider points at the project. */
    externalDns: new Set<string>(),
    /** Reads of a domain, once its DNS is right, before its certificate is issued. */
    certPolls: 2,
    /** Validation method, and the names whose validation fails with this message. */
    validation: 'http' as 'http' | 'txt', domainErrors: new Map<string, string>(),
    /** Active names that still do not answer over HTTPS. */
    httpsDown: new Set<string>(),
    /** Mistakes the fake caught. A test that deploys expects this to stay empty. */
    problems: [] as string[],
  };
}
export const cf = initial();
export function resetCloudflare(): void { Object.assign(cf, initial()); }

let serial = 0;
const hex32 = () => randomBytes(16).toString('hex');
/** Adds a zone the token sees (in the fake's account unless another is given). Returns it. */
export function zone(name: string, account = cf.account): FakeZone {
  const z = { id: hex32(), name, account };
  cf.zoneList.push(z);
  return z;
}
/** Puts a DNS record in a zone as if a person had made it in the dashboard. */
export function record(z: FakeZone, type: string, name: string, content: string, proxied = false): FakeRecord {
  const r = { id: hex32(), zone: z.id, type, name, content, proxied, comment: '', byApi: false };
  cf.records.push(r);
  return r;
}
const pointsAt = (d: FakeDomain): boolean => {
  const sub = cf.projects.get(d.project)?.subdomain ?? '';
  return cf.externalDns.has(d.name) || cf.records.some(r => r.type === 'CNAME' && r.name === d.name && r.content.toLowerCase() === sub);
};
const domainActive = (d: FakeDomain): boolean => !cf.domainErrors.has(d.name) && pointsAt(d) && d.polls >= cf.certPolls;
function domainView(d: FakeDomain) {
  const err = cf.domainErrors.get(d.name), pointed = pointsAt(d);
  const status = err ? 'error' : !pointed ? (d.seen ? 'pending' : 'initializing') : domainActive(d) ? 'active' : 'pending';
  const validation: Record<string, unknown> = { method: cf.validation, status: err ? 'error' : status === 'active' ? 'active' : pointed ? 'pending' : 'initializing' };
  if (err) validation.error_message = err;
  if (cf.validation === 'txt') { validation.txt_name = '_acme-challenge.' + d.name; validation.txt_value = 'fake-txt-' + d.id.slice(0, 8); }
  const verification: Record<string, unknown> = { status: pointed ? 'active' : 'pending' };
  if (!pointed) verification.error_message = 'CNAME record not set';
  d.seen = true;
  return { id: d.id, domain_id: d.id, name: d.name, status, certificate_authority: 'google', created_on: d.created_on, zone_tag: cf.zoneList.find(z => d.name === z.name || d.name.endsWith('.' + z.name))?.id ?? '', validation_data: validation, verification_data: verification };
}
const recordView = (r: FakeRecord) => ({ id: r.id, type: r.type, name: r.name, content: r.content, proxied: r.proxied, proxiable: true, ttl: 1, comment: r.comment || null, tags: [] });

/** Environment variables pointing the server at this fake, with status polls of a few milliseconds instead of seconds. */
export function cloudflareEnv(url: (p: string) => string): Record<string, string> {
  return {
    MERIDIAN_URL_CLOUDFLARE: url('cloudflare'), MERIDIAN_CF_POLL_MS: '5',
    /* The background check of a custom domain in units of 20 ms instead of 15 s, and the site's own HTTPS at the fake. */
    MERIDIAN_DOMAIN_POLL_MS: '20', MERIDIAN_DOMAIN_HTTPS_URL: url('cloudflare-site'),
  };
}

/** The key wrangler gives a file: blake3(base64 content + extension without the dot), first 32 hex. Written out here
    on purpose rather than imported from cfpages.ts, so a mistake there cannot agree with itself. */
const wranglerKey = (base64: string, path: string) => blake3Hex(base64 + extname(path).slice(1)).slice(0, 32);
const HEX32 = /^[0-9a-f]{32}$/;
/* Types a browser must get right for the site to work; anything else only needs to be present. */
const MUST_TYPE: Record<string, string> = { html: 'text/html', css: 'text/css', svg: 'image/svg+xml', xml: 'application/xml' };

function multipart(body: string, type: string): Map<string, { value: string; file: boolean }> | null {
  const b = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type);
  if (!type.startsWith('multipart/form-data') || !b) return null;
  const out = new Map<string, { value: string; file: boolean }>();
  for (const part of body.split('--' + (b[1] ?? b[2])).slice(1)) {
    if (part.startsWith('--')) break;
    const at = part.indexOf('\r\n\r\n');
    if (at < 0) continue;
    const head = part.slice(0, at);
    const name = /;\s*name="([^"]*)"/.exec(head)?.[1];
    if (name !== undefined) out.set(name, { value: part.slice(at + 4).replace(/\r\n$/, ''), file: /;\s*filename="/.test(head) });
  }
  return out;
}

function stageOf(d: FakeDeployment) {
  return d.polls >= cf.polls ? { name: 'deploy', status: d.outcome } : { name: 'queued', status: 'active' };
}
function deploymentView(d: FakeDeployment) {
  const p = cf.projects.get(d.project)!;
  return {
    id: d.id, short_id: d.short_id, project_name: d.project, environment: d.environment,
    url: `https://${d.short_id}.${p.subdomain}`,
    aliases: d.environment === 'preview' ? [`https://${d.branch.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${p.subdomain}`] : [],
    latest_stage: stageOf(d), file_count: d.files, deployment_trigger: { type: 'ad_hoc', metadata: { branch: d.branch } },
  };
}

/** Answers a request under /cloudflare and returns true, or returns false. `body` is the request body as text. */
export function cloudflareRoute(req: IncomingMessage, res: ServerResponse, path: string, body: string, _hits: Hit[]): boolean {
  /* The site on its own domain, for the one HTTPS request Meridian makes before it calls a site live. */
  const site = path.match(/^\/cloudflare-site\/([^/]+)\/$/);
  if (site) {
    const name = decodeURIComponent(site[1]!);
    const up = [...cf.domains.values()].some(d => d.name === name && domainActive(d)) && !cf.httpsDown.has(name);
    res.writeHead(up ? 200 : 525, { 'content-type': 'text/html' }).end();
    return true;
  }
  const PREFIX = '/cloudflare/client/v4';
  if (!path.startsWith(PREFIX + '/')) return false;
  const query = new URL(path, 'http://fake').searchParams;
  const p = path.slice(PREFIX.length).split('?')[0]!;
  const method = req.method || 'GET';
  const send = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v)); return true; };
  const ok = (result: unknown, extra: Record<string, unknown> = {}) => send(200, { success: true, errors: [], messages: [], result, ...extra });
  const fail = (status: number, code: number, message: string) => send(status, { success: false, errors: [{ code, message }], messages: [], result: null });
  const problem = (what: string) => { cf.problems.push(what); return fail(400, 8000099, 'fake Cloudflare: ' + what); };
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const json = (): unknown => { try { return JSON.parse(body); } catch { return undefined; } };

  /* Token checks (connectors.ts). A user's token verifies only at /user, an account's only at its account. */
  if (p === '/user/tokens/verify') return bearer === cf.token && !cf.accountToken ? ok({ id: 'tok-1', status: 'active' }) : fail(401, 1000, 'Invalid API Token');
  let m = p.match(/^\/accounts\/([^/]+)\/tokens\/verify$/);
  if (m) return bearer === cf.token && cf.accountToken && m[1] === cf.account ? ok({ id: 'tok-1', status: 'active' }) : fail(401, 1000, 'Invalid API Token');
  if (p === '/zones' && query.has('name')) {
    if (bearer !== cf.token) return fail(401, 10000, 'Authentication error');
    if (cf.dns === 'none') return fail(403, 10000, 'Authentication error');
    const found = cf.zoneList.filter(z => z.name === query.get('name'));
    return ok(found.map(z => ({ id: z.id, name: z.name, status: 'active', type: 'full', account: { id: z.account, name: 'Account' }, name_servers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'] })),
      { result_info: { page: 1, per_page: 50, count: found.length, total_count: found.length } });
  }
  if (p === '/zones') return bearer === cf.token ? ok([], { result_info: { page: 1, per_page: 50, count: 0, total_count: cf.zones } }) : fail(401, 10000, 'Authentication error');

  /* DNS records of a zone. */
  m = p.match(/^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/);
  if (m) {
    if (bearer !== cf.token) return fail(401, 10000, 'Authentication error');
    const z = cf.zoneList.find(x => x.id === m![1]);
    if (!z || cf.dns === 'none') return fail(403, 10000, 'Authentication error');
    const rid = m[2];
    if (method === 'DELETE') { cf.problems.push(`DNS record ${rid} was deleted: Meridian must never delete a DNS record`); return fail(400, 8000099, 'fake Cloudflare: a DNS record was deleted'); }
    if (method === 'PUT') return problem('a DNS record was replaced with PUT');
    if (method === 'GET' && !rid) {
      const list = cf.records.filter(r => r.zone === z.id && (!query.get('name') || r.name === query.get('name')) && (!query.get('type') || r.type === query.get('type')));
      return ok(list.map(recordView), { result_info: { page: 1, per_page: 100, count: list.length, total_count: list.length } });
    }
    if (cf.dns !== 'edit') return fail(403, 10000, 'Authentication error');
    const b = json() as { type?: unknown; name?: unknown; content?: unknown; proxied?: unknown; ttl?: unknown; comment?: unknown } | undefined;
    if (!b || typeof b !== 'object') return problem('a DNS record was sent without a JSON body');
    if (method === 'POST' && !rid) {
      if (typeof b.type !== 'string' || typeof b.name !== 'string' || typeof b.content !== 'string') return problem('a DNS record needs type, name and content');
      if (b.name !== z.name && !b.name.endsWith('.' + z.name)) return fail(400, 1004, 'DNS Validation Error: the name is not in this zone');
      if (b.type === 'CNAME' && b.name === b.content) return fail(400, 1004, 'DNS Validation Error: content must not match the record name');
      const here = cf.records.filter(r => r.zone === z.id && r.name === b.name && ['A', 'AAAA', 'CNAME'].includes(r.type));
      if (here.some(r => r.type === b.type && r.content === b.content)) return fail(400, 81058, 'An identical record already exists.');
      if (here.length && (b.type === 'CNAME' || here.some(r => r.type === 'CNAME'))) return fail(400, 81053, 'An A, AAAA, or CNAME record with that host already exists.');
      const r: FakeRecord = { id: hex32(), zone: z.id, type: b.type, name: b.name, content: b.content, proxied: b.proxied === true, comment: typeof b.comment === 'string' ? b.comment : '', byApi: true };
      cf.records.push(r);
      return ok(recordView(r));
    }
    if (method === 'PATCH' && rid) {
      const r = cf.records.find(x => x.id === rid && x.zone === z.id);
      if (!r) return fail(404, 81044, 'Record does not exist.');
      if (!r.byApi) return problem(`DNS record ${r.type} ${r.name} was changed, but Meridian did not create it`);
      if (typeof b.content === 'string') r.content = b.content;
      if (typeof b.proxied === 'boolean') r.proxied = b.proxied;
      return ok(recordView(r));
    }
    return fail(405, 7001, 'Method not allowed');
  }

  /* Pages, with the API token. */
  m = p.match(/^\/accounts\/([^/]+)\/pages\/projects(?:\/([^/]+))?(\/.*)?$/);
  if (m) {
    const acct = m[1]!, name = m[2], rest = m[3] ?? '';
    if (bearer !== cf.token) return fail(401, 10000, 'Authentication error');
    if (!HEX32.test(acct)) return fail(404, 7003, `Could not route to /accounts/${acct}/pages/projects, perhaps your object identifier is invalid?`);
    if (acct !== cf.account || !cf.pages) return fail(403, 10000, 'Authentication error');
    if (!name) {
      if (method === 'GET') return ok([...cf.projects.values()], { result_info: { page: 1, per_page: 10, count: cf.projects.size, total_count: cf.projects.size } });
      const b = json() as { name?: unknown; production_branch?: unknown } | undefined;
      if (method !== 'POST' || !b || typeof b.name !== 'string') return problem('a project was created without a JSON name');
      /* The name becomes the DNS label of <name>.pages.dev: no hyphen at either end. */
      if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(b.name)) return fail(400, 8000011, 'The project name is invalid.');
      if (typeof b.production_branch !== 'string' || !b.production_branch) return problem('a project was created without a production branch');
      if (cf.takenNames.has(b.name) || cf.projects.has(b.name)) return fail(409, 8000002, 'A project with this name already exists.');
      const proj: FakeProject = { name: b.name, subdomain: b.name + '.pages.dev', production_branch: b.production_branch, source: null, created_on: new Date().toISOString() };
      cf.projects.set(b.name, proj);
      return ok(proj);
    }
    const proj = cf.projects.get(name);
    if (!proj) return fail(404, 8000007, 'Project not found. The specified project name does not match any of your existing projects.');
    if (!rest && method === 'GET') return ok(proj);
    if (rest === '/upload-token' && method === 'GET') {
      const exp = Math.floor(Date.now() / 1000) + cf.jwtSeconds;
      const claims: Record<string, unknown> = { exp, project: name, nonce: randomBytes(6).toString('hex') };
      if (cf.maxFiles !== undefined) claims.max_file_count_allowed = cf.maxFiles;
      const jwt = ['eyJhbGciOiJub25lIn0', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'fake-signature'].join('.');
      cf.jwts.set(jwt, exp);
      return ok({ jwt });
    }
    if (rest === '/deployments' && method === 'POST') {
      const form = multipart(body, String(req.headers['content-type'] ?? ''));
      if (!form) return problem('the deployment was not sent as multipart/form-data');
      let manifest: unknown;
      try { manifest = JSON.parse(form.get('manifest')?.value ?? ''); } catch { return problem('the deployment has no manifest JSON'); }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Object.keys(manifest).length) return problem('the manifest is not a non-empty object');
      for (const [file, key] of Object.entries(manifest as Record<string, unknown>)) {
        if (!file.startsWith('/')) return problem(`manifest path ${file} does not start with "/"`);
        if (file === '/_headers' || file === '/_redirects') return problem(`${file} was uploaded as a file instead of sent with the deployment`);
        if (typeof key !== 'string' || !HEX32.test(key)) return problem(`manifest key of ${file} is not 32 hex characters`);
        const a = cf.assets.get(key);
        if (!a) return problem(`${file} names key ${key}, which was never uploaded`);
        if (wranglerKey(a.value, file) !== key) return problem(`${file} has key ${key}, but its content and extension hash to ${wranglerKey(a.value, file)}`);
        const must = MUST_TYPE[extname(file).slice(1).toLowerCase()];
        if (must && a.contentType !== must) return problem(`${file} would be served as ${a.contentType}, not ${must}`);
      }
      for (const special of ['_headers', '_redirects']) if (form.has(special) && !form.get(special)!.file) return problem(`${special} was sent as a text field, not a file part`);
      const branch = form.get('branch')?.value || proj.production_branch;
      const d: FakeDeployment = {
        id: randomUUID(), short_id: randomBytes(4).toString('hex'), project: name, branch,
        environment: branch === proj.production_branch ? 'production' : 'preview',
        manifest: manifest as Record<string, string>, parts: [...form.keys()],
        headers: form.get('_headers')?.value ?? null, redirects: form.get('_redirects')?.value ?? null,
        polls: 0, files: cf.empty ? 0 : Object.keys(manifest).length, outcome: cf.outcome,
      };
      cf.deployments.push(d);
      return ok(deploymentView(d));
    }
    /* Custom domains of the project. */
    const cd = rest.match(/^\/domains(?:\/([^/]+))?$/);
    if (cd) {
      const dn = cd[1] ? decodeURIComponent(cd[1]) : '';
      const mine = [...cf.domains.values()].filter(d => d.project === name);
      if (!dn && method === 'GET') return ok(mine.map(domainView), { result_info: { page: 1, per_page: 25, count: mine.length, total_count: mine.length } });
      if (!dn && method === 'POST') {
        const b = json() as { name?: unknown } | undefined;
        if (!b || typeof b.name !== 'string' || !/^[a-z0-9.-]+$/.test(b.name)) return problem('a custom domain was added without a lower-case JSON name');
        if (cf.domains.has(name + '/' + b.name)) return fail(409, 8000018, 'You have already added this custom domain.');
        if (cf.usedDomains.has(b.name) || [...cf.domains.values()].some(d => d.name === b.name)) return fail(409, 8000019, 'This domain is already in use by another Pages project.');
        const d: FakeDomain = { id: 'dom-' + (++serial) + '-' + randomBytes(4).toString('hex'), name: b.name, project: name, polls: 0, seen: false, retries: 0, created_on: new Date().toISOString() };
        cf.domains.set(name + '/' + b.name, d);
        return ok(domainView(d));
      }
      const d = cf.domains.get(name + '/' + dn);
      if (method === 'DELETE') { cf.problems.push(`the custom domain ${dn} was deleted: Meridian must never remove a domain from a project`); return fail(400, 8000099, 'fake Cloudflare: a custom domain was deleted'); }
      if (!d) return fail(404, 8000021, 'The domain could not be found.');
      if (method === 'GET') { if (pointsAt(d)) d.polls++; return ok(domainView(d)); }
      if (method === 'PATCH') { d.retries++; return ok(domainView(d)); }
      return fail(405, 7001, 'Method not allowed');
    }
    const dm = rest.match(/^\/deployments\/([^/]+)(\/history\/logs)?$/);
    const d = dm && cf.deployments.find(x => x.id === dm[1] && x.project === name);
    if (dm && method === 'GET') {
      if (!d) return fail(404, 8000009, 'The deployment could not be found.');
      if (dm[2]) return ok({ total: 2, data: [{ line: 'Initializing build environment...' }, { line: 'Error: The fake deploy step failed.' }] });
      d.polls++;
      return ok(deploymentView(d));
    }
    return fail(404, 7000, 'No route for that URI');
  }

  /* Assets, with the upload JWT only. */
  if (p.startsWith('/pages/assets/')) {
    if (bearer === cf.token) { cf.problems.push(`the API token was sent to ${p} instead of the upload JWT`); return fail(401, 8000013, 'Unauthorized'); }
    const exp = cf.jwts.get(bearer);
    if (exp === undefined) { cf.problems.push(`${p} got a JWT the fake never issued`); return fail(401, 8000013, 'Unauthorized'); }
    if (cf.refuseJwt > 0) { cf.refuseJwt--; return fail(401, 8000013, 'Unauthorized'); }
    if (exp * 1000 <= Date.now()) return fail(401, 8000013, 'Unauthorized');
    if (method !== 'POST') return fail(405, 7001, 'Method not allowed');
    const b = json();
    if (p === '/pages/assets/check-missing' || p === '/pages/assets/upsert-hashes') {
      const hashes = (b as { hashes?: unknown } | undefined)?.hashes;
      if (!Array.isArray(hashes) || !hashes.every(h => typeof h === 'string' && HEX32.test(h))) return problem(`${p} needs { hashes: [32-hex keys] }`);
      if (p.endsWith('/upsert-hashes')) { cf.upserts.push(hashes as string[]); return ok(true); }
      cf.checks++;
      return ok((hashes as string[]).filter(h => !cf.assets.has(h)));
    }
    if (p === '/pages/assets/upload') {
      if (cf.failUploads > 0) { cf.failUploads--; res.writeHead(503, { 'content-type': 'text/html' }).end('<html><body>503 Service Temporarily Unavailable</body></html>'); return true; }
      if (!Array.isArray(b) || !b.length) return problem('an upload is not a non-empty JSON array');
      const keys: string[] = [];
      for (const f of b as { key?: unknown; value?: unknown; metadata?: { contentType?: unknown }; base64?: unknown }[]) {
        if (typeof f.key !== 'string' || !HEX32.test(f.key)) return problem('an uploaded key is not 32 hex characters');
        if (typeof f.value !== 'string' || Buffer.from(f.value, 'base64').toString('base64') !== f.value) return problem(`the value of ${f.key} is not base64`);
        if (f.base64 !== true) return problem(`${f.key} was uploaded without base64: true`);
        if (typeof f.metadata?.contentType !== 'string' || !f.metadata.contentType) return problem(`${f.key} was uploaded without a content type`);
        const had = cf.assets.get(f.key);
        if (had && had.value !== f.value) return problem(`key ${f.key} was uploaded with two different contents`);
        cf.assets.set(f.key, { value: f.value, contentType: f.metadata.contentType });
        keys.push(f.key);
      }
      cf.uploads.push(keys);
      return ok({ successful_key_count: keys.length, unsuccessful_keys: [] });
    }
  }
  return fail(404, 7000, 'No route for that URI');
}

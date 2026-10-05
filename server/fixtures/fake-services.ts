// Fake versions of the outside services, for the server tests: one HTTP server that answers like OpenAI,
// DataForSEO, Cloudflare, Globalping, Slack, Telegram and Google (each under its own path prefix), a DNS server
// for A and TXT lookups, and an SMTP server. Each records what it received; `mode` switches answers.
import { createServer as httpServer, type IncomingMessage } from 'node:http';
import { createServer as netServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { commonsEnv, commonsRoute } from './fake-commons.ts';
import { cloudflareEnv, cloudflareRoute } from './fake-cloudflare.ts';
import { googleEnv, googleRoute } from './fake-google.ts';
import { dataforseoEnv, dataforseoRoute } from './fake-dataforseo.ts';

export type Hit = { method: string; path: string; headers: IncomingMessage['headers']; body: string };
export type Mail = { from: string; to: string[]; data: string; user: string };

export const mode = {
  openaiKey: 'sk-test-good-key-1234',
  /** What the probes in the country see: 'blocked' (timeouts, odd DNS), 'ok', or 'none' (no probes). */
  probes: 'blocked' as 'blocked' | 'ok' | 'none' | 'partial' | 'partial-dns',
  txt: new Map<string, string>(),
  smtpPass: 'mail-pass-123',
};

const json = (v: unknown) => JSON.stringify(v);
const idToken = (email: string) => ['e30', Buffer.from(json({ email })).toString('base64url'), 'sig'].join('.');

export async function startFakes() {
  const hits: Hit[] = [];
  const http = httpServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const path = req.url || '/';
      hits.push({ method: req.method || 'GET', path, headers: req.headers, body });
      const send = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }).end(typeof v === 'string' ? v : json(v)); };
      const p = path.split('?')[0]!;
      /* Google's data APIs (fake-google.ts: Search Console rows, Analytics; it also overrides a token renewal when
         told to) and DataForSEO (fake-dataforseo.ts) answer first. */
      if (googleRoute(req, res, path, body, hits)) return;
      if (dataforseoRoute(req, res, path, body, hits)) return;
      if (p === '/openai/v1/models') return req.headers.authorization === 'Bearer ' + mode.openaiKey
        ? send(200, { data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-sol' }] }) : send(401, { error: { message: 'Invalid API key' } });
      if (p === '/slack/hook') return body.includes('"text"') ? send(200, 'ok') : send(400, 'invalid_payload');
      if (p === '/slack/gone') return send(404, 'no_service');
      const tg = p.match(/^\/telegram\/bot([^/]+)\/sendMessage$/);
      if (tg) return tg[1] === '123456:good-token' ? send(200, { ok: true, result: { chat: { title: 'Meridian alerts' } } }) : send(401, { ok: false, description: 'Unauthorized' });
      if (p === '/globalping/v1/limits') return send(200, { rateLimit: { measurements: { create: { type: 'ip', limit: 250, remaining: 240, reset: 100 } } } });
      if (p === '/globalping/v1/measurements' && req.method === 'POST') {
        if (mode.probes === 'none') return send(422, { error: { message: 'No suitable probes found.' } });
        const b = JSON.parse(body) as { type: string };
        return send(202, { id: b.type === 'http' ? 'm-http' : 'm-dns', probesCount: 2 });
      }
      const probe = (city: string, asn: number) => ({ country: 'VN', city, network: 'Net ' + asn, asn });
      if (p === '/globalping/v1/measurements/m-http') {
        /* In the partial modes only Ho Chi Minh City fails. */
        const fails = (city: string) => mode.probes === 'blocked' || (mode.probes.startsWith('partial') && city !== 'Hanoi');
        const r = (city: string, asn: number) => fails(city)
          ? { probe: probe(city, asn), result: { status: 'failed', rawOutput: 'connect ETIMEDOUT 10.10.34.35:443' } }
          : { probe: probe(city, asn), result: { status: 'finished', statusCode: 200 } };
        return send(200, { id: 'm-http', status: 'finished', results: [r('Hanoi', 7552), r('Ho Chi Minh City', 45899)] });
      }
      if (p === '/globalping/v1/measurements/m-dns') {
        const ip = (city: string) => mode.probes === 'blocked' || (mode.probes === 'partial-dns' && city !== 'Hanoi') ? '10.10.34.35' : '203.0.113.10';
        const a = (city: string) => ({ status: 'finished', statusCodeName: 'NOERROR', answers: [{ type: 'A', value: ip(city) }] });
        return send(200, { id: 'm-dns', status: 'finished', results: [
          { probe: probe('Ho Chi Minh City', 45899), result: a('Ho Chi Minh City') },
          { probe: probe('Hanoi', 7552), result: a('Hanoi') },
        ] });
      }
      if (p === '/google-token/token') {
        const f = new URLSearchParams(body);
        if (f.get('grant_type') === 'authorization_code' && f.get('code') === 'good-code') return send(200, { access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600, id_token: idToken('seo@example.com') });
        if (f.get('grant_type') === 'refresh_token') return send(200, { access_token: 'acc-2', expires_in: 3600 });
        return send(400, { error: 'invalid_grant', error_description: 'Bad code' });
      }
      if (p === '/gsc/webmasters/v3/sites') return send(200, { siteEntry: [{ siteUrl: 'sc-domain:example-vn.com', permissionLevel: 'siteOwner' }] });
      if (p.startsWith('/gsc/webmasters/v3/sites/') && p.endsWith('/searchAnalytics/query')) {
        const b = JSON.parse(body) as { startDate: string; endDate: string };
        const days = (Date.parse(b.endDate) - Date.parse(b.startDate)) / 86_400_000 + 1;
        return send(200, { rows: [{ clicks: days * 10, impressions: days * 400, ctr: 0.025, position: 12.34 }] });
      }
      /* Wikimedia Commons (fake-commons.ts) and Cloudflare Pages (fake-cloudflare.ts) answer under their own prefixes. */
      if (commonsRoute(req, res, path, body, hits)) return;
      if (cloudflareRoute(req, res, path, body, hits)) return;
      send(404, { error: 'unknown fake route ' + p });
    });
  });
  await new Promise<void>(r => http.listen(0, '127.0.0.1', () => r()));
  const httpPort = (http.address() as { port: number }).port;

  /* DNS: A queries get 203.0.113.10; TXT queries get mode.txt's value for the name, or NXDOMAIN. */
  const dns = createSocket('udp4');
  dns.on('message', (msg, rinfo) => {
    let i = 12; const labels: string[] = [];
    while (msg[i]) { labels.push(msg.subarray(i + 1, i + 1 + msg[i]!).toString()); i += msg[i]! + 1; }
    const qtype = msg.readUInt16BE(i + 1), qEnd = i + 5, name = labels.join('.').toLowerCase();
    const question = msg.subarray(12, qEnd);
    let answers: Buffer[] = [];
    if (qtype === 1) answers = [Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 203, 0, 113, 10])];
    if (qtype === 16 && mode.txt.has(name)) {
      const t = Buffer.from(mode.txt.get(name)!);
      const rdata = Buffer.concat([Buffer.from([t.length]), t]);
      const head = Buffer.from([0xc0, 0x0c, 0, 16, 0, 1, 0, 0, 0, 60, rdata.length >> 8, rdata.length & 255]);
      answers = [Buffer.concat([head, rdata])];
    }
    const h = Buffer.alloc(12);
    msg.copy(h, 0, 0, 2);
    h.writeUInt16BE(answers.length ? 0x8180 : 0x8183, 2);
    h.writeUInt16BE(1, 4); h.writeUInt16BE(answers.length, 6);
    dns.send(Buffer.concat([h, question, ...answers]), rinfo.port, rinfo.address);
  });
  await new Promise<void>(r => dns.bind(0, '127.0.0.1', () => r()));
  const dnsPort = dns.address().port;

  /* SMTP without TLS (allowed for 127.0.0.1 only). AUTH PLAIN with user "mailer@example.com" and mode.smtpPass. */
  const mails: Mail[] = [];
  const smtp = netServer(sock => {
    let buf = '', inData = false, cur: Mail = { from: '', to: [], data: '', user: '' };
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString();
      let n: number;
      while ((n = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, n); buf = buf.slice(n + 2);
        if (inData) {
          if (line === '.') { inData = false; mails.push(cur); cur = { from: '', to: [], data: '', user: cur.user }; sock.write('250 queued\r\n'); }
          else cur.data += line + '\r\n';
          continue;
        }
        const up = line.toUpperCase();
        if (up.startsWith('EHLO')) sock.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (up.startsWith('AUTH PLAIN ')) {
          const [, user, pass] = Buffer.from(line.slice(11), 'base64').toString().split('\0');
          if (pass === mode.smtpPass) { cur.user = user ?? ''; sock.write('235 ok\r\n'); } else sock.write('535 5.7.8 bad credentials\r\n');
        }
        else if (up.startsWith('MAIL FROM:')) { cur.from = line.slice(10).replace(/[<>]/g, ''); sock.write('250 ok\r\n'); }
        else if (up.startsWith('RCPT TO:')) { cur.to.push(line.slice(8).replace(/[<>]/g, '')); sock.write('250 ok\r\n'); }
        else if (up === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (up === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('500 what\r\n');
      }
    });
    sock.on('error', () => undefined);
  });
  await new Promise<void>(r => smtp.listen(0, '127.0.0.1', () => r()));
  const smtpPort = (smtp.address() as { port: number }).port;

  const u = (p: string) => `http://127.0.0.1:${httpPort}/${p}`;
  return {
    hits, mails, httpPort, dnsPort, smtpPort, url: u,
    env: {
      MERIDIAN_URL_GLOBALPING: u('globalping'), MERIDIAN_URL_TELEGRAM: u('telegram'),
      MERIDIAN_URL_GOOGLE_AUTH: u('google-auth'), MERIDIAN_URL_GOOGLE_TOKEN: u('google-token'), MERIDIAN_URL_SEARCH_CONSOLE: u('gsc'),
      ...commonsEnv(u), ...cloudflareEnv(u), ...googleEnv(u), ...dataforseoEnv(u),
      MERIDIAN_ALLOW_LOCAL_HOOKS: '1', MERIDIAN_PROBE_POLL_MS: '20', MERIDIAN_FAKE_HERE: 'up', MERIDIAN_DNS_SERVERS: `127.0.0.1:${dnsPort}`,
    },
    stop: () => { http.close(); dns.close(); smtp.close(); },
  };
}

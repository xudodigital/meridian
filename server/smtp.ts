// Sending email over SMTP with node:net and node:tls only. Port 465 uses TLS from the start; any other port must
// offer STARTTLS, so a password is never sent in the clear (a server on 127.0.0.1 is the one exception, for tests).
import { randomBytes } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { hostname } from 'node:os';

export type SmtpConfig = { host: string; port: number; user: string; pass: string; from: string };
export type Attachment = { filename: string; contentType: string; content: string };
export type Mail = { to: string[]; subject: string; text: string; attachments?: Attachment[] };

export class SmtpError extends Error {}

type Reply = { code: number; lines: string[] };

/** Reads SMTP replies (one or more lines, "250-..." then "250 ...") from a socket. */
class Conn {
  private buf = '';
  private waiting: ((r: Reply | Error) => void) | null = null;
  private replies: (Reply | Error)[] = [];
  private lines: string[] = [];
  sock: Socket | TLSSocket;
  constructor(sock: Socket | TLSSocket) { this.sock = sock; this.attach(sock); }

  attach(sock: Socket | TLSSocket) {
    this.sock = sock;
    sock.setTimeout(30_000);
    sock.on('data', (d: Buffer) => this.feed(d.toString('utf8')));
    sock.on('timeout', () => { this.push(new SmtpError('The email server did not answer in time.')); sock.destroy(); });
    sock.on('error', (e: Error) => this.push(new SmtpError(netMessage(e))));
    sock.on('close', () => this.push(new SmtpError('The email server closed the connection.')));
  }
  private feed(s: string) {
    this.buf += s;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1);
      this.lines.push(line.slice(4));
      if (line[3] !== '-') { this.push({ code: Number(line.slice(0, 3)), lines: this.lines }); this.lines = []; }
    }
  }
  private push(r: Reply | Error) {
    if (this.waiting) { const w = this.waiting; this.waiting = null; w(r); } else this.replies.push(r);
  }
  read(): Promise<Reply> {
    const r = this.replies.shift();
    if (r) return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    return new Promise((resolve, reject) => { this.waiting = x => x instanceof Error ? reject(x) : resolve(x); });
  }
  /** Sends a command and checks the reply code. `what` names the step in an error; secrets are never put in errors. */
  async cmd(line: string | null, ok: number[], what: string): Promise<Reply> {
    if (line !== null) this.sock.write(line + '\r\n');
    const r = await this.read();
    if (!ok.includes(r.code)) throw new SmtpError(`${what}: the email server answered ${r.code} ${r.lines.join(' ').slice(0, 160)}`);
    return r;
  }
  /** Stops reading on the old socket (before STARTTLS wraps it). */
  detach() { this.sock.removeAllListeners('data'); this.sock.removeAllListeners('timeout'); this.sock.removeAllListeners('error'); this.sock.removeAllListeners('close'); }
}

function netMessage(e: Error): string {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === 'ENOTFOUND') return 'The email server name was not found. Check the SMTP server.';
  if (code === 'ECONNREFUSED') return 'The email server refused the connection. Check the server and port.';
  if (code === 'ETIMEDOUT') return 'The email server did not answer in time.';
  if (/certificate|self.signed|CERT/i.test(e.message)) return 'The email server\'s certificate is not valid for this name.';
  return 'Could not talk to the email server: ' + e.message.slice(0, 120);
}

const open = (cfg: SmtpConfig): Promise<Socket | TLSSocket> => new Promise((resolve, reject) => {
  const s = cfg.port === 465
    ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => resolve(s))
    : netConnect({ host: cfg.host, port: cfg.port }, () => resolve(s));
  s.once('error', e => reject(new SmtpError(netMessage(e))));
  s.setTimeout(20_000, () => { s.destroy(); reject(new SmtpError('The email server did not answer in time.')); });
});

const upgrade = (sock: Socket, host: string): Promise<TLSSocket> => new Promise((resolve, reject) => {
  const t = tlsConnect({ socket: sock, servername: host }, () => resolve(t));
  t.once('error', e => reject(new SmtpError(netMessage(e))));
});

/** "=?UTF-8?B?...?=" for a header with non-ASCII characters. */
const header = (v: string): string => /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
const wrap = (b64: string): string => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const addr = (v: string): string => v.replace(/[\r\n<>]/g, '').trim();

/** The message as sent: headers and a MIME body, with dots at line starts doubled. */
export function buildMessage(from: string, m: Mail, now = new Date()): string {
  const boundary = 'meridian-' + randomBytes(12).toString('hex');
  const domain = from.split('@')[1] || 'localhost';
  const head = [
    `From: Meridian <${addr(from)}>`, `To: ${m.to.map(addr).join(', ')}`, `Subject: ${header(m.subject.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`, `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`, 'MIME-Version: 1.0',
  ];
  const textPart = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(m.text, 'utf8').toString('base64'))];
  let body: string[];
  if (m.attachments?.length) {
    body = [`Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, ...textPart];
    for (const a of m.attachments) {
      const name = a.filename.replace(/["\r\n]/g, '');
      body.push(`--${boundary}`, `Content-Type: ${a.contentType}; name="${name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${name}"`, '', wrap(Buffer.from(a.content, 'utf8').toString('base64')));
    }
    body.push(`--${boundary}--`);
  } else body = textPart;
  return [...head, ...body].join('\r\n').replace(/^\./gm, '..');
}

/** Sends one email. Resolves when the server accepted it; rejects with an SmtpError that is fit to show. */
export async function sendMail(cfg: SmtpConfig, m: Mail): Promise<void> {
  if (!cfg.host || !cfg.port) throw new SmtpError('Set up the email server first.');
  if (!m.to.length) throw new SmtpError('There is no one to send to.');
  const from = cfg.from || cfg.user;
  const sock = await open(cfg);
  const c = new Conn(sock);
  try {
    await c.cmd(null, [220], 'Connecting');
    const me = hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
    let ehlo = await c.cmd('EHLO ' + me, [250], 'Greeting');
    if (cfg.port !== 465) {
      if (ehlo.lines.some(l => /^STARTTLS\b/i.test(l))) {
        await c.cmd('STARTTLS', [220], 'Starting TLS');
        c.detach();
        c.attach(await upgrade(sock as Socket, cfg.host));
        ehlo = await c.cmd('EHLO ' + me, [250], 'Greeting');
      } else if (cfg.host !== '127.0.0.1') {
        throw new SmtpError('The email server does not offer STARTTLS on this port, so the password would be sent unencrypted. Use port 465 or 587.');
      }
    }
    if (cfg.user) {
      const auth = ehlo.lines.find(l => /^AUTH\b/i.test(l)) ?? '';
      if (/\bPLAIN\b/i.test(auth) || !/\bLOGIN\b/i.test(auth)) {
        await c.cmd('AUTH PLAIN ' + Buffer.from(`\0${cfg.user}\0${cfg.pass}`, 'utf8').toString('base64'), [235], 'Signing in').catch(rethrowAuth);
      } else {
        await c.cmd('AUTH LOGIN', [334], 'Signing in');
        await c.cmd(Buffer.from(cfg.user, 'utf8').toString('base64'), [334], 'Signing in');
        await c.cmd(Buffer.from(cfg.pass, 'utf8').toString('base64'), [235], 'Signing in').catch(rethrowAuth);
      }
    }
    await c.cmd(`MAIL FROM:<${addr(from)}>`, [250], 'Sender');
    for (const to of m.to) await c.cmd(`RCPT TO:<${addr(to)}>`, [250, 251], 'Recipient ' + addr(to));
    await c.cmd('DATA', [354], 'Sending');
    await c.cmd(buildMessage(from, m) + '\r\n.', [250], 'Sending');
    await c.cmd('QUIT', [221], 'Closing').catch(() => undefined);
  } finally { c.sock.destroy(); }
}

function rethrowAuth(e: unknown): never {
  if (e instanceof SmtpError && /\b(535|534|530)\b/.test(e.message)) throw new SmtpError('The email server refused the user name or password. For Gmail, use an app password.');
  throw e;
}

export const smtpConfig = (v: Record<string, string>): SmtpConfig =>
  ({ host: v.host ?? '', port: Number(v.port) || 587, user: v.user ?? '', pass: v.pass ?? '', from: v.from || v.user || '' });

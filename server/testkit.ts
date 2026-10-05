// Helpers for the server tests: a real server process on a free port with a temporary data folder and the fake
// OpenAI Responses API (fixtures/fake-openai.ts), and an HTTP client that keeps its own session cookie like a browser.
// Not a test file itself; the *.test.ts files import it.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
import { startFakeOpenAI } from './fixtures/fake-openai.ts';

export type Json = Record<string, unknown>;

const freePort = () => new Promise<number>(resolve => {
  const s = createServer().listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => resolve(typeof a === 'object' && a ? a.port : 0)); });
});

export async function until<T>(what: string, fn: () => Promise<T | undefined | null | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
    await new Promise(r => setTimeout(r, 50));
  }
}

export interface TestServer {
  base: string;
  tmp: string;
  fakeDir: string;
  /** Everything the server printed. */
  output: () => string;
  /** The server's database, opened from the test (WAL allows it), for moving clocks and checking what is stored. */
  db: () => DatabaseSync;
  /** The server process and its port, for tests that signal it or start a second one. */
  child: ChildProcess;
  port: number;
  /** Resolves with the exit code when the server process has ended. */
  exited: Promise<number | null>;
  /** Sends the server a signal and waits for it to end. The data folder stays, for startServer(env, tmp). */
  halt: (signal: NodeJS.Signals) => Promise<number | null>;
  stop: () => void;
}

/**
 * Starts a server. `env` adds or overrides variables (for example MERIDIAN_FAKE_LOGGED_OUT). `again` is the folder of
 * a server that was stopped (its `tmp`): the new one starts on the same data, as after a restart.
 */
export async function startServer(env: NodeJS.ProcessEnv = {}, again?: string): Promise<TestServer> {
  const tmp = again ?? mkdtempSync(join(tmpdir(), 'meridian-test-'));
  const fakeDir = join(tmp, 'fake');
  mkdirSync(fakeDir, { recursive: true });
  const fake = await startFakeOpenAI(fakeDir, env.MERIDIAN_FAKE_LOGGED_OUT === '1');
  const port = await freePort();
  const full: NodeJS.ProcessEnv = {
    ...process.env, PORT: String(port), MERIDIAN_DATA: join(tmp, 'data'), OPENAI_API_KEY: 'test-openai-key', MERIDIAN_URL_OPENAI: fake.url,
    PATH: dirname(process.execPath) + ':' + (process.env.PATH || ''),
    /* Exported secrets must not be present in API request payloads. */
    /* Like any token a person's shell exports: it must not enter a payload. */
    GITHUB_TOKEN: 'secret',
    /* These must never enter a payload. */
    CLAUDE_CODE_OAUTH_TOKEN: 'secret', ANTHROPIC_API_KEY: 'secret', claude_lowercase: 'secret',
    /* Every written article queues a photo job, which searches Wikimedia Commons. No test reaches the real one: this
       closed port refuses at once, unless the test points the server at the fake (fixtures/fake-commons.ts). */
    MERIDIAN_URL_COMMONS: 'http://127.0.0.1:9', MERIDIAN_MEDIA_HOSTS: '127.0.0.1:9',
    ...env,
  };
  const child: ChildProcess = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(HERE, 'main.ts')], { env: full, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout?.on('data', d => { out += d; });
  child.stderr?.on('data', d => { out += d; });
  const exited = new Promise<number | null>(resolve => child.once('exit', code => { fake.close(); resolve(code); }));
  await until('the server to start', async () => out.includes('Meridian is running'), 10_000);
  let handle: DatabaseSync | null = null;
  return {
    base: `http://127.0.0.1:${port}`, tmp, fakeDir, output: () => out,
    /* It waits for the server's own writes, as the server waits for the test's. */
    db: () => (handle ??= new DatabaseSync(join(tmp, 'data', 'meridian.db'), { timeout: 5000 })),
    child, port, exited,
    halt: async signal => { handle?.close(); handle = null; child.kill(signal); return exited; },
    stop: () => { fake.close(); handle?.close(); child.kill(); rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); },
  };
}

export type Res = { status: number; data: Json; cookie: string };

/** A browser: keeps the session cookie the server sets and sends our write header. */
export class Client {
  base: string;
  cookie = '';
  /** Set-Cookie of the last answer, as sent. */
  lastSetCookie = '';
  constructor(base: string) { this.base = base; }

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const h: Record<string, string> = { 'x-meridian': '1', ...headers };
    if (this.cookie) h.cookie = 'meridian_session=' + this.cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(this.base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.getSetCookie();
    this.lastSetCookie = set.join('\n');
    for (const c of set) {
      const m = c.match(/^meridian_session=([^;]*)/);
      if (m) this.cookie = m[1] ?? '';
    }
    const text = await r.text();
    let data: Json = {};
    try { data = text ? JSON.parse(text) as Json : {}; } catch { data = { text }; }
    return { status: r.status, data, cookie: this.cookie };
  }
  get = (path: string) => this.req('GET', path);
  post = (path: string, body: unknown = {}, headers?: Record<string, string>) => this.req('POST', path, body, headers);
  put = (path: string, body: unknown) => this.req('PUT', path, body);
  patch = (path: string, body: unknown) => this.req('PATCH', path, body);
  del = (path: string) => this.req('DELETE', path);
}

export const PASSWORD = 'correct horse battery staple';

/** Creates the owner account on a fresh server and returns a client signed in as the owner. */
export async function owner(s: TestServer, name = 'Owner Person', email = 'owner@example.com'): Promise<Client> {
  const c = new Client(s.base);
  const r = await c.post('/api/auth/setup', { name, email, password: PASSWORD, confirm: PASSWORD });
  if (r.status !== 201) throw new Error('setup failed: ' + JSON.stringify(r.data));
  return c;
}

/** Invites someone as `role` and accepts the link in a new client, which is returned signed in. */
export async function member(s: TestServer, admin: Client, role: string, email: string, name: string, site?: string): Promise<Client> {
  const inv = await admin.post('/api/invites', { email, role, ...(site ? { site } : {}) });
  if (inv.status !== 201) throw new Error('invite failed: ' + JSON.stringify(inv.data));
  const token = String(inv.data.link).split('/invite/')[1];
  const c = new Client(s.base);
  const r = await c.post(`/api/invites/${token}/accept`, { name, password: PASSWORD, confirm: PASSWORD });
  if (r.status !== 201) throw new Error('accept failed: ' + JSON.stringify(r.data));
  return c;
}

/** Saves the sites document with the given sites (each needs an id and a domain). */
export async function saveSites(c: Client, sites: { id: string; domain: string; country?: string; cc?: string; lang?: string; topic?: string; status?: string }[]): Promise<void> {
  const cur = await c.get('/api/workspace');
  const version = ((cur.data.docs as Record<string, { version: number }>).sites ?? { version: 0 }).version;
  const r = await c.put('/api/workspace/docs/sites', { version, data: sites });
  if (r.status !== 200) throw new Error('save failed: ' + JSON.stringify(r.data));
}

/** Reads server-sent events from a stream until `stop` returns true or the time is up. */
export async function events(c: Client, during: () => Promise<void>, ms = 3000): Promise<{ event: string; data: Json }[]> {
  const ctl = new AbortController();
  const r = await fetch(c.base + '/api/events', { headers: { cookie: 'meridian_session=' + c.cookie }, signal: ctl.signal });
  const got: { event: string; data: Json }[] = [];
  if (!r.ok || !r.body) return got;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = block.match(/^event: (.*)$/m)?.[1], data = block.match(/^data: (.*)$/m)?.[1];
          if (ev && data) got.push({ event: ev, data: JSON.parse(data) as Json });
        }
      }
    } catch { /* aborted */ }
  })();
  await new Promise(r2 => setTimeout(r2, 100));
  await during();
  await new Promise(r2 => setTimeout(r2, Math.min(ms, 400)));
  ctl.abort();
  await pump;
  return got;
}

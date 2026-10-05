// Local, personal Codex CLI execution. Authentication remains owned by Codex; Meridian never reads auth.json.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WORK_DIR } from './paths.ts';

const MAC_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
export const codexBinary = () => process.env.MERIDIAN_CODEX_BIN || (existsSync(MAC_CODEX) ? MAC_CODEX : 'codex');
export const codexModel = () => process.env.MERIDIAN_CODEX_MODEL || 'gpt-6.1-sol';
export const usesCodex = () => process.env.MERIDIAN_ENGINE === 'codex-local';
// Deliberately exclude service keys and unrelated environment values from the model process.
function environment(): NodeJS.ProcessEnv {
  return Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'TEMP', 'TMP', 'CODEX_HOME', 'LANG', 'LC_ALL', 'USER', 'LOGNAME']
    .flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
}
export function codexArgs(work: string, webSearch: boolean, images: readonly string[] = []): string[] {
  return ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
    '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'multi_agent', '--disable', 'apps',
    '--disable', 'shell_snapshot', '--disable', 'skill_mcp_dependency_install',
    '-c', 'mcp_servers={}', '-c', 'forced_login_method="chatgpt"', '-c', `web_search="${webSearch ? 'live' : 'disabled'}"`,
    '-c', 'model_reasoning_effort="low"', '-m', codexModel(), '-C', work, '--json',
    ...images.flatMap(path => ['--image', path]), '-'];
}
/** Bounded process execution with no shell interpolation. Entire child process group is stopped on cancel/timeout. */
function invoke(args: string[], input: string, timeoutMs: number, signal?: AbortSignal, diagnostic = false): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('The job was cancelled.')); return; }
    const child = spawn(codexBinary(), args, { env: environment(), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '', bytes = 0, error = '', stopped = '', force: ReturnType<typeof setTimeout> | undefined;
    const kill = (sig: NodeJS.Signals) => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig); else child.kill(sig); } catch { /* already exited */ } };
    const stop = (reason: string) => { if (stopped) return; stopped = reason; kill('SIGTERM'); force = setTimeout(() => kill('SIGKILL'), 1500); };
    const cancel = () => stop('The job was cancelled.');
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => stop('Codex did not finish within the job time limit.'), timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => { bytes += Buffer.byteLength(data); if (bytes > 8 * 1024 * 1024) stop('Codex returned more than the result size limit.'); else output += data; });
    child.stderr.on('data', (data: string) => { if (error.length < 4000) error += data; });
    child.stdin.on('error', () => {});
    child.once('error', () => { stopped ||= 'Codex CLI could not start. Check MERIDIAN_CODEX_BIN.'; });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(force); signal?.removeEventListener('abort', cancel);
      if (stopped) reject(new Error(stopped));
      else if (code !== 0) {
        // Never return raw CLI diagnostics: they may contain authentication or local path details.
        const limited = /rate.?limit|quota|usage limit|429/i.test(output + error);
        reject(new Error(limited ? 'Codex usage limit reached. Check your ChatGPT limits and retry later.' : 'Codex could not complete the job. Check your Codex login and model access.'));
      } else resolve(output + (diagnostic ? error : ''));
    });
    child.stdin.end(input);
  });
}
export async function codexStatus(): Promise<{ ready: boolean; version: string; reason: string }> {
  try {
    const version = (await invoke(['--version'], '', 5000)).trim().slice(0, 80);
    const login = await invoke(['login', 'status'], '', 5000, undefined, true);
    // CLI login status prints to stderr on some versions; exit 0 still means logged in.
    if (/API key/i.test(login)) return { ready: false, version, reason: 'Sign in to Codex using ChatGPT for local mode.' };
    return { ready: true, version, reason: '' };
  } catch { return { ready: false, version: 'Codex CLI', reason: 'Codex is not ready. Install the official CLI and sign in with ChatGPT, then check again.' }; }
}
export function codexResult(events: string): { text: string; tokens: number; costUsd: number } {
  let text = '', tokens = 0, complete = false;
  for (const line of events.split('\n').filter(Boolean)) {
    let e: Record<string, any>;
    try { e = JSON.parse(line); } catch { throw new Error('Codex returned invalid event data.'); }
    if (e.type === 'item.completed' && e.item?.type === 'agent_message') text = String(e.item.text || '');
    if (e.type === 'turn.completed') {
      complete = true;
      const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
      tokens += num(e.usage?.input_tokens) + num(e.usage?.output_tokens);
    }
    if (e.type === 'turn.failed' || e.type === 'error') throw new Error('Codex could not complete the job. Check your login and ChatGPT usage limits.');
  }
  if (!complete || !text.trim()) throw new Error('Codex returned no completed answer.');
  // This is API spend, not the price of a ChatGPT subscription. No API price is inferred from CLI tokens.
  return { text, tokens, costUsd: 0 };
}
export async function runCodex(prompt: string, webSearch: boolean, images: readonly string[], timeoutMin: number, signal: AbortSignal) {
  mkdirSync(WORK_DIR, { recursive: true, mode: 0o700 });
  const work = mkdtempSync(join(WORK_DIR, 'codex-'));
  try { return codexResult(await invoke(codexArgs(work, webSearch, images), prompt, timeoutMin * 60000, signal)); }
  finally { rmSync(work, { recursive: true, force: true }); }
}

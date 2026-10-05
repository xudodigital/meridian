import { TEST_DATA } from './fixtures/temp-data.ts';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { codexArgs, codexResult, codexStatus, runCodex } from './codex-local.ts';

mkdirSync(TEST_DATA, { recursive: true });
const executable = join(TEST_DATA, 'codex-fixture.mjs');
writeFileSync(executable, `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex-cli fixture'); process.exit(0); }
if (args[0] === 'login') { console.error(process.env.FIXTURE_LOGIN || 'Logged in using ChatGPT'); process.exit(0); }
let input = ''; for await (const chunk of process.stdin) input += chunk;
if (input === 'stall') { setInterval(() => {}, 1000); }
else if (input === 'secret-error') { console.error('secret diagnostic bearer secret-key'); process.exit(1); }
else {
 const text = JSON.stringify({input, apiKeyVisible: Boolean(process.env.OPENAI_API_KEY), args});
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:8,output_tokens:2,cached_input_tokens:4}}));
}
`, { mode: 0o700 });
process.env.MERIDIAN_CODEX_BIN = executable;
process.env.OPENAI_API_KEY = 'secret-key';
after(() => { delete process.env.MERIDIAN_CODEX_BIN; delete process.env.OPENAI_API_KEY; rmSync(TEST_DATA, { recursive: true, force: true }); });

describe('personal Codex local adapter', () => {
  it('restricts shell, MCP, apps and delegation while enabling web only when requested', () => {
    const args = codexArgs('/isolated workspace', false);
    assert.ok(args.includes('read-only')); assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('--ephemeral'));
    for (const feature of ['shell_tool', 'unified_exec', 'multi_agent', 'apps']) assert.ok(args.includes(feature));
    assert.ok(args.includes('mcp_servers={}')); assert.ok(args.includes('web_search="disabled"'));
    assert.ok(codexArgs('/work', true).includes('web_search="live"'));
  });
  it('records actual tokens and no per-token API charge, requiring a completed final answer', () => {
    const events = '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}\n{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":20}}';
    assert.deepEqual(codexResult(events), { text: '{}', tokens: 120, costUsd: 0 });
    assert.throws(() => codexResult('{"type":"turn.failed","error":{"message":"secret"}}'), /could not complete/);
    assert.throws(() => codexResult('{"type":"turn.started"}'), /no completed/);
    assert.throws(() => codexResult('broken'), /invalid event/);
  });
  it('uses an isolated process, preserves Indonesian input, and excludes API credentials from the environment', async () => {
    assert.equal((await codexStatus()).ready, true);
    const out = await runCodex('kopi ☕ — melamun', false, [], 1, new AbortController().signal);
    const answer = JSON.parse(out.text);
    assert.equal(answer.input, 'kopi ☕ — melamun'); assert.equal(answer.apiKeyVisible, false);
    assert.equal(answer.args.at(-1), '-'); assert.equal(out.tokens, 10);
  });
  it('bounds a stalled process, cancels promptly, and hides raw diagnostics', async () => {
    await assert.rejects(runCodex('stall', false, [], .005, new AbortController().signal), /time limit/);
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 100);
    await assert.rejects(runCodex('stall', false, [], 1, ctl.signal), /cancelled/);
    await assert.rejects(runCodex('secret-error', false, [], 1, new AbortController().signal), e => /could not complete/.test(String(e)) && !/secret-key/.test(String(e)));
  });
});

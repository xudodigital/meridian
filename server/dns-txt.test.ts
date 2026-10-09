import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupPublicTxt, lookupTxtOverHttps } from './dns-txt.ts';

const name = '_meridian.example.com';
const answer = (data: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(data), { status })) as typeof fetch;
const body = (records: unknown[]) => ({ Status: 0, Question: [{ name: name + '.', type: 16 }], Answer: records });
const record = (data: string, owner = name, type = 16) => ({ name: owner, type, data });

test('HTTPS TXT parsing accepts exact owner and joins split strings without stripping payload spaces', async () => {
  const result = await lookupTxtOverHttps(name, answer(body([record('"meridian-verify=" "abc123"'), record('"text with spaces"'), record('"wrong-owner"', 'other.example.com'), record('"wrong-type"', name, 5)])));
  assert.deepEqual(result, [['meridian-verify=', 'abc123'], ['text with spaces']]);
});

test('untrusted, malformed, negative and failed HTTPS responses do not produce verification records', async () => {
  for (const value of [body([record('not quoted')]), body([record('"ok" garbage')]), body([record('"wrong"', 'other.example.com')]), { Status: 2, Question: [{ name, type: 16 }] }, { ...body([record('"ok"')]), Question: [{ name: 'other.example.com', type: 16 }] }, { ...body([record('"ok"')]), TC: true }]) {
    await assert.rejects(lookupTxtOverHttps(name, answer(value)));
  }
  await assert.rejects(lookupTxtOverHttps(name, answer({}, 503)));
  await assert.rejects(lookupTxtOverHttps(name, answer({ Status: 3, Question: [{ name, type: 16 }] })), { code: 'ENOTFOUND' });
});

test('fallback is used only after a UDP failure; positive values are preserved for exact-value validation', async () => {
  let calls = 0;
  const fallback = async () => { calls++; return [['actual-TXT']]; };
  assert.deepEqual(await lookupPublicTxt(name, async () => [['different-TXT']], fallback), [['different-TXT']]);
  assert.equal(calls, 0);
  assert.deepEqual(await lookupPublicTxt(name, async () => { throw Object.assign(new Error(), { code: 'ENOTFOUND' }); }, fallback), [['actual-TXT']]);
  assert.equal(calls, 1);
});

test('explicit custom DNS configuration never falls back to an external provider', async () => {
  const original = process.env.MERIDIAN_DNS_SERVERS;
  process.env.MERIDIAN_DNS_SERVERS = '127.0.0.1';
  try {
    await assert.rejects(lookupPublicTxt(name, async () => { throw Object.assign(new Error(), { code: 'ENOTFOUND' }); }, async () => { assert.fail('Unexpected fallback'); }), { code: 'ENOTFOUND' });
  } finally {
    if (original === undefined) delete process.env.MERIDIAN_DNS_SERVERS;
    else process.env.MERIDIAN_DNS_SERVERS = original;
  }
});

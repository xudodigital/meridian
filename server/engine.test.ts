import { TEST_DATA } from './fixtures/temp-data.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { db } from './db.ts';
import { runOpenAI, responseBody, responseUsage, apiModel, skillInstructions, type ApiJob } from './engine.ts';
import { QUEUE_MAX_PER_SITE, QUEUE_MAX_TOTAL, addJobSource, kick, queueFull, queueSnapshot, type QueuedJob } from './jobs.ts';
import { Bucket, Limiter, PER_EMAIL, SLOW_AFTER, SLOW_MAX_MS, Slowdown, totpLockMs } from './limits.ts';
import { until } from './testkit.ts';
import { startFakeOpenAI } from './fixtures/fake-openai.ts';
import { BUILTIN_SKILLS } from '../shared/agent-skills.ts';
import { readSkillFile } from './skill-files.ts';
import { agentSkills } from './agent-skills.ts';
const fakeDir = join(TEST_DATA,'fake');
let fake: Awaited<ReturnType<typeof startFakeOpenAI>>;
const job = (over: Partial<ApiJob> = {}): ApiJob => ({prompt:'Meridian task: none\n',model:'gpt-6.1-sol',timeoutMin:1,...over});
before(async()=>{mkdirSync(fakeDir,{recursive:true});fake=await startFakeOpenAI(fakeDir);process.env.MERIDIAN_URL_OPENAI=fake.url;process.env.OPENAI_API_KEY='test-openai-key';});
after(()=>{fake.close();db.close();rmSync(TEST_DATA,{recursive:true,force:true});});
describe('OpenAI engine',()=>{
  it('sends the selected model through Responses API without storage or credentials in its payload',async()=>{
    const r=await runOpenAI(job({prompt:'Meridian task: none\nSecret words: kopi tubruk'}),new AbortController().signal);
    assert.equal(r.text,'{}');assert.equal(r.tokens,1500);assert.equal(r.costUsd,.007);
    const call=JSON.parse(readFileSync(join(fakeDir,'calls.jsonl'),'utf8').trim().split('\n').at(-1)!);
    assert.equal(call.body.model,'gpt-6.1-sol');assert.equal(call.body.store,false);
    assert.match(call.prompt,/kopi tubruk/);assert.equal(JSON.stringify(call).includes('test-openai-key'),false);
    assert.equal(call.body.tools,undefined);
    assert.throws(()=>apiModel('unsupported'),/not supported/);
  });
  it('loads only explicit skills and enables only the requested web search capability',()=>{
    assert.throws(()=>skillInstructions(['../../data']),/Unrecognized/);
    const body=responseBody({...job(),skills:['keyword-research']});
    assert.match(String(body.instructions),/keyword-research/);assert.equal(body.tools,undefined);
    assert.deepEqual(responseBody({...job(),webSearch:true}).tools,[{type:'web_search'}]);
  });
  it('loads every shipped skill, including CSS assets and skills without a references folder',()=>{
    for (const name of Object.values(BUILTIN_SKILLS)) assert.match(skillInstructions([name]), /SKILL.md/);
    assert.match(skillInstructions(['material-3-web']), /references\/tokens.css/);
    assert.match(skillInstructions(['material-3-web']), /--md-sys-state-focus-opacity/);
    assert.throws(() => readSkillFile('material-3-web', 'references/../../data/meridian.db'), /Unrecognized/);
    assert.throws(() => readSkillFile('material-3-web', '_sources/private.md'), /Unrecognized/);
  });
  it('resolves saved assignments on each call while retaining required task guidelines',()=>{
    const old = db.prepare("SELECT * FROM workspace_docs WHERE id='agents'").get();
    try {
      db.prepare("INSERT OR REPLACE INTO workspace_docs (id,version,data,updated_at,updated_by) VALUES ('agents',1,?,0,NULL)").run(JSON.stringify([{id:'bld',skills:['s3','s11','../../data','custom']} ]));
      assert.deepEqual(agentSkills('bld'), ['material-3-web','web-performance','images-and-alt-text','site-architecture']);
      db.prepare("UPDATE workspace_docs SET data=? WHERE id='agents'").run(JSON.stringify([{id:'bld',skills:[]} ]));
      assert.deepEqual(agentSkills('bld'), ['material-3-web','web-performance','images-and-alt-text']);
    } finally {
      db.prepare("DELETE FROM workspace_docs WHERE id='agents'").run();
      if (old) db.prepare('INSERT INTO workspace_docs (id,version,data,updated_at,updated_by) VALUES (?,?,?,?,?)').run(old.id,old.version,old.data,old.updated_at,old.updated_by);
    }
  });
  it('accounts for cached input, output, web searches and long contexts',()=>{
    const u=responseUsage({usage:{input_tokens:1000,output_tokens:500,input_tokens_details:{cached_tokens:800}},output:[{type:'web_search_call'}]},'gpt-6.1-sol');
    assert.equal(u.tokens,1500);assert.equal(u.costUsd,.01548);
    assert.equal(responseUsage({usage:{input_tokens:300000,output_tokens:1000}},'gpt-6.1-sol').costUsd,1.215);
  });
  it('reports rate limits, refusals and incomplete responses without leaking the key', async()=>{
    const scenarios=[
      [429,{error:{message:'Quota exhausted for test-openai-key'}},/OpenAI answered 429: Quota exhausted for \[redacted\]/],
      [200,{status:'incomplete',incomplete_details:{reason:'test-openai-key max_output_tokens'}},/\[redacted\] max_output_tokens/],
      [200,{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]},/declined/],
      [200,{status:'completed',output:[]},/returned no text/],
    ] as const;
    for(const [status,body,expected] of scenarios) {
      writeFileSync(join(fakeDir,'response.json'),JSON.stringify(body));
      writeFileSync(join(fakeDir,'http-status'),String(status));
      try {await assert.rejects(runOpenAI(job(),new AbortController().signal),expected);}
      finally {rmSync(join(fakeDir,'response.json'));rmSync(join(fakeDir,'http-status'));}
    }
  });
  it('keeps non-ASCII text intact',async()=>{
    writeFileSync(join(fakeDir,'echo'),'30000');try{const r=await runOpenAI(job(),new AbortController().signal);assert.equal(r.text,'こんにちは、世界。ภาษาไทย 🙂\n'.repeat(30000));}finally{rmSync(join(fakeDir,'echo'));}
  });
  it('bounds stalled requests and supports immediate cancellation',async()=>{
    writeFileSync(join(fakeDir,'hang'),'');try{const t=Date.now();await assert.rejects(runOpenAI(job({timeoutMin:.005}),new AbortController().signal),/did not finish/);assert.ok(Date.now()-t<3000);}finally{rmSync(join(fakeDir,'hang'));}
    writeFileSync(join(fakeDir,'delay'),'30000');const ctl=new AbortController();setTimeout(()=>ctl.abort(),100);try{await assert.rejects(runOpenAI(job(),ctl.signal),/cancelled/);}finally{rmSync(join(fakeDir,'delay'));}
  });
});

describe('the job queue', () => {
  it('carries on after a job whose handler throws and after a CLI that hangs', async () => {
    const ran: string[] = [];
    const waiting: QueuedJob[] = [
      { queuedAt: 1, run: async () => { ran.push('throws'); throw new Error('database is locked'); } },
      { queuedAt: 2, run: async signal => {
        writeFileSync(join(fakeDir, 'hang'), '');
        try { await runOpenAI(job({ timeoutMin: 0.005 }), signal); ran.push('hang answered'); } catch (e) { ran.push('hang: ' + (e as Error).message); } finally { rmSync(join(fakeDir, 'hang')); }
      } },
      { queuedAt: 3, run: async () => { ran.push('next'); } },
    ];
    addJobSource(() => waiting[0] ? { queuedAt: waiting[0].queuedAt, run: signal => waiting.shift()!.run(signal) } : null);
    kick();
    await until('all three jobs', async () => ran.length === 3, 15_000);
    assert.deepEqual(ran, ['throws', 'hang: OpenAI did not finish within 0.005 minutes.', 'next']);
  });

  it('reports the running job and what waits, and refuses more than the limits', () => {
    const now = Date.now();
    const request = db.prepare(`INSERT INTO requests (site_id, domain, country, lang, topic, goal, status, started_at, created_at) VALUES (?, 'a.example', 'X', 'Y', ?, 'g', ?, ?, ?)`);
    request.run('s1', 'running', 'work', now - 4000, now);
    for (let i = 0; i < QUEUE_MAX_PER_SITE - 1; i++) request.run('s1', 't' + i, 'queued', null, now);
    db.prepare(`INSERT INTO articles (site_id, domain, country, lang, keyword, status, created_at, queued_at) VALUES ('s1', 'a.example', 'X', 'Y', 'k', 'revision', ?, ?)`).run(now, now);
    const snap = queueSnapshot();
    assert.equal(snap.running?.kind, 'request');
    assert.ok(snap.running && snap.running.id > 0 && snap.running.ageMs >= 4000 && snap.running.ageMs < 10_000);
    assert.deepEqual(snap.queued, { 'seo-task': 0, request: QUEUE_MAX_PER_SITE - 1, article: 1, photos: 0, build: 0, deploy: 0 });
    assert.equal(snap.total, QUEUE_MAX_PER_SITE);
    assert.equal(queueFull('s1'), '20 jobs are already waiting for this site. Let the agents finish some of them, then try again.');
    assert.equal(queueFull('s2'), '');
    assert.equal(queueFull(), '');
    for (let i = 0; i < QUEUE_MAX_TOTAL - QUEUE_MAX_PER_SITE; i++) request.run('s' + (2 + i % 3), 'u' + i, 'queued', null, now);
    assert.equal(queueFull('s9'), '50 jobs are already waiting. Let the agents finish some of them, then try again.');
    assert.equal(queueFull(), queueFull('s9'));
    db.exec('DELETE FROM requests; DELETE FROM articles;');
    assert.deepEqual(queueSnapshot(), { running: null, queued: { 'seo-task': 0, request: 0, article: 0, photos: 0, build: 0, deploy: 0 }, total: 0 });
  });
});

describe('limits', () => {
  it('locks an email for longer each time, and forgets on success', () => {
    const l = new Limiter(PER_EMAIL), t = 1_000_000;
    for (let i = 0; i < 4; i++) assert.equal(l.fail('a', t + i), false);
    assert.equal(l.fail('a', t + 4), true);
    assert.equal(l.wait('a', t + 5), 5 * 60_000 - 1);
    assert.equal(l.wait('b', t + 5), 0, 'another email is not affected');
    const t2 = t + 6 * 60_000;
    for (let i = 0; i < 5; i++) l.fail('a', t2 + i);
    assert.equal(l.wait('a', t2 + 4), 10 * 60_000, 'the second lock is twice as long');
    const t3 = t2 + 11 * 60_000;
    for (let i = 0; i < 5; i++) l.fail('a', t3 + i);
    assert.equal(l.wait('a', t3 + 4), 20 * 60_000);
    l.clear('a');
    assert.equal(l.wait('a', t3 + 5), 0);
    for (let i = 0; i < 5; i++) l.fail('a', t3 + 10 + i);
    assert.equal(l.wait('a', t3 + 14), 5 * 60_000, 'after a success it starts from the short lock again');
  });

  it('slows a client down after many failures, but never refuses it', () => {
    const s = new Slowdown(), t = 5_000_000;
    for (let i = 0; i < SLOW_AFTER - 1; i++) s.fail('127.0.0.1', t);
    assert.equal(s.delay('127.0.0.1', t), 0);
    s.fail('127.0.0.1', t);
    assert.equal(s.delay('127.0.0.1', t), 250);
    s.fail('127.0.0.1', t); s.fail('127.0.0.1', t);
    assert.equal(s.delay('127.0.0.1', t), 1000);
    for (let i = 0; i < 50; i++) s.fail('127.0.0.1', t);
    assert.equal(s.delay('127.0.0.1', t), SLOW_MAX_MS, 'never more than a few seconds');
    assert.equal(s.delay('127.0.0.1', t + 16 * 60_000), 0, 'and it passes');
  });

  it('locks the 2-step code for longer with every wrong code after the fifth', () => {
    assert.deepEqual([0, 4, 5, 6, 7, 8, 30].map(totpLockMs), [0, 0, 60_000, 120_000, 240_000, 480_000, 3_600_000]);
  });

  it('gives each person an allowance that refills', () => {
    const b = new Bucket(3, 10_000), t = 9_000_000;
    assert.deepEqual([b.take('u1', t), b.take('u1', t), b.take('u1', t)], [0, 0, 0]);
    assert.equal(b.take('u1', t), 10_000);
    assert.equal(b.take('u2', t), 0, 'another person has their own');
    assert.equal(b.take('u1', t + 4000), 6000);
    assert.equal(b.take('u1', t + 10_000), 0);
    assert.ok(!existsSync(join(TEST_DATA, 'nothing')), 'limits keep nothing on disk');
  });
});

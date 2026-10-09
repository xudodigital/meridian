import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { Client, member, owner, saveSites, startServer, until, type TestServer } from './testkit.ts';

let s: TestServer, c: Client, editor: Client, endpoint='', finishJob: (() => void) | null=null;
const fake = createServer(async (req,res) => {
  let raw=''; for await (const b of req) raw+=b;
  res.setHeader('content-type','application/json');
  if (req.url==='/api/show') { res.end(JSON.stringify({capabilities:['completion','tools','vision']})); return; }
  if (req.url==='/api/version') { res.end('{"version":"test-runtime"}'); return; }
  await new Promise<void>(r => { finishJob=r; });
  res.end(JSON.stringify({done:true,message:{content:JSON.stringify({summary:'Test result',notes:'Proposals, not measured volume.',keywords:[{keyword:'kopi tubruk',meaning:'Brewed coffee',intent:'Informational',cluster:'Coffee',basis:'Language proposal'}]})},prompt_eval_count:300,eval_count:50}));
});
before(async () => {
  await new Promise<void>(r => fake.listen(0,'127.0.0.1',r)); const a=fake.address(); endpoint='http://127.0.0.1:'+(typeof a==='object'&&a?a.port:0);
  s=await startServer({MERIDIAN_ENGINE:'openai-api',MERIDIAN_CODEX_BIN:'/no-such-codex-binary'}); c=await owner(s);
  editor=await member(s,c,'editor','editor@example.com','Editor');
  await saveSites(c,[{id:'pilot-test',domain:'test.example',cc:'ID',country:'Indonesia',lang:'Indonesian',topic:'Coffee',status:'live'}]);
});
after(async () => { finishJob?.(); if(s) { await s.halt('SIGTERM'); s.stop(); } await new Promise<void>(r => fake.close(() => r())); });
describe('Engine selection through the authenticated dashboard API', () => {
  it('allows only admins and validates the engine and endpoint', async () => {
    assert.equal((await editor.post('/api/engine/select',{mode:'gemma-local'})).status,403);
    assert.equal((await c.post('/api/engine/select',{mode:'unknown'})).status,400);
    assert.equal((await c.put('/api/integrations/gemma',{values:{endpoint:'http://192.168.1.5:11434',model:'gemma4:31b'}})).status,400);
    const r=await c.put('/api/integrations/gemma',{values:{endpoint,model:'gemma4:31b',context:'32768'}});
    assert.equal(r.status,200); assert.equal((r.data.result as {status:string}).status,'ok');
    assert.equal((await c.get('/api/state')).data.engine && ((await c.get('/api/state')).data.engine as {mode:string}).mode,'openai-api');
  });
  it('runs real queue and ledger plumbing with Gemma and refuses switching mid-job', async () => {
    assert.equal((await c.post('/api/engine/select',{mode:'gemma-local'})).status,200);
    // Isolated test fixture: yesterday's engine must not impose API charges on local work today.
    s.db().prepare("INSERT INTO job_runs (kind,job_id,site_id,agent,model,started_at,ended_at,tokens,cost_usd,outcome,engine) VALUES ('request',0,'pilot-test','Keyword','API fixture',?,?,10,100,'ok','openai-api')").run(Date.now(),Date.now());
    const r=await c.post('/api/requests',{siteId:'pilot-test',topic:'kopi',model:'GPT-6 Luna'}); assert.equal(r.status,201);
    await until('Gemma job to reach the local model',async () => finishJob);
    assert.equal((await c.post('/api/engine/select',{mode:'openai-api'})).status,409);
    assert.equal((await c.del('/api/integrations/gemma')).status,409);
    finishJob!();
    const done=await until('Gemma request to finish',async () => {
      const state=await c.get('/api/state'); return (state.data.requests as {status:string;engine:string;tokens:number;costUsd:number}[]).find(x => x.status==='done');
    });
    assert.equal(done.engine,'gemma-local'); assert.equal(done.tokens,350); assert.equal(done.costUsd,0);
    await until('usage ledger row',async () => s.db().prepare("SELECT engine,tokens,cost_usd FROM job_runs WHERE engine='gemma-local'").get());
  });
  it('persists selection on restart and keeps accounts, agents and Codex available', async () => {
    const old=s;
    await old.halt('SIGTERM'); s=await startServer({MERIDIAN_ENGINE:'openai-api',MERIDIAN_CODEX_BIN:'/no-such-codex-binary'},old.tmp);
    c.base=s.base; // Existing server session survives the restart.
    const state=await c.get('/api/state'); assert.equal(state.status,200); assert.equal((state.data.engine as {mode:string}).mode,'gemma-local');
    assert.ok((state.data.requests as unknown[]).length);
    assert.equal((await c.get('/api/workspace')).status,200);
    const r=await c.post('/api/engine/select',{mode:'codex-local'}); assert.equal(r.status,200); assert.equal((r.data.engine as {mode:string}).mode,'codex-local');
    assert.equal((await c.get('/api/integrations')).status,200);
  });
});

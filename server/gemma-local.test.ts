import { TEST_DATA } from './fixtures/temp-data.ts';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { gemmaConfig, gemmaEndpoint } from './gemma-config.ts';
import { gemmaStatus, runGemma } from './gemma-local.ts';
import { publicAddress, readPublicSource, sourceUrl } from './public-source.ts';
import { saveValues, removeValues } from './integrations.ts';
import { engineStatus, onModelRun, runOpenAI, type ModelRun } from './engine.ts';
import { runtimeMode, selectRuntime } from './runtime-config.ts';

let endpoint = '', calls: {path:string;body:Record<string,any>}[] = [];
let caps = ['completion','tools','vision'], remote = false;
let respond: (body:Record<string,any>) => Record<string,unknown> = () => ({});
const fake = createServer(async (req,res) => {
  let raw=''; for await (const b of req) raw += b;
  const body = raw ? JSON.parse(raw) : {};
  calls.push({path:req.url || '',body});
  res.setHeader('content-type','application/json');
  if (req.url === '/api/version') { res.end(JSON.stringify({version:'test-runtime'})); return; }
  if (req.url === '/api/show') { res.end(JSON.stringify({capabilities:caps,...(remote ? {remote_model:'gemma4',remote_host:'cloud'} : {})})); return; }
  res.end(JSON.stringify(respond(body)));
});
before(async () => { await new Promise<void>(r => fake.listen(0,'127.0.0.1',r)); const a=fake.address(); endpoint='http://127.0.0.1:'+(typeof a==='object' && a ? a.port : 0); });
beforeEach(() => {
  calls=[]; caps=['completion','tools','vision']; remote=false;
  respond=() => ({done:true,done_reason:'stop',message:{content:'{"summary":"real test response"}'},prompt_eval_count:20,eval_count:5});
  assert.equal(saveValues('gemma',{endpoint,model:'gemma4:31b',context:'32768'},'Test'),null);
  removeValues('runtime');
});
after(async () => { await new Promise<void>(r => fake.close(() => r())); rmSync(TEST_DATA,{recursive:true,force:true}); });
const job = {instructions:'Explicit skill text',prompt:'Return JSON',images:[] as string[],webSources:false,timeoutMin:1};
const signal = () => new AbortController().signal;

describe('Gemma localhost configuration and readiness', () => {
  it('accepts only loopback Ollama and local Gemma models', () => {
    assert.equal(gemmaEndpoint('http://localhost:11434'),'http://127.0.0.1:11434');
    for (const url of ['https://ollama.com','http://192.168.1.5:11434','http://127.0.0.1:11434/api','http://user:pass@localhost:11434','http://localhost:11434/?key=secret']) assert.throws(() => gemmaEndpoint(url));
    assert.throws(() => gemmaConfig({model:'gemma4:31b-cloud'}),/Cloud/);
    assert.throws(() => gemmaConfig({context:'100'}),/Context/);
  });
  it('checks the installed model without generating, and refuses remote weights', async () => {
    assert.equal((await gemmaStatus()).ready,true);
    assert.deepEqual(calls.map(x => x.path),['/api/show','/api/version']);
    remote=true; assert.match((await gemmaStatus()).reason,/remotely/);
  });
  it('reports an unavailable local server honestly', async () => {
    const s=await gemmaStatus({endpoint:'http://127.0.0.1:9',model:'gemma4:31b'});
    assert.equal(s.ready,false); assert.match(s.reason,/not reachable/);
  });
  it('preserves Codex selection and API model settings', async () => {
    selectRuntime('codex-local','Test'); assert.equal(runtimeMode(),'codex-local');
    selectRuntime('gemma-local','Test'); assert.equal(runtimeMode(),'gemma-local');
    assert.deepEqual(await engineStatus(true),{mode:'gemma-local',keyConfigured:false,apiVersion:'Ollama test-runtime',ready:true,reason:'',model:'gemma4:31b'});
  });
});
describe('Native Gemma jobs', () => {
  it('passes only explicit context/images, counts actual tokens and charges no API estimate', async () => {
    const r=await runGemma({...job,images:['aGVsbG8=']},signal());
    assert.equal(r.tokens,25); assert.equal(r.costUsd,0);
    const body=calls.find(x => x.path==='/api/chat')!.body;
    assert.equal(body.model,'gemma4:31b'); assert.equal(body.format,'json'); assert.equal(body.stream,false);
    assert.deepEqual(body.messages[1].images,['aGVsbG8=']); assert.equal(body.messages[0].content,job.instructions);
    assert.equal(JSON.stringify(body).includes('authorization'),false);
  });
  it('reserves usable input and output space for an 8192-token context', async () => {
    assert.equal(saveValues('gemma',{endpoint,model:'gemma4:31b',context:'8192'},'Test'),null);
    respond=() => ({done:true,message:{content:'{}'},prompt_eval_count:2000,eval_count:10});
    await runGemma(job,signal());
    assert.equal(calls.find(x => x.path==='/api/chat')!.body.options.num_predict,2048);
  });
  it('never falls back to OpenAI or Codex, and records partial usage on failure', async () => {
    selectRuntime('gemma-local','Test'); const runs:ModelRun[]=[]; onModelRun(r => runs.push(r));
    respond=() => ({done:true,done_reason:'length',message:{content:'partial'},prompt_eval_count:10,eval_count:3});
    await assert.rejects(() => runOpenAI({prompt:'Return JSON',model:'GPT-6 Luna',timeoutMin:1},signal()),/did not complete/);
    assert.equal(runs[0]?.engine,'gemma-local'); assert.equal(runs[0]?.tokens,13); assert.equal(runs[0]?.outcome,'failed'); assert.equal(runs[0]?.costUsd,0);
    assert.ok(calls.every(x => x.path.startsWith('/api/')));
  });
  it('refuses unsupported vision and unavailable tools before generation', async () => {
    caps=['completion'];
    await assert.rejects(() => runGemma({...job,images:['x']},signal()),/cannot inspect images/);
    await assert.rejects(() => runGemma({...job,webSources:true},signal()),/cannot read sources/);
    assert.ok(!calls.some(x => x.path==='/api/chat'));
  });
  it('supports bounded source tool calls, strips reasoning from history and labels limitations', async () => {
    respond=body => body.messages.length===2 ? {done:true,message:{thinking:'private reasoning',content:'',tool_calls:[{function:{name:'read_source',arguments:{url:'https://example.com/source'}}}]},prompt_eval_count:10,eval_count:2} : {done:true,message:{content:'{"sources":[{"url":"https://example.com/source"}],"reviewerNotes":[]}'},prompt_eval_count:20,eval_count:4};
    const r=await runGemma({...job,webSources:true},signal(),()=>{},async url => ({url,text:'Verified test fixture page'}));
    assert.equal(r.tokens,36); assert.match(r.text,/web search was unavailable/);
    const body=calls.filter(x => x.path==='/api/chat')[1]!.body;
    assert.equal(body.messages[3].tool_name,'read_source'); assert.ok(!JSON.stringify(body).includes('private reasoning'));
  });
  it('rejects made-up source checks, unvisited citations and unknown tools', async () => {
    await assert.rejects(() => runGemma({...job,webSources:true},signal()),/did not read any source/);
    respond=body => body.messages.length===2 ? {done:true,message:{tool_calls:[{function:{name:'read_source',arguments:{url:'https://example.com/source'}}}]}} : {done:true,message:{content:'{"sources":[{"url":"https://example.com/fake"}]}'}};
    await assert.rejects(() => runGemma({...job,webSources:true},signal(),()=>{},async url => ({url,text:'fixture'})),/not read/);
    respond=() => ({done:true,message:{tool_calls:[{function:{name:'shell',arguments:{command:'deploy'}}}]}});
    await assert.rejects(() => runGemma({...job,webSources:true},signal()),/unavailable tool/);
  });
  it('refuses incomplete JSON, context exhaustion and cancellation', async () => {
    respond=() => ({done:true,message:{content:'not JSON'}});
    await assert.rejects(() => runGemma(job,signal()),/JSON/);
    respond=() => ({done:true,prompt_eval_count:32000,message:{content:'{}'}});
    await assert.rejects(() => runGemma(job,signal()),/context is nearly full/);
    await assert.rejects(() => runGemma(job,AbortSignal.abort()),/cancelled/);
  });
});
describe('Public source restrictions', () => {
  it('rejects private addresses, credentials, non-HTTPS and search scraping', async () => {
    for (const ip of ['127.0.0.1','10.0.0.1','172.20.0.1','192.168.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1']) assert.equal(publicAddress(ip),false);
    assert.equal(publicAddress('8.8.8.8'),true);
    assert.throws(() => sourceUrl('http://example.com/'));
    assert.throws(() => sourceUrl('https://user:pass@example.com/'));
    assert.throws(() => sourceUrl('https://www.google.com/search?q=anything'));
    await assert.rejects(() => readPublicSource('https://127.0.0.1/',signal()),/public address/);
  });
});

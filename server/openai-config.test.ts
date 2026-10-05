import { TEST_DATA } from './fixtures/temp-data.ts';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { db } from './db.ts';
import { docError, getDoc, putDoc } from './workspace.ts';
import { openaiAgents, openaiSkills, upgradeOpenAI } from './openai-config.ts';
import { supportedModel } from './openai-models.ts';
after(()=>{db.close();rmSync(TEST_DATA,{recursive:true,force:true});});
describe('OpenAI-only configuration upgrade',()=>{
  it('converts retired models and restrictions while preserving identities, assignments and explicit OpenAI choices',()=>{
    const agents=[{id:'kw',model:'Claude Haiku 4.5',skills:['s2'],off:true,workers:2,prev:{claude:'Claude Opus 5.5'}},{id:'wr',model:'Gemini 3 Pro',skills:['s4']},{id:'bld',model:'GPT-6 Astra',prev:{openai:'GPT-6 Astra'}}];
    assert.deepEqual(openaiAgents(agents),[{id:'kw',model:'GPT-6 Luna',skills:['s2'],off:true,workers:2,prev:{}},{id:'wr',model:'GPT-6.1 Sol',skills:['s4'],prev:{}},{id:'bld',model:'GPT-6 Astra',prev:{openai:'GPT-6 Astra'}}]);
    assert.deepEqual(openaiSkills([{id:'s1',only:'claude',desc:'Keep'},{id:'s2',only:'openai'}]),[{id:'s1',desc:'Keep'},{id:'s2',only:'openai'}]);
  });
  it('upgrades persisted configuration once and deletes only retired integration records',()=>{
    putDoc('agents',0,[{id:'kw',model:'Claude Haiku 4.5',skills:['s2']}],1);
    putDoc('settings',0,{budget:17,native:false},1);
    const ins=db.prepare("INSERT INTO integrations (id,secret,config,tail,status,msg,updated_at,updated_by) VALUES (?, '', '{}', '', '', '', 1, 'Owner')");
    for(const id of ['claude','gemini','openai','cf'])ins.run(id);
    db.prepare("INSERT INTO requests(site_id,domain,country,lang,topic,goal,model,status,created_at) VALUES ('s1','a.example','X','Y','Pending','g','Claude Haiku 4.5','queued',1),('s1','a.example','X','Y','History','g','Claude Haiku 4.5','done',1)").run();
    upgradeOpenAI();
    const a=getDoc('agents');assert.equal(a.version,2);assert.deepEqual(a.data,[{id:'kw',model:'GPT-6 Luna',skills:['s2'],prev:{}}]);
    assert.deepEqual(db.prepare('SELECT id FROM integrations ORDER BY id').all().map(r=>r.id),['cf','openai']);
    assert.deepEqual(db.prepare('SELECT model FROM requests ORDER BY id').all().map(r=>r.model),['GPT-6 Luna','Claude Haiku 4.5']);
    assert.deepEqual(getDoc('settings').data,{budget:17,native:false});
    upgradeOpenAI();assert.deepEqual(getDoc('agents'),a);
  });
  it('refuses retired providers or arbitrary models in new workspace writes',()=>{
    assert.equal(supportedModel('GPT-6 Astra'),true);
    assert.equal(supportedModel('gpt-6-luna'),true);
    assert.equal(supportedModel('Claude Sonnet 5.5'),false);
    assert.match(docError('agents',[{id:'kw',model:'Claude Sonnet 5.5'}]),/supported OpenAI/);
    assert.match(docError('skills',[{id:'s2',only:'gemini'}]),/Only OpenAI/);
    assert.equal(docError('agents',[{id:'kw',model:'GPT-6 Luna'}]),'');
  });
});

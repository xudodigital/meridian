import { describe, expect, it } from 'vitest';
import { makeEmptyState, makeState, sessionFor } from '@/store/testing';
import type { Article, BuildWire, ServerArticle, WorkflowWire } from '@/store/types';
import { journeyFor } from './model';
import { executionModel } from '../skills/model';

export function linkedState() {
  const s = makeEmptyState(); s.sites = makeState().sites.slice(0,2); s.live.ready = true;
  s.kwReqs = [{id:'r10',rid:10,site:'a',domain:s.sites[0].domain,topic:'Coffee',st:'done',goal:'',t:new Date(0)}];
  const base = makeState().articles[0];
  const liveArticle = (id:number,requestId:number|null,siteId='a') => ({id,requestId,siteId,domain:s.sites.find(x=>x.id===siteId)!.domain,keyword:'Coffee',status:'review',step:'Waiting for review',history:[],steps:[]} as unknown as ServerArticle);
  s.live.arts = {20:liveArticle(20,10),21:liveArticle(21,99),22:liveArticle(22,10,'b')};
  s.articles = Object.values(s.live.arts).map(a=>({...base,id:`a${a.id}`,s:a.siteId,titleEn:`Article ${a.id}`,live:{aid:a.id,domain:a.domain,state:'review',step:'',engine:'openai-api'}} as Article));
  s.live.builds = {30:{id:30,siteId:'a',domain:s.sites[0].domain,version:1,articles:[20],status:'ready',review:'waiting',deploy:'',steps:[]} as unknown as BuildWire,31:{id:31,siteId:'a',domain:s.sites[0].domain,version:2,articles:[21],steps:[]} as unknown as BuildWire};
  s.live.workflows = {40:{id:40,siteId:'a',domain:s.sites[0].domain,name:'Weekly content',requestId:10,articles:[20],buildId:30,status:'running',step:'approve',wait:{kind:'person',text:'Waiting for approval'},log:[]} as unknown as WorkflowWire};
  return s;
}
describe('work journey lineage and permissions',()=>{
  it('follows request IDs and build membership without including unrelated same-site work',()=>{
    const j=journeyFor(linkedState(),{kind:'research',id:'r10'})!;
    expect(j.groups.map(g=>g.links.map(r=>r.id))).toEqual([['r10'],['a20'],['30'],['40']]);
  });
  it('traces a build back to only its own articles and requests',()=>{
    const j=journeyFor(linkedState(),{kind:'deploy',id:'30'})!;
    expect(j.groups.map(g=>g.links.map(r=>r.id))).toEqual([['r10'],['a20'],['30'],['40']]);
  });
  it('retains an incomplete workflow without inventing downstream records',()=>{
    const s=linkedState();s.live.workflows[40].buildId=null;
    expect(journeyFor(s,{kind:'workflow',id:'40'})!.groups[2].links).toEqual([]);
  });
  it('honours the site filter, deleted records and signed-out state',()=>{
    const s=linkedState();s.siteFilter='b';
    expect(journeyFor(s,{kind:'review',id:'a20'})).toBeNull();
    expect(journeyFor(s,{kind:'deploy',id:'999'})).toBeNull();
    s.siteFilter='all';s.session=null;
    expect(journeyFor(s,{kind:'review',id:'a20'})).toBeNull();
  });
  it('never reveals research, builds, workflows or another site to a reviewer',()=>{
    const s=linkedState();s.session=sessionFor('reviewer');
    expect(journeyFor(s,{kind:'review',id:'a20'})!.groups.map(g=>g.label)).toEqual(['Articles']);
    for(const t of [{kind:'review',id:'a22'},{kind:'research',id:'r10'},{kind:'deploy',id:'30'},{kind:'workflow',id:'40'},{kind:'sites',id:'a'}] as const)expect(journeyFor(s,t)).toBeNull();
  });
  it('labels demo deployment records explicitly',()=>{
    const s=makeState();const b=s.deploys[0];
    expect(journeyFor(s,{kind:'deploy',id:String(b.id)})?.message).toContain('simulated data');
  });
});
describe('execution engine labels',()=>{
  it('uses the configured OpenAI model and distinguishes code and unavailable engines',()=>{
    const s=linkedState();s.live.engine={mode:'openai-api',keyConfigured:true,apiVersion:'Responses API',ready:true,reason:''};
    expect(executionModel(s,{id:'wr',model:'GPT-6.1 Sol'})).toMatchObject({label:'OpenAI · GPT-6.1 Sol',fallback:false});
    expect(executionModel(s,{id:'kw',model:'GPT-6 Luna'})).toMatchObject({label:'OpenAI · GPT-6 Luna',fallback:false});
    expect(executionModel(s,{id:'orc',model:'GPT-6.1 Sol'}).label).toBe('Built-in code');
    s.live.engine=null;
    expect(executionModel(s,{id:'wr',model:'GPT-6.1 Sol'}).label).toBe('OpenAI unavailable');
  });
});

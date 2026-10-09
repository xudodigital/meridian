// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engineName, localRuntime, runtimeModel, showCosts } from '@/store/rules';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import { History } from '../History';
import { Integrations } from '../Integrations';
import { LocalOverview } from '../analytics/LocalOverview';
import { AgentGrid } from '../skills/AgentGrid';
import { ScheduleSheet } from '../workflows/ScheduleSheet';
import { nextStart } from '../workspace/start';

let root: Root | null=null;
beforeEach(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  window.matchMedia=vi.fn().mockReturnValue({matches:false,addEventListener(){},removeEventListener(){}});
  window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  resetStore(false); useStore.getState().signIn(meFor('admin'));
  useStore.setState(d => { d.live.on=true; d.live.ready=true; d.live.engine={mode:'gemma-local',keyConfigured:false,apiVersion:'Ollama',model:'gemma4:31b',ready:true,reason:''}; });
});
afterEach(async () => { if(root) await act(async () => root?.unmount()); root=null; vi.restoreAllMocks(); });
async function mount(node:ReactNode) { document.body.innerHTML='<div id="root"></div>'; root=createRoot(document.getElementById('root')!); await act(async () => root!.render(node)); return document.body.textContent || ''; }
describe('Local runtime UI', () => {
  it('keeps both engines available without displaying irrelevant API prices', async () => {
    const text=await mount(<Integrations />);
    expect(text).toContain('Gemma localhost'); expect(text).not.toContain('Models and prices'); expect(text).not.toContain('Connection and billing');
    const select=document.getElementById('engine-mode')!;
    await act(async () => select.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    expect(document.body.textContent).toContain('Codex local'); expect(document.body.textContent).toContain('OpenAI API');
  });
  it('shows the actual local model for agents and preserves their API defaults', async () => {
    const before=useStore.getState().agents.map(a => a.model);
    const text=await mount(<AgentGrid />);
    expect(text).toContain('gemma4:31b'); expect(text).toContain('Gemma localhost'); expect(text).not.toContain('per 1M tokens'); expect(text).not.toContain('ChatGPT usage limits');
    expect(useStore.getState().agents.map(a => a.model)).toEqual(before);
  });
  it('uses duration, tokens and real provenance in run history instead of dollar figures', async () => {
    useStore.setState(d => { d.jobLog=[{id:1,t:new Date(),agent:'Keyword',hue:0,task:'Research',site:null,dur:2,tokens:350,cost:0,engine:'gemma-local',status:'Done',steps:['Done']}]; });
    const text=await mount(<History />); expect(text).toContain('Gemma localhost'); expect(text).toContain('350'); expect(text).not.toContain('$'); expect(text).not.toContain('How costs');
  });
  it('does not mislabel missing Gemma as a missing OpenAI key', () => {
    useStore.setState(d => { d.live.engine!.ready=false; d.live.engine!.reason='Ollama is not reachable.'; });
    expect(nextStart(useStore.getState()).title).toBe('Connect Gemma on this computer');
    expect(nextStart(useStore.getState()).body).toContain('Ollama');
  });
  it('does not describe a local schedule as paid API work', async () => {
    const text=await mount(<ScheduleSheet edit="new" onClose={() => {}} />);
    expect(text).toContain('Each run uses the selected engine');
    expect(text).not.toContain('paid agent work');
    expect(text).not.toContain('daily budget');
  });
  it('replaces cost analytics with work metrics and retains Codex compatibility', async () => {
    const text=await mount(<LocalOverview />); expect(text).toContain('Token usage'.toLowerCase()); expect(text).not.toContain('$'); expect(text).not.toContain('spend');
    useStore.setState(d => { d.live.engine!.mode='codex-local';d.live.engine!.model='gpt-6.1-sol'; });
    const s=useStore.getState(); expect(localRuntime(s)).toBe(true); expect(showCosts(s)).toBe(false); expect(runtimeModel(s,'GPT-6 Luna')).toBe('gpt-6.1-sol'); expect(engineName(s.live.engine!.mode)).toBe('Codex local');
  });
});

// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi } from '@/store/fakeApi';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { IntegrationWire } from '@/store/types';
import { Integrations } from '../Integrations';
let root: Root, api: FakeApi;
const ads: IntegrationWire = { id:'ads', name:'Google Ads', connected:false, tail:'', status:'', msg:'', testedAt:null, updatedAt:null, updatedBy:'', config:{}, fields:[{k:'customerId',label:'Google Ads Customer ID',secret:false},{k:'loginCustomerId',label:'Manager Customer ID (optional)',secret:false,optional:true}],oauth:true,worksWithout:'',help:'Save the customer account, then connect with Google. No campaigns are changed.' };
const mount = async (n: ReactNode) => { await act(async () => root.render(n)); };
const click = async (n: Element) => { await act(async () => n.dispatchEvent(new MouseEvent('click',{bubbles:true}))); };
const card = () => [...document.querySelectorAll('.int')].find(c => c.querySelector('h3')?.textContent === 'Google Ads')!;
const button = (text: string, within: ParentNode = document) => [...within.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({matches:false,addEventListener(){},removeEventListener(){}});
  window.HTMLDialogElement.prototype.showModal = function(){this.setAttribute('open','');};
  window.HTMLDialogElement.prototype.close = function(){this.removeAttribute('open');};
  resetStore(false);useStore.getState().signIn(meFor('admin'));
  useStore.setState(d => {d.sync.loaded=true;d.live.on=d.live.ready=true;d.live.ints.ads={...ads};d.live.engine={mode:'codex-local',ready:true,keyConfigured:false,model:'gpt-6.1-sol',apiVersion:'codex-cli',reason:''};});
  api=new FakeApi();vi.stubGlobal('fetch',api.fetch);
  document.body.innerHTML='<div id="root"></div>';root=createRoot(document.getElementById('root')!);
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('Google Ads setup',()=>{
  it('keeps OAuth disabled until customer and Google client are configured; leaves other engines available',async()=>{
    await mount(<Integrations/>);expect(card().textContent).toContain('Not connected');expect(button('Connect with Google',card()).disabled).toBe(true);
    expect(document.body.textContent).toContain('Codex');expect(document.body.textContent).toContain('Gemma localhost');expect(document.body.textContent).toContain('SerpApi');
    await click(button('Set up account',card()));
    expect(document.querySelector('#svc-ads-customerId')).not.toBeNull();expect(document.body.textContent).toContain('optional manager ID');
    expect(document.body.textContent).not.toContain('Developer token');
  });
  it('saves an account through the API without pretending OAuth is connected',async()=>{
    api.on('PUT','/api/integrations/ads',()=>({result:{status:'warn',msg:'Customer saved. Connect with Google.'},integration:{...ads,updatedAt:1,config:{customerId:'1234567890'},status:'warn'}}));
    await mount(<Integrations/>);await click(button('Set up account',card()));
    const input=document.querySelector<HTMLInputElement>('#svc-ads-customerId')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'123-456-7890');input.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>document.querySelector('dialog form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(api.to('PUT','/api/integrations/ads')[0].body).toEqual({values:{customerId:'123-456-7890',loginCustomerId:''}});
    expect(useStore.getState().live.ints.ads.connected).toBe(false);expect(card().textContent).toContain('Change account');expect(card().textContent).toContain('Not connected');
  });
  it('offers authorization after setup and a separate test after connection',async()=>{
    useStore.setState(d=>{d.live.ints.google={...ads,id:'google',name:'Google sign-in',oauth:false,connected:true,status:'ok'};d.live.ints.ads={...ads,updatedAt:1,config:{customerId:'1234567890'}};});
    await mount(<Integrations/>);expect(button('Connect with Google',card()).disabled).toBe(false);
    await act(async()=>useStore.setState(d=>{d.live.ints.ads.connected=true;d.live.ints.ads.status='ok';}));
    expect(button('Reconnect with Google',card())).toBeDefined();expect(button('Test connection',card())).toBeDefined();expect(button('Disconnect',card())).toBeDefined();
  });
});

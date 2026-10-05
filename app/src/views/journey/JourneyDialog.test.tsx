// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { makeState, resetStore } from '@/store/testing';
import { editGuard } from '@/store/editGuard';
import { JourneyDialog } from './JourneyDialog';
import { closeJourney, openJourney } from './state';
let root:Root;
beforeEach(()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));};
 resetStore();useStore.setState(makeState());document.body.innerHTML='<div id="root"></div>';root=createRoot(document.getElementById('root')!);
});
afterEach(async()=>{await act(async()=>{root.unmount();closeJourney();editGuard.end();});});
it('opens the chosen article and preserves unsaved edits until the person decides',async()=>{
 await act(async()=>{openJourney({kind:'review',id:'2'});root.render(<JourneyDialog/>);});
 const button=()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Open this article'))!;
 editGuard.begin(1);editGuard.setDirty(true);
 await act(async()=>button().click());
 expect(editGuard.get().asking).toBe(true);expect(useStore.getState().rsel).not.toBe(2);
 await act(async()=>editGuard.answer(true));
 expect(useStore.getState().rsel).toBe(2);expect(useStore.getState().rtab).toBe('open');
});
it('keeps a writing article in Waiting rather than opening the unrelated demo Drafts table',async()=>{
 useStore.setState(d=>{d.articles[0].status='writing';});
 await act(async()=>{openJourney({kind:'review',id:'1'});root.render(<JourneyDialog/>);});
 await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Open this article'))!.click();});
 expect(useStore.getState().rsel).toBe(1);expect(useStore.getState().rtab).toBe('open');
});

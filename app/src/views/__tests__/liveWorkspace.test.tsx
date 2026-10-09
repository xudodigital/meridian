// @vitest-environment jsdom
/* The Workspace while real work runs (outside demo mode): the server's step on the task line, the short "Done" moment
   after a job, the walk to the break room, and the hand-off pages between agents and to and from the people who
   decide, in the Office and in the Cards view. jsdom has no layout, so every box measures zero: a page "flies" whenever
   both ends of a hand-off were found. Nothing moves when the person prefers reduced motion. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serverArticle, T_ART } from '@/store/articleFixtures';
import { buildWire } from '@/store/buildFixtures';
import { photo, photoJob, withPhotos } from '@/store/liveAgentFixtures';
import { liveApply } from '@/store/liveApply';
import { DONE_MS, liveAgentsTo } from '@/store/liveAgents';
import { liveBuildTo } from '@/store/liveBuilds';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { ArticleEvent, ServerArticle } from '@/store/types';
import { Workspace } from '../Workspace';

let reduced = false;
const animations: { el: Element; duration: number }[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (q: string) => ({ matches: reduced && q.includes('reduced-motion'), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  window.Element.prototype.scrollIntoView = () => {};
  window.Element.prototype.animate = function (this: Element, _k: Keyframe[] | PropertyIndexedKeyframes | null, o?: number | KeyframeAnimationOptions) {
    animations.push({ el: this, duration: typeof o === 'number' ? o : Number(o?.duration ?? 0) });
    return { onfinish: null } as unknown as Animation;
  };
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

const T = T_ART;
let root: Root;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const byText = (sel: string, text: string) => $$(sel).find(b => b.textContent === text) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const flights = () => animations.filter(x => x.el.classList.contains('fly') && x.duration === 1200).length;
const pill = (id: string) => $(`#desk-${id} .pill`)?.textContent;

/** Articles as the server sends them; `now` is the page's clock for this change. */
const server = (arts: ServerArticle[], now: number) => act(async () => {
  useStore.getState().mutate(d => { arts.forEach(a => { d.live.arts[a.id] = a; }); liveApply(d, now); });
});
/** The page's clock moves on: the tick ends the done moment. */
const later = (now: number) => act(async () => { useStore.getState().mutate(d => { liveAgentsTo(d, now); }); });

const asked: ArticleEvent = { at: T, by: 'Dana Owner', action: 'requested', note: '' };
const writtenAt = (at: number): ArticleEvent => ({ at, by: 'Content Writer', action: 'written', note: '' });
const writing = () => serverArticle(5, { status: 'work', step: 'Reading the skills', content: null, finishedAt: null, history: [asked] });
const written = () => serverArticle(5, { finishedAt: T + 95_000, history: [asked, writtenAt(T + 95_000)] });

beforeEach(async () => {
  reduced = false; animations.length = 0;
  localStorage.clear();
  resetStore(false);
  useStore.getState().signIn(meFor('admin', 'Dana Owner', 'owner@example.com'));
  /* The page has loaded the server's state, with nothing running. */
  useStore.getState().mutate(d => {
    d.sites.push({ id: 'a', domain: 'kopi.example', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
    d.live.on = true; liveApply(d, T); d.live.ready = true;
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root.render(<Workspace />); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); });

describe('the Workspace while real work runs', () => {
  it('shows the server\'s step, then Done briefly, then waits for human review', async () => {
    await server([writing()], T + 10_000);
    expect($('#desk-wr')?.getAttribute('data-st')).toBe('work');
    expect(pill('wr')).toBe('Working');
    expect($('#desk-wr .task')?.textContent).toBe('Writing an article: cà phê phin · Reading the skills');

    await server([written()], T + 95_000);
    expect($('#desk-wr')?.getAttribute('data-st')).toBe('done');
    expect(pill('wr')).toBe('Done');
    expect($('#desk-wr .donemark')).not.toBeNull();
    expect($('#desk-wr .task')?.textContent).toBe('Writing an article: cà phê phin · Sent to Article review');
    expect($<HTMLElement>('#desk-wr .bar i')?.style.width).toBe('100%');

    await later(T + 95_000 + DONE_MS);
    expect($('#desk-wr')?.getAttribute('data-st')).toBe('wait');
    expect(pill('wr')).toBe('Needs approval');
    expect($('#desk-wr .task')?.textContent).toContain('Article awaiting your review: cà phê phin');
    expect($<HTMLElement>('#desk-wr .bar i')?.style.width).toBe('0%');
    expect($('#desk-wr .donemark')).toBeNull();
  });

  it('shows a failed job as Failed with the reason', async () => {
    await server([writing()], T + 10_000);
    await server([serverArticle(5, { status: 'failed', error: 'Claude Code did not answer.', content: null, finishedAt: T + 60_000, history: [asked] })], T + 60_000);
    expect($('#desk-wr')?.getAttribute('data-st')).toBe('failed');
    expect(pill('wr')).toBe('Failed');
    expect($('#desk-wr .task')?.textContent).toBe('Writing an article: cà phê phin · Claude Code did not answer.');
  });

  it('in the Office, keeps a finished person at the desk for the moment, then moves them to the meeting room for review', async () => {
    await click(byText('[role="tab"]', 'apartmentOffice'));
    await server([writing()], T + 10_000);
    expect($('#room-content #desk-wr')).not.toBeNull();
    expect($('#desk-wr .bubble')?.textContent).toBe('Writing an article: cà phê phin · Reading the skills');
    await server([written()], T + 95_000);
    expect($('#room-content #desk-wr')?.getAttribute('data-st')).toBe('done');
    expect($('#desk-wr')?.getAttribute('aria-label')).toBe('Content Writer, done. Open details');
    await later(T + 95_000 + DONE_MS);
    expect($('#room-meet #desk-wr')?.getAttribute('data-st')).toBe('wait');
  });

  it('flies pages along real work in the Office: from the Keyword agent on to the meeting room and back', async () => {
    await click(byText('[role="tab"]', 'apartmentOffice'));
    /* An article asked for from a research keyword. */
    await server([writing()], T + 10_000);
    expect(useStore.getState().handoff.pairs).toEqual([{ from: 'kw', to: 'wr' }]);
    expect(flights()).toBe(1);
    await server([withPhotos(written(), photoJob())], T + 95_000);
    expect(useStore.getState().handoff.pairs).toEqual([{ from: 'wr', to: 'bld' }]);
    expect(flights()).toBe(2);
    /* The photos are chosen: the article goes to the people who review it (the meeting room). */
    await server([withPhotos(written(), photoJob({ status: 'done', startedAt: T + 96_000, finishedAt: T + 150_000 }), [photo('p1')])], T + 150_000);
    expect(useStore.getState().handoff.pairs).toEqual([{ from: 'bld', to: '@meet' }]);
    expect(flights()).toBe(3);
    /* A reviewer's note goes back to the Content Writer, though nobody changes room. */
    await later(T + 160_000);
    const revision: ArticleEvent = { at: T + 200_000, by: 'Linh Reviewer', action: 'revision', note: 'Shorter.' };
    await server([serverArticle(5, { status: 'queued', pendingNote: 'Shorter.', finishedAt: T + 95_000, history: [asked, writtenAt(T + 95_000), revision] })], T + 200_000);
    expect(useStore.getState().handoff.pairs).toEqual([{ from: '@meet', to: 'wr' }]);
    expect(flights()).toBe(4);
  });

  it('flies pages between cards in the Cards view', async () => {
    await server([writing()], T + 10_000);
    expect(flights()).toBe(1);
    await server([withPhotos(written(), photoJob())], T + 95_000);
    expect(flights()).toBe(2);
  });

  it('says in the agent sheet what the Site Builder is doing now and what its jobs are', async () => {
    await server([withPhotos(written(), photoJob({ status: 'work', startedAt: T + 96_000, step: 'Searching Wikimedia Commons' }))], T + 100_000);
    await act(async () => { useStore.getState().openAgent('bld'); });
    expect($('dialog[open] #sheetT')?.textContent).toBe('Site Builder');
    expect($$('dialog[open] .dsec')[0]?.textContent).toContain('Choosing photos: cà phê phinSearching Wikimedia Commons');
    expect($('dialog[open]')?.textContent).toContain('choosing openly licensed photos for each article that is written');
  });

  it('lists a website build waiting for approval under "Needs approval", where the Site Builder\'s page lands', async () => {
    expect($('#ws-approvals')).toBeNull();
    expect($('#k-wait')).toBeNull();
    await act(async () => { useStore.getState().mutate(d => { liveBuildTo(d, buildWire(3, 'a', 'kopi.example', 1)); }); });
    expect($('#ws-approvals')?.textContent).toContain('1 website build waiting for approval');
    expect($('#ws-approvals')?.textContent).not.toContain('Nothing needs approval.');
    expect($('#k-wait')?.textContent).toBe('1');
    expect(byText('button', 'Open Build and deploy')).not.toBeNull();
  });

  it('does not animate when the person prefers reduced motion', async () => {
    reduced = true;
    await server([writing()], T + 10_000);
    await server([withPhotos(written(), photoJob())], T + 95_000);
    await click(byText('[role="tab"]', 'apartmentOffice'));
    await server([withPhotos(written(), photoJob({ status: 'done', startedAt: T + 96_000, finishedAt: T + 150_000 }))], T + 150_000);
    await later(T + 150_000 + DONE_MS);
    expect(useStore.getState().handoff.seq).toBe(3);
    expect($('#room-break #desk-bld')).not.toBeNull();
    expect(animations).toHaveLength(0);
    expect($('.fly')).toBeNull();
  });
});

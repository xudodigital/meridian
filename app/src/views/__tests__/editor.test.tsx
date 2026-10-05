// @vitest-environment jsdom
/* Package E in the app: editing a real article before approval (Edit, Save, Cancel, the unsaved-changes guard), the
   "translation not updated" mark, sending an approved article back to review, the archive, approving several
   articles at once, and writing several articles from one research result. Every change calls the server. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { articleContent, serverArticle } from '@/store/articleFixtures';
import { editGuard } from '@/store/editGuard';
import { liveApply } from '@/store/live';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { EngineStatus, Role, ServerArticle, ServerRequest } from '@/store/types';
import { Research } from '../Research';
import { Review } from '../Review';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

let root: Root | null = null;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const st = () => useStore.getState();
const text = () => document.body.textContent ?? '';
const button = (t: string, within = 'body') => $$(within + ' button').find(e => e.textContent?.replace(/^[a-z_]+(?=[A-Z])/, '') === t) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const type = async (el: HTMLTextAreaElement | HTMLInputElement | null, value: string) => {
  expect(el).not.toBeNull();
  await act(async () => {
    const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const key = async (el: Element | null, init: KeyboardEventInit) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); }); };
const field = (id: string) => $<HTMLTextAreaElement>(`[data-ed="${id}"]`);
const unmount = async () => { if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; } };
const mount = async (node: ReactNode) => {
  await unmount();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(node); });
};
const change = (fn: () => void) => act(async () => { fn(); });

const engineOn: EngineStatus = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.0', ready: true, reason: '' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = [method: string, url: string, body: Record<string, unknown>];
/** fetch answering every call with `answer(method, url, body)`; the calls are kept for assertions. */
function server(answer: (method: string, url: string, body: Record<string, unknown>) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, method = init?.method ?? 'GET';
    calls.push([method, url, body]);
    return answer(method, url, body);
  }));
  return calls;
}
const goLive = (arts: ServerArticle[] = [], reqs: ServerRequest[] = []) => change(() => useStore.setState(d => {
  d.live.on = true; d.live.engine = engineOn; reqs.forEach(r => { d.live.reqs[r.id] = r; }); arts.forEach(a => { d.live.arts[a.id] = a; }); liveApply(d); d.live.ready = true;
}));
let site = '';
const art = (id: number, over: Partial<ServerArticle> = {}) => serverArticle(id, { siteId: site, domain: 'kopi.example', ...over });
const signIn = (role: Role) => change(() => st().signIn(meFor(role, undefined, undefined, role === 'reviewer' ? { site } : {})));
const open = async (arts: ServerArticle[]) => { await goLive(arts); await mount(<Review />); };
const edit = async () => { await click(button('Edit', '.rvhead')); };
/** The article the server would answer an edit with. */
const edited = (a: ServerArticle, over: Partial<ServerArticle['content'] & object> = {}): ServerArticle => ({
  ...a, updatedAt: a.updatedAt + 1000, content: { ...a.content!, ...over }, history: [...a.history, { at: a.updatedAt + 1000, by: 'Dana Owner', action: 'edited', note: 'Changed the text of 1 block.' }],
});

beforeEach(() => {
  localStorage.clear();
  resetStore(false);
  editGuard.end();
  st().signIn(meFor('admin', 'Dana Owner', 'owner@example.com'));
  st().addSite({ domain: 'kopi.example', country: 0, lang: 'Vietnamese', topic: 'Coffee', status: 'live' });
  site = st().sites[0]!.id;
  vi.spyOn(console, 'error');
});
afterEach(async () => {
  await unmount();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Edit on an article waiting for review', () => {
  it('is offered to admins and editors, only while the article waits for review', async () => {
    await open([art(11)]);
    expect(button('Edit', '.rvhead')).not.toBeNull();
    await signIn('editor');
    expect(button('Edit', '.rvhead')).not.toBeNull();
    for (const role of ['reviewer', 'viewer'] as const) { await signIn(role); expect(button('Edit', '.rvhead'), role).toBeNull(); }
    await signIn('admin');
    await open([art(12, { status: 'approved' })]);
    await click($('[role="tab"]:nth-child(2)'));
    expect($('.rvd h2')?.textContent).toBe('Cách pha cà phê phin');
    expect(button('Edit', '.rvhead')).toBeNull();
  });

  it('turns the article into fields in place, with Save disabled until something changes', async () => {
    await open([art(11)]);
    await edit();
    expect($('.rvhead .pill')?.textContent).toBe('Editing');
    expect(field('title')?.value).toBe('Cách pha cà phê phin');
    expect(field('b0')?.value).toBe('Cà phê phin là cách pha phổ biến.');
    expect($$<HTMLTextAreaElement>('.ed-list textarea').map(x => x.value)).toEqual(['Cà phê xay thô']);
    expect($$<HTMLInputElement>('.ed-table input').map(x => x.value)).toEqual(['Tỉ lệ', 'Thời gian', '1:8', '5 phút']);
    expect($<HTMLInputElement>('.ed-slug input')?.value).toBe('cach-pha-ca-phe-phin');
    expect($('.ed-bar b')?.textContent).toBe('No changes yet');
    expect((button('Save changes') as HTMLButtonElement).disabled).toBe(true);
    /* The decision waits until the edit is saved or cancelled. */
    expect($('.decide')).toBeNull();
    /* The rest of the article is where it was: checks, language review, sources, notes, history. */
    for (const h of ['Automated checks', 'Native-speaker review', 'Search appearance', 'Article', 'Sources', 'Notes from the agent', 'History']) expect($$('.rvd h3').map(x => x.textContent), h).toContain(h);
    await click(button('Cancel'));
    expect($('.ed')).toBeNull();
    expect($('.decide')).not.toBeNull();
    expect($('dialog[open]')).toBeNull();
  });

  it('saves the changes with the version they were made on, and shows the new version', async () => {
    const a = art(11);
    await open([a]);
    await edit();
    await type(field('b0'), 'Cà phê phin là cách pha rất phổ biến.');
    await type(field('title'), 'Cách pha cà phê phin tại nhà');
    await type($<HTMLTextAreaElement>('.ed-f textarea'), 'Cách pha cà phê phin | Kopi');
    expect($('.ed-bar b')?.textContent).toBe('Unsaved changes');
    expect(editGuard.get()).toEqual({ id: 'a11', dirty: true, asking: false });
    /* The English beside what was changed is marked at once: that is what the save will record. */
    expect($$('.ed-row').filter(r => r.querySelector('.ed-stale')).map(r => r.querySelector('textarea')?.getAttribute('data-ed'))).toEqual(['title', 'b0']);

    const after = edited(a, { title: 'Cách pha cà phê phin tại nhà', titleEnStale: true, blocks: [{ type: 'p', text: 'Cà phê phin là cách pha rất phổ biến.', en: 'Phin coffee is a common way to brew.', enStale: true }, ...a.content!.blocks.slice(1)] });
    const calls = server(() => json({ article: after }));
    await click(button('Save changes'));
    await settle();
    expect(calls).toEqual([['PATCH', '/api/articles/11/content', {
      updatedAt: a.updatedAt, title: 'Cách pha cà phê phin tại nhà', titleTag: 'Cách pha cà phê phin | Kopi', metaDescription: 'Tỉ lệ và thời gian.', slug: 'cach-pha-ca-phe-phin', category: '',
      disclosure: a.content!.disclosure.text,
      blocks: [
        { from: 0, type: 'p', text: 'Cà phê phin là cách pha rất phổ biến.' }, { from: 1, type: 'h2', text: 'Tỉ lệ' },
        { from: 2, type: 'list', items: ['Cà phê xay thô'] }, { from: 3, type: 'table', rows: [['Tỉ lệ', 'Thời gian'], ['1:8', '5 phút']] },
      ],
    }]]);
    expect($('.ed')).toBeNull();
    expect(editGuard.get().id).toBeNull();
    expect(st().snackMsg?.msg).toBe('Saved your changes: How to brew phin coffee');
    expect($('.rvd h2')?.textContent).toBe('Cách pha cà phê phin tại nhà');
    /* The read-only article marks the same pieces, and the history says who edited. */
    expect($$('table.bi .ed-stale').map(x => x.textContent)).toEqual(['translateEdited, translation not updated', 'translateEdited, translation not updated']);
    expect(text()).toContain('Dana Owner edited it: Changed the text of 1 block.');
    /* The page writes nothing to the audit log itself: the server does. */
    expect(st().log.map(l => l.act)).toEqual(['Added kopi.example (Vietnam)']);
  });

  it('keeps the editor open with the server\'s message when the save is refused', async () => {
    await open([art(11)]);
    await edit();
    await type(field('b1'), 'Tỉ lệ pha');
    const calls = server(() => json({ error: 'This article was changed by someone else while you were editing, so your changes were not saved. Copy what you need, cancel, and edit the newer version.' }, 409));
    await click(button('Save changes'));
    await settle();
    expect(calls).toHaveLength(1);
    expect($('.ed-msg')?.getAttribute('role')).toBe('alert');
    expect($('.ed-msg')?.textContent).toMatch(/changed by someone else while you were editing/);
    expect(field('b1')?.value).toBe('Tỉ lệ pha');
    expect((button('Save changes') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not send an article without a title or a paragraph', async () => {
    await open([art(11)]);
    await edit();
    const calls = server(() => json({}, 500));
    await type(field('title'), '  ');
    await click(button('Save changes'));
    expect($('.ed-msg')?.textContent).toBe('The article needs a title.');
    await type(field('title'), 'Tiêu đề');
    await type(field('b0'), '');
    await click(button('Save changes'));
    expect($('.ed-msg')?.textContent).toBe('The article needs at least one paragraph.');
    expect(calls).toEqual([]);
  });

  it('says so when the article changes under the editor, and cannot save over it', async () => {
    const a = art(11);
    await open([a]);
    await edit();
    await type(field('b0'), 'Của tôi.');
    await goLive([edited(a, { title: 'Người khác đã sửa' })]);
    expect($('.ed-bar .callout')?.textContent).toMatch(/This article changed while you were editing\. Someone else saved a newer version\./);
    expect((button('Save changes') as HTMLButtonElement).disabled).toBe(true);
    /* What the person typed is still there to copy. */
    expect(field('b0')?.value).toBe('Của tôi.');
  });

  it('warns about a title tag and a meta description a search result would cut off or find thin', async () => {
    await open([art(11)]);
    await edit();
    expect($('#edTagN')?.textContent).toBe('27 / 60');
    expect($('#edMetaN')?.textContent).toBe('19 / 160 · short');
    await type($<HTMLTextAreaElement>('.ed-f textarea'), 'x'.repeat(61));
    expect($('#edTagN')?.textContent).toBe('61 / 60 · may be cut off');
    expect($('#edTagN')?.className).toContain('off');
    expect($('.ed-serp-t')?.textContent).toBe('x'.repeat(59) + '…');
    await type($<HTMLInputElement>('.ed-slug input'), 'Cà phê Phin!');
    expect($('.ed-serp-url')?.textContent).toBe('kopi.example › cà-phê-phin');
  });
});

describe('the editor from the keyboard', () => {
  const blocks = () => $$<HTMLTextAreaElement>('.ed-block > .ed-row').map(r => r.querySelector('textarea, input')?.getAttribute('data-ed')?.split(':')[0]);

  it('saves with Ctrl+S and cancels with Escape', async () => {
    const a = art(11);
    await open([a]);
    await edit();
    await type(field('b1'), 'Tỉ lệ pha');
    const calls = server(() => json({ article: edited(a) }));
    await key(field('b1'), { key: 's', ctrlKey: true });
    await settle();
    expect(calls.map(c => c.slice(0, 2))).toEqual([['PATCH', '/api/articles/11/content']]);
    expect($('.ed')).toBeNull();

    await edit();
    await key(field('b0'), { key: 'Escape' });
    expect($('.ed')).toBeNull();
  });

  it('starts a new paragraph at the caret with Enter and moves a block with Alt and an arrow', async () => {
    await open([art(11)]);
    await edit();
    const p = field('b0')!;
    p.setSelectionRange(12, 12);
    await key(p, { key: 'Enter' });
    expect(field('b0')?.value).toBe('Cà phê phin ');
    const added = blocks()[1]!;
    expect(field(added)?.value).toBe('là cách pha phổ biến.');
    expect(document.activeElement).toBe(field(added));
    expect(field(added)?.closest('.ed-row')?.querySelector('.ed-stale')?.textContent).toBe('translateAdded by a person, not translated');

    await key(field(added), { key: 'ArrowUp', altKey: true });
    expect(blocks().slice(0, 3)).toEqual([added, 'b0', 'b1']);
    expect(document.activeElement).toBe(field(added));
    /* Backspace in an empty block removes it and puts the caret in the block before. */
    await type(field('b1'), '');
    await key(field('b1'), { key: 'Backspace' });
    expect(blocks()).toEqual([added, 'b0', 'b2', 'b3']);
    expect(document.activeElement).toBe(field('b0'));
  });

  it('adds, turns and removes blocks from the block menu, and sends where each block came from', async () => {
    const a = art(11);
    await open([a]);
    await edit();
    const menuOf = (n: number) => $(`[aria-label^="Actions for block ${n},"]`);
    await click(menuOf(2));
    expect($$('.ed-menu [role="menuitem"]').map(x => x.textContent)).toEqual(['arrow_upwardMove upAlt ↑', 'arrow_downwardMove downAlt ↓', 'notesParagraphEnter', 'titleHeading', 'format_list_bulletedList', 'tableTable', 'notesParagraph', 'text_fieldsHeading 3', 'deleteRemove block']);
    await click(button('Heading 3', '.ed-menu'));
    expect($('.ed-menu')).toBeNull();
    await click(menuOf(2));
    await click(button('List', '.ed-menu'));
    const list = blocks()[2]!;
    await type(field(list + ':0'), 'Nước sôi');
    await click(menuOf(4));
    await click(button('Remove block', '.ed-menu'));
    await click(menuOf(1));
    await click($$('.ed-menu button').find(x => x.textContent?.includes('Move down')) ?? null);
    expect(blocks()).toEqual(['b1', 'b0', list, 'b3']);

    const calls = server(() => json({ article: edited(a) }));
    await click(button('Save changes'));
    await settle();
    expect(calls[0]?.[2].blocks).toEqual([
      { from: 1, type: 'h3', text: 'Tỉ lệ' }, { from: 0, type: 'p', text: 'Cà phê phin là cách pha phổ biến.' },
      { from: null, type: 'list', items: ['Nước sôi'] }, { from: 3, type: 'table', rows: [['Tỉ lệ', 'Thời gian'], ['1:8', '5 phút']] },
    ]);
  });
});

describe('unsaved changes', () => {
  it('asks before Cancel drops them: Keep editing stays, Discard changes leaves', async () => {
    await open([art(11)]);
    await edit();
    await type(field('b0'), 'Đã sửa.');
    await click(button('Cancel'));
    expect($('dialog[open] h2')?.textContent).toBe('Discard your changes?');
    await click(button('Keep editing', 'dialog[open]'));
    expect($('dialog[open]')).toBeNull();
    expect(field('b0')?.value).toBe('Đã sửa.');
    await click(button('Cancel'));
    await click(button('Discard changes', 'dialog[open]'));
    expect($('.ed')).toBeNull();
    expect(editGuard.get()).toEqual({ id: null, dirty: false, asking: false });
    expect($('table.bi')?.textContent).toContain('Cà phê phin là cách pha phổ biến.');
  });

  it('asks before another article, another tab or another view takes the editor away', async () => {
    await open([art(11), art(12, { keyword: 'cold brew', content: articleContent({ title: 'Cold brew', titleEn: 'Cold brew at home' }) })]);
    await click($('[data-art="a11"]'));
    await edit();
    await type(field('b0'), 'Đã sửa.');
    await click($('[data-art="a12"]'));
    expect($('dialog[open] h2')?.textContent).toBe('Discard your changes?');
    expect($('.rvd h2')?.textContent).toBe('Cách pha cà phê phin');
    await click(button('Keep editing', 'dialog[open]'));
    await click($('[role="tab"]:nth-child(2)'));
    expect($('dialog[open] h2')?.textContent).toBe('Discard your changes?');
    expect(st().rtab).toBe('open');
    await click(button('Keep editing', 'dialog[open]'));
    /* The same guard is what opening another view goes through (router.tsx). */
    const leave = vi.fn();
    await change(() => { void import('@/store/editGuard').then(g => g.leaveEdit(leave)); });
    await settle();
    expect(leave).not.toHaveBeenCalled();
    await click(button('Discard changes', 'dialog[open]'));
    expect(leave).toHaveBeenCalledTimes(1);
    /* Discarding closes the editor, wherever the person was going. */
    expect($('.ed')).toBeNull();

    await edit();
    await type(field('b0'), 'Lần nữa.');
    await click($('[data-art="a12"]'));
    await click(button('Discard changes', 'dialog[open]'));
    expect($('.rvd h2')?.textContent).toBe('Cold brew');
    expect($('.ed')).toBeNull();
  });

  it('keeps the article open when the list would drop it, and warns before the page is closed', async () => {
    const a = art(11);
    await open([a, art(12, { content: articleContent({ title: 'Khác', titleEn: 'Another' }) })]);
    await click($('[data-art="a11"]'));
    await edit();
    const warned = () => { const e = new window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(warned()).toBe(false);
    await type(field('b0'), 'Đã sửa.');
    expect(warned()).toBe(true);
    /* Someone else approves it: it leaves Waiting, but the editor and what was typed stay on the screen. */
    await goLive([{ ...a, status: 'approved', updatedAt: a.updatedAt + 5 }]);
    expect(field('b0')?.value).toBe('Đã sửa.');
    expect($('.ed-bar .callout')?.textContent).toMatch(/no longer waiting for review/);
  });
});

describe('after the decision', () => {
  const approved = () => art(14, { status: 'approved', history: [...serverArticle(0).history, { at: Date.now(), by: 'Dana Owner', action: 'approved', note: '' }] });
  const decided = async (arts: ServerArticle[]) => { await open(arts); await click($('[role="tab"]:nth-child(2)')); };

  it('sends an approved article back to review after saying what that does to the site', async () => {
    const a = approved();
    await decided([a]);
    const calls = server(() => json({ article: { ...a, status: 'review', updatedAt: a.updatedAt + 9, history: [...a.history, { at: a.updatedAt + 9, by: 'Dana Owner', action: 'unapproved', note: '' }] } }));
    await click(button('Send back to review', '.after'));
    expect($('dialog[open] h2')?.textContent).toBe('Send this article back to review?');
    expect($('dialog[open]')?.textContent).toContain('The next website build of its site leaves it out');
    expect($('dialog[open]')?.textContent).toContain('A build that is already live is not changed');
    expect(calls).toEqual([]);
    await click(button('Send back to review', 'dialog[open]'));
    await settle();
    expect(calls).toEqual([['POST', '/api/articles/14/unapprove', {}]]);
    /* The list follows the article to Waiting, where it can be edited. */
    expect(st().rtab).toBe('open');
    expect($('.rvd .tags .pill')?.textContent).toBe('Waiting for review');
    expect(button('Edit', '.rvhead')).not.toBeNull();
    expect(text()).toContain('Dana Owner sent it back to review');
    expect(st().snackMsg?.msg).toBe('Sent back to review: How to brew phin coffee');
  });

  it('archives a decided article: the lists hide it until Show archived is on', async () => {
    const a = approved(), b = art(15, { status: 'rejected', content: articleContent({ title: 'Cà phê muối', titleEn: 'Salt coffee' }) });
    await decided([a, b]);
    expect($('.rv-arch')).toBeNull();
    const calls = server((_m, url) => json({ article: url.endsWith('/archive')
      ? { ...b, archivedAt: 5, updatedAt: b.updatedAt + 9, history: [...b.history, { at: b.updatedAt + 9, by: 'Dana Owner', action: 'archived', note: '' }] }
      : { ...b, archivedAt: null, updatedAt: b.updatedAt + 19 } }));
    await click($('[data-art="a15"]'));
    expect(text()).toContain('Archiving hides it from this list. Nothing is deleted.');
    await click(button('Archive', '.after'));
    await settle();
    expect(calls).toEqual([['POST', '/api/articles/15/archive', {}]]);
    expect($$('[data-art]').map(x => x.getAttribute('data-art'))).toEqual(['a14']);
    expect($('[role="tab"]:nth-child(2)')?.textContent).toBe('Decided (1)');
    expect($('.rv-arch')?.textContent).toBe('Show archived (1)');

    await click($('.rv-arch input'));
    expect($$('[data-art]').map(x => x.getAttribute('data-art'))).toEqual(['a15', 'a14']);
    expect($('[data-art="a15"]')?.textContent).toContain('Archived');
    await click($('[data-art="a15"]'));
    expect(text()).toContain('Dana Owner archived it');
    await click(button('Take out of the archive', '.after'));
    await settle();
    expect(calls.at(-1)).toEqual(['POST', '/api/articles/15/unarchive', {}]);
    expect($('[data-art="a15"]')?.textContent).not.toContain('Archived');
    /* An approved article is told what archiving does not do. */
    await click($('[data-art="a14"]'));
    expect(text()).toContain('It stays approved and stays part of the website.');
  });

  it('offers neither to a native reviewer or a viewer', async () => {
    await decided([approved()]);
    expect($('.after')).not.toBeNull();
    for (const role of ['reviewer', 'viewer'] as const) { await signIn(role); expect($('.after'), role).toBeNull(); }
  });
});

describe('Approve selected', () => {
  const ok = (a: ServerArticle): ServerArticle => ({ ...a, checks: a.checks.map(c => ({ ...c, kind: 'ok' as const })), languageReview: { by: 'Linh', at: 1 } });
  const named = (id: number, en: string, over: Partial<ServerArticle> = {}) => art(id, { keyword: 'k' + id, content: articleContent({ title: 'T' + id, titleEn: en }), ...over });

  it('approves what can be approved and says for each one that was skipped why', async () => {
    const ready = ok(named(21, 'Ready')), refused = ok(named(22, 'Refused by the server'));
    const noReview = named(23, 'No review'), failed = ok(named(24, 'Failed check'));
    failed.checks = failed.checks.map(c => c.name === 'Sources cited' ? { ...c, kind: 'bad' as const } : c);
    await open([ready, refused, noReview, failed, named(25, 'Being written', { status: 'work', content: null })]);
    /* Only what waits for a decision has a tick box. */
    expect($$('.rv-pick input[type="checkbox"]').map(x => x.getAttribute('aria-label'))).toEqual(['Select: Failed check', 'Select: No review', 'Select: Refused by the server', 'Select: Ready']);
    await click($('.rv-all input'));
    expect(button('Approve selected (4)')).not.toBeNull();
    const calls = server((_m, url) => url.includes('/22/')
      ? json({ error: 'This article needs a language review by a native speaker before it can be approved.' }, 409)
      : json({ article: { ...ready, status: 'approved', updatedAt: ready.updatedAt + 9 } }));
    await click(button('Approve selected (4)'));
    await settle();
    /* The two that cannot pass are not even sent. */
    expect(calls.map(c => c[1]).sort()).toEqual(['/api/articles/21/approve', '/api/articles/22/approve']);
    expect($('.rv-res .callout')?.textContent).toContain('Approved 1 of 4. 3 articles were skipped and still wait for review:');
    expect($$('.rv-res li').map(x => x.textContent)).toEqual([
      'SkippedFailed check: An automated check failed. Fix it by editing the article or request a revision.',
      'SkippedNo review: Needs its language review by a native speaker first.',
      'SkippedRefused by the server: This article needs a language review by a native speaker before it can be approved.',
    ]);
    expect(st().snackMsg?.msg).toBe('Approved 1 article');
    expect(st().articles.find(x => x.id === 'a21')?.status).toBe('approved');
    expect($$('.rv-pick input:checked')).toEqual([]);
    await click(button('Dismiss', '.rv-res'));
    expect($('.rv-res')).toBeNull();
  });

  it('is not offered to a native reviewer', async () => {
    await open([art(21, { siteId: site }), art(22, { siteId: site, keyword: 'k' })]);
    expect($$('.rv-pick')).toHaveLength(2);
    await signIn('reviewer');
    expect($$('.rv-pick')).toEqual([]);
    expect($('.rv-all')).toBeNull();
  });
});

describe('Write selected in a research result', () => {
  const kws = ['cà phê phin', 'phin filter', 'cold brew', 'cà phê trứng'];
  const req = (): ServerRequest => ({
    id: 3, siteId: site, domain: 'kopi.example', country: 'Vietnam', lang: 'Vietnamese', topic: 'phin', goal: 'Find a new topic cluster', status: 'done', engine: 'openai-api', step: '',
    summary: 'Four ideas.', notes: '', error: '', tokens: 900, costUsd: 0.01, createdAt: Date.UTC(2026, 9, 2, 7), startedAt: 1000, finishedAt: 5000,
    keywords: kws.map(keyword => ({ keyword, meaning: keyword, intent: 'Informational', cluster: 'Brewing', basis: 'Seed' })),
  });
  const openResult = async (arts: ServerArticle[] = []) => {
    await change(() => st().setRctab('keywords'));
    await goLive(arts, [req()]);
    await mount(<Research />);
    await click($$('button').find(b => b.textContent === 'View result') ?? null);
  };
  const tick = (k: string) => click($(`dialog[open] input[aria-label="Select: ${k}"]`));
  const queued = (id: number, keyword: string) => art(id, { keyword, status: 'queued', content: null, checks: [] });

  it('sends the ticked keywords in one call and closes when every article started', async () => {
    await openResult([art(11)]);
    /* The keyword that already has an article waiting cannot be ticked. */
    expect($('dialog[open] input[aria-label="Already on its way: cà phê phin"]')?.hasAttribute('disabled')).toBe(true);
    expect((button('Write selected (0)', 'dialog[open]') as HTMLButtonElement).disabled).toBe(true);
    await tick('phin filter'); await tick('cold brew');
    expect($('.kw-bulk .note')?.textContent).toBe('2 of 3 ticked. Each one is a separate job for the Content Writer.');
    await click(button('Write selected (2)', 'dialog[open]'));
    const sheet = () => $$('dialog[open]').find(d => d.querySelector('#waT'));
    expect(sheet()?.querySelector('h2')?.textContent).toBe('Write 2 articles');
    expect([...(sheet()?.querySelectorAll('.tag') ?? [])].map(t => t.textContent)).toContain('keycold brew');
    expect(sheet()?.querySelector('p.note')?.textContent).toBe('Each article takes several minutes and uses your OpenAI API quota: 2 articles are 2 jobs.');

    const calls = server((_m, _u, body) => json({ results: (body.keywords as string[]).map((keyword, i) => ({ keyword, ok: true, article: queued(31 + i, keyword) })), created: 2 }, 201));
    await click(button('Send 2 to Content Writer', 'dialog[open]'));
    await settle();
    expect(calls).toEqual([['POST', '/api/articles/bulk', { requestId: 3, keywords: ['phin filter', 'cold brew'], model: 'GPT-6.1 Sol' }]]);
    expect(sheet()).toBeUndefined();
    expect(st().snackMsg?.msg).toBe('2 articles sent to the Content Writer.');
    expect(st().articles.filter(x => x.status === 'writing').map(x => x.kw).sort()).toEqual(['cold brew', 'phin filter']);
    /* Their rows now say so, and the ticks are gone. */
    expect($$('dialog[open] tbody tr').filter(tr => tr.textContent?.includes('Article on its way'))).toHaveLength(3);
    expect($$('dialog[open] tbody input:checked')).toEqual([]);
  });

  it('lists what happened to each keyword when some could not be started', async () => {
    await openResult();
    await tick('cà phê phin'); await tick('phin filter'); await tick('cold brew');
    await click(button('Write selected (3)', 'dialog[open]'));
    server((_m, _u, body) => json({ results: (body.keywords as string[]).map((keyword, i) => i === 1
      ? { keyword, ok: false, status: 429, error: '20 jobs are already waiting for this site. Let the agents finish some of them, then try again.' }
      : { keyword, ok: true, article: queued(41 + i, keyword) }), created: 2 }, 201));
    await click(button('Send 3 to Content Writer', 'dialog[open]'));
    await settle();
    const sheet = $$('dialog[open]').find(d => d.querySelector('#waT'));
    expect(sheet?.querySelector('h2')?.textContent).toBe('Sent 2 of 3 to the Content Writer');
    expect([...(sheet?.querySelectorAll('.kw-res li') ?? [])].map(x => x.textContent)).toEqual([
      'Sentcà phê phin', 'Not sentphin filter: 20 jobs are already waiting for this site. Let the agents finish some of them, then try again.', 'Sentcold brew',
    ]);
    expect(st().snackMsg?.msg).toBe('2 articles sent to the Content Writer.');
  });

  it('shows the server\'s refusal of the whole request and offers no tick boxes to a viewer', async () => {
    await openResult();
    await tick('cà phê phin'); await tick('phin filter');
    await click(button('Write selected (2)', 'dialog[open]'));
    server(() => json({ error: 'kopi.example has used its daily budget of $25.00. It resets at midnight, or raise the budget in Settings.' }, 409));
    await click(button('Send 2 to Content Writer', 'dialog[open]'));
    await settle();
    expect($('#waMsg')?.textContent).toMatch(/has used its daily budget/);
    await signIn('viewer');
    expect($$('dialog[open] tbody input[type="checkbox"]')).toEqual([]);
    expect($('.kw-bulk')).toBeNull();
  });
});

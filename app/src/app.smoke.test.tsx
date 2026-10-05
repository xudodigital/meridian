// @vitest-environment jsdom
/* Smoke test: the app mounts, signs in through both steps against a fake server, renders the shell in demo mode,
   navigates, enforces roles and survives simulation ticks. It runs in jsdom, so it checks structure and behaviour,
   not layout. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeApi, answer } from './store/fakeApi';
import { makeState, meFor } from '@/store/testing';

/* The store reads demo mode when it is first imported (by the imports above): switch it on before that. */
vi.hoisted(() => { localStorage.setItem('das-demo', '1'); });

const PASSWORD = 'correct horse battery staple';
const api = new FakeApi()
  .on('GET', '/api/auth/status', () => ({ setup: false, me: null }))
  .on('POST', '/api/auth/sign-in', c => {
    const b = c.body as { email: string; password: string };
    return b.email === 'admin@example.com' && b.password === PASSWORD ? { twofa: true, ticket: 'ticket-1' } : answer(401, { error: 'Email or password is incorrect.' });
  })
  .on('POST', '/api/auth/sign-in/code', c => (c.body as { code: string }).code === '123456'
    ? { me: meFor('admin', 'Dana Lee', 'admin@example.com', { twofa: true }) }
    : answer(401, { error: 'That code is not correct. Enter the current 6-digit code from your authenticator app, or a recovery code.' }))
  .on('PATCH', '/api/auth/me', c => ({ me: meFor('admin', (c.body as { name: string }).name, 'admin@example.com', { twofa: true }) }))
  .on('POST', '/api/auth/sign-out', () => ({ ok: true }))
  .on('POST', '/api/auth/touch', () => ({ ok: true }))
  .on('GET', '/api/state', () => ({ engine: { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.0', ready: true, reason: '' }, requests: [], articles: [] }));

/* jsdom has no matchMedia and only part of <dialog>. */
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.scrollTo = () => {};
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

let root: Root;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const settle = async (ms = 30) => {
  const { router } = await import('./router');
  const end = Date.now() + 10_000;
  do {
    await act(async () => { await new Promise(r => setTimeout(r, ms)); });
    if (!router.state.isLoading && !router.state.matches.some(m => m.status === 'pending')) return;
  } while (Date.now() < end);
  throw new Error('Lazy route did not finish loading');
};
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const submit = async (form: Element | null) => { await act(async () => { form!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); };

describe('app', () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="root"></div>';
    /* These checks follow the prototype, so the app starts in demo mode, the way a person switches it on. */
    const { useStore } = await import('./store/store');
    useStore.setState({...makeState(null), auth:'loading'});
    localStorage.setItem('das-session', JSON.stringify({ email: 'old@example.com', role: 'admin', name: 'Old', v: 2 }));
    vi.stubGlobal('fetch', api.fetch);
    const { App } = await import('./App');
    root = createRoot(document.getElementById('root')!);
    await act(async () => { root.render(<App />); });
    await settle();
  });
  afterAll(async () => { await act(async () => { root.unmount(); }); });

  it('asks the server who is signed in, and shows the sign-in screen', () => {
    expect(api.to('GET', '/api/auth/status')).toHaveLength(1);
    expect($('.login h1')!.textContent).toBe('Sign in');
    expect($('#lgNote')!.hidden).toBe(true);
    expect($('#lgStep2')!.hidden).toBe(true);
    expect($('.app')).toBeNull();
    /* No role picker, no Google button, nothing simulated: the server decides who you are. */
    expect($('.dd')).toBeNull();
    expect(document.body.textContent).not.toMatch(/simulat|prototype|any email|any 6 digits|Google/i);
    /* What earlier versions kept in the browser is gone. */
    expect(localStorage.getItem('das-session')).toBeNull();
  });

  it('signs in through the two steps, with the password and the code checked by the server', async () => {
    await submit($('form.lform'));
    expect($('#lgMsg')!.textContent).toBe('Enter your email and password.');
    await type($<HTMLInputElement>('#lgEmail')!, 'admin@example.com');
    await type($<HTMLInputElement>('#lgPass')!, 'wrong password!');
    await submit($('form.lform'));
    await settle();
    expect($('#lgMsg')!.textContent).toBe('Email or password is incorrect.');
    expect($('#lgStep2')!.hidden).toBe(true);
    await type($<HTMLInputElement>('#lgPass')!, PASSWORD);
    await submit($('form.lform'));
    await settle();
    const [call] = api.to('POST', '/api/auth/sign-in').slice(-1);
    expect(call?.body).toEqual({ email: 'admin@example.com', password: PASSWORD });
    expect(call?.headers['x-meridian']).toBe('1');
    expect($('#lgStep1')!.hidden).toBe(true);
    expect($('#lgStep2')!.hidden).toBe(false);
    expect($('#lgBtn')!.textContent).toBe('Verify and sign in');
    await submit($('form.lform'));
    expect($('#lgMsg')!.textContent).toBe('Enter the 6-digit code from your authenticator app, or a recovery code.');
    await type($<HTMLInputElement>('#lgCode')!, '000000');
    await submit($('form.lform'));
    await settle();
    expect($('#lgMsg')!.textContent).toMatch(/^That code is not correct/);
    await type($<HTMLInputElement>('#lgCode')!, '123456');
    await submit($('form.lform'));
    await settle();
    expect(api.to('POST', '/api/auth/sign-in/code').at(-1)?.body).toEqual({ ticket: 'ticket-1', code: '123456' });
    expect($('.login')).toBeNull();
    expect($('#title')!.textContent).toBe('Workspace');
    expect(document.title).toBe('Workspace · Meridian');
    /* Nothing about the session is kept in the page's storage: it is an HttpOnly cookie. */
    expect(Object.keys(localStorage).sort()).toEqual([]);
  });

  it('never offers the retired demo mode', () => {
    expect($('#demoBanner')).toBeNull();
  });

  it('renders the shell as the prototype does', () => {
    expect($('.brand div span')!.textContent).toBe('120 sites · 11 agents');
    expect([...document.querySelectorAll('.navgroup h2')].map(h => h.textContent)).toEqual(['Work', 'Sites', 'Insights', 'System']);
    expect(document.querySelectorAll('.navgroup button')).toHaveLength(11);
    expect($('.navgroup button[aria-current="page"]')!.textContent).toContain('Workspace');
    expect($('.navgroup .count')!.textContent).toBe('4');
    expect($('#bellBtn')!.getAttribute('aria-label')).toBe('Notifications, 4 unread');
    expect($('#bellN')!.textContent).toBe('4');
    expect($('#meBtn')!.textContent).toBe('DL');
    expect($('.sitepick .dd')!.getAttribute('aria-label')).toBe('Site: All sites');
  });

  it('navigates, and resolves an old alias to its view and tab', async () => {
    const { go } = await import('./nav');
    await click([...document.querySelectorAll('.navgroup button')].find(b => b.textContent!.includes('Sites'))!);
    await settle();
    expect($('#title')!.textContent).toBe('Sites');
    expect(location.pathname).toBe('/sites');
    await act(async () => { go('keywords'); });
    await settle();
    expect(location.pathname).toBe('/research');
    expect($('.tabs [aria-selected="true"]')!.textContent).toBe('Keywords');
    expect($('.lede')!.textContent).toMatch(/^The Keyword agent clusters keywords per country/);
  });

  it('opens notifications, search and the site picker', async () => {
    await click($('#bellBtn'));
    expect($('dialog#pop')!.hasAttribute('open')).toBe(true);
    expect(document.querySelectorAll('dialog#pop .nt')).toHaveLength(5);
    await click([...document.querySelectorAll('dialog#pop button')].find(b => b.textContent === 'Mark all read')!);
    expect($('#bellN')!.hidden).toBe(true);
    await click($('dialog#pop .ib'));
    expect($('dialog#pop')!.hasAttribute('open')).toBe(false);

    await click($('.top [data-act="search"]'));
    expect(document.querySelectorAll('#results .nt')).toHaveLength(6);
    await type($<HTMLInputElement>('#q')!, 'domain-c');
    expect([...document.querySelectorAll('#results .nt b')].map(b => b.textContent)).toEqual(['domain-c.example']);
    await submit($('dialog#search form'));
    await settle();
    expect(location.pathname).toBe('/sites');

    await click($('.sitepick .dd'));
    expect($('.ddp input.ddq')!.getAttribute('placeholder')).toBe('Search 100+ sites by name or country');
    expect(document.querySelectorAll('.ddp .ddo')).toHaveLength(60);
    expect($('.ddp .ddhint')!.textContent).toBe('Showing 60 of 121. Type to narrow the list.');
    await click(document.querySelectorAll('.ddp .ddo')[2]!);
    expect($('.ddp')).toBeNull();
    expect($('.sitepick .dd')!.getAttribute('aria-label')).toBe('Site: domain-b.example (Bangladesh)');
  });

  it('runs the confirm flow and writes the audit log and snackbar', async () => {
    const { useStore } = await import('./store/store');
    await act(async () => { useStore.getState().openConfirm('site:c'); });
    expect($('#dlgT')!.textContent).toBe('Remove this domain?');
    expect($('#dlgOk')!.textContent).toBe('Remove');
    await click($('#dlgOk'));
    const s = useStore.getState();
    expect(s.sites.some(x => x.id === 'c')).toBe(false);
    expect(s.articles.some(a => a.s === 'c')).toBe(false);
    expect(s.log[0]).toMatchObject({ actor: 'Dana Lee', act: 'Removed the domain domain-c.example' });
    expect($('#snack')!.textContent).toBe('check_circleRemoved the domain domain-c.example');
    expect($('dialog#dlg')!.hasAttribute('open')).toBe(false);
  });

  it('keeps running through simulation ticks and records hand-offs', async () => {
    const { useStore } = await import('./store/store');
    await act(async () => { useStore.setState(d => { d.agents.find(a => a.id === 'res')!.progress = 99.9; }); useStore.getState().tick(); });
    const s = useStore.getState();
    expect(s.handoff.seq).toBe(1);
    expect(s.handoff.pairs).toEqual([{ from: 'res', to: 'kw' }]);
    await act(async () => { for (let i = 0; i < 50; i++) useStore.getState().tick(); });
    expect(useStore.getState().agents).toHaveLength(11);
  });

  it('shows the name in the account menu and changes it on the server', async () => {
    const { useStore } = await import('./store/store');
    await click($('#meBtn'));
    expect($('dialog#pop .acct h3')!.textContent).toBe('Dana Lee');
    expect($('dialog#pop .acct p')!.textContent).toBe('admin@example.com');
    expect([...document.querySelectorAll('dialog#pop .nt b')].map(b => b.textContent)).toEqual(['Team and roles', 'Settings', 'Change name', 'Change password', '2-step verification', 'Switch to dark theme', 'Sign out']);
    expect([...document.querySelectorAll('dialog#pop .nt')].find(b => b.textContent!.includes('2-step'))!.textContent).toContain('On: a code from your phone at sign-in');
    await click([...document.querySelectorAll('dialog#pop .nt')].find(b => b.textContent!.includes('Change name'))!);
    expect($('dialog#pop')!.hasAttribute('open')).toBe(false);
    const input = $<HTMLInputElement>('#meName')!;
    expect(input.value).toBe('Dana Lee');
    await type(input, '   ');
    await submit(input.closest('form'));
    expect($('dialog[open] .err')!.textContent).toBe('Enter your name, for example Dewi Lestari.');
    await type(input, 'Dana Lee-Putri');
    await submit(input.closest('form'));
    await settle();
    expect(api.to('PATCH', '/api/auth/me').at(-1)?.body).toEqual({ name: 'Dana Lee-Putri' });
    expect($('#meName')).toBeNull();
    expect(useStore.getState().session?.name).toBe('Dana Lee-Putri');
    expect(useStore.getState().snackMsg?.msg).toBe('Your name is now Dana Lee-Putri.');
    expect($('#meBtn')!.textContent).toBe('DL');
  });

  it('limits a viewer to reading and a reviewer to Article review', async () => {
    const { useStore } = await import('./store/store');
    const { go } = await import('./nav');
    await act(async () => { useStore.getState().signOut(); });
    await settle();
    expect($('.login')).not.toBeNull();
    expect(api.to('POST', '/api/auth/sign-out')).toHaveLength(1);
    expect(location.pathname).toBe('/workspace');

    await act(async () => { useStore.getState().signIn(meFor('viewer', 'Viewer', 'viewer@example.com')); });
    await settle();
    await act(async () => { useStore.getState().openConfirm('all:pause'); });
    expect(useStore.getState().confirm).toBeNull();
    expect($('#snack')!.textContent).toBe('lockView-only role. Ask an admin to make changes.');

    await act(async () => { useStore.getState().signIn(meFor('reviewer', 'Reviewer.vn', 'reviewer.vn@example.com')); });
    await settle();
    expect(location.pathname).toBe('/review');
    expect([...document.querySelectorAll('.navgroup h2')].map(h => h.textContent)).toEqual(['Your work']);
    expect($('.sitepick .dd')!.getAttribute('aria-label')).toBe('Site: domain-a.example (Vietnam)');
    await act(async () => { go('settings'); });
    await settle();
    expect(location.pathname).toBe('/review');
    expect($('#snack')!.textContent).toBe('lockYour role cannot open Settings.');
  });
});

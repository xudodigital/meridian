// @vitest-environment jsdom
/* Accounts through the whole app against a fake server (store/fakeApi.ts), outside demo mode: the first-run owner
   account, sign-in with and without 2-step verification, the required 2-step setup, an invitation link, the account
   menu (password, 2-step), Settings > Your sessions, the demo mode banner, and an ended session. Each test loads a
   fresh copy of the app, as a page load would. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, answer, emptyWorkspace } from './store/fakeApi';
import type { Me } from './store/types';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.scrollTo = () => {};
  window.Element.prototype.scrollIntoView = () => {};
  window.HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

/* The first import transforms the whole app, which takes seconds: do it once here, so each test's page load is quick
   and stays within the test's time limit when every test file runs at once. */
beforeAll(async () => { await import('./App'); }, 60_000);

const PASSWORD = 'correct horse battery staple';
const me = (over: Partial<Me> = {}): Me => ({ id: '1', name: 'Dana Owner', email: 'owner@example.com', role: 'admin', site: null, created: 1, disabled: false, twofa: false, mustEnroll: false, ...over });
const ENGINE = { mode: 'openai-api', keyConfigured: true, apiVersion: '2.1.0', ready: true, reason: '' };

let root: Root | null = null;
let api: FakeApi;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const text = () => document.body.textContent ?? '';
const byText = (sel: string, t: string) => $$(sel).find(e => e.textContent === t) ?? null;
const settle = async (ms = 20) => {
  const { router } = await import('./router');
  const end = Date.now() + 10_000;
  do {
    await act(async () => { await new Promise(r => setTimeout(r, ms)); });
    if (!router.state.isLoading && !router.state.matches.some(m => m.status === 'pending')) return;
  } while (Date.now() < end);
  throw new Error('Lazy route did not finish loading');
};
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await settle(); };
const type = async (sel: string, value: string) => {
  const el = $<HTMLInputElement>(sel);
  expect(el, sel).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const submit = async (form: Element | null) => { expect(form).not.toBeNull(); await act(async () => { form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); await settle(); };
async function until(what: string, ok: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('Timed out waiting for ' + what + '. Page: ' + text().slice(0, 300)); await settle(10); }
}

/** A signed-in server with an empty workspace; tests add or change routes. */
function server(status: { setup: boolean; me: Me | null }) {
  return new FakeApi()
    .on('GET', '/api/auth/status', () => status)
    .on('GET', '/api/workspace', () => emptyWorkspace())
    .on('GET', '/api/state', () => ({ engine: ENGINE, requests: [], articles: [] }))
    .on('POST', '/api/auth/touch', () => ({ ok: true }))
    .on('POST', '/api/auth/sign-out', () => ({ ok: true }));
}
/** A fresh page load at `path`. */
async function load(path = '/'): Promise<typeof import('./store/store')> {
  vi.resetModules();
  history.replaceState(null, '', path);
  vi.stubGlobal('fetch', api.fetch);
  const { App } = await import('./App');
  const store = await import('./store/store');
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(<App />); });
  await settle();
  return store;
}

beforeEach(() => { localStorage.clear(); });
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  vi.unstubAllGlobals();
});

describe('first run', () => {
  it('asks for the owner account, creates it on the server, then loads the workspace', async () => {
    api = server({ setup: true, me: null }).on('POST', '/api/auth/setup', c => ({ me: me({ name: (c.body as { name: string }).name }) }));
    await load();
    expect($('.lform h1')?.textContent).toBe('Create the owner account');
    expect($('#lgNote')?.textContent).toContain('This first account is the owner, with full access.');
    await type('#lgNameIn', 'Dana Owner');
    await type('#lgEmail', 'owner@example.com');
    await type('#lgPass', 'too short');
    await type('#lgConfirm', 'too short');
    await submit($('form.lform'));
    expect($('#lgMsg')?.textContent).toBe('Use a password of at least 12 characters.');
    await type('#lgPass', PASSWORD);
    await type('#lgConfirm', PASSWORD + '!');
    await submit($('form.lform'));
    expect($('#lgMsg')?.textContent).toBe('The two passwords are not the same.');
    expect(api.to('POST', '/api/auth/setup')).toEqual([]);
    await type('#lgConfirm', PASSWORD);
    await submit($('form.lform'));
    expect(api.to('POST', '/api/auth/setup')[0]?.body).toEqual({ name: 'Dana Owner', email: 'owner@example.com', password: PASSWORD, confirm: PASSWORD });
    await until('the workspace', () => $('#title')?.textContent === 'Workspace');
    expect(api.to('GET', '/api/workspace')).toHaveLength(1);
    expect($('#meBtn')?.textContent).toBe('DO');
    expect($('#demoBanner')).toBeNull();
    expect(text()).not.toMatch(/simulat|prototype/i);
  });
});

describe('sign-in', () => {
  it('signs in without 2-step verification and shows the server\'s refusal as it is', async () => {
    api = server({ setup: false, me: null }).on('POST', '/api/auth/sign-in', c => (c.body as { password: string }).password === PASSWORD
      ? { me: me() } : answer(401, { error: 'Email or password is incorrect.' }));
    await load('/sites');
    expect($('.lform h1')?.textContent).toBe('Sign in');
    await type('#lgEmail', 'owner@example.com');
    await type('#lgPass', 'not it at all');
    await submit($('form.lform'));
    expect($('#lgMsg')?.textContent).toBe('Email or password is incorrect.');
    await type('#lgPass', PASSWORD);
    await submit($('form.lform'));
    /* Lands on the view asked for before sign-in. */
    await until('Sites', () => $('#title')?.textContent === 'Sites');
    expect(location.pathname).toBe('/sites');
  });

  it('stays signed in on reload while the server says so, and asks for the code when 2-step is on', async () => {
    api = server({ setup: false, me: me() });
    await load();
    await until('the workspace', () => $('#title')?.textContent === 'Workspace');
    if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }

    api = server({ setup: false, me: null })
      .on('POST', '/api/auth/sign-in', () => ({ twofa: true, ticket: 'tk' }))
      .on('POST', '/api/auth/sign-in/code', c => (c.body as { code: string }).code === 'abcd-efgh-jk' ? { me: me({ twofa: true }) } : answer(401, { error: 'That code is not correct.' }));
    await load();
    await type('#lgEmail', 'owner@example.com');
    await type('#lgPass', PASSWORD);
    await submit($('form.lform'));
    expect($('#lgStep2')?.hidden).toBe(false);
    expect(text()).toContain('or one of your recovery codes');
    /* A recovery code works in place of the 6-digit code. */
    await type('#lgCode', 'abcd-efgh-jk');
    await submit($('form.lform'));
    await until('the workspace', () => $('#title')?.textContent === 'Workspace');
    expect(api.to('POST', '/api/auth/sign-in/code')[0]?.body).toEqual({ ticket: 'tk', code: 'abcd-efgh-jk' });
  });

  it('returns to sign-in with a note when the server says the session ended', async () => {
    api = server({ setup: false, me: me() }).on('GET', '/api/workspace', () => answer(401, { error: 'Sign in first.' }));
    const { useStore } = await load();
    await until('the sign-in screen', () => $('.lform h1')?.textContent === 'Sign in');
    /* The sign-in screen explains the sign-out instead of repeating the bare note (Login.tsx signedOutNote). */
    expect($('#lgNote')?.textContent).toBe('scheduleYou were signed out because your session ended, usually after a while without activity. Your work is saved. Sign in to continue.');
    expect(useStore.getState().loginNote).toBe('Your session ended. Sign in again.');
    expect(useStore.getState().session).toBeNull();
  });

  it('says how to start the server when it does not answer', async () => {
    api = new FakeApi();
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    vi.resetModules();
    history.replaceState(null, '', '/');
    const { App } = await import('./App');
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => { root?.render(<App />); });
    await settle();
    expect($('.lform h1')?.textContent).toBe('The server is not running');
    expect(text()).toContain('./start.sh');
  });
});

describe('2-step verification', () => {
  it('must be set up right after sign-in when Settings require it, with a QR code and recovery codes', async () => {
    api = server({ setup: false, me: me({ mustEnroll: true }) })
      .on('POST', '/api/auth/2fa/setup', () => ({ secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Meridian%3Aowner%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Meridian' }))
      .on('POST', '/api/auth/2fa/enable', c => (c.body as { code: string }).code === '123456'
        ? { me: me({ twofa: true }), recoveryCodes: Array.from({ length: 10 }, (_, i) => `code-${i}abc-de`) }
        : answer(400, { error: 'That code is not correct. Enter the 6-digit code your authenticator app shows now.' }));
    await load();
    await until('the setup', () => !!$('svg.qr'));
    expect($('.lform h1')?.textContent).toBe('Set up 2-step verification');
    expect($('#lgNote')?.textContent).toBe('Dana Owner, this workspace requires a 2-step verification code at sign-in. Set it up now to continue.');
    expect($('svg.qr')?.getAttribute('aria-label')).toBe('QR code for your authenticator app');
    expect($('svg.qr path')?.getAttribute('d')?.length).toBeGreaterThan(100);
    expect($('#tsKey')?.textContent).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    /* Nothing of the workspace loads before it is set up. */
    expect(api.to('GET', '/api/workspace')).toEqual([]);
    await type('#tsCode', '111111');
    await submit($('form.twostep'));
    expect($('.twostep .err')?.textContent).toBe('That code is not correct. Enter the 6-digit code your authenticator app shows now.');
    await type('#tsCode', '123 456');
    await submit($('form.twostep'));
    expect(api.to('POST', '/api/auth/2fa/enable').at(-1)?.body).toEqual({ code: '123456' });
    expect($$('.recovery li')).toHaveLength(10);
    expect(text()).toContain('They are not shown again.');
    await click(byText('button', 'I saved them'));
    await until('the workspace', () => $('#title')?.textContent === 'Workspace');
  });
});

describe('an invitation link', () => {
  it('shows who is invited, sets name and password, and signs the person in', async () => {
    const token = 'A'.repeat(43);
    api = server({ setup: false, me: null })
      .on('GET', '/api/invites/' + token, () => ({ invite: { email: 'linh@example.com', role: 'reviewer', site: 's1', domain: 'kopi.example', expires: Date.now() + 864e5 } }))
      .on('POST', `/api/invites/${token}/accept`, c => ({ me: me({ id: '5', name: (c.body as { name: string }).name, email: 'linh@example.com', role: 'reviewer', site: 's1' }) }));
    await load('/invite/' + token);
    await until('the invitation', () => text().includes('You are invited as'));
    expect($('.lform h1')?.textContent).toBe('Join Meridian');
    expect($('#lgNote')?.textContent).toBe('You are invited as Native reviewer for kopi.example with linh@example.com. Choose your name and a password to sign in.');
    await type('#ivName', 'Linh Tran');
    await type('#ivPass', PASSWORD);
    await type('#ivConfirm', PASSWORD);
    await submit($('form.lform'));
    expect(api.to('POST', `/api/invites/${token}/accept`)[0]?.body).toEqual({ name: 'Linh Tran', password: PASSWORD, confirm: PASSWORD });
    /* A native reviewer lands on Article review. */
    await until('Article review', () => $('#title')?.textContent === 'Article review');
    expect(location.pathname).toBe('/review');
  });

  it('says plainly when the link does not work', async () => {
    api = server({ setup: false, me: null }).on('GET', /^\/api\/invites\//, () => answer(404, { error: 'This invitation link does not work. It may have been used, revoked or have expired. Ask an admin for a new one.' }));
    await load('/invite/' + 'B'.repeat(43));
    await until('the message', () => $('.lform h1')?.textContent === 'This invitation does not work');
    expect($('#lgNote')?.textContent).toContain('Ask an admin for a new one.');
  });
});

describe('a forgotten password', () => {
  const ASKED = 'If that email belongs to an account, a link to set a new password is on its way. It works for 30 minutes.';
  const signedOut = (resetByEmail: boolean) => server({ setup: false, me: null }).on('GET', '/api/auth/status', () => ({ setup: false, me: null, resetByEmail }));

  it('says to ask an admin while the server cannot send email', async () => {
    api = signedOut(false);
    await load();
    expect($('.lform h1')?.textContent).toBe('Sign in');
    expect($('#lgForgot')).toBeNull();
    expect($('#lgForgotNote')?.textContent).toBe('Forgot your password? Ask an admin: they make a one-time reset link for you in Team and roles.');
  });

  it('emails a link when the server can, and shows the same answer whoever the email belongs to', async () => {
    api = signedOut(true).on('POST', '/api/auth/reset/request', () => ({ ok: true, message: ASKED }));
    await load();
    expect($('#lgForgotNote')).toBeNull();
    await type('#lgEmail', 'owner@example.com');
    await click($('#lgForgot'));
    expect($('.lform h1')?.textContent).toBe('Forgot your password?');
    /* The email typed on the sign-in form is carried over. */
    expect($<HTMLInputElement>('#lgEmail')?.value).toBe('owner@example.com');
    await type('#lgEmail', 'not an email');
    await submit($('form.lform'));
    expect($('#lgMsg')?.textContent).toBe('Enter a valid email address.');
    expect(api.to('POST', '/api/auth/reset/request')).toHaveLength(0);
    await type('#lgEmail', ' Owner@Example.com ');
    await submit($('form.lform'));
    expect(api.to('POST', '/api/auth/reset/request')[0]?.body).toEqual({ email: 'Owner@Example.com' });
    expect(api.to('POST', '/api/auth/reset/request')[0]?.headers['x-meridian']).toBe('1');
    expect($('.lform h1')?.textContent).toBe('Check your email');
    expect($('#lgNote')?.textContent).toBe('mail' + ASKED);
    await click($('#lgBtn'));
    expect($('.lform h1')?.textContent).toBe('Sign in');
  });

  it('shows the server\'s refusal on the form and lets the person go back', async () => {
    api = signedOut(true).on('POST', '/api/auth/reset/request', () => answer(400, { error: 'Enter your email address.' }));
    await load();
    await click($('#lgForgot'));
    await type('#lgEmail', 'someone@example.com');
    await submit($('form.lform'));
    expect($('#lgMsg')?.textContent).toBe('Enter your email address.');
    await click($('#lgBack'));
    expect($('.lform h1')?.textContent).toBe('Sign in');
  });
});

describe('a password reset link', () => {
  const token = 'R'.repeat(43);
  const NEW = 'a brand new passphrase 42';
  const NOTE = 'Your password was changed and every session was signed out. Sign in with the new password.';
  const withLink = (status: { setup: boolean; me: Me | null }) => server(status)
    .on('GET', '/api/auth/reset/' + token, () => ({ reset: { email: 'owner@example.com', expires: Date.now() + 30 * 60_000 } }))
    .on('POST', '/api/auth/reset/' + token, () => ({ ok: true, email: 'owner@example.com' }));

  it('sets a new password without signing in, then leads to the sign-in screen', async () => {
    api = withLink({ setup: false, me: null });
    const { useStore } = await load('/reset/' + token);
    await until('the link to be checked', () => text().includes('Choose a new password for'));
    expect($('.lform h1')?.textContent).toBe('Set a new password');
    expect($('#lgNote')?.textContent).toBe('Choose a new password for owner@example.com. Every signed-in session of this account is signed out when you save it.');
    await type('#rsPass', 'short');
    await type('#rsConfirm', 'short');
    await submit($('form.lform'));
    expect($('#lgMsg')?.textContent).toBe('Use a password of at least 12 characters.');
    await type('#rsPass', NEW);
    await type('#rsConfirm', NEW + 'x');
    await submit($('form.lform'));
    expect($('#lgMsg')?.textContent).toBe('The two passwords are not the same.');
    expect(api.to('POST', '/api/auth/reset/' + token)).toHaveLength(0);
    await type('#rsConfirm', NEW);
    await submit($('form.lform'));
    expect(api.to('POST', '/api/auth/reset/' + token)[0]?.body).toEqual({ password: NEW, confirm: NEW });
    expect($('.lform h1')?.textContent).toBe('Password changed');
    expect(text()).toContain('If 2-step verification is on for your account, you still enter its code.');
    expect(useStore.getState().session).toBeNull();
    await click($('#lgBtn'));
    await until('the sign-in screen', () => $('.lform h1')?.textContent === 'Sign in');
    expect($('#lgNote')?.textContent).toBe('schedule' + NOTE);
    expect(location.pathname).not.toContain('/reset/');
  });

  it('says plainly when the link was used or has expired, and shows a refusal from the server', async () => {
    api = server({ setup: false, me: null }).on('GET', /^\/api\/auth\/reset\//, () => answer(404, { error: 'This link does not work. It may have been used already or have expired. Ask for a new one on the sign-in screen, or ask an admin.' }));
    await load('/reset/' + 'B'.repeat(43));
    await until('the message', () => $('.lform h1')?.textContent === 'This link does not work');
    expect($('#lgNote')?.textContent).toContain('It may have been used already or have expired.');
    await click($('#lgBtn'));
    await until('the sign-in screen', () => $('.lform h1')?.textContent === 'Sign in');
    if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }

    /* Used by someone else between opening the page and saving. */
    api = withLink({ setup: false, me: null }).on('POST', '/api/auth/reset/' + token, () => answer(404, { error: 'This link does not work.' }));
    await load('/reset/' + token);
    await until('the form', () => text().includes('Choose a new password for'));
    await type('#rsPass', NEW);
    await type('#rsConfirm', NEW);
    await submit($('form.lform'));
    expect($('#lgMsg')?.textContent).toBe('This link does not work.');
    expect($('.lform h1')?.textContent).toBe('Set a new password');
  });

  it('signs this browser out with the reason when the person was signed in here', async () => {
    api = withLink({ setup: false, me: me() });
    const { useStore } = await load('/reset/' + token);
    await until('the form', () => text().includes('Choose a new password for'));
    expect(useStore.getState().session?.email).toBe('owner@example.com');
    await type('#rsPass', NEW);
    await type('#rsConfirm', NEW);
    await submit($('form.lform'));
    await until('the sign-in screen', () => $('.lform h1')?.textContent === 'Sign in');
    expect(useStore.getState().session).toBeNull();
    expect($('#lgNote')?.textContent).toBe('schedule' + NOTE);
    /* The server already ended the sessions: the page does not ask it to sign out again. */
    expect(api.to('POST', '/api/auth/sign-out')).toHaveLength(0);
  });
});

describe('the account menu and Settings', () => {
  it('changes the password and turns on 2-step verification', async () => {
    api = server({ setup: false, me: me() })
      .on('POST', '/api/auth/password', c => (c.body as { current: string }).current === PASSWORD ? { ok: true, endedSessions: 2 } : answer(400, { error: 'Your current password is not correct.' }))
      .on('POST', '/api/auth/2fa/setup', () => ({ secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' }))
      .on('POST', '/api/auth/2fa/enable', () => ({ me: me({ twofa: true }), recoveryCodes: ['aaaa-bbbb-cc'] }));
    const { useStore } = await load();
    await until('the workspace', () => $('#title')?.textContent === 'Workspace');
    await click($('#meBtn'));
    expect($('dialog#pop .acct .pill')?.textContent).toBe('Admin');
    await click([...$$('dialog#pop .nt')].find(b => b.textContent?.includes('Change password')) ?? null);
    await type('#pwCurrent', 'wrong one');
    await type('#pwNext', 'a brand new password');
    await type('#pwConfirm', 'a brand new password');
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('Your current password is not correct.');
    await type('#pwCurrent', PASSWORD);
    await submit($('dialog[open] form'));
    expect(api.to('POST', '/api/auth/password').at(-1)?.body).toEqual({ current: PASSWORD, next: 'a brand new password', confirm: 'a brand new password' });
    expect($('dialog[open]')).toBeNull();
    expect(useStore.getState().snackMsg?.msg).toBe('Password changed. 2 other sessions were signed out.');

    await click($('#meBtn'));
    await click([...$$('dialog#pop .nt')].find(b => b.textContent?.includes('2-step verification')) ?? null);
    await until('the QR code', () => !!$('dialog[open] svg.qr'));
    await type('#tsCode', '654321');
    await submit($('dialog[open] form.twostep'));
    expect($$('dialog[open] .recovery li').map(li => li.textContent)).toEqual(['aaaa-bbbb-cc']);
    await click(byText('dialog[open] button', 'I saved them'));
    expect(useStore.getState().session?.twofa).toBe(true);
    expect(useStore.getState().snackMsg?.msg).toBe('2-step verification is on.');
  });

  it('lists the person\'s own sessions in Settings and signs out the others', async () => {
    const now = Date.now();
    let sessions = [
      { id: '9', device: 'Chrome on macOS', created: now - 1000, lastSeen: now, current: true },
      { id: '4', device: 'Safari on iPhone', created: now - 864e5, lastSeen: now - 3 * 3600_000, current: false },
    ];
    api = server({ setup: false, me: me() })
      .on('GET', '/api/auth/sessions', () => ({ sessions }))
      .on('POST', '/api/auth/sessions/sign-out-others', () => { sessions = sessions.filter(x => x.current); return { ended: 1 }; });
    await load('/settings');
    await until('Settings', () => $('#title')?.textContent === 'Settings');
    await until('the sessions', () => text().includes('Safari on iPhone'));
    const rows = $$('section table').at(-1)?.querySelectorAll('tbody tr') ?? [];
    expect([...rows].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))).toEqual([
      ['Chrome on macOS', 'Now', 'This browser'], ['Safari on iPhone', expect.stringMatching(/^3 h ago · /), 'Sign out'],
    ]);
    expect(text()).toContain('Require a 2-step verification code at sign-in');
    expect(text()).not.toMatch(/Google|simulat/i);
    await click(byText('button', 'logoutSign out other sessions'));
    expect(api.to('POST', '/api/auth/sessions/sign-out-others')).toHaveLength(1);
    expect(text()).not.toContain('Safari on iPhone');
  });

  it('cannot restore demo mode after signing in', async () => {
    api = server({ setup: false, me: me() });
    const { useStore } = await load();
    await until('the workspace', () => $('#title')?.textContent === 'Workspace');
    await act(async () => { useStore.getState().setSampleData(true); });
    expect(useStore.getState().sample).toBe(false);
    expect($('#demoBanner')).toBeNull();
    expect($('.brand div span')?.textContent).toBe('0 sites · 11 agents');
  });
});

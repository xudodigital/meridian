// @vitest-environment jsdom
/* Accounts, audit and alerts outside demo mode, against a fake server (fakeApi): the Audit log's filters, pages and
   CSV export; Team and roles' password reset link and the admin's view of everyone's sessions; and the server's alerts
   loaded for the bell. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditApi, auditQuery } from '@/store/auditApi';
import { FakeApi, answer } from '@/store/fakeApi';
import { refreshAlerts } from '@/store/liveAlerts';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { LogEntry, Role } from '@/store/types';
import { Audit, FILTER_DELAY_MS, auditMatch, dayEdge } from '../Audit';
import { Team } from '../Team';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

let root: Root | null = null;
let api: FakeApi;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const st = () => useStore.getState();
const text = () => document.body.textContent ?? '';
const settle = (ms = 20) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await settle(); };
const type = async (sel: string, value: string) => {
  const el = $<HTMLInputElement>(sel);
  expect(el, sel).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const mount = async (node: ReactNode) => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(node); });
  await settle();
};
const button = (scope: Element | Document, label: string) => [...scope.querySelectorAll('button')].find(b => b.textContent === label);
const rowsText = () => $$('tbody tr').map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));

const T = Date.UTC(2026, 9, 3, 10, 0, 0);
const entry = (id: number, actor: string, act: string, site: string | null = null, over: Partial<LogEntry> = {}): LogEntry => ({ id, t: new Date(T + id * 60_000), actor, act, site, ...over });
const wire = (id: number, actor: string, act: string, site: string | null = null) => ({ id, t: T + id * 60_000, actor, act, site });
/** A signed-in person outside demo mode, with the workspace loaded and these audit entries in the store. */
function signedIn(role: Role, log: LogEntry[] = []): void {
  resetStore(false);
  st().signIn(meFor(role, 'Dana Admin', 'owner@example.com', { id: '1' }));
  useStore.setState(d => { d.log = log; });
}
const auditCalls = () => api.calls.filter(c => c.method === 'GET' && c.path.startsWith('/api/audit')).map(c => c.path);

beforeEach(() => {
  localStorage.clear();
  api = new FakeApi();
  vi.stubGlobal('fetch', api.fetch);
  vi.spyOn(console, 'error');
});
afterEach(async () => {
  if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the Audit log outside demo mode', () => {
  const LOG = [entry(3, 'Dana Admin', 'Approved the article "Kopi tubruk"', 's1'), entry(2, 'Keyword agent', 'Finished keyword research: kopi'), entry(1, 'Eli Editor', 'Exported the report', null, { note: true })];

  it('shows what the store has without asking the server, with the export for admins and editors', async () => {
    signedIn('admin', LOG);
    await mount(<Audit />);
    expect(rowsText().map(r => r[1])).toEqual(['Dana Admin', 'Keyword agent', 'Eli Editor']);
    expect($('#auCount')?.textContent).toBe('3 entries.');
    expect($('#auMore')).toBeNull();
    expect($('#auClear')).toBeNull();
    expect(auditCalls()).toEqual([]);
    expect($<HTMLAnchorElement>('#auExport')?.getAttribute('href')).toBe('/api/audit.csv');
    expect(text()).toContain('· from the dashboard');
  });

  it('hides the export from a viewer', async () => {
    signedIn('viewer', LOG);
    await mount(<Audit />);
    expect(rowsText()).toHaveLength(3);
    expect($('#auExport')).toBeNull();
  });

  it('asks the server for a filter, a moment after typing, and joins its answer with what it has', async () => {
    signedIn('admin', LOG);
    api.on('GET', /^\/api\/audit\?/, c => c.path.includes('before=')
      ? { audit: [wire(-40, 'Dana Admin', 'Approved website v1 of kopi.example', 's1')], more: false }
      : { audit: [wire(3, 'Dana Admin', 'Approved the article "Kopi tubruk"', 's1'), wire(-5, 'Old Admin', 'Approved a build long ago')], more: true });
    await mount(<Audit />);
    await type('#auQ', 'appr');
    await type('#auQ', 'approved');
    /* What the store has is filtered at once; the server is asked once, after the last keystroke. */
    expect(rowsText().map(r => r[2])).toEqual(['Approved the article "Kopi tubruk"']);
    await settle(FILTER_DELAY_MS + 60);
    expect(auditCalls()).toEqual(['/api/audit?q=approved&limit=100']);
    expect(rowsText().map(r => [r[1], r[2]])).toEqual([['Dana Admin', 'Approved the article "Kopi tubruk"'], ['Old Admin', 'Approved a build long ago']]);
    expect($('#auCount')?.textContent).toBe('Showing the newest 2 entries.');
    expect($<HTMLAnchorElement>('#auExport')?.getAttribute('href')).toBe('/api/audit.csv?q=approved');

    await click($('#auMore'));
    expect(auditCalls().at(-1)).toBe('/api/audit?q=approved&before=-5&limit=100');
    expect(rowsText()).toHaveLength(3);
    expect($('#auMore')).toBeNull();
    expect($('#auCount')?.textContent).toBe('3 entries match.');

    /* A new entry that matches arrives live and joins the list; one that does not stays out. */
    await act(async () => { useStore.setState(d => { d.log.unshift(entry(9, 'Eli Editor', 'Approved website v2 of kopi.example', 's1'), entry(8, 'Eli Editor', 'Signed in on Chrome on macOS')); }); });
    expect(rowsText().map(r => r[1])).toEqual(['Eli Editor', 'Dana Admin', 'Old Admin', 'Dana Admin']);

    await click($('#auClear'));
    expect($<HTMLInputElement>('#auQ')?.value).toBe('');
    expect(rowsText()).toHaveLength(5);
  });

  it('sends the actor and whole local days', async () => {
    signedIn('admin', LOG);
    api.on('GET', /^\/api\/audit\?/, () => ({ audit: [], more: false }));
    await mount(<Audit />);
    await type('#auActor', ' dana ');
    await type('#auFrom', '2026-10-01');
    await type('#auTo', '2026-10-03');
    await settle(FILTER_DELAY_MS + 60);
    const from = new Date(2026, 9, 1).getTime(), to = new Date(2026, 9, 4).getTime() - 1;
    expect(auditCalls().at(-1)).toBe(`/api/audit?actor=dana&from=${from}&to=${to}&limit=100`);
    expect($<HTMLAnchorElement>('#auExport')?.getAttribute('href')).toBe(`/api/audit.csv?actor=dana&from=${from}&to=${to}`);
    expect(rowsText().map(r => r[1])).toEqual(['Dana Admin']);
  });

  it('loads older entries below a full store, and says when the server cannot be reached', async () => {
    const full = Array.from({ length: 200 }, (_, i) => entry(1000 - i, 'Keyword agent', 'Finished job ' + (1000 - i)));
    signedIn('editor', full);
    let fail = true;
    api.on('GET', /^\/api\/audit\?/, () => fail ? answer(500, { error: 'Something went wrong on the server. Try again.' }) : { audit: [wire(800, 'Keyword agent', 'Finished job 800')], more: false });
    await mount(<Audit />);
    expect(rowsText()).toHaveLength(200);
    expect($('#auCount')?.textContent).toBe('Showing the newest 200 entries.');
    await click($('#auMore'));
    expect(auditCalls()).toEqual(['/api/audit?before=801&limit=100']);
    expect($('#auErr')?.textContent).toBe('The audit log could not be loaded: Something went wrong on the server. Try again.');
    fail = false;
    await click($('#auMore'));
    expect($('#auErr')).toBeNull();
    expect(rowsText()).toHaveLength(201);
    expect($('#auMore')).toBeNull();
  });

  it('says so when a filter finds nothing, with a way back', async () => {
    signedIn('admin', LOG);
    api.on('GET', /^\/api\/audit\?/, () => ({ audit: [], more: false }));
    await mount(<Audit />);
    await type('#auQ', 'zzz');
    await settle(FILTER_DELAY_MS + 60);
    expect($('.empty h3')?.textContent).toBe('No entries match');
    await click(button($('.empty')!, 'Clear filters'));
    expect(rowsText()).toHaveLength(3);
  });
});

describe('the Audit log in demo mode', () => {
  it('filters in the browser and never asks the server', async () => {
    resetStore(true);
    st().signIn(meFor('admin'));
    await mount(<Audit />);
    const all = st().log.length;
    expect(rowsText()).toHaveLength(all);
    expect($('#auExport')).toBeNull();
    const actor = st().log[0]!.actor;
    await type('#auActor', actor.toUpperCase());
    await settle(FILTER_DELAY_MS + 60);
    expect(rowsText()).toHaveLength(st().log.filter(l => l.actor === actor).length);
    expect(rowsText().every(r => r[1] === actor)).toBe(true);
    expect(api.calls).toEqual([]);
  });
});

describe('audit filter helpers', () => {
  it('turn a date into the edges of that local day', () => {
    expect(dayEdge('2026-10-03', false)).toBe(new Date(2026, 9, 3).getTime());
    expect(dayEdge('2026-10-03', true)).toBe(new Date(2026, 9, 4).getTime() - 1);
    expect(dayEdge('', false)).toBeUndefined();
    expect(dayEdge('2026-10', true)).toBeUndefined();
  });
  it('build the query the server reads, leaving out what is not set', () => {
    expect(auditQuery({})).toBe('');
    expect(auditQuery({ actor: ' ', q: '' })).toBe('');
    expect(auditQuery({ site: 's1', q: 'a b&c' }, { before: 5, limit: 100 })).toBe('?site=s1&q=a+b%26c&before=5&limit=100');
    expect(auditApi.csvUrl({ actor: 'Dana', from: 1, to: 2 })).toBe('/api/audit.csv?actor=Dana&from=1&to=2');
  });
  it('match like the server: text anywhere in any case, one site, a time span', () => {
    const e = entry(1, 'Dana Admin', 'Approved the article', 's1');
    expect(auditMatch(e, {})).toBe(true);
    expect(auditMatch(e, { actor: 'dana', q: 'ARTICLE', site: 's1', from: e.t.getTime(), to: e.t.getTime() })).toBe(true);
    expect(auditMatch(e, { actor: 'eli' })).toBe(false);
    expect(auditMatch(e, { site: 's2' })).toBe(false);
    expect(auditMatch(e, { from: e.t.getTime() + 1 })).toBe(false);
    expect(auditMatch(e, { to: e.t.getTime() - 1 })).toBe(false);
  });
});

describe('Team and roles outside demo mode', () => {
  const USERS = [
    { id: '1', name: 'Dana Admin', email: 'owner@example.com', role: 'admin', site: null, created: 1, disabled: false, twofa: true },
    { id: '2', name: 'Eli Editor', email: 'editor@example.com', role: 'editor', site: null, created: 2, disabled: false, twofa: false },
    { id: '3', name: 'Vic Viewer', email: 'viewer@example.com', role: 'viewer', site: null, created: 3, disabled: true, twofa: false },
  ];
  let sessions = [
    { id: '10', userId: '1', device: 'Chrome on macOS', created: 1, lastSeen: Date.now(), current: true },
    { id: '11', userId: '2', device: 'Firefox on Windows', created: 1, lastSeen: Date.now() - 60_000, current: false },
    { id: '12', userId: '2', device: 'Safari on iPhone', created: 1, lastSeen: Date.now() - 120_000, current: false },
    { id: '13', userId: '1', device: 'Safari on iPad', created: 1, lastSeen: Date.now() - 180_000, current: false },
  ];
  const all = sessions;
  beforeEach(() => {
    sessions = all;
    signedIn('admin');
    api.on('GET', '/api/users', () => ({ users: USERS, invites: [] }))
      .on('GET', '/api/sessions', () => ({ sessions }))
      .on('DELETE', /^\/api\/sessions\/(\d+)$/, (_c, m) => { sessions = sessions.filter(x => x.id !== m[1]); return { ok: true }; })
      .on('POST', /^\/api\/users\/(\d+)\/sign-out$/, (_c, m) => { const n = sessions.filter(x => x.userId === m[1] && !x.current).length; sessions = sessions.filter(x => x.userId !== m[1] || x.current); return { ended: n }; })
      .on('POST', '/api/users/2/reset-link', () => ({ link: 'http://localhost:4310/reset/' + 'T'.repeat(43), expires: Date.now() + 30 * 60_000, minutes: 30 }));
  });
  const section = () => $('#teamSessions')!;
  const sessionRows = () => [...section().querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));

  it('makes a one-time password reset link for another person and shows it once', async () => {
    await mount(<Team />);
    const people = $$('section')[0]!;
    const rowOf = (email: string) => [...people.querySelectorAll('tbody tr')].find(tr => tr.textContent?.includes(email))!;
    /* Not for yourself (the account menu changes your own password) and not for a disabled account. */
    expect(button(rowOf('owner@example.com'), 'Reset password')).toBeUndefined();
    expect(button(rowOf('viewer@example.com'), 'Reset password')).toBeUndefined();
    await click(button(rowOf('editor@example.com'), 'Reset password'));
    expect(api.to('POST', '/api/users/2/reset-link')).toHaveLength(1);
    const sheet = $('dialog[open]')!;
    expect(sheet.querySelector('h2')?.textContent).toBe('Password reset link for Eli Editor');
    expect(sheet.querySelector<HTMLInputElement>('#rlLink')?.value).toBe('http://localhost:4310/reset/' + 'T'.repeat(43));
    expect(sheet.textContent).toContain('give it to editor@example.com');
    expect(sheet.textContent).toContain('It works once, for 30 minutes, and is shown only now.');
    expect(sheet.textContent).toContain('Their 2-step verification stays on.');
    await click(button(sheet, 'Done'));
    expect($('dialog[open]')).toBeNull();
    expect(text()).not.toContain('T'.repeat(43));
  });

  it('shows the server\'s refusal when a link cannot be made', async () => {
    api.on('POST', '/api/users/2/reset-link', () => answer(409, { error: 'Eli Editor is disabled. Enable the account first.' }));
    await mount(<Team />);
    await click(button($$('section')[0]!, 'Reset password'));
    expect($('dialog[open]')).toBeNull();
    expect(st().snackMsg?.msg).toBe('Eli Editor is disabled. Enable the account first.');
  });

  it('lists everyone\'s sessions by person and signs one out', async () => {
    await mount(<Team />);
    expect($$('section > h2, section > .sh > h2').map(h => h.textContent)).toEqual(['People', 'Signed-in sessions', 'Roles']);
    expect(sessionRows().map(r => [r[0], r[1], r[3]])).toEqual([
      ['Dana Admin', 'Chrome on macOS This browser', 'Sign out my other sessions'],
      ['Dana Admin', 'Safari on iPad', 'Sign out'],
      ['Eli Editor', 'Firefox on Windows', 'Sign outSign out everywhere'],
      ['Eli Editor', 'Safari on iPhone', 'Sign out'],
    ]);
    const firefox = [...section().querySelectorAll('tbody tr')][2]!;
    await click(button(firefox, 'Sign out'));
    expect(api.calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/api/sessions/11']);
    expect(st().snackMsg?.msg).toBe('Signed out Eli Editor on Firefox on Windows');
    /* With one session left, "Sign out" is all there is to do for that person. */
    expect(sessionRows().map(r => [r[0], r[1], r[3]]).slice(2)).toEqual([['Eli Editor', 'Safari on iPhone', 'Sign out']]);
  });

  it('signs a person out everywhere, and the admin out of their other browsers only', async () => {
    await mount(<Team />);
    await click(button(section(), 'Sign out everywhere'));
    expect(api.to('POST', '/api/users/2/sign-out')).toHaveLength(1);
    expect(st().snackMsg?.msg).toBe('Signed out Eli Editor everywhere (2 sessions)');
    expect(sessionRows().map(r => r[1])).toEqual(['Chrome on macOS This browser', 'Safari on iPad']);
    await click(button(section(), 'Sign out my other sessions'));
    expect(api.to('POST', '/api/users/1/sign-out')).toHaveLength(1);
    expect(st().snackMsg?.msg).toBe('Signed out your other session');
    expect(sessionRows().map(r => [r[1], r[3]])).toEqual([['Chrome on macOS This browser', '']]);
    expect(st().session).not.toBeNull();
  });

  it('says so when the sessions cannot be loaded, and has no sessions section in demo mode', async () => {
    api.on('GET', '/api/sessions', () => answer(403, { error: 'Only an admin can do this.' }));
    await mount(<Team />);
    expect(section().textContent).toContain('The sessions could not be loaded: Only an admin can do this.');
    if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; }
    resetStore(true);
    st().signIn(meFor('admin'));
    await mount(<Team />);
    expect($('#teamSessions')).toBeNull();
    expect(text()).not.toContain('Reset password');
  });
});

describe('the server\'s alerts for the bell', () => {
  const ALERTS = [
    { id: 2, key: 'budget:s1:today', event: 'budget', site: 's1', title: 'kopi.example passed 80% of its daily budget', body: 'Agents spent $20.00 of $25.00 today.', link: '/analytics', at: Date.now() - 1000 },
    { id: 1, key: 'access:s1:7', event: 'blocked', site: 's1', title: 'kopi.example is blocked in Indonesia', body: 'Blocked.', link: '/deploy', at: Date.now() - 2000 },
  ];
  beforeEach(() => { api.on('GET', '/api/notifications', () => ({ alerts: ALERTS })); });

  it('are loaded into the bell for a signed-in person, and counted as unread', async () => {
    signedIn('viewer');
    await act(async () => { await refreshAlerts(); });
    expect(st().live.alerts).toHaveLength(2);
    expect(st().notifs.map(n => [n.title, n.view, n.read, n.key])).toEqual([
      ['kopi.example passed 80% of its daily budget', 'analytics', false, 'alert:budget:s1:today'],
      ['kopi.example is blocked in Indonesia', 'deploy', false, 'alert:access:s1:7'],
    ]);
    /* Opening one marks it read by its key, which the server keeps for this person. */
    const id = st().notifs[1]!.id;
    await act(async () => { st().openNotification(id); });
    expect(st().notifRead).toEqual(['alert:access:s1:7']);
    await act(async () => { await refreshAlerts(); });
    expect(st().notifs.map(n => n.read)).toEqual([false, true]);
  });

  it('are loaded when the workspace is, and never for a native reviewer or in demo mode', async () => {
    signedIn('admin');
    useStore.setState(d => { d.sync.loaded = false; });
    await act(async () => { useStore.setState(d => { d.sync.loaded = true; }); });
    await settle();
    expect(api.to('GET', '/api/notifications')).toHaveLength(1);
    expect(st().notifs).toHaveLength(2);

    signedIn('reviewer');
    await act(async () => { await refreshAlerts(); });
    resetStore(true);
    st().signIn(meFor('admin'));
    await act(async () => { await refreshAlerts(); });
    expect(api.to('GET', '/api/notifications')).toHaveLength(1);
    expect(st().live.alerts).toBeUndefined();
  });

  it('leave the bell as it is when the server does not answer', async () => {
    signedIn('admin');
    api.on('GET', '/api/notifications', () => answer(500, { error: 'Something went wrong on the server. Try again.' }));
    await act(async () => { await refreshAlerts(); });
    expect(st().notifs).toEqual([]);
  });
});

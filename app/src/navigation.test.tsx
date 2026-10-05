// @vitest-environment jsdom
/* The navigation after the merge from 18 views to 11: the side navigation, the old URLs (each redirects to its view
   with the right tab), the tabs' role rule (a native reviewer never reaches the Audit log), search, the setup
   checklist and notifications. The app is mounted whole, in demo mode, with a fake server. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeApi } from './store/fakeApi';
import { ALIAS, ALIAS_IDS, NAV, TITLES, VIEW_IDS, isViewId } from './store/constants';
import { alertNotifs } from './store/liveNotifs';
import { activityTabs, canSee, canSeeTab, setupSteps, unalias } from './store/rules';
import { makeEmptyState, makeState, meFor, sessionFor } from './store/testing';
import type { AliasId, BellAlertWire, Role, ViewId } from './store/types';

vi.hoisted(() => { localStorage.setItem('das-demo', '1'); });

const api = new FakeApi()
  .on('GET', '/api/auth/status', () => ({ setup: false, me: null }))
  .on('POST', '/api/auth/sign-out', () => ({ ok: true }))
  .on('POST', '/api/auth/touch', () => ({ ok: true }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.scrollTo = () => {};
  window.Element.prototype.scrollIntoView = () => {};
  /* The Internal links tab draws on a canvas, which jsdom does not have. */
  window.HTMLCanvasElement.prototype.getContext = (() => null) as typeof window.HTMLCanvasElement.prototype.getContext;
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

let root: Root;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { el!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
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
const store = async () => (await import('./store/store')).useStore;
/** Opens a URL the way a typed address or an old bookmark does. */
const open = async (path: string) => {
  const { router } = await import('./router');
  await act(async () => { router.history.push(path); });
  await settle();
};
const signIn = async (role: Role) => {
  const useStore = await store();
  await act(async () => { useStore.getState().signIn(meFor(role)); });
  await settle();
};
const selectedTab = () => $('.tabs [aria-selected="true"]')?.textContent ?? null;

/** The eight screens that became tabs: old id -> view, the tab's label, the store field and its value. */
const MERGED: readonly (readonly [AliasId, ViewId, string, 'dtab' | 'actab' | 'rctab' | 'atab', string])[] = [
  ['workflows', 'deploy', 'Workflows', 'dtab', 'workflows'],
  ['history', 'activity', 'Runs', 'actab', 'runs'],
  ['audit', 'activity', 'Audit log', 'actab', 'audit'],
  ['architecture', 'research', 'Architecture', 'rctab', 'architecture'],
  ['links', 'research', 'Internal links', 'rctab', 'links'],
  ['experiments', 'research', 'Experiments', 'rctab', 'experiments'],
  ['rank', 'analytics', 'Rank', 'atab', 'rank'],
  ['reports', 'analytics', 'Reports', 'atab', 'reports'],
];

describe('the navigation table', () => {
  it('has 11 views in four groups', () => {
    expect(NAV.map(g => [g[0], g[1].map(v => v[1])])).toEqual([
      ['Work', ['Workspace', 'Article review']],
      ['Sites', ['Sites', 'Build and deploy']],
      ['Insights', ['Research and SEO', 'Analytics', 'Activity']],
      ['System', ['Models and skills', 'Team and roles', 'Integrations', 'Settings']],
    ]);
    expect(VIEW_IDS).toEqual(['workspace', 'review', 'sites', 'deploy', 'research', 'analytics', 'activity', 'skills', 'team', 'integrations', 'settings']);
    expect(VIEW_IDS).toHaveLength(11);
    expect(Object.keys(TITLES)).toHaveLength(11);
  });

  it('keeps every merged screen as an alias of a view and tab, not as a view', () => {
    for (const [id, view, , key, tab] of MERGED) {
      expect(isViewId(id)).toBe(false);
      expect(unalias(id)).toMatchObject({ view, alias: { key, tab } });
    }
    /* Every alias leads to a view that exists. */
    expect(ALIAS_IDS.filter(a => !isViewId(ALIAS[a].view))).toEqual([]);
  });

  it('keeps the role rules: Team, Integrations and Settings for admins, nothing but Article review for a reviewer', () => {
    expect(VIEW_IDS.filter(v => !canSee(sessionFor('editor'), v))).toEqual(['team', 'integrations', 'settings']);
    expect(VIEW_IDS.filter(v => canSee(sessionFor('reviewer'), v))).toEqual(['review']);
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      expect(activityTabs(sessionFor(role))).toEqual(['runs', 'audit']);
      expect(canSeeTab(sessionFor(role), 'audit')).toBe(true);
    }
    expect(activityTabs(sessionFor('reviewer'))).toEqual([]);
    expect(canSeeTab(sessionFor('reviewer'), 'audit')).toBe(false);
    expect(canSeeTab(sessionFor('reviewer'), 'content')).toBe(true);
    expect(canSeeTab(null, 'audit')).toBe(false);
  });
});

describe('the app after the merge', () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="root"></div>';
    (await store()).setState({...makeState(null),auth:'loading'});
    vi.stubGlobal('fetch', api.fetch);
    const { App } = await import('./App');
    root = createRoot(document.getElementById('root')!);
    await act(async () => { root.render(<App />); });
    await settle();
    await signIn('admin');
  });
  afterAll(async () => { await act(async () => { root.unmount(); }); vi.unstubAllGlobals(); });

  it('shows 11 entries in the side navigation', () => {
    expect($$('.navgroup h2').map(h => h.textContent)).toEqual(['Work', 'Sites', 'Insights', 'System']);
    expect($$('.navgroup button')).toHaveLength(11);
  });

  it.each(MERGED)('redirects /%s to /%s with the %s tab selected', async (id, view, label, key, tab) => {
    await open('/workspace');
    await open('/' + id);
    expect(location.pathname).toBe('/' + view);
    expect(selectedTab()).toBe(label);
    expect((await store()).getState()[key]).toBe(tab);
    expect($('#title')!.textContent).toBe(TITLES[view]);
    expect(document.title).toBe(TITLES[view] + ' · Meridian');
    expect($('.navgroup button[aria-current="page"]')!.textContent).toContain(TITLES[view]);
  });

  it('keeps a legacy hash such as /#rank or /#audit working', async () => {
    await open('/workspace');
    await open('/#audit');
    expect(location.pathname).toBe('/activity');
    expect(location.hash).toBe('');
    expect(selectedTab()).toBe('Audit log');
    await open('/#rank');
    expect(location.pathname).toBe('/analytics');
    expect(selectedTab()).toBe('Rank');
  });

  it('shows each merged page as tabs under one title, and remembers the tab', async () => {
    await open('/activity');
    expect($$('.tabs [role="tab"]').map(t => t.textContent)).toEqual(['Runs', 'Audit log']);
    expect(selectedTab()).toBe('Audit log');
    await click($$('.tabs [role="tab"]')[0]);
    expect(selectedTab()).toBe('Runs');
    expect($('.lede')!.textContent).toBe('Every job an agent has run, with its cost, duration and step-by-step log.');
    await open('/deploy');
    expect($$('.tabs [role="tab"]').map(t => t.textContent)).toEqual(['Website', 'Workflows']);
    await click($$('.tabs [role="tab"]')[0]);
    expect($$('main h2').map(h => h.textContent)).toContain('Domain access by country');
    await open('/website');
    expect(location.pathname).toBe('/deploy');
    expect(selectedTab()).toBe('Website');
    await open('/activity');
    expect(selectedTab()).toBe('Runs');
    expect($$('#title')).toHaveLength(1);
  });

  it.each([
    ['Rank', '/analytics', 'Rank'], ['Audit log', '/activity', 'Audit log'], ['Run history', '/activity', 'Runs'], ['Reports', '/analytics', 'Reports'],
    ['Workflows', '/deploy', 'Workflows'], ['Site architecture', '/research', 'Architecture'], ['Internal links', '/research', 'Internal links'], ['Experiments', '/research', 'Experiments'],
  ])('search finds "%s" and opens %s on the right tab', async (q, path, label) => {
    await open('/workspace');
    await click($('.top [data-act="search"]'));
    await type($<HTMLInputElement>('#q')!, q);
    expect($('#results .nt b')!.textContent).toContain(q);
    await submit($('dialog#search form'));
    await settle();
    expect(location.pathname).toBe(path);
    expect(selectedTab()).toBe(label);
  });

  it('opens the right place from the setup checklist', async () => {
    const steps = setupSteps({ ...makeEmptyState('admin'), session: sessionFor('admin') });
    const targets = steps.map(x => x.to);
    expect(targets).toEqual(['integrations', 'sites', 'sites', 'keywords', 'review', 'website', 'integrations', 'integrations', 'integrations', 'account']);
    /* Every link is a view or a tab the navigation still has. */
    for (const to of targets) if (to && to !== 'account') expect(unalias(to)).not.toBeNull();
    const { go } = await import('./nav');
    await act(async () => { go('keywords'); });
    await settle();
    expect(location.pathname).toBe('/research');
    expect(selectedTab()).toBe('Keywords');
  });

  it('opens the right place from a notification', async () => {
    const useStore = await store();
    /* The demo's notifications lead to views that exist. */
    expect(useStore.getState().notifs.filter(n => !isViewId(n.view))).toEqual([]);
    /* The server links its alerts by path; "/reports" is now a tab of Analytics. */
    const alert = (event: string, link: string): BellAlertWire => ({ id: 1, key: event + ':1', event, site: null, title: 'T', body: 'B', link, at: Date.now() });
    expect(alertNotifs(alert('report', '/reports'))[0]).toMatchObject({ view: 'analytics', to: 'reports' });
    expect(alertNotifs(alert('blocked', '/deploy'))[0]).toMatchObject({ view: 'deploy' });
    expect(alertNotifs(alert('budget', '/analytics'))[0]).toMatchObject({ view: 'analytics' });

    await open('/workflows');
    await act(async () => {
      useStore.setState(d => {
        d.atab = 'rank';
        d.notifs = [
          { id: 901, t: new Date(), k: 'ok', icon: 'mail', title: 'The weekly report was sent', body: '', view: 'analytics', to: 'reports', read: false, key: 'alert:report:1' },
          { id: 902, t: new Date(), k: 'bad', icon: 'block', title: 'kopi.example is blocked', body: '', view: 'deploy', read: false, key: 'alert:access:1' },
          { id: 903, t: new Date(), k: 'warn', icon: 'payments', title: 'Budget at 80%', body: '', view: 'analytics', read: false, key: 'alert:budget:1' },
        ];
      });
    });
    const openNotif = async (title: string) => {
      await click($('#bellBtn'));
      await click($$('dialog#pop .nt').find(b => b.textContent!.includes(title)));
      await settle();
    };
    /* A blocked domain: Build and deploy, on the Website tab even though Workflows was open last. */
    await openNotif('kopi.example is blocked');
    expect(location.pathname).toBe('/deploy');
    expect(selectedTab()).toBe('Website');
    await openNotif('The weekly report was sent');
    expect(location.pathname).toBe('/analytics');
    expect(selectedTab()).toBe('Reports');
    await open('/workspace');
    await openNotif('Budget at 80%');
    expect(location.pathname).toBe('/analytics');
    expect(selectedTab()).toBe('Overview');
  });

  it('never lets a native reviewer reach the Audit log, or any other merged screen', async () => {
    const useStore = await store();
    const { go } = await import('./nav');
    await act(async () => { useStore.getState().signOut(); });
    await settle();
    await signIn('reviewer');
    expect(location.pathname).toBe('/review');
    for (const path of ['/audit', '/activity', '/history', '/#audit', '/rank']) {
      await open(path);
      expect(location.pathname).toBe('/review');
      expect($('#title')!.textContent).toBe('Article review');
      expect($('#auExport')).toBeNull();
    }
    await act(async () => { go('audit'); });
    await settle();
    expect(location.pathname).toBe('/review');
    expect($('#snack')!.textContent).toBe('lockYour role cannot open Activity.');
    expect($$('.navgroup button').map(b => b.textContent)).toEqual([expect.stringContaining('Article review')]);
    /* Search offers a reviewer articles only. */
    await click($('.top [data-act="search"]'));
    await type($<HTMLInputElement>('#q')!, 'Audit');
    expect($$('#results .nt')).toHaveLength(0);
  });
});

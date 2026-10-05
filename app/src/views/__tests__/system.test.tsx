// @vitest-environment jsdom
/* Smoke tests for the system screens: Analytics, Models and skills, Team and roles, Integrations, Audit log, Settings.
   Each view renders with the seeded store and its key interactions change the store as the prototype does. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppStore } from '@/store/store';
import { sessionFor } from '@/store/testing';
import type { Role } from '@/store/types';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

type Store = typeof import('@/store/store').useStore;
let useStore: Store;
let initial: AppStore;
let root: Root;

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const st = () => useStore.getState();
const byText = (sel: string, text: string): HTMLElement => {
  const el = $$(sel).find(b => b.textContent === text || b.textContent?.endsWith(text));
  if (!el) throw new Error(`No ${sel} with text "${text}"`);
  return el;
};
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const submit = async (form: Element | null) => { await act(async () => { form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); };
const render = async (node: ReactNode) => { await act(async () => { root.render(node); }); };
const signIn = (role: Role) => act(async () => { useStore.setState(d => { d.session = sessionFor(role, role === 'admin' ? 'Dana Admin' : 'Vic Viewer'); }); });
const openDialog = () => $('dialog[open]');

beforeAll(async () => {
  ({ useStore } = await import('@/store/store'));
  /* These tests follow the prototype: they run against the sample data. */
  (await import('@/store/testing')).resetStore();
  initial = useStore.getState();
});
beforeEach(async () => {
  useStore.setState(initial, true);
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const el = document.getElementById('root');
  if (!el) throw new Error('no root');
  root = createRoot(el);
  await signIn('admin');
});
afterEach(async () => { await act(async () => { root.unmount(); }); });
afterAll(() => { document.body.innerHTML = ''; });

describe('Analytics', () => {
  it('renders the overview and switches to the GA4 tab with its "not connected" callout', async () => {
    const { Analytics } = await import('@/views/Analytics');
    await render(<Analytics />);
    expect($$('.tabs [role="tab"]').map(t => t.textContent)).toEqual(['Overview', 'Search Console', 'GA4', 'Rank', 'Reports']);
    expect($$('section h2').map(h => h.textContent)).toEqual([
      'Needs attention', 'Traffic against cost', 'Top sites', 'Token use by agent, today', 'Spend today against the daily budget',
    ]);
    expect($$('.an-kpi-l').map(s => s.textContent)).toEqual(['Organic clicks, 28 days', 'Agent spend today', 'Tokens used, 28 days', 'Clicks per $1 of agent spend']);
    /* One bar for all eleven agents, in their hues, and the largest marked in the table under it. */
    expect($$('.an-stack .an-seg')).toHaveLength(11);
    expect($$('.an-seg.h4, .an-seg.h0').length).toBe(2);
    expect($$('.an-table tbody tr').map(r => r.querySelector('.pill')?.textContent ?? '')).toEqual(['Highest use', ...Array(10).fill('')]);
    /* 120 sites: a bubble chart, one ranked list of 8 with the rest as a total, and what needs a person above them. */
    expect($$('.an-bub').length).toBeGreaterThan(90);
    expect($$('.an-rank li')).toHaveLength(9);
    const blocked = $$('.an-insight').find(c => c.textContent?.includes('blocked'))!;
    expect(blocked.querySelector('h3')?.textContent).toBe('7 sites are blocked in their country.');
    expect(blocked.querySelector('button')?.textContent).toBe('Open Build and deploy');

    await click(byText('.tabs [role="tab"]', 'GA4'));
    expect(st().atab).toBe('ga4');
    expect($('.callout.warn p')?.textContent).toBe('Google Analytics 4 is not connected. These numbers are the last data received and are no longer updating.');
    await click(byText('.tabs [role="tab"]', 'Search Console'));
    expect($('.callout')).toBeNull();
    expect($('table')).not.toBeNull();
  });
});

describe('Models and skills', () => {
  it('adds a skill, with the duplicate-name check', async () => {
    const { Skills } = await import('@/views/Skills');
    await render(<Skills />);
    expect($$('.sx-sum h2, .sx-sec h2').map(h => h.textContent)).toEqual(['Model mix', 'Agents']);
    await click(byText('.sh .btn', 'Add skill'));
    await type($<HTMLInputElement>('#skName')!, 'keyword research');
    await type($<HTMLInputElement>('#skDesc')!, 'Finds keywords.');
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('A skill with this name already exists.');
    await type($<HTMLInputElement>('#skName')!, 'Schema markup');
    await submit($('dialog[open] form'));
    expect(openDialog()).toBeNull();
    expect(st().skills.at(-1)).toMatchObject({ name: 'Schema markup', desc: 'Finds keywords.', ver: '0.1', fresh: true });
    expect(st().log[0]).toMatchObject({ actor: 'Dana Admin', act: 'Added the skill Schema markup' });
  });

  it('assigns agents and restores a version', async () => {
    const { Skills } = await import('@/views/Skills');
    await render(<Skills />);
    await click(byText('.tabs [role="tab"]', 'By skill'));
    await click($('[aria-label="Assign agents to Internal linking"]')!);
    expect(openDialog()?.querySelector('h2')?.textContent).toBe('Internal linking');
    await click($('#as-s7-res')!);
    expect(st().agents.find(a => a.id === 'res')?.skills).toContain('s7');
    expect(st().log[0]?.act).toBe('Attached "Internal linking" to Research');
    await click(byText('dialog[open] .btn', 'Done'));

    await click($('[aria-label="Versions of Material Design 3 (web)"]')!);
    expect($$('dialog[open] .q .pill').map(p => p.textContent)).toEqual(['v1.1', 'v1.0']);
    await click(byText('dialog[open] .btn', 'Restore'));
    expect(st().skills.find(k => k.id === 's11')?.ver).toBe('1.0');
    expect(st().log[0]?.act).toBe('Restored "Material Design 3 (web)" to v1.0');
    expect(openDialog()).toBeNull();
  });

  it('offers three OpenAI models and no provider switch', async () => {
    const { Skills } = await import('@/views/Skills');
    await render(<Skills />);
    expect($$('.sx-sum .btn').some(b=>b.textContent?.includes('Switch provider'))).toBe(false);
    await click($('.sx-agent .dd')!);
    expect($$('.ddp .ddo').map(o=>o.textContent)).toEqual(['checkGPT-6 Luna','checkGPT-6.1 Sol','checkGPT-6 Astra']);
    await click($$('.ddp .ddo')[0]!);
    expect(st().agents[0]?.model).toBe('GPT-6 Luna');
    expect(st().log[0]?.act).toBe('Orchestrator now runs on GPT-6 Luna');
    expect($$('.card.int h3').some(h=>/Claude|Gemini/.test(h.textContent||''))).toBe(false);
  });
});

describe('Team and roles', () => {
  it('validates and sends an invitation, and asks before removing a person', async () => {
    const { Team } = await import('@/views/Team');
    await render(<Team />);
    expect($$('section > h2').map(h => h.textContent)).toEqual(['People', 'Roles']);
    expect($$('tbody tr')).toHaveLength(6);
    await click(byText('.sh .btn', 'Invite person'));
    const email = $<HTMLInputElement>('#usEmail')!;
    await type(email, 'not an email');
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('Enter a valid email address.');
    await type(email, 'Editor@Example.com');
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('This person is already on the team.');
    await type(email, 'new.reviewer@example.com');
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('Choose one site for a native reviewer. They review a single site in their own language.');
    await click($('dialog[open] label:nth-of-type(3) .dd')!);
    await click(byText('.ddp .ddo', 'domain-b.example'));
    await submit($('dialog[open] form'));
    expect(openDialog()).toBeNull();
    expect(st().users.at(-1)).toMatchObject({ name: 'new.reviewer', email: 'new.reviewer@example.com', role: 'Native reviewer', scope: 'domain-b.example', st: 'Invited' });
    expect(st().log[0]?.act).toBe('Invited new.reviewer@example.com as Native reviewer');

    await click(byText('tbody .btn', 'Remove'));
    expect(st().confirm).toMatchObject({ key: 'user:u2', title: 'Remove this person?' });
  });
});

describe('Integrations', () => {
  it('saves, tests, replaces and revokes keys and connects Google accounts', async () => {
    const { Integrations } = await import('@/views/Integrations');
    await act(async()=>{useStore.setState(d=>{d.ints.find(n=>n.id==='openai')!.tail=null;});});
    await render(<Integrations />);
    expect($$('section > h2').map(h => h.textContent)).toEqual(['OpenAI', 'Data and checks', 'Alerts and reports']);
    expect($('.callout.warn b')?.textContent).toBe('Do not paste a real key.');
    expect($$('.int .tag')[0]?.textContent).toBe('memoryGPT-6 Luna · $0.10 / $0.50');

    await type($<HTMLInputElement>('#key-openai')!, 'sk-abcdefgh1234');
    await submit($('#key-openai')!.closest('form'));
    expect(st().ints.find(x => x.id === 'openai')).toMatchObject({ tail: '1234', st: 'ok', msg: 'Saved' });
    expect(st().log[0]?.act).toBe('Saved the OpenAI API key');

    const card = (name: string) => $$('.int').find(c => c.querySelector('h3')?.textContent === name)!;
    await click([...card('DataForSEO').querySelectorAll('.btn')].find(b => b.textContent === 'Test connection')!);
    expect(st().log[0]?.act).toBe('Tested the DataForSEO connection: it works, but quota almost used');

    await click([...card('Cloudflare').querySelectorAll('.btn')].find(b => b.textContent === 'Replace key')!);
    expect(openDialog()?.querySelector('h2')?.textContent).toBe('Replace the Cloudflare key');
    await type($<HTMLInputElement>('#krKey')!, 'cf-0000-Lm81');
    await submit($('dialog[open] form'));
    expect($('dialog[open] .err')?.textContent).toBe('This is the same key that is already saved.');
    await type($<HTMLInputElement>('#krKey')!, 'cf-0000-Zz99');
    await submit($('dialog[open] form'));
    expect(openDialog()).toBeNull();
    expect(st().ints.find(x => x.id === 'cf')).toMatchObject({ tail: 'Zz99', msg: 'Replaced' });

    await click([...card('OpenAI API').querySelectorAll('.btn')].find(b => b.textContent === 'Revoke')!);
    expect(st().confirm?.key).toBe('key:openai');
    await act(async () => { st().closeConfirm(); });
    await click([...card('Slack').querySelectorAll('.btn')].find(b => b.textContent === 'Revoke')!);
    expect(st().ints.find(x => x.id === 'slack')?.tail).toBeNull();
    expect(st().log[0]?.act).toBe('Revoked the Slack credential');

    await click([...card('Google Analytics 4').querySelectorAll('.btn')].find(b => b.textContent === 'Connect with Google')!);
    expect(st().ints.find(x => x.id === 'ga4')).toMatchObject({ tail: 'Sample account connected', msg: 'Connected (demo)' });
    expect(card('Google Analytics 4').querySelector('.key')?.textContent).toBe('Sample account connected');
    await click([...card('Google Analytics 4').querySelectorAll('.btn')].find(b => b.textContent === 'Disconnect')!);
    expect(st().ints.find(x => x.id === 'ga4')?.tail).toBeNull();
  });
});

describe('Audit log', () => {
  it('lists entries and follows the site filter', async () => {
    const { Audit } = await import('@/views/Audit');
    await render(<Audit />);
    expect($('.lede')?.textContent).toBe('Every agent and admin action is recorded. API key values never enter the log.');
    expect($$('thead th').map(t => t.textContent)).toEqual(['Time', 'Actor', 'Action', 'Site']);
    const all = $$('tbody tr').length;
    expect(all).toBe(st().log.length);
    await act(async () => { st().setSiteFilter('b'); });
    expect($$('tbody tr').length).toBe(st().log.filter(l => !l.site || l.site === 'b').length);
    expect($$('tbody tr').length).toBeLessThan(all);
  });
});

describe('Settings', () => {
  it('changes settings, alerts and sessions, and refuses a viewer', async () => {
    const { Settings } = await import('@/views/Settings');
    await render(<Settings />);
    expect($$('section > h2').map(h => h.textContent)).toEqual(['Limits', 'Human approval', 'Notifications', 'Sign-in security']);

    await click($('#st-twofa')!);
    expect(st().settings.twofa).toBe(false);
    expect(st().log[0]?.act).toBe('Updated settings');

    const budget = $<HTMLInputElement>('#st-budget')!;
    await type(budget, '0');
    await act(async () => { budget.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); });
    expect(st().settings.budget).toBe(1);
    expect(budget.value).toBe('1');

    expect($<HTMLInputElement>('#np-approval-3')!.disabled).toBe(true);
    expect($$('table:first-of-type thead th').slice(0, 5).map(t => t.textContent)).toEqual(['Alert', 'In-app', 'Email', 'Slack', 'Telegramnot connected']);
    await click($('#np-review-1')!);
    expect(st().np.review[1]).toBe(true);
    expect(st().log[0]?.act).toBe('Turned on Email alerts for "an article is ready for review"');

    await click(byText('tbody .btn', 'Sign out'));
    expect(st().sessions.map(x => x.id)).toEqual(['x1', 'x3']);
    expect(st().log[0]?.act).toBe('Signed out the session on Chrome on Windows');

    await signIn('viewer');
    await click($('#st-native')!);
    expect(st().settings.native).toBe(true);
    expect($<HTMLInputElement>('#st-native')!.checked).toBe(true);
    expect(st().snackMsg?.msg).toBe('View-only role. Ask an admin to make changes.');
  });
});

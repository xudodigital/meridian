// @vitest-environment jsdom
/* Smoke tests for the content group: Article review, Run history and Reports render with the seeded store and their
   main interactions change the state as the prototype does. */
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store/store';
import { makeState } from '@/store/testing';
import type { Role } from '@/store/types';
import { History } from '../History';
import { Reports } from '../Reports';
import { Review } from '../Review';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

let root: Root | null = null;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const byText = (sel: string, text: string) => $$(sel).find(e => e.textContent === text) ?? null;
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
};
/** Sets a controlled field's value the way React listens for it. */
const type = async (el: HTMLInputElement | HTMLTextAreaElement | null, value: string) => {
  expect(el).not.toBeNull(); if (!el) return;
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const render = async (node: ReactNode, role: Role = 'admin') => {
  await act(async () => { useStore.setState({ ...makeState(role), siteFilter: role === 'reviewer' ? 'a' : 'all', rtab: 'open', rsel: null, rdetail: false, rmsg: '' }); });
  document.body.innerHTML = '<div id="root"></div>';
  const el = document.getElementById('root');
  if (!el) throw new Error('no root');
  root = createRoot(el);
  await act(async () => { root?.render(node); });
};
const article = (id: number) => useStore.getState().articles.find(a => a.id === id);

beforeEach(() => { vi.spyOn(console, 'error'); });
afterEach(async () => {
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  await act(async () => { root?.unmount(); });
  root = null;
});

describe('Article review', () => {
  it('renders the queue, the first article and the review modes', async () => {
    await render(<Review />);
    expect($('.vs h2')?.textContent).toBe('Good content. A human decision.');
    expect($('.vs-total b')?.textContent).toBe('4');
    expect($$('.tabs [role="tab"]').map(t => t.textContent)).toEqual(['Waiting (4)', 'Decided (0)', 'Drafts (6)']);
    expect($$('#rvlist .art b').map(b => b.textContent)).toEqual(['Saigon-style iced milk coffee', '10 best phones under 20,000 taka', '5 khao soi spots in Chiang Mai', 'How to save on a small salary']);
    expect($('#rvlist .art.on b')?.textContent).toBe('Saigon-style iced milk coffee');
    expect(useStore.getState().rsel).toBe(1);
    expect($('.rvd h2')?.textContent).toBe('Cà phê sữa đá kiểu Sài Gòn');
    expect($$('table.bi th').map(t => t.textContent)).toEqual(['Original (Vietnamese)', 'English translation']);
    expect($('table.bi td')?.getAttribute('data-label')).toBe('Original (Vietnamese)');
    /* Article 4 carries an "info" check, so only article 1 is ready and no batch button is offered. */
    expect($$('.sh .btn')).toHaveLength(0);
    expect(byText('section > h2', 'Review mode by site')).not.toBeNull();
    expect($('.pager .note')?.textContent).toBe('1–10 of 120');
    expect($('#mode-a')).not.toBeNull();
  });

  it('opens the detail on a phone and goes back to the list', async () => {
    await render(<Review />);
    expect($('.rv')?.getAttribute('data-detail')).toBe('0');
    await click($$('#rvlist .art')[1] ?? null);
    expect($('.rv')?.getAttribute('data-detail')).toBe('1');
    expect($('.rvd h2')?.textContent).toBe('২০,০০০ টাকার নিচে সেরা ১০টি স্মার্টফোন');
    expect(byText('.decide p.note', 'Cannot approve: an automated check failed. Request a revision or reject the article.')).not.toBeNull();
    expect(byText('.decide button', 'checkApprove and publish')?.hasAttribute('disabled')).toBe(true);
    await click($('.rvback'));
    expect($('.rv')?.getAttribute('data-detail')).toBe('0');
  });

  it('approves an article and it leaves the queue', async () => {
    await render(<Review />);
    await click(byText('.decide button', 'checkApprove and publish'));
    expect(article(1)?.status).toBe('published');
    expect(useStore.getState().log[0]).toMatchObject({ actor: 'Dana Admin', act: 'Approved and published: Saigon-style iced milk coffee' });
    expect($$('.tabs [role="tab"]')[0]?.textContent).toBe('Waiting (3)');
    expect($('#rvlist .art.on b')?.textContent).toBe('10 best phones under 20,000 taka');
    await click(byText('.tabs [role="tab"]', 'Decided (1)'));
    expect($$('#rvlist .art b').map(b => b.textContent)).toEqual(['Saigon-style iced milk coffee']);
  });

  it('requires a note to request a revision', async () => {
    await render(<Review />);
    await click(byText('.decide button', 'Request revision'));
    expect($('.decide .err')?.textContent).toBe('Write a revision note first, so the agent knows what to change.');
    expect(article(1)?.status).toBe('review');
    await type($<HTMLTextAreaElement>('#rvNote'), 'Shorten the intro.');
    await click(byText('.decide button', 'Request revision'));
    expect(article(1)?.status).toBe('revisi');
    expect(article(1)?.notes).toEqual(['Reviewer note: Shorten the intro.']);
    expect(useStore.getState().rmsg).toBe('');
  });

  it('rejects through the confirm dialog', async () => {
    await render(<Review />);
    await click(byText('.decide button', 'Reject'));
    expect(useStore.getState().confirm?.key).toBe('art:1');
    await act(async () => { useStore.getState().confirmOk(); });
    expect(article(1)?.status).toBe('rejected');
    expect(article(1)?.notes[0]).toMatch(/^Rejected at \d\d:\d\d\.$/);
  });

  it('approves every ready article at once', async () => {
    await render(<Review />);
    await act(async () => { useStore.setState(d => { const a = d.articles.find(x => x.id === 4); if (a) a.checks = a.checks.map(c => ['ok', c[1], c[2]]); }); });
    await click(byText('.sh button', 'done_allApprove 2 that pass every check'));
    expect([article(1)?.status, article(4)?.status]).toEqual(['published', 'published']);
    expect(useStore.getState().log[0]?.act).toBe('Approved 2 articles at once');
  });

  it('changes the review mode of a site', async () => {
    await render(<Review />);
    await click($('#mode-a + .dd'));
    await click(byText('.ddp .ddo', 'checkSample 1 in 5'));
    expect(useStore.getState().sites.find(s => s.id === 'a')?.mode).toBe('sample');
    expect(useStore.getState().log[0]?.act).toBe('Review mode for domain-a.example: Sample 1 in 5');
  });

  it('shows the drafts table', async () => {
    await render(<Review />);
    await click(byText('.tabs [role="tab"]', 'Drafts (6)'));
    expect($('section > p.note')?.textContent).toBe('The Content Writer drafts, then each article goes through native-speaker review before it publishes.');
    expect($$('table th').slice(0, 3).map(t => t.textContent)).toEqual(['Title', 'Site', 'Language']);
  });

  it('gives a native reviewer the language review only', async () => {
    await render(<Review />, 'reviewer');
    expect($$('.tabs [role="tab"]').map(t => t.textContent)).toEqual(['Waiting (1)', 'Decided (0)']);
    expect(byText('section > h2', 'Review mode by site')).toBeNull();
    expect(byText('.decide button', 'checkApprove and publish')).toBeNull();
    expect($('.decide p.note')?.textContent).toBe('The language review is done. An editor or admin decides whether the article is published.');
    await act(async () => { useStore.setState(d => { const a = d.articles.find(x => x.id === 1); if (a) a.native = { st: 'wait' }; }); });
    await click(byText('.decide button', 'checkMark language review as done'));
    expect(article(1)?.native).toEqual({ st: 'done', by: 'Linh Reviewer', note: 'Language checked.' });
    expect(useStore.getState().snackMsg?.msg).toBe('Language review recorded');
  });

  it('refuses decisions for a viewer', async () => {
    await render(<Review />, 'viewer');
    await click(byText('.decide button', 'checkApprove and publish'));
    expect(article(1)?.status).toBe('review');
    expect(useStore.getState().snackMsg?.msg).toBe('View-only role. Ask an admin to make changes.');
  });
});

describe('Run history', () => {
  it('renders the tiles and the runs, and opens a run log', async () => {
    await render(<History />);
    const runs = useStore.getState().jobLog;
    expect($$('.tile span').map(s => s.textContent)).toEqual(['Runs recorded', 'Tokens used', 'Estimated cost', 'Failed runs']);
    expect($('.tile.a b')?.textContent).toBe(String(runs.length));
    /* A count that needs attention takes the error dot. */
    expect($('.tile.bad b')?.textContent).toBe('1');
    expect($$('tbody tr')).toHaveLength(runs.length);
    const failed = runs.findIndex(r => r.status === 'Failed');
    await click($$('tbody tr')[failed]?.querySelector('button') ?? null);
    expect($('dialog[open] h2')?.textContent).toBe(runs[failed]?.task);
    expect(byText('dialog[open] .dsec h3', 'Steps')).not.toBeNull();
    expect($$('dialog[open] .tl li')).toHaveLength(6);
    expect($('dialog[open] .tl .err')?.textContent).toBe('Stopped: the tool returned a rate-limit error. The run will retry.');
    await click(byText('dialog[open] .actions button', 'Close'));
    expect($('dialog[open]')).toBeNull();
  });
});

describe('Reports', () => {
  it('renders the summary, the table and the delivery settings', async () => {
    await render(<Reports />);
    expect($('.sh .lede')?.textContent).toBe('A weekly summary for people who never open the dashboard. Period: the last 7 days.');
    expect($$('.tile span').map(s => s.textContent)).toEqual(['Organic clicks', 'Articles published', 'Waiting for review', 'Agent spend']);
    expect($$('section > h2').map(h => h.textContent)).toEqual(['By site', 'Highlights', 'Scheduled delivery']);
    expect($$('tbody tr')).toHaveLength(10);
    expect($('.pager .note')?.textContent).toBe('1–10 of 120');
    expect($<HTMLInputElement>('#st-repTo')?.value).toBe('boss@example.com, team@example.com');
    expect($('#st-repFreq + .dd')?.getAttribute('aria-label')).toBe('How often: Every Monday 08:00');
  });

  it('saves recipients on blur and validates Send now', async () => {
    await render(<Reports />);
    const input = $<HTMLInputElement>('#st-repTo');
    await type(input, '  ');
    expect(useStore.getState().settings.repTo).toBe('boss@example.com, team@example.com');
    await act(async () => { input?.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); });
    expect(useStore.getState().settings.repTo).toBe('  ');
    expect(useStore.getState().log[0]?.act).toBe('Updated settings');
    await click(byText('.sh button', 'sendSend now'));
    expect(useStore.getState().snackMsg).toMatchObject({ msg: 'Add at least one recipient first.', icon: 'info' });
    await type(input, 'ops@example.com');
    await act(async () => { input?.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); });
    await click(byText('.sh button', 'sendSend now'));
    expect(useStore.getState().log[0]?.act).toBe('Sent the weekly report to ops@example.com (simulated)');
  });

  it('copies as CSV, or shows the CSV sheet when copying is refused', async () => {
    await render(<Reports />);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    await click(byText('.sh button', 'content_copyCopy as CSV'));
    expect(writeText).toHaveBeenCalledOnce();
    expect(String(writeText.mock.calls[0])).toMatch(/^Site,Country,Clicks,Articles published,Waiting for review,Spend \(USD\),Issue\n/);
    expect(useStore.getState().snackMsg?.msg).toBe('Report copied as CSV');

    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    await click(byText('.sh button', 'content_copyCopy as CSV'));
    expect($('dialog[open] h2')?.textContent).toBe('Weekly report as CSV');
    expect($<HTMLTextAreaElement>('#csvT')?.value).toMatch(/^Site,Country,Clicks/);
  });

  it('keeps settings unchanged for a viewer', async () => {
    await render(<Reports />, 'viewer');
    await click($('#st-repOn'));
    expect(useStore.getState().settings.repOn).toBe(true);
    expect($<HTMLInputElement>('#st-repOn')?.checked).toBe(true);
  });
});

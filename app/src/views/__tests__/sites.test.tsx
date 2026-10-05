// @vitest-environment jsdom
/* Smoke tests of the sites group: Sites, Workflows and Build and deploy render with the seeded store, and their main
   actions change the state as the prototype does. */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store/store';
import { makeState } from '@/store/testing';
import type { Role } from '@/store/types';
import { Deploy } from '../Deploy';
import { Sites } from '../Sites';
import { Workflows } from '../Workflows';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

let root: Root | null = null;
const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error('Not found: ' + sel);
  return el;
};
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const byText = (sel: string, text: string): HTMLElement => {
  const el = $$(sel).find(e => e.textContent === text);
  if (!el) throw new Error(`Not found: ${sel} "${text}"`);
  return el;
};
const click = (el: Element) => act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
const type = (el: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
});
const choose = (el: HTMLSelectElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
});
const render = async (ui: ReactElement) => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot($('#root'));
  await act(async () => { root?.render(ui); });
};
const reset = (role: Role = 'admin') => {
  useStore.setState({ ...makeState(role), smode: 'list', sq: '', sst: '', sco: '', mapSel: null, checking: [] });
};
const site = (id: string) => useStore.getState().sites.find(s => s.id === id);

beforeEach(() => reset());
afterEach(async () => { await act(async () => { root?.unmount(); }); root = null; });

describe('Sites', () => {
  it('renders the visual overview, the modes and the first page of the list', async () => {
    await render(<Sites />);
    expect($$('.vs-station-name').map(e => e.firstChild?.textContent)).toEqual(['Live sites', 'Being set up', 'Paused', 'Access issues']);
    expect($('.vs-total b').textContent).toBe('120');
    expect($$('.tabs [role="tab"]').map(e => e.textContent)).toEqual(['table_rowsList', 'publicMap', 'paletteThemes']);
    expect($$('#sitesTbl tbody tr')).toHaveLength(12);
    expect($('.pager .note').textContent).toBe('1–12 of 120');
    expect($('#sitesTbl').textContent).toContain('Add TXT _agent-verify = verify-7f3k2q');
  });

  it('filters by search text and status, and acts on a row', async () => {
    await render(<Sites />);
    await type($<HTMLInputElement>('#sq'), 'domain-c');
    expect($$('#sitesTbl tbody tr')).toHaveLength(1);
    await click(byText('#sitesTbl button', 'Pause'));
    expect(site('c')?.status).toBe('paused');
    expect(useStore.getState().log[0]).toMatchObject({ actor: 'Dana Admin', act: 'Paused domain-c.example', site: 'c' });
    await click(byText('#sitesTbl button', 'Resume'));
    expect(site('c')?.status).toBe('live');
    await click($('button[aria-label="Remove domain-c.example"]'));
    expect(useStore.getState().confirm?.key).toBe('site:c');

    await type($<HTMLInputElement>('#sq'), '');
    await choose($<HTMLSelectElement>('#sf-st'), 'dns');
    expect(useStore.getState().sst).toBe('dns');
    await click(byText('#sitesTbl button', 'Verify DNS'));
    expect(site('e')).toMatchObject({ status: 'build', access: 'ok', silos: ['Silo 1', 'Silo 2', 'Silo 3'] });
    expect(useStore.getState().runs.find(r => r.site === 'e')?.step).toBe(1);
  });

  it('shows the map, selects a country and lists its sites', async () => {
    await render(<Sites />);
    await click(byText('[role="tab"]', 'publicMap'));
    expect($('.mapin svg path').getAttribute('d')).toMatch(/^M/);
    expect($$('.mk')).toHaveLength(12);
    expect($('.mk[aria-pressed="true"]').classList.contains('bad')).toBe(true);
    const ph = byText('.crow b', 'Philippines').closest('button');
    if (!ph) throw new Error('no crow');
    await click(ph);
    expect(useStore.getState().mapSel).toBe('PH');
    expect($('.mapd h3').textContent).toBe('Philippines');
    await click(byText('.mapd button', 'listShow these sites in the list'));
    expect(useStore.getState()).toMatchObject({ smode: 'list', sco: 'Philippines', sst: '', sq: '' });
    expect($$('#sitesTbl tbody tr').every(r => r.textContent?.includes('Philippines'))).toBe(true);
  });

  it('shows the themes table', async () => {
    await render(<Sites />);
    await click(byText('[role="tab"]', 'paletteThemes'));
    expect($('section .note').textContent).toMatch(/^Every site is built with the default Material Design 3 skill/);
    expect($('section table')).toBeTruthy();
  });

  it('adds a domain through the form', async () => {
    await render(<Sites />);
    await click(byText('button', 'addAdd domain'));
    expect($('#sheetT').textContent).toBe('Add a domain');
    expect($<HTMLInputElement>('#sdLang').value).toBe('Vietnamese');
    await choose($<HTMLSelectElement>('#sdCountry'), '7');
    expect($<HTMLInputElement>('#sdLang').value).toBe('Portuguese');
    await type($<HTMLInputElement>('#sdDomain'), 'https://bad');
    await type($<HTMLInputElement>('#sdTopic'), 'Football');
    await act(async () => { $('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    expect($('#formMsg').textContent).toBe('That domain is not valid. Write it without https://, for example domain-f.example.');
    await type($<HTMLInputElement>('#sdDomain'), 'Domain-F.example');
    await act(async () => { $('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    const s = useStore.getState(), added = s.sites[s.sites.length - 1];
    expect(added).toMatchObject({ domain: 'domain-f.example', country: 'Brazil', cc: 'BR', lang: 'Portuguese', topic: 'Football', status: 'dns', access: 'pending' });
    expect(s.runs[s.runs.length - 1]).toEqual({ name: 'New site', site: added.id, step: 0 });
    expect(s.log[0].act).toBe('Added domain-f.example (Brazil)');
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('refuses the form for a viewer', async () => {
    reset('viewer');
    await render(<Sites />);
    await click(byText('button', 'addAdd domain'));
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(useStore.getState().snackMsg?.msg).toBe('View-only role. Ask an admin to make changes.');
  });
});

describe('Workflows', () => {
  it('renders its sections and advances a run', async () => {
    await render(<Workflows />);
    expect($$('h2').map(h => h.textContent)).toEqual(['Running now', 'Site builds', 'Schedules', 'Templates']);
    /* Templates are plain reference text, not cards that look clickable. */
    expect($('.reflist dd').textContent).toBe('Site profile → Research → Keywords → Architecture → Theme → Content → Review → Deploy → Monitor');
    expect(document.querySelector('.cards .card')).toBeNull();
    expect(byText('.note', 'Verify DNS first')).toBeTruthy();
    await click($$('button').filter(b => b.textContent === 'Advance')[0]);
    expect(useStore.getState().runs[0].step).toBe(5);
    expect(useStore.getState().log[0]).toMatchObject({ actor: 'Orchestrator', act: '"New site" moved to Content' });
  });

  it('changes a schedule', async () => {
    await render(<Workflows />);
    await choose($<HTMLSelectElement>('#cad-c1'), 'Every hour');
    expect(useStore.getState().schedules[0].cad).toBe('Every hour');
    expect(useStore.getState().log[0].act).toBe('"Weekly content" now runs: every hour');
    await click($('#sch-c1'));
    expect(useStore.getState().schedules[0].on).toBe(false);
    expect($$('tbody tr')[$$('tbody tr').findIndex(r => r.querySelector('#sch-c1'))].textContent).toContain('Paused');
    await click($$('button').filter(b => b.textContent === 'Run now')[0]);
    expect(useStore.getState().log[0].act).toBe('Started "Weekly content" now');
  });
});

describe('Build and deploy', () => {
  it('renders the callout, tables, queue and timeline', async () => {
    await render(<Deploy />);
    expect($$('h2').map(h => h.textContent)).toEqual(['Watch your next release take shape.', 'Domain access by country', 'Needs approval', 'Deploy timeline', 'Deploy history']);
    expect($('.callout b').textContent).toMatch(/^\d+ domains cannot be opened from their target country\.$/);
    expect($('tbody tr td').textContent).toBe('domain-c.example');
    expect($$('.tlrow')).toHaveLength(3);
    expect($$('.tln.live')).toHaveLength(3);
  });

  it('runs a timed access check', async () => {
    vi.useFakeTimers();
    try {
      await render(<Deploy />);
      const btn = $$('tbody tr').find(r => r.textContent?.startsWith('domain-c.example'))?.querySelector('button');
      if (!btn) throw new Error('no button');
      await click(btn);
      expect(useStore.getState().checking).toEqual(['c']);
      expect(btn.disabled).toBe(true);
      await act(async () => { vi.advanceTimersByTime(1200); });
      expect(useStore.getState().checking).toEqual([]);
      expect(useStore.getState().log[0]).toMatchObject({ actor: 'Deploy & Monitor', act: 'Access check: blocked by isp from Thailand', site: 'c' });
    } finally { vi.useRealTimers(); }
  });

  it('approves a deploy and asks before rolling back', async () => {
    await render(<Deploy />);
    const before = useStore.getState().approvals.length;
    await click($$('#queue button').filter(b => b.textContent === 'Approve')[0]);
    expect(useStore.getState().approvals).toHaveLength(before - 1);
    await click($$('button').filter(b => b.textContent === 'Roll back')[0]);
    expect(useStore.getState().confirm?.title).toMatch(/^Roll back to v\d+\?$/);
  });
});

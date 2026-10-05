// @vitest-environment jsdom
/* Models and skills: the numbers the page draws (model mix, facts, categories, rule counts, search, coverage) as plain
   functions, and the page itself: the view switch, the grouped skill cards, the search box, the coverage matrix, and
   that changing a model, assigning a skill and opening Versions still go through the same store actions. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEmptyState, makeState, resetStore, sessionFor } from '@/store/testing';
import { useStore } from '@/store/store';
import type { Role } from '@/store/types';
import { Skills } from '../Skills';
import {
  categoryOf, coverage, facts, filterSkills, groupSkills, KEY_SKILLS_VIEW, maxRules, mixText, modelEffect, modelMix, readSkillsView, ruleCount, summaryOf,
} from '../skills/model';

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
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const st = () => useStore.getState();
const byText = (sel: string, text: string): HTMLElement => {
  const el = $$(sel).find(b => b.textContent === text || b.textContent?.endsWith(text));
  if (!el) throw new Error(`No ${sel} with text "${text}"`);
  return el;
};
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const type = async (el: HTMLInputElement | null, value: string) => {
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el?.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const unmount = async () => { if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; } };
const mount = async (node: ReactNode) => {
  await unmount();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(node); });
};
const tab = (name: string) => click(byText('.tabs [role="tab"]', name));
const start = (sample: boolean, role: Role = 'admin') => {
  resetStore(sample);
  useStore.setState(d => { d.session = sessionFor(role); d.sync = { loaded: true, error: '' }; });
};

beforeEach(() => { localStorage.clear(); start(true); });
afterEach(async () => { await unmount(); vi.restoreAllMocks(); });
afterAll(() => { document.body.innerHTML = ''; });

describe('what the page works out', () => {
  it('counts the agents on each model, cheapest tier first, with the list price', () => {
    const mix = modelMix(makeState().agents);
    expect(mix.map(p => [p.short, p.tier, p.n, p.price])).toEqual([['GPT-6 Luna', 0, 3, '$0.10 / $0.50'], ['GPT-6.1 Sol', 1, 6, '$2 / $10'], ['GPT-6 Astra', 2, 2, '$10 / $50']]);
    expect(mix[2]?.agents).toEqual(['Orchestrator', 'Site Builder']);
    expect(mixText(mix)).toBe('GPT-6 Luna: 3 agents, GPT-6.1 Sol: 6 agents, GPT-6 Astra: 2 agents');
    /* Another provider's models keep their full name and sort by tier too. */
    expect(modelMix([{ name: 'A', model: 'GPT-6.1 Sol' }, { name: 'B', model: 'GPT-6 Luna' }, { name: 'C', model: 'GPT-6 Luna' }]).map(p => [p.short, p.tier, p.n]))
      .toEqual([['GPT-6 Luna', 0, 2], ['GPT-6.1 Sol', 1, 1]]);
    expect(modelMix([])).toEqual([]);
  });

  it('counts active and planned agents, assigned skills and connected providers', () => {
    expect(facts(makeState())).toEqual({ agents: 11, active: 11, planned: 0, skills: 14, assigned: 14, providers: 1, connected: ['OpenAI'] });
    const empty = makeEmptyState();
    expect(facts(empty)).toMatchObject({ agents: 11, active: 11, planned: 0, skills: 14, assigned: 14, connected: [] });
    expect(facts({ ...empty, skills: [...empty.skills, { id: 'k1', name: 'Schema markup', desc: 'x', ver: '0.1' }] })).toMatchObject({ skills: 15, assigned: 14 });
  });

  it('says what a model choice changes outside demo mode, and nothing extra inside it', () => {
    expect(['kw', 'wr', 'bld', 'orc', 'dep', 'res'].map(id => modelEffect({ sample: false }, { id }))).toEqual(['next-job', 'next-job', 'next-job', 'code', 'code', 'next-job']);
    expect(modelEffect({ sample: true }, { id: 'res' })).toBeNull();
  });

  it('groups the built-in skills under four headings and a person\'s own under Custom', () => {
    const skills = [...makeState().skills, { id: 'k9', name: 'Schema markup', desc: 'Creates JSON-LD.', ver: '0.1' }];
    expect(groupSkills(skills).map(g => [g.name, g.skills.map(k => k.name)])).toEqual([
      ['Research', ['SERP research', 'Keyword research']],
      ['Content', ['Article writing', 'AI search features', 'Images and alt text']],
      ['Site and technical', ['Site architecture', 'On-page audit', 'Internal linking', 'Web performance', 'Material Design 3 (web)', 'Google Search Central SEO']],
      ['Operations', ['Deploy and access checks', 'Search analytics', 'Agent orchestration']],
      ['Custom', ['Schema markup']],
    ]);
    expect(categoryOf({ id: 'anything' })).toBe('custom');
    expect(groupSkills(makeState().skills).map(g => g.id)).toEqual(['research', 'content', 'site', 'ops']);
  });

  it('reads the rule count and a one-sentence summary out of a description', () => {
    const by = Object.fromEntries(makeState().skills.map(k => [k.id, k]));
    expect(ruleCount(by.s1!.desc)).toBe(123);
    expect(ruleCount(by.s14!.desc)).toBe(352);
    expect(ruleCount(by.s11!.desc)).toBeNull();
    expect(ruleCount('1,204 rules from one source.')).toBe(1204);
    expect(maxRules(makeState().skills)).toBe(352);
    expect(maxRules([{ desc: 'No number here.' }])).toBe(0);
    expect(summaryOf(by.s1!.desc)).toBe('How to study a country\'s search results through a SERP data API, never by querying Google.');
    expect(summaryOf(by.s8!.desc)).toBe('Core Web Vitals (LCP, INP, CLS): thresholds, measurement and documented fixes.');
    expect(summaryOf('Creates and validates JSON-LD schema.')).toBe('Creates and validates JSON-LD schema.');
    expect(summaryOf('120 rules from Google.')).toBe('120 rules from Google.');
  });

  it('filters skills by every word typed, in the name or the description', () => {
    const skills = makeState().skills;
    expect(filterSkills(skills, '').length).toBe(14);
    expect(filterSkills(skills, 'LINK').map(k => k.name)).toEqual(['Internal linking']);
    expect(filterSkills(skills, 'cloudflare dns').map(k => k.name)).toEqual(['Deploy and access checks']);
    expect(filterSkills(skills, 'zzz')).toEqual([]);
  });

  it('builds the coverage matrix: a row per agent, a column per skill in category order, totals both ways', () => {
    const s = makeState(), cov = coverage(s.agents, s.skills);
    expect(cov.cols.map(k => k.id)).toEqual(['s1', 's2', 's4', 's6', 's13', 's3', 's5', 's7', 's8', 's11', 's12', 's9', 's10', 's14']);
    expect(cov.rows).toHaveLength(11);
    const kw = cov.rows.find(r => r.agent.id === 'kw')!;
    expect(cov.cols.filter((_, c) => kw.on[c]).map(k => k.name)).toEqual(['SERP research', 'Keyword research', 'Google Search Central SEO']);
    expect(kw.total).toBe(3);
    expect(cov.colTotals).toEqual([2, 1, 1, 2, 2, 1, 1, 1, 1, 2, 6, 1, 1, 1]);
    expect(cov.attached).toBe(s.agents.reduce((n, a) => n + a.skills.length, 0));
    expect(cov.attached).toBe(23);
  });
});

describe('the page', () => {
  it('draws the model mix and the three facts', async () => {
    await mount(<Skills />);
    expect($('.sx-bar')?.getAttribute('aria-label')).toBe('Model mix. GPT-6 Luna: 3 agents, GPT-6.1 Sol: 6 agents, GPT-6 Astra: 2 agents');
    expect($$('.sx-seg').map(x => [x.textContent, x.className, x.style.flexGrow])).toEqual([['3', 'sx-seg t0', '3'], ['6', 'sx-seg t1', '6'], ['2', 'sx-seg t2', '2']]);
    expect($$('.sx-legend li').map(li => li.textContent)).toEqual(['GPT-6 Luna3 agentsFast · $0.10 / $0.50', 'GPT-6.1 Sol6 agentsBalanced · $2 / $10', 'GPT-6 Astra2 agentsMost capable · $10 / $50']);
    expect($$('.sx-facts > div').map(d => d.textContent)).toEqual(['Agents11All active', 'Skills14All assigned', 'Providers1 of 1OpenAI connected']);

    /* The bar follows the store. */
    await act(async () => { st().setAgentModel('orc', 'GPT-6 Luna'); });
    expect($$('.sx-seg').map(x => x.textContent)).toEqual(['4', '6', '1']);
  });

  it('outside demo mode counts planned agents, says nothing is connected, and explains what changes a job', async () => {
    start(false);
    await mount(<Skills />);
    expect($$('.sx-facts > div').map(d => d.textContent)).toEqual(['Agents11All active', 'Skills14All assigned', 'Providers0 of 1None connected yet']);
    expect($$('.sx-sec h2').map(h => h.textContent)).toEqual(['Agents']);
    expect($$('[data-group="active"] .sx-agent')).toHaveLength(11);
    expect($$('[data-group="planned"] .sx-agent')).toHaveLength(0);
    expect($$('.sx-effect').map(p => p.textContent).filter(t => t?.includes('Used by its next job'))).toHaveLength(9);
    expect($$('.sx-effect').map(p => p.textContent).filter(t => t?.includes('Runs as code'))).toHaveLength(2);
    /* An active agent whose provider has no key says so in words; a planned one stays quiet. */
    expect($$('[data-group="active"] .sx-warn').map(p => p.textContent)).toEqual(Array(9).fill('warningNeeds the OpenAI key. Add it in Integrations.'));
    expect($$('[data-group="planned"] .sx-warn')).toEqual([]);
    expect($('details.more summary')?.textContent).toBe('infoWhat changes a job today');
  });

  it('switches between the three views and remembers the last one in this browser', async () => {
    await mount(<Skills />);
    expect($$('.tabs [role="tab"]').map(t => [t.textContent, t.getAttribute('aria-selected')])).toEqual([['smart_toyBy agent', 'true'], ['psychologyBy skill', 'false'], ['grid_onCoverage', 'false']]);
    expect($$('.sx-agent')).toHaveLength(11);
    expect($('.sfield')).toBeNull();

    await tab('By skill');
    expect($$('.sx-agent')).toHaveLength(0);
    expect($$('.sx-skill')).toHaveLength(14);
    expect(localStorage.getItem(KEY_SKILLS_VIEW)).toBe('skills');

    await tab('Coverage');
    expect($('table.sx-mx')).not.toBeNull();
    expect(localStorage.getItem(KEY_SKILLS_VIEW)).toBe('matrix');

    /* A new visit opens where the person left; a value it does not know falls back to By agent. */
    await mount(<Skills />);
    expect($('.tabs [aria-selected="true"]')?.textContent).toBe('grid_onCoverage');
    localStorage.setItem(KEY_SKILLS_VIEW, 'nonsense');
    expect(readSkillsView()).toBe('agents');
  });

  it('shows each agent as a card: status, model picker with tier and price, skills', async () => {
    await mount(<Skills />);
    const card = $('[data-agent="wr"]')!;
    expect(card.querySelector('h3')?.textContent).toBe('Content Writer');
    expect(card.querySelector('.sx-who p')?.textContent).toBe('Writes and localizes articles');
    expect(card.querySelector('.sx-status')?.textContent).toBe('Active');
    expect(card.querySelector('.sx-model')?.className).toBe('sx-model t1');
    expect(card.querySelector('.dd')?.getAttribute('aria-label')).toBe('Model for Content Writer: GPT-6.1 Sol');
    expect(card.querySelector<HTMLSelectElement>('select#md-wr')?.value).toBe('GPT-6.1 Sol');
    expect(card.querySelector('.sx-price')?.textContent).toBe('Balanced · $2 / $10 per 1M tokens');
    expect([...card.querySelectorAll('.sx-chip')].map(c => c.textContent)).toEqual(['Article writing', 'AI search features', 'Google Search Central SEO']);
    expect(card.querySelector('.sx-warn, .sx-effect')).toBeNull();
  });

  it('shows the actual required guidelines for Site Builder even with no optional assignments', async () => {
    await act(async () => { useStore.setState(d => {
      d.sample = false;
      d.agents.find(a => a.id === 'bld')!.skills = [];
    }); });
    await mount(<Skills />);
    expect($('[data-agent="bld"]')?.textContent).toContain('Loaded on the next AI call: material-3-web, web-performance, images-and-alt-text');
    expect(document.body.textContent).toContain('Assigned built-in skills apply to the next AI call');
    await click($('[aria-label="Change skills for Site Builder"]'));
    expect($('dialog[open]')?.textContent).toContain('Required task guidelines cannot be disabled');
  });

  it('changes a model through setAgentModel, and warns in words about a missing key and a skill clash', async () => {
    const setAgentModel = vi.fn(st().setAgentModel);
    useStore.setState({ setAgentModel });
    await mount(<Skills />);
    await click($('[data-agent="kw"] .dd'));
    await click(byText('.ddp .ddo', 'GPT-6 Astra'));
    expect(setAgentModel).toHaveBeenCalledExactlyOnceWith('kw', 'GPT-6 Astra');
    expect(st().agents.find(a => a.id === 'kw')?.model).toBe('GPT-6 Astra');
    expect($('[data-agent="kw"] .sx-model')?.className).toBe('sx-model t2');
    expect($('[data-agent="kw"] .sx-price')?.textContent).toBe('Most capable · $10 / $50 per 1M tokens');

    await act(async () => { useStore.setState(d => {
      d.agents.find(a => a.id === 'kw')!.model = 'GPT-6 Luna';
      d.ints.find(k => k.id === 'openai')!.tail = null;
    }); });
    expect($$('[data-agent="kw"] .sx-warn').map(p => p.textContent)).toEqual(['warningNeeds the OpenAI key. Add it in Integrations.']);
    expect($('[data-agent="kw"] .dd .lbl')?.textContent).toBe('GPT-6 Luna (key missing)');
  });

  it('attaches and detaches skills from an agent card through setSkillAgent', async () => {
    const setSkillAgent = vi.fn(st().setSkillAgent);
    useStore.setState({ setSkillAgent });
    await mount(<Skills />);
    await click($('[aria-label="Change skills for Research"]'));
    expect($('dialog[open] h2')?.textContent).toBe('Skills for Research');
    expect($$('dialog[open] .sx-pick > h3').map(h => h.textContent)).toEqual(['Research', 'Content', 'Site and technical', 'Operations']);
    expect($<HTMLInputElement>('#sk-res-s1')?.checked).toBe(true);
    await click($('#sk-res-s7'));
    expect(setSkillAgent).toHaveBeenLastCalledWith('s7', 'res', true);
    await click($('#sk-res-s1'));
    expect(setSkillAgent).toHaveBeenLastCalledWith('s1', 'res', false);
    expect(st().agents.find(a => a.id === 'res')?.skills).toEqual(['s7']);
    expect(st().log[0]?.act).toBe('Detached "SERP research" from Research');
    await click(byText('dialog[open] .btn', 'Done'));
    expect([...$('[data-agent="res"]')!.querySelectorAll('.sx-chip')].map(c => c.textContent)).toEqual(['Internal linking']);
  });

  it('groups the skill cards, with size, badges, the agents that use each one, and More', async () => {
    await act(async () => { st().addSkill('Schema markup', 'Creates and validates JSON-LD schema.'); });
    await mount(<Skills />);
    await tab('By skill');
    expect($$('.sx-sec').map(s => [s.querySelector('h2')?.textContent, s.querySelector('.sx-count')?.textContent])).toEqual([['Research', '2'], ['Content', '3'], ['Site and technical', '6'], ['Operations', '3'], ['Custom', '1']]);
    expect($$('[data-category="content"] .sx-skill h3').map(h => h.textContent)).toEqual(['Article writing', 'AI search features', 'Images and alt text']);

    const perf = $('[data-skill="s8"]')!;
    expect(perf.querySelector('.sx-ver')?.textContent).toBe('v1.0');
    expect(perf.querySelector('.sx-size-n')?.textContent).toBe('247 rules');
    expect(perf.querySelector<HTMLElement>('.sx-meter i')?.style.width).toBe('70%');
    expect($<HTMLElement>('[data-skill="s14"] .sx-meter i')?.style.width).toBe('100%');
    expect($('[data-skill="s11"] .sx-size')?.textContent).toBe('Rule count not listed');
    expect($('[data-skill="s11"] .sx-badge')?.textContent).toBe('Default for websites');

    const seo = $('[data-skill="s12"] .sx-stack')!;
    expect(seo.getAttribute('aria-label')).toBe('Used by 6 agents: Keyword, Architect, Content Writer, SEO/GEO Optimizer, Internal Linker, Graphic Designer');
    expect([...seo.querySelectorAll('.sx-ava')].map(a => a.textContent)).toEqual(['K', 'A', 'CW', 'SG', 'IL', '+1']);
    expect(seo.querySelector('.sx-stack-n')?.textContent).toBe('6 agents');
    const custom = $('[data-category="custom"] .sx-skill')!;
    expect(custom.querySelector('.sx-unused')?.textContent).toBe('No agent yet');
    expect(custom.querySelector('.sx-badge')?.textContent).toBe('New');
    expect(custom.querySelector('.sx-more')).toBeNull();

    /* One sentence by default; More shows the whole description. */
    expect(perf.querySelector('.sx-desc')?.textContent).toBe('Core Web Vitals (LCP, INP, CLS): thresholds, measurement and documented fixes.');
    const more = perf.querySelector('.sx-more')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(perf.querySelector('.sx-desc')?.textContent).toBe(st().skills.find(k => k.id === 's8')?.desc);
  });

  it('filters the skill cards with the search box', async () => {
    await mount(<Skills />);
    await tab('By skill');
    await type($<HTMLInputElement>('.sfield input'), 'core web');
    expect($$('.sx-skill h3').map(h => h.textContent)).toEqual(['Web performance']);
    expect($$('.sx-sec h2').map(h => h.textContent)).toEqual(['Site and technical']);
    expect($('[role="status"]')?.textContent).toBe('1 of 14 skills match "core web"');
    await type($<HTMLInputElement>('.sfield input'), 'no such thing');
    expect($$('.sx-skill')).toEqual([]);
    expect($('.empty h3')?.textContent).toBe('No skill matches');
    await type($<HTMLInputElement>('.sfield input'), '');
    expect($$('.sx-skill')).toHaveLength(14);
  });

  it('opens Assign and Versions from a skill card through the same store actions', async () => {
    const setSkillAgent = vi.fn(st().setSkillAgent), initSkillHist = vi.fn(st().initSkillHist), restoreSkill = vi.fn(st().restoreSkill);
    useStore.setState({ setSkillAgent, initSkillHist, restoreSkill });
    await mount(<Skills />);
    await tab('By skill');
    await click($('[aria-label="Assign agents to Search analytics"]'));
    await click($('#as-s10-orc'));
    expect(setSkillAgent).toHaveBeenCalledExactlyOnceWith('s10', 'orc', true);
    await click(byText('dialog[open] .btn', 'Done'));
    expect($('[data-skill="s10"] .sx-stack-n')?.textContent).toBe('2 agents');

    await click($('[aria-label="Versions of Google Search Central SEO"]'));
    expect(initSkillHist).toHaveBeenCalledExactlyOnceWith('s12');
    expect(st().skills.find(k => k.id === 's12')?.hist?.map(h => h.v)).toEqual(['1.1', '1.0']);
    await click(byText('dialog[open] .btn', 'Restore'));
    expect(restoreSkill).toHaveBeenCalledExactlyOnceWith('s12', '1.0');
    expect($('[data-skill="s12"] .sx-ver')?.textContent).toBe('v1.0');
  });

  it('draws the coverage matrix as a labelled table whose dots attach and detach', async () => {
    const setSkillAgent = vi.fn(st().setSkillAgent);
    useStore.setState({ setSkillAgent });
    await mount(<Skills />);
    await tab('Coverage');
    expect($('.sx-mx caption')?.textContent).toContain('Skills by agent: 23 attached.');
    expect($$('.sx-mx-groups th[scope="colgroup"]').map(th => [th.textContent, th.getAttribute('colspan')])).toEqual([['Research', '2'], ['Content', '3'], ['Site and technical', '6'], ['Operations', '3']]);
    expect($$('.sx-mx-cols th').map(th => th.textContent).slice(0, 3)).toEqual(['SERP research', 'Keyword research', 'Article writing']);
    expect($$('.sx-mx tbody th').map(th => th.textContent?.replace(/^[A-Z]{1,2}(?=[A-Z])/, ''))).toEqual(st().agents.map(a => a.name));
    expect($$('.sx-cell')).toHaveLength(11 * 14);
    expect($$('.sx-cell[data-on]')).toHaveLength(23);
    expect($$('.sx-cell[aria-pressed="true"]').slice(0, 3).map(c => c.getAttribute('aria-label'))).toEqual(['Orchestrator: Agent orchestration, attached', 'Research: SERP research, attached', 'Keyword: SERP research, attached']);
    expect($$('.sx-mx tbody .sx-mx-total').map(td => td.textContent)).toEqual(['1', '1', '3', '2', '3', '3', '2', '3', '1', '1', '3']);
    expect($$('.sx-mx tfoot td').map(td => td.textContent)).toEqual(['2', '1', '1', '2', '2', '1', '1', '1', '1', '2', '6', '1', '1', '1', '23']);
    /* One tab stop for the whole grid. */
    expect($$('.sx-cell[tabindex="0"]')).toHaveLength(1);

    const cell = $('[aria-label="Research: Keyword research, not attached"]');
    await click(cell);
    expect(setSkillAgent).toHaveBeenCalledExactlyOnceWith('s2', 'res', true);
    expect(st().log[0]?.act).toBe('Attached "Keyword research" to Research');
    expect($('[aria-label="Research: Keyword research, attached"]')?.getAttribute('aria-pressed')).toBe('true');
    expect($$('.sx-mx tfoot td').at(-1)?.textContent).toBe('24');
    await click($('[aria-label="Research: Keyword research, attached"]'));
    expect(setSkillAgent).toHaveBeenLastCalledWith('s2', 'res', false);
    expect($$('.sx-cell[data-on]')).toHaveLength(23);
  });

  it('highlights the row and column of the focused dot, and moves with the arrow keys', async () => {
    await mount(<Skills />);
    await tab('Coverage');
    const cell = (r: number, c: number) => $(`[data-cell="${r}-${c}"]`)!;
    await act(async () => { cell(0, 0).focus(); });
    expect($('.sx-mx tbody tr.hot')?.getAttribute('data-agent')).toBe('orc');
    expect($('.sx-mx-cols th.hot')?.textContent).toBe('SERP research');
    const key = (k: string) => act(async () => { document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true })); });
    await key('ArrowRight'); await key('ArrowDown');
    expect(document.activeElement).toBe(cell(1, 1));
    expect($('.sx-mx tbody tr.hot')?.getAttribute('data-agent')).toBe('res');
    expect($('.sx-mx-cols th.hot')?.textContent).toBe('Keyword research');
    expect($$('.sx-cell[tabindex="0"]')).toEqual([cell(1, 1)]);
    await key('End');
    expect(document.activeElement).toBe(cell(1, 13));
    await key('ArrowRight');
    expect(document.activeElement).toBe(cell(1, 13));
  });

  it('keeps the role guard: a viewer cannot add, assign or change a model', async () => {
    start(true, 'viewer');
    await mount(<Skills />);
    const before = st().agents.map(a => [a.model, [...a.skills]]);
    await click(byText('.sh .btn', 'Add skill'));
    await click($('[aria-label="Change skills for Research"]'));
    expect($$('.sx-sum .btn').some(b=>b.textContent?.includes('Switch provider'))).toBe(false);
    expect($('dialog[open]')).toBeNull();
    await click($('[data-agent="kw"] .dd'));
    await click(byText('.ddp .ddo', 'GPT-6 Astra'));
    await tab('Coverage');
    await click($('[data-cell="0-0"]'));
    expect(st().agents.map(a => [a.model, [...a.skills]])).toEqual(before);
    expect(st().skills).toHaveLength(14);
  });
});

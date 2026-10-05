/* The workspace documents: what is saved from the state (and what never is), putting them back, the defaults, and the
   three-way merge used when another browser saved first. */
import { describe, expect, it } from 'vitest';
import { createEmpty, defaultSettings } from './empty';
import { createSeed } from './seed';
import { makeEmptyState } from './testing';
import type { AppState, Site } from './types';
import { DOC_IDS, applyDoc, canon, defaultDoc, docOf, rebase, type Json } from './workspace';

const site = (id: string, over: Partial<Site> = {}): Site =>
  ({ id, domain: id + '.example', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'build', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0, ...over });

/** An empty state with something entered in every saved part, and things that must never be saved. */
function entered(): AppState {
  const s = makeEmptyState();
  s.sites.push(site('s101', { status: 'paused', prev: 'live', mode: 'sample' }));
  s.agents.splice(1, 1);
  Object.assign(s.agents[0]!, { model: 'GPT-6 Luna', workers: 4, status: 'off', task: 'Paused by admin', tokens: 900, progress: 40, site: 's101' });
  s.agents.push({ id: 'x102', name: 'Schema', role: 'Validates schema', model: 'GPT-6.1 Sol', skills: ['k103'], workers: 1, tokens: 0, status: 'idle', progress: 0, site: null, task: 'Waiting for a task', tasks: ['Working on: Validates schema'], hue: 10 });
  s.skills.push({ id: 'k103', name: 'Schema markup', desc: 'Creates JSON-LD.', ver: '0.1', fresh: true, hist: [{ v: '0.1', when: 'Just now', note: 'First version' }] });
  s.schedules.push({ id: 'c1', wf: 'Weekly content', site: 's101', cad: 'Every hour', on: false });
  s.settings.budget = 40; s.settings.twofa = true;
  s.np.error[1] = true;
  s.ints[0]!.tail = 'a3Xf'; s.pg.sites = 3; s.snackMsg = { seq: 1, msg: 'hello', icon: 'info' };
  return s;
}

describe('documents', () => {
  it('start from the defaults of a new workspace', () => {
    const e = createEmpty();
    expect(e.settings).toEqual({ ...createSeed().settings, twofa: false, timeout: 'h8', repTo: '', repOn: false });
    expect(defaultSettings().twofa).toBe(false);
    expect(defaultDoc('sites')).toEqual([]);
    expect(defaultDoc('reviewModes')).toEqual({});
    expect((defaultDoc('agents') as Json[]).length).toBe(11);
  });

  it('round-trip what a person entered through JSON, and nothing else', () => {
    const s = entered(), back = makeEmptyState();
    const wire = Object.fromEntries(DOC_IDS.map(id => [id, JSON.parse(JSON.stringify(docOf(s, id))) as Json]));
    for (const id of DOC_IDS) applyDoc(back, id, wire[id] ?? null);
    expect(back.sites).toEqual(s.sites);
    expect(back.schedules).toEqual(s.schedules);
    expect(back.settings).toEqual(s.settings);
    expect(back.np).toEqual(s.np);
    expect(back.skills.at(-1)).toEqual({ id: 'k103', name: 'Schema markup', desc: 'Creates JSON-LD.', ver: '0.1', fresh: true });
    /* Agents: the line-up and its configuration come back; work in progress does not. */
    expect(back.agents.map(a => a.id)).toEqual(s.agents.map(a => a.id));
    expect(back.agents[0]).toMatchObject({ model: 'GPT-6 Luna', workers: 4, status: 'off', task: 'Paused by admin', tokens: 0, progress: 0, site: null });
    expect(back.agents.find(a => a.id === 'wr')?.gate).toBe('Publish');
    /* Never in a document: key tails, pagination, snackbar, tokens, skill version history. */
    const text = JSON.stringify(wire);
    for (const never of ['a3Xf', 'tail', 'hello', '"pg"', 'tokens', 'progress', 'First version']) expect(text).not.toContain(never);
    expect(wire.reviewModes).toEqual({ s101: 'sample' });
    expect((wire.sites as Json[])[0]).not.toHaveProperty('mode');
  });

  it('keep what an agent is doing when its configuration changes elsewhere', () => {
    const s = makeEmptyState();
    Object.assign(s.agents.find(a => a.id === 'kw')!, { live: true, liveReq: 4, status: 'work', progress: 30, task: 'Researching keywords: kopi', tokens: 500 });
    const doc = docOf(s, 'agents') as { id: string; model: string }[];
    doc.find(a => a.id === 'kw')!.model = 'GPT-6 Astra';
    applyDoc(s, 'agents', doc as unknown as Json);
    expect(s.agents.find(a => a.id === 'kw')).toMatchObject({ model: 'GPT-6 Astra', live: true, status: 'work', progress: 30, task: 'Researching keywords: kopi', tokens: 500 });
  });

  it('read an older settings document, dropping what no longer exists', () => {
    const s = makeEmptyState();
    applyDoc(s, 'settings', { budget: 30, ssoOnly: true, twofa: 'yes', timeout: 'm15' });
    expect(s.settings).toEqual({ ...defaultSettings(), budget: 30, timeout: 'm15' });
    expect(s.settings).not.toHaveProperty('ssoOnly');
  });

  it('compare by content, whatever the key order', () => {
    expect(canon({ b: 1, a: [{ y: 1, x: 2 }] })).toBe(canon({ a: [{ x: 2, y: 1 }], b: 1 }));
  });
});

describe('rebase (another browser saved first)', () => {
  const A = { id: 'a', v: 1 }, B = { id: 'b', v: 1 }, C = { id: 'c', v: 1 };
  it('applies local additions, edits and removals onto the server\'s list', () => {
    expect(rebase([A, B], [A, B, C], [A, B, { id: 'd', v: 1 }])).toEqual([A, B, { id: 'd', v: 1 }, C]);
    expect(rebase([A, B], [{ id: 'a', v: 2 }, B], [A, B, C])).toEqual([{ id: 'a', v: 2 }, B, C]);
    expect(rebase([A, B], [A], [A, B, C])).toEqual([A, C]);
    /* An item the server removed stays removed, even if it was edited here. */
    expect(rebase([A, B], [A, { id: 'b', v: 2 }], [A])).toEqual([A]);
  });
  it('merges objects key by key', () => {
    expect(rebase({ budget: 25, parallel: 24 }, { budget: 40, parallel: 24 }, { budget: 25, parallel: 30 })).toEqual({ budget: 40, parallel: 30 });
    expect(rebase({ s1: 'all', s2: 'risk' }, { s1: 'all' }, { s1: 'sample', s2: 'risk' })).toEqual({ s1: 'sample' });
  });
});

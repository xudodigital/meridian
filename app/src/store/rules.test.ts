import { describe, expect, it } from 'vitest';
import {
  MODELS, OAI, availModels, canSee, cellText, chipText, openaiReady, siteShown, costOf, fmt, fmtDur, hashStr, homeView, initials, keyOK, mapData, missingProv, modView,
  nextAgent, priceNote, priceOf, provOK, provOf, provPlan, rateOf, seeded, short, siteById, siteOpen, tierOf, totalWorkers, unalias, usd,
  artReady, homeSite, liveOn, revSite, reviewCount, waitN,
} from './rules';
import { makeEmptyState, makeState } from './testing';
import type { AuthSession, ViewId } from './types';

const BEFORE = Date.UTC(2026, 9, 5);

describe('seed', () => {
  const s = makeState();
  it('has the 5 hand-written and 115 generated sites', () => {
    expect(s.sites).toHaveLength(120);
    expect(s.sites.filter(x => x.status === 'live')).toHaveLength(3 + 99);
  });
  it('generates the same numbers as the prototype (mulberry32, seed 20261001)', () => {
    expect(siteById(s, 'g6')).toMatchObject({ domain: 'site-006.example', spend: 4.48, clicks: 1623, tok28: 0.09, status: 'live' });
    expect(siteById(s, 'g120')).toMatchObject({ spend: 6.84, clicks: 8714, tok28: 0.52 });
    expect(s.sites.filter(x => x.id.startsWith('g')).reduce((n, x) => n + x.clicks, 0)).toBe(430305);
  });
  it('seeds two runs per agent and assigns hues', () => {
    expect(s.jobLog).toHaveLength(22);
    expect(s.jobLog.filter(r => r.status === 'Failed')).toHaveLength(1);
    expect(s.agents.map(a => a.hue)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.uid).toBe(122);
  });
  it('keeps pills in table cells as data', () => {
    expect(s.mod.research.rows[2]!.c[3]).toEqual({ pill: 'info', text: 'Running', live: true });
    expect(cellText(s.mod.architecture.rows[3]!.c[4]!)).toBe('4 orphan pages');
  });
});

describe('OpenAI models and pricing', () => {
  it('offers only OpenAI models with verified prices and tiers', () => {
    expect(MODELS).toEqual(OAI);
    expect(OAI.map(provOf)).toEqual(['openai','openai','openai']);
    expect(OAI.map(tierOf)).toEqual([0,1,2]);
    expect(OAI.map(m => priceOf(m, BEFORE))).toEqual([[.1,.5],[2,10],[10,50]]);
    expect(priceOf('Unknown')).toBeNull();
    expect(priceNote(OAI[1])).toBe(' · $2 / $10');
    expect(rateOf(OAI[0])).toBe(.2);
    expect(costOf(1000000,OAI[0])).toBe(.2);
    expect(usd(2)).toBe('$2');
    const s=makeState();
    expect(provPlan(s,'openai').every(p=>p.to===p.a.model)).toBe(true);
  });
});

describe('keys', () => {
  it('offers only OpenAI models and requires a usable connection', () => {
    const s = makeState();
    expect(provOK(s,'openai')).toBe(true);
    expect(provOK(s,'missing')).toBe(false);
    expect(availModels(s)).toEqual(MODELS);
    expect(missingProv(s)).toEqual([]);
    s.ints.find(x=>x.id==='openai')!.tail=null;
    expect(provOK(s,'openai')).toBe(false);
    expect(missingProv(s)).toEqual(['OpenAI']);
    expect(availModels(s)).toEqual([]);
  });
  it('recognizes a server-side OpenAI key without asking the browser for its value', () => {
    const s=makeEmptyState();
    s.live.on=true;
    s.live.engine={mode:'none',keyConfigured:false,apiVersion:'Responses API',ready:false,reason:'Missing key'};
    expect(openaiReady(s)).toBe(false);
    s.live.engine={...s.live.engine,mode:'openai-api',ready:true,keyConfigured:true};
    expect(openaiReady(s)).toBe(true);
    expect(s.agents.every(a=>keyOK(s,a))).toBe(true);
    expect(availModels(s)).toEqual(MODELS);
    expect(missingProv(s)).toEqual([]);
  });
});

describe('things whose site is not in the store', () => {
  it('shows them under "All sites" only, with their own domain', () => {
    const s = makeEmptyState();
    expect(siteShown(s, 'a', 'old.example')).toBe(true);
    expect(siteShown(s, 'a')).toBe(false);
    expect(chipText(s, 'a', 'old.example')).toBe('old.example');
    expect(chipText(s, 'a')).toBe('Removed site');
    s.mod.keywords.rows.push({ s: 'a', live: true, domain: 'old.example', c: ['kw', 'meaning', 'n/a', 'n/a', 'Informational', 'Cluster'] });
    expect(modView(s, 'keywords').rows).toMatchObject([{ site: 'a', domain: 'old.example' }]);
    s.siteFilter = 'other';
    expect(siteShown(s, 'a', 'old.example')).toBe(false);
    expect(modView(s, 'keywords').rows).toEqual([]);
  });
  it('keeps a known site inside the site filter', () => {
    const s = makeState();
    expect(siteShown(s, 'a', 'old.example')).toBe(true);
    expect(chipText(s, 'a', 'old.example')).toBe('VN · domain-a.example');
    s.siteFilter = 'b';
    expect(siteShown(s, 'a', 'old.example')).toBe(false);
  });
});

describe('sites', () => {
  it('opens a site to agents only when it is live or building and under budget', () => {
    const s = makeState();
    expect(siteOpen(s, siteById(s, 'a'))).toBe(true);     // live
    expect(siteOpen(s, siteById(s, 'd'))).toBe(true);     // build
    expect(siteOpen(s, siteById(s, 'e'))).toBe(false);    // dns
    expect(siteOpen(s, siteById(s, 'g17'))).toBe(false);  // paused
    expect(siteOpen(s, undefined)).toBe(false);
    siteById(s, 'a')!.spend = s.settings.budget;
    expect(siteOpen(s, siteById(s, 'a'))).toBe(false);
    s.settings.budget = 40;
    expect(siteOpen(s, siteById(s, 'a'))).toBe(true);
  });
  it('counts workers of agents that are not paused', () => {
    const s = makeState();
    expect(totalWorkers(s)).toBe(19);
    s.agents.find(a => a.id === 'wr')!.status = 'off';
    expect(totalWorkers(s)).toBe(14);
  });
  it('groups sites by country, worst first', () => {
    const s = makeState(), d = mapData(s);
    expect(d.reduce((n, c) => n + c.n, 0)).toBe(120);
    expect(d[0]!.k).toBe('bad');
    s.siteFilter = 'c';
    expect(mapData(s)).toEqual([expect.objectContaining({ cc: 'TH', n: 1, blocked: 1, k: 'bad', bad: ['domain-c.example'] })]);
  });
  it('inserts the Site column like modTbl', () => {
    const s = makeState();
    expect(modView(s, 'keywords').cols).toEqual(['Keyword', 'Site', 'Meaning', 'Volume/mo', 'KD', 'Intent', 'Cluster']);
    expect(modView(s, 'keywords').num).toEqual([3, 4]);
    expect(modView(s, 'gsc').cols[0]).toBe('Site');
    expect(modView(s, 'gsc').num).toEqual([1, 2, 3, 4]);
    s.siteFilter = 'a';
    expect(modView(s, 'keywords').rows).toHaveLength(2);
  });
  it('hands a finished job to the next agent', () => {
    const s = makeState();
    expect(nextAgent(s, 'res')!.id).toBe('kw');
    s.agents.find(a => a.id === 'kw')!.status = 'off';
    expect(nextAgent(s, 'res')!.id).toBe('orc');
    expect(nextAgent(s, 'ana')!.id).toBe('orc');
    s.agents.find(a => a.id === 'orc')!.status = 'off';
    expect(nextAgent(s, 'ana')).toBeNull();
  });
});

describe('roles', () => {
  const as = (role: AuthSession['role']): AuthSession => ({ id: '9', email: 'x@example.com', role, name: 'X', site: role === 'reviewer' ? 'a' : null, twofa: false, enroll: false });
  const all: ViewId[] = ['workspace', 'review', 'sites', 'deploy', 'research', 'analytics', 'activity', 'skills', 'team', 'integrations', 'settings'];
  it('follows canSee', () => {
    expect(all.filter(v => canSee(null, v))).toEqual([]);
    expect(all.filter(v => canSee(as('admin'), v))).toEqual(all);
    expect(all.filter(v => canSee(as('viewer'), v))).toEqual(all);
    expect(all.filter(v => !canSee(as('editor'), v))).toEqual(['team', 'integrations', 'settings']);
    expect(all.filter(v => canSee(as('reviewer'), v))).toEqual(['review']);
    expect(homeView(as('reviewer'))).toBe('review');
    expect(homeView(as('editor'))).toBe('workspace');
  });
  it('resolves old module ids', () => {
    expect(unalias('keywords')).toMatchObject({ view: 'research', alias: { key: 'rctab', tab: 'keywords' } });
    expect(unalias('themes')).toMatchObject({ view: 'sites', alias: { key: 'smode', tab: 'themes' } });
    expect(unalias('factory')).toMatchObject({ view: 'deploy', alias: { key: 'dtab', tab: 'workflows' } });
    expect(unalias('rank')).toMatchObject({ view: 'analytics', alias: { key: 'atab', tab: 'rank' } });
    expect(unalias('activity')).toEqual({ view: 'activity', alias: null });
    expect(unalias('nope')).toBeNull();
  });
  it('counts what waits for a person', () => {
    const s = makeState();
    expect(waitN(s)).toBe(5);              // 1 deploy approval + 4 articles
    expect(reviewCount(s)).toBe(4);
    s.session = as('reviewer');
    expect(reviewCount(s)).toBe(1);        // only the reviewer's site
    expect(s.articles.filter(a => artReady(s, a)).map(a => a.id)).toEqual([1]);
  });
  it('gives a native reviewer the site of their account, or the sample\'s site in demo mode', () => {
    const demo = makeState('reviewer');
    expect([revSite(demo), homeSite(demo)]).toEqual(['a', 'a']);
    const real = makeEmptyState('reviewer');
    real.session = { ...as('reviewer'), site: 's-kopi' };
    expect([revSite(real), homeSite(real)]).toEqual(['s-kopi', 's-kopi']);
    real.session = { ...as('reviewer'), site: null };
    expect([revSite(real), homeSite(real)]).toEqual(['', 'all']);
    expect(homeSite(makeEmptyState('editor'))).toBe('all');
  });
  it('uses the server\'s research and articles only outside demo mode', () => {
    const s = makeEmptyState();
    expect(liveOn(s)).toBe(false);
    s.live.on = true;
    expect(liveOn(s)).toBe(true);
    expect(liveOn({ ...s, sample: true })).toBe(false);
  });
});

describe('formatting', () => {
  it('formats numbers, durations and initials', () => {
    expect(fmt(18420)).toBe('18,420');
    expect(short(1240000)).toBe('1.24M'); expect(short(412000)).toBe('412K'); expect(short(950)).toBe('950');
    expect(fmtDur(45)).toBe('45s'); expect(fmtDur(185)).toBe('3m 05s');
    expect(initials('SEO/GEO Optimizer')).toBe('SG'); expect(initials('Deploy & Monitor')).toBe('DM'); expect(initials('Orchestrator')).toBe('O');
  });
  it('has a stable seeded generator and hash', () => {
    const a = seeded(42), b = seeded(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(hashStr('aBrewing')).toBe(hashStr('aBrewing'));
    expect(hashStr('a')).not.toBe(hashStr('b'));
  });
});

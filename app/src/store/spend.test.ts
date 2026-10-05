/* Real spend and tokens from the server's ledger (spend.ts): where the sums go in the store, what the daily budget
   means for a site, and that demo mode keeps its own numbers. */
import { describe, expect, it } from 'vitest';
import { serverArticle } from './articleFixtures';
import { photoJob, req, withPhotos } from './liveAgentFixtures';
import { serverFactsTo } from './serverFacts';
import { HELD_LABEL, budgetUsed, heldFor, heldJobs, heldNote, liveBudget, spendTo, stoppedSites, tokensText, usd } from './spend';
import { makeEmptyState, makeState } from './testing';
import type { AppState, Site, SpendWire } from './types';

const site = (id: string, domain = id + '.example'): Site =>
  ({ id, domain, country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0 });
const wire = (over: Partial<SpendWire> = {}): SpendWire => ({
  budget: 25, day: 0,
  sites: { a: { today: 20.5, tokensToday: 40_000, d7: 31, d28: 62.25, tokens28: 1_250_000 }, b: { today: 25, tokensToday: 9000, d7: 25, d28: 25, tokens28: 9000 } },
  agents: { Keyword: { tokens: 1500, cost: 0.12, runs: 1 }, 'Content Writer': { tokens: 45_000, cost: 3.4, runs: 4 }, 'Site Builder': { tokens: 2500, cost: 0.3, runs: 2 } },
  ...over,
});
function liveState(spend: SpendWire | null = wire()): AppState {
  const s = makeEmptyState();
  s.sites = [site('a', 'kopi.example'), site('b', 'teh.example'), site('c')];
  s.live.on = true; s.live.spend = spend;
  return s;
}

describe('spendTo', () => {
  it('puts each site\'s spend today and 28-day tokens (in millions) on the site, and zero where nothing was spent', () => {
    const s = liveState();
    spendTo(s);
    expect(s.sites.map(x => [x.id, x.spend, x.tok28])).toEqual([['a', 20.5, 1.25], ['b', 25, 0.009], ['c', 0, 0]]);
  });

  it('puts today\'s tokens on the agents the server runs, and none on the others', () => {
    const s = liveState();
    s.agents.forEach(a => { a.tokens = 777; });
    spendTo(s);
    const tok = (id: string) => s.agents.find(a => a.id === id)!.tokens;
    expect([tok('kw'), tok('wr'), tok('bld')]).toEqual([1500, 45_000, 2500]);
    expect(s.agents.filter(a => !['kw', 'wr', 'bld'].includes(a.id)).every(a => a.tokens === 0)).toBe(true);
  });

  it('clears the numbers when the server has none (a new day, a native reviewer)', () => {
    const s = liveState();
    spendTo(s);
    s.live.spend = null;
    spendTo(s);
    expect(s.sites.every(x => x.spend === 0 && x.tok28 === 0)).toBe(true);
    expect(s.agents.every(a => a.tokens === 0)).toBe(true);
  });

  it('leaves demo mode alone: the simulation owns its numbers there', () => {
    const s = makeState();
    s.live.spend = wire();
    const before = s.sites.map(x => [x.spend, x.tok28]), tok = s.agents.map(a => a.tokens);
    spendTo(s);
    expect(s.sites.map(x => [x.spend, x.tok28])).toEqual(before);
    expect(s.agents.map(a => a.tokens)).toEqual(tok);
    expect(budgetUsed(s, 'b')).toBe(false);
    expect(liveBudget(s)).toBeNull();
  });

  it('runs with the other server facts, so a saved sites document does not wipe the spend', () => {
    const s = liveState();
    serverFactsTo(s);
    expect(s.sites[0]!.spend).toBe(20.5);
    /* The document does not carry server-owned numbers: the sites come back with zero, then the facts go on top. */
    s.sites = [site('a', 'kopi.example')];
    serverFactsTo(s);
    expect(s.sites[0]).toMatchObject({ spend: 20.5, tok28: 1.25 });
  });
});

describe('the daily budget', () => {
  it('is used when the spend today reaches the budget the server enforces', () => {
    const s = liveState();
    expect([budgetUsed(s, 'a'), budgetUsed(s, 'b'), budgetUsed(s, 'c'), budgetUsed(s, 'gone')]).toEqual([false, true, false, false]);
    expect(liveBudget(s)).toBe(25);
    expect(stoppedSites(s, s.sites).map(x => x.id)).toEqual(['b']);
    s.live.spend = wire({ budget: 20 });
    expect(stoppedSites(s, s.sites).map(x => x.id)).toEqual(['a', 'b']);
    s.live.spend = null;
    expect(budgetUsed(s, 'b')).toBe(false);
  });

  it('says why a job waits and how it starts again', () => {
    const s = liveState();
    expect(HELD_LABEL).toBe('Waiting for budget');
    expect(heldFor(s, 'a')).toBeNull();
    expect(heldFor(s, 'b')).toBe('teh.example has used its daily budget of $25.00. This job starts after midnight, or when the budget is raised in Settings.');
    expect(heldNote({ budget: 7.5 }, 'x.example')).toContain('daily budget of $7.50');
    /* A site that was removed from Sites: the domain stored with the job is used. */
    s.live.spend!.sites.gone = { today: 30, tokensToday: 1, d7: 30, d28: 30, tokens28: 1 };
    expect(heldFor(s, 'gone', 'old.example')).toMatch(/^old\.example has used/);
  });

  it('counts the waiting research requests, articles and photo jobs of a stopped site', () => {
    const s = liveState();
    s.live.reqs = { 1: req(1, { siteId: 'b', status: 'queued' }), 2: req(2, { siteId: 'b', status: 'done' }), 3: req(3, { siteId: 'a', status: 'queued' }) };
    s.live.arts = {
      5: serverArticle(5, { siteId: 'b', status: 'queued' }), 6: serverArticle(6, { siteId: 'b', status: 'revision' }),
      7: withPhotos(serverArticle(7, { siteId: 'b', status: 'review' }), photoJob()),
      8: withPhotos(serverArticle(8, { siteId: 'b', status: 'rejected' }), photoJob()),
      9: serverArticle(9, { siteId: 'b', status: 'approved' }),
    };
    expect(heldJobs(s, 'b')).toBe(4);
    expect(heldJobs(s, 'a')).toBe(0);
  });
});

describe('how money and tokens are written', () => {
  it('uses two decimals for dollars and k / M for tokens', () => {
    expect([usd(0), usd(0.126), usd(25), usd(1234.5)]).toEqual(['$0.00', '$0.13', '$25.00', '$1234.50']);
    expect([tokensText(0), tokensText(950), tokensText(12_400), tokensText(1_250_000)]).toEqual(['0', '950', '12.4k', '1.25M']);
  });
});
